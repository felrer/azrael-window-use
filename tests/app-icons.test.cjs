'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppIcons } = require('../src/app-icons.cjs');
const settle = () => new Promise(resolve => setImmediate(resolve));
test('icon cache deduplicates trusted local identities and bounds concurrency', async () => {
  let calls=0, active=0, peak=0, changes=0;
  const finish=[];
  const icons=createAppIcons({concurrency:2,getFileIcon:async()=>{calls++;active++;peak=Math.max(peak,active);await new Promise(resolve=>finish.push(resolve));active--;return {isEmpty:()=>false,toDataURL:()=> 'data:image/png;base64,AAAA'};},changed:()=>changes++});
  assert.equal(icons.get('\\\\server\\share\\app.exe'),null);
  assert.equal(icons.get('relative.exe'),null);
  icons.get('C:\\Apps\\a.exe');icons.get('C:\\Apps\\a.exe');icons.get('C:\\Apps\\b.exe');icons.get('C:\\Apps\\c.exe');
  await settle();assert.equal(calls,2);assert.equal(peak,2);
  finish.shift()();await settle();assert.equal(calls,3);
  for(const resolve of finish)resolve();await settle();
  assert.equal(icons.get('C:\\Apps\\a.exe'),'data:image/png;base64,AAAA');assert.equal(changes,3);icons.dispose();
});
test('missing icons fall back without repeated extraction; disposal stops notifications',async()=>{
  let calls=0,changes=0;
  const icons=createAppIcons({getFileIcon:async()=>{calls++;throw Error('unreadable')},changed:()=>changes++});
  icons.get('C:\\Apps\\missing.exe');await settle();assert.equal(icons.get('C:\\Apps\\missing.exe'),null);assert.equal(calls,1);assert.equal(changes,1);icons.dispose();assert.equal(icons.get('C:\\Apps\\new.exe'),null);
  let release;const pending=createAppIcons({getFileIcon:()=>new Promise(resolve=>{release=resolve}),changed:()=>changes++});
  pending.get('C:\\Apps\\pending.exe');await settle();pending.dispose();release({isEmpty:()=>false,toDataURL:()=> 'data:image/png;base64,AAAA'});await settle();assert.equal(changes,1);
});
