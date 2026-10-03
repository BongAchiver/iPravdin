const { Builder, By } = require('selenium-webdriver');
const firefox = require('selenium-webdriver/firefox');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const requests = [];
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Image replacement fixture</title></head><body>
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
    const signed = process.argv[2] === '--signed' ? path.resolve(process.argv[3]) : null;
    await driver.installAddon(signed || path.resolve('dist', zip), !signed);
    await driver.get('moz-extension://82cf49f6-d6ad-44ce-bc1d-9bd2d9c304fe/ipravdin/options/options.html');
    await driver.executeAsyncScript('const done=arguments[0];browser.storage.local.set({gamePrefs:PravdinGame.preferences({collectibleChance:0})}).then(done)');
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
    await driver.wait(async () => (await driver.findElement(By.css('.mood-value')).getText()).includes('/100'), 5000);
    await driver.executeAsyncScript('const done=arguments[0];browser.storage.local.get("gameState").then(async v=>{v.gameState={...PravdinGame.empty(),...v.gameState,mood:24};await browser.storage.local.set({gameState:v.gameState});done(true)})');
    await driver.wait(async () => (await driver.findElement(By.css('[role="progressbar"]')).getAttribute('aria-valuenow')) === '24', 5000);
    await driver.wait(async () => (await driver.findElement(By.css('.companion-photo')).getAttribute('src')).endsWith('/reactions/stern.jpg'), 5000);
    await driver.findElement(By.css('.companion-head')).click();
    await driver.wait(async () => (await driver.findElement(By.css('[role="progressbar"]')).getAttribute('aria-valuenow')) === '27', 5000);
    await driver.wait(async () => (await driver.findElement(By.css('.companion-photo')).getAttribute('src')).endsWith('/reactions/happy.jpg'), 5000);
    const talk = await driver.findElement(By.css('.companion-actions [data-interact="talk"]'));
    assert.ok((await talk.getText()).includes('Поболтать'));
    await talk.click();
    await driver.wait(async () => await driver.executeAsyncScript('const done=arguments[0];browser.storage.local.get("gameState").then(v=>done(v.gameState.lastAction.kind==="talk"))'), 5000);
    const phrases = new Set();
    for (let i = 0; i < 6; i++) {
      await driver.wait(async () => await talk.isEnabled(), 5000); await talk.click();
      await driver.wait(async () => await talk.isEnabled(), 5000);
      const phrase = await driver.executeAsyncScript('const done=arguments[0];browser.storage.local.get("gameState").then(v=>done(v.gameState.lastAction.text))');
      assert.ok(!phrases.has(phrase)); phrases.add(phrase);
    }
    assert.equal(await driver.executeScript('return PravdinGame.questions.length'), 404);
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
    // Use the user-facing debug controls to inject a page image and capture it.
      await driver.findElement(By.id('debugEnabled')).click();
      for (const [control, selector, screenshot] of [
        ['debugQuiz', '.answers button', 'game-corner'],
        ['debugTicket', '.answers button', 'game-debug-ticket'],
        ['debugWatch', '.pet img', 'game-watch']
      ]) {
        await driver.findElement(By.id(control)).click();
        await driver.switchTo().window(pageTab);
        await driver.wait(async () => (await driver.findElements(By.id('ipravdin-encounter'))).length > 0, 5000);
        const encounterRoot = await driver.findElement(By.id('ipravdin-encounter')).getShadowRoot();
        await driver.wait(async () => (await encounterRoot.findElements(By.css(selector))).length > 0, 5000);
        if (control === 'debugTicket') assert.ok((await (await encounterRoot.findElement(By.css('h3'))).getText()).includes('Билет'));
        if (control === 'debugWatch') assert.equal(await (await encounterRoot.findElement(By.css('h3'))).getText(), 'Правдин наблюдает');
        fs.writeFileSync(`artifacts/${screenshot}.png`, await driver.takeScreenshot(), 'base64');
        await (await encounterRoot.findElement(By.css('.bar button'))).click();
        await driver.wait(async () => (await driver.findElements(By.id('ipravdin-encounter'))).length === 0, 5000);
        await driver.switchTo().window(settingsTab);
      }
      await driver.executeScript('document.getElementById("debugSpecies").value="legend"');
    await driver.findElement(By.id('debugImage')).click();
    await driver.switchTo().window(pageTab);
    await driver.wait(async () => (await driver.findElements(By.css('[data-ipravdin-collectible="legend"]'))).length > 0, 5000);
    const card = await driver.findElement(By.css('[data-ipravdin-collectible="legend"]'));
      assert.ok((await card.getAttribute('src')).endsWith('/collectibles/legend.jpg'));
      assert.equal(await driver.executeScript('return arguments[0].style.objectFit', card), 'contain');
    await driver.wait(async () => await driver.executeScript('return arguments[0].naturalWidth > 0', card), 5000);
    fs.writeFileSync('artifacts/game-image-card.png', await driver.takeScreenshot(), 'base64');
    await card.click();
    await driver.wait(async () => (await card.getAttribute('src')).includes('/photos/'), 5000);
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
    // Manual tickets must work with both image replacement and automatic events off.
    await driver.executeAsyncScript('const done=arguments[0];browser.storage.local.get("gameState").then(async v=>{v.gameState.encounter=null;v.gameState.ticketDay=null;await browser.storage.local.set({activate:false,gamePrefs:PravdinGame.preferences({enabled:false,collectibleChance:0}),gameState:v.gameState});done(true)})');
    await driver.get(`${base}ipravdin/options/practice.html?mode=ticket`);
    await driver.wait(async () => (await driver.findElements(By.id('ipravdin-encounter'))).length > 0, 5000);
    const ticket = await driver.findElement(By.id('ipravdin-encounter')).getShadowRoot();
    for (let i=0;i<3;i++) {
      await driver.wait(async () => (await ticket.findElements(By.css('.answers button'))).length >= 2, 5000);
      const correct = await driver.executeAsyncScript('const done=arguments[0];browser.storage.local.get("gameState").then(v=>done(v.gameState.encounter.question.correct))');
      await (await ticket.findElements(By.css('.answers button')))[correct].click();
      await driver.wait(async () => (await (await ticket.findElement(By.css('p'))).getText()).includes(': '), 5000);
      if (i<2) { const buttons=await ticket.findElements(By.css('button')); await buttons[1].click(); }
    }
    await driver.wait(async () => (await (await ticket.findElement(By.css('p'))).getText()).includes('3/3'), 5000);
    fs.writeFileSync('artifacts/game-ticket.png', await driver.takeScreenshot(), 'base64');
    console.log('Firefox version:', (await driver.getCapabilities()).get('browserVersion'));
    console.log('PASS: Firefox add-on install, images, restoration, exclusions, settings, popup, quiz, explanations, grade book, page image capture, collection, hide-and-seek, live popup mood, reactions and manual ticket with automatic events off.');
    console.log('Fixture HTTP requests:', JSON.stringify(requests));
  } finally { await driver.quit(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
