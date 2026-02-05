# ツールサポート付きバックグラウンド ADK 実行の状態管理

import asyncio
import time
from typing import Optional, Set
import logging

logger = logging.getLogger(__name__)


class ExecutionState:
    """バックグラウンド ADK 実行の状態を管理

    このクラスは以下を追跡:
    - ADK エージェントを実行するバックグラウンド asyncio タスク
    - クライアントへストリーミングするイベントキュー
    - 実行時間と完了状態
    """

    def __init__(
        self,
        task: asyncio.Task,
        thread_id: str,
        event_queue: asyncio.Queue
    ):
        """実行状態を初期化

        Args:
            task: ADK エージェントを実行する asyncio タスク
            thread_id: この実行のスレッド ID
            event_queue: クライアントにストリーミングするイベントを含むキュー
        """
        self.task = task
        self.thread_id = thread_id
        self.event_queue = event_queue
        self.start_time = time.time()
        self.is_complete = False
        self.pending_tool_calls: Set[str] = set()  # Track outstanding tool call IDs for HITL

        logger.debug(f"Created execution state for thread {thread_id}")

    def is_stale(self, timeout_seconds: int) -> bool:
        """実行が長すぎるかどうかをチェック

        Args:
            timeout_seconds: 最大実行時間（秒）

        Returns:
            タイムアウトを超えた場合 True
        """
        return time.time() - self.start_time > timeout_seconds

    async def cancel(self):
        """実行をキャンセルしてリソースをクリーンアップ"""
        logger.info(f"Cancelling execution for thread {self.thread_id}")

        # Cancel the background task
        if not self.task.done():
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass

        self.is_complete = True

    def get_execution_time(self) -> float:
        """合計実行時間を秒で取得

        Returns:
            実行開始からの経過秒数
        """
        return time.time() - self.start_time

    def add_pending_tool_call(self, tool_call_id: str):
        """ツールコール ID を保留セットに追加

        Args:
            tool_call_id: 追跡するツールコール ID
        """
        self.pending_tool_calls.add(tool_call_id)
        logger.debug(f"Added pending tool call {tool_call_id} to thread {self.thread_id}")

    def remove_pending_tool_call(self, tool_call_id: str):
        """ツールコール ID を保留セットから削除

        Args:
            tool_call_id: 削除するツールコール ID
        """
        self.pending_tool_calls.discard(tool_call_id)
        logger.debug(f"Removed pending tool call {tool_call_id} from thread {self.thread_id}")

    def has_pending_tool_calls(self) -> bool:
        """応答待ちのツールコールがあるかチェック

        Returns:
            保留中のツールコールがある場合 True（HITL シナリオ）
        """
        return len(self.pending_tool_calls) > 0

    def get_status(self) -> str:
        """実行の人間可読なステータスを取得

        Returns:
            現在の状態を表す文字列
        """
        if self.is_complete:
            if self.has_pending_tool_calls():
                return "complete_awaiting_tools"
            else:
                return "complete"
        elif self.task.done():
            return "task_done"
        else:
            return "running"

    def __repr__(self) -> str:
        """実行状態の文字列表現"""
        return (
            f"ExecutionState(thread_id='{self.thread_id}', "
            f"status='{self.get_status()}', "
            f"runtime={self.get_execution_time():.1f}s)"
        )