const test = require('node:test');
const assert = require('node:assert/strict');
const { io: ioClient } = require('socket.io-client');
const { server, rooms } = require('../server.js');
const { cleanupAllRooms } = require('./helpers.js');

test('P1-8: Room creation limit per IP and brute-force join protection', async t => {
  if (!server.listening) {
    await new Promise(resolve => server.listen(0, resolve));
  }
  const port = server.address().port;

  const clients = [];
  t.after(async () => {
    for (const c of clients) c.disconnect();
    cleanupAllRooms();
    if (server.listening) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  // 1. 5 distinct sockets from the same IP create 5 rooms
  for (let i = 0; i < 5; i++) {
    const c = ioClient(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
    await new Promise(resolve => c.on('connect', resolve));
    clients.push(c);

    const res = await new Promise(resolve => {
      c.emit('create_room', { name: `Host_${i}` }, resolve);
    });
    assert.equal(res.ok, true, `Room ${i} should be created`);
  }

  // 2. 6th socket from the same IP tries to create a room -> blocked by MAX_ROOMS_PER_IP = 5
  const client6 = ioClient(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  await new Promise(resolve => client6.on('connect', resolve));
  clients.push(client6);

  const sixthRes = await new Promise(resolve => {
    client6.emit('create_room', { name: 'Host_6' }, resolve);
  });
  assert.equal(sixthRes.ok, undefined);
  assert.equal(sixthRes.err, 'Too many rooms');

  // 3. Brute force join protection: 10 failed join attempts on client6
  for (let i = 0; i < 10; i++) {
    const badJoin = await new Promise(resolve => {
      client6.emit('join_room', { id: `NONEX${i}`, name: 'Tester' }, resolve);
    });
    assert.equal(badJoin.err, 'Room not found');
  }

  // 11th attempt should be blocked by rate limit
  const blockedJoin = await new Promise(resolve => {
    client6.emit('join_room', { id: 'NONEX11', name: 'Tester' }, resolve);
  });
  assert.match(blockedJoin.err, /Too many failed attempts/i);
});
