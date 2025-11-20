import os
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
from google.adk.agents import LlmAgent
from google.adk import tools as adk_tools

load_dotenv()
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if not GOOGLE_API_KEY:
    raise RuntimeError("GOOGLE_API_KEY is not set. Please add it to server/.env")

# Logging to file (replace console output)
logs_dir = Path(__file__).resolve().parent / "logs"
logs_dir.mkdir(exist_ok=True)
log_file = logs_dir / "app.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    handlers=[RotatingFileHandler(log_file, maxBytes=1_000_000, backupCount=3)]
)

logger = logging.getLogger("agui-adk-bridge")

sample_agent = LlmAgent(
    name="assistant",
    model="gemini-2.5-flash",
    instruction="""
    あなたは親切なAIアシスタントです。ユーザーの質問や要望に応えて手助けをします。
    
    - 日本語で自然に応答してください。
    - ユーザーが挨拶したら、親しみを込めて挨拶を返してください。
    - 質問には的確に答え、必要であれば検索ツールなどを活用してください。
    - 常に簡潔で分かりやすい回答を心がけてください。
    """,
    tools=[
        adk_tools.preload_memory_tool.PreloadMemoryTool(),
        adk_tools.google_search_tool.GoogleSearchTool()
    ],
)

agent = ADKAgent(
    adk_agent=sample_agent,
    app_name="agents",
    user_id="cli_user",
    session_timeout_seconds=3600,
    use_in_memory_services=True,
)

app = FastAPI(title="AG-UI ADK Bridge")

# CORS設定（開発用）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def log_agui_request(request: Request, call_next):
    if request.url.path == "/agui" and request.method == "POST":
        body = await request.body()
        logger.info("AGUI request body: %s", body.decode("utf-8"))
        request._body = body
    response = await call_next(request)
    return response

add_adk_fastapi_endpoint(app, agent, path="/agui")


@app.get("/")
def root():
    return {"status": "ok", "endpoint": "/agui"}
