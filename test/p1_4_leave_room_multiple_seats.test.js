const test = require('node:test');
const assert = require('node:assert/strict');
const { io: ioClient } = require('socket.io-client');
const { server, rooms, sock2room } = require('../server.js');
const { cleanupAllRooms } = require('./helpers.js');

function emitWithTimeout(client, event, payload, timeoutMs = 800) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ timeout: true }), timeoutMs);
    client.emit(event, payload, res => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

test('P1-4: Prevent multiple seats per socket and implement leave_room', async t => {
  if (!server.listening) {
    await new Promise(resolve => server.listen(0, resolve));
  }
  const port = server.address().port;

  const client1 = ioClient(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  await new Promise(resolve => client1.on('connect', resolve));

  t.after(async () => {
    client1.disconnect();
    cleanupAllRooms();
    if (server.listening) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  // 1. Client 1 creates room A
  const createRes = await emitWithTimeout(client1, 'create_room', { name: 'Player1' });
  assert.equal(createRes.ok, true);
  const roomId = createRes.id;
  assert.ok(roomId);

  // 2. Client 1 attempts to join the same room with another name -> should be rejected!
  const joinAgainRes = await emitWithTimeout(client1, 'join_room', { id: roomId, name: 'Player1_Ghost' });
  assert.equal(joinAgainRes.ok, undefined, 'Must reject joining second seat with same socket');
  assert.match(joinAgainRes.err, /rời phòng trước/);

  // 3. Client 1 calls leave_room -> should succeed and remove player from waiting room
  const leaveRes = await emitWithTimeout(client1, 'leave_room', {});
  assert.equal(leaveRes.ok, true);

  // Room should now have 0 active players or be cleaned up
  assert.equal(rooms[roomId]?.players?.length || 0, 0);

  // 4. Client 1 can now join or create another room
  const createRes2 = await emitWithTimeout(client1, 'create_room', { name: 'Player1_New' });
  assert.equal(createRes2.ok, true);
});
