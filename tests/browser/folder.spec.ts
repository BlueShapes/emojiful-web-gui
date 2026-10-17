import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import ja from '../../web/src/i18n/messages/ja.json' with { type: 'json' };
import en from '../../web/src/i18n/messages/en.json' with { type: 'json' };

declare global {
  interface Window {
    folderTestName: string;
    showDirectoryPicker: (
      options?: unknown,
    ) => Promise<FileSystemDirectoryHandle>;
  }
}

const files = {
  'pack.mcmeta': JSON.stringify({
    pack: {
      pack_format: 15,
      description: 'Folder',
      supported_formats: [15, 18],
    },
    extra: true,
  }),
  'emojiful-web-gui.json': JSON.stringify({
    schemaVersion: 1,
    id: 'folder_pack',
    name: 'フォルダーパック',
    description: 'Folder',
    emojis: [],
  }),
  'data/folder_pack/recipes/nested/my_wave.json': JSON.stringify({
    type: 'emojiful:emoji_recipe',
    name: 'my_wave',
    url: 'https://example.com/my_wave.png',
    category: '反応',
    conditions: [{ type: 'example:condition' }],
  }),
  'data/folder_pack/recipes/crafting.json': JSON.stringify({
    type: 'minecraft:crafting_shapeless',
    keep: true,
  }),
  'notes.txt': 'keep these notes',
};

async function seed(page: Page, name = 'native-pack') {
  await page.evaluate(
    async ({ name, files }) => {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle(name, { create: true });
      for (const [path, contents] of Object.entries(files)) {
        const parts = path.split('/');
        const basename = parts.pop()!;
        let parent = directory;
        for (const segment of parts)
          parent = await parent.getDirectoryHandle(segment, { create: true });
        const file = await parent.getFileHandle(basename, { create: true });
        const writer = await file.createWritable();
        await writer.write(contents);
        await writer.close();
      }
      window.folderTestName = name;
    },
    { name, files },
  );
}

async function diskFile(page: Page, path: string, name = 'native-pack') {
  return page.evaluate(
    async ({ name, path }) => {
      let directory = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle(name);
      const parts = path.split('/');
      const basename = parts.pop()!;
      for (const segment of parts)
        directory = await directory.getDirectoryHandle(segment);
      try {
        return await (
          await directory.getFileHandle(basename)
        )
          .getFile()
          .then((file) => file.text());
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotFoundError')
          return null;
        throw error;
      }
    },
    { name, path },
  );
}

test.beforeEach(async ({ page }) => {
  await page.route('https://example.com/**', (route) => route.abort());
  await page.addInitScript(() => {
    window.folderTestName = 'native-pack';
    window.showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle(
        window.folderTestName,
      );
  });
});

test('opens a native folder and directly updates, adds and removes only emoji files', async ({
  page,
}) => {
  await page.goto('/ja/');
  await seed(page);
  await page
    .getByRole('button', { name: ja['folder.open'], exact: true })
    .click();
  await expect(
    page.getByLabel(ja['field.packName'], { exact: true }),
  ).toHaveValue('フォルダーパック');
  await expect(page.getByText(':my_wave:', { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('combobox', { name: ja['packs.switch'], exact: true })
      .locator('option'),
  ).toHaveCount(2);
  await page
    .getByRole('button', {
      name: ja['editNamed'].replace('{name}', 'my_wave'),
      exact: true,
    })
    .click();
  await page
    .getByLabel(ja['field.imageUrl'], { exact: true })
    .fill('https://example.com/updated.png');
  await page.getByRole('button', { name: ja.saveChanges, exact: true }).click();
  await expect(
    page.getByText(ja['folder.unsaved'], { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: ja.bulkInput, exact: true }).click();
  await page
    .getByLabel(ja['bulk.data'])
    .fill('my_cat,https://example.com/my_cat.png,動物');
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
  await page
    .getByRole('button', { name: ja['folder.save'], exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText(
    ja['folder.saved'].replace('{name}', 'native-pack'),
  );
  expect(
    JSON.parse(
      (await diskFile(page, 'data/folder_pack/recipes/nested/my_wave.json'))!,
    ),
  ).toMatchObject({
    url: 'https://example.com/updated.png',
    conditions: [{ type: 'example:condition' }],
  });
  expect(
    JSON.parse((await diskFile(page, 'data/folder_pack/recipes/my_cat.json'))!)
      .name,
  ).toBe('my_cat');
  expect(await diskFile(page, 'notes.txt')).toBe(files['notes.txt']);
  expect(await diskFile(page, 'data/folder_pack/recipes/crafting.json')).toBe(
    files['data/folder_pack/recipes/crafting.json'],
  );
  await expect(
    page.getByText(ja['folder.upToDate'], { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: '.work/folder-editor.png', fullPage: true });
  for (const name of ['my_wave', 'my_cat']) {
    await page
      .getByRole('button', {
        name: ja['deleteNamed'].replace('{name}', name),
        exact: true,
      })
      .click();
    await page
      .getByRole('button', { name: ja['confirm.apply'], exact: true })
      .click();
  }
  await expect(
    page.getByRole('button', { name: ja['folder.save'], exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: ja['folder.save'], exact: true })
    .click();
  await expect(
    page.getByText(ja['folder.upToDate'], { exact: true }),
  ).toBeVisible();
  expect(await diskFile(page, 'data/folder_pack/recipes/my_cat.json')).toBe(null);
  expect(
    await diskFile(page, 'data/folder_pack/recipes/nested/my_wave.json'),
  ).toBe(null);
  expect(await diskFile(page, 'notes.txt')).toBe(files['notes.txt']);
});

test('folder connections persist across language changes and remain bound to the selected draft', async ({
  page,
}) => {
  await page.goto('/ja/');
  await seed(page);
  await page
    .getByRole('button', { name: ja['folder.open'], exact: true })
    .click();
  const picker = page.getByRole('combobox', {
    name: ja['packs.switch'],
    exact: true,
  });
  await expect(picker.locator('option')).toHaveCount(2);
  const firstKey = await picker.inputValue();
  await page
    .getByLabel(ja['field.packName'], { exact: true })
    .fill('First folder draft');
  await seed(page, 'other-pack');
  await page
    .getByRole('button', { name: ja['folder.open'], exact: true })
    .click();
  await expect(picker.locator('option')).toHaveCount(3);
  const secondKey = await picker.inputValue();
  await page
    .getByLabel(ja['field.packName'], { exact: true })
    .fill('Second folder draft');
  await picker.selectOption(firstKey);
  await page
    .getByRole('combobox', { name: ja.language, exact: true })
    .selectOption('en');
  await expect(page).toHaveURL(/\/en\/$/);
  await expect(
    page.getByRole('button', { name: en['folder.save'], exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: en['folder.save'], exact: true })
    .click();
  await expect(
    page.getByText(en['folder.upToDate'], { exact: true }),
  ).toBeVisible();
  expect(
    JSON.parse((await diskFile(page, 'emojiful-web-gui.json'))!).name,
  ).toBe('First folder draft');
  expect(
    JSON.parse((await diskFile(page, 'emojiful-web-gui.json', 'other-pack'))!)
      .name,
  ).toBe('フォルダーパック');
  await page
    .getByRole('combobox', { name: en['packs.switch'], exact: true })
    .selectOption(secondKey);
  await page
    .getByRole('button', { name: en['folder.save'], exact: true })
    .click();
  await expect(
    page.getByText(en['folder.upToDate'], { exact: true }),
  ).toBeVisible();
  expect(
    JSON.parse((await diskFile(page, 'emojiful-web-gui.json', 'other-pack'))!)
      .name,
  ).toBe('Second folder draft');
  await page.reload();
  await expect(
    page.getByRole('button', { name: en['folder.save'], exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: en['packs.delete'], exact: true })
    .click();
  await page
    .getByRole('button', { name: en['confirm.apply'], exact: true })
    .click();
  expect(await diskFile(page, 'notes.txt', 'other-pack')).toBe(
    files['notes.txt'],
  );
  expect(
    JSON.parse((await diskFile(page, 'emojiful-web-gui.json', 'other-pack'))!)
      .name,
  ).toBe('Second folder draft');
});

test('external changes block direct save without losing the in-browser draft', async ({
  page,
}) => {
  await page.goto('/ja/');
  await seed(page);
  await page
    .getByRole('button', { name: ja['folder.open'], exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: ja['folder.save'], exact: true }),
  ).toBeVisible();
  await page
    .getByLabel(ja['field.packName'], { exact: true })
    .fill('Keep my edits');
  await page.evaluate(async () => {
    const directory = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle('native-pack');
    const file = await directory.getFileHandle('pack.mcmeta');
    const writer = await file.createWritable();
    await writer.write(
      '{"pack":{"pack_format":15,"description":"external edit"}}',
    );
    await writer.close();
  });
  await page
    .getByRole('button', { name: ja['folder.save'], exact: true })
    .click();
  await expect(
    page.getByRole('alert').filter({ hasText: ja['folder.conflict'] }),
  ).toBeVisible();
  await expect(
    page.getByLabel(ja['field.packName'], { exact: true }),
  ).toHaveValue('Keep my edits');
  expect(
    JSON.parse((await diskFile(page, 'pack.mcmeta'))!).pack.description,
  ).toBe('external edit');
  expect(
    JSON.parse((await diskFile(page, 'emojiful-web-gui.json'))!).name,
  ).toBe('フォルダーパック');
});

test('fallback folder selection imports read-only and retains ZIP export', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    window.showDirectoryPicker =
      undefined as unknown as typeof window.showDirectoryPicker;
  });
  const directory = testInfo.outputPath('pack-folder');
  for (const [path, contents] of Object.entries(files)) {
    const destination = join(directory, path);
    await mkdir(join(destination, '..'), { recursive: true });
    await writeFile(destination, contents);
  }
  await page.goto('/ja/');
  await page
    .getByLabel(ja['folder.input'], { exact: true })
    .setInputFiles(directory);
  await expect(page.getByText(':my_wave:', { exact: true })).toBeVisible();
  await expect(
    page.getByText(ja['folder.readOnly'], { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: ja['folder.save'], exact: true }),
  ).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: ja['export.zip'], exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe('folder_pack.zip');
});

test('cancelled folder picker makes no changes', async ({ page }) => {
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => {
      throw new DOMException('Cancelled', 'AbortError');
    };
  });
  await page.goto('/ja/');
  await expect(page.locator('.language-picker select')).toBeEnabled();
  await page
    .getByRole('button', { name: ja['folder.open'], exact: true })
    .click();
  await expect(
    page
      .getByRole('combobox', { name: ja['packs.switch'], exact: true })
      .locator('option'),
  ).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('denied write permission leaves original files untouched', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(FileSystemHandle.prototype, 'queryPermission', {
      configurable: true,
      value: async () => 'denied',
    });
    Object.defineProperty(FileSystemHandle.prototype, 'requestPermission', {
      configurable: true,
      value: async () => 'denied',
    });
  });
  await page.goto('/ja/');
  await seed(page);
  await page
    .getByRole('button', { name: ja['folder.open'], exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: ja['folder.save'], exact: true }),
  ).toBeVisible();
  await page
    .getByLabel(ja['field.packName'], { exact: true })
    .fill('Unsaved name');
  await page
    .getByRole('button', { name: ja['folder.save'], exact: true })
    .click();
  await expect(
    page.getByRole('alert').filter({ hasText: ja['folder.permission'] }),
  ).toBeVisible();
  expect(await diskFile(page, 'emojiful-web-gui.json')).toBe(
    files['emojiful-web-gui.json'],
  );
});

test('folder edits remain usable when IndexedDB handle transactions abort', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<typeof original>
    ) {
      const request = original.apply(this, args);
      const transaction = this.transaction;
      queueMicrotask(() => transaction.abort());
      return request;
    };
  });
  await page.goto('/ja/');
  await seed(page);
  await page
    .getByRole('button', { name: ja['folder.open'], exact: true })
    .click();
  await expect(page.locator('.folder-source-status')).toContainText(
    ja['folder.sessionOnly'],
  );
  await page
    .getByLabel(ja['field.packName'], { exact: true })
    .fill('Session-only folder');
  await page
    .getByRole('button', { name: ja['folder.save'], exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText(
    ja['folder.saved'].replace('{name}', 'native-pack'),
  );
  await expect(page.locator('.folder-source-status')).toContainText(
    ja['folder.upToDate'],
  );
  expect(
    JSON.parse((await diskFile(page, 'emojiful-web-gui.json'))!).name,
  ).toBe('Session-only folder');
  expect(errors).toEqual([]);
});
