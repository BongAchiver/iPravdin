(() => {
  'use strict';
  const names = ['portrait.jpg', 'closeup.jpg'];
  const photos = names.map(name => browser.runtime.getURL(`ipravdin/photos/${name}`));
  const originals = new Map();
  const sources = new Map();
  const attributes = ['src', 'srcset', 'sizes'];
  let settings = PravdinSettings.defaults;
  let running = false;
  let scheduled = false;
  let failed = new WeakSet();
  let revision = 0;
  const pending = new Set();
  const snapshot = node => Object.fromEntries(attributes.map(name => [name, node.getAttribute(name)]));
  function restoreAttributes(node, values) {
    for (const [name, value] of Object.entries(values)) {
      if (value === null) node.removeAttribute(name); else node.setAttribute(name, value);
    }
  }
  function restore(img) {
    const saved = originals.get(img);
    if (!saved) return;
    restoreAttributes(img, saved.attrs);
    for (const [name, old] of Object.entries(saved.styles)) {
      if (old.value) img.style.setProperty(name, old.value, old.priority); else img.style.removeProperty(name);
    }
    originals.delete(img);
  }
  function replace(img) {
    if (document.documentElement.dataset.pravdinQuest === 'true') return;
    if (!img.isConnected || failed.has(img)) return;
    const rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height || (settings.skipSmall && (rect.width < 48 || rect.height < 48))) return;
    let saved = originals.get(img);
    if (!saved) {
      saved = { attrs: snapshot(img), styles: {}, photo: photos[Math.floor(Math.random() * photos.length)] };
      for (const name of ['width', 'height', 'object-fit', 'object-position']) saved.styles[name] = { value: img.style.getPropertyValue(name), priority: img.style.getPropertyPriority(name) };
      originals.set(img, saved);
      img.style.setProperty('width', `${rect.width}px`);
      img.style.setProperty('height', `${rect.height}px`);
      img.style.setProperty('object-fit', 'cover');
      img.style.setProperty('object-position', 'center');
    }
    if (img.parentElement?.tagName === 'PICTURE') {
      for (const source of img.parentElement.querySelectorAll('source')) {
        if (!sources.has(source)) sources.set(source, snapshot(source));
        source.removeAttribute('srcset'); source.removeAttribute('sizes');
      }
    }
    img.removeAttribute('srcset'); img.removeAttribute('sizes');
    if (img.getAttribute('src') !== saved.photo) img.setAttribute('src', saved.photo);
  }
  function collect(node) {
    if (node.nodeType !== 1) return;
    if (node.tagName === 'IMG') pending.add(node);
    node.querySelectorAll('img').forEach(img => pending.add(img));
    if (node.tagName === 'SOURCE' && node.parentElement?.tagName === 'PICTURE') {
      const img = node.parentElement.querySelector('img'); if (img) pending.add(img);
    }
  }
  function flush() {
    scheduled = false;
    if (!running) return;
    observer.disconnect();
    for (const img of pending) replace(img);
    pending.clear();
    for (const img of originals.keys()) if (!img.isConnected) restore(img);
    for (const [source, attrs] of sources) {
      if (!source.isConnected || !source.parentElement?.querySelector('img')) { restoreAttributes(source, attrs); sources.delete(source); }
    }
    observe();
  }
  const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(flush); } };
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') {
        const node = record.target;
        const saved = originals.get(node);
        if (saved && attributes.includes(record.attributeName)) {
          const value = node.getAttribute(record.attributeName);
          if (record.attributeName !== 'src' || value !== saved.photo) saved.attrs[record.attributeName] = value;
        }
        const source = sources.get(node);
        if (source && attributes.includes(record.attributeName)) source[record.attributeName] = node.getAttribute(record.attributeName);
        collect(node);
      } else {
        record.addedNodes.forEach(collect);
        if (record.target.tagName === 'PICTURE') collect(record.target);
      }
    }
    schedule();
  });
  function observe() {
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset', 'sizes', 'class', 'style', 'hidden'] });
  }
  function rescan() { if (running) { collect(document.documentElement); schedule(); } }
  function apply(value) {
    settings = PravdinSettings.normalize(value);
    running = settings.activate && !PravdinSettings.blocked(location.hostname, settings.excluded);
    observer.disconnect();
    for (const img of originals.keys()) restore(img);
    for (const [source, attrs] of sources) restoreAttributes(source, attrs);
    sources.clear(); pending.clear(); failed = new WeakSet();
    if (running) { observe(); rescan(); }
  }
  document.addEventListener('load', event => {
    if (running && event.target.tagName === 'IMG') { pending.add(event.target); schedule(); }
  }, true);
  document.addEventListener('error', event => {
    const img = event.target;
    const saved = originals.get(img);
    if (!running || !saved || img.getAttribute('src') !== saved.photo) return;
    // A site's image policy may block an extension image. Restore instead of retrying forever.
    observer.disconnect(); failed.add(img); restore(img);
    if (img.parentElement?.tagName === 'PICTURE') {
      for (const source of img.parentElement.querySelectorAll('source')) {
        if (sources.has(source)) { restoreAttributes(source, sources.get(source)); sources.delete(source); }
      }
    }
    observe();
  }, true);
  window.addEventListener('resize', rescan);
  window.addEventListener('pravdin-quest-change', () => apply(settings));
  window.addEventListener('pagehide', () => { running = false; observer.disconnect(); pending.clear(); });
  window.addEventListener('pageshow', event => { if (event.persisted) apply(settings); });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!Object.keys(changes).some(key => key in PravdinSettings.defaults)) return;
    revision++;
    const updated = { ...settings };
    for (const [key, change] of Object.entries(changes)) updated[key] = change.newValue;
    apply(updated);
  });
  browser.storage.local.get(Object.keys(PravdinSettings.defaults)).then(value => { if (revision === 0) apply(value); }).catch(error => console.error('iPravdin: cannot read settings', error));
})();
