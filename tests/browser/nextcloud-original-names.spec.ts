import { test, expect } from '@playwright/test';
import ja from '../../web/src/i18n/messages/ja.json' with { type: 'json' };
import ar from '../../web/src/i18n/messages/ar.json' with { type: 'json' };

const root = '/public.php/dav/files/Share123/';
function listing(filenames: string[]) {
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${filenames.map((filename) => `<d:response><d:href>${root}${encodeURIComponent(filename)}</d:href><d:propstat><d:prop><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join('')}</d:multistatus>`;
}

test('original Japanese names and same-stem filenames survive review, manual edits and bulk replacement', async ({
  page,
}) => {
  await page.route('https://cloud.example/**', (route) => route.abort());
  await page.goto('/ja/');
  await page.getByRole('button', { name: ja.bulkInput, exact: true }).click();
  const mode = page.getByLabel(ja['bulk.mode'], { exact: true });
  await mode.selectOption('nextcloud');
  await page
    .getByLabel(ja['nextcloud.shareUrl'], { exact: true })
    .fill('https://cloud.example/s/Share123');
  const filenames = [
    'ショパン-nya.png',
    'バッハ-nya.png',
    'medetai-nya.gif',
    'medetai-nya.png',
  ];
  await page
    .getByLabel(ja['nextcloud.output'], { exact: true })
    .fill(listing(filenames));
  await page
    .getByRole('button', { name: ja['nextcloud.review'], exact: true })
    .click();
  const rows = page.locator('.bulk-table tbody tr');
  const name = (index: number) => rows.nth(index).getByRole('textbox').nth(0);
  const source = (index: number) =>
    rows.nth(index).locator('.bulk-source-filename');
  await expect(rows).toHaveCount(4);
  for (const [index, filename] of filenames.entries()) {
    await expect(name(index)).toHaveValue(filename.replace(/\.[^.]+$/, ''));
    await expect(source(index).locator('bdi')).toHaveText(filename);
    await expect(source(index)).toContainText('元のファイル名');
    await expect(name(index)).toHaveAttribute('aria-invalid', 'true');
    await expect(name(index)).toHaveCSS('font-weight', '700');
  }
  await expect(rows.nth(0).locator('.bulk-cell-issue')).toContainText(
    ja['error.emojiName'],
  );
  await expect(rows.nth(2).locator('.bulk-cell-issue')).toContainText('重複');
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(ja['error.emojiName']);
  await expect(page.locator('.emoji-card')).toHaveCount(0);

  await name(0).fill('chopin_nya');
  await name(3).fill('medetai-nya_png');
  await expect(source(0).locator('bdi')).toHaveText('ショパン-nya.png');
  await expect(source(3).locator('bdi')).toHaveText('medetai-nya.png');
  await mode.selectOption('nextcloud');
  await mode.selectOption('table');
  await expect(name(0)).toHaveValue('chopin_nya');
  await expect(source(0).locator('bdi')).toHaveText('ショパン-nya.png');

  await page
    .getByRole('dialog')
    .getByRole('button', { name: ja['replace.open'], exact: true })
    .click();
  await page.getByLabel(ja['replace.search'], { exact: true }).fill('バッハ');
  await page
    .getByLabel(ja['replace.replacement'], { exact: true })
    .fill('bach');
  await page
    .getByRole('button', { name: ja['replace.preview'], exact: true })
    .click();
  await page
    .getByRole('button', { name: ja['replace.apply'], exact: true })
    .click();
  await expect(name(1)).toHaveValue('bach-nya');
  await expect(source(1).locator('bdi')).toHaveText('バッハ-nya.png');
  await expect(page.locator('.bulk-row-issue')).toHaveCount(0);
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
  await expect(page.locator('.emoji-card')).toHaveCount(4);
  await page.reload();
  const saved = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('emojiful.pack-studio.workspace.v1')!)
        .packs[0].pack.emojis,
  );
  expect(saved.map((entry: { name: string }) => entry.name)).toEqual([
    'chopin_nya',
    'bach-nya',
    'medetai-nya',
    'medetai-nya_png',
  ]);
  expect(saved.map((entry: { url: string }) => entry.url)).toEqual(
    filenames.map(
      (filename) =>
        `https://cloud.example${root}${encodeURIComponent(filename)}`,
    ),
  );
  expect(
    saved.every(
      (entry: object) =>
        Object.keys(entry).sort().join(',') === 'category,name,url',
    ),
  ).toBe(true);
});

test('long and non-ASCII source names stay intact and remain repairable on Japanese and Arabic mobile tables', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('https://cloud.example/**', (route) => route.abort());
  for (const [locale, messages] of [
    ['ja', ja],
    ['ar', ar],
  ] as const) {
    await page.goto(`/${locale}/`);
    await page
      .getByRole('button', { name: messages.bulkInput, exact: true })
      .click();
    await page
      .getByLabel(messages['bulk.mode'], { exact: true })
      .selectOption('nextcloud');
    await page
      .getByLabel(messages['nextcloud.shareUrl'], { exact: true })
      .fill('https://cloud.example/s/Share123');
    const longName = 'a'.repeat(70);
    const filenames = ['牛乳を注ぐおんnya.png', `${longName}.GIF`];
    await page
      .getByLabel(messages['nextcloud.output'], { exact: true })
      .fill(listing(filenames));
    await page
      .getByRole('button', { name: messages['nextcloud.review'], exact: true })
      .click();
    const rows = page.locator('.bulk-table tbody tr');
    await expect(rows.nth(0).getByRole('textbox').nth(0)).toHaveValue(
      '牛乳を注ぐおんnya',
    );
    const longInput = rows.nth(1).getByRole('textbox').nth(0);
    await expect(longInput).toHaveValue(longName);
    await expect(longInput).toHaveAttribute('aria-invalid', 'true');
    await longInput.fill('milk_long');
    await expect(rows.nth(1).locator('.bulk-source-filename bdi')).toHaveText(
      `${longName}.GIF`,
    );
    await expect(rows.nth(0).locator('.bulk-source-filename bdi')).toHaveText(
      filenames[0],
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
