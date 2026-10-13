const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadMainInVm() {
  const code = fs.readFileSync('public/main.js', 'utf8');
  const dummyEl = {
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    style: { setProperty() {} },
    textContent: '',
    innerHTML: '',
    appendChild() {},
    setAttribute() {},
    getAttribute() { return null; },
    dataset: {},
    addEventListener() {},
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
      body: dummyEl,
    },
    navigator: { userAgent: '' },
    io: () => ({ on() {}, emit() {} }),
    console: { log() {}, error() {} },
    requestAnimationFrame: fn => setTimeout(fn, 16),
    cancelAnimationFrame: id => clearTimeout(id),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: id => clearTimeout(id),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: id => clearInterval(id),
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

test('p3_3: shortenHandLabel shortens showdown hand descriptions properly and ignores preflop', () => {
  const sb = loadMainInVm();
  const shortenHandLabel = sb.shortenHandLabel;
  assert.equal(typeof shortenHandLabel, 'function', 'shortenHandLabel must be a top-level function');

  // Pair
  assert.equal(shortenHandLabel("Pair, J's"), 'PAIR (J)');
  assert.equal(shortenHandLabel("Pair, A's"), 'PAIR (A)');
  assert.equal(shortenHandLabel("Pair, 10's"), 'PAIR (10)');

  // Two Pair
  assert.equal(shortenHandLabel("Two Pair, K's & J's"), 'TWO PAIR (K,J)');
  assert.equal(shortenHandLabel("Two Pair, A's & 8's"), 'TWO PAIR (A,8)');

  // Three of a Kind
  assert.equal(shortenHandLabel("Three of a Kind, 8's"), 'TRIPS (8)');
  assert.equal(shortenHandLabel("Three of a Kind, Q's"), 'TRIPS (Q)');

  // Full House
  assert.equal(shortenHandLabel("Full House, J's full of 3's"), 'FULL HOUSE');

  // Flush
  assert.equal(shortenHandLabel("Flush, K High"), 'FLUSH');

  // Straight
  assert.equal(shortenHandLabel("Straight, 9 High"), 'STRAIGHT');

  // Four of a Kind
  assert.equal(shortenHandLabel("Four of a Kind, 4's"), 'QUADS (4)');

  // Straight Flush & Royal Flush
  assert.equal(shortenHandLabel("Straight Flush, King High"), 'STRAIGHT FLUSH');
  assert.equal(shortenHandLabel("Royal Flush"), 'ROYAL FLUSH');

  // Pre-flop representations (no pill)
  assert.equal(shortenHandLabel("Pair (Ace)"), null);
  assert.equal(shortenHandLabel("Ace-King Suited"), null);
  assert.equal(shortenHandLabel("King-Queen Offsuit"), null);

  // Null/Empty/Invalid
  assert.equal(shortenHandLabel(null), null);
  assert.equal(shortenHandLabel(''), null);
  assert.equal(shortenHandLabel(undefined), null);

  // Pill color classes
  const getHandPillClass = sb.getHandPillClass;
  assert.equal(typeof getHandPillClass, 'function', 'getHandPillClass must be a top-level function');
  assert.equal(getHandPillClass('PAIR (J)'), 'pill-coral');
  assert.equal(getHandPillClass('TWO PAIR (K,J)'), 'pill-coral');
  assert.equal(getHandPillClass('TRIPS (8)'), 'pill-coral');
  assert.equal(getHandPillClass('STRAIGHT'), 'pill-coral');
  assert.equal(getHandPillClass('FLUSH'), 'pill-coral');
  assert.equal(getHandPillClass('FULL HOUSE'), 'pill-indigo');
  assert.equal(getHandPillClass('QUADS (4)'), 'pill-indigo');
  assert.equal(getHandPillClass('STRAIGHT FLUSH'), 'pill-indigo');
  assert.equal(getHandPillClass('ROYAL FLUSH'), 'pill-indigo');
  assert.equal(getHandPillClass(null), '');
});

