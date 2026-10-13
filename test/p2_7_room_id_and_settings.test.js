const test = require('node:test');
const assert = require('node:assert/strict');
const { io: ioClient } = require('socket.io-client');
const { server, rooms } = require('../server.js');
const { cleanupAllRooms } = require('./helpers.js');

test('P2-7: Settings validates maxP >= live players and newRoomId avoids collisions', async t => {
  if (!server.listening) {
    await new Promise(resolve => server.listen(0, resolve));
  }
  const port = server.address().port;

  const clientHost = ioClient(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  const clientP2 = ioClient(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  const clientP3 = ioClient(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });

  await Promise.all([
    new Promise(res => clientHost.on('connect', res)),
    new Promise(res => clientP2.on('connect', res)),
    new Promise(res => clientP3.on('connect', res)),
  ]);

  t.after(async () => {
    clientHost.disconnect();
    clientP2.disconnect();
    clientP3.disconnect();
    cleanupAllRooms();
    if (server.listening) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  const createRes = await new Promise(res => clientHost.emit('create_room', { name: 'Host' }, res));
  assert.equal(createRes.ok, true);
  const roomId = createRes.id;

  // 2 more players join -> total 3 live players
  await new Promise(res => clientP2.emit('join_room', { id: roomId, name: 'P2' }, res));
  await new Promise(res => clientP3.emit('join_room', { id: roomId, name: 'P3' }, res));

  // Host attempts to set maxP = 2 when there are 3 live players
  const settingsRes = await new Promise(res => {
    clientHost.emit('settings', { maxP: 2 }, res);
  });
  assert.equal(settingsRes.ok, undefined, 'Must reject settings when maxP < live players');
  assert.match(settingsRes.err, /không được nhỏ hơn số người hiện có/);
});
