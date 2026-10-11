/* ============================================================
   Tool Lab — interactive physics-flavoured simulations.
   Each sim works with mouse, touch and keyboard, and returns a
   destroy() function so pages can unmount it cleanly.
   ============================================================ */
'use strict';

const NPI_SIMS = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const META = {
    torque: { title: 'Torque Wrench', icon: 'wrench', how: 'Drag around the bolt (or press →) to tighten. Set a target — the wrench clicks the moment you reach it.', lesson: 'A click-type wrench stops you over-tightening and stripping threads.' },
    screw: { title: 'Precision Screwdriver', icon: 'screwdriver', how: 'Drag left ↔ right across the stage (or press →) to drive the screw. Go too fast and the tip cams out.', lesson: 'A Lasertip-style tip bites into the screw head, so you can push harder without slipping.' },
    hammer: { title: 'Claw Hammer', icon: 'hammer', how: 'Tap, click or press Space when the power bar is in the green zone. Drive the nail in as few strikes as you can.', lesson: 'A steady swing in the sweet spot sinks a nail faster than brute force.' },
    tape: { title: 'Tape Measure', icon: 'tape', how: 'Drag the yellow hook to pull out the blade. Past 12 ft of standout it starts to sag. Lock it to keep the reading.', lesson: 'A wide, cupped blade stays rigid further, so you can measure alone.' },
    level: { title: 'Torpedo Level', icon: 'level', how: 'Drag up/down on the stage (or use ↑ ↓) to tilt the shelf until the bubble is centred. On a phone, try the tilt sensor.', lesson: 'The bubble always floats to the high side. Centre it and you are level.' },
    cutter: { title: 'Diagonal Cutters', icon: 'pliers', how: 'Press and drag downward (or hold ↓) to squeeze the handles. Thicker wire needs a firmer squeeze.', lesson: 'Long handles multiply your hand force about 4.5×, right at the cutting edge.' },
    knife: { title: 'Utility Knife', icon: 'knife', how: 'Press at the left marker and drag along the dashed line to score the board. Lock the blade first!', lesson: 'A locked blade cuts straighter and safer.' },
    saw: { title: 'Hand Saw', icon: 'saw', how: 'Drag left ↔ right in long strokes (or tap ← →) to saw through the plank.', lesson: 'Long, even strokes use more of the blade, so you cut faster with less effort.' }
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const vibrate = (ms) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };

  function shell(container, key, svgInner, controls = '') {
    const m = META[key];
    container.classList.add('sim');
    container.innerHTML = `
      <div class="sim-stage" tabindex="0" role="application" aria-label="${m.title} simulation. ${m.how}">
        <svg viewBox="0 0 400 260" class="sim-svg">${svgInner}</svg>
        <div class="sim-flash" data-ref="flash"></div>
      </div>
      <div class="sim-bar">
        <div class="sim-readout" data-ref="readout" aria-live="polite"></div>
        <div class="sim-controls">${controls}<button type="button" class="sim-btn" data-ref="reset">↺ Reset</button></div>
      </div>
      <p class="sim-how">${m.how}</p>`;
    const q = (r) => container.querySelector(`[data-ref="${r}"]`);
    const stage = container.querySelector('.sim-stage');
    const svg = container.querySelector('svg');
    const toSvg = (e) => {
      const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
      return p.matrixTransform(svg.getScreenCTM().inverse());
    };
    const flash = (text, cls = '') => {
      const f = q('flash');
      f.textContent = text;
      f.className = `sim-flash show ${cls}`;
      clearTimeout(f._t);
      f._t = setTimeout(() => { f.className = 'sim-flash'; }, 1100);
    };
    const listeners = [];
    const on = (el, ev, fn, opts) => { el.addEventListener(ev, fn, opts); listeners.push(() => el.removeEventListener(ev, fn, opts)); };
    const drag = (onStart, onMove, onEnd) => {
      let active = false;
      on(stage, 'pointerdown', (e) => { active = true; stage.setPointerCapture(e.pointerId); onStart?.(toSvg(e), e); e.preventDefault(); });
      on(stage, 'pointermove', (e) => { if (active) onMove?.(toSvg(e), e); });
      const end = (e) => { if (!active) return; active = false; onEnd?.(toSvg(e), e); };
      on(stage, 'pointerup', end); on(stage, 'pointercancel', end);
    };
    let raf = 0;
    const loop = (fn) => { const step = (t) => { fn(t); raf = requestAnimationFrame(step); }; raf = requestAnimationFrame(step); };
    const destroy = () => { cancelAnimationFrame(raf); listeners.forEach((f) => f()); container.innerHTML = ''; container.classList.remove('sim'); };
    return { q, stage, svg, toSvg, flash, on, drag, loop, destroy, readout: (t) => { q('readout').innerHTML = t; } };
  }

  /* ---------------- 1. TORQUE WRENCH ---------------- */
  function torque(el) {
    const s = shell(el, 'torque', `
      <defs><radialGradient id="tq-bg"><stop offset="0" stop-color="#2a2e33"/><stop offset="1" stop-color="#15171A"/></radialGradient></defs>
      <rect width="400" height="260" fill="url(#tq-bg)"/>
      <rect x="120" y="60" width="160" height="140" rx="10" fill="#3a3d40" stroke="#555" />
      <circle cx="200" cy="130" r="26" fill="#8A9199"/>
      <g data-ref="bolt"><polygon points="200,112 215.6,121 215.6,139 200,148 184.4,139 184.4,121" fill="#C7CCD1" stroke="#15171A" stroke-width="2"/>
        <line x1="200" y1="118" x2="200" y2="124" stroke="#15171A" stroke-width="2"/></g>
      <g data-ref="wrench">
        <circle cx="200" cy="130" r="24" fill="none" stroke="#7AB51D" stroke-width="10"/>
        <rect x="220" y="122" width="150" height="16" rx="8" fill="#7AB51D" stroke="#15171A" stroke-width="2"/>
        <rect x="300" y="119" width="68" height="22" rx="10" fill="#FFC72C" stroke="#15171A" stroke-width="2"/>
        <circle cx="352" cy="130" r="5" fill="#15171A"/>
      </g>
      <g transform="translate(62 200)">
        <path d="M-44 0 A44 44 0 0 1 44 0" fill="none" stroke="#3a3d40" stroke-width="10"/>
        <path data-ref="arc" d="M-44 0 A44 44 0 0 1 44 0" fill="none" stroke="#7AB51D" stroke-width="10" stroke-dasharray="138.2" stroke-dashoffset="138.2"/>
        <line data-ref="target" x1="0" y1="0" x2="0" y2="-50" stroke="#FFC72C" stroke-width="2"/>
        <line data-ref="needle" x1="0" y1="0" x2="-40" y2="0" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
        <circle r="5" fill="#fff"/>
        <text y="22" text-anchor="middle" fill="#8A9199" font-size="10" font-family="JetBrains Mono, monospace">Nm</text>
      </g>`,
    `<label class="sim-label">Target <input data-ref="tgt" type="range" min="10" max="60" step="5" value="25"> <b data-ref="tgtv">25</b> Nm</label>`);
    const MAX = 70;
    let rot = 0; let torqueNm = 0; let clicked = false; let lastAng = null; let kick = 0;
    const tgt = () => Number(s.q('tgt').value);
    const draw = () => {
      const a = rot - kick;
      s.q('wrench').setAttribute('transform', `rotate(${a} 200 130)`);
      s.q('bolt').setAttribute('transform', `rotate(${rot} 200 130)`);
      const f = clamp(torqueNm / MAX, 0, 1);
      s.q('arc').setAttribute('stroke-dashoffset', String(138.2 * (1 - f)));
      s.q('arc').setAttribute('stroke', clicked ? '#FFC72C' : '#7AB51D');
      s.q('needle').setAttribute('transform', `rotate(${f * 180})`);
      s.q('target').setAttribute('transform', `rotate(${(tgt() / MAX) * 180 - 90})`);
      s.q('tgtv').textContent = String(tgt());
      s.readout(`<span class="ro-big">${torqueNm.toFixed(1)} Nm</span><span>${clicked ? '<b class="ok">CLICK ✓ target reached</b>' : rot < 90 ? 'Running down the bolt…' : 'Tightening…'}</span>`);
    };
    const turn = (deg) => {
      if (deg <= 0) return;
      if (clicked) { kick = 0; draw(); return; }
      rot += deg;
      torqueNm = Math.max(0, (rot - 90) * 0.12);
      if (torqueNm >= tgt()) {
        torqueNm = tgt(); clicked = true; kick = 6; vibrate(60);
        s.flash('CLICK!', 'gold');
        setTimeout(() => { kick = 0; draw(); }, 140);
      }
      draw();
    };
    s.drag((p) => { lastAng = Math.atan2(p.y - 130, p.x - 200) * 180 / Math.PI; },
      (p) => {
        const a = Math.atan2(p.y - 130, p.x - 200) * 180 / Math.PI;
        let d = a - lastAng; if (d > 180) d -= 360; if (d < -180) d += 360;
        lastAng = a; turn(d);
      });
    s.on(s.stage, 'keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { turn(6); e.preventDefault(); } });
    s.on(s.q('tgt'), 'input', () => { if (torqueNm < tgt()) clicked = false; draw(); });
    s.on(s.q('reset'), 'click', () => { rot = 0; torqueNm = 0; clicked = false; draw(); });
    draw();
    return s.destroy;
  }

  /* ---------------- 2. SCREWDRIVER ---------------- */
  function screw(el) {
    let threads = '';
    for (let i = -2; i < 22; i++) threads += `<line x1="192" y1="${i * 8}" x2="208" y2="${i * 8 + 5}" stroke="#5c6166" stroke-width="2"/>`;
    const s = shell(el, 'screw', `
      <rect width="400" height="260" fill="#F3F1EA"/>
      <rect x="40" y="150" width="320" height="90" fill="#c99a5b"/>
      <path d="M40 170 C120 165 200 178 360 168 M40 200 C150 195 230 210 360 198 M40 225 C120 222 260 232 360 226" stroke="#a87b40" stroke-width="2" fill="none"/>
      <rect x="40" y="150" width="320" height="6" fill="#b78645"/>
      <g data-ref="screw">
        <clipPath id="sc-clip"><rect x="192" y="0" width="16" height="120"/></clipPath>
        <rect x="192" y="0" width="16" height="120" fill="#C7CCD1"/>
        <g clip-path="url(#sc-clip)"><g data-ref="threads">${threads}</g></g>
        <path d="M192 120 L200 136 L208 120 Z" fill="#C7CCD1"/>
        <rect x="182" y="-8" width="36" height="10" rx="3" fill="#8A9199" stroke="#15171A" stroke-width="1.5"/>
      </g>
      <g data-ref="driver">
        <rect x="196" y="-70" width="8" height="64" fill="#C7CCD1" stroke="#15171A" stroke-width="1.5"/>
        <rect x="180" y="-150" width="40" height="82" rx="8" fill="#7AB51D" stroke="#15171A" stroke-width="2"/>
        <rect x="180" y="-150" width="40" height="14" rx="6" fill="#FFC72C"/>
        <g data-ref="grip"><line x1="190" y1="-130" x2="190" y2="-72" stroke="#15171A" opacity=".3" stroke-width="2"/>
        <line x1="200" y1="-130" x2="200" y2="-72" stroke="#15171A" opacity=".3" stroke-width="2"/>
        <line x1="210" y1="-130" x2="210" y2="-72" stroke="#15171A" opacity=".3" stroke-width="2"/></g>
      </g>`);
    const TOTAL = 112; let depth = 0; let angle = 0; let lastX = null; let lastT = 0; let done = false; let camouts = 0;
    const draw = () => {
      const y = 38 + depth;
      s.q('screw').setAttribute('transform', `translate(0 ${y})`);
      s.q('driver').setAttribute('transform', `translate(0 ${y})`);
      s.q('threads').setAttribute('transform', `translate(0 ${((angle % 360) / 360) * 8})`);
      s.q('grip').setAttribute('transform', `translate(${Math.sin(angle * Math.PI / 180) * 4} 0)`);
      const pct = Math.round((depth / TOTAL) * 100);
      s.readout(`<span class="ro-big">${pct}% driven</span><span>${(angle / 360).toFixed(1)} turns · ${camouts} cam-out${camouts === 1 ? '' : 's'}${done ? ' · <b class="ok">Flush ✓</b>' : ''}</span>`);
    };
    const advance = (deg, speed) => {
      if (done || deg <= 0) return;
      if (speed > 2.6) { camouts++; s.flash('CAM-OUT! Slow down', 'red'); vibrate(30); s.stage.classList.add('shake'); setTimeout(() => s.stage.classList.remove('shake'), 300); return; }
      angle += deg;
      depth = clamp(depth + deg / 360 * 14, 0, TOTAL);
      if (depth >= TOTAL) { done = true; s.flash('FLUSH ✓', 'green'); vibrate(50); }
      draw();
    };
    s.drag((p) => { lastX = p.x; lastT = performance.now(); },
      (p) => {
        const t = performance.now(); const dx = Math.abs(p.x - lastX); const dt = Math.max(1, t - lastT);
        lastX = p.x; lastT = t;
        advance(dx * 1.6, (dx * 1.6) / dt);
      });
    s.on(s.stage, 'keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { advance(30, 0.5); e.preventDefault(); } });
    s.on(s.q('reset'), 'click', () => { depth = 0; angle = 0; done = false; camouts = 0; draw(); });
    draw();
    return s.destroy;
  }

  /* ---------------- 3. HAMMER ---------------- */
  function hammer(el) {
    const s = shell(el, 'hammer', `
      <rect width="400" height="260" fill="#F3F1EA"/>
      <rect x="60" y="180" width="280" height="70" fill="#c99a5b"/><rect x="60" y="180" width="280" height="6" fill="#b78645"/>
      <path d="M60 205 C150 200 230 214 340 204 M60 232 C150 228 260 238 340 230" stroke="#a87b40" stroke-width="2" fill="none"/>
      <g data-ref="nail"><rect x="196" y="0" width="8" height="80" fill="#8A9199"/><rect x="186" y="-4" width="28" height="6" rx="2" fill="#5c6166"/></g>
      <g data-ref="hammer">
        <rect x="216" y="-14" width="120" height="12" rx="5" fill="#8A9199" stroke="#15171A" stroke-width="2"/>
        <rect x="290" y="-16" width="46" height="16" rx="6" fill="#FFC72C" stroke="#15171A" stroke-width="2"/>
        <path d="M184 -30 h44 v34 h-44 z" fill="#15171A"/><rect x="184" y="-30" width="44" height="7" fill="#3a3d40"/>
      </g>
      <g transform="translate(24 30)">
        <rect width="18" height="150" rx="4" fill="#3a3d40"/>
        <rect y="15" width="18" height="33" fill="#7AB51D" opacity=".85"/>
        <rect data-ref="power" y="150" width="18" height="0" rx="3" fill="#FFC72C"/>
        <text x="9" y="168" text-anchor="middle" font-size="9" fill="#5c6166" font-family="JetBrains Mono, monospace">PWR</text>
      </g>`);
    let sunk = 0; let hits = 0; let power = 0; let swinging = 0; let done = false; const t0 = performance.now();
    const best = NPI.store.get('npi_sim_hammer_best', null);
    let bestHits = best;
    const draw = () => {
      const nailY = 180 - (80 - sunk);
      s.q('nail').setAttribute('transform', `translate(0 ${nailY + 4})`);
      const rot = swinging > 0 ? -2 : -38;
      s.q('hammer').setAttribute('transform', `translate(0 ${nailY}) rotate(${rot} 330 -8)`);
      s.readout(`<span class="ro-big">${Math.round((sunk / 80) * 100)}% in</span><span>${hits} strike${hits === 1 ? '' : 's'}${bestHits ? ` · best ${bestHits}` : ''}${done ? ' · <b class="ok">Driven ✓</b>' : ''}</span>`);
    };
    const strike = () => {
      if (done || swinging > 0) return;
      hits++; swinging = 1;
      const pw = power;
      let gain;
      if (pw >= 68 && pw <= 90) { gain = 22; s.flash('PERFECT!', 'green'); vibrate(35); }
      else if (pw > 95) { gain = 5; s.flash('Glancing blow', 'red'); }
      else { gain = Math.max(3, pw * 0.16); s.flash(pw < 40 ? 'Too soft' : 'Good', ''); }
      sunk = clamp(sunk + gain, 0, 80);
      if (sunk >= 80) {
        done = true;
        if (!bestHits || hits < bestHits) { bestHits = hits; NPI.store.set('npi_sim_hammer_best', hits); }
        setTimeout(() => s.flash(`DRIVEN IN ${hits}!`, 'gold'), 500);
      }
      draw();
      setTimeout(() => { swinging = 0; draw(); }, 130);
    };
    s.loop((t) => {
      power = done ? 0 : (Math.sin((t - t0) / 260) * 0.5 + 0.5) * 100;
      const bar = s.q('power');
      bar.setAttribute('height', String(power * 1.5));
      bar.setAttribute('y', String(150 - power * 1.5));
      bar.setAttribute('fill', power >= 68 && power <= 90 ? '#7AB51D' : '#FFC72C');
    });
    s.on(s.stage, 'pointerdown', (e) => { e.preventDefault(); strike(); });
    s.on(s.stage, 'keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); strike(); } });
    s.on(s.q('reset'), 'click', () => { sunk = 0; hits = 0; done = false; draw(); });
    draw();
    return s.destroy;
  }

  /* ---------------- 4. TAPE MEASURE ---------------- */
  function tape(el) {
    const s = shell(el, 'tape', `
      <rect width="400" height="260" fill="#F3F1EA"/>
      <rect x="0" y="210" width="400" height="50" fill="#e4e0d4"/>
      <path data-ref="blade" d="" fill="none" stroke="#FFD24D" stroke-width="12" stroke-linecap="butt"/>
      <g data-ref="ticks"></g>
      <g data-ref="hook"><rect x="-3" y="-12" width="7" height="24" fill="#5c6166"/><circle cx="12" cy="0" r="14" fill="#FFC72C" opacity=".25"/></g>
      <rect x="14" y="108" width="84" height="84" rx="14" fill="#FFC72C" stroke="#15171A" stroke-width="2.5"/>
      <circle cx="56" cy="150" r="24" fill="#15171A"/><circle cx="56" cy="150" r="14" fill="#C7CCD1"/>
      <rect data-ref="lockbtn" x="40" y="100" width="32" height="10" rx="3" fill="#3a3d40"/>`,
    `<button type="button" class="sim-btn" data-ref="lock" aria-pressed="false">🔓 Lock</button>`);
    const X0 = 98; const Y0 = 150; const MAXPX = 290; const FT = 25; const STANDOUT_FT = 12;
    let ext = 0; let locked = false; let dragging = false; let anim = null;
    const geom = () => {
      const ft = (ext / MAXPX) * FT;
      const over = Math.max(0, ft - STANDOUT_FT);
      const droop = Math.min(70, over ** 1.7 * 2.2);
      return { ft, x1: X0 + ext, y1: Y0 + droop, cx: X0 + ext * 0.62, cy: Y0 + droop * 0.15 };
    };
    const qpt = (g, t) => ({
      x: (1 - t) ** 2 * X0 + 2 * (1 - t) * t * g.cx + t * t * g.x1,
      y: (1 - t) ** 2 * Y0 + 2 * (1 - t) * t * g.cy + t * t * g.y1
    });
    const draw = () => {
      const g = geom();
      s.q('blade').setAttribute('d', `M${X0} ${Y0} Q${g.cx} ${g.cy} ${g.x1} ${g.y1}`);
      let ticks = '';
      const feet = Math.floor(g.ft);
      for (let f = 1; f <= feet; f++) {
        const p = qpt(g, f / Math.max(g.ft, 0.0001));
        ticks += `<line x1="${p.x}" y1="${p.y - 6}" x2="${p.x}" y2="${p.y + 2}" stroke="#15171A" stroke-width="${f % 5 === 0 ? 2 : 1}"/>`;
        if (f % 5 === 0) ticks += `<text x="${p.x}" y="${p.y + 4}" font-size="6" text-anchor="middle" fill="#B3261E" font-family="JetBrains Mono, monospace">${f}</text>`;
      }
      s.q('ticks').innerHTML = ticks;
      const ang = Math.atan2(g.y1 - g.cy, g.x1 - g.cx) * 180 / Math.PI;
      s.q('hook').setAttribute('transform', `translate(${g.x1} ${g.y1}) rotate(${ang})`);
      const inches = g.ft * 12;
      const ftWhole = Math.floor(inches / 12); const inRem = (inches % 12).toFixed(1);
      const sag = g.ft > STANDOUT_FT;
      s.readout(`<span class="ro-big">${ftWhole}′ ${inRem}″</span><span>${(inches * 2.54).toFixed(1)} cm · ${sag ? '<b class="warn">Past standout: blade sagging</b>' : `Standout OK (≤ ${STANDOUT_FT} ft)`}</span>`);
      s.q('lockbtn').setAttribute('fill', locked ? '#7AB51D' : '#3a3d40');
    };
    const retract = () => {
      cancelAnimationFrame(anim);
      const step = () => { ext *= 0.82; if (ext < 0.5) { ext = 0; draw(); return; } draw(); anim = requestAnimationFrame(step); };
      anim = requestAnimationFrame(step);
    };
    s.drag((p) => { cancelAnimationFrame(anim); const g = geom(); dragging = Math.hypot(p.x - g.x1, p.y - g.y1) < 40 || p.x > X0; },
      (p) => { if (!dragging) return; ext = clamp(p.x - X0, 0, MAXPX); draw(); },
      () => { dragging = false; if (!locked) retract(); });
    s.on(s.stage, 'keydown', (e) => {
      if (e.key === 'ArrowRight') { ext = clamp(ext + 8, 0, MAXPX); draw(); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { ext = clamp(ext - 8, 0, MAXPX); draw(); e.preventDefault(); }
    });
    s.on(s.q('lock'), 'click', () => {
      locked = !locked;
      s.q('lock').textContent = locked ? '🔒 Locked' : '🔓 Lock';
      s.q('lock').setAttribute('aria-pressed', String(locked));
      if (!locked) retract(); draw();
    });
    s.on(s.q('reset'), 'click', () => { locked = false; s.q('lock').textContent = '🔓 Lock'; retract(); });
    draw();
    return s.destroy;
  }

  /* ---------------- 5. LEVEL ---------------- */
  function level(el) {
    const s = shell(el, 'level', `
      <rect width="400" height="260" fill="#F3F1EA"/>
      <rect x="0" y="0" width="400" height="260" fill="url(#lv-wall)" opacity=".5"/>
      <defs><pattern id="lv-wall" width="40" height="20" patternUnits="userSpaceOnUse"><rect width="40" height="20" fill="#ece8dc"/><path d="M0 20h40M20 0v10M0 10h40M40 10v10" stroke="#dcd6c6"/></pattern></defs>
      <g data-ref="shelf">
        <rect x="70" y="150" width="260" height="14" fill="#a87b40" stroke="#6b4d26" stroke-width="2"/>
        <rect x="120" y="120" width="160" height="30" rx="4" fill="#FFC72C" stroke="#15171A" stroke-width="2.5"/>
        <rect x="120" y="120" width="160" height="7" fill="#C79A1E"/>
        <rect x="160" y="128" width="80" height="16" rx="8" fill="#e2f5c4" stroke="#15171A" stroke-width="1.5"/>
        <line x1="190" y1="128" x2="190" y2="144" stroke="#15171A" stroke-width="1.5"/>
        <line x1="210" y1="128" x2="210" y2="144" stroke="#15171A" stroke-width="1.5"/>
        <ellipse data-ref="bubble" cx="200" cy="136" rx="9" ry="5.5" fill="#fff" stroke="#7AB51D" stroke-width="2"/>
      </g>
      <circle cx="70" cy="157" r="5" fill="#3a3d40"/>`,
    `<button type="button" class="sim-btn" data-ref="tilt">📱 Phone tilt</button>`);
    let angle = (Math.random() > 0.5 ? 1 : -1) * (3 + Math.random() * 4); let startY = 0; let startA = 0; let wasLevel = false;
    const draw = () => {
      s.q('shelf').setAttribute('transform', `rotate(${angle} 70 157)`);
      const off = clamp(-angle * 9, -30, 30);
      s.q('bubble').setAttribute('cx', String(200 + off));
      const isLevel = Math.abs(angle) < 0.25;
      s.q('bubble').setAttribute('stroke', isLevel ? '#7AB51D' : '#C79A1E');
      if (isLevel && !wasLevel) { s.flash('LEVEL ✓', 'green'); vibrate(40); }
      wasLevel = isLevel;
      s.readout(`<span class="ro-big">${angle >= 0 ? '+' : ''}${angle.toFixed(1)}°</span><span>${isLevel ? '<b class="ok">Perfectly level</b>' : angle > 0 ? 'Right side is low: drag up' : 'Right side is high: drag down'}</span>`);
    };
    s.drag((p) => { startY = p.y; startA = angle; }, (p) => { angle = clamp(startA + (p.y - startY) * -0.06, -12, 12); draw(); });
    s.on(s.stage, 'keydown', (e) => {
      if (e.key === 'ArrowUp') { angle = clamp(angle - 0.2, -12, 12); draw(); e.preventDefault(); }
      if (e.key === 'ArrowDown') { angle = clamp(angle + 0.2, -12, 12); draw(); e.preventDefault(); }
    });
    const orient = (e) => { if (typeof e.gamma === 'number') { angle = clamp(e.gamma / 3, -12, 12); draw(); } };
    s.on(s.q('tilt'), 'click', async () => {
      try {
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
          const r = await DeviceOrientationEvent.requestPermission();
          if (r !== 'granted') return;
        }
        s.on(window, 'deviceorientation', orient);
        s.q('tilt').textContent = '📱 Tilt on';
      } catch { s.q('tilt').textContent = 'Not supported'; }
    });
    s.on(s.q('reset'), 'click', () => { angle = (Math.random() > 0.5 ? 1 : -1) * (3 + Math.random() * 4); draw(); });
    draw();
    return s.destroy;
  }

  /* ---------------- 6. DIAGONAL CUTTERS ---------------- */
  function cutter(el) {
    const s = shell(el, 'cutter', `
      <rect width="400" height="260" fill="#F3F1EA"/>
      <g data-ref="wireL"><rect x="20" y="66" width="180" height="8" rx="4" fill="#B3261E"/><rect x="20" y="66" width="180" height="3" fill="#fff" opacity=".3"/></g>
      <g data-ref="wireR"><rect x="200" y="66" width="180" height="8" rx="4" fill="#B3261E"/><rect x="200" y="66" width="180" height="3" fill="#fff" opacity=".3"/></g>
      <g data-ref="armA">
        <path d="M200 120 L188 60 L200 40 Z" fill="#8A9199" stroke="#15171A" stroke-width="2"/>
        <path d="M200 120 L176 240 L192 244 L206 124 Z" fill="#7AB51D" stroke="#15171A" stroke-width="2"/>
      </g>
      <g data-ref="armB">
        <path d="M200 120 L212 60 L200 40 Z" fill="#a9b0b7" stroke="#15171A" stroke-width="2"/>
        <path d="M200 120 L224 240 L208 244 L194 124 Z" fill="#7AB51D" stroke="#15171A" stroke-width="2"/>
      </g>
      <circle cx="200" cy="120" r="9" fill="#15171A"/><circle cx="200" cy="120" r="3" fill="#C7CCD1"/>
      <g data-ref="spark" opacity="0"><path d="M200 70 l-14 -10 M200 70 l14 -12 M200 70 l-10 14 M200 70 l12 12" stroke="#FFC72C" stroke-width="3" stroke-linecap="round"/></g>`,
    `<label class="sim-label">Wire <select data-ref="gauge"><option value="0.55">Thin (1 mm)</option><option value="0.75" selected>Medium (2 mm)</option><option value="0.93">Thick (3 mm)</option></select></label>`);
    let close = 0; let startY = 0; let cut = false; let pressing = false; let fly = 0; let keyHeld = false;
    const need = () => Number(s.q('gauge').value);
    const draw = () => {
      const a = (1 - close) * 16 + 2;
      s.q('armA').setAttribute('transform', `rotate(${-a} 200 120)`);
      s.q('armB').setAttribute('transform', `rotate(${a} 200 120)`);
      s.q('wireL').setAttribute('transform', cut ? `translate(${-fly * 40} ${fly * 90}) rotate(${-fly * 25} 200 70)` : '');
      s.q('wireR').setAttribute('transform', cut ? `translate(${fly * 40} ${fly * 90}) rotate(${fly * 25} 200 70)` : '');
      const hand = Math.round(close * 220);
      s.readout(`<span class="ro-big">${Math.round(close * 100)}% squeeze</span><span>Hand ${hand} N → edge ${Math.round(hand * 4.5)} N${cut ? ' · <b class="ok">Clean cut ✓</b>' : ''}</span>`);
    };
    const setClose = (v) => {
      close = clamp(v, 0, 1);
      if (!cut && close >= need()) {
        cut = true; vibrate(50); s.flash('SNIP!', 'gold');
        const sp = s.q('spark'); sp.setAttribute('opacity', '1'); setTimeout(() => sp.setAttribute('opacity', '0'), 160);
        const t0 = performance.now();
        const step = (t) => { fly = clamp((t - t0) / 600, 0, 1); draw(); if (fly < 1) requestAnimationFrame(step); };
        requestAnimationFrame(step);
      }
      draw();
    };
    const springBack = () => {
      const step = () => { if (pressing || keyHeld) return; close *= 0.8; if (close < 0.01) close = 0; draw(); if (close > 0) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    };
    s.drag((p) => { pressing = true; startY = p.y - close * 120; }, (p) => setClose((p.y - startY) / 120), () => { pressing = false; springBack(); });
    s.on(s.stage, 'keydown', (e) => { if (e.key === 'ArrowDown') { keyHeld = true; setClose(close + 0.08); e.preventDefault(); } });
    s.on(s.stage, 'keyup', (e) => { if (e.key === 'ArrowDown') { keyHeld = false; springBack(); } });
    const reset = () => { cut = false; fly = 0; close = 0; draw(); };
    s.on(s.q('gauge'), 'change', reset);
    s.on(s.q('reset'), 'click', reset);
    draw();
    return s.destroy;
  }

  /* ---------------- 7. UTILITY KNIFE ---------------- */
  function knife(el) {
    const s = shell(el, 'knife', `
      <rect width="400" height="260" fill="#F3F1EA"/>
      <g data-ref="top"><rect x="40" y="50" width="320" height="80" fill="#c8a97a"/><path d="M40 60h320M40 80h320M40 100h320M40 120h320" stroke="#b8976a" stroke-width="1"/></g>
      <g data-ref="bottom"><rect x="40" y="130" width="320" height="80" fill="#c8a97a"/><path d="M40 140h320M40 160h320M40 180h320M40 200h320" stroke="#b8976a" stroke-width="1"/></g>
      <line x1="60" y1="130" x2="340" y2="130" stroke="#15171A" stroke-width="1.5" stroke-dasharray="6 5" opacity=".6"/>
      <circle cx="60" cy="130" r="7" fill="none" stroke="#7AB51D" stroke-width="3"/>
      <rect x="336" y="118" width="8" height="24" fill="#7AB51D" opacity=".6"/>
      <polyline data-ref="cut" points="" fill="none" stroke="#3a2a14" stroke-width="2.5" stroke-linejoin="round"/>
      <g data-ref="blade" opacity="0"><path d="M0 0 L-14 -26 L-2 -30 Z" fill="#C7CCD1" stroke="#15171A" stroke-width="1.2"/><rect x="-16" y="-62" width="18" height="34" rx="5" fill="#FFC72C" stroke="#15171A" stroke-width="1.5" transform="rotate(-20 -7 -45)"/></g>`,
    `<button type="button" class="sim-btn" data-ref="lock" aria-pressed="false">🔓 Blade unlocked</button>`);
    let pts = []; let locked = false; let cutting = false; let done = false; let maxX = 60;
    const draw = () => {
      s.q('cut').setAttribute('points', pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
      const progress = Math.round(clamp((maxX - 60) / 280, 0, 1) * 100);
      const dev = pts.length ? pts.reduce((a, p) => a + Math.abs(p.y - 130), 0) / pts.length : 0;
      const acc = Math.round(clamp(100 - dev * 6, 0, 100));
      s.readout(`<span class="ro-big">${progress}% cut</span><span>Accuracy ${pts.length ? `${acc}%` : '—'}${done ? ' · <b class="ok">Board split ✓</b>' : ''}${!locked ? ' · <b class="warn">Lock the blade</b>' : ''}</span>`);
    };
    s.drag((p) => {
      if (done) return;
      if (Math.hypot(p.x - 60, p.y - 130) < 26 || (pts.length && Math.hypot(p.x - pts[pts.length - 1].x, p.y - pts[pts.length - 1].y) < 26)) {
        cutting = true; s.q('blade').setAttribute('opacity', '1');
      } else s.flash('Start at the green ring', '');
    }, (p) => {
      if (!cutting || done) return;
      const wobble = locked ? 0 : (Math.random() - 0.5) * 9;
      const pt = { x: clamp(p.x, 40, 360), y: p.y + wobble };
      if (pt.x > maxX) maxX = pt.x;
      pts.push(pt);
      s.q('blade').setAttribute('transform', `translate(${pt.x} ${pt.y})`);
      if (maxX >= 336) {
        done = true; cutting = false; vibrate(50); s.flash('CLEAN CUT!', 'green');
        s.q('blade').setAttribute('opacity', '0');
        s.q('bottom').classList.add('sim-drop');
      }
      draw();
    }, () => { cutting = false; s.q('blade').setAttribute('opacity', '0'); });
    s.on(s.stage, 'keydown', (e) => {
      if (e.key === 'ArrowRight' && !done) {
        maxX = Math.min(340, maxX + 10); pts.push({ x: maxX, y: 130 + (locked ? 0 : (Math.random() - 0.5) * 9) });
        if (maxX >= 336) { done = true; s.q('bottom').classList.add('sim-drop'); s.flash('CLEAN CUT!', 'green'); }
        draw(); e.preventDefault();
      }
    });
    s.on(s.q('lock'), 'click', () => {
      locked = !locked; s.q('lock').textContent = locked ? '🔒 Blade locked' : '🔓 Blade unlocked';
      s.q('lock').setAttribute('aria-pressed', String(locked)); draw();
    });
    s.on(s.q('reset'), 'click', () => { pts = []; maxX = 60; done = false; s.q('bottom').classList.remove('sim-drop'); draw(); });
    draw();
    return s.destroy;
  }

  /* ---------------- 8. HAND SAW ---------------- */
  function saw(el) {
    const s = shell(el, 'saw', `
      <rect width="400" height="260" fill="#F3F1EA"/>
      <rect x="20" y="200" width="360" height="40" fill="#5c6166"/>
      <g data-ref="left"><rect x="40" y="110" width="160" height="90" fill="#c99a5b" stroke="#8a6230" stroke-width="2"/><path d="M40 135 C100 130 150 140 200 133 M40 170 C110 165 150 178 200 168" stroke="#a87b40" stroke-width="2" fill="none"/></g>
      <g data-ref="right"><rect x="200" y="110" width="160" height="90" fill="#c99a5b" stroke="#8a6230" stroke-width="2"/><path d="M200 135 C260 130 310 140 360 133 M200 170 C270 165 310 178 360 168" stroke="#a87b40" stroke-width="2" fill="none"/></g>
      <rect data-ref="kerf" x="198" y="110" width="4" height="0" fill="#3a2a14"/>
      <g data-ref="dust"></g>
      <g data-ref="saw">
        <path d="M80 0 L280 0 L280 -34 L80 -20 Z" fill="#C7CCD1" stroke="#15171A" stroke-width="2"/>
        <path d="M80 0 l5 5 5-5 5 5 5-5 5 5 5-5 5 5 5-5 5 5 5-5 5 5 5-5 5 5 5-5 5 5 5-5 5 5 5-5 5 5 5-5 5 5 5-5 5 5 5-5 5 5 5-5 5 5 5-5 5 5 5-5 5 5 5-5 5 5 5-5 5 5 5-5 5 5 5-5 5 5 5-5 5 5 5-5 5 5 5-5 5 5 5-5 5 5 5-5 5 5 5-5" fill="none" stroke="#15171A" stroke-width="1.2"/>
        <path d="M278 -40 h40 a10 10 0 0 1 10 10 v26 a10 10 0 0 1 -10 10 h-40 z" fill="#7AB51D" stroke="#15171A" stroke-width="2"/>
        <rect x="290" y="-30" width="24" height="18" rx="7" fill="#15171A"/>
      </g>`);
    const DEPTH = 90; let depth = 0; let offset = 0; let lastX = null; let dir = 0; let strokeLen = 0; let strokes = 0; let done = false;
    const draw = () => {
      s.q('saw').setAttribute('transform', `translate(${offset - 160} ${110 + depth})`);
      s.q('kerf').setAttribute('height', String(depth));
      if (done) { s.q('left').classList.add('sim-tip-l'); s.q('right').classList.add('sim-tip-r'); }
      s.readout(`<span class="ro-big">${Math.round((depth / DEPTH) * 100)}% through</span><span>${strokes} stroke${strokes === 1 ? '' : 's'}${done ? ' · <b class="ok">Cut through ✓</b>' : ''}</span>`);
    };
    const dust = () => {
      const g = s.q('dust');
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', String(200 + (Math.random() - 0.5) * 20)); c.setAttribute('cy', String(110 + depth));
      c.setAttribute('r', String(1 + Math.random() * 2)); c.setAttribute('fill', '#d9b98a'); c.classList.add('sim-dust');
      g.append(c); setTimeout(() => c.remove(), 900);
    };
    const move = (dx) => {
      if (done) return;
      offset = clamp(offset + dx, 60, 300);
      const d = Math.sign(dx);
      if (d && d !== dir) {
        if (strokeLen > 40) { strokes++; }
        dir = d; strokeLen = 0;
      }
      strokeLen += Math.abs(dx);
      depth = clamp(depth + Math.abs(dx) * 0.045 * (strokeLen > 40 ? 1.4 : 0.6), 0, DEPTH);
      if (Math.random() < 0.35) dust();
      if (depth >= DEPTH) { done = true; vibrate(60); s.flash('THROUGH!', 'gold'); }
      draw();
    };
    s.drag((p) => { lastX = p.x; }, (p) => { move(p.x - lastX); lastX = p.x; });
    s.on(s.stage, 'keydown', (e) => {
      if (e.key === 'ArrowLeft') { move(-30); e.preventDefault(); }
      if (e.key === 'ArrowRight') { move(30); e.preventDefault(); }
    });
    s.on(s.q('reset'), 'click', () => {
      depth = 0; strokes = 0; done = false; offset = 180;
      s.q('left').classList.remove('sim-tip-l'); s.q('right').classList.remove('sim-tip-r'); draw();
    });
    offset = 180; draw();
    return s.destroy;
  }

  const SIMS = { torque, screw, hammer, tape, level, cutter, knife, saw };
  function mountSim(container, key) {
    const fn = SIMS[key];
    if (!fn) return () => {};
    return fn(container);
  }
  return { mount: mountSim, META, KEYS: Object.keys(SIMS) };
})();
