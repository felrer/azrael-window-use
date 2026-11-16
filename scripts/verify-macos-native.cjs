'use strict';
// Non-GUI protocol checks deliberately do not request AX or Screen Recording access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
if (process.platform !== 'darwin') throw new Error('Native verification requires macOS');
const output = path.resolve(process.argv[2] || path.join(__dirname, '../artifacts/runtime/window-control'));
const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
assert.equal(manifest.platform, 'darwin'); assert.equal(manifest.arch, process.arch);
for (const file of manifest.files) {
  assert.equal(file.path, 'azrael-window-control-macos');
  const data = fs.readFileSync(path.join(output, file.path));
  assert.equal(data.length, file.bytes);
  assert.equal(crypto.createHash('sha256').update(data).digest('hex'), file.sha256);
}
const requests = [
  { id: 1, method: 'capabilities', params: {} },
  { id: 2, method: 'actionPoint', params: {} },
  { id: 3, method: 'captureDesktop', params: { blockedApps: [] } },
  { id: 4, method: 'status', params: {} },
  { id: 5, method: 'noSuchMethod', params: {} },
  { id: 7, method: 'status', params: { window: { hwnd: 'ffffffff', pid: 2147483647, processCreated: '1', executable: '/nonexistent' } } },
  { id: 6, method: 'shutdown', params: {} },
];
const result = spawnSync(path.join(output, manifest.entry), [], { input: requests.map(r => JSON.stringify(r)).join('\n')+'\n', encoding: 'utf8', timeout: 20000, maxBuffer: 4*1024*1024 });
if (result.error) throw result.error;
assert.equal(result.status, 0, result.stderr);
const responses = result.stdout.trim().split('\n').map(line => JSON.parse(line));
assert.equal(responses.length, requests.length);
responses.forEach((r, i) => assert.equal(r.id, requests[i].id));
assert.equal(responses[0].result.platform, 'darwin');
assert.equal(typeof responses[0].result.accessibilityTrusted, 'boolean');
assert.equal(typeof responses[0].result.screenCaptureAllowed, 'boolean');
assert.equal(typeof responses[0].result.guiSessionAvailable, 'boolean');
assert.equal(responses[0].result.coordinateInput, false);
assert.equal(responses[0].result.actionVisualization, true);
assert.equal(responses[1].error.code, 'invalid-params');
assert.equal(responses[2].error.code, 'unsupported-action');
assert.equal(responses[3].error.code, 'invalid-params');
assert.equal(responses[4].error.code, 'unknown-method');
assert.equal(responses[5].error.code, responses[0].result.guiSessionAvailable ? 'window-closed' : 'permission_denied');
assert.equal(responses[6].result.shutdown, true);
console.log(JSON.stringify({ passed: true, checks: requests.length, capabilities: responses[0].result, guiValidated: false }));
