import { test, expect } from '@playwright/test';
import ja from '../../web/src/i18n/messages/ja.json' with { type: 'json' };
import ar from '../../web/src/i18n/messages/ar.json' with { type: 'json' };

const root =
  '/nextcloud/public.php/dav/files/Share123/Animals%20%26%20Friends/';
const escape = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
function response(
  href: string,
  collection = false,
  status = 'HTTP/1.1 200 OK',
) {
  return `<z:response><z:href>${escape(href)}</z:href><z:propstat><z:prop><z:resourcetype>${collection ? '<z:collection/>' : ''}</z:resourcetype></z:prop><z:status>${status}</z:status></z:propstat></z:response>`;
}
const listing = (...responses: string[]) =>
  `<?xml version="1.0"?><z:multistatus xmlns:z="DAV:">${responses.join('')}</z:multistatus>`;
const validListing = listing(
  response(root, true),
  response(`${root}Happy%20Cat.PNG`),
  response(`${root}my_wave.gif`),
  response(`${root}notes.txt`),
  response(`${root}nested/`, true),
);

test.beforeEach(async ({ page }) => {
  await page.route('https://cloud.example/**', (route) => route.abort());
});

async function openNextcloud(page: import('@playwright/test').Page) {
  await page.goto('/ja/');
  await page.getByRole('button', { name: ja.bulkInput, exact: true }).click();
  await page
    .getByLabel(ja['bulk.mode'], { exact: true })
    .selectOption('nextcloud');
  await page
    .getByLabel(ja['nextcloud.shareUrl'], { exact: true })
    .fill(
      'https://cloud.example/nextcloud/index.php/s/Share123?path=%2FAnimals%20%26%20Friends',
    );
}

test('terminal listing becomes editable rows before an atomic pack addition', async ({
  page,
}) => {
  const remoteRequests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://cloud.example/'))
      remoteRequests.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await openNextcloud(page);
  const command = page.getByLabel(ja['nextcloud.command'], { exact: true });
  await expect(command).toHaveValue(/^curl\.exe /);
  expect(await command.inputValue()).toContain(root);
  await page
    .getByLabel(ja['nextcloud.shell'], { exact: true })
    .selectOption('sh');
  await expect(command).toHaveValue(/^curl /);
  await page
    .getByLabel(ja['bulk.defaultCategory'], { exact: true })
    .fill('Animals');
  await page
    .getByLabel(ja['nextcloud.output'], { exact: true })
    .fill(validListing);
  await page
    .getByRole('button', { name: ja['nextcloud.review'], exact: true })
    .click();
  await expect(page.getByLabel(ja['bulk.mode'], { exact: true })).toHaveValue(
    'table',
  );
  const rows = page.locator('.bulk-table tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).getByRole('textbox').nth(0)).toHaveValue(
    'Happy Cat',
  );
  await expect(rows.nth(0).locator('.bulk-source-filename bdi')).toHaveText(
    'Happy Cat.PNG',
  );
  const imageUrl = rows.nth(0).getByRole('textbox').nth(1);
  const originalUrl = `https://cloud.example${root}Happy%20Cat.PNG`;
  await expect(page.locator('.bulk-common-url code')).toHaveText(
    `https://cloud.example${root}`,
  );
  const filename = rows.nth(0).locator('.bulk-url-filename');
  await expect(filename).toHaveText('Happy%20Cat.PNG');
  await expect(filename).toBeVisible();
  await expect(imageUrl).toHaveCSS('color', 'rgba(0, 0, 0, 0)');
  await expect(imageUrl).toHaveValue(originalUrl);
  await expect(imageUrl).toHaveAttribute('title', originalUrl);
  await imageUrl.focus();
  await expect(imageUrl).toHaveValue(originalUrl);
  await expect(filename).toBeHidden();
  await expect(imageUrl).not.toHaveCSS('color', 'rgba(0, 0, 0, 0)');
  const editedUrl = `https://cloud.example${root}Comfy%20Cat.PNG`;
  await imageUrl.fill(editedUrl);
  await rows.nth(0).getByRole('textbox').nth(2).focus();
  await expect(filename).toHaveText('Comfy%20Cat.PNG');
  await expect(filename).toBeVisible();
  await imageUrl.fill('https://cloud.example/other/cat.png');
  await imageUrl.blur();
  await expect(imageUrl).toHaveValue('https://cloud.example/other/cat.png');
  await expect(filename).toHaveCount(0);
  await imageUrl.fill(editedUrl);
  const mode = page.getByLabel(ja['bulk.mode'], { exact: true });
  await mode.selectOption('nextcloud');
  await page
    .getByLabel(ja['nextcloud.folderPath'], { exact: true })
    .fill('/other');
  await mode.selectOption('table');
  await expect(page.locator('.bulk-common-url code')).toHaveText(
    `https://cloud.example${root}`,
  );
  await expect(filename).toHaveText('Comfy%20Cat.PNG');
  await expect(filename).toBeVisible();
  await expect(rows.nth(0).getByRole('textbox').nth(2)).toHaveValue('Animals');
  await expect(rows.nth(0).locator('.bulk-source-filename bdi')).toHaveText(
    'Happy Cat.PNG',
  );
  expect(remoteRequests).toEqual([]);
  const draft = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('emojiful.pack-studio.workspace.v1')!),
  );
  expect(draft.packs[0].pack.emojis).toEqual([]);
  await rows.nth(0).getByRole('textbox').nth(0).fill('comfy_cat');
  await page.screenshot({
    path: '.work/nextcloud-compact-desktop.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
  await expect(page.locator('.emoji-card')).toHaveCount(2);
  await page.reload();
  await expect(page.getByText(':comfy_cat:', { exact: true })).toBeVisible();
  const savedUrls = await page.evaluate(() =>
    JSON.parse(
      localStorage.getItem('emojiful.pack-studio.workspace.v1')!,
    ).packs[0].pack.emojis.map((emoji: { url: string }) => emoji.url),
  );
  expect(savedUrls).toEqual([
    editedUrl,
    `https://cloud.example${root}my_wave.gif`,
  ]);
  await page.getByRole('button', { name: ja.bulkInput, exact: true }).click();
  await mode.selectOption('table');
  await expect(page.locator('.bulk-common-url')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('HTML, malformed XML, entities, foreign scope, traversal and missing files never replace table input', async ({
  page,
}) => {
  await openNextcloud(page);
  const mode = page.getByLabel(ja['bulk.mode'], { exact: true });
  await mode.selectOption('table');
  await page
    .locator('.bulk-table tbody tr')
    .nth(0)
    .getByRole('textbox')
    .nth(0)
    .fill('keep_me');
  await mode.selectOption('nextcloud');
  const output = page.getByLabel(ja['nextcloud.output'], { exact: true });
  for (const invalid of [
    '<html><body>Sign in</body></html>',
    '<z:multistatus xmlns:z="DAV:"><z:response>',
    '<!DOCTYPE z:multistatus [<!ENTITY secret SYSTEM "https://cloud.example/secret">]><z:multistatus xmlns:z="DAV:">&secret;</z:multistatus>',
    listing(
      response(`${root}cat.png`),
      response('https://other.example/public.php/dav/files/Share123/dog.png'),
    ),
    listing(response(root.replace('Share123', 'OtherShare') + 'cat.png')),
    listing(response(`${root}nested/cat.png`)),
    listing(response(`${root}%2e%2e/cat.png`)),
    listing(response(`${root}cat%2Fdog.png`)),
    listing(response(`${root}blocked.png`, false, 'HTTP/1.1 403 Forbidden')),
  ]) {
    await output.fill(invalid);
    await page
      .getByRole('button', { name: ja['nextcloud.review'], exact: true })
      .click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(mode).toHaveValue('nextcloud');
    await expect(output).toHaveValue(invalid);
  }
  await mode.selectOption('table');
  await expect(
    page.locator('.bulk-table tbody tr').nth(0).getByRole('textbox').nth(0),
  ).toHaveValue('keep_me');
  await page.getByRole('button', { name: ja.closeEditor, exact: true }).click();
  await expect(page.locator('.emoji-card')).toHaveCount(0);
});

test('XML files support duplicate-name repair and report empty image listings', async ({
  page,
}) => {
  await openNextcloud(page);
  const output = page.getByLabel(ja['nextcloud.output'], { exact: true });
  await output.fill(
    listing(response(root, true), response(`${root}notes.txt`)),
  );
  await page
    .getByRole('button', { name: ja['nextcloud.review'], exact: true })
    .click();
  await expect(page.getByRole('alert')).toHaveText(ja['nextcloud.noImages']);
  await page.getByLabel(ja['nextcloud.file'], { exact: true }).setInputFiles({
    name: 'listing.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from(
      '\uFEFF' +
        listing(
          response(root, true),
          response(`${root}my_cat.PNG`),
          response(`${root}my_cat.gif`),
        ),
    ),
  });
  await expect(output).toHaveValue(/^\uFEFF?<\?xml/);
  await page
    .getByRole('button', { name: ja['nextcloud.review'], exact: true })
    .click();
  const nameInputs = page.locator('.bulk-table tbody tr');
  await expect(nameInputs.nth(0).getByRole('textbox').nth(0)).toHaveValue(
    'my_cat',
  );
  await expect(nameInputs.nth(1).getByRole('textbox').nth(0)).toHaveValue(
    'my_cat',
  );
  await nameInputs.nth(0).getByRole('textbox').nth(0).fill('my_cat');
  await nameInputs.nth(1).getByRole('textbox').nth(0).fill('my_cat');
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('重複');
  await page
    .locator('.bulk-table tbody tr')
    .nth(1)
    .getByRole('textbox')
    .nth(0)
    .fill('my_cat_gif');
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
  await expect(page.locator('.emoji-card')).toHaveCount(2);
});

test('the Nextcloud guide fits mobile Japanese and Arabic layouts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [locale, messages] of [
    ['ja', ja],
    ['ar', ar],
  ] as const) {
    await page.goto(`/${locale}/`);
    await page
      .getByRole('button', { name: messages.bulkInput, exact: true })
      .click();
    await page
      .getByLabel(messages['bulk.mode'], { exact: true })
      .selectOption('nextcloud');
    await page
      .getByLabel(messages['nextcloud.shareUrl'], { exact: true })
      .fill(
        'https://cloud.example/nextcloud/s/Share123?path=%2FAnimals%20%26%20Friends',
      );
    await expect(
      page.getByLabel(messages['nextcloud.command'], { exact: true }),
    ).toHaveCSS('direction', 'ltr');
    expect(
      await page
        .locator('.editor-dialog')
        .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({
      path: `.work/nextcloud-mobile-${locale}.png`,
      fullPage: true,
    });
    await page
      .getByLabel(messages['nextcloud.output'], { exact: true })
      .fill(validListing);
    await page
      .getByRole('button', { name: messages['nextcloud.review'], exact: true })
      .click();
    await expect(page.locator('.bulk-common-url code')).toHaveCSS(
      'direction',
      'ltr',
    );
    await expect(
      page
        .locator('.bulk-table tbody tr')
        .first()
        .locator('.bulk-url-filename'),
    ).toHaveText('Happy%20Cat.PNG');
    expect(
      await page
        .locator('.editor-dialog')
        .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({
      path: `.work/nextcloud-compact-mobile-${locale}.png`,
      fullPage: true,
    });
  }
});

test('a delayed XML file read cannot overwrite input after switching methods', async ({
  page,
}) => {
  await openNextcloud(page);
  await page
    .getByLabel(ja['nextcloud.output'], { exact: true })
    .fill(validListing);
  await page.evaluate(() => {
    const state = window as typeof window & {
      listingReadStarted?: boolean;
      releaseListingRead?: () => void;
    };
    const original = File.prototype.text;
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.releaseListingRead = release;
    File.prototype.text = async function () {
      if (this.name === 'slow.xml') {
        state.listingReadStarted = true;
        await wait;
        File.prototype.text = original;
      }
      return original.call(this);
    };
  });
  await page.getByLabel(ja['nextcloud.file'], { exact: true }).setInputFiles({
    name: 'slow.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from('<stale/>'),
  });
  await page.waitForFunction(
    () =>
      (window as typeof window & { listingReadStarted?: boolean })
        .listingReadStarted,
  );
  const mode = page.getByLabel(ja['bulk.mode'], { exact: true });
  await mode.selectOption('text');
  await page.getByLabel(ja['bulk.data'], { exact: true }).fill('keep_this');
  await mode.selectOption('nextcloud');
  await page.evaluate(() =>
    (
      window as typeof window & { releaseListingRead?: () => void }
    ).releaseListingRead?.(),
  );
  await expect(
    page.getByLabel(ja['nextcloud.output'], { exact: true }),
  ).toHaveValue(validListing);
});

test('XML file size, image count and normalized pack size stay bounded', async ({
  page,
}) => {
  await openNextcloud(page);
  const output = page.getByLabel(ja['nextcloud.output'], { exact: true });
  await output.fill(validListing);
  await page.getByLabel(ja['nextcloud.file'], { exact: true }).setInputFiles({
    name: 'large.xml',
    mimeType: 'application/xml',
    buffer: Buffer.alloc(4 * 1024 * 1024 + 1, 32),
  });
  await expect(page.getByRole('alert')).toHaveText(ja['error.fileSize']);
  await expect(output).toHaveValue(validListing);
  await output.fill(
    listing(
      response(root, true),
      ...Array.from({ length: 2001 }, (_, index) =>
        response(`${root}cat_${index}.png`),
      ),
    ),
  );
  await page
    .getByRole('button', { name: ja['nextcloud.review'], exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('2000');
  const longPath = 'a'.repeat(1000);
  await page
    .getByLabel(ja['nextcloud.folderPath'], { exact: true })
    .fill(`/${longPath}`);
  const largeRoot = `/nextcloud/public.php/dav/files/Share123/${longPath}/`;
  await page.getByLabel(ja['nextcloud.file'], { exact: true }).setInputFiles({
    name: 'long-urls.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from(
      listing(
        response(largeRoot, true),
        ...Array.from({ length: 1450 }, (_, index) =>
          response(`${largeRoot}cat_${index}.png`),
        ),
      ),
    ),
  });
  await expect(output).toHaveValue(new RegExp(longPath));
  await page
    .getByRole('button', { name: ja['nextcloud.review'], exact: true })
    .click();
  await expect(page.getByRole('alert')).toHaveText(ja['error.packSize']);
  await expect(page.getByLabel(ja['bulk.mode'], { exact: true })).toHaveValue(
    'nextcloud',
  );
});
