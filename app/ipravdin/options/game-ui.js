(() => {
  'use strict';
  const G = PravdinGame;
  const panel = document.getElementById('gamePanel');
  if (!panel) return;
  const send = (action, data = {}) => browser.runtime.sendMessage({ channel: 'pravdin-game', action, ...data });
  const element = (tag, text, parent = panel) => { const e = document.createElement(tag); if (text) e.textContent = text; parent.append(e); return e; };
  const notice = element('p'); notice.setAttribute('role', 'status');
  async function action(fn) { try { const r = await fn(); if (r?.error) notice.textContent = r.error; } catch { notice.textContent = 'Не удалось выполнить действие. Попробуйте ещё раз.'; } }
  const heading = element('h2', 'Правдин с характером');
  const stats = element('p'); stats.className = 'game-stats';
  const label = element('label'); label.className = 'setting';
  element('span', 'Случайные встречи и задачки', label);
  const enabled = element('input', '', label); enabled.type = 'checkbox'; enabled.className = 'toggle'; enabled.setAttribute('aria-label', 'Игровые события'); enabled.setAttribute('role', 'switch');
  const rateLabel = element('label', 'Интервал между встречами: ');
  const rate = element('select', '', rateLabel); rate.setAttribute('aria-label', 'Интервал событий');
  for (const n of [5, 10, 30, 60]) { const option = element('option', `${n} минут`, rate); option.value = n; }
  const controls = element('div'); controls.className = 'game-actions';
  function button(text, fn) { const b = element('button', text, controls); b.type = 'button'; b.addEventListener('click', () => action(async () => { b.disabled = true; try { return await fn(); } finally { b.disabled = false; } })); }
  function practice(mode) { return browser.tabs.create({ url: browser.runtime.getURL(`ipravdin/options/practice.html?mode=${mode}`) }); }
  button('Решить задачу', () => practice('quiz'));
  button('Билет дня · 3 вопроса', () => practice('ticket'));
  button('Начать прятки', () => send('quest'));
  const quest = element('p'); quest.className = 'game-quest';
  const links = element('div'); links.className = 'game-actions';
  const open = element('button', 'Открыть статью-подсказку', links); open.type = 'button';
  const cancel = element('button', 'Отменить поиск', links); cancel.type = 'button'; cancel.addEventListener('click', () => action(() => send('cancelQuest')));
  const collection = element('div'); collection.className = 'game-collection';
  const preview = element('dialog'); preview.className = 'specimen-preview';
  const previewImage = element('img', '', preview); const previewName = element('h3', '', preview);
  const previewClose = element('button', 'Закрыть', preview); previewClose.type = 'button'; previewClose.addEventListener('click', () => preview.close());
  element('p', 'Коллекционки заменяют картинки на сайтах. Нажмите на изображение с цветной рамкой: оно попадёт в коллекцию и сменится обычным фото. Опросы и наблюдение появляются в правом нижнем углу страницы.');
  let current;
  open.addEventListener('click', () => { if (current?.quest) action(() => browser.tabs.create({ url: current.quest.url })); });
  async function render() {
    const r = await send('read'); current = r.state;
    enabled.checked = r.prefs.enabled; rate.value = r.prefs.interval;
    heading.textContent = `Правдин · ${G.mood(current.mood)}`;
    stats.textContent = `Настроение ${current.mood}/100 · ${current.xp} баллов · ${current.solved}/${current.attempted} верных · серия ${current.streak} (рекорд ${current.best}) · найдено ${current.found}`;
    quest.textContent = current.quest?.hint || 'Правдин пока не прячется. Начните поиск, чтобы получить подсказку.'; links.hidden = !current.quest;
    collection.replaceChildren();
    for (const s of G.species) {
      const count = current.collection[s.id] || 0;
      const card = element('div', '', collection); card.className = `specimen ${count ? 'caught' : ''}`; card.style.borderColor = s.color;
      const image = element('img', '', card); image.src = count ? browser.runtime.getURL(s.image) : '../photos/closeup.jpg'; image.alt = count ? s.name : 'Неизвестный Правдин'; image.style.filter = count ? 'none' : 'brightness(.2) grayscale(1)';
      element('strong', count ? s.name : '???', card); element('small', `${s.rarity} · ${count ? `поймано ${count}` : 'ещё не пойман'}`, card);
      if (count) { const view = element('button', 'Рассмотреть', card); view.type = 'button'; view.addEventListener('click', () => { previewImage.src = browser.runtime.getURL(s.image); previewImage.alt = s.name; previewName.textContent = `${s.name} · ${s.rarity}`; preview.showModal(); }); }
    }
  }
  async function prefs() { const r = await send('read'); return send('prefs', { value: { ...r.prefs, enabled: enabled.checked, interval: Number(rate.value) } }); }
  enabled.addEventListener('change', () => action(prefs)); rate.addEventListener('change', () => action(prefs));
  browser.storage.onChanged.addListener((changes, area) => { if (area === 'local' && (changes.gameState || changes.gamePrefs)) action(render); });
  action(render);
})();
