const test = require('node:test');
const assert = require('node:assert');
const { io: ioClient } = require('socket.io-client');
const { server, rooms, doAction } = require('../server.js');

test('f. P1-1: Heads-up, mobile player disconnects within grace period -> pot is not awarded immediately when opponent acts', async (t) => {
  // Ensure grace period is active (> 0)
  const prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const client1 = ioClient(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  const client2 = ioClient(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });

  await Promise.all([
    new Promise((resolve) => client1.on('connect', resolve)),
    new Promise((resolve) => client2.on('connect', resolve)),
  ]);

  try {
    // 1. Host (desktop) creates room
    const createRes = await new Promise((resolve) => {
      client1.emit('create_room', { name: 'PlayerA', chips: 100000, sb: 2000, bb: 4000 }, resolve);
    });
    const rid = createRes.id;

    // 2. Mobile player joins (isMobile: true)
    const joinRes = await new Promise((resolve) => {
      client2.emit('join_room', { id: rid, name: 'PlayerB_Mobile', isMobile: true }, resolve);
    });

    // 3. Start game
    await new Promise((resolve) => {
      client1.emit('start_game', resolve);
    });

    const r = rooms[rid];
    assert.strictEqual(r.status, 'playing');
    assert.strictEqual(r.phase, 'preflop');
    const playerA = r.players[0]; // Host / SB
    const playerB = r.players[1]; // Mobile / BB

    // 4. Mobile player disconnects (app-switching / network drop)
    client2.disconnect();

    // Give server a moment to process disconnect
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Player B should be disconnected but within grace period (not yet folded)
    assert.strictEqual(playerB.connected, false, 'Player B should be disconnected');
    assert.strictEqual(playerB.folded, false, 'Player B should NOT be folded during grace period');
    assert.ok(playerB.disconnectTimer, 'Player B should have active disconnect timer');

    // 5. Player A (still connected) takes an action (calls BB)
    const actRes = doAction(r, playerA.sid, 'call');
    assert.strictEqual(actRes, null);

    // BUG in current code:
    // inHandP filters by `p.connected`. Since playerB.connected is false,
    // inHandP only returns [playerA] (length 1).
    // doAction immediately calls awardPot(r, [playerA], null), awarding the whole pot to A!
    //
    // Expected behavior (fixed):
    // Player B is still in hand (inHandP should consider active & !folded, even if disconnected in grace).
    // Pot must NOT be awarded to A immediately!
    assert.notStrictEqual(
      r.phase,
      'showdown',
      'Hand must not end in showdown while mobile opponent is still within grace period'
    );
    assert.strictEqual(r.result, null, 'No result/winner should be declared yet');
    assert.ok(r.pot > 0, 'Pot should remain in play');
  } finally {
    process.env.NODE_ENV = prevEnv;
    client1.disconnect();
    client2.disconnect();
    // Clean up any remaining room timers
    for (const rid in rooms) {
      const r = rooms[rid];
      if (r) {
        if (r.turnTimer) clearTimeout(r.turnTimer);
        if (r.nextHandTimer) clearTimeout(r.nextHandTimer);
        if (r.runoutTimer) clearTimeout(r.runoutTimer);
        for (const p of r.players) {
          if (p.disconnectTimer) {
            clearTimeout(p.disconnectTimer);
            p.disconnectTimer = null;
          }
        }
        delete rooms[rid];
      }
    }
    await new Promise((resolve) => server.close(resolve));
  }
});
