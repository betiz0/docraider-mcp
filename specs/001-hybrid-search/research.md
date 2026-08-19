# Phase 0 Research: Hybrid Search (Keyword + Semantic)

対象スペック: [spec.md](./spec.md) ／ 監査: [../audit-report.md](../audit-report.md)

本書は Technical Context の NEEDS CLARIFICATION と主要技術選定を解決する。各項目は Decision / Rationale / Alternatives considered で記す。

> **改訂（2026-06-13）**: 利用者の技術方針（sqlite-vec / FTS5 bm25 / ローカル優先埋め込み）を受け、R0（DB 基盤と sqlite-vec 評価）を追加し、R2/R5 を更新した。

---

## R0. DB 基盤の決定と sqlite-vec 評価（利用者方針への回答）

### R0.1 前提の相違

利用者の技術方針は **SQLite 前提**（`sqlite-vec`、`既存 SQLite に統合`、`FTS5 の bm25`）だが、**実コードベースは PostgreSQL**（`package.json` 依存 `pg`、FTS は `tsvector`/`GIN`、ベクトルは pgvector 拡張 + `chunks_embedding`）。これは監査レポート セクション 0 が冒頭で指摘した「依頼文 SQLite vs 実装 PostgreSQL」の相違そのもの。

**Decision**: 既存 PostgreSQL スタックを維持し、ベクトル格納は **pgvector**（DB 内蔵）を採用する。利用者方針の意図（外部ベクトル DB プロセスを避ける／RRF／チャンク:埋め込み 1:1／カスケード削除／マイグレーション移行パス／冪等バックフィル）は PostgreSQL 上で完全に踏襲する。SQLite への全面移行は本機能のスコープ外（別途合意が必要な破壊的変更）とする。

**Rationale**:
- 利用者の最重要意図は「外部ベクトル DB の追加プロセスを避ける（運用負荷）」。これは **pgvector が既に DB 内蔵で満たす**。sqlite-vec を採るには PostgreSQL から SQLite への全面移行（pg 依存・全マイグレーション・全クエリ・接続管理の書き換え、pgvector 既存資産の破棄）が必要で、運用負荷削減という目的に反して移行コスト・リスクが大きい。
- spec は既に PostgreSQL（監査・pgvector・tsvector）を前提に記述・clarify 済み。

**Alternatives considered**: SQLite + sqlite-vec + FTS5 への全面移行 → 既存スタックの破壊的書き換えで blast radius が大。利用者の確認が取れた場合のみ別計画として検討。

### R0.2 ベクトル格納方式の比較表（利用者依頼）

| 方式 | 追加プロセス | Node.js 連携の安定性 | 近傍検索性能 | 既存資産との整合 | 多言語影響 | 判定 |
|---|---|---|---|---|---|---|
| **pgvector（採用）** | 不要（既存 PG 拡張） | `pg` 経由で安定（実績豊富）。HNSW/IVFFlat 索引内蔵 | HNSW で高再現率・高速 | `002_pgvector.sql` の `chunks_embedding` を再利用、移行不要 | 埋め込み非依存で中立 | ◎ 採用 |
| sqlite-vec | 不要（拡張ロード） | 新興。Node バインディング（`sqlite-vec` npm）は発展途上で API 変動リスク。`better-sqlite3` 等の拡張ロード要 | brute-force/ANN は規模次第。中小規模向き | **PG からの全面移行が前提**（pg 資産破棄） | 同左 | × 移行コスト過大 |
| 手動コサイン + 量子化 | 不要 | 任意 DB で可。実装は自前 | 全件スキャンで O(N)。索引なしは大規模で劣化。量子化で精度低下 | PG でも実装可だが pgvector に劣る | 同左 | △ pgvector の下位互換 |

**結論**: 利用者第一候補の sqlite-vec は「既存 SQLite」が存在しないため適用に全面移行を要し不適。同じ「追加プロセス不要」目的は pgvector が既存資産のまま達成する。よって **pgvector を採用**。手動コサイン + 量子化は pgvector が使えない環境のフォールバックとしてのみ価値があり、本件では不要。

### R0.3 スコア統合の方針（利用者方針と一致）

利用者方針どおり **RRF を既定**とし、**線形結合は採用しない**。PostgreSQL のキーワードスコア（`pgroonga_score()` / `ts_rank_cd`）はベクトルのコサイン類似度とスケールが異なるため、線形結合は破綻する。RRF は順位のみを用い中立（詳細 R4）。FTS5 の bm25 に相当するキーワード関連度は PostgreSQL では `pgroonga_score()`（PGroonga 採用時、R1）で代替する。

---

## R1. 全文検索の言語構成とトークナイズ（監査 A-1 / A-2、FR-013 / FR-014）

**Decision**: PostgreSQL の全文検索を **PGroonga 拡張**に置き換える。`document_chunks.content` に対し PGroonga GIN 索引を張り、検索は PGroonga の `&@~`（全文検索）+ `pgroonga_score()` で行う。日本語・英語を含む混在テキストを単一の構成でトークナイズし、索引時とクエリ時で同一トークナイザを用いる。既存の `to_tsvector('english', ...)` 固定トリガー（005）と `simple` クエリ（search.ts）の不整合トリガーは廃止する。

**Rationale**:
- A-1 の根本原因は「索引（english 固定トリガー）とクエリ（simple）でトークナイザが異なる」こと。PGroonga は索引・クエリで同一トークナイザを用いるため構造的に不整合が起きない。
- A-2 の根本原因は「PostgreSQL 標準に日本語形態素解析が無く、`to_tsvector` が日本語を語単位に分割できない」こと。PGroonga は標準で日本語トークナイザ（`TokenMecab` / `TokenBigram` 等）を持ち、日本語ドキュメントを語単位で索引化できる。
- PGroonga は `pgroonga_score()` で関連度スコアを返すため、RRF 用の安定した順位付けが得られる。
- 単一カラム・単一索引で JP/EN 混在ドキュメントを扱える（言語別カラム分割が不要）。

**Alternatives considered**:
- **pg_bigm**: 2-gram 索引で日本語も検索可能だが、`LIKE` ベースで関連度ランキングが弱く、bigram ノイズで精度が劣る。RRF の順位品質が落ちる。
- **native tsvector を english/japanese で per-language カラム化**: 標準 PG に日本語解析が無いため A-2 を解決できない。混在ドキュメントの言語判定も必要になり複雑。
- **tsvector を `simple` に一本化（トリガーも simple に変更）**: A-1 の不整合は解消するが、英語のステミングが消え、日本語は依然トークナイズされず A-2 が未解決。SC-002 を満たせない。

**実装上の注意**:
- マイグレーション 007 で `CREATE EXTENSION IF NOT EXISTS pgroonga;`、`document_chunks` に PGroonga 索引を作成し、005 の `trg_chunks_update_search_vector` トリガーと `search_vector` 依存を撤去（または `search_vector` を維持しつつ PGroonga 索引を別途追加し検索経路のみ切替）。後方互換のため `search_vector` カラム自体は残置可（NULL 許容）。
- 検索側（`search/keyword.ts`）は `content &@~ $query` + `pgroonga_score(tableoid, ctid)` を用いる。ユーザ入力はパラメータバインドし、PGroonga のクエリ構文特殊文字は無効化（`&@~` はクエリ構文非適用のためインジェクション耐性が高い）。
- PGroonga 拡張が導入できない環境向けに、マイグレーションは拡張不在時に明示エラーで停止する（A-2 は仕様要件 FR-013 のため代替フォールバックは設けず、導入を前提とする）。quickstart に PGroonga インストール手順を記載。

---

## R2. 埋め込みの格納先とスキーマ（監査 B-4、Key Entities: Semantic Representation）

**Decision**: 既存の `chunks_embedding` テーブル（`002_pgvector.sql`、`vector(1536)` / `model_version` / `created_at` / UNIQUE(chunk_id, model_version)）を**埋め込みベクトルの正本**として再利用する。埋め込みの**処理状態**は `document_chunks` に列を追加して管理する: `embedding_status TEXT DEFAULT 'pending' CHECK (pending|completed|failed)`、`embedding_attempts INT DEFAULT 0`、`embedding_error TEXT`、`embedding_updated_at TIMESTAMPTZ`。`document_chunks.embedding`（型のみ存在し実体なし、B-4）は型定義から除去し実体と整合させる。

**Rationale**:
- ベクトルは既存テーブルに既に設計があり、モデル世代（`model_version`）と生成日時を保持できる。Key Entities の「生成のモデル世代を識別」「生成日時」を満たす。
- 状態（未処理/完了/失敗）を断片側に持たせることで、バックフィル対象抽出（`WHERE embedding_status <> 'completed'`）が単純な索引付きクエリになり冪等性（FR-010）と失敗再試行（FR-016）を実現できる。
- ベクトル本体と状態を分離することで、再生成失敗時に「古いベクトルを保持しつつ失敗フラグを立てる」（spec Edge Cases）を自然に表現できる。

**Alternatives considered**:
- **`document_chunks.embedding` 列に直接 vector を格納**: 既存 `chunks_embedding` 設計と二重になり B-4 の中途半端な二重設計を温存する。モデル世代管理がしづらい。
- **状態を別テーブル化**: 1:1 の状態管理に新テーブルは過剰。断片への列追加で十分。

**次元の設定可能性（FR-019）**:
- **Decision**: 既定次元は 1536。次元は `embedding.dimensions` 設定で宣言するが、`chunks_embedding.embedding` の pgvector カラム次元はマイグレーション時に確定する固定値とする。次元を変更する場合は新しい `model_version` として扱い、マイグレーション（カラム次元変更 or 新カラム）と再バックフィルを要する旨を quickstart に明記する。
- Rationale: pgvector の `vector(N)` は固定次元で索引が次元依存。実行時に動的変更はできないため、設定で宣言しデプロイ時に整合させる現実解を採る。

**チャンク:埋め込み 1:1 とカスケード削除（利用者方針）**:
- **Decision**: 1 断片 × `model_version` ごとに最大 1 行（既存 UNIQUE(`chunk_id`,`model_version`)）。単一モデル運用では実質チャンク:埋め込み = 1:1。`chunks_embedding.chunk_id` は `document_chunks(id) ON DELETE CASCADE` のため、`delete_site` の FK 連鎖（sites→documents→document_chunks→chunks_embedding）で埋め込みも自動削除される（監査 A-5 で健全と評価済み、追加実装不要）。本機能で削除経路に埋め込みが確実に含まれることを integration テストで検証する。

**マイグレーションと旧スキーマからの移行パス（利用者方針）**:
- **Decision**: すべてのスキーマ変更は `src/db/migrations/00X_*.sql` の連番マイグレーションとして実装し、`migrate.ts` のトランザクション適用に乗せる。旧スキーマからの移行パスを各マイグレーションに必ず同梱する:
  - 007（PGroonga）: 旧 `to_tsvector('english')` トリガー（005）を `DROP`、既存 `document_chunks` に PGroonga 索引を追加（既存行はそのまま索引対象になる）。`search_vector` カラムは後方互換のため残置（NULL 許容化）。
  - 008（embedding_status）: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`。既存断片は `embedding_status='pending'`（未埋め込み）で初期化 → 既存データはバックフィルで `completed` 化（後方互換・段階的）。
  - 009（HNSW 索引）: 既存 `chunks_embedding` に `CREATE INDEX IF NOT EXISTS`。既存ベクトル行に遡及適用。
  - 010（backfill_jobs）: `CREATE TABLE IF NOT EXISTS`。新規のみ。
- Rationale: 各マイグレーションは冪等（`IF NOT EXISTS`/`IF EXISTS`）で再適用安全。既存データを破棄せず、未処理状態から段階的に新機能へ移行できる。

---

## R3. ベクトル近傍検索と索引（FR-001 semantic, パフォーマンス）

**Decision**: コサイン距離（`<=>`）で近傍検索する。`chunks_embedding.embedding` に **HNSW 索引**（`vector_cosine_ops`）を作成する（マイグレーション 009）。クエリ埋め込みは検索時に埋め込みクライアントで 1 回生成し、`ORDER BY embedding <=> $queryVec LIMIT k` で上位 k 件を取得、`1 - (embedding <=> $queryVec)` を類似度スコアとして返す。

**Rationale**:
- コサイン類似度は OpenAI 互換埋め込みの標準的な距離尺度。
- HNSW は IVFFlat より高再現率かつ事前学習（リスト数調整）不要で運用が容易。
- セマンティック側の生スコア（コサイン）と PGroonga スコアはスケールが異なるが、RRF は順位のみ使うため統合は中立（FR-003）。

**Alternatives considered**:
- **IVFFlat**: メモリ効率は良いが `lists` 調整と `ANALYZE` 前提で再現率が不安定。HNSW を優先。
- **L2 距離**: 正規化前提が必要。コサインの方が埋め込み API と相性が良い。

---

## R4. スコア統合（RRF）（FR-003 / FR-005、Clarifications）

**Decision**: **Reciprocal Rank Fusion** を採用。各方式の結果を独立に順位付けし、文書（断片）ごとに `score = Σ_over_methods 1 / (k + rank_method)`（`k=60` を既定定数とする）で合算して降順ソートする。同一断片が両方式でヒットした場合は 1 件に統合し、寄与した方式集合から `matchType`（keyword|semantic|both）を決定する（FR-005）。融合は `src/search/fusion.ts` にアプリ層で実装する。

**Rationale**:
- RRF は順位のみを用い、PGroonga スコアと cosine 類似度のスケール差に頑健（spec Edge Case「スケールの異なる指標で偏らない」）。
- `k=60` は RRF 原論文の慣用値でチューニングを最小化（Clarifications の方針に合致）。
- アプリ層実装は両方式の結果セット（断片 ID と順位）だけを必要とし、DB 非依存でテスト容易。

**Alternatives considered**:
- **加重スコア和（min-max 正規化）**: スケール正規化とチューニング重みが必要で破綻しやすい。spec が明示的に RRF を選択済み。
- **SQL 内 CTE で融合**: PGroonga とベクトルを 1 クエリに混ぜると可読性・テスト性が低下。アプリ層融合を選択。

**結果の重複排除**: 融合キーは `chunk_id`。同一ドキュメント内の複数断片は別結果として扱う（既存挙動を踏襲）。返却単位は断片（既存 `search_crawled_docs` と同様）。

---

## R5. 埋め込み生成クライアント（FR-019、Clarifications）

**Decision**: Node 標準 `fetch` で OpenAI 互換 `POST {endpoint}/v1/embeddings`（body: `{ model, input }`、optional `dimensions`）を呼ぶ薄いクライアントを `src/embedding/client.ts` に実装する。設定は `config.yaml` の新セクション `embedding:` から取得: `endpoint`・`apiKey`（任意、`Authorization: Bearer`）・`model`・`dimensions`・`batchSize`・`timeoutMs`。ローカル互換サーバ（例: Ollama / LM Studio）と外部 API を同一プロトコルで扱う（区別しない）。

**Rationale**:
- 新規 SDK 依存を増やさず、OpenAI/Ollama/LM Studio 等の互換エンドポイントに同一コードで接続できる（spec Assumptions 準拠）。
- バッチ入力（`input: string[]`）で複数断片をまとめて埋め込み、API 往復を削減。

**利用者方針との整合（埋め込みは設定ファイルで指定する API）**: 利用者の最終指示「Embedding は API を設定ファイルで指定。これならローカル・外部関係なく使用可能」を採用する。実装は単一の OpenAI 互換クライアントのみとし、接続先（`endpoint`）の差し替えで「ローカルモデルサーバ」「外部 API」の双方に対応する。社内ドキュメントの外部送信回避が必要な場合は、`endpoint` をローカル互換サーバ（Ollama 等）に設定すれば**データは外部送信されない**。すなわちローカル/外部の選択は設定値の問題であり、コード分岐を持たない（spec FR-019 / Assumptions に合致）。

**ローカル vs 外部 API の比較表（利用者依頼。設定で切替可能だが選定根拠を明示）**:

| 観点 | ローカルモデル（Ollama / transformers.js 等） | 外部 API（OpenAI 等） |
|---|---|---|
| 多言語性能（日英） | モデル選択次第（例: `bge-m3`, `multilingual-e5` は日英とも良好） | 高い（`text-embedding-3-*` は多言語対応） |
| 速度 | ハード依存。GPU 無しは遅め、バッチで緩和 | ネットワーク往復だが高スループット |
| 依存サイズ | Ollama は別プロセス常駐。transformers.js は数百 MB のモデルDL | 追加依存ほぼ無し（HTTP のみ） |
| データ外部送信 | **なし（社内ドキュメント安全）** | あり（課金・機密リスク） |
| 運用 | 自前ホスト・モデル管理が必要 | 鍵管理・コストのみ |

**結論**: 単一の OpenAI 互換クライアントで両者を吸収する。**既定の推奨はローカル互換サーバ（Ollama + `bge-m3`/`multilingual-e5` 等の日英対応モデル）**で社内データを外部送信しない構成。外部 API が必要なら `endpoint`/`apiKey`/`model` を設定で差し替えるだけで切替可能。これによりコード分岐ゼロで利用者方針（外部送信回避を優先評価）と spec（OpenAI 互換・設定指定）の双方を満たす。

**Alternatives considered**:
- **`openai` 公式 SDK 追加**: ローカル互換サーバとの相性・依存増を考慮し不採用。互換 API 形状は単純で fetch で十分。
- **transformers.js でプロセス内埋め込み**: 別プロセス不要だがモデル DL・メモリ・WASM/Native の安定性差があり、OpenAI 互換 HTTP の方が切替容易。必要なら同一インターフェース実装として将来追加可能。
- **埋め込みをDB拡張（pgai 等）で生成**: インフラ依存が増え、設定での切替容易性（FR-019）が下がる。

**失敗時の扱い（FR-016, Edge Cases）**: API エラー・タイムアウト時は当該断片 `embedding_status='failed'`、`embedding_error` に要因、`embedding_attempts++`。既存ベクトルがあれば破棄せず保持。次回バックフィルで `failed` を再試行対象に含める。

---

## R6. バックフィルの実行モデル（FR-008/009/010/016、Clarifications）

**Decision**: MCP ツール `backfill_embeddings` を**非同期受付**型とする。呼び出し時に即座に受付応答（`jobId`・対象件数見込み）を返し、処理は同一プロセス内のバックグラウンドタスク（`setImmediate` で起動するワーカーループ）で継続する。進捗は `backfill_jobs` テーブル（status / total / completed / failed / started_at / finished_at / model_version）と `document_chunks.embedding_status` に永続化する。進捗参照は新ツール `get_backfill_status`（および `get_index_stats` に集計を追加）で取得する。

**冪等性（FR-010）**: 対象抽出は `WHERE embedding_status IN ('pending','failed')`。完了済み（`completed` かつ最新 `model_version`）は除外。バッチ単位で `completed` に更新するため、中断・再実行で未処理分のみ処理される（spec US3 シナリオ3）。

**並行性（Edge Cases: バックフィル中の新規クロール）**: 新規クロールは断片を `embedding_status='pending'` で作成し、同期 or バックフィルワーカーが拾う。状態列を単一の真実とすることで二重処理・取りこぼしを防ぐ。同一プロセス・単一ワーカーループで直列化し、断片更新は行ロック（`FOR UPDATE SKIP LOCKED` 相当のバッチ抽出）で競合を回避する。

**Rationale**:
- MCP サーバは stdio 常駐の単一プロセスのため、外部ジョブキューを導入せずプロセス内ワーカーで完結できる（最小複雑度）。
- 状態を DB に永続化することでプロセス再起動後も再開可能。

**Alternatives considered**:
- **同期バックフィル（ツール内で全件処理）**: 大量データでツール応答がタイムアウトする。spec が非同期受付を明示。
- **外部キュー（BullMQ/Redis 等）**: インフラ依存増。現規模では過剰。

**新規クロールの自動対象化（FR-007）**: クロール保存時（`saveDocument` / `crawl_component_docs`）に新断片を `pending` 状態で作成し、保存直後に当該ドキュメントの断片を埋め込みエンキュー（バックフィルワーカーと同一の生成経路を呼ぶ）。再クロールでコンテンツ変更（`content_hash` 差）を検知した断片のみ `pending` に戻して再生成、未変更なら再生成しない。

---

## R7. URL 正規化（監査 A-3、FR-015）

**Decision**: `src/utils/url-normalize.ts` に決定的な正規化関数 `normalizeUrl(raw): string` を実装し、(1) リンク発見時、(2) `visited` 登録時、(3) `documents` upsert の `ON CONFLICT (url)` キーで一貫適用する。正規化規則: スキーム/ホストを小文字化、デフォルトポート（80/443）除去、フラグメント除去、クエリパラメータをキー昇順にソート、空クエリの `?` 除去、ルート以外の末尾スラッシュを 1 つに正規化（除去）、`http`→既定は元スキーム維持だが host 単位で重複しないようパス正規化（`.`/`..` 解決）。

**Rationale**:
- A-3 の重複（`/x` vs `/x/`、クエリ順差）は保存キーの不一致が原因。保存前・visited・ON CONFLICT で同一の正規化を通せば重複行が生成されない（SC-004: 重複 0 件）。
- 純関数として `tests/unit/url-normalize` で網羅テスト可能。

**Alternatives considered**:
- **結果側で重複排除**: 監査が指摘するとおり根本解決にならず、埋め込みコストの二重化も残る。保存キー正規化を採用。
- **リダイレクト後 URL の保存（A-4）**: A-4 は Medium かつスペックのスコープ外（spec の対象は A-1/A-2/A-3）。本機能では扱わず別タスク。`http`/`https` 差の正規化は副作用が大きいため既定スキーム強制はせず、A-3 が要求する末尾スラッシュ・クエリ順・（リダイレクト差は最終 URL 取得が別課題のため）に限定する。

**スコープ注記**: spec FR-015 は「末尾スラッシュ・クエリパラメータの並び・リダイレクト差のみが異なる URL」。リダイレクト差の完全対応は最終 URL 保存（A-4）に依存するが、本機能では正規化関数で吸収可能な範囲（末尾スラッシュ・クエリ順・大文字小文字・デフォルトポート・フラグメント）を確実に解決する。リダイレクト着地 URL の保存は将来タスクとして research に明示する。

---

## R8. 段階的劣化（FR-011 / FR-012、SC-005）

**Decision**: 検索方式ごとに独立した実行関数を持ち、ハイブリッドは keyword と semantic を**それぞれ try で実行**し、semantic が失敗・空（埋め込み未生成・モデル接続不可・ベクトル索引なし）の場合は keyword 結果のみで RRF を縮退実行する。keyword 単独方式は常に PGroonga のみで完結し、埋め込み基盤の状態に依存しない。semantic 単独方式で埋め込みが皆無の場合は空結果＋件数 0 を返す（エラーにしない）。

**Rationale**:
- 可用性保証（SC-005: 劣化動作 100%）。意味検索基盤障害が全体停止に波及しない。
- RRF は片側のみでも順位融合が成立（片側集合の RRF = その順位スコア）。

**Alternatives considered**:
- **semantic 失敗で全体エラー**: spec が明示的に禁止（FR-012）。

---

## R9. 検索ツールの入力検証とページネーション（FR-006 / FR-017 / FR-018）

**Decision**:
- `mode` パラメータ（`keyword|semantic|hybrid`、既定 `hybrid`）。未知値は明確なエラーを返し既定に黙って切替えない（FR-006）。
- `limit` は `1..MAX_PAGE_LIMIT(100)` にクランプ（0・負数・超過を安全化、FR-017）。`offset` は非負にクランプ。
- `siteId` 絞り込み・`offset` ページネーションを全方式で維持（FR-018）。siteId は keyword/semantic 双方の SQL に `JOIN documents d ON ... WHERE d.site_id = $`/`AND d.site_id = $` で適用。

**Rationale**: 信頼境界（MCP 入力）での明示検証。spec の Edge Cases（空クエリ・極端な limit）に対応。空クエリは明確なエラー（既存挙動踏襲）。

**Alternatives considered**: 既存の `Math.min` のみ（下限・負数未検証、監査 D-6）→ クランプ関数で下限も含め検証する。

---

## 未解決事項（NEEDS CLARIFICATION の最終状態）

すべて解決済み。下記は運用前提として quickstart / data-model に反映する:
- PGroonga 拡張のインストールが前提（FR-013 達成のため不可欠）。
- 埋め込み次元の変更はマイグレーション＋再バックフィルを要する固定値運用。
- リダイレクト着地 URL 保存（A-4）は本機能スコープ外（別タスク）。
