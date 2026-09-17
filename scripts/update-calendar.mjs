#!/usr/bin/env node
/** 公開Googleカレンダー → 月カレンダー・次回案内用データ。Node.js 20以上。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const timeZone = 'Asia/Tokyo';
const dayMs = 86400000;
const recurrenceProperties = new Set(['RRULE', 'RDATE', 'EXDATE', 'EXRULE', 'RECURRENCE-ID']);

function dateString(date) {
  return date.toISOString().slice(0, 10);
}

export function calendarRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(now);
  const year = Number(parts.find(part => part.type === 'year').value);
  const month = Number(parts.find(part => part.type === 'month').value) - 1;
  return {
    rangeStart: dateString(new Date(Date.UTC(year, month - 1, 1))),
    // 当月から12か月先の月末まで。終了日は含まない。
    rangeEnd: dateString(new Date(Date.UTC(year, month + 13, 1)))
  };
}

function unescapeText(value = '') {
  return value.replace(/\\([\\,;nN])/g, (_, escaped) => /[nN]/.test(escaped) ? '\n' : escaped);
}

function feeFrom(description = '') {
  return description.replace(/<[^>]*>/g, ' ').match(/参加費\s*[:：]\s*([0-9０-９,，]+\s*円)/)?.[1]?.replace(/\s+/g, '') || '';
}

function contentLine(line) {
  let quoted = false;
  let separator = -1;
  for (let index = 0; index < line.length; index++) {
    if (line[index] === '"') quoted = !quoted;
    if (line[index] === ':' && !quoted) { separator = index; break; }
  }
  if (separator < 1) throw new Error('iCalのプロパティ形式が不正です。');
  const segments = line.slice(0, separator).match(/(?:[^;"]|"[^"]*")+/g) || [];
  const name = segments.shift()?.toUpperCase();
  const params = {};
  for (const segment of segments) {
    const equals = segment.indexOf('=');
    if (equals < 1) throw new Error('iCalのパラメータ形式が不正です。');
    const key = segment.slice(0, equals).toUpperCase();
    if (key in params) throw new Error('iCalのパラメータが重複しています。');
    params[key] = segment.slice(equals + 1).replace(/^"(.*)"$/, '$1');
  }
  return { name, params, value: line.slice(separator + 1) };
}

function validatedDate(year, month, day, hour = 0, minute = 0, second = 0) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day ||
      date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) {
    throw new Error('iCalの日付・時刻が不正です。');
  }
  return date;
}

function icalDate(property, defaultZone) {
  const { value, params } = property;
  const allDay = params.VALUE?.toUpperCase() === 'DATE';
  if (params.VALUE && !['DATE', 'DATE-TIME'].includes(params.VALUE.toUpperCase())) {
    throw new Error('未対応のiCal日付形式です。');
  }
  if (allDay) {
    const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
    if (!match || params.TZID) throw new Error('iCalの終日予定の日付形式が不正です。');
    const date = dateString(validatedDate(...match.slice(1).map(Number)));
    return { allDay, value: date, milliseconds: Date.parse(`${date}T00:00:00+09:00`) };
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!match || (match[7] && params.TZID)) throw new Error('iCalの時刻形式が不正です。');
  const zone = match[7] ? 'UTC' : params.TZID || defaultZone;
  if (!['UTC', 'Etc/UTC', 'GMT', 'Asia/Tokyo'].includes(zone)) {
    throw new Error(`未対応のiCalタイムゾーンです: ${zone}`);
  }
  const milliseconds = validatedDate(...match.slice(1, 7).map(Number)).getTime() - (zone === 'Asia/Tokyo' ? 9 * 3600000 : 0);
  return { allDay, value: new Date(milliseconds).toISOString(), milliseconds };
}

function durationMs(value, allDay) {
  const match = /^P(?:(\d+)W|(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?)$/.exec(value);
  if (!match || !match.slice(1).some(part => part !== undefined) || (allDay && match.slice(3).some(part => part !== undefined))) {
    throw new Error('未対応または不正なiCalの期間指定です。');
  }
  const [, weeks = 0, days = 0, hours = 0, minutes = 0, seconds = 0] = match.map(value => value === undefined ? undefined : Number(value));
  return ((weeks * 7 + days) * 86400 + hours * 3600 + minutes * 60 + seconds) * 1000;
}

function singleProperty(properties, name, required = false) {
  const matches = properties.filter(property => property.name === name);
  if (matches.length > 1 || (required && !matches.length)) throw new Error(`iCalの${name}が欠落または重複しています。`);
  return matches[0];
}

/** 今回の公開カレンダーは単発予定。未対応の繰り返しは検出して更新を止める。 */
export function parseIcs(source) {
  const lines = source.replace(/^\uFEFF/, '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const stack = [];
  const records = [];
  let properties = null;
  let calendarZone = timeZone;
  let calendarCount = 0;
  for (const line of lines) {
    if (!line) continue;
    const property = contentLine(line);
    if (property.name === 'BEGIN') {
      const component = property.value.toUpperCase();
      if (component === 'VCALENDAR') {
        if (stack.length || ++calendarCount !== 1) throw new Error('iCalカレンダー構造が不正です。');
      } else if (!stack.length) throw new Error('iCalのVCALENDARがありません。');
      if (component === 'VEVENT') {
        if (stack.at(-1) !== 'VCALENDAR') throw new Error('iCal予定の構造が不正です。');
        properties = [];
      }
      stack.push(component);
    } else if (property.name === 'END') {
      if (stack.pop() !== property.value.toUpperCase()) throw new Error('iCalの終了タグが一致しません。');
      if (property.value.toUpperCase() === 'VEVENT') { records.push(properties); properties = null; }
    } else if (!stack.length) {
      throw new Error('iCalカレンダー外にデータがあります。');
    } else if (stack.at(-1) === 'VEVENT') {
      if (recurrenceProperties.has(property.name)) {
        throw new Error(`公開iCalに未対応の繰り返し指定（${property.name}）があります。APIキーを設定して更新してください。`);
      }
      properties.push(property);
    } else if (stack.at(-1) === 'VCALENDAR' && property.name === 'X-WR-TIMEZONE') {
      calendarZone = property.value;
    }
  }
  if (calendarCount !== 1 || stack.length) throw new Error('iCalカレンダーが不完全です。');
  return records.flatMap(properties => {
    if (singleProperty(properties, 'STATUS')?.value.toUpperCase() === 'CANCELLED') return [];
    const start = icalDate(singleProperty(properties, 'DTSTART', true), calendarZone);
    const endProperty = singleProperty(properties, 'DTEND');
    const duration = singleProperty(properties, 'DURATION');
    if (endProperty && duration) throw new Error('iCalで終了日時と期間が重複しています。');
    let end;
    if (endProperty) {
      end = icalDate(endProperty, calendarZone);
      if (end.allDay !== start.allDay) throw new Error('iCalの開始・終了の形式が一致しません。');
    } else {
      const milliseconds = start.milliseconds + (duration ? durationMs(duration.value, start.allDay) : start.allDay ? dayMs : 0);
      end = {
        milliseconds,
        value: start.allDay ? dateString(new Date(milliseconds + 9 * 3600000)) : new Date(milliseconds).toISOString()
      };
    }
    if (end.milliseconds < start.milliseconds || (start.allDay && end.milliseconds === start.milliseconds)) {
      throw new Error('iCalの終了日時が開始日時より前、または終日予定の期間が空です。');
    }
    return [{
      title: unescapeText(singleProperty(properties, 'SUMMARY')?.value) || '日吉同好会の稽古',
      start: start.value, end: end.value, allDay: start.allDay,
      location: unescapeText(singleProperty(properties, 'LOCATION')?.value),
      fee: feeFrom(unescapeText(singleProperty(properties, 'DESCRIPTION')?.value))
    }];
  });
}

function eventTime(value, allDay) {
  return Date.parse(allDay ? `${value}T00:00:00+09:00` : value);
}

export function normalizeApiEvents(items) {
  return items.filter(event => event.status !== 'cancelled').map(event => {
    const allDay = Boolean(event.start?.date);
    const start = allDay ? event.start.date : event.start?.dateTime;
    const end = allDay ? event.end?.date : event.end?.dateTime;
    if (!start || !end) throw new Error('APIの予定に開始・終了日時がありません。');
    return { title: event.summary || '日吉同好会の稽古', start, end, allDay, location: event.location || '', fee: feeFrom(event.description) };
  });
}

export function calendarData(events, now = new Date()) {
  const { rangeStart, rangeEnd } = calendarRange(now);
  const lower = eventTime(rangeStart, true), upper = eventTime(rangeEnd, true);
  const valid = events.filter(event => {
    const start = eventTime(event.start, event.allDay), end = eventTime(event.end, event.allDay);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || (event.allDay && end === start)) {
      throw new Error('予定データの日付・期間が不正です。');
    }
    return start < upper && (end > lower || (start === end && start >= lower));
  }).sort((a, b) => eventTime(a.start, a.allDay) - eventTime(b.start, b.allDay));
  return { updatedAt: now.toISOString(), timeZone, rangeStart, rangeEnd, events: valid };
}

export function calendarScript(data) {
  return `window.HIYOSHI_CALENDAR_DATA = ${JSON.stringify(data, null, 2).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')};\n`;
}

export async function fetchCalendar({ calendarId, key, now = new Date(), fetchImpl = fetch }) {
  if (!calendarId) throw new Error('公開カレンダーIDが設定されていません。');
  if (!key) {
    const url = `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`公開iCalの取得に失敗しました（HTTP ${response.status}）。`);
    return calendarData(parseIcs(await response.text()), now);
  }
  const { rangeStart, rangeEnd } = calendarRange(now);
  const items = [];
  let nextPageToken = '';
  const seenTokens = new Set();
  do {
    const params = new URLSearchParams({
      key, timeMin: `${rangeStart}T00:00:00+09:00`, timeMax: `${rangeEnd}T00:00:00+09:00`,
      singleEvents: 'true', orderBy: 'startTime', showDeleted: 'false', timeZone, maxResults: '2500',
      fields: 'items(summary,start,end,location,description,status),nextPageToken'
    });
    if (nextPageToken) params.set('pageToken', nextPageToken);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Google Calendar APIの取得に失敗しました（HTTP ${response.status}）。`);
    const data = await response.json();
    if (!Array.isArray(data.items)) throw new Error('Google Calendar APIの予定一覧が不正です。');
    items.push(...data.items);
    nextPageToken = data.nextPageToken || '';
    if (nextPageToken && seenTokens.has(nextPageToken)) throw new Error('Google Calendar APIのページが重複しています。');
    seenTokens.add(nextPageToken);
  } while (nextPageToken);
  return calendarData(normalizeApiEvents(items), now);
}

export async function writeCalendar(data, outputRoot = siteRoot) {
  const targets = [path.join(outputRoot, 'data/calendar.json'), path.join(outputRoot, 'assets/calendar-data.js')];
  const contents = [`${JSON.stringify(data, null, 2)}\n`, calendarScript(data)];
  const originals = [];
  let replaced = 0;
  try {
    for (const target of targets) {
      originals.push(await fs.readFile(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; }));
    }
    for (let index = 0; index < targets.length; index++) await fs.writeFile(`${targets[index]}.tmp`, contents[index]);
    for (const target of targets) { await fs.rename(`${target}.tmp`, target); replaced++; }
  } catch (error) {
    for (let index = 0; index < replaced; index++) {
      if (originals[index] === null) await fs.rm(targets[index], { force: true });
      else { await fs.writeFile(`${targets[index]}.tmp`, originals[index]); await fs.rename(`${targets[index]}.tmp`, targets[index]); }
    }
    throw error;
  } finally {
    for (const target of targets) await fs.rm(`${target}.tmp`, { force: true });
  }
}

export async function updateCalendar(options, outputRoot = siteRoot) {
  const data = await fetchCalendar(options);
  await writeCalendar(data, outputRoot);
  return data;
}

async function main() {
  const sandbox = { window: {} };
  vm.runInNewContext(await fs.readFile(path.join(siteRoot, 'assets/site-config.js'), 'utf8'), sandbox, { timeout: 1000 });
  const data = await updateCalendar({
    calendarId: process.env.HIYOSHI_CALENDAR_ID || sandbox.window.HIYOSHI_CONFIG.calendarId,
    key: process.env.HIYOSHI_CALENDAR_API_KEY
  });
  console.log(`カレンダー用に ${data.events.length} 件の予定を保存しました（${data.rangeStart}〜${data.rangeEnd}、終了日は含まず）。`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`予定の更新に失敗しました。${error.name === 'TimeoutError' ? '通信がタイムアウトしました。' : error.message}`);
    process.exitCode = 1;
  });
}
