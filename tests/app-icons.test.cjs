'use strict';
const { fixtureExecutable, expectedExecutable } = require('./fixture-paths.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppIcons } = require('../src/app-icons.cjs');
const settle = () => new Promise(resolve => setImmediate(resolve));
const fs = require('node:fs');
const path = require('node:path');
test('icon cache deduplicates trusted local identities and bounds concurrency', async () => {
  let calls=0, active=0, peak=0, changes=0;
  const finish=[];
  const icons=createAppIcons({concurrency:2,getFileIcon:async()=>{calls++;active++;peak=Math.max(peak,active);await new Promise(resolve=>finish.push(resolve));active--;return {isEmpty:()=>false,toDataURL:()=> 'data:image/png;base64,AAAA'};},changed:()=>changes++});
  assert.equal(icons.get('\\\\server\\share\\app.exe'),null);
  assert.equal(icons.get('relative.exe'),null);
  icons.get(fixtureExecutable("Apps/a.exe"));icons.get(fixtureExecutable("Apps/a.exe"));icons.get(fixtureExecutable("Apps/b.exe"));icons.get(fixtureExecutable("Apps/c.exe"));
  await settle();assert.equal(calls,2);assert.equal(peak,2);
  finish.shift()();await settle();assert.equal(calls,3);
  for(const resolve of finish)resolve();await settle();
  assert.equal(icons.get(fixtureExecutable("Apps/a.exe")),'data:image/png;base64,AAAA');assert.equal(changes,3);icons.dispose();
});
test('missing icons fall back without repeated extraction; disposal stops notifications',async()=>{
  let calls=0,changes=0;
  const icons=createAppIcons({getFileIcon:async()=>{calls++;throw Error('unreadable')},changed:()=>changes++});
  icons.get(fixtureExecutable("Apps/missing.exe"));await settle();assert.equal(icons.get(fixtureExecutable("Apps/missing.exe")),null);assert.equal(calls,1);assert.equal(changes,1);icons.dispose();assert.equal(icons.get(fixtureExecutable("Apps/new.exe")),null);
  let release;const pending=createAppIcons({getFileIcon:()=>new Promise(resolve=>{release=resolve}),changed:()=>changes++});
  pending.get(fixtureExecutable("Apps/pending.exe"));await settle();pending.dispose();release({isEmpty:()=>false,toDataURL:()=> 'data:image/png;base64,AAAA'});await settle();assert.equal(changes,1);
});
test('approval priority bypasses queued list icons and uses reserved capacity',async()=>{
  const calls=[],finish=[];
  const icons=createAppIcons({concurrency:4,getFileIcon:async exe=>{calls.push(exe);await new Promise(resolve=>finish.push(resolve));return {isEmpty:()=>false,toDataURL:()=> 'data:image/png;base64,AAAA'};},changed(){}});
  for(const name of ['a','b','c','d','target'])icons.get(fixtureExecutable(`Apps/${name}.exe`));
  await settle();assert.equal(calls.length,3);assert.equal(icons.state(fixtureExecutable("Apps/target.exe")),'loading');
  icons.get(fixtureExecutable("Apps/target.exe"),true);await settle();assert.equal(calls[3],expectedExecutable("Apps/target.exe"));
  finish.shift()();await settle();assert.equal(calls[4],expectedExecutable("Apps/d.exe"));
  icons.dispose();for(const resolve of finish)resolve();await settle();
});
test('disk cache survives restart, invalidates changed executable and recovers corrupt data',{timeout:10000},async t=>{
  const root=path.resolve(__dirname,'../artifacts/verification/unit');fs.mkdirSync(root,{recursive:true});
  const directory=fs.mkdtempSync(path.join(root,'app-icons-'));const services=[];
  assert.equal(path.dirname(directory),root);
  t.after(async()=>{for(const icons of services){icons.dispose();await icons.flush();}fs.rmSync(directory,{recursive:true});assert.equal(fs.existsSync(directory),false);});
  let calls=0,mtime=1;
  function open(){let complete;const done=new Promise(resolve=>{complete=resolve});const icons=createAppIcons({directory,stat:async()=>({isFile:()=>true,size:200,mtimeMs:mtime,ctimeMs:mtime}),getFileIcon:async()=>{calls++;return {isEmpty:()=>false,toDataURL:()=> 'data:image/png;base64,AAAA'};},changed:()=>complete()});services.push(icons);return {icons,done};}
  const exe=fixtureExecutable("Apps/cached.exe");let run=open();run.icons.get(exe,true);await run.done;await run.icons.flush();assert.equal(calls,1);assert.equal(run.icons.state(exe),'ready');run.icons.dispose();
  run=open();run.icons.get(exe,true);await run.done;assert.equal(calls,1);assert.equal(run.icons.get(exe),'data:image/png;base64,AAAA');run.icons.dispose();
  mtime=2;run=open();run.icons.get(exe,true);await run.done;await run.icons.flush();assert.equal(calls,2);run.icons.dispose();
  fs.writeFileSync(path.join(directory,'icons-v1.json'),'{broken');run=open();run.icons.get(exe,true);await run.done;await run.icons.flush();assert.equal(calls,3);assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'icons-v1.json'),'utf8')).schema,1);
});
