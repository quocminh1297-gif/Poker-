const test = require('node:test');
const assert = require('node:assert/strict');
const { handStrengthCached, handStrength, hsCache } = require('../server');

test('P2-11: handStrengthCached caches evaluation results and bounds memory', () => {
  assert.ok(handStrengthCached, 'handStrengthCached should exist');
  assert.ok(hsCache instanceof Map, 'hsCache should be a Map');

  hsCache.clear();
  const hole = ['As', 'Ks'];
  const board = ['Qs', 'Js', 'Ts'];

  const res1 = handStrengthCached(hole, board);
  assert.equal(res1, handStrength(hole, board));
  assert.equal(hsCache.size, 1);

  // Calling again with same hole and board should hit cache
  const res2 = handStrengthCached(hole, board);
  assert.equal(res2, res1);
  assert.equal(hsCache.size, 1);

  // Calling with pre-flop (empty board)
  const resPre = handStrengthCached(['Ah', 'Ad'], []);
  assert.equal(resPre, 'Pair (Ace)');
  assert.equal(hsCache.size, 2);

  // Fill cache beyond limit (500) to verify bounded size
  for (let i = 0; i < 510; i++) {
    hsCache.set(`dummy_${i}`, `val_${i}`);
  }
  assert.ok(hsCache.size > 500);

  // Next call should clear when size > 500 and keep cache bounded
  handStrengthCached(['2c', '7d'], []);
  assert.ok(hsCache.size <= 500, `Cache size should be bounded after clear, got ${hsCache.size}`);
});
