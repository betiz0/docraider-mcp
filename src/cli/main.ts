#!/usr/bin/env node
import { parseCommand, helpText } from './parser.js';
import { success, failure } from './formatter.js';
import { loadConfig, applyConfig } from '../config.js';
import { db } from '../db/index.js';
import * as ops from '../operations/index.js';

/** Explicit composition boundary used by alternate transports and process tests. */
export interface CliDependencies {
  loadConfig: typeof loadConfig;
  applyConfig: typeof applyConfig;
  database: Pick<typeof db, 'connect' | 'disconnect'>;
  operations: Pick<typeof ops,
    'readPage' | 'crawlDocumentationSite' | 'crawlPages' | 'search' |
    'getDocument' | 'listDocuments' | 'getStats' | 'listSites' | 'getSite' |
    'deleteSite' | 'startEmbeddingBackfill' | 'embeddingStatus' | 'saveContent'>;
}
export interface CliIo { stdout(line:string):void; stderr(line:string):void }

const defaultDependencies:CliDependencies={loadConfig,applyConfig,database:db,operations:ops};
const defaultIo:CliIo={stdout:line=>console.log(line),stderr:line=>console.error(line)};

export async function run(argv=process.argv.slice(2),dependencies:CliDependencies=defaultDependencies,io:CliIo=defaultIo):Promise<number>{let command='unknown';let connected=false;try{const parsed=parseCommand(argv);command=parsed.command;if(parsed.help){io.stdout(JSON.stringify(success(command,{help:helpText(command==='help'?undefined:command)})));return 0;}const loaded=dependencies.loadConfig({configPath:parsed.configPath});dependencies.applyConfig(loaded.config);await dependencies.database.connect();connected=true;
 const progress=parsed.format==='jsonl'?(event:unknown)=>io.stdout(JSON.stringify({operationId:command,event:'progress',timestamp:new Date().toISOString(),data:event})):undefined;
 const operations=dependencies.operations;let result;switch(command){case'page read':result=await operations.readPage(parsed.args as any,{log:m=>io.stderr(m)});break;case'crawl site':result=await operations.crawlDocumentationSite(parsed.args as any,{},progress);break;case'crawl pages':result=await operations.crawlPages(parsed.args as any,{},progress);break;case'search':result=await operations.search(parsed.args as any);break;case'document get':result=await operations.getDocument(parsed.args as any);break;case'document list':result=await operations.listDocuments(parsed.args as any);break;case'stats':result=await operations.getStats();break;case'site list':result=await operations.listSites(parsed.args as any);break;case'site get':result=await operations.getSite(parsed.args as any);break;case'site delete':result=await operations.deleteSite(parsed.args as any);break;case'embedding backfill':result=await operations.startEmbeddingBackfill();break;case'embedding status':result=await operations.embeddingStatus(parsed.args as any);break;default:throw new Error(`Unhandled command ${command}`);}
 let data:any=result.data;
 if(command==='page read'||command==='document get')data=await formatContentResult(data,parsed.contentLimit,parsed.output,operations);
 else if(command==='search')data={...data,results:Array.isArray(data.results)?data.results.map((item:any)=>previewItem(item,parsed.contentLimit)):data.results};
 else if(command==='document list')data={...data,documents:Array.isArray(data.documents)?data.documents.map((item:any)=>previewItem(item,parsed.contentLimit)):data.documents};
 const envelope=success(command,data,result.warnings);if(parsed.format==='jsonl')io.stdout(JSON.stringify({operationId:command,event:'terminal',timestamp:new Date().toISOString(),data:envelope}));else io.stdout(JSON.stringify(envelope));return 0;
 }catch(error){const failed=failure(command,error);io.stdout(JSON.stringify(failed.envelope));return failed.exitCode;}finally{if(connected)await dependencies.database.disconnect().catch(e=>io.stderr(`Cleanup error: ${String(e)}`));}}
export async function main(){process.exitCode=await run();}

export function previewItem(item:any,limit:number){if(!item||typeof item.content!=='string')return item;const content=item.content;const bytes=Buffer.byteLength(content);const truncated=content.length>limit;return{...item,content:truncated?content.slice(0,limit):content,contentTruncated:truncated,contentBytes:bytes};}
export async function formatContentResult(data:any,limit:number,output?:string,operations:Pick<typeof ops,'saveContent'>=ops){const content=typeof data.content==='string'?data.content:'';const contentType=data.contentType??'text/markdown';if(output){const {content:_content,...metadata}=data;return{...metadata,contentBytes:Buffer.byteLength(content),contentTruncated:false,output:await operations.saveContent(content,output,contentType)};}return previewItem(data,limit);}
