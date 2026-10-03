const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const read = name => fs.readFileSync(`app/ipravdin/${name}`, 'utf8');
test('each of the 15 collectibles is reachable in its rarity and has a separate packaged JPEG', () => {
  const context = vm.createContext({ URL }); vm.runInContext(read('game.js'), context); const G = context.PravdinGame;
  const draws = [.3, .7, .95, .99]; const sizes = [5, 5, 3, 2]; const reached = new Set();
  sizes.forEach((size, tier) => {
    for (let i = 0; i < size; i++) {
      const s = G.roll(draws[tier], (i + .5) / size);
      assert.equal(s.tier, tier); reached.add(s.id);
      const data = fs.readFileSync(`app/${s.image}`); assert.equal(data.readUInt16BE(0), 0xffd8); assert.ok(data.length > 1000);
    }
  });
  assert.equal(reached.size, 15); assert.equal(new Set(G.species.map(s => s.image)).size, 15);
  for (const [r, tier] of [[.6499, 0], [.65, 1], [.9, 2], [.985, 3]]) assert.equal(G.roll(r, 0).tier, tier);
});
test('the event distribution is 55% quiz, 25% collectible, 20% observation', () => {
  const context = vm.createContext({ URL }); vm.runInContext(read('game.js'), context);
  const counts = { quiz: 0, rare: 0, watch: 0 };
  for (let i = 0; i < 10000; i++) counts[context.PravdinGame.eventKind((i + .5) / 10000)]++;
  assert.deepEqual(counts, { quiz: 5500, rare: 2500, watch: 2000 });
});
function fixture(initial = {}) {
  const data = structuredClone(initial);
  let listener;
  let now = Date.now();
  const NativeDate = Date;
  const context = vm.createContext({ URL, console, Date: class extends NativeDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }, browser: {
    storage: { local: { get: async keys => structuredClone(Object.fromEntries(keys.filter(k => k in data).map(k => [k, data[k]]))), set: async values => Object.assign(data, structuredClone(values)) } },
    runtime: { onMessage: { addListener(fn) { listener = fn; } } }
  } });
  for (const file of ['settings.js', 'game.js', 'game-bg.js']) vm.runInContext(read(file), context);
  const sender = { tab: { id: 1 }, url: 'https://example.org/' };
  return { data, G: context.PravdinGame, advance: ms => { now += ms; }, send: (action, args = {}, origin = sender) => listener({ channel: 'pravdin-game', action, ...args }, origin) };
}
test('concurrent answers award points once and cannot be submitted by another tab', async () => {
  const f = fixture(); const start = await f.send('quiz'); const e = start.state.encounter;
  assert.ok((await f.send('answer', { id: e.id, answer: e.question.correct }, { tab: { id: 2 }, url: 'https://example.org/' })).error);
  const replies = await Promise.all([f.send('answer', { id: e.id, answer: e.question.correct }), f.send('answer', { id: e.id, answer: e.question.correct })]);
  assert.equal(replies.filter(r => r.error).length, 1);
  assert.equal(f.data.gameState.xp, 10); assert.equal(f.data.gameState.solved, 1); assert.equal(f.data.gameState.attempted, 1);
});
test('wrong answers and skips change mood and streak without awarding XP', async () => {
  const f = fixture(); let r = await f.send('quiz'); let e = r.state.encounter;
  r = await f.send('answer', { id: e.id, answer: (e.question.correct + 1) % e.question.answers.length });
  assert.equal(r.state.mood, 54); assert.equal(r.state.attempted, 1); assert.equal(r.state.xp, 0); assert.match(r.text, /Правильный ответ/);
  e = (await f.send('quiz')).state.encounter;
  r = await f.send('skip', { id: e.id }); assert.equal(r.state.mood, 51); assert.equal(r.state.encounter, null);
});
test('a ticket uses three distinct questions, gives a completion bonus, and is daily', async () => {
  const f = fixture(); let r = await f.send('ticket'); const ids = new Set();
  for (let i = 0; i < 3; i++) { const e = r.state.encounter; ids.add(e.question.id); r = await f.send('answer', { id: e.id, answer: e.question.correct }); }
  assert.equal(ids.size, 3); assert.equal(r.state.encounter, null); assert.equal(r.state.xp, 50); assert.match(r.text, /Зачёт/);
  assert.ok((await f.send('ticket')).error); f.advance(86400000); assert.ok((await f.send('ticket')).state.encounter);
});
test('pets and tea have cooldowns and disabled games and excluded sites cannot earn rewards', async () => {
  const f = fixture(); await f.send('pet'); await f.send('pet'); assert.equal(f.data.gameState.pets, 1); assert.equal(f.data.gameState.mood, 63);
  f.advance(30000); await f.send('pet'); assert.equal(f.data.gameState.pets, 2);
  await f.send('tea'); await f.send('tea'); assert.equal(f.data.gameState.mood, 68);
  f.data.excluded = ['example.org']; assert.ok((await f.send('pet')).error); assert.ok((await f.send('quiz')).error);
  delete f.data.excluded; await f.send('prefs', { value: { enabled: false, interval: 10 } }); assert.ok((await f.send('quiz')).error);
});
test('automatic events share a cooldown across tabs and expired encounters can be replaced', async () => {
  const f = fixture(); assert.equal((await f.send('claim')).state.encounter, null);
  f.advance(61 * 60000); const r = await f.send('claim'); assert.ok(r.state.encounter);
  assert.ok((await f.send('claim', {}, { tab: { id: 2 }, url: 'https://example.org/' })).error);
  f.advance(16 * 60000); assert.ok((await f.send('quiz', {}, { tab: { id: 2 }, url: 'https://example.org/' })).state.encounter);
});
test('a quest is rewarded only on the matching article and only once', async () => {
  const f = fixture(); const q = (await f.send('quest')).state.quest;
  assert.ok((await f.send('found', { id: q.id })).error);
  const origin = { tab: { id: 1 }, url: encodeURI(q.url) + '#section' };
  const r = await f.send('found', { id: q.id }, origin); assert.equal(r.state.found, 1); assert.equal(r.state.xp, 25);
  assert.ok((await f.send('found', { id: q.id }, origin)).error);
});
test('rare encounters are collected once; quiz encounters cannot be collected', async () => {
  const f = fixture(); const e = (await f.send('quiz')).state.encounter;
  assert.ok((await f.send('catch', { id: e.id })).error); await f.send('skip', { id: e.id });
  f.data.gameState.encounter = { id: 'rare-test', tab: 1, kind: 'rare', species: 'legend', expires: Date.now() + 60000 };
  const r = await f.send('catch', { id: 'rare-test' }); assert.equal(r.state.collection.legend, 1); assert.equal(r.state.xp, 15);
  assert.ok((await f.send('catch', { id: 'rare-test' })).error);
});
test('practice renders answers, explains the result, and removes its overlay when disabled', async () => {
  const f = fixture();
  const dom = new JSDOM('<body></body>', { url: 'moz-extension://test/ipravdin/options/practice.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; const listeners = [];
  const attach = w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow = function () { return attach.call(this, { mode: 'open' }); };
  w.browser = { runtime: { getURL: p => `moz-extension://test/${p}`, onMessage: { addListener() {} }, sendMessage: m => f.send(m.action, m, { url: w.location.href }) }, storage: { local: { get: async () => structuredClone(f.data) }, onChanged: { addListener(fn) { listeners.push(fn); } } } };
  w.eval(read('settings.js')); w.eval(read('game.js')); w.eval(read('game-content.js'));
  const settle = () => new Promise(resolve => setTimeout(resolve, 50));
  try {
    await settle(); const root = w.document.getElementById('ipravdin-encounter').shadowRoot;
    const e = f.data.gameState.encounter;
    root.querySelectorAll('.answers button')[e.question.correct].click(); await settle();
    assert.match(root.textContent, /Правильный ответ/); assert.equal(f.data.gameState.solved, 1);
    f.data.gamePrefs = { enabled: false }; for (const fn of listeners) fn({ gamePrefs: { newValue: f.data.gamePrefs } }, 'local'); await settle();
    assert.equal(w.document.getElementById('ipravdin-encounter'), null);
  } finally { w.dispatchEvent(new w.Event('pagehide')); w.close(); }
});
