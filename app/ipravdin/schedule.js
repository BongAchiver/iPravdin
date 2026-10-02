globalThis.ItmoSchedule = (() => {
  'use strict';
  const origin = 'https://my.itmo.ru';
  const issuer = 'https://id.itmo.ru/auth/realms/itmo';
  const timezone = 'Europe/Moscow';
  function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('DATE');
    const parsed = new Date(`${value}T12:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('DATE');
    return value;
  }
  function today(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const get = type => parts.find(part => part.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  function shift(value, amount) {
    const parsed = new Date(`${date(value)}T12:00:00Z`);
    parsed.setUTCDate(parsed.getUTCDate() + amount);
    return parsed.toISOString().slice(0, 10);
  }
  function text(value, limit = 300) { return typeof value === 'string' ? value.slice(0, limit).trim() : ''; }
  function time(value) {
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value)) throw new Error('FORMAT');
    return value.slice(0, 5);
  }
  function normalize(payload, selectedDate) {
    date(selectedDate);
    if (!payload || payload.code !== 0 || !Array.isArray(payload.data) || payload.data.length > 100) throw new Error('FORMAT');
    const lessons = [];
    for (const day of payload.data) {
      if (!day || !Array.isArray(day.lessons) || day.lessons.length > 500) throw new Error('FORMAT');
      const dayDate = date(day.date);
      if (dayDate !== selectedDate) continue;
      for (const lesson of day.lessons) {
        if (!lesson || !text(lesson.subject)) throw new Error('FORMAT');
        const start = time(lesson.time_start), end = time(lesson.time_end);
        if (end <= start) throw new Error('FORMAT');
        lessons.push({ start, end, subject: text(lesson.subject), teacher: text(lesson.teacher_name),
          room: typeof lesson.room === 'number' ? String(lesson.room) : text(lesson.room),
          building: text(lesson.building), type: text(lesson.work_type), note: text(lesson.note, 600) });
        if (lessons.length > 500) throw new Error('FORMAT');
      }
    }
    return lessons.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  }
  function progress(lesson, selectedDate, now = new Date()) {
    const start = new Date(`${date(selectedDate)}T${lesson.start}:00+03:00`).getTime();
    const end = new Date(`${selectedDate}T${lesson.end}:00+03:00`).getTime();
    return now.getTime() < start ? 'upcoming' : now.getTime() < end ? 'current' : 'finished';
  }
  return { origin, issuer, timezone, date, today, shift, text, normalize, progress };
})();
