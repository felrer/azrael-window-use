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
  for (const name of ['windowCapture', 'windowRestore', 'windowResize', 'desktopCapture', 'desktopControl', 'switchedInput', 'independentPointer', 'coordinateInput', 'windowKeyInput']) {
    assert.equal(capabilities[name], false, name);
  }
});
test('Linux helper reports unavailable GI as a typed dependency error', { skip: !available }, () => {
  const replies = run(['-S', 'native/linux/linux_backend.py'], '{"id":"caps","method":"capabilities","params":{}}\n{"id":"done","method":"shutdown","params":{}}\n');
  assert.equal(replies[0].id, 'caps');
  assert.equal(replies[0].error.code, 'dependency-missing');
  assert.deepEqual(replies[1], { id: 'done', result: { shutdown: true } });
});
