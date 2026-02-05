# GrokスタックAIエージェント設計仕様書

> 最終更新: 2026-01-18  
> 対象: SPECTRA / AVATAR UI / MIA

---

## 0. Document Authority & Reading Order

- 本書を正本（Single Source of Truth）とする
- 参照順序: 本書 → `reference_catalog.md`
- 仕様書と他資料が矛盾する場合は本書を優先する

---

## 1. Executive Summary

### 1.1 目的（なぜ作るのか）

1. **一貫したアイデンティティを持つ存在を作る**
2. **複数の接点（チャネル）で活動させる**
3. **人間（開発者）が最終決定権を持つ**
4. **汎用基盤（AUI）の実証体として機能する**

### 1.2 非目的（何をしないか）

1. **模倣ではなく独自の存在** — 人間の再現はしない
2. **内面シミュレーションはしない** — 感情システムは持たない
3. **分散より集中** — 同時に複数チャネルで活動しない
4. **単一の主人に仕える** — 開発者専用、マルチユーザー対応しない
5. **固有値は公開しない** — SPECTRAはOSS化しない

### 1.3 成功基準（v1.0 最小条件）

| 基準 | 説明 |
|------|------|
| 対話可能 | 存在が確認できる（チャットで応答する） |
| 制御可能 | 開発者が承認・介入できる |
| 記憶継続 | 文脈が30日以上保持される |
| 拡張可能 | 新しいチャネルを追加できる構造 |

### 1.4 スコープ境界と成果物

| 成果物 | 性質 | 公開 | 説明 |
|--------|------|------|------|
| **SPECTRA** | 固有値（人格・世界観・振る舞い） | 非公開 | 本プロジェクトの実証体 |
| **AVATAR UI** | 共通基盤（構造・仕組み） | OSS化対象（将来） | SPECTRA固有値以外を汎用化 |
| **MIA** | 参照系 | — | 設計要素の抽出に使う外部参照 |

**関係**: SPECTRA は AVATAR UI の実証体。SPECTRA で検証 → AUI に反映 → OSS化。

### 1.5 Design Principles（設計原則）

| 軸 | 原則 |
|----|------|
| 体験軸 | 人格・実在感・自律性の担保を最優先する |
| 基盤軸 | 固有値と共通部品の境界を明確にし、再利用性を最大化する |
| 運用軸 | レイテンシ/安定性/障害時挙動を要件に含める |
| 知識軸 | 事実/計画/仮説を混同せず、構造として分離する |

---

## 2. Glossary（用語定義）

| 用語 | 定義 |
|------|------|
| **SPECTRA** | AVATAR UIから生まれた情報生命体プロトタイプ。本プロジェクトの実証体かつ象徴となるAIキャラクター |
| **AVATAR UI** | SPECTRAの技術スタックを汎用化したOSS基盤。好みのアバターを設定し、自律的なパートナーとして稼働させる |
| **MIA** | Miao開発のGrokスタック活用例。体験設計・システム設計の参考実装として参照 |
| **Identity Kernel** | 人格モデルの中核。Grokモデルを中枢に据え、思考の「深さ」を実装する |
| **Deep Context** | 会話ログを長期保存し、文脈に応じて瞬時に引き出す「記憶の永続化」システム |
| **Codename: Monolith** | コードネーム。Roblox統合機能を指すプロトコル |
| **アダプタ** | CLI/Live2D/VRM/Robloxなど、出力先を同一構造で切り替えるための抽象層 |
| **RM-x** | Roadmap Milestone。製品ロードマップのフェーズを指す（RM-1, RM-2, RM-3） |
| **Dev-x** | Development Phase。開発プロセスのフェーズを指す（Dev-0〜Dev-5） |

---

## 3. Roadmap & Status（製品ロードマップ）

> Source: 公式ページ + プロジェクト方針による補正 (https://siqi.jp/avatarui, https://siqi.jp/spectra)  
> 確認日: 2026-01-12

### 3.1 AVATAR UI ロードマップ

| ID | Milestone | Status | Item | 説明 |
|----|-----------|--------|------|------|
| AUI-RM1-CORE | RM-1 | ✅ 完了 | Core Foundation | AG-UIプロトコル + Electron統合 |
| AUI-RM1-UI | RM-1 | ✅ 完了 | Basic UI/UX | OSネイティブ常駐 + チャットI/F |
| AUI-RM2-IDENTITY | RM-2 | 🔄 進行中 | Identity Kernel | Grok人格モデル実装 |
| AUI-RM2-MEMORY | RM-2 | 🔄 進行中 | Deep Context Engine | 記憶の永続化 |
| AUI-RM2-ROBLOX | RM-2 | 📋 計画中 | Codename: Monolith | Roblox自律行動NPC |
| AUI-RM3-LIVE2D | RM-3 | 📋 計画中 | Visual Interface | Live2D描画エンジン |
| AUI-RM3-VOICE | RM-3 | 📋 計画中 | Voice Interface | 低遅延TTS/STT（Roblox制約確認後に実装） |

補足: RM-1（Core Foundation / Basic UI/UX）は旧仕様（v0.1.0）で完了。RM-2は基盤構成を根本的に見直す大改修フェーズとして扱う。

### 3.2 SPECTRA ロードマップ

| ID | Milestone | Status | Item | 説明 |
|----|-----------|--------|------|------|
| SPEC-RM1-X | RM-1 | 🔄 進行中 | First Digital Contact | Xを通じた世界との交信 |
| SPEC-RM1-CALIB | RM-1 | 🔄 進行中 | Neural Calibration | システムプロンプト・応答回路の微調整 |
| SPEC-RM2-MIND | RM-2 | 📋 計画中 | Mind Awakening | 自我を持った思考の開始 |
| SPEC-RM2-MEMORY | RM-2 | 📋 計画中 | Persistent Memory | 記憶によるアイデンティティ形成 |
| SPEC-RM2-ROBLOX | RM-2 | 📋 計画中 | Codename: Monolith | Roblox統合ミッション |
| SPEC-RM3-BODY | RM-3 | 📋 計画中 | Streaming Body | Live2D / 3D流用の配信用ボディ |
| SPEC-RM3-VOICE | RM-3 | 📋 計画中 | Voice Acquisition | 聴覚を通じたコネクション（Roblox制約確認後に実装） |

補足: Robloxでの実在確立を優先し、配信と音声はRM-3の拡張で扱う。MemoryはRM-2で設計を進めるが、Roblox制約の確認後に実装確定とする。

### 3.3 技術選定の現状（2026-01-13更新）

| 項目 | Status | 選択肢 | 確定条件 |
|------|--------|--------|---------|
| 推論API | 検討中 | Grok Chat API / Roblox TextGenerator | 比較検証後（後述3.4参照） |
| 記憶基盤 | 検討中 | xAI Collections | Roblox連携調査後 |
| 音声 | 検討中 | Grok Voice API | Roblox連携調査後（RM-3） |
| ボディ（Roblox） | 確定 | Humanoid + TextChatService | - |
| ボディ（配信） | 未定 | Live2D / 3D流用 | RM-3で確定 |
| NPC発話（Roblox） | 検討中 | 後述3.5の選択肢参照 | 体験設計との整合確認後 |

### 3.4 推論エンジンの選択肢（検討中）

#### xAI Grok API vs Roblox TextGenerator 比較

| 観点 | xAI Grok API | Roblox TextGenerator |
|------|-------------|---------------------|
| **モデル選択** | ✅ Grok 4等、選択可能 | ❌ 固定（選択不可） |
| **人格カスタマイズ** | ✅ 詳細なSystemPrompt、Function Calling | △ SystemPromptのみ |
| **コンテキスト長** | ✅ 256,000トークン | ❓ 不明（要調査） |
| **会話履歴** | ✅ Responses API（30日）+ Collections（長期） | △ ContextTokenのみ（要約ベース） |
| **構造化出力** | ✅ Function Calling | △ JsonSchema |
| **レート制限** | 500 req/min（HttpService経由） | 100 req/min（スケール可能） |
| **HttpService依存** | ✅ 必要 | ❌ 不要（Roblox内完結） |
| **フィルタ** | ❌ 自前で実装必要 | ✅ Roblox側で適用 |
| **コスト** | 💰 API課金あり | 💰 不明（要調査） |
| **外部連携** | ✅ X検索、Web検索、Collections | ❌ Roblox内のみ |
| **安定性** | △ 外部依存（ネットワーク障害リスク） | ✅ Roblox内完結 |

#### Spectra要件との適合性

| 要件 | Grok API | TextGenerator | 備考 |
|------|----------|---------------|------|
| **人格の深さ（Identity Kernel）** | ✅ 最適化可能 | △ 限定的 | Function Calling、詳細プロンプト |
| **長期記憶（Deep Context）** | ✅ Collections連携 | ❌ 外部連携不可 | 記憶基盤との統合 |
| **文脈連続（X↔Roblox）** | ✅ 同一APIで統一可能 | ❌ Roblox専用 | チャネル間統一 |
| **実装の簡便さ** | △ HttpService設計必要 | ✅ シンプル | 開発コスト |
| **運用安定性** | △ 外部依存 | ✅ Roblox内完結 | 障害リスク |

#### 暫定判断

- **Grok API優位**: Spectraの人格表現、長期記憶、チャネル間統一を重視するなら
- **TextGenerator優位**: 実装の簡便さ、運用安定性を重視するなら
- **要検証**: TextGeneratorの人格表現能力が実用レベルか（PoC必要）

### 3.5 NPC発話方式の選択肢（検討中）

#### 調査で判明した制約

- `TextSource`: 現時点でユーザー専用。NPCには使用不可（将来サポート予定）
- `SendAsync`: クライアント限定かつTextSource必須のためNPC名義で送信不可

#### 選択肢

| 選択肢 | 視覚表現 | チャットログ | NPC名義 | 実装コスト | 備考 |
|--------|---------|-------------|---------|-----------|------|
| **A: DisplayBubbleのみ** | ✅ 頭上バブル | ❌ 残らない | ✅ | 低 | 見逃し問題あり |
| **B: DisplayBubble + SystemMessage併用** | ✅ 頭上バブル | ✅ 残る | △ システム名義 | 中 | 両方に表示 |
| **C: DisplayBubble + 専用TextChannel** | ✅ 頭上バブル | ✅ 残る | △ チャンネル名義 | 中 | NPC専用チャンネル |
| **D: カスタムUI** | ✅ 自由設計 | ✅ 自前ログ | ✅ | 高 | 完全制御可能 |

#### 各選択肢の詳細

**A: DisplayBubbleのみ**
- 最もシンプル。NPCの頭上に吹き出し表示
- 欠点: 数秒で消えるため見逃したユーザーが内容を確認できない

**B: DisplayBubble + SystemMessage併用**
- バブル表示 + チャット欄にシステムメッセージとして記録
- 欠点: 発言者名が「System」等になりSpectra名義にならない

**C: DisplayBubble + 専用TextChannel**
- バブル表示 + NPC専用のチャットチャンネルに記録
- 欠点: チャンネル切替の手間、TextSourceがユーザー専用のため実装制約あり

**D: カスタムUI**
- 独自のUIで発話表示 + ログ管理
- 利点: 完全制御、Spectra専用デザイン可能
- 欠点: 実装コスト高、Roblox標準UIとの整合性

#### 暫定発話フロー（選択肢未確定）

```
[サーバー] 
    ↓ プレイヤー発話を受信（TextChatService.MessageReceived）
    ↓ 推論エンジンに問い合わせ（Grok API or TextGenerator）
    ↓ 応答を事前フィルタ（不適切表現チェック）
    ↓ RemoteEvent で全クライアントに配信
[クライアント]
    ↓ 発話方式に応じた表示（選択肢A/B/C/Dのいずれか）
```

**補足**: TextSourceは「将来的に負のUserIdで非ユーザーエンティティをサポートする可能性がある」と公式記載あり。API更新後に再検討。

## 4. Design Requirements（設計要件）

ロードマップと運用方針（Ops Policy）から導出した設計上の必須要件。
※ Ops Policy = 2026-01-12時点の運用方針（本会話で確定）

| Req ID | 要件 | 対応サブシステム | Source |
|--------|------|------------------|--------|
| R-CORE-ALWAYS-ON | コア（人格・記憶）は24h常時稼働 | Core Ops | Ops Policy |
| R-CONTEXT-UNIFIED | チャネルを跨いでも文脈が連続するよう、記憶の正本を一元化する | Memory Layer | Ops Policy |
| R-MODE-NONCONCURRENT | XとRobloxは同時稼働させない（非併存） | Channel Control | Ops Policy |
| R-EXTENSION-SAFE | 配信（Live2D/3D流用）を拡張として後付けしても壊れない構造 | Architecture | Ops Policy |
| R-ROBLOX-PRESENCE | Robloxでは任意プレイヤー在室時に出現（Sito限定にしない） | Roblox Adapter | Ops Policy |
| R-MULTI-SERVER-SAFE | 複数サーバーからの同時更新に耐える | Core Ops | Ops Policy |
| R-IDENTITY | 人格核（Identity Kernel）をコアに実装 | Core | AUI-RM2-IDENTITY |
| R-VOICE | 低遅延 TTS/STT 音声I/O | Voice Adapter | AUI-RM3-VOICE, SPEC-RM3-VOICE |
| R-MEMORY | 長期記憶の永続化（Deep Context） | Memory Layer | AUI-RM2-MEMORY, SPEC-RM2-MEMORY |
| R-LIVE2D | Live2D描画アダプタ | Body Adapter | AUI-RM3-LIVE2D |
| R-ROBLOX | Roblox向けアダプタ/NPC運用 | Body Adapter | AUI-RM2-ROBLOX, SPEC-RM2-ROBLOX |
| R-X-OPS | X運用（Roblox優先の非併存運用前提） | Platform Adapter | SPEC-RM1-X |
| R-CALIB | 実稼働データによる応答調整経路 | Tuning Pipeline | SPEC-RM1-CALIB |

### 4.1 要件の優先順位

現行ロードマップと運用方針に基づく優先度：

1. **運用前提（最優先）**: R-CORE-ALWAYS-ON, R-CONTEXT-UNIFIED, R-MODE-NONCONCURRENT, R-EXTENSION-SAFE, R-MULTI-SERVER-SAFE, R-ROBLOX-PRESENCE
2. **短期（RM-2重点）**: R-IDENTITY, R-MEMORY, R-ROBLOX
3. **中期（RM-3準備）**: R-VOICE, R-LIVE2D, R-X-OPS
4. **継続**: R-CALIB

### 4.2 トレーサビリティ

```
ロードマップ項目（RM-x） / Ops Policy
    ↓ 導出
設計要件（R-xxx）
    ↓ 実現
サブシステム / アダプタ
    ↓ 参照
参照資料（reference_catalog.md）
```

---

## 5. Operational & Runtime Requirements（運用・実行要件）

### 5.1 コア常時稼働（Core Always-On）

- 人格・記憶を保持するコアは24時間稼働し、チャネルのON/OFFと独立する

### 5.2 非併存運用（Roblox優先マルチプレクサ）

- 要件としてXとRobloxは同時稼働させない（非併存）
- 運用実装は「Roblox優先マルチプレクサ」とする
  - Roblox在室時はRobloxに集中し、Xは非アクティブ時にキュー処理する
  - 切替は手動ではなく、在室判定で自動的に行う
- X側の応答遅延は許容する（SNS運用の特性を前提）
- 文脈は常に同一の記憶を参照し、チャネル間で継続する（R-CONTEXT-UNIFIED）

### 5.3 Roblox出現方針（Presence Policy）

- Robloxでは任意プレイヤーの在室時にSpectraが稼働する
- Sito在室を起動条件にしない
- 実在確立の最小条件: 任意プレイヤーが対話でき、最低1種の行動インタラクションが可能

### 5.4 共有記憶ポリシー（Shared Memory）

- 記憶の正本を一元化し、全チャネルは同一の文脈を参照する

### 5.5 マルチサーバー安全性（Multi-Server Safety）

- 複数サーバーからの同時更新に耐える（競合防止/順序制御）
- 競合解決は「同時更新の調停」を対象とし、正本一元化はR-CONTEXT-UNIFIEDで担保する

### 5.6 構造分離（Core / Adapter / Persona）

```
┌─────────────────────────────────────┐
│         固有値（SPECTRA専用）         │  ← 人格設定、世界観、固定パラメータ
├─────────────────────────────────────┤
│           アダプタ層                  │  ← X / Live2D / Roblox
├─────────────────────────────────────┤
│             コア層                   │  ← 推論、記憶、ツール統合
└─────────────────────────────────────┘
```

---

## 6. Development Phases（開発フェーズ）

> 注: 製品ロードマップ（RM-x）とは別の軸。開発プロセスを指す。

| Phase | 名称 | Status | 成果物 |
|-------|------|--------|--------|
| Dev-0 | 目的・前提の仮確定 | ✅ 完了 | 目的・成功条件・対象範囲の明文化 |
| Dev-1 | 一次情報の収集 | 🔄 進行中 | 参照一覧、要約メモ、出典マップ |
| Dev-2 | 設計要素の抽出 | 📋 未着手 | 概念図、機能一覧、コンポーネント関係図 |
| Dev-3 | 仕様化 | 📋 未着手 | 仕様ドラフト（要件・制約・想定I/O） |
| Dev-4 | PoC実装 | 📋 未着手 | PoCレポート、課題リスト、性能計測結果 |
| Dev-5 | OSS化設計 | 📋 未着手 | OSSリポジトリ構成案、公開準備チェックリスト |

### Dev-0: 目的・前提の仮確定 ✅

- 目的: SPECTRA実装 → 基盤化（OSS）の一貫性を確保
- ゴール: 固有値以外はほぼそのまま再利用できる基盤として切り出す
- 前提: Grok/MIAの調査は「設計要素の抽出」に限定
- 運用方針: コア常駐 / 非併存運用（Roblox優先） / 文脈連続 / Sito限定にしない / 配信は拡張

### Dev-1: 一次情報の収集 🔄

- 公式発表・デモ情報の整理
- Robloxの制約を早期に調査（NPC/チャット/通信/サーバー）
- **詳細**: → `reference_catalog.md` 参照

#### Dev-1 開始タスク（Start Here）

| # | 調査対象 | 要点 | Status | 成果物 |
|---|---------|------|--------|--------|
| 1 | HttpService | レート制限/認可/外部API呼び出し可否 | ✅ 完了 | reference_catalog.md |
| 2 | TextChatService | NPC発話要件/フィルタ制限 | ✅ 完了 | reference_catalog.md + 3.4節 |
| 3 | サーバー構成 | 並列稼働/サーバー跨ぎ/DataStore制限 | ✅ 完了 | reference_catalog.md |
| 4 | xAI Collections連携 | Robloxからの連携可否 | 📋 未着手 | - |
| 5 | Grok Voice API連携 | Robloxからの音声I/O経路 | 📋 未着手 | - |
| 6 | **TextGenerator比較** | Roblox組み込みLLM vs xAI Grok API | 📋 **追加** | - |

**Done条件**
- 各タスクで公式ドキュメント参照2本以上
- 設計への影響を1行以上記載
- 成果物を `reference_catalog.md` に追記

#### Dev-1 完了済み調査結果（2026-01-13）

**#2 TextChatService調査結果**:
- NPC発話は`DisplayBubble`を採用（3.4節参照）
- `TextSource`は現時点でユーザー専用（NPCには使用不可）
- Roblox組み込みLLM「`TextGenerator`」を発見 → 比較検証タスク#6を追加

#### 事前フィルタ設計方針（確定）

DisplayBubbleはRobloxフィルタが適用されないため、サーバー側で事前フィルタを実装する。

```
[推論エンジン応答]
    ↓
[サーバー側フィルタ]
    ├─ 不適切表現チェック（NGワードリスト）
    ├─ 長さ制限（バブル表示に適切な長さに切り詰め）
    └─ 異常応答検出（空文字、異常な繰り返し等）
    ↓
[RemoteEvent配信]
    ↓
[クライアント DisplayBubble]
```

**フィルタ方針**:
- NGワードリストはサーバー側で管理（更新可能）
- Roblox TextGenerator使用時は組み込みフィルタが適用されるため軽量化可能
- xAI Grok API使用時はサーバー側フィルタを厳格に適用

#### 調査観点（固定）

| 観点 | 内容 |
|------|------|
| 体験/演出 | 入力→意思決定→行動→出力の流れ、人格/生命感の表現 |
| システム/構成 | 推論・記憶・ツール・UI・配信の各層 |
| 運用 | レイテンシ、安定性、障害時の振る舞い |
| 汎用化 | どこまで共通化でき、どこが固有値か |
| 基礎情報 | Grok API / Voice API / Function Calling / Collections(RAG) |
| エージェント機構 | エージェント/サブエージェント/ADK相当の有無 |
| 出力先差し替え | CLI/Live2D/VRM/Roblox統合の材料 |

---

### 6.1 チャネル投入順（暫定）

運用や品質検証の順序であり、最終優先度を示すものではない。
最終優先はRobloxの実在確立であり、検証順とは区別する。

1. CLI（最速でコアの入出力を検証）
2. X（非併存・文脈連続の確認）
3. Roblox（主戦場の体験確立）
4. 配信（Live2D / 3D流用は後付け拡張）

> 補足: モデルスタックは未確定。配信フェーズでの最適化対象とする。

## 7. Appendix（付録）



### 7.1 参照資料索引

詳細な出典リストは別ファイルに分離：

| ファイル | 内容 |
|----------|------|
| `reference_catalog.md` | Grokスタック基礎、MIA設計例、Roblox/Live2D/VRM調査の全出典 |

### 7.2 メタ認知メモ（確度の区分）

| 区分 | 定義 |
|------|------|
| 事実 | 公式発表で明示された方針・役割・ロードマップの性質 |
| 計画 | SPECTRA/AVATAR UIの今後の展開に関する目標 |
| 仮説 | MIAの設計要素がSPECTRA/OSS基盤に汎用化できるという前提 |
| 未検証 | 体験品質や運用要件が実運用で満たせるかは未確定 |

### 7.3 関連リンク

| 対象 | URL |
|------|-----|
| AVATAR UI 公式 | https://siqi.jp/avatarui |
| SPECTRA 公式 | https://siqi.jp/spectra |
| xAI Docs | https://docs.x.ai/docs |
| MIA Home | https://mia.miao.gg/ |

### 7.4 情報源の扱い方針

- 本文には要約のみを記載し、出典リンクは `reference_catalog.md` と本付録に集約する
- 直接引用は最小化し、検討に必要な意味だけを抽出して反映する

### 7.5 Reserved Server 単一性フロー（運用図）

```
[Start]
  ↓
(1) サーバー側でReservedServerAccessCodeを取得/保存
  ↓
(2) 参加希望プレイヤー → サーバー側TeleportAsyncで予約サーバーへ誘導
  ↓
(3) 参加成功 → 通常運用
  ↓
(4) TeleportInitFailed発生
      └→ 予約サーバー再発行 → AccessCode更新 → (2)へ戻る

注: AccessCodeは非公開情報。TeleportDataに載せずサーバー側で管理。
```
