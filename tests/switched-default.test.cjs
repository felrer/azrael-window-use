'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {createSwitchedInputProvider,validateInput,validateDesktopInput,switchedInputSchema,desktopInputSchema}=require('../vendor/azrael/window-switched-input.cjs');
const native=require('../vendor/azrael/multi-pointer-mcp.cjs');
const {switchedMetadata}=require('../vendor/azrael/window-control-errors.cjs');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const target={hwnd:'1234',pid:123,processCreated:'abcd',executable:'C:\\Fixture\\fixture.exe'};
function fixture(t) {
  const root=path.resolve(__dirname,'../artifacts/verification/unit');fs.mkdirSync(root,{recursive:true});
  const directory=fs.mkdtempSync(path.join(root,'default-mode-')),runtime=path.join(directory,'runtime');fs.mkdirSync(runtime);
  const files=['azrael-multi-pointer.exe','THIRD_PARTY_NOTICES.md'].map(name=>{const bytes=Buffer.from('non-executable test fixture '+name);fs.writeFileSync(path.join(runtime,name),bytes);return {path:name,bytes:bytes.length,sha256:sha(bytes)};});
  const manifest=JSON.stringify({schema:1,kind:'azrael-multi-pointer',platform:'win32',arch:'x64',sourceSha256:'b'.repeat(64),files});
  fs.writeFileSync(path.join(runtime,'manifest.json'),manifest);
  const calls=[];let failure,response={},failurePartial={};
  const provider=createSwitchedInputProvider({directory:runtime,manifestSha256:sha(manifest),modulePath:path.resolve(__dirname,'../vendor/azrael/multi-pointer-mcp.cjs')},{stateDirectory:path.join(directory,'state'),platform:'win32',arch:'x64',createNativeBroker:()=>({
    async call(method,args){calls.push({method,args});if(failure===method){failure=undefined;throw Object.assign(Error('fixture failure'),{details:{code:'collaboration_failed',actionExecuted:false,partial:failurePartial}});}return response;},
    async close(){return {terminationVerified:true,exitCode:0,signal:null};}
  })});
  t.after(async()=>{await provider.dispose();fs.rmSync(directory,{recursive:true});assert.equal(fs.existsSync(directory),false);});
  return {provider,calls,failNext:(method,partial={})=>{failure=method;failurePartial=partial;},respond:value=>response=value};
}
test('real sessions enable virtualization by default, including after release',async t=>{
  const {provider,calls}=fixture(t);
  await provider.input('thread',target,{action:'status'});
  assert.deepEqual(calls,[{method:'collaboration',args:{enabled:true}},{method:'status',args:{}}]);
  await provider.release('thread');calls.length=0;
  await provider.desktopInput('thread',target,{action:'status',x:10,y:20});
  assert.deepEqual(calls,[{method:'collaboration',args:{enabled:true}},{method:'status',args:{}}]);
});
test('cosmetic sessions do not enable interception, first real request does',async t=>{
  const {provider,calls}=fixture(t);
  await provider.visualize('thread',target,{x:10,y:20,phase:'idle'});
  assert.deepEqual(calls.map(c=>c.method),['create_pointer','present_pointer']);
  calls.length=0;await provider.input('thread',target,{action:'status'});
  assert.deepEqual(calls.map(c=>c.method),['collaboration','status']);
});
test('first click enables virtualization before pointer creation and respects a revoked guard',async t=>{
  const {provider,calls}=fixture(t);
  await assert.rejects(provider.input('blocked',target,{action:'click',button:'left',x:10,y:20},async()=>{throw Object.assign(Error('revoked'),{code:'permission_denied'});}),{code:'permission_denied'});
  assert.deepEqual(calls,[]);
  await provider.input('thread',target,{action:'click',button:'left',x:10,y:20});
  assert.deepEqual(calls.map(c=>c.method),['collaboration','create_pointer','click']);
  assert.equal(calls[0].args.enabled,true);
});
test('explicit opt-out lasts for the session; a replacement session gets the default',async t=>{
  const {provider,calls}=fixture(t);
  await provider.input('thread',target,{action:'collaboration',enabled:false});
  await provider.input('thread',target,{action:'move',x:10,y:20});
  assert.deepEqual(calls.map(c=>c.method),['collaboration','create_pointer','move']);
  assert.equal(calls[0].args.enabled,false);
  await provider.release('thread');calls.length=0;await provider.input('thread',target,{action:'status'});
  assert.equal(calls[0].args.enabled,true);
});
test('failed initialization sends no pointer action and next session requests the default',async t=>{
  const {provider,calls,failNext}=fixture(t);failNext('collaboration');
  await assert.rejects(provider.input('thread',target,{action:'click',button:'left',x:10,y:20}),{code:'state_changed'});
  assert.deepEqual(calls.map(c=>c.method),['collaboration']);
  calls.length=0;await provider.input('thread',target,{action:'status'});
  assert.deepEqual(calls.map(c=>c.method),['collaboration','status']);
});
// Retain these cases: nested tail validation and partial-result projection are
// easy to omit when adding another action to the shared public input schema.
test('batch schema validates every strict step before any broker mutation',async t=>{
  const {provider,calls}=fixture(t);
  const base={action:'batch',x:10,y:20,steps:[{action:'click',button:'left'},{action:'press',keys:[162,65]}]};
  assert.ok(switchedInputSchema().oneOf.some(s=>s.properties.action.enum.includes('batch')));
  assert.ok(desktopInputSchema().oneOf.some(s=>s.properties.action.enum.includes('batch')));
  const tails=[{action:'click',button:'left',x:1},{action:'click',button:'left',operationId:3},
    {action:'text',text:'x',pointerId:'other'},{action:'batch',steps:[]},{action:'press',keys:[65,65]},
    {action:'press',keys:[7]},{action:'press',keys:[65],targetId:'other'},{action:'click',x:1,y:2},null];
  for(const tail of tails)await assert.rejects(provider.input('thread',target,{...base,steps:[...base.steps,tail]}),{code:'invalid_request'});
  for(const invalid of [{...base,steps:[]},{...base,steps:Array(17).fill(base.steps[0])},{...base,maxMs:99},{...base,maxMs:1001},{...base,maxMs:750.5},
    {...base,steps:[{action:'text',text:'a'.repeat(1024)},{action:'text',text:'b'}]}, {...base,steps:[{action:'text',text:'😀'.repeat(513)}]}])
    await assert.rejects(provider.input('thread',target,invalid),{code:'invalid_request'});
  assert.deepEqual(calls,[]);
  assert.deepEqual(validateInput(base),base);
  assert.deepEqual(native.validateArguments(native.toolDefinitions().find(d=>d.name==='press'),{pointerId:'model',keys:[162,65]}).keys,[162,65]);
});
test('batch is one native operation with intact steps, identity and post-call guard',async t=>{
  const {provider,calls}=fixture(t),steps=[{action:'click',button:'right',x:31,y:42},{action:'text',text:'hello'},{action:'press',keys:[13]}];
  let checks=0;
  await provider.input('thread',target,{action:'batch',x:10,y:20,steps,maxMs:900,operationId:41},async()=>{checks++;});
  assert.deepEqual(calls.map(c=>c.method),['collaboration','create_pointer','batch']);
  assert.deepEqual(calls.at(-1).args,{steps,maxMs:900,operationId:41,pointerId:'model'});
  assert.equal(checks,7);
  calls.length=0;
  await provider.input('thread',target,{action:'batch',steps});
  assert.deepEqual(calls,[{method:'batch',args:{steps,pointerId:'model',operationId:42}}]);
});
test('desktop batch pins only its selected initial target before one native batch',async t=>{
  const {provider,calls}=fixture(t),steps=[{action:'click',button:'left',x:30,y:40},{action:'text',text:'ok'}];
  await provider.desktopInput('thread',target,{action:'batch',x:10,y:20,steps});
  assert.deepEqual(calls.map(c=>c.method),['collaboration','create_pointer','desktop_target','batch']);
  assert.deepEqual(calls.at(-1).args,{steps,operationId:1,pointerId:'model'});
  assert.equal(calls.filter(c=>c.method==='desktop_target').length,1);
});
test('batch completion still requires the post-call authorization guard',async t=>{
  const {provider,calls}=fixture(t);
  await assert.rejects(provider.input('thread',target,{action:'batch',x:10,y:20,steps:[{action:'press',keys:[13]}]},async()=>{
    if(calls.at(-1)?.method==='batch')throw Object.assign(Error('revoked after delivery'),{code:'permission_denied'});
  }),{code:'permission_denied'});
  assert.equal(calls.filter(c=>c.method==='batch').length,1);
});
test('batch and keyboard reservation metadata exclude input content on success and partial error',async t=>{
  const {provider,respond,failNext}=fixture(t);
  const unsafe={batch:{completedSteps:1,failedStep:1,totalSteps:2,completed:false,budgetMs:750,steps:[{text:'secret'}]},
    keyboardReservation:{active:false,bufferedEvents:2,replayedEvents:2,restored:true,pending:false,failure:'none',keys:[65],text:'secret'}};
  const safe={batch:{completedSteps:1,failedStep:1,totalSteps:2,budgetMs:750,completed:false},
    keyboardReservation:{bufferedEvents:2,replayedEvents:2,active:false,restored:true,pending:false,failure:'none'}};
  assert.deepEqual(switchedMetadata(unsafe),safe);
  respond(unsafe);
  const result=await provider.input('thread',target,{action:'batch',x:10,y:20,steps:[{action:'text',text:'secret'}]});
  assert.deepEqual(result.batch,safe.batch);assert.deepEqual(result.keyboardReservation,safe.keyboardReservation);
  failNext('batch',unsafe);
  await assert.rejects(provider.input('thread',target,{action:'batch',steps:[{action:'press',keys:[13]}]}),error=>{
    assert.deepEqual(error.switchedInputDetails,safe);assert.ok(!JSON.stringify(error.switchedInputDetails).includes('secret'));return true;
  });
});
// Retained to prevent path-shape validation and initial-point forwarding omissions.
test('curved drag validates complete pair paths and excludes mixed coordinate forms before native calls',async t=>{
  const {provider,calls}=fixture(t),points=[[10,20],[30,40],[50,60]];
  assert.deepEqual(validateInput({action:'drag',points}),{action:'drag',points});
  assert.deepEqual(validateDesktopInput({action:'drag',points}),{action:'drag',points});
  for(const schema of [switchedInputSchema(),desktopInputSchema()])
    assert.deepEqual(native.validateArguments({inputSchema:schema},{action:'drag',points}),{action:'drag',points});
  const badPaths=[[],[[1,2]],Array(33).fill([1,2]),[[1,2],[3]],[[1,2],[3,4,5]],[[1,2],null],[[1,2],{x:3,y:4}],[[1,2],[3.5,4]],[[1,2],[100001,4]],[[1,2],[3,'4']]];
  for(const pathPoints of badPaths)await assert.rejects(provider.input('thread',target,{action:'drag',points:pathPoints}),{code:'invalid_request'});
  for(const extra of [{x:1},{y:2},{x:1,y:2},{fromX:1},{fromY:2},{fromX:1,fromY:2}]) {
    await assert.rejects(provider.input('thread',target,{action:'drag',points,...extra}),{code:'invalid_request'});
    await assert.rejects(provider.desktopInput('thread',target,{action:'drag',points,...extra}),{code:'invalid_request'});
    for(const schema of [switchedInputSchema(),desktopInputSchema()])
      assert.throws(()=>native.validateArguments({inputSchema:schema},{action:'drag',points,...extra}));
  }
  assert.deepEqual(calls,[]);
});
test('curved drag initializes and pins its explicit first point then forwards one intact native drag',async t=>{
  const {provider,calls}=fixture(t),points=[[10,20],[35,25],[50,60]];
  await provider.input('thread',target,{action:'drag',points,durationMs:800});
  assert.deepEqual(calls.map(c=>c.method),['collaboration','create_pointer','drag']);
  assert.deepEqual(calls[1].args,{pointerId:'model',targetId:'selected',x:10,y:20});
  assert.deepEqual(calls[2].args,{points,durationMs:800,operationId:1,pointerId:'model'});
  calls.length=0;
  const next=[[70,80],[90,100]];
  await provider.input('thread',target,{action:'drag',points:next});
  assert.deepEqual(calls,[{method:'drag',args:{points:next,operationId:2,pointerId:'model'}}]);
  calls.length=0;
  await provider.desktopInput('desktop',target,{action:'drag',points});
  assert.deepEqual(calls.map(c=>c.method),['collaboration','create_pointer','desktop_target','drag']);
  assert.equal(calls[1].args.x,10);assert.equal(calls[1].args.y,20);
  assert.equal(calls[2].args.x,10);assert.equal(calls[2].args.y,20);
  assert.deepEqual(calls[3].args,{points,operationId:1,pointerId:'model'});
  assert.deepEqual(validateInput({action:'drag',x:30,y:40}),{action:'drag',x:30,y:40});
  assert.deepEqual(validateDesktopInput({action:'drag',x:30,y:40,fromX:10,fromY:20}),{action:'drag',x:30,y:40,fromX:10,fromY:20});
});
