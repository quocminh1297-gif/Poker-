const test = require('node:test');
const assert = require('node:assert');
const { setupRoom, startGame, doAction, cleanupAllRooms } = require('./helpers.js');

test('d. P1-6: Heads-up, SB has fewer chips than small blind -> game does not freeze', (t) => {
  t.after(cleanupAllRooms);
  const { r } = setupRoom(2, 100000, { sb: 2000, bb: 4000 });
  // Set player 0 (Dealer / SB) chips to 1500 (less than SB of 2000)
  r.players[0].chips = 1500;
  r.players[1].chips = 100000;

  startGame(r);

  // SB (player 0) is all-in immediately from posting 1500 blind
  assert.strictEqual(r.players[0].allIn, true, 'SB should be all-in');

  // BUG in current code:
  // r.curIdx is 0 (SB), who is allIn.
  // startTurnTimer sees cur.allIn and returns early (no timer set).
  // Neither player can act (P0 is all-in, P1 gets "Not your turn"), and no timer is running!
  //
  // Expected behavior (fixed):
  // Either game auto-starts runout/showdown, OR r.curIdx is advanced to player 1 (who can act).
  const curPlayer = r.players[r.curIdx];
  const isFrozen = curPlayer && curPlayer.allIn && !r.turnTimer && !r.runoutTimer && r.phase === 'preflop';

  assert.strictEqual(
    isFrozen,
    false,
    `Game must not be frozen on all-in player with no timer (curIdx=${r.curIdx}, curAllIn=${curPlayer?.allIn}, phase=${r.phase})`
  );
});
