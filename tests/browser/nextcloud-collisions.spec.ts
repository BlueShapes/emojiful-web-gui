import { test, expect } from '@playwright/test';
import ja from '../../web/src/i18n/messages/ja.json' with { type: 'json' };

const root = '/public.php/dav/files/Share123/';
function listing(...filenames: string[]) {
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${filenames.map((filename) => `<d:response><d:href>${root}${encodeURIComponent(filename)}</d:href><d:propstat><d:prop><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join('')}</d:multistatus>`;
}

test('same-stem Nextcloud files import separately and manually introduced collisions highlight every row', async ({
  page,
}) => {
  await page.route('https://cloud.example/**', (route) => route.abort());
  await page.goto('/ja/');
  await page.getByRole('button', { name: ja.bulkInput, exact: true }).click();
  await page
    .getByLabel(ja['bulk.mode'], { exact: true })
    .selectOption('nextcloud');
  await page
    .getByLabel(ja['nextcloud.shareUrl'], { exact: true })
    .fill('https://cloud.example/s/Share123');
  await page
    .getByLabel(ja['nextcloud.output'], { exact: true })
    .fill(listing('medetai-nya.gif', 'medetai-nya.png', 'medetai-tai-nya.png'));
  await page
    .getByRole('button', { name: ja['nextcloud.review'], exact: true })
    .click();
  const rows = page.locator('.bulk-table tbody tr');
  const name = (index: number) => rows.nth(index).getByRole('textbox').nth(0);
  await expect(rows).toHaveCount(3);
  await expect(name(0)).toHaveValue('medetai-nya_gif');
  await expect(name(1)).toHaveValue('medetai-nya_png');
  await expect(page.locator('.bulk-row-issue')).toHaveCount(0);
  await name(0).fill('medetai-nya');
  await name(1).fill(':MEDETAI-NYA:');
  await expect(page.locator('.bulk-row-issue')).toHaveCount(2);
  for (const index of [0, 1]) {
    await expect(name(index)).toHaveAttribute('aria-invalid', 'true');
    await expect(name(index)).toHaveCSS('font-weight', '700');
    await expect(rows.nth(index).locator('.bulk-cell-issue')).toContainText(
      '重複',
    );
  }
  await expect(page.locator('.bulk-issue-summary')).toContainText('2');
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.emoji-card')).toHaveCount(0);
  await name(1).fill('medetai-nya_png');
  await expect(page.locator('.bulk-row-issue')).toHaveCount(0);
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
  await expect(page.locator('.emoji-card')).toHaveCount(3);
  const saved = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('emojiful.pack-studio.workspace.v1')!)
        .packs[0].pack.emojis,
  );
  expect(saved.slice(0, 2).map((emoji: { url: string }) => emoji.url)).toEqual([
    `https://cloud.example${root}medetai-nya.gif`,
    `https://cloud.example${root}medetai-nya.png`,
  ]);
});

test('invalid fields and existing names are emphasized live and jump to the next affected row', async ({
  page,
}) => {
  await page.route('https://example.com/**', (route) => route.abort());
  await page.goto('/ja/');
  await page.getByRole('button', { name: ja.bulkInput, exact: true }).click();
  await page
    .getByLabel(ja['bulk.data'])
    .fill('cat,https://example.com/cat.png');
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
  await page.getByRole('button', { name: ja.bulkInput, exact: true }).click();
  await page.getByLabel(ja['bulk.mode'], { exact: true }).selectOption('table');
  const rows = page.locator('.bulk-table tbody tr');
  const cell = (row: number, column: number) =>
    rows.nth(row).getByRole('textbox').nth(column);
  await cell(0, 0).fill(':CAT:');
  await cell(0, 1).fill('https://example.com/cat2.png');
  await cell(2, 0).fill('dog');
  await cell(2, 1).fill('javascript:alert(1)');
  await expect(page.locator('.bulk-row-issue')).toHaveCount(2);
  await expect(cell(0, 0)).toHaveAttribute('aria-invalid', 'true');
  await expect(cell(2, 1)).toHaveAttribute('aria-invalid', 'true');
  await expect(rows.nth(0).locator('.bulk-cell-issue')).toContainText('使用');
  await expect(rows.nth(1)).not.toHaveClass(/bulk-row-issue/);
  await page
    .getByRole('button', { name: ja['bulk.nextIssue'], exact: true })
    .click();
  await expect(cell(0, 0)).toBeFocused();
  await page
    .getByRole('button', { name: ja['bulk.nextIssue'], exact: true })
    .click();
  await expect(cell(2, 1)).toBeFocused();
  await page.screenshot({
    path: '.work/bulk-table-issues-desktop.png',
    fullPage: true,
  });
  await cell(0, 0).fill('other_cat');
  await cell(2, 1).fill('https://example.com/dog.png');
  await expect(page.locator('.bulk-row-issue')).toHaveCount(0);
  await expect(page.locator('.bulk-issue-summary')).toHaveCount(0);
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
  await expect(page.locator('.emoji-card')).toHaveCount(3);
});
