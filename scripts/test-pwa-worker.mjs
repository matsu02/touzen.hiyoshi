#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../sw.js', import.meta.url), 'utf8');
const appRoot = 'https://example.test/touzen.hiyoshi/';

function fixture() {
  const listeners = new Map();
  const stores = new Map();
  const requests = [];
  let offline = false;
  let content = 'online';
  let storageFails = false;
  const key = input => typeof input === 'string' ? input : input.url;
  const cacheFor = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name);
    return {
      async addAll(items) {
        for (const item of items) {
          requests.push(item);
          entries.set(key(item), new Response(`saved:${new URL(key(item)).pathname}`));
        }
      },
      async match(input) { return entries.get(key(input))?.clone(); },
      async put(input, response) { entries.set(key(input), response.clone()); }
    };
  };
  vm.runInNewContext(source, {
    URL, Request, Response, Set,
    self: {
      registration: { scope: appRoot },
      addEventListener(type, listener) { listeners.set(type, listener); }
    },
    caches: {
      async open(name) {
        if (storageFails) throw new Error('Storage unavailable');
        return cacheFor(name);
      },
      async keys() { return [...stores.keys()]; },
      async delete(name) { return stores.delete(name); }
    },
    async fetch(request, options) {
      requests.push({ request, options });
      if (offline) throw new Error('Offline');
      return new Response(content);
    }
  });
  return {
    stores, requests,
    setOffline(value) { offline = value; },
    setContent(value) { content = value; },
    setStorageFails(value) { storageFails = value; },
    async lifecycle(type) {
      let done;
      listeners.get(type)({ waitUntil(promise) { done = promise; } });
      await done;
    },
    request(path, options = {}) {
      let response;
      listeners.get('fetch')({
        request: { method: 'GET', mode: 'cors', url: new URL(path, appRoot).href, ...options },
        respondWith(promise) { response = promise; }
      });
      return response;
    }
  };
}

test('manifest keeps install and launch paths within the GitHub Pages project', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(new URL(manifest.id, appRoot).href, appRoot);
  assert.equal(new URL(manifest.scope, appRoot).href, appRoot);
  assert.equal(new URL(manifest.start_url, appRoot).href, `${appRoot}index.html#schedule`);
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const bytes = await fs.readFile(new URL(`../${icon.src}`, import.meta.url));
    const size = bytes.readUInt32BE(16);
    assert.equal(bytes.readUInt32BE(20), size);
    assert.equal(icon.sizes, `${size}x${size}`);
  }
});

test('install precaches a bounded shell under the project path, without calendar JSON or photos', async () => {
  const app = fixture();
  await app.lifecycle('install');
  const keys = [...app.stores.values()][0].keys();
  const paths = [...keys];
  assert.equal(paths.length, 21);
  assert.ok(paths.includes(`${appRoot}assets/practice-photo-data.js`));
  assert.ok(paths.includes(`${appRoot}data/practice-photos.json`));
  assert.ok(paths.includes(`${appRoot}app.html`));
  assert.ok(paths.includes(`${appRoot}assets/qr/hiyoshi-schedule-iphone.png`));
  for (const path of paths) {
    assert.ok(path.startsWith(appRoot));
    assert.ok(!path.includes('/photos/'));
    assert.ok(!path.includes('/data/calendar.json'));
    await fs.access(new URL(`../${path.slice(appRoot.length)}`, import.meta.url));
  }
  assert.ok(app.requests.every(request => request.cache === 'reload'));
});

test('offline entry and guide work with the saved schedule QR image', async () => {
  const app = fixture();
  await app.lifecycle('install');
  app.setOffline(true);
  for (const path of ['./', 'index.html', 'index.html?source=qr']) {
    const response = await app.request(path, { mode: 'navigate' });
    assert.equal(await response.text(), 'saved:/touzen.hiyoshi/index.html');
  }
  const dates = await app.request('assets/calendar-data.js');
  assert.equal(await dates.text(), 'saved:/touzen.hiyoshi/assets/calendar-data.js');
  const guide = await app.request('app.html', { mode: 'navigate' });
  assert.equal(await guide.text(), 'saved:/touzen.hiyoshi/app.html');
  const qr = await app.request('assets/qr/hiyoshi-schedule-iphone.png');
  assert.equal(await qr.text(), 'saved:/touzen.hiyoshi/assets/qr/hiyoshi-schedule-iphone.png');
});

test('online config and scripts refresh their offline copies without growing query keys', async () => {
  const app = fixture();
  await app.lifecycle('install');
  for (const path of ['assets/site-config.js', 'assets/practice-photo-data.js', 'data/practice-photos.json', 'assets/announcement.js', 'assets/calendar-data.js', 'assets/style.css?v=next']) {
    app.setContent(`updated:${path}`);
    const live = await app.request(path);
    assert.equal(await live.text(), `updated:${path}`);
    app.setOffline(true);
    const saved = await app.request(path);
    assert.equal(await saved.text(), `updated:${path}`);
    app.setOffline(false);
  }
  assert.equal([...app.stores.values()][0].size, 21);
  const runtime = app.requests.filter(item => item.options);
  assert.ok(runtime.every(item => item.options.cache === 'no-cache'));
});

test('calendar JSON errors remain visible to calendar.js and unrelated requests are untouched', async () => {
  const app = fixture();
  await app.lifecycle('install');
  app.setOffline(true);
  for (const path of ['data/calendar.json', 'data/calendar.json?v=new', 'assets/photos/hero.jpg', 'journal.html', '/another-project/index.html', 'https://calendar.google.com/calendar/embed']) {
    assert.equal(app.request(path), undefined, path);
  }
  assert.equal(app.request('assets/site-config.js', { method: 'POST' }), undefined);
});

test('activation removes only older caches belonging to this deployment', async () => {
  const app = fixture();
  await app.lifecycle('install');
  const current = [...app.stores.keys()][0];
  const sibling = 'hiyoshi-pwa-/another-project/-v1';
  app.stores.set('hiyoshi-pwa-/touzen.hiyoshi/-v0', new Map());
  app.stores.set(sibling, new Map());
  app.stores.set('some-other-app', new Map());
  await app.lifecycle('activate');
  assert.deepEqual([...app.stores.keys()], [current, sibling, 'some-other-app']);
});

test('a cache storage failure does not block online shell requests', async () => {
  const app = fixture();
  app.setStorageFails(true);
  const response = await app.request('assets/site-config.js');
  assert.equal(await response.text(), 'online');
});
