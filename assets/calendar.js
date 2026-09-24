(() => {
  'use strict';
  const DAY = 86400000;
  const JST = 9 * 60 * 60 * 1000;
  const dayFormatter = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
  const shortFormatter = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric' });
  const timeFormatter = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const dayKey = timestamp => new Date(timestamp + JST).toISOString().slice(0, 10);
  const parseDate = value => {
    if (typeof value !== 'string') return NaN;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const timestamp = Date.parse(`${value}T00:00:00+09:00`);
      return Number.isFinite(timestamp) && dayKey(timestamp) === value ? timestamp : NaN;
    }
    // A missing offset is interpreted in the calendar's time zone, never the visitor's.
    if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i.test(value) || !Number.isFinite(parseDate(value.slice(0, 10)))) return NaN;
    return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}+09:00`);
  };
  const normalizeEvents = entries => entries.flatMap(entry => {
    if (!entry || entry.status === 'cancelled') return [];
    const start = parseDate(entry.start), end = parseDate(entry.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    return [{ start, end, allDay: entry.allDay === true || /^\d{4}-\d{2}-\d{2}$/.test(entry.start), title: typeof entry.title === 'string' ? entry.title : '', location: typeof entry.location === 'string' ? entry.location : '', fee: typeof entry.fee === 'string' ? entry.fee : '' }];
  }).sort((a, b) => a.start - b.start);
  const readData = data => {
    if (!data || !Array.isArray(data.events)) throw new Error('Invalid calendar data');
    if (data.updatedAt === null) return { state: 'uninitialized', events: [] };
    const updatedAt = parseDate(data.updatedAt);
    if (!Number.isFinite(updatedAt)) throw new Error('Invalid update date');
    return { state: 'ready', events: normalizeEvents(data.events), updatedAt, rangeStart: parseDate(data.rangeStart), rangeEnd: parseDate(data.rangeEnd) };
  };
  const eventsOnDay = (events, key) => {
    const start = parseDate(key);
    return events.filter(event => event.start < start + DAY && event.end > start);
  };
  const nextEvent = (events, now) => events.find(event => event.end > now);
  const eventTime = event => {
    const first = dayKey(event.start), last = dayKey(event.end - 1);
    if (event.allDay) return first === last ? '時刻未登録' : `${shortFormatter.format(event.start)}–${shortFormatter.format(event.end - 1)}（時刻未登録）`;
    if (dayKey(event.start) !== dayKey(event.end)) return `${shortFormatter.format(event.start)} ${timeFormatter.format(event.start)}–${shortFormatter.format(event.end)} ${timeFormatter.format(event.end)}`;
    return `${timeFormatter.format(event.start)}–${timeFormatter.format(event.end)}`;
  };
  const eventVenue = event => {
    const location = (event.location || '').trim();
    const title = (event.title || '').trim();
    const candidate = location || title;
    // Match the facility name: the group name 「刀禅日吉」 also appears in Tsunashima titles.
    for (const [name, label] of [['日吉地区センター', '日吉'], ['綱島地区センター', '綱島']]) {
      if (candidate.includes(name)) return { key: name, label, name: location || name };
    }
    const cleanTitle = title.replace(/【[^】]*】/g, '').trim();
    const facility = cleanTitle.match(/(?:^|[\s@＠:：/／])([^\s@＠:：/／]+(?:コミュニティハウス|公会堂|体育館|武道館|道場|公民館|会館|ホール|集会所|スタジオ|センター))(?:$|[\s（(]|で|にて)/)?.[1];
    const name = location || facility || '';
    if (!name) return { key: '', label: '会場確認', name: '会場はGoogleカレンダーで確認' };
    const letters = Array.from(name);
    return { key: name, label: letters.length > 5 ? `${letters.slice(0, 5).join('')}…` : name, name };
  };
  const monthDays = (year, month) => {
    const first = new Date(Date.UTC(year, month, 1));
    const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const cells = Array(first.getUTCDay()).fill(null);
    for (let day = 1; day <= count; day++) cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    while (cells.length % 7) cells.push(null);
    return cells;
  };
  const monthCoverage = (data, year, month) => {
    const start = Date.UTC(year, month, 1) - JST;
    const end = Date.UTC(year, month + 1, 1) - JST;
    if ((Number.isFinite(data.rangeStart) && start < data.rangeStart) || (Number.isFinite(data.rangeEnd) && end > data.rangeEnd)) return 'partial';
    return 'full';
  };

  // Keep date calculations independently testable without loading a browser.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { dayKey, parseDate, normalizeEvents, readData, eventsOnDay, nextEvent, eventTime, eventVenue, monthDays, monthCoverage };
    return;
  }
  const root = document.querySelector('[data-practice-calendar]');
  if (!root) return;
  const config = window.HIYOSHI_CONFIG || {};
  const title = document.querySelector('[data-next-title]');
  const nextDetails = document.querySelector('[data-next-details]');
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const now = Date.now();
  const today = dayKey(now);
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7)) - 1;
  let selectedDay = '';
  let data = { state: 'loading', events: [] };
  const toolbar = make('div', 'practice-calendar__toolbar');
  const previous = make('button', 'practice-calendar__nav', '‹');
  previous.type = 'button'; previous.setAttribute('aria-label', '前の月');
  const heading = make('h3', 'practice-calendar__month');
  heading.setAttribute('aria-live', 'polite'); heading.setAttribute('aria-atomic', 'true');
  const next = make('button', 'practice-calendar__nav', '›');
  next.type = 'button'; next.setAttribute('aria-label', '次の月');
  toolbar.append(previous, heading, next);
  const table = make('table', 'practice-calendar__table');
  const caption = make('caption', 'visually-hidden');
  const head = make('thead');
  const weekdays = make('tr');
  ['日', '月', '火', '水', '木', '金', '土'].forEach(day => {
    const cell = make('th', '', day); cell.scope = 'col'; weekdays.append(cell);
  });
  head.append(weekdays);
  const body = make('tbody');
  table.append(caption, head, body);
  const status = make('p', 'practice-calendar__status');
  status.setAttribute('role', 'status');
  const details = make('div', 'practice-calendar__details');
  details.id = 'practice-calendar-details';
  details.setAttribute('aria-live', 'polite'); details.setAttribute('aria-atomic', 'true');
  root.replaceChildren(toolbar, table, status, details);
  root.setAttribute('aria-busy', 'true');

  function renderDetails() {
    details.replaceChildren();
    if (!selectedDay) { details.hidden = true; return; }
    const events = eventsOnDay(data.events, selectedDay);
    if (!events.length) { details.hidden = true; return; }
    details.hidden = false;
    details.append(make('h4', 'practice-calendar__details-title', dayFormatter.format(parseDate(selectedDay))));
    const list = make('ul', 'practice-calendar__events');
    events.forEach(event => {
      const item = make('li', 'practice-calendar__event');
      item.append(make('strong', '', event.location || event.title || '稽古'));
      if (!event.allDay) item.append(make('span', '', eventTime(event)));
      if (event.location && event.title && event.title !== event.location) item.append(make('span', 'practice-calendar__event-title', event.title));
      list.append(item);
    });
    details.append(list);
  }

  function renderMonth() {
    const label = `${year}年${month + 1}月`;
    heading.textContent = label;
    caption.textContent = `${label}の稽古日程。会場名のある日付を選ぶと時刻と会場を確認できます。`;
    body.replaceChildren();
    let row;
    const monthStart = Date.UTC(year, month, 1) - JST;
    const monthEnd = Date.UTC(year, month + 1, 1) - JST;
    const monthEvents = data.events.filter(event => event.start < monthEnd && event.end > monthStart);
    const activeDays = monthDays(year, month).filter(key => key && eventsOnDay(monthEvents, key).length);
    if (!activeDays.includes(selectedDay)) selectedDay = activeDays.find(key => key >= today) || activeDays[0] || '';
    monthDays(year, month).forEach((key, index) => {
      if (index % 7 === 0) { row = make('tr'); body.append(row); }
      const cell = make('td', key ? '' : 'is-empty');
      row.append(cell);
      if (!key) return;
      const events = eventsOnDay(monthEvents, key);
      const day = make(events.length ? 'button' : 'span', 'practice-calendar__day');
      day.append(make('span', '', String(Number(key.slice(8)))));
      if (key === today) { day.classList.add('is-today'); day.setAttribute('aria-current', 'date'); }
      if (events.length) {
        const venues = new Map();
        events.forEach(event => {
          const venue = eventVenue(event);
          if (!venues.has(venue.key)) venues.set(venue.key, { ...venue, names: new Set() });
          venues.get(venue.key).names.add(venue.name);
        });
        const venueNames = [...new Set([...venues.values()].flatMap(venue => [...venue.names]))].join('、');
        cell.classList.add('has-practice');
        day.type = 'button';
        day.classList.add('is-practice');
        day.classList.toggle('is-selected', key === selectedDay);
        day.setAttribute('aria-label', `${dayFormatter.format(parseDate(key))}、${venueNames}、稽古${events.length}件。時刻と会場を表示`);
        day.setAttribute('title', venueNames);
        day.setAttribute('aria-pressed', String(key === selectedDay));
        day.setAttribute('aria-controls', details.id);
        day.dataset.calendarDay = key;
        venues.forEach(venue => {
          const marker = make('span', 'practice-calendar__marker', venue.label);
          marker.setAttribute('title', [...venue.names].join('、'));
          day.append(marker);
        });
        day.addEventListener('click', () => {
          selectedDay = key;
          body.querySelectorAll('button[data-calendar-day]').forEach(button => {
            const selected = button.dataset.calendarDay === selectedDay;
            button.classList.toggle('is-selected', selected);
            button.setAttribute('aria-pressed', String(selected));
          });
          renderDetails();
        });
      }
      cell.append(day);
    });
    const external = '「Googleカレンダー」から開催日をご確認ください。';
    if (data.state === 'loading') status.textContent = '開催日を読み込んでいます。';
    else if (data.state === 'uninitialized') status.textContent = `開催日のデータは準備中です。${external}`;
    else if (data.state === 'error') status.textContent = `開催日を読み込めませんでした。${external}`;
    else if (monthCoverage(data, year, month) === 'partial') status.textContent = `この月にはまだ取得していない期間があります。${external}`;
    else if (!activeDays.length) status.textContent = 'この月の稽古予定はありません。変更がある場合はGoogleカレンダーに反映されます。';
    else status.textContent = '稽古日の日付を選ぶと会場が表示されます。';
    if (data.usedFallback && data.state === 'ready') status.textContent += ' 通信できなかったため、保存済みの予定を表示しています。';
    renderDetails();
  }

  function renderNext() {
    if (!title) return;
    const next = nextEvent(data.events, now);
    if (next) {
      title.textContent = dayFormatter.format(next.start);
      const ongoing = next.start <= now ? next.allDay ? '（本日の開催予定）' : '（開催中）' : '';
      const time = next.allDay ? '' : ` / ${eventTime(next)}`;
      const venue = next.location || next.title;
      if (nextDetails) nextDetails.textContent = `${venue ? `＠${venue}` : '会場はGoogleカレンダーをご確認ください'}${time}${ongoing}`;
    } else {
      title.textContent = data.state === 'loading' ? '読み込み中…' : data.state === 'ready' ? '取得済みの予定に次回の稽古はありません。' : data.state === 'uninitialized' ? '開催日のデータは準備中です。' : '開催日を読み込めませんでした。';
      if (nextDetails) nextDetails.textContent = data.state === 'loading' ? '' : 'Googleカレンダーで最新の日程をご確認ください。';
    }
  }
  const moveMonth = delta => {
    const date = new Date(Date.UTC(year, month + delta, 1));
    year = date.getUTCFullYear(); month = date.getUTCMonth(); renderMonth();
  };
  previous.addEventListener('click', () => moveMonth(-1));
  next.addEventListener('click', () => moveMonth(1));
  renderMonth(); renderNext();

  async function loadCalendar() {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    try {
      if (window.location.protocol === 'file:' && window.HIYOSHI_CALENDAR_DATA) data = readData(window.HIYOSHI_CALENDAR_DATA);
      else {
        const url = new URL(config.calendarDataUrl || 'data/calendar.json', window.location.href);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported calendar URL');
        const response = await fetch(url.href, { signal: controller.signal, cache: 'no-cache' });
        if (!response.ok) throw new Error('Calendar request failed');
        data = readData(await response.json());
      }
    } catch {
      // The packaged copy also supports opening index.html directly or a network outage.
      try { data = { ...readData(window.HIYOSHI_CALENDAR_DATA), usedFallback: true }; }
      catch { data = { state: 'error', events: [] }; }
    } finally {
      window.clearTimeout(timer);
      root.setAttribute('aria-busy', 'false');
      renderMonth(); renderNext();
    }
  }
  loadCalendar();
})();
