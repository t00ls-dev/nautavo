// Raster exports of the repository's SVG brand assets; no remote image service.
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage();
  const render = async (source, width, height, target) => {
    const svg = await fs.readFile(source, 'utf8');
    const png = await page.evaluate(
      async ({ svg, width, height }) => {
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { svg, width, height },
    );
    await fs.writeFile(target, Buffer.from(png, 'base64'));
  };
  // The simplified mark (icon.svg) stays legible at 32 px and below; larger
  // icons use the detailed one with the east, south and west ticks.
  await render('src/brand/icon.svg', 32, 32, 'src/brand/icon-32.png');
  for (const size of [180, 192, 512])
    await render(
      'src/brand/icon-detail.svg',
      size,
      size,
      `src/brand/icon-${size}.png`,
    );
  // Maskable: square corners, the mark scaled into the 80% safe circle.
  const maskable = (await fs.readFile('src/brand/icon-detail.svg', 'utf8'))
    .replace('rx="112"', 'rx="0"')
    .replace(
      'translate(71.68 71.68) scale(5.76)',
      'translate(76.8 76.8) scale(5.6)',
    );
  await fs.writeFile('src/brand/maskable.svg', maskable);
  await render(
    'src/brand/maskable.svg',
    512,
    512,
    'src/brand/maskable-512.png',
  );
  await render(
    'src/brand/social-card.svg',
    1200,
    630,
    'src/brand/social-card.png',
  );
  console.log('Exported PNG icons and social sharing image.');
} finally {
  await browser.close();
}
