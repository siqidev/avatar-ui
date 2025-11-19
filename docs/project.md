# AG-UI CLI + Google ADK 移行メモ

更新日: 2025-11-18

## 1. 方針
- フロント側は `@ag-ui/client` ベースの CLI（`/app`）で AG-UI プロトコルのみ扱う。
- バックエンド側は **AG-UI 公式リポジトリ** に含まれる `ag_ui_adk` ミドルウェア（FastAPI + Google ADK Agent）をそのまま利用する。
- サードパーティ実装（Trend Micro 版など）は採用しない。

## 2. CLI 側の現状
- `app/` は `create-ag-ui-app`（Client Type = CLI）で生成済み。Mastra/OpenAI 依存は削除し、`@ag-ui/client` と `@ag-ui/core` だけを残した。
- `npm run dev` で CLI が起動し、`AG_UI_AGENT_URL` で指定されたエンドポイントへ JSON/SSE を投げる薄い層。

## 3. Google ADK ミドルウェア（公式サンプル）
1. **リポジトリ入手**
   ```bash
   git clone https://github.com/ag-ui-protocol/ag-ui.git ag-ui-upstream
   ```
   - `ag-ui-upstream/typescript-sdk/integrations/adk-middleware` に FastAPI サンプルがある。
   - 付属ドキュメント（`USAGE.md`, `CONFIGURATION.md`, `TOOLS.md`, `ARCHITECTURE.md`）が一次情報源。

2. **ローカル展開**
   - プロジェクト内に `server/` を作り、上記ディレクトリから `python/` サンプルコードをコピー。
   - 推奨構成：`server/` に `app/`, `requirements.txt`, `.env.example` を配置（サンプル通り）。

3. **依存導入**
   ```bash
   cd server
   python3.12 -m venv .venv
   source .venv/bin/activate
   pip install .
   ```
   - サンプルは `pip install .`（または `pip install -e .`）でミドルウェア本体と依存を導入。

4. **環境変数**
   - `server/.env` に `GOOGLE_API_KEY=...`（Gemini API Key）を設定。必要に応じて `AG_UI_AGENT_NAME` なども追記。

5. **起動**
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```
   - `server/main.py` で `add_adk_fastapi_endpoint(..., path="/agui")` を指定してあるため、`http://localhost:8000/agui` がクライアント用エンドポイントになる。

## 4. 接続検証
1. サーバー起動後、`http://localhost:8000/agui` に `GET` して 200 が返ることを確認。
2. 別ターミナルで `cd app && npm run dev`。
3. CLI からメッセージを送ると、AG-UI SSE を通じて ADK Agent の応答が返る。

## トラブルシュートメモ
- **HTTP 404**: CLI の `AG_UI_AGENT_URL` を FastAPI で公開しているパスに合わせる（例：`/agui`）。末尾スラッシュの有無にも注意。
- **RUN_ERROR → RUN_FINISHED**: ADK 側で `new_message` を生成できずに落ちている可能性。CLI の `agent.messages.push(...)` を使って、`RunAgentInput` にユーザー発話が含まれるようにする。
- **Gemini API 鍵エラー**: FastAPI 側で `GOOGLE_API_KEY` を読み込めているか確認。`dotenv` で `.env` を読み、`LlmAgent` にはキーを直接渡さず環境変数で認証する。
- **ログ確認**: サーバー側は `server/logs/app.log`、CLI 側は `app/logs/cli.log` に出力される。問題が起きたら両ログを確認する。

## エラー修正の履歴（リファクタ対象）
1. **CLI `.env` ローダー追加**
   - `dotenv` を導入し、`app/src/index.ts` の冒頭で `import "dotenv/config";` を読み込む形に統一。余分なローダーファイルは不要になった。
   - 起動時に `[CLI] agent endpoint ...` をログ出力して接続先を確認。

2. **ユーザーメッセージの同期**
   - グローバル配列を廃止し、`agent.messages.push(userMessage)` を直接呼ぶ（公式 CLI と同じ）。
   - `buildSubscriber` ではログ表示のみ行い、メッセージの手動同期は不要。

3. **FastAPI サーバー再構成**
   - 公式サンプルを基に `server/main.py` を作成し、`add_adk_fastapi_endpoint(..., path="/agui")` で `/agui` エンドポイントを公開。
   - `AG_UI_AGENT_URL` を `http://localhost:8000/agui` に設定し、404 を解消。

4. **Gemini API キー読み込み**
   - `python-dotenv` で `GOOGLE_API_KEY` を読み込み、キー未設定時は `RuntimeError` で通知。
   - `LlmAgent` にはキーを直接渡さず、環境変数で認証（Google ADK が自動参照）。

5. **サーバー/CLI ログ整備**
   - `server/logs/app.log`: `logging` + `RotatingFileHandler` で出力し、デバッグ用ミドルウェアを削除。
   - `app/logs/cli.log`: 簡易ロガーを実装し、ユーザー入力やエラーをファイル出力するようにした。

6. **PLAN.md 更新**
   - ステップ4～5の達成状況を反映し、ステップ7（公式最小構成へのリファクタ計画）を追加。

## ディレクトリ構成

- `app/` – AG-UI CLI クライアント
  - `.env`, `package.json`, `package-lock.json`, `tsconfig.json` … プロジェクト設定。
  - `src/` – ソースコード（`agent.ts`, `index.ts`, `logger.ts`）。`npm run dev` で実行。
  - `logs/cli.log` – CLI の実行ログ（自作ロガー）。
  - `node_modules/` – npm 依存パッケージ。

## CLI 現状メモ（どうやって動いているか）

### 全体の流れ

現在のCLIは「**3つの層**」で動いています：

```
【あなた】                     【CLI プログラム】                    【AIサーバー】
   ┃                                                                    ┃
   ┃  1️⃣ メッセージ入力                                                ┃
   ┃  "東京の天気は？"                                                  ┃
   ┃        ↓                                                          ┃
   ┃  ┌─────────────────────┐                                         ┃
   ┃  │ 【入力層】              │                                        ┃
   ┃  │  readline で > 表示    │                                        ┃
   ┃  │  (index.ts の一部)     │                                        ┃
   ┃  └─────────────────────┘                                         ┃
   ┃        ↓                                                          ┃
   ┃  2️⃣ agent.messages.push()                                        ┃
   ┃  メッセージを記録                                                   ┃
   ┃        ↓                                                          ┃
   ┃  ┌─────────────────────┐                                         ┃
   ┃  │ 【通信層】              │   3️⃣ HTTP/SSE で送信                  ┃
   ┃  │  agent.runAgent()     │  ─────────────────────────→         ┃
   ┃  │  (agent.ts)           │                                        ┃
   ┃  └─────────────────────┘                                         ┃
   ┃        ↑                                                          ┃
   ┃        │  4️⃣ イベントが返ってくる                                   ┃
   ┃        │  (TEXT_START, CONTENT, END...)                           ┃
   ┃        │  ←──────────────────────────────────────────          ┃
   ┃        ↓                                                          ┃
   ┃  ┌─────────────────────┐                                         ┃
   ┃  │ 【表示層】              │                                        ┃
   ┃  │  buildSubscriber()    │                                        ┃
   ┃  │  process.stdout.write │                                        ┃
   ┃  │  (index.ts の一部)     │                                        ┃
   ┃  └─────────────────────┘                                         ┃
   ┃        ↓                                                          ┃
   ┃  5️⃣ 画面に表示                                                     ┃
   ┃  SPECTRA> 東京の天気は晴れです                                      ┃
   ┃                                                                    ┃
```

---

### 3つの層の詳しい説明

#### 🎯 **1. 入力層**（どこで入力を受け取るか）

**場所**: `app/src/index.ts` の `readline` 部分

**やっていること**:
- ターミナルに `> ` を表示
- あなたがEnterを押すと、入力した文字を取得
- 空行ならスキップ
- Ctrl+D で終了

**具体例**:
```
> 東京の天気は？  ← あなたが入力
(Enterを押す)
     ↓
"東京の天気は？" という文字列を次の層に渡す
```

**GUI化で変わる部分**: ✅
- `readline` → HTML の `<input>` や `<textarea>` に変更
- ターミナル → ブラウザの画面

---

#### 🎯 **2. 通信層**（AIサーバーとやり取りする）

**場所**: `app/src/agent.ts` と `index.ts` の `runTurn` 関数

**やっていること**:
1. `agent.messages.push(ユーザーメッセージ)` で会話履歴に追加
2. `agent.runAgent()` でサーバーにメッセージを送信
3. サーバーから「イベント」という形で返事をもらう

**イベントとは？**:
AIの返事は一気に来るのではなく、小分けで来ます：

```
イベント1: TEXT_MESSAGE_START → "返事を書き始めたよ"
イベント2: TEXT_MESSAGE_CONTENT → "東京の"
イベント3: TEXT_MESSAGE_CONTENT → "天気は"
イベント4: TEXT_MESSAGE_CONTENT → "晴れです"
イベント5: TEXT_MESSAGE_END → "返事を書き終わったよ"
```

これが「ストリーミング」= リアルタイムで少しずつ表示される仕組み

**GUI化で変わらない部分**: ❌
- この層は**そのまま使える**
- サーバーとの約束事（プロトコル）は変わらない

---

#### 🎯 **3. 表示層**（画面にどう表示するか）

**場所**: `app/src/index.ts` の `buildSubscriber()` 関数

**やっていること**:
- サーバーから来たイベントを受け取る
- イベントの種類に応じて表示方法を変える

**イベントごとの表示例**:

| イベント | 表示内容 |
|---------|---------|
| `TEXT_MESSAGE_START` | `SPECTRA> ` を表示 |
| `TEXT_MESSAGE_CONTENT` | 文字を少しずつ追加 |
| `TEXT_MESSAGE_END` | 改行して次の入力待ち |
| `TOOL_CALL_START` | `🔧 ツール実行: get_weather` |
| `TOOL_CALL_RESULT` | `🔍 結果: 晴れ` |
| `RUN_ERROR` | `❌ エラー: ...` |

**具体例**:
```javascript
// TEXT_MESSAGE_CONTENT イベントが来たら
onTextMessageContentEvent: ({ event }) => {
  process.stdout.write(event.delta);  // ← CLI版：ターミナルに出力
}

// GUI版に変えると ↓
onTextMessageContentEvent: ({ event }) => {
  messageDiv.textContent += event.delta;  // ← ブラウザのDOMに出力
}
```

**GUI化で変わる部分**: ✅
- `process.stdout.write` → DOM操作（`textContent` 等）に変更
- ターミナル出力 → HTML要素の更新

---

### 🎨 GUI化で何が変わるか

| 層 | CLI版 | GUI版 | 変更の有無 |
|----|------|-------|----------|
| **入力層** | `readline`<br>ターミナル入力 | `<input>`<br>ブラウザ入力欄 | ✅ 変える |
| **通信層** | `agent.runAgent()`<br>HTTP/SSE通信 | `agent.runAgent()`<br>HTTP/SSE通信 | ❌ **そのまま** |
| **表示層** | `process.stdout`<br>ターミナル出力 | DOM操作<br>HTML要素更新 | ✅ 変える |

**重要なポイント**:
- 🔧 **通信層は変えない** → サーバーとの契約は同じ
- 🎨 **入力と表示だけ変える** → ユーザーが触る部分だけ

---

### 📁 ファイルとの対応

| 役割 | ファイル | 内容 | GUI化で |
|------|---------|------|---------|
| 入力層 | `app/src/index.ts` (10-110行目) | `readline`、`runTurn`呼び出し | ✅ 削除 |
| 通信層 | `app/src/agent.ts` (全体)<br>`app/src/index.ts` (61-82行目) | `HttpAgent`設定<br>`agent.messages.push()`<br>`agent.runAgent()` | ❌ **保持** |
| 表示層 | `app/src/index.ts` (15-59行目) | `buildSubscriber()`<br>`process.stdout.write` | ✅ 書き換え |

**次のステップ**: 
1. 表示層を `ui/web/webSubscriber.ts` に移動
2. 入力層を `ui/web/index.html` + `ui/web/index.ts` に置き換え
3. 通信層（`agent.ts`）は `core/agent.ts` に移動してそのまま使う

## レトロ端末 + アバター UI 要件（旧仕様の見た目を再現する）

- 参考ファイル: `旧仕様/layout.html`, `旧仕様/skin.css`, `旧仕様/idle.png`
- 方針: **見た目・レイアウトだけ** を踏襲し、JavaScript ロジックは全て新規実装（現行 AG-UI 仕様に合わせる）。最終的には Electron でデスクトップアプリ化。

### レイアウト構成（layout.html の読み替え）
- `main.app.split` … 2 カラムグリッド本体（左: output+input、右: avatar）。
- `section#pane-output` … メッセージ表示面。`div.surface-host` にストリームを差し込む。
- `footer#pane-input` … `span.prompt`（`>`）と `input#input` だけの簡素な入力枠。
- `aside#pane-avatar` … `img#avatar-img`（`data-idle`/`data-talk` 属性付き）＋ `.avatar-label`。
- `.meta-bar#meta` … プロダクト名＋バージョンをハードコード表示する帯（固定値: `avatar-ui v1.0.0`）。接続状態などのシステム通知は出力欄に流す。

### スキン要素（skin.css を寸分違わず再現）
- カラースキーム: `:root { color-scheme: dark; font-family: Consolas, Menlo, monospace; font-size: 14px; }`。`html, body { height: 100%; margin: 0; padding: 0; background: #000; color: #0f0; }`
- レイアウト: `.app { display: grid; grid-template-columns: 1fr 220px; grid-template-rows: auto 1fr auto; gap: 16px; height: 100vh; padding: 20px; box-sizing: border-box; }`。メディアクエリ `@media (max-width: 960px)` で 1 カラムに再構成。
- 出力面: `#pane-output { border: 1px solid rgba(0, 255, 0, 0.4); background: rgba(0, 20, 0, 0.2); display: flex; flex-direction: column; overflow: hidden; }`。内部 `.surface-host`, `.surface` は `flex: 1; min-height: 0;`。
- テキストスクロール: `.text-scroll { flex: 1; padding: 16px; overflow-y: auto; white-space: pre-wrap; line-height: 1.5; color: rgba(0, 255, 0, 0.9); }`。`.text-line` 系の色指定（system / error / proposed）は CSS 通りに再現。
- 入力面: `#pane-input { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: 1px solid rgba(0, 255, 0, 0.4); background: rgba(0, 20, 0, 0.3); }`。`#input { background: transparent; border: none; color: inherit; font: inherit; outline: none; }`。
- アバター: `#pane-avatar { border: 1px solid rgba(0, 255, 0, 0.4); background: rgba(0, 40, 0, 0.25); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 16px; gap: 12px; }`。`#avatar-img { width: 140px; height: 140px; border: 1px solid rgba(0, 255, 0, 0.6); background: rgba(0, 255, 0, 0.1); object-fit: cover; }`。
- メタバー: `.meta-bar { grid-column: 1 / 3; grid-row: 3 / 4; display: flex; justify-content: flex-end; font-size: 12px; color: rgba(0, 255, 0, 0.7); }`。960px 以下では `grid-column: 1 / 2; grid-row: 4 / 5;` に移動し、内容は `avatar-ui v1.0.0` を固定表示。

### 実装ポリシー
- HTML/CSS/画像は `app/src/renderer/` 配下に配置し、Electron 構成（`src/main`, `src/preload`, `src/renderer`, `src/core`）から直接参照できるようにする。
- イベント処理は `AgentSubscriber` を DOM 操作に対応させるだけで、旧仕様の独自ロジック・API 呼び出しは一切持ち込まない。システム通知やエラーメッセージは出力欄（`#pane-output`）に流し込み、ログファイルへの記録は既存ロガー（`app/logs/cli.log`）に任せる。
- `idle.png` はアバター枠に静止画として配置（後で `data-talk` を使って切替/リップシンク）。
- 開発・本番とも Electron を前提に構築する（Vite + Electron フローは後述）。

## AgentSubscriber / ロガーの構成方針

- **共通エージェント**: `app/src/core/agent.ts` に `HttpAgent` を移し、CLI コードは削除。GUI から `import { agent } from "../core/agent"` で利用。
- **GUI 専用 subscriber** (`app/src/renderer/subscriber.ts`)
  - `createUiSubscriber(domRefs)` で `AgentSubscriber` を生成し、`main.ts` から `agent.runAgent(..., createUiSubscriber(...))` を呼ぶ。
  - `onTextMessage*` → `.text-line` + `.text-scroll` へストリーム表示。
  - `onToolCall*` → ツールログ要素を出力面に流す。
  - `onRunFailedEvent` → `.text-line--error` を追加。
  - `onTextMessageStartEvent` などでアバターの `data-idle` / `data-talk` を参照し、将来リップシンクに備える（現状は画像差し替えなし）。
- **ロガー subscriber** (`app/src/core/loggerSubscriber.ts`)
  - `AgentSubscriber` 実装を 1 つ用意し、`agent.subscribe(loggerSubscriber)` でグローバル登録。
  - `onTextMessageStartEvent`, `onTextMessageEndEvent`, `onRunFailedEvent`, `onToolCall*` だけログ出力（`logInfo/logError`）。UI との連携は行わない。
- **呼び出し順**: `agent.runAgent(parameters, uiSubscriber)` を呼ぶと、内部で `[resultSubscriber, loggerSubscriber, uiSubscriber]` の順にイベントが流れる。GUI は最後に受け取り、ログは常に共通コードで確保。
- **CLI 用コード**: `readline` ベースの入力層と CLI 用 subscriber は段階的に削除。今後の UI は Vite/Electron のみを対象とする。

## Vite + Electron 統合フロー（開発 / ビルド / パッケージ）

- **使用ツール**: `vite`, `electron`, `vite-plugin-electron`, `vite-plugin-electron-renderer`, `electron-builder`
- **ディレクトリ構成**
  - `app/src/main/index.ts` … Electron メインプロセス。
  - `app/src/preload/index.ts` … Preload スクリプト（必要に応じて）。
  - `app/src/renderer/` … UI 用ファイル（`index.html`, `style.css`, `main.ts`, `subscriber.ts`, `assets/idle.png` など）。
  - `app/src/core/` … 共有ロジック（`agent.ts`, `loggerSubscriber.ts` など）。
- **Vite 設定（`app/vite.config.ts`）**
  - `root: 'src/renderer'`
  - `build.outDir: 'dist/renderer'`
  - プラグイン例:
    ```ts
    plugins: [
      electron({ entry: 'src/main/index.ts' }),
      electron({ entry: 'src/preload/index.ts', onstart: ({ reload }) => reload() }),
      renderer(),
    ]
    ```
- **package.json スクリプト案**
  - `"dev": "vite"` … Vite Dev Server + Electron が同時起動し、ホットリロード対応。
  - `"build": "vite build"` … renderer / main / preload を一括ビルド。
  - `"package": "electron-builder"` … `dist/` を元に各 OS の配布パッケージを生成。
- **Electron main.ts のロード**
  - 開発時: `if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL)`
  - ビルド後: `win.loadFile(path.join(__dirname, '../renderer/index.html'))`
  - `vite-plugin-electron` が DEV URL を注入するため、条件分岐はこの一箇所で済む。
- **開発手順**
  1. `cd app && npm install`
  2. `npm run dev`
  - 1 コマンドで Vite + Electron が起動。SSE もこの環境で確認可能。
- **ビルド / パッケージ手順**
  1. `npm run build`
  2. 必要に応じて `npm run package`
- **OSS 向けのメモ**
  - README に「`npm install` → `npm run dev` / `npm run build`」で動作する旨を明記。
  - `.env.example` を整備して API キーや URL の設定手順を案内。

## AG-UI イベント → DOM 更新方針（GUI）

| イベント | DOM 操作 / 表示 | 備考 |
|----------|----------------|------|
| `TextMessageStart` | `.text-line.text-line--assistant` を新規作成し、`#pane-output .text-scroll` に追加。アバター状態を `talk` に更新。 | 1メッセージ=1要素でストリーミング開始 |
| `TextMessageContent` | 直近の `.text-line--assistant` に `event.delta` を連結。スクロール位置を末尾へ。 | CLI の `process.stdout.write` 相当。加工なし。 |
| `TextMessageEnd` | アバター状態を `idle` に戻し、メッセージ行末に改行を付与。 | run終了を待たず、各メッセージごとに talk→idle を繰り返す。 |
| `ToolCallStart` | `.text-line.text-line--tool` を追加（例: `🔧 Tool call: ${event.toolCallName}`）。 | ツールイベントも出力欄に流す。 |
| `ToolCallArgs` / `ToolCallResult` | 同 `.text-line--tool` に追記 or 新規行で結果を表示（例: `🔍 Result: ...`）。 | 装飾は簡素に、テキストと同じ枠で表現。 |
| `ToolCallEnd` | 末尾に改行を加えるのみ。 | |
| `RunError` / `onRunFailedEvent` | `.text-line.text-line--error` を追加（赤系表示）。 | 出力欄にエラーを流し、ログはロガー subscriber が別途記録。 |
| `RunStarted` / `RunFinished` | 必須表示はなし（将来のステータス表示に備えて `.text-line--system` を追加しても良い）。 | 既定では `TextMessageStart/End` に統一。 |
| `Activity/State/Messages` 系 | 現時点では出力しない（必要になったら `.text-line--system` で表示）。 | |
| アバター制御 | `TextMessageStart` で `talk`、`TextMessageEnd` で `idle`。将来 `data-talk` / `data-idle` を使って画像切替。 | Run単位ではなくメッセージ単位で表情更新。 |

※ スクロール領域（`.text-scroll`）は毎回 `element.scrollTop = element.scrollHeight` で自動スクロール。システム通知（接続/切断など）が必要になった場合は `.text-line--system` を追加して淡色表示にする。

### 旧仕様から流用するアバター制御ロジック

静止画の idle / talk を切り替えるだけの簡易ロジックが `旧仕様/index.js` に含まれていたため、以下の関数をそのまま TypeScript 化して利用する（CLI 廃止後も参照できるようドキュメントに残す）。

```ts
function createAvatarController(img: HTMLImageElement | null) {
  const idle = img?.dataset?.idle || img?.src || null;
  const talk = img?.dataset?.talk || null;

  function setTalking(isTalking: boolean) {
    if (!img) return;
    const next = isTalking ? talk : idle;
    if (next && img.src !== next) {
      img.src = next;
    }
  }

  return Object.freeze({ setTalking });
}
```

- `createUiSubscriber` で `const avatar = createAvatarController(document.getElementById('avatar-img') as HTMLImageElement);` のように初期化し、`TextMessageStart` で `avatar.setTalking(true)`, `TextMessageEnd` で `avatar.setTalking(false)` を呼ぶ。
- 将来リップシンク用のアニメーションを差し込みたくなった場合も、この `setTalking` 内で Canvas 描画や CSS アニメを実行すればよい。

### 旧仕様のアニメーション管理ロジック（口パク + タイプライター）

旧 UI には、口パクとタイプライター効果をまとめて管理するクラス実装が存在した（`旧仕様/index.js` 相当）。必要に応じて以下のように TypeScript 化して利用できる。

```ts
export class AnimationManager {
  private talkingInterval: ReturnType<typeof setInterval> | null = null;
  private avatarImg = document.getElementById('avatar-img') as HTMLImageElement;
  private output = document.querySelector('#pane-output .text-scroll');

  constructor(private settings: Settings, private soundManager: SoundManager) {}

  startMouthAnimation() {
    if (this.talkingInterval) this.stopMouthAnimation();
    let mouthOpen = false;
    this.talkingInterval = window.setInterval(() => {
      const path = this.settings.getAvatarImagePath(!mouthOpen);
      if (this.avatarImg) this.avatarImg.src = path;
      mouthOpen = !mouthOpen;
    }, this.settings.mouthAnimationInterval);
  }

  stopMouthAnimation() {
    if (this.talkingInterval) {
      clearInterval(this.talkingInterval);
      this.talkingInterval = null;
    }
    if (this.avatarImg) this.avatarImg.src = this.settings.getAvatarImagePath(true);
  }

  startTyping() {
    this.startMouthAnimation();
  }

  stopTyping() {
    this.stopMouthAnimation();
  }

  appendDelta(element: HTMLElement, delta: string) {
    element.textContent += delta;
    if (this.output) this.output.scrollTop = this.output.scrollHeight;
    if (delta.trim()) this.soundManager?.playTypeSound?.();
  }
}
```

- `TextMessageStart` で `animation.startTyping()`、`TextMessageContent` ごとに `animation.appendDelta(lineEl, event.delta)`、`TextMessageEnd` で `animation.stopTyping()` を呼ぶと、SSE ストリーミングに合わせて口パク＋タイプ音が同期する。
- 旧仕様と同じ全文タイプライター演出を行いたい場合は、この `appendDelta` を使わずに `typeWriter()` 実装を残し、SSE を一旦バッファリングしてから再生する。

- `server/` – FastAPI + `ag_ui_adk`
  - `main.py` – FastAPI サーバー本体。`/agui` を公開。
  - `src/ag_ui_adk/` – 公式ミドルウェアのソース。基本的に触らず参照のみ。
  - `examples/`, `tests/`, `ARCHITECTURE.md` など – 公式サンプル／ドキュメント。挙動の参考用。
  - `.env`, `.env.example`, `pyproject.toml`, `uv.lock` – Python 環境と設定ファイル。
  - `logs/app.log` – サーバーの実行ログ（`RotatingFileHandler`）。

- `docs/`
  - `project.md` – 本ドキュメント。旧 `agui-adk-cli.md` / `analysis-setMessages-issue.md` の内容を集約し、進捗と手順を一元管理。

- `ag-ui-upstream/`
  - 公式 AG-UI リポジトリのクローン。`apps/`, `sdks/`, `integrations/` などを参照用に保持。

- `PLAN.md`
  - 進行計画のメモ。各ステップの完了状況を記録。

- その他
  - `スクリーンショット 2025-11-18 16.50.48.png` – 参考資料（必要に応じて整理予定）。
