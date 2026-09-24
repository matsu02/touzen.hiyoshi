#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../assets/announcement.js', import.meta.url), 'utf8');
const active = { date: '2026-09-24', text: '本日の稽古は休みです。' };

// Minimal DOM, clock, and timer adapters exercise the shipped browser script.
function fixture(options = {}) {
  const { announcements = [active], now = '2026-09-24T12:00:00+09:00', hasRoot = true } = options;
  const config = Object.hasOwn(options, 'config') ? options.config : { announcements };
  let clock = Date.parse(now), nextTimer = 0;
  const timers = new Map();
  const eventTarget = () => {
    const listeners = new Map();
    return {
      addEventListener(name, callback) {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(callback);
      },
      dispatch(name) { for (const callback of listeners.get(name) || []) callback({ type: name }); }
    };
  };
  const element = tagName => ({
    tagName: tagName.toUpperCase(), className: '', dataset: {}, children: [], ownText: '', hidden: false,
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.ownText = ''; this.children = children; },
    set textContent(value) { this.ownText = value; this.children = []; },
    get textContent() { return this.ownText + this.children.map(child => child.textContent).join(''); },
    set innerHTML(_) { throw new Error('Announcement content must be plain text'); }
  });
  const root = element('div');
  root.hidden = true;
  const document = {
    ...eventTarget(), visibilityState: 'visible', hidden: false,
    querySelector: selector => selector === '[data-announcement]' && hasRoot ? root : null,
    createElement: element
  };
  const window = {
    ...eventTarget(), HIYOSHI_CONFIG: config,
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, delay, due: clock + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); }
  };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  vm.runInNewContext(source, { window, document, Date: FixedDate, Intl });
  return {
    root, timers,
    texts() { return root.children.map(row => row.children.find(child => Object.hasOwn(child.dataset, 'announcementText')).textContent); },
    setTime(value) { clock = Date.parse(value); },
    fireNextAt(value) {
      clock = Date.parse(value);
      const entry = [...timers.entries()].sort((a, b) => a[1].due - b[1].due)[0];
      assert.ok(entry, 'An active announcement schedules an expiry check');
      timers.delete(entry[0]);
      entry[1].callback();
    },
    returnToPage(event) { (event === 'pageshow' ? window : document).dispatch(event); }
  };
}

test('all active announcements display in registration order, including repeated dates and text', () => {
  const later = { date: '2026-10-01', text: '来月のお知らせ' };
  const expired = { date: '2026-09-23', text: '期限切れ' };
  const page = fixture({ announcements: [later, expired, active, active] });
  assert.equal(page.root.hidden, false);
  assert.deepEqual(page.texts(), [later.text, active.text, active.text]);
  for (const row of page.root.children) {
    assert.equal(row.tagName, 'P');
    assert.equal(row.className, 'schedule-announcement-item');
    assert.equal(row.children[0].tagName, 'STRONG');
    assert.equal(row.children[0].textContent, 'アナウンス：');
    assert.equal(row.children[1].tagName, 'SPAN');
  }
});

test('an announcement displays immediately and through the last millisecond of its date in Japan', () => {
  for (const now of ['2026-09-01T00:00:00+09:00', '2026-09-24T14:59:59.999Z']) {
    const page = fixture({ now, announcements: [{ ...active, text: '  ' + active.text + ' \n' }] });
    assert.equal(page.root.hidden, false);
    assert.deepEqual(page.texts(), [active.text]);
  }
  const expired = fixture({ now: '2026-09-24T15:00:00.000Z' });
  assert.equal(expired.root.hidden, true);
  assert.deepEqual(expired.texts(), []);
});

test('missing, empty, and malformed announcements leave the entire area hidden', () => {
  for (const config of [undefined, null, {}, { announcements: [] }, { announcements: null }, { announcements: {} }, { announcements: 'notice' }]) {
    const page = fixture({ config });
    assert.equal(page.root.hidden, true);
    assert.deepEqual(page.texts(), []);
    assert.equal(page.timers.size, 0);
  }
});

test('malformed entries do not prevent valid siblings from displaying', () => {
  const invalid = [null, undefined, 7, 'notice', [], {}, ...['', ' \n\t ', null, 7, {}, ['notice']].map(text => ({ ...active, text }))];
  const page = fixture({ announcements: [...invalid, active, ...invalid] });
  assert.deepEqual(page.texts(), [active.text]);
});

test('invalid dates cannot roll over into a different calendar day', () => {
  const dates = ['', null, 20260924, 'not a date', '2026-9-24', '2026-09-24T00:00:00Z', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-24', '2026-09-00', '2026-09-32', '2100-02-29'];
  const page = fixture({ now: '2026-01-01T00:00:00+09:00', announcements: [...dates.map(date => ({ ...active, date })), active] });
  assert.deepEqual(page.texts(), [active.text]);
  const leap = { ...active, date: '2028-02-29' };
  assert.equal(fixture({ now: '2028-02-29T23:59:59.999+09:00', announcements: [leap] }).root.hidden, false);
  assert.equal(fixture({ now: '2028-03-01T00:00:00+09:00', announcements: [leap] }).root.hidden, true);
});

test('markup and internal newlines in announcement text are displayed literally', () => {
  const value = '<img src=x onerror="alert(1)"> & お知らせ\n次の行';
  const page = fixture({ announcements: [{ ...active, text: ' \n' + value + '\n ' }] });
  assert.equal(page.root.hidden, false);
  assert.deepEqual(page.texts(), [value]);
});

test('each midnight removes only expired entries and the last expiry hides the area', () => {
  const later = { date: '2026-09-25', text: '明日のお知らせ' };
  const page = fixture({ now: '2026-09-24T23:59:59+09:00', announcements: [later, active, active] });
  assert.equal(page.timers.size, 1);
  assert.equal([...page.timers.values()][0].delay, 1000, 'The nearest expiry determines the timer');
  page.fireNextAt('2026-09-25T00:00:00+09:00');
  assert.equal(page.root.hidden, false);
  assert.deepEqual(page.texts(), [later.text]);
  assert.equal(page.timers.size, 1);
  page.fireNextAt('2026-09-26T00:00:00+09:00');
  assert.equal(page.root.hidden, true);
  assert.deepEqual(page.texts(), []);
  assert.equal(page.timers.size, 0);
});

test('returning after sleep or restoring the page rechecks every expiration without duplicates', () => {
  const later = { date: '2026-10-01', text: '来月のお知らせ' };
  for (const event of ['visibilitychange', 'pageshow']) {
    const page = fixture({ announcements: [active, later] });
    page.setTime('2026-09-26T09:00:00+09:00');
    page.returnToPage(event);
    page.returnToPage(event);
    assert.deepEqual(page.texts(), [later.text], event);
    assert.equal(page.timers.size, 1);
    page.setTime('2026-10-02T00:00:00+09:00');
    page.returnToPage(event);
    assert.equal(page.root.hidden, true, event);
    assert.deepEqual(page.texts(), []);
    assert.equal(page.timers.size, 0);
  }
});

test('a far-future announcement uses timers within the browser integer limit', () => {
  const page = fixture({ announcements: [{ ...active, date: '2035-12-31' }] });
  assert.equal(page.root.hidden, false);
  assert.ok(page.timers.size > 0);
  for (const { delay } of page.timers.values()) assert.ok(delay > 0 && delay <= 2147483647);
  page.fireNextAt('2026-10-25T12:00:00+09:00');
  assert.equal(page.root.hidden, false);
  assert.equal(page.timers.size, 1, 'The expiry check is rescheduled until the deadline');
});

test('legacy single announcements still display unless an announcements array overrides them', () => {
  assert.deepEqual(fixture({ config: { announcement: active } }).texts(), [active.text]);
  assert.deepEqual(fixture({ config: { announcement: active, announcements: undefined } }).texts(), [active.text]);
  const empty = fixture({ config: { announcement: active, announcements: [] } });
  assert.equal(empty.root.hidden, true);
  assert.deepEqual(empty.texts(), []);
  const replacement = { ...active, text: '新しい設定' };
  assert.deepEqual(fixture({ config: { announcement: active, announcements: [replacement] } }).texts(), [replacement.text]);
});

test('pages without an announcement container do not fail', () => {
  assert.doesNotThrow(() => fixture({ hasRoot: false }));
});
