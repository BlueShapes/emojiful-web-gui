import { test, expect } from '@playwright/test';
import locales from '../../shared/locales.json' with { type: 'json' };
import ja from '../../web/src/i18n/messages/ja.json' with { type: 'json' };
import en from '../../web/src/i18n/messages/en.json' with { type: 'json' };

test('Workers serves every locale with production security headers', async ({
  request,
}) => {
  for (const locale of locales) {
    const response = await request.get(`/${locale.code}/`);
    expect(response.status(), locale.code).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    expect(response.headers()['content-security-policy']).toContain(
      "script-src 'self'",
    );
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(response.headers()['referrer-policy']).toBe('no-referrer');
    expect(response.headers()['x-frame-options']).toBe('DENY');
    const html = await response.text();
    expect(html).toContain(`lang="${locale.htmlLang}"`);
    expect(html).toContain(`dir="${locale.code === 'ar' ? 'rtl' : 'ltr'}"`);
  }
  const root = await request.get('/');
  expect(root.status()).toBe(200);
  expect(await root.text()).toContain('lang="en"');
});

test('Workers canonicalizes locale URLs and returns 404 for missing assets', async ({
  request,
}) => {
  const redirect = await request.get('/ja', { maxRedirects: 0 });
  expect(redirect.status()).toBe(307);
  expect(new URL(redirect.headers().location, redirect.url()).pathname).toBe(
    '/ja/',
  );
  expect(
    await (await request.get('/__emojiful__/session.json')).json(),
  ).toEqual({ mode: 'static' });
  for (const path of ['/missing/', '/ja/missing/', '/api/packs', '/_headers']) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
});

test('Workers GUI hydrates, saves drafts, switches language and exports ZIP under its real CSP', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://example.com/**', (route) => route.abort());
  const response = await page.goto('/ja/');
  expect(response?.headers()['content-security-policy']).toContain(
    "script-src 'self'",
  );
  await expect(
    page.getByRole('combobox', { name: ja.language, exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText(ja['edition.web'], { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: ja.deploy, exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: ja.bulkInput, exact: true }).click();
  await page
    .getByLabel(ja['bulk.data'])
    .fill('wave,https://example.com/wave.gif,Reactions');
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
  await expect(page.getByText(':wave:', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(':wave:', { exact: true })).toBeVisible();
  await page
    .getByRole('combobox', { name: ja.language, exact: true })
    .selectOption('en');
  await expect(page).toHaveURL(/\/en\/$/);
  await expect(page.getByText(':wave:', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: en['export.zip'], exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe('my_emojis.zip');
  expect(errors).toEqual([]);
});
