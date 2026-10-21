import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/pwa.js', import.meta.url), 'utf8');

class Element {
  hidden = false;
  disabled = false;
  open = false;
  textContent = '';
  listeners = {};
  addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); }
  async emit(type, event = {}) { await Promise.all((this.listeners[type] || []).map(callback => callback(event))); }
}

function fixture(options = {}) {
  const root = new Element();
  const button = new Element();
  const help = new Element();
  const status = new Element();
  const ios = new Element();
  const android = new Element();
  const elements = {
    '[data-pwa-install-button]': button,
    '[data-pwa-install-help]': help,
    '[data-pwa-install-status]': status,
    '[data-pwa-ios]': ios,
    '[data-pwa-android]': android
  };
  root.querySelector = selector => elements[selector];
  const modes = Object.fromEntries(['standalone', 'fullscreen'].map(mode => {
    const query = new Element();
    query.matches = options.mode === mode;
    return [`(display-mode: ${mode})`, query];
  }));
  const window = new Element();
  window.matchMedia = query => modes[query];
  window.location = { protocol: options.protocol || 'https:' };
  const registrations = [];
  const navigator = {
    userAgent: options.userAgent || 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1',
    platform: options.platform || 'iPhone',
    maxTouchPoints: options.maxTouchPoints ?? 5,
    standalone: options.legacyStandalone || false,
    serviceWorker: {
      register: (...args) => {
        registrations.push(args);
        return options.registrationError ? Promise.reject(new Error('unavailable')) : Promise.resolve();
      }
    }
  };
  const document = {
    readyState: options.readyState || 'complete',
    querySelector: () => options.noRoot ? null : root
  };
  vm.runInNewContext(source, { window, document, navigator });
  return { root, button, help, status, ios, android, modes, navigator, window, registrations };
}

test('iPhone QR visitors see manual Safari steps and no unsupported install button', () => {
  const page = fixture();
  assert.equal(page.root.hidden, false);
  assert.equal(page.help.open, true);
  assert.equal(page.ios.hidden, false);
  assert.equal(page.android.hidden, true);
  assert.equal(page.button.hidden, true);
});

test('iPad with desktop user agent also gets the iOS instructions', () => {
  const page = fixture({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/18.0 Safari/605.1.15', platform: 'MacIntel' });
  assert.equal(page.ios.hidden, false);
  assert.equal(page.android.hidden, true);
  assert.equal(page.help.open, true);
});

test('home-screen launches hide installation instructions, including legacy iOS', async () => {
  for (const options of [{ mode: 'standalone' }, { mode: 'fullscreen' }, { legacyStandalone: true }]) {
    assert.equal(fixture(options).root.hidden, true);
  }
  const page = fixture();
  page.modes['(display-mode: standalone)'].matches = true;
  await page.modes['(display-mode: standalone)'].emit('change');
  assert.equal(page.root.hidden, true);
  page.modes['(display-mode: standalone)'].matches = false;
  await page.window.emit('pageshow');
  assert.equal(page.root.hidden, false);
});

test('Android without an install event retains the manual menu route', () => {
  const page = fixture({ userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/140.0 Mobile Safari/537.36', platform: 'Linux armv8l' });
  assert.equal(page.ios.hidden, true);
  assert.equal(page.android.hidden, false);
  assert.equal(page.help.open, true);
  assert.equal(page.button.hidden, true);
});

test('native prompt only runs on a click, once per event, and cancellation is not installation', async () => {
  const page = fixture();
  let prevented = 0;
  let prompts = 0;
  let resolveChoice;
  const userChoice = new Promise(resolve => { resolveChoice = resolve; });
  await page.window.emit('beforeinstallprompt', {
    preventDefault: () => { prevented++; },
    prompt: () => { prompts++; return Promise.resolve(); },
    userChoice
  });
  assert.equal(prevented, 1);
  assert.equal(prompts, 0);
  assert.equal(page.button.hidden, false);
  const pending = page.button.emit('click');
  await page.button.emit('click');
  assert.equal(prompts, 1);
  assert.equal(page.button.disabled, true);
  resolveChoice({ outcome: 'dismissed' });
  await pending;
  assert.equal(page.root.hidden, false);
  assert.equal(page.button.hidden, true);
  assert.equal(page.button.disabled, false);
});

test('accepting a prompt does not report installed before appinstalled', async () => {
  const page = fixture();
  await page.window.emit('beforeinstallprompt', {
    preventDefault() {}, prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'accepted' })
  });
  await page.button.emit('click');
  assert.equal(page.root.hidden, false);
  await page.window.emit('appinstalled');
  assert.equal(page.root.hidden, true);
});

test('prompt errors offer manual steps without leaving a broken install button', async () => {
  const page = fixture();
  await page.window.emit('beforeinstallprompt', {
    preventDefault() {}, prompt: async () => { throw new Error('denied'); }
  });
  await page.button.emit('click');
  assert.equal(page.help.open, true);
  assert.equal(page.status.hidden, false);
  assert.equal(page.button.hidden, true);
  assert.equal(page.button.disabled, false);
});

test('worker registration waits for load and tolerates denied registration', async () => {
  const page = fixture({ readyState: 'loading', registrationError: true });
  assert.equal(page.registrations.length, 0);
  await page.window.emit('load');
  assert.equal(page.registrations.length, 1);
  assert.equal(page.registrations[0][0], 'sw.js');
  assert.equal(page.registrations[0][1].updateViaCache, 'none');
  assert.equal(fixture({ protocol: 'file:' }).registrations.length, 0);
  assert.equal(fixture({ noRoot: true }).registrations.length, 0);
});
