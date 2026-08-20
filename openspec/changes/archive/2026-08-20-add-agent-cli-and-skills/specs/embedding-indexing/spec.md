## ADDED Requirements

### Requirement: プロセス寿命から独立したバックフィル
システムはバックフィル要求を永続ジョブとして受け付け、要求元 CLI が終了した後も独立した background worker によって処理を継続しなければならない。(SHALL)

#### Scenario: CLI終了後の継続
- **WHEN** CLI がバックフィルのジョブ ID と受付状態を返して終了する
- **THEN** worker は CLI プロセスに依存せず未処理チャンクの処理と進捗永続化を継続する

#### Scenario: Worker起動失敗
- **WHEN** ジョブ登録後に background worker を起動できない
- **THEN** システムはジョブを実行中と偽らず、再試行可能な状態と起動失敗理由を記録する

### Requirement: Worker leaseと障害回収
システムは実行 worker の識別子、heartbeat、および期限付き lease を永続化し、期限切れジョブを永続的な実行中状態に残してはならない。(SHALL)

#### Scenario: 正常heartbeat
- **WHEN** worker がジョブを処理中である
- **THEN** worker は lease が失効する前に heartbeat と進捗を更新する

#### Scenario: Worker異常終了
- **WHEN** 実行中 worker の heartbeat が lease 期限を超えて停止する
- **THEN** 後続の状態確認または worker はジョブを stale と判定し、安全に再取得可能または失敗として確定可能にする

#### Scenario: 同時取得
- **WHEN** 複数 worker が同じ queued または stale ジョブを取得しようとする
- **THEN** システムは1つの worker だけに有効な lease を与える

### Requirement: 埋め込み運用readiness
システムは worker、埋め込み索引カバレッジ、および keyword、semantic、hybrid の検索方式別利用状態を機械可読に取得可能にしなければならない。(SHALL)

#### Scenario: 部分的な索引作成
- **WHEN** 一部チャンクだけ埋め込みが完了し、必要サービスは応答可能である
- **THEN** 状態取得はカバレッジ件数と割合を返し、semantic の利用状態を `degraded` として表す

#### Scenario: 埋め込みAPI停止
- **WHEN** 埋め込み API がクエリ埋め込みを生成できない
- **THEN** 状態取得は semantic を `unavailable` とし、keyword と keyword へ縮退可能な hybrid の状態を別々に返す

#### Scenario: 完全利用可能
- **WHEN** 必要な DB 機能と埋め込み API が利用可能で、対象チャンクの埋め込みが完了している
- **THEN** 状態取得は semantic と hybrid を `ready` として返す

### Requirement: Readinessの判断支援
システムは readiness に `ready`、`degraded`、`unavailable` の状態、理由コード、および列挙された推奨アクションを含めなければならない。(SHALL)

#### Scenario: Backfill進行中
- **WHEN** semantic が部分利用可能でバックフィル worker が正常に進行している
- **THEN** 状態取得は待機または hybrid 利用を示す推奨アクションを返す

#### Scenario: Worker停止
- **WHEN** 未処理チャンクが存在するが有効な worker lease がない
- **THEN** 状態取得は worker 停止の理由コードと、backfill 開始または worker 再起動を示す推奨アクションを返す

### Requirement: 軽量状態確認と能動probe
システムは永続状態だけを読む軽量な状態確認と、外部埋め込み endpoint および保存先整合性を能動確認する probe を区別しなければならない。(SHALL)

#### Scenario: 通常の状態確認
- **WHEN** Agent が probe を要求せず readiness を取得する
- **THEN** システムは外部 endpoint へ新規リクエストを送らず、永続化済みの最新状態を返す

#### Scenario: 能動probe
- **WHEN** Agent が明示的に probe を要求する
- **THEN** システムは制限時間内で endpoint 到達性、モデル次元、および必要な DB 機能を検査し、検査時刻と結果を返す
