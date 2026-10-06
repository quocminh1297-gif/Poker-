const test = require('node:test');
const assert = require('node:assert/strict');
const { setupRoom, cleanupAllRooms } = require('./helpers.js');
const { startGame, filterState } = require('../server.js');

test('P2-2: filterState supplies turnSec and relative turnMsLeft', t => {
  t.after(cleanupAllRooms);

  const { r } = setupRoom(2);
  startGame(r);

  // Turn is active for current player
  assert.ok(r.turnStartMs, 'Room has turnStartMs');

  const state = filterState(r, 'sid_player_0');
  assert.equal(state.turnSec, 30, 'turnSec must be 30');
  assert.equal(typeof state.turnMsLeft, 'number', 'turnMsLeft must be a number');
  assert.ok(state.turnMsLeft > 0 && state.turnMsLeft <= 30000, 'turnMsLeft must be within 0-30000ms');

  // When showdown
  r.phase = 'showdown';
  const showdownState = filterState(r, 'sid_player_0');
  assert.equal(showdownState.turnMsLeft, null, 'turnMsLeft is null during showdown');
});
