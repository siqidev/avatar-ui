# クライアントサイドツール用の動的ツールセット作成

import asyncio
from typing import List, Optional
import logging

from google.adk.tools import BaseTool
from google.adk.tools.base_toolset import BaseToolset
from google.adk.agents.readonly_context import ReadonlyContext
from ag_ui.core import Tool as AGUITool

from .client_proxy_tool import ClientProxyTool

logger = logging.getLogger(__name__)


class ClientProxyToolset(BaseToolset):
    """AG-UI ツール定義からプロキシツールを作成する動的ツールセット

    このツールセットは RunAgentInput で提供されたツールに基づいて
    各実行ごとに作成され、リクエストごとに動的なツール利用を可能にする。
    """

    def __init__(
        self,
        ag_ui_tools: List[AGUITool],
        event_queue: asyncio.Queue
    ):
        """クライアントプロキシツールセットを初期化

        Args:
            ag_ui_tools: AG-UI ツール定義のリスト
            event_queue: AG-UI イベントを発行するキュー
        """
        super().__init__()
        self.ag_ui_tools = ag_ui_tools
        self.event_queue = event_queue

        logger.info(f"Initialized ClientProxyToolset with {len(ag_ui_tools)} tools (all long-running)")

    async def get_tools(
        self,
        readonly_context: Optional[ReadonlyContext] = None
    ) -> List[BaseTool]:
        """このツールセットのすべてのプロキシツールを取得

        現在のイベントキュー参照で、各 AG-UI ツール定義の
        新しい ClientProxyTool インスタンスを作成。

        Args:
            readonly_context: ツールフィルタリング用のオプションコンテキスト（現在未使用）

        Returns:
            ClientProxyTool インスタンスのリスト
        """
        # 古いキュー参照を避けるため毎回新しいプロキシツールを作成
        proxy_tools = []

        for ag_ui_tool in self.ag_ui_tools:
            try:
                proxy_tool = ClientProxyTool(
                    ag_ui_tool=ag_ui_tool,
                    event_queue=self.event_queue
                )
                proxy_tools.append(proxy_tool)
                logger.debug(f"Created proxy tool for '{ag_ui_tool.name}' (long-running)")

            except Exception as e:
                logger.error(f"Failed to create proxy tool for '{ag_ui_tool.name}': {e}")
                # 完全に失敗するのではなく、他のツールを続行

        return proxy_tools

    async def close(self) -> None:
        """ツールセットが保持するリソースをクリーンアップ"""
        logger.info("Closing ClientProxyToolset")

    def __repr__(self) -> str:
        """ツールセットの文字列表現"""
        tool_names = [tool.name for tool in self.ag_ui_tools]
        return f"ClientProxyToolset(tools={tool_names}, all_long_running=True)"