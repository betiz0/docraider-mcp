## Context

現在の `src/index.ts` は MCP tool 定義、入力検証、操作本体、MCP 向け整形、DB 接続、stdio 起動を単一モジュールで担い、import 時に `main()` を実行する。CLI からこれを再利用すると server 起動を誘発し、処理を複製すると MCP と CLI の振る舞いが乖離する。

DB は process-global singleton であり MCP の長期常駐を前提とする一方、CLI は1操作後に確実に終了する必要がある。既存 backfill も呼出元プロセス内の Promise として継続するため、CLI 終了後の処理保証、worker crash の検出、検索 readiness の判定には永続的な実行所有権が必要となる。

pi は package の `skills/` または `package.json` の `pi.skills` を発見し、Agent Skills 標準に従って Skill を段階的に読み込む。pi 管理下の npm package の bin がグローバル PATH に存在するとは限らないため、Skill には package 相対の起動経路も必要である。

## Goals / Non-Goals

**Goals:**
- MCP と CLI が同じ型付き操作を呼び、外部 adapter だけが入力変換と出力整形を担当する。
- AI Agent が追加の対話なしに、全操作の成功、失敗、進捗、readiness を JSON から判断できる。
- 非同期 backfill が呼出元 CLI の終了や worker crash に耐え、重複実行されない。
- pi で自動発見・実行でき、Agent Skills 標準対応ハーネスへも移植可能な Skill を配布する。
- 既存 MCP クライアントの tool 名、入力 schema、stdio transport、および応答構造を維持する。

**Non-Goals:**
- HTTP API や常駐 Docraider daemon の追加。
- 任意の shell command を実行する MCP tool の追加。
- 認証・マルチテナント・リモート worker orchestration の導入。
- 検索ランキング、クロール抽出方式、埋め込みモデル自体の変更。
- pi extension や独自 tool の追加。初期統合は Bash CLI を使用する Skill に限定する。

## Decisions

### 1. 共有操作層と2つのadapterへ分離する

`operations/` にページ、クロール、検索、文書、サイト、統計、埋め込みの型付き操作を置き、MCP と CLI は同じ操作を呼ぶ。操作結果は transport 非依存のデータとし、MCP の Markdown/text 変換と CLI の JSON 変換を adapter に閉じ込める。

```text
MCP schema/formatter ─┐
                     ├─ operations ─ domain modules / DB / Playwright
CLI parser/formatter ─┘
```

server construction と `main()` を分離し、entrypoint だけが起動する。MCP adapter は connection limit を従来どおり適用し、CLI は1操作のため同じ semaphore を要求しない。各 entrypoint が DB、browser、worker handle の所有権を明示し、`finally` で自身が所有するリソースだけを閉じる。

代替案として CLI から MCP subprocess を起動する方式は、stdio protocol と CLI protocol の二重変換、起動コスト、エラー伝播を増やすため採用しない。既存 handler のコピーも契約乖離を生むため採用しない。

### 2. 階層化した全機能CLIとJSON envelopeを提供する

コマンドは次に固定する。

```text
docraider page read <url>
docraider crawl site <url>
docraider crawl pages --url <url>...
docraider search <query>
docraider document get <id>
docraider document list
docraider stats
docraider site list
docraider site get <id>
docraider site delete <id> --confirm <id>
docraider embedding backfill
docraider embedding status [--job-id <id>] [--probe]
```

既定出力は成功・失敗とも stdout の単一 JSON envelope とし、診断ログは stderr へ送る。これにより Agent は終了コードと stdout の双方を安定して利用できる。成功 envelope は `ok: true`、`command`、`data`、`warnings`、失敗 envelope は `ok: false`、`command`、`error.code`、`error.message`、任意の `error.details` を持つ。

終了コードは `0=success`、`2=input`、`3=not-found`、`4=config`、`5=database`、`6=external-service`、`1=unexpected` とする。クロールで明示された `--format jsonl` だけは、event、時刻、操作 ID を持つ独立 JSON 行と最後の terminal event を出す。

CLI parser は Node 標準機能を基礎にし、CLI framework の新規 runtime dependency は追加しない。全 command の help と parser contract を table-driven に保ち、操作対応表の contract test で MCP の12 toolとの網羅性を検証する。

### 3. 長大本文は明示的に制御する

ページ・文書取得は `--output <path>` と `--content-limit <n>` を受け付ける。`--output` 指定時は本文をファイルへ書き、JSON には絶対保存先、byte 数、content type、切り詰め有無を返す。検索/list は既定で bounded preview だけを返し、全文取得を別操作に誘導する。

代替案の「常に全文を stdout」は Bash harness の出力上限で JSON 自体が切断されるため採用しない。既定上限値は既存 MCP の観測可能な結果量とテスト fixture を基に定数化する。

### 4. 設定をentrypoint非依存に解決する

設定 loader は import 時 singleton 初期化から、明示的に path/env を受け取る関数へ変える。優先順位は `--config`、`DOCRAIDER_CONFIG`、current working directory の `config.yaml`、package 同梱設定、組み込み既定値とする。.env は選択した設定ファイルと同じディレクトリを候補とし、既存 package-root 設定は fallback として保持する。

CLI と MCP は同じ検証済み設定型を使用する。設定エラー時は DB pool や browser を作成する前に失敗させる。

### 5. BackfillをDB queueとon-demand detached workerで実行する

開始操作は transaction 内で既存の有効なジョブを確認し、なければ `queued` job を永続化する。その後、同じ package の worker entrypoint を `process.execPath` と解決済み script path で detached 起動し、親は job ID と対象見込み件数を返す。worker の標準入出力は親から切り離し、進捗と失敗理由を DB に記録する。

常駐 daemon を初期必須にせず、インストール直後に Agent が利用できることを優先する。内部 worker entrypoint は将来、同じ claim protocol を使う常駐 `docraider worker` からも利用可能にするが、常駐運用自体は今回の公開契約にしない。

worker 起動に失敗した場合、job は `queued` のまま起動エラーを保持し、`running` と報告しない。MCP の backfill tool も同じ queue 操作を呼び、従来の受付応答キーを維持する。

### 6. Lease付きclaimで重複実行と永久runningを防ぐ

`backfill_jobs` は既存 status と進捗に加え、`worker_id`、`heartbeat_at`、`lease_expires_at`、`attempt_count`、`last_start_error` を持つ。status は `queued | running | completed | failed` とし、stale は保存 status ではなく「running かつ lease 期限切れ」から導出する。

worker は transaction と行 lock/advisory lock を用いて1件だけ claim し、batch ごとまたは lease 半期間隔の短い方で heartbeat、lease、進捗を更新する。別 worker は有効 lease を持つ job を処理しない。期限切れ job は試行上限内なら再 claim し、上限超過時は failed に確定する。チャンク単位の既存冪等性を併用し、worker crash 後の再取得で completed chunk を再生成しない。

process-local の `isRunning` だけを使う既存方式は複数 CLI/process 間で直列化できないため置き換える。

### 7. Job状態と検索readinessを分離して返す

`embedding status --job-id` は特定 job の永続進捗を返し、job ID なしでは worker、最新 job、coverage、および方式別 readiness を返す。通常 status は外部通信せず DB の最新状態から算出する。`--probe` のみ埋め込み endpoint、設定 model/dimension、pgvector と必要 schema を timeout 付きで検査し、`checkedAt` を返す。

readiness は単一 boolean ではなく各方式に `ready | degraded | unavailable` を返す。semantic は query embedding endpoint、DB vector 機能、モデル/次元整合性、coverage を考慮する。hybrid は semantic が失敗しても keyword へ縮退可能であることを別状態と reason code で示す。`recommendedAction` は `none | start_backfill | wait_for_backfill | retry_failed | use_keyword_search | hybrid_search_allowed | check_embedding_endpoint | restart_worker` の列挙値に限定する。

readiness は CLI の追加運用機能とし、既存 MCP `get_backfill_status` の必須フィールドを削除・改名しない。共有操作結果の追加情報を MCP に露出する場合も additive field に限定する。

### 8. 標準準拠Skillを正本としてpi packageから公開する

`skills/` に `docraider-search`、`docraider-crawl`、`docraider-manage` を置く。各 `SKILL.md` は Agent Skills 標準の frontmatter を持ち、詳細 command/output schema は `references/` へ分ける。pi 固有の複製は作らず、この標準準拠版を `package.json` の `pi.skills` で公開する。

各 Skill の `scripts/docraider` wrapper は、PATH 上の `docraider` を優先し、存在しない場合は wrapper 位置から package 内 CLI entrypoint を解決する。これにより pi package install と、CLI を別途導入した他ハーネスの双方を支える。Skill は wrapper を相対パスで呼ぶ。

管理 Skill は削除前の `site get`、ユーザーの明示的承認、一致する `--confirm` を要求する。検索 Skill は readiness に従って keyword fallback を選び、管理 Skill は有効 job がある間に backfill を繰り返さない。各 Skill の scripts を除く allowed-tools 指定は pi で実験的であるため、移植性を損なう必須セキュリティ境界として扱わない。

## Risks / Trade-offs

- [Detached worker が OS shutdown や強制終了で停止する] → heartbeat/lease と冪等な再 claim により永久 running と重複生成を防ぎ、status に再起動アクションを返す。
- [Job登録後、worker起動前に親が停止する] → queued job を残し、次回 backfill/status が起動可能と判定できるようにする。
- [MCP と CLI のリファクタリングで既存応答が変わる] → 既存 MCP contract test を adapter 境界へ移し、tool schema と formatter の golden/contract test を追加する。
- [stdout に混入した library log が JSON を破壊する] → logger の destination を adapter で stderr に固定し、child process test で stdout を JSON parse する。
- [readiness が直前の endpoint 状態とずれる] → 通常 status は `checkedAt` と reason を返し、即時確認が必要な Agent には明示的 `--probe` を使用させる。
- [3つの Skill 間で CLI 説明が重複・乖離する] → command schema の正本を CLI help/reference 生成または検証に利用し、Skill はワークフロー判断に集中させる。
- [package-relative wrapper が Skill 単体コピー時に本体を見つけられない] → PATH fallback と明確な compatibility/setup エラーを返し、標準版では CLI 導入を前提として記載する。
- [JSON envelope 追加で人間の可読性が下がる] → AI Agent が主対象であるため JSON を既定とし、人間向け formatter は今回の必須範囲にしない。

## Migration Plan

1. 新しい DB migration で backfill job の queue/lease 列と制約を後方互換に追加する。既存 `pending` は `queued`、有効 heartbeat を持たない既存 `running` は期限切れとして回収対象にする。
2. transport 非依存の操作層を導入し、既存 MCP adapter を contract test の下で段階的に切り替える。
3. CLI と worker entrypoint を追加し、child process、終了コード、JSON、lease recovery を検証する。
4. Skill と package manifest を追加し、pi discovery と package-relative execution、標準 frontmatter を検証する。
5. 移行後も既存 MCP server 起動コマンドを維持する。問題時は MCP adapter を旧 handler へ戻せるよう、DB migration は追加列を残しても旧処理が動く nullable/default 設計にする。

ロールバック時は detached worker の新規起動を停止し、有効 worker の終了または lease 失効を待ってから旧 MCP 処理へ戻す。追加 DB 列は即時削除せず、旧コードが無視できる状態で保持する。
