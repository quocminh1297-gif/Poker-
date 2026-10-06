const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

test('P2-1: Hand strength badge regex matching prevents substring false positives', () => {
  const code = fs.readFileSync('public/main.js', 'utf8');
  const dummyEl = {
    classList: { add() {}, remove() {}, toggle() {} },
    style: {},
    textContent: '',
    value: '',
    addEventListener() {},
  };
  const sandbox = {
    window: { matchMedia: () => ({ matches: false }), addEventListener() {} },
    document: {
      addEventListener() {},
      querySelectorAll: () => [],
      getElementById: () => dummyEl,
      querySelector: () => dummyEl,
    },
    navigator: { userAgent: '' },
    io: () => ({ on() {}, emit() {} }),
    console: { log() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const hsClass = sandbox.hsClass;
  const hsIcon = sandbox.hsIcon;

  assert.equal(typeof hsClass, 'function');
  assert.equal(typeof hsIcon, 'function');

  // "Ace-Four" or "Pair (Four)" should NOT be classified as Quads (Four of a Kind)
  assert.notEqual(hsClass('Ace-Four Suited'), 'hs-quads');
  assert.notEqual(hsIcon('Ace-Four Suited'), '🎯');
  assert.equal(hsClass('Ace-Four Suited'), 'hs-hc');

  // "Pair (Three)" should be classified as Pair, NOT Trips (Three of a Kind)
  assert.equal(hsClass('Pair of Threes'), 'hs-pair');
  assert.equal(hsIcon('Pair of Threes'), '👥');

  // "Four of a Kind" should be Quads
  assert.equal(hsClass('Four of a Kind, Fours'), 'hs-quads');
  assert.equal(hsIcon('Four of a Kind, Fours'), '🎯');

  // "Three of a Kind" should be Trips
  assert.equal(hsClass('Three of a Kind, Kings'), 'hs-trips');
  assert.equal(hsIcon('Three of a Kind, Kings'), '3️⃣');
});
