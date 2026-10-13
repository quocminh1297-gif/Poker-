const test = require('node:test');
const assert = require('node:assert');
const { setupRoom, sumChips, startGame, doAction, cleanupAllRooms } = require('./helpers.js');

test('a. Chip invariant holds after actions in standard hand', (t) => {
  t.after(cleanupAllRooms);
  const { r } = setupRoom(2, 100000);
  const initialTotal = sumChips(r); // 200,000
  assert.strictEqual(initialTotal, 200000);

  const err = startGame(r);
  assert.strictEqual(err, null);
  // After blinds posted: SB (2000) + BB (4000) = 6000 pot
  assert.strictEqual(sumChips(r), initialTotal, 'Invariant after posting blinds');

  // Heads-up: Dealer (SB, P0) acts first preflop
  const p0 = r.players[0];
  const p1 = r.players[1];
  assert.strictEqual(r.curIdx, 0);

  // P0 calls 4000 (adds 2000 to reach 4000)
  const act1 = doAction(r, p0.sid, 'call');
  assert.strictEqual(act1, null);
  assert.strictEqual(sumChips(r), initialTotal, 'Invariant after P0 call');

  // P1 (BB) checks
  assert.strictEqual(r.curIdx, 1);
  const act2 = doAction(r, p1.sid, 'check');
  assert.strictEqual(act2, null);
  assert.strictEqual(sumChips(r), initialTotal, 'Invariant after P1 check');

  // Advances to flop
  assert.strictEqual(r.phase, 'flop');
  assert.strictEqual(sumChips(r), initialTotal, 'Invariant on flop');
});
