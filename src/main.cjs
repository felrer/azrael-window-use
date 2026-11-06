'use strict';
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, globalShortcut, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { PermissionService, fail } = require('./permissions.cjs');
const { createLogger } = require('./logger.cjs');
const { createRuntime } = require('./runtime.cjs');
const { startMcp, SocketTransport } = require('./mcp.cjs');
const { normalizeExecutable } = require('../vendor/azrael/use-control-settings.cjs');
const pipeIndex = process.argv.indexOf('--mcp-pipe');
const isMcp = process.argv.includes('--mcp') || pipeIndex >= 0;
const profileIndex = process.argv.indexOf('--user-data-dir');
if (profileIndex >= 0) {
  const explicit = process.argv[profileIndex + 1];
  if (!explicit || !path.isAbsolute(explicit)) throw Error('Absolute --user-data-dir required');
  app.setPath('userData', explicit);
} else app.setPath('userData', path.join(app.getPath('appData'), 'Azrael Window Use MCP'));
app.setName('Window Use');
let settingsWindow, approvalWindow, tray, permissions, runtime, server, log, closing = false, connected = false, clientName = '';
const windows = new Map();
const html = path.join(__dirname, 'ui/index.html');
const trustedURL = pathToFileURL(html).href;
function snapshot(view) {
  return { version: app.getVersion(), settings: permissions.snapshot(), connection: { id: runtime?.thread || '', clientName, connected, stopped: permissions.stopped }, approvals: permissions.approvals(), theme: permissions.state.theme, view };
}
function broadcast() {
  if (!permissions) return;
  nativeTheme.themeSource = permissions.state.theme;
  for (const [id, { window, view }] of windows) if (!window.isDestroyed()) window.webContents.send('window-use:changed', snapshot(view));
  if (approvalWindow && !approvalWindow.isDestroyed() && !permissions.pending.size) approvalWindow.hide();
  if (tray) tray.setToolTip(permissions.stopped ? 'Window Use · 중지됨' : connected ? 'Window Use · 연결됨' : 'Window Use');
}
function createWindow(view) {
  const window = new BrowserWindow({
    width: 440, height: view === 'approval' ? 420 : 640, minWidth: 400, minHeight: view === 'approval' ? 380 : 520,
    frame: false, autoHideMenuBar: true, resizable: true, show: false, backgroundColor: nativeTheme.shouldUseDarkColors ? '#171717' : '#ffffff',
    title: 'Window Use', roundedCorners: true,
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
    if (view === 'approval') for (const id of [...permissions.pending.keys()]) permissions.finish(id, fail('approval_denied', '승인창을 닫아 요청이 취소되었습니다.'));
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
  if (closing || view === 'approval' && !permissions.pending.size) return;
  let window = view === 'approval' ? approvalWindow : settingsWindow;
  if (!window || window.isDestroyed()) {
    window = createWindow(view);
    if (view === 'approval') approvalWindow = window; else settingsWindow = window;
    log('info','ui',view + '_window_created');
  }
  const reveal = () => {
    if (window.isDestroyed() || closing || view === 'approval' && !permissions.pending.size) return;
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
    if (['setEnabled','setMode','setTheme','addProtectedApp','removeProtectedApp','removeAllowedApp','resume'].includes(action) && entry.view !== 'settings') throw fail('permission_denied','설정창에서만 변경할 수 있습니다.');
    switch (action) {
      case 'setEnabled': fields(payload,['enabled']); permissions.save({enabled:payload.enabled}); break;
      case 'setMode': fields(payload,['mode']); permissions.save({mode:payload.mode}); break;
      case 'setTheme': fields(payload,['theme']); permissions.save({theme:payload.theme}); break;
      case 'addProtectedApp': {
        fields(payload,[]);
        const result = await dialog.showOpenDialog(entry.window, { title:'보호할 앱 선택', properties:['openFile'], filters:[{name:'Windows 앱',extensions:['exe']}] });
        if (!result.canceled && result.filePaths.length === 1) {
          const executable = normalizeExecutable(result.filePaths[0]);
          if (!fs.statSync(executable).isFile()) throw fail('invalid_arguments','실행 파일이 아닙니다.');
          permissions.save({protectedApps:[...permissions.state.protectedApps,executable]});
        }
        break;
      }
      case 'removeProtectedApp':
        fields(payload,['executable']);
        if (permissions.selfApps.has(normalizeExecutable(payload.executable))) throw fail('security_app_blocked','Window Use 자체 UI는 보호 해제할 수 없습니다.');
        permissions.save({protectedApps:permissions.state.protectedApps.filter(exe=>exe!==normalizeExecutable(payload.executable))}); break;
      case 'removeAllowedApp': fields(payload,['executable']); permissions.save({allowedApps:permissions.state.allowedApps.filter(exe=>exe!==normalizeExecutable(payload.executable))}); break;
      case 'respondApproval': fields(payload,['id','decision']); if(entry.view!=='approval')throw fail('permission_denied','승인창에서 응답해주세요.'); permissions.respond(payload.id,payload.decision); break;
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
  // Local generated RGBA PNG; no asset downloads or remote content.
  const zlib = require('node:zlib');
  const crc = data => { let value = 0xffffffff; for(const byte of data){value ^= byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0; };
  const chunk = (name,data) => {const type=Buffer.from(name),length=Buffer.alloc(4),sum=Buffer.alloc(4);length.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([length,type,data,sum]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(32,0);header.writeUInt32BE(32,4);header[8]=8;header[9]=6;
  const pixels=Buffer.alloc(32*(1+32*4));
  for(let y=0;y<32;y++)for(let x=0;x<32;x++){const offset=y*129+1+x*4;const inside=Math.abs(x-15.5)+Math.abs(y-15.5)<13&&Math.abs(x-15.5)+Math.abs(y-15.5)>6;pixels[offset]=pixels[offset+1]=pixels[offset+2]=nativeTheme.shouldUseDarkColors?240:45;pixels[offset+3]=inside?255:0;}
  return nativeImage.createFromBuffer(Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]));
}
async function shutdown() {
  if (closing) return; closing = true;
  globalShortcut.unregisterAll();
  permissions?.dispose();
  try { await runtime?.dispose(); await server?.close(); }
  catch(error){ log?.('error','runtime','shutdown_failed',{code:error.code}); }
  log?.('info','app','shutdown');
  for (const {window} of windows.values()) if (!window.isDestroyed()) window.destroy();
  tray?.destroy(); app.quit();
}
app.on('window-all-closed', () => {});
app.on('before-quit', event => { if(!closing){event.preventDefault();void shutdown();} });
app.whenReady().then(async () => {
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('Windows x64 is required');
  const directory = app.getPath('userData');
  log = createLogger(path.join(directory,'logs'),app.getVersion());
  log('info','app','startup');
  permissions = new PermissionService({directory,selfExecutables:[process.execPath]});
  log('info','permissions','initialized');
  permissions.on('change',broadcast);
  permissions.on('approval',()=>show('approval'));
  permissions.on('invalidate',reason=>log('info','permissions','invalidated',{code:reason}));
  setupIPC();
  tray = new Tray(trayIcon()); tray.setToolTip('Window Use');
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'Window Use 설정',click:()=>show('settings')},
    {label:'즉시 중지',click:()=>permissions.stop()},
    {type:'separator'}, {label:'종료',click:()=>void shutdown()}
  ]));
  tray.on('click',()=>show('settings'));
  log('info','ui','initialized');
  if(!globalShortcut.register('CommandOrControl+Alt+F12',()=>permissions.stop())) log('warn','app','stop_shortcut_unavailable');
  const runtimeDirectory = app.isPackaged ? path.join(process.resourcesPath,'runtime/window-control') : path.resolve(__dirname,'../artifacts/runtime/window-control');
  runtime = createRuntime({runtimeDirectory,directory,permissions,log});
  log('info','runtime','initialized');
  if (isMcp) {
    const pipeName=process.argv[pipeIndex+1], token=process.env.WINDOW_USE_PIPE_TOKEN;
    delete process.env.WINDOW_USE_PIPE_TOKEN;
    if(pipeIndex<0||!/^[A-Za-z0-9_-]{1,128}$/.test(pipeName||'')||!/^[a-f0-9]{64}$/.test(token||''))throw Error('Start MCP using the WindowUseMCP launcher');
    const socket=require('node:net').createConnection('\\\\.\\pipe\\'+pipeName);
    await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
    await new Promise((resolve,reject)=>socket.write(token+'\n',error=>error?reject(error):resolve()));
    server = await startMcp({runtime,log,transport:new SocketTransport(socket),onClient:name=>{clientName=String(name).slice(0,128);connected=true;broadcast();},onClose:()=>{connected=false;void shutdown();}});
  }
  else show('settings');
  log('info','app','ready');
}).catch(async error => {
  log?.('error','app','startup_failed',{code:error.code||'startup_error'});
  process.stderr.write('Window Use startup failed: '+error.message+'\n');
  if(!isMcp)dialog.showErrorBox('Window Use',error.message);
  await shutdown(); process.exitCode=1;
});
process.on('uncaughtException',error=>{log?.('error','app','uncaught_exception',{code:error.code});permissions?.stop();void shutdown();});
process.on('unhandledRejection',error=>{log?.('error','app','unhandled_rejection',{code:error?.code});permissions?.stop();void shutdown();});
process.on('SIGINT',()=>void shutdown());
process.on('SIGTERM',()=>void shutdown());
