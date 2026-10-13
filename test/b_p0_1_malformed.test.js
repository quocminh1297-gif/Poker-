const test = require('node:test');
const assert = require('node:assert');
const { io: ioClient } = require('socket.io-client');
const { server } = require('../server.js');

test('b. P0-1: Malformed payloads do not crash server and return error / survive', async (t) => {
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const client = ioClient(`http://localhost:${port}`, {
    transports: ['websocket'],
    forceNew: true,
  });

  await new Promise((resolve) => client.on('connect', resolve));

  try {
    // 1. join_room with numeric id
    const res1 = await new Promise((resolve) => {
      client.emit('join_room', { name: 'Player1', id: 123 }, (response) => {
        resolve(response);
      });
      // If server crashes or does not respond within 300ms, resolve with timeout
      setTimeout(() => resolve({ timeout: true }), 300);
    });

    // In fixed code, this returns { err: 'Room not found' }
    // In current buggy code, d.id.toUpperCase() throws TypeError: d.id.toUpperCase is not a function
    assert.ok(res1 && res1.err, `join_room with numeric id should return { err }, got: ${JSON.stringify(res1)}`);

    // 2. chat with numeric text
    client.emit('chat', { text: 123 });

    // 3. start_game without ack callback
    client.emit('start_game');

    // 4. create_room with null
    const res4 = await new Promise((resolve) => {
      client.emit('create_room', null, (response) => {
        resolve(response);
      });
      setTimeout(() => resolve({ timeout: true }), 300);
    });
    assert.ok(res4 && res4.err, `create_room with null should return { err }, got: ${JSON.stringify(res4)}`);

    // Check that socket is still connected and responsive
    assert.strictEqual(client.connected, true, 'Server and connection should stay alive');
  } finally {
    client.disconnect();
    await new Promise((resolve) => server.close(resolve));
  }
});
