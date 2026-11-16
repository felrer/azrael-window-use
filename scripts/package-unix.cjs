'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {inventory}=require('./build-native.cjs');
const root=path.resolve(__dirname,'..');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const json=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
function prepareAppPackage(pkg,sanitize) {
  const electronVersion=pkg.devDependencies?.electron;
  if(!/^\d+\.\d+\.\d+$/.test(electronVersion||''))throw Error('Exact Electron version required for Unix packaging');
  // Packager's sanitizer mutates its argument, including devDependencies.
  return {electronVersion,packageJson:sanitize(structuredClone(pkg))};
}
// Complete transport inventory, including Electron's framework directory links.
// Never follow links during enumeration or change the signed vendor layout.
function inventoryDistribution(directory) {
  const base=fs.realpathSync(directory),files=[];
  function visit(rel) {
    if(rel==='build-info.json')return;
    const file=path.join(base,rel),stat=fs.lstatSync(file);
    if(stat.isSymbolicLink()) {
      const linkTarget=fs.readlinkSync(file),resolved=fs.realpathSync(file);
      const lexical=path.resolve(path.dirname(file),linkTarget),inside=value=>value===base||value.startsWith(base+path.sep);
      if(!linkTarget||path.posix.isAbsolute(linkTarget)||linkTarget.includes('\\')||linkTarget.includes(':')||/[\x00-\x1f]/.test(linkTarget)||!inside(lexical)||!inside(resolved))throw Error('Unsafe packaged relative link: '+rel);
      files.push({path:rel,type:'symlink',linkTarget});
    } else if(stat.isDirectory())for(const name of fs.readdirSync(file).sort())visit(rel?rel+'/'+name:name);
    else if(stat.isFile()){const bytes=fs.readFileSync(file);files.push({path:rel,bytes:bytes.length,sha256:sha(bytes),mode:stat.mode&0o111?0o755:0o644});}
    else throw Error('Unsupported packaged entry: '+rel);
  }
  visit('');return files;
}
function describeDistribution(distribution,report) {
  if(report?.schema!==1||report.owner!=='standalone-package-unix'||report.status!=='passed'||!['darwin-arm64','linux-x64'].includes(report.platform+'-'+report.arch)||!/^[a-f0-9]{64}$/.test(report.sourceSha256||'')||!Array.isArray(report.inputs)||sha(JSON.stringify(report.inputs))!==report.sourceSha256)throw Error('A passed source-pinned Unix packaging report is required');
  distribution=fs.realpathSync(distribution);
  const resources=path.join(distribution,report.platform==='darwin'?'WindowUseHost.app/Contents/Resources':'resources');
  if(JSON.stringify(inventoryApp(path.join(resources,'app')))!==JSON.stringify(report.appFiles))throw Error('Packaged application differs from source-pinned build report');
  const pkg=JSON.parse(fs.readFileSync(path.join(resources,'app/package.json')));
  const native=require(path.join(resources,'app/src/platform-backend.cjs')).verifyPlatformRuntime(path.join(resources,'runtime/window-control'),{platform:report.platform,arch:report.arch});
  const executable=report.platform==='darwin'?'WindowUseHost.app/Contents/MacOS/WindowUseHost':'WindowUseHost';
  const files=inventoryDistribution(distribution),entry=files.find(file=>file.path===executable);
  if(!entry||entry.type||entry.mode!==0o755)throw Error('Packaged Electron executable unavailable');
  return {...report,kind:'window-use-mcp-portable',version:pkg.version,buildId:report.buildId||path.basename(path.dirname(distribution)),payloadDirectory:'WindowUseHost-'+report.platform+'-'+report.arch,executable,sharedService:{protocol:1,schema:1},launcher:{executableSha256:entry.sha256},files,nativeManifestSha256:native.manifestSha256,packagedBehaviorAcceptance:report.packagedBehaviorAcceptance||'pending',proof:{payloadExactContents:true,nativeRuntimeManifests:true,selectedInputsUnchanged:true},inventoryBasis:'passed source-pinned package report; current full distribution and native manifest hashes; GUI acceptance separate'};
}
async function signMacDistribution(distribution,report) {
  if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Native macOS arm64 signing is required');
  distribution=fs.realpathSync(distribution);
  // This is a producer transformation of a fresh owned package copy. Preserve
  // the source snapshot and refuse any pre-existing application/native drift.
  const original=describeDistribution(distribution,report),before=original.files;
  if(report.files&&JSON.stringify(report.files)!==JSON.stringify(before))throw Error('Prebuilt package changed before signing');
  const app=path.join(distribution,'WindowUseHost.app'),objects=[];
  const magic=new Set([0xfeedface,0xcefaedfe,0xfeedfacf,0xcffaedfe,0xcafebabe,0xbebafeca,0xcafebabf,0xbfbafeca]);
  for(const entry of before)if(entry.type!=='symlink'&&entry.path.startsWith('WindowUseHost.app/')){
    const file=path.join(distribution,entry.path),header=Buffer.alloc(4),fd=fs.openSync(file,'r');let size;
    try{size=fs.readSync(fd,header,0,4,0);}finally{fs.closeSync(fd);}
    if(size===4&&magic.has(header.readUInt32BE()))objects.push(file);
  }
  const invoke=args=>{
    const result=spawnSync('/usr/bin/codesign',args,{encoding:'utf8',env:{...process.env,LC_ALL:'C'}});
    if(result.error)throw result.error;
    return {exitCode:result.status,output:(result.stdout||'')+(result.stderr||'')};
  };
  const checks=[];
  const {sign}=await import('@electron/osx-sign');
  await sign({app,platform:'darwin',identity:'-',identityValidation:false,preAutoEntitlements:false,gatekeeperAssess:false,
    optionsForFile:()=>({hardenedRuntime:false,timestamp:'none'}),
    ignore:file=>{
      // A valid supplier object or the separately verified native helper need not
      // be rewritten. Invalid enclosing bundles are sealed from inside out by
      // the mature Electron signer, including their resource envelopes.
      if(file===app)return false;
      const result=invoke(['--verify','--strict',file]);
      checks.push({path:path.relative(distribution,file).split(path.sep).join('/'),beforeValid:result.exitCode===0});
      return result.exitCode===0;
    }});
  for(const file of [...objects,app]){
    const result=invoke(['--verify','--strict',...(file===app?['--deep']:[]),file]);
    if(result.exitCode!==0)throw Error('Signed Mac package verification failed: '+path.relative(distribution,file)+'\n'+result.output);
  }
  // Rechecks exact appFiles AND the native manifest. A native helper rewrite
  // would invalidate its original manifest and must fail rather than be hidden.
  const signed=describeDistribution(distribution,{...report,files:undefined});
  if(signed.nativeManifestSha256!==original.nativeManifestSha256)throw Error('Mac signing changed the native runtime manifest');
  const after=signed.files,prior=new Map(before.map(entry=>[entry.path,entry])),next=new Map(after.map(entry=>[entry.path,entry]));
  const changes=[...new Set([...prior.keys(),...next.keys()])].sort().filter(name=>JSON.stringify(prior.get(name))!==JSON.stringify(next.get(name))).map(name=>({path:name,before:prior.get(name)||null,after:next.get(name)||null}));
  return {...signed,signing:{schema:1,policy:'adhoc-without-notarization',tool:'@electron/osx-sign',identity:'-',verified:true,sourceSnapshotSha256:report.sourceSha256,canonicalSourceReportSha256:sha(JSON.stringify(report)),producerScriptSha256:sha(fs.readFileSync(__filename)),beforeInventorySha256:sha(JSON.stringify(before)),afterInventorySha256:sha(JSON.stringify(after)),nativeManifestSha256:original.nativeManifestSha256,objectsVerified:objects.length+1,preserved:checks.filter(check=>check.beforeValid).map(check=>check.path),changes}};
}
// npm creates relative executable links on Unix. This inventory is only for
// prepared app dependencies; native/source inventories still reject all links.
function inventoryApp(directory) {
  const base=fs.realpathSync(directory),files=[];
  const relative=file=>path.relative(base,file).split(path.sep).join('/');
  const contained=file=>file===base||(!path.relative(base,file).startsWith('..'+path.sep)&&path.relative(base,file)!=='..'&&!path.isAbsolute(path.relative(base,file)));
  function resolveFile(file,seen=new Set()) {
    if(!contained(file))throw Error('Application link escapes its root: '+file);
    const parts=path.relative(base,file).split(path.sep);let current=base;
    for(let index=0;index<parts.length;index++){
      current=path.join(current,parts[index]);
      const info=fs.lstatSync(current);
      if(info.isSymbolicLink()){
        if(seen.has(current))throw Error('Cyclic application link: '+current);
        seen.add(current);
        const target=fs.readlinkSync(current);
        if(path.isAbsolute(target))throw Error('Absolute application link: '+current);
        const targetPath=path.resolve(path.dirname(current),target);
        if(!contained(targetPath))throw Error('Application link escapes its root: '+current);
        return resolveFile(path.resolve(targetPath,...parts.slice(index+1)),seen);
      }
    }
    if(!fs.lstatSync(current).isFile())throw Error('Application link must resolve to a regular file: '+file);
    return current;
  }
  function walk(folder){
    for(const entry of fs.readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
      const file=path.join(folder,entry.name);
      if(entry.isDirectory()){walk(file);continue;}
      if(!entry.isFile()&&!entry.isSymbolicLink())throw Error('Non-regular application input: '+file);
      const resolved=entry.isSymbolicLink()?resolveFile(file):file,bytes=fs.readFileSync(resolved);
      files.push({path:relative(file),bytes:bytes.length,sha256:sha(bytes),...(entry.isSymbolicLink()?{linkTarget:fs.readlinkSync(file),resolvedPath:relative(resolved)}:{})});
    }
  }
  walk(base);return files;
}
function restoreRelativeLinks(source,destination,prepared) {
  if(JSON.stringify(inventoryApp(source))!==JSON.stringify(prepared))throw Error('Prepared application changed before copy verification');
  for(const member of prepared.filter(file=>file.linkTarget!==undefined)){
    const file=path.join(destination,member.path);
    if(!fs.lstatSync(file).isSymbolicLink())throw Error('Packager replaced an application link: '+member.path);
    const actual=fs.readlinkSync(file);
    // Node fs.cp defaults to an absolute source target unless verbatimSymlinks
    // is true; Packager exposes dereferencing but not that separate option.
    const copiedTarget=path.resolve(path.dirname(path.join(source,member.path)),member.linkTarget);
    if(actual!==member.linkTarget&&actual!==copiedTarget)throw Error('Packager changed an application link target: '+member.path);
    if(actual!==member.linkTarget){fs.unlinkSync(file);fs.symlinkSync(member.linkTarget,file,'file');}
  }
  if(JSON.stringify(inventoryApp(destination))!==JSON.stringify(prepared))throw Error('Copied application contents or relative links differ');
}
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
    report={schema:1,owner:'standalone-package-unix',status:'running',platform:process.platform,arch:process.arch,sourceSha256,inputs:before,plannedOutputs:[run,release],activeReferences:['packager'],signing:process.platform==='darwin'?'pending ad-hoc signing; no notarization or publication':'not applicable'};
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
    const {electronVersion,packageJson}=prepareAppPackage(pkg,defaultSanitizePackageJson);
    json(path.join(app,'package.json'),packageJson);
    fs.unlinkSync(path.join(app,'package-lock.json'));
    const prepared=inventoryApp(app);
    const iconSource=path.join(snapshot,'src/assets/app-icon-256.png');
    let icon=iconSource;
    report.icon={sourceSha256:sha(fs.readFileSync(iconSource)),steps:[]};
    if(process.platform==='darwin'){
      const iconset=path.join(run,'app-icon.iconset');fs.mkdirSync(iconset);
      const iconLog=path.join(run,'icon-conversion.log'),iconFd=fs.openSync(iconLog,'wx');
      const convert=(executable,args)=>{
        const result=spawnSync(executable,args,{stdio:['ignore',iconFd,iconFd]});
        report.icon.steps.push({executable,args,exitCode:result.status,error:result.error?.message,log:iconLog});json(reportFile,report);
        if(result.error||result.status!==0)throw Error('Application icon conversion failed; see '+iconLog);
      };
      try {
        for(const size of [16,32,128,256,512])for(const scale of [1,2]){
          const target=path.join(iconset,'icon_'+size+'x'+size+(scale===2?'@2x':'')+'.png'),pixels=size*scale;
          if(pixels===256)fs.copyFileSync(iconSource,target,fs.constants.COPYFILE_EXCL);
          else convert('/usr/bin/sips',['-z',String(pixels),String(pixels),iconSource,'--out',target]);
        }
        icon=path.join(run,'app-icon.icns');
        convert('/usr/bin/iconutil',['-c','icns',iconset,'-o',icon]);
      } finally {fs.closeSync(iconFd);}
    }
    report.icon.path=icon;report.icon.sha256=sha(fs.readFileSync(icon));json(reportFile,report);
    const paths=await packager({dir:app,out:release,name:'WindowUseHost',executableName:'WindowUseHost',appBundleId:'com.azrael.window-use',icon,appVersion:pkg.version,buildVersion:pkg.version,electronVersion,platform:process.platform,arch:process.arch,asar:false,derefSymlinks:false,prune:false,overwrite:false,quiet:true,junk:false,ignore:()=>false,sanitizePackageJson:[value=>value],afterCopy:[async ({buildPath})=>restoreRelativeLinks(app,buildPath,prepared)],tmpdir:path.join(run,'packager-tmp'),extraResource:[path.join(snapshot,'artifacts/runtime')]});
    if(paths.length!==1)throw Error('Unexpected packager output');
    const distribution=paths[0],resources=path.join(distribution,process.platform==='darwin'?'WindowUseHost.app/Contents/Resources':'resources');
    if(JSON.stringify(inventoryApp(path.join(resources,'app')))!==JSON.stringify(prepared))throw Error('Packaged application contents or relative links differ');
    for(const member of inventory(path.join(snapshot,'artifacts/runtime')))if(sha(fs.readFileSync(path.join(resources,'runtime',member.path)))!==member.sha256)throw Error('Packaged runtime differs: '+member.path);
    if(verifyPlatformRuntime(path.join(resources,'runtime/window-control')).manifestSha256!==checkedRuntime.manifestSha256)throw Error('Packaged native manifest differs');
    const command=path.join(distribution,'WindowUseMCP');fs.writeFileSync(command,commandLauncher(process.platform),{mode:0o755,flag:'wx'});
    // RunAsNode is required by this command; Windows' disabled fuse is not applied.
    const host=path.join(distribution,process.platform==='darwin'?'WindowUseHost.app/Contents/MacOS/WindowUseHost':'WindowUseHost');
    const {getCurrentFuseWire,FuseV1Options,FuseState}=await import('@electron/fuses');
    const fuses=await getCurrentFuseWire(host);
    if(fuses[FuseV1Options.RunAsNode]!==FuseState.ENABLE)throw Error('Bundled launcher requires Electron RunAsNode');
    if(sha(JSON.stringify(selectedInputs()))!==sourceSha256)throw Error('Source changed during packaging');
    if(JSON.stringify(inventoryApp(app))!==JSON.stringify(prepared))throw Error('Prepared application changed during packaging');
    report.status='passed';report.activeReferences=['packaged-acceptance'];report.distribution=distribution;report.command=command;report.packagedBehaviorAcceptance='pending';report.fuses={runAsNode:fuses[FuseV1Options.RunAsNode]};report.appFiles=prepared;
    if(process.platform==='darwin')Object.assign(report,await signMacDistribution(distribution,report));
    Object.assign(report,describeDistribution(distribution,report));
    json(path.join(distribution,'build-info.json'),report);json(reportFile,report);
    process.stdout.write(JSON.stringify({distribution,command,report:reportFile,packagedBehaviorAcceptance:'pending'})+'\n');
  } catch(error) {if(report){report.status='failed';report.error=error.message;json(reportFile,report);}throw error;}
  finally {fs.closeSync(fd);fs.unlinkSync(lock);}
}
if(require.main===module)main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
module.exports={commandLauncher,selectedInputs,inventoryApp,restoreRelativeLinks,prepareAppPackage,inventoryDistribution,describeDistribution,signMacDistribution};
