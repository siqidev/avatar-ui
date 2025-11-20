import { HttpAgent } from "@ag-ui/client";

const DEFAULT_AGENT_URL = import.meta.env.VITE_AG_UI_AGENT_URL ?? "http://localhost:8000/agui";
const DEFAULT_AGENT_ID = import.meta.env.VITE_AG_UI_AGENT_ID ?? "google-adk-agent";
const DEFAULT_THREAD_ID = import.meta.env.VITE_AG_UI_THREAD_ID ?? "cli-thread";

export const agent = new HttpAgent({
  agentId: DEFAULT_AGENT_ID,
  url: DEFAULT_AGENT_URL,
  threadId: DEFAULT_THREAD_ID,
});

export const agentConfig = {
  agentId: DEFAULT_AGENT_ID,
  threadId: DEFAULT_THREAD_ID,
  endpoint: DEFAULT_AGENT_URL,
};
