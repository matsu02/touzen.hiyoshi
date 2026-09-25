/** 設定した共有用画像をHTMLに書き込む。SNSの取得時にJavaScriptを実行する必要はない。 */
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const startMarker = '<!-- THUMBNAIL_START -->';
const endMarker = '<!-- THUMBNAIL_END -->';
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export async function updateThumbnail(siteRoot) {
  const root = path.resolve(siteRoot);
  const sandbox = { window: {} };
  vm.runInNewContext(await readFile(path.join(root, 'assets/site-config.js'), 'utf8'), sandbox, { timeout: 1000 });
  const config = sandbox.window.HIYOSHI_CONFIG;
  if (typeof config?.siteUrl !== 'string') throw new Error('siteUrl に公開サイトのURLを指定してください。');
  const base = new URL(config.siteUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/')) {
    throw new Error('siteUrl は末尾が / の公開用HTTP(S) URLにしてください。');
  }
  const setting = config.thumbnail;
  if (typeof setting?.src !== 'string' || !setting.src.trim() || typeof setting.alt !== 'string' || !setting.alt.trim()) {
    throw new Error('thumbnail.src に画像パス、thumbnail.alt に画像の説明を指定してください。');
  }
  const src = setting.src.trim();
  const image = new URL(src, base);
  if (!['http:', 'https:'].includes(image.protocol) || image.username || image.password) {
    throw new Error('サムネイルは公開用のHTTP(S)画像URLまたはサイト内の画像パスにしてください。');
  }
  if (!/^https?:\/\//i.test(src)) {
    if (image.origin !== base.origin || !image.pathname.startsWith(base.pathname)) {
      throw new Error('サイト内の画像は公開サイトのフォルダー内に配置してください。');
    }
    const localPath = path.resolve(root, decodeURIComponent(image.pathname.slice(base.pathname.length)));
    if (!localPath.startsWith(root + path.sep) || !(await stat(localPath)).isFile()) {
      throw new Error('指定したサムネイル画像がサイト内にありません。');
    }
  }
  const block = [
    startMarker,
    `<meta property="og:image" content="${escape(image.href)}">`,
    `<meta property="og:image:alt" content="${escape(setting.alt.trim())}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:image" content="${escape(image.href)}">`,
    `<meta name="twitter:image:alt" content="${escape(setting.alt.trim())}">`,
    endMarker
  ].join('\n');

  const files = (await readdir(root, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.html'))
    .map(entry => path.join(root, entry.name)).sort();
  const template = path.join(root, 'templates/journal.html');
  try {
    if ((await stat(template)).isFile()) files.push(template);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!files.length) throw new Error('更新するHTMLがありません。');

  // 全ページの設定・更新箇所を確認してから書き込み、入力ミスで一部だけ更新されるのを防ぐ。
  const updates = [];
  for (const file of files) {
    const html = await readFile(file, 'utf8');
    const head = /<head\b[^>]*>/i.exec(html);
    const endHead = /<\/head\s*>/i.exec(html);
    if (!head || !endHead || head.index >= endHead.index) throw new Error(`${path.relative(root, file)} のhead要素を確認してください。`);
    const startCount = html.split(startMarker).length - 1;
    const endCount = html.split(endMarker).length - 1;
    const start = html.indexOf(startMarker);
    const end = html.indexOf(endMarker);
    let updated;
    if (startCount || endCount) {
      if (startCount !== 1 || endCount !== 1 || start < head.index + head[0].length || end <= start || end + endMarker.length > endHead.index) {
        throw new Error(`${path.relative(root, file)} のサムネイル更新用コメントを確認してください。`);
      }
      updated = html.slice(0, start) + block + html.slice(end + endMarker.length);
    } else {
      if (/<meta\b[^>]*(?:property|name)\s*=\s*["'](?:og:image(?::alt)?|twitter:(?:card|image(?::alt)?))["']/i.test(html.slice(head.index, endHead.index))) {
        throw new Error(`${path.relative(root, file)} に既存のサムネイル指定があります。更新用コメント内にまとめてください。`);
      }
      updated = html.slice(0, endHead.index) + '\n' + block + '\n' + html.slice(endHead.index);
    }
    updates.push({ file, html, updated });
  }
  for (const { file, html, updated } of updates) {
    if (html !== updated) await writeFile(file, updated);
  }
  return { imageUrl: image.href, pages: updates.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] || fileURLToPath(new URL('../', import.meta.url));
  updateThumbnail(root).then(result => {
    console.log(`サムネイルを ${result.imageUrl} に設定しました（${result.pages}ファイル）。`);
  }).catch(error => {
    console.error(`サムネイルの更新に失敗しました: ${error.message}`);
    process.exitCode = 1;
  });
}
