import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});

for (const preview of [
  { file: 'available-900.png', page: 'preview-available.html', width: 900 },
  { file: 'available-360.png', page: 'preview-available.html', width: 360 },
  { file: 'candidate-900.png', page: 'preview-candidate.html', width: 900 },
]) {
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { height: 1200, width: preview.width },
  });
  await page.goto(`http://127.0.0.1:4173/gan-harness/${preview.page}`, {
    waitUntil: 'networkidle',
  });
  await page.screenshot({
    fullPage: true,
    path: new URL(preview.file, import.meta.url).pathname,
  });
  await page.close();
}

await browser.close();
