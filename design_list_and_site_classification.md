# 一覧取得・サイト単位分類機能 設計書

## 1. 概要

本設計書は、docraider-mcp に以下の2つの新機能を追加するための設計を定義する。

1. **一覧取得機能**: クロール済みドキュメントの一覧を取得する
2. **サイト単位分類機能**: クロールしたドキュメントをサイト（ドメイン/パス単位）で分類・管理する

---

## 2. 背景と目的

### 2.1 現状の課題

- クロール済みドキュメント全体の把握が困難（`get_document` は個別取得のみ）
- 複数サイトをクロールした場合、どのドキュメントがどのサイトに属するか判別しにくい
- サイト単位での再クロールや削除などの運用操作が不可能

### 2.2 目的

- クロール済みドキュメントの全体像を一覧で確認可能にする
- サイト単位でのフィルタリング、集計、管理を可能にする
- 将来的なサイト単位での再クロール・差分更新の基盤を構築する

---

## 3. 機能要件

### 3.1 一覧取得機能

| 項目 | 内容 |
|------|------|
| **機能名** | `list_documents` |
| **入力** | オプショナル: `siteId`, `limit`, `offset`, `sortBy`, `sortOrder` |
| **出力** | ドキュメント一覧（ID, URL, タイトル, サイトID, 最終クロール日時など） |
| **用途** | クロール済みドキュメントの閲覧、ページネーション対応 |

### 3.2 サイト単位分類機能

| 項目 | 内容 |
|------|------|
| **機能名** | `list_sites`, `get_site`, `delete_site` |
| **入力** | `siteId`, `urlPattern` など |
| **出力** | サイト情報（ID, ベースURL, ドキュメント数, 最終クロール日時など） |
| **用途** | サイト単位での管理、集計、一括削除 |

---

## 4. データベース設計

### 4.1 新規テーブル: `sites`

サイト単位の管理情報を格納する。

| カラム名 | 型 | 制約 | 説明 |
|----------|-----|------|------|
| `id` | UUID | PRIMARY KEY | サイト固有ID |
| `base_url` | TEXT | NOT NULL, UNIQUE | サイトのベースURL |
| `domain` | TEXT | NOT NULL | ドメイン名（インデックス用） |
| `name` | TEXT | | サイト名（任意・手動設定可能） |
| `document_count` | INTEGER | DEFAULT 0 | 所属ドキュメント数 |
| `last_crawled_at` | TIMESTAMPTZ | | 最終クロール日時 |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | 作成日時 |
| `updated_at` | TIMESTAMPTZ | DEFAULT now() | 更新日時 |

```sql
CREATE TABLE sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    base_url TEXT NOT NULL UNIQUE,
    domain TEXT NOT NULL,
    name TEXT,
    document_count INTEGER DEFAULT 0,
    last_crawled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sites_domain ON sites(domain);
CREATE INDEX idx_sites_last_crawled ON sites(last_crawled_at);
```

### 4.2 既存テーブル変更: `documents`

`documents` テーブルに `site_id` カラムを追加し、`sites` テーブルと紐付ける。

| カラム名 | 型 | 制約 | 説明 |
|----------|-----|------|------|
| `site_id` | UUID | FOREIGN KEY → sites(id), ON DELETE CASCADE | 所属サイトID |

```sql
ALTER TABLE documents
ADD COLUMN site_id UUID REFERENCES sites(id) ON DELETE CASCADE;

CREATE INDEX idx_documents_site_id ON documents(site_id);
```

### 4.3 更新用トリガー

`sites.document_count` を自動更新するトリガー関数。

```sql
CREATE OR REPLACE FUNCTION update_site_document_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE sites SET document_count = document_count + 1, updated_at = now()
        WHERE id = NEW.site_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE sites SET document_count = document_count - 1, updated_at = now()
        WHERE id = OLD.site_id;
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' AND OLD.site_id IS DISTINCT FROM NEW.site_id THEN
        UPDATE sites SET document_count = document_count - 1, updated_at = now()
        WHERE id = OLD.site_id;
        UPDATE sites SET document_count = document_count + 1, updated_at = now()
        WHERE id = NEW.site_id;
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_documents_site_count
AFTER INSERT OR DELETE OR UPDATE OF site_id ON documents
FOR EACH ROW
EXECUTE FUNCTION update_site_document_count();
```

---

## 5. API / MCP Tools 設計

### 5.1 新規 MCP Tools

#### `list_documents`

クロール済みドキュメントの一覧を取得する。

**入力パラメータ:**

```json
{
  "siteId": "uuid-here",      // オプショナル: 特定サイトでフィルタ
  "limit": 20,                // デフォルト: 20, 最大: 100
  "offset": 0,                // デフォルト: 0
  "sortBy": "last_crawled_at", // デフォルト: last_crawled_at
  "sortOrder": "desc"         // デフォルト: desc
}
```

**出力:**

```json
{
  "documents": [
    {
      "id": "uuid-1",
      "url": "https://example.com/docs/api",
      "title": "API Documentation",
      "siteId": "site-uuid-1",
      "siteBaseUrl": "https://example.com/docs",
      "lastCrawledAt": "2026-05-06T10:00:00Z",
      "chunkCount": 5
    }
  ],
  "total": 150,
  "limit": 20,
  "offset": 0
}
```

#### `list_sites`

クロール済みサイトの一覧を取得する。

**入力パラメータ:**

```json
{
  "limit": 20,                // デフォルト: 20, 最大: 100
  "offset": 0,                // デフォルト: 0
  "sortBy": "last_crawled_at", // デフォルト: last_crawled_at
  "sortOrder": "desc"         // デフォルト: desc
}
```

**出力:**

```json
{
  "sites": [
    {
      "id": "site-uuid-1",
      "baseUrl": "https://example.com/docs",
      "domain": "example.com",
      "name": "Example Docs",
      "documentCount": 45,
      "lastCrawledAt": "2026-05-06T10:00:00Z",
      "createdAt": "2026-05-01T00:00:00Z"
    }
  ],
  "total": 5,
  "limit": 20,
  "offset": 0
}
```

#### `get_site`

特定サイトの詳細情報を取得する。

**入力パラメータ:**

```json
{
  "siteId": "uuid-here"
}
```

**出力:**

```json
{
  "id": "site-uuid-1",
  "baseUrl": "https://example.com/docs",
  "domain": "example.com",
  "name": "Example Docs",
  "documentCount": 45,
  "lastCrawledAt": "2026-05-06T10:00:00Z",
  "createdAt": "2026-05-01T00:00:00Z",
  "updatedAt": "2026-05-06T10:00:00Z"
}
```

#### `delete_site`

サイトとその配下の全ドキュメントを削除する。

**入力パラメータ:**

```json
{
  "siteId": "uuid-here",
  "confirmDelete": true  // 安全のため必須
}
```

**出力:**

```json
{
  "deleted": true,
  "deletedDocuments": 45,
  "deletedChunks": 120
}
```

---

## 6. サイト識別ロジック

### 6.1 サイト判定アルゴリズム

クロール時にURLから所属サイトを自動判定する。

```
1. URLからドメインを抽出（example.com）
2. URLのパスを解析し、ドキュメントルートを推定
   - 例: https://example.com/docs/api/auth → base_url: https://example.com/docs
3. 既存のsitesテーブルを検索
   a. 完全一致するbase_urlがあればそれを使用
   b. 親パスに一致するbase_urlがあればそれを使用
   c. 該当がなければ新規サイトを作成
4. documents.site_id に紐付け
```

### 6.2 サイト名の推定

初期値はドメイン名。以下の優先順位で決定:

1. 手動設定（`name` カラム）
2. クロールした最初のページの `<title>` タグから推定
3. ドメイン名（フォールバック）

---

## 7. 既存機能への影響

### 7.1 `crawl_documentation_site` の変更

- クロール開始時に `sites` テーブルにレコードを作成/更新
- 各ページ保存時に `documents.site_id` を設定
- クロール完了時に `sites.last_crawled_at` を更新

### 7.2 `search_crawled_docs` の変更（オプショナル拡張）

- `siteId` パラメータを追加し、特定サイト内のみ検索可能にする

```json
{
  "query": "authentication API token",
  "siteId": "uuid-here",  // オプショナル
  "limit": 20
}
```

### 7.3 `get_index_stats` の変更

- サイト数（`siteCount`）を出力に追加

```json
{
  "documentCount": 150,
  "chunkCount": 450,
  "siteCount": 5,
  "lastCrawlAt": "2026-05-06T10:00:00Z"
}
```

---

## 8. マイグレーション

### 8.1 新規マイグレーションファイル

```sql
-- migration: 002_add_sites_and_listing.sql

-- sitesテーブル作成
CREATE TABLE sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    base_url TEXT NOT NULL UNIQUE,
    domain TEXT NOT NULL,
    name TEXT,
    document_count INTEGER DEFAULT 0,
    last_crawled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sites_domain ON sites(domain);
CREATE INDEX idx_sites_last_crawled ON sites(last_crawled_at);

-- documentsテーブルにsite_id追加
ALTER TABLE documents
ADD COLUMN site_id UUID REFERENCES sites(id) ON DELETE CASCADE;

CREATE INDEX idx_documents_site_id ON documents(site_id);

-- 既存データのマイグレーション: URLからサイトを自動生成
INSERT INTO sites (base_url, domain, name, document_count, last_crawled_at)
SELECT 
    DISTINCT ON (domain)
    CONCAT(protocol, '://', domain) as base_url,
    domain,
    domain as name,
    COUNT(*) OVER (PARTITION BY domain) as document_count,
    MAX(last_crawled_at) OVER (PARTITION BY domain) as last_crawled_at
FROM (
    SELECT 
        SPLIT_PART(url, '://', 1) as protocol,
        SPLIT_PART(SPLIT_PART(url, '://', 2), '/', 1) as domain,
        last_crawled_at
    FROM documents
) sub;

-- 既存ドキュメントにsite_idを設定
UPDATE documents d
SET site_id = s.id
FROM sites s
WHERE SPLIT_PART(SPLIT_PART(d.url, '://', 2), '/', 1) = s.domain;

-- ドキュメントカウントトリガー
CREATE OR REPLACE FUNCTION update_site_document_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE sites SET document_count = document_count + 1, updated_at = now()
        WHERE id = NEW.site_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE sites SET document_count = document_count - 1, updated_at = now()
        WHERE id = OLD.site_id;
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' AND OLD.site_id IS DISTINCT FROM NEW.site_id THEN
        UPDATE sites SET document_count = document_count - 1, updated_at = now()
        WHERE id = OLD.site_id;
        UPDATE sites SET document_count = document_count + 1, updated_at = now()
        WHERE id = NEW.site_id;
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_documents_site_count
AFTER INSERT OR DELETE OR UPDATE OF site_id ON documents
FOR EACH ROW
EXECUTE FUNCTION update_site_document_count();
```

---

## 9. 実装計画

### Phase 1: データベース層
- [ ] `sites` テーブル作成
- [ ] `documents.site_id` カラム追加
- [ ] トリガー関数実装
- [ ] マイグレーションスクリプト作成

### Phase 2: ドメイン層
- [ ] Site モデル/エンティティ定義
- [ ] SiteRepository 実装（CRUD + 一覧）
- [ ] DocumentRepository に `list` メソッド追加
- [ ] サイト識別ロジック実装

### Phase 3: MCP Tools 層
- [ ] `list_documents` Tool 実装
- [ ] `list_sites` Tool 実装
- [ ] `get_site` Tool 実装
- [ ] `delete_site` Tool 実装

### Phase 4: 既存機能統合
- [ ] `crawl_documentation_site` にサイト紐付け追加
- [ ] `search_crawled_docs` に `siteId` フィルタ追加
- [ ] `get_index_stats` にサイト統計追加

### Phase 5: テスト・検証
- [ ] ユニットテスト作成
- [ ] 統合テスト作成
- [ ] マイグレーションテスト（既存データあり環境）

---

## 10. セキュリティ考慮事項

| 項目 | 対応 |
|------|------|
| SQLインジェクション | 全クエリをパラメータ化クエリで実行 |
| 大量データ取得 | `limit` 最大100件で制限 |
| 誤削除防止 | `delete_site` は `confirmDelete: true` を必須化 |
| サイト名のXSS | 出力時にHTMLエスケープ |

---

## 11. 将来拡張

- **サイト単位再クロール**: `recrawl_site` Tool
- **サイト設定**: クロール深度、並列度などのサイト単位設定
- **サイト間検索**: 複数サイトを跨いだ検索結果のグルーピング表示
- **サイトカテゴリ**: タグ付けによるサイト分類

---

*設計書作成日: 2026-05-06*
*対象プロジェクト: docraider-mcp*
