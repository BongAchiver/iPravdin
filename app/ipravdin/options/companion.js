(() => {
  'use strict';
  const G = PravdinGame;
  const companions = [...document.querySelectorAll('[data-companion]')];
  if (!companions.length) return;
  let reset, revision = 0;
  function render(state = {}) {
    const visual = G.visual(state);
    for (const panel of companions) {
      const photo = panel.querySelector('.companion-photo'); photo.src = browser.runtime.getURL(visual.photo);
      panel.dataset.action = visual.action || ''; panel.dataset.mood = visual.mood < 50 ? 'stern' : visual.mood >= 80 ? 'happy' : 'neutral';
      panel.querySelector('.companion-bubble').textContent = visual.text;
    }
    for (const meter of document.querySelectorAll('[data-mood-meter]')) {
      meter.querySelector('.mood-label').textContent = visual.label; meter.querySelector('.mood-value').textContent = `${visual.mood}/100`;
      const bar = meter.querySelector('[role="progressbar"]'); bar.setAttribute('aria-valuenow', visual.mood); bar.setAttribute('aria-valuetext', `${visual.mood} из 100. ${visual.label}`);
      const fill = meter.querySelector('.mood-fill'); fill.style.width = `${visual.mood}%`; fill.style.backgroundColor = visual.color;
    }
    clearTimeout(reset);
    if (visual.action) reset = setTimeout(() => render(state), Math.max(50, 6050 - (Date.now() - state.lastAction.at)));
  }
  async function interact(action, panel) {
    const controls = [...panel.querySelectorAll('button')]; controls.forEach(b => { b.disabled = true; });
    try {
      const r = await browser.runtime.sendMessage({ channel: 'pravdin-game', action });
      if (!r?.state) throw new Error(r?.error || 'Правдин не ответил. Попробуйте ещё раз.');
      render(r.state); panel.querySelector('.companion-bubble').textContent = r.error || r.text || r.state.lastAction?.text || G.mood(r.state.mood);
    } catch (error) { panel.querySelector('.companion-bubble').textContent = error.message; }
    finally { controls.forEach(b => { b.disabled = false; }); }
  }
  for (const panel of companions) {
    for (const b of panel.querySelectorAll('[data-interact]')) b.addEventListener('click', () => interact(b.dataset.interact, panel));
    const head = panel.querySelector('.companion-head'); let previous, distance = 0, last = 0;
    head.addEventListener('pointermove', e => {
      if (previous) distance += Math.hypot(e.clientX - previous.x, e.clientY - previous.y); previous = { x: e.clientX, y: e.clientY };
      if (distance >= 160 && Date.now() - last > 2000) { distance = 0; last = Date.now(); interact('pet', panel); }
    });
    head.addEventListener('pointerleave', () => { previous = null; distance = 0; });
  }
  browser.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.gameState) { revision++; render(changes.gameState.newValue); } });
  const started = revision;
  browser.storage.local.get(['gameState']).then(v => { if (started === revision) render(v.gameState); }).catch(() => render());
})();
