'use strict';
const path=require('node:path');
const crypto=require('node:crypto');
const net=require('node:net');
const {configuration}=require('./host-config.cjs');
const {createServiceClient}=require('./shared-client.cjs');
const {createCandidate}=require('./service-candidate.cjs');
const {createLogger}=require('./logger.cjs');
async function run() {
  const index=process.argv.indexOf('--mcp-pipe'),pipeName=process.argv[index+1],token=process.env.WINDOW_USE_PIPE_TOKEN;
  delete process.env.WINDOW_USE_PIPE_TOKEN;
  if(index>=0&&(!(process.platform==='win32'?/^[A-Za-z0-9_-]{1,128}$/.test(pipeName||''):path.isAbsolute(pipeName||'')&&path.basename(pipeName)==='mcp.sock')||!/^[a-f0-9]{64}$/.test(token||'')))throw Error('Start MCP using the WindowUseMCP launcher');
  const config=configuration();
  const client=createServiceClient({directory:config.sharedDirectory,candidate:createCandidate(config)});
  const {startMcp,SocketTransport}=require('./mcp.cjs');
  const thread=crypto.randomUUID(),log=createLogger(path.join(config.directory,'logs'),config.version);
  let socket,transport;
  if(index>=0){socket=net.createConnection(process.platform==='win32'?'\\\\.\\pipe\\'+pipeName:pipeName);await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});await new Promise((resolve,reject)=>socket.write(token+'\n',error=>error?reject(error):resolve()));transport=new SocketTransport(socket);}
  let closing;
  function close(){return closing||=(async()=>{await client.closeSession(thread).catch(()=>{});await client.dispose();socket?.destroy();})();}
  try{await client.ensure();}catch(error){await close();throw error;}
  // The SDK creates its standard StdioServerTransport when transport is omitted.
  const server=await startMcp({runtime:{thread,call:(method,args,signal)=>client.call(thread,method,args,{signal})},log,transport,onClose:()=>void close()});
  if(index<0){process.stdin.once('end',()=>void server.close().finally(close));process.stdin.once('close',()=>void server.close().finally(close));}
  process.once('SIGINT',()=>void server.close().finally(close));process.once('SIGTERM',()=>void server.close().finally(close));
  return {server,close};
}
module.exports={run};
