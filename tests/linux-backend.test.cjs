'use strict';
// Retain protocol/lazy-dependency and Wayland classification checks: later runtime
// entry edits can otherwise reintroduce an unconditional X11/GI startup path.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const python = process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || '', 'Programs/Python/Python313/python.exe') : '/usr/bin/python3';
const available = fs.existsSync(python);
function run(args, input, env = {}) {
  const result = spawnSync(python, ['-B', ...args], {
    cwd: root, encoding: 'utf8', input, env: { ...process.env, ...env }, timeout: 10000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split('\n').map(line => JSON.parse(line));
}
test('Linux helper validates JSONL and shuts down without GUI dependencies', { skip: !available }, () => {
  const replies = run(['native/linux/linux_backend.py'], [
    '[]', '{"id":"bad","method":"inspect","params":[]}',
    '{"id":"release","method":"overlayHide","params":{}}',
    '{"id":"unsupported","method":"captureDesktop","params":{}}',
    '{"id":"shutdown","method":"shutdown","params":{}}', '',
  ].join('\n'));
  assert.equal(replies[0].error.code, 'invalid-request');
  assert.equal(replies[1].id, 'bad');
  assert.equal(replies[1].error.code, 'invalid-request');
  assert.deepEqual(replies[2], { id: 'release', result: { hidden: true } });
  assert.equal(replies[3].error.code, 'unsupported-action');
  assert.deepEqual(replies[4], { id: 'shutdown', result: { shutdown: true } });
});
test('Wayland with Xwayland DISPLAY never advertises X11 capture or input', { skip: !available }, () => {
  const source = `import importlib.util,json
s=importlib.util.spec_from_file_location('entry','native/linux/linux_backend.py')
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
print(json.dumps(m.capabilities(m.session_kind())))`;
  const [capabilities] = run(['-c', source], '', { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0', XDG_SESSION_TYPE: 'wayland' });
  assert.equal(capabilities.sessionType, 'wayland');
  assert.equal(capabilities.windowUIAControl, true);
  for (const name of ['windowCapture', 'windowRestore', 'windowResize', 'desktopCapture', 'desktopControl', 'switchedInput', 'independentPointer', 'coordinateInput', 'windowKeyInput', 'actionVisualization']) {
    assert.equal(capabilities[name], false, name);
  }
});
test('X11 visual point clips retained element bounds and refuses stale observations', { skip: !available }, () => {
  // Isolate the real provider class from unavailable Linux GI imports; X11 and
  // AT-SPI are fixture boundaries, never an alternative product implementation.
  const source = `import ast,json,types
p='native/window-control/src/linux_backend.py'
tree=ast.parse(open(p,encoding='utf-8').read())
scope={}
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.ClassDef) and n.name in ('Failure','Backend')],type_ignores=[]),p,'exec'),scope)
S=types.SimpleNamespace
scope['Atspi']=S(StateType=S(ENABLED=1,VISIBLE=2,SHOWING=3),CoordType=S(SCREEN=0))
w=dict(hwnd='abc',pid=99,processCreated='123',executable='/app',minimized=False)
geometry=(100,200,400,300)
b=scope['Backend'].__new__(scope['Backend'])
b.x=S(verify=lambda requested:w,geometry=lambda current:geometry)
root=object()
element=S(get_parent=lambda:root,get_process_id=lambda:99,get_state_set=lambda:S(contains=lambda state:True),get_component_iface=lambda:S(get_extents=lambda coord:S(x=80,y=210,width=60,height=40)))
b.accessible_root=lambda current:root
b.observation=('obs',{k:w[k] for k in ('hwnd','pid','processCreated','executable')},{'e':(element,{},root)},geometry)
p=dict(window=w,observationId='obs',elementId='e')
point=b.call('actionPoint',p)
center=b.call('actionPoint',dict(window=w,observationId='obs'))
try:
    b.call('actionPoint',dict(p,observationId='stale'))
    stale=None
except scope['Failure'] as error:
    stale=error.code
print(json.dumps(dict(point=point,center=center,stale=stale,retained=b.observation[0])))`;
  const [result] = run(['-c', source], '');
  assert.deepEqual(result, { point: { x: 120, y: 230 }, center: { x: 300, y: 350 }, stale: 'stale-observation', retained: 'obs' });
});
test('Linux helper reports unavailable GI as a typed dependency error', { skip: !available }, () => {
  const replies = run(['-S', 'native/linux/linux_backend.py'], '{"id":"caps","method":"capabilities","params":{}}\n{"id":"done","method":"shutdown","params":{}}\n');
  assert.equal(replies[0].id, 'caps');
  assert.equal(replies[0].error.code, 'dependency-missing');
  assert.deepEqual(replies[1], { id: 'done', result: { shutdown: true } });
});
