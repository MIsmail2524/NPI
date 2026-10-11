'use strict';
/* Public storefront + customer endpoints. */
const express = require('express');
const { db, tx } = require('../db');
const S = require('../security');
const limits = require('../limits');
const { pricingContext, promoSummaries } = require('../pricing');
const { categoriesById, toPublic, TAGS } = require('../catalog');
const { quote, placeOrder, restockOrder, orderWithItems } = require('../orders');

const router = express.Router();

const PUBLIC_SETTING_KEYS = ['store_name', 'tagline', 'hero_title', 'hero_text', 'announcement', 'currency', 'timezone',
  'delivery_fee', 'free_delivery_over', 'contact_email', 'contact_phone', 'contact_whatsapp', 'address', 'about_text', 'allow_orders'];

function liveProducts() {
  return db.prepare('SELECT * FROM products WHERE active = 1 AND deleted_at IS NULL').all();
}

/* ---------- store bootstrap: settings, categories, live/upcoming promos ---------- */
router.get('/store', (req, res) => {
  const ctx = pricingContext();
  const settings = {};
  for (const k of PUBLIC_SETTING_KEYS) settings[k] = ctx.settings[k];
  const counts = new Map(db.prepare(`SELECT category_id, COUNT(*) AS n FROM products
                                     WHERE active = 1 AND deleted_at IS NULL GROUP BY category_id`).all().map((r) => [r.category_id, r.n]));
  const categories = [...categoriesById().values()].map((c) => ({ id: c.id, slug: c.slug, name: c.name, icon: c.icon, image: c.image, count: counts.get(c.id) || 0 }));
  const stats = db.prepare(`SELECT COUNT(*) AS skus, COALESCE(SUM(sold_count),0) AS sold FROM products WHERE active = 1 AND deleted_at IS NULL`).get();
  const customers = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'customer'`).get().n;
  res.json({ settings, categories, promotions: promoSummaries(ctx), stats: { ...stats, customers }, tags: TAGS, serverTime: Date.now() });
});

/* ---------- product listing with filters ---------- */
router.get('/products', (req, res) => {
  const ctx = pricingContext();
  const cats = categoriesById();
  const q = S.cleanText(req.query.q, { max: 80 }).toLowerCase();
  const category = S.cleanText(req.query.category, { max: 80 });
  const sort = ['featured', 'price_asc', 'price_desc', 'newest', 'popular', 'name', 'discount'].includes(req.query.sort) ? req.query.sort : 'featured';
  const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 200));

  let list = liveProducts().map((p) => toPublic(p, ctx, cats));
  if (category) list = list.filter((p) => p.category?.slug === category);
  if (req.query.onSale === '1') list = list.filter((p) => p.pricing.onSale);
  if (req.query.inStock === '1') list = list.filter((p) => p.stock.status !== 'out');
  if (req.query.featured === '1') list = list.filter((p) => p.featured);
  if (req.query.promo) {
    const pid = Number(req.query.promo);
    list = list.filter((p) => p.pricing.promoId === pid || p.pricing.upcoming);
  }
  if (q) {
    const terms = q.split(/\s+/).filter(Boolean);
    list = list.filter((p) => {
      const hay = `${p.name} ${p.sku} ${p.category?.name || ''} ${p.description} ${p.specs.map((s) => `${s.label} ${s.value}`).join(' ')} ${p.uses.join(' ')}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }
  const sorters = {
    featured: (a, b) => (b.featured - a.featured) || (b.pricing.onSale - a.pricing.onSale) || (b.sold - a.sold),
    price_asc: (a, b) => a.pricing.price - b.pricing.price,
    price_desc: (a, b) => b.pricing.price - a.pricing.price,
    newest: (a, b) => b.createdAt - a.createdAt,
    popular: (a, b) => b.sold - a.sold,
    name: (a, b) => a.name.localeCompare(b.name),
    discount: (a, b) => b.pricing.savePercent - a.pricing.savePercent
  };
  list.sort(sorters[sort]);
  // out-of-stock items always sink to the bottom
  list.sort((a, b) => (a.stock.status === 'out') - (b.stock.status === 'out'));
  res.json({ products: list.slice(0, limit), total: list.length });
});

router.get('/products/:slug', (req, res) => {
  const slug = S.cleanText(req.params.slug, { max: 100 });
  const p = db.prepare('SELECT * FROM products WHERE slug = ? AND active = 1 AND deleted_at IS NULL').get(slug);
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  const ctx = pricingContext();
  const cats = categoriesById();
  const product = toPublic(p, ctx, cats);
  const reviews = db.prepare(`SELECT r.id, r.rating, r.body, r.created_at AS createdAt, u.name
                              FROM reviews r JOIN users u ON u.id = r.user_id
                              WHERE r.product_id = ? AND r.hidden = 0 ORDER BY r.created_at DESC LIMIT 50`).all(p.id)
    .map((r) => ({ ...r, name: r.name.split(' ')[0] })); // first name only (privacy)
  const related = liveProducts().filter((x) => x.id !== p.id)
    .sort((a, b) => ((b.category_id === p.category_id) - (a.category_id === p.category_id)) || (b.sold_count - a.sold_count))
    .slice(0, 8).map((x) => toPublic(x, ctx, cats));
  let canReview = false;
  if (req.user) {
    const bought = db.prepare(`SELECT 1 FROM orders o JOIN order_items oi ON oi.order_id = o.id
                               WHERE o.user_id = ? AND oi.product_id = ? AND o.status = 'delivered' LIMIT 1`).get(req.user.id, p.id);
    const already = db.prepare('SELECT 1 FROM reviews WHERE user_id = ? AND product_id = ?').get(req.user.id, p.id);
    canReview = !!bought && !already;
  }
  const weekAgo = Date.now() - 7 * 86400000;
  const soldThisWeek = db.prepare(`SELECT COALESCE(SUM(oi.qty),0) AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id
                                   WHERE oi.product_id = ? AND o.created_at > ? AND o.status != 'cancelled'`).get(p.id, weekAgo).n;
  res.json({ product: { ...product, soldThisWeek }, reviews, related, canReview });
});

/* ---------- reviews (verified buyers only) ---------- */
router.post('/products/:id/reviews', S.requireUser, (req, res) => {
  const productId = Number(req.params.id);
  if (!Number.isInteger(productId)) throw new S.ValidationError('Invalid product.');
  const rating = S.int(req.body, 'rating', { min: 1, max: 5, required: true, label: 'Rating' });
  const body = S.str(req.body, 'body', { max: 1000, multiline: true });
  const bought = db.prepare(`SELECT 1 FROM orders o JOIN order_items oi ON oi.order_id = o.id
                             WHERE o.user_id = ? AND oi.product_id = ? AND o.status = 'delivered' LIMIT 1`).get(req.user.id, productId);
  if (!bought) return res.status(403).json({ error: 'Only customers who received this product can review it.' });
  try {
    db.prepare('INSERT INTO reviews (product_id, user_id, rating, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(productId, req.user.id, rating, body, Date.now());
  } catch {
    throw new S.ValidationError('You have already reviewed this product.');
  }
  res.status(201).json({ ok: true });
});

/* ---------- cart quote (works for guests) ---------- */
router.post('/cart/quote', (req, res) => {
  res.json(quote(req.body?.items));
});

/* ---------- orders ---------- */
router.post('/orders', limits.order, S.requireUser, (req, res) => {
  const settings = pricingContext().settings;
  if (settings.allow_orders !== '1') return res.status(503).json({ error: 'Online ordering is paused right now. Please contact us directly.' });
  const customer = {
    name: S.str(req.body, 'name', { max: 80, required: true, label: 'Full name' }),
    phone: S.phone(req.body, 'phone', true),
    address: S.str(req.body, 'address', { max: 300, required: true, multiline: true, label: 'Address' }),
    city: S.str(req.body, 'city', { max: 60, required: true, label: 'City' }),
    notes: S.str(req.body, 'notes', { max: 500, multiline: true }),
    payment: S.oneOf(req.body, 'payment', ['cod', 'bank'], 'cod')
  };
  const expectedTotal = Number.isInteger(req.body?.expectedTotal) ? req.body.expectedTotal : undefined;
  try {
    const out = placeOrder({ userId: req.user.id, items: req.body?.items, customer, expectedTotal });
    res.status(201).json({ code: out.code, total: out.total });
  } catch (err) {
    if (err.quote) return res.status(409).json({ error: err.message, quote: err.quote });
    throw err;
  }
});

router.get('/orders', S.requireUser, (req, res) => {
  const rows = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(req.user.id);
  res.json({ orders: rows.map(orderWithItems) });
});

router.get('/orders/:code', S.requireUser, (req, res) => {
  const code = S.cleanText(req.params.code, { max: 20 });
  // Scoped to the logged-in user: no one can read someone else's order by guessing a code.
  const row = db.prepare('SELECT * FROM orders WHERE code = ? AND user_id = ?').get(code, req.user.id);
  if (!row) return res.status(404).json({ error: 'Order not found.' });
  res.json({ order: orderWithItems(row), bank: row.payment_method === 'bank' ? pricingContext().settings.bank_details : null });
});

router.post('/orders/:code/cancel', S.requireUser, (req, res) => {
  const code = S.cleanText(req.params.code, { max: 20 });
  const ok = tx(() => {
    const row = db.prepare('SELECT * FROM orders WHERE code = ? AND user_id = ?').get(code, req.user.id);
    if (!row) return false;
    if (row.status !== 'pending') throw new S.ValidationError('This order is already being processed and can no longer be cancelled online. Please contact us.');
    db.prepare(`UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(Date.now(), row.id);
    restockOrder(row.id, row.code, req.user.id);
    return true;
  });
  if (!ok) return res.status(404).json({ error: 'Order not found.' });
  res.json({ ok: true });
});

/* ---------- contact / wholesale quote ---------- */
router.post('/contact', limits.contact, (req, res) => {
  if (req.body?.website) return res.json({ ok: true }); // honeypot: bots fill hidden fields
  const msg = {
    name: S.str(req.body, 'name', { max: 80, required: true, label: 'Name' }),
    email: S.email(req.body),
    phone: S.phone(req.body, 'phone'),
    company: S.str(req.body, 'company', { max: 120 }),
    body: S.str(req.body, 'body', { max: 3000, multiline: true, required: true, label: 'Message' })
  };
  db.prepare('INSERT INTO messages (name, email, phone, company, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(msg.name, msg.email, msg.phone, msg.company, msg.body, Date.now());
  res.status(201).json({ ok: true });
});

module.exports = router;
