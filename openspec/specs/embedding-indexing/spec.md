# embedding-indexing Specification

## Purpose

クロール済み文書断片の意味表現を継続的かつ冪等に生成し、新規データと既存データを運用を止めずに意味検索対象へ移行できるようにする。

## Requirements

### Requirement: 自動埋め込み対象化
システムは新規チャンクと内容が変更されたチャンクを追加操作なしで埋め込み対象にし、内容が未変更のチャンクを再生成してはならない。(SHALL)

#### Scenario: 新規クロール
- **WHEN** 新しい文書チャンクが保存される
- **THEN** チャンクは自動的に埋め込み対象として登録される

#### Scenario: 未変更の再クロール
- **WHEN** 保存済み文書を内容変更なしで再クロールする
- **THEN** 既存チャンクの埋め込みは再生成されない

### Requirement: 断片単位の状態管理
システムは各チャンクの埋め込み状態を`pending`、`completed`、`failed`で管理し、試行回数、モデル、更新日時、および失敗理由を識別可能にしなければならない。(SHALL)

#### Scenario: 一部失敗
- **WHEN** 同一文書内の一部チャンクだけ埋め込み生成に失敗する
- **THEN** 成功チャンクは意味検索対象となり、失敗チャンクは`failed`として対象外になる

### Requirement: 既存表現の保持
システムは更新用の埋め込み生成に失敗した場合、既存の意味表現を保持しつつチャンクを再試行可能な失敗状態にしなければならない。(SHALL)

#### Scenario: 再生成失敗
- **WHEN** 既存埋め込みを持つ変更済みチャンクの再生成が失敗する
- **THEN** 以前の埋め込みは削除されず、失敗理由が記録される

### Requirement: 非同期バックフィル
システムは既存の未処理・失敗チャンクを処理するバックフィル操作を提供し、呼び出し時にジョブID、対象見込み件数、状態を即座に返さなければならない。(SHALL)

#### Scenario: バックフィル開始
- **WHEN** 未処理チャンクがある状態でバックフィルを開始する
- **THEN** システムは処理完了を待たず受付情報を返し、処理をバックグラウンドで継続する

### Requirement: バックフィル進捗
システムはバックフィルジョブの実行状態、対象件数、完了件数、失敗件数、開始・完了時刻、およびジョブエラーを取得可能にしなければならない。(SHALL)

#### Scenario: 実行中の進捗確認
- **WHEN** 呼び出し側が実行中ジョブの状態を取得する
- **THEN** システムは永続化された最新の進捗を返す

### Requirement: バックフィルの冪等性と直列化
システムは完了済みチャンクを再処理せず、同時に複数のバックフィルジョブを実行してはならない。(SHALL)

#### Scenario: 連続実行
- **WHEN** 全チャンク完了後にバックフィルを再実行する
- **THEN** システムは対象件数0の`no work`応答を返す

#### Scenario: 実行中の再要求
- **WHEN** バックフィル実行中に別の開始要求を受ける
- **THEN** システムは既存の実行中ジョブ情報を返す

### Requirement: 埋め込み接続設定
システムはOpenAI互換埋め込みAPIのエンドポイント、APIキー、モデル、次元数、バッチサイズ、タイムアウトを設定可能にしなければならない。(SHALL)

#### Scenario: 接続先の差し替え
- **WHEN** 運用者が互換エンドポイントとモデル設定を変更する
- **THEN** システムはローカル・外部を区別するコード分岐なしに設定先を使用する

#### Scenario: 次元不整合
- **WHEN** 設定された次元数が保存先ベクトル次元と一致しない
- **THEN** システムは不整合を明確に報告し、不正なベクトルを保存しない

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
