/*
 * Particles and one-shot effects. Everything is drawn as whole pixels on the
 * art grid. Public spawners take logical game coordinates (960x480 world);
 * internally positions are art pixels.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const { C, css, rng } = PK;

  const FIRE = [0xfff6cc, 0xffe08a, 0xffbf45, 0xff8f4a, 0xd65a3c, 0xa8323a, 0x4a2430].map(c => css(c));
  const SMOKE = [0x6d6674, 0x57505f, 0x403a4a, 0x2d2838].map(c => css(c));
  const DUST = [0xe0c68e, 0xc09c69, 0x9d7a55, 0x7b5b45].map(c => css(c));
  const GOLD = [0xfff6cc, 0xffe08a, 0xffbf45, 0xe0902a].map(c => css(c));
  const HEAL = [0xe0fff2, 0x9ef7c8, 0x5ff0c0, 0x2fa58c].map(c => css(c));
  const ASH = [0x8a8085, 0x665f68, 0x4a4552].map(c => css(c));
  const CHIP = [0xbe9660, 0x946b45, 0x6c4a35].map(c => css(c));
  const STEEL = [0xffffff, 0xe8e6e8, 0xc6c7d3, 0x9d9fb5].map(c => css(c));
  const HURT = [0xffffff, 0xffd27a, 0xff8f4a, 0xd65a3c].map(c => css(c));

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
    if (state.parts.length > 760) return;

    state.parts.push({
      kind, x, y, vx, vy, life, max: life,
      g: o.g || 0, size: o.size || 1, grow: o.grow || 0, drag: o.drag || 0,
      c: o.c || FIRE, fade: !!o.fade, sway: o.sway || 0, ph: R() * 6.28, additive: !!o.additive
    });
  }

  function circle(g, cx, cy, r, color, dash = 0, rot = 0) {
    g.fillStyle = color;
    const steps = Math.max(12, Math.ceil(r * 7));
    let lx = null;
    let ly = null;

    for (let i = 0; i < steps; i++) {
      const a = i / steps * Math.PI * 2;
      if (dash && Math.floor((a + rot) / (Math.PI * 2) * dash * 2) % 2) continue;
      const x = Math.round(cx + Math.cos(a) * r);
      const y = Math.round(cy + Math.sin(a) * r);
      if (x === lx && y === ly) continue;
      g.fillRect(x, y, 1, 1);
      lx = x;
      ly = y;
    }
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
      state.fx.push({ kind: "burst", x: ax, y: ay, life: 0.2, max: 0.2, big: !!strong });
      const n = strong ? 8 : 4;

      for (let i = 0; i < n; i++) {
        const a = R() * Math.PI * 2;
        const s = rnd(25, 70);
        emit("spark", ax, ay, Math.cos(a) * s, Math.sin(a) * s - 18, rnd(0.18, 0.4), { g: 140, c: HURT });
      }
    },

    slash(x, y, dir, color = STEEL) {
      state.fx.push({ kind: "slash", x: A(x), y: A(y), dir, life: 0.18, max: 0.18, color });
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
          c: ramp, size: 2, grow: 2, fade: true, drag: 1.4
        });
      }
    },

    spawn(x, y) {
      state.fx.push({ kind: "ring", x: A(x), y: A(y) + 2, r: 9, color: 0xffe08a, life: 0.5, max: 0.5, dash: 0, grow: false, shrink: true });

      for (let i = 0; i < 12; i++) {
        emit("spark", A(x) + rnd(-8, 8), A(y) + rnd(-2, 5), rnd(-6, 6), rnd(-34, -12), rnd(0.5, 0.9), { c: GOLD, g: -8 });
      }
    },

    build(x, y, w) {
      for (let i = 0; i < 16; i++) {
        emit("dust", A(x) + rnd(-w, w) * 0.5, A(y) + rnd(-3, 3), rnd(-22, 22), rnd(-20, -4), rnd(0.5, 1.0), {
          c: DUST, size: 2, grow: 3, fade: true, drag: 1.2
        });
      }

      for (let i = 0; i < 8; i++) {
        emit("chip", A(x) + rnd(-w, w) * 0.4, A(y) - 4, rnd(-30, 30), rnd(-60, -25), rnd(0.4, 0.8), { c: CHIP, g: 170 });
      }

      state.shake = Math.max(state.shake, 1);
    },

    chop(x, y) {
      for (let i = 0; i < 4; i++) {
        emit("chip", A(x) + rnd(-3, 3), A(y), rnd(-26, 26), rnd(-48, -18), rnd(0.35, 0.6), { c: CHIP, g: 150 });
      }

      if (R() > 0.6) {
        emit("leaf", A(x) + rnd(-8, 8), A(y) - 24, rnd(-8, 8), rnd(6, 16), rnd(1.0, 1.6), { c: [css(C.g[4]), css(C.g[3])], g: 0, sway: 10 });
      }
    },

    mine(x, y) {
      for (let i = 0; i < 6; i++) {
        emit("spark", A(x) + rnd(-3, 3), A(y), rnd(-40, 40), rnd(-60, -20), rnd(0.25, 0.5), { c: GOLD, g: 170 });
      }
    },

    coin(x, y, value, wood) {
      const color = wood ? 0xd9a867 : 0xffe08a;
      fx.text(x, y - 24, value, color);

      for (let i = 0; i < 5; i++) {
        emit("spark", A(x) + rnd(-4, 4), A(y) - 14, rnd(-16, 16), rnd(-40, -16), rnd(0.4, 0.7), { c: wood ? CHIP : GOLD, g: 120 });
      }
    },

    healBurst(x, y, radius) {
      state.fx.push({ kind: "ring", x: A(x), y: A(y), r: A(radius), color: 0x9ef7c8, life: 0.7, max: 0.7, dash: 14, grow: true, spin: true });
      state.fx.push({ kind: "ring", x: A(x), y: A(y), r: A(radius) * 0.6, color: 0xe0fff2, life: 0.55, max: 0.55, dash: 9, grow: true, spin: true });
    },

    healOn(x, y) {
      for (let i = 0; i < 6; i++) {
        emit("plus", A(x) + rnd(-6, 6), A(y) - 4 + rnd(-4, 6), rnd(-4, 4), rnd(-30, -14), rnd(0.6, 1.0), { c: HEAL, fade: false });
      }
    },

    levelUp(x, y) {
      state.fx.push({ kind: "pillar", x: A(x), y: A(y) + 6, life: 0.9, max: 0.9 });
      state.fx.push({ kind: "ring", x: A(x), y: A(y) + 4, r: 20, color: 0xffe08a, life: 0.7, max: 0.7, dash: 0, grow: true });

      for (let i = 0; i < 18; i++) {
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
    },

    shakeScreen(v) {
      state.shake = Math.max(state.shake, v);
    },

    smoke(x, y, dark = false) {
      emit("smoke", x, y, rnd(2, 7), rnd(-10, -5), rnd(1.4, 2.4), { c: SMOKE, size: 2, grow: 3, fade: true, sway: 3 });
      if (dark) state.parts[state.parts.length - 1].c = SMOKE.slice(1);
    },

    ember(x, y) {
      emit("ember", x, y, rnd(-4, 4), rnd(-22, -10), rnd(0.8, 1.6), { c: FIRE.slice(2), sway: 4 });
    },

    footstep(x, y, water) {
      if (water) {
        emit("spark", A(x) + rnd(-3, 3), A(y), rnd(-12, 12), rnd(-30, -14), 0.35, { c: [css(C.v[4]), css(C.v[3])], g: 120 });
      } else if (R() > 0.55) {
        emit("dust", A(x) + rnd(-2, 2), A(y), rnd(-5, 5), rnd(-6, -1), 0.4, { c: DUST, size: 1, grow: 1, fade: true });
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
  // Svitělýči a listy nad bujnou trávou, popel nad popelem; počty rostou s velikostí mapy.
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

        PK.world.light(g, x, y, 4, 0xffe08a, 0.4 + tw * 0.2);
        g.fillStyle = tw > 0.2 ? "#fff6cc" : "#ffe08a";
        g.fillRect(Math.round(x), Math.round(y), 1, 1);
      } else if (a.kind === "ash") {
        const x = a.x + Math.sin(T * 0.6 + a.ph) * 6 + ((T * 2 + a.ph * 10) % 24) - 12;
        const y = a.y + ((T * a.sp + a.ph * 20) % 60) - 30;
        g.fillStyle = (Math.floor(T * 3 + a.ph * 4) & 3) === 0 ? "#ff8f4a" : "#8a8085";
        g.fillRect(Math.round(x), Math.round(y), 1, 1);
      } else {
        const x = a.x + Math.sin(T * 0.7 + a.ph) * 12 + ((T * 3 * (a.sp / 8) + a.ph * 20) % 40) - 20;
        const y = a.y + ((T * a.sp * 0.7 + a.ph * 30) % 50) - 25;
        g.fillStyle = (Math.floor(a.ph * 3) & 1) ? "#6ba459" : "#98c76a";
        g.fillRect(Math.round(x), Math.round(y), 2, 1);
        g.fillRect(Math.round(x) + 1, Math.round(y) + 1, 1, 1);
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
      } else if (f.kind === "fireball") {
        if (f.life <= 0) {
          explode(f);
          continue;
        }

        const t = 1 - f.life / f.max;
        const x = f.x1 + (f.x2 - f.x1) * t;
        const y = f.y1 + (f.y2 - f.y1) * t - Math.sin(t * Math.PI) * 14;
        emit("ember", x + rnd(-1, 1), y + rnd(-1, 1), rnd(-8, 8), rnd(-6, 12), rnd(0.2, 0.4), { c: FIRE.slice(1, 6), additive: true });
      } else if (f.kind === "corpse") {
        if (f.life > 0 && f.max - f.life > f.wait + 0.3 && !f.wisp) {
          f.wisp = true;

          for (let k = 0; k < 4; k++) {
            emit("mote", f.x + rnd(-4, 4), f.y - 6, rnd(-4, 4), rnd(-26, -14), rnd(0.9, 1.5), {
              c: f.team === "red" ? [css(0xffd27a), css(0xff8f4a), css(0xd65a3c)] : [css(0xe0ffff), css(0x9ef0f0), css(0x4fc0d0)],
              sway: 6
            });
          }
        }

        if (f.life <= 0) continue;
      } else if (f.kind === "collapse") {
        if (f.life > 0 && Math.random() < 0.55) {
          emit("dust", f.x + rnd(-24, 24), f.y - rnd(0, 10), rnd(-14, 14), rnd(-24, -6), rnd(0.5, 1.1), { c: DUST, size: 2, grow: 3, fade: true, drag: 1 });
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

    state.fx.push({ kind: "ring", x, y, r, color: 0xffbf45, life: 0.45, max: 0.45, dash: 0, grow: true });
    state.fx.push({ kind: "ring", x, y, r: r * 0.65, color: 0xfff6cc, life: 0.3, max: 0.3, dash: 0, grow: true });
    state.fx.push({ kind: "burst", x, y, life: 0.3, max: 0.3, big: true });
    state.decals.push({ kind: "scorch", x, y, r: r * 0.6, life: 14, max: 14 });
    state.shake = Math.max(state.shake, 3.5);

    for (let i = 0; i < 44; i++) {
      const a = R() * Math.PI * 2;
      const s = rnd(10, r * 3.2);
      emit("ember", x, y, Math.cos(a) * s, Math.sin(a) * s * 0.7 - 10, rnd(0.3, 0.8), { c: FIRE, size: R() > 0.7 ? 2 : 1, drag: 2.5 });
    }

    for (let i = 0; i < 12; i++) {
      const a = R() * Math.PI * 2;
      emit("smoke", x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.4, rnd(-6, 6), rnd(-22, -8), rnd(0.8, 1.5), { c: SMOKE, size: 2, grow: 3, fade: true });
    }

    if (f.onLand) f.onLand();
  }

  /* ---------- drawing ---------- */
  function drawGround(g, T) {
    for (const d of state.decals) {
      if (d.kind === "rubble") {
        const spr = PK.buildings.rubble(d.type, d.team);
        g.drawImage(spr.c, Math.round(d.x - spr.w / 2), Math.round(d.y - spr.h + 3));
      } else if (d.kind === "scorch") {
        const a = Math.min(1, d.life / 4) * 0.5;
        g.globalAlpha = a;
        g.fillStyle = "#1a1624";

        for (let yy = -d.r * 0.55; yy <= d.r * 0.55; yy++) {
          const hw = Math.sqrt(1 - (yy / (d.r * 0.55)) ** 2) * d.r;
          const w = Math.round(hw * 2 * (0.75 + 0.25 * Math.sin(yy * 2.1)));
          g.fillRect(Math.round(d.x - w / 2), Math.round(d.y + yy), w, 1);
        }

        g.globalAlpha = 1;
      }
    }

    for (const f of state.fx) {
      const t = 1 - f.life / f.max;

      if (f.kind === "ring") {
        const r = f.grow ? f.r * (0.25 + 0.75 * Math.sin(t * Math.PI * 0.5)) : f.shrink ? f.r * (1 - t * 0.7) : f.r;
        g.globalAlpha = Math.min(1, f.life / f.max * 1.6);
        circle(g, f.x, f.y, r, css(f.color), f.dash, f.spin ? T * 3 : 0);
        g.globalAlpha = 1;
      } else if (f.kind === "ping") {
        drawPing(g, f, t);
      } else if (f.kind === "corpse") {
        drawCorpse(g, f);
      }
    }
  }

  function drawPing(g, f, t) {
    const x = Math.round(f.x);
    const y = Math.round(f.y);
    g.globalAlpha = 1 - t * t;

    if (f.type === "attack") {
      g.fillStyle = "#ff8f4a";
      const k = Math.round(5 - t * 2);

      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        for (let i = 1; i <= 3; i++) g.fillRect(x + dx * (k + i) - (dx < 0 ? 0 : 0), y + dy * (k + i) * 0.6 | 0, 1, 1);
      }

      g.fillStyle = "#ffd27a";
      g.fillRect(x, y, 1, 1);
      circle(g, x, y, 6 - t * 2, "#d65a3c");
    } else if (f.type === "gather") {
      circle(g, x, y, 5 + t * 3, "#ffe08a");
      g.fillStyle = "#fff6cc";
      g.fillRect(x, y, 1, 1);
    } else {
      // move: three chevrons collapsing onto the point
      const k = Math.round(8 * (1 - t));
      g.fillStyle = "#e0ffff";

      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const px = x + dx * (k + 2);
        const py = y + dy * (k + 2) * 0.6;
        g.fillRect(Math.round(px), Math.round(py), 1, 1);
        g.fillRect(Math.round(px - dy), Math.round(py + dx), 1, 1);
        g.fillRect(Math.round(px + dy), Math.round(py - dx), 1, 1);
      }

      circle(g, x, y, 2 + Math.round(t * 2), "#9ef0f0");
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
      const q = Math.round((1 - fade) * 4);
      lie.dis = lie.dis || {};
      if (!lie.dis[q]) lie.dis[q] = lie.pix.dissolve(q / 4).toCanvas();
      img = lie.dis[q];
    }

    // slide 2px while falling
    const slide = Math.min(1, (a - 0.14) / 0.12);
    const dx = f.dir > 0 ? -2 - 1 : 2 - 30;

    g.drawImage(img, Math.round(f.x + f.dir * 2 * slide) + dx, Math.round(f.y) - 3 - 16);
  }

  function drawAir(g, T) {
    for (const f of state.fx) {
      const t = 1 - f.life / f.max;

      if (f.kind === "burst") {
        const x = Math.round(f.x);
        const y = Math.round(f.y);
        const big = f.big;

        if (t < 0.4) {
          g.fillStyle = "#ffffff";
          g.fillRect(x - 1, y, 3, 1);
          g.fillRect(x, y - 1, 1, 3);
          if (big) {
            g.fillRect(x - 2, y, 5, 1);
            g.fillRect(x, y - 2, 1, 5);
          }
        } else if (t < 0.75) {
          g.fillStyle = "#ffbf45";
          const k = big ? 3 : 2;
          g.fillRect(x - k, y - k, 1, 1);
          g.fillRect(x + k, y - k, 1, 1);
          g.fillRect(x - k, y + k, 1, 1);
          g.fillRect(x + k, y + k, 1, 1);
          g.fillStyle = "#fff6cc";
          g.fillRect(x, y, 1, 1);
        }
      } else if (f.kind === "slash") {
        drawSlash(g, f, t);
      } else if (f.kind === "arrow") {
        const x = f.x1 + (f.x2 - f.x1) * t;
        const y = f.y1 + (f.y2 - f.y1) * t - Math.sin(t * Math.PI) * 4;
        const dx = f.x2 - f.x1;
        const dy = f.y2 - f.y1;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;

        for (let i = 0; i < 5; i++) {
          g.fillStyle = i === 0 ? "#ffffff" : i < 4 ? f.color : "#9d9fb5";
          g.fillRect(Math.round(x - ux * i), Math.round(y - uy * i), 1, 1);
        }
      } else if (f.kind === "bolt") {
        const x = f.x1 + (f.x2 - f.x1) * t;
        const y = f.y1 + (f.y2 - f.y1) * t;
        const dx = f.x2 - f.x1;
        const dy = f.y2 - f.y1;
        const len = Math.hypot(dx, dy) || 1;

        for (let i = 0; i < 6; i++) {
          g.fillStyle = i < 2 ? "#fff6cc" : i < 4 ? "#ffbf45" : "#e0902a";
          g.fillRect(Math.round(x - dx / len * i * 1.3), Math.round(y - dy / len * i * 1.3), 1, 1);
        }
      } else if (f.kind === "fireball") {
        const x = f.x1 + (f.x2 - f.x1) * t;
        const y = f.y1 + (f.y2 - f.y1) * t - Math.sin(t * Math.PI) * 14;
        PK.world.light(g, x, y, 12, 0xff8f4a, 0.55);
        g.fillStyle = "#d65a3c";
        g.fillRect(Math.round(x) - 2, Math.round(y) - 1, 5, 3);
        g.fillRect(Math.round(x) - 1, Math.round(y) - 2, 3, 5);
        g.fillStyle = "#ffbf45";
        g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
        g.fillStyle = "#fff6cc";
        g.fillRect(Math.round(x), Math.round(y), 1, 1);
      } else if (f.kind === "pillar") {
        const h = Math.round(46 * Math.min(1, t * 3));
        const w = Math.round(7 * (1 - t));
        g.globalAlpha = Math.min(1, f.life / f.max * 1.8);

        for (let y = 0; y < h; y++) {
          const yy = Math.round(f.y) - y;
          const ww = Math.max(1, Math.round(w * (1 - y / 60)));
          g.fillStyle = y % 3 === 0 ? "#fff6cc" : "#ffe08a";
          g.fillRect(Math.round(f.x) - ww, yy, ww * 2, 1);
        }

        g.globalAlpha = 1;
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
      const size = Math.round(p.size + p.grow * t);
      const px = Math.round(p.x);
      const py = Math.round(p.y);

      if (p.additive !== lastAdd) {
        g.globalCompositeOperation = p.additive ? "lighter" : "source-over";
        lastAdd = p.additive;
      }

      if (p.fade) g.globalAlpha = Math.max(0, (1 - t) * 0.65);
      g.fillStyle = p.c[ci];

      if (p.kind === "plus") {
        g.fillRect(px, py - 1, 1, 3);
        g.fillRect(px - 1, py, 3, 1);
      } else if (p.kind === "mote") {
        g.fillRect(px, py, 1, 1);
        if (t < 0.6) {
          g.globalAlpha = 0.35;
          g.fillRect(px - 1, py, 3, 1);
          g.fillRect(px, py - 1, 1, 3);
        }
      } else {
        g.fillRect(px, py, size, size);
      }

      if (p.fade || p.kind === "mote") g.globalAlpha = 1;
    }

    if (lastAdd) g.globalCompositeOperation = "source-over";
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
    const x = Math.round(f.x);
    const y = Math.round(f.y) - 6;
    const d = f.dir;
    const pts = [[-4, -5], [-2, -3], [-1, -1], [0, 1], [1, 3], [3, 4]];
    const n = Math.max(1, Math.round(pts.length * Math.min(1, t * 2.2)));

    for (let i = 0; i < n; i++) {
      g.fillStyle = f.color[Math.min(f.color.length - 1, Math.floor(t * 3) + (i > 3 ? 1 : 0))] || "#fff";
      g.fillRect(x + pts[i][0] * d, y + pts[i][1], 1, 1);
      if (i > 0 && i < 5) g.fillRect(x + (pts[i][0] + 1) * d, y + pts[i][1], 1, 1);
    }
  }

  function drawCollapse(g, f, t) {
    const spr = PK.buildings.get(f.type, f.team);
    const sink = Math.round(Math.min(1, t * 1.15) * spr.h * 0.7);
    const jx = t < 0.6 ? Math.round(Math.sin(t * 90) * (1.5 - t * 1.5)) : 0;

    g.save();
    g.beginPath();
    g.rect(0, 0, 8192, Math.round(f.y) - 1);
    g.clip();
    g.globalAlpha = Math.max(0, 1 - Math.max(0, t - 0.7) / 0.3);
    g.drawImage(spr.c, Math.round(f.x) - spr.ax + jx, Math.round(f.y) - spr.ay + sink);
    g.restore();
    g.globalAlpha = 1;
  }

  PK.fx = fx;
})();
