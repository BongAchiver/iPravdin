const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const read = name => (name === 'game.js' ? ['game-bank.js', 'game-lines.js', name] : [name]).map(file => fs.readFileSync(`app/ipravdin/${file}`, 'utf8')).join('\n');
test('the expanded bank has unique questions, valid alternatives and preserved original IDs', () => {
  const context = vm.createContext({ URL }); vm.runInContext(read('game.js'), context); const G = context.PravdinGame;
  assert.equal(G.questions.length, 404);
  assert.equal(new Set(G.questions.map(q => q.text)).size, G.questions.length);
  assert.equal(new Set(G.questions.map(q => q.category)).size, 13);
  assert.equal(G.questions[0].category, 'Кванторы'); assert.match(G.questions[19].text, /Непрерывность/);
  for (const q of G.questions) {
    assert.equal(new Set(q.answers).size, q.answers.length, q.text);
    assert.ok(q.answers.length >= 2 && q.correct >= 0 && q.correct < q.answers.length, q.text);
    assert.ok(q.explanation.trim().length > 0, q.text);
    const mixed = G.shuffled(q); assert.equal(mixed.answers[mixed.correct], q.answers[q.correct]);
  }
});
test('numerical answers agree with independent evaluations of limits, integrals and series', () => {
  const context = vm.createContext({ URL }); vm.runInContext(read('game.js'), context); const G = context.PravdinGame;
  const value = s => { const [a, b = 1] = s.split('/').map(Number); return a / b; };
  let checked = 0;
  for (const q of G.questions) {
    let m, actual;
    if ((m = q.text.match(/^lim sin\((\d+)x\)\/x/))) actual = Math.sin(Number(m[1]) * 1e-6) / 1e-6;
    else if ((m = q.text.match(/^lim \(1−cos\((\d+)x\)\)\/x²/))) actual = 2 * (Math.sin(Number(m[1]) * 1e-4 / 2) / 1e-4) ** 2;
    else if ((m = q.text.match(/^lim \(√\(n²\+(\d+)n\)−n\)/))) actual = Math.sqrt(1e12 + Number(m[1]) * 1e6) - 1e6;
    else if ((m = q.text.match(/^Вычислите ∫₀¹ x\^(\d+) dx/))) { actual = 0; for (let i = 0; i < 10000; i++) actual += ((i + .5) / 10000) ** Number(m[1]) / 10000; }
    else if ((m = q.text.match(/^Найдите сумму Σₙ₌₀∞ \(1\/(\d+)\)ⁿ/))) { actual = 0; for (let i = 0; i < 60; i++) actual += (1 / Number(m[1])) ** i; }
    else if ((m = q.text.match(/^lim n ln\(1\+(\d+)\/n\)/))) actual = 1e7 * Math.log1p(Number(m[1]) / 1e7);
    else continue;
    assert.ok(Math.abs(actual - value(q.answers[q.correct])) < .001, q.text); checked++;
  }
  assert.equal(checked, 120);
});
test('question cycles survive serialization and never repeat before the bank is exhausted', () => {
  const context = vm.createContext({ URL }); vm.runInContext(read('game.js'), context); const G = context.PravdinGame;
  let state = G.empty(), previous;
  for (let cycle = 0; cycle < 2; cycle++) {
    const seen = new Set();
    for (let i = 0; i < G.questions.length; i++) {
      const q = G.nextQuestion(state); assert.notEqual(q.id, previous); assert.ok(!seen.has(q.id)); seen.add(q.id); previous = q.id;
      state = JSON.parse(JSON.stringify(state));
    }
    assert.equal(seen.size, G.questions.length);
  }
  state.draws.questions = []; const q = G.nextQuestion(state, [0, 1, 2]); assert.ok(![0, 1, 2].includes(q.id));
});
test('dialogue has 305 lines, complete nonrepeating cycles and mood-specific conversations', () => {
  const context = vm.createContext({ URL }); vm.runInContext(read('game.js'), context); const G = context.PravdinGame;
  assert.equal(Object.values(G.lines).flat().length, 305);
  for (const kind of Object.keys(G.lines).filter(k => !['talkHappy', 'talkStern'].includes(k))) {
    let state = G.empty(), previous;
    for (let cycle = 0; cycle < 2; cycle++) {
      const seen = new Set();
      for (let i = 0; i < G.lines[kind].length; i++) {
        const text = G.phrase(state, kind); assert.notEqual(text, previous); assert.ok(!seen.has(text), kind); seen.add(text); previous = text;
        state = JSON.parse(JSON.stringify(state));
      }
    }
  }
  for (const [mood, extra] of [[90, 'talkHappy'], [10, 'talkStern']]) {
    const state = { mood }; const seen = new Set();
    for (let i = 0; i < G.lines.talk.length + G.lines[extra].length; i++) seen.add(G.phrase(state, 'talk'));
    assert.ok(G.lines[extra].every(s => seen.has(s)));
  }
});
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
  let installed;
  let now = Date.now();
  const NativeDate = Date;
  const context = vm.createContext({ URL, console, Date: class extends NativeDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }, browser: {
    storage: { local: { get: async keys => structuredClone(Object.fromEntries(keys.filter(k => k in data).map(k => [k, data[k]]))), set: async values => Object.assign(data, structuredClone(values)) } },
    runtime: { onMessage: { addListener(fn) { listener = fn; } }, onInstalled: { addListener(fn) { installed = fn; } } }
  } });
  for (const file of ['settings.js', 'game.js', 'game-bg.js']) vm.runInContext(read(file), context);
  const sender = { tab: { id: 1 }, url: 'https://example.org/' };
  return { data, G: context.PravdinGame, install: () => installed(), now: () => now, advance: ms => { now += ms; }, send: (action, args = {}, origin = sender) => listener({ channel: 'pravdin-game', action, ...args }, origin) };
}
test('background preserves question and dialogue decks across a restart', async () => {
  let f = fixture(); const seen = new Set(), lines = new Set();
  for (let i = 0; i < 40; i++) {
    const q = (await f.send('quiz')).state.encounter; assert.ok(!seen.has(q.question.id)); seen.add(q.question.id);
    await f.send('skip', { id: q.id });
    // Hold mood steady to check a full conversation context across restarts.
    f.data.gameState.mood = 60;
    const r = await f.send('talk'); assert.ok(!lines.has(r.text)); lines.add(r.text);
    if (i === 19) f = fixture(f.data);
  }
  assert.equal(seen.size, 40); assert.equal(lines.size, 40);
});
test('a ticket crossing the question-deck boundary still contains three distinct questions', async () => {
  const f = fixture({ gameState: { draws: { questions: [0] }, lastDraw: { questions: 1 } } });
  let r = await f.send('ticket'); const ids = [];
  for (let i = 0; i < 3; i++) { const e = r.state.encounter; ids.push(e.question.id); r = await f.send('answer', { id: e.id, answer: e.question.correct }); }
  assert.equal(ids[0], 0); assert.equal(new Set(ids).size, 3); assert.equal(r.state.xp, 50);
  assert.ok(r.state.draws.questions.includes(0), 'deferred question stays available after the ticket ends');
});
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
test('manual practice renders answers and explanations even with images and automatic events disabled', async () => {
  const f = fixture({ activate: false, gamePrefs: { enabled: false } });
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
    assert.ok(w.document.getElementById('ipravdin-encounter'));
  } finally { w.dispatchEvent(new w.Event('pagehide')); w.close(); }
});

test('the default cadence is exactly five minutes and upgrades shorten old scheduled waits', async () => {
  const f = fixture(); let r = await f.send('claim'); assert.equal(r.prefs.interval, 5); assert.equal(r.state.nextAt - f.now(), 300000);
  f.advance(299999); assert.equal((await f.send('claim')).state.encounter, null); f.advance(1); assert.ok((await f.send('claim')).state.encounter);
  const upgrade = fixture({ gamePrefs: { enabled: false, interval: 30 }, gameState: { xp: 123, nextAt: Date.now() + 1800000 } });
  await upgrade.install(); assert.equal(upgrade.data.gamePrefs.interval, 5); assert.equal(upgrade.data.gamePrefs.enabled, false); assert.equal(upgrade.data.gameState.xp, 123); assert.equal(upgrade.data.gameState.nextAt - upgrade.now(), 300000);
});
test('page-image cards respect chances, tab ownership, quota and exactly-once capture', async () => {
  const f = fixture({ gamePrefs: { collectibleChance: 0, debug: true } });
  assert.equal((await f.send('spawnImage')).card, null);
  const cards = [];
  for (let i = 0; i < 3; i++) cards.push((await f.send('spawnImage', { force: true, species: 'legend' })).card);
  assert.equal((await f.send('spawnImage', { force: true })).card, null);
  assert.ok((await f.send('catchImage', { id: cards[0].id }, { tab: { id: 2 }, url: 'https://example.org/' })).error);
  const replies = await Promise.all([f.send('catchImage', { id: cards[0].id }), f.send('catchImage', { id: cards[0].id })]);
  assert.equal(replies.filter(r => r.error).length, 1); assert.equal(f.data.gameState.collection.legend, 1); assert.equal(f.data.gameState.xp, 15);
  assert.ok((await f.send('spawnImage', { force: true })).card);
});
test('zero event weights disable automatic encounters; debug seconds override minutes', async () => {
  const f = fixture({ gamePrefs: { debug: true, debugIntervalSeconds: 7, events: { quiz: 0, watch: 0, rare: 0 } } });
  assert.equal((await f.send('claim')).state.nextAt - f.now(), 7000); f.advance(7000); const r = await f.send('claim'); assert.equal(r.state.encounter, null); assert.equal(r.state.nextAt - f.now(), 7000);
});
test('a collectible replaces a site image, captures on click, and restores the original when disabled', async () => {
  const f = fixture({ gamePrefs: { collectibleChance: 100 } });
  const dom = new JSDOM('<a href="/next"><img src="original.jpg" title="Original" style="outline:1px solid green" width="200" height="120"></a>', { url: 'https://example.org/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; let changed; let clicked = 0;
  w.browser = { runtime: { getURL: p => `moz-extension://test/${p}`, onMessage: { addListener() {} }, sendMessage: m => f.send(m.action, m) }, storage: { local: { get: async () => f.data }, onChanged: { addListener(fn) { changed = fn; } } } };
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 200, height: 120 });
  w.document.querySelector('a').addEventListener('click', () => { clicked++; });
  w.eval(read('settings.js')); w.eval(read('game.js')); w.eval(read('ipravdin.js'));
  const settle = () => new Promise(resolve => setTimeout(resolve, 70));
  try {
    await settle(); const img = w.document.querySelector('img'); assert.ok(img.src.includes('/collectibles/')); assert.ok(img.dataset.ipravdinCollectible);
    img.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); await settle();
    assert.equal(clicked, 0); assert.ok(img.src.includes('/photos/')); assert.equal(img.dataset.ipravdinCollectible, undefined); assert.equal(f.data.gameState.xp, 15);
    changed({ activate: { newValue: false } }, 'local'); await settle(); assert.equal(img.getAttribute('src'), 'original.jpg'); assert.equal(img.title, 'Original'); assert.equal(img.style.outline, '1px solid green');
  } finally { w.dispatchEvent(new w.Event('pagehide')); w.close(); }
});
test('practice reports transport failure instead of leaving a blank page', async () => {
  const dom = new JSDOM('<p id="practiceStatus"></p><button id="practiceRetry">Retry</button><div id="practiceStage"></div>', { url: 'moz-extension://test/ipravdin/options/practice.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.browser = { runtime: { getURL: p => `moz-extension://test/${p}`, sendMessage: async () => { throw new Error('No receiver'); }, onMessage: { addListener() {} } }, storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } } };
  w.eval(read('settings.js')); w.eval(read('game.js')); w.eval(read('game-content.js'));
  try { await new Promise(r => setTimeout(r, 50)); assert.match(w.document.getElementById('practiceStatus').textContent, /No receiver/); assert.ok(w.document.getElementById('ipravdin-encounter')); }
  finally { w.dispatchEvent(new w.Event('pagehide')); w.close(); }
});
