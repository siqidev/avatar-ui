# 参照資料カタログ

> GrokスタックAIエージェント設計仕様書の補足資料  
> 最終更新: 2026-01-13

---

## 概要

本ファイルは設計仕様書（`GrokスタックAIエージェント設計仕様書.md`）から分離した出典リストです。

---

## 1. Grokスタック基礎（xAI公式一次情報）

### API / 推論

| ID | URL | 要約（事実） | 設計への示唆（推論） |
|----|-----|-------------|---------------------|
| XAI-CHAT-RESPONSES | [docs/guides/chat](https://docs.x.ai/docs/guides/chat) | APIの推奨I/FはChat Responses。状態保持可能、サーバ側に履歴保存（30日） | 長期記憶は自前設計が必要 |
| XAI-REGIONAL-ENDPOINTS | [docs/key-information/regions](https://docs.x.ai/docs/key-information/regions) | デフォルトはapi.x.ai。リージョン指定可能 | レイテンシ/規制要件に応じて接続先切替 |

### 記憶・状態管理（API）

| ID | URL | 要約（事実） | 設計への示唆（推論） |
|----|-----|-------------|---------------------|
| XAI-RESPONSES-STATEFUL | [docs/guides/chat](https://docs.x.ai/docs/guides/chat) | Responses APIはデフォルトで**stateful**。入力プロンプト、推論内容、応答がサーバー側に保存される。`store=false`で無効化可能 | セッション内記憶はAPIに任せ、長期記憶のみ自前設計 |
| XAI-RESPONSES-30DAY-RETENTION | [docs/guides/chat](https://docs.x.ai/docs/guides/chat) | **応答は30日間保存**され、その後削除される。30日以内であればresponse IDで会話の取得・継続が可能 | 30日を超える文脈連続は、履歴をローカル保存して再送する設計が必要 |
| XAI-RESPONSES-PREVIOUS-ID | [docs/guides/chat](https://docs.x.ai/docs/guides/chat) | `previous_response_id`で以前の応答に続けて会話を継続可能。全履歴を再送する必要がない | セッション間の文脈連続はresponse IDをキーに管理 |
| XAI-RESPONSES-GET-STORED | [docs/guides/chat](https://docs.x.ai/docs/guides/chat) | `client.chat.get_stored_completion(id)`で以前の応答内容を取得可能 | 会話ログの振り返りやデバッグに使用可能 |
| XAI-RESPONSES-DELETE | [docs/guides/chat](https://docs.x.ai/docs/guides/chat) | `client.chat.delete_stored_completion(id)`で保存済み応答を削除可能 | 不要な会話履歴の明示的削除が可能 |
| XAI-RESPONSES-STORE-FALSE | [docs/guides/chat](https://docs.x.ai/docs/guides/chat) | `store_messages=False`でサーバー側保存を無効化。履歴はローカル管理となる | プライバシー重視の用途やカスタム記憶基盤との併用時に使用 |
| XAI-RESPONSES-ENCRYPTED-THINKING | [docs/guides/chat](https://docs.x.ai/docs/guides/chat) | `use_encrypted_content=True`で暗号化された推論トレースを返却。ローカル保存して再送可能 | 30日超の継続や推論モデルのstate保持に使用 |
| XAI-RESPONSES-BILLING | [docs/guides/chat](https://docs.x.ai/docs/guides/chat) | 履歴再送不要でも、**全会話履歴分のトークンが課金対象**。一部はキャッシュで割引 | 長い会話は課金増。定期的なセッション区切りやサマリー圧縮を検討 |

### 記憶・状態管理（Grokアプリ版 vs API）

| ID | URL | 要約（事実） | 設計への示唆（推論） |
|----|-----|-------------|---------------------|
| GROK-APP-MEMORY | [ITmedia記事](https://www.itmedia.co.jp/news/articles/2504/17/news143.html) | Grokアプリ版（grok.com/X）には**長期記憶機能**あり。過去の会話を記憶しパーソナライズ。「Forget」ボタンで削除可能 | アプリ版のメモリ機能はAPI経由では利用不可。SPECTRA用には自前設計が必要 |
| GROK-APP-MEMORY-REFERENCED | [ITmedia記事](https://www.itmedia.co.jp/news/articles/2504/17/news143.html) | 回答生成時に参照した過去会話が「Referenced Chats」として表示される | 透明性確保の設計参考。SPECTRAでも参照元を明示する機能を検討 |
| GROK-APP-CONTEXT-WINDOW | [Twitter/Grok](https://twitter.com/i/grok) | アプリ版のコンテキストウィンドウは約8K〜16Kトークン（無料プラン）。超過時は自動要約や欠落が発生 | API版（Grok 4: 256Kトークン）とは別。SPECTRAはAPI版を使用 |

### SDK / クライアント

| ID | URL | 要約（事実） | 設計への示唆（推論） |
|----|-----|-------------|---------------------|
| XAI-SDK-PYTHON | [xai-sdk-python](https://github.com/xai-org/xai-sdk-python) | 公式Python SDK。pip/uvでインストール可能。Python 3.10+が必要。同期/非同期クライアントを提供し、`XAI_API_KEY`環境変数を既定で参照 | Pythonでの検証・運用ツールを作る場合の標準クライアント |

### Function Calling / ツール

| ID | URL | 要約（事実） | 設計への示唆（推論） |
|----|-----|-------------|---------------------|
| XAI-FUNCTION-CALLING | [docs/guides/function-calling](https://docs.x.ai/docs/guides/function-calling) | ツール呼び出し最大200。tool_choice制御、並列呼び出し可能 | アダプタ層でツール群を統合、SPECTRA固有ツールは差し替え可能に |
| XAI-TOOLS-OVERVIEW | [docs/guides/tools/overview](https://docs.x.ai/docs/guides/tools/overview) | サーバ側自律ツール呼び出し（agentic tool calling）機構あり | ADK/サブエージェントの有無は未確認だが、agentic tool callingは確認済み |
| XAI-SDK-TOOLS-VERSION | [docs/guides/tools/overview](https://docs.x.ai/docs/guides/tools/overview) | xAI Python SDKでagentic tool calling APIを使うにはxai-sdk 1.3.1が必要 | Pythonでツール連携する場合はSDKバージョン固定が必要 |
| XAI-SDK-INLINE-CITATIONS | [docs/guides/tools/overview](https://docs.x.ai/docs/guides/tools/overview) | Inline citationsはxai-sdk 1.5.0+が必要 | 引用付き応答をPython SDKで使う場合は1.5.0以上を前提にする |
| XAI-SEARCH-TOOLS | [docs/guides/tools/search-tools](https://docs.x.ai/docs/guides/tools/search-tools) | Web/X検索のサーバサイドツール、agentic探索可能 | 最新情報取得はサーバ側ツールで完結、クライアント軽量化 |

### Voice

| ID | URL | 要約（事実） | 設計への示唆（推論） |
|----|-----|-------------|---------------------|
| XAI-VOICE-OVERVIEW | [docs/guides/voice](https://docs.x.ai/docs/guides/voice) | Grok Voice Agent APIはWebSocket（wss://api.x.ai/v1/realtime）でリアルタイム音声対話 | 音声ボディ向けに音声I/O経路を標準化 |
| XAI-VOICE-AGENT | [docs/guides/voice/agent](https://docs.x.ai/docs/guides/voice/agent) | エフェメラルトークンでクライアント接続保護。ツール設定可能 | ブラウザ/配信クライアント向けに安全な接続フロー必要 |

### Collections / RAG

| ID | URL | 要約（事実） | 設計への示唆（推論） |
|----|-----|-------------|---------------------|
| XAI-COLLECTIONS-OVERVIEW | [docs/key-information/collections](https://docs.x.ai/docs/key-information/collections) | Collectionsはファイル+コレクションで構成、埋め込み検索前提 | 長期知識はCollectionsをRAG基盤として扱う可能性 |
| XAI-USING-COLLECTIONS | [docs/guides/using-collections](https://docs.x.ai/docs/guides/using-collections) | ドキュメント永続保存、セマンティック検索可能。ファイル上限10万 | 知識基盤はコレクション容量と運用を考慮 |
| XAI-COLLECTIONS-API | [docs/guides/using-collections/api](https://docs.x.ai/docs/guides/using-collections/api) | Collections APIには管理キーと権限が必要 | 管理キーは運用基盤側、クライアントから直接触れさせない |
| XAI-COLLECTIONS-SEARCH-TOOL | [docs/guides/tools/collections-search-tool](https://docs.x.ai/docs/guides/tools/collections-search-tool) | Collections検索ツールはRAG用途想定 | 基盤側に「RAG検索」アダプタ、SPECTRA固有知識と分離 |
| XAI-COLLECTIONS-LIMITS | [docs/key-information/collections](https://docs.x.ai/docs/key-information/collections) | 最大ファイルサイズ100MB、ファイル数上限10万、総容量100GB | 大容量アップロードは外部基盤側で管理、分割/圧縮の検討 |
| XAI-COLLECTIONS-API-REF | [docs/collections-api](https://docs.x.ai/docs/collections-api) | 管理APIは`https://management-api.x.ai/v1`、検索は`https://api.x.ai`。管理キー/通常キーが分かれる | Roblox側から直接管理APIを叩かず、基盤側で中継する設計が安全 |

### Files / チャット添付

| ID | URL | 要約（事実） | 設計への示唆（推論） |
|----|-----|-------------|---------------------|
| XAI-FILES-OVERVIEW | [docs/guides/files](https://docs.x.ai/docs/guides/files) | Filesはチャットにファイルを添付して即時文脈として使う。添付時に`document_search`が自動有効化される | 単発/短期の知識はFiles、長期知識はCollectionsに分離 |
| XAI-FILES-MULTI-TURN | [docs/guides/files](https://docs.x.ai/docs/guides/files) | ファイル文脈はマルチターンで保持される | セッション内の補助記憶として有効 |
| XAI-FILES-LIMITATIONS | [docs/guides/files](https://docs.x.ai/docs/guides/files) | 1ファイル48MB、バッチ不可、agenticモデルのみ対応 | 大容量/大量データはCollectionsや外部DBへ |
| XAI-SDK-FILES-VERSION | [docs/guides/files](https://docs.x.ai/docs/guides/files) | Files APIをPython SDKで使うにはxai-sdk 1.4.0が必要 | ファイル添付/検索をPython SDKで使う場合はSDK 1.4.0以上を前提 |

### モデル / リリース

| ID | URL | 要約（事実） | 設計への示唆（推論） |
|----|-----|-------------|---------------------|
| XAI-GROK-4-MODEL | [docs/models/grok-4](https://docs.x.ai/docs/models/grok-4) | Grok 4のモデル名、コンテキスト長256,000 | 推論モデル選定と長文コンテキスト設計の基準 |
| XAI-MODELS-CONTEXT-WINDOW | [docs/models](https://docs.x.ai/docs/models) | コンテキスト長は入力の最大トークン数。会話履歴を丸ごと送る場合、合計がコンテキスト長以内である必要 | 長期対話は要約/検索で履歴を圧縮 |
| XAI-RELEASE-NOTES | [docs/release-notes](https://docs.x.ai/docs/release-notes) | API/ツールの更新履歴 | 機能追加のタイミングを前提知識に反映 |

### 料金（2026-01-09時点）

| ID | 項目 | 料金 | 設計への示唆（推論） |
|----|------|------|---------------------|
| XAI-PRICING-SEARCH-TOOLS | Web/X Search | $5.00/1K calls | 検索は必要時のみ、キャッシュ/要約で抑制 |
| XAI-PRICING-COLLECTIONS-SEARCH | Collections Search | $2.50/1K calls | RAG検索は頻度とコストを管理 |
| XAI-PRICING-DOCUMENTS-SEARCH | Documents Search | $2.50/1K requests | Collectionsツールと区別が必要 |
| XAI-PRICING-VOICE | Voice Agent | $0.05/min | 音声接続は必要時のみ、無音時は切断 |

---

## 2. MIA設計例

| ID | URL | 要約（事実） | 設計への示唆（推論） |
|----|-----|-------------|---------------------|
| MIA-HOME | [mia.miao.gg](https://mia.miao.gg/) | xAI技術+独自パイプラインのAIコンパニオン | xAI APIを基盤に、キャラ固有の中間処理（パイプライン）を持つ構成が有力 |
| MIA-FEATURES | [mia.miao.gg](https://mia.miao.gg/) | 全プラットフォーム横断の中央集約メモリ、リアルタイム感情 | SPECTRAは感情不採用。「統合メモリ層」と「人格一貫性の状態管理」に置き換え |
| MIA-MULTI-PLATFORM | [mia.miao.gg](https://mia.miao.gg/) | VRChat, Minecraft, Discord対応 | SPECTRAのCLI/Live2D/VRM/Roblox差し替えは「単一人格の多面展開」設計に近い |
| MIA-BUG-BOUNTY-SCOPE | [mia.miao.gg/bug-bounty](https://mia.miao.gg/bug-bounty) | メモリ（公開/非公開）、音声統合、APIエンドポイントがスコープ | 「公開/非公開メモリ分離」「音声統合」「API境界」を最初から設計に含める |
| MIA-ARCH-DIAGRAM | 提供画像（Miao_Architecture.png） | 音声I/O→Grok Voice API→Context Manager構成。VRChat OSCでアバター操作 | SPECTRAは感情状態を持たないため、Context Managerは「人格一貫性/記憶/視覚文脈」に置き換え |

---

## 3. Roblox（NPC / AI基盤）

### キャラクター制御

| ID | URL | 要約（事実） | 設計への示唆（推論） |
|----|-----|-------------|---------------------|
| ROBLOX-HUMANOID | [Humanoid](https://create.roblox.com/docs/ja-jp/reference/engine/classes/Humanoid) | キャラクター機能を付与する基本要素 | NPCの身体制御はHumanoid前提 |
| ROBLOX-ANIMATOR | [Animator](https://create.roblox.com/docs/ja-jp/reference/engine/classes/Animator) | アニメーションの再生と複製を担当 | 行動表現はAnimator/AnimationTrackを標準経路に |

### 移動 / 経路探索

| ID | URL | 要約（事実） | 設計への示唆（推論） |
|----|-----|-------------|---------------------|
| ROBLOX-PATHFINDING-GUIDE | [pathfinding](https://create.roblox.com/docs/ja-jp/characters/pathfinding) | 障害物・危険領域を避けて移動。CreatePathのエージェント設定が重要 | NPC移動は「制限値」「エージェント設定」「コスト設計」を前提に |
| ROBLOX-PATHFINDING-SERVICE | [PathfindingService](https://create.roblox.com/docs/ja-jp/reference/engine/classes/PathfindingService) | 二点間の論理的経路を見つける中核サービス | 移動アダプタはPathfindingServiceを標準利用 |

### インタラクション

| ID | URL | 要約（事実） | 設計への示唆（推論） |
|----|-----|-------------|---------------------|
| ROBLOX-PROXIMITYPROMPT | [ProximityPrompt](https://create.roblox.com/docs/ja-jp/reference/engine/classes/ProximityPrompt) | 距離/視線/入力条件で対話を促す | NPCの対話トリガーはProximityPromptを標準候補に |

### チャット / テキスト

| ID | URL | 要約（事実） | 設計への示唆（推論） |
|----|-----|-------------|---------------------|
| ROBLOX-TEXTCHATSERVICE | [TextChatService](https://create.roblox.com/docs/ja-jp/reference/engine/classes/TextChatService) | 体験内テキストチャットの中核サービス | NPCの発話はTextChatService前提 |
| ROBLOX-TEXTCHANNEL | [TextChannel](https://create.roblox.com/docs/ja-jp/reference/engine/classes/TextChannel) | SendAsync/DisplaySystemMessageで送信、MessageReceivedで受信 | NPC発話はTextChannel経由 |
| ROBLOX-TEXTCHAT-OVERVIEW | [in-experience-text-chat](https://create.roblox.com/docs/chat/in-experience-text-chat) | TextChatServiceはメッセージのフィルタリング/モデレーション/権限管理を担う | NPC発話はTextChatServiceの規約・フィルタを前提に設計 |
| ROBLOX-TEXTSOURCE | [TextSource](https://create.roblox.com/docs/ja-jp/reference/engine/classes/TextSource) | TextChannel内のスピーカー（ユーザー）を表す。「将来的に負の数を渡すことで非ユーザーエンティティのサポートが追加される可能性がある」と記載 | **現時点ではNPC名義での発話には使用不可**。将来のAPI更新を待つ必要 |
| ROBLOX-DISPLAYBUBBLE | [bubble-chat](https://create.roblox.com/docs/chat/bubble-chat) | TextChatService:DisplayBubble(character, message)でNPCの頭上にバブル表示可能。**チャットログには残らない** | NPC発話の選択肢の一つ。視覚表現は優秀だが、見逃し問題あり |

### NPC AI / テキスト生成

| ID | URL | 要約（事実） | 設計への示唆（推論） |
|----|-----|-------------|---------------------|
| ROBLOX-TEXTGENERATOR | [TextGenerator](https://create.roblox.com/docs/ja-jp/reference/engine/classes/TextGenerator) | Roblox組み込みLLM。SystemPrompt/Temperature/TopP/Seed設定可能。レート制限100 req/min | **xAI Grok APIの代替候補**。Roblox内完結のためHttpService制限を回避可能。ただしモデル選択不可 |

### 外部連携 / 永続化

| ID | URL | 要約（事実） | 設計への示唆（推論） |
|----|-----|-------------|---------------------|
| ROBLOX-HTTPSERVICE | [HttpService](https://create.roblox.com/docs/ja-jp/reference/engine/classes/HttpService) | HTTPリクエスト送信、JSON操作。HttpEnabled必要 | 外部AI連携はHttpServiceを標準経路に |
| ROBLOX-HTTPSERVICE-LIMITS | [HttpService](https://create.roblox.com/docs/ja-jp/reference/engine/classes/HttpService) | 外部HTTPは500 req/min、Open Cloudは2500 req/minの制限 | バッチ/キュー処理とリトライ制御が必須 |
| ROBLOX-DATASTORE | [DataStoreService](https://create.roblox.com/docs/ja-jp/reference/engine/classes/DataStoreService) | 持続的なデータストレージへのアクセス | 長期記憶の保管場所として利用 |
| ROBLOX-MEMORYSTORE | [MemoryStoreService](https://create.roblox.com/docs/ja-jp/reference/engine/classes/MemoryStoreService) | 急速に変化するデータを扱うMemoryStore。最大有効期限45日 | 短期共有状態やキューはMemoryStoreで |
| ROBLOX-DATASTORES-GUIDE | [data-stores](https://create.roblox.com/docs/ja-jp/scripting/data/data-stores) | データストアは体験内で一貫して共有され、異なるサーバー上の場所からも同一データにアクセス可能 | 記憶の正本はDataStoreで維持 |

### サーバー間通信 / サーバー種別

| ID | URL | 要約（事実） | 設計への示唆（推論） |
|----|-----|-------------|---------------------|
| ROBLOX-MESSAGINGSERVICE-LIMITS | [enhanced-messagingservice-limits](https://devforum.roblox.com/t/enhanced-messagingservice-limits/2835576) | メッセージサイズ1KB。送信: 600 + 240 * players / 分 | サーバー間通知は間引き/集約/キュー化を前提に |
| ROBLOX-TELEPORT-SERVER-TARGET | [teleporting](https://create.roblox.com/docs/projects/teleporting) | TeleportOptionsで特定サーバー指定が可能。ReservedServerAccessCodeで予約サーバー | 単一性を担保するにはアクセスコードをサーバー側で保持 |

---

## 4. Live2D

| ID | URL | 要約（事実） | 設計への示唆（推論） |
|----|-----|-------------|---------------------|
| LIVE2D-CUBISM-SDK | [sdk/about](https://www.live2d.com/en/sdk/about/) | Cubism SDKはモデル/アニメーションをアプリ上で描画するSDK | SDK選定（Unity/Web/Native）を先に決め、出力アダプタを分岐 |
| LIVE2D-LICENSE | [sdk/license](https://www.live2d.com/en/sdk/license/) | 初期費用なし。商用リリース時は契約必要（個人・小規模事業者は免除） | OSS公開時にライセンス条件を明記 |

---

## 5. VRM

| ID | URL | 要約（事実） | 設計への示唆（推論） |
|----|-----|-------------|---------------------|
| VRM-SPEC | [vrm.dev/en/vrm1](https://vrm.dev/en/vrm1/) | VRM 1.0は2022年9月に正式公開 | VRMボディ採用時は1.0仕様を前提に |
| VRM-UNIVRM | [github.com/vrm-c/UniVRM](https://github.com/vrm-c/UniVRM) | Unity向け公式実装。VRM 1.0/0.x対応、ランタイム入出力可能 | Unity経由のVRM統合はUniVRMを標準ルートに |

---

## 記録テンプレ（調査追加用）

```
【出典ID】
【対象領域】例: Grok基礎 / Voice / RAG / MIA / Roblox / Live2D / VRM
【URL】
【要約（事実）】公式情報のみ
【設計への示唆（推論）】基盤/体験/運用にどう効くか
```

---

## 出典マップのルール

- 公式にまとまった情報がある場合は、ページ単位でURLを分けて管理する
- 具体例（MIA等）と基礎情報（Grokスタック）は混ぜずに並列管理する
- 重要度は「SPECTRA実装に必須か」「基盤化に必須か」「両方に有効か」で判断
- **事実（要約）と推論（示唆）は列を分けて記載**し、混同を防ぐ
