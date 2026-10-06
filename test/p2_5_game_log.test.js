const test = require('node:test');
const assert = require('node:assert/strict');
const { io: ioClient } = require('socket.io-client');
const { server, rooms } = require('../server.js');
const { cleanupAllRooms } = require('./helpers.js');

test('P2-5: Message sequence IDs and get_log event', async t => {
  if (!server.listening) {
    await new Promise(resolve => server.listen(0, resolve));
  }
  const port = server.address().port;

  const client = ioClient(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  await new Promise(resolve => client.on('connect', resolve));

  t.after(async () => {
    client.disconnect();
    cleanupAllRooms();
    if (server.listening) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  const createRes = await new Promise(resolve => {
    client.emit('create_room', { name: 'Alice' }, resolve);
  });
  assert.equal(createRes.ok, true);
  const roomId = createRes.id;
  const r = rooms[roomId];

  // Verify created message has id
  assert.ok(r.msgs.length > 0);
  assert.equal(typeof r.msgs[0].id, 'number', 'Message must have numeric sequence id');
  assert.ok(r.msgs[0].id > 0);

  // Client requests full log via get_log
  const logRes = await new Promise(resolve => {
    client.emit('get_log', {}, resolve);
  });
  assert.equal(logRes.ok, true);
  assert.ok(Array.isArray(logRes.msgs));
  assert.equal(logRes.msgs.length, r.msgs.length);
});
