'use strict';
const { fixtureExecutable } = require('./fixture-paths.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PermissionService } = require('../src/permissions.cjs');
const { createRuntime } = require('../src/runtime.cjs');

// Retain the complete runtime -> owner -> cosmetic provider boundary. UIA work
// must remain semantic, including every newly resolved macro target.
test('UIA actions and macro steps visualize their current element without pointer input', async t => {
  const root = path.resolve(__dirname, '../artifacts/verification/unit');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'uia-cursor-'));
  const permissions = new PermissionService({ directory, selfExecutables: [fixtureExecutable("WindowUse/WindowUse.exe")] });
  permissions.save({ mode: 'full' });
  const window = { hwnd:'1234', pid:100, processCreated:'abcd', executable:fixtureExecutable("Apps/Editor.exe"), title:'fixture', minimized:false, widthPx:300, heightPx:200, dpi:144 };
  const geometry = { originX:-300, originY:200, widthPx:300, heightPx:200, dpi:144 };
  const events = [];
  let sequence = 0, failAction = false;
  const backend = {
    async request(method, args) {
      if (method === 'listWindows') return [window];
      if (method === 'status') return { window, captureGeometry:geometry };
      if (method === 'inspect') {
        sequence++;
        return { window, observationId:'obs-'+sequence, elementsTruncated:false,
          elements:[{id:'element-'+sequence, name:'Target', controlType:'Button', enabled:true, patterns:['invoke','setValue']}] };
      }
      if (method === 'observe') return { window, observationId:'image-'+sequence, frameTimestamp:'1',
        ...geometry, captureGeometry:geometry, elements:[], elementsTruncated:false, image:{mimeType:'image/png',data:'aGVsbG8='} };
      if (method === 'actionPoint') {
        assert.equal(args.observationId, 'obs-'+sequence);
        assert.equal(args.elementId, 'element-'+sequence);
        events.push(['point', args.elementId]);
        return { x:-250+sequence, y:240+sequence };
      }
      if (method === 'act') {
        events.push(['act', args.action, args.elementId, args.value]);
        if (failAction) throw Error('fixture semantic failure');
        return {window};
      }
      throw Error('Unexpected native request: '+method);
    },
    async dispose() {}
  };
  const input = {
    async visualize(thread, target, packet, guard) { await guard(); assert.deepEqual(target, Object.fromEntries(['hwnd','pid','processCreated','executable','title','minimized','widthPx','heightPx','dpi'].map(k=>[k,window[k]]))); events.push(['visual',packet]); },
    async input() { assert.fail('UIA must not send pointer or keyboard input'); },
    async release() { events.push(['release']); }, async dispose() {}
  };
  const runtime = createRuntime({ directory, permissions, backend, switchedInput:input });
  t.after(async () => {
    try { await runtime.dispose(); } finally { permissions.dispose(); fs.rmSync(directory,{recursive:true}); assert.equal(fs.existsSync(directory),false); }
  });
  const windowId = (await runtime.call('list_windows',{})).candidates[0].windowId;
  for (const [tool, extra, action] of [['invoke',{},'invoke'],['set_value',{value:'sample'},'setValue'],['press_key',{key:'Tab'},'pressKey'],['toggle',{},'toggle'],['select',{},'select'],['expand',{},'expand'],['collapse',{},'collapse'],['scroll',{value:{horizontal:0,vertical:1}},'scroll']]) {
    const observation = await runtime.call('inspect',{windowId});
    events.length = 0;
    await runtime.call(tool,{windowId,observationId:observation.observationId,elementId:observation.elements[0].id,...extra});
    assert.deepEqual(events.map(e=>e[0]),['point','visual','act','visual']);
    assert.deepEqual(events[1][1],{x:-250+sequence,y:240+sequence,phase:'active',click:tool==='invoke'});
    assert.equal(events[2][1],action);
    assert.deepEqual(events[3][1],{x:-250+sequence,y:240+sequence,phase:'idle'});
  }
  events.length = 0;
  const result = await runtime.call('run_task_macro',{windowId,definition:{schema:1,steps:[
    {action:'invoke',selector:{name:'Target'}},
    {action:'set_value',selector:{name:'Target'},value:'macro'}
  ]}});
  assert.equal(result.status,'completed');
  assert.deepEqual(events.map(e=>e[0]),['point','visual','act','visual','point','visual','act','visual']);
  assert.notEqual(events[0][1],events[4][1],'macro must resolve and visualize each fresh element');
  assert.notDeepEqual(events[1][1],events[5][1],'macro cursor must follow current target geometry');

  const observation = await runtime.call('inspect',{windowId});
  events.length = 0; failAction = true;
  await assert.rejects(runtime.call('invoke',{windowId,observationId:observation.observationId,elementId:observation.elements[0].id}));
  assert.ok(events.some(e=>e[0]==='release') || events.at(-1)[1]?.phase==='idle',
    'failed semantic action must retire or idle its cursor under existing failure guards');
});
