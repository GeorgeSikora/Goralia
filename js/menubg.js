/*
 * Animované pozadí hlavního menu: posouvající se krajina s parallaxem a
 * nekonečná bitva modrých proti rudým (vojáci, šípy, balvany, požáry).
 */
(() => {
  "use strict";

  const PK = window.PK;
  const U = PK.units;
  const canvas = document.querySelector("#menubg");
  const menu = document.querySelector("#menu");
  if (!canvas || !menu) return;

  const ctx = canvas.getContext("2d");
  const H = 216;
  const P = 512; // perioda opakujících se vrstev
  const CHUNK = 260; // rozestup kulis
  let W = 384;
  let GY = 0;
  let sky = null;
  let layers = null;

  const STATS = {
    soldier: { hp: 46, dmg: 9, rng: 15, cd: 0.8, sp: 24 },
    archer: { hp: 24, dmg: 6, rng: 85, cd: 1.3, sp: 22 }
  };
  const PER_SIDE = 15;

  let cam = 0;
  let units = [];
  let arrows = [];
  let rocks = [];
  let rings = [];
  let sparks = [];
  let puffs = [];
  let clouds = [];
  let birds = [];
  let clock = 0;
  let spawnT = 0;
  let rockT = 1;
  let shake = 0;
  let flash = 0;
  let last = 0;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const hex = c => `#${c.toString(16).padStart(6, "0")}`;
  const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  function mixRGB(a, b, t) {
    const ch = s => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t);
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
  }

  function skyColor(t) {
    const stops = [[0, 0x140c2e], [0.45, 0x3d2466], [0.75, 0xc4607a], [1, 0xffb66b]];
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [t0, c0] = stops[i - 1];
        const [t1, c1] = stops[i];
        return mixRGB(c0, c1, (t - t0) / (t1 - t0));
      }
    }
    return stops[stops.length - 1][1];
  }

  function makeLayer(h) {
    const c = document.createElement("canvas");
    c.width = P;
    c.height = h;
    return c;
  }

  // vrstva hor s celým počtem period, takže se plynule opakuje
  function ridge(g, color, amp, k1, k2, phase) {
    g.fillStyle = color;
    const w = Math.PI * 2 / P;
    const h = g.canvas.height;
    for (let x = 0; x < P; x++) {
      const y = Math.round(h - amp * (1.1 + 0.6 * Math.sin(x * w * k1 + phase) + 0.4 * Math.sin(x * w * k2 + phase * 2.3)));
      g.fillRect(x, y, 1, h - y);
    }
  }

  function build() {
    sky = document.createElement("canvas");
    sky.width = W;
    sky.height = GY + 2;
    let g = sky.getContext("2d");

    for (let y = 0; y < GY + 2; y++) {
      const q = (y / GY) * 18;
      for (let x = 0; x < W; x += 2) {
        const d = ((x >> 1) + y) & 1 ? 0.5 : 0;
        g.fillStyle = hex(skyColor(Math.min(1, Math.floor(q + d) / 18)));
        g.fillRect(x, y, 2, 1);
      }
    }

    for (let i = 0; i < 80; i++) {
      const sy = Math.random() * GY * 0.55;
      g.fillStyle = `rgba(255,244,214,${(0.9 - sy / GY).toFixed(2)})`;
      g.fillRect(Math.floor(Math.random() * W), Math.floor(sy), 1, 1);
    }

    const mx = Math.round(W * 0.74);
    const my = Math.round(GY * 0.3);
    g.fillStyle = "rgba(255,230,190,0.12)";
    g.beginPath(); g.arc(mx, my, 26, 0, 7); g.fill();
    g.fillStyle = "#fff1cf";
    g.beginPath(); g.arc(mx, my, 13, 0, 7); g.fill();
    g.fillStyle = "#e8d3a8";
    g.fillRect(mx - 5, my - 3, 3, 3);
    g.fillRect(mx + 3, my + 3, 4, 3);

    layers = {};
    layers.far = makeLayer(70);
    ridge(layers.far.getContext("2d"), "#6a3f74", 22, 3, 7, 1.1);

    layers.near = makeLayer(54);
    ridge(layers.near.getContext("2d"), "#47295f", 17, 5, 11, 4.2);

    layers.forest = makeLayer(30);
    g = layers.forest.getContext("2d");
    g.fillStyle = "#1d1533";
    for (let x = 0; x < P; x += 6) {
      const h = 14 + Math.floor(hash(x) * 14);
      for (let r = 0; r < h; r++) g.fillRect(x + (r >> 2) - (h >> 3), 30 - r, Math.max(1, 6 - (r >> 2)), 1);
    }

    layers.ground = makeLayer(H - GY);
    g = layers.ground.getContext("2d");
    for (let y = 0; y < H - GY; y++) {
      g.fillStyle = hex(mixRGB(0x40602f, 0x15261f, y / (H - GY)));
      g.fillRect(0, y, P, 1);
    }
    for (let i = 0; i < 1100; i++) {
      g.fillStyle = Math.random() < 0.5 ? "#5f8a3f" : Math.random() < 0.5 ? "#2c4a2b" : "#6a5236";
      g.fillRect(Math.floor(Math.random() * P), Math.floor(Math.random() * (H - GY)), 1, 2);
    }
  }

  function resize() {
    const cw = Math.max(1, canvas.clientWidth);
    const ch = Math.max(1, canvas.clientHeight);
    W = Math.max(320, Math.ceil(H * cw / ch));
    canvas.width = W;
    canvas.height = H;
    GY = Math.round(H * 0.56);
    ctx.imageSmoothingEnabled = false;
    build();
    clouds = [];
    for (let i = 0; i < 7; i++) clouds.push({ x: Math.random() * W, y: rnd(10, GY * 0.55), w: rnd(30, 70), v: rnd(3, 8) });
    birds = [];
    for (let i = 0; i < 5; i++) birds.push({ x: Math.random() * W, y: rnd(20, GY * 0.5), v: rnd(14, 26), p: Math.random() * 6 });
  }

  /* ---------- bitva ---------- */
  function spawn(team, x) {
    const type = Math.random() < 0.94 ? "soldier" : "archer";
    const s = STATS[type];
    units.push({
      team, type, hp: s.hp,
      x: x !== undefined ? x : team === "blue" ? cam - 30 : cam + W + 30,
      y: rnd(GY + 20, H - 14),
      face: team === "blue" ? 1 : -1,
      cd: rnd(0, s.cd), atk: 0, pending: false, wd: rnd(0, 20), moving: false,
      flash: 0, dead: 0, id: Math.random() * 100, target: null
    });
  }

  function addSparks(x, y, n, cols, spd = 40) {
    for (let i = 0; i < n; i++) {
      sparks.push({ x, y, vx: rnd(-spd, spd), vy: rnd(-spd * 1.5, -spd * 0.2), life: rnd(0.3, 0.8), t: 0, c: cols[(Math.random() * cols.length) | 0] });
    }
  }

  function hurt(v, dmg, x, y) {
    if (v.dead) return;
    v.hp -= dmg;
    v.flash = 0.12;
    addSparks(x, y - 10, 4, [0xfff3b0, 0xffbf45, 0xffffff]);
    if (v.hp <= 0) {
      v.dead = 0.001;
      addSparks(v.x, v.y - 8, 8, [0xff7a2c, 0xffbf45, 0x6a5a7a]);
    }
  }

  function nearestFoe(u) {
    let best = null;
    let bd = 1e9;
    for (const o of units) {
      if (o.team === u.team || o.dead) continue;
      const d = Math.abs(o.x - u.x) + Math.abs(o.y - u.y) * 1.5;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  function explode(x, y) {
    rings.push({ x, y, t: 0 });
    addSparks(x, y - 4, 26, [0xfff3b0, 0xffbf45, 0xff7a2c, 0xffffff], 90);
    for (let i = 0; i < 8; i++) puffs.push({ x: x + rnd(-8, 8), y: y - rnd(0, 8), t: 0, life: 1.6, r: 5, dark: true });
    shake = 3;
    flash = 0.5;
    for (const u of units) {
      if (u.dead) continue;
      const d = Math.hypot(u.x - x, (u.y - y) * 1.6);
      if (d < 28) hurt(u, 40 * (1 - d / 40), u.x, u.y);
    }
  }

  function treeAt(j) {
    if (hash(j + 400) > 0.7) return null;
    return { x: j * 34 + hash(j + 401) * 30, y: GY + 4 + hash(j + 402) * (H - GY - 6), v: Math.floor(hash(j + 403) * 3), s: hash(j + 404) * 6.28 };
  }

  function drawTree(t) {
    const sp = PK.props.trees[t.v];
    const x = Math.round(t.x - cam);
    const y = Math.round(t.y) + 14;
    const sway = Math.sin(clock * 1.3 + t.s) > 0.35 ? 1 : 0;
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(x - 8, y - 2, 20, 4);
    ctx.drawImage(sp.trunk, x - sp.ax, y - sp.ay);
    ctx.drawImage(sp.crown[0], x - sp.ax + sway, y - sp.ay);
  }

  function sceneryAt(i) {
    const r = hash(i);
    if (r > 0.62) return null;
    const type = r < 0.22 ? "tower" : r < 0.42 ? "hut" : "barracks";
    return {
      type,
      team: hash(i + 9) < 0.5 ? "blue" : "red",
      x: i * CHUNK + 60 + hash(i + 3) * 120,
      dy: 12 + hash(i + 5) * 8,
      burn: hash(i + 7) < 0.55
    };
  }

  function update(dt) {
    clock += dt;
    cam += 15 * dt;

    // kamera si drží frontu v záběru
    const alive = units.filter(u => !u.dead);
    if (alive.length > 4) {
      const front = alive.reduce((s, u) => s + u.x, 0) / alive.length;
      cam += (front - W / 2 - cam) * 0.4 * dt;
    }

    spawnT -= dt;
    if (spawnT <= 0) {
      spawnT = rnd(0.25, 0.55);
      for (const team of ["blue", "red"]) {
        if (alive.filter(u => u.team === team).length < PER_SIDE) spawn(team);
      }
    }

    rockT -= dt;
    if (rockT <= 0) {
      rockT = rnd(0.9, 2);
      const tx = cam + rnd(W * 0.25, W * 0.75);
      const ty = rnd(GY + 24, H - 12);
      rocks.push({ tx, ty, sx: tx + rnd(-70, 70), t: 0, T: 0.9 });
    }

    for (const u of units) {
      if (u.dead) { u.dead += dt; continue; }
      const s = STATS[u.type];
      u.flash = Math.max(0, u.flash - dt);
      u.cd -= dt;
      u.moving = false;

      if (u.atk > 0) {
        u.atk -= dt;
        if (u.pending && u.atk < 0.15) {
          u.pending = false;
          const f = u.target;
          if (f && !f.dead) {
            if (u.type === "archer") {
              const d = Math.hypot(f.x - u.x, f.y - u.y);
              arrows.push({ x0: u.x, y0: u.y - 14, x1: f.x, y1: f.y - 10, t: 0, T: Math.max(0.25, d / 170), foe: f, dmg: s.dmg });
            } else {
              hurt(f, s.dmg * rnd(0.8, 1.2) * (u.team === "blue" ? 1.15 : 1), f.x, f.y);
            }
          }
        }
        continue;
      }

      const f = nearestFoe(u);
      u.target = f;
      const goalX = f ? f.x : u.x + (u.team === "blue" ? 60 : -60);
      const goalY = f ? f.y : u.y;
      const dx = goalX - u.x;
      const dy = goalY - u.y;
      const d = Math.hypot(dx, dy);

      if (f && d <= s.rng + (u.type === "archer" ? 0 : 2)) {
        u.face = dx >= 0 ? 1 : -1;
        if (u.cd <= 0) {
          u.cd = s.cd * rnd(0.9, 1.2);
          u.atk = 0.3;
          u.pending = true;
        }
      } else if (d > 1 && !(u.type === "archer" && f && d < s.rng + 20)) {
        u.moving = true;
        u.face = dx >= 0 ? 1 : -1;
        u.x += (dx / d) * s.sp * dt;
        u.y += (dy / d) * s.sp * 0.6 * dt;
        u.wd += s.sp * dt;
        if (Math.random() < dt * 3) puffs.push({ x: u.x, y: u.y, t: 0, life: 0.7, r: 2, dust: true });
      }

      for (const o of units) {
        if (o === u || o.dead) continue;
        const ex = u.x - o.x;
        const ey = (u.y - o.y) * 2;
        const dd = Math.hypot(ex, ey);
        if (dd > 0 && dd < 10) { u.x += (ex / dd) * 14 * dt; u.y += (ey / dd) * 7 * dt; }
      }
      u.y = Math.max(GY + 14, Math.min(H - 12, u.y));
    }
    units = units.filter(u => u.dead < 2.4 && u.x > cam - 160 && u.x < cam + W + 160);

    for (const a of arrows) {
      a.t += dt;
      if (a.t >= a.T) {
        a.done = true;
        if (a.foe && !a.foe.dead) hurt(a.foe, a.dmg, a.x1, a.y1 + 10);
      }
    }
    arrows = arrows.filter(a => !a.done);

    for (const r of rocks) {
      r.t += dt;
      if (r.t >= r.T) { r.done = true; explode(r.tx, r.ty); }
    }
    rocks = rocks.filter(r => !r.done);

    for (const r of rings) r.t += dt;
    rings = rings.filter(r => r.t < 0.5);

    for (const p of sparks) { p.t += dt; p.vy += 120 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    sparks = sparks.filter(p => p.t < p.life);

    // požáry a kouř na kulisách
    for (let i = Math.floor((cam - 100) / CHUNK); i <= Math.floor((cam + W + 100) / CHUNK); i++) {
      const s = sceneryAt(i);
      if (!s || !s.burn) continue;
      const top = GY + s.dy - 30;
      if (Math.random() < dt * 20) puffs.push({ x: s.x + rnd(-8, 8), y: top + rnd(0, 10), t: 0, life: 0.6, r: 2, fire: true });
      if (Math.random() < dt * 5) puffs.push({ x: s.x + rnd(-4, 4), y: top, t: 0, life: 3.5, r: 3 });
    }
    if (Math.random() < dt * 16) puffs.push({ x: cam + rnd(0, W), y: rnd(GY + 20, H - 5), t: 0, life: 3, r: 1, ember: true });

    for (const p of puffs) {
      p.t += dt;
      p.y -= (p.ember ? 16 : p.fire ? 22 : p.dust ? 2 : 8) * dt;
      p.x += Math.sin(clock + p.y * 0.1) * 4 * dt;
    }
    puffs = puffs.filter(p => p.t < p.life);

    for (const c of clouds) { c.x += c.v * dt; if (c.x - c.w > W) c.x = -c.w; }
    for (const b of birds) { b.x -= b.v * dt; if (b.x < -10) { b.x = W + 10; b.y = rnd(20, GY * 0.5); } }

    shake = Math.max(0, shake - dt * 10);
    flash = Math.max(0, flash - dt * 2.5);
  }

  /* ---------- kreslení ---------- */
  function tile(img, factor, y) {
    const off = Math.floor(cam * factor) % P;
    for (let x = -off; x < W; x += P) ctx.drawImage(img, x, y);
  }

  function drawScenery() {
    for (let i = Math.floor((cam - 120) / CHUNK); i <= Math.floor((cam + W + 120) / CHUNK); i++) {
      const s = sceneryAt(i);
      if (!s) continue;
      const spr = PK.buildings.get(s.type, s.team);
      const x = Math.round(s.x - cam);
      const fy = GY + Math.round(s.dy);
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fillRect(x - (spr.w >> 1) + 6, fy - 4, spr.w - 12, 7);
      ctx.drawImage(spr.c, x - spr.ax, fy - spr.ay);
    }
  }

  function drawUnit(u) {
    const footX = Math.round(u.x - cam);
    const footY = Math.round(u.y);
    const flip = u.face < 0;

    if (u.dead) {
      const l = U.lying(u.type, u.team, flip);
      ctx.globalAlpha = Math.max(0, Math.min(1, 2.4 - u.dead));
      ctx.drawImage(l.c, footX - (l.c.width >> 1), footY - l.c.height + 2);
      ctx.globalAlpha = 1;
      return;
    }

    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(footX - 6, footY - 1, 12, 3);

    let anim = "idle";
    let idx = Math.floor(clock * 1.4 + u.id) & 1;
    if (u.atk > 0) { anim = "attack"; const p = 1 - u.atk / 0.3; idx = p < 0.35 ? 0 : p < 0.65 ? 1 : 2; }
    else if (u.moving) { anim = "walk"; idx = Math.floor(u.wd / 3.7) % 6; }

    const rec = U.frame(u.type, u.team, anim, idx);
    const img = u.flash > 0 ? U.flash(rec, flip) : flip ? rec.cf : rec.c;
    const ox = flip ? U.CELL - 1 - U.AX : U.AX;
    ctx.drawImage(img, footX - ox, footY - U.AY + 6);
  }

  function draw() {
    ctx.save();
    if (shake > 0.1) ctx.translate(Math.round(rnd(-shake, shake)), Math.round(rnd(-shake, shake)));

    ctx.drawImage(sky, 0, 0);

    for (const c of clouds) {
      ctx.fillStyle = "rgba(255,190,190,0.18)";
      for (let dy = -3; dy <= 3; dy++) {
        const w = c.w * Math.sqrt(1 - (dy / 4) * (dy / 4));
        ctx.fillRect(Math.round(c.x - w / 2), Math.round(c.y + dy * 2), Math.round(w), 2);
      }
    }

    ctx.fillStyle = "#2a1c3c";
    for (const b of birds) {
      const up = Math.sin(clock * 9 + b.p) > 0 ? -1 : 1;
      const x = Math.round(b.x);
      const y = Math.round(b.y);
      ctx.fillRect(x, y, 1, 1);
      ctx.fillRect(x - 1, y + up, 1, 1);
      ctx.fillRect(x + 1, y + up, 1, 1);
      ctx.fillRect(x - 2, y + up * 2, 1, 1);
      ctx.fillRect(x + 2, y + up * 2, 1, 1);
    }

    tile(layers.far, 0.08, GY - 70);
    tile(layers.near, 0.2, GY - 54);
    tile(layers.forest, 0.45, GY - 28);
    tile(layers.ground, 1, GY);
    drawScenery();

    const items = [];
    for (let j = Math.floor((cam - 40) / 34); j <= Math.floor((cam + W + 40) / 34); j++) {
      const t = treeAt(j);
      if (t) items.push({ y: t.y + 14, tree: t });
    }
    for (const u of units) items.push({ y: u.dead ? -1 : u.y, u });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) {
      if (it.tree) drawTree(it.tree);
      else drawUnit(it.u);
    }

    for (const a of arrows) {
      const arc = k => a.y0 + (a.y1 - a.y0) * k - Math.sin(k * Math.PI) * 22;
      const k = a.t / a.T;
      const k2 = Math.min(1, k + 0.05);
      ctx.strokeStyle = "#f4e2b0";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(a.x0 + (a.x1 - a.x0) * k - cam) + 0.5, Math.round(arc(k)) + 0.5);
      ctx.lineTo(Math.round(a.x0 + (a.x1 - a.x0) * k2 - cam) + 0.5, Math.round(arc(k2)) + 0.5);
      ctx.stroke();
    }

    for (const r of rocks) {
      const k = r.t / r.T;
      const x = Math.round(r.sx + (r.tx - r.sx) * k - cam);
      const y = Math.round(-20 + (r.ty - 8 + 20) * k * k);
      ctx.strokeStyle = `rgba(255,90,60,${(0.2 + k * 0.6).toFixed(2)})`;
      ctx.strokeRect(Math.round(r.tx - cam) - 6 * k - 2, Math.round(r.ty) - 1, 12 * k + 4, 2);
      ctx.fillStyle = "#ffbf45";
      ctx.fillRect(x - 3, y - 6, 3, 6);
      ctx.fillStyle = "#3a2c22";
      ctx.fillRect(x - 3, y - 3, 6, 6);
      ctx.fillStyle = "#ff7a2c";
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }

    for (const r of rings) {
      const k = r.t / 0.5;
      ctx.strokeStyle = `rgba(255,220,160,${(1 - k).toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(Math.round(r.x - cam), Math.round(r.y), 6 + k * 30, 3 + k * 14, 0, 0, 7);
      ctx.stroke();
    }

    for (const p of puffs) {
      const k = p.t / p.life;
      const x = Math.round(p.x - cam);
      const y = Math.round(p.y);
      if (p.ember) {
        ctx.fillStyle = `rgba(255,${150 + Math.round(80 * (1 - k))},60,${(1 - k).toFixed(2)})`;
        ctx.fillRect(x, y, 1, 1);
      } else if (p.fire) {
        ctx.fillStyle = k < 0.5 ? `rgba(255,200,80,${(1 - k).toFixed(2)})` : `rgba(255,100,40,${(1 - k).toFixed(2)})`;
        ctx.fillRect(x, y, 2, 2);
      } else {
        const r = Math.round(p.r + k * (p.dark ? 8 : 6));
        ctx.fillStyle = p.dust ? `rgba(150,120,90,${(0.35 * (1 - k)).toFixed(2)})`
          : p.dark ? `rgba(60,50,60,${(0.6 * (1 - k)).toFixed(2)})`
            : `rgba(190,170,190,${(0.4 * (1 - k)).toFixed(2)})`;
        ctx.fillRect(x - (r >> 1), y, r, Math.max(1, r - 1));
      }
    }

    for (const p of sparks) {
      ctx.fillStyle = hex(p.c);
      ctx.fillRect(Math.round(p.x - cam), Math.round(p.y), 1, 1);
    }

    const gl = ctx.createLinearGradient(0, GY - 20, 0, GY + 20);
    gl.addColorStop(0, "rgba(255,170,100,0)");
    gl.addColorStop(0.5, "rgba(255,170,100,0.08)");
    gl.addColorStop(1, "rgba(255,170,100,0)");
    ctx.fillStyle = gl;
    ctx.fillRect(0, GY - 20, W, 40);

    if (flash > 0.02) {
      ctx.fillStyle = `rgba(255,220,170,${(flash * 0.25).toFixed(2)})`;
      ctx.fillRect(0, 0, W, H);
    }

    ctx.restore();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (menu.hidden || !menu.classList.contains("scene")) { last = 0; return; }

    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    update(dt);
    draw();
  }

  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  window.addEventListener("resize", resize);
  resize();
  for (let i = 0; i < 8; i++) { spawn("blue", cam + rnd(0, W * 0.5)); spawn("red", cam + rnd(W * 0.5, W)); }
  requestAnimationFrame(frame);
})();
