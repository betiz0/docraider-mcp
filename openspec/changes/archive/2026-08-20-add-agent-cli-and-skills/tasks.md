## 1. 契約基盤と既存MCP保護

- [x] 1.1 既存12 MCP tool の名前、入力 schema、成功応答、代表的エラー応答を固定する contract/characterization test を追加する
- [x] 1.2 transport 非依存の操作入力・結果・警告・分類済みエラー型と、MCP/CLI の操作対応表を定義する
- [x] 1.3 MCP server の生成と entrypoint 起動を分離し、モジュール import だけでは stdio server や `main()` が起動しない構造にする

## 2. 設定とリソースライフサイクル

- [x] 2.1 設定 loader を関数化し、`--config`、`DOCRAIDER_CONFIG`、cwd、package 設定、組み込み既定値の優先順位と選択設定に対応する `.env` 解決を実装する
- [x] 2.2 DB manager と browser 利用箇所へ明示的な所有権・cleanup 境界を導入し、短命 CLI が成功時と失敗時の双方で終了できるようにする
- [x] 2.3 設定優先順位、設定エラー時の副作用防止、DB/browser cleanup を unit test で検証する

## 3. 共有操作層とMCP adapter

- [x] 3.1 ページ取得、サイトクロール、複数ページクロールを型付き共有操作へ抽出し、SSRF 検査と既存副作用を維持する
- [x] 3.2 検索、文書取得・一覧、索引統計を型付き共有操作へ抽出する
- [x] 3.3 サイト取得・一覧・削除、backfill 開始・状態取得を型付き共有操作へ抽出する
- [x] 3.4 MCP adapter を共有操作へ切り替え、既存 connection limit、tool schema、text/Markdown/JSON formatter を維持する
- [x] 3.5 MCP characterization test と既存 integration test を実行し、adapter 分離による外部契約の差分がないことを確認する

## 4. 永続BackfillジョブとWorker lease

- [x] 4.1 `backfill_jobs` に queued 状態、worker ID、heartbeat、lease、試行回数、起動エラーを後方互換に追加し、既存 pending/running job を安全に移行する DB migration を作成する
- [x] 4.2 transaction と row/advisory lock による job の作成、単一 claim、heartbeat/lease 更新、完了、失敗、期限切れ再 claim の repository 操作を実装する
- [x] 4.3 既存チャンク冪等性を利用して batch 処理する独立 worker entrypoint を実装し、処理結果と致命エラーを DB に永続化する
- [x] 4.4 backfill 開始操作から package 内 worker を detached 起動し、起動失敗時は job を queued のまま再試行可能として理由を記録する
- [x] 4.5 同時 claim が1 workerに限定されること、heartbeat 更新、worker crash後の期限切れ回収、試行上限、完了チャンク非再処理を integration test で検証する
- [x] 4.6 MCP の backfill tool を新しい queue/worker 経路へ切り替え、従来の受付応答フィールドと非同期性を検証する

## 5. Embedding readiness

- [x] 5.1 最新 job、worker lease、チャンク状態集計から coverage と worker 状態を算出する軽量 status 操作を実装する
- [x] 5.2 keyword/semantic/hybrid ごとの `ready | degraded | unavailable`、reason code、列挙済み recommended action の判定器を実装する
- [x] 5.3 埋め込み endpoint、model/dimension、pgvector と必要 schema を timeout 付きで調べ、検査時刻を返す明示的 probe を実装する
- [x] 5.4 完全利用可能、部分 coverage、endpoint 停止、worker 停止、stale job、probe なしの外部通信抑止を unit/integration test で検証する

## 6. AI Agent向けCLI

- [x] 6.1 Node 標準機能による階層 command parser、共通 option、全 command help、および入力検証を table-driven に実装する
- [x] 6.2 成功・失敗 JSON envelope、stderr ログ分離、終了コード `0/1/2/3/4/5/6` の formatter とエラー変換を実装する
- [x] 6.3 `page read`、`crawl site`、`crawl pages` と JSONL progress/terminal event を共有操作へ接続する
- [x] 6.4 `search`、`document get/list`、`stats` を共有操作へ接続し、bounded preview、`--content-limit`、`--output` の保存メタデータを実装する
- [x] 6.5 `site list/get/delete` を共有操作へ接続し、削除時に対象 ID と一致する `--confirm` を副作用前に必須化する
- [x] 6.6 `embedding backfill/status --job-id/--probe` を共有操作へ接続し、backfill が受付後に親 CLI の終了を妨げないことを確認する
- [x] 6.7 CLI entrypoint と `package.json` の `bin` を追加し、build 後の shebang/実行権限または Node 起動互換性を確認する

## 7. CLI契約テスト

- [x] 7.1 child process test で全 command の stdout が既定で単一 JSON として parse でき、ログが stderr だけに出ることを検証する
- [x] 7.2 入力、not-found、config、DB、外部サービス、unexpected error の envelope と終了コードを検証する
- [x] 7.3 `--output`、本文上限、JSONL event、削除確認不一致、CLI 終了後の detached backfill 継続を integration test で検証する
- [x] 7.4 MCP 12 tool と CLI command 対応表の網羅性、および同一入力に対する操作結果・副作用の同等性を contract test で検証する

## 8. pi / Agent Skillsパッケージ

- [x] 8.1 Agent Skills 標準準拠の `docraider-search` Skill と、必要時に読む CLI/output reference を作成する
- [x] 8.2 Agent Skills 標準準拠の `docraider-crawl` Skill と、長時間処理、JSONL、出力制限の判断手順を作成する
- [x] 8.3 Agent Skills 標準準拠の `docraider-manage` Skill と、readiness fallback、backfill 再実行防止、削除承認手順を作成する
- [x] 8.4 PATH 上の CLI を優先し package 相対 entrypointへ fallbackする各 Skill の wrapper を追加し、CLI 不在時に明確な setup error を返すようにする
- [x] 8.5 `package.json` に `pi.skills`、`pi-package` keyword、配布対象ファイルを設定する
- [x] 8.6 pi の resource discovery で3 Skill が発見されること、frontmatter 標準検証、package-relative 実行、PATH fallback をテストする

## 9. 総合検証と文書化

- [x] 9.1 README に CLI の全 command、JSON/JSONL 契約、設定優先順位、終了コード、backfill/readiness の利用例を追加する
- [x] 9.2 README に `pi install`、Skill 一覧、pi 管理下での実行、他 Agent Skills harness へ移植する際の CLI 前提を追加する
- [x] 9.3 DB migration を含む build、unit、contract、integration、MCP acceptance suite を実行し、既存 MCP と検索縮退が回帰していないことを確認する
- [x] 9.4 package の dry-run/install 検証を行い、dist CLI、worker、skills、references、wrappers が配布物に含まれることを確認する
