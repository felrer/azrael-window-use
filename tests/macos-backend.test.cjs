'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
test('macOS build rejects a non-macOS host before creating output', { skip: process.platform === 'darwin' }, () => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/build-macos.cjs')], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be built on macOS/);
});
test('macOS native helper protocol and manifest integrity', { skip: process.platform !== 'darwin' || !fs.existsSync(path.join(root, 'artifacts/runtime/window-control/manifest.json')) }, () => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/verify-macos-native.cjs')], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
