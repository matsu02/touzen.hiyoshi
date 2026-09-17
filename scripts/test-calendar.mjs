#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { dayKey, parseDate, normalizeEvents, readData, eventsOnDay, nextEvent, eventTime, eventVenue, monthDays, monthCoverage } = require('../assets/calendar.js');
const session = (start, end, extra = {}) => ({ title: '稽古', start, end, ...extra });

test('calendar dates use Japan time even for UTC input and visitors elsewhere', () => {
  assert.equal(dayKey(Date.parse('2026-09-15T15:00:00Z')), '2026-09-16');
  assert.equal(parseDate('2026-09-16'), Date.parse('2026-09-15T15:00:00Z'));
  assert.equal(parseDate('2026-09-16T19:00:00'), Date.parse('2026-09-16T10:00:00Z'));
  assert.ok(Number.isNaN(parseDate('2026-02-30')));
  assert.ok(Number.isNaN(parseDate('2026-02-30T19:00:00+09:00')));
  assert.ok(Number.isNaN(parseDate('2026-09-16T24:30:00+09:00')));
});

test('cancelled, malformed and backwards events never become practice dates', () => {
  const valid = session('2026-09-29T19:00:00+09:00', '2026-09-29T20:45:00+09:00');
  const events = normalizeEvents([null, { ...valid, status: 'cancelled' }, { ...valid, start: 'invalid' }, { ...valid, end: valid.start }, valid]);
  assert.equal(events.length, 1);
  assert.equal(events[0].start, parseDate(valid.start));
});

test('next practice includes an ongoing event but excludes one ending now', () => {
  const events = normalizeEvents([
    session('2026-09-29T19:00:00+09:00', '2026-09-29T20:45:00+09:00'),
    session('2026-09-16T18:15:00+09:00', '2026-09-16T19:00:00+09:00'),
    session('2026-09-16T19:00:00+09:00', '2026-09-16T20:45:00+09:00')
  ]);
  const next = nextEvent(events, parseDate('2026-09-16T19:30:00+09:00'));
  assert.equal(eventTime(next), '19:00–20:45');
  assert.equal(nextEvent(events, parseDate('2026-09-16T20:45:00+09:00')), events[2]);
  assert.equal(nextEvent(events, parseDate('2026-09-30')), undefined);
});

test('midnight is exclusive and a session crossing midnight appears on both dates', () => {
  const events = normalizeEvents([
    session('2026-09-15T19:00:00+09:00', '2026-09-16T00:00:00+09:00'),
    session('2026-09-16T23:00:00+09:00', '2026-09-17T01:00:00+09:00')
  ]);
  assert.equal(eventsOnDay(events, '2026-09-15').length, 1);
  assert.deepEqual(eventsOnDay(events, '2026-09-16'), [events[1]]);
  assert.deepEqual(eventsOnDay(events, '2026-09-17'), [events[1]]);
  assert.equal(eventsOnDay(events, '2026-09-18').length, 0);
  assert.equal(eventTime(events[1]), '9月16日 23:00–9月17日 01:00');
});

test('all-day dates cover only the registered dates and do not invent a start time', () => {
  const [event] = normalizeEvents([session('2026-09-29', '2026-09-30')]);
  assert.equal(event.allDay, true);
  assert.equal(eventTime(event), '時刻未登録');
  assert.equal(eventsOnDay([event], '2026-09-28').length, 0);
  assert.equal(eventsOnDay([event], '2026-09-29').length, 1);
  assert.equal(eventsOnDay([event], '2026-09-30').length, 0);
  assert.equal(nextEvent([event], parseDate('2026-09-29T23:59:00+09:00')), event);
  const [multi] = normalizeEvents([session('2026-09-29', '2026-10-02', { allDay: true })]);
  assert.equal(eventTime(multi), '9月29日–10月1日（時刻未登録）');
  assert.equal(eventsOnDay([multi], '2026-10-01').length, 1);
  assert.equal(eventsOnDay([multi], '2026-10-02').length, 0);
});

test('multiple events keep all venues in start-time order', () => {
  const events = normalizeEvents([
    session('2026-09-16T19:00:00+09:00', '2026-09-16T20:45:00+09:00', { location: '綱島地区センター' }),
    session('2026-09-16T18:15:00+09:00', '2026-09-16T19:00:00+09:00', { location: '日吉地区センター' })
  ]);
  assert.deepEqual(eventsOnDay(events, '2026-09-16').map(event => event.location), ['日吉地区センター', '綱島地区センター']);
});

test('venue labels recognize the facility rather than the group name and prefer LOCATION', () => {
  assert.deepEqual(eventVenue({ title: '綱島地区センター【刀禅日吉】' }), { key: '綱島地区センター', label: '綱島', name: '綱島地区センター' });
  assert.equal(eventVenue({ title: '日吉地区センター【刀禅日吉】' }).label, '日吉');
  const explicit = eventVenue({ location: '綱島地区センター 和室', title: '日吉地区センター【刀禅日吉】' });
  assert.equal(explicit.label, '綱島');
  assert.equal(explicit.name, '綱島地区センター 和室');
  assert.equal(eventVenue({ location: '港北公会堂', title: '日吉地区センター' }).label, '港北公会堂');
});

test('other venues retain full names while short labels remain compact and missing venues stay unknown', () => {
  assert.equal(eventVenue({ title: '港北公会堂【刀禅日吉】' }).label, '港北公会堂');
  const long = eventVenue({ location: '港北スポーツセンター第一体育室' });
  assert.equal(long.label, '港北スポー…');
  assert.equal(long.name, '港北スポーツセンター第一体育室');
  assert.equal(eventVenue({ title: '日吉同好会の稽古【刀禅日吉】' }).label, '会場確認');
  assert.equal(eventVenue({}).label, '会場確認');
});

test('uninitialized, confirmed empty and invalid datasets remain distinct', () => {
  assert.equal(readData({ updatedAt: null, events: [] }).state, 'uninitialized');
  const empty = readData({ updatedAt: '2026-09-16T01:00:00Z', events: [] });
  assert.equal(empty.state, 'ready');
  assert.equal(empty.events.length, 0);
  assert.throws(() => readData(null));
  assert.throws(() => readData({ updatedAt: '2026-09-16T01:00:00Z', events: {} }));
  assert.throws(() => readData({ updatedAt: 'invalid', events: [] }));
});

test('month coverage never describes an unrequested period as confirmed empty', () => {
  const data = readData({ updatedAt: '2026-09-16T01:00:00Z', events: [], rangeStart: '2026-08-01', rangeEnd: '2027-02-01' });
  assert.equal(monthCoverage(data, 2026, 8), 'full');
  assert.equal(monthCoverage(data, 2026, 6), 'partial');
  assert.equal(monthCoverage(data, 2027, 1), 'partial');
});

test('month layout includes every date, leap day and enough Sunday-first rows', () => {
  const september = monthDays(2026, 8);
  assert.deepEqual(september.slice(0, 3), [null, null, '2026-09-01']);
  assert.equal(september.filter(Boolean).length, 30);
  assert.equal(september.length % 7, 0);
  assert.equal(monthDays(2028, 1).filter(Boolean).at(-1), '2028-02-29');
  assert.equal(monthDays(2026, 7).length, 42);
  assert.equal(monthDays(2027, 0).filter(Boolean)[0], '2027-01-01');
});
