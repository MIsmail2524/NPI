'use strict';
/* ============================================================
   Pricing engine — the server is the ONLY place prices are
   decided. The browser displays what this returns; checkout
   re-runs it, so a tampered client can never change a price.

   Candidate prices for a product:
     1. list price
     2. product's own sale_price (simple "on sale")
     3. every promotion that is live right now and applies
   The lowest wins. Bulk discount is applied at cart level on top.
   ============================================================ */
const { db, getSettings } = require('./db');

/** Local wall-clock parts in the store's timezone. */
function localNow(tz, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return {
    dow,
    date: `${get('year')}-${get('month')}-${get('day')}`,
    secOfDay: Number(get('hour')) * 3600 + Number(get('minute')) * 60 + Number(get('second'))
  };
}

function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const toSec = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 3600 + m * 60;
};

function dayAllowed(promo, dow) {
  if (!promo.days_of_week) return true;
  return promo.days_of_week.split(',').map(Number).includes(dow);
}
function dateAllowed(promo, isoDate) {
  if (promo.starts_on && isoDate < promo.starts_on) return false;
  if (promo.ends_on && isoDate > promo.ends_on) return false;
  return true;
}

/**
 * Status of a promotion right now.
 * Returns { live, endsInSec, startsInSec } — endsInSec when live, startsInSec for the next window (≤ 14 days).
 */
function promoStatus(promo, tz, now = new Date()) {
  if (!promo.active) return { live: false, endsInSec: null, startsInSec: null };
  const L = localNow(tz, now);
  const startS = toSec(promo.start_time) ?? 0;
  const endS = toSec(promo.end_time) ?? 86400;

  if (dayAllowed(promo, L.dow) && dateAllowed(promo, L.date) && L.secOfDay >= startS && L.secOfDay < endS) {
    // Live. If the promo runs on consecutive days with full-day windows, extend the countdown across them.
    let ends = endS - L.secOfDay;
    if (startS === 0 && endS === 86400) {
      for (let d = 1; d < 14; d++) {
        const date = addDays(L.date, d);
        if (dayAllowed(promo, (L.dow + d) % 7) && dateAllowed(promo, date)) ends += 86400;
        else break;
      }
    }
    return { live: true, endsInSec: ends, startsInSec: null };
  }
  for (let d = 0; d <= 14; d++) {
    const date = addDays(L.date, d);
    const dow = (L.dow + d) % 7;
    if (!dayAllowed(promo, dow) || !dateAllowed(promo, date)) continue;
    const startsIn = d * 86400 + startS - L.secOfDay;
    if (startsIn > 0) return { live: false, endsInSec: null, startsInSec: startsIn };
  }
  return { live: false, endsInSec: null, startsInSec: null };
}

function loadPromotions() {
  const promos = db.prepare('SELECT * FROM promotions WHERE active = 1').all();
  const links = db.prepare('SELECT promotion_id, product_id FROM promotion_products').all();
  const byPromo = new Map();
  for (const l of links) {
    if (!byPromo.has(l.promotion_id)) byPromo.set(l.promotion_id, new Set());
    byPromo.get(l.promotion_id).add(l.product_id);
  }
  return promos.map((p) => ({ ...p, productIds: byPromo.get(p.id) || new Set() }));
}

function promoApplies(promo, product) {
  if (promo.scope === 'all') return true;
  if (promo.scope === 'category') return promo.category_id === product.category_id;
  return promo.productIds.has(product.id);
}

function discounted(price, promo) {
  if (promo.discount_type === 'percent') return Math.max(0, Math.round(price * (100 - Math.min(100, promo.value)) / 100));
  return Math.max(0, price - promo.value);
}

/** Build a pricing context once per request (promos + their live status). */
function pricingContext(now = new Date()) {
  const settings = getSettings();
  const tz = settings.timezone || 'Asia/Karachi';
  const promos = loadPromotions().map((p) => ({ ...p, status: promoStatus(p, tz, now) }));
  return { settings, tz, promos, now };
}

/** Effective price for one product. */
function priceFor(product, ctx) {
  let best = { price: product.price, label: '', theme: '', promoId: null, endsInSec: null };
  if (product.sale_price !== null && product.sale_price !== undefined && product.sale_price < best.price) {
    best = { price: product.sale_price, label: 'Sale', theme: 'sale', promoId: null, endsInSec: null };
  }
  const upcoming = [];
  for (const promo of ctx.promos) {
    if (!promoApplies(promo, product)) continue;
    if (promo.status.live) {
      const p = discounted(product.price, promo);
      if (p < best.price) {
        best = { price: p, label: promo.badge || promo.name, theme: promo.theme, promoId: promo.id, endsInSec: promo.status.endsInSec };
      }
    } else if (promo.status.startsInSec !== null) {
      upcoming.push({ name: promo.name, badge: promo.badge, theme: promo.theme, price: discounted(product.price, promo), startsInSec: promo.status.startsInSec });
    }
  }
  upcoming.sort((a, b) => a.startsInSec - b.startsInSec);
  const savePercent = product.price > 0 ? Math.round((1 - best.price / product.price) * 100) : 0;
  return {
    list: product.price,
    price: best.price,
    onSale: best.price < product.price,
    savePercent,
    label: best.label,
    theme: best.theme,
    promoId: best.promoId,
    endsInSec: best.endsInSec,
    upcoming: upcoming[0] || null
  };
}

/** Unit price after bulk discount for a given quantity. */
function unitPriceForQty(product, pricing, qty) {
  if (product.bulk_min_qty > 0 && product.bulk_percent > 0 && qty >= product.bulk_min_qty) {
    return { unit: Math.round(pricing.price * (100 - product.bulk_percent) / 100), bulk: true };
  }
  return { unit: pricing.price, bulk: false };
}

/** Summaries of promotions for the storefront banners. */
function promoSummaries(ctx) {
  return ctx.promos
    .filter((p) => p.status.live || p.status.startsInSec !== null)
    .map((p) => ({
      id: p.id, name: p.name, badge: p.badge, theme: p.theme,
      discount_type: p.discount_type, value: p.value, scope: p.scope, category_id: p.category_id,
      live: p.status.live, endsInSec: p.status.endsInSec, startsInSec: p.status.startsInSec,
      days_of_week: p.days_of_week
    }))
    .sort((a, b) => (b.live - a.live) || ((a.startsInSec ?? 0) - (b.startsInSec ?? 0)));
}

module.exports = { pricingContext, priceFor, unitPriceForQty, promoSummaries, promoStatus, localNow };
