import { OperationError, type ErrorKind } from '../operations/types.js';

export const EXIT_CODES:Record<ErrorKind,number>={unexpected:1,input:2,not_found:3,config:4,database:5,external_service:6};
export function success(command:string,data:unknown,warnings:string[]=[]){return{ok:true,command,data,warnings};}
export function failure(command:string,error:unknown){const classified=classifyError(error);return{exitCode:EXIT_CODES[classified.kind],envelope:{ok:false,command,error:{code:classified.code,message:classified.message,...(classified.details===undefined?{}:{details:classified.details})}}};}

type Classified={kind:ErrorKind;code:string;message:string;details?:unknown};
type ErrorRecord={message?:unknown;code?:unknown;severity?:unknown;routine?:unknown;schema?:unknown;table?:unknown;cause?:unknown};
function records(error:unknown):ErrorRecord[]{const result:ErrorRecord[]=[];const seen=new Set<unknown>();let current=error;while(current&&typeof current==='object'&&!seen.has(current)){seen.add(current);result.push(current as ErrorRecord);current=(current as ErrorRecord).cause;}return result;}
function messageOf(error:unknown):string{return error instanceof Error?error.message:String(error);}
function pgDetails(error:ErrorRecord){const details=Object.fromEntries(['code','severity','schema','table','routine'].flatMap(k=>error[k as keyof ErrorRecord]===undefined?[]:[[k,error[k as keyof ErrorRecord]]]));return Object.keys(details).length?details:undefined;}
/** Convert transport/library failures into the stable CLI error taxonomy. */
export function classifyError(error:unknown):Classified {
 if(error instanceof OperationError)return error;
 const chain=records(error);const message=messageOf(error);
 // node-postgres exposes a five-character SQLSTATE and PostgreSQL diagnostic fields.
 const pg=chain.find(e=>typeof e.code==='string'&&/^[0-9A-Z]{5}$/.test(e.code as string)&&(e.severity!==undefined||e.routine!==undefined||/^[0-9A-Z]{2}/.test((e.code as string).slice(0,2))));
 if(pg)return{kind:'database',code:'DATABASE_ERROR',message,details:pgDetails(pg)};
 if(chain.some(e=>['ECONNREFUSED','ECONNRESET','ENOTFOUND','ETIMEDOUT','EHOSTUNREACH','EPIPE'].includes(String(e.code)))&&/postgres|database|connect|password|role|sql/i.test(chain.map(e=>String(e.message??'')).join(' ')))return{kind:'database',code:'DATABASE_ERROR',message};
 if(/config(?:uration)?|yaml|missing required environment|invalid embedding dimensions/i.test(message))return{kind:'config',code:'CONFIG_ERROR',message};
 if(/ECONNREFUSED|ECONNRESET|database|postgres|password authentication|no pg_hba|role .* does not exist|connection terminated/i.test(message))return{kind:'database',code:'DATABASE_ERROR',message};
 return{kind:'unexpected',code:'UNEXPECTED_ERROR',message};
}
