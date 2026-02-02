#!/usr/bin/env python3
"""
状態管理モジュール。
state.json と events.jsonl の読み書きを担当する。
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Optional

# データディレクトリとファイルパス
_BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
_DATA_DIR = os.path.join(_BASE_DIR, "data")
_STATE_PATH = os.path.join(_DATA_DIR, "state.json")
_EVENTS_PATH = os.path.join(_DATA_DIR, "events.jsonl")
_LOGS_DIR = os.path.join(_DATA_DIR, "logs")
_CONSOLE_LOG_PATH = os.path.join(_LOGS_DIR, "console.jsonl")


def _ensure_data_dir() -> None:
    """dataディレクトリが存在しなければ作成する。"""
    if not os.path.exists(_DATA_DIR):
        os.makedirs(_DATA_DIR)


def _ensure_logs_dir() -> None:
    """logsディレクトリが存在しなければ作成する。"""
    _ensure_data_dir()
    if not os.path.exists(_LOGS_DIR):
        os.makedirs(_LOGS_DIR)


def _empty_state() -> dict:
    """空の状態を返す。"""
    return {
        "input": None,
        "mission": {
            "purpose": None,
            "purpose_type": None,
            "goals": [],
        },
        "thought": None,
        "action": None,
        "result": None,
    }


def load_state() -> dict:
    """
    state.jsonを読み込む。
    ファイルが存在しない場合は空の状態を返す。
    読み込み失敗時は例外を投げる（fail-fast）。
    """
    _ensure_data_dir()
    if not os.path.exists(_STATE_PATH):
        return _empty_state()
    with open(_STATE_PATH, encoding="utf-8") as f:
        content = f.read().strip()
        if not content:
            return _empty_state()
        return json.loads(content)


def save_state(state: dict) -> None:
    """
    state.jsonに状態を保存する（全上書き）。
    書き込み失敗時は例外を投げる（fail-fast）。
    """
    _ensure_data_dir()
    with open(_STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def _utc_now() -> str:
    """現在のUTC時刻をISO 8601形式で返す。"""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def append_event(event_type: str, **fields: Any) -> None:
    """
    events.jsonlにイベントを追記する。
    書き込み失敗時は例外を投げる（fail-fast）。
    """
    _ensure_data_dir()
    event = {"time": _utc_now(), "type": event_type, **fields}
    with open(_EVENTS_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")


def append_console_log(**fields: Any) -> None:
    """
    console.jsonlにコンソール出力ログを追記する。
    書き込み失敗時は例外を投げる（fail-fast）。
    """
    _ensure_logs_dir()
    entry = {"time": _utc_now(), **fields}
    with open(_CONSOLE_LOG_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


# --- 状態更新ヘルパー ---


def update_input(state: dict, source: str, authority: str, text: str) -> dict:
    """入力状態を更新する。"""
    state["input"] = {
        "source": source,
        "authority": authority,
        "text": text,
    }
    return state


def update_thought(state: dict, judgment: str, intent: str) -> dict:
    """思考状態を更新する。"""
    state["thought"] = {
        "judgment": judgment,
        "intent": intent,
    }
    return state


def update_action(
    state: dict,
    phase: str,
    summary: str,
    command: str = None,
    data: Optional[dict] = None,
) -> dict:
    """行動状態を更新する。"""
    state["action"] = {
        "phase": phase,
        "summary": summary,
        "command": command,
    }
    if data is not None:
        state["action"]["data"] = data
    return state


def update_result(state: dict, status: str, summary: str) -> dict:
    """結果状態を更新する。"""
    state["result"] = {
        "status": status,
        "summary": summary,
    }
    return state


def clear_action(state: dict) -> dict:
    """行動状態をクリアする。"""
    state["action"] = None
    return state


def clear_result(state: dict) -> dict:
    """結果状態をクリアする。"""
    state["result"] = None
    return state


# --- ミッション操作 ---


def set_purpose(state: dict, purpose: str) -> dict:
    """目的を設定する。"""
    state["mission"]["purpose"] = purpose
    state["mission"]["purpose_type"] = None
    state["mission"]["goals"] = []
    return state


def add_goal(
    state: dict,
    goal_id: str,
    name: str,
    tasks: Optional[list] = None,
    status: str = "active",
) -> dict:
    """目標を追加する。"""
    goal = {
        "id": goal_id,
        "name": name,
        "status": status,
        "tasks": tasks or [],
    }
    state["mission"]["goals"].append(goal)
    return state


def add_task(
    state: dict,
    goal_id: str,
    task_id: str,
    name: str,
    trigger: Optional[str] = None,
    response: Optional[str] = None,
) -> dict:
    """タスクを追加する。重複IDは無視。trigger/responseはオプション。"""
    for goal in state["mission"]["goals"]:
        if goal["id"] == goal_id:
            # 重複チェック
            existing_ids = {t["id"] for t in goal["tasks"]}
            if task_id in existing_ids:
                return state  # 重複は無視
            task = {
                "id": task_id,
                "name": name,
                "status": "pending",
            }
            if trigger:
                task["trigger"] = trigger
            if response:
                task["response"] = response
            goal["tasks"].append(task)
            break
    return state


def update_task_status(state: dict, task_id: str, status: str) -> dict:
    """タスクのステータスを更新する。"""
    for goal in state["mission"]["goals"]:
        for task in goal["tasks"]:
            if task["id"] == task_id:
                task["status"] = status
                return state
    return state


def complete_goal(state: dict, goal_id: str) -> Optional[dict]:
    """
    目標を完了としてマークし、goalsから除去する。
    除去された目標を返す（events.jsonlに記録するため）。
    """
    for i, goal in enumerate(state["mission"]["goals"]):
        if goal["id"] == goal_id:
            goal["status"] = "done"
            return state["mission"]["goals"].pop(i)
    return None
