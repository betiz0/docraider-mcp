import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks=vi.hoisted(()=>({
 checkUrl:vi.fn(), launch:vi.fn(), extract:vi.fn(), transaction:vi.fn(), query:vi.fn(),
 identify:vi.fn(), enqueue:vi.fn(), sleep:vi.fn(), delay:vi.fn(()=>1), backoff:vi.fn(()=>1),
}));
vi.mock('../../src/utils/ssrf-guard.js',()=>({checkUrl:mocks.checkUrl,SsrfError:class SsrfError extends Error{constructor(message:string){super(message);this.name='SsrfError';}}}));
vi.mock('playwright',()=>({chromium:{launch:mocks.launch}}));
vi.mock('../../src/extraction/pipeline.js',()=>({extractContent:mocks.extract}));
vi.mock('../../src/db/index.js',()=>({db:{transaction:mocks.transaction,query:mocks.query},siteRepository:{}}));
vi.mock('../../src/db/site-identification.js',()=>({identifyOrCreateSite:mocks.identify}));
vi.mock('../../src/embedding/backfill.js',()=>({startBackfill:vi.fn(),getBackfillStatus:vi.fn(),enqueueEmbeddingsForChunks:mocks.enqueue}));
vi.mock('../../src/utils/delay.js',()=>({sleep:mocks.sleep,getRandomDelay:mocks.delay,getBackoffDelay:mocks.backoff}));
vi.mock('../../src/crawler/crawler.js',()=>({crawlSite:vi.fn()}));
vi.mock('../../src/search.js',()=>({searchDocuments:vi.fn(),getSearchCount:vi.fn()}));
vi.mock('../../src/embedding/readiness.js',()=>({getEmbeddingReadiness:vi.fn()}));

import { crawlPages, readPage } from '../../src/operations/index.js';

function browserFixture(statuses:number[]=[200]){
 const page={goto:vi.fn(async()=>({status:()=>statuses.shift()??200})),waitForSelector:vi.fn().mockResolvedValue(undefined),content:vi.fn().mockResolvedValue('<main>ok</main>'),title:vi.fn().mockResolvedValue('Title'),close:vi.fn().mockResolvedValue(undefined)};
 const context={newPage:vi.fn().mockResolvedValue(page),close:vi.fn().mockResolvedValue(undefined)};
 const browser={newContext:vi.fn().mockResolvedValue(context),close:vi.fn().mockResolvedValue(undefined)};
 mocks.launch.mockResolvedValue(browser);return{page,context,browser};
}

describe('shared crawl operations',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.checkUrl.mockResolvedValue('example.com');mocks.extract.mockReturnValue({markdown:'# Hello'});mocks.identify.mockResolvedValue({site:{id:'site-1'}});mocks.query.mockResolvedValue([{id:'chunk-1'}]);mocks.transaction.mockImplementation(async(cb:any)=>cb({query:vi.fn().mockResolvedValue({rows:[{id:'doc-1'}]})}));});
 it('retries retryable page responses and always closes owned resources',async()=>{const {page,context,browser}=browserFixture([429,200]);await expect(readPage({url:'https://example.com'})).resolves.toMatchObject({data:{content:'# Hello'}});expect(page.goto).toHaveBeenCalledTimes(2);expect(mocks.sleep).toHaveBeenCalled();expect(context.close).toHaveBeenCalled();expect(browser.close).toHaveBeenCalled();});
 it('validates every page URL before browser or persistence side effects',async()=>{const {SsrfError}=await import('../../src/utils/ssrf-guard.js');mocks.checkUrl.mockResolvedValueOnce('example.com').mockRejectedValueOnce(new SsrfError('blocked'));await expect(crawlPages({urls:['https://example.com/a','http://127.0.0.1']})).rejects.toMatchObject({code:'UNSAFE_URL'});expect(mocks.launch).not.toHaveBeenCalled();expect(mocks.transaction).not.toHaveBeenCalled();});
 it('preserves direct-page persistence and closes page/context/browser',async()=>{const {page,context,browser}=browserFixture();const result=await crawlPages({urls:['https://example.com/docs']});expect(result.data.results[0]).toMatchObject({success:true,chunks:1,siteId:'site-1',documentId:'doc-1'});expect(mocks.transaction).toHaveBeenCalledTimes(1);expect(mocks.enqueue).toHaveBeenCalledWith(['chunk-1']);expect(page.close).toHaveBeenCalled();expect(context.close).toHaveBeenCalled();expect(browser.close).toHaveBeenCalled();});
});
