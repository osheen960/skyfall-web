/* Skyfall INTEL + broadcasts for the web (mirrors Android data/Voicebox.kt + Broadcast.kt).
   News feeds can't be read from a browser (no CORS), so headlines come from Gemini with Google Search
   grounding, using the user's own free AI Studio key. Voice: Cloud Text-to-Speech (Chirp 3 HD en-GB)
   with the user's key, else the browser's best British voice. Nothing goes anywhere else. */
const VoiceKeys = {
  get gemini() { return Store.get('kGemini', ''); }, get tts() { return Store.get('kTts', '') || Store.get('kGemini', ''); },
  set(g, t) { Store.set('kGemini', (g || '').trim()); Store.set('kTts', (t || '').trim()); },
};
const Voicebox = {
  MODELS: ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3-flash', 'gemini-2.0-flash'],
  voiceFor: p => ({ deadpan: 'Charon', rebel: 'Puck', seer: 'Kore', caddie: 'Algenib', academy: 'Aoede', survivor: 'Fenrir', ghostwire: 'Zephyr', aeronaut: 'Iapetus' }[p] ? 'en-GB-Chirp3-HD-' + { deadpan: 'Charon', rebel: 'Puck', seer: 'Kore', caddie: 'Algenib', academy: 'Aoede', survivor: 'Fenrir', ghostwire: 'Zephyr', aeronaut: 'Iapetus' }[p] : 'en-GB-Chirp3-HD-Charon'),
  async hash(s) { const b = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s)); return [...new Uint8Array(b)].slice(0, 10).map(x => x.toString(16).padStart(2, '0')).join(''); },
  /* Ask the API which models this key can use (names change often), best Flash first. Cached a day. */
  async models(key) {
    const c = Store.get('gModels', null); if (c && c.k === key.slice(-6) && Date.now() - c.at < 86400000) return c.list;
    let list = [];
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } }), j = await r.json();
      if (!r.ok) throw new Error(j.error?.message || 'HTTP ' + r.status);
      list = (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, ''))
        .filter(n => /^gemini-/.test(n) && !/(tts|image|live|audio|embed|vision|thinking|robotics|computer|exp)/.test(n));
      const ver = n => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
      const score = n => ver(n) * 100 + (/flash/.test(n) ? 20 : 0) - (/lite/.test(n) ? 8 : 0) - (/preview/.test(n) ? 3 : 0) + (/latest/.test(n) ? 1 : 0) - (/pro/.test(n) ? 30 : 0);
      list.sort((a, b) => score(b) - score(a));
    } catch (e) { if (/API key|PERMISSION|UNAUTH/i.test(e.message)) throw e; }
    if (!list.length) list = this.MODELS;
    Store.set('gModels', { k: key.slice(-6), at: Date.now(), list }); return list;
  },
  async gemini(system, prompt, { search = false, temp = 0.9 } = {}) {
    const key = VoiceKeys.gemini; if (!key) throw new Error('No Gemini key');
    const body = { system_instruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: temp, maxOutputTokens: 1600 } };
    if (search) body.tools = [{ google_search: {} }];
    const pref = Store.get('gModel', null), avail = await this.models(key); let first;
    let busy = 0;
    for (const m of [pref, ...avail.filter(x => x !== pref)].filter(Boolean).slice(0, 6)) {
      try {
        let r, j, wait = 1500;
        for (let a = 0; a < 3; a++) {   // short backoff on Google's "busy" answers
          r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
          j = await r.json();
          if (![429, 500, 503].includes(r.status) || a === 2) break;
          await new Promise(res => setTimeout(res, wait)); wait *= 2;
        }
        if ([429, 500, 503].includes(r.status)) busy++;
        if (!r.ok) { const er = new Error(`${m}: ${j.error?.message || 'HTTP ' + r.status}`); first = first || er; if (r.status === 401 || r.status === 403 || /API key/.test(er.message)) throw er; if (pref === m) Store.del('gModel'); continue; }
        const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
        if (!text.trim()) continue;
        Store.set('gModel', m); return text;
      } catch (e) { first = first || e; if (/API key|PERMISSION/.test(e.message)) throw e; }
    }
    if (search && !busy) return this.gemini(system, prompt, { search: false, temp });   // some models/tiers lack Search grounding
    if (busy) throw new Error("Google's AI is overloaded right now. Try again in a minute.");
    throw first || new Error('No script');
  },
  async write(system, prompt, opts) {
    const h = 's_' + await this.hash(system + '\0' + prompt), c = Store.get(h, null); if (c) return c;
    const t = await this.gemini(system, prompt, opts);
    const segs = t.replace(/[*#_`>\[\]]/g, '').replace(/\((?:pause|static|beat|sfx)[^)]*\)/gi, '').split(/\n\s*\n/).map(s => s.replace(/\s+/g, ' ').trim()).filter(s => s.length > 2);
    Store.set(h, segs); return segs;
  },
  async speak(text, voice) {
    const key = VoiceKeys.tts; if (!key) return null;
    const syn = async v => {
      const r = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ input: { text }, voice: { languageCode: 'en-GB', name: v }, audioConfig: { audioEncoding: 'MP3' } }) });
      const j = await r.json(); if (!r.ok) { const e = new Error(j.error?.message || 'HTTP ' + r.status); e.code = r.status; throw e; } return j.audioContent;
    };
    let b64; try { b64 = await syn(voice); } catch (e) { if (e.code === 400 && !/Neural2/.test(voice)) b64 = await syn('en-GB-Neural2-B'); else throw e; }
    return 'data:audio/mpeg;base64,' + b64;
  },
  style() {
    const p = Voice.persona();
    const s = [Voice.line('SITREP', 'CLOUDY', 1), Voice.line('THERMAL', 'SWING', 2), Voice.line('BRIEF', 'BYE', 0), Voice.line('NEWS', 'INTRO', 0)].filter(Boolean).join(' | ');
    return `Persona: ${p ? p.name : 'Deadpan'} - ${p ? p.tagline : 'dark, dry, wildly unhinged humour'}. Sample lines in this voice: ${s}`;
  },
  RULES: `
Rules:
- Speak in natural British English, as a radio host on a futuristic orbital comms channel. Contractions, rhythm, the odd aside. Never robotic.
- Keep the persona's attitude and humour throughout, adapted to each item, not a fixed intro or template.
- Aim wit at absurdity, bureaucracy, politicians, the weather and the listener's plans. Never joke about deaths, injuries, victims, crime against people, disasters, war casualties or tragedies: for those, drop the humour, be brief and respectful.
- Use only facts and numbers given below (or found by search where allowed). Never invent names, figures, quotes or events.
- Plain spoken text only: no markdown, lists, emojis, stage directions, URLs or sound cues. Say numbers the way people say them.
- Put a blank line between segments. Each segment is a short paragraph of one to three sentences.
`,
  newsPrompt(f, city, state) {
    const sys = `You write and host Skyfall INTEL, a spoken news round-up.\n${this.style()}\n${this.RULES}- Structure: a one-line opening; then local, national and world stories (most important first), each retold in your own words with a short spoken transition; then a one-line sign-off. Do not read headlines verbatim.\n- Under 330 words.`;
    const L = (tag, l, n) => (l || []).slice(0, n).map(x => `[${tag}] ${x.title} :: ${(x.summary || '').slice(0, 220)}`).join('\n');
    return [sys, `Listener: ${city}, ${state || 'Australia'}. Local time ${new Date().toTimeString().slice(0, 5)}.\nStories:\n` + [L('LOCAL', f.local, 4), L('NATIONAL', f.national, 4), L('WORLD', f.world, 5)].filter(Boolean).join('\n')];
  },
  dayPrompt(w, city, alerts) {
    const sys = `You write and host the Skyfall daily briefing: a spoken round-up of the listener's whole day.\n${this.style()}\n${this.RULES}- Structure: a time-appropriate greeting; any warnings or hazards first (official warnings, floods, fires, major traffic or public transport disruption, emergencies near ${city}) with what to do; then the day's weather arc (morning, afternoon, evening) with what to wear or carry; then a short verdict for each of the listener's activities with the best time; then a sign-off.\n- You may use Google Search ONLY to check for current official warnings, floods, fires, major traffic incidents or transport disruptions near ${city} today. Weather numbers must come from the data given, never from search.\n- If there are no warnings or hazards, say the board is clear in one line.\n- Under 260 words.`;
    const c = w.current, t0 = dkey(c.time), nowH = c.time - (c.time % HOUR);
    const hrs = w.hourly.filter(h => dkey(h.time) === t0 && h.time >= nowH), hr = h => new Date(h.time).getUTCHours();
    const seg = (n, a, b) => { const hs = hrs.filter(h => hr(h) >= a && hr(h) <= b); if (!hs.length) return null;
      const mx = k => Math.max(...hs.map(h => h[k] || 0)), cnt = {}; hs.forEach(h => cnt[h.code] = (cnt[h.code] || 0) + 1);
      return `${n}: ${Math.round(Math.min(...hs.map(h => h.temperature)))}-${Math.round(mx('temperature'))}C, rain chance up to ${mx('pop')}%, rain ${hs.reduce((s, h) => s + (h.precip || 0), 0).toFixed(1)}mm, wind ${Math.round(mx('wind'))}km/h gusting ${Math.round(mx('gust'))}, UV max ${Math.round(mx('uv'))}, ${Codes.label(+Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0])}`; };
    const d = w.daily[0], hm = ms => new Date(ms).toISOString().slice(11, 16);
    const acts = SkyPrefs.activities.map(id => Activities.find(id)).filter(Boolean).map(a => { const b = Activities.day(w, t0, a).best;
      return b ? `${a.name}: best at ${hm(b.tee)} score ${b.score}/100, ${Math.round(b.tMin)}-${Math.round(b.tMax)}C, rain ${b.pop}%, wind ${Math.round(b.wind)} gust ${Math.round(b.gust)}${b.limiter ? ', limiter ' + b.limiter : ''}` : `${a.name}: no good window today`; }).join('\n');
    const p = [`Listener: ${city}. Now ${hm(c.time)}, ${t0}.`,
      `Now: ${Math.round(c.temperature)}C feels ${Math.round(c.feelsLike)}C, ${Codes.label(c.code)}, humidity ${c.humidity}%, wind ${Math.round(c.windSpeed)} gusting ${Math.round(c.windGusts)}km/h.`,
      d ? `Today: low ${Math.round(d.min)}C high ${Math.round(d.max)}C, rain chance ${d.popMax || 0}%, rain total ${(d.precipSum || 0).toFixed(1)}mm, UV max ${Math.round(d.uvMax || 0)}, sunset ${hm(d.sunset)}.` : '',
      seg('Morning', 5, 11), seg('Afternoon', 12, 17), seg('Evening', 18, 23),
      SkyState.air?.usAqi != null ? `Air quality: US AQI ${SkyState.air.usAqi}.` : '',
      'Model warnings: ' + (alerts.map(a => `${Alerts.name(a.level)} ${a.title} ${a.body.slice(0, 160)}`).join('; ') || 'none'),
      'Activities:\n' + (acts || 'none chosen')].filter(Boolean).join('\n');
    return [sys, p];
  },
};

/* Headlines via Gemini + Google Search (browser can't read RSS). Cached 30 minutes. */
const Intel = {
  async get(city, state, force = false) {
    const c = Store.get('intel', null);
    if (!force && c && c.city === city && Date.now() - c.at < 30 * 60000) return c;
    const sys = 'You are a news wire. Use Google Search to find today\'s real, current top news. Return ONLY JSON, no prose, no code fences.';
    const prompt = `Today is ${new Date().toDateString()}. Find the current top news stories:\n- "local": 6 stories for ${city}, ${state || 'Australia'} (state/city news)\n- "national": 6 Australian national stories\n- "world": 8 world stories\nEach item: {"title": headline, "summary": one factual sentence, "source": publisher name, "url": article URL if known, "hoursAgo": number}.\nOutput: {"local":[...],"national":[...],"world":[...]}`;
    const t = await Voicebox.gemini(sys, prompt, { search: true, temp: 0.2 });
    const m = t.match(/\{[\s\S]*\}/); if (!m) throw new Error('No headlines returned');
    const j = JSON.parse(m[0]), fix = a => (a || []).filter(x => x && x.title).map(x => ({ title: String(x.title), summary: String(x.summary || ''), source: String(x.source || ''), url: /^https?:\/\//.test(x.url || '') ? x.url : '', at: Date.now() - (+x.hoursAgo || 0) * HOUR }));
    const out = { city, at: Date.now(), local: fix(j.local), national: fix(j.national), world: fix(j.world) };
    Store.set('intel', out); return out;
  },
};

/* Player: Cloud TTS clips when keyed, otherwise speechSynthesis with the best en-GB voice. */
const Broadcast = {
  kind: null, preparing: false, playing: false, seg: -1, script: [], status: '', adaptive: false, _tok: 0, _audio: null,
  onChange: () => {},
  _set(o) { Object.assign(this, o); this.onChange(); },
  stop() { this._tok++; try { this._audio && this._audio.pause(); } catch (e) {} speechSynthesis.cancel(); this._set({ kind: null, preparing: false, playing: false, seg: -1 }); },
  async start(kind, prompt, fallback, opts = {}) {
    this.stop(); const tok = ++this._tok;
    this._set({ kind, preparing: true, status: 'ENCODING TRANSMISSION…', adaptive: false });
    let lines = fallback;
    if (prompt) {
      // Always written fresh; never just read the on-screen text back.
      const hold = () => { this._set({ preparing: false }); setTimeout(() => { if (tok === this._tok && !this.playing) this._set({ kind: null }); }, 6000); };
      if (!VoiceKeys.gemini) { this.status = 'NO SCRIPT UPLINK · ADD A FREE GEMINI KEY IN SETTINGS › VOICE'; return hold(); }
      try { lines = await Voicebox.write(prompt[0], prompt[1], opts); this.adaptive = true; } catch (e) { this.status = 'SCRIPT UPLINK FAILED: ' + String(e.message).slice(0, 80); return hold(); }
    }
    if (tok !== this._tok) return;
    let clips = lines.map(() => null);
    if (VoiceKeys.tts) {
      this._set({ status: 'SYNTHESISING VOICE…' });
      try { clips = await Promise.all(lines.map(l => Voicebox.speak(l, Voicebox.voiceFor(SkyPrefs.persona)))); } catch (e) { this.status = 'VOICE UPLINK FAILED (' + String(e.message).slice(0, 60) + ') · BROWSER VOICE'; }
    }
    if (tok !== this._tok) return;
    this._set({ preparing: false, playing: true, script: lines, seg: -1 });
    const done = () => tok === this._tok;
    await this._static(); 
    for (let i = 0; i < lines.length && done(); i++) { this._set({ seg: i }); await (clips[i] ? this._clip(clips[i]) : this._say(lines[i])); }
    if (done()) { await this._static(); this._set({ kind: null, playing: false, seg: -1 }); }
  },
  _clip(src) { return new Promise(r => { const a = new Audio(src); this._audio = a; a.onended = a.onerror = () => r(); a.play().catch(() => r()); }); },
  _static() { return new Promise(r => { const a = new Audio('sounds/static_burst.wav'); a.volume = 0.35; this._audio = a; a.onended = a.onerror = () => r(); a.play().catch(() => r()); }); },
  _say(t) {
    return new Promise(r => {
      const u = new SpeechSynthesisUtterance(t), vs = speechSynthesis.getVoices().filter(v => /en[-_]GB/i.test(v.lang));
      u.voice = vs.find(v => /natural|neural|online|google/i.test(v.name)) || vs[0] || null; u.lang = 'en-GB'; u.rate = 1; u.pitch = 1;
      u.onend = u.onerror = () => r(); speechSynthesis.speak(u);
    });
  },
};

/* Fresh daily loadout lines (Gemini, persona voice, today's numbers). Cached; renders on next paint. */
const LoFresh = {
  busy: {},
  key(lo, p) { return 'lo_' + p + '_' + lo.date + '_' + lo.items.map(i => i.gear + i.reason).join('|').replace(/[^A-Za-z0-9|]/g, '').slice(0, 160); },
  get(lo, p) {
    if (!VoiceKeys.gemini || !lo.items.length) return null;
    const k = this.key(lo, p), c = Store.get(k, null); if (c) return c;
    if (this.busy[k]) return null; this.busy[k] = true;
    const sys = `You write the one-line gear tips on the Skyfall weather console's loadout tiles.\n${Voicebox.style()}\nRules: one line per item, 6 to 16 words, in the persona's voice and humour, specific to today's numbers given. Vary wording and jokes; never generic. No emojis, no markdown. Use only the numbers given. Return ONLY a JSON object mapping each item code to its line.`;
    const pr = `Date: ${lo.date}.\nItems:\n` + lo.items.map(i => `${i.gear}: ${i.title} - ${i.reason}`).join('\n');
    Voicebox.gemini(sys, pr, { temp: 1 }).then(t => { const m = t.match(/\{[\s\S]*\}/); if (m) { Store.set(k, JSON.parse(m[0])); window.dispatchEvent(new Event('skyfall:refresh')); } }).catch(() => {}).finally(() => { delete this.busy[k]; });
    return null;
  },
};
