'use strict';
// Release acceptance: real stdio, real trusted UI and a disposable owned WinForms app.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { ReadBuffer, serializeMessage } = require('@modelcontextprotocol/sdk/shared/stdio.js');
const root = path.resolve(__dirname, '..');
const runIndex = process.argv.indexOf('--run-dir');
const run = runIndex < 0 ? path.join(root, 'artifacts/acceptance/windows-' + Date.now()) : path.resolve(process.argv[runIndex + 1]);
assert.ok(!fs.existsSync(run), 'verification requires a fresh run directory');
fs.mkdirSync(run, { recursive: true });
const checks = [];
function passed(name, data = {}) { checks.push({ name, ...data }); process.stdout.write('PASS ' + name + '\n'); }
const json = result => JSON.parse(result.content.find(item => item.type === 'text').text);
async function waitFor(read, label, timeout = 15000) {
  const end = Date.now() + timeout;
  do { const result = await read(); if(result)return result; await new Promise(resolve=>setTimeout(resolve,100)); } while(Date.now()<end);
  throw Error('Timed out: ' + label);
}
class ChildTransport {
  constructor(child) { this.child=child; this.buffer=new ReadBuffer(); }
  async start() {
    this.child.stdout.on('data', chunk=>{try{this.buffer.append(chunk);let message;while((message=this.buffer.readMessage())!==null)this.onmessage?.(message);}catch(error){this.onerror?.(error);}});
    this.child.on('exit',()=>this.onclose?.());
  }
  async send(message) { await new Promise((resolve,reject)=>this.child.stdin.write(serializeMessage(message),error=>error?reject(error):resolve())); }
  async close() { this.child.stdin?.end(); }
}
async function main() {
  let application, client, fixture, child;
  const stderr=[];
  try {
    const fixtureReady=path.join(run,'fixture.json');
    const fixtureExecutable=path.join(run,'window-fixture.exe');
    const compilation=spawnSync('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',['/nologo','/target:winexe','/out:'+fixtureExecutable,'/r:System.Windows.Forms.dll','/r:System.Drawing.dll',path.join(root,'scripts/window-fixture.cs')],{encoding:'utf8',windowsHide:true});
    assert.equal(compilation.status,0,compilation.stdout+compilation.stderr);
    fixture=spawn(fixtureExecutable,[fixtureReady],{windowsHide:false,stdio:['ignore','ignore','pipe']});
    fixture.stderr.on('data',chunk=>stderr.push(chunk.toString()));
    const fixtureInfo=await waitFor(()=>fs.existsSync(fixtureReady)&&JSON.parse(fs.readFileSync(fixtureReady,'utf8')),'fixture readiness');
    const packageArg=process.argv.indexOf('--executable');
    const executable=packageArg<0?process.execPath:path.resolve(process.argv[packageArg+1]);
    const environment={...process.env}; // Deliberately keep inherited Node mode: launcher must sanitize it.
    const portServer=require('node:net').createServer();
    await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve));const port=portServer.address().port;await new Promise(resolve=>portServer.close(resolve));
    const runtimeIndex=process.argv.indexOf('--runtime-directory');
    const runtimeArguments=runtimeIndex<0?[]:['--runtime-directory',path.resolve(process.argv[runtimeIndex+1])];
    child=spawn(executable,[...(packageArg<0?[path.join(root,'scripts/launch.cjs')]:[]),'--mcp',...runtimeArguments,'--user-data-dir',path.join(run,'profile'),'--remote-debugging-port='+port],{env:environment,windowsHide:true,stdio:['pipe','pipe','pipe']});
    child.stderr.on('data',chunk=>stderr.push(chunk.toString()));
    await waitFor(async()=>{try{return (await fetch('http://127.0.0.1:'+port+'/json/version')).ok;}catch{return false;}},'Electron test CDP readiness');
    const browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);
    application={windows:()=>browser.contexts().flatMap(context=>context.pages()),close:()=>browser.close()};
    client=new Client({name:'Window Use release verification',version:'1.0.0'});
    await client.connect(new ChildTransport(child));
    const tools=await client.listTools();
    for(const name of ['context','list_windows','capture','inspect','set_value','invoke','capture_desktop','desktop_input','run_task_macro'])assert.ok(tools.tools.some(tool=>tool.name===name),name);
    assert.ok(!tools.tools.some(tool=>/approval|permission|settings/.test(tool.name)));
    passed('standard SDK stdio connection and tool discovery');
    assert.equal(application.windows().length, 0, 'MCP starts without a pre-opened settings or approval renderer');
    const context=json(await client.callTool({name:'context',arguments:{}})); assert.equal(context.capabilities.desktopControl,true);
    const list=()=>client.callTool({name:'list_windows',arguments:{}}).then(json);
    let candidates=await list();
    const target=candidates.candidates.find(item=>item.title==='Window Use MCP verification');assert.ok(target,'owned fixture discovered');
    const inspect=()=>client.callTool({name:'inspect',arguments:{windowId:target.windowId,mode:'summary',limit:100}}).then(result=>{assert.ok(!result.isError,JSON.stringify(json(result)));return json(result);});
    let observation=await inspect();
    const edit=()=>observation.elements.find(item=>item.name==='Verification input');
    const readValue=async()=>{const reply=await client.callTool({name:'inspect',arguments:{windowId:target.windowId,mode:'read',observationId:observation.observationId,elementId:edit().id,fields:['value']}});assert.ok(!reply.isError,JSON.stringify(json(reply)));const value=json(reply).elements[0].value;observation=await inspect();return value;};
    assert.ok(edit(),'UIA input element');
    if(process.argv.includes('--curve')) {
      const outcome=await require('./verify-curve-input.cjs').verifyCurveInput({client,json,target,fixtureInfo,fixtureReady,application,run,waitFor});
      await client.close();client=undefined;
      await waitFor(()=>child.exitCode!==null,'MCP EOF shutdown');
      fs.writeFileSync(path.join(run,'result.json'),JSON.stringify({platform:process.platform,arch:process.arch,checks,curve:{passed:outcome.passed},exitCode:outcome.passed?0:1},null,2));
      assert.ok(outcome.passed,'curve acceptance; see curve-results.json');
      return;
    }
    if(process.argv.includes('--virtualization')||process.argv.includes('--mouse-keyboard')||process.argv.includes('--batch')) {
      const outcome=await require('./verify-virtualized-input.cjs').verifyVirtualizedInput({client,json,target,fixtureInfo,fixtureReady,application,run,waitFor});
      await client.close();client=undefined;
      await waitFor(()=>child.exitCode!==null,'MCP EOF shutdown');
      const {cases:virtualCases,...summary}=outcome;
      fs.writeFileSync(path.join(run,'result.json'),JSON.stringify({platform:process.platform,arch:process.arch,checks,virtualization:summary,exitCode:outcome.passed?0:1},null,2));
      if(!outcome.passed)throw Error('Virtualized input acceptance: '+outcome.verdict+'; see virtualization-results.json');
      return;
    }
    assert.equal(await readValue(),'before');
    const mutate=value=>client.callTool({name:'set_value',arguments:{windowId:target.windowId,observationId:observation.observationId,elementId:edit().id,value}});
    const findApproval=()=>waitFor(async()=>{for(const page of application.windows()){try{if(await page.evaluate(()=>window.windowUse?.snapshot().then(value=>value.view==='approval')))return page;}catch{}}},'automatic approval window');
    let action=mutate('closed');
    let approval=await findApproval();
    await approval.getByRole('button',{name:'닫기',exact:true}).click();
    let result=await action;assert.equal(result.isError,true);assert.equal(json(result).code,'approval_denied');
    await waitFor(()=>application.windows().length===0,'approval renderer actually closed');
    observation=await inspect();assert.equal(await readValue(),'before');
    passed('MCP alone launches approval UI; closing denies and releases the renderer without disconnecting');
    action=mutate('denied');
    approval=await findApproval();
    await approval.screenshot({path:path.join(run,'approval.png')});
    await approval.getByRole('button',{name:'거부',exact:true}).click();
    result=await action;assert.equal(result.isError,true);assert.equal(json(result).code,'approval_denied');
    observation=await inspect();assert.equal(await readValue(),'before');
    passed('automatic approval popup; denial sends no input');
    await approval.evaluate(()=>{void window.windowUse.command('close');});
    await waitFor(()=>application.windows().length===0,'hidden approval renderer closed');
    action=mutate('Window Use verified');
    approval=await findApproval();
    await approval.getByRole('button',{name:'이 연결에서 허용',exact:true}).click();
    result=await action;
    if(result.isError&&json(result).actionExecuted===false&&json(result).observationRequired===true){observation=await inspect();result=await mutate('Window Use verified');}
    assert.ok(!result.isError,JSON.stringify(json(result)));
    observation=await inspect();try{await waitFor(async()=>await readValue()==='Window Use verified','exact applied input value',5000);}catch(error){if(fs.existsSync(fixtureReady+'.state'))error.message+=' '+fs.readFileSync(fixtureReady+'.state','utf8');throw error;}
    const apply=observation.elements.find(item=>item.name==='Apply verification');assert.ok(apply);
    result=await client.callTool({name:'invoke',arguments:{windowId:target.windowId,observationId:observation.observationId,elementId:apply.id}});assert.ok(!result.isError,JSON.stringify(json(result)));
    observation=await waitFor(async()=>{const current=await inspect();return current.elements.some(item=>item.name==='Applied: Window Use verified'||item.value==='Applied: Window Use verified')?current:false;},'observed invoke postcondition',5000);
    passed('approved real UIA edit and invoke with observed postcondition');
    await approval.evaluate(()=>window.windowUse.command('openSettings'));
    const findSettings=()=>waitFor(async()=>{for(const page of application.windows()){try{if(await page.evaluate(()=>window.windowUse?.snapshot().then(value=>value.view==='settings')))return page;}catch{}}},'settings window');
    let settings=await findSettings();
    const width=await settings.evaluate(()=>window.innerWidth);assert.ok(width>=400&&width<=460,'compact settings viewport');
    for(const theme of ['light','dark']){
      await settings.getByLabel('테마',{exact:true}).selectOption(theme);
      await settings.screenshot({path:path.join(run,'settings-'+theme+'.png')});
      assert.equal(await settings.locator('html').getAttribute('data-theme'),theme);
    }
    assert.ok(await settings.getByText('항상 보호',{exact:true}).count());
    passed('compact custom-chrome UI renders and switches light/dark');
    await settings.getByRole('button',{name:'닫기',exact:true}).click();
    await waitFor(()=>settings.isClosed(),'settings renderer closed');
    await approval.evaluate(()=>window.windowUse.command('openSettings'));
    settings=await findSettings();
    assert.equal(await settings.locator('html').getAttribute('data-theme'),'dark');
    passed('closed settings UI reopens from the host with preserved settings');
    await settings.getByLabel('권한 모드',{exact:true}).selectOption('full');
    candidates=await list();
    const selfApps=candidates.candidates.filter(item=>item.appName===(packageArg<0?'electron.exe':'WindowUseHost.exe')&&item.title==='');assert.ok(selfApps.length,'self windows are title-redacted');
    for(const own of selfApps){
      result=await client.callTool({name:'capture',arguments:{windowId:own.windowId}});assert.equal(json(result).code,'security_app_blocked');
      result=await client.callTool({name:'invoke',arguments:{windowId:own.windowId,observationId:'forged',elementId:'forged'}});assert.equal(json(result).code,'security_app_blocked');
    }
    passed('own settings/approval windows blocked from observation and control in full mode');
    let desktop;
    for(let attempt=0;attempt<3;attempt++){result=await client.callTool({name:'capture_desktop',arguments:{}});if(!result.isError){desktop=json(result);break;}await new Promise(resolve=>setTimeout(resolve,200));}
    assert.ok(desktop,'masked desktop capture');assert.equal(desktop.redacted,true);assert.ok(desktop.maskedWindowCount>=1);
    passed('native desktop capture masks own UI',{maskedWindowCount:desktop.maskedWindowCount});
    // Get settings out of the fixture hit point. This is test-host placement, never an MCP bypass.
    await settings.evaluate(()=>window.windowUse.command('minimize'));
    fs.writeFileSync(fixtureReady+'.activate','activate owned fixture');
    const coordinateBaseline=Number(fs.readFileSync(fixtureReady+'.clicks','utf8'));
    // The native broker still owns foreground recovery and hit checks.
    await new Promise(resolve=>setTimeout(resolve,300));
    await new Promise(resolve=>setTimeout(resolve,600));
    for(let attempt=0;attempt<4;attempt++){result=await client.callTool({name:'capture_desktop',arguments:{}});if(!result.isError)break;await new Promise(resolve=>setTimeout(resolve,300));}
    assert.ok(!result.isError,JSON.stringify(json(result)));desktop=json(result);
    let inputAttempts=0;
    for(;inputAttempts<4;inputAttempts++) {
      result=await client.callTool({name:'desktop_input',arguments:{observationId:desktop.observationId,input:{action:'click',x:fixtureInfo.buttonX,y:fixtureInfo.buttonY,button:'left'}}});
      if(!result.isError)break;
      const refusal=json(result),details=refusal.switchedInputDetails;
      // A fresh attempt is allowed only when the native receipt proves zero delivered input.
      if(!['interrupted','physical_held'].includes(refusal.nativeCode)||refusal.actionExecuted!==false||details?.deliveredInputs!==0||details?.activationDeliveredInputs!==0||details?.recovery?.uncertainDelivery!==false)break;
      await new Promise(resolve=>setTimeout(resolve,700));
      const next=await client.callTool({name:'capture_desktop',arguments:{}});if(next.isError)break;desktop=json(next);
    }
    let coordinateFailure;
    fs.writeFileSync(path.join(run,'coordinate-delivery.json'),JSON.stringify({button:fixtureInfo,baseline:coordinateBaseline,result:json(result)},null,2));
    if(result.isError)coordinateFailure=json(result);
    else {
      assert.equal(json(result).delivery,'desktopInput');
      await waitFor(()=>Number(fs.readFileSync(fixtureReady+'.clicks','utf8'))>coordinateBaseline,'coordinate click observed by fixture',5000);
      passed('real coordinate input reaches owned fixture with observed postcondition',{attempts:inputAttempts+1});
    }
    // Dispatch through the exact trusted renderer IPC even while minimized.
    await settings.evaluate(()=>window.windowUse.command('stop'));
    result=await client.callTool({name:'capture_desktop',arguments:{}});assert.equal(json(result).code,'user_stopped');
    await settings.evaluate(()=>window.windowUse.command('resume'));
    result=await client.callTool({name:'list_windows',arguments:{}});assert.ok(!result.isError);
    passed('trusted UI Stop and explicit resume');
    await client.close(); client=undefined;
    await waitFor(()=>child.exitCode!==null,'MCP EOF shutdown');
    passed('EOF releases resources and exits');
    const output={platform:process.platform,arch:process.arch,executable,checks,exitCode:coordinateFailure?1:0,coordinateFailure,stderr:stderr.join('').slice(-5000),run};
    fs.writeFileSync(path.join(run,'result.json'),JSON.stringify(output,null,2));
    process.stdout.write('RESULT '+path.join(run,'result.json')+'\n');
    if(coordinateFailure)throw Error('Coordinate input not accepted: '+JSON.stringify(coordinateFailure));
  } catch(error) {
    fs.writeFileSync(path.join(run,'failure.json'),JSON.stringify({message:error.message,stack:error.stack,checks,stderr:stderr.join('').slice(-8000)},null,2));
    throw error;
  } finally {
    await client?.close().catch(()=>{});
    await application?.close().catch(()=>{});
    if(child&&child.exitCode===null){child.stdin?.end();await waitFor(()=>child.exitCode!==null||child.signalCode!==null,'Electron termination',5000).catch(()=>{child.kill();});}
    if(fixture&&fixture.exitCode===null){fixture.kill();await waitFor(()=>fixture.exitCode!==null||fixture.signalCode!==null,'fixture termination');}
  }
}
main().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
