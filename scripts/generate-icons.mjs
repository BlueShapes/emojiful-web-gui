import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Keep all raster variants derived from the SVG used by the interface.
// This is an explicit maintenance command; site builds do not need a browser.
const publicDir = new URL('../web/public/', import.meta.url);
const source = await readFile(new URL('favicon.svg', publicDir), 'utf8');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const [filename, size, padding, background] of [
    ['favicon.png', 32, 0, null],
    ['apple-touch-icon.png', 180, 16, '#f7f8f2'],
  ]) {
    const dataUrl = await page.evaluate(
      async ({ source, size, padding, background }) => {
        const image = new Image();
        image.src = `data:image/svg+xml,${encodeURIComponent(source)}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const context = canvas.getContext('2d');
        if (background) {
          context.fillStyle = background;
          context.fillRect(0, 0, size, size);
        }
        context.drawImage(
          image,
          padding,
          padding,
          size - padding * 2,
          size - padding * 2,
        );
        return canvas.toDataURL('image/png');
      },
      { source, size, padding, background },
    );
    await writeFile(
      new URL(filename, publicDir),
      Buffer.from(dataUrl.split(',')[1], 'base64'),
    );
    console.log(`${filename}: ${size}x${size}`);
  }
} finally {
  await browser.close();
}
