(() => {
  'use strict';
  const G = PravdinGame;
  let queue = Promise.resolve();
  const prefs = G.preferences;
  browser.runtime.onInstalled?.addListener(() => {
    const task = queue.then(async () => {
      const stored = await browser.storage.local.get(['gamePrefs', 'gameState']);
      if (stored.gamePrefs?.cadenceVersion === 1) return;
      const options = prefs(stored.gamePrefs);
      if (!stored.gamePrefs?.interval || options.interval === 30) options.interval = 5;
      const state = { ...G.empty(), ...stored.gameState };
      state.nextAt = Math.min(state.nextAt || Infinity, Date.now() + options.interval * 60000);
      await browser.storage.local.set({ gamePrefs: options, gameState: state });
    }); queue = task.catch(error => console.error('iPravdin: cadence migration failed', error)); return task;
  });
  browser.tabs?.onRemoved?.addListener(tabId => {
    queue = queue.then(async () => {
      const { gameState } = await browser.storage.local.get(['gameState']);
      if (gameState) { if (gameState.encounter?.tab === tabId) gameState.encounter = null;
        gameState.imageCards = Object.fromEntries(Object.entries(gameState.imageCards || {}).filter(([, c]) => c.tab !== tabId));
        await browser.storage.local.set({ gameState }); }
    }).catch(error => console.error('iPravdin: cannot release encounter', error));
  });
  browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.channel !== 'pravdin-game') return undefined;
    const task = queue.then(async () => {
      // Firefox extension pages do not include sender.tab; verify their own tab before assigning ownership.
      if (!sender.tab && Number.isInteger(message.tabId) && sender.url?.startsWith(browser.runtime.getURL('ipravdin/options/practice.html'))) {
        const tab = await browser.tabs.get(message.tabId);
        if (tab.url !== sender.url) return { error: 'Учебная вкладка уже закрыта.' };
        sender = { ...sender, tab: { id: tab.id } };
      }
      const stored = await browser.storage.local.get(['gameState', 'gamePrefs', ...Object.keys(PravdinSettings.defaults)]);
      const state = { ...G.empty(), ...stored.gameState };
      const options = prefs(stored.gamePrefs);
      const settings = PravdinSettings.normalize(stored);
      const now = Date.now();
      let responseText;
      const extensionPage = sender.url?.startsWith(browser.runtime.getURL?.('ipravdin/options/') || 'moz-extension://test/ipravdin/options/');
      const manual = extensionPage && ['quiz', 'ticket', 'pet', 'tea', 'talk'].includes(message.action);
      const available = settings.activate && options.enabled && (!sender.tab || !PravdinSettings.blocked(new URL(sender.url).hostname, settings.excluded));
      const delay = () => now + (options.debug ? options.debugIntervalSeconds * 1000 : options.interval * 60000);
      state.imageCards = Object.fromEntries(Object.entries(state.imageCards || {}).filter(([, c]) => c.expires > now));
      const reaction = (kind, text) => { state.lastAction = { kind, text, at: now }; };
      const publicState = () => ({ state, prefs: options });
      if (message.action === 'read') return publicState();
      if (message.action === 'prefs') {
        await browser.storage.local.set({ gamePrefs: prefs(message.value) });
        state.nextAt = 0; state.encounter = null;
      } else if (message.action === 'debugEvent') {
        if (!extensionPage || !options.debug || !['quiz', 'ticket', 'watch', 'rare'].includes(message.event)) return { error: 'Включите режим отладки.' };
        const tab = await browser.tabs.get(message.targetTab);
        if (!/^https?:/.test(tab.url || '')) return { error: 'Выберите обычную веб-страницу.' };
        state.encounter = { id: `${now}-${Math.random()}`, tab: tab.id, kind: message.event === 'ticket' ? 'quiz' : message.event, expires: now + 15 * 60000, debug: true };
        if (state.encounter.kind === 'quiz') state.encounter.question = G.nextQuestion(state);
        if (state.encounter.kind === 'watch') state.encounter.text = G.phrase(state, 'watch');
        if (message.event === 'ticket') state.encounter.ticket = { left: 3, correct: 0, seen: [state.encounter.question.id] };
        if (message.event === 'rare') state.encounter.species = message.species && G.species.find(s => s.id === message.species)?.id || G.roll(Math.random(), Math.random(), options.rarities)?.id;
        state.nextAt = delay();
      } else if (message.action === 'spawnImage') {
        if (!available || !sender.tab || !/^https?:/.test(sender.url || '')) return { card: null };
        const event = state.encounter?.tab === sender.tab.id && state.encounter.id === message.encounterId && state.encounter.kind === 'rare' ? state.encounter : null;
        const forced = options.debug && message.force === true;
        if (!forced && !event && Math.random() * 100 >= options.collectibleChance) return { card: null };
        if (Object.values(state.imageCards).filter(c => c.tab === sender.tab.id).length >= 3) return { card: null, error: 'На странице уже три коллекционки. Соберите или очистите их.' };
        const s = (forced && G.species.find(s => s.id === message.species)) || (event?.species && G.species.find(s => s.id === event.species)) || G.roll(Math.random(), Math.random(), options.rarities);
        if (!s) return { card: null };
        const card = { id: `${now}-${Math.random()}`, tab: sender.tab.id, species: s.id, expires: now + 3600000 };
        state.imageCards[card.id] = card;
        if (event) state.encounter = null;
        await browser.storage.local.set({ gameState: state }); return { card };
      } else if (message.action === 'releaseImage') {
        if (state.imageCards[message.id]?.tab === sender.tab?.id) delete state.imageCards[message.id];
      } else if (message.action === 'catchImage') {
        const card = state.imageCards[message.id];
        if (!available || !card || card.tab !== sender.tab?.id) return { error: 'Эта карточка уже собрана или встреча закончилась.' };
        delete state.imageCards[message.id]; state.collection[card.species] = (state.collection[card.species] || 0) + 1; state.xp += 15;
        await browser.storage.local.set({ gameState: state }); return { ...publicState(), text: `${G.species.find(s => s.id === card.species).name} собран! +15 баллов.` };
      } else if (message.action === 'quest') {
        if (!available) return { error: 'Включите режим Правдина и игровые события.' };
        state.quest = { ...G.quests[Math.floor(Math.random() * G.quests.length)], id: `${now}-${Math.random()}` };
      } else if (message.action === 'cancelQuest') {
        state.quest = null;
      } else if (message.action === 'found') {
        if (!available || !state.quest || !sender.tab || !G.samePage(sender.url, state.quest.url) || message.id !== state.quest.id) return { error: 'Этот квест уже завершён.' };
        state.quest = null; state.found++; state.xp += 25; state.mood = Math.min(100, state.mood + 10);
        responseText = `${G.phrase(state, 'found')} +25 баллов.`;
      } else if (message.action === 'pet') {
        if (!available && !manual) return { error: 'Игровой режим выключен.' };
        if (now - state.lastPet < 30000) { const text = G.phrase(state, 'petWait'); await browser.storage.local.set({ gameState: state }); return { ...publicState(), text }; }
        state.lastPet = now; state.pets++; state.mood = Math.min(100, state.mood + 3);
        responseText = G.phrase(state, 'pet'); reaction('pet', responseText);
      } else if (message.action === 'tea') {
        if (!available && !manual) return { error: 'Игровой режим выключен.' };
        if (now - (state.lastTea || 0) < 300000) { const text = G.phrase(state, 'teaWait'); await browser.storage.local.set({ gameState: state }); return { ...publicState(), text }; }
        state.lastTea = now; state.mood = Math.min(100, state.mood + 2);
        const text = G.phrase(state, 'tea'); reaction('tea', text);
        await browser.storage.local.set({ gameState: state });
        return { ...publicState(), text: `${text} +2 к настроению.` };
      } else if (message.action === 'talk') {
        const text = G.phrase(state, 'talk');
        reaction('talk', text); await browser.storage.local.set({ gameState: state }); return { ...publicState(), text };
      } else if (message.action === 'claim' || message.action === 'quiz' || message.action === 'ticket') {
        if ((!available && !manual) || (message.action === 'claim' && !sender.tab)) return { error: 'На этой странице игровые события недоступны.' };
        if (state.encounter && state.encounter.expires <= now) state.encounter = null;
        if (state.encounter && manual && message.takeover) {
          if (state.encounter.kind === 'quiz' && Boolean(state.encounter.ticket) === (message.action === 'ticket')) state.encounter.tab = sender.tab?.id ?? -1;
          else state.encounter = null;
        }
        if (state.encounter && state.encounter.tab !== (sender.tab?.id ?? -1)) return { error: 'Правдин уже ждёт ответа в другой вкладке. Откройте новый опрос здесь.' };
        if (!state.encounter) {
          if (message.action === 'claim') {
            if (!state.nextAt) { state.nextAt = delay(); await browser.storage.local.set({ gameState: state }); return publicState(); }
            if (now < state.nextAt) return publicState();
          }
          if (message.action === 'ticket' && state.ticketDay === new Date(now).toDateString()) return { error: 'Сегодняшний билет уже выдан. Можно решать обычные задачи.' };
          const r = Math.random();
          const kind = message.action !== 'claim' ? 'quiz' : G.eventKind(r, options.events);
          if (!kind) { state.nextAt = delay(); await browser.storage.local.set({ gameState: state }); return publicState(); }
          state.encounter = { id: `${now}-${Math.random()}`, tab: sender.tab?.id ?? -1, kind, expires: now + 15 * 60000 };
          if (kind === 'quiz') state.encounter.question = G.nextQuestion(state);
          if (kind === 'watch') state.encounter.text = G.phrase(state, 'watch');
          if (kind === 'rare') state.encounter.species = G.roll(Math.random(), Math.random(), options.rarities)?.id;
          if (message.action === 'ticket') { state.ticketDay = new Date(now).toDateString(); state.encounter.ticket = { left: 3, correct: 0, seen: [state.encounter.question.id] }; }
          state.nextAt = delay();
        }
      } else if (['answer', 'skip', 'catch', 'dismiss'].includes(message.action)) {
        const e = state.encounter;
        if (!e || e.tab !== (sender.tab?.id ?? -1) || e.id !== message.id || e.expires < now) return { error: 'Эта встреча уже закончилась.' };
        let text = '';
        if (message.action === 'answer') {
          if (e.kind !== 'quiz' || !Number.isInteger(message.answer) || message.answer < 0 || message.answer >= e.question.answers.length) return { error: 'Выберите вариант ответа.' };
          const correct = message.answer === e.question.correct;
          state.attempted++; state.solved += Number(correct); state.streak = correct ? state.streak + 1 : 0;
          state.best = Math.max(state.best, state.streak); state.xp += correct ? 10 : 0;
          state.mood = Math.max(0, Math.min(100, state.mood + (correct ? 7 : -6)));
          text = `${G.phrase(state, correct ? 'correct' : 'wrong')}\nПравильный ответ: ${e.question.answers[e.question.correct]}\n${e.question.explanation}`;
          if (e.ticket) {
            e.ticket.left--; e.ticket.correct += Number(correct);
            if (e.ticket.left) {
              e.question = G.nextQuestion(state, e.ticket.seen); e.ticket.seen.push(e.question.id); e.id = `${now}-${Math.random()}`;
            } else { text += `\nБилет: ${e.ticket.correct}/3. ${G.phrase(state, e.ticket.correct === 3 ? 'ticketGood' : 'ticketRetry')}`; if (e.ticket.correct === 3) state.xp += 20; state.encounter = null; }
          } else state.encounter = null;
        } else if (message.action === 'catch') {
          if (e.kind !== 'rare') return { error: 'Здесь некого ловить.' };
          state.collection[e.species] = (state.collection[e.species] || 0) + 1; state.xp += 15;
          text = `${G.species.find(s => s.id === e.species).name} пойман! +15 баллов.`; state.encounter = null;
        } else {
          if (e.kind === 'quiz') { state.mood = Math.max(0, state.mood - 3); state.streak = 0; text = G.phrase(state, 'skip'); }
          state.encounter = null;
        }
        await browser.storage.local.set({ gameState: state });
        return { ...publicState(), text };
      } else return { error: 'Неизвестное действие.' };
      await browser.storage.local.set({ gameState: state });
      return { ...publicState(), ...(responseText ? { text: responseText } : {}) };
    });
    queue = task.catch(error => console.error('iPravdin: game update failed', error));
    return task;
  });
})();
