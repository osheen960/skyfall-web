/* Skyfall web — ambient sky scene (day/night, sun/moon, clouds, rain, snow, fog, lightning). */
'use strict';

const Scene = (() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let cv, ctx, W = 0, H = 0, dpr = 1, input = { sky: 'CLEAR', minute: 720, rise: 360, set: 1140, wind: 10, moon: 0.5 };
  let stars = [], drops = [], flakes = [], clouds = [], skyline = null, flash = 0, nextStrike = 3, t0 = performance.now(), last = 0, running = false;
  const rnd = (a, b) => a + Math.random() * (b - a);

  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stars = Array.from({ length: Math.round(W * H / 2600) }, () => ({ x: Math.random() * W, y: Math.random() * H * 0.75, r: rnd(0.3, 1.3), p: rnd(0, 6.28) }));
    clouds = Array.from({ length: 7 }, (_, i) => ({ x: rnd(-0.2, 1.1) * W, y: rnd(0.05, 0.42) * H, s: rnd(0.6, 1.4), v: rnd(4, 12), i }));
    skyline = buildSkyline();
  }

  function buildSkyline() {
    const off = document.createElement('canvas'); off.width = W * dpr; off.height = H * 0.3 * dpr;
    const c = off.getContext('2d'); c.scale(dpr, dpr);
    const h0 = H * 0.3; let x = 0;
    while (x < W) {
      const bw = rnd(18, 54), bh = rnd(h0 * 0.25, h0 * 0.95);
      c.fillStyle = '#03060d'; c.fillRect(x, h0 - bh, bw - 2, bh);
      for (let wy = h0 - bh + 6; wy < h0 - 6; wy += 9) for (let wx = x + 4; wx < x + bw - 6; wx += 7)
        if (Math.random() < 0.18) { c.fillStyle = `rgba(255,${200 + Math.random() * 40 | 0},140,${rnd(0.25, 0.7)})`; c.fillRect(wx, wy, 2, 3); }
      x += bw;
    }
    return off;
  }

  function palette(m, rise, set) {
    const night = ['#030512', '#0a1030'], dawn = ['#121a3e', '#ffb067'], day = ['#0a3a6b', '#3aa0d8'], golden = ['#141d42', '#ffb547'], dusk = ['#0a1236', '#3a6fd8'];
    const k = [[rise - 70, night], [rise, dawn], [rise + 60, day], [set - 90, day], [set - 10, golden], [set + 25, dusk], [set + 80, night]];
    if (m <= k[0][0] || m >= k[6][0]) return night;
    for (let i = 0; i < 6; i++) if (m >= k[i][0] && m <= k[i + 1][0]) { const f = (m - k[i][0]) / (k[i + 1][0] - k[i][0]); return [lerpHex(k[i][1][0], k[i + 1][1][0], f), lerpHex(k[i][1][1], k[i + 1][1][1], f)]; }
    return night;
  }

  function cloudBlob(x, y, s, a, tint) {
    ctx.fillStyle = tint.replace('A', a.toFixed(3));
    [[0, 0, 46], [-38, 10, 32], [40, 8, 36], [-10, -18, 30], [18, -14, 28]].forEach(([dx, dy, r]) => { ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, r * s, 0, 7); ctx.fill(); });
  }

  function frame(now) {
    if (!running) return;
    const t = (now - t0) / 1000, dt = Math.min(0.1, t - last); last = t;
    const { sky, minute, rise, set, wind } = input;
    const isNight = minute < rise - 20 || minute > set + 30;
    const [top, bottom] = palette(minute, rise, set);
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, top); g.addColorStop(1, bottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const overcast = { CLEAR: 0, PARTLY: 0.25, CLOUDY: 0.7, FOG: 0.6, DRIZZLE: 0.65, RAIN: 0.8, SNOW: 0.7, STORM: 0.9 }[sky] ?? 0.3;
    ctx.fillStyle = `rgba(10,14,24,${overcast * 0.55})`; ctx.fillRect(0, 0, W, H);

    if (isNight) for (const s of stars) { const a = (0.35 + 0.5 * Math.sin(t * 1.3 + s.p)) * (1 - overcast); if (a <= 0.02) continue; ctx.fillStyle = `rgba(230,251,255,${a})`; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill(); }

    // Sun or moon on an arc across the sky.
    const dayFrac = (minute - rise) / Math.max(1, set - rise);
    if (!isNight && dayFrac > -0.05 && dayFrac < 1.05) {
      const x = W * (0.1 + 0.8 * dayFrac), y = H * (0.55 - 0.42 * Math.sin(Math.PI * Math.max(0, Math.min(1, dayFrac))));
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 120); glow.addColorStop(0, `rgba(255,220,150,${0.55 * (1 - overcast * 0.8)})`); glow.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = glow; ctx.fillRect(x - 120, y - 120, 240, 240);
      ctx.fillStyle = `rgba(255,236,190,${1 - overcast * 0.7})`; ctx.beginPath(); ctx.arc(x, y, 22, 0, 7); ctx.fill();
    } else if (isNight) {
      const x = W * 0.86, y = H * 0.3, r = 18, ph = input.moon;
      ctx.fillStyle = `rgba(230,240,255,${0.9 - overcast * 0.6})`; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      const off = 2 * r * (1 - Math.abs(0.5 - ph) * 2) * (ph < 0.5 ? -1 : 1);
      if (Math.abs(off) < 2 * r) { ctx.fillStyle = lerpHex(top, bottom, y / H); ctx.beginPath(); ctx.arc(x + off, y, r + 0.5, 0, 7); ctx.fill(); }
    }

    const tint = isNight ? 'rgba(120,130,170,A)' : 'rgba(220,232,245,A)';
    const nClouds = Math.round(overcast * clouds.length);
    for (let i = 0; i < nClouds; i++) { const c = clouds[i]; c.x += (reduce ? 0 : c.v * (0.5 + wind / 20)) * dt; if (c.x > W + 120) c.x = -160; cloudBlob(c.x, c.y, c.s * (Math.min(W, 900) / 420), 0.08 + overcast * 0.16, tint); }

    if (sky === 'FOG') { const fg = ctx.createLinearGradient(0, H * 0.4, 0, H); fg.addColorStop(0, 'rgba(190,205,220,0)'); fg.addColorStop(1, 'rgba(190,205,220,0.35)'); ctx.fillStyle = fg; ctx.fillRect(0, 0, W, H); }

    if (skyline) ctx.drawImage(skyline, 0, H * 0.7, W, H * 0.3);

    const raining = sky === 'RAIN' || sky === 'DRIZZLE' || sky === 'STORM';
    if (raining && !reduce) {
      const want = sky === 'DRIZZLE' ? 90 : sky === 'STORM' ? 320 : 220;
      while (drops.length < want) drops.push({ x: rnd(-40, W), y: rnd(-H, 0), v: rnd(700, 1100), l: rnd(10, 22) });
      ctx.strokeStyle = 'rgba(170,210,255,0.45)'; ctx.lineWidth = 1; ctx.beginPath();
      const slant = 40 + wind * 3;
      for (const d of drops) { d.y += d.v * dt; d.x += slant * dt; if (d.y > H) { d.y = rnd(-80, 0); d.x = rnd(-40, W); } ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - slant * 0.02, d.y - d.l); }
      ctx.stroke();
    } else drops.length = 0;

    if (sky === 'SNOW' && !reduce) {
      while (flakes.length < 160) flakes.push({ x: rnd(0, W), y: rnd(-H, 0), v: rnd(30, 80), r: rnd(1, 2.8), p: rnd(0, 6) });
      ctx.fillStyle = 'rgba(240,248,255,0.85)';
      for (const f of flakes) { f.y += f.v * dt; f.x += Math.sin(t + f.p) * 20 * dt + wind * 0.6 * dt; if (f.y > H) { f.y = -5; f.x = rnd(0, W); } ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill(); }
    } else flakes.length = 0;

    if (sky === 'STORM') {
      nextStrike -= dt;
      if (nextStrike <= 0) { flash = 1; nextStrike = rnd(2.5, 7); if (!reduce) bolt(); }
      if (flash > 0) { ctx.fillStyle = `rgba(235,240,255,${(reduce ? 0.18 : 0.62) * flash})`; ctx.fillRect(0, 0, W, H); flash = Math.max(0, flash - dt * 3.2); }
    }
    requestAnimationFrame(frame);
  }

  function bolt() {
    let x = rnd(W * 0.15, W * 0.85), y = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(x, y);
    while (y < H * 0.68) { x += rnd(-26, 26); y += rnd(14, 34); ctx.lineTo(x, y); }
    ctx.stroke();
  }

  return {
    mount(canvas) { cv = canvas; ctx = cv.getContext('2d'); resize(); new ResizeObserver(resize).observe(cv); running = true; requestAnimationFrame(frame);
      document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) { t0 = performance.now(); last = 0; requestAnimationFrame(frame); } }); },
    set(i) { input = { ...input, ...i }; },
    strike() { flash = 1; },
  };
})();

function moonPhase(ms) { const synodic = 29.530588853, ref = Date.UTC(2000, 0, 6, 18, 14); return fmod((ms - ref) / DAY / synodic, 1); }
