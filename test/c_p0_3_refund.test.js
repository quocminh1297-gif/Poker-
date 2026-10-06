const test = require('node:test');
const assert = require('node:assert');
const { setupRoom, sumChips, startGame, doAction, cleanupAllRooms } = require('./helpers.js');

test('c. P0-3: 3 players, UTG raises, SB folds, BB calls -> raiser is not prompted again, chip invariant holds', (t) => {
  t.after(cleanupAllRooms);
  const { r } = setupRoom(3, 100000);
  const initialTotal = sumChips(r); // 300,000

  startGame(r);
  // Dealer = 0, SB = 1 (posts 2000), BB = 2 (posts 4000). Next to act preflop: UTG = 0
  const p0 = r.players[0]; // UTG / Dealer
  const p1 = r.players[1]; // SB
  const p2 = r.players[2]; // BB

  assert.strictEqual(r.curIdx, 0, 'UTG acts first preflop in 3-handed');

  // UTG raises to 12000
  const act1 = doAction(r, p0.sid, 'raise', 12000);
  assert.strictEqual(act1, null);
  assert.strictEqual(p0.bet, 12000);
  assert.strictEqual(r.roundBet, 12000);

  // SB's turn (curIdx = 1) -> SB folds
  assert.strictEqual(r.curIdx, 1);
  const act2 = doAction(r, p1.sid, 'fold');
  assert.strictEqual(act2, null);

  // In correct poker rules: UTG's bet must remain 12000 until the betting round closes!
  // In buggy code: refundUncalledBet(r) was called immediately upon SB fold,
  // reducing p0.bet from 12000 down to 4000!
  assert.strictEqual(p0.bet, 12000, 'UTG bet must not be prematurely refunded on opponent fold');

  // BB's turn (curIdx = 2) -> BB calls 12000
  assert.strictEqual(r.curIdx, 2);
  const act3 = doAction(r, p2.sid, 'call');
  assert.strictEqual(act3, null);

  // Now, both active players (p0 and p2) have put in 12000.
  // The street must advance to flop, and p0 (the raiser) must NOT be asked to act again preflop!
  assert.strictEqual(r.phase, 'flop', 'Round should advance to flop after BB calls the raise');
  assert.notStrictEqual(r.curIdx, 0, 'Raiser should not be prompted to act again');

  // Invariant: total chips in play must be conserved exactly
  assert.strictEqual(sumChips(r), initialTotal, 'Total chips invariant must hold');
});
