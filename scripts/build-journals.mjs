/** 年別JSONから公開用HTMLと最新記事データを生成する。追加パッケージ不要。 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const siteRoot = path.resolve(process.argv[2] || fileURLToPath(new URL('../', import.meta.url)));
const contentDir = path.join(siteRoot, 'content/journals');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const label = date => date.replaceAll('-', '.');
const archiveDate = date => date.replaceAll('-', ' . ');
const yearHref = year => `journal-${year}.html`;
const entryHref = entry => `${yearHref(entry.date.slice(0, 4))}#entry-${entry.id}`;
const isoDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const years = [];
const seen = new Set();
for (const filename of (await readdir(contentDir)).filter(name => /^\d{4}\.json$/.test(name)).sort().reverse()) {
  const data = JSON.parse(await readFile(path.join(contentDir, filename), 'utf8'));
  if (String(data.year) !== filename.slice(0, 4) || !Array.isArray(data.entries)) throw new Error(`年別データを確認してください: ${filename}`);
  for (const entry of data.entries) {
    if (typeof entry.id !== 'string' || !/^[a-z0-9-]+$/.test(entry.id) || seen.has(entry.id)) throw new Error(`記事IDが不正または重複: ${entry.id}`);
    if (!isoDate(entry.date) || !entry.date.startsWith(`${data.year}-`)) throw new Error(`日付と年が一致しません: ${entry.id}`);
    if (!entry.title?.trim() || !entry.excerpt?.trim() || !Array.isArray(entry.blocks) || !entry.blocks.length) throw new Error(`見出し・紹介文・本文を確認してください: ${entry.id}`);
    for (const block of entry.blocks) {
      if (block.type === 'paragraph' && typeof block.text === 'string' && block.text.trim()) continue;
      if (block.type === 'list' && Array.isArray(block.items) && block.items.length && block.items.every(item => typeof item === 'string' && item.trim())) continue;
      throw new Error(`本文の段落または箇条書きを確認してください: ${entry.id}`);
    }
    seen.add(entry.id);
  }
  data.entries.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  if (data.entries.length) years.push(data);
}
const entries = years.flatMap(year => year.entries).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
if (!entries.length) throw new Error('掲載できる稽古日誌がありません。');
const latest = entries.slice(0, 3);
const template = await readFile(path.join(siteRoot, 'templates/journal.html'), 'utf8');
const page = (title, description, main, headerJournalHref = './index.html#journal') => template.replaceAll('{{TITLE}}', escape(title)).replaceAll('{{DESCRIPTION}}', escape(description)).replace('{{HEADER_JOURNAL_HREF}}', escape(headerJournalHref)).replace('{{MAIN}}', main);
const breadcrumb = (year = '') => `<nav class="breadcrumb" aria-label="現在位置"><a href="./index.html">ホーム</a> <span aria-hidden="true"> / </span> <a href="journal.html">稽古日誌</a>${year ? ` <span aria-hidden="true"> / </span> <span aria-current="page">${year}年</span>` : ''}</nav>`;
const yearLinks = (current = '') => `<nav class="journal-years" aria-label="年別の稽古日誌"><span class="journal-years-label">年から読む</span>${years.map(year => `<a href="${yearHref(year.year)}"${String(year.year) === String(current) ? ' aria-current="page"' : ''}><span>${year.year}年</span><small>${year.entries.length}件</small><span aria-hidden="true">→</span></a>`).join('')}</nav>`;

function card(entry) {
  return `<a class="journal-card" href="${entryHref(entry)}">
  <div class="journal-meta"><time datetime="${entry.date}">${label(entry.date)}</time>${entry.place ? `<span>${escape(entry.place)}</span>` : ''}</div>
  <h3>${escape(entry.title)}</h3><p>${escape(entry.excerpt)}</p><span class="journal-more">この日の稽古を読む<span aria-hidden="true">↗</span></span></a>`;
}
const latestCards = `<div class="journal-grid" data-journal-list data-limit="3">\n${latest.map(card).join('\n')}\n</div>`;
function article(entry) {
  const content = entry.blocks.map(block => block.type === 'list'
    ? `<ul class="practice-items">${block.items.map(item => `<li>${escape(item)}</li>`).join('')}</ul>`
    : `<p>${escape(block.text)}</p>`).join('\n');
  return [
    `<article class="archive-entry" id="entry-${entry.id}" aria-labelledby="title-${entry.id}" tabindex="-1">`,
    `<header class="archive-entry-header"><p class="archive-entry-date"><strong><time datetime="${entry.date}">${archiveDate(entry.date)}</time>${entry.place ? `　<span>${escape(entry.place)}</span>` : ''}</strong></p><h3 id="title-${entry.id}">${escape(entry.title)}</h3></header>`,
    entry.photo ? `<figure class="photo-slot article-photo" data-photo="${escape(entry.photo)}" data-photo-optional hidden></figure>` : '',
    `<div class="article-body prose">${content}</div>`,
    '</article>',
  ].filter(Boolean).join('\n');
}

for (const year of years) {
  const toc = `<section class="archive-toc" aria-labelledby="archive-list-heading"><h2 id="archive-list-heading">一覧</h2><ul>${year.entries.map(entry => `<li><a href="#entry-${entry.id}"><time datetime="${entry.date}">${archiveDate(entry.date)}</time><span>${escape(entry.title)}</span></a></li>`).join('\n')}</ul></section>`;
  const main = `<main id="main" class="wrap journal-page archive-page">${breadcrumb(year.year)}
  <header id="archive-top" class="archive-heading"><h1>${year.year}年の稽古日誌</h1></header>
  ${toc}
  <section class="archive-articles" aria-labelledby="archive-articles-heading"><h2 id="archive-articles-heading">稽古日誌</h2>${year.entries.map(article).join('\n')}</section>
  <div class="archive-bottom">${yearLinks(year.year)}<a class="text-link" href="./index.html#journal">ホームの稽古日誌へ ↗</a></div></main>`;
  await writeFile(path.join(siteRoot, yearHref(year.year)), page(`${year.year}年の稽古日誌｜刀禅日吉同好会`, `${year.year}年の日吉同好会の稽古日誌${year.entries.length}件。日付とタイトルの一覧から、各日の稽古内容と気づきを読むことができます。`, main, 'journal.html'));
}

const yearCards = years.map(year => `<a class="archive-year-card" href="${yearHref(year.year)}"><span class="archive-year-number">${year.year}<small>年</small></span><span class="archive-year-count">${year.entries.length}件の記録</span><span class="archive-year-range">${label(year.entries.at(-1).date)} — ${label(year.entries[0].date)}</span><span class="archive-year-more">この年の稽古を読む <span aria-hidden="true">↗</span></span></a>`).join('\n');
const overview = `<main id="main" class="wrap journal-page">${breadcrumb()}
<div data-journal-index><div class="section-top"><div><p class="eyebrow">PRACTICE JOURNAL</p><h1>稽古の記録</h1></div><p class="section-side-note">身体の気づきを、一つずつ。<br>${entries.length}件の稽古日誌を、年ごとに。</p></div>
<section aria-labelledby="archive-years-heading"><h2 id="archive-years-heading" class="archive-subheading">年から読む</h2><div class="archive-year-grid">${yearCards}</div></section>
<section class="archive-recent" aria-labelledby="archive-recent-heading"><div class="section-top"><div><p class="eyebrow">LATEST ENTRIES</p><h2 id="archive-recent-heading">最新の3つの記録</h2></div></div>${latestCards}</section></div>
<article class="article-wrap" data-journal-article hidden></article></main>`;
await writeFile(path.join(siteRoot, 'journal.html'), page('稽古日誌｜刀禅日吉同好会', `日吉同好会の稽古日誌${entries.length}件。年ごとに、日々の稽古の内容と気づきを読むことができます。`, overview));

let home = await readFile(path.join(siteRoot, 'index.html'), 'utf8');
for (const [key, html] of [['LATEST', latestCards], ['YEARS', yearLinks()]]) {
  const pattern = new RegExp(`<!-- JOURNAL_${key}_START -->[\\s\\S]*?<!-- JOURNAL_${key}_END -->`);
  if (!pattern.test(home)) throw new Error(`トップページにJOURNAL_${key}の更新位置がありません。`);
  home = home.replace(pattern, `<!-- JOURNAL_${key}_START -->\n${html}\n<!-- JOURNAL_${key}_END -->`);
}
await writeFile(path.join(siteRoot, 'index.html'), home);
const summaries = entries.map(({id, date, place, category, photo, title, excerpt}) => ({id, date, place, category, photo, title, excerpt, href:entryHref({id, date})}));
await writeFile(path.join(siteRoot, 'assets/journal-data.js'), `/* 自動生成。編集元は content/journals/YYYY.json。生成: node scripts/build-journals.mjs */\nwindow.HIYOSHI_JOURNAL = ${JSON.stringify(summaries, null, 2)};\n`);
console.log(JSON.stringify({articles:entries.length, years:years.map(year => ({year:year.year, articles:year.entries.length})), latest:latest.map(entry => entry.date)}));
