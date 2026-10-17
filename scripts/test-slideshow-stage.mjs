import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.SLIDESHOW_TEST_URL || 'http://127.0.0.1:1420');
  await page.evaluate(async () => {
    const stageSource = await (await fetch('/src/SlideshowStage.tsx')).text();
    const mainSource = await (await fetch('/src/main.tsx')).text();
    const reactUrl = stageSource.match(/"([^"]*\/react\.js\?[^"]+)"/)[1];
    const clientUrl = mainSource.match(/"([^"]*\/react-dom_client\.js\?[^"]+)"/)[1];
    const React = (await import(reactUrl)).default;
    const { createRoot } = (await import(clientUrl)).default;
    const { default: Stage } = await import('/src/SlideshowStage.tsx');
    const host = document.createElement('div'); host.id = 'stage-test'; document.body.append(host);
    const root = createRoot(host);
    window.stageTest = {
      ready: 0, root,
      render(id, transition, playing = true, animations = true, transitions = true) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="${id % 2 ? '#f05' : '#05f'}"/><text x="100" y="200" font-size="80">${id}</text></svg>`;
        root.render(React.createElement(Stage, { url: `data:image/svg+xml,${encodeURIComponent(svg)}`, name: String(id), transition, playing, animations, transitions, onReady: () => window.stageTest.ready++ }));
      },
    };
    window.stageTest.render(0, 'none');
  });
  await page.waitForFunction(() => window.stageTest.ready === 1);
  const effects = ['none', 'fadeThroughBlack', 'crossFade', 'zoomInThroughBlack', 'zoomOutThroughBlack', 'zoomInFade', 'zoomOutFade', 'pushLeft', 'pushUp', 'pushRotate', 'lineSplitVerticalRightDown', 'lineSplitVerticalUpLeft', 'zoomRotate', 'rotate', 'elasticStretchLeft', 'elasticStretchDown', 'elasticSqueezeVertical'];
  for (let i = 0; i < effects.length; i++) {
    console.log('Checking', effects[i]);
    await page.evaluate(({ id, effect }) => window.stageTest.render(id, effect, false), { id: i + 1, effect: effects[i] });
    await page.waitForFunction(count => window.stageTest.ready === count, i + 2);
    assert.equal(await page.locator('#stage-test .slide-frame').last().getAttribute('data-transition'), effects[i]);
    assert.equal(await page.evaluate(() => document.querySelector('#stage-test').getAnimations({ subtree: true }).every(animation => animation.playState === 'paused' || animation.playState === 'finished')), true);
    await page.evaluate(() => document.querySelector('#stage-test').getAnimations({ subtree: true }).forEach(animation => animation.finish()));
    await page.waitForFunction(() => document.querySelectorAll('#stage-test .slide-frame').length === 1);
    assert.equal(await page.locator('#stage-test .slide-scene').count(), 1);
  }
  await page.evaluate(() => window.stageTest.render(17, 'crossFade', true, false));
  await page.waitForFunction(() => document.querySelector('#stage-test').getAnimations({ subtree: true }).every(animation => animation.playState === 'finished'));
  await page.evaluate(() => window.stageTest.render(17, 'crossFade', true, true));
  await page.waitForFunction(() => document.querySelector('#stage-test').getAnimations({ subtree: true }).some(animation => animation.playState === 'running'));
  await page.evaluate(() => window.stageTest.root.unmount());
  assert.equal(await page.locator('#stage-test .slide-frame').count(), 0);
  assert.deepEqual(errors, []);
  console.log('All 17 transition modes mounted, paused, finished and cleaned up; current-slide motion toggles and unmount passed.');
} finally { await browser.close(); }


