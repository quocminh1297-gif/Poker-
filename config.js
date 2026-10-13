'use strict';

const PORT = process.env.PORT || 3000;
const SUITS = ['s', 'h', 'd', 'c'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const RANK_NAME = {
  '2': 'Two', '3': 'Three', '4': 'Four', '5': 'Five', '6': 'Six', '7': 'Seven',
  '8': 'Eight', '9': 'Nine', 'T': 'Ten', 'J': 'Jack', 'Q': 'Queen', 'K': 'King', 'A': 'Ace'
};
const TURN_SEC = 30;
const RUNOUT_DELAY_MS = process.env.NODE_ENV === 'test' ? 20 : 1800;

const MAX_ROOMS_PER_IP = 5;
const MAX_FAILED_JOINS_PER_IP = 5;
const FAIL_WINDOW_MS = 60000;

let serverRef = null;
function setServerRef(server) {
  serverRef = server;
}

const DISCONNECT_GRACE_MS = () => (serverRef && serverRef.listening && process.env.NODE_ENV !== 'test') ? 25000 : 0;

module.exports = {
  PORT,
  SUITS,
  RANKS,
  RANK_NAME,
  TURN_SEC,
  RUNOUT_DELAY_MS,
  MAX_ROOMS_PER_IP,
  MAX_FAILED_JOINS_PER_IP,
  FAIL_WINDOW_MS,
  setServerRef,
  DISCONNECT_GRACE_MS,
};
