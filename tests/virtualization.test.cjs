'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {summarizeVirtualizedCases}=require('../scripts/verify-virtualized-input.cjs');
const effects=()=>['virtualized button click','virtualized text'].map(label=>({label,isError:false,postcondition:true,collaboration:{enabled:true},externalEventDelta:{mouse:1,keyboard:1}}));
test('external mouse and keyboard events do not invalidate verified virtualized effects',()=>{
  assert.equal(summarizeVirtualizedCases(effects()).passed,true);
});
test('delivery errors remain failures even when the app effect happened',()=>{
  const cases=effects();cases[0].isError=true;
  assert.equal(summarizeVirtualizedCases(cases).passed,false);
  assert.equal(summarizeVirtualizedCases(cases).verdict,'failed');
});
test('effects outside virtualization cannot establish virtualized acceptance',()=>{
  const cases=effects();cases[1].collaboration.enabled=false;
  assert.equal(summarizeVirtualizedCases(cases).passed,false);
});
test('cumulative counters and mouse-only coverage do not establish keyboard concurrency',()=>{
  const cases=effects();for(const c of cases){c.externalEventDelta.keyboard=0;c.interference={foreignKeyboardEvents:10};}
  assert.equal(summarizeVirtualizedCases(cases).passed,false);
  assert.equal(summarizeVirtualizedCases(cases).verdict,'incomplete_external_input_coverage');
});
test('mouse-keyboard acceptance checks drag effects without requiring model text input',()=>{
  const cases=effects();cases[1].label='virtualized keyboard-concurrent drag';
  assert.equal(summarizeVirtualizedCases(cases,true).passed,true);
  cases[1].postcondition=false;
  assert.equal(summarizeVirtualizedCases(cases,true).passed,false);
});
