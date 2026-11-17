'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { AsyncLocalStorage } = require('node:async_hooks');
const { createWindowOwner } = require('../vendor/azrael/window-control-policy.cjs');
const { createBackend } = require('../vendor/azrael/window-control-backend.cjs');
const { verifyRuntime } = require('../vendor/azrael/window-control-runtime.cjs');
const { createSwitchedInputProvider } = require('../vendor/azrael/window-switched-input.cjs');
const { fail } = require('./permissions.cjs');
const { CURVE_GUIDE, BATCH_GUIDE } = require('../vendor/azrael/window-input-guidance.cjs');
const { normalizeExecutable } = require('./platform-paths.cjs');
const same = (a, b) => !!a && !!b && ['hwnd','pid','processCreated','executable'].every(key => a[key] === b[key]);
function createRuntime({ runtimeDirectory, directory, permissions, log, backend: injectedBackend, switchedInput: injectedInput, authorize: externalAuthorize, workspacePath, workspaceName, codexHome, sessionId, emit, visualizer }) {
  const declaration = injectedBackend || process.platform!=='win32' ? null : verifyRuntime(runtimeDirectory);
  const backend = injectedBackend || (process.platform==='win32' ? createBackend({ windowControl: declaration }) : require('./platform-backend.cjs').createPlatformBackend(runtimeDirectory));
  let multiPointer;
  if (declaration) {
    const multiDirectory = path.join(path.dirname(runtimeDirectory), 'multi-pointer');
    require('../vendor/azrael/multi-pointer-mcp.cjs').verifyRuntime(multiDirectory);
    multiPointer = { directory: multiDirectory, manifestSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(multiDirectory, 'manifest.json'))).digest('hex'), modulePath: path.resolve(__dirname, '../vendor/azrael/multi-pointer-mcp.cjs') };
  }
  const input = injectedInput || (multiPointer && createSwitchedInputProvider(multiPointer, {
    stateDirectory: path.join(directory, 'input'), onDiagnostic: diagnostic => log('warn','input','broker_failed',{diagnostic}),
  }));
  const thread = sessionId || crypto.randomUUID(), scope = new AsyncLocalStorage();
  let disposed = false, externalDesktopGranted=false;
  const desktopGranted=()=>externalAuthorize ? externalDesktopGranted&&permissions.state.enabled&&!permissions.stopped&&permissions.state.mode!=='observe' : permissions.allowed(null,'desktop');
  function active() { permissions.assertActive(); if (disposed || scope.getStore()?.signal?.aborted) throw fail('cancelled', '요청이 취소되었습니다.'); }
  function localPolicy(value) {
    if(value===undefined)return {blockedApps:[],observationAllowedApps:[]};
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['blockedApps','observationAllowedApps'].includes(key)))throw fail('invalid_arguments','Invalid authorization policy');
    const list=key=>{const entries=value[key]||[];if(!Array.isArray(entries)||entries.length>128||entries.some(exe=>typeof exe!=='string'||exe.length>4096))throw fail('invalid_arguments','Invalid authorization policy');return [...new Set(entries.map(normalizeExecutable))];};
    return {blockedApps:list('blockedApps'),observationAllowedApps:list('observationAllowedApps')};
  }
  const policy=()=>scope.getStore()?.policy||{blockedApps:[],observationAllowedApps:[]};
  const locallyBlocked=window=>!!window?.executable&&policy().blockedApps.includes(normalizeExecutable(window.executable));
  const observationAllowed=window=>!permissions.blocked(window)&&(!locallyBlocked(window)||policy().observationAllowedApps.includes(normalizeExecutable(window.executable)));
  function protectedTarget(window,permission='control') { if (permissions.blocked(window)||locallyBlocked(window)&&(permission!=='observation'||!observationAllowed(window))) throw fail('security_app_blocked', '보호 앱은 관찰하거나 제어할 수 없습니다.'); }
  async function authorizeTarget(window, permission, requestApproval) {
    active(); if(window&&permissions.blocked(window))protectedTarget(window);
    if(window&&permission!=='observation')protectedTarget(window,permission);
    if(externalAuthorize) {
      if(permission!=='observation' && permissions.state.mode==='observe') return false;
      const allowed=await externalAuthorize(window,permission,scope.getStore()?.signal);
      active();
      const authorized=allowed===true || allowed?.authorized===true;
      if(permission==='desktop')externalDesktopGranted=authorized;
      if(authorized&&window&&permission==='observation'&&locallyBlocked(window))policy().observationAllowedApps.push(normalizeExecutable(window.executable));
      if(window&&authorized)protectedTarget(window,permission);
      return authorized;
    }
    if(requestApproval)await permissions.request(window,permission,scope.getStore()?.signal);
    active();return permissions.allowed(window,permission);
  }
  const point = input => input?.action === 'drag' ? input.points ? {x:input.points[0][0],y:input.points[0][1]} :
    { x: input.fromX, y: input.fromY } : { x: input?.x, y: input?.y };
  async function resolveDesktopWindow(_thread, packet) {
    active(); const p = point(packet);
    if (!Number.isSafeInteger(p.x) || !Number.isSafeInteger(p.y)) throw fail('invalid_arguments', '명시적인 화면 좌표가 필요합니다.');
    const result = await backend.request('windowAtPoint', p); active();
    if (!result?.window?.executable) throw fail('state_changed', '입력할 창을 찾을 수 없습니다.');
    protectedTarget(result.window); return result.window;
  }
  const owner = createWindowOwner({
    backend, codexHome: codexHome || directory, workspacePath: workspacePath || path.join(directory, 'workspace'), workspaceName: workspaceName || 'Window Use MCP',
    occupancyDirectory: path.join(directory, 'occupancy'), switchedInput: input,
    isCancelled: () => disposed || !!scope.getStore()?.signal?.aborted,
    observationAllowed,
    approve: async (window, _thread, operation = {}) => { if(!await authorizeTarget(window,operation.permission||'control',true))throw fail('permission_denied','앱 제어가 허용되지 않았습니다.'); },
    authorize: async (window, _thread, operation = {}) => {
      return authorizeTarget(window,operation.permission||'control',operation.requestApproval);
    },
    requestPermission: async (_thread,args,identity) => ({authorized:await authorizeTarget(identity,args.permission,true)}),
    context: async () => ({
      enabled: permissions.state.enabled, available: true,
      permissions: { observation: 'allowed-except-protected', control: permissions.state.mode, desktopControlGranted: desktopGranted() },
      capabilities: { windowObservation: true, desktopCapture: true, windowUIAControl: true, desktopControl: !!input?.desktopInput, ...(backend.capabilities||{}), ...(backend.getCapabilities?await backend.getCapabilities():{}), ...(visualizer?.available&&!visualizer.available()?{actionVisualization:false}:{}) },
      inputBackends: { switchedInput: !!input, desktopControlGranted: desktopGranted() },
      guideVersion: 'shared-window-use-1',
      guide: 'Prefer inspect for text, values and control states, and supported element actions such as invoke or set_value for controls. Use capture and pointer input for visual judgment, drawing, dragging or targets not exposed by UIA. capture defaults to image-only; includeUIA:true also returns a bounded UIA summary under the same observationId for either input path. For known multi-step element workflows, run_task_macro resolves explicit selectors afresh inside the server; it reduces model round trips, not UIA queries. switched_input points use returned capture-image pixels with top-left (0,0); desktop_input points use absolute physical screen pixels. One point clicks, two drag straight, and 3..32 follow centripetal Catmull-Rom. Re-capture after window movement, resize or DPI change. Use list_windows for opaque windowId values; capture or inspect before acting with fresh observationId/elementId. App approvals are routed to the originating client approval UI, or the local Window Use approval window for standalone MCP clients. Permissions apply only to the isolated service session and its originating connection. Protected apps, including Window Use settings/approval UI, cannot be observed or controlled. capture_desktop masks protected apps. desktop_input requires explicit screen coordinates and separate permission; a gesture remains inside its verified app target. After permission changes, reacquire observations. Delivery does not prove the app effect: capture or inspect and assert it. Never replay unknown input. User Stop requires explicit resume from trusted user UI; global Stop requires the shared Window Use settings UI. Release input when done. Control automatically acquires window occupancy on first control and retains it until 30 seconds after the last owner window request completes. Read-only requests do not acquire occupancy. The runtime waits on conflicts or returns a typed failure; respect window_busy.' + ' ' + CURVE_GUIDE + ' ' + BATCH_GUIDE,
      ...(process.platform!=='win32'?{guide:'Use context capabilities and OS permission/session readiness before choosing tools. This backend uses macOS AX or Linux AT-SPI for inspect and supported semantic element actions. Use list_windows for opaque windowId values, then inspect for fresh observationId and elementId. run_task_macro resolves explicit selectors again at each step. capture is image-only by default; includeUIA:true also obtains a bounded accessibility summary when window capture is supported. Unix coordinate input, desktop capture/control and independent input pointers are not implemented. Cosmetic Agent cursors do not inject input. Unsupported operations fail explicitly; do not substitute unapproved foreground input. Protected apps and password content stay excluded. App approvals are connection-scoped and routed to the originating client UI. Respect window occupancy, reacquire observations after changes, verify action postconditions, never replay an unknown mutation, and resume after user Stop only from trusted UI.'}:{}),
    }),
    desktopCapture: async () => {
      if(backend.capabilities?.desktopCapture===false)throw fail('unsupported_action','Protected desktop capture is unavailable on this platform; use selected-window capture or inspect.');
      active(); const generation = permissions.generation;
      if(!await authorizeTarget(null,'observation',false))throw fail('permission_denied','화면 관찰이 허용되지 않았습니다.');
      const result = await backend.request('captureDesktop', { blockedApps: [...new Set([...permissions.protectedExecutables(),...policy().blockedApps])].sort() });
      active();
      if (generation !== permissions.generation) throw fail('policy_changed', '캡처 중 권한 설정이 변경되었습니다.');
      if (result?.redacted !== true || !Number.isSafeInteger(result.originX) || !Number.isSafeInteger(result.originY) || !Number.isSafeInteger(result.maskedWindowCount) || result.maskedWindowCount < 0 || !Number.isSafeInteger(result.widthPx) || result.widthPx < 1 || result.widthPx > 16384 || !Number.isSafeInteger(result.heightPx) || result.heightPx < 1 || result.heightPx > 16384 || result.image?.mimeType !== 'image/png' || typeof result.image.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(result.image.data)) throw fail('connection_error', '검증된 마스킹 화면을 얻지 못했습니다.');
      return result;
    },
    resolveDesktopWindow,
    desktopInput: async (_thread, packet, observation, guard, expected) => {
      active();
      if (!input?.desktopInput) throw fail('unsupported_action', '데스크톱 입력 엔진이 준비되지 않았습니다.');
      const generation = permissions.generation;
      const authorize = async () => {
        active(); await guard();
        if (generation !== permissions.generation || !await authorizeTarget(null, 'desktop', false)) throw fail('permission_denied', '데스크톱 제어 권한이 변경되었습니다.');
        const current = await resolveDesktopWindow(thread, packet);
        if (!same(current, expected)) throw fail('state_changed', '입력 대상 창이 변경되었습니다.');
        protectedTarget(current);
      };
      await authorize(); return input.desktopInput(thread, expected, packet, authorize);
    },
    releaseDesktopInput: () => input?.release(thread),
    visualizeAction: input?.visualize || visualizer&&backend.capabilities?.actionVisualization ? async (_thread, window, args, tool, guard) => {
      active(); protectedTarget(window); await guard();
      const position = await backend.request('actionPoint', { window, observationId: args.observationId, ...(args.elementId ? { elementId: args.elementId } : {}) });
      await guard(); active();
      if(input?.visualize){await input.visualize(thread, window, { ...position, phase: 'active', click: tool === 'invoke' }, guard);return () => input.visualize(thread, window, { ...position, phase: 'idle' }, guard);}
      visualizer.visualize(thread,position,'active');
      return ()=>{}; // The cosmetic cursor holds active for one second before fading.
    } : undefined,
    onUserStop: (_thread,value) => { permissions.stop();emit?.({type:'userStop',value}); },
    onOverlayError: error => log?.('warn', 'native', 'overlay_failed', { code: error.code })
  });
  const invalidate = reason => { externalDesktopGranted=false;visualizer?.release(thread);owner.invalidateObservation(thread); if (reason === 'user_stopped') owner.stop(thread); if (reason === 'user_resumed') owner.clear(thread); };
  permissions.on('invalidate', invalidate);
  const notificationSubscription=backend.onApprovalNotificationActivated?.(event=>emit?.({type:'approvalNotificationActivated',requestId:event.requestId}));
  return {
    thread, owner, backend,
    call: (tool, args, signal, context={}) => scope.run({ signal,policy:localPolicy(context.authorizationPolicy) }, async () => {
      if (!['context','release_desktop_input','release_switched_input','owner.clear','owner.stop','owner.invalidateObservation','owner.hideApprovalNotification','owner.settingsListWindows'].includes(tool)) active();
      if(tool.startsWith('owner.')) {
        switch(tool) {
          case 'owner.listWindows':return owner.listWindows(thread);
          case 'owner.settingsListWindows':
            if(!externalAuthorize||Object.keys(args).length)throw fail('permission_denied','설정 연결에서만 사용할 수 있습니다.');
            return backend.request('listWindows',{});
          case 'owner.bind':return owner.bind(thread,args.descriptor);
          case 'owner.resume':return owner.resume(thread);
          case 'owner.requestPermission':return owner.requestPermission(thread,args.args);
          case 'owner.inspectForTask':return owner.inspectForTask(thread);
          case 'owner.getMacros':return owner.getMacros();
          case 'owner.deleteMacro':return owner.deleteMacro(args.id);
          case 'owner.saveMacro':return owner.saveMacro(args.macro);
          case 'owner.clear':return owner.clear(thread);
          case 'owner.stop':return owner.stop(thread);
          case 'owner.invalidateObservation':return owner.invalidateObservation(thread);
          case 'owner.showApprovalNotification':return backend.showApprovalNotification(args);
          case 'owner.hideApprovalNotification':return backend.hideApprovalNotification(args);
          default:throw fail('unsupported_action','지원하지 않는 내부 작업입니다.');
        }
      }
      return owner.call(thread, tool, args);
    }),
    async dispose() {
      if (disposed) return; disposed = true;
      visualizer?.release(thread);
      permissions.off('invalidate', invalidate);
      notificationSubscription?.dispose?.();
      let failure;
      for(const cleanup of [()=>owner.dispose(),()=>input?.dispose(),()=>backend.dispose()]) {
        try {await cleanup();}catch(error){failure ||= error;}
      }
      if(failure)throw failure;
    }
  };
}
module.exports = { createRuntime };
