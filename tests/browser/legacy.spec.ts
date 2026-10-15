import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { GifReader } from 'omggif';
import { unzipSync } from 'fflate';
import ja from '../../web/src/i18n/messages/ja.json' with { type: 'json' };

const fixture = (name: string) =>
  new URL(`../fixtures/legacy/${name}`, import.meta.url).pathname.replace(
    /^\/(?=[A-Za-z]:)/,
    '',
  );
const policy =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; img-src 'self' https: http: data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

test.beforeEach(async ({ page }) => {
  await page.route('**/ja/', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'Content-Security-Policy': policy },
    });
  });
});

async function open(page: import('@playwright/test').Page) {
  await page.goto('/ja/');
  await page
    .getByRole('button', { name: ja['legacy.title'], exact: true })
    .click();
}

test('real browser engine converts GIF, animated WebP, APNG and transparent WebM to independent full frames', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (
      !request.url().startsWith('http://127.0.0.1:4321') &&
      !request.url().startsWith('blob:')
    )
      external.push(request.url());
  });
  await open(page);
  await expect(page.getByLabel(ja['legacy.size'], { exact: true })).toHaveValue(
    '128',
  );
  await page
    .locator('input[type=file][accept*=webm]')
    .setInputFiles(
      [
        'optimized.gif',
        'animated.webp',
        'animated.apng',
        'transparent.webm',
        'static-alpha.webp',
        'opaque-background.gif',
      ].map(fixture),
    );
  await page
    .getByRole('button', { name: ja['legacy.convert'], exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: ja['legacy.stop'], exact: true }),
  ).toHaveCount(0, { timeout: 75_000 });
  await expect(page.locator('.legacy-result-error')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: ja['legacy.download'], exact: true }),
  ).toHaveCount(6);
  const pending = page.waitForEvent('download');
  await page
    .getByRole('button', { name: ja['legacy.downloadAll'], exact: true })
    .click();
  const download = await pending;
  const files = unzipSync(
    new Uint8Array(await readFile((await download.path())!)),
  );
  expect(Object.keys(files)).toHaveLength(6);
  for (const [name, bytes] of Object.entries(files)) {
    const reader = new GifReader(bytes);
    expect(reader.width, name).toBe(8);
    expect(reader.height, name).toBe(8);
    expect(reader.numFrames(), name).toBe(name.startsWith('static') ? 1 : 3);
    expect(reader.loopCount(), name).toBe(
      name.startsWith('optimized')
        ? 3
        : name.startsWith('opaque')
          ? 2
          : name === 'animated.legacy-2.gif'
            ? 1
            : name.startsWith('static')
              ? null
              : 0,
    );
    for (let index = 0; index < reader.numFrames(); index++) {
      const frame = reader.frameInfo(index);
      expect(
        [frame.x, frame.y, frame.width, frame.height, frame.disposal],
        name,
      ).toEqual([0, 0, 8, 8, 2]);
      const rgba = new Uint8Array(8 * 8 * 4);
      reader.decodeAndBlitFrameRGBA(index, rgba);
      expect(rgba[(6 * 8 + 6) * 4 + 3], `${name} corner alpha`).toBe(
        name.startsWith('opaque') ? 255 : 0,
      );
      if (name.startsWith('opaque')) {
        expect([...rgba.slice((6 * 8 + 6) * 4, (6 * 8 + 6) * 4 + 4)]).toEqual([
          255, 0, 0, 255,
        ]);
      } else if (!name.startsWith('static')) {
        const point = index === 0 ? [1, 1] : index === 1 ? [6, 1] : [1, 6];
        const color = (point[1] * 8 + point[0]) * 4;
        expect(rgba[color + 3], `${name} frame ${index} visible alpha`).toBe(
          255,
        );
        if (index > 0) {
          const previous = index === 1 ? [1, 1] : [6, 1];
          expect(
            rgba[(previous[1] * 8 + previous[0]) * 4 + 3],
            `${name} no stale pixels`,
          ).toBe(0);
        }
        const channel = index === 0 ? 0 : index === 1 ? 2 : 1;
        expect(rgba[color + channel], `${name} color`).toBeGreaterThan(225);
      }
    }
    if (name.startsWith('optimized') || name === 'animated.legacy.gif')
      expect(
        Array.from({ length: 3 }, (_, index) => reader.frameInfo(index).delay),
      ).toEqual([7, 13, 19]);
  }
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  await page.screenshot({ path: '.work/legacy-desktop.png', fullPage: true });
});

test('the 128px default bounds both axes, settings can reconvert and small inputs are not enlarged', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await open(page);
  await page
    .locator('input[type=file][accept*=webm]')
    .setInputFiles(fixture('large.gif'));
  await page
    .getByRole('button', { name: ja['legacy.convert'], exact: true })
    .click();
  await expect(page.locator('.legacy-result-details')).toContainText('128×64', {
    timeout: 35_000,
  });
  await page.getByLabel(ja['legacy.size'], { exact: true }).selectOption('64');
  await expect(
    page.getByRole('button', { name: ja['legacy.download'], exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: ja['legacy.convert'], exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: ja['legacy.convert'], exact: true })
    .click();
  await expect(page.locator('.legacy-result-details')).toContainText('64×32', {
    timeout: 35_000,
  });
});

test('invalid files fail visibly and an interrupted engine load can be retried', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await open(page);
  await page.locator('input[type=file][accept*=webm]').setInputFiles({
    name: 'bad.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from('not an image'),
  });
  await page
    .getByRole('button', { name: ja['legacy.convert'], exact: true })
    .click();
  await expect(page.locator('.legacy-result-error')).toHaveText(
    ja['legacy.invalid'],
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    '**/legacy-engine/generated/manifest.json',
    async (route) => {
      await gate;
      await route.continue().catch(() => {});
    },
  );
  await page
    .locator('input[type=file][accept*=webm]')
    .setInputFiles(fixture('optimized.gif'));
  await page
    .getByRole('button', { name: ja['legacy.convert'], exact: true })
    .click();
  await page
    .getByRole('button', { name: ja['legacy.stop'], exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: ja['legacy.convert'], exact: true }),
  ).toBeEnabled();
  release();
  await page.unroute('**/legacy-engine/generated/manifest.json');
  await page
    .getByRole('button', { name: ja['legacy.convert'], exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: ja['legacy.download'], exact: true }),
  ).toBeVisible({ timeout: 35_000 });
});
