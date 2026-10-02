const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');
const { JSDOM } = require('jsdom');
const source = name => fs.readFileSync(`app/ipravdin/${name}`, 'utf8');
const coreContext = vm.createContext({ URL, Intl, Date });
vm.runInContext(source('schedule.js'), coreContext);
const core = coreContext.ItmoSchedule;
const lesson = { time_start: '10:00', time_end: '11:30', subject: 'Алгоритмы', teacher_name: 'Иванов', room: 321, building: 'Кронверкский', work_type: 'Практика' };
const payload = (lessons = [lesson]) => ({ code: 0, data: [{ date: '2026-10-03', lessons }] });
const plain = value => JSON.parse(JSON.stringify(value));

test('schedule dates and lesson progress use Moscow time and handle day boundaries', () => {
  assert.equal(core.today(new Date('2026-10-02T21:30:00Z')), '2026-10-03');
  assert.equal(core.shift('2026-12-31', 1), '2027-01-01');
  assert.equal(core.shift('2024-02-28', 1), '2024-02-29');
  assert.throws(() => core.date('2026-02-29'));
  assert.throws(() => core.date('2026-10-03&other=1'));
  const normalized = core.normalize(payload(), '2026-10-03')[0];
  assert.equal(core.progress(normalized, '2026-10-03', new Date('2026-10-03T06:59:00Z')), 'upcoming');
  assert.equal(core.progress(normalized, '2026-10-03', new Date('2026-10-03T07:00:00Z')), 'current');
  assert.equal(core.progress(normalized, '2026-10-03', new Date('2026-10-03T08:30:00Z')), 'finished');
});
test('normalization strips unexpected fields and distinguishes empty from malformed replies', () => {
  const early = { ...lesson, time_start: '08:20:00', time_end: '09:50:00', token: 'private-field' };
  const normalized = plain(core.normalize(payload([lesson, early]), '2026-10-03'));
  assert.equal(normalized[0].start, '08:20');
  assert.equal(normalized[0].room, '321');
  assert.equal(JSON.stringify(normalized).includes('private-field'), false);
  assert.equal(core.normalize(payload([]), '2026-10-03').length, 0);
  for (const invalid of [{ code: 1, data: [] }, { code: 0, data: {} }, { code: 0, data: [{ lessons: [lesson] }] }, payload([{ ...lesson, time_start: '25:00' }]), payload([{ ...lesson, time_end: '09:00' }])]) assert.throws(() => core.normalize(invalid, '2026-10-03'));
});

function clientFixture({ local = {}, fetch } = {}) {
  const session = {};
  let intercept, handler, removed, authURL;
  const storage = data => ({
    get: async key => key ? Object.fromEntries((Array.isArray(key) ? key : [key]).filter(k => k in data).map(k => [k, structuredClone(data[k])])) : structuredClone(data),
    set: async values => Object.assign(data, structuredClone(values)),
    remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }
  });
  const browser = {
    storage: { local: storage(local), session: storage(session) },
    runtime: { id: 'test', getURL: value => `moz-extension://test/${value}`, onMessage: { addListener: fn => { handler = fn; } } },
    windows: { create: async () => ({ id: 50, tabs: [{ id: 70 }] }), remove: async id => { if (removed) await removed(id); }, onRemoved: { addListener: fn => { removed = fn; } } },
    tabs: { update: async (_, values) => { authURL = values.url; } },
    alarms: { create() {}, onAlarm: { addListener() {} } },
    webRequest: { onBeforeRequest: { addListener: fn => { intercept = fn; } } }
  };
  const context = vm.createContext({ browser, ItmoSchedule: core, URL, URLSearchParams, crypto: webcrypto, TextEncoder, AbortSignal,
    Date, btoa: value => Buffer.from(value, 'binary').toString('base64'), fetch: fetch || (async () => { throw new Error('Offline fixture'); }) });
  vm.runInContext(source('itmo-client.js'), context);
  return { api: context.ItmoClient, local, session, browser, get authURL() { return authURL; },
    intercept: details => intercept(details), request: (message, sender = { id: 'test', url: 'moz-extension://test/popup.html' }) => handler(message, sender) };
}
const saved = (account = '111') => ({ key: `session-${account}`, account, subject: `subject-${account}`, accessToken: `access-${account}`, refreshToken: `refresh-${account}`, expiresAt: Date.now() + 3600000, refreshExpiresAt: Date.now() + 86400000 });
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

test('schedule loads with no tabs and a persisted local session after a background restart', async () => {
  const local = { itmoSession: saved() };
  const f = clientFixture({ local, fetch: async (url, options) => {
    assert.equal(url, 'https://my.itmo.ru/api/schedule/schedule/personal?date_start=2026-10-03&date_end=2026-10-09');
    assert.equal(options.headers.Authorization, 'Bearer access-111');
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    return response(payload());
  } });
  const result = await f.api.schedule('2026-10-03');
  assert.equal(result.ok, true); assert.equal(result.account, '111');
  assert.equal(JSON.stringify(result).includes('access-111'), false);
  const restarted = clientFixture({ local });
  const cached = await restarted.api.schedule('2026-10-03');
  assert.equal(cached.ok, true); assert.equal(cached.cached, true); assert.equal(cached.lessons[0].subject, 'Алгоритмы');
});

test('concurrent requests rotate an expired token only once and verify the account', async () => {
  const local = { itmoSession: { ...saved(), expiresAt: 0 } };
  let refreshes = 0;
  const f = clientFixture({ local, fetch: async (url, options) => {
    if (url.endsWith('/token')) {
      ++refreshes; assert.equal(new URLSearchParams(options.body).get('grant_type'), 'refresh_token');
      await new Promise(resolve => setTimeout(resolve, 15));
      return response({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, refresh_expires_in: 86400, token_type: 'Bearer' });
    }
    assert.equal(options.headers.Authorization, 'Bearer new-access');
    if (url.endsWith('/userinfo')) return response({ isu: 111, sub: 'subject-111' });
    return response(payload());
  } });
  const results = await Promise.all([f.api.schedule('2026-10-03'), f.api.schedule('2026-10-03')]);
  assert.equal(refreshes, 1); assert.equal(results.every(result => result.ok), true);
  assert.equal(local.itmoSession.refreshToken, 'new-refresh');
});

test('network and expired-session fallbacks clearly mark cached data', async () => {
  const local = { itmoSession: { ...saved(), expiresAt: 0 }, itmoCache: { account: '111', subject: 'subject-111', days: { '2026-10-03': { updatedAt: 1, lessons: [plain(core.normalize(payload(), '2026-10-03'))[0]] } } } };
  const f = clientFixture({ local, fetch: async () => response({}, 400) });
  const result = await f.api.schedule('2026-10-03');
  assert.equal(result.cached, true); assert.equal(result.needsLogin, true);
  assert.equal(local.itmoSession, undefined);
  assert.equal((await f.api.schedule('2026-10-04')).code, 'LOGIN');
});

test('switching accounts discards an in-flight response and logout removes tokens and cache', async () => {
  const local = { itmoSession: saved() };
  let release;
  const f = clientFixture({ local, fetch: async url => {
    if (url.endsWith('/revoke')) return response({});
    return new Promise(resolve => { release = () => resolve(response(payload())); });
  } });
  const pending = f.api.schedule('2026-10-03');
  await new Promise(resolve => setTimeout(resolve, 10));
  await f.api.logout(); release();
  assert.equal((await pending).code, 'ACCOUNT_CHANGED');
  assert.equal(local.itmoSession, undefined); assert.equal(local.itmoCache, undefined);
});

test('OAuth uses PKCE and captures only its own window with a matching state', async () => {
  let exchanges = 0;
  const f = clientFixture({ fetch: async (url, options) => {
    if (url.endsWith('/token')) {
      ++exchanges;
      const form = new URLSearchParams(options.body);
      const auth = new URL(f.authURL);
      assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), auth.searchParams.get('code_challenge'));
      assert.equal(form.get('redirect_uri'), `${core.origin}/login/callback`);
      return response({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600, refresh_expires_in: 86400 });
    }
    return response({ isu: 111, sub: 'subject-111' });
  } });
  await f.api.login();
  const state = new URL(f.authURL).searchParams.get('state');
  const url = `${core.origin}/login/callback?code=fixture-code&state=${state}`;
  assert.deepEqual(plain(await f.intercept({ tabId: 99, type: 'main_frame', url })), {});
  assert.equal(exchanges, 0);
  assert.equal((await f.intercept({ tabId: 70, type: 'main_frame', url })).cancel, true);
  assert.equal(exchanges, 1); assert.equal(f.local.itmoSession.account, '111');
  assert.equal(f.session.itmoAuthPending, undefined);
});

test('a mismatched OAuth state never exchanges a code or persists credentials', async () => {
  let calls = 0;
  const f = clientFixture({ fetch: async () => { ++calls; return response({}); } });
  await f.api.login();
  await f.intercept({ tabId: 70, type: 'main_frame', url: `${core.origin}/login/callback?code=fixture&state=wrong` });
  assert.equal(calls, 0); assert.equal(f.local.itmoSession, undefined); assert.equal(typeof f.local.itmoAuthError, 'string');
});

test('page senders cannot access sessions and background replies contain no credentials', async () => {
  const f = clientFixture({ local: { itmoSession: saved() } });
  assert.equal(f.request({ type: 'itmo:status' }, { id: 'test', url: 'https://my.itmo.ru/' }), undefined);
  const state = await f.request({ type: 'itmo:status' });
  assert.equal(state.account, '111'); assert.equal(JSON.stringify(state).includes('access-111'), false);
});

async function uiFixture(t, responses, state = () => ({ ok: true, connected: true })) {
  const dom = new JSDOM(fs.readFileSync('app/ipravdin/options/popup.html', 'utf8'), { url: 'moz-extension://test/popup.html', runScripts: 'outside-only' });
  const w = dom.window;
  t.after(() => { w.dispatchEvent(new w.Event('pagehide')); w.close(); });
  let calls = 0;
  let storageChanged;
  w.browser = {
    storage: { onChanged: { addListener(fn) { storageChanged = fn; } } },
    runtime: { sendMessage: async message => message.type === 'itmo:status' ? state() : responses[calls++]() }
  };
  w.eval(source('schedule.js')); w.eval(source('options/schedule-ui.js'));
  return { w, changed: (changes, area) => storageChanged(changes, area), settle: () => new Promise(resolve => setTimeout(resolve, 20)) };
}

test('popup loads pairs when the login window finishes after the session was saved', async t => {
  let pending = true;
  const f = await uiFixture(t, [async () => ({ ok: true, account: '111', date: core.today(), updatedAt: Date.now(), lessons: plain(core.normalize(payload(), '2026-10-03')) })], () => ({ ok: true, connected: true, pending }));
  await f.settle();
  assert.match(f.w.document.getElementById('scheduleStatus').textContent, /Завершите вход/);
  pending = false;
  f.changed({ itmoAuthPending: { oldValue: {} } }, 'session');
  await f.settle();
  assert.equal(f.w.document.querySelectorAll('.schedule-lesson').length, 1);
  assert.match(f.w.document.getElementById('scheduleAccount').textContent, /111/);
});
test('popup renders markup as text and clears the old account after a login error', async t => {
  const f = await uiFixture(t, [async () => ({ ok: true, account: '111', date: core.today(), updatedAt: Date.now(), lessons: [{ ...plain(core.normalize(payload(), '2026-10-03'))[0], subject: '<img src=x onerror=alert(1)>' }] }), async () => ({ ok: false, code: 'LOGIN' })]);
  await f.settle();
  assert.match(f.w.document.getElementById('scheduleAccount').textContent, /111/);
  assert.equal(f.w.document.querySelector('#scheduleLessons img'), null);
  f.w.document.getElementById('scheduleRefresh').click(); await f.settle();
  assert.equal(f.w.document.getElementById('scheduleLessons').children.length, 0);
  assert.equal(f.w.document.getElementById('scheduleAccount').textContent.includes('111'), false);
  assert.match(f.w.document.getElementById('scheduleStatus').textContent, /Войдите/);
});
test('an earlier day response cannot overwrite a newer day request', async t => {
  let finishEarlier;
  const f = await uiFixture(t, [() => new Promise(resolve => { finishEarlier = resolve; }), async () => ({ ok: true, account: '222', date: core.shift(core.today(), 1), updatedAt: Date.now(), lessons: [] })]);
  await f.settle(); f.w.document.getElementById('scheduleNext').click(); await f.settle();
  finishEarlier({ ok: true, account: '111', date: core.today(), updatedAt: Date.now(), lessons: [] }); await f.settle();
  assert.match(f.w.document.getElementById('scheduleAccount').textContent, /222/);
});
test('cached pairs remain visible while the popup clearly requests a new login', async t => {
  const f = await uiFixture(t, [async () => ({ ok: true, account: '111', date: core.today(), updatedAt: Date.now(), cached: true, needsLogin: true, lessons: plain(core.normalize(payload(), '2026-10-03')) })]);
  await f.settle();
  assert.equal(f.w.document.querySelectorAll('.schedule-lesson').length, 1);
  assert.match(f.w.document.getElementById('scheduleStatus').textContent, /Сохранено.*Сессия истекла/);
});
