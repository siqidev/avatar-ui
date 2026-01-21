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


def _ensure_data_dir() -> None:
    """dataディレクトリが存在しなければ作成する。"""
    if not os.path.exists(_DATA_DIR):
        os.makedirs(_DATA_DIR)


def _empty_state() -> dict:
    """空の状態を返す。"""
    return {
        "input": None,
        "plan": {
            "purpose": None,
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


def update_action(state: dict, phase: str, summary: str) -> dict:
    """行動状態を更新する。"""
    state["action"] = {
        "phase": phase,
        "summary": summary,
    }
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


# --- 計画操作 ---


def set_purpose(state: dict, purpose: str) -> dict:
    """目的を設定する。"""
    state["plan"]["purpose"] = purpose
    return state


def add_goal(state: dict, goal_id: str, name: str, tasks: Optional[list] = None) -> dict:
    """目標を追加する。"""
    goal = {
        "id": goal_id,
        "name": name,
        "status": "active",
        "tasks": tasks or [],
    }
    state["plan"]["goals"].append(goal)
    return state


def add_task(state: dict, goal_id: str, task_id: str, name: str) -> dict:
    """タスクを追加する。"""
    for goal in state["plan"]["goals"]:
        if goal["id"] == goal_id:
            task = {
                "id": task_id,
                "name": name,
                "status": "pending",
            }
            goal["tasks"].append(task)
            break
    return state


def update_task_status(state: dict, task_id: str, status: str) -> dict:
    """タスクのステータスを更新する。"""
    for goal in state["plan"]["goals"]:
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
    for i, goal in enumerate(state["plan"]["goals"]):
        if goal["id"] == goal_id:
            goal["status"] = "done"
            return state["plan"]["goals"].pop(i)
    return None
