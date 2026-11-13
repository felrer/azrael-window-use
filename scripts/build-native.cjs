'use strict';
// One compiler owner; immutable native inputs and verified published runtime receipts.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
function inventory(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en')).flatMap(entry => {
    const name = prefix + entry.name, file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw Error('Linked build input: ' + file);
    if (entry.isDirectory()) return inventory(file, name + '/');
    if (!entry.isFile()) throw Error('Non-regular build input: ' + file);
    const bytes = fs.readFileSync(file);
    return [{ path: name, bytes: bytes.length, sha256: sha(bytes) }];
  });
}
function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('Native build requires Windows x64 MSVC');
  if (process.argv.length !== 2) throw Error('Usage: node scripts/build-native.cjs');
  const buildRoot = path.join(root, 'artifacts/build');
  fs.mkdirSync(buildRoot, { recursive: true });
  const lock = path.join(buildRoot, 'native.lock');
  const fd = fs.openSync(lock, 'wx');
  fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  let report, reportPath;
  try {
    const native = inventory(path.join(root, 'native'));
    const vendor = inventory(path.join(root, 'vendor/azrael'));
    const script = sha(fs.readFileSync(__filename));
    const cargo = path.join(os.homedir(), '.cargo/bin/cargo.exe');
    const rustc = path.join(os.homedir(), '.cargo/bin/rustc.exe');
    function probe(executable, args) {
      const result = spawnSync(executable, args, { encoding: 'utf8', windowsHide: true });
      if (result.status !== 0 || result.error) throw Error('Build prerequisite failed: ' + executable + ': ' + (result.error?.message || result.stderr));
      return result.stdout.trim();
    }
    const vswhere = 'C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe';
    const vs = probe(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath']);
    const cmake = path.join(vs, 'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe');
    const vcvars = path.join(vs, 'VC/Auxiliary/Build/vcvars64.bat');
    const tools = { rustc: probe(rustc, ['-Vv']), cargo: probe(cargo, ['-V']), cmake: probe(cmake, ['--version']), vs, vcVersion: fs.readFileSync(path.join(vs, 'VC/Auxiliary/Build/Microsoft.VCToolsVersion.default.txt'), 'utf8').trim() };
    const inputs = { native, vendor, script, tools, platform: process.platform, arch: process.arch, target: 'x86_64-pc-windows-msvc', profile: 'release', environment: { CARGO_ENCODED_RUSTFLAGS: process.env.CARGO_ENCODED_RUSTFLAGS || '', RUSTFLAGS: process.env.RUSTFLAGS || '' } };
    const sourceSha256 = sha(JSON.stringify(inputs));
    const receipt = path.join(buildRoot, 'native-receipt.json');
    const windowDir = path.join(root, 'artifacts/runtime/window-control');
    const pointerDir = path.join(root, 'artifacts/runtime/multi-pointer');
    const verify = () => ({ windowControl: require('../vendor/azrael/window-control-runtime.cjs').verifyRuntime(windowDir), multiPointer: require('../vendor/azrael/multi-pointer-mcp.cjs').verifyRuntime(pointerDir) });
    if (fs.existsSync(receipt)) {
      const previous = JSON.parse(fs.readFileSync(receipt, 'utf8'));
      if (previous.status === 'passed' && previous.sourceSha256 === sourceSha256) {
        const checked = verify();
        if (checked.windowControl.manifestSha256 !== previous.windowControl.manifestSha256 || checked.multiPointer.manifestSha256 !== previous.multiPointer.manifestSha256) throw Error('Runtime differs from completed build receipt');
        console.log(JSON.stringify({ reused: true, receipt, sourceSha256, windowControl: previous.windowControl, multiPointer: previous.multiPointer }));
        return;
      }
    }
    if (fs.existsSync(windowDir) || fs.existsSync(pointerDir)) throw Error('Runtime already published with different inputs; release consumers and retire through artifact owner before rebuilding');
    const runId = 'native-' + Date.now().toString(36);
    const run = path.join(buildRoot, runId), logs = path.join(root, 'artifacts/logs', runId);
    fs.mkdirSync(run); fs.mkdirSync(logs, { recursive: true });
    reportPath = path.join(run, 'build-report.json');
    report = { schema: 1, owner: 'standalone-native-build', runId, status: 'running', sourceSha256, inputs, plannedOutputs: [run, logs, windowDir, pointerDir], activeReferences: ['native-build', 'standalone-runtime-consumers'], steps: [] };
    json(reportPath, report);
    const frozen = path.join(run, 'inputs/native');
    fs.mkdirSync(path.dirname(frozen), { recursive: true });
    fs.cpSync(path.join(root, 'native'), frozen, { recursive: true, errorOnExist: true, force: false });
    if (sha(JSON.stringify(inventory(frozen))) !== sha(JSON.stringify(native))) throw Error('Frozen source fingerprint mismatch');
    const env = { ...process.env, PATH: path.dirname(cargo) + path.delimiter + process.env.PATH, CARGO_TARGET_DIR: path.join(run, 'cargo-target'), CARGO_INCREMENTAL: '0', RUSTC: rustc };
    function step(name, executable, args, cwd = run) {
      const log = path.join(logs, name + '.log'), output = fs.openSync(log, 'wx');
      const start = Date.now();
      const result = spawnSync(executable, args, { cwd, env, windowsHide: true, stdio: ['ignore', output, output] });
      fs.closeSync(output);
      const outcome = { name, executable, args, cwd, log, exitCode: result.status, signal: result.signal, error: result.error?.message, elapsedMs: Date.now() - start };
      report.steps.push(outcome); json(reportPath, report);
      if (result.status !== 0 || result.signal || result.error) throw Error(name + ' failed; see ' + log);
      console.log(name + ': exit 0');
    }
    // vcvars supplies the supported compiler/linker and Windows SDK environment.
    const cargoCommand = '@call "' + vcvars + '" >nul\r\n@"' + cargo + '" build --locked --release --target x86_64-pc-windows-msvc --manifest-path "' + path.join(frozen, 'window-control/Cargo.toml') + '"\r\n';
    const commandFile = path.join(run, 'cargo-build.cmd');
    fs.writeFileSync(commandFile, cargoCommand);
    step('cargo-release', process.env.ComSpec || 'C:/Windows/System32/cmd.exe', ['/d', '/c', commandFile]);
    const cppBuild = path.join(run, 'multi-pointer-build');
    step('cmake-configure', cmake, ['-S', path.join(frozen, 'multi-pointer'), '-B', cppBuild, '-G', 'Visual Studio 18 2026', '-A', 'x64']);
    step('cmake-release', cmake, ['--build', cppBuild, '--config', 'Release', '--target', 'azrael-multi-pointer', 'azrael-multi-pointer-raw-origin-selftest']);
    step('raw-origin-selftest', path.join(cppBuild, 'Release/azrael-multi-pointer-raw-origin-selftest.exe'), []);
    step('keyboard-interruption-selftest', path.join(cppBuild, 'Release/azrael-multi-pointer.exe'), ['--keyboard-interruption-selftest']);
    step('keyboard-reservation-selftest', path.join(cppBuild, 'Release/azrael-multi-pointer.exe'), ['--keyboard-reservation-selftest']);
    step('batch-selftest', path.join(cppBuild, 'Release/azrael-multi-pointer.exe'), ['--batch-selftest']);
    step('preparation-wait-selftest', path.join(cppBuild, 'Release/azrael-multi-pointer.exe'), ['--preparation-wait-selftest']);
    step('cursor-guard-selftest', path.join(cppBuild, 'Release/azrael-multi-pointer.exe'), ['--cursor-guard-selftest']);
    if (sha(JSON.stringify(inventory(path.join(root, 'native')))) !== sha(JSON.stringify(native)) || sha(JSON.stringify(inventory(frozen))) !== sha(JSON.stringify(native)) || sha(JSON.stringify(inventory(path.join(root, 'vendor/azrael')))) !== sha(JSON.stringify(vendor)) || sha(fs.readFileSync(__filename)) !== script) throw Error('Selected build inputs changed during compilation');
    fs.mkdirSync(windowDir, { recursive: true }); fs.mkdirSync(pointerDir, { recursive: true });
    fs.copyFileSync(path.join(run, 'cargo-target/x86_64-pc-windows-msvc/release/azrael-window-control.exe'), path.join(windowDir, 'azrael-window-control.exe'));
    fs.copyFileSync(path.join(frozen, 'window-control/THIRD_PARTY_NOTICES.md'), path.join(windowDir, 'THIRD_PARTY_NOTICES.md'));
    fs.copyFileSync(path.join(cppBuild, 'Release/azrael-multi-pointer.exe'), path.join(pointerDir, 'azrael-multi-pointer.exe'));
    fs.writeFileSync(path.join(pointerDir, 'THIRD_PARTY_NOTICES.md'), '# Third-party notices\n\nJSON for Modern C++ v3.11.3\n\n' + fs.readFileSync(path.join(frozen, 'vendor/json/LICENSE.MIT'), 'utf8') + '\n\n' + fs.readFileSync(path.join(frozen, 'multi-pointer/CURSOR-NOTICES.md'), 'utf8'));
    const files = inventory(windowDir);
    json(path.join(windowDir, 'manifest.json'), { schema: 1, kind: 'azrael-window-control', platform: 'win32', arch: 'x64', source: { directory: path.join(root, 'native/window-control'), sourceSha256, executableSha256: files.find(file => file.path.endsWith('.exe')).sha256, builder: 'cargo --locked --release' }, files });
    json(path.join(pointerDir, 'manifest.json'), { schema: 1, kind: 'azrael-multi-pointer', platform: 'win32', arch: 'x64', sourceSha256, files: inventory(pointerDir) });
    const checked = verify();
    report.status = 'passed'; report.activeReferences = ['standalone-runtime-consumers']; report.windowControl = { directory: windowDir, manifestSha256: checked.windowControl.manifestSha256 }; report.multiPointer = { directory: pointerDir, manifestSha256: checked.multiPointer.manifestSha256, modulePath: path.join(root, 'vendor/azrael/multi-pointer-mcp.cjs') };
    json(reportPath, report); json(receipt, report);
    console.log(JSON.stringify({ reused: false, receipt, reportPath, windowControl: report.windowControl, multiPointer: report.multiPointer }));
  } catch (error) {
    if (report && reportPath) { report.status = 'failed'; report.error = error.message; json(reportPath, report); }
    throw error;
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { inventory };
