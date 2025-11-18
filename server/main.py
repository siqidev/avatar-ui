import os
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
from fastapi import FastAPI, Request
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
    You are a helpful assistant. Help users by answering their questions and assisting with their needs.
    - If the user greets you, please greet them back specifically with "Hello".
    - If the user greets you and does not make any request, greet them and ask "how can I assist you?"
    - If the user makes a statement without making a request, say something conversational about it in response, mentioning the topic directly.
    - If the user asks you a question, use existing context to answer when possible and avoid mentioning you cannot search unless necessary.
    """,
    tools=[adk_tools.preload_memory_tool.PreloadMemoryTool()],
)

agent = ADKAgent(
    adk_agent=sample_agent,
    app_name="agents",
    user_id="cli_user",
    session_timeout_seconds=3600,
    use_in_memory_services=True,
)

app = FastAPI(title="AG-UI ADK Bridge")
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
