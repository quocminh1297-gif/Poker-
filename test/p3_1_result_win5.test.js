const test = require('node:test');
const assert = require('node:assert/strict');
const { Hand } = require('pokersolver');
const { setupRoom, cleanupAllRooms } = require('./helpers');
const { awardPot } = require('../room');

test('p3_1: result contains win5 and pid for normal showdown, tie, and fold-win', (t) => {
  t.after(cleanupAllRooms);

  // 1. Normal showdown: 2 players, board has 5 cards
  const { r: r1 } = setupRoom(2);
  const p0 = r1.players[0];
  const p1 = r1.players[1];
  p0.totalBet = 1000;
  p1.totalBet = 1000;
  r1.pot = 2000;
  r1.board = ['Jc', '3d', 'Js', 'Kh', '5s'];
  p0.hole = ['3c', '3h']; // Full House 3s full of Js
  p1.hole = ['Kc', '2c']; // Two Pair Ks & Js

  const ev1 = [
    { player: p0, hand: Hand.solve([...p0.hole, ...r1.board]) },
    { player: p1, hand: Hand.solve([...p1.hole, ...r1.board]) },
  ];
  awardPot(r1, [p0, p1], ev1);

  assert.ok(r1.result, 'result exists');
  assert.equal(r1.result.winners.length, 1);
  assert.equal(r1.result.winners[0].pid, p0.pid, 'winner has pid');
  assert.equal(r1.result.allHands.length, 2);
  assert.equal(r1.result.allHands[0].pid, p0.pid, 'allHands has pid');
  assert.equal(r1.result.allHands[1].pid, p1.pid, 'allHands has pid');
  assert.ok(Array.isArray(r1.result.win5), 'win5 is array');
  assert.equal(r1.result.win5.length, 5, 'win5 has 5 cards');
  // Full house of 3s and Js must include 3c, 3h, 3d, Jc, Js
  const expectedCards = ['3c', '3h', '3d', 'Js', 'Jc'];
  for (const card of expectedCards) {
    assert.ok(r1.result.win5.includes(card), `win5 includes ${card}`);
  }

  // 2. Tie (split pot): both players share the pot
  const { r: r2 } = setupRoom(2);
  const p2_0 = r2.players[0];
  const p2_1 = r2.players[1];
  p2_0.totalBet = 1000;
  p2_1.totalBet = 1000;
  r2.pot = 2000;
  r2.board = ['As', 'Ks', 'Qs', 'Js', 'Ts'];
  p2_0.hole = ['2c', '3c'];
  p2_1.hole = ['2d', '3d'];
  const ev2 = [
    { player: p2_0, hand: Hand.solve([...p2_0.hole, ...r2.board]) },
    { player: p2_1, hand: Hand.solve([...p2_1.hole, ...r2.board]) },
  ];
  awardPot(r2, [p2_0, p2_1], ev2);
  assert.equal(r2.result.winners.length, 2, 'two winners in split pot');
  assert.equal(r2.result.winners[0].pid, p2_0.pid);
  assert.equal(r2.result.winners[1].pid, p2_1.pid);
  assert.equal(r2.result.win5.length, 5);
  for (const card of ['As', 'Ks', 'Qs', 'Js', 'Ts']) {
    assert.ok(r2.result.win5.includes(card), `win5 includes ${card}`);
  }

  // 3. Fold-win: all opponents folded
  const { r: r3 } = setupRoom(2);
  const p3_0 = r3.players[0];
  p3_0.totalBet = 500;
  r3.pot = 500;
  awardPot(r3, [p3_0], null);
  assert.ok(r3.result);
  assert.equal(r3.result.winners[0].pid, p3_0.pid);
  assert.deepEqual(r3.result.win5, [], 'fold-win has empty win5');

  // 4. 0 contenders:
  const { r: r4 } = setupRoom(2);
  awardPot(r4, [], null);
  assert.deepEqual(r4.result.win5, [], 'empty contenders has empty win5');
});
