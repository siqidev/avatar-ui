# AG-UI プロトコルツール用クライアントサイドプロキシツールの実装

import asyncio
import json
import uuid
import inspect
from typing import Any, Optional, List, Dict
import logging

from google.adk.tools import BaseTool, LongRunningFunctionTool
from google.genai import types
from ag_ui.core import Tool as AGUITool, EventType
from ag_ui.core import (
    ToolCallStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent
)

logger = logging.getLogger(__name__)



class ClientProxyTool(BaseTool):
    """AG-UI プロトコルツールを ADK に橋渡しするプロキシツール

    このツールはエージェントには通常の ADK ツールとして見えるが、
    実行されると AG-UI プロトコルイベントを発行し、
    クライアントが実際のツールを実行して結果を返すのを待つ。

    内部的には適切な ADK 動作のために LongRunningFunctionTool をラップ。
    """

    def __init__(
        self,
        ag_ui_tool: AGUITool,
        event_queue: asyncio.Queue
    ):
        """クライアントプロキシツールを初期化

        Args:
            ag_ui_tool: AG-UI ツール定義
            event_queue: AG-UI イベントを発行するキュー
        """
        # 名前と説明で BaseTool を初期化
        # アーキテクチャ上の簡潔さのため、すべてのクライアントサイドツールは長時間実行
        super().__init__(
            name=ag_ui_tool.name,
            description=ag_ui_tool.description,
            is_long_running=True
        )

        self.ag_ui_tool = ag_ui_tool
        self.event_queue = event_queue

        # ADK 検査用の適切なパラメータシグネチャを持つ動的関数を作成
        # これにより ADK はユーザーリクエストからパラメータを正しく抽出できる
        sig_params = []

        # AG-UI ツールスキーマからパラメータを抽出
        parameters = ag_ui_tool.parameters
        if isinstance(parameters, dict) and 'properties' in parameters:
            for param_name in parameters['properties'].keys():
                # 適切な型注釈でパラメータを作成
                sig_params.append(
                    inspect.Parameter(
                        param_name,
                        inspect.Parameter.KEYWORD_ONLY,
                        default=None,
                        annotation=Any
                    )
                )

        # LongRunningFunctionTool にラップされる非同期関数を作成
        async def proxy_tool_func(**kwargs) -> Any:
            # run_async に保存された元の args と tool_context にアクセス
            original_args = getattr(self, '_current_args', kwargs)
            original_tool_context = getattr(self, '_current_tool_context', None)
            return await self._execute_proxy_tool(original_args, original_tool_context)

        # AG-UI ツールに合わせて関数名、docstring、シグネチャを設定
        proxy_tool_func.__name__ = ag_ui_tool.name
        proxy_tool_func.__doc__ = ag_ui_tool.description

        # 抽出したパラメータで新しいシグネチャを作成
        if sig_params:
            proxy_tool_func.__signature__ = inspect.Signature(sig_params)

        # 適切な動作のための内部 LongRunningFunctionTool を作成
        self._long_running_tool = LongRunningFunctionTool(proxy_tool_func)

    def _get_declaration(self) -> Optional[types.FunctionDeclaration]:
        """AG-UI ツールパラメータから FunctionDeclaration を作成

        ラップしたツールに委譲せずにオーバーライドするのは、
        ADK の自動関数呼び出しが適切な型注釈なしに動的に作成した
        関数シグネチャを解析するのが困難なため。
        """
        logger.debug(f"_get_declaration called for {self.name}")
        logger.debug(f"AG-UI tool parameters: {self.ag_ui_tool.parameters}")

        # AG-UI パラメータ（JSON Schema）を ADK フォーマットに変換
        parameters = self.ag_ui_tool.parameters


        # 適切なオブジェクトスキーマであることを確認
        if not isinstance(parameters, dict):
            parameters = {"type": "object", "properties": {}}
            logger.warning(f"Tool {self.name} had non-dict parameters, using empty schema")

        # FunctionDeclaration を作成
        function_declaration = types.FunctionDeclaration(
            name=self.name,
            description=self.description,
            parameters=types.Schema.model_validate(parameters)
        )
        logger.debug(f"Created FunctionDeclaration for {self.name}: {function_declaration}")
        return function_declaration

    async def run_async(
        self,
        *,
        args: dict[str, Any],
        tool_context: Any
    ) -> Any:
        """内部の LongRunningFunctionTool に委譲してツールを実行

        Args:
            args: ツールコールの引数
            tool_context: ADK ツールコンテキスト

        Returns:
            長時間実行ツールの場合は None（クライアントが実行を処理）
        """
        # プロキシ関数アクセス用に args と context を保存
        self._current_args = args
        self._current_tool_context = tool_context

        # ラップした長時間実行ツールに委譲
        return await self._long_running_tool.run_async(args=args, tool_context=tool_context)

    async def _execute_proxy_tool(self, args: Dict[str, Any], tool_context: Any) -> Any:
        """プロキシツールロジックを実行 - イベントを発行して None を返す

        Args:
            args: ADK からのツール引数
            tool_context: ADK ツールコンテキスト

        Returns:
            長時間実行ツールの場合は None
        """
        logger.debug(f"Proxy tool execution: {self.ag_ui_tool.name}")
        logger.debug(f"Arguments received: {args}")
        logger.debug(f"Tool context type: {type(tool_context)}")

        # 利用可能であれば ADK が生成した関数コール ID を抽出
        adk_function_call_id = None
        if tool_context and hasattr(tool_context, 'function_call_id'):
            adk_function_call_id = tool_context.function_call_id
            logger.debug(f"Using ADK function_call_id: {adk_function_call_id}")

        # ADK ID が利用可能ならそれを使用、そうでなければ生成した ID にフォールバック
        tool_call_id = adk_function_call_id or f"call_{uuid.uuid4().hex[:8]}"
        if not adk_function_call_id:
            logger.warning(f"ADK function_call_id not available, generated: {tool_call_id}")

        try:
            # TOOL_CALL_START イベントを発行
            start_event = ToolCallStartEvent(
                type=EventType.TOOL_CALL_START,
                tool_call_id=tool_call_id,
                tool_call_name=self.ag_ui_tool.name
            )
            await self.event_queue.put(start_event)
            logger.debug(f"Emitted TOOL_CALL_START for {tool_call_id}")

            # TOOL_CALL_ARGS イベントを発行
            args_json = json.dumps(args)
            args_event = ToolCallArgsEvent(
                type=EventType.TOOL_CALL_ARGS,
                tool_call_id=tool_call_id,
                delta=args_json
            )
            await self.event_queue.put(args_event)
            logger.debug(f"Emitted TOOL_CALL_ARGS for {tool_call_id}")

            # TOOL_CALL_END イベントを発行
            end_event = ToolCallEndEvent(
                type=EventType.TOOL_CALL_END,
                tool_call_id=tool_call_id
            )
            await self.event_queue.put(end_event)
            logger.debug(f"Emitted TOOL_CALL_END for {tool_call_id}")

            # 長時間実行ツールは None を返す - クライアントが実際の実行を処理
            logger.debug(f"Returning None for long-running tool {tool_call_id}")
            return None

        except Exception as e:
            logger.error(f"Error in proxy tool execution for {tool_call_id}: {e}")
            raise

    def __repr__(self) -> str:
        """プロキシツールの文字列表現"""
        return f"ClientProxyTool(name='{self.name}', ag_ui_tool='{self.ag_ui_tool.name}')"