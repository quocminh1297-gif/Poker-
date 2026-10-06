'use strict';

const { randomUUID, randomBytes } = require('crypto');
const { Hand } = require('pokersolver');
const {
  TURN_SEC,
  RUNOUT_DELAY_MS,
  DISCONNECT_GRACE_MS,
} = require('./config');
const {
  mkDeck,
  fmtCards,
  handStrengthCached,
  pickWinners,
  distributePotShare,
  refundUncalledBet,
  activeP,
  inHandP,
  canActP,
  nextSeat,
  nextAct,
  postBlind,
  postAnte,
  bettingDone,
  reopenActionForRaise,
  sanitizeCfg,
  setMsgLogger,
} = require('./rules');

/* ── STATE ─────────────────────────────────────── */
const rooms     = Object.create(null);
const sock2room = Object.create(null);

let ioInstance = null;
function setIo(io) {
  ioInstance = io;
}
function getIo() {
  return ioInstance;
}

const guard = fn => (...a) => {
  try { return fn(...a); }
  catch (e) { console.error('[timer]', e); }
};

function msg(r, t) {
  r.msgSeq = (r.msgSeq || 0) + 1;
  r.msgs.push({ id: r.msgSeq, t, ts: Date.now() });
  if (r.msgs.length > 1000) r.msgs.shift();
}
setMsgLogger(msg);

function broadcast(r) {
  const io = getIo();
  if (!io) return;
  for (const p of r.players) {
    if (p.connected) {
      const s = io.sockets.sockets.get(p.sid);
      if (s) s.emit('state', filterState(r, p.sid));
    }
  }
}

function newRoomId() {
  let id;
  do { id = randomBytes(3).toString('hex').toUpperCase(); } while (rooms[id]);
  return id;
}

function createRoom(hostId, o = {}) {
  const id = newRoomId();
  rooms[id] = {
    id, hostId, status: 'waiting',
    cfg: sanitizeCfg(o),
    players: [], dealerIdx: -1, curIdx: -1,
    phase: null, board: [], pot: 0, deck: [],
    roundBet: 0, lastRaise: 0,
    handNum: 0,
    turnTimer: null, turnStartMs: null,
    runoutTimer: null,
    nextHandTimer: null,
    roomDestroyTimer: null,
    showdownHands: false,
    showAllInHole: false,
    result: null,
    msgs: [],
    msgSeq: 0,
    paused: false,
    resumeScheduled: false,
  };
  return id;
}

function addOrReconnectPlayer(rid, sid, name, token, isMobile = false) {
  const r = rooms[rid];
  if (!r) return { err: 'Room not found' };

  // 1) Reconnect ONLY via secret token
  const existing = (typeof token === 'string' && token.length > 0)
    ? r.players.find(p => p.token === token)
    : null;

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
    if (oldSid && oldSid !== sid) delete sock2room[oldSid];

    existing.sid = sid;
    existing.connected = true;
    existing.isMobile = !!isMobile;
    existing.left = false;
    sock2room[sid] = rid;

    if (r.hostId === oldSid) r.hostId = sid;
    return { err: null, player: existing, reconnected: true };
  }

  // 2) Unique name check
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
    left: false,
  };
  r.players.push(player);
  sock2room[sid] = rid;
  return { err: null, player, reconnected: false };
}

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
      name: p.name,
      chips: p.chips,
      bet: p.bet,
      folded: p.folded,
      allIn: p.allIn,
      hole,
      lastAct: p.lastAct,
      connected: p.connected,
      active: p.active,
      waitingNextHand: p.waitingNextHand,
      isMe,
      wins: p.wins || 0,
    };
  });

  const turnMsLeft = (room.showAllInHole || room.phase === 'showdown' || !room.turnStartMs)
    ? null
    : Math.max(0, TURN_SEC * 1000 - (Date.now() - room.turnStartMs));
  const turnStartMs = (room.showAllInHole || room.phase === 'showdown') ? null : (room.turnStartMs || null);

  return {
    id: room.id,
    status: room.status,
    cfg: room.cfg,
    players,
    dealerIdx: room.dealerIdx,
    curIdx: room.curIdx,
    phase: room.phase,
    board: room.board,
    pot: room.pot,
    roundBet: room.roundBet,
    lastRaise: room.lastRaise,
    handNum: room.handNum,
    turnSec: TURN_SEC,
    turnMsLeft,
    turnStartMs,
    showdownHands: room.showdownHands,
    showAllInHole: room.showAllInHole,
    result: room.result,
    msgs: room.msgs.slice(-40),
    msgSeq: room.msgSeq || 0,
    paused: room.paused,
    hs,
  };
}

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

function advancePlayer(r) {
  r.curIdx = nextAct(r, r.curIdx);
  startTurnTimer(r);
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

  if (r.board.length >= 5) {
    r.runoutTimer = setTimeout(guard(() => {
      r.runoutTimer = null;
      r.phase = 'showdown';
      broadcast(r);
      doShowdown(r);
    }), RUNOUT_DELAY_MS);
    return;
  }

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
    if (r.status === 'playing') {
      if (r.paused) {
        r.resumeScheduled = true;
      } else {
        startHand(r);
      }
    }
  }), 7000);
}

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
  r.deck = mkDeck();
  r.board = [];
  r.pot = 0;
  r.result = null;
  r.roundBet = 0;
  r.lastRaise = r.cfg.bb;
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
    r.curIdx = (r.players[sbI].chips < r.cfg.sb) ? bbI : sbI;
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
    const graceMs = (p.isMobile && !p.left && !p.graceUsed) ? DISCONNECT_GRACE_MS() : 0;
    if (graceMs) p.graceUsed = true;
    if (graceMs === 0) {
      msg(r, `⚠️ ${p.name} ${p.left ? 'left the game' : 'disconnected'}`);
      foldDisconnected(r, p, sid);
      broadcast(r);
    } else {
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

module.exports = {
  rooms,
  sock2room,
  setIo,
  getIo,
  guard,
  msg,
  broadcast,
  newRoomId,
  createRoom,
  addOrReconnectPlayer,
  filterState,
  startTurnTimer,
  clearTurnTimer,
  clearRunoutTimer,
  advancePlayer,
  resetStreet,
  dealNextStreet,
  advanceStreet,
  startRunout,
  stepRunout,
  doShowdown,
  awardPot,
  scheduleNextHand,
  startGame,
  startHand,
  doAction,
  destroyRoom,
  foldDisconnected,
  handleDisconnect,
};
