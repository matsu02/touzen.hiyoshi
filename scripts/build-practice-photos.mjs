/** 独り稽古・対人稽古の写真フォルダーから、ブラウザ用の候補一覧を生成する。 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const imageExtension = /\.(?:jpe?g|png|webp|avif|gif)$/i;

export async function buildPracticePhotos(siteRoot) {
  const root = path.resolve(siteRoot);
  const photos = {};
  for (const category of ['solo', 'pair']) {
    const folder = `assets/photos/${category}`;
    let files;
    try {
      files = await readdir(path.join(root, folder), { withFileTypes: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      files = [];
    }
    photos[category] = files
      .filter(file => file.isFile() && !file.name.startsWith('.') && imageExtension.test(file.name))
      .map(file => file.name)
      .sort()
      .map(filename => `${folder}/${encodeURIComponent(filename)}`);
  }

  const output = '/* 自動生成。編集元は assets/photos/solo/ と assets/photos/pair/。生成: node scripts/build-practice-photos.mjs */\n'
    + `window.HIYOSHI_PRACTICE_PHOTOS = ${JSON.stringify(photos, null, 2)};\n`;
  const destination = path.join(root, 'assets/practice-photo-data.js');
  let current;
  try {
    current = await readFile(destination, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (current !== output) {
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, output);
  }
  return photos;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] || fileURLToPath(new URL('../', import.meta.url));
  const photos = await buildPracticePhotos(root);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(photos).map(([category, files]) => [category, files.length]))));
}
