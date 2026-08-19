-- Migration: Add sites table and document listing functionality
-- Creates sites table for site-level classification and management

-- sitesテーブル作成
CREATE TABLE IF NOT EXISTS sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    base_url TEXT NOT NULL UNIQUE,
    domain TEXT NOT NULL,
    name TEXT,
    document_count INTEGER DEFAULT 0,
    last_crawled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_sites_domain ON sites(domain);
CREATE INDEX IF NOT EXISTS idx_sites_last_crawled ON sites(last_crawled_at);

-- documentsテーブルにsite_idカラム追加
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id) ON DELETE CASCADE;

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_documents_site_id ON documents(site_id);

-- 既存データのマイグレーション: URLからサイトを自動生成
-- URLからドメインを抽出し、sitesテーブルにレコードを作成
INSERT INTO sites (base_url, domain, name, document_count, last_crawled_at)
SELECT
    base_url,
    domain,
    domain as name,
    cnt as document_count,
    max_last_crawled as last_crawled_at
FROM (
    SELECT
        CONCAT(protocol, '://', domain) as base_url,
        domain,
        COUNT(*) as cnt,
        MAX(last_crawled_at) as max_last_crawled
    FROM (
        SELECT
            SPLIT_PART(url, '://', 1) as protocol,
            SPLIT_PART(SPLIT_PART(url, '://', 2), '/', 1) as domain,
            last_crawled_at
        FROM documents
        WHERE url IS NOT NULL
    ) url_parts
    GROUP BY protocol, domain
) site_data
ON CONFLICT (base_url) DO NOTHING;

-- 既存ドキュメントにsite_idを設定
UPDATE documents d
SET site_id = s.id
FROM sites s
WHERE SPLIT_PART(SPLIT_PART(d.url, '://', 2), '/', 1) = s.domain
  AND d.site_id IS NULL;

-- ドキュメントカウントトリガー関数
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
        -- Handle site_id change: decrement old, increment new
        IF OLD.site_id IS NOT NULL THEN
            UPDATE sites SET document_count = document_count - 1, updated_at = now()
            WHERE id = OLD.site_id;
        END IF;
        IF NEW.site_id IS NOT NULL THEN
            UPDATE sites SET document_count = document_count + 1, updated_at = now()
            WHERE id = NEW.site_id;
        END IF;
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- トリガー作成
DROP TRIGGER IF EXISTS trg_documents_site_count ON documents;
CREATE TRIGGER trg_documents_site_count
AFTER INSERT OR DELETE OR UPDATE OF site_id ON documents
FOR EACH ROW
EXECUTE FUNCTION update_site_document_count();