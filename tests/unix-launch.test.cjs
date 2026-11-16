'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {PassThrough}=require('node:stream');
const {unixDirectory,addressFor}=require('../src/service-registry.cjs');
const {createCandidate}=require('../src/service-candidate.cjs');
const {commandLauncher}=require('../scripts/package-unix.cjs');
const {run}=require('../src/unix-launcher.cjs');

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
test('Unix stdio bridge rejects unauthenticated output and removes invocation socket',{skip:process.platform==='win32'},async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'awu-test-'));
  const adapter=path.join(temp,'adapter.cjs'),addressRecord=path.join(temp,'address');
  try {
    await fs.writeFile(adapter,[
      "const net=require('node:net'),fs=require('node:fs');",
      "const address=process.argv[process.argv.indexOf('--mcp-pipe')+1];fs.writeFileSync(process.argv.at(-1),address);",
      "const bad=net.createConnection(address);bad.on('error',()=>{});bad.on('connect',()=>bad.end('x'.repeat(64)+'\\nINTRUDER'));",
      "bad.on('close',()=>{const good=net.createConnection(address);good.on('connect',()=>good.write(process.env.WINDOW_USE_PIPE_TOKEN+'\\n'));",
      "good.on('data',data=>good.write(data));good.on('end',()=>good.end());});"
    ].join('\n'));
    const input=new PassThrough(),output=new PassThrough();let actual='';
    output.on('data',chunk=>{actual+=chunk;});
    input.end('{"jsonrpc":"2.0","id":1}\n');
    await run({host:process.execPath,appRoot:adapter,args:[addressRecord],input,output,timeout:5000});
    assert.equal(actual,'{"jsonrpc":"2.0","id":1}\n');
    const address=await fs.readFile(addressRecord,'utf8');
    await assert.rejects(fs.stat(path.dirname(address)),{code:'ENOENT'});
  } finally {await fs.rm(temp,{recursive:true});}
});
