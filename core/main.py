#!/usr/bin/env python3
"""
Avatar Core API Server.
全てのチャネルはここを経由し、xai-sdkはここでのみ使う。
"""
from __future__ import annotations

import copy
import json
import os
import threading
import time
from typing import Optional

import yaml
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from xai_sdk import Client
from xai_sdk.chat import system, user

from core.state import (
    load_state,
    save_state,
    append_event,
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

# .envを読み込み、ローカル開発の環境変数を使えるようにする。
load_dotenv()

# config.yamlはプロジェクトルート直下を正本とする。
_BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
_DEFAULT_CONFIG_PATH = os.path.join(_BASE_DIR, "config.yaml")
CONFIG_PATH = os.getenv("SPECTRA_CONFIG", _DEFAULT_CONFIG_PATH)
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
    return config


CONFIG = _load_config()

# 起動時にstate.jsonを読み込む。
STATE = load_state()
_state_lock = threading.Lock()

# xai-sdkはAPIキー必須なので、未設定なら即エラーにする。
_XAI_API_KEY = os.getenv("XAI_API_KEY")
if not _XAI_API_KEY:
    raise RuntimeError("XAI_API_KEY is not set")

# 共有APIキーは必須。未設定なら起動時に止める。
_SPECTRA_API_KEY = os.getenv("SPECTRA_API_KEY")
if not _SPECTRA_API_KEY:
    raise RuntimeError("SPECTRA_API_KEY is not set")


# リクエスト間で共有するSDKクライアント（初期化コストを節約）。
_client = Client(api_key=_XAI_API_KEY)


def _build_system_prompt() -> str:
    """人格と行動原則を定義する。"""
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

## 基本設定
{CONFIG.get("system_prompt", "")}
"""


def _build_state_context() -> str:
    """現在の状態をコンテキストとして生成する（毎回呼ばれる）。"""
    with _state_lock:
        state_copy = copy.deepcopy(STATE)

    plan = state_copy.get("plan", {})
    purpose = plan.get("purpose") or "（未設定）"
    goals = plan.get("goals", [])

    goals_summary = ""
    if goals:
        for g in goals:
            goals_summary += f"- {g['id']}: {g['name']} ({g['status']})\n"
            for t in g.get("tasks", []):
                goals_summary += f"  - {t['id']}: {t['name']} ({t['status']})\n"
    else:
        goals_summary = "（なし）"

    return f"""[現在の状態]
目的: {purpose}
目標とタスク:
{goals_summary}"""


def _new_chat():
    # 新規チャットを作成し、動的システムプロンプトを注入する。
    grok = CONFIG["grok"]
    chat = _client.chat.create(
        model=grok["model"],
        temperature=float(grok["temperature"]),
    )
    chat.append(system(_build_system_prompt()))
    return chat


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


_sessions = _SessionStore()


class ThinkRequest(BaseModel):
    # 新設計: source/text/session_id。authorityはsourceから自動導出。
    source: str  # chat | cli | discord | roblox | x
    text: str
    session_id: str


# sourceからauthorityを導出するマッピング。
_AUTHORITY_MAP = {
    "chat": "user",
    "cli": "user",
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


class ObservationRequest(BaseModel):
    # CLIなどの観測結果をセッションに追加する。
    session_id: str
    content: str


def think_core(source: str, text: str, session_id: str) -> dict:
    """
    コア推論関数（内部用）。
    全てのチャネルはこの関数を経由する。
    """
    authority = _get_authority(source)

    # 入力状態を更新し、イベントを記録する。
    with _state_lock:
        update_input(STATE, source, authority, text)
        save_state(STATE)
    append_event("input", source=source, text=text)

    chat = _sessions.get_chat(session_id)
    # 状態コンテキストを付加してLLMに渡す
    context = _build_state_context()
    chat.append(user(f"{context}\n\n{text}"))
    response = chat.sample()

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
    judgment = f"入力: {text[:50]}..." if len(text) > 50 else f"入力: {text}"
    intent = "会話応答" if intent_info["intent"] == "conversation" else f"実行: {intent_info['proposal']['summary'] if intent_info.get('proposal') else '不明'}"
    with _state_lock:
        update_thought(STATE, judgment, intent)
        # 行動が必要な場合は承認待ち状態にする
        if needs_approval:
            summary = intent_info["proposal"]["summary"] if intent_info.get("proposal") else "不明な操作"
            update_action(STATE, "approving", summary)
        else:
            clear_action(STATE)
        save_state(STATE)
    append_event("thought", judgment=judgment, intent=intent)

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
            "Return JSON only. Keys: intent (conversation|action), "
            "route (chat|cli), proposal (object with command and summary or null). "
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
    raw = getattr(result, "content", "")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Intent classification returned invalid JSON") from exc
    if data.get("intent") not in ("conversation", "action"):
        raise RuntimeError("Intent classification intent is invalid")
    if data.get("route") not in ("chat", "cli"):
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


def _check_api_key(request: Request) -> None:
    # 共有APIキーは必須なので一致しない場合は即拒否する。
    provided = request.headers.get("x-api-key")
    if provided != _SPECTRA_API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.post("/v1/think")
def think(payload: ThinkRequest, request: Request):
    # コア推論エンドポイント（外部API用）。
    _check_api_key(request)

    result = think_core(payload.source, payload.text, payload.session_id)
    return JSONResponse(result)


@app.get("/health")
def health():
    # 死活監視用のシンプルな応答。
    return {"status": "ok"}


@app.get("/console-config")
def console_config(request: Request):
    # Console UI向けの最小設定を返す。
    _check_api_key(request)
    if "console_ui" not in CONFIG:
        raise HTTPException(status_code=500, detail="console_ui is missing")
    return {"console_ui": CONFIG["console_ui"]}


@app.get("/admin/config")
def admin_config(request: Request):
    # 管理者向けに変更可能項目だけ返す。
    _check_api_key(request)
    grok = CONFIG["grok"]
    return {
        "model": grok["model"],
        "temperature": grok["temperature"],
        "system_prompt": CONFIG["system_prompt"],
    }


@app.get("/state")
def get_state(request: Request):
    # 現在の状態を返す。
    _check_api_key(request)
    with _state_lock:
        return copy.deepcopy(STATE)


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
    return {"purpose": STATE["plan"]["purpose"]}


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
    return {"goals": STATE["plan"]["goals"]}


class TaskRequest(BaseModel):
    goal_id: str
    task_id: str
    name: str


@app.post("/admin/task")
def add_task_endpoint(payload: TaskRequest, request: Request):
    # タスクを追加する。
    _check_api_key(request)
    if not payload.goal_id.strip() or not payload.task_id.strip() or not payload.name.strip():
        raise HTTPException(status_code=400, detail="goal_id, task_id or name is empty")
    with _state_lock:
        add_task(STATE, payload.goal_id.strip(), payload.task_id.strip(), payload.name.strip())
        save_state(STATE)
    return {"goals": STATE["plan"]["goals"]}


@app.post("/admin/approve")
def approve_action(request: Request):
    # 現在の行動を承認し、実行フェーズに移行する。
    _check_api_key(request)
    with _state_lock:
        if not STATE.get("action"):
            raise HTTPException(status_code=400, detail="No action to approve")
        if STATE["action"]["phase"] != "approving":
            raise HTTPException(status_code=400, detail="Action is not awaiting approval")
        update_action(STATE, "executing", STATE["action"]["summary"])
        save_state(STATE)
    append_event("action", summary=STATE["action"]["summary"])
    return {"action": STATE["action"]}


@app.post("/admin/reject")
def reject_action(request: Request):
    # 現在の行動を拒否し、クリアする。
    _check_api_key(request)
    with _state_lock:
        if not STATE.get("action"):
            raise HTTPException(status_code=400, detail="No action to reject")
        summary = STATE["action"]["summary"]
        clear_action(STATE)
        update_result(STATE, "fail", f"拒否: {summary}")
        save_state(STATE)
    append_event("result", status="fail", summary=f"拒否: {summary}")
    return {"result": STATE["result"]}


@app.post("/admin/config")
def admin_config_update(payload: AdminConfigUpdate, request: Request):
    # 管理者向けに設定を更新し、反映する。
    _check_api_key(request)
    updates = payload.model, payload.temperature, payload.system_prompt
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

    _save_config(updated)
    CONFIG.clear()
    CONFIG.update(updated)
    _sessions.reset()
    grok = CONFIG["grok"]
    return {
        "model": grok["model"],
        "temperature": grok["temperature"],
        "system_prompt": CONFIG["system_prompt"],
    }


@app.post("/admin/observation")
def admin_observation(payload: ObservationRequest, request: Request):
    # CLI実行結果などをセッションに追加する。
    _check_api_key(request)
    if not payload.content.strip():
        raise HTTPException(status_code=400, detail="content is empty")
    chat = _sessions.get_chat(payload.session_id)
    chat.append(system(f"CLI_RESULT:\n{payload.content}"))
    return {"status": "ok"}


# --- Robloxチャネルをルーターとして統合 ---
from channels.roblox import router as roblox_router

app.include_router(roblox_router)
