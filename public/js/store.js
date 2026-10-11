/* ============================================================
   NPI Global Trading — storefront single-page app
   ============================================================ */
'use strict';

(() => {
  const { html, mount, $, $$, api, money, toast } = NPI;
  const ICON = NPI_ICONS.svg;

  const state = {
    user: null,
    store: null,
    cart: NPI.store.get('npi_cart', []),
    wish: NPI.store.get('npi_wish', []),
    recent: NPI.store.get('npi_recent', []),
    cleanup: [],
    lastQuote: null
  };
  const saveCart = () => { NPI.store.set('npi_cart', state.cart); updateCartCount(); };
  const saveWish = () => NPI.store.set('npi_wish', state.wish);

  /* ============================================================
     small building blocks
     ============================================================ */
  const stars = (avg) => {
    if (!avg) return '';
    const full = Math.round(avg);
    return html`<span class="stars" aria-label="${avg} out of 5">${'★'.repeat(full)}${'☆'.repeat(5 - full)}</span>`;
  };
  const visual = (p, cls = '', eager = false) => (p.images?.[0]
    ? html`<img src="${p.images[0]}" alt="${p.name}" class="${cls}" ${eager ? '' : html`loading="lazy"`} decoding="async" draggable="false">`
    : html`<span class="no-photo" aria-hidden="true">📷</span>`);
  const photo = (src, alt = '') => (src ? html`<img src="${src}" alt="${alt}" loading="lazy" decoding="async" draggable="false">` : html`<span class="no-photo">📷</span>`);

  /** A product "reel": real photo that plays a short motion clip on hover / when centred on phones. */
  function reel(p, { eager = false, tag = '▶ In action' } = {}) {
    const imgs = (p.images || []).slice(0, 4);
    if (!imgs.length) return html`<div class="reel"><span class="no-photo">📷</span></div>`;
    return html`<div class="reel" data-motion="${p.motion || 'zoom'}" data-imgs="${JSON.stringify(imgs)}" ${p.video ? html`data-video="${p.video}"` : ''}>
      <img class="reel-img is-on" src="${imgs[0]}" alt="${p.name}" ${eager ? '' : html`loading="lazy"`} decoding="async" draggable="false">
      <div class="reel-bar"><span></span></div><span class="reel-tag">${tag}</span>
    </div>`;
  }

  const FRAME_MS = 1600;
  function playReel(el) {
    if (!el || el._playing || NPI.prefersReducedMotion()) return;
    let imgs; try { imgs = JSON.parse(el.dataset.imgs || '[]'); } catch { imgs = []; }
    if (!imgs.length) return;
    el._playing = true;
    el.classList.add('playing');
    el.style.setProperty('--frame', `${FRAME_MS}ms`);
    if (el.dataset.video) {
      let v = el.querySelector('video');
      if (!v) {
        v = document.createElement('video');
        v.className = 'reel-video'; v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'none';
        v.src = el.dataset.video; el.prepend(v);
      }
      el.classList.add('playing-video');
      v.play().catch(() => {});
      return;
    }
    const motion = el.dataset.motion || 'zoom';
    const frames = [];
    imgs.forEach((src, i) => { frames.push({ src, cls: `m-${motion}` }); frames.push({ src, cls: 'm-closeup' }); if (i >= 2) return; });
    let a = el.querySelector('.reel-img');
    let b = el.querySelectorAll('.reel-img')[1];
    if (!b) { b = a.cloneNode(); b.classList.remove('is-on'); b.removeAttribute('loading'); a.after(b); }
    let i = 0;
    const bar = el.querySelector('.reel-bar span');
    const step = () => {
      const f = frames[i % frames.length];
      const cur = el.querySelector('.reel-img.is-on');
      let target = cur;
      if (cur.getAttribute('src') !== f.src) {
        target = cur === a ? b : a;
        target.src = f.src;
        cur.classList.remove('is-on');
        target.classList.add('is-on');
      }
      target.className = target.className.replace(/\bm-\w+/g, '').trim();
      void target.offsetWidth;
      target.classList.add(f.cls);
      if (bar) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = ''; }
      i++;
    };
    step();
    el._timer = setInterval(step, FRAME_MS);
  }
  function stopReel(el) {
    if (!el || !el._playing) return;
    el._playing = false;
    clearInterval(el._timer);
    el.classList.remove('playing', 'playing-video');
    el.querySelector('video')?.pause();
    const imgs = el.querySelectorAll('.reel-img');
    imgs.forEach((im, k) => { im.className = `reel-img${k === 0 ? ' is-on' : ''}`; });
    try { const first = JSON.parse(el.dataset.imgs)[0]; if (imgs[0]) imgs[0].src = first; } catch { /* ignore */ }
  }
  // hover (desktop) and focus (keyboard)
  document.addEventListener('mouseover', (e) => {
    const host = e.target.closest('[data-reel-host]'); if (!host) return;
    const r = host.querySelector('.reel'); if (r && !r._playing) playReel(r);
  });
  document.addEventListener('mouseout', (e) => {
    const host = e.target.closest('[data-reel-host]'); if (!host || host.contains(e.relatedTarget)) return;
    stopReel(host.querySelector('.reel'));
  });
  document.addEventListener('focusin', (e) => { const h = e.target.closest('[data-reel-host]'); if (h) playReel(h.querySelector('.reel')); });
  document.addEventListener('focusout', (e) => { const h = e.target.closest('[data-reel-host]'); if (h && !h.contains(e.relatedTarget)) stopReel(h.querySelector('.reel')); });
  // touch screens: the card closest to the middle of the screen plays by itself
  const touchMode = window.matchMedia('(hover: none)').matches;
  const centreObs = touchMode && 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    entries.forEach((en) => { const r = en.target.querySelector('.reel'); if (en.isIntersecting) playReel(r); else stopReel(r); });
  }, { rootMargin: '-38% 0px -38% 0px' }) : null;
  const observeReels = (root) => { if (centreObs) $$('[data-reel-host]', root).forEach((h) => { if (!h._obs) { h._obs = true; centreObs.observe(h); } }); };

  /* ---------- product videos: hover = live preview of the working demo, click = full video ---------- */
  let activePreview = null;
  function startPreview(host) {
    if (!(typeof NPI_DEMO !== 'undefined') || NPI.prefersReducedMotion() || activePreview?.host === host) return;
    stopPreview();
    const p = productIndex.get(Number(host.dataset.demoHost));
    if (!p || !p.images.length) return;
    const box = document.createElement('div'); box.className = 'demo-preview';
    const entry = { host, box, player: null, dead: false };
    activePreview = entry;
    host._previewTimer = setTimeout(async () => {
      if (entry.dead) return;
      host.append(box); host.classList.add('previewing');
      entry.player = await NPI_DEMO.create(box, p, { mode: 'preview' });
      if (entry.dead) entry.player?.destroy();
    }, 180);
  }
  function stopPreview() {
    const e = activePreview; if (!e) return;
    activePreview = null; e.dead = true; clearTimeout(e.host._previewTimer);
    e.player?.destroy(); e.box.remove(); e.host.classList.remove('previewing');
  }
  function openVideo(p) {
    stopPreview();
    if (!(typeof NPI_DEMO !== 'undefined') || !p) return;
    NPI_DEMO.openModal(p, { onBuy: (btn) => addToCart(p, 1, btn) });
  }
  if (!touchMode) {
    document.addEventListener('mouseover', (e) => { const h = e.target.closest('[data-demo-host]'); if (h) startPreview(h); });
    document.addEventListener('mouseout', (e) => { const h = e.target.closest('[data-demo-host]'); if (h && !h.contains(e.relatedTarget) && activePreview?.host === h) stopPreview(); });
  }
  const demoObs = touchMode && 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) startPreview(en.target); else if (activePreview?.host === en.target) stopPreview(); });
  }, { rootMargin: '-40% 0px -40% 0px' }) : null;
  const observeDemos = (root) => { if (demoObs) $$('[data-demo-host]', root).forEach((h) => { if (!h._dobs) { h._dobs = true; demoObs.observe(h); } }); };
  const badgeClass = (theme) => ({ jumma: 'badge-jumma', flash: 'badge-flash', clearance: 'badge-clearance' }[theme] || 'badge-sale');

  function priceHTML(pr, big = false) {
    return html`<div class="price-row">
      <span class="price ${pr.onSale ? 'is-sale' : ''}">${money(pr.price)}</span>
      ${pr.onSale ? html`<span class="price-old">${money(pr.list)}</span><span class="save-pill">−${pr.savePercent}%</span>` : ''}
      ${big && pr.onSale ? html`<span class="save-pill">You save ${money(pr.list - pr.price)}</span>` : ''}
    </div>`;
  }
  function stockHTML(s) {
    if (s.status === 'out') return html`<div class="stock-line out">Out of stock</div>`;
    if (s.status === 'low') return html`<div class="stock-line low">Hurry, only ${s.left} left</div>`;
    return html`<div class="stock-line">In stock, ready to ship</div>`;
  }

  function productCard(p) {
    const pr = p.pricing;
    const isNew = p.isNew;
    const wished = state.wish.includes(p.id);
    return html`<article class="card ${p.stock.status === 'out' ? 'is-out' : ''}" data-id="${p.id}">
      <div class="card-badges">
        ${pr.onSale ? html`<span class="badge ${badgeClass(pr.theme)}">${pr.label || 'Sale'} −${pr.savePercent}%</span>` : ''}
        ${p.stock.status === 'out' ? html`<span class="badge badge-out">Sold out</span>` : ''}
        ${p.sold >= 10 && p.stock.status !== 'out' ? html`<span class="badge badge-hot">🔥 Best seller</span>` : ''}
        ${isNew ? html`<span class="badge badge-new">New</span>` : ''}
      </div>
      <button class="wish-btn ${wished ? 'on' : ''}" type="button" data-wish="${p.id}" aria-pressed="${wished}" aria-label="Save ${p.name} to wishlist">${wished ? '♥' : '♡'}</button>
      <a class="card-media" href="/product/${p.slug}" data-demo-host="${p.id}" aria-label="Watch ${p.name} in action">${reel(p)}${p.images.length ? html`<span class="play-hint">▶ Watch it work</span>` : ''}</a>
      <div class="card-body">
        <div class="card-cat">${p.category?.name || 'Tools'}</div>
        <a class="card-title" href="/product/${p.slug}" data-link>${p.name}</a>
        ${p.rating.count ? html`<div class="rating">${stars(p.rating.avg)} <span>(${p.rating.count})</span></div>` : ''}
        ${priceHTML(pr)}
        ${pr.endsInSec ? html`<div class="card-cd">⏱ Deal ends in <span data-countdown="${pr.endsInSec}" data-done="ended"></span></div>` : ''}
        ${stockHTML(p.stock)}
        <div class="card-actions">
          ${p.stock.status === 'out'
            ? html`<a class="btn btn-ghost-dark btn-sm" href="/product/${p.slug}" data-link>View details</a>`
            : html`<button class="btn btn-primary btn-sm" type="button" data-add="${p.id}">Add to cart</button>`}
          <button class="btn btn-ghost-dark btn-sm qa-btn" type="button" data-quick="${p.slug}" aria-label="Quick view ${p.name}">👁</button>
        </div>
      </div>
    </article>`;
  }

  const productIndex = new Map(); // id → product, for add-to-cart from cards
  const remember = (list) => { for (const p of list) productIndex.set(p.id, p); return list; };

  /* ---------- 3D tilt that follows the cursor ---------- */
  function attachTilt(root = document) {
    if (NPI.prefersReducedMotion() || !window.matchMedia('(hover: hover)').matches) return;
    $$('[data-tilt]', root).forEach((stage) => {
      if (stage._tilt) return; stage._tilt = true;
      const target = () => stage.querySelector('.tool-svg, img:not(.alt-img)');
      stage.addEventListener('mousemove', (e) => {
        const r = stage.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5; const y = (e.clientY - r.top) / r.height - 0.5;
        const t = target(); if (t) t.style.transform = `rotateY(${x * 40}deg) rotateX(${-y * 30}deg) scale(1.1)`;
      });
      stage.addEventListener('mouseleave', () => { const t = target(); if (t) t.style.transform = ''; });
    });
  }

  /* ---------- scroll reveal ---------- */
  const revealObs = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); revealObs.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -8% 0px' }) : null;
  const reveal = (root = document) => $$('.reveal', root).forEach((el) => (revealObs ? revealObs.observe(el) : el.classList.add('in')));

  /* ---------- counting numbers ---------- */
  function countUp(root = document) {
    $$('[data-count]', root).forEach((el) => {
      const end = Number(el.dataset.count) || 0;
      if (NPI.prefersReducedMotion() || end < 5) { el.textContent = end.toLocaleString(); return; }
      const t0 = performance.now(); const dur = 1200;
      const step = (t) => { const k = Math.min(1, (t - t0) / dur); el.textContent = Math.round(end * (1 - (1 - k) ** 3)).toLocaleString(); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }

  function wire(root) {
    attachTilt(root); reveal(root); NPI.startCountdowns(root); countUp(root); observeReels(root); observeDemos(root);
  }

  /* ============================================================
     cart
     ============================================================ */
  function updateCartCount(bump = false) {
    const n = state.cart.reduce((a, i) => a + i.qty, 0);
    $('#cartCount').textContent = String(n);
    if (bump) { const b = $('#cartBtn'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
  }

  function flyToCart(fromEl, p) {
    if (!fromEl || NPI.prefersReducedMotion()) return;
    const a = fromEl.getBoundingClientRect(); const b = $('#cartBtn').getBoundingClientRect();
    const dot = document.createElement('div');
    dot.className = 'fly-dot';
    mount(dot, p.images?.[0] ? html`<img src="${p.images[0]}" alt="">` : html`🛒`);
    dot.style.left = `${a.left + a.width / 2 - 23}px`; dot.style.top = `${a.top + a.height / 2 - 23}px`;
    document.body.append(dot);
    requestAnimationFrame(() => {
      dot.style.transform = `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px, ${b.top + b.height / 2 - (a.top + a.height / 2)}px) scale(.4)`;
      dot.style.opacity = '.4';
    });
    setTimeout(() => dot.remove(), 750);
  }

  function addToCart(p, qty = 1, fromEl = null) {
    if (!p || p.stock.status === 'out') { toast('Sorry, this item is out of stock.', { type: 'warn' }); return; }
    const line = state.cart.find((i) => i.productId === p.id);
    if (line) line.qty = Math.min(999, line.qty + qty); else state.cart.push({ productId: p.id, qty });
    saveCart();
    flyToCart(fromEl, p);
    setTimeout(() => updateCartCount(true), 600);
    const total = state.cart.find((i) => i.productId === p.id).qty;
    toast(`Added ${qty} × ${p.name}${total > qty ? ` (now ${total} in cart)` : ''}`, { action: 'View cart', onAction: openDrawer });
    if (p.bulk && total < p.bulk.minQty && total >= p.bulk.minQty - 3) {
      setTimeout(() => toast(`Add ${p.bulk.minQty - total} more to unlock ${p.bulk.percent}% bulk discount!`, { type: 'warn' }), 900);
    }
  }

  async function getQuote() {
    if (!state.cart.length) return { lines: [], subtotal: 0, savings: 0, delivery: 0, total: 0, toFreeDelivery: 0, freeDeliveryOver: 0 };
    const q = await api('/cart/quote', { method: 'POST', body: { items: state.cart } });
    // drop products that no longer exist
    const gone = q.lines.filter((l) => l.problem === 'unavailable').map((l) => l.productId);
    if (gone.length) { state.cart = state.cart.filter((i) => !gone.includes(i.productId)); saveCart(); }
    state.lastQuote = q;
    return q;
  }

  function freeShipHTML(q) {
    if (!q.freeDeliveryOver || !q.subtotal) return '';
    if (q.toFreeDelivery <= 0) return html`<div class="free-ship done">🎉 You've unlocked FREE delivery!</div>`;
    const pct = Math.round((q.subtotal / q.freeDeliveryOver) * 100);
    return html`<div class="free-ship">Add <b>${money(q.toFreeDelivery)}</b> more for <b>FREE delivery</b> 🚚
      <div class="bar"><span data-w="${pct}"></span></div></div>`;
  }

  function linesHTML(q) {
    return q.lines.filter((l) => l.problem !== 'unavailable').map((l) => html`<div class="line" data-line="${l.productId}">
      <div class="line-img">${photo(l.image)}</div>
      <div>
        <a class="line-name" href="/product/${l.slug}" data-link>${l.name}</a>
        <div class="line-meta">${money(l.unit)} each ${l.unit < l.listUnit ? html`<s>${money(l.listUnit)}</s>` : ''} ${l.label ? html`· <span class="label">${l.label}</span>` : ''}</div>
        ${l.bulkOffer ? html`<div class="line-meta">💡 Buy ${l.bulkOffer.minQty}+ to save ${l.bulkOffer.percent}%</div>` : ''}
        ${l.problem === 'out_of_stock' ? html`<div class="line-problem">Sold out, please remove</div>` : ''}
        ${l.problem === 'reduced' ? html`<div class="line-problem">Only ${l.stockLeft} available, quantity reduced</div>` : ''}
        <div class="qty sm">
          <button type="button" data-dec="${l.productId}" aria-label="Decrease">−</button>
          <input type="number" min="1" max="999" value="${l.requested}" data-qty="${l.productId}" aria-label="Quantity">
          <button type="button" data-inc="${l.productId}" aria-label="Increase">+</button>
        </div>
      </div>
      <div class="line-right"><span class="line-total">${money(l.lineTotal)}</span><button class="line-remove" type="button" data-remove="${l.productId}">Remove</button></div>
    </div>`);
  }

  function summaryHTML(q) {
    return html`
      <div class="sum-row"><span>Subtotal</span><span class="mono">${money(q.subtotal)}</span></div>
      ${q.savings > 0 ? html`<div class="sum-row savings"><span>You're saving</span><span class="mono">−${money(q.savings)}</span></div>` : ''}
      <div class="sum-row"><span>Delivery</span><span class="mono">${q.delivery ? money(q.delivery) : 'FREE'}</span></div>
      <div class="sum-row total"><span>Total</span><span>${money(q.total)}</span></div>`;
  }

  function wireCartLines(root, rerender) {
    const setQty = (id, qty) => {
      const it = state.cart.find((i) => i.productId === id); if (!it) return;
      if (qty <= 0) state.cart = state.cart.filter((i) => i.productId !== id); else it.qty = Math.min(999, qty);
      saveCart(); rerender();
    };
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-inc],[data-dec],[data-remove]'); if (!t) return;
      const id = Number(t.dataset.inc || t.dataset.dec || t.dataset.remove);
      const it = state.cart.find((i) => i.productId === id); if (!it) return;
      if (t.dataset.remove) {
        const removed = { ...it };
        setQty(id, 0);
        toast('Item removed', { action: 'Undo', onAction: () => { state.cart.push(removed); saveCart(); rerender(); } });
      } else setQty(id, it.qty + (t.dataset.inc ? 1 : -1));
    });
    root.addEventListener('change', (e) => {
      if (e.target.matches('[data-qty]')) setQty(Number(e.target.dataset.qty), Math.max(0, Number.parseInt(e.target.value, 10) || 0));
    });
  }

  async function renderDrawer() {
    const body = $('#drawerBody'); const foot = $('#drawerFoot');
    if (!state.cart.length) {
      mount(body, html`<div class="empty"><div class="no-photo">🛒</div><h3>Your cart is empty</h3><p class="muted">Great tools are waiting. Start with today's deals.</p>
        <a class="btn btn-primary" href="/deals" data-link>See deals</a></div>`);
      mount(foot, html``);
      return;
    }
    try {
      const q = await getQuote();
      mount(body, html`${freeShipHTML(q)}${linesHTML(q)}`);
      mount(foot, html`${summaryHTML(q)}
        <a class="btn btn-primary btn-lg btn-block" href="/checkout" data-link>Checkout securely →</a>
        <a class="btn btn-ghost-dark btn-block btn-sm" href="/cart" data-link>View full cart</a>`);
    } catch (err) { mount(body, html`<p class="field-error">${err.message}</p>`); }
  }
  function openDrawer() {
    $('#cartDrawer').classList.add('open'); $('#drawerBackdrop').classList.add('open');
    $('#cartDrawer').setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden';
    renderDrawer(); $('#drawerClose').focus();
  }
  function closeDrawer() {
    $('#cartDrawer').classList.remove('open'); $('#drawerBackdrop').classList.remove('open');
    $('#cartDrawer').setAttribute('aria-hidden', 'true'); document.body.style.overflow = '';
  }

  /* ============================================================
     quick view
     ============================================================ */
  async function quickView(slug) {
    const d = document.createElement('dialog');
    d.className = 'quick-dialog';
    document.body.append(d);
    mount(d, html`<div class="skel"></div>`);
    d.showModal();
    d.addEventListener('close', () => d.remove());
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    try {
      const { product: p } = await api(`/products/${encodeURIComponent(slug)}`);
      remember([p]);
      mount(d, html`<button class="quick-close" type="button" aria-label="Close">✕</button>
        <div class="pdp">
          <div class="pdp-gallery"><div class="pdp-stage stage-dark" data-reel-host>${reel(p, { eager: true })}</div></div>
          <div class="pdp-info">
            <div class="eyebrow">${p.category?.name || ''}</div>
            <h2>${p.name}</h2>
            ${priceHTML(p.pricing, true)}
            ${stockHTML(p.stock)}
            <p class="muted">${p.description.slice(0, 220)}${p.description.length > 220 ? '…' : ''}</p>
            <div class="buy-row">
              ${p.stock.status !== 'out' ? html`<button class="btn btn-primary btn-lg" type="button" data-qv-add>Add to cart</button>` : ''}
              <a class="btn btn-ghost-dark btn-lg" href="/product/${p.slug}" data-link data-qv-close>Full details</a>
            </div>
          </div>
        </div>`);
      wire(d);
      $('.quick-close', d).addEventListener('click', () => d.close());
      $('[data-qv-add]', d)?.addEventListener('click', (e) => { addToCart(p, 1, e.currentTarget); d.close(); });
      $('[data-qv-close]', d).addEventListener('click', () => d.close());
    } catch (err) { d.close(); toast(err.message, { type: 'error' }); }
  }

  /* global delegation for cards anywhere on the page */
  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) { e.preventDefault(); addToCart(productIndex.get(Number(add.dataset.add)), 1, add); return; }
    const wish = e.target.closest('[data-wish]');
    if (wish) {
      e.preventDefault();
      const id = Number(wish.dataset.wish);
      const on = !state.wish.includes(id);
      state.wish = on ? [...state.wish, id] : state.wish.filter((x) => x !== id);
      saveWish();
      $$(`[data-wish="${id}"]`).forEach((b) => { b.classList.toggle('on', on); b.classList.add('pop'); b.textContent = on ? '♥' : '♡'; b.setAttribute('aria-pressed', String(on)); });
      toast(on ? 'Saved to your wishlist ♥' : 'Removed from wishlist', on ? { action: 'View', onAction: () => go('/account/wishlist') } : {});
      return;
    }
    const qv = e.target.closest('[data-quick]');
    if (qv) { e.preventDefault(); quickView(qv.dataset.quick); return; }
    const dh = e.target.closest('[data-demo-host]');
    if (dh && e.button === 0 && !e.metaKey && !e.ctrlKey) { e.preventDefault(); openVideo(productIndex.get(Number(dh.dataset.demoHost))); }
  });

  /* ripple feedback on every button press */
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.btn'); if (!b || b.disabled || NPI.prefersReducedMotion()) return;
    const r = b.getBoundingClientRect(); const s = Math.max(r.width, r.height);
    const span = document.createElement('span'); span.className = 'ripple';
    span.style.width = span.style.height = `${s}px`;
    span.style.left = `${e.clientX - r.left - s / 2}px`; span.style.top = `${e.clientY - r.top - s / 2}px`;
    b.append(span); setTimeout(() => span.remove(), 600);
  });

  /* ============================================================
     router
     ============================================================ */
  const routes = [];
  const route = (re, fn) => routes.push({ re, fn });

  function go(path, { replace = false } = {}) {
    if (path === location.pathname + location.search) { render(); return; }
    history[replace ? 'replaceState' : 'pushState']({}, '', path);
    render();
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.target === '_blank' || a.hasAttribute('download')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith('/admin') || url.pathname.startsWith('/uploads') || url.pathname.startsWith('/api')) return;
    e.preventDefault();
    closeDrawer(); $('#mainNav').classList.remove('open');
    go(url.pathname + url.search);
  });
  window.addEventListener('popstate', render);

  async function render() {
    stopPreview(); document.querySelector('dialog.demo-modal')?.close();
    state.cleanup.forEach((f) => { try { f(); } catch { /* ignore */ } });
    state.cleanup = [];
    document.body.classList.remove('has-sticky-buy');
    $('#stickyBuy').classList.remove('show');
    const path = location.pathname.replace(/\/+$/, '') || '/';
    const query = new URLSearchParams(location.search);
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === path || (path.startsWith('/product') && a.dataset.nav === 'shop')));
    const app = $('#app');
    for (const r of routes) {
      const m = path.match(r.re);
      if (m) {
        try { await r.fn(app, m.slice(1).map(decodeURIComponent), query); }
        catch (err) {
          if (err.status === 401) { go(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true }); return; }
          mount(app, html`<section class="section"><div class="wrap"><div class="empty"><div class="no-photo">🔧</div><h3>${err.status === 404 ? 'Not found' : 'Something went wrong'}</h3><p class="muted">${err.message}</p><a class="btn btn-primary" href="/shop" data-link>Back to shop</a></div></div></section>`);
        }
        app.classList.remove('page-enter'); void app.offsetWidth; app.classList.add('page-enter');
        wire(app);
        return;
      }
    }
  }
  const setTitle = (t) => { document.title = t ? `${t} · ${state.store?.settings.store_name || 'NPI Global Trading'}` : `${state.store?.settings.store_name || 'NPI Global Trading'}: Precision Hand Tools`; };
  const scrollTop = () => window.scrollTo({ top: 0, behavior: 'auto' });

  /* ============================================================
     PAGES
     ============================================================ */

  /* ---------------- HOME ---------------- */
  route(/^\/$/, async (app) => {
    setTitle(''); scrollTop();
    const S = state.store.settings;
    const words = S.hero_title.split(' ');
    const live = state.store.promotions.filter((p) => p.live);
    const upcoming = state.store.promotions.filter((p) => !p.live && p.startsInSec !== null);
    const cats = state.store.categories;

    mount(app, html`
      <section class="hero">
        <div class="wrap hero-grid">
          <div>
            <div class="hero-eyebrow eyebrow">Wholesale &amp; Retail: Hand Tools</div>
            <h1>${words.map((w, i) => html`<span class="word ${i === words.length - 1 ? 'accent' : ''}" data-delay="${i * 90}">${w}</span> `)}</h1>
            <p class="lede">${S.hero_text}</p>
            <div class="hero-ctas">
              <a href="/shop" data-link class="btn btn-primary btn-lg">Shop all tools →</a>
              <a href="/lab" data-link class="btn btn-ghost btn-lg">▶ Try the Tool Lab</a>
            </div>
            <div class="hero-stats">
              <div class="hero-stat"><strong data-count="${state.store.stats.skus}">0</strong><span>Tools in stock</span></div>
              <div class="hero-stat"><strong data-count="${cats.length}">0</strong><span>Categories</span></div>
              <div class="hero-stat"><strong>24h</strong><span>Quote turnaround</span></div>
            </div>
          </div>
          <div class="showcase" id="showcase" aria-label="Featured products">
            <div class="showcase-glow"></div><div class="showcase-ring"></div><div class="showcase-floor"></div>
            <a class="showcase-main stage-dark" id="scMain" href="/shop" data-link data-reel-host></a>
            <div class="showcase-caption" id="scCap"></div>
            <div id="scThumbs"></div>
          </div>
        </div>
      </section>
      <div class="trustbar"><div class="wrap trust-grid">
        <div class="trust-item"><div class="ti-icon">🛡</div><div><b>Genuine tools</b><span>Sourced direct, warranty backed</span></div></div>
        <div class="trust-item"><div class="ti-icon">🚚</div><div><b>Fast delivery</b><span>${Number(S.free_delivery_over) ? `Free over ${money(S.free_delivery_over)}` : 'Nationwide shipping'}</span></div></div>
        <div class="trust-item"><div class="ti-icon">💵</div><div><b>Cash on delivery</b><span>Pay when it arrives</span></div></div>
        <div class="trust-item"><div class="ti-icon">📦</div><div><b>Bulk pricing</b><span>Automatic volume discounts</span></div></div>
      </div></div>
      <div id="homeDeals"></div>
      <section class="section reveal"><div class="wrap">
        <div class="section-head"><div><div class="eyebrow">Shop by category</div><h2>Pick your tool type.</h2></div><p>Every category, every size. Tap a category to see what's in stock.</p></div>
        <div class="cat-strip stagger">${cats.map((c, i) => html`<a class="cat-card" href="/shop?category=${c.slug}" data-link data-delay="${i * 60}">
          <div class="cat-name">${c.name}</div><div class="cat-img">${photo(c.image, c.name)}</div><div class="cat-count">${c.count} tool${c.count === 1 ? '' : 's'}</div><div class="cat-bar"></div></a>`)}</div>
      </div></section>
      <section class="section section-white reveal" id="homeFeatured" hidden><div class="wrap">
        <div class="section-head"><div><div class="eyebrow">Featured tools</div><h2>Spotlight, in motion.</h2></div><p>Hover a tool to watch it in action, with close-ups of the working end.</p></div>
        <div class="feature-grid" id="featuredGrid"></div>
      </div></section>
      <section class="section-tight reveal"><div class="wrap"><div class="finder-cta">
        <div><div class="eyebrow">🧭 Tool Finder</div><h2>Not sure which tool you need?</h2><p>Tell us the job. We'll match the right tools and show each one working.</p>
          <div class="jobs-mini">${JOBS.slice(0, 6).map((j) => html`<a href="/finder?job=${j.key}" data-link>${j.icon} ${j.title}</a>`)}</div></div>
        <a class="btn btn-primary btn-lg" href="/finder" data-link>Find my tool →</a></div></div></section>
      <section class="section section-dark reveal"><div class="wrap">
        <div class="section-head"><div><div class="eyebrow">The Tool Lab</div><h2>Try before you buy.</h2></div><p>Feel how each tool works with real-feel simulations. Tighten a bolt, drive a nail, read a level.</p></div>
        <div class="lab-tabs" id="homeLabTabs">${['torque', 'hammer', 'level', 'tape'].map((k, i) => html`<button class="lab-tab ${i === 0 ? 'active' : ''}" type="button" data-sim="${k}">${ICON(NPI_SIMS.META[k].icon)} ${NPI_SIMS.META[k].title}</button>`)}</div>
        <div class="lab-layout"><div id="homeSim"></div>
          <div class="lab-side"><h3 id="homeSimTitle"></h3><p class="lesson" id="homeSimLesson"></p><a class="btn btn-primary btn-block" href="/lab" data-link>Open the full Tool Lab →</a></div></div>
      </div></section>
      <section class="section reveal"><div class="wrap">
        <div class="section-head"><div><div class="eyebrow">Most popular</div><h2>Trusted on the job.</h2></div><a class="btn btn-dark" href="/shop?sort=popular" data-link>See all →</a></div>
        <div class="grid" id="popularGrid">${Array.from({ length: 4 }, () => html`<div class="skel skel-card"></div>`)}</div>
      </div></section>
      <div id="recentWrap"></div>
      <section class="section section-dark reveal"><div class="wrap">
        <div class="section-head"><div><div class="eyebrow">Why ${S.store_name}</div><h2>One supplier. Both ends of the shelf.</h2></div></div>
        <div class="why-grid">
          <div class="why"><div class="why-icon">🎯</div><h3>Precision engineered</h3><p>Tips, jaws and blades made to tight tolerances, so they grip and don't slip.</p></div>
          <div class="why"><div class="why-icon">🏗</div><h3>Job-site tough</h3><p>Shock-absorbing handles and hardened steel, built for daily abuse.</p></div>
          <div class="why"><div class="why-icon">📈</div><h3>Wholesale ready</h3><p>Volume discounts apply automatically in your cart, and quotes come within 24 hours.</p></div>
          <div class="why"><div class="why-icon">🤝</div><h3>Real people</h3><p>Call, WhatsApp or email, and talk to someone who knows tools.</p></div>
        </div>
      </div></section>
      <section class="section reveal"><div class="wrap center">
        <div class="eyebrow">Wholesale enquiries</div>
        <h2>Buying for a business?</h2>
        <p class="muted">Tell us your volumes and we'll reply within one business day with tiered pricing.</p><br>
        <a class="btn btn-primary btn-lg" href="/contact" data-link>Request a trade quote</a>
      </div></section>`);

    $$('.word', app).forEach((w) => { w.style.animationDelay = `${w.dataset.delay}ms`; });

    // home tool lab teaser
    let destroySim = null;
    const showSim = (k) => {
      destroySim?.();
      destroySim = NPI_SIMS.mount($('#homeSim'), k);
      $('#homeSimTitle').textContent = NPI_SIMS.META[k].title;
      $('#homeSimLesson').textContent = NPI_SIMS.META[k].lesson;
      $$('#homeLabTabs .lab-tab').forEach((t) => t.classList.toggle('active', t.dataset.sim === k));
    };
    $('#homeLabTabs').addEventListener('click', (e) => { const t = e.target.closest('[data-sim]'); if (t) showSim(t.dataset.sim); });
    showSim('torque');
    state.cleanup.push(() => destroySim?.());

    // data-driven sections
    const [all, popular] = await Promise.all([api('/products?sort=featured'), api('/products?sort=popular&limit=8')]);
    remember(all.products); remember(popular.products);

    const dealsEl = $('#homeDeals');
    if (live.length) {
      const promo = live[0];
      const inDeal = all.products.filter((p) => p.pricing.promoId === promo.id);
      const onSale = inDeal.length ? inDeal : all.products.filter((p) => p.pricing.onSale);
      mount(dealsEl, dealSection(promo, onSale.slice(0, 8)));
    } else if (upcoming.length) {
      const nx = upcoming[0];
      mount(dealsEl, html`<section class="section-tight"><div class="wrap"><div class="upcoming-strip">
        <div><div class="deal-badge">⏳ Coming up</div><h3>${nx.name}: ${nx.discount_type === 'percent' ? `${nx.value}% off` : `${money(nx.value)} off`}</h3>
        <p>${dealScopeText(nx)}. Set a reminder: the clock is ticking.</p></div>
        <div class="center"><div class="countdown-label">Starts in</div><div class="cd-big" data-countdown="${nx.startsInSec}" data-done="LIVE!"></div></div>
        <a class="btn btn-primary" href="/deals" data-link>Preview deals</a></div></div></section>`);
    }
    const saleOnly = !live.length && all.products.filter((p) => p.pricing.onSale);
    if (saleOnly && saleOnly.length) {
      dealsEl.insertAdjacentHTML('beforeend', html`<section class="section-tight"><div class="wrap">
        <div class="section-head"><div><div class="eyebrow">On sale now</div><h2>Price drops.</h2></div><a class="btn btn-dark btn-sm" href="/deals" data-link>All deals →</a></div>
        <div class="grid">${saleOnly.slice(0, 4).map(productCard)}</div></div></section>`.s);
    }
    wire(dealsEl);

    const featured = all.products.filter((p) => p.featured).slice(0, 4);
    if (featured.length) {
      $('#homeFeatured').hidden = false;
      mount($('#featuredGrid'), html`${featured.map((p) => html`<div class="feat-card">
        <a class="feat-stage stage-dark card-media" href="/product/${p.slug}" data-demo-host="${p.id}" aria-label="Watch ${p.name} in action">${reel(p)}<span class="play-hint">▶ Watch it work</span></a>
        <div class="feat-info">
          <div class="card-cat">${p.category?.name || ''}</div><h3>${p.name}</h3>
          ${priceHTML(p.pricing)}
          <ul class="spec-mini">${p.specs.slice(0, 3).map((s) => html`<li><span>${s.label}</span><span>${s.value}</span></li>`)}</ul>
          <div class="card-actions">
            ${p.stock.status !== 'out' ? html`<button class="btn btn-primary btn-sm" type="button" data-add="${p.id}">Add to cart</button>` : ''}
            <a class="btn btn-ghost btn-sm" href="/product/${p.slug}" data-link>Details</a>
          </div>
        </div></div>`)}`);
      wire($('#featuredGrid'));
    }
    // hero showcase: real products on a turntable, each playing its clip
    const showList = (all.products.filter((p) => p.featured && p.images.length).length >= 4
      ? all.products.filter((p) => p.featured && p.images.length) : all.products.filter((p) => p.images.length)).slice(0, 8);
    if (showList.length) {
      mount($('#scThumbs'), html`${showList.map((p, i) => {
        const a = ((i + 0.5) / showList.length) * Math.PI * 2 - Math.PI / 2;
        return html`<button class="showcase-thumb" type="button" data-sc="${i}" data-x="${(50 + Math.cos(a) * 43 - 6.5).toFixed(2)}" data-y="${(50 + Math.sin(a) * 43 - 6.5).toFixed(2)}" aria-label="Show ${p.name}"><img src="${p.images[0]}" alt=""></button>`;
      })}`);
      $$('.showcase-thumb', app).forEach((t) => { t.style.left = `${t.dataset.x}%`; t.style.top = `${t.dataset.y}%`; });
      let cur = -1;
      const show = (i) => {
        cur = (i + showList.length) % showList.length;
        const p = showList[cur];
        const main = $('#scMain');
        stopReel(main.querySelector('.reel'));
        main.href = `/product/${p.slug}`;
        mount(main, reel(p, { eager: true, tag: '▶ Live' }));
        mount($('#scCap'), html`<b>${p.name}</b><span>${money(p.pricing.price)}${p.pricing.onSale ? ` · −${p.pricing.savePercent}%` : ''}</span>`);
        $$('.showcase-thumb', app).forEach((t) => t.classList.toggle('active', Number(t.dataset.sc) === cur));
        playReel(main.querySelector('.reel'));
      };
      let auto = setInterval(() => show(cur + 1), FRAME_MS * 3);
      $('#scThumbs').addEventListener('click', (e) => {
        const t = e.target.closest('[data-sc]'); if (!t) return;
        clearInterval(auto); show(Number(t.dataset.sc)); auto = setInterval(() => show(cur + 1), FRAME_MS * 3);
      });
      state.cleanup.push(() => clearInterval(auto));
      show(0);
    }

    let pop = popular.products.filter((p) => p.sold > 0);
    if (pop.length < 8) {
      // not enough sales yet: show one strong product from each category instead of 8 of the same kind
      const seen = new Set(pop.map((p) => p.id));
      const byCat = new Map();
      for (const p of all.products) { if (seen.has(p.id) || !p.images.length) continue; const k = p.category?.id; if (!byCat.has(k)) byCat.set(k, []); byCat.get(k).push(p); }
      const lanes = [...byCat.values()];
      for (let r = 0; pop.length < 8 && lanes.some((l) => l[r]); r++) for (const l of lanes) { if (l[r] && pop.length < 8) pop.push(l[r]); }
    }
    mount($('#popularGrid'), html`${pop.slice(0, 8).map(productCard)}`);
    wire($('#popularGrid'));

    const recent = state.recent.map((id) => all.products.find((p) => p.id === id)).filter(Boolean).slice(0, 4);
    if (recent.length) {
      mount($('#recentWrap'), html`<section class="section section-white"><div class="wrap">
        <div class="section-head"><div><div class="eyebrow">Pick up where you left off</div><h2>Recently viewed.</h2></div></div>
        <div class="grid">${recent.map(productCard)}</div></div></section>`);
      wire($('#recentWrap'));
    }
  });

  function dealScopeText(p) {
    const cat = p.scope === 'category' ? state.store.categories.find((c) => c.id === p.category_id)?.name : null;
    const scope = p.scope === 'all' ? 'Storewide' : p.scope === 'category' ? `All ${cat || 'category'} tools` : 'Selected tools';
    const days = p.days_of_week ? p.days_of_week.split(',').map((d) => NPI.DAYS[Number(d)]).join(', ') : '';
    return `${scope}${days ? ` · every ${days}` : ''}`;
  }

  function dealSection(promo, products) {
    return html`<section class="deal-hero theme-${promo.theme}"><div class="pattern"></div><div class="wrap">
      <div class="deal-head">
        <div><div class="deal-badge"><span class="live-dot"></span> Live now · ${promo.badge || promo.name}</div>
          <h2>${promo.name}: ${promo.discount_type === 'percent' ? `${promo.value}% off` : `${money(promo.value)} off`}</h2>
          <p>${dealScopeText(promo)}. Prices go back up when the timer hits zero.</p></div>
        <div><div class="countdown-label">Ends in</div><div class="countdown"><div class="cd-big" data-countdown="${promo.endsInSec}" data-done="ENDED"></div></div></div>
      </div>
      <div class="deal-rail">${products.map(productCard)}</div>
    </div></section>`;
  }

  /* ---------------- SHOP ---------------- */
  route(/^\/shop$/, async (app, _m, query) => {
    const cats = state.store.categories;
    const f = {
      category: query.get('category') || '', q: query.get('q') || '', sort: query.get('sort') || 'featured',
      onSale: query.get('sale') === '1', inStock: query.get('stock') === '1'
    };
    const cat = cats.find((c) => c.slug === f.category);
    setTitle(cat ? cat.name : f.q ? `Search: ${f.q}` : 'Shop');
    if (!app.querySelector('#shopGrid')) scrollTop();
    $('#searchInput').value = f.q;
    const total = cats.reduce((a, c) => a + c.count, 0);
    const qs = (patch) => {
      const n = { ...f, ...patch };
      const p = new URLSearchParams();
      if (n.category) p.set('category', n.category); if (n.q) p.set('q', n.q);
      if (n.sort !== 'featured') p.set('sort', n.sort); if (n.onSale) p.set('sale', '1'); if (n.inStock) p.set('stock', '1');
      const s = p.toString(); return `/shop${s ? `?${s}` : ''}`;
    };
    mount(app, html`
      <div class="page-head"><div class="wrap">
        <div class="crumbs"><a href="/" data-link>Home</a> / <a href="/shop" data-link>Shop</a>${cat ? html` / ${cat.name}` : ''}</div>
        <h1>${cat ? cat.name : f.q ? html`Results for “${f.q}”` : 'All tools'}</h1>
        <p>${cat ? `Browse our ${cat.name.toLowerCase()}. Hover a tool to watch it work, tap it for the full video, and ♡ to save it.` : 'Every tool we carry. Filter by category, deals and availability.'}</p>
      </div></div>
      <section class="section-tight"><div class="wrap shop-layout">
        <aside class="filters" aria-label="Filters">
          <div class="filter-group"><h4>Category</h4><div class="filter-list">
            <a class="chip ${!f.category ? 'active' : ''}" href="${qs({ category: '' })}" data-link>All tools <span class="chip-count">${total}</span></a>
            ${cats.map((c) => html`<a class="chip ${f.category === c.slug ? 'active' : ''}" href="${qs({ category: c.slug })}" data-link>${c.name} <span class="chip-count">${c.count}</span></a>`)}
          </div></div>
          <div class="filter-group"><h4>Show only</h4><div class="filter-list">
            <label class="toggle"><input type="checkbox" id="fSale" ${f.onSale ? 'checked' : ''}> On sale 🏷</label>
            <label class="toggle"><input type="checkbox" id="fStock" ${f.inStock ? 'checked' : ''}> In stock</label>
          </div></div>
        </aside>
        <div>
          <div class="shop-toolbar">
            <span class="count" id="shopCount">Loading…</span>
            <label><span class="sr-only">Sort by</span><select class="select" id="fSort">
              ${[['featured', 'Recommended'], ['popular', 'Best selling'], ['discount', 'Biggest discount'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'], ['newest', 'Newest'], ['name', 'Name A–Z']]
                .map(([v, l]) => html`<option value="${v}" ${f.sort === v ? 'selected' : ''}>${l}</option>`)}
            </select></label>
          </div>
          <div class="grid" id="shopGrid">${Array.from({ length: 6 }, () => html`<div class="skel skel-card"></div>`)}</div>
        </div>
      </div></section>`);
    $('#fSort').addEventListener('change', (e) => go(qs({ sort: e.target.value }), { replace: true }));
    $('#fSale').addEventListener('change', (e) => go(qs({ onSale: e.target.checked }), { replace: true }));
    $('#fStock').addEventListener('change', (e) => go(qs({ inStock: e.target.checked }), { replace: true }));

    const p = new URLSearchParams({ sort: f.sort });
    if (f.category) p.set('category', f.category); if (f.q) p.set('q', f.q);
    if (f.onSale) p.set('onSale', '1'); if (f.inStock) p.set('inStock', '1');
    const { products } = await api(`/products?${p}`);
    remember(products);
    $('#shopCount').textContent = `${products.length} tool${products.length === 1 ? '' : 's'}`;
    mount($('#shopGrid'), products.length ? html`${products.map(productCard)}` : html`<div class="empty"><div class="no-photo">🔍</div><h3>No tools match</h3><p class="muted">Try another category or clear your filters.</p><a class="btn btn-primary" href="/shop" data-link>Clear filters</a></div>`);
    wire($('#shopGrid'));
  });

  /* ---------------- DEALS ---------------- */
  route(/^\/deals$/, async (app) => {
    setTitle('Deals & Jumma Offers'); scrollTop();
    const { products } = await api('/products?sort=discount');
    remember(products);
    const promos = state.store.promotions;
    const live = promos.filter((p) => p.live);
    const upcoming = promos.filter((p) => !p.live && p.startsInSec !== null);
    const onSale = products.filter((p) => p.pricing.onSale);
    const previews = (promo) => products.filter((p) => p.pricing.upcoming && p.pricing.upcoming.name === promo.name);
    mount(app, html`
      <div class="page-head"><div class="wrap"><div class="eyebrow">Deals</div><h1>Save on serious tools.</h1>
        <p>Live deals, weekly Jumma specials and price drops, all in one place. Deal prices are applied automatically at checkout.</p></div></div>
      ${live.map((promo) => dealSection(promo, products.filter((p) => p.pricing.promoId === promo.id)))}
      ${upcoming.length ? html`<section class="section-tight"><div class="wrap">${upcoming.map((nx) => html`
        <div class="upcoming-strip reveal"><div><div class="deal-badge">⏳ Coming up</div>
          <h3>${nx.name}: ${nx.discount_type === 'percent' ? `${nx.value}% off` : `${money(nx.value)} off`}</h3><p>${dealScopeText(nx)}</p></div>
          <div class="center"><div class="countdown-label">Starts in</div><div class="cd-big" data-countdown="${nx.startsInSec}" data-done="LIVE!"></div></div></div>
        ${previews(nx).length ? html`<br><div class="grid">${previews(nx).slice(0, 8).map(productCard)}</div>` : ''}<br>`)}</div></section>` : ''}
      <section class="section"><div class="wrap">
        <div class="section-head"><div><div class="eyebrow">Price drops</div><h2>Everything on sale.</h2></div></div>
        ${onSale.length ? html`<div class="grid">${onSale.map(productCard)}</div>`
          : html`<div class="empty"><div class="no-photo">🏷</div><h3>No discounts right now</h3><p class="muted">New deals drop every week. Check back on Friday for Jumma Deals!</p><a class="btn btn-primary" href="/shop" data-link>Browse all tools</a></div>`}
      </div></section>`);
  });

  /* ---------------- TOOL FINDER: job → questions → matched products ---------------- */
  const JOBS = [
    { key: 'screws', icon: '🪛', title: 'Fixing screws', sub: 'Furniture, fittings, panels', sim: 'screw', q: [
      { text: 'Which screw heads?', opts: [['⊖ Slotted', { 'screws-slotted': 4 }], ['⊕ Phillips / cross', { 'screws-phillips': 4 }], ['Both / not sure', { 'screws-slotted': 2, 'screws-phillips': 2 }]] },
      { text: 'Working near electrical wiring?', opts: [['⚡ Yes, electrical work', { electrical: 5 }], ['No', {}]] },
      { text: 'How do you drive them?', opts: [['🔋 Cordless drill / driver', { 'power-driver': 6, magnetic: 2 }], ['✋ By hand', { 'power-driver': -4 }]] }] },
    { key: 'electrical', icon: '⚡', title: 'Electrical wiring', sub: 'Panels, sockets, cables', sim: 'cutter', q: [
      { text: 'How thick is the wire or cable?', slider: { min: 0.5, max: 35, step: 0.5, unit: 'mm²', start: 2.5, map: (v) => (v <= 6 ? { 'wire-cut': 4, grip: 2 } : { 'cable-cut': 6, 'wire-cut': 1 }) } },
      { text: 'What else do you need to do?', opts: [['Strip, twist & bend wires', { grip: 3 }], ['Work inside tight boxes', { 'tight-space': 4 }], ['Fix switches & sockets', { electrical: 3, 'screws-slotted': 2, 'screws-phillips': 2 }]] }] },
    { key: 'plumbing', icon: '🚰', title: 'Plumbing', sub: 'Pipes, fittings, taps', q: [
      { text: 'What pipe are you working with?', opts: [['PPR / PVC / plastic', { 'pipe-plastic': 6, plumbing: 2 }], ['Steel / GI pipe', { 'metal-cut': 4, clamp: 2, plumbing: 2 }], ['Just tightening fittings', { nuts: 4, clamp: 2, plumbing: 2 }]] },
      { text: 'Any stuck or rounded nuts?', opts: [['Yes, rounded / stuck', { clamp: 5 }], ['No', {}]] }] },
    { key: 'nuts', icon: '🔩', title: 'Nuts & bolts', sub: 'Machines, cars, bikes', sim: 'torque', q: [
      { text: 'What kind of fastener?', opts: [['Hex nuts & bolts', { nuts: 4, 'socket-drive': 2 }], ['Allen / hex-socket screws', { 'hex-socket': 6 }], ['Nuts on long studs / recessed', { 'recessed-nuts': 6 }], ['Many sizes, car/bike work', { 'socket-drive': 6, automotive: 3 }]] },
      { text: 'Is it rounded or rusted?', opts: [['Yes', { clamp: 5 }], ['No', {}]] }] },
    { key: 'measure', icon: '📏', title: 'Measuring', sub: 'Rooms, plots, cutting lengths', sim: 'tape', q: [
      { text: 'Longest distance you measure?', slider: { min: 1, max: 30, step: 0.5, unit: 'm', start: 4, map: (v) => (v <= 3.5 ? { 'measure-short': 6, 'measure-mid': 3 } : v <= 5 ? { 'measure-mid': 6 } : v <= 15 ? { 'measure-long': 6, 'measure-xl': 2 } : { 'measure-xl': 6 }) } }] },
    { key: 'level', icon: '🫧', title: 'Levelling', sub: 'Shelves, tiles, walls', sim: 'level', q: [
      { text: 'What are you levelling?', opts: [['Shelves, frames, fixtures', { 'level-short': 2, 'level-long': 3 }], ['Tiles & floors', { tiling: 5, 'level-long': 3 }], ['Brick, block & plaster', { masonry: 6 }], ['Pipes, conduit, tight spots', { 'level-short': 6 }]] }] },
    { key: 'drilling', icon: '🌀', title: 'Drilling holes', sub: 'Steel, wood, concrete', q: [
      { text: 'What material?', opts: [['Wood / plastic', { 'drill-wood': 5, 'drill-deep': 1, 'drill-steel': 1 }], ['Mild steel / aluminium', { 'drill-steel': 6, 'drill-stainless': 2 }], ['Stainless / hard steel', { 'drill-stainless': 7, 'drill-steel': 2 }], ['Concrete / brick', { 'drill-concrete': 7, masonry: 1 }]] },
      { text: 'How deep?', opts: [['Normal holes', {}], ['Deep / through walls', { 'drill-deep': 5 }]] }] },
    { key: 'wood', icon: '🪚', title: 'Carpentry', sub: 'Shuttering, furniture, doors', sim: 'hammer', q: [
      { text: 'What will you do most?', opts: [['Drive nails', { nailing: 6, woodwork: 2, 'nail-pull': 1 }], ['Pull nails out', { 'nail-pull': 6, nailing: 1 }], ['Plane & trim wood', { 'wood-plane': 6, woodwork: 2 }], ['Cut board & carton', { 'board-cut': 6, woodwork: 1 }]] }] },
    { key: 'metal', icon: '🛠', title: 'Sheet metal & aluminium', sub: 'Windows, ducting, signboards', q: [
      { text: 'What do you need?', opts: [['Join sheets with rivets', { rivet: 7, 'drill-steel': 2 }], ['Cut rod, pipe & bolts', { 'metal-cut': 6, clamp: 1 }], ['Drill holes in metal', { 'drill-steel': 5, 'drill-stainless': 2, rivet: 1 }]] }] },
    { key: 'tiles', icon: '🧱', title: 'Tiles & stone', sub: 'Cutting, laying, levelling', q: [
      { text: 'Which part of the job?', opts: [['Cutting tile, marble, granite', { 'tile-cut': 7, tiling: 1 }], ['Laying & levelling', { tiling: 5, masonry: 3, 'level-long': 2 }], ['Drilling for fixings', { 'drill-concrete': 6, 'measure-mid': 1 }]] }] }
  ];

  function scoreProducts(products, weights) {
    return products.map((p) => {
      let score = 0; const why = [];
      for (const t of p.tags || []) { const w = weights[t] || 0; if (w) { score += w; if (w > 0) why.push(t); } }
      if (p.stock.status === 'out') score -= 3;
      if (p.pricing.onSale) score += 0.5;
      return { p, score, why };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.p.pricing.price - b.p.pricing.price);
  }

  route(/^\/finder$/, async (app, _m, query) => {
    setTitle('Tool Finder'); scrollTop();
    const { products } = await api('/products?sort=popular');
    remember(products);
    const TAGS = state.store.tags || {};
    let job = JOBS.find((j) => j.key === query.get('job')) || null;
    let step = 0; let answers = []; let destroySim = null;
    const draw = () => {
      destroySim?.(); destroySim = null;
      if (!job) {
        mount(app, html`<section class="finder-hero"><div class="wrap">
          <div class="eyebrow">Tool Finder</div><h1>What are you working on?</h1>
          <p>Answer two or three quick questions and we'll match you with the right tools, and show you each one working.</p>
          <div class="job-grid">${JOBS.map((j, i) => html`<button class="job-card" type="button" data-job="${j.key}" data-delay="${i * 50}"><span class="job-icon">${j.icon}</span><b>${j.title}</b><span>${j.sub}</span></button>`)}</div>
        </div></section>`);
        $$('.job-card', app).forEach((b) => { b.style.animationDelay = `${b.dataset.delay}ms`; });
        return;
      }
      if (step < job.q.length) {
        const q = job.q[step];
        mount(app, html`<section class="finder-hero"><div class="wrap finder-layout">
          <div class="finder-q">
            <button class="link-btn" type="button" id="fBack">← ${step ? 'Back' : 'All jobs'}</button>
            <div class="finder-steps">${job.q.map((_, i) => html`<span class="${i < step ? 'done' : i === step ? 'now' : ''}"></span>`)}<span></span></div>
            <div class="eyebrow">${job.icon} ${job.title} · question ${step + 1} of ${job.q.length}</div>
            <h2>${q.text}</h2>
            ${q.slider ? html`<div class="finder-slider"><output id="fOut">${q.slider.start} ${q.slider.unit}</output>
                <input type="range" id="fRange" min="${q.slider.min}" max="${q.slider.max}" step="${q.slider.step}" value="${q.slider.start}" aria-label="${q.text}">
                <div class="fs-scale"><span>${q.slider.min} ${q.slider.unit}</span><span>${q.slider.max} ${q.slider.unit}</span></div>
                <button class="btn btn-primary btn-lg" type="button" id="fNext">Next →</button></div>`
              : html`<div class="finder-opts">${q.opts.map(([label], i) => html`<button class="finder-opt" type="button" data-opt="${i}">${label}</button>`)}</div>`}
          </div>
          ${job.sim ? html`<div class="finder-sim"><div class="eyebrow">Try it while you decide</div><div id="fSim"></div></div>` : ''}
        </div></section>`);
        if (job.sim && (typeof NPI_SIMS !== 'undefined')) destroySim = NPI_SIMS.mount($('#fSim'), job.sim);
        $('#fBack').addEventListener('click', () => { if (step) { step--; answers.pop(); } else { job = null; history.replaceState({}, '', '/finder'); } draw(); });
        $$('[data-opt]', app).forEach((b) => b.addEventListener('click', () => { answers.push(q.opts[Number(b.dataset.opt)][1]); step++; draw(); }));
        if (q.slider) {
          const r = $('#fRange');
          r.addEventListener('input', () => { $('#fOut').textContent = `${r.value} ${q.slider.unit}`; });
          $('#fNext').addEventListener('click', () => { answers.push(q.slider.map(Number(r.value))); step++; draw(); });
        }
        return;
      }
      // results
      const weights = {};
      for (const a of answers) for (const [k, v] of Object.entries(a)) weights[k] = (weights[k] || 0) + v;
      const ranked = scoreProducts(products, weights);
      const best = ranked[0]; const alts = ranked.slice(1, 5);
      const kit = []; const seen = new Set();
      for (const r of ranked) { const c = r.p.category?.id; if (!seen.has(c)) { seen.add(c); kit.push(r.p); } if (kit.length === 3) break; }
      const kitTotal = kit.reduce((s, p) => s + p.pricing.price, 0);
      mount(app, html`<section class="finder-hero"><div class="wrap">
        <button class="link-btn" type="button" id="fRestart">↺ Start again</button>
        <div class="eyebrow">${job.icon} ${job.title}: your match</div>
        ${best ? html`<div class="finder-best">
            <button class="fb-media card-media" type="button" data-demo-host="${best.p.id}" aria-label="Watch ${best.p.name}">${reel(best.p, { eager: true })}<span class="play-hint">▶ Watch it work</span></button>
            <div class="fb-info"><span class="badge badge-hot">🏆 Best match</span><h2>${best.p.name}</h2>
              <ul class="fb-why">${best.why.slice(0, 4).map((t) => html`<li>✓ ${TAGS[t] || t}</li>`)}</ul>
              ${priceHTML(best.p.pricing, true)}${stockHTML(best.p.stock)}
              <div class="buy-row"><button class="btn btn-primary btn-lg" type="button" data-add="${best.p.id}">Add to cart</button><a class="btn btn-ghost btn-lg" href="/product/${best.p.slug}" data-link>Details</a></div></div></div>`
          : html`<div class="empty"><h3>No exact match yet</h3><p class="muted">Tell us about your job and we'll advise you.</p><a class="btn btn-primary" href="/contact" data-link>Ask an expert</a></div>`}
        ${kit.length > 1 ? html`<div class="finder-kit"><div><div class="eyebrow">Complete the job</div><h3>Your ${job.title.toLowerCase()} kit</h3>
            <div class="kit-items">${kit.map((p) => html`<span class="kit-item">${photo(p.images[0], p.name)}<small>${p.name}</small></span>`)}</div></div>
            <div class="kit-buy"><span class="price">${money(kitTotal)}</span><button class="btn btn-primary btn-lg" type="button" id="kitAdd">Add all ${kit.length} to cart</button></div></div>` : ''}
        ${alts.length ? html`<div class="section-head"><div><div class="eyebrow">Also a good fit</div><h2>Alternatives.</h2></div></div><div class="grid">${alts.map((r) => productCard(r.p))}</div>` : ''}
      </div></section>`);
      $('#fRestart').addEventListener('click', () => { job = null; step = 0; answers = []; history.replaceState({}, '', '/finder'); draw(); });
      $('#kitAdd')?.addEventListener('click', (e) => { kit.forEach((p) => addToCart(p, 1, e.currentTarget)); });
      wire(app);
    };
    app.addEventListener('click', (e) => {
      const b = e.target.closest('[data-job]'); if (!b) return;
      job = JOBS.find((j) => j.key === b.dataset.job); step = 0; answers = [];
      history.replaceState({}, '', `/finder?job=${job.key}`); draw(); scrollTop();
    });
    draw();
    state.cleanup.push(() => destroySim?.());
  });

  /* ---------------- TOOL LAB ---------------- */
  route(/^\/lab$/, async (app, _m, query) => {
    setTitle('Tool Lab'); scrollTop();
    const keys = NPI_SIMS.KEYS;
    let current = keys.includes(query.get('tool')) ? query.get('tool') : 'torque';
    mount(app, html`<section class="section section-dark"><div class="wrap">
      <div class="section-head"><div><div class="eyebrow">Interactive</div><h1>The Tool Lab.</h1></div>
        <p>Hands-on simulations of how our tools work. Use your mouse, finger or keyboard. Pick a tool:</p></div>
      <div class="lab-tabs" id="labTabs">${keys.map((k) => html`<button class="lab-tab" type="button" data-sim="${k}">${ICON(NPI_SIMS.META[k].icon)} ${NPI_SIMS.META[k].title}</button>`)}</div>
      <div class="lab-layout"><div id="labSim"></div>
        <div class="lab-side"><h3 id="labTitle"></h3><p id="labHow"></p><p class="lesson" id="labLesson"></p>
          <h4 class="eyebrow">Shop this tool</h4><div class="lab-products" id="labProducts"></div></div></div>
    </div></section>`);
    const { products } = await api('/products?sort=popular');
    remember(products);
    let destroy = null;
    const show = (k) => {
      current = k; destroy?.(); destroy = NPI_SIMS.mount($('#labSim'), k);
      const m = NPI_SIMS.META[k];
      $('#labTitle').textContent = m.title; $('#labHow').textContent = m.how; $('#labLesson').textContent = `💡 ${m.lesson}`;
      $$('#labTabs .lab-tab').forEach((t) => t.classList.toggle('active', t.dataset.sim === k));
      const matches = products.filter((p) => p.sim === k).slice(0, 4);
      mount($('#labProducts'), matches.length ? html`${matches.map((p) => html`<a class="lab-product" href="/product/${p.slug}" data-link>${photo(p.images[0], p.name)}<div><div class="lp-name">${p.name}</div><span class="price">${money(p.pricing.price)}</span></div></a>`)}`
        : html`<p class="muted">Matching tools are coming soon.</p>`);
      history.replaceState({}, '', `/lab?tool=${k}`);
    };
    $('#labTabs').addEventListener('click', (e) => { const t = e.target.closest('[data-sim]'); if (t) show(t.dataset.sim); });
    show(current);
    state.cleanup.push(() => destroy?.());
  });

  /* ---------------- PRODUCT ---------------- */
  route(/^\/product\/([a-z0-9-]+)$/, async (app, [slug]) => {
    const { product: p, reviews, related, canReview } = await api(`/products/${encodeURIComponent(slug)}`);
    remember([p, ...related]);
    setTitle(p.name); scrollTop();
    state.recent = [p.id, ...state.recent.filter((x) => x !== p.id)].slice(0, 12);
    NPI.store.set('npi_recent', state.recent);
    const pr = p.pricing;
    const media = [...p.images.map((u) => ({ type: 'img', u })), ...(p.video ? [{ type: 'video', u: p.video }] : [])];
    const stockPct = p.stock.status === 'low' ? Math.max(8, (p.stock.left / 10) * 100) : p.stock.status === 'out' ? 0 : 85;
    const isOwner = state.user?.role === 'owner';
    const max = p.stock.status === 'low' ? p.stock.left : 999;

    mount(app, html`
      <section class="section-tight"><div class="wrap">
        <div class="crumbs"><a href="/" data-link>Home</a> / <a href="/shop" data-link>Shop</a> / ${p.category ? html`<a href="/shop?category=${p.category.slug}" data-link>${p.category.name}</a> / ` : ''}${p.name}</div><br>
        <div class="pdp">
          <div class="pdp-gallery">
            ${p.images.length ? html`<div class="pdp-label">▶ Product video: see it working</div><div class="pdp-video" id="pdpVideo"></div><div class="pdp-label">📷 Photos (${media.length}): hover to magnify</div>` : ''}
            <div id="pdpPhotos">
            <div class="pdp-stage stage-dark" id="pdpStage">
              <div id="pdpView">${p.images.length ? reel(p, { eager: true, tag: '▶ In action' }) : html`<div class="reel"><span class="no-photo">📷</span></div>`}</div>
              <div class="zoom-lens" id="zoomLens"></div>
              ${p.images.length ? html`<button class="watch-btn" type="button" id="watchBtn">▶ Watch it in action</button>` : ''}
              <div class="card-badges">${pr.onSale ? html`<span class="badge ${badgeClass(pr.theme)}">${pr.label || 'Sale'} −${pr.savePercent}%</span>` : ''}</div></div>
            ${media.length > 1 ? html`<div class="thumbs" id="thumbs">${media.map((m, i) => html`<button class="thumb ${i === 0 ? 'active' : ''}" type="button" data-i="${i}" aria-label="View image ${i + 1}">${m.type === 'img' ? html`<img src="${m.u}" alt="" draggable="false">` : html`<span>🎬</span>`}</button>`)}</div>` : ''}
            </div>
          </div>
          <div class="pdp-info">
            <div class="eyebrow">${p.category?.name || ''}${p.sku ? html` · <span class="mono">SKU ${p.sku}</span>` : ''}</div>
            <h1>${p.name}</h1>
            <div class="pdp-meta">
              ${p.rating.count ? html`<a href="#reviews" class="rating" data-tabjump="reviews">${stars(p.rating.avg)} ${p.rating.avg} (${p.rating.count} review${p.rating.count === 1 ? '' : 's'})</a>` : ''}
              ${p.soldThisWeek >= 3 ? html`<span>🔥 ${p.soldThisWeek} sold this week</span>` : ''}
              ${p.sim !== 'none' ? html`<a href="#try" class="link-btn">▶ Try it in 3 seconds</a>` : ''}
            </div>
            <div class="pdp-price-box ${pr.onSale ? 'on-sale' : ''} ${pr.theme === 'jumma' ? 'theme-jumma' : ''}">
              ${priceHTML(pr, true)}
              ${pr.endsInSec ? html`<div class="deal-ends">⏱ ${pr.label} price ends in <span data-countdown="${pr.endsInSec}" data-done="now"></span></div>` : ''}
              ${!pr.onSale && pr.upcoming ? html`<div class="upcoming">🌙 ${pr.upcoming.name} price <b>${money(pr.upcoming.price)}</b> starts in <span data-countdown="${pr.upcoming.startsInSec}" data-done="now!"></span></div>` : ''}
            </div>
            <div class="stock-meter ${p.stock.status}">${stockHTML(p.stock)}<div class="bar"><span data-w="${stockPct}"></span></div></div>
            ${p.bulk ? html`<div class="bulk-hint">📦 <b>Bulk deal:</b> buy <b>${p.bulk.minQty} or more</b> and save an extra <b>${p.bulk.percent}%</b>, applied automatically.</div>` : ''}
            ${p.stock.status !== 'out' ? html`<div class="buy-row" id="buyRow">
              <div class="qty"><button type="button" id="qDec" aria-label="Decrease">−</button><input id="qInput" type="number" min="1" max="${max}" value="1" aria-label="Quantity"><button type="button" id="qInc" aria-label="Increase">+</button></div>
              <button class="btn btn-primary btn-lg" type="button" id="addBtn">Add to cart</button>
              <button class="btn btn-dark btn-lg" type="button" id="buyNow">Buy now</button>
            </div>` : html`<div class="bulk-hint">This tool is out of stock right now. <a href="/contact" data-link>Ask us</a> when it's back, or save it ♡.</div>`}
            <div class="buy-row">
              <button class="btn btn-ghost-dark btn-sm" type="button" data-wish="${p.id}">${state.wish.includes(p.id) ? '♥' : '♡'}</button>
              ${isOwner ? html`<a class="btn btn-green btn-sm" href="/admin#/products/${p.id}">✎ Edit this product</a>` : ''}
            </div>
            <a class="link-btn" href="/finder" data-link>🧭 Not sure it's the right tool? Ask the Tool Finder</a>
            <div class="assure"><div><b>🛡</b>Genuine &amp; warranty</div><div><b>💵</b>Cash on delivery</div><div><b>↩</b>Easy returns</div></div>
            <div>
              <div class="tabs" role="tablist">
                <button class="tab-btn active" role="tab" data-tab="overview">Overview</button>
                <button class="tab-btn" role="tab" data-tab="specs">Specs</button>
                <button class="tab-btn" role="tab" data-tab="uses">Uses</button>
                <button class="tab-btn" role="tab" data-tab="reviews" id="reviews">Reviews (${reviews.length})</button>
              </div>
              <div class="tab-panel" data-panel="overview"><p>${p.description || 'Description coming soon.'}</p></div>
              <div class="tab-panel" data-panel="specs" hidden>${p.specs.length ? html`<table class="specs-table">${p.specs.map((s) => html`<tr><td>${s.label}</td><td>${s.value}</td></tr>`)}</table>` : html`<p class="muted">Specs coming soon.</p>`}</div>
              <div class="tab-panel" data-panel="uses" hidden>${p.uses.length ? html`<ul class="uses-list">${p.uses.map((u) => html`<li>${u}</li>`)}</ul>` : html`<p class="muted">Coming soon.</p>`}</div>
              <div class="tab-panel" data-panel="reviews" hidden>
                ${p.rating.count ? html`<div class="rating-summary"><span class="big">${p.rating.avg}</span><div>${stars(p.rating.avg)}<div class="muted">${p.rating.count} verified review${p.rating.count === 1 ? '' : 's'}</div></div></div>` : html`<p class="muted">No reviews yet. Customers who received this tool can review it here.</p>`}
                ${canReview ? html`<form class="form-card" id="reviewForm"><h4>Write a review</h4><br>
                  <div class="rating-input">${[5, 4, 3, 2, 1].map((n) => html`<input type="radio" name="rating" value="${n}" id="r${n}" ${n === 5 ? 'checked' : ''}><label for="r${n}" title="${n} stars">★</label>`)}</div>
                  <div class="field"><label for="rvBody">Your experience</label><textarea id="rvBody" name="body" maxlength="1000" placeholder="How did the tool perform?"></textarea></div>
                  <button class="btn btn-primary" type="submit">Post review</button></form>` : ''}
                ${reviews.map((r) => html`<div class="review"><div class="review-head"><b>${r.name} <span class="muted">✓ Verified buyer</span></b><span class="muted">${NPI.date(r.createdAt)}</span></div>${stars(r.rating)}${r.body ? html`<p>${r.body}</p>` : ''}</div>`)}
              </div>
            </div>
          </div>
        </div>
        ${p.sim !== 'none' ? html`<div class="try-panel section-dark lab-layout reveal" id="try"><div id="pdpSim"></div>
          <div class="lab-side"><div class="eyebrow">Tool Lab</div><h3>Try the ${NPI_SIMS.META[p.sim]?.title || 'tool'}</h3><p>${NPI_SIMS.META[p.sim]?.how || ''}</p><p class="lesson">💡 ${NPI_SIMS.META[p.sim]?.lesson || ''}</p>
          ${p.stock.status !== 'out' ? html`<button class="btn btn-primary btn-block" type="button" data-add="${p.id}">Like it? Add to cart</button>` : ''}</div></div>` : ''}
      </div></section>
      ${related.length ? html`<section class="section section-white"><div class="wrap">
        <div class="section-head"><div><div class="eyebrow">You may also need</div><h2>Complete the kit.</h2></div></div>
        <div class="grid">${related.map(productCard)}</div></div></section>` : ''}`);

    // product video (default) ↔ photos
    let pdpPlayer = null;
    if ($('#pdpVideo') && (typeof NPI_DEMO !== 'undefined')) {
      NPI_DEMO.create($('#pdpVideo'), p, { mode: 'inline', onBuy: (btn) => addToCart(p, 1, btn) }).then((pl) => { pdpPlayer = pl; });
      state.cleanup.push(() => pdpPlayer?.destroy());
    }
    // gallery: clip player, thumbnails, magnifier lens for close-ups
    const stg = $('#pdpStage');
    const viewReel = () => $('#pdpView .reel');
    let showing = 0;
    const showMedia = (i) => {
      showing = i;
      const m = media[i];
      stopReel(viewReel());
      $$('#thumbs .thumb').forEach((t) => t.classList.toggle('active', Number(t.dataset.i) === i));
      if (m.type === 'video') { mount($('#pdpView'), html`<div class="reel playing-video"><video class="reel-video" src="${m.u}" autoplay muted loop playsinline controls></video></div>`); return; }
      mount($('#pdpView'), html`<div class="reel" data-motion="${p.motion}" data-imgs="${JSON.stringify([m.u, ...p.images.filter((u) => u !== m.u)].slice(0, 4))}"><img class="reel-img is-on" src="${m.u}" alt="${p.name}" draggable="false"><div class="reel-bar"><span></span></div><span class="reel-tag">▶ In action</span></div>`);
    };
    $('#thumbs')?.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) showMedia(Number(b.dataset.i)); });
    $('#watchBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = viewReel(); if (!r) return;
      if (r._playing) { stopReel(r); e.currentTarget.textContent = '▶ Watch it in action'; }
      else { playReel(r); e.currentTarget.textContent = '❚❚ Pause'; }
    });
    // autoplay the clip once when the page opens, so customers immediately see it working

    const lens = $('#zoomLens');
    stg.addEventListener('mousemove', (e) => {
      const r = viewReel(); const img = $('.reel-img.is-on', stg);
      if (!img || r?._playing || e.target.closest('.watch-btn')) { stg.classList.remove('lens-on'); return; }
      const box = img.getBoundingClientRect();
      const x = (e.clientX - box.left) / box.width; const y = (e.clientY - box.top) / box.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) { stg.classList.remove('lens-on'); return; }
      const sr = stg.getBoundingClientRect();
      const scale = 2.6;
      lens.style.backgroundImage = `url("${img.currentSrc || img.src}")`;
      lens.style.backgroundSize = `${box.width * scale}px ${box.height * scale}px`;
      lens.style.backgroundPosition = `${sr.width / 2 - x * box.width * scale}px ${sr.height / 2 - y * box.height * scale}px`;
      stg.classList.add('lens-on');
    });
    stg.addEventListener('mouseleave', () => stg.classList.remove('lens-on'));
    void showing;
    // tabs
    const showTab = (name) => {
      $$('.tab-btn', app).forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
      $$('.tab-panel', app).forEach((pn) => { pn.hidden = pn.dataset.panel !== name; });
    };
    $$('.tab-btn', app).forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
    $$('[data-tabjump]', app).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); showTab(a.dataset.tabjump); $('#reviews').scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
    $$('a[href="#try"]', app).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); $('#try').scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
    // qty & buy
    const qIn = $('#qInput');
    const qty = () => Math.max(1, Math.min(max, Number.parseInt(qIn?.value, 10) || 1));
    $('#qDec')?.addEventListener('click', () => { qIn.value = String(Math.max(1, qty() - 1)); });
    $('#qInc')?.addEventListener('click', () => {
      const n = qty() + 1;
      if (n > max) { toast(`Only ${max} in stock.`, { type: 'warn' }); return; }
      qIn.value = String(n);
      if (p.bulk && n === p.bulk.minQty) toast(`🎉 Bulk discount unlocked: ${p.bulk.percent}% off!`);
    });
    $('#addBtn')?.addEventListener('click', (e) => addToCart(p, qty(), e.currentTarget));
    $('#buyNow')?.addEventListener('click', () => {
      const line = state.cart.find((i) => i.productId === p.id);
      if (line) line.qty = Math.max(line.qty, qty()); else state.cart.push({ productId: p.id, qty: qty() });
      saveCart(); go('/checkout');
    });
    // review
    $('#reviewForm')?.addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.currentTarget; const btn = $('button[type=submit]', f);
      NPI.busy(btn, true);
      try {
        const d = NPI.formData(f);
        await api(`/products/${p.id}/reviews`, { method: 'POST', body: { rating: Number(d.rating), body: d.body } });
        toast('Thank you for your review! ⭐'); render();
      } catch (err) { NPI.showFieldError(f, err); } finally { NPI.busy(btn, false); }
    });
    // simulation, mounted lazily when scrolled near
    if (p.sim !== 'none' && $('#pdpSim')) {
      let destroy = null;
      const io = new IntersectionObserver((ents) => { if (ents[0].isIntersecting) { destroy = NPI_SIMS.mount($('#pdpSim'), p.sim); io.disconnect(); } }, { rootMargin: '200px' });
      io.observe($('#pdpSim'));
      state.cleanup.push(() => { io.disconnect(); destroy?.(); });
    }
    // sticky buy bar once the main buy button scrolls away
    if ($('#buyRow')) {
      const sb = $('#stickyBuy');
      mount(sb, html`<span class="sb-name">${p.name}</span><span class="price">${money(pr.price)}</span><button class="btn btn-primary btn-sm" type="button" id="sbAdd">Add to cart</button>`);
      $('#sbAdd').addEventListener('click', (e) => addToCart(p, qty(), e.currentTarget));
      const io2 = new IntersectionObserver((ents) => {
        const show = !ents[0].isIntersecting && ents[0].boundingClientRect.top < 0;
        sb.classList.toggle('show', show); document.body.classList.toggle('has-sticky-buy', show);
      });
      io2.observe($('#buyRow'));
      state.cleanup.push(() => io2.disconnect());
    }
  });

  /* ---------------- CART PAGE ---------------- */
  route(/^\/cart$/, async (app) => {
    setTitle('Your cart'); scrollTop();
    const draw = async () => {
      if (!state.cart.length) {
        mount(app, html`<section class="section"><div class="wrap"><div class="empty"><div class="no-photo">🛒</div><h3>Your cart is empty</h3><p class="muted">Let's find you something good.</p><a class="btn btn-primary" href="/shop" data-link>Start shopping</a></div></div></section>`);
        return;
      }
      const q = await getQuote();
      mount(app, html`<div class="page-head"><div class="wrap"><div class="eyebrow">Step 1 of 3</div><h1>Your cart</h1></div></div>
        <section class="section-tight"><div class="wrap checkout-layout">
          <div class="form-card">${freeShipHTML(q)}<div id="cartLines">${linesHTML(q)}</div></div>
          <aside class="summary-card"><h3>Order summary</h3>${summaryHTML(q)}
            <a class="btn btn-primary btn-lg btn-block" href="/checkout" data-link>Checkout securely →</a>
            <a class="btn btn-ghost-dark btn-block btn-sm" href="/shop" data-link>Continue shopping</a>
            <div class="secure-note">🔒 Prices are confirmed by our server at checkout</div></aside>
        </div></section>`);
      wireCartLines($('#cartLines'), draw);
    };
    await draw();
  });

  /* ---------------- CHECKOUT ---------------- */
  route(/^\/checkout$/, async (app) => {
    setTitle('Checkout'); scrollTop();
    if (!state.cart.length) { go('/cart', { replace: true }); return; }
    if (!state.user) {
      mount(app, html`<section class="section"><div class="wrap form-narrow"><div class="steps"><span class="done">Cart</span><span class="now">Account</span><span>Details</span></div>
        <div class="form-card center"><h2>Almost there!</h2><p class="muted">Log in or create a free account so you can track your order and reorder in one tap.</p>
        <a class="btn btn-primary btn-lg btn-block" href="/register?next=/checkout" data-link>Create account (30 sec)</a><br>
        <a class="btn btn-ghost-dark btn-block" href="/login?next=/checkout" data-link>I already have an account</a></div></div></section>`);
      return;
    }
    if (state.store.settings.allow_orders !== '1') {
      mount(app, html`<section class="section"><div class="wrap"><div class="empty"><h3>Online ordering is paused</h3><p class="muted">Please call or WhatsApp us to order.</p><a class="btn btn-primary" href="/contact" data-link>Contact us</a></div></div></section>`);
      return;
    }
    const q = await getQuote();
    const saved = NPI.store.get('npi_ship', {});
    const u = state.user;
    mount(app, html`<div class="page-head"><div class="wrap"><div class="eyebrow">Step 3 of 3</div><h1>Checkout</h1></div></div>
      <section class="section-tight"><div class="wrap checkout-layout">
        <form class="form-card" id="coForm" novalidate>
          <div class="steps"><span class="done">Cart</span><span class="done">Account</span><span class="now">Details</span></div>
          <h3>Delivery details</h3><br>
          <div class="field-row">
            <div class="field"><label for="coName">Full name</label><input id="coName" name="name" required maxlength="80" autocomplete="name" value="${saved.name || u.name}"></div>
            <div class="field"><label for="coPhone">Phone / WhatsApp</label><input id="coPhone" name="phone" required maxlength="30" inputmode="tel" autocomplete="tel" placeholder="03xx xxxxxxx" value="${saved.phone || u.phone || ''}"></div>
          </div>
          <div class="field"><label for="coCity">City</label><input id="coCity" name="city" required maxlength="60" autocomplete="address-level2" value="${saved.city || ''}"></div>
          <div class="field"><label for="coAddr">Full address</label><textarea id="coAddr" name="address" required maxlength="300" autocomplete="street-address" placeholder="House / shop no, street, area">${saved.address || ''}</textarea></div>
          <div class="field"><label for="coNotes">Order notes (optional)</label><textarea id="coNotes" name="notes" maxlength="500" placeholder="Landmark, delivery time, company name for invoice…"></textarea></div>
          <h3>Payment</h3><br>
          <div class="pay-options">
            <label class="pay-option"><input type="radio" name="payment" value="cod" checked><div><b>💵 Cash on delivery</b><span>Pay in cash when your tools arrive.</span></div></label>
            <label class="pay-option"><input type="radio" name="payment" value="bank"><div><b>🏦 Bank transfer</b><span>We'll show our account details after you place the order.</span></div></label>
          </div><br>
          <button class="btn btn-primary btn-lg btn-block" type="submit" id="placeBtn">Place order · ${money(q.total)}</button>
          <div class="secure-note">🔒 Your details are sent securely and only used for this delivery.</div>
        </form>
        <aside class="summary-card" id="coSummary"><h3>Your order</h3>${linesHTML(q)}${summaryHTML(q)}</aside>
      </div></section>`);
    $$('#coSummary .qty, #coSummary .line-remove').forEach((n) => n.remove());
    $('#coForm').addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.currentTarget; const btn = $('#placeBtn');
      const d = NPI.formData(f);
      for (const k of ['name', 'phone', 'city', 'address']) {
        if (!d[k].trim()) { NPI.showFieldError(f, { message: 'Please fill in this field.', field: k }); return; }
      }
      NPI.busy(btn, true, 'Placing order…');
      try {
        NPI.store.set('npi_ship', { name: d.name, phone: d.phone, city: d.city, address: d.address });
        const out = await api('/orders', { method: 'POST', body: { ...d, items: state.cart, expectedTotal: state.lastQuote?.total } });
        state.cart = []; saveCart();
        go(`/order/${out.code}?new=1`, { replace: true });
      } catch (err) {
        NPI.busy(btn, false);
        if (err.status === 409) { toast(err.message, { type: 'warn', ms: 6000 }); render(); return; }
        NPI.showFieldError(f, err);
      }
    });
  });

  /* ---------------- ORDER DETAIL ---------------- */
  const STEPS = [['pending', 'Placed', '📝'], ['confirmed', 'Confirmed', '✔'], ['shipped', 'Shipped', '🚚'], ['delivered', 'Delivered', '📦']];
  function trackerHTML(status) {
    if (status === 'cancelled') return html`<p class="status status-cancelled">This order was cancelled</p>`;
    const idx = STEPS.findIndex((s) => s[0] === status);
    return html`<div class="tracker">${STEPS.map(([, label, icon], i) => html`<div class="tracker-step ${i <= idx ? 'done' : ''} ${i === idx ? 'now' : ''}"><div class="dot">${i <= idx ? icon : ''}</div>${label}</div>`)}</div>`;
  }
  function confetti() {
    if (NPI.prefersReducedMotion()) return;
    const colors = ['#FFC72C', '#7AB51D', '#15171A', '#E8B730', '#0F6B4A'];
    for (let i = 0; i < 90; i++) {
      const c = document.createElement('div'); c.className = 'confetti';
      c.style.left = `${Math.random() * 100}vw`; c.style.background = colors[i % colors.length];
      c.style.animationDelay = `${Math.random() * 0.6}s`; c.style.animationDuration = `${2 + Math.random() * 1.6}s`;
      document.body.append(c); setTimeout(() => c.remove(), 4500);
    }
  }
  route(/^\/order\/([A-Z0-9-]+)$/, async (app, [code], query) => {
    const { order: o, bank } = await api(`/orders/${encodeURIComponent(code)}`);
    setTitle(`Order ${o.code}`); scrollTop();
    const isNew = query.get('new') === '1';
    mount(app, html`<section class="section"><div class="wrap form-narrow">
      ${isNew ? html`<div class="success-hero"><div class="check">✓</div><h1>Order placed!</h1><p class="muted">Thank you, ${o.customer.name.split(' ')[0]}! We'll call you on <b>${o.customer.phone}</b> to confirm.</p></div>` : html`<div class="crumbs"><a href="/account/orders" data-link>My orders</a> / ${o.code}</div><br>`}
      <div class="form-card">
        <div class="order-top"><span class="order-code">${o.code}</span><span class="status status-${o.status}">${o.status}</span></div>
        <p class="muted">Placed ${NPI.dateTime(o.createdAt)} · ${o.payment === 'cod' ? 'Cash on delivery' : 'Bank transfer'}</p>
        ${trackerHTML(o.status)}
        ${bank && o.status !== 'cancelled' ? html`<h4>Bank transfer details</h4><div class="bank-box">${bank}\nReference: ${o.code}</div><br>` : ''}
        ${o.items.map((it) => html`<div class="line"><div class="line-img">${photo(it.image)}</div><div>${it.slug ? html`<a class="line-name" href="/product/${it.slug}" data-link>${it.name}</a>` : html`<span class="line-name">${it.name}</span>`}<div class="line-meta">${it.qty} × ${money(it.unit)} ${it.label ? html`· <span class="label">${it.label}</span>` : ''}</div></div><div class="line-right"><span class="line-total">${money(it.lineTotal)}</span></div></div>`)}
        <br>${summaryHTML(o)}
        <br><p class="muted">Deliver to: ${o.customer.address}, ${o.customer.city}</p>
        ${o.status === 'pending' ? html`<button class="btn btn-ghost-dark btn-sm" type="button" id="cancelOrder">Cancel this order</button>` : ''}
      </div><br><a class="btn btn-primary btn-block" href="/shop" data-link>Continue shopping</a>
    </div></section>`);
    if (isNew) { confetti(); history.replaceState({}, '', `/order/${o.code}`); }
    $('#cancelOrder')?.addEventListener('click', async () => {
      if (!await NPI.confirmBox({ title: 'Cancel this order?', text: 'The items will be released back to stock.', ok: 'Yes, cancel', danger: true })) return;
      try { await api(`/orders/${encodeURIComponent(o.code)}/cancel`, { method: 'POST', body: {} }); toast('Order cancelled'); render(); }
      catch (err) { toast(err.message, { type: 'error' }); }
    });
  });

  /* ---------------- AUTH ---------------- */
  function pwStrength(pw) {
    let s = 0;
    if (pw.length >= 8) s++; if (pw.length >= 12) s++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++; if (/\d/.test(pw)) s++; if (/[^A-Za-z0-9]/.test(pw)) s++;
    return s;
  }
  function wirePw(root) {
    $$('.pw-toggle', root).forEach((b) => b.addEventListener('click', () => {
      const i = b.previousElementSibling; i.type = i.type === 'password' ? 'text' : 'password'; b.textContent = i.type === 'password' ? 'Show' : 'Hide';
    }));
    const meter = $('.pw-meter span', root); const inp = $('[data-strength]', root);
    if (meter && inp) {
      inp.addEventListener('input', () => {
        const s = pwStrength(inp.value);
        meter.style.width = `${(s / 5) * 100}%`;
        meter.style.background = ['#D64545', '#D64545', '#C79A1E', '#C79A1E', '#7AB51D', '#5C8A15'][s];
      });
    }
  }
  const safeNext = (q) => { const n = q.get('next') || '/account'; return /^\/[A-Za-z0-9/_?=&-]*$/.test(n) && !n.startsWith('//') ? n : '/account'; };
  async function afterLogin(data, next) {
    state.user = data.user; NPI.setCsrf(data.csrf); updateHeader();
    if (next.startsWith('/admin')) { location.href = '/admin'; return; }
    go(next, { replace: true });
  }

  route(/^\/login$/, async (app, _m, query) => {
    setTitle('Log in'); scrollTop();
    const next = safeNext(query);
    if (state.user) { afterLogin({ user: state.user, csrf: null }, next); return; }
    mount(app, html`<section class="section"><div class="wrap form-narrow">
      <form class="form-card" id="loginForm" novalidate>
        <div class="eyebrow">Welcome back</div><h2>Log in</h2><br>
        <div class="field"><label for="lEmail">Email</label><input id="lEmail" name="email" type="email" required autocomplete="email" maxlength="254"></div>
        <div class="field"><label for="lPw">Password</label><div class="pw-wrap"><input id="lPw" name="password" type="password" required autocomplete="current-password" maxlength="128"><button type="button" class="pw-toggle">Show</button></div></div>
        <button class="btn btn-primary btn-lg btn-block" type="submit">Log in</button>
        <p class="auth-switch">New here? <a href="/register?next=${encodeURIComponent(next)}" data-link>Create a free account</a></p>
      </form></div></section>`);
    wirePw(app);
    $('#lEmail').focus();
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.currentTarget; const btn = $('button[type=submit]', f);
      NPI.busy(btn, true);
      try { await afterLogin(await api('/auth/login', { method: 'POST', body: NPI.formData(f) }), next); toast(`Welcome back, ${state.user.name.split(' ')[0]}!`); }
      catch (err) { NPI.showFieldError(f, err); NPI.busy(btn, false); }
    });
  });

  route(/^\/register$/, async (app, _m, query) => {
    setTitle('Create account'); scrollTop();
    const next = safeNext(query);
    mount(app, html`<section class="section"><div class="wrap form-narrow">
      <form class="form-card" id="regForm" novalidate>
        <div class="eyebrow">Join ${state.store.settings.store_name}</div><h2>Create account</h2>
        <p class="muted">Track orders, save your wishlist and check out faster.</p>
        <div class="field"><label for="rName">Full name</label><input id="rName" name="name" required autocomplete="name" maxlength="80"></div>
        <div class="field"><label for="rEmail">Email</label><input id="rEmail" name="email" type="email" required autocomplete="email" maxlength="254"></div>
        <div class="field"><label for="rPhone">Phone (optional)</label><input id="rPhone" name="phone" inputmode="tel" autocomplete="tel" maxlength="30"></div>
        <div class="field"><label for="rPw">Password</label><div class="pw-wrap"><input id="rPw" name="password" type="password" required autocomplete="new-password" minlength="8" maxlength="128" data-strength><button type="button" class="pw-toggle">Show</button></div>
          <div class="pw-meter"><span></span></div><span class="hint">At least 8 characters with letters and numbers.</span></div>
        <button class="btn btn-primary btn-lg btn-block" type="submit">Create my account</button>
        <p class="auth-switch">Already have an account? <a href="/login?next=${encodeURIComponent(next)}" data-link>Log in</a></p>
      </form></div></section>`);
    wirePw(app);
    $('#regForm').addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.currentTarget; const btn = $('button[type=submit]', f);
      NPI.busy(btn, true);
      try { await afterLogin(await api('/auth/register', { method: 'POST', body: NPI.formData(f) }), next); toast('Account created. Welcome! 🎉'); }
      catch (err) { NPI.showFieldError(f, err); NPI.busy(btn, false); }
    });
  });

  /* ---------------- ACCOUNT ---------------- */
  function accountShell(app, active, content) {
    mount(app, html`<div class="page-head"><div class="wrap"><div class="eyebrow">My account</div><h1>Hi, ${state.user.name.split(' ')[0]}</h1></div></div>
      <section class="section-tight"><div class="wrap account-layout">
        <nav class="account-nav">
          <a href="/account/orders" data-link class="${active === 'orders' ? 'active' : ''}">📦 My orders</a>
          <a href="/account/wishlist" data-link class="${active === 'wishlist' ? 'active' : ''}">♥ Wishlist</a>
          <a href="/account" data-link class="${active === 'profile' ? 'active' : ''}">👤 Profile &amp; password</a>
          ${state.user.role === 'owner' ? html`<a href="/admin">⚙ Owner dashboard</a>` : ''}
          <button type="button" id="logoutBtn">↪ Log out</button>
        </nav>
        <div id="accountMain">${content}</div>
      </div></section>`);
    $('#logoutBtn').addEventListener('click', logout);
  }
  async function logout() {
    try { await api('/auth/logout', { method: 'POST', body: {} }); } catch { /* ignore */ }
    state.user = null; NPI.setCsrf(null); updateHeader(); toast('Logged out. See you soon!'); go('/');
  }

  route(/^\/account$/, async (app) => {
    if (!state.user) { go('/login?next=/account', { replace: true }); return; }
    setTitle('My account'); scrollTop();
    const u = state.user;
    accountShell(app, 'profile', html`
      <form class="form-card" id="profForm" novalidate><h3>Profile</h3><br>
        <div class="field"><label>Email</label><input value="${u.email}" disabled></div>
        <div class="field-row"><div class="field"><label for="pName">Name</label><input id="pName" name="name" maxlength="80" value="${u.name}"></div>
        <div class="field"><label for="pPhone">Phone</label><input id="pPhone" name="phone" maxlength="30" value="${u.phone || ''}"></div></div>
        <button class="btn btn-primary" type="submit">Save profile</button></form><br>
      <form class="form-card" id="pwForm" novalidate><h3>Change password</h3><br>
        <div class="field"><label for="pwCur">Current password</label><div class="pw-wrap"><input id="pwCur" name="current" type="password" autocomplete="current-password"><button type="button" class="pw-toggle">Show</button></div></div>
        <div class="field"><label for="pwNew">New password</label><div class="pw-wrap"><input id="pwNew" name="next" type="password" autocomplete="new-password" data-strength><button type="button" class="pw-toggle">Show</button></div><div class="pw-meter"><span></span></div></div>
        <button class="btn btn-dark" type="submit">Update password</button>
        <p class="hint">Changing your password signs you out on all other devices.</p></form>`);
    wirePw(app);
    $('#profForm').addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.currentTarget;
      try { const r = await api('/auth/profile', { method: 'PUT', body: NPI.formData(f) }); state.user = { ...state.user, ...r.user }; updateHeader(); toast('Profile saved ✓'); }
      catch (err) { NPI.showFieldError(f, err); }
    });
    $('#pwForm').addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.currentTarget;
      try { await api('/auth/change-password', { method: 'POST', body: NPI.formData(f) }); f.reset(); toast('Password updated ✓'); }
      catch (err) { NPI.showFieldError(f, err); }
    });
  });

  route(/^\/account\/orders$/, async (app) => {
    if (!state.user) { go('/login?next=/account/orders', { replace: true }); return; }
    setTitle('My orders'); scrollTop();
    const { orders } = await api('/orders');
    accountShell(app, 'orders', orders.length ? html`${orders.map((o) => html`<a class="order-card" href="/order/${o.code}" data-link>
        <div class="order-top"><span class="order-code">${o.code}</span><span class="status status-${o.status}">${o.status}</span></div>
        <div class="muted">${NPI.date(o.createdAt)} · ${o.items.reduce((a, i) => a + i.qty, 0)} item(s) · <b>${money(o.total)}</b></div>
        <div class="muted">${o.items.map((i) => i.name).join(', ').slice(0, 120)}</div></a>`)}`
      : html`<div class="empty"><div class="no-photo">📦</div><h3>No orders yet</h3><p class="muted">Your orders will appear here.</p><a class="btn btn-primary" href="/shop" data-link>Start shopping</a></div>`);
  });

  route(/^\/account\/wishlist$/, async (app) => {
    setTitle('Wishlist'); scrollTop();
    const { products } = await api('/products');
    remember(products);
    const list = products.filter((p) => state.wish.includes(p.id));
    const content = list.length ? html`<div class="grid">${list.map(productCard)}</div>`
      : html`<div class="empty"><div class="no-photo">♡</div><h3>Nothing saved yet</h3><p class="muted">Tap ♡ on any tool to save it here.</p><a class="btn btn-primary" href="/shop" data-link>Browse tools</a></div>`;
    if (state.user) accountShell(app, 'wishlist', content);
    else mount(app, html`<div class="page-head"><div class="wrap"><h1>Wishlist</h1></div></div><section class="section-tight"><div class="wrap">${content}</div></section>`);
  });

  /* ---------------- ABOUT / CONTACT ---------------- */
  route(/^\/about$/, async (app) => {
    setTitle('About us'); scrollTop();
    const S = state.store.settings;
    mount(app, html`<div class="page-head"><div class="wrap"><div class="eyebrow">About ${S.store_name}</div><h1>Two philosophies. One toolbox.</h1></div></div>
      <section class="section"><div class="wrap"><p class="prose">${S.about_text}</p></div></section>
      <section class="section section-dark"><div class="wrap why-grid">
        <div class="why"><div class="why-icon">🎯</div><h3>Precision</h3><p>Tools that fit the fastener properly, every time.</p></div>
        <div class="why"><div class="why-icon">💪</div><h3>Durability</h3><p>Built for daily site work, not just weekend jobs.</p></div>
        <div class="why"><div class="why-icon">🤝</div><h3>Service</h3><p>Fast quotes, honest advice, quick delivery.</p></div>
      </div></section>`);
  });

  route(/^\/contact$/, async (app) => {
    setTitle('Contact & wholesale'); scrollTop();
    const S = state.store.settings;
    const wa = S.contact_whatsapp?.replace(/[^0-9]/g, '');
    mount(app, html`<div class="page-head"><div class="wrap"><div class="eyebrow">Contact</div><h1>Get a trade quote.</h1><p>Tell us what you need and in what quantity. We reply within one business day.</p></div></div>
      <section class="section"><div class="wrap contact-grid">
        <div class="contact-info">
          ${S.contact_phone ? html`<a href="tel:${S.contact_phone.replace(/[^0-9+]/g, '')}"><span class="ci-icon">📞</span><div><b>Call us</b><div class="mono">${S.contact_phone}</div></div></a>` : ''}
          ${wa ? html`<a href="https://wa.me/${wa}" target="_blank" rel="noopener noreferrer"><span class="ci-icon">💬</span><div><b>WhatsApp</b><div class="mono">${S.contact_whatsapp}</div></div></a>` : ''}
          ${S.contact_email ? html`<a href="mailto:${S.contact_email}"><span class="ci-icon">✉</span><div><b>Email</b><div class="mono">${S.contact_email}</div></div></a>` : ''}
          ${S.address ? html`<div><span class="ci-icon">📍</span><div><b>Visit</b><div>${S.address}</div></div></div>` : ''}
        </div>
        <form class="form-card" id="contactForm" novalidate>
          <div class="field-row"><div class="field"><label for="cName">Your name</label><input id="cName" name="name" required maxlength="80" value="${state.user?.name || ''}"></div>
          <div class="field"><label for="cCompany">Company (optional)</label><input id="cCompany" name="company" maxlength="120"></div></div>
          <div class="field-row"><div class="field"><label for="cEmail">Email</label><input id="cEmail" name="email" type="email" required maxlength="254" value="${state.user?.email || ''}"></div>
          <div class="field"><label for="cPhone">Phone</label><input id="cPhone" name="phone" maxlength="30" inputmode="tel"></div></div>
          <div class="field"><label for="cBody">What do you need?</label><textarea id="cBody" name="body" required maxlength="3000" placeholder="e.g. 50 × 25ft tape measures, 20 × claw hammers, delivered to Lahore"></textarea></div>
          <div class="hp" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></div>
          <button class="btn btn-primary btn-lg btn-block" type="submit">Send enquiry</button>
        </form>
      </div></section>`);
    $('#contactForm').addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.currentTarget; const btn = $('button[type=submit]', f);
      NPI.busy(btn, true);
      try {
        await api('/contact', { method: 'POST', body: NPI.formData(f) });
        mount(f, html`<div class="success-hero"><div class="check">✓</div><h2>Message sent!</h2><p class="muted">Thank you. We'll get back to you within one business day.</p></div>`);
      } catch (err) { NPI.showFieldError(f, err); NPI.busy(btn, false); }
    });
  });

  route(/.*/, async (app) => {
    setTitle('Not found');
    mount(app, html`<section class="section"><div class="wrap"><div class="empty"><div class="no-photo">📏</div><h3>This page is not level</h3><p class="muted">We couldn't find that page.</p><a class="btn btn-primary" href="/" data-link>Go home</a></div></div></section>`);
  });

  /* ============================================================
     header: search suggestions, account, owner shortcut
     ============================================================ */
  function highlight(text, q) {
    const terms = q.trim().split(/\s+/).filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!terms.length) return text;
    const re = new RegExp(`(${terms.join('|')})`, 'ig');
    return text.split(re).map((part, i) => (i % 2 ? html`<mark>${part}</mark>` : part));
  }
  (function search() {
    const input = $('#searchInput'); const box = $('#suggestBox');
    let timer = null; let seq = 0; let hl = -1;
    const close = () => { box.hidden = true; hl = -1; };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { close(); return; }
      timer = setTimeout(async () => {
        const my = ++seq;
        try {
          const { products, total } = await api(`/products?q=${encodeURIComponent(q)}&limit=6`);
          if (my !== seq) return;
          remember(products);
          mount(box, products.length
            ? html`${products.map((p) => html`<a href="/product/${p.slug}" data-link role="option">${visual(p)}<div><div class="s-name">${highlight(p.name, q)}</div><div class="s-price">${money(p.pricing.price)}${p.pricing.onSale ? ` · −${p.pricing.savePercent}%` : ''}</div></div></a>`)}
              <a class="s-all" href="/shop?q=${encodeURIComponent(q)}" data-link>See all ${total} result${total === 1 ? '' : 's'} →</a>`
            : html`<a class="s-all" href="/shop" data-link>No matches. Browse all tools →</a>`);
          box.hidden = false; hl = -1;
        } catch { close(); }
      }, 180);
    });
    input.addEventListener('keydown', (e) => {
      const items = $$('a', box);
      if (box.hidden || !items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        hl = (hl + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach((a, i) => a.classList.toggle('hl', i === hl));
      } else if (e.key === 'Enter' && hl >= 0) { e.preventDefault(); items[hl].click(); close(); }
      else if (e.key === 'Escape') close();
    });
    box.addEventListener('click', () => { close(); input.blur(); });
    document.addEventListener('click', (e) => { if (!e.target.closest('#searchForm')) close(); });
    $('#searchForm').addEventListener('submit', (e) => {
      e.preventDefault(); close();
      const q = input.value.trim();
      go(q ? `/shop?q=${encodeURIComponent(q)}` : '/shop');
    });
  })();

  function updateHeader() {
    const u = state.user;
    $('#accountBtn').href = u ? '/account/orders' : '/login';
    $('#accountLbl').textContent = u ? u.name.split(' ')[0] : 'Log in';
    $('#ownerBtn').hidden = u?.role !== 'owner';
  }

  function applyStoreChrome() {
    const S = state.store.settings;
    NPI.setCurrency(S.currency);
    $('#brandName').textContent = S.store_name.toUpperCase();
    $('#brandTag').textContent = S.tagline;
    $('#footName').textContent = S.store_name;
    $('#copy').textContent = `© ${new Date().getFullYear()} ${S.store_name}. All rights reserved.`;
    $('#footContact').textContent = [S.contact_phone, S.contact_email].filter(Boolean).join(' · ');
    const live = state.store.promotions.filter((p) => p.live);
    const an = $('#announce');
    const jumma = live.find((p) => p.theme === 'jumma') || live[0];
    if (jumma) {
      mount(an, html`🟢 <b>${jumma.name} is live!</b> ${jumma.discount_type === 'percent' ? `${jumma.value}% off` : `${money(jumma.value)} off`}, ends in <b data-countdown="${jumma.endsInSec}" data-done="now"></b> · <a href="/deals" data-link>Shop the deal →</a>`);
      an.classList.toggle('jumma-live', jumma.theme === 'jumma'); an.hidden = false;
      NPI.startCountdowns(an);
      if (!$('#navDeals .dot')) $('#navDeals').insertAdjacentHTML('beforeend', '<span class="dot" aria-label="live deal"></span>');
    } else if (S.announcement) { an.textContent = S.announcement; an.hidden = false; }
    const wa = S.contact_whatsapp?.replace(/[^0-9]/g, '');
    if (wa) { $('#waFloat').href = `https://wa.me/${wa}`; $('#waFloat').hidden = false; }
  }

  /* ---------- chrome interactions ---------- */
  $('#cartBtn').addEventListener('click', openDrawer);
  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#drawerBackdrop').addEventListener('click', closeDrawer);
  wireCartLines($('#drawerBody'), renderDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  $('#menuToggle').addEventListener('click', () => {
    const n = $('#mainNav'); n.classList.toggle('open');
    $('#menuToggle').setAttribute('aria-expanded', String(n.classList.contains('open')));
  });
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => {
      const h = document.documentElement;
      $('#scrollProgress').style.width = `${(h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight)) * 100}%`;
      $('#siteHeader').classList.toggle('scrolled', h.scrollTop > 10);
      ticking = false;
    });
  }, { passive: true });
  // a deal started or ended while the page is open: refresh prices once
  let refreshing = false;
  document.addEventListener('countdown-end', async () => {
    if (refreshing) return; refreshing = true;
    setTimeout(async () => {
      try { state.store = await api('/store'); applyStoreChrome(); await render(); } finally { refreshing = false; }
    }, 1500);
  });
  // keep cart in sync across tabs
  window.addEventListener('storage', (e) => { if (e.key === 'npi_cart') { state.cart = NPI.store.get('npi_cart', []); updateCartCount(); } });

  /* ---------- boot ---------- */
  (async function boot() {
    try {
      const [me, store] = await Promise.all([api('/auth/me'), api('/store')]);
      state.user = me.user; NPI.setCsrf(me.csrf); state.store = store;
      applyStoreChrome(); updateHeader(); updateCartCount();
      await render();
    } catch (err) {
      mount($('#app'), html`<section class="section"><div class="wrap"><div class="empty"><h3>Can't reach the store</h3><p class="muted">${err.message}</p><button class="btn btn-primary" type="button" id="retry">Try again</button></div></div></section>`);
      $('#retry')?.addEventListener('click', () => location.reload());
    }
  })();
})();
