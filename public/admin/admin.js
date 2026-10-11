/* ============================================================
   NPI Owner Dashboard
   Everything the owner needs, in plain language. All changes are
   saved to the server instantly and show on the shop straight away.
   ============================================================ */
'use strict';

(() => {
  const { html, mount, $, $$, api, money, toast } = NPI;

  const S = { me: null, products: [], cats: [], motions: [], sims: [], settings: null, dirty: false, timers: [] };
  const toMinor = (v) => NPI.parseMoney(v);
  const rs = (minor) => (minor === null || minor === undefined ? '' : String(Math.round(minor / 100)));

  const MOTION_INFO = {
    auto: ['Same as category', 'Uses the category\'s style'],
    zoom: ['Close-up zoom', 'Slow zoom across the product'],
    snip: ['Snip / squeeze', 'Pliers, cutters, pincers'],
    twist: ['Twist / drive', 'Screwdrivers and bits'],
    turn: ['Turn', 'Wrenches and keys'],
    swing: ['Swing & strike', 'Hammers'],
    pull: ['Pull & roll', 'Measuring tapes'],
    tilt: ['Tilt & settle', 'Spirit levels'],
    drill: ['Spin like a drill', 'Single drill bits'],
    spin: ['Full spin', 'Cutting discs, round items'],
    squeeze: ['Pump', 'Rivet guns'],
  };
  /** Sensible starting video type for a product, from its category / name. */
  function defaultDemoType(p, cat) {
    const n = `${p.name || ''} ${cat?.name || ''}`.toLowerCase();
    const rules = [[/cutting disc|diamond/, 'disc'], [/planer/, 'planer'], [/hacksaw/, 'hacksaw'], [/cutter|knife/, /pipe|ppr/.test(n) ? 'ppr' : /cable/.test(n) ? 'cable' : 'knife'],
      [/circlip/, /external/.test(n) ? 'circlip-ext' : 'circlip-int'], [/pincer|jamoor/, 'pincers'], [/locking/, 'locking'], [/long nose/, 'nose'], [/diagonal/, 'diagonal'], [/plier/, 'pliers'],
      [/rivet/, 'riveter'], [/bit/, /drill/.test(n) ? 'drill' : 'bits'], [/drill/, 'drill'], [/screwdriver/, 'screwdriver'], [/hammer/, 'hammer'], [/t-handle|t handle/, 'twrench'],
      [/allen|key set/, 'keys'], [/socket/, 'sockets'], [/wrench|spanner/, 'wrench'], [/long tape|30 m|15 m/, 'longtape'], [/tape/, 'tape'], [/mason/, 'mason'], [/level/, 'level']];
    for (const [re, t] of rules) if (re.test(n)) return t;
    return 'showcase';
  }
  let TAGS_VOCAB = {};
  const SIM_NAMES = { auto: 'Automatic', none: 'No demo', torque: 'Torque wrench', screw: 'Screwdriver', hammer: 'Hammer', tape: 'Tape measure', level: 'Spirit level', cutter: 'Wire cutter', knife: 'Utility knife', saw: 'Hand saw' };
  const STATUS_TEXT = { pending: 'New (waiting)', confirmed: 'Confirmed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' };
  const NEXT_LABEL = { confirmed: '✓ Confirm order', shipped: '🚚 Mark as shipped', delivered: '📦 Mark as delivered', cancelled: '✕ Cancel order' };
  const ACTIONS = {
    owner_login: 'Logged in', product_created: 'Added a product', product_updated: 'Edited a product', product_trashed: 'Moved a product to the bin',
    product_restored: 'Restored a product', product_deleted_permanently: 'Deleted a product forever', product_duplicated: 'Duplicated a product',
    product_price_changed: 'Changed a price', product_sale_price_changed: 'Changed a sale price', product_stock_changed: 'Set stock count',
    product_active_changed: 'Showed/hid a product', product_featured_changed: 'Featured/unfeatured a product', product_confirm_price_changed: 'Confirmed a price',
    stock_adjusted: 'Adjusted stock', file_uploaded: 'Uploaded a photo/video', category_created: 'Added a category', category_updated: 'Edited a category',
    category_deleted: 'Deleted a category', promotion_created: 'Created a deal', promotion_updated: 'Edited a deal', promotion_toggled: 'Switched a deal on/off',
    promotion_deleted: 'Deleted a deal', order_status: 'Updated an order', customer_disabled: 'Blocked a customer', customer_enabled: 'Unblocked a customer',
    review_deleted: 'Deleted a review', settings_updated: 'Changed store settings', password_changed: 'Changed password', catalog_exported: 'Downloaded a backup',
    catalog_imported: 'Imported products', login_failed: 'Failed login attempt'
  };

  const catName = (id) => S.cats.find((c) => c.id === id)?.name || 'No category';
  const thumb = (src, lg = false) => html`<span class="thumb ${lg ? 'lg' : ''}">${src ? html`<img src="${src}" alt="" loading="lazy">` : html`<span>📷</span>`}</span>`;
  const productImage = (id) => S.products.find((p) => p.id === id)?.images?.[0] || null;
  function waLink(phone) {
    let d = String(phone || '').replace(/[^0-9]/g, '');
    if (d.startsWith('0')) d = `92${d.slice(1)}`;
    return d ? `https://wa.me/${d}` : null;
  }
  function flash(el, cls = 'saved') { if (!el) return; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), 1200); }
  const err = (e) => toast(e.message || 'Something went wrong', { type: 'error', ms: 5000 });

  async function loadProducts() {
    const r = await api('/admin/products');
    S.products = r.products; S.motions = r.motions; S.sims = r.sims; TAGS_VOCAB = r.tags || {};
    return S.products;
  }
  async function loadCats() { const r = await api('/admin/categories'); S.cats = r.categories; return S.cats; }

  /* ============================================================
     clip engine (same as the shop) for live previews
     ============================================================ */
  const FRAME_MS = 1600;
  function reel(p) {
    const imgs = (p.images || []).slice(0, 4);
    if (!imgs.length) return html`<div class="reel"><span class="muted">No photo yet</span></div>`;
    return html`<div class="reel" data-motion="${p.motion || 'zoom'}" data-imgs="${JSON.stringify(imgs)}"><img class="reel-img is-on" src="${imgs[0]}" alt=""><div class="reel-bar"><span></span></div></div>`;
  }
  function playReel(el) {
    if (!el || el._playing) return;
    let imgs; try { imgs = JSON.parse(el.dataset.imgs || '[]'); } catch { imgs = []; }
    if (!imgs.length) return;
    el._playing = true; el.classList.add('playing'); el.style.setProperty('--frame', `${FRAME_MS}ms`);
    const motion = el.dataset.motion || 'zoom';
    const frames = imgs.slice(0, 3).flatMap((src) => [{ src, cls: `m-${motion}` }, { src, cls: 'm-closeup' }]);
    const a = el.querySelector('.reel-img');
    let b = el.querySelectorAll('.reel-img')[1];
    if (!b) { b = a.cloneNode(); b.classList.remove('is-on'); a.after(b); }
    let i = 0; const bar = el.querySelector('.reel-bar span');
    const step = () => {
      const f = frames[i % frames.length];
      const cur = el.querySelector('.reel-img.is-on'); let t = cur;
      if (cur.getAttribute('src') !== f.src) { t = cur === a ? b : a; t.src = f.src; cur.classList.remove('is-on'); t.classList.add('is-on'); }
      t.className = t.className.replace(/\bm-\w+/g, '').trim(); void t.offsetWidth; t.classList.add(f.cls);
      if (bar) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = ''; }
      i++;
    };
    step(); el._timer = setInterval(step, FRAME_MS);
  }
  function stopReel(el) {
    if (!el || !el._playing) return;
    el._playing = false; clearInterval(el._timer); el.classList.remove('playing');
    $$('.reel-img', el).forEach((im, k) => { im.className = `reel-img${k === 0 ? ' is-on' : ''}`; });
    try { $('.reel-img', el).src = JSON.parse(el.dataset.imgs)[0]; } catch { /* ignore */ }
  }

  /* ============================================================
     photo processing in the browser before upload:
     auto-rotate, shrink to 1400 px, optional white-background removal,
     export as light WebP. Phone photos of 5–8 MB become ~100 KB.
     ============================================================ */
  async function processPhoto(file, removeBg) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const max = 1400;
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k); const h = Math.round(bmp.height * k);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    let out = c;
    if (removeBg) {
      const id = ctx.getImageData(0, 0, w, h); const d = id.data;
      const n = w * h; const dist = new Uint8Array(n); const bg = new Uint8Array(n);
      for (let i = 0; i < n; i++) { const o = i * 4; dist[i] = 255 - Math.min(d[o], d[o + 1], d[o + 2]); }
      const TOL = 38; const stack = new Int32Array(n); let sp = 0;
      const seed = (i) => { if (!bg[i] && dist[i] < TOL) { bg[i] = 1; stack[sp++] = i; } };
      for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
      for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
      while (sp) {
        const i = stack[--sp]; const x = i % w;
        if (i >= w) seed(i - w); if (i < n - w) seed(i + w); if (x > 0) seed(i - 1); if (x < w - 1) seed(i + 1);
      }
      let minX = w; let minY = h; let maxX = 0; let maxY = 0;
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        if (bg[i]) { d[o] = 12; d[o + 1] = 13; d[o + 2] = 15; d[o + 3] = Math.min(150, dist[i] * 3.2); }
        if (d[o + 3] > 10) { const x = i % w; const y = (i / w) | 0; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      }
      ctx.putImageData(id, 0, 0);
      if (maxX > minX && maxY > minY) {
        const t = document.createElement('canvas'); t.width = maxX - minX + 1; t.height = maxY - minY + 1;
        t.getContext('2d').drawImage(c, minX, minY, t.width, t.height, 0, 0, t.width, t.height);
        out = t;
      }
    }
    let blob = await new Promise((r) => out.toBlob(r, 'image/webp', 0.85));
    if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => out.toBlob(r, 'image/png'));
    return blob;
  }
  async function uploadFile(file, { removeBg = false } = {}) {
    const isVideo = file.type.startsWith('video/');
    let body = file;
    if (!isVideo) {
      try { body = await processPhoto(file, removeBg); } catch { body = file; }
    }
    const form = new FormData();
    form.append('file', body, isVideo ? file.name : 'photo.webp');
    return api('/admin/uploads', { method: 'POST', form });
  }

  /* ============================================================
     router
     ============================================================ */
  const TITLES = { dashboard: 'Overview', products: 'Products', stock: 'Stock', deals: 'Deals & sales', orders: 'Orders', categories: 'Categories', customers: 'Customers', reviews: 'Reviews', messages: 'Messages', settings: 'Store settings', activity: 'Activity log', backup: 'Backup & import' };
  let lastHash = location.hash;
  async function route() {
    if (S.dirty && !await NPI.confirmBox({ title: 'Leave without saving?', text: 'You have changes on this page that are not saved yet.', ok: 'Leave page', cancel: 'Stay here', danger: true })) {
      history.replaceState(null, '', lastHash); return;
    }
    S.dirty = false; lastHash = location.hash;
    S.timers.forEach(clearInterval); S.timers = [];
    $$('.reel').forEach(stopReel);
    const [page, arg] = (location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard').split('/');
    $$('#sideNav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === page));
    $('#side').classList.remove('open'); $('#sideBackdrop').classList.remove('open');
    $('#pageTitle').textContent = TITLES[page] || 'Overview';
    const view = $('#view');
    mount(view, html`<div class="skel"></div><br><div class="skel"></div>`);
    window.scrollTo(0, 0);
    try {
      const fn = PAGES[page] || PAGES.dashboard;
      await fn(view, arg);
    } catch (e) {
      if (e.status === 401 || e.status === 403) { location.href = '/login?next=/admin'; return; }
      mount(view, html`<div class="card empty"><b>⚠</b>${e.message}<br><br><button class="btn btn-dark" type="button" id="retry">Try again</button></div>`);
      $('#retry')?.addEventListener('click', route);
    }
    view.focus({ preventScroll: true });
    refreshBadges();
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

  async function refreshBadges() {
    try {
      const d = await api('/admin/dashboard');
      const set = (id, n) => { const el = $(id); el.hidden = !n; el.textContent = String(n); };
      set('#navOrders', d.byStatus.pending || 0);
      set('#navMsgs', d.counts.unreadMessages || 0);
      set('#navLow', d.lowStock.length || 0);
      if (S.products.length) set('#navPrices', S.products.filter((p) => !p.priceConfirmed).length);
    } catch { /* ignore */ }
  }

  const PAGES = {};

  /* ============================================================
     OVERVIEW
     ============================================================ */
  PAGES.dashboard = async (view) => {
    const [d] = await Promise.all([api('/admin/dashboard'), loadProducts()]);
    const max = Math.max(1, ...d.series.map((s) => s.revenue));
    const unconfirmed = S.products.filter((p) => !p.priceConfirmed).length;
    const noPhoto = S.products.filter((p) => !p.images.length).length;
    const hour = new Date().getHours();
    const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    mount(view, html`
      <p class="muted">${hello}, ${S.me.name.split(' ')[0]}! Here's how your store is doing.</p><br>
      ${d.byStatus.pending ? html`<a class="callout" href="#/orders"><span class="c-icon">🧾</span><div><b>${d.byStatus.pending} new order${d.byStatus.pending === 1 ? '' : 's'} waiting for you</b><p>Call the customer, then press “Confirm order”.</p></div><span class="spacer"></span><span class="btn btn-primary">Open orders →</span></a>` : ''}
      ${unconfirmed ? html`<a class="callout" href="#/products?filter=price"><span class="c-icon">💰</span><div><b>${unconfirmed} product price${unconfirmed === 1 ? '' : 's'} to check</b><p>These prices were set automatically when your catalog was loaded. Check each one and correct it if needed. It takes a few seconds per product.</p></div><span class="spacer"></span><span class="btn btn-dark">Check prices →</span></a>` : ''}
      ${noPhoto ? html`<a class="callout blue" href="#/products?filter=nophoto"><span class="c-icon">📷</span><div><b>${noPhoto} product${noPhoto === 1 ? '' : 's'} without photos</b><p>Products with photos sell much better.</p></div></a>` : ''}
      <div class="grid-kpi">
        <div class="card kpi"><span class="k-icon">💵</span><div class="k-label">Sales today</div><div class="k-value">${money(d.today.revenue)}</div><div class="k-sub">${d.today.orders} order${d.today.orders === 1 ? '' : 's'}</div></div>
        <div class="card kpi"><span class="k-icon">📅</span><div class="k-label">Last 7 days</div><div class="k-value">${money(d.week.revenue)}</div><div class="k-sub">${d.week.orders} orders</div></div>
        <div class="card kpi"><span class="k-icon">📈</span><div class="k-label">Last 30 days</div><div class="k-value">${money(d.month.revenue)}</div><div class="k-sub">${d.month.orders} orders</div></div>
        <a class="card kpi ${d.counts.outOfStock ? 'bad' : ''}" href="#/stock"><span class="k-icon">📦</span><div class="k-label">Products</div><div class="k-value">${d.counts.live} live</div><div class="k-sub">${d.counts.outOfStock} sold out · stock worth ${money(d.counts.stockValue)}</div></a>
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-head"><h3>Sales, last 14 days</h3><span class="muted small">hover a bar for details</span></div>
          <div class="chart">${d.series.map((s, i) => html`<div class="bar ${i === d.series.length - 1 ? 'today' : ''}"><span class="b" data-h="${(s.revenue / max) * 100}" data-tip="${money(s.revenue)} · ${s.orders} orders"></span><small>${s.date.slice(8)}</small></div>`)}</div></div>
        <div class="card"><div class="card-head"><h3>Running low</h3><a class="btn btn-sm btn-ghost" href="#/stock">Manage stock</a></div>
          <div class="list">${d.lowStock.length ? d.lowStock.slice(0, 6).map((p) => html`<div class="list-row">${thumb(productImage(p.id))}<div class="spacer"><b>${p.name}</b><div class="small ${p.stock ? 'muted' : ''}">${p.stock ? `${p.stock} left` : html`<span class="tag tag-red">Sold out</span>`}</div></div>
            <button class="btn btn-sm btn-green" type="button" data-receive="${p.id}">＋ Add stock</button></div>`) : html`<div class="empty"><b>✅</b>Everything is well stocked.</div>`}</div></div>
      </div><br>
      <div class="grid-2e">
        <div class="card"><div class="card-head"><h3>Latest orders</h3><a class="btn btn-sm btn-ghost" href="#/orders">All orders</a></div>
          <div class="list">${d.recent.length ? d.recent.map((o) => html`<a class="list-row" href="#/orders"><span class="mono"><b>${o.code}</b></span><span class="spacer">${o.customer_name}<div class="small muted">${NPI.ago(o.created_at)}</div></span><span class="status status-${o.status}">${STATUS_TEXT[o.status]}</span><b class="mono">${money(o.total)}</b></a>`)
            : html`<div class="empty"><b>🧾</b>No orders yet. They will appear here the moment a customer orders.</div>`}</div></div>
        <div class="card"><div class="card-head"><h3>Best sellers (30 days)</h3></div>
          <div class="list">${d.top.length ? d.top.map((t, i) => html`<a class="list-row" href="#/products/${t.id}"><b class="mono">#${i + 1}</b>${thumb(productImage(t.id))}<span class="spacer">${t.name}</span><span class="small muted">${t.qty} sold</span><b class="mono">${money(t.revenue)}</b></a>`)
            : html`<div class="empty"><b>🏆</b>Your top products will show here after the first sales.</div>`}</div>
          <div class="card-head"><h3>Deals</h3><a class="btn btn-sm btn-ghost" href="#/deals">Manage deals</a></div>
          <div class="list">${d.promotions.length ? d.promotions.map((p) => html`<a class="list-row" href="#/deals"><span>${p.live ? '🟢' : '⏳'}</span><span class="spacer"><b>${p.name}</b><div class="small muted">${p.live ? 'Live now' : 'Starts in'} <span data-countdown="${p.live ? p.endsInSec : p.startsInSec}"></span></div></span><span class="tag tag-green">${p.discount_type === 'percent' ? `${p.value}% off` : `${money(p.value)} off`}</span></a>`)
            : html`<div class="empty">No deals running. <a href="#/deals">Create one</a></div>`}</div></div>
      </div>`);
    NPI.startCountdowns(view);
    view.addEventListener('click', (e) => { const b = e.target.closest('[data-receive]'); if (b) receiveStockDialog(Number(b.dataset.receive), route); });
  };

  /* ============================================================
     PRODUCTS LIST: inline price / sale / stock / live / featured
     ============================================================ */
  PAGES.products = async (view, arg) => {
    if (arg === 'new') return PAGES.editor(view, null);
    if (arg && /^\d+/.test(arg)) return PAGES.editor(view, Number(arg));
    await Promise.all([loadProducts(), loadCats()]);
    const qp = new URLSearchParams(location.hash.split('?')[1] || '');
    const st = { q: '', cat: '', filter: qp.get('filter') || 'all', trash: false, sel: new Set() };

    const FILTERS = [
      ['all', 'All', () => true], ['live', 'In shop', (p) => p.active], ['hidden', 'Hidden', (p) => !p.active],
      ['low', 'Low stock', (p) => p.stockCount > 0 && p.stockCount <= p.low_stock_threshold], ['out', 'Sold out', (p) => p.stockCount === 0],
      ['sale', 'On sale', (p) => p.pricing.onSale], ['featured', 'Featured', (p) => p.featured], ['price', '⚠ Check price', (p) => !p.priceConfirmed],
      ['nophoto', 'No photo', (p) => !p.images.length]
    ];
    mount(view, html`
      <div class="toolbar">
        <input class="search-in" id="pq" type="search" placeholder="🔍 Search by name or SKU…" aria-label="Search products">
        <select class="sel" id="pcat" aria-label="Category"><option value="">All categories</option>${S.cats.map((c) => html`<option value="${c.id}">${c.name} (${c.count})</option>`)}</select>
        <button class="btn btn-ghost" type="button" id="binBtn">🗑 Bin</button>
        <a class="btn btn-primary" href="#/products/new">＋ Add product</a>
      </div>
      <div class="chips" id="pchips"></div>
      <div class="callout green no-print"><span class="c-icon">💡</span><div><b>Change prices and stock right here</b><p>Type a new price and press Enter, or use − / + for stock. Changes save instantly and appear in the shop immediately. Press “Edit” for photos, description and everything else.</p></div></div>
      <div class="card"><table class="ptable"><thead><tr><th><input type="checkbox" id="selAll" aria-label="Select all"></th><th>Product</th><th>Price (Rs)</th><th>Sale price</th><th>Stock</th><th>In shop</th><th>★</th><th></th></tr></thead><tbody id="ptbody"></tbody></table></div>
      <div class="bulkbar" id="bulkbar" hidden>
        <b id="selCount"></b>
        <select class="sel" id="bulkAction" aria-label="Bulk action">
          <option value="">Choose what to do…</option><option value="sale_percent">Put on sale (% off)</option><option value="clear_sale">Remove sale price</option>
          <option value="stock_add">Add stock (quantity)</option><option value="show">Show in shop</option><option value="hide">Hide from shop</option>
          <option value="feature">Feature on homepage</option><option value="unfeature">Remove from featured</option><option value="category">Move to category</option><option value="trash">Move to bin</option>
        </select>
        <input class="sel" id="bulkValue" type="number" placeholder="e.g. 10" hidden aria-label="Value">
        <select class="sel" id="bulkCat" hidden aria-label="Category">${S.cats.map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select>
        <button class="btn btn-primary" type="button" id="bulkApply">Apply</button>
        <button class="btn btn-ghost" type="button" id="bulkClear">Clear selection</button>
      </div>`);

    let trashList = [];
    const list = () => {
      let L = st.trash ? trashList : S.products;
      if (!st.trash) L = L.filter(FILTERS.find((f) => f[0] === st.filter)[2]);
      if (st.cat) L = L.filter((p) => p.category_id === Number(st.cat));
      if (st.q) { const q = st.q.toLowerCase(); L = L.filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(q)); }
      return L;
    };
    const drawChips = () => mount($('#pchips'), st.trash ? html`<span class="chip on">🗑 Bin: products you removed. Restore them or delete forever.</span>`
      : html`${FILTERS.map(([k, label, fn]) => html`<button class="chip ${st.filter === k ? 'on' : ''}" type="button" data-f="${k}">${label} <span class="n">${S.products.filter(fn).length}</span></button>`)}`);
    const row = (p) => html`<tr data-id="${p.id}" class="${st.sel.has(p.id) ? 'selected' : ''}">
      <td class="c-check"><input type="checkbox" data-sel="${p.id}" ${st.sel.has(p.id) ? 'checked' : ''} aria-label="Select ${p.name}"></td>
      <td class="c-main"><div class="row">${thumb(p.images[0], true)}<div class="spacer"><a class="p-name" href="#/products/${p.id}">${p.name}</a>
        <div class="p-meta"><span>${catName(p.category_id)}</span>${p.sku ? html`<span class="mono">· ${p.sku}</span>` : ''}
          ${!p.priceConfirmed ? html`<span class="tag tag-warn">⚠ Check price <button class="link" type="button" data-confirm="${p.id}">It's correct ✓</button></span>` : ''}
          ${p.pricing.promoId ? html`<span class="tag tag-jumma">${p.pricing.label} now</span>` : ''}
          ${!p.images.length ? html`<span class="tag tag-grey">No photo</span>` : ''}</div></div></div></td>
      ${st.trash ? html`<td class="c-wide" colspan="5"><span class="muted">Removed ${NPI.ago(p.deleted_at)}</span></td>
        <td class="c-wide"><div class="row"><button class="btn btn-sm btn-green" type="button" data-restore="${p.id}">↩ Restore</button><button class="btn btn-sm btn-danger-ghost" type="button" data-purge="${p.id}">Delete forever</button></div></td>`
      : html`<td data-label="Price"><label class="money-in"><span>Rs</span><input inputmode="decimal" data-price="${p.id}" value="${rs(p.price)}" aria-label="Price for ${p.name}"></label></td>
      <td data-label="Sale price"><label class="money-in sm"><span>Rs</span><input inputmode="decimal" data-sale="${p.id}" value="${rs(p.sale_price)}" placeholder="—" aria-label="Sale price for ${p.name}"></label>
        ${p.sale_price ? html`<div class="small">−${Math.round((1 - p.sale_price / p.price) * 100)}%</div>` : ''}</td>
      <td data-label="Stock"><div class="stepper ${p.stockCount <= p.low_stock_threshold ? 'low' : ''}"><button type="button" data-dec="${p.id}" aria-label="One less">−</button><input type="number" min="0" data-stock="${p.id}" value="${p.stockCount}" aria-label="Stock for ${p.name}"><button type="button" data-inc="${p.id}" aria-label="One more">+</button></div></td>
      <td data-label="In shop"><label class="switch"><input type="checkbox" data-active="${p.id}" ${p.active ? 'checked' : ''}><span class="small">${p.active ? 'Visible' : 'Hidden'}</span></label></td>
      <td data-label="Featured"><button class="star ${p.featured ? 'on' : ''}" type="button" data-feat="${p.id}" title="Show on homepage" aria-pressed="${p.featured}">★</button></td>
      <td class="c-wide"><div class="row"><a class="btn btn-sm btn-dark" href="#/products/${p.id}">✎ Edit</a><a class="btn btn-sm btn-ghost icon-only" href="/product/${p.slug}" target="_blank" rel="noopener" title="View in shop">↗</a>
        <button class="btn btn-sm btn-ghost icon-only" type="button" data-dup="${p.id}" title="Duplicate">⧉</button><button class="btn btn-sm btn-danger-ghost icon-only" type="button" data-del="${p.id}" title="Move to bin">🗑</button></div></td>`}
    </tr>`;
    const draw = () => {
      const L = list();
      drawChips();
      mount($('#ptbody'), L.length ? html`${L.map(row)}` : html`<tr><td colspan="8"><div class="empty"><b>🔍</b>No products here.${st.filter !== 'all' ? html` <button class="link" type="button" data-f="all">Show all</button>` : ''}</div></td></tr>`);
      $('#bulkbar').hidden = !st.sel.size || st.trash;
      $('#selCount').textContent = `${st.sel.size} selected`;
      $('#selAll').checked = L.length > 0 && L.every((p) => st.sel.has(p.id));
    };
    const replace = (p) => { const i = S.products.findIndex((x) => x.id === p.id); if (i >= 0) S.products[i] = p; };
    const patch = async (id, field, value, el) => {
      try { const r = await api(`/admin/products/${id}`, { method: 'PATCH', body: { field, value } }); replace(r.product); flash(el?.closest('.money-in, .stepper')); return r.product; }
      catch (e) { flash(el?.closest('.money-in, .stepper'), 'err'); err(e); return null; }
    };
    draw();

    $('#pq').addEventListener('input', (e) => { st.q = e.target.value.trim(); draw(); });
    $('#pcat').addEventListener('change', (e) => { st.cat = e.target.value; draw(); });
    $('#binBtn').addEventListener('click', async (e) => {
      st.trash = !st.trash; st.sel.clear();
      e.currentTarget.textContent = st.trash ? '← Back to products' : '🗑 Bin';
      if (st.trash) trashList = (await api('/admin/products?trash=1')).products;
      draw();
    });
    view.addEventListener('click', async (e) => {
      const t = e.target.closest('button, [data-f]'); if (!t) return;
      const id = Number(t.dataset.inc || t.dataset.dec || t.dataset.feat || t.dataset.dup || t.dataset.del || t.dataset.restore || t.dataset.purge || t.dataset.confirm);
      if (t.dataset.f) { st.filter = t.dataset.f; draw(); return; }
      if (t.dataset.confirm) { const p = await patch(id, 'confirm_price', 1); if (p) { toast('Price confirmed ✓'); draw(); } return; }
      if (t.dataset.inc || t.dataset.dec) {
        const input = $(`[data-stock="${id}"]`); input.value = String(Math.max(0, Number(input.value) + (t.dataset.inc ? 1 : -1)));
        clearTimeout(input._t);
        input._t = setTimeout(async () => { const p = await patch(id, 'stock', Number(input.value), input); if (p) toast(`Stock for "${p.name}" is now ${p.stockCount}`); }, 700);
        return;
      }
      if (t.dataset.feat) { const on = !t.classList.contains('on'); const p = await patch(id, 'featured', on); if (p) { t.classList.toggle('on', on); toast(on ? '★ Now featured on the homepage' : 'Removed from featured'); } return; }
      if (t.dataset.dup) { try { const r = await api(`/admin/products/${id}/duplicate`, { method: 'POST', body: {} }); toast('Copy created (hidden until you publish it)'); location.hash = `#/products/${r.product.id}`; } catch (x) { err(x); } return; }
      if (t.dataset.del) {
        const p = S.products.find((x) => x.id === id);
        try {
          await api(`/admin/products/${id}`, { method: 'DELETE' });
          S.products = S.products.filter((x) => x.id !== id); st.sel.delete(id); draw();
          toast(`"${p.name}" moved to the bin`, { action: 'Undo', ms: 7000, onAction: async () => { const r = await api(`/admin/products/${id}/restore`, { method: 'POST', body: {} }); S.products.unshift(r.product); draw(); } });
        } catch (x) { err(x); }
        return;
      }
      if (t.dataset.restore) { try { const r = await api(`/admin/products/${id}/restore`, { method: 'POST', body: {} }); trashList = trashList.filter((x) => x.id !== id); S.products.unshift(r.product); draw(); toast('Restored. It is hidden until you switch “In shop” on.'); } catch (x) { err(x); } return; }
      if (t.dataset.purge) {
        if (!await NPI.confirmBox({ title: 'Delete forever?', text: 'This cannot be undone. Past orders keep their details.', ok: 'Delete forever', danger: true })) return;
        try { await api(`/admin/products/${id}/permanent`, { method: 'DELETE' }); trashList = trashList.filter((x) => x.id !== id); draw(); toast('Deleted'); } catch (x) { err(x); }
      }
    });
    view.addEventListener('change', async (e) => {
      const t = e.target;
      if (t.dataset.sel) { const id = Number(t.dataset.sel); if (t.checked) st.sel.add(id); else st.sel.delete(id); t.closest('tr').classList.toggle('selected', t.checked); $('#bulkbar').hidden = !st.sel.size; $('#selCount').textContent = `${st.sel.size} selected`; return; }
      if (t.id === 'selAll') { list().forEach((p) => (t.checked ? st.sel.add(p.id) : st.sel.delete(p.id))); draw(); return; }
      if (t.dataset.price) {
        const v = toMinor(t.value); if (!v || Number.isNaN(v)) { flash(t.closest('.money-in'), 'err'); toast('Please type a valid price, e.g. 1250', { type: 'warn' }); return; }
        const p = await patch(Number(t.dataset.price), 'price', v, t); if (p) { toast(`Price of "${p.name}" is now ${money(p.price)}`); draw(); }
        return;
      }
      if (t.dataset.sale) {
        const v = t.value.trim() === '' ? null : toMinor(t.value);
        if (Number.isNaN(v)) { flash(t.closest('.money-in'), 'err'); return; }
        const p = await patch(Number(t.dataset.sale), 'sale_price', v, t);
        if (p) { toast(v === null ? 'Sale removed' : `On sale for ${money(v)} (−${Math.round((1 - v / p.price) * 100)}%)`); draw(); }
        return;
      }
      if (t.dataset.stock) { const p = await patch(Number(t.dataset.stock), 'stock', Math.max(0, Number.parseInt(t.value, 10) || 0), t); if (p) toast(`Stock for "${p.name}" is now ${p.stockCount}`); return; }
      if (t.dataset.active) { const p = await patch(Number(t.dataset.active), 'active', t.checked); if (p) { t.nextElementSibling.textContent = p.active ? 'Visible' : 'Hidden'; toast(p.active ? `"${p.name}" is now in the shop` : `"${p.name}" is hidden from customers`); } }
    });
    view.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-price],[data-sale],[data-stock]')) e.target.blur(); });
    $('#bulkAction').addEventListener('change', (e) => {
      const a = e.target.value;
      $('#bulkValue').hidden = !['sale_percent', 'stock_add'].includes(a);
      $('#bulkValue').placeholder = a === 'sale_percent' ? '% off, e.g. 10' : 'quantity, e.g. 20';
      $('#bulkCat').hidden = a !== 'category';
    });
    $('#bulkClear').addEventListener('click', () => { st.sel.clear(); draw(); });
    $('#bulkApply').addEventListener('click', async (e) => {
      const action = $('#bulkAction').value; if (!action) { toast('Choose what to do first', { type: 'warn' }); return; }
      const value = action === 'category' ? Number($('#bulkCat').value) : Number($('#bulkValue').value);
      if (['sale_percent', 'stock_add'].includes(action) && !value) { toast('Type a number first', { type: 'warn' }); $('#bulkValue').focus(); return; }
      if (action === 'trash' && !await NPI.confirmBox({ title: `Move ${st.sel.size} products to the bin?`, text: 'You can restore them from the Bin.', ok: 'Move to bin', danger: true })) return;
      NPI.busy(e.currentTarget, true);
      try {
        const r = await api('/admin/products/bulk', { method: 'POST', body: { ids: [...st.sel], action, value } });
        toast(`Done. ${r.changed} product${r.changed === 1 ? '' : 's'} updated`); st.sel.clear(); await loadProducts(); draw();
      } catch (x) { err(x); } finally { NPI.busy(e.currentTarget, false); }
    });
  };

  /* ============================================================
     PRODUCT EDITOR with live preview
     ============================================================ */
  PAGES.editor = async (view, id) => {
    await Promise.all([loadCats(), S.motions.length ? null : loadProducts()]);
    let p; let movements = [];
    if (id) { const r = await api(`/admin/products/${id}`); p = r.product; movements = r.movements; }
    else {
      const qp = new URLSearchParams(location.hash.split('?')[1] || '');
      p = { name: '', sku: '', category_id: Number(qp.get('cat')) || S.cats[0]?.id || null, description: '', specs: [], uses: [], price: null, sale_price: null, stockCount: 0, low_stock_threshold: 5, motionSetting: 'auto', simSetting: 'auto', featured: false, active: true, bulk_min_qty: 0, bulk_percent: 0, images: [], video: '' };
    }
    $('#pageTitle').textContent = id ? 'Edit product' : 'Add a product';
    const m = { images: [...p.images], video: p.video || '', specs: p.specs.length ? p.specs.map((s) => ({ ...s })) : [{ label: '', value: '' }], uses: p.uses.length ? [...p.uses] : [''], motion: p.motionSetting || 'auto', demo: JSON.parse(JSON.stringify(p.demo || {})), tags: [...(p.tags || [])] };
    if (!m.demo.type) m.demo.type = defaultDemoType(p, S.cats.find((c) => c.id === p.category_id));
    m.demo.spots = m.demo.spots || [];

    mount(view, html`
      <form id="pform" novalidate>
      <div class="form-grid">
        <div>
          <div class="card section-card"><h3><span class="step">1</span> Name &amp; category</h3><div class="section-body">
            <div class="field"><label for="fName">Product name</label><input type="text" id="fName" name="name" maxlength="140" value="${p.name}" placeholder="e.g. Milestone Combination Pliers (Orange Grip)" required></div>
            <div class="cols-2">
              <div class="field"><label for="fCat">Category</label><select id="fCat" name="category_id">${S.cats.map((c) => html`<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${c.name}</option>`)}<option value="" ${!p.category_id ? 'selected' : ''}>No category</option></select>
                <span class="help">Need a new one? <a href="#/categories">Add a category</a></span></div>
              <div class="field"><label for="fSku">Product code / SKU (optional)</label><input type="text" id="fSku" name="sku" maxlength="60" value="${p.sku}" placeholder="e.g. NP1008"></div>
            </div>
          </div></div>

          <div class="card section-card"><h3><span class="step">2</span> Photos &amp; hover clip</h3><div class="section-body">
            <label class="drop" id="drop" tabindex="0"><b>📷 Drop photos here or tap to choose</b><span class="muted">JPG, PNG or WEBP. Phone photos are fine; they're resized automatically. The first photo is the main one.</span>
              <input type="file" id="fFiles" accept="image/*" multiple hidden></label>
            <label class="switch"><input type="checkbox" id="fRemoveBg" checked> Remove white background automatically (best for studio photos on white)</label>
            <div class="photos" id="photos"></div>
            <div class="field"><span class="lbl">How should the photo move when a customer hovers it?</span>
              <div class="motion-pick" id="motionPick">${S.motions.map((k) => html`<button type="button" class="motion-opt ${m.motion === k ? 'on' : ''}" data-motion="${k}"><b>${MOTION_INFO[k]?.[0] || k}</b><span>${MOTION_INFO[k]?.[1] || ''}</span></button>`)}</div>
              <span class="help">Hover the preview on the right to see it. Got a real video of the tool working? Add it below and it will play instead.</span></div>
            <div class="field"><span class="lbl">Video clip (optional, MP4/WEBM, max 25 MB)</span>
              <div class="row" id="videoRow"></div></div>
          </div></div>

          <div class="card section-card"><h3><span class="step">▶</span> Product video &amp; Tool Finder</h3><div class="section-body">
            <p class="help">Every product gets an animated video made from its photo: it shows the tool working, then zooms into each part with its specification. Set it up once below.</p>
            <div class="cols-2">
              <div class="field"><label for="fDemoType">What should the video show?</label><select id="fDemoType">${Object.entries(NPI_DEMO.TYPES).map(([k, v]) => html`<option value="${k}" ${m.demo.type === k ? 'selected' : ''}>${v.label}</option>`)}</select></div>
              <div class="field"><span class="lbl">Photo used in the video</span><div class="row" id="demoImgs"></div></div>
            </div>
            <div class="demo-setup">
              <div class="demo-pick" id="demoPick"><span class="muted">Add a photo first</span></div>
              <div class="stack">
                <span class="lbl">Tap a button, then tap the photo:</span>
                <div class="stack" id="demoPoints"></div>
                <div class="cols-2" id="demoOpts"></div>
                <button class="btn btn-dark" type="button" id="demoPreview">▶ Preview the video</button>
              </div>
            </div>
            <div class="field"><span class="lbl">Recommend this product in the Tool Finder for:</span><div class="tag-picks" id="tagPicks"></div></div>
          </div></div>

          <div class="card section-card"><h3><span class="step">3</span> Price</h3><div class="section-body">
            <div class="cols-2">
              <div class="field"><label for="fPrice">Normal price</label><div class="money-field"><span>Rs</span><input type="text" inputmode="decimal" id="fPrice" name="price" value="${rs(p.price)}" placeholder="0"></div></div>
              <div class="field"><label for="fSale">Sale price (leave empty if not on sale)</label><div class="money-field"><span>Rs</span><input type="text" inputmode="decimal" id="fSale" name="sale_price" value="${rs(p.sale_price)}" placeholder="—"></div>
                <div class="quick" id="quickSale">${[5, 10, 15, 20, 25, 30].map((n) => html`<button type="button" data-pct="${n}">−${n}%</button>`)}<button type="button" data-pct="0">No sale</button></div></div>
            </div>
            <div class="summary-line" id="saveLine" hidden></div>
            <div class="cols-2">
              <div class="field"><label for="fBulkQty">Bulk discount: from quantity</label><input type="number" id="fBulkQty" name="bulk_min_qty" min="0" value="${p.bulk_min_qty || ''}" placeholder="e.g. 10"><span class="help">Leave empty for no bulk discount.</span></div>
              <div class="field"><label for="fBulkPct">Bulk discount %</label><input type="number" id="fBulkPct" name="bulk_percent" min="0" max="90" value="${p.bulk_percent || ''}" placeholder="e.g. 5"></div>
            </div>
            <span class="help">Weekly deals like Jumma Deal are set up in <a href="#/deals">Deals &amp; sales</a> and apply on top automatically.</span>
          </div></div>

          <div class="card section-card"><h3><span class="step">4</span> Stock</h3><div class="section-body">
            ${id ? html`<div class="row"><div><div class="lbl">In stock now</div><div class="mono" id="stockNow"><b>${p.stockCount}</b> pieces</div></div><span class="spacer"></span>
                <button class="btn btn-green" type="button" id="stockIn">＋ Received new stock</button><button class="btn btn-ghost" type="button" id="stockOut">− Remove stock</button></div>
                <span class="help">Stock goes down by itself when customers order, and comes back if an order is cancelled.</span>`
              : html`<div class="field"><label for="fStock">How many do you have right now?</label><input type="number" id="fStock" name="stock" min="0" value="0"></div>`}
            <div class="field"><label for="fLow">Warn me when stock falls to</label><input type="number" id="fLow" name="low_stock_threshold" min="0" value="${p.low_stock_threshold}"><span class="help">Customers see “Only X left” at this level, which also encourages them to buy.</span></div>
            ${id && movements.length ? html`<details><summary class="link">Stock history (${movements.length})</summary><div class="table-wrap"><table class="table"><tr><th>When</th><th>Change</th><th>After</th><th>Why</th></tr>
              ${movements.map((mv) => html`<tr><td>${NPI.dateTime(mv.created_at)}</td><td class="${mv.delta >= 0 ? 'delta-pos' : 'delta-neg'}">${mv.delta > 0 ? '+' : ''}${mv.delta}</td><td class="mono">${mv.stock_after}</td><td>${mv.reason}${mv.ref ? html` <span class="mono small">${mv.ref}</span>` : ''}</td></tr>`)}</table></div></details>` : ''}
          </div></div>

          <div class="card section-card"><h3><span class="step">5</span> Description &amp; details</h3><div class="section-body">
            <div class="field"><label for="fDesc">Description</label><textarea id="fDesc" name="description" maxlength="5000" placeholder="What is it, what makes it good, who is it for?">${p.description}</textarea></div>
            <div class="field"><span class="lbl">Specifications</span><div class="stack" id="specs"></div><button class="btn btn-sm btn-ghost" type="button" id="addSpec">＋ Add a specification</button></div>
            <div class="field"><span class="lbl">Good for (uses)</span><div class="stack" id="uses"></div><button class="btn btn-sm btn-ghost" type="button" id="addUse">＋ Add a use</button></div>
          </div></div>

          <div class="card section-card"><h3><span class="step">6</span> Visibility</h3><div class="section-body">
            <label class="switch"><input type="checkbox" name="active" id="fActive" ${p.active ? 'checked' : ''}> Show this product in the shop</label>
            <label class="switch"><input type="checkbox" name="featured" id="fFeat" ${p.featured ? 'checked' : ''}> Feature it on the homepage</label>
            <div class="field"><label for="fSim">Tool Lab demo</label><select id="fSim" name="sim">${S.sims.map((k) => html`<option value="${k}" ${p.simSetting === k ? 'selected' : ''}>${SIM_NAMES[k] || k}</option>`)}</select></div>
          </div></div>

          <div class="sticky-save">
            <button class="btn btn-primary btn-lg" type="submit" id="saveBtn">${id ? '💾 Save changes' : '＋ Add product'}</button>
            <a class="btn btn-ghost" href="#/products">Cancel</a>
            ${id ? html`<a class="btn btn-ghost" href="/product/${p.slug}" target="_blank" rel="noopener">↗ View in shop</a>` : ''}
            <span class="dirty" id="dirtyNote" hidden>● Unsaved changes</span>
          </div>
        </div>
        <aside class="preview"><div class="card"><div class="card-head"><h3>Live preview</h3><span class="small muted">hover to play</span></div>
          <div class="pv-media" id="pvMedia"></div><div class="pv-body"><div class="pv-cat" id="pvCat"></div><div class="pv-name" id="pvName"></div><div class="pv-price" id="pvPrice"></div><div class="small muted" id="pvStock"></div></div></div>
          ${id ? html`<br><div class="card card-pad stack"><button class="btn btn-ghost" type="button" id="dupBtn">⧉ Duplicate this product</button><button class="btn btn-danger-ghost" type="button" id="delBtn">🗑 Move to bin</button></div>` : ''}
        </aside>
      </div></form>`);

    const form = $('#pform');
    const setDirty = () => { S.dirty = true; $('#dirtyNote').hidden = false; };
    const motionOf = () => (m.motion === 'auto' ? (S.cats.find((c) => c.id === Number($('#fCat').value))?.motion || 'zoom') : m.motion);

    const drawPreview = () => {
      const price = toMinor($('#fPrice').value); const sale = toMinor($('#fSale').value);
      const pvm = $('#pvMedia'); stopReel($('.reel', pvm));
      mount(pvm, reel({ images: m.images, motion: motionOf() }));
      $('#pvCat').textContent = $('#fCat').selectedOptions[0]?.textContent || '';
      $('#pvName').textContent = $('#fName').value || 'Product name';
      mount($('#pvPrice'), sale && price && sale < price ? html`<span class="pv-sale">${money(sale)}</span><s>${money(price)}</s>` : html`${price ? money(price) : 'Rs —'}`);
      const stock = id ? p.stockCount : Number($('#fStock')?.value || 0);
      $('#pvStock').textContent = stock <= 0 ? 'Sold out' : stock <= Number($('#fLow').value) ? `Only ${stock} left` : 'In stock';
      const line = $('#saveLine');
      if (sale && price && sale < price) { line.hidden = false; line.textContent = `Customers save ${money(price - sale)} (${Math.round((1 - sale / price) * 100)}% off)`; } else line.hidden = true;
    };
    $('#pvMedia').addEventListener('mouseenter', () => playReel($('#pvMedia .reel')));
    $('#pvMedia').addEventListener('mouseleave', () => stopReel($('#pvMedia .reel')));

    // photos
    const drawPhotos = () => {
      mount($('#photos'), html`${m.images.map((u, i) => html`<div class="photo ${i === 0 ? 'main' : ''}">${i === 0 ? html`<span class="badge-main">Main</span>` : ''}<img src="${u}" alt="Photo ${i + 1}">
        <div class="ph-actions">${i > 0 ? html`<button type="button" data-main="${i}" title="Make main photo">★</button><button type="button" data-left="${i}" title="Move left">◀</button>` : ''}${i < m.images.length - 1 ? html`<button type="button" data-right="${i}" title="Move right">▶</button>` : ''}<button type="button" class="del" data-rm="${i}" title="Remove">✕</button></div></div>`)}`);
      drawPreview();
    };
    $('#photos').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const i = Number(b.dataset.main ?? b.dataset.left ?? b.dataset.right ?? b.dataset.rm);
      if (b.dataset.main) { const [x] = m.images.splice(i, 1); m.images.unshift(x); }
      else if (b.dataset.left) [m.images[i - 1], m.images[i]] = [m.images[i], m.images[i - 1]];
      else if (b.dataset.right) [m.images[i + 1], m.images[i]] = [m.images[i], m.images[i + 1]];
      else if (b.dataset.rm) m.images.splice(i, 1);
      setDirty(); drawPhotos();
    });
    const addFiles = async (files) => {
      const list = [...files].filter((f) => f.type.startsWith('image/'));
      if (!list.length) { toast('Please choose photo files (JPG, PNG, WEBP)', { type: 'warn' }); return; }
      if (m.images.length + list.length > 12) { toast('Up to 12 photos per product', { type: 'warn' }); return; }
      for (const f of list) {
        const ph = document.createElement('div'); ph.className = 'photo uploading'; $('#photos').append(ph);
        try { const r = await uploadFile(f, { removeBg: $('#fRemoveBg').checked }); m.images.push(r.url); setDirty(); }
        catch (x) { err(x); }
        ph.remove(); drawPhotos();
      }
      toast('Photos added. Remember to save.');
    };
    $('#fFiles').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
    const drop = $('#drop');
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#fFiles').click(); } });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

    // video
    const drawVideo = () => mount($('#videoRow'), m.video
      ? html`<video src="${m.video}" muted loop playsinline controls class="thumb lg"></video><span class="spacer small muted">Plays when customers hover the product.</span><button class="btn btn-sm btn-danger-ghost" type="button" id="vidRm">Remove video</button>`
      : html`<label class="btn btn-ghost">🎬 Upload video<input type="file" id="vidFile" accept="video/mp4,video/webm" hidden></label><span class="small muted">e.g. a 5–10 second clip of the tool being used</span>`);
    $('#videoRow').addEventListener('click', (e) => { if (e.target.id === 'vidRm') { m.video = ''; setDirty(); drawVideo(); } });
    $('#videoRow').addEventListener('change', async (e) => {
      if (e.target.id !== 'vidFile' || !e.target.files[0]) return;
      const f = e.target.files[0];
      if (f.size > 25 * 1024 * 1024) { toast('Video is too big (max 25 MB)', { type: 'warn' }); return; }
      toast('Uploading video…');
      try { const r = await uploadFile(f); m.video = r.url; setDirty(); drawVideo(); toast('Video added. Remember to save.'); } catch (x) { err(x); }
    });

    // motion picker
    $('#motionPick').addEventListener('click', (e) => {
      const b = e.target.closest('[data-motion]'); if (!b) return;
      m.motion = b.dataset.motion; setDirty();
      $$('#motionPick .motion-opt').forEach((x) => x.classList.toggle('on', x === b));
      drawPreview(); playReel($('#pvMedia .reel'));
      setTimeout(() => stopReel($('#pvMedia .reel')), FRAME_MS * 2);
    });

    // specs & uses editors
    const drawSpecs = () => mount($('#specs'), html`${m.specs.map((s, i) => html`<div class="kv-row"><input class="inp" type="text" maxlength="60" data-sl="${i}" value="${s.label}" placeholder="e.g. Length" aria-label="Specification name"><input class="inp" type="text" maxlength="160" data-sv="${i}" value="${s.value}" placeholder="e.g. 5 m / 16 ft" aria-label="Specification value"><button class="x-btn" type="button" data-sx="${i}" aria-label="Remove">✕</button></div>`)}`);
    const drawUses = () => mount($('#uses'), html`${m.uses.map((u, i) => html`<div class="kv-row"><input class="inp" type="text" maxlength="160" data-u="${i}" value="${u}" placeholder="e.g. Electrical wiring" aria-label="Use"><span></span><button class="x-btn" type="button" data-ux="${i}" aria-label="Remove">✕</button></div>`)}`);
    drawSpecs(); drawUses(); drawPhotos(); drawVideo();

    /* ---------- product video setup ---------- */
    let placing = null; // 'pivot' | 'tip' | 'vial' | 'spot:N'
    const HINGE = ['pliers', 'nose', 'diagonal', 'cable', 'locking', 'circlip-int', 'circlip-ext', 'pincers', 'ppr', 'riveter'];
    const TIP_LABEL = { screwdriver: 'Screwdriver tip', bits: 'Bit tip', hammer: 'Striking face', wrench: 'Centre of the jaw opening', twrench: 'Socket end', tape: 'Where the blade comes out', knife: 'Blade tip', hacksaw: 'Middle of the blade', riveter: 'Nozzle tip', ppr: 'Blade edge', locking: 'Between the jaws', pincers: 'Jaw tips' };
    const curImg = () => m.images[m.demo.img || 0] || m.images[0];
    const drawDemoSetup = () => {
      const type = m.demo.type;
      mount($('#demoImgs'), m.images.length ? html`${m.images.map((u, i) => html`<button type="button" class="thumb ${i === (m.demo.img || 0) ? 'sel' : ''}" data-dimg="${i}" aria-label="Use photo ${i + 1}"><img src="${u}" alt=""></button>`)}` : html`<span class="muted small">No photos yet</span>`);
      const pts = [];
      if (HINGE.includes(type)) pts.push(['pivot', '🔩 Hinge pin (where it pivots)']);
      if (type !== 'showcase' && !['level', 'mason', 'drill', 'planer', 'disc', 'keys', 'sockets', 'longtape'].includes(type)) pts.push(['tip', `🎯 ${TIP_LABEL[type] || 'Working end (jaw tips)'}`]);
      if (['pliers', 'diagonal'].includes(type)) pts.push(['cut', '✂ Side-cutter edge']);
      if (['level', 'mason'].includes(type)) pts.push(['vial', '🫧 Centre bubble vial']);
      const specRows = m.specs.filter((sp) => sp.label.trim());
      mount($('#demoPoints'), html`${pts.map(([k, label]) => html`<button type="button" class="pt-btn ${placing === k ? 'on' : ''} ${m.demo[k] ? 'set' : ''}" data-place="${k}">${label} ${m.demo[k] ? '✓' : ''}</button>`)}
        ${specRows.length ? html`<span class="small muted">Close-up spots (one per specification):</span>` : ''}
        ${specRows.map((sp, i) => html`<button type="button" class="pt-btn ${placing === `spot:${i}` ? 'on' : ''} ${m.demo.spots[i] ? 'set' : ''}" data-place="spot:${i}">🔍 ${i + 1}. ${sp.label}: ${sp.value} ${m.demo.spots[i] ? '✓' : ''}</button>`)}`);
      const opts = [];
      if (HINGE.includes(type)) {
        opts.push(html`<div class="field"><label>Hinge style</label><select data-dopt="hinge"><option value="cross" ${m.demo.hinge !== 'side' && m.demo.hinge !== 'lever' ? 'selected' : ''}>Crossing arms (pliers)</option><option value="side" ${m.demo.hinge === 'side' ? 'selected' : ''}>Side by side</option><option value="lever" ${m.demo.hinge === 'lever' ? 'selected' : ''}>One moving handle</option></select></div>`);
        if (m.demo.hinge === 'lever' || ['locking', 'ppr', 'riveter'].includes(type)) opts.push(html`<div class="field"><label>Moving handle</label><select data-dopt="lever"><option value="right" ${m.demo.lever !== 'left' ? 'selected' : ''}>Right</option><option value="left" ${m.demo.lever === 'left' ? 'selected' : ''}>Left</option></select></div>`);
      }
      if (type === 'drill') {
        opts.push(html`<div class="field"><label>Drills into</label><select data-dopt="material">${[['steel', 'Mild steel'], ['stainless', 'Stainless steel'], ['wood', 'Wood'], ['concrete', 'Concrete / brick']].map(([v, l]) => html`<option value="${v}" ${m.demo.material === v ? 'selected' : ''}>${l}</option>`)}</select></div>`);
        opts.push(html`<div class="field"><label>Bit colour</label><select data-dopt="finish">${[['steel', 'Bright steel'], ['gold', 'Gold / cobalt'], ['black', 'Black']].map(([v, l]) => html`<option value="${v}" ${m.demo.finish === v ? 'selected' : ''}>${l}</option>`)}</select></div>`);
      }
      mount($('#demoOpts'), html`${opts}`);
      const src = curImg();
      if (!src) { mount($('#demoPick'), html`<span class="muted">Add a photo first</span>`); return; }
      const marks = [];
      for (const k of ['pivot', 'tip', 'cut', 'vial']) if (m.demo[k]) marks.push([k === 'pivot' ? '🔩' : k === 'vial' ? '🫧' : k === 'cut' ? '✂' : '🎯', m.demo[k]]);
      m.demo.spots.forEach((sp, i) => { if (sp && specRows[i]) marks.push([String(i + 1), sp]); });
      mount($('#demoPick'), html`<div class="dp-wrap ${placing ? 'placing' : ''}"><img src="${src}" alt="Tap to place" draggable="false">${marks.map(([t, [u, v]]) => html`<span class="dp-mark" data-u="${u}" data-v="${v}">${t}</span>`)}</div>
        ${placing ? html`<div class="dp-tip">👆 Now tap the photo</div>` : ''}`);
      $$('#demoPick .dp-mark').forEach((mk) => { mk.style.left = `${Number(mk.dataset.u) * 100}%`; mk.style.top = `${Number(mk.dataset.v) * 100}%`; });
    };
    drawDemoSetup();
    const drawTags = () => mount($('#tagPicks'), html`${Object.entries(TAGS_VOCAB).map(([k, label]) => html`<label class="tag-pick ${m.tags.includes(k) ? 'on' : ''}"><input type="checkbox" data-tag="${k}" ${m.tags.includes(k) ? 'checked' : ''}> ${label}</label>`)}`);
    drawTags();
    $('#tagPicks').addEventListener('change', (e) => { const k = e.target.dataset.tag; if (!k) return; m.tags = e.target.checked ? [...m.tags, k] : m.tags.filter((x) => x !== k); setDirty(); drawTags(); });
    $('#fDemoType').addEventListener('change', (e) => { m.demo.type = e.target.value; placing = null; setDirty(); drawDemoSetup(); });
    $('#demoImgs').addEventListener('click', (e) => { const b = e.target.closest('[data-dimg]'); if (!b) return; m.demo.img = Number(b.dataset.dimg); setDirty(); drawDemoSetup(); });
    $('#demoPoints').addEventListener('click', (e) => { const b = e.target.closest('[data-place]'); if (!b) return; placing = placing === b.dataset.place ? null : b.dataset.place; drawDemoSetup(); });
    $('#demoOpts').addEventListener('change', (e) => { const k = e.target.dataset.dopt; if (!k) return; m.demo[k] = e.target.value; setDirty(); drawDemoSetup(); });
    $('#demoPick').addEventListener('click', (e) => {
      if (!placing) return;
      const img = $('#demoPick img'); if (!img) return;
      const r = img.getBoundingClientRect();
      const u = Math.round(((e.clientX - r.left) / r.width) * 1000) / 1000; const v = Math.round(((e.clientY - r.top) / r.height) * 1000) / 1000;
      if (u < -0.2 || u > 1.2 || v < -0.2 || v > 1.2) return;
      if (placing.startsWith('spot:')) m.demo.spots[Number(placing.slice(5))] = [u, v]; else m.demo[placing] = [u, v];
      placing = null; setDirty(); drawDemoSetup();
    });
    $('#demoPreview').addEventListener('click', () => {
      if (!m.images.length) { toast('Add a photo first', { type: 'warn' }); return; }
      const price = toMinor($('#fPrice').value) || 0;
      NPI_DEMO.openModal({
        name: $('#fName').value || 'Product', slug: p.slug || 'preview', images: m.images, demo: m.demo,
        specs: m.specs.filter((sp) => sp.label.trim()), uses: m.uses.filter((u) => u.trim()),
        category: { name: $('#fCat').selectedOptions[0]?.textContent || '' },
        pricing: { price, list: price, onSale: false, savePercent: 0 }, stock: { status: 'in' }
      });
    });
    $('#addSpec').addEventListener('click', () => { m.specs.push({ label: '', value: '' }); drawSpecs(); $$('#specs [data-sl]').pop().focus(); });
    $('#addUse').addEventListener('click', () => { m.uses.push(''); drawUses(); $$('#uses [data-u]').pop().focus(); });
    form.addEventListener('click', (e) => {
      const t = e.target;
      if (t.dataset.sx) { m.specs.splice(Number(t.dataset.sx), 1); setDirty(); drawSpecs(); }
      if (t.dataset.ux) { m.uses.splice(Number(t.dataset.ux), 1); setDirty(); drawUses(); }
      if (t.dataset.pct !== undefined) {
        const price = toMinor($('#fPrice').value); const pct = Number(t.dataset.pct);
        if (!price) { toast('Type the normal price first', { type: 'warn' }); return; }
        $('#fSale').value = pct ? String(Math.round(price * (100 - pct) / 10000)) : ''; setDirty(); drawPreview();
      }
    });
    form.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.sl) m.specs[Number(t.dataset.sl)].label = t.value;
      if (t.dataset.sv) m.specs[Number(t.dataset.sv)].value = t.value;
      if (t.dataset.u) m.uses[Number(t.dataset.u)] = t.value;
      if (t.type !== 'file') setDirty();
      if (['fName', 'fPrice', 'fSale', 'fCat', 'fStock', 'fLow'].includes(t.id)) drawPreview();
    });
    form.addEventListener('change', (e) => { if (e.target.id === 'fCat') drawPreview(); });

    // stock in/out (existing products)
    $('#stockIn')?.addEventListener('click', () => receiveStockDialog(id, async () => { const r = await api(`/admin/products/${id}`); p = r.product; mount($('#stockNow'), html`<b>${p.stockCount}</b> pieces`); drawPreview(); }));
    $('#stockOut')?.addEventListener('click', () => receiveStockDialog(id, async () => { const r = await api(`/admin/products/${id}`); p = r.product; mount($('#stockNow'), html`<b>${p.stockCount}</b> pieces`); drawPreview(); }, true));
    $('#dupBtn')?.addEventListener('click', async () => { try { const r = await api(`/admin/products/${id}/duplicate`, { method: 'POST', body: {} }); S.dirty = false; toast('Copy created'); location.hash = `#/products/${r.product.id}`; } catch (x) { err(x); } });
    $('#delBtn')?.addEventListener('click', async () => {
      if (!await NPI.confirmBox({ title: 'Move this product to the bin?', text: 'Customers won\'t see it any more. You can restore it from the Bin.', ok: 'Move to bin', danger: true })) return;
      try { await api(`/admin/products/${id}`, { method: 'DELETE' }); S.dirty = false; toast('Moved to the bin'); location.hash = '#/products'; } catch (x) { err(x); }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = NPI.formData(form);
      const price = toMinor(d.price); const sale = d.sale_price.trim() ? toMinor(d.sale_price) : null;
      if (!d.name.trim()) { NPI.showFieldError(form, { message: 'Please give the product a name.', field: 'name' }); return; }
      if (!price || Number.isNaN(price)) { NPI.showFieldError(form, { message: 'Please type the price, e.g. 1250', field: 'price' }); return; }
      if (sale !== null && (Number.isNaN(sale) || sale >= price)) { NPI.showFieldError(form, { message: 'The sale price must be lower than the normal price.', field: 'sale_price' }); return; }
      const body = {
        name: d.name, sku: d.sku, category_id: d.category_id ? Number(d.category_id) : null, description: d.description,
        price, sale_price: sale, low_stock_threshold: Number(d.low_stock_threshold) || 0,
        bulk_min_qty: Number(d.bulk_min_qty) || 0, bulk_percent: Number(d.bulk_percent) || 0,
        active: d.active, featured: d.featured, sim: d.sim, motion: m.motion, icon: 'wrench',
        images: m.images, video: m.video, demo: m.demo, tags: m.tags,
        specs: m.specs.filter((s) => s.label.trim() || s.value.trim()), uses: m.uses.map((u) => u.trim()).filter(Boolean)
      };
      if (!id) body.stock = Number(d.stock) || 0;
      if (body.bulk_min_qty && !body.bulk_percent) { NPI.showFieldError(form, { message: 'Add the bulk discount % too (or clear the quantity).', field: 'bulk_percent' }); return; }
      const btn = $('#saveBtn'); NPI.busy(btn, true, 'Saving…');
      try {
        const r = await api(id ? `/admin/products/${id}` : '/admin/products', { method: id ? 'PUT' : 'POST', body });
        S.dirty = false;
        toast(id ? 'Saved ✓ The shop is updated.' : 'Product added ✓ It is now in the shop.', { action: 'View in shop', onAction: () => window.open(`/product/${r.product.slug}`, '_blank', 'noopener') });
        await loadProducts();
        if (!id) location.hash = `#/products/${r.product.id}`; else route();
      } catch (x) { NPI.showFieldError(form, x); NPI.busy(btn, false); }
    });
  };

  /* receive / remove stock dialog (used on overview, stock page and editor) */
  async function receiveStockDialog(id, after, remove = false) {
    const p = S.products.find((x) => x.id === id) || (await api(`/admin/products/${id}`)).product;
    const d = document.createElement('dialog'); d.className = 'modal';
    const reasons = remove ? ['Damaged', 'Lost / missing', 'Used in shop', 'Returned to supplier', 'Counting correction'] : ['New stock received', 'Customer return', 'Counting correction'];
    mount(d, html`<form method="dialog" id="sform">
      <div class="modal-head"><h3>${remove ? 'Remove stock' : 'Add stock'}</h3><button class="btn btn-ghost icon-only" value="cancel" type="submit" aria-label="Close">✕</button></div>
      <div class="modal-body"><div class="row">${thumb(p.images?.[0], true)}<div><b>${p.name}</b><div class="muted">Currently in stock: <b>${p.stockCount}</b></div></div></div>
        <div class="field"><label for="sQty">How many pieces?</label><input type="number" id="sQty" min="1" value="${remove ? 1 : 10}" required></div>
        <div class="quick">${(remove ? [1, 2, 5] : [5, 10, 25, 50, 100]).map((n) => html`<button type="button" data-q="${n}">${n}</button>`)}</div>
        <div class="field"><label for="sWhy">Reason</label><select id="sWhy">${reasons.map((r) => html`<option>${r}</option>`)}</select></div>
      </div>
      <div class="modal-foot"><button class="btn btn-ghost" value="cancel" type="submit">Cancel</button><button class="btn ${remove ? 'btn-danger' : 'btn-green'}" value="ok" type="submit" id="sOk">${remove ? '− Remove' : '＋ Add'} stock</button></div></form>`);
    document.body.append(d); d.showModal(); $('#sQty', d).select();
    d.addEventListener('click', (e) => { if (e.target.dataset.q) $('#sQty', d).value = e.target.dataset.q; });
    d.addEventListener('close', async () => {
      const ok = d.returnValue === 'ok'; const qty = Number($('#sQty', d).value); const why = $('#sWhy', d).value; d.remove();
      if (!ok || !qty) return;
      try {
        const r = await api(`/admin/products/${id}/stock`, { method: 'POST', body: { delta: remove ? -qty : qty, reason: why } });
        const i = S.products.findIndex((x) => x.id === id); if (i >= 0) S.products[i] = r.product;
        toast(`${remove ? 'Removed' : 'Added'} ${qty}. "${r.product.name}" now has ${r.product.stockCount}.`);
        after?.();
      } catch (x) { err(x); }
    });
  }

  /* ============================================================
     STOCK
     ============================================================ */
  PAGES.stock = async (view) => {
    const [, mv] = await Promise.all([loadProducts(), api('/admin/movements')]);
    const sorted = [...S.products].sort((a, b) => a.stockCount - b.stockCount);
    const out = sorted.filter((p) => p.stockCount === 0).length;
    const low = sorted.filter((p) => p.stockCount > 0 && p.stockCount <= p.low_stock_threshold).length;
    mount(view, html`
      <div class="grid-kpi">
        <div class="card kpi ${out ? 'bad' : ''}"><span class="k-icon">⛔</span><div class="k-label">Sold out</div><div class="k-value">${out}</div></div>
        <div class="card kpi ${low ? 'alert' : ''}"><span class="k-icon">⚠</span><div class="k-label">Running low</div><div class="k-value">${low}</div></div>
        <div class="card kpi"><span class="k-icon">📦</span><div class="k-label">Pieces in stock</div><div class="k-value">${sorted.reduce((a, p) => a + p.stockCount, 0).toLocaleString()}</div></div>
        <div class="card kpi"><span class="k-icon">💰</span><div class="k-label">Stock value (at shop price)</div><div class="k-value">${money(sorted.reduce((a, p) => a + p.stockCount * p.price, 0))}</div></div>
      </div>
      <div class="toolbar"><input class="search-in" id="sq" type="search" placeholder="🔍 Find a product…"></div>
      <div class="grid-2">
        <div class="card"><div class="card-head"><h3>All products (lowest stock first)</h3></div><div class="list" id="slist"></div></div>
        <div class="card"><div class="card-head"><h3>Recent stock changes</h3></div><div class="table-wrap"><table class="table"><tr><th>When</th><th>Product</th><th>Change</th><th>Why</th></tr>
          ${mv.movements.slice(0, 60).map((x) => html`<tr><td class="small">${NPI.ago(x.created_at)}</td><td>${x.product_name}</td><td class="${x.delta >= 0 ? 'delta-pos' : 'delta-neg'}">${x.delta > 0 ? '+' : ''}${x.delta}</td><td class="small">${x.reason}${x.ref ? html` <span class="mono">${x.ref}</span>` : ''}</td></tr>`)}</table></div></div>
      </div>`);
    const draw = (q = '') => mount($('#slist'), html`${sorted.filter((p) => p.name.toLowerCase().includes(q)).map((p) => html`<div class="list-row">${thumb(p.images[0])}
      <div class="spacer"><a class="p-name" href="#/products/${p.id}">${p.name}</a><div class="small">${p.stockCount === 0 ? html`<span class="tag tag-red">Sold out</span>` : p.stockCount <= p.low_stock_threshold ? html`<span class="tag tag-warn">Low: ${p.stockCount} left</span>` : html`<span class="muted">${p.stockCount} in stock</span>`}</div></div>
      <button class="btn btn-sm btn-green" type="button" data-in="${p.id}">＋ Add</button><button class="btn btn-sm btn-ghost" type="button" data-out="${p.id}">− Remove</button></div>`)}`);
    draw();
    $('#sq').addEventListener('input', (e) => draw(e.target.value.toLowerCase().trim()));
    view.addEventListener('click', (e) => {
      const b = e.target.closest('[data-in],[data-out]'); if (!b) return;
      receiveStockDialog(Number(b.dataset.in || b.dataset.out), route, !!b.dataset.out);
    });
  };

  /* ============================================================
     DEALS & SALES
     ============================================================ */
  const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function dealSummary(d) {
    const off = d.discount_type === 'percent' ? `${d.value || '?'}% off` : `${money(d.value || 0)} off`;
    const scope = d.scope === 'all' ? 'every product' : d.scope === 'category' ? `all ${catName(Number(d.category_id))}` : `${(d.productIds || []).length} selected product(s)`;
    const days = (d.days || []).length ? `every ${(d.days || []).map((x) => NPI.DAYS[x]).join(', ')}` : 'every day';
    const time = d.start_time || d.end_time ? `, ${d.start_time || '00:00'}–${d.end_time || '24:00'}` : ', all day';
    const range = d.starts_on || d.ends_on ? ` (from ${d.starts_on || 'now'} until ${d.ends_on || 'you switch it off'})` : '';
    return `${off} on ${scope}, ${days}${time}${range}.`;
  }
  PAGES.deals = async (view) => {
    const [r] = await Promise.all([api('/admin/promotions'), loadProducts(), loadCats()]);
    const TEMPLATES = [
      ['🌙 Jumma Deal', 'Every Friday, all day', { name: 'Jumma Deal', badge: 'Jumma Deal', theme: 'jumma', discount_type: 'percent', value: 15, scope: 'products', days: [5] }],
      ['🎉 Weekend Sale', 'Saturday & Sunday', { name: 'Weekend Sale', badge: 'Weekend', theme: 'sale', discount_type: 'percent', value: 10, scope: 'all', days: [6, 0] }],
      ['⚡ Flash Sale', 'Today only, a few hours', { name: 'Flash Sale', badge: 'Flash', theme: 'flash', discount_type: 'percent', value: 20, scope: 'products', starts_on: localDate(), ends_on: localDate(), start_time: '18:00', end_time: '22:00' }],
      ['🗂 Category Sale', 'All tools in one category', { name: 'Category Sale', badge: 'Sale', theme: 'sale', discount_type: 'percent', value: 10, scope: 'category', category_id: S.cats[0]?.id }],
      ['🏷 Clearance', 'Selected items until a date', { name: 'Clearance', badge: 'Clearance', theme: 'clearance', discount_type: 'percent', value: 30, scope: 'products' }],
      ['✏ Custom deal', 'Start from scratch', { name: '', badge: '', theme: 'sale', discount_type: 'percent', value: 10, scope: 'all' }]
    ];
    mount(view, html`
      <div class="callout green"><span class="c-icon">💡</span><div><b>How deals work</b><p>Deals switch on and off by themselves on the days and times you choose. Customers see a countdown timer and the discounted price; when the deal ends, prices go back to normal automatically.</p></div></div>
      <h3>Start a new deal</h3><br>
      <div class="templates">${TEMPLATES.map((t, i) => html`<button class="template" type="button" data-tpl="${i}"><b>${t[0]}</b><span>${t[1]}</span></button>`)}</div>
      <h3>Your deals</h3><br>
      <div class="deals-grid">${r.promotions.length ? r.promotions.map((d) => html`<div class="card deal">
        <div class="deal-top t-${d.theme}"><span class="deal-state ${d.status.live ? 'live' : ''}">${!d.active ? 'Switched off' : d.status.live ? '● LIVE NOW' : d.status.startsInSec !== null ? 'Scheduled' : 'Finished'}</span>
          <h3>${d.name}</h3><div class="big">${d.discount_type === 'percent' ? `${d.value}% OFF` : `${money(d.value)} OFF`}</div></div>
        <div class="deal-body"><span>${dealSummary(d)}</span>
          ${d.active && d.status.live ? html`<span class="small">Ends in <b data-countdown="${d.status.endsInSec}"></b></span>` : ''}
          ${d.active && !d.status.live && d.status.startsInSec !== null ? html`<span class="small">Starts in <b data-countdown="${d.status.startsInSec}"></b></span>` : ''}</div>
        <div class="deal-actions"><label class="switch"><input type="checkbox" data-toggle="${d.id}" ${d.active ? 'checked' : ''}> ${d.active ? 'On' : 'Off'}</label><span class="spacer"></span>
          <button class="btn btn-sm btn-dark" type="button" data-edit="${d.id}">✎ Edit</button><button class="btn btn-sm btn-danger-ghost icon-only" type="button" data-rm="${d.id}" aria-label="Delete">🗑</button></div></div>`)
        : html`<div class="card empty"><b>🏷</b>No deals yet. Pick a template above to start.</div>`}</div>`);
    NPI.startCountdowns(view);
    view.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.tpl) dealEditor(null, { ...TEMPLATES[Number(b.dataset.tpl)][2] });
      if (b.dataset.edit) dealEditor(r.promotions.find((d) => d.id === Number(b.dataset.edit)));
      if (b.dataset.rm) {
        if (!await NPI.confirmBox({ title: 'Delete this deal?', text: 'Prices go back to normal straight away.', ok: 'Delete', danger: true })) return;
        try { await api(`/admin/promotions/${b.dataset.rm}`, { method: 'DELETE' }); toast('Deal deleted'); route(); } catch (x) { err(x); }
      }
    });
    view.addEventListener('change', async (e) => {
      if (!e.target.dataset.toggle) return;
      try { await api(`/admin/promotions/${e.target.dataset.toggle}`, { method: 'PATCH', body: { active: e.target.checked } }); toast(e.target.checked ? 'Deal switched on' : 'Deal switched off'); route(); } catch (x) { err(x); }
    });
  };

  function dealEditor(existing, preset = {}) {
    const d0 = existing ? { ...existing } : { days: [], productIds: [], active: true, ...preset };
    const sel = new Set(d0.productIds || []);
    const dlg = document.createElement('dialog'); dlg.className = 'modal';
    mount(dlg, html`<form id="dform" novalidate>
      <div class="modal-head"><h3>${existing ? 'Edit deal' : 'New deal'}</h3><button class="btn btn-ghost icon-only" type="button" data-close aria-label="Close">✕</button></div>
      <div class="modal-body">
        <div class="cols-2"><div class="field"><label for="dName">Deal name</label><input type="text" id="dName" name="name" maxlength="60" value="${d0.name || ''}" placeholder="e.g. Jumma Deal"></div>
          <div class="field"><label for="dBadge">Badge text on products</label><input type="text" id="dBadge" name="badge" maxlength="30" value="${d0.badge || ''}" placeholder="e.g. Jumma Deal"></div></div>
        <div class="field"><span class="lbl">Colour style</span><div class="themes">${[['jumma', 'Jumma (green & gold)'], ['flash', 'Flash (red)'], ['sale', 'Sale (dark)'], ['clearance', 'Clearance (grey)']].map(([k, l]) => html`<label><input type="radio" name="theme" value="${k}" ${d0.theme === k ? 'checked' : ''}><span class="th-${k}">${l}</span></label>`)}</div></div>
        <div class="cols-2"><div class="field"><label for="dType">Discount type</label><select id="dType" name="discount_type"><option value="percent" ${d0.discount_type !== 'amount' ? 'selected' : ''}>Percentage (% off)</option><option value="amount" ${d0.discount_type === 'amount' ? 'selected' : ''}>Fixed amount (Rs off)</option></select></div>
          <div class="field"><label for="dVal">Discount</label><input type="number" id="dVal" name="value" min="1" value="${d0.discount_type === 'amount' ? rs(d0.value) : (d0.value || '')}"></div></div>
        <div class="field"><label for="dScope">Applies to</label><select id="dScope" name="scope"><option value="all" ${d0.scope === 'all' ? 'selected' : ''}>Every product in the shop</option><option value="category" ${d0.scope === 'category' ? 'selected' : ''}>One category</option><option value="products" ${d0.scope === 'products' ? 'selected' : ''}>Products I choose</option></select></div>
        <div class="field" id="dCatWrap"><label for="dCat">Category</label><select id="dCat" name="category_id">${S.cats.map((c) => html`<option value="${c.id}" ${c.id === d0.category_id ? 'selected' : ''}>${c.name}</option>`)}</select></div>
        <div class="field" id="dProdWrap"><span class="lbl">Choose products <span class="muted" id="dCount"></span></span><input class="inp" type="search" id="dSearch" placeholder="🔍 Search…">
          <div class="pick-list" id="dPick">${S.products.map((p) => html`<label data-name="${p.name.toLowerCase()}"><input type="checkbox" value="${p.id}" ${sel.has(p.id) ? 'checked' : ''}>${thumb(p.images[0])}<span class="spacer">${p.name}</span><span class="mono small">${money(p.price)}</span></label>`)}</div></div>
        <div class="field"><span class="lbl">Which days? (none = every day)</span><div class="days">${DAYS_SHORT.map((n, i) => html`<label><input type="checkbox" name="day" value="${i}" ${(d0.days || []).includes(i) ? 'checked' : ''}><span>${n}</span></label>`)}</div></div>
        <div class="cols-2"><div class="field"><label for="dSt">From time (optional)</label><input type="time" id="dSt" name="start_time" value="${d0.start_time || ''}"></div><div class="field"><label for="dEt">Until time (optional)</label><input type="time" id="dEt" name="end_time" value="${d0.end_time || ''}"></div></div>
        <div class="cols-2"><div class="field"><label for="dSo">Start date (optional)</label><input type="date" id="dSo" name="starts_on" value="${d0.starts_on || ''}"></div><div class="field"><label for="dEo">End date (optional)</label><input type="date" id="dEo" name="ends_on" value="${d0.ends_on || ''}"></div></div>
        <label class="switch"><input type="checkbox" name="active" ${d0.active !== false && d0.active !== 0 ? 'checked' : ''}> Deal is switched on</label>
        <div class="summary-line" id="dSum"></div>
      </div>
      <div class="modal-foot"><button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit" id="dSave">${existing ? 'Save deal' : 'Create deal'}</button></div></form>`);
    document.body.append(dlg); dlg.showModal();
    const f = $('#dform', dlg);
    const read = () => {
      const d = NPI.formData(f);
      return {
        ...d, days: $$('input[name=day]:checked', f).map((x) => Number(x.value)), productIds: [...sel],
        value: d.discount_type === 'amount' ? toMinor(d.value) : Number(d.value), category_id: Number(d.category_id)
      };
    };
    const sync = () => {
      const d = read();
      $('#dCatWrap', dlg).hidden = d.scope !== 'category'; $('#dProdWrap', dlg).hidden = d.scope !== 'products';
      $('#dCount', dlg).textContent = `(${sel.size} chosen)`; $('#dSum', dlg).textContent = `👉 ${dealSummary(d)}`;
    };
    sync();
    f.addEventListener('input', sync); f.addEventListener('change', (e) => { if (e.target.closest('#dPick')) { const v = Number(e.target.value); if (e.target.checked) sel.add(v); else sel.delete(v); } sync(); });
    $('#dSearch', dlg).addEventListener('input', (e) => { const q = e.target.value.toLowerCase(); $$('#dPick label', dlg).forEach((l) => { l.hidden = !l.dataset.name.includes(q); }); });
    dlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) dlg.close(); });
    dlg.addEventListener('close', () => dlg.remove());
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = read(); const btn = $('#dSave', dlg); NPI.busy(btn, true);
      try {
        await api(existing ? `/admin/promotions/${existing.id}` : '/admin/promotions', { method: existing ? 'PUT' : 'POST', body: d });
        dlg.close(); toast(existing ? 'Deal saved ✓' : 'Deal created ✓ It will switch on automatically.'); route();
      } catch (x) { NPI.showFieldError(f, x); NPI.busy(btn, false); }
    });
  }

  /* ============================================================
     ORDERS
     ============================================================ */
  PAGES.orders = async (view) => {
    const [r] = await Promise.all([api('/admin/orders'), S.products.length ? null : loadProducts()]);
    const st = { status: r.orders.some((o) => o.status === 'pending') ? 'pending' : 'all', q: '' };
    const counts = (s) => (s === 'all' ? r.orders.length : r.orders.filter((o) => o.status === s).length);
    mount(view, html`<div class="toolbar"><input class="search-in" id="oq" type="search" placeholder="🔍 Search order number, name or phone…"></div>
      <div class="chips" id="ochips"></div><div id="olist"></div>`);
    const card = (o) => {
      const wa = waLink(o.customer.phone);
      return html`<div class="card order" data-code="${o.code}">
        <div class="order-head"><span class="order-code">${o.code}</span><span class="status status-${o.status}">${STATUS_TEXT[o.status]}</span><span class="muted small">${NPI.dateTime(o.createdAt)} · ${NPI.ago(o.createdAt)}</span><span class="spacer"></span>
          <span class="tag ${o.payment === 'cod' ? 'tag-grey' : 'tag-green'}">${o.payment === 'cod' ? '💵 Cash on delivery' : '🏦 Bank transfer'}</span><b class="mono">${money(o.total)}</b></div>
        <div class="order-body">
          <div class="order-items">${o.items.map((it) => html`<div class="oi">${thumb(it.image || productImage(it.productId))}<span class="spacer">${it.name}${it.label ? html` <span class="tag tag-green">${it.label}</span>` : ''}</span><span class="mono small">${it.qty} × ${money(it.unit)}</span><b class="mono">${money(it.lineTotal)}</b></div>`)}
            <div class="small muted right">Subtotal ${money(o.subtotal)} · Delivery ${o.delivery ? money(o.delivery) : 'free'}${o.savings ? ` · Customer saved ${money(o.savings)}` : ''}</div></div>
          <div><div class="lbl">Deliver to</div><div><b>${o.customer.name}</b></div><div>${o.customer.address}</div><div>${o.customer.city}</div>
            <div class="mono">${o.customer.phone}</div>${o.customer.notes ? html`<div class="small">📝 ${o.customer.notes}</div>` : ''}
            <div class="contact-links"><a class="btn btn-sm btn-ghost" href="tel:${o.customer.phone.replace(/[^0-9+]/g, '')}">📞 Call</a>${wa ? html`<a class="btn btn-sm btn-ghost" href="${wa}" target="_blank" rel="noopener noreferrer">💬 WhatsApp</a>` : ''}</div></div>
        </div>
        <div class="order-actions">${(r.next[o.status] || []).map((s) => html`<button class="btn btn-sm ${s === 'cancelled' ? 'btn-danger-ghost' : 'btn-primary'}" type="button" data-to="${s}" data-code="${o.code}">${NEXT_LABEL[s]}</button>`)}
          <span class="spacer"></span><button class="btn btn-sm btn-ghost" type="button" data-print="${o.code}">🖨 Print invoice</button></div></div>`;
    };
    const draw = () => {
      mount($('#ochips'), html`${['all', 'pending', 'confirmed', 'shipped', 'delivered', 'cancelled'].map((s) => html`<button class="chip ${st.status === s ? 'on' : ''}" type="button" data-s="${s}">${s === 'all' ? 'All' : STATUS_TEXT[s]} <span class="n">${counts(s)}</span></button>`)}`);
      let L = st.status === 'all' ? r.orders : r.orders.filter((o) => o.status === st.status);
      if (st.q) { const q = st.q.toLowerCase(); L = L.filter((o) => `${o.code} ${o.customer.name} ${o.customer.phone}`.toLowerCase().includes(q)); }
      mount($('#olist'), L.length ? html`${L.map(card)}` : html`<div class="card empty"><b>🧾</b>${st.status === 'pending' ? 'No new orders right now.' : 'No orders here.'}</div>`);
    };
    draw();
    $('#oq').addEventListener('input', (e) => { st.q = e.target.value.trim(); draw(); });
    view.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.s) { st.status = b.dataset.s; draw(); return; }
      if (b.dataset.print) {
        const c = b.closest('.order'); c.classList.add('printing'); document.body.classList.add('print-one');
        window.print(); c.classList.remove('printing'); document.body.classList.remove('print-one'); return;
      }
      if (b.dataset.to) {
        const to = b.dataset.to;
        if (to === 'cancelled' && !await NPI.confirmBox({ title: `Cancel order ${b.dataset.code}?`, text: 'The items go back into stock automatically.', ok: 'Cancel order', cancel: 'Keep order', danger: true })) return;
        NPI.busy(b, true);
        try {
          await api(`/admin/orders/${encodeURIComponent(b.dataset.code)}`, { method: 'PATCH', body: { status: to } });
          const o = r.orders.find((x) => x.code === b.dataset.code); o.status = to;
          toast(`Order ${o.code}: ${STATUS_TEXT[to]}`); draw(); refreshBadges();
        } catch (x) { err(x); NPI.busy(b, false); }
      }
    });
  };

  /* ============================================================
     CATEGORIES
     ============================================================ */
  PAGES.categories = async (view) => {
    await Promise.all([loadCats(), loadProducts()]);
    const motions = S.motions.filter((k) => k !== 'auto');
    mount(view, html`
      <div class="card card-pad"><form class="row" id="newCat"><input class="search-in" name="name" maxlength="60" placeholder="New category name, e.g. Safety Gear" aria-label="New category name"><button class="btn btn-primary" type="submit">＋ Add category</button></form></div><br>
      <div class="card"><div class="list">${S.cats.map((c, i) => html`<div class="list-row" data-cat="${c.id}">
        <button class="thumb lg" type="button" data-cover="${c.id}" title="Change cover photo">${c.image ? html`<img src="${c.image}" alt="">` : html`<span>📷</span>`}</button>
        <div class="spacer stack"><input class="inp" data-name="${c.id}" value="${c.name}" maxlength="60" aria-label="Category name">
          <div class="row small"><span class="muted">${c.count} product${c.count === 1 ? '' : 's'} ·</span><a href="#/products/new?cat=${c.id}">＋ Add product here</a><span class="muted">· Hover clip:</span>
            <select class="sel" data-motion="${c.id}" aria-label="Default hover clip">${motions.map((k) => html`<option value="${k}" ${c.motion === k ? 'selected' : ''}>${MOTION_INFO[k][0]}</option>`)}</select></div></div>
        <div class="row"><button class="btn btn-sm btn-ghost icon-only" type="button" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">▲</button><button class="btn btn-sm btn-ghost icon-only" type="button" data-down="${i}" ${i === S.cats.length - 1 ? 'disabled' : ''} aria-label="Move down">▼</button>
          <button class="btn btn-sm btn-danger-ghost icon-only" type="button" data-del="${c.id}" aria-label="Delete">🗑</button></div></div>`)}</div></div>`);
    const save = async (c, patchData) => {
      try { await api(`/admin/categories/${c.id}`, { method: 'PUT', body: { name: c.name, icon: c.icon, image: c.image, motion: c.motion, ...patchData } }); toast('Category saved ✓'); await loadCats(); }
      catch (x) { err(x); }
    };
    $('#newCat').addEventListener('submit', async (e) => {
      e.preventDefault(); const name = e.currentTarget.name.value.trim(); if (!name) return;
      try { await api('/admin/categories', { method: 'POST', body: { name } }); toast('Category added ✓'); route(); } catch (x) { err(x); }
    });
    view.addEventListener('change', (e) => {
      const t = e.target; const c = S.cats.find((x) => x.id === Number(t.dataset.name || t.dataset.motion)); if (!c) return;
      if (t.dataset.name) save(c, { name: t.value });
      if (t.dataset.motion) save(c, { motion: t.value });
    });
    view.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.up || b.dataset.down) {
        const i = Number(b.dataset.up ?? b.dataset.down); const j = b.dataset.up ? i - 1 : i + 1;
        const ids = S.cats.map((c) => c.id); [ids[i], ids[j]] = [ids[j], ids[i]];
        try { await api('/admin/categories/reorder', { method: 'POST', body: { ids } }); route(); } catch (x) { err(x); }
      }
      if (b.dataset.del) {
        if (!await NPI.confirmBox({ title: 'Delete this category?', ok: 'Delete', danger: true })) return;
        try { await api(`/admin/categories/${b.dataset.del}`, { method: 'DELETE' }); toast('Deleted'); route(); } catch (x) { err(x); }
      }
      if (b.dataset.cover) coverPicker(S.cats.find((c) => c.id === Number(b.dataset.cover)), save);
    });
  };
  function coverPicker(cat, save) {
    const photos = S.products.filter((p) => p.category_id === cat.id).flatMap((p) => p.images.slice(0, 2));
    const d = document.createElement('dialog'); d.className = 'modal';
    mount(d, html`<div class="modal-head"><h3>Cover photo for “${cat.name}”</h3><button class="btn btn-ghost icon-only" type="button" data-close aria-label="Close">✕</button></div>
      <div class="modal-body"><p class="muted">Pick one of your product photos, or upload a new one.</p>
        <div class="photos">${photos.map((u) => html`<button type="button" class="photo ${u === cat.image ? 'main' : ''}" data-pick="${u}"><img src="${u}" alt=""></button>`)}</div>
        <label class="btn btn-ghost">⬆ Upload a photo<input type="file" accept="image/*" hidden id="coverFile"></label></div>`);
    document.body.append(d); d.showModal();
    d.addEventListener('close', () => d.remove());
    d.addEventListener('click', async (e) => {
      if (e.target.closest('[data-close]')) d.close();
      const b = e.target.closest('[data-pick]'); if (b) { d.close(); await save(cat, { image: b.dataset.pick }); route(); }
    });
    $('#coverFile', d).addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const r = await uploadFile(f, { removeBg: true }); d.close(); await save(cat, { image: r.url }); route(); } catch (x) { err(x); }
    });
  }

  /* ============================================================
     CUSTOMERS, REVIEWS, MESSAGES
     ============================================================ */
  PAGES.customers = async (view) => {
    const { customers } = await api('/admin/customers');
    mount(view, html`<div class="toolbar"><input class="search-in" id="cq" type="search" placeholder="🔍 Search customers…"></div>
      <div class="card table-wrap"><table class="table"><tr><th>Customer</th><th>Contact</th><th>Orders</th><th>Spent</th><th>Joined</th><th>Account</th></tr><tbody id="ctb"></tbody></table></div>`);
    const draw = (q = '') => mount($('#ctb'), customers.length ? html`${customers.filter((c) => `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(q)).map((c) => html`<tr>
      <td><b>${c.name}</b><div class="small muted">${c.last_login_at ? `last seen ${NPI.ago(c.last_login_at)}` : ''}</div></td>
      <td><a href="mailto:${c.email}">${c.email}</a>${c.phone ? html`<div class="mono small">${c.phone}${waLink(c.phone) ? html` · <a href="${waLink(c.phone)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ''}</div>` : ''}</td>
      <td class="mono">${c.orders}</td><td class="mono">${money(c.spent)}</td><td class="small">${NPI.date(c.created_at)}</td>
      <td><label class="switch"><input type="checkbox" data-cust="${c.id}" ${c.disabled ? '' : 'checked'}> ${c.disabled ? 'Blocked' : 'Active'}</label></td></tr>`)}`
      : html`<tr><td colspan="6"><div class="empty"><b>👥</b>No customer accounts yet.</div></td></tr>`);
    draw();
    $('#cq').addEventListener('input', (e) => draw(e.target.value.toLowerCase()));
    view.addEventListener('change', async (e) => {
      const t = e.target; if (!t.dataset.cust) return;
      if (!t.checked && !await NPI.confirmBox({ title: 'Block this customer?', text: 'They will be logged out and cannot log in or order.', ok: 'Block', danger: true })) { t.checked = true; return; }
      try { await api(`/admin/customers/${t.dataset.cust}`, { method: 'PATCH', body: { disabled: !t.checked } }); toast(t.checked ? 'Customer unblocked' : 'Customer blocked'); route(); } catch (x) { err(x); }
    });
  };

  PAGES.reviews = async (view) => {
    const { reviews } = await api('/admin/reviews');
    mount(view, html`<div class="card"><div class="list">${reviews.length ? reviews.map((r) => html`<div class="list-row">
      <div class="spacer"><b>${r.product_name}</b> <span class="muted">· ${r.user_name} · ${NPI.ago(r.created_at)}</span><div>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</div>${r.body ? html`<div>${r.body}</div>` : ''}</div>
      <label class="switch"><input type="checkbox" data-rv="${r.id}" ${r.hidden ? '' : 'checked'}> ${r.hidden ? 'Hidden' : 'Shown'}</label>
      <button class="btn btn-sm btn-danger-ghost icon-only" type="button" data-rvdel="${r.id}" aria-label="Delete">🗑</button></div>`)
      : html`<div class="empty"><b>⭐</b>No reviews yet. Customers can review products after delivery.</div>`}</div></div>`);
    view.addEventListener('change', async (e) => { if (e.target.dataset.rv) { try { await api(`/admin/reviews/${e.target.dataset.rv}`, { method: 'PATCH', body: { hidden: !e.target.checked } }); toast('Saved'); route(); } catch (x) { err(x); } } });
    view.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-rvdel]'); if (!b) return;
      if (!await NPI.confirmBox({ title: 'Delete this review?', ok: 'Delete', danger: true })) return;
      try { await api(`/admin/reviews/${b.dataset.rvdel}`, { method: 'DELETE' }); route(); } catch (x) { err(x); }
    });
  };

  PAGES.messages = async (view) => {
    const { messages } = await api('/admin/messages');
    mount(view, html`<div class="stack">${messages.length ? messages.map((m) => html`<div class="card card-pad ${m.is_read ? '' : 'kpi alert'}">
      <div class="row"><b>${m.is_read ? '' : '● '}${m.name}</b>${m.company ? html`<span class="tag tag-grey">${m.company}</span>` : ''}<span class="spacer"></span><span class="small muted">${NPI.dateTime(m.created_at)}</span></div>
      <p>${m.body}</p>
      <div class="row"><a class="btn btn-sm btn-ghost" href="mailto:${m.email}?subject=${encodeURIComponent('Re: your enquiry to NPI Global Trading')}">✉ Reply by email</a>
        ${m.phone ? html`<a class="btn btn-sm btn-ghost" href="tel:${m.phone.replace(/[^0-9+]/g, '')}">📞 Call</a>` : ''}${waLink(m.phone) ? html`<a class="btn btn-sm btn-ghost" href="${waLink(m.phone)}" target="_blank" rel="noopener noreferrer">💬 WhatsApp</a>` : ''}
        <span class="spacer"></span>${m.is_read ? '' : html`<button class="btn btn-sm btn-green" type="button" data-read="${m.id}">✓ Mark as done</button>`}<button class="btn btn-sm btn-danger-ghost icon-only" type="button" data-mdel="${m.id}" aria-label="Delete">🗑</button></div></div>`)
      : html`<div class="card empty"><b>✉</b>No messages yet. Enquiries from the Contact page arrive here.</div>`}</div>`);
    view.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      try {
        if (b.dataset.read) { await api(`/admin/messages/${b.dataset.read}`, { method: 'PATCH', body: { is_read: true } }); route(); }
        if (b.dataset.mdel && await NPI.confirmBox({ title: 'Delete this message?', ok: 'Delete', danger: true })) { await api(`/admin/messages/${b.dataset.mdel}`, { method: 'DELETE' }); route(); }
      } catch (x) { err(x); }
    });
  };

  /* ============================================================
     SETTINGS
     ============================================================ */
  PAGES.settings = async (view) => {
    const { settings: s } = await api('/admin/settings');
    const f = (name, label, help = '', type = 'text') => html`<div class="field"><label for="s_${name}">${label}</label><input type="${type}" id="s_${name}" name="${name}" value="${s[name] || ''}">${help ? html`<span class="help">${help}</span>` : ''}</div>`;
    const ta = (name, label, help = '') => html`<div class="field"><label for="s_${name}">${label}</label><textarea id="s_${name}" name="${name}">${s[name] || ''}</textarea>${help ? html`<span class="help">${help}</span>` : ''}</div>`;
    mount(view, html`<form id="sform" novalidate><div class="grid-2e">
      <div>
        <div class="card section-card"><h3>🏪 Store</h3><div class="section-body">${f('store_name', 'Store name')}${f('tagline', 'Tagline (under the logo)')}${f('announcement', 'Announcement bar', 'The green strip at the very top of every page.')}${f('hero_title', 'Homepage headline', 'The last word is highlighted in green.')}${ta('hero_text', 'Homepage intro text')}${ta('about_text', 'About us text')}</div></div>
      </div>
      <div>
        <div class="card section-card"><h3>💵 Money &amp; delivery</h3><div class="section-body">
          <div class="cols-2">${f('currency', 'Currency symbol', 'Pakistan: Rs')}<div class="field"><label for="s_timezone">Time zone</label><select id="s_timezone" name="timezone">${['Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Kolkata', 'Europe/London', 'UTC'].map((t) => html`<option ${s.timezone === t ? 'selected' : ''}>${t}</option>`)}</select><span class="help">Deals like Jumma Deal start and end by this clock.</span></div></div>
          <div class="cols-2"><div class="field"><label for="s_df">Delivery charge (Rs)</label><div class="money-field"><span>Rs</span><input id="s_df" name="delivery_fee" inputmode="decimal" value="${rs(Number(s.delivery_fee))}"></div></div>
            <div class="field"><label for="s_fd">Free delivery above (Rs)</label><div class="money-field"><span>Rs</span><input id="s_fd" name="free_delivery_over" inputmode="decimal" value="${rs(Number(s.free_delivery_over))}"></div><span class="help">0 = never free</span></div></div>
          ${ta('bank_details', 'Bank details for bank transfer', 'Shown to customers who choose bank transfer.')}
          <label class="switch"><input type="checkbox" name="allow_orders" ${s.allow_orders === '1' ? 'checked' : ''}> Accept online orders</label><span class="help">Switch off during holidays: customers can still browse.</span>
        </div></div>
        <div class="card section-card"><h3>📞 Contact</h3><div class="section-body">${f('contact_phone', 'Phone')}${f('contact_whatsapp', 'WhatsApp number', 'Adds a WhatsApp chat button to the shop, e.g. 03001234567')}${f('contact_email', 'Email')}${ta('address', 'Address')}</div></div>
      </div></div>
      <div class="sticky-save"><button class="btn btn-primary btn-lg" type="submit" id="setSave">💾 Save settings</button><span class="dirty" id="setDirty" hidden>● Unsaved changes</span></div></form><br>
      <form class="card section-card" id="pwForm" novalidate><h3>🔐 Change my password</h3><div class="section-body"><div class="cols-2">
        <div class="field"><label for="pw1">Current password</label><input type="password" id="pw1" name="current" autocomplete="current-password"></div>
        <div class="field"><label for="pw2">New password</label><input type="password" id="pw2" name="next" autocomplete="new-password"><span class="help">At least 8 characters, with letters and numbers. Other devices will be logged out.</span></div></div>
        <div><button class="btn btn-dark" type="submit">Change password</button></div></div></form>`);
    const form = $('#sform');
    form.addEventListener('input', () => { S.dirty = true; $('#setDirty').hidden = false; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); const d = NPI.formData(form);
      d.delivery_fee = toMinor(d.delivery_fee) || 0; d.free_delivery_over = toMinor(d.free_delivery_over) || 0;
      const btn = $('#setSave'); NPI.busy(btn, true);
      try { await api('/admin/settings', { method: 'PUT', body: d }); S.dirty = false; $('#setDirty').hidden = true; toast('Settings saved ✓ The shop is updated.'); NPI.setCurrency(d.currency); }
      catch (x) { NPI.showFieldError(form, x); } finally { NPI.busy(btn, false); }
    });
    $('#pwForm').addEventListener('submit', async (e) => {
      e.preventDefault(); const f2 = e.currentTarget;
      try { await api('/auth/change-password', { method: 'POST', body: NPI.formData(f2) }); f2.reset(); toast('Password changed ✓'); } catch (x) { NPI.showFieldError(f2, x); }
    });
  };

  /* ============================================================
     ACTIVITY LOG
     ============================================================ */
  PAGES.activity = async (view) => {
    const { entries } = await api('/admin/audit');
    mount(view, html`<div class="callout blue"><span class="c-icon">🕘</span><div><b>Everything that changed, and who changed it</b><p>Useful if something looks different and you want to know why. Failed login attempts are shown too.</p></div></div>
      <div class="card table-wrap"><table class="table"><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr>
      ${entries.map((a) => html`<tr><td class="small">${NPI.dateTime(a.created_at)}</td><td>${a.user_name || html`<span class="muted">Visitor</span>`}</td><td>${a.action === 'login_failed' ? html`<span class="tag tag-red">${ACTIONS[a.action]}</span>` : ACTIONS[a.action] || a.action}</td><td class="small muted">${a.entity ? `${a.entity} #${a.entity_id}` : ''} ${a.details}</td></tr>`)}</table></div>`);
  };

  /* ============================================================
     BACKUP & IMPORT
     ============================================================ */
  PAGES.backup = async (view) => {
    mount(view, html`<div class="grid-2e">
      <div class="card section-card"><h3>💾 Download a backup</h3><div class="section-body"><p>Saves all your products (names, prices, stock, descriptions, photo links) into one file. Keep it somewhere safe, for example on Google Drive or a USB stick.</p>
        <a class="btn btn-primary btn-lg" href="/api/admin/export" download>⬇ Download backup file</a></div></div>
      <div class="card section-card"><h3>⬆ Import products from a file</h3><div class="section-body"><p>Load a backup file, or a product list prepared in the same format. Products with the same SKU (or name) are <b>updated</b>; new ones are <b>added</b>. Nothing is deleted.</p>
        <label class="btn btn-dark btn-lg">Choose file…<input type="file" id="impFile" accept="application/json,.json" hidden></label><div id="impInfo"></div></div></div>
    </div>`);
    $('#impFile').addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      let data;
      try { data = JSON.parse(await file.text()); } catch { toast('That file is not a valid backup file.', { type: 'error' }); return; }
      const products = Array.isArray(data) ? data : data.products;
      if (!Array.isArray(products) || !products.length) { toast('No products found in that file.', { type: 'error' }); return; }
      if (!await NPI.confirmBox({ title: `Import ${products.length} products?`, text: 'Existing products with the same SKU or name will be updated with the values from the file.', ok: 'Import' })) return;
      try { const r = await api('/admin/import', { method: 'POST', body: { products } }); mount($('#impInfo'), html`<div class="summary-line">✓ ${r.created} added, ${r.updated} updated.</div>`); toast('Import finished ✓'); }
      catch (x) { mount($('#impInfo'), html`<div class="field-error">${x.message}</div>`); }
      e.target.value = '';
    });
  };

  /* ============================================================
     boot
     ============================================================ */
  $('#menuBtn').addEventListener('click', () => { $('#side').classList.add('open'); $('#sideBackdrop').classList.add('open'); });
  $('#sideBackdrop').addEventListener('click', () => { $('#side').classList.remove('open'); $('#sideBackdrop').classList.remove('open'); });
  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/auth/logout', { method: 'POST', body: {} }); } catch { /* ignore */ }
    location.href = '/';
  });
  (async () => {
    try {
      const me = await api('/auth/me');
      if (!me.user || me.user.role !== 'owner') { location.href = '/login?next=/admin'; return; }
      S.me = me.user; NPI.setCsrf(me.csrf);
      $('#who').textContent = `Logged in as ${me.user.name}`;
      const st = await api('/store'); NPI.setCurrency(st.settings.currency);
      route();
    } catch { location.href = '/login?next=/admin'; }
  })();
})();
