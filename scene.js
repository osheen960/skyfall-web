/* Skyfall web — ambient weather scene: a line-for-line port of the Android AmbientScene renderer.
   Layers, back to front: time-of-day sky → stars/moon or sun + rays → parallax clouds → fog →
   lightning → rain streaks / snow → skyline with lit windows → ripples / snow drift → glass beads →
   flash + vignette. Every weather layer eases, so condition changes cross-fade. */
'use strict';

const Scene = (() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const D = 1; // 1 CSS px == 1 dp
  let cv, ctx, W = 0, H = 0, dpr = 1, running = false, t0 = performance.now(), last = 0, first = true;
  let input = null;
  let lvRain = 0, lvSnow = 0, lvFog = 0, lvStorm = 0, lvOver = 0, lvClouds = 0, lvClear = 0, snowDepth = 0;

  // ---- seeded random (stable layouts across frames)
  const prng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const seeds = (n, s) => { const r = prng(s); return Array.from({ length: n }, () => ({ x: r(), y: r(), s: r(), p: r() })); };
  const stars = seeds(140, 21), streaks = seeds(260, 22), flakes = seeds(220, 23), clouds = seeds(16, 24), mists = seeds(7, 25);
  const rnd = prng(26);

  // ---- colour helpers (ARGB ints as [a,r,g,b])
  const C = hex => { const n = parseInt(hex.slice(1), 16); return [255, (n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const lerpC = (a, b, f) => { const k = Math.max(0, Math.min(1, f)); return a.map((v, i) => v + (b[i] - v) * k); };
  const css = (c, a = 1) => `rgba(${c[1] | 0},${c[2] | 0},${c[3] | 0},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  const darken = (c, f) => lerpC(c, [255, 0, 0, 0], 1 - f);
  const BLACK = [255, 0, 0, 0], WHITE = [255, 255, 255, 255];

  // ---- palettes (no pinks or purples: dawn/dusk run amber over deep blue)
  const P = (top, mid, bot, cloud, dark) => ({ top: C(top), mid: C(mid), bot: C(bot), cloud: C(cloud), dark });
  const NIGHT = P('#04060F', '#0A1330', '#1A2650', '#2B3550', 1);
  const DAWN = P('#1C2556', '#3E5A8C', '#F4A86A', '#F2C9A0', 0.45);
  const DAY = P('#1A56B5', '#4C8ED9', '#A8D1F2', '#FFFFFF', 0);
  const GOLDEN = P('#2A4C8E', '#C9895A', '#FFC47A', '#FFD2A8', 0.1);
  const DUSK = P('#111838', '#2E3F6E', '#D9824A', '#6E7FA0', 0.6);
  const OVER_DAY = P('#56616F', '#7C8794', '#A4AEB9', '#B9C1CA', 0);
  const OVER_NIGHT = P('#0B0E14', '#151A22', '#222932', '#2C333D', 1);
  const STORM = P('#16191F', '#2A2F38', '#434A55', '#4A515C', 0.7);
  const mix = { top: NIGHT.top, mid: NIGHT.mid, bot: NIGHT.bot, cloud: NIGHT.cloud, dark: 1 };

  function timePalette(m, rise, set) {
    const keys = [[rise - 60, NIGHT], [rise - 10, DAWN], [rise + 50, DAY], [set - 100, DAY], [set - 20, GOLDEN], [set + 20, DUSK], [set + 75, NIGHT]];
    let a = NIGHT, b = NIGHT, f = 0;
    if (!(m <= keys[0][0] || m >= keys[keys.length - 1][0])) for (let k = 0; k < keys.length - 1; k++) { const [m0, p0] = keys[k], [m1, p1] = keys[k + 1]; if (m >= m0 && m <= m1) { a = p0; b = p1; f = m1 > m0 ? (m - m0) / (m1 - m0) : 0; break; } }
    mix.top = lerpC(a.top, b.top, f); mix.mid = lerpC(a.mid, b.mid, f); mix.bot = lerpC(a.bot, b.bot, f); mix.cloud = lerpC(a.cloud, b.cloud, f); mix.dark = a.dark + (b.dark - a.dark) * f;
    const over = mix.dark > 0.5 ? OVER_NIGHT : OVER_DAY, o = lvOver * 0.85;
    mix.top = lerpC(mix.top, over.top, o); mix.mid = lerpC(mix.mid, over.mid, o); mix.bot = lerpC(mix.bot, over.bot, o); mix.cloud = lerpC(mix.cloud, lerpC(over.cloud, mix.cloud, 0.35), o);
    const s = lvStorm * 0.8, st = mix.dark > 0.5 ? OVER_NIGHT : STORM;
    mix.top = lerpC(mix.top, st.top, s); mix.mid = lerpC(mix.mid, st.mid, s); mix.bot = lerpC(mix.bot, st.bot, s); mix.cloud = lerpC(mix.cloud, st.cloud, s);
  }

  // ---- assets
  let cloudBmps = [], dropBmp = null, flakeBmp = null, mistBmp = null;
  const off = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  function cloudBitmap(seed) {
    const w = 640, h = 320, b = off(w, h), c = b.getContext('2d'), r = prng(seed * 977 + 13);
    for (let i = 0; i < 26; i++) {
      const cx = w * (0.18 + r() * 0.64), cy = h * (0.42 + r() * 0.3) - (Math.abs(cx - w / 2) < w * 0.2 ? h * 0.1 : 0), rad = h * (0.16 + r() * 0.26);
      const g = c.createRadialGradient(cx, cy, 0, cx, cy, rad); g.addColorStop(0, 'rgba(255,255,255,.4)'); g.addColorStop(0.55, 'rgba(255,255,255,.19)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); c.arc(cx, cy, rad, 0, 7); c.fill();
    }
    return b;
  }
  function softDot(size) {
    const b = off(size, size), c = b.getContext('2d'), h = size / 2, g = c.createRadialGradient(h, h, 0, h, h, h);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.43)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.beginPath(); c.arc(h, h, h, 0, 7); c.fill(); return b;
  }
  function dropBitmap() {
    const s = 96, b = off(s, s), c = b.getContext('2d'), h = s / 2, r = h - 3;
    const g = c.createLinearGradient(0, h - r, 0, h + r); g.addColorStop(0, 'rgba(0,0,0,.22)'); g.addColorStop(0.55, 'rgba(255,255,255,.06)'); g.addColorStop(1, 'rgba(255,255,255,.33)');
    c.fillStyle = g; c.beginPath(); c.arc(h, h, r, 0, 7); c.fill();
    c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.31)'; c.beginPath(); c.arc(h, h, r - 1.5, 0, 7); c.stroke();
    c.lineWidth = 5; c.strokeStyle = 'rgba(255,255,255,.44)'; c.beginPath(); c.arc(h, h, r - 6, 25 * Math.PI / 180, 155 * Math.PI / 180); c.stroke();
    c.fillStyle = 'rgba(255,255,255,.82)'; c.beginPath(); c.ellipse(h - r * 0.35, h - r * 0.47, r * 0.2, r * 0.15, 0, 0, 7); c.fill();
    return b;
  }
  /** Tinted copy of a white bitmap (Android's PorterDuff MULTIPLY filter). */
  const tintCache = new Map();
  function tinted(bmp, col, key) {
    const q = col.map(v => (v / 16 | 0) * 16).join(','), k = key + q;
    if (tintCache.has(k)) return tintCache.get(k);
    if (tintCache.size > 60) tintCache.clear();
    const b = off(bmp.width, bmp.height), c = b.getContext('2d');
    c.drawImage(bmp, 0, 0); c.globalCompositeOperation = 'multiply'; c.fillStyle = css(col); c.fillRect(0, 0, b.width, b.height);
    c.globalCompositeOperation = 'destination-in'; c.drawImage(bmp, 0, 0);
    tintCache.set(k, b); return b;
  }
  function ensureAssets() { if (cloudBmps.length) return; cloudBmps = [0, 1, 2, 3, 4].map(cloudBitmap); dropBmp = dropBitmap(); flakeBmp = softDot(48); mistBmp = softDot(256); }

  // ---- skyline
  let skyline = [], skW = 0, skH = 0, skyBmp = null, skyKey = '', skyTop = 0;
  function ensureSkyline() {
    if (W === skW && H === skH) return; skW = W; skH = H; skyBmp = null;
    const r = prng(77), list = []; let x = -10 * D;
    while (x < W) {
      const bw = (18 + r() * 46) * D, tall = r() < 0.12, bh = H * (tall ? 0.16 + r() * 0.12 : 0.04 + r() * 0.11), wins = [], step = 7 * D;
      for (let wy = 6 * D; wy < bh - 6 * D; wy += step * 1.35) for (let wx = 4 * D; wx < bw - 6 * D; wx += step) if (r() < 0.75) wins.push([wx, wy, r() < 0.34 ? 1 : 0, r()]);
      list.push({ x, w: bw, h: bh, wins }); x += bw + r() * 4 * D;
    }
    skyline = list;
  }

  // ---- glass / ripples / lightning state
  const drops = [], ripples = []; let dropAcc = 0, rippleAcc = 0, strikeAt = -1, nextStrike = 4, bolt = null, bolt2 = null;

  function flash(age) {
    if (reduce) return age < 0 ? 0 : Math.exp(-age / 0.6) * 0.8;
    if (age < 0) return 0; if (age < 0.05) return 1; if (age < 0.09) return 0.15; if (age < 0.16) return 0.95; if (age < 0.2) return 0.3; if (age < 0.26) return 0.7;
    return 0.7 * Math.exp(-(age - 0.26) / 0.3);
  }

  function frame(now) {
    if (!running) return;
    const t = (now - t0) / 1000, dt = Math.min(0.1, Math.max(0, t - last)); last = t;
    if (input && W && H) draw(t, dt);
    requestAnimationFrame(frame);
  }

  function draw(t, dt) {
    ensureAssets();
    const inp = input, sky = inp.sky, c = ctx;
    const tRain = ['DRIZZLE', 'RAIN', 'STORM'].includes(sky) ? Math.max(0.3, inp.intensity) : 0;
    const tSnow = sky === 'SNOW' ? Math.max(0.35, inp.intensity) : 0, tFog = sky === 'FOG' ? 1 : 0, tStorm = sky === 'STORM' ? 1 : 0;
    const tOver = ['CLOUDY', 'FOG', 'DRIZZLE', 'RAIN', 'SNOW', 'STORM'].includes(sky) ? 1 : sky === 'PARTLY' ? 0.25 : 0;
    const tClouds = (sky === 'CLEAR' ? 0.12 : sky === 'PARTLY' ? 0.55 : 1) * (0.5 + inp.cloudCover / 200);
    const tClear = sky === 'CLEAR' ? 1 : sky === 'PARTLY' ? 0.75 : 0;
    const k = first ? 1 : Math.min(1, dt / 2.5); first = false;
    lvRain += (tRain - lvRain) * k; lvSnow += (tSnow - lvSnow) * k; lvFog += (tFog - lvFog) * k; lvStorm += (tStorm - lvStorm) * k;
    lvOver += (tOver - lvOver) * k; lvClouds += (tClouds - lvClouds) * k; lvClear += (tClear - lvClear) * k;
    timePalette(inp.minute, inp.rise, inp.set);
    const dark = mix.dark, horizon = H * 0.86, ground = H * ((inp.kind || 'city') === 'city' ? 0.88 : 0.78);   // activity scenes sit higher, clear of the dock
    const toRad = (inp.windFrom + 180) * Math.PI / 180, sx0 = Math.sin(toRad), windX = Math.abs(sx0) < 0.2 ? 0.2 * (sx0 < 0 ? -1 : 1) : sx0;
    const slant = Math.max(-0.45, Math.min(0.45, windX * Math.min(inp.wind, 50) / 70));
    const tm = reduce ? 0 : t; // frozen motion when reduced

    const shakeF = strikeAt >= 0 && lvStorm > 0.3 && !reduce ? flash(t - strikeAt) : 0;
    c.save();
    if (shakeF > 0.3) c.translate((rnd() - 0.5) * 14 * D * shakeF, (rnd() - 0.5) * 10 * D * shakeF);

    // Activity with a photo (scenes/<id>.jpg, Unsplash License): the real place, graded for time and weather, live weather on top.
    const pk = inp.kind || 'city', photo = pk !== 'city' ? Photos.get(pk) : null;
    if (photo) {
      const sc = Math.max(W / photo.width, H / photo.height), sw = W / sc, sh = H / sc, sx = (photo.width - sw) / 2, sy = (photo.height - sh) * 0.4;
      const wet = Math.max(lvOver, lvRain, lvFog), br = 1 - 0.18 * lvRain - 0.1 * lvOver - 0.55 * dark;
      c.filter = `saturate(${(1 - 0.55 * wet - 0.35 * dark).toFixed(2)}) brightness(${br.toFixed(2)})`;
      c.drawImage(photo, sx, sy, sw, sh, 0, 0, W, H); c.filter = 'none';
      const wg = c.createLinearGradient(0, 0, 0, H); wg.addColorStop(0, css(mix.top, 0.18 + 0.3 * dark)); wg.addColorStop(0.5, css(mix.bot, 0.10 + 0.12 * dark)); wg.addColorStop(1, css(mix.top, 0.25 * dark));
      c.fillStyle = wg; c.fillRect(0, 0, W, H);
      if (lvFog > 0.01) drawFog(tm);
      if (lvStorm > 0.3) drawLightning(t);
      if (lvRain > 0.01 && !reduce) drawStreaks(t, slant);
      if (lvSnow > 0.01 && !reduce) drawSnow(t, windX, inp.wind);
      const rgb = a => [a[1], a[2], a[3]];
      if (inp.fx && inp.fx.length) Festive.draw(c, inp.fx, inp.fxDay || 0, { W, H, ground, t: tm, dt: reduce ? 0 : dt, dark, skyTop: rgb(mix.top), skyMid: rgb(mix.mid), skyBot: rgb(mix.bot), rain: lvRain, fog: lvFog, storm: lvStorm, snow: lvSnow, overcast: lvOver, windKmh: inp.wind, windX, snowDepth, tempC: inp.tempC ?? NaN, label: inp.label || '', minute: inp.minute });
      if ((lvRain > 0.05 || drops.length) && !reduce) drawGlass(dt);
      c.restore();
      if (strikeAt >= 0) { const f = flash(t - strikeAt); if (f > 0) { c.fillStyle = css(C('#EEF2FF'), (reduce ? 0.18 : 0.78) * f * lvStorm); c.fillRect(0, 0, W, H); } }
      return;
    }

    // 1. Sky
    const g = c.createLinearGradient(0, 0, 0, horizon); g.addColorStop(0, css(mix.top)); g.addColorStop(0.58, css(mix.mid)); g.addColorStop(1, css(mix.bot));
    c.fillStyle = g; c.fillRect(0, 0, W, H);

    // 2. Stars + moon / sun + rays
    const nightVis = dark * (1 - lvOver * 0.9) * (1 - lvFog * 0.8);
    if (nightVis > 0.02) {
      for (const s of stars) { const tw = 0.55 + 0.45 * Math.sin(tm * (0.6 + s.s * 2.4) + s.p * 6.283); c.fillStyle = `rgba(255,255,255,${(nightVis * tw * (0.25 + 0.75 * s.s)).toFixed(3)})`; c.beginPath(); c.arc(s.x * W, s.y * horizon * 0.85, (0.5 + s.s * 1.2) * D, 0, 7); c.fill(); }
      drawMoon(inp, horizon, nightVis);
    }
    const dayFrac = (inp.minute - inp.rise) / (inp.set - inp.rise), sunVis = (1 - dark) * (1 - lvOver * 0.92) * (1 - lvFog * 0.7);
    if (dayFrac >= -0.06 && dayFrac <= 1.06 && sunVis > 0.02) {
      const f = Math.max(0, Math.min(1, dayFrac)), sX = W * (0.12 + 0.76 * f), sY = horizon - Math.sin(Math.PI * f) * H * 0.62 + H * 0.03, low = 1 - Math.sin(Math.PI * f);
      const sunCol = lerpC(C('#FFF4D6'), C('#FFB066'), low * low), glowR = W * (0.55 + 0.25 * low);
      const sg = c.createRadialGradient(sX, sY, 0, sX, sY, glowR); sg.addColorStop(0, css(sunCol, 0.55 * sunVis)); sg.addColorStop(0.35, css(sunCol, 0.12 * sunVis)); sg.addColorStop(1, css(sunCol, 0));
      c.fillStyle = sg; c.beginPath(); c.arc(sX, sY, glowR, 0, 7); c.fill();
      if (lvClear > 0.3) drawRays(sX, sY, tm, sunVis * lvClear, sunCol);
      c.fillStyle = css(C('#FFFFF0'), sunVis); c.beginPath(); c.arc(sX, sY, 16 * D, 0, 7); c.fill();
    }

    // 3. Clouds, 4. fog, 5. lightning, 6. precipitation
    drawClouds(tm, windX, inp.wind);
    if (lvFog > 0.01) drawFog(tm);
    if (lvStorm > 0.3) drawLightning(t);
    if (lvRain > 0.01 && !reduce) drawStreaks(t, slant);
    if (lvSnow > 0.01 && !reduce) drawSnow(t, windX, inp.wind);

    // 7. Skyline, 8. ground effects, 9. glass
    // Futuristic city + street (city.js, port of Android NeonCity).
    const rgb = a => [a[1], a[2], a[3]];
    const env = { W, H, ground, t: tm, dt: reduce ? 0 : dt, dark, skyTop: rgb(mix.top), skyMid: rgb(mix.mid), skyBot: rgb(mix.bot),
      rain: lvRain, fog: lvFog, storm: lvStorm, snow: lvSnow, overcast: lvOver, windKmh: inp.wind, windX, snowDepth,
      tempC: inp.tempC ?? NaN, label: inp.label || '', minute: inp.minute };
    if ((inp.kind || 'city') === 'city') NeonCity.draw(c, env, dpr); else Landscape.draw(c, inp.kind, env);
    if (inp.fx && inp.fx.length) Festive.draw(c, inp.fx, inp.fxDay || 0, env);
    if (lvRain > 0.05 && !reduce) drawRipples(ground, dt, dark);
    snowDepth = lvSnow > 0.05 ? Math.min(H * 0.07 * lvSnow, snowDepth + dt * H * 0.0009 * lvSnow) : Math.max(0, snowDepth - dt * H * 0.0004);
    if (snowDepth > 0.5) drawDrift();
    if ((lvRain > 0.05 || drops.length) && !reduce) drawGlass(dt);
    c.restore();

    // 10. Flash + vignette
    if (strikeAt >= 0) { const f = flash(t - strikeAt); if (f > 0) { c.fillStyle = css(C('#EEF2FF'), (reduce ? 0.18 : 0.78) * f * lvStorm); c.fillRect(0, 0, W, H); } }
    const v = c.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.max(W, H) * 0.8); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(0.6, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.44)');
    c.fillStyle = v; c.fillRect(0, 0, W, H);
  }

  function drawMoon(inp, horizon, vis) {
    const c = ctx, nightLen = inp.rise + 1440 - inp.set; let since = inp.minute - inp.set; if (since < 0) since += 1440;
    const f = Math.max(0, Math.min(1, since / nightLen)), x = W * (0.15 + 0.7 * f), y = horizon - Math.sin(Math.PI * f) * horizon * 0.65 + horizon * 0.06, r = 17 * D;
    const g = c.createRadialGradient(x, y, 0, x, y, r * 7); g.addColorStop(0, css(C('#B8C8FF'), 0.28 * vis)); g.addColorStop(1, 'rgba(184,200,255,0)');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 7, 0, 7); c.fill();
    c.fillStyle = css(C('#9AA6C2'), 0.18 * vis); c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    const ph = inp.moon, waxing = ph < 0.5, litRight = inp.southern ? !waxing : waxing, kx = Math.cos(2 * Math.PI * ph), ex = Math.abs(kx) * r;
    c.beginPath();
    if (litRight) { c.arc(x, y, r, -Math.PI / 2, Math.PI / 2, false); c.ellipse(x, y, Math.max(0.01, ex), r, 0, Math.PI / 2, -Math.PI / 2, kx > 0); }
    else { c.arc(x, y, r, Math.PI / 2, 3 * Math.PI / 2, false); c.ellipse(x, y, Math.max(0.01, ex), r, 0, -Math.PI / 2, Math.PI / 2, kx > 0); }
    c.closePath();
    const mg = c.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x - r * 0.3, y - r * 0.3, r * 1.4); mg.addColorStop(0, '#fff'); mg.addColorStop(1, '#D9DEEA');
    c.globalAlpha = Math.max(0, Math.min(1, vis)); c.fillStyle = mg; c.fill(); c.globalAlpha = 1;
  }

  function drawRays(x, y, t, a, col) {
    const c = ctx, len = Math.max(W, H) * 1.3;
    for (let i = 0; i < 9; i++) {
      const ang = Math.PI / 2 + (i - 4) * 0.22 + Math.sin(t * 0.05 + i) * 0.05, spread = 0.035 + 0.02 * ((i * 37) % 5) / 5;
      const pulse = 0.6 + 0.4 * Math.sin(t * 0.35 + i * 1.3), g = c.createLinearGradient(x, y, x + Math.cos(ang) * len * 0.7, y + Math.sin(ang) * len * 0.7);
      g.addColorStop(0, css(col, 0.09 * a * pulse)); g.addColorStop(1, css(col, 0));
      c.fillStyle = g; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(ang - spread) * len, y + Math.sin(ang - spread) * len); c.lineTo(x + Math.cos(ang + spread) * len, y + Math.sin(ang + spread) * len); c.closePath(); c.fill();
    }
  }

  function drawClouds(t, windX, wind) {
    const c = ctx;
    if (lvClouds < 0.02 && lvOver < 0.02) return;
    if (lvOver > 0.02) { const g = c.createLinearGradient(0, 0, 0, H * 0.7); g.addColorStop(0, css(darken(mix.cloud, 0.55), 0.75 * lvOver)); g.addColorStop(0.6, css(mix.cloud, 0.25 * lvOver)); g.addColorStop(1, css(mix.cloud, 0)); c.fillStyle = g; c.fillRect(0, 0, W, H * 0.7); }
    const n = Math.min(clouds.length, Math.floor(2 + 9 * lvClouds)), order = clouds.slice(0, n).sort((a, b) => a.s - b.s);
    order.forEach((cl, i) => {
      const layer = cl.s < 0.33 ? 0 : cl.s < 0.66 ? 1 : 2, scale = W / 640 * (0.55 + 0.35 * layer + cl.p * 0.3), cw = 640 * scale, ch = 320 * scale;
      const speed = (5 + wind * 0.7) * (0.35 + 0.45 * layer) * D, span = W + cw * 2;
      const x = (((cl.x * span + t * speed * windX) % span) + span) % span - cw, y = H * (0.02 + cl.y * 0.42) - ch * 0.3 + layer * H * 0.05;
      const tint = lerpC(darken(mix.cloud, 0.75), mix.cloud, 0.55 + 0.2 * layer), bmp = tinted(cloudBmps[i % cloudBmps.length], tint, 'c' + (i % 5));
      c.globalAlpha = Math.max(0, Math.min(1, (0.55 + 0.2 * layer) * Math.min(1, lvClouds * 1.4 + lvOver * 0.4)));
      c.drawImage(bmp, x, y, cw, ch);
      if (lvOver > 0.4 && layer === 2) c.drawImage(bmp, x + cw * 0.4, y + ch * 0.25, cw * 0.9, ch * 0.7);
    });
    c.globalAlpha = 1;
  }

  function drawFog(t) {
    const c = ctx, fogCol = lerpC(C('#C9D0D8'), C('#39404A'), mix.dark), g = c.createLinearGradient(0, H * 0.2, 0, H);
    g.addColorStop(0, css(fogCol, 0)); g.addColorStop(1, css(fogCol, 0.55 * lvFog)); c.fillStyle = g; c.fillRect(0, 0, W, H);
    const m = tinted(mistBmp, fogCol, 'mist');
    mists.forEach((p, i) => { const mw = W * (1.2 + p.s), mh = H * (0.14 + p.p * 0.1), span = W + mw; const x = (((p.x * span + t * (4 + 6 * p.s) * D) % span) + span) % span - mw * 0.6;
      c.globalAlpha = 0.4 * lvFog; c.drawImage(m, x, H * (0.35 + i * 0.08), mw, mh); });
    c.globalAlpha = 1;
  }

  function drawStreaks(t, slant) {
    const c = ctx, n = Math.floor(streaks.length * Math.min(1, lvRain)), col = lerpC(C('#DCE6F2'), C('#9FB0C8'), mix.dark);
    c.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const p = streaks[i], len = (14 + p.s * 40) * D, speed = H * (0.9 + p.s * 1.3), travel = H + len, y = ((p.y * travel + t * speed) % travel) - len;
      let x = p.x * W + y * slant; x = ((x % W) + W) % W;
      c.strokeStyle = css(col, (0.1 + 0.32 * p.s) * Math.min(1, lvRain)); c.lineWidth = (0.6 + p.s * 1.3) * D;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + len * slant, y + len); c.stroke();
    }
  }

  function drawSnow(t, windX, wind) {
    const c = ctx, n = Math.floor(flakes.length * Math.min(1, lvSnow));
    for (let i = 0; i < n; i++) {
      const p = flakes[i], speed = (14 + p.s * 46) * D, y = (p.y * H + t * speed) % H, drift = t * windX * wind * 0.4 * D * (0.4 + p.s);
      let x = p.x * W + Math.sin(t * (0.35 + p.p) + p.p * 12) * 18 * D + drift; x = ((x % W) + W) % W;
      const r = (1.2 + p.s * 3.6) * D;
      if (p.s > 0.78) { c.globalAlpha = 0.75 * lvSnow; c.drawImage(flakeBmp, x - r * 2.2, y - r * 2.2, r * 4.4, r * 4.4); c.globalAlpha = 1; }
      else { c.fillStyle = `rgba(255,255,255,${((0.45 + 0.45 * p.s) * lvSnow).toFixed(3)})`; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); }
    }
  }

  function makeBolt(start, endF, jitter) {
    const pts = []; let x = W * start, y = 0; pts.push([x, y]); const end = H * endF;
    while (y < end) { x += (rnd() - 0.5) * jitter * D; y += (12 + rnd() * 22) * D; pts.push([x, y]); }
    return pts;
  }
  function drawLightning(t) {
    const c = ctx;
    if (t >= nextStrike) {
      strikeAt = t;
      nextStrike = t + (rnd() < 0.45 ? 0.9 + rnd() * 0.8 : 3.5 + rnd() * 5);
      bolt2 = rnd() < 0.5 ? [makeBolt(0.1 + rnd() * 0.8, 0.45 + rnd() * 0.3, 46)] : null;
      const main = makeBolt(0.15 + rnd() * 0.7, 0.55 + rnd() * 0.25, 40), branches = [];
      main.forEach(([bx, by]) => { if (rnd() < 0.12) { const dir = rnd() < 0.5 ? 1 : -1, br = [[bx, by]]; let x = bx, y = by; for (let k = 0, n = 4 + Math.floor(rnd() * 4); k < n; k++) { x += dir * (6 + rnd() * 22) * D; y += (8 + rnd() * 18) * D; br.push([x, y]); } branches.push(br); } });
      bolt = [main, ...branches];
    }
    const age = t - strikeAt;
    if (strikeAt >= 0 && age < 0.34) {
      const f = flash(age) * lvStorm, g = c.createLinearGradient(0, 0, 0, H * 0.6);
      g.addColorStop(0, css(C('#DDE4FF'), 0.55 * f)); g.addColorStop(1, 'rgba(221,228,255,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H * 0.6);
      if (reduce) return;
      c.lineJoin = 'round'; c.lineCap = 'round';
      [...(bolt || []), ...(bolt2 || [])].forEach(pl => {
        [[C('#B9C6FF'), 0.45, 20], [C('#E8EDFF'), 0.8, 6], [WHITE, 1, 2.8]].forEach(([col, a, w]) => {
          c.strokeStyle = css(col, a * f); c.lineWidth = w * D; c.beginPath(); pl.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke();
        });
      });
    }
  }

  function drawSkyline(ground, dark, t) {
    const c = ctx, bodyCol = lerpC(mix.bot, C('#03050A'), 0.78 + 0.12 * dark), winOn = C('#FFDC9A');
    const litAlpha = Math.max(0, Math.min(1, dark * 1.1)), litQ = Math.floor(litAlpha * 20), rainQ = Math.min(10, Math.floor(lvRain * 10)), snowQ = Math.min(3, Math.floor(snowDepth / D));
    const key = bodyCol.map(v => v | 0).join(',') + `|${litQ}|${rainQ}|${snowQ}|${W}|${H}`;
    if (!skyBmp || key !== skyKey) { skyKey = key; skyBmp = renderSkyline(ground, bodyCol, winOn, litQ / 20, rainQ / 10, snowQ * D); }
    c.drawImage(skyBmp, 0, skyTop, W, H - skyTop);
    if (litAlpha > 0.05) {
      const ws = 2.6 * D, hs = 3.6 * D;
      skyline.forEach(b => b.wins.forEach(wv => { if (wv[2] > 0.5 && wv[3] > 0.93) { c.fillStyle = css(winOn, litAlpha * 0.85 * (0.5 + 0.5 * Math.sin(t * 6 + wv[3] * 40))); c.fillRect(b.x + wv[0], ground - b.h + wv[1], ws, hs); } }));
    }
  }
  function renderSkyline(ground, bodyCol, winOn, litAlpha, rain, snowCap) {
    const maxH = Math.max(0, ...skyline.map(b => b.h)); skyTop = Math.max(0, ground - maxH - 6 * D);
    const bmp = off(Math.max(1, Math.round(W * dpr)), Math.max(1, Math.round((H - skyTop) * dpr))), k = bmp.getContext('2d');
    k.scale(dpr, dpr); k.translate(0, -skyTop);
    const ws = 2.6 * D, hs = 3.6 * D;
    skyline.forEach(b => {
      k.fillStyle = css(bodyCol); k.fillRect(b.x, ground - b.h, b.w, H - (ground - b.h));
      b.wins.forEach(wv => { const lit = wv[2] > 0.5; if (lit && wv[3] > 0.93) return; const a = lit ? litAlpha * 0.85 : 0.06 * (1 - litAlpha); if (a > 0.01) { k.fillStyle = css(lit ? winOn : mix.top, a); k.fillRect(b.x + wv[0], ground - b.h + wv[1], ws, hs); } });
      if (snowCap > 0.5) { k.fillStyle = 'rgba(255,255,255,.9)'; k.fillRect(b.x, ground - b.h - snowCap, b.w, snowCap); }
    });
    k.fillStyle = css(lerpC(bodyCol, BLACK, 0.35)); k.fillRect(0, ground, W, H - ground);
    if (rain > 0.05) {
      const g = k.createLinearGradient(0, ground, 0, H); g.addColorStop(0, css(mix.bot, 0.35 * rain)); g.addColorStop(1, css(mix.bot, 0)); k.fillStyle = g; k.fillRect(0, ground, W, H - ground);
      if (litAlpha > 0.1) {
        k.lineWidth = 2 * D; const len = (H - ground) * 0.9;
        skyline.forEach(b => b.wins.forEach((wv, idx) => { if (wv[2] > 0.5 && idx % 3 === 0) { const x = b.x + wv[0];
          k.strokeStyle = css(winOn, 0.2 * rain * litAlpha); k.beginPath(); k.moveTo(x, ground + 2); k.lineTo(x, ground + len * 0.45); k.stroke();
          k.strokeStyle = css(winOn, 0.08 * rain * litAlpha); k.beginPath(); k.moveTo(x, ground + len * 0.45); k.lineTo(x, ground + len); k.stroke(); } }));
      }
    }
    return bmp;
  }

  function drawRipples(ground, dt, dark) {
    const c = ctx; rippleAcc += dt * 18 * lvRain;
    while (rippleAcc > 1) { rippleAcc -= 1; if (ripples.length < 40) ripples.push({ x: rnd() * W, y: ground + (H - ground) * (0.15 + rnd() * 0.8), age: 0 }); }
    const col = lerpC(WHITE, C('#B0BDD0'), dark); c.lineWidth = D;
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i]; r.age += dt; if (r.age > 0.8) { ripples.splice(i, 1); continue; }
      const k = r.age / 0.8, rw = (2 + 16 * k) * D; c.strokeStyle = css(col, 0.4 * (1 - k) * lvRain);
      c.beginPath(); c.ellipse(r.x, r.y, rw, rw * 0.28, 0, 0, 7); c.stroke();
    }
  }

  function drawDrift() {
    const c = ctx, step = 8 * D; c.beginPath(); c.moveTo(0, H);
    for (let x = 0; x <= W + step; x += step) { const n = 0.75 + 0.15 * Math.sin(x * 0.011) + 0.1 * Math.sin(x * 0.037 + 1.7); c.lineTo(x, H - snowDepth * n); }
    c.lineTo(W, H); c.closePath();
    const g = c.createLinearGradient(0, H - snowDepth, 0, H); g.addColorStop(0, '#fff'); g.addColorStop(1, css(lerpC(C('#CFDFF2'), C('#5A6A80'), mix.dark)));
    c.fillStyle = g; c.fill();
  }

  function drawGlass(dt) {
    const c = ctx; dropAcc += dt * 7 * lvRain;
    while (dropAcc > 1) { dropAcc -= 1; if (drops.length < 90) drops.push({ x: rnd() * W, y: rnd() * H * 0.95, r: (1.5 + rnd() * 4.5) * D, vy: 0, life: 1, sliding: false, lastTrail: 0, wob: 0 }); }
    const trail = [];
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      if (!d.sliding) {
        d.r += dt * 0.25 * D * lvRain;
        if (d.r > 5.5 * D && rnd() < dt * 0.6) { d.sliding = true; d.vy = 30 * D; d.wob = rnd() * 6; }
        d.life -= dt * (lvRain < 0.05 ? 0.25 : 0.012);
      } else {
        d.vy = Math.min(d.vy + dt * 260 * D, 220 * D); const oldY = d.y; d.y += d.vy * dt; d.x += Math.sin(d.y * 0.04 + d.wob) * 0.4 * D; d.lastTrail += d.y - oldY;
        if (d.lastTrail > 9 * D) { d.lastTrail = 0; trail.push({ x: d.x + (rnd() - 0.5) * 2 * D, y: d.y - d.r * 1.4, r: d.r * (0.22 + rnd() * 0.18), vy: 0, life: 0.9, sliding: false, lastTrail: 0, wob: 0 }); d.r *= 0.985; }
      }
      if (d.life <= 0 || d.y - d.r > H) { drops.splice(i, 1); continue; }
      const stretch = d.sliding ? 1.25 : 1; c.globalAlpha = Math.max(0, Math.min(1, d.life));
      c.drawImage(dropBmp, d.x - d.r, d.y - d.r * stretch, d.r * 2, d.r * (1 + stretch));
    }
    c.globalAlpha = 1;
    if (drops.length < 160) drops.push(...trail);
  }

  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1); W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); skW = 0;
  }

  return {
    mount(canvas) {
      cv = canvas; ctx = cv.getContext('2d'); resize(); new ResizeObserver(resize).observe(cv); running = true; requestAnimationFrame(frame);
      document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) { t0 = performance.now(); last = 0; requestAnimationFrame(frame); } });
    },
    set(i) { input = { ...(input || {}), ...i }; },
    strike() { strikeAt = (performance.now() - t0) / 1000; },
  };
})();

function moonPhase(ms) { const synodic = 29.530588853, ref = Date.UTC(2000, 0, 6, 18, 14); return fmod((ms - ref) / DAY / synodic, 1); }

/* Activity scene photos: lazy-loaded, cached; null until ready or if an activity has none. */
const Photos = { img: {}, bad: new Set(),
  get(id) { if (this.bad.has(id)) return null; const i = this.img[id]; if (i) return i.complete && i.naturalWidth ? i : null;
    const n = new Image(); n.decoding = 'async'; n.onerror = () => this.bad.add(id); n.src = 'scenes/' + id + '.jpg?v=2'; this.img[id] = n; return null; } };
