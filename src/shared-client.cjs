'use strict';
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const registry = require('./service-registry.cjs');
const { wire, send, launch } = registry;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function createServiceClient({ directory = registry.defaultDirectory(), candidate, onApproval, onEvent, onDisconnect, sessionOptions = {}, startupTimeoutMs = 15000 }) {
  let socket, connecting, disposed = false, hello, registered;
  const required = { protocol: candidate?.protocol ?? registry.PROTOCOL, schema: candidate?.schema ?? registry.SCHEMA };
  const pending = new Map(), approvals = new Map();
  const connections = new Set();
  const makeError = info => {
    const error = registry.error(info?.code || 'service_error', info?.message || 'Shared service failed');
    for (const key of ['stage','nativeCode','mutationOutcome','exitCode','signal','diagnostic','approvalState','approvalRequestId','userResponded','actionExecuted','restoreAllowed','observationRequired','inputReleaseConfirmed','connectionRecovered','viewerState','requiredUserAction','recovery','pauseReason','nativePermissionReason','switchedInputDetails']) if (info?.[key] !== undefined) error[key] = info[key];
    return error;
  };
  function disconnected() {
    const unknown = registry.error('outcome_unknown', 'Service connection closed after dispatch; operation will not be replayed');
    unknown.mutationOutcome = 'unknown'; unknown.observationRequired = true;
    for (const job of pending.values()) { job.cleanup(); job.reject(unknown); }
    pending.clear();
    for (const approval of approvals.values()) approval.abort(); approvals.clear();
    socket = null; hello = null;
    try { Promise.resolve(onDisconnect?.({ reason: disposed ? 'client_closed' : 'connection_lost' })).catch(() => {}); } catch {}
  }
  async function connect() {
    const info = await registry.readJson(path.join(directory, 'service.json'));
    if (info.address !== registry.addressFor(directory) || !/^[a-f0-9]{64}$/.test(info.token || '')) throw registry.error('invalid_registry', 'Invalid shared service endpoint');
    return new Promise((resolve, reject) => {
      const connection = net.createConnection(info.address);
      const nonce = crypto.randomBytes(32).toString('hex');
      connections.add(connection);
      const timer = setTimeout(() => { connection.destroy(); reject(registry.error('service_timeout', 'Service handshake timed out')); }, 3000); timer.unref();
      let accepted = false;
      connection.once('error', e => { if (!accepted) { clearTimeout(timer); reject(e); } });
      connection.once('close', () => { connections.delete(connection); clearTimeout(timer); if (socket === connection) disconnected(); if (!accepted) reject(registry.error('service_unavailable', 'Service closed during handshake')); });
      wire(connection, async message => {
        if (!accepted) {
          if (message.type !== 'hello') return connection.destroy();
          if (message.error) { clearTimeout(timer); reject(makeError(message.error)); connection.destroy(); return; }
          const expected = crypto.createHmac('sha256', info.token).update(`server:${nonce}`).digest('hex');
          if (!/^[a-f0-9]{64}$/.test(message.proof || '') || !crypto.timingSafeEqual(Buffer.from(message.proof), Buffer.from(expected))) { reject(registry.error('invalid_registry', 'Service authentication failed')); connection.destroy(); return; }
          if (message.candidate?.protocol !== required.protocol || message.candidate?.schema !== required.schema) { reject(registry.error('incompatible_service', 'Service protocol/schema mismatch')); connection.destroy(); return; }
          if (disposed) { reject(registry.error('client_closed', 'Shared service client is closed')); connection.destroy(); return; }
          accepted = true; clearTimeout(timer); socket = connection; hello = message; resolve(message); return;
        }
        if (message.type === 'event') { onEvent?.(message.sessionId, message.event); return; }
        if (message.type === 'approval') {
          const job = pending.get(message.callId);
          const authorize = job?.authorize || onApproval;
          const controller = new AbortController(); approvals.set(message.id, controller);
          try {
            if (!authorize) throw registry.error('approval_unavailable', 'This client has no approval presenter');
            const result = await authorize(message.identity, message.permission, controller.signal);
            send(connection, { type: 'approvalResult', id: message.id, result });
          } catch (e) { send(connection, { type: 'approvalResult', id: message.id, error: { code: e.code || 'approval_failed', message: e.message } }); }
          finally { approvals.delete(message.id); }
          return;
        }
        if (message.type === 'cancelApproval') { approvals.get(message.id)?.abort(); return; }
        const job = pending.get(message.id); if (!job) return;
        pending.delete(message.id); job.cleanup();
        if (message.error) job.reject(makeError(message.error)); else job.resolve(message.result);
      });
      connection.once('connect', () => send(connection, { type: 'hello', nonce, proof: crypto.createHmac('sha256', info.token).update(`client:${nonce}`).digest('hex'), protocol: required.protocol, schema: required.schema }));
    });
  }
  function request(sessionId, method, args, { signal, authorize, sessionOptions: callSessionOptions, authorizationPolicy } = {}) {
    if (disposed) return Promise.reject(registry.error('client_closed', 'Shared service client is closed'));
    if (!socket || socket.destroyed) return Promise.reject(registry.error('service_unavailable', 'Service is not connected'));
    if (signal?.aborted) return Promise.reject(registry.error('aborted', 'Request cancelled before dispatch'));
    const connection = socket, id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => send(connection, { type: 'cancel', id });
      const cleanup = () => signal?.removeEventListener('abort', abort);
      pending.set(id, { resolve, reject, cleanup, authorize });
      signal?.addEventListener('abort', abort, { once: true });
      send(connection, { type: 'request', id, sessionId, method, args, options: { ...sessionOptions, ...callSessionOptions }, authorizationPolicy });
    });
  }
  async function startOrConnect() {
    await registry.prepareDirectory(directory);
    if (!registered) registered = candidate ? await registry.registerCandidate(directory, candidate) : true;
    const deadline = Date.now() + startupTimeoutMs;
    let launched = false, lastError;
    while (!disposed && Date.now() < deadline) {
      try {
        const state = await connect();
        if (state.draining) { socket.destroy(); await wait(50); continue; }
        const newest = await registry.selectCandidate(directory, required);
        if (registry.compareVersions(newest.version, state.candidate.version) > 0) {
          await request('$control', '$upgrade');
          // Upgrade is admission-frozen before acknowledgement is processed by
          // subsequent requests. Only connection establishment retries here.
          const current = socket;
          if (current && !current.destroyed) await new Promise(resolve => { current.once('close', resolve); const timer = setTimeout(resolve, Math.max(1, deadline - Date.now())); timer.unref(); });
          continue;
        }
        return state;
      } catch (e) {
        lastError = e;
        if (e.code === 'incompatible_service' || e.code === 'invalid_registry' || e.code === 'invalid_candidate') throw e;
      }
      if (!launched) {
        let release;
        try {
          release = await registry.acquireLock(directory);
          // Recheck under the startup lock; another proxy may have started it.
          try { const state = await connect(); return state; }
          catch (e) { if (e.code === 'incompatible_service' || e.code === 'invalid_registry') throw e; }
          const selected = await registry.selectCandidate(directory, required);
          launch(selected, directory); launched = true;
        } catch (e) { lastError = e; if (e.code !== 'service_busy') throw e; }
        finally { if (release) await release(); }
      }
      await wait(75);
    }
    if (disposed) throw registry.error('client_closed', 'Shared service client is closed');
    throw registry.error('service_timeout', `Shared service startup timed out (${lastError?.code || 'unavailable'})`);
  }
  async function ensure() {
    if (disposed) throw registry.error('client_closed', 'Shared service client is closed');
    if (socket && !socket.destroyed && hello && !hello.draining) return hello;
    if (!connecting) connecting = startOrConnect().finally(() => { connecting = null; });
    return connecting;
  }
  return {
    ensure,
    async call(sessionId, method, args, options) { await ensure(); return request(sessionId, method, args, options); },
    async closeSession(sessionId) { if (!socket || socket.destroyed) return; return request(sessionId, '$closeSession'); },
    dispose() { disposed = true; for (const connection of connections) connection.destroy(); },
  };
}
module.exports = { createServiceClient };
