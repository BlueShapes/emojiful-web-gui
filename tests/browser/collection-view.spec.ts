import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import ja from '../../web/src/i18n/messages/ja.json' with { type: 'json' };
import en from '../../web/src/i18n/messages/en.json' with { type: 'json' };
import ar from '../../web/src/i18n/messages/ar.json' with { type: 'json' };

const fixture = [
  { name: 'zeta_nya', category: 'Work' },
  { name: 'alpha_10', category: 'Animals' },
  { name: 'alpha_2', category: 'Animals' },
  { name: 'short_nya', category: 'Other' },
  { name: 'very_long_name', category: 'Other' },
].map((entry) => ({ ...entry, url: `https://example.com/${entry.name}.png` }));

async function seed(page: Page, emojis = fixture) {
  await page.route('https://example.com/**', (route) => route.abort());
  await page.addInitScript((emojis) => {
    if (!localStorage.getItem('emojiful.pack-studio.workspace.v1')) {
      localStorage.setItem(
        'emojiful.pack-studio.v1',
        JSON.stringify({
          schemaVersion: 1,
          id: 'view_test',
          name: 'View test',
          description: '',
          emojis,
        }),
      );
    }
  }, emojis);
  await page.goto('/ja/');
  await expect(page.locator('.emoji-card')).toHaveCount(emojis.length);
}

const names = (page: Page) =>
  page
    .locator('.emoji-card .emoji-name')
    .allTextContents()
    .then((values) =>
      values.map((value) => value.trim().replace(/^:|:$/g, '')),
    );
const savedNames = (page: Page) =>
  page.evaluate(() =>
    JSON.parse(
      localStorage.getItem('emojiful.pack-studio.workspace.v1')!,
    ).packs[0].pack.emojis.map((entry: { name: string }) => entry.name),
  );

test('sorts the collection naturally in every order without changing saved pack order', async ({
  page,
}) => {
  await seed(page);
  const sort = page.getByLabel('並び順', { exact: true });
  await expect(sort).toBeVisible({ timeout: 2000 });
  const added = fixture.map((entry) => entry.name);
  await expect.poll(() => savedNames(page)).toEqual(added);
  const original = await page.evaluate(() =>
    localStorage.getItem('emojiful.pack-studio.workspace.v1'),
  );
  const expected = {
    'added-asc': added,
    'added-desc': [...added].reverse(),
    'name-asc': [
      'alpha_2',
      'alpha_10',
      'short_nya',
      'very_long_name',
      'zeta_nya',
    ],
    'name-desc': [
      'zeta_nya',
      'very_long_name',
      'short_nya',
      'alpha_10',
      'alpha_2',
    ],
    'category-asc': [
      'alpha_2',
      'alpha_10',
      'short_nya',
      'very_long_name',
      'zeta_nya',
    ],
    'category-desc': [
      'zeta_nya',
      'short_nya',
      'very_long_name',
      'alpha_2',
      'alpha_10',
    ],
    'length-asc': [
      'alpha_2',
      'alpha_10',
      'zeta_nya',
      'short_nya',
      'very_long_name',
    ],
    'length-desc': [
      'very_long_name',
      'short_nya',
      'alpha_10',
      'zeta_nya',
      'alpha_2',
    ],
    attention: [
      'very_long_name',
      'zeta_nya',
      'alpha_10',
      'alpha_2',
      'short_nya',
    ],
  };
  for (const [order, result] of Object.entries(expected)) {
    await sort.selectOption(order);
    await expect.poll(() => names(page)).toEqual(result);
  }
  await page.getByLabel(ja.search, { exact: true }).fill('alpha');
  await sort.selectOption('name-asc');
  await expect.poll(() => names(page)).toEqual(['alpha_2', 'alpha_10']);
  await page.getByLabel(ja.search, { exact: true }).fill('');
  await page.getByLabel(ja['name.attentionOnly'], { exact: true }).check();
  await expect.poll(() => names(page)).toEqual(['very_long_name']);
  await page.getByLabel(ja['name.attentionOnly'], { exact: true }).uncheck();
  expect(
    await page.evaluate(() =>
      localStorage.getItem('emojiful.pack-studio.workspace.v1'),
    ),
  ).toBe(original);
  await page.reload();
  await expect(sort).toHaveValue('name-asc');
  await expect.poll(() => names(page)).toEqual(expected['name-asc']);
  expect(await savedNames(page)).toEqual(added);
});

test('cards, list and compact retain diagnostics and correct edit/delete targets, and settings persist across packs and languages', async ({
  page,
}) => {
  const entries = ['smile', 'very_long_name_nya', 'short_nya'].map((name) => ({
    name,
    url: `https://example.com/${name}.png`,
    category: 'Custom',
  }));
  await seed(page, entries);
  const view = page.getByLabel('表示形式', { exact: true });
  await expect(view).toBeVisible({ timeout: 2000 });
  const originalHeight = (await page
    .locator('.emoji-card')
    .last()
    .boundingBox())!.height;
  for (const mode of ['cards', 'list', 'compact']) {
    await view.selectOption(mode);
    await expect(page.locator('.emoji-grid')).toHaveAttribute(
      'data-view',
      mode,
    );
    await expect(
      page.locator('.emoji-card-error .emoji-name-error'),
    ).toBeVisible();
    await expect(
      page.locator('.emoji-card-warning .emoji-name-warning'),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: ja.editNamed.replace('{name}', 'short_nya'),
        exact: true,
      }),
    ).toBeVisible();
    if (mode === 'compact') {
      await expect(page.locator('.emoji-url').first()).toBeHidden();
      expect(
        (await page.locator('.emoji-card').last().boundingBox())!.height,
      ).toBeLessThan(originalHeight);
    } else {
      await expect(page.locator('.emoji-url').first()).toBeVisible();
    }
  }
  await page
    .getByLabel(ja['collection.sort'], { exact: true })
    .selectOption('name-desc');
  await page
    .getByRole('button', {
      name: ja.editNamed.replace('{name}', 'short_nya'),
      exact: true,
    })
    .click();
  await page
    .getByLabel(ja['field.emojiName'], { exact: true })
    .fill('tiny_nya');
  await page.getByRole('button', { name: ja.saveChanges, exact: true }).click();
  await expect
    .poll(() => names(page))
    .toEqual(['very_long_name_nya', 'tiny_nya', 'smile']);
  await page
    .getByRole('button', {
      name: ja.deleteNamed.replace('{name}', 'tiny_nya'),
      exact: true,
    })
    .click();
  await page
    .getByRole('button', { name: ja['confirm.apply'], exact: true })
    .click();
  await expect(page.locator('.emoji-card')).toHaveCount(2);
  await page.reload();
  await expect(view).toHaveValue('compact');
  await expect(
    page.getByLabel(ja['collection.sort'], { exact: true }),
  ).toHaveValue('name-desc');
  const selector = page.getByRole('combobox', {
    name: ja['packs.switch'],
    exact: true,
  });
  const originalKey = await selector.inputValue();
  await page.getByRole('button', { name: ja.newPack, exact: true }).click();
  await expect(view).toHaveValue('compact');
  await selector.selectOption(originalKey);
  await expect(page.locator('.emoji-card')).toHaveCount(2);
  await page
    .getByRole('combobox', { name: ja.language, exact: true })
    .selectOption('en');
  await expect(
    page.getByLabel(en['collection.view'], { exact: true }),
  ).toHaveValue('compact');
  await expect(
    page.getByLabel(en['collection.sort'], { exact: true }),
  ).toHaveValue('name-desc');
});

test('all display modes and controls fit mobile Japanese and Arabic collections', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const entries = ['smile', 'very_long_name_nya', 'short_nya'].map((name) => ({
    name,
    category: '長いカテゴリー / فئة طويلة',
    url: `https://example.com/${'long-path-'.repeat(15)}${name}.png`,
  }));
  await seed(page, entries);
  for (const [locale, messages] of [
    ['ja', ja],
    ['ar', ar],
  ] as const) {
    await page.goto(`/${locale}/`);
    const view = page.getByLabel(messages['collection.view'], { exact: true });
    await expect(view).toBeVisible({ timeout: 2000 });
    for (const mode of ['cards', 'list', 'compact']) {
      await view.selectOption(mode);
      await page
        .getByLabel(messages['collection.sort'], { exact: true })
        .selectOption('attention');
      await expect
        .poll(() => names(page))
        .toEqual(['smile', 'very_long_name_nya', 'short_nya']);
      await expect(page.locator('.emoji-name-error')).toBeVisible();
      await expect(page.locator('.emoji-name-warning')).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page.screenshot({
      path: `.work/collection-compact-${locale}.png`,
      fullPage: true,
    });
  }
});

test('unavailable preference storage does not prevent display changes or damage the workspace', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === 'emojiful.pack-studio.collection-preferences')
        throw new Error('blocked');
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'emojiful.pack-studio.collection-preferences')
        throw new Error('blocked');
      return set.call(this, key, value);
    };
  });
  await seed(page);
  const view = page.getByLabel(ja['collection.view'], { exact: true });
  await expect(view).toHaveValue('cards');
  await view.selectOption('list');
  await page
    .getByLabel(ja['collection.sort'], { exact: true })
    .selectOption('added-desc');
  await expect(page.locator('.emoji-grid')).toHaveAttribute(
    'data-view',
    'list',
  );
  await expect
    .poll(() => names(page))
    .toEqual([...fixture].reverse().map((entry) => entry.name));
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await savedNames(page)).toEqual(fixture.map((entry) => entry.name));
});
