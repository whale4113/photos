import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const photos = Array.from({ length: 250 }, (_, i) => ({ id: String(i), name: `Photo ${String(i + 1).padStart(3, '0')}`, source_id: 'folder', path: `C:/photos/${i}.jpg`, modified: 1, bytes: 100, favorite: false }));
    const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#42698c"/></svg>');
    window.previewCalls = [];
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => 1,
      invoke: async (cmd, args) => {
        if (cmd === 'get_sources') return [{ id: 'folder', name: 'Photos', path: 'C:/photos', count: 250 }];
        if (cmd === 'list_photos') return { total: 250, items: photos.slice(args.query.offset, args.query.offset + 200) };
        if (cmd === 'get_thumbnail') return svg;
        if (cmd === 'get_preview') {
          window.previewCalls.push(args.id);
          await new Promise(resolve => setTimeout(resolve, 90));
          return `${svg}#photo-${args.id}`;
        }
        if (cmd === 'get_details') return { width: 1280, height: 720, format: 'JPEG', metadata: [] };
        return null;
      },
    };
  });
  await page.goto(process.env.SLIDESHOW_TEST_URL || 'http://127.0.0.1:1420');
  await page.locator('.photo-card').first().click();
  await page.locator('.full-photo').waitFor();
  await page.evaluate(() => {
    const next = document.querySelector('.viewer-arrow.next');
    for (let i = 0; i < 20; i++) next.click();
  });
  await page.waitForFunction(() => document.querySelector('.viewer-name')?.textContent === 'Photo 021');
  await page.locator('.full-photo').waitFor();
  assert.equal(await page.locator('.filmstrip-item[aria-current="true"]').getAttribute('title'), 'Photo 021');
  assert.ok(await page.locator('.filmstrip-item').count() < 30, 'filmstrip must stay virtualized');
  assert.ok(await page.evaluate(() => window.previewCalls.length) < 10, 'rapid clicks should skip intermediate full-size requests');
  await page.evaluate(() => {
    const next = document.querySelector('.viewer-arrow.next');
    const previous = document.querySelector('.viewer-arrow.prev');
    for (let i = 0; i < 10; i++) { next.click(); previous.click(); }
  });
  assert.equal(await page.locator('.viewer-name').textContent(), 'Photo 021');
  await page.getByRole('button', { name: '隐藏轨道', exact: true }).click();
  assert.equal(await page.locator('.filmstrip').count(), 0);
  await page.getByRole('button', { name: '显示轨道', exact: true }).click();
  await page.locator('.filmstrip-scroll').evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await page.waitForFunction(() => document.querySelector('.filmstrip-track')?.style.width === '20500px');
  await page.locator('.filmstrip-scroll').evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await page.waitForFunction(() => [...document.querySelectorAll('.filmstrip-item')].some(element => element.title === 'Photo 250'));
  await page.getByRole('button', { name: '第 250 张：Photo 250', exact: true }).click();
  assert.equal(await page.locator('.viewer-name').textContent(), 'Photo 250');
  assert.equal(await page.locator('.viewer-arrow.next').isDisabled(), true);
  await page.evaluate(async () => {
    const { previewUrl, preloadPreview } = await import('/src/api.ts');
    const before = window.previewCalls.filter(id => id === 'dedup').length;
    preloadPreview('dedup', 1);
    await Promise.all([previewUrl('dedup', 1), previewUrl('dedup', 1)]);
    if (window.previewCalls.filter(id => id === 'dedup').length !== before + 1) throw new Error('Duplicate preview requests');
  });
  await page.screenshot({ path: 'docs/navigation-filmstrip.png' });
  // Deterministic clock regression: each newly displayed slide gets a full 4s.
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.getByRole('button', { name: '幻灯片', exact: true }).last().click();
  await page.getByRole('button', { name: '开始播放', exact: true }).click();
  await page.clock.runFor(200);
  await page.locator('.slideshow .slide-foreground').last().waitFor();
  for (let i = 1; i <= 30; i++) {
    const name = `Photo ${String(i).padStart(3, '0')}`;
    assert.equal(await page.locator('.slideshow-title').textContent(), name);
    await page.clock.runFor(3700);
    assert.equal(await page.locator('.slideshow-title').textContent(), name, 'new slide must not inherit an expired timer');
    await page.clock.runFor(500);
    await page.waitForFunction(expected => document.querySelector('.slideshow-title')?.textContent === expected, `Photo ${String(i + 1).padStart(3, '0')}`);
    await page.clock.runFor(200);
    await page.waitForFunction(expected => [...document.querySelectorAll('.slideshow .slide-foreground')].some(img => img.alt === expected), `Photo ${String(i + 1).padStart(3, '0')}`);
  }
  assert.deepEqual(errors, []);
  console.log('Rapid navigation, preview deduplication, filmstrip pagination and 30 consecutive timed slideshow advances passed without skipping.');
} finally { await browser.close(); }
