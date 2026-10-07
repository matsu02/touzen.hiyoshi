/* サムネイル・アナウンス・写真・申込みフォーム・料金はここで変更できます。photos 内の src は、写真を用意するまで空欄のままで構いません。 */
window.HIYOSHI_CONFIG = {
  siteUrl: 'https://matsu02.github.io/touzen.hiyoshi/',
  // 変更後に node scripts/update-thumbnail.mjs を実行し、生成されたHTMLも公開してください。
  thumbnail: {
    src: 'assets/photos/hero.jpg',
    alt: '日吉同好会のイメージ'
  },
  // この配列にアナウンスを追加します。表示するものがなければ [] にします。
  announcements: [
    {
      date: '2026-09-23', // 表示する最終日。日本時間でこの日が終わるまで表示します。
      text: 'テストです' // 日付・本文のどちらかが空欄の項目は表示しません。
    },
    {
      date: '2026-10-28',
      text: '今月は、最終週だけ水曜日です。ご注意ください。'
    },
    {
      date: '2026-12-22',
      text: '少し気が早いですが、今年の忘年会は12月22日(火)を予定しています。'
    }
  ],
  contactFormUrl: 'https://www.touzen.jp/contact/for_club',
  participationFee: '1,000円',
  feeNote: '当日会場にてお支払いください。現金またはPayPayでお願いします。',
  calendarId: '289dd5e101d694cb0976ec8f41f5404c6baa88aa47dc00cafab9a34f49f03709@group.calendar.google.com',
  calendarDataUrl: 'data/calendar.json',
  paymentUrl: '',
  legalUrl: 'tokushoho.html',
  photos: {
    hero: { src: 'assets/photos/hero.jpg', alt: '日吉同好会のイメージ', position: '50% 50%' },
    solo: { src: 'assets/photos/solo03.jpg', alt: '姿勢と動きを丁寧に確かめる独り稽古', position: '50% 50%' },
    pair: { src: 'assets/photos/duo.jpg', alt: '相手と力をやり取りしながら確かめる対人稽古', position: '50% 20%' },
    instructor: { src: 'assets/photos/instructor.png', alt: '刀禅日吉同好会主宰 松浦壮', position: '50% 35%' }
  }
};
