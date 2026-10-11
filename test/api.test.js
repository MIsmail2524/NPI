'use strict';
/* End-to-end API tests: security rules, pricing and stock logic.
   Runs a real server on a throwaway database:  npm test */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'npi-test-'));
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const ENV = { ...process.env, NPI_DATA_DIR: DATA, PORT: String(PORT), NODE_ENV: 'test', NPI_RATE_MULT: '20', NPI_UPLOAD_DIR: path.join(DATA, 'uploads') };
let server;

/** Tiny cookie-keeping client that behaves like a browser on our origin. */
function client() {
  let cookie = ''; let csrf = null;
  const call = async (method, url, body, { noCsrf = false, origin = BASE } = {}) => {
    const headers = { 'Content-Type': 'application/json', Origin: origin };
    if (cookie) headers.Cookie = cookie;
    if (csrf && !noCsrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
    const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) { const kv = c.split(';')[0]; if (kv.endsWith('=')) cookie = ''; else cookie = kv; }
    let data = null; try { data = await res.json(); } catch { /* not json */ }
    if (data?.csrf) csrf = data.csrf;
    return { status: res.status, data, headers: res.headers };
  };
  const upload = async (buf, name) => {
    const fd = new FormData(); fd.append('file', new Blob([buf]), name);
    const res = await fetch(`${BASE}/api/admin/uploads`, { method: 'POST', body: fd, headers: { Cookie: cookie, 'X-CSRF-Token': csrf, Origin: BASE } });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { upload, get: (u, o) => call('GET', u, undefined, o), post: (u, b, o) => call('POST', u, b, o), put: (u, b, o) => call('PUT', u, b, o), patch: (u, b, o) => call('PATCH', u, b, o), del: (u, o) => call('DELETE', u, undefined, o), me: () => call('GET', '/api/auth/me') };
}

before(async () => {
  execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/create-owner.js'], {
    cwd: ROOT, env: { ...ENV, OWNER_EMAIL: 'boss@npi.test', OWNER_NAME: 'Boss', OWNER_PASSWORD: 'Owner2026pass' }, stdio: 'ignore'
  });
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: ROOT, env: ENV, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/api/store`)).ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
after(() => { server?.kill(); fs.rmSync(DATA, { recursive: true, force: true }); });

test('real catalog is loaded with photos', async () => {
  const r = await (await fetch(`${BASE}/api/products`)).json();
  assert.equal(r.total, 57);
  assert.ok(r.products.every((p) => p.images.length > 0));
  assert.ok(r.products.every((p) => p.images.every((u) => u.startsWith('/uploads/'))));
});

test('security headers are present', async () => {
  const res = await fetch(`${BASE}/`);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('owner area is locked to the owner', async () => {
  const anon = client();
  assert.equal((await anon.get('/api/admin/products')).status, 401);
  const page = await fetch(`${BASE}/admin`, { redirect: 'manual' });
  assert.equal(page.status, 302);
  const js = await fetch(`${BASE}/admin/admin.js`);
  assert.equal(js.status, 404);

  const cust = client();
  await cust.me();
  const reg = await cust.post('/api/auth/register', { name: 'Ali', email: 'ali@example.com', password: 'Customer2026' });
  assert.equal(reg.status, 201);
  assert.equal((await cust.get('/api/admin/products')).status, 403);
  assert.equal((await cust.patch('/api/admin/products/1', { field: 'price', value: 1 })).status, 403);
});

test('CSRF token and same-origin are required for changes', async () => {
  const boss = client();
  await boss.post('/api/auth/login', { email: 'boss@npi.test', password: 'Owner2026pass' });
  assert.equal((await boss.patch('/api/admin/products/1', { field: 'price', value: 99900 }, { noCsrf: true })).status, 403);
  assert.equal((await boss.patch('/api/admin/products/1', { field: 'price', value: 99900 }, { origin: 'https://evil.example' })).status, 403);
  const ok = await boss.patch('/api/admin/products/1', { field: 'price', value: 99900 });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.product.price, 99900);
  assert.equal(ok.data.product.priceConfirmed, true);
});

test('weak passwords are rejected and wrong logins lock the account', async () => {
  const c = client();
  const weak = await c.post('/api/auth/register', { name: 'X', email: 'x@example.com', password: 'password' });
  assert.equal(weak.status, 400);
  await c.post('/api/auth/register', { name: 'Lock', email: 'lock@example.com', password: 'Locktest2026' });
  await c.post('/api/auth/logout', {});
  const d = client();
  for (let i = 0; i < 5; i++) assert.equal((await d.post('/api/auth/login', { email: 'lock@example.com', password: 'wrong-pass1' })).status, 401);
  const locked = await d.post('/api/auth/login', { email: 'lock@example.com', password: 'Locktest2026' });
  assert.equal(locked.status, 429, 'correct password is refused while locked');
});

test('orders use server prices, reduce stock, and cancelling restocks', async () => {
  const c = client();
  await c.me();
  await c.post('/api/auth/register', { name: 'Buyer', email: 'buyer@example.com', password: 'Buyer2026x' });
  const { data: { products } } = await c.get('/api/products?sort=name');
  const p = products.find((x) => x.stock.status === 'in');
  const boss = client();
  await boss.post('/api/auth/login', { email: 'boss@npi.test', password: 'Owner2026pass' });
  const before = (await boss.get(`/api/admin/products/${p.id}`)).data.product.stockCount;

  const order = await c.post('/api/orders', {
    items: [{ productId: p.id, qty: 2, price: 1 }], // a tampered client price must be ignored
    name: 'Buyer', phone: '03001234567', city: 'Lahore', address: 'Shop 1, Main Road', payment: 'cod'
  });
  assert.equal(order.status, 201);
  assert.equal(order.data.total, p.pricing.price * 2 + (p.pricing.price * 2 >= 1000000 ? 0 : 25000));
  const afterOrder = (await boss.get(`/api/admin/products/${p.id}`)).data.product.stockCount;
  assert.equal(afterOrder, before - 2);

  // another customer cannot read this order
  const other = client();
  await other.me();
  await other.post('/api/auth/register', { name: 'Nosy', email: 'nosy@example.com', password: 'Nosy2026xx' });
  assert.equal((await other.get(`/api/orders/${order.data.code}`)).status, 404);

  assert.equal((await c.post(`/api/orders/${order.data.code}/cancel`, {})).status, 200);
  assert.equal((await boss.get(`/api/admin/products/${p.id}`)).data.product.stockCount, before);
});

test('cannot buy more than is in stock', async () => {
  const boss = client();
  await boss.post('/api/auth/login', { email: 'boss@npi.test', password: 'Owner2026pass' });
  await boss.patch('/api/admin/products/2', { field: 'stock', value: 1 });
  const c = client();
  await c.me();
  await c.post('/api/auth/register', { name: 'Greedy', email: 'greedy@example.com', password: 'Greedy2026' });
  const r = await c.post('/api/orders', { items: [{ productId: 2, qty: 5 }], name: 'G', phone: '03001234567', city: 'Lahore', address: 'X road', payment: 'cod' });
  assert.equal(r.status, 409);
  assert.equal(r.data.quote.lines[0].problem, 'reduced');
});

test('uploads accept real images only', async () => {
  const anon = await fetch(`${BASE}/api/admin/uploads`, { method: 'POST' });
  assert.ok([401, 403].includes(anon.status), 'anonymous upload blocked');
  const boss = client();
  await boss.post('/api/auth/login', { email: 'boss@npi.test', password: 'Owner2026pass' });
  // HTML/script disguised with an image name is rejected: the type is decided by the file's bytes
  const fake = await boss.upload(Buffer.from('<script>alert(1)</script>'), 'photo.jpg');
  assert.equal(fake.status, 400);
  const svg = await boss.upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'x.svg');
  assert.equal(svg.status, 400);
  // a real PNG is accepted and gets a random name
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b30000000049454e44ae426082', 'hex');
  const ok = await boss.upload(png, '../../../etc/passwd.png');
  assert.equal(ok.status, 201);
  assert.match(ok.data.url, /^\/uploads\/[a-f0-9]{32}\.png$/);
  const served = await fetch(BASE + ok.data.url);
  assert.equal(served.status, 200);
  assert.match(served.headers.get('content-security-policy'), /sandbox/);
});

test('Jumma Deal is scheduled for Fridays', async () => {
  const s = await (await fetch(`${BASE}/api/store`)).json();
  const jumma = s.promotions.find((p) => p.name === 'Jumma Deal');
  assert.ok(jumma, 'jumma deal present');
  assert.equal(jumma.days_of_week, '5');
});

test('product video setup and Tool Finder tags are validated', async () => {
  const boss = client();
  await boss.post('/api/auth/login', { email: 'boss@npi.test', password: 'Owner2026pass' });
  const { data } = await boss.get('/api/admin/products/1');
  const p = data.product;
  const body = {
    name: p.name, sku: p.sku, category_id: p.category_id, description: p.description, specs: p.specs, uses: p.uses,
    price: p.price, sale_price: p.sale_price, low_stock_threshold: p.low_stock_threshold, images: p.images, active: true,
    demo: { type: '<script>', pivot: [0.5, 'x'], tip: [0.2, 0.3], spots: [[0.1, 0.2], 'bad', [9, 9]], hinge: 'cross', evil: 'yes', flip: { handle: 1, rod: 99 } },
    tags: ['electrical', 'not-a-real-tag', '<img>']
  };
  const r = await boss.put('/api/admin/products/1', body);
  assert.equal(r.status, 200);
  const demo = r.data.product.demo;
  assert.equal(demo.type, undefined, 'unknown demo type dropped');
  assert.equal(demo.pivot, undefined, 'malformed point dropped');
  assert.deepEqual(demo.tip, [0.2, 0.3]);
  assert.deepEqual(demo.spots, [[0.1, 0.2], null, null]);
  assert.equal(demo.evil, undefined);
  assert.equal(demo.flip, undefined, 'out-of-range image index dropped');
  assert.deepEqual(r.data.product.tags, ['electrical']);
  const store = await (await fetch(`${BASE}/api/store`)).json();
  assert.ok(store.tags.electrical, 'tag vocabulary is published for the Tool Finder');
});
