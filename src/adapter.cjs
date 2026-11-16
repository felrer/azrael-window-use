'use strict';
const {app}=require('electron');
const path=require('node:path');
const crypto=require('node:crypto');
const net=require('node:net');
const {createServiceClient}=require('./shared-client.cjs');
const registry=require('./service-registry.cjs');
const {createCandidate}=require('./service-candidate.cjs');
const {startMcp,SocketTransport}=require('./mcp.cjs');
const {createLogger}=require('./logger.cjs');
async function run() {
  const index=process.argv.indexOf('--mcp-pipe'),pipeName=process.argv[index+1],token=process.env.WINDOW_USE_PIPE_TOKEN;
  delete process.env.WINDOW_USE_PIPE_TOKEN;
  if(index<0||!(process.platform==='win32'?/^[A-Za-z0-9_-]{1,128}$/.test(pipeName||''):path.isAbsolute(pipeName||'')&&path.basename(pipeName)==='mcp.sock')||!/^[a-f0-9]{64}$/.test(token||''))throw Error('Start MCP using the WindowUseMCP launcher');
  const runtimeIndex=process.argv.indexOf('--runtime-directory');
  const runtimeDirectory=runtimeIndex<0?(app.isPackaged?path.join(process.resourcesPath,'runtime/window-control'):path.resolve(__dirname,'../artifacts/runtime/window-control')):process.argv[runtimeIndex+1];
  if(!path.isAbsolute(runtimeDirectory)||app.isPackaged&&runtimeIndex>=0)throw Error('Absolute development runtime required');
  const profileIndex=process.argv.indexOf('--user-data-dir');
  const profileDirectory=profileIndex>=0?process.argv[profileIndex+1]:path.join(app.getPath('appData'),'Azrael Window Use MCP');
  if(!path.isAbsolute(profileDirectory||''))throw Error('Absolute user data directory required');
  app.setName('Azrael Window Use');app.setPath('userData',profileDirectory);
  const sharedDirectory=process.env.AZ_WINDOW_USE_SHARED_DIRECTORY||(profileIndex>=0?path.join(process.argv[profileIndex+1],'shared'):registry.defaultDirectory());
  const appRoot=path.resolve(__dirname,'..');
  const args=[...(app.isPackaged?[]:[appRoot]),'--shared-service',...(!app.isPackaged?['--runtime-directory',runtimeDirectory]:[]),...(profileIndex>=0?['--user-data-dir',process.argv[profileIndex+1]]:[])];
  const client=createServiceClient({directory:sharedDirectory,candidate:createCandidate({appRoot,runtimeDirectory,args})});
  const thread=crypto.randomUUID();
  const log=createLogger(path.join(profileDirectory,'logs'),app.getVersion());
  const socket=net.createConnection(process.platform==='win32'?'\\\\.\\pipe\\'+pipeName:pipeName);
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
  await new Promise((resolve,reject)=>socket.write(token+'\n',error=>error?reject(error):resolve()));
  let closing=false;
  async function close() {if(closing)return;closing=true;await client.closeSession(thread).catch(()=>{});await client.dispose();app.quit();}
  await startMcp({runtime:{thread,call:(method,args,signal)=>client.call(thread,method,args,{signal})},log,transport:new SocketTransport(socket),onClose:()=>void close()});
  // Register this installation on connection, even before the first tool call,
  // so a newer compatible installation can trigger an idle service handover.
  await client.ensure();
  process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
  app.on('before-quit',event=>{if(!closing){event.preventDefault();void close();}});
}
module.exports={run};
