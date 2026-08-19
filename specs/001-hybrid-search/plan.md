# Implementation Plan: Hybrid Search (Keyword + Semantic)

**Branch**: `001-hybrid-search` | **Date**: 2026-06-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-hybrid-search/spec.md`

## Summary

既存の PostgreSQL 全文検索（tsvector/GIN）に、OpenAI 互換 API で生成する埋め込みを用いた pgvector セマンティック検索を追加し、両者を RRF（Reciprocal Rank Fusion）で統合するハイブリッド検索を MCP ツールとして提供する。検索方式（keyword / semantic / hybrid）は呼び出し側が選択でき、既定は hybrid。各結果にヒット方式とスコアを付与する。新規クロール分は自動で埋め込み対象化し、既存分は非同期バックフィルツールで変換する。埋め込み未完了・失敗でもキーワード検索は継続動作（段階的劣化）。あわせて監査レポートの Critical/High のうち検索品質・データ整合性に直結する A-1（FTS 言語構成の不整合）・A-2（日本語未トークナイズ）・A-3（URL 正規化欠如による重複）を本機能の一部として修正する。

**基盤の決定（利用者方針への対応、research R0 参照）**: 利用者の技術方針は SQLite（sqlite-vec / FTS5 bm25）前提だったが、実コードベースは PostgreSQL。「外部ベクトル DB プロセスを避ける」という利用者の最重要意図は **DB 内蔵の pgvector が既存資産のまま満たす**ため、SQLite への全面移行（破壊的）は行わず PostgreSQL を維持する。ベクトル格納は sqlite-vec/手動コサインと比較のうえ pgvector を選定（R0.2 比較表）。スコア統合は利用者方針どおり RRF 既定・線形結合不採用。埋め込みは「設定ファイルで指定する単一の OpenAI 互換クライアント」で、既定はローカル互換サーバ（Ollama 等、日英対応モデル）として社内データを外部送信しない構成を推奨し、設定差し替えで外部 API にも対応する（コード分岐なし）。

## Technical Context

**Language/Version**: TypeScript 5.6 / Node.js >=18（ESM, `"type": "module"`）

**Primary Dependencies**: `@modelcontextprotocol/sdk`（MCP）, `pg`（PostgreSQL ドライバ）, `playwright`（クロール）, `cheerio`/`@mozilla/readability`/`turndown`（抽出）, `js-yaml`, `pino`。埋め込み生成はランタイム標準の `fetch`（OpenAI 互換 `/v1/embeddings`）を使用し新規 SDK 依存を追加しない。

**Storage**: PostgreSQL。全文検索は PGroonga（日本語・英語を単一構成でトークナイズ）。ベクトルは pgvector 拡張の `chunks_embedding` テーブル（`vector(1536)`）。マイグレーションは `src/db/migrations/*.sql` を連番適用。

**Testing**: vitest（`vitest run`）。contract / integration / unit の 3 層。

**Target Platform**: Linux サーバ上で stdio 経由の MCP サーバとして常駐。

**Project Type**: Single project（MCP サーバ。`src/` 配下に集約）。

**Performance Goals**: 初期リリースでは応答時間の数値目標を設定しない（SC-009）。実装後に実測しスペックへ追記する。

**Constraints**: 段階的劣化必須（埋め込み未準備でも keyword/hybrid が停止しない）。RRF は順位のみを用いスコアスケール差に頑健。バックフィルは冪等かつバックグラウンド実行で通常のクロール・検索を阻害しない。埋め込みエンドポイント・モデル名・次元は設定ファイルで指定（ローカル互換サーバ／外部 API を区別しない）。

**Scale/Scope**: 既存規模はサイト数〜文書数千〜断片数万を想定。新規 MCP ツール 1〜2 件追加、既存検索ツール 1 件改修、FTS マイグレーション 2〜3 件、URL 正規化ユーティリティ 1 件、埋め込みクライアント／生成サービス／バックフィルサービス各 1 件。

## Constitution Check

*GATE: Phase 0 前に通過必須。Phase 1 後に再確認。*

`.specify/memory/constitution.md` はテンプレート未記入（具体的な原則・ゲートが定義されていない）。したがって強制されるゲートは存在せず、本計画は一般的なソフトウェア工学規範（段階的劣化・テスト容易性・最小複雑度・後方互換を壊さない移行）に従う。**結果: PASS（適用可能な原則なし）。**

Constitution が後日記入された場合は本セクションを再評価すること。

## Project Structure

### Documentation (this feature)

```text
specs/001-hybrid-search/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output（MCP ツール契約）
│   ├── search_crawled_docs.md
│   ├── backfill_embeddings.md
│   └── get_backfill_status.md
└── tasks.md             # /speckit-tasks で生成（本コマンドでは未作成）
```

### Source Code (repository root)

```text
src/
├── index.ts                    # MCP サーバ・ツールハンドラ（search/backfill ツール改修・追加）
├── config.ts                   # embedding 設定セクションを追加
├── search.ts                   # キーワード/セマンティック/ハイブリッド検索を実装
├── search/
│   ├── keyword.ts              # PGroonga ベースのキーワード検索
│   ├── semantic.ts             # pgvector 近傍検索
│   └── fusion.ts               # RRF 統合・結果重複排除
├── embedding/
│   ├── client.ts               # OpenAI 互換 /v1/embeddings クライアント（fetch）
│   ├── generate.ts             # 埋め込み生成サービス（chunks_embedding upsert・embedding_status 更新）
│   └── backfill.ts             # 非同期バックフィルサービス（冪等・進捗管理）
├── utils/
│   └── url-normalize.ts        # URL 正規化（A-3）
├── crawler/
│   └── crawler.ts              # リンク発見・visited・保存で正規化 URL を一貫適用 / クロール後に埋め込みをエンキュー
├── db/
│   ├── index.ts                # 埋め込み・バックフィル・検索クエリ用メソッド追加
│   ├── types.ts                # エンティティ型を実体に整合（embedding_status 等）
│   └── migrations/
│       ├── 007_pgroonga_fts.sql            # PGroonga 索引・トリガー一本化（A-1/A-2）
│       ├── 008_embedding_status.sql        # document_chunks に埋め込み状態列
│       ├── 009_chunks_embedding_index.sql  # pgvector HNSW 索引
│       └── 010_backfill_jobs.sql           # バックフィルジョブ管理テーブル
└── constants/index.ts          # 検索方式・RRF・埋め込み既定値

tests/
├── contract/                   # MCP ツール契約テスト（入出力スキーマ・方式ラベル・スコア付与）
├── integration/                # 検索方式別・段階的劣化・バックフィル冪等・URL 正規化重複防止
└── unit/                       # url-normalize / RRF fusion / embedding client（モック）
```

**Structure Decision**: 既存の Single project 構成を維持し、検索・埋め込みの関心ごとを `src/search/`・`src/embedding/` のサブモジュールに分離する。DB アクセスは既存の `src/db/index.ts` の `DatabaseManager` に集約する方針を踏襲する。

## Complexity Tracking

> Constitution に強制ゲートが無いため違反は発生しない。記載不要。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| （なし） | — | — |
