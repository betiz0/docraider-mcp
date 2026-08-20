#!/usr/bin/env node
/** Deterministic process-test composition. Never enabled by the production entrypoint. */
import { run, type CliDependencies } from './main.js';
import { OperationError, type ErrorKind } from '../operations/types.js';
import { loadConfig } from '../config.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

if (process.env.NODE_ENV !== 'test') throw new Error('CLI test entrypoint requires NODE_ENV=test');

const scenario=process.env.DOCRAIDER_CLI_TEST_SCENARIO ?? 'success';
const fail=():never=>{
  if(scenario==='unexpected')throw new Error('deterministic unexpected failure');
  const kinds:Record<string,[ErrorKind,string,number]>={not_found:['not_found','NOT_FOUND',3],config:['config','CONFIG_ERROR',4],database:['database','DATABASE_ERROR',5],external:['external_service','EXTERNAL_SERVICE_ERROR',6]};
  const selected=kinds[scenario];if(selected)throw new OperationError(selected[0],selected[1],`deterministic ${scenario} failure`);
  throw new Error(`Unknown test scenario: ${scenario}`);
};
const result=(data:unknown={fixture:true})=>({data,warnings:[]});
const operation=(data?:unknown)=>async()=>{if(scenario!=='success')fail();return result(data);};
const operations:any={
 readPage:async(_args:unknown,context:{log?:(message:string)=>void})=>{context.log?.('fixture operation log');if(scenario!=='success')fail();return result({content:'page fixture',contentType:'text/markdown'});},
 crawlDocumentationSite:async(_args:unknown,_context:unknown,onProgress?:(event:unknown)=>void)=>{if(scenario!=='success')fail();onProgress?.({url:'https://example.test/one',success:true});return result({pagesProcessed:1});},
 crawlPages:async(_args:unknown,_context:unknown,onProgress?:(event:unknown)=>void)=>{if(scenario!=='success')fail();onProgress?.({url:'https://example.test/one',success:true});onProgress?.({url:'https://example.test/two',success:true});return result({pagesProcessed:2});},
 search:operation({results:[]}),getDocument:operation({content:'document fixture',contentType:'text/markdown'}),
 listDocuments:operation({documents:[]}),getStats:operation({documents:1}),listSites:operation({sites:[]}),
 getSite:operation({id:'site-1'}),deleteSite:operation({id:'site-1',deleted:true}),
 startEmbeddingBackfill:operation({jobId:1,status:'queued'}),embeddingStatus:operation({status:'ready'}),
 saveContent:async(content:string,path:string,contentType:string)=>{const target=resolve(path);await mkdir(dirname(target),{recursive:true});await writeFile(target,content,'utf8');return{path:target,bytes:Buffer.byteLength(content),contentType,truncated:false};},
};
const dependencies:CliDependencies={
 loadConfig:options=>loadConfig({...options,env:{},cwd:'/definitely/no/docraider/config',packageRoot:'/definitely/no/docraider/package',loadDotEnv:false}),
 applyConfig:config=>config,database:{connect:async()=>undefined,disconnect:async()=>undefined},operations,
};
console.error('fixture process log');
process.exitCode=await run(process.argv.slice(2),dependencies);
