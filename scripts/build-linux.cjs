'use strict';
// Stage the maintained Python/GI provider; never install packages or require sudo.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const SOURCES = {
  'linux_backend.py': 'native/linux/linux_backend.py',
  'atspi_backend.py': 'native/window-control/src/linux_backend.py',
};
const DEPENDENCY_PROBE = `import ctypes, gi, os
gi.require_version('Atspi', '2.0')
gi.require_version('Gtk', '3.0')
from gi.repository import Atspi, Gtk, Gdk, GLib
from PIL import Image
if os.environ.get('DISPLAY') and not os.environ.get('WAYLAND_DISPLAY') and os.environ.get('XDG_SESSION_TYPE', '').lower() != 'wayland':
    ctypes.CDLL('libX11.so.6')
    ctypes.CDLL('libXcomposite.so.1')
print('System Python3, AT-SPI2, GTK3, Pillow and current-session libraries available')`;

function main() {
  if (process.platform !== 'linux') throw Error('Linux runtime staging must run on the target Linux host');
  if (process.argv.slice(2).some(arg => arg !== '--check') || process.argv.length > 3) throw Error('Usage: node scripts/build-linux.cjs [--check]');
  const probe = spawnSync('/usr/bin/python3', ['-c', DEPENDENCY_PROBE], { encoding: 'utf8' });
  if (probe.error || probe.signal || probe.status !== 0) {
    throw Error('Missing Linux system dependencies (no packages installed): ' + (probe.error?.message || probe.stderr.trim()));
  }
  console.log(probe.stdout.trim());
  if (process.argv.includes('--check')) return;
  const directory = path.join(root, 'artifacts/runtime/window-control');
  const files = Object.entries(SOURCES).map(([name, source]) => {
    const file = path.join(root, source);
    if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw Error('Non-regular build input: ' + source);
    return { name, source: file, content: fs.readFileSync(file) };
  });
  // Refuse replacing an existing runtime while readers or installed consumers may own it.
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.mkdirSync(directory);
  for (const file of files) fs.writeFileSync(path.join(directory, file.name), file.content, { flag: 'wx' });
  for (const file of files) {
    if (!fs.readFileSync(file.source).equals(file.content) || !fs.readFileSync(path.join(directory, file.name)).equals(file.content)) {
      throw Error('Linux build inputs changed while staging; incomplete runtime has no manifest: ' + directory);
    }
  }
  const manifest = {
    schema: 1, kind: 'azrael-window-control', platform: 'linux', arch: process.arch,
    entry: 'linux_backend.py',
    files: files.map(file => ({ path: file.name, bytes: file.content.length, sha256: hash(file.content) })),
    capabilities: { windowObservation: true, windowUIAControl: true, windowCapture: Boolean(process.env.DISPLAY) && !process.env.WAYLAND_DISPLAY && process.env.XDG_SESSION_TYPE?.toLowerCase() !== 'wayland', desktopCapture: false, desktopControl: false, switchedInput: false, independentPointer: false },
  };
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ directory, entry: manifest.entry, files: manifest.files, liveVerified: false }));
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { SOURCES, DEPENDENCY_PROBE };
