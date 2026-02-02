"""
Exec Contract: 実行の抽象化レイヤー。
多様な実行先（Terminal/Roblox/Dialogue/X）を統一的に扱う。
"""
from __future__ import annotations

import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Optional


class Authority(str, Enum):
    """操作元の権限。"""
    USER = "user"
    AVATAR = "avatar"


class Backend(str, Enum):
    """実行先の種類。"""
    TERMINAL = "terminal"
    ROBLOX = "roblox"
    DIALOGUE = "dialogue"
    X = "x"


class ExecStatus(str, Enum):
    """実行結果のステータス。"""
    DONE = "done"
    FAIL = "fail"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"


class StreamType(str, Enum):
    """ストリームの種類。"""
    STDOUT = "stdout"
    STDERR = "stderr"
    STATUS = "status"
    PROGRESS = "progress"


@dataclass
class ExecRequest:
    """実行要求。"""
    backend: Backend
    action: str
    params: dict[str, Any]
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    cwd: Optional[str] = None
    timeout: Optional[int] = None
    capability_ref: Optional[str] = None
    authority: Authority = Authority.AVATAR  # デフォルトはアバター

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "backend": self.backend.value,
            "action": self.action,
            "params": self.params,
            "cwd": self.cwd,
            "timeout": self.timeout,
            "capability_ref": self.capability_ref,
            "authority": self.authority.value,
        }

    @classmethod
    def from_dict(cls, data: dict) -> ExecRequest:
        authority = Authority(data.get("authority", "avatar"))
        return cls(
            id=data.get("id", str(uuid.uuid4())),
            backend=Backend(data["backend"]),
            action=data["action"],
            params=data.get("params", {}),
            cwd=data.get("cwd"),
            timeout=data.get("timeout"),
            capability_ref=data.get("capability_ref"),
            authority=authority,
        )


@dataclass
class ExecStream:
    """実行中ストリーム。"""
    request_id: str
    type: StreamType
    data: str
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")

    def to_dict(self) -> dict:
        return {
            "request_id": self.request_id,
            "type": self.type.value,
            "data": self.data,
            "timestamp": self.timestamp,
        }


@dataclass
class ExecResult:
    """実行結果。"""
    request_id: str
    status: ExecStatus
    summary: str
    exit_code: Optional[int] = None
    artifacts: Optional[list[str]] = None
    duration_ms: Optional[int] = None
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "request_id": self.request_id,
            "status": self.status.value,
            "summary": self.summary,
            "exit_code": self.exit_code,
            "artifacts": self.artifacts,
            "duration_ms": self.duration_ms,
            "error": self.error,
        }


def get_avatar_space(config: dict = None) -> str:
    """Avatar Spaceのパスを返す（優先順位: 環境変数 > config > デフォルト）。"""
    home = os.environ.get("HOME") or os.environ.get("USERPROFILE") or ""
    default = os.path.join(home, "Avatar", "space")
    return (
        os.environ.get("AVATAR_SPACE") or
        (config.get("avatar_space") if config else None) or
        default
    )


def is_path_in_space(path: str, space: str) -> bool:
    """指定されたパスがAvatar Space内にあるか確認する。"""
    if not path or not space:
        return False
    try:
        path_resolved = Path(path).resolve()
        space_resolved = Path(space).resolve()
        return path_resolved == space_resolved or space_resolved in path_resolved.parents
    except Exception:
        return False


@dataclass
class AvatarSpaceViolation:
    """Avatar Space制約違反。"""
    path: str
    space: str
    authority: Authority
    is_blocked: bool  # True=拒否, False=警告のみ
    message: str


class BackendRouter:
    """Backend Router: ExecRequestを適切なBackendにルーティングする。"""

    def __init__(self, dialogue_handler=None, space: Optional[str] = None):
        """
        Args:
            dialogue_handler: Dialogue Backend用のハンドラ関数。
                              (action, params) -> ExecResult を返す。
            space: Avatar Spaceパス。未指定ならデフォルト。
        """
        self._dialogue_handler = dialogue_handler
        self._space = space or get_avatar_space()

    def check_space_constraint(self, request: ExecRequest) -> Optional[AvatarSpaceViolation]:
        """Avatar Space制約を確認する。違反がなければNone。"""
        # Terminal Backendのみcwd検証
        if request.backend != Backend.TERMINAL:
            return None

        cwd = request.cwd
        if not cwd:
            return None

        if is_path_in_space(cwd, self._space):
            return None

        # Avatar Space外へのアクセス
        is_blocked = request.authority == Authority.AVATAR
        message = (
            f"Avatar Space violation: {cwd} is outside Avatar Space {self._space}"
            if is_blocked
            else f"Warning: {cwd} is outside Avatar Space {self._space}"
        )
        return AvatarSpaceViolation(
            path=cwd,
            space=self._space,
            authority=request.authority,
            is_blocked=is_blocked,
            message=message,
        )

    def route(self, request: ExecRequest) -> ExecResult:
        """ExecRequestを適切なBackendにルーティングして実行する。"""
        # Avatar Space制約を確認
        violation = self.check_space_constraint(request)
        if violation and violation.is_blocked:
            return ExecResult(
                request_id=request.id,
                status=ExecStatus.FAIL,
                summary="Avatar Space constraint violation",
                error=violation.message,
            )
        # 警告の場合はログ出力（将来的にはイベント記録）
        if violation:
            print(f"[WARN] {violation.message}")

        if request.backend == Backend.DIALOGUE:
            return self._handle_dialogue(request)
        elif request.backend == Backend.TERMINAL:
            return self._handle_terminal(request)
        elif request.backend == Backend.ROBLOX:
            return self._handle_roblox(request)
        elif request.backend == Backend.X:
            return self._handle_x(request)
        else:
            return ExecResult(
                request_id=request.id,
                status=ExecStatus.FAIL,
                summary=f"Unknown backend: {request.backend}",
                error=f"Backend '{request.backend}' is not supported",
            )

    def _handle_dialogue(self, request: ExecRequest) -> ExecResult:
        """Dialogue Backend: 対話応答を処理する。"""
        if not self._dialogue_handler:
            return ExecResult(
                request_id=request.id,
                status=ExecStatus.FAIL,
                summary="Dialogue handler not configured",
                error="No dialogue handler registered",
            )
        try:
            return self._dialogue_handler(request)
        except Exception as e:
            return ExecResult(
                request_id=request.id,
                status=ExecStatus.FAIL,
                summary="Dialogue execution failed",
                error=str(e),
            )

    def _handle_terminal(self, request: ExecRequest) -> ExecResult:
        """Terminal Backend: Console側PTYで実行（現状は通知のみ）。"""
        # Terminal実行はConsole側で行うため、ここでは通知のみ。
        # 将来的にはWebSocket等でConsoleに通知してPTY実行を依頼する。
        return ExecResult(
            request_id=request.id,
            status=ExecStatus.FAIL,
            summary="Terminal execution should be handled by Console",
            error="Terminal backend is handled by Console (PTY), not Core",
        )

    def _handle_roblox(self, request: ExecRequest) -> ExecResult:
        """Roblox Backend: ゲーム内行動（未実装）。"""
        return ExecResult(
            request_id=request.id,
            status=ExecStatus.FAIL,
            summary="Roblox backend not implemented",
            error="Roblox backend is not yet implemented",
        )

    def _handle_x(self, request: ExecRequest) -> ExecResult:
        """X Backend: SNS操作（未実装）。"""
        return ExecResult(
            request_id=request.id,
            status=ExecStatus.FAIL,
            summary="X backend not implemented",
            error="X backend is not yet implemented",
        )
