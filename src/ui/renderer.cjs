'use strict';
// Settings-row/card structure and approval language adapted from Azrael's
// scripts/inject-window-control.cjs and scripts/window-control-host.cjs.
(() => {
  const bridge = window.windowUse;
  const main = document.getElementById('main');
  const status = document.getElementById('save-status');
  let state, pending = false, error = '', disposed = false, expiryTimer, unsubscribe;
  let revision = 0;
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const button = (label, handler, className = '') => {
    const element = node('button', className, label);
    element.type = 'button'; element.disabled = pending;
    element.addEventListener('click', handler);
    return element;
  };
  function accept(snapshot) {
    if (disposed || !snapshot?.settings) return;
    state = snapshot; revision++;
    render();
  }
  async function command(action, payload = {}) {
    if (pending || disposed) return;
    pending = true; error = ''; render();
    try {
      const result = await bridge.command(action, payload);
      if (disposed) return;
      if (result?.settings) accept(result);
      else accept(await bridge.snapshot());
    } catch (cause) { error = cause?.message || String(cause); }
    finally { pending = false; if (!disposed) render(); }
  }
  async function load() {
    error = ''; render();
    const startRevision = revision;
    try { const snapshot = await bridge.snapshot(); if (revision === startRevision) accept(snapshot); }
    catch (cause) { error = cause?.message || String(cause); render(); }
  }
  function row(label, description, control) {
    const element = node('div', 'row');
    const text = node('div', 'row-text');
    text.append(node('div', 'label', label));
    if (description) text.append(node('div', 'description', description));
    element.append(text); if (control) element.append(control);
    return element;
  }
  function select(options, selected, handler, label) {
    const element = node('select');
    element.setAttribute('aria-label', label); element.disabled = pending;
    for (const [value, text] of options) {
      const option = node('option', '', text); option.value = value; element.append(option);
    }
    element.value = selected;
    element.addEventListener('change', () => { const chosen = element.value; element.value = selected; handler(chosen); });
    return element;
  }
  function apps(title, description, items, protectedList) {
    const head = node('div', 'section-head'); head.append(node('h2', '', title));
    if (protectedList) head.append(button('+ 앱 추가', () => command('addProtectedApp'), 'text-button'));
    const card = node('section', 'card'); card.setAttribute('aria-label', title);
    if (description) card.append(row('', description));
    for (const app of items) {
      const name = app.label || app.executable;
      const item = row(name, '', null); item.classList.add('app-row');
      item.firstChild.append(node('div', 'path', app.executable));
      if (protectedList && app.locked) item.append(node('span', 'locked', '항상 보호'));
      else {
        const remove = button('×', () => command(protectedList ? 'removeProtectedApp' : 'removeAllowedApp', { executable: app.executable }), 'remove');
        remove.setAttribute('aria-label', `${name} 제거`); remove.title = '제거'; item.append(remove);
      }
      card.append(item);
    }
    if (!items.length) card.append(node('p', 'empty', '등록된 앱이 없습니다.'));
    main.append(head, card);
  }
  function settings() {
    const settings = state.settings;
    main.append(node('h1', '', 'Window Use'), node('p', 'subtitle', '앱 관찰과 제어 권한을 관리합니다.'));
    const card = node('section', 'card');
    const toggle = button('', () => command('setEnabled', { enabled: !settings.enabled }), 'switch');
    toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-checked', String(settings.enabled)); toggle.setAttribute('aria-label', 'Window Use 사용');
    card.append(row('Window Use 사용', '연결된 모델의 창 관찰과 제어를 허용합니다.', toggle));
    card.append(row('권한 모드', ({ observe: '창을 관찰하고 읽기만 허용합니다.', ask: '앱을 제어하기 전에 승인을 요청합니다.', full: '앱별 추가 승인 없이 제어를 허용합니다.' })[settings.mode], select([['observe', '관찰만'], ['ask', '승인 요청'], ['full', '전체 허용']], settings.mode, mode => command('setMode', { mode }), '권한 모드')));
    main.append(card);
    apps('보호된 앱', '관찰과 제어가 항상 차단됩니다.', settings.protectedApps || [], true);
    apps('항상 허용한 앱', '', settings.allowedApps || [], false);
    const appearance = node('section', 'card'); appearance.append(row('테마', '', select([['system', '시스템'], ['light', '라이트'], ['dark', '다크']], state.theme, theme => command('setTheme', { theme }), '테마')));
    main.append(node('h2', '', '화면'), appearance);
    const connection = state.connection || {};
    const connectionCard = node('div', 'status-card');
    const text = node('div', 'row-text'); const title = node('div', 'status-title');
    title.append(node('span', `dot${connection.connected && !connection.stopped ? ' connected' : ''}`), node('span', '', connection.stopped ? '제어가 중지되었습니다' : connection.connected ? '연결됨' : '연결 대기 중'));
    text.append(title, node('div', 'connection', connection.clientName || 'MCP 클라이언트를 연결해 시작하세요.'));
    const stop = button(connection.stopped ? '다시 시작' : '중지', () => command(connection.stopped ? 'resume' : 'stop'), 'small');
    stop.disabled = pending || (!connection.connected && !connection.stopped);
    connectionCard.append(text, stop); main.append(connectionCard);
  }
  function approval() {
    const approvals = state.approvals || [];
    const request = approvals.find(item => item.expiresAt > Date.now());
    if (!request) {
      const empty = node('div', 'approval-empty');
      empty.append(node('div', 'brand-mark', '✓'), node('h1', '', '대기 중인 요청이 없습니다'), node('p', '', '요청이 처리되었거나 만료되었습니다.'), button('설정 열기', () => command('openSettings')));
      main.append(empty); return;
    }
    const desktop = request.permission === 'desktop';
    const observation = request.permission === 'observation';
    const heading = node('div', 'approval-heading');
    const text = node('div'); text.append(node('h1', '', desktop ? '데스크톱 접근 허용' : observation ? '앱 관찰 허용' : '앱 제어 허용'), node('p', 'eyebrow', state.connection?.clientName || '연결된 MCP 클라이언트'));
    heading.append(node('div', 'approval-icon', desktop ? '▦' : '◈'), text); main.append(heading);
    main.append(node('p', 'approval-copy', desktop ? '전체 데스크톱을 관찰하고 제어하도록 허용할까요? 여러 앱과 화면에 표시된 내용에 접근할 수 있습니다.' : observation ? '이 앱의 창을 캡처하고 화면 내용을 읽도록 허용할까요?' : '이 앱의 창을 캡처하고 마우스와 키보드로 제어하도록 허용할까요?'));
    const app = node('div', 'approval-app');
    app.append(node('div', 'label', desktop ? '전체 데스크톱' : request.app?.name || '앱'), node('div', 'path', request.app?.executable || (desktop ? '모든 화면 · 여러 앱에 접근' : '실행 파일 정보 없음'))); main.append(app);
    main.append(node('p', 'approval-note', `보호된 앱은 항상 차단됩니다. 이 연결이 종료되면 연결별 허용도 종료됩니다. 요청 만료: ${new Date(request.expiresAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`));
    const actions = node('div', 'approval-actions');
    const respond = decision => command('respondApproval', { id: request.id, decision });
    actions.append(button('거부', () => respond('deny')), button('이 연결에서 허용', () => respond('session'), 'primary')); main.append(actions);
    if (!desktop && !observation) main.append(button('이 앱을 항상 허용', () => respond('always'), 'always-button'));
    main.append(node('p', 'approval-state', approvals.length > 1 ? `승인 대기 ${approvals.length}건 · 아직 요청을 실행하지 않았습니다.` : '아직 요청을 실행하지 않았습니다.'));
    expiryTimer = setTimeout(render, Math.min(Math.max(1, request.expiresAt - Date.now() + 10), 2147483647));
  }
  function render() {
    if (disposed) return;
    clearTimeout(expiryTimer);
    const focused = document.activeElement;
    const focusLabel = main.contains(focused) ? focused.getAttribute('aria-label') || focused.textContent : null;
    main.replaceChildren(); main.setAttribute('aria-busy', String(pending || !state));
    document.documentElement.dataset.theme = state?.theme || 'system';
    status.textContent = pending ? '저장 중…' : '';
    document.getElementById('version').textContent = state?.version ? `v${state.version} · 로컬 권한 관리` : '로컬 권한 관리';
    if (error || state?.error) {
      const alert = node('div', 'error', error || state.error); alert.setAttribute('role', 'alert');
      alert.append(node('br'), button('다시 불러오기', load, 'small')); main.append(alert);
    }
    if (!state) main.append(node('p', 'loading', error ? '설정을 불러오지 못했습니다.' : '설정을 불러오는 중…'));
    else if (state.view === 'approval') approval();
    else settings();
    if (focusLabel) Array.from(main.querySelectorAll('button,select')).find(element => (element.getAttribute('aria-label') || element.textContent) === focusLabel)?.focus({ preventScroll: true });
  }
  for (const action of ['minimize', 'close']) document.getElementById(action).addEventListener('click', () => {
    Promise.resolve(bridge?.command(action)).catch(cause => { error = cause?.message || String(cause); render(); });
  });
  window.addEventListener('pagehide', () => { disposed = true; clearTimeout(expiryTimer); unsubscribe?.(); }, { once: true });
  if (!bridge) { error = '로컬 권한 관리 연결을 사용할 수 없습니다.'; render(); return; }
  unsubscribe = bridge.subscribe(accept);
  void load();
})();
