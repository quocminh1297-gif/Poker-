const {
  app,
  server,
  io,
  rooms,
  sock2room,
  createRoom,
  addOrReconnectPlayer,
  startGame,
  startHand,
  doAction,
  awardPot,
  refundUncalledBet,
  inHandP,
  canActP,
  nextAct,
  filterState,
  sanitizeCfg,
  sanitizeName,
  destroyRoom,
  DISCONNECT_GRACE_MS,
  clearTurnTimer,
  clearRunoutTimer,
} = require('../server.js');

function setupRoom(numPlayers = 3, chips = 100000, cfgOverrides = {}) {
  const hostSid = 'sid_player_0';
  const rid = createRoom(hostSid, { chips, sb: 2000, bb: 4000, ante: 0, maxP: 9, ...cfgOverrides });
  const r = rooms[rid];

  // Add host
  addOrReconnectPlayer(rid, hostSid, 'Player_0', null, false);

  // Add remaining players
  for (let i = 1; i < numPlayers; i++) {
    const sid = `sid_player_${i}`;
    addOrReconnectPlayer(rid, sid, `Player_${i}`, null, false);
  }

  return { r, rid };
}

function sumChips(r) {
  return r.players.reduce((s, p) => s + p.chips, 0) + r.pot;
}

function cleanupAllRooms() {
  for (const rid in rooms) {
    destroyRoom(rid);
  }
}

module.exports = {
  app,
  server,
  io,
  rooms,
  sock2room,
  createRoom,
  addOrReconnectPlayer,
  startGame,
  startHand,
  doAction,
  awardPot,
  refundUncalledBet,
  clearTurnTimer,
  clearRunoutTimer,
  inHandP,
  canActP,
  nextAct,
  filterState,
  sanitizeCfg,
  sanitizeName,
  destroyRoom,
  DISCONNECT_GRACE_MS,
  setupRoom,
  sumChips,
  cleanupAllRooms,
};

