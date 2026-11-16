'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { normalizeExecutable } = require('../vendor/azrael/use-control-settings.cjs');
const fail = (code, message) => Object.assign(new Error(message), { code, actionExecuted: false });
const MODES = ['ask', 'observe', 'full'];
function executableList(list) {
  if (!Array.isArray(list) || list.length > 128) throw fail('invalid_settings', '앱 목록이 잘못되었습니다.');
  return [...new Set(list.map(normalizeExecutable))].sort();
}
class PermissionService extends EventEmitter {
  constructor({ directory, selfExecutables, approvalTimeoutMs = 60000, now = Date.now, sharedPolicy }) {
    super();
    this.directory = directory;
    this.file = path.join(directory, 'permissions.json');
    this.selfApps = new Set(executableList(selfExecutables));
    this.now = now;
    this.approvalTimeoutMs = approvalTimeoutMs;
    this.grants = new Set(); this.pending = new Map(); this.stopped = false; this.generation = 0;
    this.state = this.read();
    this.sharedPolicy = sharedPolicy;
    this.stopFile = path.join(directory, 'stopped.json');
    if (sharedPolicy) {
      Object.defineProperty(this, 'state', { get: () => sharedPolicy.state, set: () => {} });
      Object.defineProperty(this, 'stopped', { get: () => sharedPolicy.stopped, set: () => {} });
      this.sharedInvalidation = reason => this.invalidate(reason);
      sharedPolicy.on('invalidate', this.sharedInvalidation);
    } else {
      try { const info=fs.lstatSync(this.stopFile);if(!info.isFile()||info.isSymbolicLink()||info.size>1024)throw Error('Invalid Stop state');const value=JSON.parse(fs.readFileSync(this.stopFile, 'utf8'));this.stopped = value.schema!==1 || value.stopped !== false; }
      catch (error) { this.stopped = error.code !== 'ENOENT'; }
    }
    this.watcher = () => this.synchronize();
    if (!sharedPolicy) fs.watchFile(this.file, { persistent: false, interval: 300 }, this.watcher);
  }
  fork() { return new PermissionService({ directory:this.directory, selfExecutables:[...this.selfApps], approvalTimeoutMs:this.approvalTimeoutMs, now:this.now, sharedPolicy:this }); }
  synchronize() {
    if (this.sharedPolicy) return this.sharedPolicy.synchronize();
    if (this.synchronizing) return;
    this.synchronizing = true;
    try {
      const next = this.read(); this.invalidPolicy = false;
      if (JSON.stringify(next) !== JSON.stringify(this.state)) { this.state = next; this.invalidate('policy_changed'); }
    } catch {
      this.state = { ...this.state, enabled: false };
      if (!this.invalidPolicy) { this.invalidPolicy = true; this.invalidate('invalid_settings'); }
    } finally { this.synchronizing = false; }
  }
  read() {
    let state;
    try { const info = fs.lstatSync(this.file); if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) throw Error('Invalid settings file'); state = JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw fail('invalid_settings', '권한 설정을 읽을 수 없습니다.'); return { schema: 1, revision: 0, enabled: true, mode: 'ask', protectedApps: [], allowedApps: [], theme: 'system' }; }
    const expected = ['schema', 'revision', 'enabled', 'mode', 'protectedApps', 'allowedApps', 'theme'];
    if (!state || Object.keys(state).length !== expected.length || expected.some(key => !Object.hasOwn(state, key)) || state.schema !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || typeof state.enabled !== 'boolean' || !MODES.includes(state.mode) || !['system','light','dark'].includes(state.theme)) throw fail('invalid_settings', '권한 설정 형식이 잘못되었습니다.');
    state.protectedApps = executableList(state.protectedApps); state.allowedApps = executableList(state.allowedApps);
    return state;
  }
  save(patch) {
    if (this.sharedPolicy) return this.sharedPolicy.save(patch);
    const allowed = ['enabled','mode','protectedApps','allowedApps','theme'];
    if (!patch || Object.keys(patch).some(key => !allowed.includes(key))) throw fail('invalid_settings', '지원하지 않는 설정입니다.');
    if ('enabled' in patch && typeof patch.enabled !== 'boolean' || 'mode' in patch && !MODES.includes(patch.mode) || 'theme' in patch && !['system','light','dark'].includes(patch.theme)) throw fail('invalid_settings', '설정 값이 잘못되었습니다.');
    for (const key of ['protectedApps','allowedApps']) if (key in patch) patch = { ...patch, [key]: executableList(patch[key]) };
    if (patch.allowedApps?.some(app => this.selfApps.has(app))) throw fail('security_app_blocked', 'Window Use 자체 UI는 허용할 수 없습니다.');
    fs.mkdirSync(this.directory, { recursive: true });
    const lock = this.file + '.lock'; let fd, temp;
    try {
      fd = fs.openSync(lock, 'wx', 0o600);
      const current = this.read();
      if (current.revision !== this.state.revision) throw fail('revision_conflict', '다른 연결에서 설정이 변경되었습니다. 다시 확인해주세요.');
      const next = { ...current, ...patch, revision: current.revision + 1 };
      temp = this.file + '.' + crypto.randomUUID() + '.tmp';
      fs.writeFileSync(temp, JSON.stringify(next) + '\n', { flag: 'wx', mode: 0o600 });
      fs.renameSync(temp, this.file); temp = undefined; this.state = next;
    } finally {
      if (temp && fs.existsSync(temp)) fs.unlinkSync(temp);
      if (fd !== undefined) { fs.closeSync(fd); fs.unlinkSync(lock); }
    }
    this.invalidate('policy_changed'); return this.snapshot();
  }
  protectedExecutables() { return [...new Set([...this.selfApps, ...this.state.protectedApps])].sort(); }
  blocked(identity) { this.synchronize(); return !!identity?.executable && this.protectedExecutables().includes(normalizeExecutable(identity.executable)); }
  assertActive() {
    this.synchronize();
    if (!this.state.enabled) throw fail('permission_denied', 'Window Use가 꺼져 있습니다.');
    if (this.stopped) throw fail('user_stopped', '사용자가 중지했습니다. 설정창에서 직접 재개해주세요.');
  }
  allowed(identity, permission = 'control') {
    this.synchronize();
    if (!this.state.enabled || this.stopped || identity && this.blocked(identity)) return false;
    if (permission === 'observation') return true;
    if (this.state.mode === 'observe') return false;
    if (this.state.mode === 'full') return true;
    if (permission === 'desktop') return this.grants.has('desktop');
    const exe = identity?.executable && normalizeExecutable(identity.executable);
    return !!exe && (this.grants.has('desktop') || this.state.allowedApps.includes(exe) || this.grants.has('control:' + exe));
  }
  async request(identity, permission = 'control', signal) {
    this.assertActive();
    if (signal?.aborted) throw fail('cancelled', '요청이 취소되었습니다.');
    if (identity && this.blocked(identity)) throw fail('security_app_blocked', '보호 앱은 관찰하거나 제어할 수 없습니다.');
    if (this.allowed(identity, permission)) return true;
    if (this.state.mode === 'observe') throw fail('permission_denied', '관찰 전용 모드에서는 조작할 수 없습니다.');
    const executable = identity?.executable && normalizeExecutable(identity.executable);
    const key = permission === 'desktop' ? 'desktop' : permission + ':' + executable;
    const incumbent = [...this.pending.values()].find(record => record.key === key);
    if (incumbent) return incumbent.promise;
    const id = crypto.randomUUID(), generation = this.generation;
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    const record = { id, key, permission, app: { name: executable ? path.win32.basename(executable) : '전체 데스크톱', executable: executable || '' }, expiresAt: this.now() + this.approvalTimeoutMs, generation, promise, resolve, reject };
    record.signal = signal;
    record.abort = () => this.finish(id, fail('cancelled', '요청이 취소되었습니다.'));
    record.timer = setTimeout(() => this.finish(id, fail('approval_timeout', '승인 대기 시간이 만료되었습니다.')), this.approvalTimeoutMs);
    this.pending.set(id, record);
    signal?.addEventListener('abort', record.abort, { once: true });
    this.emit('change'); this.emit('approval');
    return promise;
  }
  respond(id, decision) {
    const record = this.pending.get(id);
    if (!record || record.generation !== this.generation || this.now() >= record.expiresAt) throw fail('approval_expired', '만료되었거나 취소된 승인 요청입니다.');
    if (!['deny','session','always'].includes(decision) || decision === 'always' && record.permission !== 'control') throw fail('invalid_arguments', '지원하지 않는 승인 범위입니다.');
    this.assertActive();
    if (this.blocked(record.app)) throw fail('security_app_blocked', '보호 앱입니다.');
    if (this.pending.get(id) !== record || record.generation !== this.generation) throw fail('approval_expired', '권한 변경으로 승인 요청이 취소되었습니다.');
    if (decision === 'deny') return this.finish(id, fail('approval_denied', '사용자가 권한 요청을 거절했습니다.'));
    const { key, app } = record;
    // Persisting an approval changes policy: detach this exact request before invalidating others.
    if (decision === 'always') {
      this.pending.delete(id); clearTimeout(record.timer); record.signal?.removeEventListener('abort', record.abort);
      try { this.save({ allowedApps: [...this.state.allowedApps, app.executable] }); }
      catch (error) { record.reject(error); throw error; }
      record.resolve(true); this.emit('change'); return;
    }
    this.grants.add(key); this.finish(id);
  }
  finish(id, error) {
    const record = this.pending.get(id); if (!record) return;
    this.pending.delete(id); clearTimeout(record.timer); record.signal?.removeEventListener('abort', record.abort);
    if (error) record.reject(error); else record.resolve(true);
    this.emit('change');
  }
  invalidate(reason) {
    this.generation++; this.grants.clear();
    for (const id of [...this.pending.keys()]) this.finish(id, fail(reason, '권한 상태가 변경되어 요청이 취소되었습니다.'));
    this.emit('invalidate', reason); this.emit('change');
  }
  setStopped(stopped) {
    if (this.sharedPolicy) return this.sharedPolicy.setStopped(stopped);
    // Stop is durable across host upgrades; a failed write must never resume input.
    if (stopped) { this.stopped = true;this.invalidate('user_stopped'); }
    fs.mkdirSync(this.directory, {recursive:true});
    const temp=this.stopFile+'.'+crypto.randomUUID()+'.tmp';
    try { fs.writeFileSync(temp,JSON.stringify({schema:1,stopped})+'\n',{flag:'wx',mode:0o600}); fs.renameSync(temp,this.stopFile); }
    finally { if(fs.existsSync(temp))fs.unlinkSync(temp); }
    this.stopped=stopped; if(!stopped)this.invalidate('user_resumed');
  }
  stop() { this.setStopped(true); }
  resume() { this.setStopped(false); }
  snapshot() {
    const app = executable => ({ executable, label: path.win32.basename(executable), locked: this.selfApps.has(executable) });
    return { enabled: this.state.enabled, mode: this.state.mode, protectedApps: this.protectedExecutables().map(app), allowedApps: this.state.allowedApps.map(app) };
  }
  approvals() { return [...this.pending.values()].map(({ id,permission,app,expiresAt }) => ({ id,permission,app,expiresAt })); }
  dispose() { if(this.sharedPolicy)this.sharedPolicy.off('invalidate',this.sharedInvalidation); else fs.unwatchFile(this.file, this.watcher); this.invalidate('disconnected'); this.removeAllListeners(); }
}
module.exports = { PermissionService, fail };
