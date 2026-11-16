'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function inventoryDistribution(directory,{excludeReceipt=true}={}) {
  const base=fs.realpathSync(directory),files=[];
  function visit(rel) {
    if(excludeReceipt&&rel==='build-info.json')return;
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

module.exports={inventoryDistribution,inventoryApp,restoreRelativeLinks};
