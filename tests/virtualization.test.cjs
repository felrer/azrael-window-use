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
test('batch effects pass without external events but physical reservation coverage requires buffering',()=>{
  const effect={label:'virtualized batch',isError:false,postcondition:true,collaboration:{enabled:true},batch:{completedSteps:4,completed:true},
    keyboardReservation:{restored:true,pending:false,active:false,bufferedEvents:0},externalEventDelta:{mouse:0,keyboard:0}};
  const summary=()=>summarizeVirtualizedCases([effect],false,true);
  assert.equal(summary().verdict,'passed');assert.equal(summary().externalReservationConcurrency,'unverified');
  effect.externalEventDelta.keyboard=3;
  assert.equal(summary().externalReservationConcurrencyVerified,false);
  effect.keyboardReservation.bufferedEvents=3;
  assert.equal(summary().externalReservationConcurrencyVerified,true);
  effect.postcondition=false;
  assert.equal(summary().verdict,'failed');
});
test('batch distinguishes capability blocking and incomplete restoration from passing effects',()=>{
  assert.equal(summarizeVirtualizedCases([{label:'virtualized batch',blocked:'not requested'}],false,true).verdict,'capability_blocked');
  const effect={label:'virtualized batch',isError:false,postcondition:true,collaboration:{enabled:true},batch:{completedSteps:4,completed:true},
    keyboardReservation:{restored:false,pending:true,active:false}};
  assert.equal(summarizeVirtualizedCases([effect],false,true).verdict,'failed');
});
