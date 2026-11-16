'use strict';
const net = require('node:net');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const registry = require('./service-registry.cjs');
const { errorPayload } = require('../vendor/azrael/window-control-errors.cjs');
const MAX_FRAME = 64 * 1024 * 1024;
function send(socket, data) { if (!socket.destroyed) socket.write(`${JSON.stringify(data)}\n`); }
function wire(socket, receive) {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', chunk => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > MAX_FRAME) { socket.destroy(); return; }
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      let message; try { message = JSON.parse(line); } catch { socket.destroy(); return; }
      Promise.resolve(receive(message)).catch(() => socket.destroy());
    }
  });
}
function serializeError(e) {
  return { ...errorPayload(e), code: typeof e?.code === 'string' ? e.code.slice(0, 128) : 'service_error', message: String(e?.message || 'Service request failed').slice(0, 2048) };
}
function stableOptions(value) {
  const text = JSON.stringify(value, (key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item);
  if (text.length > 65536 || !value || typeof value !== 'object' || Array.isArray(value)) throw registry.error('invalid_session', 'Invalid session metadata');
  return text;
}
const { launch } = registry;
async function createSharedService({ directory = registry.defaultDirectory(), candidate, createSession, shutdown = async () => {}, onClosed = () => {}, showSettings, log = () => {} }) {
  directory = await registry.prepareDirectory(directory);
  candidate = await registry.registerCandidate(directory, candidate);
  if (candidate.protocol !== registry.PROTOCOL || candidate.schema !== registry.SCHEMA) throw registry.error('incompatible_service', 'Host protocol/schema is unsupported');
  const address = registry.addressFor(directory);
  const release = await registry.acquireLock(directory);
  const sockets = new Set(), sessions = new Set(), active = new Set();
  let draining = false, closing, migration;
  const token = crypto.randomBytes(32).toString('hex');
  const server = net.createServer(socket => {
    sockets.add(socket);
    const local = new Map(), pending = new Map(), callbacks = new Map();
    const callContext = new AsyncLocalStorage();
    let authenticated = false, disconnected = false;
    const timer = setTimeout(() => socket.destroy(), 3000); timer.unref();
    socket.on('error', () => {});
    async function disposeSession(entry) {
      if (entry.disposing) return entry.disposing;
      entry.closed = true;
      entry.disposing = (async () => {
        for (const job of pending.values()) if (job.session === entry) job.controller.abort();
        await Promise.allSettled([...entry.calls]);
        const instance = await entry.instance;
        await instance.dispose();
        sessions.delete(entry); local.delete(entry.id);
      })();
      return entry.disposing;
    }
    socket.once('close', () => {
      clearTimeout(timer); disconnected = true; sockets.delete(socket);
      for (const job of pending.values()) job.controller.abort();
      for (const callback of callbacks.values()) callback.reject(registry.error('client_disconnected', 'Approval client disconnected'));
      callbacks.clear();
      for (const entry of local.values()) {
        const disposal = disposeSession(entry); active.add(disposal);
        disposal.catch(e => log('session_dispose_failed', serializeError(e))).finally(() => active.delete(disposal));
      }
    });
    const replyError = (id, e) => send(socket, { id, error: serializeError(e) });
    wire(socket, async message => {
      if (!message || typeof message !== 'object') return socket.destroy();
      if (!authenticated) {
        if (message.type !== 'hello' || !/^[a-f0-9]{64}$/.test(message.nonce || '') || !/^[a-f0-9]{64}$/.test(message.proof || '')) return socket.destroy();
        const expected = crypto.createHmac('sha256', token).update(`client:${message.nonce}`).digest('hex');
        if (!crypto.timingSafeEqual(Buffer.from(message.proof), Buffer.from(expected))) return socket.destroy();
        clearTimeout(timer);
        if (message.protocol !== candidate.protocol || message.schema !== candidate.schema) {
          send(socket, { type: 'hello', error: { code: 'incompatible_service', message: 'Service protocol/schema mismatch' } }); socket.end(); return;
        }
        const proof = crypto.createHmac('sha256', token).update(`server:${message.nonce}`).digest('hex');
        authenticated = true; send(socket, { type: 'hello', candidate, draining, proof }); return;
      }
      if (message.type === 'approvalResult') {
        const callback = callbacks.get(message.id); if (!callback) return;
        callbacks.delete(message.id);
        if (message.error) callback.reject(registry.error(message.error.code || 'approval_failed', message.error.message || 'Approval failed'));
        else callback.resolve(message.result);
        return;
      }
      if (message.type === 'cancel') { pending.get(message.id)?.controller.abort(); return; }
      if (message.type !== 'request' || typeof message.id !== 'string' || pending.has(message.id)) return socket.destroy();
      const id = message.id;
      if (message.method === '$status') return send(socket, { id, result: status() });
      if (message.method === '$upgrade') {
        send(socket, { id, result: { scheduled: true } });
        void upgrade().catch(e => log('service_upgrade_failed', serializeError(e))); return;
      }
      if (draining) return replyError(id, registry.error('service_migrating', 'Service is draining; request was not executed'));
      const controller = new AbortController();
      const job = { controller, session: null }; pending.set(id, job);
      const task = (async () => {
        if (typeof message.sessionId !== 'string' || !message.sessionId.length || message.sessionId.length > 256) throw registry.error('invalid_session', 'Session id is required');
        let entry = local.get(message.sessionId);
        if (message.method === '$closeSession') { if (entry) await disposeSession(entry); return null; }
        if (message.method === '$showSettings' || message.method === 'service.showSettings') { if (showSettings) await showSettings(); return null; }
        const optionsKey = stableOptions(message.options || {});
        if (!entry) {
          entry = { id: message.sessionId, closed: false, calls: new Set(), optionsKey };
          const authorize = (identity, permission, signal) => {
            if (disconnected || entry.closed) return Promise.reject(registry.error('client_disconnected', 'Approval client disconnected'));
            const callbackId = crypto.randomUUID();
            return new Promise((resolve, reject) => {
              const abort = () => { callbacks.delete(callbackId); send(socket, { type: 'cancelApproval', id: callbackId }); reject(registry.error('aborted', 'Approval cancelled')); };
              if (signal?.aborted) return abort();
              signal?.addEventListener('abort', abort, { once: true });
              const finish = fn => value => { signal?.removeEventListener('abort', abort); fn(value); };
              callbacks.set(callbackId, { resolve: finish(resolve), reject: finish(reject) });
              send(socket, { type: 'approval', id: callbackId, sessionId: entry.id, callId: callContext.getStore(), identity, permission });
            });
          };
          // The factory decides how untrusted options map to session policy. It
          // must never accept a client-supplied permission grant.
          entry.instance = Promise.resolve().then(() => createSession({ id: crypto.randomUUID(), clientSessionId: entry.id, authorize, emit: event => send(socket, { type: 'event', sessionId: entry.id, event }), options: message.options || {} }));
          local.set(entry.id, entry); sessions.add(entry);
        }
        if (entry.optionsKey !== optionsKey) throw registry.error('invalid_session', 'Session metadata changed; create a new session');
        if (entry.closed) throw registry.error('invalid_session', 'Session has closed');
        job.session = entry;
        const operation = callContext.run(id, async () => { const instance = await entry.instance; if (controller.signal.aborted) throw registry.error('aborted', 'Request cancelled'); return instance.call(message.method, message.args, controller.signal, { authorizationPolicy: message.authorizationPolicy }); });
        entry.calls.add(operation);
        try { return await operation; } finally { entry.calls.delete(operation); }
      })();
      active.add(task);
      try { send(socket, { id, result: await task }); } catch (e) { replyError(id, e); }
      finally { pending.delete(id); active.delete(task); }
    });
  });
  try {
    // Never remove a live endpoint. A stale Unix socket may be removed only after
    // its recorded process is observed absent while the startup lock is held.
    if (process.platform !== 'win32') {
      const old = await registry.readJson(path.join(directory, 'service.json')).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
      if (old) {
        try { process.kill(old.pid, 0); throw registry.error('service_busy', 'Previous host process still exists'); }
        catch (e) { if (e.code !== 'ESRCH') throw e; }
        await fs.unlink(address).catch(e => { if (e.code !== 'ENOENT') throw e; });
      }
    }
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(address, resolve); });
    await registry.writeJson(path.join(directory, 'service.json'), { pid: process.pid, token, candidate, address });
  } catch (e) { server.close(); await release(); throw e; }
  await release();
  function status() { return { candidate, draining, active: active.size, sessions: sessions.size }; }
  async function close({ upgrading = false } = {}) {
    if (closing) return closing;
    draining = true;
    closing = (async () => {
      while (active.size) await Promise.allSettled([...active]);
      // All input calls have returned, including their finally/cleanup paths.
      // Factory disposal must release each session's input and native resources.
      const results = await Promise.allSettled([...sessions].map(async entry => {
        entry.closed = true;
        if (entry.disposing) return entry.disposing;
        entry.disposing = (async () => { const instance = await entry.instance; await instance.dispose(); sessions.delete(entry); })();
        return entry.disposing;
      }));
      const failure = results.find(r => r.status === 'rejected');
      if (failure) throw failure.reason; // fail closed: no successor on uncertain cleanup
      await shutdown();
      await Promise.all([...sockets].map(socket => new Promise(resolve => { socket.once('close', resolve); socket.end(() => socket.destroy()); })));
      await new Promise(resolve => server.close(resolve));
      const current = await registry.readJson(path.join(directory, 'service.json')).catch(() => null);
      if (current?.token === token) await fs.unlink(path.join(directory, 'service.json'));
      if (!upgrading) await onClosed({ upgrading: false });
    })();
    return closing;
  }
  async function upgrade() {
    if (migration || draining) return migration;
    const next = await registry.selectCandidate(directory, candidate);
    if (registry.compareVersions(next.version, candidate.version) <= 0) return;
    // Revalidate immediately before freezing and before spawning. No PID is killed.
    await registry.validateCandidate(next);
    draining = true;
    migration = (async () => { await close({ upgrading: true }); await registry.validateCandidate(next); launch(next, directory); await onClosed({ upgrading: true }); })();
    return migration;
  }
  return { address, close, status, upgrade };
}
module.exports = { createSharedService, wire, send, launch, serializeError };
