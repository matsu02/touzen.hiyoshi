独り稽古・対人稽古の写真は、次の専用フォルダーへ追加してください。

solo/          独り稽古（初期状態は solo03.jpg のみ）
pair/          対人稽古（初期状態は duo.jpg のみ）

フォルダーの直下に JPG・JPEG・PNG・WebP・AVIF・GIF を置き、通常どおり
main ブランチへコミット・プッシュすると、公開時に自動で候補に加わります。
ページを開くたびに、それぞれのフォルダーからランダムで1枚を表示します。
候補から外す場合は、画像を削除して公開します。隠しファイル・サブフォルダーは対象外です。

ローカル確認用の一覧を更新するコマンド（リポジトリのルートで実行）:
node scripts/build-practice-photos.mjs

assets/practice-photo-data.js は自動生成、data/practice-photos.json は公開時に
Jekyllが処理するテンプレートです。詳しくはルートの README.md を参照してください。

その他の写真は、このフォルダーに置き、assets/site-config.js の photos で指定してください。

推奨ファイル名:
hero.jpg        冒頭の稽古風景
instructor.jpg  主宰者

例:
hero: { src: 'assets/photos/hero.jpg', alt: '実際の写真の説明', position: '50% 50%' }

src を空文字のままにすると、現在の写真用スペースが表示されます。
画像ファイルのないパスを入れる必要はありません。
写真を入れると「写真準備中」の表示は自動的に消えます。
