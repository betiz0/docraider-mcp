---

description: "Task list for Hybrid Search (Keyword + Semantic)"
---

# Tasks: Hybrid Search (Keyword + Semantic)

**Input**: Design documents from `/specs/001-hybrid-search/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: テストタスクを含む（spec の各 User Story「Independent Test」・Success Criteria・quickstart 検証シナリオが明示的に検証を要求するため）。

**Organization**: タスクは User Story 単位でグループ化し、各ストーリーを独立して実装・テストできるようにする。

**基盤メモ**: 実コードベースは PostgreSQL（pg + pgvector + tsvector）。research R0 の決定によりベクトルは pgvector、全文検索は PGroonga、埋め込みは設定指定の OpenAI 互換クライアント（ローカル優先）。SQLite/sqlite-vec/FTS5 は採用しない。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 並列実行可（異なるファイル・未完了タスクへの依存なし）
- **[Story]**: 対応 User Story（US1〜US5）

## Path Conventions

- Single project: `src/`, `tests/`（リポジトリルート）

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: プロジェクト初期化と設定・定数の準備

- [X] T001 Create test directory structure `tests/contract/`, `tests/integration/`, `tests/unit/`, `tests/fixtures/`（plan.md の構成に従う）
- [X] T002 [P] Add `embedding:` section to `config.yaml` and create `.env.example` entries (endpoint/apiKey/model/dimensions/batchSize/timeoutMs)（data-model §7）
- [X] T003 [P] Add search/embedding constants to `src/constants/index.ts`（`SEARCH_MODES=['keyword','semantic','hybrid']`, `DEFAULT_SEARCH_MODE='hybrid'`, `RRF_K=60`, `DEFAULT_EMBEDDING_DIMENSIONS=1536`, `DEFAULT_EMBEDDING_BATCH_SIZE=16`, `DEFAULT_EMBEDDING_TIMEOUT_MS=30000`）

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: すべての User Story が依存するスキーマ・設定・埋め込み基盤

**⚠️ CRITICAL**: このフェーズ完了まで User Story 着手不可

- [X] T004 [P] Create migration `src/db/migrations/007_pgroonga_fts.sql`（`CREATE EXTENSION IF NOT EXISTS pgroonga;`、`DROP TRIGGER IF EXISTS trg_chunks_update_search_vector`、`DROP FUNCTION IF EXISTS update_search_vector`、`CREATE INDEX IF NOT EXISTS idx_chunks_pgroonga ON document_chunks USING pgroonga (content)`、`search_vector` を NULL 許容化で残置）（research R1/R2 移行パス）
- [X] T005 [P] Create migration `src/db/migrations/008_embedding_status.sql`（`document_chunks` に `embedding_status TEXT DEFAULT 'pending' CHECK (...)`, `embedding_attempts INT DEFAULT 0`, `embedding_error TEXT`, `embedding_model TEXT`, `embedding_updated_at TIMESTAMPTZ` を `ADD COLUMN IF NOT EXISTS`、部分索引 `idx_chunks_embedding_status`）（data-model §3）
- [X] T006 [P] Create migration `src/db/migrations/009_chunks_embedding_index.sql`（`CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw ON chunks_embedding USING hnsw (embedding vector_cosine_ops)`）（research R3）
- [X] T007 [P] Create migration `src/db/migrations/010_backfill_jobs.sql`（`backfill_jobs` テーブル＋`idx_backfill_jobs_status`）（data-model §5）
- [X] T008 Extend `src/config.ts`（`EmbeddingConfig` interface・`embedding` ローダ・`dimensions` と起動時整合チェック）（data-model §7）
- [X] T009 [P] Update `src/db/types.ts`（`DocumentChunk.embedding` を除去し `embeddingStatus/embeddingAttempts/embeddingError/embeddingModel/embeddingUpdatedAt` を追加、`BackfillJob`・`HybridSearchResult`・`SearchMode` 型を追加）（data-model §3/§5/§6, 監査 B-4）
- [X] T010 Implement OpenAI 互換 embedding client `src/embedding/client.ts`（`fetch POST {endpoint}/v1/embeddings`、`Authorization: Bearer`、バッチ入力、timeout、エラー整形）（research R5）
- [X] T011 Implement embedding generation service `src/embedding/generate.ts`（断片配列を埋め込み→`chunks_embedding` に upsert（`ON CONFLICT (chunk_id, model_version)`）＋`document_chunks.embedding_status` 更新、失敗時は `failed`＋既存ベクトル保持）（depends on T010, T005; research R5/R6）
- [X] T012 Add DB methods to `src/db/index.ts`（埋め込み状態の集計・対象断片抽出（`status IN ('pending','failed')`、`FOR UPDATE SKIP LOCKED`）、ベクトル近傍検索クエリ、PGroonga キーワード検索クエリ、`backfill_jobs` の CRUD）（depends on T004-T009）

**Checkpoint**: 基盤完成 — User Story 実装を開始可能

---

## Phase 3: User Story 5 - 検索品質・データ整合性の既存不具合修正 (Priority: P1) 🎯 MVP 前提

**Goal**: 監査 A-1（FTS 言語不整合）・A-2（日本語未トークナイズ）・A-3（URL 正規化欠如の重複）を解消し、ハイブリッドのスコア統合が信頼できる土台を作る。

**Independent Test**: 語形変化英語クエリで取りこぼし解消（A-1）、日本語クエリで日本語文書がヒット（A-2）、末尾スラッシュ/クエリ順/差のある URL 再クロールで重複行が増えない（A-3）を個別検証。

### Tests for User Story 5

- [X] T013 [P] [US5] Integration test A-1（語形変化英語の再現率）in `tests/integration/fts-language.test.ts`
- [X] T014 [P] [US5] Integration test A-2（日本語トークナイズ・日本語クエリヒット）in `tests/integration/fts-japanese.test.ts`
- [X] T015 [P] [US5] Unit test 正規化規則（末尾スラッシュ/クエリ順/大小文字/デフォルトポート/フラグメント）in `tests/unit/url-normalize.test.ts`
- [X] T016 [P] [US5] Integration test A-3（再クロールで重複ドキュメント 0 件）in `tests/integration/url-dedup.test.ts`

### Implementation for User Story 5

- [X] T017 [P] [US5] Implement `normalizeUrl(raw): string` in `src/utils/url-normalize.ts`（research R7 の規則）
- [X] T018 [US5] Apply `normalizeUrl` in `src/crawler/crawler.ts`（リンク発見・`visited` 登録・`saveDocument` の `ON CONFLICT (url)` キー）（depends on T017）
- [X] T019 [US5] Apply `normalizeUrl` in `crawl_component_docs` 保存経路 in `src/index.ts`（depends on T017）
- [X] T020 [US5] Implement PGroonga keyword search in `src/search/keyword.ts`（`content &@~ $query`＋`pgroonga_score()`、`siteId` 絞り込み、`limit/offset`、`ts_headline` 相当のハイライト）（depends on T012; research R1）
- [X] T021 [US5] Remove dead FTS language 引数 / english トリガー依存 in チャンク INSERT（`src/db/index.ts` `createChunks`、`src/crawler/crawler.ts` `saveDocument`、`src/index.ts` `crawl_component_docs`：`to_tsvector($lang,...)` 依存を撤去し PGroonga 索引に一本化）（A-1）

**Checkpoint**: キーワード検索が日英で正しく機能し、再クロール重複が発生しない

---

## Phase 4: User Story 1 - 言い換え・概念一致の意味検索 (Priority: P1)

**Goal**: 字面が一致しなくても概念的に近い文書が返る意味検索を提供する（例:「認証」で "authentication" のみの文書がヒット）。

**Independent Test**: 「概念は同じだが用語が異なる」評価クエリ集合で、意味検索が該当文書を上位返却し、キーワードのみより再現率が向上することを検証。

### Tests for User Story 1

- [X] T022 [P] [US1] Create evaluation query fixtures（日英・言い換えを含む）in `tests/fixtures/eval-queries.ts`（spec Assumptions 評価集合）
- [X] T023 [P] [US1] Integration test 意味検索の概念/言い換え再現率（キーワードのみとの比較）in `tests/integration/semantic-search.test.ts`

### Implementation for User Story 1

- [X] T024 [US1] Implement semantic search in `src/search/semantic.ts`（クエリ埋め込み生成→`embedding <=> $vec` 近傍検索、`1-距離` を類似度スコア、`siteId/limit/offset`）（depends on T010, T012; research R3）

**Checkpoint**: 埋め込み済みデータに対し意味検索が概念一致で結果を返す

---

## Phase 5: User Story 2 - 検索方式を選べるハイブリッド検索ツール (Priority: P1)

**Goal**: keyword/semantic/hybrid を選択でき（既定 hybrid）、各結果に matchType とスコアを付与する MCP ツールを提供する。

**Independent Test**: 同一クエリを 3 方式で実行し、(a) 既定が hybrid、(b) 各結果に方式ラベルとスコア、(c) 方式で結果集合が変わる、(d) 不正方式はエラーを検証。

### Tests for User Story 2

- [X] T025 [P] [US2] Contract test `search_crawled_docs`（既定 hybrid・不正 mode エラー・limit/offset クランプ・空クエリエラー・matchType+score 付与）in `tests/contract/search_crawled_docs.test.ts`（contracts/search_crawled_docs.md）
- [X] T026 [P] [US2] Unit test RRF 融合（順位融合・両ヒット統合・matchType 判定）in `tests/unit/fusion.test.ts`
- [X] T027 [P] [US2] Integration test ハイブリッド統合ランキングと重複排除 in `tests/integration/hybrid-search.test.ts`

### Implementation for User Story 2

- [X] T028 [P] [US2] Implement RRF fusion in `src/search/fusion.ts`（`score=Σ 1/(k+rank)`、`chunkId` で重複排除、`matchType=keyword|semantic|both`）（research R4）
- [X] T029 [US2] Implement search orchestrator in `src/search.ts`（`mode` 分岐で keyword/semantic/hybrid を呼び、`HybridSearchResult[]` と総件数を返す）（depends on T020, T024, T028）
- [X] T030 [US2] Update `search_crawled_docs` handler in `src/index.ts`（`mode` 受理・空クエリ/不正 mode の明確なエラー・`limit` 1..100 / `offset` 非負クランプ・`matchType`/`score` を含む JSON 出力）（depends on T029; FR-006/017）
- [X] T031 [US2] Update `search_crawled_docs` input schema in ListTools handler `src/index.ts`（`mode` enum・既定値）（depends on T030）

**Checkpoint**: 3 方式選択・既定 hybrid・方式ラベル/スコア付与が機能

---

## Phase 6: User Story 3 - 既存分のバックフィルと新規分の自動対象化 (Priority: P2)

**Goal**: 新規クロール文書を自動で意味検索対象化し、既存文書を非同期バックフィルで変換、進捗を参照可能にする（冪等）。

**Independent Test**: 既存文書をバックフィルし対象/完了/失敗件数を取得→意味検索ヒットを確認。新規クロール後に追加操作なしで意味検索対象になることを確認。2 回連続実行で 2 回目の再処理 0 件。

### Tests for User Story 3

- [X] T032 [P] [US3] Integration test バックフィル冪等性（2 回実行で 2 回目 0 件）in `tests/integration/backfill-idempotent.test.ts`（SC-007）
- [X] T033 [P] [US3] Integration test 新規クロールの自動埋め込み対象化 in `tests/integration/auto-embed.test.ts`（FR-007）

### Implementation for User Story 3

- [X] T034 [US3] Implement async backfill service in `src/embedding/backfill.ts`（`backfill_jobs` 作成、`setImmediate` ワーカーループ、バッチ処理、`status IN ('pending','failed')` 抽出、進捗永続化、単一 running 直列化）（depends on T011, T012; research R6）
- [X] T035 [US3] Add `backfill_embeddings` tool in `src/index.ts`（即時受付応答 `jobId`+`estimatedTotal`+`status`）（depends on T034; contracts/backfill_embeddings.md）
- [X] T036 [US3] Add `get_backfill_status` tool ＋ extend `get_index_stats` に埋め込み集計 in `src/index.ts`（depends on T034; contracts/get_backfill_status.md）
- [X] T037 [US3] Enqueue embeddings on crawl save in `src/crawler/crawler.ts` ＋ `crawl_component_docs` in `src/index.ts`（新規/`content_hash` 変化断片を `pending`→自動埋め込み、未変更は再生成しない）（depends on T011; FR-007）
- [X] T038 [US3] Register `backfill_embeddings` / `get_backfill_status` in ListTools handler `src/index.ts`（depends on T035, T036）

**Checkpoint**: 既存分バックフィル・新規分自動対象化・進捗参照・冪等性が機能

---

## Phase 7: User Story 4 - 段階的劣化（意味検索未準備でも止まらない） (Priority: P2)

**Goal**: 埋め込み未完了・失敗でもキーワード検索は継続し、ハイブリッドは意味検索不可の範囲でキーワードにフォールバックする。

**Independent Test**: 意味検索インデックスが空/一部欠損/生成失敗の各状態で keyword/hybrid が停止せず妥当な結果を返すことを検証。

### Tests for User Story 4

- [X] T039 [P] [US4] Integration test 段階的劣化（空/一部欠損/生成失敗で keyword+hybrid が結果返却、semantic は空結果でエラーにしない）in `tests/integration/degradation.test.ts`（SC-005）

### Implementation for User Story 4

- [X] T040 [US4] Add degradation/fallback logic in `src/search.ts`（hybrid は semantic 失敗/空時に keyword 結果へ縮退、semantic 単独は埋め込み皆無で空結果＋件数 0、keyword は埋め込み状態に非依存）（depends on T029; FR-011/012）

**Checkpoint**: 全方式が意味検索基盤の障害に対し停止しない

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: 横断的な仕上げ

- [X] T041 [P] Update `README.md`（ハイブリッド検索の使い方・PGroonga/pgvector セットアップ・埋め込み設定）
- [X] T042 [P] Unit test embedding client（fetch モックでバッチ/timeout/エラー）in `tests/unit/embedding-client.test.ts`
- [X] T043 [P] Regression test `delete_site` 時に `chunks_embedding` 行も FK CASCADE で削除されることを確認 in `tests/integration/delete-cascade.test.ts`（カスケードは既存 `002_pgvector.sql` の `chunk_id ON DELETE CASCADE` により自動。新規実装不要、埋め込みデータ追加後の取り残し防止を保証する回帰テスト。data-model §4、監査 A-5=cascade 健全の確認）
- [X] T045 [P] Integration test FR-018 既存絞り込み・ページネーションの全方式維持（keyword/semantic/hybrid 各方式で `siteId` 絞り込み＋`limit/offset` が一貫して機能）in `tests/integration/filter-pagination.test.ts`（FR-018; depends on T029）

### SSRF 対策（FR-020 / SC-010、セキュリティレビュー High）

> 本機能は新規取得ツール追加と既存取得経路の改修を伴うため、広がる取得面に対する SSRF 対策を本機能の一部として実装する（spec Assumptions / Edge Cases / FR-020）。

- [X] T046 [P] Integration test SSRF 遮断 in `tests/integration/ssrf.test.ts`（ループバック `127.0.0.0/8`・`::1`、プライベート RFC1918、リンクローカル `169.254.0.0/16`（メタデータ `169.254.169.254` 含む）、非 HTTP スキーム `file:`/`gopher:`/`ftp:` で取得拒否率 100%、内部リソース応答本文の非混入、リダイレクト先・発見リンクの遮断を検証）（SC-010）
- [X] T047 Implement SSRF guard in `src/utils/ssrf-guard.ts`（`http`/`https` のみ許可・それ以外は明確なエラー、名前解決後 IP のループバック/RFC1918/リンクローカル判定、DNS リバインディング対策として検証時と接続時で同一解決結果を用いる接続時再検証ヘルパ）（FR-020）
- [X] T048 Apply SSRF guard to fetch 経路 in `src/crawler/crawler.ts`・`src/crawler/robots.ts`・`src/crawler/sitemap.ts`（外部入力 URL・クロール中の発見リンク・robots/sitemap 由来 URL・リダイレクト先を取得前に検証、拒否時は内部応答本文を結果に含めず明確なエラーを返す）（depends on T047; FR-020）
- [X] T049 Apply SSRF guard in tool handlers `src/index.ts`（`read_and_extract_page` / `crawl_component_docs` / `crawl_documentation_site` の取得前に検証を適用、正規化（FR-015）とは別経路でスキーム・ホストを制限）（depends on T047; FR-020）

- [X] T044 Run quickstart.md の 10 検証シナリオを通し最終確認（`specs/001-hybrid-search/quickstart.md`）。各シナリオに合否（PASS/FAIL）を記録し、FAIL があれば該当 User Story の Checkpoint に差し戻す

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 依存なし。即時開始可
- **Foundational (Phase 2)**: Setup 完了に依存。全 User Story をブロック
- **User Stories (Phase 3-7)**: Foundational 完了後に開始可
- **Polish (Phase 8)**: 対象 User Story 完了後

### User Story Dependencies

- **US5 (P1)**: Foundational 後に開始可。独立（A-1/A-2/A-3 修正）。キーワード検索は他ストーリーの土台
- **US1 (P1)**: Foundational 後に開始可。意味検索。埋め込み生成（T011）に依存
- **US2 (P1)**: US5（keyword: T020）と US1（semantic: T024）の実装に依存（hybrid 統合のため）。融合 T028 は独立並列可
- **US3 (P2)**: 埋め込み生成（T011）・DB 層（T012）に依存。独立テスト可
- **US4 (P2)**: orchestrator（T029）に依存

### Within Each User Story

- テストを先に書き、実装前に失敗を確認
- 正規化/融合などの純関数は並列で先行可
- src/index.ts を触るタスク（T019, T030, T031, T035, T036, T037, T038）は同一ファイルのため直列

### Parallel Opportunities

- Setup: T002, T003 並列
- Foundational: T004-T007（マイグレーション各別ファイル）並列、T009 並列
- US5: T013-T016（テスト各別ファイル）並列、T017 並列
- US2: T025-T027（テスト）並列、T028（fusion）並列
- US3: T032, T033（テスト）並列
- Polish: T041, T042, T043, T045 並列、T046（SSRF テスト）並列。T048/T049 は T047 完了後

---

## Parallel Example: User Story 5

```bash
# テストを並列起動（実装前に失敗確認）:
Task: "Integration test A-1 in tests/integration/fts-language.test.ts"
Task: "Integration test A-2 in tests/integration/fts-japanese.test.ts"
Task: "Unit test url-normalize in tests/unit/url-normalize.test.ts"
Task: "Integration test A-3 in tests/integration/url-dedup.test.ts"

# 純関数の実装を並列起動:
Task: "Implement normalizeUrl in src/utils/url-normalize.ts"
```

---

## Implementation Strategy

### MVP First

1. Phase 1 Setup → Phase 2 Foundational（CRITICAL）
2. Phase 3 US5（検索品質の土台 A-1/A-2/A-3）→ 独立検証
3. Phase 4 US1（意味検索）→ 独立検証
4. Phase 5 US2（ハイブリッドツール）→ **MVP（3 方式・既定 hybrid・matchType/score）として成立**
5. STOP and VALIDATE

### Incremental Delivery

1. Setup + Foundational → 基盤
2. US5 → キーワード検索が日英で正しく動く（Deploy/Demo 可）
3. US1 → 意味検索追加（Demo）
4. US2 → ハイブリッド統合（MVP!）
5. US3 → 既存分バックフィル・新規自動化
6. US4 → 段階的劣化の保証
7. 各ストーリーは前のストーリーを壊さず価値を追加

### Notes

- [P] = 異なるファイル・依存なし
- src/index.ts・src/search.ts を共有するタスクは直列
- テストは実装前に失敗を確認
- 各タスクまたは論理グループ単位でコミット
- 各 Checkpoint でストーリーを独立検証
