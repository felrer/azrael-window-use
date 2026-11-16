'use strict';
(() => {
  const api = window.__TAURI__;
  if (!api?.core?.invoke || !api?.event?.listen || !api?.webviewWindow?.getCurrentWebviewWindow) return;
  const subscribers = new Set();
  let disposed = false;
  let failed = false;
  const invoke = (command, args) => api.core.invoke(command, args);
  const health = () => invoke('ui_health', { failed }).catch(() => {});
  const failClosed = () => { failed = true; void health(); };
  const target = { kind: 'WebviewWindow', label: api.webviewWindow.getCurrentWebviewWindow().label };
  const listening = api.event.listen('window-use:changed', event => {
    if (!disposed) for (const subscriber of [...subscribers]) subscriber(event.payload);
  }, { target });
  listening.catch(failClosed);
  Object.defineProperty(window, 'windowUse', { value: Object.freeze({
    snapshot: async () => { await listening; return invoke('snapshot'); },
    command: async (action, payload = {}) => { await listening; return invoke('command', { action, payload }); },
    subscribe: callback => {
      if (typeof callback !== 'function') throw new TypeError('Snapshot listener must be a function');
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    }
  }), configurable: false, writable: false });
  // The existing titlebar CSS uses Electron's app-region. Native dragging is
  // narrowly exposed here; the renderer has no generic window/process API.
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.target.closest('.titlebar') || event.target.closest('button, input, select, a, [role="button"]')) return;
    event.preventDefault();
    void invoke('start_dragging').catch(failClosed);
  });
  window.addEventListener('error', event => { if (event.target === window) failClosed(); });
  window.addEventListener('unhandledrejection', failClosed);
  const heartbeat = setInterval(() => { if (!disposed) void health(); }, 5000);
  void health();
  window.addEventListener('pagehide', () => {
    disposed = true;
    clearInterval(heartbeat);
    subscribers.clear();
    void listening.then(unlisten => unlisten()).catch(() => {});
  }, { once: true });
})();
