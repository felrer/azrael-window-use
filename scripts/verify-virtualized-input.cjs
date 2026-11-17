'use strict';
// Called by the real SDK acceptance runner; never changes production input guards.
const fs = require('node:fs');
const path = require('node:path');
async function verifyVirtualizedInput({client, json, target, fixtureInfo, fixtureReady, application, run, waitFor}) {
  const cases=[];
  const mouseOnly=process.argv.includes('--mouse-keyboard');
  const batchMode=process.argv.includes('--batch');
  const call=async(name,args)=>{const raw=await client.callTool({name,arguments:args});return {isError:!!raw.isError,value:json(raw)};};
  const capture=()=>call('capture',{windowId:target.windowId});
  let previousCounters,lastCollaboration;
  async function input(label,packet,postcondition) {
    if((!packet.action||['text','batch'].includes(packet.action))&&lastCollaboration?.requested!==true)
      await input('default mode before '+label,{action:'status'});
    const current=await capture();
    if(current.isError){cases.push({label,phase:'capture',...current});return;}
    if((!packet.action||['text','batch'].includes(packet.action))&&lastCollaboration?.requested!==true) {
      cases.push({label,isError:true,blocked:'virtualization was not requested; no fallback input sent'});return;
    }
    const geometry=current.value.coordinateSpace.screenBounds;
    const relative=points=>points.map(([x,y])=>[x-geometry.originX,y-geometry.originY]);
    const imagePacket={...packet,...(packet.points?{points:relative(packet.points)}:{}),
      ...(packet.steps?{steps:packet.steps.map(step=>({...step,...(step.points?{points:relative(step.points)}:{})}))}:{})};
    const result=await call('switched_input',{windowId:target.windowId,observationId:current.value.observationId,input:imagePacket});
    const details=result.value.switchedInputDetails||result.value.inputResult;
    const entry={label,...result,interference:details?.interference,collaboration:details?.collaboration,
      ...(batchMode?{batch:details?.batch,keyboardReservation:details?.keyboardReservation}: {})};
    lastCollaboration=entry.collaboration;
    if(entry.interference) {
      const counters={mouse:entry.interference.foreignMouseEvents||0,keyboard:entry.interference.foreignKeyboardEvents||0};
      const reset=previousCounters&&(counters.mouse<previousCounters.mouse||counters.keyboard<previousCounters.keyboard);
      entry.externalEventDelta=previousCounters&&!reset?{mouse:counters.mouse-previousCounters.mouse,keyboard:counters.keyboard-previousCounters.keyboard}:null;
      entry.counterReset=!!reset;previousCounters=counters;
    }
    // External events are evidence, never a reason for this runner to skip the assertion.
    if(postcondition)try{entry.postcondition=await postcondition();}catch(error){entry.postcondition=false;entry.assertionError=error.message;}
    cases.push(entry);
    process.stdout.write('VIRTUAL '+JSON.stringify({label,isError:entry.isError,code:entry.value.code,nativeCode:entry.value.nativeCode,postcondition:entry.postcondition,collaboration:entry.collaboration?.phase,externalEventDelta:entry.externalEventDelta})+'\n');
    return entry;
  }
  try {
    const current=await capture();
    if(current.isError)throw Error('Initial capture failed: '+current.value.code);
    let initialReply;
    const pending=call('switched_input',{windowId:target.windowId,observationId:current.value.observationId,input:{action:'status'}}).then(
      value=>(initialReply=value),error=>(initialReply={isError:true,value:{code:error.code,message:error.message}}));
    const approval=await waitFor(async()=>{
      if(initialReply)throw Error('Virtual input completed before approval: '+JSON.stringify(initialReply));
      for(const page of application.windows())try{if(await page.evaluate(()=>window.windowUse?.snapshot().then(s=>s.view==='approval')))return page;}catch{}
    },'virtual input approval');
    await approval.getByRole('button',{name:'이 연결에서 허용',exact:true}).click();
    const initial=await pending;
    cases.push({label:'permission and default virtualization',...initial});
    if(batchMode) {
      const collaboration=(initial.value.switchedInputDetails||initial.value.inputResult)?.collaboration;
      cases.push({label:'autonomous startup readiness',isError:initial.isError,collaboration,
        postcondition:!initial.isError&&collaboration?.requested===true&&collaboration.enabled===true&&collaboration.phase==='ready'&&
          collaboration.capability_pending===false&&collaboration.failed!==true,
        // These observations do not prove raw-input survival or require physical motion.
        rawPackets:collaboration?.rawPackets,suppression:collaboration?.suppression});
    }
    await approval.evaluate(()=>window.windowUse.command('close'));
    fs.writeFileSync(fixtureReady+'.activate','activate owned fixture');
    await new Promise(resolve=>setTimeout(resolve,300));
    cases.push({label:'fixture activation',foregroundConfirmed:fs.existsSync(fixtureReady+'.active')});
    // A foreground refusal is evidence. The actual broker still owns target activation;
    // do not skip virtualized operation assertions because the fixture could not activate.
    // Status must expose the session default without an explicit enable request.
    await input('virtualization status',{action:'status'});
    const baseline=Number(fs.readFileSync(fixtureReady+'.clicks','utf8'));
    if(batchMode) {
      await input('virtualized batch',{action:'batch',points:[[fixtureInfo.editX,fixtureInfo.editY]],maxMs:1000,steps:[
        {action:'click',points:[[fixtureInfo.editX,fixtureInfo.editY]],button:'left'},
        {action:'press',keys:[162,65]},
        {action:'text',text:'virtual-batch'},
        {action:'click',points:[[fixtureInfo.buttonX,fixtureInfo.buttonY]],button:'left'}
      ]},async()=>{
        await new Promise(resolve=>setTimeout(resolve,300));
        const observation=await call('inspect',{windowId:target.windowId,mode:'summary',limit:100});
        const edit=observation.value.elements?.find(e=>e.name==='Verification input');
        if(observation.isError||!edit)return false;
        const read=await call('inspect',{windowId:target.windowId,mode:'read',observationId:observation.value.observationId,elementId:edit.id,fields:['value']});
        return !read.isError&&read.value.elements?.[0]?.value==='virtual-batch'&&Number(fs.readFileSync(fixtureReady+'.clicks','utf8'))>baseline;
      });
    } else {
    await input('virtualized button click',{points:[[fixtureInfo.buttonX,fixtureInfo.buttonY]]},async()=>{
      await new Promise(resolve=>setTimeout(resolve,300));
      return Number(fs.readFileSync(fixtureReady+'.clicks','utf8'))>baseline;
    });
    if(mouseOnly) {
      const beforeDrag=Number(fs.readFileSync(fixtureReady+'.clicks','utf8'));
      await input('virtualized keyboard-concurrent drag',{points:[[fixtureInfo.buttonX,fixtureInfo.buttonY],[fixtureInfo.buttonX+20,fixtureInfo.buttonY+5]],durationMs:1800},async()=>{
        await new Promise(resolve=>setTimeout(resolve,300));
        return Number(fs.readFileSync(fixtureReady+'.clicks','utf8'))>beforeDrag;
      });
    } else {
    await input('virtualized edit focus',{points:[[fixtureInfo.editX,fixtureInfo.editY]]});
    await input('virtualized text',{action:'text',text:'virtual-test',points:[[fixtureInfo.editX,fixtureInfo.editY]]},async()=>{
      const observation=await call('inspect',{windowId:target.windowId,mode:'summary',limit:100});
      const edit=observation.value.elements?.find(e=>e.name==='Verification input');
      if(observation.isError||!edit)return false;
      const read=await call('inspect',{windowId:target.windowId,mode:'read',observationId:observation.value.observationId,elementId:edit.id,fields:['value']});
      return !read.isError&&typeof read.value.elements?.[0]?.value==='string'&&read.value.elements[0].value.includes('virtual-test');
    });
    }
    }
    await input('virtualization final status',{action:'status'});
  } finally {
    cases.push({label:'release virtualized input',...await call('release_switched_input',{windowId:target.windowId})});
    fs.writeFileSync(path.join(run,'virtualization-results.json'),JSON.stringify({platform:process.platform,arch:process.arch,cases},null,2));
  }
  return {...summarizeVirtualizedCases(cases,mouseOnly,batchMode),cases};
}
function summarizeVirtualizedCases(cases,mouseOnly=false,batchMode=false) {
  const enabled=cases.some(e=>e.collaboration?.enabled===true||e.value?.inputResult?.collaboration?.enabled===true);
  const externalMouseObserved=cases.some(e=>e.externalEventDelta?.mouse>0);
  const externalKeyboardObserved=cases.some(e=>e.externalEventDelta?.keyboard>0);
  if(batchMode) {
    const startup=cases.find(e=>e.label==='autonomous startup readiness');
    const startupReady=!!startup&&!startup.isError&&startup.postcondition===true&&startup.collaboration?.requested===true&&
      startup.collaboration.enabled===true&&startup.collaboration.phase==='ready'&&startup.collaboration.capability_pending===false&&startup.collaboration.failed!==true;
    const effect=cases.find(e=>e.label==='virtualized batch');
    const effectsPassed=enabled&&!!effect&&!effect.isError&&effect.collaboration?.enabled===true&&effect.postcondition===true&&effect.batch?.completedSteps===4&&effect.batch?.completed===true&&
      effect.keyboardReservation?.restored===true&&effect.keyboardReservation?.pending===false&&effect.keyboardReservation?.active===false;
    const capabilityBlocked=!enabled&&!!effect&&startup?.collaboration?.failed!==true&&effect.collaboration?.failed!==true&&
      (!!effect.blocked||effect.collaboration?.capability_pending===true)&&!(effect.batch?.completedSteps>0);
    // A call-local foreign-key delta plus buffered events is required; cumulative
    // foreign counters alone cannot establish physical keyboard hook coverage.
    const externalReservationConcurrencyVerified=effectsPassed&&effect.externalEventDelta?.keyboard>0&&effect.keyboardReservation?.bufferedEvents>0;
    const passed=startupReady&&effectsPassed;
    return {passed,verdict:passed?'passed':capabilityBlocked?'capability_blocked':'failed',startupReady,effectsPassed,enabled,
      externalObserved:externalMouseObserved||externalKeyboardObserved,externalMouseObserved,externalKeyboardObserved,
      externalReservationConcurrencyVerified,externalReservationConcurrency:externalReservationConcurrencyVerified?'verified':'unverified'};
  }
  const effects=cases.filter(e=>['virtualized button click',mouseOnly?'virtualized keyboard-concurrent drag':'virtualized text'].includes(e.label));
  const effectsPassed=enabled&&effects.length===2&&effects.every(e=>!e.isError&&e.postcondition===true&&e.collaboration?.enabled===true);
  const passed=effectsPassed&&externalMouseObserved&&externalKeyboardObserved;
  const verdict=!effectsPassed?'failed':passed?'passed':'incomplete_external_input_coverage';
  return {passed,verdict,effectsPassed,enabled,externalObserved:externalMouseObserved||externalKeyboardObserved,externalMouseObserved,externalKeyboardObserved};
}
module.exports={verifyVirtualizedInput,summarizeVirtualizedCases};
