'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {StringDecoder}=require('node:string_decoder');
const {fail}=require('./permissions.cjs');
const METHODS=new Set(['capabilities','listWindows','observe','inspect','status','restore','resize','act','actionPoint','captureDesktop','windowAtPoint','overlayHide','approvalNotificationHide']);
const MUTATIONS=new Set(['restore','resize','act']);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function verifyPlatformRuntime(directory,{platform=process.platform,arch=process.arch}={}) {
  directory=path.resolve(directory);
  for(let current=directory;;current=path.dirname(current)){const info=fs.lstatSync(current);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Linked native runtime ancestor');if(path.dirname(current)===current)break;}
  const regular=file=>{const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink())throw Error('Non-regular native runtime member');return fs.readFileSync(file);};
  if(fs.lstatSync(directory).isSymbolicLink())throw Error('Linked native runtime directory');
  const bytes=regular(path.join(directory,'manifest.json')),manifest=JSON.parse(bytes);
  if(manifest.schema!==1||manifest.kind!=='azrael-window-control'||manifest.platform!==platform||manifest.arch!==arch||!['darwin','linux'].includes(platform)||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>16)throw Error('Native runtime platform or manifest mismatch');
  const seen=new Set();
  for(const member of manifest.files){if(!/^[A-Za-z0-9_.-]+$/.test(member.path)||seen.has(member.path)||!Number.isSafeInteger(member.bytes)||!/^[a-f0-9]{64}$/.test(member.sha256))throw Error('Invalid native runtime inventory');seen.add(member.path);const value=regular(path.join(directory,member.path));if(value.length!==member.bytes||hash(value)!==member.sha256)throw Error('Native runtime integrity mismatch');}
  if(!seen.has(manifest.entry)||fs.readdirSync(directory).some(name=>name!=='manifest.json'&&!seen.has(name)))throw Error('Unrecorded native runtime file');
  const executable=path.join(directory,manifest.entry);
  if(platform==='darwin')fs.accessSync(executable,fs.constants.X_OK);
  return {directory,executable,manifest,manifestSha256:hash(bytes)};
}
function nativeFailure(payload,method) {
  const nativeCode=typeof payload?.code==='string'?payload.code:'invalid-response';
  let code='connection_error';
  if(/unsupported|not-resizable|disabled-element|readonly-element/.test(nativeCode))code='unsupported_action';
  else if(/permission|accessibility|screen-recording|gui-session/.test(nativeCode))code='permission_denied';
  else if(/stale|window-closed|unknown-element|unobservable/.test(nativeCode))code='state_changed';
  else if(/invalid/.test(nativeCode))code='invalid_arguments';
  else if(nativeCode==='window-minimized')code='window_minimized';
  const error=fail(code,'Native '+process.platform+' operation failed ('+nativeCode+')');
  error.stage='native';error.nativeCode=nativeCode;
  if(MUTATIONS.has(method)&&(!['unsupported_action','permission_denied','state_changed','invalid_arguments','window_minimized'].includes(code)||payload?.mutationOutcome==='unknown')){delete error.actionExecuted;error.mutationOutcome='unknown';error.observationRequired=true;}
  return error;
}
function createPlatformBackend(directory,{spawnChild=spawn,timeoutMs=30000}={}) {
  const declaration=verifyPlatformRuntime(directory),pending=new Map();let child,closed=false,retiring,disposePromise;
  function rejectAll(error){for(const [id,p] of pending){clearTimeout(p.timer);const e=Object.assign(new Error(error.message),error);if(MUTATIONS.has(p.method)){delete e.actionExecuted;e.mutationOutcome='unknown';e.observationRequired=true;}p.reject(e);pending.delete(id);}}
  function start(){
    if(closed||retiring)throw fail('connection_error','Native runtime is closed or awaiting process exit');
    if(child)return child;
    const checked=verifyPlatformRuntime(directory);if(checked.manifestSha256!==declaration.manifestSha256)throw fail('connection_error','Native runtime changed');
    child=spawnChild(process.platform==='linux'?'/usr/bin/python3':checked.executable,process.platform==='linux'?[checked.executable]:[],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    const current=child,decoder=new StringDecoder('utf8');let buffer='';
    current.stdout.on('data',chunk=>{buffer+=decoder.write(chunk);if(Buffer.byteLength(buffer)>32*1024*1024){rejectAll(fail('connection_error','Native response exceeded limit'));retiring=current;current.kill();return;}let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let response;try{response=JSON.parse(line);}catch{rejectAll(fail('connection_error','Invalid native response'));retiring=current;current.kill();return;}const p=pending.get(response.id);if(!p)continue;clearTimeout(p.timer);pending.delete(response.id);if(response.error)p.reject(nativeFailure(response.error,p.method));else if(p.method==='listWindows'){if(!Array.isArray(response.result?.windows))p.reject(fail('connection_error','Invalid native window list'));else p.resolve(response.result.windows);}else p.resolve(response.result);}});
    current.stderr.on('data',()=>{});
    const failed=()=>{rejectAll(fail('connection_error','Native transport failed'));retiring=current;current.kill();};
    current.on('error',failed);current.stdin.on('error',failed);current.stdout.on('error',failed);
    current.once('close',()=>{if(child===current)child=undefined;if(retiring===current)retiring=undefined;rejectAll(fail('connection_error','Native runtime exited'));});
    return current;
  }
  const request=(method,params={})=>{
    if(!METHODS.has(method))return Promise.reject(fail('unsupported_action','Native method unavailable on this platform'));
    if(pending.size>=32)return Promise.reject(fail('connection_error','Too many native requests'));
    let current;try{current=start();}catch(e){return Promise.reject(e);}
    return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{rejectAll(fail('timeout','Native request timed out'));retiring=current;current.kill();},timeoutMs);pending.set(id,{method,timer,resolve,reject});current.stdin.write(JSON.stringify({id,method,params})+'\n',error=>{if(error){rejectAll(fail('connection_error','Native request delivery failed'));retiring=current;current.kill();}});});
  };
  return {request,capabilities:declaration.manifest.capabilities||{},getCapabilities:()=>request('capabilities'),
    hideApprovalNotification:()=>Promise.resolve({hidden:true}),
    dispose(){if(disposePromise)return disposePromise;closed=true;rejectAll(fail('cancelled','Native backend disposed'));const current=child;if(!current)return Promise.resolve();disposePromise=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{current.kill();const final=setTimeout(()=>reject(fail('connection_error','Native helper did not exit')),2000);current.once('close',()=>clearTimeout(final));},3000);current.once('close',()=>{clearTimeout(timer);resolve();});current.stdin.end();});return disposePromise;}
  };
}
module.exports={verifyPlatformRuntime,createPlatformBackend};
