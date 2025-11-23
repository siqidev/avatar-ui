import json
import os
from pathlib import Path
from typing import List

from pydantic import BaseModel, Field, ValidationError, field_validator
from pydantic_settings import BaseSettings
from dotenv import load_dotenv

# プロジェクトルートのパス
ROOT_DIR = Path(__file__).resolve().parent.parent.parent

# 設定ファイルのパス
SETTINGS_PATH = ROOT_DIR / "settings.json"
DEFAULT_SETTINGS_PATH = ROOT_DIR / "settings.default.json"
ENV_PATH = ROOT_DIR / ".env"

# .env を環境変数として読み込む（従来挙動を維持）
load_dotenv(ENV_PATH)

# CORS のデフォルト（dev用）
DEFAULT_ALLOWED_ORIGINS_DEV = [
    "http://localhost:{port}",
    "http://127.0.0.1:{port}",
]

# ---------- Pydantic モデル定義 ----------

class NameTags(BaseModel, extra="forbid"):
    user: str
    avatar: str
    avatarFullName: str


class SystemMessages(BaseModel, extra="forbid"):
    banner1: str
    banner2: str


class UiSettings(BaseModel, extra="forbid"):
    themeColor: str
    userColor: str
    toolColor: str
    typeSpeed: int
    opacity: float
    soundVolume: float
    mouthInterval: int
    beepFrequency: int
    beepDuration: float
    beepVolumeEnd: float
    nameTags: NameTags
    systemMessages: SystemMessages


class ServerSettings(BaseModel, extra="forbid"):
    llmModel: str
    systemPrompt: str
    logMaxBytes: int = Field(gt=0)
    logBackupCount: int = Field(ge=0)


class AppSettings(BaseModel, extra="forbid"):
    server: ServerSettings
    ui: UiSettings


class EnvSettings(BaseSettings):
    google_api_key: str = Field(alias="GOOGLE_API_KEY")
    ag_ui_agent_name: str = Field(alias="AG_UI_AGENT_NAME")
    server_host: str = Field(alias="SERVER_HOST")
    server_port: int = Field(alias="SERVER_PORT", ge=1, le=65535)
    client_port: int = Field(alias="CLIENT_PORT", ge=1, le=65535)
    app_env: str = Field(default="dev", alias="APP_ENV")
    log_body: bool | None = Field(default=None, alias="LOG_BODY")
    @field_validator("google_api_key", "ag_ui_agent_name", "server_host")
    @classmethod
    def non_empty(cls, v: str, info):
        if not v or not v.strip():
            raise ValueError(f"{info.field_name} must be non-empty")
        return v.strip()

    model_config = {
        "env_file": str(ENV_PATH),
        "env_file_encoding": "utf-8",
        "extra": "forbid",
    }


# ---------- JSON 設定の読み込み ----------

def load_settings_json() -> AppSettings:
    """
    settings.json を読み込み、なければ settings.default.json を使う。
    """
    if SETTINGS_PATH.exists():
        path_to_load = SETTINGS_PATH
        print(f"Loading config from: {SETTINGS_PATH}")
    elif DEFAULT_SETTINGS_PATH.exists():
        path_to_load = DEFAULT_SETTINGS_PATH
        print(f"Loading config from: {DEFAULT_SETTINGS_PATH} (Default)")
    else:
        raise RuntimeError(f"Config Error: Neither {SETTINGS_PATH} nor {DEFAULT_SETTINGS_PATH} found.")

    try:
        with open(path_to_load, "r", encoding="utf-8") as f:
            raw = json.load(f)
        return AppSettings.model_validate(raw)
    except ValidationError as e:
        raise RuntimeError(f"Config Error: settings validation failed: {e}") from e
    except Exception as e:
        raise RuntimeError(f"Error loading settings from {path_to_load}: {e}") from e


# ---------- 環境変数の読み込み ----------

def load_env_settings() -> EnvSettings:
    try:
        return EnvSettings()  # BaseSettings が .env を読む
    except ValidationError as e:
        raise RuntimeError(f"Config Error: environment validation failed: {e}") from e


# ---------- 公開値（既存インターフェース互換） ----------

env_settings = load_env_settings()
app_settings = load_settings_json()

GOOGLE_API_KEY = env_settings.google_api_key
AG_UI_AGENT_NAME = env_settings.ag_ui_agent_name
SERVER_HOST = env_settings.server_host
SERVER_PORT = env_settings.server_port
CLIENT_PORT = env_settings.client_port
APP_ENV = env_settings.app_env
LOG_BODY = env_settings.log_body
# CORS origins:
# - デフォルト: dev 用に localhost/127.0.0.1:CLIENT_PORT を許可
# - 本番で別オリジンを許可したい場合だけ .env の ALLOWED_ORIGINS をカンマ区切りで指定
allowed_origins_env = os.getenv("ALLOWED_ORIGINS")
if allowed_origins_env:
    CORS_ORIGINS: List[str] = [o.strip() for o in allowed_origins_env.split(",") if o.strip()]
else:
    CORS_ORIGINS: List[str] = [o.format(port=CLIENT_PORT) for o in DEFAULT_ALLOWED_ORIGINS_DEV]

LLM_MODEL = app_settings.server.llmModel
SYSTEM_PROMPT = app_settings.server.systemPrompt
LOG_MAX_BYTES = app_settings.server.logMaxBytes
LOG_BACKUP_COUNT = app_settings.server.logBackupCount

# FastAPI の /agui/config で返すために dict で保持
_ui_settings = app_settings.ui.model_dump()
