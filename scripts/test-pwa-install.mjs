import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/pwa.js', import.meta.url), 'utf8');

class Element {
  hidden = false;
  disabled = false;
  textContent = '';
  focused = false;
  listeners = {};
  querySelector() { return null; }
  focus() { this.focused = true; }
  addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); }
  async emit(type, event = {}) { await Promise.all((this.listeners[type] || []).map(callback => callback(event))); }
}

function fixture(options = {}) {
  const root = new Element();
  const nativePanel = new Element();
  const button = new Element();
  const help = new Element();
  const status = new Element();
  const installedNote = new Element();
  const ios = new Element();
  const android = new Element();
  nativePanel.hidden = status.hidden = installedNote.hidden = true;
  const elements = {
    '[data-pwa-native]': nativePanel,
    '[data-pwa-install-button]': button,
    '[data-pwa-install-help]': help,
    '[data-pwa-install-status]': status,
    '[data-pwa-installed]': installedNote,
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
  return { root, nativePanel, button, help, status, installedNote, ios, android, modes, navigator, window, registrations };
}

const androidOptions = { userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/140.0 Mobile Safari/537.36', platform: 'Linux armv8l' };
const ipadOptions = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/18.0 Safari/605.1.15', platform: 'MacIntel' };
const desktopOptions = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0', platform: 'Win32', maxTouchPoints: 0 };
const assertManual = page => {
  assert.equal(page.root.hidden, false);
  assert.equal(page.nativePanel.hidden, true);
  assert.equal(page.button.hidden, true);
  assert.equal(page.help.hidden, false);
};
const assertNative = page => {
  assert.equal(page.root.hidden, false);
  assert.equal(page.nativePanel.hidden, false);
  assert.equal(page.button.hidden, false);
  assert.equal(page.help.hidden, true);
};

test('without a real install event, manual steps route to iPhone, iPad, Android, or both for desktop', () => {
  for (const [options, iosHidden, androidHidden] of [[{}, false, true], [ipadOptions, false, true], [androidOptions, true, false], [desktopOptions, false, false]]) {
    const page = fixture(options);
    assertManual(page);
    assert.equal(page.ios.hidden, iosHidden);
    assert.equal(page.android.hidden, androidHidden);
    assert.equal(page.ios.focused, false);
    assert.equal(page.android.focused, false);
  }
});

test('a captured browser event switches exclusively to native install without opening or focusing guides', async () => {
  const page = fixture(androidOptions);
  let prevented = 0;
  let prompts = 0;
  await page.window.emit('beforeinstallprompt', {
    preventDefault() { prevented++; },
    prompt() { prompts++; }
  });
  assert.equal(prevented, 1);
  assert.equal(prompts, 0);
  assertNative(page);
  assert.equal(page.button.textContent, 'アプリを追加する');
  assert.equal(page.button.disabled, false);
  assert.equal(page.ios.focused, false);
  assert.equal(page.android.focused, false);
});

test('native prompt runs immediately on click, prevents re-entry, and routes cancellation to Android steps', async () => {
  const page = fixture(androidOptions);
  let prompts = 0;
  let resolveChoice;
  const userChoice = new Promise(resolve => { resolveChoice = resolve; });
  await page.window.emit('beforeinstallprompt', {
    preventDefault() {},
    prompt() { prompts++; return Promise.resolve(); },
    userChoice
  });
  const pending = page.button.emit('click');
  assert.equal(prompts, 1);
  assertNative(page);
  assert.equal(page.button.disabled, true);
  await page.button.emit('click');
  assert.equal(prompts, 1);
  resolveChoice({ outcome: 'dismissed' });
  await pending;
  assertManual(page);
  assert.equal(page.button.disabled, false);
  assert.equal(page.android.hidden, false);
  assert.equal(page.android.focused, true);
  assert.equal(page.ios.hidden, true);
  assert.equal(page.installedNote.hidden, true);
  assert.equal(page.status.hidden, false);
  await page.button.emit('click');
  assert.equal(prompts, 1);
});

test('accepted choice shows manual guidance without reporting installed before appinstalled', async () => {
  const page = fixture(androidOptions);
  await page.window.emit('beforeinstallprompt', {
    preventDefault() {}, prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'accepted' })
  });
  await page.button.emit('click');
  assertManual(page);
  assert.equal(page.installedNote.hidden, true);
  assert.match(page.status.textContent, /操作を受け付けました/);
  assert.doesNotMatch(page.status.textContent, /追加が完了しました/);
  assert.equal(page.android.focused, false);
  await page.window.emit('appinstalled');
  assertManual(page);
  assert.equal(page.installedNote.hidden, false);
  assert.match(page.status.textContent, /追加が完了しました/);
});

test('prompt and choice errors hide native install and focus only the visible iPhone guide', async () => {
  for (const failure of ['prompt', 'choice']) {
    const page = fixture();
    await page.window.emit('beforeinstallprompt', {
      preventDefault() {},
      prompt: async () => { if (failure === 'prompt') throw new Error('denied'); },
      get userChoice() { return failure === 'choice' ? Promise.reject(new Error('aborted')) : undefined; }
    });
    await page.button.emit('click');
    assertManual(page);
    assert.equal(page.ios.hidden, false);
    assert.equal(page.ios.focused, true);
    assert.equal(page.android.hidden, true);
    assert.equal(page.android.focused, false);
    assert.equal(page.status.hidden, false);
    assert.equal(page.button.disabled, false);
  }
});

test('standalone launches show installed status with manual guidance even if an install event arrives', async () => {
  for (const options of [{ mode: 'standalone' }, { mode: 'fullscreen' }, { legacyStandalone: true }]) {
    const page = fixture(options);
    assertManual(page);
    assert.equal(page.installedNote.hidden, false);
    assert.match(page.installedNote.textContent, /ホーム画面から起動/);
    await page.window.emit('beforeinstallprompt', { preventDefault() {}, prompt() { assert.fail('already installed'); } });
    assertManual(page);
    await page.button.emit('click');
  }
});

test('installation during a pending prompt retains installed status and does not reopen native install', async () => {
  const page = fixture(androidOptions);
  let resolveChoice;
  await page.window.emit('beforeinstallprompt', {
    preventDefault() {}, prompt: async () => {},
    userChoice: new Promise(resolve => { resolveChoice = resolve; })
  });
  const pending = page.button.emit('click');
  await page.window.emit('appinstalled');
  assertManual(page);
  resolveChoice({ outcome: 'accepted' });
  await pending;
  assertManual(page);
  assert.equal(page.installedNote.hidden, false);
  assert.match(page.status.textContent, /追加が完了しました/);
});

test('main pages without a guide still register the worker and capture native install events', async () => {
  const page = fixture({ noRoot: true });
  assert.equal(page.registrations.length, 1);
  let prevented = false;
  await page.window.emit('beforeinstallprompt', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  await page.window.emit('appinstalled');
});

test('worker registration waits for load and tolerates denied registration', async () => {
  const page = fixture({ readyState: 'loading', registrationError: true, noRoot: true });
  assert.equal(page.registrations.length, 0);
  await page.window.emit('load');
  assert.equal(page.registrations.length, 1);
  assert.equal(page.registrations[0][0], 'sw.js');
  assert.equal(page.registrations[0][1].updateViaCache, 'none');
  assert.equal(fixture({ protocol: 'file:' }).registrations.length, 0);
});
