# Phase 1 Data Model: Hybrid Search

対象: [spec.md](./spec.md) Key Entities / [research.md](./research.md)

既存スキーマ（`001`〜`006`）を基盤に、本機能で追加・変更する要素を示す。新規マイグレーションは `007`〜`010`。

---

## 1. エンティティ一覧と対応テーブル

| Spec エンティティ | 実体 | 状態 |
|---|---|---|
| Document（ドキュメント） | `documents` | 既存。`url` を正規化値で一意管理（A-3） |
| Content Chunk（断片） | `document_chunks` | 既存＋埋め込み状態列を追加 |
| Semantic Representation（意味表現） | `chunks_embedding` | 既存（再利用）。状態は `document_chunks` で管理 |
| Search Result（検索結果） | 永続化なし（アプリ層 DTO） | 新規型 `HybridSearchResult` |
| Backfill Job（バックフィル処理） | `backfill_jobs` | 新規テーブル |

---

## 2. documents（既存・変更なしだが運用変更）

主要列: `id UUID PK`, `url TEXT UNIQUE NOT NULL`, `title`, `content`, `content_hash`, `etag`, `last_modified`, `site_id`, `last_crawled_at`, タイムスタンプ。

- **変更**: スキーマ変更なし。ただし `url` には常に `normalizeUrl()` の出力を格納する（保存前・`ON CONFLICT (url)` キー・クローラの `visited` で一貫適用）。これにより末尾スラッシュ・クエリ順差の重複行を防止（FR-015 / SC-004）。
- バリデーション: `url` は正規化済みであること（アプリ層保証）。

---

## 3. document_chunks（既存＋列追加: マイグレーション 008）

既存列: `id UUID PK`, `document_id UUID FK→documents ON DELETE CASCADE`, `chunk_index INT`, `content TEXT`, `heading_path TEXT[]`, `search_vector TSVECTOR`（PGroonga 移行後は未使用・残置可）, `created_at`。

**追加列**:

| 列 | 型 | 既定 | 用途 |
|---|---|---|---|
| `embedding_status` | TEXT | `'pending'` | `pending` / `completed` / `failed`。CHECK 制約 |
| `embedding_attempts` | INTEGER | `0` | 失敗試行回数（FR-016 の再試行管理） |
| `embedding_error` | TEXT | NULL | 直近失敗の要因 |
| `embedding_model` | TEXT | NULL | 完了時のモデル世代（`chunks_embedding.model_version` と一致） |
| `embedding_updated_at` | TIMESTAMPTZ | NULL | 状態最終更新時刻 |

**索引**:
- PGroonga 全文検索索引（マイグレーション 007）: `CREATE INDEX ... USING pgroonga (content)`。
- 状態抽出用: `CREATE INDEX idx_chunks_embedding_status ON document_chunks(embedding_status) WHERE embedding_status <> 'completed'`（部分索引でバックフィル対象抽出を高速化）。

**状態遷移**:
```
pending ──(埋め込み生成成功)──▶ completed
pending ──(生成失敗)──────────▶ failed
failed  ──(再バックフィル)─────▶ pending ─▶ completed/failed
completed ─(再クロールで content_hash 変化)─▶ pending
completed ─(content 未変更)──────────────▶ completed（再生成しない）
```

**バリデーション規則**:
- `embedding_status` は CHECK で 3 値に限定。
- `completed` 遷移時のみ `chunks_embedding` に対応ベクトル行が存在しなければならない（アプリ層保証）。
- 再生成失敗（completed→生成失敗）時は既存ベクトルを破棄せず `failed` フラグのみ立てる（spec Edge Cases）。

---

## 4. chunks_embedding（既存・再利用、索引追加: マイグレーション 009）

既存列（`002_pgvector.sql`）: `id UUID PK`, `chunk_id UUID FK→document_chunks ON DELETE CASCADE`, `embedding vector(1536)`, `model_version TEXT`, `created_at`, UNIQUE(`chunk_id`, `model_version`)。

**追加索引**:
- `CREATE INDEX idx_chunks_embedding_hnsw ON chunks_embedding USING hnsw (embedding vector_cosine_ops);`（R3）。

**運用**:
- 1 断片 × モデル世代ごとに最大 1 行（既存 UNIQUE）。次元は `vector(1536)` 固定（FR-019 の次元変更はマイグレーション＋再バックフィル）。
- upsert: `INSERT ... ON CONFLICT (chunk_id, model_version) DO UPDATE SET embedding=EXCLUDED.embedding, created_at=NOW()`（冪等再生成）。

**Spec エンティティ対応**: `model_version`＝モデル世代、`created_at`＝生成日時、失敗識別は `document_chunks.embedding_status='failed'` で表現。

---

## 5. backfill_jobs（新規: マイグレーション 010）

| 列 | 型 | 既定 | 用途 |
|---|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` | ジョブ ID（ツール応答の `jobId`） |
| `status` | TEXT | `'running'` | `running` / `completed` / `failed` / `cancelled`。CHECK |
| `total` | INTEGER | `0` | 受付時の対象件数見込み（FR-008） |
| `completed` | INTEGER | `0` | 完了断片数 |
| `failed` | INTEGER | `0` | 失敗断片数 |
| `model_version` | TEXT | NOT NULL | 実行時の埋め込みモデル世代 |
| `site_id` | UUID | NULL | 任意の対象サイト絞り込み |
| `started_at` | TIMESTAMPTZ | `NOW()` | 開始時刻 |
| `finished_at` | TIMESTAMPTZ | NULL | 終了時刻 |
| `error` | TEXT | NULL | ジョブ全体の致命的エラー |

**索引**: `idx_backfill_jobs_status ON backfill_jobs(status)`（実行中ジョブの検出用）。

**状態遷移**:
```
running ──(全対象処理完了)──▶ completed
running ──(致命的エラー)────▶ failed
running ──(明示停止 任意)───▶ cancelled
```

**バリデーション / 冪等性（FR-010）**:
- 対象断片抽出は `embedding_status IN ('pending','failed')`。`completed` は除外（二重処理しない）。
- 同時に複数の `running` ジョブを許容しない（受付時に既存 `running` があれば既存ジョブ情報を返す、または直列化）。

---

## 6. アプリ層 DTO

### HybridSearchResult（検索結果、永続化なし）

| フィールド | 型 | 説明 |
|---|---|---|
| `chunkId` | string | 断片 ID（融合・重複排除キー） |
| `documentId` | string | 親ドキュメント ID |
| `url` | string | 正規化済み URL |
| `title` | string | ドキュメントタイトル |
| `content` | string | 断片本文（または抜粋） |
| `headingPath` | string[] | 見出しパス |
| `headline` | string | 表示用ハイライト抜粋 |
| `matchType` | `'keyword' \| 'semantic' \| 'both'` | ヒット方式（FR-004 / FR-005） |
| `score` | number | RRF 統合スコア（方式単独時は当該方式スコア由来の順位スコア） |
| `keywordRank` | number \| null | キーワード検索での順位（デバッグ/説明用、任意） |
| `semanticRank` | number \| null | 意味検索での順位（任意） |

- バリデーション: `matchType` と `score` は全結果に必須（SC-006: 付与率 100%）。

### SearchMode（入力）

`'keyword' | 'semantic' | 'hybrid'`。未指定→`hybrid`（FR-002）。未知値→エラー（FR-006）。

---

## 7. 設定（config.yaml 追加セクション `embedding:`）

| キー | 型 | 既定 | 説明 |
|---|---|---|---|
| `endpoint` | string | `http://localhost:11434` 等 | OpenAI 互換ベース URL |
| `apiKey` | string | "" | 任意。`Authorization: Bearer` |
| `model` | string | — | 埋め込みモデル名 |
| `dimensions` | number | 1536 | 次元（`chunks_embedding` と一致必須） |
| `batchSize` | number | 16 | 1 リクエストの最大入力件数 |
| `timeoutMs` | number | 30000 | リクエストタイムアウト |

- バリデーション: `dimensions` は `chunks_embedding.embedding` のカラム次元と一致しなければならない（不一致は起動時 or 生成時にエラー）。

---

## 8. マイグレーション依存順

```
001 → 002 → 003 → 004 → 005 → 006
                          └─▶ 007_pgroonga_fts（005 のトリガー撤去・PGroonga 索引）
                          └─▶ 008_embedding_status（document_chunks 列追加）
                          └─▶ 009_chunks_embedding_index（002 の表に HNSW 索引）
                          └─▶ 010_backfill_jobs（新規表）
```

連番ソート適用（`migrate.ts`）のため 007〜010 の順で安全に適用される。
