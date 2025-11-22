# AG-UI + Google ADK メモ

更新日: 2025-11-22

## 1. 方針
- フロント側は Electron + Vite による **レトロターミナル風 GUI アプリケーション** (`app/`)。
- バックエンド側は **AG-UI 公式リポジトリ** に含まれる `ag_ui_adk` ミドルウェア（FastAPI + Google ADK Agent）を利用する (`server/`)。
- 現状のLLMは Gemini 2 系（Google Search 標準ツールを利用）。他プロバイダ対応は未実装で、検討中。
- MCP は未導入。採用するか、どのサーバを使うかは今後の検討項目。
- 設定は `settings.json` で一元管理し、SSOT (Single Source of Truth) を徹底する。

## 2. システム構成 (Architecture)

```
【Client: Electron】         【Server: Python (FastAPI)】          【Cloud】
  [UI Layer]                    [Agent Layer]
  (Renderer) <---(HTTP/SSE)---> (ADK Agent) <---(MCP Protocol)---> [MCP Servers]
      |                             |                                  (Filesystem, Command...)
      |                             +-----(Google GenAI SDK)---------> [Gemini API]
   [TerminalEngine]
   (Game Loop)
```

## 3. Google ADK ミドルウェア（公式サンプル）
1. **リポジトリ入手**
   ```bash
   git clone https://github.com/ag-ui-protocol/ag-ui.git ag-ui-upstream
   ```
   - `ag-ui-upstream/typescript-sdk/integrations/adk-middleware` に FastAPI サンプルがある。
   - 付属ドキュメント（`USAGE.md`, `CONFIGURATION.md`, `TOOLS.md`, `ARCHITECTURE.md`）が一次情報源。

2. **ローカル展開**
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
   - `server/.env` ではなくルートの `.env` で一元管理。`GOOGLE_API_KEY=...` 等を設定。

5. **起動**
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```
- `server/main.py` で `add_adk_fastapi_endpoint(..., path="/agui")` を指定してあるため、`http://localhost:8000/agui` がクライアント用エンドポイントになる。

## 4. 拡張検討メモ（未実装・要議論）

- **マルチLLM切替（OpenAI / Anthropic / Gemini）**
  - 現状: ADK組み込みの Google Search ツールは Gemini 2 系専用。他プロバイダで使うと `Model ... not found` や `Google search tool is not supported` で失敗する。標準ツールをシームレスに他ベンダーで使う方法は公式に存在しない。
  - 公式一次情報:
    - Built-in Tools: Google Search only for Gemini 2 models. citehttps://google.github.io/adk-docs/tools/built-in-tools/
    - LLMRegistry: OpenAI/Anthropic を使う場合は LiteLlm ラッパで `provider/model` を指定するのが推奨。citehttps://google.github.io/adk-docs/agents/models/
  - 課題: Google Search を維持したまま他ベンダーへ切替は不可。非Geminiモデルを使うなら検索ツールを外す or 独自実装に差し替える必要がある。
  - 方針候補（未決定）:
    - A) Gemini固定（標準ツール活用重視）
    - B) 非Gemini時は標準検索ツールを外し、代替検索ツールを実装
    - C) 設定でプロバイダ切替し、ツールも自動で切替（標準検索はGeminiのみ）

- **MCP連携（ツール未定）**
  - 現状: 未導入。どのMCPサーバ（filesystem/commands/etc.）を採用するか未定。
  - 公式一次情報:
    - ADK MCP integration（StdioServerParameters + MCPToolset）。citehttps://cloud.google.com/blog/topics/developers-practitioners/use-google-adk-and-mcp-with-an-external-serverhttps://codelabs.developers.google.com/multi-agent-app-toolbox-adk
  - 課題: 採用サーバと権限範囲、セキュリティポリシーを決める必要がある。

## 5. ディレクトリ構成

- `app/` – Electron クライアント (UI)
  - `src/renderer/` – UI ソースコード (HTML, CSS, TypeScript)。
  - `src/main/` – Electron メインプロセス。
  - `vite.config.ts` – ビルド設定。
- `server/` – FastAPI サーバー (Agent)
  - `main.py` – エントリーポイント。
  - `src/config.py` – 設定ローダー (Fail-Fast)。
- `settings.json` – 全体設定 (SSOT)。
- `.env` – 秘密情報 (API Key等)。

## 6. AG-UI イベント → DOM 更新方針（GUI）

| イベント | DOM 操作 / 表示 | 備考 |
|----------|----------------|------|
| `TextMessageStart` | `.text-line.text-line--assistant` を新規作成し、`#pane-output .text-scroll` に追加。アバター状態を `talk` に更新。 | 1メッセージ=1要素でストリーミング開始 |
| `TextMessageContent` | 直近の `.text-line--assistant` に `event.delta` を連結。スクロール位置を末尾へ。 | CLI の `process.stdout.write` 相当。加工なし。 |
| `TextMessageEnd` | アバター状態を `idle` に戻し、メッセージ行末に改行を付与。 | run終了を待たず、各メッセージごとに talk→idle を繰り返す。 |
| `ToolCallStart` | `.text-line.text-line--tool` を追加（例: `🔧 Tool call: ${event.toolCallName}`）。 | ツールイベントも出力欄に流す。 |
| `ToolCallArgs` / `ToolCallResult` | 同 `.text-line--tool` に追記 or 新規行で結果を表示（例: `🔍 Result: ...`）。 | 装飾は簡素に、テキストと同じ枠で表現。 |
| `RunError` / `onRunFailedEvent` | `.text-line.text-line--error` を追加（赤系表示）。 | 出力欄にエラーを流し、ログはロガー subscriber が別途記録。 |

## 7. 開発フロー
1. **サーバー起動**: `cd server && uvicorn main:app --reload`
2. **クライアント起動**: `cd app && npm run dev`
3. **設定変更**: `settings.json` を編集し、リロード（または再起動）で反映。
