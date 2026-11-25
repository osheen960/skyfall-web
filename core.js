/* Skyfall web — reactor core, ported from the Android ReactorCore: spin-up on load/tap, gauge fill sweep,
   pulsing temperature glow, rotating tick ring and counter-rotating segment rings. */
'use strict';
const Core = (() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const START = 135, SWEEP = 270, rad = d => d * Math.PI / 180;
  let cv = null, ctx = null, st = null, key = null, bootAt = 0, raf = 0;
  const t0 = performance.now();
  const ease = x => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3); // FastOutSlowIn-ish

  function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
  function arc(cx, cy, r, a0, sweep, col, w, cap = 'butt') { ctx.beginPath(); ctx.arc(cx, cy, r, rad(a0), rad(a0 + sweep)); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = cap; ctx.stroke(); }
  function segments(cx, cy, r, col, n, sweep, w, a, rot) { for (let i = 0; i < n; i++) arc(cx, cy, r, rot + i * 360 / n, sweep, rgba(col, a), Math.max(1, w), 'round'); }

  function frame(now) {
    raf = 0;
    if (!cv || !cv.isConnected || document.hidden) return;
    const dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const t = reduce ? 0 : (now - t0) / 1000, since = (now - bootAt) / 1000;
    const fill = reduce ? st.frac : st.frac * ease(since / 1.5);
    const spin = reduce ? 0 : 1 - ease(since / 2.2), boost = spin * spin * 720;
    const r = Math.min(W, H) / 2, cx = W / 2, cy = H / 2, accent = getComputedStyle(document.documentElement).getPropertyValue('--ac').trim() || '#00e5ff';
    const heat = tempColor(st.temp);

    // Core glow.
    const pulse = 0.85 + 0.15 * Math.sin(t * 2.2);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.62);
    g.addColorStop(0, rgba(heat, 0.32 * pulse)); g.addColorStop(0.6, rgba(accent, 0.08)); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r * 0.62, 0, 7); ctx.fill();

    // Outer tick ring.
    const rot = t * 3 + boost * 0.25, rr = r * 0.985;
    for (let i = 0; i < 120; i++) {
      const a = rad(rot) + i * 2 * Math.PI / 120, major = i % 10 === 0, len = major ? r * 0.06 : r * 0.025;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (rr - len), cy + Math.sin(a) * (rr - len)); ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      ctx.strokeStyle = rgba(accent, major ? 0.7 : 0.22); ctx.lineWidth = major ? 2 : 1; ctx.lineCap = 'butt'; ctx.stroke();
    }

    // Gauge track + segmented fill along the low→high ramp.
    const gr = r * 0.84, gw = r * 0.045, segs = 54, lit = Math.round(segs * fill);
    arc(cx, cy, gr, START, SWEEP, rgba(accent, 0.12), gw);
    for (let i = 0; i < segs; i++) arc(cx, cy, gr, START + SWEEP * i / segs + 0.6, SWEEP / segs - 1.2, i < lit ? tempColor(st.lo + st.span * i / segs) : rgba(accent, 0.08), gw);
    // Needle head + glow.
    const na = rad(START + SWEEP * fill), nx = cx + gr * Math.cos(na), ny = cy + gr * Math.sin(na);
    ctx.fillStyle = rgba(heat, 0.35); ctx.beginPath(); ctx.arc(nx, ny, gw * 2.4, 0, 7); ctx.fill();
    ctx.fillStyle = '#e6fbff'; ctx.beginPath(); ctx.arc(nx, ny, gw * 0.9, 0, 7); ctx.fill();
    // L / H end markers.
    for (const f of [0, 1]) { const a = rad(START + SWEEP * f); ctx.beginPath(); ctx.moveTo(cx + (gr - gw * 1.6) * Math.cos(a), cy + (gr - gw * 1.6) * Math.sin(a)); ctx.lineTo(cx + (gr + gw * 1.6) * Math.cos(a), cy + (gr + gw * 1.6) * Math.sin(a)); ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.stroke(); }

    // Counter-rotating segment rings.
    segments(cx, cy, r * 0.7, accent, 3, 38, r * 0.012, 0.8, -t * 14 - boost);
    segments(cx, cy, r * 0.64, accent, 12, 18, r * 0.006, 0.35, t * 22 + boost * 1.4);
    segments(cx, cy, r * 0.585, heat, 2, 60, r * 0.004, 0.6, -t * 40);

    if (!reduce) raf = requestAnimationFrame(frame);
  }

  function decode(el, text, ms) {
    if (!el) return;
    if (reduce) { el.textContent = text; return; }
    const G = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&', frames = Math.max(1, Math.round(ms / 35)); let f = 0;
    const tid = String(Math.random()); el.dataset.tid = tid;
    const step = () => { if (el.dataset.tid !== tid) return; const res = Math.floor(text.length * f / frames);
      el.textContent = [...text].map((c, i) => (i < res || c === ' ' || c === '°' || c === '/' ? c : G[Math.random() * G.length | 0])).join('');
      if (f++ < frames) setTimeout(step, 35); else el.textContent = text; };
    step();
  }

  /** (Re)attach to the freshly rendered core. Animations replay only when the reading changes, or on tap. */
  function mount(root, w) {
    const c = w.current, d = dayOf(w, dkey(c.time)) || w.daily[0];
    const lo = Math.min(d.min, c.temperature), hi = Math.max(d.max, c.temperature), span = hi - lo > 0.5 ? hi - lo : 1;
    st = { temp: c.temperature, lo, span, frac: Math.max(0, Math.min(1, (c.temperature - lo) / span)) };
    const k = `${dkey(c.time)}:${R(c.temperature)}:${c.code}`, fresh = k !== key; key = k;
    cv = root.querySelector('canvas'); ctx = cv.getContext('2d');
    const label = root.querySelector('.cl'), temp = root.querySelector('.tv');
    if (fresh) { bootAt = performance.now(); decode(label, label.dataset.text, 700); decode(temp, temp.dataset.text, 900); }
    else { label.textContent = label.dataset.text; temp.textContent = temp.dataset.text; }
    root.onclick = () => { bootAt = performance.now(); decode(label, label.dataset.text, 700); decode(temp, temp.dataset.text, 900); if (navigator.vibrate) try { navigator.vibrate(12); } catch { } };
    if (!raf) raf = requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && cv && !raf) raf = requestAnimationFrame(frame); });
  /** Re-run the spin-up and gauge sweep (after the boot screen lifts, or when CORE comes back into view). */
  function replay() {
    if (!cv || !cv.isConnected) return;
    bootAt = performance.now();
    const root = cv.parentElement, label = root.querySelector('.cl'), temp = root.querySelector('.tv');
    decode(label, label.dataset.text, 700); decode(temp, temp.dataset.text, 900);
    if (!raf) raf = requestAnimationFrame(frame);
  }
  return { mount, replay };
})();
