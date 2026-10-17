import { test, expect } from '@playwright/test';
import ja from '../../web/src/i18n/messages/ja.json' with { type: 'json' };

test('individual editing rejects non-ASCII names immediately and accepts a corrected name', async ({
  page,
}) => {
  await page.route('https://example.com/**', (route) => route.abort());
  await page.goto('/ja/');
  await page.getByRole('button', { name: ja.addEmoji, exact: true }).click();
  await page
    .getByLabel(ja['field.imageUrl'], { exact: true })
    .fill('https://example.com/猫.png');
  const name = page.getByLabel(ja['field.emojiName'], { exact: true });
  const add = page
    .getByRole('dialog')
    .getByRole('button', { name: ja.add, exact: true });
  for (const invalid of [
    'cat猫',
    'ｃａｔ',
    'cat😺',
    'catK',
    '日本語を含む長い絵文字名です',
  ]) {
    await name.fill(invalid);
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('.name-character-error')).toHaveText(
      ja['error.emojiName'],
    );
    await expect(add).toBeDisabled();
    await expect(page.locator('.name-length-warning')).toHaveCount(0);
  }
  await name.fill('cat_2-nya');
  await expect(name).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.name-character-error')).toHaveCount(0);
  await add.click();
  await expect(page.getByText(':cat_2-nya:', { exact: true })).toBeVisible();
});

test('table import and replacement cannot apply while any name still contains Japanese', async ({
  page,
}) => {
  await page.route('https://example.com/**', (route) => route.abort());
  await page.goto('/ja/');
  await page.getByRole('button', { name: ja.bulkInput, exact: true }).click();
  await page.getByLabel(ja['bulk.mode'], { exact: true }).selectOption('table');
  const rows = page.locator('.bulk-table tbody tr');
  await rows.nth(0).getByRole('textbox').nth(0).fill('ねこ');
  await rows
    .nth(0)
    .getByRole('textbox')
    .nth(1)
    .fill('https://example.com/my_cat.png');
  await rows.nth(1).getByRole('textbox').nth(0).fill('my_dog');
  await rows
    .nth(1)
    .getByRole('textbox')
    .nth(1)
    .fill('https://example.com/my_dog.png');
  await expect(rows.nth(0)).toHaveClass(/bulk-row-issue/);
  await expect(rows.nth(0).getByRole('textbox').nth(0)).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(ja['error.emojiName']);
  await expect(page.locator('.emoji-card')).toHaveCount(0);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: ja['replace.open'], exact: true })
    .click();
  const search = page.getByLabel(ja['replace.search'], { exact: true });
  const replacement = page.getByLabel(ja['replace.replacement'], {
    exact: true,
  });
  const apply = page.getByRole('button', {
    name: ja['replace.apply'],
    exact: true,
  });
  await search.fill('my_dog');
  await replacement.fill('my_dog_2');
  await page
    .getByRole('button', { name: ja['replace.preview'], exact: true })
    .click();
  await expect(page.locator('.name-replacement-problems')).toContainText(
    ja['replace.problem.invalid'],
  );
  await expect(apply).toBeDisabled();
  await search.fill('ねこ');
  await replacement.fill('my_cat');
  await page
    .getByRole('button', { name: ja['replace.preview'], exact: true })
    .click();
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(rows.nth(0).getByRole('textbox').nth(0)).toHaveValue('my_cat');
  await page.getByRole('button', { name: ja['bulk.add'], exact: true }).click();
  await expect(page.locator('.emoji-card')).toHaveCount(2);
});
