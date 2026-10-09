/*
 * Procedural sound effects (Web Audio, no asset files).
 * play(name, { x }) pans by the logical world x position (0..960).
 */
(() => {
  "use strict";

  const PK = (window.PK = window.PK || {});

  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;
  let send = null;
  let amb = null;
  let ambTimer = null;
  let jit = 1;
  const AMB_LEVEL = 0.3;
  const lastPlayed = {};

  try { muted = localStorage.getItem("pk-muted") === "1"; } catch (e) { /* storage unavailable */ }

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);

      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

      // soft echo bus for magical sounds
      send = ctx.createGain();
      const delay = ctx.createDelay(1);
      const fb = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      delay.delayTime.value = 0.19;
      fb.gain.value = 0.34;
      lp.type = "lowpass";
      lp.frequency.value = 2600;
      send.connect(delay);
      delay.connect(lp);
      lp.connect(fb);
      fb.connect(delay);
      lp.connect(master);

      amb = ctx.createGain();
      amb.gain.value = 0.0001;
      amb.connect(master);
      startAmbient();
    }

    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function out(pan, target = master) {
    if (!ctx.createStereoPanner || !pan) return target;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-0.8, Math.min(0.8, pan));
    p.connect(target);
    return p;
  }

  function tone(dest, f, dur, o = {}) {
    const t0 = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || "square";
    osc.frequency.setValueAtTime(f * jit, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to * jit), t0 + dur);

    const v = o.vol == null ? 0.2 : o.vol;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(dest, dur, o = {}) {
    const t0 = ctx.currentTime + (o.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;

    const f = ctx.createBiquadFilter();
    f.type = o.filter || "lowpass";
    f.frequency.setValueAtTime((o.freq || 2000) * jit, t0);
    if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.to * jit), t0 + dur);
    f.Q.value = o.q || 0.7;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.vol == null ? 0.25 : o.vol, t0 + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  const SFX = {
    click: d => tone(d, 660, 0.05, { type: "triangle", vol: 0.12, to: 880 }),
    step: d => { noise(d, 0.045, { freq: 380, to: 160, vol: 0.09 }); tone(d, 90, 0.04, { type: "sine", vol: 0.05, to: 60 }); },
    select: d => { tone(d, 520, 0.06, { type: "triangle", vol: 0.12 }); tone(d, 780, 0.07, { type: "triangle", vol: 0.1, delay: 0.04 }); },
    order: d => tone(d, 300, 0.09, { type: "square", vol: 0.1, to: 450 }),
    error: d => { tone(d, 160, 0.14, { type: "sawtooth", vol: 0.14, to: 110 }); },
    coin: d => { tone(d, 1180, 0.07, { type: "square", vol: 0.1 }); tone(d, 1580, 0.12, { type: "square", vol: 0.1, delay: 0.06 }); },
    wood: d => { noise(d, 0.06, { freq: 900, vol: 0.2, filter: "bandpass", q: 2 }); tone(d, 190, 0.07, { type: "triangle", vol: 0.15, to: 120 }); },
    mine: d => { tone(d, 1400, 0.05, { type: "square", vol: 0.08, to: 900 }); noise(d, 0.05, { freq: 3500, vol: 0.12, filter: "highpass" }); },
    spawn: d => { [523, 659, 784].forEach((f, i) => tone(d, f, 0.14, { type: "triangle", vol: 0.13, delay: i * 0.06 })); },
    build: d => {
      noise(d, 0.25, { freq: 400, to: 100, vol: 0.35 });
      tone(d, 90, 0.2, { type: "sine", vol: 0.3, to: 45 });
      [0, 0.12, 0.24].forEach(t => noise(d, 0.05, { freq: 1200, vol: 0.18, filter: "bandpass", q: 3, delay: 0.1 + t }));
    },
    slash: d => { noise(d, 0.09, { freq: 3500, to: 700, vol: 0.14, filter: "bandpass", q: 1.2 }); tone(d, 170, 0.06, { type: "triangle", vol: 0.12, to: 90 }); },
    hit: d => { noise(d, 0.07, { freq: 1800, to: 300, vol: 0.22 }); tone(d, 130, 0.08, { type: "square", vol: 0.1, to: 70 }); },
    hitHeavy: d => { noise(d, 0.12, { freq: 1400, to: 200, vol: 0.3 }); tone(d, 90, 0.14, { type: "sawtooth", vol: 0.16, to: 50 }); },
    arrow: d => { noise(d, 0.12, { freq: 2200, to: 5000, vol: 0.1, filter: "bandpass", q: 2 }); tone(d, 420, 0.08, { type: "triangle", vol: 0.07, to: 900 }); },
    tower: d => { tone(d, 240, 0.09, { type: "sawtooth", vol: 0.1, to: 520 }); noise(d, 0.1, { freq: 3000, vol: 0.1, filter: "bandpass", q: 2 }); },
    death: d => { tone(d, 260, 0.35, { type: "sawtooth", vol: 0.12, to: 60 }); noise(d, 0.2, { freq: 900, to: 150, vol: 0.12 }); },
    collapse: d => {
      noise(d, 0.9, { freq: 700, to: 60, vol: 0.5 });
      tone(d, 70, 0.8, { type: "sine", vol: 0.4, to: 30 });
      [0.2, 0.4, 0.55].forEach(t => noise(d, 0.12, { freq: 500, vol: 0.2, delay: t }));
    },
    fireCast: d => { noise(d, 0.3, { freq: 600, to: 3000, vol: 0.18, filter: "bandpass", q: 1.5 }); tone(d, 300, 0.3, { type: "sawtooth", vol: 0.08, to: 900 }); },
    explosion: d => {
      noise(d, 0.7, { freq: 1800, to: 80, vol: 0.55 });
      tone(d, 110, 0.5, { type: "sine", vol: 0.45, to: 35 });
      noise(d, 0.25, { freq: 4000, vol: 0.2, filter: "highpass" });
    },
    heal: d => { [660, 830, 990, 1320].forEach((f, i) => tone(d, f, 0.28, { type: "sine", vol: 0.12, delay: i * 0.07 })); },
    levelUp: d => { [523, 659, 784, 1047].forEach((f, i) => tone(d, f, 0.22, { type: "square", vol: 0.1, delay: i * 0.09 })); tone(d, 1047, 0.5, { type: "triangle", vol: 0.12, delay: 0.38 }); },
    horn: d => {
      tone(d, 110, 0.9, { type: "sawtooth", vol: 0.18, attack: 0.12, to: 104 });
      tone(d, 165, 0.9, { type: "sawtooth", vol: 0.1, attack: 0.15, to: 156 });
    },
    win: d => { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(d, f, 0.25, { type: "square", vol: 0.12, delay: i * 0.13 })); },
    lose: d => { [392, 330, 262, 196].forEach((f, i) => tone(d, f, 0.5, { type: "sawtooth", vol: 0.13, delay: i * 0.28, to: f * 0.96 })); }
  };

  // Echo send level per sound, and sounds that keep an exact pitch.
  const WET = { spawn: 0.35, heal: 0.5, levelUp: 0.5, fireCast: 0.3, explosion: 0.3, horn: 0.4, win: 0.45, lose: 0.45, collapse: 0.25, coin: 0.15 };
  const TUNED = new Set(["click", "select", "coin", "spawn", "heal", "levelUp", "horn", "win", "lose", "error"]);

  // Minimum gap between repeats of the same sound (seconds).
  const GAP = {
    step: 0.16,
    slash: 0.06, hit: 0.05, hitHeavy: 0.06, arrow: 0.07, tower: 0.1, wood: 0.1, mine: 0.1,
    death: 0.08, coin: 0.08, select: 0.05, click: 0.03, spawn: 0.12
  };

  function play(name, opts = {}) {
    if (muted) return;
    if (!ensure() || !SFX[name]) return;

    const now = ctx.currentTime;
    if (now - (lastPlayed[name] || -1) < (GAP[name] || 0.02)) return;
    lastPlayed[name] = now;

    const pan = opts.x == null ? 0 : (opts.x / 960 - 0.5) * 1.4;
    const dest = out(pan);
    const bus = ctx.createGain();
    bus.gain.value = (opts.vol != null ? opts.vol : 1) * 1.5;
    bus.connect(dest);
    if (WET[name]) {
      const s = ctx.createGain();
      s.gain.value = WET[name];
      bus.connect(s);
      s.connect(send);
    }

    jit = TUNED.has(name) ? 1 : 0.92 + Math.random() * 0.16;
    SFX[name](bus);
    jit = 1;
  }

  /* ---------- ambient nature bed ---------- */
  function loopNoise(dest, type, freq, q, vol, pan) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.loopStart = Math.random();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g);
    let end = g;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      end = p;
    }
    end.connect(dest);
    src.start();
    return { f, g };
  }

  function lfo(param, rate, depth, phase = 0) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = rate;
    g.gain.value = depth;
    o.connect(g).connect(param);
    o.start(ctx.currentTime + phase);
  }

  function chirp(pan) {
    const dest = out(pan, amb);
    const base = 2200 + Math.random() * 2200;
    const n = 2 + Math.floor(Math.random() * 4);
    const v = 0.035 + Math.random() * 0.03;

    for (let i = 0; i < n; i++) {
      const t0 = i * (0.07 + Math.random() * 0.05);
      const dir = Math.random() > 0.5 ? 1.35 : 0.75;
      tone(dest, base, 0.07, { type: "sine", vol: v, to: base * dir, delay: t0 });
      if (Math.random() > 0.6) tone(dest, base * 1.5, 0.05, { type: "sine", vol: v * 0.6, to: base * 1.2, delay: t0 + 0.02 });
    }
  }

  function cricketBurst(pan) {
    const dest = out(pan, amb);
    const f = 4300 + Math.random() * 500;
    for (let i = 0; i < 6; i++) tone(dest, f, 0.035, { type: "sine", vol: 0.012, delay: i * 0.07 });
  }

  function crackle() {
    const dest = out(0.55, amb);
    for (let i = 0; i < 3; i++) noise(dest, 0.03, { freq: 2500 + Math.random() * 2000, vol: 0.05, filter: "highpass", delay: Math.random() * 0.25 });
  }

  function startAmbient() {
    if (ambTimer) return;
    const t = ctx.currentTime;

    // wind: slowly breathing band of noise
    const wind = loopNoise(amb, "bandpass", 420, 0.6, 0.16, 0);
    lfo(wind.f.frequency, 0.07, 220);
    lfo(wind.g.gain, 0.11, 0.07, 1.3);

    // brook on the right side of the map
    const brook = loopNoise(amb, "bandpass", 1700, 0.9, 0.07, 0.35);
    lfo(brook.f.frequency, 0.4, 350);
    lfo(brook.g.gain, 0.23, 0.02);
    loopNoise(amb, "lowpass", 380, 0.5, 0.06, 0.3);

    // soft evening pad (A minor add9), very quiet
    const pad = ctx.createGain();
    const padLp = ctx.createBiquadFilter();
    padLp.type = "lowpass";
    padLp.frequency.value = 900;
    pad.gain.value = 0.0001;
    pad.connect(padLp).connect(amb);
    pad.gain.linearRampToValueAtTime(0.05, t + 8);
    lfo(pad.gain, 0.05, 0.02, 2);
    [110, 164.81, 220, 261.63, 329.63].forEach((f, i) => {
      for (const det of [-4, 4]) {
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = f;
        o.detune.value = det + i;
        const g = ctx.createGain();
        g.gain.value = i === 0 ? 0.5 : 0.22;
        o.connect(g).connect(pad);
        o.start();
      }
    });

    amb.gain.cancelScheduledValues(t);
    amb.gain.setValueAtTime(0.0001, t);
    amb.gain.linearRampToValueAtTime(AMB_LEVEL, t + 4);

    ambTimer = setInterval(() => {
      if (muted || !ctx || ctx.state !== "running") return;
      const r = Math.random();
      if (r < 0.28) chirp((Math.random() - 0.5) * 1.4);
      else if (r < 0.42) cricketBurst((Math.random() - 0.5) * 1.2);
      else if (r < 0.5) crackle();
    }, 1100);
  }

  /* the soundscape sits lower while the battle is loud */
  function setIntensity(v) {
    if (!amb) return;
    amb.gain.setTargetAtTime(AMB_LEVEL * (1 - 0.6 * Math.max(0, Math.min(1, v))), ctx.currentTime, 0.5);
  }

  function setMuted(value) {
    muted = !!value;
    try { localStorage.setItem("pk-muted", muted ? "1" : "0"); } catch (e) { /* ignore */ }
    if (master) master.gain.value = muted ? 0 : 0.5;
  }

  PK.audio = {
    play,
    setIntensity,
    unlock: ensure,
    setMuted,
    toggle() { setMuted(!muted); return muted; },
    get muted() { return muted; }
  };
})();
