'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PermissionService } = require('../src/permissions.cjs');
const { createRuntime } = require('../src/runtime.cjs');

// Retain the real runtime/owner boundary: future callback rewiring must preserve
// protected-title suppression, capture masking and policy checks after native work.
test('runtime routes protected observation and desktop capture through actual permission callbacks', async t => {
  const root = path.resolve(__dirname, '../artifacts/verification/unit');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'runtime-'));
  const self = 'C:\\WindowUse\\WindowUse.exe';
  const privateApp = 'C:\\Apps\\Private.exe';
  const permissions = new PermissionService({ directory, selfExecutables: [self] });
  const requests = [];
  let duringCapture = () => {};
  const window = (executable, hwnd, title) => ({ executable, hwnd, title, pid: 100 + Number(hwnd), processCreated: 'abc', minimized: false, widthPx: 440, heightPx: 640, dpi: 96 });
  const image = { redacted: true, originX: 0, originY: 0, maskedWindowCount: 2, widthPx: 100, heightPx: 100, image: { mimeType: 'image/png', data: 'aGVsbG8=' } };
  const backend = {
    async request(method, args) {
      requests.push({ method, args });
      if (method === 'listWindows') return [window(self, '1', 'Private approval request'), window(privateApp, '2', 'Private document'), window('C:\\Apps\\Editor.exe', '3', 'Public document')];
      if (method === 'captureDesktop') { duringCapture(); return image; }
      throw new Error(`Unexpected native operation: ${method}`);
    },
    async dispose() {}
  };
  const runtime = createRuntime({ directory, permissions, backend });
  t.after(async () => {
    try { await runtime.dispose(); } finally {
      permissions.dispose();
      fs.rmSync(directory, { recursive: true });
      assert.equal(fs.existsSync(directory), false);
    }
  });
  permissions.save({ protectedApps: [privateApp], mode: 'observe' });
  const context = await runtime.call('context', {});
  assert.equal(context.permissions.control, 'observe');
  assert.equal(context.permissions.desktopControlGranted, false);
  const list = await runtime.call('list_windows', {});
  assert.deepEqual(list.candidates.map(item => item.title), ['', '', 'Public document']);
  const capture = await runtime.call('capture_desktop', {});
  assert.equal(capture.redacted, true);
  assert.equal(typeof capture.observationId, 'string');
  assert.deepEqual(requests.find(item => item.method === 'captureDesktop').args.blockedApps, ['c:\\apps\\private.exe', 'c:\\windowuse\\windowuse.exe']);
  const before = requests.length;
  await assert.rejects(runtime.call('capture', { windowId: list.candidates[0].windowId }), { code: 'security_app_blocked', actionExecuted: false });
  assert.equal(requests.length, before, 'protected app must be rejected before native capture');

  // Policy changes while native capture is running cannot return an old image.
  duringCapture = () => permissions.save({ mode: 'ask' });
  await assert.rejects(runtime.call('capture_desktop', {}), { code: 'policy_changed', actionExecuted: false });
  duringCapture = () => {};
  const controller = new AbortController(); controller.abort();
  const cancelledBefore = requests.length;
  await assert.rejects(runtime.call('capture_desktop', {}, controller.signal), { code: 'cancelled', actionExecuted: false });
  assert.equal(requests.length, cancelledBefore);
  permissions.stop();
  await assert.rejects(runtime.call('list_windows', {}), { code: 'user_stopped', actionExecuted: false });
});

test('runtime desktop curve preserves fresh observation bounds, target resolution and permission guards',async t=>{
  const root=path.resolve(__dirname,'../artifacts/verification/unit');fs.mkdirSync(root,{recursive:true});
  const directory=fs.mkdtempSync(path.join(root,'runtime-curve-'));
  const permissions=new PermissionService({directory,selfExecutables:['C:\\WindowUse\\WindowUse.exe']});
  const target={executable:'C:\\Apps\\Editor.exe',hwnd:'1234',pid:123,processCreated:'abc',minimized:false,widthPx:200,heightPx:200,dpi:96};
  let resolved=target,revoke=false;
  const requests=[],delivered=[];
  const backend={async request(method,args){
    requests.push({method,args});
    if(method==='captureDesktop')return {redacted:true,originX:-50,originY:-20,maskedWindowCount:0,widthPx:200,heightPx:200,image:{mimeType:'image/png',data:'aGVsbG8='}};
    if(method==='windowAtPoint')return {window:resolved};
    throw Error('Unexpected curve fixture operation: '+method);
  },async dispose(){}};
  const switchedInput={async desktopInput(thread,window,packet,guard){
    await guard();delivered.push({window,packet});
    if(revoke)permissions.save({mode:'observe'});
    await guard();return {delivered:true};
  },async release(){},async dispose(){}};
  const runtime=createRuntime({directory,permissions,backend,switchedInput});
  t.after(async()=>{try{await runtime.dispose();}finally{permissions.dispose();fs.rmSync(directory,{recursive:true});assert.equal(fs.existsSync(directory),false);}});
  const approval=permissions.request(null,'desktop');permissions.respond(permissions.approvals().at(-1).id,'session');await approval;
  const points=[[-40,-10],[10,20],[100,120]],input={points,durationMs:600};
  await assert.rejects(runtime.call('desktop_input',{observationId:'unobserved',input}),{code:'state_changed'});
  assert.deepEqual(delivered,[]);
  let observation=await runtime.call('capture_desktop',{});
  await assert.rejects(runtime.call('desktop_input',{observationId:observation.observationId,input:{...input,points:[points[0],[150,30],points[2]]}}),{code:'invalid_request',message:'Screen coordinates are outside the desktop observation',actionExecuted:false});
  assert.deepEqual(delivered,[],'an invalid interior anchor must never reach the provider');
  requests.length=0;
  const result=await runtime.call('desktop_input',{observationId:observation.observationId,input});
  assert.equal(result.inputResult.delivered,true);
  assert.deepEqual(delivered,[{window:target,packet:{action:'drag',...input}}]);
  const resolutions=requests.filter(r=>r.method==='windowAtPoint');
  assert.ok(resolutions.length>=2,'target must be rechecked by runtime guard');
  assert.ok(resolutions.every(r=>r.args.x===-40&&r.args.y===-10));
  await assert.rejects(runtime.call('desktop_input',{observationId:observation.observationId,input}),{code:'state_changed'});
  assert.equal(delivered.length,1,'consumed observation cannot deliver again');
  observation=await runtime.call('capture_desktop',{});
  resolved={...target,executable:'C:\\WindowUse\\WindowUse.exe'};
  await assert.rejects(runtime.call('desktop_input',{observationId:observation.observationId,input}),{code:'security_app_blocked'});
  assert.equal(delivered.length,1);
  resolved=target;revoke=true;
  observation=await runtime.call('capture_desktop',{});
  await assert.rejects(runtime.call('desktop_input',{observationId:observation.observationId,input}),{code:'cancelled'});
});
