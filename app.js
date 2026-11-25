/* Skyfall web — UI. Everything renders from the local cache; the network only refreshes it. */
'use strict';
{
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TABS = [['CORE', 'CORE'], ['24H', 'SCAN'], ['10D', 'TRAJ'], ['DATA', 'DATA'], ['GOLF', 'GOLF'], ['AIR', 'AIR']];
const GOOGLE_KEY = /^AIza[0-9A-Za-z_-]{35}$/;

const S = {
  place: Store.get('place', null), w: null, air: null, pollen: null, golfW: null,
  coreDay: null, golfDay: null, golfSlot: null, golfTab: 'BRIEF',
  hand: Store.get('hand', 'L'), pollenKey: Store.get('pollenKey', ''), pollenError: null, tab: 0, error: null,
};

/* ---------- icons ---------- */
function wxIcon(code, day = true, size = 26) {
  const sky = Codes.sky(code), ac = 'var(--ac)';
  const sun = `<g class="rays" stroke="#ffc23d" stroke-width="1.6">${[0, 45, 90, 135, 180, 225, 270, 315].map(a => `<line x1="12" y1="2.2" x2="12" y2="4.6" transform="rotate(${a} 12 12)"/>`).join('')}</g><circle cx="12" cy="12" r="4.4" fill="none" stroke="#ffc23d" stroke-width="1.6"/>`;
  const moon = `<path d="M15.5 4.5a7.5 7.5 0 1 0 4 12.5A6 6 0 0 1 15.5 4.5z" fill="none" stroke="#b8a8ff" stroke-width="1.6"/>`;
  const cloud = (y = 0, col = ac) => `<path d="M7 ${18 + y}h10a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6-1.2A3.6 3.6 0 0 0 7 ${18 + y}z" fill="rgba(2,6,14,.6)" stroke="${col}" stroke-width="1.5"/>`;
  let body;
  switch (sky) {
    case 'CLEAR': body = day ? sun : moon; break;
    case 'PARTLY': body = `<g transform="translate(-4 -4) scale(.8)">${day ? sun : moon}</g>${cloud(1)}`; break;
    case 'FOG': body = `${cloud(-3)}<g stroke="${ac}" stroke-width="1.4"><line x1="4" y1="19" x2="20" y2="19"/><line x1="6" y1="22" x2="18" y2="22"/></g>`; break;
    case 'DRIZZLE': case 'RAIN': body = `${cloud(-4)}<g stroke="#7fd4ff" stroke-width="1.5">${[8, 12, 16].map((x, i) => `<line class="rain-d" style="animation-delay:${i * .3}s" x1="${x}" y1="17" x2="${x - 1}" y2="${sky === 'RAIN' ? 21 : 19}"/>`).join('')}</g>`; break;
    case 'SNOW': body = `${cloud(-4)}<g fill="#e6fbff">${[8, 12, 16].map((x, i) => `<circle class="rain-d" style="animation-delay:${i * .4}s" cx="${x}" cy="19" r="1.1"/>`).join('')}</g>`; break;
    case 'STORM': body = `${cloud(-4, '#ff2bd6')}<path class="bolt" d="M12.5 15l-3 4.5h3l-1.5 4 4-5.5h-3l1.5-3z" fill="#ffd23d"/>`; break;
    default: body = cloud();
  }
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
}
const arrow = (deg, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="transform:rotate(${deg + 180}deg)" aria-hidden="true"><path d="M12 3v18M12 3l-5 6M12 3l5 6" fill="none" stroke="var(--ac)" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const GEAR_SVG = {
  SHELL: '<path d="M8 4l4 2 4-2 4 4-2 3v9H6v-9L4 8z"/><path d="M12 6v14"/>',
  COAT: '<path d="M8 3l4 3 4-3 4 4-1 14H5L4 7z"/><path d="M12 6v15M9 13h1M14 13h1"/>',
  LAYERS: '<path d="M8 4l4 2 4-2 4 4-2 3v9H6v-9L4 8z"/><path d="M9 8l3 2 3-2"/>',
  TSHIRT: '<path d="M8 4l4 2 4-2 5 4-3 3-2-1v10H8V10l-2 1-3-3z"/>',
  BOOTS: '<path d="M8 3h5v10l6 3v4H6V3z"/><path d="M6 17h13"/>',
  SANDALS: '<path d="M4 18c0-3 3-4 8-4s8 1 8 4"/><path d="M8 14l2-5M14 14l-1-5M4 19h16"/>',
  SNEAKERS: '<path d="M3 17c0-3 1-6 4-6l4 3 6 1c3 0 4 1 4 3v1H3z"/><path d="M9 13l1 2M12 14l1 2"/>',
  SUNSCREEN: '<rect x="8" y="7" width="8" height="14" rx="2"/><path d="M10 7V4h4v3M10 13h4"/>',
  SUNGLASSES: '<circle cx="7" cy="13" r="3.5"/><circle cx="17" cy="13" r="3.5"/><path d="M10.5 13h3M3 11l-1-3M21 11l1-3"/>',
  HAT: '<path d="M2 16c4 2 16 2 20 0"/><path d="M6 15c0-5 2-8 6-8s6 3 6 8"/>',
  GLOVES: '<path d="M7 21v-8L5 9l1-1 3 3V4h2v6V3h2v7V4h2v7l2-3 1 1-2 6v6z"/>',
  MASK: '<path d="M4 9c4-2 12-2 16 0v4c-2 5-14 5-16 0z"/><path d="M4 10L2 8M20 10l2-2M8 11h8M8 14h8"/>',
};

/* ---------- small helpers ---------- */
const sel = () => S.w ? forDay(S.w, S.coreDay || dkey(S.w.current.time)) : null;
const deg = x => (x == null || isNaN(x) ? '--' : R(x) + '°');
const scoreCol = s => s >= 70 ? 'var(--good)' : s >= 50 ? 'var(--amber)' : 'var(--alert)';
const panel = (title, code, body, cls = '') => `<div class="panel ${cls}"><div class="ph"><b>${esc(title)}</b><span>${esc(code)}</span></div>${body}</div>`;
function toast(msg) { const t = $('#toast'); if (!msg) { t.hidden = true; return; } t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 6000); }
function dayChips(w, selected, onKey, days = 7) {
  return `<div class="chips" data-chips="${onKey}">${w.daily.slice(0, days).map((d, i) => `<button class="chip" data-day="${d.date}" aria-pressed="${d.date === selected}">
    <span>${i === 0 ? 'TODAY' : DOW[dow(d.ms)]}</span>${wxIcon(d.code)}<span class="t" style="color:${tempColor(d.max)}">${deg(d.max)}</span></button>`).join('')}</div>`;
}

/* ---------- CORE ---------- */
function coreSvg(w) {
  const c = w.current, d = dayOf(w, dkey(c.time)) || w.daily[0];
  const lo = Math.min(d.min, c.temperature), hi = Math.max(d.max, c.temperature);
  const f = hi > lo ? (c.temperature - lo) / (hi - lo) : 0.5;
  const C = 170, r = 128, start = 135, sweep = 270;
  const pt = (a, rr) => { const t = (a - 90) * Math.PI / 180; return [C + rr * Math.cos(t), C + rr * Math.sin(t)]; };
  const ticks = Array.from({ length: 40 }, (_, i) => { const a = start + sweep * i / 39, on = i / 39 <= f; const [x1, y1] = pt(a + 90, r); const [x2, y2] = pt(a + 90, r - 14);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${on ? lerpHex('#00e5ff', '#9dff5c', i / 39) : 'rgba(230,251,255,.12)'}" stroke-width="6" stroke-linecap="round"/>`; }).join('');
  const [kx, ky] = pt(start + sweep * f + 90, r - 7);
  const label = Codes.label(c.code).toUpperCase();
  return `<svg viewBox="0 0 340 340" role="img" aria-label="${R(c.temperature)} degrees, ${esc(label)}">
    <g class="spin"><circle cx="170" cy="170" r="160" fill="none" stroke="var(--ac)" stroke-opacity=".35" stroke-dasharray="2 9"/></g>
    <g class="spin rev"><circle cx="170" cy="170" r="104" fill="none" stroke="var(--ac)" stroke-opacity=".25" stroke-dasharray="40 14 4 14"/></g>
    ${ticks}
    <circle cx="${kx}" cy="${ky}" r="9" fill="#fff"/><circle cx="${kx}" cy="${ky}" r="18" fill="#9dff5c" fill-opacity=".25"/>
    <text x="170" y="112" text-anchor="middle" fill="var(--ac)" font-family="Share Tech Mono, monospace" font-size="15" letter-spacing="3">// ${esc(label)}</text>
    <text x="164" y="212" text-anchor="middle" fill="#e6fbff" font-family="Rajdhani, sans-serif" font-weight="300" font-size="118">${R(c.temperature)}</text>
    <text x="236" y="140" fill="var(--ac)" font-family="Rajdhani, sans-serif" font-size="30">°C</text>
    <text x="170" y="252" text-anchor="middle" fill="rgba(230,251,255,.7)" font-family="Share Tech Mono, monospace" font-size="14" letter-spacing="3">FEELS ${R(c.feelsLike)}°</text>
    <text x="96" y="300" text-anchor="middle" fill="#7fd4ff" font-family="Share Tech Mono, monospace" font-size="15">L ${deg(d.min)}</text>
    <text x="244" y="300" text-anchor="middle" fill="#ffc23d" font-family="Share Tech Mono, monospace" font-size="15">H ${deg(d.max)}</text>
  </svg>`;
}
let quipCache = {};
function renderCore() {
  const w = sel(); if (!w) return;
  const c = w.current, isToday = dkey(c.time) === dkey(S.w.current.time);
  const pop24 = Math.max(0, ...w.hourly.slice(0, 24).map(h => h.pop || 0));
  const uvPeak = (dayOf(w, dkey(c.time)) || w.daily[0]).uvMax;
  const gw = S.golfW || S.w, gd = Golf.day(gw, Golf.defaultDay(gw));
  const pollen = S.pollen || Air.estimate(S.w), pl = pollenFor(w, pollen);
  const lo = Advisor.loadout(w, S.air);
  const items = Object.fromEntries(lo.items.map(i => [i.gear, i]));
  const loTitle = lo.next ? `Loadout // tomorrow, daylight` : `Loadout // ${isToday ? 'today' : DOWL[dow(T(lo.date + 'T00:00'))]}, daylight`;
  const gear = Gear.map(([g, name]) => {
    const a = items[g];
    if (!a) return `<div class="gear">${`<svg viewBox="0 0 24 24">${GEAR_SVG[g]}</svg>`}<div class="n">${esc(name)}</div><div class="r">NOT NEEDED</div></div>`;
    const k = `${lo.date}:${g}:${a.title}`; if (!quipCache[k]) quipCache[k] = a.quips[Math.floor(Math.random() * a.quips.length)];
    return `<div class="gear on ${a.pri >= 7 ? 'hot' : ''}"><svg viewBox="0 0 24 24">${GEAR_SVG[g]}</svg><div class="n">${esc(a.title)}</div><div class="r">${esc(a.reason)}</div><div class="q">${esc(quipCache[k])}</div></div>`;
  }).join('');
  const tx = Advisor.bulletin(w, S.air, pollen, S.place ? S.place.name : '', S.golfW);
  $('#p-core').innerHTML = `<div class="wrap">
    <div class="full">${dayChips(S.w, dkey(c.time), 'core')}</div>
    <div class="core">${coreSvg(w)}</div>
    ${panel('Quick read', isToday ? (w.obs ? 'OBS' : 'MODEL') : 'FORECAST', `<div class="qgrid">
      <div><div class="lbl">Wind ${compass16(c.windDirection)}</div><div class="val">${R(c.windSpeed)} <small class="mono">KM/H</small></div></div>
      <div><div class="lbl">Rain 24h</div><div class="val">${pop24}%</div></div>
      <div><div class="lbl">UV peak</div><div class="val" style="color:${(uvPeak || 0) >= 8 ? 'var(--alert)' : (uvPeak || 0) >= 3 ? 'var(--amber)' : 'var(--good)'}">${uvPeak == null ? '--' : R(uvPeak)}</div></div>
      <div><div class="lbl">Humidity</div><div class="val">${c.humidity ?? '--'}%</div></div>
      <button data-go="4"><div class="lbl">Golf Sat ›</div><div class="val" style="color:${gd.best ? scoreCol(gd.best.score) : 'var(--dim)'}">${gd.best ? `${gd.best.score} · ${hm(gd.best.tee)}` : '--'}</div></button>
      <button data-go="5"><div class="lbl">Pollen ›</div><div class="val txtv" style="color:${pl && Air.peak(pl) >= 3.5 ? 'var(--amber)' : 'var(--ink)'}">${pl ? Air.upi(Air.peak(pl)) : '--'}</div></button>
    </div>`)}
    ${panel(loTitle, `${lo.items.length}/${Gear.length} ON`, `<div class="loadout">${gear}</div>`)}
    ${panel('Comms // atmos-7 transmission', 'RX', `<div class="comms" id="comms"></div>`, 'full')}
  </div>`;
  typewrite($('#comms'), tx);
}
const typed = {};
function typewrite(el, tx) {
  const sig = JSON.stringify(tx), seen = typed[el.id] === sig; typed[el.id] = sig;
  const lines = tx.map(t => ({ ...t }));
  if (reduce || seen) { el.innerHTML = lines.map(t => `<p class="${t.serious ? 'serious' : ''}"><span class="tag">[${esc(t.tag)}]</span>${esc(t.text)}</p>`).join('') + '<span class="caret"></span>'; return; }
  let li = 0, ci = 0; el.innerHTML = '';
  const id = String(++typewrite.n); el.dataset.tid = id;
  const step = () => {
    if (el.dataset.tid !== id || !el.isConnected) return;
    if (li >= lines.length) { el.insertAdjacentHTML('beforeend', '<span class="caret"></span>'); return; }
    let p = el.children[li];
    if (!p) { p = document.createElement('p'); if (lines[li].serious) p.className = 'serious'; p.innerHTML = `<span class="tag">[${esc(lines[li].tag)}]</span><span class="b"></span>`; el.appendChild(p); }
    ci = Math.min(lines[li].text.length, ci + 3);
    p.querySelector('.b').textContent = lines[li].text.slice(0, ci);
    if (ci >= lines[li].text.length) { li++; ci = 0; setTimeout(step, 120); } else setTimeout(step, 16);
  };
  step();
}
typewrite.n = 0;

/* ---------- 24H ---------- */
function renderScan() {
  const w = S.w; if (!w) return;
  const hrs = w.hourly.slice(0, 25);
  const temps = hrs.map(h => h.temperature), lo = Math.min(...temps), hi = Math.max(...temps);
  const pts = hrs.map((h, i) => `${(i / 24 * 100).toFixed(2)},${(36 - (h.temperature - lo) / Math.max(1, hi - lo) * 30).toFixed(2)}`).join(' ');
  const rows = hrs.map((h, i) => `<tr><td>${i === 0 ? 'NOW' : hm(h.time)}</td><td>${wxIcon(h.code, h.isDay, 22)}</td><td class="n" style="color:${tempColor(h.temperature)}">${deg(h.temperature)}</td>
    <td class="n" style="color:${(h.pop || 0) >= 40 ? '#7fd4ff' : 'var(--dim)'}">${h.pop ?? 0}%</td><td class="n">${h.precip ? f1(h.precip) : '—'}</td>
    <td>${arrow(h.dir)} ${R(h.wind)}</td><td class="n ${h.gust >= 45 ? 'amber' : ''}">${R(h.gust)}</td></tr>`).join('');
  $('#p-scan').innerHTML = `<div class="wrap">${panel('Temporal scan // 24h', `${deg(lo)}–${deg(hi)}`, `<svg viewBox="0 0 100 40" preserveAspectRatio="none" style="width:100%;height:80px"><polyline points="${pts}" fill="none" stroke="var(--ac)" stroke-width=".8" vector-effect="non-scaling-stroke"/></svg>`, 'full')}
    ${panel('Hour by hour', 'KM/H · MM', `<table><thead><tr><th>TIME</th><th></th><th>TEMP</th><th>RAIN</th><th>MM</th><th>WIND</th><th>GUST</th></tr></thead><tbody>${rows}</tbody></table>`, 'full')}</div>`;
}

/* ---------- 10D ---------- */
function renderTraj() {
  const w = S.w; if (!w) return;
  const lo = Math.min(...w.daily.map(d => d.min)), hi = Math.max(...w.daily.map(d => d.max)), span = Math.max(1, hi - lo);
  const rows = w.daily.map((d, i) => `<tr><td>${i === 0 ? 'TODAY' : DOW[dow(d.ms)] + ' ' + d.date.slice(8)}</td><td>${wxIcon(d.code)}</td>
    <td class="n" style="color:${(d.popMax || 0) >= 40 ? '#7fd4ff' : 'var(--dim)'}">${d.popMax ?? 0}%</td>
    <td class="n" style="color:#7fd4ff">${deg(d.min)}</td>
    <td style="width:40%"><div class="bar"><i style="left:${((d.min - lo) / span * 100).toFixed(1)}%;right:${((hi - d.max) / span * 100).toFixed(1)}%;background:linear-gradient(90deg,${tempColor(d.min)},${tempColor(d.max)})"></i></div></td>
    <td class="n" style="color:${tempColor(d.max)}">${deg(d.max)}</td></tr>`).join('');
  $('#p-traj').innerHTML = `<div class="wrap">${panel('Trajectory // 10 day', 'OPEN-METEO', `<table><thead><tr><th>DAY</th><th></th><th>RAIN</th><th>LO</th><th></th><th>HI</th></tr></thead><tbody>${rows}</tbody></table>`, 'full')}
    ${panel('Week ahead', 'SUMMARY', `<p class="small">${esc(weekSummary(w))}</p>`, 'full')}</div>`;
}
function weekSummary(w) {
  const wet = w.daily.filter(d => (d.popMax || 0) >= 50).map(d => DOW[dow(d.ms)]);
  const hot = w.daily.reduce((a, d) => (d.max > a.max ? d : a), w.daily[0]);
  const cold = w.daily.reduce((a, d) => (d.min < a.min ? d : a), w.daily[0]);
  return `Warmest ${DOWL[dow(hot.ms)]} at ${deg(hot.max)}, coldest night ${DOWL[dow(cold.ms)]} at ${deg(cold.min)}. ${wet.length ? `Likely rain on ${wet.join(', ')}.` : 'No day above a 50% rain chance.'}`;
}

/* ---------- DATA ---------- */
function renderData() {
  const w = S.w; if (!w) return;
  const c = w.current, h = w.hourly[0] || {}, d = w.daily[0];
  const nowM = new Date(localNow(w.off)).getUTCHours() * 60 + new Date(localNow(w.off)).getUTCMinutes();
  const rise = hourOf(d.sunrise) * 60 + new Date(d.sunrise).getUTCMinutes(), set = hourOf(d.sunset) * 60 + new Date(d.sunset).getUTCMinutes();
  const f = Math.max(0, Math.min(1, (nowM - rise) / Math.max(1, set - rise)));
  const len = set - rise, sx = 20 + 280 * f, sy = 110 - 90 * Math.sin(Math.PI * f);
  const o = w.obs, age = o ? R((Date.now() - o.at) / MIN) : null;
  const cell = (l, v, cls = '') => `<div><div class="lbl">${l}</div><div class="val ${cls}">${v}</div></div>`;
  $('#p-data').innerHTML = `<div class="wrap">
    ${panel('Telemetry', o ? 'STATION + MODEL' : 'MODEL', `<div class="qgrid">
      ${cell('Pressure', c.pressure ? R(c.pressure) + ' <small class="mono">hPa</small>' : '--')}
      ${cell('Visibility', h.visibility != null ? (h.visibility / 1000).toFixed(h.visibility < 10000 ? 1 : 0) + ' <small class="mono">km</small>' : '--')}
      ${cell('Dew point', deg(h.dew))}
      ${cell('Cloud', (c.cloudCover ?? '--') + '%')}
      ${cell('Gusts', R(c.windGusts) + ' <small class="mono">km/h</small>', c.windGusts >= 45 ? 'amber' : '')}
      ${cell('Feels', deg(c.feelsLike))}
    </div>`)}
    ${panel('Solar orbit', `${Math.floor(len / 60)}H ${len % 60}M DAYLIGHT`, `<svg viewBox="0 0 320 130" style="width:100%" role="img" aria-label="Sun position">
      <path d="M20 110 Q160 -70 300 110" fill="none" stroke="var(--ac)" stroke-opacity=".35" stroke-dasharray="3 5"/><line x1="10" y1="110" x2="310" y2="110" stroke="rgba(230,251,255,.2)"/>
      <circle cx="${sx}" cy="${sy}" r="8" fill="#ffc23d"/><text x="20" y="126" fill="var(--dim)" font-family="Share Tech Mono, monospace" font-size="11">↑ ${hm(d.sunrise)}</text>
      <text x="300" y="126" text-anchor="end" fill="var(--dim)" font-family="Share Tech Mono, monospace" font-size="11">${hm(d.sunset)} ↓</text></svg>`)}
    ${panel('Uplink status', 'SOURCES', `<p class="small">${o ? `LIVE · ${esc(o.station)} (${esc(o.source)}), ${o.distanceKm.toFixed(0)} km away, reading ${age} min old. Temperature, wind, gust, humidity and pressure are measured; the next 3 h are nudged to match.` : (OBS_ENABLED ? 'No station reading in range right now, so every number is the forecast model.' : 'Browser build: station feeds (BoM, airport METAR) block direct browser requests, so current conditions come from Open-Meteo\'s 15-minute model analysis. The Android app shows measured station readings.')}</p>
      <p class="small">Forecast: Open-Meteo best-match blend (in Australia this includes BoM ACCESS), refreshed every 30 min. Fetched ${R((Date.now() - w.fetchedAt) / MIN)} min ago.</p>
      <p class="small">${OBS_ENABLED ? 'Stations: aviationweather.gov METAR (airports). ' : ''}Air: Open-Meteo CAMS. Pollen: ${S.pollenKey ? 'Google Pollen API' : 'weather-based estimate'}.</p>
      <p class="small">Data: Open-Meteo (CC BY 4.0), NOAA Aviation Weather Center. Personal, non-commercial use.</p>`, 'full')}
  </div>`;
}

/* ---------- GOLF ---------- */
function renderGolf() {
  const gw = S.golfW; const el = $('#p-golf');
  if (!gw) { el.innerHTML = `<div class="wrap">${panel('Fairway uplink', 'ALBERT PARK', '<p class="small">Acquiring the course forecast…</p>', 'full')}</div>`; return; }
  if (!S.golfDay || !dayOf(gw, S.golfDay)) S.golfDay = Golf.defaultDay(gw);
  const gd = Golf.day(gw, S.golfDay);
  let slot = gd.windows.find(x => x.tee === S.golfSlot) || gd.best; S.golfSlot = slot ? slot.tee : null;
  const lines = Caddie.dayLines(gd);
  const tees = gd.windows.map(t => `<button class="tee ${t === gd.best ? 'best' : ''}" style="border-color:color-mix(in srgb,${scoreCol(t.score)} 45%,transparent)" data-tee="${t.tee}" aria-pressed="${t === slot}"><span>${hm(t.tee)}</span><b style="color:${scoreCol(t.score)}">${t.score}</b></button>`).join('');
  const tabs = ['BRIEF', 'SCORE', 'FLIGHT', 'SHEET'].map(t => `<button data-gtab="${t}" aria-pressed="${S.golfTab === t}">${t}</button>`).join('');
  let body = '';
  if (!slot && S.golfTab !== 'SHEET') body = panel('No tee window', '--', `<p class="small">${esc(Caddie.banter(gd))}</p>`, 'full');
  else if (S.golfTab === 'BRIEF') body = panel(`Fairway uplink // transmission`, `${hm(slot.tee)} TEE`, `<div class="comms" id="gcomms"></div>`, 'full') + summary(slot);
  else if (S.golfTab === 'SCORE') body = summary(slot) + breakdown(slot);
  else if (S.golfTab === 'FLIGHT') body = flight(slot);
  else body = sheet(gd);
  const dLabel = gd.date === dkey(gw.current.time) ? 'TODAY' : DOWL[dow(T(gd.date + 'T00:00'))].toUpperCase();
  el.innerHTML = `<div class="wrap">
    ${panel(COURSE.name, COURSE.region.toUpperCase(), `<p class="small">Course forecast is always for Albert Park, whatever place is on CORE. ${gw.obs ? `Live: ${esc(gw.obs.station)} ${R((Date.now() - gw.obs.at) / MIN)} min ago.` : ''}</p>`, 'full')}
    <div class="full chips" data-chips="golf">${gw.daily.slice(0, 7).map((d, i) => { const b = Golf.day(gw, d.date).best;
      return `<button class="chip" data-day="${d.date}" aria-pressed="${d.date === gd.date}"><span>${i === 0 ? 'TODAY' : DOW[dow(d.ms)] + ' ' + Number(d.date.slice(8))}</span><span class="t" style="color:${b ? scoreCol(b.score) : 'var(--faint)'}">${b ? b.score : '--'}</span></button>`; }).join('')}</div>
    <div class="full lbl">${dLabel} · ${gd.windows.length} TEE WINDOWS · 4 H ROUND</div>
    <div class="full tees">${tees || '<span class="small">No daylight tee times left.</span>'}</div>
    <div class="full tabs">${tabs}</div>
    ${body}
  </div>`;
  if (S.golfTab === 'BRIEF' && slot) typewrite($('#gcomms'), [{ tag: 'G-COMM', text: lines[slot.tee] || Caddie.banter(gd), serious: slot.storm }]);
}
function summary(t) {
  return panel('Playability', `GRADE ${Golf.grade(t.score)}`, `<div style="display:flex;gap:16px;align-items:center">
    <div class="big" style="color:${scoreCol(t.score)}">${t.score}<small class="mono" style="font-size:16px;color:var(--faint)">/100</small></div>
    <div class="small">${hm(t.tee)}–${hm(t.tee + 4 * HOUR)} · ${deg(t.tMin)}–${deg(t.tMax)}<br>Wind ${R(t.wind)} km/h ${compass16(t.dir)} · gust ${R(t.gust)}<br>Rain ${t.pop}% · ${f1(t.mm)} mm · UV ${R(t.uv)}<br>Main limiter: <span class="amber">${t.limiter}</span></div></div>
    <p class="small" style="margin:10px 0 0">The score is playability for a 4-hour round from this tee time: 100 minus penalties for lightning, rain, wind, heat or cold and UV. Not a chance of rain.</p>`);
}
function breakdown(t) {
  const rows = t.deductions.map(d => `<div class="ded"><span>${d.label}</span><div class="bar"><i style="left:0;width:${Math.max(2, Math.min(100, d.points / 80 * 100))}%;background:${d.points >= 15 ? 'var(--amber)' : 'var(--ac)'}"></i></div><span class="amber" style="text-align:right">−${d.points}</span></div><div class="small" style="margin:-2px 0 4px 104px">${esc(d.detail)}</div>`).join('');
  return panel(`How ${t.score} is calculated`, 'G-02', `<div class="ded"><span>START</span><span class="small">perfect conditions</span><span style="text-align:right">100</span></div>${rows || '<p class="small">No deductions. Suspicious.</p>'}
    <div class="ded" style="border-top:1px solid var(--faint);margin-top:6px;padding-top:8px"><span>SCORE</span><span class="small">A ≥85 · B ≥70 · C ≥55 · D ≥40 · F</span><span style="text-align:right;color:${scoreCol(t.score)}">${t.score}</span></div>`);
}
function flight(t) {
  const temp = isNaN(t.tMin) ? NaN : (t.tMin + t.tMax) / 2;
  const rows = Flight.table(t.wind, temp), gusts = Flight.table(t.gust, temp), [into, down] = Golf.clubAdjust(t.wind), carry = Golf.carryDelta(temp);
  const d = rows[0], maxC = Math.max(d.down, d.base);
  const arc = (c, apex, col) => { const len = 300 * c / maxC; return `<path d="M0 100 Q${(len * 0.55).toFixed(1)} ${100 - apex * 2} ${len.toFixed(1)} 100" stroke="${col}"/><circle r="4" fill="${col}"><animateMotion dur="2.6s" repeatCount="indefinite" path="M0 100 Q${(len * 0.55).toFixed(1)} ${100 - apex * 2} ${len.toFixed(1)} 100"/></circle>`; };
  const lefty = S.hand === 'L', from = compass16(t.dir).toUpperCase();
  const notes = `Wind from ${from}. For a ${lefty ? 'left-hander' : 'right-hander'}, a left-to-right wind (from your left at address) feeds ${lefty ? 'a draw' : 'the slice'}; right-to-left (from your right) feeds ${lefty ? 'the slice' : 'a draw'}. Into a slice wind, aim into it and let it ride back. On a hole playing toward the ${from}, you're into it: tee it lower, club up, swing smoother.`;
  return panel(`Ball flight // ${hm(t.tee)}`, 'G-03', `<div class="readouts"><div><div class="lbl">Into wind</div><div class="val amber">+${Golf.clubs(into)} club</div></div>
      <div><div class="lbl">Downwind</div><div class="val good">−${Golf.clubs(down)} club</div></div><div><div class="lbl">Temp carry</div><div class="val">${carry >= 0 ? '+' : '−'}${Math.abs(carry)} m</div></div></div>
      <svg class="traj" viewBox="0 0 310 110" style="width:100%;margin-top:10px" role="img" aria-label="Driver trajectory calm, into and downwind"><line x1="0" y1="100" x2="310" y2="100" stroke="var(--ac)" stroke-opacity=".3"/>${arc(d.base, 36, '#e6fbff')}${arc(d.into, 44, '#ffb547')}${arc(d.down, 30, '#3dff9a')}</svg>
      <div class="small">● CALM <span class="amber">● INTO</span> <span class="good">● DOWN</span> · DRIVER CARRY</div>`)
    + panel('Carry table // metres', 'G-05', `<table><thead><tr><th>CLUB</th><th>CALM</th><th>INTO</th><th>DOWN</th><th>X-DRIFT</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r.club}</td><td class="n" style="color:var(--dim)">${r.base}</td><td class="n amber">${r.into}</td><td class="n good">${r.down}</td><td class="n ac">±${r.drift}</td></tr>`).join('')}</tbody></table>
      <p class="small ${t.gust >= 40 ? 'amber' : ''}">Gusts ${R(t.gust)} km/h: driver into ${gusts[0].into} m · drift ±${gusts[0].drift} m.</p><p class="small">Baseline = mid-handicap calm-air carry at 21°C. Rules of thumb: −1%/mph into, +0.5%/mph down, 0.5%/mph cross drift.</p>`)
    + panel(lefty ? 'Lefty notes' : 'Righty notes', 'G-06', `<div class="hand"><span class="lbl" style="flex:1">Player</span><button data-hand="L" aria-pressed="${lefty}">LEFT-HANDED</button><button data-hand="R" aria-pressed="${!lefty}">RIGHT-HANDED</button></div><p class="small">${esc(notes)}</p>`, 'full');
}
function sheet(gd) {
  return panel('Tee sheet', `${gd.windows.length} SLOTS`, `<table class="stack"><thead><tr><th>TEE</th><th>SCORE</th><th>TEMP</th><th>RAIN</th><th>WIND</th><th>LIMIT</th></tr></thead><tbody>${gd.windows.map(t => `<tr data-tee="${t.tee}"><td>${hm(t.tee)}</td><td class="n" style="color:${scoreCol(t.score)}">${t.score}</td><td>${deg(t.tMin)}–${deg(t.tMax)}</td><td>${t.pop}%</td><td>${R(t.wind)}/${R(t.gust)}</td><td class="amber">${t.limiter}</td></tr>`).join('')}</tbody></table>`, 'full');
}

/* ---------- AIR ---------- */
function renderAir() {
  const w = S.w; if (!w) return;
  const q = S.air, pollen = S.pollen && S.pollenKey ? S.pollen : Air.estimate(w);
  const aqi = q ? q.usAqi : null;
  const aqiPanel = panel('Air quality', q ? 'US AQI' : 'NO DATA', q ? `<div style="display:flex;gap:16px;align-items:center"><div class="big" style="color:${aqi <= 50 ? 'var(--good)' : aqi <= 100 ? 'var(--amber)' : 'var(--alert)'}">${aqi ?? '--'}</div>
      <div class="small">${aqi != null ? Air.aqi(aqi) : ''}<br>PM2.5 ${q.pm25 != null ? f1(q.pm25) : '--'} µg/m³<br>PM10 ${q.pm10 != null ? f1(q.pm10) : '--'} µg/m³<br>O₃ ${q.ozone != null ? R(q.ozone) : '--'} µg/m³</div></div>
      <div class="chips" style="margin-top:10px">${Object.entries(q.dailyMax).slice(0, 5).map(([d, v]) => `<div class="chip"><span>${DOW[dow(T(d + 'T00:00'))]}</span><span class="t" style="color:${v <= 50 ? 'var(--good)' : v <= 100 ? 'var(--amber)' : 'var(--alert)'}">${v}</span></div>`).join('')}</div>` : '<p class="small">Air quality unavailable right now.</p>');
  const prow = d => `<tr><td>${DOW[dow(T(d.date + 'T00:00'))]}</td><td class="n">${d.grass != null ? f1(d.grass) : '—'}</td><td class="n">${d.tree != null ? f1(d.tree) : '—'}</td><td class="n">${d.weed != null ? f1(d.weed) : '—'}</td><td class="${Air.peak(d) >= 3.5 ? 'amber' : ''}">${Air.upi(Air.peak(d))}${d.asthma ? ' <span class="alert">· STORM ASTHMA</span>' : ''}</td></tr>`;
  const pollenPanel = panel('Pollen', pollen.source === 'GOOGLE' ? 'GOOGLE UPI 0–5' : 'ESTIMATE', `<table><thead><tr><th>DAY</th><th>GRASS</th><th>TREE</th><th>WEED</th><th>LEVEL</th></tr></thead><tbody>${pollen.days.map(prow).join('')}</tbody></table>${pollen.note ? `<p class="small">${esc(pollen.note)}</p>` : ''}`);
  const keyPanel = panel('Pollen uplink', 'CFG', S.pollenKey
    ? `<div class="keyrow"><span class="small" style="flex:1">KEY ••••${esc(S.pollenKey.slice(-4))} · stored only in this browser</span><button class="txt" id="keyClear">[REMOVE]</button></div>${S.pollenError ? `<p class="small alert">${esc(S.pollenError)}</p>` : ''}`
    : `<p class="small">Open-Meteo has no pollen data outside Europe. For a measured grass + tree index, paste a Google Maps Platform key with the Pollen API enabled. Restrict it to this site's address in Google Cloud Console.</p>
       <div class="keyrow"><input id="keyIn" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="AIza…" maxlength="64"><button class="txt" id="keySave">[SAVE]</button></div>${S.pollenError ? `<p class="small alert">${esc(S.pollenError)}</p>` : ''}`, 'full');
  $('#p-air').innerHTML = `<div class="wrap">${aqiPanel}${pollenPanel}${keyPanel}</div>`;
}

/* ---------- chrome ---------- */
function renderTop() {
  const w = S.w;
  const name = S.place ? S.place.name : 'SKYFALL';
  if ($('#placeName').dataset.v !== name) { $('#placeName').dataset.v = name; decode($('#placeName'), name.toUpperCase()); }
  if (!w) return;
  const lat = S.place ? S.place.lat : w.lat, lon = S.place ? S.place.lon : w.lon;
  $('#coords').textContent = `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}${S.place && S.place.gps ? ' · GPS' : ''}`;
  const clock = new Date(localNow(w.off)).toISOString().slice(11, 19);
  const o = w.obs;
  $('#dot').classList.toggle('model', !o);
  $('#liveLabel').textContent = o ? `LIVE · ${clock} · OBS ${o.station.toUpperCase().slice(0, 22)} T-${R((Date.now() - o.at) / MIN)}M` : `MODEL · ${clock} · SYNC T+${R((Date.now() - w.fetchedAt) / MIN)}M`;
}
function decode(el, text) {
  if (reduce) { el.textContent = text; return; }
  const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&';
  let f = 0; const id = ++decode.n;
  const step = () => { if (id !== decode.n) return; f++; el.textContent = text.split('').map((ch, i) => (i < f / 2 || ch === ' ' ? ch : glyphs[Math.random() * glyphs.length | 0])).join(''); if (f / 2 < text.length) setTimeout(step, 30); };
  step();
}
decode.n = 0;
function renderDock() {
  $('#dock').innerHTML = TABS.map(([l], i) => `<button data-tab="${i}" aria-current="${S.tab === i}">${l}<small>0${i + 1}</small></button>`).join('');
}
function applyTheme() {
  const w = S.w; if (!w) return;
  const n = new Date(localNow(w.off)), minute = n.getUTCHours() * 60 + n.getUTCMinutes();
  const d = w.daily[0], rise = hourOf(d.sunrise) * 60 + new Date(d.sunrise).getUTCMinutes(), set = hourOf(d.sunset) * 60 + new Date(d.sunset).getUTCMinutes();
  const sky = Codes.sky(w.current.code);
  document.documentElement.style.setProperty('--ac', themeAccent(minute, rise, set, w.current.temperature, sky));
  Scene.set({ sky, minute, rise, set, wind: w.current.windSpeed, moon: moonPhase(Date.now()) });
  $('#ambTemp').textContent = deg(w.current.temperature);
  $('#ambSky').textContent = Codes.label(w.current.code).toUpperCase() + (w.obs ? ' · LIVE' : '');
  $('#ambClock').textContent = n.toISOString().slice(11, 16) + ' · ' + (S.place ? S.place.name.toUpperCase() : '');
}
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
    await quiet(() => Repo.refreshForecast(COURSE.lat, COURSE.lon, 60 * MIN));
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
    $('#useGps').textContent = '◎ USE MY LOCATION';
    const lat = pos.coords.latitude, lon = pos.coords.longitude;
    let name = 'Current location', region = '';
    try {
      const g = await getJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&localityLanguage=en`);
      name = g.locality || g.city || name; region = [g.principalSubdivision, g.countryName].filter(Boolean).join(', ');
    } catch { }
    setPlace({ name, region, lat: round2(lat), lon: round2(lon), gps: true });
  }, err => {
    $('#useGps').textContent = '◎ USE MY LOCATION';
    toast(err.code === 1 ? 'Location permission denied. Search for a place instead.' : "Couldn't get your location. Search for a place instead.");
    if (!fromSearch && !S.place) openSearch();
  }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * MIN });
}

/* ---------- events ---------- */
$('#btnSearch').addEventListener('click', openSearch);
$('#searchClose').addEventListener('click', () => { if (S.place) closeSearch(); });
$('#btnAmbient').addEventListener('click', () => { document.body.classList.add('amb'); $('#ambient').hidden = false; });
$('#ambClose').addEventListener('click', () => { document.body.classList.remove('amb'); $('#ambient').hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#search').hidden && S.place) closeSearch(); if (!$('#ambient').hidden) $('#ambClose').click(); } });

const pager = $('#pager');
function goTab(i, smooth = true) { S.tab = i; pager.scrollTo({ left: i * pager.clientWidth, behavior: smooth && !reduce ? 'smooth' : 'auto' }); renderDock(); try { history.replaceState(null, '', '#' + TABS[i][0].toLowerCase()); } catch { } }
$('#dock').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) goTab(+b.dataset.tab); });
let scrollT; pager.addEventListener('scroll', () => { clearTimeout(scrollT); scrollT = setTimeout(() => { const i = Math.round(pager.scrollLeft / pager.clientWidth); if (i !== S.tab) { S.tab = i; renderDock(); } }, 80); }, { passive: true });
addEventListener('resize', () => goTab(S.tab, false));
document.addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; if (e.key === 'ArrowRight') goTab(Math.min(5, S.tab + 1)); if (e.key === 'ArrowLeft') goTab(Math.max(0, S.tab - 1)); });

document.body.addEventListener('click', e => {
  const t = e.target;
  const day = t.closest('[data-day]');
  if (day) { const which = day.closest('[data-chips]').dataset.chips; if (which === 'core') { S.coreDay = day.dataset.day; renderCore(); } else { S.golfDay = day.dataset.day; S.golfSlot = null; renderGolf(); } return; }
  const go = t.closest('[data-go]'); if (go) { goTab(+go.dataset.go); return; }
  const tee = t.closest('[data-tee]'); if (tee) { S.golfSlot = +tee.dataset.tee; if (tee.tagName === 'TR') S.golfTab = 'BRIEF'; renderGolf(); return; }
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
  const lines = ['SKYFALL // ATMOS-7 WEB LINK', '> HANDSHAKE ........ OK', '> OPEN-METEO ....... LINKED', '> FAIRWAY UPLINK ... ARMED'];
  const bl = $('.boot-lines'); let i = 0;
  await new Promise(res => { const step = () => { if (i >= lines.length || reduce) { bl.textContent = lines.join('\n'); return res(); } bl.textContent = lines.slice(0, ++i).join('\n'); setTimeout(step, 160); }; step(); });
  setTimeout(() => $('#boot').classList.add('gone'), reduce ? 0 : 300);
  const h = location.hash.slice(1).toUpperCase(), ti = TABS.findIndex(t => t[0] === h);
  loadFromCache(); renderAll();
  if (ti > 0) requestAnimationFrame(() => goTab(ti, false));
  if (!S.place) { locate(false); openSearch(); } else refresh(false);
  setInterval(() => { if (!document.hidden) { renderTop(); applyTheme(); refresh(false); } }, 60000);
  setInterval(() => { if (!document.hidden) renderTop(); }, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(false); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
}
boot();
}
