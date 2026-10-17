# Emojiful標準絵文字名の照合リスト

`web/src/data/builtin-emoji-names.json` は2026-10-17時点の標準絵文字名・別名2,082件を、小文字・前後のコロンなし・重複なし・昇順で記録する。画像は収録しない。Webアプリはこの一覧でローカル照合し、外部サービスへの問い合わせを必要としない。

## 対象と出典

Emojiful Forge 1.20.1 / 4.2.0の標準設定を対象とする。ローダーと比較処理は、[公式Emojifulソース](https://github.com/InnovativeOnlineIndustries/Emojiful/tree/6442d9d75ddc39308d8cdce8f14e0a9aa3011519) の `ClientEmojiHandler`、`CommonClass`、`api/Emoji` で確認した。標準設定のTwemoji・Custom・Datapackは有効で、名前は大文字小文字を区別しない。ハイフンとアンダースコアは別の文字として扱う。

| 対象                     | 固定した出典                                                                                                                                                                                         | 抽出方法                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Twemojiの標準名と別名    | [iamcal/emoji-data](https://github.com/iamcal/emoji-data/tree/13ee711e222ea17fe537bfea953c687866f16411) の `emoji.json`                                                                              | `has_img_twitter === true` の全 `short_names`。1,919画像に対して1,980名              |
| Emojiful独自の標準絵文字 | [emojiful-assets](https://github.com/InnovativeOnlineIndustries/emojiful-assets/tree/2f43350cfe872e3c66716cffa9dd7d8d3132e757) の `Categories.yml` が参照する `Discord.yml`、`Blobs.yml`、`Pepe.yml` | 各エントリーの全 `strings`。画像名や表示用の `name` で代用しない。97画像に対して99名 |
| ローダーが追加する別名   | 上記Emojifulソースの `ClientEmojiHandler.loadTwemojis`                                                                                                                                               | `face_with_symbols_on_mouth` の別名 `swear`                                          |
| MOD同梱データパック      | 上記Emojifulソースの `Common/src/main/resources/data/emojiful/recipes/`                                                                                                                              | `kappa` と `comfy`                                                                   |

上記はMODが実行時に取得する一覧のスナップショットであり、外部リポジトリの将来の追加は自動反映しない。利用者側で標準絵文字機能を無効にした設定も、GUIでは同じ予約名として扱う。

## 更新手順

1. 対象MODバージョンのローダーと設定を確認し、取得先・名前の比較方法・同梱レシピが変わっていないか確認する。
2. `emoji-data` と `emojiful-assets` の対象コミットを固定し、上表のJSONとYAMLを取得する。YAMLはYAMLパーサーで読み、全 `strings` を抽出する。各値が `:名前:` の形式であることを確認して前後のコロンを除く。
3. Twemoji別名、全Custom別名、ローダーが追加する別名、同梱レシピ名を統合し、小文字化・重複除去・昇順ソートしてJSON配列を書き出す。現在の内訳は `1980 + 99 + 1 + 2 = 2082`。
4. 参照コミットと取得日、件数、ライセンスを本書と `third_party/builtin-emojis/` に更新する。標準別名・Custom別名・独自の接頭辞名を含む単体テストと、標準名を修正して登録するブラウザーテストを実行する。

## ライセンスと帰属

- emoji-data: Copyright (c) 2013 Cal Henderson、MIT。原文は [emoji-data-LICENSE](../third_party/builtin-emojis/emoji-data-LICENSE)。
- Emojiful: Copyright (c) 2022 Innovative Online Industries、MIT。原文は [Emojiful-LICENSE](../third_party/builtin-emojis/Emojiful-LICENSE)。
- emojiful-assets: Innovative Online Industries提供、CC BY 4.0。原文は [emojiful-assets-LICENSE](../third_party/builtin-emojis/emojiful-assets-LICENSE)。上記リンク先のYAMLから名前・別名のみ抽出し、コロン除去・小文字化・ソートして改変した。

ライセンスと帰属は、配布サイトにも `builtin-emojis/NOTICE.txt` として含める。
