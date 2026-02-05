# 設定の読み込みと検証（.env + settings.json5）
import pyjson5 as json
import os
from pathlib import Path
from typing import List

from pydantic import BaseModel, Field, ValidationError, field_validator
from pydantic_settings import BaseSettings
from dotenv import load_dotenv

# ---------- パス定義 ----------
ROOT_DIR = Path(__file__).resolve().parent.parent.parent

# 設定ファイルの候補パス（JSON5に統一）
SETTINGS_CANDIDATES = [
    ROOT_DIR / "settings.json5",
]
DEFAULT_SETTINGS_CANDIDATES = [
    ROOT_DIR / "settings.default.json5",
]
ENV_PATH = ROOT_DIR / ".env"

# .env を環境変数として読み込む（従来挙動を維持）
load_dotenv(ENV_PATH)

# CORS のデフォルト（dev用）
DEFAULT_ALLOWED_ORIGINS_DEV = [
    "http://localhost:{port}",
    "http://127.0.0.1:{port}",
]

# ---------- Pydantic モデル定義（settings.json5 のスキーマ） ----------

# UI の名前タグ設定
class NameTags(BaseModel, extra="forbid"):
    user: str
    avatar: str
    avatarFullName: str


# 起動時に表示するシステムメッセージ
class SystemMessages(BaseModel, extra="forbid"):
    banner1: str
    banner2: str


# UI 全般の設定
class UiSettings(BaseModel, extra="forbid"):
    typeSpeed: int
    opacity: float
    soundVolume: float
    mouthInterval: int
    beepFrequency: int
    beepDuration: float
    beepVolumeEnd: float
    avatarOverlayOpacity: float
    avatarBrightness: float
    brightness: float
    glowText: float
    glowBox: float
    nameTags: NameTags
    systemMessages: SystemMessages
    theme: str = "classic"
    themes: List["ThemePreset"] | None = None


# カラーテーマのプリセット定義
class ThemePreset(BaseModel, extra="forbid"):
    name: str
    themeColor: str
    userColor: str
    toolColor: str


# サーバー側の設定（LLM プロバイダ、プロンプト等）
class ServerSettings(BaseModel, extra="forbid"):
    llmProvider: str = "gemini"  # gemini | openai | anthropic
    llmModel: str
    searchSubAgent: "SearchSubAgent" = Field(default_factory=lambda: SearchSubAgent())
    systemPrompt: str
    logMaxBytes: int = Field(gt=0)
    logBackupCount: int = Field(ge=0)


# 検索サブエージェントの設定（Gemini + google_search を使用）
class SearchSubAgent(BaseModel, extra="forbid"):
    enabled: bool = True
    model: str = "gemini-2.5-flash"


# settings.json5 のルートスキーマ
class AppSettings(BaseModel, extra="forbid"):
    server: ServerSettings
    ui: UiSettings


# ---------- テーマ解決 ----------

def resolve_theme(ui: UiSettings) -> dict:
    """
    テーマプリセットを解決し、実際に使う色を決定する。
    - ui.theme で指定されたプリセットがあればそれを基準にする
    - 個別指定（themeColor など）があればプリセットより優先する
    """
    resolved = ui.model_dump()
    if ui.themes:
        for preset in ui.themes:
            if preset.name == ui.theme:
                resolved["themeColor"] = preset.themeColor
                resolved["userColor"] = preset.userColor
                resolved["toolColor"] = preset.toolColor
                break
    resolved.pop("themes", None)
    return resolved


# .env から読み込む環境変数のスキーマ
class EnvSettings(BaseSettings):
    google_api_key: str = Field(alias="GOOGLE_API_KEY")
    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    anthropic_api_key: str | None = Field(default=None, alias="ANTHROPIC_API_KEY")
    agent_id: str = Field(alias="AGENT_ID")
    server_host: str = Field(alias="SERVER_HOST")
    server_port: int = Field(alias="SERVER_PORT", ge=1, le=65535)
    client_port: int = Field(alias="CLIENT_PORT", ge=1, le=65535)
    thread_id: str = Field(alias="THREAD_ID")
    app_env: str = Field(alias="APP_ENV")
    log_body: bool | None = Field(alias="LOG_BODY")
    open_devtools: str | None = Field(alias="OPEN_DEVTOOLS")
    electron_warnings: str | None = Field(alias="ELECTRON_WARNINGS")
    session_timeout_seconds: int = Field(alias="SESSION_TIMEOUT_SECONDS")
    cleanup_interval_seconds: int = Field(alias="CLEANUP_INTERVAL_SECONDS")
    @field_validator("google_api_key", "agent_id", "server_host")
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
    settings.json5 / settings.json を読み込み、なければ settings.default.json5 / settings.default.json を使う。
    """
    path_to_load = None
    for cand in SETTINGS_CANDIDATES:
        if cand.exists():
            path_to_load = cand
            print(f"Loading config from: {cand}")
            break
    if path_to_load is None:
        for cand in DEFAULT_SETTINGS_CANDIDATES:
            if cand.exists():
                path_to_load = cand
                print(f"Loading config from: {cand} (Default)")
                break
    if path_to_load is None:
        raise RuntimeError(
            f"Config Error: None of {SETTINGS_CANDIDATES + DEFAULT_SETTINGS_CANDIDATES} found."
        )

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


# ---------- 公開値（他モジュールから参照する定数） ----------

env_settings = load_env_settings()    # .env から読み込み
app_settings = load_settings_json()   # settings.json5 から読み込み

GOOGLE_API_KEY = env_settings.google_api_key
AGENT_ID = env_settings.agent_id
SERVER_HOST = env_settings.server_host
SERVER_PORT = env_settings.server_port
CLIENT_PORT = env_settings.client_port
THREAD_ID = env_settings.thread_id
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
LLM_PROVIDER = app_settings.server.llmProvider
SYSTEM_PROMPT = app_settings.server.systemPrompt
LOG_MAX_BYTES = app_settings.server.logMaxBytes
LOG_BACKUP_COUNT = app_settings.server.logBackupCount

# Session/HITL 設定
SESSION_TIMEOUT_SECONDS = env_settings.session_timeout_seconds
CLEANUP_INTERVAL_SECONDS = env_settings.cleanup_interval_seconds

# FastAPI の /agui/config で返すために dict で保持
_ui_settings = resolve_theme(app_settings.ui)

# クライアントのログ詳細可否（サーバ設定と連動）
CLIENT_LOG_VERBOSE = (APP_ENV == "dev") or (LOG_BODY is True)

# 検索サブエージェント設定
SEARCH_SUBAGENT_ENABLED = app_settings.server.searchSubAgent.enabled
SEARCH_SUBAGENT_MODEL = app_settings.server.searchSubAgent.model

# AG-UI エージェント接続情報（サーバを唯一の真実源とする）
AGENT_URL = f"http://{SERVER_HOST}:{SERVER_PORT}/agui"
