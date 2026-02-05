# AG-UI と ADK フォーマット間の変換ユーティリティ

from typing import List, Dict, Any, Optional
import json
import logging

from ag_ui.core import (
    Message, UserMessage, AssistantMessage, SystemMessage, ToolMessage,
    ToolCall, FunctionCall, TextInputContent, BinaryInputContent
)
from google.adk.events import Event as ADKEvent
from google.genai import types

logger = logging.getLogger(__name__)


def convert_ag_ui_messages_to_adk(messages: List[Message]) -> List[ADKEvent]:
    """AG-UI メッセージを ADK イベントに変換
    
    Args:
        messages: AG-UI メッセージのリスト
        
    Returns:
        ADK イベントのリスト
    """
    adk_events = []
    
    for message in messages:
        try:
            # ベースイベントを作成
            event = ADKEvent(
                id=message.id,
                author=message.role,
                content=None
            )
            
            # メッセージタイプに基づいてコンテンツを変換
            if isinstance(message, (UserMessage, SystemMessage)):
                flattened_content = flatten_message_content(message.content)
                if flattened_content:
                    event.content = types.Content(
                        role=message.role,
                        parts=[types.Part(text=flattened_content)]
                    )

            elif isinstance(message, AssistantMessage):
                parts = []

                # テキストコンテンツがあれば追加
                if message.content:
                    parts.append(types.Part(text=flatten_message_content(message.content)))
                
                # ツールコールがあれば追加
                if message.tool_calls:
                    for tool_call in message.tool_calls:
                        parts.append(types.Part(
                            function_call=types.FunctionCall(
                                name=tool_call.function.name,
                                args=json.loads(tool_call.function.arguments) if isinstance(tool_call.function.arguments, str) else tool_call.function.arguments,
                                id=tool_call.id
                            )
                        ))
                
                if parts:
                    event.content = types.Content(
                        role="model",  # ADK はアシスタントに "model" を使用
                        parts=parts
                    )
            
            elif isinstance(message, ToolMessage):
                # ツールメッセージは関数レスポンスになる
                event.content = types.Content(
                    role="function",
                    parts=[types.Part(
                        function_response=types.FunctionResponse(
                            name=message.tool_call_id, 
                            response={"result": message.content} if isinstance(message.content, str) else message.content,
                            id=message.tool_call_id
                        )
                    )]
                )
            
            adk_events.append(event)
            
        except Exception as e:
            logger.error(f"Error converting message {message.id}: {e}")
            continue
    
    return adk_events


def convert_adk_event_to_ag_ui_message(event: ADKEvent) -> Optional[Message]:
    """ADK イベントを AG-UI メッセージに変換
    
    Args:
        event: ADK イベント
        
    Returns:
        AG-UI メッセージ、または変換不可の場合は None
    """
    try:
        # コンテンツのないイベントはスキップ
        if not event.content or not event.content.parts:
            return None
        
        # author/role に基づいてメッセージタイプを決定
        if event.author == "user":
            # テキストコンテンツを抽出
            text_parts = [part.text for part in event.content.parts if part.text]
            if text_parts:
                return UserMessage(
                    id=event.id,
                    role="user",
                    content="\n".join(text_parts)
                )
        
        else:  # アシスタント/モデルのレスポンス
            # テキストとツールコールを抽出
            text_parts = []
            tool_calls = []
            
            for part in event.content.parts:
                if part.text:
                    text_parts.append(part.text)
                elif part.function_call:
                    tool_calls.append(ToolCall(
                        id=getattr(part.function_call, 'id', event.id),
                        type="function",
                        function=FunctionCall(
                            name=part.function_call.name,
                            arguments=json.dumps(part.function_call.args) if hasattr(part.function_call, 'args') else "{}"
                        )
                    ))
            
            return AssistantMessage(
                id=event.id,
                role="assistant",
                content="\n".join(text_parts) if text_parts else None,
                tool_calls=tool_calls if tool_calls else None
            )
        
    except Exception as e:
        logger.error(f"Error converting ADK event {event.id}: {e}")
    
    return None


def convert_state_to_json_patch(state_delta: Dict[str, Any]) -> List[Dict[str, Any]]:
    """状態デルタを JSON Patch フォーマット（RFC 6902）に変換
    
    Args:
        state_delta: 状態変更の辞書
        
    Returns:
        JSON Patch 操作のリスト
    """
    patches = []
    
    for key, value in state_delta.items():
        # 操作タイプを決定
        if value is None:
            # 削除操作
            patches.append({
                "op": "remove",
                "path": f"/{key}"
            })
        else:
            # 追加/置換操作
            # 既存キーと新規キーの両方に対応するため "replace" を使用
            patches.append({
                "op": "replace",
                "path": f"/{key}",
                "value": value
            })
    
    return patches


def convert_json_patch_to_state(patches: List[Dict[str, Any]]) -> Dict[str, Any]:
    """JSON Patch 操作を状態デルタ辞書に変換
    
    Args:
        patches: JSON Patch 操作のリスト
        
    Returns:
        状態変更の辞書
    """
    state_delta = {}
    
    for patch in patches:
        op = patch.get("op")
        path = patch.get("path", "")
        
        # パスからキーを抽出（先頭のスラッシュを削除）
        key = path.lstrip("/")
        
        if op == "remove":
            state_delta[key] = None
        elif op in ["add", "replace"]:
            state_delta[key] = patch.get("value")
        # 他の操作は今のところ無視（copy, move, test）
    
    return state_delta


def extract_text_from_content(content: types.Content) -> str:
    """ADK Content オブジェクトからすべてのテキストを抽出"""
    if not content or not content.parts:
        return ""

    text_parts = []
    for part in content.parts:
        if part.text:
            text_parts.append(part.text)

    return "\n".join(text_parts)


def flatten_message_content(content: Any) -> str:
    if content is None:
        return ""

    if isinstance(content, str):
        return content

    if isinstance(content, list):
        text_parts = [part.text for part in content if isinstance(part, TextInputContent) and part.text]
        return "\n".join(text_parts)

    return str(content)


def create_error_message(error: Exception, context: str = "") -> str:
    """ユーザーフレンドリーなエラーメッセージを作成
    
    Args:
        error: 例外
        context: エラー発生場所に関する追加コンテキスト
        
    Returns:
        フォーマット済みエラーメッセージ
    """
    error_type = type(error).__name__
    error_msg = str(error)
    
    if context:
        return f"{context}: {error_type} - {error_msg}"
    else:
        return f"{error_type}: {error_msg}"
