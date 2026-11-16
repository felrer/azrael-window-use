'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {targetLayout,parseArguments,checkedNode,checkedBinary}=require('../scripts/package.cjs');
const {launchOptions}=require('../scripts/launch.cjs');
// Retained: changing a portable layout or runtime selection must update every
// launcher and downstream consumer together; never accept an ambient Node.
test('portable layouts expose explicit Tauri host and resource entry points',()=>{
 assert.deepEqual(targetLayout('win32','x64'),{platform:'win32',arch:'x64',payloadDirectory:'WindowUseMCP-win32-x64',executable:'WindowUseMCP.exe',resourceDirectory:'resources'});
 assert.equal(targetLayout('darwin','arm64').executable,'WindowUseHost.app/Contents/MacOS/azrael-window-use');
 assert.equal(targetLayout('linux','x64').executable,'WindowUseMCP');
 assert.throws(()=>targetLayout('darwin','x64'),/Unsupported packaging target/);
 assert.throws(()=>parseArguments(['--prepare','--node','node']),/absolute path/);
 assert.throws(()=>parseArguments(['--unknown']),/Usage/);
 assert.equal(checkedNode(process.execPath,targetLayout()).version,process.version);
 assert.throws(()=>checkedBinary(__filename,targetLayout()),/header/);
});
test('development launcher forwards stdio arguments with explicit resources and runtime',()=>{
 const environment={AZ_WINDOW_USE_HOST_EXECUTABLE:process.execPath,AZ_WINDOW_USE_NODE:process.execPath,AZ_WINDOW_USE_PACKAGED:'1',NODE_OPTIONS:'--inspect',NODE_PATH:'external'};
 const spec=launchOptions(['--mcp','--user-data-dir',path.resolve('profile')],environment);
 assert.equal(spec.executable,process.execPath);
 assert.deepEqual(spec.args,['--mcp','--user-data-dir',path.resolve('profile')]);
 assert.equal(spec.options.stdio,'inherit');
 assert.equal(spec.options.env.AZ_WINDOW_USE_DEV_ROOT,path.resolve(__dirname,'..'));
 assert.equal(spec.options.env.AZ_WINDOW_USE_RESOURCES,path.resolve(__dirname,'../artifacts/tauri-resources'));
 assert.equal(spec.options.env.AZ_WINDOW_USE_PACKAGED,undefined);
 assert.equal(spec.options.env.NODE_OPTIONS,undefined);assert.equal(spec.options.env.NODE_PATH,undefined);
});
test('dependency manifests and lock contain no retired desktop runtime tooling',()=>{
 for(const file of ['package.json','package-lock.json']){
  const data=JSON.parse(fs.readFileSync(path.join(__dirname,'..',file)));
  for(const name of Object.keys(data.packages||data.devDependencies||{}))assert.ok(!/(^|\/)@?electron(?:\/|$)/.test(name),name);
 }
});
