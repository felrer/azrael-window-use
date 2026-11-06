'use strict';
// Standalone adapter: native payloads have no VS Code, engine or guide dependency.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function plainFile(file) {
  const absolute = path.resolve(file);
  for (let current = absolute;; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || (current === absolute ? !stat.isFile() : !stat.isDirectory())) throw Error('Linked or non-regular runtime input');
    if (path.dirname(current) === current) break;
  }
  return absolute;
}
function verifyRuntime(directory) {
  directory = path.resolve(directory);
  const bytes = fs.readFileSync(plainFile(path.join(directory, 'manifest.json')));
  const manifest = JSON.parse(bytes);
  if (manifest.schema !== 1 || manifest.kind !== 'azrael-window-control' || manifest.platform !== 'win32' || manifest.arch !== 'x64' || manifest.childSession || !manifest.source || !path.isAbsolute(manifest.source.directory || '') || !digest(manifest.source.sourceSha256) || !digest(manifest.source.executableSha256) || manifest.source.builder !== 'cargo --locked --release' || !Array.isArray(manifest.files) || manifest.files.length !== 2) throw Error('Invalid standalone Window Control provenance');
  const seen = new Set();
  for (const entry of manifest.files) {
    if (!['azrael-window-control.exe', 'THIRD_PARTY_NOTICES.md'].includes(entry.path) || seen.has(entry.path) || !digest(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1) throw Error('Invalid Window Control runtime member');
    seen.add(entry.path);
    const member = fs.readFileSync(plainFile(path.join(directory, entry.path)));
    if (member.length !== entry.bytes || hash(member) !== entry.sha256) throw Error('Window Control hash mismatch: ' + entry.path);
  }
  if (seen.size !== 2 || fs.readdirSync(directory).some(name => name !== 'manifest.json' && !seen.has(name))) throw Error('Incomplete or unrecorded Window Control runtime');
  if (manifest.files.find(entry => entry.path === 'azrael-window-control.exe')?.sha256 !== manifest.source.executableSha256) throw Error('Window Control executable provenance mismatch');
  return { directory, executable: path.join(directory, 'azrael-window-control.exe'), manifestSha256: hash(bytes), manifest };
}
module.exports = { verifyRuntime };
