# Emojiful Web GUI

Emojifulの絵文字パックを編集する共通GUIと、Minecraft **1.20.1 / Forge** 向けのMODです。
Astroが生成した同じHTML・Reactコンポーネント・JavaScriptを、Cloudflare Workers Static Assets、Pages、MODのlocalhostサーバーで配信します。

正規の公開先（日本語）: [https://emojiful-gui.aosankaku.net/ja/](https://emojiful-gui.aosankaku.net/ja/)

ロゴ・画面内の装飾・faviconには同じスマイルのSVG（`web/public/favicon.svg`）を使用します。
文字やOSの絵文字フォントを使わず、画像を同梱して端末による図柄の違いを防いでいます。
faviconのPNG代替画像とホーム画面用アイコンも同じSVGから生成した画像です。外部の画像配信サービスには依存しません。
図柄を変更する場合は、SVGを編集後に `bun run icons` でPNGを再生成してください（初回のみ `bunx playwright install chromium-headless-shell` が必要です）。通常のビルドではブラウザーは不要です。

## できること

- 画像URL・絵文字名・カテゴリーを登録、編集、削除
- 名前・カテゴリー・URLで検索、カテゴリーごとに表示
- CSV、TSV、JSON、URLリストの貼り付け／ファイルから一括追加
- 一括入力の「入力方法」を「表形式」に切り替え、行ごとに絵文字名・画像URL・カテゴリーを入力（行の追加・削除に対応）
- Nextcloudの公開共有フォルダーから、画面に表示した取得コマンドとXMLの貼り付け／ファイル選択で画像一覧を表に取り込み
- GIFの逆最適化と、WEBM・WEBP・APNGからGIFへの変換（legacy conversion）
- 複数パックの作成・切り替えと、パックごとのブラウザー下書き自動保存
- 下書きJSONの保存／復元、サイドバーの折りたたみと状態の保存
- Emojiful互換のデータパックZIPを書き出し、既存ZIPを読み込んで編集
- MOD版では管理パックを直接配置、配置済みパックを開いて編集
- 第一・第二言語範囲の22言語・地域の画面・入力エラー・チャット案内と、画面上の言語切り替え

静的版もMOD版も編集・入出力は同じです。MOD版では追加の配置APIが使えます。
画像はURLで参照し、画像の実体はZIPに含めません。PNG/GIF/JPGなどEmojifulで読み込める直接URLを指定してください。
URLの有効期限、配信元のアクセス制限、HTTPSサイトからHTTP画像を参照した場合のブラウザー制限によってプレビューが表示されないことがあります。

## Web GUIを使う

Bun **1.3.14以上**を依存管理とコマンド実行に使います。Astro・WranglerなどのCLI用にNode.js **22.12以上**も必要です。`bun.lock` で依存バージョンを固定します。

```sh
bun install --frozen-lockfile
bun run dev
```

開発GUI: `http://127.0.0.1:4321/`。変更は自動反映されます。

```sh
bun run build
bun run preview
```

静的サイトは `web/dist/` に生成されます。配信用のAPIサーバーやCloudflare Functions、サーバーでの画像ダウンロードは不要です。

### フォルダーを直接編集する

HTTPSまたはlocalhostで開いたChrome／Edgeでは、「フォルダーを開く」からデータパックのルート（`pack.mcmeta` と `data/` を含むフォルダー）を選び、編集後に「フォルダーに保存」を押すと、そのフォルダー内のEmojiful用メタデータと絵文字レシピを更新できます。変更は明示的な保存操作で反映し、保存時に書き込み権限を求めます。選択したフォルダーへのアクセスはブラウザーに記憶され、再読み込み後も対応ブラウザーでは再接続できます。詳しくはChromeの[File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access/)を参照してください。

フォルダー選択APIが使えないブラウザーでは、読み取り専用でフォルダーを取り込みます。そこでの編集結果は下書きとして保持し、ZIP出力を利用してください。直接編集では関係のないファイルを保持し、検出した外部変更がある場合は上書きせず保存を止めます。複数ファイルへの保存はファイルシステム上の単一トランザクションではありません。途中で失敗した場合は可能な範囲で元に戻しますが、ロールバックの完了を保証できない場合はその旨を表示します。

### 表示言語

日本語・英語に加え、第二言語範囲の20言語・地域（簡体字中国語〔中国〕、繁体字中国語〔台湾・香港〕、ヒンディー語、スペイン語、フランス語、ドイツ語、ポルトガル語〔ブラジル・ポルトガル〕、ロシア語、アラビア語、インドネシア語、韓国語、ベトナム語、トルコ語、イタリア語、ポーランド語、チェコ語、マレー語、ルーマニア語）に対応します。アラビア語は右から左へ表示し、URL・ID・CSVなどの入力欄は左から右へ表示します。

言語別の静的ページは `/ja/`、`/en/`、`/hi/`、`/zh-hk/`、`/zh-tw/`、`/zh-cn/`、`/ru/`、`/pt-br/`、`/pt-pt/`、`/es/`、`/de/`、`/cs/`、`/pl/`、`/ms/`、`/ro/`、`/fr/`、`/ar/`、`/id/`、`/ko/`、`/vi/`、`/tr/`、`/it/` です。ルート `/` は英語で表示します。ヘッダーの言語選択で切り替えられ、同じオリジン内で下書きを引き継ぎます。

MODのチャットURLは案内を表示した時点のMinecraft内の言語設定に合わせます（例：`ja_jp` → `/ja/`、`zh_hk` → `/zh-hk/`、`pt_br` → `/pt-br/`）。対応外の言語は `/en/` にフォールバックします。Webページの言語変更はMinecraft自体の言語設定を変更しません。

`shared/locales.json` で言語とMinecraft言語コードの対応を管理し、`web/src/i18n/messages/` で画面とMODの翻訳を管理します。Gradleが同じ定義からMOD用の翻訳リソースを生成するため、静的版とlocalhost版に同じ翻訳が使われます。

### Cloudflare Workers（Static Assets）

プロジェクトルートの `wrangler.jsonc` で `web/dist/` を静的アセットの配信元に指定しています。22言語のHTML・JavaScript・CSSをそのまま配信し、編集と下書き保存はブラウザー内で行います。`web/public/_headers` のCSPなどもWorkersの静的配信に適用されます。

以下のコマンドは、すべてプロジェクトルートで実行します。

```sh
bun run dev:workers
```

Workersでのローカル確認: `http://127.0.0.1:8787/ja/`。起動時に静的サイトをビルドし、Webソースと共通言語定義の変更時にも再ビルドします。通常の画面開発には `bun run dev`、Workersのルーティング・ヘッダーの確認には `bun run dev:workers` を使います。終了は `Ctrl+C` です。

公開前の検証:

```sh
bun run deploy:check  # ビルドとデプロイ設定の検証。公開はしません
bun run test:workers  # Workersのローカル環境でヘッドレス検証
```

Cloudflareへ公開:

```sh
bunx wrangler login   # 初回のアカウント認証
bun run deploy
```

CLIでの公開時も `wrangler.jsonc` の `build.command` が `web/dist/` を再生成します。Worker名は `emojiful-web-gui` です。別名で作成する場合は `wrangler.jsonc` の `name` を変更してください。公開先の `workers.dev` URLはデプロイ完了時に表示されます。

Git連携のWorkers Buildsでは、次の設定を指定します。Workers BuildsはWranglerのカスタムビルド設定を実行しないため、ビルドコマンドを明示します。

| 設定               | 値                   |
| ------------------ | -------------------- |
| プロジェクトルート | リポジトリのルート   |
| ビルドコマンド     | `bun run build`      |
| デプロイコマンド   | `bun run deploy`     |
| Node.js            | `NODE_VERSION=24`    |
| Bun                | `BUN_VERSION=1.3.14` |

公開サイトからlocalhostへ接続することはありません。Minecraftへの直接配置はMOD自身が配信するGUIで利用できます。

仕様はCloudflareの [Static Assets](https://developers.cloudflare.com/workers/static-assets/)、[ヘッダー](https://developers.cloudflare.com/workers/static-assets/headers/)、[Workers Builds設定](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) を参照してください。

### Cloudflare Pages（既存の配信方法）

Git連携のPagesプロジェクトで、以下を指定します。

| 設定               | 値                      |
| ------------------ | ----------------------- |
| プロジェクトルート | リポジトリのルート      |
| フレームワーク     | Astro（または設定なし） |
| ビルドコマンド     | `bun run build`         |
| ビルド出力         | `web/dist`              |
| Node.js            | `NODE_VERSION=24`       |
| Bun                | `BUN_VERSION=1.3.14`    |

手動アップロードでは `web/dist/` をアップロードします。実際の公開はCloudflareアカウント／Pagesプロジェクトの設定後に行ってください。
公開サイトからlocalhostへ接続することはありません。直接配置ボタンはMOD自身が配信するGUIでのみ有効になります。

## Forge MODをビルドする

JDK **17**、Bun **1.3.14以上**、Node.js **22.12以上**が必要です。Minecraft 1.20.1、Forge 47.4.10をビルド対象に固定しています。

```powershell
# WindowsでJavaの既定が17以外の場合は、インストール済みJDK 17を指定
$env:JAVA_HOME = 'C:\path\to\jdk-17'
bun install --frozen-lockfile
.\gradlew.bat build --no-daemon
```

macOS/Linux:

```sh
bun install --frozen-lockfile
sh gradlew build --no-daemon
```

`build/libs/emojiful_web_gui-0.1.0.jar` が配布用の再難読化済みJARです。
Gradleの `processResources` がWeb GUIをビルドし、`web/dist/` をJARの `web/` に同梱します。Webコードを別々に変更する必要はありません。

### Minecraftで使う

1. Forge 1.20.1環境に **Emojiful 4.2.0** とその依存MODを導入します。
2. 上記JARを同じ環境の `mods/` に配置し、Minecraftを起動します。
3. ワールドに入ると、Minecraftの言語設定に合ったGUIのURLを1回表示します。日本語の例は `http://127.0.0.1:8765/ja/`、対応外の言語では `http://127.0.0.1:8765/en/`。URLをクリックしてブラウザーで開きます（`localhost` も使用可）。ログにもGUIのベースURLを表示します。
4. 絵文字を編集し、「Minecraftに配置」を押します。
5. ワールドを開き直すか、権限のある状態で `/reload` を実行すると反映されます。Emojifulのデータパック読み込み設定を有効にしてください。

ワールドやサーバーに接続するたびに、クライアント自身のローカルGUIの案内を表示します。リスポーンやディメンション移動では再表示しません。ゲームのキー設定にある「Emojiful Web GUI」で任意のキーを割り当てると、いつでも案内を再表示できます。既定は未割り当てです。

配置先はゲームディレクトリの `config/emojiful-web-gui/packs/<パックID>.zip`。
Forgeのデータパック検出に登録するため、ローカルの各ワールドで利用できます。
同じIDが存在すると通常は配置を拒否します。明示的に上書きチェックを入れた場合だけ、管理済みパックを置き換えます。

専用サーバーでも利用できます。その場合GUIは**そのサーバーを動かしているコンピューター**のlocalhostにのみ公開されます。案内はサーバーのコンソールログにだけ表示し、サーバーからプレイヤーへチャットで送信しません。
別のサーバーに接続しているMinecraftクライアントで配置しても、接続先サーバーのデータパックは変更できません。
マルチプレイではサーバー側にもEmojifulとこのMODを入れるか、ZIPをサーバーのワールドの `datapacks/` に配置してください。

ポート競合時はゲームの起動を継続し、GUIの起動失敗をログに記録します。
JVM引数 `-Demojiful.webgui.port=8766` で別のポートを指定できます。`0` は空きポートを自動選択します（URLはログに表示）。LocalSend用の `53317` は指定できません。

### 静的版で作ったZIPを利用する

ZIPを**展開せず**に `<ワールド>/datapacks/` へ配置し、ワールドを開き直すか `/reload` してください。
この方法ではEmojiful Web GUI MODがなくても、Emojiful自体があれば利用できます。

## 入力形式

一括入力では「テキスト」「表形式」「Nextcloud」を切り替えられます。表形式は空行を読み飛ばし、カテゴリーが空欄の行には既定のカテゴリーを使います。入力不備や名前の重複がある場合は、全行の追加を中止します。
表では、重複・既存パックとの同名・入力不備のある行を太字と背景色で強調し、該当欄の下に理由を表示します。「次の問題行へ」で順に移動でき、修正すると表示も更新されます。

絵文字名は半角英小文字・数字・`_`・`-` を使えます（先頭の `-` は不可）。日本語・半角カナ・全角英数字・アクセント付き文字・絵文字などは登録エラーとし、名前の修正が必要です。個別編集でも入力中に赤いエラーを表示し、修正するまで登録できません。一括置換は置換対象外の行も検証し、不正な名前が残っていれば適用できません。入力したASCII大文字は小文字に変換します。カテゴリーや画像URLでは日本語を使用できます。

名前が12文字以上の絵文字は、看板などからはみ出す可能性がある「注意」として表とコレクションに表示します。名前本体の文字数で判定し、前後の `:` は数えません。注意だけの場合は追加・保存・出力できます。「名前の長さの注意基準」は1～64文字で変更でき、ブラウザーに保存します。「注意が必要な絵文字のみ」で絞り込み、編集ボタンから文字数を確認しながら個別に名前を短くできます。

「名前を一括置換」は、コレクションでは現在のパック全体、取り込み前の表では全行を対象にします。通常一致はすべての一致箇所を文字列のまま置換し、正規表現は `-nya$` などのパターンと `$1` などのキャプチャ参照を使えます。条件を入力して「置換をプレビュー」で変更前後を確認し、「置換を適用」で反映します。置換で重複・既存名との衝突・使用できない名前が生じる場合は適用できません。画像URLとカテゴリーは保持します。時間のかかる正規表現は別のワーカーで中断し、画面の操作を維持します。

### legacy conversion（GIFなどを変換する）

1. 画面上部の「legacy conversion」を開き、GIF・WEBM・WEBP・APNGを複数選びます。APNGは拡張子が`.png`でも選べますが、通常の静止PNGは対象外です。GIFは各フレームをキャンバス全体に描画し直し、Emojifulで扱いやすいGIFにします。
2. 出力サイズの上限は初期設定で128×128です。64、128、256、512から選べます。縦横比は保ち、画像を拡大しません。サイズを変更すると前の出力を破棄し、選択したファイルを新しいサイズで再変換できる状態に戻します。
3. 変換後、GIFを個別に保存するか、成功したGIFだけをZIPで保存します。画像をNextcloudなどへ再アップロードし、パック内の画像URLを手動で更新してください。変換結果でパックやURLを自動変更することはありません。

ファイルはブラウザー内で処理し、画像や動画をサイトへアップロードしません。変換エンジンは初回変換時に同じサイトからダウンロードされ、gzip圧縮で約9.7 MiBです。WebAssembly、Worker、OffscreenCanvas、DecompressionStreamに対応するブラウザーが必要です。WEBPのデコードにはブラウザー内蔵のWebPデコーダーも使います。WebMはVP8／VP9の透過を保持できますが、ほかのコーデックは変換できない場合があります。

一度に20ファイルまで、1ファイル32 MiBまで、入力合計128 MiBまでです。動画は60秒・1200フレームまで、画像の縦横はそれぞれ4096ピクセルまで、出力GIFの合計は64 MiBまでです。GIFは1フレーム256色で、透明度は完全透明か不透明の2段階です。色の量子化やフレーム間隔の10 ms単位への丸めにより、元データと色・透明境界・再生時間が異なることがあります。

### Nextcloudのフォルダーから取り込む

1. 「一括入力」→「入力方法」→「Nextcloud」を選び、公開フォルダーの共有URL（`https://cloud.example.com/s/SHARE_TOKEN`）を入力します。
2. 必要なら共有内のフォルダーと既定のカテゴリーを指定します。フォルダーが空欄なら共有URLの `?path=...` を使い、`/` を指定すると共有のルートを使います。
3. WindowsではPowerShell、macOS／Linuxではshを選び、表示されたコマンドをコピーしてターミナルで実行します。
4. 出力されたXML全体を画面に貼り付けて「表で確認」を押します。出力が長い場合は、コマンド末尾に `--output nextcloud-listing.xml` を付けて保存し、画面の「一覧のXMLファイルを選択」から読み込めます。
   表の上に共通のURLを表示し、各行ではその部分を省略します。URL欄を選択するとURL全体を確認・編集できます。パックには完全なURLを保存します。
   拡張子を除くと同じ名前になる画像は、`medetai-nya_gif`・`medetai-nya_png` のように区別します。文字変換や64文字への切り詰めで衝突する場合も、拡張子と必要に応じた連番で別名にし、画像をすべて保持します。
5. 表で名前・URL・カテゴリーを確認・修正し、「すべて追加」を押します。最後に通常のZIP出力やMOD配置を利用します。

対象はNextcloud 29以降の、パスワードなし・ダウンロード可能な公開共有フォルダーです。コマンドは[Nextcloud公式の公開共有WebDAV API](https://docs.nextcloud.com/server/stable/developer_manual/client_apis/WebDAV/basic.html#public-shares)に `PROPFIND`（`Depth: 1`）を送り、直下の一覧だけを読みます。PNG・GIF・JPG・JPEG・WebPを取り込み、サブフォルダー内は取得しません。画像本体のダウンロードやNextcloudへの書き込みは行いません。

ファイル名から既存の命名規則で絵文字名を生成します。大文字の拡張子、空白、日本語や記号を含むファイル名もURLでは正しくエンコードします。名前が重複した場合は表で修正してから追加してください。一覧の変換は現在の表の入力を置き換えます。共有URLとXMLの入力は、入力方法を切り替えても現在のダイアログで保持します。

一覧の解析はブラウザー内で行います。取得自体をターミナルで行うため、配信元の[CORS設定](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)に依存せず、Cloudflare Workers Static AssetsやMODの既存のCSP・配信構成を維持できます。

### テキストから取り込む

CSVの例（日本語のカテゴリーも使用可）:

```csv
name,url,category
happy_cat,https://example.com/cat.png,Animals
wave,https://example.com/wave.gif,Reactions
```

- ヘッダーは `name,url,category`。順番変更に対応します。カテゴリー列を省略した場合はダイアログで指定した値を使います。
- ヘッダーなしは `名前,URL,カテゴリー` または `URL,名前,カテゴリー`。
- TSVは同じ列構成をタブで区切ります。CSVは引用符で囲んだカンマにも対応します。
- JSONは `[{"name":"wave","url":"https://example.com/wave.gif","category":"Reactions"}]`、または下記プロジェクト形式。
- URLリストは1行に1つのURL。画像のファイル名から絵文字名を生成します。URLにカンマがあるときは入力形式を「URLリスト」に指定してください。
- 絵文字名は半角英小文字・数字・`_`・`-`、64文字以内（先頭の`-`は不可）。`:name:` は一括入力・個別編集で `name` に正規化します。
- パックIDは半角英小文字・数字・`_`、64文字以内。画像URLは認証情報を含まないHTTP(S)の完全なURL、2048文字以内。
- 1パック最大2000件、正規化後のJSON総量は1.5 MiBまで（静的版・MOD版共通）。取り込みファイル／貼り付けは4 MiBまで。ZIPの展開サイズは8 MiBまで。
- 不正な行や重複する絵文字名がある場合、部分的に追加せず全体を拒否します。

下書きJSON:

```json
{
  "schemaVersion": 1,
  "id": "my_emojis",
  "name": "My Emoji Pack",
  "description": "お気に入りの絵文字",
  "emojis": [
    {
      "name": "wave",
      "url": "https://example.com/wave.gif",
      "category": "Reactions"
    }
  ]
}
```

ZIPには `pack.mcmeta`（`pack_format: 15`）、`data/<パックID>/recipes/<名前>.json`、編集用の `emojiful-web-gui.json` を含めます。
レシピのtypeは `emojiful:emoji_recipe`。編集用メタデータのない通常のEmojifulデータパックも読み込めます。

下書きはサイトのオリジンごとに保存されます。公開サイト、localhost、127.0.0.1、異なるポート間で移動するには下書きJSONまたはZIPを使用してください。
従来の1パック分の保存データは、入力途中のパック情報も含めて新しい保存形式へ自動で引き継ぎます。以前の保存データも移行時の控えとして保持します。
画面上部のパック選択欄で下書きを切り替え、「新しいパック」で追加できます。サイドバーを折りたたんでも、選択欄から切り替えられます。読み込んだZIP／JSONやMODの配置済みパックは、現在の下書きを置き換えずに別の下書きとして追加されます。不要なパックは選択欄の隣から確認後に削除できます。
編集中でパック情報が未完成でも各下書きを保存します。下書きJSONの保存は現在選択中のパックが対象です。ZIP出力・直接配置時には現在選択中のパック全体を検証します。

## 検証

```sh
bun run check        # Webの型チェック
bun run test             # 形式互換性・一括入力・ZIPサイズ制限など
bun run build        # SSG
bunx playwright install chromium-headless-shell
bun run test:e2e     # 登録・編集・保存・出力・モバイル・MOD機能切り替え
```

```powershell
.\gradlew.bat test --no-daemon  # localhost API・配置・上書き・入力検証
.\gradlew.bat build --no-daemon # 配布JAR
```

PlaywrightはGUIを表示しないヘッドレスブラウザーを使用し、起動した一時プレビューサーバーを終了時に停止します。
Minecraft起動を伴う検証は上記のテストには含めません。

## 安全性と構成

- HTTPサーバーは `127.0.0.1` のみにバインドします。
- Host／Origin／Referer／Fetch Metadataを検証し、配置APIには起動ごとのランダムトークンを要求します。CORSは許可しません。
- APIの入力は2 MiBまで。パックIDとレシピ名を検証し、専用ディレクトリ以外への書き込みを防ぎます。
- パックの生成完了後に配置します。管理していないファイルやシンボリックリンクは上書きしません。
- 画像取得はブラウザーとEmojifulが行います。localhost APIが指定URLを取得することはありません。

`web/src/components/` に共通GUI、`web/src/lib/` に検証・一括入力・ZIP・実行環境判定、`mod/src/main/java/` にForge連携・HTTP・配置処理があります。

互換形式は [Emojifulの公式レシピ例](https://github.com/InnovativeOnlineIndustries/Emojiful/blob/1.20/Common/src/main/resources/data/emojiful/recipes/comfy.json) と [シリアライザー](https://github.com/InnovativeOnlineIndustries/Emojiful/blob/1.20/Common/src/main/java/com/hrznstudio/emojiful/datapack/EmojiRecipeSerializer.java) に基づきます。
公開設定は [Cloudflare PagesのAstroガイド](https://developers.cloudflare.com/pages/framework-guides/deploy-an-astro-site/) を参照してください。

## ライセンス

このプロジェクトのGUI／MODコードはMITライセンスです。legacy conversionで読み込むFFmpegベースの変換エンジンはGPL-2.0-or-laterで、同梱される各ライブラリーにも個別のライセンスが適用されます。対応するソースとライセンスは[エンジンの一覧](web/public/legacy-engine/SOURCES.md)を参照してください。Emojifulの非公式補助ツールです。
