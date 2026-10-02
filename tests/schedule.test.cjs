const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
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

test('schedule normalization sorts lessons, strips unexpected data and distinguishes empty from malformed replies', () => {
  const early = { ...lesson, time_start: '08:20:00', time_end: '09:50:00', token: 'should-not-leave-page' };
  const normalized = plain(core.normalize(payload([lesson, early]), '2026-10-03'));
  assert.equal(normalized[0].start, '08:20');
  assert.equal(normalized[0].room, '321');
  assert.equal(JSON.stringify(normalized).includes('should-not-leave-page'), false);
  assert.equal(core.normalize(payload([]), '2026-10-03').length, 0);
  for (const invalid of [{ code: 1, data: [] }, { code: 0, data: {} }, payload([{ ...lesson, time_start: '25:00' }]), payload([{ ...lesson, time_end: '09:00' }])]) {
    assert.throws(() => core.normalize(invalid, '2026-10-03'));
  }
});

function contentFixture(client) {
  let listener;
  const window = { wrappedJSObject: { $nuxt: client } }; window.top = window;
  const context = vm.createContext({ window, location: { origin: core.origin }, cloneInto: value => value,
    setTimeout, clearTimeout, Date, ItmoSchedule: core,
    browser: { runtime: { id: 'test', getURL: value => `moz-extension://test/${value}`, onMessage: { addListener: fn => { listener = fn; } } } } });
  vm.runInContext(source('itmo-content.js'), context);
  return { request: (date = '2026-10-03', sender = { id: 'test', url: 'moz-extension://test/popup.html' }) => listener({ type: 'itmo:schedule', date }, sender) };
}

test('each request uses the current site account and never reads auth tokens', async () => {
  const client = { $auth: { loggedIn: true, user: { isu: 111 } }, $axios: { get: async url => {
    assert.equal(url, 'https://my.itmo.ru/api/schedule/schedule/personal?date_start=2026-10-03&date_end=2026-10-03');
    return { data: payload([{ ...lesson, subject: `Account ${client.$auth.user.isu}` }]) };
  } } };
  Object.defineProperty(client.$auth, 'strategy', { get() { throw new Error('Tokens must not be accessed'); } });
  const f = contentFixture(client);
  assert.equal((await f.request()).account, '111');
  client.$auth.user = { isu: 222 };
  const result = await f.request();
  assert.equal(result.account, '222');
  assert.equal(result.lessons[0].subject, 'Account 222');
});

test('account changes during a request discard its response', async () => {
  const client = { $auth: { loggedIn: true, user: { isu: 111 } }, $axios: { get: async () => {
    client.$auth.user = { isu: 222 }; return { data: payload() };
  } } };
  assert.deepEqual(plain(await contentFixture(client).request()), { ok: false, code: 'ACCOUNT_CHANGED' });
});

test('login errors expose no server error data and page senders cannot request a schedule', async () => {
  let calls = 0;
  const client = { $auth: { loggedIn: true, user: { isu: 111 } }, $axios: { get: async () => {
    ++calls; throw { response: { status: 401 }, config: { headers: { Authorization: 'secret' } }, message: 'secret' };
  } } };
  const f = contentFixture(client);
  assert.equal(f.request('2026-10-03', { id: 'test', url: 'https://my.itmo.ru/' }), undefined);
  assert.equal(calls, 0);
  assert.deepEqual(plain(await f.request()), { ok: false, code: 'LOGIN' });
  client.$auth.loggedIn = false;
  assert.deepEqual(plain(await f.request()), { ok: false, code: 'LOGIN' });
  assert.equal(calls, 1);
});

async function uiFixture(t, responses) {
  const dom = new JSDOM(fs.readFileSync('app/ipravdin/options/popup.html', 'utf8'), { url: 'moz-extension://test/popup.html', runScripts: 'outside-only' });
  const w = dom.window;
  t.after(() => { w.dispatchEvent(new w.Event('pagehide')); w.close(); });
  let calls = 0;
  w.browser = {
    windows: { getCurrent: async () => ({ id: 1, incognito: false }) },
    tabs: { query: async () => [{ id: 1, windowId: 1, active: true, url: 'https://my.itmo.ru/' }], onRemoved: { addListener() {} }, sendMessage: async () => responses[calls++]() }
  };
  w.eval(source('schedule.js')); w.eval(source('options/schedule-ui.js'));
  return { w, settle: () => new Promise(resolve => setTimeout(resolve, 20)), get calls() { return calls; } };
}

test('popup renders site markup as text and clears the old account on logout', async t => {
  const f = await uiFixture(t, [async () => ({ ok: true, account: '111', date: core.today(), updatedAt: Date.now(), lessons: [{ ...plain(core.normalize(payload(), '2026-10-03'))[0], subject: '<img src=x onerror=alert(1)>' }] }), async () => ({ ok: false, code: 'LOGIN' })]);
  await f.settle();
  assert.match(f.w.document.getElementById('scheduleAccount').textContent, /111/);
  assert.equal(f.w.document.querySelector('#scheduleLessons img'), null);
  assert.match(f.w.document.getElementById('scheduleLessons').textContent, /<img/);
  f.w.document.getElementById('scheduleRefresh').click(); await f.settle();
  assert.equal(f.w.document.getElementById('scheduleLessons').children.length, 0);
  assert.equal(f.w.document.getElementById('scheduleAccount').textContent.includes('111'), false);
  assert.match(f.w.document.getElementById('scheduleStatus').textContent, /Войдите/);
});

test('an earlier day response cannot overwrite a newer day request', async t => {
  let finishEarlier;
  const f = await uiFixture(t, [() => new Promise(resolve => { finishEarlier = resolve; }), async () => ({ ok: true, account: '222', date: core.shift(core.today(), 1), updatedAt: Date.now(), lessons: [] })]);
  await f.settle();
  f.w.document.getElementById('scheduleNext').click(); await f.settle();
  finishEarlier({ ok: true, account: '111', date: core.today(), updatedAt: Date.now(), lessons: [] }); await f.settle();
  assert.match(f.w.document.getElementById('scheduleAccount').textContent, /222/);
});
