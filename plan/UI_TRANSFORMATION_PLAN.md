# Kế hoạch chuyển đổi UI/UX — Poker theo chuẩn PokerNow

> Phiên bản đã chốt phạm vi. Nguồn tham chiếu: 5 ảnh chụp gameplay PokerNow (Pre-flop, Flop, River, Showdown, Raise panel).
> Dự án: `public/index.html`, `public/style.css`, `public/main.js`, cùng `room.js`/`server.js` (thay đổi nhỏ, chỉ thêm trường).

## 0. Chú giải trạng thái và phạm vi

| Nhãn | Ý nghĩa |
|---|---|
| ✅ **TRONG PHẠM VI** | Thực hiện trong đợt này (Bước 0–5) |
| ⏸️ **HOÃN – P2** | Đã thiết kế sẵn, **CHƯA THỰC THI**. Không được làm trong đợt này |
| ⏸️ **HOÃN – MOBILE** | Chi tiết giao diện mobile xử lý sau. Đợt này chỉ yêu cầu **không bị hỏng** (xem 0.2) |

### 0.1 Quyết định phạm vi
- Làm: toàn bộ hạng mục **P0 và P1** trên **desktop**, kèm các thay đổi server tối thiểu (`win5`, `pid` trong kết quả, bộ đếm `rebuys`).
- **Không làm (chỉ ghi chép ở mục 6):** Extra Time, Show/Muck, Check-or-Fold, avatar, left-rail/topbar kiểu PokerNow.
- **Mobile:** giữ nguyên bố cục hiện có (felt dạng stadium dọc, `MOBILE_OPP_POS`, raise modal giữa màn hình, `#my-seat`). Chi tiết tinh chỉnh nằm ở mục 7.

### 0.2 Quy tắc "không phá mobile"
- Mọi cấu trúc mới chỉ dành cho desktop (lớp chip cược trên nỉ, ghế hero trong arena, raise panel dạng dock) phải nằm trong `@media (min-width: 769px)`.
- Phần dùng chung (token màu, bài 4 màu, màu nỉ, màu ghế, viền nút hành động) áp dụng cả hai nền tảng, nhưng khối `@media (max-width: 768px)` hiện có **không được sửa hành vi**, chỉ chỉnh để không vỡ màu/kích thước.
- Chỉ cần smoke test mobile (mục 8.2), không cần đối chiếu pixel.

### 0.3 Lưu ý nhận diện và bản quyền
Chỉ bắt chước **bố cục, màu sắc, hành vi**. Không dùng logo, chữ "POKER NOW", họa tiết mặt lưng bài của họ. Watermark trên nỉ là `NO LIMIT TEXAS HOLD'EM` cùng mức blinds của phòng.

---

## 1. UI Gap Analysis

| Thành phần | Hiện trạng | Chuẩn mục tiêu | Ưu tiên | Trạng thái |
|---|---|---|---|---|
| Felt & rail | Viền xanh đậm 9px (`--rim`), nỉ `#2a6f3e` trầm, nền arena radial đen | Nỉ emerald sáng hơn, gradient tâm→mép; rail xám đen bao quanh (không viền xanh); nền phẳng `#232323` | P0 | ✅ |
| Pot | Chữ vàng trôi trên nỉ; pot ở topbar | Pill xám đen mờ, số trắng to; nhãn "total X" chỉ hiện khi có cược trên bàn. `pot chính = pot − Σbet`, `total = pot` | P0 | ✅ |
| Bài chung | 4 màu nhưng suit nằm giữa lá, xanh lá/dương tối, gradient trắng | Bài trắng phẳng, rank trên-trái, suit lớn dưới-phải; màu rực (♣ `#1fb02a`, ♦ `#3f51e0`) | P0 | ✅ |
| Dimming showdown | Không có; `result` không có 5 lá thắng | Lá không thuộc tổ hợp thắng mờ còn ~35%. Cần `win5` từ server | P1 | ✅ |
| Ghế đối thủ | Panel đen có viền trắng mờ + blur; chip badge xanh trên bài | Khối xám `#2c2c2c` phẳng, bo 6px, không viền; tới lượt → nền trắng chữ tối + glow; timer là thanh mảnh đáy ghế; badge 🏆 và badge rebuy đỏ góc trên-phải | P0 | ✅ |
| **Thứ tự ghế** | `opps = players.filter(!isMe)` giữ thứ tự mảng, **không xoay theo hero** | Xoay thứ tự để ghế đi theo chiều kim đồng hồ bắt đầu từ ngay sau hero | **P0** | ✅ |
| Ghế Fold & trạng thái khác | `opacity .35 + grayscale + <s>` | Khối xám trong suốt + dấu ✕ lớn + chữ "FOLD" mờ; tương tự `IN NEXT HAND`, `OFFLINE`, `AWAY` | P0 | ✅ (`AWAY`: chỉ dựng giao diện nếu state có; hiện chưa có cờ → bỏ qua) |
| Inward bet chips | Pill vàng dưới ghế (`bottom:-22px`) | Chip tròn vàng-chanh chữ đen nằm **trên nỉ** hướng về pot | P0 | ✅ desktop · ⏸️ MOBILE |
| Dealer button | Chấm "D" vàng nhỏ trong hàng tên | Nút trắng chữ "D" xanh trên mép nỉ cạnh ghế dealer | P1 | ✅ desktop · ⏸️ MOBILE |
| Ghế Hero | Desktop: ở bottom-bar bên trái; mobile: `#my-seat` riêng | Desktop: ghế hero ở đáy arena, bài ngửa to, pill hạng bài dính đáy bài, glow khi tới lượt. Bottom-bar chỉ còn nút hành động | P1 | ✅ desktop · ⏸️ MOBILE (giữ nguyên) |
| Pill hạng bài | `hs-badge` nhiều màu cạnh tên | Pill san hô (`PAIR (J)`), tím-chàm (`FULL HOUSE`) dính đáy bài | P1 | ✅ |
| Nút hành động | Nút đặc gradient; phím tắt `::after` trong nút | Nền tối, viền 2px theo hành động; phím tắt là nhãn "khuyết" trên viền; `CALL` → `ALL IN x` khi call ≥ chip | P0 | ✅ |
| Raise panel | Thanh `fixed` full-width trên bottom-bar; nút luôn ghi "BET" | Dock bên phải bottom-bar: ô "Your bet" + nhãn BB, hàng 5 preset, slider với [−]/[+] dính hai đầu, thumb cam, BACK (nhãn ESC) + RAISE/BET theo `roundBet` | P0 | ✅ desktop · ⏸️ MOBILE (giữ modal cũ) |
| Winner presentation | Modal toàn màn hình + confetti 6s | Không modal. Ghế thắng: nền kem + hào quang vàng + pill `+amt`; bài lật ngửa kèm pill hạng; người thua cũng lật bài | P0 | ✅ |
| Khối YOUR TURN | Chữ vàng nhỏ | Chấm vàng + "YOUR TURN" (phần hộp "EXTRA TIME" thuộc P2) | P1 | ✅ (chỉ phần "YOUR TURN") |
| Extra Time (`T`) | Không có | Hộp trắng "EXTRA TIME ACTIVATED" | P2 | ⏸️ **CHƯA THỰC THI** |
| Show/Muck | Không có | `SHOW ALL CARDS [S]`, `[1]`, `[2]` | P2 | ⏸️ **CHƯA THỰC THI** |
| Check-or-Fold | Không có | Nút pre-action khi chưa tới lượt | P2 | ⏸️ **CHƯA THỰC THI** |

---

## 2. Design Tokens (`:root`)

Các giá trị đã được **trích xuất và chốt bằng eyedropper từ 5 ảnh chụp PokerNow thực tế** (Bước 0):

```css
:root {
  /* Page & table */
  --bg-page:#242223;  --bar-bg:#211f20;
  --rail:#212121;  --rail-hi:#2c2c2c;
  --felt-core:#359c61; --felt:#2f8f55; --felt-edge:#288450;
  --felt-inset:inset 0 0 90px rgba(0,0,0,.35);
  --pot-pill-bg:rgba(0,0,0,.25);

  /* Cards (4 màu) */
  --card-bg:#ffffff;
  --suit-s:#111111;  --suit-h:#db3131;  --suit-c:#17b717;  --suit-d:#4747ea;
  --card-back:#d07373;
  --card-shadow:0 2px 6px rgba(0,0,0,.35);
  --card-dim-opacity:.35;

  /* Seats */
  --seat-bg:#303030;  --seat-ink:#f2f2f2;
  --seat-bg-turn:#ffffff;  --seat-ink-turn:#1e1e1e;
  --seat-radius:6px;
  --seat-turn-glow:0 0 40px rgba(255,255,255,.35);
  --seat-fold-bg:rgba(48,48,48,.8);  --seat-fold-x:#6b6b6b;

  /* Chips & dealer */
  --chip-yellow:#e7fe63;  --chip-white:#ececec;  --chip-ink:#111111;
  --dealer-bg:#ececec;  --dealer-ink:#5a76d7;

  /* Winner */
  --win-seat-bg:#fafde0;
  --win-aura:0 0 60px 14px rgba(255,212,120,.55);
  --win-plus-bg:#575d36;
  --hs-coral:#f75757;  --hs-indigo:#6d64e0;

  /* Actions */
  --act-bg:#211f20;  --act-border-w:2px;  --act-radius:8px;
  --act-call:#39af6b;  --act-raise:#39af6b;   /* Khớp viền xanh lá PokerNow */
  --act-check:#39af6b;  --act-fold:#df2b1e;
  --turn-dot:#feff03;  --turn-ink:#ffd400;

  /* Raise panel */
  --raise-thumb:#fcb920;  --raise-track:#4a4a4a;
  --raise-go:#3fa76c;  --raise-back:#7b7b7b;
}
```

**Typography:** đổi sang **Mulish** (400–900) qua Google Fonts (CSP đã cho phép), `font-variant-numeric: tabular-nums` cho mọi số. Cinzel chỉ còn ở logo lobby. JQKAs Wild giữ cho rank/suit trên bài.
**Độ sâu:** gần như phẳng. Bỏ `backdrop-filter` và viền trắng mờ trên ghế; chiều sâu chỉ đến từ rail tối quanh nỉ, glow ghế đang tới lượt, aura ghế thắng.

---

## 3. Hợp đồng dữ liệu server (thay đổi chỉ thêm trường)

| Vị trí | Thay đổi | Mục đích |
|---|---|---|
| `room.js` → `awardPot` (CASE 1 và CASE 2) | `r.result.winners[]` và `r.result.allHands[]` thêm `pid: p.pid` | Client khớp ghế theo `pid` thay vì theo tên |
| `room.js` → `awardPot` CASE 2 | `r.result.win5`: mảng chuỗi lá bài (`value+suit`, vd `"Jc"`) là **hợp** các lá `hand.cards` của mọi người thắng (`winningsMap > 0`). CASE 1 (mọi người fold) và `contenders=0`: `win5: []` | Dimming bài chung |
| `server.js` → `rebuy` handler | `p.rebuys = (p.rebuys||0) + 1` khi rebuy thành công | Badge rebuy đỏ |
| `room.js` → `addOrReconnectPlayer` | khởi tạo `rebuys: 0` | — |
| `room.js` → `filterState` | thêm `rebuys: p.rebuys \|\| 0` vào mỗi player | Badge rebuy |

Lưu ý khi làm `win5`: kiểm tra bằng một đoạn node ngắn rằng `Hand.solve(...).cards[i].value` cho ra `'T'` với lá 10 (khớp định dạng của `board`/`hole`) trước khi dựa vào nó. Ranh giới: **không đổi** logic chia pot, thứ tự hành động hay bất kỳ giá trị chip nào.

---

## 4. Lộ trình thực thi

Mỗi bước kết thúc bằng: `npm test` xanh, tóm tắt thay đổi, dừng chờ xác nhận trước khi sang bước tiếp.

### Bước 0 — Baseline
- Chạy `npm test`, ghi lại kết quả hiện tại.
- Rà soát các điểm test phụ thuộc vào `main.js` (xem mục 5.2).
- Eyedropper 5 ảnh, chốt giá trị token, cập nhật mục 2.

### Bước 1 — Table, Board & Deck ✅
**`style.css`**
- Thêm `:root` token mới; đổi font sang Mulish (`index.html` thêm link font).
- Felt: gradient `felt-core→felt→felt-edge`, `--felt-inset`; rail xám đen thay viền xanh; nền arena phẳng `--bg-page`.
- `.card`: phẳng trắng, `--card-shadow`; `.cr` trên-trái; `.cs` đẩy sang **dưới-phải**; màu 4 suit theo token; mặt lưng bài `--card-back` có sọc chéo nhẹ, không logo.
- Lớp `.card.dim { opacity: var(--card-dim-opacity) }`.
- Pot pill: nền `--pot-pill-bg`, số trắng to; nhãn `.pot-total` nhỏ phía trên-phải pill.

**`main.js`**
- `renderGame`: tính `betsOnTable = Σ p.bet`, `mainPot = pot − betsOnTable`; pill hiển thị `mainPot`, nhãn "total X" chỉ hiện khi `betsOnTable > 0`.
- `renderBoard`: nếu `st.phase==='showdown' && st.result?.win5?.length` thì thêm class `dim` cho lá không có trong `win5`.

**`room.js`**: thêm `win5` và `pid` (mục 3).
**Test mới:** `test/p3_1_result_win5.test.js` (`win5` đúng cho showdown thường, tie, fold-win; `pid` có mặt).

### Bước 2 — Seats, Dealer & Bets ✅ (desktop)
**Thứ tự ghế (cả desktop và mobile, chỉ JS):** xoay `players` sao cho hero ở index 0, các ghế sau đi theo chiều kim đồng hồ. `renderSeats` nhận danh sách đã xoay. Mobile tiếp tục dùng `MOBILE_OPP_POS` theo thứ tự này.

**Hình học ghế desktop:** thay `OPP_POS` bằng hàm tham số hóa ellipse, đặt hàm thuần ở mức top-level để test được.
- Tâm `(50%, 48%)`; bán trục khởi điểm `rx≈41%`, `ry≈38%` (tinh chỉnh bằng mắt).
- `N` = số ghế đang hiển thị; ghế `i` (hero `i=0`) có góc `θ = 90° + i·360°/N`; `x = cx + rx·cosθ`, `y = cy + ry·sinθ` (trục y hướng xuống nên tăng góc = chiều kim đồng hồ).

**Ghế (`renderSeats`)**
- Cấu trúc: cặp bài úp bên trái, khối thông tin bên phải (tên + chip). Bỏ `seat-chip-count` xanh trên bài.
- Trạng thái: bình thường (`--seat-bg`); tới lượt (`--seat-bg-turn`, chữ tối, glow, thanh timer đáy); Fold (khối trong suốt + ✕ + "FOLD", không hiển thị bài); `waitingNextHand` → "IN NEXT HAND"; `connected=false` → "OFFLINE" (bài mờ xám); all-in → hiện chữ "All In" thay số chip.
- Badge góc trên-phải: 🏆 `wins` (xanh lá), vòng tròn rebuy `rebuys` (đỏ), chỉ hiện khi > 0.
- Giữ: id `seat-timer-${gIdx}` và vòng RAF của `updateTimer`.

**Lớp `#bets` (desktop):** thêm vào arena, nằm trên felt, dưới ghế.
- Chip cược tại `seatPos + (center − seatPos)·t` với `t≈0.40`; chip tròn `--chip-yellow`, số cược bên trong (dùng `fmt`).
- Dealer button tại điểm `t≈0.22`, lệch góc ~12° để không đè chip; nền `--dealer-bg`, chữ "D" `--dealer-ink`.
- Xóa `.seat-bet` bên trong ghế ở desktop. **Mobile giữ nguyên** `.seat-bet` với `bet-left/right/up/down`.

**Hero desktop:** gộp `renderMyArea` desktop vào `#my-seat` trong arena.
- Hiện `#my-seat` ở desktop (bỏ `display:none !important` trong `@media (min-width:769px)`); bài ngửa to (~0.6× bài chung); pill hạng bài dính đáy (Bước 4); glow khi tới lượt.
- Xóa `my-zone` và `timer-wrap` khỏi `index.html`/`style.css`/`main.js`; nút Rebuy chuyển vào ghế hero.
- Bottom-bar desktop chỉ còn khối hành động.

### Bước 3 — Action Controls & Raise Panel ✅ (desktop)
**Nút hành động**
- `.btn-a`: nền `--act-bg`, viền `--act-border-w` theo token từng nút; chữ cùng màu viền; hover sáng nhẹ; disabled = opacity ~.35.
- Phím tắt `C R K F`: `::after` nằm **trên đường viền** (nền = `--bar-bg`, `padding: 0 6px`).
- Nhãn: `CALL x`; nếu `toCall ≥ me.chips` → `ALL IN x` (x = số chip thực tế sẽ bỏ vào). Thứ tự hiển thị: CALL, RAISE, CHECK, FOLD (như hiện tại).

**Khối lượt:** chấm `--turn-dot` + chữ "YOUR TURN" (`--turn-ink`) phía trên cụm nút. Hộp "EXTRA TIME" **không làm** (P2).

**Raise panel**
- Desktop: dock bên phải bottom-bar (chiếm ~70% chiều rộng, cùng chiều cao với bar), phủ lên hàng nút khi mở.
- Bố cục: ô **Your bet** (nhãn nhỏ, số to, "x.xBB" ở góc, 1 chữ số thập phân) | cột giữa: hàng 5 preset phía trên, dưới là slider có [−]/[+] dính hai đầu (thumb `--raise-thumb`, ray `--raise-track`) | **BACK** (xám, nhãn `ESC`) + nút xác nhận `--raise-go`.
- Nhãn nút xác nhận: `BET` nếu `S.roundBet === 0`, ngược lại `RAISE`.
- **Giữ nguyên logic:** `preset()` (có test `p2_3`), `adjustRaise`, `syncInput/syncSlider`, phím Esc/Enter, `data-click` delegation. Mobile giữ CSS modal hiện có; quy tắc dock chỉ trong `@media (min-width:769px)`.

### Bước 4 — Showdown & Winner Aura ✅
- **Gỡ** `#winner-overlay` (HTML), `showWin/hideWin/cdTimer/confetti` (JS) và CSS liên quan (`.overlay`, `.win-*`, `.confetti*`).
- Ghế thắng (khớp `result.winners[].pid`): nền `--win-seat-bg`, `--win-aura`, pill `+amt` (`--win-plus-bg`, dùng `fmt`). Pot chia → mỗi người thắng một pill.
- Mọi người còn trong ván tại showdown được lật bài (state đã gửi sẵn `hole`); mỗi người có **pill hạng bài** dính đáy bài, lấy từ `result.allHands[].hd`.
- Bài của ghế đã fold (kể cả hero) hiển thị tối/xám.
- Thắng do tất cả fold: không lật bài, không pill hạng, chỉ pill `+amt`.
- Dòng nhỏ "Next hand in Ns" dưới pot (đếm 7s theo `scheduleNextHand`, tính ở client từ lúc nhận kết quả).
- **Hàm rút gọn hạng bài** (top-level, thuần, có test): `Pair, J's` → `PAIR (J)`; `Two Pair, K's & J's` → `TWO PAIR (K,J)`; `Three of a Kind, …` → `TRIPS (x)`; `Full House, …` → `FULL HOUSE`; `Flush, …` → `FLUSH`; `Straight, …` → `STRAIGHT`; `Four of a Kind, …` → `QUADS (x)`; `Straight Flush`/`Royal Flush` giữ nguyên chữ. Pre-flop (`Pair (Ace)`, `Ace-King Suited`) hiển thị không pill.
- Màu pill: san hô cho High Card/Pair/Two Pair; tím-chàm cho Full House trở lên; hạng giữa (Trips/Straight/Flush) **suy ra, ảnh không có** — chọn san hô và ghi chú để duyệt lại.
- **Giữ nguyên:** `hsClass`/`hsIcon` (có test `p2_1`), dù pill mới không dùng chúng.

### Bước 5 — Hardening ✅
- Dọn CSS/JS chết (class và id không còn dùng); đảm bảo không còn tham chiếu phần tử đã xóa.
- Test thêm: `p3_2_seat_geometry` (hình học ellipse + xoay ghế), `p3_3_hand_label` (hàm rút gọn), `p3_4_rebuys` (đếm + `filterState`).
- Chạy checklist mục 8; ghi lại mọi lệch so với ảnh.

---

## 5. Ràng buộc kỹ thuật bắt buộc

### 5.1 Server
- Không đổi logic chia pot, thứ tự hành động, chip invariant. `test/a_chip_invariant`, `test/fuzz_hands`, `test/c_p0_3_refund` phải tiếp tục xanh.
- Chỉ **thêm** trường vào `result`/`filterState`; không đổi tên hoặc xóa trường đang có.

### 5.2 Client
- Các test nạp `public/main.js` trong `vm` với DOM giả rất tối thiểu (`test/p2_*`). Vì vậy: **không** thêm truy cập DOM ở top-level mà không guard null; giữ nguyên các hàm global `fmt`, `hsClass`, `hsIcon`, `preset`, `copyCode`; hàm mới cần test phải là hàm thuần ở top-level.
- CSP: `script-src 'self'`; không inline `onclick`/`oninput`, mọi click đi qua `data-click`.
- `index.html`: giữ `maxlength="16"` ở `c-name`/`j-name`.
- Hàng cược dùng `fmt()` thống nhất với phần còn lại.

### 5.3 Vấn đề đã biết, ngoài phạm vi (chỉ ghi nhận)
- `filterState` vẫn gửi cả người đã `left` giữa ván nên họ còn xuất hiện như ghế.
- `isMobile()` trong JS có kiểm UA, trong khi CSS dựa theo độ rộng: iPad ngang (>768px) sẽ ra bố cục JS-mobile + CSS-desktop. Thuộc phần mobile hoãn.

---

## 6. ⏸️ CHƯA THỰC THI — Hạng mục P2 (đã thiết kế sẵn)

> **Không triển khai trong đợt này.** Ghi lại để làm sau.

### 6.1 Extra Time (phím `T`)
- UI: hộp trắng chữ đen "EXTRA TIME ACTIVATED" dưới "YOUR TURN"; thanh timer thêm đoạn tím cho phần thời gian thêm.
- Server: event `extra_time`, cộng N giây (đề xuất 15s) một lần mỗi ván cho mỗi người; cập nhật `turnMsLeft` (+ `turnSec` hoặc trường `turnExtraMs`); phải reset timer ở `startTurnTimer` và chịu được pause/resume.

### 6.2 Show/Muck
- UI: góc dưới-phải: `SHOW ALL CARDS [S]` và nút từng lá `Q♠ [1]`, `6♠ [2]`.
- Server: event `show_cards {idx:[0,1]}`; lưu `p.shown`; `filterState` lộ các lá đó cho mọi người sau khi ván kết thúc (kể cả người đã fold hoặc thắng do mọi người fold). Cần test cho `filterState`.

### 6.3 Check-or-Fold (phím `I`)
- Thuần client: lưu ý định khi chưa tới lượt; khi tới lượt tự gửi `check` nếu `toCall=0`, ngược lại `fold`. Hủy khi sang street mới hoặc người dùng bấm lại.

### 6.4 Khác
- Avatar/emoji cạnh tên hero; left-rail (Options/Leave seat/Away); chữ "NLH ~ 1/2" và nút âm thanh góc phải; trạng thái `AWAY` (cần thêm cờ ở server).

---

## 7. ⏸️ CHƯA THỰC THI — Chi tiết giao diện mobile (xử lý sau)

- Dùng chip cược trên nỉ và nút dealer kiểu desktop (hiện mobile còn dùng `.seat-bet` bên trong ghế).
- Hợp nhất `#my-seat` mobile với hero desktop; pill hạng bài, glow, aura thắng trên mobile.
- Raise panel mobile theo bố cục chuẩn (hiện giữ modal giữa màn hình).
- Tối ưu stadium felt dọc, vị trí ghế 2–9 người, safe-area iPhone 16 Pro Max.
- Sửa lệch `isMobile()` (JS) và breakpoint CSS.
- Lúc làm lại, dùng cùng token và cùng hàm hình học/nhãn hạng bài đã viết ở đợt này.

---

## 8. Checklist nghiệm thu

### 8.1 Desktop (1440×900 và 1920×1080) — đối chiếu 5 ảnh

**Ảnh 1 — Pre-flop**
- [x] Nỉ emerald + rail xám đen; pill pot đúng; "total X" chỉ hiện khi có cược. (Bước 1)
- [x] Chip cược nằm trên nỉ trước từng ghế; nút D trên mép nỉ cạnh dealer. (Bước 2)
- [x] Thứ tự ghế đúng chiều kim đồng hồ (thử hero ở index đầu / giữa / cuối). (Bước 2)
- [x] CALL/RAISE/CHECK/FOLD đúng viền; phím `C R K F` nằm trên viền. (Bước 3)

**Ảnh 2 — Flop**
- [x] Bài chung 4 màu, suit dưới-phải (Bước 1); hero có pill hạng bài dính đáy (Bước 4).
- [x] Ghế fold hiện ✕ + FOLD; người vào giữa ván hiện IN NEXT HAND. (Bước 2)
- [x] Ghế tới lượt chuyển trắng + thanh timer chạy. (Bước 2)

**Ảnh 3 — River**
- [x] Nhãn `ALL IN x` khi call ≥ chip; RAISE bị vô hiệu đúng lúc. (Bước 3)
- [x] "YOUR TURN" hiện đúng. (Bước 3)

**Ảnh 4 — Showdown**
- [x] Ghế thắng có aura vàng + `+amt`; pot chia có nhiều pill. (Bước 4)
- [x] Lá bài chung ngoài tổ hợp thắng mờ ~35%. (Bước 1)
- [x] Người còn trong ván lật bài + pill hạng; thắng do tất cả fold thì không lật. (Bước 4)
- [x] Không còn modal che bàn; có dòng "Next hand in". (Bước 4)

**Ảnh 5 — Raise panel**
- [x] Số bet to + "x.xBB"; 5 preset trên một hàng; [−]/[+] chỉnh theo BB; thumb cam. (Bước 3)
- [x] BACK có nhãn ESC; nút xác nhận ghi BET khi chưa ai cược, RAISE khi đã có. (Bước 3)
- [x] Esc/Enter hoạt động. (Bước 3)

### 8.2 Mobile — chỉ smoke test (390×844)
- [x] Vào phòng, chơi hết một ván: không lỗi JS ở console; nút hành động và raise modal dùng được. (Bước 5)
- [x] Ghế đối thủ không chồng nhau; bài và chip đọc được; không tràn ngang. (Bước 5)

### 8.3 Hồi quy
- [x] `npm test` xanh toàn bộ, kể cả test mới `p3_*`. (Bước 5)
- [x] Không còn `onclick=`/`oninput=` inline; không lỗi CSP trong console. (Bước 5)
- [x] Reconnect khi chuyển app (token) vẫn khôi phục đúng ghế và timer. (Bước 5)
- [x] Không còn tham chiếu tới id/class đã xóa (`my-zone`, `timer-wrap`, `winner-overlay`, `win-*`). (Bước 5)
