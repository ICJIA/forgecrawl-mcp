import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { get, set, clear, size, makeKey } from '../src/cache.js';

beforeEach(() => clear());

test('set/get round-trip', () => {
  set('a', { value: 1 });
  assert.deepEqual(get('a'), { value: 1 });
});

test('miss returns null', () => {
  assert.equal(get('missing'), null);
});

test('expired entries return null and self-evict', () => {
  set('a', 'x', 1); // 1ms TTL
  return new Promise(resolve => {
    setTimeout(() => {
      assert.equal(get('a'), null);
      assert.equal(size(), 0);
      resolve();
    }, 5);
  });
});

test('LRU eviction when over MAX_ENTRIES', async () => {
  // Use a fresh cache module instance — relies on CONFIG.CACHE_MAX_ENTRIES default (50).
  for (let i = 0; i < 60; i++) {
    set(`k${i}`, i, 60_000);
  }
  assert.ok(size() <= 50, `expected <= 50, got ${size()}`);
  // Oldest should be gone, most recent should remain.
  assert.equal(get('k0'), null);
  assert.equal(get('k59'), 59);
});

test('makeKey is stable for objects regardless of key order', () => {
  const a = makeKey({ url: 'https://x', mode: 'summary' });
  const b = makeKey({ mode: 'summary', url: 'https://x' });
  assert.equal(a, b);
});

test('makeKey distinguishes different inputs', () => {
  assert.notEqual(makeKey({ url: 'https://x' }), makeKey({ url: 'https://y' }));
  assert.notEqual(makeKey({ url: 'https://x', mode: 'summary' }), makeKey({ url: 'https://x', mode: 'markdown' }));
});

test('access bumps LRU position', () => {
  set('old', 1, 60_000);
  set('newer', 2, 60_000);
  // Touching 'old' should make it most-recent.
  assert.equal(get('old'), 1);
  // Fill enough to push the cache one entry over the cap (50).
  // After: cap=50, store had {newer, old}, then 49 fills => 51 total => 1 eviction.
  // 'newer' is the LRU after the get('old') bump, so it should go first.
  for (let i = 0; i < 49; i++) set(`k${i}`, i, 60_000);
  assert.equal(get('old'), 1);     // bumped, still present
  assert.equal(get('newer'), null); // LRU, evicted
});
