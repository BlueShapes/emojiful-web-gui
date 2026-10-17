import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import locales from '../../shared/locales.json' with { type: 'json' };
import ja from '../../web/src/i18n/messages/ja.json' with { type: 'json' };
import en from '../../web/src/i18n/messages/en.json' with { type: 'json' };

test('Workers legacy conversion runs with its real CSP and compressed engine', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/ja/');
  await page
    .getByRole('button', { name: ja['legacy.title'], exact: true })
    .click();
  await page
    .locator('input[type=file][accept*=webm]')
    .setInputFiles('tests/fixtures/legacy/large.gif');
  await page
    .getByRole('button', { name: ja['legacy.convert'], exact: true })
    .click();
  await expect(page.locator('.legacy-result-details')).toContainText('128×64', {
    timeout: 35_000,
  });
  await expect(page.locator('.legacy-result-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

function expectLegacyConversionPolicy(policy: string | undefined) {
  expect(policy).toBeDefined();
  const directive = (name: string) =>
    policy
      ?.split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith(`${name} `)) ?? '';
  expect(directive('script-src')).toContain("'wasm-unsafe-eval'");
  expect(directive('script-src')).not.toContain("'unsafe-eval'");
  expect(directive('worker-src')).toBe("worker-src 'self'");
  expect(directive('img-src')).toContain('blob:');
}

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
    expectLegacyConversionPolicy(response.headers()['content-security-policy']);
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

test('Workers serves the complete self-hosted conversion engine and source notices', async ({
  request,
}) => {
  const manifestResponse = await request.get(
    '/legacy-engine/generated/manifest.json',
  );
  expect(manifestResponse.status()).toBe(200);
  expect(manifestResponse.headers()['content-type']).toContain(
    'application/json',
  );
  const manifest = await manifestResponse.json();
  expect(manifest.core).toBe('ffmpeg-core.js');
  expect(manifest.wasm).toBe('ffmpeg-core.wasm.gz');
  expect(manifest.sha256).toMatch(/^[a-f0-9]{64}$/);

  const script = await request.get(`/legacy-engine/generated/${manifest.core}`);
  expect(script.status()).toBe(200);
  expect(script.headers()['content-type']).toMatch(
    /(?:application|text)\/javascript/,
  );
  expect(await script.text()).toContain('export default createFFmpegCore');

  const compressedResponse = await request.get(
    `/legacy-engine/generated/${manifest.wasm}`,
    {
      headers: { 'Accept-Encoding': 'identity' },
    },
  );
  expect(compressedResponse.status()).toBe(200);
  expect(compressedResponse.headers()['content-encoding']).toBeUndefined();
  const compressed = await compressedResponse.body();
  expect(compressed.length).toBe(manifest.compressedBytes);
  expect(compressed.length).toBeLessThanOrEqual(25 * 1024 * 1024);
  const wasm = gunzipSync(compressed);
  expect(wasm.subarray(0, 4)).toEqual(Buffer.from([0, 97, 115, 109]));
  expect(wasm.length).toBe(manifest.bytes);
  expect(createHash('sha256').update(wasm).digest('hex')).toBe(manifest.sha256);

  const sources = await request.get('/legacy-engine/SOURCES.md');
  expect(sources.status()).toBe(200);
  const sourceText = await sources.text();
  expect(sourceText).toContain('https://github.com/ffmpegwasm/ffmpeg.wasm/');
  expect(sourceText).toContain(manifest.version);
  for (const license of ['COPYING.GPL-2.0.txt', 'COPYING.GPL-3.0.txt']) {
    const response = await request.get(`/legacy-engine/${license}`);
    expect(response.status(), license).toBe(200);
    expect(await response.text(), license).toContain(
      'GNU GENERAL PUBLIC LICENSE',
    );
  }
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
  await expect(page.getByRole('alert')).toContainText(
    ja['error.builtinEmoji'].replace('{name}', 'wave'),
  );
  await expect(page.locator('.emoji-card')).toHaveCount(0);
  await page
    .getByLabel(ja['bulk.data'])
    .fill('my_wave,https://example.com/wave.gif,Reactions');
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
  await expect(page.getByText(':my_wave:', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(':my_wave:', { exact: true })).toBeVisible();
  await page
    .getByRole('combobox', { name: ja.language, exact: true })
    .selectOption('en');
  await expect(page).toHaveURL(/\/en\/$/);
  await expect(page.getByText(':my_wave:', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: en['export.zip'], exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe('my_emojis.zip');
  expect(errors).toEqual([]);
});
