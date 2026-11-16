'use strict';
const { fixtureExecutable, expectedExecutable } = require('./fixture-paths.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { PermissionService } = require('../src/permissions.cjs');

// Retain these checks against future edits that reorder protected-app guards,
// broaden grant persistence, or omit cancellation when policy/connections change.
const SELF = fixtureExecutable("WindowUse/WindowUse.exe");
const SELF_ALIAS = process.platform === 'win32' ? 'c:/WINDOWUSE/child/../WINDOWUSE.EXE' : '/WindowUse/child/../WindowUse.exe';
const APP = { executable: fixtureExecutable("Apps/Editor.exe") };
const PROTECTED = { executable: fixtureExecutable("Apps/Private.exe") };
const code = expected => error => error.code === expected && error.actionExecuted === false;
function fixture(t, options = {}) {
  const root = path.resolve(__dirname, '../artifacts/verification/unit');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'permissions-'));
  const services = [];
  const open = extra => {
    const service = new PermissionService({ directory, selfExecutables: [SELF], ...options, ...extra });
    services.push(service); return service;
  };
  t.after(() => {
    for (const service of services) service.dispose();
    fs.rmSync(directory, { recursive: true });
    assert.equal(fs.existsSync(directory), false);
  });
  return { directory, open };
}
function pending(service, identity = APP, permission = 'control', signal) {
  const result = service.request(identity, permission, signal);
  // Attach rejection immediately, including while a later operation invalidates it.
  result.catch(() => {});
  const approval = service.approvals().at(-1);
  assert.ok(approval, 'the request must await approval');
  return { result, id: approval.id };
}

test('self identity stays normalized and locked; no mode or grant bypasses protected apps', async t => {
  const f = fixture(t); const service = f.open();
  service.save({ protectedApps: [PROTECTED.executable], allowedApps: [PROTECTED.executable] });
  assert.deepEqual(service.snapshot().protectedApps.find(app => app.locked), {
    executable: expectedExecutable("WindowUse/WindowUse.exe"), label: process.platform === 'win32' ? 'windowuse.exe' : 'WindowUse.exe', locked: true
  });
  assert.throws(() => service.save({ allowedApps: [SELF_ALIAS] }), code('security_app_blocked'));
  for (const mode of ['ask', 'observe', 'full']) {
    service.save({ mode });
    for (const identity of [{ executable: SELF_ALIAS }, PROTECTED]) {
      for (const permission of ['control', 'observation', 'desktop']) {
        assert.equal(service.allowed(identity, permission), false);
        await assert.rejects(service.request(identity, permission), code('security_app_blocked'));
      }
    }
  }
  service.save({ mode: 'ask' });
  const desktop = pending(service, null, 'desktop');
  service.respond(desktop.id, 'session'); await desktop.result;
  assert.equal(service.allowed(APP), true);
  assert.equal(service.allowed(PROTECTED), false);
  assert.equal(service.allowed({ executable: SELF_ALIAS }), false);
  await assert.rejects(service.request({ executable: SELF_ALIAS }), code('security_app_blocked'));
  service.save({ protectedApps: [] });
  assert.equal(service.blocked({ executable: SELF_ALIAS }), true, 'removing custom protection cannot remove self');

  // Even a schema-valid edited file cannot turn the app's own UI into an allowed app.
  const saved = JSON.parse(fs.readFileSync(service.file, 'utf8'));
  fs.writeFileSync(service.file, JSON.stringify({ ...saved, allowedApps: [expectedExecutable("WindowUse/WindowUse.exe")] }));
  service.dispose(); const reopened = f.open();
  assert.equal(reopened.allowed({ executable: SELF_ALIAS }), false);
  await assert.rejects(reopened.request({ executable: SELF_ALIAS }), code('security_app_blocked'));
});

test('observe permits observation but blocks app and desktop input; full needs no app approval', async t => {
  const service = fixture(t).open();
  service.save({ mode: 'observe', allowedApps: [APP.executable] });
  assert.equal(await service.request(APP, 'observation'), true);
  assert.equal(service.allowed(APP, 'control'), false);
  assert.equal(service.allowed(null, 'desktop'), false);
  await assert.rejects(service.request(APP), code('permission_denied'));
  await assert.rejects(service.request(null, 'desktop'), code('permission_denied'));
  assert.deepEqual(service.approvals(), []);
  service.save({ mode: 'full' });
  assert.equal(await service.request(APP), true);
  assert.deepEqual(service.approvals(), []);
});

test('policy change and Stop cancel pending approvals and revoke connection grants', async t => {
  const f = fixture(t);
  const service = f.open();
  for (const [change, expected] of [
    [() => service.save({ mode: 'observe' }), 'policy_changed'],
    [() => service.stop(), 'user_stopped']
  ]) {
    service.save({ mode: 'ask' }); service.resume();
    const granted = pending(service);
    service.respond(granted.id, 'session'); await granted.result;
    assert.equal(service.allowed(APP), true);
    const request = pending(service, { executable: fixtureExecutable("Apps/Other.exe") });
    change();
    await assert.rejects(request.result, code(expected));
    assert.deepEqual(service.approvals(), []);
    assert.equal(service.allowed(APP), false);
    assert.equal(service.allowed(null, 'desktop'), false);
    assert.throws(() => service.respond(request.id, 'session'), code('approval_expired'));
  }
  await assert.rejects(service.request(APP), code('user_stopped'));
  service.resume();
  const desktop = pending(service, null, 'desktop');
  service.respond(desktop.id, 'session'); await desktop.result;
  assert.equal(service.allowed(null, 'desktop'), true);
  service.stop(); service.resume();
  assert.equal(service.allowed(null, 'desktop'), false);
  const request = pending(service); service.dispose();
  await assert.rejects(request.result, code('disconnected'));
  assert.throws(() => service.respond(request.id, 'session'), code('approval_expired'));

  const first = f.open(); const second = f.open();
  for (const [patch, decision, responseError] of [
    [{ mode: 'observe' }, 'session', 'approval_expired'],
    [{ mode: 'observe' }, 'always', 'approval_expired'],
    [{ protectedApps: [APP.executable] }, 'session', 'security_app_blocked']
  ]) {
    first.save({ mode: 'ask', protectedApps: [] });
    second.allowed(APP); // Synchronize the second writer before its next save.
    const stale = pending(first);
    second.save(patch);
    // No await or watcher tick: respond must recheck its record after disk sync.
    assert.throws(() => first.respond(stale.id, decision), code(responseError));
    await assert.rejects(stale.result, code('policy_changed'));
    assert.equal(first.allowed(APP), false);
    assert.deepEqual(first.snapshot().allowedApps, []);
    assert.deepEqual(first.approvals(), []);
  }
  for (const patch of [{ mode: 'observe' }, { protectedApps: [APP.executable] }]) {
    first.save({ mode: 'full', protectedApps: [] });
    assert.equal(first.allowed(APP), true);
    second.allowed(APP);
    second.save(patch);
    assert.equal(first.allowed(APP), false, 'next native permission check must observe the other process immediately');
    if (patch.protectedApps) {
      assert.equal(first.blocked(APP), true);
      assert.equal(first.allowed(APP, 'observation'), false);
    }
  }
});

test('cancellation, denial and timeout never grant; late responses cannot revive requests', async t => {
  const service = fixture(t, { approvalTimeoutMs: 25 }).open();
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(service.request(APP, 'control', aborted.signal), code('cancelled'));
  assert.deepEqual(service.approvals(), []);
  const controller = new AbortController();
  const cancelled = pending(service, APP, 'control', controller.signal); controller.abort();
  await assert.rejects(cancelled.result, code('cancelled'));
  assert.throws(() => service.respond(cancelled.id, 'always'), code('approval_expired'));
  const denied = pending(service); service.respond(denied.id, 'deny');
  await assert.rejects(denied.result, code('approval_denied'));
  assert.throws(() => service.respond(denied.id, 'session'), code('approval_expired'));
  const expired = pending(service);
  await assert.rejects(expired.result, code('approval_timeout'));
  assert.throws(() => service.respond(expired.id, 'always'), code('approval_expired'));
  assert.equal(service.allowed(APP), false);
  assert.deepEqual(service.snapshot().allowedApps, []);
  assert.deepEqual(service.approvals(), []);
});

test('session grants disappear on a new connection; permanent app grants survive', async t => {
  const f = fixture(t); const session = f.open();
  const request = pending(session); session.respond(request.id, 'session'); await request.result;
  assert.equal(session.allowed(APP), true);
  assert.deepEqual(session.snapshot().allowedApps, []);
  session.dispose();
  const permanent = f.open(); assert.equal(permanent.allowed(APP), false);
  const app = pending(permanent); permanent.respond(app.id, 'always'); await app.result;
  assert.equal(permanent.allowed(APP), true); permanent.dispose();
  const reopened = f.open();
  assert.equal(reopened.allowed(APP), true);
  assert.deepEqual(reopened.snapshot().allowedApps.map(item => item.executable), [expectedExecutable("Apps/Editor.exe")]);
  assert.equal(reopened.allowed(null, 'desktop'), false);
  const desktop = pending(reopened, null, 'desktop');
  assert.throws(() => reopened.respond(desktop.id, 'always'), code('invalid_arguments'));
  reopened.respond(desktop.id, 'deny'); await assert.rejects(desktop.result, code('approval_denied'));
});

test('corrupt settings reject startup and fail closed for an active service', async t => {
  const f = fixture(t); const file = path.join(f.directory, 'permissions.json');
  for (const content of ['{broken', '{}', JSON.stringify({ schema: 1, revision: 0, enabled: true, mode: 'full', protectedApps: [], allowedApps: ['invalid.exe'], theme: 'system' })]) {
    fs.writeFileSync(file, content);
    assert.throws(() => f.open());
  }
  fs.unlinkSync(file);
  const service = f.open(); service.save({ mode: 'full' });
  assert.equal(service.allowed(APP), true);
  const invalidated = once(service, 'invalidate', { signal: AbortSignal.timeout(3000) });
  fs.writeFileSync(file, '{broken');
  assert.equal((await invalidated)[0], 'invalid_settings');
  assert.equal(service.allowed(APP), false);
  await assert.rejects(service.request(APP), code('permission_denied'));
});
