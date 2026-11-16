'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {normalizeExecutable}=require('./platform-paths.cjs');
const MAX_ICON_BYTES = 96 * 1024, MAX_CACHE_BYTES = 8 * 1024 * 1024;
const validIcon = url => typeof url === 'string' && url.length <= MAX_ICON_BYTES && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(url);
// Persistent cache is an optional optimization, never a source of authority.
function diskCache(directory) {
  const file = directory && path.join(directory,'icons-v1.json');
  let records = {}, writing = Promise.resolve();
  const ready = !file ? Promise.resolve() : (async()=>{
    try { const info=await fs.lstat(file); if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_CACHE_BYTES)return;
      const data=JSON.parse(await fs.readFile(file,'utf8'));
      if(data.schema===1&&data.entries&&typeof data.entries==='object'&&!Array.isArray(data.entries))records=data.entries;
    } catch {} // Missing/corrupt cache must not prevent approval.
  })();
  return {
    async get(key,signature){await ready;const entry=records[key];return entry?.signature===signature&&validIcon(entry.url)?entry.url:null;},
    put(key,signature,url){
      if(!file||!validIcon(url))return;
      writing=writing.then(async()=>{
        await ready;records[key]={signature,url,used:Date.now()};
        const entries=Object.entries(records).filter(([key,value])=>/^[a-f0-9]{64}$/.test(key)&&validIcon(value?.url)&&typeof value.signature==='string').sort((a,b)=>(b[1].used||0)-(a[1].used||0)).slice(0,512);
        let bytes=0;records={};
        for(const [name,entry] of entries){const size=Buffer.byteLength(JSON.stringify(entry))+name.length+8;if(bytes+size>MAX_CACHE_BYTES-128)continue;records[name]=entry;bytes+=size;}
        await fs.mkdir(directory,{recursive:true});
        const temp=path.join(directory,`icons-${process.pid}-${crypto.randomUUID()}.tmp`);
        try {await fs.writeFile(temp,JSON.stringify({schema:1,entries:records}),{flag:'wx',mode:0o600});await fs.rename(temp,file);}
        finally {try {await fs.unlink(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}
      }).catch(()=>{}); // Cache failures fall back to extraction next time.
    },
    flush(){return writing;}
  };
}
function createAppIcons({ getFileIcon, changed, directory, maxEntries = 512, concurrency = 4, stat = fs.stat, now = Date.now, revalidateMs = 30000 }) {
  const cache = new Map(), queue = [], disk=diskCache(directory);
  let active = 0, background = 0, disposed = false, scheduled = false;
  function schedule(){if(!scheduled&&!disposed){scheduled=true;queueMicrotask(()=>{scheduled=false;pump();});}}
  const signature = info => `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  async function extract(executable,entry){
    let before,key;
    if(directory){
      before=await stat(executable);if(!before.isFile())return;
      key=crypto.createHash('sha256').update(executable).digest('hex');
      const hit=await disk.get(key,signature(before));if(hit){entry.url=hit;return;}
    }
    entry.url=null;
    const bundle=process.platform==='darwin'?/^(.*?\.app)(?:\/|$)/.exec(executable)?.[1]:null;
    const icon=await getFileIcon(bundle||executable,{size:'normal'});
    if(disposed||icon.isEmpty())return;
    const url=icon.toDataURL();if(!validIcon(url))return;
    if(directory){const after=await stat(executable);if(disposed||signature(before)!==signature(after))return;disk.put(key,signature(after),url);}
    entry.url=url;
  }
  function pump() {
    const backgroundLimit=concurrency>=3?concurrency-1:concurrency;
    while(!disposed&&active<concurrency&&queue.length){
      const urgent=queue.findIndex(([,entry])=>entry.priority);
      if(urgent<0&&background>=backgroundLimit)break;
      const [executable,entry]=queue.splice(urgent<0?0:urgent,1)[0];
      entry.started=true;active++;const isBackground=!entry.priority;if(isBackground)background++;
      Promise.resolve().then(()=>extract(executable,entry)).catch(()=>{}).finally(()=>{
        entry.done=true;entry.checked=now();active--;if(isBackground)background--;
        if(!disposed){changed();pump();}
      });
    }
  }
  function get(executable,priority=false){
    if(disposed)return null;
    try{executable=normalizeExecutable(executable);}catch{return null;}
    let entry=cache.get(executable);
    if(entry&&entry.done&&directory&&now()-entry.checked>=revalidateMs){cache.delete(executable);entry=null;}
    if(entry){if(priority&&!entry.started&&!entry.priority){entry.priority=true;schedule();}return entry.url;}
    if(cache.size>=maxEntries){const oldest=[...cache].find(([,value])=>value.done);if(!oldest)return null;cache.delete(oldest[0]);}
    entry={url:null,done:false,started:false,priority,checked:now()};cache.set(executable,entry);queue.push([executable,entry]);schedule();return null;
  }
  return {
    get,
    state(executable){try{executable=normalizeExecutable(executable);}catch{return 'unavailable';}const entry=cache.get(executable);return !entry?'unavailable':entry.url?'ready':entry.done?'unavailable':'loading';},
    flush(){return disk.flush();},
    dispose(){disposed=true;queue.length=0;cache.clear();}
  };
}
module.exports = { createAppIcons };
