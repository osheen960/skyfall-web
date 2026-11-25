/* Skyfall web — UI, matched screen for screen to the Android app (1dp = 1px). Renders from the local cache. */
'use strict';
{
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TABS = [['CORE', 'CORE'], ['24H', 'SCAN'], ['10D', 'TRAJ'], ['DATA', 'DATA'], ['GOLF', 'GOLF'], ['AIR', 'AIR']];
const GOOGLE_KEY = /^AIza[0-9A-Za-z_-]{35}$/;
const INK = '#e6fbff', AMBER = '#ffb547', ALERT = '#ff4d6a', MAGENTA = '#ff3b30', GOOD = '#3dff9a';
const AC = () => getComputedStyle(document.documentElement).getPropertyValue('--ac').trim() || '#00e5ff';

const S = {
  place: Store.get('place', null), w: null, air: null, pollen: null, golfW: null,
  coreDay: null, golfDay: null, golfSlot: null, golfTab: 'BRIEF',
  hand: Store.get('hand', 'L'), pollenKey: Store.get('pollenKey', ''), pollenError: null, tab: 0, error: null,
};

/* ---------- shared bits ---------- */
const deg = x => (x == null || isNaN(x) ? '--' : R(x) + '°');
const ddmm = date => `${date.slice(8, 10)}.${date.slice(5, 7)}`;
const dayShort = date => `${DOW[dow(T(date + 'T00:00'))]} ${date.slice(8, 10)}`;
const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };
function scoreColor(s) {
  if (s >= 70) return lerpHex('#b6ff3d', '#3dff9a', Math.max(0, Math.min(1, (s - 70) / 30)));
  if (s >= 40) return lerpHex('#ff9a3d', '#b6ff3d', (s - 40) / 30);
  return lerpHex(ALERT, '#ff9a3d', Math.max(0, s) / 40);
}
const pollenColor = v => v < 1.5 ? GOOD : v < 2.5 ? '#b6ff3d' : v < 3.5 ? '#ffd23d' : v < 4.5 ? '#ff7a3d' : ALERT;
const seen = new Set();
let pIndex = 0;
function panel(title, code, body, opts = {}) {
  const k = opts.key || title || ('p' + pIndex);
  const i = opts.i ?? pIndex++;
  return `<section class="panel ${seen.has(k) ? 'seen' : ''} ${opts.cls || ''}" data-k="${esc(k)}" style="--i:${i}">${title ? `<div class="ph"><i></i><b>${esc(title)}</b>${code ? `<span>${esc(code)}</span>` : ''}</div>` : ''}${body}</section>`;
}
const readout = (l, v, col = INK, style = '') => `<div style="${style}"><div class="rl">${esc(l)}</div><div class="rv" style="color:${col}">${v}</div></div>`;
const note = t => `<div class="note">${esc(t)}</div>`;
const big = (v, u, col = INK) => `<div class="big"><span class="bv" style="color:${col}" data-decode="${esc(v)}">${esc(v)}</span>${u ? `<span class="bu">${esc(u)}</span>` : ''}</div>`;

/* Chamfered panel frames: fill, traced edge, corner brackets (drawn to the panel's pixel size). */
const frameRO = new ResizeObserver(es => es.forEach(e => drawFrame(e.target)));
function drawFrame(p) {
  const w = p.offsetWidth, h = p.offsetHeight, c = 14, l = 12;
  if (!w || !h) return;
  let svg = p.querySelector(':scope>svg.frame');
  if (!svg) { svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'frame'); svg.setAttribute('aria-hidden', 'true'); p.prepend(svg); }
  const d = `M${c} .5H${w - .5}V${h - c}L${w - c} ${h - .5}H.5V${c}Z`;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.innerHTML = `<path class="fill" d="${d}"/><path class="tint" d="${d}"/><path class="edge" pathLength="1" d="${d}"/>
    <path class="br" d="M${w - l} 1H${w - 1}V${l}M1 ${h - l}V${h - 1}H${l}M1 ${c}L${c} 1M${w - c} ${h - 1}L${w - 1} ${h - c}"/>`;
}
function mountPanels(root) {
  root.querySelectorAll('.panel').forEach(p => {
    drawFrame(p); frameRO.observe(p);
    if (!p.classList.contains('seen')) setTimeout(() => seen.add(p.dataset.k), 1600);
  });
  root.querySelectorAll('[data-decode]').forEach(el => { const p = el.closest('.panel'); if (p && p.classList.contains('seen')) el.textContent = el.dataset.decode; else decodeText(el, el.dataset.decode, 700); });
  root.querySelectorAll('[data-sweep]').forEach(el => {
    const p = el.closest('.panel'); if (reduce || (p && p.classList.contains('seen'))) return;
    const to = el.style.transform; el.style.transition = 'none'; el.style.transform = `rotate(${el.dataset.from}deg)`; void el.getBoundingClientRect();
    setTimeout(() => { el.style.transition = ''; el.style.transform = to; }, 600);
  });
}
function decodeText(el, text, ms) {
  if (reduce || el.dataset.done === text) { el.textContent = text; return; }
  el.dataset.done = text;
  const G = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&', frames = Math.max(1, Math.round(ms / 35)); let f = 0;
  const step = () => { const res = Math.floor(text.length * f / frames); el.textContent = [...text].map((c, i) => (i < res || c === ' ' || c === '°' || c === '.' ? c : G[Math.random() * G.length | 0])).join(''); if (f++ < frames) setTimeout(step, 35); else el.textContent = text; };
  step();
}
const decodedOnce = new Map();
function decodeOnce(el, key, text, ms = 700) { if (decodedOnce.get(key) === text) { el.textContent = text; return; } decodedOnce.set(key, text); el.dataset.done = ''; decodeText(el, text, ms); }

/* Neon line glyphs (glow + stroke), animated like HoloIcon. */
function icon(code, day = true, size = 18, tint) {
  const sky = Codes.sky(code), ac = tint || 'var(--ac)';
  const g = (d, col, extra = '') => `<path class="glow" d="${d}" stroke="${col}" stroke-width="4.6" fill="none" ${extra}/><path d="${d}" stroke="${col}" stroke-width="1.6" fill="none" ${extra}/>`;
  const sunD = 'M12 7.4a4.6 4.6 0 1 0 .01 0z', rays = [0, 45, 90, 135, 180, 225, 270, 315].map(a => { const r1 = 6.8, r2 = 9.2, t = a * Math.PI / 180; return `M${12 + r1 * Math.cos(t)} ${12 + r1 * Math.sin(t)}L${12 + r2 * Math.cos(t)} ${12 + r2 * Math.sin(t)}`; }).join('');
  const sun = (s = 1, dx = 0, dy = 0) => `<g transform="translate(${dx} ${dy}) scale(${s})">${g(sunD, AMBER)}<g class="rays">${g(rays, AMBER)}</g></g>`;
  const moon = (s = 1, dx = 0, dy = 0) => `<g transform="translate(${dx} ${dy}) scale(${s})">${g('M15 4.6a7.6 7.6 0 1 0 4.6 12.6A6.2 6.2 0 0 1 15 4.6z', '#cfe3ff')}</g>`;
  const cloudD = (y = 0) => `M6.6 ${17.6 + y}h10.6a3.6 3.6 0 0 0 .3-7.2 5.4 5.4 0 0 0-10.3-1.2 4.2 4.2 0 0 0-.6 8.4z`;
  let b;
  switch (sky) {
    case 'CLEAR': b = day ? sun() : moon(); break;
    case 'PARTLY': b = (day ? sun(.62, -1, -1) : moon(.62, -1, -1)) + `<g class="drift">${g(cloudD(1.5), ac)}</g>`; break;
    case 'CLOUDY': b = `<g class="drift">${g(cloudD(), ac)}</g>`; break;
    case 'FOG': b = `<g class="drift">${g(cloudD(-3), ac)}</g>${g('M5 19h14M7 22h10', ac)}`; break;
    case 'DRIZZLE': case 'RAIN': b = `<g class="drift">${g(cloudD(-3.5), ac)}</g>${[8.5, 12, 15.5].map((x, i) => `<g class="drop" style="animation-delay:${i * .33}s">${g(`M${x} 17.5l-1 ${sky === 'RAIN' ? 4 : 2.4}`, '#7fd4ff')}</g>`).join('')}`; break;
    case 'SNOW': b = `<g class="drift">${g(cloudD(-3.5), ac)}</g>${[8.5, 12, 15.5].map((x, i) => `<g class="drop" style="animation-delay:${i * .4}s"><circle cx="${x}" cy="19.5" r="1.1" fill="${INK}"/></g>`).join('')}`; break;
    case 'STORM': b = `<g class="drift">${g(cloudD(-3.5), ac)}</g><g class="bolt">${g('M12.6 15.2l-2.6 4.2h3l-1.4 3.6', '#ffd23d')}</g>`; break;
  }
  return `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">${b}</svg>`;
}
const windArrow = (from, col = INK, size = 12) => `<span class="wa" style="width:${size}px;height:${size}px;transform:rotate(${from + 180}deg)"><svg viewBox="-6 -6 12 12" style="animation-delay:-${(from % 7) * .3}s"><path d="M0 6V-6M0-6l-3.6 1.8M0-6l3.6 1.8" stroke="${col}" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg></span>`;

/* ---------- gear glyphs (Android GearIcon paths, 24-unit box) ---------- */
const GEAR = {
  SHELL: 'M9.1 3.6 4.8 6 2.9 14.4l2.9.5 1-4.8v11h10.6v-11l1 4.8 2.9-.5L19.2 6l-4.3-2.4L12 7.2zM12 7.2v13.9M9.1 3.6q2.9-3.1 5.8 0',
  COAT: 'M9.1 3.6 4.8 6 2.9 14.4l2.9.5 1-4.8v11h10.6v-11l1 4.8 2.9-.5L19.2 6l-4.3-2.4L12 7.2zM12 7.2v13.9M7.2 16.8h2.9M13.9 16.8h2.9',
  LAYERS: 'M9.1 3.6 4.8 6 2.9 14.4l2.9.5 1-4.8v11h10.6v-11l1 4.8 2.9-.5L19.2 6l-4.3-2.4L12 7.2zM12 7.2v13.9',
  TSHIRT: 'M8.6 3.8 3.4 7l1.9 3.8 2.2-1v10.8h9V9.8l2.2 1L20.6 7l-5.2-3.2q-3.4 3-6.8 0z',
  BOOTS: 'M8 3h5.2v9.6l5.8 2.6c1 .5 1.6 1.4 1.6 2.6V20H6.4V3.6zM6.4 17.4h14.2',
  SANDALS: 'M3.6 18.2c0-3 3.4-4.2 8.4-4.2s8.4 1.2 8.4 4.2M8 14.4l2-5.2 2 4.4 2-4.4 2 5.2M3.6 19.4h16.8',
  SNEAKERS: 'M3 17.4c0-3.4 1-6.6 4-6.6l3.6 3 6.2 1.2c2.8.4 4.2 1.4 4.2 3.2v1H3zM8.8 13.2l1 2M11.8 14.2l1 2',
  SUNSCREEN: 'M8.4 7.6h7.2v12.6a1.4 1.4 0 0 1-1.4 1.4H9.8a1.4 1.4 0 0 1-1.4-1.4zM10 7.6V4.4h4v3.2M10.2 13h3.6',
  SUNGLASSES: 'M3.4 11.4h6.6l-.6 3.6a2.4 2.4 0 0 1-2.4 2H6a2.4 2.4 0 0 1-2.4-2zM14 11.4h6.6l-.2 3.6a2.4 2.4 0 0 1-2.4 2h-.4a2.4 2.4 0 0 1-2.4-2zM10 12.2q2-1.2 4 0M3.4 11.4 2.2 9M20.6 11.4 21.8 9',
  HAT: 'M2.4 16.2c3.6 2.2 15.6 2.2 19.2 0M6.2 15.6c0-5.4 2.4-8.4 5.8-8.4s5.8 3 5.8 8.4',
  GLOVES: 'M7.2 21v-7.8L5 9.4l1.2-1L9 11V4.2h1.8V10V3.2h1.8V10V4h1.8v6.8l1.8-3 1.2.8-1.8 5.8V21z',
  MASK: 'M3.6 9.2c4.4-2 12.4-2 16.8 0v3.8c-2.4 5.6-14.4 5.6-16.8 0zM3.6 10.2 1.8 8.4M20.4 10.2l1.8-1.8M8 11.6h8M8 14.4h8',
};

/* ---------- CORE ---------- */
function dayChips(w, selected) {
  const t0 = dkey(w.current.time);
  return `<div class="hs" data-chips="core">${w.daily.slice(0, 7).map(d => `<button class="chip" data-day="${d.date}" aria-pressed="${d.date === selected}">
    <span class="l">${d.date === t0 ? 'TODAY' : DOW[dow(d.ms)]}</span>${icon(d.code, true, 18)}<span class="v" style="color:${tempColor(d.max)}">${deg(d.max)}</span></button>`).join('')}</div>`;
}
function quickGrid(w, isToday) {
  const c = w.current;
  const rainMax = Math.max(0, ...w.hourly.slice(0, 25).map(h => h.pop || 0));
  const uv = (w.daily[0] && w.daily[0].uvMax) || 0;
  const gw = S.golfW || S.w, gdate = Golf.defaultDay(S.w), gd = Golf.day(gw, gdate);
  const pollen = S.pollenKey && S.pollen ? S.pollen : Air.estimate(S.w), pl = pollenFor(w, pollen);
  const cells = [
    [`WIND ${compass16(c.windDirection)}`, `${R(c.windSpeed)} KM/H`, INK],
    [isToday ? 'RAIN 24H' : 'RAIN 06–06', `${rainMax}%`, rainMax >= 50 ? '#00e5ff' : INK],
    ['UV PEAK', `${R(uv)}`, uv >= 8 ? ALERT : INK, uv >= 8],
    ['HUMIDITY', `${c.humidity ?? '--'}%`, INK],
    [`GOLF ${DOW[dow(T(gdate + 'T00:00'))]} ›`, gd.best ? `${gd.best.score} · ${hm(gd.best.tee)}` : 'N/A', gd.best ? scoreColor(gd.best.score) : 'var(--dim)', false, 4],
    ['POLLEN ›', pl ? Air.upi(Air.peak(pl)) : '--', pl ? pollenColor(Air.peak(pl)) : 'var(--dim)', pl && Air.peak(pl) >= 3.5, 5],
  ];
  return panel(null, null, `<div class="qg">${cells.map(([l, v, col, hz, go]) => `<${go ? `button data-go="${go}"` : 'div'}><div class="rl">${esc(l)}</div><div class="qv ${hz ? 'pulse' : ''}" style="color:${col}">${esc(v)}</div></${go ? 'button' : 'div'}>`).join('')}</div>`, { key: 'quick', i: 0 });
}
const quipCache = {};
function loadout(w, isToday) {
  const lo = Advisor.loadout(w, S.air), items = Object.fromEntries(lo.items.map(i => [i.gear, i])), ac = AC();
  const title = !isToday ? `Loadout // ${DOW[dow(T(dkey(w.current.time) + 'T00:00'))].charAt(0) + DOW[dow(T(dkey(w.current.time) + 'T00:00'))].slice(1).toLowerCase()} daylight` : lo.next ? 'Loadout // tomorrow, daylight' : 'Loadout // daylight hours';
  const cells = Gear.map(([g, name]) => {
    const a = items[g];
    if (!a) return `<div class="gc" style="border-color:rgba(230,251,255,.06)"><svg viewBox="0 0 24 24" width="22" height="22" stroke="rgba(230,251,255,.2)" stroke-width="1.4"><path d="${GEAR[g]}"/></svg><div class="n" style="color:rgba(230,251,255,.3)">${esc(name.toUpperCase())}</div><div class="x">NOT NEEDED</div></div>`;
    const hot = a.pri >= 8, col = hot ? AMBER : ac;
    const k = `${lo.date}:${g}:${a.title}`; if (!quipCache[k]) quipCache[k] = a.quips[Math.floor(Math.random() * a.quips.length)];
    return `<div class="gc on" style="border-color:${rgba(col, hot ? .7 : .35)};background:${rgba(col, .06)}">
      <svg viewBox="0 0 24 24" width="28" height="28" stroke="${col}" style="animation-delay:-${Gear.findIndex(x => x[0] === g) * .4}s"><path d="${GEAR[g]}" stroke-width="4.6" opacity=".25"/><path d="${GEAR[g]}" stroke-width="1.5"/></svg>
      <div class="n ink">${esc(a.title.toUpperCase())}</div><div class="r">${esc(a.reason)}</div><div class="q" style="color:${rgba(col, .9)}">${esc(quipCache[k])}</div></div>`;
  }).join('');
  return panel(title, `${lo.items.length}/${Gear.length} ON`, `<div class="lo">${cells}</div>`, { key: 'loadout', i: 1 });
}
function comms(w) {
  const tx = Advisor.bulletin(w, S.air, S.pollenKey && S.pollen ? S.pollen : Air.estimate(S.w), S.place ? S.place.name : 'Sector', S.golfW);
  return { html: panel('Comms // atmos bulletin', `TX-${String(tx.length).padStart(2, '0')}`, `<div id="comms" data-stamp="${hm(w.current.time)}"></div>`, { key: 'comms', i: 2 }), tx };
}
function renderCore() {
  const w = sel(); if (!w) return;
  pIndex = 0;
  const c = w.current, isToday = dkey(c.time) === dkey(S.w.current.time);
  const d = dayOf(w, dkey(c.time)) || w.daily[0];
  const lo = Math.min(d.min, c.temperature), hi = Math.max(d.max, c.temperature);
  const tag = isToday ? '' : `${DOW[dow(d.ms)]} ${ddmm(d.date)} · MIDDAY`;
  const cm = comms(w);
  $('#p-core').innerHTML = `<div class="col">
    ${dayChips(S.w, dkey(c.time))}
    <div class="core" id="core" role="img" aria-label="${R(c.temperature)} degrees, ${esc(Codes.label(c.code))}">
      <canvas></canvas>
      <div class="core-read"><div class="cl" data-text="${esc('// ' + Codes.label(c.code).toUpperCase())}"></div>
        <div class="ct"><span class="tv" data-text="${isNaN(c.temperature) ? '--' : R(c.temperature)}"></span><span class="tu">°C</span></div>
        <div class="cf">FEELS ${deg(c.feelsLike)}</div>${tag ? `<div class="cday">${esc(tag)}</div>` : ''}</div>
      <div class="core-lh"><span style="color:${tempColor(lo)}">L ${deg(lo)}</span><span style="color:${tempColor(hi)}">H ${deg(hi)}</span></div>
    </div>
    ${isToday && S.w.obs ? bomLine(S.w.obs) : ''}
    ${quickGrid(w, isToday)}
    ${loadout(w, isToday)}
    ${cm.html}
  </div>`;
  mountPanels($('#p-core'));
  Core.mount($('#core'), w);
  typeComms($('#comms'), cm.tx);
}
const typedSig = {};
function typeComms(el, tx) {
  const stamp = el.dataset.stamp, sig = JSON.stringify(tx), done = typedSig.comms === sig; typedSig.comms = sig;
  const line = (t, text, caret) => `<div class="tx ${t.serious ? 'serious' : ''}"><div class="st">${esc(stamp)}<span class="tg">${esc(t.tag)}</span></div><div class="b">${esc(text)}${caret ? '<span class="caret">█</span>' : ''}</div></div>`;
  if (done || reduce) { el.innerHTML = tx.map((t, i) => line(t, t.text, i === tx.length - 1)).join(''); return; }
  const id = String(Math.random()); el.dataset.tid = id;
  let li = 0, ci = 0;
  const step = () => {
    if (el.dataset.tid !== id || !el.isConnected) return;
    el.innerHTML = tx.slice(0, li).map(t => line(t, t.text, false)).join('') + (li < tx.length ? line(tx[li], tx[li].text.slice(0, ci), true) : '');
    if (li >= tx.length) { el.innerHTML = tx.map((t, i) => line(t, t.text, i === tx.length - 1)).join(''); return; }
    if (ci < tx[li].text.length) { ci = Math.min(tx[li].text.length, ci + 2); setTimeout(step, 28); } else { li++; ci = 0; setTimeout(step, 220); }
  };
  setTimeout(step, 900);
}

/** BoM station reading as metadata beside the Open-Meteo forecast: never used for the numbers. */
function bomLine(o) {
  const st = o.station.toUpperCase().replace(/[()]/g, '').replace(' AIRPORT', ' AP').slice(0, 22);
  return `<div class="m" style="text-align:center;font-size:9px;letter-spacing:1.5px;margin-top:-6px"><span class="ac">BOM // </span><span class="dim">${esc(st)} ${o.temperature.toFixed(1)}°${o.apparent != null ? ` · FEELS ${R(o.apparent)}°` : ''} · T-${R((Date.now() - o.at) / MIN)}M</span></div>`;
}

/* ---------- 24H ---------- */
function summary(w) {
  const now = w.hourly[0], ahead = w.hourly.slice(1, 25);
  const wet = now && (now.pop || 0) >= 50, rainAt = ahead.find(h => (h.pop || 0) >= 50);
  if (wet) { const clr = ahead.find(h => (h.pop || 0) < 30); return clr ? `PRECIP ACTIVE · CLEARING ≈ ${hm(clr.time)}` : 'PRECIP ACTIVE · NO CLEARANCE WITHIN 24H'; }
  if (rainAt) return `PRECIP INBOUND ≈ ${hm(rainAt.time)} · P=${rainAt.pop}%`;
  const peak = w.hourly.slice(0, 13).filter(h => !isNaN(h.temperature)).reduce((a, h) => (!a || h.temperature > a.temperature ? h : a), null);
  let s = 'NO PRECIP 24H';
  if (peak && peak !== now) s += ` · PEAK ${deg(peak.temperature)} @ ${hm(peak.time)}`;
  if (w.current.windGusts >= 40) s += ` · GUSTS ${R(w.current.windGusts)} KM/H`;
  return s;
}
function renderScan() {
  const w = S.w; if (!w) return;
  pIndex = 0;
  const hours = w.hourly.slice(0, 25), colW = 56;
  const sunEv = w.daily.flatMap(d => [d.sunrise, d.sunset]);
  const head = hours.map((h, i) => `<div class="m" style="width:${colW}px;flex:none;padding-left:2px;font-size:10px;color:${i ? 'var(--faint)' : 'var(--ac)'}">${i ? hm(h.time) : 'NOW'}</div>`).join('');
  const foot = hours.map(h => { const sun = sunEv.find(t => t >= h.time && t < h.time + HOUR), pop = h.pop || 0;
    return `<div style="width:${colW}px;flex:none;display:flex;flex-direction:column;align-items:center">${icon(h.code, h.isDay, 22)}<span class="m" style="font-size:9px;color:${sun ? AMBER : pop >= 40 ? 'var(--ac)' : 'var(--faint)'}">${sun ? '☼ ' + hm(sun) : pop > 0 ? pop + '%' : '·'}</span></div>`; }).join('');
  const rows = hours.slice(0, 12).map((h, i) => { const pop = h.pop || 0;
    return `<div class="trow reveal ${seen.has('ledger') ? 'seen' : ''}" style="--r:${i}"><span class="mono11" style="flex:.9;color:${i ? 'var(--dim)' : 'var(--ac)'}">${i ? hm(h.time) : 'NOW'}</span><span style="flex:.6">${icon(h.code, h.isDay, 18)}</span>
      <span class="d" style="flex:.8;font-weight:600;font-size:16px;color:${tempColor(h.temperature)}">${deg(h.temperature)}</span><span style="flex:1.3;display:flex;align-items:center;gap:4px">${windArrow(h.dir)}<span class="mono11 ink">${R(h.wind)}</span></span>
      <span class="mono11" style="flex:.8;color:${h.gust >= 40 ? AMBER : 'var(--dim)'}">${R(h.gust)}</span><span class="mono11" style="flex:1.1;color:${pop >= 50 ? 'var(--ac)' : 'var(--dim)'}">${h.precip >= 0.1 ? `${pop}% ${f1(h.precip)}` : pop + '%'}</span></div>`; }).join('');
  $('#p-scan').innerHTML = `<div class="col">
    ${panel('Temporal scan // 24h', 'CH-01', `<div class="m ink" style="font-size:11px;letter-spacing:1px;margin-bottom:12px">${esc(summary(w))}</div>
      <div class="scope-wrap"><div style="width:${colW * hours.length}px"><div style="display:flex">${head}</div><canvas id="scope" style="width:${colW * hours.length}px;height:132px;display:block"></canvas><div style="display:flex">${foot}</div></div></div>`, { key: 'scan', i: 0 })}
    ${panel('Hour ledger // 12h', 'CH-03', `<div class="th"><span style="flex:.9">TIME</span><span style="flex:.6"></span><span style="flex:.8">TEMP</span><span style="flex:1.3">WIND</span><span style="flex:.8">GUST</span><span style="flex:1.1">RAIN</span></div>${rows}<div class="tiny" style="margin-top:6px">WIND/GUST KM/H · RAIN P% + MM</div>`, { key: 'ledger', i: 1 })}
  </div>`;
  mountPanels($('#p-scan'));
  setTimeout(() => seen.add('ledger'), 1500);
  Scope.mount($('#scope'), hours);
}
/* Oscilloscope: dotted grid, precip bars, neon temperature trace drawn in, sweeping cursor. */
const Scope = (() => {
  let cv, hours, start = 0, raf = 0, lastKey = '';
  function draw(now) {
    raf = 0; if (!cv || !cv.isConnected || document.hidden) return;
    const dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
    const ac = AC(), trace = reduce ? 1 : Math.min(1, 1 - Math.pow(1 - (now - start) / 1600, 3) || 0), tr = Math.max(0, Math.min(1, trace));
    const temps = hours.map(h => h.temperature).filter(v => !isNaN(v)), lo = Math.min(...temps), hi = Math.max(...temps), span = hi - lo > 0.5 ? hi - lo : 1;
    const step = W / hours.length, top = 26, bottom = H - 8;
    x.setLineDash([2, 6]); x.strokeStyle = rgba(ac, .12); x.lineWidth = 1;
    for (let k = 0; k <= 3; k++) { const y = top + (bottom - top) * k / 3; x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke(); }
    x.setLineDash([]);
    hours.forEach((h, i) => { const p = (h.pop || 0) / 100; if (!p) return; const bh = (bottom - top) * p * tr; const g = x.createLinearGradient(0, bottom - bh, 0, bottom); g.addColorStop(0, rgba(ac, .05)); g.addColorStop(1, rgba(ac, .35)); x.fillStyle = g; x.fillRect(step * i + step * .3, bottom - bh, step * .4, bh); });
    const pts = hours.map((h, i) => [step * (i + .5), bottom - (bottom - top) * (((isNaN(h.temperature) ? lo : h.temperature) - lo) / span)]);
    const path = new Path2D(); path.moveTo(...pts[0]);
    for (let i = 1; i < pts.length; i++) { const [ax, ay] = pts[i - 1], [bx, by] = pts[i], mx = (ax + bx) / 2; path.bezierCurveTo(mx, ay, mx, by, bx, by); }
    const grad = x.createLinearGradient(0, 0, W, 0); hours.forEach((h, i) => grad.addColorStop(i / (hours.length - 1), tempColor(isNaN(h.temperature) ? lo : h.temperature)));
    x.save(); x.beginPath(); x.rect(0, 0, W * tr, H); x.clip();
    x.lineCap = 'round'; x.strokeStyle = grad;
    x.globalAlpha = .18; x.lineWidth = 10; x.stroke(path); x.globalAlpha = .4; x.lineWidth = 4; x.stroke(path); x.globalAlpha = 1; x.strokeStyle = INK; x.lineWidth = 1.4; x.stroke(path);
    x.font = '600 15px Rajdhani, sans-serif'; x.textAlign = 'center';
    pts.forEach(([px, py], i) => { x.fillStyle = '#020409'; x.fillRect(px - 2.5, py - 2.5, 5, 5); x.strokeStyle = tempColor(hours[i].temperature); x.lineWidth = 1.5; x.strokeRect(px - 2.5, py - 2.5, 5, 5); x.fillStyle = INK; x.fillText(deg(hours[i].temperature), px, py - 8); });
    x.restore();
    x.fillStyle = rgba(ac, .08); x.fillRect(0, 0, step, H);
    const sx = reduce ? -100 : (((now / 1000) * .12) % 1) * W;
    const sg = x.createLinearGradient(sx - 60, 0, sx, 0); sg.addColorStop(0, 'rgba(0,0,0,0)'); sg.addColorStop(1, rgba(ac, .14)); x.fillStyle = sg; x.fillRect(sx - 60, 0, 60, H);
    x.strokeStyle = rgba(ac, .6); x.lineWidth = 1; x.beginPath(); x.moveTo(sx, 0); x.lineTo(sx, H); x.stroke();
    if (!reduce) raf = requestAnimationFrame(draw);
  }
  return {
    mount(c, h) { cv = c; hours = h; const k = String(h[0].time); if (k !== lastKey) { start = performance.now(); lastKey = k; } if (!raf) raf = requestAnimationFrame(draw); },
    replay() { start = performance.now(); if (!raf) raf = requestAnimationFrame(draw); },
  };
})();

/* ---------- 10D ---------- */
function ledBar(min, max, lo, hi, now, i) {
  const n = 22, span = hi - lo > 0 ? hi - lo : 1, ac = AC();
  const nowIdx = now != null && !isNaN(now) ? Math.round((now - lo) / span * (n - 1)) : null;
  return `<div style="flex:1;display:flex;gap:2px;height:10px;margin:0 6px">${Array.from({ length: n }, (_, k) => {
    const t = lo + span * (k + .5) / n, inR = !isNaN(min) && !isNaN(max) && t >= min - span / (2 * n) && t <= max + span / (2 * n);
    if (k === nowIdx) return `<i style="flex:1;background:${INK}" class="pulse"></i>`;
    return inR ? `<i style="flex:1;background:${tempColor(t)};box-shadow:0 0 0 1px ${rgba(tempColor(t), .25)};animation:pbody .25s ${(i * 80 + k * 30)}ms both;opacity:${seen.has('traj') ? 1 : 0}"></i>` : `<i style="flex:1;background:${rgba(ac, .08)}"></i>`;
  }).join('')}</div>`;
}
function renderTraj() {
  const w = S.w; if (!w) return;
  pIndex = 0;
  const lo = Math.min(...w.daily.map(d => d.min).filter(v => !isNaN(v))), hi = Math.max(...w.daily.map(d => d.max).filter(v => !isNaN(v)));
  const rows = w.daily.map((d, i) => `<div class="reveal ${seen.has('traj') ? 'seen' : ''}" style="--r:${i};display:flex;align-items:center;min-height:46px">
    <div style="width:54px;flex:none"><div class="m" style="font-size:12px;color:${i ? INK : 'var(--ac)'}">${i ? DOW[dow(d.ms)] : 'TODAY'}</div><div class="m faint" style="font-size:9px">${ddmm(d.date)}</div></div>
    ${icon(d.code, true, 24)}
    <span class="m ac" style="width:38px;padding-left:6px;font-size:10px">${(d.popMax ?? 0) >= 10 ? d.popMax + '%' : ''}</span>
    <span class="d dim" style="width:34px;font-size:16px">${deg(d.min)}</span>
    ${ledBar(d.min, d.max, lo, hi, i === 0 ? w.current.temperature : null, i)}
    <span class="d" style="width:34px;padding-left:4px;font-size:16px;font-weight:600">${deg(d.max)}</span></div>`).join('');
  $('#p-traj').innerHTML = `<div class="col">${panel(`${w.daily.length}-day trajectory`, 'CH-02', rows, { key: 'traj', i: 0 })}</div>`;
  mountPanels($('#p-traj'));
  setTimeout(() => seen.add('traj'), 2400);
}

/* ---------- DATA: telemetry tiles (UV, wind, humidity, feels, precip, visibility, pressure, cloud) + solar orbit ---------- */
const sweepAttr = (from, to) => `data-sweep="${to}" data-from="${from}"`;
function renderData() {
  const w = S.w; if (!w) return;
  pIndex = 0;
  const c = w.current, now = w.hourly[0] || {}, today = w.daily[0], ac = AC();
  const tile = (title, code, body, i) => panel(title, code, body, { key: 'tile-' + code, i });
  // UV
  const uv = now.uv || 0, uvLevel = uv < 3 ? 'LOW' : uv < 6 ? 'MODERATE' : uv < 8 ? 'HIGH' : uv < 11 ? 'V.HIGH' : 'EXTREME';
  const uvCol = uv < 3 ? GOOD : uv < 6 ? '#ffe14d' : uv < 8 ? '#ff9a3d' : uv < 11 ? ALERT : MAGENTA, uvF = Math.max(0, Math.min(1, uv / 11));
  const uvSegs = Array.from({ length: 22 }, (_, k) => { const a0 = 180 + 180 * k / 22 + 1, a1 = a0 + 180 / 22 - 2, r = 54, cx = 60, cy = 62, p = a => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1), on = k < Math.round(22 * uvF);
    return `<path d="M${x0} ${y0}A${r} ${r} 0 0 1 ${x1} ${y1}" stroke="${on ? lerpHex(GOOD, MAGENTA, k / 22) : rgba(ac, .1)}" stroke-width="5" fill="none" ${on ? `style="opacity:0;animation:pbody .15s ${k * 45}ms forwards"` : ''}/>`; }).join('');
  const uvT = tile('UV index', 'T-01', `<div style="position:relative;height:62px"><svg viewBox="0 0 120 64" style="width:100%;height:62px" preserveAspectRatio="xMidYMax meet">${uvSegs}</svg>
      <div class="d" style="position:absolute;left:0;right:0;bottom:-2px;text-align:center;font-weight:300;font-size:30px;color:${uvCol}">${R(uv)}</div></div>
    <div class="m" style="font-size:12px;letter-spacing:2px;color:${uvCol}">${uvLevel}</div>${note(today.uvMax != null ? `Peak ${R(today.uvMax)}${today.uvMax >= 3 ? ' · shield advised' : ''}` : '')}`, 0);
  // Wind vector
  const windT = tile('Wind vector', 'T-02', `<div style="display:flex;align-items:center"><div style="flex:1">${big(String(R(c.windSpeed)), 'KM/H')}<div class="m ac" style="font-size:10px">FROM ${compass16(c.windDirection)}</div>${note(`Gust ${R(c.windGusts)}`)}</div>
    <svg class="radar" viewBox="0 0 64 64" width="64" height="64"><g stroke="${rgba(ac, .18)}" fill="none"><circle cx="32" cy="32" r="10.7"/><circle cx="32" cy="32" r="21.3"/><circle cx="32" cy="32" r="31.5"/><path d="M32 0V64M0 32H64"/></g>
      <defs><linearGradient id="rsw" x1="0" x2="1"><stop offset="0" stop-color="${ac}" stop-opacity="0"/><stop offset="1" stop-color="${ac}" stop-opacity=".35"/></linearGradient></defs>
      <path class="sw" d="M32 32L32 0A32 32 0 0 1 59.7 16z" fill="url(#rsw)"/>
      <g style="transform-origin:32px 32px;transform:rotate(${c.windDirection + 180}deg);transition:transform 1.6s cubic-bezier(.4,0,.2,1)" ${sweepAttr(0, c.windDirection + 180)}><path d="M32 48V6.4" stroke="${INK}" stroke-width="2" stroke-linecap="round"/><path d="M32 4.4l-5 9h10z" fill="${INK}"/></g></svg></div>`, 1);
  // Humidity ring
  const hum = c.humidity || 0, lit = Math.round(32 * hum / 100);
  const ticks = Array.from({ length: 32 }, (_, k) => { const a = -Math.PI / 2 + 2 * Math.PI * k / 32, r = 27, ri = r * .72; return `<line x1="${30 + ri * Math.cos(a)}" y1="${30 + ri * Math.sin(a)}" x2="${30 + r * Math.cos(a)}" y2="${30 + r * Math.sin(a)}" stroke="${k < lit ? ac : rgba(ac, .12)}" stroke-width="3" stroke-linecap="round" ${k < lit ? `style="opacity:0;animation:pbody .1s ${k * 35}ms forwards"` : ''}/>`; }).join('');
  const humT = tile('Humidity', 'T-03', `<div style="display:flex;align-items:center"><div style="flex:1">${big(String(hum), '%')}${note(now.dew != null ? `Dew pt ${deg(now.dew)}` : '')}</div><svg viewBox="0 0 60 60" width="60" height="60">${ticks}</svg></div>`, 2);
  // Apparent temp
  const delta = isNaN(c.feelsLike) ? 0 : c.feelsLike - c.temperature, fpos = (Math.max(-8, Math.min(8, delta)) + 8) / 16;
  const feelsT = tile('Apparent temp', 'T-04', `${big(String(R(c.feelsLike)), '°C', tempColor(c.feelsLike))}
    <svg viewBox="0 0 160 14" preserveAspectRatio="none" style="width:100%;height:14px;margin-top:6px;overflow:visible"><line x1="0" y1="7" x2="160" y2="7" stroke="${rgba(ac, .2)}" stroke-width="2"/>${Array.from({ length: 9 }, (_, k) => `<line x1="${k * 20}" x2="${k * 20}" y1="4" y2="10" stroke="${rgba(ac, .3)}"/>`).join('')}<line x1="80" x2="80" y1="0" y2="14" stroke="${INK}"/></svg>
    <div style="position:relative;height:0"><i style="position:absolute;top:-11px;left:calc(${(fpos * 100).toFixed(1)}% - 4px);width:8px;height:8px;border-radius:50%;background:${tempColor(c.feelsLike)}"></i></div>
    ${note(delta <= -2 ? `Δ ${R(delta)}° · wind chill` : delta >= 2 ? `Δ +${R(delta)}° · humidity load` : 'Δ ≈ 0 · nominal')}`, 3);
  // Precipitation
  const next = w.hourly.slice(0, 12).map(h => (h.pop || 0) / 100);
  const precipT = tile('Precipitation', 'T-05', `${big(f1(today.precipSum || 0), 'MM')}
    <div style="display:flex;align-items:flex-end;height:30px;margin-top:8px">${next.map((p, k) => `<i style="flex:1;margin:0 4%;height:${Math.max(2, p * 30)}px;background:${p >= .5 ? ac : rgba(ac, .35)};transform-origin:bottom;animation:grow 1s ${k * 40}ms both"></i>`).join('')}</div>
    ${note(`Next 12h · P(max) ${today.popMax || 0}%`)}`, 4);
  // Visibility
  const vis = now.visibility, km = (vis || 0) / 1000, vLabel = vis == null ? '--' : km >= 10 ? String(R(km)) : f1(km);
  const vF = vis == null ? 0 : Math.max(0, Math.min(1, (Math.log10(Math.max(.1, km)) + 1) / (Math.log10(50) + 1)));
  const visT = tile('Visibility', 'T-06', `${big(vLabel, 'KM')}
    <svg viewBox="0 0 200 16" preserveAspectRatio="none" style="width:100%;height:16px;margin-top:10px"><line x1="0" y1="14" x2="200" y2="14" stroke="${rgba(ac, .3)}"/>${Array.from({ length: 21 }, (_, k) => `<line x1="${k * 10}" x2="${k * 10}" y1="14" y2="${k % 5 ? 10 : 6}" stroke="${rgba(ac, .35)}"/>`).join('')}
      <rect x="0" y="11" height="3" width="${200 * vF}" fill="${rgba(ac, .25)}"/><line x1="${200 * vF}" x2="${200 * vF}" y1="0" y2="14" stroke="${INK}" stroke-width="2"/></svg>
    ${note(vis == null ? '' : km < 1 ? 'Fog · severely limited' : km < 5 ? 'Haze · reduced' : 'Optical range clear')}`, 5);
  // Pressure dial
  const p = c.pressure, pF = isNaN(p) || p == null ? .5 : Math.max(0, Math.min(1, (p - 970) / 80));
  const pt = (a, r) => [29 + r * Math.cos(a * Math.PI / 180), 29 + r * Math.sin(a * Math.PI / 180)];
  const [ax0, ay0] = pt(135, 24.6), [ax1, ay1] = pt(45, 24.6);
  const dialTicks = Array.from({ length: 9 }, (_, k) => { const a = 135 + 270 * k / 8, [x0, y0] = pt(a, 18), [x1, y1] = pt(a, 21.5); return `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${rgba(ac, .5)}" stroke-width="1.5"/>`; }).join('');
  const presT = tile('Pressure', 'T-07', `<div style="display:flex;align-items:center"><div style="flex:1">${big(p == null || isNaN(p) ? '--' : String(R(p)), 'HPA')}${note(p == null || isNaN(p) ? '' : p < 1000 ? 'Low · unsettled' : p > 1022 ? 'High · stable' : 'Normal band')}</div>
    <svg viewBox="0 0 58 58" width="58" height="58"><path d="M${ax0} ${ay0}A24.6 24.6 0 1 1 ${ax1} ${ay1}" stroke="${rgba(ac, .18)}" stroke-width="2" fill="none"/>${dialTicks}
      <g style="transform-origin:29px 29px;transform:rotate(${135 + 270 * pF}deg);transition:transform 1.5s cubic-bezier(.4,0,.2,1)" ${sweepAttr(135, 135 + 270 * pF)}><line x1="29" y1="29" x2="52.2" y2="29" stroke="${INK}" stroke-width="2" stroke-linecap="round"/></g><circle cx="29" cy="29" r="3" fill="${ac}"/></svg></div>`, 6);
  // Cloud cover grid
  const cover = c.cloudCover || 0, litC = Math.round(64 * cover / 100);
  const cloudT = tile('Cloud cover', 'T-08', `${big(String(cover), '%')}
    <div style="display:grid;grid-template-columns:repeat(16,1fr);gap:2px;margin-top:8px;max-width:180px">${Array.from({ length: 64 }, (_, k) => `<i style="aspect-ratio:1;border-radius:1.5px;background:${k < litC ? rgba(ac, .85) : rgba(ac, .1)};${k < litC ? `animation:pbody .1s ${k * 20}ms both;opacity:0` : ''}"></i>`).join('')}</div>`, 7);
  // Solar orbit
  const nowL = localNow(w.off), total = Math.max(1, today.sunset - today.sunrise), f = Math.max(0, Math.min(1, (nowL - today.sunrise) / total));
  const up = nowL > today.sunrise && nowL < today.sunset;
  const dur = ms => `${Math.floor(ms / HOUR)}H ${String(Math.floor(ms % HOUR / MIN)).padStart(2, '0')}M`;
  const countdown = nowL < today.sunrise ? `SUNRISE T-${dur(today.sunrise - nowL)}` : up ? `SUNSET T-${dur(today.sunset - nowL)}` : 'SOLAR CYCLE COMPLETE';
  const OW = 320, OH = 100, base = OH - 4, rx = OW / 2 - 10, ry = base - 8, cx = OW / 2;
  const at = q => { const a = Math.PI * (1 - q); return [cx + rx * Math.cos(a), base - ry * Math.sin(a)]; };
  const orbit = Array.from({ length: 81 }, (_, k) => at(k / 80).map(v => v.toFixed(1)).join(' ')).join(' L');
  const doneN = Math.max(1, Math.round(80 * f)), donePath = Array.from({ length: doneN + 1 }, (_, k) => at(f * k / doneN).map(v => v.toFixed(1)).join(' ')).join(' L');
  const [sx, sy] = at(f);
  const solar = panel('Solar orbit', 'T-09', `<div style="display:flex;justify-content:space-between">${readout('Rise', hm(today.sunrise), AMBER)}${readout('Daylight', dur(total))}${readout('Set', hm(today.sunset), '#ff7a3d', 'text-align:right')}</div>
    <svg class="orbit" viewBox="0 0 ${OW} ${OH}" style="width:100%;margin-top:10px;overflow:visible"><defs><linearGradient id="og"><stop offset="0" stop-color="#ff7a3d"/><stop offset="1" stop-color="${AMBER}"/></linearGradient></defs>
      <path class="dash" d="M${orbit}" fill="none" stroke="${rgba(ac, .25)}" stroke-dasharray="4 6"/>
      <path d="M${donePath}" fill="none" stroke="url(#og)" stroke-width="2" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" style="animation:trace 2s cubic-bezier(.4,0,.2,1) forwards"/>
      <line x1="0" y1="${base}" x2="${OW}" y2="${base}" stroke="${rgba(ac, .4)}"/>
      ${up ? `<circle cx="${sx}" cy="${sy}" r="14" fill="${rgba(AMBER, .25)}" class="sunpulse"/><circle cx="${sx}" cy="${sy}" r="5" fill="${AMBER}"/><circle cx="${sx}" cy="${sy}" r="9" fill="none" stroke="${AMBER}" class="sunpulse"/>` : `<circle cx="${sx}" cy="${sy}" r="4" fill="none" stroke="var(--faint)"/>`}</svg>
    <div class="m ac" style="font-size:11px;letter-spacing:2px;margin-top:8px">${countdown}</div>`, { key: 'solar', i: 8 });
  const o = w.obs;
  $('#p-data').innerHTML = `<div class="col"><div class="tiles">${uvT}${windT}${humT}${feelsT}${precipT}${visT}${presT}${cloudT}</div>${solar}
    <div class="footer">DATA // OPEN-METEO.COM (CC BY 4.0) · NATIONAL MODEL BLEND${o ? `\nBOM // ${esc(o.station.toUpperCase())} ${o.temperature.toFixed(1)}° · ${R((Date.now() - o.at) / MIN)} MIN OLD · REFERENCE ONLY` : ''}\nSKYFALL ATMOS WEB</div></div>`;
  mountPanels($('#p-data'));
}

/* ---------- GOLF ---------- */
function scoreRing(score, size = 104) {
  const n = 40, r = size / 2 - 4 - 3.5, c = size / 2, lit = Math.round(n * score / 100), ac = AC();
  const segs = Array.from({ length: n }, (_, k) => { const a0 = -90 + 360 * k / n + 1.5, a1 = a0 + 360 / n - 3, p = a => [c + r * Math.cos(a * Math.PI / 180), c + r * Math.sin(a * Math.PI / 180)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1), on = k < lit;
    return `<path d="M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}" stroke="${on ? scoreColor(k * 100 / n) : rgba(ac, .1)}" stroke-width="7" fill="none" ${on ? `style="opacity:0;animation:pbody .08s ${k * 25}ms forwards"` : ''}/>`; }).join('');
  return `<div style="position:relative;width:${size}px;height:${size}px;flex:none"><svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${segs}</svg>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center"><span class="d" style="font-weight:300;font-size:34px;line-height:1;color:${scoreColor(score)}" data-decode="${score}">${score}</span><span class="m dim" style="font-size:8px;letter-spacing:1.2px">SCORE · GRADE ${Golf.grade(score)}</span></div></div>`;
}
function scoreSummary(date, slot, g, i) {
  const ac = AC(), isBest = slot && slot === g.best;
  const title = `Golf score // ${DOW[dow(T(date + 'T00:00'))]} ${ddmm(date)}`;
  if (!slot) return panel(title, 'G-01', `<div class="m dim" style="font-size:11px">NO PLAYABLE DAYLIGHT WINDOW</div>`, { key: 'gscore', i });
  return panel(title, 'G-01', `<div style="display:flex;align-items:center;gap:14px">${scoreRing(slot.score)}
      <div style="flex:1"><div class="m" style="font-size:10px;letter-spacing:2px;color:${isBest ? ac : 'var(--faint)'}">${isBest ? 'OPTIMAL TEE ◆' : 'SELECTED TEE'}</div>
        <div class="d" style="font-weight:300;font-size:38px;line-height:1.05" data-decode="${hm(slot.tee)}">${hm(slot.tee)}</div>
        <div class="m ac" style="font-size:10px;letter-spacing:1px">ROUND ${hm(slot.tee)}–${hm(slot.tee + Golf.ROUND * HOUR)}</div>
        ${!isBest && g.best ? `<div class="m faint" style="font-size:9px;letter-spacing:1px">BEST: ${hm(g.best.tee)} · ${g.best.score}</div>` : ''}</div></div>
    <div style="display:flex;justify-content:space-between;margin-top:12px">${readout('Temp', `${deg(slot.tMin)}–${deg(slot.tMax)}`, tempColor(slot.tMax))}${readout('Wind', `${R(slot.wind)} ${compass16(slot.dir)}`)}${readout('Gust', R(slot.gust), slot.gust >= 40 ? AMBER : INK)}${readout('Rain', slot.pop + '%', slot.pop >= 40 ? ac : INK)}${readout('UV', R(slot.uv), slot.uv >= 8 ? ALERT : INK)}</div>
    <div class="m" style="font-size:10px;letter-spacing:1px;margin-top:10px;color:${slot.limiter === 'NONE' ? ac : AMBER}">GRADE ${Golf.grade(slot.score)} · MAIN LIMITER: ${slot.limiter}</div>
    <div class="tiny" style="margin-top:6px">THE SCORE IS PLAYABILITY FOR A 4-HOUR ROUND FROM THIS TEE TIME: 100 MINUS PENALTIES FOR LIGHTNING, RAIN, WIND, HEAT OR COLD AND UV. NOT A CHANCE OF RAIN.</div>`, { key: 'gscore', i });
}
function uplink(date, slot, g) {
  const lines = Caddie.dayLines(g), text = slot ? lines[slot.tee] : Caddie.banter(g);
  const freq = (121.5 + (Math.floor(T(date + 'T00:00') / DAY) % 37) * .25).toFixed(2);
  return { html: panel('Fairway uplink // transmission', `FQ ${freq}`, `<div class="uplink" id="uplink"></div>${slot ? `<div class="tiny" style="margin-top:8px">RE: ${hm(slot.tee)} SLOT · SCORE ${slot.score} · GRADE ${Golf.grade(slot.score)}</div>` : ''}`, { key: 'uplink', i: 0 }), text };
}
function typeUplink(el, text) {
  const op = Caddie.SAT, render = n => { const t = text.slice(0, n); const k = text.startsWith(op) ? Math.min(t.length, op.length) : 0;
    el.innerHTML = `<span class="ac">${esc(t.slice(0, k))}</span>${esc(t.slice(k))}<span class="caret">█</span>`; };
  if (reduce || typedSig.uplink === text) { typedSig.uplink = text; render(text.length); return; }
  typedSig.uplink = text;
  const id = String(Math.random()); el.dataset.tid = id; let n = 0; render(0);
  const step = () => { if (el.dataset.tid !== id || !el.isConnected) return; n = Math.min(text.length, n + 1); render(n); if (n < text.length) setTimeout(step, 14); };
  setTimeout(step, 250);
}
function breakdown(t) {
  const ac = AC(), rows = t.deductions.slice().sort((a, b) => b.points - a.points).map(d => { const hot = d.points >= 15;
    return `<div class="ded"><span class="k" style="color:${hot ? AMBER : INK}">${d.label}</span><div class="mid"><div class="m dim" style="font-size:9px">${esc(d.detail)}</div><div class="dbar"><i style="width:${Math.max(2, Math.min(100, d.points / 80 * 100))}%;background:${hot ? AMBER : ac};transform-origin:left;animation:growx .8s both"></i></div></div><span class="dv" style="color:${hot ? AMBER : INK}">−${d.points}</span></div>`; }).join('');
  return panel(`How ${t.score} is calculated`, 'G-02', `<div class="ded" style="height:26px"><span class="k ink">START</span><span class="mid m faint" style="font-size:9px">perfect conditions</span><span class="dv good">100</span></div>
    ${rows || '<div class="m dim" style="font-size:10px">NO DEDUCTIONS. SUSPICIOUS.</div>'}
    <div style="height:1px;background:${rgba(ac, .3)};margin:6px 0"></div>
    <div class="ded"><span class="k ac">SCORE</span><span class="mid m dim" style="font-size:9px">grade ${Golf.grade(t.score)}</span><span class="dv" style="font-size:20px;color:${scoreColor(t.score)}">${t.score}</span></div>
    <div class="tiny" style="margin-top:8px">GRADES · A 85+ · B 70+ · C 55+ · D 40+ · F BELOW</div>`, { key: 'gbreak', i: 1 });
}
function flight(t) {
  const ac = AC(), temp = isNaN(t.tMin) ? NaN : (t.tMin + t.tMax) / 2, rows = Flight.table(t.wind, temp), gusts = Flight.table(t.gust, temp);
  const [into, down] = Golf.clubAdjust(t.wind), carry = Golf.carryDelta(temp), d = rows[0], maxC = Math.max(d.down, d.base);
  const W = 320, H = 110, base = H - 4;
  const arc = (c, apex, col, delay) => { const len = W * c / maxC * .96, p = `M0 ${base}Q${(len * .55).toFixed(1)} ${(base - apex * 2).toFixed(1)} ${len.toFixed(1)} ${base}`;
    return `<path d="${p}" stroke="${col}" stroke-opacity=".8" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle r="3" fill="${col}"><animateMotion dur="2.86s" begin="-${delay}s" repeatCount="indefinite" path="${p}"/></circle><line x1="${len}" x2="${len}" y1="${base - 6}" y2="${base}" stroke="${col}" stroke-opacity=".5"/>`; };
  const lefty = S.hand === 'L', from = compass16(t.dir);
  const notes = `WIND FROM ${from}. FOR A ${lefty ? 'LEFT-HANDER' : 'RIGHT-HANDER'}, A LEFT-TO-RIGHT WIND (FROM YOUR LEFT AT ADDRESS) FEEDS ${lefty ? 'A DRAW' : 'THE SLICE'}; RIGHT-TO-LEFT (FROM YOUR RIGHT) FEEDS ${lefty ? 'THE SLICE' : 'A DRAW'}. INTO A SLICE WIND, AIM INTO IT AND LET IT RIDE BACK. ON A HOLE PLAYING TOWARD THE ${from}, YOU'RE INTO IT: TEE IT LOWER, CLUB UP, SWING SMOOTHER.`;
  return panel(`Ball flight // ${hm(t.tee)}`, 'G-03', `<div style="display:flex">${readout('Into wind', `+${Golf.clubs(into)} club`, AMBER, 'flex:1')}${readout('Downwind', `−${Golf.clubs(down)} club`, GOOD, 'flex:1')}${readout('Temp carry', `${carry >= 0 ? '+' : '−'}${Math.abs(carry)} m`, INK, 'flex:1')}</div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:110px;margin-top:12px" preserveAspectRatio="none"><line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="${rgba(ac, .3)}"/>${arc(d.base, H * .36, INK, 0)}${arc(d.into, H * .44, AMBER, .94)}${arc(d.down, H * .30, GOOD, 1.9)}</svg>
      <div class="m" style="display:flex;font-size:8px;margin-top:4px"><span style="flex:1" class="ink">● CALM</span><span style="flex:1" class="amber">● INTO</span><span style="flex:1" class="good">● DOWN</span><span class="faint">DRIVER CARRY</span></div>`, { key: 'gflight', i: 0 })
    + panel('Carry table // metres', 'G-05', `<div class="ctab"><div class="r th" style="height:auto;padding-bottom:4px"><span class="m" style="font:8px 'Share Tech Mono'">CLUB</span><span class="m" style="font:8px 'Share Tech Mono'">CALM</span><span class="m" style="font:8px 'Share Tech Mono'">INTO</span><span class="m" style="font:8px 'Share Tech Mono'">DOWN</span><span class="m" style="font:8px 'Share Tech Mono'">X-DRIFT</span></div>
      ${rows.map((r, i) => `<div class="r reveal ${seen.has('gcarry') ? 'seen' : ''}" style="--r:${i}"><span class="mono11 ink" style="font-weight:400">${r.club}</span><span style="font-weight:500;color:var(--dim)">${r.base}</span><span class="amber">${r.into}</span><span class="good">${r.down}</span><span style="font-weight:500;color:${ac}">±${r.drift}</span></div>`).join('')}</div>
      <div class="m" style="font-size:9px;letter-spacing:1px;margin-top:8px;color:${t.gust >= 40 ? AMBER : 'var(--dim)'}">GUSTS ${R(t.gust)} KM/H: DRIVER INTO ${gusts[0].into} M · DRIFT ±${gusts[0].drift} M</div>
      <div class="tiny" style="margin-top:6px">BASELINE = MID-HANDICAP CALM-AIR CARRY AT 21°C. RULES OF THUMB: −1%/MPH INTO, +0.5%/MPH DOWN, 0.5%/MPH CROSS DRIFT.</div>`, { key: 'gcarry', i: 1 })
    + panel(lefty ? 'Lefty notes' : 'Righty notes', 'G-06', `<div class="hand"><span class="rl" style="flex:1">PLAYER</span><button data-hand="L" aria-pressed="${lefty}">LEFT-HANDED</button><button data-hand="R" aria-pressed="${!lefty}">RIGHT-HANDED</button></div>
      <div class="m" style="font-size:9px;line-height:14px;letter-spacing:.5px;color:rgba(230,251,255,.85)">${esc(notes)}</div>`, { key: 'gnotes', i: 2 });
}
function teeSheet(g, slot) {
  const ac = AC();
  if (!g.windows.length) return panel('No window', null, '<div class="m dim" style="font-size:11px">NO PLAYABLE DAYLIGHT WINDOW IN FORECAST RANGE</div>', { key: 'nowin', i: 0 });
  const rows = g.windows.map((t, i) => { const best = t === g.best, on = t === slot;
    return `<button class="teerow reveal ${seen.has('gsheet') ? 'seen' : ''}" style="--r:${i}" data-tee="${t.tee}" aria-pressed="${on}">
      <span class="m" style="width:44px;font-size:12px;color:${on || best ? ac : INK}">${hm(t.tee)}</span>
      <span style="flex:1;position:relative;display:flex;align-items:center"><span class="sbar" style="flex:1"><i style="width:${t.score}%;background:${scoreColor(t.score)}"></i></span><span class="d" style="position:absolute;right:0;font-weight:600;font-size:15px;color:${scoreColor(t.score)}">${t.score}${best ? '◆' : ''}</span></span>
      <span class="mono11" style="width:42px;padding-left:6px;color:${t.pop >= 40 ? ac : 'var(--dim)'}">${t.pop}%</span>
      <span style="width:50px;display:flex;align-items:center;gap:3px">${windArrow(t.dir, 'rgba(230,251,255,.58)', 10)}<span class="mono11" style="color:${t.gust >= 40 ? AMBER : 'var(--dim)'}">${R(t.wind)}</span></span>
      <span class="m faint" style="width:42px;font-size:9px">${t.limiter === 'NONE' ? '—' : t.limiter.slice(0, 4)}</span></button>`; }).join('');
  return panel('Tee sheet // golf score', 'G-04', `<div class="tiny" style="margin-bottom:8px">TAP A TEE TIME TO INSPECT IT · SCORE = 100 MINUS WEATHER DEDUCTIONS FOR A 4H ROUND</div>
    <div class="th" style="padding-bottom:4px"><span style="width:48px;font-size:8px">TEE</span><span style="flex:1;font-size:8px">SCORE /100</span><span style="width:42px;font-size:8px">RAIN</span><span style="width:50px;font-size:8px">WIND</span><span style="width:42px;font-size:8px">LIMIT</span></div>${rows}`, { key: 'gsheet', i: 0 });
}
function renderGolf() {
  const gw = S.golfW, el = $('#p-golf'); pIndex = 0;
  const banner = ready => `<div class="banner"><i class="${ready ? '' : 'wait'}"></i><div><div class="m ac" style="font-size:10px;letter-spacing:1.5px">COURSE LOCK · ${COURSE.name.toUpperCase()}</div>
    <div class="m faint" style="font-size:8px;letter-spacing:1px">${ready ? `${COURSE.region.toUpperCase()} · ${Math.abs(COURSE.lat).toFixed(3)}°S ${COURSE.lon.toFixed(3)}°E · SYNC T+${R((Date.now() - S.golfW.fetchedAt) / MIN)}M` : 'ACQUIRING COURSE FORECAST…'}</div></div></div>`;
  if (!gw) { el.innerHTML = `<div class="col">${banner(false)}</div>`; return; }
  const t0 = dkey(gw.current.time), days = gw.daily.slice(0, 7);
  if (!S.golfDay || !dayOf(gw, S.golfDay)) { const def = Golf.defaultDay(gw); S.golfDay = days.some(d => d.date === def) ? def : t0; }
  const g = Golf.day(gw, S.golfDay), slot = g.windows.find(x => x.tee === S.golfSlot) || g.best, ac = AC();
  const chips = days.map(d => { const b = Golf.day(gw, d.date).best;
    return `<button class="chip gchip" data-day="${d.date}" aria-pressed="${d.date === g.date}"><span class="l">${d.date === t0 ? 'TODAY' : dayShort(d.date)}</span><span class="v" style="color:${b ? scoreColor(b.score) : 'var(--faint)'}">${b ? b.score : '--'}</span></button>`; }).join('');
  const tees = g.windows.map(t => `<button class="tee" data-tee="${t.tee}" aria-pressed="${t === slot}" style="border-color:${rgba(scoreColor(t.score), .35)}"><span class="l">${hm(t.tee)}${t === g.best ? '◆' : ''}</span><span class="v" style="color:${scoreColor(t.score)}">${t.score}</span></button>`).join('');
  const tabs = ['BRIEF', 'SCORE', 'FLIGHT', 'SHEET'].map(t => `<button data-gtab="${t}" aria-pressed="${S.golfTab === t}">${t}</button>`).join('');
  const none = panel('No window', null, '<div class="m dim" style="font-size:11px">NO PLAYABLE DAYLIGHT WINDOW IN FORECAST RANGE</div>', { key: 'nowin', i: 0 });
  let body = '', up = null;
  if (S.golfTab === 'BRIEF') { up = uplink(g.date, slot, g); body = up.html + scoreSummary(g.date, slot, g, 1); }
  else if (S.golfTab === 'SCORE') body = scoreSummary(g.date, slot, g, 0) + (slot ? breakdown(slot) : '');
  else if (S.golfTab === 'FLIGHT') body = slot ? flight(slot) : none;
  else body = teeSheet(g, slot);
  el.innerHTML = `<div class="col" style="gap:10px">${banner(true)}<div class="hs" data-chips="golf" style="gap:8px">${chips}</div>${tees ? `<div class="hs">${tees}</div>` : ''}<div class="seg">${tabs}</div>${body}</div>`;
  mountPanels(el);
  if (up) typeUplink($('#uplink'), up.text);
}

/* ---------- AIR ---------- */
function pollenBar(label, v) {
  return `<div class="pb"><span class="lb">${label}</span><span class="segs">${Array.from({ length: 5 }, (_, k) => `<i style="background:${v != null && v >= k + .5 ? pollenColor(k + 1) : 'color-mix(in srgb,var(--ac) 10%,transparent)'}"></i>`).join('')}</span><span class="pv">${v != null ? R(v) : '-'}</span></div>`;
}
function renderAir() {
  const w = S.w; if (!w) return;
  pIndex = 0;
  const pollen = S.pollenKey && S.pollen ? S.pollen : Air.estimate(w), t = pollen.days[0], t0 = dkey(w.current.time);
  const asthma = pollen.days.find(d => d.asthma);
  const pol = panel('Pollen index', pollen.source === 'GOOGLE' ? 'GOOGLE UPI' : 'MODELLED', !t ? '<div class="m dim" style="font-size:11px">ACQUIRING…</div>' : `
    <div style="display:flex;align-items:flex-end"><span class="d" style="font-weight:300;font-size:48px;line-height:1;color:${pollenColor(Air.peak(t))}" data-decode="${Air.peak(t).toFixed(1)}">${Air.peak(t).toFixed(1)}</span><span class="m dim" style="font-size:12px;margin:0 12px 8px 0"> / 5</span><span class="m" style="font-size:14px;letter-spacing:2px;margin-bottom:8px;color:${pollenColor(Air.peak(t))}">${Air.upi(Air.peak(t))}</span></div>
    ${asthma ? `<div class="m alert" style="font-size:10px;letter-spacing:1px;margin:6px 0">⚠ THUNDERSTORM ASTHMA CONDITIONS ${dayShort(asthma.date)} · HAVE RELIEVER READY</div>` : ''}
    <div style="margin-top:8px">${pollen.days.map(d => `<div style="display:flex;align-items:center;height:28px"><span class="m dim" style="width:64px;font-size:10px">${d.date === t0 ? 'TODAY' : dayShort(d.date)}</span>${pollenBar('GRS', d.grass)}${pollen.source === 'GOOGLE' ? '<span style="width:10px"></span>' + pollenBar('TRE', d.tree) : ''}</div>`).join('')}</div>
    ${pollen.note ? `<div class="tiny" style="margin-top:6px">${esc(pollen.note.toUpperCase())}</div>` : ''}`, { key: 'pollen', i: 0 });
  const q = S.air, aqi = q ? q.usAqi : null, col = aqi == null ? INK : aqi <= 50 ? GOOD : aqi <= 100 ? '#ffd23d' : aqi <= 150 ? '#ff7a3d' : ALERT;
  const aq = panel('Air quality', 'US AQI', aqi == null ? '<div class="m dim" style="font-size:11px">ACQUIRING…</div>' : `
    <div style="display:flex;align-items:flex-end"><span class="d" style="font-weight:300;font-size:48px;line-height:1;color:${col}" data-decode="${aqi}">${aqi}</span><span class="m" style="font-size:12px;letter-spacing:2px;margin:0 0 8px 12px;color:${col}">${Air.aqi(aqi)}</span></div>
    <div style="display:flex;margin-top:8px">${readout('PM2.5', q.pm25 != null ? f1(q.pm25) : '--', INK, 'flex:1')}${readout('PM10', q.pm10 != null ? f1(q.pm10) : '--', INK, 'flex:1')}${readout('Ozone', q.ozone != null ? R(q.ozone) : '--', INK, 'flex:1')}</div>
    <div class="tiny" style="margin-top:6px">µG/M³ · CAMS ATMOSPHERIC MODEL</div>`, { key: 'aq', i: 1 });
  const key = panel('Pollen uplink', 'CFG', (S.pollenKey
    ? `<div class="keyrow"><span class="m ink" style="flex:1;font-size:12px">KEY ••••${esc(S.pollenKey.slice(-4))}</span><button class="alert" id="keyClear">[CLEAR]</button></div>`
    : `<div class="m dim" style="font-size:9px;letter-spacing:1px;line-height:1.5">OPEN-METEO HAS NO POLLEN DATA OUTSIDE EUROPE. FOR A MEASURED GRASS + TREE INDEX, PASTE A GOOGLE MAPS PLATFORM KEY WITH THE POLLEN API ENABLED (FREE MONTHLY ALLOWANCE). RESTRICT IT TO THIS SITE'S ADDRESS.</div>
       <div class="keyrow" style="margin-top:10px"><input id="keyIn" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="AIza…" maxlength="64"><button class="ac" id="keySave">[SAVE]</button></div>`)
    + (S.pollenError ? `<div class="m alert" style="font-size:9px;letter-spacing:1px;margin-top:6px">⚠ ${esc(S.pollenError.toUpperCase())} — SHOWING MODELLED ESTIMATE</div>` : ''), { key: 'pkey', i: 2 });
  $('#p-air').innerHTML = `<div class="col">${pol}${aq}${key}</div>`;
  mountPanels($('#p-air'));
}

/* ---------- chrome ---------- */
const sel = () => S.w ? forDay(S.w, S.coreDay || dkey(S.w.current.time)) : null;
function toast(msg) { const t = $('#toast'); if (!msg) { t.hidden = true; return; } t.textContent = '⚠ ' + msg.toUpperCase(); t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 6000); }
function renderTop() {
  const w = S.w, name = S.place ? S.place.name : 'SKYFALL';
  if ($('#placeName').dataset.v !== name) { $('#placeName').dataset.v = name; $('#placeName').dataset.done = ''; decodeText($('#placeName'), name.toUpperCase(), 700); }
  if (!w) return;
  const lat = S.place ? S.place.lat : w.lat, lon = S.place ? S.place.lon : w.lon;
  $('#coords').textContent = `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}${S.place && S.place.gps ? ' · GPS' : ''}`;
  const clock = new Date(localNow(w.off)).toISOString().slice(11, 19), mins = R((Date.now() - w.fetchedAt) / MIN);
  $('#dot').classList.toggle('model', w.fetchedAt < slotStart());
  $('#liveLabel').textContent = `OPEN-METEO · ${clock} · ${mins < 1 ? 'SYNC  T+00M' : mins < 60 ? `SYNC  T+${mins}M` : `SYNC  T+${Math.floor(mins / 60)}H`}`;
}
function visiblePages() { const pw = $('#pager').querySelector('.page').offsetWidth || 1; return Math.max(1, Math.round($('#pager').clientWidth / pw)); }
function renderDock() {
  const vis = visiblePages();
  $('#dock').innerHTML = TABS.map(([l], i) => `<button data-tab="${i}" aria-current="${i >= S.tab && i < S.tab + vis}">${l}<small>0${i + 1}</small></button>`).join('');
}
function applyTheme() {
  const w = S.w; if (!w) return;
  const n = new Date(localNow(w.off)), minute = n.getUTCHours() * 60 + n.getUTCMinutes();
  const d = w.daily[0], rise = hourOf(d.sunrise) * 60 + new Date(d.sunrise).getUTCMinutes(), set = hourOf(d.sunset) * 60 + new Date(d.sunset).getUTCMinutes();
  const sky = Codes.sky(w.current.code);
  document.documentElement.style.setProperty('--ac', themeAccent(minute, rise, set, w.current.temperature, sky));
  Scene.set({ sky, minute, rise, set, wind: w.current.windSpeed, moon: moonPhase(Date.now()) });
  $('#ambTemp').textContent = deg(w.current.temperature);
  $('#ambSky').textContent = Codes.label(w.current.code).toUpperCase() + '';
  $('#ambClock').textContent = n.toISOString().slice(11, 16) + ' · ' + (S.place ? S.place.name.toUpperCase() : '');
}
/* The sky scene only lives behind CORE, fading as you swipe away (Android "coreness"). */
function coreness() { const pw = $('#pager').querySelector('.page').offsetWidth || 1; const f = Math.max(0, Math.min(1, 1 - $('#pager').scrollLeft / pw)); $('#sky').style.opacity = f; }
function renderAll() { renderTop(); renderDock(); applyTheme(); renderCore(); renderScan(); renderTraj(); renderData(); renderGolf(); renderAir(); }

/* ---------- data flow ---------- */
function loadFromCache() {
  if (S.place) {
    const p = S.place;
    S.w = Obs.merge(Repo.forecast(p.lat, p.lon), Repo.obs(p.lat, p.lon));
    S.air = Repo.air(p.lat, p.lon);
    S.pollen = S.pollenKey ? Repo.pollen(p.lat, p.lon) : null;
  }
  S.golfW = Obs.merge(Repo.forecast(COURSE.lat, COURSE.lon), Repo.obs(COURSE.lat, COURSE.lon));
  if (S.w && (!S.coreDay || !dayOf(S.w, S.coreDay))) S.coreDay = dkey(S.w.current.time);
}
let busy = false;
async function refresh(force = false) {
  if (!S.place || busy) return; busy = true;
  const p = S.place; let changed = force;
  const quiet = async f => { try { if (await f()) changed = true; } catch (e) { console.warn('refresh skipped:', e.message); } };
  try {
    try { if (await Repo.refreshForecast(p.lat, p.lon, force ? 0 : 30 * MIN)) changed = true; S.error = null; }
    catch (e) { S.error = (S.w ? 'Offline. Showing the last good forecast. ' : "Couldn't load the forecast. ") + e.message; toast(S.error); }
    if (OBS_ENABLED) await quiet(() => Repo.refreshObs(p.lat, p.lon, force ? 2 * MIN : 10 * MIN));
    if (changed) { loadFromCache(); renderAll(); }
    await quiet(() => Repo.refreshAir(p.lat, p.lon, force ? 10 * MIN : 60 * MIN));
    if (S.pollenKey) { try { if (await Repo.refreshPollen(p.lat, p.lon, S.pollenKey, force ? HOUR : 6 * HOUR)) changed = true; S.pollenError = null; } catch (e) { S.pollenError = e.message; changed = true; } }
    await quiet(() => Repo.refreshForecast(COURSE.lat, COURSE.lon, 20 * MIN));
    if (OBS_ENABLED) await quiet(() => Repo.refreshObs(COURSE.lat, COURSE.lon, 10 * MIN));
    if (changed) { loadFromCache(); renderAll(); }
  } finally { busy = false; }
}
function setPlace(p) {
  S.place = p; Store.set('place', p); S.coreDay = null; closeSearch();
  loadFromCache(); renderAll(); refresh(false);
}

/* ---------- search + location ---------- */
function openSearch() { $('#search').hidden = false; setTimeout(() => $('#q').focus(), 50); }
function closeSearch() { $('#search').hidden = true; $('#q').value = ''; $('#results').innerHTML = ''; }
let qTimer, lastResults = [];
$('#q').addEventListener('input', e => {
  clearTimeout(qTimer); const q = e.target.value;
  if (q.trim().length < 2) { $('#results').innerHTML = ''; return; }
  qTimer = setTimeout(async () => {
    try { lastResults = await OM.search(q); $('#results').innerHTML = lastResults.map((r, i) => `<button data-res="${i}"><b>${esc(r.name)}</b><span>${esc(r.region)} · ${r.lat.toFixed(2)}, ${r.lon.toFixed(2)}</span></button>`).join('') || '<p class="small">No match.</p>'; }
    catch (err) { $('#results').innerHTML = `<p class="small alert">${esc(err.message)}</p>`; }
  }, 300);
});
$('#results').addEventListener('click', e => { const b = e.target.closest('[data-res]'); if (b) { const r = lastResults[+b.dataset.res]; setPlace({ name: r.name, region: r.region, lat: r.lat, lon: r.lon, gps: false }); } });
$('#useGps').addEventListener('click', () => locate(true));
function locate(fromSearch) {
  if (!navigator.geolocation) { toast('Location is not available in this browser. Search for a place instead.'); return; }
  $('#useGps').textContent = '◎ LOCATING…';
  navigator.geolocation.getCurrentPosition(async pos => {
    $('#useGps').textContent = '◎ USE CURRENT LOCATION';
    const lat = pos.coords.latitude, lon = pos.coords.longitude;
    let name = 'Current location', region = '';
    try {
      const g = await getJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&localityLanguage=en`);
      name = g.locality || g.city || name; region = [g.principalSubdivision, g.countryName].filter(Boolean).join(', ');
    } catch { }
    setPlace({ name, region, lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000, gps: true });
  }, err => {
    $('#useGps').textContent = '◎ USE CURRENT LOCATION';
    toast(err.code === 1 ? 'Location permission denied. Search for a place instead.' : "Couldn't get your location. Search for a place instead.");
    if (!fromSearch && !S.place) openSearch();
  }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * MIN });
}

/* ---------- events ---------- */
$('#btnSearch').addEventListener('click', openSearch);
// Chrome / Edge / Android: offer a one-tap install when the browser says the app is installable.
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#btnInstall').hidden = false; });
addEventListener('appinstalled', () => { installEvt = null; $('#btnInstall').hidden = true; });
$('#btnInstall').addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch { } installEvt = null; $('#btnInstall').hidden = true; });
$('#searchClose').addEventListener('click', () => { if (S.place) closeSearch(); });
$('#btnAmbient').addEventListener('click', () => { document.body.classList.add('amb'); $('#ambient').hidden = false; });
$('#ambClose').addEventListener('click', () => { document.body.classList.remove('amb'); $('#ambient').hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#search').hidden && S.place) closeSearch(); if (!$('#ambient').hidden) $('#ambClose').click(); } });

const pager = $('#pager');
const pageW = () => pager.querySelector('.page').offsetWidth || pager.clientWidth;
function goTab(i, smooth = true) { i = Math.max(0, Math.min(TABS.length - visiblePages(), i)); S.tab = i; pager.scrollTo({ left: i * pageW(), behavior: smooth && !reduce ? 'smooth' : 'auto' }); renderDock(); if (i === 1) Scope.replay(); try { history.replaceState(null, '', '#' + TABS[i][0].toLowerCase()); } catch { } }
$('#dock').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) goTab(+b.dataset.tab); });
let scrollT; pager.addEventListener('scroll', () => { coreness(); clearTimeout(scrollT); scrollT = setTimeout(() => { const i = Math.round(pager.scrollLeft / pageW()); if (i !== S.tab) { S.tab = i; renderDock(); if (i === 0) Core.replay(); if (i === 1) Scope.replay(); } }, 80); }, { passive: true });
addEventListener('resize', () => { goTab(S.tab, false); coreness(); });
document.addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; if (e.key === 'ArrowRight') goTab(Math.min(5, S.tab + 1)); if (e.key === 'ArrowLeft') goTab(Math.max(0, S.tab - 1)); });

document.body.addEventListener('click', e => {
  const t = e.target;
  const day = t.closest('[data-day]');
  if (day) { const which = day.closest('[data-chips]').dataset.chips; if (which === 'core') { S.coreDay = day.dataset.day; renderCore(); } else { S.golfDay = day.dataset.day; S.golfSlot = null; renderGolf(); } return; }
  const go = t.closest('[data-go]'); if (go) { goTab(+go.dataset.go); return; }
  const tee = t.closest('[data-tee]'); if (tee) { S.golfSlot = +tee.dataset.tee; renderGolf(); return; }
  const gt = t.closest('[data-gtab]'); if (gt) { S.golfTab = gt.dataset.gtab; renderGolf(); return; }
  const hd = t.closest('[data-hand]'); if (hd) { S.hand = hd.dataset.hand; Store.set('hand', S.hand); renderGolf(); return; }
  if (t.id === 'keySave') {
    const k = ($('#keyIn').value || '').trim();
    if (!GOOGLE_KEY.test(k)) { S.pollenError = "That isn't a Google API key (they start with AIza)."; renderAir(); return; }
    S.pollenKey = k; S.pollenError = null; Store.set('pollenKey', k); Store.del(`snap:pollen:${placeKey(S.place.lat, S.place.lon)}`); renderAir(); refresh(false); return;
  }
  if (t.id === 'keyClear') { S.pollenKey = ''; S.pollen = null; Store.del('pollenKey'); renderAll(); }
});

/* ---------- boot ---------- */
async function boot() {
  Scene.mount($('#sky'));
  const lines = ['SKYFALL // ATMOS-7', '> HANDSHAKE ........ OK', '> OPEN-METEO ....... LINKED', '> FAIRWAY UPLINK ... ARMED', '> HUD .............. ONLINE'];
  const bl = $('.boot-lines'); let i = 0;
  await new Promise(res => { const step = () => { if (i >= lines.length || reduce) { bl.textContent = lines.join('\n'); return res(); } bl.textContent = lines.slice(0, ++i).join('\n'); setTimeout(step, 160); }; step(); });
  setTimeout(() => { $('#boot').classList.add('gone'); Core.replay(); }, reduce ? 0 : 300);
  const h = location.hash.slice(1).toUpperCase(), ti = TABS.findIndex(t => t[0] === h);
  loadFromCache(); renderAll();
  if (ti > 0) requestAnimationFrame(() => goTab(ti, false));
  if (!S.place) { locate(false); openSearch(); } else refresh(false);
  setInterval(() => { if (!document.hidden) { renderTop(); applyTheme(); refresh(false); } }, 60000);
  setInterval(() => { if (!document.hidden) renderTop(); }, 1000);
  // Re-run the core gauge load every half hour (on the :00 and :30), like a fresh reading coming in.
  const half = 30 * MIN, nextHalf = () => half - Date.now() % half + 200;
  const halfHour = () => { if (!document.hidden && S.tab === 0) Core.replay(); setTimeout(halfHour, nextHalf()); };
  setTimeout(halfHour, nextHalf());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(false); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
}
boot();
}
