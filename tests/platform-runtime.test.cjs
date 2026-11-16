'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {normalizeExecutable}=require('../src/platform-paths.cjs');
const {verifyPlatformRuntime}=require('../src/platform-backend.cjs');
test('Unix executable identities preserve case and reject nonabsolute or control paths',()=>{
 assert.equal(normalizeExecutable('/Applications/Agent.app/Contents/MacOS/Agent','darwin'),'/Applications/Agent.app/Contents/MacOS/Agent');
 assert.notEqual(normalizeExecutable('/opt/Agent','linux'),normalizeExecutable('/opt/agent','linux'));
 for(const value of ['relative','/tmp/x\n','/tmp/*'])assert.throws(()=>normalizeExecutable(value,'linux'));
 const values=process.platform==='win32'?['C:\\Apps\\A.exe','C:\\Apps\\B.exe']:['/opt/A','/opt/B'];assert.equal(values.map(normalizeExecutable).length,2);
});
test('native runtime rejects changed bytes, wrong platform and unrecorded files',()=>{
 const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'azwu-platform-'));
 try{const data=Buffer.from('fixture helper');fs.writeFileSync(path.join(dir,'helper'),data,{mode:0o700});
  const manifest={schema:1,kind:'azrael-window-control',platform:'darwin',arch:'arm64',entry:'helper',files:[{path:'helper',bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')}]};
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest));
  assert.equal(verifyPlatformRuntime(dir,{platform:'darwin',arch:'arm64'}).manifest.entry,'helper');
  assert.throws(()=>verifyPlatformRuntime(dir,{platform:'linux',arch:'arm64'}));
  fs.writeFileSync(path.join(dir,'extra'),'x');assert.throws(()=>verifyPlatformRuntime(dir,{platform:'darwin',arch:'arm64'}));fs.unlinkSync(path.join(dir,'extra'));
  fs.appendFileSync(path.join(dir,'helper'),'x');assert.throws(()=>verifyPlatformRuntime(dir,{platform:'darwin',arch:'arm64'}));
 }finally{fs.rmSync(dir,{recursive:true});assert.equal(fs.existsSync(dir),false);}
});
