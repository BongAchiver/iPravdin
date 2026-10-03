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
<main id="mw-content-text"><p>Здесь находится учебный текст для проверки пряток. Этот абзац достаточно длинный, чтобы Правдин мог спрятаться внутри статьи, а пользователь мог найти его фотографию и нажать на неё.</p></main>
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
    await driver.switchTo().window(settingsTab);
    await driver.findElement(By.id('activate')).click();
    await driver.get(`${base}ipravdin/options/practice.html`);
    await driver.wait(async () => (await driver.findElements(By.id('ipravdin-encounter'))).length > 0, 5000);
    const game = await driver.findElement(By.id('ipravdin-encounter')).getShadowRoot();
    await driver.wait(async () => (await game.findElements(By.css('.answers button'))).length >= 2, 5000);
    assert.equal(await (await game.findElement(By.css('.pet img'))).getAttribute('alt'), 'Правдин');
    fs.writeFileSync('artifacts/game-question.png', await driver.takeScreenshot(), 'base64');
    await (await game.findElement(By.css('.answers button'))).click();
    await driver.wait(async () => (await (await game.findElement(By.css('p'))).getText()).includes('Правильный ответ'), 5000);
    fs.writeFileSync('artifacts/game-answer.png', await driver.takeScreenshot(), 'base64');
    const progress = await driver.executeAsyncScript('const done=arguments[0];browser.storage.local.get("gameState").then(v=>done(v.gameState))');
    assert.equal(progress.attempted, 1);
    await driver.get(`${base}ipravdin/options/options.html`);
    await driver.wait(async () => (await driver.findElement(By.css('.game-stats')).getText()).includes('баллов'), 5000);
    assert.equal((await driver.findElements(By.css('.specimen'))).length, 15);
    // Force encounters in this disposable profile so browser tests do not wait for random events.
    await driver.executeAsyncScript(`const url=arguments[0],done=arguments[1];Promise.all([browser.tabs.query({}),browser.storage.local.get('gameState')]).then(async ([tabs,v])=>{
      const tab=tabs.find(t=>t.url?.startsWith(url));
      v.gameState.encounter={id:'browser-rare',tab:tab.id,kind:'rare',species:'legend',expires:Date.now()+60000};
      await browser.storage.local.set({gameState:v.gameState});done(true);
    }).catch(e=>done(String(e)))`, url);
    await driver.switchTo().window(pageTab);
    await driver.wait(async () => (await driver.findElements(By.id('ipravdin-encounter'))).length > 0, 25000);
    const rare = await driver.findElement(By.id('ipravdin-encounter')).getShadowRoot();
    assert.match(await (await rare.findElement(By.css('h3'))).getText(), /абсолютный/);
    const rareImage = await rare.findElement(By.css('.pet img'));
    assert.ok((await rareImage.getAttribute('src')).endsWith('/collectibles/legend.jpg'));
    await driver.wait(async () => await driver.executeScript('return arguments[0].naturalWidth > 0', rareImage), 5000);
    const catchButtons = await rare.findElements(By.css('button'));
    for (const b of catchButtons) if ((await b.getText()).includes('Поймать')) await b.click();
    await driver.wait(async () => (await (await rare.findElement(By.css('p'))).getText()).includes('пойман'), 5000);
    fs.writeFileSync('artifacts/game-catch.png', await driver.takeScreenshot(), 'base64');
    await driver.switchTo().window(settingsTab);
    const caught = await driver.executeAsyncScript('const done=arguments[0];browser.storage.local.get("gameState").then(v=>done(v.gameState.collection.legend))');
    assert.equal(caught, 1);
    await driver.executeAsyncScript('const url=arguments[0],done=arguments[1];browser.storage.local.get("gameState").then(async v=>{v.gameState.quest={id:"browser-quest",url};await browser.storage.local.set({gameState:v.gameState});done(true)})', url + '/');
    await driver.switchTo().window(pageTab);
    await driver.wait(async () => (await driver.findElements(By.id('ipravdin-hidden'))).length === 1, 5000);
    assert.equal(await driver.findElement(By.id('normal')).getAttribute('src'), `${url}/original.jpg`);
    const hiding = await driver.findElement(By.id('ipravdin-hidden')).getShadowRoot();
    await (await hiding.findElement(By.css('button'))).click();
    await driver.wait(async () => (await driver.findElements(By.id('ipravdin-hidden'))).length === 0, 5000);
    await driver.switchTo().window(settingsTab);
    const found = await driver.executeAsyncScript('const done=arguments[0];browser.storage.local.get("gameState").then(v=>done(v.gameState.found))');
    assert.equal(found, 1);
    await driver.executeAsyncScript('const done=arguments[0];browser.storage.local.get("gameState").then(async v=>{v.gameState.collection=Object.fromEntries(PravdinGame.species.map(s=>[s.id,1]));await browser.storage.local.set({gameState:v.gameState});done(true)})');
    await driver.wait(async () => await driver.executeScript('return [...document.querySelectorAll(".specimen img")].length===15 && [...document.querySelectorAll(".specimen img")].every(i=>i.naturalWidth>0 && i.src.includes("/collectibles/"))'), 5000);
    await driver.executeScript('document.getElementById("gamePanel").scrollIntoView()');
    fs.writeFileSync('artifacts/game-collection.png', await driver.takeScreenshot(), 'base64');
    await driver.findElement(By.css('.specimen button')).click();
    assert.equal(await driver.findElement(By.css('.specimen-preview')).isDisplayed(), true);
    await driver.findElement(By.css('.specimen-preview button')).click();
    console.log('Firefox version:', (await driver.getCapabilities()).get('browserVersion'));
    console.log('PASS: Firefox add-on install, images, restoration, exclusions, settings, popup, quiz, explanations, grade book, rare capture, collection and hide-and-seek.');
    console.log('Fixture HTTP requests:', JSON.stringify(requests));
  } finally { await driver.quit(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
