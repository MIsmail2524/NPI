'use strict';
/* Owner-only API. Every route here sits behind requireOwner (see index.js). */
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const { db, tx, getSettings, DEFAULT_SETTINGS } = require('../db');
const S = require('../security');
const limits = require('../limits');
const { pricingContext, promoSummaries, promoStatus } = require('../pricing');
const { DEMO_TYPES, TAGS, ICONS, SIMS, MOTIONS, parseJSON, categoriesById, toAdmin } = require('../catalog');
const { restockOrder, orderWithItems } = require('../orders');

const router = express.Router();
const UPLOAD_DIR = process.env.NPI_UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const now = () => Date.now();
const nullableMoney = (body, key, label) => {
  const v = body?.[key];
  if (v === undefined || v === null || v === '') return null;
  return S.money(body, key, { label });
};

/* ============================================================
   DASHBOARD
   ============================================================ */
router.get('/dashboard', (req, res) => {
  const t = now();
  const day = 86400000;
  const rev = (since) => db.prepare(`SELECT COALESCE(SUM(total),0) AS revenue, COUNT(*) AS orders FROM orders
                                     WHERE status != 'cancelled' AND created_at >= ?`).get(since);
  const startOfToday = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const byStatus = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all().map((r) => [r.status, r.n]));
  const series = [];
  for (let i = 13; i >= 0; i--) {
    const start = startOfToday - i * day;
    const r = db.prepare(`SELECT COALESCE(SUM(total),0) AS revenue, COUNT(*) AS orders FROM orders
                          WHERE status != 'cancelled' AND created_at >= ? AND created_at < ?`).get(start, start + day);
    series.push({ date: new Date(start).toISOString().slice(0, 10), ...r });
  }
  const lowStock = db.prepare(`SELECT id, name, stock, low_stock_threshold, icon FROM products
                               WHERE deleted_at IS NULL AND stock <= low_stock_threshold ORDER BY stock ASC LIMIT 20`).all();
  const top = db.prepare(`SELECT p.id, p.name, p.icon, SUM(oi.qty) AS qty, SUM(oi.line_total) AS revenue
                          FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
                          WHERE o.status != 'cancelled' AND o.created_at >= ? GROUP BY p.id ORDER BY qty DESC LIMIT 5`).all(t - 30 * day);
  const recent = db.prepare(`SELECT code, customer_name, total, status, created_at FROM orders ORDER BY created_at DESC LIMIT 8`).all();
  const counts = db.prepare(`SELECT
      (SELECT COUNT(*) FROM products WHERE deleted_at IS NULL) AS products,
      (SELECT COUNT(*) FROM products WHERE deleted_at IS NULL AND active = 1) AS live,
      (SELECT COUNT(*) FROM products WHERE deleted_at IS NULL AND stock = 0) AS outOfStock,
      (SELECT COUNT(*) FROM users WHERE role = 'customer') AS customers,
      (SELECT COUNT(*) FROM messages WHERE is_read = 0) AS unreadMessages,
      (SELECT COALESCE(SUM(stock * price),0) FROM products WHERE deleted_at IS NULL) AS stockValue`).get();
  res.json({
    today: rev(startOfToday), week: rev(t - 7 * day), month: rev(t - 30 * day),
    byStatus, series, lowStock, top, recent, counts,
    promotions: promoSummaries(pricingContext())
  });
});

/* ============================================================
   PRODUCTS
   ============================================================ */
/** Whitelist-validates the product video setup (all points are 0..1 photo coordinates). */
function readDemo(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const pt = (v) => (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= -0.5 && n <= 1.5)
    ? v.map((n) => Math.round(n * 10000) / 10000) : undefined);
  const out = {};
  if (DEMO_TYPES.includes(raw.type)) out.type = raw.type;
  if (Number.isInteger(raw.img) && raw.img >= 0 && raw.img < 12) out.img = raw.img;
  for (const k of ['pivot', 'tip', 'cut', 'vial']) { const v = pt(raw[k]); if (v) out[k] = v; }
  if (Array.isArray(raw.spots)) out.spots = raw.spots.slice(0, 40).map((s) => pt(s) || null);
  if (['cross', 'side', 'lever'].includes(raw.hinge)) out.hinge = raw.hinge;
  if (['left', 'right'].includes(raw.lever)) out.lever = raw.lever;
  if (['steel', 'stainless', 'wood', 'concrete'].includes(raw.material)) out.material = raw.material;
  if (['steel', 'gold', 'black'].includes(raw.finish)) out.finish = raw.finish;
  for (const k of ['long', 'horizontal']) if (typeof raw[k] === 'boolean') out[k] = raw[k];
  if (typeof raw.rot === 'number' && raw.rot >= -360 && raw.rot <= 360) out.rot = raw.rot;
  if (typeof raw.len === 'number' && raw.len >= 200 && raw.len <= 1000) out.len = raw.len;
  if (raw.flip && Number.isInteger(raw.flip.handle) && Number.isInteger(raw.flip.rod) && raw.flip.handle >= 0 && raw.flip.rod >= 0 && raw.flip.handle < 12 && raw.flip.rod < 12) {
    out.flip = { handle: raw.flip.handle, rod: raw.flip.rod };
  }
  return out;
}
const readTags = (raw) => (Array.isArray(raw) ? [...new Set(raw.filter((t) => typeof t === 'string' && Object.hasOwn(TAGS, t)))] : []);

function readProduct(body) {
  const name = S.str(body, 'name', { max: 140, required: true, label: 'Product name' });
  const categoryId = body?.category_id === null || body?.category_id === '' || body?.category_id === undefined
    ? null : S.int(body, 'category_id', { min: 1, label: 'Category' });
  if (categoryId && !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(categoryId)) throw new S.ValidationError('That category no longer exists.');
  const price = S.money(body, 'price', { required: true, label: 'Price' });
  const sale = nullableMoney(body, 'sale_price', 'Sale price');
  if (sale !== null && sale >= price) throw new S.ValidationError('Sale price must be lower than the normal price.', 'sale_price');

  const specs = Array.isArray(body?.specs) ? body.specs.slice(0, 40).map((s) => ({
    label: S.cleanText(s?.label, { max: 60 }), value: S.cleanText(s?.value, { max: 160 })
  })).filter((s) => s.label || s.value) : [];
  const uses = Array.isArray(body?.uses) ? body.uses.slice(0, 40).map((u) => S.cleanText(u, { max: 160 })).filter(Boolean) : [];
  const images = Array.isArray(body?.images) ? body.images.slice(0, 12).map(S.mediaUrl).filter(Boolean) : [];
  const icon = ICONS.includes(body?.icon) ? body.icon : 'wrench';
  const sim = SIMS.includes(body?.sim) ? body.sim : 'auto';
  const motion = MOTIONS.includes(body?.motion) ? body.motion : 'auto';
  const bulkMin = S.int(body, 'bulk_min_qty', { min: 0, max: 100000, label: 'Bulk quantity' });
  const bulkPct = S.int(body, 'bulk_percent', { min: 0, max: 90, label: 'Bulk discount' });

  return {
    name,
    sku: S.str(body, 'sku', { max: 60 }),
    category_id: categoryId,
    description: S.str(body, 'description', { max: 5000, multiline: true }),
    specs_json: JSON.stringify(specs),
    uses_json: JSON.stringify(uses),
    price,
    sale_price: sale,
    low_stock_threshold: S.int(body, 'low_stock_threshold', { min: 0, max: 100000, def: 5, label: 'Low-stock alert' }),
    icon, sim, motion,
    featured: S.bool(body, 'featured') ? 1 : 0,
    active: S.bool(body, 'active', true) ? 1 : 0,
    bulk_min_qty: bulkPct ? bulkMin : 0,
    bulk_percent: bulkMin ? bulkPct : 0,
    images_json: JSON.stringify(images),
    video_url: body?.video ? S.mediaUrl(body.video) : '',
    demo_json: JSON.stringify(readDemo(body?.demo)),
    tags_json: JSON.stringify(readTags(body?.tags))
  };
}

function uniqueSlug(base, exceptId = null) {
  let slug = S.slugify(base);
  let i = 2;
  const q = db.prepare('SELECT id FROM products WHERE slug = ?');
  for (;;) {
    const row = q.get(slug);
    if (!row || row.id === exceptId) return slug;
    slug = `${S.slugify(base).slice(0, 74)}-${i++}`;
  }
}

function logStock(productId, delta, after, reason, ref, userId) {
  db.prepare('INSERT INTO stock_movements (product_id, delta, stock_after, reason, ref, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(productId, delta, after, reason, ref, userId, now());
}

function getAdminProduct(id) {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  return p ? toAdmin(p, pricingContext(), categoriesById()) : null;
}

const idParam = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new S.ValidationError('Invalid id.');
  return id;
};

router.get('/products', (req, res) => {
  const ctx = pricingContext();
  const cats = categoriesById();
  const trash = req.query.trash === '1';
  const rows = db.prepare(`SELECT * FROM products WHERE deleted_at IS ${trash ? 'NOT NULL' : 'NULL'} ORDER BY updated_at DESC`).all();
  res.json({ products: rows.map((p) => toAdmin(p, ctx, cats)), icons: ICONS, sims: SIMS, motions: MOTIONS, demoTypes: DEMO_TYPES, tags: TAGS });
});

router.get('/products/:id', (req, res) => {
  const id = idParam(req);
  const p = getAdminProduct(id);
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  const movements = db.prepare(`SELECT m.*, u.name AS user_name FROM stock_movements m LEFT JOIN users u ON u.id = m.user_id
                                WHERE m.product_id = ? ORDER BY m.created_at DESC LIMIT 100`).all(id);
  const promoIds = db.prepare('SELECT promotion_id FROM promotion_products WHERE product_id = ?').all(id).map((r) => r.promotion_id);
  res.json({ product: p, movements, promoIds });
});

router.post('/products', (req, res) => {
  const data = readProduct(req.body);
  const stock = S.int(req.body, 'stock', { min: 0, max: 10_000_000, label: 'Stock' });
  const id = tx(() => {
    const t = now();
    const newId = Number(db.prepare(`INSERT INTO products
      (slug, sku, name, category_id, description, specs_json, uses_json, price, sale_price, stock, low_stock_threshold,
       icon, sim, motion, featured, active, bulk_min_qty, bulk_percent, images_json, video_url, demo_json, tags_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uniqueSlug(data.name), data.sku, data.name, data.category_id, data.description, data.specs_json, data.uses_json,
        data.price, data.sale_price, stock, data.low_stock_threshold, data.icon, data.sim, data.motion, data.featured, data.active,
        data.bulk_min_qty, data.bulk_percent, data.images_json, data.video_url, data.demo_json, data.tags_json, t, t).lastInsertRowid);
    if (stock) logStock(newId, stock, stock, 'Opening stock', '', req.user.id);
    return newId;
  });
  S.audit(req, 'product_created', 'product', id, data.name);
  res.status(201).json({ product: getAdminProduct(id) });
});

router.put('/products/:id', (req, res) => {
  const id = idParam(req);
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Product not found.' });
  const data = readProduct(req.body);
  const slug = data.name !== existing.name ? uniqueSlug(data.name, id) : existing.slug;
  db.prepare(`UPDATE products SET slug = ?, sku = ?, name = ?, category_id = ?, description = ?, specs_json = ?, uses_json = ?,
              price = ?, sale_price = ?, low_stock_threshold = ?, icon = ?, sim = ?, motion = ?, featured = ?, active = ?,
              bulk_min_qty = ?, bulk_percent = ?, images_json = ?, video_url = ?, demo_json = ?, tags_json = ?, price_confirmed = 1, updated_at = ? WHERE id = ?`)
    .run(slug, data.sku, data.name, data.category_id, data.description, data.specs_json, data.uses_json, data.price, data.sale_price,
      data.low_stock_threshold, data.icon, data.sim, data.motion, data.featured, data.active, data.bulk_min_qty, data.bulk_percent,
      data.images_json, data.video_url, data.demo_json, data.tags_json, now(), id);
  // Stock is changed only through the dedicated stock endpoint so every change is logged.
  S.audit(req, 'product_updated', 'product', id, data.name);
  res.json({ product: getAdminProduct(id) });
});

/* Quick inline edits from the products table (one field at a time). */
router.patch('/products/:id', (req, res) => {
  const id = idParam(req);
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  const field = req.body?.field;
  const t = now();
  switch (field) {
    case 'confirm_price':
      db.prepare('UPDATE products SET price_confirmed = 1, updated_at = ? WHERE id = ?').run(t, id);
      break;
    case 'active':
    case 'featured':
      db.prepare(`UPDATE products SET ${field} = ?, updated_at = ? WHERE id = ?`).run(S.bool(req.body, 'value') ? 1 : 0, t, id);
      break;
    case 'price': {
      const v = S.money(req.body, 'value', { required: true, label: 'Price' });
      if (p.sale_price !== null && p.sale_price >= v) throw new S.ValidationError('Price must stay above the sale price. Remove or lower the sale price first.');
      db.prepare('UPDATE products SET price = ?, price_confirmed = 1, updated_at = ? WHERE id = ?').run(v, t, id);
      break;
    }
    case 'sale_price': {
      const v = nullableMoney(req.body, 'value', 'Sale price');
      if (v !== null && v >= p.price) throw new S.ValidationError('Sale price must be lower than the normal price.');
      db.prepare('UPDATE products SET sale_price = ?, updated_at = ? WHERE id = ?').run(v, t, id);
      break;
    }
    case 'stock': {
      const v = S.int(req.body, 'value', { min: 0, max: 10_000_000, required: true, label: 'Stock' });
      tx(() => {
        db.prepare('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?').run(v, t, id);
        if (v !== p.stock) logStock(id, v - p.stock, v, S.str(req.body, 'reason', { max: 120 }) || 'Stock count corrected', '', req.user.id);
      });
      break;
    }
    default:
      throw new S.ValidationError('That field cannot be edited here.');
  }
  S.audit(req, `product_${field}_changed`, 'product', id, String(req.body?.value ?? ''));
  res.json({ product: getAdminProduct(id) });
});

router.post('/products/:id/stock', (req, res) => {
  const id = idParam(req);
  const delta = S.int(req.body, 'delta', { min: -10_000_000, max: 10_000_000, required: true, label: 'Quantity' });
  if (delta === 0) throw new S.ValidationError('Enter a quantity other than zero.');
  const reason = S.str(req.body, 'reason', { max: 120 }) || (delta > 0 ? 'New stock received' : 'Stock removed');
  tx(() => {
    const p = db.prepare('SELECT stock FROM products WHERE id = ?').get(id);
    if (!p) throw Object.assign(new Error('Product not found.'), { status: 404 });
    const after = p.stock + delta;
    if (after < 0) throw new S.ValidationError(`You only have ${p.stock} in stock — can't remove ${-delta}.`);
    db.prepare('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?').run(after, now(), id);
    logStock(id, delta, after, reason, '', req.user.id);
  });
  S.audit(req, 'stock_adjusted', 'product', id, `${delta > 0 ? '+' : ''}${delta} (${reason})`);
  res.json({ product: getAdminProduct(id) });
});

router.post('/products/:id/duplicate', (req, res) => {
  const id = idParam(req);
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  const t = now();
  const name = `${p.name} (copy)`.slice(0, 140);
  const newId = Number(db.prepare(`INSERT INTO products
    (slug, sku, name, category_id, description, specs_json, uses_json, price, sale_price, stock, low_stock_threshold,
     icon, sim, motion, featured, active, bulk_min_qty, bulk_percent, images_json, video_url, demo_json, tags_json, created_at, updated_at)
    VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uniqueSlug(name), name, p.category_id, p.description, p.specs_json, p.uses_json, p.price, p.sale_price,
      p.low_stock_threshold, p.icon, p.sim, p.motion, p.bulk_min_qty, p.bulk_percent, p.images_json, p.video_url, p.demo_json, p.tags_json, t, t).lastInsertRowid);
  S.audit(req, 'product_duplicated', 'product', newId, `from #${id}`);
  res.status(201).json({ product: getAdminProduct(newId) });
});

router.delete('/products/:id', (req, res) => {
  const id = idParam(req);
  const r = db.prepare('UPDATE products SET deleted_at = ?, active = 0, featured = 0 WHERE id = ? AND deleted_at IS NULL').run(now(), id);
  if (!r.changes) return res.status(404).json({ error: 'Product not found.' });
  S.audit(req, 'product_trashed', 'product', id);
  res.json({ ok: true });
});

router.post('/products/:id/restore', (req, res) => {
  const id = idParam(req);
  db.prepare('UPDATE products SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now(), id);
  S.audit(req, 'product_restored', 'product', id);
  res.json({ product: getAdminProduct(id) });
});

router.delete('/products/:id/permanent', (req, res) => {
  const id = idParam(req);
  const r = db.prepare('DELETE FROM products WHERE id = ? AND deleted_at IS NOT NULL').run(id);
  if (!r.changes) return res.status(400).json({ error: 'Move the product to the Bin before deleting it forever.' });
  S.audit(req, 'product_deleted_permanently', 'product', id);
  res.json({ ok: true });
});

router.post('/products/bulk', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500) : [];
  if (!ids.length) throw new S.ValidationError('Select at least one product.');
  const action = S.oneOf(req.body, 'action', ['show', 'hide', 'feature', 'unfeature', 'trash', 'sale_percent', 'clear_sale', 'stock_add', 'category']);
  const t = now();
  let changed = 0;
  tx(() => {
    for (const id of ids) {
      const p = db.prepare('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL').get(id);
      if (!p) continue;
      changed++;
      switch (action) {
        case 'show': db.prepare('UPDATE products SET active = 1, updated_at = ? WHERE id = ?').run(t, id); break;
        case 'hide': db.prepare('UPDATE products SET active = 0, updated_at = ? WHERE id = ?').run(t, id); break;
        case 'feature': db.prepare('UPDATE products SET featured = 1, updated_at = ? WHERE id = ?').run(t, id); break;
        case 'unfeature': db.prepare('UPDATE products SET featured = 0, updated_at = ? WHERE id = ?').run(t, id); break;
        case 'trash': db.prepare('UPDATE products SET deleted_at = ?, active = 0, featured = 0 WHERE id = ?').run(t, id); break;
        case 'clear_sale': db.prepare('UPDATE products SET sale_price = NULL, updated_at = ? WHERE id = ?').run(t, id); break;
        case 'sale_percent': {
          const pct = S.int(req.body, 'value', { min: 1, max: 90, required: true, label: 'Discount %' });
          db.prepare('UPDATE products SET sale_price = ?, updated_at = ? WHERE id = ?').run(Math.round(p.price * (100 - pct) / 100), t, id);
          break;
        }
        case 'stock_add': {
          const q = S.int(req.body, 'value', { min: -1_000_000, max: 1_000_000, required: true, label: 'Quantity' });
          const after = Math.max(0, p.stock + q);
          db.prepare('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?').run(after, t, id);
          logStock(id, after - p.stock, after, q > 0 ? 'New stock received (bulk)' : 'Stock removed (bulk)', '', req.user.id);
          break;
        }
        case 'category': {
          const cid = S.int(req.body, 'value', { min: 1, required: true, label: 'Category' });
          if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(cid)) throw new S.ValidationError('Category not found.');
          db.prepare('UPDATE products SET category_id = ?, updated_at = ? WHERE id = ?').run(cid, t, id);
          break;
        }
      }
    }
  });
  S.audit(req, `bulk_${action}`, 'product', ids.join(','), String(req.body?.value ?? ''));
  res.json({ ok: true, changed });
});

/* ============================================================
   UPLOADS — images & short videos. Type is decided by the
   file's actual bytes (magic numbers), never by its name or
   the browser-supplied MIME type. Files get random names.
   ============================================================ */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 5 } });

function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return { ext: 'jpg', kind: 'image' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return { ext: 'png', kind: 'image' };
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return { ext: 'gif', kind: 'image' };
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', kind: 'image' };
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return { ext: 'webm', kind: 'video' };
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') return { ext: 'mp4', kind: 'video' };
  return null;
}

/** Removes EXIF/XMP (APP1) and comment segments from a JPEG — strips GPS location & camera data. */
function stripJpegMetadata(buf) {
  const out = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xFF) return buf; // unexpected structure — keep original
    const marker = buf[i + 1];
    if (marker === 0xDA) { out.push(buf.subarray(i)); return Buffer.concat(out); } // start of scan: copy rest
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) return buf;
    const seg = buf.subarray(i, i + 2 + len);
    // drop APP1 (EXIF/XMP) and COM; keep JFIF, ICC colour profile, Adobe and image data segments
    if (marker !== 0xE1 && marker !== 0xFE) out.push(seg);
    i += 2 + len;
  }
  return buf;
}

router.post('/uploads', limits.upload, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is too big (max 25 MB for video, 8 MB for images).' : 'Upload failed.';
      return res.status(400).json({ error: msg });
    }
    try {
      if (!req.file) return res.status(400).json({ error: 'Choose a file to upload.' });
      const type = sniff(req.file.buffer);
      if (!type) return res.status(400).json({ error: 'Only JPG, PNG, WEBP, GIF images or MP4/WEBM videos are allowed.' });
      if (type.kind === 'image' && req.file.size > 8 * 1024 * 1024) return res.status(400).json({ error: 'Images must be under 8 MB.' });
      const data = type.ext === 'jpg' ? stripJpegMetadata(req.file.buffer) : req.file.buffer;
      const name = `${crypto.randomBytes(16).toString('hex')}.${type.ext}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, name), data, { flag: 'wx', mode: 0o644 });
      S.audit(req, 'file_uploaded', 'upload', name, `${type.kind} ${data.length}B`);
      res.status(201).json({ url: `/uploads/${name}`, kind: type.kind });
    } catch (e) { next(e); }
  });
});

/* ============================================================
   CATEGORIES
   ============================================================ */
router.get('/categories', (req, res) => {
  const rows = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.deleted_at IS NULL) AS count
                           FROM categories c ORDER BY sort_order, name`).all();
  res.json({ categories: rows, icons: ICONS, motions: MOTIONS });
});

function uniqueCatSlug(name, exceptId = null) {
  let slug = S.slugify(name); let i = 2;
  for (;;) {
    const r = db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug);
    if (!r || r.id === exceptId) return slug;
    slug = `${S.slugify(name)}-${i++}`;
  }
}

router.post('/categories', (req, res) => {
  const name = S.str(req.body, 'name', { max: 60, required: true, label: 'Category name' });
  const icon = ICONS.includes(req.body?.icon) ? req.body.icon : 'wrench';
  const image = req.body?.image ? S.mediaUrl(req.body.image) : '';
  const motion = MOTIONS.includes(req.body?.motion) && req.body.motion !== 'auto' ? req.body.motion : 'zoom';
  const order = db.prepare('SELECT COALESCE(MAX(sort_order),0) + 1 AS n FROM categories').get().n;
  const id = Number(db.prepare('INSERT INTO categories (slug, name, icon, sort_order, created_at, image, motion) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uniqueCatSlug(name), name, icon, order, now(), image, motion).lastInsertRowid);
  S.audit(req, 'category_created', 'category', id, name);
  res.status(201).json({ id });
});

router.put('/categories/:id', (req, res) => {
  const id = idParam(req);
  const name = S.str(req.body, 'name', { max: 60, required: true, label: 'Category name' });
  const icon = ICONS.includes(req.body?.icon) ? req.body.icon : 'wrench';
  const image = req.body?.image ? S.mediaUrl(req.body.image) : '';
  const motion = MOTIONS.includes(req.body?.motion) && req.body.motion !== 'auto' ? req.body.motion : 'zoom';
  const r = db.prepare('UPDATE categories SET name = ?, slug = ?, icon = ?, image = ?, motion = ? WHERE id = ?')
    .run(name, uniqueCatSlug(name, id), icon, image, motion, id);
  if (!r.changes) return res.status(404).json({ error: 'Category not found.' });
  S.audit(req, 'category_updated', 'category', id, name);
  res.json({ ok: true });
});

router.post('/categories/reorder', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  tx(() => ids.forEach((id, i) => db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?').run(i, id)));
  res.json({ ok: true });
});

router.delete('/categories/:id', (req, res) => {
  const id = idParam(req);
  const n = db.prepare('SELECT COUNT(*) AS n FROM products WHERE category_id = ? AND deleted_at IS NULL').get(id).n;
  if (n) return res.status(400).json({ error: `This category still has ${n} product(s). Move them to another category first.` });
  db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ?').run(id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  S.audit(req, 'category_deleted', 'category', id);
  res.json({ ok: true });
});

/* ============================================================
   PROMOTIONS (Jumma Deal, flash sales, category sales…)
   ============================================================ */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function readPromo(body) {
  const discount_type = S.oneOf(body, 'discount_type', ['percent', 'amount']);
  const value = discount_type === 'percent'
    ? S.int(body, 'value', { min: 1, max: 90, required: true, label: 'Discount %' })
    : S.money(body, 'value', { min: 1, required: true, label: 'Discount amount' });
  const scope = S.oneOf(body, 'scope', ['all', 'category', 'products']);
  const category_id = scope === 'category' ? S.int(body, 'category_id', { min: 1, required: true, label: 'Category' }) : null;
  if (category_id && !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(category_id)) throw new S.ValidationError('Category not found.');
  const days = Array.isArray(body?.days) ? [...new Set(body.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
  const start_time = body?.start_time ? String(body.start_time) : null;
  const end_time = body?.end_time ? String(body.end_time) : null;
  if (start_time && !TIME_RE.test(start_time)) throw new S.ValidationError('Start time must look like 09:00.');
  if (end_time && !TIME_RE.test(end_time)) throw new S.ValidationError('End time must look like 18:00.');
  if (start_time && end_time && end_time <= start_time) throw new S.ValidationError('End time must be after start time.');
  const starts_on = body?.starts_on ? String(body.starts_on) : null;
  const ends_on = body?.ends_on ? String(body.ends_on) : null;
  if (starts_on && !DATE_RE.test(starts_on)) throw new S.ValidationError('Invalid start date.');
  if (ends_on && !DATE_RE.test(ends_on)) throw new S.ValidationError('Invalid end date.');
  if (starts_on && ends_on && ends_on < starts_on) throw new S.ValidationError('End date must be after start date.');
  const productIds = scope === 'products' && Array.isArray(body?.productIds)
    ? [...new Set(body.productIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 1000) : [];
  if (scope === 'products' && !productIds.length) throw new S.ValidationError('Pick at least one product for this deal.');
  const name = S.str(body, 'name', { max: 60, required: true, label: 'Deal name' });
  return {
    name,
    badge: S.str(body, 'badge', { max: 30 }) || name,
    theme: S.oneOf(body, 'theme', ['jumma', 'flash', 'sale', 'clearance'], 'sale'),
    discount_type, value, scope, category_id,
    days_of_week: days.join(','), start_time, end_time, starts_on, ends_on,
    active: S.bool(body, 'active', true) ? 1 : 0,
    productIds
  };
}

function savePromoProducts(promoId, ids) {
  db.prepare('DELETE FROM promotion_products WHERE promotion_id = ?').run(promoId);
  const ins = db.prepare('INSERT OR IGNORE INTO promotion_products (promotion_id, product_id) SELECT ?, id FROM products WHERE id = ?');
  for (const id of ids) ins.run(promoId, id);
}

router.get('/promotions', (req, res) => {
  const tz = getSettings().timezone;
  const rows = db.prepare('SELECT * FROM promotions ORDER BY created_at DESC').all();
  const links = db.prepare('SELECT promotion_id, product_id FROM promotion_products').all();
  res.json({
    promotions: rows.map((p) => ({
      ...p,
      days: p.days_of_week ? p.days_of_week.split(',').map(Number) : [],
      productIds: links.filter((l) => l.promotion_id === p.id).map((l) => l.product_id),
      status: promoStatus(p, tz)
    }))
  });
});

router.post('/promotions', (req, res) => {
  const d = readPromo(req.body);
  const id = tx(() => {
    const t = now();
    const newId = Number(db.prepare(`INSERT INTO promotions (name, badge, theme, discount_type, value, scope, category_id, days_of_week,
      start_time, end_time, starts_on, ends_on, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(d.name, d.badge, d.theme, d.discount_type, d.value, d.scope, d.category_id, d.days_of_week,
        d.start_time, d.end_time, d.starts_on, d.ends_on, d.active, t, t).lastInsertRowid);
    savePromoProducts(newId, d.productIds);
    return newId;
  });
  S.audit(req, 'promotion_created', 'promotion', id, d.name);
  res.status(201).json({ id });
});

router.put('/promotions/:id', (req, res) => {
  const id = idParam(req);
  const d = readPromo(req.body);
  const ok = tx(() => {
    const r = db.prepare(`UPDATE promotions SET name = ?, badge = ?, theme = ?, discount_type = ?, value = ?, scope = ?, category_id = ?,
      days_of_week = ?, start_time = ?, end_time = ?, starts_on = ?, ends_on = ?, active = ?, updated_at = ? WHERE id = ?`)
      .run(d.name, d.badge, d.theme, d.discount_type, d.value, d.scope, d.category_id, d.days_of_week,
        d.start_time, d.end_time, d.starts_on, d.ends_on, d.active, now(), id);
    if (!r.changes) return false;
    savePromoProducts(id, d.productIds);
    return true;
  });
  if (!ok) return res.status(404).json({ error: 'Deal not found.' });
  S.audit(req, 'promotion_updated', 'promotion', id, d.name);
  res.json({ ok: true });
});

router.patch('/promotions/:id', (req, res) => {
  const id = idParam(req);
  db.prepare('UPDATE promotions SET active = ?, updated_at = ? WHERE id = ?').run(S.bool(req.body, 'active') ? 1 : 0, now(), id);
  S.audit(req, 'promotion_toggled', 'promotion', id, String(req.body?.active));
  res.json({ ok: true });
});

router.delete('/promotions/:id', (req, res) => {
  const id = idParam(req);
  db.prepare('DELETE FROM promotions WHERE id = ?').run(id);
  S.audit(req, 'promotion_deleted', 'promotion', id);
  res.json({ ok: true });
});

/* ============================================================
   ORDERS
   ============================================================ */
const NEXT_STATUS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: []
};

router.get('/orders', (req, res) => {
  const status = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'].includes(req.query.status) ? req.query.status : null;
  const q = S.cleanText(req.query.q, { max: 60 });
  let sql = 'SELECT * FROM orders WHERE 1 = 1';
  const args = [];
  if (status) { sql += ' AND status = ?'; args.push(status); }
  if (q) {
    sql += " AND (code LIKE ? ESCAPE '\\' OR customer_name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')";
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    args.push(like, like, like);
  }
  sql += ' ORDER BY created_at DESC LIMIT 300';
  res.json({ orders: db.prepare(sql).all(...args).map(orderWithItems), next: NEXT_STATUS });
});

router.patch('/orders/:code', (req, res) => {
  const code = S.cleanText(req.params.code, { max: 20 });
  const status = S.oneOf(req.body, 'status', ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']);
  tx(() => {
    const o = db.prepare('SELECT * FROM orders WHERE code = ?').get(code);
    if (!o) throw Object.assign(new Error('Order not found.'), { status: 404 });
    if (!NEXT_STATUS[o.status].includes(status)) throw new S.ValidationError(`An order that is "${o.status}" can't be changed to "${status}".`);
    db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), o.id);
    if (status === 'cancelled') restockOrder(o.id, o.code, req.user.id);
  });
  S.audit(req, 'order_status', 'order', code, status);
  res.json({ ok: true });
});

/* ============================================================
   CUSTOMERS, REVIEWS, MESSAGES
   ============================================================ */
router.get('/customers', (req, res) => {
  const rows = db.prepare(`SELECT u.id, u.name, u.email, u.phone, u.disabled, u.created_at, u.last_login_at,
      (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.status != 'cancelled') AS orders,
      (SELECT COALESCE(SUM(total),0) FROM orders o WHERE o.user_id = u.id AND o.status != 'cancelled') AS spent
    FROM users u WHERE u.role = 'customer' ORDER BY u.created_at DESC LIMIT 1000`).all();
  res.json({ customers: rows });
});

router.patch('/customers/:id', (req, res) => {
  const id = idParam(req);
  const disabled = S.bool(req.body, 'disabled') ? 1 : 0;
  db.prepare(`UPDATE users SET disabled = ? WHERE id = ? AND role = 'customer'`).run(disabled, id);
  if (disabled) S.destroyAllSessionsForUser(id);
  S.audit(req, disabled ? 'customer_disabled' : 'customer_enabled', 'user', id);
  res.json({ ok: true });
});

router.get('/reviews', (req, res) => {
  res.json({
    reviews: db.prepare(`SELECT r.*, u.name AS user_name, p.name AS product_name FROM reviews r
                         JOIN users u ON u.id = r.user_id JOIN products p ON p.id = r.product_id ORDER BY r.created_at DESC LIMIT 500`).all()
  });
});
router.patch('/reviews/:id', (req, res) => {
  db.prepare('UPDATE reviews SET hidden = ? WHERE id = ?').run(S.bool(req.body, 'hidden') ? 1 : 0, idParam(req));
  res.json({ ok: true });
});
router.delete('/reviews/:id', (req, res) => {
  db.prepare('DELETE FROM reviews WHERE id = ?').run(idParam(req));
  S.audit(req, 'review_deleted', 'review', req.params.id);
  res.json({ ok: true });
});

router.get('/messages', (req, res) => {
  res.json({ messages: db.prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT 500').all() });
});
router.patch('/messages/:id', (req, res) => {
  db.prepare('UPDATE messages SET is_read = ? WHERE id = ?').run(S.bool(req.body, 'is_read', true) ? 1 : 0, idParam(req));
  res.json({ ok: true });
});
router.delete('/messages/:id', (req, res) => {
  db.prepare('DELETE FROM messages WHERE id = ?').run(idParam(req));
  res.json({ ok: true });
});

/* ============================================================
   SETTINGS
   ============================================================ */
const SETTING_RULES = {
  store_name: { max: 60 }, tagline: { max: 80 }, hero_title: { max: 80 }, hero_text: { max: 400, multiline: true },
  announcement: { max: 160 }, currency: { max: 6 }, timezone: { max: 40 },
  delivery_fee: { money: true }, free_delivery_over: { money: true },
  contact_email: { max: 120 }, contact_phone: { max: 30 }, contact_whatsapp: { max: 30 }, address: { max: 200, multiline: true },
  bank_details: { max: 500, multiline: true }, about_text: { max: 3000, multiline: true }, allow_orders: { bool: true }
};

router.get('/settings', (req, res) => res.json({ settings: getSettings() }));

router.put('/settings', (req, res) => {
  const upd = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const changed = [];
  tx(() => {
    for (const [key, rule] of Object.entries(SETTING_RULES)) {
      if (!(key in (req.body || {}))) continue;
      let v;
      if (rule.money) v = String(S.money(req.body, key, { label: key }));
      else if (rule.bool) v = S.bool(req.body, key) ? '1' : '0';
      else v = S.str(req.body, key, rule);
      if (key === 'timezone') {
        try { new Intl.DateTimeFormat('en-US', { timeZone: v }); } catch { throw new S.ValidationError('Unknown timezone.'); }
      }
      if (key === 'contact_email' && v) S.email({ e: v }, 'e');
      if (key === 'currency' && !v) v = DEFAULT_SETTINGS.currency;
      upd.run(key, v);
      changed.push(key);
    }
  });
  S.audit(req, 'settings_updated', 'settings', '', changed.join(','));
  res.json({ settings: getSettings() });
});

/* ============================================================
   AUDIT LOG, STOCK HISTORY
   ============================================================ */
router.get('/audit', (req, res) => {
  res.json({
    entries: db.prepare(`SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
                         ORDER BY a.created_at DESC LIMIT 300`).all()
  });
});

router.get('/movements', (req, res) => {
  res.json({
    movements: db.prepare(`SELECT m.*, p.name AS product_name, u.name AS user_name FROM stock_movements m
                           JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.user_id
                           ORDER BY m.created_at DESC LIMIT 300`).all()
  });
});

/* ============================================================
   EXPORT / IMPORT (backup, or bulk-loading a product list)
   Import format: { products: [ { name, sku?, category, price, sale_price?, stock?,
     description?, specs?: [{label,value}] | "Label: Value\n…", uses?: [] | "a\nb",
     icon?, featured?, active?, images?: [] } ] }   — prices in normal units (e.g. 1499.50)
   ============================================================ */
router.get('/export', (req, res) => {
  const cats = categoriesById();
  const products = db.prepare('SELECT * FROM products WHERE deleted_at IS NULL ORDER BY id').all().map((p) => ({
    name: p.name, sku: p.sku, category: cats.get(p.category_id)?.name || '',
    price: p.price / 100, sale_price: p.sale_price === null ? null : p.sale_price / 100, stock: p.stock,
    low_stock_threshold: p.low_stock_threshold, description: p.description,
    specs: parseJSON(p.specs_json, []), uses: parseJSON(p.uses_json, []), icon: p.icon, sim: p.sim,
    featured: !!p.featured, active: !!p.active, bulk_min_qty: p.bulk_min_qty, bulk_percent: p.bulk_percent,
    images: parseJSON(p.images_json, []), video: p.video_url,
    demo: parseJSON(p.demo_json, {}), tags: parseJSON(p.tags_json, [])
  }));
  S.audit(req, 'catalog_exported', 'catalog', '', `${products.length} products`);
  res.set('Content-Disposition', `attachment; filename="npi-catalog-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ exportedAt: new Date().toISOString(), categories: [...cats.values()].map((c) => ({ name: c.name, icon: c.icon })), products });
});

router.post('/import', express.json({ limit: '5mb' }), (req, res) => {
  const list = req.body?.products;
  if (!Array.isArray(list) || !list.length) throw new S.ValidationError('The file has no products in it.');
  if (list.length > 5000) throw new S.ValidationError('Too many products in one file (max 5000).');
  const toMinor = (v, label, i) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(n) || n < 0) throw new S.ValidationError(`Row ${i + 1}: ${label} is not a valid amount.`);
    return Math.round(n * 100);
  };
  const lines = (v) => Array.isArray(v) ? v : String(v || '').split('\n').map((s) => s.trim()).filter(Boolean);
  let created = 0; let updated = 0;
  tx(() => {
    const catId = new Map([...categoriesById().values()].map((c) => [c.name.toLowerCase(), c.id]));
    for (const c of categoriesById().values()) catId.set(c.slug, c.id);
    list.forEach((raw, i) => {
      if (!raw || typeof raw !== 'object') throw new S.ValidationError(`Row ${i + 1} is not a product.`);
      let cid = null;
      const cname = S.cleanText(raw.category, { max: 60 });
      if (cname) {
        cid = catId.get(cname.toLowerCase());
        if (!cid) {
          const icon = ICONS.includes(raw.icon) ? raw.icon : 'wrench';
          cid = Number(db.prepare('INSERT INTO categories (slug, name, icon, sort_order, created_at) VALUES (?, ?, ?, 99, ?)')
            .run(uniqueCatSlug(cname), cname, icon, now()).lastInsertRowid);
          catId.set(cname.toLowerCase(), cid);
        }
      }
      const specs = Array.isArray(raw.specs) ? raw.specs
        : lines(raw.specs).map((l) => { const k = l.indexOf(':'); return k < 0 ? { label: l, value: '' } : { label: l.slice(0, k).trim(), value: l.slice(k + 1).trim() }; });
      const body = {
        ...raw, category_id: cid, specs, uses: lines(raw.uses),
        price: toMinor(raw.price, 'price', i), sale_price: toMinor(raw.sale_price, 'sale price', i)
      };
      let data;
      try { data = readProduct(body); } catch (e) { throw new S.ValidationError(`Row ${i + 1} (${raw.name || 'no name'}): ${e.message}`); }
      const stock = Number.isInteger(Number(raw.stock)) && Number(raw.stock) >= 0 ? Number(raw.stock) : null;
      const existing = data.sku ? db.prepare('SELECT * FROM products WHERE sku = ? AND deleted_at IS NULL').get(data.sku)
        : db.prepare('SELECT * FROM products WHERE name = ? AND deleted_at IS NULL').get(data.name);
      const t = now();
      if (existing) {
        db.prepare(`UPDATE products SET name = ?, category_id = ?, description = ?, specs_json = ?, uses_json = ?, price = ?, sale_price = ?,
                    low_stock_threshold = ?, icon = ?, sim = ?, featured = ?, active = ?, bulk_min_qty = ?, bulk_percent = ?,
                    images_json = ?, video_url = ?, demo_json = ?, tags_json = ?, updated_at = ? WHERE id = ?`)
          .run(data.name, data.category_id, data.description, data.specs_json, data.uses_json, data.price, data.sale_price,
            data.low_stock_threshold, data.icon, data.sim, data.featured, data.active, data.bulk_min_qty, data.bulk_percent,
            data.images_json, data.video_url, data.demo_json, data.tags_json, t, existing.id);
        if (stock !== null && stock !== existing.stock) {
          db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(stock, existing.id);
          logStock(existing.id, stock - existing.stock, stock, 'Stock set by import', '', req.user.id);
        }
        updated++;
      } else {
        const id = Number(db.prepare(`INSERT INTO products (slug, sku, name, category_id, description, specs_json, uses_json, price, sale_price,
          stock, low_stock_threshold, icon, sim, featured, active, bulk_min_qty, bulk_percent, images_json, video_url, demo_json, tags_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(uniqueSlug(data.name), data.sku, data.name, data.category_id, data.description, data.specs_json, data.uses_json,
            data.price, data.sale_price, stock || 0, data.low_stock_threshold, data.icon, data.sim, data.featured, data.active,
            data.bulk_min_qty, data.bulk_percent, data.images_json, data.video_url, data.demo_json, data.tags_json, t, t).lastInsertRowid);
        if (stock) logStock(id, stock, stock, 'Opening stock (import)', '', req.user.id);
        created++;
      }
    });
  });
  S.audit(req, 'catalog_imported', 'catalog', '', `${created} created, ${updated} updated`);
  res.json({ created, updated });
});

module.exports = router;
