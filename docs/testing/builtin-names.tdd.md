# Emojiful標準絵文字名との衝突を拒否する

2026-10-17。標準名と同じ名前のカスタム絵文字を登録しないため、Emojiful 1.20.1 / 4.2.0の取得・照合処理を確認し、標準名・別名2,082件を予約名として検査するようにした。判定対象・固定した出典・更新方法・ライセンスは [照合リストの説明](../builtin-emojis.md) に記録した。

## 仕様

- 大文字小文字と入力時の外側のコロンを正規化して照合する。全Twemoji別名、Customの別名、`swear`、同梱レシピの `comfy` と `kappa` を含む。ハイフンとアンダースコアは同一視せず、`my_smile` のような独自名を許可する。
- 個別編集、一括入力、表、一括置換で標準名の衝突をエラーとする。置換で変更しない行も検査する。表の該当行は太字・色・説明で強調する。
- 既存下書き、ZIP、フォルダーは引き続き読み込み可能。コレクションの該当カードを赤く強調し、衝突件数と注意・エラーの絞り込みを表示する。個別修正では他の未修正の衝突に妨げられず保存できる。
- データパックZIP出力、Minecraftへの送信、フォルダー書き込みは、衝突が残っている間は拒否する。フォルダーへの書き込み・送信より前に検査し、下書きJSONのバックアップと自動保存は維持する。
- 登録専用の `validateRegistrationName` / `validateRegistrationEmoji` / `validateRegistrationPack` を構文検証から分け、読み込み済みのデータを修正できる状態に保つ。
- エラー文・置換理由・件数・絞り込み文言は22言語に対応する。照合は同梱一覧を使い、実行時の外部通信を追加しない。

## RED → GREEN

先に回帰テストを追加し、既存の取り込み・出力・表・置換・送信処理が標準名を通してしまうことを確認した。REDテストのローカルチェックポイントは `c8432f9`。照合データを置いた状態で5ファイル100件を実行し、14件が意図どおり失敗、86件が成功した。フォルダー書き込みにも別途回帰を追加し、実装前は23件中1件が「拒否せず書き込む」ため失敗、22件が成功した。

実装後は次の検証が成功した。

| 保証                                                                                                                                                                 | 検証                                                                                                                                                                                                                                                                                                                                                 | 結果                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 標準名・別名の判定、入力・ZIP出力・追加分の検査、既存データの読み込み、未変更行を含む置換、保存・送信前の拒否、辞書整合性                                            | `node node_modules/vitest/vitest.mjs run tests/unit/pack.test.ts tests/unit/bulk-table.test.ts tests/unit/name-tools.test.ts tests/unit/folder.test.ts tests/unit/i18n.test.ts --maxWorkers=1 --no-file-parallelism`                                                                                                                                 | 106件成功                                                         |
| 一覧の件数・ソート・一意性、別名・大文字小文字・独自の接頭辞・区切り文字の区別                                                                                       | `node node_modules/vitest/vitest.mjs run tests/unit/builtin-emojis.test.ts --maxWorkers=1 --no-file-parallelism`                                                                                                                                                                                                                                     | 17件成功                                                          |
| 個別編集の即時拒否、テキスト入力の拒否、Nextcloudから表への移行後の強調、未変更・置換後の標準名の拒否、修正後の登録、旧下書きの復元、モバイル表示、修正前後のZIP出力 | `node node_modules/@playwright/test/cli.js test tests/browser/builtin-names.spec.ts`                                                                                                                                                                                                                                                                 | 3件成功                                                           |
| 影響する既存の個別・表・文字数注意・置換・Nextcloud・フォルダー・ワークスペース・22言語の画面                                                                        | `node node_modules/@playwright/test/cli.js test tests/browser/ascii-names.spec.ts tests/browser/bulk-table.spec.ts tests/browser/folder.spec.ts tests/browser/i18n.spec.ts tests/browser/name-tools.spec.ts tests/browser/nextcloud-collisions.spec.ts tests/browser/nextcloud.spec.ts tests/browser/studio.spec.ts tests/browser/workspace.spec.ts` | 42件成功                                                          |
| 型                                                                                                                                                                   | `node node_modules/astro/bin/astro.mjs check --root web`                                                                                                                                                                                                                                                                                             | 26ファイル、エラー・警告0件。既存の `returnValue` 非推奨ヒント1件 |
| 公開用ファイルとライセンス通知                                                                                                                                       | `node node_modules/astro/bin/astro.mjs build --root web`                                                                                                                                                                                                                                                                                             | 23ページを `web/dist/` に生成、`builtin-emojis/NOTICE.txt` を収録 |

既存テストの成功例で使っていた `cat`・`dog`・`wave`・`new` などは、予約名を正常に登録できるという古い前提をなくすため、カタログと重複しない名前へ変更した。独立レビューで見つかった `installPack` の同期例外化は `async` に修正し、既存のPromise契約を維持した状態で送信前の拒否テストも成功した。

Vitestの `TEMP`・`TMP` は `.work/vitest-temp` に設定した。Playwrightはヘッドレス実行とし、開始前後に4321番ポートのリスナーがないことを確認した。新しく開始したプレビューとブラウザーは終了している。

## 検証の限界

照合一覧は固定したスナップショットで、上流の将来の追加は更新作業が必要になる。Minecraftの起動、JAR生成、公開サイトへの配置、無関係なテストの全件実行、追加依存が必要なカバレッジ計測は行っていない。
