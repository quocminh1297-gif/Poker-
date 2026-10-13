const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadMainInVm() {
  const code = fs.readFileSync('public/main.js', 'utf8');
  const dummyEl = {
    classList: { add() {}, remove() {}, toggle() {} },
    style: { setProperty() {} },
    textContent: '',
    value: '',
    innerHTML: '',
    appendChild() {},
    querySelectorAll: () => [],
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
    },
    navigator: { userAgent: '' },
    io: () => ({ on() {}, emit() {} }),
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

test('p3_2: rotatePlayersForHero rotates players so hero is index 0 clockwise', () => {
  const sb = loadMainInVm();
  const rotatePlayersForHero = sb.rotatePlayersForHero;
  assert.equal(typeof rotatePlayersForHero, 'function');

  const p0 = { name: 'P0', isMe: false };
  const p1 = { name: 'P1', isMe: false };
  const p2 = { name: 'P2', isMe: true };
  const p3 = { name: 'P3', isMe: false };
  const p4 = { name: 'P4', isMe: false };

  // When hero is p2 (index 2)
  const rotated = rotatePlayersForHero([p0, p1, p2, p3, p4]);
  assert.equal(rotated.length, 5);
  assert.equal(rotated[0].name, 'P2', 'Hero is index 0');
  assert.equal(rotated[1].name, 'P3');
  assert.equal(rotated[2].name, 'P4');
  assert.equal(rotated[3].name, 'P0');
  assert.equal(rotated[4].name, 'P1');

  // When hero is already index 0
  const rotated0 = rotatePlayersForHero([p2, p3, p4, p0, p1]);
  assert.equal(rotated0[0].name, 'P2');
  assert.equal(rotated0[1].name, 'P3');

  // When hero is at the end
  const rotatedEnd = rotatePlayersForHero([p0, p1, p2]);
  assert.equal(rotatedEnd[0].name, 'P2');
  assert.equal(rotatedEnd[1].name, 'P0');
  assert.equal(rotatedEnd[2].name, 'P1');

  // Empty or invalid inputs
  assert.equal(rotatePlayersForHero([]).length, 0);
  assert.equal(rotatePlayersForHero(null).length, 0);
});

test('p3_2: getSeatCoordinates computes clockwise ellipse layout with hero at bottom', () => {
  const sb = loadMainInVm();
  const getSeatCoordinates = sb.getSeatCoordinates;
  assert.equal(typeof getSeatCoordinates, 'function');

  // For N = 4:
  // Hero (i = 0) at 90 deg -> bottom center: x=50, y=48+38=86
  const c0 = getSeatCoordinates(0, 4);
  assert.equal(c0.x, 50);
  assert.equal(c0.y, 86);

  // i = 1 at 180 deg -> left center: x=50-41=9, y=48
  const c1 = getSeatCoordinates(1, 4);
  assert.equal(c1.x, 9);
  assert.equal(c1.y, 48);

  // i = 2 at 270 deg -> top center: x=50, y=48-38=10
  const c2 = getSeatCoordinates(2, 4);
  assert.equal(c2.x, 50);
  assert.equal(c2.y, 10);

  // i = 3 at 360/0 deg -> right center: x=50+41=91, y=48
  const c3 = getSeatCoordinates(3, 4);
  assert.equal(c3.x, 91);
  assert.equal(c3.y, 48);
});

test('p3_2: getBetCoordinates and getDealerCoordinates compute positions on felt', () => {
  const sb = loadMainInVm();
  const getSeatCoordinates = sb.getSeatCoordinates;
  const getBetCoordinates = sb.getBetCoordinates;
  const getDealerCoordinates = sb.getDealerCoordinates;

  assert.equal(typeof getBetCoordinates, 'function');
  assert.equal(typeof getDealerCoordinates, 'function');

  const seatPos = getSeatCoordinates(0, 4); // (50, 86)
  const betPos = getBetCoordinates(seatPos); // (50, 86 + (48-86)*0.4) = (50, 70.8)
  assert.equal(betPos.x, 50);
  assert.equal(betPos.y, 70.8);

  const dealerPos = getDealerCoordinates(0, 4);
  assert.ok(dealerPos.x > 0 && dealerPos.x < 100);
  assert.ok(dealerPos.y > 0 && dealerPos.y < 100);
  // Dealer pos should not overlap with bet pos
  assert.notEqual(`${dealerPos.x},${dealerPos.y}`, `${betPos.x},${betPos.y}`);
});
