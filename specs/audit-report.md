# docraider-mcp 既存実装 監査レポート

対象: ハイブリッド検索（FTS + ベクトル検索）追加の前段としての潜在不具合監査
日付: 2026-06-13
修正は未実施。報告のみ。

## 0. 前提の重大な相違（最初に確認すべき事項）

依頼文では「SQLite FTS で検索する MCP サーバー」とあるが、**実装は PostgreSQL** を使用している。

- `src/db/index.ts:1` で `pg` の `Pool` を使用。FTS は SQLite FTS5 ではなく PostgreSQL の `tsvector` / `GIN` インデックス（`src/db/migrations/001_initial.sql:23,28`）。
- ベクトル検索用に `pgvector` 拡張と `chunks_embedding` テーブルが既に用意されている（`src/db/migrations/002_pgvector.sql`）。
- したがって監査観点のうち「PRAGMA foreign_keys」「busy_timeout」「WAL モード」「FTS5 trigram トークナイザ」「FTS5 特殊文字エスケープ」は **SQLite 固有概念であり該当しない**。PostgreSQL の等価な観点（FK は常時有効、`plainto_tsquery`、tsvector 構成）に読み替えて検証した。

この相違自体が設計ドキュメントとコードの乖離であり、ハイブリッド検索の設計前に前提をそろえる必要がある。

---

## A. データ整合性

### A-1. 【Critical】FTS の構成言語がトリガーとクエリで不一致。検索が機能不全
- 該当:
  - `src/db/migrations/005_add_fts_trigger.sql:8` … `BEFORE INSERT OR UPDATE OF content` トリガーが `NEW.search_vector := to_tsvector('english', NEW.content)` で**固定 english** を設定。
  - `src/chunker.ts:95,117`, `src/crawler/crawler.ts:368`, `src/index.ts:395`, `src/db/index.ts:180` … アプリ層は INSERT 時に `to_tsvector($language, content)` で `config.search.language`（既定 `DEFAULT_FTS_LANGUAGE = 'simple'`、`src/constants/index.ts:35`）を渡す。
  - `src/search.ts:55,82` … 検索クエリは `plainto_tsquery($language::regconfig, ...)`（同じく `simple`）。
- 問題:
  - INSERT 時、`BEFORE INSERT` トリガーがアプリの渡した `search_vector` を**常に上書き**するため、格納される転置インデックスは常に `english`（ステミングあり）になる。アプリ層の言語引数は完全に dead code。
  - 一方、検索側は `simple`（ステミングなし）で `tsquery` を生成する。**インデックス側 english とクエリ側 simple のステミング差**により、例: `running` は english 索引では `run` だが simple クエリは `running` のまま → ヒットしない。検索精度が体系的に劣化・取りこぼす。
- 再現条件: 任意の語の検索。特に語形変化する英単語、複数形などで顕著。
- ハイブリッド検索への影響: **埋め込み追加前に必ず修正**。FTS スコアが信頼できない状態で BM25/ベクトルのスコア融合を設計すると、融合の重み調整が破綻する。トリガーとアプリ層のどちらが真実かを一本化すること。

### A-2. 【Critical（日本語想定時）】日本語ドキュメントはトークナイズされず検索不能
- 該当: `005_add_fts_trigger.sql:8`、`006_update_existing_search_vector.sql:6`、各 INSERT。
- 問題: `to_tsvector('english'|'simple', 日本語テキスト)` は空白・記号でしか分割しないため、分かち書きされない日本語は語単位の索引にならず、`plainto_tsquery` でほぼヒットしない。PostgreSQL 標準には日本語形態素解析がなく、`pg_bigm` / `PGroonga` / `textsearch_ja` 等の導入が前提だが、マイグレーション・依存に存在しない。
- 再現条件: 日本語ページをクロール後、日本語語句で `search_crawled_docs`。
- 影響: 日本語ドキュメントを対象にするなら、ハイブリッド検索の FTS 側は実質ベクトル検索のみに依存することになる。前段で方針決定が必要（bigm/PGroonga 採用か、FTS は英語のみ割り切るか）。

### A-3. 【High】URL 正規化の欠如により再クロールで重複行が発生
- 該当:
  - 探索リンク生成 `src/crawler/crawler.ts:298-310` … フラグメント（`hash`）のみ除去。末尾スラッシュ、クエリパラメータ、`http`/`https`、大文字小文字、デフォルトポートを正規化しない。
  - `visited` セットも生 URL で管理（`crawler.ts:48,83,92`）。
  - `documents.url` は UNIQUE（`001_initial.sql:4`）かつ upsert は `ON CONFLICT (url)`（`crawler.ts:347`）だが、`/page` と `/page/`、`/page?a=1` と `/page?a=1&b=2`、`http://` と `https://` は**別 URL 扱い**で別行になる。
- 再現条件: サイト内に `/x` と `/x/` 両方へのリンクがある／クエリ順が異なるリンクがある場合。
- 影響: 同一内容が複数 document・複数 chunk として索引される → 検索結果重複、埋め込みコスト二重化。ハイブリッド検索の結果重複排除を別途実装しても根本解決にならない。正規化関数を導入し、保存前・visited 登録前・ON CONFLICT キーで一貫適用すべき。

### A-4. 【Medium】リダイレクト後の最終 URL を保存していないため重複
- 該当: `crawler.ts:280,344-356` … `saveDocument` に渡すのは元の `url`。`response.url()`（リダイレクト後の最終 URL）を使っていない。
- 問題: 301/302/308 で複数の入口 URL が同一ページに着地すると、最終 URL は同じでも保存キーが異なり重複 document になる。Playwright はリダイレクトを自動追従するため発生しやすい。
- 影響: A-3 と同根。正規化と合わせて最終 URL ベースの保存を検討。

### A-5. 【Low】delete_site の CASCADE は健全だが document_count トリガーが無駄に発火
- 該当: `src/db/site-repository.ts:77-80`（`DELETE FROM sites WHERE id`）、FK 連鎖 `004_add_sites_and_listing.sql:22`（documents.site_id ON DELETE CASCADE）→ `001_initial.sql:19`（chunks.document_id CASCADE）→ `002_pgvector.sql:10`（embedding.chunk_id CASCADE）。
- 評価（良い点）: PostgreSQL は FK を常時強制し、`sites` 削除 → `documents` → `document_chunks` → `chunks_embedding` まで CASCADE で連鎖削除される。単一 DELETE 文なので原子的。**関連データの取り残しは発生しない**。
- 軽微な問題: 各 document の CASCADE 削除で `trg_documents_site_count`（AFTER DELETE、`004:90`）が発火し、まさに削除中の `sites` 行を `document_count = document_count - 1` で UPDATE しようとする。親行が同一トランザクションで消えるため実質 no-op だが、大量ドキュメントで無駄なトリガー実行コストが生じる。機能影響は無し。

### A-6. 【Low】中断時の孤児・部分コミット
- 評価: ドキュメント保存とチャンク再生成は `db.transaction` 内で原子的に行われる（`crawler.ts:342-374`, `chunker.ts:91-122`）ため、1 ページ単位ではアトミック。プロセス中断時は「処理済みページまでコミット／未処理は次回」で、孤児チャンクは残らない（チャンクは常に document に FK）。
- 注意: `crawl_queue` テーブルは定義されている（`001:34`）が、`crawlSite` はメモリ内の `toVisit`/`visited` でキュー管理しており **crawl_queue を使っていない**。`enqueueUrl`/`getNextPendingUrl`（`db/index.ts:192-218`）はクロール本流から呼ばれず、`processing` のまま残る再開ロジックも存在しない。デッドコードと実装意図の乖離。

---

## B. FTS の正しさ（PostgreSQL tsvector 文脈）

### B-1. 上記 A-1 / A-2 を参照（最重要）。

### B-2. 【良い点】FTS インジェクション・構文エラーは現状なし
- 該当: `src/search.ts:55,82`。
- 評価: `plainto_tsquery` を使用しているため、ユーザ入力中の `& | ! ( ) : * ` 等の tsquery 演算子はリテラル扱いされ、構文エラー・クエリインジェクションは発生しない。`ts_headline` のオプション（`MaxWords` 等）は定数埋め込みで安全。
- 将来注意: ハイブリッド検索で表現力のため `to_tsquery` / `websearch_to_tsquery` に切り替える場合は、`to_tsquery` は未エスケープ入力で構文エラーになる。切替時はエスケープ／`websearch_to_tsquery` 採用を検討。

### B-3. 【Medium】search_vector 自動更新トリガーの発火条件と二重設定
- 該当: `005:16` … `BEFORE INSERT OR UPDATE OF content`。
- 問題:
  - アプリ層は INSERT 時に明示的に `search_vector` を計算して渡しているが（A-1）、トリガーがそれを上書きする二重処理。どちらかに一本化すべき（トリガー方式に統一するならアプリ側の `to_tsvector(...)` 計算は不要）。
  - `UPDATE OF content` のため、`content` 以外の列だけを更新した場合は再生成されない。これは概ね妥当だが、`heading_path` を検索対象に含める将来設計では見直しが必要。

### B-4. 【Low】DocumentChunk 型に embedding があるが実テーブルに列が無い
- 該当: `src/db/types.ts:47`（`embedding: number[] | null`）。だが `document_chunks` テーブルに `embedding` 列は存在しない（埋め込みは別テーブル `chunks_embedding`、`002`）。
- 問題: `getChunksByDocumentId` は `SELECT *` のため `embedding` は常に undefined。`db/index.ts:174` の `createChunks(... embedding?)` 引数も INSERT 文に使われず無視。
- 影響: ハイブリッド検索実装時、埋め込みの格納先（`document_chunks.embedding` 列か `chunks_embedding` テーブルか）を確定し、型と実体を一致させる必要がある。現状は中途半端な二重設計。

---

## C. クロール・抽出

### C-1. 【Medium】非 HTML レスポンス（PDF・画像）の content-type 判定が無い
- 該当: `crawler.ts:180-244`, `src/index.ts:218,360`。
- 問題: `response` の `content-type` を確認せず `page.content()` で HTML を取得し抽出にかける。PDF・画像・JSON の URL でも処理を試み、無意味な抽出結果や Playwright のダウンロード挙動でエラーになる。
- 再現条件: ドキュメント内の `.pdf` / 画像へのリンクをたどった場合。
- 影響: 無意味なドキュメント・チャンクが索引に混入。埋め込みコストの無駄。content-type ホワイトリスト（text/html）でのフィルタが必要。

### C-2. 【Medium】chunker がコードブロック・表の途中で分割しうる／コード内見出し誤検出
- 該当: `src/chunker.ts:28-69`。
- 問題:
  - 分割は段落境界（`\n\n`）でのみ行うが、コードブロック（```` ``` ````）や GFM 表の内部にも空行がありうる。`maxLength` 超過時にコードブロック内 `\n\n` で切ると、閉じられていない ``` を含む壊れたチャンクが生成される（`chunker.ts:57-68`）。
  - 見出し検出 `HEADING_PATTERN = /^(#{1,3})\s+(.+)$/`（`constants/index.ts:19`）はコードブロック内の `# コメント`（shell, python 等）も見出しとして誤検出し、`headingStack` を破壊しチャンク境界を誤る。
- 影響: チャンク内容の破損は FTS にもベクトル埋め込みにも悪影響。コードフェンスの状態追跡（fence 内では見出し検出・分割を抑止）が必要。

### C-3. 【Low】巨大な単一行（改行なし数 MB）の分割不能
- 該当: `chunker.ts:55-68`。
- 問題: 改行のない巨大行では `lastIndexOf('\n\n')` が見つからず／`maxLength*0.5` 条件を満たさず、`splitPoint = currentChunk.length` となり巨大チャンクがそのまま DB へ。`DEFAULT_MAX_CHUNK_LENGTH` を大きく超える可能性。
- 影響: 埋め込み API のトークン上限超過・メモリ圧。文字数ハードリミットでの強制分割が必要。

### C-4. 【Low】heading レベルのスキップで headingPath に undefined（空スロット）混入
- 該当: `chunker.ts:47-48` … `headingStack.length = level - 1; headingStack.push(title);`
- 問題: H1 の直後に H3 が来ると `length = 2` で配列を伸長し空スロットを作ったまま push するため、`headingPath` に `[H1, <empty>, H3]` のような空要素が混入し DB の `text[]` に NULL/undefined が入る。
- 影響: 見出しパス表示・将来の見出し重み付け検索に軽微な不整合。

### C-5. 【Low/Medium】robots は遵守するが crawl-delay 無視・レート制限が固定遅延のみ
- 該当: `src/crawler/robots.ts`（`isAllowed` のみ実装、crawl-delay 参照なし）、`crawler.ts:98-100`（成功時のみ `getRandomDelay()` で固定遅延）。
- 問題:
  - robots.txt の `Crawl-delay` ディレクティブを参照しない。
  - 失敗（403/429 等）時には `result.success` が false のため `sleep` を挟まず次へ進む。バックオフはリトライループ内のみ（`crawler.ts:187-194`）で、最終失敗後の連続アクセスにブレーキがない。
  - 同時実行（`pLimit(maxConcurrent)`、既定 5）と組み合わさると、同一ホストへ実効的に高頻度アクセスしうる。
- 影響: 相手サーバへの負荷・BAN リスク。ドメイン単位のレート制御が望ましい。

### C-6. 【Low】無限ループ要因
- 評価: `maxDepth` と `maxPages` の二重上限、`visited` 重複排除、`isSameDomain`/`baseDomain` チェックで基本的な循環は抑止されている。
- 残課題: A-3 の正規化欠如により `/x` と `/x/` が別 URL として無限に近い重複展開を起こす余地（カレンダー型やクエリ無限生成サイトで顕在化）。`maxPages` で最終的には止まるが、無駄なページで枠を消費する。

### C-7. 【Low】文字コード・リダイレクト
- 評価: Playwright（Chromium）がレンダリングするため、meta charset と HTTP ヘッダの不一致やリダイレクトはブラウザが解決する。文字コード不一致の実害は低い。リダイレクト追従に伴う URL 重複は A-4 で既出。

---

## D. MCP ツール層

### D-1. 【High】SELECT 結果の snake_case ↔ camelCase マッピング欠如で出力フィールドが軒並み欠落
- 該当: `pg` は列名を**そのまま（snake_case）**返すが、型・利用側は camelCase を前提にしている。
  - `src/index.ts:496-499`（list_documents）… `doc.siteId`, `doc.lastCrawledAt` を参照するが、実際の行キーは `site_id`, `last_crawled_at` → **常に undefined**。`lastCrawledAt?.toISOString()` は optional chaining で undefined のまま出力。
  - `src/index.ts:533-538`（list_sites）, `581-588`（get_site）… `site.baseUrl`, `site.domain`, `site.documentCount`, `site.lastCrawledAt`, `site.createdAt` 等。`SELECT *`（`site-repository.ts:22,47`）の戻りは `base_url`, `document_count`, `last_crawled_at`... → camelCase プロパティは **すべて undefined**。
  - `src/index.ts:618`（delete_site）… `site.documentCount` が undefined → `deletedDocuments: undefined` を返す。
- 問題: `db/index.ts` の Pool 生成にカラム名変換（camelCase 化）の設定が無く、`SELECT *`/`SELECT d.*` の列はマッピングされない。明示エイリアス（`s.base_url as "siteBaseUrl"` 等）を付けた一部のみ正しく、`*` 由来は壊れる。
- 再現条件: `list_sites` / `get_site` / `list_documents` / `delete_site` を呼ぶと、baseUrl・domain・documentCount・lastCrawledAt 等が null/undefined で返る。
- 影響: ツール出力が実質的に壊れており、LLM が誤った（欠落した）メタデータを受け取る。ハイブリッド検索とは独立だが、テスト・利用前に修正が必要。`id`/`url`/`title`/`content` 等の 1 語カラムだけ偶然正しく動くため見逃されやすい。

### D-2. 【Medium】非 UUID の ID を渡すと「not found」ではなく例外
- 該当: `db.getDocumentById`（`db/index.ts:91`）, `siteRepository.findById`（`site-repository.ts:22`）, `listDocuments` の `site_id` 条件（`db/index.ts:133`）。
- 問題: 列は `UUID` 型。非 UUID 文字列（例: `"abc"`）を `WHERE id = $1` に渡すと PostgreSQL が `invalid input syntax for type uuid` を送出。`get_document`/`get_site`/`delete_site` は try-catch していないため、`'Document not found'`/`'Site not found'` の分岐に到達せず例外が伝播する。
- 再現条件: `get_document { documentId: "not-a-uuid" }`。
- 影響: 「存在しない ID」と「不正形式 ID」で挙動が分岐し、後者は MCP エラーになる。UUID 形式バリデーションか、エラー時の not-found 変換が必要。

### D-3. 【Medium】SQL 文字列補間による ORDER BY インジェクション（sortOrder 未検証）
- 該当: `src/db/index.ts:148`（`ORDER BY ${sortColumn} ${sortOrder.toUpperCase()}`）, `src/db/site-repository.ts:48`（同様）。
- 問題: `sortColumn` はホワイトリスト検証済みだが、`sortOrder` は検証されず文字列補間される。`src/index.ts:488,527` で `(args?.sortOrder as 'asc' | 'desc')` と型アサーションするのみで**ランタイム検証が無い**。MCP クライアントが任意文字列を渡すと ORDER BY 句へ素通しされる（例: `1=(SELECT ...)` 等のブラインド抽出ベクタ）。
- 影響: 信頼境界（MCP 入力）での未検証文字列補間は SQL インジェクションリスク。`sortOrder` も `['asc','desc']` ホワイトリスト化すべき。

### D-4. 【Low】list_documents の ORDER BY は現状は曖昧化しないが脆い
- 該当: `db/index.ts:142-149`。
- 評価: `SELECT d.*, s.base_url as "siteBaseUrl", (subquery) as "chunkCount"` の出力列に `last_crawled_at`/`created_at`/`title` は `d.*` 由来で各 1 つだけ存在するため、`ORDER BY last_crawled_at` は出力列に解決され**現状はエラーにならない**。
- 注意: 将来 `s.*` 等を SELECT に加えると `last_crawled_at`/`created_at` が両テーブルから重複し `ORDER BY` が曖昧化する。`ORDER BY` のカラムはテーブル修飾（`d.last_crawled_at`）にしておくのが安全。

### D-5. 【Low/Medium】例外の握りつぶしで「該当なし」と誤認させうる箇所
- 該当:
  - `src/crawler/sitemap.ts:39-41`（catch → `[]`）, `robots.ts:43-45`（catch → null=許可）。
  - 検索系（`search.ts`）は握りつぶしなし（良い）。
- 問題: sitemap 取得失敗が空配列に潰れる（ただし sitemap 機能は現状ツールから未使用、C-6/A-6 参照）。robots 取得失敗時に「全許可」とするのは妥当だが、ネットワーク一時障害でも無制限クロールになりうる。
- 影響: 直接の検索誤認は限定的。ただしエラーとフォールバックの区別がログに残らない設計は運用時の切り分けを困難にする。

### D-6. 【Low】list_documents / list_sites のページネーション境界
- 評価: `limit` は `Math.min(limit ?? 20, 100)`（`index.ts:485,524`、`db/index.ts:121`）で上限はあるが、**下限・負数・0 の検証が無い**。`limit = 0` は空結果（total は別途返るので致命的でない）。`limit = -1` は PostgreSQL の `LIMIT -1`＝無制限扱いとなり、上限 100 を回避して全件返す可能性。`offset` 負数も未検証。
- 影響: 想定外の大量返却。`limit`/`offset` を非負・最小 1 にクランプすべき。

---

## E. 並行性・リソース

### E-1. 【High】ConnectionManager のタイムアウト時にセマフォ permit がリークし、累積でデッドロック
- 該当: `src/connection-manager.ts:53-78`（`withConnection`）, `14-34`（`Semaphore`）。
- 問題:
  - `Promise.race([acquire(), timeout])` で、permit が枯渇している状況では `acquire()` は `queue` に resolver を push して待機する。タイムアウトが先に発火すると `acquired=false` で例外を投げるが、**`acquire()` の Promise は queue に残ったまま**。
  - 後で他の処理が `release()` を呼ぶと、queue 先頭の（既に放棄された）resolver が呼ばれ permit が消費される（`release` の分岐は permits を増やさず queue を消化する、`semaphore.ts:26-30`）。だが対応する `withConnection` は既にタイムアウトで抜けており **`release()` を呼ばない**。
  - 結果、タイムアウトのたびに利用可能 permit が実質 1 減り、累積するとセマフォが永久枯渇し全リクエストがタイムアウトする（デッドロック）。
- 再現条件: `maxConnections` を超える同時呼び出しが `timeoutMs`（30s）を超えて滞留した場合。
- 影響: 長時間クロールなどで容易に枯渇しうる。タイムアウト時に queue から自分の resolver を除去する（キャンセル）か、`AbortController` 方式に改める必要。ハイブリッド検索で同時呼び出しが増えると顕在化しやすい。

### E-2. 【Low】pagesCrawled のインクリメントが非アトミックで maxPages を超過しうる
- 該当: `crawler.ts:79-95`（`pagesCrawled++` を `limit()` 内の並行タスクで実行）。
- 問題: バッチ内最大 `maxConcurrent` 件が並行に `pagesCrawled++` するため、`while (... pagesCrawled < maxPages)` の判定とずれて maxPages を数件超える可能性。
- 影響: 軽微（上限が緩いだけ）。

### E-3. 【Medium】identifyOrCreateSite の TOCTOU により重複サイト生成の余地
- 該当: `src/db/site-identification.ts:15-42`。
- 問題: `findByDomain` → （無ければ）`create` がトランザクション外。`crawl_component_docs` で複数 URL を順次処理する場合や複数クロールが並行する場合、同一ドメインで `findByDomain` がともに null を返し `create` が競合する。`base_url` は UNIQUE だが `domain` は UNIQUE でない（`004:7-8`）ため、**base_url が異なれば同一ドメインに複数サイト**が作られる。逆に base_url 衝突時は UNIQUE 制約違反で例外。
- 影響: サイト粒度の分類が崩れる。`INSERT ... ON CONFLICT (base_url) DO NOTHING/UPDATE RETURNING` などのアトミックな upsert か、domain への一意制約・アドバイザリロックが必要。

### E-4. 【良い点 / Low】DB 同時実行とメモリ
- 評価:
  - 接続はプール管理（`db/index.ts:19-30`）、`getNextPendingUrl` は `FOR UPDATE SKIP LOCKED`（`db/index.ts:212`）で競合に配慮（ただし本流未使用、A-6）。SQLite の busy_timeout/WAL は非該当。
  - メモリは 1 ページずつ処理し `MEMORY_LOG_INTERVAL` で監視（`crawler.ts:103-106`）。全ページをメモリに溜めない設計でストリーミング（AsyncGenerator）。
  - 注意: `crawler.ts:46-49` の `visited` / `toVisit` は全 URL をメモリ保持するため、超大規模サイトでは URL セットがメモリ圧になりうる（コンテンツは溜めないので影響は限定的）。
  - `db/index.ts:32-35` … プールの `'error'` イベントで `process.exit(-1)`。アイドル接続の一時エラーでサーバ全体を落とすのは過剰。MCP 常駐プロセスとしては堅牢性に欠ける。

---

## まとめ（優先度順・対応指針）

| ID | 重要度 | 概要 | 埋め込み追加前に直すべきか |
|----|--------|------|--------------------------|
| A-1 | Critical | FTS 構成言語の不整合（トリガー english 固定 vs クエリ simple） | **必須**（スコア融合の前提） |
| A-2 | Critical(JP) | 日本語が分かち書きされず FTS 不能 | **必須**（方針決定） |
| D-1 | High | snake_case/camelCase 未マッピングで出力欠落 | 独立だが要修正 |
| E-1 | High | ConnectionManager の permit リーク→デッドロック | 同時実行増で顕在化、要修正 |
| D-3 | High | sortOrder の ORDER BY インジェクション | 独立、要修正 |
| A-3 | High | URL 正規化欠如で再クロール重複 | **推奨**（重複埋め込み回避） |
| A-4 | Medium | リダイレクト後 URL 未保存で重複 | 推奨（A-3 と同時） |
| C-1 | Medium | 非 HTML(PDF/画像) 未フィルタ | 推奨（無駄な埋め込み回避） |
| C-2 | Medium | コードブロック/表の途中分割・コード内見出し誤検出 | **推奨**（チャンク品質） |
| D-2 | Medium | 非 UUID ID で例外 | 独立 |
| E-3 | Medium | サイト生成の TOCTOU | 独立 |
| B-4 | Low | embedding の型と実体不一致・格納先未確定 | **設計時に確定** |
| C-3/C-4 | Low | 巨大単一行・heading skip の空要素 | 推奨 |
| C-5 | Low/Med | crawl-delay 無視・レート制御弱い | 独立 |
| D-5/D-6 | Low | 例外握りつぶし・limit 負数未検証 | 独立 |
| E-2/E-4 | Low | pagesCrawled race・pool error で exit | 独立 |
| A-6 | Low | crawl_queue デッドコード | 独立 |

### 良い点（維持すべき設計）
- `delete_site` の FK CASCADE 連鎖（sites→documents→chunks→embedding）は健全で取り残しなし（A-5）。
- `plainto_tsquery` 採用で FTS インジェクション・構文エラーは現状なし（B-2）。
- 1 ページ単位のトランザクションとストリーミングで部分コミット・メモリ肥大を回避（A-6, E-4）。

### ハイブリッド検索追加の前に決定すべき設計事項
1. FTS 構成言語の一本化（トリガー方式 or アプリ方式）と、英語/日本語のトークナイザ方針（A-1, A-2, B-3）。
2. 埋め込みの格納先確定（`document_chunks.embedding` 列か `chunks_embedding` テーブルか）と型整合（B-4）。
3. URL 正規化の一元化（A-3, A-4）— 重複チャンクは埋め込みコストとスコア融合の双方に直結。
