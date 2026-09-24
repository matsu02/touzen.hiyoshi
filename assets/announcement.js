(() => {
  'use strict';
  const root = document.querySelector('[data-announcement]');
  if (!root) return;

  const config = window.HIYOSHI_CONFIG || {};
  const settings = config.announcements === undefined ? [config.announcement] : config.announcements;
  root.hidden = true;
  if (!Array.isArray(settings)) return;

  const day = 24 * 60 * 60 * 1000;
  const items = settings.flatMap(setting => {
    const date = setting?.date;
    const text = typeof setting?.text === 'string' ? setting.text.trim() : '';
    if (!text || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];

    // 2月30日など、自動で翌月に繰り越される無効な日付も除外する。
    const calendarDate = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== date) return [];

    const node = document.createElement('p');
    node.className = 'schedule-announcement-item';
    const label = document.createElement('strong');
    label.textContent = 'アナウンス：';
    const content = document.createElement('span');
    content.dataset.announcementText = '';
    content.textContent = text;
    node.append(label, content);
    // 指定日の翌日午前0時（日本時間）を表示終了時刻とする。
    return [{ node, expiresAt: Date.parse(`${date}T00:00:00+09:00`) + day }];
  });

  let displayed = [];
  let timer;
  const update = () => {
    window.clearTimeout(timer);
    const now = Date.now();
    const active = items.filter(item => item.expiresAt > now);
    if (active.length !== displayed.length || active.some((item, index) => item !== displayed[index])) {
      root.replaceChildren(...active.map(item => item.node));
      displayed = active;
    }
    root.hidden = active.length === 0;
    // 次に期限を迎える項目に合わせて更新し、最大1日ごとに再確認する。
    if (active.length) {
      const remaining = active.reduce((delay, item) => Math.min(delay, item.expiresAt - now), day);
      timer = window.setTimeout(update, remaining);
    }
  };
  update();
  window.addEventListener('pageshow', update);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) update();
  });
})();
