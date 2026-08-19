-- Migration: Add auto-update trigger for search_vector
-- Automatically updates search_vector when content is inserted or updated

-- FTS検索ベクトル自動更新関数
CREATE OR REPLACE FUNCTION update_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := to_tsvector('english', NEW.content);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- トリガー作成（INSERT/UPDATE時にsearch_vectorを自動生成）
DROP TRIGGER IF EXISTS trg_chunks_update_search_vector ON document_chunks;
CREATE TRIGGER trg_chunks_update_search_vector
BEFORE INSERT OR UPDATE OF content ON document_chunks
FOR EACH ROW
EXECUTE FUNCTION update_search_vector();
