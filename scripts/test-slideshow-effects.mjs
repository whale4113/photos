import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { test } from 'node:test';

const source = readFileSync(new URL('../src/slideshowEffects.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { slideshowRandom, selectTransition, weighted, motions } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const picture = (index, ratio, motion = 'none') => ({ index, width: ratio * 1000, height: 1000, motion, url: String(index), name: String(index) });

test('seeded selections are stable and random values stay within range', () => {
  for (let i = 0; i < 500; i++) {
    const seed = `session-${i}`;
    assert.equal(slideshowRandom(seed), slideshowRandom(seed));
    assert.ok(slideshowRandom(seed) >= 0 && slideshowRandom(seed) < 1);
    assert.equal(weighted(motions, seed), weighted(motions, seed));
  }
  assert.equal(new Set(Array.from({ length: 500 }, (_, i) => weighted(motions, `session-${i}`))).size, 4);
});

test('portrait backgrounds prevent crossfade and geometric push/split transitions', () => {
  const forbidden = new Set(['crossFade', 'pushLeft', 'pushUp', 'pushRotate', 'lineSplitVerticalRightDown', 'lineSplitVerticalUpLeft']);
  for (let i = 1; i < 1000; i++) assert.ok(!forbidden.has(selectTransition(picture(i - 1, .7), picture(i, .8), 'portrait-session', 1920, 1080)));
});

test('zoom and pan direction conflicts are filtered', () => {
  for (let i = 1; i < 1000; i++) {
    const into = selectTransition(picture(i - 1, 1.7, 'zoomOut'), picture(i, 1.7, 'zoomOut'), 'zoom-session', 1920, 1080);
    assert.ok(!into.startsWith('zoomIn'));
    const out = selectTransition(picture(i - 1, 1.7, 'zoomIn'), picture(i, 1.7, 'zoomIn'), 'zoom-session', 1920, 1080);
    assert.ok(!out.startsWith('zoomOut'));
    const pan = selectTransition(picture(i - 1, 1.7, 'panRight'), picture(i, 1.7, 'panRight'), 'pan-session', 1920, 1080);
    assert.ok(!['pushLeft', 'pushRotate'].includes(pan));
  }
});

test('all twelve configured transition outcomes remain reachable', () => {
  const found = new Set();
  for (let session = 0; session < 20; session++) for (let i = 1; i < 300; i++) found.add(selectTransition(picture(i - 1, 1.6), picture(i, 1.6), `session-${session}`, 1920, 1080));
  assert.equal(found.size, 12);
});
