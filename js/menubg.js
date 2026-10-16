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
  const H0 = 216; // výška scény na šířku; na výšku (mobil) scéna roste do výšky
  let H = H0;
  const P = 512; // perioda opakujících se vrstev
  const CHUNK = 260; // rozestup kulis
  let W = 384;
  let GY = 0;
  let sky = null;
  let layers = null;
  let vignette = null;

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

  // Vrstvy se pečou v jemné mřížce (2x2 body na art px) a kreslí se v art px přes měřítko kontextu.
  const K = 2;
  const q = v => Math.round(v * K) / K;

  function makeLayer(h) {
    const c = document.createElement("canvas");
    c.width = P * K;
    c.height = h * K;
    return c;
  }

  // zápis do ImageData po jemných bodech
  function surface(c) {
    const g = c.getContext("2d");
    const img = g.createImageData(c.width, c.height);
    const set = (x, y, col, a = 255) => {
      if (x < 0 || y < 0 || x >= c.width || y >= c.height) return;
      const i = (y * c.width + x) * 4;
      img.data[i] = (col >> 16) & 255; img.data[i + 1] = (col >> 8) & 255; img.data[i + 2] = col & 255; img.data[i + 3] = a;
    };
    return { set, done: () => g.putImageData(img, 0, 0) };
  }

  // vrstva hor s celým počtem period, takže se plynule opakuje; hřeben má světlou hranu zleva
  function ridge(c, color, amp, k1, k2, phase) {
    const { set, done } = surface(c);
    const w = Math.PI * 2 / (P * K);
    const h = c.height;
    const lit = mixRGB(color, 0xffb66b, 0.25);
    const dark = mixRGB(color, 0x140c2e, 0.25);
    let prev = 0;
    for (let x = 0; x < P * K; x++) {
      const y = Math.round(h - amp * K * (1.1 + 0.6 * Math.sin(x * w * k1 + phase) + 0.4 * Math.sin(x * w * k2 + phase * 2.3)));
      for (let yy = y; yy < h; yy++) {
        // stoupající svah ke světlu je světlejší, ve spodní třetině dithered přechod do tmy
        let col = yy < y + 2 ? (y < prev ? lit : color) : color;
        if (yy > y + 6 && ((x * 7 + yy * 3) % 11) === 0 && y < prev) col = lit;
        if ((yy - y) > (h - y) * 0.6 && PK.bayer(x, yy) < ((yy - y) / (h - y) - 0.6) * 1.8) col = dark;
        set(x, yy, col);
      }
      prev = y;
    }
    done();
  }

  function build() {
    const { bayer } = PK;
    sky = document.createElement("canvas");
    sky.width = W * K;
    sky.height = (GY + 2) * K;
    const sg = surface(sky);

    for (let y = 0; y < sky.height; y++) {
      const v = (y / K / GY) * 18;
      for (let x = 0; x < sky.width; x++) {
        const lv = Math.floor(v + bayer(x, y) - 0.5);
        sg.set(x, y, skyColor(Math.min(1, Math.max(0, lv) / 18)));
      }
    }

    // měsíc s halo (dithered) a krátery
    const mx = Math.round(W * 0.74) * K;
    const my = Math.round(GY * 0.3) * K;
    for (let y = my - 60; y <= my + 60; y++) {
      for (let x = mx - 60; x <= mx + 60; x++) {
        const d = Math.hypot(x + 0.5 - mx, y + 0.5 - my);
        if (d < 26) {
          const crater = Math.hypot(x - mx + 8, y - my + 4) < 3.5 || Math.hypot(x - mx - 9, y - my - 8) < 4.5 || Math.hypot(x - mx + 2, y - my - 13) < 2.5;
          const rim = d > 24.5 || (x - mx) + (y - my) > 26;
          sg.set(x, y, crater ? 0xe8d3a8 : rim ? 0xf0dcb4 : 0xfff1cf);
        } else if (d < 52 && bayer(x, y) < (1 - (d - 26) / 26) * 0.35) {
          sg.set(x, y, mixRGB(skyColor(Math.min(1, y / K / GY)), 0xffe6be, 0.35));
        }
      }
    }

    for (let i = 0; i < 80; i++) {
      const sy = Math.random() * GY * 0.55;
      const x = Math.floor(Math.random() * sky.width);
      const y = Math.floor(sy * K);
      const a = Math.round(255 * (0.9 - sy / GY));
      sg.set(x, y, 0xfff4d6, a);
      if (Math.random() < 0.15) { sg.set(x - 1, y, 0xfff4d6, a >> 1); sg.set(x + 1, y, 0xfff4d6, a >> 1); sg.set(x, y - 1, 0xfff4d6, a >> 1); sg.set(x, y + 1, 0xfff4d6, a >> 1); }
    }
    sg.done();

    layers = {};
    layers.far = makeLayer(70);
    ridge(layers.far, 0x6a3f74, 22, 3, 7, 1.1);

    layers.near = makeLayer(54);
    ridge(layers.near, 0x47295f, 17, 5, 11, 4.2);

    // les na obzoru: siluety jehličnanů po jemných řádcích, větve stupňovité
    layers.forest = makeLayer(30);
    {
      const { set, done } = surface(layers.forest);
      const H2 = 30 * K;
      for (let x = 0; x < P * K; x += 11) {
        const h = (14 + Math.floor(hash(x) * 14)) * K;
        const cx = x + 4;
        for (let r = 0; r < h; r++) {
          const half = Math.max(0.5, (r / h) * 7.5 - ((r % 7) < 3 ? 1.5 : 0));
          const y = H2 - h + r;
          for (let xx = Math.round(cx - half); xx <= Math.round(cx + half); xx++) set(((xx % (P * K)) + P * K) % (P * K), y, xx < cx - half + 1 && r > 2 ? 0x2a1f45 : 0x1d1533);
        }
      }
      for (let y = H2 - 6; y < H2; y++) for (let x = 0; x < P * K; x++) set(x, y, 0x1d1533);
      done();
    }

    layers.ground = makeLayer(H - GY);
    {
      const { set, done } = surface(layers.ground);
      const GH = (H - GY) * K;
      // louka: odspodu tma, u obzoru teplý odlesk západu; skvrny zlaté a chladné trávy
      // (šum se opakuje s periodou vrstvy, aby navazovala)
      const PW = P * K;
      for (let y = 0; y < GH; y++) {
        const ty = y / GH;
        for (let x = 0; x < PW; x++) {
          const t = ty + (bayer(x, y) - 0.5) * 0.06;
          let c = mixRGB(0x40602f, 0x15261f, Math.max(0, Math.min(1, t)));
          const n = PK.tnoise(x / 64, y / 26, PW / 64, 21) + (PK.tnoise(x / 18, y / 9, PW / 18, 22) - 0.5) * 0.5;
          const lv = Math.floor((n - 0.5) * 5 + bayer(x, y) - 0.5);
          if (lv >= 1) c = mixRGB(c, 0x9a8a3c, Math.min(2, lv) * 0.13 * (1 - ty * 0.6));
          else if (lv <= -1) c = mixRGB(c, 0x1f3a4d, Math.min(2, -lv) * 0.16);
          // růžovofialový nádech oblohy těsně pod obzorem
          if (bayer(x, y) < (0.22 - ty) * 3) c = mixRGB(c, 0x8a4a6a, 0.22);
          set(x, y, c);
        }
      }
      // kvetoucí trsy: drobné kvítky v hloučcích
      const FL = [0xf7f1df, 0xffe08a, 0xff8fa0, 0xd0b4ff];
      for (let k = 0; k < 70; k++) {
        const cx = Math.random() * PW;
        const cy = 4 + Math.random() * (GH - 8);
        const c = FL[k % 4];
        const dim = mixRGB(c, 0x15261f, 0.35 + (cy / GH) * 0.4);
        for (let i = 0; i < 9; i++) {
          const x = Math.floor(cx + (Math.random() - 0.5) * 22) % PW;
          const y = Math.floor(cy + (Math.random() - 0.5) * 8);
          set(x, y, cy / GH < 0.5 ? c : dim);
          set(x, y + 1, 0x2c4a2b);
        }
      }
      // stébla: 1x2 jemné body, světlá špička
      for (let i = 0; i < 2600; i++) {
        const x = Math.floor(Math.random() * P * K);
        const y = Math.floor(Math.random() * GH);
        const r = Math.random();
        const c = r < 0.5 ? 0x5f8a3f : r < 0.75 ? 0x2c4a2b : 0x6a5236;
        set(x, y, c);
        set(x, y + 1, mixRGB(c, 0x15261f, 0.4));
        if (r < 0.2) set(x, y - 1, 0x86ae58);
      }
      done();
    }
  }

  // Stejná vinjeta jako ve hře: od okrajů tma, která se po jemných bodech (ordered dithering) ztrácí do středu.
  function buildVignette() {
    const { bayer, smooth } = PK;
    const c = document.createElement("canvas");
    c.width = W * K;
    c.height = H * K;
    const { set, done } = surface(c);

    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const dx = (x - c.width / 2) / (c.width / 2);
        const dy = (y - c.height / 2) / (c.height / 2);
        const d = Math.pow(Math.abs(dx), 2.2) * 1.0 + Math.pow(Math.abs(dy), 2.4) * 0.8;
        const v = smooth(0.18, 1.1, d) * 7;
        const lv = Math.floor(v + bayer(x, y) - 0.5 + 0.5);
        if (lv <= 0) continue;
        set(x, y, 0x0a0816, Math.min(235, lv * 36));
      }
    }

    done();
    return c;
  }

  function resize() {
    const cw = Math.max(1, canvas.clientWidth);
    const ch = Math.max(1, canvas.clientHeight);
    // Plátno musí mít poměr stran jako obrazovka, jinak ho CSS zdeformuje (na mobilu na výšku
    // se scéna 320 px široká mačkala do úzkého displeje). Na úzkých displejích se proto
    // prodlužuje výška a velikost art px zůstává jako na šířku.
    const nw = Math.max(H0, Math.ceil(H0 * cw / ch));
    const nh = Math.max(H0, Math.round(nw * ch / cw));
    if (nw === W && nh === H && canvas.width === W * K) return;
    W = nw;
    H = nh;
    canvas.width = W * K;
    canvas.height = H * K;
    GY = Math.round(H0 * 0.56 + (H - H0) * 0.5);
    // kreslí se v art px, plátno má jemnou hustotu (sprity se vykreslí přes svá jemná dvojčata)
    ctx.setTransform(K, 0, 0, K, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.hdDraw = true;
    vignette = buildVignette();
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
    return { x: j * 34 + hash(j + 401) * 30, y: GY + 4 + hash(j + 402) * (H - GY - 6), v: PK.props.treeKind(hash(j + 403)), s: hash(j + 404) * 6.28 };
  }

  function drawTree(t) {
    const sp = PK.props.trees[t.v];
    const x = q(t.x - cam);
    const y = Math.round(t.y) + 14;
    const sway = Math.sin(clock * 1.3 + t.s) > 0.35 ? 0.5 : 0;
    shadow(x + 2, y, 10, 2);
    ctx.drawImage(sp.trunk, x - sp.ax, y - sp.ay);
    ctx.drawImage(sp.crown[0], x - sp.ax + sway, y - sp.ay);
  }

  // stín: plochá elipsa z jemných řádků
  function shadow(cx, cy, rx, ry) {
    ctx.fillStyle = "rgba(20,12,40,0.32)";
    for (let r = -ry * K; r < ry * K; r++) {
      const k = (r + 0.5) / (ry * K);
      const hw = q(rx * Math.sqrt(1 - k * k));
      ctx.fillRect(cx - hw, cy + r / K, hw * 2, 1 / K);
    }
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
    for (let x = -off; x < W; x += P) ctx.drawImage(img, x, y, P, img.height / K);
  }

  function drawScenery() {
    for (let i = Math.floor((cam - 120) / CHUNK); i <= Math.floor((cam + W + 120) / CHUNK); i++) {
      const s = sceneryAt(i);
      if (!s) continue;
      const spr = PK.buildings.get(s.type, s.team);
      const x = q(s.x - cam);
      const fy = GY + Math.round(s.dy);
      shadow(x + 4, fy, spr.w / 2 - 4, 3.5);
      ctx.drawImage(spr.c, x - spr.ax, fy - spr.ay);
    }
  }

  function drawUnit(u) {
    const footX = q(u.x - cam);
    const footY = q(u.y);
    const flip = u.face < 0;

    if (u.dead) {
      const l = U.lying(u.type, u.team, flip);
      ctx.globalAlpha = Math.max(0, Math.min(1, 2.4 - u.dead));
      ctx.drawImage(l.c, footX - (l.c.width >> 1), footY - l.c.height + 2);
      ctx.globalAlpha = 1;
      return;
    }

    shadow(footX, footY + 0.5, 6, 1.5);

    let anim = "idle";
    let idx = Math.floor(clock * 1.4 + u.id) & 1;
    if (u.atk > 0) { anim = "attack"; idx = U.attackFrame(1 - u.atk / 0.3); }
    else if (u.moving) { anim = "walk"; const n = U.frameCount("walk"); idx = Math.floor(u.wd / 2.9 * n / 6) % n; }

    const rec = U.frame(u.type, u.team, anim, idx);
    const img = u.flash > 0 ? U.flash(rec, flip) : flip ? rec.cf : rec.c;
    const ox = flip ? U.CELL - 1 - U.AX : U.AX;
    ctx.drawImage(img, footX - ox, footY - U.AY + 6);
  }

  function draw() {
    ctx.save();
    if (shake > 0.1) ctx.translate(q(rnd(-shake, shake)), q(rnd(-shake, shake)));

    ctx.drawImage(sky, 0, 0, W, GY + 2);

    // mraky: ploché pruhy po jemných řádcích, spodní hrana tmavší
    for (const c of clouds) {
      for (let r = -6 * K; r <= 6 * K; r++) {
        const k = r / (7 * K);
        const w = q(c.w * Math.sqrt(1 - k * k) * (1 + 0.08 * Math.sin(r * 1.7 + c.w)));
        ctx.fillStyle = r > 3 * K ? "rgba(150,90,140,0.16)" : "rgba(255,190,190,0.16)";
        ctx.fillRect(q(c.x - w / 2), q(c.y) + r / K, w, 1 / K);
      }
    }

    // ptáci: křídla z jemných bodů, mávají
    ctx.fillStyle = "#2a1c3c";
    const f = 1 / K;
    for (const b of birds) {
      const up = Math.sin(clock * 9 + b.p) > 0 ? -1 : 1;
      const x = q(b.x);
      const y = q(b.y);
      ctx.fillRect(x, y, f * 2, f);
      for (let i = 1; i <= 3; i++) {
        const dy = up * (i < 3 ? i : 2) * f;
        ctx.fillRect(x - i * f, y + dy, f, f);
        ctx.fillRect(x + f + i * f, y + dy, f, f);
      }
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

    // šípy: dřík z jemných bodů, světlý hrot, letka
    for (const a of arrows) {
      const arc = k => a.y0 + (a.y1 - a.y0) * k - Math.sin(k * Math.PI) * 22;
      const k = a.t / a.T;
      const k2 = Math.min(1, k + 0.02);
      const x = a.x0 + (a.x1 - a.x0) * k - cam;
      const y = arc(k);
      let ux = (a.x1 - a.x0) * (k2 - k) || 1e-3;
      let uy = arc(k2) - y;
      const l = Math.hypot(ux, uy) || 1;
      ux /= l; uy /= l;
      ctx.fillStyle = "#946b45";
      for (let i = 1; i <= 8; i++) ctx.fillRect(q(x - ux * i * f), q(y - uy * i * f), f, f);
      ctx.fillStyle = "#f4e2b0";
      ctx.fillRect(q(x), q(y), f, f);
      ctx.fillStyle = "#e8e6e8";
      ctx.fillRect(q(x - ux * 4 - uy * f), q(y - uy * 4 + ux * f), f, f);
      ctx.fillRect(q(x - ux * 4 + uy * f), q(y - uy * 4 - ux * f), f, f);
    }

    for (const r of rocks) {
      const k = r.t / r.T;
      const x = q(r.sx + (r.tx - r.sx) * k - cam);
      const y = q(-20 + (r.ty - 8 + 20) * k * k);
      // cíl dopadu: jemná rudá elipsa
      ellipse(q(r.tx - cam), q(r.ty), 2 + 6 * k, 1 + 3 * k, `rgba(255,90,60,${(0.2 + k * 0.6).toFixed(2)})`);
      // hořící balvan: ohon, kámen se světlou hranou, žhavé jádro
      ctx.fillStyle = "#ffbf45";
      ctx.fillRect(x - 2.5, y - 6, 2, 4);
      ctx.fillStyle = "#ff8f4a";
      ctx.fillRect(x - 2, y - 7.5, 1, 2);
      ctx.fillStyle = "#3a2c22";
      ctx.fillRect(x - 3, y - 2.5, 6, 5);
      ctx.fillRect(x - 2.5, y - 3, 5, 6);
      ctx.fillStyle = "#5a463a";
      ctx.fillRect(x - 2.5, y - 2.5, 2.5, 0.5);
      ctx.fillRect(x - 2.5, y - 2, 0.5, 2);
      ctx.fillStyle = "#ff7a2c";
      ctx.fillRect(x - 0.5, y - 0.5, 1.5, 1.5);
      ctx.fillStyle = "#ffd27a";
      ctx.fillRect(x, y, 0.5, 0.5);
    }

    for (const r of rings) {
      const k = r.t / 0.5;
      ellipse(q(r.x - cam), q(r.y), 6 + k * 30, 3 + k * 14, `rgba(255,220,160,${(1 - k).toFixed(2)})`);
    }

    for (const p of puffs) {
      const k = p.t / p.life;
      const x = q(p.x - cam);
      const y = q(p.y);
      if (p.ember) {
        ctx.fillStyle = `rgba(255,${150 + Math.round(80 * (1 - k))},60,${(1 - k).toFixed(2)})`;
        ctx.fillRect(x, y, f, f);
      } else if (p.fire) {
        ctx.fillStyle = k < 0.5 ? `rgba(255,200,80,${(1 - k).toFixed(2)})` : `rgba(255,100,40,${(1 - k).toFixed(2)})`;
        ctx.fillRect(x, y, 1, 1);
        ctx.fillRect(x + f, y - f, f, f);
      } else {
        // obláček: zaoblený, po jemných bodech
        const r = q(p.r + k * (p.dark ? 8 : 6));
        ctx.fillStyle = p.dust ? `rgba(150,120,90,${(0.35 * (1 - k)).toFixed(2)})`
          : p.dark ? `rgba(60,50,60,${(0.6 * (1 - k)).toFixed(2)})`
            : `rgba(190,170,190,${(0.4 * (1 - k)).toFixed(2)})`;
        const hh = Math.max(f, r - 1);
        ctx.fillRect(x - r / 2 + f, y, Math.max(f, r - 2 * f), hh);
        ctx.fillRect(x - r / 2, y + f, r, Math.max(f, hh - 2 * f));
      }
    }

    for (const p of sparks) {
      ctx.fillStyle = hex(p.c);
      ctx.fillRect(q(p.x - cam), q(p.y), f, f);
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
    if (vignette) ctx.drawImage(vignette, 0, 0, W, H);
  }

  // elipsa z jemných bodů (rázová vlna, cíl dopadu)
  function ellipse(cx, cy, rx, ry, color) {
    ctx.fillStyle = color;
    const steps = Math.ceil((rx + ry) * 2 * K * 2);
    let lx = null, ly = null;
    for (let i = 0; i < steps; i++) {
      const a = i / steps * Math.PI * 2;
      const x = q(cx + Math.cos(a) * rx);
      const y = q(cy + Math.sin(a) * ry);
      if (x === lx && y === ly) continue;
      ctx.fillRect(x, y, 1 / K, 1 / K);
      lx = x; ly = y;
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (menu.hidden || !menu.classList.contains("scene") || (PK.loader && PK.loader.covering)) { last = 0; return; }

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
