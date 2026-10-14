import { test, expect } from '@playwright/test';
import ja from '../../web/src/i18n/messages/ja.json' with { type: 'json' };

// Astro preview does not apply Pages' _headers. Exercise the production CSP too.
test.beforeEach(async ({ page }) => {
  await page.route(
    /^http:\/\/127\.0\.0\.1:4321\/(?:[a-z-]+\/)?$/,
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          'Content-Security-Policy':
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: http: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        },
      });
    },
  );
});

test('static editor creates, persists, filters and exports a pack', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/ja/');
  await expect(page.getByText(ja['storage.saved'])).toBeVisible();
  await expect(page.getByText(ja['edition.web'])).toBeVisible();
  await expect(
    page.getByRole('button', { name: ja['deploy'], exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: ja['empty.add'], exact: true })
    .click();
  await page
    .getByLabel(ja['field.imageUrl'], { exact: true })
    .fill('https://example.com/cat.png');
  await page
    .getByLabel(ja['field.emojiName'], { exact: true })
    .fill('happy_cat');
  await page
    .getByRole('combobox', { name: ja['field.category'], exact: true })
    .fill('Animals');
  await page.getByRole('button', { name: ja['add'], exact: true }).click();
  await expect(page.getByText(':happy_cat:', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: ja['bulkInput'], exact: true })
    .click();
  await page
    .getByLabel(ja['bulk.data'])
    .fill(
      'name,url,category\nwave,https://example.com/wave.gif,Reactions\ndog,https://example.com/dog.png,Animals',
    );
  await page.getByRole('button', { name: ja['bulk.add'] }).click();
  await expect(page.locator('.emoji-card')).toHaveCount(3);
  await page.reload();
  await expect(page.locator('.emoji-card')).toHaveCount(3);
  await page.getByLabel(ja['search']).fill('wave');
  await expect(page.locator('.emoji-card')).toHaveCount(1);
  await page.getByLabel(ja['search']).fill('');
  await page.getByRole('button', { name: 'happy_catを編集' }).click();
  await page
    .getByLabel(ja['field.emojiName'], { exact: true })
    .fill('comfy_cat');
  await page.getByRole('button', { name: ja['saveChanges'] }).click();
  await expect(page.getByText(':comfy_cat:', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: ja['export.zip'], exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe('my_emojis.zip');
  await page.getByRole('button', { name: 'dogを削除' }).click();
  await page
    .getByRole('button', { name: ja['confirm.apply'], exact: true })
    .click();
  await expect(page.locator('.emoji-card')).toHaveCount(2);
  expect(errors).toEqual([]);
  await page.screenshot({ path: '.work/studio-desktop.png', fullPage: true });
});

test('a slow installed-pack read cannot silently replace a newer draft', async ({
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
  await page.route('**/api/packs', (route) =>
    route.fulfill({
      json: {
        packs: [
          {
            id: 'other',
            name: 'Other Pack',
            emojiCount: 1,
            filename: 'other.zip',
          },
        ],
      },
    }),
  );
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markRequested!: () => void;
  const requested = new Promise<void>((resolve) => {
    markRequested = resolve;
  });
  await page.route('**/api/packs/other', async (route) => {
    markRequested();
    await delayed;
    await route.fulfill({
      json: {
        schemaVersion: 1,
        id: 'other',
        name: 'Other Pack',
        description: '',
        emojis: [
          {
            name: 'old',
            url: 'https://example.com/old.png',
            category: 'Other',
          },
        ],
      },
    });
  });
  await page.goto('/ja/');
  await expect(page.getByText(ja['edition.local'])).toBeVisible();
  await page.getByRole('button', { name: ja['installed.open'] }).click();
  await page
    .getByRole('button', { name: 'Other Pack other.zip · 絵文字 1 個' })
    .click();
  await requested;
  await page.getByRole('button', { name: ja['closeEditor'] }).click();
  await page
    .getByRole('button', { name: ja['bulkInput'], exact: true })
    .click();
  await page
    .getByLabel(ja['bulk.data'])
    .fill('new,https://example.com/new.png,Custom');
  await page.getByRole('button', { name: ja['bulk.add'] }).click();
  release();
  await expect(page.getByText(ja['confirm.replace'])).toBeVisible();
  await page.getByRole('button', { name: ja['cancel'], exact: true }).click();
  await expect(page.getByText(':new:', { exact: true })).toBeVisible();
  await expect(page.getByText(':old:', { exact: true })).toHaveCount(0);
});

test('bulk errors keep the collection unchanged and mobile layout stays within viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/ja/');
  await page
    .getByRole('button', { name: ja['bulkInput'], exact: true })
    .click();
  await page
    .getByLabel(ja['bulk.data'])
    .fill(
      'cat,https://example.com/cat.png\ncat,https://example.com/duplicate.png',
    );
  await page.getByRole('button', { name: ja['bulk.add'] }).click();
  await expect(page.getByRole('alert')).toContainText('重複');
  await page.getByRole('button', { name: ja['closeEditor'] }).click();
  await expect(page.locator('.emoji-card')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: '.work/studio-mobile.png', fullPage: true });
});

test('mod capability enables the same editor and deploys validated pack data', async ({
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
  let deployed: unknown;
  await page.route('**/api/packs', async (route) => {
    expect(route.request().headers()['x-ewg-token']).toBe('a'.repeat(64));
    deployed = route.request().postDataJSON();
    await route.fulfill({
      json: { filename: 'my_emojis.zip', message: 'Installed' },
    });
  });
  await page.goto('/ja/');
  await expect(page.getByText(ja['edition.local'])).toBeVisible();
  await page
    .getByRole('button', { name: ja['bulkInput'], exact: true })
    .click();
  await page
    .getByLabel(ja['bulk.data'])
    .fill('wave,https://example.com/wave.gif,Reactions');
  await page.getByRole('button', { name: ja['bulk.add'] }).click();
  await page.getByRole('button', { name: ja['deploy'], exact: true }).click();
  await expect(page.getByRole('status')).toContainText('my_emojis.zipを配置');
  expect(deployed).toMatchObject({
    overwrite: false,
    pack: { id: 'my_emojis', emojis: [{ name: 'wave' }] },
  });
});
