const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

test('P2-10: copyCode provides execCommand fallback when navigator.clipboard is unavailable', async () => {
  const code = fs.readFileSync('public/main.js', 'utf8');

  let execCommandCalled = false;
  let copiedValue = null;
  const buttonEl = { textContent: '📋 Copy' };
  const bodyChildren = [];
  const dummyEl = {
    classList: { add() {}, remove() {}, toggle() {} },
    style: { setProperty() {} },
    textContent: '',
    addEventListener() {},
  };

  const sandbox = {
    window: { matchMedia: () => ({ matches: false }), addEventListener() {} },
    document: {
      addEventListener() {},
      querySelectorAll: () => [],
      getElementById: (id) => id === 'w-code' ? { textContent: 'ABCDEF' } : dummyEl,
      querySelector: sel => sel === '.w-copy' ? buttonEl : dummyEl,
      createElement: tag => {
        if (tag === 'textarea') {
          return {
            set value(v) { copiedValue = v; },
            get value() { return copiedValue; },
            select() {},
            remove() {},
          };
        }
        return dummyEl;
      },
      body: {
        appendChild(el) { bodyChildren.push(el); },
      },
      execCommand: cmd => {
        if (cmd === 'copy') execCommandCalled = true;
      },
    },
    navigator: {}, // No clipboard API on insecure origin
    io: () => ({ on() {}, emit() {} }),
    console: { log() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout: (fn, ms) => fn(),
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  let threw = false;
  try {
    await sandbox.copyCode();
  } catch {
    threw = true;
  }

  assert.equal(threw, false, 'copyCode must not throw');
  assert.equal(execCommandCalled, true, 'Fallback execCommand must be called when clipboard is unavailable');
  assert.equal(copiedValue, 'ABCDEF');
});

test('P2-10: index.html enforces maxlength="16" on name inputs to match server limit', () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  assert.match(html, /id="c-name"[^>]*maxlength="16"/);
  assert.match(html, /id="j-name"[^>]*maxlength="16"/);
});
