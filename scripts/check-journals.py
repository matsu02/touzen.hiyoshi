"""年別日誌の本文・件数・リンク・新年追加を検証する。Python標準ライブラリのみ。"""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
from tempfile import TemporaryDirectory
import hashlib
import json
import re
import shutil
import subprocess

SITE = Path(__file__).resolve().parent.parent


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.ids = set()
        self.references = []
        self.cards = []
        self.articles = {}
        self.article_id = None
        self.body_depth = 0
        self.body_text = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get('class', '').split()
        if 'id' in attrs:
            assert attrs['id'] not in self.ids, f'重複したHTML ID: {attrs["id"]}'
            self.ids.add(attrs['id'])
        for attribute in ('href', 'src'):
            if attribute in attrs:
                self.references.append(attrs[attribute])
        if tag == 'a' and 'journal-card' in classes:
            self.cards.append(attrs['href'])
        if tag == 'article' and 'archive-entry' in classes:
            self.article_id = attrs['id'].removeprefix('entry-')
        if tag == 'div':
            if 'article-body' in classes:
                self.body_depth = 1
                self.body_text = []
            elif self.body_depth:
                self.body_depth += 1

    def handle_endtag(self, tag):
        if tag == 'div' and self.body_depth:
            self.body_depth -= 1
            if not self.body_depth:
                self.articles[self.article_id] = ''.join(self.body_text)

    def handle_data(self, data):
        if self.body_depth:
            self.body_text.append(data)


def compact(text):
    return re.sub(r'\s+', '', text)


def load_entries(root):
    return [entry for file in sorted((root / 'content/journals').glob('[0-9][0-9][0-9][0-9].json'))
            for entry in json.loads(file.read_text())['entries']]


entries = load_entries(SITE)
expected_latest = sorted(entries, key=lambda entry: entry['date'], reverse=True)[:3]
pages = {file.resolve(): Page(file.read_text()) for file in SITE.glob('*.html')}
expected_links = [f'journal-{entry["date"][:4]}.html#entry-{entry["id"]}' for entry in expected_latest]
assert pages[(SITE / 'index.html').resolve()].cards == expected_links
assert pages[(SITE / 'journal.html').resolve()].cards == expected_links

for entry in entries:
    year = entry['date'][:4]
    rendered = pages[(SITE / f'journal-{year}.html').resolve()]
    assert entry['id'] in rendered.articles, f'記事がありません: {entry["id"]}'
    text = ''.join(block['text'] if block['type'] == 'paragraph' else ''.join(block['items']) for block in entry['blocks'])
    assert compact(rendered.articles[entry['id']]) == compact(text), f'本文が一致しません: {entry["id"]}'
    # 編集済みの記事は公開本文を照合し、原資料の照合値は source に保持する。
    digest = entry.get('editedBodySha256') or entry.get('source', {}).get('bodySha256')
    if digest:
        assert hashlib.sha256(compact(text).encode()).hexdigest() == digest, f'本文の照合値が一致しません: {entry["id"]}'

for year in {entry['date'][:4] for entry in entries}:
    expected_ids = {entry['id'] for entry in entries if entry['date'].startswith(year)}
    actual_ids = set(pages[(SITE / f'journal-{year}.html').resolve()].articles)
    assert actual_ids == expected_ids, f'年別の記事に過不足があります: {year}'

for file, page in pages.items():
    for reference in page.references:
        url = urlsplit(reference)
        if url.scheme or url.netloc:
            continue
        target = (file.parent / unquote(url.path)).resolve() if url.path else file
        if target.is_dir():
            target = target / 'index.html'
        assert target.exists(), f'リンク切れ: {file.name} → {reference}'
        if url.fragment and target in pages:
            assert unquote(url.fragment) in pages[target].ids, f'存在しない記事・目次: {file.name} → {reference}'

for file in [*SITE.glob('assets/*.js'), *SITE.glob('scripts/*.mjs')]:
    subprocess.run(['node', '--check', str(file)], check=True, capture_output=True)

# 新しい年の原稿を追加し、日付順と年別リンクが自動で更新されることを、別フォルダで確認。
with TemporaryDirectory(prefix='hiyoshi-journal-check-') as temporary:
    fixture = Path(temporary)
    shutil.copytree(SITE / 'content', fixture / 'content')
    shutil.copytree(SITE / 'templates', fixture / 'templates')
    (fixture / 'assets').mkdir(parents=True)
    shutil.copyfile(SITE / 'index.html', fixture / 'index.html')
    test_year = max(int(entry['date'][:4]) for entry in entries) + 1
    test_entry = {'id':f'{test_year}-01-02', 'date':f'{test_year}-01-02', 'title':'検証用の記事',
                  'excerpt':'検証用。公開しません。', 'blocks':[{'type':'paragraph','text':'検証用の本文。'}]}
    (fixture / f'content/journals/{test_year}.json').write_text(json.dumps({'year':test_year,'entries':[test_entry]},ensure_ascii=False))
    subprocess.run(['node', str(SITE / 'scripts/build-journals.mjs'), str(fixture)], check=True, capture_output=True)
    home = Page((fixture / 'index.html').read_text())
    assert home.cards == [f'journal-{test_year}.html#entry-{test_entry["id"]}', *expected_links[:2]]
    assert f'journal-{test_year}.html' in home.references
    assert f'journal-{test_year}.html' in Page((fixture / 'journal.html').read_text()).references
    assert test_entry['id'] in Page((fixture / f'journal-{test_year}.html').read_text()).articles
    # 二度の生成で内容が変わらないことも確認。
    first = {file.relative_to(fixture):file.read_bytes() for file in fixture.rglob('*') if file.is_file()}
    subprocess.run(['node', str(SITE / 'scripts/build-journals.mjs'), str(fixture)], check=True, capture_output=True)
    assert all((fixture / file).read_bytes() == data for file,data in first.items())

print(f'PASS: {len(entries)} articles; body checksums, year grouping, all local links, latest 3, new-year update, deterministic generation, JavaScript syntax.')
