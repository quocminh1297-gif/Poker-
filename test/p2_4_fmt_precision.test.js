const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

test('P2-4: fmt() preserves 1 decimal place without premature integer rounding', () => {
  const code = fs.readFileSync('public/main.js', 'utf8');
  const dummyEl = { classList: { add() {}, remove() {}, toggle() {} }, style: { setProperty() {} }, textContent: '', value: '', addEventListener() {} };
  const sandbox = {
    window: { matchMedia: () => ({ matches: false }), addEventListener() {} },
    document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => dummyEl, querySelector: () => dummyEl },
    navigator: { userAgent: '' },
    io: () => ({ on() {}, emit() {} }),
    console: { log() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const fmt = sandbox.fmt;
  assert.equal(typeof fmt, 'function');

  assert.equal(fmt(15600), '15.6K', '15600 should format as 15.6K, not rounded 16K');
  assert.equal(fmt(10499), '10.5K', '10499 should format as 10.5K');
  assert.equal(fmt(10000), '10K', '10000 should format cleanly as 10K');
  assert.equal(fmt(1500000), '1.5M', '1500000 should format as 1.5M');
  assert.equal(fmt(2000), '2,000', '<10000 should use toLocaleString');
});
