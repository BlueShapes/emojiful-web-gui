import { test, expect } from '@playwright/test';
import ja from '../../web/src/i18n/messages/ja.json' with { type: 'json' };
import ar from '../../web/src/i18n/messages/ar.json' with { type: 'json' };

test.beforeEach(async ({ page }) => {
  await page.route('https://example.com/**', (route) => route.abort());
});

test('table rows can be edited and removed, retain drafts across modes and persist together', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/ja/');
  await page
    .getByRole('button', { name: ja['bulkInput'], exact: true })
    .click();
  const mode = page.getByLabel(ja['bulk.mode'], { exact: true });
  await page
    .getByLabel(ja['bulk.data'])
    .fill('my_wave,https://example.com/my_wave.png');
  await mode.selectOption('table');
  const rows = page.locator('.bulk-table tbody tr');
  await expect(rows).toHaveCount(3);
  await page.getByLabel(ja['bulk.defaultCategory']).fill('Pets');
  await rows.nth(0).getByRole('textbox').nth(0).fill(':MY_CAT:');
  await rows
    .nth(0)
    .getByRole('textbox')
    .nth(1)
    .fill('https://example.com/my_cat.png');
  await rows.nth(2).getByRole('textbox').nth(0).fill('my_dog');
  await rows
    .nth(2)
    .getByRole('textbox')
    .nth(1)
    .fill('https://example.com/my_dog.png');
  await rows.nth(2).getByRole('textbox').nth(2).fill('Animals');
  await page
    .getByRole('button', { name: ja['bulk.addRow'], exact: true })
    .click();
  await expect(rows).toHaveCount(4);
  await rows.nth(1).getByRole('button').click();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1).getByRole('textbox').nth(0)).toHaveValue('my_dog');
  await mode.selectOption('text');
  await expect(page.getByLabel(ja['bulk.data'])).toHaveValue(
    'my_wave,https://example.com/my_wave.png',
  );
  await mode.selectOption('table');
  await expect(rows.nth(0).getByRole('textbox').nth(0)).toHaveValue(':MY_CAT:');
  await page.screenshot({
    path: '.work/bulk-table-desktop.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
  await expect(page.locator('.emoji-card')).toHaveCount(2);
  await expect(page.getByText(':my_cat:', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.emoji-card')).toHaveCount(2);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('emojiful.pack-studio.workspace.v1')!),
  );
  expect(
    saved.packs[0].pack.emojis.map(
      (entry: { category: string }) => entry.category,
    ),
  ).toEqual(['Pets', 'Animals']);
  expect(errors).toEqual([]);
});

test('table validation keeps every row and rejects partial imports and existing names', async ({
  page,
}) => {
  await page.goto('/ja/');
  await page
    .getByRole('button', { name: ja['bulkInput'], exact: true })
    .click();
  await page
    .getByLabel(ja['bulk.data'])
    .fill('my_cat,https://example.com/my_cat.png');
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
  await page
    .getByRole('button', { name: ja['bulkInput'], exact: true })
    .click();
  await page.getByLabel(ja['bulk.mode']).selectOption('table');
  const rows = page.locator('.bulk-table tbody tr');
  await rows.nth(0).getByRole('textbox').nth(0).fill('my_dog');
  await rows
    .nth(0)
    .getByRole('textbox')
    .nth(1)
    .fill('https://example.com/my_dog.png');
  await rows.nth(2).getByRole('textbox').nth(0).fill('my_cat');
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('3件目');
  await expect(rows.nth(0).getByRole('textbox').nth(0)).toHaveValue('my_dog');
  await rows
    .nth(2)
    .getByRole('textbox')
    .nth(1)
    .fill('https://example.com/second-my_cat.png');
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('重複');
  await page.getByRole('button', { name: ja['closeEditor'] }).click();
  await expect(page.locator('.emoji-card')).toHaveCount(1);
});

test('the table stays inside the dialog on mobile and RTL pages', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [locale, messages] of [
    ['ja', ja],
    ['ar', ar],
  ] as const) {
    await page.goto(`/${locale}/`);
    await page
      .getByRole('button', { name: messages['bulkInput'], exact: true })
      .click();
    await page.getByLabel(messages['bulk.mode']).selectOption('table');
    await expect(
      page.getByRole('columnheader', {
        name: messages['field.imageUrl'],
        exact: true,
      }),
    ).toBeVisible();
    const bounds = await page.locator('.editor-dialog').evaluate((dialog) => ({
      width: dialog.clientWidth,
      scrollWidth: dialog.scrollWidth,
      right: dialog.getBoundingClientRect().right,
      viewport: window.innerWidth,
    }));
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width + 1);
    expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);
    await page.screenshot({
      path: `.work/bulk-table-mobile-${locale}.png`,
      fullPage: true,
    });
  }
});
