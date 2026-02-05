# ADK イベントを AG-UI プロトコルイベントに変換するイベントトランスレーター

import dataclasses
from collections.abc import Iterable, Mapping
from typing import AsyncGenerator, Optional, Dict, Any , List
import uuid

from google.genai import types

from ag_ui.core import (
    BaseEvent, EventType,
    TextMessageStartEvent, TextMessageContentEvent, TextMessageEndEvent,
    ToolCallStartEvent, ToolCallArgsEvent, ToolCallEndEvent,
    ToolCallResultEvent, StateSnapshotEvent, StateDeltaEvent,
    CustomEvent
)
import json
from google.adk.events import Event as ADKEvent

import logging
logger = logging.getLogger(__name__)

def _coerce_tool_response(value: Any, _visited: Optional[set[int]] = None) -> Any:
    """任意のツールレスポンスを JSON シリアライズ可能な構造に再帰的に変換"""

    if isinstance(value, (str, int, float, bool)) or value is None:
        return value

    if isinstance(value, (bytes, bytearray, memoryview)):
        try:
            return value.decode()  # type: ignore[union-attr]
        except Exception:
            return list(value)

    if _visited is None:
        _visited = set()

    obj_id = id(value)
    if obj_id in _visited:
        return str(value)

    _visited.add(obj_id)
    try:
        if dataclasses.is_dataclass(value) and not isinstance(value, type):
            return {
                field.name: _coerce_tool_response(getattr(value, field.name), _visited)
                for field in dataclasses.fields(value)
            }

        if hasattr(value, "_asdict") and callable(getattr(value, "_asdict")):
            try:
                return {
                    str(k): _coerce_tool_response(v, _visited)
                    for k, v in value._asdict().items()  # type: ignore[attr-defined]
                }
            except Exception:
                pass

        for method_name in ("model_dump", "to_dict"):
            method = getattr(value, method_name, None)
            if callable(method):
                try:
                    dumped = method()
                except TypeError:
                    try:
                        dumped = method(exclude_none=False)
                    except Exception:
                        continue
                except Exception:
                    continue

                return _coerce_tool_response(dumped, _visited)

        if isinstance(value, Mapping):
            return {
                str(k): _coerce_tool_response(v, _visited)
                for k, v in value.items()
            }

        if isinstance(value, (list, tuple, set, frozenset)):
            return [_coerce_tool_response(item, _visited) for item in value]

        if isinstance(value, Iterable):
            try:
                return [_coerce_tool_response(item, _visited) for item in list(value)]
            except TypeError:
                pass

        try:
            obj_vars = vars(value)
        except TypeError:
            obj_vars = None

        if obj_vars:
            coerced = {
                key: _coerce_tool_response(val, _visited)
                for key, val in obj_vars.items()
                if not key.startswith("_")
            }
            if coerced:
                return coerced

        return str(value)
    finally:
        _visited.discard(obj_id)

def _serialize_tool_response(response: Any) -> str:
    """ツールレスポンスを JSON 文字列にシリアライズ"""

    try:
        coerced = _coerce_tool_response(response)
        return json.dumps(coerced, ensure_ascii=False)
    except Exception as exc:
        logger.warning("Failed to coerce tool response to JSON: %s", exc, exc_info=True)
        try:
            return json.dumps(str(response), ensure_ascii=False)
        except Exception:
            logger.warning("Failed to stringify tool response; returning empty string.")
            return json.dumps("", ensure_ascii=False)

class EventTranslator:
    """Google ADK イベントを AG-UI プロトコルイベントに変換
    
    2つのイベントシステム間の変換を処理し、
    ストリーミングシーケンスを管理しイベントの一貫性を維持する。
    """
    
    def __init__(self):
        """イベントトランスレーターを初期化"""
        # 一貫性のためツールコール ID を追跡
        self._active_tool_calls: Dict[str, str] = {}  # ツールコール ID -> ツールコール ID
        # ストリーミングメッセージ状態を追跡
        self._streaming_message_id: Optional[str] = None  # 現在のストリーミングメッセージ ID
        self._is_streaming: bool = False  # 現在メッセージをストリーミング中かどうか
        self._current_stream_text: str = ""  # アクティブなストリームのテキストを蓄積
        self._last_streamed_text: Optional[str] = None  # 最後にストリームしたテキストのスナップショット
        self._last_streamed_run_id: Optional[str] = None  # 最後にストリームしたテキストの実行識別子
        self.long_running_tool_ids: List[str] = []  # 長時間実行ツール ID を追跡
    
    async def translate(
        self, 
        adk_event: ADKEvent,
        thread_id: str,
        run_id: str
    ) -> AsyncGenerator[BaseEvent, None]:
        """ADK イベントを AG-UI プロトコルイベントに変換
        
        Args:
            adk_event: 変換する ADK イベント
            thread_id: AG-UI スレッド ID
            run_id: AG-UI 実行 ID
            
        Yields:
            1つ以上の AG-UI プロトコルイベント
        """
        try:
            # 適切なメソッドを使用して ADK ストリーミング状態をチェック
            is_partial = getattr(adk_event, 'partial', False)
            turn_complete = getattr(adk_event, 'turn_complete', False)
            
            # これが最終レスポンスかチェック（完全なメッセージを含む - 重複を避けるためスキップ）
            is_final_response = False
            if hasattr(adk_event, 'is_final_response') and callable(adk_event.is_final_response):
                is_final_response = adk_event.is_final_response()
            elif hasattr(adk_event, 'is_final_response'):
                is_final_response = adk_event.is_final_response
            
            # ADK ストリーミングパターンに基づいてアクションを決定
            should_send_end = turn_complete and not is_partial

            # ユーザーイベントをスキップ（既に会話に含まれている）
            if hasattr(adk_event, 'author') and adk_event.author == "user":
                logger.debug("Skipping user event")
                return
            
            # テキストコンテンツを処理
            if adk_event.content and hasattr(adk_event.content, 'parts') and adk_event.content.parts:
                async for event in self._translate_text_content(
                    adk_event, thread_id, run_id
                ):
                    yield event
            
            # _translate_function_calls 関数を呼び出してツールイベントを yield
            if hasattr(adk_event, 'get_function_calls'):               
                function_calls = adk_event.get_function_calls()
                if function_calls:
                    # 長時間実行ツールコールをフィルタリング（translate_lro_function_calls で処理）
                    try:
                        lro_ids = set(getattr(adk_event, 'long_running_tool_ids', []) or [])
                    except Exception:
                        lro_ids = set()

                    non_lro_calls = [fc for fc in function_calls if getattr(fc, 'id', None) not in lro_ids]

                    if non_lro_calls:
                        logger.debug(f"ADK function calls detected (non-LRO): {len(non_lro_calls)} of {len(function_calls)} total")
                        # 重要な修正: ツールコール開始前にアクティブなテキストメッセージストリームを終了
                        # AG-UI プロトコル: TEXT_MESSAGE_END は TOOL_CALL_START の前に送信必須
                        async for event in self.force_close_streaming_message():
                            yield event
                        
                        # 非 LRO 関数コールイベントのみを yield
                        async for event in self._translate_function_calls(non_lro_calls):
                            yield event
                        
            # 関数レスポンスを処理しツールレスポンスイベントを yield
            # フロントエンドで関数レスポンスをレンダリングする必要があるシナリオに必須
            if hasattr(adk_event, 'get_function_responses'):
                function_responses = adk_event.get_function_responses()
                if function_responses:
                    # 関数レスポンスはフロントエンドに送信してレンダリングできるようにする
                    async for event in self._translate_function_response(function_responses):
                        yield event
                    
            
            # 状態変更を処理
            if hasattr(adk_event, 'actions') and adk_event.actions:
                if hasattr(adk_event.actions, 'state_delta') and adk_event.actions.state_delta:
                    yield self._create_state_delta_event(
                        adk_event.actions.state_delta, thread_id, run_id
                    )

                if hasattr(adk_event.actions, 'state_snapshot'):
                    state_snapshot = adk_event.actions.state_snapshot
                    if state_snapshot is not None:
                        yield self._create_state_snapshot_event(state_snapshot)
                
            
            # カスタムイベントまたはメタデータを処理
            if hasattr(adk_event, 'custom_data') and adk_event.custom_data:
                yield CustomEvent(
                    type=EventType.CUSTOM,
                    name="adk_metadata",
                    value=adk_event.custom_data
                )
                
        except Exception as e:
            logger.error(f"Error translating ADK event: {e}", exc_info=True)
            # ここではエラーイベントを yield しない - 呼び出し元がエラーを処理
    
    async def _translate_text_content(
        self,
        adk_event: ADKEvent,
        thread_id: str,
        run_id: str
    ) -> AsyncGenerator[BaseEvent, None]:
        """ADK イベントからテキストコンテンツを AG-UI テキストメッセージイベントに変換
        
        Args:
            adk_event: テキストコンテンツを含む ADK イベント
            thread_id: AG-UI スレッド ID
            run_id: AG-UI 実行 ID
            
        Yields:
            テキストメッセージイベント (START, CONTENT, END)
        """
        
        # テキストをチェックする*前に* is_final_response をチェック
        # 空の final response は有効なストリーム終了シグナル
        is_final_response = False
        if hasattr(adk_event, 'is_final_response') and callable(adk_event.is_final_response):
            is_final_response = adk_event.is_final_response()
        elif hasattr(adk_event, 'is_final_response'):
            is_final_response = adk_event.is_final_response
        
        # すべての parts からテキストを抽出
        text_parts = []
        # adk_event.content.parts のチェックはメインの translate メソッドで行う
        for part in adk_event.content.parts:
            if part.text:  # 注: part.text == "" は False
                text_parts.append(part.text)
        
        # テキストがなく、final response でもない場合は安全にスキップ可能
        # そうでなければ final_response シグナルを処理し続ける必要あり
        if not text_parts and not is_final_response:
            return

        combined_text = "".join(text_parts)

        # 適切な ADK ストリーミング検出を使用（None 値を処理）
        is_partial = getattr(adk_event, 'partial', False)
        turn_complete = getattr(adk_event, 'turn_complete', False)
        
        # (is_final_response は上で既に計算済み)
        
        # None 値を処理: ターンが完了または final チャンクが到着したら、ストリーミングを終了
        has_finish_reason = bool(getattr(adk_event, 'finish_reason', None))
        should_send_end = (
            (turn_complete and not is_partial)
            or (is_final_response and not is_partial)
            or (has_finish_reason and self._is_streaming)
        )

        if is_final_response:
            # これは最終的な完全メッセージイベント

            # ケース 1: ストリームがアクティブに実行中。閉じる必要あり
            if self._is_streaming and self._streaming_message_id:
                logger.info("⏭️ Final response event received. Closing active stream.")
                
                if self._current_stream_text:
                    # 重複排除のため完全なストリームテキストを保存
                    self._last_streamed_text = self._current_stream_text
                    self._last_streamed_run_id = run_id
                self._current_stream_text = ""

                end_event = TextMessageEndEvent(
                    type=EventType.TEXT_MESSAGE_END,
                    message_id=self._streaming_message_id
                )
                yield end_event

                self._streaming_message_id = None
                self._is_streaming = False
                logger.info("🏁 Streaming completed via final response")
                return  # 完了

            # ケース 2: アクティブなストリームなし
            # このイベントは*完全な*メッセージを含む
            # 送信する必要あり、*ただし*直前に終了したストリームの重複でなければ
            
            # この*同じ実行*での*前の*ストリームからの重複をチェック
            is_duplicate = (
                self._last_streamed_run_id == run_id and
                self._last_streamed_text is not None and
                combined_text == self._last_streamed_text
            )

            if is_duplicate:
                logger.info(
                    "⏭️ Skipping final response event (duplicate content detected from finished stream)"
                )
            else:
                # 重複でないか、前のストリームなし。完全なメッセージを送信
                logger.info(
                    f"⏩ Delivering complete non-streamed message or final content event_id={adk_event.id}"
                )
                message_events = [
                    TextMessageStartEvent(
                        type=EventType.TEXT_MESSAGE_START,
                        message_id=adk_event.id, # Use event ID for non-streamed
                        role="assistant",
                    ),
                    TextMessageContentEvent(
                        type=EventType.TEXT_MESSAGE_CONTENT,
                        message_id=adk_event.id,
                        delta=combined_text,
                    ),
                    TextMessageEndEvent(
                        type=EventType.TEXT_MESSAGE_END,
                        message_id=adk_event.id,
                    ),
                ]
                for msg in message_events:
                    yield msg

            # テキストの終端なので、いずれにせよ状態をクリーンアップ
            self._current_stream_text = ""
            self._last_streamed_text = None
            self._last_streamed_run_id = None
            return

        
        # ストリーミングロジックを処理（is_final_response でない場合）
        if not self._is_streaming:
            # 新しいメッセージの開始 - START イベントを発行
            self._streaming_message_id = str(uuid.uuid4())
            self._is_streaming = True
            self._current_stream_text = ""

            start_event = TextMessageStartEvent(
                type=EventType.TEXT_MESSAGE_START,
                message_id=self._streaming_message_id,
                role="assistant"
            )
            yield start_event
        
        # 常にコンテンツを発行（空でなければ）
        if combined_text:
            self._current_stream_text += combined_text
            content_event = TextMessageContentEvent(
                type=EventType.TEXT_MESSAGE_CONTENT,
                message_id=self._streaming_message_id,
                delta=combined_text
            )
            yield content_event
        
        # ターンが完了し partial でなければ、END イベントを発行
        if should_send_end:
            end_event = TextMessageEndEvent(
                type=EventType.TEXT_MESSAGE_END,
                message_id=self._streaming_message_id
            )
            yield end_event

            # ストリーミング状態をリセット
            if self._current_stream_text:
                self._last_streamed_text = self._current_stream_text
                self._last_streamed_run_id = run_id
            self._current_stream_text = ""
            self._streaming_message_id = None
            self._is_streaming = False
            logger.info("🏁 Streaming completed, state reset")
    
    async def translate_lro_function_calls(self,adk_event: ADKEvent)-> AsyncGenerator[BaseEvent, None]:
        """ADK イベントから長時間実行関数コールを AG-UI ツールコールイベントに変換

        Args:
            adk_event: 関数コールを含む ADK イベント

        Yields:
            ツールコールイベント (START, ARGS, END)
        """

        long_running_function_call = None
        if adk_event.content and adk_event.content.parts:
            for i, part in enumerate(adk_event.content.parts):
                if part.function_call:
                    if not long_running_function_call and part.function_call.id in (
                        adk_event.long_running_tool_ids or []
                    ):
                        long_running_function_call = part.function_call
                        self.long_running_tool_ids.append(long_running_function_call.id)
                        yield ToolCallStartEvent(
                            type=EventType.TOOL_CALL_START,
                            tool_call_id=long_running_function_call.id,
                            tool_call_name=long_running_function_call.name,
                            parent_message_id=None
                        )
                        if hasattr(long_running_function_call, 'args') and long_running_function_call.args:
                            # 引数を文字列に変換（JSON フォーマット）
                            import json
                            args_str = json.dumps(long_running_function_call.args) if isinstance(long_running_function_call.args, dict) else str(long_running_function_call.args)
                            yield ToolCallArgsEvent(
                                type=EventType.TOOL_CALL_ARGS,
                                tool_call_id=long_running_function_call.id,
                                delta=args_str
                            )
                        
                        # TOOL_CALL_END を発行
                        yield ToolCallEndEvent(
                            type=EventType.TOOL_CALL_END,
                            tool_call_id=long_running_function_call.id
                        )

                        # 追跡をクリーンアップ
                        self._active_tool_calls.pop(long_running_function_call.id, None)
    
    async def _translate_function_calls(
        self,
        function_calls: list[types.FunctionCall],
    ) -> AsyncGenerator[BaseEvent, None]:
        """ADK イベントから関数コールを AG-UI ツールコールイベントに変換

        Args:
            function_calls: イベントからの関数コールリスト

        Yields:
            ツールコールイベント (START, ARGS, END)
        """
        # ストリーミングメッセージを追跡していないので、親メッセージに None を使用
        parent_message_id = None

        for func_call in function_calls:
            tool_call_id = getattr(func_call, 'id', str(uuid.uuid4()))

            # このツールコール ID が既に存在するかチェック
            if tool_call_id in self._active_tool_calls:
                logger.warning(f"⚠️  DUPLICATE TOOL CALL! Tool call ID {tool_call_id} (name: {func_call.name}) already exists in active calls!")

            # ツールコールを追跡
            self._active_tool_calls[tool_call_id] = tool_call_id

            # TOOL_CALL_START を発行
            yield ToolCallStartEvent(
                type=EventType.TOOL_CALL_START,
                tool_call_id=tool_call_id,
                tool_call_name=func_call.name,
                parent_message_id=parent_message_id
            )

            # 引数があれば TOOL_CALL_ARGS を発行
            if hasattr(func_call, 'args') and func_call.args:
                # 引数を文字列に変換（JSON フォーマット）
                import json
                args_str = json.dumps(func_call.args) if isinstance(func_call.args, dict) else str(func_call.args)

                yield ToolCallArgsEvent(
                    type=EventType.TOOL_CALL_ARGS,
                    tool_call_id=tool_call_id,
                    delta=args_str
                )

            # TOOL_CALL_END を発行
            yield ToolCallEndEvent(
                type=EventType.TOOL_CALL_END,
                tool_call_id=tool_call_id
            )

            # 追跡をクリーンアップ
            self._active_tool_calls.pop(tool_call_id, None)

    

    async def _translate_function_response(
        self,
        function_response: list[types.FunctionResponse],
    ) -> AsyncGenerator[BaseEvent, None]:
        """ADK イベントから関数レスポンスを AG-UI ツール結果イベントに変換
        
        Args:
            function_response: イベントからの関数レスポンスリスト
            
        Yields:
            ツール結果イベント（long_running_tool_ids にない tool_call_id のみ）
        """
        
        for func_response in function_response:
            
            tool_call_id = getattr(func_response, 'id', str(uuid.uuid4()))
            # long_running_tool でない tool_call_id に対してのみ ToolCallResultEvent を発行
            # 長時間実行ツールはフロントエンドで処理されるため
            if tool_call_id not in self.long_running_tool_ids:
                yield ToolCallResultEvent(
                    message_id=str(uuid.uuid4()),
                    type=EventType.TOOL_CALL_RESULT,
                    tool_call_id=tool_call_id,
                    content=_serialize_tool_response(func_response.response)
                )
            else:
                logger.debug(f"Skipping ToolCallResultEvent for long-running tool: {tool_call_id}")
  
    def _create_state_delta_event(
        self,
        state_delta: Dict[str, Any],
        thread_id: str,
        run_id: str
    ) -> StateDeltaEvent:
        """ADK 状態変更から状態デルタイベントを作成
        
        Args:
            state_delta: ADK からの状態変更
            thread_id: AG-UI スレッド ID
            run_id: AG-UI 実行 ID
            
        Returns:
            StateDeltaEvent
        """
        # JSON Patch フォーマット (RFC 6902) に変換
        # 新規と既存パスの両方で機能する "add" 操作を使用
        patches = []
        for key, value in state_delta.items():
            patches.append({
                "op": "add",
                "path": f"/{key}",
                "value": value
            })
        
        return StateDeltaEvent(
            type=EventType.STATE_DELTA,
            delta=patches
        )
    
    def _create_state_snapshot_event(
        self,
        state_snapshot: Dict[str, Any],
    ) -> StateSnapshotEvent:
        """ADK 状態変更から状態スナップショットイベントを作成
        
        Args:
            state_snapshot: ADK からの状態変更
            
        Returns:
            StateSnapshotEvent
        """
 
        return StateSnapshotEvent(
            type=EventType.STATE_SNAPSHOT,
            snapshot=state_snapshot
        )
    
    async def force_close_streaming_message(self) -> AsyncGenerator[BaseEvent, None]:
        """開いているストリーミングメッセージを強制的に閉じる
        
        適切なメッセージ終了を確保するため、実行終了前に呼び出すべき。
        
        Yields:
            開いているストリーミングメッセージがあれば TEXT_MESSAGE_END イベント
        """
        if self._is_streaming and self._streaming_message_id:
            logger.warning(f"🚨 Force-closing unterminated streaming message: {self._streaming_message_id}")

            end_event = TextMessageEndEvent(
                type=EventType.TEXT_MESSAGE_END,
                message_id=self._streaming_message_id
            )
            yield end_event

            # ストリーミング状態をリセット
            self._current_stream_text = ""
            self._streaming_message_id = None
            self._is_streaming = False
            logger.info("🔄 Streaming state reset after force-close")

    def reset(self):
        """トランスレーター状態をリセット
        
        クリーンな状態を確保するため、異なる会話実行間で呼び出すべき。
        """
        self._active_tool_calls.clear()
        self._streaming_message_id = None
        self._is_streaming = False
        self._current_stream_text = ""
        self._last_streamed_text = None
        self._last_streamed_run_id = None
        self.long_running_tool_ids.clear()
        logger.debug("Reset EventTranslator state (including streaming state)")
        