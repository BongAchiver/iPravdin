globalThis.PravdinSettings = (() => {
  const defaults = { activate: true, contextmenu: true, skipSmall: true, excluded: [] };
  function domain(input) {
    const value = String(input).trim().toLowerCase();
    if (!value || /[\s/:@?#]/.test(value)) throw new Error('Укажите домен без пути, например example.org');
    const url = new URL(`https://${value}`);
    if (url.port || url.pathname !== '/' || !url.hostname.includes('.') || !/^[a-z0-9.-]+$/.test(url.hostname)) throw new Error('Укажите домен без порта и пути');
    return url.hostname;
  }
  function normalize(value = {}) {
    return {
      activate: typeof value.activate === 'boolean' ? value.activate : defaults.activate,
      contextmenu: typeof value.contextmenu === 'boolean' ? value.contextmenu : defaults.contextmenu,
      skipSmall: typeof value.skipSmall === 'boolean' ? value.skipSmall : defaults.skipSmall,
      excluded: Array.isArray(value.excluded) ? [...new Set(value.excluded.flatMap(item => {
        try { return [domain(item)]; } catch { return []; }
      }))].slice(0, 200) : []
    };
  }
  const blocked = (host, excluded) => excluded.some(item => host === item || host.endsWith(`.${item}`));
  return { defaults, domain, normalize, blocked };
})();
