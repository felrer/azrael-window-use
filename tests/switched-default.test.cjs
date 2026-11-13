'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {createSwitchedInputProvider}=require('../vendor/azrael/window-switched-input.cjs');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const target={hwnd:'1234',pid:123,processCreated:'abcd',executable:'C:\\Fixture\\fixture.exe'};
function fixture(t) {
  const root=path.resolve(__dirname,'../artifacts/verification/unit');fs.mkdirSync(root,{recursive:true});
  const directory=fs.mkdtempSync(path.join(root,'default-mode-')),runtime=path.join(directory,'runtime');fs.mkdirSync(runtime);
  const files=['azrael-multi-pointer.exe','THIRD_PARTY_NOTICES.md'].map(name=>{const bytes=Buffer.from('non-executable test fixture '+name);fs.writeFileSync(path.join(runtime,name),bytes);return {path:name,bytes:bytes.length,sha256:sha(bytes)};});
  const manifest=JSON.stringify({schema:1,kind:'azrael-multi-pointer',platform:'win32',arch:'x64',sourceSha256:'b'.repeat(64),files});
  fs.writeFileSync(path.join(runtime,'manifest.json'),manifest);
  const calls=[];let failure;
  const provider=createSwitchedInputProvider({directory:runtime,manifestSha256:sha(manifest),modulePath:path.resolve(__dirname,'../vendor/azrael/multi-pointer-mcp.cjs')},{stateDirectory:path.join(directory,'state'),platform:'win32',arch:'x64',createNativeBroker:()=>({
    async call(method,args){calls.push({method,args});if(failure===method){failure=undefined;throw Object.assign(Error('fixture failure'),{details:{code:'collaboration_failed',actionExecuted:false,partial:{}}});}return {};},
    async close(){return {terminationVerified:true,exitCode:0,signal:null};}
  })});
  t.after(async()=>{await provider.dispose();fs.rmSync(directory,{recursive:true});assert.equal(fs.existsSync(directory),false);});
  return {provider,calls,failNext:method=>failure=method};
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
