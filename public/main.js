/* ══════════════════════════════════════════════════
   TEXAS HOLD'EM — Client v4   (PokerNow style)
══════════════════════════════════════════════════ */
const socket = io();
let roomId = null, S = null;
let raiseOpen = false, logOpen = false, chatOpen = false;
let prevBoardLen = 0;
let timerRafId = null;

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getAvatarClass(name) {
  if (!name) return 'ac0';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return 'ac' + (hash % 9);
}

const SUIT_SYM  = { s:'♠', h:'♥', d:'♦', c:'♣' };
const SUIT_CLS  = { s:'c-s', h:'c-h', d:'c-d', c:'c-c' };

const isMobile = () => window.matchMedia('(max-width: 768px)').matches || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

/* Opponent seat positions on mobile vertical table (<768px, PokerNow style) */
const MOBILE_OPP_POS = {
  1:[{t:'9%',  l:'50%', bet:'bet-down'}],
  2:[{t:'22%', l:'18%', bet:'bet-right'},{t:'22%', l:'82%', bet:'bet-left'}],
  3:[{t:'44%', l:'14%', bet:'bet-right'},{t:'9%',  l:'50%', bet:'bet-down'},{t:'44%', l:'86%', bet:'bet-left'}],
  4:[{t:'56%', l:'14%', bet:'bet-right'},{t:'22%', l:'18%', bet:'bet-right'},{t:'22%', l:'82%', bet:'bet-left'},{t:'56%', l:'86%', bet:'bet-left'}],
  5:[{t:'64%', l:'14%', bet:'bet-right'},{t:'30%', l:'15%', bet:'bet-right'},{t:'9%',  l:'50%', bet:'bet-down'},{t:'30%', l:'85%', bet:'bet-left'},{t:'64%', l:'86%', bet:'bet-left'}],
  6:[{t:'68%', l:'14%', bet:'bet-right'},{t:'44%', l:'14%', bet:'bet-right'},{t:'18%', l:'22%', bet:'bet-right'},{t:'18%', l:'78%', bet:'bet-left'},{t:'44%', l:'86%', bet:'bet-left'},{t:'68%', l:'86%', bet:'bet-left'}],
  7:[{t:'70%', l:'14%', bet:'bet-right'},{t:'48%', l:'14%', bet:'bet-right'},{t:'25%', l:'15%', bet:'bet-right'},{t:'9%',  l:'50%', bet:'bet-down'},{t:'25%', l:'85%', bet:'bet-left'},{t:'48%', l:'86%', bet:'bet-left'},{t:'70%', l:'86%', bet:'bet-left'}],
  8:[{t:'73%', l:'14%', bet:'bet-right'},{t:'53%', l:'14%', bet:'bet-right'},{t:'33%', l:'14%', bet:'bet-right'},{t:'14%', l:'24%', bet:'bet-right'},{t:'14%', l:'76%', bet:'bet-left'},{t:'33%', l:'86%', bet:'bet-left'},{t:'53%', l:'86%', bet:'bet-left'},{t:'73%', l:'86%', bet:'bet-left'}],
};

/* Pure helper functions for clockwise seat rotation and ellipse geometry */
function rotatePlayersForHero(players) {
  if (!Array.isArray(players) || players.length === 0) return [];
  const heroIdx = players.findIndex(p => p.isMe);
  if (heroIdx <= 0) return [...players];
  return [...players.slice(heroIdx), ...players.slice(0, heroIdx)];
}

function getSeatCoordinates(i, N, cx = 50, cy = 48, rx = 41, ry = 38) {
  if (N <= 0) return { x: cx, y: cy };
  const theta = (90 + (i * 360) / N) * (Math.PI / 180);
  const x = cx + rx * Math.cos(theta);
  const y = cy + ry * Math.sin(theta);
  return {
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
  };
}

function getBetCoordinates(seatPos, cx = 50, cy = 48, t = 0.40) {
  return {
    x: Math.round((seatPos.x + (cx - seatPos.x) * t) * 100) / 100,
    y: Math.round((seatPos.y + (cy - seatPos.y) * t) * 100) / 100,
  };
}

function getDealerCoordinates(i, N, cx = 50, cy = 48, rx = 41, ry = 38, t = 0.22, offsetDeg = 12) {
  if (N <= 0) return { x: cx, y: cy };
  const theta = (90 + (i * 360) / N + offsetDeg) * (Math.PI / 180);
  const x = cx + rx * (1 - t) * Math.cos(theta);
  const y = cy + ry * (1 - t) * Math.sin(theta);
  return {
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
  };
}

window.addEventListener('resize', () => {
  if (S && S.status === 'playing') renderGame(S);
});

const SESSION_KEY = 'poker_session_v1';

function saveSession(rId, token, name) {
  if (!rId || !token || !name) return;
  const data = { rId, token, name, ts: Date.now() };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch (e) {}
}

function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data.rId || !data.token || (Date.now() - data.ts > 12 * 3600 * 1000)) {
      clearSession();
      return null;
    }
    return data;
  } catch (e) {
    return null;
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  } catch (e) {}
}

let toastTimer = null;
function showNetToast(msg, duration = 0) {
  if (!isMobile()) return; // Mobile only
  const el = document.getElementById('net-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  if (duration > 0) {
    toastTimer = setTimeout(() => {
      el.classList.add('hidden');
      toastTimer = null;
    }, duration);
  }
}

function hideNetToast() {
  const el = document.getElementById('net-toast');
  if (el && !toastTimer) el.classList.add('hidden');
}

let isReconnecting = false;
function attemptSessionRestore() {
  const session = getSession();
  if (!session || !session.rId || !session.token) return;
  if (!socket.connected) {
    socket.connect();
    return;
  }
  if (isReconnecting) return;
  isReconnecting = true;
  showNetToast('🔄 Đang đồng bộ lại ván chơi...');

  const restoreTimeout = setTimeout(() => { isReconnecting = false; }, 4000);

  socket.emit('join_room', {
    id: session.rId,
    name: session.name,
    token: session.token,
    isMobile: isMobile()
  }, res => {
    clearTimeout(restoreTimeout);
    isReconnecting = false;
    if (res && res.ok) {
      showNetToast('✅ Đã kết nối lại ván chơi', 2000);
      socket.emit('sync_state');
    } else {
      if (res && res.err) {
        console.warn('Session restore failed:', res.err);
        if (res.err === 'Room not found') {
          clearSession();
          showNetToast('⚠️ Phòng chơi đã kết thúc', 3000);
          show('lobby');
        }
      }
    }
  });
}

function leaveRoom() {
  clearSession();
  let done = false;
  const go = () => { if (!done) { done = true; location.reload(); } };
  socket.emit('leave_room', go);
  setTimeout(go, 800);
}
function confirmLeaveRoom() {
  if (confirm('Bạn có chắc muốn rời khỏi phòng chơi này không?')) leaveRoom();
}

socket.on('connect', () => {
  hideNetToast();
  attemptSessionRestore();
});
socket.on('disconnect', () => {
  if (isMobile()) showNetToast('⚠️ Mất kết nối — Đang thử lại...');
});
socket.on('connect_error', () => {
  if (isMobile()) showNetToast('⚠️ Lỗi kết nối — Đang thử lại...');
});

// App-switch and tab focus listeners (both desktop and mobile)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (!socket.connected) socket.connect();
    attemptSessionRestore();
  }
});
window.addEventListener('pageshow', () => {
  if (!socket.connected) socket.connect();
  attemptSessionRestore();
});
window.addEventListener('focus', () => {
  attemptSessionRestore();
});
window.addEventListener('online', () => {
  if (!socket.connected) socket.connect();
  attemptSessionRestore();
});

socket.on('state', st => {
  S = st; roomId = st.id;
  if (st.status === 'waiting')  { show('waiting'); renderWait(st); }
  else if (st.status === 'playing') { show('game');    renderGame(st); }
});

/* ─── SCREENS ─── */
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

/* ─── LOBBY ─── */
function switchTab(t) {
  ['c','j'].forEach(x => {
    document.getElementById('tab-'+x).classList.toggle('active', x===t);
    document.getElementById('pan-'+x).classList.toggle('active', x===t);
  });
}
function createRoom() {
  const name = document.getElementById('c-name').value.trim();
  if (!name) return lerr('Enter your name');
  const mob = isMobile();
  socket.emit('create_room', {
    name,
    isMobile: mob,
    chips: +document.getElementById('c-chips').value || 100000,
    sb:    +document.getElementById('c-sb').value    || 2000,
    bb:    +document.getElementById('c-bb').value    || 4000,
    ante:  +document.getElementById('c-ante').value  || 0,
    maxP:  +document.getElementById('c-max').value   || 9,
  }, r => {
    if (r.err) return lerr(r.err);
    if (r.ok) saveSession(r.id, r.token, name);
  });
}
function joinRoom() {
  const name = document.getElementById('j-name').value.trim();
  const code = document.getElementById('j-code').value.trim().toUpperCase();
  if (!name) return lerr('Enter your name');
  if (!code) return lerr('Enter room code');
  const mob = isMobile();
  socket.emit('join_room', { name, id: code, isMobile: mob }, r => {
    if (r.err) return lerr(r.err);
    if (r.ok) saveSession(r.id, r.token, name);
  });
}
function lerr(m) {
  const e = document.getElementById('lobby-err');
  e.textContent = m; setTimeout(() => e.textContent='', 3500);
}

/* ─── WAITING ─── */
function renderWait(st) {
  document.getElementById('w-code').textContent = st.id;
  const isHost = st.players.some(p => p.isMe && p.isHost);
  document.getElementById('btn-start').style.display     = isHost ? '' : 'none';
  document.getElementById('w-cfg-panel').style.display   = isHost ? '' : 'none';
  if (isHost) {
    document.getElementById('w-chips').value = st.cfg.chips;
    document.getElementById('w-sb').value    = st.cfg.sb;
    document.getElementById('w-bb').value    = st.cfg.bb;
    document.getElementById('w-ante').value  = st.cfg.ante;
    document.getElementById('w-max').value   = st.cfg.maxP;
  }
  const ul = document.getElementById('w-players');
  ul.innerHTML = '';
  st.players.forEach((p,i) => {
    const li = document.createElement('li');
    const safeName = escapeHtml(p.name);
    const initial = p.name ? escapeHtml(p.name[0].toUpperCase()) : '?';
    const avCls = getAvatarClass(p.name);
    li.innerHTML = `<div class="w-av ${avCls}">${initial}</div>
      <span>${safeName}${p.isMe?' <em style="color:var(--txt3)">(you)</em>':''}</span>
      ${p.isHost?'<span>👑</span>':''}
      ${p.wins?`<span style="margin-left:auto;color:var(--gold);font-size:.68rem">🏆×${p.wins}</span>`:''}`;
    ul.appendChild(li);
  });
  document.getElementById('w-count').textContent = st.players.length;
}
async function copyCode() {
  const b = document.querySelector('.w-copy');
  const code = roomId || document.getElementById('w-code')?.textContent || '';
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('no clipboard');
    await navigator.clipboard.writeText(code);
  } catch {
    const t = document.createElement('textarea');
    t.value = code;
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
  if (b) {
    b.textContent = '✅ Copied!';
    setTimeout(() => { if (b) b.textContent = '📋 Copy'; }, 1500);
  }
}
function saveCfg() {
  socket.emit('settings', {
    chips: +document.getElementById('w-chips').value,
    sb:    +document.getElementById('w-sb').value,
    bb:    +document.getElementById('w-bb').value,
    ante:  +document.getElementById('w-ante').value,
    maxP:  +document.getElementById('w-max').value,
  }, r => {
    if (r.err) { document.getElementById('w-err').textContent=r.err; setTimeout(()=>document.getElementById('w-err').textContent='',3000); }
  });
}
function startGame() {
  socket.emit('start_game', r => {
    if (r.err) { document.getElementById('w-err').textContent=r.err; setTimeout(()=>document.getElementById('w-err').textContent='',3000); }
  });
}

/* ══════════════════════════════════════════════════
   GAME RENDERING
══════════════════════════════════════════════════ */
function renderGame(st) {
  /* Top bar */
  document.getElementById('g-room').textContent = st.id;
  document.getElementById('pot-val').textContent = '$'+fmt(st.pot);
  const phases = {preflop:'Pre-Flop',flop:'Flop',turn:'Turn',river:'River',showdown:'Showdown'};
  document.getElementById('phase-pill').textContent = phases[st.phase] || '—';
  document.getElementById('tb-info').textContent =
    `Hand #${st.handNum} · SB $${fmt(st.cfg.sb)} / BB $${fmt(st.cfg.bb)}` +
    (st.cfg.ante>0 ? ` / Ante $${fmt(st.cfg.ante)}` : '');

  /* Pause button (host only) */
  const pauseBtn = document.getElementById('tb-pause');
  if (pauseBtn) {
    pauseBtn.style.display = st.players.some(p => p.isMe && p.isHost) ? '' : 'none';
    pauseBtn.textContent = st.paused ? '▶ RESUME' : '⏸ PAUSE';
    pauseBtn.style.borderColor = st.paused ? '#43a047' : '';
    pauseBtn.style.color = st.paused ? '#68d391' : '';
  }

  /* Pause overlay */
  const pauseOv = document.getElementById('pause-overlay');
  if (pauseOv) pauseOv.classList.toggle('hidden', !st.paused);

  /* Felt watermark blinds */
  const wmBlinds = document.getElementById('wm-blinds');
  if (wmBlinds && st.cfg) {
    wmBlinds.textContent = `Blinds $${fmt(st.cfg.sb)} / $${fmt(st.cfg.bb)}`;
  }

  /* Pot on felt */
  const fpEl = document.getElementById('pot-on-felt');
  const betsOnTable = (st.players || []).reduce((sum, p) => sum + (p.bet || 0), 0);
  const mainPot = Math.max(0, (st.pot || 0) - betsOnTable);
  if (fpEl) {
    if (st.pot > 0 || betsOnTable > 0 || (st.phase && st.phase !== 'showdown')) {
      const totalHtml = betsOnTable > 0 ? `<span class="pot-total">total ${fmt(st.pot)}</span>` : '';
      fpEl.innerHTML = `${fmt(mainPot)}${totalHtml}`;
      fpEl.classList.add('show');
    } else {
      fpEl.classList.remove('show');
    }
  }

  /* Board */
  renderBoard(st);

  /* Seats */
  const rotated = rotatePlayersForHero(st.players || []);
  const me   = rotated.find(p => p.isMe);
  renderSeats(st, rotated);
  renderBets(st, rotated);
  renderMyArea(st, me, rotated);
  renderActions(st, me);
  updateTimer(st);
  renderLog(st.msgs);

  /* Showdown countdown */
  updateShowdownCountdown(st);

  prevBoardLen = st.board.length;
}

/* ─── BOARD ─── */
function renderBoard(st) {
  const el = document.getElementById('board');
  if (!el) return;
  el.innerHTML = '';
  const isShowdown = st.phase === 'showdown';
  const win5 = (isShowdown && st.result && Array.isArray(st.result.win5)) ? st.result.win5 : null;

  for (let i = 0; i < 5; i++) {
    if (st.board[i]) {
      const cardStr = st.board[i];
      const isNew = i >= prevBoardLen;
      const anim  = isNew ? (i < 3 ? 'anim-flip' : 'anim-deal') : '';
      const delay = isNew ? i * 0.08 : 0;
      const cardEl = mkCard(cardStr, anim, delay, false);
      if (win5 && win5.length > 0 && !win5.includes(cardStr)) {
        cardEl.classList.add('dim');
      }
      el.appendChild(cardEl);
    } else {
      const ph = document.createElement('div');
      ph.className = 'card-ph';
      el.appendChild(ph);
    }
  }
}

/* ─── CARD MAKER ─── */
function mkCard(str, animCls='', delay=0, mini=false) {
  const el = document.createElement('div');
  if (!str || str==='??') {
    el.className = 'card card-back' + (animCls?' '+animCls:'');
    el.innerHTML = '<div class="back-inner"></div>';
    if (delay) el.style.animationDelay = delay+'s';
    return el;
  }
  const rank = str.slice(0,-1);
  const suit = str.slice(-1);
  const dispR = rank==='T'?'10':rank;
  const sym   = SUIT_SYM[suit] || suit;
  const cls   = SUIT_CLS[suit] || '';
  el.className = `card ${cls}${animCls?' '+animCls:''}`;
  if (delay) el.style.animationDelay = delay+'s';
  el.innerHTML = `<span class="cr">${dispR}</span><span class="cs">${sym}</span>`;
  return el;
}

/* Mini card for win grid */
function mkMiniCard(str) {
  const el = document.createElement('div');
  if (!str||str==='??') {
    el.className='card card-back';
    el.style.cssText='width:22px;height:32px;border-radius:3px';
    el.innerHTML='<div class="back-inner"></div>';
    return el;
  }
  const rank=str.slice(0,-1), suit=str.slice(-1);
  const dispR=rank==='T'?'10':rank, sym=SUIT_SYM[suit]||suit, cls=SUIT_CLS[suit]||'';
  el.className=`card ${cls}`;
  el.style.cssText='width:22px;height:32px;border-radius:3px;position:relative;overflow:hidden';
  const cr=document.createElement('span'); cr.className='cr';
  cr.style.cssText='font-size:10px;top:2px;left:2px;letter-spacing:0';
  cr.textContent=dispR;
  const cs=document.createElement('span'); cs.className='cs';
  cs.style.cssText='font-size:16px;bottom:0px;left:0;right:0;text-align:center';
  cs.textContent=sym;
  el.appendChild(cr); el.appendChild(cs);
  return el;
}

/* ─── OPPONENT SEATS ─── */
function renderSeats(st, rotated) {
  const container = document.getElementById('seats');
  if (!container) return;
  container.innerHTML = '';
  const mobile = isMobile();

  const opps = rotated.filter(p => !p.isMe);
  const N = rotated.length;

  if (mobile) {
    const positions = MOBILE_OPP_POS[opps.length] || MOBILE_OPP_POS[Math.min(opps.length, 8)] || [];
    opps.forEach((p, i) => {
      const gIdx     = st.players.findIndex(pl => pl.pid === p.pid);
      const isTurn   = st.curIdx === gIdx && !p.folded && !p.allIn;
      const isDealer = st.dealerIdx === gIdx;
      const winInfo  = (st.result && Array.isArray(st.result.winners)) ? st.result.winners.find(w => w.pid === p.pid || w.name === p.name) : null;
      const isWinner = Boolean(winInfo);
      const pos      = positions[i] || positions[positions.length - 1];

      const seat = document.createElement('div');
      seat.className = 'seat seat-mobile' + (isTurn ? ' is-turn' : '') + (isWinner ? ' is-winner' : '') + (p.folded ? ' is-folded' : '');
      seat.style.top  = pos.t;
      seat.style.left = pos.l;

      let cardsHtml = '<div class="seat-cards">';
      let handInfo = null;
      if (st.phase === 'showdown' && st.result && Array.isArray(st.result.allHands)) {
        handInfo = st.result.allHands.find(h => h.pid === p.pid || h.name === p.name);
      }
      const holeCards = (handInfo && handInfo.hole && handInfo.hole.length > 0) ? handInfo.hole : p.hole;
      if (holeCards && holeCards.length > 0 && !p.folded) {
        holeCards.forEach(c => {
          if (!c || c === '??') {
            cardsHtml += '<div class="card card-back"><div class="back-inner"></div></div>';
          } else {
            const rk = c.slice(0, -1), su = c.slice(-1);
            const dr = rk === 'T' ? '10' : rk, sym = SUIT_SYM[su] || su, cls = SUIT_CLS[su] || '';
            cardsHtml += `<div class="card ${cls}"><span class="cr">${dr}</span><span class="cs">${sym}</span></div>`;
          }
        });
      } else {
        cardsHtml += '<div class="card card-back"><div class="back-inner"></div></div>';
        cardsHtml += '<div class="card card-back"><div class="back-inner"></div></div>';
      }
      cardsHtml += '</div>';

      let hsPillHtml = '';
      if (handInfo && handInfo.hd && !p.folded) {
        const shortLbl = shortenHandLabel(handInfo.hd);
        if (shortLbl) {
          hsPillHtml = `<div class="seat-hs-pill ${getHandPillClass(shortLbl)}">${shortLbl}</div>`;
        }
      }

      const winsHtml   = p.wins > 0 ? `<span class="wins-badge">🏆×${p.wins}</span>` : '';
      const dealerHtml = isDealer ? '<div class="dealer-d">D</div>' : '';
      const winPlusHtml = winInfo ? `<span class="win-plus-pill">+${fmt(winInfo.amt)}</span>` : '';
      const timerBar = isTurn && (st.turnMsLeft != null || st.turnStartMs)
        ? `<div class="seat-timer-bar-wrap"><div class="seat-timer-bar-fill" id="seat-timer-${gIdx}"></div></div>` : '';
      const betCls = pos.bet ? ` ${pos.bet}` : '';

      seat.innerHTML = `
        <div class="seat-inner" style="position:relative">
          <div class="seat-card-wrap" style="position:relative">
            ${cardsHtml}
            ${hsPillHtml}
          </div>
          <div class="seat-info-right${isTurn ? ' is-turn' : ''}${p.folded ? ' is-folded' : ''}">
            <div class="seat-name-row">
              ${dealerHtml}
              <div class="seat-name">${p.folded ? '<s style="opacity:.5">' + escapeHtml(p.name) + '</s>' : escapeHtml(p.name)}</div>
              ${winsHtml}
            </div>
            <div class="seat-chips-val">${(p.allIn ? 'All In' : fmt(p.chips)) + winPlusHtml}</div>
            ${timerBar}
          </div>
        </div>
        ${p.bet > 0 ? `<div class="seat-bet${betCls}">$${fmt(p.bet)}</div>` : ''}
      `;
      container.appendChild(seat);
    });
    return;
  }

  // Desktop renderSeats: parameterized ellipse geometry
  opps.forEach(p => {
    const seatIdxInRotated = rotated.indexOf(p);
    const gIdx     = st.players.findIndex(pl => pl.pid === p.pid);
    const isTurn   = st.curIdx === gIdx && !p.folded && !p.allIn;
    const winInfo  = (st.result && Array.isArray(st.result.winners)) ? st.result.winners.find(w => w.pid === p.pid || w.name === p.name) : null;
    const isWinner = Boolean(winInfo);
    const pos      = getSeatCoordinates(seatIdxInRotated, N);

    const seat = document.createElement('div');
    seat.className = 'seat';
    if (isTurn) seat.classList.add('is-turn');
    if (isWinner) seat.classList.add('is-winner');
    if (p.folded) seat.classList.add('is-folded');
    if (!p.connected) seat.classList.add('is-offline');
    if (p.waitingNextHand) seat.classList.add('is-waiting');
    seat.style.left = pos.x + '%';
    seat.style.top  = pos.y + '%';

    let leftBlockHtml = '';
    if (p.folded) {
      leftBlockHtml = `
        <div class="seat-fold-icon">
          <span class="fold-x">✕</span>
          <span class="fold-lbl">FOLD${!p.connected ? ' (OFFLINE)' : ''}</span>
        </div>`;
    } else if (p.waitingNextHand) {
      leftBlockHtml = `
        <div class="seat-waiting-icon">
          <span class="wait-arr">➜</span>
          <span class="wait-lbl">IN NEXT HAND</span>
        </div>`;
    } else {
      let cardsHtml = '<div class="seat-cards">';
      let handInfo = null;
      if (st.phase === 'showdown' && st.result && Array.isArray(st.result.allHands)) {
        handInfo = st.result.allHands.find(h => h.pid === p.pid || h.name === p.name);
      }
      const holeCards = (handInfo && handInfo.hole && handInfo.hole.length > 0) ? handInfo.hole : p.hole;
      if (holeCards && holeCards.length > 0) {
        holeCards.forEach(c => {
          if (!c || c === '??') {
            cardsHtml += '<div class="card card-back"><div class="back-inner"></div></div>';
          } else {
            const rk = c.slice(0, -1), su = c.slice(-1);
            const dr = rk === 'T' ? '10' : rk, sym = SUIT_SYM[su] || su, cls = SUIT_CLS[su] || '';
            cardsHtml += `<div class="card ${cls}"><span class="cr">${dr}</span><span class="cs">${sym}</span></div>`;
          }
        });
      } else {
        cardsHtml += '<div class="card card-back"><div class="back-inner"></div></div>';
        cardsHtml += '<div class="card card-back"><div class="back-inner"></div></div>';
      }
      cardsHtml += '</div>';

      let hsPillHtml = '';
      if (handInfo && handInfo.hd) {
        const shortLbl = shortenHandLabel(handInfo.hd);
        if (shortLbl) {
          hsPillHtml = `<div class="seat-hs-pill ${getHandPillClass(shortLbl)}">${shortLbl}</div>`;
        }
      }

      const offlineBadge = !p.connected ? '<div class="seat-offline-badge">OFFLINE</div>' : '';
      leftBlockHtml = `
        <div class="seat-card-wrap">
          ${cardsHtml}
          ${hsPillHtml}
          ${offlineBadge}
        </div>`;
    }

    const winsHtml   = p.wins > 0 ? `<span class="seat-badge-wins">🏆 ${p.wins}</span>` : '';
    const rebuysHtml = p.rebuys > 0 ? `<span class="seat-badge-rebuys">🔄 ${p.rebuys}</span>` : '';
    const winPlusHtml = winInfo ? `<span class="win-plus-pill">+${fmt(winInfo.amt)}</span>` : '';
    const chipsDisplay = (p.allIn ? 'All In' : fmt(p.chips)) + winPlusHtml;
    const timerBar = isTurn && (st.turnMsLeft != null || st.turnStartMs)
      ? `<div class="seat-timer-bar-wrap"><div class="seat-timer-bar-fill" id="seat-timer-${gIdx}"></div></div>` : '';

    seat.innerHTML = `
      <div class="seat-inner">
        ${leftBlockHtml}
        <div class="seat-info-box">
          <div class="seat-badges">
            ${winsHtml}
            ${rebuysHtml}
          </div>
          <div class="seat-name">${escapeHtml(p.name)}</div>
          <div class="seat-chips">${chipsDisplay}</div>
          ${timerBar}
        </div>
      </div>
    `;
    container.appendChild(seat);
  });
}

/* ─── INWARD BET CHIPS & DEALER PUCK ON FELT (Desktop) ─── */
function renderBets(st, rotated) {
  const container = document.getElementById('bets');
  if (!container) return;
  if (isMobile()) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = '';
  const N = rotated.length;
  if (N === 0) return;

  // 1. Inward bet chips on felt
  rotated.forEach((p, i) => {
    if (p.bet > 0) {
      const sPos = getSeatCoordinates(i, N);
      const bPos = getBetCoordinates(sPos);
      const chip = document.createElement('div');
      chip.className = 'felt-bet-chip';
      chip.style.left = bPos.x + '%';
      chip.style.top  = bPos.y + '%';
      chip.textContent = fmt(p.bet);
      container.appendChild(chip);
    }
  });

  // 2. Dealer puck on felt edge
  const dealerSeatIdx = rotated.findIndex(p => {
    const origIdx = st.players.indexOf(p);
    return origIdx === st.dealerIdx;
  });
  if (dealerSeatIdx !== -1) {
    const dPos = getDealerCoordinates(dealerSeatIdx, N);
    const dBtn = document.createElement('div');
    dBtn.className = 'felt-dealer-btn';
    dBtn.style.left = dPos.x + '%';
    dBtn.style.top  = dPos.y + '%';
    dBtn.textContent = 'D';
    container.appendChild(dBtn);
  }
}

/* ─── HERO SEAT IN ARENA (#my-seat) ─── */
function renderMyArea(st, me, rotated) {
  const mySeatEl = document.getElementById('my-seat');
  if (!mySeatEl || !me) return;

  const mobile = isMobile();
  const gIdx = st.players.findIndex(p => p.isMe);
  const isTurn = st.curIdx === gIdx && !me.folded && !me.allIn;
  const winInfo = (st.result && Array.isArray(st.result.winners)) ? st.result.winners.find(w => w.pid === me.pid || w.name === me.name) : null;
  const isWinner = Boolean(winInfo);

  // Position #my-seat on desktop
  if (!mobile) {
    const N = (rotated && rotated.length) || st.players.length || 1;
    const pos = getSeatCoordinates(0, N);
    mySeatEl.style.left = pos.x + '%';
    mySeatEl.style.top  = pos.y + '%';
  }

  let heroCardsHtml = `<div class="seat-cards hero-cards${me.folded ? ' is-folded' : ''}">`;
  if (me.hole && me.hole.length > 0) {
    me.hole.forEach(c => {
      if (!c || c === '??') {
        heroCardsHtml += '<div class="card card-back"><div class="back-inner"></div></div>';
      } else {
        const rk = c.slice(0, -1), su = c.slice(-1);
        const dr = rk === 'T' ? '10' : rk, sym = SUIT_SYM[su] || su, cls = SUIT_CLS[su] || '';
        heroCardsHtml += `<div class="card ${cls}"><span class="cr">${dr}</span><span class="cs">${sym}</span></div>`;
      }
    });
  } else {
    heroCardsHtml += '<div class="card card-back"><div class="back-inner"></div></div>';
    heroCardsHtml += '<div class="card card-back"><div class="back-inner"></div></div>';
  }
  heroCardsHtml += '</div>';

  let hsHtml = '';
  if (!me.folded) {
    if (st.phase === 'showdown' && st.result && Array.isArray(st.result.allHands)) {
      const myHand = st.result.allHands.find(h => h.pid === me.pid || h.name === me.name);
      if (myHand && myHand.hd) {
        const shortLbl = shortenHandLabel(myHand.hd);
        if (shortLbl) {
          hsHtml = `<div class="seat-hs-pill ${getHandPillClass(shortLbl)}" id="hero-hs-pill">${shortLbl}</div>`;
        }
      }
    } else if (st.hs && st.phase !== 'showdown') {
      const shortLbl = shortenHandLabel(st.hs);
      if (shortLbl) {
        hsHtml = `<div class="seat-hs-pill ${getHandPillClass(shortLbl)}" id="hero-hs-pill">${shortLbl}</div>`;
      }
    }
  }

  const winsHtml   = me.wins > 0 ? `<span class="seat-badge-wins">🏆 ${me.wins}</span>` : '';
  const rebuysHtml = me.rebuys > 0 ? `<span class="seat-badge-rebuys">🔄 ${me.rebuys}</span>` : '';
  const timerBar   = isTurn && (st.turnMsLeft != null || st.turnStartMs)
    ? `<div class="seat-timer-bar-wrap"><div class="seat-timer-bar-fill" id="seat-timer-${gIdx}"></div></div>` : '';
  const rebuyHtml  = (me.chips === 0) ? `<button class="hero-rebuy-btn" data-click="triggerRebuy">🔄 Rebuy</button>` : '';
  const winPlusHtml = winInfo ? `<span class="win-plus-pill">+${fmt(winInfo.amt)}</span>` : '';
  const betHtml    = (mobile && me.bet > 0) ? `<div class="seat-bet bet-up">$${fmt(me.bet)}</div>` : '';

  mySeatEl.className = 'seat hero-seat' + (isTurn ? ' is-turn' : '') + (isWinner ? ' is-winner' : '') + (me.folded ? ' is-folded' : '');
  mySeatEl.innerHTML = `
    <div class="seat-inner hero-seat-inner" style="position:relative">
      <div class="seat-card-wrap hero-card-wrap" style="position:relative">
        ${heroCardsHtml}
        ${hsHtml}
      </div>
      <div class="seat-info-box hero-info-box${isTurn ? ' is-turn' : ''}${me.folded ? ' is-folded' : ''}">
        <div class="seat-badges">
          ${winsHtml}
          ${rebuysHtml}
        </div>
        <div class="seat-name">${escapeHtml(me.name)}</div>
        <div class="seat-chips">${(me.allIn ? 'All In' : fmt(me.chips)) + winPlusHtml}</div>
        ${timerBar}
        ${rebuyHtml}
      </div>
    </div>
    ${betHtml}
  `;
}

function nxtI(st, from) {
  const n = st.players.length;
  let i = (from+1)%n;
  for (let t=0;t<n;t++) {
    const p=st.players[i];
    if (p.active&&!p.folded&&!p.allIn) return i;
    i=(i+1)%n;
  }
  return (from+1)%n;
}

/* ─── ACTIONS ─── */
function renderActions(st, me) {
  const status  = document.getElementById('act-status');
  const ytl     = document.getElementById('your-turn-lbl');
  const errEl   = document.getElementById('act-err');
  if (errEl) errEl.textContent = '';
  const allBtns = ['b-fold','b-check','b-call','b-raise'];

  if (!me || st.phase==='showdown' || st.paused) {
    allBtns.forEach(id=>{ const b=document.getElementById(id); if(b)b.disabled=true; });
    closeRaise();
    if (ytl) ytl.classList.remove('show');
    if (st.phase==='showdown') { if(status)status.textContent='🏆 Showdown — next hand soon…'; }
    else if (st.paused)        { if(status)status.textContent='⏸️ Paused'; }
    return;
  }

  const cur     = st.players[st.curIdx];
  const isMyTurn= !!(cur && cur.isMe);

  if (!isMyTurn) {
    allBtns.forEach(id=>{ const b=document.getElementById(id); if(b)b.disabled=true; });
    closeRaise();
    if (ytl) ytl.classList.remove('show');
    if (status) status.textContent = `Waiting for ${cur?.name||'…'}`;
    return;
  }

  if (ytl) ytl.classList.add('show');
  if (status) status.textContent = '';
  allBtns.forEach(id=>{ const b=document.getElementById(id); if(b)b.disabled=false; });

  const toCall = st.roundBet - (me.bet||0);
  const actualCallAmt = Math.min(toCall, me.chips || 0);
  const isAllInCall = toCall >= (me.chips || 0);
  const minR   = st.roundBet + (st.lastRaise||st.cfg.bb);
  const maxR   = (me.chips||0) + (me.bet||0);

  const raiseBtn = document.getElementById('b-raise');
  if (raiseBtn) {
    const opponentsWithChips = st.players.filter(p => !p.isMe && p.active && p.connected && !p.folded && p.chips > 0);
    const cannotRaise = me.canRaise === false || opponentsWithChips.length === 0 || (me.chips || 0) <= toCall;
    if (cannotRaise) {
      raiseBtn.disabled = true;
      if (raiseOpen) closeRaise();
    } else {
      raiseBtn.disabled = false;
    }
  }

  const callBtn  = document.getElementById('b-call');
  const checkBtn = document.getElementById('b-check');
  if (isMobile()) {
    if (toCall > 0) {
      callBtn.style.display  = '';
      callBtn.textContent    = isAllInCall ? `ALL IN ${fmt(actualCallAmt)}` : `CALL ${fmt(actualCallAmt)}`;
      callBtn.disabled       = false;
      if (checkBtn) checkBtn.style.display = 'none';
    } else {
      callBtn.style.display  = 'none';
      if (checkBtn) { checkBtn.style.display = ''; checkBtn.disabled = false; }
    }
  } else {
    // Desktop: ALL IN x when call >= chips, CALL / RAISE / CHECK / FOLD in row
    callBtn.style.display = '';
    if (checkBtn) checkBtn.style.display = '';
    if (toCall > 0) {
      callBtn.textContent = isAllInCall ? `ALL IN ${fmt(actualCallAmt)}` : `CALL ${fmt(actualCallAmt)}`;
      callBtn.disabled    = false;
      if (checkBtn) checkBtn.disabled = true;
    } else {
      callBtn.textContent = 'CALL';
      callBtn.disabled    = true;
      if (checkBtn) checkBtn.disabled = false;
    }
  }

  const confirmBtn = document.querySelector('.rp-bet-btn');
  if (confirmBtn) {
    confirmBtn.textContent = (st.roundBet === 0) ? 'BET' : 'RAISE';
  }

  const effMin = Math.min(minR, maxR);
  const ri=document.getElementById('r-input'), rs=document.getElementById('r-slider');
  ri.min=effMin; ri.max=Math.max(effMin, maxR);
  rs.min=effMin; rs.max=Math.max(effMin, maxR);
  const curVal = +ri.value || effMin;
  const clampedVal = Math.min(maxR, Math.max(effMin, curVal));
  ri.value = clampedVal;
  rs.value = clampedVal;
  updateSliderPercent(rs);
  updateRaiseBetDisplay();

  if (me.folded||me.allIn) {
    allBtns.forEach(id=>{ const b=document.getElementById(id); if(b)b.disabled=true; });
    closeRaise();
    if (ytl) ytl.classList.remove('show');
    if (status) status.textContent = me.folded?'You folded':'You are All In';
  }
}

/* ─── RAISE PANEL ─── */
function toggleRaise() { raiseOpen ? closeRaise() : openRaise(); }
function openRaise()  {
  raiseOpen=true;
  document.getElementById('raise-panel').classList.add('open');
  const confirmBtn = document.querySelector('.rp-bet-btn');
  if (confirmBtn && S) {
    confirmBtn.textContent = (S.roundBet === 0) ? 'BET' : 'RAISE';
  }
  /* Set initial min value if blank or out of range */
  const ri = document.getElementById('r-input');
  if (ri && S) {
    const me   = S.players.find(p=>p.isMe);
    const minR = S.roundBet + (S.lastRaise||S.cfg.bb);
    const maxR = (me?.chips||0) + (me?.bet||0);
    const effMin = Math.min(minR, maxR);
    ri.min = effMin; ri.max = Math.max(effMin, maxR);
    let initVal = +ri.value;
    if (!initVal || initVal < effMin || initVal > maxR) initVal = effMin;
    ri.value = initVal;
    const sl = document.getElementById('r-slider');
    if (sl) {
      sl.min = effMin;
      sl.max = Math.max(effMin, maxR);
      sl.value = initVal;
      updateSliderPercent(sl);
    }
  }
  updateRaiseBetDisplay();
  setTimeout(() => { const ri=document.getElementById('r-input'); ri&&ri.focus(); }, 80);
}
function closeRaise() {
  raiseOpen=false;
  document.getElementById('raise-panel').classList.remove('open');
}
function syncInput()  {
  const s=document.getElementById('r-slider'), i=document.getElementById('r-input');
  i.value=s.value;
  updateSliderPercent(s);
  updateRaiseBetDisplay();
}
function syncSlider() {
  const i=document.getElementById('r-input'), s=document.getElementById('r-slider');
  s.value=i.value;
  updateSliderPercent(s);
  updateRaiseBetDisplay();
}
function updateSliderPercent(sl) {
  const min=+sl.min||0, max=+sl.max||1, val=+sl.value||0;
  const pct = max>min ? ((val-min)/(max-min)*100).toFixed(1)+'%' : '0%';
  sl.style.setProperty('--pct', pct);
}
function updateRaiseBetDisplay() {
  if (!S) return;
  const ri  = document.getElementById('r-input');
  const val = ri ? (+ri.value || 0) : 0;
  const bb  = S.cfg.bb || 1;
  const elbb= document.getElementById('rp-bet-bb');
  if (elbb) elbb.textContent = (val/bb).toFixed(1)+'BB';
}
function adjustRaise(dir) {
  if (!S) return;
  const me = S.players.find(p=>p.isMe);
  const minR = S.roundBet + (S.lastRaise||S.cfg.bb);
  const maxR = (me?.chips||0) + (me?.bet||0);
  const effMin = Math.min(minR, maxR);
  const ri=document.getElementById('r-input');
  const step = S.cfg.bb || 1000;
  let cur = +ri.value || effMin;
  let next = cur + dir * step;
  if (next < effMin) next = effMin;
  if (next > maxR)   next = maxR;
  ri.value = next;
  syncSlider();
}

function preset(v) {
  if (!S) return;
  const me   = S.players.find(p=>p.isMe);
  const pot  = S.pot, rb = S.roundBet;
  const minR = rb + (S.lastRaise||S.cfg.bb);
  const maxR = (me?.chips||0) + (me?.bet||0);

  let val;
  if (v === 'min') {
    val = Math.min(minR, maxR);
  } else if (v === 'max') {
    val = maxR;
  } else {
    const toCall = rb - (me?.bet || 0);
    const target = rb + Math.floor((pot + toCall) * v);
    if (maxR <= minR) {
      val = maxR;
    } else {
      val = Math.max(minR, Math.min(maxR, target));
    }
  }

  const ri = document.getElementById('r-input');
  const sl = document.getElementById('r-slider');
  if (ri) ri.value = val;
  if (sl) {
    sl.value = val;
    updateSliderPercent(sl);
  }
  updateRaiseBetDisplay();
}
function confirmRaise() {
  const amt = parseInt(document.getElementById('r-input').value);
  if (!amt) return aerr('Enter amount');
  socket.emit('action',{action:'raise',amount:amt}, r=>{ if(r.err) aerr(r.err); else closeRaise(); });
}
function act(action) {
  closeRaise();
  socket.emit('action',{action}, r=>{ if(r.err) aerr(r.err); });
}
function triggerRebuy() {
  if (confirm('Rebuy starting chips to re-enter the game?')) {
    socket.emit('rebuy', r => {
      if (r && r.err) aerr(r.err);
    });
  }
}
function aerr(m) { const e=document.getElementById('act-err'); e.textContent=m; setTimeout(()=>e.textContent='',3500); }

/* ─── TIMER (Unified RAF Animation) ─── */
function updateTimer(st) {
  if (timerRafId) { cancelAnimationFrame(timerRafId); timerRafId = null; }
  const me = st.players.find(p=>p.isMe);

  if (st.turnMsLeft == null || st.phase === 'showdown' || !me || me.folded || me.allIn || st.paused) {
    const oldSeatTimer = document.querySelector('.seat-timer-bar-fill');
    if (oldSeatTimer) oldSeatTimer.style.width = '0%';
    return;
  }

  const recvAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const total = (st.turnSec || 30) * 1000;

  function loop() {
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const msLeft = Math.max(0, st.turnMsLeft - (now - recvAt));
    const secsLeft = msLeft / 1000;
    const pct = Math.min(100, Math.max(0, (msLeft / total) * 100));
    const warn = secsLeft <= 10, danger = secsLeft <= 5;

    const seatEl = document.getElementById(`seat-timer-${st.curIdx}`);
    if (seatEl) {
      seatEl.style.width = pct + '%';
      seatEl.className = 'seat-timer-bar-fill' + (danger ? ' td' : warn ? ' tw' : '');
    }

    if (msLeft > 0 && !st.paused && S === st) {
      timerRafId = requestAnimationFrame(loop);
    } else {
      timerRafId = null;
    }
  }

  timerRafId = requestAnimationFrame(loop);
}

/* ─── LOG & CARD PARSER ─── */
const SUIT_TO_CLASS = {
  '♠': 'lc-s',
  '♥': 'lc-h',
  '♦': 'lc-d',
  '♣': 'lc-c',
};

function formatLogCards(text) {
  if (!text) return '';
  return text.replace(/\b(10|[2-9TJQKA])([♠♥♦♣])/g, (match, rank, suit) => {
    const cls = SUIT_TO_CLASS[suit] || '';
    return `<span class="log-c ${cls}"><strong>${rank}</strong>${suit}</span>`;
  });
}

let allMsgsCache = [];
let logFilterTerm = '';
let userScrolledLog = false;
let lastRenderedMsgId = 0;

const logBodyEl = document.getElementById('log-body');
if (logBodyEl) {
  logBodyEl.addEventListener('scroll', () => {
    const atBottom = (logBodyEl.scrollHeight - logBodyEl.scrollTop - logBodyEl.clientHeight) < 40;
    userScrolledLog = !atBottom;
  });
}

function onLogFilter(val) {
  logFilterTerm = (val || '').trim().toLowerCase();
  renderFilteredLog();
}

function createLogDiv(m) {
  const t = m.t || '';
  if (t.startsWith('════')) {
    const div = document.createElement('div');
    div.className = 'log-divider';
    return div;
  }

  const isHandHdr  = t.includes('Hand #');
  const isStreet   = t.includes('FLOP') || t.includes('TURN') || t.includes('RIVER');
  const isShowdown = t.includes('SHOWDOWN');
  const isWin      = t.includes('wins') || t.startsWith('🏆');
  const isRaise    = t.includes('raises') || t.includes('ALL IN');
  const isCall     = t.includes('calls');
  const isCheck    = t.includes('checks');
  const isFold     = t.includes('folds');
  const isSys      = t.startsWith('⚠️') || t.startsWith('🚪') || t.startsWith('👑') || t.startsWith('⏱️');
  const isChat     = t.startsWith('💬');

  let cls = '';
  if (isWin) cls = 'le-win';
  else if (isHandHdr) cls = 'le-hand-hdr';
  else if (isStreet) cls = 'le-street';
  else if (isShowdown) cls = 'le-showdown';
  else if (isRaise) cls = 'le-raise';
  else if (isCall) cls = 'le-call';
  else if (isCheck) cls = 'le-check';
  else if (isFold) cls = 'le-fold';
  else if (isSys) cls = 'le-sys';
  else if (isChat) cls = 'le-chat';

  const div = document.createElement('div');
  div.className = 'log-e' + (cls ? ' ' + cls : '');
  div.innerHTML = formatLogCards(escapeHtml(t));
  return div;
}

function renderFilteredLog() {
  const logBody = document.getElementById('log-body');
  if (!logBody) return;

  const baseMsgs = allMsgsCache.filter(m => {
    const txt = m.t || '';
    return !txt.includes('reconnect') && !txt.includes('connection dropped');
  });

  const msgs = logFilterTerm
    ? baseMsgs.filter(m => (m.t || '').toLowerCase().includes(logFilterTerm))
    : baseMsgs;

  let handCount = 0;
  baseMsgs.forEach(m => {
    if (m.t && m.t.includes('Hand #')) handCount++;
  });
  const countEl = document.getElementById('log-count');
  if (countEl) countEl.textContent = `${handCount} ván · ${msgs.length} mục`;

  logBody.innerHTML = '';
  const frag = document.createDocumentFragment();
  msgs.forEach(m => {
    frag.appendChild(createLogDiv(m));
  });
  logBody.appendChild(frag);

  if (!userScrolledLog) {
    logBody.scrollTop = logBody.scrollHeight;
  }
}

function renderLog(msgs) {
  if (!msgs) return;
  allMsgsCache = msgs;

  const chatMsgs = document.getElementById('chat-msgs');
  if (chatMsgs) {
    const chats = msgs.filter(m => m.t && m.t.startsWith('💬'));
    chatMsgs.innerHTML = '';
    chats.forEach(m => {
      const div = document.createElement('div');
      div.className = 'log-e le-chat';
      div.textContent = m.t;
      chatMsgs.appendChild(div);
    });
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
  }

  const logBody = document.getElementById('log-body');
  if (!logBody) return;

  // Incremental append: if not filtering and already has rendered logs
  if (!logFilterTerm && lastRenderedMsgId > 0 && logBody.children.length > 0) {
    const newMsgs = msgs.filter(m => (m.id || 0) > lastRenderedMsgId);
    if (newMsgs.length > 0 && newMsgs.length < msgs.length) {
      const frag = document.createDocumentFragment();
      newMsgs.forEach(m => {
        frag.appendChild(createLogDiv(m));
      });
      logBody.appendChild(frag);
      lastRenderedMsgId = msgs[msgs.length - 1].id || 0;
      if (!userScrolledLog) logBody.scrollTop = logBody.scrollHeight;
      return;
    }
  }

  lastRenderedMsgId = msgs.length ? (msgs[msgs.length - 1].id || 0) : 0;
  renderFilteredLog();
}

function toggleLog() {
  logOpen = !logOpen;
  const overlay = document.getElementById('log-overlay');
  overlay.classList.toggle('hidden', !logOpen);
  if (logOpen) {
    userScrolledLog = false;
    socket.emit('get_log', res => {
      if (res && res.ok && Array.isArray(res.msgs)) {
        allMsgsCache = res.msgs;
        renderFilteredLog();
      }
    });
    const logBody = document.getElementById('log-body');
    if (logBody) logBody.scrollTop = logBody.scrollHeight;
  }
}
function toggleChat() {
  chatOpen = !chatOpen;
  document.getElementById('chat-panel').classList.toggle('open', chatOpen);
}
function togglePause() {
  socket.emit('pause_game', r => {
    if (r.err) { console.warn('Pause err:', r.err); }
  });
}
function sendChat() {
  const inp = document.getElementById('chat-in');
  const t   = inp.value.trim();
  if (!t) return;
  socket.emit('chat',{text:t});
  inp.value='';
}

/* ─── SHOWDOWN COUNTDOWN ─── */
let showdownCdTimer = null;
let lastShowdownHand = -1;

function updateShowdownCountdown(st) {
  const lbl = document.getElementById('next-hand-lbl');
  if (!lbl) return;

  if (st && st.phase === 'showdown' && st.result) {
    lbl.classList.remove('hidden');
    if (lastShowdownHand !== st.handNum) {
      lastShowdownHand = st.handNum;
      if (showdownCdTimer) clearInterval(showdownCdTimer);
      let secs = 7;
      lbl.textContent = `Next hand in ${secs}s`;
      showdownCdTimer = setInterval(() => {
        secs--;
        if (secs <= 0) {
          clearInterval(showdownCdTimer);
          showdownCdTimer = null;
          lbl.textContent = '';
        } else {
          lbl.textContent = `Next hand in ${secs}s`;
        }
      }, 1000);
    }
  } else {
    if (showdownCdTimer) {
      clearInterval(showdownCdTimer);
      showdownCdTimer = null;
    }
    lastShowdownHand = -1;
    lbl.classList.add('hidden');
    lbl.textContent = '';
  }
}

/* ─── HAND RANK FORMATTING & PILLS ─── */
function normalizeHandRank(r) {
  if (!r) return '';
  const upper = r.toUpperCase();
  if (upper === 'ACE') return 'A';
  if (upper === 'KING') return 'K';
  if (upper === 'QUEEN') return 'Q';
  if (upper === 'JACK') return 'J';
  if (upper === 'TEN' || upper === 'T') return '10';
  return upper;
}

function shortenHandLabel(desc) {
  if (!desc || typeof desc !== 'string') return null;
  const s = desc.trim();
  if (!s) return null;

  // Pre-flop representations or invalid
  if (s.startsWith('Pair (') || s.includes('Suited') || s.includes('Offsuit')) {
    return null;
  }
  if (/^Royal\s+Flush/i.test(s)) {
    return 'ROYAL FLUSH';
  }
  if (/^Straight\s+Flush/i.test(s)) {
    return 'STRAIGHT FLUSH';
  }
  const quadsMatch = s.match(/^Four of a Kind,\s*(\d+|[TJQKA]|Ace|King|Queen|Jack)['’]?s/i);
  if (quadsMatch) {
    return `QUADS (${normalizeHandRank(quadsMatch[1])})`;
  }
  if (/^Full\s+House/i.test(s)) {
    return 'FULL HOUSE';
  }
  if (/^Flush/i.test(s)) {
    return 'FLUSH';
  }
  if (/^Straight/i.test(s)) {
    return 'STRAIGHT';
  }
  const tripsMatch = s.match(/^Three of a Kind,\s*(\d+|[TJQKA]|Ace|King|Queen|Jack)['’]?s/i);
  if (tripsMatch) {
    return `TRIPS (${normalizeHandRank(tripsMatch[1])})`;
  }
  const twoPairMatch = s.match(/^Two Pair,\s*(\d+|[TJQKA]|Ace|King|Queen|Jack)['’]?s\s*&\s*(\d+|[TJQKA]|Ace|King|Queen|Jack)['’]?s/i);
  if (twoPairMatch) {
    return `TWO PAIR (${normalizeHandRank(twoPairMatch[1])},${normalizeHandRank(twoPairMatch[2])})`;
  }
  const pairMatch = s.match(/^Pair,\s*(\d+|[TJQKA]|Ace|King|Queen|Jack)['’]?s/i);
  if (pairMatch) {
    return `PAIR (${normalizeHandRank(pairMatch[1])})`;
  }
  const highMatch = s.match(/^(\d+|[TJQKA]|Ace|King|Queen|Jack)\s+High$/i);
  if (highMatch) {
    return `HIGH CARD (${normalizeHandRank(highMatch[1])})`;
  }

  return null;
}

function getHandPillClass(shortLabel) {
  if (!shortLabel) return '';
  if (
    shortLabel === 'FULL HOUSE' ||
    shortLabel.startsWith('QUADS') ||
    shortLabel === 'STRAIGHT FLUSH' ||
    shortLabel === 'ROYAL FLUSH'
  ) {
    return 'pill-indigo';
  }
  return 'pill-coral';
}

/* ─── HELPERS ─── */
const HS_RULES = [
  [/^royal flush/i,    'hs-royal', '👑'],
  [/^straight flush/i, 'hs-sf',    '🔥'],
  [/^four of a kind/i, 'hs-quads', '🎯'],
  [/^full house/i,     'hs-fh',    '🏠'],
  [/^flush/i,          'hs-flush', '♠️'],
  [/^straight/i,       'hs-str',   '📏'],
  [/^three of a kind/i,'hs-trips', '3️⃣'],
  [/^two pair/i,       'hs-2p',    '✌️'],
  [/^pair/i,           'hs-pair',  '👥'],
];
const hsMeta  = d => { const m = HS_RULES.find(([re]) => re.test(d || '')); return m ? { cls: m[1], icon: m[2] } : { cls: 'hs-hc', icon: '🃏' }; };
function hsClass(d) { return hsMeta(d).cls; }
function hsIcon(d) { return hsMeta(d).icon; }
function fmt(n) {
  if (n == null) return '0';
  const f = (v, u) => (+v.toFixed(1)).toString() + u;
  if (n >= 1e6) return f(n / 1e6, 'M');
  if (n >= 1e4) return f(n / 1e3, 'K');
  return n.toLocaleString();
}

/* ─── KEYBOARD SHORTCUTS ─── */
document.addEventListener('keydown', e => {
  const activeTag = document.activeElement.tagName;
  /* ESC closes raise panel / log / chat even while input is focused */
  if (e.key==='Escape' || e.key==='escape') {
    if (raiseOpen) { closeRaise(); e.preventDefault(); return; }
    if (logOpen)   toggleLog();
    if (chatOpen)  toggleChat();
    return;
  }
  /* Enter in raise-input confirms bet */
  if ((e.key==='Enter') && activeTag==='INPUT' && document.activeElement.id==='r-input') {
    confirmRaise(); e.preventDefault(); return;
  }
  if (['INPUT','TEXTAREA'].includes(activeTag)) return;
  if (!S || S.status!=='playing') return;
  const cur = S.players[S.curIdx];
  if (!cur || !cur.isMe) return;
  const me = S.players.find(p=>p.isMe);
  if (!me||me.folded||me.allIn) return;
  const k = e.key.toLowerCase();
  if (k==='f') act('fold');
  if (k==='k') act('check');
  if (k==='c') { const toCall=S.roundBet-(me.bet||0); toCall>0?act('call'):act('check'); }
  if (k==='r') toggleRaise();
  if (k==='a') { preset('max'); openRaise(); }  // all-in via raise panel
  if (k==='enter'&&raiseOpen) confirmRaise();
});

show('lobby');
console.log('🃏 Poker v4 — PokerNow style');

// Auto pre-fill saved name and room code if available, and restore active session if on mobile
if (isMobile()) {
  const existingSession = getSession();
  if (existingSession) {
    if (existingSession.name) {
      const cn = document.getElementById('c-name'); if (cn) cn.value = existingSession.name;
      const jn = document.getElementById('j-name'); if (jn) jn.value = existingSession.name;
    }
    if (existingSession.rId) {
      const jc = document.getElementById('j-code'); if (jc) jc.value = existingSession.rId;
    }
    attemptSessionRestore();
  }
}

/* ─── DECLARATIVE EVENT DELEGATION (CSP Compliant) ─── */
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-click]');
  if (!btn) {
    if (e.target.id === 'log-overlay') toggleLog();
    return;
  }
  const actName = btn.getAttribute('data-click');
  if (actName === 'toggleLog') toggleLog();
  else if (actName === 'switchTab-c') switchTab('c');
  else if (actName === 'switchTab-j') switchTab('j');
  else if (actName === 'createRoom') createRoom();
  else if (actName === 'joinRoom') joinRoom();
  else if (actName === 'copyCode') copyCode();
  else if (actName === 'saveCfg') saveCfg();
  else if (actName === 'leaveRoom') leaveRoom();
  else if (actName === 'startGame') startGame();
  else if (actName === 'togglePause') togglePause();
  else if (actName === 'toggleChat') toggleChat();
  else if (actName === 'confirmLeaveRoom') confirmLeaveRoom();
  else if (actName === 'triggerRebuy') triggerRebuy();
  else if (actName === 'preset-min') preset('min');
  else if (actName === 'preset-0.5') preset(0.5);
  else if (actName === 'preset-0.75') preset(0.75);
  else if (actName === 'preset-1') preset(1);
  else if (actName === 'preset-max') preset('max');
  else if (actName === 'adjustRaise-down') adjustRaise(-1);
  else if (actName === 'adjustRaise-up') adjustRaise(1);
  else if (actName === 'closeRaise') closeRaise();
  else if (actName === 'confirmRaise') confirmRaise();
  else if (actName === 'act-call') act('call');
  else if (actName === 'act-check') act('check');
  else if (actName === 'act-fold') act('fold');
  else if (actName === 'toggleRaise') toggleRaise();
  else if (actName === 'sendChat') sendChat();
});

document.addEventListener('input', e => {
  if (e.target.id === 'log-filter-inp') onLogFilter(e.target.value);
  else if (e.target.id === 'r-input') syncSlider();
  else if (e.target.id === 'r-slider') syncInput();
});

document.addEventListener('keydown', e => {
  if (e.target.id === 'chat-in' && e.key === 'Enter') {
    e.preventDefault();
    sendChat();
  }
});
