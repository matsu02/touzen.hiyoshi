#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { buildPracticePhotos } from './build-practice-photos.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hiyoshi-practice-photos-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async relative => {
    const filename = path.join(root, relative);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, 'image fixture');
  };
  const output = path.join(root, 'assets/practice-photo-data.js');
  const read = async () => {
    const source = await readFile(output, 'utf8');
    const sandbox = { window: {} };
    vm.runInNewContext(source, sandbox);
    return { source, photos: JSON.parse(JSON.stringify(sandbox.window.HIYOSHI_PRACTICE_PHOTOS)) };
  };
  return { root, put, read, output };
}

test('only supported immediate files in each dedicated folder become encoded, sorted candidates', async t => {
  const site = await fixture(t);
  for (const filename of [
    'assets/photos/solo/z.JPG', 'assets/photos/solo/a.jpeg', 'assets/photos/solo/写真 #1.png',
    'assets/photos/solo/.hidden.jpg', 'assets/photos/solo/readme.txt', 'assets/photos/solo/nested/inside.jpg',
    'assets/photos/solo/directory.jpg/inside.jpg', 'assets/photos/unused.jpg',
    'assets/photos/pair/b.webp', 'assets/photos/pair/a.AVIF', 'assets/photos/pair/c.gif'
  ]) await site.put(filename);
  await buildPracticePhotos(site.root);
  assert.deepEqual((await site.read()).photos, {
    solo: ['assets/photos/solo/a.jpeg', 'assets/photos/solo/z.JPG', 'assets/photos/solo/%E5%86%99%E7%9C%9F%20%231.png'],
    pair: ['assets/photos/pair/a.AVIF', 'assets/photos/pair/b.webp', 'assets/photos/pair/c.gif']
  });
});

test('folder additions and removals update candidates; missing and empty folders are valid', async t => {
  const site = await fixture(t);
  await mkdir(path.join(site.root, 'assets/photos/solo'), { recursive: true });
  await buildPracticePhotos(site.root);
  assert.deepEqual((await site.read()).photos, { solo: [], pair: [] });
  await site.put('assets/photos/solo/new.jpg');
  await site.put('assets/photos/pair/new.png');
  await buildPracticePhotos(site.root);
  assert.deepEqual((await site.read()).photos, {
    solo: ['assets/photos/solo/new.jpg'], pair: ['assets/photos/pair/new.png']
  });
  await rm(path.join(site.root, 'assets/photos/solo/new.jpg'));
  await rm(path.join(site.root, 'assets/photos/pair'), { recursive: true });
  await buildPracticePhotos(site.root);
  assert.deepEqual((await site.read()).photos, { solo: [], pair: [] });
});

test('generation is deterministic and leaves an unchanged output file untouched', async t => {
  const site = await fixture(t);
  await site.put('assets/photos/solo/b.jpg');
  await site.put('assets/photos/solo/a.jpg');
  await buildPracticePhotos(site.root);
  const original = (await site.read()).source;
  const oldTime = new Date('2000-01-01T00:00:00Z');
  await utimes(site.output, oldTime, oldTime);
  const before = (await stat(site.output)).mtimeMs;
  await buildPracticePhotos(site.root);
  assert.equal((await stat(site.output)).mtimeMs, before);
  assert.equal((await site.read()).source, original);
  await rm(site.output);
  await buildPracticePhotos(site.root);
  assert.equal((await site.read()).source, original);
});
