'use strict';
/* Cart quoting + order placement. All prices and stock are re-checked
   server-side inside one transaction, so stock can never go negative
   and two customers can't buy the same last unit. */
const crypto = require('node:crypto');
const { db, tx } = require('./db');
const { pricingContext, priceFor, unitPriceForQty } = require('./pricing');
const { ValidationError } = require('./security');

const MAX_LINES = 50;
const MAX_QTY = 999;

function normaliseItems(raw) {
  if (!Array.isArray(raw)) throw new ValidationError('Cart is invalid.');
  if (raw.length > MAX_LINES) throw new ValidationError(`A single order can contain at most ${MAX_LINES} different products.`);
  const merged = new Map();
  for (const it of raw) {
    const id = Number(it?.productId);
    const qty = Number(it?.qty);
    if (!Number.isInteger(id) || id <= 0) continue;
    if (!Number.isInteger(qty) || qty <= 0) continue;
    merged.set(id, Math.min(MAX_QTY, (merged.get(id) || 0) + qty));
  }
  return [...merged].map(([productId, qty]) => ({ productId, qty }));
}

/** Price a cart. Returns lines with problems flagged (out of stock, unavailable, qty reduced). */
function quote(rawItems, ctx = pricingContext()) {
  const items = normaliseItems(rawItems);
  const getP = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1 AND deleted_at IS NULL');
  const lines = [];
  let subtotal = 0;
  let listTotal = 0;
  for (const { productId, qty } of items) {
    const p = getP.get(productId);
    if (!p) { lines.push({ productId, qty: 0, requested: qty, problem: 'unavailable' }); continue; }
    const pricing = priceFor(p, ctx);
    const allowed = Math.min(qty, p.stock);
    const { unit, bulk } = unitPriceForQty(p, pricing, allowed);
    const line = {
      productId: p.id, slug: p.slug, name: p.name, icon: p.icon,
      image: (JSON.parse(p.images_json || '[]')[0]) || null,
      requested: qty, qty: allowed, stockLeft: p.stock,
      listUnit: p.price, unit, lineTotal: unit * allowed,
      label: bulk ? `Bulk ${p.bulk_percent}% off` : pricing.label, bulk,
      bulkOffer: p.bulk_min_qty > 0 && p.bulk_percent > 0 && !bulk ? { minQty: p.bulk_min_qty, percent: p.bulk_percent } : null,
      problem: p.stock <= 0 ? 'out_of_stock' : (allowed < qty ? 'reduced' : null)
    };
    subtotal += line.lineTotal;
    listTotal += p.price * allowed;
    lines.push(line);
  }
  const s = ctx.settings;
  const freeOver = Number(s.free_delivery_over) || 0;
  const fee = Number(s.delivery_fee) || 0;
  const delivery = subtotal === 0 ? 0 : (freeOver > 0 && subtotal >= freeOver ? 0 : fee);
  return {
    lines,
    subtotal,
    savings: listTotal - subtotal,
    delivery,
    freeDeliveryOver: freeOver,
    toFreeDelivery: freeOver > 0 ? Math.max(0, freeOver - subtotal) : 0,
    total: subtotal + delivery
  };
}

function newOrderCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `NPI-${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Places an order atomically. Throws ValidationError if anything changed since the customer looked. */
function placeOrder({ userId, items, customer, expectedTotal }) {
  return tx(() => {
    const q = quote(items);
    const bad = q.lines.filter((l) => l.problem);
    if (bad.length) {
      const err = new ValidationError('Some items in your cart changed (stock or availability). Please review your cart.');
      err.quote = q;
      throw err;
    }
    if (!q.lines.length) throw new ValidationError('Your cart is empty.');
    if (Number.isInteger(expectedTotal) && expectedTotal !== q.total) {
      const err = new ValidationError('Prices changed while you were checking out (a deal may have started or ended). Please review the new total.');
      err.quote = q;
      throw err;
    }
    const now = Date.now();
    const code = newOrderCode();
    const orderId = Number(db.prepare(`INSERT INTO orders
      (code, user_id, status, customer_name, phone, address, city, notes, payment_method, subtotal, discount, delivery_fee, total, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(code, userId, customer.name, customer.phone, customer.address, customer.city, customer.notes,
        customer.payment, q.subtotal, q.savings, q.delivery, q.total, now, now).lastInsertRowid);

    const insItem = db.prepare(`INSERT INTO order_items (order_id, product_id, name, unit_price, list_price, qty, line_total, promo_label)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    // Conditional decrement: only succeeds if enough stock is still there.
    const dec = db.prepare('UPDATE products SET stock = stock - ?, sold_count = sold_count + ?, updated_at = ? WHERE id = ? AND stock >= ?');
    const after = db.prepare('SELECT stock FROM products WHERE id = ?');
    const move = db.prepare('INSERT INTO stock_movements (product_id, delta, stock_after, reason, ref, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const l of q.lines) {
      const r = dec.run(l.qty, l.qty, now, l.productId, l.qty);
      if (r.changes !== 1) throw new ValidationError(`Sorry — "${l.name}" just sold out. Please review your cart.`);
      insItem.run(orderId, l.productId, l.name, l.unit, l.listUnit, l.qty, l.lineTotal, l.label || '');
      move.run(l.productId, -l.qty, after.get(l.productId).stock, 'Sold (order)', code, userId, now);
    }
    return { code, orderId, total: q.total };
  });
}

/** Restore stock for a cancelled order. Call inside a transaction. */
function restockOrder(orderId, code, userId) {
  const items = db.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ? AND product_id IS NOT NULL').all(orderId);
  const inc = db.prepare('UPDATE products SET stock = stock + ?, sold_count = MAX(0, sold_count - ?), updated_at = ? WHERE id = ?');
  const after = db.prepare('SELECT stock FROM products WHERE id = ?');
  const move = db.prepare('INSERT INTO stock_movements (product_id, delta, stock_after, reason, ref, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const now = Date.now();
  for (const it of items) {
    const r = inc.run(it.qty, it.qty, now, it.product_id);
    if (r.changes) move.run(it.product_id, it.qty, after.get(it.product_id).stock, 'Returned (order cancelled)', code, userId, now);
  }
}

function orderWithItems(order) {
  if (!order) return null;
  const items = db.prepare(`SELECT oi.product_id AS productId, oi.name, oi.unit_price AS unit, oi.list_price AS listUnit,
                                   oi.qty, oi.line_total AS lineTotal, oi.promo_label AS label, p.slug, p.icon, p.images_json
                            FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?`).all(order.id);
  return {
    code: order.code, status: order.status, createdAt: order.created_at, updatedAt: order.updated_at,
    customer: { name: order.customer_name, phone: order.phone, address: order.address, city: order.city, notes: order.notes },
    payment: order.payment_method, subtotal: order.subtotal, savings: order.discount,
    delivery: order.delivery_fee, total: order.total,
    items: items.map(({ images_json: imgs, ...it }) => {
      let image = null;
      try { image = JSON.parse(imgs || '[]')[0] || null; } catch { /* ignore */ }
      return { ...it, image };
    })
  };
}

module.exports = { quote, placeOrder, restockOrder, orderWithItems };
