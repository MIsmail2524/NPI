'use strict';
/* Adds the product-video setup and Tool Finder tags from data/catalog.json to an existing
   database, and points catalog photos at their latest (content-hashed) files,
   WITHOUT touching prices, stock, descriptions, orders or accounts.
   Photos the owner uploaded are always kept.
   Products are matched by SKU. Only empty video/tag fields are filled, unless --force is given.
   Usage:  npm run sync-catalog   (or: npm run sync-catalog -- --force) */
const fs = require('node:fs');
const path = require('node:path');
const { db, tx } = require('../server/db');

const force = process.argv.includes('--force');
const { products } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'catalog.json'), 'utf8'));
let updated = 0; let skipped = 0;
tx(() => {
  for (const p of products) {
    const row = db.prepare('SELECT id, demo_json, tags_json, images_json FROM products WHERE sku = ?').get(p.sku);
    if (!row) { skipped++; continue; }
    const emptyDemo = !row.demo_json || row.demo_json === '{}';
    const emptyTags = !row.tags_json || row.tags_json === '[]';
    if (force || emptyDemo) db.prepare('UPDATE products SET demo_json = ? WHERE id = ?').run(JSON.stringify(p.demo || {}), row.id);
    if (force || emptyTags) db.prepare('UPDATE products SET tags_json = ? WHERE id = ?').run(JSON.stringify(p.tags || []), row.id);
    // catalog photos: /uploads/npi-p07-2[-hash].webp -> the current file for photo 2 of p07
    const latest = new Map(p.images.map((u) => [u.match(/npi-p\d+-\d+/)[0], u]));
    let imgs = []; try { imgs = JSON.parse(row.images_json || '[]'); } catch { imgs = []; }
    const next = imgs.map((u) => { const m = /^\/uploads\/(npi-p\d+-\d+)(?:-[0-9a-f]{8})?\.webp$/.exec(u); return m && latest.get(m[1]) ? latest.get(m[1]) : u; });
    if (JSON.stringify(next) !== JSON.stringify(imgs)) db.prepare('UPDATE products SET images_json = ? WHERE id = ?').run(JSON.stringify(next), row.id);
    for (const [key, url] of latest) {
      db.prepare("UPDATE categories SET image = ? WHERE image LIKE ? || '%'").run(url, `/uploads/${key}`);
    }
    updated++;
  }
});
console.log(`Photos, video setup + Tool Finder tags synced for ${updated} products (${skipped} not found by SKU).`);
