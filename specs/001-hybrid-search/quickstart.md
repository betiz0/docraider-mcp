# Quickstart: Hybrid Search

ハイブリッド検索機能のセットアップと検証手順。詳細は [plan.md](./plan.md) / [data-model.md](./data-model.md) / [contracts/](./contracts/) を参照。

## 前提

- PostgreSQL に **PGroonga 拡張** と **pgvector 拡張** が導入済みであること（FR-013 達成に PGroonga は必須）。
  - PGroonga: https://pgroonga.github.io/install/ （日本語トークナイズに必要）
  - pgvector: `CREATE EXTENSION vector;`（マイグレーション 002 で実施）
- OpenAI 互換の埋め込みエンドポイント（ローカル: Ollama/LM Studio、または外部 API）が利用可能。

## 1. 設定

`config.yaml` に埋め込みセクションを追加:

```yaml
embedding:
  endpoint: "${EMBEDDING_ENDPOINT:-http://localhost:11434}"
  apiKey: "${EMBEDDING_API_KEY:-}"
  model: "${EMBEDDING_MODEL:-text-embedding-3-small}"
  dimensions: 1536        # chunks_embedding の vector(N) と一致必須
  batchSize: 16
  timeoutMs: 30000
```

> 次元を 1536 以外にする場合は、`chunks_embedding.embedding` のカラム次元を変更するマイグレーションと全断片の再バックフィルが必要。

## 2. マイグレーション適用

```bash
npm run build && node dist/db/migrate.js
# 007_pgroonga_fts / 008_embedding_status / 009_chunks_embedding_index / 010_backfill_jobs が適用される
```

## 3. 既存データのバックフィル（任意・既存ドキュメントがある場合）

MCP ツール `backfill_embeddings` を呼び出す → `jobId` と `estimatedTotal` が即座に返る。
進捗は `get_backfill_status`（または `get_index_stats`）で確認:

```
status=running total=1843 completed=920 failed=7 remaining=916
```

`completed` になれば既存ドキュメントが意味検索対象。

## 4. 検証シナリオ（spec 受け入れ基準）

| # | 操作 | 期待 | 対応 | 結果 |
|---|---|---|---|---|
| 1 | `search_crawled_docs { query: "認証" }`（mode 未指定） | hybrid 実行。`mode:"hybrid"` が返る | FR-002 / SC-008 | PASS |
| 2 | 同上で本文が "authentication" のみの英語文書 | 結果に含まれる | US1-1 / SC-001 | PASS |
| 3 | 日本語クエリで日本語文書 | ヒットする | US5-2 / SC-002 | PASS |
| 4 | 語形変化英語（例 "running"→索引 "run"） | ヒットする | US5-1 / SC-003 | PASS |
| 5 | `mode: "fuzzy"`（不正値） | 明確なエラー | FR-006 | PASS |
| 6 | `limit: -1` / `limit: 9999` | 1..100 にクランプ | FR-017 | PASS |
| 7 | 埋め込み空の状態で `mode: "keyword"` / `"hybrid"` | 停止せず結果 | FR-011/012 / SC-005 | PASS |
| 8 | 各結果項目 | `matchType` と `score` を含む | FR-004 / SC-006 | PASS |
| 9 | `/x` と `/x/` を再クロール | 重複ドキュメント 0 件 | US5-3 / SC-004 | PASS |
| 10 | `backfill_embeddings` を 2 連続実行 | 2 回目の再処理 0 件 | SC-007 | PASS |

**最終検証記録（2026-08-19）**: `tests/integration/quickstart.test.ts` で上記10シナリオを実行し、10/10 PASS。検証環境は `docker-compose.test.yml` の PostgreSQL 18 + PGroonga 4.0.8 + pgvector 0.8.1、およびテスト用 OpenAI 互換埋め込みサーバ。

## 5. テスト実行

```bash
npm test          # vitest run
```

- `tests/unit/`: `url-normalize`（正規化規則）、`fusion`（RRF）、`embedding/client`（fetch モック）。
- `tests/integration/`: 方式別検索・段階的劣化・バックフィル冪等・URL 正規化重複防止。
- `tests/contract/`: MCP ツール入出力スキーマ・方式ラベル・スコア付与。
