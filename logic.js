/* Skyfall web — data layer and forecast logic (ported from the Android app). */
'use strict';

const Store = {
  get(k, d) { try { const v = localStorage.getItem('sf:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sf:' + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem('sf:' + k); } catch { } },
};

/** BoM refuses browser requests, so a GitHub Actions job republishes the same station readings as obs.json beside the site. */
const OBS_ENABLED = true;
const COURSE = { name: 'Albert Park Golf Course', region: 'Melbourne VIC', lat: -37.845, lon: 144.972 };
const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR, SLOT = 15 * MIN;
const slotStart = (now = Date.now()) => now - now % SLOT;
/** Forecast points snap to a 0.05° (~5 km) grid, the same in the Android app, so both ask Open-Meteo for the same point. */
const round2 = v => Math.round(v * 20) / 20;
const placeKey = (lat, lon) => `${round2(lat).toFixed(2)},${round2(lon).toFixed(2)}`;
const R = x => Math.round(x);
const f1 = x => (Math.round(x * 10) / 10).toFixed(1);
const fmod = (a, n) => ((a % n) + n) % n;

/* ---------- rate budget: refuses work before a provider's free limit ---------- */
const Quota = {
  limits: { 'open-meteo': [60, 600, 3000], metar: [20, 120, 1000], 'google-pollen': [5, 10, 40] },
  acquire(api) {
    const now = Date.now();
    const hits = (Store.get('quota:' + api, [])).filter(t => now - t < DAY);
    const [m, h, d] = this.limits[api] || [30, 200, 1000];
    if (hits.filter(t => now - t < MIN).length >= m || hits.filter(t => now - t < HOUR).length >= h || hits.length >= d)
      throw new Error(`Rate budget for ${api} spent; using cached data`);
    hits.push(now);
    Store.set('quota:' + api, hits);
  },
};

async function getJSON(url, headers, attempt = 0) {
  try { return await getOnce(url, headers); }
  catch (e) { if (attempt < 1 && (e.name === 'AbortError' || e.name === 'TypeError')) return getJSON(url, headers, attempt + 1); throw e.name === 'AbortError' ? new Error('Request timed out') : e; }
}
async function getOnce(url, headers) {
  if (!url.startsWith('https://') && !url.startsWith(location.origin + '/')) throw new Error('Refusing non-HTTPS request');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: headers || {}, cache: 'no-store' });
    const text = await res.text();
    if (text.length > 2 * 1024 * 1024) throw new Error('Response too large');
    let body = null;
    try { body = JSON.parse(text); } catch { }
    if (!res.ok) throw new Error(((body && (body.reason || (body.error && body.error.message))) || 'HTTP ' + res.status).slice(0, 200));
    return body;
  } finally { clearTimeout(timer); }
}

/* ---------- local-time helpers: Open-Meteo times are naive local strings; we keep them as "naive ms" ---------- */
const T = s => { const [d, t] = s.split('T'); const [y, m, dd] = d.split('-').map(Number); const [h, mi] = (t || '00:00').split(':').map(Number); return Date.UTC(y, m - 1, dd, h, mi); };
const dkey = ms => new Date(ms).toISOString().slice(0, 10);
const hm = ms => new Date(ms).toISOString().slice(11, 16);
const hourOf = ms => new Date(ms).getUTCHours();
const dow = ms => new Date(ms).getUTCDay();
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const localNow = off => Date.now() + off * 1000;

/* ---------- WMO codes ---------- */
const Codes = {
  sky(c) {
    if (c === 0 || c === 1) return 'CLEAR';
    if (c === 2) return 'PARTLY';
    if (c === 3) return 'CLOUDY';
    if (c === 45 || c === 48) return 'FOG';
    if ([51, 53, 55, 56, 57].includes(c)) return 'DRIZZLE';
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(c)) return 'RAIN';
    if ([71, 73, 75, 77, 85, 86].includes(c)) return 'SNOW';
    if ([95, 96, 99].includes(c)) return 'STORM';
    return 'CLOUDY';
  },
  label(c) {
    return ({ 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Light showers', 81: 'Showers', 82: 'Violent showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail' })[c] || 'Unknown';
  },
};

/* ---------- Open-Meteo ---------- */
const OM = {
  CURRENT: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
  HOURLY: 'temperature_2m,precipitation_probability,weather_code,is_day,visibility,uv_index,dew_point_2m,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,relative_humidity_2m,apparent_temperature,cloud_cover,pressure_msl',
  DAILY: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max',
  forecastUrl(lat, lon) {
    return `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&current=${this.CURRENT}&hourly=${this.HOURLY}&daily=${this.DAILY}&timezone=auto&forecast_days=10&wind_speed_unit=kmh`;
  },
  airUrl(lat, lon) {
    return `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&current=us_aqi,pm2_5,pm10,ozone&hourly=us_aqi&timezone=auto&forecast_days=5`;
  },
  async search(q) {
    const j = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q.trim())}&count=12&language=en&format=json`);
    return (j.results || []).map(r => ({ name: r.name, region: [r.admin1, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude }));
  },
  parse(j, fetchedAt) {
    if (!j || j.error) throw new Error((j && j.reason) || 'Forecast error');
    const c = j.current;
    const current = {
      time: T(c.time), temperature: c.temperature_2m, feelsLike: c.apparent_temperature, humidity: c.relative_humidity_2m,
      isDay: c.is_day === 1, precipitation: c.precipitation || 0, code: c.weather_code, cloudCover: c.cloud_cover,
      pressure: c.pressure_msl, windSpeed: c.wind_speed_10m || 0, windDirection: c.wind_direction_10m || 0, windGusts: c.wind_gusts_10m || 0,
    };
    const h = j.hourly, v = (k, i, d = null) => (h[k] && h[k][i] != null ? h[k][i] : d);
    const startHour = current.time - (current.time % HOUR);
    const hourly = h.time.map((t, i) => ({
      time: T(t), temperature: v('temperature_2m', i, NaN), pop: v('precipitation_probability', i), code: v('weather_code', i, 3),
      isDay: v('is_day', i, 1) === 1, visibility: v('visibility', i), uv: v('uv_index', i), dew: v('dew_point_2m', i),
      precip: v('precipitation', i, 0), wind: v('wind_speed_10m', i, 0), gust: v('wind_gusts_10m', i, 0), dir: v('wind_direction_10m', i, 0),
      humidity: v('relative_humidity_2m', i), apparent: v('apparent_temperature', i), cloud: v('cloud_cover', i), pressure: v('pressure_msl', i),
    })).filter(x => x.time >= startHour);
    const d = j.daily, dv = (k, i) => (d[k] && d[k][i] != null ? d[k][i] : null);
    const today = dkey(current.time);
    const daily = d.time.map((t, i) => ({
      date: t, ms: T(t + 'T00:00'), code: dv('weather_code', i) ?? 3, max: dv('temperature_2m_max', i) ?? NaN, min: dv('temperature_2m_min', i) ?? NaN,
      sunrise: T(d.sunrise[i]), sunset: T(d.sunset[i]), uvMax: dv('uv_index_max', i), popMax: dv('precipitation_probability_max', i),
      precipSum: dv('precipitation_sum', i), windMax: dv('wind_speed_10m_max', i), gustMax: dv('wind_gusts_10m_max', i),
    })).filter(x => x.date >= today);
    return { current, hourly, daily, fetchedAt, off: j.utc_offset_seconds || 0, lat: j.latitude, lon: j.longitude, obs: null };
  },
  parseAir(j) {
    const c = j.current || {}, daily = {};
    if (j.hourly) j.hourly.time.forEach((t, i) => { const a = j.hourly.us_aqi[i]; if (a == null) return; const k = t.slice(0, 10); daily[k] = Math.max(daily[k] || 0, Math.round(a)); });
    return { usAqi: c.us_aqi != null ? Math.round(c.us_aqi) : null, pm25: c.pm2_5, pm10: c.pm10, ozone: c.ozone, dailyMax: daily };
  },
};

const today = w => w.daily[0];
const dayOf = (w, date) => w.daily.find(d => d.date === date);

/** The forecast re-centred on another day (midday becomes "now"); obs only applies to today. */
function forDay(w, date) {
  if (date === dkey(w.current.time)) return w;
  const day = dayOf(w, date); if (!day) return w;
  const noon = T(date + 'T12:00');
  const h = w.hourly.find(x => x.time >= noon); if (!h) return w;
  const c = { time: h.time, temperature: h.temperature, feelsLike: h.apparent ?? h.temperature, humidity: h.humidity ?? w.current.humidity, isDay: h.isDay,
    precipitation: h.precip, code: day.code, cloudCover: h.cloud ?? w.current.cloudCover, pressure: h.pressure ?? NaN, windSpeed: h.wind, windDirection: h.dir, windGusts: h.gust };
  const from = T(date + 'T06:00');
  return { ...w, current: c, hourly: w.hourly.filter(x => x.time >= from), daily: w.daily.filter(x => x.date >= date), obs: null };
}

/* ---------- live station readings (METAR, worldwide) ---------- */
const Obs = {
  distanceKm(a, b, c, d) {
    const r = 6371, rad = x => x * Math.PI / 180, dLat = rad(c - a), dLon = rad(d - b);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLon / 2) ** 2;
    return 2 * r * Math.asin(Math.sqrt(s));
  },
  url(lat, lon) {
    return `https://aviationweather.gov/api/data/metar?bbox=${(lat - 0.6).toFixed(2)},${(lon - 0.75).toFixed(2)},${(lat + 0.6).toFixed(2)},${(lon + 0.75).toFixed(2)}&format=json`;
  },
  parse(arr, lat, lon) {
    const now = Date.now();
    const best = (arr || []).filter(o => o.temp != null && now - o.obsTime * 1000 < 2 * HOUR)
      .sort((a, b) => this.distanceKm(lat, lon, a.lat, a.lon) - this.distanceKm(lat, lon, b.lat, b.lon))[0];
    if (!best) throw new Error('No station reporting nearby');
    const es = x => Math.exp(17.625 * x / (243.04 + x));
    const t = best.temp, dew = best.dewp;
    if (t < -90 || t > 65) throw new Error('Implausible station reading');
    return {
      source: 'METAR', station: String(best.name || best.icaoId || 'Station').split(',')[0], lat: best.lat, lon: best.lon,
      at: best.obsTime * 1000, temperature: t, apparent: null,
      humidity: dew != null ? Math.max(0, Math.min(100, Math.round(100 * es(dew) / es(t)))) : null,
      wind: best.wspd != null ? best.wspd * 1.852 : null, dir: typeof best.wdir === 'number' ? best.wdir : null,
      gust: best.wgst != null ? best.wgst * 1.852 : null, pressure: best.altim ?? null,
      distanceKm: this.distanceKm(lat, lon, best.lat, best.lon),
    };
  },
  /** Open-Meteo is the only source for the numbers; a fresh nearby BoM reading rides along as metadata. */
  merge(w, o) {
    if (!w) return w;
    if (!o || Date.now() - o.at > 75 * MIN || o.distanceKm > 50 || o.temperature == null) return { ...w, obs: null };
    return { ...w, obs: o };
  },
};

/* ---------- repository: last good copy per layer, network only when stale ---------- */
const Repo = {
  snap(layer, lat, lon) { return Store.get(`snap:${layer}:${placeKey(lat, lon)}`, null); },
  put(layer, lat, lon, body) { Store.set(`snap:${layer}:${placeKey(lat, lon)}`, { at: Date.now(), body }); },
  /** Forecasts refresh on fixed 15-minute slots (:00 :15 :30 :45), the same rule as Android, so both hold the same Open-Meteo copy. */
  fresh(layer, lat, lon, maxAge) { const s = this.snap(layer, lat, lon); if (!s || Date.now() - s.at >= maxAge) return false; return layer !== 'fc' || s.at >= slotStart(); },
  async refresh(layer, lat, lon, maxAge, api, url, validate, headers) {
    if (this.fresh(layer, lat, lon, maxAge)) return false;
    Quota.acquire(api);
    const body = await getJSON(url, headers);
    if (validate) validate(body);
    this.put(layer, lat, lon, body);
    return true;
  },
  forecast(lat, lon) { const s = this.snap('fc', lat, lon); if (!s) return null; try { return OM.parse(s.body, s.at); } catch { return null; } },
  air(lat, lon) { const s = this.snap('air', lat, lon); if (!s) return null; try { return OM.parseAir(s.body); } catch { return null; } },
  obs(lat, lon) { const s = this.snap('obs', lat, lon); return s ? s.body : null; },
  pollen(lat, lon) { const s = this.snap('pollen', lat, lon); if (!s) return null; try { return Air.parsePollen(s.body); } catch { return null; } },
  refreshForecast(lat, lon, maxAge) {
    return this.refresh('fc', lat, lon, maxAge, 'open-meteo', OM.forecastUrl(round2(lat), round2(lon)), b => {
      const w = OM.parse(b, Date.now()); const t = w.current.temperature;
      if (!(t > -90 && t < 65) || !w.hourly.length || !w.daily.length) throw new Error('Implausible forecast rejected');
    });
  },
  refreshAir(lat, lon, maxAge) { return this.refresh('air', lat, lon, maxAge, 'open-meteo', OM.airUrl(round2(lat), round2(lon)), b => OM.parseAir(b)); },
  async refreshObs(lat, lon, maxAge) {
    if (this.fresh('obs', lat, lon, maxAge)) return false;
    const j = await getJSON(new URL('obs.json', location.href).href + '?t=' + Math.floor(Date.now() / MIN));
    const now = Date.now();
    const best = (j.stations || []).filter(o => now - o.at < 2 * HOUR)
      .map(o => ({ ...o, distanceKm: Obs.distanceKm(lat, lon, o.lat, o.lon) })).filter(o => o.distanceKm <= 60)
      .sort((a, b) => a.distanceKm - b.distanceKm)[0];
    if (!best) throw new Error('No live station nearby');
    this.put('obs', lat, lon, best);
    return true;
  },
  refreshPollen(lat, lon, key, maxAge) {
    const url = `https://pollen.googleapis.com/v1/forecast:lookup?location.latitude=${round2(lat)}&location.longitude=${round2(lon)}&days=5&plantsDescription=false&languageCode=en&key=${encodeURIComponent(key)}`;
    return this.refresh('pollen', lat, lon, maxAge, 'google-pollen', url, b => Air.parsePollen(b));
  },
};

/* ---------- air + pollen ---------- */
const Air = {
  upi(v) { return v < 0.5 ? 'NONE' : v < 1.5 ? 'VERY LOW' : v < 2.5 ? 'LOW' : v < 3.5 ? 'MODERATE' : v < 4.5 ? 'HIGH' : 'VERY HIGH'; },
  aqi(v) { return v <= 50 ? 'GOOD' : v <= 100 ? 'MODERATE' : v <= 150 ? 'SENSITIVE GROUPS' : v <= 200 ? 'UNHEALTHY' : v <= 300 ? 'VERY UNHEALTHY' : 'HAZARDOUS'; },
  parsePollen(j) {
    const info = j.dailyInfo; if (!info) throw new Error('No pollen data for this location');
    const days = info.map(d => {
      const types = d.pollenTypeInfo || [];
      const idx = code => { const t = types.find(x => x.code === code); return t ? (t.indexInfo ? t.indexInfo.value || 0 : 0) : null; };
      const date = `${d.date.year}-${String(d.date.month).padStart(2, '0')}-${String(d.date.day).padStart(2, '0')}`;
      return { date, grass: idx('GRASS'), tree: idx('TREE'), weed: idx('WEED'), asthma: false };
    });
    return { source: 'GOOGLE', days };
  },
  /** Weather-driven grass-pollen proxy; flags thunderstorm-asthma conditions (a Melbourne hazard). */
  estimate(w) {
    const south = w.lat < 0;
    const days = w.daily.slice(0, 6).map(d => {
      let m = Number(d.date.slice(5, 7)); if (!south) m = (m + 5) % 12 + 1;
      const season = ({ 9: 0.35, 10: 0.75, 11: 1.0, 12: 0.85, 1: 0.45, 2: 0.2 })[m] ?? 0.08;
      const warm = isNaN(d.max) ? 0.3 : Math.max(0, Math.min(1, (d.max - 16) / 14));
      const windy = Math.max(0, Math.min(1, ((d.windMax ?? 10) - 8) / 25));
      const wash = Math.max(0, Math.min(0.85, (d.precipSum ?? 0) / 6));
      const score = season * (0.35 + 0.4 * warm + 0.25 * windy) * (1 - wash);
      return { date: d.date, grass: Math.max(0, Math.min(5, score * 5)), tree: null, weed: null, asthma: d.code >= 95 && d.code <= 99 && season >= 0.7 };
    });
    return { source: 'ESTIMATE', days, note: 'Modelled from weather — add a Google Pollen key for a measured index' };
  },
  peak(p) { return Math.max(0, ...[p.grass, p.tree, p.weed].filter(x => x != null)); },
};

/* ---------- golf ---------- */
const Golf = {
  ROUND: 4,
  defaultDay(w) { const t = w.current.time; const add = (6 - dow(t) + 7) % 7; return dkey(t + add * DAY); },
  window(hours) {
    if (!hours.length) return null;
    const temps = hours.map(h => h.temperature).filter(x => !isNaN(x));
    const tMin = temps.length ? Math.min(...temps) : NaN, tMax = temps.length ? Math.max(...temps) : NaN;
    const wind = hours.reduce((a, h) => a + h.wind, 0) / hours.length;
    const gust = Math.max(...hours.map(h => h.gust));
    const pop = Math.max(...hours.map(h => h.pop || 0));
    const mm = hours.reduce((a, h) => a + h.precip, 0);
    const uv = Math.max(...hours.map(h => h.uv || 0));
    const storm = hours.some(h => h.code >= 95 && h.code <= 99);
    const raw = [];
    if (storm) raw.push(['LIGHTNING', 80, 'storm cells in the window']);
    raw.push(['RAIN', pop * 0.35 + Math.min(30, mm * 8), `${pop}% chance · ${f1(mm)} mm`]);
    const sus = wind < 10 ? 0 : wind < 20 ? (wind - 10) * 1.5 : wind < 35 ? 15 + (wind - 20) * 2 : 45 + (wind - 35) * 1.5;
    raw.push(['WIND', sus + Math.max(0, gust - 40) * 0.6, `avg ${R(wind)} km/h · gust ${R(gust)}`]);
    const heat = isNaN(tMax) ? 0 : Math.max(0, tMax - 27) * 3 + Math.max(0, tMax - 33) * 4;
    const cold = isNaN(tMin) ? 0 : Math.max(0, 16 - tMin) * 2.2;
    if (heat >= cold) raw.push(['HEAT', heat, `peak ${isNaN(tMax) ? '--' : R(tMax)}° (ideal ≤27°)`]);
    else raw.push(['COLD', cold, `low ${R(tMin)}° (ideal ≥16°)`]);
    if (uv >= 8) raw.push(['UV', 4, `UV ${R(uv)}`]);
    const deductions = raw.map(([label, p, detail]) => ({ label, points: R(p), detail })).filter(d => d.points > 0);
    const score = Math.max(0, Math.min(100, 100 - deductions.reduce((a, d) => a + d.points, 0)));
    const worst = deductions.slice().sort((a, b) => b.points - a.points)[0];
    return { tee: hours[0].time, score, tMin, tMax, wind, gust, dir: hours[hours.length >> 1].dir, pop, mm, uv, storm,
      limiter: worst && worst.points >= 6 ? worst.label : 'NONE', deductions };
  },
  day(w, date) {
    const d = dayOf(w, date); if (!d) return { date, windows: [], best: null };
    const first = d.sunrise + 30 * MIN - ((d.sunrise + 30 * MIN) % HOUR);
    const last = d.sunset - this.ROUND * HOUR;
    const nowH = w.current.time - (w.current.time % HOUR);
    const windows = [];
    w.hourly.forEach((h, i) => {
      if (dkey(h.time) !== date || h.time < first || h.time > last || h.time < nowH) return;
      const win = this.window(w.hourly.slice(i, i + this.ROUND)); if (win) windows.push(win);
    });
    const best = windows.reduce((b, x) => (!b || x.score > b.score ? x : b), null);
    return { date, windows, best };
  },
  grade(s) { return s >= 85 ? 'A' : s >= 70 ? 'B' : s >= 55 ? 'C' : s >= 40 ? 'D' : 'F'; },
  carryDelta(t) { return isNaN(t) ? 0 : R((t - 21) / 3); },
  clubAdjust(w) { const half = x => R(x * 2) / 2; return [half(w / 15), half(w / 25)]; },
  clubs(x) { if (Math.abs(x) < 0.25) return '0'; if (x % 1 === 0) return String(x); return (Math.floor(x) ? Math.floor(x) : '') + '½'; },
};

const Flight = {
  clubs: [['DRIVER', 200], ['3 WOOD', 180], ['5 IRON', 150], ['7 IRON', 135], ['9 IRON', 115], ['P WEDGE', 100], ['S WEDGE', 75]],
  table(windKmh, tempC) {
    const mph = windKmh * 0.621, temp = isNaN(tempC) ? 1 : 1 + ((tempC - 21) / 3) * 0.005;
    return this.clubs.map(([club, base]) => { const b = base * temp; return { club, base, into: R(b * (1 - 0.01 * mph)), down: R(b * (1 + 0.005 * mph)), drift: R(b * 0.005 * mph) }; });
  },
};

const compass16 = d => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(fmod(d, 360) / 22.5) % 16];
const compass8 = d => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.floor(fmod(d, 360) / 45 + 0.5) % 8];

/* ---------- unhinged commentary, unique per tee slot within a day ---------- */
const Caddie = {
  SAT: 'Ah, such a beautiful morning!',
  mains(b) {
    const g = R(b.gust), w = R(b.wind), p = b.pop, s = b.score, lo = isNaN(b.tMin) ? 0 : R(b.tMin), hi = isNaN(b.tMax) ? 0 : R(b.tMax), uv = R(b.uv), mm = f1(b.mm);
    let primary;
    if (b.storm) primary = [
      "Thunderstorms in this window. You'd be a fourteen-club lightning rod in an open paddock. Clear the course on first thunder.",
      "Lightning forecast. The sky is hunting tall metal objects and you've volunteered a full bag. Clear the course on first thunder.",
      'Storm cells overhead. Your putter is now a conductor. Clear the course on first thunder — no plaque is worth it.',
      'Electrical activity in the window. Golf is cancelled; survival is mandatory. Clear the course on first thunder.'];
    else if (b.mm >= 3 || p >= 75) primary = [
      `${mm} mm forecast. Not golf — competitive drowning with a handicap.`,
      `Rain ${p}%. Grips become soap, shoes become aquariums, the card becomes papier-mâché.`,
      `${p}% rain. The fairways are lakes now and the lakes have ambitions.`,
      `${mm} mm of rain. The bunkers have been upgraded to water features at no extra cost.`,
      `Rain ${p}%. Your glove will be wet by the 2nd, your spirit by the 3rd.`,
      `${p}% chance of being soaked. 100% chance of pretending it's fine.`];
    else if (p >= 40) primary = [
      `${p}% rain — a coin toss with your dignity, and your dignity hasn't won since 2019.`,
      `Showers ${p}%. Bring the umbrella you'll abandon on the 7th like every other bad decision.`,
      `${p}% rain. Partly sunny, partly a personal attack.`,
      `Rain risk ${p}%. The sky is buffering. So is your short game.`,
      `${p}% showers. Perfect for wet grips and dry humour.`,
      `Chance of rain ${p}%. Pack a towel, lower expectations, repeat.`];
    else if (g >= 45 || w >= 30) primary = [
      `Gusts to ${g} km/h. Your ball has a flight plan; the wind has lodged an appeal.`,
      `${w} km/h with gusts to ${g}. Every slice is now a migration. Wave it goodbye.`,
      `Gusts ${g}. The flagstick is doing interpretive dance and so will your ball.`,
      `Wind ${w} km/h. Your tee shot will land in another postcode, possibly another state.`,
      `Gusts to ${g}. Hats will be lost. Balls will be lost. Composure: gone by the 5th.`];
    else if (w >= 18) primary = [
      `${w} km/h breeze. A premium, artisanal excuse for every miss.`,
      `Wind ${w} km/h. Enough to blame, not enough to justify. Lie responsibly.`,
      `${w} km/h and gusting ${g}. Club up, aim off, pray.`,
      `A ${w} km/h breeze. Every shank now has plausible deniability.`];
    else if (lo < 10) primary = [
      `${lo}° at tee-off. Your fingers will file for divorce by the 4th.`,
      `${lo}°. The ball will fly like it just got bad news. So will you.`,
      `Starting at ${lo}°. Steaming breath, frozen hands, warm excuses.`,
      `${lo}° on the first tee. Thermals under the polo. Nobody needs to know.`];
    else if (hi >= 32) primary = [
      `${hi}°. The course is an air fryer and you are the nugget.`,
      `${hi}° out there. Sweat will reach places sunscreen fears.`,
      `${hi}°. Greens fast, tempers faster, water bottle empty by the 6th.`,
      `Peaking at ${hi}°. The beer cart is now critical infrastructure.`];
    else if (uv >= 8) primary = [
      `UV ${uv}. The sun plays off scratch and doesn't take mulligans.`,
      `UV ${uv}. SPF50+ or get rotisseried between the 3rd and the 12th.`,
      `UV index ${uv}. Reapply on the 9th or become leather by the 18th.`];
    else if (s >= 85) primary = [
      `${s}/100. Flawless. Every remaining excuse is about you.`,
      `${s}/100. Perfect conditions. Shoot badly and it's officially a character flaw.`,
      `${s}/100. The weather is fine. Your swing, as ever, is under review.`,
      `${s}/100. Blame the greens, because the weather won't take it.`];
    else if (s >= 70) primary = [
      `${s}/100. The weather won't ruin this round. You'll have to do it yourself.`,
      `Solid ${s}. The atmosphere has done its part. Over to your swing, God help us.`,
      `${s}/100. Decent. Not good enough to explain your score, though.`,
      `${s}/100 and ${lo}–${hi}°. Mild weather, wild golf.`];
    else primary = [
      `${s}/100. Somewhere a greenkeeper is laughing. Fair enough.`,
      `${s}/100. You'd have more fun doing your tax.`,
      `${s}/100. Technically playable. Spiritually questionable.`,
      `${s}/100. Go if you must. Nobody will stop you. Many will question you.`];
    const dir = compass8(b.dir), ex = [];
    if (w >= 10) { ex.push(`${w} km/h from the ${dir}. Aim off and act like you meant it.`); ex.push(`A ${dir} wind at ${w} km/h. Your ball will tour the neighbouring fairway.`); }
    if (g >= 30) { ex.push(`Gusts to ${g}. Tee it low and pretend that's a strategy.`); ex.push(`Gusting ${g} km/h. Putts will break toward the nearest drama.`); }
    if (hi - lo >= 4) ex.push(`${lo}° to ${hi}° over the round. Layer up, strip down, complain throughout.`);
    ex.push(`${lo}–${hi}° out there. Comfortable for the body, devastating for the scorecard.`);
    if (uv >= 6) { ex.push(`UV ${uv}. Your forearms will leave with a farmer's tan and a grudge.`); ex.push(`UV ${uv}. Sunscreen on the 1st, the 9th, and every time you cry.`); }
    if (p >= 15 && p <= 74) ex.push(`${p}% rain chance. The umbrella stays in the bag purely out of spite.`);
    if (s >= 70) ex.push(`Score ${s}. Respectable weather, unrespectable swing.`, `${s}/100. Conditions you'll describe as 'tough' to your mates anyway.`);
    else if (s >= 55) ex.push(`${s}/100. Average day for average golf. Perfect fit.`, `${s}/100. Not great, not terrible. Much like your putting.`);
    else ex.push(`${s}/100. Brave choice. Stupid, but brave.`, `${s}/100. The course will win. It's just a question of margin.`);
    return b.storm ? primary.concat(ex.map(x => x + ' Lightning around — clear the course on first thunder.')) : [...new Set(primary.concat(ex))];
  },
  kickers(b, lastHour) {
    const h = hourOf(b.tee);
    let timed;
    if (h <= 7) timed = ['Dawn slot: dew, regret and servo coffee.', 'Pre-dawn hero hours. The birds are judging.', "Up before the sun. The sun thinks you're weird."];
    else if (lastHour != null && h >= lastHour - 1) timed = ["Last light — you'll putt by moonlight and blame the dark.", 'Racing the sunset. The sunset is undefeated.', 'Twilight round: half golf, half search party.'];
    else if (h <= 10) timed = ["Morning round: the course is fresh, your back isn't.", 'Mid-morning: peak smugness window.', 'Early enough to feel virtuous. Late enough to have no excuse.'];
    else if (h <= 13) timed = ['Midday tee: max sun, min shade, zero mercy.', 'Lunch-time slot. Sandwich on the 9th or riot.', 'High noon. Duel the course. Lose.'];
    else timed = ['Arvo slot: the wind wakes up just to spite you.', 'Afternoon round. The beer cart is your only ally.', 'Post-lunch slump meets pre-dinner panic.'];
    return timed.concat(['Your handicap remains a work of fiction.', "Someone will lose a ball by the 3rd. It's you.", 'Bring spare balls. Bring spare patience.',
      'Two good shots, a lifetime of telling people about them.', 'Practice swing count: excessive.', 'The beer cart has been notified.', 'Results may vary. Mostly downward.']);
  },
  dayLines(day) {
    const sat = dow(T(day.date + 'T00:00')) === 6;
    const last = day.windows.length ? hourOf(day.windows[day.windows.length - 1].tee) : null;
    const usedM = new Set(), usedK = new Set(), out = {};
    const seed = Math.floor(T(day.date + 'T00:00') / DAY);
    day.windows.forEach(b => {
      const m = this.mains(b), k = this.kickers(b, last), hr = hourOf(b.tee);
      const st = fmod(seed + hr * 3, m.length);
      let main = m[st]; for (let i = 0; i < m.length; i++) { const c = m[(st + i) % m.length]; if (!usedM.has(c)) { main = c; break; } }
      usedM.add(main);
      const ks = fmod(seed * 5 + hr, k.length);
      let kick = k[ks]; for (let i = 0; i < k.length; i++) { const c = k[(ks + i) % k.length]; if (!usedK.has(c)) { kick = c; break; } }
      usedK.add(kick);
      const body = b.storm ? main : `${main} ${kick}`;
      out[b.tee] = sat ? `${this.SAT} ${body}` : body;
    });
    return out;
  },
  banter(day) {
    if (day.best) return this.dayLines(day)[day.best.tee];
    const body = 'No playable daylight left. Even the ducks have teed off without you.';
    return dow(T(day.date + 'T00:00')) === 6 ? `${this.SAT} ${body}` : body;
  },
};

/* ---------- loadout + bulletin ---------- */
const Gear = [['SHELL', 'Rain jacket'], ['COAT', 'Coat'], ['LAYERS', 'Layers'], ['TSHIRT', 'T-shirt'], ['BOOTS', 'Boots'], ['SANDALS', 'Open shoes'],
  ['SNEAKERS', 'Closed shoes'], ['SUNSCREEN', 'SPF50+'], ['SUNGLASSES', 'Sunglasses'], ['HAT', 'Hat / shade'], ['GLOVES', 'Gloves'], ['MASK', 'Mask']];

function aqiFor(w, air) {
  if (!air) return null;
  const date = dkey(w.current.time);
  return date === dkey(localNow(w.off)) ? (air.usAqi ?? air.dailyMax[date] ?? null) : (air.dailyMax[date] ?? null);
}
function pollenFor(w, pollen) { if (!pollen) return null; const d = dkey(w.current.time); return pollen.days.find(x => x.date === d) || pollen.days[0] || null; }

const Advisor = {
  loadout(w, air) {
    let date = dkey(w.current.time), day = dayOf(w, date), next = false;
    if (day && w.current.time > day.sunset - HOUR) { const n = w.daily.find(d => d.date > date); if (n) { day = n; date = n.date; next = true; } }
    if (!day) return { date, next, items: [] };
    const hours = w.hourly.filter(h => dkey(h.time) === date && h.time >= day.sunrise - (day.sunrise % HOUR) && h.time < day.sunset);
    if (!hours.length) return { date, next, items: [] };
    const temps = hours.map(h => h.temperature).filter(x => !isNaN(x));
    const tMax = temps.length ? Math.max(...temps) : day.max, tMin = temps.length ? Math.min(...temps) : day.min;
    const app = hours.map(h => h.apparent).filter(x => x != null); const feelMin = app.length ? Math.min(...app) : tMin;
    const pop = Math.max(...hours.map(h => h.pop || 0)), mm = hours.reduce((a, h) => a + h.precip, 0), gust = Math.max(...hours.map(h => h.gust));
    const uv = Math.max(Math.max(...hours.map(h => h.uv || 0)), day.uvMax || 0);
    const uvH = hours.filter(h => (h.uv || 0) >= 3);
    const snow = hours.some(h => Codes.sky(h.code) === 'SNOW');
    const sunny = hours.some(h => ['CLEAR', 'PARTLY'].includes(Codes.sky(h.code)));
    const wet = hours.find(h => (h.pop || 0) >= 40 || h.precip >= 0.3);
    const swing = tMax - tMin, out = [];
    const A = (gear, title, reason, pri, quips) => out.push({ gear, title, reason, pri, quips });
    // Quips are written from the day's actual numbers; the UI shows one per day (same rule as Android).
    const wetT = wet ? hm(wet.time) : '', uvStart = uvH.length ? hm(uvH[0].time) : '11:00', uvEnd = uvH.length ? hm(uvH[uvH.length - 1].time + HOUR) : '15:00';
    const L = (...q) => q.filter(Boolean);
    if (wet) A('SHELL', gust >= 45 ? 'Storm shell' : 'Rain jacket', `${pop}% from ${wetT} · ${f1(mm)} mm`, 9, L(
      `${pop}% rain from ${wetT}. The sky has opinions and they're wet.`,
      `${f1(mm)} mm by sunset. Waterproof or water-logged: pick one.`,
      `Rain lands around ${wetT}. Plan your heroic sprint accordingly.`,
      gust >= 45 ? `Gusts ${R(gust)} km/h. Umbrellas go to die today.` : `Hood up from ${wetT}. Dignity down.`,
      mm < 1 && `Only ${f1(mm)} mm, but it'll find your collar anyway.`,
      mm >= 5 && `${f1(mm)} mm. That's not rain, that's a subscription.`));
    if (tMax <= 11) A('COAT', 'Heavy coat', `Peaks at ${R(tMax)}°`, 8, L(`${R(tMax)}° is the high. The HIGH.`, `Feels like ${R(feelMin)}° out there. Dress like a burrito.`, `${R(tMin)}° to start. Fashion is dead. Warmth lives.`, gust >= 40 && `Gusts ${R(gust)} make ${R(tMax)}° feel personal.`));
    else if (swing >= 9) A('LAYERS', 'Layers', `${R(tMin)}°→${R(tMax)}° swing`, 7, L(`${R(tMin)}° to ${R(tMax)}°: Melbourne is speedrunning seasons again.`, `${R(swing)}° swing. Onion mode: peel as the day betrays you.`, `Cold ${R(tMin)}° start, ${R(tMax)}° finish. Morning you and afternoon you disagree.`));
    else if (tMax <= 17) A('LAYERS', 'Jacket', `Tops out at ${R(tMax)}°`, 6, L(`${R(tMax)}°. Not cold, just disappointing.`, `Tops out at ${R(tMax)}°. Future you says thanks.`, gust >= 35 ? `${R(gust)} km/h gusts on a ${R(tMax)}° day. Zip it.` : `${R(tMin)}° mornings don't care about your plans.`));
    else if (tMax <= 22) A('LAYERS', 'Light layer', `${R(tMin)}–${R(tMax)}°`, 4, L(`${R(tMin)}–${R(tMax)}°. Mild. Suspiciously mild.`, `A light layer for the ${R(tMin)}° bits.`, pop >= 30 ? `${pop}% rain chance. Pick a layer that can take a sprinkle.` : `${R(tMax)}° peak. Tie it round your waist by lunch.`));
    else if (tMax <= 28) A('TSHIRT', 'T-shirt', `Up to ${R(tMax)}°`, 4, L(`${R(tMax)}°. Arms out. Dignity optional.`, `T-shirt weather at ${R(tMax)}°. Pretend you're on holiday.`, uv >= 8 ? `${R(tMax)}° and UV ${R(uv)}. T-shirt yes, sunscreen absolutely.` : `${R(tMin)}° early, ${R(tMax)}° later. The sleeves can wait.`));
    else A('TSHIRT', 'Breathable', `Up to ${R(tMax)}°`, 6, L(`${R(tMax)}°. Wear less. Sweat anyway.`, `Linen or death at ${R(tMax)}°. Mostly linen.`, `${R(tMax)}° peak. Your shirt will be a sponge by 3pm.`));
    if (snow) A('BOOTS', 'Insulated boots', 'Snow forecast', 8, L('Snow. Toes are non-refundable.', `Frostbite is not a vibe at ${R(tMin)}°.`));
    else if (mm >= 2 || pop >= 60) A('BOOTS', 'Waterproof boots', `${f1(mm)} mm in daylight`, 7, L(`${f1(mm)} mm of puddle-based trauma ahead.`, `Wet socks are a war crime. ${pop}% says they're coming.`, wetT ? `Rain from ${wetT}. Boots now, regret never.` : 'Boots now, regret never.'));
    else if (tMax >= 24 && !wet) A('SANDALS', 'Open shoes', `Dry, ${R(tMax)}°`, 3, L(`Dry and ${R(tMax)}°. Toes out. Judgement incoming.`, `Socks at ${R(tMax)}° are a cry for help.`, `${R(tMax)}° and no rain. Your feet have earned this.`));
    else A('SNEAKERS', 'Closed shoes', wet ? 'Damp patches' : 'Standard issue', 2, L(wet ? `Damp patches about (${pop}%). Closed shoes, open mind.` : 'Standard issue. Boring. Correct.', `${R(tMin)}–${R(tMax)}° and nothing dramatic. Sensible shoes. Thrilling.`, `Nothing to dodge at ${R(tMax)}°. Just walk normally, for once.`));
    if (uv >= 3) A('SUNSCREEN', 'SPF50+', `UV ${R(uv)}${uvH.length ? ` · ${uvStart}–${uvEnd}` : ''}`, uv >= 8 ? 9 : 6, L(`UV ${R(uv)} from ${uvStart}. The sun wants your skin.`, `UV ${R(uv)} until ${uvEnd}. Burn now, regret later.`, `Reapply every 2h, ${uvStart}–${uvEnd}. Your tan is not a personality.`, uv >= 11 && `UV ${R(uv)}: extreme. Shade is a lifestyle today.`));
    if (sunny && uv >= 3) A('SUNGLASSES', 'Sunglasses', 'Direct sun', 5, L(`Direct sun at ${R(tMax)}°. Squinting ages you.`, `Glare from ${uvStart} to ${uvEnd}. Look mysterious, or just see.`, pop >= 30 ? 'Sun between the showers. Shades on standby.' : 'Clear-ish and bright. Eyes deserve better.'));
    if (uv >= 6) A('HAT', 'Hat or shade', `UV ${R(uv)} — cover up 11–3`, 6, L(`UV ${R(uv)}: hat, shade or a strategic tree.`, `No hat? Walk the shady side like a vampire until ${uvEnd}.`, `Peak UV ${R(uv)} around midday. Cover the scalp or dodge it.`));
    if (feelMin <= 7) A('GLOVES', 'Gloves', `Feels ${R(feelMin)}° in daylight`, 5, L(`Feels ${R(feelMin)}°. Your hands have filed a complaint.`, `Fingers are non-refundable at ${R(feelMin)}°.`, gust >= 30 ? `${R(gust)} km/h wind on your knuckles. Gloves.` : 'Cold hands, colder coffee. Gloves.'));
    const aqi = aqiFor(w, air);
    if (aqi != null && aqi > 100) A('MASK', 'P2 mask', `AQI ${aqi}`, 8, [`AQI ${aqi}. The air has texture today. Gross.`, `AQI ${aqi}: breathing, now with extra chunks.`]);
    // Personality: one voiced line per item (Android Advisor.loadout does the same).
    const vars = { tmax: R(tMax), tmin: R(tMin), pop, time: wetT, mm: f1(mm), uv: R(uv), uvEnd, gust: R(gust), feel: R(feelMin) };
    out.forEach(a => { const l = Voice.line('LOADOUT', a.gear); if (l) a.quips = [Voice.fill(l, vars), ...(Voice.id === 'deadpan' ? a.quips : [])]; });
    return { date, next, items: out.sort((a, b) => b.pri - a.pri) };
  },

  bulletin(w, air, pollen, place, golfW, act) {
    const hours = w.hourly.slice(0, 13), c = w.current;
    const temps = hours.map(h => h.temperature).filter(x => !isNaN(x));
    const tMax = temps.length ? Math.max(...temps) : c.temperature, tMin = temps.length ? Math.min(...temps) : c.temperature;
    const popMax = Math.max(0, ...hours.map(h => h.pop || 0));
    const wet = hours.find(h => (h.pop || 0) >= 40 || h.precip >= 0.3);
    const gust = Math.max(c.windGusts, ...hours.map(h => h.gust));
    const uvMax = Math.max(Math.max(0, ...hours.map(h => h.uv || 0)), hours.some(h => h.isDay) ? (today(w)?.uvMax || 0) : 0);
    const storm = hours.some(h => Codes.sky(h.code) === 'STORM');
    const city = place ? place.charAt(0).toUpperCase() + place.slice(1) : 'The sector';
    const d0 = new Date(c.time), seed = Math.floor((c.time - Date.UTC(d0.getUTCFullYear(), 0, 0)) / DAY) * 24 + d0.getUTCHours();
    const pick = (...s) => s[fmod(seed + s.length, s.length)];
    const out = [], P = (tag, text, serious = false) => out.push({ tag, text, serious });
    const temp = R(c.temperature), pl = pollenFor(w, pollen);
    if (pl && pl.asthma) P('PRIORITY', 'Thunderstorm asthma conditions forecast. Not a joke: keep reliever medication on you and stay indoors during the storm front.', true);
    if (tMax >= 38) P('PRIORITY', `Extreme heat: ${R(tMax)}°. Limit exertion, drink water, check on vulnerable people.`, true);
    if (storm) P('PRIORITY', 'Lightning possible in the next 12 h. When thunder roars, go indoors. Golf course reclassified as a conductivity experiment.', true);
    const sky = Codes.sky(c.code);
    P('SITREP', ({
      CLEAR: c.isDay ? pick(`${temp}° and clear. ${city} is being suspiciously pleasant. Monitoring for betrayal.`, `Clear skies, ${temp}°. Enjoy it; the atmosphere has a short attention span.`)
        : pick(`Clear night, ${temp}°. Stars visible. They are not impressed either.`, `Cloudless and ${temp}°. Excellent conditions for staring into the void.`),
      PARTLY: pick(`Partly cloudy, ${temp}°. Sun and cloud negotiating custody of the sky.`, `${temp}°, scattered cloud. The sky has chosen indecision as a lifestyle.`),
      CLOUDY: pick(`Overcast, ${temp}°. Sky rendered in default grey. Upgrade unavailable.`, 'Full cloud deck. Vitamin D shipments delayed indefinitely.'),
      FOG: 'Fog. Visibility degraded. Navigation by vibes enabled.',
      DRIZZLE: 'Drizzle: the weather equivalent of a passive-aggressive email.',
      RAIN: pick('Rain in progress. Hair-related plans have been cancelled on your behalf.', 'Active precipitation. The sky is leaking. Again.'),
      SNOW: `Snowfall detected. ${city} will be discussing this for a decade.`,
      STORM: 'Thunderstorm overhead. Nature is running its loudest firmware update.',
    })[sky]);
    if (wet) P('PRECIP', `Rain ${popMax}% from ${hm(wet.time)}. Umbrella advised. Historical compliance with this advice: low.`);
    else P('PRECIP', pick('Zero precipitation in the 12 h window. Your umbrella remains decorative.', 'Dry window confirmed. Blame for wet socks will not be accepted.'));
    const swing = tMax - tMin;
    if (swing >= 9) P('THERMAL', `Forecast swing of ${R(swing)}°. Several seasons scheduled for today. Dress in strata.`);
    else if (tMin <= 5) P('THERMAL', `Low of ${R(tMin)}°. Thermal layers recommended. Feelings optional.`);
    if (uvMax >= 8) P('UV', `UV index ${R(uvMax)}. The sun has been notified of your skin's existence. SPF50+ or accept the consequences.`);
    else if (uvMax >= 3) P('UV', `UV ${R(uvMax)}. Moderate radiation. Sunscreen still cheaper than regret.`);
    if (gust >= 50) P('WIND', `Gusts to ${R(gust)} km/h. Umbrellas will be repossessed by the atmosphere.`);
    else if (c.windSpeed < 5) P('WIND', 'Wind negligible. Flags across the sector report existential boredom.');
    if (pl && Air.peak(pl) >= 3.5 && !pl.asthma) P('BIO', `Pollen ${Air.upi(Air.peak(pl)).toLowerCase()}. Nature is attempting a hostile takeover via your sinuses.`);
    const aqi = aqiFor(w, air);
    if (aqi != null) { if (aqi <= 50) P('AIR', `Air quality good (${aqi}). Breathe freely, while stocks last.`); else P('AIR', `AQI ${aqi}. Air currently has texture. Consider limiting outdoor exertion.`, aqi > 150); }
    if (act && act.id === 'golf') {
      const gw = golfW || w, sat = Golf.day(gw, Golf.defaultDay(gw));
      const pv = Voice.persona(), gd = Activities.find('golf');
      if (sat.best) P('GOLF', `Sat ${hm(sat.best.tee)} · ${sat.best.score}/100. ` + (Voice.line('ACT', 'NONE') && gd ? Activities.brief(gd, sat.best, sat.date).split(' · ').slice(1).join(' · ') : Caddie.banter(sat)), sat.best.storm);
    } else if (act) {
      const date = dkey(w.current.time), b = Activities.day(w, date, act).best;
      if (b) P(act.tag, `${act.name} today · ${b.score}/100. ` + Activities.brief(act, b, date), b.storm);
    }
    P('SYS', 'Telemetry: Open-Meteo best-match blend. ATMOS-7 out.');
    // Personality: re-voice everything except hazards and activity lines (Android Advisor.bulletin does the same).
    const pv = Voice.persona();
    if (pv) {
      const vars = { temp, city, pop: popMax, time: wet ? hm(wet.time) : '', uv: R(uvMax), gust: R(gust), tmin: R(tMin), tmax: R(tMax), swing: R(swing), aqi: aqi ?? '', pollen: pl ? Air.upi(Air.peak(pl)).toLowerCase() : '' };
      const key = tag => ({ SITREP: sky === 'CLEAR' ? (c.isDay ? 'CLEAR_DAY' : 'CLEAR_NIGHT') : sky, PRECIP: wet ? 'WET' : 'DRY', THERMAL: swing >= 9 ? 'SWING' : 'COLD', UV: uvMax >= 8 ? 'HIGH' : 'MOD', WIND: gust >= 50 ? 'GUST' : 'CALM', AIR: (aqi || 0) <= 50 ? 'GOOD' : 'BAD' })[tag] ?? null;
      return out.map(t => { if (!['SITREP', 'PRECIP', 'THERMAL', 'UV', 'WIND', 'BIO', 'AIR', 'SYS'].includes(t.tag)) return t; const l = Voice.line(t.tag, key(t.tag), seed); return l ? { ...t, text: Voice.fill(l, vars) } : t; });
    }
    return out;
  },
};

/* ---------- theme accent: time of day blended with temperature, around the colour wheel ---------- */
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbToHsv([r, g, b]) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; } return [fmod(h * 60, 360), mx ? d / mx : 0, mx]; }
function hsvToHex(h, s, v) { const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return '#' + [f(5), f(3), f(1)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join(''); }
function lerpHex(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); return '#' + A.map((x, i) => Math.round(x + (B[i] - x) * t).toString(16).padStart(2, '0')).join(''); }
/* Light mode: neon is tuned for black; bright saturated colours are pulled down to read on white (same rule as Android Color.forMode). */
let LIGHT = false, THEME = null; // THEME: active CATALOG theme (null = Atmos)
function M(hex) {
  if (typeof hex !== 'string' || hex[0] !== '#' || hex.length !== 7) return hex;
  if (THEME && THEME.mono) { // greyscale themes drain every colour (Android Color.forMode)
    const [r, g, b] = hexToRgb(hex).map(x => x / 255), l = 0.299 * r + 0.587 * g + 0.114 * b, v = LIGHT ? l * 0.45 : 0.45 + l * 0.55;
    const h = Math.round(v * 255).toString(16).padStart(2, '0'); return '#' + h + h + h;
  }
  if (!LIGHT) return hex;
  const [h, s, v] = rgbToHsv(hexToRgb(hex));
  if (v < 0.6 || s < 0.25) return hex;
  return hsvToHex(h, Math.min(1, s * 1.05), 0.56);
}
function themeAccent(minute, rise, set, tempC, sky) {
  if (THEME && !THEME.dynamic) return (LIGHT ? THEME.light : THEME.dark).accent.toLowerCase();
  // Atmos: deep electric blue that drifts with the time of day (no temperature tint; Android Hud.kt themeAccent).
  const keys = [[rise - 60, '#5b7cff'], [rise - 10, '#6fa0ff'], [rise + 50, '#3d9bff'], [set - 100, '#3d9bff'], [set - 20, '#5aa8ff'], [set + 20, '#4f7dff'], [set + 75, '#5b7cff']];
  let tod = '#5b7cff';
  if (minute > keys[0][0] && minute < keys[keys.length - 1][0]) for (let k = 0; k < keys.length - 1; k++) { const [m0, c0] = keys[k], [m1, c1] = keys[k + 1]; if (minute >= m0 && minute <= m1) { tod = lerpHex(c0, c1, m1 > m0 ? (minute - m0) / (m1 - m0) : 0); break; } }
  const mix = (a, b, f) => { let d = b - a; if (d > 180) d -= 360; if (d < -180) d += 360; return fmod(a + d * f, 360); };
  const a = rgbToHsv(hexToRgb(tod));
  let h = a[0]; if (sky === 'STORM') h = mix(h, 215, 0.35);
  return M(hsvToHex(h, a[1], 1));
}
function tempColor(t) {
  const st = [[-5, '#5b7bff'], [5, '#00b3ff'], [13, '#00f0d0'], [20, '#b6ff3d'], [26, '#ffd23d'], [32, '#ff7a3d'], [40, '#ff3b30']];
  if (isNaN(t)) return LIGHT ? '#0b1a28' : '#e6fbff'; if (t <= st[0][0]) return M(st[0][1]); if (t >= st[6][0]) return M(st[6][1]);
  const i = st.findIndex(x => x[0] > t); return M(lerpHex(st[i - 1][1], st[i][1], (t - st[i - 1][0]) / (st[i][0] - st[i - 1][0])));
}

/* ---------- activities (mirror of Android data/Catalog.kt Activities) ---------- */
const Activities = {
  find(id) { return CATALOG.activities.find(a => a.id === id) || null; },
  search(q) {
    const s = q.trim().toLowerCase(); if (!s) return [];
    return CATALOG.activities.map(a => {
      const hay = `${a.name} ${a.tag} ${a.keywords}`.toLowerCase();
      const rank = a.name.toLowerCase().startsWith(s) ? 0 : hay.split(/[ ()]/).some(x => x.startsWith(s)) ? 1 : hay.includes(s) ? 2 : -1;
      return [rank, a];
    }).filter(x => x[0] >= 0).sort((x, y) => x[0] - y[0] || (x[1].name < y[1].name ? -1 : 1)).map(x => x[1]);
  },
  defaultDay(w, a) { return a.id === 'golf' ? Golf.defaultDay(w) : dkey(w.current.time); },
  day(w, date, a) {
    if (a.id === 'golf') return Golf.day(w, date);
    const d = dayOf(w, date); if (!d) return { date, windows: [], best: null };
    const nowH = w.current.time - (w.current.time % HOUR), mid = T(date + 'T00:00');
    let first, last;
    if (a.when === 'night') { first = d.sunset + HOUR - ((d.sunset + HOUR) % HOUR); last = mid + DAY + 3 * HOUR; }
    else if (a.when === 'any') { first = mid + 6 * HOUR; last = mid + 22 * HOUR - a.hours * HOUR; }
    else { first = d.sunrise + 30 * MIN - ((d.sunrise + 30 * MIN) % HOUR); last = d.sunset - a.hours * HOUR; }
    const windows = [];
    w.hourly.forEach((h, i) => {
      if (h.time < first || h.time > last || h.time < nowH) return;
      const win = this.window(w.hourly.slice(i, i + a.hours), a); if (win) windows.push(win);
    });
    const best = windows.reduce((b, x) => (!b || x.score > b.score ? x : b), null);
    return { date, windows, best };
  },
  window(hours, a) {
    if (!hours.length) return null;
    const temps = hours.map(h => h.temperature).filter(x => !isNaN(x));
    const tMin = temps.length ? Math.min(...temps) : NaN, tMax = temps.length ? Math.max(...temps) : NaN;
    const wind = hours.reduce((s, h) => s + h.wind, 0) / hours.length, gust = Math.max(...hours.map(h => h.gust));
    const wet = a.snow ? hours.filter(h => h.temperature > 1) : hours;
    const pop = wet.length ? Math.max(...wet.map(h => h.pop || 0)) : 0, mm = wet.reduce((s, h) => s + h.precip, 0);
    const uv = Math.max(...hours.map(h => h.uv || 0)), storm = hours.some(h => h.code >= 95 && h.code <= 99);
    const cloud = hours.reduce((s, h) => s + (h.cloud || 0), 0) / hours.length;
    const vis = Math.min(...hours.map(h => (h.visibility == null ? 50000 : h.visibility) / 1000));
    const raw = [];
    if (storm) raw.push(['LIGHTNING', 80, 'storm cells in the window']);
    raw.push(['RAIN', a.rainW * (pop * 0.35 + Math.min(30, mm * 8)), `${pop}% chance · ${f1(mm)} mm`]);
    if (a.windMin > 0 && wind < a.windMin) raw.push(['CALM', (a.windMin - wind) * 2.5, `avg ${R(wind)} km/h (needs ${R(a.windMin)}+)`]);
    else raw.push(['WIND', Math.max(0, wind - a.windMax) * a.windW + Math.max(0, gust - a.gustMax) * 0.6, `avg ${R(wind)} km/h · gust ${R(gust)}`]);
    const heat = isNaN(tMax) ? 0 : Math.max(0, tMax - a.tHi) * a.heat, cold = isNaN(tMin) ? 0 : Math.max(0, a.tLo - tMin) * a.cold;
    if (heat >= cold) raw.push(['HEAT', heat, `peak ${isNaN(tMax) ? '--' : R(tMax)}° (ideal ≤${R(a.tHi)}°)`]);
    else raw.push(['COLD', cold, `low ${R(tMin)}° (ideal ≥${R(a.tLo)}°)`]);
    if (uv >= 8 && a.uvW > 0) raw.push(['UV', 4 * a.uvW, `UV ${R(uv)}`]);
    if (a.cloudW > 0) raw.push(['CLOUD', cloud * a.cloudW, `cover ${R(cloud)}%`]);
    if (a.visMin > 0 && vis < a.visMin) raw.push(['VISIBILITY', (a.visMin - vis) * 8, `${f1(vis)} km (needs ${R(a.visMin)})`]);
    const deductions = raw.map(([label, p, detail]) => ({ label, points: R(p), detail })).filter(d => d.points > 0);
    const score = Math.max(0, Math.min(100, 100 - deductions.reduce((s, d) => s + d.points, 0)));
    const worst = deductions.slice().sort((x, y) => y.points - x.points)[0];
    return { tee: hours[0].time, score, tMin, tMax, wind, gust, dir: hours[hours.length >> 1].dir, pop, mm, uv, storm,
      limiter: worst && worst.points >= 6 ? worst.label : 'NONE', deductions };
  },
  brief(a, t, date) {
    if (!t) return `No usable window for ${a.name.toLowerCase()} on this day. The forecast regrets nothing and neither should you.`;
    const span = `${hm(t.tee)}–${hm(t.tee + a.hours * HOUR)}`, Q = CATALOG.quips;
    const pl = Voice.line('ACT', t.limiter, 0);
    const pool = (Q[a.group] && Q[a.group][t.limiter]) || Q.any[t.limiter] || Q.any.NONE;
    const o = pl ? (Voice.id === 'deadpan' ? [pl, ...pool] : [pl]) : pool;   // Deadpan (built-in voice) rotates the pool too
    const hid = [...a.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 0);
    const line = o[fmod(Math.floor(T(date + 'T00:00') / DAY) * 7 + new Date(t.tee).getUTCHours() * 3 + hid, o.length)]
      .replaceAll('{N}', a.name).replaceAll('{n}', a.name.toLowerCase()).replaceAll('{pop}', t.pop).replaceAll('{mm}', f1(t.mm))
      .replaceAll('{wind}', R(t.wind)).replaceAll('{gust}', R(t.gust)).replaceAll('{tmax}', isNaN(t.tMax) ? '--' : R(t.tMax))
      .replaceAll('{tmin}', isNaN(t.tMin) ? '--' : R(t.tMin)).replaceAll('{uv}', R(t.uv)).replaceAll('{score}', t.score);
    return `${span} · ${line}`;
  },
};

/* ---------- personalities (Android data/Catalog.kt Persona + Voice) ---------- */
const Voice = {
  id: 'deadpan',
  persona() { return CATALOG.personalities.find(p => p.id === this.id) || CATALOG.personalities[0]; },
  isDefault() { return this.persona().id === 'deadpan'; },
  line(section, key, seed = 0) {
    const sec = this.persona().lines[section]; if (sec == null) return null;
    const v = key == null ? sec : (typeof sec === 'object' && !Array.isArray(sec) ? sec[key] : null);
    if (typeof v === 'string') return v; if (Array.isArray(v) && v.length) return v[fmod(seed, v.length)]; return null;
  },
  fill(t, vars) { return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), t); },
};


/* ---------- Australian holidays + commemorations (Android data/Occasions.kt; rules in spec/catalog.py) ---------- */
const Occasions = {
  state: null, preview: '',
  stateOf(lat, lon) {
    const box = (a0, a1, o0, o1) => lat >= a0 && lat <= a1 && lon >= o0 && lon <= o1;
    if (box(-35.95, -35.1, 148.75, 149.4)) return 'act';
    if (box(-43.8, -39.4, 143.5, 148.6)) return 'tas';
    if (box(-39.3, -33.9, 140.9, 150.1) && !(lat > -36.0 && lon > 146.5)) return 'vic';
    if (box(-37.6, -28.1, 140.9, 153.8)) return 'nsw';
    if (box(-29.2, -10.0, 137.9, 154.0)) return 'qld';
    if (box(-38.2, -25.9, 129.0, 141.0)) return 'sa';
    if (box(-26.1, -10.9, 129.0, 138.0)) return 'nt';
    if (box(-35.3, -13.5, 112.8, 129.0)) return 'wa';
    return null;
  },
  // Dates are UTC-midnight ms for whole-day arithmetic.
  easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const x = h + l - 7 * m + 114; return Date.UTC(y, Math.floor(x / 31) - 1, (x % 31) + 1);
  },
  start(r, y) {
    const D = 86400000, wd = ms => (new Date(ms).getUTCDay() + 6) % 7; let base = null;
    if (r.fixed) base = Date.UTC(y, r.fixed[0] - 1, r.fixed[1]);
    else if (r.easter != null) base = this.easter(y) + r.easter * D;
    else if (r.nth) { const [mo, w, n] = r.nth;
      if (n < 0) { const last = Date.UTC(y, mo, 0); base = last - ((wd(last) - w + 7) % 7) * D; }
      else { const first = Date.UTC(y, mo - 1, 1); base = first + ((w - wd(first) + 7) % 7) * D + (n - 1) * 7 * D; } }
    else if (r.after) { const b = Date.UTC(y, r.after[0] - 1, r.after[1]); base = b + ((r.after[2] - wd(b) + 7) % 7) * D; }
    else if (r.table && r.table[y]) base = Date.UTC(y, r.table[y][0] - 1, r.table[y][1]);
    return base == null ? null : base + (r.off || 0) * D;
  },
  on(dateKey, st) {
    const [Y, M, Dd] = dateKey.split('-').map(Number), t = Date.UTC(Y, M - 1, Dd), out = [];
    for (const o of CATALOG.occasions || []) {
      if (o.states && (!st || !o.states.includes(st))) continue;
      for (const y of [Y, Y - 1]) { const s0 = this.start(o.rule, y); if (s0 == null) continue; const k = Math.round((t - s0) / 86400000); if (k >= 0 && k < (o.span || 1)) { out.push({ ...o, day: k }); break; } }
    }
    if (out.length > 1) { const loud = out.filter(o => !o.quiet); return loud.length ? loud : out; }
    return out;
  },
  today(dateKey) {
    if (this.preview) { const o = (CATALOG.occasions || []).find(x => x.id === this.preview); if (o) return [{ ...o, day: 0 }]; }
    return this.on(dateKey || new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10), this.state);
  },
  all() { const seen = new Set(); return (CATALOG.occasions || []).filter(o => !seen.has(o.name) && seen.add(o.name)).map(o => [o.id, o.name]); },
  line(o, seed) {
    if (o.quiet) return null;
    const t = Voice.line('OCC', o.cat, seed) || '{name}.', st = this.state;
    return Voice.fill(t, { name: o.name }) + (o.ph && o.cat !== 'PUBLIC' ? ` Public holiday${st ? ` in ${st.toUpperCase()}` : ''}.` : '');
  },
};

/* ---------- daily briefing (Android notify/Briefing.text) ---------- */
const Briefing = {
  text(w, city) {
    const p = Voice.persona(), c = w.current, d = today(w), seed = Math.floor(T(dkey(c.time) + 'T00:00') / DAY);
    const from = c.time - (c.time % HOUR), hours = w.hourly.filter(h => h.time >= from).slice(0, 16);
    const pop = Math.max(0, ...hours.map(h => h.pop || 0)), wet = hours.find(h => (h.pop || 0) >= 40);
    const tmax = R(d ? d.max : c.temperature), tmin = R(d ? d.min : c.temperature), uv = R((d && d.uvMax) || 0);
    const dt = new Date(c.time), date = `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dt.getUTCDay()]}, ${dt.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
    const vars = { city, date, temp: R(c.temperature), tmax, tmin, pop, time: wet ? hm(wet.time) : 'later', uv };
    const l = (k, f) => Voice.fill(Voice.line('BRIEF', k, seed) || f, vars);
    const stormy = hours.some(h => h.code >= 95 && h.code <= 99);
    const cond = pop >= 40 || stormy ? l('WET', 'Rain {pop}% from {time}.') : tmax >= 30 ? l('HOT', 'Peak {tmax}°.') : tmin <= 6 ? l('COLD', 'Low of {tmin}°.') : l('NICE', 'Pleasant day.');
    const hr = new Date(localNow(w.off)).getUTCHours(), period = hr >= 5 && hr <= 11 ? 'MORNING' : hr <= 16 && hr >= 12 ? 'AFTERNOON' : hr >= 17 && hr <= 20 ? 'EVENING' : 'NIGHT';
    const occ = Occasions.today(dkey(c.time)).map(o => Occasions.line(o, seed)).filter(Boolean).join(' ');
    const body = `${l('HELLO_' + period, 'Hello.')}${occ ? ' ' + occ : ''} ${date} — ${city}: ${R(c.temperature)}° and ${Codes.label(c.code).toLowerCase()} now, ${tmin}–${tmax}° today, ${pop}% chance of rain, UV ${uv}. ${cond} ${l('BYE', 'Skyfall out.')}`;
    return { title: `${p.name} // Daily briefing`, body };
  },
};

/* ---------- critical weather alerts (Android data/Alerts.model) ---------- */
const Alerts = {
  name: l => ['ADVISORY', 'WARNING', 'EMERGENCY'][l],
  model(w, pollen) {
    const now = w.current.time - (w.current.time % HOUR), hrs = w.hourly.filter(h => h.time >= now).slice(0, 24);
    if (!hrs.length) return [];
    const out = [], dKey = dkey(now), wt = t => dkey(t) === dKey ? `from ${hm(t)}` : `from ${DOW[dow(t)]} ${hm(t)}`;
    const add = (type, level, title, body, at) => out.push({ id: `m:${type}:${level}:${dKey}`, level, title, body, at, source: 'SKYFALL MODEL · OPEN-METEO' });
    const st = hrs.find(h => h.code >= 95 && h.code <= 99);
    if (st) { const hail = hrs.some(h => h.code === 96 || h.code === 99); add('storm', 1, hail ? 'THUNDERSTORMS WITH HAIL' : 'THUNDERSTORMS', `Thunderstorms forecast ${wt(st.time)}${hail ? ' with possible hail' : ''}. Get indoors when thunder starts; avoid open ground, water and tall trees.`, st.time); }
    const gh = hrs.reduce((a, b) => (b.gust > a.gust ? b : a)), g = R(gh.gust);
    if (g >= 100) add('wind', 2, 'DESTRUCTIVE WINDS', `Gusts to ${g} km/h ${wt(gh.time)}. Stay indoors, away from windows; secure loose objects now.`, gh.time);
    else if (g >= 80) add('wind', 1, 'DAMAGING WINDS', `Gusts to ${g} km/h ${wt(gh.time)}. Secure loose items; take care driving and near trees.`, gh.time);
    else if (g >= 60) add('wind', 0, 'STRONG WINDS', `Gusts to ${g} km/h ${wt(gh.time)}.`, gh.time);
    const hot = hrs.reduce((a, b) => (b.temperature > a.temperature ? b : a)), t = R(hot.temperature);
    if (t >= 43) add('heat', 2, 'EXTREME HEAT', `${t}° ${wt(hot.time)}. Dangerous heat: stay cool and hydrated, check on vulnerable people and pets.`, hot.time);
    else if (t >= 38) add('heat', 1, 'HEATWAVE CONDITIONS', `${t}° ${wt(hot.time)}. Limit exertion, drink water, keep out of the sun.`, hot.time);
    else if (t >= 35) add('heat', 0, 'HOT', `${t}° ${wt(hot.time)}. Take care in the sun.`, hot.time);
    const cold = hrs.reduce((a, b) => (b.temperature < a.temperature ? b : a)), tc = R(cold.temperature);
    if (tc <= -5) add('cold', 1, 'SEVERE COLD', `${tc}° ${wt(cold.time)}. Protect pipes, pets and plants; dress for hypothermia risk.`, cold.time);
    else if (tc <= 1) add('cold', 0, 'FROST', `${tc}° ${wt(cold.time)}. Frost and icy surfaces likely.`, cold.time);
    const pr = hrs.reduce((a, b) => (b.precip > a.precip ? b : a)), sum = hrs.reduce((s, h) => s + h.precip, 0);
    if (pr.precip >= 20) add('rain', 1, 'HEAVY RAIN · FLASH FLOODING', `Up to ${R(pr.precip)} mm in an hour ${wt(pr.time)}. Never drive through floodwater.`, pr.time);
    else if (sum >= 50) add('rain', 1, 'HEAVY RAIN', `${R(sum)} mm forecast in the next 24 h. Flooding possible; never drive through floodwater.`, pr.time);
    else if (sum >= 25) add('rain', 0, 'SOAKING RAIN', `${R(sum)} mm forecast in the next 24 h.`, pr.time);
    const sn = hrs.find(h => h.code === 75 || h.code === 86); if (sn) add('snow', 1, 'HEAVY SNOW', `Heavy snow ${wt(sn.time)}. Roads may close; carry chains and warm gear.`, sn.time);
    const uvh = hrs.reduce((a, b) => ((b.uv || 0) > (a.uv || 0) ? b : a)); if ((uvh.uv || 0) >= 11) add('uv', 0, 'EXTREME UV', `UV ${R(uvh.uv)} ${wt(uvh.time)}. Skin burns in minutes: cover up, SPF50+, shade.`, uvh.time);
    const fog = hrs.find(h => (h.visibility ?? 99999) < 200); if (fog) add('fog', 0, 'DENSE FOG', `Visibility under 200 m ${wt(fog.time)}. Slow down, low beams on.`, fog.time);
    const pd = pollen && pollen.days ? pollen.days.find(x => x.date === dKey) : null;
    if (pd && pd.asthma) add('asthma', 2, 'THUNDERSTORM ASTHMA RISK', 'High grass pollen with storms forecast. If you have asthma or hay fever, keep reliever medication on you and stay indoors as the storm front passes.', null);
    return out.sort((a, b) => b.level - a.level);
  },
};
