'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {normalizeInput,inputSchema}=require('../vendor/azrael/window-input-coordinates.cjs');
const {createRuntime}=require('../src/runtime.cjs');
const {PermissionService}=require('../src/permissions.cjs');
// Retained: public schema forwarding and later guard rewiring must not silently
// reintroduce screen coordinates into the image-coordinate path or stale delivery.
test('public points contract distinguishes click/drag and rejects ambiguous legacy forms',()=>{
  assert.deepEqual(normalizeInput({points:[[2,3]]}),{action:'click',button:'left',x:2,y:3});
  assert.deepEqual(normalizeInput({points:[[2,3],[4,5]],durationMs:600}),{action:'drag',points:[[2,3],[4,5]],durationMs:600});
  assert.deepEqual(normalizeInput({points:[[2,3],[4,8],[9,5]]}).points,[[2,3],[4,8],[9,5]]);
  for(const input of [{points:[]},{points:[[1,2]],durationMs:300},{points:[[1,2],[1,2]]},{points:[[1,2],[3,4]],button:'right'},{action:'move',points:[[1,2]]},{action:'click',x:1,y:2},{action:'drag',points:[[1,2],[3,4]]},{points:[[1,2],[3,4]],x:1},{points:[[1.5,2]]},{points:[[-1,2]]}])assert.throws(()=>normalizeInput(input),{code:'invalid_request'});
  assert.equal(normalizeInput({points:[[-1,2]]},true).x,-1);
  const defs=require('../vendor/azrael/window-control-mcp.cjs').toolDefinitions();
  assert.equal(defs.find(x=>x.name==='capture').inputSchema.properties.includeUIA.default,false);
  for(const [name,desktop]of [['switched_input',false],['desktop_input',true]])assert.deepEqual(defs.find(x=>x.name===name).inputSchema.properties.input,inputSchema(desktop));
});
test('runtime converts capture image coordinates once, including batch steps, and rejects stale geometry before input',async t=>{
  const root=path.resolve(__dirname,'../artifacts/verification/unit');fs.mkdirSync(root,{recursive:true});
  const directory=fs.mkdtempSync(path.join(root,'image-input-'));
  const permissions=new PermissionService({directory,selfExecutables:['C:\\WindowUse\\WindowUse.exe']});permissions.save({mode:'full'});
  const window={hwnd:'1234',pid:100,processCreated:'abcd',executable:'C:\\Apps\\Editor.exe',title:'fixture',minimized:false,widthPx:208,heightPx:160,dpi:144};
  let geometry={originX:-300,originY:220,widthPx:200,heightPx:150,dpi:144},sequence=0;
  const delivered=[];
  const observations=[];let failObservation=false;
  const backend={async request(method,args){
    if(method==='listWindows')return [window];
    if(method==='status')return {window,captureGeometry:{...geometry}};
    if(method==='observe'){if(failObservation)throw Error('capture fixture failure');observations.push(args);return {window,observationId:'image-'+(++sequence),frameTimestamp:String(sequence),widthPx:geometry.widthPx,heightPx:geometry.heightPx,dpi:geometry.dpi,captureGeometry:{...geometry},elements:args.includeUIA?[{id:'button',name:'Save',controlType:'Button'}]:[],elementsTruncated:false,retrieval:{coverage:args.includeUIA?'complete':'image-only'},image:{mimeType:'image/png',data:'aGVsbG8='}};}
    if(method==='act'){assert.equal(args.elementId,'button');return {window};}
    throw Error('Unexpected backend call '+method);
  },async dispose(){}};
  const input={async input(thread,target,packet,guard){await guard();delivered.push(packet);await guard();return {delivered:true};},async release(){},async dispose(){}};
  const runtime=createRuntime({directory,permissions,backend,switchedInput:input});
  t.after(async()=>{await runtime.dispose();permissions.dispose();fs.rmSync(directory,{recursive:true});assert.equal(fs.existsSync(directory),false);});
  const windowId=(await runtime.call('list_windows',{})).candidates[0].windowId;
  const capture=()=>runtime.call('capture',{windowId});
  const send=(o,input)=>runtime.call('switched_input',{windowId,observationId:o.observationId,input});
  let o=await capture();assert.deepEqual(o.coordinateSpace.screenBounds,geometry);assert.equal(o.coordinateSpace.originX,0);
  assert.equal(Object.hasOwn(observations.at(-1),'includeUIA'),false);assert.deepEqual(o.elements,[]);
  await assert.rejects(runtime.call('capture',{windowId,includeUIA:'true'}),{code:'invalid_request'});
  const wire=require('../vendor/azrael/window-control-mcp.cjs').callResult(o);
  assert.deepEqual(JSON.parse(wire.content.find(x=>x.type==='text').text).coordinateSpace,o.coordinateSpace);
  await send(o,{points:[[10,20]]});assert.deepEqual(delivered[0],{action:'click',button:'left',x:-290,y:240});
  await assert.rejects(send(o,{points:[[10,20]]}),{code:'state_changed'});
  o=await capture();await send(o,{points:[[10,20],[100,80]],durationMs:500});assert.deepEqual(delivered[1],{action:'drag',points:[[-290,240],[-200,300]],durationMs:500});
  o=await capture();await send(o,{action:'batch',points:[[10,20]],steps:[{action:'click',points:[[30,40]],button:'left'},{action:'text',text:'ok'}]});
  assert.deepEqual(delivered[2],{action:'batch',x:-290,y:240,steps:[{action:'click',x:-270,y:260,button:'left'},{action:'text',text:'ok'}]});
  o=await capture();await assert.rejects(send(o,{points:[[200,0]]}),{code:'invalid_request',actionExecuted:false});assert.equal(delivered.length,3);
  for(const change of [{originX:-280},{widthPx:201},{dpi:192}]) {
    o=await capture();geometry={...geometry,...change};await assert.rejects(send(o,{points:[[10,20]]}),{code:'state_changed',actionExecuted:false,observationRequired:true});assert.equal(delivered.length,3);
  }
  geometry={originX:-300,originY:220,widthPx:200,heightPx:150,dpi:144};
  o=await runtime.call('capture',{windowId,includeUIA:true});assert.equal(observations.at(-1).includeUIA,true);
  assert.equal(o.retrieval.coverage,'complete');assert.equal(o.elements[0].id,'button');
  const combinedWire=require('../vendor/azrael/window-control-mcp.cjs').callResult(o);
  assert.equal(combinedWire.content.filter(c=>c.type==='image').length,1);
  assert.equal(JSON.parse(combinedWire.content[0].text).elements[0].id,'button');
  await runtime.call('invoke',{windowId,observationId:o.observationId,elementId:'button'});
  await assert.rejects(send(o,{points:[[10,20]]}),{code:'state_changed'});
  o=await runtime.call('capture',{windowId,includeUIA:true});await send(o,{points:[[10,20]]});
  o=await runtime.call('capture',{windowId,includeUIA:false});assert.equal(observations.at(-1).includeUIA,false);assert.deepEqual(o.elements,[]);
  failObservation=true;await assert.rejects(runtime.call('capture',{windowId,includeUIA:true}));
  await assert.rejects(send(o,{points:[[10,20]]}),{code:'state_changed'});
});
