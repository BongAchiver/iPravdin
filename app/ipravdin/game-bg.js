(() => {
  'use strict';
  const G = PravdinGame;
  let queue = Promise.resolve();
  const prefs = value => ({ enabled: value?.enabled !== false, interval: [10, 30, 60].includes(value?.interval) ? value.interval : 30 });
  browser.tabs?.onRemoved?.addListener(tabId => {
    queue = queue.then(async () => {
      const { gameState } = await browser.storage.local.get(['gameState']);
      if (gameState?.encounter?.tab === tabId) await browser.storage.local.set({ gameState: { ...gameState, encounter: null } });
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
      const available = settings.activate && options.enabled && (!sender.tab || !PravdinSettings.blocked(new URL(sender.url).hostname, settings.excluded));
      const delay = () => now + options.interval * 60000 * (.75 + Math.random() * .5);
      const publicState = () => ({ state, prefs: options });
      if (message.action === 'read') return publicState();
      if (message.action === 'prefs') {
        await browser.storage.local.set({ gamePrefs: prefs(message.value) });
        state.nextAt = 0; state.encounter = null;
      } else if (message.action === 'quest') {
        if (!available) return { error: 'Включите режим Правдина и игровые события.' };
        state.quest = { ...G.quests[Math.floor(Math.random() * G.quests.length)], id: `${now}-${Math.random()}` };
      } else if (message.action === 'cancelQuest') {
        state.quest = null;
      } else if (message.action === 'found') {
        if (!available || !state.quest || !sender.tab || !G.samePage(sender.url, state.quest.url) || message.id !== state.quest.id) return { error: 'Этот квест уже завершён.' };
        state.quest = null; state.found++; state.xp += 25; state.mood = Math.min(100, state.mood + 10);
      } else if (message.action === 'pet') {
        if (!available) return { error: 'Игровой режим выключен.' };
        if (now - state.lastPet < 30000) return { ...publicState(), text: 'Достаточно ласки. Теперь бы ещё матан…' };
        state.lastPet = now; state.pets++; state.mood = Math.min(100, state.mood + 3);
      } else if (message.action === 'tea') {
        if (!available) return { error: 'Игровой режим выключен.' };
        if (now - (state.lastTea || 0) < 300000) return { ...publicState(), text: 'Спасибо, чай ещё не остыл.' };
        state.lastTea = now; state.mood = Math.min(100, state.mood + 2);
        await browser.storage.local.set({ gameState: state });
        return { ...publicState(), text: 'Чай — хорошо. А доказательство ещё лучше. +2 к настроению.' };
      } else if (message.action === 'talk') {
        return { ...publicState(), text: ['Вы кванторы местами не меняйте. Это вам не мебель.', 'Бесконечность — не число. А пересдач может быть много.', 'Не всякая верхняя грань — супремум. Не всякий ответ — доказательство.', 'Сегодня мы с вами непрерывно учимся. Надеюсь.'][Math.floor(Math.random() * 4)] };
      } else if (message.action === 'claim' || message.action === 'quiz' || message.action === 'ticket') {
        if (!available || (message.action === 'claim' && !sender.tab)) return { error: 'На этой странице игровые события недоступны.' };
        if (state.encounter && state.encounter.expires <= now) state.encounter = null;
        if (state.encounter && state.encounter.tab !== (sender.tab?.id ?? -1)) return { error: 'Правдин уже ждёт ответа в другой вкладке.' };
        if (!state.encounter) {
          if (message.action === 'claim') {
            if (!state.nextAt) { state.nextAt = delay(); await browser.storage.local.set({ gameState: state }); return publicState(); }
            if (now < state.nextAt) return publicState();
          }
          if (message.action === 'ticket' && state.ticketDay === new Date(now).toDateString()) return { error: 'Сегодняшний билет уже выдан. Можно решать обычные задачи.' };
          const r = Math.random();
          const kind = message.action !== 'claim' ? 'quiz' : G.eventKind(r);
          state.encounter = { id: `${now}-${Math.random()}`, tab: sender.tab?.id ?? -1, kind, expires: now + 15 * 60000 };
          if (kind === 'quiz') state.encounter.question = G.shuffled(G.questions[Math.floor(Math.random() * G.questions.length)]);
          if (kind === 'rare') state.encounter.species = G.roll(Math.random()).id;
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
          text = `${correct ? 'Верно. Можете, когда хотите.' : 'А на лекции мы чем занимались?'}\nПравильный ответ: ${e.question.answers[e.question.correct]}\n${e.question.explanation}`;
          if (e.ticket) {
            e.ticket.left--; e.ticket.correct += Number(correct);
            if (e.ticket.left) {
              const pool = G.questions.filter(q => !e.ticket.seen.includes(q.id));
              const q = pool[Math.floor(Math.random() * pool.length)]; e.ticket.seen.push(q.id);
              e.question = G.shuffled(q); e.id = `${now}-${Math.random()}`;
            } else { text += `\nБилет: ${e.ticket.correct}/3. ${e.ticket.correct === 3 ? 'Зачёт! +20 баллов.' : 'Разберите ошибки и возвращайтесь завтра.'}`; if (e.ticket.correct === 3) state.xp += 20; state.encounter = null; }
          } else state.encounter = null;
        } else if (message.action === 'catch') {
          if (e.kind !== 'rare') return { error: 'Здесь некого ловить.' };
          state.collection[e.species] = (state.collection[e.species] || 0) + 1; state.xp += 15;
          text = `${G.species.find(s => s.id === e.species).name} пойман! +15 баллов.`; state.encounter = null;
        } else {
          if (e.kind === 'quiz') { state.mood = Math.max(0, state.mood - 3); state.streak = 0; text = 'На пересдаче увидимся.'; }
          state.encounter = null;
        }
        await browser.storage.local.set({ gameState: state });
        return { ...publicState(), text };
      } else return { error: 'Неизвестное действие.' };
      await browser.storage.local.set({ gameState: state });
      return publicState();
    });
    queue = task.catch(error => console.error('iPravdin: game update failed', error));
    return task;
  });
})();
