(() => {
  'use strict';
  const get = id => document.getElementById(id);
  const errors = {
    LOGIN: 'Войдите в свой аккаунт на my.itmo, затем обновите расписание.',
    CLIENT: 'my.itmo ещё загружается. Подождите и нажмите обновить.',
    ACCOUNT_CHANGED: 'Аккаунт изменился. Обновите расписание для нового аккаунта.',
    FORMAT: 'Формат расписания на my.itmo изменился. Не удалось прочитать пары.',
    DATE: 'Выберите корректную дату.',
    NETWORK: 'Не удалось получить расписание. Проверьте интернет и вкладку my.itmo.',
    TAB: 'Откройте my.itmo и войдите в свой аккаунт. Затем снова откройте расширение.'
  };
  let revision = 0;
  let selectedTab;
  let snapshot;
  function clear() {
    snapshot = undefined;
    get('scheduleLessons').replaceChildren();
    get('scheduleNearest').hidden = true;
    get('scheduleAccount').textContent = 'Вход через ваш аккаунт my.itmo';
  }
  function status(message, error = false) {
    get('scheduleStatus').textContent = message;
    get('scheduleStatus').dataset.error = String(error);
  }
  function detail(parent, text) {
    if (!text) return;
    const line = document.createElement('p'); line.className = 'lesson-detail'; line.textContent = text; parent.append(line);
  }
  function render(now = new Date()) {
    if (!snapshot) return;
    get('scheduleLessons').replaceChildren();
    get('scheduleAccount').textContent = `Аккаунт ИСУ ${snapshot.account} · Московское время`;
    let nearest;
    for (const lesson of snapshot.lessons) {
      const phase = ItmoSchedule.progress(lesson, snapshot.date, now);
      if (!nearest && phase !== 'finished') nearest = { lesson, phase };
      const row = document.createElement('li'); row.className = 'schedule-lesson'; row.dataset.phase = phase;
      const time = document.createElement('div'); time.className = 'lesson-time'; time.textContent = lesson.start;
      const end = document.createElement('small'); end.textContent = lesson.end; time.append(end);
      const content = document.createElement('div');
      const subject = document.createElement('h2'); subject.className = 'lesson-subject'; subject.textContent = lesson.subject; content.append(subject);
      detail(content, lesson.type); detail(content, lesson.teacher);
      detail(content, [lesson.room && `Ауд. ${lesson.room}`, lesson.building].filter(Boolean).join(' · ')); detail(content, lesson.note);
      row.append(time, content); get('scheduleLessons').append(row);
    }
    const banner = get('scheduleNearest');
    banner.hidden = !nearest || snapshot.date !== ItmoSchedule.today(now);
    if (!banner.hidden) banner.textContent = `${nearest.phase === 'current' ? 'Сейчас' : `Следующая в ${nearest.lesson.start}`} · ${nearest.lesson.subject}`;
    const updated = new Intl.DateTimeFormat('ru', { timeZone: ItmoSchedule.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(snapshot.updatedAt));
    const plural = new Intl.PluralRules('ru').select(snapshot.lessons.length);
    const countLabel = { one: 'пара', few: 'пары', many: 'пар', other: 'пары' }[plural];
    status(snapshot.lessons.length ? `Обновлено в ${updated} · ${snapshot.lessons.length} ${countLabel}` : `На этот день пар нет · Обновлено в ${updated}`);
  }
  async function findTabs() {
    const current = await browser.windows.getCurrent();
    const origin = new URL(ItmoSchedule.origin);
    const found = await browser.tabs.query({ url: `${origin.protocol}//${origin.hostname}/*` });
    const tabs = found.filter(tab => tab.url?.startsWith(`${ItmoSchedule.origin}/`) && Boolean(tab.incognito) === Boolean(current.incognito))
      .sort((a, b) => Number(b.windowId === current.id) - Number(a.windowId === current.id) || Number(b.active) - Number(a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
    if (!tabs.some(tab => tab.id === selectedTab)) selectedTab = tabs[0]?.id;
    const select = get('scheduleTab'); select.replaceChildren();
    for (const [index, tab] of tabs.entries()) {
      const option = document.createElement('option'); option.value = String(tab.id);
      option.textContent = `Вкладка ${index + 1} · ${ItmoSchedule.text(tab.title, 60) || 'my.itmo'}`; select.append(option);
    }
    select.value = String(selectedTab);
    get('scheduleTabLabel').hidden = tabs.length < 2;
  }
  async function load() {
    const ticket = ++revision;
    clear(); status('Загружаем расписание…'); get('scheduleRefresh').disabled = true;
    try {
      const selectedDate = ItmoSchedule.date(get('scheduleDate').value);
      await findTabs();
      if (ticket !== revision) return;
      if (selectedTab === undefined) throw new Error('TAB');
      let response;
      try { response = await browser.tabs.sendMessage(selectedTab, { type: 'itmo:schedule', date: selectedDate }, { frameId: 0 }); }
      catch { throw new Error('TAB'); }
      if (ticket !== revision) return;
      if (!response?.ok) throw new Error(response?.code || 'NETWORK');
      snapshot = response; render();
      get('scheduleConnect').textContent = 'Открыть расписание на my.itmo ↗';
    } catch (error) {
      if (ticket !== revision) return;
      clear(); status(errors[error.message] || errors.NETWORK, true);
      get('scheduleConnect').textContent = 'Открыть my.itmo и войти ↗';
    } finally { if (ticket === revision) get('scheduleRefresh').disabled = false; }
  }
  get('scheduleDate').value = ItmoSchedule.today();
  get('scheduleRefresh').addEventListener('click', load);
  get('scheduleDate').addEventListener('change', load);
  get('scheduleTab').addEventListener('change', () => { selectedTab = Number(get('scheduleTab').value); load(); });
  for (const [id, amount] of [['schedulePrev', -1], ['scheduleNext', 1]]) {
    get(id).addEventListener('click', () => { get('scheduleDate').value = ItmoSchedule.shift(get('scheduleDate').value || ItmoSchedule.today(), amount); load(); });
  }
  get('scheduleToday').addEventListener('click', () => { get('scheduleDate').value = ItmoSchedule.today(); load(); });
  get('scheduleConnect').addEventListener('click', async () => {
    try {
      if (selectedTab !== undefined) {
        const tab = await browser.tabs.get(selectedTab);
        if (tab.url?.startsWith(`${ItmoSchedule.origin}/`)) {
          await browser.tabs.update(selectedTab, { active: true, url: `${ItmoSchedule.origin}/schedule` });
          await browser.windows.update(tab.windowId, { focused: true });
          return;
        }
      }
      await browser.tabs.create({ url: `${ItmoSchedule.origin}/schedule` });
    } catch { status('Не удалось открыть my.itmo. Откройте сайт вручную.', true); }
  });
  const interval = setInterval(() => render(), 30000);
  window.addEventListener('pagehide', () => clearInterval(interval), { once: true });
  browser.tabs.onRemoved.addListener(tabId => {
    if (tabId === selectedTab) { ++revision; clear(); status(errors.TAB, true); get('scheduleRefresh').disabled = false; }
  });
  load();
})();
