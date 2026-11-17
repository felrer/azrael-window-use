'use strict';
// Standalone, explicitly launched experiment. This is not a Window Use authority adapter.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),readline=require('node:readline');
const {spawn}=require('node:child_process');
const {StringDecoder}=require('node:string_decoder');
const MAX_LINE=1024*1024;
const ACTUATION=new Set(['click','drag','scroll','key','press','text','batch']);
const field=(type,extra={})=>({type,...extra});
const pointer=()=>({pointerId:field('string',{minLength:1,maxLength:32,pattern:'^[A-Za-z0-9_-]+$'})});
const xy=()=>({x:field('integer',{minimum:-100000,maximum:100000}),y:field('integer',{minimum:-100000,maximum:100000})});
function tool(name,description,properties={},required=Object.keys(properties)){return {name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}};}
function batchStepSchema(){return {oneOf:[
 tool('click','',{action:field('string',{enum:['click']}),...xy(),button:field('string',{enum:['left','right','middle']})},['action','button']).inputSchema,
 tool('text','',{action:field('string',{enum:['text']}),text:field('string',{minLength:1,maxLength:1024})}).inputSchema,
 tool('press','',{action:field('string',{enum:['press']}),keys:field('array',{minItems:1,maxItems:8,uniqueItems:true,items:field('integer',{minimum:8,maximum:254})})}).inputSchema
]};}
function toolDefinitions(){return [
 tool('status','Observe allowed targets, separate virtual cursors, shared physical cursor and foreground. No input.'),
 tool('collaboration','Enable or disable cooperative user/model mouse routing. User clicks are queued without cancelling model actions; stop always disables routing.',{enabled:field('boolean')}),
 tool('create_pointer','Create a colored, non-activating virtual cursor for a target from the startup allowlist. presentationOnly allows an on-screen initial cosmetic point without expanding subsequent input bounds.',{...pointer(),targetId:field('string',{minLength:1,maxLength:32,pattern:'^[A-Za-z0-9_-]+$'}),...xy(),color:field('string',{pattern:'^#[0-9A-Fa-f]{6}$'}),presentationOnly:field('boolean')},['pointerId','targetId','x','y']),
 tool('move','Move only this virtual cursor. The physical Windows cursor is unchanged.',{...pointer(),...xy()}),
 tool('desktop_target','Host adapter: pin an exact live desktop target at a visible hit. Requires immutable startup desktop:true; this method grants no app authorization.',{...pointer(),target:field('object',{properties:{hwnd:field('string',{pattern:'^0x[0-9A-Fa-f]{1,16}$'}),pid:field('integer',{minimum:1,maximum:4294967295}),processCreated:field('string',{pattern:'^0x[0-9A-Fa-f]{1,16}$'}),executable:field('string',{minLength:1,maxLength:32768})},required:['hwnd','pid','processCreated','executable'],additionalProperties:false}),...xy()}),
 tool('present_pointer','Host adapter: display a virtual pointer and activity without physical input, activation or changing its logical input position.',{...pointer(),...xy(),phase:field('string',{enum:['active','idle']}),click:field('boolean')},['pointerId','x','y','phase']),
 tool('click','Switch Windows foreground/input to this allowed target and click. Physical cursor/foreground can change.',{...pointer(),button:field('string',{enum:['left','right','middle']})}),
 tool('drag','Drag to x/y, or follow points (full screen path including explicit start/end) using centripetal Catmull–Rom alpha 0.5. Points exclude x/y. Cooperative routing queues user mouse gestures; foreign injection or unsupported input can interrupt a partial drag.',{...pointer(),...xy(),points:field('array',{minItems:2,maxItems:32,items:field('array',{minItems:2,maxItems:2,items:field('integer',{minimum:-100000,maximum:100000})})}),durationMs:field('integer',{minimum:50,maximum:2000})},['pointerId']),
 tool('scroll','Switch Windows input to this target and send a vertical wheel delta.',{...pointer(),delta:field('integer',{minimum:-12000,maximum:12000})}),
 tool('key','Send a concrete Windows virtual-key down/up. Use left/right Shift or Ctrl; Alt, Windows and shell-switch shortcuts are unsupported. Release held keys before switching pointer.',{...pointer(),vk:field('integer',{minimum:8,maximum:254}),down:field('boolean')}),
 tool('press','Send one atomic key chord, releasing all keys before another participant runs. Keys are concrete Windows virtual keys in press order.',{...pointer(),keys:field('array',{minItems:1,maxItems:8,uniqueItems:true,items:field('integer',{minimum:8,maximum:254})})}),
 tool('text','Send Unicode text through Windows input to the activated allowed target. This does not perform IME composition.',{...pointer(),text:field('string',{minLength:1,maxLength:1024})}),
 tool('batch','Run 1..16 click, text or atomic press steps as one FIFO operation on this pointer/target without replay. Physical keyboard input is buffered until original focus is restored. Budget defaults to 750ms; inspect partial completion before continuing.',{...pointer(),steps:field('array',{minItems:1,maxItems:16,items:batchStepSchema()}),maxMs:field('integer',{minimum:100,maximum:1000,default:750})},['pointerId','steps']),
 tool('remove_pointer','Release this pointer and remove its overlay.',pointer()),
 tool('stop','Release synthetic held input and remove all virtual cursors. This does not close user apps.')
].map(def=>{if(ACTUATION.has(def.name)){def.inputSchema.properties.operationId=field('integer',{minimum:1,maximum:Number.MAX_SAFE_INTEGER,description:'Stable identity of this intended operation. Reuse for a duplicate request; never change it to replay uncertain input. Omit for a new operation.'});}if(def.name==='drag')def.inputSchema.oneOf=[{required:['x','y'],not:{required:['points']}},{required:['points'],not:{anyOf:[{required:['x']},{required:['y']}]}}];return def;});}
function validateArguments(def,args){
 function validate(d,v,k){
  if(d.required&&(!v||typeof v!=='object'||d.required.some(key=>!Object.hasOwn(v,key))))throw Error('Missing '+k+' argument');
  if(d.not){let matched=false;try{validate(d.not,v,k);matched=true;}catch{}if(matched)throw Error('Excluded '+k+' argument');}
  for(const mode of ['oneOf','anyOf'])if(d[mode]){let matches=0;for(const candidate of d[mode]){try{validate(candidate,v,k);matches++;}catch{}}if(mode==='oneOf'?matches!==1:matches===0)throw Error('Invalid '+k+' variant');}
  if(!d.type)return;
  if(d.type==='array'?!Array.isArray(v):d.type==='integer'?!Number.isSafeInteger(v):d.type==='object'?(!v||typeof v!=='object'||Array.isArray(v)):typeof v!==d.type)throw Error('Invalid '+k+' type');
  if(d.type==='object'){
   if(Object.keys(v).some(key=>!Object.hasOwn(d.properties,key))||(d.required||[]).some(key=>!Object.hasOwn(v,key)))throw Error('Unknown or missing '+k+' argument');
   for(const [key,value]of Object.entries(v))validate(d.properties[key],value,key);
   if(v.action==='click'&&Object.hasOwn(v,'x')!==Object.hasOwn(v,'y'))throw Error('Supply both screen coordinates');
  }
  if(d.type==='array'){
   if(v.length<d.minItems||v.length>d.maxItems||d.uniqueItems&&new Set(v.map(item=>JSON.stringify(item))).size!==v.length)throw Error('Invalid '+k+' items');
   for(const item of v)validate(d.items,item,k+' item');
  }
  if(d.enum&&!d.enum.includes(v)||d.minimum!==undefined&&v<d.minimum||d.maximum!==undefined&&v>d.maximum||d.minLength!==undefined&&v.length<d.minLength||d.maxLength!==undefined&&v.length>d.maxLength||d.pattern&&!new RegExp(d.pattern).test(v))throw Error('Invalid '+k+' value');
 }
 validate(def.inputSchema,args,'tool');
 if(Array.isArray(args.steps)&&args.steps.reduce((total,step)=>total+(step.action==='text'?step.text.length:0),0)>1024)throw Error('Batch text exceeds 1024 UTF-16 units');
 return args;
}
function plainFile(file){
 if(!path.isAbsolute(file)||file.includes('\0'))throw Error('Absolute plain file required');
 for(let p=path.resolve(file);;p=path.dirname(p)){const st=fs.lstatSync(p);if(st.isSymbolicLink()||(p===path.resolve(file)?!st.isFile():!st.isDirectory()))throw Error('Linked or non-regular input rejected');if(path.dirname(p)===p)break;}
 return path.resolve(file);
}
function verifyRuntime(directory){
 const manifestFile=plainFile(path.join(directory,'manifest.json'));const m=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
 if(m.schema!==1||m.kind!=='azrael-multi-pointer'||m.platform!=='win32'||m.arch!=='x64'||!/^[a-f0-9]{64}$/.test(m.sourceSha256)||!Array.isArray(m.files)||m.files.length!==2)throw Error('Verified multi-pointer runtime manifest required');
 let executable;const seen=new Set();
 for(const f of m.files){if(typeof f.path!=='string'||!['azrael-multi-pointer.exe','THIRD_PARTY_NOTICES.md'].includes(f.path)||seen.has(f.path)||!/^[a-f0-9]{64}$/.test(f.sha256)||!Number.isSafeInteger(f.bytes)||f.bytes<1)throw Error('Invalid runtime member');seen.add(f.path);const p=plainFile(path.join(directory,f.path));const b=fs.readFileSync(p);if(b.length!==f.bytes||crypto.createHash('sha256').update(b).digest('hex')!==f.sha256)throw Error('Runtime integrity mismatch');if(f.path==='azrael-multi-pointer.exe')executable=p;}
 if(!executable||fs.readdirSync(directory).some(name=>name!=='manifest.json'&&!seen.has(name)))throw Error('Runtime executable missing or unrecorded runtime file');return {directory:path.resolve(directory),executable,manifest:m,manifestSha256:crypto.createHash('sha256').update(fs.readFileSync(manifestFile)).digest('hex'),sourceSha256:m.sourceSha256};
}
function createBroker({runtimeDirectory,targetsFile,spawnProcess=spawn}){
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('Multi-pointer requires local Windows x64');
 const runtime=verifyRuntime(runtimeDirectory),targets=plainFile(targetsFile);if(fs.statSync(targets).size>65536)throw Error('Target allowlist too large');
 let child,reader,pending,sequence=0,operationSequence=0,closed=false,failed=false,stderr='',startupRejected=false,replySeen=false,firstFailure,closing;
 const events=[];
 const token=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,96}$/.test(value)?value:undefined;
 function diagnostic(){return {event:'window_use.broker_failure',...(child?.pid?{pid:child.pid}:{}),...firstFailure,
  terminationVerified:closed,exitCode:child?.exitCode??null,signal:child?.signalCode??null,startupRejected,events:[...events]};}
 function fail(error,stage='transport'){
  failed=true;firstFailure||={stage,method:pending?.method,nativeCode:token(error.details?.code)||token(error.code)||'broker_error'};
  error.details={...error.details,brokerDiagnostic:diagnostic()};
  if(pending){clearTimeout(pending.timer);pending.reject(error);pending=null;}
 }
 function stderrLine(line){try{const r=JSON.parse(line);if(r.component!=='multi-pointer'||!token(r.event))return;
  events.push({event:r.event,...(token(r.code)?{code:r.code}:{}),...(Number.isSafeInteger(r.win32Error)&&r.win32Error>=0?{win32Error:r.win32Error}:{})});if(events.length>8)events.shift();}catch{}}
 function start(){if(child)return;if(closed||failed)throw Error('Broker is closed');child=spawnProcess(runtime.executable,['--targets',targets],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  child.stderr.on('data',b=>{stderr+=b;let newline;while((newline=stderr.indexOf('\n'))>=0){stderrLine(stderr.slice(0,newline));stderr=stderr.slice(newline+1);}stderr=stderr.slice(-8192);});child.on('error',e=>fail(e,'spawn'));child.stdin.on('error',e=>fail(e,'stdin'));
  reader=readline.createInterface({input:child.stdout,crlfDelay:Infinity});reader.on('line',line=>{try{if(line.length>MAX_LINE)throw Error('Oversized native reply');const r=JSON.parse(line);if(r.id===null&&r.error){startupRejected=!replySeen&&r.error.actionExecuted===false;const e=Error('Native startup failed');e.details=r.error;fail(e,'startup');child.stdin.end();return;}if(!pending||r.id!==pending.id)throw Error('Unexpected native reply identity');replySeen=true;const p=pending;pending=null;clearTimeout(p.timer);if(r.error){const e=Error('Native operation failed');e.details={...r.error,brokerDiagnostic:{...diagnostic(),stage:'operation',method:p.method,nativeCode:token(r.error.code)||'broker_error'}};p.reject(e);}else if(!Object.hasOwn(r,'result')){p.reject(Error('Missing native result'));}else p.resolve(r.result);}catch(e){fail(e,'protocol');child.stdin.end();}});
  child.on('close',(code,signal)=>{closed=true;if(stderr)stderrLine(stderr);fail(Error('Native broker exited'),'exit');});
 }
 async function call(method,params={}){if(failed||closed)throw Error('Native broker unavailable; no replay');if(pending)throw Error('Native operation already pending');
  if(ACTUATION.has(method)){const operationId=params.operationId??operationSequence+1;if(!Number.isSafeInteger(operationId)||operationId<1)throw Error('Operation identity exhausted or invalid');operationSequence=Math.max(operationSequence,operationId);params={...params,operationId};}
  start();const id=++sequence;
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{fail(Error('Native result unknown after deadline; input is not replayed'),'deadline');child.stdin.end();},10000);pending={id,method,resolve,reject,timer};child.stdin.write(JSON.stringify({id,method,params})+'\n');});
 }
 function stopped(){return {exitCode:child.exitCode,signal:child.signalCode,terminationVerified:true,
  // A correlated startup rejection guarantees no command was executed. A crash
  // after startup has no such proof and must keep blocking cleanup.
  cleanupVerified:child.signalCode===null&&(child.exitCode===0||startupRejected),brokerDiagnostic:diagnostic()};}
 async function close(){if(!child){closed=true;return {started:false};}if(closed)return stopped();if(closing)return closing;
  closing=new Promise(resolve=>{const finish=()=>{clearTimeout(timer);resolve(stopped());};
   const timer=setTimeout(()=>{child.removeListener('close',finish);closing=null;resolve({exitCode:null,signal:null,terminationVerified:false,cleanupVerified:false,brokerDiagnostic:diagnostic()});},5000);
   child.once('close',finish);child.stdin.end();});return closing;}
 return {call,close};
}
function createProtocol({call,platform=process.platform}){let initialized=false;return async message=>{
 const id=message?.id;if(!message||message.jsonrpc!=='2.0'||typeof message.method!=='string')return {jsonrpc:'2.0',id:id??null,error:{code:-32600,message:'Invalid request'}};
 if(id===undefined)return null;
 if(message.method==='initialize'){initialized=true;return {jsonrpc:'2.0',id,result:{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'azrael-multi-pointer',version:'0.2.0'},instructions:'Windows x64 shared foreground input. Logical cursors keep separate positions. Enable collaboration explicitly and check actual capability/suppression state before claiming mouse isolation. User mouse gestures queue in verified cooperative mode; physical keyboard input is buffered during short key/batch reservations until original focus is restored; foreign injected input, unsupported input or Stop still stops model input. Use atomic press instead of cross-request key holds in collaboration. Recover target foreground/occlusion with bounded preparation; inspect partial effects and never replay unknown input. Reuse operationId for the same intended operation. Delivery does not verify app effects. Stop or EOF disables routing and releases tracked model input.'}};}
 if(!initialized)return {jsonrpc:'2.0',id,error:{code:-32002,message:'Initialize first'}};
 if(message.method==='ping')return {jsonrpc:'2.0',id,result:{}};
 if(message.method==='tools/list')return {jsonrpc:'2.0',id,result:{tools:platform==='win32'?toolDefinitions():[]}};
 if(message.method!=='tools/call')return {jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}};
 try{if(platform!=='win32')throw Error('Multi-pointer unavailable on this platform');const p=message.params,def=toolDefinitions().find(d=>d.name===p?.name);if(!def)throw Error('Unsupported tool');const args=validateArguments(def,p.arguments??{});const result=await call(def.name,args);return {jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(result)}],isError:false}};}
 catch(e){return {jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify({status:'failed',message:e.message,...(e.details?{details:e.details}:{}),applicationEffectVerified:false})}],isError:true}};}
};}
async function runProtocol({input=process.stdin,output=process.stdout,protocol}){
 const decoder=new StringDecoder('utf8');let buffer='';for await(const chunk of input){buffer+=typeof chunk==='string'?chunk:decoder.write(chunk);if(Buffer.byteLength(buffer)>MAX_LINE&&!buffer.includes('\n'))throw Error('MCP request too large');let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);if(Buffer.byteLength(line)>MAX_LINE)throw Error('MCP request too large');if(!line.trim())continue;let response;try{response=await protocol(JSON.parse(line));}catch{response={jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}};}if(response)output.write(JSON.stringify(response)+'\n');}}
 buffer+=decoder.end();
 if(buffer.trim())throw Error('Incomplete MCP request at EOF');
}
async function main(){const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){if(!['--runtime','--targets'].includes(args[i])||!args[i+1]||options[args[i]])throw Error('Usage: --runtime <absolute-runtime-directory> --targets <absolute-allowlist.json>');options[args[i]]=args[i+1];}if(!options['--runtime']||!options['--targets'])throw Error('Runtime and target allowlist required');
 const broker=createBroker({runtimeDirectory:options['--runtime'],targetsFile:options['--targets']});const stop=()=>{broker.close().then(()=>{process.exitCode=1;process.stdin.destroy();});};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{await runProtocol({protocol:createProtocol({call:broker.call})});}finally{const state=await broker.close();process.stderr.write(JSON.stringify({event:'native_closed',...state})+'\n');if(terminationFailed(state))process.exitCode=1;}
}
function terminationFailed(state){return state.started!==false&&(state.terminationVerified!==true||state.exitCode!==0||!!state.signal);}
module.exports={toolDefinitions,validateArguments,verifyRuntime,createBroker,createProtocol,runProtocol,terminationFailed};
if(require.main===module)main().catch(e=>{process.stderr.write(e.message+'\n');process.exitCode=1;});
