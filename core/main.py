#!/usr/bin/env python3
"""
Avatar Core API Server.
全てのチャネルはここを経由し、xai-sdkはここでのみ使う。
"""
from __future__ import annotations

import copy
import json
import os
import platform
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from pathlib import Path
from typing import Optional

import yaml
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from xai_sdk import Client
from xai_sdk.chat import system, user
from xai_sdk.tools import web_search, x_search

from core.state import (
    load_state,
    save_state,
    append_event,
    append_console_log,
    update_input,
    update_thought,
    update_action,
    update_result,
    clear_action,
    clear_result,
    set_purpose,
    add_goal,
    add_task,
    update_task_status,
    complete_goal,
)
from core.exec import (
    Authority,
    Backend,
    ExecRequest,
    ExecResult,
    ExecStatus,
    BackendRouter,
    get_avatar_space,
)

# .envを読み込み、ローカル開発の環境変数を使えるようにする。
load_dotenv()

# config.yamlはプロジェクトルート直下を正本とする。
_BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
_DEFAULT_CONFIG_PATH = os.path.join(_BASE_DIR, "config.yaml")
CONFIG_PATH = os.getenv("AVATAR_CONFIG", _DEFAULT_CONFIG_PATH)
# 設定ファイルが存在しない場合は起動時に止める。
if not os.path.exists(CONFIG_PATH):
    raise RuntimeError(f"config file not found: {CONFIG_PATH}")


def _load_config() -> dict:
    # モデル名や人格などの「正本」を読む。
    with open(CONFIG_PATH, encoding="utf-8") as f:
        config = yaml.safe_load(f)
    # 設定が空や不正な型なら起動を止める。
    if not isinstance(config, dict):
        raise RuntimeError("config must be a mapping")
    # 必須セクションを検証する。
    for section in ("avatar", "user", "grok"):
        if section not in config:
            raise RuntimeError(f"{section} section is missing in config")
    if "system_prompt" not in config:
        raise RuntimeError("system_prompt is missing in config")
    # userセクションの必須キーを検証する。
    user = config["user"]
    if not isinstance(user, dict):
        raise RuntimeError("user must be a mapping")
    if "name" not in user:
        raise RuntimeError("user.name is missing in config")
    if "language" not in user:
        raise RuntimeError("user.language is missing in config")
    language = user.get("language")
    if not isinstance(language, str):
        raise RuntimeError("user.language must be a string")
    language = language.strip().lower()
    if language not in ("ja", "en"):
        raise RuntimeError("user.language must be one of: ja, en")
    user["language"] = language
    # 任意: 言語選択肢
    language_options = user.get("language_options")
    if language_options is None:
        user["language_options"] = [language]
    else:
        if not isinstance(language_options, list) or not language_options:
            raise RuntimeError("user.language_options must be a non-empty list")
        cleaned_languages = []
        for lang in language_options:
            if not isinstance(lang, str):
                raise RuntimeError("user.language_options must contain strings")
            lang = lang.strip().lower()
            if lang not in ("ja", "en"):
                raise RuntimeError("user.language_options must be one of: ja, en")
            cleaned_languages.append(lang)
        user["language_options"] = cleaned_languages
        if language not in user["language_options"]:
            raise RuntimeError("user.language must be included in user.language_options")

    # grokセクションの必須キーを検証する。
    grok = config["grok"]
    if not isinstance(grok, dict):
        raise RuntimeError("grok must be a mapping")
    for key in ("model", "temperature"):
        if key not in grok:
            raise RuntimeError(f"grok.{key} is missing in config")
    if not isinstance(grok["temperature"], (int, float)):
        raise RuntimeError("grok.temperature must be a number")
    if not 0.0 <= float(grok["temperature"]) <= 2.0:
        raise RuntimeError("grok.temperature must be between 0.0 and 2.0")
    # 任意: モデル候補リスト
    models = grok.get("models")
    if models is None:
        grok["models"] = [grok["model"]]
    else:
        if not isinstance(models, list) or not models:
            raise RuntimeError("grok.models must be a non-empty list")
        cleaned_models = []
        for model in models:
            if not isinstance(model, str) or not model.strip():
                raise RuntimeError("grok.models must contain non-empty strings")
            cleaned_models.append(model.strip())
        grok["models"] = cleaned_models
        if grok["model"] not in grok["models"]:
            raise RuntimeError("grok.model must be included in grok.models")
    # 任意: 温度プリセット
    temp_presets = grok.get("temperature_presets")
    if temp_presets is None:
        grok["temperature_presets"] = [float(grok["temperature"])]
    else:
        if not isinstance(temp_presets, list) or not temp_presets:
            raise RuntimeError("grok.temperature_presets must be a non-empty list")
        cleaned_temps = []
        for value in temp_presets:
            if not isinstance(value, (int, float)):
                raise RuntimeError("grok.temperature_presets must contain numbers")
            if not 0.0 <= float(value) <= 2.0:
                raise RuntimeError("grok.temperature_presets values must be between 0.0 and 2.0")
            cleaned_temps.append(round(float(value), 1))
        grok["temperature_presets"] = cleaned_temps
    # search_web / search_x は任意だが、指定されている場合は値を検証する。
    for key in ("search_web", "search_x"):
        value = grok.get(key, "on")
        if not isinstance(value, str):
            raise RuntimeError(f"grok.{key} must be a string")
        value = value.strip().lower()
        if value not in ("on", "off"):
            raise RuntimeError(f"grok.{key} must be one of: on, off")
        grok[key] = value
    return config


CONFIG = _load_config()


def _get_language() -> str:
    """ユーザー言語（ja/en）を返す。"""
    return CONFIG.get("user", {}).get("language", "ja")


def _msg(ja: str, en: str) -> str:
    """言語に応じて固定文言を切り替える。"""
    return en if _get_language() == "en" else ja

# 起動時にstate.jsonを読み込む。
STATE = load_state()
_state_lock = threading.Lock()

# xai-sdkはAPIキー必須なので、未設定なら即エラーにする。
_XAI_API_KEY = os.getenv("XAI_API_KEY")
if not _XAI_API_KEY:
    raise RuntimeError("XAI_API_KEY is not set")

# 共有APIキーは必須。未設定なら起動時に止める。
_AVATAR_API_KEY = os.getenv("AVATAR_API_KEY")
if not _AVATAR_API_KEY:
    raise RuntimeError("AVATAR_API_KEY is not set")


# リクエスト間で共有するSDKクライアント（初期化コストを節約）。
# timeout: ネットワークレベルのタイムアウト（秒）。executor枯渇防止。
_client = Client(api_key=_XAI_API_KEY, timeout=30.0)

# トークン使用量の追跡（日次リセット、永続化）
_token_lock = threading.Lock()
_start_time = time.time()


def _load_token_usage() -> dict:
    """state.jsonからトークン使用量を読み込む。"""
    today = time.strftime("%Y-%m-%d")
    token_data = STATE.get("token_usage", {})
    if token_data.get("date") != today:
        return {"used": 0, "date": today}
    return {"used": token_data.get("used", 0), "date": today}


_token_usage = _load_token_usage()


def _add_token_usage(tokens: int) -> None:
    """トークン使用量を加算する。日付が変わったらリセット。永続化する。"""
    today = time.strftime("%Y-%m-%d")
    with _token_lock:
        if _token_usage["date"] != today:
            _token_usage["used"] = 0
            _token_usage["date"] = today
        _token_usage["used"] += tokens
        # state.jsonに永続化
        with _state_lock:
            STATE["token_usage"] = dict(_token_usage)
            save_state(STATE)


def _track_usage(response) -> None:
    """レスポンスからトークン使用量を抽出して加算する。"""
    usage = getattr(response, "usage", None)
    if usage:
        total = getattr(usage, "total_tokens", 0)
        if total > 0:
            _add_token_usage(total)


def _get_token_usage() -> dict:
    """現在のトークン使用量を返す。"""
    today = time.strftime("%Y-%m-%d")
    limit = CONFIG.get("grok", {}).get("daily_token_limit", 100000)
    with _token_lock:
        if _token_usage["date"] != today:
            _token_usage["used"] = 0
            _token_usage["date"] = today
        return {
            "used": _token_usage["used"],
            "limit": limit,
            "percent": min(100, int((_token_usage["used"] / limit) * 100)) if limit > 0 else 0,
        }


def _build_env_context() -> str:
    """実行環境のコンテキストを生成する。"""
    from core.exec import get_avatar_space
    space = get_avatar_space(CONFIG)
    return f"""## {_msg('実行環境', 'Runtime Environment')}
- {_msg('OS', 'OS')}: {platform.system()} {platform.release()}
- {_msg('Shell', 'Shell')}: {os.environ.get('SHELL', 'unknown')}
- {_msg('CWD', 'CWD')}: {space}"""


def _build_system_prompt() -> str:
    """人格と行動原則を定義する（環境情報とstate含む）。"""
    avatar_name = CONFIG.get("avatar", {}).get("name", "Avatar")
    user_name = CONFIG.get("user", {}).get("name", "User")

    return f"""あなたは{avatar_name}です。
{user_name}が設定した目的を達成するために、自律的に思考・行動します。

## 行動原則
1. 目的（purpose）を常に意識し、達成に向けて行動する
2. 目標（goal）がなければ、目的から目標を生成する
3. タスク（task）がなければ、目標からタスクを生成する
4. 次の1手を決定し、実行する
5. 会話以外のアクションは承認を求める

{_build_env_context()}

{_build_state_context()}

## 基本設定
{CONFIG.get("system_prompt", "")}
"""


def _build_state_context() -> str:
    """現在の状態をコンテキストとして生成する（毎回呼ばれる）。"""
    with _state_lock:
        state_copy = copy.deepcopy(STATE)

    mission = state_copy.get("mission", {})
    unset_label = _msg("（未設定）", "(unset)")
    purpose = mission.get("purpose") or unset_label
    purpose_type = mission.get("purpose_type") or unset_label
    goals = mission.get("goals", [])

    goals_summary = ""
    if goals:
        for g in goals:
            goals_summary += f"- {g['id']}: {g['name']} ({g['status']})\n"
            for t in g.get("tasks", []):
                goals_summary += f"  - {t['id']}: {t['name']} ({t['status']})\n"
    else:
        goals_summary = _msg("（なし）", "(none)")

    return f"""{_msg('[現在の状態]', '[Current State]')}
{_msg('目的', 'Purpose')}: {purpose}
{_msg('目的タイプ', 'Purpose Type')}: {purpose_type}
{_msg('目標とタスク', 'Goals & Tasks')}:
{goals_summary}"""


def _new_chat():
    # 新規チャットを作成し、動的システムプロンプトを注入する。
    grok = CONFIG["grok"]
    # Agent Tools: Web/X検索を必要に応じて有効化
    tools = []
    if grok.get("search_web") != "off":
        tools.append(web_search())
    if grok.get("search_x") != "off":
        tools.append(x_search())
    chat = _client.chat.create(
        model=grok["model"],
        temperature=float(grok["temperature"]),
        tools=tools or None,
    )
    chat.append(system(_build_system_prompt()))
    return chat


# _new_json_chat() は廃止。単一セッションでJSON出力はプロンプトで強制する。


class _SessionStore:
    def __init__(self, ttl_seconds: int = 3600):
        # セッションごとのチャットをメモリ保持し、TTLで自然に掃除する。
        self._ttl_seconds = ttl_seconds
        self._items: dict[str, tuple[object, float]] = {}
        self._lock = threading.Lock()

    def get_chat(self, session_id: str):
        # 既存チャットを返す。なければ新規作成する。
        now = time.time()
        with self._lock:
            self._purge_expired(now)
            item = self._items.get(session_id)
            if item:
                chat, _ = item
                self._items[session_id] = (chat, now)
                return chat

            chat = _new_chat()
            self._items[session_id] = (chat, now)
            return chat

    def _purge_expired(self, now: float) -> None:
        # 放置セッションを削除してメモリ肥大を防ぐ。
        expired = [
            session_id
            for session_id, (_, last_used) in self._items.items()
            if now - last_used > self._ttl_seconds
        ]
        for session_id in expired:
            self._items.pop(session_id, None)

    def reset(self) -> None:
        # 設定変更時に全セッションを破棄する。
        with self._lock:
            self._items.clear()

    def remove(self, session_id: str) -> None:
        # 特定のセッションを削除する。
        with self._lock:
            self._items.pop(session_id, None)


_sessions = _SessionStore()

# 自律ループ用のセッションID（内部用）。
_CORE_SESSION_ID = "core-autonomous"

# ループ制御用の状態。
_loop_running = False
_loop_thread: Optional[threading.Thread] = None
_loop_stop_event = threading.Event()  # ループ停止用
_loop_wake_event = threading.Event()  # ループを起こす用

# ループ間隔（秒）。
_LOOP_INTERVAL_DEFAULT = 3.0

# LLMタイムアウト（秒）。
_LLM_TIMEOUT = 30.0
_llm_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="llm")


def _sample_with_timeout(chat, timeout: float = _LLM_TIMEOUT):
    """chat.sample()をタイムアウト付きで実行。タイムアウト時は例外を投げる。"""
    import time as _time
    start = _time.time()
    print(f"[LLM] sample start (timeout={timeout}s, executor_threads={_llm_executor._max_workers})")
    future = _llm_executor.submit(chat.sample)
    try:
        result = future.result(timeout=timeout)
        elapsed = _time.time() - start
        print(f"[LLM] sample done in {elapsed:.2f}s")
        return result
    except FuturesTimeoutError:
        elapsed = _time.time() - start
        # executor の状態を記録
        pending = sum(1 for t in _llm_executor._threads if t.is_alive())
        print(f"[LLM] TIMEOUT after {elapsed:.2f}s (alive_threads={pending}/{_llm_executor._max_workers})")
        future.cancel()
        raise TimeoutError(f"LLM response timed out after {timeout}s")


def _get_loop_config():
    """自律ループ設定を取得する。"""
    loop_cfg = CONFIG.get("autonomous_loop", {})
    return {
        "notify_result": loop_cfg.get("notify_result", True),
        "result_interval": loop_cfg.get("result_interval", _LOOP_INTERVAL_DEFAULT),
    }

def _loop_interval_result():
    """結果後のインターバルを返す。"""
    return _get_loop_config()["result_interval"]

def _loop_interval_idle():
    """idle時は無期限待機（Noneを返してwait()をブロックさせる）。"""
    return None


def _run_autonomous_loop() -> None:
    """
    自律ループ本体。バックグラウンドスレッドで実行される。
    Trigger → 思考 → 行動 → 結果 → Trigger...
    """
    global _loop_running
    _loop_running = True

    while not _loop_stop_event.is_set():
        try:
            interval = _cycle_step()
        except Exception as exc:
            # ループ内のエラーはログに記録して継続（fail-fastはリクエスト単位）。
            print(f"[LOOP ERROR] {exc}")
            interval = _loop_interval_result()

        # 次のサイクルまで待機（中断可能）。
        # interval=None の場合は無期限待機（idleモード）。
        _loop_wake_event.wait(timeout=interval)
        _loop_wake_event.clear()  # 次の待機に備えてクリア

    _loop_running = False


def _cycle_step() -> float:
    """
    1サイクル分の処理を実行し、次のサイクルまでの待機時間を返す。
    """
    with _state_lock:
        state_copy = copy.deepcopy(STATE)

    mission = state_copy.get("mission", {})
    purpose = mission.get("purpose")
    purpose_type = mission.get("purpose_type")
    action = state_copy.get("action")

    pause_phases = {
        "approving",
        "executing",
        "awaiting_continue",
        "awaiting_purpose",
        "awaiting_purpose_confirm",
        "awaiting_purpose_type",
        "awaiting_goals_confirm",
        "awaiting_tasks_confirm",
        "awaiting_goal_complete",
        "awaiting_task_fail",
    }
    if action and action.get("phase") in pause_phases:
        return _loop_interval_idle()

    # purposeがなければ問いかけを生成。
    if not purpose:
        _ask_for_purpose()
        return _loop_interval_idle()

    # purpose_typeが未設定なら選択を求める。
    if not purpose_type:
        _ask_for_purpose_type(purpose)
        return _loop_interval_idle()

    # 目標がなければ提案して承認を待つ。
    goals = mission.get("goals", [])
    if not goals:
        _propose_goals(purpose, goals)
        return _loop_interval_idle()

    # activeな目標を取得。
    active_goals = [g for g in goals if g.get("status") == "active"]
    if not active_goals:
        # 全目標完了
        if purpose_type == "ongoing":
            _propose_goals(purpose, goals)
            return _loop_interval_idle()
        return _check_purpose_completion(purpose, goals)

    # 最初のactive目標のタスクを確認。
    current_goal = active_goals[0]
    tasks = current_goal.get("tasks", [])

    # activeなタスクがあれば、それを実行（再開）
    active_tasks = [t for t in tasks if t.get("status") == "active"]
    if active_tasks:
        # activeなタスクがあるのにactionがない → 実行を再開
        return _execute_task(current_goal, active_tasks[0])

    pending_tasks = [t for t in tasks if t.get("status") == "pending"]

    # タスクがまだ無い場合は提案して承認を待つ。
    if not tasks:
        _propose_tasks(current_goal, tasks)
        return _loop_interval_idle()

    if pending_tasks:
        # 次のタスクを実行（承認が必要なら承認待ちに移行）。
        next_task = pending_tasks[0]
        return _execute_task(current_goal, next_task)

    # active/pendingが無い → 全タスク完了とみなしてユーザー承認へ。
    _prompt_goal_completion(current_goal)
    return _loop_interval_idle()


def _ask_for_purpose() -> None:
    """purposeがないときにAvatarがdialogueで問いかける。一度だけ。"""
    # すでに問いかけ済みならスキップ。
    with _state_lock:
        action = STATE.get("action") or {}
        if action.get("phase") == "awaiting_purpose":
            return

    avatar_name = CONFIG.get("avatar", {}).get("name", "Avatar")
    message = f"{avatar_name}> {_msg('目的が設定されていません。何を達成しましょうか？', 'Purpose is not set. What should we achieve?')}"

    with _state_lock:
        update_action(STATE, "awaiting_purpose", "目的を待機中")
        update_thought(STATE, "purpose未設定", "ユーザーに問いかけ")
        save_state(STATE)
    append_event(
        "thought",
        judgment=_msg("purpose未設定", "Purpose not set"),
        intent=_msg("ユーザーに問いかけ", "Ask user"),
    )

    # dialogueに出力（UIが取得する用のイベント）。
    append_event("output", pane="dialogue", text=message)


def _ask_for_purpose_type(purpose: str) -> None:
    """目的タイプ（継続/達成）の確認をユーザーに求める。"""
    with _state_lock:
        action = STATE.get("action") or {}
        if action.get("phase") == "awaiting_purpose_type":
            return

    avatar_name = CONFIG.get("avatar", {}).get("name", "Avatar")
    message = f"{avatar_name}> {_msg(f'目的「{purpose}」は達成型ですか？', f'Is the purpose \"{purpose}\" finite?')} [y] Achieve / [n] Continue"

    with _state_lock:
        update_action(STATE, "awaiting_purpose_type", f"目的タイプ確認: {purpose}")
        update_thought(STATE, "目的タイプ確認", f"目的: {purpose}")
        save_state(STATE)
    append_event(
        "thought",
        judgment=_msg("目的タイプ確認", "Purpose type check"),
        intent=_msg("ユーザーに問いかけ", "Ask user"),
    )
    append_event("output", pane="dialogue", text=message)


def _handle_purpose_type_response(text: str, session_id: str) -> dict:
    """目的タイプ確認への応答を処理する。"""
    avatar_name = CONFIG.get("avatar", {}).get("name", "Avatar")
    text_lower = text.strip().lower()
    purpose = STATE["mission"]["purpose"]

    if text_lower in ("y", "yes", "はい"):
        purpose_type = "finite"
    elif text_lower in ("n", "no", "いいえ"):
        purpose_type = "ongoing"
    else:
        return {
            "response": _msg("目的タイプは y/n で指定してください。", "Please answer with y/n."),
            "source": "dialogue",
            "authority": "user",
            "session_id": session_id,
            "response_id": "purpose_type_invalid",
            "intent": "conversation",
            "route": "dialogue",
            "needs_approval": False,
            "proposal": None,
        }

    with _state_lock:
        STATE["mission"]["purpose_type"] = purpose_type
        clear_action(STATE)
        update_thought(STATE, "目的タイプ設定", f"{purpose} -> {purpose_type}")
        save_state(STATE)
    _loop_wake_event.set()
    return {
        "response": _msg(
            f"目的タイプを「{purpose_type}」に設定しました。",
            f"Purpose type set to \"{purpose_type}\".",
        ),
        "source": "dialogue",
        "authority": "user",
        "session_id": session_id,
        "response_id": "purpose_type_set",
        "intent": "conversation",
        "route": "dialogue",
        "needs_approval": False,
        "proposal": None,
    }

def _handle_purpose_confirm_response(text: str, session_id: str) -> dict:
    """目的達成確認への応答を処理する。"""
    avatar_name = CONFIG.get("avatar", {}).get("name", "Avatar")
    text_lower = text.strip().lower()
    purpose = STATE["mission"]["purpose"]

    if text_lower in ("y", "yes", "はい"):
        # 達成とみなす → 次の目的を待つ
        with _state_lock:
            STATE["mission"]["purpose"] = ""
            STATE["mission"]["purpose_type"] = None
            STATE["mission"]["goals"] = []
            clear_action(STATE)
            update_thought(STATE, "目的達成", f"ユーザー確認: {purpose}")
            save_state(STATE)
        _loop_wake_event.set()
        return {
            "response": _msg(
                f"目的「{purpose}」を達成しました。次の目的を設定しますか？",
                f"Purpose \"{purpose}\" achieved. Set a new purpose?",
            ),
            "source": "dialogue",
            "authority": "user",
            "session_id": session_id,
            "response_id": "purpose_confirm",
            "intent": "conversation",
            "route": "dialogue",
            "needs_approval": False,
            "proposal": None,
        }
    elif text_lower in ("n", "no", "いいえ"):
        # 未達成 → 続行（新しい目標を生成）
        with _state_lock:
            clear_action(STATE)
            update_thought(STATE, "目的続行", "新しい目標を生成")
            save_state(STATE)
        # ここで新しい目標提案を行う
        _propose_goals(purpose, STATE["mission"]["goals"])
        
        return {
            "response": _msg(
                f"目的「{purpose}」の達成に向けて続行します。",
                f"Continuing toward purpose \"{purpose}\".",
            ),
            "source": "dialogue",
            "authority": "user",
            "session_id": session_id,
            "response_id": "purpose_continue",
            "intent": "conversation",
            "route": "dialogue",
            "needs_approval": False,
            "proposal": None,
        }
    else:
        # 新しい目的として設定
        with _state_lock:
            STATE["mission"]["purpose"] = text.strip()
            STATE["mission"]["purpose_type"] = None
            STATE["mission"]["goals"] = []
            clear_action(STATE)
            update_thought(STATE, "新目的設定", f"目的: {text.strip()}")
            save_state(STATE)
        _loop_wake_event.set()
        return {
            "response": _msg(
                f"新しい目的「{text.strip()}」を設定しました。",
                f"New purpose set to \"{text.strip()}\".",
            ),
            "source": "dialogue",
            "authority": "user",
            "session_id": session_id,
            "response_id": "purpose_new",
            "intent": "conversation",
            "route": "dialogue",
            "needs_approval": False,
            "proposal": None,
        }


def _check_purpose_completion(purpose: str, completed_goals: list) -> float:
    """目的達成の確認をユーザーに求める（達成型のみ）。"""
    avatar_name = CONFIG.get("avatar", {}).get("name", "Avatar")
    with _state_lock:
        update_action(STATE, "awaiting_purpose_confirm", f"目的達成確認: {purpose}")
        update_thought(STATE, "全目標完了", "目的達成を確認中")
        save_state(STATE)
    append_event(
        "output",
        pane="dialogue",
        text=(
            f"{avatar_name}> {_msg(f'全ての目標が完了しました。目的「{purpose}」は達成されましたか？', f'All goals are complete. Has the purpose \"{purpose}\" been achieved?')}\n"
            f"[y] Achieve / [n] Continue / {_msg('新しい目的を入力', 'Enter a new purpose')}"
        ),
    )
    return _loop_interval_idle()


def _propose_goals(purpose: str, existing_goals: list, feedback: Optional[str] = None) -> bool:
    """purposeから目標候補を提案し、ユーザー承認待ちにする。"""
    avatar_name = CONFIG.get("avatar", {}).get("name", "Avatar")

    # 思考開始を出力
    append_event("output", pane="dialogue", text=f"{avatar_name}> {_msg('目的について考えています...', 'Thinking about the purpose...')}")

    # 既存目標のコンテキストを構築
    existing_names = [g["name"] for g in existing_goals]
    existing_context = ""
    if existing_names:
        existing_context = f"\n既に設定した目標: {', '.join(existing_names)}\nこれらとは別の新しい目標を提案してください。"

    feedback_context = f"\nユーザーからの修正指示: {feedback}" if feedback else ""
    
    # 共有セッションでJSON出力（プロンプトで強制）
    chat = _sessions.get_chat(_CORE_SESSION_ID)
    chat.append(user(
        "【目標生成タスク】\n"
        "以下の目的に対して、必要十分な目標群を提案してください。\n"
        "【制約】\n"
        "- シンプルで実行可能な目標にすること\n"
        "- 目標は少なくとも2タスクに分解できる成果にすること\n"
        "- 1サイクルで完了する作業（タスク粒度）は目標にしない\n"
        "- セキュリティスキャン、ネットワーク攻撃、システム侵入は禁止\n"
        "- ファイル操作は作業ディレクトリ内のみ\n"
        "【出力形式】\n"
        "- 出力はJSONオブジェクト1つのみ（前後の説明やコードブロックは禁止）\n"
        "- JSON以外のテキスト・マークダウン・コメントは一切禁止\n"
        "- ダブルクォートのみを使用し、キーは goals のみ\n"
        f"{existing_context}"
        f"{feedback_context}\n"
        "JSON形式で返してください: {\"goals\": [{\"name\": \"目標名\"}]}\n"
        f"目的: {purpose}"
    ))
    try:
        result = _sample_with_timeout(chat)
        _track_usage(result)
        raw = getattr(result, "content", "")
        data = json.loads(raw)
        goals_data = data.get("goals", [])
        if not isinstance(goals_data, list) or not goals_data:
            raise ValueError("goals is empty")
        goals = [g for g in goals_data if isinstance(g, dict) and g.get("name")]
        if not goals:
            raise ValueError("goals has no valid names")
    except Exception:
        with _state_lock:
            update_action(
                STATE,
                "awaiting_goals_confirm",
                "目標提案の生成に失敗",
                data={"goals": [], "error": "目標案の生成に失敗しました"},
            )
            update_thought(STATE, "目標提案失敗", "ユーザーに再提案を求める")
            save_state(STATE)
        append_event(
            "output",
            pane="dialogue",
            text=f"{avatar_name}> {_msg('目標案の生成に失敗しました。', 'Failed to generate goals.')}",
        )
        append_event(
            "output",
            pane="dialogue",
            text=f"{avatar_name}> [n] {_msg('再試行', 'Retry')} / {_msg('修正内容を入力してください', 'Enter revisions')}",
        )
        return False

    with _state_lock:
        update_action(
            STATE,
            "awaiting_goals_confirm",
            f"目標提案: {len(goals)}件",
            data={"goals": goals},
        )
        update_thought(STATE, f"目標提案: {len(goals)}件", "ユーザー承認待ち")
        save_state(STATE)
    append_event(
        "thought",
        judgment=_msg(f"目標提案: {len(goals)}件", f"Goals proposed: {len(goals)}"),
        intent=_msg("ユーザー承認待ち", "Awaiting approval"),
    )

    # 目標一覧を1つのメッセージにまとめて出力
    goal_list = "\n".join(f"  {idx}. {g['name']}" for idx, g in enumerate(goals, start=1))
    append_event(
        "output",
        pane="dialogue",
        text=f"{avatar_name}> {_msg('目標案を提案します。', 'Proposed goals:')}\n{goal_list}\n{_msg('この目標群で進めますか？', 'Proceed with these goals?')} [y] {_msg('承認', 'Approve')} / [n] {_msg('再提案', 'Re-propose')} / {_msg('修正内容を入力', 'Enter revisions')}",
    )
    return True


def _handle_goals_confirm_response(text: str, session_id: str) -> dict:
    """Goal候補の承認応答を処理する。"""
    avatar_name = CONFIG.get("avatar", {}).get("name", "Avatar")
    text_lower = text.strip().lower()
    action = STATE.get("action") or {}
    data = action.get("data") or {}
    proposed_goals = data.get("goals", [])

    if text_lower in ("y", "yes", "はい"):
        if not proposed_goals:
            return {
                "response": _msg(
                    "目標案が空のため承認できません。修正内容を入力してください。",
                    "Cannot approve because the goal list is empty. Enter revisions.",
                ),
                "source": "dialogue",
                "authority": "user",
                "session_id": session_id,
                "response_id": "goals_empty",
                "intent": "conversation",
                "route": "dialogue",
                "needs_approval": False,
                "proposal": None,
            }
        with _state_lock:
            existing_goals = STATE["mission"]["goals"]
            has_active = any(g.get("status") == "active" for g in existing_goals)
            next_index = len(existing_goals) + 1
            for i, g in enumerate(proposed_goals):
                status = "active" if not has_active and i == 0 else "pending"
                add_goal(STATE, f"G{next_index}", g["name"], status=status)
                next_index += 1
                has_active = True
            clear_action(STATE)
            update_thought(STATE, "目標承認", f"{len(proposed_goals)}件")
            save_state(STATE)
        _loop_wake_event.set()
        return {
            "response": _msg("目標を確定しました。", "Goals confirmed."),
            "source": "dialogue",
            "authority": "user",
            "session_id": session_id,
            "response_id": "goals_confirmed",
            "intent": "conversation",
            "route": "dialogue",
            "needs_approval": False,
            "proposal": None,
        }

    # 再提案
    feedback = None if text_lower in ("n", "no", "いいえ") else text.strip()
    with _state_lock:
        clear_action(STATE)
        update_thought(STATE, "目標再提案", feedback or "再生成")
        save_state(STATE)
    _propose_goals(STATE["mission"]["purpose"], STATE["mission"]["goals"], feedback=feedback)
    return {
        "response": _msg("目標案を再提案します。", "Re-proposing goals."),
        "source": "dialogue",
        "authority": "user",
        "session_id": session_id,
        "response_id": "goals_retry",
        "intent": "conversation",
        "route": "dialogue",
        "needs_approval": False,
        "proposal": None,
    }


def _propose_tasks(goal: dict, existing_tasks: list, feedback: Optional[str] = None) -> bool:
    """目標に対するタスク候補を提案し、ユーザー承認待ちにする。"""
    avatar_name = CONFIG.get("avatar", {}).get("name", "Avatar")
    goal_id = goal.get("id", "G?")
    purpose = STATE.get("mission", {}).get("purpose") or ""
    append_event(
        "output",
        pane="dialogue",
        text=f"{avatar_name}> {_msg(f'{goal_id}のタスクを考えています...', f'Thinking about tasks for {goal_id}...')}",
    )

    completed_tasks = [t for t in existing_tasks if t.get("status") == "done"]
    completed_names = [t["name"] for t in completed_tasks]
    completed_context = f"\n完了済みタスク: {', '.join(completed_names)}" if completed_names else ""
    feedback_context = f"\nユーザーからの修正指示: {feedback}" if feedback else ""

    # 共有セッションでJSON出力（プロンプトで強制）
    chat = _sessions.get_chat(_CORE_SESSION_ID)
    chat.append(user(
        "【タスク生成タスク】\n"
        "以下の目標に対して、必要十分なタスク群を提案してください。\n"
        "【制約】\n"
        "- 1タスクは1サイクルで完了できる粒度にすること\n"
        "- シンプルで実行可能なタスクにすること\n"
        "- タスクは2件以上提案すること\n"
        "- セキュリティスキャン、ネットワーク攻撃ツール（nmap, nikto等）は禁止\n"
        "- ファイル操作は作業ディレクトリ内のみ\n"
        "- 完了済みタスクは繰り返さない\n"
        "【出力形式】\n"
        "- 出力はJSONオブジェクト1つのみ（前後の説明やコードブロックは禁止）\n"
        "- JSON以外のテキスト・マークダウン・コメントは一切禁止\n"
        "- ダブルクォートのみを使用し、キーは tasks のみ\n"
        f"{completed_context}"
        f"{feedback_context}\n"
        "JSON形式で返してください: {\"tasks\": [{\"name\": \"タスク名\", \"trigger\": \"実行条件(if)\", \"response\": \"実行内容(then)\"}]}\n"
        f"目的: {purpose}\n"
        f"目標: {goal['name']}\nこの目標を達成するためのタスクを提案してください。"
    ))
    try:
        result = _sample_with_timeout(chat)
        _track_usage(result)
        raw = getattr(result, "content", "")
        data = json.loads(raw)
        tasks_data = data.get("tasks", [])
        if not isinstance(tasks_data, list) or not tasks_data:
            raise ValueError("tasks is empty")
        tasks = [t for t in tasks_data if isinstance(t, dict) and t.get("name")]
        if not tasks:
            raise ValueError("tasks has no valid names")
    except Exception:
        with _state_lock:
            update_action(
                STATE,
                "awaiting_tasks_confirm",
                "タスク提案の生成に失敗",
                data={"goal_id": goal["id"], "tasks": [], "error": "タスク案の生成に失敗しました"},
            )
            update_thought(STATE, "タスク提案失敗", "ユーザーに再提案を求める")
            save_state(STATE)
        append_event(
            "output",
            pane="dialogue",
            text=f"{avatar_name}> {_msg('タスク案の生成に失敗しました。', 'Failed to generate tasks.')}",
        )
        append_event(
            "output",
            pane="dialogue",
            text=f"{avatar_name}> [n] {_msg('再試行', 'Retry')} / {_msg('修正内容を入力してください', 'Enter revisions')}",
        )
        return False

    with _state_lock:
        update_action(
            STATE,
            "awaiting_tasks_confirm",
            f"タスク提案: {len(tasks)}件",
            data={"goal_id": goal["id"], "tasks": tasks},
        )
        update_thought(STATE, f"タスク提案: {len(tasks)}件", "ユーザー承認待ち")
        save_state(STATE)
    append_event(
        "thought",
        judgment=_msg(f"タスク提案: {len(tasks)}件", f"Tasks proposed: {len(tasks)}"),
        intent=_msg("ユーザー承認待ち", "Awaiting approval"),
    )

    # タスク一覧を1つのメッセージにまとめて出力
    task_list = "\n".join(f"  {idx}. {t['name']}" for idx, t in enumerate(tasks, start=1))
    append_event(
        "output",
        pane="dialogue",
        text=f"{avatar_name}> {_msg(f'{goal_id}のタスク案を提案します。', f'Proposed tasks for {goal_id}:')}\n{task_list}\n{_msg('このタスク群で進めますか？', 'Proceed with these tasks?')} [y] {_msg('承認', 'Approve')} / [n] {_msg('再提案', 'Re-propose')} / {_msg('修正内容を入力', 'Enter revisions')}",
    )
    return True


def _handle_tasks_confirm_response(text: str, session_id: str) -> dict:
    """Task候補の承認応答を処理する。"""
    avatar_name = CONFIG.get("avatar", {}).get("name", "Avatar")
    text_lower = text.strip().lower()
    action = STATE.get("action") or {}
    data = action.get("data") or {}
    goal_id = data.get("goal_id")
    proposed_tasks = data.get("tasks", [])

    if text_lower in ("y", "yes", "はい"):
        if not proposed_tasks:
            return {
                "response": _msg(
                    "タスク案が空のため承認できません。修正内容を入力してください。",
                    "Cannot approve because the task list is empty. Enter revisions.",
                ),
                "source": "dialogue",
                "authority": "user",
                "session_id": session_id,
                "response_id": "tasks_empty",
                "intent": "conversation",
                "route": "dialogue",
                "needs_approval": False,
                "proposal": None,
            }
        with _state_lock:
            goal = next((g for g in STATE["mission"]["goals"] if g["id"] == goal_id), None)
            if not goal:
                clear_action(STATE)
                save_state(STATE)
            else:
                existing_tasks = goal.get("tasks", [])
                next_index = len(existing_tasks) + 1
                for t in proposed_tasks:
                    task_id = f"{goal_id}-T{next_index}"
                    add_task(
                        STATE,
                        goal_id,
                        task_id,
                        t["name"],
                        trigger=t.get("trigger"),
                        response=t.get("response"),
                    )
                    next_index += 1
                clear_action(STATE)
                update_thought(STATE, "タスク承認", f"{len(proposed_tasks)}件")
                save_state(STATE)
        _loop_wake_event.set()
        return {
            "response": _msg("タスクを確定しました。", "Tasks confirmed."),
            "source": "dialogue",
            "authority": "user",
            "session_id": session_id,
            "response_id": "tasks_confirmed",
            "intent": "conversation",
            "route": "dialogue",
            "needs_approval": False,
            "proposal": None,
        }

    # 再提案
    feedback = None if text_lower in ("n", "no", "いいえ") else text.strip()
    with _state_lock:
        clear_action(STATE)
        update_thought(STATE, "タスク再提案", feedback or "再生成")
        save_state(STATE)
        goal = next((g for g in STATE["mission"]["goals"] if g["id"] == goal_id), None)
    if goal:
        _propose_tasks(goal, goal.get("tasks", []), feedback=feedback)
    return {
        "response": _msg("タスク案を再提案します。", "Re-proposing tasks."),
        "source": "dialogue",
        "authority": "user",
        "session_id": session_id,
        "response_id": "tasks_retry",
        "intent": "conversation",
        "route": "dialogue",
        "needs_approval": False,
        "proposal": None,
    }


def _prompt_goal_completion(goal: dict) -> None:
    """全タスク完了時に目標完了承認を求める。"""
    avatar_name = CONFIG.get("avatar", {}).get("name", "Avatar")
    goal_name = goal["name"]
    with _state_lock:
        update_action(
            STATE,
            "awaiting_goal_complete",
            f"目標完了承認: {goal_name}",
            data={"goal_id": goal["id"]},
        )
        update_thought(STATE, "全タスク完了", "目標完了承認待ち")
        save_state(STATE)
    append_event(
        "output",
        pane="dialogue",
        text=(
            f"{avatar_name}> "
            f"{_msg(f'全てのタスクが完了しました。目標「{goal_name}」は達成されましたか？', f'All tasks are complete. Has the goal \"{goal_name}\" been achieved?')}\n"
            f"[y] Achieve / [n] Continue"
        ),
    )


def _handle_goal_complete_response(text: str, session_id: str) -> dict:
    """目標完了承認への応答を処理する。"""
    avatar_name = CONFIG.get("avatar", {}).get("name", "Avatar")
    text_lower = text.strip().lower()
    action = STATE.get("action") or {}
    data = action.get("data") or {}
    goal_id = data.get("goal_id")

    if text_lower in ("y", "yes", "はい"):
        with _state_lock:
            for g in STATE["mission"]["goals"]:
                if g["id"] == goal_id:
                    g["status"] = "done"
                    break
            # 次のpending goalをactiveにする
            next_goal = next((g for g in STATE["mission"]["goals"] if g.get("status") == "pending"), None)
            if next_goal:
                next_goal["status"] = "active"
            clear_action(STATE)
            update_thought(STATE, "目標達成", f"{goal_id}")
            save_state(STATE)
        _loop_wake_event.set()
        return {
            "response": _msg("目標を達成しました。", "Goal achieved."),
            "source": "dialogue",
            "authority": "user",
            "session_id": session_id,
            "response_id": "goal_complete_yes",
            "intent": "conversation",
            "route": "dialogue",
            "needs_approval": False,
            "proposal": None,
        }

    # 続行: 追加タスクを提案
    feedback = None if text_lower in ("n", "no", "いいえ") else text.strip()
    with _state_lock:
        clear_action(STATE)
        update_thought(STATE, "目標未達", feedback or "継続")
        save_state(STATE)
        goal = next((g for g in STATE["mission"]["goals"] if g["id"] == goal_id), None)
    if goal:
        _propose_tasks(goal, goal.get("tasks", []), feedback=feedback)
    return {
        "response": _msg("追加タスクを提案します。", "Proposing additional tasks."),
        "source": "dialogue",
        "authority": "user",
        "session_id": session_id,
        "response_id": "goal_complete_no",
        "intent": "conversation",
        "route": "dialogue",
        "needs_approval": False,
        "proposal": None,
    }


def _handle_task_fail_response(text: str, session_id: str) -> dict:
    """タスク失敗後の応答を処理する。[r]再試行/[s]スキップ/コンテキスト入力。"""
    avatar_name = CONFIG.get("avatar", {}).get("name", "Avatar")
    text_lower = text.strip().lower()
    action = STATE.get("action") or {}
    data = action.get("data") or {}
    task_id = data.get("task_id")

    if text_lower in ("r", "retry", "再試行"):
        # 再試行: タスクをpendingに戻して再実行
        with _state_lock:
            if task_id:
                update_task_status(STATE, task_id, "pending")
            clear_action(STATE)
            update_thought(STATE, "タスク再試行", task_id)
            save_state(STATE)
        _loop_wake_event.set()
        return {
            "response": _msg("タスクを再試行します。", "Retrying task."),
            "source": "dialogue",
            "authority": "user",
            "session_id": session_id,
            "response_id": "task_fail_retry",
            "intent": "conversation",
            "route": "dialogue",
            "needs_approval": False,
            "proposal": None,
        }

    if text_lower in ("s", "skip", "スキップ"):
        # スキップ: タスクをfailにして次へ
        with _state_lock:
            if task_id:
                update_task_status(STATE, task_id, "fail")
            clear_action(STATE)
            update_thought(STATE, "タスクスキップ", task_id)
            save_state(STATE)
        _loop_wake_event.set()
        return {
            "response": _msg("タスクをスキップしました。", "Task skipped."),
            "source": "dialogue",
            "authority": "user",
            "session_id": session_id,
            "response_id": "task_fail_skip",
            "intent": "conversation",
            "route": "dialogue",
            "needs_approval": False,
            "proposal": None,
        }

    # コンテキスト入力: フィードバックとして再試行
    feedback = text.strip()
    with _state_lock:
        if task_id:
            update_task_status(STATE, task_id, "pending")
            for goal in STATE["mission"]["goals"]:
                for task in goal.get("tasks", []):
                    if task["id"] == task_id:
                        task["feedback"] = feedback  # フィードバックを保存
                        break
        clear_action(STATE)
        update_thought(STATE, "タスク再試行（コンテキスト付き）", feedback)
        save_state(STATE)
    _loop_wake_event.set()
    return {
        "response": _msg(f"コンテキストを追加して再試行します: {feedback}", f"Retrying with context: {feedback}"),
        "source": "dialogue",
        "authority": "user",
        "session_id": session_id,
        "response_id": "task_fail_context",
        "intent": "conversation",
        "route": "dialogue",
        "needs_approval": False,
        "proposal": None,
    }


def _execute_task(goal: dict, task: dict) -> float:
    """タスクを実行する（LLMに実行方法を聞いて承認待ちに移行）。待機時間を返す。"""
    loop_cfg = _get_loop_config()

    with _state_lock:
        update_task_status(STATE, task["id"], "active")
        save_state(STATE)

    feedback = task.get("feedback")
    feedback_line = f"\n補足: {feedback}" if feedback else ""

    # タスク実行は独立セッション（コンテキスト汚染防止）
    grok = CONFIG["grok"]
    chat = _client.chat.create(
        model=grok["model"],
        temperature=float(grok["temperature"]),
        response_format="json_object",  # JSON保証
    )
    chat.append(system(_build_system_prompt()))
    env_context = _build_env_context()
    state_context = _build_state_context()
    chat.append(user(
        f"{env_context}\n\n"
        f"{state_context}\n\n"
        "【タスク実行】\n"
        "以下のタスクを実行するためのコマンドを提案してください。\n"
        "JSON形式で返してください: {\"command\": \"bashコマンド\", \"summary\": \"実行概要\"}\n"
        "会話だけで完了するタスクの場合は: {\"command\": null, \"summary\": \"完了理由\"}\n"
        "出力はJSONオブジェクト1つのみ（前後の説明やコードブロックは禁止）\n"
        "JSON以外のテキスト・マークダウン・コメントは一切禁止\n"
        f"タスク: {task['name']}{feedback_line}"
    ))
    try:
        result = _sample_with_timeout(chat)
    except Exception as exc:
        error_summary = _msg(
            "タスク実行に失敗しました。",
            "Task execution failed.",
        )
        with _state_lock:
            update_thought(STATE, "タスク実行失敗", str(exc))
            update_result(STATE, "fail", f"{error_summary} {exc}")
            update_action(STATE, "awaiting_continue", error_summary)
            save_state(STATE)
        append_event("output", pane="dialogue", text=f"ERROR> {error_summary} {exc}")
        return _loop_interval_idle()
    _track_usage(result)
    raw = getattr(result, "content", "")

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        # JSONパースエラー → 1回リトライ
        print(f"[DEBUG] JSON parse error (1st). Raw: {raw[:300]}")
        chat.append(user("上記の出力はJSONとして不正です。JSON形式のみで再出力してください。"))
        try:
            retry_result = _sample_with_timeout(chat)
            _track_usage(retry_result)
            raw = getattr(retry_result, "content", "")
            data = json.loads(raw)
        except Exception as retry_exc:
            print(f"[DEBUG] JSON parse error (retry). Raw: {raw[:300]}, Exc: {retry_exc}")
            error_summary = _msg(
                "タスク実行のJSON出力が不正でした。",
                "Task execution JSON output was invalid.",
            )
            with _state_lock:
                update_thought(STATE, "タスク実行失敗", f"JSON出力不正: {raw[:100]}")
                update_result(STATE, "fail", error_summary)
                update_action(STATE, "awaiting_continue", error_summary)
                save_state(STATE)
            append_event("output", pane="dialogue", text=f"ERROR> {error_summary}")
            return _loop_interval_idle()

    command = data.get("command")
    summary = data.get("summary", task["name"])

    with _state_lock:
        update_thought(STATE, f"タスク: {task['name']}", f"実行: {summary}")
        if command:
            # コマンド実行が必要 → 承認待ち。
            update_action(STATE, "approving", summary, command=command)
        else:
            # 会話のみで完了 → 即完了。
            update_task_status(STATE, task["id"], "done")
            update_result(STATE, "done", summary)
        save_state(STATE)

    if command:
        append_event(
            "thought",
            judgment=_msg(f"タスク: {task['name']}", f"Task: {task['name']}"),
            intent=_msg(f"承認待ち: {summary}", f"Awaiting approval: {summary}"),
        )
        return _loop_interval_idle()
    else:
        append_event("result", status="done", summary=summary)
        # 結果をdialogueに出力
        if loop_cfg["notify_result"]:
            append_event("output", pane="dialogue", text=f"✓ Done: {summary}")
        # 会話タスク完了後は常に自動続行
        return _loop_interval_result()


def start_loop() -> None:
    """自律ループを開始する。"""
    global _loop_thread
    if _loop_thread and _loop_thread.is_alive():
        return
    _loop_stop_event.clear()
    _loop_thread = threading.Thread(target=_run_autonomous_loop, daemon=True)
    _loop_thread.start()


def stop_loop() -> None:
    """自律ループを停止する。"""
    _loop_stop_event.set()
    if _loop_thread:
        _loop_thread.join(timeout=5.0)


class ThinkRequest(BaseModel):
    # 新設計: source/text/session_id。authorityはsourceから自動導出。
    source: str  # dialogue | terminal | discord | roblox | x
    text: str
    session_id: str


# sourceからauthorityを導出するマッピング。
_AUTHORITY_MAP = {
    "dialogue": "user",
    "terminal": "user",
    "discord": "user",
    "roblox": "public",
    "x": "public",
}


def _get_authority(source: str) -> str:
    return _AUTHORITY_MAP.get(source, "public")


class AdminConfigUpdate(BaseModel):
    # 管理者向け: 変更したい項目だけ渡す。
    model: Optional[str] = None
    temperature: Optional[float] = None
    system_prompt: Optional[str] = None
    language: Optional[str] = None
    theme: Optional[str] = None


class ObservationRequest(BaseModel):
    # ターミナルなどの観測結果をセッションに追加する。
    session_id: str
    content: Optional[str] = None  # 後方互換
    command: Optional[str] = None
    output: Optional[str] = None
    label: Optional[str] = None


class ConsoleLogRequest(BaseModel):
    # Consoleの出力ログを受け取る。
    session_id: str
    run_id: Optional[str] = None
    seq: Optional[int] = None
    kind: str
    text: str
    pane: Optional[str] = None
    client_time: Optional[str] = None


def think_core(source: str, text: str, session_id: str) -> dict:
    """
    コア推論関数（内部用）。
    全てのチャネルはこの関数を経由する。
    """
    authority = _get_authority(source)
    if not _loop_running:
        start_loop()

    # 承認待ちの場合、ユーザー入力を処理（ロック外でチェック）
    with _state_lock:
        action = STATE.get("action") or {}
        phase = action.get("phase")
        purpose_type = STATE.get("mission", {}).get("purpose_type")

    if source == "dialogue":
        if phase == "awaiting_purpose_type":
            return _handle_purpose_type_response(text, session_id)
        if phase == "awaiting_goals_confirm":
            return _handle_goals_confirm_response(text, session_id)
        if phase == "awaiting_tasks_confirm":
            return _handle_tasks_confirm_response(text, session_id)
        if phase == "awaiting_goal_complete":
            return _handle_goal_complete_response(text, session_id)
        if phase == "awaiting_task_fail":
            return _handle_task_fail_response(text, session_id)
        if phase == "awaiting_purpose_confirm":
            return _handle_purpose_confirm_response(text, session_id)

        # 継続型目的の明示完了（ユーザー入力）
        if purpose_type == "ongoing":
            text_lower = text.strip().lower()
            if text_lower in ("完了", "終了", "done", "finish", "complete"):
                with _state_lock:
                    purpose = STATE["mission"]["purpose"]
                    STATE["mission"]["purpose"] = ""
                    STATE["mission"]["purpose_type"] = None
                    STATE["mission"]["goals"] = []
                    clear_action(STATE)
                    update_thought(STATE, "目的完了", f"ユーザー明示: {purpose}")
                    save_state(STATE)
                _loop_wake_event.set()
                return {
                    "response": _msg(
                        f"目的「{purpose}」を完了しました。",
                        f"Purpose \"{purpose}\" completed.",
                    ),
                    "source": "dialogue",
                    "authority": "user",
                    "session_id": session_id,
                    "response_id": "purpose_manual_complete",
                    "intent": "conversation",
                    "route": "dialogue",
                    "needs_approval": False,
                    "proposal": None,
                }

    # 入力状態を更新し、イベントを記録する。
    with _state_lock:
        update_input(STATE, source, authority, text)
        # purposeが空ならユーザーの入力をpurposeとして設定。
        purpose_was_empty = not STATE["mission"]["purpose"]
        if purpose_was_empty and source == "dialogue":
            set_purpose(STATE, text)
            clear_action(STATE)  # awaiting_purposeをクリア
            update_thought(STATE, "purpose設定", f"目的: {text}")
        save_state(STATE)
    append_event("input", source=source, text=text)

    # 目的設定直後は、LLM呼び出しを行わず目的タイプ質問を待つ
    if purpose_was_empty and source == "dialogue":
        avatar_name = CONFIG.get("avatar", {}).get("name", "Avatar")
        _loop_wake_event.set()  # ループを起こして目的タイプ質問を発動
        return {
            "response": _msg(
                f"目的を「{text}」に設定しました。",
                f"Purpose set to \"{text}\".",
            ),
            "source": source,
            "authority": authority,
            "session_id": session_id,
            "response_id": "purpose_set",
            "intent": "conversation",
            "route": "dialogue",
            "needs_approval": False,
            "proposal": None,
        }

    chat = _sessions.get_chat(session_id)
    # 状態コンテキストを付加してLLMに渡す
    context = _build_state_context()
    chat.append(user(f"{context}\n\n{text}"))
    response = _sample_with_timeout(chat)
    _track_usage(response)

    # 応答本文とレスポンスIDは必須。欠落時は即エラーにする。
    response_text = getattr(response, "content", None)
    response_id = getattr(response, "id", None)
    if not response_text:
        raise RuntimeError("Core response content is missing")
    if not response_id:
        raise RuntimeError("Core response_id is missing")

    # 応答内容をもとに意図を分類する（LLMの判断のみを使う）。
    intent_info = _classify_intent(text, response_text)
    needs_approval = intent_info["intent"] == "action"

    # 思考状態を更新し、イベントを記録する。
    judgment = (
        _msg(f"入力: {text[:50]}...", f"Input: {text[:50]}...")
        if len(text) > 50
        else _msg(f"入力: {text}", f"Input: {text}")
    )
    intent = (
        _msg("会話応答", "Conversation response")
        if intent_info["intent"] == "conversation"
        else _msg(
            f"実行: {intent_info['proposal']['summary'] if intent_info.get('proposal') else '不明'}",
            f"Action: {intent_info['proposal']['summary'] if intent_info.get('proposal') else 'unknown'}",
        )
    )
    with _state_lock:
        update_thought(STATE, judgment, intent)
        # 行動が必要な場合は承認待ち状態にする
        if needs_approval:
            proposal = intent_info.get("proposal") or {}
            summary = proposal.get("summary", "不明な操作")
            command = proposal.get("command")
            update_action(STATE, "approving", summary, command=command)
        else:
            clear_action(STATE)
        save_state(STATE)
    append_event("thought", judgment=judgment, intent=intent)

    # ユーザー入力後にループを起こす（idle待機から抜ける）
    _loop_wake_event.set()

    return {
        "response": response_text,
        "source": source,
        "authority": authority,
        "session_id": session_id,
        "response_id": response_id,
        "intent": intent_info["intent"],
        "route": intent_info["route"],
        "needs_approval": needs_approval,
        "proposal": intent_info["proposal"],
    }


def _classify_intent(prompt: str, response_text: str) -> dict:
    # LLMに意図分類を依頼し、JSONで返させる。
    classifier = _client.chat.create(model=CONFIG["grok"]["model"], temperature=0.0)
    classifier.append(
        system(
            "Return a single JSON object only. Do not include any extra text or code fences. "
            "Keys must be exactly: intent (conversation|action), "
            "route (dialogue|terminal), proposal (object with command and summary or null). "
            "Use double quotes only. "
            "If intent is action, proposal.command must be a concrete bash command."
        )
    )
    classifier.append(
        user(
            "USER_PROMPT:\n"
            f"{prompt}\n"
            "ASSISTANT_RESPONSE:\n"
            f"{response_text}"
        )
    )
    result = classifier.sample()
    _track_usage(result)
    raw = getattr(result, "content", "")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Intent classification returned invalid JSON") from exc
    if data.get("intent") not in ("conversation", "action"):
        raise RuntimeError("Intent classification intent is invalid")
    if data.get("route") not in ("dialogue", "terminal"):
        raise RuntimeError("Intent classification route is invalid")
    if "proposal" not in data:
        raise RuntimeError("Intent classification proposal is missing")
    if data["intent"] == "action":
        proposal = data.get("proposal")
        if not isinstance(proposal, dict):
            raise RuntimeError("Intent classification proposal is invalid")
        if not proposal.get("command"):
            raise RuntimeError("Intent classification proposal.command is missing")
    return data


def _save_config(updated: dict) -> None:
    # 設定を書き戻す。失敗したら即エラーにする。
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        yaml.safe_dump(updated, f, allow_unicode=True, sort_keys=False)


# FastAPIアプリがコアの唯一の入口。
app = FastAPI()


@app.exception_handler(Exception)
def handle_unexpected_error(request: Request, exc: Exception):
    # 想定外エラーもJSONで返す（Consoleが落ちないようにする）
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc) or "Internal Server Error"},
    )


def _ensure_loop_running() -> None:
    """自律ループが停止していたら再起動する。"""
    if not _loop_running:
        start_loop()


@app.on_event("startup")
def on_startup():
    """起動時に自律ループを開始する。"""
    start_loop()


@app.on_event("shutdown")
def on_shutdown():
    """終了時に自律ループを停止する。"""
    stop_loop()


def _check_api_key(request: Request) -> None:
    # 共有APIキーは必須なので一致しない場合は即拒否する。
    provided = request.headers.get("x-api-key")
    if provided != _AVATAR_API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.post("/v1/think")
def think(payload: ThinkRequest, request: Request):
    # コア推論エンドポイント（外部API用）。
    _check_api_key(request)

    result = think_core(payload.source, payload.text, payload.session_id)
    return JSONResponse(result)


@app.get("/health")
def health():
    # 死活監視用の応答（トークン使用量・起動時間を含む）。
    uptime = int(time.time() - _start_time)
    return {
        "status": "ok",
        "uptime": uptime,
        "tokens": _get_token_usage(),
    }


@app.get("/loop/status")
def loop_status(request: Request):
    # 自律ループの状態を返す。
    _check_api_key(request)
    return {"running": _loop_running}


@app.post("/loop/start")
def loop_start(request: Request):
    # 自律ループを開始する。
    _check_api_key(request)
    start_loop()
    return {"running": True}


@app.post("/loop/stop")
def loop_stop(request: Request):
    # 自律ループを停止する。
    _check_api_key(request)
    stop_loop()
    return {"running": False}


@app.get("/console-config")
def console_config(request: Request):
    # Console UI向けの最小設定を返す。
    # avatar/user を正本とし、name_tags に注入する。
    _check_api_key(request)
    if "console_ui" not in CONFIG:
        raise HTTPException(status_code=500, detail="console_ui is missing")
    ui = copy.deepcopy(CONFIG["console_ui"])
    ui["name_tags"] = {
        "avatar": CONFIG["avatar"]["name"],
        "avatar_fullname": CONFIG["avatar"]["fullname"],
        "user": CONFIG["user"]["name"],
    }
    ui["language"] = CONFIG["user"]["language"]
    palette = ui.get("command_palette") or {}
    options: dict = {}
    models = CONFIG.get("grok", {}).get("models") or []
    if models:
        options["model"] = models
    temps = CONFIG.get("grok", {}).get("temperature_presets") or []
    if temps:
        options["temperature"] = temps
    languages = CONFIG.get("user", {}).get("language_options") or []
    if languages:
        label_map = {"ja": "Japanese", "en": "English"}
        options["language"] = [
            {"label": label_map.get(lang, lang), "value": lang}
            for lang in languages
        ]
    themes = CONFIG.get("console_ui", {}).get("themes") or []
    if themes:
        names = []
        for theme in themes:
            if isinstance(theme, dict):
                name = str(theme.get("name", "")).strip()
                if name:
                    names.append(name)
        if names:
            options["theme"] = names
    palette["options"] = options
    ui["command_palette"] = palette
    return {"console_ui": ui}


@app.get("/admin/config")
def admin_config(request: Request):
    # 管理者向けに変更可能項目だけ返す。
    _check_api_key(request)
    grok = CONFIG["grok"]
    return {
        "model": grok["model"],
        "temperature": grok["temperature"],
        "system_prompt": CONFIG["system_prompt"],
        "language": CONFIG["user"]["language"],
        "theme": CONFIG.get("console_ui", {}).get("theme"),
    }


@app.get("/state")
def get_state(request: Request):
    # 現在の状態を返す。
    _check_api_key(request)
    _ensure_loop_running()
    with _state_lock:
        return copy.deepcopy(STATE)


@app.get("/events/recent")
def get_recent_events(request: Request, after: str = None, limit: int = 20):
    """最近のイベントを取得する。afterで指定した時刻以降のイベントのみ返す。"""
    _check_api_key(request)
    _ensure_loop_running()
    events = []
    events_file = Path(__file__).resolve().parent.parent / "data" / "events.jsonl"
    if not events_file.exists():
        return {"events": []}
    with open(events_file, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
                if after and event.get("time", "") <= after:
                    continue
                events.append(event)
            except json.JSONDecodeError:
                continue
    # 最新のlimit件を返す。
    return {"events": events[-limit:]}


class PurposeRequest(BaseModel):
    purpose: str


@app.post("/admin/purpose")
def set_purpose_endpoint(payload: PurposeRequest, request: Request):
    # 目的を設定する。
    _check_api_key(request)
    if not payload.purpose.strip():
        raise HTTPException(status_code=400, detail="purpose is empty")
    with _state_lock:
        set_purpose(STATE, payload.purpose.strip())
        save_state(STATE)
    return {"purpose": STATE["mission"]["purpose"]}


class GoalRequest(BaseModel):
    goal_id: str
    name: str


@app.post("/admin/goal")
def add_goal_endpoint(payload: GoalRequest, request: Request):
    # 目標を追加する。
    _check_api_key(request)
    if not payload.goal_id.strip() or not payload.name.strip():
        raise HTTPException(status_code=400, detail="goal_id or name is empty")
    with _state_lock:
        add_goal(STATE, payload.goal_id.strip(), payload.name.strip())
        save_state(STATE)
    return {"goals": STATE["mission"]["goals"]}


class TaskRequest(BaseModel):
    goal_id: str
    task_id: str
    name: str


class RetryTaskRequest(BaseModel):
    task_id: str


@app.post("/admin/task")
def add_task_endpoint(payload: TaskRequest, request: Request):
    # タスクを追加する。
    _check_api_key(request)
    if not payload.goal_id.strip() or not payload.task_id.strip() or not payload.name.strip():
        raise HTTPException(status_code=400, detail="goal_id, task_id or name is empty")
    with _state_lock:
        add_task(STATE, payload.goal_id.strip(), payload.task_id.strip(), payload.name.strip())
        save_state(STATE)
    return {"goals": STATE["mission"]["goals"]}


@app.post("/admin/retry")
def retry_task_endpoint(payload: RetryTaskRequest, request: Request):
    """指定タスクを再試行する（対象タスクをactiveにしてループを起こす）。"""
    _check_api_key(request)
    task_id = payload.task_id.strip()
    if not task_id:
        raise HTTPException(status_code=400, detail="task_id is empty")

    with _state_lock:
        target_goal = None
        target_task = None
        for goal in STATE["mission"]["goals"]:
            for task in goal.get("tasks", []):
                if task.get("id") == task_id:
                    target_goal = goal
                    target_task = task
                    break
            if target_task:
                break

        if not target_task:
            raise HTTPException(status_code=404, detail="Task not found")

        # 他のactiveタスクはpendingに戻す（再試行を優先）
        for goal in STATE["mission"]["goals"]:
            for task in goal.get("tasks", []):
                if task.get("status") == "active" and task.get("id") != task_id:
                    task["status"] = "pending"

        # 対象goalをactiveにして優先する
        for goal in STATE["mission"]["goals"]:
            if goal is target_goal:
                goal["status"] = "active"
            elif goal.get("status") == "active":
                goal["status"] = "pending"

        target_task["status"] = "active"
        clear_action(STATE)
        clear_result(STATE)
        update_thought(STATE, "タスク再試行", f"{task_id}")
        save_state(STATE)
        goal_id = target_goal["id"]

    append_event("system", action="retry_task", task_id=task_id, goal_id=goal_id)
    _loop_wake_event.set()
    return {"status": "retrying", "task_id": task_id, "goal_id": goal_id}


@app.post("/admin/approve")
def approve_action(request: Request):
    """承認待ちの行動を承認し、実行中に移行する。"""
    _check_api_key(request)
    with _state_lock:
        if not STATE.get("action"):
            raise HTTPException(status_code=400, detail="No action to approve")
        if STATE["action"]["phase"] != "approving":
            raise HTTPException(status_code=400, detail="Action is not awaiting approval")
        STATE["action"]["phase"] = "executing"
        save_state(STATE)
    append_event("action", phase="executing", summary=STATE["action"]["summary"])
    return {"action": STATE["action"]}


@app.post("/admin/reject")
def reject_action(request: Request):
    """承認待ちの行動を拒否し、タスクを失敗として処理する。"""
    _check_api_key(request)
    with _state_lock:
        if not STATE.get("action"):
            raise HTTPException(status_code=400, detail="No action to reject")
        if STATE["action"]["phase"] != "approving":
            raise HTTPException(status_code=400, detail="Action is not awaiting approval")
        summary = STATE["action"]["summary"]
        # activeなタスクをfailに更新。
        _mark_active_task("fail")
        clear_action(STATE)
        update_result(STATE, "fail", f"{_msg('拒否', 'Rejected')}: {summary}")
        save_state(STATE)
    append_event("result", status="fail", summary=f"{_msg('拒否', 'Rejected')}: {summary}")
    _loop_wake_event.set()  # ループを起こして次の処理へ
    return {"result": STATE["result"]}


@app.post("/admin/cancel")
def cancel_action(request: Request):
    """承認待ちの行動をキャンセルし、ユーザー介入を優先する。"""
    _check_api_key(request)
    with _state_lock:
        if not STATE.get("action"):
            raise HTTPException(status_code=400, detail="No action to cancel")
        if STATE["action"]["phase"] != "approving":
            raise HTTPException(status_code=400, detail="Action is not awaiting approval")
        summary = STATE["action"]["summary"]
        update_action(
            STATE,
            "awaiting_continue",
            _msg(f"キャンセル: {summary}", f"Canceled: {summary}"),
        )
        save_state(STATE)
    append_event("action", phase="canceled", summary=summary)
    _loop_wake_event.set()  # ループを起こして待機状態に移行
    return {"status": "canceled", "summary": summary}


class CompleteRequest(BaseModel):
    # タスク完了通知用。
    success: bool = True
    summary: Optional[str] = None


@app.post("/admin/complete")
def complete_action(payload: CompleteRequest, request: Request):
    # 現在の行動を完了し、タスクを更新する。
    _check_api_key(request)
    avatar_name = CONFIG.get("avatar", {}).get("name", "Avatar")
    run_cycle = False
    output_text = None
    summary = None
    success = payload.success
    with _state_lock:
        if not STATE.get("action"):
            raise HTTPException(status_code=400, detail="No action to complete")
        if STATE["action"]["phase"] != "executing":
            raise HTTPException(status_code=400, detail="Action is not executing")

        summary = payload.summary or STATE["action"]["summary"]
        success = payload.success

        if success:
            # 成功: タスクをdoneにして次へ
            _mark_active_task("done")
            clear_action(STATE)
            update_result(STATE, "done", summary)
            save_state(STATE)
            run_cycle = True
        else:
            # 失敗: 再試行/スキップ/コンテキスト入力を求める
            active_task = _get_active_task()
            task_name = active_task["name"] if active_task else "タスク"
            update_action(
                STATE,
                "awaiting_task_fail",
                f"タスク失敗: {summary}",
                data={"task_id": active_task["id"] if active_task else None, "summary": summary},
            )
            update_result(STATE, "fail", summary)
            save_state(STATE)
            # 失敗通知と選択肢を出力
            output_text = (
                f"{avatar_name}> "
                f"{_msg(f'タスク「{task_name}」が失敗しました: {summary}', f'Task \"{task_name}\" failed: {summary}')}\n"
                f"[r] {_msg('再試行', 'Retry')} / [s] {_msg('スキップ', 'Skip')} / {_msg('コンテキストを入力', 'Enter context')}"
            )

    if success:
        append_event("result", status="done", summary=summary)
        # 次のタスクを同期的に処理（ロック外）
        _cycle_step()
    else:
        append_event("result", status="fail", summary=summary)
        if output_text:
            append_event("output", pane="dialogue", text=output_text)

    # 次のアクション情報を含めて返す
    with _state_lock:
        next_action = copy.deepcopy(STATE.get("action"))
    
    return {"result": STATE["result"], "action": next_action}


@app.post("/admin/reset")
def reset_state(request: Request):
    """状態を初期化する。"""
    _check_api_key(request)
    with _state_lock:
        STATE["input"] = {"source": None, "authority": None, "text": None}
        STATE["mission"] = {"purpose": None, "purpose_type": None, "goals": []}
        STATE["thought"] = {"judgment": None, "intent": None}
        STATE["action"] = None
        STATE["result"] = None
        save_state(STATE)
    # 自律ループセッションもリセット（過去のコンテキストをクリア）
    _sessions.remove(_CORE_SESSION_ID)
    append_event("system", action="reset", summary="状態がリセットされました")
    # 目的を聞く
    _ask_for_purpose()
    # ループを起こす（無期限待機から抜ける）
    _loop_wake_event.set()
    return {"status": "reset", "message": "状態がリセットされました"}


@app.post("/admin/continue")
def continue_loop(request: Request):
    """続行確認に応答してループを再開する。"""
    _check_api_key(request)
    with _state_lock:
        if not STATE.get("action"):
            raise HTTPException(status_code=400, detail="No action awaiting continue")
        if STATE["action"]["phase"] != "awaiting_continue":
            raise HTTPException(status_code=400, detail="Action is not awaiting continue")
        clear_action(STATE)
        save_state(STATE)
    # ループを起こす（無期限待機から抜ける）
    _loop_wake_event.set()
    append_event("system", action="continue", summary="ループを続行")
    return {"status": "continued", "message": "ループを続行しました"}


def _get_active_task() -> Optional[dict]:
    """activeなタスクを取得する（ロック内で呼ぶこと）。"""
    for goal in STATE["mission"]["goals"]:
        for task in goal.get("tasks", []):
            if task["status"] == "active":
                return task
    return None


def _mark_active_task(status: str) -> None:
    """activeなタスクを指定のステータスに更新する（ロック内で呼ぶこと）。"""
    for goal in STATE["mission"]["goals"]:
        for task in goal.get("tasks", []):
            if task["status"] == "active":
                task["status"] = status
                return



@app.post("/admin/config")
def admin_config_update(payload: AdminConfigUpdate, request: Request):
    # 管理者向けに設定を更新し、反映する。
    _check_api_key(request)
    updates = payload.model, payload.temperature, payload.system_prompt, payload.language, payload.theme
    if all(value is None for value in updates):
        raise HTTPException(status_code=400, detail="No config values provided")

    updated = copy.deepcopy(CONFIG)
    if payload.model is not None:
        if not payload.model.strip():
            raise HTTPException(status_code=400, detail="model is empty")
        updated["grok"]["model"] = payload.model.strip()
    if payload.temperature is not None:
        if not 0.0 <= float(payload.temperature) <= 2.0:
            raise HTTPException(status_code=400, detail="temperature must be between 0.0 and 2.0")
        updated["grok"]["temperature"] = float(payload.temperature)
    if payload.system_prompt is not None:
        if not payload.system_prompt.strip():
            raise HTTPException(status_code=400, detail="system_prompt is empty")
        updated["system_prompt"] = payload.system_prompt.strip()
    if payload.language is not None:
        if not payload.language.strip():
            raise HTTPException(status_code=400, detail="language is empty")
        language = payload.language.strip().lower()
        if language not in ("ja", "en"):
            raise HTTPException(status_code=400, detail="language must be one of: ja, en")
        updated["user"]["language"] = language
    if payload.theme is not None:
        if not payload.theme.strip():
            raise HTTPException(status_code=400, detail="theme is empty")
        theme_name = payload.theme.strip()
        ui = updated.get("console_ui")
        if not isinstance(ui, dict):
            raise HTTPException(status_code=500, detail="console_ui is missing")
        themes = ui.get("themes") or []
        if not isinstance(themes, list) or not themes:
            raise HTTPException(status_code=400, detail="themes are not configured")
        selected = None
        names = []
        for theme in themes:
            if not isinstance(theme, dict):
                continue
            name = str(theme.get("name", "")).strip()
            if not name:
                continue
            names.append(name)
            if name.lower() == theme_name.lower():
                selected = theme
                theme_name = name
        if not selected:
            raise HTTPException(status_code=400, detail=f"theme must be one of: {', '.join(names)}")
        for key in ("theme_color", "user_color", "tool_color"):
            if key not in selected:
                raise HTTPException(status_code=400, detail=f"theme.{key} is missing")
        ui["theme"] = theme_name
        ui["theme_color"] = selected["theme_color"]
        ui["user_color"] = selected["user_color"]
        ui["tool_color"] = selected["tool_color"]

    _save_config(updated)
    CONFIG.clear()
    CONFIG.update(updated)
    _sessions.reset()
    grok = CONFIG["grok"]
    return {
        "model": grok["model"],
        "temperature": grok["temperature"],
        "system_prompt": CONFIG["system_prompt"],
        "language": CONFIG["user"]["language"],
        "theme": CONFIG.get("console_ui", {}).get("theme"),
    }


@app.post("/admin/observation")
def admin_observation(payload: ObservationRequest, request: Request):
    """ターミナル実行結果を受け取り、LLMで差分検証を行う。"""
    _check_api_key(request)
    
    # 後方互換: contentのみの場合
    if payload.content and not payload.command:
        chat = _sessions.get_chat(payload.session_id)
        chat.append(system(f"TERMINAL_RESULT:\n{payload.content}"))
        return {"status": "ok", "success": True, "summary": "completed"}
    
    # 新形式: command + output でLLM検証
    command = payload.command or ""
    output = payload.output or "(no output)"
    label = payload.label or command
    
    # 現在のタスクの成功条件を取得
    with _state_lock:
        active_task = None
        for goal in STATE.get("mission", {}).get("goals", []):
            for task in goal.get("tasks", []):
                if task.get("status") == "active":
                    active_task = task
                    break
            if active_task:
                break
        success_condition = active_task.get("name", label) if active_task else label
    
    # LLMに差分検証を依頼（出力形式を最終形式に統一）
    chat = _sessions.get_chat(_CORE_SESSION_ID)
    verify_prompt = f"""以下のコマンド実行結果を検証してください。

タスク: {success_condition}
コマンド: {command}
出力:
{output[:1000]}

結果を1行で回答してください（他の文言は不要）:
- 成功: done: [タスク要約]
- 失敗: failed: [失敗理由]
"""
    chat.append(user(verify_prompt))
    response = _sample_with_timeout(chat)
    _track_usage(response)
    
    response_text = (getattr(response, "content", "") or "").strip()
    
    # 成功/失敗と要約を解析
    if response_text.lower().startswith("done:"):
        success = True
        message = response_text[5:].strip() or label
    elif response_text.lower().startswith("failed:"):
        success = False
        message = response_text[7:].strip() or label
    else:
        # パース失敗時はデフォルトで成功扱い
        success = True
        message = label
    
    # セッションに結果を追加
    result_label = "done" if success else "failed"
    chat.append(system(f"TASK_RESULT: {result_label}: {message}"))
    
    return {"status": "ok", "success": success, "message": f"{result_label}: {message}"}


@app.post("/admin/console-log")
def admin_console_log(payload: ConsoleLogRequest, request: Request):
    """Consoleの出力ログを保存する。"""
    _check_api_key(request)
    kind = payload.kind.strip()
    if not kind:
        raise HTTPException(status_code=400, detail="kind is empty")
    text = payload.text
    if not text.strip():
        raise HTTPException(status_code=400, detail="text is empty")
    entry = {
        "session_id": payload.session_id,
        "run_id": payload.run_id,
        "seq": payload.seq,
        "kind": kind,
        "text": text,
        "pane": payload.pane,
        "client_time": payload.client_time,
    }
    entry = {key: value for key, value in entry.items() if value is not None}
    append_console_log(**entry)
    return {"status": "ok"}


# --- Exec Contract: Backend Router ---

def _dialogue_backend_handler(request: ExecRequest) -> ExecResult:
    """Dialogue Backend: think_coreを使って対話を処理する。"""
    import time
    start_time = time.time()

    content = request.params.get("content", "")
    if not content:
        return ExecResult(
            request_id=request.id,
            status=ExecStatus.FAIL,
            summary="No content provided",
            error="params.content is required for dialogue",
        )

    try:
        # think_coreを呼び出して対話を処理する。
        result = think_core(
            source="dialogue",
            text=content,
            session_id=request.params.get("session_id", "default"),
        )
        duration_ms = int((time.time() - start_time) * 1000)

        return ExecResult(
            request_id=request.id,
            status=ExecStatus.DONE,
            summary=result.get("response", "")[:100],  # 最初の100文字
            duration_ms=duration_ms,
        )
    except Exception as e:
        return ExecResult(
            request_id=request.id,
            status=ExecStatus.FAIL,
            summary="Dialogue execution failed",
            error=str(e),
        )


# Backend Routerインスタンス
_backend_router = BackendRouter(
    dialogue_handler=_dialogue_backend_handler,
    space=get_avatar_space(CONFIG),
)


class ExecRequestPayload(BaseModel):
    backend: str
    action: str
    params: dict = {}
    cwd: str = None
    timeout: int = None
    capability_ref: str = None
    authority: str = "avatar"  # user or avatar


@app.post("/v1/exec")
def exec_request(payload: ExecRequestPayload, request: Request):
    """ExecRequestを受けてBackend Routerにルーティングする。"""
    _check_api_key(request)

    try:
        authority = Authority(payload.authority)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid authority: {payload.authority}")

    try:
        exec_req = ExecRequest(
            backend=Backend(payload.backend),
            action=payload.action,
            params=payload.params,
            cwd=payload.cwd,
            timeout=payload.timeout,
            capability_ref=payload.capability_ref,
            authority=authority,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid backend: {payload.backend}")

    result = _backend_router.route(exec_req)
    return result.to_dict()


# --- Robloxチャネルをルーターとして統合 ---
try:
    from channels.roblox import router as roblox_router
except ModuleNotFoundError:
    roblox_router = None

if roblox_router is not None:
    app.include_router(roblox_router)
