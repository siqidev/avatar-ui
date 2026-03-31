# /release — リリース（dev → main）

devブランチからmainへのリリースを実行する。
手順は `~/.claude/rules/git-workflow.md` のリリース手順に準拠する。

## 引数

$ARGUMENTS にバージョン番号を指定する（例: `0.6.0`）。
省略時はユーザーに確認する。

## 手順

以下を順番に実行する。各ステップの結果を簡潔に報告し、失敗したら中止する。

### Phase 1: 品質検証

1. **テスト** — `npx vitest run` 全緑を確認
2. **型チェック** — `npx tsc --noEmit` エラーゼロを確認
3. **ビルド** — `env -u ELECTRON_RUN_AS_NODE npx electron-vite build` 成功を確認

### Phase 2: VPSデプロイ

4. **VPS pull** — `ssh spectra` で最新devをpull
5. **VPS再起動** — ヘッドレスプロセスをkill→再起動
6. **動作確認** — プロセス起動とログにエラーがないことを確認

### Phase 3: ドキュメント検証

7. **Exploreエージェントに委譲** — 以下の2軸で検証:
   - **追加漏れ**: 新規の環境変数・コマンド・機能・ディレクトリがドキュメントに記載されているか
   - **既存の陳腐化**: 既存の記述がコードの現状と矛盾していないか
   - 検証対象: README.md, README.ja.md, CHANGELOG.md, docs/PLAN.md, docs/architecture.md, .env.example, CLAUDE.md
8. **結果報告+修正** — 漏れ・陳腐化があれば修正する。ただしREADME（利用者向け文言）の修正はPhase 4で擦り合わせる。PLAN/architecture/CHANGELOG/.env.example等の事実記述はここで直してよい

### Phase 4: README刷新判断

9. **README刷新要否の判断** — README.md / README.ja.md を通読し、今回の変更で陳腐化・追加漏れがないか確認
10. **ユーザーとの擦り合わせ** — 修正が必要な箇所を一覧化し、1要素ずつ候補を提示してユーザーに選んでもらう。利用者向け文言の決定権はユーザーにある。勝手に文言を確定しない

### Phase 5: リリース実行

11. **package.json バージョン更新** — 指定バージョンに更新
12. **コミット** — ドキュメント修正・バージョン更新をdevにコミット＆プッシュ
13. **VPS再デプロイ** — 最終コミットをVPSにpull＆再起動
14. **dev → main マージ** — 単一マージコミット（`--no-ff`）
15. **タグ作成** — `git tag -a vX.Y.Z`
16. **GitHubリリース作成** — `gh release create` でCHANGELOG.mdの該当セクションをリリースノートとして使用
17. **push** — main + tags をpush
18. **devに戻る** — `git checkout dev`

## 中止条件

- Phase 1の任意のステップが失敗
- VPSのプロセスが起動しない、またはログにエラー
- ユーザーが中止を指示

## 注意

- Phase 4のREADME擦り合わせは省略しない。利用者向け文言の決定権はユーザーにある
- マージは必ず1回（複数マージコミットを作らない）
- リリースノートはCHANGELOGから転記し、GitHub固有の整形は最小限にする
