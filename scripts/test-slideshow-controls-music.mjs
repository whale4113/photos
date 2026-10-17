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

  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.getByRole('button', { name: '幻灯片', exact: true }).last().click();
  await page.getByRole('button', { name: '开始播放', exact: true }).click();
  await page.locator('.slideshow').waitFor();
  const hidden = () => page.locator('.slideshow').evaluate(el => el.classList.contains('chrome-hidden'));
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.mouse.move(600, 350);
  await page.clock.runFor(3000);
  await page.waitForFunction(() => document.querySelector('.slideshow')?.classList.contains('chrome-hidden'));
  assert.equal(await hidden(), true, 'mouse-click focus must not pin controls');
  await page.mouse.move(610, 350);
  assert.equal(await hidden(), false, 'movement restores controls');
  await page.getByRole('button', { name: '背景音乐', exact: true }).click();
  await page.mouse.move(600, 350);
  await page.clock.runFor(3000);
  assert.equal(await hidden(), false, 'open music panel stays usable');
  await page.locator('.slideshow').dispatchEvent('pointerout', { pointerType: 'mouse' });
  assert.equal(await hidden(), true, 'leaving the slideshow hides controls');
  assert.equal(await page.locator('.slideshow-music-panel').count(), 0);
  await page.mouse.move(620, 350);
  await page.keyboard.press('Tab');
  await page.clock.runFor(3000);
  assert.equal(await hidden(), false, 'keyboard focus keeps controls accessible');
  await page.mouse.click(600, 350);
  await page.mouse.move(630, 350);
  await page.getByRole('button', { name: '背景音乐', exact: true }).click();
  await page.evaluate(() => {
    window.playedSources = [];
    HTMLMediaElement.prototype.play = function () { window.playedSources.push(this.src); return Promise.resolve(); };
    HTMLMediaElement.prototype.pause = function () {};
    window.revokedSources = [];
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = url => { window.revokedSources.push(url); revoke(url); };
  });
  const input = page.locator('.slideshow-music input[type=file]');
  assert.equal(await input.getAttribute('multiple'), '');
  const files = ['first.wav', 'second.wav', 'third.wav'].map(name => ({name, mimeType:'audio/wav', buffer:Buffer.from('test')}));
  await input.setInputFiles(files);
  const audio = page.locator('.slideshow-music audio');
  const first = await audio.getAttribute('src');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await audio.dispatchEvent('ended');
  const second = await audio.getAttribute('src');
  assert.notEqual(second, first);
  assert.match(await page.locator('.slideshow-music-local').textContent(), /second.wav.*2\/3/);
  await audio.dispatchEvent('ended');
  assert.match(await page.locator('.slideshow-music-local').textContent(), /third.wav.*3\/3/);
  await audio.dispatchEvent('ended');
  assert.equal(await audio.getAttribute('src'), first);
  await audio.dispatchEvent('ended');
  await page.getByRole('button', { name: '重新播放', exact: true }).click();
  assert.equal(await audio.getAttribute('src'), first, 'restart begins with first local track');
  await input.setInputFiles([files[0]]);
  assert.equal(await page.evaluate(() => window.revokedSources.length), 3);
  const before = await page.evaluate(() => window.playedSources.length);
  await audio.dispatchEvent('ended');
  assert.equal(await page.evaluate(() => window.playedSources.length), before + 1, 'single local track repeats');
  await page.getByRole('button', { name: '退出幻灯片', exact: true }).click();
  assert.equal(await page.evaluate(() => window.revokedSources.length), 4);
  assert.deepEqual(errors, []);
  console.log('Slideshow pointer hiding, keyboard focus, music panel, local playlist order/repeat/restart and URL cleanup passed.');
} finally { await browser.close(); }


