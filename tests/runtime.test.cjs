'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PermissionService } = require('../src/permissions.cjs');
const { createRuntime } = require('../src/runtime.cjs');

// Retain the real runtime/owner boundary: future callback rewiring must preserve
// protected-title suppression, capture masking and policy checks after native work.
test('runtime routes protected observation and desktop capture through actual permission callbacks', async t => {
  const root = path.resolve(__dirname, '../artifacts/verification/unit');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'runtime-'));
  const self = 'C:\\WindowUse\\WindowUse.exe';
  const privateApp = 'C:\\Apps\\Private.exe';
  const permissions = new PermissionService({ directory, selfExecutables: [self] });
  const requests = [];
  let duringCapture = () => {};
  const window = (executable, hwnd, title) => ({ executable, hwnd, title, pid: 100 + Number(hwnd), processCreated: 'abc', minimized: false, widthPx: 440, heightPx: 640, dpi: 96 });
  const image = { redacted: true, originX: 0, originY: 0, maskedWindowCount: 2, widthPx: 100, heightPx: 100, image: { mimeType: 'image/png', data: 'aGVsbG8=' } };
  const backend = {
    async request(method, args) {
      requests.push({ method, args });
      if (method === 'listWindows') return [window(self, '1', 'Private approval request'), window(privateApp, '2', 'Private document'), window('C:\\Apps\\Editor.exe', '3', 'Public document')];
      if (method === 'captureDesktop') { duringCapture(); return image; }
      throw new Error(`Unexpected native operation: ${method}`);
    },
    async dispose() {}
  };
  const runtime = createRuntime({ directory, permissions, backend });
  t.after(async () => {
    try { await runtime.dispose(); } finally {
      permissions.dispose();
      fs.rmSync(directory, { recursive: true });
      assert.equal(fs.existsSync(directory), false);
    }
  });
  permissions.save({ protectedApps: [privateApp], mode: 'observe' });
  const context = await runtime.call('context', {});
  assert.equal(context.permissions.control, 'observe');
  assert.equal(context.permissions.desktopControlGranted, false);
  const list = await runtime.call('list_windows', {});
  assert.deepEqual(list.candidates.map(item => item.title), ['', '', 'Public document']);
  const capture = await runtime.call('capture_desktop', {});
  assert.equal(capture.redacted, true);
  assert.equal(typeof capture.observationId, 'string');
  assert.deepEqual(requests.find(item => item.method === 'captureDesktop').args.blockedApps, ['c:\\apps\\private.exe', 'c:\\windowuse\\windowuse.exe']);
  const before = requests.length;
  await assert.rejects(runtime.call('capture', { windowId: list.candidates[0].windowId }), { code: 'security_app_blocked', actionExecuted: false });
  assert.equal(requests.length, before, 'protected app must be rejected before native capture');

  // Policy changes while native capture is running cannot return an old image.
  duringCapture = () => permissions.save({ mode: 'ask' });
  await assert.rejects(runtime.call('capture_desktop', {}), { code: 'policy_changed', actionExecuted: false });
  duringCapture = () => {};
  const controller = new AbortController(); controller.abort();
  const cancelledBefore = requests.length;
  await assert.rejects(runtime.call('capture_desktop', {}, controller.signal), { code: 'cancelled', actionExecuted: false });
  assert.equal(requests.length, cancelledBefore);
  permissions.stop();
  await assert.rejects(runtime.call('list_windows', {}), { code: 'user_stopped', actionExecuted: false });
});
