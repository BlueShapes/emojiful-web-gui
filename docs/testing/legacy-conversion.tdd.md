# legacy conversionの検証

2026-10-16。Web版とMOD内GUIに、GIF逆最適化とWEBM・WEBP・APNGのGIF化を追加した。

## 受け入れ条件

- 各GIFフレームはオフセット0・キャンバス全体のサイズで、透明部分を含めて独立して描画できる。前フレームの残像を残さない。
- 初期設定は縦横各128px以内。縦横比を維持し、拡大しない。64／128／256／512を選べ、変更後は再変換する。
- 元の待ち時間とループをGIF形式の範囲で維持する。端数の待ち時間は累積時刻から丸め、総時間の誤差を抑える。
- ローカルファイルをWorker内で処理し、画像をアップロードしない。成功したGIFを個別／ZIP保存できる。パックのURL更新はユーザーが行う。
- 20ファイル・各32MiB・入力合計128MiB、縦横4096px・60秒・1200フレーム、出力合計64MiBを上限にする。中断・タイムアウト時はWorkerを終了する。
- 変換エンジンを同一サイトから必要時に読み込む。単一スレッドで動き、SharedArrayBufferや外部CDNを要求しない。圧縮WASMは約9.7MiBで、Cloudflareの個別アセット上限内に収める。

## RED → GREENと修正

REDチェックポイントは`9798b66`。最初の4件は`legacy-media`が未実装のため失敗した。実装後に成功した。

独立レビューで、VP8X付き静止WEBPを拒否する不具合、1/60秒の各フレームを独立に丸めると1秒が1.2秒になる不具合、サイズ変更後に再変換できない不具合を検出した。静止WEBPと累積時間の回帰テストをそれぞれ失敗させてから修正し、サイズ変更はブラウザーで再変換まで確認した。

実ブラウザー検証で、Astro previewが`.gz`をContent-Encoding付きで返すためfetchが自動展開し、さらにDecompressionStreamで展開して失敗する問題を検出した。受け取ったバイトのgzipマジックを確認し、展開済み／未展開の両方を処理するよう修正した。Workersでは未展開のgzipと実際のCSPで変換を確認した。

固定したFFmpeg coreのffprobeは有効なJSONを書いても戻り値が-1のままになる。新規生成したJSONのストリーム寸法・長さも検証し、正常なWEBMを拒否しないようにした。アニメーションWEBPはコアのデコーダーが対応しないため、ブラウザーの静止WEBPデコーダーで各ANMFパッチを合成し、GIFへ変換する。背景のヒントで透明部分を不透明にしない。

透過テストの初期GIFは不透明な背景パレットを指定していた。透過インデックスを明示した差分GIFに修正し、元の不透明GIFも別のケースとして残した。透過ケースは透明を保ち、不透明ケースは赤い背景を保つことを確認した。ループ回数も入力ファイルの実際の値に合わせて確認した。

## 実行結果

| 対象                                                                               | コマンド                                                                                                | 結果                                                                       |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 入力形式・GIF構造・サイズ・待ち時間・Worker終了・22言語辞書                        | `bun run test tests/unit/legacy-media.test.ts tests/unit/legacy-client.test.ts tests/unit/i18n.test.ts` | 14件成功                                                                   |
| Webの型チェック                                                                    | `bun run check`                                                                                         | エラー・警告0件、既存beforeunloadの非推奨ヒント1件                         |
| 実エンジンで4形式、透過／不透明GIF、ループ、フレーム、ZIP、128／64px、中断と再試行 | `bun run test:e2e tests/browser/legacy.spec.ts`                                                         | 対象3件成功。最終の形式テストは修正したfixtureとループの期待値で個別に成功 |
| 22言語のモバイル画面・入力エラー・既存一括入力                                     | `bun run test:e2e tests/browser/i18n.spec.ts --grep 'all 22 static routes'`                             | 1件成功、22言語を巡回                                                      |
| MODのCSP、ネストしたJS／gzip／manifest、ライセンス配信                             | `gradlew.bat test --tests '*WebGuiHttpServerTest' --no-daemon`                                          | 9件成功                                                                    |
| 実WorkersのCSP・gzip完全性・SHA256・ライセンス                                     | `bun run test:workers --grep 'production security headers\|complete self-hosted'`                       | 2件成功                                                                    |
| 実Workersの圧縮エンジンで128×64へ変換                                              | `bun run test:workers --grep 'legacy conversion runs'`                                                  | 1件成功                                                                    |
| Cloudflareの配布構成                                                               | `bun run deploy:check`                                                                                  | dry-run成功、公開は実行しない                                              |

独立レビューでの指摘は修正済みで、最終レビューでは追加の具体的な問題は見つからなかった。生成されたGIFは、本番処理には使わないomggifデコーダーで各フレームを独立に読み、矩形・disposal・透明度・色・残像・待ち時間・ループを検証した。日本語デスクトップと日本語／アラビア語のモバイル画面も目視した。

再難読化JARの生成も成功した。JAR内のWorker・圧縮エンジン・manifest・ソース案内・ライセンスの同梱を確認し、ローカル指示の配置先へ上書きした。SHA256一致とGUI MODのJARが1個であることを確認した。起動したプレビュー・Workers・ヘッドレスブラウザーは終了済み。

## 検証の限界

Chromiumのヘッドレスブラウザーと人工的な小さな画像を使用した。Firefox／Safari、全コーデックや巨大ファイル、ユーザーの実データ、Minecraft内での描画、公開サイトへのデプロイは未検証。GIFの256色パレット・2段階の透明度・10ms単位の待ち時間、ブラウザーの最短フレーム時間の制約は残る。

参照: [FFmpeg.wasmの利用方法](https://ffmpegwasm.netlify.app/docs/getting-started/usage/)、[core 0.12.10のビルド定義](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/71aa99d37c02a7b4c435275ca9ef50e612f6efa1/Dockerfile)、[WebP RIFF仕様](https://developers.google.com/speed/webp/docs/riff_container)、[Cloudflare Workers制限](https://developers.cloudflare.com/workers/platform/limits/)。
