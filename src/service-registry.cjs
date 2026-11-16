'use strict';
// All registry and candidate paths identify physical files, including app.asar.
const fs = process.versions.electron ? require('original-fs').promises : require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { spawn } = require('node:child_process');
const PROTOCOL = 1;
const SCHEMA = 1;
function error(code, message) { return Object.assign(new Error(message), { code }); }
let desktopScope;
function defaultDirectory() {
  if (!desktopScope) {
    if (process.platform === 'win32') {
      const query = `Add-Type -TypeDefinition 'using System;using System.Text;using System.Runtime.InteropServices;public static class AzWindowDesktop{[DllImport("user32.dll")]public static extern IntPtr GetThreadDesktop(uint id);[DllImport("kernel32.dll")]public static extern uint GetCurrentThreadId();[DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]public static extern bool GetUserObjectInformation(IntPtr h,int n,StringBuilder b,uint l,out uint needed);}';$b=New-Object System.Text.StringBuilder 256;$n=0;$d=[AzWindowDesktop]::GetThreadDesktop([AzWindowDesktop]::GetCurrentThreadId());if(-not [AzWindowDesktop]::GetUserObjectInformation($d,2,$b,512,[ref]$n)){throw 'Desktop identity unavailable'};[string][System.Diagnostics.Process]::GetCurrentProcess().SessionId+'|'+$b.ToString()`;
      desktopScope = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], { encoding: 'utf8', windowsHide: true }).trim();
      if (!/^\d+\|[^\r\n|]+$/.test(desktopScope)) throw error('desktop_scope_unavailable', 'Cannot determine Windows session and desktop');
    } else desktopScope = `${process.getuid()}|${process.env.DISPLAY || process.env.WAYLAND_DISPLAY || 'headless'}`;
  }
  const scope = [os.userInfo().username, desktopScope].join('|');
  return path.join(process.env.LOCALAPPDATA || os.homedir(), 'Azrael Window Use', 'shared', crypto.createHash('sha256').update(scope).digest('hex').slice(0, 24));
}
async function prepareDirectory(directory) {
  directory = path.resolve(directory);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await fs.lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw error('unsafe_directory', 'Shared service directory must be an ordinary directory');
  if (process.platform === 'win32') {
    const script = `& { param([string]$p) $ErrorActionPreference='Stop';$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;$existing=Get-Acl -LiteralPath $p;$owner=$existing.GetOwner([System.Security.Principal.SecurityIdentifier]);if($owner.Value -ne $sid.Value){throw 'Shared directory belongs to another user'};$acl=New-Object System.Security.AccessControl.DirectorySecurity;$acl.SetAccessRuleProtection($true,$false);foreach($s in @($sid.Value,'S-1-5-18')){$r=New-Object System.Security.AccessControl.FileSystemAccessRule((New-Object System.Security.Principal.SecurityIdentifier($s)),'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($r)};[System.IO.Directory]::SetAccessControl($p,$acl) } '${directory.replace(/'/g, "''")}'`;
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: 'pipe' });
  } else {
    if (info.uid !== process.getuid()) throw error('unsafe_directory', 'Shared service directory belongs to another user');
    await fs.chmod(directory, 0o700);
  }
  return directory;
}
function addressFor(directory) {
  const id = crypto.createHash('sha256').update(path.resolve(directory).toLowerCase()).digest('hex').slice(0, 32);
  return process.platform === 'win32' ? `\\\\.\\pipe\\az-window-use-${id}` : path.join(directory, 'service.sock');
}
async function readJson(file, max = 1024 * 1024) {
  const st = await fs.lstat(file);
  if (!st.isFile() || st.isSymbolicLink() || st.size > max) throw error('invalid_registry', 'Invalid registry file');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
async function writeJson(file, value) {
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(temp, file); break; }
      catch (e) { if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code) || attempt >= 5) throw e; await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1))); }
    }
  }
  finally { await fs.unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
async function digest(file) {
  const st = await fs.lstat(file);
  if (!st.isFile() || st.isSymbolicLink()) throw error('invalid_candidate', 'Candidate identity must be a regular file');
  return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
}
function versionParts(version) {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/.exec(version || '');
  if (!m) throw error('invalid_candidate', 'A semantic candidate version is required');
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] || ''];
}
function compareVersions(a, b) {
  const x = versionParts(a), y = versionParts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  if (x[3] === y[3]) return 0;
  if (!x[3]) return 1; if (!y[3]) return -1;
  const p = x[3].split('.'), q = y[3].split('.');
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    if (p[i] === undefined) return -1; if (q[i] === undefined) return 1;
    if (p[i] === q[i]) continue;
    const pn = /^\d+$/.test(p[i]), qn = /^\d+$/.test(q[i]);
    if (pn && qn) return Number(p[i]) > Number(q[i]) ? 1 : -1;
    if (pn !== qn) return pn ? -1 : 1;
    return p[i] > q[i] ? 1 : -1;
  }
  return 0;
}
async function validateCandidate(candidate, registering = false) {
  if (!candidate || typeof candidate.id !== 'string' || !/^[a-zA-Z0-9_.-]{1,128}$/.test(candidate.id) || !path.isAbsolute(candidate.executable || '') || !Array.isArray(candidate.args) || candidate.args.some(a => typeof a !== 'string') || !Array.isArray(candidate.files) || !candidate.files.length || candidate.files.length > 128 || !Number.isSafeInteger(candidate.protocol) || !Number.isSafeInteger(candidate.schema)) throw error('invalid_candidate', 'Malformed service candidate');
  versionParts(candidate.version);
  const executableSha256 = await digest(candidate.executable);
  if ((!registering || candidate.executableSha256) && candidate.executableSha256 !== executableSha256) throw error('invalid_candidate', 'Candidate executable changed');
  const files = [];
  for (const file of candidate.files) {
    if (!path.isAbsolute(file.path || '') || !/^[a-f0-9]{64}$/.test(file.sha256 || '')) throw error('invalid_candidate', 'Missing candidate source identity');
    if (await digest(file.path) !== file.sha256) throw error('invalid_candidate', 'Candidate source changed');
    files.push({ path: file.path, sha256: file.sha256 });
  }
  return { id: candidate.id, version: candidate.version, protocol: candidate.protocol, schema: candidate.schema, executable: candidate.executable, executableSha256, args: candidate.args, files };
}
async function registerCandidate(directory, candidate) {
  const checked = await validateCandidate(candidate, true);
  await fs.mkdir(path.join(directory, 'candidates'), { recursive: true, mode: 0o700 });
  let release;
  const deadline = Date.now() + 10000;
  while (!release) {
    try { release = await acquireLock(directory, 'registry'); }
    catch (e) { if (e.code !== 'service_busy' || Date.now() >= deadline) throw e; await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  try {
    const file = path.join(directory, 'candidates', `${checked.id}.json`);
    const previous = await readJson(file).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (JSON.stringify(previous) !== JSON.stringify(checked)) await writeJson(file, checked);
  } finally { await release(); }
  return checked;
}
async function listCandidates(directory) {
  const names = await fs.readdir(path.join(directory, 'candidates')).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
  const results = await Promise.all(names.filter(n => /^[a-zA-Z0-9_.-]+\.json$/.test(n)).map(async name => {
    try { return await validateCandidate(await readJson(path.join(directory, 'candidates', name))); } catch { return null; }
  }));
  return results.filter(Boolean).sort((a, b) => compareVersions(b.version, a.version) || a.id.localeCompare(b.id));
}
async function selectCandidate(directory, required = { protocol: PROTOCOL, schema: SCHEMA }) {
  const candidates = await listCandidates(directory);
  const selected = candidates.find(c => c.protocol === required.protocol && c.schema === required.schema);
  if (!selected) throw error('incompatible_service', 'No installed service has a compatible protocol and schema');
  return selected;
}
async function acquireLock(directory, name = 'startup') {
  const file = path.join(directory, `${name}.lock`);
  const record = { pid: process.pid, nonce: crypto.randomUUID() };
  try { await fs.writeFile(file, JSON.stringify(record), { flag: 'wx', mode: 0o600 }); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const old = await readJson(file).catch(() => { throw error('service_busy', 'Startup lock ownership is not yet readable'); });
    if (!Number.isSafeInteger(old.pid) || old.pid < 1) throw error('service_busy', 'Uncertain startup lock owner');
    try { process.kill(old.pid, 0); throw error('service_busy', 'Service startup is already owned'); }
    catch (alive) { if (alive.code !== 'ESRCH') throw alive; }
    const again = await readJson(file);
    if (again.nonce !== old.nonce) throw error('service_busy', 'Startup owner changed');
    await fs.unlink(file);
    return acquireLock(directory, name);
  }
  return async () => {
    const current = await readJson(file).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (current?.nonce === record.nonce) await fs.unlink(file);
  };
}
function send(socket, data) { if (!socket.destroyed) socket.write(`${JSON.stringify(data)}\n`); }
function wire(socket, receive) {
  let buffer = ''; socket.setEncoding('utf8');
  socket.on('data', chunk => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 64 * 1024 * 1024) return socket.destroy();
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      let message; try { message = JSON.parse(line); } catch { socket.destroy(); return; }
      Promise.resolve(receive(message)).catch(() => socket.destroy());
    }
  });
}
function launch(candidate, directory) {
  const env = { ...process.env, AZ_WINDOW_USE_SHARED_DIRECTORY: directory };
  // MCP proxies may themselves run Electron as Node. The resident UI host must
  // start in ordinary Electron mode with a fresh native broker credential.
  delete env.ELECTRON_RUN_AS_NODE; delete env.WINDOW_USE_PIPE_TOKEN;
  const child = spawn(candidate.executable, candidate.args, { detached: true, windowsHide: true, stdio: 'ignore', env });
  child.on('error', () => {}); child.unref(); return child;
}
module.exports = { PROTOCOL, SCHEMA, defaultDirectory, prepareDirectory, addressFor, readJson, writeJson, validateCandidate, registerCandidate, listCandidates, selectCandidate, compareVersions, acquireLock, error, send, wire, launch };
