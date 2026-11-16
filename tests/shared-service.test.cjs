'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const registry = require('../src/service-registry.cjs');
const { createSharedService } = require('../src/shared-service.cjs');
const { createServiceClient } = require('../src/shared-client.cjs');
const root = path.join(__dirname, '..', 'artifacts', 'verification', 'unit');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t) {
  const directory = path.join(root, `shared-service-${crypto.randomUUID()}`);
  // This retained test owns only this fresh UUID directory. All hosts and socket
  // readers are stopped before ordinary removal; no application state is used.
  await fs.mkdir(directory, { recursive: true });
  const identity = path.join(directory, 'identity.txt'); await fs.writeFile(identity, 'test service identity');
  const digest = crypto.createHash('sha256').update(await fs.readFile(identity)).digest('hex');
  const candidate = { id: 'test-v1', version: '1.0.0', protocol: 1, schema: 1, executable: process.execPath, args: ['--version'], files: [{ path: identity, sha256: digest }] };
  const cleanup = [];
  t.after(async () => {
    for (const fn of cleanup.reverse()) await fn();
    await fs.rm(directory, { recursive: true });
    await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
  });
  return { directory, candidate, cleanup };
}
test('registry validates source identities and selects newest compatible installed candidate', async t => {
  const f = await fixture(t); await registry.prepareDirectory(f.directory);
  await Promise.all(Array.from({ length: 4 }, () => registry.registerCandidate(f.directory, f.candidate)));
  await registry.registerCandidate(f.directory, { ...f.candidate, id: 'v2', version: '2.0.0' });
  await registry.registerCandidate(f.directory, { ...f.candidate, id: 'incompatible', version: '9.0.0', protocol: 2 });
  assert.equal((await registry.selectCandidate(f.directory)).id, 'v2');
  await fs.writeFile(path.join(f.directory, 'candidates', 'tampered.json'), JSON.stringify({ ...f.candidate, id: 'tampered', version: '99.0.0', executableSha256: '0'.repeat(64) }));
  assert.equal((await registry.selectCandidate(f.directory)).id, 'v2');
  await fs.unlink(f.candidate.files[0].path);
  assert.deepEqual(await registry.listCandidates(f.directory), []);
  await assert.rejects(registry.selectCandidate(f.directory), { code: 'incompatible_service' });
  assert.ok(registry.compareVersions('1.0.0', '1.0.0-rc.1') > 0);
  assert.ok(registry.compareVersions('1.0.0-rc.10', '1.0.0-rc.2') > 0);
});
test('real local transport isolates sessions, routes approvals/events, rejects bad auth and protocol', async t => {
  const f = await fixture(t); let disposed = 0;
  const service = await createSharedService({ ...f, createSession: ({ id, authorize, emit, options }) => ({
    async call(method, args, signal, context) {
      if (method === 'approve') return authorize(args, 'control', signal);
      if (method === 'event') { emit({ type: 'test' }); return true; }
      if (method === 'policy') return context.authorizationPolicy;
      if (method === 'failure') throw Object.assign(new Error('native uncertain'), { code: 'state_changed', actionExecuted: true, mutationOutcome: 'unknown', observationRequired: true, recovery: 'observe_again', nativeCode: 'delivery_uncertain', stage: 'input', diagnostic: { event: 'window_use.native_failure', method: 'act', elapsedMs: 12, responseCorrelated: false }, secret: 'must not travel' });
      return { id, options };
    }, async dispose() { disposed++; },
  }) }); f.cleanup.push(() => service.close());
  const events = [];
  const disconnects = [];
  const a = createServiceClient({ ...f, sessionOptions: { name: 'a' }, onEvent: (...args) => events.push(args), onDisconnect: detail => disconnects.push(detail) });
  const b = createServiceClient({ ...f }); f.cleanup.push(() => a.dispose(), () => b.dispose());
  const one = await a.call('same', 'identity'); const two = await b.call('same', 'identity');
  assert.notEqual(one.id, two.id); assert.equal(one.options.name, 'a');
  assert.equal(await a.call('same', 'approve', { target: 1 }, { authorize: async identity => identity.target === 1 }), true);
  assert.equal(await a.call('same', 'approve', {}, { authorize: async () => false }), false);
  await a.call('same', 'event'); await pause(10); assert.equal(events[0][0], 'same'); assert.equal(events[0][1].type, 'test');
  assert.deepEqual(await a.call('same', 'policy', {}, { authorizationPolicy: { blockedApps: ['a.exe'] } }), { blockedApps: ['a.exe'] });
  assert.deepEqual(await a.call('same', 'policy', {}, { authorizationPolicy: { blockedApps: ['b.exe'] } }), { blockedApps: ['b.exe'] });
  await assert.rejects(a.call('same', 'failure'), e => e.actionExecuted === true && e.mutationOutcome === 'unknown' && e.observationRequired === true && e.recovery === 'observe_again' && e.nativeCode === 'delivery_uncertain' && e.diagnostic.responseCorrelated === false && e.secret === undefined);
  const discovery = createServiceClient({ directory: f.directory }); f.cleanup.push(() => discovery.dispose());
  const metadata = await discovery.call('discovery', 'identity', {}, { sessionOptions: { authorizationRequired: true } });
  assert.equal(metadata.options.authorizationRequired, true);
  await assert.rejects(discovery.call('discovery', 'identity', {}, { sessionOptions: { authorizationRequired: false } }), { code: 'invalid_session' });
  await a.closeSession('same'); assert.equal(disposed, 1);
  await new Promise((resolve, reject) => {
    const s = net.createConnection(service.address); s.on('error', reject); s.on('connect', () => s.write(JSON.stringify({ type: 'hello', token: '0'.repeat(64), protocol: 1, schema: 1 }) + '\n')); s.on('close', resolve);
  });
  const incompatible = createServiceClient({ ...f, candidate: { ...f.candidate, id: 'protocol2', protocol: 2 } }); f.cleanup.push(() => incompatible.dispose());
  await assert.rejects(incompatible.ensure(), { code: 'incompatible_service' });
  assert.equal(disconnects.length, 0); a.dispose(); await pause(10); assert.deepEqual(disconnects, [{ reason: 'client_closed' }]);
});
test('disconnect aborts input and waits its cleanup before native session disposal', async t => {
  const f = await fixture(t); const order = []; let started;
  const began = new Promise(resolve => { started = resolve; });
  const service = await createSharedService({ ...f, createSession: () => ({
    async call(method, args, signal) { started(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); await pause(20); order.push('input-cleaned'); return true; },
    async dispose() { order.push('disposed'); },
  }) }); f.cleanup.push(() => service.close());
  const client = createServiceClient(f); f.cleanup.push(() => client.dispose());
  const result = client.call('input', 'hold'); const observed = assert.rejects(result, { code: 'outcome_unknown' });
  await began; client.dispose(); await observed; await service.close();
  assert.deepEqual(order, ['input-cleaned', 'disposed']);
});
test('client rejects a pipe peer that cannot prove possession of the private token', async t => {
  const f = await fixture(t); await registry.prepareDirectory(f.directory);
  await registry.registerCandidate(f.directory, f.candidate);
  const address = registry.addressFor(f.directory);
  const server = net.createServer(socket => { socket.on('error', () => {}); socket.once('data', () => socket.end(JSON.stringify({ type: 'hello', candidate: f.candidate, proof: '0'.repeat(64) }) + '\n')); });
  await new Promise(resolve => server.listen(address, resolve));
  f.cleanup.push(() => new Promise(resolve => server.close(resolve)));
  await registry.writeJson(path.join(f.directory, 'service.json'), { address, token: '1'.repeat(64) });
  const client = createServiceClient(f); f.cleanup.push(() => client.dispose());
  await assert.rejects(client.ensure(), { code: 'invalid_registry' });
});
test('service close freezes admission and drains approval plus call cleanup', async t => {
  const f = await fixture(t); const order = []; let approvalStarted, approve;
  const begun = new Promise(resolve => { approvalStarted = resolve; });
  const granted = new Promise(resolve => { approve = resolve; });
  const service = await createSharedService({ ...f, shutdown: async () => order.push('shutdown'), createSession: ({ authorize }) => ({
    async call(method, args, signal) { await authorize({}, 'control', signal); order.push('call'); return 123; },
    async dispose() { order.push('dispose'); },
  }) }); f.cleanup.push(() => service.close());
  const client = createServiceClient({ ...f, onApproval: async () => { approvalStarted(); return granted; } }); f.cleanup.push(() => client.dispose());
  const operation = client.call('a', 'input'); await begun;
  const closing = service.close(); assert.equal(service.status().draining, true);
  await assert.rejects(client.call('a', 'input'), { code: 'service_migrating' });
  assert.deepEqual(order, []); approve(true); assert.equal(await operation, 123); await closing;
  assert.deepEqual(order, ['call', 'dispose', 'shutdown']);
});
test('simultaneous lazy proxies launch one real host and reconnect after drained version takeover', async t => {
  const f = await fixture(t);
  const script = path.join(f.directory, 'host.cjs');
  const modulePath = path.join(__dirname, '..', 'src', 'shared-service.cjs');
  await fs.writeFile(script, `const fs=require('node:fs/promises'),crypto=require('node:crypto');const {createSharedService}=require(${JSON.stringify(modulePath)});(async()=>{const version=process.argv[2],directory=process.env.AZ_WINDOW_USE_SHARED_DIRECTORY;const candidate={id:'host-'+version,version,protocol:1,schema:1,executable:process.execPath,args:[__filename,version],files:[{path:__filename,sha256:crypto.createHash('sha256').update(await fs.readFile(__filename)).digest('hex')}]};const service=await createSharedService({directory,candidate,shutdown:async()=>{},createSession:()=>({call:async(method)=>{if(method==='shutdown'){setTimeout(()=>service.close().then(()=>process.exit(0)),25);return true;}return {version,pid:process.pid};},dispose:async()=>{}})});})().catch(()=>process.exit(1));`);
  const sha256 = crypto.createHash('sha256').update(await fs.readFile(script)).digest('hex');
  const candidate = { ...f.candidate, id: 'host-1.0.0', args: [script, '1.0.0'], files: [{ path: script, sha256 }] };
  const a = createServiceClient({ ...f, candidate }), b = createServiceClient({ ...f, candidate });
  let live;
  f.cleanup.push(async () => {
    if (live) {
      try { await a.call('cleanup', 'shutdown'); } catch {}
      for (let i = 0; i < 100; i++) { try { process.kill(live, 0); } catch (e) { if (e.code === 'ESRCH') break; throw e; } await pause(30); }
      assert.throws(() => process.kill(live, 0), { code: 'ESRCH' });
    }
    a.dispose(); b.dispose();
  });
  const [x, y] = await Promise.all([a.call('a', 'identity'), b.call('b', 'identity')]);
  assert.equal(x.pid, y.pid); live = x.pid;
  const c = createServiceClient({ ...f, candidate: { ...candidate, id: 'host-2.0.0', version: '2.0.0', args: [script, '2.0.0'] } });
  f.cleanup.push(() => c.dispose());
  const z = await c.call('c', 'identity'); live = z.pid;
  assert.equal(z.version, '2.0.0'); assert.notEqual(z.pid, x.pid);
  const again = await a.call('a', 'identity'); assert.equal(again.pid, z.pid);
});
