(() => {
  'use strict';
  const config = window.HIYOSHI_CONFIG || {};
  const entries = [...(window.HIYOSHI_JOURNAL || [])].sort((a, b) => b.date.localeCompare(a.date));
  const query = (s, root = document) => root.querySelector(s);
  const all = (s, root = document) => [...root.querySelectorAll(s)];
  const safeUrl = (value, protocols = ['http:', 'https:']) => {
    if (!value || typeof value !== 'string') return null;
    try { const url = new URL(value, window.location.href); return protocols.includes(url.protocol) ? url.href : null; } catch { return null; }
  };
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const dateLabel = (value) => {
    const date = new Date(`${value}T12:00:00+09:00`);
    if (!Number.isFinite(date.getTime())) return value;
    return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date).replaceAll('/', '.');
  };
  const loadPhoto = (slot) => {
    if (slot.dataset.photoInitialized) return;
    slot.dataset.photoInitialized = 'true';
    const setting = config.photos?.[slot.dataset.photo];
    // HTMLを直接開いたときは、同じフォルダ内の写真も読み込めるようにする。
    const photoProtocols = window.location.protocol === 'file:' ? ['http:', 'https:', 'file:'] : ['http:', 'https:'];
    const src = safeUrl(setting?.src, photoProtocols);
    if (!src) return;
    const img = new Image();
    img.alt = setting.alt || '稽古の風景';
    img.loading = slot.dataset.photo === 'hero' ? 'eager' : 'lazy';
    img.decoding = 'async';
    if (slot.dataset.photo === 'hero') img.fetchPriority = 'high';
    img.style.objectPosition = setting.position || '50% 50%';
    img.addEventListener('load', () => {
      slot.classList.add('has-photo');
      if (slot.hasAttribute('data-photo-optional')) slot.hidden = false;
    }, { once: true });
    img.addEventListener('error', () => img.remove(), { once: true });
    img.src = src;
    slot.append(img);
  };

  all('[data-year]').forEach(node => { node.textContent = String(new Date().getFullYear()); });
  all('[data-fee]').forEach(node => { if (config.participationFee) node.textContent = config.participationFee; });
  all('[data-fee-note]').forEach(node => { if (config.feeNote) node.textContent = config.feeNote; });
  const contactFormUrl = safeUrl(config.contactFormUrl, ['https:']);
  if (contactFormUrl) all('[data-contact-form]').forEach(node => { node.href = contactFormUrl; });
  [['[data-payment-link]', config.paymentUrl], ['[data-legal-link]', config.legalUrl]].forEach(([selector, value]) => {
    const url = safeUrl(value);
    if (!url) return;
    all(selector).forEach(node => { node.href = url; node.hidden = false; });
  });
  if (config.calendarId) {
    const params = new URLSearchParams({src: config.calendarId, ctz:'Asia/Tokyo', mode:'MONTH', showTitle:'0', showPrint:'0', showTabs:'0', showCalendars:'0', showTz:'0', hl:'ja'});
    const iframe = query('.calendar-embed');
    const url = `https://calendar.google.com/calendar/embed?${params}`;
    if (iframe && iframe.src !== url) iframe.src = url;
    all('[data-calendar-link]').forEach(link => { link.href = url; });
  }

  const menuButton = query('.menu-toggle');
  const navigation = query('#main-navigation');
  const closeMenu = () => { if (!menuButton || !navigation) return; navigation.classList.remove('is-open'); menuButton.setAttribute('aria-expanded', 'false'); };
  if (menuButton && navigation) {
    menuButton.addEventListener('click', () => { const expanded = menuButton.getAttribute('aria-expanded') !== 'true'; menuButton.setAttribute('aria-expanded', String(expanded)); navigation.classList.toggle('is-open', expanded); });
    all('a', navigation).forEach(link => link.addEventListener('click', closeMenu));
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && navigation.classList.contains('is-open')) { closeMenu(); menuButton.focus(); } });
    document.addEventListener('click', event => { if (!event.target.closest('.site-header')) closeMenu(); });
    window.matchMedia('(min-width: 1001px)').addEventListener('change', event => { if (event.matches) closeMenu(); });
  }
  // 写真を開閉領域の中に保ちつつ、PCでは見出しの上端に揃える。
  all('.method-item').forEach(details => {
    const summary = query('summary', details);
    const title = query('.method-title', details);
    const expanded = query('.method-expanded', details);
    if (!summary || !title || !expanded) return;
    const alignPhoto = () => {
      if (!details.open) return;
      const offset = title.getBoundingClientRect().top - expanded.getBoundingClientRect().top;
      details.style.setProperty('--method-image-offset', `${offset}px`);
    };
    details.addEventListener('toggle', alignPhoto);
    if ('ResizeObserver' in window) new window.ResizeObserver(alignPhoto).observe(summary);
    else window.addEventListener('resize', alignPhoto);
    alignPhoto();
  });
  all('.close-details').forEach(button => button.addEventListener('click', () => {
    const details = button.closest('details');
    if (!details) return;
    const summary = query('summary', details);
    details.open = false;
    summary.focus({ preventScroll: true });
    const bounds = summary.getBoundingClientRect();
    const header = query('.site-header')?.offsetHeight || 0;
    if (bounds.top < header || bounds.bottom > window.innerHeight) summary.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }));

  const journalCard = entry => {
    const link = make('a', 'journal-card');
    link.href = entry.href || `journal.html?id=${encodeURIComponent(entry.id)}`;
    const meta = make('div', 'journal-meta');
    const time = make('time', '', dateLabel(entry.date)); time.dateTime = entry.date;
    meta.append(time);
    if (entry.place) meta.append(make('span', '', entry.place));
    link.append(meta, make('h3', '', entry.title), make('p', '', entry.excerpt));
    const more = make('span', 'journal-more', 'この日の稽古を読む');
    const arrow = make('span', '', '↗'); arrow.setAttribute('aria-hidden', 'true'); more.append(arrow); link.append(more);
    return link;
  };
  all('[data-journal-list]').forEach(list => {
    const limit = Number(list.dataset.limit) || entries.length;
    if (!entries.length) { list.append(make('p', 'empty-state', '稽古日誌は準備中です。')); return; }
    const fragment = document.createDocumentFragment();
    entries.slice(0, limit).forEach(entry => fragment.append(journalCard(entry))); list.replaceChildren(fragment);
  });
  const article = query('[data-journal-article]');
  const articleId = new URLSearchParams(window.location.search).get('id');
  if (article && articleId) {
    query('[data-journal-index]').hidden = true;
    article.hidden = false;
    const entry = entries.find(item => item.id === articleId);
    if (!entry) {
      article.append(make('h1', '', '記事が見つかりませんでした。'));
      const back = make('a', 'text-link', '稽古日誌の一覧へ'); back.href = 'journal.html'; article.append(back);
      document.title = '記事が見つかりません｜刀禅日吉同好会';
    } else {
      // 既存の個別記事URLも、年別ページ内の同じ記録へつなぐ。
      const destination = safeUrl(entry.href, ['http:', 'https:', 'file:']);
      const link = make('a', 'text-link', 'この日の稽古日誌を読む ↗');
      if (destination) { link.href = destination; article.append(link); window.location.replace(destination); }
    }
  }
  all('[data-photo]').forEach(loadPhoto);
})();
