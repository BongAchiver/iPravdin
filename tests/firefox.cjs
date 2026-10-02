const { Builder, By } = require('selenium-webdriver');
const firefox = require('selenium-webdriver/firefox');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const requests = [];
const html = `<!doctype html><html><head><title>Image replacement fixture</title></head><body>
<img id="normal" width="200" height="120" src="/original.jpg" style="object-fit:contain">
<picture><source srcset="/original.jpg 2x"><img id="responsive" width="200" height="120" src="/original.jpg" srcset="/original.jpg 1x"></picture>
<img id="small" width="24" height="24" src="/original.jpg"><iframe src="/frame"></iframe>
</body></html>`;
const server = http.createServer((req, res) => {
  requests.push(req.url);
  if (req.url.endsWith('.jpg')) { res.setHeader('Content-Type', 'image/jpeg'); res.end(fs.readFileSync('app/ipravdin/photos/portrait.jpg')); }
  else { res.setHeader('Content-Type', 'text/html'); res.end(req.url === '/frame' ? '<img id="frameImg" width="200" height="120" src="/original.jpg">' : html); }
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const options = new firefox.Options().setBinary('C:/Program Files/Mozilla Firefox/firefox.exe').addArguments('-headless', '--width=1280', '--height=1000');
  options.setPreference('extensions.webextensions.uuids', JSON.stringify({ 'inikolayev-firefox@vint352.local': '82cf49f6-d6ad-44ce-bc1d-9bd2d9c304fe' }));
  options.setPreference('ui.systemUsesDarkTheme', 0);
  // System access is limited to this disposable headless test profile.
  const service = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(service).build();
  try {
    const version = JSON.parse(fs.readFileSync('app/manifest.json', 'utf8')).version;
    const zip = `ipravdin-firefox-${version}.zip`;
    await driver.installAddon(path.resolve('dist', zip), true);
    await driver.get(url);
    await driver.wait(async () => (await driver.findElement(By.id('normal')).getAttribute('src')).startsWith('moz-extension:'), 15000);
    assert.equal(await driver.executeScript('return document.querySelector("#normal").naturalWidth > 0'), true);
    assert.equal(await driver.executeScript('return document.querySelector("#responsive").getAttribute("srcset")'), null);
    assert.equal(await driver.findElement(By.id('small')).getAttribute('src'), `${url}/original.jpg`);
    await driver.switchTo().frame(await driver.findElement(By.css('iframe')));
    await driver.wait(async () => (await driver.findElement(By.id('frameImg')).getAttribute('src')).startsWith('moz-extension:'), 5000);
    await driver.switchTo().defaultContent();
    await driver.executeScript('const img=document.createElement("img");img.id="dynamic";img.width=180;img.height=100;img.src="/dynamic.jpg";document.body.append(img)');
    await driver.wait(async () => (await driver.findElement(By.id('dynamic')).getAttribute('src')).startsWith('moz-extension:'), 5000);
    const pageTab = await driver.getWindowHandle();
    await driver.switchTo().newWindow('tab');
    const settingsTab = await driver.getWindowHandle();
    const base = 'moz-extension://82cf49f6-d6ad-44ce-bc1d-9bd2d9c304fe/';
    await driver.get(`${base}ipravdin/options/options.html`);
    await driver.wait(async () => await driver.findElement(By.id('activate')).isEnabled(), 5000);
    await driver.manage().window().setRect({ width: 1280, height: 1100 });
    fs.mkdirSync('artifacts', { recursive: true });
    fs.writeFileSync('artifacts/settings-light.png', await driver.takeScreenshot(), 'base64');
    await driver.setContext(firefox.Context.CHROME);
    await driver.executeScript('Services.prefs.setIntPref("ui.systemUsesDarkTheme", 1)');
    await driver.setContext(firefox.Context.CONTENT);
    await driver.wait(async () => await driver.executeScript('return matchMedia("(prefers-color-scheme: dark)").matches'), 5000);
    fs.writeFileSync('artifacts/settings-dark.png', await driver.takeScreenshot(), 'base64');
    await driver.findElement(By.id('activate')).click();
    await driver.switchTo().window(pageTab);
    await driver.wait(async () => (await driver.findElement(By.id('normal')).getAttribute('src')) === `${url}/original.jpg`, 5000);
    assert.equal(await driver.executeScript('return document.querySelector("#normal").style.objectFit'), 'contain');
    await driver.switchTo().window(settingsTab);
    await driver.wait(async () => await driver.executeAsyncScript('const done=arguments[0];browser.action.getBadgeText({}).then(done)'), 5000);
    await driver.findElement(By.id('domain')).sendKeys('127.0.0.1');
    await driver.findElement(By.id('addDomain')).click();
    await driver.wait(async () => (await driver.findElements(By.css('.domain-list li'))).length === 1, 5000);
    await driver.findElement(By.id('activate')).click();
    await driver.switchTo().window(pageTab);
    await driver.get(url);
    assert.equal(await driver.findElement(By.id('normal')).getAttribute('src'), `${url}/original.jpg`);
    await driver.switchTo().window(settingsTab);
    await driver.findElement(By.css('.domain-list button')).click();
    await driver.wait(async () => (await driver.findElements(By.css('.domain-list li'))).length === 0, 5000);
    await driver.findElement(By.id('skipSmall')).click();
    await driver.switchTo().window(pageTab);
    await driver.wait(async () => (await driver.findElement(By.id('small')).getAttribute('src')).startsWith('moz-extension:'), 5000);
    await driver.switchTo().window(settingsTab);
    await driver.get(`${base}ipravdin/options/popup.html`);
    await driver.wait(async () => await driver.findElement(By.id('activate')).isEnabled(), 5000);
    fs.writeFileSync('artifacts/popup.png', await driver.findElement(By.css('main')).takeScreenshot(), 'base64');
    await driver.findElement(By.id('activate')).click();
    await driver.switchTo().window(pageTab);
    await driver.wait(async () => (await driver.findElement(By.id('normal')).getAttribute('src')) === `${url}/original.jpg`, 5000);
    console.log('Firefox version:', (await driver.getCapabilities()).get('browserVersion'));
    console.log('PASS: Firefox add-on install, local photo decoding, responsive/dynamic images, iframe, restoration, exclusions, settings and popup.');
    console.log('Fixture HTTP requests:', JSON.stringify(requests));
  } finally { await driver.quit(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
