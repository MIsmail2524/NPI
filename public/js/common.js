/* ============================================================
   Shared browser toolkit (storefront + owner dashboard)
   - html`` tagged template: every ${value} is HTML-escaped unless
     it is itself an html`` result. This makes XSS from product
     names, reviews, messages etc. impossible by construction.
   - api(): fetch wrapper that sends the CSRF token.
   ============================================================ */
'use strict';

const NPI = (() => {
  /* ---------------- safe templating ---------------- */
  class SafeHTML { constructor(s) { this.s = s; } toString() { return this.s; } }
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  const esc = (v) => String(v).replace(/[&<>"'`]/g, (c) => ESC[c]);
  const render = (v) => {
    if (v instanceof SafeHTML) return v.s;
    if (Array.isArray(v)) return v.map(render).join('');
    if (v === null || v === undefined || v === false) return '';
    return esc(v);
  };
  function html(strings, ...vals) {
    let out = '';
    strings.forEach((s, i) => { out += s; if (i < vals.length) out += render(vals[i]); });
    return new SafeHTML(out);
  }
  /** Trusted static markup only (icons shipped with the site). Never pass user data. */
  const trusted = (s) => new SafeHTML(s);

  function mount(el, content) {
    if (typeof el === 'string') el = document.querySelector(el);
    if (!el) return null;
    if (!(content instanceof SafeHTML)) throw new Error('mount() requires html`` content');
    el.innerHTML = content.s;
    applyDynamic(el);
    return el;
  }
  /** CSP blocks inline style="" — dynamic widths/colours are applied through the CSSOM instead. */
  function applyDynamic(root) {
    root.querySelectorAll('[data-w]').forEach((n) => { n.style.width = `${Math.max(0, Math.min(100, Number(n.dataset.w)))}%`; });
    root.querySelectorAll('[data-h]').forEach((n) => { n.style.height = `${Math.max(0, Math.min(100, Number(n.dataset.h)))}%`; });
    root.querySelectorAll('[data-delay]').forEach((n) => { n.style.animationDelay = `${Number(n.dataset.delay) || 0}ms`; });
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /* ---------------- API ---------------- */
  let csrf = null;
  const setCsrf = (t) => { csrf = t; };

  async function api(path, { method = 'GET', body, form } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
    let res;
    try {
      res = await fetch(`/api${path}`, {
        method, headers, credentials: 'same-origin',
        body: form || (body !== undefined ? JSON.stringify(body) : undefined)
      });
    } catch {
      throw Object.assign(new Error('Network problem — check your internet connection.'), { status: 0 });
    }
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      const err = new Error(data?.error || `Request failed (${res.status})`);
      err.status = res.status; err.data = data; err.field = data?.field;
      throw err;
    }
    return data;
  }

  /* ---------------- money & formatting ---------------- */
  let currency = 'Rs.';
  const setCurrency = (c) => { currency = c || 'Rs.'; };
  const nf0 = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function money(minor) {
    const n = (Number(minor) || 0) / 100;
    return `${currency} ${Number.isInteger(n) ? nf0.format(n) : nf2.format(n)}`;
  }
  /** "1,499.50" → 149950 (minor units). Returns null for empty, NaN for invalid. */
  function parseMoney(str) {
    const s = String(str ?? '').replace(/[^0-9.]/g, '');
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
  }
  const toMajor = (minor) => (minor === null || minor === undefined ? '' : String((Number(minor) / 100)));

  function duration(sec) {
    sec = Math.max(0, Math.floor(sec));
    const d = Math.floor(sec / 86400); const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60); const s = sec % 60;
    const p = (n) => String(n).padStart(2, '0');
    return d > 0 ? `${d}d ${p(h)}h ${p(m)}m` : `${p(h)}:${p(m)}:${p(s)}`;
  }
  const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const dateTimeFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const date = (ms) => dateFmt.format(new Date(ms));
  const dateTime = (ms) => dateTimeFmt.format(new Date(ms));
  function ago(ms) {
    const s = (Date.now() - ms) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
    return date(ms);
  }
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  /* ---------------- live countdowns ----------------
     <span data-countdown="SECONDS" data-done="text"></span> ticks down every second. */
  let cdTimer = null;
  function startCountdowns(root = document) {
    const base = performance.now();
    $$('[data-countdown]', root).forEach((el) => {
      el._cdEnd = base + Number(el.dataset.countdown) * 1000;
      el.removeAttribute('data-countdown');
      el.classList.add('cd-live');
    });
    if (!cdTimer) {
      const tick = () => {
        const now = performance.now();
        $$('.cd-live').forEach((el) => {
          if (!el._cdEnd) return;
          const left = (el._cdEnd - now) / 1000;
          if (left <= 0) {
            el.textContent = el.dataset.done || '00:00:00';
            el.classList.remove('cd-live');
            el.dispatchEvent(new CustomEvent('countdown-end', { bubbles: true }));
          } else {
            el.textContent = duration(left);
          }
        });
      };
      tick();
      cdTimer = setInterval(tick, 1000);
    }
  }

  /* ---------------- toast ---------------- */
  function toast(msg, { type = 'ok', action, onAction, ms = 3200 } = {}) {
    let wrap = $('#toasts');
    if (!wrap) { wrap = document.createElement('div'); wrap.id = 'toasts'; wrap.setAttribute('aria-live', 'polite'); document.body.append(wrap); }
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    const span = document.createElement('span');
    span.textContent = msg;
    t.append(span);
    if (action) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = action; b.className = 'toast-action';
      b.addEventListener('click', () => { onAction?.(); t.remove(); });
      t.append(b);
    }
    wrap.append(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
  }

  /* ---------------- confirm dialog (accessible, keyboard friendly) ---------------- */
  function confirmBox({ title, text, ok = 'Yes', cancel = 'Cancel', danger = false }) {
    return new Promise((resolve) => {
      const d = document.createElement('dialog');
      d.className = 'confirm-dialog';
      mount(d, html`<form method="dialog">
        <h3>${title}</h3>${text ? html`<p>${text}</p>` : ''}
        <div class="confirm-actions">
          <button value="cancel" class="btn btn-ghost-dark" type="submit">${cancel}</button>
          <button value="ok" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="submit" autofocus>${ok}</button>
        </div></form>`);
      document.body.append(d);
      d.addEventListener('close', () => { resolve(d.returnValue === 'ok'); d.remove(); });
      d.showModal();
    });
  }

  /* ---------------- form helpers ---------------- */
  function formData(form) {
    const out = {};
    for (const el of form.elements) {
      if (!el.name || el.disabled) continue;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else out[el.name] = el.value;
    }
    return out;
  }
  function showFieldError(form, err) {
    $$('.field-error', form).forEach((n) => n.remove());
    $$('.has-error', form).forEach((n) => n.classList.remove('has-error'));
    const field = err.field && form.elements[err.field];
    const msg = document.createElement('div');
    msg.className = 'field-error';
    msg.textContent = err.message;
    if (field && field.closest) {
      const wrap = field.closest('.field') || field.parentElement;
      wrap.classList.add('has-error');
      wrap.append(msg);
      field.focus();
    } else {
      form.prepend(msg);
    }
  }
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.classList.add('is-busy'); if (label) btn.textContent = label; }
    else { btn.disabled = false; btn.classList.remove('is-busy'); if (btn.dataset.label) btn.textContent = btn.dataset.label; }
  }

  const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }
  };

  return {
    html, trusted, mount, applyDynamic, esc, $, $$, api, setCsrf, money, parseMoney, toMajor, setCurrency,
    duration, date, dateTime, ago, DAYS, startCountdowns, toast, confirmBox, formData, showFieldError, busy,
    prefersReducedMotion, store, SafeHTML
  };
})();
