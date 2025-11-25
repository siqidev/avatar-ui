import { HttpAgent } from "@ag-ui/client";

export type AgentConnection = {
  agentId: string;
  url: string;
  threadId: string;
};

export function createAgent(conn: AgentConnection) {
  return new HttpAgent({
    agentId: conn.agentId,
    url: conn.url,
    threadId: conn.threadId,
  });
}
