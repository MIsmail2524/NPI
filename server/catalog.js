'use strict';
/* Shared product serialisation — decides exactly which fields leave the server. */
const { db } = require('./db');
const { priceFor } = require('./pricing');

const ICONS = ['screwdriver', 'hammer', 'wrench', 'tape', 'pliers', 'knife', 'level', 'saw', 'drill', 'chisel'];
const SIMS = ['auto', 'none', 'torque', 'screw', 'hammer', 'tape', 'level', 'cutter', 'knife', 'saw'];
// Hover "clip" styles: how a product photo animates when a customer hovers it.
const MOTIONS = ['auto', 'zoom', 'twist', 'snip', 'turn', 'pull', 'tilt', 'swing', 'drill', 'spin', 'squeeze'];
const MOTION_DEFAULT_SIM = { twist: 'screw', snip: 'cutter', turn: 'torque', pull: 'tape', tilt: 'level', swing: 'hammer', drill: 'screw' };
const ICON_DEFAULT_SIM = {
  screwdriver: 'screw', hammer: 'hammer', wrench: 'torque', tape: 'tape', pliers: 'cutter',
  knife: 'knife', level: 'level', saw: 'saw', drill: 'screw', chisel: 'hammer'
};

/* Product video ("demo") types, see public/js/demo.js */
const DEMO_TYPES = ['screwdriver', 'bits', 'pliers', 'nose', 'diagonal', 'cable', 'locking', 'circlip-int', 'circlip-ext', 'pincers', 'ppr', 'riveter',
  'knife', 'hacksaw', 'planer', 'disc', 'wrench', 'twrench', 'keys', 'sockets', 'tape', 'longtape', 'level', 'mason', 'hammer', 'drill', 'showcase'];

/* Tool Finder tags: what jobs a product is right for. The advisor matches customer answers to these. */
const TAGS = {
  'screws-slotted': 'Slotted screws', 'screws-phillips': 'Phillips / cross screws', electrical: 'Electrical work', 'power-driver': 'Cordless drill / driver',
  magnetic: 'Holds screws (magnetic)', grip: 'Gripping & twisting', 'wire-cut': 'Cutting wire', 'cable-cut': 'Cutting thick cable', 'tight-space': 'Tight spaces',
  clamp: 'Clamping / stuck nuts', 'circlip-int': 'Internal circlips', 'circlip-ext': 'External circlips', 'nail-pull': 'Pulling nails',
  'pipe-plastic': 'Plastic pipe (PPR/PVC)', 'metal-cut': 'Cutting metal', 'tile-cut': 'Cutting tile & stone', 'board-cut': 'Cutting board & carton', 'wood-plane': 'Planing wood',
  nuts: 'Nuts & bolts', 'hex-socket': 'Hex / Allen screws', 'recessed-nuts': 'Recessed nuts', 'socket-drive': 'Socket & ratchet work',
  'measure-short': 'Measuring up to 3.5 m', 'measure-mid': 'Measuring up to 5 m', 'measure-long': 'Measuring up to 15 m', 'measure-xl': 'Measuring up to 30 m',
  'level-short': 'Levelling in tight spots', 'level-long': 'Levelling long surfaces', masonry: 'Brick, block & plaster', tiling: 'Tiling',
  nailing: 'Driving nails', 'drill-wood': 'Drilling wood', 'drill-steel': 'Drilling mild steel', 'drill-stainless': 'Drilling stainless / hard steel',
  'drill-concrete': 'Drilling concrete & brick', 'drill-deep': 'Deep holes', rivet: 'Riveting sheet metal', woodwork: 'Carpentry & woodwork', plumbing: 'Plumbing', automotive: 'Car & bike repair'
};

const parseJSON = (s, fallback) => { try { const v = JSON.parse(s); return v ?? fallback; } catch { return fallback; } };

function categoriesById() {
  const map = new Map();
  for (const c of db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all()) map.set(c.id, c);
  return map;
}

function stockInfo(p) {
  if (p.stock <= 0) return { status: 'out', left: 0 };
  if (p.stock <= p.low_stock_threshold) return { status: 'low', left: p.stock };
  return { status: 'in', left: null }; // exact count hidden unless it's low
}

function ratingFor(productId) {
  const r = db.prepare('SELECT COUNT(*) AS n, AVG(rating) AS avg FROM reviews WHERE product_id = ? AND hidden = 0').get(productId);
  return { count: r.n, avg: r.avg ? Math.round(r.avg * 10) / 10 : null };
}

// "New" only for products added after the store opened (not the whole first catalog), for 21 days.
let firstProductAt = null;
function isNewProduct(p) {
  if (firstProductAt === null) firstProductAt = db.prepare('SELECT MIN(created_at) AS t FROM products').get().t || 0;
  return p.created_at > firstProductAt + 2 * 86400000 && Date.now() - p.created_at < 21 * 86400000;
}

function resolveMotion(p, cat) {
  if (p.motion && p.motion !== 'auto') return p.motion;
  return cat?.motion && cat.motion !== 'auto' ? cat.motion : 'zoom';
}

function toPublic(p, ctx, cats) {
  const cat = cats.get(p.category_id);
  return {
    id: p.id,
    slug: p.slug,
    sku: p.sku,
    name: p.name,
    category: cat ? { id: cat.id, slug: cat.slug, name: cat.name } : null,
    description: p.description,
    specs: parseJSON(p.specs_json, []),
    uses: parseJSON(p.uses_json, []),
    icon: p.icon,
    motion: resolveMotion(p, cat),
    sim: p.sim === 'auto' ? (MOTION_DEFAULT_SIM[resolveMotion(p, cat)] || 'none') : p.sim,
    featured: !!p.featured,
    images: parseJSON(p.images_json, []),
    video: p.video_url,
    demo: parseJSON(p.demo_json, {}),
    tags: parseJSON(p.tags_json, []),
    bulk: p.bulk_min_qty > 0 && p.bulk_percent > 0 ? { minQty: p.bulk_min_qty, percent: p.bulk_percent } : null,
    pricing: priceFor(p, ctx),
    stock: stockInfo(p),
    sold: p.sold_count,
    rating: ratingFor(p.id),
    createdAt: p.created_at,
    isNew: isNewProduct(p)
  };
}

function toAdmin(p, ctx, cats) {
  return {
    ...toPublic(p, ctx, cats),
    category_id: p.category_id,
    price: p.price,
    sale_price: p.sale_price,
    stockCount: p.stock,
    low_stock_threshold: p.low_stock_threshold,
    simSetting: p.sim,
    motionSetting: p.motion,
    priceConfirmed: !!p.price_confirmed,
    active: !!p.active,
    bulk_min_qty: p.bulk_min_qty,
    bulk_percent: p.bulk_percent,
    deleted_at: p.deleted_at,
    updated_at: p.updated_at
  };
}

module.exports = { DEMO_TYPES, TAGS, ICONS, SIMS, MOTIONS, ICON_DEFAULT_SIM, parseJSON, categoriesById, toPublic, toAdmin, stockInfo };
