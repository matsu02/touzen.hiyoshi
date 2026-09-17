import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { calendarRange, parseIcs, calendarData, calendarScript, fetchCalendar, writeCalendar, updateCalendar } from './update-calendar.mjs';

const now = new Date('2026-09-16T08:00:00Z');
const event = lines => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');
const calendar = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-TIMEZONE:Asia/Tokyo', ...events, 'END:VCALENDAR'].join('\r\n');
const allDay = event(['DTSTART;VALUE=DATE:20260929', 'DTEND;VALUE=DATE:20260930', 'SUMMARY:日吉地区センター【刀禅日吉】']);

test('終日・排他的終了日・行折り返し・文字エスケープを保持する', () => {
  const [result] = parseIcs(calendar(event([
    'DTSTART;VALUE=DATE:20260929', 'DTEND;VALUE=DATE:20260930',
    'SUMMARY:日吉地区センター\\,', ' 綱島\\;稽古\\n次の行\\\\',
    'DESCRIPTION:参加費：1\\,000円', 'LOCATION:横浜\\,日吉'
  ])));
  assert.deepEqual(result, {
    title: '日吉地区センター,綱島;稽古\n次の行\\', start: '2026-09-29', end: '2026-09-30',
    allDay: true, location: '横浜,日吉', fee: '1,000円'
  });
});

test('UTC・Asia/Tokyo・浮動時刻を同じ実時刻として扱う', () => {
  const results = parseIcs(calendar(
    event(['DTSTART:20260929T091500Z', 'DTEND:20260929T114500Z']),
    event(['DTSTART;TZID="Asia/Tokyo":20260929T181500', 'DTEND;TZID=Asia/Tokyo:20260929T204500']),
    event(['DTSTART:20260929T181500', 'DURATION:PT2H30M'])
  ));
  for (const result of results) {
    assert.equal(result.start, '2026-09-29T09:15:00.000Z');
    assert.equal(result.end, '2026-09-29T11:45:00.000Z');
    assert.equal(result.allDay, false);
  }
});

test('省略された終日終了日は翌日、取消は除外しアラームのプロパティを混同しない', () => {
  const results = parseIcs(calendar(
    event(['DTSTART;VALUE=DATE:20261231', 'BEGIN:VALARM', 'DESCRIPTION:通知', 'END:VALARM']),
    event(['DTSTART;VALUE=DATE:20260929', 'DURATION:P2D']),
    event(['STATUS:CANCELLED'])
  ));
  assert.equal(results.length, 2);
  assert.equal(results[0].end, '2027-01-01');
  assert.equal(results[1].end, '2026-10-01');
});

test('未対応の繰り返し指定は黙って欠落させず更新を拒否する', () => {
  for (const recurrence of ['RRULE:FREQ=WEEKLY', 'EXRULE:FREQ=WEEKLY', 'RDATE;VALUE=DATE:20261006', 'EXDATE;VALUE=DATE:20261006', 'RECURRENCE-ID;VALUE=DATE:20260929']) {
    assert.throws(() => parseIcs(calendar(event(['DTSTART;VALUE=DATE:20260929', recurrence]))), /未対応の繰り返し/);
  }
});

test('不正データ・未対応のタイムゾーンを拒否する', () => {
  const badEvents = [
    ['DTSTART;VALUE=DATE:20260230'],
    ['DTSTART;VALUE=DATE:20260929', 'DTEND;VALUE=DATE:20260928'],
    ['DTSTART;VALUE=DATE:20260929', 'DTEND:20260930T000000Z'],
    ['DTSTART;TZID=Europe/London:20260929T181500'],
    ['DTSTART;VALUE=DATE:20260929', 'DTSTART;VALUE=DATE:20260930']
  ];
  for (const lines of badEvents) assert.throws(() => parseIcs(calendar(event(lines))));
  assert.throws(() => parseIcs('<html>エラー</html>'));
  assert.throws(() => parseIcs('BEGIN:VCALENDAR\nBEGIN:VEVENT'));
  assert.deepEqual(parseIcs(calendar()), []);
});

test('JSTの月境界で対象期間を作り、終了日を含めず重なる予定を選ぶ', () => {
  assert.deepEqual(calendarRange(new Date('2026-12-31T15:00:00Z')), { rangeStart: '2026-12-01', rangeEnd: '2028-02-01' });
  const data = calendarData([
    { start: '2026-07-31', end: '2026-08-01', allDay: true },
    { start: '2026-07-31', end: '2026-08-02', allDay: true },
    { start: '2027-10-01', end: '2027-10-02', allDay: true },
    { start: '2027-09-30', end: '2027-10-01', allDay: true }
  ], now);
  assert.deepEqual(data.events.map(item => item.start), ['2026-07-31', '2027-09-30']);
  assert.equal(data.updatedAt, now.toISOString());
  assert.equal(data.rangeStart, '2026-08-01');
  assert.equal(data.rangeEnd, '2027-10-01');
});

test('APIキーなしなら公開ICSを取得する', async () => {
  const data = await fetchCalendar({ calendarId: 'public@group.calendar.google.com', now, fetchImpl: async url => {
    assert.equal(url, 'https://calendar.google.com/calendar/ical/public%40group.calendar.google.com/public/basic.ics');
    return { ok: true, text: async () => calendar(allDay) };
  } });
  assert.equal(data.events[0].start, '2026-09-29');
  assert.equal(data.events[0].allDay, true);
});

test('APIキーありなら繰り返し展開とページングを保ち、終日と時刻付きの両方を取り込む', async () => {
  let page = 0;
  const data = await fetchCalendar({ calendarId: 'public@example.com', key: 'test-key', now, fetchImpl: async url => {
    const params = new URL(url).searchParams;
    assert.equal(params.get('singleEvents'), 'true');
    assert.equal(params.get('timeMin'), '2026-08-01T00:00:00+09:00');
    assert.equal(params.get('timeMax'), '2027-10-01T00:00:00+09:00');
    if (page++ === 0) return { ok: true, json: async () => ({ items: [
      { start: { date: '2026-09-29' }, end: { date: '2026-09-30' }, summary: '日吉' },
      { status: 'cancelled' }
    ], nextPageToken: 'page2' }) };
    assert.equal(params.get('pageToken'), 'page2');
    return { ok: true, json: async () => ({ items: [
      { start: { dateTime: '2026-10-06T18:15:00+09:00' }, end: { dateTime: '2026-10-06T20:45:00+09:00' }, summary: '綱島' }
    ] }) };
  } });
  assert.equal(page, 2);
  assert.deepEqual(data.events.map(item => item.allDay), [true, false]);
});

test('JSONとJSに同じ内容を保存し、scriptを閉じる文字列も安全に復元できる', async t => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'touzen-calendar-test-'));
  t.after(() => fs.rm(outputRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(outputRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(outputRoot, 'assets'), { recursive: true });
  const data = calendarData(parseIcs(calendar(allDay)), now);
  data.events[0].title = '</script><script>alert(1)</script>\u2028\u2029';
  await writeCalendar(data, outputRoot);
  const json = JSON.parse(await fs.readFile(path.join(outputRoot, 'data/calendar.json'), 'utf8'));
  const script = await fs.readFile(path.join(outputRoot, 'assets/calendar-data.js'), 'utf8');
  assert.equal(script.includes('<'), false);
  assert.equal(script, calendarScript(data));
  const sandbox = { window: {} };
  vm.runInNewContext(script, sandbox);
  assert.equal(JSON.stringify(sandbox.window.HIYOSHI_CALENDAR_DATA), JSON.stringify(json));
  assert.deepEqual(await fs.readdir(path.join(outputRoot, 'data')), ['calendar.json']);
  assert.deepEqual(await fs.readdir(path.join(outputRoot, 'assets')), ['calendar-data.js']);
});

test('通信失敗・繰り返し・不正レスポンスでは両方の既存ファイルを保持する', async t => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'touzen-calendar-failure-'));
  t.after(() => fs.rm(outputRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(outputRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(outputRoot, 'assets'), { recursive: true });
  const jsonPath = path.join(outputRoot, 'data/calendar.json');
  const jsPath = path.join(outputRoot, 'assets/calendar-data.js');
  await fs.writeFile(jsonPath, 'previous-json');
  await fs.writeFile(jsPath, 'previous-js');
  for (const fetchImpl of [
    async () => { throw new Error('network error'); },
    async () => ({ ok: false, status: 503 }),
    async () => ({ ok: true, text: async () => '<html>エラー</html>' }),
    async () => ({ ok: true, text: async () => calendar(event(['DTSTART;VALUE=DATE:20260929', 'RRULE:FREQ=WEEKLY'])) })
  ]) {
    await assert.rejects(updateCalendar({ calendarId: 'public@example.com', now, fetchImpl }, outputRoot));
    assert.equal(await fs.readFile(jsonPath, 'utf8'), 'previous-json');
    assert.equal(await fs.readFile(jsPath, 'utf8'), 'previous-js');
  }
});

test('JSファイルの準備に失敗しても既存JSONを保持し、一時ファイルを残さない', async t => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'touzen-calendar-write-failure-'));
  t.after(() => fs.rm(outputRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(outputRoot, 'data'), { recursive: true });
  const jsonPath = path.join(outputRoot, 'data/calendar.json');
  await fs.writeFile(jsonPath, 'previous-json');
  await assert.rejects(writeCalendar(calendarData([], now), outputRoot));
  assert.equal(await fs.readFile(jsonPath, 'utf8'), 'previous-json');
  assert.deepEqual(await fs.readdir(path.join(outputRoot, 'data')), ['calendar.json']);
});
