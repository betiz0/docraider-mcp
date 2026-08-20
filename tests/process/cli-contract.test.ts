import {describe,it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';

const node=process.execPath;
const entry=new URL('../../dist/cli/process-test-entry.js',import.meta.url).pathname;
const commands:[string,string[]][]=[
 ['page read',['page','read','https://example.test/page']],
 ['crawl site',['crawl','site','https://example.test']],
 ['crawl pages',['crawl','pages','--url','https://example.test/a','--url','https://example.test/b']],
 ['search',['search','fixture query']],
 ['document get',['document','get','doc-1']],
 ['document list',['document','list']],
 ['stats',['stats']],
 ['site list',['site','list']],
 ['site get',['site','get','site-1']],
 ['site delete',['site','delete','site-1','--confirm','site-1']],
 ['embedding backfill',['embedding','backfill']],
 ['embedding status',['embedding','status']],
];
function spawn(args:string[],scenario='success'){
 return spawnSync(node,[entry,...args],{encoding:'utf8',env:{...process.env,NODE_ENV:'test',DOCRAIDER_CLI_TEST_SCENARIO:scenario}});
}
function singleEnvelope(stdout:string){const lines=stdout.trim().split('\n');expect(lines).toHaveLength(1);return JSON.parse(lines[0]);}

describe('CLI process contract with injected deterministic dependencies',()=>{
 it.each(commands)('%s writes exactly one JSON envelope to stdout and logs only to stderr',(command,args)=>{
  const result=spawn(args);
  expect(result.status,result.stderr).toBe(0);
  expect(singleEnvelope(result.stdout)).toMatchObject({ok:true,command});
  expect(result.stderr).toContain('fixture process log');
  expect(result.stderr).not.toContain('"ok"');
 });

 it.each([
  {name:'unexpected',scenario:'unexpected',status:1,code:'UNEXPECTED_ERROR'},
  {name:'input',scenario:'success',args:['site','delete','site-1','--confirm','wrong'],status:2,code:'CONFIRMATION_MISMATCH'},
  {name:'not found',scenario:'not_found',status:3,code:'NOT_FOUND'},
  {name:'configuration',scenario:'config',status:4,code:'CONFIG_ERROR'},
  {name:'database',scenario:'database',status:5,code:'DATABASE_ERROR'},
  {name:'external service',scenario:'external',status:6,code:'EXTERNAL_SERVICE_ERROR'},
 ])('maps $name failures to exit $status and a JSON error envelope',testCase=>{
  const result=spawn(testCase.args??['stats'],testCase.scenario);
  expect(result.status,result.stderr).toBe(testCase.status);
  expect(singleEnvelope(result.stdout)).toMatchObject({ok:false,error:{code:testCase.code}});
  expect(result.stderr).toContain('fixture process log');
  expect(result.stderr).not.toContain('"ok"');
 });
});
