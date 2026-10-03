(() => {
  'use strict';
  const G = PravdinGame, panel = document.getElementById('debugPanel'); if (!panel) return;
  const el = (tag, text, parent = panel) => { const e = document.createElement(tag); if (text) e.textContent = text; parent.append(e); return e; };
  const send = (action, data = {}) => browser.runtime.sendMessage({ channel: 'pravdin-game', action, ...data });
  el('h2', 'Лаборатория Правдина');
  el('p', 'Выставьте шансы, выберите открытую веб-страницу и вызовите событие сразу. Тестовые поимки и ответы тоже сохраняются в зачётке.');
  const enabledLabel = el('label'); enabledLabel.className = 'setting'; el('span', 'Режим отладки', enabledLabel);
  const enabled = el('input', '', enabledLabel); enabled.type = 'checkbox'; enabled.className = 'toggle'; enabled.id = 'debugEnabled'; enabled.setAttribute('aria-label', 'Режим отладки');
  const fields = el('div'); fields.className = 'debug-fields';
  function field(id, name, max, step = '1') { const label = el('label', name, fields); const input = el('input', '', label); input.type = 'number'; input.id = id; input.min = '0'; input.max = max; input.step = step; return input; }
  const seconds = field('debugSeconds', 'Интервал отладки, секунды', 3600);
  const chance = field('imageChance', 'Шанс коллекционки на новой картинке, %', 100, '.1');
  const events = { quiz: field('quizWeight', 'Вес опроса', 100), rare: field('imageWeight', 'Вес появления коллекционки', 100), watch: field('watchWeight', 'Вес наблюдения', 100) };
  const rarities = ['Обычный', 'Редкий', 'Эпический', 'Легендарный'].map((name, i) => field(`rarityWeight${i}`, `Вес редкости: ${name}`, 100, '.1'));
  el('p', 'Веса нормализуются: 100 / 0 / 0 означает только опросы. Нулевые веса всех событий отключают случайные встречи. Шанс на новой картинке действует и без отладки; при 100% на вкладке появляются до трёх коллекционок одновременно.');
  const targetLabel = el('label', 'Тестовая веб-страница: ');
  const target = el('select', '', targetLabel); target.className = 'debug-target'; target.id = 'debugTarget'; target.setAttribute('aria-label', 'Тестовая веб-страница');
  const speciesLabel = el('label', ' Карточка: ');
  const species = el('select', '', speciesLabel); species.className = 'debug-target'; species.id = 'debugSpecies'; species.setAttribute('aria-label', 'Коллекционный Правдин для теста');
  const random = el('option', 'Случайная по весам', species); random.value = '';
  for (const s of G.species) { const option = el('option', `${s.name} · ${s.rarity}`, species); option.value = s.id; }
  const controls = el('div'); controls.className = 'game-actions';
  const status = el('p'); status.className = 'debug-status'; status.setAttribute('role', 'status');
  let queue = Promise.resolve();
  function button(id, text, fn) { const b = el('button', text, controls); b.type = 'button'; b.id = id; b.addEventListener('click', async () => { b.disabled = true; try { await queue; await fn(); } catch (e) { status.textContent = e.message; } finally { b.disabled = false; } }); }
  async function tabs() {
    const current = target.value; const all = await browser.tabs.query({ currentWindow: true }); target.replaceChildren();
    for (const tab of all.filter(t => /^https?:/.test(t.url || ''))) { const option = el('option', tab.title || tab.url, target); option.value = tab.id; }
    if ([...target.options].some(o => o.value === current)) target.value = current;
    if (!target.options.length) status.textContent = 'Откройте обычный сайт с картинками и обновите список вкладок.';
  }
  async function save() {
    const current = await send('read'); const value = { ...current.prefs, debug: enabled.checked, debugIntervalSeconds: Number(seconds.value), collectibleChance: Number(chance.value), events: Object.fromEntries(Object.entries(events).map(([k, i]) => [k, Number(i.value)])), rarities: rarities.map(i => Number(i.value)) };
    const r = await send('prefs', { value }); if (r.error) throw new Error(r.error); status.textContent = enabled.checked ? 'Отладка включена. Можно вызывать события.' : 'Обычный режим. Шансы сохранены.';
  }
  for (const input of [enabled, seconds, chance, ...Object.values(events), ...rarities]) input.addEventListener('change', () => { queue = queue.then(save).catch(e => { status.textContent = e.message; }); });
  async function show(kind) {
    if (!enabled.checked) throw new Error('Сначала включите режим отладки.'); if (!target.value) throw new Error('Выберите веб-страницу.');
    const tabId = Number(target.value);
    if (kind === 'image' || kind === 'clear') {
      const r = await browser.tabs.sendMessage(tabId, { channel: 'pravdin-images', action: kind === 'clear' ? 'clear' : 'spawn', species: species.value }, { frameId: 0 });
      if (!r?.ok) throw new Error(r?.error || 'Нет подходящей картинки. Включите подмену на сайте и обновите страницу.');
    } else {
      const r = await send('debugEvent', { targetTab: tabId, event: kind }); if (r.error) throw new Error(r.error);
      const response = await browser.tabs.sendMessage(tabId, { channel: 'pravdin-show', action: 'debug' }, { frameId: 0 }); if (response?.error) throw new Error(response.error);
    }
    await browser.tabs.update(tabId, { active: true }); status.textContent = 'Событие показано на выбранной странице.';
  }
  button('debugRefresh', 'Обновить вкладки', tabs);
  button('debugQuiz', 'Опрос сейчас', () => show('quiz'));
  button('debugTicket', 'Билет сейчас', () => show('ticket'));
  button('debugWatch', 'Наблюдение сейчас', () => show('watch'));
  button('debugImage', 'Коллекционка сейчас', () => show('image'));
  button('debugClear', 'Очистить карточки на странице', () => show('clear'));
  button('debugReset', 'Вернуть стандартные шансы', async () => { const r = await send('read'); await send('prefs', { value: { ...G.preferences(), enabled: r.prefs.enabled, interval: 5 } }); await render(); });
  async function render() { const { prefs } = await send('read'); enabled.checked = prefs.debug; seconds.value = prefs.debugIntervalSeconds; chance.value = prefs.collectibleChance; for (const [k, i] of Object.entries(events)) i.value = prefs.events[k]; rarities.forEach((i, n) => { i.value = prefs.rarities[n]; }); }
  Promise.all([render(), tabs()]).catch(e => { status.textContent = e.message; });
})();
