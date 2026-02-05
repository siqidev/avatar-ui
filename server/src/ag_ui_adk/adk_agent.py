# AG-UI プロトコルと Google ADK を橋渡しする ADKAgent の実装

from typing import Optional, Dict, Callable, Any, AsyncGenerator, List
import time
import json
import asyncio
import inspect
from datetime import datetime

from ag_ui.core import (
    RunAgentInput, BaseEvent, EventType,
    RunStartedEvent, RunFinishedEvent, RunErrorEvent,
    ToolCallEndEvent, SystemMessage,ToolCallResultEvent
)

from google.adk import Runner
from google.adk.agents import BaseAgent, RunConfig as ADKRunConfig
from google.adk.agents.run_config import StreamingMode
from google.adk.sessions import BaseSessionService, InMemorySessionService
from google.adk.artifacts import BaseArtifactService, InMemoryArtifactService
from google.adk.memory import BaseMemoryService, InMemoryMemoryService
from google.adk.auth.credential_service.base_credential_service import BaseCredentialService
from google.adk.auth.credential_service.in_memory_credential_service import InMemoryCredentialService
from google.genai import types

from .event_translator import EventTranslator
from .session_manager import SessionManager
from .execution_state import ExecutionState
from .client_proxy_toolset import ClientProxyToolset

import logging
logger = logging.getLogger(__name__)

class ADKAgent:
    """AG-UI プロトコルと Google ADK エージェントを橋渡しするミドルウェア
    
    AG-UI プロトコルイベントと Google ADK イベントを相互変換し、
    セッション、状態、ADK エージェントのライフサイクルを管理する。
    """
    
    def __init__(
        self,
        # ADK エージェントインスタンス
        adk_agent: BaseAgent,
        
        # アプリ識別
        app_name: Optional[str] = None,
        session_timeout_seconds: Optional[int] = 1200,
        app_name_extractor: Optional[Callable[[RunAgentInput], str]] = None,
        
        # ユーザー識別
        user_id: Optional[str] = None,
        user_id_extractor: Optional[Callable[[RunAgentInput], str]] = None,
        
        # ADK サービス
        session_service: Optional[BaseSessionService] = None,
        artifact_service: Optional[BaseArtifactService] = None,
        memory_service: Optional[BaseMemoryService] = None,
        credential_service: Optional[BaseCredentialService] = None,
        
        # 設定
        run_config_factory: Optional[Callable[[RunAgentInput], ADKRunConfig]] = None,
        use_in_memory_services: bool = True,
        
        # ツール設定
        execution_timeout_seconds: int = 600,  # 10分
        tool_timeout_seconds: int = 300,  # 5分
        max_concurrent_executions: int = 10,
        
        # セッションクリーンアップ設定
        cleanup_interval_seconds: int = 300  # 5分デフォルト
    ):
        """ADKAgent を初期化
        
        Args:
            adk_agent: 使用する ADK エージェントインスタンス
            app_name: すべてのリクエストに対する静的アプリケーション名
            app_name_extractor: 入力から動的にアプリ名を抽出する関数
            user_id: すべてのリクエストに対する静的ユーザー ID
            user_id_extractor: 入力から動的にユーザー ID を抽出する関数
            session_service: セッション管理サービス（デフォルト: InMemorySessionService）
            artifact_service: ファイル/アーティファクトストレージサービス
            memory_service: 会話メモリと検索サービス（自動セッションメモリも有効化）
            credential_service: 認証クレデンシャルストレージ
            run_config_factory: リクエストごとに RunConfig を作成する関数
            use_in_memory_services: 未指定サービスにインメモリ実装を使用
            execution_timeout_seconds: 実行全体のタイムアウト
            tool_timeout_seconds: 個別ツールコールのタイムアウト
            max_concurrent_executions: 最大同時バックグラウンド実行数
        """
        if app_name and app_name_extractor:
            raise ValueError("Cannot specify both 'app_name' and 'app_name_extractor'")
        
        # app_name, app_name_extractor, またはどちらも指定しない（エージェント名をデフォルトとして使用）
        
        if user_id and user_id_extractor:
            raise ValueError("Cannot specify both 'user_id' and 'user_id_extractor'")
        
        self._adk_agent = adk_agent
        self._static_app_name = app_name
        self._app_name_extractor = app_name_extractor
        self._static_user_id = user_id
        self._user_id_extractor = user_id_extractor
        self._run_config_factory = run_config_factory or self._default_run_config
        
        # インテリジェントなデフォルトでサービスを初期化
        if use_in_memory_services:
            self._artifact_service = artifact_service or InMemoryArtifactService()
            self._memory_service = memory_service or InMemoryMemoryService()
            self._credential_service = credential_service or InMemoryCredentialService()
        else:
            # 本番環境では明示的なサービスが必要
            self._artifact_service = artifact_service
            self._memory_service = memory_service
            self._credential_service = credential_service
        
        
        # セッションライフサイクル管理 - シングルトンを使用
        # 提供されたセッションサービスを使用するか、use_in_memory_services に基づいてデフォルトを作成
        if session_service is None:
            session_service = InMemorySessionService()  # dev と本番の両方でデフォルト
            
        self._session_manager = SessionManager.get_instance(
            session_service=session_service,
            memory_service=self._memory_service,  # 自動セッションメモリ用にメモリサービスを渡す
            session_timeout_seconds=session_timeout_seconds,  # 20分デフォルト
            cleanup_interval_seconds=cleanup_interval_seconds,
            max_sessions_per_user=None,    # デフォルトは無制限
            auto_cleanup=True              # デフォルトで有効
        )
        
        # ツール実行追跡
        self._active_executions: Dict[str, ExecutionState] = {}
        self._execution_timeout = execution_timeout_seconds
        self._tool_timeout = tool_timeout_seconds
        self._max_concurrent = max_concurrent_executions
        self._execution_lock = asyncio.Lock()

        # 効率的なセッション ID からメタデータへのマッピング用キャッシュ
        # session_id -> {"app_name": str, "user_id": str} をマップ
        self._session_lookup_cache: Dict[str, Dict[str, str]] = {}
        
        # イベントトランスレーターはスレッドセーフのためセッションごとに作成
        
        # クリーンアップはセッションマネージャーが管理
        # 最初の非同期操作実行時に開始

    def _get_session_metadata(self, session_id: str) -> Optional[Dict[str, str]]:
        """セッション ID からセッションメタデータ (app_name, user_id) を効率的に取得

        Args:
            session_id: 検索するセッション ID

        Returns:
            app_name と user_id を含む辞書、見つからない場合は None
        """
        # まずキャッシュを試す（O(1) ルックアップ）
        if session_id in self._session_lookup_cache:
            return self._session_lookup_cache[session_id]

        # キャッシュにない場合は線形探索にフォールバック（既存セッション用）
        # 後方互換性を維持
        try:
            for uid, keys in self._session_manager._user_sessions.items():
                for key in keys:
                    if key.endswith(f":{session_id}"):
                        app_name = key.split(':', 1)[0]
                        metadata = {"app_name": app_name, "user_id": uid}
                        # 将来のルックアップ用にキャッシュ
                        self._session_lookup_cache[session_id] = metadata
                        return metadata
        except Exception as e:
            logger.error(f"Error during session metadata lookup for {session_id}: {e}")

        return None
    
    def _get_app_name(self, input: RunAgentInput) -> str:
        """明確な優先順位でアプリ名を解決"""
        if self._static_app_name:
            return self._static_app_name
        elif self._app_name_extractor:
            return self._app_name_extractor(input)
        else:
            return self._default_app_extractor(input)
    
    def _default_app_extractor(self, input: RunAgentInput) -> str:
        """デフォルトのアプリ抽出ロジック - エージェント名を直接使用"""
        # ADK エージェントの名前をアプリ名として使用
        try:
            return self._adk_agent.name
        except Exception as e:
            logger.warning(f"Could not get agent name for app_name, using default: {e}")
            return "AG-UI ADK Agent"
    
    def _get_user_id(self, input: RunAgentInput) -> str:
        """明確な優先順位でユーザー ID を解決"""
        if self._static_user_id:
            return self._static_user_id
        elif self._user_id_extractor:
            return self._user_id_extractor(input)
        else:
            return self._default_user_extractor(input)
    
    def _default_user_extractor(self, input: RunAgentInput) -> str:
        """デフォルトのユーザー抽出ロジック"""
        # デフォルトで thread_id を使用（スレッドごとにユーザーを想定）
        return f"thread_user_{input.thread_id}"
    
    async def _add_pending_tool_call_with_context(self, session_id: str, tool_call_id: str, app_name: str, user_id: str):
        """HITL 追跡用にセッションの保留リストにツールコールを追加

        Args:
            session_id: セッション ID (thread_id)
            tool_call_id: 追跡するツールコール ID
            app_name: アプリ名（セッションルックアップ用）
            user_id: ユーザー ID（セッションルックアップ用）
        """
        logger.debug(f"Adding pending tool call {tool_call_id} for session {session_id}, app_name={app_name}, user_id={user_id}")
        try:
            # SessionManager を使用して現在の保留コールを取得
            pending_calls = await self._session_manager.get_state_value(
                session_id=session_id,
                app_name=app_name,
                user_id=user_id,
                key="pending_tool_calls",
                default=[]
            )

            # まだ存在しなければ新しいツールコールを追加
            if tool_call_id not in pending_calls:
                pending_calls.append(tool_call_id)

                # SessionManager を使用して状態を更新
                success = await self._session_manager.set_state_value(
                    session_id=session_id,
                    app_name=app_name,
                    user_id=user_id,
                    key="pending_tool_calls",
                    value=pending_calls
                )

                if success:
                    logger.info(f"Added tool call {tool_call_id} to session {session_id} pending list")
        except Exception as e:
            logger.error(f"Failed to add pending tool call {tool_call_id} to session {session_id}: {e}")

    async def _remove_pending_tool_call(self, session_id: str, tool_call_id: str):
        """セッションの保留リストからツールコールを削除

        明示的な app_name/user_id なしでセッションを見つける効率的なセッションルックアップを使用

        Args:
            session_id: セッション ID (thread_id)
            tool_call_id: 削除するツールコール ID
        """
        try:
            # 効率的なセッションメタデータルックアップを使用
            metadata = self._get_session_metadata(session_id)

            if metadata:
                app_name = metadata["app_name"]
                user_id = metadata["user_id"]

                # SessionManager を使用して現在の保留コールを取得
                pending_calls = await self._session_manager.get_state_value(
                    session_id=session_id,
                    app_name=app_name,
                    user_id=user_id,
                    key="pending_tool_calls",
                    default=[]
                )

                # ツールコールが存在すれば削除
                if tool_call_id in pending_calls:
                    pending_calls.remove(tool_call_id)

                    # SessionManager を使用して状態を更新
                    success = await self._session_manager.set_state_value(
                        session_id=session_id,
                        app_name=app_name,
                        user_id=user_id,
                        key="pending_tool_calls",
                        value=pending_calls
                    )

                    if success:
                        logger.info(f"Removed tool call {tool_call_id} from session {session_id} pending list")
        except Exception as e:
            logger.error(f"Failed to remove pending tool call {tool_call_id} from session {session_id}: {e}")
    
    async def _get_pending_tool_call_ids(self, session_id: str) -> Optional[List[str]]:
        """セッションで追跡されている保留ツールコール識別子を取得"""
        try:
            metadata = self._get_session_metadata(session_id)

            if metadata:
                pending_calls = await self._session_manager.get_state_value(
                    session_id=session_id,
                    app_name=metadata["app_name"],
                    user_id=metadata["user_id"],
                    key="pending_tool_calls",
                    default=[],
                )

                if pending_calls is None:
                    return []

                return list(pending_calls)
        except Exception as e:
            logger.error(f"Failed to fetch pending tool calls for session {session_id}: {e}")

        return None

    async def _has_pending_tool_calls(self, session_id: str) -> bool:
        """セッションに保留ツールコールがあるかチェック（HITL シナリオ）

        Args:
            session_id: セッション ID (thread_id)

        Returns:
            保留ツールコールがある場合 True
        """
        pending_calls = await self._get_pending_tool_call_ids(session_id)
        if pending_calls is None:
            return False

        return len(pending_calls) > 0
    
    
    def _default_run_config(self, input: RunAgentInput) -> ADKRunConfig:
        """SSE ストリーミングを有効にしたデフォルト RunConfig を作成"""
        return ADKRunConfig(
            streaming_mode=StreamingMode.SSE,
            save_input_blobs_as_artifacts=True
        )
    
    
    def _create_runner(self, adk_agent: BaseAgent, user_id: str, app_name: str) -> Runner:
        """新しいランナーインスタンスを作成"""
        return Runner(
            app_name=app_name,
            agent=adk_agent,
            session_service=self._session_manager._session_service,
            artifact_service=self._artifact_service,
            memory_service=self._memory_service,
            credential_service=self._credential_service
        )
    
    async def run(self, input: RunAgentInput) -> AsyncGenerator[BaseEvent, None]:
        """クライアントサイドツールサポート付きで ADK エージェントを実行
        
        すべてのクライアントサイドツールは長時間実行。ツール結果送信の場合は
        既存の実行を継続。新規リクエストの場合は新しい実行を開始。
        ADK セッションが会話の継続性とツール結果処理を担当。
        
        Args:
            input: AG-UI 実行入力
            
        Yields:
            AG-UI プロトコルイベント
        """
        unseen_messages = await self._get_unseen_messages(input)

        if not unseen_messages:
            # 未読メッセージなし - 通常の実行処理にフォールスルー
            async for event in self._start_new_execution(input):
                yield event
            return

        index = 0
        total_unseen = len(unseen_messages)
        app_name = self._get_app_name(input)
        skip_tool_message_batch = False

        while index < total_unseen:
            current = unseen_messages[index]
            role = getattr(current, "role", None)

            if role == "tool":
                tool_batch: List[Any] = []
                while index < total_unseen and getattr(unseen_messages[index], "role", None) == "tool":
                    tool_batch.append(unseen_messages[index])
                    index += 1

                tool_call_ids = [
                    getattr(message, "tool_call_id", None)
                    for message in tool_batch
                    if getattr(message, "tool_call_id", None)
                ]
                pending_tool_call_ids = await self._get_pending_tool_call_ids(input.thread_id)

                should_process_tool_batch = True
                if pending_tool_call_ids is not None:
                    if tool_call_ids:
                        pending_tool_call_id_set = set(pending_tool_call_ids)
                        should_process_tool_batch = any(
                            tool_call_id in pending_tool_call_id_set
                            for tool_call_id in tool_call_ids
                        )
                    else:
                        should_process_tool_batch = len(pending_tool_call_ids) > 0

                if not should_process_tool_batch:
                    logger.info(
                        "Skipping tool result batch for thread %s - no matching pending tool calls",
                        input.thread_id,
                    )
                    message_ids = self._collect_message_ids(tool_batch)
                    if message_ids:
                        self._session_manager.mark_messages_processed(
                            app_name,
                            input.thread_id,
                            message_ids,
                        )
                    skip_tool_message_batch = False
                    continue

                # 先読み: ツール以外のメッセージが後続にあれば、それも収集
                # これにより FunctionResponse + ユーザーメッセージを1回の呼び出しで送信可能
                trailing_messages: List[Any] = []
                trailing_assistant_ids: List[str] = []
                temp_index = index

                # すべての後続非ツールメッセージを収集（assistant はスキップ、user/system を収集）
                while temp_index < total_unseen and getattr(unseen_messages[temp_index], "role", None) != "tool":
                    candidate = unseen_messages[temp_index]
                    candidate_role = getattr(candidate, "role", None)

                    if candidate_role == "assistant":
                        message_id = getattr(candidate, "id", None)
                        if message_id:
                            trailing_assistant_ids.append(message_id)
                    else:
                        trailing_messages.append(candidate)

                    temp_index += 1

                # 後続メッセージが見つかった場合、インデックスを進めて assistant を処理済みにマーク
                if trailing_messages or trailing_assistant_ids:
                    index = temp_index

                    if trailing_assistant_ids:
                        self._session_manager.mark_messages_processed(
                            app_name,
                            input.thread_id,
                            trailing_assistant_ids,
                        )

                async for event in self._handle_tool_result_submission(
                    input,
                    tool_messages=tool_batch,
                    trailing_messages=trailing_messages if trailing_messages else None,
                    include_message_batch=not skip_tool_message_batch,
                ):
                    yield event
                skip_tool_message_batch = False
            else:
                message_batch: List[Any] = []
                assistant_message_ids: List[str] = []

                while index < total_unseen and getattr(unseen_messages[index], "role", None) != "tool":
                    candidate = unseen_messages[index]
                    candidate_role = getattr(candidate, "role", None)

                    if candidate_role == "assistant":
                        message_id = getattr(candidate, "id", None)
                        if message_id:
                            assistant_message_ids.append(message_id)
                    else:
                        message_batch.append(candidate)

                    index += 1

                if assistant_message_ids:
                    self._session_manager.mark_messages_processed(
                        app_name,
                        input.thread_id,
                        assistant_message_ids,
                    )

                if not message_batch:
                    if assistant_message_ids:
                        skip_tool_message_batch = True
                    continue
                else:
                    skip_tool_message_batch = False

                async for event in self._start_new_execution(input, message_batch=message_batch):
                    yield event
    
    async def _ensure_session_exists(self, app_name: str, user_id: str, session_id: str, initial_state: dict):
        """セッションが存在することを確認し、必要に応じてセッションマネージャー経由で作成"""
        try:
            # セッションマネージャーを使用してセッションを取得または作成
            adk_session = await self._session_manager.get_or_create_session(
                session_id=session_id,
                app_name=app_name,  # セッション管理に app_name を使用
                user_id=user_id,
                initial_state=initial_state
            )

            # 効率的なセッション ID からメタデータへのマッピング用にキャッシュを更新
            self._session_lookup_cache[session_id] = {
                "app_name": app_name,
                "user_id": user_id
            }

            logger.debug(f"Session ready: {session_id} for user: {user_id}")
            return adk_session
        except Exception as e:
            logger.error(f"Failed to ensure session {session_id}: {e}")
            raise

    async def _convert_latest_message(
        self,
        input: RunAgentInput,
        messages: Optional[List[Any]] = None,
    ) -> Optional[types.Content]:
        """最新のユーザーメッセージを ADK Content フォーマットに変換"""
        target_messages = messages if messages is not None else input.messages

        if not target_messages:
            return None

        # 最新のユーザーメッセージを取得
        for message in reversed(target_messages):
            if getattr(message, "role", None) == "user" and getattr(message, "content", None):
                return types.Content(
                    role="user",
                    parts=[types.Part(text=message.content)]
                )

        return None
    
    
    async def _get_unseen_messages(self, input: RunAgentInput) -> List[Any]:
        """このセッションでまだ処理されていないメッセージを返す

        最初の1つで止まらず、すべての処理済みメッセージをフィルタリング。
        順序外のメッセージ処理に対応（例：LRO ツール結果が後続のユーザーメッセージの後に到着）。
        """
        if not input.messages:
            return []

        app_name = self._get_app_name(input)
        session_id = input.thread_id
        processed_ids = self._session_manager.get_processed_message_ids(app_name, session_id)

        # すべての処理済みメッセージをフィルタリングし、時系列順を維持
        unseen: List[Any] = []
        for message in input.messages:
            message_id = getattr(message, "id", None)
            if message_id and message_id in processed_ids:
                continue
            unseen.append(message)

        return unseen

    def _collect_message_ids(self, messages: List[Any]) -> List[str]:
        """メッセージから ID を抽出（ID がないものはスキップ）"""
        return [getattr(message, "id") for message in messages if getattr(message, "id", None)]

    async def _is_tool_result_submission(
        self,
        input: RunAgentInput,
        unseen_messages: Optional[List[Any]] = None,
    ) -> bool:
        """このリクエストにツール結果が含まれているかチェック

        Args:
            input: 実行入力
            unseen_messages: 検査する未読メッセージのオプションリスト

        Returns:
            すべての未読メッセージがツール結果の場合 True
        """
        unseen_messages = unseen_messages if unseen_messages is not None else await self._get_unseen_messages(input)

        if not unseen_messages:
            return False

        last_message = unseen_messages[-1]
        return getattr(last_message, "role", None) == "tool"

    async def _handle_tool_result_submission(
        self,
        input: RunAgentInput,
        *,
        tool_messages: Optional[List[Any]] = None,
        trailing_messages: Optional[List[Any]] = None,
        include_message_batch: bool = True,
    ) -> AsyncGenerator[BaseEvent, None]:
        """既存の実行に対するツール結果送信を処理

        Args:
            input: ツール結果を含む実行入力
            tool_messages: 考慮する事前フィルタ済みツールメッセージ（オプション）
            trailing_messages: ツールバッチの後に続くメッセージ（例：ユーザーメッセージ）
            include_message_batch: 候補メッセージを実行に転送するかどうか

        Yields:
            継続実行からの AG-UI イベント
        """
        thread_id = input.thread_id

        # フロントエンドから送信されたツール結果を抽出
        candidate_messages = tool_messages if tool_messages is not None else await self._get_unseen_messages(input)
        tool_results = await self._extract_tool_results(input, candidate_messages)

        # フロントエンドからツール結果が送信されていない場合
        if not tool_results:
            logger.error(f"Tool result submission without tool results for thread {thread_id}")
            yield RunErrorEvent(
                type=EventType.RUN_ERROR,
                message="No tool results found in submission",
                code="NO_TOOL_RESULTS"
            )
            return

        try:
            # 保留リストからツールコールを削除
            for tool_result in tool_results:
                tool_call_id = tool_result['message'].tool_call_id
                has_pending = await self._has_pending_tool_calls(thread_id)

                if has_pending:
                    # ここで正確な tool_call_id のより具体的なチェックを追加可能だが
                    # 現時点ではツールが保留中にツール結果を処理していることをログに記録
                    logger.debug(f"Processing tool result {tool_call_id} for thread {thread_id} with pending tools")
                    # 処理中なので保留ツールコールから削除
                    await self._remove_pending_tool_call(thread_id, tool_call_id)
                else:
                    # 保留ツールなし - 古い結果か別のセッションからの可能性
                    logger.warning(f"No pending tool calls found for tool result {tool_call_id} in thread {thread_id}")

            # すべてのツールは長時間実行なので、すべてのツール結果はスタンドアロンであり
            # ツール結果を使用して新しい実行を開始すべき
            logger.info(f"Starting new execution for tool result in thread {thread_id}")

            # trailing_messages が提供されていればそれを使用、そうでなければ candidate_messages にフォールバック
            message_batch = trailing_messages if trailing_messages else (candidate_messages if include_message_batch else None)

            async for event in self._start_new_execution(
                input,
                tool_results=tool_results,
                message_batch=message_batch,
            ):
                yield event
                
        except Exception as e:
            logger.error(f"Error handling tool results: {e}", exc_info=True)
            yield RunErrorEvent(
                type=EventType.RUN_ERROR,
                message=f"Failed to process tool results: {str(e)}",
                code="TOOL_RESULT_PROCESSING_ERROR"
            )
    
    async def _extract_tool_results(
        self,
        input: RunAgentInput,
        candidate_messages: Optional[List[Any]] = None,
    ) -> List[Dict]:
        """入力からツール名付きツールメッセージを抽出

        candidate_messages で提供されたツールメッセージのみ抽出。
        候補が提供されていない場合、すべてのメッセージを考慮。

        Args:
            input: 実行入力
            candidate_messages: 検査するメッセージのサブセット（オプション）

        Returns:
            ツール名とメッセージを含む辞書のリスト（時系列順）
        """
        # tool_call_id からツール名へのマッピングを作成
        tool_call_map = {}
        for message in input.messages:
            if hasattr(message, 'tool_calls') and message.tool_calls:
                for tool_call in message.tool_calls:
                    tool_call_map[tool_call.id] = tool_call.function.name

        messages_to_check = candidate_messages or input.messages
        extracted_results: List[Dict] = []

        for message in messages_to_check:
            if hasattr(message, 'role') and message.role == "tool":
                tool_name = tool_call_map.get(getattr(message, 'tool_call_id', None), "unknown")
                logger.debug(
                    "Extracted ToolMessage: role=%s, tool_call_id=%s, content='%s'",
                    getattr(message, 'role', None),
                    getattr(message, 'tool_call_id', None),
                    getattr(message, 'content', None),
                )
                extracted_results.append({
                    'tool_name': tool_name,
                    'message': message
                })

        return extracted_results

    async def _stream_events(
        self, 
        execution: ExecutionState
    ) -> AsyncGenerator[BaseEvent, None]:
        """実行キューからイベントをストリーミング
        
        Args:
            execution: 実行状態
            
        Yields:
            キューからの AG-UI イベント
        """
        logger.debug(f"Starting _stream_events for thread {execution.thread_id}, queue ID: {id(execution.event_queue)}")
        event_count = 0
        timeout_count = 0
        
        while True:
            try:
                logger.debug(f"Waiting for event from queue (thread {execution.thread_id}, queue size: {execution.event_queue.qsize()})")
                
                # タイムアウト付きでイベントを待機
                event = await asyncio.wait_for(
                    execution.event_queue.get(),
                    timeout=1.0  # 毎秒チェック
                )
                
                event_count += 1
                logger.debug(f"Got event #{event_count} from queue: {type(event).__name__ if event else 'None'} (thread {execution.thread_id})")

                if event is None:
                    # 実行完了
                    execution.is_complete = True
                    logger.debug(f"Execution complete for thread {execution.thread_id} after {event_count} events")
                    break

                # RUN_ERROR はターミナルイベントなので、これ以降のイベントはストリーミングしない
                # (クライアント側の verifyEvents が RUN_ERROR 後のイベント送信を禁止している)
                if isinstance(event, RunErrorEvent) or getattr(event, "type", None) == EventType.RUN_ERROR:
                    logger.debug(
                        "Received RUN_ERROR for thread %s, stopping event stream",
                        execution.thread_id,
                    )
                    execution.is_complete = True
                    yield event
                    break
                
                logger.debug(f"Streaming event #{event_count}: {type(event).__name__} (thread {execution.thread_id})")
                yield event
                
            except asyncio.TimeoutError:
                timeout_count += 1
                logger.debug(f"Timeout #{timeout_count} waiting for events (thread {execution.thread_id}, task done: {execution.task.done()}, queue size: {execution.event_queue.qsize()})")
                
                # 実行が古くなっているかチェック
                if execution.is_stale(self._execution_timeout):
                    logger.error(f"Execution timed out for thread {execution.thread_id}")
                    execution.is_complete = True
                    yield RunErrorEvent(
                        type=EventType.RUN_ERROR,
                        message="Execution timed out",
                        code="EXECUTION_TIMEOUT"
                    )
                    break
                
                # タスクが完了しているかチェック
                if execution.task.done():
                    # タスク完了したが None を送信していない
                    execution.is_complete = True
                    try:
                        task_result = execution.task.result()
                        logger.debug(f"Task completed with result: {task_result} (thread {execution.thread_id})")
                    except Exception as e:
                        logger.debug(f"Task completed with exception: {e} (thread {execution.thread_id})")
                    
                    # まだイベントが来ている可能性があるのでもう少し待機
                    logger.debug(f"Task done but no None signal - checking queue one more time (thread {execution.thread_id}, queue size: {execution.event_queue.qsize()})")
                    if execution.event_queue.qsize() > 0:
                        logger.debug(f"Found {execution.event_queue.qsize()} events in queue after task completion, continuing...")
                        continue
                    
                    logger.debug(f"Task completed without sending None signal (thread {execution.thread_id})")
                    break
    
    async def _start_new_execution(
        self,
        input: RunAgentInput,
        *,
        tool_results: Optional[List[Dict]] = None,
        message_batch: Optional[List[Any]] = None,
    ) -> AsyncGenerator[BaseEvent, None]:
        """ツールサポート付きで新しい ADK 実行を開始

        Args:
            input: 実行入力

        Yields:
            実行からの AG-UI イベント
        """
        try:
            # RUN_STARTED を発行
            logger.debug(f"Emitting RUN_STARTED for thread {input.thread_id}, run {input.run_id}")
            yield RunStartedEvent(
                type=EventType.RUN_STARTED,
                thread_id=input.thread_id,
                run_id=input.run_id
            )
            
            # 同時実行制限をチェック
            async with self._execution_lock:
                if len(self._active_executions) >= self._max_concurrent:
                    # 古い実行をクリーンアップ
                    await self._cleanup_stale_executions()
                    
                    if len(self._active_executions) >= self._max_concurrent:
                        raise RuntimeError(
                            f"Maximum concurrent executions ({self._max_concurrent}) reached"
                        )
                
                # このスレッドに既存の実行があるかチェックし、完了を待機
                existing_execution = self._active_executions.get(input.thread_id)

            # 既存の実行があれば、完了を待機
            if existing_execution and not existing_execution.is_complete:
                logger.debug(f"Waiting for existing execution to complete for thread {input.thread_id}")
                try:
                    await existing_execution.task
                except Exception as e:
                    logger.debug(f"Previous execution completed with error: {e}")
            
            # バックグラウンド実行を開始
            execution = await self._start_background_execution(
                input,
                tool_results=tool_results,
                message_batch=message_batch,
            )
            
            # 実行を保存（以前のものを置換）
            async with self._execution_lock:
                self._active_executions[input.thread_id] = execution
            
            # イベントをストリーミングしツールコールを追跡
            logger.debug(f"Starting to stream events for execution {execution.thread_id}")
            has_tool_calls = False
            tool_call_ids = []
            run_errored = False

            logger.debug(f"About to iterate over _stream_events for execution {execution.thread_id}")
            async for event in self._stream_events(execution):
                if getattr(event, "type", None) == EventType.RUN_ERROR:
                    run_errored = True
                # HITL シナリオ用にツールコールを追跡
                if isinstance(event, ToolCallEndEvent):
                    logger.info(f"Detected ToolCallEndEvent with id: {event.tool_call_id}")
                    has_tool_calls = True
                    tool_call_ids.append(event.tool_call_id)

                # バックエンドツールは常に ToolCallResultEvent を発行
                # バックエンドツールの場合、pending_tools に tool_id を追加する必要なし
                if isinstance(event, ToolCallResultEvent) and event.tool_call_id in tool_call_ids:
                    logger.info(f"Detected ToolCallResultEvent with id: {event.tool_call_id}")
                    tool_call_ids.remove(event.tool_call_id)

                logger.debug(f"Yielding event: {type(event).__name__}")
                yield event

            logger.debug(f"Finished iterating over _stream_events for execution {execution.thread_id}")

            # ツールコールが見つかった場合、クリーンアップ前にセッション状態に追加
            if has_tool_calls:
                app_name = self._get_app_name(input)
                user_id = self._get_user_id(input)
                for tool_call_id in tool_call_ids:
                    await self._add_pending_tool_call_with_context(
                        execution.thread_id, tool_call_id, app_name, user_id
                    )
            logger.debug(f"Finished streaming events for execution {execution.thread_id}")
            
            # RUN_ERROR が発行された場合は RUN_FINISHED を発行しない
            # (クライアント側の verifyEvents が RUN_ERROR 後のイベント送信を禁止している)
            if not run_errored:
                logger.debug(f"Emitting RUN_FINISHED for thread {input.thread_id}, run {input.run_id}")
                yield RunFinishedEvent(
                    type=EventType.RUN_FINISHED,
                    thread_id=input.thread_id,
                    run_id=input.run_id
                )
            
        except Exception as e:
            logger.error(f"Error in new execution: {e}", exc_info=True)
            yield RunErrorEvent(
                type=EventType.RUN_ERROR,
                message=str(e),
                code="EXECUTION_ERROR"
            )
        finally:
            # 完了かつ保留ツールコールなし（HITL シナリオ）の場合、実行をクリーンアップ
            async with self._execution_lock:
                if input.thread_id in self._active_executions:
                    execution = self._active_executions[input.thread_id]
                    execution.is_complete = True
                    
                    # クリーンアップ前にセッションに保留ツールコールがあるかチェック
                    has_pending = await self._has_pending_tool_calls(input.thread_id)
                    if not has_pending:
                        del self._active_executions[input.thread_id]
                        logger.debug(f"Cleaned up execution for thread {input.thread_id}")
                    else:
                        logger.info(f"Preserving execution for thread {input.thread_id} - has pending tool calls (HITL scenario)")
    
    async def _start_background_execution(
        self,
        input: RunAgentInput,
        *,
        tool_results: Optional[List[Dict]] = None,
        message_batch: Optional[List[Any]] = None,
    ) -> ExecutionState:
        """ツールサポート付きでバックグラウンドで ADK 実行を開始

        Args:
            input: 実行入力

        Returns:
            バックグラウンド実行を追跡する ExecutionState
        """
        event_queue = asyncio.Queue()
        logger.debug(f"Created event queue {id(event_queue)} for thread {input.thread_id}")
        # 必要な情報を抽出
        user_id = self._get_user_id(input)
        app_name = self._get_app_name(input)
        
        # ADK エージェントを直接使用
        adk_agent = self._adk_agent
        
        # エージェントの変更を準備（SystemMessage とツール）
        agent_updates = {}
        
        # 最初のメッセージが SystemMessage の場合 - エージェントの instructions に追加
        if input.messages and isinstance(input.messages[0], SystemMessage):
            system_content = input.messages[0].content
            if system_content:
                current_instruction = getattr(adk_agent, 'instruction', '') or ''

                if callable(current_instruction):
                    # instructions プロバイダを処理
                    if inspect.iscoroutinefunction(current_instruction):
                        # 非同期 instruction プロバイダ
                        async def instruction_provider_wrapper_async(*args, **kwargs):
                            instructions = system_content
                            original_instructions = await current_instruction(*args, **kwargs) or ''
                            if original_instructions:
                                instructions = f"{original_instructions}\n\n{instructions}"
                            return instructions
                        new_instruction = instruction_provider_wrapper_async
                    else:
                        # 同期 instruction プロバイダ
                        def instruction_provider_wrapper_sync(*args, **kwargs):
                            instructions = system_content
                            original_instructions = current_instruction(*args, **kwargs) or ''
                            if original_instructions:
                                instructions = f"{original_instructions}\n\n{instructions}"
                            return instructions
                        new_instruction = instruction_provider_wrapper_sync

                    logger.debug(
                        f"Will wrap callable InstructionProvider and append SystemMessage: '{system_content[:100]}...'")
                else:
                    # 文字列 instructions を処理
                    if current_instruction:
                        new_instruction = f"{current_instruction}\n\n{system_content}"
                    else:
                        new_instruction = system_content
                    logger.debug(f"Will append SystemMessage to string instructions: '{system_content[:100]}...'")

                agent_updates['instruction'] = new_instruction

        # ツールが提供されている場合は動的ツールセットを作成し、ツール更新を準備
        toolset = None
        if input.tools:
            # エージェントから既存のツールを取得
            existing_tools = []
            if hasattr(adk_agent, 'tools') and adk_agent.tools:
                existing_tools = list(adk_agent.tools) if isinstance(adk_agent.tools, (list, tuple)) else [adk_agent.tools]
            
            # フロントエンドとバックエンドで同じツールが定義されている場合、エージェントはバックエンドツールのみを使用
            input_tools = []
            for input_tool in input.tools:
                # この入力ツールの名前が既存ツールと一致するかチェック
                # ADK が他のエージェントにハンドオフするために内部で使用する "transfer_to_agent" も除外
                if (not any(hasattr(existing_tool, '__name__') and input_tool.name == existing_tool.__name__
                        for existing_tool in existing_tools) and input_tool.name != 'transfer_to_agent'):
                    input_tools.append(input_tool)
                        
            toolset = ClientProxyToolset(
                ag_ui_tools=input_tools,
                event_queue=event_queue
            )

            # 既存ツールとプロキシツールセットを結合
            combined_tools = existing_tools + [toolset]
            agent_updates['tools'] = combined_tools
            logger.debug(f"Will combine {len(existing_tools)} existing tools with proxy toolset")
        
        # 変更が必要な場合、すべての更新でエージェントの単一コピーを作成
        if agent_updates:
            adk_agent = adk_agent.model_copy(update=agent_updates)
            logger.debug(f"Created modified agent copy with updates: {list(agent_updates.keys())}")
        
        # バックグラウンドタスクを作成
        logger.debug(f"Creating background task for thread {input.thread_id}")
        run_kwargs = {
            "input": input,
            "adk_agent": adk_agent,
            "user_id": user_id,
            "app_name": app_name,
            "event_queue": event_queue,
        }

        if tool_results is not None:
            run_kwargs["tool_results"] = tool_results

        if message_batch is not None:
            run_kwargs["message_batch"] = message_batch

        task = asyncio.create_task(self._run_adk_in_background(**run_kwargs))
        logger.debug(f"Background task created for thread {input.thread_id}: {task}")
        
        return ExecutionState(
            task=task,
            thread_id=input.thread_id,
            event_queue=event_queue
        )
    
    async def _run_adk_in_background(
        self,
        input: RunAgentInput,
        adk_agent: BaseAgent,
        user_id: str,
        app_name: str,
        event_queue: asyncio.Queue,
        tool_results: Optional[List[Dict]] = None,
        message_batch: Optional[List[Any]] = None,
    ):
        """バックグラウンドで ADK エージェントを実行し、キューにイベントを発行

        Args:
            input: 実行入力
            adk_agent: 実行する ADK エージェント（ツールと SystemMessage で準備済み）
            user_id: ユーザー ID
            app_name: アプリ名
            event_queue: イベント発行用キュー
        """
        runner: Optional[Runner] = None
        try:
            # エージェントは _start_background_execution でツールと SystemMessage instructions で既に準備済み
            # ここでの追加のエージェントコピーは不要

            # ランナーを作成
            runner = self._create_runner(
                adk_agent=adk_agent,
                user_id=user_id,
                app_name=app_name
            )

            # RunConfig を作成
            run_config = self._run_config_factory(input)

            # セッションが存在することを確認
            await self._ensure_session_exists(
                app_name, user_id, input.thread_id, input.state
            )

            # これは常にバックエンドの状態をフロントエンドの状態で更新
            # レシピデモ例: ingredients 状態に "salt" がある場合、フロントエンドでユーザーが UI から ingredients リストの salt を削除したら
            # バックエンドもこれらの状態変更を更新して両方の状態を同期
            await self._session_manager.update_session_state(input.thread_id,app_name,user_id,input.state)

            # メッセージを変換
            unseen_messages = message_batch if message_batch is not None else await self._get_unseen_messages(input)

            active_tool_results: Optional[List[Dict]] = tool_results
            if active_tool_results is None and await self._is_tool_result_submission(input, unseen_messages):
                active_tool_results = await self._extract_tool_results(input, unseen_messages)

            if active_tool_results:
                tool_messages = [result["message"] for result in active_tool_results]
                message_ids = self._collect_message_ids(tool_messages)
                if message_ids:
                    self._session_manager.mark_messages_processed(app_name, input.thread_id, message_ids)
            elif unseen_messages:
                message_ids = self._collect_message_ids(unseen_messages)
                if message_ids:
                    self._session_manager.mark_messages_processed(app_name, input.thread_id, message_ids)

            # まずユーザーメッセージを変換（あれば）
            user_message = await self._convert_latest_message(input, unseen_messages if message_batch is not None else None)

            # ユーザーによるツールレスポンス送信がある場合、まず FunctionResponse をセッションに追加
            if active_tool_results and user_message:
                # ツール結果とユーザーメッセージの両方がある
                # FunctionResponse を別のイベントとしてセッションに追加し、次にユーザーメッセージを送信
                function_response_parts = []
                for tool_msg in active_tool_results:
                    tool_call_id = tool_msg['message'].tool_call_id
                    content = tool_msg['message'].content

                    # デバッグ: 受信した実際のツールメッセージ内容をログ
                    logger.debug(f"Received tool result for call {tool_call_id}: content='{content}', type={type(content)}")

                    # JSON コンテンツをパース、空または無効な JSON を適切に処理
                    try:
                        if content and content.strip():
                            result = json.loads(content)
                        else:
                            # 空のコンテンツを空の結果で成功として処理
                            result = {"success": True, "result": None}
                            logger.warning(f"Empty tool result content for tool call {tool_call_id}, using empty success result")
                    except json.JSONDecodeError as json_error:
                        # 無効な JSON を詳細なエラー結果で処理
                        result = {
                            "error": f"Invalid JSON in tool result: {str(json_error)}",
                            "raw_content": content,
                            "error_type": "JSON_DECODE_ERROR",
                            "line": getattr(json_error, 'lineno', None),
                            "column": getattr(json_error, 'colno', None)
                        }
                        logger.error(f"Invalid JSON in tool result for call {tool_call_id}: {json_error} at line {getattr(json_error, 'lineno', '?')}, column {getattr(json_error, 'colno', '?')}")

                    updated_function_response_part = types.Part(
                        function_response=types.FunctionResponse(
                            id=tool_call_id,
                            name=tool_msg["tool_name"],
                            response=result,
                        )
                    )
                    function_response_parts.append(updated_function_response_part)

                # FunctionResponse を別のイベントとしてセッションに追加
                session = await self._session_manager.get_or_create_session(
                    session_id=input.thread_id,
                    app_name=app_name,
                    user_id=user_id,
                    initial_state=input.state
                )

                from google.adk.sessions.session import Event
                import time

                function_response_content = types.Content(parts=function_response_parts, role='user')
                function_response_event = Event(
                    timestamp=time.time(),
                    author='user',
                    content=function_response_content
                )

                session.events.append(function_response_event)

                # message_batch からのユーザーメッセージを処理済みにマーク
                if message_batch:
                    user_message_ids = self._collect_message_ids(message_batch)
                    if user_message_ids:
                        self._session_manager.mark_messages_processed(app_name, input.thread_id, user_message_ids)

                # ユーザーメッセージのみを new_message として使用
                new_message = user_message

            elif active_tool_results:
                # ユーザーメッセージなしのツール結果 - FunctionResponse のみを送信
                function_response_parts = []
                for tool_msg in active_tool_results:
                    tool_call_id = tool_msg['message'].tool_call_id
                    content = tool_msg['message'].content

                    logger.debug(f"Received tool result for call {tool_call_id}: content='{content}', type={type(content)}")

                    try:
                        if content and content.strip():
                            result = json.loads(content)
                        else:
                            result = {"success": True, "result": None}
                            logger.warning(f"Empty tool result content for tool call {tool_call_id}, using empty success result")
                    except json.JSONDecodeError as json_error:
                        result = {
                            "error": f"Invalid JSON in tool result: {str(json_error)}",
                            "raw_content": content,
                            "error_type": "JSON_DECODE_ERROR",
                            "line": getattr(json_error, 'lineno', None),
                            "column": getattr(json_error, 'colno', None)
                        }
                        logger.error(f"Invalid JSON in tool result for call {tool_call_id}: {json_error} at line {getattr(json_error, 'lineno', '?')}, column {getattr(json_error, 'colno', '?')}")

                    updated_function_response_part = types.Part(
                        function_response=types.FunctionResponse(
                            id=tool_call_id,
                            name=tool_msg["tool_name"],
                            response=result,
                        )
                    )
                    function_response_parts.append(updated_function_response_part)

                new_message = types.Content(parts=function_response_parts, role='user')
            else:
                # ツール結果なし、ユーザーメッセージのみを使用
                new_message = user_message

            # イベントトランスレーターを作成
            event_translator = EventTranslator()

            try:
                session = await self._session_manager.get_or_create_session(
                    session_id=input.thread_id,
                    app_name=app_name,
                    user_id=user_id,
                    initial_state=input.state
                )

                # セッションイベントをチェック（ADK は会話をイベントに保存）
                events = getattr(session, 'events', [])

                # FunctionResponse を送信する場合、セッション内の元の FunctionCall を探す
                if active_tool_results:
                    tool_call_id = active_tool_results[0]['message'].tool_call_id
                    found_call = False
                    for evt_idx, evt in enumerate(events):
                        evt_content = getattr(evt, 'content', None)
                        if evt_content:
                            evt_parts = getattr(evt_content, 'parts', [])
                            for part in evt_parts:
                                if hasattr(part, 'function_call'):
                                    fc = part.function_call
                                    if fc and hasattr(fc, 'id') and fc.id == tool_call_id:
                                        found_call = True
                                        break
                        if found_call:
                            break
            except Exception as e:
                pass

            # ADK エージェントを実行
            is_long_running_tool = False
            run_kwargs = {
                "user_id": user_id,
                "session_id": input.thread_id,
                "new_message": new_message,
                "run_config": run_config
            }

            async for adk_event in runner.run_async(**run_kwargs):
                event_invocation_id = getattr(adk_event, 'invocation_id', None)
                final_response = adk_event.is_final_response()
                has_content = adk_event.content and hasattr(adk_event.content, 'parts') and adk_event.content.parts

                # これが通常処理が必要なストリーミングチャンクかチェック
                is_streaming_chunk = (
                    getattr(adk_event, 'partial', False) or  # 明示的に partial としてマーク
                    (not getattr(adk_event, 'turn_complete', True)) or  # ライブストリーミング未完了
                    (not final_response)  # is_final_response() で final としてマークされていない
                )

                # 長時間実行ツールコールがある場合は LRO ルーティングを優先
                has_lro_function_call = False
                try:
                    lro_ids = set(getattr(adk_event, 'long_running_tool_ids', []) or [])
                    if lro_ids and adk_event.content and getattr(adk_event.content, 'parts', None):
                        for part in adk_event.content.parts:
                            func = getattr(part, 'function_call', None)
                            func_id = getattr(func, 'id', None) if func else None
                            if func_id and func_id in lro_ids:
                                has_lro_function_call = True
                                break
                except Exception:
                    # 保守的に: 検出に失敗した場合、ストリーミングパスをブロックしない
                    has_lro_function_call = False

                # チャンクの場合、またはコンテンツがあるが finish_reason がない場合はストリーミングとして処理
                # ただし LRO 関数呼び出しがない場合のみ（LRO が優先）
                if (not has_lro_function_call) and (is_streaming_chunk or (has_content and not getattr(adk_event, 'finish_reason', None))):
                    # 通常の変換パス
                    async for ag_ui_event in event_translator.translate(
                        adk_event,
                        input.thread_id,
                        input.run_id
                    ):

                        logger.debug(f"Emitting event to queue: {type(ag_ui_event).__name__} (thread {input.thread_id}, queue size before: {event_queue.qsize()})")
                        await event_queue.put(ag_ui_event)
                        logger.debug(f"Event queued: {type(ag_ui_event).__name__} (thread {input.thread_id}, queue size after: {event_queue.qsize()})")
                else:
                    # 長時間実行ツールイベントは通常 final response で発行
                    # ツールコールの前にアクティブなストリーミングテキストメッセージを閉じることを確認
                    async for end_event in event_translator.force_close_streaming_message():
                        await event_queue.put(end_event)
                        logger.debug(f"Event queued (forced close): {type(end_event).__name__} (thread {input.thread_id}, queue size after: {event_queue.qsize()})")

                    async for ag_ui_event in event_translator.translate_lro_function_calls(
                        adk_event
                    ):
                        await event_queue.put(ag_ui_event)
                        if ag_ui_event.type == EventType.TOOL_CALL_END:
                            is_long_running_tool = True
                        logger.debug(f"Event queued: {type(ag_ui_event).__name__} (thread {input.thread_id}, queue size after: {event_queue.qsize()})")
                    # 長時間実行ツールが見つかった場合は実行を強制停止
                    if is_long_running_tool:
                        return
            # ストリーミングメッセージを強制的に閉じる
            async for ag_ui_event in event_translator.force_close_streaming_message():
                await event_queue.put(ag_ui_event)
            # このエラーを避けるためテキストイベントのクローズ後に状態スナップショットイベントを移動
            # https://github.com/Contextable/ag-ui/issues/28
            final_state = await self._session_manager.get_session_state(input.thread_id,app_name,user_id)
            if final_state:
                ag_ui_event =  event_translator._create_state_snapshot_event(final_state)                    
                await event_queue.put(ag_ui_event)
            # 完了シグナル - ADK 実行完了
            logger.debug(f"Background task sending completion signal for thread {input.thread_id}")
            await event_queue.put(None)
            logger.debug(f"Background task completion signal sent for thread {input.thread_id}")
            
        except Exception as e:
            logger.error(f"Background execution error: {e}", exc_info=True)
            # エラーをキューに入れる
            await event_queue.put(
                RunErrorEvent(
                    type=EventType.RUN_ERROR,
                    message=str(e),
                    code="BACKGROUND_EXECUTION_ERROR"
                )
            )
            await event_queue.put(None)
        finally:
            # バックグラウンドタスクのクリーンアップ完了
            # ADK ランナーがリソース（ツールセットなど）を解放することを確認
            if runner is not None:
                close_method = getattr(runner, "close", None)
                if close_method is not None:
                    try:
                        close_result = close_method()
                        if inspect.isawaitable(close_result):
                            await close_result
                    except Exception as close_error:
                        logger.warning(
                            "Error while closing ADK runner for thread %s: %s",
                            input.thread_id,
                            close_error,
                        )
    
    async def _cleanup_stale_executions(self):
        """古い実行をクリーンアップ"""
        stale_threads = []
        
        for thread_id, execution in self._active_executions.items():
            if execution.is_stale(self._execution_timeout):
                stale_threads.append(thread_id)
        
        for thread_id in stale_threads:
            execution = self._active_executions.pop(thread_id)
            await execution.cancel()
            logger.info(f"Cleaned up stale execution for thread {thread_id}")

    async def close(self):
        """アクティブな実行を含むリソースをクリーンアップ"""
        # すべてのアクティブな実行をキャンセル
        async with self._execution_lock:
            for execution in self._active_executions.values():
                await execution.cancel()
            self._active_executions.clear()

        # セッションルックアップキャッシュをクリア
        self._session_lookup_cache.clear()

        # セッションマネージャーのクリーンアップタスクを停止
        await self._session_manager.stop_cleanup_task()
