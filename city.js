/* Skyfall web — futuristic neon city for the ambient scene. Port of Android scene/NeonCity.kt:
   three parallax tower layers (hazy far, windowed mid, neon-trimmed near), day glass / night windows,
   sky-lane traffic, maglev, beacons, searchlights, holo billboards (live temp + condition) and a street
   that becomes a neon mirror in the rain. Reacts to the eased weather levels passed in.
   No pinks or purples: neon is cyan, electric blue, teal, amber, white; beacons red. */
'use strict';

const NeonCity = (() => {
  const prng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const H2 = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const lerp = (a, b, f) => { const k = Math.max(0, Math.min(1, f)); return a.map((v, i) => v + (b[i] - v) * k); };
  const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  const NEON = ['#00E5FF', '#4C9BFF', '#3DFFD0', '#FFB547', '#BFEFFF'].map(H2);
  const WHITE = [255, 255, 255], BLACK = [0, 0, 0], RED = H2('#FF4D4D'), AMBER = H2('#FFB547'), ICE = H2('#BFEFFF');
  const TEMP = [[-5, '#5B7BFF'], [5, '#00B3FF'], [13, '#00F0D0'], [20, '#B6FF3D'], [26, '#FFD23D'], [32, '#FF7A3D'], [40, '#FF3B30']].map(([t, h]) => [t, H2(h)]);
  const tempCol = t => { if (isNaN(t)) return NEON[0]; if (t <= TEMP[0][0]) return TEMP[0][1]; if (t >= TEMP[6][0]) return TEMP[6][1]; const i = TEMP.findIndex(x => x[0] > t); return lerp(TEMP[i - 1][1], TEMP[i][1], (t - TEMP[i - 1][0]) / (TEMP[i][0] - TEMP[i - 1][0])); };

  let towers = [], crafts = [], bW = 0, bH = 0, cache = null, cacheKey = '', sinceBuild = 0, railT = 0;

  function build(W, H, ground) {
    if (W === bW && H === bH) return; bW = W; bH = H;
    const r = prng(2077), list = [];
    [[0, 26, 70, 0.30, 0.62], [1, 30, 74, 0.20, 0.46], [2, 44, 110, 0.10, 0.26]].forEach(([layer, w0, w1, h0, h1]) => {
      let x = -r() * 30;
      while (x < W) {
        const bw = w0 + r() * (w1 - w0), tall = r() < 0.16, bh = ground * (h0 + r() * (h1 - h0)) * (tall ? 1.25 : 1);
        const shape = Math.floor(r() * 5), board = layer >= 1 && bw > 48 && r() < 0.22 ? 1 + Math.floor(r() * 2) : 0;
        list.push({ layer, x, w: bw, h: bh, shape, seed: Math.floor(r() * 1e9), neon: NEON[Math.floor(r() * NEON.length)], beacon: r() < 0.45, board });
        x += bw + (layer === 2 ? 6 + r() * 28 : r() * 8);
      }
    });
    const wide = list.filter(t => t.layer >= 1 && t.w > 46).sort((a, b) => b.w - a.w);
    if (wide[0]) wide[0].board = 1; if (wide[1]) wide[1].board = 2;
    towers = list;
    crafts = Array.from({ length: 11 }, (_, i) => { const depth = 0.45 + r() * 0.75; return { x: r() * W, lane: 0.46 + r() * 0.3, depth, speed: (26 + r() * 60) * depth, dir: r() < 0.5 ? 1 : -1, phase: r() * 6.28, tail: i % 3 === 0 ? RED : AMBER }; });
    cache = null;
  }

  const lit = e => Math.max(0, Math.min(1, 0.12 + e.dark * 0.78 + e.overcast * 0.25 + e.storm * 0.2));
  const neonVis = e => Math.max(0, Math.min(1, 0.22 + 0.78 * e.dark + 0.25 * e.rain + 0.2 * e.overcast)) * (1 - 0.4 * e.fog * (1 - e.dark));

  function outline(k, tw, ground) {
    const x0 = tw.x, x1 = tw.x + tw.w, top = ground - tw.h;
    k.beginPath();
    if (tw.shape === 1) { const s = tw.w * 0.18, sh = tw.h * 0.08;
      k.moveTo(x0, ground); k.lineTo(x0, top + 2 * sh); k.lineTo(x0 + s, top + 2 * sh); k.lineTo(x0 + s, top + sh); k.lineTo(x0 + 2 * s, top + sh); k.lineTo(x0 + 2 * s, top);
      k.lineTo(x1 - 2 * s, top); k.lineTo(x1 - 2 * s, top + sh); k.lineTo(x1 - s, top + sh); k.lineTo(x1 - s, top + 2 * sh); k.lineTo(x1, top + 2 * sh); k.lineTo(x1, ground);
    } else if (tw.shape === 2) { k.moveTo(x0, ground); k.lineTo(x0, top + tw.h * 0.06); k.lineTo(x0 + tw.w / 2, top - tw.h * 0.12); k.lineTo(x1, top + tw.h * 0.06); k.lineTo(x1, ground); }
    else if (tw.shape === 3) { k.moveTo(x0, ground); k.lineTo(x0, top + tw.h * 0.1); k.lineTo(x1, top); k.lineTo(x1, ground); }
    else if (tw.shape === 4) { k.moveTo(x0, ground); k.lineTo(x0, top + tw.w * 0.3); k.quadraticCurveTo(x0 + tw.w / 2, top - tw.w * 0.2, x1, top + tw.w * 0.3); k.lineTo(x1, ground); }
    else { k.moveTo(x0, ground); k.lineTo(x0, top); k.lineTo(x1, top); k.lineTo(x1, ground); }
    k.closePath();
  }

  function drawTower(k, tw, e, litF) {
    const top = e.ground - tw.h;
    const dayTop = lerp(lerp(e.skyMid, e.skyTop, 0.3), H2('#24324C'), 0.55), dayBot = lerp(e.skyBot, H2('#121A28'), 0.82);
    let cTop = lerp(dayTop, H2('#0C1326'), e.dark), cBot = lerp(dayBot, H2('#05080F'), e.dark);
    const dm = [0.5, 0.08, 0][tw.layer] * (1 + 1.5 * e.fog);
    cTop = lerp(cTop, e.skyBot, Math.min(0.92, dm)); cBot = lerp(cBot, e.skyBot, Math.min(0.92, dm * 0.9));
    if (tw.layer === 2) { cTop = lerp(cTop, BLACK, 0.25); cBot = lerp(cBot, BLACK, 0.35); }
    const g = k.createLinearGradient(0, top, 0, e.ground); g.addColorStop(0, rgba(cTop)); g.addColorStop(1, rgba(cBot));
    outline(k, tw, e.ground); k.fillStyle = g; k.fill();
    if (tw.layer > 0 && e.dark < 0.7) {
      k.save(); outline(k, tw, e.ground); k.clip();
      const s = k.createLinearGradient(tw.x, top, tw.x + tw.w, top + tw.w), a = 0.18 * (1 - e.dark) * (1 - e.overcast * 0.6);
      s.addColorStop(0.3, 'rgba(255,255,255,0)'); s.addColorStop(0.5, `rgba(255,255,255,${a.toFixed(3)})`); s.addColorStop(0.7, 'rgba(255,255,255,0)');
      k.fillStyle = s; k.fillRect(tw.x, top - tw.h * 0.2, tw.w, tw.h * 1.2); k.restore();
    }
    if (tw.layer === 0) return;
    const r = prng(tw.seed), cw = tw.layer === 2 ? 5.5 : 4, ch = tw.layer === 2 ? 3.2 : 2.6, gx = cw + 2.2, gy = ch + 3.4;
    const cols = Math.floor((tw.w - 6) / gx), startY = top + tw.h * 0.1, rows = Math.floor((e.ground - startY - 4) / gy);
    const warm = H2('#FFE2A8'), off = lerp(e.skyTop, WHITE, 0.3), ox = tw.x + (tw.w - cols * gx) / 2 + 1;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const v = r(), tint = r();
      k.fillStyle = v < litF * 0.72 ? rgba(tint < 0.6 ? warm : ICE, (0.55 + 0.4 * tint) * (0.35 + 0.65 * e.dark)) : rgba(off, 0.08 * (1 - e.dark));
      k.fillRect(ox + col * gx, startY + row * gy, cw, ch);
    }
  }

  function renderTowers(e, dpr) {
    const cv = document.createElement('canvas'); cv.width = Math.round(e.W * dpr); cv.height = Math.round(e.H * dpr);
    const k = cv.getContext('2d'); k.setTransform(dpr, 0, 0, dpr, 0, 0);
    const litF = lit(e);
    for (let layer = 0; layer <= 2; layer++) {
      towers.filter(t => t.layer === layer).forEach(t => drawTower(k, t, e, litF));
      if (layer === 0) { const g = k.createLinearGradient(0, e.ground - e.H * 0.55, 0, e.ground); g.addColorStop(0, rgba(e.skyBot, 0)); g.addColorStop(1, rgba(e.skyBot, 0.55 + 0.35 * e.fog)); k.fillStyle = g; k.fillRect(0, 0, e.W, e.ground); }
    }
    return cv;
  }

  function line(c, x0, y0, x1, y1, col, a, w) {
    c.lineCap = 'round';
    c.strokeStyle = rgba(col, 0.16 * a); c.lineWidth = w * 4; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    c.strokeStyle = rgba(lerp(col, WHITE, 0.35), a); c.lineWidth = w; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  }
  const radial = (c, x, y, r, col, a) => { const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, rgba(col, a)); g.addColorStop(1, rgba(col, 0)); c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); };

  function cityGlow(c, e) {
    const a = e.dark * (0.18 + 0.3 * e.overcast + 0.2 * e.fog); if (a < 0.01) return;
    const y0 = e.ground - e.H * 0.55, g = c.createLinearGradient(0, y0, 0, e.ground);
    g.addColorStop(0, 'rgba(42,107,255,0)'); g.addColorStop(0.7, rgba(H2('#2A6BFF'), a * 0.6)); g.addColorStop(1, rgba(AMBER, a * 0.5));
    c.fillStyle = g; c.fillRect(0, y0, e.W, e.ground - y0);
  }

  function searchlights(c, e) {
    const a = e.dark * (0.06 + 0.16 * e.fog + 0.08 * e.overcast); if (a < 0.01) return;
    [[0.22, 0.9], [0.74, -0.7]].forEach(([fx, sp], i) => {
      const bx = e.W * fx, by = e.ground - e.H * 0.18, ang = Math.sin(e.t * 0.18 * sp + i * 2) * 0.55, len = e.H * 0.9;
      const ex = bx + len * Math.sin(ang), ey = by - len * Math.cos(ang), spread = e.W * 0.09;
      const g = c.createLinearGradient(bx, by, ex, ey); g.addColorStop(0, rgba(ICE, a)); g.addColorStop(1, rgba(ICE, 0));
      c.fillStyle = g; c.beginPath(); c.moveTo(bx, by); c.lineTo(ex - spread, ey); c.lineTo(ex + spread, ey); c.closePath(); c.fill();
    });
  }

  function drawCrafts(c, e, far) {
    const n = Math.max(3, Math.floor(crafts.length * (1 - 0.55 * e.storm - 0.35 * e.fog))), sway = 1 + e.windKmh / 25;
    crafts.slice(0, n).forEach(cr => {
      if ((cr.depth < 0.8) !== far) return;
      cr.x += cr.dir * cr.speed * e.dt * (1 + e.windX * cr.dir * 0.15);
      const span = e.W + 80; if (cr.x > e.W + 40) cr.x -= span; if (cr.x < -40) cr.x += span;
      const y = e.H * cr.lane + Math.sin(e.t * 1.3 + cr.phase) * 2.5 * sway + Math.sin(e.t * 0.4 + cr.phase) * 6, s = cr.depth;
      const lightA = Math.min(1, 0.45 + 0.55 * e.dark), tl = (18 + cr.speed * 0.6) * s;
      const g = c.createLinearGradient(cr.x, y, cr.x - cr.dir * tl, y); g.addColorStop(0, rgba(cr.tail, 0.55 * lightA)); g.addColorStop(1, rgba(cr.tail, 0));
      c.fillStyle = g; c.fillRect(Math.min(cr.x, cr.x - cr.dir * tl), y - 0.9 * s, tl, 1.8 * s);
      c.fillStyle = rgba(lerp(H2('#3A475E'), H2('#0A0E16'), e.dark)); c.beginPath(); c.roundRect(cr.x - 6 * s, y - 1.6 * s, 12 * s, 3.2 * s, 2 * s); c.fill();
      c.fillStyle = rgba(ICE, 0.5); c.fillRect(cr.x - 2 * s, y - 1.6 * s, 4 * s, s);
      if (e.dark > 0.15) radial(c, cr.x + cr.dir * 6 * s, y, 7 * s, WHITE, 0.8 * e.dark);
      c.fillStyle = rgba(WHITE, 0.6 + 0.4 * e.dark); c.beginPath(); c.arc(cr.x + cr.dir * 6 * s, y, 1.1 * s, 0, 7); c.fill();
      c.fillStyle = rgba(cr.tail, lightA); c.beginPath(); c.arc(cr.x - cr.dir * 6 * s, y, 1.3 * s, 0, 7); c.fill();
    });
  }

  function rail(c, e) {
    const y = e.ground - e.H * 0.085, col = lerp(H2('#3A4458'), H2('#101624'), e.dark);
    c.fillStyle = rgba(col); c.fillRect(0, y, e.W, 2.5);
    c.fillStyle = rgba(col, 0.85); for (let px = 20; px < e.W; px += 150) c.fillRect(px, y, 2, e.ground - y);
    line(c, 0, y + 2.6, e.W, y + 2.6, NEON[0], neonVis(e) * 0.5, 0.8);
    railT += e.dt; const f = (railT % 22) / 7; if (f > 1) return;
    const carW = 34, cars = 5, total = carW * cars, x = -total + f * (e.W + total * 2);
    for (let i = 0; i < cars; i++) {
      const cx = x + i * (carW + 2);
      c.fillStyle = rgba(lerp(H2('#D8E2EE'), H2('#1A2236'), e.dark)); c.beginPath(); c.roundRect(cx, y - 9, carW, 8, 3); c.fill();
      c.fillStyle = rgba(ICE, 0.35 + 0.6 * e.dark); c.fillRect(cx + 3, y - 7, carW - 6, 2.5);
    }
    if (e.dark > 0.3) radial(c, x + total, y - 5, 30, WHITE, 0.5 * e.dark);
  }

  function neon(c, e) {
    const vis = neonVis(e); if (vis < 0.03) return;
    towers.forEach(tw => {
      if (tw.layer === 0) return;
      const top = e.ground - tw.h, pulse = 0.75 + 0.25 * Math.sin(e.t * (1.2 + (tw.seed & 7) * 0.15) + tw.seed);
      const stutter = e.storm > 0.3 && ((tw.seed + Math.floor(e.t * 9)) % 11 === 0) ? 0.15 : 1;
      const a = vis * pulse * stutter * (tw.layer === 2 ? 1 : 0.6), sw = tw.layer === 2 ? 2 : 1.3;
      line(c, tw.x + sw, top + tw.h * 0.1, tw.x + sw, e.ground, tw.neon, a, sw);
      if ((tw.seed & 1) === 0) line(c, tw.x + tw.w - sw, top + tw.h * 0.1, tw.x + tw.w - sw, e.ground, tw.neon, a, sw);
      const bandY = top + tw.h * (tw.shape === 2 ? 0.1 : 0.07); line(c, tw.x + 2, bandY, tw.x + tw.w - 2, bandY, tw.neon, a, sw);
      if (tw.layer === 2) { const f = (e.t * 0.25 + (tw.seed & 15) / 15) % 1; c.fillStyle = rgba(WHITE, a); c.beginPath(); c.arc(tw.x + sw, e.ground - f * tw.h * 0.9, 2.2, 0, 7); c.fill(); }
    });
  }

  function beacons(c, e) {
    towers.forEach(tw => {
      if (!tw.beacon || tw.layer === 0) return;
      if ((e.t + (tw.seed & 31) * 0.1) % 1.6 >= 0.18) return;
      const top = e.ground - tw.h - (tw.shape === 2 ? tw.h * 0.12 : 0), x = tw.x + tw.w / 2;
      radial(c, x, top, 9, RED, 0.7); c.fillStyle = '#FFD0D0'; c.beginPath(); c.arc(x, top, 1.6, 0, 7); c.fill();
    });
  }

  function boards(c, e) {
    towers.forEach(tw => {
      if (!tw.board) return;
      const top = e.ground - tw.h, bw = tw.w * 0.78, bh = Math.min(tw.h * 0.16, bw * 0.55), bx = tw.x + (tw.w - bw) / 2, by = top + tw.h * 0.2;
      if (e.storm > 0.3 && ((Math.floor(e.t * 7) + tw.seed) % 9 === 0)) return;
      const col = tw.board === 1 ? tempCol(e.tempC) : NEON[0], a = (0.55 + 0.45 * e.dark) * (1 - 0.5 * e.fog * (1 - e.dark));
      c.fillStyle = 'rgba(2,6,16,.75)'; c.fillRect(bx, by, bw, bh);
      c.fillStyle = rgba(col, 0.12 * a); c.fillRect(bx, by, bw, bh);
      c.strokeStyle = rgba(col, 0.8 * a); c.lineWidth = 1.2; c.strokeRect(bx, by, bw, bh);
      const sy = by + ((e.t * 0.6 + tw.seed * 0.01) % 1) * bh; c.fillStyle = rgba(col, 0.25 * a); c.fillRect(bx, sy, bw, 1.5);
      let text;
      if (tw.board === 1) text = isNaN(e.tempC) ? '--°' : `${Math.trunc(e.tempC)}°`;
      else { const m = e.minute, items = [e.label || 'SKYFALL', `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`, 'SKYFALL']; text = items[Math.floor(e.t / 4) % items.length]; }
      let size = bh * (tw.board === 1 ? 0.7 : 0.42);
      c.font = `700 ${size}px 'Roboto Condensed','Arial Narrow',sans-serif-condensed,sans-serif`;
      while (c.measureText(text).width > bw * 0.9 && size > 6) { size *= 0.9; c.font = `700 ${size}px 'Roboto Condensed','Arial Narrow',sans-serif`; }
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = 3; c.strokeStyle = rgba(col, 0.35 * a); c.strokeText(text, bx + bw / 2, by + bh / 2);
      c.fillStyle = rgba(lerp(col, WHITE, 0.5), a); c.fillText(text, bx + bw / 2, by + bh / 2);
      c.textAlign = 'start'; c.textBaseline = 'alphabetic';
    });
  }

  function snowCaps(c, e) {
    if (e.snowDepth < 0.5) return; c.fillStyle = 'rgba(255,255,255,.92)';
    towers.forEach(tw => { if (tw.layer === 0 || tw.shape === 2 || tw.shape === 4) return; const top = e.ground - tw.h; c.fillRect(tw.x, top - e.snowDepth * 0.5, tw.w, e.snowDepth * 0.5 + 1); });
  }

  function street(c, e) {
    const g0 = e.ground, g = c.createLinearGradient(0, g0, 0, e.H);
    g.addColorStop(0, rgba(lerp(H2('#2A3142'), H2('#070A12'), e.dark))); g.addColorStop(1, rgba(lerp(H2('#161B26'), H2('#020409'), e.dark)));
    c.fillStyle = g; c.fillRect(0, g0, e.W, e.H - g0);
    const wet = Math.min(1, e.rain * 1.2 + e.snow * 0.2), mirror = (0.12 + 0.7 * wet) * neonVis(e);
    if (mirror > 0.02) towers.forEach(tw => {
      if (tw.layer === 0) return;
      const col = tw.board === 1 ? tempCol(e.tempC) : tw.neon;
      [tw.x + 2, tw.x + tw.w - 2, tw.x + tw.w / 2].forEach((x, i) => {
        if (i === 1 && (tw.seed & 1)) return; if (i === 2 && !tw.board) return;
        const wob = Math.sin(e.t * 3 + x * 0.05) * 1.5 * (0.3 + wet), len = (e.H - g0) * (0.5 + 0.5 * wet), ww = i === 2 ? tw.w * 0.3 : 2.5;
        const lg = c.createLinearGradient(0, g0, 0, g0 + len); lg.addColorStop(0, rgba(col, mirror * (i === 2 ? 0.6 : 0.45))); lg.addColorStop(1, rgba(col, 0));
        c.fillStyle = lg; c.fillRect(x - ww / 2 + wob, g0, ww, len);
      });
    });
    c.fillStyle = rgba(AMBER, 0.25 + 0.35 * e.dark);
    const ly = g0 + (e.H - g0) * 0.55; for (let x = ((e.t * 40) % 60) - 60; x < e.W; x += 60) c.fillRect(x, ly, 26, 1.5);
    if (e.dark > 0.2) for (let lx = 30; lx < e.W; lx += 110) radial(c, lx, g0 + 2, 22 * (1 + e.fog), H2('#FFD08A'), 0.45 * e.dark);
  }

  return {
    draw(c, e, dpr) {
      build(e.W, e.H, e.ground);
      cityGlow(c, e);
      const q = (v, n) => Math.round(Math.max(0, Math.min(1, v)) * (n - 1));
      const key = [q(e.dark, 24), q(e.overcast, 8), q(e.fog, 8), q(e.storm, 4), Math.floor(e.minute / 5), e.W, e.H, dpr].join(':');
      sinceBuild += e.dt;
      if (!cache || (key !== cacheKey && sinceBuild > 2)) { cacheKey = key; sinceBuild = 0; cache = renderTowers(e, dpr); }
      searchlights(c, e);
      drawCrafts(c, e, true);
      c.drawImage(cache, 0, 0, e.W, e.H);
      rail(c, e); neon(c, e); boards(c, e); beacons(c, e); snowCaps(c, e); street(c, e);
      drawCrafts(c, e, false);
    },
  };
})();

/* Activity landscapes for the Activities page (port of Android scene/Landscape.kt). */
const Landscape = (() => {
  const H2 = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const lerp = (a, b, f) => { const k = Math.max(0, Math.min(1, f)); return a.map((v, i) => v + (b[i] - v) * k); };
  const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  const prng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const WHITE = [255, 255, 255], RED = H2('#FF4D4D'), LAMP = H2('#FFD08A');
  let c, e;
  const green = (day, night) => { let g = lerp(lerp(H2(day), H2('#7C8794'), e.overcast * 0.35), H2(night), e.dark); if (e.snowDepth > 1) g = lerp(g, WHITE, Math.min(0.85, e.snowDepth / 6)); return g; };
  const lampA = () => Math.max(0, Math.min(1, (e.dark - 0.25) / 0.6)) * (1 + 0.4 * e.overcast);
  const sway = k => Math.sin(e.t * (1.1 + k) + k * 9) * (0.6 + e.windKmh / 18) * e.windX;
  const glow = (x, y, r, col, a) => { if (a < 0.01) return; const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, rgba(col, a)); g.addColorStop(1, rgba(col, 0)); c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); };
  function hill(y, amp, wl, ph, col, haze) {
    c.beginPath(); c.moveTo(0, e.H);
    for (let x = 0; x <= e.W + 8; x += 8) c.lineTo(x, y - amp * (0.6 * Math.sin(x / wl + ph) + 0.4 * Math.sin(x / (wl * 0.43) + ph * 1.7)));
    c.lineTo(e.W, e.H); c.closePath(); c.fillStyle = rgba(lerp(col, e.skyBot, haze)); c.fill();
  }
  const tri = (pts, col) => { c.beginPath(); c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.closePath(); c.fillStyle = typeof col === 'string' ? col : rgba(col); c.fill(); };
  const pine = (x, base, h, col) => tri([x, base - h, x - h * 0.28, base, x + h * 0.28, base], col);
  function roundTree(x, base, h, col, sw) {
    c.fillStyle = rgba(lerp(col, [0, 0, 0], 0.4)); c.fillRect(x - h * 0.05, base - h * 0.45, h * 0.1, h * 0.45);
    c.fillStyle = rgba(col); [[0, -0.62, 0.36], [-0.2, -0.5, 0.26], [0.2, -0.52, 0.27]].forEach(([dx, dy, r]) => { c.beginPath(); c.arc(x + sw + dx * h, base + dy * h, r * h, 0, 7); c.fill(); });
  }
  const line = (x0, y0, x1, y1, col, w) => { c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); };

  function golf() {
    const g = e.ground;
    hill(g - e.H * 0.16, e.H * 0.03, 140, 0.5, green('#3F7A55', '#0B1A12'), 0.55);
    hill(g - e.H * 0.09, e.H * 0.025, 110, 2.1, green('#3C8A4A', '#0A1A10'), 0.25);
    const r = prng(5); for (let i = 0; i < 9; i++) { const x = r() * e.W, h = 28 + r() * 26; roundTree(x, g - e.H * 0.08 + r() * 6, h, green('#2D6B3A', '#07120A'), sway(i)); }
    c.fillStyle = rgba(green('#57A85A', '#0E2414')); c.fillRect(0, g - e.H * 0.06, e.W, e.H);
    for (let i = 0; i < 8; i += 2) { const y0 = g - e.H * 0.06 + e.H * 0.18 * (i / 8) ** 2, y1 = g - e.H * 0.06 + e.H * 0.18 * ((i + 1) / 8) ** 2; c.fillStyle = rgba(WHITE, 0.06 * (1 - e.dark)); c.fillRect(0, y0, e.W, y1 - y0); }
    c.fillStyle = rgba(lerp(H2('#E8D7A8'), H2('#2A2618'), e.dark)); c.beginPath(); c.ellipse(e.W * 0.24, g - e.H * 0.02, e.W * 0.12, e.H * 0.015, 0, 0, 7); c.fill();
    c.fillStyle = rgba(green('#6CC46A', '#12301A')); c.beginPath(); c.ellipse(e.W * 0.72, g - e.H * 0.04, e.W * 0.2, e.H * 0.02, 0, 0, 7); c.fill();
    const px = e.W * 0.72, py = g - e.H * 0.04, ph = e.H * 0.09;
    line(px, py, px, py - ph, rgba(lerp(H2('#EEEEEE'), H2('#9AA6B5'), e.dark)), 1.6);
    const flap = 0.5 + 0.5 * Math.sin(e.t * (3 + e.windKmh / 8)), fw = Math.min(26, 14 + e.windKmh * 0.25) * (e.windX < 0 ? -1 : 1);
    tri([px, py - ph, px + fw, py - ph + 4 * flap + 2, px, py - ph + 9], '#FF4D4D');
    glow(px, py - ph, 16, RED, 0.5 * lampA());
    for (let lx = 20; lx < e.W; lx += 70) glow(lx, g + e.H * 0.03, 14, LAMP, 0.5 * lampA());
  }
  function sea(boats) {
    const hz = e.H * 0.64, g = e.ground;
    hill(hz, e.H * 0.03, 90, 1.2, green('#4E6E5A', '#0A1410'), 0.6);
    const wg = c.createLinearGradient(0, hz, 0, g); wg.addColorStop(0, rgba(lerp(e.skyBot, H2('#0D3A66'), 0.35 + 0.3 * e.dark))); wg.addColorStop(1, rgba(lerp(e.skyMid, H2('#06182C'), 0.55 + 0.3 * e.dark)));
    c.fillStyle = wg; c.fillRect(0, hz, e.W, g + e.H * 0.02 - hz);
    const chop = 1 + e.windKmh / 20 + e.storm;
    for (let i = 0; i < 18; i++) {
      const y = hz + (g - hz) * (i / 18) ** 2 + 2, a = 0.08 + 0.12 * (i / 18), off = (e.t * (8 + i * 1.5) * chop) % 60;
      for (let x = -60 + off; x < e.W; x += 40 + i * 3) line(x, y, x + 14 + i, y, rgba(lerp(WHITE, H2('#9FD8FF'), e.dark), a), 1);
    }
    const glit = (1 - e.overcast * 0.8) * (1 - e.fog);
    if (glit > 0.05) for (let i = 0; i < 24; i++) { const y = hz + (g - hz) * (i / 24), w = (6 + i * 1.5) * (0.6 + 0.4 * Math.sin(e.t * 2 + i)); c.fillStyle = rgba(e.dark > 0.5 ? H2('#DDE6FF') : H2('#FFF2C8'), 0.22 * glit); c.fillRect(e.W * 0.55 - w, y, w * 2, 1.4); }
    if (boats) for (let i = 0; i < 3; i++) {
      const y = hz + (g - hz) * (0.25 + i * 0.22), sc = 0.6 + i * 0.3, x = ((e.t * (6 + i * 4) + i * 300) % (e.W + 80)) - 40;
      const heel = Math.min(0.35, e.windKmh / 60) * (e.windX < 0 ? -1 : 1) + Math.sin(e.t * 1.4 + i) * 0.04;
      c.save(); c.translate(x, y); c.rotate(heel);
      const sail = rgba(lerp(H2('#F4F6F8'), H2('#2A3346'), e.dark));
      tri([0, -34 * sc, 16 * sc, -4 * sc, 0, -4 * sc], sail); tri([-2 * sc, -28 * sc, -14 * sc, -4 * sc, -2 * sc, -4 * sc], sail);
      c.fillStyle = rgba(lerp(H2('#223047'), H2('#05080F'), e.dark)); c.fillRect(-16 * sc, -4 * sc, 34 * sc, 4 * sc); c.restore();
      glow(x, y - 34 * sc, 8, RED, 0.7 * lampA());
    }
    c.fillStyle = rgba(lerp(lerp(H2('#E2CFA0'), H2('#8C8A80'), e.rain * 0.5), H2('#14130E'), e.dark));
    c.beginPath(); c.moveTo(0, e.H); c.lineTo(0, g - 6); for (let x = 0; x <= e.W; x += 10) c.lineTo(x, g + 4 * Math.sin(x / 70)); c.lineTo(e.W, e.H); c.closePath(); c.fill();
    const surf = 0.5 + 0.5 * Math.sin(e.t * 0.9);
    c.strokeStyle = rgba(WHITE, (0.35 + 0.3 * surf) * (1 - 0.5 * e.dark)); c.lineWidth = 2; c.beginPath();
    for (let x = 0; x <= e.W; x += 10) { const yy = g - 4 - surf * 6 + 3 * Math.sin(x / 40 + e.t); x ? c.lineTo(x, yy) : c.moveTo(x, yy); } c.stroke();
    if (e.t % 2.5 < 0.3) glow(e.W * 0.2, hz + (g - hz) * 0.4, 12, H2('#3DFFD0'), 0.4 + 0.5 * e.dark);
  }
  function alpine() {
    const g = e.ground;
    const range = (base, peakH, seed, rock, haze) => {
      const r = prng(seed), pts = []; c.beginPath(); c.moveTo(0, e.H); c.lineTo(0, base);
      for (let x = 0; x < e.W + 60;) { const y = base - peakH * (0.35 + 0.65 * r()); pts.push([x, y]); c.lineTo(x, y); x += 50 + r() * 70; c.lineTo(x - 20, base - peakH * 0.15 * r()); }
      c.lineTo(e.W, e.H); c.closePath(); c.fillStyle = rgba(lerp(lerp(H2(rock), H2('#0A1020'), e.dark), e.skyBot, haze)); c.fill();
      const snowC = lerp(lerp(WHITE, H2('#8090B0'), e.dark), e.skyBot, haze); pts.forEach(([px, py]) => tri([px, py, px - 14, py + 18, px + 12, py + 16], snowC));
    };
    range(g - e.H * 0.2, e.H * 0.22, 3, '#6C7A90', 0.55); range(g - e.H * 0.08, e.H * 0.16, 8, '#4E5A6E', 0.2);
    c.fillStyle = rgba(lerp(H2('#F2F6FA'), H2('#1A2232'), e.dark)); c.fillRect(0, g - e.H * 0.04, e.W, e.H);
    const r = prng(12); for (let i = 0; i < 14; i++) pine(r() * e.W, g - e.H * 0.02 + r() * e.H * 0.05, 22 + r() * 30, lerp(H2('#1E4A34'), H2('#050C08'), e.dark));
    const y0 = g - e.H * 0.22, y1 = g - e.H * 0.02; line(e.W * 0.95, y0, e.W * 0.15, y1, rgba(lerp(H2('#333333'), H2('#8899AA'), e.dark), 0.8), 1);
    for (let i = 0; i < 6; i++) { const f = (e.t * 0.03 + i / 6) % 1, cx = e.W * 0.95 + (e.W * 0.15 - e.W * 0.95) * f, cy = y0 + (y1 - y0) * f; line(cx, cy, cx, cy + 8, 'rgba(0,0,0,.7)', 1); c.fillStyle = rgba(lerp(H2('#E23636'), H2('#3A1010'), e.dark)); c.fillRect(cx - 4, cy + 8, 8, 3); }
    glow(e.W * 0.2, g + e.H * 0.02, 40, H2('#FFC27A'), 0.55 * lampA());
    c.fillStyle = rgba(lerp(H2('#5A3A26'), H2('#120C08'), e.dark)); c.fillRect(e.W * 0.16, g - 2, e.W * 0.1, e.H * 0.03 + 2);
    c.fillStyle = rgba(LAMP, 0.2 + 0.7 * lampA()); c.fillRect(e.W * 0.18, g + 4, e.W * 0.02, 6); c.fillRect(e.W * 0.22, g + 4, e.W * 0.02, 6);
  }
  function stadium() {
    const g = e.ground, la = Math.max(lampA(), 0.35 * e.overcast + 0.6 * e.rain * (1 - e.dark));
    c.fillStyle = rgba(lerp(H2('#2A3346'), H2('#070A12'), e.dark)); c.beginPath(); c.moveTo(0, g); c.lineTo(0, g - e.H * 0.2); c.quadraticCurveTo(e.W / 2, g - e.H * 0.27, e.W, g - e.H * 0.2); c.lineTo(e.W, g); c.closePath(); c.fill();
    const r = prng(4), cols = [WHITE, H2('#4C9BFF'), H2('#FFB547'), H2('#3DFFD0')];
    for (let i = 0; i < 260; i++) { const x = r() * e.W, yy = g - e.H * (0.05 + r() * 0.14); c.fillStyle = rgba(cols[Math.floor(r() * 4)], 0.25 + 0.35 * la * (0.6 + 0.4 * Math.sin(e.t * 3 + x))); c.fillRect(x, yy, 1.6, 1.6); }
    [0.06, 0.94, 0.3, 0.7].forEach((fx, i) => {
      const x = e.W * fx, top = g - e.H * (i < 2 ? 0.36 : 0.31);
      line(x, g - e.H * 0.18, x, top, rgba(lerp(H2('#4A5568'), H2('#101624'), e.dark)), 2);
      c.fillStyle = rgba(WHITE, 0.3 + 0.7 * la); c.fillRect(x - 9, top - 6, 18, 6); glow(x, top - 3, 70, H2('#EFF6FF'), 0.45 * la);
      if (la > 0.1) { const lg = c.createLinearGradient(x, top, e.W / 2, g); lg.addColorStop(0, rgba(WHITE, 0.12 * la)); lg.addColorStop(1, rgba(WHITE, 0)); c.fillStyle = lg; c.beginPath(); c.moveTo(x - 6, top); c.lineTo(x + 6, top); c.lineTo(e.W * 0.62, g); c.lineTo(e.W * 0.38, g); c.closePath(); c.fill(); }
    });
    c.fillStyle = rgba(lerp(green('#3F9A4C', '#0E2A16'), H2('#4FC060'), 0.5 * la)); c.fillRect(0, g - e.H * 0.03, e.W, e.H);
    line(e.W / 2, g - e.H * 0.03, e.W / 2, e.H, rgba(WHITE, 0.35 + 0.3 * la), 1.5);
    c.strokeStyle = rgba(WHITE, 0.35 + 0.3 * la); c.beginPath(); c.ellipse(e.W / 2, g + e.H * 0.03, e.W * 0.1, e.H * 0.03, 0, 0, 7); c.stroke();
    const bx = e.W * 0.42, by = g - e.H * 0.26; c.fillStyle = '#020610'; c.fillRect(bx, by, e.W * 0.16, e.H * 0.035);
    c.strokeStyle = 'rgba(0,229,255,.8)'; c.lineWidth = 1; c.strokeRect(bx, by, e.W * 0.16, e.H * 0.035);
    c.fillStyle = '#BFEFFF'; c.textAlign = 'center'; c.font = `700 ${e.H * 0.024}px sans-serif`; c.fillText(isNaN(e.tempC) ? '--°' : `${Math.trunc(e.tempC)}°`, bx + e.W * 0.08, by + e.H * 0.027); c.textAlign = 'start';
  }
  function road() {
    const g = e.ground, hz = e.H * 0.66;
    hill(hz, e.H * 0.04, 120, 0.3, green('#55705E', '#0B140F'), 0.55); hill(hz + e.H * 0.06, e.H * 0.03, 90, 2.4, green('#4C8A50', '#0A180E'), 0.2);
    c.fillStyle = rgba(green('#4E9A4E', '#0A180E')); c.fillRect(0, hz + e.H * 0.08, e.W, e.H);
    const vx = e.W * 0.55, vy = hz + e.H * 0.05; let rc = lerp(H2('#3A4048'), H2('#0B0D12'), e.dark); if (e.rain > 0.1) rc = lerp(rc, H2('#20262E'), 0.4);
    tri([vx - 4, vy, vx + 4, vy, e.W * 0.95, e.H, e.W * 0.05, e.H], rc);
    for (let i = 0; i < 14; i++) { const f = ((i / 14) + e.t * 0.12) % 1, f2 = f * f, y = vy + (e.H - vy) * f2, w = 1 + 5 * f2, len = 4 + 40 * f2, x = vx + (e.W * 0.5 - vx) * f2; c.fillStyle = 'rgba(255,210,61,.8)'; c.fillRect(x - w / 2, y, w, len); }
    for (let i = 0; i < 3; i++) { const f = (e.t * 0.05 + i / 3) % 1, f2 = f * f; glow(vx + (e.W * 0.35 - vx) * f2, vy + (e.H - vy) * f2, 4 + 14 * f2, RED, 0.3 + 0.6 * lampA()); }
    if (e.rain > 0.1) { c.fillStyle = rgba(H2('#FFB547'), 0.15 * e.rain * (0.3 + lampA())); c.fillRect(e.W * 0.33, g, e.W * 0.04, e.H - g); }
    for (let i = 0; i < 8; i++) { const f2 = (i / 8) ** 2, y = vy + (e.H - vy) * f2; [-1, 1].forEach(sd => { const x = vx + sd * e.W * 0.48 * f2; c.fillStyle = 'rgba(255,255,255,.7)'; c.fillRect(x - 1, y - 6 * f2 - 2, 2, 6 * f2 + 2); glow(x, y - 6 * f2, 6, H2('#FFB547'), 0.6 * lampA()); }); }
  }
  function field() {
    const g = e.ground;
    hill(g - e.H * 0.12, e.H * 0.05, 150, 0.9, green('#3A5A44', '#05080A'), 0.4); hill(g - e.H * 0.05, e.H * 0.02, 100, 2.2, green('#3F6A46', '#040608'), 0.1);
    const x = e.W * 0.7, y = g - e.H * 0.07; c.fillStyle = rgba(lerp(H2('#D8DEE6'), H2('#141A24'), e.dark)); c.fillRect(x - 26, y - 18, 52, 18); c.beginPath(); c.arc(x, y - 18, 26, Math.PI, 0); c.fill();
    c.fillStyle = rgba(H2('#00E5FF'), 0.2 + 0.6 * lampA()); c.fillRect(x - 3, y - 44, 6, 26);
    const tc = rgba(lerp(H2('#333C48'), [0, 0, 0], e.dark)), bx = e.W * 0.25, by = g - e.H * 0.02;
    line(bx, by, bx + 20, by - 26, tc, 3); line(bx + 6, by - 10, bx, g + 6, tc, 1.5); line(bx + 6, by - 10, bx + 14, g + 6, tc, 1.5);
    c.fillStyle = rgba(green('#355C3E', '#030506')); c.fillRect(0, g, e.W, e.H - g);
    if (e.dark > 0.5 && e.rain < 0.2) { const r = prng(9); for (let i = 0; i < 24; i++) { const fx = r() * e.W, fy = g - r() * e.H * 0.08; glow(fx + Math.sin(e.t + fx) * 6, fy + Math.sin(e.t * 1.3 + fy) * 4, 4, H2('#D8FF7A'), 0.5 * (0.5 + 0.5 * Math.sin(e.t * 2 + fx))); } }
  }
  function park(lights) {
    const g = e.ground;
    hill(g - e.H * 0.14, e.H * 0.04, 130, 0.2, green('#4B7A58', '#0A140E'), 0.5); hill(g - e.H * 0.07, e.H * 0.03, 95, 1.9, green('#4A904F', '#0A1A0F'), 0.2);
    const r = prng(21); for (let i = 0; i < 11; i++) { const x = r() * e.W; roundTree(x, g - e.H * 0.05 + r() * 8, 30 + r() * 34, green('#2F6E3C', '#06100A'), sway(i)); }
    c.fillStyle = rgba(green('#5AA65C', '#0C1E10')); c.fillRect(0, g - e.H * 0.02, e.W, e.H);
    let tc = lerp(H2('#CDBB8E'), H2('#1E1A12'), e.dark); if (e.rain > 0.2) tc = lerp(tc, H2('#6A6050'), 0.3);
    c.fillStyle = rgba(tc); c.beginPath(); c.moveTo(e.W * 0.48, g - e.H * 0.02); c.bezierCurveTo(e.W * 0.62, g + e.H * 0.02, e.W * 0.2, g + e.H * 0.05, e.W * 0.3, e.H);
    c.lineTo(e.W * 0.55, e.H); c.bezierCurveTo(e.W * 0.45, g + e.H * 0.05, e.W * 0.7, g + e.H * 0.02, e.W * 0.52, g - e.H * 0.02); c.closePath(); c.fill();
    const la = lampA();
    [0.12, 0.36, 0.68, 0.9].forEach(fx => { const x = e.W * fx, top = g - e.H * 0.06; line(x, g + e.H * 0.03, x, top, rgba(lerp(H2('#3A4048'), H2('#0A0C10'), e.dark)), 1.6); c.fillStyle = rgba(H2('#FFE2A8'), 0.3 + 0.7 * la); c.beginPath(); c.arc(x, top, 2.5, 0, 7); c.fill(); glow(x, top, 26 * (1 + e.fog), LAMP, 0.55 * la); });
    if (lights && la > 0.05) { const cs = ['#FFB547', '#3DFFD0', '#4C9BFF'].map(H2); for (let k = 0; k < 30; k++) { const f = k / 30; glow(e.W * (0.1 + 0.8 * f), g - e.H * 0.07 + Math.sin(f * Math.PI * 3) * 8 + 10, 5, cs[k % 3], 0.8 * la * (0.7 + 0.3 * Math.sin(e.t * 2 + k))); } }
  }
  return {
    draw(ctx, kind, env) {
      c = ctx; e = env;
      ({ golf, water: () => sea(false), wind: () => sea(true), snow: alpine, ball: stadium, ride: road, sky: field, foot: () => park(false), chill: () => park(true) }[kind] || (() => park(false)))();
      if (e.fog > 0.02) { const fg = c.createLinearGradient(0, e.H * 0.4, 0, e.H); fg.addColorStop(0, rgba(e.skyBot, 0)); fg.addColorStop(1, rgba(e.skyBot, 0.7 * e.fog)); c.fillStyle = fg; c.fillRect(0, e.H * 0.4, e.W, e.H * 0.6); }
    },
  };
})();
