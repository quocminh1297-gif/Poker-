/* ══════════════════════════════════════════════════
   TEXAS HOLD'EM — Client v4   (PokerNow style)
══════════════════════════════════════════════════ */
const socket = io();
let myId = null, roomId = null, S = null;
let raiseOpen = false, overlayOn = false, logOpen = false, chatOpen = false;
let prevBoardLen = 0;
let timerInterval = null, timerTurnStartMs = null, seatTimerInterval = null;

const SUIT_SYM  = { s:'♠', h:'♥', d:'♦', c:'♣' };
const SUIT_CLS  = { s:'c-s', h:'c-h', d:'c-d', c:'c-c' };

const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

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

/* Opponent seat positions (% of arena) on desktop horizontal table */
const OPP_POS = {
  1:[{t:'14%', l:'50%'}],
  2:[{t:'14%', l:'30%'},{t:'14%', l:'70%'}],
  3:[{t:'14%', l:'20%'},{t:'12%', l:'50%'},{t:'14%', l:'80%'}],
  4:[{t:'24%', l:'12%'},{t:'12%', l:'36%'},{t:'12%', l:'64%'},{t:'24%', l:'88%'}],
  5:[{t:'38%', l:'11%'},{t:'16%', l:'25%'},{t:'11%', l:'50%'},{t:'16%', l:'75%'},{t:'38%', l:'89%'}],
  6:[{t:'48%', l:'11%'},{t:'22%', l:'13%'},{t:'12%', l:'32%'},{t:'12%', l:'68%'},{t:'22%', l:'87%'},{t:'48%', l:'89%'}],
  7:[{t:'52%', l:'11%'},{t:'28%', l:'13%'},{t:'14%', l:'25%'},{t:'10%', l:'42%'},{t:'10%', l:'62%'},{t:'14%', l:'79%'},{t:'28%', l:'87%'}],
  8:[{t:'56%', l:'11%'},{t:'36%', l:'11%'},{t:'18%', l:'17%'},{t:'10%', l:'34%'},{t:'10%', l:'52%'},{t:'10%', l:'70%'},{t:'18%', l:'83%'},{t:'36%', l:'89%'}],
};

window.addEventListener('resize', () => {
  if (S && S.status === 'playing') renderGame(S);
});

socket.on('connect', () => { myId = socket.id; });
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
  socket.emit('create_room', {
    name,
    chips: +document.getElementById('c-chips').value || 100000,
    sb:    +document.getElementById('c-sb').value    || 2000,
    bb:    +document.getElementById('c-bb').value    || 4000,
    ante:  +document.getElementById('c-ante').value  || 0,
    maxP:  +document.getElementById('c-max').value   || 9,
  }, r => { if (r.err) lerr(r.err); });
}
function joinRoom() {
  const name = document.getElementById('j-name').value.trim();
  const code = document.getElementById('j-code').value.trim().toUpperCase();
  if (!name) return lerr('Enter your name');
  if (!code) return lerr('Enter room code');
  socket.emit('join_room', { name, id: code }, r => { if (r.err) lerr(r.err); });
}
function lerr(m) {
  const e = document.getElementById('lobby-err');
  e.textContent = m; setTimeout(() => e.textContent='', 3500);
}

/* ─── WAITING ─── */
function renderWait(st) {
  document.getElementById('w-code').textContent = st.id;
  const isHost = st.hostId === socket.id;
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
    li.innerHTML = `<div class="w-av ac${i%9}">${p.name[0].toUpperCase()}</div>
      <span>${p.name}${p.isMe?' <em style="color:var(--txt3)">(you)</em>':''}</span>
      ${p.sid===st.hostId?'<span>👑</span>':''}
      ${p.wins?`<span style="margin-left:auto;color:var(--gold);font-size:.68rem">🏆×${p.wins}</span>`:''}`;
    ul.appendChild(li);
  });
  document.getElementById('w-count').textContent = st.players.length;
}
function copyCode() {
  navigator.clipboard.writeText(roomId||'').then(() => {
    const b = document.querySelector('.w-copy');
    b.textContent='✅ Copied!'; setTimeout(()=>b.textContent='📋 Copy',1500);
  });
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
    pauseBtn.style.display = (st.hostId === socket.id) ? '' : 'none';
    pauseBtn.textContent = st.paused ? '▶ RESUME' : '⏸ PAUSE';
    pauseBtn.style.borderColor = st.paused ? '#43a047' : '';
    pauseBtn.style.color = st.paused ? '#68d391' : '';
  }

  /* Pause overlay */
  const pauseOv = document.getElementById('pause-overlay');
  if (pauseOv) pauseOv.classList.toggle('hidden', !st.paused);

  /* Pot on felt */
  const fpEl = document.getElementById('pot-on-felt');
  if (st.pot > 0) { fpEl.textContent = '$'+fmt(st.pot); fpEl.classList.add('show'); }
  else fpEl.classList.remove('show');

  /* Board */
  renderBoard(st);

  /* Seats */
  const me   = st.players.find(p => p.isMe);
  const opps = st.players.filter(p => !p.isMe);
  renderSeats(st, opps);
  renderMyArea(st, me);
  renderActions(st, me);
  updateTimer(st);
  renderLog(st.msgs);

  /* Winner overlay */
  if (st.phase==='showdown' && st.result) showWin(st.result);
  else if (st.phase!=='showdown') hideWin();

  prevBoardLen = st.board.length;
}

/* ─── BOARD ─── */
function renderBoard(st) {
  const el = document.getElementById('board');
  el.innerHTML = '';
  for (let i=0; i<5; i++) {
    if (st.board[i]) {
      const isNew = i >= prevBoardLen;
      const anim  = isNew ? (i<3 ? 'anim-flip' : 'anim-deal') : '';
      const delay = isNew ? i*0.08 : 0;
      el.appendChild(mkCard(st.board[i], anim, delay, false));
    } else {
      const ph = document.createElement('div');
      ph.className = 'card-ph'; el.appendChild(ph);
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

/* ─── OPPONENT SEATS (PokerNow: cards left | info right on desktop; vertical on mobile) ─── */
function renderSeats(st, opps) {
  const container = document.getElementById('seats');
  container.innerHTML = '';
  const mobile = isMobile();
  const posSource = mobile ? MOBILE_OPP_POS : OPP_POS;
  const positions = posSource[opps.length] || posSource[Math.min(opps.length, 8)] || [];

  opps.forEach((p, i) => {
    const gIdx     = st.players.findIndex(pl => pl.sid === p.sid);
    const isTurn   = st.curIdx === gIdx && !p.folded && !p.allIn;
    const isDealer = st.dealerIdx === gIdx;
    const pos      = positions[i] || positions[positions.length - 1];

    const seat = document.createElement('div');
    seat.className = 'seat' + (mobile ? ' seat-mobile' : '');
    seat.style.top  = pos.t;
    seat.style.left = pos.l;

    /* Cards HTML */
    let cardsHtml = '<div class="seat-cards">';
    if (p.hole && p.hole.length > 0 && !p.folded) {
      p.hole.forEach(c => {
        if (!c || c === '??') {
          cardsHtml += '<div class="card card-back"><div class="back-inner"></div></div>';
        } else {
          const rk = c.slice(0, -1), su = c.slice(-1);
          const dr = rk === 'T' ? '10' : rk, sym = SUIT_SYM[su] || su, cls = SUIT_CLS[su] || '';
          cardsHtml += `<div class="card ${cls}"><span class="cr">${dr}</span><span class="cs">${sym}</span></div>`;
        }
      });
    } else {
      // Show empty face-down cards if seat taken
      cardsHtml += '<div class="card card-back"><div class="back-inner"></div></div>';
      cardsHtml += '<div class="card card-back"><div class="back-inner"></div></div>';
    }
    cardsHtml += '</div>';

    /* Chip count badge (green, desktop only) */
    const chipBadge = mobile ? '' : `<div class="seat-chip-count">${fmt(p.chips)}</div>`;

    /* Info-right content */
    let infoRightCls = 'seat-info-right';
    if (isTurn)   infoRightCls += ' is-turn';
    if (p.folded) infoRightCls += ' is-folded';
    if (p.allIn)  infoRightCls += ' is-allin';

    /* Dealer + wins row */
    const dealerHtml = isDealer ? '<div class="dealer-d">D</div>' : '';
    const winsHtml   = p.wins > 0 ? `<span class="wins-badge">🏆×${p.wins}</span>` : '';

    /* Last action badge */
    let actHtml = '';
    if (p.allIn && !p.folded) {
      actHtml = '<div class="seat-act sa-allin">ALL IN</div>';
    } else if (p.lastAct) {
      const key = p.lastAct.toLowerCase().split(' ')[0];
      const acls = {fold:'sa-fold',check:'sa-check',call:'sa-call',raise:'sa-raise',all:'sa-allin',bet:'sa-bet'}[key] || 'sa-raise';
      actHtml = `<div class="seat-act ${acls}">${p.lastAct}</div>`;
    }

    /* Timer bar — at bottom of seat-info-right */
    const timerBar = isTurn && st.turnStartMs
      ? `<div class="seat-timer-bar-wrap"><div class="seat-timer-bar-fill" id="seat-timer-${gIdx}"></div></div>` : '';

    const betCls = (mobile && pos.bet) ? ` ${pos.bet}` : '';

    seat.innerHTML = `
      <div class="seat-inner" style="position:relative">
        <div class="seat-card-wrap" style="position:relative">
          ${cardsHtml}
          ${chipBadge}
        </div>
        <div class="${infoRightCls}">
          <div class="seat-name-row">
            ${dealerHtml}
            <div class="seat-name">${p.folded ? '<s style="opacity:.5">' + p.name + '</s>' : p.name}</div>
            ${winsHtml}
          </div>
          <div class="seat-chips-val">${fmt(p.chips)}</div>
          ${actHtml}
          ${timerBar}
        </div>
      </div>
      ${p.bet > 0 ? `<div class="seat-bet${betCls}">$${fmt(p.bet)}</div>` : ''}
    `;
    container.appendChild(seat);
  });
}

/* ─── MY AREA (Desktop bottom bar & Mobile hero seat) ─── */
function renderMyArea(st, me) {
  if (!me) return;
  const newCards = me.hole.join(',');

  /* 1. Desktop #my-cards in bottom-bar */
  const hcEl = document.getElementById('my-cards');
  if (hcEl && hcEl.dataset.cards !== newCards) {
    hcEl.innerHTML = '';
    hcEl.dataset.cards = newCards;
    me.hole.forEach((c, i) => {
      const card = mkCard(c === '??' ? null : c, 'anim-deal', i * 0.08, false);
      hcEl.appendChild(card);
    });
  }

  /* Hand strength */
  const hsEl = document.getElementById('my-hs');
  if (hsEl) {
    if (st.hs && !me.folded && st.phase !== 'showdown') {
      const cls = hsClass(st.hs), icon = hsIcon(st.hs);
      hsEl.innerHTML = `<div class="hs-badge ${cls}">${icon} ${st.hs}</div>`;
    } else { hsEl.innerHTML = ''; }
  }

  /* Name / chips row for Desktop */
  const gIdx    = st.players.findIndex(p => p.isMe);
  const isTurn  = st.curIdx === gIdx;
  const sbI     = nxtI(st, st.dealerIdx);
  const bbI     = nxtI(st, sbI);
  let badges = '';
  if (st.dealerIdx === gIdx) badges += '<span class="role-badge role-d">D</span>';
  if (gIdx === sbI) badges += '<span class="role-badge role-sb">SB</span>';
  if (gIdx === bbI) badges += '<span class="role-badge role-bb">BB</span>';

  const nrEl = document.getElementById('my-name-row');
  if (nrEl) {
    nrEl.innerHTML =
      `<div class="my-header-row">
         <span class="my-player-name ${isTurn ? 'is-my-turn' : ''}">${me.name}${isTurn ? ' ⚡' : ''}</span>
         ${badges}
         ${me.wins > 0 ? `<span class="my-wins-badge">🏆×${me.wins}</span>` : ''}
       </div>
       <div class="my-chips-row">
         <span class="my-chips-val">$${fmt(me.chips)}</span>
         ${me.bet > 0 ? `<span class="my-bet-pill">BET $${fmt(me.bet)}</span>` : ''}
       </div>`;
  }

  const rebuyBtn = document.getElementById('btn-rebuy');
  if (rebuyBtn) {
    rebuyBtn.style.display = (me && me.chips === 0) ? 'inline-flex' : 'none';
  }

  /* 2. Mobile #my-seat inside #arena (PokerNow style bottom table seat) */
  const mySeatEl = document.getElementById('my-seat');
  if (mySeatEl) {
    let heroCardsHtml = '<div class="seat-cards hero-cards">';
    if (me.hole && me.hole.length > 0 && !me.folded) {
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
    if (st.hs && !me.folded && st.phase !== 'showdown') {
      const cls = hsClass(st.hs), icon = hsIcon(st.hs);
      hsHtml = `<div class="hero-hs-pill ${cls}">${icon} ${st.hs}</div>`;
    }

    let heroInfoCls = 'seat-info-right hero-info';
    if (isTurn)    heroInfoCls += ' is-turn';
    if (me.folded) heroInfoCls += ' is-folded';
    if (me.allIn)  heroInfoCls += ' is-allin';

    const dealerHtml = (st.dealerIdx === gIdx) ? '<div class="dealer-d">D</div>' : '';
    const winsHtml   = me.wins > 0 ? `<span class="wins-badge">🏆×${me.wins}</span>` : '';

    let actHtml = '';
    if (me.allIn && !me.folded) {
      actHtml = '<div class="seat-act sa-allin">ALL IN</div>';
    } else if (me.lastAct) {
      const key = me.lastAct.toLowerCase().split(' ')[0];
      const acls = {fold:'sa-fold',check:'sa-check',call:'sa-call',raise:'sa-raise',all:'sa-allin',bet:'sa-bet'}[key] || 'sa-raise';
      actHtml = `<div class="seat-act ${acls}">${me.lastAct}</div>`;
    }

    const timerBar = isTurn && st.turnStartMs
      ? `<div class="seat-timer-bar-wrap"><div class="seat-timer-bar-fill" id="seat-timer-${gIdx}"></div></div>` : '';

    const betHtml = me.bet > 0 ? `<div class="seat-bet bet-up">$${fmt(me.bet)}</div>` : '';
    const rebuyHtml = (me.chips === 0) ? `<button class="hero-rebuy-btn" onclick="triggerRebuy()">🔄 Rebuy</button>` : '';

    mySeatEl.innerHTML = `
      <div class="seat-inner hero-seat-inner" style="position:relative">
        ${hsHtml}
        <div class="seat-card-wrap hero-card-wrap">
          ${heroCardsHtml}
        </div>
        <div class="${heroInfoCls}">
          <div class="seat-name-row">
            ${dealerHtml}
            <div class="seat-name">${me.folded ? '<s style="opacity:.5">' + me.name + '</s>' : me.name}</div>
            ${winsHtml}
          </div>
          <div class="seat-chips-val">$${fmt(me.chips)}</div>
          ${actHtml}
          ${timerBar}
          ${rebuyHtml}
        </div>
      </div>
      ${betHtml}
    `;
  }
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
  const isMyTurn= cur && cur.sid===socket.id;

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
  const minR   = st.roundBet + (st.lastRaise||st.cfg.bb);
  const maxR   = (me.chips||0) + (me.bet||0);

  /* CALL only visible when there is a bet to call; CHECK only visible otherwise */
  const callBtn  = document.getElementById('b-call');
  const checkBtn = document.getElementById('b-check');
  if (toCall > 0) {
    callBtn.style.display  = '';
    callBtn.textContent    = `CALL $${fmt(toCall)}`;
    callBtn.disabled       = false;
    if (checkBtn) checkBtn.style.display = 'none';
  } else {
    callBtn.style.display  = 'none';
    if (checkBtn) { checkBtn.style.display = ''; checkBtn.disabled = false; }
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
    const target = rb + Math.floor(pot * v);
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

/* ─── TIMER ─── */
function updateTimer(st) {
  const wrap     = document.getElementById('timer-wrap');
  const fill     = document.getElementById('timer-fill');
  const numEl    = document.getElementById('timer-num');
  const ytl      = document.getElementById('your-turn-lbl');
  const me       = st.players.find(p=>p.isMe);
  const gIdx     = st.players.findIndex(p=>p.isMe);
  const isMyTurn = st.curIdx===gIdx;

  if (!st.turnStartMs || st.phase==='showdown' || !me || me.folded || me.allIn || st.paused) {
    if (wrap) wrap.classList.remove('show');
    if (timerInterval) { clearInterval(timerInterval); timerInterval=null; }
    updateSeatTimers(st);
    return;
  }

  if (!isMyTurn) {
    if (wrap) wrap.classList.remove('show');
    if (timerInterval) { clearInterval(timerInterval); timerInterval=null; }
    updateSeatTimers(st);
    return;
  }

  if (wrap) wrap.classList.add('show');
  timerTurnStartMs = st.turnStartMs;
  if (timerInterval) clearInterval(timerInterval);

  function tick() {
    const elapsed   = Date.now() - timerTurnStartMs;
    const secsLeft  = Math.max(0, 30 - Math.floor(elapsed/1000));
    const pct       = (secsLeft/30)*100;
    if (fill) fill.style.width = pct+'%';
    if (numEl) numEl.textContent = secsLeft + 's';
    const warn = secsLeft<=10, danger = secsLeft<=5;
    if (fill)  { fill.classList.toggle('tw', warn&&!danger); fill.classList.toggle('td', danger); }
    if (numEl) { numEl.classList.toggle('tw', warn&&!danger); numEl.classList.toggle('td', danger); }
    if (secsLeft===0) clearInterval(timerInterval);
  }
  tick();
  timerInterval = setInterval(tick, 200);
  updateSeatTimers(st);
}

function updateSeatTimers(st) {
  if (seatTimerInterval) { clearInterval(seatTimerInterval); seatTimerInterval=null; }
  if (!st.turnStartMs) return;
  seatTimerInterval = setInterval(() => {
    const elapsed  = Date.now() - st.turnStartMs;
    const secsLeft = Math.max(0, 30 - elapsed/1000);
    const pct      = (secsLeft/30)*100;
    const el = document.getElementById(`seat-timer-${st.curIdx}`);
    if (el) {
      el.style.width = pct+'%';
      const warn=secsLeft<=10, danger=secsLeft<=5;
      el.className = 'seat-timer-bar-fill'+(danger?' td':warn?' tw':'');
    } else {
      clearInterval(seatTimerInterval); seatTimerInterval=null;
    }
  }, 200);
}

/* ─── LOG ─── */
let lastLogLen = 0;
function renderLog(msgs) {
  if (msgs.length===lastLogLen) return;
  lastLogLen = msgs.length;
  const logBody = document.getElementById('log-body');
  const chatMsgs= document.getElementById('chat-msgs');
  logBody.innerHTML=''; chatMsgs.innerHTML='';
  msgs.forEach(m => {
    const t   = m.t;
    const isW = t.includes('wins')||t.includes('🏆');
    const isH = t.includes('Hand #')||t.includes('FLOP')||t.includes('TURN')||t.includes('RIVER');
    const isC = t.startsWith('💬');
    const cls = isW?'le-win':isH?'le-hand':isC?'le-chat':'';
    const div = document.createElement('div');
    div.className='log-e'+(cls?' '+cls:''); div.textContent=t;
    logBody.appendChild(div);
    if (isC) chatMsgs.appendChild(div.cloneNode(true));
  });
  logBody.scrollTop = 99999;
  chatMsgs.scrollTop= 99999;
}

function toggleLog() {
  logOpen = !logOpen;
  document.getElementById('log-overlay').classList.toggle('hidden', !logOpen);
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

/* ─── WINNER OVERLAY ─── */
let cdTimer = null;
let winShowHandNum = -1;   // track which hand triggered the overlay

function showWin(res) {
  // Allow re-showing if this is a new hand's showdown
  const curHand = S ? S.handNum : -1;
  if (overlayOn && winShowHandNum === curHand) return;
  overlayOn = true;
  winShowHandNum = curHand;

  const ov = document.getElementById('winner-overlay');
  ov.classList.remove('hidden');

  document.getElementById('win-names').textContent = res.winners.map(w=>w.name).join(' & ');
  const descs = [...new Set(res.winners.map(w=>w.hd).filter(Boolean))];
  document.getElementById('win-hand').textContent  = descs.join(' · ');
  const winPotEl = document.getElementById('win-pot');
  if (!res.winners || res.winners.length === 0) {
    winPotEl.innerHTML = '';
  } else if (res.winners.length === 1) {
    winPotEl.innerHTML = `<span class="win-pot-single">+$${fmt(res.winners[0].amt)}</span>`;
  } else {
    winPotEl.innerHTML = `
      <div class="split-pot-grid">
        ${res.winners.map(w => `
          <div class="split-pot-item">
            <span class="sp-name">${w.name}</span>
            <span class="sp-amt">+$${fmt(w.amt)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  const grid = document.getElementById('win-grid');
  grid.innerHTML='';
  (res.allHands||[]).forEach(h => {
    const chip = document.createElement('div');
    chip.className='wg-chip'+(h.won?' won':'');
    const holeHtml = document.createElement('div'); holeHtml.className='wg-hole';
    (h.hole||[]).forEach(c=>holeHtml.appendChild(mkMiniCard(c)));
    chip.innerHTML=`<div class="wg-name">${h.won?'🏆 ':''}${h.name}</div>`;
    chip.appendChild(holeHtml);
    const d=document.createElement('div'); d.className='wg-descr'; d.textContent=h.hd||'';
    chip.appendChild(d);
    grid.appendChild(chip);
  });

  // Auto-dismiss after 6 seconds so next hand can proceed
  let secs=6;
  document.getElementById('cd-num').textContent=secs;
  if (cdTimer) clearInterval(cdTimer);
  cdTimer = setInterval(()=>{
    secs--;
    document.getElementById('cd-num').textContent=Math.max(0,secs);
    if (secs<=0) { clearInterval(cdTimer); hideWin(); }
  },1000);

  /* Confetti */
  const box    = document.getElementById('confetti-box');
  box.innerHTML='';
  const colors = ['#d4a843','#f5c842','#e53935','#43a047','#1e88e5','#8e24aa','#ff6b35'];
  for (let i=0;i<50;i++) {
    const p=document.createElement('div'); p.className='confetti';
    p.style.left=(Math.random()*100)+'vw';
    p.style.background=colors[Math.floor(Math.random()*colors.length)];
    p.style.animationDuration=(2+Math.random()*3)+'s';
    p.style.animationDelay=(Math.random()*2)+'s';
    p.style.width=(6+Math.random()*5)+'px';
    p.style.height=(8+Math.random()*9)+'px';
    box.appendChild(p);
  }
}

function hideWin() {
  if (!overlayOn) return;
  overlayOn=false;
  document.getElementById('winner-overlay').classList.add('hidden');
  document.getElementById('confetti-box').innerHTML='';
  if (cdTimer) { clearInterval(cdTimer); cdTimer=null; }
}

/* ─── HELPERS ─── */
function hsClass(d) {
  if (!d) return '';
  const l=d.toLowerCase();
  if (l.includes('royal'))          return 'hs-royal';
  if (l.includes('straight flush')) return 'hs-sf';
  if (l.includes('four'))           return 'hs-quads';
  if (l.includes('full'))           return 'hs-fh';
  if (l.includes('flush'))          return 'hs-flush';
  if (l.includes('straight'))       return 'hs-str';
  if (l.includes('three'))          return 'hs-trips';
  if (l.includes('two pair'))       return 'hs-2p';
  if (l.includes('pair'))           return 'hs-pair';
  return 'hs-hc';
}
function hsIcon(d) {
  if (!d) return '';
  const l=d.toLowerCase();
  if (l.includes('royal'))          return '👑';
  if (l.includes('straight flush')) return '🔥';
  if (l.includes('four'))           return '🎯';
  if (l.includes('full'))           return '🏠';
  if (l.includes('flush'))          return '♠️';
  if (l.includes('straight'))       return '📏';
  if (l.includes('three'))          return '3️⃣';
  if (l.includes('two pair'))       return '✌️';
  if (l.includes('pair'))           return '👥';
  return '🃏';
}
function fmt(n) {
  if (n==null) return '0';
  if (n>=1000000) return (n/1000000).toFixed(1)+'M';
  if (n>=10000)   return (n/1000).toFixed(0)+'K';
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
  if (!cur||cur.sid!==socket.id) return;
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
