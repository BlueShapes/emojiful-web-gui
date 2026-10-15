import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import locales from '../../shared/locales.json' with { type: 'json' };
import english from '../../web/src/i18n/messages/en.json' with { type: 'json' };
import japanese from '../../web/src/i18n/messages/ja.json' with { type: 'json' };

const messages = (code: string): typeof english =>
  JSON.parse(
    readFileSync(
      new URL(`../../web/src/i18n/messages/${code}.json`, import.meta.url),
      'utf8',
    ),
  );

test('all 22 static routes hydrate in their language under production CSP', async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /react|hydration|did not match/i.test(message.text())
    )
      errors.push(message.text());
  });
  await page.route(/^http:\/\/127\.0\.0\.1:4321\/[a-z-]+\/$/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: http: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const locale of locales) {
    const text = messages(locale.code);
    const response = await page.goto(`/${locale.code}/`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', locale.htmlLang);
    await expect(page.locator('html')).toHaveAttribute(
      'dir',
      locale.code === 'ar' ? 'rtl' : 'ltr',
    );
    await expect(
      page.getByRole('heading', { name: text['intro.title'], exact: true }),
    ).toBeVisible();
    const selector = page.getByRole('combobox', {
      name: text.language,
      exact: true,
    });
    await expect(selector).toBeEnabled();
    await expect(selector).toHaveValue(locale.code);
    await expect(selector.locator('option')).toHaveCount(22);
    await expect(
      page.getByRole('combobox', { name: text['packs.switch'], exact: true }),
    ).toBeEnabled();
    const createPack = await page
      .getByRole('button', { name: text.newPack, exact: true })
      .boundingBox();
    const deletePack = await page
      .getByRole('button', { name: text['packs.delete'], exact: true })
      .boundingBox();
    expect(createPack).not.toBeNull();
    expect(deletePack).not.toBeNull();
    expect(
      createPack!.x + createPack!.width <= deletePack!.x + 1 ||
        deletePack!.x + deletePack!.width <= createPack!.x + 1,
      `${locale.code}: pack action buttons must not overlap`,
    ).toBe(true);
    await expect(
      page.getByText(text['runtime.staticHelp'], { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: text.bulkInput, exact: true })
      .click();
    await page
      .getByLabel(text['bulk.data'])
      .fill(
        'cat,https://example.com/cat.png\ncat,https://example.com/other.png',
      );
    await page
      .getByRole('button', { name: text['bulk.add'], exact: true })
      .click();
    await expect(page.getByRole('alert')).toHaveText(
      text['error.duplicate'].replace('{index}', '2').replace('{name}', 'cat'),
    );
    await page.getByLabel(text['bulk.mode']).selectOption('table');
    const tableRows = page.locator('.bulk-table tbody tr');
    for (const index of [0, 2]) {
      await tableRows.nth(index).getByRole('textbox').nth(0).fill('cat');
      await tableRows
        .nth(index)
        .getByRole('textbox')
        .nth(1)
        .fill('https://example.com/cat.png');
    }
    await expect(
      page.getByLabel(
        text['bulk.cell']
          .replace('{index}', '1')
          .replace('{field}', text['field.emojiName']),
        { exact: true },
      ),
    ).toHaveValue('cat');
    await page
      .getByRole('button', { name: text['bulk.add'], exact: true })
      .click();
    await expect(page.getByRole('alert')).toHaveText(
      text['error.duplicate'].replace('{index}', '3').replace('{name}', 'cat'),
    );
    expect(
      await page
        .locator('.editor-dialog')
        .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1),
      locale.code,
    ).toBe(true);
    await page
      .getByLabel(text['bulk.mode'], { exact: true })
      .selectOption('nextcloud');
    await page
      .getByLabel(text['nextcloud.shareUrl'], { exact: true })
      .fill('https://cloud.example/s/Share123');
    await expect(
      page.getByLabel(text['nextcloud.command'], { exact: true }),
    ).toHaveValue(/^curl\.exe /);
    await page
      .getByLabel(text['nextcloud.output'], { exact: true })
      .fill('<html>Sign in</html>');
    await page
      .getByRole('button', { name: text['nextcloud.review'], exact: true })
      .click();
    await expect(page.getByRole('alert')).toHaveText(
      text['nextcloud.invalidXml'],
    );
    await page
      .getByRole('button', { name: text.closeEditor, exact: true })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      locale.code,
    ).toBe(true);
    await expect(page.locator('.emoji-card')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('all 22 mod locales translate installation, installed packs and backend errors', async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.addInitScript(() => localStorage.clear());
  await page.route('https://example.com/**', (route) => route.abort());
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
  let conflict = false;
  await page.route('**/api/packs', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        json: {
          packs: [
            {
              id: 'my_emojis',
              name: 'My pack',
              filename: 'my_emojis.zip',
              emojiCount: 1,
            },
          ],
        },
      });
    }
    return route.fulfill(
      conflict
        ? { status: 409, json: { error: 'raw backend conflict' } }
        : { json: { filename: 'my_emojis.zip' } },
    );
  });
  for (const locale of locales) {
    conflict = false;
    const text = messages(locale.code);
    await page.goto(`/${locale.code}/`);
    await expect(
      page.getByText(text['edition.local'], { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: text.bulkInput, exact: true })
      .click();
    await page
      .getByLabel(text['bulk.data'])
      .fill('wave,https://example.com/wave.gif,Reactions');
    await page
      .getByRole('button', { name: text['bulk.add'], exact: true })
      .click();
    await page.getByRole('button', { name: text.deploy, exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(
      text['notice.deployed'].replace('{filename}', 'my_emojis.zip'),
    );
    conflict = true;
    await page.getByRole('button', { name: text.deploy, exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(text['error.conflict']);
    await page
      .getByRole('button', { name: text['installed.open'], exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: text['installed.title'], exact: true }),
    ).toBeVisible();
    await expect(page.locator('.installed-item small')).toHaveText(
      text['installed.count']
        .replace('{filename}', 'my_emojis.zip')
        .replace('{count}', '1'),
    );
    await page
      .getByRole('button', { name: text.closeEditor, exact: true })
      .click();
  }
});

test('Arabic mirrors the workspace and keeps technical input LTR across language switches', async ({
  page,
}) => {
  const text = messages('ar');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('https://example.com/**', (route) => route.abort());
  await page.goto('/ar/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(
    page.getByRole('combobox', { name: text.language, exact: true }),
  ).toBeEnabled();
  const sidebar = await page.locator('.sidebar').boundingBox();
  const main = await page.locator('.studio-main').boundingBox();
  expect(sidebar!.x).toBeGreaterThan(main!.x);
  const packId = page.getByLabel(text['field.packId'], { exact: true });
  await expect(packId).toHaveCSS('direction', 'ltr');
  await packId.fill('arabic_pack');
  await page.getByRole('button', { name: text.addEmoji, exact: true }).click();
  await expect(
    page.getByLabel(text['field.imageUrl'], { exact: true }),
  ).toHaveCSS('direction', 'ltr');
  await expect(
    page.getByLabel(text['field.emojiName'], { exact: true }),
  ).toHaveCSS('direction', 'ltr');
  await page
    .getByRole('button', { name: text.closeEditor, exact: true })
    .click();
  await page.getByRole('button', { name: text.bulkInput, exact: true }).click();
  const data = page.getByLabel(text['bulk.data']);
  await expect(data).toHaveCSS('direction', 'ltr');
  await data.fill('wave,https://example.com/wave.gif,تفاعلات');
  await page
    .getByRole('button', { name: text['bulk.add'], exact: true })
    .click();
  await expect(page.locator('.emoji-url')).toHaveCSS('direction', 'ltr');
  await page
    .getByRole('combobox', { name: text.language, exact: true })
    .selectOption('fr');
  await expect(page).toHaveURL(/\/fr\/$/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  const french = messages('fr');
  await expect(
    page.getByLabel(french['field.packId'], { exact: true }),
  ).toHaveValue('arabic_pack');
  await expect(page.getByText(':wave:', { exact: true })).toBeVisible();
  await expect(page.locator('.emoji-category')).toHaveText('تفاعلات');
});

test('language switching retains emojis and unfinished pack metadata', async ({
  page,
}) => {
  await page.goto('/ja/');
  await expect(
    page.getByRole('combobox', { name: japanese.language, exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: japanese.bulkInput, exact: true })
    .click();
  await page
    .getByLabel(japanese['bulk.data'])
    .fill('wave,https://example.com/wave.gif,反応');
  await page
    .getByRole('button', { name: japanese['bulk.add'], exact: true })
    .click();
  await page
    .getByLabel(japanese['field.packName'], { exact: true })
    .fill('編集中のパック');
  await page.getByLabel(japanese['field.packId'], { exact: true }).fill('');
  await page
    .getByRole('combobox', { name: japanese.language, exact: true })
    .selectOption('en');
  await expect(page).toHaveURL(/\/en\/$/);
  await expect(
    page.getByLabel(english['field.packName'], { exact: true }),
  ).toHaveValue('編集中のパック');
  await expect(
    page.getByLabel(english['field.packId'], { exact: true }),
  ).toHaveValue('');
  await expect(page.getByText(':wave:', { exact: true })).toBeVisible();
  await page
    .getByRole('combobox', { name: english.language, exact: true })
    .selectOption('zh-hk');
  await expect(page).toHaveURL(/\/zh-hk\/$/);
  await expect(page.getByText(':wave:', { exact: true })).toBeVisible();
});

test('root page uses English and English mod GUI can deploy', async ({
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
    route.fulfill({ json: { filename: 'my_emojis.zip' } }),
  );
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByText(english['edition.local'])).toBeVisible();
  await page
    .getByRole('button', { name: english.bulkInput, exact: true })
    .click();
  await page
    .getByLabel(english['bulk.data'])
    .fill('wave,https://example.com/wave.gif,Reactions');
  await page
    .getByRole('button', { name: english['bulk.add'], exact: true })
    .click();
  await page.getByRole('button', { name: english.deploy, exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Installed my_emojis.zip. Reopen the world or use /reload to apply changes.',
  );
});
