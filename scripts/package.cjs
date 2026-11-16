'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {inventory}=require('./build-native.cjs');
const {inventoryApp,inventoryDistribution}=require('./package-inventory.cjs');
const root=path.resolve(__dirname,'..');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const json=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
const hash=file=>sha(fs.readFileSync(file));
function targetLayout(platform=process.platform,arch=process.arch) {
  if(!['win32-x64','darwin-arm64','linux-x64'].includes(platform+'-'+arch))throw Error('Unsupported packaging target: '+platform+'-'+arch);
  return {platform,arch,payloadDirectory:'WindowUseMCP-'+platform+'-'+arch,executable:platform==='darwin'?'WindowUseHost.app/Contents/MacOS/azrael-window-use':platform==='win32'?'WindowUseMCP.exe':'WindowUseMCP',resourceDirectory:platform==='darwin'?'WindowUseHost.app/Contents/Resources':'resources'};
}
function prepareAppPackage(pkg) {
  const packageJson=structuredClone(pkg);
  delete packageJson.devDependencies;delete packageJson.scripts;
  return {packageJson};
}
function selectedInputs() {
  const files=['package.json','package-lock.json','LICENSE','README.md','scripts/package.cjs','scripts/package-unix.cjs','scripts/package-inventory.cjs','scripts/package-archive.cjs','scripts/build-native.cjs','scripts/launch.cjs'];
  for(const name of ['Cargo.toml','Cargo.lock','build.rs','tauri.conf.json'])files.push('src-tauri/'+name);
  const result=files.map(file=>({path:file,bytes:fs.statSync(path.join(root,file)).size,sha256:hash(path.join(root,file))}));
  for(const directory of ['src','vendor/azrael','src-tauri/src','src-tauri/capabilities','src-tauri/permissions','artifacts/runtime'])for(const member of inventory(path.join(root,directory)))result.push({...member,path:directory+'/'+member.path});
  return result.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
function checkedBinary(file,layout) {
  if(!fs.lstatSync(file).isFile())throw Error('Executable must be a regular file');
  const bytes=fs.readFileSync(file);let arch;
  if(layout.platform==='win32') {
    if(bytes.length<64||bytes.toString('ascii',0,2)!=='MZ')throw Error('Windows executable header missing');
    const offset=bytes.readUInt32LE(60);
    if(offset+6>bytes.length||bytes.toString('ascii',offset,offset+4)!=='PE\0\0')throw Error('PE header missing');
    arch=bytes.readUInt16LE(offset+4)===0x8664?'x64':null;
  }else if(layout.platform==='linux'){
    if(bytes.length<20||bytes.readUInt32BE(0)!==0x7f454c46||bytes[4]!==2||bytes[5]!==1)throw Error('ELF64 executable header missing');
    arch=bytes.readUInt16LE(18)===62?'x64':null;
  }else {
    if(bytes.length<8||bytes.readUInt32LE(0)!==0xfeedfacf)throw Error('Thin Mach-O64 executable required');
    arch=bytes.readUInt32LE(4)===0x100000c?'arm64':null;
  }
  if(arch!==layout.arch)throw Error('Executable architecture differs from package');
  return hash(file);
}
function checkedNode(file,layout) {
  if(!file||!path.isAbsolute(file))throw Error('--node requires an explicit absolute installed Node binary');
  if(!fs.lstatSync(file).isFile())throw Error('Node binary must be a regular file');
  const result=spawnSync(file,['-p','JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})'],{encoding:'utf8',windowsHide:true,env:{...process.env,NODE_OPTIONS:'',NODE_PATH:''}});
  if(result.error||result.signal||result.status!==0)throw Error('Node target probe failed');
  checkedBinary(file,layout);
  const info=JSON.parse(result.stdout);
  if(info.platform!==layout.platform||info.arch!==layout.arch||!/^v\d+\.\d+\.\d+$/.test(info.version))throw Error('Node binary target differs from package');
  return {...info,path:file,sha256:hash(file),bytes:fs.statSync(file).size};
}
function verifyNative(resources,layout) {
  const directory=path.join(resources,'runtime'),names=layout.platform==='win32'?['multi-pointer','window-control']:['window-control'];
  if(JSON.stringify(fs.readdirSync(directory).sort())!==JSON.stringify(names))throw Error('Unexpected native runtime resources');
  const result={windowControl:(layout.platform==='win32'?require('../vendor/azrael/window-control-runtime.cjs').verifyRuntime(path.join(directory,'window-control')):require('../src/platform-backend.cjs').verifyPlatformRuntime(path.join(directory,'window-control'),layout)).manifestSha256};
  if(layout.platform==='win32')result.multiPointer=require('../vendor/azrael/multi-pointer-mcp.cjs').verifyRuntime(path.join(directory,'multi-pointer')).manifestSha256;
  return result;
}
function parseArguments(args) {
  const result={};
  for(let index=0;index<args.length;index++) {
    const key=args[index];
    if(key==='--prepare'){result.prepare=true;continue;}
    if(!['--node','--node-license','--host','--host-report'].includes(key)||result[key.slice(2)]!==undefined||!args[index+1]||args[index+1].startsWith('--'))throw Error('Usage: package.cjs --prepare --node <absolute binary> --node-license <file>; or --host <binary|app> --host-report <file>');
    if(!path.isAbsolute(args[index+1]))throw Error(key+' requires an absolute path');
    result[key.slice(2)]=args[++index];
  }
  return result;
}
function same(actual,expected,label){if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error(label+' changed');}
function copyTree(source,target){fs.cpSync(source,target,{recursive:true,dereference:false,verbatimSymlinks:true,errorOnExist:true,force:false});}
function prepareResources(options,layout,report,save,step) {
  if(fs.existsSync(path.join(root,'artifacts/tauri-resources'))||fs.existsSync(path.join(root,'artifacts/build/tauri-prepare.json')))throw Error('Prepared resources already exist; release consumers and retire through their artifact owner before preparing again');
  const node=checkedNode(options.node,layout),license=options['node-license']||path.join(path.dirname(node.path),'LICENSE');
  if(!fs.lstatSync(license).isFile())throw Error('Node LICENSE must be a regular file; pass --node-license');
  const before=selectedInputs(),sourceSha256=sha(JSON.stringify(before));
  Object.assign(report,{sourceSha256,inputs:before,node,nodeLicense:{path:license,sha256:hash(license)},nativeManifests:verifyNative(path.join(root,'artifacts'),layout)});save();
  const snapshot=path.join(report.run,'inputs'),prepared=path.join(report.run,'resources');
  fs.mkdirSync(snapshot);fs.mkdirSync(prepared);
  for(const member of before){const target=path.join(snapshot,member.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,member.path),target,fs.constants.COPYFILE_EXCL);if(hash(target)!==member.sha256)throw Error('Source changed during snapshot: '+member.path);}
  const app=path.join(prepared,'app');fs.mkdirSync(app);
  for(const name of ['src','vendor'])copyTree(path.join(snapshot,name),path.join(app,name));
  for(const name of ['package.json','package-lock.json','LICENSE','README.md'])fs.copyFileSync(path.join(snapshot,name),path.join(app,name));
  const npmCli=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
  if(!fs.existsSync(npmCli))throw Error('Installed Node must provide adjacent npm-cli.js');
  report.tools={node:process.version,npmCli, npmCliSha256:hash(npmCli)};save();
  step('production-dependencies',process.execPath,[npmCli,'ci','--omit=dev','--ignore-scripts','--bin-links=false','--no-audit','--no-fund','--cache',path.join(report.run,'npm-cache')],app);
  json(path.join(app,'package.json'),prepareAppPackage(JSON.parse(fs.readFileSync(path.join(app,'package.json')))).packageJson);
  fs.unlinkSync(path.join(app,'package-lock.json'));
  const lock=path.join(app,'node_modules/.package-lock.json');if(fs.existsSync(lock))fs.unlinkSync(lock);
  for(const forbidden of ['electron','@electron','playwright','playwright-core'])if(fs.existsSync(path.join(app,'node_modules',forbidden)))throw Error('Development dependency in application: '+forbidden);
  const dependencies=inventory(path.join(app,'node_modules')).sort((a,b)=>a.path.localeCompare(b.path,'en'));
  json(path.join(app,'dependencies.sha256.json'),{schema:1,files:dependencies});
  copyTree(path.join(snapshot,'artifacts/runtime'),path.join(prepared,'runtime'));
  fs.mkdirSync(path.join(prepared,'node'));
  const bundledNode=path.join(prepared,'node',layout.platform==='win32'?'node.exe':'node');
  fs.copyFileSync(node.path,bundledNode,fs.constants.COPYFILE_EXCL);fs.copyFileSync(license,path.join(prepared,'node/LICENSE'),fs.constants.COPYFILE_EXCL);
  if(layout.platform!=='win32')fs.chmodSync(bundledNode,0o755);
  if(hash(bundledNode)!==node.sha256||hash(license)!==report.nodeLicense.sha256)throw Error('Node runtime or license changed');
  same(selectedInputs(),before,'Selected source inputs');
  same(verifyNative(prepared,layout),report.nativeManifests,'Native runtime manifests');
  report.appFiles=inventoryApp(app);report.resourceFiles=inventoryDistribution(prepared,{excludeReceipt:false});
  report.resources=path.join(root,'artifacts/tauri-resources');report.resourceSha256=sha(JSON.stringify(report.resourceFiles));
  save();copyTree(prepared,report.resources);same(inventoryDistribution(report.resources,{excludeReceipt:false}),report.resourceFiles,'Published prepared resources');
  report.status='prepared';report.activeReferences=['tauri-compile','packaging'];save();
  json(path.join(root,'artifacts/build/tauri-prepare.json'),report);
  return report;
}
function verifyPrepared(report) {
  if(report.schema!==1||report.runtime!=='tauri'||report.status!=='prepared'||sha(JSON.stringify(report.inputs))!==report.sourceSha256)throw Error('Passed source-pinned prepared resources required');
  same(selectedInputs(),report.inputs,'Selected source inputs');same(inventoryDistribution(report.resources,{excludeReceipt:false}),report.resourceFiles,'Prepared resources');
  same(verifyNative(report.resources,report),report.nativeManifests,'Prepared native manifests');
}
function describeDistribution(distribution,report) {
  if(report?.schema!==1||report.runtime!=='tauri'||!['passed','prepared'].includes(report.status)||!report.inputs||sha(JSON.stringify(report.inputs))!==report.sourceSha256)throw Error('A passed source-pinned Tauri packaging report is required');
  const layout=targetLayout(report.platform,report.arch),resources=path.join(distribution,layout.resourceDirectory);
  same(inventoryApp(path.join(resources,'app')),report.appFiles,'Packaged application');
  if(report.resourceFiles)same(inventoryDistribution(resources,{excludeReceipt:false}),report.resourceFiles,'Packaged resources');
  same(verifyNative(resources,layout),report.nativeManifests,'Packaged native manifests');
  const files=inventoryDistribution(distribution),entry=files.find(file=>file.path===layout.executable);
  if(!entry||entry.type||(layout.platform!=='win32'&&entry.mode!==0o755))throw Error('Packaged Tauri executable unavailable');
  return {...report,...layout,kind:'window-use-mcp-portable',sharedService:{protocol:1,schema:1},launcher:{executableSha256:entry.sha256},files,packagedBehaviorAcceptance:'pending',proof:{payloadExactContents:true,nativeRuntimeManifests:true,selectedInputsUnchanged:true,packagedBehaviorAcceptance:'pending'}};
}
function signMacDistribution(distribution,report,step) {
  if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Native macOS arm64 signing required');
  const original=describeDistribution(distribution,report),app=path.join(distribution,'WindowUseHost.app');
  // Preserve valid supplier signatures and native manifests. Only seal the new outer app.
  for(const member of original.files)if(!member.type&&member.path.startsWith('WindowUseHost.app/')){
    const file=path.join(distribution,member.path),fd=fs.openSync(file,'r'),header=Buffer.alloc(4);let size;try{size=fs.readSync(fd,header,0,4,0);}finally{fs.closeSync(fd);}
    if(size===4&&[0xfeedface,0xcefaedfe,0xfeedfacf,0xcffaedfe,0xcafebabe,0xbebafeca].includes(header.readUInt32BE()))step('codesign-object-'+sha(member.path).slice(0,12),'/usr/bin/codesign',['--verify','--strict',file],distribution);
  }
  step('codesign-app','/usr/bin/codesign',['--force','--sign','-','--timestamp=none',app],distribution);
  step('verify-signed-app','/usr/bin/codesign',['--verify','--strict','--deep',app],distribution);
  const signed=describeDistribution(distribution,report),before=new Map(original.files.map(file=>[file.path,file]));
  const changes=signed.files.filter(file=>JSON.stringify(before.get(file.path))!==JSON.stringify(file));
  return {...signed,signing:{schema:1,policy:'adhoc-without-notarization',identity:'-',tool:'/usr/bin/codesign',verified:true,sourceSnapshotSha256:report.sourceSha256,beforeInventorySha256:sha(JSON.stringify(original.files)),afterInventorySha256:sha(JSON.stringify(signed.files)),changes}};
}
async function main(args=process.argv.slice(2)) {
  const options=parseArguments(args),layout=targetLayout(),buildRoot=path.join(root,'artifacts/build');fs.mkdirSync(buildRoot,{recursive:true});
  const lock=path.join(buildRoot,'package.lock'),fd=fs.openSync(lock,'wx');fs.writeSync(fd,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
  let report,reportFile;
  try {
    const id=new Date().toISOString().replace(/[-:.]/g,'')+'-'+crypto.randomBytes(4).toString('hex'),run=path.join(buildRoot,'package-'+id);
    fs.mkdirSync(run);reportFile=path.join(run,'package-report.json');
    report={schema:1,owner:'standalone-package',runtime:'tauri',status:'running',buildId:id,run,platform:layout.platform,arch:layout.arch,plannedOutputs:[run],activeReferences:['packager'],steps:[]};
    const save=()=>json(reportFile,report);save();
    const step=(name,exe,args,cwd)=>{const log=path.join(run,name+'.log'),output=fs.openSync(log,'wx'),started=Date.now();let result;try{result=spawnSync(exe,args,{cwd,env:{...process.env,NODE_OPTIONS:'',NODE_PATH:''},windowsHide:true,stdio:['ignore',output,output]});}finally{fs.closeSync(output);}report.steps.push({name,exe,args,cwd,exitCode:result.status,signal:result.signal,error:result.error?.message,elapsedMs:Date.now()-started,log});save();if(result.error||result.signal||result.status!==0)throw Error(name+' failed; see '+log);};
    if(options.prepare){report.plannedOutputs.push(path.join(root,'artifacts/tauri-resources'),path.join(buildRoot,'tauri-prepare.json'));save();prepareResources(options,layout,report,save,step);process.stdout.write(JSON.stringify({resources:report.resources,prepareReport:path.join(buildRoot,'tauri-prepare.json'),sourceSha256:report.sourceSha256,resourceSha256:report.resourceSha256})+'\n');return;}
    const prepared=JSON.parse(fs.readFileSync(path.join(buildRoot,'tauri-prepare.json')));verifyPrepared(prepared);
    if(!options.host||!options['host-report'])throw Error('--host and --host-report required after --prepare and source-pinned Rust compilation');
    const hostReport=JSON.parse(fs.readFileSync(options['host-report']));
    const hostBinary=layout.platform==='darwin'?path.join(options.host,'Contents/MacOS/azrael-window-use'):options.host;
    checkedBinary(hostBinary,layout);
    if(hostReport.schema!==1||hostReport.status!=='passed'||hostReport.sourceSha256!==prepared.sourceSha256||hostReport.resourceSha256!==prepared.resourceSha256||hostReport.executableSha256!==hash(hostBinary))throw Error('Host provenance differs from frozen source/resources or executable');
    Object.assign(report,{sourceSha256:prepared.sourceSha256,inputs:prepared.inputs,node:prepared.node,resourceFiles:prepared.resourceFiles,resourceSha256:prepared.resourceSha256,appFiles:prepared.appFiles,nativeManifests:prepared.nativeManifests,host:{...hostReport,reportSha256:hash(options['host-report'])}});
    const pkg=JSON.parse(fs.readFileSync(path.join(prepared.resources,'app/package.json'))),release=path.join(root,'artifacts/releases',pkg.version+'-'+id),distribution=path.join(release,layout.payloadDirectory);
    report.version=pkg.version;report.plannedOutputs.push(release);save();fs.mkdirSync(distribution,{recursive:true});
    if(layout.platform==='darwin')copyTree(options.host,path.join(distribution,'WindowUseHost.app'));else{fs.copyFileSync(hostBinary,path.join(distribution,layout.executable),fs.constants.COPYFILE_EXCL);if(layout.platform!=='win32')fs.chmodSync(path.join(distribution,layout.executable),0o755);}
    const resources=path.join(distribution,layout.resourceDirectory);
    if(fs.existsSync(resources)){
      const additions=hostReport.resourceAdditions||[];
      if(layout.platform!=='darwin'||additions.some(file=>!/^[-A-Za-z0-9_.]+\.icns$/.test(file.path)||!Number.isSafeInteger(file.bytes)||!/^[a-f0-9]{64}$/.test(file.sha256)||file.type))throw Error('Unapproved host resource additions');
      const expected=[...prepared.resourceFiles,...additions].sort((a,b)=>a.path.localeCompare(b.path,'en'));
      const actual=inventoryDistribution(resources,{excludeReceipt:false}).sort((a,b)=>a.path.localeCompare(b.path,'en'));
      same(actual,expected,'Host bundle resources');
      report.resourceFiles=inventoryDistribution(resources,{excludeReceipt:false});
    }else copyTree(prepared.resources,resources);
    same(inventoryDistribution(resources,{excludeReceipt:false}).sort((a,b)=>a.path.localeCompare(b.path,'en')),[...report.resourceFiles].sort((a,b)=>a.path.localeCompare(b.path,'en')),'Packaged resource payload');
    if(hash(path.join(distribution,layout.executable))!==hostReport.executableSha256)throw Error('Packaged host changed');
    report.status='passed';Object.assign(report,describeDistribution(distribution,report));
    report.signing=layout.platform==='win32'?'unsigned; no Authenticode signing requested':layout.platform==='linux'?'not applicable':'pending';
    if(layout.platform==='darwin')Object.assign(report,signMacDistribution(distribution,report,step));
    if(layout.platform==='win32')report.zip=require('./package-archive.cjs').zipWindows({distribution,release,run,version:pkg.version,files:report.files,step});
    verifyPrepared(prepared);same(inventoryDistribution(distribution),report.files,'Final payload');
    report.release=release;report.distribution=distribution;report.activeReferences=['packaged-acceptance'];save();
    json(path.join(release,'build-info.json'),report);json(path.join(distribution,'build-info.json'),report);
    fs.writeFileSync(path.join(release,'SHA256SUMS.txt'),(report.zip?report.zip.sha256+'  '+report.zip.path+'\n':'')+hash(path.join(release,'build-info.json'))+'  build-info.json\n'+report.files.filter(file=>!file.type).map(file=>file.sha256+'  '+layout.payloadDirectory+'/'+file.path).join('\n')+'\n');
    process.stdout.write(JSON.stringify({release,distribution,executable:path.join(distribution,layout.executable),buildInfo:path.join(release,'build-info.json'),report:reportFile,packagedBehaviorAcceptance:'pending'})+'\n');
  }catch(error){if(report){report.status='failed';report.error=error.message;json(reportFile,report);}throw error;}
  finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
if(require.main===module)main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
module.exports={main,targetLayout,prepareAppPackage,selectedInputs,checkedNode,checkedBinary,parseArguments,describeDistribution,signMacDistribution,verifyPrepared};
