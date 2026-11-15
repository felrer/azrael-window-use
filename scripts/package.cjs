'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { inventory } = require('./build-native.cjs');
const root = path.resolve(__dirname, '..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
async function fileHash(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function selectedInputs() {
  const files = ['package.json', 'package-lock.json', 'LICENSE', 'README.md', 'scripts/package.cjs', 'scripts/build-native.cjs', 'scripts/launch.cjs'];
  const result = files.map(file => {
    const bytes = fs.readFileSync(path.join(root, file));
    return { path: file, bytes: bytes.length, sha256: sha(bytes) };
  });
  for (const dir of ['src', 'vendor/azrael', 'launcher', 'artifacts/runtime']) for (const member of inventory(path.join(root, dir))) result.push({ ...member, path: dir + '/' + member.path });
  return result.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
async function packageMain() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('Packaging requires Windows x64');
  if (process.argv.length !== 2) throw Error('Usage: node scripts/package.cjs');
  const buildRoot = path.join(root, 'artifacts/build');
  fs.mkdirSync(buildRoot, { recursive: true });
  const lock = path.join(buildRoot, 'package.lock');
  const lockFd = fs.openSync(lock, 'wx');
  fs.writeSync(lockFd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  let report, reportPath;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (pkg.version !== '0.1.0' || pkg.devDependencies?.electron !== '45.2.3' || pkg.devDependencies?.['@electron/packager'] !== '20.3.0') throw Error('Unexpected distribution version or unpinned packaging tools');
    const installedElectron = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8'));
    const installedPackager = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@electron/packager/package.json'), 'utf8'));
    const installedFuses = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@electron/fuses/package.json'), 'utf8'));
    if (installedElectron.version !== pkg.devDependencies.electron || installedPackager.version !== pkg.devDependencies['@electron/packager']) throw Error('Installed packaging tools differ from package pins');
    if (installedFuses.version !== pkg.devDependencies['@electron/fuses'] || !/^\d+\.\d+\.\d+$/.test(installedFuses.version)) throw Error('Installed fuse tool differs from exact package pin');
    if (fs.readdirSync(path.join(root, 'artifacts/runtime')).some(name => !['window-control', 'multi-pointer'].includes(name))) throw Error('Unselected runtime resources present');
    const windowRuntime = require('../vendor/azrael/window-control-runtime.cjs').verifyRuntime(path.join(root, 'artifacts/runtime/window-control'));
    const pointerRuntime = require('../vendor/azrael/multi-pointer-mcp.cjs').verifyRuntime(path.join(root, 'artifacts/runtime/multi-pointer'));
    const before = selectedInputs(), sourceSha256 = sha(JSON.stringify(before));
    const buildId = new Date().toISOString().replace(/[-:.]/g, '').replace('Z', '') + '-' + sourceSha256.slice(0, 10) + '-' + crypto.randomBytes(3).toString('hex');
    const runId = 'package-' + buildId;
    const run = path.join(buildRoot, runId), logs = path.join(root, 'artifacts/logs', runId);
    const release = path.join(root, 'artifacts/releases', pkg.version + '-' + buildId);
    if (fs.existsSync(run) || fs.existsSync(release)) throw Error('Build identity already exists');
    fs.mkdirSync(run); fs.mkdirSync(logs, { recursive: true });
    reportPath = path.join(run, 'package-report.json');
    report = { schema: 1, owner: 'standalone-package', status: 'running', runId, buildId, version: pkg.version, platform: 'win32', arch: 'x64', sourceSha256, inputs: before, plannedOutputs: [run, logs, release], activeReferences: ['packager'], steps: [], tools: { node: process.version, electron: installedElectron.version, packager: installedPackager.version, fuses: installedFuses.version }, nativeManifests: { windowControl: windowRuntime.manifestSha256, multiPointer: pointerRuntime.manifestSha256 } };
    json(reportPath, report);
    const log = fs.openSync(path.join(logs, 'packager.log'), 'wx');
    function step(name, exe, args, cwd, extraEnv = {}) {
      const logPath = path.join(logs, name + '.log'), fd = fs.openSync(logPath, 'wx');
      const started = Date.now();
      const result = spawnSync(exe, args, { cwd, env: { ...process.env, ...extraEnv }, windowsHide: true, stdio: ['ignore', fd, fd] });
      fs.closeSync(fd);
      report.steps.push({ name, exe, args, cwd, exitCode: result.status, signal: result.signal, error: result.error?.message, elapsedMs: Date.now() - started, log: logPath });
      json(reportPath, report);
      if (result.error || result.signal || result.status !== 0) throw Error(name + ' failed; see ' + logPath);
    }
    try {
      const snapshot = path.join(run, 'inputs');
      fs.mkdirSync(snapshot);
      for (const member of before) {
        const destination = path.join(snapshot, member.path);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(root, member.path), destination, fs.constants.COPYFILE_EXCL);
        if (sha(fs.readFileSync(destination)) !== member.sha256) throw Error('Snapshot hash mismatch: ' + member.path);
      }
      const app = path.join(run, 'app');
      fs.mkdirSync(app);
      const compiler = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';
      const launcher = path.join(run, 'WindowUseMCP.exe');
      report.tools.launcherCompiler = { path: compiler, sha256: await fileHash(compiler), target: 'x64 .NET Framework console' };
      step('compile-launcher', compiler, ['/nologo', '/target:exe', '/platform:x64', '/optimize+', '/win32icon:' + path.join(snapshot, 'src/assets/app-icon.ico'), '/out:' + launcher, path.join(snapshot, 'launcher/Program.cs')], run);
      report.launcher = { sourceSha256: sha(fs.readFileSync(path.join(snapshot, 'launcher/Program.cs'))), executableSha256: await fileHash(launcher) };
      for (const name of ['src', 'vendor']) fs.cpSync(path.join(snapshot, name), path.join(app, name), { recursive: true, force: false, errorOnExist: true });
      for (const name of ['package.json', 'package-lock.json', 'LICENSE', 'README.md']) fs.copyFileSync(path.join(snapshot, name), path.join(app, name));
      const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
      if (!fs.existsSync(npmCli)) throw Error('Node installation must provide npm-cli.js adjacent to Node');
      step('production-dependencies', process.execPath, [npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', path.join(run, 'npm-cache')], app);
      const { packager, defaultSanitizePackageJson } = await import('@electron/packager');
      json(path.join(app, 'package.json'), defaultSanitizePackageJson(JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'))));
      fs.unlinkSync(path.join(app, 'package-lock.json'));
      const installedLock = path.join(app, 'node_modules/.package-lock.json');
      if (fs.existsSync(installedLock)) fs.unlinkSync(installedLock);
      const prepared = inventory(app);
      // Production installation must not accidentally pull packaging or browser automation tools.
      for (const forbidden of ['electron', '@electron/packager', 'playwright', 'playwright-core']) if (fs.existsSync(path.join(app, 'node_modules', forbidden))) throw Error('Development dependency in application: ' + forbidden);
      report.preparedAppSha256 = sha(JSON.stringify(prepared)); report.preparedAppFiles = prepared;
      const filename = 'electron-v' + installedElectron.version + '-win32-x64.zip';
      const checksumsFile = path.join(root, 'node_modules/electron/checksums.json');
      const checksums = JSON.parse(fs.readFileSync(checksumsFile, 'utf8'));
      const expectedZipSha256 = checksums[filename];
      if (!/^[a-f0-9]{64}$/.test(expectedZipSha256 || '')) throw Error('Pinned Electron checksum unavailable');
      let electronZip;
      const cache = path.join(process.env.LOCALAPPDATA || '', 'electron/Cache');
      if (process.env.LOCALAPPDATA && fs.existsSync(cache)) {
        for (const entry of fs.readdirSync(cache, { withFileTypes: true })) {
          if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
          const candidate = path.join(cache, entry.name, filename);
          if (fs.existsSync(candidate) && !fs.lstatSync(candidate).isSymbolicLink() && await fileHash(candidate) === expectedZipSha256) { electronZip = candidate; break; }
        }
      }
      if (!electronZip) {
        const { downloadArtifact } = await import('@electron/get');
        electronZip = await downloadArtifact({ version: installedElectron.version, artifactName: 'electron', platform: 'win32', arch: 'x64', checksums, cacheRoot: path.join(run, 'electron-cache'), tempDirectory: path.join(run, 'electron-download') });
      }
      if (await fileHash(electronZip) !== expectedZipSha256) throw Error('Electron ZIP checksum mismatch');
      report.electronZip = { path: electronZip, sha256: expectedZipSha256, checksumSource: 'node_modules/electron/checksums.json', checksumSourceSha256: sha(fs.readFileSync(checksumsFile)) };
      json(reportPath, report);
      fs.mkdirSync(release, { recursive: true });
      const paths = await packager({ dir: app, out: release, name: 'WindowUseHost', executableName: 'WindowUseHost', appVersion: pkg.version, buildVersion: pkg.version, electronVersion: installedElectron.version, electronZipDir: path.dirname(electronZip), platform: 'win32', arch: 'x64', icon: path.join(app, 'src/assets/app-icon.ico'), asar: true, prune: false, overwrite: false, quiet: true, junk: false, ignore: () => false, sanitizePackageJson: [value => value], tmpdir: path.join(run, 'packager-tmp'), extraResource: [path.join(snapshot, 'artifacts/runtime')] });
      fs.writeSync(log, JSON.stringify({ packagedPaths: paths }) + '\n');
      const unpacked = path.join(release, 'WindowUseMCP-win32-x64');
      const hostOutput = path.join(release, 'WindowUseHost-win32-x64');
      if (paths.length !== 1 || path.resolve(paths[0]) !== hostOutput || path.dirname(hostOutput) !== release || path.dirname(unpacked) !== release) throw Error('Unexpected packager output');
      fs.renameSync(hostOutput, unpacked);
      const executable = path.join(unpacked, 'WindowUseMCP.exe');
      const hostExecutable = path.join(unpacked, 'WindowUseHost.exe');
      fs.copyFileSync(launcher, executable, fs.constants.COPYFILE_EXCL);
      if (await fileHash(executable) !== report.launcher.executableSha256) throw Error('Packaged launcher differs from compiled launcher');
      const { flipFuses, getCurrentFuseWire, FuseVersion, FuseV1Options, FuseState } = await import('@electron/fuses');
      const originalFuses = await getCurrentFuseWire(hostExecutable);
      await flipFuses(hostExecutable, { version: FuseVersion.V1, [FuseV1Options.RunAsNode]: false });
      const fuses = await getCurrentFuseWire(hostExecutable);
      if (fuses[FuseV1Options.RunAsNode] !== FuseState.DISABLE) throw Error('RunAsNode fuse was not disabled');
      if (Object.keys(originalFuses).some(key => key !== String(FuseV1Options.RunAsNode) && originalFuses[key] !== fuses[key])) throw Error('An unrelated Electron fuse changed');
      report.fuses = { version: fuses.version, runAsNode: fuses[FuseV1Options.RunAsNode], enableNodeCliInspectArguments: fuses[FuseV1Options.EnableNodeCliInspectArguments] };
      const asar = await import('@electron/asar');
      const archive = path.join(unpacked, 'resources/app.asar');
      const packagedNames = asar.listPackage(archive).map(name => name.replace(/^[/\\]/, '').replaceAll('\\', '/'));
      const expectedNames = new Set(prepared.map(member => member.path));
      for (const member of prepared) if (sha(asar.extractFile(archive, path.normalize(member.path))) !== member.sha256) throw Error('Packaged ASAR content differs: ' + member.path);
      for (const name of packagedNames) if (!expectedNames.has(name) && !prepared.some(member => member.path.startsWith(name + '/'))) throw Error('Unrecorded ASAR content: ' + name);
      const checkedWindow = require('../vendor/azrael/window-control-runtime.cjs').verifyRuntime(path.join(unpacked, 'resources/runtime/window-control'));
      const checkedPointer = require('../vendor/azrael/multi-pointer-mcp.cjs').verifyRuntime(path.join(unpacked, 'resources/runtime/multi-pointer'));
      if (checkedWindow.manifestSha256 !== windowRuntime.manifestSha256 || checkedPointer.manifestSha256 !== pointerRuntime.manifestSha256) throw Error('Packaged native runtime differs from selected manifests');
      for (const required of ['LICENSE', 'LICENSES.chromium.html', 'resources/app.asar']) if (!fs.statSync(path.join(unpacked, required)).isFile()) throw Error('Distribution license or ASAR missing: ' + required);
      if (sha(JSON.stringify(selectedInputs())) !== sourceSha256 || sha(JSON.stringify(inventory(app))) !== report.preparedAppSha256) throw Error('Selected inputs changed during packaging');
      const outputFiles = inventory(unpacked);
      const zipName = 'WindowUseMCP-' + pkg.version + '-win32-x64.zip', zip = path.join(release, zipName);
      const zipInventoryFile = path.join(run, 'zip-inventory.json');
      const zipScript = path.join(run, 'zip.ps1');
      fs.writeFileSync(zipScript, "$ErrorActionPreference='Stop'\nAdd-Type -AssemblyName System.IO.Compression\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n$created=[System.IO.Compression.ZipFile]::Open($env:WU_PACKAGE_ZIP,[System.IO.Compression.ZipArchiveMode]::Create)\ntry { $base=[System.IO.Path]::GetFullPath($env:WU_PACKAGE_DIRECTORY); $prefix=[System.IO.Path]::GetFileName($base); foreach($file in [System.IO.Directory]::GetFiles($base,'*',[System.IO.SearchOption]::AllDirectories)) { $relative=$file.Substring($base.Length+1).Replace([char]92,[char]47); [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($created,$file,($prefix+'/'+$relative),[System.IO.Compression.CompressionLevel]::Optimal) | Out-Null } } finally { $created.Dispose() }\n$archive=[System.IO.Compression.ZipFile]::OpenRead($env:WU_PACKAGE_ZIP)\n$rows=@()\ntry { foreach($entry in $archive.Entries) { if($entry.FullName.EndsWith('/')) { continue }; $stream=$entry.Open(); $hash=[System.Security.Cryptography.SHA256]::Create(); try { $digest=[BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant(); $rows+=@{path=$entry.FullName; bytes=$entry.Length; sha256=$digest} } finally { $stream.Dispose(); $hash.Dispose() } } } finally { $archive.Dispose() }\nConvertTo-Json -Depth 5 -InputObject @($rows) | Set-Content -LiteralPath $env:WU_PACKAGE_ZIP_INVENTORY -Encoding UTF8\n");
      step('zip-and-verify', 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', zipScript], run, { WU_PACKAGE_DIRECTORY: unpacked, WU_PACKAGE_ZIP: zip, WU_PACKAGE_ZIP_INVENTORY: zipInventoryFile });
      const zipFiles = JSON.parse(fs.readFileSync(zipInventoryFile, 'utf8').replace(/^\uFEFF/, ''));
      const zipped = new Map();
      for (const entry of zipFiles) { if (zipped.has(entry.path)) throw Error('Duplicate ZIP member'); zipped.set(entry.path, entry); }
      if (zipped.size !== outputFiles.length) throw Error('ZIP member count differs from unpacked package');
      for (const member of outputFiles) { const zippedMember = zipped.get('WindowUseMCP-win32-x64/' + member.path); if (!zippedMember || zippedMember.bytes !== member.bytes || zippedMember.sha256 !== member.sha256) throw Error('ZIP content differs: ' + member.path); }
      const zipSha256 = await fileHash(zip);
      if (sha(JSON.stringify(selectedInputs())) !== sourceSha256 || sha(JSON.stringify(inventory(unpacked))) !== sha(JSON.stringify(outputFiles))) throw Error('Inputs or package changed before final receipt');
      const info = { schema: 1, kind: 'window-use-mcp-portable', version: pkg.version, buildId, sourceSha256, platform: 'win32', arch: 'x64', tools: report.tools, launcher: report.launcher, fuses: report.fuses, electronZip: report.electronZip, nativeManifests: report.nativeManifests, inputs: before, appFiles: prepared, files: outputFiles, zip: { path: zipName, bytes: fs.statSync(zip).size, sha256: zipSha256 }, proof: { launcherExactContents: true, asarExactContents: true, nativeRuntimeManifests: true, zipExactContents: true, selectedInputsUnchanged: true, packagedBehaviorAcceptance: 'pending' }, signing: 'unsigned; no Authenticode signing requested' };
      json(path.join(release, 'build-info.json'), info);
      fs.writeFileSync(path.join(release, 'SHA256SUMS.txt'), zipSha256 + '  ' + zipName + '\n' + sha(fs.readFileSync(path.join(release, 'build-info.json'))) + '  build-info.json\n' + outputFiles.map(member => member.sha256 + '  WindowUseMCP-win32-x64/' + member.path).join('\n') + '\n');
      report.status = 'passed'; report.activeReferences = ['packaged-acceptance']; report.release = release; report.zip = info.zip; report.proof = info.proof;
      json(reportPath, report);
      process.stdout.write(JSON.stringify({ release, executable, zip, zipSha256, buildInfo: path.join(release, 'build-info.json'), report: reportPath, packagedBehaviorAcceptance: 'pending' }) + '\n');
    } finally { fs.closeSync(log); }
  } catch (error) {
    if (report && reportPath) { report.status = 'failed'; report.error = error.message; json(reportPath, report); }
    throw error;
  } finally { fs.closeSync(lockFd); fs.unlinkSync(lock); }
}
if (require.main === module) packageMain().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
module.exports = { selectedInputs };
