/*
 * Animované pozadí hlavního menu: soumrak, hory, dva hrady a bitva
 * modrých proti rudým. Kreslí se do vlastního plátna přes celou plochu menu.
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
  let W = 384;
  let GY = 0; // horizont
  let still = null; // statická vrstva (obloha, hory, země)
  let hallX = 60;
  let citX = 320;

  const STATS = {
    soldier: { hp: 44, dmg: 9, rng: 15, cd: 0.9, sp: 22 },
    archer: { hp: 26, dmg: 7, rng: 90, cd: 1.5, sp: 20 },
    hero: { hp: 110, dmg: 16, rng: 17, cd: 0.8, sp: 24 }
  };

  let units = [];
  let arrows = [];
  let sparks = [];
  let puffs = [];
  let clouds = [];
  let clock = 0;
  let spawnT = 0;
  let last = 0;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const hex = c => `#${c.toString(16).padStart(6, "0")}`;

  function mixRGB(a, b, t) {
    const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t;
    const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255))) * t;
    const bl = (a & 255) + ((b & 255) - (a & 255)) * t;
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
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

  function ridge(g, color, base, amp, f1, f2, p) {
    g.fillStyle = color;
    for (let x = 0; x < W; x++) {
      const y = Math.round(GY - base - amp * (0.6 + 0.4 * Math.sin(x * f1 + p)) - amp * 0.5 * Math.sin(x * f2 + p * 2.3));
      g.fillRect(x, y, 1, GY - y + 2);
    }
  }

  function buildStill() {
    still = document.createElement("canvas");
    still.width = W;
    still.height = H;
    const g = still.getContext("2d");

    // obloha po řádcích se šachovnicovým dithrem mezi pásy
    for (let y = 0; y < GY + 2; y++) {
      const t = y / GY;
      const q = t * 18;
      for (let x = 0; x < W; x += 2) {
        const dither = ((x >> 1) + y) & 1 ? 0.5 : 0;
        g.fillStyle = hex(skyColor(Math.min(1, (Math.floor(q + dither) / 18))));
        g.fillRect(x, y, 2, 1);
      }
    }

    for (let i = 0; i < 70; i++) {
      const sy = Math.random() * GY * 0.55;
      g.fillStyle = `rgba(255,244,214,${(0.9 - sy / GY).toFixed(2)})`;
      g.fillRect(Math.floor(Math.random() * W), Math.floor(sy), 1, 1);
    }

    // měsíc
    const mx = Math.round(W * 0.74);
    const my = Math.round(GY * 0.3);
    g.fillStyle = "rgba(255,230,190,0.12)";
    g.beginPath(); g.arc(mx, my, 26, 0, 7); g.fill();
    g.fillStyle = "#fff1cf";
    g.beginPath(); g.arc(mx, my, 13, 0, 7); g.fill();
    g.fillStyle = "#e8d3a8";
    g.fillRect(mx - 5, my - 3, 3, 3);
    g.fillRect(mx + 3, my + 3, 4, 3);
    g.fillRect(mx - 2, my + 6, 2, 2);

    ridge(g, "#6a3f74", 6, 22, 0.021, 0.047, 1.1);
    ridge(g, "#47295f", 0, 16, 0.033, 0.081, 4.2);

    // pásmo lesa
    g.fillStyle = "#1d1533";
    for (let x = 0; x < W; x += 5) {
      const h = 7 + ((x * 7919) % 6);
      for (let r = 0; r < h; r++) g.fillRect(x + (r >> 1) - 1 + (h >> 2), GY - r + 2 - 0, Math.max(1, 5 - r), 1);
    }

    // země
    for (let y = GY; y < H; y++) {
      const t = (y - GY) / (H - GY);
      g.fillStyle = hex(mixRGB(0x40602f, 0x15261f, t));
      g.fillRect(0, y, W, 1);
    }

    // cesta mezi hrady
    for (let y = GY + 16; y < H - 8; y++) {
      const t = (y - GY) / (H - GY);
      g.fillStyle = hex(mixRGB(0x6a5236, 0x3a2c22, t));
      const w = 20 + t * 40;
      g.fillRect(Math.round(W * 0.1), y, Math.round(W * 0.8), 1);
      void w;
    }

    for (let i = 0; i < 520; i++) {
      const x = Math.floor(Math.random() * W);
      const y = GY + 2 + Math.floor(Math.random() * (H - GY - 2));
      g.fillStyle = Math.random() < 0.5 ? "#5f8a3f" : "#2c4a2b";
      g.fillRect(x, y, 1, 2);
    }
  }

  function resize() {
    const cw = Math.max(1, canvas.clientWidth);
    const ch = Math.max(1, canvas.clientHeight);
    W = Math.max(320, Math.ceil(H * cw / ch));
    canvas.width = W;
    canvas.height = H;
    GY = Math.round(H * 0.56);
    hallX = Math.round(W * 0.1) + 22;
    citX = Math.round(W * 0.9) - 22;
    ctx.imageSmoothingEnabled = false;
    buildStill();

    clouds = [];
    for (let i = 0; i < 6; i++) clouds.push({ x: Math.random() * W, y: rnd(10, GY * 0.55), w: rnd(30, 70), v: rnd(2, 6) });
  }

  /* ---------- bitva ---------- */
  function spawn(team) {
    const r = Math.random();
    const type = r < 0.55 ? "soldier" : r < 0.88 ? "archer" : "hero";
    const s = STATS[type];
    units.push({
      team, type, hp: s.hp, max: s.hp,
      x: team === "blue" ? hallX + 34 : citX - 34,
      y: rnd(GY + 22, H - 22),
      face: team === "blue" ? 1 : -1,
      cd: rnd(0, s.cd), atk: 0, pending: false, wd: 0, moving: false,
      flash: 0, dead: 0, id: Math.random() * 100
    });
  }

  function addSparks(x, y, n, cols) {
    for (let i = 0; i < n; i++) {
      sparks.push({ x, y, vx: rnd(-40, 40), vy: rnd(-60, -10), life: rnd(0.3, 0.7), t: 0, c: cols[(Math.random() * cols.length) | 0], g: 120 });
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

  function hurt(v, dmg, x, y) {
    if (v.dead) return;
    v.hp -= dmg;
    v.flash = 0.12;
    addSparks(x, y - 10, 5, [0xfff3b0, 0xffbf45, 0xffffff]);
    if (v.hp <= 0) {
      v.dead = 0.001;
      addSparks(v.x, v.y - 8, 10, [0xff7a2c, 0xffbf45, 0x6a5a7a]);
    }
  }

  function update(dt) {
    clock += dt;

    spawnT -= dt;
    if (spawnT <= 0) {
      spawnT = rnd(0.9, 1.7);
      for (const team of ["blue", "red"]) {
        if (units.filter(u => u.team === team && !u.dead).length < 10) spawn(team);
      }
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
              hurt(f, s.dmg * rnd(0.8, 1.2), f.x, f.y);
            }
          }
        }
        continue;
      }

      const f = nearestFoe(u);
      u.target = f;
      const goalX = f ? f.x : u.team === "blue" ? citX : hallX;
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
      } else if (d > 1) {
        const sp = s.sp * (u.type === "archer" && f && d < s.rng + 25 ? 0 : 1);
        if (sp) {
          u.moving = true;
          u.face = dx >= 0 ? 1 : -1;
          u.x += (dx / d) * sp * dt;
          u.y += (dy / d) * sp * 0.6 * dt;
          u.wd += sp * dt;
        }
      }

      // odstrčení od sousedů
      for (const o of units) {
        if (o === u || o.dead) continue;
        const ex = u.x - o.x;
        const ey = (u.y - o.y) * 2;
        const dd = Math.hypot(ex, ey);
        if (dd > 0 && dd < 10) { u.x += (ex / dd) * 14 * dt; u.y += (ey / dd) * 7 * dt; }
      }
      u.y = Math.max(GY + 14, Math.min(H - 14, u.y));
    }
    units = units.filter(u => u.dead < 2.4);

    for (const a of arrows) {
      a.t += dt;
      if (a.t >= a.T) {
        a.done = true;
        if (a.foe && !a.foe.dead) hurt(a.foe, a.dmg, a.x1, a.y1 + 10);
      }
    }
    arrows = arrows.filter(a => !a.done);

    for (const p of sparks) { p.t += dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    sparks = sparks.filter(p => p.t < p.life);

    // kouř z hradů a jiskry nad bojištěm
    if (Math.random() < dt * 6) puffs.push({ x: hallX + 10, y: GY - 28, t: 0, life: 4, r: 3 });
    if (Math.random() < dt * 6) puffs.push({ x: citX - 4, y: GY - 36, t: 0, life: 4, r: 3 });
    if (Math.random() < dt * 14) puffs.push({ x: rnd(W * 0.3, W * 0.7), y: rnd(GY + 20, H - 10), t: 0, life: 3, r: 1, ember: true });
    for (const p of puffs) { p.t += dt; p.y -= (p.ember ? 14 : 8) * dt; p.x += Math.sin(clock + p.y * 0.1) * 4 * dt; }
    puffs = puffs.filter(p => p.t < p.life);

    for (const c of clouds) { c.x += c.v * dt; if (c.x - c.w > W) c.x = -c.w; }
  }

  /* ---------- kreslení ---------- */
  function drawClouds() {
    for (const c of clouds) {
      ctx.fillStyle = "rgba(255,190,190,0.18)";
      for (let dy = -3; dy <= 3; dy++) {
        const w = c.w * Math.sqrt(1 - (dy / 4) * (dy / 4));
        ctx.fillRect(Math.round(c.x - w / 2), Math.round(c.y + dy * 2), Math.round(w), 2);
      }
    }
  }

  function drawUnit(u) {
    const footX = Math.round(u.x);
    const footY = Math.round(u.y);
    const flip = u.face < 0;
    const sh = ctx.globalAlpha;

    if (u.dead) {
      const l = U.lying(u.type, u.team, flip);
      ctx.globalAlpha = Math.max(0, Math.min(1, 2.4 - u.dead));
      ctx.drawImage(l.c, footX - (l.c.width >> 1), footY - l.c.height + 2);
      ctx.globalAlpha = sh;
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

  function drawCastle(type, team, x) {
    const spr = PK.buildings.get(type, team);
    const fy = GY + 34;
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(x - (spr.w >> 1) + 6, fy - 4, spr.w - 12, 7);
    ctx.drawImage(spr.c, x - spr.ax, fy - spr.ay);
  }

  function draw() {
    ctx.drawImage(still, 0, 0);
    drawClouds();

    drawCastle("hall", "blue", hallX);
    drawCastle("citadel", "red", citX);

    const sorted = units.slice().sort((a, b) => (a.dead ? -1 : 0) - (b.dead ? -1 : 0) || a.y - b.y);
    for (const u of sorted) drawUnit(u);

    for (const a of arrows) {
      const k = a.t / a.T;
      const x = a.x0 + (a.x1 - a.x0) * k;
      const y = a.y0 + (a.y1 - a.y0) * k - Math.sin(k * Math.PI) * 22;
      const k2 = Math.min(1, k + 0.05);
      const x2 = a.x0 + (a.x1 - a.x0) * k2;
      const y2 = a.y0 + (a.y1 - a.y0) * k2 - Math.sin(k2 * Math.PI) * 22;
      ctx.strokeStyle = "#f4e2b0";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, Math.round(y) + 0.5);
      ctx.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
      ctx.stroke();
    }

    for (const p of puffs) {
      const k = p.t / p.life;
      if (p.ember) {
        ctx.fillStyle = `rgba(255,${150 + Math.round(80 * (1 - k))},60,${(1 - k).toFixed(2)})`;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      } else {
        ctx.fillStyle = `rgba(190,170,190,${(0.4 * (1 - k)).toFixed(2)})`;
        const r = Math.round(p.r + k * 6);
        ctx.fillRect(Math.round(p.x - r / 2), Math.round(p.y), r, Math.max(1, r - 1));
      }
    }

    for (const p of sparks) {
      ctx.fillStyle = hex(p.c);
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }

    // záře u obzoru
    const gl = ctx.createLinearGradient(0, GY - 20, 0, GY + 20);
    gl.addColorStop(0, "rgba(255,170,100,0)");
    gl.addColorStop(0.5, "rgba(255,170,100,0.08)");
    gl.addColorStop(1, "rgba(255,170,100,0)");
    ctx.fillStyle = gl;
    ctx.fillRect(0, GY - 20, W, 40);
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
  for (let i = 0; i < 6; i++) { spawn("blue"); spawn("red"); }
  for (const u of units) u.x += (u.team === "blue" ? 1 : -1) * rnd(20, 120);
  requestAnimationFrame(frame);
})();
