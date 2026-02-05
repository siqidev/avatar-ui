import { HttpAgent } from "@ag-ui/client";

// HTTP でエージェントに接続するラッパー

export type AgentConnection = {
  // 接続先エージェントのID
  agentId: string;
  // エージェントのURL
  url: string;
  // 会話スレッドのID
  threadId: string;
};

// 接続情報を渡して HttpAgent を生成
export function createAgent(conn: AgentConnection) {
  return new HttpAgent({
    agentId: conn.agentId,
    url: conn.url,
    threadId: conn.threadId,
  });
}
