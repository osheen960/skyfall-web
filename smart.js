/* Skyfall "intelligence" layer for the web (mirrors Android data/Smart.kt). Runs in the browser, stores to
   localStorage. Numbers shown stay Open-Meteo's; this layer only judges, learns and alerts.
   Not on the web: device calendar (browsers can't read it). Notifications need the page open or installed. */
const Smart = {
  /* ---------- comfort calibration: + = you run cold ---------- */
  Comfort: {
    offset() { return Store.get('comfort', 0) || 0; },
    votes() { return Store.get('comfortN', 0) || 0; },
    votedToday() { return Store.get('comfortDay', '') === new Date().toISOString().slice(0, 10); },
    vote(feel) {
      Store.set('comfort', Math.max(-5, Math.min(5, this.offset() * 0.75 + feel * 3 * 0.25)));
      Store.set('comfortN', this.votes() + 1); Store.set('comfortDay', new Date().toISOString().slice(0, 10));
    },
    label() {
      const o = this.offset(); if (this.votes() < 2 || Math.abs(o) < 0.5) return null;
      return `Tuned for you: you run ${Math.abs(o).toFixed(1)}° ${o > 0 ? 'cold' : 'warm'}`;
    },
  },
  /* ---------- habits: which activity you look at by weekday and time of day ---------- */
  Habits: {
    bucket() { const d = new Date(); return `${d.getDay()}-${Math.floor(d.getHours() / 3)}`; },
    record(id) { const k = 'hab_' + this.bucket(), o = Store.get(k, {}); o[id] = (o[id] || 0) + 1; Store.set(k, o); },
    suggest(allowed) { const o = Store.get('hab_' + this.bucket(), {}); return Object.keys(o).filter(k => allowed.includes(k) && o[k] >= 3).sort((a, b) => o[b] - o[a])[0] || null; },
  },
  /* ---------- model consensus (BoM ACCESS, ECMWF, GFS, ICON) ---------- */
  MODELS: ['bom_access_global', 'ecmwf_ifs025', 'gfs_seamless', 'icon_seamless'],
  async consensus(lat, lon) {
    const k = 'cons_' + placeKey(lat, lon); let c = Store.get(k, null);
    if (!c || Date.now() - c.at > 3 * HOUR) {
      try { Quota.acquire('open-meteo'); } catch { return c ? this.parseCons(c.j) : []; }
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&daily=temperature_2m_max,precipitation_sum&models=${this.MODELS.join(',')}&timezone=auto&forecast_days=7`);
      if (!r.ok) return c ? this.parseCons(c.j) : [];
      c = { at: Date.now(), j: await r.json() }; Store.set(k, c);
    }
    return this.parseCons(c.j);
  },
  parseCons(j) {
    const d = j && j.daily; if (!d) return [];
    return d.time.map((date, i) => {
      const val = (p, m) => { const a = d[`${p}_${m}`]; return a && a[i] != null ? a[i] : null; };
      const tmax = this.MODELS.map(m => val('temperature_2m_max', m)).filter(x => x != null), rain = this.MODELS.map(m => val('precipitation_sum', m)).filter(x => x != null);
      if (tmax.length < 2 || rain.length < 2) return null;
      const wet = rain.filter(x => x >= 1).length, n = rain.length, lo = Math.min(...tmax), hi = Math.max(...tmax);
      const split = wet >= 1 && wet < n && wet * 3 >= n && (n - wet) * 3 >= n;
      const level = split || hi - lo > 5 ? 0 : (wet === 0 || wet === n) && hi - lo <= 2.5 ? 2 : 1;
      const rainT = wet === 0 ? 'all dry' : wet === n ? 'all wet' : `${wet} of ${n} say rain`;
      return { date, level, text: `${['MODELS SPLIT', 'MOSTLY AGREE', 'MODELS AGREE'][level]} · ${rainT} · highs ${R(lo)}–${R(hi)}°` };
    }).filter(Boolean);
  },
  /* ---------- local check: forecast vs nearest station (when station readings are available) ---------- */
  Bias: {
    record(w) {
      const o = w && w.obs; if (!o || o.temperature == null || !o.at) return;
      const at = o.at + w.off * 1000, hr = at - (at % HOUR), h = w.hourly.find(x => x.time === hr); if (!h || isNaN(h.temperature)) return;
      const arr = Store.get('bias', []); if (arr.some(e => e.k === hr)) return;
      arr.push({ k: hr, d: o.temperature - h.temperature, h: new Date(hr).getUTCHours() });
      Store.set('bias', arr.filter(e => Date.now() + w.off * 1000 - e.k < 14 * DAY));
    },
    summary() {
      const all = Store.get('bias', []); if (all.length < 20) return all.length ? `Local check: learning from the nearest station (${all.length}/20 readings)` : null;
      const mean = l => l.reduce((s, e) => s + e.d, 0) / l.length;
      const day = all.filter(e => e.h >= 12 && e.h <= 17), night = all.filter(e => e.h < 7 || e.h > 19);
      const part = (l, n) => { if (l.length < 8) return null; const m = mean(l); return Math.abs(m) >= 0.8 ? `${n} ${Math.abs(m).toFixed(1)}° ${m < 0 ? 'cooler' : 'warmer'}` : null; };
      const parts = [part(day, 'afternoons'), part(night, 'nights')].filter(Boolean), days = new Set(all.map(e => dkey(e.k))).size;
      return parts.length ? `Local check: real ${parts.join(', ')} than forecast (${days} days, ${all.length} readings)` : `Local check: the forecast has matched your nearest station within a degree (${days} days)`;
    },
  },
  /* ---------- watched plan ---------- */
  Plans: {
    pin(act, t) { Store.set('plan', { a: act, t: t.tee, s: t.score, p: t.pop }); },
    clear() { Store.del('plan'); },
    get(w) { const p = Store.get('plan', null); return p && w && p.t > w.current.time - HOUR ? p : null; },
    is(act, t) { const p = Store.get('plan', null); return !!p && p.a === act && p.t === t.tee; },
    status(w, p) {
      const a = Activities.find(p.a); if (!a) return null;
      const win = Activities.day(w, dkey(p.t), a).windows.find(x => x.tee === p.t - p.t % HOUR); if (!win) return null;
      const drop = p.s - win.score, wetter = win.pop - p.p, worse = drop >= 15 || wetter >= 30;
      const why = wetter >= 30 ? `rain chance up to ${win.pop}% (was ${p.p}%)` : drop >= 15 ? `score ${win.score} (was ${p.s}), ${win.limiter.toLowerCase()} is the problem` : `still on: score ${win.score}, rain ${win.pop}%`;
      return { text: `${a.name} ${DOW[dow(p.t)]} ${hm(p.t)} · ${why}`, worse };
    },
  },
  /* ---------- commute ---------- */
  Commutes: {
    get() { return Store.get('commute', null); },
    set(c) { c ? Store.set('commute', c) : Store.del('commute'); },
    advice(home, work, c, aheadMin = 90) {
      const now = home.current.time, mid = T(dkey(now) + 'T00:00');
      for (const [min, dir, dest] of [[c.am, 'to work', work || home], [c.pm, 'home', home]]) {
        const leave = mid + min * MIN, until = (leave - now) / MIN; if (until < 0 || until > aheadMin) continue;
        const hrs = [home, dest].flatMap(w => w.hourly.filter(h => h.time >= leave - HOUR && h.time <= leave + HOUR));
        const wet = hrs.filter(h => (h.pop || 0) >= 50 || h.precip >= 0.3).sort((a, b) => a.time - b.time)[0], gust = Math.max(0, ...hrs.map(h => h.gust));
        if (wet && wet.time > leave) return `Commute ${dir}: rain from ${hm(wet.time)}. Leave by ${hm(leave)} and you'll likely beat it, or take the umbrella.`;
        if (wet) return `Commute ${dir} at ${hm(leave)}: wet (${wet.pop || 0}%). Umbrella, and allow extra time.`;
        if (gust >= 50) return `Commute ${dir} at ${hm(leave)}: gusts to ${R(gust)} km/h. Hold on to something.`;
        return `Commute ${dir} at ${hm(leave)}: dry. Off you go.`;
      }
      return null;
    },
    async work() {
      const c = this.get(); if (!c) return null;
      try { await Repo.refreshForecast(c.lat, c.lon, 30 * MIN); } catch { }
      return Repo.forecast(c.lat, c.lon);
    },
  },
  /* ---------- proactive tips (while the page is open or installed) ---------- */
  once(id, ttlH = 72) {
    const now = Date.now(), seen = Object.fromEntries(Object.entries(Store.get('smartSeen', {})).filter(([, t]) => now - t < ttlH * HOUR));
    if (seen[id]) return false; seen[id] = now; Store.set('smartSeen', seen); return true;
  },
  async proactive(w, place, acts, note) {
    if (!w || !Store.get('smartOn', true)) return;
    const today = dkey(w.current.time);
    // 1) A standout window this week for one of your activities.
    if (!Store.get('smartSeen', {})['best-day-' + today]) for (const id of acts) {
      const a = Activities.find(id); if (!a) continue;
      const days = w.daily.slice(1, 7).map(d => Activities.day(w, d.date, a).best).filter(Boolean).sort((x, y) => y.score - x.score);
      const top = days[0], second = days[1] ? days[1].score : 0;
      if (top && top.score >= 88 && top.score - second >= 5 && this.once('best-' + id + '-' + top.tee)) {
        this.once('best-day-' + today, 30);
        note(`${a.name}: best window this week`, `${DOWL[dow(top.tee)]} ${hm(top.tee)} scores ${top.score}. Rain ${top.pop}%, wind ${R(top.wind)} km/h, ${R(top.tMin)}–${R(top.tMax)}°.`, 'best'); break;
      }
    }
    // 2) Rain arriving in 15–30 minutes while it's dry now.
    try {
      Quota.acquire('open-meteo');
      const j = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.lat.toFixed(3)}&longitude=${place.lon.toFixed(3)}&minutely_15=precipitation&past_minutely_15=1&forecast_minutely_15=3&timezone=auto`)).json();
      const v = ((j.minutely_15 || {}).precipitation || []).map(x => x || 0);
      if (v.length >= 3 && v[0] < 0.05 && v[1] < 0.05 && v.slice(2).some(x => x >= 0.15) && w.current.code < 50 && this.once(`rainin-${today}-${Math.floor(new Date(w.current.time).getUTCHours() / 3)}`, 4)) {
        const mm = Math.max(...v.slice(2)) * 4;
        note('Rain in about 15–30 minutes', `${mm >= 2 ? 'Proper rain' : 'Light rain'} heading your way (~${mm.toFixed(1)} mm/h). Washing in, windows shut.`, 'rainin');
      }
    } catch { }
    // 3) Watched plan got worse.
    const p = this.Plans.get(w), st = p && this.Plans.status(w, p);
    if (st && st.worse && this.once(('plan-' + p.t + st.text).slice(0, 120), 12)) note('Your plan just got worse', st.text, 'plan');
    // 4) Commute advice within the hour before leaving.
    const c = this.Commutes.get();
    if (c) { const adv = this.Commutes.advice(w, await this.Commutes.work(), c, 60); if (adv && this.once(`commute-${today}-${adv.split(':')[0]}`, 12)) note('Commute', adv, 'commute'); }
  },
  /* ---------- Ask Skyfall ---------- */
  /** Resolves today / tomorrow / weekday / "6 am" in code so the model never does date maths (same as Android). */
  askTarget(q, now) {
    const t = q.toLowerCase(), today = T(dkey(now) + 'T00:00');
    const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    let day = today;
    if (/day after tomorrow/.test(t)) day = today + 2 * DAY;
    else if (/\b(tomorrow|tmrw|tmr|tomoz)\b/.test(t)) day = today + DAY;
    else if (!/\b(today|tonight|this (morning|arvo|afternoon|evening))\b/.test(t)) {
      const i = names.findIndex(n => new RegExp(`\\b(${n}|${n.slice(0, 3)}\\b)`).test(t));
      if (i >= 0) day = today + fmod(i - dow(today), 7) * DAY;
    }
    const m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b/);
    let hour = m ? (m[1] ? (+m[1] % 12) + (m[3] === 'pm' ? 12 : 0) : +m[4]) : /morning/.test(t) ? 8 : /arvo|afternoon/.test(t) ? 14 : /evening|tonight/.test(t) ? 19 : null;
    if (hour != null) hour = Math.max(0, Math.min(23, hour));
    return { day: dkey(day), hour };
  },
  dayName(date, today) {
    const ms = T(date + 'T00:00'), M = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const n = `${DOWL[dow(ms)]} ${+date.slice(8, 10)} ${M[+date.slice(5, 7) - 1]}`;
    if (!/^\d{4}-/.test(today)) return n;
    return date === today ? `today (${n})` : date === dkey(T(today + 'T00:00') + DAY) ? `tomorrow (${n})` : n;
  },
  askContext(w, city, alerts, acts, question = '') {
    const c = w.current, today = dkey(c.time), L = [], { day, hour } = this.askTarget(question, c.time);
    L.push(`Location: ${city}. It is now ${this.dayName(today, '-')}, ${hm(c.time)} local time. Today is ${this.dayName(today, '-')}; tomorrow is ${this.dayName(dkey(c.time + DAY), '-')}.`);
    L.push(`Right now: ${R(c.temperature)}°C (feels ${R(c.feelsLike)}°C), ${Codes.label(c.code).toLowerCase()}, wind ${R(c.windSpeed)} km/h gusting ${R(c.windGusts)}.`, '');
    L.push(`THE QUESTION IS ABOUT: ${this.dayName(day, today).toUpperCase()}${hour != null ? ` AT ${String(hour).padStart(2, '0')}:00` : ''}`);
    const d = dayOf(w, day);
    L.push(d ? `That day: ${R(d.min)}–${R(d.max)}°C, rain chance up to ${d.popMax || 0}%, ${f1(d.precipSum || 0)} mm total, UV ${R(d.uvMax || 0)}, sunrise ${hm(d.sunrise)}, sunset ${hm(d.sunset)}.` : 'That day is beyond the forecast range: say so.');
    const hrs = w.hourly.filter(h => dkey(h.time) === day && hourOf(h.time) >= 5 && hourOf(h.time) <= 22);
    if (hrs.length) { L.push('Hour by hour that day (time · temp · rain chance · mm · wind/gust km/h · sky):'); hrs.forEach(h => L.push(`${hm(h.time)} · ${R(h.temperature)}° · ${h.pop || 0}% · ${f1(h.precip)} mm · ${R(h.wind)}/${R(h.gust)} · ${Codes.label(h.code).toLowerCase()}`)); }
    acts.map(id => Activities.find(id)).filter(Boolean).forEach(a => {
      const g = Activities.day(w, day, a), at = hour != null ? g.windows.find(x => hourOf(x.tee) === hour) : null;
      L.push(`${a.name} that day: ` + (!g.best ? 'no usable window.' : `best start ${hm(g.best.tee)} (score ${g.best.score}/100, main problem: ${g.best.limiter.toLowerCase()})` + (at ? `; starting at ${hm(at.tee)} scores ${at.score}/100 (rain ${at.pop}%, wind ${R(at.wind)} gust ${R(at.gust)}, main problem: ${at.limiter.toLowerCase()})` : '') + '.'));
    });
    L.push('Warnings: ' + (alerts.map(a => a.title).join('; ') || 'none'), '', 'Rest of the week (day · min–max · rain chance · mm):');
    w.daily.slice(0, 7).forEach(x => L.push(`${this.dayName(x.date, today)} · ${R(x.min)}–${R(x.max)}° · ${x.popMax || 0}% · ${f1(x.precipSum || 0)} mm`));
    return L.join('\n');
  },
  /* The browser's built-in AI (Chrome's on-device Gemini Nano) when present, else the user's own Gemini key. */
  async localModel() {
    try {
      const LM = self.LanguageModel; if (!LM) return null;
      const a = await LM.availability(); if (a === 'unavailable') return null;
      return a;
    } catch { return null; }
  },
  async ask(system, prompt) {
    const LM = self.LanguageModel;
    if (LM && (await this.localModel()) === 'available') {
      try { const s = await LM.create({ initialPrompts: [{ role: 'system', content: system }] }); const t = await s.prompt(prompt); s.destroy && s.destroy(); if (t && t.trim()) return t.trim(); } catch { }
    }
    if (!VoiceKeys.gemini) throw new Error(LM ? "Your browser's built-in AI isn't ready yet. Add your own Gemini key in Settings › Voice, or try again later." : 'Add your own free Gemini key in Settings › Voice to ask questions (Chrome with built-in AI works without one).');
    return (await Voicebox.gemini(system, prompt, { temp: 0.8 })).replace(/[*#_`]/g, '').trim();
  },
};
