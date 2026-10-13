# BÁO CÁO AUDIT KỸ THUẬT — Texas Hold'em Poker (Node.js + Socket.io)

> **Phạm vi:** `server.js`, `public/main.js`, `public/index.html`, `public/style.css`, `package.json`, `package-lock.json`, `.gitignore`.
> **Trạng thái:** chỉ phân tích, chưa sửa code nào.
> **Cách ghi vị trí:** tệp + tên hàm/selector (mã nguồn được gửi dạng đính kèm nên không có số dòng đáng tin cậy).
> **Quy ước mức độ:** P0 = mất tiền ảo/lộ quyền/sập server; P1 = sai luật hoặc treo ván trong tình huống thực tế; P2 = lỗi nhỏ, UX, hiệu năng, hardening.

---

## PHẦN 1: BẢNG DANH MỤC THÀNH PHẦN DƯ THỪA CẦN DỌN DẸP (CLEANUP LIST)

| [Tệp:Vị trí] | Loại dư thừa / Bất cập | Tác động | Hướng xử lý |
|---|---|---|---|
| `package.json` vs `package-lock.json` (root `devDependencies`) | Lockfile có `socket.io-client ^4.8.4` nhưng `package.json` không khai báo | `npm ci` có thể báo lệch đồng bộ; bộ test (nếu có) không cài lại được | **Refactor**: thêm `socket.io-client` vào `devDependencies` (và script `test`), rồi `npm install` lại |
| `server.js:` `RUNOUT_DELAY_MS`, `DISCONNECT_GRACE_MS` | Nhánh `NODE_ENV === 'test'` và `server.listening` nhúng trong code production | Khó đọc, dễ nhầm hành vi khi test/prod | **Tách riêng**: đưa vào `config.js` đọc từ biến môi trường |
| `server.js:` `connectedP` | Helper khai báo nhưng không dùng | Rác | **Xóa** |
| `server.js:` `require('uuid')` | Chỉ dùng để sinh mã phòng/token | Thêm 1 dependency đã deprecated | **Xóa** — dùng `crypto.randomUUID()` / `crypto.randomBytes` |
| `server.js:` `awardPot` (3 chỗ: dead money, tier, fallback) | Cùng đoạn "lấy winners từ `Hand.winners`" lặp 3 lần | Sửa 1 chỗ dễ quên 2 chỗ còn lại | **Refactor**: `pickWinners(ev, players)` |
| `server.js:` `startTurnTimer`, `doAction` (fold), `handleDisconnect` ×2 | Chuỗi "fold → hoàn cược → ih≤1 → award / advance" lặp 4 lần | Nguồn gốc lỗi P0-3 (sửa không đồng bộ) | **Refactor**: `afterFold(r, player)` dùng chung |
| `server.js:` `handleDisconnect` (nhánh `graceMs===0` và timer) | ~35 dòng copy-paste | Dễ lệch hành vi giữa 2 nhánh | **Refactor**: `foldDisconnected(r, p)` |
| `server.js:` `doAction` case `raise` / `allin` | Logic "mở lại action / cập nhật lastRaise" lặp | Dễ lệch luật (xem P1-5) | **Refactor**: `applyBetTo(r, cur, newTotal)` |
| `server.js:` `advanceStreet`, `startRunout` | Vòng reset street `for (const p of r.players){p.bet=0;...}` lặp | Trùng lặp | **Refactor**: `resetStreet(r)` |
| `server.js:` `advanceStreet` vs `stepRunout` | Hai nơi cùng chia flop/turn/river + log | Lệch format log nếu sửa một nơi | **Refactor**: `dealNextStreet(r)` |
| `server.js:` `rooms`, `sock2room` | Object thường làm map theo khóa do client điều khiển | Rủi ro khóa đặc biệt, `destroyRoom` quét O(N) | **Refactor**: `Object.create(null)` hoặc `Map` |
| `server.js:` toàn bộ (~900 dòng) | Luật poker, quản lý phòng, timer, socket trộn chung một tệp | Khó test, khó sửa an toàn | **Tách riêng**: `rules.js` (hàm thuần), `room.js`, `socket.js`, `config.js` |
| `server.js:` `msgs` cap 5000, `filterState` gửi `slice(-40)` | Lưu 5000 nhưng chỉ gửi 40 | Log UI cụt, tốn RAM | **Refactor**: cap ~1000 + `get_log` theo yêu cầu (xem P2-5) |
| `server.js:` `new Server(..., {cors:{origin:'*'}})` | Static và socket cùng origin, không cần CORS | Mở rộng bề mặt tấn công vô ích | **Xóa** / đặt `origin:false` |
| `public/main.js:` `myId` | Chỉ gán, không bao giờ đọc | Rác | **Xóa** |
| `public/main.js:` `createLogDiv` (`isShowCard` với `🎴`, `isSys` với `🔄`) | Server không bao giờ phát 2 tiền tố này | Nhánh chết | **Xóa** |
| `public/main.js:` `renderSeats` + `renderMyArea` | HTML lá bài, badge action, map `acls` lặp ~45 dòng | Sửa UI phải sửa 2 nơi | **Refactor**: `cardHtml()`, `seatHtml()`, `ACT_CLS` |
| `public/main.js:` `mkCard`, `mkMiniCard`, HTML bài inline | 3 cách dựng lá bài khác nhau | Không nhất quán | **Refactor**: một `cardHtml(card,{mini})` |
| `public/main.js:` `updateTimer` (`30` cứng) | Trùng `TURN_SEC` của server | Đổi một nơi là lệch (xem P2-2) | **Refactor**: server gửi `turnSec` |
| `public/main.js:` `OPP_POS`, `MOBILE_OPP_POS` | Bảng tọa độ hardcode cho 8 mức | Khó thêm bố cục | **Tách riêng**: `layout.js` hoặc tính theo elip |
| `public/main.js:` `showNetToast`, `confirm(...)` | Chuỗi tiếng Việt xen UI tiếng Anh | Không nhất quán | **Tách riêng**: `i18n.js` |
| `public/index.html:` `#my-zone`, `#my-cards`, `#timer-wrap` vs `#my-seat` | Hai DOM cho cùng dữ liệu "bài của tôi" (desktop/mobile) | Render 2 lần, CSS nhân đôi | **Refactor**: một component responsive |
| `public/index.html:` ~35 thuộc tính `onclick=` | Inline handler | Chặn được CSP `script-src 'self'` | **Refactor**: `addEventListener` |
| `public/index.html:` link Google Fonts | Phụ thuộc mạng ngoài | Chậm/không tải khi offline (LAN) | **Tách riêng**: self-host font |
| `public/style.css:` `@font-face JQKAsWild` → `/fonts/JqkasWild.ttf` | Tệp font không có trong bộ nguồn đã gửi | Nếu thiếu: 404 và rơi về font dự phòng | **Kiểm tra / Xóa**: thêm tệp vào repo hoặc bỏ khai báo |
| `public/style.css:` đầu tệp `v8`, `main.js` `v4`, 2 chú thích `/* LOG OVERLAY */` | Chú thích trùng/lỗi thời | Gây nhiễu | **Xóa** |
| `public/style.css:` khối `@media (max-width:768px)` (~300 dòng) | Luật `.seat.seat-mobile` và `.hero-info` gần giống nhau | CSS phình, khó bảo trì | **Refactor**: dùng CSS variables |

---

## PHẦN 2: MA TRẬN LỖI VÀ LỖ HỔNG (BUG MATRIX)

> Mã sửa dưới đây giả định `rooms = Object.create(null)` và các helper ở P0-1. Các mục có đánh dấu **(cần sửa kèm client)** thay đổi cả `main.js`.

### [P0 - Critical]

#### P0-1. Một gói tin sai định dạng làm sập toàn bộ server (DoS)
- **Vị trí:** `server.js` → `io.on('connection')`: các handler `create_room`, `join_room`, `start_game`, `action`, `settings`, `rebuy`, `pause_game`, `chat`; không có `process.on('uncaughtException')`; mọi `setTimeout` callback không có try/catch.
- **Kịch bản khai thác:** bất kỳ ai mở console trình duyệt:
  - `socket.emit('join_room', {name:'x', id:123})` → `d.id?.toUpperCase` không phải hàm → `TypeError`.
  - `socket.emit('chat', {text:123})` → `d.text?.trim()` → `TypeError`.
  - `socket.emit('start_game')` (không ack) → `cb({err})` với `cb === undefined` → `TypeError`.
  - `socket.emit('create_room', null, ()=>{})` → `d.name` trên `null`.
  Exception ném trong listener của Socket.IO không được bắt → process Node thoát → **mọi phòng đang chơi của mọi người biến mất**.
- **Nguyên nhân cốt lõi:** server tin cấu trúc payload và sự tồn tại của callback ack từ client; không có lớp bảo vệ nào quanh handler/timer.
- **Mã khắc phục đề xuất:**

```js
const { randomInt, randomUUID, randomBytes } = require('crypto');

const rooms     = Object.create(null);
const sock2room = Object.create(null);

process.on('uncaughtException',  e => console.error('[uncaughtException]', e));
process.on('unhandledRejection', e => console.error('[unhandledRejection]', e));

const isFn  = f => typeof f === 'function';
const isStr = (v, max = 64) => typeof v === 'string' && v.length > 0 && v.length <= max;

function makeLimiter(limit = 30, windowMs = 5000) {
  let n = 0, t = Date.now();
  return () => { const now = Date.now(); if (now - t > windowMs) { t = now; n = 0; } return ++n <= limit; };
}

/** Ack luôn hợp lệ, payload luôn là object, có rate-limit và try/catch */
function safeOn(socket, allow, event, handler) {
  socket.on(event, (...args) => {
    const cb = isFn(args[args.length - 1]) ? args.pop() : () => {};
    const d  = args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) ? args[0] : {};
    if (!allow()) return cb({ err: 'Too many requests' });
    try { handler(d, cb); }
    catch (e) { console.error(`[${event}]`, e); cb({ err: 'Server error' }); }
  });
}

/** Mọi setTimeout phải bọc: throw trong timer cũng hạ cả process */
const guard = fn => (...a) => { try { return fn(...a); } catch (e) { console.error('[timer]', e); } };
// ví dụ: r.turnTimer = setTimeout(guard(() => { ... }), TURN_SEC * 1000);

io.on('connection', socket => {
  const allow = makeLimiter();
  const on = (ev, fn) => safeOn(socket, allow, ev, fn);

  on('chat', d => {
    const r = rooms[sock2room[socket.id]];
    const p = r && r.players.find(p => p.sid === socket.id);
    if (!p || !isStr(d.text, 500)) return;
    const text = d.text.trim().slice(0, 200);
    if (!text) return;
    msg(r, `💬 ${p.name}: ${text}`);
    broadcast(r);
  });

  on('join_room', (d, cb) => {
    const cleanName = sanitizeName(d.name);
    if (!cleanName) return cb({ err: 'Name required (1-16 characters)' });
    if (!isStr(d.id, 12)) return cb({ err: 'Room not found' });
    const id = d.id.toUpperCase();
    if (!rooms[id]) return cb({ err: 'Room not found' });
    const token = isStr(d.token, 64) ? d.token : null;
    const res = addOrReconnectPlayer(id, socket.id, cleanName, token, d.isMobile === true);
    if (res.err) return cb({ err: res.err });
    socket.join(id);
    if (!res.reconnected) msg(rooms[id], `🚪 ${cleanName} joined${res.player.waitingNextHand ? ' (waiting for next hand)' : ''}`);
    broadcast(rooms[id]);
    cb({ ok: true, id, token: res.player.token, reconnected: res.reconnected });
  });

  // start_game / rebuy / pause_game / sync_state: đổi chữ ký (cb) → (_d, cb)
  on('start_game', (_d, cb) => { /* thân hàm cũ */ });
  // create_room / action / settings: giữ (d, cb), thay socket.on(...) bằng on(...)
});
```

#### P0-2. Chiếm ghế người chơi đang rớt mạng chỉ bằng cách nhập trùng tên
- **Vị trí:** `server.js` → `addOrReconnectPlayer`: `existing = r.players.find(p => p.name === name && !p.connected)`.
- **Kịch bản khai thác:** A khóa màn hình điện thoại hoặc mất mạng 1 giây → `connected=false`. B (cùng phòng, biết tên A) gửi `join_room` với tên "A" → server coi B là A: B nhận ghế, chip, bài úp (`filterState` trả `hole` thật vì `isMe`), điều khiển hành động và có thể thành host (`hostId === oldSid`).
- **Nguyên nhân cốt lõi:** xác thực reconnect bằng tên (công khai) thay vì token bí mật. Hiện chỉ mobile có `saveSession`, nên desktop đang phải dựa vào cơ chế tên này khi F5.
- **Mã khắc phục đề xuất (cần sửa kèm client):**

```js
// server.js
function addOrReconnectPlayer(rid, sid, name, token, isMobile = false) {
  const r = rooms[rid];
  if (!r) return { err: 'Room not found' };

  // 1) Reconnect CHỈ bằng token bí mật — tuyệt đối không bằng tên
  const existing = isStr(token, 64) ? r.players.find(p => p.token === token) : null;
  if (existing) {
    if (existing.disconnectTimer) { clearTimeout(existing.disconnectTimer); existing.disconnectTimer = null; }
    if (r.roomDestroyTimer)       { clearTimeout(r.roomDestroyTimer);       r.roomDestroyTimer = null; }
    const oldSid = existing.sid;
    if (oldSid && oldSid !== sid) delete sock2room[oldSid];
    existing.sid = sid; existing.connected = true; existing.isMobile = !!isMobile;
    sock2room[sid] = rid;
    if (r.hostId === oldSid) r.hostId = sid;           // KHÔNG cướp host của người khác
    return { err: null, player: existing, reconnected: true };
  }

  // 2) Người mới: tên duy nhất, không phân biệt hoa/thường
  const key = name.toLowerCase();
  if (r.players.some(p => !p.left && p.name.toLowerCase() === key)) return { err: 'Name taken' };
  if (r.players.filter(p => !p.left).length >= r.cfg.maxP) return { err: `Room full (${r.cfg.maxP} max)` };

  const isPlaying = r.status === 'playing';
  const player = {
    sid, token: randomUUID(), name, chips: r.cfg.chips,
    hole: [], bet: 0, totalBet: 0, folded: false, allIn: false,
    active: !isPlaying, connected: true, isMobile: !!isMobile,
    waitingNextHand: isPlaying, acted: false, canRaise: true, wins: 0, lastAct: null,
  };
  r.players.push(player);
  sock2room[sid] = rid;
  return { err: null, player, reconnected: false };
}
```
```js
// public/main.js — lưu session cho cả desktop để F5 vẫn vào lại được ghế
// createRoom():  if (r.ok) saveSession(r.id, r.token, name);     // bỏ điều kiện `&& mob`
// joinRoom():    if (r.ok) saveSession(r.id, r.token, name);
// attemptSessionRestore(): bỏ dòng `if (!isMobile()) return;`
// Các listener visibilitychange/pageshow/focus/online/connect: bỏ guard `isMobile()` tương ứng
```

#### P0-3. Hoàn "cược chưa được call" quá sớm khi có người fold → raiser rút lại raise gần như miễn phí, pot sai
- **Vị trí:** `server.js` → `refundUncalledBet` được gọi trong `doAction` (case `fold`), nhánh auto-fold của `startTurnTimer`, và cả 2 nhánh `handleDisconnect`.
- **Kịch bản tái hiện (3 người, SB 2000 / BB 4000):**
  1. UTG raise lên 12000. SB fold.
  2. `refundUncalledBet`: người cao nhất = UTG (12000), người cao thứ hai = BB (4000) → "uncalled" = 8000 → trả lại UTG **ngay lập tức**, dù BB chưa kịp phản ứng.
  3. `roundBet` vẫn là 12000 nhưng `UTG.bet` bị hạ còn 4000 → `bettingDone` coi UTG "chưa call đủ" và hỏi UTG lần nữa sau khi BB call 8000.
  4. UTG chọn fold → chỉ mất 4000 thay vì 12000. Raise bluff bị "rút lại" gần như miễn phí; UI hiển thị pot nhảy lung tung giữa chừng.
  Xảy ra ở hầu hết mọi ván ≥3 người có raise rồi fold.
- **Nguyên nhân cốt lõi:** hoàn cược dư chỉ hợp lệ **khi vòng cược đã đóng** (không còn ai có thể phản ứng), nhưng đang chạy ở sự kiện fold khi vẫn còn người chưa hành động.
- **Mã khắc phục đề xuất:** chỉ giữ refund ở 3 điểm vòng cược khép lại (`advanceStreet`, `startRunout`, `awardPot` — đã có sẵn), xóa ở mọi chỗ fold:

```js
// doAction
case 'fold':
  cur.folded = true; cur.acted = true; cur.canRaise = false; cur.lastAct = 'FOLD';
  msg(r, `❌ ${cur.name} folds`);
  break;                                   // ← đã xóa refundUncalledBet(r)

// startTurnTimer — nhánh auto-fold
if (toCall > 0) {
  msg(r, `⏱️ ${c.name} timed out — auto fold`);
  c.folded = true; c.acted = true; c.canRaise = false; c.lastAct = 'FOLD';   // ← đã xóa refundUncalledBet(r)
}

// handleDisconnect (cả 2 nhánh): xóa dòng `refundUncalledBet(r);` ngay sau `p.folded = true;`

// Bất biến để viết test (phải luôn đúng sau mỗi hành động):
const chipTotal = r => r.players.reduce((s, p) => s + p.chips, 0) + r.pot;
```

---

### [P1 - Major]

#### P1-1. Người chơi mobile đang trong thời gian ân hạn mất kết nối bị xử thua ngay khi đối thủ hành động
- **Vị trí:** `server.js` → `inHandP`, `canActP`, `nextAct`, `startTurnTimer` (đều lọc `p.connected`), cùng `handleDisconnect` (nhánh ân hạn 25s).
- **Kịch bản:** heads-up, B (mobile) chuyển app. B vẫn `folded=false` nhưng `inHandP` loại B → A vừa check là `ih.length <= 1` → `awardPot` trao cả pot cho A. Ân hạn 25s thành vô nghĩa. Ngoài ra `nextAct` bỏ qua B nên lượt của B bị "nhảy qua" mà B chưa call.
- **Nguyên nhân cốt lõi:** gộp hai khái niệm "đang trong ván" và "đang online".
- **Mã khắc phục đề xuất:**

```js
// Còn trong ván = chưa fold (kể cả đang rớt mạng trong thời gian ân hạn)
const inHandP = r => r.players.filter(p => p.active && !p.folded);
const canActP = r => r.players.filter(p => p.active && !p.folded && !p.allIn);

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

// startTurnTimer: bỏ `|| !cur.connected` — người rớt mạng vẫn bị auto-check/fold khi hết giờ
if (!cur || cur.folded || cur.allIn || !cur.active) return;

// doAction / case 'raise': bỏ `p.connected` trong opponentsWithChips
const opponentsWithChips = r.players.filter(p => p !== cur && p.active && !p.folded && p.chips > 0);
```

#### P1-2. `awardPot` với 0 người hợp lệ: ván treo vĩnh viễn và chip trong pot biến mất
- **Vị trí:** `server.js` → `awardPot`: `if (!contenders || !contenders.length) return;`.
- **Kịch bản:** hai người cuối đều rớt mạng, timer ân hạn của người thứ hai chạy → `inHandP` rỗng → `awardPot` return im lặng. Không gọi `scheduleNextHand`, `r.status` vẫn `playing`, `r.pot` còn nguyên rồi bị `startHand` sau này ghi đè `r.pot = 0` → chip biến mất.
- **Nguyên nhân cốt lõi:** nhánh thoát sớm không đóng ván và không bảo toàn chip.
- **Mã khắc phục đề xuất:**

```js
function awardPot(r, contenders, ev) {
  clearTurnTimer(r); clearRunoutTimer(r);
  if (!contenders || contenders.length === 0) {
    for (const p of r.players) { p.chips += p.totalBet; p.totalBet = 0; p.bet = 0; }   // hoàn cược
    r.pot = 0; r.phase = 'showdown'; r.showdownHands = false;
    r.result = { winners: [], allHands: null, totalPot: 0 };
    msg(r, '⚠️ Không còn người chơi hợp lệ — hoàn lại tiền cược');
    broadcast(r); scheduleNextHand(r);
    return;
  }
  // ... phần còn lại giữ nguyên; đổi `ev.find(...)` thành `ev?.find(...)` ở chỗ lấy `hd`
```

#### P1-3. Host bấm Pause rồi ván kết thúc trong lúc pause → không thể Resume, bàn đóng băng
- **Vị trí:** `server.js` → handler `pause_game`: `if (!r.phase || r.phase === 'showdown') return cb({err:'No active hand'})` đứng trước nhánh toggle; `scheduleNextHand` bỏ qua khi `paused`.
- **Kịch bản:** host pause → timer ân hạn của một người mobile hết hạn → fold → `awardPot` → phase `showdown`. `nextHandTimer` chạy nhưng thấy `paused` nên bỏ qua. Host bấm Resume → bị chặn "No active hand". Overlay "Game Paused" kẹt mãi.
- **Nguyên nhân cốt lõi:** điều kiện chặn áp dụng cả cho thao tác resume; resume không biết xử lý trạng thái `showdown`.
- **Mã khắc phục đề xuất:**

```js
on('pause_game', (_d, cb) => {
  const rid = sock2room[socket.id], r = rid && rooms[rid];
  if (!r) return cb({ err: 'Not in room' });
  if (r.hostId !== socket.id) return cb({ err: 'Host only' });
  if (!r.paused && (!r.phase || r.phase === 'showdown')) return cb({ err: 'No active hand' }); // chỉ chặn khi muốn PAUSE
  r.paused = !r.paused;
  if (r.paused) {
    clearTurnTimer(r); clearRunoutTimer(r);
    msg(r, '⏸️ Game paused by host');
  } else {
    msg(r, '▶️ Game resumed by host');
    if (r.phase === 'showdown')                                                   scheduleNextHand(r);
    else if (r.showAllInHole && inHandP(r).length >= 2 && canActP(r).length <= 1) stepRunout(r);
    else                                                                          startTurnTimer(r);
  }
  broadcast(r);
  cb({ ok: true, paused: r.paused });
});
```

#### P1-4. Một socket giữ nhiều ghế (lộ bài, thông đồng) và không có cách "rời phòng" thật sự
- **Vị trí:** `server.js` → `create_room`/`join_room` (không kiểm tra socket đã ở phòng), thiếu sự kiện `leave_room`; `main.js` → `leaveRoom()` chỉ `location.reload()`.
- **Kịch bản:** một client gọi `join_room` nhiều lần với tên khác nhau trong cùng phòng. Tất cả ghế dùng chung `sid` → `isMe` đúng cho cả hai, thấy bài cả hai, điều khiển cả hai ghế (thông đồng/soft-play). `sock2room` chỉ giữ phòng cuối nên các phòng trước thành ghế ma, host ma. Người rời phòng cũng để lại ghế ma chiếm slot `maxP` và tên trong waiting room.
- **Nguyên nhân cốt lõi:** không ràng buộc 1 socket ↔ 1 ghế; không có vòng đời rời phòng.
- **Mã khắc phục đề xuất (cần sửa kèm client):**

```js
// đầu create_room và join_room
const curRid = sock2room[socket.id];
if (curRid && rooms[curRid]) {
  const mine = rooms[curRid].players.find(p => p.sid === socket.id && !p.left);
  if (mine && !(isStr(d.token, 64) && d.token === mine.token))   // trừ trường hợp khôi phục đúng ghế của mình
    return cb({ err: 'Bạn đang ở trong một phòng — hãy rời phòng trước' });
}

on('leave_room', (_d, cb) => {
  const rid = sock2room[socket.id], r = rid && rooms[rid];
  if (!r) return cb({ ok: true });
  const p = r.players.find(p => p.sid === socket.id);
  if (p) {
    p.left = true;                      // handleDisconnect: không ân hạn cho người chủ động rời
    handleDisconnect(socket.id);
    if (r.status === 'waiting') { r.players = r.players.filter(x => x !== p); broadcast(r); }
  }
  socket.leave(rid);
  cb({ ok: true });
});

// handleDisconnect: const graceMs = (p.isMobile && !p.left) ? DISCONNECT_GRACE_MS() : 0;
```
```js
// public/main.js
function leaveRoom() {
  clearSession();
  let done = false;
  const go = () => { if (!done) { done = true; location.reload(); } };
  socket.emit('leave_room', go);
  setTimeout(go, 800);
}
function confirmLeaveRoom() { if (confirm('Bạn có chắc muốn rời khỏi phòng chơi này không?')) leaveRoom(); }
```

#### P1-5. Hành động `allin` bypass luật "raise không mở lại" qua gói tin tự chế
- **Vị trí:** `server.js` → `doAction` case `allin` (không kiểm tra `canRaise`).
- **Kịch bản:** A bet 100, B call (`canRaise=false`), C all-in 130 (raise thiếu, không mở lại action). Client chuẩn chỉ cho B call/fold, nhưng B gửi `socket.emit('action',{action:'allin'})` → server nhận và coi là full raise, trái luật.
- **Nguyên nhân cốt lõi:** kiểm tra luật chỉ nằm ở nhánh `raise` và ở UI; nhánh `allin` bỏ sót.
- **Mã khắc phục đề xuất:**

```js
case 'allin': {
  const chips = cur.chips;
  if (chips <= 0) return 'No chips';
  const newTot = cur.bet + chips;
  if (newTot > r.roundBet && cur.canRaise === false)
    return 'Cannot raise — action was not reopened (chỉ được call hoặc fold)';
  // ... phần còn lại giữ nguyên
```

#### P1-6. Treo ván ngay lúc chia bài khi người phải hành động đầu tiên đã all-in vì blind/ante
- **Vị trí:** `server.js` → `startHand` (sau `postBlind`/`postAnte`, `r.curIdx = sbI` ở heads-up).
- **Kịch bản:** heads-up, SB còn 1500 chip nhưng SB = 2000 → SB all-in ngay khi đăng blind. `curIdx = sbI` trỏ vào người đã all-in: `startTurnTimer` bỏ qua, `doAction` trả 'Cannot act'. BB không phải lượt → **không ai hành động được, không có timer** → ván treo mãi. Tương tự khi mọi người đều all-in do ante.
- **Nguyên nhân cốt lõi:** `startHand` không kiểm tra "còn ai cần hành động" như `advanceStreet` làm.
- **Mã khắc phục đề xuất:**

```js
// cuối startHand, thay cho `startTurnTimer(r); broadcast(r);`
const can = canActP(r);
if (can.length === 0 || (can.length === 1 && can[0].bet >= r.roundBet)) {
  startRunout(r);                       // startRunout đã tự broadcast
  return;
}
if (r.players[r.curIdx].allIn) r.curIdx = nextAct(r, r.curIdx);
startTurnTimer(r);
broadcast(r);
```

#### P1-7. Xáo bài bằng `Math.random()` — PRNG có thể bị dự đoán
- **Vị trí:** `server.js` → `mkDeck`.
- **Kịch bản:** `Math.random` của V8 (xorshift128+) khôi phục được trạng thái nếu quan sát đủ đầu ra. Người chơi ghi lại nhiều ván có thể dự đoán các bộ bài sau. Rủi ro thấp với game bạn bè nhưng sửa chỉ 3 dòng.
- **Nguyên nhân cốt lõi:** dùng PRNG không mật mã cho thao tác cần công bằng.
- **Mã khắc phục đề xuất:**

```js
function mkDeck() {
  const d = SUITS.flatMap(s => RANKS.map(r => r + s));
  for (let i = d.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);            // crypto.randomInt, loại trừ cận trên
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}
```

#### P1-8. Không giới hạn tốc độ/tài nguyên: spam phòng, spam chat, dò mã phòng
- **Vị trí:** `server.js` → `new Server(server, {...})`, `create_room`, `chat`, `join_room`; `createRoom` (mã phòng).
- **Kịch bản:** một script gọi `create_room` hàng nghìn lần (mỗi phòng tồn tại đến khi mọi người ngắt kết nối) → cạn RAM. Spam `chat` kích hoạt `broadcast` liên tục tới toàn phòng. Mã phòng 6 ký tự hex (16,7 triệu khả năng), không giới hạn thử → dò phòng bằng `join_room`. `maxHttpBufferSize` mặc định 1 MB.
- **Nguyên nhân cốt lõi:** không có hạn mức theo socket/IP.
- **Mã khắc phục đề xuất:** (`makeLimiter` + `safeOn` ở P0-1 đã chặn spam theo socket)

```js
const io = new Server(server, {
  maxHttpBufferSize: 1e4,
  cors: { origin: false },
  pingInterval: 10000, pingTimeout: 8000,
});

const MAX_ROOMS_PER_IP = 5;
const ipOf = s => (s.handshake.headers['x-forwarded-for'] || s.handshake.address || '').toString().split(',')[0].trim();

// create_room:
const ip = ipOf(socket);
if (Object.values(rooms).filter(r => r.creatorIp === ip).length >= MAX_ROOMS_PER_IP)
  return cb({ err: 'Too many rooms' });
// sau createRoom: rooms[id].creatorIp = ip;

// join_room: giới hạn lần sai theo IP
const fails = new Map();                                   // ip -> { n, t }
function tooManyFails(ip) {
  const f = fails.get(ip);
  return !!f && Date.now() - f.t < 60000 && f.n >= 10;
}
function noteFail(ip) {
  const f = fails.get(ip);
  if (!f || Date.now() - f.t >= 60000) fails.set(ip, { n: 1, t: Date.now() });
  else f.n++;
}
```
(Gọi `tooManyFails(ip)` đầu `join_room`, `noteFail(ip)` khi trả 'Room not found'.)

---

### [P2 - Minor/Polish]

#### P2-1. Badge sức mạnh bài sai: "Ace-Four" bị gắn Tứ quý, "Pair (Three)" bị gắn Sám
- **Vị trí:** `public/main.js` → `hsClass`, `hsIcon` (so khớp chuỗi con bằng `includes`).
- **Kịch bản:** preflop `handStrength` trả "Ace-Four Suited" hoặc "Pair (Four)" → chứa "four" → badge đỏ 🎯 như có Tứ quý; "King-Three" → badge Sám.
- **Nguyên nhân cốt lõi:** khớp chuỗi con trên tên quân bài.
- **Mã khắc phục đề xuất:**

```js
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
const hsClass = d => hsMeta(d).cls;
const hsIcon  = d => hsMeta(d).icon;
```

#### P2-2. Đồng hồ lượt dùng giờ máy client so với giờ server; hằng số 30 giây bị lặp
- **Vị trí:** `public/main.js` → `updateTimer` (`Date.now() - st.turnStartMs`, `30`); `server.js` → `filterState` (`turnStartMs`).
- **Kịch bản:** điện thoại lệch giờ 20 giây → đồng hồ hiển thị 0s trong khi server vẫn còn đếm, hoặc hiển thị đầy trong khi sắp bị auto-fold.
- **Nguyên nhân cốt lõi:** truyền mốc thời gian tuyệt đối thay vì thời gian còn lại.
- **Mã khắc phục đề xuất:**

```js
// server.js — filterState: thêm 2 trường (giữ hoặc bỏ turnStartMs tùy ý)
turnSec: TURN_SEC,
turnMsLeft: (room.showAllInHole || room.phase === 'showdown' || !room.turnStartMs)
  ? null : Math.max(0, TURN_SEC * 1000 - (Date.now() - room.turnStartMs)),
```
```js
// public/main.js — updateTimer (và điều kiện `st.turnStartMs` trong renderSeats/renderMyArea → `st.turnMsLeft != null`)
const recvAt = performance.now(), total = (st.turnSec || 30) * 1000;
function loop() {
  const msLeft = Math.max(0, st.turnMsLeft - (performance.now() - recvAt));
  const secsLeft = msLeft / 1000, pct = Math.min(100, msLeft / total * 100);
  const warn = secsLeft <= 10, danger = secsLeft <= 5;
  // ... phần cập nhật fill/numEl/seatEl giữ nguyên
  if (msLeft > 0 && !st.paused && S === st) timerRafId = requestAnimationFrame(loop);
  else timerRafId = null;
}
```

#### P2-3. Nút "1/2 POT / 3/4 POT / POT" tính sai so với quy ước poker
- **Vị trí:** `public/main.js` → `preset()`.
- **Kịch bản:** pot 3000 (đã gồm cược 1000 của đối thủ), bạn chưa bỏ gì. Raise cỡ pot chuẩn là lên 1000 + (3000 + 1000) = 5000; code cho 4000.
- **Nguyên nhân cốt lõi:** thiếu phần tiền call khi tính cỡ pot.
- **Mã khắc phục đề xuất:**

```js
const toCall = rb - (me?.bet || 0);
const target = rb + Math.floor((pot + toCall) * v);
```

#### P2-4. `fmt()` làm tròn mất số lẻ ở bàn lớn
- **Vị trí:** `public/main.js` → `fmt`.
- **Kịch bản:** 10499 hiển thị "10K", 15600 hiển thị "16K" trong khi ô nhập raise dùng số thật.
- **Nguyên nhân cốt lõi:** `toFixed(0)` cho dải ≥10000.
- **Mã khắc phục đề xuất:**

```js
function fmt(n) {
  if (n == null) return '0';
  const f = (v, u) => (+v.toFixed(1)).toString() + u;
  if (n >= 1e6) return f(n / 1e6, 'M');
  if (n >= 1e4) return f(n / 1e3, 'K');
  return n.toLocaleString();
}
```

#### P2-5. Log ván chỉ thấy 40 dòng cuối; đồng bộ log dựa vào `ts` có thể bỏ sót dòng cùng mili-giây
- **Vị trí:** `server.js` → `filterState` (`msgs.slice(-40)`), `msg`; `public/main.js` → `renderLog` (`m.ts > lastRenderedMsgTs`), `renderFilteredLog` (đếm "ván" trên 40 dòng).
- **Kịch bản:** mở "Game Log" chỉ thấy vài lượt gần nhất, số "ván" luôn nhỏ. Hai dòng phát sinh cùng mili-giây có thể bị bỏ qua khi append tăng dần.
- **Nguyên nhân cốt lõi:** server lưu 5000 dòng nhưng chỉ gửi 40; dùng timestamp làm khóa so sánh.
- **Mã khắc phục đề xuất:**

```js
// server.js
function msg(r, t) {
  r.msgSeq = (r.msgSeq || 0) + 1;
  r.msgs.push({ id: r.msgSeq, t, ts: Date.now() });
  if (r.msgs.length > 1000) r.msgs.shift();
}
on('get_log', (_d, cb) => {
  const r = rooms[sock2room[socket.id]];
  cb(r ? { ok: true, msgs: r.msgs } : { err: 'Not in room' });
});
// public/main.js: so sánh theo m.id thay vì m.ts; khi mở log gọi socket.emit('get_log', res => { if (res.ok) { allMsgsCache = res.msgs; renderFilteredLog(); } });
```

#### P2-6. Người chờ ván bị "fold" khi rớt mạng; cờ `isMobile` do client tự khai để xin ân hạn
- **Vị trí:** `server.js` → `handleDisconnect` (điều kiện `!p.folded && !p.allIn`, `const graceMs = p.isMobile ? ...`).
- **Kịch bản:** người đang chờ ván sau (`active=false`) rớt mạng vẫn đi vào nhánh "fold", phát log thừa và gọi `bettingDone`. Một client desktop khai `isMobile:true` để luôn được ân hạn 25s mỗi lần ngắt kết nối.
- **Nguyên nhân cốt lõi:** thiếu kiểm tra `p.active`; tin cờ do client gửi.
- **Mã khắc phục đề xuất:**

```js
if (r.status === 'playing' && r.phase && r.phase !== 'showdown' && p.active && !p.folded && !p.allIn) {
  const graceMs = (p.isMobile && !p.left && !p.graceUsed) ? DISCONNECT_GRACE_MS() : 0;
  if (graceMs) p.graceUsed = true;         // mỗi ván chỉ 1 lần ân hạn
  // ...
}
// startHand, trong vòng for: p.graceUsed = false;
```

#### P2-7. Mã phòng không kiểm tra trùng; host có thể đặt `maxP` thấp hơn số người đang có
- **Vị trí:** `server.js` → `createRoom` (`uuidv4().substring(0,6)`), handler `settings`.
- **Kịch bản:** hai mã trùng (xác suất rất nhỏ nhưng hậu quả là ghi đè phòng khác). Host đặt `maxP=2` khi có 5 người → trạng thái không nhất quán.
- **Nguyên nhân cốt lõi:** thiếu kiểm tra va chạm và kiểm tra ràng buộc.
- **Mã khắc phục đề xuất:**

```js
function newRoomId() {
  let id;
  do { id = randomBytes(3).toString('hex').toUpperCase(); } while (rooms[id]);
  return id;
}
// settings:
const cfg = sanitizeCfg(d);
const live = r.players.filter(p => !p.left).length;
if (cfg.maxP < live) return cb({ err: `Max players không được nhỏ hơn số người hiện có (${live})` });
```

#### P2-8. Thiếu header bảo mật/CSP; CORS mở `*`
- **Vị trí:** `server.js` → `express()`/`new Server(..., cors)`; `public/index.html` (inline `onclick`).
- **Kịch bản:** hiện không có sink XSS chưa escape, nhưng nếu sau này sót một chỗ thì không có lớp phòng vệ thứ hai.
- **Nguyên nhân cốt lõi:** chưa có CSP, và inline handler cản việc bật CSP chặt.
- **Mã khắc phục đề xuất (sau khi thay `onclick=` bằng `addEventListener`):**

```js
// npm i helmet
const helmet = require('helmet');
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc:   ["'self'"],
    scriptSrc:    ["'self'"],
    styleSrc:     ["'self'", 'https://fonts.googleapis.com'],
    styleSrcAttr: ["'unsafe-inline'"],            // JS đang dùng style="..." trong innerHTML
    fontSrc:      ["'self'", 'https://fonts.gstatic.com'],
    connectSrc:   ["'self'", 'ws:', 'wss:'],
    imgSrc:       ["'self'", 'data:'],
  } },
}));
```

#### P2-9. Server gửi `sid` (socket id) của mọi người cho mọi client
- **Vị trí:** `server.js` → `filterState` (`sid`, `hostId`); `public/main.js` (so sánh `cur.sid === socket.id`, `p.sid === st.hostId`).
- **Kịch bản:** lộ định danh nội bộ; hiện chưa khai thác được nhưng không cần thiết.
- **Nguyên nhân cốt lõi:** dùng `sid` làm khóa nhận dạng ở client.
- **Mã khắc phục đề xuất (cần sửa kèm client):**

```js
// server.js: khi tạo player → pid: randomUUID(); filterState:
players: room.players.map(p => ({ pid: p.pid, isHost: p.sid === room.hostId, /* bỏ sid */ ... }))
// bỏ top-level hostId
// public/main.js
const isHost   = st.players.some(p => p.isMe && p.isHost);
const isMyTurn = !!(cur && cur.isMe);          // thay cho cur.sid === socket.id
```

#### P2-10. Nút Copy mã phòng im lặng thất bại trên HTTP/LAN; `maxlength` client (20) khác server (16)
- **Vị trí:** `public/main.js` → `copyCode`; `public/index.html` → `#c-name`, `#j-name`.
- **Kịch bản:** chơi qua `http://192.168.x.x` thì `navigator.clipboard` không tồn tại → promise rejection không xử lý. Nhập tên 20 ký tự bị server cắt còn 16 mà người dùng không biết.
- **Nguyên nhân cốt lõi:** không có fallback; giới hạn lệch giữa 2 phía.
- **Mã khắc phục đề xuất:**

```js
async function copyCode() {
  const b = document.querySelector('.w-copy');
  try { await navigator.clipboard.writeText(roomId || ''); }
  catch {
    const t = document.createElement('textarea');
    t.value = roomId || ''; document.body.appendChild(t); t.select();
    document.execCommand('copy'); t.remove();
  }
  b.textContent = '✅ Copied!'; setTimeout(() => b.textContent = '📋 Copy', 1500);
}
// index.html: maxlength="16" cho #c-name và #j-name
```

#### P2-11. Tính lại hand strength cho mọi người chơi ở mỗi lần broadcast
- **Vị trí:** `server.js` → `filterState` → `handStrength` → `Hand.solve`.
- **Kịch bản:** 9 người, mỗi hành động/log chat gọi `Hand.solve` 9 lần cùng các tham số.
- **Nguyên nhân cốt lõi:** không cache kết quả thuần.
- **Mã khắc phục đề xuất:**

```js
const hsCache = new Map();
function handStrengthCached(hole, board) {
  const k = hole.join() + '|' + board.join();
  let v = hsCache.get(k);
  if (v === undefined) {
    v = handStrength(hole, board);
    if (hsCache.size > 500) hsCache.clear();
    hsCache.set(k, v);
  }
  return v;
}
// filterState: hs = handStrengthCached(me.hole, room.board);
```

---

### Đã kiểm chứng — không phát hiện lỗi
- **XSS:** mọi sink `innerHTML` trong `main.js` (tên, `lastAct`, log, bảng thắng) đều đi qua `escapeHtml`; tin nhắn chat dùng `textContent`; `sanitizeName` ở server loại ký tự điều khiển/RTL. Không thấy sink chưa escape.
- **Lộ bài:** `filterState` che `hole` của người khác đúng; `hs` chỉ tính cho chính mình; `result.winners[].hole` và `allHands` bị che khi thắng do mọi người fold; token không bao giờ gửi cho người khác.
- **Luật:** thuật toán side pot theo tầng, chia lẻ (odd chip) cho người gần trái nút dealer, theo dõi min-raise và raise thiếu (incomplete raise), luật heads-up (dealer = SB, SB đi trước preflop, BB đi trước postflop), kiểm tra quyền host.

---

## PHẦN 3: LỘ TRÌNH THỰC THI NÂNG CẤP (STEP-BY-STEP ROADMAP)

> **Nguyên tắc không gián đoạn:** trạng thái phòng nằm trong RAM, khởi động lại server là mất mọi ván. Mỗi bước triển khai vào lúc không có phòng nào đang `playing` (thêm endpoint `/healthz` trả số phòng đang chơi để kiểm tra). Mỗi bước là một commit riêng, có tag để rollback.

| Bước | Nội dung | Lý do thứ tự | Kiểm chứng trước khi sang bước sau |
|---|---|---|---|
| **0. Chuẩn bị** | Tạo nhánh `audit-fixes`, đặt tag `pre-audit`. Thêm `socket.io-client` vào `devDependencies` + script `test`. Viết bộ test: bất biến chip (`Σchips + pot` không đổi sau mỗi hành động), kịch bản 3 người raise/fold (P0-3), heads-up SB thiếu chip (P1-6), pause rồi ván kết thúc (P1-3), payload sai định dạng (P0-1). | Có lưới an toàn; test phải **FAIL** trước khi sửa để xác nhận lỗi tái hiện. | Test đỏ đúng chỗ dự kiến. |
| **1. P0-1** | Thêm `safeOn`, `guard` cho timer, `process.on(...)`, validate `id`/`text`/`token`, `Object.create(null)`. | Chỉ thêm lớp bảo vệ, không đổi hành vi game, rủi ro thấp nhất, chặn được DoS ngay. | Test payload sai → server vẫn sống, trả `{err}`. |
| **2. P0-3** | Xóa 4 lời gọi `refundUncalledBet` ở fold/timeout/disconnect. | Sửa server thuần, 4 dòng, hết lỗi sai chip nặng nhất. | Test 3 người: raise → fold → call → raiser không bị hỏi lại; bất biến chip xanh. |
| **3a. P0-2 (client)** | Client lưu session cho cả desktop và khôi phục khi F5. Triển khai trước. | Bước chuẩn bị để bỏ cơ chế khôi phục theo tên mà không làm gián đoạn người dùng desktop. | F5 trên desktop vẫn vào lại đúng ghế bằng token. |
| **3b. P0-2 (server)** | Bỏ reconnect theo tên; tên duy nhất không phân biệt hoa/thường. Triển khai khi không có phòng đang chơi. | Sau 3a thì không còn ai phụ thuộc cơ chế cũ. | Dùng tên của người đang rớt mạng không chiếm được ghế. |
| **4. P1** (theo thứ tự) | (1) P1-1 + P1-2 (khối `inHandP`/`awardPot` cùng nhau). (2) P1-3 pause. (3) P1-6 `startHand`. (4) P1-5 `allin`. (5) P1-4 `leave_room` + chặn nhiều ghế (server + client). (6) P1-7 RNG. (7) P1-8 giới hạn tốc độ/tài nguyên. | Nhóm sửa logic ván trước, nhóm hạ tầng sau; P1-1 phải trước P1-2/P1-3 vì chúng dựa trên định nghĩa "còn trong ván" mới. | Chạy lại toàn bộ test + chơi thử 3 người (có 1 người mobile chuyển app giữa ván). |
| **5. P2** | P2-1 → P2-11 theo thứ tự trong ma trận. P2-8 (CSP) làm sau khi gỡ inline `onclick`. | Cải thiện hiển thị/hardening, không ảnh hưởng luật. | Soát bằng mắt trên desktop + điện thoại. |
| **6. Dọn dẹp** | (a) Đồng bộ `package-lock.json`. (b) Xóa code chết (`connectedP`, `myId`, nhánh `🎴`/`🔄`, chú thích trùng, `uuid`). (c) Gộp hàm trùng (`pickWinners`, `afterFold`, `foldDisconnected`, `applyBetTo`, `resetStreet`, `dealNextStreet`, `seatHtml`). (d) Tách `rules.js` / `room.js` / `socket.js` / `config.js`; self-host font. | Làm sau cùng, khi đã có test xanh bảo vệ — refactor cấu trúc không được phép đổi hành vi. | Test vẫn xanh sau từng commit; `npm ci` sạch. |

**Điều kiện hoàn tất:** toàn bộ test xanh; chạy một phiên mô phỏng ngẫu nhiên (fuzz) vài nghìn ván với 2–9 người, bất biến chip luôn đúng; không còn process crash khi gửi payload bất kỳ.
