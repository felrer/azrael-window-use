'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PassThrough}=require('node:stream');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createHostTransport}=require('../src/host-transport.cjs');
const {verifyDependencies}=require('../src/dependency-integrity.cjs');
const {createCandidate}=require('../src/service-candidate.cjs');
test('private host boundary validates views, exact envelopes, native replies and EOF',async()=>{
 const input=new PassThrough(),output=new PassThrough(),messages=[];output.on('data',d=>messages.push(...d.toString().trim().split('\n').map(JSON.parse)));let disconnected=0,calls=0;
 const host=createHostTransport({input,output,receive:async()=>{calls++;return {ok:true};},onDisconnect:()=>disconnected++});
 input.write(JSON.stringify({id:1,method:'snapshot',view:'settings',params:{}})+'\n');
 input.write(JSON.stringify({id:2,method:'command',view:'rogue',params:{}})+'\n');
 input.write(JSON.stringify({id:3,method:'snapshot',view:'approval',params:{extra:true}})+'\n');
 await new Promise(setImmediate);assert.equal(calls,1);assert.equal(messages.find(m=>m.id===2).error.code,'invalid_arguments');assert.equal(messages.find(m=>m.id===3).error.code,'invalid_arguments');
 const icon=host.native('getFileIcon',{executable:'/fixture'});const request=messages.find(m=>m.event==='nativeRequest');input.write(JSON.stringify({nativeResponse:request.id,result:null})+'\n');assert.equal(await icon,null);
 const pending=host.native('pickApp',{},'settings');input.end();await assert.rejects(pending,{code:'host_closed'});assert.equal(disconnected,1);
});
test('dependency closure rejects changed, missing, additional, escaped and duplicate files',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'window-use-integrity-'));try{
 await fs.mkdir(path.join(root,'node_modules'));await fs.writeFile(path.join(root,'node_modules/a.js'),'a');const entry={path:'a.js',bytes:1,sha256:crypto.createHash('sha256').update('a').digest('hex')};const write=files=>fs.writeFile(path.join(root,'dependencies.sha256.json'),JSON.stringify({schema:1,files}));await write([entry]);verifyDependencies(root);
 await fs.writeFile(path.join(root,'node_modules/b.js'),'b');assert.throws(()=>verifyDependencies(root),/Unlisted/);await fs.unlink(path.join(root,'node_modules/b.js'));
 await fs.writeFile(path.join(root,'node_modules/a.js'),'b');assert.throws(()=>verifyDependencies(root),/changed/);await fs.writeFile(path.join(root,'node_modules/a.js'),'a');
 await write([entry,entry]);assert.throws(()=>verifyDependencies(root),/identity/);await write([{...entry,path:'../a.js'}]);assert.throws(()=>verifyDependencies(root),/identity/);
 await write([entry]);await fs.unlink(path.join(root,'node_modules/a.js'));assert.throws(()=>verifyDependencies(root),/Missing/);
 }finally{await fs.rm(root,{recursive:true});}
});
test('candidate binds Rust executable, Node runtime and complete source inventory',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'window-use-candidate-'));try{for(const d of ['src','vendor','runtime'])await fs.mkdir(path.join(root,d));await fs.writeFile(path.join(root,'package.json'),'{"version":"1.0.0"}');for(const f of ['src/main.cjs','vendor/engine.cjs','runtime/engine','host','node'])await fs.writeFile(path.join(root,f),f);
 assert.throws(()=>createCandidate({packaged:true,appRoot:root,executable:path.join(root,'host'),node:path.join(root,'node')}),/ENOENT/);
 const options={appRoot:root,executable:path.join(root,'host'),node:path.join(root,'node'),runtimeDirectory:path.join(root,'runtime'),platform:'linux'};const candidate=createCandidate(options);assert.deepEqual(candidate.args,['--shared-service','--runtime-directory',options.runtimeDirectory]);assert(candidate.files.some(f=>f.path===options.node));assert(candidate.files.some(f=>f.path===path.join(root,'src/main.cjs')));await fs.writeFile(options.node,'changed');assert.notEqual(createCandidate(options).id,candidate.id);
 }finally{await fs.rm(root,{recursive:true});}
});
test('Tauri worker action checks preserve settings and approval authority without native input',async()=>{
 const {spawn}=require('node:child_process');const root=await fs.mkdtemp(path.join(os.tmpdir(),'window-use-worker-'));let child;try{
 await fs.cp(path.resolve(__dirname,'../src'),path.join(root,'src'),{recursive:true});await fs.cp(path.resolve(__dirname,'../vendor'),path.join(root,'vendor'),{recursive:true});await fs.copyFile(path.resolve(__dirname,'../package.json'),path.join(root,'package.json'));
 const runtime=path.join(root,'runtime');await fs.mkdir(runtime);await fs.mkdir(path.join(root,'multi-pointer'));await fs.writeFile(path.join(runtime,'fixture'),'fixture');
 child=spawn(process.execPath,[path.join(root,'src/main.cjs'),'--host-worker','--shared-service','--user-data-dir',root,'--runtime-directory',runtime],{env:{...process.env,AZ_WINDOW_USE_PACKAGED:'0',AZ_WINDOW_USE_HOST_EXECUTABLE:process.execPath,AZ_WINDOW_USE_NODE:process.execPath,AZ_WINDOW_USE_SHARED_DIRECTORY:path.join(root,'shared')},stdio:['pipe','pipe','pipe']});let buffer='',stderr='';const pending=new Map();child.stderr.on('data',d=>stderr+=d);child.stdout.on('data',d=>{buffer+=d;let at;while((at=buffer.indexOf('\n'))>=0){const value=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);if(value.event==='nativeRequest'){assert.equal(value.method,'pickApp');assert.equal(value.view,'settings');child.stdin.write(JSON.stringify({nativeResponse:value.id,result:null})+'\n');}if(pending.has(value.id)){pending.get(value.id)(value);pending.delete(value.id);}}});let next=0;
 const request=(view,method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>reject(Error('Worker timeout '+stderr)),10000);pending.set(id,value=>{clearTimeout(timer);resolve(value);});child.stdin.write(JSON.stringify({id,view,method,params})+'\n');});
 // First request can arrive before async service startup completes; policy already exists.
 const snap=await request('settings','snapshot');assert(snap.result.settings.protectedApps.length>=1);
 assert.equal((await request('settings','command',{action:'addAllowedApp',payload:{}})).result.view,'settings');
 assert.equal((await request('approval','command',{action:'setMode',payload:{mode:'full'}})).error.code,'permission_denied');
 assert.equal((await request('settings','command',{action:'respondApproval',payload:{id:'expired',decision:'allow'}})).error.code,'permission_denied');
 assert.equal((await request('settings','command',{action:'setEnabled',payload:{enabled:false,extra:true}})).error.code,'invalid_arguments');
 assert.equal((await request('settings','command',{action:'removeProtectedApp',payload:{executable:process.execPath}})).error.code,'security_app_blocked');
 await request('settings','stop');assert.equal((await request('settings','snapshot')).result.connection.stopped,true);
 const exited=new Promise(resolve=>child.once('exit',(code)=>resolve(code)));child.stdin.end();assert.equal(await exited,0,stderr);
 }finally{if(child&&child.exitCode===null){const ended=new Promise(resolve=>child.once('exit',resolve));child.kill();await ended;}await fs.rm(root,{recursive:true});}
});

const testHost=process.env.AZ_WINDOW_USE_TEST_HOST;
if(testHost&&!path.isAbsolute(testHost))throw Error('Absolute AZ_WINDOW_USE_TEST_HOST required');
test((testHost?'compiled Rust host':'plain Node')+' --mcp uses SDK stdio exclusively and closes its shared session on EOF',async()=>{
 const {spawn}=require('node:child_process'),{createSharedService}=require('../src/shared-service.cjs');const root=await fs.mkdtemp(path.join(os.tmpdir(),'window-use-stdio-'));let child,service;try{
 const runtime=path.join(root,'runtime');await fs.mkdir(runtime);await fs.mkdir(path.join(root,'multi-pointer'));await fs.writeFile(path.join(runtime,'fixture'),'fixture');
 const appRoot=testHost&&process.env.AZ_WINDOW_USE_DEV_ROOT||path.resolve(__dirname,'..'),executable=testHost||process.execPath;
 const resources=testHost&&process.env.AZ_WINDOW_USE_RESOURCES||path.join(appRoot,'artifacts/tauri-resources');
 assert(path.isAbsolute(appRoot)&&path.isAbsolute(resources));
 const candidate={id:'stdio-fixture',version:require(path.join(appRoot,'package.json')).version,protocol:1,schema:1,executable:process.execPath,args:[],files:[{path:path.join(runtime,'fixture'),sha256:crypto.createHash('sha256').update('fixture').digest('hex')}]};
 service=await createSharedService({directory:path.join(root,'shared'),candidate,createSession:()=>({call:async()=>({ok:true}),dispose:async()=>{}})});
 const args=[...(!testHost?[path.join(appRoot,'src/main.cjs')]:[]),'--mcp','--user-data-dir',root,'--runtime-directory',runtime];
 child=spawn(executable,args,{env:{...process.env,AZ_WINDOW_USE_PACKAGED:'0',AZ_WINDOW_USE_DEV_ROOT:appRoot,AZ_WINDOW_USE_RESOURCES:resources,AZ_WINDOW_USE_HOST_EXECUTABLE:executable,AZ_WINDOW_USE_NODE:process.execPath,AZ_WINDOW_USE_SHARED_DIRECTORY:path.join(root,'shared')},stdio:['pipe','pipe','pipe']});let buffer='',stderr='';const pending=new Map();child.stderr.on('data',d=>stderr+=d);child.stdout.on('data',d=>{buffer+=d;let at;while((at=buffer.indexOf('\n'))>=0){const value=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);assert.equal(value.event,undefined);if(pending.has(value.id)){pending.get(value.id)(value);pending.delete(value.id);}}});
 const request=(id,method,params)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('MCP '+method+' timeout (resident version '+candidate.version+') '+stderr)),10000);pending.set(id,value=>{clearTimeout(timer);resolve(value);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 const initialized=await request(1,'initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'fixture',version:'1'}});assert.equal(initialized.result.serverInfo.name,'az_window_use');assert.equal(initialized.result.serverInfo.version,require('../package.json').version);child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');const tools=await request(2,'tools/list',{});assert(tools.result.tools.length>0);
 const exited=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('MCP EOF did not close '+stderr)),10000);child.once('exit',code=>{clearTimeout(timer);resolve(code);});});child.stdin.end();assert.equal(await exited,0,stderr);
 }finally{if(child&&child.exitCode===null){const ended=new Promise(resolve=>child.once('exit',resolve));child.kill();await ended;}await service?.close();await fs.rm(root,{recursive:true});}
});
