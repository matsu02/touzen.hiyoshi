#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../assets/site.js', import.meta.url), 'utf8');
const manifest = {
  solo: ['assets/photos/solo/first.jpg', 'assets/photos/solo/last.jpg'],
  pair: ['assets/photos/pair/first.jpg', 'assets/photos/pair/last.jpg']
};
const fallback = { solo: ['assets/photos/solo/local.jpg'], pair: ['assets/photos/pair/local.jpg'] };

// Exercise the browser script with just its photo slots, images, and network boundary.
function fixture(options = {}) {
  const location = new URL(options.href || 'https://example.test/touzen.hiyoshi/index.html');
  const slots = Object.fromEntries(['hero', 'solo', 'pair', 'instructor'].map(name => [name, {
    dataset: { photo: name }, children: [{ placeholder: true }], hidden: name === 'instructor',
    classList: new Set(),
    hasAttribute: key => key === 'data-photo-optional' && name === 'instructor',
    append(image) { this.children.push(image); image.parent = this; }
  }]));
  const photos = Object.fromEntries(Object.keys(slots).map(name => [name, {
    src: `assets/photos/${name}.jpg`, alt: `${name} description`, position: '25% 60%'
  }]));
  const fetches = [], timers = new Map();
  let nextTimer = 0, randomCalls = 0;
  class FakeImage {
    constructor() { this.style = {}; this.listeners = new Map(); this.requests = []; }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    dispatch(type) { this.listeners.get(type)?.(); }
    set src(value) { this.requests.push(value); }
    get src() { return this.requests.at(-1); }
    remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  }
  const document = {
    querySelector: () => null,
    querySelectorAll: selector => selector === '[data-photo]' ? Object.values(slots) : [],
    addEventListener() {}
  };
  const window = {
    location, HIYOSHI_CONFIG: { photos },
    HIYOSHI_PRACTICE_PHOTOS: Object.hasOwn(options, 'fallback') ? options.fallback : fallback,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  const math = Object.create(Math);
  math.random = () => (options.random || [0])[randomCalls++ % (options.random || [0]).length];
  vm.runInNewContext(source, {
    window, document, Image: FakeImage, URL, URLSearchParams, AbortController, Math: math,
    fetch(...args) {
      fetches.push(args);
      return options.fetcher ? options.fetcher(...args) : Promise.resolve({
        ok: true, json: async () => Object.hasOwn(options, 'manifest') ? options.manifest : manifest
      });
    }
  });
  return {
    slots, photos, fetches, timers,
    image: name => slots[name].children.find(child => child instanceof FakeImage),
    url: path => new URL(path, location).href,
    randomCalls: () => randomCalls,
    async settle() { await new Promise(resolve => setImmediate(resolve)); }
  };
}

test('solo and pair independently choose either end of their own candidate list', async () => {
  for (const solo of [0, 1]) for (const pair of [0, 1]) {
    const page = fixture({ random: [solo ? 0.999999 : 0, pair ? 0.999999 : 0] });
    await page.settle();
    assert.equal(page.image('solo').src, page.url(manifest.solo[solo]));
    assert.equal(page.image('pair').src, page.url(manifest.pair[pair]));
    assert.equal(page.randomCalls(), 2);
    assert.equal(page.fetches.length, 1, 'Both groups share one manifest request');
    assert.equal(page.fetches[0][0], 'data/practice-photos.json');
    assert.equal(page.timers.size, 0, 'A completed request cancels its timeout');
    for (const name of ['solo', 'pair']) {
      const image = page.image(name);
      assert.equal(image.alt, page.photos[name].alt);
      assert.equal(image.style.objectPosition, page.photos[name].position);
      assert.equal(image.loading, 'lazy');
      assert.equal(page.slots[name].classList.has('has-photo'), false);
      image.dispatch('load');
      assert.equal(page.slots[name].classList.has('has-photo'), true);
      assert.equal(page.slots[name].children[0].placeholder, true);
    }
  }
});

test('hero and instructor load immediately without waiting for or using random candidates', async () => {
  let respond;
  const page = fixture({ fetcher: () => new Promise(resolve => { respond = resolve; }) });
  for (const name of ['hero', 'instructor']) assert.equal(page.image(name).src, page.url(page.photos[name].src));
  assert.equal(page.image('hero').loading, 'eager');
  assert.equal(page.image('hero').fetchPriority, 'high');
  assert.equal(page.randomCalls(), 0);
  assert.equal(page.image('solo'), undefined);
  assert.equal(page.image('pair'), undefined);
  page.image('instructor').dispatch('load');
  assert.equal(page.slots.instructor.hidden, false);
  respond({ ok: true, json: async () => manifest });
  await page.settle();
  for (const name of ['hero', 'instructor']) assert.equal(page.image(name).requests.length, 1);
});

test('missing or malformed manifests use the generated local candidate lists', async () => {
  for (const value of [undefined, null, {}, [], 'photos', { solo: [], pair: 'invalid' }, { solo: [null], pair: [] }]) {
    const page = fixture({ manifest: value });
    await page.settle();
    for (const name of ['solo', 'pair']) assert.equal(page.image(name).src, page.url(fallback[name][0]));
  }
});

test('empty candidate groups and absent fallback data retain the configured pictures', async () => {
  for (const options of [{ manifest: { solo: [], pair: [] } }, { manifest: null, fallback: undefined }]) {
    const page = fixture(options);
    await page.settle();
    for (const name of ['solo', 'pair']) assert.equal(page.image(name).src, page.url(page.photos[name].src));
    assert.equal(page.randomCalls(), 0);
  }
});

test('network, HTTP, JSON, and timeout failures use the local candidate lists', async () => {
  const fetchers = [
    async () => { throw new Error('offline'); },
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } }),
    (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
  ];
  for (const [index, fetcher] of fetchers.entries()) {
    const page = fixture({ fetcher });
    if (index === fetchers.length - 1) {
      const [{ callback, delay }] = page.timers.values();
      assert.equal(delay, 2000);
      callback();
      assert.equal(page.fetches[0][1].signal.aborted, true);
    }
    await page.settle();
    for (const name of ['solo', 'pair']) assert.equal(page.image(name).src, page.url(fallback[name][0]));
    assert.equal(page.timers.size, 0);
  }
});

test('opening HTML directly supports local pictures without fetching a manifest', async () => {
  const page = fixture({ href: 'file:///site/index.html' });
  await page.settle();
  assert.equal(page.fetches.length, 0);
  assert.equal(page.timers.size, 0);
  for (const name of ['solo', 'pair']) assert.equal(page.image(name).src, page.url(fallback[name][0]));
  assert.equal(page.image('hero').src, 'file:///site/assets/photos/hero.jpg');
});

test('a failed candidate retries the configured picture and leaves the placeholder if both fail', async () => {
  const page = fixture();
  await page.settle();
  for (const name of ['solo', 'pair']) {
    const image = page.image(name);
    image.dispatch('error');
    assert.equal(image.src, page.url(page.photos[name].src));
    assert.equal(image.requests.length, 2);
    image.dispatch('error');
    assert.equal(page.image(name), undefined);
    assert.equal(page.slots[name].children.length, 1);
    assert.equal(page.slots[name].children[0].placeholder, true);
    assert.equal(page.slots[name].classList.has('has-photo'), false);
  }
  page.image('hero').dispatch('error');
  assert.equal(page.image('hero'), undefined, 'A failed configured image is removed without retrying itself');
});
