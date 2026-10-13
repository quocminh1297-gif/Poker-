const test = require('node:test');
const assert = require('node:assert');
const { io: ioClient } = require('socket.io-client');
const { server, rooms } = require('../server.js');

test('P0-2: Token-based reconnection & prevent seat stealing by name', async (t) => {
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const clientHost = ioClient(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  const clientVictim = ioClient(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });

  await Promise.all([
    new Promise((resolve) => clientHost.on('connect', resolve)),
    new Promise((resolve) => clientVictim.on('connect', resolve)),
  ]);

  try {
    // 1. Host creates room
    const createRes = await new Promise((resolve) => {
      clientHost.emit('create_room', { name: 'HostAlice' }, resolve);
    });
    assert.strictEqual(createRes.ok, true);
    const rid = createRes.id;
    const r = rooms[rid];

    // 2. Victim joins room
    const victimRes = await new Promise((resolve) => {
      clientVictim.emit('join_room', { id: rid, name: 'BobPlayer' }, resolve);
    });
    assert.strictEqual(victimRes.ok, true);
    const victimToken = victimRes.token;
    assert.ok(victimToken, 'Player should receive secret token');

    // 3. Victim disconnects (e.g. temporary network drop)
    clientVictim.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const bobInRoom = r.players.find((p) => p.name === 'BobPlayer');
    assert.strictEqual(bobInRoom.connected, false, 'Bob is now disconnected');

    // 4. Attacker tries to steal Bob\'s seat by joining with Bob\'s name without token
    const clientAttacker = ioClient(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
    await new Promise((resolve) => clientAttacker.on('connect', resolve));

    const stealRes = await new Promise((resolve) => {
      clientAttacker.emit('join_room', { id: rid, name: 'BobPlayer' }, resolve);
    });
    assert.strictEqual(stealRes.ok, undefined, 'Attacker should not be able to steal seat');
    assert.strictEqual(stealRes.err, 'Name taken', 'Server must reject name impersonation');

    // 5. Attacker tries case variation ('bobplayer')
    const caseRes = await new Promise((resolve) => {
      clientAttacker.emit('join_room', { id: rid, name: 'bobplayer' }, resolve);
    });
    assert.strictEqual(caseRes.err, 'Name taken', 'Names must be case-insensitively unique');
    clientAttacker.disconnect();

    // 6. Legitimate Bob reconnects using secret token
    const clientBobReconnected = ioClient(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
    await new Promise((resolve) => clientBobReconnected.on('connect', resolve));

    const reconnRes = await new Promise((resolve) => {
      clientBobReconnected.emit('join_room', { id: rid, name: 'BobPlayer', token: victimToken }, resolve);
    });
    assert.strictEqual(reconnRes.ok, true, 'Legitimate player reconnects successfully');
    assert.strictEqual(reconnRes.reconnected, true);
    assert.strictEqual(bobInRoom.connected, true, 'Bob is now reconnected');
    assert.strictEqual(bobInRoom.sid, clientBobReconnected.id, 'Bob sid updated');

    // Verify Bob did not steal host from HostAlice
    assert.strictEqual(r.hostId, clientHost.id, 'Host is still HostAlice');

    clientBobReconnected.disconnect();
  } finally {
    clientHost.disconnect();
    clientVictim.disconnect();
    for (const rid in rooms) {
      delete rooms[rid];
    }
    await new Promise((resolve) => server.close(resolve));
  }
});
