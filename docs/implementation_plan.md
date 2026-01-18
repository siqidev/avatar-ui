# SPECTRA 実装計画

> 最終更新: 2026-01-18  
> 前提: `GrokスタックAIエージェント設計仕様書.md` Section 1 を参照

---

## 0. 前提（設計仕様書より）

### 目的
1. 一貫したアイデンティティを持つ存在を作る
2. 複数の接点（チャネル）で活動させる
3. 人間（開発者）が最終決定権を持つ
4. AUIの実証体として機能する

### 非目的
1. 模倣ではなく独自の存在
2. 内面シミュレーションはしない
3. 分散より集中（同時に複数チャネルで活動しない）
4. 単一の主人に仕える
5. 固有値は公開しない

### 成功基準（v1.0）
- 対話可能 / 制御可能 / 記憶継続 / 拡張可能

### スコープ
- SPECTRA = 固有値（非公開）
- AUI = 共通基盤（OSS化対象）

---

## 1. 不変条件

絶対に変わらないこと：

| 不変条件 | 説明 |
|----------|------|
| コア一元化 | 脳（LLM + Context）は1つだけ |
| xai-sdk必須 | 推論はGrok APIのみ |
| 人格維持 | 既存のシステムプロンプトを継承 |
| CLI廃止 | GUI一本化（Discord含む） |
| 人間が最終決定権 | 承認なしで外部投稿・危険操作しない |

---

## 2. 境界（信頼境界）

| 区分 | 役割 | 信頼レベル |
|------|------|-----------|
| **Command** | 開発者が制御する指令室 | privileged（特権） |
| **Channels** | SPECTRAが世界と対話する経路 | normal（一般） |

### Command（指令室）
- GUI（デスクトップ本部）
- Discord（モバイル出先）

### Channels（対話経路）
- X（承認必要）
- Roblox（リアルタイム、承認不要）

---

## 3. 責任分担

| 責務 | 担当 |
|------|------|
| **判断** | Core（LLM） |
| **承認・監視** | Command（GUI/Discord） |
| **対話** | Channels（X/Roblox） |
| **実行** | Tools（ファイル/シェル/Git） |

**原則**: この4つの責務が混ざらないこと。

---

## 4. 失敗時の振る舞い

| 状況 | 振る舞い |
|------|----------|
| 承認がない | 外部投稿しない、危険操作しない |
| Commandが応答しない | 承認待ちキューに保持（タイムアウトで破棄） |
| Channelが応答しない | リトライ後、ログに記録して継続 |
| LLMがエラー | エラーを返し、再試行を促す |

---

## 5. 構造

### 5.1 ディレクトリ

```
spectra/
├── core/
│   ├── brain.py        # LLM + Context
│   ├── policy.py       # 承認判定
│   └── tools/          # 実行能力
│
├── command/            # 指令室（privileged）
│   ├── gui/
│   └── discord/
│
├── channels/           # 対話経路（normal）
│   ├── x/
│   └── roblox/
│
├── config.yaml
└── .env
```

### 5.2 共通インターフェース

```python
@dataclass
class Event:
    source: str              # "gui", "discord", "x", "roblox"
    trust_level: str         # "privileged" | "normal"
    requires_approval: bool
    priority: int
    intent: str
    payload: dict

@dataclass
class Response:
    target: str
    payload: dict
    correlation_id: str
```

### 5.3 構造図

```
                   ↔ Command: GUI（本部）
                   ↔ Command: Discord（出先）
[Core: LLM + Context + Tools]
                   ↔ Channels: X（承認必要）
                   ↔ Channels: Roblox（リアルタイム）
```

---

## 6. 実装フェーズ

### Phase 0: 既存資産の整理
- [ ] 既存の `adapters/` と `core/` を全体レビュー
- [ ] `channels/roblox/` への移行方針を決定
- [ ] 既存のRoblox Luaの入出力仕様を再確認

### Phase 1: Coreの最小骨格
- [ ] `core/brain.py` — LLM + Context の統合
- [ ] `core/policy.py` — 承認判定の最小版
- [ ] `core/tools/` — 最小セット（read-only中心）
- [ ] Event/Response の型定義

### Phase 2: Command（指令室）最小実装
- [ ] GUI: 「指示入力」「承認」「ログ表示」の最小画面（PyQt6）
- [ ] Discord: 承認/拒否の最小フロー（ボタン or リアクション）
- [ ] Command経由のEvent送受信を統一インターフェース化

### Phase 3: Channels（対話経路）最小実装
- [ ] Roblox: 既存挙動を維持したまま `channels/roblox/` に接続
- [ ] X: 最小の投稿/返信フロー（承認必須）
- [ ] ChannelからのEvent生成とResponse返却の統一

### Phase 4: 安全柵
- [ ] Tool Runnerの危険コマンド禁止リスト
- [ ] 変更実行時の差分表示
- [ ] .env へのアクセス禁止

### Phase 5: 結合テスト
- [ ] 承認フローの通しテスト（GUI/Discord）
- [ ] Roblox往復テスト
- [ ] X承認投稿テスト

---

## 7. 決定ログ

| 日付 | 決定 |
|------|------|
| 2026-01-18 | 目的・非目的・成功基準を設計仕様書に明文化 |
| 2026-01-18 | CLI廃止、GUI一本化（Discord含む） |
| 2026-01-18 | Command と Channels はディレクトリ分離 |
| 2026-01-18 | 共通 Event/Response で統一 |
| 2026-01-18 | SPECTRAはOSS化しない（AUIの実証体） |

---

## 8. 保留事項

| 項目 | 状態 | 備考 |
|------|------|------|
| 認証方式 | 保留 | HMAC/署名/トークンの比較が必要 |
| trust_level の命名 | 保留 | privileged/normal or authority/normal |
| 承認タイムアウト | 保留 | 何分で破棄するか |
