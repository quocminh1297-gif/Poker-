const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const { randomInt, randomUUID, randomBytes } = require('crypto');
const { Hand } = require('pokersolver');
const path = require('path');

process.on('uncaughtException',  e => console.error('[uncaughtException]', e));
process.on('unhandledRejection', e => console.error('[unhandledRejection]', e));

const isFn  = f => typeof f === 'function';
const isStr = (v, max = 64) => typeof v === 'string' && v.length > 0 && v.length <= max;

function makeLimiter(limit = 30, windowMs = 5000) {
  let n = 0, t = Date.now();
  return () => { const now = Date.now(); if (now - t > windowMs) { t = now; n = 0; } return ++n <= limit; };
}

/** Ack always valid, payload always object, rate-limited and try/catch protected */
function safeOn(socket, allow, event, handler) {
  socket.on(event, (...args) => {
    const cb = isFn(args[args.length - 1]) ? args.pop() : () => {};
    const d  = args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) ? args[0] : {};
    if (!allow()) return cb({ err: 'Too many requests' });
    try { handler(d, cb); }
    catch (e) { console.error(`[${event}]`, e); cb({ err: 'Server error' }); }
  });
}

/** Protect timers against unhandled throws */
const guard = fn => (...a) => { try { return fn(...a); } catch (e) { console.error('[timer]', e); } };

const helmet = require('helmet');
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
const io     = new Server(server, {
  maxHttpBufferSize: 1e4,
  cors: { origin: false },
  pingInterval: 10000,
  pingTimeout: 8000,
});
const PORT   = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));

const MAX_ROOMS_PER_IP = 5;
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

/* ── CONSTANTS ─────────────────────────────────── */
const SUITS       = ['s','h','d','c'];
const RANKS       = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const RANK_NAME   = { '2':'Two','3':'Three','4':'Four','5':'Five','6':'Six','7':'Seven',
  '8':'Eight','9':'Nine','T':'Ten','J':'Jack','Q':'Queen','K':'King','A':'Ace' };
const TURN_SEC        = 30;
const RUNOUT_DELAY_MS = process.env.NODE_ENV === 'test' ? 20 : 1800;

/* ── STATE ─────────────────────────────────────── */
const rooms     = Object.create(null);
const sock2room = Object.create(null);

/* ── DECK ──────────────────────────────────────── */
function mkDeck() {
  const d = SUITS.flatMap(s => RANKS.map(r => r + s));
  for (let i = d.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/* ── CONFIG SANITIZER ─────────────────────────── */
function sanitizeCfg(o = {}) {
  const sb    = Math.min(100000000, Math.max(1, Math.floor(Number(o.sb) || 2000)));
  const bb    = Math.min(200000000, Math.max(sb + 1, Math.floor(Number(o.bb) || 4000)));
  const chips = Math.min(10000000000, Math.max(bb * 2, Math.floor(Number(o.chips) || 100000)));
  const ante  = Math.min(50000000, Math.max(0, Math.floor(Number(o.ante) || 0)));
  const maxP  = Math.min(9, Math.max(2, Math.floor(Number(o.maxP) || 9)));
  return { sb, bb, chips, ante, maxP };
}

/* ── NAME SANITIZER (Anti-XSS & length enforcement) ── */
function sanitizeName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[^\p{L}\p{N}_\- ]/gu, '').trim().slice(0, 16);
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

const hsCache = new Map();
function handStrengthCached(hole, board) {
  const k = (hole ? hole.join() : '') + '|' + (board ? board.join() : '');
  let v = hsCache.get(k);
  if (v === undefined) {
    v = handStrength(hole, board);
    if (hsCache.size > 500) hsCache.clear();
    hsCache.set(k, v);
  }
  return v;
}

function newRoomId() {
  let id;
  do { id = randomBytes(3).toString('hex').toUpperCase(); } while (rooms[id]);
  return id;
}

/* ── ROOM ──────────────────────────────────────── */
function createRoom(hostId, o = {}) {
  const id = newRoomId();
  rooms[id] = {
    id, hostId, status: 'waiting',
    cfg: sanitizeCfg(o),
    players: [], deck: [], board: [],
    pot: 0, phase: null,
    curIdx: -1, dealerIdx: 0,
    roundBet: 0, lastRaise: 0,
    msgs: [], handNum: 0, result: null,
    turnTimer: null, turnStartMs: null, paused: false,
    nextHandTimer: null, runoutTimer: null,
    showdownHands: false, showAllInHole: false,
  };
  return id;
}

function addOrReconnectPlayer(rid, sid, name, token, isMobile = false) {
  const r = rooms[rid];
  if (!r) return { err: 'Room not found' };

  // 1) Reconnect ONLY via secret token — never via public name
  const existing = isStr(token, 64) ? r.players.find(p => p.token === token) : null;
  if (existing) {
    if (existing.disconnectTimer) {
      clearTimeout(existing.disconnectTimer);
      existing.disconnectTimer = null;
    }
    if (r.roomDestroyTimer) {
      clearTimeout(r.roomDestroyTimer);
      r.roomDestroyTimer = null;
    }
    const oldSid = existing.sid;
    if (oldSid && oldSid !== sid) {
      delete sock2room[oldSid];
    }
    existing.sid = sid;
    existing.connected = true;
    existing.left = false;
    existing.isMobile = !!isMobile;
    sock2room[sid] = rid;
    if (r.hostId === oldSid) {
      r.hostId = sid; // Do not steal host if someone else currently holds it
    }
    return { err: null, player: existing, reconnected: true };
  }

  // 2) New player: unique name (case-insensitive)
  const key = name.toLowerCase();
  if (r.players.some(p => !p.left && p.name.toLowerCase() === key)) {
    return { err: 'Name taken' };
  }
  if (r.players.filter(p => !p.left).length >= r.cfg.maxP) {
    return { err: `Room full (${r.cfg.maxP} max)` };
  }

  const isPlaying = r.status === 'playing';
  const player = {
    pid: randomUUID(),
    sid, token: randomUUID(), name,
    chips: r.cfg.chips,
    hole: [], bet: 0, totalBet: 0,
    folded: false, allIn: false,
    active: !isPlaying,
    connected: true,
    isMobile: !!isMobile,
    waitingNextHand: isPlaying,
    acted: false, canRaise: true, wins: 0, lastAct: null, graceUsed: false,
  };

  r.players.push(player);
  sock2room[sid] = rid;
  return { err: null, player, reconnected: false };
}

/* ── FILTER STATE ──────────────────────────────── */
function filterState(room, sid) {
  const me = room.players.find(p => p.sid === sid);
  let hs = null;
  if (me && me.hole.length === 2 && !me.folded && room.phase && room.phase !== 'showdown') {
    hs = handStrengthCached(me.hole, room.board);
  }

  const players = room.players.map(p => {
    const isMe = p.sid === sid;
    let hole;
    if ((room.phase === 'showdown' && room.showdownHands) || (room.showAllInHole && !p.folded)) {
      hole = (!p.folded && p.hole.length > 0) ? p.hole : (isMe ? p.hole : p.hole.map(() => '??'));
    } else {
      hole = isMe ? p.hole : p.hole.map(() => '??');
    }
    return {
      pid: p.pid || (p.pid = randomUUID()),
      isHost: p.sid === room.hostId,
      name: p.name, chips: p.chips,
      bet: p.bet, totalBet: p.totalBet,
      folded: p.folded, allIn: p.allIn,
      active: p.active && p.connected,
      connected: p.connected,
      waitingNextHand: p.waitingNextHand || false,
      canRaise: p.canRaise ?? true,
      hole, isMe, wins: p.wins, lastAct: p.lastAct,
    };
  });

  // Anti-cheat: Mask winner's hole cards in result if showdownHands is false (e.g. all opponents folded)
  let safeResult = null;
  if (room.result) {
    safeResult = {
      ...room.result,
      winners: (room.result.winners || []).map(w => {
        const isWinnerMe = room.players.some(p => p.sid === sid && p.name === w.name);
        return {
          ...w,
          hole: (room.showdownHands || isWinnerMe) ? w.hole : null,
        };
      }),
      allHands: room.showdownHands ? room.result.allHands : null,
    };
  }

  return {
    id: room.id, status: room.status,
    cfg: room.cfg, phase: room.phase,
    board: room.board, pot: room.pot,
    players, curIdx: room.curIdx, dealerIdx: room.dealerIdx,
    roundBet: room.roundBet, lastRaise: room.lastRaise,
    handNum: room.handNum, msgs: room.msgs.slice(-40),
    hs, result: safeResult,
    turnSec: TURN_SEC,
    turnMsLeft: (room.showAllInHole || room.phase === 'showdown' || !room.turnStartMs)
      ? null : Math.max(0, TURN_SEC * 1000 - (Date.now() - room.turnStartMs)),
    turnStartMs: (room.showAllInHole || room.phase === 'showdown') ? null : (room.turnStartMs || null),
    paused: room.paused || false,
  };
}

const SUIT_UNICODE = { s:'♠', h:'♥', d:'♦', c:'♣' };
function fmtCard(c) {
  if (!c || c === '??') return '??';
  const rk = c.slice(0, -1);
  const su = c.slice(-1);
  const dispR = rk === 'T' ? '10' : rk;
  const sym = SUIT_UNICODE[su] || su;
  return `${dispR}${sym}`;
}
function fmtCards(arr) {
  if (!arr || !arr.length) return '';
  return arr.map(fmtCard).join(' ');
}

function broadcast(r) {
  for (const p of r.players) {
    if (p.connected) {
      const s = io.sockets.sockets.get(p.sid);
      if (s) s.emit('state', filterState(r, p.sid));
    }
  }
}

function msg(r, t) {
  r.msgSeq = (r.msgSeq || 0) + 1;
  r.msgs.push({ id: r.msgSeq, t, ts: Date.now() });
  if (r.msgs.length > 1000) r.msgs.shift();
}

/* ── TURN TIMER ─────────────────────────────────── */
function startTurnTimer(r) {
  clearTurnTimer(r);
  if (!r.phase || r.phase === 'showdown') return;
  if (r.paused) return;
  const cur = r.players[r.curIdx];
  if (!cur || cur.folded || cur.allIn || !cur.active) return;

  r.turnStartMs = Date.now();
  r.turnTimer = setTimeout(guard(() => {
    if (!r.phase || r.phase === 'showdown') return;
    if (r.paused) return;
    const c = r.players[r.curIdx];
    if (!c || c.folded || c.allIn) return;

    const toCall = r.roundBet - c.bet;
    if (toCall > 0) {
      msg(r, `⏱️ ${c.name} timed out — auto fold`);
      c.folded = true; c.acted = true; c.lastAct = 'FOLD';
    } else {
      msg(r, `⏱️ ${c.name} timed out — auto check`);
      c.acted = true; c.lastAct = 'CHECK';
    }

    const ih = inHandP(r);
    if (ih.length <= 1) {
      awardPot(r, ih, null);
      broadcast(r);
      return;
    }
    if (bettingDone(r)) advanceStreet(r);
    else advancePlayer(r);
    broadcast(r);
  }), TURN_SEC * 1000);
}

function clearTurnTimer(r) {
  if (r.turnTimer) { clearTimeout(r.turnTimer); r.turnTimer = null; }
  r.turnStartMs = null;
}

function clearRunoutTimer(r) {
  if (r.runoutTimer) { clearTimeout(r.runoutTimer); r.runoutTimer = null; }
}

/* ── HELPERS ────────────────────────────────────── */
const activeP    = r => r.players.filter(p => p.active && p.connected);
const inHandP    = r => r.players.filter(p => p.active && !p.folded);
const canActP    = r => r.players.filter(p => p.active && !p.folded && !p.allIn);

function nextSeat(r, from, filterFn = p => p.active && p.connected) {
  const n = r.players.length;
  if (n === 0) return 0;
  let i = (from + 1) % n, t = 0;
  while (t++ < n) {
    if (filterFn(r.players[i])) return i;
    i = (i + 1) % n;
  }
  return from;
}

function nextAct(r, from) {
  const n = r.players.length;
  if (n === 0) return 0;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n, p = r.players[i];
    if (p.active && !p.folded && !p.allIn) return i;
  }
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n, p = r.players[i];
    if (p.active && !p.folded) return i;
  }
  return from;
}

function postBlind(r, idx, amt) {
  const p = r.players[idx];
  if (!p) return 0;
  const a = Math.min(amt, p.chips);
  p.chips -= a; p.bet += a; p.totalBet += a; r.pot += a;
  if (p.chips === 0) p.allIn = true;
  return a;
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

/* ── UNCALLED BET REFUND ────────────────────────── */
function refundUncalledBet(r) {
  const inHand = inHandP(r);
  if (inHand.length === 0) return;

  const sortedInHand = [...inHand].sort((a, b) => b.totalBet - a.totalBet);
  const highest = sortedInHand[0];
  if (!highest || highest.totalBet <= 0) return;

  // Maximum bet contributed by ANY other player (including those who folded)
  let maxOtherBet = 0;
  for (const p of r.players) {
    if (p !== highest && p.totalBet > maxOtherBet) {
      maxOtherBet = p.totalBet;
    }
  }

  const uncalled = highest.totalBet - maxOtherBet;
  if (uncalled > 0) {
    highest.chips += uncalled;
    highest.totalBet -= uncalled;
    highest.bet = Math.max(0, highest.bet - uncalled);
    r.pot = Math.max(0, r.pot - uncalled);
    msg(r, `↩️ $${uncalled} uncalled bet returned to ${highest.name}`);
  }
}

/* ── STREET ADVANCE & RUNOUT ────────────────────── */
function resetStreet(r) {
  refundUncalledBet(r);
  for (const p of r.players) { p.bet = 0; p.acted = false; p.canRaise = true; p.lastAct = null; }
  r.roundBet = 0;
  r.lastRaise = r.cfg.bb;
}

function dealNextStreet(r) {
  if (r.board.length < 3) {
    r.board.push(r.deck.pop(), r.deck.pop(), r.deck.pop());
    r.phase = 'flop';
    msg(r, `🌊 FLOP: [ ${fmtCards(r.board)} ] — Pot: $${r.pot}`);
  } else if (r.board.length === 3) {
    const turnCard = r.deck.pop();
    r.board.push(turnCard);
    r.phase = 'turn';
    msg(r, `↩️ TURN: [ ${fmtCard(turnCard)} ] — Board: [ ${fmtCards(r.board)} ] — Pot: $${r.pot}`);
  } else if (r.board.length === 4) {
    const riverCard = r.deck.pop();
    r.board.push(riverCard);
    r.phase = 'river';
    msg(r, `🏞️ RIVER: [ ${fmtCard(riverCard)} ] — Board: [ ${fmtCards(r.board)} ] — Pot: $${r.pot}`);
  }
}

function advanceStreet(r) {
  resetStreet(r);
  const first = nextAct(r, r.dealerIdx);

  if (r.phase === 'river' || r.board.length >= 5) {
    r.phase = 'showdown';
    doShowdown(r);
    return;
  }

  dealNextStreet(r);

  if (canActP(r).length <= 1) {
    startRunout(r);
    return;
  }
  r.curIdx = first;
  startTurnTimer(r);
}

function startRunout(r) {
  clearTurnTimer(r);
  clearRunoutTimer(r);
  resetStreet(r);

  // Reveal hole cards for active contenders in all-in showdown sweat
  r.showAllInHole = true;
  broadcast(r);

  // If river is already dealt (5 cards), brief pause then showdown
  if (r.board.length >= 5) {
    r.runoutTimer = setTimeout(guard(() => {
      r.runoutTimer = null;
      r.phase = 'showdown';
      broadcast(r);
      doShowdown(r);
    }), RUNOUT_DELAY_MS);
    return;
  }

  // Otherwise, deal the next street after delay
  r.runoutTimer = setTimeout(guard(() => {
    r.runoutTimer = null;
    stepRunout(r);
  }), RUNOUT_DELAY_MS);
}

function stepRunout(r) {
  clearRunoutTimer(r);
  if (r.paused) return;
  if (!rooms[r.id] || r.status !== 'playing') return;

  const cont = inHandP(r);
  if (cont.length <= 1) {
    awardPot(r, cont, null);
    return;
  }

  if (r.board.length < 5) {
    dealNextStreet(r);
    broadcast(r);
    r.runoutTimer = setTimeout(guard(() => {
      r.runoutTimer = null;
      stepRunout(r);
    }), RUNOUT_DELAY_MS);
    return;
  }

  // All 5 board cards dealt -> Showdown!
  r.phase = 'showdown';
  broadcast(r);
  doShowdown(r);
}

/* ── SHOWDOWN & POT DISTRIBUTION ────────────────── */
function doShowdown(r) {
  clearTurnTimer(r);
  const cont = inHandP(r);
  if (cont.length <= 1) {
    awardPot(r, cont, null);
    return;
  }

  r.showdownHands = true;
  msg(r, `🏆 SHOWDOWN — Final Board: [ ${fmtCards(r.board)} ]`);

  const ev = cont.map(p => ({ player: p, hand: Hand.solve([...p.hole, ...r.board]) }));
  for (const e of ev) {
    msg(r, `🃏 ${e.player.name}: [ ${fmtCards(e.player.hole)} ] — ${e.hand.descr}`);
  }

  awardPot(r, cont, ev);
}

function pickWinners(candidates, ev) {
  if (!candidates || candidates.length === 0) return [];
  if (!ev) return candidates;
  const hands = candidates.map(p => ev.find(e => e.player === p)?.hand).filter(Boolean);
  if (hands.length === candidates.length && hands.length > 0) {
    try {
      const best = Hand.winners(hands);
      return candidates.filter(p => best.includes(ev.find(e => e.player === p)?.hand));
    } catch { return candidates; }
  }
  return candidates;
}

function distributePotShare(r, tierWinners, tierPot, winningsMap) {
  if (!tierWinners || tierWinners.length === 0 || tierPot <= 0) return;
  const share = Math.floor(tierPot / tierWinners.length);
  const rem   = tierPot - share * tierWinners.length;

  for (const w of tierWinners) {
    winningsMap.set(w, (winningsMap.get(w) || 0) + share);
  }

  if (rem > 0) {
    // Odd chip goes to player closest to left of dealer button
    const n = r.players.length;
    if (n > 0) {
      const sorted = [...tierWinners].sort((a, b) => {
        const idxA = r.players.indexOf(a);
        const idxB = r.players.indexOf(b);
        const distA = ((idxA - (r.dealerIdx + 1)) % n + n) % n;
        const distB = ((idxB - (r.dealerIdx + 1)) % n + n) % n;
        return distA - distB;
      });

      for (let i = 0; i < rem; i++) {
        const lucky = sorted[i % sorted.length];
        if (lucky) winningsMap.set(lucky, (winningsMap.get(lucky) || 0) + 1);
      }
    }
  }
}

function awardPot(r, contenders, ev) {
  clearTurnTimer(r);
  clearRunoutTimer(r);
  if (!contenders || contenders.length === 0) {
    for (const p of r.players) { p.chips += p.totalBet; p.totalBet = 0; p.bet = 0; }
    r.pot = 0; r.phase = 'showdown'; r.showdownHands = false;
    r.result = { winners: [], allHands: null, totalPot: 0 };
    msg(r, '⚠️ Không còn người chơi hợp lệ — hoàn lại tiền cược');
    broadcast(r); scheduleNextHand(r);
    return;
  }

  // CASE 1: All opponents folded (Single Winner - no showdown)
  if (contenders.length === 1) {
    const winner = contenders[0];
    refundUncalledBet(r);
    const total = r.pot;
    winner.chips += total;
    winner.wins = (winner.wins || 0) + 1;

    r.result = {
      winners: [{ name: winner.name, amt: total, hd: null, hole: null }],
      allHands: null,
      totalPot: total,
    };
    r.pot = 0;
    r.phase = 'showdown';
    r.showdownHands = false; // MUCK: Cards hidden when opponents folded!
    msg(r, `🏆 ${winner.name} wins $${total} (all opponents folded)`);
    broadcast(r);

    scheduleNextHand(r);
    return;
  }

  // CASE 2: Showdown with Side Pots & Split Pots
  refundUncalledBet(r);
  const total = r.pot;
  r.showdownHands = true;

  const contributors = r.players.filter(p => p.totalBet > 0).map(p => ({
    player: p,
    remaining: p.totalBet,
  }));

  const winningsMap = new Map();
  for (const p of contenders) winningsMap.set(p, 0);

  while (contributors.some(c => c.remaining > 0)) {
    const activeContendersWithChips = contributors.filter(c => contenders.includes(c.player) && c.remaining > 0);
    let minBet = 0;
    if (activeContendersWithChips.length > 0) {
      minBet = Math.min(...activeContendersWithChips.map(c => c.remaining));
    } else {
      const remainingPos = contributors.filter(c => c.remaining > 0);
      minBet = Math.min(...remainingPos.map(c => c.remaining));
    }

    if (minBet <= 0) break;

    let tierPot = 0;
    const tierEligible = [];
    for (const c of contributors) {
      if (c.remaining > 0) {
        const take = Math.min(c.remaining, minBet);
        tierPot += take;
        c.remaining -= take;
        if (contenders.includes(c.player)) {
          tierEligible.push(c.player);
        }
      }
    }

    if (tierPot <= 0) continue;

    if (tierEligible.length === 0) {
      // Dead money from folded players: award to best overall hand
      const top = pickWinners(contenders, ev);
      distributePotShare(r, top, tierPot, winningsMap);
      continue;
    }

    const tierWinners = pickWinners(tierEligible, ev);
    distributePotShare(r, tierWinners, tierPot, winningsMap);
  }

  // Fallback: If pot has remainder not covered by totalBet (e.g. manual pot injection)
  let distributed = 0;
  for (const amt of winningsMap.values()) distributed += amt;
  const undistributed = total - distributed;
  if (undistributed > 0) {
    const top = pickWinners(contenders, ev);
    distributePotShare(r, top, undistributed, winningsMap);
  }

  const wr = [];
  for (const [p, amt] of winningsMap.entries()) {
    if (amt > 0) {
      p.chips += amt;
      p.wins = (p.wins || 0) + 1;
      const hd = ev?.find(e => e.player === p)?.hand.descr || null;
      wr.push({ name: p.name, amt, hd, hole: p.hole });
      msg(r, `🏆 ${p.name} wins $${amt}${hd ? ` with ${hd}` : ''} [ ${fmtCards(p.hole)} ]`);
    }
  }

  const ah = ev ? ev.map(e => ({
    name: e.player.name,
    hd: e.hand.descr,
    hole: e.player.hole,
    won: (winningsMap.get(e.player) || 0) > 0,
  })) : [];

  r.result = { winners: wr, allHands: ah, totalPot: total };
  r.pot = 0;
  r.phase = 'showdown';
  broadcast(r);

  scheduleNextHand(r);
}

function scheduleNextHand(r) {
  if (r.nextHandTimer) { clearTimeout(r.nextHandTimer); r.nextHandTimer = null; }
  r.nextHandTimer = setTimeout(guard(() => {
    r.nextHandTimer = null;
    if (rooms[r.id]?.status === 'playing' && !rooms[r.id]?.paused) {
      startHand(r);
    }
  }), 6000);
}

/* ── GAME FLOW ───────────────────────────────────── */
function startGame(r) {
  if (r.players.filter(p => p.connected).length < 2) return 'Need ≥ 2 players';
  if (r.status === 'playing') return 'Already started';
  r.status = 'playing';
  r.handNum = 0;
  r.dealerIdx = 0;
  msg(r, '🎲 Game started!');
  startHand(r);
  return null;
}

function startHand(r) {
  r.handNum++;
  r.deck = mkDeck(); r.board = []; r.pot = 0; r.result = null;
  r.roundBet = 0; r.lastRaise = r.cfg.bb;
  r.showdownHands = false;
  r.showAllInHole = false;
  clearRunoutTimer(r);

  for (const p of r.players) {
    p.hole = []; p.bet = 0; p.totalBet = 0;
    p.folded = false; p.allIn = false; p.acted = false; p.canRaise = true; p.lastAct = null;
    p.graceUsed = false;
    if (p.waitingNextHand && p.chips > 0) {
      p.waitingNextHand = false;
      p.active = true;
    } else {
      p.active = p.chips > 0 && p.connected;
    }
  }

  const act = activeP(r);
  if (act.length < 2) {
    r.status = 'waiting';
    msg(r, '⚠️ Not enough players with chips.');
    broadcast(r);
    return;
  }

  // Dealer rotation: Hand #1 keeps initial dealer; subsequent hands advance clockwise
  if (r.handNum > 1) {
    r.dealerIdx = nextSeat(r, r.dealerIdx);
  } else {
    if (!r.players[r.dealerIdx]?.active) {
      r.dealerIdx = nextSeat(r, r.dealerIdx);
    }
  }

  // Deal hole cards to active players
  for (const p of act) p.hole = [r.deck.pop(), r.deck.pop()];

  // Antes
  if (r.cfg.ante > 0) {
    let tot = 0;
    for (const p of act) tot += postAnte(r, p);
    if (tot) msg(r, `💰 Antes: $${r.cfg.ante} × ${act.length} = $${tot}`);
  }

  // Blinds calculation
  let sbI, bbI;
  if (act.length === 2) {
    // HEADS-UP RULES:
    // Dealer is Small Blind! Other player is Big Blind.
    sbI = r.dealerIdx;
    bbI = nextSeat(r, sbI);
    r.curIdx = sbI; // Dealer (SB) acts first preflop in Heads-Up!
  } else {
    // MULTIWAY (3+ players):
    sbI = nextSeat(r, r.dealerIdx);
    bbI = nextSeat(r, sbI);
    r.curIdx = nextAct(r, bbI); // Under the gun acts first preflop!
  }

  postBlind(r, sbI, r.cfg.sb);
  postBlind(r, bbI, r.cfg.bb);
  r.roundBet = Math.max(r.cfg.bb, r.players[bbI].bet);
  r.lastRaise = r.cfg.bb;

  r.phase = 'preflop';
  msg(r, `══════════════════════════════════`);
  msg(r, `🃏 Hand #${r.handNum} — Dealer: ${r.players[r.dealerIdx].name}`);
  msg(r, `Blinds: ${r.players[sbI].name} (SB $${r.cfg.sb}) / ${r.players[bbI].name} (BB $${r.cfg.bb})`);

  const can = canActP(r);
  if (can.length === 0 || (can.length === 1 && can[0].bet >= r.roundBet)) {
    startRunout(r);
    return;
  }
  if (r.players[r.curIdx].allIn) {
    r.curIdx = nextAct(r, r.curIdx);
  }
  startTurnTimer(r);
  broadcast(r);
}

function reopenActionForRaise(r, cur, eff) {
  const isFullRaise = (eff - r.roundBet) >= r.lastRaise;
  if (isFullRaise) {
    r.lastRaise = eff - r.roundBet;
    for (const p of r.players) {
      if (p !== cur && p.active && !p.folded && !p.allIn) {
        p.acted = false;
        p.canRaise = true;
      }
    }
  } else {
    for (const p of r.players) {
      if (p !== cur && p.active && !p.folded && !p.allIn) {
        if (p.bet < eff) {
          p.acted = false;
        }
      }
    }
  }
}

function doAction(r, sid, action, amount) {
  if (r.paused) return 'Game is paused';
  if (r.showAllInHole) return 'All-in runout in progress';
  if (!r.phase || r.phase === 'showdown') return 'No active hand';
  const cur = r.players[r.curIdx];
  if (!cur || cur.sid !== sid) return 'Not your turn';
  if (cur.folded || cur.allIn)  return 'Cannot act';

  const toCall = r.roundBet - cur.bet;

  switch (action) {
    case 'fold':
      cur.folded = true; cur.acted = true; cur.canRaise = false; cur.lastAct = 'FOLD';
      msg(r, `❌ ${cur.name} folds`);
      break;

    case 'check':
      if (toCall > 0) return `Can't check — must call $${toCall}`;
      cur.acted = true; cur.canRaise = false; cur.lastAct = 'CHECK';
      msg(r, `✓ ${cur.name} checks`);
      break;

    case 'call': {
      if (toCall <= 0) return 'Nothing to call';
      const a = Math.min(toCall, cur.chips);
      cur.chips -= a; cur.bet += a; cur.totalBet += a; r.pot += a;
      cur.acted = true; cur.canRaise = false;
      if (cur.chips === 0) {
        cur.allIn = true; cur.lastAct = 'ALL IN';
        msg(r, `💥 ${cur.name} calls $${a} ALL IN — Pot: $${r.pot}`);
      } else {
        cur.lastAct = 'CALL'; msg(r, `📞 ${cur.name} calls $${a} (Total bet: $${cur.bet}) — Pot: $${r.pot}`);
      }
      break;
    }

    case 'raise': {
      const opponentsWithChips = r.players.filter(p => p !== cur && p.active && !p.folded && p.chips > 0);
      if (opponentsWithChips.length === 0) return 'Cannot raise — all opponents are all-in';

      // Enforce incomplete raise rule: action not reopened for players who already acted
      if (cur.canRaise === false) return 'Cannot raise — action was not reopened by a full raise';

      const tot = Math.floor(Number(amount));
      if (!Number.isFinite(tot) || isNaN(tot) || tot <= 0) return 'Invalid amount';

      const minR = r.roundBet + r.lastRaise;
      const maxT = cur.chips + cur.bet;
      const goAI = tot >= maxT;
      const eff  = goAI ? maxT : tot;

      if (!goAI && eff < minR) return `Min raise to $${minR}`;
      if (eff <= r.roundBet) return 'Must exceed current bet';
      const add = eff - cur.bet;
      if (add > cur.chips) return 'Not enough chips';

      reopenActionForRaise(r, cur, eff);

      cur.chips -= add; cur.bet += add; cur.totalBet += add; r.pot += add; r.roundBet = eff;
      cur.acted = true;
      cur.canRaise = false;

      if (cur.chips === 0) {
        cur.allIn = true; cur.lastAct = 'ALL IN';
        msg(r, `💥 ${cur.name} raises to $${eff} ALL IN (+$${add}) — Pot: $${r.pot}`);
      } else {
        cur.lastAct = `RAISE $${eff}`; msg(r, `🔺 ${cur.name} raises to $${eff} (+$${add}) — Pot: $${r.pot}`);
      }
      break;
    }

    case 'allin': {
      const chips = cur.chips;
      if (chips <= 0) return 'No chips';
      const newTot = cur.bet + chips;

      if (newTot > r.roundBet && cur.canRaise === false) {
        return 'Cannot raise — action was not reopened (chỉ được call hoặc fold)';
      }

      if (newTot > r.roundBet) {
        reopenActionForRaise(r, cur, newTot);
        r.roundBet = newTot;
      }

      cur.bet += chips; cur.totalBet += chips; r.pot += chips; cur.chips = 0;
      cur.allIn = true; cur.acted = true; cur.canRaise = false; cur.lastAct = 'ALL IN';
      msg(r, `💥 ${cur.name} goes ALL IN with $${chips} (Total bet: $${newTot}) — Pot: $${r.pot}`);
      break;
    }

    default: return 'Unknown action';
  }

  clearTurnTimer(r);

  const ih = inHandP(r);
  if (ih.length <= 1) {
    awardPot(r, ih, null);
    broadcast(r);
    return null;
  }

  if (bettingDone(r)) advanceStreet(r);
  else advancePlayer(r);

  broadcast(r);
  return null;
}

function destroyRoom(rid) {
  const r = rooms[rid];
  if (!r) return;

  clearTurnTimer(r);
  clearRunoutTimer(r);
  if (r.nextHandTimer) { clearTimeout(r.nextHandTimer); r.nextHandTimer = null; }
  if (r.roomDestroyTimer) { clearTimeout(r.roomDestroyTimer); r.roomDestroyTimer = null; }

  for (const p of r.players) {
    if (p.disconnectTimer) {
      clearTimeout(p.disconnectTimer);
      p.disconnectTimer = null;
    }
  }

  for (const sid in sock2room) {
    if (sock2room[sid] === rid) {
      delete sock2room[sid];
    }
  }

  delete rooms[rid];
  console.log(`[x] Room ${rid} completely cleaned up and destroyed.`);
}

const DISCONNECT_GRACE_MS = () => (server && server.listening && process.env.NODE_ENV !== 'test') ? 25000 : 0;

function foldDisconnected(r, p, sid) {
  p.folded = true;
  const ih = inHandP(r);
  if (ih.length <= 1) {
    clearTurnTimer(r);
    clearRunoutTimer(r);
    awardPot(r, ih, null);
  } else {
    const isCur = r.players[r.curIdx]?.sid === (sid || p.sid);
    if (isCur) {
      clearTurnTimer(r);
      if (bettingDone(r)) advanceStreet(r);
      else advancePlayer(r);
    } else if (bettingDone(r)) {
      clearTurnTimer(r);
      advanceStreet(r);
    }
  }
}

function handleDisconnect(sid) {
  const rid = sock2room[sid];
  delete sock2room[sid];
  const r = rid && rooms[rid];
  if (!r) return;
  const p = r.players.find(pl => pl.sid === sid);
  if (!p) return;

  p.connected = false;

  // Pass host if host disconnected
  if (r.hostId === sid) {
    const rem = r.players.filter(pl => pl.connected);
    if (rem.length) {
      r.hostId = rem[0].sid;
      msg(r, `👑 ${rem[0].name} is now host`);
    }
  }

  // If ALL players disconnected, start room destroy timer (60s)
  if (!r.players.some(pl => pl.connected)) {
    if (r.roomDestroyTimer) clearTimeout(r.roomDestroyTimer);
    r.roomDestroyTimer = setTimeout(guard(() => {
      if (rooms[r.id] && !rooms[r.id].players.some(pl => pl.connected)) {
        destroyRoom(r.id);
      }
    }), 60000);
  }

  // If in an active hand
  if (r.status === 'playing' && r.phase && r.phase !== 'showdown' && p.active && !p.folded && !p.allIn) {
    // Only mobile users get a disconnect grace period for app-switching. Desktop disconnects fold immediately.
    const graceMs = (p.isMobile && !p.left && !p.graceUsed) ? DISCONNECT_GRACE_MS() : 0;
    if (graceMs) p.graceUsed = true;
    if (graceMs === 0) {
      msg(r, `⚠️ ${p.name} ${p.left ? 'left the game' : 'disconnected'}`);
      foldDisconnected(r, p, sid);
      broadcast(r);
    } else {
      // Mobile app-switch grace period: silent waiting without spamming reconnect log
      if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
      p.disconnectTimer = setTimeout(guard(() => {
        p.disconnectTimer = null;
        if (!p.connected && r.status === 'playing' && r.phase && r.phase !== 'showdown' && !p.folded) {
          msg(r, `⏱️ ${p.name} disconnected too long — auto folded`);
          foldDisconnected(r, p);
          broadcast(r);
        }
      }), graceMs);
      broadcast(r);
    }
  } else {
    msg(r, `⚠️ ${p.name} disconnected`);
    broadcast(r);
  }
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

    // Block rebuy if currently involved in an active hand before showdown
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

