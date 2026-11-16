'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
function verifyDependencies(appRoot){
  const root=path.join(appRoot,'node_modules'),receipt=path.join(appRoot,'dependencies.sha256.json');
  const info=fs.lstatSync(receipt);if(!info.isFile()||info.isSymbolicLink()||info.size>16*1024*1024)throw Error('Invalid dependency receipt');
  const data=JSON.parse(fs.readFileSync(receipt,'utf8'));
  if(!data||data.schema!==1||Object.keys(data).length!==2||!Array.isArray(data.files)||!data.files.length)throw Error('Invalid dependency receipt');
  const actual=new Map();
  function walk(directory,prefix=''){const stat=fs.lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Linked dependency directories unsupported');for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const name=prefix+entry.name,file=path.join(directory,entry.name);if(entry.isSymbolicLink())throw Error('Linked dependencies unsupported');if(entry.isDirectory())walk(file,name+'/');else if(entry.isFile())actual.set(name,file);else throw Error('Unsupported dependency input');}}
  walk(root);
  let previous='';
  for(const entry of data.files){if(!entry||Object.keys(entry).length!==3||typeof entry.path!=='string'||entry.path<=previous||entry.path.includes('\\')||entry.path.split('/').some(s=>!s||s==='.'||s==='..')||entry.path.startsWith('/')||entry.path.includes(':')||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||!/^[a-f0-9]{64}$/.test(entry.sha256||''))throw Error('Invalid dependency identity');previous=entry.path;
    const file=actual.get(entry.path);if(!file)throw Error('Missing dependency input');const stat=fs.lstatSync(file);if(stat.size!==entry.bytes||crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==entry.sha256)throw Error('Dependency input changed');actual.delete(entry.path);
  }
  if(actual.size)throw Error('Unlisted dependency input');return receipt;
}
module.exports={verifyDependencies};
