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
const same = (a, b) => !!a && !!b && ['hwnd','pid','processCreated','executable'].every(key => a[key] === b[key]);
function createRuntime({ runtimeDirectory, directory, permissions, log, backend: injectedBackend, switchedInput: injectedInput }) {
  const declaration = injectedBackend ? null : verifyRuntime(runtimeDirectory);
  const backend = injectedBackend || createBackend({ windowControl: declaration });
  let multiPointer;
  if (declaration) {
    const multiDirectory = path.join(path.dirname(runtimeDirectory), 'multi-pointer');
    require('../vendor/azrael/multi-pointer-mcp.cjs').verifyRuntime(multiDirectory);
    multiPointer = { directory: multiDirectory, manifestSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(multiDirectory, 'manifest.json'))).digest('hex'), modulePath: path.resolve(__dirname, '../vendor/azrael/multi-pointer-mcp.cjs') };
  }
  const input = injectedInput || (multiPointer && createSwitchedInputProvider(multiPointer, { stateDirectory: path.join(directory, 'input') }));
  const thread = crypto.randomUUID(), scope = new AsyncLocalStorage();
  let disposed = false;
  function active() { permissions.assertActive(); if (disposed || scope.getStore()?.signal?.aborted) throw fail('cancelled', '요청이 취소되었습니다.'); }
  function protectedTarget(window) { if (permissions.blocked(window)) throw fail('security_app_blocked', '보호 앱은 관찰하거나 제어할 수 없습니다.'); }
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
    backend, codexHome: directory, workspacePath: path.join(directory, 'workspace'), workspaceName: 'Window Use MCP',
    occupancyDirectory: path.join(directory, 'occupancy'), switchedInput: input,
    isCancelled: () => disposed || !!scope.getStore()?.signal?.aborted,
    observationAllowed: window => !permissions.blocked(window),
    approve: async (window, _thread, operation = {}) => { active(); await permissions.request(window, operation.permission || 'control', scope.getStore()?.signal); active(); protectedTarget(window); },
    authorize: async (window, _thread, operation = {}) => {
      active();
      if (window) protectedTarget(window);
      const permission = operation.permission || 'control';
      if (operation.requestApproval) await permissions.request(window, permission, scope.getStore()?.signal);
      active(); return permissions.allowed(window, permission);
    },
    context: async () => ({
      enabled: permissions.state.enabled, available: true,
      permissions: { observation: 'allowed-except-protected', control: permissions.state.mode, desktopControlGranted: permissions.allowed(null, 'desktop') },
      capabilities: { windowObservation: true, desktopCapture: true, windowUIAControl: true, desktopControl: !!input?.desktopInput },
      inputBackends: { switchedInput: !!input, desktopControlGranted: permissions.allowed(null, 'desktop') },
      guideVersion: 'standalone-window-use-3',
      guide: 'Use Window Use only as a last resort when efficient file, API, connector, CLI or browser-specific methods cannot complete the task. switched_input points use returned capture-image pixels with top-left (0,0); desktop_input points use absolute physical screen pixels. One point clicks, two drag straight, and 3..32 follow centripetal Catmull-Rom. Re-capture after window movement, resize or DPI change. Use list_windows for opaque windowId values; capture or inspect before acting with fresh observationId/elementId. App approvals open a local user approval window automatically. Permissions apply to this MCP connection, never to a client-supplied conversation ID. Protected apps, including Window Use settings/approval UI, cannot be observed or controlled. capture_desktop masks protected apps. desktop_input requires explicit screen coordinates and separate permission; a gesture remains inside its verified app target. After permission changes, reacquire observations. Delivery does not prove the app effect: capture or inspect and assert it. Never replay unknown input. User Stop requires manual resume from the local UI. Release input when done. Window occupancy is acquired automatically; respect window_busy.' + ' ' + CURVE_GUIDE + ' ' + BATCH_GUIDE
    }),
    desktopCapture: async () => {
      active(); const generation = permissions.generation;
      const result = await backend.request('captureDesktop', { blockedApps: permissions.protectedExecutables() });
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
        if (generation !== permissions.generation || !permissions.allowed(null, 'desktop')) throw fail('permission_denied', '데스크톱 제어 권한이 변경되었습니다.');
        const current = await resolveDesktopWindow(thread, packet);
        if (!same(current, expected)) throw fail('state_changed', '입력 대상 창이 변경되었습니다.');
        protectedTarget(current);
      };
      await authorize(); return input.desktopInput(thread, expected, packet, authorize);
    },
    releaseDesktopInput: () => input?.release(thread),
    visualizeAction: input?.visualize ? async (_thread, window, args, tool, guard) => {
      active(); protectedTarget(window); await guard();
      const position = await backend.request('actionPoint', { window, observationId: args.observationId, ...(args.elementId ? { elementId: args.elementId } : {}) });
      await guard(); active();
      await input.visualize(thread, window, { ...position, phase: 'active', click: tool === 'invoke' }, guard);
      return () => input.visualize(thread, window, { ...position, phase: 'idle' }, guard);
    } : undefined,
    onUserStop: () => permissions.stop(),
    onOverlayError: error => log?.('warn', 'native', 'overlay_failed', { code: error.code })
  });
  const invalidate = reason => { owner.invalidateObservation(thread); if (reason === 'user_stopped') owner.stop(thread); if (reason === 'user_resumed') owner.clear(thread); };
  permissions.on('invalidate', invalidate);
  return {
    thread, owner, backend,
    call: (tool, args, signal) => scope.run({ signal }, async () => {
      if (!['context','release_desktop_input','release_switched_input'].includes(tool)) active();
      return owner.call(thread, tool, args);
    }),
    async dispose() {
      if (disposed) return; disposed = true;
      permissions.off('invalidate', invalidate);
      await owner.dispose(); await input?.dispose(); await backend.dispose();
    }
  };
}
module.exports = { createRuntime };
