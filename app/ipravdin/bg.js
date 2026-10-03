'use strict';
let updates = Promise.resolve();
function refresh() {
  updates = updates.then(async () => {
    const settings = PravdinSettings.normalize(await browser.storage.local.get(Object.keys(PravdinSettings.defaults)));
    await browser.contextMenus.removeAll();
    if (settings.contextmenu) {
      browser.contextMenus.create({ id: 'toggle', contexts: ['page', 'image'], title: settings.activate ? 'Выключить iPravdin' : 'Включить iPravdin' });
      browser.contextMenus.create({ id: 'settings', contexts: ['page', 'image'], title: 'Настройки iPravdin' });
    }
    await browser.action.setBadgeText({ text: settings.activate ? '' : 'OFF' });
    await browser.action.setBadgeBackgroundColor({ color: '#6854d9' });
  }).catch(error => console.error('iPravdin: settings update failed', error));
}
browser.storage.onChanged.addListener((changes, area) => { if (area === 'local' && Object.keys(changes).some(key => key in PravdinSettings.defaults)) refresh(); });
browser.runtime.onInstalled.addListener(async () => {
  // Remove local credentials and cached data left by the retired schedule feature.
  await browser.storage.local.remove(['itmoSession', 'itmoCache', 'itmoAuthError']);
  await browser.storage.session.remove('itmoAuthPending');
  refresh();
});
browser.runtime.onStartup.addListener(refresh);
browser.contextMenus.onClicked.addListener(async info => {
  try {
    if (info.menuItemId === 'settings') await browser.runtime.openOptionsPage();
    if (info.menuItemId === 'toggle') {
      const settings = PravdinSettings.normalize(await browser.storage.local.get(Object.keys(PravdinSettings.defaults)));
      await browser.storage.local.set({ activate: !settings.activate });
    }
  } catch (error) { console.error('iPravdin: menu action failed', error); }
});
refresh();
