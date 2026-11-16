'use strict';
// The distribution invokes this with its bundled Electron in RunAsNode mode.
// The GUI adapter is a separate ordinary Electron process; stdout is MCP only.
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const net=require('node:net');
const {spawn}=require('node:child_process');
const registry=require('./service-registry.cjs');

async function run({host,appRoot,args=[],packaged=false,input=process.stdin,output=process.stdout,timeout=30000}={}) {
  if(process.platform==='win32')throw Error('Use the Windows MCP launcher on Windows');
  if(!path.isAbsolute(host||'')||!path.isAbsolute(appRoot||''))throw Error('Absolute host and application paths required');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'awu-'));
  let server,child,socket,timer;
  const token=crypto.randomBytes(32).toString('hex');
  try {
    await registry.prepareDirectory(directory);
    const address=path.join(directory,'mcp.sock');
    if(Buffer.byteLength(address)>103)throw Error('Temporary directory path is too long for a Unix socket');
    let connectedResolve,connectedReject;
    const connected=new Promise((resolve,reject)=>{connectedResolve=resolve;connectedReject=reject;});
    // Observe rejection before spawning, including an immediate spawn failure.
    connected.catch(()=>{});
    const pending=new Set();
    server=net.createServer(peer=>{
      pending.add(peer);peer.on('close',()=>pending.delete(peer));
      let buffer=Buffer.alloc(0);
      peer.setTimeout(5000,()=>peer.destroy());
      const authenticate=chunk=>{
        buffer=Buffer.concat([buffer,chunk]);
        const newline=buffer.indexOf(10);
        if(newline<0){if(buffer.length>64)peer.destroy();return;}
        if(socket||newline!==64||!crypto.timingSafeEqual(buffer.subarray(0,64),Buffer.from(token))){peer.destroy();return;}
        peer.off('data',authenticate);peer.setTimeout(0);peer.pause();
        socket=peer;
        if(buffer.length>65)peer.unshift(buffer.subarray(65));
        connectedResolve(peer);
      };
      peer.on('error',()=>{});peer.on('data',authenticate);
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(address,resolve);});
    const env={...process.env,WINDOW_USE_PIPE_TOKEN:token};delete env.ELECTRON_RUN_AS_NODE;
    child=spawn(host,[...(packaged?[]:[appRoot]),'--mcp-pipe',address,...args],{env,stdio:['ignore','ignore','inherit']});
    const exited=new Promise((resolve,reject)=>{
      child.once('error',error=>{connectedReject(error);reject(error);});
      child.once('exit',(code,signal)=>{connectedReject(Error('MCP adapter exited before connection'));resolve({code,signal});});
    });
    exited.catch(()=>{});
    timer=setTimeout(()=>connectedReject(Error('MCP adapter connection timed out')),timeout);
    const stop=()=>{socket?.end();if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');};
    process.once('SIGTERM',stop);process.once('SIGINT',stop);
    try {
      await connected;clearTimeout(timer);
      // Only the authenticated adapter may read client input or emit MCP bytes.
      for(const peer of pending)if(peer!==socket)peer.destroy();
      const drained=new Promise(resolve=>socket.once('close',resolve));
      server.close();input.pipe(socket);socket.pipe(output,{end:false});
      output.on('error',stop);
      const [result]=await Promise.all([exited,drained]);
      output.off('error',stop);
      if(result.code!==0)throw Error('MCP adapter exited '+(result.signal||result.code));
    } finally {
      process.off('SIGTERM',stop);process.off('SIGINT',stop);
      input.unpipe(socket);socket?.unpipe(output);
      for(const peer of pending)peer.destroy();
      if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await exited.catch(()=>{});}
    }
  } finally {
    clearTimeout(timer);socket?.destroy();
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    await fs.unlink(path.join(directory,'mcp.sock')).catch(error=>{if(error.code!=='ENOENT')throw error;});
    await fs.rmdir(directory);
  }
}
if(require.main===module){
  const root=path.resolve(__dirname,'..');
  run({host:process.execPath,appRoot:root,packaged:true,args:process.argv.slice(2).filter(arg=>arg!=='--mcp')}).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
}
module.exports={run};
