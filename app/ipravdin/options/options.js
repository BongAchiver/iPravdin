(() => {
  'use strict';
  let settings;
  let feedbackTimer;
  let queue = Promise.resolve();
  const get = id => document.getElementById(id);
  function feedback(message, error = false) {
    clearTimeout(feedbackTimer);
    get('feedback').textContent = message;
    get('feedback').dataset.error = String(error);
    if (!error) feedbackTimer = setTimeout(() => { get('feedback').textContent = ''; }, 2200);
  }
  function render() {
    document.body.dataset.active = String(settings.activate);
    get('heroStatus').textContent = settings.activate ? 'Включён · Правдин уже в интернете' : 'Выключен · Исходные изображения на месте';
    for (const key of ['activate', 'contextmenu', 'skipSmall']) {
      const input = get(key); if (input) { input.checked = settings[key]; input.disabled = false; }
    }
    const list = get('excludedList');
    if (!list) return;
    list.replaceChildren();
    for (const domain of settings.excluded) {
      const row = document.createElement('li');
      const name = document.createElement('span'); name.textContent = domain;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = '×'; button.setAttribute('aria-label', `Удалить ${domain} из исключений`);
      button.addEventListener('click', () => save(async () => {
        const current = PravdinSettings.normalize(await browser.storage.local.get());
        return { excluded: current.excluded.filter(item => item !== domain) };
      }));
      row.append(name, button); list.append(row);
    }
    get('emptyList').hidden = settings.excluded.length > 0;
    get('addDomain').disabled = false;
  }
  function save(change) {
    queue = queue.then(async () => {
      await browser.storage.local.set(typeof change === 'function' ? await change() : change);
      settings = PravdinSettings.normalize(await browser.storage.local.get());
      render(); feedback('Сохранено');
    }).catch(async error => {
      feedback(error.message || 'Не удалось сохранить настройки', true);
      settings = PravdinSettings.normalize(await browser.storage.local.get()); render();
    });
    return queue;
  }
  for (const key of ['activate', 'contextmenu', 'skipSmall']) {
    get(key)?.addEventListener('change', event => save({ [key]: event.target.checked }));
  }
  get('domainForm')?.addEventListener('submit', event => {
    event.preventDefault();
    let domain;
    try { domain = PravdinSettings.domain(get('domain').value); }
    catch (error) { feedback(error.message, true); return; }
    save(async () => {
      const current = PravdinSettings.normalize(await browser.storage.local.get());
      if (current.excluded.includes(domain)) throw new Error('Этот сайт уже в исключениях');
      if (current.excluded.length >= 200) throw new Error('Можно добавить до 200 сайтов');
      get('domain').value = '';
      return { excluded: [...current.excluded, domain] };
    });
  });
  get('openOptions')?.addEventListener('click', () => browser.runtime.openOptionsPage().catch(error => feedback(error.message, true)));
  browser.storage.onChanged.addListener((_, area) => {
    if (area === 'local') browser.storage.local.get().then(value => { settings = PravdinSettings.normalize(value); render(); }).catch(error => feedback(error.message, true));
  });
  browser.storage.local.get().then(value => { settings = PravdinSettings.normalize(value); render(); }).catch(error => feedback(error.message, true));
})();
