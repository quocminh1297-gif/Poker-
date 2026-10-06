const test = require('node:test');
const assert = require('node:assert');
const { io: ioClient } = require('socket.io-client');
const { server, rooms, awardPot } = require('../server.js');

test('e. P1-3: Host pauses, hand finishes during pause -> host can resume', async (t) => {
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const client1 = ioClient(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  const client2 = ioClient(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });

  await Promise.all([
    new Promise((resolve) => client1.on('connect', resolve)),
    new Promise((resolve) => client2.on('connect', resolve)),
  ]);

  try {
    // 1. Host creates room
    const createRes = await new Promise((resolve) => {
      client1.emit('create_room', { name: 'HostP', chips: 100000 }, resolve);
    });
    assert.strictEqual(createRes.ok, true);
    const rid = createRes.id;

    // 2. Player 2 joins
    const joinRes = await new Promise((resolve) => {
      client2.emit('join_room', { id: rid, name: 'Player2' }, resolve);
    });
    assert.strictEqual(joinRes.ok, true);

    // 3. Start game
    const startRes = await new Promise((resolve) => {
      client1.emit('start_game', resolve);
    });
    assert.strictEqual(startRes.ok, true);

    const r = rooms[rid];
    assert.strictEqual(r.status, 'playing');

    // 4. Host pauses game
    const pauseRes = await new Promise((resolve) => {
      client1.emit('pause_game', resolve);
    });
    assert.strictEqual(pauseRes.ok, true);
    assert.strictEqual(r.paused, true, 'Game should be paused');

    // 5. Hand ends during pause (e.g. timeout / fold / awardPot -> enters showdown)
    awardPot(r, [r.players[0]], null);
    assert.strictEqual(r.phase, 'showdown');

    // 6. Host attempts to RESUME game
    const resumeRes = await new Promise((resolve) => {
      client1.emit('pause_game', resolve);
    });

    // BUG in current code:
    // pause_game handler checks: if (!r.phase || r.phase === 'showdown') return cb({ err: 'No active hand' });
    // This blocks resume with { err: 'No active hand' } and keeps r.paused = true!
    assert.strictEqual(
      resumeRes.err,
      undefined,
      `Resume should not fail with error: ${resumeRes.err}`
    );
    assert.strictEqual(resumeRes.paused, false, 'Game should be resumed');
    assert.strictEqual(r.paused, false, 'Room paused flag should be false');
  } finally {
    client1.disconnect();
    client2.disconnect();
    for (const rid in rooms) {
      if (rooms[rid]) {
        if (rooms[rid].turnTimer) clearTimeout(rooms[rid].turnTimer);
        if (rooms[rid].nextHandTimer) clearTimeout(rooms[rid].nextHandTimer);
        if (rooms[rid].runoutTimer) clearTimeout(rooms[rid].runoutTimer);
        delete rooms[rid];
      }
    }
    await new Promise((resolve) => server.close(resolve));
  }
});
