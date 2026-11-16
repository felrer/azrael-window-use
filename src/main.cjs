'use strict';
if(process.argv.includes('--mcp-pipe')) {
  require('./adapter.cjs').run().catch(error=>{process.stderr.write('Window Use adapter failed: '+error.message+'\n');require('electron').app.exit(1);});
} else {
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, globalShortcut, nativeTheme, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { PermissionService, fail } = require('./permissions.cjs');
const { createAppIcons } = require('./app-icons.cjs');
const { createLogger } = require('./logger.cjs');
const { createRuntime } = require('./runtime.cjs');
const { createSharedService } = require('./shared-service.cjs');
const { createServiceClient } = require('./shared-client.cjs');
const registry = require('./service-registry.cjs');
const { createCandidate } = require('./service-candidate.cjs');
const { normalizeExecutable } = require('./platform-paths.cjs');
let agentOverlay;
const pipeIndex = process.argv.indexOf('--mcp-pipe');
const isMcp = process.argv.includes('--mcp') || pipeIndex >= 0;
const profileIndex = process.argv.indexOf('--user-data-dir');
if (profileIndex >= 0) {
  const explicit = process.argv[profileIndex + 1];
  if (!explicit || !path.isAbsolute(explicit)) throw Error('Absolute --user-data-dir required');
  app.setPath('userData', explicit);
} else app.setPath('userData', path.join(app.getPath('appData'), 'Azrael Window Use MCP'));
app.setName('Azrael Window Use');
let settingsWindow, approvalWindow, tray, permissions, service, log, closing = false;
const sessions=new Map();
const hasPending=()=>[permissions,...[...sessions.values()].map(s=>s.permissions)].some(p=>p?.pending.size);
const allApprovals=()=>[permissions,...[...sessions.values()].map(s=>s.permissions)].flatMap(p=>p?.approvals()||[]);
function respond(id,decision) {const p=[permissions,...[...sessions.values()].map(s=>s.permissions)].find(p=>p?.pending.has(id));if(!p)throw fail('approval_expired','Approval expired');return p.respond(id,decision);}
function denyPending() {for(const p of [permissions,...[...sessions.values()].map(s=>s.permissions)])for(const id of [...p.pending.keys()])p.finish(id,fail('approval_denied','Approval window closed'));}
const windows = new Map();
const html = path.join(__dirname, 'ui/index.html');
const trustedURL = pathToFileURL(html).href;
const icons = createAppIcons({ directory:path.join(app.getPath('userData'),'cache','app-icons'), getFileIcon: (...args) => app.getFileIcon(...args), changed: () => { if (!closing) broadcast(); } });
function snapshot(view) {
  const describe = (identity, priority=false) => identity.locked ? {...identity,icon:null,iconState:'ready'} : ({ ...identity, icon: icons.get(identity.executable,priority), iconState: icons.state(identity.executable) });
  const approvals = allApprovals().map(request => ({ ...request, app: describe(request.app,true) }));
  const settings = permissions.snapshot();
  settings.protectedApps = settings.protectedApps.map(identity=>describe(identity));
  settings.allowedApps = settings.allowedApps.map(identity=>describe(identity));
  return { version: app.getVersion(), settings, connection: { id: '', clientName: '', connected:sessions.size>0, stopped: permissions.stopped }, approvals, theme: permissions.state.theme, view };
}
function broadcast() {
  if (!permissions) return;
  // Start before BrowserWindow/renderer creation, including when no UI is open.
  for(const request of allApprovals())icons.get(request.app.executable,true);
  nativeTheme.themeSource = permissions.state.theme;
  for (const [id, { window, view }] of windows) if (!window.isDestroyed()) window.webContents.send('window-use:changed', snapshot(view));
  if (approvalWindow && !approvalWindow.isDestroyed() && !hasPending()) approvalWindow.hide();
  if (tray) tray.setToolTip(permissions.stopped ? 'Azrael Window Use · 중지됨' : sessions.size ? 'Azrael Window Use · 연결됨' : 'Azrael Window Use');
}
function createWindow(view) {
  const window = new BrowserWindow({
    width: 440, height: view === 'approval' ? 460 : 720, minWidth: 400, minHeight: view === 'approval' ? 380 : 520,
    frame: false, autoHideMenuBar: true, resizable: true, show: false, backgroundColor: nativeTheme.shouldUseDarkColors ? '#171717' : '#ffffff',
    title: 'Azrael Window Use', roundedCorners: true, icon: path.join(__dirname, 'assets/app-icon-256.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: !app.isPackaged }
  });
  const contentsId = window.webContents.id;
  windows.set(contentsId, { window, view });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.on('render-process-gone', () => { log('error','ui','renderer_exited'); permissions.stop(); });
  window.on('close', () => {
    if (closing) return;
    if(view==='approval')denyPending();
  });
  window.on('closed', () => {
    windows.delete(contentsId);
    if (view === 'approval' && approvalWindow === window) approvalWindow = undefined;
    if (view === 'settings' && settingsWindow === window) settingsWindow = undefined;
    log('info','ui',view + '_window_closed');
  });
  window.loadFile(html).catch(error => { log('error','ui','load_failed',{code:error.code}); permissions.stop(); });
  return window;
}
function show(view) {
  if (closing || view === 'approval' && !hasPending()) return;
  let window = view === 'approval' ? approvalWindow : settingsWindow;
  if (!window || window.isDestroyed()) {
    window = createWindow(view);
    if (view === 'approval') approvalWindow = window; else settingsWindow = window;
    log('info','ui',view + '_window_created');
  }
  const reveal = () => {
    if (window.isDestroyed() || closing || view === 'approval' && !hasPending()) return;
    if (window.isMinimized()) window.restore();
    window.show(); window.focus(); broadcast();
    log('info','ui',view + '_window_shown');
  };
  if (window.webContents.isLoadingMainFrame()) window.once('ready-to-show', reveal); else reveal();
}
function sender(event) {
  const entry = windows.get(event.sender.id);
  if (!entry || entry.window.isDestroyed() || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== trustedURL) throw Error('Untrusted UI sender');
  return entry;
}
function fields(payload, required) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== required.length || required.some(key => !Object.hasOwn(payload,key))) throw fail('invalid_arguments', '설정 요청이 잘못되었습니다.');
}
function setupIPC() {
  ipcMain.handle('window-use:snapshot', event => snapshot(sender(event).view));
  ipcMain.handle('window-use:command', async (event, request) => {
    const entry = sender(event);
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
        if (Object.keys(payload).length) { fields(payload,['executable']); selected = payload.executable; }
        else {
          fields(payload,[]);
          const result = await dialog.showOpenDialog(entry.window, { title:action === 'addAllowedApp' ? '허용할 앱 선택' : '보호할 앱 선택', properties:['openFile'], ...(process.platform==='win32'?{filters:[{name:'Windows 앱',extensions:['exe']}]}:{}) });
          if (!result.canceled && result.filePaths.length === 1) selected = result.filePaths[0];
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
      case 'minimize': fields(payload,[]); entry.window.minimize(); break;
      case 'close': fields(payload,[]); entry.window.close(); break;
      case 'openSettings': fields(payload,[]); show('settings'); break;
      default: throw fail('invalid_arguments','지원하지 않는 요청입니다.');
    }
    broadcast(); return snapshot(entry.view);
  });
}
function trayIcon() {
  const icon = nativeImage.createFromPath(path.join(__dirname, process.platform==='win32'?'assets/app-icon.ico':'assets/app-icon-64.png'));
  return process.platform==='win32' ? icon : icon.resize({width:process.platform==='darwin'?18:24,height:process.platform==='darwin'?18:24});
}
async function shutdown(fromService=false) {
  if (closing) return; closing = true;
  globalShortcut.unregisterAll();
  agentOverlay?.dispose();
  icons.dispose();
  await icons.flush();
  if(!fromService)await service?.close();
  permissions?.dispose();
  try { for(const session of [...sessions.values()])await session.dispose(); }
  catch(error){ log?.('error','runtime','shutdown_failed',{code:error.code}); }
  log?.('info','app','shutdown');
  for (const {window} of windows.values()) if (!window.isDestroyed()) window.destroy();
  tray?.destroy(); if(!fromService)app.quit();
}
app.on('window-all-closed', () => {});
app.on('before-quit', event => { if(!closing){event.preventDefault();void shutdown();} });
app.whenReady().then(async () => {
  if(!(['win32','darwin','linux'].includes(process.platform))||!['x64','arm64'].includes(process.arch)||process.platform==='win32'&&process.arch!=='x64')throw Error('Unsupported Window Use platform');
  const directory = app.getPath('userData');
  if(process.platform!=='win32')agentOverlay=require('./agent-overlay.cjs').createAgentOverlay({BrowserWindow,screen});
  log = createLogger(path.join(directory,'logs'),app.getVersion());
  log('info','app','startup');
  const runtimeIndex=process.argv.indexOf('--runtime-directory');
  if(runtimeIndex>=0&&(app.isPackaged||!path.isAbsolute(process.argv[runtimeIndex+1]||'')))throw Error('Absolute development-only --runtime-directory required');
  const runtimeDirectory = runtimeIndex>=0?process.argv[runtimeIndex+1]:app.isPackaged ? path.join(process.resourcesPath,'runtime/window-control') : path.resolve(__dirname,'../artifacts/runtime/window-control');
  const appRoot=path.resolve(__dirname,'..');
  const candidateArgs=[...(app.isPackaged?[]:[appRoot]),'--shared-service',...(!app.isPackaged?['--runtime-directory',runtimeDirectory]:[]),...(profileIndex>=0?['--user-data-dir',directory]:[])];
  const candidate=createCandidate({appRoot,runtimeDirectory,args:candidateArgs});
  const sharedDirectory=process.env.AZ_WINDOW_USE_SHARED_DIRECTORY||(profileIndex>=0?path.join(directory,'shared'):registry.defaultDirectory());
  if(!process.argv.includes('--shared-service')) {
    const client=createServiceClient({directory:sharedDirectory,candidate});
    try { await client.ensure();await client.call('settings-'+require('node:crypto').randomUUID(),'service.showSettings',{}); }
    finally { await client.dispose(); }
    await shutdown();return;
  }
  permissions = new PermissionService({directory,selfExecutables:[process.execPath]});
  log('info','permissions','initialized');
  permissions.on('change',broadcast);
  permissions.on('approval',()=>show('approval'));
  permissions.on('invalidate',reason=>log('info','permissions','invalidated',{code:reason}));
  service=await createSharedService({directory:sharedDirectory,candidate,
    createSession:({id,authorize,options={},emit})=>{
      const sessionPermissions=permissions.fork();
      let runtime;
      try { runtime=createRuntime({runtimeDirectory,directory,permissions:sessionPermissions,log,sessionId:id,
        authorize:options.authorizationRequired===true?authorize:undefined,
        workspacePath:options.workspacePath,workspaceName:options.workspaceName,codexHome:options.codexHome,
        emit,visualizer:agentOverlay}); } catch(error) {sessionPermissions.dispose();throw error;}
      sessionPermissions.on('change',broadcast);sessionPermissions.on('approval',()=>show('approval'));
      const entry={permissions:sessionPermissions,call:(method,args,signal,context)=>runtime.call(method,args,signal,context),async dispose(){sessions.delete(id);try{await runtime.dispose();}finally{sessionPermissions.dispose();broadcast();}}};
      sessions.set(id,entry);broadcast();return entry;
    },shutdown:()=>shutdown(true),onClosed:()=>app.quit(),showSettings:()=>show('settings'),log});
  setupIPC();
  tray = new Tray(trayIcon()); tray.setToolTip('Azrael Window Use');
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'Azrael Window Use 설정',click:()=>show('settings')},
    {label:'즉시 중지',click:()=>permissions.stop()},
    {type:'separator'}, {label:'종료',click:()=>void shutdown()}
  ]));
  tray.on('click',()=>show('settings'));
  log('info','ui','initialized');
  if(!globalShortcut.register('CommandOrControl+Alt+F12',()=>permissions.stop())) log('warn','app','stop_shortcut_unavailable');
  log('info','app','ready');
}).catch(async error => {
  log?.('error','app','startup_failed',{code:error.code||'startup_error'});
  process.stderr.write('Window Use startup failed: '+error.message+'\n');
  if(!isMcp&&!process.argv.includes('--shared-service'))dialog.showErrorBox('Window Use',error.message);
  await shutdown(); process.exitCode=1;
});
process.on('uncaughtException',error=>{log?.('error','app','uncaught_exception',{code:error.code});permissions?.stop();void shutdown();});
process.on('unhandledRejection',error=>{log?.('error','app','unhandled_rejection',{code:error?.code});permissions?.stop();void shutdown();});
process.on('SIGINT',()=>void shutdown());
process.on('SIGTERM',()=>void shutdown());

}
