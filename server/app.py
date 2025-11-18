from fastapi import FastAPI
from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint

def create_agent() -> ADKAgent:
    # TODO: load actual agent configuration from examples
    raise NotImplementedError

app = FastAPI()
agent = create_agent()
add_adk_fastapi_endpoint(app, agent, path="/agui")
