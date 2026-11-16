'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
if (process.platform !== 'darwin') throw new Error('The macOS helper must be built on macOS with Xcode Command Line Tools');
if (!['arm64', 'x64'].includes(process.arch)) throw new Error('Supported macOS architectures: arm64 and x64');
const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === '--output')) throw new Error('Usage: node scripts/build-macos.cjs [--output directory]');
const output = args.length ? path.resolve(args[1]) : path.join(root, 'artifacts/runtime/window-control');
fs.mkdirSync(output, { recursive: true });
const entry = 'azrael-window-control-macos';
const source = path.join(root, 'native/macos/window-control.swift');
const result = spawnSync('xcrun', ['swiftc', '-parse-as-library', '-O', '-swift-version', '5', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx14.0`, source, '-o', path.join(output, entry)], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const signed = spawnSync('codesign', ['--sign', '-', path.join(output, entry)], { stdio: 'inherit' });
if (signed.error) throw signed.error;
if (signed.status !== 0) process.exit(signed.status ?? 1);
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const data = fs.readFileSync(path.join(output, entry));
const manifest = { schema: 1, kind: 'azrael-window-control', platform: 'darwin', arch: process.arch, entry,
  files: [{ path: entry, bytes: data.length, sha256: digest(data) }], sourceSha256: digest(fs.readFileSync(source)),
  capabilities: { windowObservation: true, windowUIAControl: true, windowCapture: true, actionVisualization: true,
    desktopCapture: false, desktopControl: false, switchedInput: false, independentPointer: false } };
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ built: entry, output, platform: manifest.platform, arch: manifest.arch }));
