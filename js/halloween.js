/*
 * Halloween: sezónní výzdoba od 20. října do 2. listopadu.
 * Na mapách přibudou dýně, vyřezávané dýně se svíčkou, náhrobky a strašák,
 * nad krajinou poletují netopýři a noc má nádech do fialova. V menu létají
 * netopýři místo ptáků a mezi stromy svítí dýně.
 *
 * Je to jen vzhled: simulace ani server o výzdobě nevědí, takže hráči
 * s výzdobou a bez ní spolu hrají bez rozdílu.
 * Ruční přepnutí: ?halloween=1 / ?halloween=0 (zapamatuje se v localStorage pk-halloween).
 */
(() => {
  "use strict";

  const PK = (window.PK = window.PK || {});
  const { C, Pix, mix, hash, HD } = PK;

  /* ---------- kdy ---------- */
  function seasonOn() {
    let force = null;
    try {
      const q = new URLSearchParams(location.search).get("halloween");
      if (q === "1" || q === "0") localStorage.setItem("pk-halloween", q);
      const s = localStorage.getItem("pk-halloween");
      if (s === "1" || s === "0") force = s === "1";
    } catch (e) { /* bez localStorage platí kalendář */ }
    if (force !== null) return force;
    const d = new Date();
    const m = d.getMonth();
    const day = d.getDate();
    return (m === 9 && day >= 20) || (m === 10 && day <= 2);
  }

  const H = { on: seasonOn() };
  PK.halloween = H;
  if (!H.on || !PK.props) return;

  /* ---------- barvy ---------- */
  // dýně: od stínu v rýze po světlo shora zleva
  const PUMP = [0x4a1c14, 0x7a2e16, C.a[0], 0xc8701e, C.a[1], 0xf2a640, C.a[2]];
  const STONE = [C.h[0], C.h[1], C.h[2], C.h[3], C.h[4], C.h[5], mix(C.h[5], C.white, 0.4)];
  const pick = (ramp, t) => ramp[t <= 0 ? 0 : t >= ramp.length - 1 ? ramp.length - 1 : Math.round(t)];
  const mk = (w, h) => new Pix(w * HD, h * HD);

  /* Dýně v jemné mřížce: žebrovaný ovál, světlo zleva shora, rýhy mezi žebry, stopka.
   * face: vyřezaný obličej; zapíše jeho body do masky (pro záři po setmění). */
  function pumpkin(P, cx, by, rx, ry, o = {}) {
    const cy = by - ry;
    const ribs = o.ribs || 5;
    const cut = new Set();
    if (o.face) carve(cx, cy, rx, ry, o.face, cut);

    for (let y = Math.floor(cy - ry - 1); y <= by; y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx); x++) {
        const u = (x + 0.5 - cx) / rx;
        let v = (y + 0.5 - cy) / ry;
        // horní důlek u stopky a lehce zploštělé dno
        if (v < 0) v *= 1 + 0.22 * Math.max(0, 1 - Math.abs(u) * 2.2);
        if (v > 0) v *= 1.04;
        const r2 = u * u + v * v;
        if (r2 > 1) continue;
        const nz = Math.sqrt(1 - r2);
        const th = Math.asin(Math.max(-1, Math.min(1, u / Math.sqrt(Math.max(1e-3, 1 - v * v)))));
        const s = th * ribs / Math.PI + (ribs % 2 ? 0 : 0.5);
        const fr = s - Math.round(s);
        const bulge = Math.cos(fr * Math.PI);
        const lit = -0.6 * u - 0.7 * v + 0.45 * nz;
        let t = 2.3 + lit * 2.8 + bulge * 1.0 - (r2 > 0.8 ? 0.9 : 0);
        if (Math.abs(fr) > 0.4 && Math.abs(u) < 0.94) t -= 1.4;
        const k = `${x},${y}`;
        if (cut.has(k)) {
          // vyřezaný otvor: horní okraj je tmavá tloušťka slupky, uvnitř svíčka
          const rim = !cut.has(`${x},${y - 1}`);
          const deep = cut.has(`${x},${y + 1}`) && cut.has(`${x - 1},${y}`) && cut.has(`${x + 1},${y}`);
          // ve dne tmavý otvor se zábleskem svíčky, po setmění ho přebije maska (záře)
          P.set(x, y, rim ? 0x2e140e : deep ? 0xb8541a : 0x6e2a12);
          if (o.mask) o.mask.set(x, y, rim ? C.a[1] : deep ? C.a[4] : C.a[3]);
          continue;
        }
        P.set(x, y, pick(PUMP, t));
      }
    }

    // odlesk na nejlepším žebru
    if (!o.face) {
      P.set(Math.round(cx - rx * 0.45), Math.round(cy - ry * 0.45), C.a[3]);
      P.set(Math.round(cx - rx * 0.45), Math.round(cy - ry * 0.45) + 1, C.a[2]);
    }

    // stopka: zahnutá, světlá levá hrana
    const sx = Math.round(cx + (o.lean || 0));
    const sy = Math.round(cy - ry + 1);
    const sh = Math.max(2, Math.round(ry * 0.35));
    for (let i = 0; i < sh; i++) {
      const x = sx + (i === sh - 1 ? 1 : 0);
      P.set(x, sy - i, i ? C.g[2] : C.g[1]);
      P.set(x + 1, sy - i, C.g[1]);
      if (i === sh - 1) P.set(x + 2, sy - i, C.g[2]);
    }
    if (o.leaf) {
      P.set(sx - 1, sy, C.g[3]);
      P.set(sx - 2, sy, C.g[4]);
      P.set(sx - 3, sy + 1, C.g[3]);
      P.set(sx - 2, sy + 1, C.g[2]);
    }
  }

  // obličeje kreslené ručně po jemných bodech (# = vyřezaný otvor)
  const FACES = {
    smile: [
      "...#......#...",
      "..###....###..",
      ".#####..#####.",
      "......##......",
      "#............#",
      "###.######.###",
      ".############.",
      "..####..####.."
    ],
    evil: [
      "#............#",
      "###........###",
      ".####....####.",
      "..##......##..",
      "......##......",
      ".#..........#.",
      ".##.######.##.",
      "..##########..",
      "...##.##.##..."
    ],
    small: [
      ".#......#.",
      "###....###",
      "..........",
      "#.######.#",
      ".########.",
      "..#.##.#.."
    ]
  };

  function carve(cx, cy, rx, ry, face, out) {
    const rows = FACES[face];
    const x0 = Math.round(cx - rows[0].length / 2);
    const y0 = Math.round(cy - rows.length / 2 + 0.5);
    rows.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === "#") out.add(`${x0 + i},${y0 + j}`); }));
  }

  /* ---------- sprity ---------- */
  const D = PK.props.doodads;

  function sprite(name, w, h, ax, ay, fn, extra = {}) {
    const P = mk(w, h);
    const mask = new Pix(P.w, P.h);
    fn(P, mask);
    P.outline(C.ink, 0.74);
    let has = false;
    for (let i = 0; i < mask.d.length && !has; i++) if (mask.d[i] >>> 24) has = true;
    D[name] = { c: PK.fine(P), w, h, ax, ay, face: has ? PK.fine(mask) : null, ...extra };
  }

  const tuft = (P, x, y, n, seed) => {
    for (let i = 0; i < n; i++) {
      const gx = x + Math.round((hash(i, 1, seed) - 0.5) * n * 2.6);
      const len = 2 + Math.floor(hash(i, 2, seed) * 3);
      for (let k = 0; k < len; k++) P.set(gx + (k === len - 1 ? (hash(i, 3, seed) > 0.5 ? 1 : -1) : 0), y - k, k === len - 1 ? C.g[5] : k ? C.g[4] : C.g[2]);
    }
  };

  sprite("pumpkin", 10, 8, 5, 7, P => {
    pumpkin(P, 10, 14, 8.5, 6, { leaf: true, lean: 0 });
    tuft(P, 3, 15, 2, 4);
  });

  sprite("pumpkins", 18, 11, 9, 10, P => {
    pumpkin(P, 21, 15, 9, 6.5, { ribs: 5, lean: 1 });
    pumpkin(P, 10, 20, 7, 5, { ribs: 4, leaf: true });
    pumpkin(P, 27, 21, 5.5, 4, { ribs: 3, lean: -1 });
    tuft(P, 18, 21, 3, 7);
  });

  sprite("jackLantern", 12, 10, 6, 9, (P, M) => {
    pumpkin(P, 12, 18, 10, 7.5, { face: "smile", mask: M, lean: -1 });
    tuft(P, 3, 19, 2, 11);
  }, { glow: { x: 6, y: 4, r: 13, a: 0.4, color: C.a[1], flicker: true } });

  sprite("jackEvil", 12, 10, 6, 9, (P, M) => {
    pumpkin(P, 12, 18, 10, 7, { face: "evil", mask: M, lean: 1, ribs: 4 });
  }, { glow: { x: 6, y: 4, r: 12, a: 0.38, color: C.r[4], flicker: true } });

  /* Náhrobek: zaoblený kámen, světlo zleva, vytesaný kříž, mech u paty, hlína před ním. */
  function grave(P, seed, shape) {
    const x0 = 3;
    const x1 = 14;
    const top = 3;
    const base = 20;
    const lean = (hash(seed, 1, 9) - 0.5) * 0.12;
    const inside = (x, y) => {
      const sx = x - lean * (base - y);
      if (shape === "cross") {
        const arm = y >= 6 && y <= 9;
        return y >= top && y <= base && (arm ? sx >= x0 - 1 && sx <= x1 + 1 : sx >= 6 && sx <= 11);
      }
      if (sx < x0 || sx > x1 || y > base) return false;
      const r = (x1 - x0 + 1) / 2;
      const cx = x0 + r - 0.5;
      if (y < top + r) return Math.hypot(sx - cx, (y - (top + r)) * 1.1) <= r;
      return true;
    };
    for (let y = 0; y <= base; y++) {
      for (let x = 0; x < 18; x++) {
        if (!inside(x, y)) continue;
        const sx = x - lean * (base - y);
        let t = 4.2 - (sx - x0) * 0.22 + (inside(x, y - 1) ? 0 : 1.2) - (inside(x - 1, y) ? 0 : -0.8);
        if (!inside(x + 1, y)) t -= 1.4;
        if (hash(x, y, seed) > 0.86) t -= 1;
        if (y > base - 3 && hash(x, y, seed + 3) > 0.45) { P.set(x, y, hash(x, y, seed + 5) > 0.5 ? C.g[2] : C.g[3]); continue; }
        P.set(x, y, pick(STONE, t));
      }
    }
    if (shape !== "cross") {
      // vytesaný kříž: tmavá rýha, světlá spodní hrana
      const cx = Math.round(8.5 + lean * 8);
      for (let y = 7; y <= 14; y++) { P.set(cx, y, STONE[1]); P.set(cx + 1, y, STONE[4]); }
      for (let x = cx - 2; x <= cx + 3; x++) { if (x === cx || x === cx + 1) continue; P.set(x, 9, STONE[1]); P.set(x, 10, STONE[4]); }
      // prasklina
      let x = 12;
      for (let y = 4; y < 10; y++) { x += hash(y, 2, seed) > 0.5 ? 0 : -1; P.set(x, y, STONE[1]); }
    }
    // hlína a tráva před kamenem
    P.disc(9, 22, 8, 2.2, (x, y) => (hash(x, y, seed + 7) > 0.6 ? C.d[2] : y < 22 ? C.d[1] : C.d[0]));
    tuft(P, 3, 23, 2, seed);
    tuft(P, 15, 23, 2, seed + 1);
  }

  sprite("graveA", 9, 12, 5, 11, P => grave(P, 21, "round"));
  sprite("graveB", 9, 12, 5, 11, P => grave(P, 34, "cross"));

  /* Strašák: kůl s břevnem, roztrhaný kabát, sláma z rukávů, dýňová hlava s kloboukem. */
  sprite("scarecrow", 16, 26, 8, 25, (P, M) => {
    const wood = (x, y, t) => P.set(x, y, pick([C.w[0], C.w[1], C.w[2], C.w[3], C.w[4]], t));
    for (let y = 16; y < 51; y++) { wood(15, y, 3.4); wood(16, y, 2.4); wood(17, y, 1.2); }
    for (let x = 2; x < 30; x++) { wood(x, 21, 3.6); wood(x, 22, 2.2); }
    // kabát: pruhy s rozedraným lemem a záplatou
    const coat = [0x3a2238, 0x55304a, 0x6e3e52, 0x8a5060];
    for (let y = 19; y < 38; y++) {
      const hw = 5 + (y - 19) * 0.22;
      for (let x = Math.round(16 - hw); x <= Math.round(16 + hw); x++) {
        if (y > 33 && hash(x, 1, 5) * 5 < y - 33) continue;
        const t = 2.4 - (x - 16) / hw * 1.1 + (y < 21 ? 0.6 : 0) - (Math.abs(x - 16) < 1 ? 0.8 : 0);
        P.set(x, y, pick(coat, t));
      }
    }
    for (let y = 26; y < 30; y++) for (let x = 18; x < 21; x++) P.set(x, y, (x + y) & 1 ? C.u[1] : C.u[0]);
    P.set(18, 26, C.a[1]); P.set(20, 29, C.a[1]);
    // rukávy podél břevna a sláma z nich
    for (let x = 4; x < 12; x++) { P.set(x, 20, coat[2]); P.set(x, 21, coat[1]); P.set(x, 22, coat[0]); }
    for (let x = 21; x < 29; x++) { P.set(x, 20, coat[2]); P.set(x, 21, coat[1]); P.set(x, 22, coat[0]); }
    for (const [x, y] of [[3, 20], [2, 21], [3, 22], [1, 23], [2, 19], [29, 20], [30, 21], [29, 22], [31, 23], [30, 19], [14, 38], [17, 39], [19, 38]]) P.set(x, y, hash(x, y, 2) > 0.4 ? C.a[2] : C.gold[0]);
    // hlava: malá vyřezaná dýně
    pumpkin(P, 16, 19, 7, 5.5, { face: "small", mask: M, ribs: 4 });
    // klobouk se špičkou ohnutou dozadu
    const hat = [C.b[0], C.b[1], C.b[2], C.b[3]];
    for (let x = 7; x <= 25; x++) { P.set(x, 9, hat[x < 12 ? 3 : 2]); P.set(x, 10, hat[1]); }
    for (let y = 1; y < 9; y++) {
      const hw = (9 - y) * 0.6 + 1;
      const c = 16 + (y < 4 ? (4 - y) : 0);
      for (let x = Math.round(c - hw); x <= Math.round(c + hw); x++) P.set(x, y, pick(hat, 3 - (x - c + hw) * 0.4));
    }
    P.set(20, 1, hat[2]); P.set(21, 2, hat[1]);
    P.rect(12, 8, 9, 1, 0x6e1f2c);
    // hlína u paty kůlu
    P.disc(16, 50, 5, 1.5, C.d[1]);
    tuft(P, 12, 51, 2, 3);
  }, { glow: { x: 8, y: 10, r: 10, a: 0.3, color: C.a[1], flicker: true } });

  /* ---------- rozmístění (volá world.js při stavbě mapy) ---------- */
  H.doodads = ({ add, layout, W, H: MH }) => {
    const R = PK.rng(W * 131 + MH * 7 + layout.resources.length);
    const area = W * MH / (480 * 240);
    const n = k => Math.max(1, Math.round(k * area));
    // ne za korunou stromu ani za budovou (zakryly by ji), art px
    const hidden = (x, y) => layout.resources.some(r => r.type === "wood" && Math.abs(x - r.x / 2) < 24 && y - (r.y / 2 + 15) > -52 && y - (r.y / 2 + 15) < 6) ||
      layout.buildings.some(b => Math.abs(x - b.x / 2) < 34 && y - (b.y / 2 + 19) > -56 && y - (b.y / 2 + 19) < 4);
    const put = (name, x, y, r) => !hidden(x, y) && add(name, x, y, false, r);
    // u hlavních budov svítí dvě dýně, ať je výzdoba vidět hned od startu
    for (const b of layout.buildings) {
      if (b.type !== "hall") continue;
      let k = 0;
      for (let i = 0; i < 24 && k < 2; i++) {
        const a = i * 2.4 + R() * 0.8;
        if (put(k ? "jackEvil" : "jackLantern", b.x / 2 + Math.cos(a) * 50, b.y / 2 + 14 + Math.sin(a) * 30, 7)) k++;
      }
    }
    const spread = (name, count, r) => {
      for (let i = 0, k = 0; i < count * 40 && k < count; i++) if (put(name, 14 + R() * (W - 28), 30 + R() * (MH - 42), r)) k++;
    };
    spread("jackLantern", n(3), 8);
    spread("jackEvil", n(2), 8);
    spread("pumpkin", n(5), 6);
    spread("pumpkins", n(3), 10);
    spread("graveA", n(2), 7);
    spread("graveB", n(2), 7);
    spread("scarecrow", n(1), 12);
  };

  /* ---------- netopýři ---------- */
  // body křídla vlevo od těla (pravé je zrcadlo kolem osy x = 0,5), 4 fáze mávnutí
  const WING = [
    [[-1, 0], [-2, -1], [-3, -2], [-4, -3], [-2, 0], [-3, -1], [-4, -2], [-5, -3]],
    [[-1, 0], [-2, 0], [-3, -1], [-4, -1], [-5, -1], [-2, 1], [-3, 0], [-4, 0]],
    [[-1, 0], [-2, 1], [-3, 1], [-4, 2], [-2, 0], [-3, 2], [-5, 2], [-4, 1]],
    [[-1, 0], [-2, 0], [-3, -1], [-4, -1], [-5, -1], [-2, 1], [-3, 0], [-4, 0]]
  ];
  const BODY = [[0, -1], [1, -1], [0, 0], [1, 0], [0, 1], [1, 1], [0, 2]];

  // f = velikost jemného bodu v souřadnicích plátna
  H.bat = (g, x, y, frame, f, eyes = true) => {
    const bx = Math.round(x / f) * f;
    const by = Math.round(y / f) * f;
    g.fillStyle = "#1e1828";
    for (const [dx, dy] of BODY) g.fillRect(bx + dx * f, by + dy * f, f, f);
    for (const [dx, dy] of WING[frame & 3]) {
      g.fillRect(bx + dx * f, by + dy * f, f, f);
      g.fillRect(bx + (1 - dx) * f, by + dy * f, f, f);
    }
    // uši a lem křídel o odstín světlejší, oči do ruda
    g.fillStyle = "#3a2c48";
    g.fillRect(bx, by - 2 * f, f, f);
    g.fillRect(bx + f, by - 2 * f, f, f);
    const tip = WING[frame & 3][3];
    g.fillRect(bx + tip[0] * f, by + tip[1] * f, f, f);
    g.fillRect(bx + (1 - tip[0]) * f, by + tip[1] * f, f, f);
    if (eyes) {
      g.fillStyle = "#ff8f4a";
      g.fillRect(bx, by - f, f, f);
      g.fillRect(bx + f, by - f, f, f);
    }
  };

  let bats = [];
  let batsFor = null;

  function makeBats(w) {
    bats = [];
    const area = w.W * w.H / (480 * 240);
    const flocks = Math.max(2, Math.round(3 * area));
    for (let i = 0; i < flocks; i++) {
      const ax = 30 + hash(i, 1, 77) * (w.W - 60);
      const ay = 40 + hash(i, 2, 77) * (w.H - 80);
      const k = 2 + Math.floor(hash(i, 3, 77) * 3);
      for (let j = 0; j < k; j++) {
        bats.push({ ax, ay, rx: 26 + hash(i, j, 5) * 40, ry: 12 + hash(i, j, 6) * 16, sp: 0.5 + hash(i, j, 7) * 0.5, ph: hash(i, j, 8) * 6.28, fl: 9 + hash(i, j, 9) * 4 });
      }
    }
  }

  H.bats = () => bats;

  /* Kreslí se po shaderech (game.js): záře vyřezaných obličejů a netopýři. */
  H.draw = (g, T, world, visible) => {
    if (!world || !world.ready) return;
    if (batsFor !== world.doodads) { batsFor = world.doodads; makeBats(world); }
    // čím tmavší noc, tím víc vyřezané obličeje září (bez shaderů jen jemně)
    const amb = PK.shaders && PK.shaders.active && PK.shaders.amb;
    const dark = amb ? Math.max(0, Math.min(1, (0.86 - (amb[0] + amb[1] + amb[2]) / 3) / 0.55)) : 0;
    for (const d of world.doodads) {
      const s = d.spr;
      if (!s.face || !visible(d.x, d.y)) continue;
      g.globalAlpha = (0.3 + 0.7 * dark) * (0.85 + 0.15 * Math.sin(T * 7.3 + d.ph * 5) * Math.sin(T * 3.1 + d.ph));
      g.drawImage(s.face, d.x - s.ax, d.y - s.ay);
    }
    g.globalAlpha = 1;
    const F = 1 / HD;
    for (const b of bats) {
      const a = T * b.sp + b.ph;
      const x = b.ax + Math.sin(a) * b.rx + Math.sin(a * 2.3) * 6;
      const y = b.ay + Math.sin(a * 1.7 + 1) * b.ry - 14;
      if (!visible(x, y)) continue;
      const glide = Math.sin(a * 0.9) > 0.6;
      H.bat(g, x, y, glide ? 1 : Math.floor(T * b.fl + b.ph * 3), F);
    }
  };

  /* Noc má během Halloweenu nádech do fialova (shaders.js). */
  H.tint = amb => {
    const dark = Math.max(0, Math.min(1, (0.8 - (amb[0] + amb[1] + amb[2]) / 3) / 0.6));
    return [amb[0] * (1 + 0.1 * dark), amb[1] * (1 - 0.06 * dark), amb[2] * (1 + 0.08 * dark)];
  };
})();
