import {describe,it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {COMMANDS} from '../../src/cli/parser.js';
const node=process.execPath,entry=new URL('../../dist/cli/entry.js',import.meta.url).pathname;
describe('CLI child process JSON contract',()=>{
 it('prints one JSON envelope for help on every command',()=>{for(const command of COMMANDS){const r=spawnSync(node,[entry,...command.split(' '),'--help'],{encoding:'utf8'});expect(r.status,command).toBe(0);const lines=r.stdout.trim().split('\n');expect(lines,command).toHaveLength(1);expect(JSON.parse(lines[0])).toMatchObject({ok:true,command});expect(r.stderr).not.toContain('{"ok"');}});
 it('explicit config wins even when cwd auto-config is malformed',()=>{const cwd=mkdtempSync(join(tmpdir(),'docraider-cli-'));writeFileSync(join(cwd,'config.yaml'),'{{malformed');const valid=join(cwd,'valid.yaml');writeFileSync(valid,'database: { port: 1 }');const r=spawnSync(node,[entry,'site','delete','abc','--confirm','wrong','--config',valid],{cwd,encoding:'utf8'});expect(r.status).toBe(2);expect(JSON.parse(r.stdout)).toMatchObject({ok:false,error:{code:'CONFIRMATION_MISMATCH'}});});
 it('returns input envelope without opening resources',()=>{const r=spawnSync(node,[entry,'site','delete','abc','--confirm','wrong'],{encoding:'utf8'});expect(r.status).toBe(2);expect(JSON.parse(r.stdout)).toMatchObject({ok:false,error:{code:'CONFIRMATION_MISMATCH'}});});
 it('classifies config and database failures without a live database',()=>{const cases=[{args:['--config','/definitely/missing/docraider.yaml','stats'],status:4,code:'CONFIG_ERROR'},{args:['--config',new URL('../fixtures/cli-db-failure.yaml',import.meta.url).pathname,'stats'],status:5,code:'DATABASE_ERROR'}];for(const c of cases){const r=spawnSync(node,[entry,...c.args],{encoding:'utf8',env:{...process.env,DOCRAIDER_CONFIG:''}});expect(r.status,c.code).toBe(c.status);expect(r.stdout.trim().split('\n')).toHaveLength(1);expect(JSON.parse(r.stdout)).toMatchObject({ok:false,error:{code:c.code}});}});
});
