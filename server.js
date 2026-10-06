'use strict';

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const helmet  = require('helmet');
const path    = require('path');

const config = require('./config');
const rules  = require('./rules');
const room   = require('./room');

const {
  PORT,
  MAX_ROOMS_PER_IP,
  setServerRef,
  DISCONNECT_GRACE_MS,
} = config;

const {
  sanitizeName,
  sanitizeCfg,
  mkDeck,
  handStrength,
  handStrengthCached,
  hsCache,
  pickWinners,
} = rules;

const {
  rooms,
  sock2room,
  setIo,
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
  destroyRoom,
  handleDisconnect,
  resetStreet,
  dealNextStreet,
  foldDisconnected,
  msg,
  broadcast,
  stepRunout,
  scheduleNextHand,
} = room;

process.on('uncaughtException',  e => console.error('[uncaughtException]', e));
process.on('unhandledRejection', e => console.error('[unhandledRejection]', e));

const isFn  = f => typeof f === 'function';
const isStr = (v, max = 64) => typeof v === 'string' && v.length > 0 && v.length <= max;

function makeLimiter(limit = 30, windowMs = 5000) {
  let n = 0, t = Date.now();
  return () => { const now = Date.now(); if (now - t > windowMs) { t = now; n = 0; } return ++n <= limit; };
}

function safeOn(socket, allow, event, handler) {
  socket.on(event, (...args) => {
    const cb = isFn(args[args.length - 1]) ? args.pop() : () => {};
    const d  = args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) ? args[0] : {};
    if (!allow()) return cb({ err: 'Too many requests' });
    try { handler(d, cb); }
    catch (e) { console.error(`[${event}]`, e); cb({ err: 'Server error' }); }
  });
}

const app    = express();
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:   ["'self'"],
      scriptSrc:    ["'self'"],
      styleSrc:     ["'self'", 'https://fonts.googleapis.com'],
      styleSrcAttr: ["'unsafe-inline'"],
      fontSrc:      ["'self'", 'https://fonts.gstatic.com'],
      connectSrc:   ["'self'", 'ws:', 'wss:'],
      imgSrc:       ["'self'", 'data:'],
    },
  },
}));

const server = http.createServer(app);
setServerRef(server);

const io = new Server(server, {
  maxHttpBufferSize: 1e4,
  cors: { origin: false },
  pingInterval: 10000,
  pingTimeout: 8000,
});
setIo(io);

app.use(express.static(path.join(__dirname, 'public')));

const ipOf = s => (s.handshake.headers['x-forwarded-for'] || s.handshake.address || '').toString().split(',')[0].trim();

const fails = new Map(); // ip -> { n, t }
function tooManyFails(ip) {
  const f = fails.get(ip);
  return !!f && Date.now() - f.t < 60000 && f.n >= 10;
}
function noteFail(ip) {
  const f = fails.get(ip);
  if (!f || Date.now() - f.t >= 60000) fails.set(ip, { n: 1, t: Date.now() });
  else f.n++;
}

/* ── SOCKET.IO ──────────────────────────────────── */
io.on('connection', socket => {
  console.log(`[+] ${socket.id}`);
  const allow = makeLimiter();
  const on = (ev, fn) => safeOn(socket, allow, ev, fn);

  on('create_room', (d, cb) => {
    const curRid = sock2room[socket.id];
    if (curRid && rooms[curRid]) {
      const mine = rooms[curRid].players.find(p => p.sid === socket.id && !p.left);
      if (mine && !(isStr(d.token, 64) && d.token === mine.token)) {
        return cb({ err: 'Bạn đang ở trong một phòng — hãy rời phòng trước' });
      }
    }
    const ip = ipOf(socket);
    if (Object.values(rooms).filter(r => r.creatorIp === ip).length >= MAX_ROOMS_PER_IP) {
      return cb({ err: 'Too many rooms' });
    }
    const cleanName = sanitizeName(d.name);
    if (!cleanName) return cb({ err: 'Name required (1-16 characters)' });
    const id  = createRoom(socket.id, { chips: d.chips, sb: d.sb, bb: d.bb, ante: d.ante, maxP: d.maxP });
    rooms[id].creatorIp = ip;
    const token = isStr(d.token, 64) ? d.token : null;
    const res = addOrReconnectPlayer(id, socket.id, cleanName, token, d.isMobile === true);
    if (res.err) return cb({ err: res.err });
    socket.join(id);
    msg(rooms[id], `👑 ${cleanName} created the room`);
    broadcast(rooms[id]);
    cb({ ok: true, id, token: res.player.token });
  });

  on('join_room', (d, cb) => {
    const ip = ipOf(socket);
    if (tooManyFails(ip)) return cb({ err: 'Too many failed attempts. Try again later.' });

    const curRid = sock2room[socket.id];
    if (curRid && rooms[curRid]) {
      const mine = rooms[curRid].players.find(p => p.sid === socket.id && !p.left);
      if (mine && !(isStr(d.token, 64) && d.token === mine.token)) {
        return cb({ err: 'Bạn đang ở trong một phòng — hãy rời phòng trước' });
      }
    }
    const cleanName = sanitizeName(d.name);
    if (!cleanName) return cb({ err: 'Name required (1-16 characters)' });
    if (!isStr(d.id, 12)) {
      noteFail(ip);
      return cb({ err: 'Room not found' });
    }
    const id = d.id.toUpperCase();
    if (!rooms[id]) {
      noteFail(ip);
      return cb({ err: 'Room not found' });
    }
    const token = isStr(d.token, 64) ? d.token : null;
    const res = addOrReconnectPlayer(id, socket.id, cleanName, token, d.isMobile === true);
    if (res.err) return cb({ err: res.err });
    fails.delete(ip);
    socket.join(id);
    if (!res.reconnected) {
      msg(rooms[id], `🚪 ${cleanName} joined${res.player.waitingNextHand ? ' (waiting for next hand)' : ''}`);
    }
    broadcast(rooms[id]);
    cb({ ok: true, id, token: res.player.token, reconnected: res.reconnected });
  });

  on('leave_room', (_d, cb) => {
    const rid = sock2room[socket.id], r = rid && rooms[rid];
    if (!r) return cb({ ok: true });
    const p = r.players.find(pl => pl.sid === socket.id);
    if (p) {
      p.left = true;
      handleDisconnect(socket.id);
      if (r.status === 'waiting') {
        r.players = r.players.filter(x => x !== p);
        if (r.players.length === 0) {
          destroyRoom(r.id);
        } else {
          broadcast(r);
        }
      }
    }
    socket.leave(rid);
    delete sock2room[socket.id];
    cb({ ok: true });
  });

  on('start_game', (_d, cb) => {
    const rid = sock2room[socket.id], r = rid && rooms[rid];
    if (!r) return cb({ err: 'Not in a room' });
    if (r.hostId !== socket.id) return cb({ err: 'Host only' });
    const err = startGame(r);
    if (err) return cb({ err });
    cb({ ok: true });
  });

  on('action', (d, cb) => {
    const rid = sock2room[socket.id], r = rid && rooms[rid];
    if (!r) return cb({ err: 'Not in a room' });
    const err = doAction(r, socket.id, d.action, d.amount);
    if (err) return cb({ err });
    cb({ ok: true });
  });

  on('settings', (d, cb) => {
    const rid = sock2room[socket.id], r = rid && rooms[rid];
    if (!r) return cb({ err: 'Not in room' });
    if (r.hostId !== socket.id) return cb({ err: 'Host only' });
    if (r.status === 'playing') return cb({ err: 'Cannot change during game' });
    const cfg = sanitizeCfg(d);
    const live = r.players.filter(p => !p.left).length;
    if (cfg.maxP < live) return cb({ err: `Max players không được nhỏ hơn số người hiện có (${live})` });
    r.cfg = cfg;
    if (d.chips > 0) r.players.forEach(p => { p.chips = cfg.chips; p.active = true; });
    msg(r, '⚙️ Settings updated');
    broadcast(r);
    cb({ ok: true });
  });

  on('rebuy', (_d, cb) => {
    const rid = sock2room[socket.id], r = rid && rooms[rid];
    if (!r) return cb({ err: 'Not in room' });
    const p = r.players.find(p => p.sid === socket.id);
    if (!p) return cb({ err: 'Player not found' });
    if (p.chips > 0) return cb({ err: 'Still have chips' });

    const inLiveHand = r.status === 'playing' && r.phase && r.phase !== 'showdown' && p.hole && p.hole.length > 0 && !p.folded;
    if (inLiveHand) {
      return cb({ err: 'Cannot rebuy while hand is in progress. Wait for showdown.' });
    }

    p.chips = r.cfg.chips;
    p.waitingNextHand = (r.status === 'playing');
    p.active = (r.status !== 'playing');
    msg(r, `💵 ${p.name} rebuys $${r.cfg.chips}${p.waitingNextHand ? ' (enters next hand)' : ''}`);
    broadcast(r);
    cb({ ok: true });
  });

  on('pause_game', (_d, cb) => {
    const rid = sock2room[socket.id], r = rid && rooms[rid];
    if (!r) return cb({ err: 'Not in room' });
    if (r.hostId !== socket.id) return cb({ err: 'Host only' });
    if (!r.paused && (!r.phase || r.phase === 'showdown')) return cb({ err: 'No active hand' });
    r.paused = !r.paused;
    if (r.paused) {
      clearTurnTimer(r);
      clearRunoutTimer(r);
      msg(r, `⏸️ Game paused by host`);
    } else {
      msg(r, `▶️ Game resumed by host`);
      if (r.phase === 'showdown') {
        scheduleNextHand(r);
      } else if (r.showAllInHole && inHandP(r).length >= 2 && canActP(r).length <= 1) {
        stepRunout(r);
      } else {
        startTurnTimer(r);
      }
    }
    broadcast(r);
    cb({ ok: true, paused: r.paused });
  });

  on('chat', (d, _cb) => {
    const rid = sock2room[socket.id], r = rid && rooms[rid];
    if (!r) return;
    const p = r.players.find(p => p.sid === socket.id);
    if (!p || !isStr(d.text, 500)) return;
    const text = d.text.trim().slice(0, 200);
    if (!text) return;
    msg(r, `💬 ${p.name}: ${text}`);
    broadcast(r);
  });

  on('sync_state', (_d, cb) => {
    const rid = sock2room[socket.id], r = rid && rooms[rid];
    if (r) {
      socket.emit('state', filterState(r, socket.id));
      cb({ ok: true });
    } else {
      cb({ err: 'Not in room' });
    }
  });

  on('get_log', (_d, cb) => {
    const rid = sock2room[socket.id], r = rid && rooms[rid];
    cb(r ? { ok: true, msgs: r.msgs } : { err: 'Not in room' });
  });

  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id}`);
    handleDisconnect(socket.id);
  });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`🃏 Poker → http://localhost:${PORT}`));
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
  mkDeck,
  handleDisconnect,
  handStrength,
  handStrengthCached,
  hsCache,
  pickWinners,
  resetStreet,
  dealNextStreet,
  foldDisconnected,
};
