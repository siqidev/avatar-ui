#!/usr/bin/env python3
"""
Roblox チャネル（ルーター）。
旧WorkersのI/Fを維持しつつ、コアを直接呼び出す。
"""
from __future__ import annotations

import os
import threading
import time
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# 旧Workersと同じCORSヘッダー（X-API-Keyを許可に追加）。
CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
}

# 共有APIキーは必須。未設定なら起動時に止める。
_AVATAR_API_KEY = os.getenv("AVATAR_API_KEY")
if not _AVATAR_API_KEY:
    raise RuntimeError("AVATAR_API_KEY is not set")


class RobloxRequest(BaseModel):
    # 旧Workers互換: promptとprevious_response_idを受け取る。
    prompt: Optional[str] = None
    previous_response_id: Optional[str] = None


class _SessionMap:
    def __init__(self, ttl_seconds: int = 3600):
        # previous_response_id -> session_id の対応表を保持する。
        self._ttl_seconds = ttl_seconds
        self._items: dict[str, tuple[str, float]] = {}
        self._lock = threading.Lock()

    def resolve(self, response_id: Optional[str]) -> Optional[str]:
        # 既存のresponse_idがあれば対応するsession_idを返す。
        if not response_id:
            return None
        now = time.time()
        with self._lock:
            self._purge_expired(now)
            item = self._items.get(response_id)
            if not item:
                return None
            session_id, _ = item
            self._items[response_id] = (session_id, now)
            return session_id

    def bind(self, response_id: str, session_id: str) -> None:
        # 新しいresponse_idをsession_idに紐づける。
        now = time.time()
        with self._lock:
            self._purge_expired(now)
            self._items[response_id] = (session_id, now)

    def _purge_expired(self, now: float) -> None:
        # 放置された対応表を削除する。
        expired = [
            rid
            for rid, (_, last_used) in self._items.items()
            if now - last_used > self._ttl_seconds
        ]
        for rid in expired:
            self._items.pop(rid, None)


_sessions = _SessionMap()

# FastAPI Router（コアに統合される）。
router = APIRouter(tags=["roblox"])


def _check_api_key(request: Request) -> None:
    """APIキー認証。共有APIキーは必須。"""
    provided = request.headers.get("x-api-key")
    if provided != _AVATAR_API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")


def _reply(success: bool, text: str = "", response_id: Optional[str] = None, error: Optional[str] = None):
    # 旧Workersと同じ形で返す。
    body = {"success": success, "text": text, "response_id": response_id}
    if error:
        body["error"] = error
    return JSONResponse(body, headers=CORS_HEADERS)


@router.options("/roblox")
def options_roblox():
    # プリフライト対応（旧Workers互換）。認証不要。
    return JSONResponse({}, headers=CORS_HEADERS)


@router.post("/roblox")
def roblox(payload: RobloxRequest, request: Request):
    # 旧Workers互換エンドポイント。コアを直接呼び出す。
    from core.main import think_core

    # APIキー認証
    _check_api_key(request)

    # promptは必須。無ければ即エラーにする。
    if not payload.prompt or not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="prompt is required")
    prompt = payload.prompt.strip()

    # previous_response_idがあれば、それに対応するsession_idを使う。
    session_id = _sessions.resolve(payload.previous_response_id)
    if not session_id:
        # 初回は新しいsession_idを作る。
        session_id = f"roblox-{uuid.uuid4().hex}"

    try:
        core_result = think_core("roblox", prompt, session_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    text = core_result.get("response", "")

    # 旧Workersのように新しいresponse_idを返す。
    response_id = core_result.get("response_id")
    if not response_id:
        raise HTTPException(status_code=502, detail="response_id is missing")
    _sessions.bind(response_id, session_id)

    return _reply(True, text=text, response_id=response_id)
