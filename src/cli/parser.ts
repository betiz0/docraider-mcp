import { OperationError } from '../operations/types.js';

export interface ParsedCommand { command:string; args:Record<string,unknown>; configPath?:string; help?:boolean; format:'json'|'jsonl'; output?:string; contentLimit:number }
type CommandName = typeof COMMAND_SPECS[number]['name'];
type OptionName = '--url'|'--max-pages'|'--max-depth'|'--mode'|'--limit'|'--offset'|'--site-id'|'--sort-by'|'--sort-order'|'--confirm'|'--job-id'|'--probe'|'--output'|'--content-limit'|'--format';
interface CommandSpec { name:string; usage:string; description:string; positionals:0|1|'query'; options:readonly OptionName[] }

const COMMAND_SPECS = [
 {name:'page read',usage:'page read <url> [--content-limit N] [--output PATH]',description:'Read and extract a page',positionals:1,options:['--content-limit','--output']},
 {name:'crawl site',usage:'crawl site <url> [--max-pages N] [--max-depth N] [--format json|jsonl]',description:'Crawl a documentation site',positionals:1,options:['--max-pages','--max-depth','--format']},
 {name:'crawl pages',usage:'crawl pages --url <url>... [--format json|jsonl]',description:'Crawl multiple pages',positionals:0,options:['--url','--format']},
 {name:'search',usage:'search <query> [--mode keyword|semantic|hybrid] [--limit N] [--offset N] [--site-id ID] [--content-limit N]',description:'Search indexed documents',positionals:'query',options:['--mode','--limit','--offset','--site-id','--content-limit']},
 {name:'document get',usage:'document get <id> [--content-limit N] [--output PATH]',description:'Get a document',positionals:1,options:['--content-limit','--output']},
 {name:'document list',usage:'document list [--site-id ID] [--limit N] [--offset N] [--sort-by FIELD] [--sort-order asc|desc] [--content-limit N]',description:'List documents with bounded content previews',positionals:0,options:['--site-id','--limit','--offset','--sort-by','--sort-order','--content-limit']},
 {name:'stats',usage:'stats',description:'Show index statistics',positionals:0,options:[]},
 {name:'site list',usage:'site list [--limit N] [--offset N] [--sort-by FIELD] [--sort-order asc|desc]',description:'List sites',positionals:0,options:['--limit','--offset','--sort-by','--sort-order']},
 {name:'site get',usage:'site get <id>',description:'Get a site',positionals:1,options:[]},
 {name:'site delete',usage:'site delete <id> --confirm <id>',description:'Delete a site',positionals:1,options:['--confirm']},
 {name:'embedding backfill',usage:'embedding backfill',description:'Queue embedding backfill',positionals:0,options:[]},
 {name:'embedding status',usage:'embedding status [--job-id N] [--probe]',description:'Show embedding status',positionals:0,options:['--job-id','--probe']},
] as const satisfies readonly CommandSpec[];
export const COMMANDS = COMMAND_SPECS.map(s=>s.name) as CommandName[];
const COMMON='Common options: --config PATH --help';
export function helpText(command?:string):string {
 const header='Usage: docraider [--config PATH] <command> [options]';
 if(command){const spec=COMMAND_SPECS.find(s=>s.name===command);if(spec)return `${header}

Usage: docraider ${spec.usage}

${spec.description}

${COMMON}`;}
 return `${header}

Commands:
${COMMAND_SPECS.map(s=>`  ${s.usage.padEnd(76)} ${s.description}`).join('\n')}

${COMMON}`;
}
function take(argv:string[],i:number,name:string):[string,number]{const value=argv[i+1];if(!value||value.startsWith('--'))throw new OperationError('input','INVALID_INPUT',`${name} requires a value`);return[value,i+1];}
function intOption(name:string,value:unknown,min:number,max=Number.MAX_SAFE_INTEGER){if(value!==undefined&&(!Number.isInteger(value)||Number(value)<min||Number(value)>max))throw new OperationError('input','INVALID_INPUT',`${name} must be an integer from ${min} to ${max}`);}
export function parseCommand(argv:string[]):ParsedCommand {
 const positionals:string[]=[];const seenOptions:string[]=[];const options:Record<string,unknown>={urls:[]};let configPath:string|undefined,format:'json'|'jsonl'='json',output:string|undefined,contentLimit=8000,help=false;
 for(let i=0;i<argv.length;i++){const a=argv[i];if(a==='--help'||a==='-h'){help=true;continue;}if(!a.startsWith('--')){positionals.push(a);continue;}let v:string;seenOptions.push(a);
  switch(a){case'--config':[v,i]=take(argv,i,a);configPath=v;break;case'--format':[v,i]=take(argv,i,a);if(v!=='json'&&v!=='jsonl')throw new OperationError('input','INVALID_INPUT','--format must be json or jsonl');format=v;break;case'--output':[v,i]=take(argv,i,a);output=v;break;case'--content-limit':[v,i]=take(argv,i,a);contentLimit=Number(v);break;case'--url':[v,i]=take(argv,i,a);(options.urls as string[]).push(v);break;case'--max-pages':[v,i]=take(argv,i,a);options.maxPages=Number(v);break;case'--max-depth':[v,i]=take(argv,i,a);options.maxDepth=Number(v);break;case'--mode':[v,i]=take(argv,i,a);options.mode=v;break;case'--limit':[v,i]=take(argv,i,a);options.limit=Number(v);break;case'--offset':[v,i]=take(argv,i,a);options.offset=Number(v);break;case'--site-id':[v,i]=take(argv,i,a);options.siteId=v;break;case'--sort-by':[v,i]=take(argv,i,a);options.sortBy=v;break;case'--sort-order':[v,i]=take(argv,i,a);options.sortOrder=v;break;case'--confirm':[v,i]=take(argv,i,a);options.confirm=v;break;case'--job-id':[v,i]=take(argv,i,a);options.jobId=Number(v);break;case'--probe':options.probe=true;break;default:throw new OperationError('input','INVALID_INPUT',`Unknown option: ${a}`);}}
 if(!Number.isInteger(contentLimit)||contentLimit<0)throw new OperationError('input','INVALID_INPUT','--content-limit must be a non-negative integer');
 const spec=COMMAND_SPECS.find(candidate=>candidate.name.split(' ').every((p,j)=>positionals[j]===p));
 if(!spec){if(help||argv.length===0)return{command:'help',args:{},configPath,help:true,format,output,contentLimit};throw new OperationError('input','UNKNOWN_COMMAND',`Unknown command: ${positionals.join(' ')}`);}
 const command=spec.name,consumed=command.split(' ').length,rest=positionals.slice(consumed);
 if(help)return{command,args:options,configPath,help,format,output,contentLimit};
 if(format==='jsonl'&&command!=='crawl site'&&command!=='crawl pages')throw new OperationError('input','INVALID_INPUT','--format jsonl is only supported for crawl commands');
 const allowed=new Set<string>(['--config',...spec.options]);for(const name of seenOptions)if(!allowed.has(name))throw new OperationError('input','INVALID_INPUT',`${name} is not valid for ${command}`);
 if(spec.positionals===0&&rest.length)throw new OperationError('input','INVALID_INPUT','Too many arguments');if(spec.positionals===1&&rest.length>1)throw new OperationError('input','INVALID_INPUT','Too many arguments');
 if(command==='page read'||command==='crawl site')options.url=rest[0];else if(command==='search')options.query=rest.join(' ');else if(command==='document get')options.documentId=rest[0];else if(command==='site get'||command==='site delete')options.siteId=rest[0];
 if(options.mode!==undefined&&!['keyword','semantic','hybrid'].includes(String(options.mode)))throw new OperationError('input','INVALID_SEARCH_MODE','--mode must be keyword, semantic, or hybrid');
 if(options.sortOrder!==undefined&&!['asc','desc'].includes(String(options.sortOrder)))throw new OperationError('input','INVALID_INPUT','--sort-order must be asc or desc');
 const sorts=command==='document list'?['last_crawled_at','created_at','title']:['last_crawled_at','created_at','domain','name'];if(options.sortBy!==undefined&&!sorts.includes(String(options.sortBy)))throw new OperationError('input','INVALID_INPUT',`Invalid ${command==='document list'?'document':'site'} --sort-by`);
 intOption('--limit',options.limit,1,100);intOption('--offset',options.offset,0);intOption('--max-pages',options.maxPages,1,10000);intOption('--max-depth',options.maxDepth,0,100);intOption('--job-id',options.jobId,1);
 if((command==='page read'||command==='crawl site')&&!options.url)throw new OperationError('input','INVALID_INPUT','url is required');if(command==='crawl pages'&&(options.urls as string[]).length===0)throw new OperationError('input','INVALID_INPUT','At least one --url is required');if(command==='search'&&!options.query)throw new OperationError('input','INVALID_INPUT','query is required');if((command==='document get'||command==='site get'||command==='site delete')&&!options.siteId&&!options.documentId)throw new OperationError('input','INVALID_INPUT','id is required');if(command==='site delete'&&options.confirm!==options.siteId)throw new OperationError('input','CONFIRMATION_MISMATCH','--confirm must exactly match the site ID');
 return{command,args:options,configPath,help,format,output,contentLimit};
}
