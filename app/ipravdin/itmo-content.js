(() => {
  'use strict';
  if (location.origin !== ItmoSchedule.origin || window.top !== window) return;
  function session() {
    // Never read or return the site's tokens. Only use its client and user ID.
    const client = window.wrappedJSObject?.$nuxt;
    if (!client) throw new Error('CLIENT');
    const user = client?.$auth?.user;
    const isu = user?.isu;
    if (client?.$auth?.loggedIn === false || !user || !['string', 'number'].includes(typeof isu) || !String(isu)) throw new Error('LOGIN');
    if (typeof client.$axios?.get !== 'function') throw new Error('CLIENT');
    return { client, account: String(isu).slice(0, 80) };
  }
  async function load(selectedDate) {
    let timer;
    try {
      ItmoSchedule.date(selectedDate);
      const before = session();
      const url = `${ItmoSchedule.origin}/api/schedule/schedule/personal?date_start=${selectedDate}&date_end=${selectedDate}`;
      // Axios in the page manages its own authorization and token refresh.
      const response = await Promise.race([
        before.client.$axios.get(url, cloneInto({ timeout: 12000 }, window)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('NETWORK')), 15000); })
      ]);
      const after = session();
      if (after.account !== before.account) throw new Error('ACCOUNT_CHANGED');
      return { ok: true, date: selectedDate, account: after.account,
        lessons: ItmoSchedule.normalize(response.data, selectedDate), updatedAt: Date.now() };
    } catch (error) {
      const status = error?.response?.status;
      const allowed = ['DATE', 'FORMAT', 'LOGIN', 'CLIENT', 'ACCOUNT_CHANGED'];
      const code = status === 401 || status === 403 ? 'LOGIN' : allowed.includes(error?.message) ? error.message : 'NETWORK';
      // Server errors/configs can contain auth headers; never relay them.
      return { ok: false, code };
    } finally { clearTimeout(timer); }
  }
  browser.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== browser.runtime.id || typeof sender.url !== 'string' || !sender.url.startsWith(browser.runtime.getURL(''))) return undefined;
    if (message?.type !== 'itmo:schedule') return undefined;
    return load(message.date);
  });
})();
