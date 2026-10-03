(() => {
  'use strict';
  if (window.top !== window) return;
  const G = PravdinGame;
  const ownTab = location.protocol === 'moz-extension:' && browser.tabs?.getCurrent ? browser.tabs.getCurrent() : Promise.resolve(null);
  const send = async (action, data = {}) => browser.runtime.sendMessage({ channel: 'pravdin-game', action, ...data, tabId: (await ownTab)?.id });
  let host, root, box, current, hiddenPet, hiddenQuest, timer, busy = false, remaining = 60, tick = Date.now();
  const el = (tag, text, parent = box) => { const n = document.createElement(tag); if (text) n.textContent = text; parent?.append(n); return n; };
  function mount() {
    if (host?.isConnected) return;
    host = document.createElement('div'); host.style.cssText = 'all:initial;position:fixed;bottom:20px;right:20px;z-index:2147483647;max-width:calc(100vw - 24px)';
    host.id = 'ipravdin-encounter';
    root = host.attachShadow({ mode: 'closed' });
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = browser.runtime.getURL('ipravdin/game.css'); root.append(css);
    box = el('section', '', root); box.className = 'pravdin-box'; box.setAttribute('aria-label', 'Встреча с Правдиным');
    document.documentElement.append(host);
  }
  function button(text, fn, parent = box) {
    const b = el('button', text, parent); b.type = 'button'; b.addEventListener('click', async () => {
      if (busy) return; busy = true; b.disabled = true;
      try { await fn(); } catch { status('Не удалось сохранить. Попробуйте ещё раз.'); } finally { busy = false; b.disabled = false; }
    }); return b;
  }
  function status(text) { mount(); let p = root.querySelector('.status'); if (!p) { p = el('p'); p.className = 'status'; p.setAttribute('role', 'status'); } p.textContent = text; }
  function portrait(parent = box, species) {
    const area = el('div', '', parent); area.className = 'pet';
    const img = el('img', '', area); img.src = browser.runtime.getURL(species?.image || 'ipravdin/photos/closeup.jpg'); img.alt = species?.name || 'Правдин';
    if (species) { area.classList.add('collectible'); area.style.borderColor = species.color; const label = el('span', species.rarity, area); label.className = 'rarity'; }
    const head = el('button', '♡', area); head.className = 'head'; head.title = 'Поводите курсором по голове или нажмите, чтобы погладить'; head.setAttribute('aria-label', 'Погладить Правдина');
    let distance = 0, previous, last = 0;
    async function pet() { if (Date.now() - last < 2000) return; last = Date.now(); const result = await send('pet'); status(result.error || result.text || '♡ Ладно, сегодня вы мне нравитесь.'); }
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
    } else if (e.kind === 'rare') {
      const s = G.species.find(s => s.id === e.species); el('h3', `Дикий ${s.name}!`); el('p', `${s.rarity} экземпляр. Поймайте его в свою коллекцию.`);
      button('Поймать Правдина', async () => resultView(await send('catch', { id: e.id })));
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
    const allowed = settings.activate && values.gamePrefs?.enabled !== false && !PravdinSettings.blocked(location.hostname, settings.excluded);
    quest({ ...G.empty(), ...values.gameState }, allowed);
    if (!allowed) close();
    else if (current && values.gameState?.encounter?.id !== current.id) { clearInterval(timer); current = null; }
    return allowed;
  }
  async function poll() {
    if (document.visibilityState !== 'visible' || host?.isConnected || busy) return;
    if (!await sync()) return;
    const r = await send('claim'); if (r.state?.encounter) render(r.state.encounter);
  }
  browser.runtime.onMessage.addListener(message => {
    if (message?.channel !== 'pravdin-show') return undefined;
    return (async () => { if (!await sync()) return { error: 'Включите игровой режим и уберите сайт из исключений.' }; const r = await send(message.action === 'ticket' ? 'ticket' : 'quiz'); if (r.error) return r; render(r.state.encounter); return { ok: true }; })();
  });
  browser.storage.onChanged.addListener((changes, area) => { if (area === 'local' && ['gameState', 'gamePrefs', 'activate', 'excluded'].some(k => k in changes)) sync().catch(() => {}); });
  let interval = setInterval(() => poll().catch(() => {}), 20000);
  document.addEventListener('visibilitychange', () => { tick = Date.now(); if (document.visibilityState === 'visible') poll().catch(() => {}); });
  window.addEventListener('pagehide', () => { clearInterval(interval); close(); hiddenPet?.remove(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { interval = setInterval(() => poll().catch(() => {}), 20000); sync().then(poll).catch(() => {}); } });
  sync().then(async allowed => {
    if (allowed && location.pathname.endsWith('/practice.html')) { const r = await send(new URLSearchParams(location.search).get('mode') === 'ticket' ? 'ticket' : 'quiz'); if (r.error) status(r.error); else render(r.state.encounter); }
    else await poll();
  }).catch(() => {});
})();
