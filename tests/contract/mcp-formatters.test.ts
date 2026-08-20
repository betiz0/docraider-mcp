import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
const mocks=vi.hoisted(()=>({readPage:vi.fn(),crawlDocumentationSite:vi.fn(),crawlPages:vi.fn(),search:vi.fn(),getDocument:vi.fn(),listDocuments:vi.fn(),getStats:vi.fn(),listSites:vi.fn(),getSite:vi.fn(),deleteSite:vi.fn(),startEmbeddingBackfill:vi.fn(),embeddingStatus:vi.fn()}));
vi.mock('../../src/operations/index.js',()=>{class OperationError extends Error{constructor(public kind:string,public code:string,message:string,public details?:unknown){super(message)}}return{...mocks,OperationError};});
vi.mock('../../src/connection-manager.js',()=>({ConnectionManager:class{async withConnection<T>(fn:()=>Promise<T>){return fn();}}}));
import { createMcpServer } from '../../src/mcp/server.js';
let close:undefined|(()=>Promise<void>);
afterEach(async()=>{await close?.();close=undefined;vi.clearAllMocks();});
async function client(){const server=createMcpServer(),client=new Client({name:'format-test',version:'1'},{capabilities:{}});const[c,s]=InMemoryTransport.createLinkedPair();await Promise.all([server.connect(s),client.connect(c)]);close=async()=>{await c.close();await s.close();};return client;}
const text=(value:string)=>({content:[{type:'text',text:value}]});
describe('all twelve legacy MCP success formatters',()=>{
 it('locks representative successful responses',async()=>{
  mocks.readPage.mockResolvedValue({data:{content:'# Page'}});
  mocks.crawlDocumentationSite.mockResolvedValue({data:{results:[{url:'https://a',success:true,title:'A'},{url:'https://b',success:false,statusCode:404,errorType:'not_found'}],succeeded:1,failed:1,total:2}});
  mocks.crawlPages.mockResolvedValue({data:{results:[{url:'https://a',success:true,chunks:2,siteId:'site-1'}],succeeded:1,failed:0,total:1}});
  mocks.search.mockResolvedValue({data:{total:1,mode:'hybrid',results:[{title:'T',url:'https://a',matchType:'both',score:.5,content:'Body'}]}});
  mocks.getDocument.mockResolvedValue({data:{content:'Document'}});
  mocks.listDocuments.mockResolvedValue({data:{documents:[{id:'d',url:'u',title:'t',siteId:'s',siteBaseUrl:'b',lastCrawledAt:'2024-01-01T00:00:00.000Z',chunkCount:2,content:'must not leak'}],total:1,limit:20,offset:0}});
  mocks.getStats.mockResolvedValue({data:{documents:1,chunks:2,sites:3,queue:4,lastCrawlAt:null,embedding:{totalChunks:2,pendingCount:1,completedCount:1,failedCount:0}}});
  mocks.listSites.mockResolvedValue({data:{sites:[{id:'s'}],total:1,limit:20,offset:0}});mocks.getSite.mockResolvedValue({data:{id:'s'}});
  mocks.deleteSite.mockResolvedValue({data:{deleted:true,siteId:'s',deletedDocuments:1,deletedChunks:2}});
  mocks.startEmbeddingBackfill.mockResolvedValue({data:{jobId:7,estimatedTotal:4,status:'queued'}});mocks.embeddingStatus.mockResolvedValue({data:{jobId:7,status:'queued'}});
  const c=await client();
  expect(await c.callTool({name:'read_and_extract_page',arguments:{url:'https://a'}})).toEqual(text('# Page'));
  expect(await c.callTool({name:'crawl_documentation_site',arguments:{url:'https://a'}})).toEqual(text('https://a: OK (A)\nhttps://b: Error - HTTP 404 (not_found)\n---\nSummary: 1 succeeded, 1 failed, 2 total'));
  expect(await c.callTool({name:'crawl_component_docs',arguments:{urls:['https://a']}})).toEqual(text('https://a: Extracted 2 chunks (site: site-1)\n---\nSummary: 1 succeeded, 0 failed'));
  expect(await c.callTool({name:'search_crawled_docs',arguments:{query:'q'}})).toEqual(text('Found 1 results (mode: hybrid):\n\n# T\nhttps://a\n\nmatchType: both\nscore: 0.5000\nBody'));
  expect(await c.callTool({name:'get_document',arguments:{documentId:'d'}})).toEqual(text('Document'));
  expect(await c.callTool({name:'list_documents',arguments:{}})).toEqual(text(JSON.stringify({documents:[{id:'d',url:'u',title:'t',siteId:'s',siteBaseUrl:'b',lastCrawledAt:'2024-01-01T00:00:00.000Z',chunkCount:2}],total:1,limit:20,offset:0},null,2)));
  expect(await c.callTool({name:'get_index_stats',arguments:{}})).toEqual(text('Documents: 1\nChunks: 2\nSites: 3\nQueue: 4\nLast Crawl: N/A\n\nEmbedding Stats:\n  Total: 2\n  Pending: 1\n  Completed: 1\n  Failed: 0'));
  expect(await c.callTool({name:'list_sites',arguments:{}})).toEqual(text(JSON.stringify({sites:[{id:'s'}],total:1,limit:20,offset:0},null,2)));
  expect(await c.callTool({name:'get_site',arguments:{siteId:'s'}})).toEqual(text(JSON.stringify({id:'s'},null,2)));
  expect(await c.callTool({name:'delete_site',arguments:{siteId:'s',confirmDelete:true}})).toEqual(text(JSON.stringify({deleted:true,deletedDocuments:1,deletedChunks:2},null,2)));
  expect(await c.callTool({name:'backfill_embeddings',arguments:{}})).toEqual(text(JSON.stringify({jobId:7,estimatedTotal:4,status:'queued',message:'Backfill started. Job 7 will process 4 chunks.'},null,2)));
  expect(await c.callTool({name:'get_backfill_status',arguments:{jobId:7}})).toEqual(text(JSON.stringify({jobId:7,status:'queued'},null,2)));
 });
});
