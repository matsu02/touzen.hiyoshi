#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const updater = fileURLToPath(new URL('./update-thumbnail.mjs', import.meta.url));
const originalBody = '<body>\n<article id="practice"><h1>稽古の記録</h1><p>本文 &amp; 記録は変更しない。</p></article>\n</body>\n</html>\n';
const originalPage = '<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n<title>日吉稽古会</title>\n</head>\n' + originalBody;
const initialConfig = {
  siteUrl: 'https://example.com/site/',
  thumbnail: { src: 'assets/photos/hero.jpg', alt: '稽古 "風景" & <案内>' }
};

async function fixture(t, { template = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hiyoshi-thumbnail-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const pages = ['index.html', 'journal.html'];
  await fs.mkdir(path.join(root, 'assets/photos'), { recursive: true });
  await fs.writeFile(path.join(root, 'assets/photos/hero.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  if (template) {
    await fs.mkdir(path.join(root, 'templates'));
    pages.push('templates/journal.html');
  }
  for (const page of pages) await fs.writeFile(path.join(root, page), originalPage);
  const setConfig = config => fs.writeFile(path.join(root, 'assets/site-config.js'), `window.HIYOSHI_CONFIG = ${JSON.stringify(config)};\n`);
  await setConfig(initialConfig);
  return {
    root, pages, setConfig,
    run() { return spawnSync(process.execPath, [updater, root], { encoding: 'utf8', timeout: 10000 }); },
    async readPages() { return Promise.all(pages.map(page => fs.readFile(path.join(root, page), 'utf8'))); }
  };
}

function assertSuccess(result) {
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function assertThumbnail(html, imageUrl, alt = '稽古 &quot;風景&quot; &amp; &lt;案内&gt;') {
  const expected = {
    'og:image': imageUrl,
    'og:image:alt': alt,
    'twitter:card': 'summary_large_image',
    'twitter:image': imageUrl,
    'twitter:image:alt': alt
  };
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const [name, value] of Object.entries(expected)) {
    const namedTags = tags.filter(tag => new RegExp(`\\b(?:property|name)=["']${name}["']`, 'i').test(tag));
    assert.equal(namedTags.length, 1, `${name} must have exactly one static tag`);
    const content = /\bcontent="([^"]*)"/.exec(namedTags[0]);
    assert.ok(content, `${name} must have a quoted content attribute`);
    assert.equal(content[1], value, name);
  }
  assert.equal(html.split('<!-- THUMBNAIL_START -->').length - 1, 1);
  assert.equal(html.split('<!-- THUMBNAIL_END -->').length - 1, 1);
  assert.ok(html.indexOf('<!-- THUMBNAIL_START -->') > html.indexOf('<head>'));
  assert.ok(html.indexOf('<!-- THUMBNAIL_END -->') < html.indexOf('</head>'));
  assert.equal(html.slice(html.indexOf('<body>')), originalBody, 'Article body must remain byte-for-byte unchanged');
}

test('selected hero image is emitted as static absolute social metadata in every page and template', async t => {
  const site = await fixture(t);
  assertSuccess(site.run());
  for (const html of await site.readPages()) assertThumbnail(html, 'https://example.com/site/assets/photos/hero.jpg');
});

test('changing the selected local image replaces metadata and repeated runs are idempotent', async t => {
  const site = await fixture(t);
  assertSuccess(site.run());
  await fs.writeFile(path.join(site.root, 'assets/photos/selected.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await site.setConfig({ ...initialConfig, thumbnail: { src: 'assets/photos/selected.png', alt: '選択した画像' } });
  assertSuccess(site.run());
  const updated = await site.readPages();
  for (const html of updated) assertThumbnail(html, 'https://example.com/site/assets/photos/selected.png', '選択した画像');
  assertSuccess(site.run());
  assert.deepEqual(await site.readPages(), updated, 'Rerunning must not duplicate metadata or change whitespace');
});

test('external HTTPS images are accepted without fetching and query strings are escaped', async t => {
  const site = await fixture(t);
  await site.setConfig({
    ...initialConfig,
    thumbnail: { ...initialConfig.thumbnail, src: 'https://images.invalid/hero.jpg?width=1200&height=630' }
  });
  assertSuccess(site.run());
  for (const html of await site.readPages()) assertThumbnail(html, 'https://images.invalid/hero.jpg?width=1200&amp;height=630');
});

test('a site without a journal template still updates its root HTML pages', async t => {
  const site = await fixture(t, { template: false });
  assertSuccess(site.run());
  for (const html of await site.readPages()) assertThumbnail(html, 'https://example.com/site/assets/photos/hero.jpg');
  await assert.rejects(fs.access(path.join(site.root, 'templates/journal.html')), { code: 'ENOENT' });
});

test('invalid configuration or image selection fails before modifying any HTML', async t => {
  const cases = [
    ['missing configuration file', site => fs.rm(path.join(site.root, 'assets/site-config.js'))],
    ['invalid JavaScript configuration', site => fs.writeFile(path.join(site.root, 'assets/site-config.js'), 'window.HIYOSHI_CONFIG = {;')],
    ['missing configuration object', site => fs.writeFile(path.join(site.root, 'assets/site-config.js'), 'window.OTHER_CONFIG = {};')],
    ['missing thumbnail selection', site => site.setConfig({ siteUrl: initialConfig.siteUrl })],
    ['invalid thumbnail selection', site => site.setConfig({ ...initialConfig, thumbnail: null })],
    ['missing local image', site => site.setConfig({ ...initialConfig, thumbnail: { ...initialConfig.thumbnail, src: 'assets/photos/missing.jpg' } })],
    ...['javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///tmp/hero.jpg', 'ftp://example.com/hero.jpg'].map(src => [
      `unsupported image protocol ${src.split(':')[0]}`,
      site => site.setConfig({ ...initialConfig, thumbnail: { ...initialConfig.thumbnail, src } })
    ])
  ];
  for (const [name, prepare] of cases) {
    await t.test(name, async child => {
      const site = await fixture(child);
      assertSuccess(site.run());
      const before = await site.readPages();
      await prepare(site);
      const result = site.run();
      assert.equal(result.error, undefined, result.error?.message);
      assert.notEqual(result.status, 0, 'Invalid input must report failure');
      assert.deepEqual(await site.readPages(), before, 'Invalid input must preserve all existing metadata and article content');
    });
  }
});

test('a malformed later HTML page prevents writes to earlier valid pages', async t => {
  const site = await fixture(t);
  site.pages.push('zz-malformed.html');
  await fs.writeFile(path.join(site.root, 'zz-malformed.html'), '<!doctype html><html><head><title>Missing closing head</title><body>記録</body></html>');
  const before = await site.readPages();
  const result = site.run();
  assert.equal(result.error, undefined, result.error?.message);
  assert.notEqual(result.status, 0);
  assert.deepEqual(await site.readPages(), before, 'Validate every target before writing the first page');
});

test('an incomplete managed metadata block prevents partial updates', async t => {
  const site = await fixture(t);
  await fs.writeFile(path.join(site.root, 'templates/journal.html'), originalPage.replace('</head>', '<!-- THUMBNAIL_START -->\n</head>'));
  const before = await site.readPages();
  const result = site.run();
  assert.equal(result.error, undefined, result.error?.message);
  assert.notEqual(result.status, 0);
  assert.deepEqual(await site.readPages(), before);
});
