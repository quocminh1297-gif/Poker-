const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const server = require('../server.js');

test('P1-7: Deck shuffle uses crypto.randomInt and not Math.random', () => {
  assert.ok(typeof server.mkDeck === 'function', 'mkDeck must be exported');

  let mathRandomCalls = 0;
  const origMathRandom = Math.random;
  Math.random = () => {
    mathRandomCalls++;
    return origMathRandom();
  };

  try {
    const deck = server.mkDeck();
    assert.equal(deck.length, 52, 'Deck must have 52 cards');
    assert.equal(new Set(deck).size, 52, 'Deck cards must be unique');
    assert.equal(mathRandomCalls, 0, 'Math.random must not be called during deck shuffle');
  } finally {
    Math.random = origMathRandom;
  }
});
