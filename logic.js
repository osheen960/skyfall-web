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
      `${s}/100. Somewhere a greenkeeper is laughing, and he's not wrong.`,
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
    if (wet) A('SHELL', gust >= 45 ? 'Storm shell' : 'Rain jacket', `${pop}% from ${hm(wet.time)} · ${f1(mm)} mm`, 9,
      [`${pop}% rain. The sky has opinions and they're wet.`, `${f1(mm)} mm incoming. Waterproof or water-logged: pick one.`, gust >= 45 ? `Gusts ${R(gust)}. Umbrellas go to die today.` : 'Hood up. Dignity down.']);
    if (tMax <= 11) A('COAT', 'Heavy coat', `Peaks at ${R(tMax)}°`, 8, [`${R(tMax)}° is the high. The HIGH.`, 'Dress like a burrito. Survive like one.', 'Fashion is dead. Warmth lives.']);
    else if (swing >= 9) A('LAYERS', 'Layers', `${R(tMin)}°→${R(tMax)}° swing`, 7, [`${R(swing)}° swing. Melbourne is speedrunning seasons again.`, 'Onion mode: peel as the day betrays you.', 'Morning you and afternoon you want different outfits. Both are right.']);
    else if (tMax <= 17) A('LAYERS', 'Jacket', `Tops out at ${R(tMax)}°`, 6, [`${R(tMax)}°. Not cold, just disappointing.`, 'Future you says thanks. Present you whinges.']);
    else if (tMax <= 22) A('LAYERS', 'Light layer', `${R(tMin)}–${R(tMax)}°`, 4, ['Mild. Suspiciously mild.', 'A light layer, in case the sky gets ideas.']);
    else if (tMax <= 28) A('TSHIRT', 'T-shirt', `Up to ${R(tMax)}°`, 4, [`${R(tMax)}°. Arms out. Dignity optional.`, "T-shirt weather. Pretend you're on holiday."]);
    else A('TSHIRT', 'Breathable', `Up to ${R(tMax)}°`, 6, [`${R(tMax)}°. Wear less. Sweat anyway.`, 'Linen or death. Mostly linen.']);
    if (snow) A('BOOTS', 'Insulated boots', 'Snow forecast', 8, ['Frostbite is not a vibe.', 'Toes are non-refundable.']);
    else if (mm >= 2 || pop >= 60) A('BOOTS', 'Waterproof boots', `${f1(mm)} mm in daylight`, 7, ['Wet socks are a war crime.', `${f1(mm)} mm of puddle-based trauma ahead.`]);
    else if (tMax >= 24 && !wet) A('SANDALS', 'Open shoes', `Dry, ${R(tMax)}°`, 3, ['Toes out. Judgement incoming.', `Sandals: because socks are a cry for help at ${R(tMax)}°.`]);
    else A('SNEAKERS', 'Closed shoes', wet ? 'Damp patches' : 'Standard issue', 2, ['Boring. Correct.', 'Sensible shoes. Thrilling.']);
    if (uv >= 3) {
      const win = uvH.length ? ` · ${hm(uvH[0].time)}–${hm(uvH[uvH.length - 1].time + HOUR)}` : '';
      A('SUNSCREEN', 'SPF50+', `UV ${R(uv)}${win}`, uv >= 8 ? 9 : 6, [`UV ${R(uv)}. The sun wants your skin. Don't let it win.`, 'Burn now, regret later. Or both, efficiently.', 'Reapply every 2h. Yes, really. No, your tan is not a personality.']);
    }
    if (sunny && uv >= 3) A('SUNGLASSES', 'Sunglasses', 'Direct sun', 5, ['Squinting ages you. So does this forecast.', 'Look mysterious. Or just see.']);
    if (uv >= 6) A('HAT', 'Hat or shade', `UV ${R(uv)} — cover up 11–3`, 6, ['Hat, shade or a strategic tree. Pick one.', 'No hat? Walk the shady side like a vampire.', 'Cover the scalp or dodge the sun 11–3. Your call, your sunburn.']);
    if (feelMin <= 7) A('GLOVES', 'Gloves', `Feels ${R(feelMin)}° in daylight`, 5, ['Fingers are non-refundable.', `${R(feelMin)}°. Your hands have filed a complaint.`]);
    const aqi = aqiFor(w, air);
    if (aqi != null && aqi > 100) A('MASK', 'P2 mask', `AQI ${aqi}`, 8, ['The air has texture today. Gross.', 'Breathing: now with extra chunks.']);
    return { date, next, items: out.sort((a, b) => b.pri - a.pri) };
  },

  bulletin(w, air, pollen, place, golfW) {
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
    const gw = golfW || w, sat = Golf.day(gw, Golf.defaultDay(gw));
    if (sat.best) P('GOLF', `Sat ${hm(sat.best.tee)} · ${sat.best.score}/100. ` + Caddie.banter(sat), sat.best.storm);
    P('SYS', 'Telemetry: Open-Meteo best-match blend. ATMOS-7 out.');
    return out;
  },
};

/* ---------- theme accent: time of day blended with temperature, around the colour wheel ---------- */
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbToHsv([r, g, b]) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; } return [fmod(h * 60, 360), mx ? d / mx : 0, mx]; }
function hsvToHex(h, s, v) { const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return '#' + [f(5), f(3), f(1)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join(''); }
function lerpHex(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); return '#' + A.map((x, i) => Math.round(x + (B[i] - x) * t).toString(16).padStart(2, '0')).join(''); }
function themeAccent(minute, rise, set, tempC, sky) {
  const keys = [[rise - 60, '#5b8cff'], [rise - 10, '#ffb067'], [rise + 50, '#00e5ff'], [set - 100, '#00e5ff'], [set - 20, '#ffb547'], [set + 20, '#ff8a3d'], [set + 75, '#5b8cff']];
  let tod = '#5b8cff';
  if (minute > keys[0][0] && minute < keys[keys.length - 1][0]) for (let k = 0; k < keys.length - 1; k++) { const [m0, c0] = keys[k], [m1, c1] = keys[k + 1]; if (minute >= m0 && minute <= m1) { tod = lerpHex(c0, c1, m1 > m0 ? (minute - m0) / (m1 - m0) : 0); break; } }
  const ts = [[2, '#7fd4ff'], [12, '#00f0d0'], [19, '#9dff5c'], [25, '#ffc23d'], [31, '#ff6a3d'], [38, '#ff3b30']];
  const t = isNaN(tempC) ? 18 : tempC;
  let tc; if (t <= ts[0][0]) tc = ts[0][1]; else if (t >= ts[5][0]) tc = ts[5][1]; else { const i = ts.findIndex(x => x[0] > t); tc = lerpHex(ts[i - 1][1], ts[i][1], (t - ts[i - 1][0]) / (ts[i][0] - ts[i - 1][0])); }
  const mix = (a, b, f) => { let d = b - a; if (d > 180) d -= 360; if (d < -180) d += 360; return fmod(a + d * f, 360); };
  const a = rgbToHsv(hexToRgb(tod)), b = rgbToHsv(hexToRgb(tc));
  let h = mix(a[0], b[0], 0.38); if (sky === 'STORM') h = mix(h, 215, 0.35);
  // No pinks or purples: hue blends that land in the magenta band snap to blue or orange.
  if (h > 255 && h < 345) h = h < 300 ? 225 : 20;
  return hsvToHex(h, Math.max(a[1], b[1]) * 0.85, 1);
}
function tempColor(t) {
  const st = [[-5, '#5b7bff'], [5, '#00b3ff'], [13, '#00f0d0'], [20, '#b6ff3d'], [26, '#ffd23d'], [32, '#ff7a3d'], [40, '#ff3b30']];
  if (isNaN(t)) return '#e6fbff'; if (t <= st[0][0]) return st[0][1]; if (t >= st[6][0]) return st[6][1];
  const i = st.findIndex(x => x[0] > t); return lerpHex(st[i - 1][1], st[i][1], (t - st[i - 1][0]) / (st[i][0] - st[i - 1][0]));
}
