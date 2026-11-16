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
    const picker = node('div', 'mode-picker');
    const trigger = button('', () => menu.hidden ? open() : close());
    trigger.setAttribute('aria-label', label); trigger.setAttribute('aria-haspopup','listbox');
    trigger.setAttribute('aria-expanded','false'); trigger.setAttribute('aria-controls', `picker-${label}`);
    trigger.append(node('span','', options.find(([value])=>value===selected)?.[1] || selected), node('span','chevron','⌄'));
    const menu = node('div','mode-options'); menu.id = `picker-${label}`; menu.hidden = true;
    menu.setAttribute('role','listbox'); menu.setAttribute('aria-label',label);
    const entries = options.map(([value,text], index) => {
      const option = button('', () => { close(); handler(value); });
      option.append(node('span','',text),node('span','check', '✓'));
      option.setAttribute('role','option'); option.setAttribute('aria-selected',String(value===selected)); option.tabIndex=-1;
      option.addEventListener('keydown',event=>{
        if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
          event.preventDefault(); entries[event.key==='Home'?0:event.key==='End'?entries.length-1:(index+(event.key==='ArrowDown'?1:entries.length-1))%entries.length].focus();
        } else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}
      });
      menu.append(option); return option;
    });
    function close(focus=false){menu.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus();}
    function open(index){menu.hidden=false;trigger.setAttribute('aria-expanded','true');entries[index ?? Math.max(0,options.findIndex(([value])=>value===selected))].focus();}
    trigger.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();open(event.key==='Home'?0:event.key==='End'?entries.length-1:undefined);}});
    picker.addEventListener('focusout',event=>{if(!picker.contains(event.relatedTarget))close();});
    picker.append(trigger,menu);return picker;
  }
  function appIcon(identity, desktop = false) {
    const icon = node('div','app-icon'); icon.setAttribute('aria-hidden','true');
    const fallback = node('span','',desktop?'▧':'◇'); icon.append(fallback);
    const source = identity?.locked ? '../assets/app-icon-32.png' : identity?.icon;
    const hasImage = identity?.locked || typeof source === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(source);
    if(!identity?.locked&&(identity?.iconState==='loading'||hasImage)){
      icon.classList.add('icon-loading');fallback.textContent='';
      icon.setAttribute('aria-hidden','false');icon.setAttribute('role','img');icon.setAttribute('aria-label','앱 아이콘 불러오는 중');
    }
    if (hasImage) {
      const image = node('img'); image.alt='';
      image.addEventListener('load',()=>{fallback.hidden=true;icon.classList.remove('icon-loading');icon.setAttribute('aria-hidden','true');});
      image.addEventListener('error',()=>{image.remove();fallback.hidden=false;fallback.textContent=desktop?'▧':'◇';icon.classList.remove('icon-loading');icon.setAttribute('aria-hidden','true');});
      image.src=source;icon.append(image);
    }
    return icon;
  }
  function appForm(protectedList) {
    const form=node('form','add-app-form'), id=protectedList?'protected-path':'allowed-path';
    const label=node('label','',protectedList?'차단할 실행 파일 경로':'실행 파일 경로');label.htmlFor=id;
    const input=node('input');input.id=id;input.placeholder=protectedList?'C:\\Apps\\PrivateApp.exe':'C:\\Apps\\App.exe';input.disabled=pending;input.spellcheck=false;
    const controls=node('div');const add=button('추가',()=>{});add.type='submit';controls.append(input,add);form.append(label,controls);
    form.addEventListener('submit',event=>{event.preventDefault();if(input.value.trim())void command(protectedList?'addProtectedApp':'addAllowedApp',{executable:input.value.trim()});});return form;
  }
  function apps(title, description, items, protectedList) {
    const head = node('div', 'section-head'); head.append(node('h2', '', title));
    head.append(button('+ 앱 선택', () => command(protectedList?'addProtectedApp':'addAllowedApp'), 'text-button'));
    const card = node('section', 'card'); card.setAttribute('aria-label', title);
    for (const app of items) {
      const name = app.locked ? 'Azrael Window Use' : app.label || app.executable;
      const item = row(name, '', null); item.classList.add('app-row');
      item.firstChild.append(node('div', 'path', app.executable));
      item.prepend(appIcon(app));
      if (protectedList && app.locked) item.append(node('span', 'locked', '항상 보호'));
      else {
        const remove = button('×', () => command(protectedList ? 'removeProtectedApp' : 'removeAllowedApp', { executable: app.executable }), 'remove');
        remove.setAttribute('aria-label', `${name} 제거`); remove.title = '제거'; item.append(remove);
      }
      card.append(item);
    }
    if (!items.length) card.append(node('p', 'empty', '등록된 앱이 없습니다.'));
    main.append(head);if(description)main.append(node('p','section-copy',description));main.append(card,appForm(protectedList));
  }
  function settings() {
    const settings = state.settings;
    const card = node('section', 'card');
    const toggle = button('', () => command('setEnabled', { enabled: !settings.enabled }), 'switch');
    toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-checked', String(settings.enabled)); toggle.setAttribute('aria-label', 'Azrael Window Use 사용');
    card.append(row('Azrael Window Use 사용', '모델의 창 관찰과 제어를 허용합니다.', toggle));
    card.append(row('권한 모드', ({ observe: '창을 관찰하고 읽기만 허용합니다.', ask: '앱을 제어하기 전에 승인을 요청합니다.', full: '앱별 추가 승인 없이 제어를 허용합니다.' })[settings.mode], select([['observe', '관찰만'], ['ask', '승인 요청'], ['full', '전체 허용']], settings.mode, mode => command('setMode', { mode }), '권한 모드')));
    main.append(card);
    apps('화이트리스트 앱', '승인 요청 모드에서 추가 승인 없이 제어할 앱입니다. 보호된 앱은 항상 차단됩니다.', settings.allowedApps || [], false);
    apps('보호된 앱', '관찰과 제어를 항상 차단합니다.', settings.protectedApps || [], true);
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
    main.append(node('h1', '', desktop ? '데스크톱 접근을 허용할까요?' : observation ? '앱 관찰을 허용할까요?' : '앱의 제어를 잠시 허용할까요?'));
    main.append(node('p', 'approval-copy', desktop ? '전체 화면을 읽고 여러 앱을 마우스와 키보드로 조작할 수 있습니다.' : observation ? '이 앱의 창을 캡처하고 화면에 표시된 내용을 읽을 수 있습니다.' : '이 앱의 화면을 읽고 마우스와 키보드로 조작할 수 있습니다.'));
    const app = node('div', 'approval-app');
    const target=node('div','row-text');target.append(node('div', 'label', desktop ? '전체 데스크톱' : request.app?.name || '앱'), node('div', 'path', desktop ? '모든 모니터 · 화면에 표시된 여러 앱' : request.app?.executable || '실행 파일 정보 없음'));
    app.append(appIcon(desktop?null:request.app, desktop),target); main.append(app);
    main.append(node('p', 'approval-note', '이 연결이 종료되면 허용도 종료됩니다.'));
    const actions = node('div', 'approval-actions');
    const respond = decision => command('respondApproval', { id: request.id, decision });
    actions.append(button('거부', () => respond('deny')), button('이 연결에서 허용', () => respond('session'), 'primary')); main.append(actions);
    if (!desktop && !observation) main.append(button('이 앱을 항상 허용', () => respond('always'), 'always-button'));
    document.getElementById('version').textContent = `만료 ${new Date(request.expiresAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;
    expiryTimer = setTimeout(render, Math.min(Math.max(1, request.expiresAt - Date.now() + 10), 2147483647));
  }
  function render() {
    if (disposed) return;
    clearTimeout(expiryTimer);
    const focused = document.activeElement;
    const focusLabel = main.contains(focused) ? focused.getAttribute('aria-label') || focused.textContent : null;
    const focusId = main.contains(focused) ? focused.id : null;
    const drafts = [...main.querySelectorAll('input[id]')].map(input=>[input.id,input.value]);
    main.replaceChildren(); main.setAttribute('aria-busy', String(pending || !state));
    document.documentElement.dataset.theme = state?.theme || 'system';
    status.textContent = pending ? '저장 중…' : '';
    const settingsView = state?.view === 'settings';
    document.body.dataset.view = state?.view || '';
    document.getElementById('brand-name').textContent = settingsView ? 'Azrael Window Use 설정' : 'Azrael Window Use';
    const footerLeft=document.getElementById('footer-left'),footerRight=document.getElementById('footer-right');
    footerLeft.replaceChildren();footerRight.replaceChildren();
    if(settingsView){footerLeft.append(button('설정 초기화',()=>command('resetSettings'),'reset-button'));footerRight.append(button('완료',()=>command('close'),'primary'));}
    else {const gear=button('⚙',()=>command('openSettings'),'settings-button');gear.setAttribute('aria-label','설정 열기');gear.title='설정';footerLeft.append(gear);}
    const version=node('span');version.id='version';footerRight.append(version);
    if (error || state?.error) {
      const alert = node('div', 'error', error || state.error); alert.setAttribute('role', 'alert');
      alert.append(node('br'), button('다시 불러오기', load, 'small')); main.append(alert);
    }
    if (!state) main.append(node('p', 'loading', error ? '설정을 불러오지 못했습니다.' : '설정을 불러오는 중…'));
    else if (state.view === 'approval') approval();
    else settings();
    for(const [id,value] of drafts){const input=document.getElementById(id);if(input)input.value=value;}
    if(focusId)document.getElementById(focusId)?.focus({preventScroll:true});
    else if (focusLabel) Array.from(main.querySelectorAll('button,select,input')).find(element => (element.getAttribute('aria-label') || element.textContent) === focusLabel)?.focus({ preventScroll: true });
  }
  for (const action of ['minimize', 'close']) document.getElementById(action).addEventListener('click', () => {
    Promise.resolve(bridge?.command(action)).catch(cause => { error = cause?.message || String(cause); render(); });
  });
  window.addEventListener('pagehide', () => { disposed = true; clearTimeout(expiryTimer); unsubscribe?.(); }, { once: true });
  document.addEventListener('click',event=>{for(const picker of main.querySelectorAll('.mode-picker'))if(!picker.contains(event.target)){picker.querySelector('.mode-options').hidden=true;picker.querySelector('button').setAttribute('aria-expanded','false');}});
  if (!bridge) { error = '로컬 권한 관리 연결을 사용할 수 없습니다.'; render(); return; }
  unsubscribe = bridge.subscribe(accept);
  void load();
})();
