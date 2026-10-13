const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

test('P2-3: Pot preset buttons calculate pot-sized bet including call amount', () => {
  const code = fs.readFileSync('public/main.js', 'utf8');
  let inputValue = 0;
  const dummyEl = {
    classList: { add() {}, remove() {}, toggle() {} },
    style: { setProperty() {} },
    textContent: '',
    min: '0',
    max: '20000',
    get value() { return inputValue; },
    set value(v) { inputValue = v; },
    addEventListener() {},
    appendChild() {},
    dataset: {},
  };

  const socketCallbacks = {};
  const socketMock = {
    on(ev, cb) { socketCallbacks[ev] = cb; },
    emit() {},
  };

  const sandbox = {
    window: { matchMedia: () => ({ matches: false }), addEventListener() {} },
    document: {
      addEventListener() {},
      querySelectorAll: () => [],
      getElementById: () => dummyEl,
      querySelector: () => dummyEl,
      createElement: () => dummyEl,
      createDocumentFragment: () => dummyEl,
    },
    navigator: { userAgent: '' },
    io: () => socketMock,
    console: { log() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  // Set state S via Socket 'state' event handler
  socketCallbacks['state']({
    status: 'playing',
    pot: 3000,
    roundBet: 1000,
    lastRaise: 1000,
    curIdx: 0,
    dealerIdx: 0,
    board: [],
    msgs: [],
    cfg: { bb: 400, sb: 200 },
    players: [
      { isMe: true, chips: 10000, bet: 0, hole: [], active: true, connected: true },
      { isMe: false, chips: 10000, bet: 1000, hole: [], active: true, connected: true },
    ],
  });

  // When v = 1 (1.0 POT):
  // toCall = roundBet - me.bet = 1000 - 0 = 1000
  // target = roundBet + (pot + toCall) * 1 = 1000 + (3000 + 1000) = 5000
  sandbox.preset(1);
  assert.equal(inputValue, 5000, '1.0 POT raise should be 5000 (rb 1000 + pot 3000 + toCall 1000)');

  // When v = 0.5 (1/2 POT):
  // target = 1000 + (3000 + 1000) * 0.5 = 1000 + 2000 = 3000
  sandbox.preset(0.5);
  assert.equal(inputValue, 3000, '0.5 POT raise should be 3000');
});
