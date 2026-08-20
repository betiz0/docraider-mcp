## Why

Docraider の機能は現在 MCP stdio 経由でしか利用できず、pi の AI Agent が Bash から明示的かつ機械可読に呼び出す手段がない。また、短命な CLI プロセスから既存の非同期バックフィルを安全に継続し、意味検索の利用可否を Agent が判断するための運用状態も不足している。

## What Changes

- 既存の全 MCP ツールを網羅する、AI Agent 向けの `docraider` CLI を追加する。
- CLI の標準出力を安定した JSON 契約とし、ログ・進捗を標準エラーへ分離し、機械判定可能な終了コードを定義する。
- 長大な本文をファイルへ保存できる出力制御と、クロール等の長時間操作を扱う出力方式を提供する。
- 検索・クロール・管理に分割した pi 向け Skill セットを追加し、同じ成果物を Agent Skills 標準互換として配布可能にする。
- MCP と CLI が同じ型付き操作層を共有するよう責務を分離し、既存 MCP ツール名と外部契約を維持する。
- CLI からのバックフィルを永続ジョブとして受け付け、CLI 終了後も独立したバックグラウンド worker で継続できるようにする。
- worker の heartbeat/lease、ジョブ回収、進捗、および keyword/semantic/hybrid 検索の readiness を Agent が照会できるようにする。
- site 削除に対象 ID の再確認を要求し、Skill に破壊的操作の安全手順を定義する。

## Capabilities

### 新しい能力
- `agent-cli`: AI Agent が Bash から既存 Docraider 機能を一貫した JSON 契約で実行する CLI。
- `agent-skills`: pi を主要対象とし、Agent Skills 標準にも準拠する検索・クロール・管理 Skill セット。

### 変更する機能
- `embedding-indexing`: バックフィルを CLI の寿命から独立した永続ジョブとして実行し、worker の健全性、索引カバレッジ、検索方式別 readiness を取得可能にする。

## Impact

- `src/index.ts` の MCP スキーマ、操作、整形、起動処理を、共有操作層と MCP adapter へ分離する。
- CLI entrypoint、引数解析、JSON/JSONL 出力、終了コード、設定解決、プロセス終了時の DB cleanup が追加される。
- `backfill_jobs` に queue/lease/heartbeat/worker 情報を保持する DB migration と、detached worker 実行経路が追加される。
- `package.json` に CLI bin と pi package の Skill discovery 設定が追加される。
- `skills/` に pi/Agent Skills 互換パッケージが追加される。
- 既存 MCP stdio transport、MCP tool 名、入力 schema、応答形式は後方互換を維持する。
