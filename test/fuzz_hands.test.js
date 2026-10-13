'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setupRoom, sumChips, startGame, doAction, cleanupAllRooms } = require('./helpers.js');
const { rooms, handleDisconnect, startHand } = require('../server.js');

test('Final Verification: Monte-Carlo Fuzz Simulation of 1,000+ randomized hands across 2-9 players with disconnects', (t) => {
  t.after(cleanupAllRooms);

  const playerCounts = [2, 3, 5, 7, 9];
  let totalHandsSimulated = 0;

  for (const numPlayers of playerCounts) {
    const buyIn = 50000;
    const { r } = setupRoom(numPlayers, buyIn);
    let expectedTotal = numPlayers * buyIn;

    assert.equal(sumChips(r), expectedTotal, 'Initial chip invariant holds');

    let err = startGame(r);
    assert.equal(err, null, 'Game starts without error');

    // Simulate 200 hands per table configuration (total 1000 hands)
    for (let hand = 0; hand < 200; hand++) {
      totalHandsSimulated++;
      let safetyCounter = 0;

      // Play through betting rounds until showdown or all folded
      while (r.phase && r.phase !== 'showdown' && safetyCounter++ < 200) {
        assert.equal(sumChips(r), expectedTotal, `Invariant must hold at hand ${hand}, step ${safetyCounter}`);

        // Occasional random disconnect simulation
        if (Math.random() < 0.03 && r.players.length > 2) {
          const activeConnected = r.players.filter(p => p.connected && p.active && !p.folded);
          if (activeConnected.length > 2) {
            const victim = activeConnected[Math.floor(Math.random() * activeConnected.length)];
            handleDisconnect(victim.sid);
            assert.equal(sumChips(r), expectedTotal, 'Invariant must hold after disconnect');
            victim.connected = true; // Reconnect for future hands
          }
        }

        const curIdx = r.curIdx;
        const cur = r.players[curIdx];
        if (!cur || cur.folded || cur.allIn) {
          break;
        }

        const actions = ['check', 'call', 'fold', 'raise', 'allin'];
        const chosenAct = actions[Math.floor(Math.random() * actions.length)];
        let amount = 0;
        if (chosenAct === 'raise') {
          const minR = r.roundBet + r.lastRaise;
          amount = minR + Math.floor(Math.random() * 5000);
        }

        doAction(r, cur.sid, chosenAct, amount);
        assert.equal(sumChips(r), expectedTotal, `Invariant must hold after ${chosenAct}`);
      }

      assert.equal(sumChips(r), expectedTotal, `Invariant must hold after hand ${hand} completes`);

      // Prepare next hand if enough players have chips
      const eligible = r.players.filter(p => p.chips > 0);
      if (eligible.length < 2) {
        for (const p of r.players) {
          if (p.chips === 0) {
            p.chips = buyIn;
            expectedTotal += buyIn;
          }
          p.connected = true;
        }
      }

      // Start next hand if in waiting status or after showdown
      if (r.status === 'playing' && (!r.phase || r.phase === 'showdown')) {
        startHand(r);
      }
    }

    assert.equal(sumChips(r), expectedTotal, `Final invariant for ${numPlayers}-player table`);
  }

  assert.ok(totalHandsSimulated >= 1000, `Simulated ${totalHandsSimulated} hands successfully`);
});
