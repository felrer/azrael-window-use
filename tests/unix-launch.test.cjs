'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {unixDirectory,addressFor}=require('../src/service-registry.cjs');
const {createCandidate}=require('../src/service-candidate.cjs');
const {commandLauncher}=require('../scripts/package-unix.cjs');

// Retained: platform edits must not restore Windows-only pointer inputs,
// merge separate desktop login sessions, or forward stdio before authentication.
test('Unix desktop scopes require login/display context and separate identities',()=>{
  const mac={platform:'darwin',uid:501,temporaryDirectory:os.tmpdir(),managerPid:'123'};
  assert.notEqual(unixDirectory(mac).directory,unixDirectory({...mac,managerPid:'124'}).directory);
  assert.notEqual(unixDirectory(mac).directory,unixDirectory({...mac,uid:502}).directory);
  assert.throws(()=>unixDirectory({...mac,managerPid:''}),{code:'desktop_scope_unavailable'});
  const linux={platform:'linux',uid:1000,env:{XDG_RUNTIME_DIR:path.resolve('runtime'),DISPLAY:':0',XDG_SESSION_ID:'1'}};
  assert.notEqual(unixDirectory(linux).directory,unixDirectory({...linux,env:{...linux.env,XDG_SESSION_ID:'2'}}).directory);
  assert.throws(()=>unixDirectory({...linux,env:{DISPLAY:':0'}}),{code:'desktop_scope_unavailable'});
  assert.throws(()=>unixDirectory({...linux,env:{XDG_RUNTIME_DIR:path.resolve('runtime')}}),{code:'desktop_scope_unavailable'});
  if(process.platform!=='win32')assert.notEqual(addressFor('/tmp/Case'),addressFor('/tmp/case'));
});
test('Unix candidate hashes window runtime without a multi-pointer sibling',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'awu-candidate-'));
  try {
    for(const directory of ['src','vendor/azrael','runtime/window-control'])await fs.mkdir(path.join(temp,directory),{recursive:true});
    await fs.writeFile(path.join(temp,'package.json'),JSON.stringify({version:'0.1.0'}));
    await fs.writeFile(path.join(temp,'runtime/window-control/helper'),'native');
    const candidate=createCandidate({executable:process.execPath,appRoot:temp,runtimeDirectory:path.join(temp,'runtime/window-control'),platform:'darwin'});
    assert.ok(candidate.files.some(file=>file.path===path.join(temp,'runtime/window-control/helper')));
    assert.ok(!candidate.files.some(file=>file.path.includes('multi-pointer')));
    assert.throws(()=>createCandidate({executable:process.execPath,appRoot:temp,runtimeDirectory:path.join(temp,'runtime/window-control'),platform:'win32'}),{code:'ENOENT'});
  } finally {await fs.rm(temp,{recursive:true});}
});
test('bundled command invokes Tauri CLI with stable macOS layout',()=>{
  const mac=commandLauncher('darwin');
  assert.ok(mac.includes('WindowUseHost.app/Contents/MacOS/azrael-window-use'));
  assert.ok(!mac.includes('ELECTRON_RUN_AS_NODE'));
  assert.ok(!mac.includes('exec node'));
  assert.ok(commandLauncher('linux').includes('exec "$base/WindowUseMCP"'));
});
