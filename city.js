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
