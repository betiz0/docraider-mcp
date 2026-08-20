# agent-skills Specification

## Purpose

pi の AI Agent が必要な場面で Docraider CLI の正しいワークフローと安全規則をオンデマンドに読み込み、他の Agent Skills 対応環境にも移植できるようにする。

## Requirements

### Requirement: 用途別Skillセット
システムは検索・取得、クロール・収集、管理・埋め込み運用をそれぞれ扱う、明確な名前と具体的な description を持つ Skill を提供しなければならない。(SHALL)

#### Scenario: 文書調査
- **WHEN** pi Agent が保存済み文書の調査を求められる
- **THEN** 検索・取得 Skill が選択可能であり、検索から必要文書の取得へ進む手順を示す

#### Scenario: 文書収集
- **WHEN** pi Agent が URL またはドキュメントサイトの収集を求められる
- **THEN** クロール Skill が選択可能であり、ページ取得とクロールの使い分けを示す

#### Scenario: 運用管理
- **WHEN** pi Agent が索引状態、バックフィル、またはサイト削除を扱う
- **THEN** 管理 Skill が選択可能であり、状態確認と安全な操作手順を示す

### Requirement: piによる発見と実行
Skill セットは pi package として発見可能であり、Skill 内から同じ package に含まれる Docraider CLI をインストール場所に依存せず起動できなければならない。(SHALL)

#### Scenario: pi package導入
- **WHEN** 利用者が Docraider package を pi に導入する
- **THEN** pi は追加の手作業コピーなしに各 Skill の名前と description を発見する

#### Scenario: PATHにCLIがない環境
- **WHEN** package が pi 管理下にあり `docraider` がグローバル PATH に存在しない
- **THEN** Skill は package 相対の実行経路を使用して CLI を起動できる

### Requirement: Agent Skills標準互換
各 Skill は Agent Skills 標準の必須 frontmatter、命名、ディレクトリ、および相対参照規則に準拠しなければならない。(SHALL)

#### Scenario: 標準検証
- **WHEN** Skill セットを Agent Skills 標準準拠の検証器で検査する
- **THEN** 各 Skill は必須項目不足や不正な名前なしで受理される

#### Scenario: 他ハーネスへの移植
- **WHEN** Skill ディレクトリを別の Agent Skills 対応ハーネスへ配置し、Docraider CLI を利用可能にする
- **THEN** pi 固有機能を必須とせず基本ワークフローを実行できる

### Requirement: コンテキスト効率
Skill は概要と判断規則を簡潔に保ち、詳細な CLI 契約や出力 schema を必要時に相対参照できる構造にしなければならない。(SHALL)

#### Scenario: Skill発見時
- **WHEN** pi が Skill 一覧を system prompt に提示する
- **THEN** 詳細リファレンス本文を常時読み込まず、選択に必要な名前と description だけが提示される

#### Scenario: 詳細契約の参照
- **WHEN** Agent が複雑なオプションまたは出力フィールドを判断する必要がある
- **THEN** Skill は同梱の参照文書を相対パスで読み込むよう案内する

### Requirement: Agent向け安全手順
Skill は長大出力、長時間クロール、検索の段階的劣化、バックフィル状態確認、および破壊的削除に対する安全な判断規則を明示しなければならない。(SHALL)

#### Scenario: 長大本文
- **WHEN** Agent が全文取得を必要とする
- **THEN** Skill は会話へ無制限に出力せず、ファイル保存または本文上限を使用するよう指示する

#### Scenario: 意味検索の利用不能
- **WHEN** readiness が意味検索を利用不能と報告する
- **THEN** Skill は keyword 検索へ切り替え、同じ backfill 開始要求を無制限に繰り返さないよう指示する

#### Scenario: サイト削除
- **WHEN** Agent がサイト削除を検討する
- **THEN** Skill はユーザーの明示的な削除依頼、対象取得による事前確認、および一致する確認 ID を要求する
