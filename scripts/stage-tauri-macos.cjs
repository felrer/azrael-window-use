'use strict';
// Bundle an already compiled, source-pinned macOS host without rebuilding it.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {inventoryDistribution}=require('./package-inventory.cjs');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const hash=file=>sha(fs.readFileSync(file));
const json=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
function bundlePlist(version) {
 if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Exact application version required');
 return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n'+Object.entries({CFBundleDevelopmentRegion:'en',CFBundleExecutable:'azrael-window-use',CFBundleIdentifier:'com.azrael.window-use',CFBundleInfoDictionaryVersion:'6.0',CFBundleName:'WindowUseHost',CFBundleDisplayName:'Azrael Window Use',CFBundlePackageType:'APPL',CFBundleShortVersionString:version,CFBundleVersion:version,CFBundleIconFile:'app-icon',LSMinimumSystemVersion:'14.0'}).map(([key,value])=>'<key>'+key+'</key><string>'+value+'</string>').join('\n')+'\n<key>NSHighResolutionCapable</key><true/>\n</dict></plist>\n';
}
function parse(args) {
 const options={};for(let index=0;index<args.length;index+=2){const flag=args[index];if(!['--prepared','--host','--host-report','--out'].includes(flag)||options[flag.slice(2)]||!args[index+1]||!path.isAbsolute(args[index+1]))throw Error('Usage: stage-tauri-macos.cjs --prepared <absolute receipt> --host <absolute Rust binary> --host-report <absolute passing compile receipt> --out <new absolute owned directory>');options[flag.slice(2)]=args[index+1];}
 if(Object.keys(options).length!==4)throw Error('All staging paths are required');return options;
}
function main(args=process.argv.slice(2)) {
 if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Staging requires native macOS arm64');
 const options=parse(args),prepared=JSON.parse(fs.readFileSync(options.prepared)),compiled=JSON.parse(fs.readFileSync(options['host-report']));
 if(prepared.status!=='prepared'||prepared.runtime!=='tauri'||prepared.platform!=='darwin'||prepared.arch!=='arm64'||sha(JSON.stringify(prepared.inputs))!==prepared.sourceSha256||compiled.schema!==1||compiled.status!=='passed'||compiled.sourceSha256!==prepared.sourceSha256||compiled.resourceSha256!==prepared.resourceSha256||compiled.executableSha256!==hash(options.host))throw Error('Prepared resources or host provenance mismatch');
 const actual=()=>inventoryDistribution(prepared.resources,{excludeReceipt:false});
 if(JSON.stringify(actual())!==JSON.stringify(prepared.resourceFiles))throw Error('Prepared resources changed');
 if(fs.existsSync(options.out))throw Error('Stage output already exists');
 fs.mkdirSync(options.out,{recursive:true});
 const app=path.join(options.out,'WindowUseHost.app'),contents=path.join(app,'Contents'),resources=path.join(contents,'Resources'),recordFile=path.join(options.out,'stage-report.json');
 const record={...compiled,status:'running',owner:'standalone-package',plannedOutputs:[options.out],activeReferences:['mac-packaging'],compiledHostReport:{path:options['host-report'],sha256:hash(options['host-report'])},staging:{schema:1,tool:__filename,toolSha256:hash(__filename),inventoryToolSha256:hash(path.join(__dirname,'package-inventory.cjs')),signing:'pending outer app signing by final package producer',steps:[]}};
 json(recordFile,record);
 const step=(name,exe,args)=>{const log=path.join(options.out,name+'.log'),fd=fs.openSync(log,'wx');let result;try{result=spawnSync(exe,args,{windowsHide:true,stdio:['ignore',fd,fd]});}finally{fs.closeSync(fd);}record.staging.steps.push({name,exe,args,exitCode:result.status,signal:result.signal,error:result.error?.message,log});json(recordFile,record);if(result.error||result.signal||result.status!==0)throw Error(name+' failed; see '+log);};
 try {
  fs.mkdirSync(path.join(contents,'MacOS'),{recursive:true});
  const executable=path.join(contents,'MacOS/azrael-window-use');fs.copyFileSync(options.host,executable,fs.constants.COPYFILE_EXCL);fs.chmodSync(executable,0o755);
  if(hash(executable)!==compiled.executableSha256)throw Error('Copied host differs');
  fs.cpSync(prepared.resources,resources,{recursive:true,dereference:false,verbatimSymlinks:true,force:false,errorOnExist:true});
  if(JSON.stringify(inventoryDistribution(resources,{excludeReceipt:false}))!==JSON.stringify(prepared.resourceFiles))throw Error('Copied resources differ');
  const version=JSON.parse(fs.readFileSync(path.join(resources,'app/package.json'))).version;
  fs.writeFileSync(path.join(contents,'Info.plist'),bundlePlist(version),{flag:'wx'});
  fs.writeFileSync(path.join(contents,'PkgInfo'),'APPL????',{flag:'wx'});
  const source=path.join(resources,'app/src/assets/app-icon-256.png'),iconset=path.join(options.out,'app-icon.iconset');fs.mkdirSync(iconset);record.staging.iconSourceSha256=hash(source);
  for(const size of [16,32,128,256,512])for(const scale of [1,2]){const pixels=size*scale,target=path.join(iconset,'icon_'+size+'x'+size+(scale===2?'@2x':'')+'.png');if(pixels===256)fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);else step('icon-'+size+'-'+scale,'/usr/bin/sips',['-z',String(pixels),String(pixels),source,'--out',target]);}
  step('iconutil','/usr/bin/iconutil',['-c','icns',iconset,'-o',path.join(resources,'app-icon.icns')]);
  step('plist-check','/usr/bin/plutil',['-lint',path.join(contents,'Info.plist')]);
  const additions=inventoryDistribution(resources,{excludeReceipt:false}).filter(file=>file.path==='app-icon.icns');
  if(additions.length!==1)throw Error('Generated icon unavailable');
  if(JSON.stringify(actual())!==JSON.stringify(prepared.resourceFiles)||hash(options.host)!==compiled.executableSha256)throw Error('Staging inputs changed');
  Object.assign(record,{status:'passed',app,resourceAdditions:additions});record.staging.bundleFiles=inventoryDistribution(app);json(recordFile,record);
  process.stdout.write(JSON.stringify({app,hostReport:recordFile,sourceSha256:record.sourceSha256,resourceSha256:record.resourceSha256,resourceAdditions:additions,signing:'pending final package producer'})+'\n');
 }catch(error){record.status='failed';record.error=error.message;json(recordFile,record);throw error;}
}
if(require.main===module)try{main();}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
module.exports={bundlePlist,parse};
