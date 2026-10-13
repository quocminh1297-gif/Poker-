const test = require('node:test');
const assert = require('node:assert/strict');
const { setupRoom, cleanupAllRooms } = require('./helpers.js');
const { filterState } = require('../server.js');

test('P2-9: filterState masks sid and hostId, providing pid and isHost instead', t => {
  t.after(cleanupAllRooms);

  const { r } = setupRoom(3);

  const state = filterState(r, 'sid_player_0');

  // Must not expose internal socket IDs
  assert.equal(state.hostId, undefined, 'Top-level hostId socket ID should be omitted');

  for (const player of state.players) {
    assert.equal(player.sid, undefined, 'Player object must not expose internal sid');
    assert.ok(typeof player.pid === 'string', 'Player must have a public pid');
    assert.equal(typeof player.isHost, 'boolean', 'Player must indicate isHost boolean');
  }

  // Host should have isHost = true
  assert.equal(state.players[0].isHost, true);
  assert.equal(state.players[1].isHost, false);
});
