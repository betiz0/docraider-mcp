import { describe,it,expect } from 'vitest';
import { parseCommand, COMMANDS } from '../../src/cli/parser.js';
import { previewItem } from '../../src/cli/main.js';
import { failure, EXIT_CODES, classifyError } from '../../src/cli/formatter.js';
import { OperationError, MCP_OPERATION_MAP, CLI_OPERATION_MAP } from '../../src/operations/types.js';
import { previewItem } from '../../src/cli/main.js';
describe('CLI contracts',()=>{
 it('parses every command table entry',()=>{for(const command of COMMANDS){const suffix=command==='page read'||command==='crawl site'?' https://example.com':command==='search'?' query':command==='document get'||command==='site get'?' id':command==='site delete'?' id --confirm id':command==='crawl pages'?' --url https://example.com':'';expect(parseCommand((command+suffix).split(' ')).command).toBe(command);}});
 it('maps stable errors to exit codes',()=>{for(const [kind,code] of Object.entries(EXIT_CODES)){expect(failure('x',new OperationError(kind as any,'X','bad')).exitCode).toBe(code);}});
 it('covers all twelve MCP tools and CLI commands with identical operations',()=>{expect(Object.keys(MCP_OPERATION_MAP)).toHaveLength(12);expect(Object.keys(CLI_OPERATION_MAP)).toEqual([...COMMANDS]);expect(new Set(Object.values(CLI_OPERATION_MAP))).toEqual(new Set(Object.values(MCP_OPERATION_MAP)));});
 it('provides command-specific help and rejects options on the wrong command',()=>{
  expect(parseCommand(['search','--help']).help).toBe(true);
  expect(()=>parseCommand(['stats','--limit','1'])).toThrow('not valid for stats');
  expect(()=>parseCommand(['document','list','--limit','0'])).toThrow('--limit');
 });
 it('classifies PostgreSQL diagnostics and nested connection failures as database errors',()=>{
  const pg=Object.assign(new Error('relation missing'),{code:'42P01',severity:'ERROR',routine:'parserOpenTable'});
  expect(classifyError(pg)).toMatchObject({kind:'database',code:'DATABASE_ERROR',details:{code:'42P01'}});
  expect(classifyError(new Error('startup failed',{cause:Object.assign(new Error('connect postgres'),{code:'ECONNREFUSED'})}))).toMatchObject({kind:'database'});
 });
 it('bounds search and document-list content previews with explicit metadata',()=>{expect(previewItem({id:'x',content:'abcdef'},3)).toMatchObject({content:'abc',contentTruncated:true,contentBytes:6});expect(previewItem({content:'abc'},3)).toMatchObject({content:'abc',contentTruncated:false,contentBytes:3});});
 it('requires exact delete confirmation in parsed data',()=>expect(parseCommand(['site','delete','abc','--confirm','abc']).args).toMatchObject({siteId:'abc',confirm:'abc'}));
 it('rejects unsafe enumerations, stray arguments, and JSONL on non-crawl commands',()=>{
  expect(()=>parseCommand(['document','list','--sort-order','drop table'])).toThrow('--sort-order');
  expect(()=>parseCommand(['stats','junk'])).toThrow('Too many arguments');
  expect(()=>parseCommand(['search','query','--format','jsonl'])).toThrow('--format jsonl is only supported for crawl commands');
 });
});
