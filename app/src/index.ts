import readline from "node:readline";
import { randomUUID } from "node:crypto";
import "dotenv/config";
import { logInfo, logError } from "./logger";
import type { AgentSubscriber } from "@ag-ui/client";
import { agent, agentConfig } from "./agent";

logInfo(`agent endpoint ${agentConfig.endpoint}`);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function buildSubscriber(): AgentSubscriber {
  let assistantBuffer = "";
  let assistantMessageId: string | undefined;

  return {
    onTextMessageStartEvent({ event }) {
      assistantBuffer = "";
      assistantMessageId = event.messageId ?? randomUUID();
      process.stdout.write("\n🤖 AG-UI assistant: ");
      logInfo("assistant response started");
    },
    onTextMessageContentEvent({ event }) {
      if (event.delta) {
        assistantBuffer += event.delta;
        process.stdout.write(event.delta);
      }
    },
    onTextMessageEndEvent() {
      process.stdout.write("\n\n");
      if (assistantMessageId) {
        logInfo(`assistant message completed id=${assistantMessageId}`);
      }
    },
    onToolCallStartEvent({ event }) {
      console.log(`\n🔧 Tool call: ${event.toolCallName}`);
      logInfo(`tool call start ${event.toolCallName}`);
    },
    onToolCallArgsEvent({ event }) {
      process.stdout.write(event.delta ?? "");
    },
    onToolCallEndEvent() {
      console.log("");
    },
    onToolCallResultEvent({ event }) {
      if (event.content) {
        console.log(`🔍 Tool call result: ${event.content}`);
        logInfo(`tool call result ${event.content}`);
      }
    },
    onRunFailedEvent({ error }) {
      console.error("❌ Agent run failed", error);
      logError(`agent run failed: ${error instanceof Error ? error.message : String(error)}`);
    },
  };
}

async function runTurn(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return;

  const userMessage = {
    id: randomUUID(),
    role: "user",
    content: trimmed,
  };

  agent.messages.push(userMessage);
  logInfo(`user message queued id=${userMessage.id}`);

  await agent.runAgent(
    {
      runId: randomUUID(),
      threadId: agentConfig.threadId,
    },
    buildSubscriber(),
  );
  logInfo("agent.runAgent invoked");
}

async function chatLoop() {
  console.log("🤖 AG-UI chat started! Ctrl+D で終了。\n");
  logInfo("chat loop started");

  return new Promise<void>((resolve) => {
    const ask = () => {
      rl.question("> ", async (answer) => {
        try {
          await runTurn(answer);
        } catch (error) {
          console.error("❌ Error running agent:", error);
          logError(`runTurn error: ${error instanceof Error ? error.message : String(error)}`);
        }
        ask();
      });
    };

    rl.on("close", () => {
      console.log("\n👋 Goodbye!");
      resolve();
    });

    ask();
  });
}

chatLoop().catch((error) => {
  console.error(error);
  logError(`chat loop fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
