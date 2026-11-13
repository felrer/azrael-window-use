'use strict';
// Actual SDK/desktop-input acceptance against the owned drawing fixture.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function segmentDistance(point,a,b) {
  const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/length)):0;
  return distance(point,[a[0]+t*dx,a[1]+t*dy]);
}
// Retained: later acceptance edits must not accidentally accept a straight chord
// merely because the transport reports successful curved input delivery.
function assessStroke(events,anchors,curved=true,tolerance=3) {
  assert.equal(events.filter(e=>e.kind==='down').length,1,'exactly one application MouseDown');
  assert.equal(events.filter(e=>e.kind==='up').length,1,'exactly one application MouseUp');
  assert.equal(events[0]?.kind,'down');assert.equal(events.at(-1)?.kind,'up');
  const points=events.map(e=>[e.x,e.y]);
  assert.ok(distance(points[0],anchors[0])<=tolerance,'application start endpoint');
  assert.ok(distance(points.at(-1),anchors.at(-1))<=tolerance,'application final endpoint');
  const near=anchors.map(anchor=>Math.min(...points.slice(1).map((point,i)=>segmentDistance(anchor,points[i],point))));
  assert.ok(near.every(value=>value<=tolerance),'application stroke must pass near every supplied anchor');
  const excursion=Math.max(...points.map(point=>segmentDistance(point,anchors[0],anchors.at(-1))));
  const polylineDeviation=Math.max(...points.map(point=>Math.min(...anchors.slice(1).map((anchor,i)=>segmentDistance(point,anchors[i],anchor)))));
  if(curved) {
    assert.ok(excursion>20,'application stroke must depart substantially from the straight chord');
    assert.ok(polylineDeviation>tolerance,'curved fixture stroke must differ from merely connecting its anchors with straight segments');
  }
  else assert.ok(excursion<=tolerance,'legacy two-point drag must remain straight');
  return {downs:1,ups:1,observedEvents:events.length,anchorDistances:near,maxChordExcursion:excursion,maxPolylineDeviation:polylineDeviation,tolerance};
}
async function verifyCurveInput({client,json,target,fixtureInfo,fixtureReady,application,run,waitFor}) {
  const cases=[];
  const call=async(name,args)=>{const raw=await client.callTool({name,arguments:args});return {isError:!!raw.isError,value:json(raw)};};
  const readStroke=()=>{try{return JSON.parse(fs.readFileSync(fixtureReady+'.strokes','utf8'));}catch{return undefined;}};
  const approved=async(name,args)=>{
    let settled=false;
    const pending=call(name,args);pending.then(()=>{settled=true;},()=>{settled=true;});
    const ready=await waitFor(async()=>{
      for(const page of application.windows())try{
        if(await page.evaluate(()=>window.windowUse?.snapshot().then(s=>s.view==='approval')))return {page};
      }catch{}
      return settled?{settled:true}:false;
    },'curve trusted UI approval or immediate response');
    if(ready.page)await ready.page.getByRole('button',{name:'이 연결에서 허용',exact:true}).click();
    const result=await pending;
    if(ready.page)await ready.page.evaluate(()=>window.windowUse.command('close'));
    return result;
  };
  const {canvasX:x,canvasY:y,canvasWidth:w,canvasHeight:h}=fixtureInfo;
  assert.ok([x,y,w,h].every(Number.isInteger)&&w>300&&h>150,'published physical canvas bounds');
  const point=(u,v)=>[x+Math.round(w*u),y+Math.round(h*v)];
  const anchors=[point(.12,.5),point(.35,.18),point(.65,.82),point(.88,.5)];
  async function freshDesktop(){
    for(let attempt=1;attempt<=5;++attempt) {
      const reply=await approved('capture_desktop',{});
      if(!reply.isError)return reply.value;
      const retryable=reply.value.code==='state_changed'&&reply.value.nativeCode==='desktop-capture-unavailable';
      cases.push({label:'desktop capture observation retry',attempt,retrying:retryable&&attempt<5,...reply});
      assert.ok(retryable&&attempt<5,JSON.stringify(reply.value));
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    throw Error('Desktop capture observation attempts exhausted');
  }
  async function gesture(label,input,expected,curved) {
    const before=await waitFor(readStroke,'fixture stroke state');
    const desktop=await freshDesktop();
    const result=await call('desktop_input',{observationId:desktop.observationId,input});
    const entry={label,...result};cases.push(entry);
    assert.ok(!result.isError,JSON.stringify(result.value));
    const after=await waitFor(()=>{const state=readStroke();return state&&state.ups>before.ups&&!state.recording?state:false;},label+' application MouseUp');
    assert.equal(after.overflow,false,'fixture event recorder must not overflow');
    assert.equal(after.downs-before.downs,1);assert.equal(after.ups-before.ups,1);
    entry.effect=assessStroke(after.events.slice(before.events.length),expected,curved);
    entry.collaboration=(result.value.switchedInputDetails||result.value.inputResult)?.collaboration;
    process.stdout.write('CURVE '+JSON.stringify({label,effect:entry.effect})+'\n');
  }
  let passed=false;
  try {
    let desktop=await freshDesktop();
    const status=await approved('desktop_input',{observationId:desktop.observationId,input:{action:'status',points:[anchors[0]]}});
    const collaboration=(status.value.switchedInputDetails||status.value.inputResult)?.collaboration;
    cases.push({label:'approved desktop default virtualization',...status,collaboration});
    assert.ok(!status.isError&&collaboration?.requested===true&&collaboration.enabled===true&&collaboration.phase==='ready',
      'desktop input must expose ready default virtualization without physical-input preparation');
    fs.writeFileSync(fixtureReady+'.activate','activate owned curve fixture');
    try { await waitFor(()=>fs.existsSync(fixtureReady+'.active'),'owned drawing fixture foreground',1000); }
    catch { cases.push({label:'fixture foreground request refused; real broker preparation and application assertions remain required',foregroundConfirmed:false}); }
    await gesture('four-anchor curved desktop drag',{points:anchors,durationMs:600},anchors,true);
    const straight=[point(.16,.90),point(.84,.90)];
    await gesture('two-point automatic straight desktop drag',{points:straight,durationMs:500},straight,false);
    // This schema-valid point is outside the captured desktop observation.
    // The host policy may reject it before native whole-path preflight runs;
    // this check therefore claims only refusal before application button down.
    const before=await waitFor(readStroke,'preflight baseline');
    desktop=await freshDesktop();
    const refused=await call('desktop_input',{observationId:desktop.observationId,input:{points:[anchors[0],[-100000,-100000]],durationMs:500}});
    const entry={label:'outside observation path rejected before input',...refused};cases.push(entry);
    assert.ok(refused.isError,'outside desktop path must be refused');
    const validationCode=refused.value.nativeCode||refused.value.code;
    const hostBounds=refused.value.code==='invalid_request' &&
      refused.value.message==='Screen coordinates are outside the desktop observation' && refused.value.actionExecuted===false;
    assert.ok(hostBounds||['invalid_params','point_outside_target','point_outside_screen'].includes(validationCode),
      'outside path must fail validation, not an unrelated permission/runtime guard: '+validationCode);
    entry.rejectionLayer=hostBounds?'host-observation-boundary':'input-validation';
    await new Promise(resolve=>setTimeout(resolve,150));
    const after=await waitFor(readStroke,'preflight application state');
    assert.equal(after.downs,before.downs,'outside observation path must not send a button down');
    assert.equal(after.ups,before.ups);assert.equal(after.events.length,before.events.length);
    entry.noApplicationInput=true;
    // Exercise the public image-to-screen path against actual application events.
    const captureImage=async()=>{const r=await approved('capture',{windowId:target.windowId});assert.ok(!r.isError,JSON.stringify(r.value));assert.equal(r.value.coordinateSpace.type,'capture-image');return r.value;};
    for(const [label,screen,curved]of [['image click',[point(.2,.5)],false],['image straight',straight,false],['image curve',anchors,true]]) {
      const image=await captureImage(),g=image.coordinateSpace.screenBounds;
      const before=readStroke(),points=screen.map(([x,y])=>[x-g.originX,y-g.originY]);
      const result=await call('switched_input',{windowId:target.windowId,observationId:image.observationId,input:{points,...(points.length>1?{durationMs:600}:{})}});
      cases.push({label,...result});assert.ok(!result.isError,JSON.stringify(result.value));
      const after=await waitFor(()=>{const s=readStroke();return s&&s.ups>before.ups&&!s.recording?s:false;},label+' application input');
      if(points.length>1)cases.at(-1).effect=assessStroke(after.events.slice(before.events.length),screen,curved);
      else {assert.equal(after.downs-before.downs,1);assert.equal(after.ups-before.ups,1);assert.ok(distance([after.events.at(-1).x,after.events.at(-1).y],screen[0])<=1);}
    }
    const image=await captureImage(),beforeMove=readStroke();
    fs.writeFileSync(fixtureReady+'.move','move owned fixture');await waitFor(()=>fs.existsSync(fixtureReady+'.moved'),'owned fixture movement');
    const stale=await call('switched_input',{windowId:target.windowId,observationId:image.observationId,input:{points:[[50,50]]}});
    cases.push({label:'moved image rejected before input',...stale});assert.ok(stale.isError);assert.equal(stale.value.observationRequired,true);assert.equal(stale.value.actionExecuted,false);assert.equal(readStroke().downs,beforeMove.downs);
    const released=await call('release_switched_input',{windowId:target.windowId});assert.ok(!released.isError);
    passed=true;
  } finally {
    const release=await call('release_desktop_input',{});
    cases.push({label:'release desktop input',...release});
    if(release.isError)passed=false;
    fs.writeFileSync(path.join(run,'curve-results.json'),JSON.stringify({platform:process.platform,arch:process.arch,passed,cases,
      limits:['Application mouse events may coalesce; no event-count/timing guarantee.','No physical-user-input preparation or concurrency claim.','Outside-observation rejection can occur in host policy; this does not prove native complete-path preflight or arbitrary app occlusion handling.']},null,2));
    assert.ok(!release.isError,'desktop input release failed; see curve-results.json');
  }
  return {passed,cases};
}
module.exports={verifyCurveInput,assessStroke};
