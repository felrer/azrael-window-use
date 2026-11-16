'use strict';
const path=require('node:path');
const fs=require('node:fs');
const {PermissionService,fail}=require('./permissions.cjs');
const {createAppIcons}=require('./app-icons.cjs');
const {createLogger}=require('./logger.cjs');
const {createRuntime}=require('./runtime.cjs');
const {createSharedService}=require('./shared-service.cjs');
const {createServiceClient}=require('./shared-client.cjs');
const {createCandidate}=require('./service-candidate.cjs');
const {configuration}=require('./host-config.cjs');
const {createHostTransport}=require('./host-transport.cjs');
const {normalizeExecutable}=require('./platform-paths.cjs');
async function runHost({config=configuration()}={}) {
  let permissions,service,closing=false,transport,icons,agentOverlay;
  const sessions=new Map(),log=createLogger(path.join(config.directory,'logs'),config.version);
  const policies=()=>[permissions,...[...sessions.values()].map(s=>s.permissions)].filter(Boolean);
  const allApprovals=()=>policies().flatMap(p=>p.approvals());
  const hasPending=()=>policies().some(p=>p.pending.size);
  function respond(id,decision){const p=policies().find(p=>p.pending.has(id));if(!p)throw fail('approval_expired','Approval expired');return p.respond(id,decision);}
  function denyPending(){for(const p of policies())for(const id of [...p.pending.keys()])p.finish(id,fail('approval_denied','Approval window closed'));}
  function snapshot(view){
    const describe=(identity,priority=false)=>identity.locked?{...identity,icon:null,iconState:'ready'}:{...identity,icon:icons.get(identity.executable,priority),iconState:icons.state(identity.executable)};
    const settings=permissions.snapshot();settings.protectedApps=settings.protectedApps.map(i=>describe(i));settings.allowedApps=settings.allowedApps.map(i=>describe(i));
    return {version:config.version,settings,connection:{id:'',clientName:'',connected:sessions.size>0,stopped:permissions.stopped},approvals:allApprovals().map(r=>({...r,app:describe(r.app,true)})),theme:permissions.state.theme,view};
  }
  function broadcast(){if(!permissions||closing)return;for(const request of allApprovals())icons.get(request.app.executable,true);for(const view of ['settings','approval'])transport.send({event:'snapshot',view,snapshot:snapshot(view)});}
  function show(view){if(!closing&&(view!=='approval'||hasPending())){broadcast();transport.send({event:'show',view});}}
  async function shutdown(fromService=false){
    if(closing)return;closing=true;if(!fromService)permissions?.stop();denyPending();
    agentOverlay?.dispose();icons?.dispose();await icons?.flush();
    if(!fromService)await service?.close();
    for(const session of [...sessions.values()])await session.dispose();permissions?.dispose();
    transport?.send({event:'shutdown'});transport?.close();process.stdin.pause();
  }
  function fields(payload, required) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== required.length || required.some(key => !Object.hasOwn(payload,key))) throw fail('invalid_arguments', '설정 요청이 잘못되었습니다.');
}

  async function command(view,request){const entry={view};
    fields(request, ['action','payload']);
    const { action, payload } = request;
    if (typeof action !== 'string') throw fail('invalid_arguments', '알 수 없는 요청입니다.');
    if (['setEnabled','setMode','setTheme','addProtectedApp','addAllowedApp','resetSettings','removeProtectedApp','removeAllowedApp','resume'].includes(action) && entry.view !== 'settings') throw fail('permission_denied','설정창에서만 변경할 수 있습니다.');
    switch (action) {
      case 'setEnabled': fields(payload,['enabled']); permissions.save({enabled:payload.enabled}); break;
      case 'setMode': fields(payload,['mode']); permissions.save({mode:payload.mode}); break;
      case 'setTheme': fields(payload,['theme']); permissions.save({theme:payload.theme}); break;
      case 'addAllowedApp':
      case 'addProtectedApp': {
        let selected;
        if(!payload||typeof payload!=='object'||Array.isArray(payload))throw fail('invalid_arguments','Invalid app selection');
        if (Object.keys(payload).length) { fields(payload,['executable']); selected = payload.executable; }
        else {
          fields(payload,[]);
          selected = await transport.native('pickApp',{action},entry.view);
        }
        if (!selected) break;
        const executable = normalizeExecutable(selected);
        // Never probe a network location from a typed path or icon lookup.
        if (!(process.platform==='win32'?/^[a-z]:[\\/]/i.test(executable):executable.startsWith('/'))) throw fail('invalid_arguments','로컬 실행 파일을 선택해주세요.');
        if (!(await fs.promises.stat(executable)).isFile()) throw fail('invalid_arguments','실행 파일이 아닙니다.');
        if (action === 'addAllowedApp') {
          if (permissions.blocked({executable})) throw fail('security_app_blocked','보호된 앱은 허용할 수 없습니다.');
          permissions.save({allowedApps:[...permissions.state.allowedApps,executable]});
        } else permissions.save({protectedApps:[...permissions.state.protectedApps,executable],allowedApps:permissions.state.allowedApps.filter(exe=>exe!==executable)});
        break;
      }
      case 'resetSettings': fields(payload,[]); permissions.save({enabled:true,mode:'ask',protectedApps:[],allowedApps:[],theme:'system'}); break;
      case 'removeProtectedApp':
        fields(payload,['executable']);
        if (permissions.selfApps.has(normalizeExecutable(payload.executable))) throw fail('security_app_blocked','Window Use 자체 UI는 보호 해제할 수 없습니다.');
        permissions.save({protectedApps:permissions.state.protectedApps.filter(exe=>exe!==normalizeExecutable(payload.executable))}); break;
      case 'removeAllowedApp': fields(payload,['executable']); permissions.save({allowedApps:permissions.state.allowedApps.filter(exe=>exe!==normalizeExecutable(payload.executable))}); break;
      case 'respondApproval': fields(payload,['id','decision']); if(entry.view!=='approval')throw fail('permission_denied','승인창에서 응답해주세요.'); respond(payload.id,payload.decision); break;
      case 'stop': fields(payload,[]); permissions.stop(); break;
      case 'resume': fields(payload,[]); permissions.resume(); break;
      case 'minimize': fields(payload,[]);  break;
      case 'close': fields(payload,[]); if(entry.view==='approval')denyPending(); break;
      case 'openSettings': fields(payload,[]); show('settings'); break;
      default: throw fail('invalid_arguments','지원하지 않는 요청입니다.');
    }

    broadcast();return snapshot(view);
  }
  const candidate=createCandidate(config);
  if(!process.argv.includes('--shared-service')){const client=createServiceClient({directory:config.sharedDirectory,candidate});try{await client.ensure();await client.call('settings-'+require('node:crypto').randomUUID(),'service.showSettings',{});}finally{await client.dispose();}return;}
  transport=createHostTransport({async receive(request){
    switch(request.method){case 'snapshot':return snapshot(request.view);case 'command':return command(request.view,request.params);case 'closed':if(request.view==='approval')denyPending();return null;case 'stop':permissions.stop();return null;case 'shutdown':setImmediate(()=>void shutdown());return null;}
  },onDisconnect:()=>shutdown()});
  icons=createAppIcons({directory:path.join(config.directory,'cache/app-icons'),getFileIcon:async(executable,options)=>{const url=await transport.native('getFileIcon',{executable,...options});return {isEmpty:()=>!url,toDataURL:()=>url};},changed:broadcast});
  agentOverlay=require('./agent-overlay.cjs').createAgentOverlay({send:transport.send});
  try{
    permissions=new PermissionService({directory:config.directory,selfExecutables:[config.node,config.executable]});
    permissions.on('change',broadcast);permissions.on('approval',()=>show('approval'));
    service=await createSharedService({directory:config.sharedDirectory,candidate,
      createSession:({id,authorize,options={},emit})=>{
        const sessionPermissions=permissions.fork();let runtime;
        try{runtime=createRuntime({runtimeDirectory:config.runtimeDirectory,directory:config.directory,permissions:sessionPermissions,log,sessionId:id,authorize:options.authorizationRequired===true?authorize:undefined,workspacePath:options.workspacePath,workspaceName:options.workspaceName,codexHome:options.codexHome,emit,visualizer:agentOverlay});}catch(error){sessionPermissions.dispose();throw error;}
        sessionPermissions.on('change',broadcast);sessionPermissions.on('approval',()=>show('approval'));
        const entry={permissions:sessionPermissions,call:(method,args,signal,context)=>runtime.call(method,args,signal,context),async dispose(){sessions.delete(id);try{await runtime.dispose();}finally{sessionPermissions.dispose();broadcast();}}};sessions.set(id,entry);broadcast();return entry;
      },shutdown:()=>shutdown(true),onClosed:()=>transport.send({event:'shutdown'}),showSettings:()=>show('settings'),log});
    if(closing)await service.close();else broadcast();
  }catch(error){await shutdown();throw error;}
  process.once('SIGINT',()=>void shutdown());process.once('SIGTERM',()=>void shutdown());
  const fatal=error=>{log('error','app','uncaught_exception',{code:error?.code});permissions?.stop();void shutdown();};
  process.once('uncaughtException',fatal);process.once('unhandledRejection',fatal);
  return {shutdown,command,snapshot};
}
async function run(){if(process.argv.includes('--mcp')||process.argv.includes('--mcp-pipe'))return require('./adapter.cjs').run();return runHost();}
if(require.main===module)run().catch(error=>{process.stderr.write('Window Use startup failed: '+error.message+'\n');process.exitCode=1;});
module.exports={run,runHost};
