const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const read = name => fs.readFileSync(`app/ipravdin/${name}`, 'utf8');
async function fixture(html, values = {}, date) {
  const dom = new JSDOM(html, { url: 'https://news.example.org/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  if (date) { const NativeDate = w.Date; w.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [date])); } }; }
  let listener;
  w.browser = {
    runtime: { getURL: path => `moz-extension://test/${path}` },
    storage: { local: { get: async () => values }, onChanged: { addListener: fn => { listener = fn; } } }
  };
  w.HTMLElement.prototype.getBoundingClientRect = function () { return { width: Number(this.getAttribute('width') || 200), height: Number(this.getAttribute('height') || 100) }; };
  w.eval(read('settings.js')); w.eval(read('ipravdin.js'));
  const settle = () => new Promise(resolve => setTimeout(resolve, 60));
  await settle();
  return { w, settle, change: async changes => { listener(changes, 'local'); await settle(); }, close: () => { w.dispatchEvent(new w.Event('pagehide')); w.close(); } };
}
test('replaces responsive images and restores original attributes/styles', async () => {
  const f = await fixture('<picture><source srcset="wide.jpg 2x" sizes="80vw"><img src="a.jpg" srcset="a.jpg 1x" sizes="50vw" style="width: 80%; object-fit: contain; color: red"></picture>');
  try {
    const img = f.w.document.querySelector('img'), source = f.w.document.querySelector('source');
    assert.match(img.src, /^moz-extension:/); assert.equal(img.getAttribute('srcset'), null); assert.equal(source.getAttribute('srcset'), null);
    await f.change({ activate: { newValue: false } });
    assert.equal(img.getAttribute('src'), 'a.jpg'); assert.equal(img.getAttribute('srcset'), 'a.jpg 1x'); assert.equal(img.style.width, '80%'); assert.equal(img.style.objectFit, 'contain'); assert.equal(img.style.color, 'red'); assert.equal(source.getAttribute('srcset'), 'wide.jpg 2x');
    await f.change({ activate: { newValue: true } }); assert.match(img.src, /^moz-extension:/);
  } finally { f.close(); }
});
test('observes inserted images and keeps latest site-provided URL on disable', async () => {
  const f = await fixture('<main></main>');
  try {
    const img = f.w.document.createElement('img'); img.src = 'first.jpg'; f.w.document.querySelector('main').append(img); await f.settle();
    assert.match(img.src, /^moz-extension:/);
    img.src = 'latest.jpg'; img.srcset = 'latest2.jpg 2x'; await f.settle(); assert.match(img.src, /^moz-extension:/);
    await f.change({ activate: { newValue: false } }); assert.equal(img.getAttribute('src'), 'latest.jpg'); assert.equal(img.getAttribute('srcset'), 'latest2.jpg 2x');
  } finally { f.close(); }
});
test('domain exclusions cover subdomains but not lookalike domains', async () => {
  const f = await fixture('<img src="a.jpg">', { excluded: ['example.org'] });
  try {
    assert.equal(f.w.document.querySelector('img').getAttribute('src'), 'a.jpg');
    assert.equal(f.w.PravdinSettings.blocked('fakeexample.org', ['example.org']), false);
    await f.change({ excluded: { newValue: [] } }); assert.match(f.w.document.querySelector('img').src, /^moz-extension:/);
  } finally { f.close(); }
});
test('small icons are skipped unless configured otherwise', async () => {
  const f = await fixture('<img width="24" height="24" src="icon.jpg">');
  try {
    assert.equal(f.w.document.querySelector('img').getAttribute('src'), 'icon.jpg');
    await f.change({ skipSmall: { newValue: false } }); assert.match(f.w.document.querySelector('img').src, /^moz-extension:/);
  } finally { f.close(); }
});
test('detached images are restored and can be inserted again', async () => {
  const f = await fixture('<img src="a.jpg">');
  try {
    const img = f.w.document.querySelector('img'); img.remove(); await f.settle(); assert.equal(img.getAttribute('src'), 'a.jpg');
    f.w.document.body.append(img); await f.settle(); assert.match(img.src, /^moz-extension:/);
  } finally { f.close(); }
});
test('domain input rejects markup, paths and userinfo', async () => {
  const f = await fixture('<div></div>');
  try {
    for (const value of ['<img src=x onerror=alert(1)>', 'example.org/path', 'evil@example.org', 'example.org:443', 'example.org?x']) assert.throws(() => f.w.PravdinSettings.domain(value));
    assert.equal(f.w.PravdinSettings.domain('ПРИМЕР.РФ'), 'xn--e1afmkfd.xn--p1ai');
  } finally { f.close(); }
});
test('blocked replacement restores originals without an error retry loop', async () => {
  const f = await fixture('<picture><source srcset="a.jpg 2x"><img src="a.jpg"></picture>');
  try {
    const img = f.w.document.querySelector('img'); img.dispatchEvent(new f.w.Event('error')); await f.settle();
    assert.equal(img.getAttribute('src'), 'a.jpg'); assert.equal(f.w.document.querySelector('source').getAttribute('srcset'), 'a.jpg 2x');
    img.dispatchEvent(new f.w.Event('load')); await f.settle(); assert.equal(img.getAttribute('src'), 'a.jpg');
  } finally { f.close(); }
});
test('latest picture source updates are restored', async () => {
  const f = await fixture('<picture><source srcset="a.jpg 2x"><img src="a.jpg"></picture>');
  try {
    const source = f.w.document.querySelector('source'); source.srcset = 'b.jpg 2x'; await f.settle();
    assert.equal(source.getAttribute('srcset'), null);
    await f.change({ activate: { newValue: false } }); assert.equal(source.getAttribute('srcset'), 'b.jpg 2x');
  } finally { f.close(); }
});
test('September 3 also uses only the supplied Pravdin photos', async () => {
  const f = await fixture('<img src="a.jpg">', {}, '2026-09-03T12:00:00');
  try { assert.match(f.w.document.querySelector('img').src, /(?:portrait|closeup)\.jpg$/); } finally { f.close(); }
});
