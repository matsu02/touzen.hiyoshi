#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await fs.readFile(new URL('../assets/calendar.js', import.meta.url), 'utf8');
// A small DOM adapter exercises the shipped script and click handlers without dependencies.
// Layout and rendering are deliberately left to the browser verification.
class Element {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.handlers = {};
    this.className = '';
    this.hidden = false;
    this.text = '';
    this.classList = {
      add: name => this.classList.toggle(name, true),
      contains: name => this.className.split(/\s+/).includes(name),
      toggle: (name, enabled) => {
        const values = new Set(this.className.split(/\s+/).filter(Boolean));
        if (enabled ?? !values.has(name)) values.add(name); else values.delete(name);
        this.className = [...values].join(' ');
      }
    };
  }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.text = String(value); this.children = []; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.text = ''; this.children = children; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, callback) { (this.handlers[name] ??= []).push(callback); }
  click() { for (const callback of this.handlers.click || []) callback({ target: this }); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const matches = node => {
      if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
      if (selector === 'button[data-calendar-day]') return node.tagName === 'button' && node.dataset.calendarDay !== undefined;
      return node.tagName === selector;
    };
    return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const fixture = ({ payload, fallback, protocol = 'https:', fetcher, now = '2026-09-16T03:00:00Z' } = {}) => {
  const root = new Element('div'), title = new Element('strong'), details = new Element('p');
  const markers = { '[data-practice-calendar]': root, '[data-next-title]': title, '[data-next-details]': details };
  let fetchCalls = 0;
  let currentTime = Date.parse(now);
  let timerId = 0;
  const timers = new Map();
  const windowHandlers = {}, documentHandlers = {};
  const dispatch = (handlers, type, event = {}) => {
    for (const callback of handlers[type] || []) callback({ type, ...event });
  };
  class FixedDate extends Date { static now() { return currentTime; } }
  const window = {
    HIYOSHI_CONFIG: { calendarDataUrl: 'data/calendar.json' },
    HIYOSHI_CALENDAR_DATA: fallback,
    location: { protocol, href: `${protocol}//example.test/index.html` },
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id),
    addEventListener: (type, callback) => { (windowHandlers[type] ??= []).push(callback); }
  };
  const document = {
    hidden: false,
    querySelector: selector => markers[selector], createElement: tag => new Element(tag),
    addEventListener: (type, callback) => { (documentHandlers[type] ??= []).push(callback); }
  };
  const fetch = async (...args) => {
    fetchCalls++;
    if (fetcher) return fetcher(...args);
    return { ok: true, json: async () => payload };
  };
  vm.runInNewContext(source, {
    window, document,
    Date: FixedDate, Intl, URL, AbortController, fetch
  });
  return {
    root, title, details, fetchCalls: () => fetchCalls,
    byClass: name => root.querySelector(`.${name}`),
    day: key => root.querySelectorAll('button[data-calendar-day]').find(day => day.dataset.calendarDay === key),
    setNow: value => { currentTime = Date.parse(value); },
    pageshow: () => dispatch(windowHandlers, 'pageshow'),
    setHidden: hidden => { document.hidden = hidden; dispatch(documentHandlers, 'visibilitychange'); },
    fireTimeouts: () => {
      for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
    }
  };
};
const payload = {
  updatedAt: '2026-09-16T01:15:00Z', rangeStart: '2026-08-01', rangeEnd: '2026-11-01',
  events: [
    { title: '日吉地区センター', start: '2026-09-15', end: '2026-09-16', allDay: true },
    { title: '綱島地区センター', start: '2026-09-29', end: '2026-09-30', allDay: true },
    { title: '取り消しの稽古', start: '2026-09-21', end: '2026-09-22', status: 'cancelled' },
    { title: '刀禅', location: '日吉地区センター', start: '2026-10-13T19:00:00+09:00', end: '2026-10-13T20:45:00+09:00' }
  ]
};

test('loading resolves to the month and next practice, and selecting a day updates details', async () => {
  let respond;
  const page = fixture({ fetcher: () => new Promise(resolve => { respond = resolve; }) });
  assert.equal(page.root.getAttribute('aria-busy'), 'true');
  assert.match(page.byClass('practice-calendar__status').textContent, /読み込んでいます/);
  respond({ ok: true, json: async () => payload });
  await flush();
  assert.equal(page.root.getAttribute('aria-busy'), 'false');
  assert.match(page.title.textContent, /2026年9月29日/);
  assert.equal(page.details.textContent, '＠綱島地区センター');
  assert.equal(page.byClass('practice-calendar__month').textContent, '2026年9月');
  assert.equal(page.root.querySelectorAll('.is-practice').length, 2);
  assert.equal(page.day('2026-09-21'), undefined);
  assert.equal(page.byClass('is-today').textContent, '16');
  assert.equal(page.byClass('practice-calendar__updated'), null);
  assert.equal(page.day('2026-09-29').getAttribute('aria-pressed'), 'true');
  assert.equal(page.day('2026-09-29').querySelector('.practice-calendar__marker').textContent, '綱島');
  assert.match(page.day('2026-09-29').getAttribute('aria-label'), /綱島地区センター/);
  assert.equal(page.day('2026-09-29').getAttribute('title'), '綱島地区センター');
  assert.match(page.byClass('practice-calendar__status').textContent, /稽古日の日付/);
  const chosen = page.day('2026-09-15');
  chosen.click();
  assert.equal(chosen, page.day('2026-09-15'), 'selecting a day keeps its focused DOM button');
  assert.equal(chosen.getAttribute('aria-pressed'), 'true');
  assert.equal(page.day('2026-09-29').getAttribute('aria-pressed'), 'false');
  assert.match(page.byClass('practice-calendar__details').textContent, /日吉地区センター/);
  assert.doesNotMatch(page.byClass('practice-calendar__details').textContent, /時刻未登録|会場は公開カレンダー|参加のご案内/);
});

test('day cells show each venue once, with full venue names available in labels and details', async () => {
  const sameDay = (title, location = '') => ({ title, location, start: '2026-09-29', end: '2026-09-30', allDay: true });
  const page = fixture({ payload: { ...payload, events: [
    sameDay('綱島地区センター【刀禅日吉】'),
    sameDay('午後の刀禅', '綱島地区センター'),
    sameDay('日吉地区センター【刀禅日吉】'),
    sameDay('港北公会堂【刀禅日吉】'),
    sameDay('会場未登録の稽古【刀禅日吉】')
  ] } });
  await flush();
  const day = page.day('2026-09-29');
  assert.deepEqual(day.querySelectorAll('.practice-calendar__marker').map(marker => marker.textContent), ['綱島', '日吉', '港北公会堂', '会場確認']);
  assert.match(day.getAttribute('aria-label'), /綱島地区センター、日吉地区センター、港北公会堂/);
  assert.match(day.getAttribute('aria-label'), /稽古5件/);
  assert.equal(day.querySelectorAll('.practice-calendar__marker')[0].getAttribute('title'), '綱島地区センター');
  assert.match(page.byClass('practice-calendar__details').textContent, /綱島地区センター【刀禅日吉】/);
  assert.match(page.byClass('practice-calendar__details').textContent, /日吉地区センター【刀禅日吉】/);
});

test('month navigation displays the new month, selects its event and distinguishes uncovered months', async () => {
  const page = fixture({ payload });
  await flush();
  const [previous, next] = page.root.querySelectorAll('.practice-calendar__nav');
  next.click();
  assert.equal(page.byClass('practice-calendar__month').textContent, '2026年10月');
  assert.equal(page.root.querySelectorAll('.is-practice').length, 1);
  assert.match(page.byClass('practice-calendar__details').textContent, /日吉地区センター19:00–20:45刀禅/);
  next.click();
  assert.match(page.byClass('practice-calendar__status').textContent, /まだ取得していない期間/);
  assert.equal(page.byClass('practice-calendar__details').hidden, true);
  previous.click(); previous.click(); previous.click();
  assert.equal(page.byClass('practice-calendar__month').textContent, '2026年8月');
  assert.match(page.byClass('practice-calendar__status').textContent, /この月の稽古予定はありません/);
});

test('network failure uses the packaged copy and reports that it is cached', async () => {
  const page = fixture({ fallback: payload, fetcher: () => { throw new Error('offline'); } });
  await flush();
  assert.equal(page.fetchCalls(), 1);
  assert.match(page.title.textContent, /9月29日/);
  assert.match(page.byClass('practice-calendar__status').textContent, /保存済みの予定/);
});

test('file previews load the packaged data without making an unsupported fetch', async () => {
  const page = fixture({ protocol: 'file:', fallback: payload });
  await flush();
  assert.equal(page.fetchCalls(), 0);
  assert.equal(page.root.querySelectorAll('.is-practice').length, 2);
  assert.match(page.details.textContent, /綱島地区センター/);
});

test('uninitialized data and a failed fetch do not claim that the month is empty', async () => {
  const uninitialized = fixture({ payload: { updatedAt: null, events: [] } });
  const failed = fixture({ fetcher: () => ({ ok: false }) });
  await flush();
  assert.match(uninitialized.byClass('practice-calendar__status').textContent, /準備中/);
  assert.match(failed.byClass('practice-calendar__status').textContent, /読み込めませんでした/);
  assert.match(failed.details.textContent, /Googleカレンダー/);
  assert.equal(failed.root.querySelectorAll('.is-practice').length, 0);
  assert.equal(failed.byClass('practice-calendar__updated'), null);
});

test('resuming updates an expired next practice while one refresh is pending, retaining the newer saved copy on failure', async () => {
  const current = { ...payload, events: [
    ...payload.events,
    { title: '昼の稽古', start: '2026-09-16T11:30:00+09:00', end: '2026-09-16T12:30:00+09:00' }
  ] };
  const older = { ...payload, updatedAt: '2026-09-15T01:00:00Z', events: [payload.events[0]] };
  let requests = 0, failRefresh;
  const page = fixture({ fallback: older, fetcher: () => {
    requests++;
    if (requests === 2) return new Promise((_resolve, reject) => { failRefresh = reject; });
    return { ok: true, json: async () => requests === 1 ? current : { ...payload, events: [payload.events[3]] } };
  } });
  await flush();
  assert.match(page.details.textContent, /昼の稽古.*開催中/);
  page.pageshow();
  assert.equal(page.fetchCalls(), 1, 'the initial pageshow does not duplicate the initial fetch');
  page.setHidden(true);
  assert.equal(page.fetchCalls(), 1, 'backgrounding does not request data');
  page.setNow('2026-09-16T04:00:00Z');
  page.setHidden(false);
  assert.equal(page.fetchCalls(), 2);
  assert.equal(page.root.getAttribute('aria-busy'), 'true');
  assert.match(page.title.textContent, /9月29日/, 'the expired event disappears before the network responds');
  assert.doesNotMatch(page.details.textContent, /開催中/);
  page.pageshow();
  assert.equal(page.fetchCalls(), 2, 'simultaneous lifecycle events share the in-flight request');
  failRefresh(new Error('offline'));
  await flush();
  assert.equal(page.root.getAttribute('aria-busy'), 'false');
  assert.match(page.title.textContent, /9月29日/, 'a refresh failure keeps the newer downloaded copy');
  assert.match(page.byClass('practice-calendar__status').textContent, /保存済みの予定/);
  page.setNow('2026-09-16T04:02:00Z');
  page.pageshow();
  await flush();
  assert.equal(page.fetchCalls(), 3);
  assert.match(page.title.textContent, /10月13日/, 'returning online loads the changed snapshot');
  assert.doesNotMatch(page.byClass('practice-calendar__status').textContent, /保存済みの予定/);
  page.pageshow();
  assert.equal(page.fetchCalls(), 3, 'a second lifecycle event after completion is also deduplicated');
});

test('returning across Japan midnight follows the current month but preserves a manually browsed month', async () => {
  const rollover = { ...payload, events: [
    { title: '月末の稽古', start: '2026-09-30', end: '2026-10-01', allDay: true },
    payload.events[3]
  ] };
  const options = { payload: rollover, now: '2026-09-30T14:59:00Z' };
  const automatic = fixture(options), manual = fixture(options);
  await flush();
  manual.root.querySelectorAll('.practice-calendar__nav')[0].click();
  assert.match(automatic.title.textContent, /9月30日/);
  assert.equal(automatic.day('2026-09-30').getAttribute('aria-pressed'), 'true');
  for (const page of [automatic, manual]) {
    page.setHidden(true);
    page.setNow('2026-09-30T15:01:00Z');
    page.setHidden(false);
  }
  await flush();
  assert.equal(automatic.byClass('practice-calendar__month').textContent, '2026年10月');
  assert.equal(automatic.byClass('is-today').textContent, '1');
  assert.match(automatic.title.textContent, /10月13日/);
  assert.equal(automatic.day('2026-10-13').getAttribute('aria-pressed'), 'true');
  assert.equal(manual.byClass('practice-calendar__month').textContent, '2026年8月');
  assert.match(manual.title.textContent, /10月13日/);
});

test('a blocked request times out without claiming an empty calendar and can retry on return', async () => {
  let requests = 0;
  const page = fixture({ fetcher: (_url, { signal }) => {
    if (++requests > 1) return { ok: true, json: async () => payload };
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  } });
  page.setNow('2026-09-16T03:01:00Z');
  page.pageshow();
  assert.equal(page.fetchCalls(), 1, 'returning during a blocked request does not start a second one');
  page.fireTimeouts();
  await flush();
  assert.equal(page.root.getAttribute('aria-busy'), 'false');
  assert.match(page.byClass('practice-calendar__status').textContent, /読み込めませんでした/);
  assert.doesNotMatch(page.byClass('practice-calendar__status').textContent, /この月の稽古予定はありません/);
  page.pageshow();
  await flush();
  assert.equal(page.fetchCalls(), 2);
  assert.match(page.title.textContent, /9月29日/);
});
