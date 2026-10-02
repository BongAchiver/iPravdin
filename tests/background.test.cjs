const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('upgrading removes retired authentication data and preserves image settings', async () => {
  const settings = { activate: false, contextmenu: true, skipSmall: false, excluded: ['example.org'] };
  const local = { ...settings, itmoSession: { refreshToken: 'obsolete-test-token' }, itmoCache: { days: {} }, itmoAuthError: 'old error' };
  const session = { itmoAuthPending: { state: 'obsolete-test-state' } };
  let installed;
  const storage = data => ({
    get: async keys => Object.fromEntries(keys.filter(key => key in data).map(key => [key, data[key]])),
    remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }
  });
  const context = vm.createContext({ console, browser: {
    storage: { local: storage(local), session: storage(session), onChanged: { addListener() {} } },
    runtime: { onInstalled: { addListener(fn) { installed = fn; } }, onStartup: { addListener() {} } },
    contextMenus: { removeAll: async () => {}, create() {}, onClicked: { addListener() {} } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} }
  } });
  vm.runInContext(fs.readFileSync('app/ipravdin/settings.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('app/ipravdin/bg.js', 'utf8'), context);
  await installed();
  assert.deepEqual(local, settings);
  assert.deepEqual(session, {});
});
