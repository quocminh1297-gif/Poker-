'use strict';

const { randomInt } = require('crypto');
const { Hand } = require('pokersolver');
const { SUITS, RANKS, RANK_NAME } = require('./config');

/* ── DECK ──────────────────────────────────────── */
function mkDeck() {
  const d = SUITS.flatMap(s => RANKS.map(r => r + s));
  for (let i = d.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/* ── FORMAT CARDS ──────────────────────────────── */
const SUIT_UNICODE = { s: '♠', h: '♥', d: '♦', c: '♣' };
function fmtCard(c) {
  if (!c || c === '??') return '??';
  const r = c.slice(0, -1), s = c.slice(-1);
  return `${r === 'T' ? '10' : r}${SUIT_UNICODE[s] || s}`;
}
function fmtCards(arr) {
  if (!arr || !arr.length) return '';
  return arr.map(fmtCard).join(' ');
}

/* ── HAND STRENGTH (pre-board + post-board) ───── */
function handStrength(hole, board) {
  if (!hole || hole.length < 2) return null;
  if (!board || board.length === 0) {
    const r1 = hole[0].slice(0, -1), r2 = hole[1].slice(0, -1);
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

/* ── WINNER SELECTION ──────────────────────────── */
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

/* ── POT DISTRIBUTION ──────────────────────────── */
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

let msgLogger = null;
function setMsgLogger(fn) {
  msgLogger = fn;
}

/* ── UNCALLED BET REFUND ────────────────────────── */
function refundUncalledBet(r) {
  const inHand = inHandP(r);
  if (inHand.length === 0) return;

  const sortedInHand = [...inHand].sort((a, b) => b.totalBet - a.totalBet);
  const highest = sortedInHand[0];
  if (!highest || highest.totalBet <= 0) return;

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
    if (msgLogger) msgLogger(r, `↩️ $${uncalled} uncalled bet returned to ${highest.name}`);
  }
}

/* ── PLAYER PREDICATES & SEAT NAVIGATION ───────── */
const activeP = r => r.players.filter(p => p.active && p.connected);
const inHandP = r => r.players.filter(p => p.active && !p.folded);
const canActP = r => r.players.filter(p => p.active && !p.folded && !p.allIn);

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
    const idx = (from + k) % n;
    const p = r.players[idx];
    if (p && p.active && !p.folded && !p.allIn) return idx;
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

/* ── SANITIZERS ────────────────────────────────── */
function sanitizeCfg(o = {}) {
  const sb    = Math.min(100000000, Math.max(1, Math.floor(Number(o.sb) || 2000)));
  const bb    = Math.min(200000000, Math.max(sb + 1, Math.floor(Number(o.bb) || 4000)));
  const chips = Math.min(10000000000, Math.max(bb * 2, Math.floor(Number(o.chips) || 100000)));
  const ante  = Math.min(50000000, Math.max(0, Math.floor(Number(o.ante) || 0)));
  const maxP  = Math.min(9, Math.max(2, Math.floor(Number(o.maxP) || 9)));
  return { sb, bb, chips, ante, maxP };
}

function sanitizeName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[^\p{L}\p{N}_\- ]/gu, '').trim().slice(0, 16);
}

module.exports = {
  mkDeck,
  fmtCard,
  fmtCards,
  handStrength,
  handStrengthCached,
  hsCache,
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
  sanitizeName,
  setMsgLogger,
};
