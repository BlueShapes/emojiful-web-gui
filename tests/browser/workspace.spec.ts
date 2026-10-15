import { test, expect } from '@playwright/test';
import ja from '../../web/src/i18n/messages/ja.json' with { type: 'json' };
import en from '../../web/src/i18n/messages/en.json' with { type: 'json' };

const workspaceKey = 'emojiful.pack-studio.workspace.v1';

test.beforeEach(async ({ page }) => {
  await page.route('https://example.com/**', (route) => route.abort());
});

test('legacy draft, multiple packs and collapsed sidebar survive reloads and language changes', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (
      !localStorage.getItem('emojiful.pack-studio.v1') &&
      !localStorage.getItem('emojiful.pack-studio.workspace.v1')
    ) {
      localStorage.setItem(
        'emojiful.pack-studio.v1',
        JSON.stringify({
          schemaVersion: 1,
          id: '',
          name: '既存パック',
          description: '編集中',
          emojis: [
            {
              name: 'wave',
              url: 'https://example.com/wave.png',
              category: '反応',
            },
          ],
        }),
      );
    }
  });
  await page.goto('/ja/');
  const selector = page.getByRole('combobox', {
    name: 'パックを切り替え',
    exact: true,
  });
  await expect(selector).toBeEnabled();
  const firstKey = await selector.inputValue();
  await expect(
    page.getByLabel(ja['field.packId'], { exact: true }),
  ).toHaveValue('');
  await expect(page.getByText(':wave:', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: ja.newPack, exact: true }).click();
  await expect(selector.locator('option')).toHaveCount(2);
  const secondKey = await selector.inputValue();
  expect(secondKey).not.toBe(firstKey);
  await page.getByLabel(ja['field.packName'], { exact: true }).fill('仕事用');
  await page.getByLabel(ja['field.packId'], { exact: true }).fill('work');
  await page.getByRole('button', { name: ja.bulkInput, exact: true }).click();
  await page
    .getByLabel(ja['bulk.data'])
    .fill('cat,https://example.com/cat.png,動物');
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
  await selector.selectOption(firstKey);
  await expect(page.getByText(':wave:', { exact: true })).toBeVisible();
  await expect(page.getByText(':cat:', { exact: true })).toHaveCount(0);
  await page.getByLabel(ja.search).fill('wave');
  await selector.selectOption(secondKey);
  await expect(page.getByLabel(ja.search)).toHaveValue('');
  await expect(page.getByText(':cat:', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'サイドバーを折りたたむ', exact: true })
    .click();
  await expect(page.locator('.sidebar')).toBeHidden();
  await page.reload();
  await expect(selector).toHaveValue(secondKey);
  await expect(page.locator('.sidebar')).toBeHidden();
  await selector.selectOption(firstKey);
  await expect(page.getByText(':wave:', { exact: true })).toBeVisible();
  await page
    .getByRole('combobox', { name: ja.language, exact: true })
    .selectOption('en');
  await expect(page).toHaveURL(/\/en\/$/);
  await expect(
    page.getByRole('combobox', { name: 'Switch pack', exact: true }),
  ).toHaveValue(firstKey);
  await expect(page.locator('.sidebar')).toBeHidden();
  await page
    .getByRole('button', { name: 'Expand sidebar', exact: true })
    .click();
  await expect(
    page.getByLabel(en['field.packName'], { exact: true }),
  ).toHaveValue('既存パック');
  await expect(
    page.getByLabel(en['field.packId'], { exact: true }),
  ).toHaveValue('');
});

test('imports a matching ID as a separate pack, deletes only the confirmed draft and keeps one pack', async ({
  page,
}) => {
  await page.goto('/ja/');
  const selector = page.getByRole('combobox', {
    name: 'パックを切り替え',
    exact: true,
  });
  await expect(selector).toBeEnabled();
  const firstKey = await selector.inputValue();
  await page
    .getByLabel(ja['field.packName'], { exact: true })
    .fill('元のパック');
  await page.locator('input[type=file]').setInputFiles({
    name: 'imported.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        id: 'my_emojis',
        name: '読み込んだパック',
        description: '',
        emojis: [],
      }),
    ),
  });
  await expect(selector.locator('option')).toHaveCount(2);
  await expect(
    page.getByLabel(ja['field.packName'], { exact: true }),
  ).toHaveValue('読み込んだパック');
  const importedKey = await selector.inputValue();
  await selector.selectOption(firstKey);
  await expect(
    page.getByLabel(ja['field.packName'], { exact: true }),
  ).toHaveValue('元のパック');
  await selector.selectOption(importedKey);
  const deletePack = page.getByRole('button', {
    name: 'パックを削除',
    exact: true,
  });
  await deletePack.click();
  await expect(page.getByRole('dialog')).toContainText('読み込んだパック');
  await page.getByRole('button', { name: ja.cancel, exact: true }).click();
  await expect(selector.locator('option')).toHaveCount(2);
  await deletePack.click();
  await page
    .getByRole('button', { name: ja['confirm.apply'], exact: true })
    .click();
  await expect(selector.locator('option')).toHaveCount(1);
  await expect(selector).toHaveValue(firstKey);
  await expect(deletePack).toBeDisabled();
  await page.reload();
  await expect(
    page.getByLabel(ja['field.packName'], { exact: true }),
  ).toHaveValue('元のパック');
});

test('sidebar can be reopened and packs switched on narrow RTL screens', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/ar/');
  await expect(page.locator('.language-picker select')).toBeEnabled();
  const toggle = page.locator('button[aria-controls="pack-sidebar"]');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.sidebar')).toBeHidden();
  await page.locator('.workspace-toolbar select').focus();
  await page.keyboard.press('Tab');
  expect(
    await page.evaluate(() =>
      document.querySelector('.sidebar')?.contains(document.activeElement),
    ),
  ).toBe(false);
  await toggle.click();
  await expect(page.locator('.sidebar')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('a damaged saved workspace is not overwritten by automatic saving', async ({
  page,
}) => {
  await page.addInitScript(
    (key) => localStorage.setItem(key, '{broken'),
    workspaceKey,
  );
  await page.goto('/ja/');
  await expect(
    page.getByRole('alert').filter({ hasText: ja['storage.restoreFailed'] }),
  ).toBeVisible();
  await page
    .getByLabel(ja['field.packName'], { exact: true })
    .fill('一時的な編集');
  await expect(
    page
      .getByText(ja['storage.failed'], { exact: true })
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText(ja['storage.saved'], { exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), workspaceKey),
  ).toBe('{broken');
});

test('storage quota failures stay visible when the sidebar is collapsed', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'emojiful.pack-studio.workspace.v1')
        throw new DOMException('Full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.goto('/ja/');
  await expect(page.locator('.language-picker select')).toBeEnabled();
  await expect(
    page.getByText(ja['storage.saved'], { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'サイドバーを折りたたむ', exact: true })
    .click();
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(
    page
      .getByText(ja['storage.failed'], { exact: true })
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: ja.language, exact: true })
    .selectOption('en');
  await expect(page).toHaveURL(/\/ja\/$/);
});

test('MOD deployment and ZIP export use the selected pack while sidebar is closed', async ({
  page,
}) => {
  await page.route('**/__emojiful__/session.json', (route) =>
    route.fulfill({
      json: {
        mode: 'mod',
        token: 'a'.repeat(64),
        gameVersion: '1.20.1',
        loader: 'Forge',
        port: 8765,
      },
    }),
  );
  const deployed: { pack: { id: string; emojis: { name: string }[] } }[] = [];
  await page.route('**/api/packs', async (route) => {
    const body = route.request().postDataJSON();
    deployed.push(body);
    await route.fulfill({ json: { filename: `${body.pack.id}.zip` } });
  });
  await page.goto('/ja/');
  await expect(
    page.getByText(ja['edition.local'], { exact: true }),
  ).toBeVisible();
  const selector = page.getByRole('combobox', {
    name: 'パックを切り替え',
    exact: true,
  });
  const firstKey = await selector.inputValue();
  await page.getByLabel(ja['field.packId'], { exact: true }).fill('alpha');
  await page.getByRole('button', { name: ja.bulkInput, exact: true }).click();
  await page
    .getByLabel(ja['bulk.data'])
    .fill('wave,https://example.com/wave.png,反応');
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
  await page.getByRole('button', { name: ja.newPack, exact: true }).click();
  const secondKey = await selector.inputValue();
  await page.getByLabel(ja['field.packId'], { exact: true }).fill('beta');
  await page.getByRole('button', { name: ja.bulkInput, exact: true }).click();
  await page
    .getByLabel(ja['bulk.data'])
    .fill('cat,https://example.com/cat.png,動物');
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
  await page
    .getByRole('button', { name: 'サイドバーを折りたたむ', exact: true })
    .click();
  await selector.selectOption(firstKey);
  await page.getByRole('button', { name: ja.deploy, exact: true }).click();
  await expect(page.getByRole('status')).toContainText('alpha.zip');
  await selector.selectOption(secondKey);
  await page.getByRole('button', { name: ja.deploy, exact: true }).click();
  await expect(page.getByRole('status')).toContainText('beta.zip');
  expect(
    deployed.map((body) => ({
      id: body.pack.id,
      names: body.pack.emojis.map((emoji) => emoji.name),
    })),
  ).toEqual([
    { id: 'alpha', names: ['wave'] },
    { id: 'beta', names: ['cat'] },
  ]);
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: ja['export.zip'], exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe('beta.zip');
});
