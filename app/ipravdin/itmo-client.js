globalThis.ItmoClient = (() => {
  'use strict';
  const SESSION = 'itmoSession';
  const CACHE = 'itmoCache';
  const PENDING = 'itmoAuthPending';
  const CLIENT_ID = 'student-personal-cabinet';
  const callback = `${ItmoSchedule.origin}/login/callback`;
  const endpoint = name => `${ItmoSchedule.issuer}/protocol/openid-connect/${name}`;
  let refreshPromise;
  let loginPromise;
  let revision = 0;
  const failure = code => new Error(code);
  const random = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  async function json(url, options = {}) {
    let response;
    try { response = await fetch(url, { ...options, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) }); }
    catch { throw failure('NETWORK'); }
    if (response.status === 400 || response.status === 401) throw failure('LOGIN');
    if (response.status === 403) throw failure('FORBIDDEN');
    if (!response.ok) throw failure('NETWORK');
    try { return await response.json(); } catch { throw failure('FORMAT'); }
  }
  function tokenSet(data, previous = {}) {
    if (!data || typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 20000 ||
        !Number.isFinite(data.expires_in) || data.expires_in <= 0 || data.expires_in > 86400 ||
        (data.token_type && data.token_type.toLowerCase() !== 'bearer')) throw failure('FORMAT');
    const refreshToken = data.refresh_token || previous.refreshToken;
    if (typeof refreshToken !== 'string' || !refreshToken || refreshToken.length > 20000) throw failure('FORMAT');
    return { accessToken: data.access_token, refreshToken, expiresAt: Date.now() + data.expires_in * 1000,
      refreshExpiresAt: Number.isFinite(data.refresh_expires_in) && data.refresh_expires_in > 0 ? Date.now() + data.refresh_expires_in * 1000 : previous.refreshExpiresAt || 0 };
  }
  async function exchange(parameters) {
    return json(endpoint('token'), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, ...parameters }).toString() });
  }
  async function profile(accessToken) {
    const data = await json(endpoint('userinfo'), { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!data || !['number', 'string'].includes(typeof data.isu) || !String(data.isu) || typeof data.sub !== 'string' || !data.sub) throw failure('FORMAT');
    return { account: String(data.isu).slice(0, 80), subject: data.sub.slice(0, 200) };
  }
  async function savedSession() { return (await browser.storage.local.get(SESSION))[SESSION]; }
  async function current(session, ticket) {
    const saved = await savedSession();
    if (ticket !== revision || !saved || saved.key !== session.key) throw failure('ACCOUNT_CHANGED');
    return saved;
  }
  async function refresh(session, ticket) {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      await current(session, ticket);
      if (session.refreshExpiresAt && session.refreshExpiresAt <= Date.now()) throw failure('LOGIN');
      const tokens = tokenSet(await exchange({ grant_type: 'refresh_token', refresh_token: session.refreshToken }), session);
      const user = await profile(tokens.accessToken);
      if (user.subject !== session.subject || user.account !== session.account) throw failure('ACCOUNT_CHANGED');
      await current(session, ticket);
      const next = { ...session, ...tokens };
      await browser.storage.local.set({ [SESSION]: next });
      return next;
    })();
    try { return await refreshPromise; }
    catch (error) {
      if (error.message === 'LOGIN' && ticket === revision) {
        const saved = await savedSession();
        if (saved?.key === session.key) await browser.storage.local.remove(SESSION);
      }
      throw error;
    } finally { refreshPromise = undefined; }
  }
  async function freshSession(ticket) {
    let session = await savedSession();
    if (!session) throw failure('LOGIN');
    if (session.expiresAt <= Date.now() + 60000) session = await refresh(session, ticket);
    return session;
  }
  async function saveDays(payload, session, selectedDate, ticket) {
    await current(session, ticket);
    const stored = (await browser.storage.local.get(CACHE))[CACHE];
    const cache = stored?.subject === session.subject ? stored : { subject: session.subject, account: session.account, days: {} };
    const updatedAt = Date.now();
    for (let offset = 0; offset < 7; offset++) {
      const date = ItmoSchedule.shift(selectedDate, offset);
      cache.days[date] = { lessons: ItmoSchedule.normalize(payload, date), updatedAt };
    }
    cache.days = Object.fromEntries(Object.entries(cache.days).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 21));
    await current(session, ticket);
    await browser.storage.local.set({ [CACHE]: cache });
    return { ok: true, date: selectedDate, account: session.account, ...cache.days[selectedDate], cached: false };
  }
  async function schedule(selectedDate) {
    const ticket = revision;
    try {
      ItmoSchedule.date(selectedDate);
      let session = await freshSession(ticket);
      const url = `${ItmoSchedule.origin}/api/schedule/schedule/personal?date_start=${selectedDate}&date_end=${ItmoSchedule.shift(selectedDate, 6)}`;
      let payload;
      try { payload = await json(url, { headers: { Authorization: `Bearer ${session.accessToken}` } }); }
      catch (error) {
        if (error.message !== 'LOGIN') throw error;
        session = await refresh(session, ticket);
        payload = await json(url, { headers: { Authorization: `Bearer ${session.accessToken}` } });
      }
      return await saveDays(payload, session, selectedDate, ticket);
    } catch (error) {
      const code = ['LOGIN', 'NETWORK', 'FORBIDDEN', 'FORMAT', 'DATE', 'ACCOUNT_CHANGED'].includes(error.message) ? error.message : 'NETWORK';
      if (ticket !== revision) return { ok: false, code: 'ACCOUNT_CHANGED' };
      if (code === 'NETWORK' || code === 'LOGIN') {
        const cache = (await browser.storage.local.get(CACHE))[CACHE];
        const session = await savedSession();
        if ((!session || cache?.subject === session.subject) && cache?.days?.[selectedDate] && ticket === revision) {
          return { ok: true, date: selectedDate, account: cache.account, ...cache.days[selectedDate], cached: true, needsLogin: code === 'LOGIN' };
        }
      }
      return { ok: false, code };
    }
  }
  async function closePending(expectedState) {
    const pending = (await browser.storage.session.get(PENDING))[PENDING];
    if (expectedState && pending?.state !== expectedState) return;
    await browser.storage.session.remove(PENDING);
    if (pending?.windowId !== undefined) { try { await browser.windows.remove(pending.windowId); } catch { /* Already closed. */ } }
  }
  async function beginLogin() {
    const ticket = ++revision;
    await closePending();
    const switching = Boolean(await savedSession());
    await browser.storage.local.remove([SESSION, CACHE, 'itmoAuthError']);
    const verifier = random(), state = random();
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const auth = new URL(endpoint('auth'));
    auth.search = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: callback, response_type: 'code',
      scope: 'openid profile', state, code_challenge_method: 'S256', code_challenge: challenge,
      ...(switching ? { prompt: 'login' } : {}) }).toString();
    const window = await browser.windows.create({ url: 'about:blank', type: 'popup', width: 520, height: 720 });
    const tabId = window.tabs?.[0]?.id;
    if (!Number.isInteger(tabId) || ticket !== revision) {
      await browser.windows.remove(window.id); throw failure('ACCOUNT_CHANGED');
    }
    await browser.storage.session.set({ [PENDING]: { verifier, state, windowId: window.id, tabId, createdAt: Date.now() } });
    try { await browser.tabs.update(tabId, { url: auth.href }); }
    catch { await closePending(); throw failure('NETWORK'); }
    return { ok: true, pending: true };
  }
  async function login() {
    if (loginPromise) return loginPromise;
    loginPromise = beginLogin();
    try { return await loginPromise; }
    catch { return { ok: false, code: 'NETWORK' }; }
    finally { loginPromise = undefined; }
  }
  async function logout() {
    ++revision;
    await closePending();
    const session = await savedSession();
    await browser.storage.local.remove([SESSION, CACHE, 'itmoAuthError']);
    if (session?.refreshToken) {
      try { await fetch(endpoint('revoke'), { method: 'POST', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: CLIENT_ID, token: session.refreshToken, token_type_hint: 'refresh_token' }).toString() }); } catch { /* Local data already removed. */ }
    }
    return { ok: true };
  }
  async function authorization(details) {
    const pending = (await browser.storage.session.get(PENDING))[PENDING];
    if (!pending || details.tabId !== pending.tabId || details.type !== 'main_frame') return {};
    const url = new URL(details.url);
    if (url.origin + url.pathname !== callback) return {};
    const ticket = revision;
    try {
      if (Date.now() - pending.createdAt > 10 * 60 * 1000 || url.searchParams.get('state') !== pending.state ||
          (url.searchParams.has('iss') && url.searchParams.get('iss') !== ItmoSchedule.issuer) || !url.searchParams.get('code') || url.searchParams.has('error')) throw failure('AUTH');
      const tokens = tokenSet(await exchange({ grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: callback, code_verifier: pending.verifier }));
      const user = await profile(tokens.accessToken);
      const stillPending = (await browser.storage.session.get(PENDING))[PENDING];
      if (ticket !== revision || stillPending?.state !== pending.state) throw failure('ACCOUNT_CHANGED');
      await browser.storage.local.set({ [SESSION]: { ...tokens, ...user, key: random() } });
      await browser.storage.local.remove('itmoAuthError');
    } catch {
      if (ticket === revision) await browser.storage.local.set({ itmoAuthError: 'Не удалось завершить вход в ITMO ID. Попробуйте ещё раз.' });
    } finally { await closePending(pending.state); }
    return { cancel: true };
  }
  // Intercept only our own login window, at the registered site callback.
  // Ordinary my.itmo logins are unaffected. No page content or tokens are scraped.
  const callbackURL = new URL(callback);
  browser.webRequest.onBeforeRequest.addListener(authorization, {
    urls: [`${callbackURL.protocol}//${callbackURL.hostname}${callbackURL.pathname}*`], types: ['main_frame']
  }, ['blocking']);
  browser.windows.onRemoved.addListener(async windowId => {
    const pending = (await browser.storage.session.get(PENDING))[PENDING];
    if (pending?.windowId === windowId) { ++revision; await browser.storage.session.remove(PENDING); }
  });
  browser.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'itmo:refresh') schedule(ItmoSchedule.today()).catch(() => {}); });
  browser.alarms.create('itmo:refresh', { periodInMinutes: 20 });
  async function status() {
    const session = await savedSession();
    const pending = (await browser.storage.session.get(PENDING))[PENDING];
    return { ok: true, connected: Boolean(session), pending: Boolean(pending), account: session?.account,
      error: (await browser.storage.local.get('itmoAuthError')).itmoAuthError };
  }
  browser.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== browser.runtime.id || typeof sender.url !== 'string' || !sender.url.startsWith(browser.runtime.getURL(''))) return undefined;
    if (message?.type === 'itmo:schedule') return schedule(message.date);
    if (message?.type === 'itmo:login') return login();
    if (message?.type === 'itmo:logout') return logout();
    if (message?.type === 'itmo:status') return status();
    return undefined;
  });
  return { schedule, login, logout, status };
})();
