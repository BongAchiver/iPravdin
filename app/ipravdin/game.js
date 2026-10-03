globalThis.PravdinGame = (() => {
  'use strict';
  const questions = [
    ['Кванторы', 'Выберите определение lim f(x) = L при x → a (f определена в проколотой окрестности a).', ['∀ε>0 ∃δ>0 ∀x: 0<|x−a|<δ ⇒ |f(x)−L|<ε', '∃δ>0 ∀ε>0 ∀x: 0<|x−a|<δ ⇒ |f(x)−L|<ε', '∀ε>0 ∀δ>0 ∃x: 0<|x−a|<δ ⇒ |f(x)−L|<ε', '∀ε>0 ∃δ>0 ∀x: |f(x)−L|<ε ⇒ |x−a|<δ'], 0, 'Сначала задают любую точность ε, затем подбирают δ. Условие выполняется для всех x из проколотой δ-окрестности.'],
    ['Кванторы', 'Выберите определение сходимости последовательности aₙ к A.', ['∃N ∀ε>0 ∀n≥N: |aₙ−A|<ε', '∀ε>0 ∃N∈ℕ ∀n≥N: |aₙ−A|<ε', '∀ε>0 ∀N∈ℕ ∃n≥N: |aₙ−A|<ε', '∃ε>0 ∃N∈ℕ ∀n≥N: |aₙ−A|<ε'], 1, 'Номер N зависит от ε; после него все члены последовательности близки к A.'],
    ['Отрицание', 'Каково отрицание «∀x∈ℝ ∃y∈ℝ: y>x»?', ['∀x∈ℝ ∃y∈ℝ: y≤x', '∃x∈ℝ ∃y∈ℝ: y≤x', '∃x∈ℝ ∀y∈ℝ: y≤x', '∀x∈ℝ ∀y∈ℝ: y<x'], 2, 'При отрицании ∀ меняется на ∃, ∃ — на ∀, а > — на ≤.'],
    ['Отрицание', 'Отрицание aₙ → A:', ['∀ε>0 ∃N ∀n≥N: |aₙ−A|≥ε', '∃ε>0 ∃N ∀n≥N: |aₙ−A|≥ε', '∀ε>0 ∀N ∃n≥N: |aₙ−A|≥ε', '∃ε>0 ∀N∈ℕ ∃n≥N: |aₙ−A|≥ε'], 3, 'Существует фиксированная точность ε, которую нарушают члены с как угодно большими номерами.'],
    ['Отрицание', 'Выберите отрицание «P ⇒ Q».', ['¬P ⇒ ¬Q', 'P ∧ ¬Q', '¬P ∧ Q', 'P ∨ ¬Q'], 1, 'Импликация ложна только тогда, когда предпосылка истинна, а заключение ложно.'],
    ['Отрицание', 'Отрицание «∀x∈ℝ: P(x) ∨ Q(x)»:', ['∃x∈ℝ: ¬P(x) ∧ ¬Q(x)', '∃x∈ℝ: ¬P(x) ∨ ¬Q(x)', '∀x∈ℝ: ¬P(x) ∧ ¬Q(x)', '∃x∈ℝ: P(x) ∧ Q(x)'], 0, 'Нужно найти хотя бы один x, для которого оба высказывания ложны (закон де Моргана).'],
    ['Истинность', '«Всякая ограниченная последовательность сходится».', ['Истина', 'Ложь'], 1, 'Контрпример: aₙ = (−1)ⁿ. Последовательность ограничена, но не имеет предела.'],
    ['Истинность', '«Если последовательность сходится в ℝ, она ограничена».', ['Истина', 'Ложь'], 0, 'Хвост лежит в ограниченной окрестности предела, а начальных членов конечное число.'],
    ['Истинность', '«Всякая непустая ограниченная сверху часть ℝ имеет супремум в ℝ».', ['Истина', 'Ложь'], 0, 'Это свойство полноты вещественных чисел.'],
    ['Истинность', '«Супремум множества всегда принадлежит этому множеству».', ['Истина', 'Ложь'], 1, 'Например, sup (0,1) = 1, но 1 не принадлежит (0,1).'],
    ['Грани', 'Найдите inf {1/n : n∈ℕ, n≥1}.', ['0', '1', '−∞', 'Не существует'], 0, 'Все элементы положительны и могут быть сколь угодно близки к 0. Инфимум не обязан достигаться.'],
    ['Грани', 'Найдите sup {1−1/n : n∈ℕ, n≥1}.', ['0', '1/2', '1', '+∞'], 2, 'Все элементы меньше 1 и стремятся к 1.'],
    ['Грани', 'Найдите inf (−2,3].', ['−2', '3', '0', 'Не существует'], 0, '−2 — наибольшая нижняя грань, хотя она не входит в множество.'],
    ['Грани', 'Найдите sup {x∈ℝ : x²<2}.', ['2', '√2', '−√2', '1'], 1, 'Множество — интервал (−√2, √2), его наименьшая верхняя грань равна √2.'],
    ['Предел', 'lim (sin x)/x при x → 0 (радианы).', ['0', '1', '+∞', 'Не существует'], 1, 'Первый замечательный предел равен 1.'],
    ['Предел', 'lim (3n²+1)/(2n²−n) при n → ∞.', ['0', '1', '3/2', '+∞'], 2, 'Разделите числитель и знаменатель на n².'],
    ['Предел', 'lim |x|/x при x → 0.', ['0', '1', '−1', 'Не существует'], 3, 'Справа предел равен 1, слева −1; двустороннего предела нет.'],
    ['Предел', 'lim n(√(1+1/n)−1) при n → ∞.', ['0', '1/2', '1', '+∞'], 1, 'После умножения на сопряжённое получается 1/(√(1+1/n)+1).'],
    ['Производная', 'Найдите производную x³.', ['x²', '3x²', '3x', 'x³/3'], 1, 'По правилу степени (xᵐ)′ = m xᵐ⁻¹.'],
    ['Кванторы', 'Непрерывность f в точке a (a принадлежит области определения D):', ['∀ε>0 ∃δ>0 ∀x∈D: |x−a|<δ ⇒ |f(x)−f(a)|<ε', '∃ε>0 ∀δ>0 ∀x∈D: |x−a|<δ ⇒ |f(x)−f(a)|<ε', '∀δ>0 ∃ε>0 ∀x∈D: |f(x)−f(a)|<ε', '∀ε>0 ∃δ>0 ∃x∈D: |x−a|<δ ∧ |f(x)−f(a)|<ε'], 0, 'Для любой точности значений найдётся окрестность аргумента; условие требуется для всех x из D в этой окрестности.']
  ].map((q, id) => ({ id, category: q[0], text: q[1], answers: q[2], correct: q[3], explanation: q[4] }));
  const species = [
    { id: 'ordinary', name: 'Правдин повелитель мела', tier: 0 },
    { id: 'tea', name: 'Правдин чайный', tier: 0 },
    { id: 'sleepy', name: 'Правдин после пары', tier: 0 },
    { id: 'gardener', name: 'Правдин выращивает предел', tier: 0 },
    { id: 'detective', name: 'Правдин ищет контрпример', tier: 0 },
    { id: 'silver', name: 'Правдин ε-ниндзя', tier: 1 },
    { id: 'pirate', name: 'Правдин капитан супремум', tier: 1 },
    { id: 'chef', name: 'Правдин шеф производных', tier: 1 },
    { id: 'skater', name: 'Правдин скользящий предел', tier: 1 },
    { id: 'cyber', name: 'Правдин киберквантор', tier: 1 },
    { id: 'gold', name: 'Правдин маг пределов', tier: 2 },
    { id: 'astronaut', name: 'Правдин на бесконечности', tier: 2 },
    { id: 'dragon', name: 'Правдин укротитель рядов', tier: 2 },
    { id: 'legend', name: 'Правдин абсолютный', tier: 3 },
    { id: 'emperor', name: 'Правдин повелитель кванторов', tier: 3 }
  ].map(s => ({ ...s, image: `ipravdin/collectibles/${s.id}.jpg`, rarity: ['Обычный', 'Редкий', 'Эпический', 'Легендарный'][s.tier], color: ['#8275e8', '#55c9d0', '#efb847', '#f17fae'][s.tier] }));
  const quests = [
    { title: 'Предел функции', hint: 'Здесь приближаются сколь угодно близко. Начните со статьи «Предел функции» в русской Википедии.', url: 'https://ru.wikipedia.org/wiki/Предел_функции' },
    { title: 'Непрерывная функция', hint: 'Малому изменению аргумента — малое изменение значения. Ищите статью «Непрерывная функция» в русской Википедии.', url: 'https://ru.wikipedia.org/wiki/Непрерывная_функция' },
    { title: 'Точная верхняя и нижняя границы', hint: 'Он спрятался между супремумом и инфимумом. Ищите статью «Точная верхняя и нижняя границы» в русской Википедии.', url: 'https://ru.wikipedia.org/wiki/Точная_верхняя_и_нижняя_границы' }
  ];
  const empty = () => ({ mood: 60, xp: 0, solved: 0, attempted: 0, streak: 0, best: 0, pets: 0, found: 0, collection: {}, nextAt: 0, lastPet: 0, encounter: null, quest: null });
  const mood = n => n >= 80 ? 'Доволен вами' : n >= 50 ? 'Присматривается' : n >= 25 ? 'Недоволен' : 'Ждёт на пересдаче';
  const bounded = (n, fallback, max = 100) => Number.isFinite(Number(n)) ? Math.max(0, Math.min(max, Number(n))) : fallback;
  function preferences(value = {}) {
    return { enabled: value.enabled !== false, interval: [5, 10, 30, 60].includes(value.interval) ? value.interval : 5,
      cadenceVersion: 1, debug: value.debug === true, debugIntervalSeconds: bounded(value.debugIntervalSeconds, 10, 3600),
      collectibleChance: bounded(value.collectibleChance, 4),
      events: Object.fromEntries(Object.entries({ quiz: 55, rare: 25, watch: 20 }).map(([k, n]) => [k, bounded(value.events?.[k], n)])),
      rarities: [65, 25, 8.5, 1.5].map((n, i) => bounded(value.rarities?.[i], n)) };
  }
  function weighted(r, weights) {
    const total = weights.reduce((a, b) => a + b, 0); if (!total) return -1;
    let position = r * total;
    for (let i = 0; i < weights.length; i++) { position -= weights[i]; if (position < 0) return i; }
    return weights.findLastIndex(n => n > 0);
  }
  function roll(r, variant = Math.random(), weights = [65, 25, 8.5, 1.5]) {
    const tier = weighted(r, weights); if (tier < 0) return null;
    const pool = species.filter(s => s.tier === tier);
    return pool[Math.min(pool.length - 1, Math.floor(variant * pool.length))];
  }
  function eventKind(r, events = { quiz: 55, watch: 20, rare: 25 }) { return ['quiz', 'watch', 'rare'][weighted(r, [events.quiz, events.watch, events.rare])] || null; }
  function visual(state = {}, now = Date.now()) {
    const n = bounded(state.mood, 60);
    const action = state.lastAction && now - state.lastAction.at < 6000 ? state.lastAction.kind : null;
    return { mood: n, label: mood(n), color: n >= 80 ? '#a4d85e' : n >= 50 ? '#b0a0ff' : n >= 25 ? '#efbd69' : '#e7858e',
      photo: action === 'tea' ? 'ipravdin/collectibles/tea.jpg' : action === 'pet' || n >= 80 ? 'ipravdin/reactions/happy.jpg' : n < 50 ? 'ipravdin/reactions/stern.jpg' : 'ipravdin/photos/portrait.jpg',
      action, text: action ? state.lastAction.text : mood(n) };
  }
  function shuffled(question, random = Math.random) {
    const order = question.answers.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    return { ...question, answers: order.map(i => question.answers[i]), correct: order.indexOf(question.correct) };
  }
  const samePage = (a, b) => { try { const x = new URL(a), y = new URL(b); return x.origin === y.origin && decodeURIComponent(x.pathname) === decodeURIComponent(y.pathname); } catch { return false; } };
  return { questions, species, quests, empty, mood, roll, eventKind, preferences, visual, shuffled, samePage };
})();
