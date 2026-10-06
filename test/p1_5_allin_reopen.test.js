const test = require('node:test');
const assert = require('node:assert');
const { setupRoom, startGame, doAction, cleanupAllRooms } = require('./helpers.js');

test('P1-5: All-in cannot re-raise when action was not reopened by incomplete raise', (t) => {
  t.after(cleanupAllRooms);
  const { r } = setupRoom(3, 100000, { sb: 1000, bb: 2000 });
  startGame(r);

  // Preflop:
  // p0 (UTG), p1 (SB, posts 1000), p2 (BB, posts 2000)
  const p0 = r.players[0];
  const p1 = r.players[1];
  const p2 = r.players[2];

  // Everyone calls preflop to advance to flop
  doAction(r, p0.sid, 'call'); // p0 calls 2000
  doAction(r, p1.sid, 'call'); // p1 calls 1000 more (to 2000)
  doAction(r, p2.sid, 'check'); // p2 checks

  assert.strictEqual(r.phase, 'flop');

  // Set p0 chips to 14000 so p0's bet will be an incomplete raise
  p0.chips = 14000;

  // On Flop (curIdx = 1, SB):
  // 1. P1 bets 10000
  assert.strictEqual(doAction(r, p1.sid, 'raise', 10000), null);
  assert.strictEqual(r.roundBet, 10000);
  assert.strictEqual(r.lastRaise, 10000);

  // 2. P2 calls 10000 -> P2's canRaise becomes false
  assert.strictEqual(doAction(r, p2.sid, 'call'), null);
  assert.strictEqual(p2.canRaise, false, 'P2 cannot raise after calling');

  // 3. P0 goes all-in for 14000
  // (newTot is 14000, which is an incomplete raise of +4000 over 10000, whereas min full raise was +10000)
  assert.strictEqual(doAction(r, p0.sid, 'allin'), null);
  assert.strictEqual(r.roundBet, 14000);

  // 4. P1 calls 14000
  assert.strictEqual(doAction(r, p1.sid, 'call'), null);

  // 5. Now it is P2's turn (curIdx = 2).
  // P2 has 88000 chips. P2's canRaise is still false!
  assert.strictEqual(r.curIdx, 2);
  assert.strictEqual(p2.canRaise, false, 'Action was not reopened for P2');

  // P2 tries to go all-in with 88000 chips (which is a raise over 14000)
  const allInRes = doAction(r, p2.sid, 'allin');

  // In current code: returns null (allowed!), bypassing the rule.
  // In fixed code: rejected with error!
  assert.ok(
    allInRes && allInRes.includes('Cannot raise'),
    `All-in must be rejected when action was not reopened, got: ${allInRes}`
  );
});
