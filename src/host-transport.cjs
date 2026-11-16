'use strict';
const crypto=require('node:crypto');
const failure=(code,message)=>Object.assign(Error(message),{code});
const fields=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
function createHostTransport({input=process.stdin,output=process.stdout,receive,onDisconnect,nativeTimeoutMs=60000}) {
  let buffer='',closed=false;const pending=new Map();
  function send(message){if(closed)return;output.write(JSON.stringify(message)+'\n');}
  function disconnect(error){if(closed)return;closed=true;for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(error||failure('host_closed','Native host closed'));}pending.clear();void Promise.resolve(onDisconnect?.(error)).catch(()=>{});}
  async function message(value){
    if(value&&Object.hasOwn(value,'nativeResponse')){
      if(!fields(value,['nativeResponse','result'])&&!fields(value,['nativeResponse','error']))throw failure('invalid_arguments','Malformed native reply');
      const entry=pending.get(value.nativeResponse);if(!entry)return;pending.delete(value.nativeResponse);clearTimeout(entry.timer);
      if(value.error)entry.reject(failure(value.error.code||'native_error',value.error.message||'Native request failed'));else entry.resolve(value.result);return;
    }
    let id=value?.id;
    try {
      if(!fields(value,['id','method','view','params'])||!(typeof id==='string'||Number.isSafeInteger(id))||!['settings','approval'].includes(value.view)||!['snapshot','command','closed','shutdown','stop'].includes(value.method))throw failure('invalid_arguments','Malformed host request');
      if(value.method!=='command'&&!fields(value.params,[]))throw failure('invalid_arguments','Unexpected request fields');
      const result=await receive(value);send({id,result:result??null});
    } catch(error){send({id:id??null,error:{code:error.code||'execution_error',message:error.message}});}
  }
  input.setEncoding('utf8');input.on('data',chunk=>{if(closed)return;buffer+=chunk;if(Buffer.byteLength(buffer)>1024*1024){disconnect(failure('invalid_arguments','Host frame exceeds limit'));return;}let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);try{const value=JSON.parse(line);void message(value).catch(disconnect);}catch(error){disconnect(error);return;}}});
  input.on('end',()=>disconnect());input.on('close',()=>disconnect());input.on('error',disconnect);output.on('error',disconnect);
  return {send,close:disconnect,native(method,params,view){if(closed)return Promise.reject(failure('host_closed','Native host closed'));if(!['getFileIcon','pickApp'].includes(method))return Promise.reject(failure('invalid_arguments','Unsupported native method'));const id=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(failure('native_timeout','Native host request expired'));},nativeTimeoutMs);pending.set(id,{resolve,reject,timer});send({event:'nativeRequest',id,method,...(view?{view}:{}),params});});}};
}
module.exports={createHostTransport};
