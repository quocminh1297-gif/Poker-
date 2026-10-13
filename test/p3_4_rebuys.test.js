const test = require('node:test');
const assert = require('node:assert/strict');
const { setupRoom, cleanupAllRooms } = require('./helpers.js');
const { filterState } = require('../server.js');

test('p3_4: rebuys count initializes at 0 and increments on rebuy, exposed in filterState', t => {
  t.after(cleanupAllRooms);

  const { r } = setupRoom(3);

  // 1. Initial state has rebuys: 0 for all players
  let state = filterState(r, 'sid_player_0');
  for (const player of state.players) {
    assert.equal(player.rebuys, 0, 'Initial rebuys should be 0');
  }

  // 2. Simulate player 0 busting and rebuying
  const p0 = r.players[0];
  p0.chips = 0;
  p0.rebuys = (p0.rebuys || 0) + 1;
  p0.chips = r.cfg.startingChips;

  state = filterState(r, 'sid_player_0');
  assert.equal(state.players[0].rebuys, 1, 'Player 0 rebuys should be 1 after rebuy');
  assert.equal(state.players[1].rebuys, 0, 'Player 1 rebuys should still be 0');

  // 3. Second rebuy
  p0.rebuys = (p0.rebuys || 0) + 1;
  state = filterState(r, 'sid_player_0');
  assert.equal(state.players[0].rebuys, 2, 'Player 0 rebuys should be 2 after second rebuy');
});
