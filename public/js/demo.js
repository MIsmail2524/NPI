/* ============================================================
   NPI Product Demo Engine
   Real-time "product videos" built from the real product photos.
   Every frame is a pure function of time, so videos can be
   played, paused and scrubbed like a normal video player.

   Chapters:  intro → close-ups (specs) → working demo → uses → buy
   The working demo depends on product.demo.type (see SCENES).
   ============================================================ */
'use strict';

const NPI_DEMO = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 1600; const H = 900;
  let UID = 0;

  /* ---------------- maths & easing ---------------- */
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  const easeOut = (t) => 1 - (1 - t) ** 3;
  const easeIn = (t) => t * t * t;
  const backOut = (t) => { const c = 1.7; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
  const pulse = (t, a, b) => Math.sin(seg(t, a, b) * Math.PI); // 0→1→0
  const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const deg = (r) => (r * 180) / Math.PI;
  const rad = (d) => (d * Math.PI) / 180;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------- svg helpers ---------------- */
  function el(tag, attrs = {}, parent = null) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
    if (parent) parent.append(n);
    return n;
  }
  /** Static, trusted SVG markup (props drawn by us). Never pass user data here. */
  function svgFrag(parent, markup) {
    const g = el('g', {}, parent);
    g.innerHTML = markup;
    return g;
  }
  const tf = (x, y, r = 0, s = 1, sx = 1, sy = 1) => `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${r.toFixed(3)}) scale(${(s * sx).toFixed(4)} ${(s * sy).toFixed(4)})`;

  function loadImg(url) {
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve({ url, w: im.naturalWidth || 1, h: im.naturalHeight || 1 });
      im.onerror = () => resolve(null);
      im.src = url;
    });
  }

  /* ---------------- actors: the real product photo ---------------- */
  function Actor(parent, img, height, cls = '') {
    const h = height; const w = h * (img.w / img.h);
    const g = el('g', { class: `actor ${cls}` }, parent);
    el('image', { href: img.url, x: -w / 2, y: -h / 2, width: w, height: h, preserveAspectRatio: 'none' }, g);
    const st = { x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1, o: 1 };
    const A = {
      g, w, h, st,
      local: (u, v) => [(u - 0.5) * w, (v - 0.5) * h],
      set(p) {
        Object.assign(st, p);
        g.setAttribute('transform', tf(st.x, st.y, st.r, st.s, st.sx, st.sy));
        g.setAttribute('opacity', st.o);
        return A;
      },
      /** world position of a point given in photo coordinates (0..1) */
      world(u, v, s = st) {
        const [lx, ly] = A.local(u, v);
        const a = rad(s.r); const k = s.s;
        const x = lx * k * (s.sx ?? 1); const y = ly * k * (s.sy ?? 1);
        return [s.x + x * Math.cos(a) - y * Math.sin(a), s.y + x * Math.sin(a) + y * Math.cos(a)];
      },
      /** place so that photo point (u,v) lands on world (wx,wy) */
      pin(u, v, wx, wy, p = {}) {
        const s = { ...st, ...p, x: 0, y: 0 };
        const [px, py] = A.world(u, v, s);
        return A.set({ ...p, x: wx - px, y: wy - py });
      }
    };
    return A;
  }

  /** A tool split at its hinge so it can really open and close.
      mode 'cross' (pliers: jaws cross handles), 'side' (left/right halves), 'lever' (one handle moves). */
  function Hinge(parent, img, height, pivot, mode = 'cross', leverSide = 'right') {
    const A = Actor(parent, img, height);
    const image = A.g.querySelector('image');
    image.remove();
    const id = `h${++UID}`;
    const { w, h } = A;
    const [px, py] = A.local(pivot[0], pivot[1]);
    const L = -w * 2; const R = w * 2; const T = -h * 2; const B = h * 2;
    const defs = el('defs', {}, A.g);
    const rect = (cp, x1, y1, x2, y2) => el('rect', { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }, cp);
    const cpA = el('clipPath', { id: `${id}a` }, defs); const cpB = el('clipPath', { id: `${id}b` }, defs);
    if (mode === 'cross') { rect(cpA, L, T, px, py); rect(cpA, px, py, R, B); rect(cpB, px, T, R, py); rect(cpB, L, py, px, B); }
    else if (mode === 'side') { rect(cpA, L, T, px, B); rect(cpB, px, T, R, B); }
    else { // lever: B is the moving handle below the pivot on leverSide
      rect(cpA, L, T, R, py);
      if (leverSide === 'right') { rect(cpA, L, py, px, B); rect(cpB, px, py, R, B); }
      else { rect(cpA, px, py, R, B); rect(cpB, L, py, px, B); }
    }
    const armA = el('g', {}, A.g); const armB = el('g', {}, A.g);
    const mk = (g, c) => { const gg = el('g', { 'clip-path': `url(#${c})` }, g); el('image', { href: img.url, x: -w / 2, y: -h / 2, width: w, height: h, preserveAspectRatio: 'none' }, gg); };
    mk(armA, `${id}a`); mk(armB, `${id}b`);
    A.open = (deg_) => {
      if (mode === 'lever') { armA.setAttribute('transform', ''); armB.setAttribute('transform', `rotate(${(leverSide === 'right' ? 1 : -1) * deg_} ${px} ${py})`); }
      else { armA.setAttribute('transform', `rotate(${-deg_} ${px} ${py})`); armB.setAttribute('transform', `rotate(${deg_} ${px} ${py})`); }
      return A;
    };
    A.open(0);
    return A;
  }

  /** camera path: keyframes [[t, x, y, zoom], ...] eased between */
  function camPath(keys) {
    return (t) => {
      let a = keys[0]; let b = keys[keys.length - 1];
      for (let i = 0; i < keys.length - 1; i++) if (t >= keys[i][0] && t <= keys[i + 1][0]) { a = keys[i]; b = keys[i + 1]; break; }
      if (t > keys[keys.length - 1][0]) a = b = keys[keys.length - 1];
      const k = a === b ? 0 : ease(seg(t, a[0], b[0]));
      return { x: lerp(a[1], b[1], k), y: lerp(a[2], b[2], k), z: lerp(a[3], b[3], k) };
    };
  }
  /** the real product, shown as a framed card when the scene uses drawn machinery */
  function productCard(g, c, x = 230, y = 200, h = 260) {
    const card = el('g', { transform: `translate(${x} ${y})` }, g);
    el('rect', { x: -h * 0.55, y: -h * 0.55, width: h * 1.1, height: h * 1.25, rx: 18, fill: '#15171A', stroke: '#FFC72C', 'stroke-width': 3, opacity: 0.92 }, card);
    const a = Actor(card, c.actorImg, h * 0.8); a.set({ x: 0, y: -h * 0.06 });
    if (a.w > h) a.set({ s: h / a.w });
    const t = el('text', { x: 0, y: h * 0.6, 'text-anchor': 'middle', 'font-family': 'Barlow Condensed, sans-serif', 'font-size': 24, 'font-weight': 700, fill: '#FFC72C', 'letter-spacing': 1 }, card);
    t.textContent = 'THIS PRODUCT';
    return card;
  }

  /* ---------------- particles (deterministic → scrubbable) ---------------- */
  function Particles(parent, n, draw) {
    const g = el('g', {}, parent);
    const items = Array.from({ length: n }, (_, i) => draw(g, i));
    return {
      g,
      /** fn(i) → {x,y,r?,o,s?} or null to hide */
      update(fn) { items.forEach((it, i) => { const p = fn(i); if (!p || p.o <= 0) { it.setAttribute('opacity', 0); return; } it.setAttribute('opacity', p.o); it.setAttribute('transform', tf(p.x, p.y, p.r || 0, p.s || 1)); }); }
    };
  }
  /** burst helper: particle i spawned at time i*every from (ox,oy) with velocity, gravity; returns state at t */
  function flyer(i, t, { t0 = 0, every = 0.05, life = 0.8, ox, oy, sp = 400, angle = -90, spread = 60, g = 900 }) {
    const born = t0 + i * every; const age = t - born;
    if (age < 0 || age > life) return null;
    const a = rad(angle + (rnd(i) - 0.5) * spread); const v = sp * (0.5 + rnd(i + 9));
    return { x: ox + Math.cos(a) * v * age, y: oy + Math.sin(a) * v * age + 0.5 * g * age * age, r: rnd(i + 3) * 720 * age, o: 1 - age / life };
  }

  /* ---------------- shared defs (gradients, patterns, filters) ---------------- */
  function defsMarkup(id) {
    return `
    <linearGradient id="${id}-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9a866"/><stop offset="1" stop-color="#a8733a"/></linearGradient>
    <pattern id="${id}-grain" width="220" height="40" patternUnits="userSpaceOnUse"><path d="M0 10 C60 4 120 18 220 9 M0 28 C80 22 150 36 220 27" stroke="#8a5a26" stroke-opacity=".35" fill="none" stroke-width="2"/></pattern>
    <linearGradient id="${id}-steel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9edf1"/><stop offset=".45" stop-color="#9aa3ab"/><stop offset=".55" stop-color="#c7cdd3"/><stop offset="1" stop-color="#6f7880"/></linearGradient>
    <linearGradient id="${id}-steelh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6f7880"/><stop offset=".4" stop-color="#e9edf1"/><stop offset=".6" stop-color="#b9c0c7"/><stop offset="1" stop-color="#5c646b"/></linearGradient>
    <linearGradient id="${id}-gold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8a6a1c"/><stop offset=".45" stop-color="#f2d27a"/><stop offset="1" stop-color="#7a5a12"/></linearGradient>
    <linearGradient id="${id}-copper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3b27a"/><stop offset=".5" stop-color="#c46a2b"/><stop offset="1" stop-color="#8a4314"/></linearGradient>
    <linearGradient id="${id}-concrete" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9b6ae"/><stop offset="1" stop-color="#8e8b84"/></linearGradient>
    <pattern id="${id}-speck" width="60" height="60" patternUnits="userSpaceOnUse"><circle cx="8" cy="12" r="2" fill="#6d6a63" opacity=".5"/><circle cx="40" cy="30" r="1.5" fill="#55524c" opacity=".5"/><circle cx="22" cy="48" r="2.5" fill="#7a776f" opacity=".4"/></pattern>
    <linearGradient id="${id}-tile" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f1ea"/><stop offset="1" stop-color="#d9d3c6"/></linearGradient>
    <radialGradient id="${id}-spot" cx=".5" cy=".42" r=".6"><stop offset="0" stop-color="#3a3f45"/><stop offset=".55" stop-color="#22262a"/><stop offset="1" stop-color="#121416"/></radialGradient>
    <radialGradient id="${id}-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFC72C" stop-opacity=".55"/><stop offset="1" stop-color="#FFC72C" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}-spark" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff7c2"/><stop offset=".4" stop-color="#ffb02e"/><stop offset="1" stop-color="#ff5a00" stop-opacity="0"/></radialGradient>
    <linearGradient id="${id}-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2f34"/><stop offset="1" stop-color="#16181b"/></linearGradient>
    <filter id="${id}-ds" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="18" stdDeviation="16" flood-color="#000" flood-opacity=".55"/></filter>
    <filter id="${id}-blur"><feGaussianBlur stdDeviation="6"/></filter>
    <filter id="${id}-mblur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3 0"/></filter>`;
  }

  /* ============================================================
     PROPS: drawn scenery the real products work on
     ============================================================ */
  const P = {
    bench(g, id, y = 700) {
      return svgFrag(g, `<rect x="-400" y="${y}" width="2400" height="${H - y + 400}" fill="url(#${id}-floor)"/><rect x="-400" y="${y}" width="2400" height="4" fill="#3d4248"/>`);
    },
    wood(g, id, x, y, w, h) {
      return svgFrag(g, `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="url(#${id}-wood)"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="url(#${id}-grain)"/><rect x="${x}" y="${y}" width="${w}" height="6" fill="#e9bd80" opacity=".7"/>`);
    },
    concrete(g, id, x, y, w, h) {
      return svgFrag(g, `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id}-concrete)"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id}-speck)"/>`);
    },
    steelPlate(g, id, x, y, w, h, tint = '') {
      return svgFrag(g, `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id}-steel)"/>${tint ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${tint}" opacity=".18"/>` : ''}<rect x="${x}" y="${y}" width="${w}" height="3" fill="#fff" opacity=".6"/>`);
    },
    hexNut(g, id, r, rounded = false) {
      const pts = Array.from({ length: 6 }, (_, i) => { const a = rad(60 * i + 30); return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`; }).join(' ');
      return svgFrag(g, `<polygon points="${pts}" fill="url(#${id}-steel)" stroke="#4a5158" stroke-width="3" ${rounded ? 'stroke-linejoin="round"' : ''}/><circle r="${r * 0.48}" fill="#3b4147"/><circle r="${r * 0.36}" fill="#59616a"/>`);
    },
    label(g, x, y, text, { size = 30, fill = '#fff', anchor = 'middle', weight = 700, family = 'Barlow Condensed' } = {}) {
      const t = el('text', { x, y, 'text-anchor': anchor, 'font-family': `${family}, sans-serif`, 'font-size': size, 'font-weight': weight, fill }, g);
      t.textContent = text;
      return t;
    }
  };

  /* ============================================================
     SCENES — the working demos. Each returns
     { dur, captions:[[t,text]], sfx:[[t,name]], render(t) }
     ctx: { g (world group), id, actorImg (main photo), imgs, product, demo, specs, hasSpec(re) }
     ============================================================ */
  const SCENES = {};

  /* ---------- screwdriver: drive a screw into wood, top-view inset ---------- */
  SCENES.screwdriver = (c) => {
    const { g, id } = c;
    P.bench(g, id, 760);
    const screw = el('g', {}, g);
    const shank = svgFrag(screw, `<clipPath id="${id}-sc"><rect x="-13" y="0" width="26" height="190"/></clipPath>
      <rect x="-13" y="0" width="26" height="170" fill="url(#${id}-steelh)"/><path d="M-13 170 L0 200 L13 170 Z" fill="#9aa3ab"/>
      <g clip-path="url(#${id}-sc)"><g class="thr">${Array.from({ length: 16 }, (_, i) => `<path d="M-14 ${i * 14 - 14} L14 ${i * 14 - 4}" stroke="#555d64" stroke-width="3"/>`).join('')}</g></g>`);
    const thr = shank.querySelector('.thr');
    const head = svgFrag(screw, `<path d="M-34 -14 L34 -14 L22 6 L-22 6 Z" fill="url(#${id}-steelh)" stroke="#4a5158" stroke-width="2"/><rect x="-34" y="-18" width="68" height="6" rx="3" fill="#dfe4e8"/>`);
    void head;
    P.wood(g, id, 470, 540, 660, 220);
    const dust = Particles(g, 36, (pg) => el('circle', { r: 4, fill: '#e6c08a' }, pg));
    const isPh = c.hasSpec(/phillips/i) && !c.hasSpec(/slotted|flat/i);
    const both = c.hasSpec(/slotted.*phillips|phillips.*slotted|2-way|2 way/i);
    const actor = Actor(g, c.actorImg, 560); actor.g.setAttribute('filter', `url(#${id}-ds)`);
    // turning arrow
    const arrow = svgFrag(g, `<path d="M-70 0 A70 22 0 1 0 70 0" fill="none" stroke="#FFC72C" stroke-width="6" stroke-dasharray="14 12" stroke-linecap="round"/><path d="M70 0 l-18 -14 l2 22 z" fill="#FFC72C"/>`);
    // top-view inset
    const inset = svgFrag(g, `<g transform="translate(1340 250)"><circle r="128" fill="#15171A" stroke="#FFC72C" stroke-width="4"/>
      <text y="-92" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-size="22" font-weight="700" fill="#FFC72C">TOP VIEW</text>
      <g class="sh"><circle r="70" fill="url(#${id}-steel)" stroke="#4a5158" stroke-width="3"/>
      ${isPh || both ? '<rect x="-46" y="-9" width="92" height="18" rx="4" fill="#2b3035"/><rect x="-9" y="-46" width="18" height="92" rx="4" fill="#2b3035"/>' : '<rect x="-52" y="-9" width="104" height="18" rx="4" fill="#2b3035"/>'}</g>
      <text y="104" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="22" fill="#fff" class="turns">0.0 turns</text></g>`);
    const sh = inset.querySelector('.sh'); const turnsTxt = inset.querySelector('.turns');
    const tip = c.demo.tip || [0.5, 0.0];
    const flush = P.label(g, 800, 470, 'FLUSH ✓', { size: 64, fill: '#7AB51D', family: 'Archivo Black' });
    return {
      camera: camPath([[0, 800, 330, 0.82], [1.3, 800, 350, 0.9], [6.8, 800, 470, 1.25], [9, 800, 470, 1.3]]),
      dur: 9,
      captions: [[0, 'Seat the tip squarely in the screw head'], [1.3, 'Turn clockwise: the grip turns hand power into torque'],
        [4.2, c.hasSpec(/insulat/i) ? 'Insulated shaft: protection when working near live wires' : 'Hardened tip bites in and resists cam-out'], [7.2, 'Driven flush and tight ✓']],
      sfx: [[1.4, 'ratchet'], [2.6, 'ratchet'], [3.8, 'ratchet'], [5, 'ratchet'], [6.2, 'ratchet'], [7.2, 'ding']],
      render(t) {
        const drive = ease(seg(t, 1.3, 7.0));
        const depth = drive * 150;
        const turns = drive * 7;
        const headY = 390 + depth;
        screw.setAttribute('transform', `translate(800 ${headY})`);
        thr.setAttribute('transform', `translate(0 ${((turns * 14) % 14).toFixed(1)})`);
        const desc = easeOut(seg(t, 0, 1.2));
        const ph = turns * Math.PI * 2;
        actor.pin(tip[0], tip[1], 800, headY - 18 - (1 - desc) * 260, { r: 180, s: 1, sx: 0.78 + 0.22 * Math.abs(Math.cos(ph)) });
        actor.set({ o: seg(t, 0, 0.3) });
        const [hx, hy] = actor.world(0.5, 0.82);
        arrow.setAttribute('transform', `translate(${hx} ${hy})`);
        arrow.setAttribute('opacity', drive > 0 && drive < 1 ? 1 : 0);
        sh.setAttribute('transform', `rotate(${deg(ph).toFixed(1)})`);
        turnsTxt.textContent = `${turns.toFixed(1)} turns`;
        inset.setAttribute('opacity', seg(t, 1, 1.6));
        dust.update((i) => (drive > 0.05 && drive < 1 ? flyer(i, t, { t0: 1.4, every: 0.15, life: 0.9, ox: 800 + (rnd(i) - 0.5) * 50, oy: 540, sp: 260, angle: -90, spread: 120, g: 700 }) : null));
        flush.setAttribute('opacity', seg(t, 7.1, 7.5));
        flush.setAttribute('transform', `translate(0 ${(1 - backOut(seg(t, 7.1, 7.6))) * 20})`);
      }
    };
  };

  /* ---------- reversible 2-way blade: pull, flip, push ---------- */
  SCENES.flip = (c) => {
    const { g, id } = c;
    const f = c.demo.flip; // { handle: imgIdx, rod: imgIdx }
    const handle = Actor(g, c.imgs[f.handle] || c.actorImg, 420); handle.g.setAttribute('filter', `url(#${id}-ds)`);
    const rodImg = c.imgs[f.rod] || c.actorImg;
    const rod = Actor(g, rodImg, 620);
    g.insertBefore(rod.g, handle.g);
    const lab1 = P.label(g, 0, 0, 'SLOTTED', { size: 30, fill: '#FFC72C' });
    const lab2 = P.label(g, 0, 0, 'PHILLIPS', { size: 30, fill: '#7AB51D' });
    return {
      dur: 5,
      captions: [[0, 'Two drivers in one handle'], [0.8, 'Pull the blade out…'], [1.8, '…flip it end-for-end…'], [3.1, '…and push it back: slotted ⇄ Phillips']],
      sfx: [[0.9, 'click'], [3.3, 'click']],
      render(t) {
        handle.set({ x: 800, y: 640 });
        const out = ease(seg(t, 0.8, 1.7)) - ease(seg(t, 3.0, 3.8));
        const flip = ease(seg(t, 1.8, 2.9));
        rod.set({ x: 800, y: 310 - out * 240, r: flip * 180 });
        const [ax, ay] = rod.world(0.5, 0.02); const [bx, by] = rod.world(0.5, 0.98);
        lab1.setAttribute('x', ax + 90); lab1.setAttribute('y', ay + 10);
        lab2.setAttribute('x', bx + 90); lab2.setAttribute('y', by + 10);
        lab1.setAttribute('opacity', seg(t, 0.8, 1.2)); lab2.setAttribute('opacity', seg(t, 0.8, 1.2));
      }
    };
  };

  /* ---------- screw bits on a cordless driver ---------- */
  /** Cordless drill/driver, side view. Chuck nose at (0,0) pointing right; `.cstripe` spins. */
  function drawPowerDrill(g, id, scale = 1) {
    return svgFrag(g, `<g transform="scale(${scale})">
      <defs><linearGradient id="${id}-dy" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe07a"/><stop offset=".45" stop-color="#FFC72C"/><stop offset="1" stop-color="#c79a1e"/></linearGradient>
      <linearGradient id="${id}-dk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4f56"/><stop offset=".5" stop-color="#2a2e33"/><stop offset="1" stop-color="#15171A"/></linearGradient></defs>
      <!-- battery -->
      <path d="M-430 300 h250 a14 14 0 0 1 14 14 v62 a14 14 0 0 1 -14 14 h-250 a14 14 0 0 1 -14 -14 v-62 a14 14 0 0 1 14 -14 z" fill="url(#${id}-dk)"/>
      <rect x="-440" y="300" width="270" height="34" rx="10" fill="url(#${id}-dy)"/>
      <circle cx="-210" cy="356" r="5" fill="#7AB51D"/><circle cx="-194" cy="356" r="5" fill="#7AB51D"/><circle cx="-178" cy="356" r="5" fill="#3a3f45"/>
      <!-- handle -->
      <path d="M-360 60 L-250 60 L-220 300 L-345 300 Z" fill="url(#${id}-dk)"/>
      <path d="M-338 90 L-262 90 L-240 290 L-326 290 Z" fill="#1b1d20"/>
      ${Array.from({ length: 9 }, (_, i) => `<line x1="${-330 + i * 1.6}" y1="${110 + i * 20}" x2="${-262 + i * 2.6}" y2="${110 + i * 20}" stroke="#2f3439" stroke-width="5"/>`).join('')}
      <path d="M-250 78 q26 4 24 46 l-20 4 q-4 -30 -16 -34 z" fill="#FFC72C" stroke="#15171A" stroke-width="2"/>
      <!-- body / motor housing -->
      <path d="M-470 -40 q0 -50 50 -54 l290 -14 q40 0 50 36 l0 116 q-10 30 -50 30 l-290 0 q-50 -4 -50 -54 z" fill="url(#${id}-dk)"/>
      <path d="M-466 -46 q4 -44 48 -48 l288 -14 q36 0 46 30 l0 22 l-382 14 z" fill="url(#${id}-dy)"/>
      ${Array.from({ length: 5 }, (_, i) => `<rect x="${-450 + i * 18}" y="-30" width="8" height="60" rx="4" fill="#15171A"/>`).join('')}
      <rect x="-300" y="-6" width="120" height="22" rx="6" fill="#FFC72C" opacity=".9"/><text x="-240" y="11" text-anchor="middle" font-family="Archivo Black, sans-serif" font-size="16" fill="#15171A">NPI</text>
      <!-- clutch ring + chuck -->
      <rect x="-84" y="-58" width="54" height="116" rx="12" fill="#3b4147"/>${Array.from({ length: 6 }, (_, i) => `<rect x="-80" y="${-50 + i * 18}" width="46" height="4" fill="#FFC72C" opacity=".7"/>`).join('')}
      <path d="M-30 -48 h72 q16 0 22 14 l16 34 l-16 34 q-6 14 -22 14 h-72 z" fill="url(#${id}-steel)"/>
      <g class="cstripe">${Array.from({ length: 12 }, (_, i) => `<rect x="${-30 + i * 9}" y="-48" width="3" height="96" fill="#5c646b" opacity=".55"/>`).join('')}</g>
      <rect x="-30" y="-48" width="102" height="10" fill="#fff" opacity=".25"/>
    </g>`);
  }
  // compatibility names used by scenes
  const drawDriver = (g, id) => { const d = drawPowerDrill(g, id, 0.95); d.querySelector('.cstripe')?.classList.add('stripes'); return d; };
  const drawDrill = (g, id) => drawPowerDrill(g, id, 1);

  function drawBit(g, id, { magnetic = false, len = 150 } = {}) {
    return svgFrag(g, `<g><rect x="0" y="-12" width="${len * 0.45}" height="24" fill="url(#${id}-steel)"/>
      ${magnetic ? `<rect x="${len * 0.1}" y="-19" width="34" height="38" rx="6" fill="url(#${id}-gold)"/>` : ''}
      <rect x="${len * 0.45}" y="-7" width="${len * 0.35}" height="14" fill="url(#${id}-steel)"/>
      <path d="M${len * 0.8} -9 L${len} 0 L${len * 0.8} 9 Z" fill="#8f979e"/><path d="M${len * 0.8} -1 L${len} 0 L${len * 0.8} 1" stroke="#3b4147" stroke-width="3"/></g>`);
  }
  SCENES.bits = (c) => {
    const { g, id } = c;
    P.bench(g, id, 780);
    const magnetic = c.hasSpec(/magnet/i);
    // gypsum board + stud
    svgFrag(g, `<rect x="1180" y="120" width="44" height="660" fill="#eceae4"/><rect x="1224" y="120" width="120" height="660" fill="url(#${id}-wood)"/><rect x="1224" y="120" width="120" height="660" fill="url(#${id}-grain)"/>`);
    const screw = svgFrag(g, `<g><rect x="-150" y="-9" width="150" height="18" fill="url(#${id}-steel)"/>${Array.from({ length: 10 }, (_, i) => `<path d="M${-150 + i * 15} -10 L${-140 + i * 15} 10" stroke="#555d64" stroke-width="3"/>`).join('')}<path d="M0 -9 L26 0 L0 9 Z" fill="#9aa3ab"/><rect x="-172" y="-30" width="22" height="60" rx="4" fill="url(#${id}-steelh)"/></g>`);
    const rig = el('g', {}, g);
    const drv = drawDriver(rig, id);
    const bit = drawBit(rig, id, { magnetic });
    bit.setAttribute('transform', 'translate(84 0)');
    const field = svgFrag(g, Array.from({ length: 4 }, (_, i) => `<ellipse rx="${30 + i * 18}" ry="${16 + i * 10}" fill="none" stroke="#7AB51D" stroke-width="3" stroke-dasharray="8 8" opacity="${0.8 - i * 0.18}"/>`).join(''));
    const stripes = drv.querySelector('.stripes');
    const dust = Particles(g, 30, (pg) => el('circle', { r: 4, fill: '#f4f2ee' }, pg));
    productCard(g, c, 230, 190, 240);
    return {
      camera: camPath([[0, 800, 450, 1.0], [2.0, 840, 420, 1.1], [9, 860, 430, 1.05]]),
      dur: 9,
      captions: magnetic
        ? [[0, 'Magnetic ring holds the screw for you'], [1.8, 'One-handed starts, even overhead'], [3.2, 'Drives gypsum & steel-frame screws'], [7, 'Bit stays on the screw: no drops ✓']]
        : [[0, 'Snap the bit into any cordless driver'], [1.6, 'S2 steel tip seats deep in the screw'], [3.4, 'Fast, clean driving into board and wood'], [7, 'Double-ended: flip for twice the life ✓']],
      sfx: [[2, 'whir'], [7.1, 'ding']],
      render(t) {
        const drive = ease(seg(t, 2.0, 6.6));
        const rigX = 640 + drive * 180;
        rig.setAttribute('transform', `translate(${rigX} 420)`);
        const tipX = rigX + 84 + 150;
        // screw: first snaps to bit (magnetic), then is driven into the board
        const snap = magnetic ? easeOut(seg(t, 0.4, 1.3)) : 1;
        const sx = lerp(980, tipX + 172, snap); const sy = lerp(740, 420, snap);
        screw.setAttribute('transform', `translate(${Math.max(sx, tipX + 172)} ${sy}) rotate(${lerp(90, 0, snap)})`);
        field.setAttribute('transform', `translate(${tipX + 20} 420)`);
        field.setAttribute('opacity', magnetic ? pulse(t, 0.2, 2.2) : 0);
        stripes.setAttribute('transform', `translate(${(t * 90) % 9} 0)`);
        stripes.setAttribute('opacity', drive > 0 && drive < 1 ? 1 : 0.3);
        dust.update((i) => (drive > 0.4 && drive < 1 ? flyer(i, t, { t0: 3.6, every: 0.1, life: 0.8, ox: 1180, oy: 420, sp: 300, angle: 180, spread: 90, g: 600 }) : null));
      }
    };
  };

  /* ---------- pliers family (real hinge animation) ---------- */
  function wireScene(c, { thick = 12, color = 'copper', cable = false } = {}) {
    const { g, id } = c;
    const mk = (side) => svgFrag(g, cable
      ? `<rect x="${side < 0 ? -900 : 0}" y="-26" width="900" height="52" rx="20" fill="#1b1d20"/><rect x="${side < 0 ? -900 : 0}" y="-26" width="900" height="12" rx="6" fill="#3a3f45"/>
         <rect x="${side < 0 ? -6 : 0}" y="-18" width="6" height="36" fill="url(#${id}-copper)"/>`
      : `<rect x="${side < 0 ? -900 : 0}" y="${-thick / 2}" width="900" height="${thick}" rx="${thick / 2}" fill="url(#${id}-${color})"/>`);
    return { left: mk(-1), right: mk(1) };
  }
  SCENES.pliers = (c) => {
    const { g, id } = c; const d = c.demo;
    P.bench(g, id, 820);
    const wire = wireScene(c, { thick: 14 });
    const twist = svgFrag(g, Array.from({ length: 7 }, (_, i) => `<path d="M${-60 + i * 18} -8 L${-48 + i * 18} 8" stroke="#8a4314" stroke-width="4"/>`).join(''));
    const tool = Hinge(g, c.actorImg, 680, d.pivot || [0.5, 0.33], d.hinge || 'cross'); tool.g.setAttribute('filter', `url(#${id}-ds)`);
    const sparks = Particles(g, 18, (pg) => el('circle', { r: 7, fill: `url(#${id}-spark)` }, pg));
    const jaw = d.tip || [0.5, 0.08]; const cut = d.cut || [0.5, (d.pivot || [0.5, 0.33])[1] - 0.07];
    const WY = 330;
    return {
      camera: camPath([[0, 800, 470, 0.95], [1.4, 800, 400, 1.2], [4.2, 800, 380, 1.25], [5.4, 800, 340, 1.45], [9, 800, 380, 1.2]]),
      dur: 9,
      captions: [[0, 'Serrated jaws open wide…'], [1.2, '…and clamp the wire firmly'], [1.8, 'Grip, twist and bend with full control'], [4.4, 'Hardened side cutter near the pivot'], [5.4, 'Snips copper and steel wire clean ✓']],
      sfx: [[1.2, 'click'], [5.35, 'snip']],
      render(t) {
        const opening = Math.max(pulse(t, 0.2, 1.3) * 17, (seg(t, 3.6, 4.0) - seg(t, 5.1, 5.35)) * 17);
        tool.open(opening);
        const moveToCut = ease(seg(t, 4.0, 4.9));
        const u = lerp(jaw[0], cut[0], moveToCut); const v = lerp(jaw[1], cut[1], moveToCut);
        const tw = Math.sin(seg(t, 1.8, 3.6) * Math.PI * 2) * 24 * (1 - seg(t, 3.4, 3.6));
        const rise = (1 - easeOut(seg(t, 0, 0.9))) * 280;
        tool.pin(u, v, 800, WY + rise, { r: tw });
        tool.set({ o: seg(t, 0, 0.3) });
        const cutDone = seg(t, 5.35, 6.6);
        const fall = easeIn(cutDone);
        wire.left.setAttribute('transform', `translate(${800 - fall * 40} ${WY + fall * 520}) rotate(${-fall * 30})`);
        wire.right.setAttribute('transform', `translate(${800 + fall * 40} ${WY + fall * 520}) rotate(${fall * 30})`);
        twist.setAttribute('transform', `translate(800 ${WY})`);
        twist.setAttribute('opacity', seg(t, 2.0, 2.6) * (1 - seg(t, 5.3, 5.4)));
        sparks.update((i) => flyer(i, t, { t0: 5.35, every: 0.008, life: 0.6, ox: 800, oy: WY, sp: 700, angle: -90, spread: 300, g: 1400 }));
      }
    };
  };

  SCENES.nose = (c) => {
    const { g, id } = c; const d = c.demo;
    // junction box: the long jaws reach in where fingers can't
    svgFrag(g, `<rect x="420" y="250" width="760" height="560" rx="18" fill="#c9c4b8"/><rect x="452" y="282" width="696" height="496" rx="10" fill="#22262a"/>
      <rect x="452" y="282" width="250" height="496" fill="#2f343a"/><rect x="898" y="282" width="250" height="496" fill="#2f343a"/>
      <rect x="560" y="660" width="70" height="90" rx="6" fill="#b02020"/><rect x="970" y="660" width="70" height="90" rx="6" fill="#1c4fa0"/>
      <rect x="770" y="690" width="60" height="70" rx="6" fill="#d8d2c4"/><circle cx="800" cy="712" r="12" fill="url(#${id}-steel)"/>`);
    const wirePath = el('path', { fill: 'none', stroke: '#c46a2b', 'stroke-width': 11, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
    const wireHi = el('path', { fill: 'none', stroke: '#f3b27a', 'stroke-width': 3, 'stroke-linecap': 'round', opacity: 0.7 }, g);
    const tool = Hinge(g, c.actorImg, 700, d.pivot || [0.5, 0.4], d.hinge || 'cross'); tool.g.setAttribute('filter', `url(#${id}-ds)`);
    const jaw = d.tip || [0.5, 0.03];
    const loopTxt = P.label(g, 800, 230, 'PERFECT LOOP ✓', { size: 46, fill: '#7AB51D', family: 'Archivo Black' });
    const R = 34; const cx = 800 + R; const baseY = 520;
    return {
      camera: camPath([[0, 800, 450, 0.85], [1.8, 810, 520, 1.25], [3.2, 820, 500, 1.6], [6.6, 820, 500, 1.6], [9, 800, 470, 1.05]]),
      dur: 9,
      captions: [[0, 'Long, slim jaws reach deep inside the box'], [1.8, 'Pinch the wire end precisely…'], [3.2, '…and roll a neat terminal loop'], [6.8, 'Panels, electronics and fine work ✓']],
      sfx: [[2.1, 'click'], [6.8, 'ding']],
      render(t) {
        const reach = easeOut(seg(t, 0, 1.8));
        const curl = ease(seg(t, 3.2, 6.4));
        tool.open(pulse(t, 1.0, 2.1) * 12);
        // wire rises from the terminal, then its end is rolled into a loop around (cx, baseY)
        const ang = curl * 330;
        const pts = Array.from({ length: 28 }, (_, i) => { const a = rad(180 - (ang * i) / 27); return [cx + Math.cos(a) * R, baseY - Math.sin(a) * R]; });
        const end = curl > 0 ? pts[pts.length - 1] : [800, baseY - 70];
        wirePath.setAttribute('d', `M800 712 L800 ${baseY} ${curl > 0 ? pts.map((q) => `L${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' ') : `L800 ${baseY - 70}`}`);
        wireHi.setAttribute('d', wirePath.getAttribute('d'));
        wireHi.setAttribute('transform', 'translate(-3 0)');
        tool.pin(jaw[0], jaw[1], end[0], end[1] - (1 - reach) * 520, { r: 180 + curl * 150 });
        tool.set({ o: seg(t, 0, 0.3) });
        loopTxt.setAttribute('opacity', seg(t, 6.6, 7));
      }
    };
  };

  SCENES.diagonal = (c) => {
    const { g, id } = c; const d = c.demo;
    P.bench(g, id, 820);
    const wires = [wireScene(c, { thick: 12 }), wireScene(c, { thick: 9, color: 'steel' })];
    const tool = Hinge(g, c.actorImg, 600, d.pivot || [0.5, 0.3], d.hinge || 'cross'); tool.g.setAttribute('filter', `url(#${id}-ds)`);
    const sparks = Particles(g, 24, (pg) => el('circle', { r: 7, fill: `url(#${id}-spark)` }, pg));
    const jaw = d.tip || [0.5, 0.1];
    const Y = [300, 480];
    return {
      camera: camPath([[0, 800, 470, 0.95], [2.2, 800, 380, 1.25], [4.4, 800, 500, 1.25], [9, 800, 470, 1.1]]),
      dur: 9,
      captions: [[0, 'Induction-hardened diagonal edges'], [1.4, 'Cut copper wire flush…'], [4.4, '…and hard steel wire, too'], [7, 'Long handles: big cutting force, little effort ✓']],
      sfx: [[2.0, 'snip'], [5.2, 'snip']],
      render(t) {
        const second = seg(t, 3.4, 4.4);
        const y = lerp(Y[0], Y[1], ease(second));
        tool.open(Math.max(pulse(t, 0.6, 2.0) * 14, pulse(t, 3.6, 5.2) * 14));
        tool.pin(jaw[0], jaw[1], 800, y + (1 - easeOut(seg(t, 0, 0.8))) * 300, { r: 0 });
        tool.set({ o: seg(t, 0, 0.3) });
        [[2.0, 0], [5.2, 1]].forEach(([tc, k]) => {
          const f = easeIn(seg(t, tc, tc + 1.2));
          wires[k].left.setAttribute('transform', `translate(${800 - f * 30} ${Y[k] + f * (820 - Y[k])}) rotate(${-f * 12})`);
          wires[k].right.setAttribute('transform', `translate(${800 + f * 30} ${Y[k] + f * (820 - Y[k])}) rotate(${f * 12})`);
        });
        sparks.update((i) => flyer(i, t, { t0: i < 12 ? 2.0 : 5.2 - 12 * 0.008, every: 0.008, life: 0.55, ox: 800, oy: i < 12 ? Y[0] : Y[1], sp: 650, angle: -90, spread: 300, g: 1400 }));
      }
    };
  };

  SCENES.cable = (c) => {
    const { g, id } = c; const d = c.demo;
    P.bench(g, id, 820);
    const wire = wireScene(c, { cable: true });
    const tool = Hinge(g, c.actorImg, 640, d.pivot || [0.5, 0.3], d.hinge || 'cross'); tool.g.setAttribute('filter', `url(#${id}-ds)`);
    const section = svgFrag(g, `<g transform="translate(1330 230)"><circle r="120" fill="#15171A" stroke="#FFC72C" stroke-width="4"/><circle r="74" fill="#1b1d20"/><circle r="56" fill="#3a3f45"/>
      ${Array.from({ length: 19 }, (_, i) => { const a = i * 2.4; const r = i === 0 ? 0 : 14 + (i % 3) * 13; return `<circle cx="${(Math.cos(a) * r).toFixed(1)}" cy="${(Math.sin(a) * r).toFixed(1)}" r="10" fill="url(#${id}-copper)"/>`; }).join('')}
      <text y="-90" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-size="22" font-weight="700" fill="#FFC72C">CLEAN, ROUND CUT</text></g>`);
    const jaw = d.tip || [0.5, 0.1];
    return {
      camera: camPath([[0, 800, 470, 0.95], [3.0, 800, 380, 1.3], [9, 800, 400, 1.15]]),
      dur: 9,
      captions: [[0, 'Curved shear blades wrap around the cable'], [2.2, 'Squeeze: long handles do the work'], [4.4, 'Cuts copper & aluminium without crushing'], [6.6, 'Strands stay round and ready to terminate ✓']],
      sfx: [[4.0, 'snip']],
      render(t) {
        tool.open(16 * ease(seg(t, 0.3, 1.1)) * (1 - ease(seg(t, 2.4, 4.0))));
        tool.pin(jaw[0], jaw[1], 800, 330 + (1 - easeOut(seg(t, 0, 0.9))) * 300, { r: 0 });
        tool.set({ o: seg(t, 0, 0.3) });
        const f = easeOut(seg(t, 4.0, 5.2));
        wire.left.setAttribute('transform', `translate(${800 - f * 120} 330)`);
        wire.right.setAttribute('transform', `translate(${800 + f * 120} 330)`);
        section.setAttribute('opacity', seg(t, 5.0, 5.6));
      }
    };
  };

  SCENES.locking = (c) => {
    const { g, id } = c; const d = c.demo;
    svgFrag(g, `<rect x="0" y="560" width="1600" height="60" fill="url(#${id}-steel)"/><rect x="770" y="300" width="60" height="270" fill="url(#${id}-steelh)"/>`);
    const nut = P.hexNut(el('g', {}, g), id, 70, true); nut.setAttribute('transform', 'translate(800 330)');
    const tool = Hinge(g, c.actorImg, 640, d.pivot || [0.5, 0.3], d.hinge || 'lever', d.lever || 'right'); tool.g.setAttribute('filter', `url(#${id}-ds)`);
    const lock = P.label(g, 1180, 200, 'LOCKED', { size: 56, fill: '#FFC72C', family: 'Archivo Black' });
    const jaw = d.tip || [0.5, 0.12];
    return {
      camera: camPath([[0, 800, 450, 0.85], [2.0, 800, 380, 1.15], [9, 800, 400, 1.0]]),
      dur: 9,
      captions: [[0, 'Set the jaw width with the screw knob'], [1.5, 'Squeeze: it locks onto the nut by itself'], [3.0, 'Hands-free clamping force'], [3.8, 'Turns rounded, stuck nuts that spanners slip on'], [7.0, 'Quick-release lever lets go instantly ✓']],
      sfx: [[2.0, 'click'], [7.0, 'click']],
      render(t) {
        const clamp_ = ease(seg(t, 1.5, 2.0)); const release = ease(seg(t, 7.0, 7.5));
        tool.open(14 * (1 - clamp_) + 18 * release);
        const turn = ease(seg(t, 3.8, 6.6)) * 70;
        tool.pin(jaw[0], jaw[1], 800, 330 + (1 - easeOut(seg(t, 0, 1.0))) * -300, { r: 90 + turn });
        tool.set({ o: seg(t, 0, 0.3) });
        nut.setAttribute('transform', `translate(800 330) rotate(${turn})`);
        lock.setAttribute('opacity', seg(t, 2.0, 2.3) * (1 - seg(t, 6.9, 7.1)));
      }
    };
  };

  SCENES.circlip = (c) => {
    const { g, id } = c; const d = c.demo; const internal = d.type === 'circlip-int';
    // cross-section: housing bore (internal) or shaft (external)
    svgFrag(g, internal
      ? `<rect x="420" y="420" width="760" height="320" fill="url(#${id}-steel)"/><rect x="620" y="420" width="360" height="320" fill="#1b1d20"/><rect x="600" y="470" width="400" height="22" fill="#111"/>`
      : `<rect x="680" y="380" width="240" height="420" fill="url(#${id}-steelh)"/><rect x="664" y="440" width="272" height="20" fill="#3b4147"/>`);
    const ring = el('g', {}, g);
    const ringPath = el('path', { fill: 'none', stroke: '#2d3238', 'stroke-width': 18, 'stroke-linecap': 'round' }, ring);
    const ear1 = el('circle', { r: 16, fill: '#2d3238' }, ring); const ear2 = el('circle', { r: 16, fill: '#2d3238' }, ring);
    const tool = Hinge(g, c.actorImg, 620, d.pivot || [0.5, 0.36], d.hinge || 'cross'); tool.g.setAttribute('filter', `url(#${id}-ds)`);
    const tip = d.tip || [0.5, 0.02];
    const baseHalf = internal ? 200 : 136; const ringY = internal ? 481 : 450;
    return {
      camera: camPath([[0, 800, 360, 0.75], [2.0, 800, 420, 1.0], [9, 800, 360, 0.85]]),
      dur: 9,
      captions: internal
        ? [[0, 'Hardened tips fit the circlip holes'], [1.8, 'Squeeze: tips close and the ring shrinks'], [3.6, 'Lift it cleanly out of the bore'], [6.6, 'Return spring re-opens for the next ring ✓']]
        : [[0, 'Hardened tips fit the snap-ring holes'], [1.8, 'Squeeze: tips spread and the ring opens'], [3.6, 'Slide it off the shaft'], [6.6, 'Return spring keeps the tips ready ✓']],
      sfx: [[1.8, 'click'], [6.4, 'click']],
      render(t) {
        const sq = ease(seg(t, 1.8, 3.2)) * (1 - ease(seg(t, 6.2, 6.8)));
        const lift = ease(seg(t, 3.6, 5.6));
        const half = baseHalf + (internal ? -40 : 40) * sq;
        const y = ringY - lift * 260;
        ringPath.setAttribute('d', `M${800 - half} ${y} L${800 + half} ${y}`);
        ear1.setAttribute('cx', 800 - 24 - 10 * (internal ? -sq : sq)); ear1.setAttribute('cy', y - 18);
        ear2.setAttribute('cx', 800 + 24 + 10 * (internal ? -sq : sq)); ear2.setAttribute('cy', y - 18);
        tool.open((internal ? -1 : 1) * sq * 6 + (internal ? 4 : 0));
        tool.pin(tip[0], tip[1], 800, y - 18 - (1 - easeOut(seg(t, 0, 1.2))) * 300, { r: 180 });
        tool.set({ o: seg(t, 0, 0.3) });
      }
    };
  };

  SCENES.pincers = (c) => {
    const { g, id } = c; const d = c.demo;
    P.wood(g, id, 300, 600, 1000, 160);
    const nail = svgFrag(g, `<rect x="-6" y="-170" width="12" height="230" fill="url(#${id}-steelh)"/><rect x="-22" y="-182" width="44" height="14" rx="4" fill="url(#${id}-steel)"/>`);
    const stub = svgFrag(g, `<rect x="-6" y="-60" width="12" height="70" fill="url(#${id}-steelh)"/><rect x="-20" y="-70" width="40" height="12" rx="4" fill="url(#${id}-steel)"/>`);
    stub.setAttribute('transform', 'translate(1100 600)');
    const head2 = svgFrag(g, '<rect x="-20" y="-6" width="40" height="12" rx="4" fill="#c7cdd3"/>');
    const tool = Hinge(g, c.actorImg, 560, d.pivot || [0.5, 0.2], d.hinge || 'cross'); tool.g.setAttribute('filter', `url(#${id}-ds)`);
    const jaw = d.tip || [0.5, 0.02];
    return {
      camera: camPath([[0, 800, 420, 0.8], [2.0, 760, 420, 0.95], [9, 900, 420, 0.9]]),
      dur: 10,
      captions: [[0, 'Rounded forged jaws grip the nail'], [1.4, 'Roll the head on the board: leverage pulls it out'], [4.6, 'Nail out, wood undamaged'], [5.6, 'The sharp jaws also nip nails flush'], [8.2, 'The carpenter\'s jamoor ✓']],
      sfx: [[1.2, 'click'], [7.6, 'snip']],
      render(t) {
        const pull = ease(seg(t, 1.6, 4.4));
        const nailUp = pull * 200;
        nail.setAttribute('transform', `translate(700 ${600 - nailUp}) rotate(${-pull * 8})`);
        nail.setAttribute('opacity', 1 - seg(t, 5.0, 5.3));
        const phase2 = seg(t, 5.3, 6.4);
        const nx = lerp(700, 1100, ease(phase2));
        const ny = phase2 > 0 ? 600 - 70 : 600 - 182 - nailUp;
        tool.open(Math.max(pulse(t, 0.3, 1.3) * 10, pulse(t, 6.2, 7.6) * 10));
        tool.pin(jaw[0], jaw[1], phase2 > 0 ? nx : 700, ny - (1 - easeOut(seg(t, 0, 0.9))) * 260, { r: phase2 > 0 ? 180 * (1 - ease(phase2)) + 180 * ease(phase2) : 180 + pull * 40 });
        tool.set({ o: seg(t, 0, 0.3) });
        const off = easeIn(seg(t, 7.6, 8.6));
        head2.setAttribute('transform', `translate(${1100 + off * 140} ${530 - off * 60 + off * off * 260}) rotate(${off * 300})`);
        head2.setAttribute('opacity', seg(t, 7.6, 7.7));
        stub.querySelector('rect:last-child').setAttribute('opacity', 1 - seg(t, 7.6, 7.7));
      }
    };
  };

  SCENES.ppr = (c) => {
    const { g, id } = c; const d = c.demo;
    P.bench(g, id, 820);
    const pipeL = svgFrag(g, `<rect x="-800" y="-40" width="800" height="80" rx="6" fill="#e9ece6"/><rect x="-800" y="-40" width="800" height="16" fill="#fff"/><rect x="-800" y="16" width="800" height="10" fill="#4a9a3a"/>`);
    const pipeR = svgFrag(g, `<rect x="0" y="-40" width="800" height="80" rx="6" fill="#e9ece6"/><rect x="0" y="-40" width="800" height="16" fill="#fff"/><rect x="0" y="16" width="800" height="10" fill="#4a9a3a"/>`);
    const tool = Hinge(g, c.actorImg, 620, d.pivot || [0.45, 0.32], 'lever', d.lever || 'right'); tool.g.setAttribute('filter', `url(#${id}-ds)`);
    const section = svgFrag(g, `<g transform="translate(1320 220)"><circle r="120" fill="#15171A" stroke="#FFC72C" stroke-width="4"/><circle r="70" fill="#e9ece6"/><circle r="50" fill="#15171A"/><text y="-90" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-size="22" font-weight="700" fill="#FFC72C">SQUARE &amp; BURR-FREE</text></g>`);
    const blade = d.tip || [0.6, 0.18];
    return {
      camera: camPath([[0, 800, 450, 0.95], [2.0, 800, 400, 1.15], [9, 800, 420, 1.05]]),
      dur: 9,
      captions: [[0, 'Place the blade on the mark'], [1.2, 'Ratchet action: a few easy squeezes'], [4.6, 'Stainless blade slices PPR, PVC and PE'], [6.4, 'Square, burr-free ends, ready to fuse ✓']],
      sfx: [[1.6, 'ratchet'], [2.7, 'ratchet'], [3.8, 'ratchet'], [4.7, 'snip']],
      render(t) {
        const squeezes = [[1.2, 2.2], [2.3, 3.3], [3.4, 4.5]];
        let a = 16 * (1 - seg(t, 0.4, 1.1));
        squeezes.forEach(([s0, s1]) => { a += -pulse(t, s0, s1) * 12; });
        tool.open(Math.max(-14, a));
        tool.pin(blade[0], blade[1], 800, 330 + (1 - easeOut(seg(t, 0, 1.0))) * -320, { r: 0 });
        tool.set({ o: seg(t, 0, 0.3) });
        const f = easeOut(seg(t, 4.6, 5.8));
        pipeL.setAttribute('transform', `translate(${800 - f * 90} 360)`);
        pipeR.setAttribute('transform', `translate(${800 + f * 90} 360)`);
        section.setAttribute('opacity', seg(t, 5.6, 6.2));
      }
    };
  };

  SCENES.riveter = (c) => {
    const { g, id } = c; const d = c.demo;
    svgFrag(g, `<rect x="300" y="560" width="1000" height="26" fill="url(#${id}-steel)"/><rect x="300" y="586" width="1000" height="26" fill="#a9b0b6"/>`);
    const rivet = el('g', {}, g);
    const body = svgFrag(rivet, `<rect x="-14" y="-4" width="28" height="70" fill="#d8dde1"/><rect x="-30" y="-14" width="60" height="14" rx="5" fill="#eef1f3"/>`);
    void body;
    const bulge = el('ellipse', { cx: 0, cy: 70, rx: 16, ry: 8, fill: '#c7cdd3' }, rivet);
    const mandrel = svgFrag(rivet, '<rect x="-5" y="-120" width="10" height="190" fill="#8f979e"/><circle cy="70" r="9" fill="#8f979e"/>');
    rivet.setAttribute('transform', 'translate(800 574)');
    const tool = Hinge(g, c.actorImg, 600, d.pivot || [0.55, 0.3], 'lever', d.lever || 'left'); tool.g.setAttribute('filter', `url(#${id}-ds)`);
    const nozzle = d.tip || [0.85, 0.08];
    const pop = Particles(g, 1, (pg) => el('rect', { x: -5, y: -60, width: 10, height: 120, fill: '#8f979e' }, pg));
    const done = P.label(g, 800, 800, 'JOINED ✓', { size: 56, fill: '#7AB51D', family: 'Archivo Black' });
    return {
      camera: camPath([[0, 800, 450, 0.95], [2.0, 760, 480, 1.1], [9, 800, 470, 1.0]]),
      dur: 9,
      captions: [[0, 'Pick the nozzle for your rivet size (on-board storage)'], [1.4, 'Pump the handles: the mandrel is pulled up'], [3.6, 'The rivet tail swells and clamps the sheets'], [5.0, 'Mandrel snaps off: a permanent joint'], [7.0, 'Windows, ducting, signboards ✓']],
      sfx: [[1.8, 'click'], [2.9, 'click'], [4.0, 'click'], [5.0, 'snip']],
      render(t) {
        let a = 0; const pumps = [[1.4, 2.4], [2.5, 3.5], [3.6, 4.9]];
        pumps.forEach(([s0, s1]) => { a += pulse(t, s0, s1) * 16; });
        tool.open(-a);
        const pull = ease(seg(t, 1.4, 4.9));
        tool.pin(nozzle[0], nozzle[1], 800, 560 - 120 - (1 - easeOut(seg(t, 0, 1.0))) * 300 - pull * 0, { r: d.rot ?? 90 });
        tool.set({ o: seg(t, 0, 0.3) });
        bulge.setAttribute('rx', 16 + pull * 18); bulge.setAttribute('ry', 8 + pull * 10);
        mandrel.setAttribute('transform', `translate(0 ${-pull * 40})`);
        mandrel.setAttribute('opacity', t < 5.0 ? 1 : 0);
        pop.update(() => { const f = seg(t, 5.0, 6.2); if (f <= 0 || f >= 1) return null; return { x: 800 + f * 260, y: 380 - f * 200 + f * f * 500, r: f * 540, o: 1 - f }; });
        done.setAttribute('opacity', seg(t, 6.4, 6.8));
      }
    };
  };

  /* ---------- knife: cut a line, then snap a fresh segment ---------- */
  SCENES.knife = (c) => {
    const { g, id } = c; const d = c.demo;
    svgFrag(g, `<rect x="220" y="430" width="1160" height="330" fill="#c8a97a"/><path d="M220 470 H1380 M220 520 H1380 M220 570 H1380 M220 620 H1380 M220 670 H1380 M220 720 H1380" stroke="#b8976a" stroke-width="2"/>
      <line x1="300" y1="590" x2="1300" y2="590" stroke="#15171A" stroke-width="2" stroke-dasharray="10 10" opacity=".5"/>`);
    const cut = el('line', { x1: 300, y1: 590, x2: 300, y2: 590, stroke: '#3a2a14', 'stroke-width': 5, 'stroke-linecap': 'round' }, g);
    const actor = Actor(g, c.actorImg, 520); actor.g.setAttribute('filter', `url(#${id}-ds)`);
    const inset = svgFrag(g, `<g transform="translate(1330 230)"><circle r="128" fill="#15171A" stroke="#FFC72C" stroke-width="4"/>
      <g class="bl"><path d="M-90 -26 L60 -26 L90 26 L-90 26 Z" fill="url(#${id}-steel)"/>${[-50, -10, 30].map((x) => `<line x1="${x}" y1="-26" x2="${x + 30}" y2="26" stroke="#4a5158" stroke-width="2"/>`).join('')}</g>
      <g class="seg"><path d="M60 -26 L90 26 L60 26 L30 -26 Z" fill="url(#${id}-steel)" transform="translate(0 0)"/></g>
      <text y="-88" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-size="22" font-weight="700" fill="#FFC72C">SNAP-OFF BLADE</text></g>`);
    const segp = inset.querySelector('.seg');
    const tip = d.tip || [0.5, 0.0];
    return {
      camera: camPath([[0, 800, 520, 0.95], [2.0, 760, 560, 1.2], [5.2, 1050, 560, 1.2], [9, 1000, 420, 1.0]]),
      dur: 9,
      captions: [[0, 'Slide out the blade: it auto-locks in place'], [1.2, 'Metal body, steady control'], [2.0, 'Clean, straight cuts in carton, board and vinyl'], [5.6, 'Blunt? Snap off a segment…'], [6.6, '…for a razor-sharp edge again ✓']],
      sfx: [[6.4, 'snap']],
      render(t) {
        const p = ease(seg(t, 1.6, 5.2));
        const x = lerp(300, 1300, p);
        cut.setAttribute('x2', x);
        actor.pin(tip[0], tip[1], x, 590 - (1 - easeOut(seg(t, 0, 1.0))) * 250, { r: 60 });
        actor.set({ o: seg(t, 0, 0.3) });
        inset.setAttribute('opacity', seg(t, 5.4, 5.8));
        const sn = seg(t, 6.4, 7.6);
        segp.setAttribute('transform', `translate(${sn * 60} ${sn * sn * 120}) rotate(${sn * 70} 60 0)`);
        segp.setAttribute('opacity', 1 - seg(t, 7.3, 7.6));
      }
    };
  };

  /* ---------- hacksaw through a steel pipe ---------- */
  SCENES.hacksaw = (c) => {
    const { g, id } = c; const d = c.demo;
    P.bench(g, id, 760);
    svgFrag(g, '<rect x="740" y="560" width="120" height="200" fill="#3b4147"/><rect x="700" y="540" width="200" height="30" fill="#59616a"/>');
    const pipeL = svgFrag(g, `<rect x="-560" y="-46" width="560" height="92" fill="url(#${id}-steel)"/>`);
    const pipeR = svgFrag(g, `<rect x="0" y="-46" width="560" height="92" fill="url(#${id}-steel)"/>`);
    const kerf = el('rect', { x: 796, width: 8, y: 404, height: 0, fill: '#15171A' }, g);
    const actor = Actor(g, c.actorImg, 640); actor.g.setAttribute('filter', `url(#${id}-ds)`);
    const filings = Particles(g, 40, (pg) => el('rect', { width: 5, height: 3, fill: '#c7cdd3' }, pg));
    const blade = d.tip || [0.12, 0.5];
    return {
      camera: camPath([[0, 800, 420, 0.95], [2.0, 800, 420, 1.15], [9, 800, 450, 1.05]]),
      dur: 9,
      captions: [[0, 'High-tension frame keeps the blade straight'], [1.4, 'Long, even strokes'], [3.6, 'Cuts steel rod, pipe and bolts'], [6.8, 'Clean through ✓  (PVC and conduit too)']],
      sfx: [[1.4, 'saw'], [2.4, 'saw'], [3.4, 'saw'], [4.4, 'saw'], [5.4, 'saw']],
      render(t) {
        const depth = ease(seg(t, 1.4, 6.4));
        const stroke = Math.sin(seg(t, 1.4, 6.4) * Math.PI * 10) * 110;
        actor.pin(blade[0], blade[1], 800 + stroke, 404 + depth * 92 - (1 - easeOut(seg(t, 0, 1.0))) * 250, { r: -90 });
        actor.set({ o: seg(t, 0, 0.3) });
        kerf.setAttribute('height', depth * 92);
        const drop = easeIn(seg(t, 6.4, 7.4));
        pipeL.setAttribute('transform', 'translate(796 450)');
        pipeR.setAttribute('transform', `translate(${804 + drop * 30} ${450 + drop * 260}) rotate(${drop * 14})`);
        filings.update((i) => (depth > 0 && depth < 1 ? flyer(i, t, { t0: 1.5, every: 0.12, life: 0.7, ox: 800, oy: 450, sp: 160, angle: 90, spread: 140, g: 900 }) : null));
      }
    };
  };

  /* ---------- planer blades in an electric planer ---------- */
  SCENES.planer = (c) => {
    const { g, id } = c;
    P.bench(g, id, 760);
    P.wood(g, id, 160, 600, 1280, 160);
    const machine = svgFrag(g, `<g>
      <rect x="-260" y="-18" width="520" height="24" rx="6" fill="url(#${id}-steel)"/>
      <path d="M-240 -18 L-240 -120 Q-240 -160 -200 -160 L170 -160 Q230 -160 240 -110 L250 -18 Z" fill="#2a2e33"/>
      <path d="M-240 -120 Q-240 -160 -200 -160 L170 -160 Q230 -160 240 -110 L242 -100 L-240 -100 Z" fill="#FFC72C"/>
      ${Array.from({ length: 5 }, (_, i) => `<rect x="${-200 + i * 22}" y="-90" width="10" height="56" rx="5" fill="#15171A"/>`).join('')}
      <text x="40" y="-60" text-anchor="middle" font-family="Archivo Black, sans-serif" font-size="26" fill="#FFC72C">NPI</text>
      <path d="M60 -160 Q80 -280 200 -270 Q260 -262 250 -200 L230 -160 L200 -160 Q210 -230 170 -232 Q110 -236 100 -160 Z" fill="#2a2e33"/>
      <circle cx="-230" cy="-170" r="34" fill="#2a2e33"/><circle cx="-230" cy="-170" r="16" fill="#FFC72C"/>
      <path d="M200 -100 L320 -60 L320 -20 L230 -40 Z" fill="#3b4147"/>
      <g class="drum" transform="translate(-40 -2)"><circle r="30" fill="#59616a"/><rect x="-32" y="-5" width="64" height="10" fill="#dfe4e8"/></g></g>`);
    const drum = machine.querySelector('.drum');
    const shavings = Particles(g, 26, (pg) => el('path', { d: 'M0 0 C14 -18 30 -4 22 10 C14 22 -4 12 4 2', fill: 'none', stroke: '#e9bd80', 'stroke-width': 5, 'stroke-linecap': 'round' }, pg));
    const planed = el('rect', { x: 160, y: 600, width: 0, height: 6, fill: '#f4d3a0' }, g);
    const actor = Actor(g, c.actorImg, 300); actor.g.setAttribute('filter', `url(#${id}-ds)`);
    return {
      camera: camPath([[0, 800, 450, 0.95], [1.4, 600, 520, 1.15], [5.0, 1100, 520, 1.15], [5.4, 800, 380, 1.0], [9, 800, 380, 1.05]]),
      dur: 9,
      captions: [[0, 'Sharp, balanced knives fit 82 mm planers'], [1.6, 'Smooth passes, thin even shavings'], [5.2, 'Reversible: when one edge dulls…'], [6.4, '…flip the knife for a fresh edge ✓']],
      sfx: [[1.6, 'whir']],
      render(t) {
        const p = ease(seg(t, 1.4, 5.0));
        const x = lerp(260, 1340, p);
        machine.setAttribute('transform', `translate(${x} 590)`);
        drum.setAttribute('transform', `translate(-40 -2) rotate(${t * 2400})`);
        planed.setAttribute('width', Math.max(0, x - 160 - 200));
        shavings.update((i) => (p > 0 && p < 1 ? flyer(i, t, { t0: 1.5, every: 0.13, life: 0.9, ox: x + 300, oy: 540, sp: 380, angle: -30, spread: 50, g: 700 }) : null));
        const flip = ease(seg(t, 5.6, 7.0));
        actor.set({ x: 800, y: 260, r: 90 + flip * 180, o: seg(t, 5.0, 5.4) });
      }
    };
  };

  /* ---------- diamond disc on an angle grinder cutting tile ---------- */
  SCENES.disc = (c) => {
    const { g, id } = c;
    P.bench(g, id, 700);
    const tileL = svgFrag(g, `<rect x="-420" y="0" width="420" height="40" fill="url(#${id}-tile)"/><rect x="-420" y="0" width="420" height="6" fill="#fff"/>`);
    const tileR = svgFrag(g, `<rect x="0" y="0" width="420" height="40" fill="url(#${id}-tile)"/><rect x="0" y="0" width="420" height="6" fill="#fff"/>`);
    const rig = el('g', {}, g);
    const disc = Actor(rig, c.actorImg, 330);
    svgFrag(rig, `<defs><linearGradient id="${id}-gy" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe07a"/><stop offset=".5" stop-color="#FFC72C"/><stop offset="1" stop-color="#b8860b"/></linearGradient></defs>
      <!-- guard over the back half of the disc -->
      <path d="M-182 10 A182 182 0 0 1 182 10 L200 10 A200 200 0 0 0 -200 10 Z" fill="#59616a" stroke="#2a2e33" stroke-width="3"/>
      <path d="M-200 10 A200 200 0 0 1 200 10" fill="none" stroke="#8f979e" stroke-width="4"/>
      <!-- gear head + body + grip -->
      <g transform="rotate(-18)">
        <rect x="-40" y="-120" width="130" height="90" rx="18" fill="#3b4147"/>
        <path d="M70 -150 h360 q50 0 50 50 v20 q0 50 -50 50 h-360 z" fill="url(#${id}-gy)"/>
        <path d="M70 -150 h360 q50 0 50 50 v4 h-410 z" fill="#fff" opacity=".18"/>
        ${Array.from({ length: 6 }, (_, i) => `<rect x="${110 + i * 20}" y="-138" width="9" height="76" rx="4" fill="#15171A" opacity=".8"/>`).join('')}
        <rect x="300" y="-148" width="190" height="116" rx="40" fill="#2a2e33"/><rect x="330" y="-150" width="40" height="22" rx="6" fill="#FFC72C"/>
        <text x="250" y="-82" text-anchor="middle" font-family="Archivo Black, sans-serif" font-size="22" fill="#15171A">NPI</text>
        <rect x="-20" y="-250" width="34" height="140" rx="16" fill="#2a2e33"/>
      </g>
      <circle r="22" fill="#8f979e" stroke="#2a2e33" stroke-width="4"/>`);
    const dust = Particles(g, 50, (pg) => el('circle', { r: 10, fill: '#e8e2d6', filter: `url(#${id}-blur)` }, pg));
    const sparks = Particles(g, 30, (pg) => el('circle', { r: 5, fill: `url(#${id}-spark)` }, pg));
    const label = P.label(g, 1330, 160, 'Ø125 × 1.2 mm', { size: 44, fill: '#FFC72C', family: 'JetBrains Mono', anchor: 'middle' });
    // disc is mounted on the grinder: put the disc in front of the guard
    rig.append(disc.g);
    return {
      camera: camPath([[0, 800, 450, 0.9], [1.6, 760, 520, 1.1], [6.0, 980, 540, 1.1], [9, 800, 470, 0.95]]),
      dur: 9,
      captions: [[0, 'Hot-pressed turbo diamond rim'], [1.6, 'Ultra-thin 1.2 mm: fast, chip-free cuts'], [3.6, 'Tile, marble, granite and concrete'], [6.4, 'Clean edges, ready to lay ✓']],
      sfx: [[1.2, 'grind']],
      render(t) {
        const p = ease(seg(t, 1.4, 6.0));
        const spin = t * 3000;
        rig.setAttribute('transform', `translate(${lerp(500, 1100, p)} ${520 - (1 - easeOut(seg(t, 0, 1.2))) * 300})`);
        disc.set({ x: 0, y: 0, r: spin, sx: 1 });
        const cutX = lerp(500, 1100, p);
        const sep = easeOut(seg(t, 6.0, 7.0));
        tileL.setAttribute('transform', `translate(${800 - sep * 50} 660)`);
        tileR.setAttribute('transform', `translate(${800 + sep * 50} 660)`);
        dust.update((i) => (p > 0 && p < 1 ? flyer(i, t, { t0: 1.4, every: 0.09, life: 1.2, ox: cutX - 120, oy: 650, sp: 300, angle: -160, spread: 40, g: -60 }) : null));
        sparks.update((i) => (p > 0 && p < 1 ? flyer(i, t, { t0: 1.4, every: 0.15, life: 0.4, ox: cutX - 150, oy: 655, sp: 700, angle: -170, spread: 30, g: 900 }) : null));
        label.setAttribute('opacity', seg(t, 1.6, 2.0));
      }
    };
  };

  /* ---------- adjustable wrench / T-wrench / keys / sockets ---------- */
  function torqueGauge(g, x, y) {
    const gg = svgFrag(g, `<g transform="translate(${x} ${y})"><path d="M-80 0 A80 80 0 0 1 80 0" fill="none" stroke="#3a3f45" stroke-width="16"/>
      <path class="arc" d="M-80 0 A80 80 0 0 1 80 0" fill="none" stroke="#7AB51D" stroke-width="16" stroke-dasharray="251.3" stroke-dashoffset="251.3"/>
      <line class="ndl" x1="0" y1="0" x2="-70" y2="0" stroke="#fff" stroke-width="5" stroke-linecap="round"/><circle r="8" fill="#fff"/>
      <text class="val" y="44" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="28" fill="#FFC72C">0 Nm</text></g>`);
    return (f, nm) => { gg.querySelector('.arc').setAttribute('stroke-dashoffset', 251.3 * (1 - f)); gg.querySelector('.ndl').setAttribute('transform', `rotate(${f * 180})`); gg.querySelector('.val').textContent = `${Math.round(nm)} Nm`; };
  }
  SCENES.wrench = (c) => {
    const { g, id } = c; const d = c.demo;
    svgFrag(g, `<circle cx="800" cy="420" r="210" fill="url(#${id}-steel)"/><circle cx="800" cy="420" r="210" fill="none" stroke="#4a5158" stroke-width="6"/>
      ${[0, 1, 2, 3, 4, 5].map((i) => `<circle cx="${800 + Math.cos(i * 1.047) * 160}" cy="${420 + Math.sin(i * 1.047) * 160}" r="16" fill="#59616a"/>`).join('')}`);
    const nut = P.hexNut(el('g', {}, g), id, 62); nut.setAttribute('transform', 'translate(800 420)');
    const tool = Actor(g, c.actorImg, 640); tool.g.setAttribute('filter', `url(#${id}-ds)`);
    const gauge = torqueGauge(g, 1330, 250);
    const jaw = d.tip || [0.42, 0.1];
    return {
      camera: camPath([[0, 800, 520, 0.72], [2.0, 760, 500, 0.8], [9, 800, 480, 0.78]]),
      dur: 9,
      captions: [[0, 'Roll the worm: the jaw fits any nut'], [1.6, 'Wide opening, polished parallel jaws'], [2.6, 'Pull: smooth, strong turning force'], [5.6, 'Re-grip and pull again'], [7.4, 'One wrench replaces a whole spanner set ✓']],
      sfx: [[2.6, 'click'], [4.6, 'click'], [6.4, 'click']],
      render(t) {
        const pulls = [[2.6, 4.0], [4.6, 6.0], [6.4, 7.6]];
        let rot = 0; let nutRot = 0;
        pulls.forEach(([a, b]) => { const f = ease(seg(t, a, b)); const back = ease(seg(t, b + 0.05, b + 0.55)); rot += f * 50 - back * 50; nutRot += f * 50; });
        const enter = easeOut(seg(t, 0, 1.4));
        tool.pin(jaw[0], jaw[1], 800, 420 - (1 - enter) * 300, { r: -60 + rot });
        tool.set({ o: seg(t, 0, 0.3) });
        nut.setAttribute('transform', `translate(800 420) rotate(${nutRot})`);
        const f = Math.min(1, nutRot / 150);
        gauge(f, f * 85);
      }
    };
  };

  SCENES.twrench = (c) => {
    const { g, id } = c; const d = c.demo;
    svgFrag(g, `<rect x="420" y="600" width="760" height="200" rx="16" fill="#3b4147"/><rect x="420" y="600" width="760" height="20" fill="#59616a"/>`);
    const bolt = el('g', {}, g);
    svgFrag(bolt, `<rect x="-14" y="-40" width="28" height="80" fill="url(#${id}-steelh)"/>`);
    const nut = svgFrag(bolt, `<rect x="-46" y="-26" width="92" height="36" fill="url(#${id}-steelh)" stroke="#4a5158" stroke-width="3"/><rect class="face" x="-14" y="-26" width="28" height="36" fill="#fff" opacity=".25"/>`);
    bolt.setAttribute('transform', 'translate(800 600)');
    const tool = Actor(g, c.actorImg, 620); tool.g.setAttribute('filter', `url(#${id}-ds)`);
    const tip = d.tip || [0.5, 0.98];
    return {
      camera: camPath([[0, 800, 360, 0.68], [9, 800, 380, 0.75]]),
      dur: 8,
      captions: [[0, 'Box socket drops over the nut'], [1.4, 'Spin the T-bar: fast on long studs'], [4.4, 'Reaches recessed nuts spanners can\'t'], [6.4, 'Tight ✓']],
      sfx: [[1.5, 'ratchet'], [3, 'ratchet'], [4.5, 'ratchet']],
      render(t) {
        const spin = ease(seg(t, 1.4, 6.0));
        const ph = spin * Math.PI * 10;
        const down = spin * 26;
        nut.setAttribute('transform', `translate(0 ${-30 + down})`);
        nut.querySelector('.face').setAttribute('x', -14 + Math.sin(ph) * 28);
        tool.pin(tip[0], tip[1], 800, 560 + down - (1 - easeOut(seg(t, 0, 1.2))) * 280, { r: 0, sx: Math.cos(ph) });
        tool.set({ o: seg(t, 0, 0.3) });
      }
    };
  };

  SCENES.keys = (c) => {
    const { g, id } = c;
    svgFrag(g, `<rect x="300" y="300" width="1000" height="460" rx="10" fill="url(#${id}-wood)"/><rect x="300" y="300" width="1000" height="460" rx="10" fill="url(#${id}-grain)"/>`);
    const screw = el('g', {}, g);
    svgFrag(screw, `<circle r="60" fill="url(#${id}-steel)" stroke="#4a5158" stroke-width="4"/>`);
    const hex = svgFrag(screw, `<polygon points="${Array.from({ length: 6 }, (_, i) => `${(Math.cos(rad(60 * i)) * 30).toFixed(1)},${(Math.sin(rad(60 * i)) * 30).toFixed(1)}`).join(' ')}" fill="#22262a"/>`);
    screw.setAttribute('transform', 'translate(800 530)');
    const key = svgFrag(g, `<g><rect x="-14" y="-300" width="28" height="300" rx="6" fill="url(#${id}-steelh)"/><rect x="-14" y="-314" width="160" height="28" rx="12" fill="url(#${id}-steel)"/></g>`);
    productCard(g, c, 1330, 230, 260);
    return {
      camera: camPath([[0, 800, 450, 1.0], [2, 800, 470, 1.1], [8, 800, 470, 1.1]]),
      dur: 8,
      captions: [[0, 'Pick the size: every key is marked on the holder'], [1.6, 'CR-V steel: no rounding, no twisting'], [3.2, 'Short arm for torque, long arm for speed'], [6.2, 'Furniture, machines, bikes ✓']],
      sfx: [[2, 'ratchet'], [3.4, 'ratchet'], [4.8, 'ratchet']],
      render(t) {
        const turn = ease(seg(t, 1.8, 5.8));
        const ph = turn * Math.PI * 6;
        hex.setAttribute('transform', `rotate(${deg(ph)})`);
        key.setAttribute('transform', `translate(800 ${530 - (1 - easeOut(seg(t, 0.4, 1.6))) * 200}) scale(${Math.cos(ph).toFixed(3)} 1)`);
        key.setAttribute('opacity', seg(t, 0.4, 0.8));
      }
    };
  };

  SCENES.sockets = (c) => {
    const { g, id } = c;
    svgFrag(g, `<rect x="300" y="600" width="1000" height="200" rx="10" fill="#3b4147"/><rect x="300" y="600" width="1000" height="18" fill="#59616a"/>`);
    const bolt = el('g', {}, g); const nutFace = svgFrag(bolt, `<rect x="-50" y="-40" width="100" height="40" fill="url(#${id}-steelh)"/><rect class="f" x="-16" y="-40" width="32" height="40" fill="#fff" opacity=".25"/>`);
    bolt.setAttribute('transform', 'translate(800 600)');
    const rat = svgFrag(g, `<g><rect x="-34" y="-110" width="68" height="70" rx="8" fill="url(#${id}-steelh)"/>
      <rect x="-56" y="-170" width="112" height="64" rx="30" fill="url(#${id}-steel)" stroke="#59616a" stroke-width="2"/><circle cx="0" cy="-138" r="14" fill="#9aa3ab"/>
      <rect x="40" y="-152" width="460" height="28" rx="12" fill="url(#${id}-steel)"/>
      <rect x="260" y="-160" width="250" height="44" rx="20" fill="#d63232"/><rect x="260" y="-160" width="250" height="14" rx="8" fill="#fff" opacity=".2"/>
      <rect x="300" y="-160" width="30" height="44" fill="#15171A" opacity=".6"/></g>`);
    productCard(g, c, 1330, 230, 260);
    return {
      camera: camPath([[0, 800, 450, 1.0], [9, 850, 450, 1.0]]),
      dur: 8,
      captions: [[0, 'Chrome-vanadium socket on a 1/2" ratchet'], [1.6, 'Ratchet clicks back: no re-gripping'], [4.4, 'Extension bar reaches deep bolts'], [6.4, 'Car, bike and machinery work ✓']],
      sfx: [[1.8, 'ratchet'], [2.6, 'ratchet'], [3.4, 'ratchet'], [4.2, 'ratchet']],
      render(t) {
        const sw = Math.sin(seg(t, 1.6, 5.6) * Math.PI * 8);
        const nutPh = Math.max(0, seg(t, 1.6, 5.6)) * Math.PI * 6;
        rat.setAttribute('transform', `translate(800 ${600 - (1 - easeOut(seg(t, 0.2, 1.4))) * 200}) scale(${(0.45 + 0.55 * Math.abs(Math.cos(sw * 0.9))).toFixed(3)} 1)`);
        rat.setAttribute('opacity', seg(t, 0.2, 0.5));
        nutFace.querySelector('.f').setAttribute('x', -16 + Math.sin(nutPh) * 34);
      }
    };
  };

  /* ---------- measuring tapes ---------- */
  SCENES.tape = (c) => {
    const { g, id } = c; const d = c.demo;
    P.bench(g, id, 700);
    svgFrag(g, '<rect x="1330" y="420" width="60" height="280" fill="#a8733a"/><rect x="1330" y="420" width="60" height="10" fill="#e9bd80"/>');
    const blade = el('g', {}, g);
    const bladeRect = el('rect', { x: 0, y: -14, width: 0, height: 28, fill: '#FFD24D' }, blade);
    const ticks = el('g', {}, blade);
    for (let i = 0; i <= 120; i++) { el('rect', { x: i * 10, y: -14, width: 2, height: i % 10 === 0 ? 18 : 8, fill: '#15171A' }, ticks); if (i % 10 === 0 && i) P.label(ticks, i * 10, 12, String(i / 10), { size: 13, fill: '#b3261e', family: 'JetBrains Mono' }); }
    const hook = el('rect', { x: 0, y: -18, width: 10, height: 44, fill: '#59616a' }, blade);
    const tool = Actor(g, c.actorImg, 300); tool.g.setAttribute('filter', `url(#${id}-ds)`);
    const read = P.label(g, 800, 250, '0.00 m', { size: 84, fill: '#FFC72C', family: 'JetBrains Mono' });
    const lockTxt = P.label(g, 800, 330, 'BLADE LOCKED', { size: 34, fill: '#7AB51D' });
    const mouth = d.tip || [0.85, 0.85];
    const maxLen = c.hasSpec(/3\.5|12 ?ft/i) ? 3.5 : 5;
    return {
      camera: camPath([[0, 600, 470, 1.15], [3.0, 800, 450, 1.0], [9, 800, 450, 1.0]]),
      dur: 9,
      captions: [[0, `Pull the blade: ${maxLen} m of clear metric & imperial markings`], [1.0, 'The end hook grips the edge for one-person measuring'], [4.2, 'Press the lock: the reading stays put'], [6.0, 'Release and it rewinds safely ✓']],
      sfx: [[4.2, 'click'], [6.2, 'whir']],
      render(t) {
        tool.set({ x: 360, y: 520, r: 0, sx: mouth[0] < 0.5 ? -1 : 1, o: seg(t, 0, 0.3) });
        const [mx, my] = tool.world(mouth[0], mouth[1]);
        const out = ease(seg(t, 0.8, 4.0)) * (1 - ease(seg(t, 6.0, 7.2)));
        const len = out * (1330 - mx);
        blade.setAttribute('transform', `translate(${mx} ${my})`);
        bladeRect.setAttribute('width', len); hook.setAttribute('x', len - 4);
        ticks.setAttribute('clip-path', '');
        ticks.querySelectorAll('rect,text').forEach((n) => { const x = Number(n.getAttribute('x')); n.setAttribute('opacity', x <= len ? 1 : 0); });
        const metres = (len / (1330 - mx)) * Math.min(maxLen, 2.4);
        read.textContent = `${metres.toFixed(2)} m`;
        lockTxt.setAttribute('opacity', seg(t, 4.2, 4.5) * (1 - seg(t, 5.8, 6.0)));
      }
    };
  };

  SCENES.longtape = (c) => {
    const { g, id } = c;
    // site / plot in perspective
    svgFrag(g, `<rect x="-200" y="520" width="2000" height="600" fill="#5b6e3a"/><rect x="-200" y="520" width="2000" height="8" fill="#7d9150"/>
      <rect x="196" y="420" width="16" height="200" fill="#a8733a"/><rect x="1390" y="420" width="16" height="200" fill="#a8733a"/>`);
    const line = el('line', { x1: 260, y1: 520, x2: 260, y2: 520, stroke: '#f2f2ee', 'stroke-width': 6 }, g);
    const tool = Actor(g, c.actorImg, 300); tool.g.setAttribute('filter', `url(#${id}-ds)`);
    const L = c.hasSpec(/30 ?m|100 ?ft/i) ? 30 : 15;
    const read = P.label(g, 800, 240, '0.0 m', { size: 84, fill: '#FFC72C', family: 'JetBrains Mono' });
    const crank = svgFrag(g, '<g><rect x="0" y="-6" width="60" height="12" rx="6" fill="#15171A"/><circle cx="60" cy="0" r="12" fill="#FFC72C"/></g>');
    return {
      dur: 9,
      captions: [[0, `Long-distance tape: up to ${L} m`], [1.2, 'Hook the end on a stake and walk out'], [4.2, 'Precise readings over plots, roads and site layout'], [5.6, 'Fold-out crank winds it back fast ✓']],
      sfx: [[5.8, 'whir']],
      render(t) {
        tool.set({ x: 230, y: 470, o: seg(t, 0, 0.3) });
        const out = ease(seg(t, 1.0, 4.0)) * (1 - ease(seg(t, 5.6, 8.2)));
        const x2 = lerp(300, 1398, out);
        line.setAttribute('x2', x2); line.setAttribute('x1', 300);
        read.textContent = `${(out * L * 0.92).toFixed(1)} m`;
        const [cx, cy] = tool.world(0.5, 0.5);
        crank.setAttribute('transform', `translate(${cx} ${cy}) rotate(${seg(t, 5.6, 8.2) * 1800})`);
        crank.setAttribute('opacity', seg(t, 5.4, 5.7));
      }
    };
  };

  /* ---------- spirit levels ---------- */
  SCENES.level = (c) => {
    const { g, id } = c; const d = c.demo;
    const mason = d.type === 'mason';
    svgFrag(g, mason
      ? `<rect x="-200" y="0" width="2000" height="900" fill="#2b2f34"/>${Array.from({ length: 4 }, (_, r) => Array.from({ length: 9 }, (__, k) => `<rect x="${200 + k * 150 - (r % 2) * 75}" y="${560 + r * 70}" width="142" height="62" rx="4" fill="#a84d32"/>`).join('')).join('')}`
      : `<rect x="-200" y="0" width="2000" height="900" fill="#d8d2c4"/><rect x="380" y="560" width="30" height="120" fill="#59616a"/><rect x="1190" y="560" width="30" height="120" fill="#59616a"/>`);
    const shelf = el('g', {}, g);
    if (!mason) P.wood(shelf, id, -460, 0, 920, 50);
    const tool = Actor(shelf, c.actorImg, d.len || 700); tool.g.setAttribute('filter', `url(#${id}-ds)`);
    const vial = d.vial || [0.5, 0.5];
    const bub = el('g', {}, shelf);
    el('rect', { x: -40, y: -14, width: 80, height: 28, rx: 14, fill: '#c9f08a', opacity: 0.85, stroke: '#15171A', 'stroke-width': 2 }, bub);
    el('line', { x1: -12, y1: -14, x2: -12, y2: 14, stroke: '#15171A', 'stroke-width': 2 }, bub);
    el('line', { x1: 12, y1: -14, x2: 12, y2: 14, stroke: '#15171A', 'stroke-width': 2 }, bub);
    const bubble = el('ellipse', { rx: 11, ry: 8, fill: '#fff', stroke: '#5C8A15', 'stroke-width': 2 }, bub);
    const ok = P.label(g, 800, 250, 'LEVEL ✓', { size: 84, fill: '#7AB51D', family: 'Archivo Black' });
    const ang = P.label(g, 800, 330, '', { size: 40, fill: mason ? '#fff' : '#15171A', family: 'JetBrains Mono' });
    return {
      camera: camPath([[0, 800, 450, 1.0], [1.0, 800, 520, 1.35], [5.6, 800, 520, 1.45], [9, 800, 470, 1.15]]),
      dur: 9,
      captions: [[0, 'Lay it on the surface'], [1.0, 'The bubble floats to the high side'], [2.6, 'Adjust until it sits between the lines…'], [5.4, '…and it\'s perfectly level ✓'], [7, mason ? 'Brick, block and plaster work' : 'Shelves, tiles, frames and fittings']],
      sfx: [[5.4, 'ding']],
      render(t) {
        const a = 4.5 * (1 - backOut(seg(t, 2.6, 5.4))) + (t < 2.6 ? 0 : 0);
        const angle = t < 2.6 ? 4.5 : a;
        shelf.setAttribute('transform', `translate(800 ${mason ? 548 : 560}) rotate(${-angle})`);
        // level lies along the shelf: photo is vertical, so rotate it 90°
        const along = d.horizontal ? 0 : (vial[0] > 0.6 ? -90 : 90);
        tool.set({ x: 0, y: -(tool.w) / 2, r: along, o: seg(t, 0, 0.3) });
        if (d.horizontal) tool.set({ y: -tool.h / 2 });
        const [vx, vy] = tool.world(vial[0], vial[1]);
        bub.setAttribute('transform', `translate(${vx} ${vy})`);
        bubble.setAttribute('cx', clamp(-angle * 7, -26, 26));
        ok.setAttribute('opacity', seg(t, 5.3, 5.6));
        ang.textContent = `${angle >= 0 ? '+' : ''}${angle.toFixed(1)}°`;
        ang.setAttribute('opacity', 1 - seg(t, 5.3, 5.6));
      }
    };
  };

  /* ---------- hammer: three strikes ---------- */
  SCENES.hammer = (c) => {
    const { g, id } = c; const d = c.demo;
    P.bench(g, id, 760);
    P.wood(g, id, 380, 600, 840, 160);
    const nail = svgFrag(g, `<rect x="-7" y="0" width="14" height="190" fill="url(#${id}-steelh)"/><rect x="-26" y="-12" width="52" height="14" rx="5" fill="url(#${id}-steel)"/>`);
    const tool = Actor(g, c.actorImg, 560); tool.g.setAttribute('filter', `url(#${id}-ds)`);
    const flash = el('circle', { r: 60, fill: `url(#${id}-glow)` }, g);
    const chips = Particles(g, 24, (pg) => el('rect', { width: 8, height: 4, fill: '#e9bd80' }, pg));
    const face = d.tip || [0.12, 0.06]; const grip = d.pivot || [0.5, 0.97];
    const strikes = [2.0, 3.6, 5.2];
    return {
      camera: camPath([[0, 800, 420, 0.9], [9, 800, 440, 0.95]]),
      dur: 9,
      captions: [[0, 'Forged head, polished striking face'], [1.2, 'Swing from the shoulder…'], [2.0, '…the anti-shock handle soaks up the vibration'], [5.4, 'Driven flush in 3 strikes ✓'], [6.8, 'Curved claw pulls nails out, too']],
      sfx: strikes.map((s) => [s, 'thud']),
      render(t) {
        // swing: angle of the hammer around the grip point
        let ang = -90;
        for (const s of strikes) {
          if (t > s - 1.1 && t <= s - 0.35) ang = lerp(-90, -30, ease(seg(t, s - 1.1, s - 0.35)));
          else if (t > s - 0.35 && t <= s) ang = lerp(-30, -90, easeIn(seg(t, s - 0.35, s)));
        }
        if (t < strikes[0] - 1.1) ang = lerp(-60, -90, easeOut(seg(t, 0, 0.9)));
        const hits = strikes.filter((s) => t >= s).length;
        const depth = Math.min(3, hits) / 3;
        const headY = 600 - 12 - 120 * (1 - depth) + 12;
        nail.setAttribute('transform', `translate(800 ${600 - 120 * (1 - depth)})`);
        // grip point placement: the face lands on the nail head at -90°
        const strikePose = { r: -90, s: 1 };
        const [fx, fy] = tool.world(face[0], face[1], { ...tool.st, ...strikePose, x: 0, y: 0 });
        const [gx, gy] = tool.world(grip[0], grip[1], { ...tool.st, ...strikePose, x: 0, y: 0 });
        const pivotX = 800 - fx + gx; const pivotY = headY - 12 - fy + gy;
        tool.pin(grip[0], grip[1], pivotX, pivotY, { r: ang });
        tool.set({ o: seg(t, 0, 0.3) });
        const lastHit = strikes.filter((s) => t >= s).pop();
        const fl = lastHit ? 1 - seg(t, lastHit, lastHit + 0.25) : 0;
        flash.setAttribute('transform', `translate(800 ${headY - 12}) scale(${0.6 + (1 - fl)})`);
        flash.setAttribute('opacity', fl);
        chips.update((i) => { const s = strikes[i % 3]; return flyer(Math.floor(i / 3), t, { t0: s, every: 0.01, life: 0.5, ox: 800, oy: 600, sp: 400, angle: -90, spread: 160, g: 1600 }); });
      }
    };
  };

  /* ---------- drill bits: a real drilling demo ---------- */
  function drawTwistBit(g, id, { len = 330, dia = 26, finish = 'steel', carbide = false } = {}) {
    const clipId = `${id}-bitclip-${++UID}`;
    const fill = finish === 'gold' ? `url(#${id}-gold)` : finish === 'black' ? '#2c3136' : `url(#${id}-steel)`;
    return svgFrag(g, `<clipPath id="${clipId}"><path d="M0 ${-dia / 2} L${len - dia} ${-dia / 2} L${len} 0 L${len - dia} ${dia / 2} L0 ${dia / 2} Z"/></clipPath>
      <g clip-path="url(#${clipId})"><rect x="0" y="${-dia / 2}" width="${len}" height="${dia}" fill="${fill}"/>
      <g class="flutes">${Array.from({ length: Math.ceil(len / 22) + 4 }, (_, i) => `<path d="M${i * 22 - 44} ${dia / 2} L${i * 22 - 26} ${-dia / 2}" stroke="${finish === 'black' ? '#15171A' : '#4a5158'}" stroke-width="7" opacity=".75"/>`).join('')}</g>
      ${carbide ? `<rect x="${len - dia * 1.2}" y="${-dia / 2 - 4}" width="${dia * 1.2}" height="${dia + 8}" fill="#9aa3ab"/>` : ''}</g>`);
  }
  SCENES.drill = (c) => {
    const { g, id } = c; const d = c.demo;
    const mat = d.material || 'steel';
    const MAT = {
      steel: { name: 'MILD STEEL', draw: (x) => P.steelPlate(g, id, x, 180, 120, 520), chip: '#c7cdd3', swarf: true },
      stainless: { name: 'STAINLESS STEEL', draw: (x) => P.steelPlate(g, id, x, 180, 120, 520, '#7fb2d8'), chip: '#e3e7ea', swarf: true },
      wood: { name: 'HARDWOOD', draw: (x) => P.wood(g, id, x, 180, 120, 520), chip: '#e9bd80', swarf: false },
      concrete: { name: 'CONCRETE / BRICK', draw: (x) => P.concrete(g, id, x, 180, 160, 520), chip: '#d6d2c9', swarf: false }
    }[mat];
    P.bench(g, id, 760);
    MAT.draw(1040);
    const hole = el('rect', { x: 1040, y: 418, width: 0, height: 34, fill: '#15171A' }, g);
    const rig = el('g', {}, g);
    const drill = drawDrill(rig, id);
    const finish = d.finish || (mat === 'stainless' ? 'gold' : mat === 'concrete' ? 'black' : 'steel');
    const bit = drawTwistBit(rig, id, { finish, carbide: mat === 'concrete', len: d.long ? 420 : 300 });
    bit.setAttribute('transform', 'translate(88 0)');
    const flutes = bit.querySelector('.flutes'); const cs = drill.querySelector('.cstripe');
    const swarf = Particles(g, 40, (pg) => (MAT.swarf
      ? el('path', { d: 'M0 0 C10 -14 24 -2 16 8 C8 18 -6 10 2 2', fill: 'none', stroke: MAT.chip, 'stroke-width': 4 }, pg)
      : el('circle', { r: mat === 'concrete' ? 9 : 5, fill: MAT.chip, filter: mat === 'concrete' ? `url(#${id}-blur)` : null }, pg)));
    const heat = svgFrag(g, `<g transform="translate(250 180)"><rect x="0" y="0" width="300" height="22" rx="11" fill="#3a3f45"/><rect class="hb" x="0" y="0" width="0" height="22" rx="11" fill="#7AB51D"/>
      <text x="0" y="-12" font-family="Barlow Condensed, sans-serif" font-size="24" font-weight="700" fill="#fff">TIP TEMPERATURE</text><text class="ht" x="300" y="-12" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="22" fill="#7AB51D">COOL</text></g>`);
    const matTxt = P.label(g, 1100, 150, MAT.name, { size: 34, fill: '#FFC72C' });
    const through = P.label(g, 800, 860, 'CLEAN HOLE ✓', { size: 50, fill: '#7AB51D', family: 'Archivo Black' });
    productCard(g, c, 230, 180, 220);
    const bitLen = d.long ? 420 : 300;
    const caps = {
      stainless: [[0, 'Cobalt-alloy HSS for the hardest metals'], [1.6, 'Drilling stainless steel…'], [3.4, 'Cobalt keeps its edge hot: no burning out'], [6.4, 'Clean hole, sharp bit ✓']],
      steel: [[0, 'Ground HSS twist bit'], [1.6, 'Drilling mild steel…'], [3.4, 'Flutes clear the chips as it cuts'], [6.4, 'Accurate, clean hole ✓']],
      wood: [[0, d.long ? 'Long-series bit for deep holes' : 'HSS twist bit'], [1.6, 'Drilling through hardwood…'], [3.4, 'Spiral flutes pull shavings out'], [6.4, 'Straight through ✓']],
      concrete: [[0, 'Carbide-tipped masonry bit'], [1.6, 'Drilling concrete & brick…'], [3.4, 'Hard tip chips away at the stone'], [6.4, 'Ready for wall plugs ✓']]
    }[mat];
    return {
      camera: camPath([[0, 820, 450, 0.95], [1.6, 860, 440, 1.1], [6.2, 920, 440, 1.2], [9, 860, 450, 1.0]]),
      dur: 9,
      captions: caps,
      sfx: [[1.4, 'whir']],
      render(t) {
        const p = ease(seg(t, 1.5, 6.2));
        const tipStart = 1040 - 10;
        const tipX = tipStart + p * 120;
        const rigX = tipX - 88 - bitLen;
        rig.setAttribute('transform', `translate(${rigX - (1 - easeOut(seg(t, 0, 1.2))) * 300} 435)`);
        const spinning = t > 1.3 && t < 6.6;
        flutes.setAttribute('transform', `translate(${spinning ? (t * 600) % 22 : 0} 0)`);
        cs.setAttribute('transform', `translate(${spinning ? (t * 300) % 9 : 0} 0)`);
        hole.setAttribute('width', Math.max(0, tipX - 1040));
        swarf.update((i) => (p > 0.02 && p < 0.98 ? flyer(i, t, { t0: 1.6, every: 0.11, life: MAT.swarf ? 1.0 : 1.3, ox: 1036, oy: 435, sp: MAT.swarf ? 260 : 240, angle: -150, spread: 60, g: MAT.swarf ? 700 : mat === 'concrete' ? 100 : 600 }) : null));
        const temp = (mat === 'stainless' || mat === 'steel') ? p * (mat === 'stainless' ? 0.55 : 0.4) : p * 0.25;
        heat.querySelector('.hb').setAttribute('width', 300 * temp);
        heat.querySelector('.ht').textContent = temp < 0.35 ? 'COOL' : temp < 0.6 ? 'WARM' : 'HOT';
        heat.setAttribute('opacity', seg(t, 1.6, 2.0) * (mat === 'concrete' ? 0 : 1));
        matTxt.setAttribute('opacity', seg(t, 0.8, 1.2));
        through.setAttribute('opacity', seg(t, 6.3, 6.6));
      }
    };
  };

  /* ---------- generic fallback: hero spin + zoom (unknown products) ---------- */
  SCENES.showcase = (c) => {
    const { g, id } = c;
    const tool = Actor(g, c.actorImg, 620); tool.g.setAttribute('filter', `url(#${id}-ds)`);
    return {
      dur: 6, captions: [[0, c.product.name]], sfx: [],
      render(t) { tool.set({ x: 800, y: 450, r: Math.sin(t) * 6, s: 1 + seg(t, 0, 6) * 0.15, sx: Math.cos(t * 1.4) * 0.15 + 0.85 }); }
    };
  };

  /* ============================================================
     DEMO TYPES  (what the owner can pick in the dashboard)
     ============================================================ */
  const TYPES = {
    screwdriver: { label: 'Screwdriver: drive a screw', scene: 'screwdriver' },
    bits: { label: 'Screw bits: cordless driver', scene: 'bits' },
    pliers: { label: 'Pliers: grip, twist, cut wire', scene: 'pliers', hinge: true },
    nose: { label: 'Long nose pliers: bend a loop', scene: 'nose', hinge: true },
    diagonal: { label: 'Side cutters: flush cut', scene: 'diagonal', hinge: true },
    cable: { label: 'Cable cutter: cut a cable', scene: 'cable', hinge: true },
    locking: { label: 'Locking pliers: clamp & turn', scene: 'locking', hinge: true },
    'circlip-int': { label: 'Circlip pliers (internal)', scene: 'circlip', hinge: true },
    'circlip-ext': { label: 'Circlip pliers (external)', scene: 'circlip', hinge: true },
    pincers: { label: 'Pincers: pull & nip nails', scene: 'pincers', hinge: true },
    ppr: { label: 'Pipe cutter: cut PPR pipe', scene: 'ppr', hinge: true },
    riveter: { label: 'Rivet gun: set a rivet', scene: 'riveter', hinge: true },
    knife: { label: 'Utility knife: cut & snap', scene: 'knife' },
    hacksaw: { label: 'Hacksaw: cut a pipe', scene: 'hacksaw' },
    planer: { label: 'Planer blades: plane wood', scene: 'planer' },
    disc: { label: 'Cutting disc: cut tile', scene: 'disc' },
    wrench: { label: 'Adjustable wrench: turn a nut', scene: 'wrench' },
    twrench: { label: 'T-wrench: spin a nut', scene: 'twrench' },
    keys: { label: 'Allen keys: hex screw', scene: 'keys' },
    sockets: { label: 'Socket set: ratchet a bolt', scene: 'sockets' },
    tape: { label: 'Pocket tape: measure', scene: 'tape' },
    longtape: { label: 'Long tape: measure a plot', scene: 'longtape' },
    level: { label: 'Spirit level: level a shelf', scene: 'level' },
    mason: { label: 'Mason level: on brickwork', scene: 'level' },
    hammer: { label: 'Hammer: drive a nail', scene: 'hammer' },
    drill: { label: 'Drill bit: drill a hole', scene: 'drill' },
    showcase: { label: 'Showcase only', scene: 'showcase' }
  };

  /* ============================================================
     PLAYER
     ============================================================ */
  const SFX = (() => {
    let ac = null; let on = false;
    const ctx = () => { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { ac = null; } } return ac; };
    function noise(dur, freq, q, vol) {
      const a = ctx(); if (!a) return;
      const len = Math.floor(a.sampleRate * dur); const buf = a.createBuffer(1, len, a.sampleRate); const ch = buf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
      const src = a.createBufferSource(); src.buffer = buf;
      const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const gn = a.createGain(); gn.gain.value = vol;
      src.connect(f).connect(gn).connect(a.destination); src.start();
    }
    function tone(freq, dur, vol, type = 'sine', slide = 0) {
      const a = ctx(); if (!a) return;
      const o = a.createOscillator(); const gn = a.createGain(); o.type = type; o.frequency.value = freq;
      if (slide) o.frequency.linearRampToValueAtTime(freq + slide, a.currentTime + dur);
      gn.gain.setValueAtTime(vol, a.currentTime); gn.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
      o.connect(gn).connect(a.destination); o.start(); o.stop(a.currentTime + dur);
    }
    const play = {
      click: () => noise(0.05, 3000, 2, 0.6), snip: () => { noise(0.08, 5000, 1, 0.8); tone(1800, 0.06, 0.08, 'square'); },
      thud: () => { tone(110, 0.25, 0.5, 'sine', -60); noise(0.12, 600, 1, 0.6); }, ratchet: () => { for (let i = 0; i < 3; i++) setTimeout(() => noise(0.03, 4200, 3, 0.5), i * 45); },
      ding: () => { tone(1320, 0.5, 0.15); tone(1980, 0.4, 0.08); }, whir: () => tone(180, 1.6, 0.12, 'sawtooth', 220), grind: () => { tone(260, 3.5, 0.08, 'sawtooth', 60); noise(3, 2500, 0.6, 0.15); },
      saw: () => noise(0.35, 1800, 0.8, 0.35), snap: () => { noise(0.04, 6000, 2, 0.9); }
    };
    return { get on() { return on; }, set on(v) { on = v; if (v) ctx()?.resume?.(); }, fire(n) { if (on) play[n]?.(); } };
  })();

  function specText(product, i) { const s = product.specs[i]; return s ? { label: s.label, value: s.value } : null; }

  /** Builds and runs a demo inside `host`. mode: 'full' | 'inline' | 'preview' */
  async function create(host, product, { mode = 'full', onBuy = null, onClose = null, autoplay = true } = {}) {
    const demo = { type: 'showcase', img: 0, ...(product.demo || {}) };
    const urls = product.images.slice(0, 4);
    // prefer the sharp HD cut-out (catalog photos have one) for zooms; fall back to the normal photo
    const hdFirst = async (u) => (/^\/uploads\/npi-p\d+-\d+-[0-9a-f]{8}\.webp$/.test(u) ? (await loadImg(u.replace('.webp', '-hd.webp'))) || loadImg(u) : loadImg(u));
    const imgs = (await Promise.all(urls.map(mode === 'preview' ? loadImg : hdFirst))).filter(Boolean);
    if (!imgs.length) return null;
    const actorImg = imgs[demo.img] || imgs[0];
    const id = `d${++UID}`;
    host.classList.add('demo', `demo-${mode}`);
    host.innerHTML = '';
    const stage = document.createElement('div'); stage.className = 'demo-stage'; host.append(stage);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'demo-svg', role: 'img', 'aria-label': `${product.name} demo video` }, null);
    stage.append(svg);
    el('defs', {}, svg).innerHTML = defsMarkup(id);
    el('rect', { x: 0, y: 0, width: W, height: H, fill: `url(#${id}-spot)` }, svg);
    const cam = el('g', {}, svg);
    const overlay = el('g', { class: 'demo-ov' }, svg);
    const hud = document.createElement('div'); hud.className = 'demo-hud'; stage.append(hud);
    hud.innerHTML = '<div class="demo-chip"></div><div class="demo-cap"></div>';
    const chip = hud.querySelector('.demo-chip'); const cap = hud.querySelector('.demo-cap');

    const specs = product.specs || [];
    const hasSpec = (re) => re.test(`${product.name} ${specs.map((s) => `${s.label} ${s.value}`).join(' ')}`);
    const chapters = [];
    const mkGroup = () => { const g = el('g', {}, cam); g.style.display = 'none'; return g; };

    /* --- intro --- */
    if (mode === 'full' || mode === 'inline') {
      const g = mkGroup();
      el('ellipse', { cx: 800, cy: 760, rx: 360, ry: 40, fill: '#000', opacity: 0.45, filter: `url(#${id}-blur)` }, g);
      el('circle', { cx: 800, cy: 430, r: 360, fill: `url(#${id}-glow)` }, g);
      const a = Actor(g, actorImg, 640); a.g.setAttribute('filter', `url(#${id}-ds)`);
      const sweep = el('rect', { x: -300, y: 0, width: 160, height: 900, fill: '#fff', opacity: 0.08, transform: 'skewX(-20)' }, g);
      chapters.push({
        name: 'intro', label: product.category?.name || 'NPI Global', dur: 3.2, g,
        captions: [[0, product.name]],
        render(t) {
          const k = backOut(seg(t, 0, 1.1));
          a.set({ x: lerp(800, 560, ease(seg(t, 1.6, 3.0))), y: 430 + (1 - k) * 200, r: (1 - k) * -14 + Math.sin(t * 1.5) * 2, s: 0.85 + 0.15 * k, o: seg(t, 0, 0.4) });
          sweep.setAttribute('x', lerp(-300, 2000, seg(t, 0.6, 2.2)));
        },
        overlay(t) {
          return `<g opacity="${seg(t, 1.7, 2.3)}" transform="translate(${lerp(1060, 1000, easeOut(seg(t, 1.7, 2.6)))} 0)">
            <text x="0" y="330" font-family="Barlow Condensed, sans-serif" font-size="30" font-weight="700" fill="#7AB51D" letter-spacing="4">${esc((product.category?.name || '').toUpperCase())}</text>
            ${wrapText(product.name, 18).map((ln, i) => `<text x="0" y="${400 + i * 66}" font-family="Archivo Black, sans-serif" font-size="58" fill="#fff">${esc(ln.toUpperCase())}</text>`).join('')}
            <text x="0" y="${430 + wrapText(product.name, 18).length * 66}" font-family="JetBrains Mono, monospace" font-size="44" font-weight="700" fill="#FFC72C">${esc(NPI.money(product.pricing.price))}</text></g>`;
        }
      });
    }

    /* --- close-ups: one per spec with a spot on the photo --- */
    if (mode === 'full' || mode === 'inline') {
      const spots = (demo.spots || []).map((s, i) => (s && specs[i] ? { u: s[0], v: s[1], i } : null)).filter(Boolean).slice(0, 4);
      if (spots.length) {
        const g = mkGroup();
        const a = Actor(g, actorImg, 760); a.set({ x: 800, y: 450 });
        const per = 2.6;
        const camAt = (t) => {
          const k = Math.min(spots.length - 1, Math.floor(t / per)); const lt = t - k * per;
          const s = spots[k]; const prev = spots[k - 1];
          const [tx, ty] = a.world(s.u, s.v);
          const [px, py] = prev ? a.world(prev.u, prev.v) : [800, 450];
          const m = ease(seg(lt, 0, 0.8));
          return { k, lt, x: lerp(px, tx, m), y: lerp(py, ty, m), z: lerp(prev ? 2.4 : 1, 2.4, m) + seg(lt, 0.8, per) * 0.25 };
        };
        chapters.push({
          name: 'closeups', label: 'Close-up', dur: per * spots.length, g, camera: camAt,
          captions: spots.map((s, k) => [k * per, `${specs[s.i].label}: ${specs[s.i].value}`]),
          render() {},
          overlay(t) {
            const { k, lt } = camAt(t); const s = specs[spots[k].i];
            const o = seg(lt, 0.7, 1.0) * (1 - seg(lt, per - 0.25, per));
            const len = seg(lt, 0.7, 1.1);
            return `<g opacity="${o}"><circle cx="800" cy="450" r="${lerp(140, 110, len)}" fill="none" stroke="#FFC72C" stroke-width="5"/>
              <line x1="910" y1="450" x2="${910 + 170 * len}" y2="${450 - 120 * len}" stroke="#FFC72C" stroke-width="4"/>
              <g transform="translate(1090 ${330 - 0})"><rect x="0" y="-60" width="460" height="${s.value.length > 22 ? 150 : 120}" rx="10" fill="#15171A" opacity=".88"/>
              <text x="24" y="-18" font-family="Barlow Condensed, sans-serif" font-size="30" font-weight="700" fill="#7AB51D" letter-spacing="2">${esc(s.label.toUpperCase())}</text>
              ${wrapText(s.value, 22).slice(0, 2).map((ln, i) => `<text x="24" y="${30 + i * 44}" font-family="Archivo Black, sans-serif" font-size="38" fill="#fff">${esc(ln)}</text>`).join('')}</g></g>`;
          }
        });
      }
    }

    /* --- flip (2-way screwdrivers) --- */
    if ((mode === 'full' || mode === 'inline') && demo.flip) {
      const g = mkGroup();
      const sc = SCENES.flip({ g, id, actorImg, imgs, product, demo, specs, hasSpec });
      chapters.push({ name: 'flip', label: 'Reversible blade', dur: sc.dur, g, captions: sc.captions, sfx: sc.sfx, render: sc.render });
    }

    /* --- the working demo --- */
    {
      const g = mkGroup();
      const type = TYPES[demo.type] ? demo.type : 'showcase';
      const sc = SCENES[TYPES[type].scene]({ g, id, actorImg, imgs, product, demo: { ...demo, type }, specs, hasSpec });
      chapters.push({ name: 'work', label: 'In action', dur: sc.dur, g, captions: sc.captions, sfx: sc.sfx, render: sc.render, camera: sc.camera });
    }

    /* --- uses + buy --- */
    if (mode === 'full' || mode === 'inline') {
      const g = mkGroup();
      const a = Actor(g, actorImg, 600); a.g.setAttribute('filter', `url(#${id}-ds)`);
      const uses = (product.uses || []).slice(0, 4);
      chapters.push({
        name: 'uses', label: 'Made for', dur: Math.max(3, 1.2 + uses.length * 0.7), g,
        captions: [[0, 'Made for']],
        render(t) { a.set({ x: 430, y: 450, r: Math.sin(t) * 3, o: 1 }); },
        overlay(t) {
          return `<text x="760" y="250" font-family="Barlow Condensed, sans-serif" font-size="34" font-weight="700" fill="#7AB51D" letter-spacing="4" opacity="${seg(t, 0, 0.4)}">MADE FOR</text>
            ${uses.map((u, i) => { const o = seg(t, 0.5 + i * 0.7, 0.9 + i * 0.7); return `<g opacity="${o}" transform="translate(${760 + (1 - o) * 40} ${320 + i * 90})"><circle cx="20" cy="-14" r="20" fill="#7AB51D"/><text x="20" y="-4" text-anchor="middle" font-size="26" fill="#fff">✓</text><text x="60" y="0" font-family="Barlow, sans-serif" font-size="38" font-weight="600" fill="#fff">${esc(u)}</text></g>`; }).join('')}`;
        }
      });
      const g2 = mkGroup();
      const a2 = Actor(g2, actorImg, 560); a2.g.setAttribute('filter', `url(#${id}-ds)`);
      el('circle', { cx: 480, cy: 450, r: 330, fill: `url(#${id}-glow)` }, g2);
      g2.append(a2.g);
      const pr = product.pricing;
      chapters.push({
        name: 'buy', label: 'Get yours', dur: 3.5, g: g2, captions: [[0, pr.onSale ? `${pr.label || 'Sale'}: save ${pr.savePercent}%` : 'In stock, ready to ship']],
        render(t) { a2.set({ x: 480, y: 450, r: Math.sin(t * 2) * 3, s: 0.95 + 0.05 * backOut(seg(t, 0, 0.8)) }); },
        overlay(t) {
          return `<g opacity="${seg(t, 0.2, 0.7)}"><text x="860" y="330" font-family="Archivo Black, sans-serif" font-size="54" fill="#fff">${esc(wrapText(product.name, 20)[0].toUpperCase())}</text>
            ${pr.onSale ? `<text x="860" y="410" font-family="JetBrains Mono, monospace" font-size="36" fill="#8A9199" text-decoration="line-through">${esc(NPI.money(pr.list))}</text>` : ''}
            <text x="860" y="${pr.onSale ? 490 : 420}" font-family="JetBrains Mono, monospace" font-size="72" font-weight="700" fill="#FFC72C">${esc(NPI.money(pr.price))}</text>
            <text x="860" y="${pr.onSale ? 550 : 480}" font-family="Barlow, sans-serif" font-size="30" fill="#C7CCD1">${product.stock.status === 'low' ? `Only ${product.stock.left} left` : product.stock.status === 'out' ? 'Back soon' : 'In stock · Cash on delivery'}</text></g>`;
        }
      });
    }

    const total = chapters.reduce((s, ch) => s + ch.dur, 0);
    let acc = 0; chapters.forEach((ch) => { ch.start = acc; acc += ch.dur; });

    /* --- controls --- */
    let controls = null;
    if (mode !== 'preview') {
      controls = document.createElement('div'); controls.className = 'demo-controls';
      controls.innerHTML = `<button type="button" class="dc-play" aria-label="Pause">❚❚</button>
        <div class="dc-track" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="${total.toFixed(1)}"><div class="dc-fill"></div>${chapters.map((ch) => `<span class="dc-mark" data-at="${ch.start}" title="${esc(ch.label)}"></span>`).join('')}</div>
        <span class="dc-time">0:00</span><button type="button" class="dc-snd" aria-label="Sound">🔇</button>
        ${mode === 'full' && onBuy ? '<button type="button" class="dc-buy">Add to cart</button>' : ''}`;
      host.append(controls);
      controls.querySelectorAll('.dc-mark').forEach((m) => { m.style.left = `${(Number(m.dataset.at) / total) * 100}%`; });
    }

    let t = 0; let playing = false; let raf = 0; let last = 0; let current = null; let destroyed = false;
    const loop = mode === 'preview';
    function chapterAt(time) { return chapters.find((ch) => time >= ch.start && time < ch.start + ch.dur) || chapters[chapters.length - 1]; }
    function render(time, prev = null) {
      const ch = chapterAt(time); const lt = Math.min(ch.dur - 0.0001, time - ch.start);
      if (ch !== current) { chapters.forEach((c2) => { c2.g.style.display = c2 === ch ? '' : 'none'; }); current = ch; }
      ch.render(lt);
      const camv = ch.camera ? ch.camera(lt) : null;
      cam.setAttribute('transform', camv ? `translate(800 450) scale(${camv.z}) translate(${-camv.x} ${-camv.y})` : '');
      overlay.innerHTML = ch.overlay ? ch.overlay(lt) : '';
      const capNow = (ch.captions || []).filter(([ct]) => ct <= lt).pop();
      const text = capNow ? capNow[1] : '';
      if (cap.textContent !== text) { cap.textContent = text; cap.classList.remove('in'); void cap.offsetWidth; cap.classList.add('in'); }
      chip.textContent = mode === 'preview' ? '▶ In action' : `${chapters.indexOf(ch) + 1}/${chapters.length} · ${ch.label}`;
      if (prev !== null && playing && ch.sfx) {
        const plt = prev - ch.start;
        ch.sfx.forEach(([st, name]) => { if (st > plt && st <= lt) SFX.fire(name); });
      }
      if (controls) {
        controls.querySelector('.dc-fill').style.width = `${(time / total) * 100}%`;
        const s = Math.floor(time); controls.querySelector('.dc-time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} / ${Math.floor(total / 60)}:${String(Math.floor(total % 60)).padStart(2, '0')}`;
      }
    }
    function frame(ts) {
      if (destroyed) return;
      const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0; last = ts;
      const prev = t;
      t += dt;
      if (loop) { const w = chapters[chapters.length - 1]; if (t >= total) t = w.start; }
      else if (t >= total) { t = total - 0.001; render(t, prev); pause(); return; }
      render(t, prev);
      raf = requestAnimationFrame(frame);
    }
    function play() { if (playing || destroyed) return; if (!loop && t >= total - 0.01) t = 0; playing = true; last = 0; raf = requestAnimationFrame(frame); if (controls) { controls.querySelector('.dc-play').textContent = '❚❚'; controls.querySelector('.dc-play').setAttribute('aria-label', 'Pause'); } host.classList.add('is-playing'); }
    function pause() { playing = false; cancelAnimationFrame(raf); if (controls) { controls.querySelector('.dc-play').textContent = '▶'; controls.querySelector('.dc-play').setAttribute('aria-label', 'Play'); } host.classList.remove('is-playing'); }
    function seek(time) { t = clamp(time, 0, total - 0.001); render(t); }

    if (controls) {
      controls.querySelector('.dc-play').addEventListener('click', () => (playing ? pause() : play()));
      const track = controls.querySelector('.dc-track');
      const fromEvent = (e) => { const r = track.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * total; };
      let dragging = false;
      track.addEventListener('pointerdown', (e) => { dragging = true; track.setPointerCapture(e.pointerId); seek(fromEvent(e)); });
      track.addEventListener('pointermove', (e) => { if (dragging) seek(fromEvent(e)); });
      track.addEventListener('pointerup', () => { dragging = false; });
      track.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') seek(t + 2); if (e.key === 'ArrowLeft') seek(t - 2); });
      const snd = controls.querySelector('.dc-snd');
      snd.textContent = SFX.on ? '🔊' : '🔇';
      snd.addEventListener('click', () => { SFX.on = !SFX.on; snd.textContent = SFX.on ? '🔊' : '🔇'; });
      controls.querySelector('.dc-buy')?.addEventListener('click', (e) => onBuy(e.currentTarget));
    }
    stage.addEventListener('click', () => { if (mode !== 'preview') (playing ? pause() : play()); });
    if (mode === 'preview') t = chapters[chapters.length - 1].start;
    render(t);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (autoplay && !reduced) play();
    return {
      play, pause, seek, get playing() { return playing; },
      destroy() { destroyed = true; pause(); host.innerHTML = ''; host.classList.remove('demo', `demo-${mode}`, 'is-playing'); onClose?.(); }
    };
  }

  function wrapText(s, max) {
    const words = String(s).split(/\s+/); const lines = []; let cur = '';
    for (const w of words) { if ((`${cur} ${w}`).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = `${cur} ${w}`.trim(); }
    if (cur) lines.push(cur);
    return lines.slice(0, 3);
  }

  /* ---------------- full-screen modal player ---------------- */
  let open = null;
  async function openModal(product, { onBuy } = {}) {
    open?.close();
    const d = document.createElement('dialog'); d.className = 'demo-modal';
    d.innerHTML = `<div class="dm-head"><div><span class="dm-eyebrow">PRODUCT VIDEO</span><b class="dm-title"></b></div><button type="button" class="dm-close" aria-label="Close video">✕</button></div><div class="dm-body"></div>
      <div class="dm-foot"><span class="dm-hint">Tap the video to pause · drag the bar to jump between chapters</span><a class="dm-more" href="/product/${encodeURIComponent(product.slug)}" data-link>Full details →</a></div>`;
    d.querySelector('.dm-title').textContent = product.name;
    document.body.append(d);
    d.showModal();
    let player = null;
    const close = () => { player?.destroy(); d.close(); };
    d.addEventListener('close', () => { player?.destroy(); d.remove(); open = null; });
    d.querySelector('.dm-close').addEventListener('click', close);
    d.addEventListener('click', (e) => { if (e.target === d) close(); });
    d.querySelector('.dm-more').addEventListener('click', () => close());
    player = await create(d.querySelector('.dm-body'), product, { mode: 'full', onBuy });
    open = { close };
    return player;
  }

  return { create, openModal, TYPES, SCENES };
})();
