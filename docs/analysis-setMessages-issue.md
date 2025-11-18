# `agent.setMessages()` 対処の問題点と本質的な解決方法

**分析日**: 2025-11-18  
**対象箇所**: `app/src/index.ts:79-81`

## 📋 要約

現在の`agent.setMessages([...messages])`による対処は**技術的には正しい**が、**設計上の問題**がある。本質的な解決方法は`agent.addMessage()`を使用し、グローバルな`messages`配列を削除することで、単一の情報源（Single Source of Truth）を確立すること。

---

## 🔍 一次情報源の調査結果

### 1. AG-UI公式プロトコル仕様

**出典**: `ag-ui-upstream/docs/concepts/messages.mdx:175-197`

```typescript
## Message Synchronization

Messages can be synchronized between client and server through two primary
mechanisms:

### Complete Snapshots

The `MESSAGES_SNAPSHOT` event provides a complete view of all messages in a
conversation:

interface MessagesSnapshotEvent {
  type: EventType.MESSAGES_SNAPSHOT
  messages: Message[] // Complete array of all messages
}

This is typically used:
- When initializing a conversation
- After connection interruptions
- When major state changes occur
- To ensure client-server synchronization
```

**重要なポイント**:
- **サーバー側が`MESSAGES_SNAPSHOT`イベントでメッセージ状態を管理すべき**
- クライアント側は受信したイベントを適用するだけが本来の設計
- 手動同期は「接続中断後」などの例外的なケースのみ

### 2. @ag-ui/client の実装

**出典**: `ag-ui-upstream/sdks/typescript/packages/client/src/agent/agent.ts`

#### `prepareRunAgentInput()` (L247-261)

```typescript
protected prepareRunAgentInput(parameters?: RunAgentParameters): RunAgentInput {
  const clonedMessages = structuredClone_(this.messages) as Message[];
  const messagesWithoutActivity = clonedMessages.filter(
    (message) => message.role !== "activity",
  );

  return {
    threadId: this.threadId,
    runId: parameters?.runId || uuidv4(),
    tools: structuredClone_(parameters?.tools ?? []),
    context: structuredClone_(parameters?.context ?? []),
    forwardedProps: structuredClone_(parameters?.forwardedProps ?? {}),
    state: structuredClone_(this.state),
    messages: messagesWithoutActivity,  // ← this.messagesを使用
  };
}
```

#### `setMessages()` (L490-505)

```typescript
public setMessages(messages: Message[]) {
  // Replace the entire messages array
  this.messages = structuredClone_(messages);

  // Notify subscribers sequentially in the background
  (async () => {
    // Fire onMessagesChanged sequentially
    for (const subscriber of this.subscribers) {
      await subscriber.onMessagesChanged?.({
        messages: this.messages,
        state: this.state,
        agent: this,
      });
    }
  })();
}
```

#### `addMessage()` (L405-444)

```typescript
public addMessage(message: Message) {
  // Add message to the messages array
  this.messages.push(message);

  // Notify subscribers sequentially in the background
  (async () => {
    // Fire onNewMessage sequentially
    for (const subscriber of this.subscribers) {
      await subscriber.onNewMessage?.({
        message,
        messages: this.messages,
        state: this.state,
        agent: this,
      });
    }
    // ... (ツール呼び出しの通知など)
  })();
}
```

**重要なポイント**:
- `runAgent()`は自動的に`this.messages`を`RunAgentInput.messages`に含める
- `setMessages()`は`this.messages`を置換し、サブスクライバーに通知
- `addMessage()`は単一メッセージを追加し、適切なイベントを発火

### 3. ADK Middleware公式ドキュメント

**出典**: `ag-ui-upstream/integrations/adk-middleware/python/ARCHITECTURE.md:19-24`

```markdown
### ADKAgent (`adk_agent.py`)
The main orchestrator that:
- Manages agent lifecycle and session state
- Handles the bridge between AG-UI Protocol and ADK
- Coordinates tool execution through proxy tools
- Implements direct agent embedding pattern
```

**出典**: `ag-ui-upstream/integrations/adk-middleware/python/USAGE.md:153-172`

```python
# Create input
input = RunAgentInput(
    thread_id="thread_001",
    run_id="run_001",
    messages=[
        UserMessage(id="1", role="user", content="Hello!")
    ],
    context=[],
    state={},
    tools=[],
    forwarded_props={}
)

# Run and handle events
async for event in agent.run(input):
    print(f"Event: {event.type}")
```

**重要なポイント**:
- **ADKAgentは`RunAgentInput.messages`を受け取り、自動的にセッション管理**
- クライアント側が手動でメッセージ同期する必要はない（設計上）
- サーバー側（ADK）が状態管理の責任を持つ

---

## ❌ 現在の実装の問題点

### 問題1: 二重の状態管理（Dual State Management）

**現在のコード** (`app/src/index.ts:16, 79-81`):

```typescript
const messages: Message[] = [];  // ← グローバル配列

async function runTurn(input: string) {
  const userMessage: Message = {
    id: randomUUID(),
    role: "user",
    content: trimmed,
  };

  messages.push(userMessage);  // ← グローバル配列に追加
  agent.setMessages([...messages]);  // ← Agentにも同期
  logInfo(`user message queued id=${userMessage.id}`);

  await agent.runAgent(...);
}
```

**問題点**:
1. **Single Source of Truth違反**: `messages`と`agent.messages`が二重管理されている
2. **手動同期の必要性**: `push`後に`setMessages`を呼ぶ必要がある
3. **同期忘れのリスク**: 将来的に同期を忘れるとバグの原因になる
4. **メモリの無駄**: 同じデータを2箇所で保持

### 問題2: サブスクライバーイベントの活用不足

`agent.addMessage()`を使用すると、自動的に以下のイベントが発火される:
- `onNewMessage`: 新しいメッセージ追加時
- `onMessagesChanged`: メッセージ配列変更時

現在の実装ではこれらを活用していない。

### 問題3: アシスタントメッセージの手動管理

**現在のコード** (`app/src/index.ts:35-44`):

```typescript
onTextMessageEndEvent() {
  process.stdout.write("\n\n");
  if (assistantMessageId) {
    messages.push({  // ← グローバル配列に手動追加
      id: assistantMessageId,
      role: "assistant",
      content: assistantBuffer,
    });
    logInfo(`assistant message stored id=${assistantMessageId}`);
  }
}
```

**問題点**:
- `agent.messages`には自動的に追加されるが、グローバル`messages`には手動追加が必要
- 非同期処理のため、タイミングによっては同期ズレが発生する可能性

---

## ✅ 本質的な解決方法

### 解決策1: `agent.addMessage()` の使用

**推奨実装**:

```typescript
// グローバル messages 配列を削除
// const messages: Message[] = [];  ← 不要

async function runTurn(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return;

  const userMessage: Message = {
    id: randomUUID(),
    role: "user",
    content: trimmed,
  };

  // agent.addMessage()で単一の情報源に追加
  agent.addMessage(userMessage);
  logInfo(`user message queued id=${userMessage.id}`);

  await agent.runAgent(
    {
      runId: randomUUID(),
      threadId: agentConfig.threadId,
    },
    buildSubscriber(),
  );
}
```

### 解決策2: アシスタントメッセージの自動管理

```typescript
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
      // グローバル配列への手動追加は不要
      // agent.messages は自動的に更新される
      logInfo(`assistant message completed id=${assistantMessageId}`);
    },
    // ... 残りのイベントハンドラー
  };
}
```

### 解決策3: メッセージ履歴の取得

メッセージ履歴が必要な場合は、`agent.messages`を直接参照:

```typescript
// 履歴が必要な場合
console.log("会話履歴:", agent.messages);

// または、サブスクライバーで追跡
agent.subscribe({
  onMessagesChanged({ messages }) {
    console.log("メッセージが更新されました:", messages);
  }
});
```

---

## 📊 比較表

| 項目 | 現在の実装 (`setMessages`) | 推奨実装 (`addMessage`) |
|------|---------------------------|-------------------------|
| **状態管理** | 二重管理（グローバル + agent） | 単一管理（agentのみ） |
| **同期** | 手動同期が必要 | 自動同期 |
| **イベント** | 手動発火が必要 | 自動発火 |
| **コード量** | 多い（同期コードが必要） | 少ない（シンプル） |
| **バグリスク** | 高い（同期忘れ） | 低い（自動管理） |
| **メモリ** | 無駄あり（重複保存） | 効率的 |
| **保守性** | 低い（複雑） | 高い（シンプル） |
| **AG-UI準拠** | 部分的 | 完全準拠 |

---

## 🎯 まとめ

### 現在の対処（`setMessages`）について

**技術的には正しいが、設計上は最適ではない**:
- ✅ `RunAgentInput`にメッセージが含まれる（動作する）
- ❌ 二重の状態管理が必要
- ❌ 手動同期のオーバーヘッド
- ❌ Single Source of Truth違反

### 推奨する本質的な解決方法

1. **`agent.addMessage()`の使用**
   - 単一の情報源（`agent.messages`）に統一
   - 自動的なイベント発火
   - シンプルで保守性の高いコード

2. **グローバル`messages`配列の削除**
   - メモリ効率の向上
   - 同期忘れのリスク排除

3. **AG-UI公式パターンへの準拠**
   - プロトコル仕様に沿った設計
   - 将来のアップデートへの対応が容易

### 実装手順

1. グローバル`const messages: Message[] = [];`を削除
2. `messages.push(userMessage);`を`agent.addMessage(userMessage);`に変更
3. `agent.setMessages([...messages]);`の行を削除
4. `onTextMessageEndEvent`内の`messages.push`を削除
5. テストして動作確認

**所要時間**: 約5分  
**コード削減**: 約10行  
**リスク**: 極めて低い（公式APIの使用）

---

## 📚 参考文献

1. **AG-UI Protocol Messages**: `ag-ui-upstream/docs/concepts/messages.mdx`
2. **@ag-ui/client Agent API**: `ag-ui-upstream/sdks/typescript/packages/client/src/agent/agent.ts`
3. **ADK Middleware Architecture**: `ag-ui-upstream/integrations/adk-middleware/python/ARCHITECTURE.md`
4. **ADK Middleware Usage**: `ag-ui-upstream/integrations/adk-middleware/python/USAGE.md`

