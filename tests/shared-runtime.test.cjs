'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PermissionService}=require('../src/permissions.cjs');
const {createRuntime}=require('../src/runtime.cjs');
function fixture(t){
  const root=path.resolve(__dirname,'../artifacts/verification/unit');fs.mkdirSync(root,{recursive:true});
  const directory=fs.mkdtempSync(path.join(root,'shared-runtime-'));
  const permissions=new PermissionService({directory,selfExecutables:['C:\\WindowUse\\WindowUse.exe']});
  t.after(()=>{permissions.dispose();fs.rmSync(directory,{recursive:true});assert.equal(fs.existsSync(directory),false);});
  return {directory,permissions};
}
// Retain this boundary: later adapter rewiring must not merge independent grants
// or replace chat authorization with a cached standalone grant.
test('shared policy keeps grants isolated and Stop durable across host replacement',async t=>{
  const {directory,permissions}=fixture(t),a=permissions.fork(),b=permissions.fork();
  t.after(()=>{a.dispose();b.dispose();});
  const identity={executable:'C:\\Apps\\Editor.exe'};
  const approval=a.request(identity);a.respond(a.approvals()[0].id,'session');await approval;
  assert.equal(a.allowed(identity),true);assert.equal(b.allowed(identity),false);
  const pending=b.request(identity);const rejected=assert.rejects(pending,{code:'user_stopped'});
  permissions.stop();await rejected;
  assert.equal(a.allowed(identity),false);assert.equal(b.stopped,true);
  const replacement=new PermissionService({directory,selfExecutables:['C:\\WindowUse\\WindowUse.exe']});
  try{assert.equal(replacement.stopped,true);replacement.resume();}finally{replacement.dispose();}
});
test('private owner and tool operations revalidate external authorization and share Stop',async t=>{
  const {directory,permissions}=fixture(t);const session=permissions.fork();let allowed=true,calls=0,disposed=false;
  const backend={async request(method){assert.equal(method,'listWindows');return [];},async dispose(){disposed=true;}};
  const runtime=createRuntime({directory,permissions:session,backend,authorize:async(_identity,permission)=>{assert.ok(['observation','desktop'].includes(permission));calls++;return allowed;}});
  t.after(async()=>{await runtime.dispose();session.dispose();});
  await runtime.call('list_windows',{});await runtime.call('owner.listWindows',{});assert.equal(calls,2);
  allowed=false;await assert.rejects(runtime.call('list_windows',{}),{code:'permission_denied'});assert.equal(calls,3);
  await assert.rejects(runtime.call('owner.arbitrary',{}),{code:'unsupported_action'});
  assert.equal((await runtime.call('context',{})).permissions.desktopControlGranted,false);
  allowed=true;await runtime.call('owner.requestPermission',{args:{permission:'desktop',reason:'test desktop approval'}});
  assert.equal((await runtime.call('context',{})).permissions.desktopControlGranted,true);
  permissions.stop();await assert.rejects(runtime.call('owner.listWindows',{}),{code:'user_stopped'});
  assert.equal((await runtime.call('context',{})).permissions.desktopControlGranted,false);
  await runtime.call('owner.clear',{});await runtime.dispose();assert.equal(disposed,true);
});
test('per-call Azrael policy masks desktop and suppresses titles without weakening global protection',async t=>{
  const {directory,permissions}=fixture(t),session=permissions.fork();
  const local='C:\\Apps\\Private.exe',global='C:\\Apps\\Global.exe',requests=[];
  permissions.save({protectedApps:[global]});
  const window=(executable,hwnd,title)=>({executable,hwnd,title,pid:100+Number(hwnd),processCreated:'abc',minimized:false,widthPx:440,heightPx:640,dpi:96});
  const backend={async request(method,args){requests.push({method,args});if(method==='listWindows')return [window(local,'1','Local secret'),window(global,'2','Global secret')];if(method==='captureDesktop')return {redacted:true,originX:0,originY:0,maskedWindowCount:2,widthPx:100,heightPx:100,image:{mimeType:'image/png',data:'aGVsbG8='}};throw Error(method);},async dispose(){}};
  const runtime=createRuntime({directory,permissions:session,backend,authorize:async()=>true});
  t.after(async()=>{await runtime.dispose();session.dispose();});
  const restricted={authorizationPolicy:{blockedApps:[local],observationAllowedApps:[]}};
  let list=await runtime.call('list_windows',{},undefined,restricted);
  assert.deepEqual(list.candidates.map(w=>w.title),['','']);
  await runtime.call('capture_desktop',{},undefined,restricted);
  assert.deepEqual(requests.find(r=>r.method==='captureDesktop').args.blockedApps,['c:\\apps\\global.exe','c:\\apps\\private.exe','c:\\windowuse\\windowuse.exe']);
  list=await runtime.call('list_windows',{},undefined,{authorizationPolicy:{blockedApps:[local],observationAllowedApps:[local,global]}});
  assert.deepEqual(list.candidates.map(w=>w.title),['Local secret','']);
  list=await runtime.call('list_windows',{},undefined,restricted);
  assert.deepEqual(list.candidates.map(w=>w.title),['',''],'a prior call exception must not leak to a later call');
});
