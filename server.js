const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const { Hand } = require('pokersolver');
const path = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });
const PORT   = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));

/* ── CONSTANTS ─────────────────────────────────── */
const SUITS       = ['s','h','d','c'];
const RANKS       = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const RANK_NAME   = { '2':'Two','3':'Three','4':'Four','5':'Five','6':'Six','7':'Seven',
  '8':'Eight','9':'Nine','T':'Ten','J':'Jack','Q':'Queen','K':'King','A':'Ace' };
const TURN_SEC    = 30;

/* ── STATE ─────────────────────────────────────── */
const rooms     = {};
const sock2room = {};

/* ── DECK ──────────────────────────────────────── */
function mkDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push(r + s);
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/* ── HAND STRENGTH (pre-board) ─────────────────── */
function handStrength(hole, board) {
  if (!hole || hole.length < 2) return null;
  if (!board || board.length === 0) {
    const r1 = hole[0].slice(0,-1), r2 = hole[1].slice(0,-1);
    const s1 = hole[0].slice(-1),   s2 = hole[1].slice(-1);
    if (r1 === r2) return `Pair (${RANK_NAME[r1]})`;
    const i1 = RANKS.indexOf(r1), i2 = RANKS.indexOf(r2);
    const hi = i1 >= i2 ? r1 : r2, lo = hi === r1 ? r2 : r1;
    return `${RANK_NAME[hi]}-${RANK_NAME[lo]}${s1 === s2 ? ' Suited' : ''}`;
  }
  try { return Hand.solve([...hole, ...board]).descr; } catch { return null; }
}

/* ── ROOM ──────────────────────────────────────── */
function createRoom(hostId, o = {}) {
  const id = uuidv4().substring(0, 6).toUpperCase();
  rooms[id] = {
    id, hostId, status: 'waiting',
    cfg: {
      chips: o.chips || 100000,
      sb:    o.sb    || 2000,
      bb:    o.bb    || 4000,
      ante:  o.ante  >= 0 ? (o.ante || 0) : 0,
      maxP:  Math.min(9, Math.max(2, o.maxP || 9)),
    },
    players: [], deck: [], board: [],
    pot: 0, phase: null,
    curIdx: -1, dealerIdx: 0,
    roundBet: 0, lastRaise: 0,
    msgs: [], handNum: 0, result: null,
    turnTimer: null, turnStartMs: null, paused: false,
  };
  return id;
}

function addPlayer(rid, sid, name) {
  const r = rooms[rid];
  if (!r) return 'Room not found';
  if (r.status === 'playing') return 'Game in progress';
  if (r.players.length >= r.cfg.maxP) return `Room full (${r.cfg.maxP} max)`;
  if (r.players.find(p => p.sid === sid)) return 'Already in room';
  if (r.players.find(p => p.name === name)) return 'Name taken';
  r.players.push({
    sid, name, chips: r.cfg.chips,
    hole: [], bet: 0, totalBet: 0,
    folded: false, allIn: false, active: true,
    acted: false, wins: 0, lastAct: null,
  });
  sock2room[sid] = rid;
  return null;
}

/* ── FILTER STATE ──────────────────────────────── */
function filterState(room, sid) {
  const me = room.players.find(p => p.sid === sid);
  let hs = null;
  if (me && me.hole.length === 2 && !me.folded && room.phase && room.phase !== 'showdown') {
    hs = handStrength(me.hole, room.board);
  }
  const players = room.players.map(p => {
    const isMe = p.sid === sid;
    let hole;
    if (room.phase === 'showdown') {
      hole = (!p.folded && p.hole.length > 0) ? p.hole : p.hole.map(() => '??');
    } else {
      hole = isMe ? p.hole : p.hole.map(() => '??');
    }
    return {
      sid: p.sid, name: p.name, chips: p.chips,
      bet: p.bet, totalBet: p.totalBet,
      folded: p.folded, allIn: p.allIn, active: p.active,
      hole, isMe, wins: p.wins, lastAct: p.lastAct,
    };
  });
  return {
    id: room.id, hostId: room.hostId, status: room.status,
    cfg: room.cfg, phase: room.phase,
    board: room.board, pot: room.pot,
    players, curIdx: room.curIdx, dealerIdx: room.dealerIdx,
    roundBet: room.roundBet, lastRaise: room.lastRaise,
    handNum: room.handNum, msgs: room.msgs.slice(-100),
    hs, result: room.result,
    turnStartMs: room.turnStartMs || null,
    paused: room.paused || false,
  };
}

function broadcast(r) {
  for (const p of r.players) {
    const s = io.sockets.sockets.get(p.sid);
    if (s) s.emit('state', filterState(r, p.sid));
  }
}
function msg(r, t) { r.msgs.push({ t, ts: Date.now() }); }

/* ── TURN TIMER ─────────────────────────────────── */
function startTurnTimer(r) {
  clearTurnTimer(r);
  if (!r.phase || r.phase === 'showdown') return;
  if (r.paused) return;
  const cur = r.players[r.curIdx];
  if (!cur || cur.folded || cur.allIn || !cur.active) return;

  r.turnStartMs = Date.now();
  r.turnTimer = setTimeout(() => {
    if (!r.phase || r.phase === 'showdown') return;
    if (r.paused) return;
    const c = r.players[r.curIdx];
    if (!c || c.folded || c.allIn) return;
    const toCall = r.roundBet - c.bet;
    if (toCall > 0) {
      // Facing a bet/raise — auto fold
      msg(r, `⏱️ ${c.name} timed out — auto fold`);
      c.folded = true; c.acted = true; c.lastAct = 'FOLD';
    } else {
      // No bet pending — auto check
      msg(r, `⏱️ ${c.name} timed out — auto check`);
      c.acted = true; c.lastAct = 'CHECK';
    }
    const ih = inHandP(r);
    if (ih.length <= 1) { awardPot(r, ih, null); broadcast(r); return; }
    if (bettingDone(r)) advanceStreet(r);
    else advancePlayer(r);
    broadcast(r);
  }, TURN_SEC * 1000);
}

function clearTurnTimer(r) {
  if (r.turnTimer) { clearTimeout(r.turnTimer); r.turnTimer = null; }
  r.turnStartMs = null;
}

/* ── HELPERS ────────────────────────────────────── */
const activeP = r => r.players.filter(p => p.active);
const inHandP = r => r.players.filter(p => p.active && !p.folded);
const canActP = r => r.players.filter(p => p.active && !p.folded && !p.allIn);

function nextAct(r, from) {
  const n = r.players.length;
  let i = (from + 1) % n, t = 0;
  while (t++ < n) {
    const p = r.players[i];
    if (p.active && !p.folded && !p.allIn) return i;
    i = (i + 1) % n;
  }
  i = (from + 1) % n; t = 0;
  while (t++ < n) {
    if (r.players[i].active && !r.players[i].folded) return i;
    i = (i + 1) % n;
  }
  return from;
}

function postBlind(r, idx, amt) {
  const p = r.players[idx];
  const a = Math.min(amt, p.chips);
  p.chips -= a; p.bet += a; p.totalBet += a; r.pot += a;
  if (p.chips === 0) p.allIn = true;
  // NOT setting p.acted — that's the preflop BB bug fix
}

function postAnte(r, p) {
  if (!r.cfg.ante || r.cfg.ante <= 0) return 0;
  const a = Math.min(r.cfg.ante, p.chips);
  p.chips -= a; p.totalBet += a; r.pot += a;
  if (p.chips === 0) p.allIn = true;
  return a;
}

function bettingDone(r) {
  const ca = canActP(r);
  if (ca.length === 0) return true;
  for (const p of ca) {
    if (!p.acted) return false;
    if (p.bet < r.roundBet) return false;
  }
  return true;
}

function advancePlayer(r) {
  r.curIdx = nextAct(r, r.curIdx);
  startTurnTimer(r);
}

function advanceStreet(r) {
  for (const p of r.players) { p.bet = 0; p.acted = false; p.lastAct = null; }
  r.roundBet = 0; r.lastRaise = r.cfg.bb;
  const first = nextAct(r, r.dealerIdx);

  switch (r.phase) {
    case 'preflop':
      r.board.push(r.deck.pop(), r.deck.pop(), r.deck.pop());
      r.phase = 'flop';
      msg(r, `🌊 FLOP: ${r.board.join('  ')}`);
      break;
    case 'flop':
      r.board.push(r.deck.pop()); r.phase = 'turn';
      msg(r, `↩️ TURN: ${r.board[3]}`);
      break;
    case 'turn':
      r.board.push(r.deck.pop()); r.phase = 'river';
      msg(r, `🏞️ RIVER: ${r.board[4]}`);
      break;
    case 'river':
      r.phase = 'showdown';
      doShowdown(r);
      return;
  }

  if (canActP(r).length <= 1) { runOut(r); return; }
  r.curIdx = first;
  startTurnTimer(r);
}

function runOut(r) {
  while (r.board.length < 5) r.board.push(r.deck.pop());
  r.phase = 'showdown';
  broadcast(r);
  doShowdown(r);
}

function doShowdown(r) {
  clearTurnTimer(r);
  msg(r, '🏆 SHOWDOWN');
  const cont = inHandP(r);
  if (cont.length <= 1) { awardPot(r, cont, null); return; }

  const ev = cont.map(p => ({ player: p, hand: Hand.solve([...p.hole, ...r.board]) }));
  const desc = ev.map(e => `${e.player.name}: [${e.player.hole.join(' ')}] — ${e.hand.descr}`).join('  |  ');
  msg(r, `🃏 ${desc}`);

  const best    = Hand.winners(ev.map(e => e.hand));
  const winners = ev.filter(e => best.includes(e.hand));
  awardPot(r, winners.map(w => w.player), ev);
}

function awardPot(r, winners, ev) {
  clearTurnTimer(r);
  if (!winners.length) return;
  const total = r.pot;
  const share = Math.floor(total / winners.length);
  const rem   = total - share * winners.length;

  const wr = winners.map((w, i) => {
    const amt = share + (i === 0 ? rem : 0);
    w.chips += amt; w.wins = (w.wins || 0) + 1;
    return { name: w.name, amt, hd: ev?.find(e => e.player === w)?.hand.descr || null, hole: w.hole };
  });

  const ah = ev ? ev.map(e => ({
    name: e.player.name, hd: e.hand.descr,
    hole: e.player.hole, won: winners.includes(e.player),
  })) : null;

  r.result = { winners: wr, allHands: ah, totalPot: total };
  r.pot = 0; r.phase = 'showdown';
  for (const w of wr) msg(r, `🏆 ${w.name} wins $${w.amt}${w.hd ? ` — ${w.hd}` : ''}`);
  broadcast(r);

  setTimeout(() => { if (rooms[r.id]?.status === 'playing') startHand(r); }, 6000);
}

/* ── GAME FLOW ───────────────────────────────────── */
function startGame(r) {
  if (r.players.length < 2) return 'Need ≥ 2 players';
  if (r.status === 'playing') return 'Already started';
  r.status = 'playing'; r.handNum = 0; r.dealerIdx = 0;
  msg(r, '🎲 Game started!');
  startHand(r);
  return null;
}

function startHand(r) {
  r.handNum++;
  r.deck = mkDeck(); r.board = []; r.pot = 0; r.result = null;
  r.roundBet = 0; r.lastRaise = r.cfg.bb;

  for (const p of r.players) {
    p.hole = []; p.bet = 0; p.totalBet = 0;
    p.folded = false; p.allIn = false; p.acted = false; p.lastAct = null;
    p.active = p.chips > 0;
  }

  const act = activeP(r);
  if (act.length < 2) {
    r.status = 'waiting'; msg(r, '⚠️ Not enough players with chips.');
    broadcast(r); return;
  }

  r.dealerIdx = nextAct(r, r.dealerIdx);

  if (r.cfg.ante > 0) {
    let tot = 0;
    for (const p of act) tot += postAnte(r, p);
    if (tot) msg(r, `💰 Antes: $${r.cfg.ante} × ${act.length} = $${tot}`);
  }

  for (const p of act) p.hole = [r.deck.pop(), r.deck.pop()];

  const sbI = nextAct(r, r.dealerIdx);
  const bbI = nextAct(r, sbI);
  postBlind(r, sbI, r.cfg.sb);
  postBlind(r, bbI, r.cfg.bb);
  r.roundBet = r.cfg.bb; r.lastRaise = r.cfg.bb;

  r.curIdx = nextAct(r, bbI);
  r.phase  = 'preflop';

  msg(r, `🃏 Hand #${r.handNum} — Dealer: ${r.players[r.dealerIdx].name}`);
  msg(r, `Blinds: ${r.players[sbI].name} (SB $${r.cfg.sb}) / ${r.players[bbI].name} (BB $${r.cfg.bb})`);

  startTurnTimer(r);
  broadcast(r);
}

function doAction(r, sid, action, amount) {
  if (!r.phase || r.phase === 'showdown') return 'No active hand';
  const cur = r.players[r.curIdx];
  if (!cur || cur.sid !== sid) return 'Not your turn';
  if (cur.folded || cur.allIn)  return 'Cannot act';

  const toCall = r.roundBet - cur.bet;

  switch (action) {
    case 'fold':
      cur.folded = true; cur.acted = true; cur.lastAct = 'FOLD';
      msg(r, `❌ ${cur.name} folds`);
      break;

    case 'check':
      if (toCall > 0) return `Can't check — must call $${toCall}`;
      cur.acted = true; cur.lastAct = 'CHECK';
      msg(r, `✓ ${cur.name} checks`);
      break;

    case 'call': {
      if (toCall <= 0) return 'Nothing to call';
      const a = Math.min(toCall, cur.chips);
      cur.chips -= a; cur.bet += a; cur.totalBet += a; r.pot += a;
      cur.acted = true;
      if (cur.chips === 0) { cur.allIn = true; cur.lastAct = 'ALL IN'; msg(r, `💥 ${cur.name} calls $${a} ALL IN`); }
      else                 { cur.lastAct = 'CALL'; msg(r, `📞 ${cur.name} calls $${a}`); }
      break;
    }

    case 'raise': {
      const tot = Number(amount);
      if (!tot || isNaN(tot)) return 'Invalid amount';
      const minR   = r.roundBet + r.lastRaise;
      const maxT   = cur.chips + cur.bet;
      const goAI   = tot >= maxT;
      const eff    = goAI ? maxT : tot;
      if (!goAI && eff < minR) return `Min raise to $${minR}`;
      if (eff <= r.roundBet) return 'Must exceed current bet';
      const add = eff - cur.bet;
      if (add > cur.chips) return 'Not enough chips';
      r.lastRaise = eff - r.roundBet;
      cur.chips -= add; cur.bet += add; cur.totalBet += add; r.pot += add; r.roundBet = eff;
      for (const p of r.players) if (p !== cur && p.active && !p.folded && !p.allIn) p.acted = false;
      cur.acted = true;
      if (cur.chips === 0) { cur.allIn = true; cur.lastAct = 'ALL IN'; msg(r, `💥 ${cur.name} raises to $${eff} ALL IN`); }
      else                 { cur.lastAct = `RAISE $${eff}`; msg(r, `⬆️ ${cur.name} raises to $${eff}`); }
      break;
    }

    case 'allin': {
      const chips = cur.chips;
      if (chips <= 0) return 'No chips';
      const newTot = cur.bet + chips;
      if (newTot > r.roundBet) {
        r.lastRaise = newTot - r.roundBet; r.roundBet = newTot;
        for (const p of r.players) if (p !== cur && p.active && !p.folded && !p.allIn) p.acted = false;
      }
      cur.bet += chips; cur.totalBet += chips; r.pot += chips; cur.chips = 0;
      cur.allIn = true; cur.acted = true; cur.lastAct = 'ALL IN';
      msg(r, `💥 ${cur.name} ALL IN $${chips}`);
      break;
    }

    default: return 'Unknown action';
  }

  // Clear timer — player acted
  clearTurnTimer(r);

  const ih = inHandP(r);
  if (ih.length <= 1) { awardPot(r, ih, null); broadcast(r); return null; }
  if (bettingDone(r)) advanceStreet(r);
  else advancePlayer(r);

  broadcast(r);
  return null;
}

/* ── SOCKET.IO ──────────────────────────────────── */
io.on('connection', socket => {
  console.log(`[+] ${socket.id}`);

  socket.on('create_room', (d, cb) => {
    if (!d.name?.trim()) return cb({ err: 'Name required' });
    const id  = createRoom(socket.id, { chips: d.chips, sb: d.sb, bb: d.bb, ante: d.ante, maxP: d.maxP });
    const err = addPlayer(id, socket.id, d.name.trim());
    if (err) return cb({ err });
    socket.join(id);
    msg(rooms[id], `👑 ${d.name} created the room`);
    broadcast(rooms[id]);
    cb({ ok: true, id });
  });

  socket.on('join_room', (d, cb) => {
    if (!d.name?.trim()) return cb({ err: 'Name required' });
    const id = d.id?.toUpperCase();
    if (!rooms[id]) return cb({ err: 'Room not found' });
    const err = addPlayer(id, socket.id, d.name.trim());
    if (err) return cb({ err });
    socket.join(id);
    msg(rooms[id], `🚪 ${d.name} joined`);
    broadcast(rooms[id]);
    cb({ ok: true, id });
  });

  socket.on('start_game', cb => {
    const rid = sock2room[socket.id], r = rid && rooms[rid];
    if (!r) return cb({ err: 'Not in a room' });
    if (r.hostId !== socket.id) return cb({ err: 'Host only' });
    const err = startGame(r);
    if (err) return cb({ err });
    cb({ ok: true });
  });

  socket.on('action', (d, cb) => {
    const rid = sock2room[socket.id], r = rid && rooms[rid];
    if (!r) return cb({ err: 'Not in a room' });
    const err = doAction(r, socket.id, d.action, d.amount);
    if (err) return cb({ err });
    cb({ ok: true });
  });

  socket.on('settings', (d, cb) => {
    const rid = sock2room[socket.id], r = rid && rooms[rid];
    if (!r) return cb({ err: 'Not in room' });
    if (r.hostId !== socket.id) return cb({ err: 'Host only' });
    if (r.status === 'playing') return cb({ err: 'Cannot change during game' });
    if (d.chips > 0)  { r.cfg.chips = d.chips; r.players.forEach(p => p.chips = d.chips); }
    if (d.sb > 0)      r.cfg.sb  = d.sb;
    if (d.bb > 0)      r.cfg.bb  = d.bb;
    if (d.ante >= 0)   r.cfg.ante = d.ante;
    if (d.maxP >= 2)   r.cfg.maxP = Math.min(9, d.maxP);
    msg(r, '⚙️ Settings updated'); broadcast(r); cb({ ok: true });
  });

  socket.on('pause_game', cb => {
    const rid = sock2room[socket.id], r = rid && rooms[rid];
    if (!r) return cb({ err: 'Not in room' });
    if (r.hostId !== socket.id) return cb({ err: 'Host only' });
    if (!r.phase || r.phase === 'showdown') return cb({ err: 'No active hand' });
    r.paused = !r.paused;
    if (r.paused) {
      clearTurnTimer(r);
      msg(r, `⏸️ Game paused by host`);
    } else {
      startTurnTimer(r);
      msg(r, `▶️ Game resumed by host`);
    }
    broadcast(r);
    cb({ ok: true, paused: r.paused });
  });

  socket.on('chat', d => {
    const rid = sock2room[socket.id], r = rid && rooms[rid];
    if (!r) return;
    const p = r.players.find(p => p.sid === socket.id);
    if (!p || !d.text?.trim()) return;
    msg(r, `💬 ${p.name}: ${d.text.trim().slice(0,200)}`);
    broadcast(r);
  });

  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id}`);
    const rid = sock2room[socket.id];
    delete sock2room[socket.id];
    const r = rid && rooms[rid];
    if (!r) return;
    const p = r.players.find(p => p.sid === socket.id);
    if (!p) return;
    msg(r, `⚠️ ${p.name} disconnected`);
    p.folded = true; p.active = false;

    if (r.status === 'playing' && r.phase && r.phase !== 'showdown') {
      const isCur = r.players[r.curIdx]?.sid === socket.id;
      if (isCur) {
        clearTurnTimer(r);
        const ih = inHandP(r);
        if (ih.length <= 1) { awardPot(r, ih, null); }
        else if (bettingDone(r)) { advanceStreet(r); broadcast(r); }
        else { advancePlayer(r); broadcast(r); }
      } else broadcast(r);
    }

    if (r.hostId === socket.id) {
      const rem = r.players.filter(p => p.active);
      if (rem.length) { r.hostId = rem[0].sid; msg(r, `👑 ${rem[0].name} is now host`); }
    }
    if (!r.players.some(p => p.active)) { clearTurnTimer(r); delete rooms[r.id]; }
    else broadcast(r);
  });
});

server.listen(PORT, () => console.log(`🃏 Poker → http://localhost:${PORT}`));
