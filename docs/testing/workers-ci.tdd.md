# WorkersのCIテストと標準絵文字名の検証を整合させる

2026-10-17。GitHub Actionsの失敗原因は、標準絵文字名の登録を禁止した後も、Workersの画面テストが `wave` を正常に登録できると期待していたことだった。

## RED

[標準名の検証を追加したコミットのCI](https://github.com/BlueShapes/emojiful-web-gui/actions/runs/39019388539) と [後続コミットのCI](https://github.com/BlueShapes/emojiful-web-gui/actions/runs/39025958475) は、ともに `bun run test:workers` の画面テストで失敗していた。Webのチェック・単体テスト、Gradleビルド、公開用ビルドのdry-run、通常の画面テストは成功していた。

修正前の `d8ded84` で次のコマンドを実行し、同じ失敗をローカルでも再現した。

```text
node node_modules/@playwright/test/cli.js test --config playwright.workers.config.ts -g "Workers GUI"
```

1件失敗。`wave` の追加は仕様どおり拒否されるため、`:wave:` の表示待ちがタイムアウトした。

## 修正とGREEN

同じ画面テストで `wave` の追加時に標準名との衝突エラーが表示され、追加件数が0件であることを確認する。その後、入力を独自名の `my_wave` に修正し、登録・再読み込みでの復元・英語画面への切り替え・ZIP出力が成功することを確認する。アプリケーションの標準名検証とCIの実行項目は変更しない。

```text
node node_modules/@playwright/test/cli.js test --config playwright.workers.config.ts
```

Workersの全5件が成功した。修正対象の画面テストに加え、本番相当のCSPでのGIF変換、22言語のセキュリティヘッダー、変換エンジンの配信と整合性、リダイレクト・404も確認できた。

テストはヘッドレスで実行し、Playwrightが開始したローカルサーバーとブラウザーは終了した。今回はテストの修正のみのため、ローカルでのJAR生成やアプリケーション全体の再テストは行っていない。
