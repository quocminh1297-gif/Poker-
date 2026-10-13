const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const { app, server } = require('../server.js');

test('P2-8: Helmet CSP header is present and no inline event attributes in index.html', async t => {
  if (!server.listening) {
    await new Promise(resolve => server.listen(0, resolve));
  }
  const port = server.address().port;

  t.after(async () => {
    if (server.listening) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  // 1. Verify CSP header on HTTP GET /
  const res = await new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}/`, res => {
      resolve(res);
    }).on('error', reject);
  });

  assert.equal(res.statusCode, 200);
  const csp = res.headers['content-security-policy'];
  assert.ok(csp, 'Content-Security-Policy header must be present');
  assert.match(csp, /script-src [^;]*'self'/);

  // 2. Verify index.html does not contain inline onclick or oninput
  const html = fs.readFileSync('public/index.html', 'utf8');
  assert.equal(html.includes('onclick='), false, 'index.html must not contain inline onclick=');
  assert.equal(html.includes('oninput='), false, 'index.html must not contain inline oninput=');
});
