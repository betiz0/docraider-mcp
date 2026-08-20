## Why

既存のキーワード一致検索だけでは、日英の言い換えや概念的に近い文書を取りこぼし、日本語のトークナイズ不備やURL重複も検索品質を損なっていた。意味検索を追加しつつ、埋め込み基盤が未準備・障害中でも検索を止めない運用可能なハイブリッド検索が必要である。

## What Changes

- PGroongaによる日本語・英語キーワード検索と、pgvectorによる意味検索を提供する。
- `keyword` / `semantic` / `hybrid` の3方式を選択可能にし、既定を`hybrid`とする。
- キーワード順位と意味順位をRRFで統合し、各結果に`matchType`と数値スコアを付与する。
- 新規・更新チャンクを自動的に埋め込み対象化し、既存データ向けの非同期バックフィルと進捗確認を提供する。
- 埋め込み未生成・一部失敗・API障害時にキーワード検索へ段階的に縮退する。
- URLを一貫して正規化して再クロール時の重複を防止する。
- クロール・ページ取得経路にSSRF防止を適用し、内部ネットワークと非HTTP(S)スキームへの取得を拒否する。
- PGroonga、pgvector、OpenAI互換埋め込みAPIを使用する。SQLiteへの移行は行わない。

## Capabilities

### 新しい能力

- `document-search`: 日英キーワード検索、意味検索、RRFハイブリッド検索、方式選択、結果メタデータ、絞り込み、ページネーション、段階的劣化を規定する。
- `embedding-indexing`: 新規・更新チャンクの自動埋め込み、既存チャンクの非同期バックフィル、状態管理、冪等性、設定可能なOpenAI互換APIを規定する。
- `crawl-url-safety`: URL正規化による重複防止と、全取得経路におけるSSRF防止を規定する。

### 変更する機能

- なし。

## Impact

- MCPツール: `search_crawled_docs`を拡張し、`backfill_embeddings`と`get_backfill_status`を追加する。
- データベース: PostgreSQLにPGroonga/pgvector索引、チャンク埋め込み状態、バックフィルジョブを追加する。
- コード: `src/search*`、`src/embedding/*`、`src/crawler/*`、`src/db/*`、`src/utils/*`、`src/index.ts`に影響する。
- 運用: PGroongaとpgvector、および設定されたOpenAI互換埋め込みエンドポイントが必要になる。意味検索が利用不能でもキーワード検索は継続する。
- 互換性: 既存検索のサイト絞り込みとページネーションを維持する。検索方式未指定時の既定はハイブリッドに変わる。
