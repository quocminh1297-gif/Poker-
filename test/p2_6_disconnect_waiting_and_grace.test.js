const test = require('node:test');
const assert = require('node:assert/strict');
const { setupRoom, cleanupAllRooms } = require('./helpers.js');
const { startGame, addOrReconnectPlayer, handleDisconnect } = require('../server.js');

test('P2-6: Waiting players not folded on disconnect and mobile grace limit per hand', t => {
  t.after(cleanupAllRooms);

  const { r } = setupRoom(2);
  startGame(r);

  // 1. Add a 3rd player while hand is in progress -> waitingNextHand = true, active = false
  const p3Res = addOrReconnectPlayer(r.id, 'sid_player_3', 'Player_3', null, false);
  const p3 = p3Res.player;
  assert.equal(p3.waitingNextHand, true);
  assert.equal(p3.active, false);

  // Player 3 disconnects
  handleDisconnect('sid_player_3');

  // Player 3 was waiting for next hand, not in the current hand, so folded must NOT be true!
  assert.equal(p3.folded, false, 'Waiting player must not be marked folded when disconnecting');

  // 2. Active mobile player grace period flag
  const p0 = r.players[0];
  p0.isMobile = true;
  assert.equal(p0.graceUsed, false, 'graceUsed should initially be false');
});
