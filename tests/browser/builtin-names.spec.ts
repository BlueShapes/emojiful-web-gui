import { test, expect } from '@playwright/test';
import ja from '../../web/src/i18n/messages/ja.json' with { type: 'json' };

test.beforeEach(async ({ page }) => {
  await page.route('https://example.com/**', (route) => route.abort());
});

test('single entry rejects built-in aliases live and accepts a custom prefix', async ({
  page,
}) => {
  await page.goto('/ja/');
  await page.getByRole('button', { name: ja.addEmoji, exact: true }).click();
  await page
    .getByLabel(ja['field.imageUrl'], { exact: true })
    .fill('https://example.com/custom.png');
  const name = page.getByLabel(ja['field.emojiName'], { exact: true });
  const add = page
    .getByRole('dialog')
    .getByRole('button', { name: ja.add, exact: true });
  for (const alias of [
    ':SMILE:',
    'satisfied',
    'swear',
    'thonk',
    'blobcat',
    'monka',
    'comfy',
    'kappa',
  ]) {
    await name.fill(alias);
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('.name-character-error')).toContainText(
      'Emojiful',
    );
    await expect(add).toBeDisabled();
  }
  await name.fill('my_smile');
  await expect(page.locator('.name-character-error')).toHaveCount(0);
  await add.click();
  await expect(page.getByText(':my_smile:', { exact: true })).toBeVisible();
});

test('text and Nextcloud imports reject standard names, and replacement repairs all table rows', async ({
  page,
}) => {
  await page.goto('/ja/');
  await page.getByRole('button', { name: ja.bulkInput, exact: true }).click();
  await page
    .getByLabel(ja['bulk.data'])
    .fill('smile,https://example.com/custom.png');
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Emojiful');
  await expect(page.locator('.emoji-card')).toHaveCount(0);
  await page
    .getByLabel(ja['bulk.mode'], { exact: true })
    .selectOption('nextcloud');
  await page
    .getByLabel(ja['nextcloud.shareUrl'], { exact: true })
    .fill('https://example.com/s/Share123');
  await page
    .getByLabel(ja['nextcloud.output'], { exact: true })
    .fill(
      '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/public.php/dav/files/Share123/smile.png</d:href><d:propstat><d:prop><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>',
    );
  await page
    .getByRole('button', { name: ja['nextcloud.review'], exact: true })
    .click();
  const row = page.locator('.bulk-table tbody tr').first();
  const name = row.getByRole('textbox').nth(0);
  await expect(name).toHaveValue('smile');
  await expect(row).toHaveClass(/bulk-row-issue/);
  await expect(name).toHaveCSS('font-weight', '700');
  await expect(row.locator('.bulk-cell-issue')).toContainText('Emojiful');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: ja['replace.open'], exact: true })
    .click();
  const search = page.getByLabel(ja['replace.search'], { exact: true });
  const replacement = page.getByLabel(ja['replace.replacement'], {
    exact: true,
  });
  const preview = page.getByRole('button', {
    name: ja['replace.preview'],
    exact: true,
  });
  const apply = page.getByRole('button', {
    name: ja['replace.apply'],
    exact: true,
  });
  await search.fill('missing');
  await replacement.fill('my_');
  await preview.click();
  await expect(page.locator('.name-replacement-problems')).toContainText(
    ja['replace.problem.builtin'],
  );
  await expect(apply).toBeDisabled();
  await search.fill('smile');
  await replacement.fill('cat');
  await preview.click();
  await expect(page.locator('.name-replacement-problems')).toContainText(
    ja['replace.problem.builtin'],
  );
  await expect(apply).toBeDisabled();
  await replacement.fill('my_smile');
  await preview.click();
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(name).toHaveValue('my_smile');
  await expect(row).not.toHaveClass(/bulk-row-issue/);
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
  await expect(page.getByText(':my_smile:', { exact: true })).toBeVisible();
});

test('saved conflicting drafts survive reload, highlight errors and block ZIP until repaired', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('emojiful.pack-studio.workspace.v1')) {
      localStorage.setItem(
        'emojiful.pack-studio.v1',
        JSON.stringify({
          schemaVersion: 1,
          id: 'existing',
          name: 'Existing',
          description: '',
          emojis: ['smile', 'cat', 'my_custom'].map((name) => ({
            name,
            url: `https://example.com/${name}.png`,
            category: 'Custom',
          })),
        }),
      );
    }
  });
  await page.goto('/ja/');
  await expect(page.locator('.emoji-card')).toHaveCount(3);
  await expect(page.locator('.emoji-card-error')).toHaveCount(2);
  await expect(page.locator('.emoji-name-error').first()).toContainText(
    'Emojiful',
  );
  await expect(page.locator('.name-conflict-count')).toHaveText(
    ja['name.builtinCount'].replace('{count}', '2'),
  );
  await page.getByLabel(ja['name.attentionOnly'], { exact: true }).check();
  await expect(page.locator('.emoji-card')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('.emoji-card-error')).toHaveCount(2);
  await page
    .getByRole('button', { name: ja['export.zip'], exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('Emojiful');
  await page
    .getByRole('button', {
      name: ja.editNamed.replace('{name}', 'smile'),
      exact: true,
    })
    .click();
  await expect(
    page
      .getByRole('dialog')
      .getByRole('button', { name: ja.saveChanges, exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel(ja['field.emojiName'], { exact: true })
    .fill('my_smile');
  await page.getByRole('button', { name: ja.saveChanges, exact: true }).click();
  await expect(page.locator('.emoji-card-error')).toHaveCount(1);
  await page
    .getByRole('button', { name: ja['replace.open'], exact: true })
    .click();
  await page
    .getByLabel(ja['replace.mode'], { exact: true })
    .selectOption('regex');
  await page.getByLabel(ja['replace.search'], { exact: true }).fill('^cat$');
  await page
    .getByLabel(ja['replace.replacement'], { exact: true })
    .fill('my_cat');
  await page
    .getByRole('button', { name: ja['replace.preview'], exact: true })
    .click();
  await page
    .getByRole('button', { name: ja['replace.apply'], exact: true })
    .click();
  await expect(page.locator('.emoji-card-error')).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: ja['export.zip'], exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe('existing.zip');
  await page.reload();
  await expect(page.getByText(':my_smile:', { exact: true })).toBeVisible();
  await expect(page.getByText(':my_cat:', { exact: true })).toBeVisible();
});
