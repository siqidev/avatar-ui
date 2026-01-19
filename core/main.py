#!/usr/bin/env python3
"""
SPECTRAのコアAPIサーバー（正本）。
アダプタはここだけを呼び、xai-sdkはここでのみ使う。
"""
from __future__ import annotations

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

# .envを読み込み、ローカル開発の環境変数を使えるようにする。
load_dotenv()

# config.yamlは標準の場所があるので、環境変数があれば優先する。
CONFIG_PATH = os.getenv("SPECTRA_CONFIG", "config.yaml")
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
    # コアに必須のキーは起動時に検証しておく。
    for key in ("model", "system_prompt"):
        if key not in config:
            raise RuntimeError(f"{key} is missing in config")
    return config


CONFIG = _load_config()

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


def _new_chat():
    # 新規チャットを作成し、人格プロンプトを注入する。
    chat = _client.chat.create(model=CONFIG["model"])
    chat.append(system(CONFIG["system_prompt"]))
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


_sessions = _SessionStore()


class ThinkRequest(BaseModel):
    # 最小構成: 入力とセッションIDのみ。
    prompt: str
    session_id: str
    channel: Optional[str] = None


def think_core(prompt: str, session_id: str) -> dict:
    """
    コア推論関数（内部用）。
    アダプタはこの関数を直接呼び出す。
    """
    chat = _sessions.get_chat(session_id)
    chat.append(user(prompt))
    response = chat.sample()

    # 応答本文とレスポンスIDは必須。欠落時は即エラーにする。
    text = getattr(response, "content", None)
    response_id = getattr(response, "id", None)
    if not text:
        raise RuntimeError("Core response content is missing")
    if not response_id:
        raise RuntimeError("Core response_id is missing")

    return {
        "response": text,
        "session_id": session_id,
        "response_id": response_id,
    }


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

    result = think_core(payload.prompt, payload.session_id)
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


# --- Robloxチャネルをルーターとして統合 ---
from channels.roblox import router as roblox_router

app.include_router(roblox_router)
