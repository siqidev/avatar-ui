import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
from google.adk.agents import LlmAgent
from google.adk import tools as adk_tools
from google.adk.models.lite_llm import LiteLlm
from google.adk.tools.agent_tool import AgentTool

# 設定モジュールをインポート
from src import config

if config.SEARCH_SUBAGENT_ENABLED and not config.GOOGLE_API_KEY:
    raise RuntimeError("GOOGLE_API_KEY is not set. Please add it to .env in project root")

# Logging: 共通設定（uvicorn と整合）
logs_dir = Path(__file__).resolve().parent / "logs"
logs_dir.mkdir(exist_ok=True)
log_file = logs_dir / "app.log"

log_level = logging.INFO
logging.basicConfig(
    level=log_level,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    handlers=[RotatingFileHandler(log_file, maxBytes=config.LOG_MAX_BYTES, backupCount=config.LOG_BACKUP_COUNT)],
)
logger = logging.getLogger("agui-adk-bridge")

def resolve_model(provider: str, model: str):
    provider = provider.lower()
    if provider == "gemini":
        return model
    # openai / anthropic などは LiteLlm 経由
    if "/" in model:
        return LiteLlm(model=model)
    return LiteLlm(model=f"{provider}/{model}")


def build_agent() -> ADKAgent:
    # 検索サブエージェント（必要なら）
    search_tool = None
    if config.SEARCH_SUBAGENT_ENABLED:
        search_agent = LlmAgent(
            name="search_agent",
            model=config.SEARCH_SUBAGENT_MODEL,
            description="Performs web searches using Google Search",
            instruction="Search the web and return concise results.",
            tools=[adk_tools.google_search],
        )
        search_tool = AgentTool(agent=search_agent)

    main_model = resolve_model(config.LLM_PROVIDER, config.LLM_MODEL)
    tools = [adk_tools.preload_memory]
    if search_tool:
        tools.append(search_tool)

    main_agent = LlmAgent(
        name="assistant",
        model=main_model,
        instruction=config.SYSTEM_PROMPT,
        tools=tools,
    )

    return ADKAgent(
        adk_agent=main_agent,
        app_name="agents",
        user_id="cli_user",
        use_in_memory_services=True,
        session_timeout_seconds=config.SESSION_TIMEOUT_SECONDS,
        cleanup_interval_seconds=config.CLEANUP_INTERVAL_SECONDS,
    )


agent = build_agent()

app = FastAPI(title="AG-UI ADK Bridge")

# CORS設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def log_agui_request(request: Request, call_next):
    # ボディログは dev/LOG_BODY=true のときだけ
    if request.url.path == "/agui" and request.method == "POST":
        if config.APP_ENV == "dev" or config.LOG_BODY is True:
            body = await request.body()
            logger.info("AGUI request body: %s", body.decode("utf-8", errors="replace"))
            request._body = body
    try:
        response = await call_next(request)
        return response
    except Exception as exc:
        logger.exception("Unhandled server error")
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})

# Config API Endpoint
@app.get("/agui/config")
def get_config():
    """
    UI用の設定を返すエンドポイント。
    Server設定(config.py)から、UIに必要な部分だけを抽出して返す。
    """
    # UI設定に加えて、クライアント側ログの詳細可否フラグとエージェント接続情報も返す
    return {
        "ui": config._ui_settings,
        "clientLogVerbose": config.CLIENT_LOG_VERBOSE,
        "agent": {
            "url": config.AGENT_URL,
            "agentId": config.AGENT_ID,
            "threadId": config.THREAD_ID,
        },
    }

add_adk_fastapi_endpoint(app, agent, path="/agui")

@app.get("/healthz")
async def healthz():
    return {"status": "ok"}

@app.get("/")
def root():
    return {"status": "ok", "endpoint": "/agui"}
