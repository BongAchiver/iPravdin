(() => {
  'use strict';
  if (window.top !== window) return;
  const G = PravdinGame;
  const practice = location.protocol === 'moz-extension:' && location.pathname.endsWith('/practice.html');
  const ownTab = location.protocol === 'moz-extension:' && browser.tabs?.getCurrent ? browser.tabs.getCurrent().catch(() => null) : Promise.resolve(null);
  const send = async (action, data = {}) => browser.runtime.sendMessage({ channel: 'pravdin-game', action, ...data, tabId: (await ownTab)?.id });
  let host, root, box, current, hiddenPet, hiddenQuest, timer, busy = false, remaining = 60, tick = Date.now(), latestState = G.empty();
  const el = (tag, text, parent = box) => { const n = document.createElement(tag); if (text) n.textContent = text; parent?.append(n); return n; };
  function mount() {
    if (host?.isConnected) return;
    host = document.createElement('div'); host.style.cssText = 'all:initial;position:fixed;bottom:20px;right:20px;z-index:2147483647;max-width:calc(100vw - 24px)';
    host.id = 'ipravdin-encounter';
    if (practice) { host.classList.add('practice-host'); host.style.cssText = 'display:block;position:relative;margin:24px auto;max-width:100%'; }
    root = host.attachShadow({ mode: 'closed' });
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = browser.runtime.getURL('ipravdin/game.css'); root.append(css);
    box = el('section', '', root); box.className = 'pravdin-box'; box.setAttribute('aria-label', 'Встреча с Правдиным');
    (practice ? document.getElementById('practiceStage') || document.body : document.documentElement).append(host);
  }
  function button(text, fn, parent = box) {
    const b = el('button', text, parent); b.type = 'button'; b.addEventListener('click', async () => {
      if (busy) return; busy = true; b.disabled = true;
      try { await fn(); } catch { status('Не удалось сохранить. Попробуйте ещё раз.'); } finally { busy = false; b.disabled = false; }
    }); return b;
  }
  function status(text) { mount(); let p = root.querySelector('.status'); if (!p) { p = el('p'); p.className = 'status'; p.setAttribute('role', 'status'); } p.textContent = text; const pageStatus = document.getElementById('practiceStatus'); if (pageStatus) pageStatus.textContent = text; }
  function portrait(parent = box, species) {
    const area = el('div', '', parent); area.className = 'pet';
    const img = el('img', '', area); img.src = browser.runtime.getURL(species?.image || G.visual(latestState).photo); img.alt = species?.name || 'Правдин';
    if (species) { area.classList.add('collectible'); area.style.borderColor = species.color; const label = el('span', species.rarity, area); label.className = 'rarity'; }
    const head = el('button', '♡', area); head.className = 'head'; head.title = 'Поводите курсором по голове или нажмите, чтобы погладить'; head.setAttribute('aria-label', 'Погладить Правдина');
    let distance = 0, previous, last = 0;
    async function pet() { if (Date.now() - last < 2000) return; last = Date.now(); const result = await send('pet'); if (result.state) { latestState = result.state; img.src = browser.runtime.getURL(G.visual(latestState).photo); } status(result.error || result.text || '♡ Ладно, сегодня вы мне нравитесь.'); }
    head.addEventListener('pointermove', event => { if (previous) distance += Math.hypot(event.clientX - previous.x, event.clientY - previous.y); previous = { x: event.clientX, y: event.clientY }; if (distance > 160) { distance = 0; pet().catch(() => status('Не удалось погладить.')); } });
    head.addEventListener('pointerleave', () => { previous = null; distance = 0; });
    head.addEventListener('click', () => pet().catch(() => status('Не удалось погладить.')));
  }
  function close() { clearInterval(timer); timer = null; host?.remove(); current = null; }
  function resultView(result) {
    if (result.error) { status(result.error); return; }
    clearInterval(timer); mount(); box.hidden = false; root.querySelector('.reopen')?.remove(); box.replaceChildren(); portrait(); el('h3', G.mood(result.state.mood));
    el('p', result.text || 'Правдин доволен. Продолжайте.');
    if (result.state.encounter?.kind === 'quiz') button('Следующий вопрос билета', () => render(result.state.encounter));
    button('Закрыть', close);
  }
  function render(e) {
    if (e?.kind === 'rare') { imageEncounter(e, true).catch(error => status(error.message)); return; }
    if (!e) return; clearInterval(timer); current = e; mount(); box.hidden = false; root.querySelector('.reopen')?.remove(); box.replaceChildren();
    const bar = el('div'); bar.className = 'bar'; el('span', 'iPravdin · Встреча', bar);
    button('×', async () => { await send('skip', { id: e.id }); close(); }, bar).setAttribute('aria-label', 'Пропустить встречу');
    portrait(box, G.species.find(s => s.id === e.species));
    if (e.kind === 'quiz') {
      el('h3', e.ticket ? `Билет · осталось ${e.ticket.left}` : `Внезапный опрос · ${e.question.category}`);
      el('p', e.question.text);
      const answers = el('div'); answers.className = 'answers';
      e.question.answers.forEach((answer, i) => button(answer, async () => resultView(await send('answer', { id: e.id, answer: i })), answers));
      const time = el('small', '60 с · время идёт в видимой вкладке'); remaining = 60; tick = Date.now();
      timer = setInterval(async () => {
        const now = Date.now(); if (document.visibilityState === 'visible') remaining -= Math.min(2, (now - tick) / 1000); tick = now;
        time.textContent = `${Math.max(0, Math.ceil(remaining))} с · время идёт в видимой вкладке`;
        if (remaining <= 0 && !busy) { clearInterval(timer); busy = true; try { resultView(await send('skip', { id: e.id })); } catch { status('Не удалось сохранить пропуск.'); } finally { busy = false; } }
      }, 1000);
      button('Свернуть на время', () => { box.hidden = true; const reopen = button('Правдин ждёт…', () => { reopen.remove(); box.hidden = false; }, root); reopen.className = 'reopen'; });
    } else {
      el('h3', 'Правдин наблюдает');
      el('p', ['Определение предела помните?', 'Кванторы сами себя не переставят.', 'Супремум есть. А понимание?', 'Я всё вижу. Даже вашу бесконечно малую подготовку.'][Math.floor(Math.random() * 4)]);
      button('☕ Предложить чай', async () => { const r = await send('tea'); status(r.error || r.text); });
      button('Поговорить', async () => { const r = await send('talk'); status(r.error || r.text); });
      button('Я учусь, честно', async () => { await send('dismiss', { id: e.id }); close(); });
    }
  }
  function quest(state, allowed) {
    const q = allowed && state.quest && G.samePage(location.href, state.quest.url) ? state.quest : null;
    if (q?.id === hiddenQuest && hiddenPet?.isConnected) return;
    hiddenPet?.remove(); hiddenPet = null; hiddenQuest = q?.id;
    const suppress = Boolean(q);
    if ((document.documentElement.dataset.pravdinQuest === 'true') !== suppress) {
      document.documentElement.dataset.pravdinQuest = String(suppress); window.dispatchEvent(new Event('pravdin-quest-change'));
    }
    if (!q) return;
    const candidates = [...document.querySelectorAll('#mw-content-text p')].filter(p => p.textContent.length > 100 && p.getClientRects().length);
    const target = candidates[Math.floor(Math.random() * candidates.length)] || document.querySelector('main') || document.body;
    hiddenPet = document.createElement('span'); hiddenPet.id = 'ipravdin-hidden'; const shadow = hiddenPet.attachShadow({ mode: 'closed' });
    const b = document.createElement('button'); b.type = 'button'; b.title = 'Кажется, это Правдин…'; b.setAttribute('aria-label', 'Нашёл Правдина');
    b.style.cssText = 'border:0;background:transparent;padding:3px;cursor:pointer;display:inline-block;vertical-align:middle';
    const img = document.createElement('img'); img.src = browser.runtime.getURL('ipravdin/photos/portrait.jpg'); img.alt = 'Правдин спрятался'; img.style.cssText = 'width:38px;height:44px;object-fit:cover;border-radius:10px;'; b.append(img); shadow.append(b); target.append(hiddenPet);
    b.addEventListener('click', async () => { b.disabled = true; try { const result = await send('found', { id: q.id }); if (result.error) { b.disabled = false; return; } quest(result.state, true); resultView({ ...result, text: 'Нашли! +25 баллов. А теперь можно вернуться к матану.' }); } catch { b.disabled = false; } });
  }
  async function sync() {
    const values = await browser.storage.local.get(['gameState', 'gamePrefs', ...Object.keys(PravdinSettings.defaults)]);
    const settings = PravdinSettings.normalize(values);
    const allowed = practice || (settings.activate && values.gamePrefs?.enabled !== false && !PravdinSettings.blocked(location.hostname, settings.excluded));
    latestState = { ...G.empty(), ...values.gameState };
    const photo = root?.querySelector('.pet:not(.collectible) img'); if (photo) photo.src = browser.runtime.getURL(G.visual(latestState).photo);
    quest({ ...G.empty(), ...values.gameState }, allowed);
    if (!allowed) close();
    else if (current && values.gameState?.encounter?.id !== current.id) { clearInterval(timer); current = null; }
    return allowed;
  }
  async function poll() {
    if (practice) return;
    if (document.visibilityState !== 'visible' || host?.isConnected || busy) return;
    if (!await sync()) return;
    const r = await send('claim'); if (r.state?.encounter?.kind === 'rare') await imageEncounter(r.state.encounter); else if (r.state?.encounter) render(r.state.encounter);
  }
  async function imageEncounter(e, explicit = false) {
    const result = await globalThis.PravdinImages?.spawn({ encounterId: e.id });
    if (!result?.ok) await send('dismiss', { id: e.id });
    if (explicit && !result?.ok) status(result?.error || 'На странице нет картинок для коллекционки.');
    return result || { error: 'Подмена изображений на странице недоступна.' };
  }
  async function startPractice() {
    const pageStatus = document.getElementById('practiceStatus'); if (pageStatus) pageStatus.textContent = 'Правдин выбирает вопрос…';
    try {
      await sync();
      const r = await Promise.race([send(new URLSearchParams(location.search).get('mode') === 'ticket' ? 'ticket' : 'quiz', { takeover: true }), new Promise((_, reject) => setTimeout(() => reject(new Error('Правдин не ответил. Нажмите «Повторить запуск».')), 8000))]);
      if (r?.error) status(r.error); else if (r?.state?.encounter?.question) { if (pageStatus) pageStatus.textContent = 'Вопрос готов. Выберите ответ в карточке ниже.'; render(r.state.encounter); } else status('Не удалось получить вопрос. Нажмите «Повторить запуск».');
    } catch (error) { console.error('iPravdin: practice failed', error); status(`Не удалось запустить опрос: ${error.message || error}. Нажмите «Повторить запуск».`); }
  }
  document.getElementById('practiceRetry')?.addEventListener('click', startPractice);
  document.addEventListener('pravdin-collected', event => {
    const standalone = !host?.isConnected;
    status(event.detail);
    if (standalone) { button('Закрыть', close); const notification = host; setTimeout(() => { if (host === notification && !current) close(); }, 3500); }
  });
  browser.runtime.onMessage.addListener(message => {
    if (message?.channel !== 'pravdin-show') return undefined;
    return (async () => { if (!await sync()) return { error: 'Включите игровой режим и уберите сайт из исключений.' }; const r = await send(message.action === 'debug' ? 'read' : message.action === 'ticket' ? 'ticket' : 'quiz'); if (r.error) return r; if (r.state.encounter?.kind === 'rare') return imageEncounter(r.state.encounter, true); render(r.state.encounter); return { ok: true }; })();
  });
  browser.storage.onChanged.addListener((changes, area) => { if (area === 'local' && ['gameState', 'gamePrefs', 'activate', 'excluded'].some(k => k in changes)) sync().catch(() => {}); });
  let interval = setInterval(() => poll().catch(() => {}), 1000);
  document.addEventListener('visibilitychange', () => { tick = Date.now(); if (document.visibilityState === 'visible') poll().catch(() => {}); });
  window.addEventListener('pagehide', () => { clearInterval(interval); close(); hiddenPet?.remove(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { interval = setInterval(() => poll().catch(() => {}), 1000); if (practice) startPractice(); else sync().then(poll).catch(() => {}); } });
  if (practice) startPractice(); else sync().then(poll).catch(error => console.error('iPravdin: cannot start events', error));
})();
