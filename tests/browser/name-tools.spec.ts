import { test, expect } from '@playwright/test';
import ja from '../../web/src/i18n/messages/ja.json' with { type: 'json' };
import ar from '../../web/src/i18n/messages/ar.json' with { type: 'json' };

const imported =
  'eleven_chars,https://example.com/one.png,Animals\nvery_long_name_nya,https://example.com/two.png,Animals\nshort,https://example.com/three.png,Other';
async function importPack(page: import('@playwright/test').Page) {
  await page.route('https://example.com/**', (route) => route.abort());
  await page.goto('/ja/');
  await page.getByRole('button', { name: ja.bulkInput, exact: true }).click();
  await page.getByLabel(ja['bulk.data']).fill(imported);
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
}

test('long names are warnings, can be filtered and edited individually, and respect a saved threshold', async ({
  page,
}) => {
  await importPack(page);
  await expect(page.locator('.emoji-card')).toHaveCount(3);
  await expect(page.locator('.emoji-card-warning')).toHaveCount(2);
  await page.getByLabel(ja['name.attentionOnly'], { exact: true }).check();
  await expect(page.locator('.emoji-card')).toHaveCount(2);
  await page
    .getByRole('button', {
      name: ja.editNamed.replace('{name}', 'very_long_name_nya'),
      exact: true,
    })
    .click();
  await expect(page.locator('.name-length-warning')).toContainText('18');
  await page
    .getByLabel(ja['field.emojiName'], { exact: true })
    .fill('little_nya');
  await expect(page.locator('.name-length-warning')).toHaveCount(0);
  await page.getByRole('button', { name: ja.saveChanges, exact: true }).click();
  await expect(page.locator('.emoji-card')).toHaveCount(1);
  await page
    .getByLabel(ja['name.warningThreshold'], { exact: true })
    .fill('13');
  await expect(page.locator('.emoji-card')).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByLabel(ja['name.warningThreshold'], { exact: true }),
  ).toHaveValue('13');
});

test('literal and regex name replacements preview changes, reject collisions and persist only names', async ({
  page,
}) => {
  await importPack(page);
  await page
    .getByRole('button', { name: ja['replace.open'], exact: true })
    .click();
  await page.getByLabel(ja['replace.search'], { exact: true }).fill('_nya');
  await page.getByLabel(ja['replace.replacement'], { exact: true }).fill('');
  await page
    .getByRole('button', { name: ja['replace.preview'], exact: true })
    .click();
  await expect(page.locator('.name-replacement-preview')).toContainText(
    'very_long_name',
  );
  const draftBefore = await page.evaluate(() =>
    localStorage.getItem('emojiful.pack-studio.workspace.v1'),
  );
  expect(draftBefore).toContain('very_long_name_nya');
  await page
    .getByRole('button', { name: ja['replace.apply'], exact: true })
    .click();
  await expect(
    page.getByText(':very_long_name:', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: ja['replace.open'], exact: true })
    .click();
  await page
    .getByLabel(ja['replace.mode'], { exact: true })
    .selectOption('regex');
  await page.getByLabel(ja['replace.search'], { exact: true }).fill('.*');
  await page
    .getByLabel(ja['replace.replacement'], { exact: true })
    .fill('same');
  await page
    .getByRole('button', { name: ja['replace.preview'], exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: ja['replace.apply'], exact: true }),
  ).toBeDisabled();
  await expect(page.locator('.name-replacement-problems')).toContainText(
    '重複',
  );
  await page
    .getByLabel(ja['replace.search'], { exact: true })
    .fill('^(very)_(long)_(name)$');
  await page
    .getByLabel(ja['replace.replacement'], { exact: true })
    .fill('$1_$3');
  await page
    .getByRole('button', { name: ja['replace.preview'], exact: true })
    .click();
  await expect(page.locator('.name-replacement-preview')).toContainText(
    'very_name',
  );
  await page
    .getByRole('button', { name: ja['replace.apply'], exact: true })
    .click();
  await page.reload();
  const saved = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('emojiful.pack-studio.workspace.v1')!)
        .packs[0].pack.emojis,
  );
  expect(saved.map((emoji: { name: string }) => emoji.name)).toEqual([
    'eleven_chars',
    'very_name',
    'short',
  ]);
  expect(saved.map((emoji: { url: string }) => emoji.url)).toEqual([
    'https://example.com/one.png',
    'https://example.com/two.png',
    'https://example.com/three.png',
  ]);
  expect(saved.map((emoji: { category: string }) => emoji.category)).toEqual([
    'Animals',
    'Animals',
    'Other',
  ]);
});

test('table warnings allow addition and replacements work before importing', async ({
  page,
}) => {
  await page.goto('/ja/');
  await page.getByRole('button', { name: ja.bulkInput, exact: true }).click();
  await page.getByLabel(ja['bulk.mode'], { exact: true }).selectOption('table');
  const rows = page.locator('.bulk-table tbody tr');
  await rows.nth(0).getByRole('textbox').nth(0).fill('a_very_long_nya');
  await rows
    .nth(0)
    .getByRole('textbox')
    .nth(1)
    .fill('https://example.com/cat.png');
  await expect(rows.nth(0)).toHaveClass(/bulk-row-warning/);
  await expect(rows.nth(0).getByRole('textbox').nth(0)).not.toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await page
    .getByRole('button', { name: ja['bulk.nextIssue'], exact: true })
    .click();
  await expect(rows.nth(0).getByRole('textbox').nth(0)).toBeFocused();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: ja['replace.open'], exact: true })
    .click();
  await page
    .getByLabel(ja['replace.search'], { exact: true })
    .fill('a_very_long_');
  await page.getByLabel(ja['replace.replacement'], { exact: true }).fill('');
  await page
    .getByRole('button', { name: ja['replace.preview'], exact: true })
    .click();
  await page
    .getByRole('button', { name: ja['replace.apply'], exact: true })
    .click();
  await expect(rows.nth(0).getByRole('textbox').nth(0)).toHaveValue('nya');
  await expect(rows.nth(0)).not.toHaveClass(/bulk-row-warning/);
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
  await expect(page.getByText(':nya:', { exact: true })).toBeVisible();
});

test('regex timeouts keep the page responsive and edited settings invalidate previews', async ({
  page,
}) => {
  await page.route('https://example.com/**', (route) => route.abort());
  await page.goto('/ja/');
  await page.getByRole('button', { name: ja.bulkInput, exact: true }).click();
  await page
    .getByLabel(ja['bulk.data'])
    .fill(`${'a'.repeat(63)}b,https://example.com/long.png`);
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
  await page
    .getByRole('button', { name: ja['replace.open'], exact: true })
    .click();
  await page
    .getByLabel(ja['replace.mode'], { exact: true })
    .selectOption('regex');
  const search = page.getByLabel(ja['replace.search'], { exact: true });
  const apply = page.getByRole('button', {
    name: ja['replace.apply'],
    exact: true,
  });
  await search.fill('^(a+)+$');
  await page
    .getByLabel(ja['replace.replacement'], { exact: true })
    .fill('my_cat');
  await page
    .getByRole('button', { name: ja['replace.preview'], exact: true })
    .click();
  await expect(page.getByRole('alert')).toHaveText(ja['replace.error.timeout']);
  await search.fill('[');
  await page
    .getByRole('button', { name: ja['replace.preview'], exact: true })
    .click();
  await expect(page.getByRole('alert')).toHaveText(
    ja['replace.error.invalidPattern'],
  );
  await search.fill('^a+');
  await page
    .getByRole('button', { name: ja['replace.preview'], exact: true })
    .click();
  await expect(apply).toBeEnabled();
  await search.fill('^b');
  await expect(apply).toBeDisabled();
  await page.getByRole('button', { name: ja.cancel, exact: true }).click();
  const saved = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('emojiful.pack-studio.workspace.v1')!)
        .packs[0].pack.emojis,
  );
  expect(saved[0].name).toBe('a'.repeat(63) + 'b');
});

test('name warnings and replacement previews fit mobile Japanese and Arabic layouts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.clear());
  await page.route('https://example.com/**', (route) => route.abort());
  for (const [locale, messages] of [
    ['ja', ja],
    ['ar', ar],
  ] as const) {
    await page.goto(`/${locale}/`);
    await page
      .getByRole('button', { name: messages.bulkInput, exact: true })
      .click();
    await page.getByLabel(messages['bulk.data']).fill(imported);
    await page
      .getByRole('button', { name: messages['bulk.add'], exact: true })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.work/name-warnings-mobile-${locale}.png`,
      fullPage: true,
    });
    await page
      .getByRole('button', { name: messages['replace.open'], exact: true })
      .click();
    await page
      .getByLabel(messages['replace.search'], { exact: true })
      .fill('_long_');
    await page
      .getByLabel(messages['replace.replacement'], { exact: true })
      .fill('_');
    await page
      .getByRole('button', { name: messages['replace.preview'], exact: true })
      .click();
    await expect(page.locator('.name-replacement-preview')).toContainText(
      'very_name_nya',
    );
    expect(
      await page
        .getByRole('dialog')
        .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({
      path: `.work/name-replace-mobile-${locale}.png`,
      fullPage: true,
    });
  }
});
