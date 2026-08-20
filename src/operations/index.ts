import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { db, siteRepository } from '../db/index.js';
import { config } from '../config.js';
import { checkUrl, SsrfError } from '../utils/ssrf-guard.js';
import { extractContent } from '../extraction/pipeline.js';
import { crawlSite } from '../crawler/crawler.js';
import { searchDocuments, getSearchCount } from '../search.js';
import { startBackfill, getBackfillStatus } from '../embedding/backfill.js';
import { getEmbeddingReadiness } from '../embedding/readiness.js';
import { DEFAULT_CRAWL_MAX_DEPTH, DEFAULT_MAX_CRAWL_PAGES, DEFAULT_SEARCH_LIMIT, DEFAULT_MAX_CHUNK_LENGTH } from '../constants/index.js';
import type { SearchMode } from '../db/types.js';
import { OperationError, type OperationContext, type OperationResult } from './types.js';
import { chunkMarkdown } from '../chunker.js';
import { identifyOrCreateSite } from '../db/site-identification.js';
import { normalizeUrl } from '../utils/url-normalize.js';
import { enqueueEmbeddingsForChunks } from '../embedding/backfill.js';
import { sleep, getBackoffDelay, getRandomDelay } from '../utils/delay.js';
export * from './types.js';

const ok = <T>(data: T, warnings: string[] = []): OperationResult<T> => ({ data, warnings });
const required = (value: unknown, name: string): string => { if (typeof value !== 'string' || !value.trim()) throw new OperationError('input', 'INVALID_INPUT', `${name} is required`); return value; };
const integer = (value: unknown, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER): number => { const n = value === undefined ? fallback : Number(value); if (!Number.isInteger(n) || n < min || n > max) throw new OperationError('input', 'INVALID_INPUT', `Expected an integer from ${min} to ${max}`); return n; };
const dates = <T extends Record<string, any>>(value: T): T => Object.fromEntries(Object.entries(value).map(([k,v]) => [k, v instanceof Date ? v.toISOString() : v])) as T;

async function navigateWithRetry(page: import('playwright').Page, url: string): Promise<import('playwright').Response> {
  let response: import('playwright').Response | null = null;
  for (let retryCount = 0; retryCount <= config.crawler.maxRetries; retryCount++) {
    response = await page.goto(url, { waitUntil: 'networkidle', timeout: config.crawler.timeout });
    const status = response?.status() ?? 0;
    if (status === 200) return response!;
    if ([202, 403, 429].includes(status) && retryCount < config.crawler.maxRetries) {
      const delay = getBackoffDelay(retryCount);
      console.error(`[Retry ${retryCount + 1}/${config.crawler.maxRetries}] ${url}: HTTP ${status}, retrying after ${delay}ms`);
      await sleep(delay);
      continue;
    }
    const suffix = [202, 403, 429].includes(status)
      ? ` after ${config.crawler.maxRetries} retries - WAF may be blocking requests`
      : '';
    throw new OperationError('external_service', 'HTTP_ERROR', `HTTP ${status}${suffix}`, { status, url });
  }
  throw new OperationError('external_service', 'NO_RESPONSE', 'No response received', { url });
}

async function waitForMainContent(page: import('playwright').Page): Promise<void> {
  await page.waitForSelector('article, main, [role="main"], .content, .doc-content', { timeout: 5000 }).catch(() => undefined);
}

export async function readPage(input: { url: string }, context: OperationContext = {}): Promise<OperationResult<{url:string; title:string; content:string; contentType:string}>> {
  const url = required(input.url, 'URL');
  try { await checkUrl(url); } catch (e) { if (e instanceof SsrfError) throw new OperationError('input','UNSAFE_URL',e.message,{url}, {cause:e}); throw e; }
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext({ userAgent: config.crawler.userAgent });
    try {
      const page = await browserContext.newPage();
      await navigateWithRetry(page, url);
      await waitForMainContent(page);
      const extracted = extractContent(await page.content(), url);
      if ('code' in extracted) throw new OperationError('external_service','EXTRACTION_FAILED',extracted.message,{code:extracted.code});
      return ok({ url, title: await page.title(), content: extracted.markdown, contentType: 'text/markdown' });
    } finally { await browserContext.close(); }
  } catch (e) { if (e instanceof OperationError) throw e; throw new OperationError('external_service','PAGE_READ_FAILED',e instanceof Error ? e.message : String(e),undefined,{cause:e}); }
  finally { if (browser) await browser.close(); context.log?.(`Read ${url}`); }
}

export async function crawlDocumentationSite(input: {url:string; maxPages?:number; maxDepth?:number}, context: OperationContext = {}, onProgress?: (event: unknown)=>void): Promise<OperationResult<{results:unknown[]; succeeded:number; failed:number; total:number}>> {
  const url=required(input.url,'url'); await checkUrl(url).catch(e=>{throw new OperationError('input','UNSAFE_URL',e instanceof Error?e.message:String(e));});
  const maxPages=integer(input.maxPages,DEFAULT_MAX_CRAWL_PAGES,1,10000), maxDepth=integer(input.maxDepth,DEFAULT_CRAWL_MAX_DEPTH,0,100);
  const results=[]; let succeeded=0,failed=0;
  for await (const result of crawlSite(url,{maxPages,maxDepth})) { results.push(result); result.success?succeeded++:failed++; onProgress?.({event:'progress',result}); }
  return ok({results,succeeded,failed,total:results.length});
}

export interface CrawlPageItem {
  url: string; success: boolean; title?: string; documentId?: string; siteId?: string;
  chunks?: number; error?: string; statusCode?: number;
}

export async function crawlPages(input:{urls:string[]}, context:OperationContext={}, onProgress?: (event:unknown)=>void): Promise<OperationResult<{results:CrawlPageItem[];succeeded:number;failed:number;total:number}>> {
  if (!Array.isArray(input.urls)||input.urls.length===0) throw new OperationError('input','INVALID_INPUT','URLs array is required');
  // Preserve the all-or-nothing input boundary: no browser or persistence side
  // effects occur until every requested URL has passed SSRF validation.
  for (const url of input.urls) {
    try { await checkUrl(url); }
    catch (error) {
      if (error instanceof SsrfError) throw new OperationError('input','UNSAFE_URL',error.message,{url},{cause:error});
      throw error;
    }
  }

  const browser=await chromium.launch({headless:true});
  const browserContext=await browser.newContext({userAgent:config.crawler.userAgent});
  const results:CrawlPageItem[]=[];
  try {
    for (const sourceUrl of input.urls) {
      const page=await browserContext.newPage();
      let item:CrawlPageItem;
      try {
        await navigateWithRetry(page,sourceUrl);
        await waitForMainContent(page);
        const extraction=extractContent(await page.content(),sourceUrl);
        if ('code' in extraction) throw new OperationError('external_service','EXTRACTION_FAILED',extraction.message,{code:extraction.code});
        const title=await page.title();
        const chunks=chunkMarkdown(extraction.markdown,DEFAULT_MAX_CHUNK_LENGTH);
        const url=normalizeUrl(sourceUrl);
        const {site}=await identifyOrCreateSite(url,title);
        let documentId='';
        await db.transaction(async client=>{
          const inserted=await client.query<{id:string}>(`INSERT INTO documents (url,title,content,last_crawled_at,site_id)
            VALUES ($1,$2,$3,NOW(),$4) ON CONFLICT (url) DO UPDATE SET title=EXCLUDED.title,
            content=EXCLUDED.content,last_crawled_at=NOW(),updated_at=NOW(),site_id=EXCLUDED.site_id RETURNING id`,
            [url,title||url,extraction.markdown,site.id]);
          documentId=inserted.rows[0].id;
          await client.query('DELETE FROM document_chunks WHERE document_id=$1',[documentId]);
          for(const chunk of chunks) await client.query(`INSERT INTO document_chunks
            (document_id,chunk_index,content,heading_path,embedding_status) VALUES ($1,$2,$3,$4,'pending')`,
            [documentId,chunk.chunkIndex,chunk.content,chunk.headingPath??null]);
        });
        try {
          const ids=await db.query<{id:string}>('SELECT id FROM document_chunks WHERE document_id=$1 ORDER BY chunk_index',[documentId]);
          await enqueueEmbeddingsForChunks(ids.map(row=>row.id));
        } catch(error) { context.log?.(`Failed to enqueue embeddings for ${url}: ${error instanceof Error?error.message:String(error)}`); }
        item={url,success:true,title,documentId,siteId:site.id,chunks:chunks.length};
        await sleep(getRandomDelay());
      } catch(error) {
        const operationError=error instanceof OperationError?error:null;
        item={url:sourceUrl,success:false,error:error instanceof Error?error.message:String(error),
          ...(typeof (operationError?.details as any)?.status==='number'?{statusCode:(operationError!.details as any).status}:{})};
      } finally { await page.close(); }
      results.push(item); onProgress?.({event:'progress',result:item});
    }
  } finally { await browserContext.close(); await browser.close(); }
  const succeeded=results.filter(item=>item.success).length;
  return ok({results,succeeded,failed:results.length-succeeded,total:results.length});
}

export async function search(input:{query:string;mode?:SearchMode;limit?:number;offset?:number;siteId?:string}):Promise<OperationResult<unknown>> {
  const query=required(input.query,'query'); const mode=input.mode??'hybrid'; if(!['keyword','semantic','hybrid'].includes(mode))throw new OperationError('input','INVALID_SEARCH_MODE',`Invalid search mode: ${mode}`);
  const limit=integer(input.limit,DEFAULT_SEARCH_LIMIT,1,100),offset=integer(input.offset,0,0);
  const results=await searchDocuments({query,mode,limit,offset,siteId:input.siteId}); const total=await getSearchCount(query,mode,input.siteId);
  return ok({query,mode,results,total,limit,offset});
}
export async function getDocument(input:{documentId:string}):Promise<OperationResult<unknown>> { const id=required(input.documentId,'documentId');const document=await db.getDocumentById(id);if(!document)throw new OperationError('not_found','DOCUMENT_NOT_FOUND',`Document ${id} not found`);let content=document.content;if(!content)content=(await db.getChunksByDocumentId(id)).map(c=>c.content).join('\n\n');return ok({...dates(document as any),content}); }
export async function listDocuments(input:{siteId?:string;limit?:number;offset?:number;sortBy?:'last_crawled_at'|'created_at'|'title';sortOrder?:'asc'|'desc'}={}):Promise<OperationResult<unknown>> { const result=await db.listDocuments({...input,limit:integer(input.limit,20,1,100),offset:integer(input.offset,0,0)});return ok({...result,documents:result.documents.map(dates)}); }
export async function getStats():Promise<OperationResult<unknown>> { const [docs,chunks,sites,queue,last]=await Promise.all([db.query<{count:string}>('SELECT COUNT(*) count FROM documents'),db.query<{count:string}>('SELECT COUNT(*) count FROM document_chunks'),db.query<{count:string}>('SELECT COUNT(*) count FROM sites'),db.query<{count:string}>('SELECT COUNT(*) count FROM crawl_queue'),db.query<{last_crawled_at:string|null}>('SELECT MAX(last_crawled_at) last_crawled_at FROM documents')]);return ok({documents:Number(docs[0]?.count??0),chunks:Number(chunks[0]?.count??0),sites:Number(sites[0]?.count??0),queue:Number(queue[0]?.count??0),lastCrawlAt:last[0]?.last_crawled_at??null,embedding:await db.getEmbeddingStats()}); }
export async function listSites(input:{limit?:number;offset?:number;sortBy?:'last_crawled_at'|'created_at'|'domain'|'name';sortOrder?:'asc'|'desc'}={}):Promise<OperationResult<unknown>> {const result=await siteRepository.list({...input,limit:integer(input.limit,20,1,100),offset:integer(input.offset,0,0)});return ok({...result,sites:result.sites.map(dates)});}
export async function getSite(input:{siteId:string}):Promise<OperationResult<unknown>> {const id=required(input.siteId,'siteId');const site=await siteRepository.findById(id);if(!site)throw new OperationError('not_found','SITE_NOT_FOUND',`Site ${id} not found`);return ok(dates(site as any));}
export async function deleteSite(input:{siteId:string;confirm:string|boolean}):Promise<OperationResult<unknown>> {const id=required(input.siteId,'siteId');if(input.confirm!==id&&input.confirm!==true)throw new OperationError('input','CONFIRMATION_MISMATCH','--confirm must exactly match the site ID');const site=await siteRepository.findById(id);if(!site)throw new OperationError('not_found','SITE_NOT_FOUND',`Site ${id} not found`);const count=await db.query<{count:string}>('SELECT COUNT(*) count FROM document_chunks dc JOIN documents d ON d.id=dc.document_id WHERE d.site_id=$1',[id]);await siteRepository.delete(id);return ok({deleted:true,siteId:id,deletedDocuments:site.documentCount,deletedChunks:Number(count[0]?.count??0)});}
export async function startEmbeddingBackfill():Promise<OperationResult<unknown>> {return ok(await startBackfill());}
export async function embeddingStatus(input:{jobId?:number;probe?:boolean}={}):Promise<OperationResult<unknown>> {if(input.jobId!==undefined){const status=await getBackfillStatus(integer(input.jobId,0,1));if(!status)throw new OperationError('not_found','JOB_NOT_FOUND',`Backfill job ${input.jobId} not found`);return ok(status);}return ok(await getEmbeddingReadiness({probe:input.probe===true}));}

export async function saveContent(content:string,path:string,contentType='text/markdown') { const target=resolve(path);await mkdir(dirname(target),{recursive:true});await writeFile(target,content,'utf8');return {path:target,bytes:Buffer.byteLength(content),contentType,truncated:false}; }
