/* 写真・申込みフォーム・料金はここで変更できます。写真を用意するまで src は空欄のままで構いません。 */
window.HIYOSHI_CONFIG = {
  contactFormUrl: 'https://www.touzen.jp/contact/for_club',
  participationFee: '1,000円',
  feeNote: '当日会場にてお支払いください。現金またはPayPayでお願いします。',
  calendarId: '289dd5e101d694cb0976ec8f41f5404c6baa88aa47dc00cafab9a34f49f03709@group.calendar.google.com',
  calendarDataUrl: 'data/calendar.json',
  paymentUrl: '',
  legalUrl: 'tokushoho.html',
  photos: {
    hero: { src: 'assets/photos/hero.jpg', alt: '木々と青空を背景に、日吉同好会の3つの稽古風景を配した写真', position: '50% 50%' },
    solo: { src: 'assets/photos/solo.jpg', alt: '姿勢と動きを丁寧に確かめる独り稽古', position: '50% 50%' },
    pair: { src: 'assets/photos/duo.jpg', alt: '相手と力をやり取りしながら確かめる対人稽古', position: '50% 20%' },
    instructor: { src: 'assets/photos/instructor.png', alt: '刀禅日吉同好会主宰 松浦壮', position: '50% 35%' },
    gathering: { src: 'assets/photos/gather01.jpg', alt: '日吉同好会の稽古と語らいの風景', position: '50% 50%' },
    journal1: { src: '', alt: '基礎から順逆へつなげる稽古の様子', position: '50% 50%' },
    journal2: { src: '', alt: '木刀を使って身体の基準を確かめる稽古', position: '50% 50%' },
    journal3: { src: '', alt: '立ち方と身体のつながりを確かめる稽古', position: '50% 50%' }
  }
};
