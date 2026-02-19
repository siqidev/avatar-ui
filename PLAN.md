# PLAN v0.3

> 本文書はv0.3の計画専用。実装完了した項目は正本（PROJECT.md / docs/*）に反映し、本文書から削除する。

## v0.2 現状サマリ

- Core + Console の2コンポーネントが動作
- Terminal Backend経由でOS操作が可能
- 自律ループ（Purpose→Goals→Tasks→Execute）が機能
- Roblox/X Backendは未実装（Exec Contractのスタブのみ）
- 24 APIエンドポイントが稼働
- Identity Kernelはsystem_prompt設定のみ（人格モデル深化未着手）
- 長期記憶なし（state.json/events.jsonlのみ）
- Heartbeat/スケジューリングなし
