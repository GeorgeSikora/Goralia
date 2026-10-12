/*
 * Hudba na pozadí: vlastní skladby (žádné cizí nahrávky ani melodie), syntetizované přes Web Audio.
 *
 *  - ve hře: podhalanská lidová muzika – prim (melodické housle), sekund (housle s akordy na doby)
 *    a basy; podhalanská stupnice G se zvýšenou kvartou (C#) a malou septimou (F).
 *    Klid = pomalejší „wierchowa“, boj = rychlý tanec „krzesany“ s bubnem.
 *  - v menu: středověká skladba v d dórské – loutna, zobcová flétna a bordun.
 *
 * Plánování dopředu (lookahead) drží rytmus přesně i při zatížení hry.
 * Nastavení: zapnuto/vypnuto a vlastní hlasitost (localStorage pk-music, pk-music-vol).
 */
(() => {
  "use strict";

  const PK = window.PK;
  const A = PK.audio;

  /* ---------- noty ---------- */
  const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  function midi(name) {
    const m = /^([A-G])([#b]?)(\d)$/.exec(name);
    if (!m) return null;
    return 12 * (Number(m[3]) + 1) + SEMI[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  }

  const hz = n => 440 * Math.pow(2, (n - 69) / 12);

  // "D5 E5:2 -:2 | ..." -> [{ n, len }] (délka v šestnáctinách, výchozí unit)
  function parse(str, unit = 1) {
    const out = [];
    for (const tok of str.split(/\s+/)) {
      if (!tok || tok === "|") continue;
      const [name, l] = tok.split(":");
      out.push({ n: name === "-" ? null : midi(name), len: l ? Number(l) : unit });
    }
    return out;
  }

  // akord: kořen + typ -> půltóny od kořene
  const CHORD = { "": [0, 4, 7], m: [0, 3, 7], "7": [0, 4, 7, 10], sus: [0, 5, 7] };

  function chord(name) {
    const m = /^([A-G][#b]?)(m|7|sus)?$/.exec(name);
    const root = midi(`${m[1]}2`);
    return { root, tones: CHORD[m[2] || ""] };
  }

  /* ---------- skladby (všechny originální) ---------- */
  // bar = šestnáctin v taktu, style = doprovod, mel = melodie, chords = akord na takt
  const TUNES = [
    {
      id: "krzesany", scene: "battle", tempo: 138, bar: 8, style: "goral2",
      mel: `
        D5 D5 B4 D5 E5 D5 C#5 B4 | A4 B4 C#5 A4 D5:2 D5:2 | G5 F5 E5 D5 C#5 E5 D5 C#5 | B4 C#5 D5 B4 A4:2 -:2 |
        D5 D5 B4 D5 E5 D5 C#5 B4 | A4 B4 C#5 D5 E5 F5 G5 E5 | D5 C#5 B4 C#5 D5 B4 A4 C#5 | G4:2 B4 D5 G4:2 -:2 |
        G5 G5 F5 E5 F5 G5 A5 G5 | F5 E5 D5 E5 F5:2 D5:2 | E5 D5 C#5 B4 C#5 D5 E5 C#5 | D5:4 A4:2 -:2 |
        G5 G5 F5 E5 F5 G5 A5 G5 | F5 E5 D5 C#5 D5 E5 F5 E5 | D5 B4 G4 B4 D5 C#5 B4 A4 | G4:4 -:4`,
      chords: "G D G D G D D G F F A D F F D G"
    },
    {
      id: "hola", scene: "battle", tempo: 132, bar: 8, style: "goral2",
      mel: `
        G4 B4 D5 G5 F5:2 E5:2 | D5 E5 F5 E5 D5:2 C#5:2 | D5 C#5 B4 A4 B4 C#5 D5 E5 | F5:4 E5:4 |
        G5 F5 E5 F5 G5 A5 G5 F5 | E5 F5 E5 D5 C#5:2 A4:2 | B4 C#5 D5 E5 F5 E5 D5 C#5 | D5:4 -:4 |
        A5 G5 F5 G5 A5:2 G5:2 | F5 E5 D5 E5 F5:2 E5:2 | D5 E5 C#5 D5 B4 C#5 A4 B4 | G4 A4 B4 C#5 D5:2 -:2 |
        A5 G5 F5 G5 A5:2 G5:2 | F5 E5 D5 C#5 D5:2 B4:2 | C#5 D5 E5 C#5 D5 B4 A4 F#4 | G4:4 G4:2 -:2`,
      chords: "G F A F G A A D F F A G F D A G"
    },
    {
      id: "wierchowa", scene: "peace", tempo: 84, bar: 12, style: "goral3",
      mel: `
        D5:4 E5:2 D5:2 B4:4 | A4:4 B4:2 C#5:2 D5:4 | E5:6 D5:2 C#5:2 B4:2 | A4:12 |
        D5:4 E5:2 F5:2 G5:4 | F5:4 E5:2 D5:2 C#5:4 | D5:2 E5:2 D5:2 B4:2 A4:2 B4:2 | G4:12 |
        G5:4 A5:2 G5:2 F5:4 | E5:4 F5:2 E5:2 D5:4 | C#5:4 D5:2 E5:2 C#5:2 A4:2 | D5:12 |
        B4:4 C#5:2 D5:2 E5:4 | F5:6 E5:2 D5:4 | C#5:2 B4:2 A4:2 B4:2 C#5:2 A4:2 | G4:12`,
      chords: "G G A D G F A G F C A D G F A G"
    },
    {
      id: "pastersko", scene: "peace", tempo: 92, bar: 12, style: "goral3",
      mel: `
        G4:2 B4:2 D5:2 G5:4 F5:2 | E5:4 D5:2 C#5:4 D5:2 | E5:2 F5:2 E5:2 D5:4 B4:2 | A4:8 -:4 |
        A4:2 C#5:2 E5:2 A5:4 G5:2 | F5:4 E5:2 D5:4 C#5:2 | D5:2 E5:2 C#5:2 B4:4 A4:2 | G4:8 -:4`,
      chords: "G A A D A F A G"
    },
    {
      id: "kral", scene: "menu", tempo: 96, bar: 12, style: "medieval",
      mel: `
        D5:4 F5:2 G5:4 A5:2 | C6:4 A5:2 G5:4 F5:2 | E5:4 G5:2 F5:4 E5:2 | D5:12 |
        A5:4 G5:2 F5:4 E5:2 | F5:4 G5:2 A5:4 F5:2 | G5:4 E5:2 C5:4 E5:2 | D5:12 |
        F5:2 G5:2 A5:2 C6:4 A5:2 | G5:4 F5:2 E5:4 D5:2 | C5:4 D5:2 E5:4 G5:2 | A5:12 |
        A5:4 G5:2 F5:4 E5:2 | D5:4 E5:2 F5:4 A4:2 | C5:4 E5:2 D5:4 C#5:2 | D5:12`,
      chords: "Dm C Am Dm F C C Dm F C C Am Dm Dm A Dm"
    },
    {
      id: "studanka", scene: "menu", tempo: 88, bar: 12, style: "medieval",
      mel: `
        A4:2 D5:2 E5:2 F5:4 E5:2 | D5:4 C5:2 A4:6 | G4:2 A4:2 C5:2 D5:4 E5:2 | D5:12 |
        F5:2 G5:2 A5:2 G5:4 F5:2 | E5:4 C5:2 D5:4 E5:2 | F5:4 E5:2 D5:4 C#5:2 | D5:12`,
      chords: "Dm C C Dm F C A Dm"
    }
  ];

  for (const t of TUNES) {
    t.notes = parse(t.mel);
    t.harm = t.chords.split(/\s+/).filter(Boolean).map(chord);
    t.length = t.notes.reduce((s, x) => s + x.len, 0);
  }

  /* ---------- nastavení ---------- */
  let enabled = true;
  let level = 0.6;

  try {
    enabled = localStorage.getItem("pk-music") !== "0";
    const v = parseFloat(localStorage.getItem("pk-music-vol"));
    if (isFinite(v)) level = Math.max(0, Math.min(1, v));
  } catch (e) { /* storage unavailable */ }

  /* ---------- zvukový řetězec ---------- */
  let M = null;   // { ctx, bus, noise }
  let out = null; // hlasitost hudby
  let wet = null; // dozvuk

  const gainNow = () => (enabled ? 0.5 * level : 0.0001);

  function setup() {
    if (M) return true;
    const m = A.music();
    if (!m) return false;
    build(m, 0.0001);
    return true;
  }

  // řetězec nad daným kontextem (živým, nebo offline pro ukázku)
  function build(m, gain) {
    M = m;
    const ctx = M.ctx;

    out = ctx.createGain();
    out.gain.value = gain;
    out.connect(M.bus);

    // dozvuk: stereo impulz z doznívajícího šumu (kostel / dřevěnice)
    const len = Math.round(ctx.sampleRate * 2.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    wet = ctx.createGain();
    wet.gain.value = 0.32;
    wet.connect(conv).connect(out);
  }

  // každý nástroj: zdroj -> obálka -> (pan) -> out + kus do dozvuku
  function voice(t, dur, peak, pan, reverb, build) {
    const ctx = M.ctx;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    let dest = env;

    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      env.connect(p);
      dest = p;
    }

    dest.connect(out);
    if (reverb) {
      const s = ctx.createGain();
      s.gain.value = reverb;
      dest.connect(s).connect(wet);
    }

    build(env, peak);
    return env;
  }

  function osc(type, f, t, end, dest, detune = 0) {
    const o = M.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.detune.value = detune;
    o.connect(dest);
    o.start(t);
    o.stop(end);
    return o;
  }

  function vibrato(oscs, t, end, f, depth, delay) {
    const ctx = M.ctx;
    const l = ctx.createOscillator();
    const g = ctx.createGain();
    l.frequency.value = 5.4 + Math.random() * 0.6;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(f * depth, t + delay);
    l.connect(g);
    for (const o of oscs) g.connect(o.frequency);
    l.start(t);
    l.stop(end);
  }

  // prim: dvě rozladěné pily přes filtr, smyčcový náběh a vibrato
  function fiddle(t, f, dur, v, pan = -0.15) {
    const end = t + dur + 0.08;
    voice(t, dur, v, pan, 0.35, (env, peak) => {
      const lp = M.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(2400, t);
      lp.frequency.linearRampToValueAtTime(3400, t + Math.min(0.12, dur));
      lp.Q.value = 1.2;
      const hp = M.ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 260;
      lp.connect(hp).connect(env);

      const a = osc("sawtooth", f, t, end, lp, -5);
      const b = osc("sawtooth", f, t, end, lp, 6);
      if (dur > 0.22) vibrato([a, b], t, end, f, 0.006, Math.min(0.2, dur * 0.5));

      env.gain.exponentialRampToValueAtTime(peak, t + 0.025);
      env.gain.exponentialRampToValueAtTime(peak * 0.72, t + Math.min(dur, 0.12));
      env.gain.setValueAtTime(peak * 0.72, t + Math.max(0.03, dur - 0.03));
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.06);
    });
  }

  // sekund: krátký úderný akord (dvojhmat) na doby
  function second(t, freqs, dur, v) {
    const end = t + dur + 0.06;
    voice(t, dur, v, 0.25, 0.25, (env, peak) => {
      const lp = M.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1900;
      lp.connect(env);
      for (const f of freqs) osc("sawtooth", f, t, end, lp, (Math.random() - 0.5) * 10);
      env.gain.exponentialRampToValueAtTime(peak, t + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    });
  }

  // basy: tmavý smyčcový tón
  function bass(t, f, dur, v) {
    const end = t + dur + 0.08;
    voice(t, dur, v, 0, 0.12, (env, peak) => {
      const lp = M.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 520;
      lp.Q.value = 1.4;
      lp.connect(env);
      osc("sawtooth", f, t, end, lp);
      osc("triangle", f / 2, t, end, lp);
      env.gain.exponentialRampToValueAtTime(peak, t + 0.02);
      env.gain.exponentialRampToValueAtTime(peak * 0.5, t + dur * 0.6);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    });
  }

  // loutna: drnknutí s rychlým doznětím
  function lute(t, f, v, pan = 0.2) {
    const dur = 0.9;
    voice(t, dur, v, pan, 0.3, (env, peak) => {
      const lp = M.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(3800, t);
      lp.frequency.exponentialRampToValueAtTime(700, t + 0.35);
      lp.connect(env);
      osc("triangle", f, t, t + dur, lp);
      osc("square", f, t, t + dur, lp, 7);
      osc("sine", f * 2, t, t + dur, lp);
      env.gain.exponentialRampToValueAtTime(peak, t + 0.004);
      env.gain.exponentialRampToValueAtTime(peak * 0.35, t + 0.12);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    });
  }

  // zobcová flétna: čistý tón, dech a lehké vibrato
  function recorder(t, f, dur, v) {
    const end = t + dur + 0.1;
    voice(t, dur, v, -0.2, 0.4, (env, peak) => {
      const a = osc("sine", f, t, end, env);
      const b = osc("triangle", f, t, end, env, 3);
      if (dur > 0.25) vibrato([a, b], t, end, f, 0.004, 0.25);

      const n = M.ctx.createBufferSource();
      n.buffer = M.noise;
      n.loop = true;
      const bp = M.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = f * 2;
      bp.Q.value = 6;
      const ng = M.ctx.createGain();
      ng.gain.value = 0.35;
      n.connect(bp).connect(ng).connect(env);
      n.start(t);
      n.stop(end);

      env.gain.exponentialRampToValueAtTime(peak, t + 0.05);
      env.gain.setValueAtTime(peak, t + Math.max(0.06, dur - 0.05));
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    });
  }

  // bordun: dudácký prodlevový tón pod středověkou skladbou
  function drone(t, f, dur, v) {
    voice(t, dur, v, 0, 0.3, (env, peak) => {
      const lp = M.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 650;
      lp.connect(env);
      osc("sawtooth", f, t, t + dur + 0.3, lp, -4);
      osc("sawtooth", f * 1.5, t, t + dur + 0.3, lp, 4);
      env.gain.linearRampToValueAtTime(peak, t + 0.4);
      env.gain.setValueAtTime(peak, t + dur - 0.1);
      env.gain.linearRampToValueAtTime(0.0001, t + dur + 0.25);
    });
  }

  // buben: dupnutí (nízký úder) a lehký plesk
  function drum(t, v, low) {
    voice(t, 0.3, v, 0, 0.15, (env, peak) => {
      const o = osc("sine", low ? 72 : 120, t, t + 0.3, env);
      o.frequency.exponentialRampToValueAtTime(low ? 42 : 70, t + 0.18);
      const n = M.ctx.createBufferSource();
      n.buffer = M.noise;
      const bp = M.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = low ? 400 : 1800;
      const ng = M.ctx.createGain();
      ng.gain.value = low ? 0.6 : 0.9;
      n.connect(bp).connect(ng).connect(env);
      n.start(t);
      n.stop(t + 0.12);
      env.gain.exponentialRampToValueAtTime(peak, t + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, t + (low ? 0.28 : 0.12));
    });
  }

  /* ---------- doprovod podle stylu, takt po taktu ---------- */
  function accompany(tune, barIndex, t0, sixteenth, battle) {
    const h = tune.harm[barIndex % tune.harm.length];
    const root = hz(h.root);
    const fifth = hz(h.root + 7);
    const triad = h.tones.map(s => hz(h.root + 24 + s));

    if (tune.style === "goral2") {
      // 2/4: basy „hm“ na doby, sekund „pa“ mezi nimi
      bass(t0, root, sixteenth * 1.8, 0.11);
      bass(t0 + sixteenth * 4, fifth, sixteenth * 1.8, 0.09);
      second(t0 + sixteenth * 2, triad.slice(1), sixteenth * 1.3, 0.035);
      second(t0 + sixteenth * 6, triad.slice(1), sixteenth * 1.3, 0.035);

      if (battle) {
        drum(t0, 0.22, true);
        drum(t0 + sixteenth * 4, 0.18, true);
        drum(t0 + sixteenth * 2, 0.06, false);
        drum(t0 + sixteenth * 6, 0.06, false);
      }
    } else if (tune.style === "goral3") {
      // 3/4 pomalu: basy drží, sekund na 2. a 3. dobu
      bass(t0, root, sixteenth * 3.6, 0.1);
      second(t0 + sixteenth * 4, triad, sixteenth * 2.4, 0.026);
      second(t0 + sixteenth * 8, triad, sixteenth * 2.4, 0.022);
    } else {
      // středověk 6/8: loutna rozkládá akord, pod tím bordun
      const steps = [0, 7, 12, h.tones[1] + 12, 12, 7];
      steps.forEach((s, i) => lute(t0 + sixteenth * 2 * i, hz(h.root + 12 + s), i === 0 ? 0.09 : 0.06));
      if (barIndex % 2 === 0) drone(t0, hz(midi("D2")), sixteenth * 24, 0.035);
    }
  }

  /* ---------- přehrávač ---------- */
  let scene = "menu";
  let want = "menu";
  let play = null; // { tune, i (index noty), t (čas další noty), bar, barT, pos (šestnáctiny od začátku), pass }
  let lastId = "";

  function pick(sc) {
    const list = TUNES.filter(t => t.scene === sc);
    const options = list.length > 1 ? list.filter(t => t.id !== lastId) : list;
    const tune = options[Math.floor(Math.random() * options.length)];
    lastId = tune.id;
    return tune;
  }

  function start(t) {
    scene = want;
    const tune = pick(scene);
    play = { tune, i: 0, t, pos: 0, pass: 0, nextBar: 0, nextBarT: t };
  }

  function tick() {
    if (!M || !enabled || !A.running || rendering) return;

    const now = M.ctx.currentTime;
    // po pauze (ztlumení, skrytá záložka) se zmeškané noty nedohánějí, hraje se dál od teď
    if (play && play.t < now - 0.15) play = null;
    plan(now, now + 0.3);
  }

  function plan(now, ahead) {
    if (!play) start(now + 0.2);

    while (play) {
      const { tune } = play;
      const sixteenth = 60 / tune.tempo / 4;
      const battle = scene === "battle";

      // doprovod plánovaný po taktech
      while (play.nextBarT < ahead && play.nextBar * tune.bar < tune.length) {
        accompany(tune, play.nextBar, play.nextBarT, sixteenth, battle);
        play.nextBar++;
        play.nextBarT += tune.bar * sixteenth;
      }

      if (play.t >= ahead) break;

      // změna scény: přepne se na hranici čtyř taktů
      const barPos = play.pos % (tune.bar * 4);
      if (want !== scene && barPos === 0 && play.pos > 0) {
        start(play.t + sixteenth * 2);
        continue;
      }

      if (play.i >= tune.notes.length) {
        // skladba dohrála: podruhé se stejnou, potřetí jiná (krátká pauza mezi skladbami)
        if (play.pass === 0 && want === scene) {
          play = { ...play, i: 0, pos: 0, pass: 1, nextBar: 0, nextBarT: play.t };
        } else {
          start(play.t + sixteenth * 4);
        }
        continue;
      }

      const note = tune.notes[play.i];
      const dur = note.len * sixteenth;

      if (note.n != null) {
        const f = hz(note.n);
        if (tune.style === "medieval") {
          recorder(play.t, f, dur * 0.95, 0.07);
        } else {
          const v = tune.style === "goral3" ? 0.07 : 0.06;
          fiddle(play.t, f, dur * (tune.style === "goral3" ? 0.98 : 0.9), v);
          // podruhé hraje druhý prim o oktávu níž (plnější zvuk)
          if (play.pass === 1 && note.len >= 2) fiddle(play.t, f / 2, dur * 0.9, v * 0.45, 0.3);
        }
      }

      play.t += dur;
      play.pos += note.len;
      play.i++;
    }
  }

  setInterval(tick, 70);

  // Ukázka pro ladění: vyrenderuje danou scénu offline do AudioBufferu (bez vlivu na hru).
  let rendering = false;

  async function render(sc, seconds = 30, rate = 44100) {
    const saved = { M, out, wet, play, scene, want, lastId };
    rendering = true;

    try {
      const off = new OfflineAudioContext(2, Math.round(rate * seconds), rate);
      const bus = off.createGain();
      bus.connect(off.destination);
      const noise = off.createBuffer(1, rate * 2, rate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

      build({ ctx: off, bus, noise }, 0.5);
      want = scene = sc;
      play = null;
      plan(0, seconds - 1);
      return await off.startRendering();
    } finally {
      ({ M, out, wet, play, scene, want, lastId } = saved);
      rendering = false;
    }
  }

  function refresh() {
    if (!out) return;
    out.gain.setTargetAtTime(gainNow(), M.ctx.currentTime, 0.6);
  }

  PK.music = {
    // menu | peace | battle; hudba přejde na hranici čtyř taktů
    setScene(next) {
      if (next !== want) want = next;
      if (!M && A.running && setup()) refresh();
    },
    unlock() {
      if (setup()) refresh();
    },
    setEnabled(v) {
      enabled = !!v;
      try { localStorage.setItem("pk-music", enabled ? "1" : "0"); } catch (e) { /* ignore */ }
      if (enabled) setup();
      if (!enabled) play = null;
      refresh();
    },
    setLevel(v) {
      level = Math.max(0, Math.min(1, v));
      try { localStorage.setItem("pk-music-vol", String(level)); } catch (e) { /* ignore */ }
      refresh();
    },
    get enabled() { return enabled; },
    get level() { return level; },
    get scene() { return scene; },
    render,
    tunes: TUNES.map(t => t.id)
  };
})();
