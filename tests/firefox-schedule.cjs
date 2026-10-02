const { Builder, By } = require('selenium-webdriver');
const firefox = require('selenium-webdriver/firefox');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { ZipArchive } = require('archiver');

// A local OAuth/API fixture. It never contacts ITMO or uses real credentials.
let account = '111', offline = false, invalidRefresh = false, origin;
let refreshes = 0, callbackRequests = 0, sequence = 0;
const codes = new Map(), access = new Map(), refresh = new Map();
function issue(user) {
  const accessToken = `fixture-access-${++sequence}`, refreshToken = `fixture-refresh-${sequence}`;
  access.set(accessToken, user); refresh.set(refreshToken, user);
  return { access_token: accessToken, refresh_token: refreshToken, expires_in: 3600, refresh_expires_in: 86400, token_type: 'Bearer' };
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, origin);
  const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (url.pathname.endsWith('/openid-connect/auth')) {
    assert.equal(url.searchParams.get('client_id'), 'student-personal-cabinet');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    const code = `fixture-code-${++sequence}`;
    codes.set(code, { account, challenge: url.searchParams.get('code_challenge') });
    const redirect = new URL(url.searchParams.get('redirect_uri'));
    redirect.search = new URLSearchParams({ code, state: url.searchParams.get('state'), iss: `${origin}/auth/realms/itmo` }).toString();
    res.writeHead(302, { Location: redirect.href }); res.end(); return;
  }
  if (url.pathname.endsWith('/openid-connect/token')) {
    let body = ''; for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    if (form.get('grant_type') === 'authorization_code') {
      const code = codes.get(form.get('code')); codes.delete(form.get('code'));
      if (!code || crypto.createHash('sha256').update(form.get('code_verifier') || '').digest('base64url') !== code.challenge) { json({ error: 'invalid_grant' }, 400); return; }
      json(issue(code.account)); return;
    }
    ++refreshes;
    const user = refresh.get(form.get('refresh_token'));
    refresh.delete(form.get('refresh_token'));
    if (!user || invalidRefresh) { json({ error: 'invalid_grant' }, 400); return; }
    json(issue(user)); return;
  }
  if (url.pathname.endsWith('/openid-connect/userinfo')) {
    const user = access.get((req.headers.authorization || '').replace(/^Bearer /, ''));
    json(user ? { isu: Number(user), sub: `fixture-subject-${user}` } : {}, user ? 200 : 401); return;
  }
  if (url.pathname.endsWith('/openid-connect/revoke')) { json({}); return; }
  if (url.pathname === '/api/schedule/schedule/personal') {
    if (offline) { json({}, 503); return; }
    const user = access.get((req.headers.authorization || '').replace(/^Bearer /, ''));
    if (!user) { json({}, 401); return; }
    json({ code: 0, data: [{ date: url.searchParams.get('date_start'), lessons: [{ time_start: '10:00', time_end: '11:30',
      subject: `Алгоритмы · ${user}`, teacher_name: 'Иванов И. И.', room: '321', building: 'Кронверкский, 49', work_type: 'Практика' }] }] }); return;
  }
  if (url.pathname === '/login/callback') ++callbackRequests;
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><html><body>Fixture</body></html>');
});
async function archive(directory, outputPath) {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath), zip = new ZipArchive();
    output.on('close', resolve); output.on('error', reject); zip.on('error', reject);
    zip.pipe(output); zip.directory(directory, false); zip.finalize();
  });
}
(async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ipravdin-firefox-schedule-'));
  let driver;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    const app = path.join(temporary, 'app'); fs.cpSync('app', app, { recursive: true });
    const corePath = path.join(app, 'ipravdin/schedule.js');
    fs.writeFileSync(corePath, fs.readFileSync(corePath, 'utf8')
      .replace("const origin = 'https://my.itmo.ru';", `const origin = '${origin}';`)
      .replace("const issuer = 'https://id.itmo.ru/auth/realms/itmo';", `const issuer = '${origin}/auth/realms/itmo';`));
    const manifestPath = path.join(app, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.browser_specific_settings.gecko.id = 'schedule-test@ipravdin.local';
    delete manifest.browser_specific_settings.gecko.update_url;
    manifest.content_security_policy.extension_pages = manifest.content_security_policy.extension_pages.replace('connect-src https://my.itmo.ru https://id.itmo.ru', `connect-src ${origin}`);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const zip = path.join(temporary, 'fixture.zip'); await archive(app, zip);
    const options = new firefox.Options().setBinary('C:/Program Files/Mozilla Firefox/firefox.exe').addArguments('-headless', '--width=1000', '--height=1200');
    options.setPreference('extensions.webextensions.uuids', JSON.stringify({ 'schedule-test@ipravdin.local': '7d009b43-06e4-447f-893e-f55255ea7a0c' }));
    options.setPreference('ui.systemUsesDarkTheme', 0);
    const service = new firefox.ServiceBuilder().addArguments('--allow-system-access');
    driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(service).build();
    await driver.installAddon(zip, true);
    const popupURL = 'moz-extension://7d009b43-06e4-447f-893e-f55255ea7a0c/ipravdin/options/popup.html';
    await driver.get(popupURL);
    await driver.wait(async () => (await driver.findElement(By.id('scheduleStatus')).getText()).includes('Войдите'), 15000);
    await driver.findElement(By.id('scheduleConnect')).click();
    await driver.wait(async () => (await driver.findElement(By.id('scheduleAccount')).getText()).includes('111'), 20000);
    assert.equal(callbackRequests, 0, 'The callback must be intercepted before the site can exchange the code');
    assert.match(await driver.findElement(By.id('scheduleLessons')).getText(), /10:00[\s\S]*11:30/);
    const openTabs = await driver.executeAsyncScript('const done=arguments[0];browser.tabs.query({url:"http://127.0.0.1/*"}).then(tabs=>done(tabs.length))');
    assert.equal(openTabs, 0, 'Schedule must work with no website or login tab open');
    await driver.get('about:blank'); await driver.get(popupURL);
    await driver.wait(async () => (await driver.findElement(By.id('scheduleAccount')).getText()).includes('111'), 15000);
    fs.mkdirSync('artifacts', { recursive: true });
    fs.writeFileSync('artifacts/schedule-popup.png', await driver.findElement(By.css('main')).takeScreenshot(), 'base64');
    await driver.executeAsyncScript('const done=arguments[0];browser.storage.local.get("itmoSession").then(data=>{data.itmoSession.expiresAt=0;return browser.storage.local.set(data)}).then(done)');
    await driver.wait(async () => refreshes === 1 && (await driver.findElement(By.id('scheduleLessons')).getText()).includes('111'), 15000);
    offline = true;
    await driver.findElement(By.id('scheduleRefresh')).click();
    await driver.wait(async () => (await driver.findElement(By.id('scheduleStatus')).getText()).includes('Сохранено'), 15000);
    assert.match(await driver.findElement(By.id('scheduleLessons')).getText(), /111/);
    offline = false; account = '222';
    await driver.findElement(By.id('scheduleConnect')).click();
    await driver.wait(async () => (await driver.findElement(By.id('scheduleAccount')).getText()).includes('222'), 20000);
    assert.equal((await driver.findElement(By.id('scheduleLessons')).getText()).includes('111'), false);
    invalidRefresh = true;
    await driver.executeAsyncScript('const done=arguments[0];browser.storage.local.get("itmoSession").then(data=>{data.itmoSession.expiresAt=0;return browser.storage.local.set(data)}).then(done)');
    await driver.wait(async () => (await driver.findElement(By.id('scheduleStatus')).getText()).includes('Сессия истекла'), 15000);
    assert.match(await driver.findElement(By.id('scheduleLessons')).getText(), /222/);
    await driver.findElement(By.id('scheduleLogout')).click();
    await driver.wait(async () => (await driver.findElement(By.id('scheduleStatus')).getText()).includes('Войдите'), 15000);
    assert.equal((await driver.findElements(By.css('.schedule-lesson'))).length, 0);
    const cleared = await driver.executeAsyncScript('const done=arguments[0];browser.storage.local.get(["itmoSession","itmoCache"]).then(data=>done(!data.itmoSession&&!data.itmoCache))');
    assert.equal(cleared, true);
    console.log('PASS: Firefox PKCE login, no open website tabs, persisted session, token refresh, offline cache, independent accounts, session expiry and logout.');
  } catch (error) {
    console.error({ codes: codes.size, access: access.size, callbackRequests });
    if (driver) console.error('Fixture popup status:', await driver.executeScript('return document.getElementById("scheduleStatus")?.textContent'));
    throw error;
  } finally {
    if (driver) await driver.quit(); server.close();
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir())); assert.match(path.basename(temporary), /^ipravdin-firefox-schedule-/);
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
