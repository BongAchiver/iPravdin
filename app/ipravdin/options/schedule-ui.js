(() => {
  'use strict';
  const get = id => document.getElementById(id);
  const errors = {
    LOGIN: 'Войдите через ITMO ID. После входа расписание работает без вкладки my.itmo.',
    ACCOUNT_CHANGED: 'Аккаунт изменился. Обновите расписание.',
    FORMAT: 'Не удалось прочитать ответ ИТМО. Попробуйте обновить расписание.',
    DATE: 'Выберите корректную дату.',
    FORBIDDEN: 'ИТМО не разрешил доступ к расписанию для этого аккаунта.',
    NETWORK: 'Не удалось связаться с ИТМО. Проверьте интернет.'
  };
  let revision = 0;
  let snapshot;
  const privateWindow = browser.extension?.inIncognitoContext === true;
  function clear() {
    snapshot = undefined;
    get('scheduleLessons').replaceChildren(); get('scheduleNearest').hidden = true;
    get('scheduleAccount').textContent = 'Вход через ваш аккаунт ITMO ID';
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
    get('scheduleLogout').hidden = false;
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
    const updated = new Intl.DateTimeFormat('ru', { timeZone: ItmoSchedule.timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(snapshot.updatedAt));
    const plural = new Intl.PluralRules('ru').select(snapshot.lessons.length);
    const count = `${snapshot.lessons.length} ${{ one: 'пара', few: 'пары', many: 'пар', other: 'пары' }[plural]}`;
    if (snapshot.cached) status(`Сохранено ${updated} · ${snapshot.needsLogin ? 'Сессия истекла, войдите снова' : 'Нет связи с ИТМО'}`, true);
    else status(`${snapshot.lessons.length ? count : 'На этот день пар нет'} · Обновлено ${updated}`);
  }
  async function load() {
    const ticket = ++revision;
    clear(); get('scheduleRefresh').disabled = true;
    if (privateWindow) {
      status('Расписание с сохранённой сессией доступно в обычном окне Firefox.');
      get('scheduleConnect').disabled = true; get('scheduleRefresh').disabled = false; return;
    }
    status('Загружаем расписание…');
    try {
      const state = await browser.runtime.sendMessage({ type: 'itmo:status' });
      if (ticket !== revision) return;
      get('scheduleConnect').textContent = state.connected ? 'Сменить аккаунт ITMO ID ↗' : 'Войти через ITMO ID ↗';
      get('scheduleLogout').hidden = !state.connected && !state.pending;
      if (state.pending) { status('Завершите вход в открывшемся окне ITMO ID.'); return; }
      if (state.error) { status(state.error, true); return; }
      const selectedDate = ItmoSchedule.date(get('scheduleDate').value);
      const response = await browser.runtime.sendMessage({ type: 'itmo:schedule', date: selectedDate });
      if (ticket !== revision) return;
      if (!response?.ok) throw new Error(response?.code || 'NETWORK');
      snapshot = response; render();
    } catch (error) {
      if (ticket === revision) { clear(); status(errors[error.message] || errors.NETWORK, true); }
    } finally { if (ticket === revision) get('scheduleRefresh').disabled = false; }
  }
  get('scheduleDate').value = ItmoSchedule.today();
  get('scheduleRefresh').addEventListener('click', load);
  get('scheduleDate').addEventListener('change', load);
  for (const [id, amount] of [['schedulePrev', -1], ['scheduleNext', 1]]) {
    get(id).addEventListener('click', () => { get('scheduleDate').value = ItmoSchedule.shift(get('scheduleDate').value || ItmoSchedule.today(), amount); load(); });
  }
  get('scheduleToday').addEventListener('click', () => { get('scheduleDate').value = ItmoSchedule.today(); load(); });
  get('scheduleConnect').addEventListener('click', async () => {
    const ticket = ++revision; clear(); status('Открываем вход в ITMO ID…');
    try {
      const response = await browser.runtime.sendMessage({ type: 'itmo:login' });
      if (ticket !== revision) return;
      if (!response?.ok) throw new Error('NETWORK');
      status('Завершите вход в окне ITMO ID. Затем снова откройте расширение.');
    } catch { if (ticket === revision) status(errors.NETWORK, true); }
  });
  get('scheduleLogout').addEventListener('click', async () => {
    ++revision; clear(); get('scheduleLogout').hidden = true;
    get('scheduleConnect').textContent = 'Войти через ITMO ID ↗';
    status('Удаляем сессию и сохранённое расписание…');
    try { await browser.runtime.sendMessage({ type: 'itmo:logout' }); status(errors.LOGIN); }
    catch { status('Не удалось завершить выход. Попробуйте ещё раз.', true); }
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ('itmoSession' in changes || 'itmoAuthError' in changes)) load();
    if (area === 'session' && 'itmoAuthPending' in changes) load();
  });
  const interval = setInterval(() => render(), 30000);
  window.addEventListener('pagehide', () => clearInterval(interval), { once: true });
  load();
})();
