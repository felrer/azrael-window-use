'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {inventory}=require('./build-native.cjs');
const root=path.resolve(__dirname,'..');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const json=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
function commandLauncher(platform) {
  const host=platform==='darwin'?'WindowUseHost.app/Contents/MacOS/WindowUseHost':'WindowUseHost';
  const resources=platform==='darwin'?'WindowUseHost.app/Contents/Resources':'resources';
  return '#!/bin/sh\nset -eu\nbase=$(CDPATH= cd -P "$(dirname "$0")" && pwd)\nexport ELECTRON_RUN_AS_NODE=1\nexec "$base/'+host+'" "$base/'+resources+'/app/src/unix-launcher.cjs" "$@"\n';
}
function selectedInputs() {
  const names=['package.json','package-lock.json','LICENSE','README.md','scripts/package-unix.cjs','scripts/build-native.cjs'];
  const files=names.map(name=>{const bytes=fs.readFileSync(path.join(root,name));return {path:name,bytes:bytes.length,sha256:sha(bytes)};});
  for(const directory of ['src','vendor/azrael','artifacts/runtime/window-control'])
    for(const entry of inventory(path.join(root,directory)))files.push({...entry,path:directory+'/'+entry.path});
  return files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
async function main() {
  if(!['darwin','linux'].includes(process.platform)||!['arm64','x64'].includes(process.arch))throw Error('Packaging requires native macOS/Linux arm64 or x64');
  if(process.argv.length!==2)throw Error('Usage: node scripts/package-unix.cjs');
  const runtime=path.join(root,'artifacts/runtime/window-control');
  const {verifyPlatformRuntime}=require('../src/platform-backend.cjs');
  const checkedRuntime=verifyPlatformRuntime(runtime);
  const buildRoot=path.join(root,'artifacts/build');fs.mkdirSync(buildRoot,{recursive:true});
  const lock=path.join(buildRoot,'package-unix.lock'),fd=fs.openSync(lock,'wx');
  let report,reportFile;
  try {
    fs.writeSync(fd,JSON.stringify({pid:process.pid}));
    const before=selectedInputs(),sourceSha256=sha(JSON.stringify(before)),id=Date.now()+'-'+sourceSha256.slice(0,10)+'-'+crypto.randomBytes(3).toString('hex');
    const run=path.join(buildRoot,'package-unix-'+id),release=path.join(root,'artifacts/releases','unix-'+id);
    fs.mkdirSync(run);fs.mkdirSync(release,{recursive:true});
    reportFile=path.join(run,'package-report.json');
    report={schema:1,owner:'standalone-package-unix',status:'running',platform:process.platform,arch:process.arch,sourceSha256,inputs:before,plannedOutputs:[run,release],activeReferences:['packager'],signing:'unsigned; no signing or publication requested'};
    json(reportFile,report);
    const snapshot=path.join(run,'inputs'),app=path.join(run,'app');fs.mkdirSync(snapshot);fs.mkdirSync(app);
    for(const member of before){
      const file=path.join(snapshot,member.path);fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(path.join(root,member.path),file,fs.constants.COPYFILE_EXCL);
      if(sha(fs.readFileSync(file))!==member.sha256)throw Error('Snapshot identity changed');
    }
    for(const name of ['src','vendor'])fs.cpSync(path.join(snapshot,name),path.join(app,name),{recursive:true,errorOnExist:true,force:false});
    for(const name of ['package.json','package-lock.json','LICENSE','README.md'])fs.copyFileSync(path.join(snapshot,name),path.join(app,name));
    const logFile=path.join(run,'production-dependencies.log'),log=fs.openSync(logFile,'wx');
    let installed;
    try {installed=spawnSync('npm',['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund','--cache',path.join(run,'npm-cache')],{cwd:app,stdio:['ignore',log,log]});}
    finally {fs.closeSync(log);}
    report.dependencies={exitCode:installed.status,error:installed.error?.message,log:logFile};json(reportFile,report);
    if(installed.error||installed.status!==0)throw Error('Production dependency installation failed; see '+logFile);
    const pkg=JSON.parse(fs.readFileSync(path.join(app,'package.json'),'utf8'));
    const {packager,defaultSanitizePackageJson}=await import('@electron/packager');
    json(path.join(app,'package.json'),defaultSanitizePackageJson(pkg));
    fs.unlinkSync(path.join(app,'package-lock.json'));
    const prepared=inventory(app);
    const paths=await packager({dir:app,out:release,name:'WindowUseHost',executableName:'WindowUseHost',appBundleId:'com.azrael.window-use',appVersion:pkg.version,buildVersion:pkg.version,electronVersion:pkg.devDependencies.electron,platform:process.platform,arch:process.arch,asar:false,prune:false,overwrite:false,quiet:true,extraResource:[path.join(snapshot,'artifacts/runtime')]});
    if(paths.length!==1)throw Error('Unexpected packager output');
    const distribution=paths[0],resources=path.join(distribution,process.platform==='darwin'?'WindowUseHost.app/Contents/Resources':'resources');
    for(const member of prepared)if(sha(fs.readFileSync(path.join(resources,'app',member.path)))!==member.sha256)throw Error('Packaged application differs: '+member.path);
    for(const member of inventory(path.join(snapshot,'artifacts/runtime')))if(sha(fs.readFileSync(path.join(resources,'runtime',member.path)))!==member.sha256)throw Error('Packaged runtime differs: '+member.path);
    if(verifyPlatformRuntime(path.join(resources,'runtime/window-control')).manifestSha256!==checkedRuntime.manifestSha256)throw Error('Packaged native manifest differs');
    const command=path.join(distribution,'WindowUseMCP');fs.writeFileSync(command,commandLauncher(process.platform),{mode:0o755,flag:'wx'});
    // RunAsNode is required by this command; Windows' disabled fuse is not applied.
    const host=path.join(distribution,process.platform==='darwin'?'WindowUseHost.app/Contents/MacOS/WindowUseHost':'WindowUseHost');
    const {getCurrentFuseWire,FuseV1Options,FuseState}=await import('@electron/fuses');
    const fuses=await getCurrentFuseWire(host);
    if(fuses[FuseV1Options.RunAsNode]!==FuseState.ENABLE)throw Error('Bundled launcher requires Electron RunAsNode');
    if(sha(JSON.stringify(selectedInputs()))!==sourceSha256)throw Error('Source changed during packaging');
    report.status='passed';report.activeReferences=['packaged-acceptance'];report.distribution=distribution;report.command=command;report.packagedBehaviorAcceptance='pending';report.fuses={runAsNode:fuses[FuseV1Options.RunAsNode]};report.appFiles=prepared;
    json(path.join(distribution,'build-info.json'),report);json(reportFile,report);
    process.stdout.write(JSON.stringify({distribution,command,report:reportFile,packagedBehaviorAcceptance:'pending'})+'\n');
  } catch(error) {if(report){report.status='failed';report.error=error.message;json(reportFile,report);}throw error;}
  finally {fs.closeSync(fd);fs.unlinkSync(lock);}
}
if(require.main===module)main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
module.exports={commandLauncher,selectedInputs};
