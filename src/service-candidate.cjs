'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function createCandidate({executable=process.env.AZ_WINDOW_USE_HOST_EXECUTABLE,appRoot=path.resolve(__dirname,'..'),runtimeDirectory,args,packaged=false,node=process.env.AZ_WINDOW_USE_NODE||process.execPath,platform=process.platform}={}) {
  if(!path.isAbsolute(executable||'')||!path.isAbsolute(node))throw Error('Absolute host and Node executables required');
  const pkg=JSON.parse(fs.readFileSync(path.join(appRoot,'package.json'),'utf8')),files=[];
  function add(file){if(!files.some(entry=>entry.path===file)){if(files.length>=128)throw Error('Service candidate exceeds 128 identity files');files.push({path:file,sha256:hash(file)});}}
  function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){if(entry.isSymbolicLink())throw Error('Linked service inputs are unsupported');const file=path.join(directory,entry.name);if(entry.isDirectory())walk(file);else if(entry.isFile())add(file);}}
  if(packaged)add(require('./dependency-integrity.cjs').verifyDependencies(appRoot));
  add(path.join(appRoot,'package.json'));walk(path.join(appRoot,'src'));walk(path.join(appRoot,'vendor'));add(node);
  if(runtimeDirectory){walk(runtimeDirectory);if(platform==='win32')walk(path.join(path.dirname(runtimeDirectory),'multi-pointer'));}
  const launchArgs=args||['--shared-service',...(runtimeDirectory?['--runtime-directory',runtimeDirectory]:[])];
  const executableSha256=hash(executable);
  const identity=crypto.createHash('sha256').update(JSON.stringify([executable,executableSha256,launchArgs,files])).digest('hex').slice(0,24);
  return {id:'window-use-'+identity,version:pkg.version,protocol:1,schema:1,executable,executableSha256,args:launchArgs,files};
}
module.exports={createCandidate};
