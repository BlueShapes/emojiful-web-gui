# 名前の長さの注意表示と名前の一括置換

2026-10-17。利用者の要望から保証を定義し、TDDで実装した。

## 動作の保証

- 初期値は名前本体12文字以上を注意表示する。正規化で取り除く前後の `:` と空白は数えず、文字数はUnicodeコードポイント単位。注意基準は1～64で変更でき、ブラウザーに保存する。
- 表では長い名前を注意行として強調し、理由と問題行への移動を提供する。注意だけの入力を `aria-invalid` にせず、追加・保存・出力を妨げない。重複や不正入力の検証は維持する。
- コレクションでは注意カード・注意件数・注意対象のみのフィルターを提供する。個別編集では文字数と注意文が入力に追随する。
- 通常一致は全箇所を文字列として置換し、`$1` も通常文字列として扱う。正規表現は全箇所を対象にし、アンカーやキャプチャ参照を使える。
- 置換はパック全体または取り込み前の表全体を対象にし、範囲と変更前後を表示する。変更後の名前を正規化・検証し、全ての重複相手・既存名との衝突・置換による不正な名前を報告する。問題があれば適用しない。表の空行と置換対象外の名前を維持する。
- 画像URL・カテゴリーを保持する。プレビューだけではパックを変更せず、適用時に一括反映する。条件や元の名前を変更したらプレビューを無効化する。
- 正規表現は専用ワーカーで実行し、1500msの制限・条件変更・キャンセル・画面を閉じた時に終了する。

## RED → GREEN

REDチェックポイントは `6a4a7b2`。12文字の名前に表の注意がないことを単体テストで再現し、新しい置換処理のテストは未実装モジュールのため失敗した。実装後は対応する対象テストが成功した。

| 対象                                                                                                                                                                      | 実行したコマンド                                                                                                                                                                                                                                  | 結果                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 11/12文字境界、コロン・Unicode・設定値、通常一致・正規表現・置換参照・無効な式・空結果・衝突・件数容量制限・入力の不変性、共有バリデーターの互換性                        | `node node_modules/vitest/vitest.mjs run tests/unit/name-tools.test.ts tests/unit/pack.test.ts --maxWorkers=1 --no-file-parallelism`                                                                                                              | 41件成功                                                                     |
| 表の注意と既存の検証・原子的追加                                                                                                                                          | `node node_modules/vitest/vitest.mjs run tests/unit/bulk-table.test.ts --maxWorkers=1 --no-file-parallelism`                                                                                                                                      | 10件成功                                                                     |
| 22言語の新規33キーと補間引数                                                                                                                                              | `node node_modules/vitest/vitest.mjs run tests/unit/i18n.test.ts --maxWorkers=1 --no-file-parallelism`                                                                                                                                            | 5件成功                                                                      |
| 注意フィルター・個別編集・基準の保存、通常一致と正規表現の適用・衝突拒否・URLとカテゴリーの保持、タイムアウト後の回復・無効な式・条件変更・キャンセル、既存の重複・表機能 | `node node_modules/@playwright/test/cli.js test tests/browser/name-tools.spec.ts tests/browser/nextcloud-collisions.spec.ts tests/browser/bulk-table.spec.ts`                                                                                     | 初回10件成功。表内の置換ボタンはテスト対象をダイアログ内に限定して下記で成功 |
| 表の取り込み前の置換                                                                                                                                                      | `node node_modules/@playwright/test/cli.js test tests/browser/name-tools.spec.ts --grep 'table warnings                                                                                                                                           | mobile Japanese'`                                                            | 表の1件成功。モバイルの初回は言語間の下書き初期化のタイミングを修正 |
| モバイル日本語・アラビア語の注意とプレビュー                                                                                                                              | `node node_modules/@playwright/test/cli.js test tests/browser/name-tools.spec.ts --grep 'mobile Japanese'`                                                                                                                                        | 修正後1件成功、両言語を巡回。ページ・ダイアログの横幅と画像も確認            |
| Webの型                                                                                                                                                                   | `node node_modules/astro/bin/astro.mjs check --root web`                                                                                                                                                                                          | 最終25ファイル、エラー・警告0件。既存の `returnValue` 非推奨ヒント1件        |
| ワーカーの型                                                                                                                                                              | `node node_modules/typescript/bin/tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,DOM --allowSyntheticDefaultImports --skipLibCheck --types vite/client web/src/workers/name-replacement.worker.ts` | 成功                                                                         |
| 公開用静的サイト                                                                                                                                                          | `node node_modules/astro/bin/astro.mjs build --root web`                                                                                                                                                                                          | 23ページを `web/dist/` に生成                                                |

単体56件、ブラウザー12件の成功を確認した。既存の検証結果を再利用し、変更したテストと必要なモバイル確認だけを再実行した。Vitestは `TEMP`・`TMP` を `.work/vitest-temp` に設定した。独立レビューで実装・状態更新・ワーカー終了・保存処理を確認し、重大な指摘はなかった。

## 検証の限界

注意基準は文字数の目安であり、実際の看板の描画幅やフォント幅は測定していない。Minecraftの起動、JAR生成、公開サイトへの配置は実施していない。カバレッジ計測用の追加依存は導入していない。ビルドは成功しているが、Viteの500kB超チャンクの案内がある。開始したブラウザーとプレビューは終了し、4321番ポートにリスナーが残っていないことを確認した。
