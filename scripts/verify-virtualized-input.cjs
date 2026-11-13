'use strict';
// Called by the real SDK acceptance runner; never changes production input guards.
const fs = require('node:fs');
const path = require('node:path');
async function verifyVirtualizedInput({client, json, target, fixtureInfo, fixtureReady, application, run, waitFor}) {
  const cases=[];
  const mouseOnly=process.argv.includes('--mouse-keyboard');
  const call=async(name,args)=>{const raw=await client.callTool({name,arguments:args});return {isError:!!raw.isError,value:json(raw)};};
  const capture=()=>call('capture',{windowId:target.windowId});
  let previousCounters,lastCollaboration;
  async function input(label,packet,postcondition) {
    if(['click','text'].includes(packet.action)&&lastCollaboration?.requested!==true)
      await input('default mode before '+label,{action:'status'});
    const current=await capture();
    if(current.isError){cases.push({label,phase:'capture',...current});return;}
    if(['click','text'].includes(packet.action)&&lastCollaboration?.requested!==true) {
      cases.push({label,isError:true,blocked:'virtualization was not requested; no fallback input sent'});return;
    }
    const result=await call('switched_input',{windowId:target.windowId,observationId:current.value.observationId,input:packet});
    const details=result.value.switchedInputDetails||result.value.inputResult;
    const entry={label,...result,interference:details?.interference,collaboration:details?.collaboration};
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
    const pending=call('switched_input',{windowId:target.windowId,observationId:current.value.observationId,input:{action:'status'}});
    const approval=await waitFor(async()=>{for(const page of application.windows())try{if(await page.evaluate(()=>window.windowUse?.snapshot().then(s=>s.view==='approval')))return page;}catch{}},'virtual input approval');
    await approval.getByRole('button',{name:'이 연결에서 허용',exact:true}).click();
    cases.push({label:'permission and default virtualization',...await pending});
    await approval.evaluate(()=>window.windowUse.command('close'));
    fs.writeFileSync(fixtureReady+'.activate','activate owned fixture');
    await new Promise(resolve=>setTimeout(resolve,300));
    cases.push({label:'fixture activation',foregroundConfirmed:fs.existsSync(fixtureReady+'.active')});
    // A foreground refusal is evidence. The actual broker still owns target activation;
    // do not skip virtualized operation assertions because the fixture could not activate.
    // Status must expose the session default without an explicit enable request.
    await input('virtualization status',{action:'status'});
    for(let attempt=0;attempt<12&&lastCollaboration?.requested&&!lastCollaboration.enabled&&!lastCollaboration.failed;attempt++) {
      await new Promise(resolve=>setTimeout(resolve,800));
      await input('virtualization readiness '+(attempt+1),{action:'status'});
    }
    const baseline=Number(fs.readFileSync(fixtureReady+'.clicks','utf8'));
    await input('virtualized button click',{action:'click',x:fixtureInfo.buttonX,y:fixtureInfo.buttonY,button:'left'},async()=>{
      await new Promise(resolve=>setTimeout(resolve,300));
      return Number(fs.readFileSync(fixtureReady+'.clicks','utf8'))>baseline;
    });
    if(mouseOnly) {
      const beforeDrag=Number(fs.readFileSync(fixtureReady+'.clicks','utf8'));
      await input('virtualized keyboard-concurrent drag',{action:'drag',x:fixtureInfo.buttonX+20,y:fixtureInfo.buttonY+5,durationMs:1800},async()=>{
        await new Promise(resolve=>setTimeout(resolve,300));
        return Number(fs.readFileSync(fixtureReady+'.clicks','utf8'))>beforeDrag;
      });
    } else {
    await input('virtualized edit focus',{action:'click',x:fixtureInfo.editX,y:fixtureInfo.editY,button:'left'});
    await input('virtualized text',{action:'text',text:'virtual-test',x:fixtureInfo.editX,y:fixtureInfo.editY},async()=>{
      const observation=await call('inspect',{windowId:target.windowId,mode:'summary',limit:100});
      const edit=observation.value.elements?.find(e=>e.name==='Verification input');
      if(observation.isError||!edit)return false;
      const read=await call('inspect',{windowId:target.windowId,mode:'read',observationId:observation.value.observationId,elementId:edit.id,fields:['value']});
      return !read.isError&&typeof read.value.elements?.[0]?.value==='string'&&read.value.elements[0].value.includes('virtual-test');
    });
    }
    await input('virtualization final status',{action:'status'});
  } finally {
    cases.push({label:'release virtualized input',...await call('release_switched_input',{windowId:target.windowId})});
    fs.writeFileSync(path.join(run,'virtualization-results.json'),JSON.stringify({platform:process.platform,arch:process.arch,cases},null,2));
  }
  return {...summarizeVirtualizedCases(cases,mouseOnly),cases};
}
function summarizeVirtualizedCases(cases,mouseOnly=false) {
  const enabled=cases.some(e=>e.collaboration?.enabled===true||e.value?.inputResult?.collaboration?.enabled===true);
  const externalMouseObserved=cases.some(e=>e.externalEventDelta?.mouse>0);
  const externalKeyboardObserved=cases.some(e=>e.externalEventDelta?.keyboard>0);
  const effects=cases.filter(e=>['virtualized button click',mouseOnly?'virtualized keyboard-concurrent drag':'virtualized text'].includes(e.label));
  const effectsPassed=enabled&&effects.length===2&&effects.every(e=>!e.isError&&e.postcondition===true&&e.collaboration?.enabled===true);
  const passed=effectsPassed&&externalMouseObserved&&externalKeyboardObserved;
  const verdict=!effectsPassed?'failed':passed?'passed':'incomplete_external_input_coverage';
  return {passed,verdict,effectsPassed,enabled,externalObserved:externalMouseObserved||externalKeyboardObserved,externalMouseObserved,externalKeyboardObserved};
}
module.exports={verifyVirtualizedInput,summarizeVirtualizedCases};
