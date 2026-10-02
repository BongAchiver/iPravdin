const { Builder, By } = require('selenium-webdriver');
const firefox = require('selenium-webdriver/firefox');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { ZipArchive } = require('archiver');

// A synthetic my.itmo client in a disposable profile. No real login or data.
const html = `<!doctype html><html><head><title>my.itmo test account</title></head><body>
<h1>Schedule test fixture</h1><script>
window.$nuxt = {
  $auth: { loggedIn: true, user: { isu: 111 } },
  $axios: { get: async function(url, config) {
    if (config.timeout !== 12000) throw new Error('Timeout configuration did not cross the page boundary');
    window.lastScheduleUrl = url;
    const response = await fetch(url + '&fixture_account=' + window.$nuxt.$auth.user.isu);
    if (!response.ok) throw { response: { status: response.status }, config: { secret: 'must-not-leave-page' } };
    return { data: await response.json() };
  } }
};
</script></body></html>`;
const requests = [];
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/schedule/')) {
    requests.push(req.url);
    const url = new URL(req.url, 'http://localhost');
    if (url.searchParams.get('fixture_account') === '333') { res.writeHead(401); res.end('{}'); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ code: 0, data: [{ date: url.searchParams.get('date_start'), lessons: [{
      time_start: '10:00', time_end: '11:30', subject: `Алгоритмы · ${url.searchParams.get('fixture_account')}`,
      teacher_name: 'Иванов И. И.', room: '321', building: 'Кронверкский, 49', work_type: 'Практика'
    }] }] }));
  } else { res.setHeader('Content-Type', 'text/html'); res.end(html); }
});
async function archive(directory, outputPath) {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const zip = new ZipArchive();
    output.on('close', resolve); output.on('error', reject); zip.on('error', reject);
    zip.pipe(output); zip.directory(directory, false); zip.finalize();
  });
}
(async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ipravdin-firefox-schedule-'));
  let driver;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const app = path.join(temporary, 'app');
    fs.cpSync('app', app, { recursive: true });
    const corePath = path.join(app, 'ipravdin/schedule.js');
    fs.writeFileSync(corePath, fs.readFileSync(corePath, 'utf8').replace("const origin = 'https://my.itmo.ru';", `const origin = '${origin}';`));
    const manifestPath = path.join(app, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.browser_specific_settings.gecko.id = 'schedule-test@ipravdin.local';
    delete manifest.browser_specific_settings.gecko.update_url;
    manifest.content_scripts.find(script => script.js.includes('ipravdin/itmo-content.js')).matches = ['http://127.0.0.1/*'];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const zip = path.join(temporary, 'fixture.zip');
    await archive(app, zip);
    const options = new firefox.Options().setBinary('C:/Program Files/Mozilla Firefox/firefox.exe').addArguments('-headless', '--width=1000', '--height=1200');
    options.setPreference('extensions.webextensions.uuids', JSON.stringify({ 'schedule-test@ipravdin.local': '7d009b43-06e4-447f-893e-f55255ea7a0c' }));
    options.setPreference('ui.systemUsesDarkTheme', 0);
    const service = new firefox.ServiceBuilder().addArguments('--allow-system-access');
    driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(service).build();
    await driver.installAddon(zip, true);
    await driver.get(origin);
    const accountTab = await driver.getWindowHandle();
    await driver.switchTo().newWindow('tab');
    const popupTab = await driver.getWindowHandle();
    const popupUrl = 'moz-extension://7d009b43-06e4-447f-893e-f55255ea7a0c/ipravdin/options/popup.html';
    await driver.get(popupUrl);
    await driver.wait(async () => (await driver.findElement(By.id('scheduleAccount')).getText()).includes('111'), 15000);
    assert.match(await driver.findElement(By.id('scheduleLessons')).getText(), /Алгоритмы · 111/);
    assert.match(await driver.findElement(By.id('scheduleLessons')).getText(), /10:00[\s\S]*11:30/);
    assert.match(await driver.findElement(By.id('scheduleLessons')).getText(), /Кронверкский/);
    fs.mkdirSync('artifacts', { recursive: true });
    fs.writeFileSync('artifacts/schedule-popup.png', await driver.findElement(By.css('main')).takeScreenshot(), 'base64');
    const initialDate = await driver.findElement(By.id('scheduleDate')).getAttribute('value');
    await driver.findElement(By.id('scheduleNext')).click();
    await driver.wait(async () => await driver.findElement(By.id('scheduleRefresh')).isEnabled(), 15000);
    assert.notEqual(await driver.findElement(By.id('scheduleDate')).getAttribute('value'), initialDate);
    await driver.switchTo().window(accountTab);
    await driver.executeScript('window.$nuxt.$auth.user.isu = 222');
    await driver.switchTo().window(popupTab);
    await driver.findElement(By.id('scheduleRefresh')).click();
    await driver.wait(async () => (await driver.findElement(By.id('scheduleAccount')).getText()).includes('222'), 15000);
    assert.match(await driver.findElement(By.id('scheduleLessons')).getText(), /Алгоритмы · 222/);
    assert.equal((await driver.findElement(By.id('scheduleLessons')).getText()).includes('111'), false);
    await driver.switchTo().window(accountTab);
    await driver.executeScript('window.$nuxt.$auth.user.isu = 333');
    await driver.switchTo().window(popupTab);
    await driver.findElement(By.id('scheduleRefresh')).click();
    await driver.wait(async () => (await driver.findElement(By.id('scheduleStatus')).getText()).includes('Войдите'), 15000);
    assert.equal((await driver.findElements(By.css('.schedule-lesson'))).length, 0);
    await driver.switchTo().window(accountTab); await driver.close();
    await driver.switchTo().window(popupTab);
    await driver.findElement(By.id('scheduleRefresh')).click();
    await driver.wait(async () => (await driver.findElement(By.id('scheduleStatus')).getText()).includes('Откройте'), 15000);
    assert.equal((await driver.findElements(By.css('.schedule-lesson'))).length, 0);
    assert.equal(requests.length, 4);
    console.log('PASS: Firefox page client bridge, schedule rendering, date navigation, independent accounts, expired login and closed tab.');
  } catch (error) {
    if (driver) {
      console.error('Fixture popup status:', await driver.executeScript('return document.getElementById("scheduleStatus")?.textContent'));
      console.error('Fixture request count:', requests.length);
      console.error('Fixture tabs:', await driver.executeAsyncScript('const done=arguments[0];browser.tabs.query({}).then(tabs=>done(tabs.map(t=>({id:t.id,url:t.url,incognito:t.incognito}))))'));
      console.error('Fixture messaging:', await driver.executeAsyncScript('const done=arguments[0];browser.tabs.sendMessage(1,{type:"itmo:schedule",date:"2026-10-03"},{frameId:0}).then(done,e=>done({error:e.message}))'));
    }
    throw error;
  } finally {
    if (driver) await driver.quit();
    server.close();
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    assert.match(path.basename(temporary), /^ipravdin-firefox-schedule-/);
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
