(() => {
  'use strict';
  const report = text => { const p = document.getElementById('practiceStatus'); if (p) p.textContent = text; };
  window.addEventListener('error', event => report(`Не удалось открыть карточку: ${event.message}. Нажмите «Повторить запуск» или обновите дополнение.`));
  window.addEventListener('unhandledrejection', event => report(`Не удалось открыть карточку: ${event.reason?.message || event.reason}. Нажмите «Повторить запуск».`));
})();
