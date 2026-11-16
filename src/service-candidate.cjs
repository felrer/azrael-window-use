'use strict';
const fs=require('node:fs');
// Candidate identities hash the physical archive, not Electron's virtual ASAR directory.
const physicalFs=process.versions.electron?require('original-fs'):fs;
const path=require('node:path');
const crypto=require('node:crypto');
const hash=file=>crypto.createHash('sha256').update(physicalFs.readFileSync(file)).digest('hex');
function createCandidate({executable=process.execPath,appRoot=path.resolve(__dirname,'..'),runtimeDirectory,args,platform=process.platform}={}) {
  const pkg=JSON.parse(fs.readFileSync(path.join(appRoot,'package.json'),'utf8'));
  const files=[];
  function add(file) { if(!files.some(entry=>entry.path===file))files.push({path:file,sha256:hash(file)}); }
  function walk(directory) { for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) { if(entry.isSymbolicLink())throw Error('Linked service inputs are unsupported'); const file=path.join(directory,entry.name);if(entry.isDirectory())walk(file);else if(entry.isFile())add(file); } }
  if(appRoot.endsWith('.asar'))add(appRoot);
  else { add(path.join(appRoot,'package.json'));walk(path.join(appRoot,'src'));walk(path.join(appRoot,'vendor/azrael')); }
  if(runtimeDirectory) {walk(runtimeDirectory);if(platform==='win32')walk(path.join(path.dirname(runtimeDirectory),'multi-pointer'));}
  const identity=crypto.createHash('sha256').update(JSON.stringify([executable,args,files])).digest('hex').slice(0,24);
  return {id:'window-use-'+identity,version:pkg.version,protocol:1,schema:1,executable,executableSha256:hash(executable),args:args||[appRoot,'--shared-service',...(runtimeDirectory?['--runtime-directory',runtimeDirectory]:[])],files};
}
module.exports={createCandidate};
