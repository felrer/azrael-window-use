'use strict';
// Retain: native backend changes must remain connected to the production MCP,
// permission owner and truthful capabilities rather than just pass helper tests.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const native=path.resolve(__dirname,'../artifacts/runtime/window-control');
test('native Unix runtime exposes real capabilities through SDK and keeps Stop enforced',{
 skip:!['darwin','linux'].includes(process.platform)||!fs.existsSync(path.join(native,'manifest.json')),timeout:30000
},async t=>{
 const {PermissionService}=require('../src/permissions.cjs'),{createRuntime}=require('../src/runtime.cjs');
 const {startMcp}=require('../src/mcp.cjs'),{Client}=require('@modelcontextprotocol/sdk/client/index.js');
 const {InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js');
 const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'awu-live-'));
 const permissions=new PermissionService({directory,selfExecutables:[process.execPath]});
 const runtime=createRuntime({runtimeDirectory:native,directory,permissions});
 const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
 const server=await startMcp({runtime,log:()=>{},transport:serverTransport});
 const client=new Client({name:'Native platform acceptance',version:'1'});
 t.after(async()=>{await client.close();await server.close();await runtime.dispose();permissions.dispose();fs.rmSync(directory,{recursive:true});assert.equal(fs.existsSync(directory),false);});
 await client.connect(clientTransport);
 const tools=await client.listTools();assert.equal(tools.tools.length,25);assert.ok(tools.tools.some(x=>x.name==='inspect'));
 const json=r=>JSON.parse(r.content.find(x=>x.type==='text').text);
 const response=await client.callTool({name:'context',arguments:{}});assert.ok(!response.isError,JSON.stringify(json(response)));
 const context=json(response);assert.equal(context.capabilities.desktopCapture,false);assert.equal(context.capabilities.desktopControl,false);assert.equal(context.capabilities.independentPointer,false);
 if(process.platform==='darwin'){
  assert.equal(context.capabilities.platform,'darwin');assert.equal(typeof context.capabilities.guiSessionAvailable,'boolean');
  if(!context.capabilities.guiSessionAvailable){const denied=await client.callTool({name:'list_windows',arguments:{}});assert.equal(denied.isError,true);assert.equal(json(denied).code,'permission_denied');assert.equal(json(denied).actionExecuted,false);}
 }
 permissions.stop();const stopped=await client.callTool({name:'list_windows',arguments:{}});assert.equal(json(stopped).code,'user_stopped');
 permissions.resume();const resumed=await client.callTool({name:'context',arguments:{}});assert.ok(!resumed.isError);
});
