/*
 * Particles and one-shot effects. Public spawners take logical game
 * coordinates (2 units = 1 art px); internally positions are art px.
 * Everything is drawn on the FINE grid (PK.HD = 2): one particle dot is one
 * fine px (0.5 art px), positions snap to the 0.5 grid via q(). Sizes of
 * particles (size, grow) are in fine px.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const { C, css, rng, Pix, bayer, hash } = PK;

  const FIRE = [0xfff6cc, 0xffe08a, 0xffbf45, 0xff8f4a, 0xd65a3c, 0xa8323a, 0x4a2430].map(c => css(c));
  const SMOKE = [0x7a7382, 0x6d6674, 0x57505f, 0x403a4a, 0x2d2838].map(c => css(c));
  const SMOKE_HI = [0x958d98, 0x857d8a, 0x6d6674, 0x57505f, 0x403a4a].map(c => css(c));
  const DUST = [0xe0c68e, 0xc09c69, 0x9d7a55, 0x7b5b45].map(c => css(c));
  const DUST_HI = [0xf0dcaa, 0xe0c68e, 0xc09c69, 0x9d7a55].map(c => css(c));
  const GOLD = [0xfff6cc, 0xffe08a, 0xffbf45, 0xe0902a].map(c => css(c));
  const HEAL = [0xe0fff2, 0x9ef7c8, 0x5ff0c0, 0x2fa58c].map(c => css(c));
  const CHIP = [0xbe9660, 0x946b45, 0x6c4a35].map(c => css(c));
  const STEEL = [0xffffff, 0xe8e6e8, 0xc6c7d3, 0x9d9fb5].map(c => css(c));
  const HURT = [0xffffff, 0xffd27a, 0xff8f4a, 0xd65a3c].map(c => css(c));
  const LEAF = [C.g[5], C.g[4], C.g[3]].map(c => css(c));
  const WATER = [C.v[4], C.v[3], C.v[2]].map(c => css(c));

  const F = 1 / PK.HD; // jeden jemný px v art px
  // poloha na jemnou mřížku (půl art px)
  const q = v => Math.round(v * PK.HD) / PK.HD;

  const R = rng(9001);
  const rnd = (a, b) => a + R() * (b - a);

  const state = {
    parts: [],
    fx: [],
    decals: [],
    ambient: [],
    timers: [],
    shake: 0
  };

  /* ---------- helpers ---------- */
  function emit(kind, x, y, vx, vy, life, o = {}) {
    if (state.parts.length > 900) return;

    state.parts.push({
      kind, x, y, vx, vy, life, max: life,
      g: o.g || 0, size: o.size || 1, grow: o.grow || 0, drag: o.drag || 0,
      c: o.c || FIRE, hi: o.hi || null, streak: !!o.streak, fade: !!o.fade, sway: o.sway || 0, ph: R() * 6.28, additive: !!o.additive
    });
  }

  const dot = (g, x, y) => g.fillRect(q(x), q(y), F, F);

  // kružnice z jemných bodů, bez zdvojených bodů; dash = počet čárek po obvodu
  function circle(g, cx, cy, r, color, dash = 0, rot = 0, squash = 1) {
    g.fillStyle = color;
    const steps = Math.max(16, Math.ceil(r * 2 * 7));
    let lx = null;
    let ly = null;

    for (let i = 0; i < steps; i++) {
      const a = i / steps * Math.PI * 2;
      if (dash && Math.floor((a + rot) / (Math.PI * 2) * dash * 2) % 2) continue;
      const x = q(cx + Math.cos(a) * r);
      const y = q(cy + Math.sin(a) * r * squash);
      if (x === lx && y === ly) continue;
      g.fillRect(x, y, F, F);
      lx = x;
      ly = y;
    }
  }

  // zaoblená kulička velikosti s jemných px se světlým bodem vlevo nahoře
  function blob(g, x, y, s, col, hi) {
    const w = s * F;
    g.fillStyle = col;
    if (s <= 2) {
      g.fillRect(x, y, w, w);
    } else {
      g.fillRect(x + F, y, w - 2 * F, w);
      g.fillRect(x, y + F, w, w - 2 * F);
    }
    if (hi && s >= 3) {
      g.fillStyle = hi;
      g.fillRect(x + F, y + F, s >= 5 ? 2 * F : F, F);
      if (s >= 5) g.fillRect(x + F, y + 2 * F, F, F);
    }
  }

  // úsečka z jemných bodů (střely)
  function seg(g, x0, y0, x1, y1) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * PK.HD));
    for (let i = 0; i <= n; i++) dot(g, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n);
  }

  const A = v => v * 0.5;

  /* ---------- spawners (logical coords) ---------- */
  const fx = {
    state,
    get shake() { return state.shake; },
    set shake(v) { state.shake = v; },

    reset() {
      state.parts.length = 0;
      state.fx.length = 0;
      state.decals.length = 0;
      state.timers.length = 0;
      state.shake = 0;
      initAmbient();
    },

    later(sec, fn) {
      if (sec <= 0) fn();
      else state.timers.push({ t: sec, fn });
    },

    hit(x, y, strong) {
      const ax = A(x);
      const ay = A(y);
      state.fx.push({ kind: "burst", x: ax, y: ay, life: 0.22, max: 0.22, big: !!strong, rot: R() < 0.5 });
      const n = strong ? 12 : 6;

      for (let i = 0; i < n; i++) {
        const a = R() * Math.PI * 2;
        const s = rnd(25, 75);
        emit("spark", ax, ay, Math.cos(a) * s, Math.sin(a) * s - 18, rnd(0.16, 0.38), { g: 160, c: HURT, streak: true });
      }
    },

    slash(x, y, dir, color = STEEL) {
      state.fx.push({ kind: "slash", x: A(x), y: A(y), dir, life: 0.2, max: 0.2, color, tilt: rnd(-0.25, 0.25) });
    },

    arrow(x1, y1, x2, y2, onHit, color = 0xe8e6e8) {
      const d = Math.hypot(x2 - x1, y2 - y1);
      const life = Math.max(0.08, Math.min(0.3, d / 700));
      state.fx.push({ kind: "arrow", x1: A(x1), y1: A(y1), x2: A(x2), y2: A(y2), life, max: life, onHit, color: css(color) });
      return life;
    },

    bolt(x1, y1, x2, y2, onHit) {
      const d = Math.hypot(x2 - x1, y2 - y1);
      const life = Math.max(0.1, Math.min(0.26, d / 650));
      state.fx.push({ kind: "bolt", x1: A(x1), y1: A(y1), x2: A(x2), y2: A(y2), life, max: life, onHit });
      return life;
    },

    text(x, y, value, color = 0xffe08a) {
      if (state.fx.filter(f => f.kind === "text").length > 26) return;
      state.fx.push({ kind: "text", x: A(x) + rnd(-3, 3), y: A(y), value: String(value), color, life: 0.8, max: 0.8 });
    },

    ring(x, y, radius, color, life = 0.5, opts = {}) {
      state.fx.push({ kind: "ring", x: A(x), y: A(y), r: A(radius), color, life, max: life, dash: opts.dash || 0, grow: opts.grow !== false });
    },

    ping(x, y, type) {
      state.fx.push({ kind: "ping", x: A(x), y: A(y), type, life: 0.7, max: 0.7 });
    },

    puff(x, y, count = 5, ramp = DUST, spread = 14) {
      for (let i = 0; i < count; i++) {
        emit("dust", A(x) + rnd(-spread, spread) * 0.5, A(y) + rnd(-2, 2), rnd(-14, 14), rnd(-14, -3), rnd(0.35, 0.7), {
          c: ramp, hi: ramp === DUST ? DUST_HI : null, size: 3, grow: 4, fade: true, drag: 1.4
        });
      }
    },

    spawn(x, y) {
      state.fx.push({ kind: "ring", x: A(x), y: A(y) + 2, r: 9, color: 0xffe08a, life: 0.5, max: 0.5, dash: 0, grow: false, shrink: true, squash: 0.45 });
      state.fx.push({ kind: "pillar", x: A(x), y: A(y) + 6, life: 0.45, max: 0.45, small: true });

      for (let i = 0; i < 16; i++) {
        emit("spark", A(x) + rnd(-8, 8), A(y) + rnd(-2, 5), rnd(-6, 6), rnd(-34, -12), rnd(0.5, 0.9), { c: GOLD, g: -8 });
      }
    },

    build(x, y, w) {
      for (let i = 0; i < 18; i++) {
        emit("dust", A(x) + rnd(-w, w) * 0.5, A(y) + rnd(-3, 3), rnd(-22, 22), rnd(-20, -4), rnd(0.5, 1.0), {
          c: DUST, hi: DUST_HI, size: 3, grow: 5, fade: true, drag: 1.2
        });
      }

      for (let i = 0; i < 10; i++) {
        emit("chip", A(x) + rnd(-w, w) * 0.4, A(y) - 4, rnd(-30, 30), rnd(-60, -25), rnd(0.4, 0.8), { c: CHIP, g: 170, size: R() < 0.4 ? 2 : 1 });
      }

      state.shake = Math.max(state.shake, 1);
    },

    chop(x, y) {
      for (let i = 0; i < 5; i++) {
        emit("chip", A(x) + rnd(-3, 3), A(y), rnd(-26, 26), rnd(-48, -18), rnd(0.35, 0.6), { c: CHIP, g: 150, size: R() < 0.3 ? 2 : 1 });
      }

      if (R() > 0.55) {
        emit("leaf", A(x) + rnd(-8, 8), A(y) - 24, rnd(-8, 8), rnd(6, 16), rnd(1.0, 1.6), { c: LEAF, g: 0, sway: 10 });
      }
    },

    // Oprava budovy: třísky od kladiva, jiskra z hřebíku a občas zelený křížek zdraví.
    repair(x, y) {
      for (let i = 0; i < 3; i++) {
        emit("chip", A(x) + rnd(-3, 3), A(y), rnd(-22, 22), rnd(-44, -16), rnd(0.3, 0.55), { c: CHIP, g: 150, size: 1 });
      }

      for (let i = 0; i < 2; i++) {
        emit("spark", A(x) + rnd(-2, 2), A(y) - 2, rnd(-30, 30), rnd(-50, -20), rnd(0.2, 0.35), { c: GOLD, g: 170, streak: true });
      }

      if (R() > 0.6) {
        emit("plus", A(x) + rnd(-10, 10), A(y) - 10, rnd(-3, 3), rnd(-26, -12), rnd(0.6, 0.9), { c: HEAL, fade: false });
      }
    },

    mine(x, y) {
      for (let i = 0; i < 7; i++) {
        emit("spark", A(x) + rnd(-3, 3), A(y), rnd(-40, 40), rnd(-60, -20), rnd(0.25, 0.5), { c: GOLD, g: 170, streak: true });
      }
      emit("dust", A(x), A(y) + 1, rnd(-6, 6), rnd(-8, -3), 0.5, { c: DUST, size: 2, grow: 3, fade: true, drag: 1.5 });
    },

    coin(x, y, value, wood) {
      const color = wood ? 0xd9a867 : 0xffe08a;
      fx.text(x, y - 24, value, color);

      for (let i = 0; i < 6; i++) {
        emit(wood ? "chip" : "coin", A(x) + rnd(-4, 4), A(y) - 14, rnd(-16, 16), rnd(-40, -16), rnd(0.4, 0.7), { c: wood ? CHIP : GOLD, g: 120 });
      }
    },

    healBurst(x, y, radius) {
      state.fx.push({ kind: "ring", x: A(x), y: A(y), r: A(radius), color: 0x9ef7c8, life: 0.7, max: 0.7, dash: 14, grow: true, spin: true, squash: 0.6 });
      state.fx.push({ kind: "ring", x: A(x), y: A(y), r: A(radius) * 0.6, color: 0xe0fff2, life: 0.55, max: 0.55, dash: 9, grow: true, spin: true, squash: 0.6 });

      for (let i = 0; i < 14; i++) {
        const a = R() * Math.PI * 2;
        const rr = R() * A(radius) * 0.8;
        emit("mote", A(x) + Math.cos(a) * rr, A(y) + Math.sin(a) * rr * 0.6, 0, rnd(-20, -8), rnd(0.6, 1.0), { c: HEAL, sway: 3 });
      }
    },

    healOn(x, y) {
      for (let i = 0; i < 6; i++) {
        emit("plus", A(x) + rnd(-6, 6), A(y) - 4 + rnd(-4, 6), rnd(-4, 4), rnd(-30, -14), rnd(0.6, 1.0), { c: HEAL, fade: false });
      }
    },

    levelUp(x, y) {
      state.fx.push({ kind: "pillar", x: A(x), y: A(y) + 6, life: 0.9, max: 0.9 });
      state.fx.push({ kind: "ring", x: A(x), y: A(y) + 4, r: 20, color: 0xffe08a, life: 0.7, max: 0.7, dash: 0, grow: true, squash: 0.45 });

      for (let i = 0; i < 22; i++) {
        emit("spark", A(x) + rnd(-8, 8), A(y) + rnd(-4, 6), rnd(-10, 10), rnd(-70, -25), rnd(0.6, 1.1), { c: GOLD, g: -6 });
      }
    },

    fireball(x1, y1, x2, y2, radius, onLand) {
      state.fx.push({ kind: "fireball", x1: A(x1), y1: A(y1) - 18, x2: A(x2), y2: A(y2), r: A(radius), life: 0.3, max: 0.3, onLand });
    },

    corpse(info) {
      state.fx.push({
        kind: "corpse", type: info.type, team: info.team, flip: info.flip, x: A(info.x), y: A(info.y) + 6,
        dir: info.dir, wait: info.wait || 0, life: 1.9 + (info.wait || 0), max: 1.9 + (info.wait || 0), hero: info.type === "hero"
      });
    },

    collapse(info) {
      const ax = A(info.x);
      const ay = A(info.y) + 19;
      state.fx.push({ kind: "collapse", type: info.type, team: info.team, x: ax, y: ay, life: 1.15, max: 1.15 });
      state.shake = Math.max(state.shake, 3);

      for (let i = 0; i < 14; i++) {
        emit("chip", ax + rnd(-20, 20), ay - rnd(4, 24), rnd(-40, 40), rnd(-70, -20), rnd(0.5, 0.9), { c: [css(C.s[4]), css(C.s[3]), css(C.s[2])], g: 180, size: R() < 0.5 ? 2 : 1 });
      }
    },

    shakeScreen(v) {
      state.shake = Math.max(state.shake, v);
    },

    smoke(x, y, dark = false) {
      emit("smoke", x, y, rnd(2, 7), rnd(-10, -5), rnd(1.4, 2.4), { c: dark ? SMOKE.slice(2) : SMOKE, hi: dark ? SMOKE_HI.slice(2) : SMOKE_HI, size: 3, grow: 6, fade: true, sway: 3 });
    },

    ember(x, y) {
      emit("ember", x, y, rnd(-4, 4), rnd(-22, -10), rnd(0.8, 1.6), { c: FIRE.slice(1, 6), sway: 4 });
    },

    footstep(x, y, water) {
      if (water) {
        emit("spark", A(x) + rnd(-3, 3), A(y), rnd(-12, 12), rnd(-30, -14), 0.35, { c: WATER, g: 120 });
        state.fx.push({ kind: "ripple", x: A(x), y: A(y), life: 0.5, max: 0.5 });
      } else if (R() > 0.5) {
        emit("dust", A(x) + rnd(-2, 2), A(y), rnd(-5, 5), rnd(-6, -1), 0.45, { c: DUST, size: 2, grow: 2, fade: true });
      }
    },

    update(dt) { update(dt); },
    drawGround(g, T) { drawGround(g, T); },
    drawAir(g, T) { drawAir(g, T); },
    drawTexts(g) { drawTexts(g); },
    drawAmbient(g, T) { drawAmbient(g, T); },

    lingering: () => state.fx.length + state.parts.length
  };

  /* ---------- ambient motes ---------- */
  // Světlušky a listy nad bujnou trávou, popel nad popelem; počty rostou s velikostí mapy.
  function initAmbient() {
    state.ambient.length = 0;

    const w = PK.world;
    if (!w || !w.ready) return;

    const area = w.W * w.H / (480 * 240);

    const spot = ash => {
      for (let k = 0; k < 60; k++) {
        const x = rnd(14, w.W - 14);
        const y = rnd(24, w.H - 10);
        const i = Math.floor(y) * w.W + Math.floor(x);
        if (w.zone[i] !== w.Z.FRAME && w.ashMap[i] === (ash ? 1 : 0)) return { x, y };
      }

      return null;
    };

    const add = (kind, count, ash, sp0, sp1) => {
      for (let i = 0; i < count; i++) {
        const p = spot(ash);
        if (p) state.ambient.push({ kind, x: p.x, y: p.y, ph: R() * 6.28, sp: rnd(sp0, sp1) });
      }
    };

    add("firefly", Math.round(18 * area), false, 0.2, 0.6);
    add("ash", Math.round(22 * area), true, 5, 12);
    add("leaf", Math.round(7 * area), false, 5, 10);
  }

  function drawAmbient(g, T) {
    for (const a of state.ambient) {
      if (a.kind === "firefly") {
        const x = a.x + Math.sin(T * a.sp + a.ph) * 9 + Math.sin(T * a.sp * 2.3) * 3;
        const y = a.y + Math.cos(T * a.sp * 0.8 + a.ph) * 6;
        const tw = Math.sin(T * 2.2 + a.ph * 3);
        if (tw < -0.55) continue;

        PK.world.light(g, x, y, 4, 0xffe08a, 0.35 + tw * 0.2);
        g.fillStyle = tw > 0.2 ? "#fff6cc" : "#ffe08a";
        dot(g, x, y);
        if (tw > 0.6) {
          g.fillStyle = "rgba(255,224,138,0.5)";
          dot(g, x - F, y);
          dot(g, x + F, y);
          dot(g, x, y - F);
          dot(g, x, y + F);
        }
      } else if (a.kind === "ash") {
        const x = a.x + Math.sin(T * 0.6 + a.ph) * 6 + ((T * 2 + a.ph * 10) % 24) - 12;
        const y = a.y + ((T * a.sp + a.ph * 20) % 60) - 30;
        const hot = (Math.floor(T * 3 + a.ph * 4) & 3) === 0;
        g.fillStyle = hot ? "#ff8f4a" : "#8a8085";
        dot(g, x, y);
        // vločka se převrací: chvíli dva body
        if (!hot && Math.sin(T * 4 + a.ph) > 0.3) {
          g.fillStyle = "#665f68";
          dot(g, x + F, y);
        }
      } else {
        // list: tři jemné body, natočení se mění, jak se snáší
        const x = a.x + Math.sin(T * 0.7 + a.ph) * 12 + ((T * 3 * (a.sp / 8) + a.ph * 20) % 40) - 20;
        const y = a.y + ((T * a.sp * 0.7 + a.ph * 30) % 50) - 25;
        const turn = Math.sin(T * 2.4 + a.ph) > 0;
        const light = (Math.floor(a.ph * 3) & 1) === 1;
        g.fillStyle = light ? "#98c76a" : "#6ba459";
        dot(g, x, y);
        dot(g, x + F, turn ? y : y + F);
        g.fillStyle = light ? "#6ba459" : "#4a8548";
        dot(g, x + 2 * F, turn ? y + F : y + F);
      }
    }
  }

  /* ---------- update ---------- */
  function update(dt) {
    state.shake = Math.max(0, state.shake - dt * 7);

    for (let i = state.timers.length - 1; i >= 0; i--) {
      const tm = state.timers[i];
      tm.t -= dt;

      if (tm.t <= 0) {
        state.timers.splice(i, 1);
        tm.fn();
      }
    }

    const parts = state.parts;
    let w = 0;

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) continue;

      p.x += (p.vx + Math.sin(p.ph + p.life * 4) * p.sway) * dt;
      p.y += p.vy * dt;
      p.vy += p.g * dt;
      if (p.drag) {
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k;
        p.vy *= k;
      }
      parts[w++] = p;
    }

    parts.length = w;

    const list = state.fx;
    let n = 0;

    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      f.life -= dt;

      if (f.kind === "arrow" || f.kind === "bolt") {
        if (f.life <= 0) {
          if (f.onHit) f.onHit();
          continue;
        }

        if (f.kind === "bolt" && R() < dt * 40) {
          const t = 1 - f.life / f.max;
          emit("ember", f.x1 + (f.x2 - f.x1) * t, f.y1 + (f.y2 - f.y1) * t, rnd(-6, 6), rnd(-10, 4), rnd(0.15, 0.3), { c: GOLD.slice(1), additive: true });
        }
      } else if (f.kind === "fireball") {
        if (f.life <= 0) {
          explode(f);
          continue;
        }

        const t = 1 - f.life / f.max;
        const x = f.x1 + (f.x2 - f.x1) * t;
        const y = f.y1 + (f.y2 - f.y1) * t - Math.sin(t * Math.PI) * 14;
        emit("ember", x + rnd(-1.5, 1.5), y + rnd(-1.5, 1.5), rnd(-8, 8), rnd(-6, 12), rnd(0.2, 0.45), { c: FIRE.slice(1, 6), additive: true });
        if (R() < 0.5) emit("smoke", x, y, rnd(-4, 4), rnd(-8, -2), rnd(0.4, 0.7), { c: SMOKE.slice(1), size: 2, grow: 3, fade: true });
      } else if (f.kind === "corpse") {
        if (f.life > 0 && f.max - f.life > f.wait + 0.3 && !f.wisp) {
          f.wisp = true;

          for (let k = 0; k < 6; k++) {
            emit("mote", f.x + rnd(-4, 4), f.y - 6, rnd(-4, 4), rnd(-26, -14), rnd(0.9, 1.5), {
              c: f.team === "red" ? [css(0xffd27a), css(0xff8f4a), css(0xd65a3c)] : [css(0xe0ffff), css(0x9ef0f0), css(0x4fc0d0)],
              sway: 6
            });
          }
        }

        if (f.life <= 0) continue;
      } else if (f.kind === "collapse") {
        if (f.life > 0 && Math.random() < 0.6) {
          emit("dust", f.x + rnd(-24, 24), f.y - rnd(0, 10), rnd(-14, 14), rnd(-24, -6), rnd(0.5, 1.1), { c: DUST, hi: DUST_HI, size: 3, grow: 5, fade: true, drag: 1 });
        }

        if (f.life <= 0) {
          state.decals.push({ kind: "rubble", type: f.type, team: f.team, x: f.x, y: f.y });
          if (state.decals.length > 40) state.decals.shift();
          continue;
        }
      } else if (f.life <= 0) {
        continue;
      }

      list[n++] = f;
    }

    list.length = n;

    const dec = state.decals;
    let d = 0;

    for (let i = 0; i < dec.length; i++) {
      if (dec[i].kind === "scorch") {
        dec[i].life -= dt;
        if (dec[i].life <= 0) continue;
      }
      dec[d++] = dec[i];
    }

    dec.length = d;
  }

  function explode(f) {
    const { x2: x, y2: y, r } = f;

    state.fx.push({ kind: "ring", x, y, r, color: 0xffbf45, life: 0.45, max: 0.45, dash: 0, grow: true, squash: 0.6 });
    state.fx.push({ kind: "ring", x, y, r: r * 0.65, color: 0xfff6cc, life: 0.3, max: 0.3, dash: 0, grow: true, squash: 0.6 });
    state.fx.push({ kind: "burst", x, y, life: 0.3, max: 0.3, big: true });
    state.fx.push({ kind: "flash", x, y, r, life: 0.25, max: 0.25 });
    state.decals.push({ kind: "scorch", x, y, r: r * 0.6, life: 14, max: 14 });
    state.shake = Math.max(state.shake, 3.5);

    for (let i = 0; i < 56; i++) {
      const a = R() * Math.PI * 2;
      const s = rnd(10, r * 3.2);
      emit("ember", x, y, Math.cos(a) * s, Math.sin(a) * s * 0.7 - 10, rnd(0.3, 0.8), { c: FIRE, size: R() > 0.7 ? 2 : 1, drag: 2.5, additive: R() < 0.5 });
    }

    for (let i = 0; i < 14; i++) {
      const a = R() * Math.PI * 2;
      emit("smoke", x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.4, rnd(-6, 6), rnd(-22, -8), rnd(0.8, 1.5), { c: SMOKE.slice(1), hi: SMOKE_HI.slice(1), size: 4, grow: 6, fade: true });
    }

    if (f.onLand) f.onLand();
  }

  /* ---------- decals ---------- */
  // Spálenina: nepravidelná skvrna v jemné mřížce, uprostřed černá, na okraji rozpadlá ditheringem, pár žhavých uhlíků.
  const scorchCache = new Map();

  function scorchSprite(r) {
    const key = Math.round(r * 2);
    let c = scorchCache.get(key);
    if (c) return c;

    const rx = Math.max(3, key);
    const ry = Math.max(2, Math.round(rx * 0.55));
    const P = new Pix(rx * 2 * 2 + 4, ry * 2 * 2 + 4);
    const cx = P.w / 2;
    const cy = P.h / 2;

    for (let y = 0; y < P.h; y++) {
      for (let x = 0; x < P.w; x++) {
        const dx = (x + 0.5 - cx) / (rx * 2);
        const dy = (y + 0.5 - cy) / (ry * 2);
        const a = Math.atan2(dy, dx);
        const d = Math.hypot(dx, dy) * (1 + 0.16 * Math.sin(a * 5 + key) + 0.08 * Math.sin(a * 11));
        if (d > 1) continue;
        if (d > 0.7 && bayer(x, y) < (d - 0.7) / 0.3) continue;
        let col = d < 0.45 ? C.b[0] : d < 0.75 ? C.b[1] : C.h[1];
        if (d < 0.6 && hash(x, y, 31) > 0.97) col = C.r[2];
        else if (hash(x, y, 32) > 0.93) col = C.h[2];
        P.setA(x, y, col, d < 0.75 ? 220 : 160);
      }
    }

    c = PK.fine(P);
    scorchCache.set(key, c);
    return c;
  }

  /* ---------- drawing ---------- */
  function drawGround(g, T) {
    for (const d of state.decals) {
      if (d.kind === "rubble") {
        const spr = PK.buildings.rubble(d.type, d.team);
        g.drawImage(spr.c, Math.round(d.x - spr.w / 2), Math.round(d.y - spr.h + 3));
      } else if (d.kind === "scorch") {
        const spr = scorchSprite(d.r);
        g.globalAlpha = Math.min(1, d.life / 4) * 0.85;
        g.drawImage(spr, q(d.x - spr.width / 2), q(d.y - spr.height / 2));
        g.globalAlpha = 1;
      }
    }

    for (const f of state.fx) {
      const t = 1 - f.life / f.max;

      if (f.kind === "ring") {
        const r = f.grow ? f.r * (0.25 + 0.75 * Math.sin(t * Math.PI * 0.5)) : f.shrink ? f.r * (1 - t * 0.7) : f.r;
        g.globalAlpha = Math.min(1, f.life / f.max * 1.6);
        circle(g, f.x, f.y, r, css(f.color), f.dash, f.spin ? T * 3 : 0, f.squash || 1);
        // druhá, tmavší stopa uvnitř: kruh má tloušťku a hloubku
        if (!f.dash && r > 3) {
          g.globalAlpha *= 0.45;
          circle(g, f.x, f.y, r - F * 2, css(f.color), 0, 0, f.squash || 1);
        }
        g.globalAlpha = 1;
      } else if (f.kind === "ripple") {
        g.globalAlpha = 1 - t;
        circle(g, f.x, f.y, 1 + t * 3, "#c6f0ee", 0, 0, 0.5);
        g.globalAlpha = 1;
      } else if (f.kind === "ping") {
        drawPing(g, f, t);
      } else if (f.kind === "corpse") {
        drawCorpse(g, f);
      }
    }
  }

  function drawPing(g, f, t) {
    const x = q(f.x);
    const y = q(f.y);
    g.globalAlpha = 1 - t * t;

    if (f.type === "attack") {
      // zaměřovač: čtyři rohy se stahují k cíli, ve středu žhavý bod
      const k = 5 - t * 2;
      g.fillStyle = "#ff8f4a";
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        for (let i = 0; i < 4; i++) {
          dot(g, x + dx * (k + i * F), y + dy * k * 0.6);
          dot(g, x + dx * k, y + dy * (k * 0.6 + i * F));
        }
      }
      g.fillStyle = "#ffd27a";
      dot(g, x, y);
      circle(g, x, y, 6 - t * 2, "#d65a3c", 0, 0, 0.6);
    } else if (f.type === "gather") {
      circle(g, x, y, 5 + t * 3, "#ffe08a", 0, 0, 0.6);
      circle(g, x, y, 3 + t * 3, "rgba(255,224,138,0.45)", 0, 0, 0.6);
      g.fillStyle = "#fff6cc";
      dot(g, x, y);
    } else {
      // pohyb: čtyři šipky se sbíhají do bodu, pod nimi kroužek
      const k = 8 * (1 - t) + 1.5;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const px = x + dx * k;
        const py = y + dy * k * 0.6;
        g.fillStyle = "#e0ffff";
        dot(g, px, py);
        g.fillStyle = "#9ef0f0";
        for (let i = 1; i <= 2; i++) {
          dot(g, px - dy * i * F + dx * i * F, py + dx * i * F * 0.6 + dy * i * F);
          dot(g, px + dy * i * F + dx * i * F, py - dx * i * F * 0.6 + dy * i * F);
        }
      }
      circle(g, x, y, 2 + t * 2, "#9ef0f0", 0, 0, 0.6);
    }

    g.globalAlpha = 1;
  }

  function drawCorpse(g, f) {
    const age = f.max - f.life;
    const U = PK.units;

    if (age < f.wait) {
      const rec = U.frame(f.type, f.team, "idle", 0);
      g.drawImage(f.flip ? rec.cf : rec.c, Math.round(f.x) - (f.flip ? U.CELL - U.AX - 1 : U.AX), Math.round(f.y) - U.AY);
      return;
    }

    const a = age - f.wait;

    if (a < 0.14) {
      const rec = U.frame(f.type, f.team, "idle", 0);
      g.drawImage(U.flash(rec, f.flip), Math.round(f.x) - (f.flip ? U.CELL - U.AX - 1 : U.AX) - f.dir, Math.round(f.y) - U.AY);
      return;
    }

    const lie = U.lying(f.type, f.team, f.dir < 0);
    const fade = Math.max(0, (a - 0.8) / 1.0);
    let img = lie.c;

    if (fade > 0) {
      // rozpad po jemných bodech (8 kroků)
      const k = Math.round((1 - fade) * 8);
      lie.dis = lie.dis || {};
      if (!lie.dis[k]) lie.dis[k] = PK.fine(lie.pix.dissolve(k / 8));
      img = lie.dis[k];
    }

    // slide 2px while falling
    const slide = Math.min(1, (a - 0.14) / 0.12);
    const dx = f.dir > 0 ? -2 - 1 : 2 - 30;

    g.drawImage(img, q(f.x + f.dir * 2 * slide) + dx, Math.round(f.y) - 3 - 16);
  }

  function drawAir(g, T) {
    for (const f of state.fx) {
      const t = 1 - f.life / f.max;

      if (f.kind === "burst") {
        drawBurst(g, f, t);
      } else if (f.kind === "flash") {
        PK.world.light(g, f.x, f.y - 4, Math.round(f.r * 1.4), 0xffbf45, 0.9 * (1 - t), 4);
      } else if (f.kind === "slash") {
        drawSlash(g, f, t);
      } else if (f.kind === "arrow") {
        drawArrow(g, f, t);
      } else if (f.kind === "bolt") {
        drawBolt(g, f, t);
      } else if (f.kind === "fireball") {
        drawFireball(g, f, t);
      } else if (f.kind === "pillar") {
        drawPillar(g, f, t);
      } else if (f.kind === "collapse") {
        drawCollapse(g, f, t);
      }
    }

    const parts = state.parts;
    let lastAdd = false;

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const t = 1 - p.life / p.max;
      const ci = Math.min(p.c.length - 1, Math.floor(t * p.c.length));
      const size = Math.max(1, Math.round(p.size + p.grow * t));
      const px = q(p.x);
      const py = q(p.y);

      if (p.additive !== lastAdd) {
        g.globalCompositeOperation = p.additive ? "lighter" : "source-over";
        lastAdd = p.additive;
      }

      if (p.fade) g.globalAlpha = Math.max(0, (1 - t) * 0.7);
      g.fillStyle = p.c[ci];

      if (p.kind === "plus") {
        // křížek léčení: střed světlejší
        g.fillRect(px, py - F, F, 3 * F);
        g.fillRect(px - F, py, 3 * F, F);
        g.fillStyle = HEAL[0];
        g.fillRect(px, py, F, F);
      } else if (p.kind === "mote") {
        g.fillRect(px, py, F, F);
        if (t < 0.6) {
          g.globalAlpha = 0.4;
          g.fillRect(px - F, py, F, F);
          g.fillRect(px + F, py, F, F);
          g.fillRect(px, py - F, F, F);
          g.fillRect(px, py + F, F, F);
        }
      } else if (p.kind === "smoke" || p.kind === "dust") {
        const off = (size - 1) * F / 2;
        blob(g, q(p.x - off), q(p.y - off), size, p.c[ci], p.hi ? p.hi[ci] : null);
      } else if (p.kind === "spark" && p.streak) {
        // jiskra s krátkou stopou proti směru letu
        g.fillRect(px, py, F, F);
        const v = Math.hypot(p.vx, p.vy) || 1;
        g.fillStyle = p.c[Math.min(p.c.length - 1, ci + 1)];
        g.fillRect(q(p.x - p.vx / v * F * 1.5), q(p.y - p.vy / v * F * 1.5), F, F);
      } else if (p.kind === "coin") {
        // mince se točí: střídá plnou a úzkou podobu
        const flat = Math.floor((p.life + p.ph) * 14) & 1;
        g.fillRect(px, py, flat ? F : 2 * F, 2 * F);
        g.fillStyle = GOLD[0];
        g.fillRect(px, py, F, F);
      } else if (p.kind === "leaf") {
        const turn = Math.sin(p.life * 9 + p.ph) > 0;
        g.fillRect(px, py, 2 * F, F);
        g.fillStyle = p.c[Math.min(p.c.length - 1, ci + 1)];
        g.fillRect(turn ? px + 2 * F : px - F, py + F, F, F);
      } else {
        g.fillRect(px, py, size * F, size * F);
        // svítící částice mají jasné jádro
        if (p.additive && ci > 0 && size > 1) {
          g.fillStyle = p.c[ci - 1];
          g.fillRect(px, py, F, F);
        }
      }

      if (p.fade || p.kind === "mote") g.globalAlpha = 1;
    }

    if (lastAdd) g.globalCompositeOperation = "source-over";
  }

  function drawBurst(g, f, t) {
    const x = q(f.x);
    const y = q(f.y);
    const big = f.big;

    if (t < 0.35) {
      // bílý záblesk: kříž a diagonální paprsky z jemných bodů
      const arm = big ? 5 : 3;
      g.fillStyle = "#ffffff";
      for (let i = -arm; i <= arm; i++) {
        dot(g, x + i * F, y);
        dot(g, x, y + i * F);
      }
      g.fillStyle = "#ffe08a";
      for (let i = 1; i <= (big ? 3 : 2); i++) {
        for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) dot(g, x + dx * (i + 1) * F, y + dy * (i + 1) * F);
      }
      PK.world.light(g, x, y, big ? 7 : 4, 0xffd27a, 0.5);
    } else if (t < 0.8) {
      // rozpínající se prstenec jisker
      const r = (big ? 4 : 2.5) + (t - 0.35) * 6;
      const n = big ? 12 : 8;
      g.fillStyle = t < 0.55 ? "#ffbf45" : "#ff8f4a";
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2 + (f.rot ? 0.3 : 0);
        dot(g, x + Math.cos(a) * r, y + Math.sin(a) * r * 0.8);
      }
      g.fillStyle = "#fff6cc";
      dot(g, x, y);
    }
  }

  function drawArrow(g, f, t) {
    const x = f.x1 + (f.x2 - f.x1) * t;
    const arc = k => f.y1 + (f.y2 - f.y1) * k - Math.sin(k * Math.PI) * 4;
    const y = arc(t);
    // směr podle tečny oblouku: šíp se na konci sklání k cíli
    const k2 = Math.min(1, t + 0.04);
    let ux = (f.x2 - f.x1) * (k2 - t) || 1e-3;
    let uy = arc(k2) - y;
    const len = Math.hypot(ux, uy) || 1;
    ux /= len;
    uy /= len;

    // dřík 4.5 art px (9 jemných), hrot 2 px, letka 2x2 px po stranách konce
    g.fillStyle = "#946b45";
    seg(g, x - ux * 4, y - uy * 4, x - ux * 1, y - uy * 1);
    g.fillStyle = f.color;
    dot(g, x - ux * F, y - uy * F);
    g.fillStyle = "#ffffff";
    dot(g, x, y);
    g.fillStyle = "#e8e6e8";
    for (const s of [-1, 1]) {
      dot(g, x - ux * 4.5 - uy * F * s, y - uy * 4.5 + ux * F * s);
      dot(g, x - ux * 4 - uy * F * s, y - uy * 4 + ux * F * s);
    }
  }

  function drawBolt(g, f, t) {
    const x = f.x1 + (f.x2 - f.x1) * t;
    const y = f.y1 + (f.y2 - f.y1) * t;
    const dx = f.x2 - f.x1;
    const dy = f.y2 - f.y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;

    PK.world.light(g, x, y, 6, 0xffbf45, 0.55);
    // žhavý šíp: bílé jádro, jantarový ohon, kolem jemná aura
    for (let i = 0; i < 12; i++) {
      g.fillStyle = i < 3 ? "#fff6cc" : i < 7 ? "#ffbf45" : i < 10 ? "#e0902a" : "#a85a1c";
      dot(g, x - ux * i * F, y - uy * i * F);
    }
    g.fillStyle = "rgba(255,224,138,0.55)";
    for (let i = 1; i < 6; i++) {
      dot(g, x - ux * i * F - uy * F, y - uy * i * F + ux * F);
      dot(g, x - ux * i * F + uy * F, y - uy * i * F - ux * F);
    }
  }

  function drawFireball(g, f, t) {
    const x = q(f.x1 + (f.x2 - f.x1) * t);
    const arc = Math.sin(t * Math.PI) * 14;
    const y = q(f.y1 + (f.y2 - f.y1) * t - arc);
    PK.world.light(g, x, y, 14, 0xff8f4a, 0.6, arc + 3);

    // koule v jemné mřížce: vrstvy od rudého okraje k bílému jádru, okraj plápolá
    const R0 = 3;
    for (let yy = -R0 * 2; yy <= R0 * 2; yy++) {
      for (let xx = -R0 * 2; xx <= R0 * 2; xx++) {
        const d = Math.hypot(xx + 0.5, yy + 0.5) / (R0 * 2);
        const wob = 0.12 * Math.sin(Math.atan2(yy, xx) * 4 + f.life * 40);
        if (d > 1 + wob) continue;
        // světlejší vlevo nahoře
        const lit = d - (xx + yy) / (R0 * 8);
        g.fillStyle = lit < 0.28 ? "#fff6cc" : lit < 0.5 ? "#ffe08a" : lit < 0.72 ? "#ffbf45" : lit < 0.92 ? "#ff8f4a" : "#d65a3c";
        g.fillRect(x + xx * F, y + yy * F, F, F);
      }
    }

    // jiskry kroužící kolem ohnivé koule
    for (let s = 0; s < 8; s++) {
      const a = f.life * 9 + s * Math.PI / 4;
      const rr = 4 + Math.sin(f.life * 23 + s) * 0.8;
      g.fillStyle = s & 1 ? "#ffbf45" : "#ff8f4a";
      dot(g, x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8);
    }
  }

  function drawPillar(g, f, t) {
    // sloup světla: jasné jádro, kolem průsvitné tělo, světlé pruhy putují vzhůru, okraje se rozpadají
    const H = (f.small ? 26 : 46) * Math.min(1, t * 3);
    const W0 = (f.small ? 2.5 : 4.5) * (1 - t * 0.6);
    const x = q(f.x);
    const y0 = q(f.y);
    const rows = Math.round(H * 2);
    const fade = Math.min(1, f.life / f.max * 1.8);
    // sloup světla osvětlí okolí jen se shadery (dřív tu žádná záře nebyla)
    if (PK.shaders) PK.shaders.light(x, y0 - 8, f.small ? 9 : 15, 0xffe08a, fade * 0.9, 8);
    g.globalCompositeOperation = "lighter";

    for (let r = 0; r < rows; r++) {
      const yy = y0 - r * F;
      const k = r / Math.max(1, rows);
      const hw = Math.max(F, q(W0 * (1 - k * 0.75)));
      const band = ((r + Math.floor(t * 50)) % 9) < 2;
      g.globalAlpha = fade * (1 - k * 0.6);
      g.fillStyle = "rgba(255,191,69,0.28)";
      g.fillRect(x - hw, yy, hw * 2, F);
      g.fillStyle = band ? "rgba(255,246,204,0.75)" : "rgba(255,224,138,0.3)";
      g.fillRect(x - hw + F, yy, hw * 2 - 2 * F, F);
      g.fillStyle = "rgba(255,246,204,0.85)";
      g.fillRect(x - F, yy, 2 * F, F);
      if (hash(r, 1, Math.floor(t * 20)) > 0.8) g.fillRect(x + (hash(r, 2, 7) > 0.5 ? hw : -hw - F), yy, F, F);
    }

    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
  }

  function drawTexts(g) {
    for (const f of state.fx) {
      if (f.kind !== "text") continue;
      const t = 1 - f.life / f.max;
      const y = Math.round(f.y - 10 * Math.sin(t * Math.PI * 0.5));
      PK.text(g, f.value, Math.round(f.x), y, f.color, { font: "3", align: "center", outline: C.ink, shadow: null, alpha: Math.min(1, f.life / 0.25) });
    }
  }

  function drawSlash(g, f, t) {
    // srpek seku: oblouk z jemných bodů, čelo je bílé a nejsilnější, ohon tenký a chladnější
    const x = q(f.x);
    const y = q(f.y) - 6;
    const d = f.dir;
    const r = 6;
    const a0 = -2.1 + f.tilt;
    const a1 = 1.0 + f.tilt;
    const head = Math.min(1, t * 2.4);
    const tail = Math.max(0, t * 1.8 - 0.8);
    const steps = 30;

    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      if (k > head || k < tail) continue;
      const a = a0 + (a1 - a0) * k;
      const rel = (k - tail) / Math.max(0.01, head - tail); // 0 = ohon, 1 = čelo
      const cx = x + Math.cos(a) * r * d;
      const cy = y + Math.sin(a) * r * 0.85;
      g.fillStyle = rel > 0.85 ? f.color[0] : rel > 0.5 ? f.color[1] : rel > 0.25 ? f.color[2] : f.color[3];
      dot(g, cx, cy);
      // tloušťka: uprostřed oblouku dva až tři body dovnitř
      const thick = Math.round(Math.sin(k * Math.PI) * 2.4 * rel);
      for (let w = 1; w <= thick; w++) {
        g.fillStyle = w === 1 ? f.color[Math.min(3, 1 + (rel < 0.6 ? 1 : 0))] : f.color[3];
        dot(g, x + Math.cos(a) * (r - w * F) * d, y + Math.sin(a) * (r - w * F) * 0.85);
      }
    }
  }

  function drawCollapse(g, f, t) {
    const spr = PK.buildings.get(f.type, f.team);
    const sink = q(Math.min(1, t * 1.15) * spr.h * 0.7);
    const jx = t < 0.6 ? q(Math.sin(t * 90) * (1.5 - t * 1.5)) : 0;

    g.save();
    g.beginPath();
    g.rect(-8192, -8192, 16384, q(f.y) - 1 + 8192);
    g.clip();
    g.globalAlpha = Math.max(0, 1 - Math.max(0, t - 0.7) / 0.3);
    g.drawImage(spr.c, Math.round(f.x) - spr.ax + jx, Math.round(f.y) - spr.ay + sink);
    g.restore();
    g.globalAlpha = 1;

    // prašná vlna u paty budovy
    if (t < 0.7) {
      g.fillStyle = "rgba(192,156,105,0.5)";
      const w = spr.w * (0.4 + t * 0.6);
      for (let i = 0; i < w * 2; i++) {
        const xx = f.x - w / 2 + i * F;
        const h = 1 + ((hash(i, 0, f.x | 0) * 3) | 0) * F;
        g.fillRect(q(xx), q(f.y - 1 - h), F, h);
      }
    }
  }

  PK.fx = fx;
})();
