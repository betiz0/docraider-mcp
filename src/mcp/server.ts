import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ConnectionManager } from '../connection-manager.js';
import { MCP_TOOL_DEFINITIONS } from './tools.js';
import * as ops from '../operations/index.js';
import { SERVER_NAME, SERVER_VERSION } from '../constants/index.js';

const text=(value:string)=>({content:[{type:'text' as const,text:value}]});
export function createMcpServer():Server {
 const manager=new ConnectionManager(); const server=new Server({name:SERVER_NAME,version:SERVER_VERSION},{capabilities:{tools:{}}});
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:MCP_TOOL_DEFINITIONS}));
 server.setRequestHandler(CallToolRequestSchema,async request=>manager.withConnection(async()=>{
  const name=request.params.name,args=(request.params.arguments??{}) as Record<string,unknown>;
  try { switch(name){
   case'read_and_extract_page':try{return text((await ops.readPage(args as any)).data.content);}catch(error){if(error instanceof ops.OperationError&&error.kind==='external_service')return text(`Error: ${error.message}`);throw error;}
   case'crawl_documentation_site':{const r=(await ops.crawlDocumentationSite(args as any)).data;const lines=(r.results as any[]).map(x=>x.success?`${x.url}: OK (${x.title??'no title'})`:`${x.url}: Error - ${x.statusCode?`HTTP ${x.statusCode} (${x.errorType??'unknown'})`:x.error}`);return text(lines.join('\n')+`\n---\nSummary: ${r.succeeded} succeeded, ${r.failed} failed, ${r.total} total`);}
   case'crawl_component_docs':{try{const r=(await ops.crawlPages({urls:args.urls as string[]})).data;const lines=r.results.map(x=>x.success?`${x.url}: Extracted ${x.chunks??0} chunks (site: ${x.siteId})`:`${x.url}: Error - ${x.error}`);return text(lines.join('\n')+`\n---\nSummary: ${r.succeeded} succeeded, ${r.failed} failed`);}catch(error){if(error instanceof ops.OperationError&&error.code==='UNSAFE_URL'){const url=(error.details as any)?.url;return text(`Error: ${error.message}${url?` (url: ${url})`:''}`);}throw error;}}
   case'search_crawled_docs':{const r=(await ops.search(args as any)).data as any;const formatted=r.results.map((x:any)=>`# ${x.title}\n${x.url}\n\nmatchType: ${x.matchType}\nscore: ${x.score.toFixed(4)}\n${x.content.slice(0,500)}`).join('\n\n---\n\n');return text(`Found ${r.total} results (mode: ${r.mode}):\n\n${formatted}`);}
   case'get_document':return text(((await ops.getDocument(args as any)).data as any).content||'No content available');
   case'list_documents':{const r=(await ops.listDocuments(args as any)).data as any;const documents=r.documents.map((doc:any)=>({id:doc.id,url:doc.url,title:doc.title,siteId:doc.siteId,siteBaseUrl:doc.siteBaseUrl,lastCrawledAt:doc.lastCrawledAt,chunkCount:doc.chunkCount}));return text(JSON.stringify({documents,total:r.total,limit:r.limit,offset:r.offset},null,2));}
   case'get_index_stats':{const r=(await ops.getStats()).data as any;return text(`Documents: ${r.documents}\nChunks: ${r.chunks}\nSites: ${r.sites}\nQueue: ${r.queue}\nLast Crawl: ${r.lastCrawlAt??'N/A'}\n\nEmbedding Stats:\n  Total: ${r.embedding.totalChunks}\n  Pending: ${r.embedding.pendingCount}\n  Completed: ${r.embedding.completedCount}\n  Failed: ${r.embedding.failedCount}`);}
   case'list_sites':return text(JSON.stringify((await ops.listSites(args as any)).data,null,2));
   case'get_site':return text(JSON.stringify((await ops.getSite(args as any)).data,null,2));
   case'delete_site':{const r=(await ops.deleteSite({siteId:args.siteId as string,confirm:args.confirmDelete as boolean})).data as any;return text(JSON.stringify({deleted:r.deleted,deletedDocuments:r.deletedDocuments,deletedChunks:r.deletedChunks},null,2));}
   case'backfill_embeddings':{const r=(await ops.startEmbeddingBackfill()).data as any;return text(JSON.stringify(r.jobId===0?{message:'No chunks need embedding',estimatedTotal:0,status:r.status}:{jobId:r.jobId,estimatedTotal:r.estimatedTotal,status:r.status,message:`Backfill started. Job ${r.jobId} will process ${r.estimatedTotal} chunks.`},null,2));}
   case'get_backfill_status':return text(JSON.stringify((await ops.embeddingStatus({jobId:args.jobId as number})).data,null,2));
   default:throw new Error(`Unknown tool: ${name}`);
  }} catch(error){
   if(error instanceof ops.OperationError){
    if(error.kind==='not_found')return text(error.code==='JOB_NOT_FOUND'?error.message:error.message.replace(/ \S+ not found$/,' not found'));
    // Preserve the original MCP contract: missing/invalid arguments reject the
    // tool call, while URL safety validation is returned as a text result.
    if(error.kind==='input'&&error.code==='UNSAFE_URL')return text(`Error: ${error.message}`);
    if(error.kind==='input')throw new Error(error.message,{cause:error});
   }
   throw error;
  }
 }));return server;
}
