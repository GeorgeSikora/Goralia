/*
 * Jednotky. Každé políčko animace se kreslí procedurálně v jemné mřížce:
 * buňka 64x64 jemných px (= 32x32 art px), chodidla v (32, 60) jemných px
 * (= kotva AX, AY v art px), postava hledí doprava. Zrcadlené snímky se
 * pečou jednou. Ven jdou plátna přes PK.fine (art rozměr + jemné dvojče).
 *
 * Každý tvar (končetina, trup, hlava, plášť) se nejdřív vyplní do masky a
 * pak se vybarví jednotně: světlá hrana nahoře a vlevo, jádro, stinná
 * strana vpravo dole, a tam, kde překrývá dřívější tvar, dostane podklad
 * 1px okluzní linku. Detaily (oči, švy, záhyby, přezky) se kreslí ručně.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const { C, TEAM, Pix, mix } = PK;
  const HD = PK.HD;

  const CELL = 32;
  const AX = 16;
  const AY = 30;

  const W = CELL * HD;
  const OX = AX * HD;
  const OY = AY * HD;

  /* ---------- rampy: [světlo, jádro, stín, hluboký stín] ---------- */
  const ramp = (a, b, c, d) => [a, b, mix(c, C.dusk, 0.12), mix(d, C.shade, 0.2)];
  const S = C.s;
  const R = {
    steel: ramp(S[5], S[4], S[3], S[2]),
    steelD: ramp(S[4], S[3], S[2], S[1]),
    iron: ramp(C.b[4], C.b[3], C.b[2], C.b[1]),
    basalt: ramp(C.b[3], C.b[2], C.b[1], C.b[0]),
    skin: ramp(mix(C.skin[0], C.a[4], 0.45), C.skin[0], C.skin[1], C.skin[2]),
    leather: ramp(C.w[3], C.w[2], C.w[1], C.w[0]),
    leatherL: ramp(C.w[4], C.w[3], C.w[2], C.w[1]),
    cloth: ramp(C.d[3], C.d[2], C.d[1], C.d[0]),
    clothD: ramp(C.d[2], C.d[1], C.d[0], C.w[0]),
    straw: ramp(C.d[5], C.d[4], C.d[3], C.d[2]),
    gold: ramp(C.gold[2], C.gold[1], C.gold[0], mix(C.gold[0], C.w[0], 0.5)),
    bone: ramp(mix(C.bone[0], C.white, 0.45), C.bone[0], C.bone[1], C.bone[2]),
    teal: ramp(C.t[4], C.t[3], C.t[2], C.t[1]),
    tealD: ramp(C.t[3], C.t[2], C.t[1], C.t[0]),
    violet: ramp(0x8a6cc8, 0x5f4498, 0x40306e, 0x2a2150),
    violetD: ramp(0x5f4498, 0x40306e, 0x2e2456, 0x1f1838),
    ash: ramp(C.h[5], C.h[4], C.h[3], C.h[2]),
    silver: ramp(S[6], S[5], S[4], S[3]),
    rot: ramp(0xa3b59a, 0x7f9479, 0x5a6c58, 0x3c4a40),
    rotD: ramp(0x7f9479, 0x5a6c58, 0x3c4a40, 0x232b26),
    flesh: ramp(0xb2c4a0, 0x8aa07a, 0x667a5a, 0x46553f),
    fleshD: ramp(0x8aa07a, 0x667a5a, 0x46553f, 0x2d3529),
    mist: ramp(0xe8fbfb, 0xb4e4ea, 0x76b8c8, 0x3f7f94),
    mistD: ramp(0xb4e4ea, 0x76b8c8, 0x3f7f94, 0x23465a),
    robe: ramp(C.b[3], C.b[2], C.b[1], C.b[0]),
    ember: ramp(C.r[5], C.r[4], C.r[3], C.r[2])
  };
  const teamR = T => ramp(T.l, T.m, T.s, T.d);
  const teamRD = T => ramp(T.m, T.s, T.d, mix(T.d, C.ink, 0.3));
  const EYE = mix(C.ink, C.u[0], 0.35);

  /* ---------- maska tvaru (souřadnice v jemných px od kotvy) ---------- */
  class Mask {
    constructor() {
      this.d = new Uint8Array(W * W);
      this.x0 = W; this.y0 = W; this.x1 = -1; this.y1 = -1;
    }

    on(x, y) {
      x = Math.floor(x) + OX;
      y = Math.floor(y) + OY;
      if (x < 0 || y < 0 || x >= W || y >= W) return;
      this.d[y * W + x] = 1;
      if (x < this.x0) this.x0 = x;
      if (y < this.y0) this.y0 = y;
      if (x > this.x1) this.x1 = x;
      if (y > this.y1) this.y1 = y;
    }

    off(x, y) {
      x = Math.floor(x) + OX;
      y = Math.floor(y) + OY;
      if (x < 0 || y < 0 || x >= W || y >= W) return;
      this.d[y * W + x] = 0;
    }

    at(ax, ay) {
      return ax >= 0 && ay >= 0 && ax < W && ay < W && this.d[ay * W + ax] === 1;
    }

    has(x, y) {
      return this.at(Math.floor(x) + OX, Math.floor(y) + OY);
    }

    /* kapsle se zužujícím se poloměrem: končetiny, násady */
    cap(x0, y0, x1, y1, r0, r1 = r0) {
      const r = Math.max(r0, r1) + 1;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const l2 = dx * dx + dy * dy || 1e-6;

      for (let y = Math.floor(Math.min(y0, y1) - r); y <= Math.ceil(Math.max(y0, y1) + r); y++) {
        for (let x = Math.floor(Math.min(x0, x1) - r); x <= Math.ceil(Math.max(x0, x1) + r); x++) {
          const px = x + 0.5 - x0;
          const py = y + 0.5 - y0;
          const t = Math.max(0, Math.min(1, (px * dx + py * dy) / l2));
          const ex = px - dx * t;
          const ey = py - dy * t;
          const rr = r0 + (r1 - r0) * t;
          if (ex * ex + ey * ey <= rr * rr) this.on(x, y);
        }
      }
      return this;
    }

    ell(cx, cy, rx, ry, cut) {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          const nx = (x + 0.5 - cx) / rx;
          const ny = (y + 0.5 - cy) / ry;
          if (nx * nx + ny * ny <= 1 && (!cut || cut(x, y))) this.on(x, y);
        }
      }
      return this;
    }

    rect(x, y, w, h) {
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) this.on(x + xx, y + yy);
      return this;
    }

    poly(pts) {
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
      const n = pts.length;

      for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
        const yc = y + 0.5;
        const xs = [];
        for (let i = 0; i < n; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % n];
          if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) {
            xs.push(a[0] + (yc - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
          }
        }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          for (let x = Math.ceil(xs[k] - 0.5); x <= Math.floor(xs[k + 1] - 0.5); x++) this.on(x, y);
        }
      }
      return this;
    }

    /* ořízne masku funkcí keep(x, y) */
    keep(fn) {
      for (let y = this.y0; y <= this.y1; y++) {
        for (let x = this.x0; x <= this.x1; x++) {
          if (this.d[y * W + x] && !fn(x - OX, y - OY)) this.d[y * W + x] = 0;
        }
      }
      return this;
    }
  }

  /*
   * Vybarví masku rampou. o.dir: "h" (válec svisle), "v" (shora dolů),
   * jinak úhlopříčně od levého horního rohu. o.occ: síla okluzní linky na
   * podkladu. o.tex(x, y, tone, colour) může barvu upravit (textura).
   */
  function paint(P, m, rp, o = {}) {
    if (m.x1 < 0) return;
    const occ = o.occ == null ? 0.42 : o.occ;
    const { x0, y0, x1, y1 } = m;

    if (occ > 0) {
      const hits = [];
      for (let y = y0 - 1; y <= y1 + 1; y++) {
        for (let x = x0 - 1; x <= x1 + 1; x++) {
          if (m.at(x, y) || !P.alpha(x, y)) continue;
          if (m.at(x + 1, y) || m.at(x - 1, y) || m.at(x, y + 1) || m.at(x, y - 1)) hits.push(x, y);
        }
      }
      for (let i = 0; i < hits.length; i += 2) {
        const c = P.get(hits[i], hits[i + 1]);
        P.set(hits[i], hits[i + 1], mix(c, C.ink, occ));
      }
    }

    const rmin = [];
    const rmax = [];
    const cmin = [];
    const cmax = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!m.d[y * W + x]) continue;
        if (rmin[y] == null || x < rmin[y]) rmin[y] = x;
        if (rmax[y] == null || x > rmax[y]) rmax[y] = x;
        if (cmin[x] == null || y < cmin[x]) cmin[x] = y;
        if (cmax[x] == null || y > cmax[x]) cmax[x] = y;
      }
    }

    const split = o.split == null ? 0.56 : o.split;
    const rim = o.rim !== false;

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!m.d[y * W + x]) continue;
        const rw = rmax[y] - rmin[y];
        const cw = cmax[x] - cmin[x];
        const u = rw > 0 ? (x - rmin[y]) / rw : 0.5;
        const v = cw > 0 ? (y - cmin[x]) / cw : 0.5;
        const l = o.dir === "h" ? u : o.dir === "v" ? v : u * 0.58 + v * 0.42;
        const eT = !m.at(x, y - 1);
        const eL = !m.at(x - 1, y);
        const eR = !m.at(x + 1, y);
        const eB = !m.at(x, y + 1);

        let t = l < split ? 1 : 2;
        if (rim && (eT || eL) && !eB && l < 0.62) t = 0;
        else if (rim && (eR || eB) && l > 0.5) t = 3;
        else if (l > 0.86) t = 3;

        let c = rp[t];
        if (o.tex) c = o.tex(x - OX, y - OY, t, c);
        if (c != null && c >= 0) P.set(x, y, c);
      }
    }
  }

  /* dvoukloubová IK: dir +1 ohyb dopředu (koleno), -1 dozadu (loket) */
  function ik(ax, ay, bx, by, l1, l2, dir) {
    let dx = bx - ax;
    let dy = by - ay;
    let d = Math.hypot(dx, dy) || 1e-6;
    const maxd = l1 + l2 - 0.05;
    if (d > maxd) {
      bx = ax + dx / d * maxd;
      by = ay + dy / d * maxd;
      dx = bx - ax;
      dy = by - ay;
      d = maxd;
    }
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const mx = ax + dx * a / d;
    const my = ay + dy * a / d;
    return [mx + (dy / d) * h * dir, my - (dx / d) * h * dir, bx, by];
  }

  /* ---------- kit pro kreslení jednoho snímku ---------- */
  function kit(P, team, pose) {
    const set = (x, y, c) => P.set(Math.round(x) + OX, Math.round(y) + OY, c);
    const k = {
      P,
      T: TEAM[team] || TEAM.blue,
      pose,
      meta: {},
      px: set,
      get: (x, y) => P.get(Math.round(x) + OX, Math.round(y) + OY),
      R: (x, y, w, h, c) => P.rect(Math.round(x) + OX, Math.round(y) + OY, w, h, c),
      L: (x0, y0, x1, y1, c) => P.line(Math.round(x0) + OX, Math.round(y0) + OY, Math.round(x1) + OX, Math.round(y1) + OY, c),
      mask: () => new Mask(),
      paint: (m, rp, o) => paint(P, m, rp, o),
      /* tmavší odstín toho, co už je pod bodem (záhyby, švy) */
      dark(x, y, t = 0.35, to = C.shade) {
        const c = k.get(x, y);
        if (c >= 0) set(x, y, mix(c, to, t));
      },
      lite(x, y, t = 0.35, to = C.a[4]) {
        const c = k.get(x, y);
        if (c >= 0) set(x, y, mix(c, to, t));
      },
      /* rozlomený prsten (znak říše), r = poloměr v jemných px */
      ring(cx, cy, r, c, gap = true) {
        for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
          for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
            const dx = x + 0.5 - cx;
            const dy = y + 0.5 - cy;
            const d = Math.hypot(dx, dy);
            if (Math.abs(d - r) > 0.55) continue;
            const a = Math.atan2(dy, dx);
            if (gap && a > -1.35 && a < -0.45) continue;
            set(x, y, c);
          }
        }
      }
    };
    return k;
  }

  /* ---------- sdílené části těla ---------- */
  const lineTo = (k, pts, c) => {
    for (let i = 0; i + 1 < pts.length; i++) k.L(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], c);
  };

  /* noha: kyčel -> koleno (IK) -> kotník, bota s podrážkou */
  function leg(k, hx, hy, fx, lift, o) {
    const bh = o.bootH || 5;
    const ay = -bh + 1 - lift;
    const L = o.len || 5.4;
    const [kx, ky, ax, ayy] = ik(hx, hy, fx + 0.5, ay, L, L, 1);
    const m = k.mask().cap(hx, hy, kx, ky, o.r0 || 2.3, o.r1 || 1.9).cap(kx, ky, ax, ayy, o.r1 || 1.9, o.r2 || 1.7);
    k.paint(m, o.ramp, { dir: "h", occ: o.occ });
    if (o.knee) k.px(kx + 0.5, ky - 0.5, o.knee);

    const bx = Math.round(ax - 0.5);
    const by = Math.round(ayy) - 1;
    const sole = -lift;
    const b = k.mask();
    if (o.bare) {
      b.rect(bx - 1, sole - 2, 4, 2).rect(bx + 2, sole - 1, 2, 1);
    } else {
      b.rect(bx - 2, by, 5, sole - by).rect(bx + 3, sole - 3, 2, 3);
      b.on(bx + 5, sole - 1);
    }
    k.paint(b, o.boot, { dir: "v", occ: 0.3 });
    if (!o.bare) {
      k.R(bx - 2, sole - 1, 7, 1, o.boot[3]);
      if (o.cuff) k.R(bx - 2, by, 5, 1, o.cuff);
    }
    return [kx, ky];
  }

  /* paže: rameno -> loket (IK, ohyb dozadu) -> ruka */
  function arm(k, sx, sy, hx, hy, o) {
    const L = o.len || 5.6;
    const [ex, ey, rx, ry] = ik(sx, sy, hx, hy, L, L, o.bend || -1);
    const m = k.mask().cap(sx, sy, ex, ey, o.r0 || 2.1, o.r1 || 1.7).cap(ex, ey, rx, ry, o.r1 || 1.7, o.r2 || 1.4);
    k.paint(m, o.ramp, { occ: o.occ });
    if (o.cuff) {
      const t = 0.72;
      const cx = ex + (rx - ex) * t;
      const cy = ey + (ry - ey) * t;
      k.paint(k.mask().ell(cx, cy, 1.8, 1.8), o.cuff, { occ: 0.2 });
    }
    if (o.hand !== false) k.paint(k.mask().ell(rx, ry, 1.7, 1.7), o.hand || R.skin, { occ: 0.3 });
    return [rx, ry, ex, ey];
  }

  /* oko z profilu: 2 px vysoké, obočí nad ním */
  function eye(k, x, y, brow) {
    k.px(x, y, EYE);
    k.px(x, y + 1, EYE);
    if (brow) k.L(x - 1, y - 2, x + 1, y - 2, brow);
  }

  /* štěrbinové žhavé oko (nepřítel) */
  function emberEye(k, x, y) {
    k.px(x - 1, y, C.r[3]);
    k.px(x, y, C.r[4]);
    k.px(x + 1, y, C.r[5]);
    k.px(x, y - 1, mix(C.r[2], C.ink, 0.3));
  }

  /* omezí cíl ruky na dosah paže */
  function reach(sx, sy, hx, hy, L) {
    const d = Math.hypot(hx - sx, hy - sy);
    return d <= L ? [hx, hy] : [sx + (hx - sx) / d * L, sy + (hy - sy) / d * L];
  }

  /* stopa máchnutí: srpek, který k čepeli houstne (t = 1 u zbraně) */
  function smear(k, cx, cy, r, a0, a1, hi, lo, thin) {
    const n = Math.ceil(Math.abs(a1 - a0) * r * 1.6);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const a = a0 + (a1 - a0) * t;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      if (t < 0.35 && i % 2) continue;
      k.px(cx + ca * r, cy + sa * r, t > 0.6 ? hi : lo);
      if (thin) continue;
      if (t > 0.45) k.px(cx + ca * (r - 1), cy + sa * (r - 1), lo);
      if (t > 0.78) k.px(cx + ca * (r - 2), cy + sa * (r - 2), mix(lo, hi, 0.4));
    }
  }

  /* čepel podél směru ang od bodu (hx, hy): hrana světlá, hřbet tmavší */
  function blade(k, hx, hy, ang, len, o = {}) {
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    let nx = -dy;
    let ny = dx;
    if (ny > 0 || (ny === 0 && nx > 0)) { nx = -nx; ny = -ny; }
    const w = o.w || 1;
    for (let i = 0; i <= len; i++) {
      const x = hx + dx * i;
      const y = hy + dy * i;
      const taper = o.taper && i > len - 3 ? 0 : 1;
      k.px(x, y, i > len - 2 ? S[5] : S[4]);
      if (taper) k.px(x + nx, y + ny, S[6]);
      if (w > 1 && taper) k.px(x - nx, y - ny, S[2]);
      if (w > 2 && i < len - 2) k.px(x - 2 * nx, y - 2 * ny, S[3]);
    }
    k.px(hx + dx * len, hy + dy * len, C.white);
    return [hx + dx * len, hy + dy * len];
  }

  /* ---------- pózy (jemné px) ----------
   * dy: posun těla dolů, lx: výpad dopředu, ff/fb: chodidlo přední/zadní
   * [x, zdvih], sw: fáze zbraně, swing: kmit paží, cape: vlání. */
  const STAND = { dy: 0, lx: 0, ff: [2, 0], fb: [-3, 0], swing: 0, sw: "idle", cape: 0, step: -1 };

  const WALK = [
    { ff: [6, 0], fb: [-6, 0], dy: 1, swing: 1 },
    { ff: [3, 0], fb: [-6, 3], dy: 0, swing: 0.5 },
    { ff: [0, 0], fb: [0, 4], dy: -1, swing: 0 },
    { ff: [-6, 0], fb: [6, 0], dy: 1, swing: -1 },
    { ff: [-6, 3], fb: [3, 0], dy: 0, swing: -0.5 },
    { ff: [0, 4], fb: [0, 0], dy: -1, swing: 0 }
  ];

  const POSES = {
    idle: [
      { ...STAND, cape: 0, i: 0 },
      { ...STAND, dy: 1, cape: 1, i: 1 }
    ],
    walk: WALK.map((w, i) => ({ ...STAND, ...w, cape: i % 2, step: i, i })),
    attack: [
      { ...STAND, lx: -2, sw: "back", ff: [1, 0], fb: [-5, 0], cape: 1, i: 0 },
      { ...STAND, lx: 3, sw: "strike", ff: [7, 0], fb: [-5, 0], dy: 1, cape: 0, i: 1 },
      { ...STAND, lx: 2, sw: "low", ff: [6, 0], fb: [-4, 0], dy: 2, cape: 1, i: 2 }
    ],
    cast: [
      { ...STAND, sw: "up", cape: 1, i: 0 },
      { ...STAND, sw: "flare", dy: -1, cape: 0, i: 1 },
      { ...STAND, sw: "fwd", lx: 2, ff: [5, 0], cape: 1, i: 2 }
    ]
  };

  /* ---------- mezisnímky ----------
   * Mezi každé dvě klíčové pózy chůze, útoku a kouzla se vkládá jedna
   * mezipóza: číselné hodnoty se prolnou, tabulky zbraní/rukou se čtou přes
   * posed() a prolnou také (úhel, úchop, délka). Rychlé mezisnímky (máchnutí)
   * dostanou rozmazání pohybu: dithered stopa předchozí pózy (blur). */
  const LERP = ["dy", "lx", "swing"];

  function between(a, b, blur = 0, t = 0.5) {
    const o = { ...a, sw2: b.sw, t, blur, from: a, to: b };
    const l = (x, y) => (x || 0) + ((y || 0) - (x || 0)) * t;
    for (const key of LERP) o[key] = key === "swing" ? l(a[key], b[key]) : Math.round(l(a[key], b[key]));
    o.ff = [Math.round(l(a.ff[0], b.ff[0])), Math.round(l(a.ff[1], b.ff[1]))];
    o.fb = [Math.round(l(a.fb[0], b.fb[0])), Math.round(l(a.fb[1], b.fb[1]))];
    return o;
  }

  /* Hodnota z tabulky póz (kotvy zbraní, rukou) s prolnutím mezipózy. */
  function posed(T, p, alias, fb) {
    const nm = s => (alias && alias[s]) || s;
    const get = s => T[nm(s)] || (fb !== undefined ? fb : T.idle);
    const A = get(p.sw);
    if (!p.sw2 || !p.t) return A;
    const B = get(p.sw2);
    if (!A || !B) return A || B;
    return A.map((v, i) => (typeof v === "number" && typeof B[i] === "number" ? v + (B[i] - v) * p.t : p.t < 0.5 ? v : B[i]));
  }

  const LICH_SW = { back: "up", strike: "flare", low: "fwd" };

  // walk: 6 klíčových + 6 mezipóz (smyčka), attack: nápřah, máchnutí s rozmazáním, dokmit
  const KEY_WALK = POSES.walk;
  POSES.walk = KEY_WALK.flatMap((w, i) => [w, { ...between(w, KEY_WALK[(i + 1) % KEY_WALK.length]), i: i + 0.5 }]);
  {
    const [back, strike, low] = POSES.attack;
    POSES.attack = [
      { ...between({ ...STAND, sw: "idle" }, back), i: -0.5 },
      back,
      { ...between(back, strike, 0.55), i: 0.5 },
      strike,
      { ...between(strike, low, 0.3), i: 1.5 },
      low
    ];
    const [up, flare, fwd] = POSES.cast;
    POSES.cast = [up, { ...between(up, flare, 0.25), i: 0.5 }, flare, { ...between(flare, fwd, 0.35), i: 1.5 }, fwd];
  }

  const casting = p => p.sw === "up" || p.sw === "flare" || p.sw === "fwd";

  /* ================= DĚLNÍK ================= */
  function drawWorker(k) {
    const { T, pose: p } = k;
    const dy = p.dy;
    const lx = p.lx;
    const hipY = -11 + dy;
    const sh = -22 + dy;
    const bob = p.step >= 0 ? (p.step % 3 === 0 ? 1 : 0) : 0;

    // krumpáč: úchop, úhel (od úchopu k hlavě), délka násady, za tělem?
    const PICK = {
      idle: [lx + 7, -14 + dy, -2.55, 15, true],
      back: [lx + 2, -26 + dy, -2.45, 15, true],
      strike: [lx + 11, -16 + dy, 0.3, 14, false],
      low: [lx + 11, -12 + dy, 0.75, 11, false]
    };
    const [gx, gy0, ga, glen, behind] = posed(PICK, p);
    const gy = gy0 + bob;
    const pdx = Math.cos(ga);
    const pdy = Math.sin(ga);

    const pickaxe = () => {
      const butt = [gx - pdx * 3, gy - pdy * 3];
      const top = [gx + pdx * glen, gy + pdy * glen];
      k.L(butt[0], butt[1], top[0], top[1], C.w[3]);
      k.L(butt[0] + 1, butt[1], top[0] + 1, top[1], C.w[1]);
      k.px(top[0], top[1], C.w[2]);
      // hlava kolmo k násadě, hroty zahnuté zpět k násadě
      const nx = -pdy;
      const ny = pdx;
      const c0 = [top[0] + pdx, top[1] + pdy];
      const pa = [c0[0] + nx * 7 - pdx * 2.5, c0[1] + ny * 7 - pdy * 2.5];
      const pb = [c0[0] - nx * 6 - pdx * 2, c0[1] - ny * 6 - pdy * 2];
      const head = k.mask().cap(c0[0], c0[1], pa[0], pa[1], 1.5, 0.6).cap(c0[0], c0[1], pb[0], pb[1], 1.5, 0.7);
      k.paint(head, R.steel, { occ: 0.35 });
      k.px(c0[0], c0[1], C.w[1]);
      k.px(pa[0], pa[1], C.white);
      k.px(pb[0], pb[1], S[5]);
    };

    if (behind) pickaxe();

    // zadní paže: při práci drží násadu, jinak se kývá
    const bh = behind
      ? [lx - 2 - (p.swing || 0) * 3, hipY + 1]
      : [gx + pdx * 5 - 1, gy + pdy * 5];
    arm(k, lx - 1, sh + 1, ...reach(lx - 1, sh + 1, bh[0], bh[1], 10.3), { ramp: R.clothD, r0: 1.9, r1: 1.6, hand: R.skin, len: 5.2 });

    leg(k, lx - 2, hipY, lx + p.fb[0], p.fb[1], { ramp: R.clothD, boot: R.leather, bootH: 4, len: 5 });
    leg(k, lx + 2, hipY, lx + p.ff[0], p.ff[1], { ramp: R.cloth, boot: R.leather, bootH: 4, len: 5 });

    // tunika
    const torso = k.mask().poly([
      [lx - 5, sh - 1], [lx + 4, sh - 1], [lx + 6, sh + 4], [lx + 6, hipY + 2], [lx - 6, hipY + 2], [lx - 6, sh + 3]
    ]);
    k.paint(torso, R.cloth);
    k.L(lx - 3, sh + 4, lx - 4, hipY + 1, R.cloth[2]);
    // zástěra v barvě týmu
    const apron = k.mask().poly([[lx, sh + 3], [lx + 5, sh + 3], [lx + 6, hipY + 4], [lx - 1, hipY + 4]]);
    k.paint(apron, teamR(T), { dir: "h", occ: 0.3 });
    k.L(lx + 3, sh + 5, lx + 3, hipY - 2, T.s);
    k.L(lx + 1, hipY + 1, lx + 1, hipY + 3, T.s);
    // opasek
    k.R(lx - 6, hipY - 1, 12, 2, C.w[1]);
    k.R(lx - 6, hipY - 1, 12, 1, C.w[2]);
    k.R(lx + 1, hipY - 1, 2, 2, C.gold[1]);
    k.px(lx + 1, hipY - 1, C.gold[2]);
    // lucerna na opasku vzadu
    const lp = [lx - 9, hipY - 1];
    k.L(lp[0] + 2, lp[1] - 1, lp[0] + 3, lp[1] - 1, C.w[1]);
    const lan = k.mask().rect(lp[0], lp[1], 4, 5);
    k.paint(lan, R.gold, { occ: 0.3 });
    k.R(lp[0] + 1, lp[1] + 1, 2, 3, C.a[2]);
    k.px(lp[0] + 1, lp[1] + 1, C.a[4]);
    k.px(lp[0] + 2, lp[1] + 3, C.a[1]);
    k.R(lp[0] + 1, lp[1] - 1, 2, 1, C.gold[0]);

    // šátek
    const scarf = k.mask().ell(lx, sh, 5, 1.8).cap(lx - 4, sh, lx - 7, sh + 4 + p.cape, 1.1, 0.9);
    k.paint(scarf, teamR(T), { occ: 0.3 });

    // hlava
    const hx = lx + 1;
    const hy = sh - 6;
    k.paint(k.mask().ell(hx, hy, 4.6, 5), R.skin, { occ: 0.3 });
    k.paint(k.mask().ell(hx - 3, hy + 1, 1.4, 1.8), R.skin, { occ: 0.35 });
    k.px(hx - 3, hy + 1, C.skin[2]);
    eye(k, hx + 2, hy, C.w[1]);
    k.px(hx + 5, hy + 1, C.skin[1]);
    k.px(hx + 3, hy + 3, C.skin[2]);
    k.px(hx + 4, hy + 3, C.skin[1]);
    // strniště
    for (const [x, y] of [[0, 3], [1, 4], [2, 4], [-1, 3]]) k.dark(hx + x, hy + y, 0.25);

    // slaměný klobouk: krempa + kužel + týmová páska
    const brim = k.mask().ell(hx - 0.5, hy - 3.5, 10, 2.2);
    k.paint(brim, R.straw, {
      dir: "v",
      tex: (x, y, t, c) => ((x * 3 + y * 5) % 4 === 0 && t < 2 ? R.straw[2] : c)
    });
    const cone = k.mask().poly([[hx - 6, hy - 4], [hx + 5, hy - 4], [hx + 1.5, hy - 12], [hx - 1.5, hy - 12]]);
    k.paint(cone, R.straw, {
      occ: 0.3,
      tex: (x, y, t, c) => (y % 2 === 0 && t === 1 && (x + y) % 3 === 0 ? R.straw[2] : c)
    });
    k.R(hx - 5, hy - 6, 10, 1, T.m);
    k.R(hx - 5, hy - 6, 3, 1, T.l);
    k.px(hx + 4, hy - 6, T.s);
    k.px(hx, hy - 12, C.d[5]);

    if (!behind) {
      pickaxe();
      if (p.sw === "strike") smear(k, lx + 4, -16 + dy, 18, -2.2, -0.35, S[5], S[3]);
    }

    // přední paže drží násadu
    arm(k, lx + 2, sh + 1, gx, gy, { ramp: R.cloth, r0: 2, r1: 1.7, cuff: R.leather });

    k.meta.head = [hx / HD, hy / HD];
  }

  /* ================= VOJÁK ================= */
  function drawSoldier(k) {
    const { T, pose: p } = k;
    const dy = p.dy;
    const lx = p.lx;
    const hipY = -12 + dy;
    const sh = -25 + dy;

    // chochol helmy vlaje dozadu (kreslí se první, za hlavou)
    const hx = lx + 1;
    const hy = sh - 6;

    leg(k, lx - 2, hipY, lx + p.fb[0], p.fb[1], { ramp: R.steelD, boot: R.leather, bootH: 6, cuff: C.w[3] });
    leg(k, lx + 2, hipY, lx + p.ff[0], p.ff[1], { ramp: R.steel, boot: R.leather, bootH: 6, knee: S[6], cuff: C.w[3] });

    // kroužková košile
    const torso = k.mask().poly([
      [lx - 6, sh], [lx + 5, sh], [lx + 7, sh + 4], [lx + 6, hipY + 1], [lx - 6, hipY + 1], [lx - 7, sh + 3]
    ]);
    k.paint(torso, R.steelD, { tex: (x, y, t, c) => (y % 2 === 0 ? mix(c, C.shade, 0.25) : (x + (y >> 1)) % 2 ? c : mix(c, S[5], 0.2)) });
    // tabard v barvě týmu
    const tab = k.mask().poly([[lx - 4, sh + 2], [lx + 5, sh + 2], [lx + 6, hipY + 5], [lx - 5, hipY + 5]]);
    k.paint(tab, teamR(T), { dir: "h", occ: 0.3 });
    k.L(lx, hipY + 2, lx, hipY + 5, T.d);
    k.L(lx + 3, hipY + 2, lx + 4, hipY + 5, T.s);
    // opasek
    k.R(lx - 6, hipY - 1, 13, 2, C.w[1]);
    k.R(lx - 6, hipY - 1, 13, 1, C.w[2]);
    k.R(lx + 2, hipY - 1, 2, 2, C.gold[1]);
    k.px(lx + 2, hipY - 1, C.gold[2]);

    // hlava v přilbě
    k.paint(k.mask().ell(hx, hy + 0.5, 4.4, 4.8), R.skin, { occ: 0.3 });
    eye(k, hx + 2, hy, null);
    k.px(hx + 5, hy + 1, C.skin[1]);
    k.L(hx + 2, hy + 3, hx + 3, hy + 3, C.skin[2]);
    const helm = k.mask().ell(hx - 0.5, hy - 2, 5.6, 5.2, (x, y) => y < hy - 1 || x < hx);
    helm.rect(hx - 6, hy - 2, 4, 6);
    k.paint(helm, R.steel, { occ: 0.3 });
    k.R(hx - 5, hy - 2, 11, 1, S[2]);
    k.R(hx - 5, hy - 3, 11, 1, S[5]);
    k.L(hx + 4, hy - 2, hx + 4, hy + 2, S[3]);
    k.px(hx - 2, hy - 6, S[6]);
    k.px(hx - 3, hy - 5, C.white);
    for (const y of [0, 2]) k.px(hx - 4, hy + y, S[2]);
    // chochol
    const fl = p.cape;
    const plume = k.mask()
      .cap(hx - 1, hy - 7, hx + 2, hy - 9, 1.6, 1.4)
      .cap(hx - 1, hy - 7, hx - 6, hy - 6 + fl, 1.8, 1.2)
      .cap(hx - 6, hy - 6 + fl, hx - 9, hy - 2 + fl, 1.2, 0.8);
    k.paint(plume, teamR(T), { occ: 0.3 });
    k.L(hx + 1, hy - 9, hx - 5, hy - 7 + fl, T.h);

    // štít na vzdálené paži, přes trup
    const sx = lx - 2 + (p.sw === "back" ? -1 : 0) + (p.swing || 0) * -0.5;
    const sy = sh + 9;
    const shield = k.mask().ell(sx, sy, 7.5, 8.5);
    k.paint(shield, teamR(T), {
      occ: 0.45,
      tex: (x, y, t, c) => {
        const d = Math.hypot((x + 0.5 - sx) / 7.5, (y + 0.5 - sy) / 8.5);
        if (d > 0.8) return (x - sx) + (y - sy) < -3 ? S[5] : (x - sx) + (y - sy) > 4 ? S[2] : S[3];
        return c;
      }
    });
    k.ring(sx, sy, 3.6, T.accent);
    k.ring(sx + 0.5, sy + 0.5, 3.6, mix(T.accent, C.ink, 0.6));
    k.ring(sx, sy, 3.6, T.accent);
    k.px(sx, sy, C.gold[1]);
    k.px(sx - 1, sy - 1, C.gold[2]);
    for (const [ox, oy] of [[-5, -5], [5, -5], [-6, 2], [5, 5]]) k.px(sx + ox, sy + oy, S[5]);

    // meč v přední ruce
    const SW = {
      idle: [lx + 8, sh + 10, -1.25],
      back: [lx + 3, sh - 3, -2.0],
      strike: [lx + 11, sh + 8, -0.05],
      low: [lx + 10, sh + 12, 0.75]
    };
    const [gx, gy0, ga] = posed(SW, p);
    const gy = gy0 + (p.step >= 0 ? (p.step % 3 === 1 ? 1 : 0) : 0);
    // čepel
    const tip = blade(k, gx + Math.cos(ga) * 2, gy + Math.sin(ga) * 2, ga, 14, { w: 2, taper: true });
    // záštita a hlavice
    const nx = -Math.sin(ga);
    const ny = Math.cos(ga);
    k.L(gx + Math.cos(ga) * 2 + nx * 2.5, gy + Math.sin(ga) * 2 + ny * 2.5, gx + Math.cos(ga) * 2 - nx * 2.5, gy + Math.sin(ga) * 2 - ny * 2.5, C.gold[1]);
    k.px(gx - Math.cos(ga) * 2, gy - Math.sin(ga) * 2, C.gold[2]);
    if (p.sw === "strike") smear(k, lx + 2, gy + 1, 18, -2.0, -0.2, S[6], mix(S[4], T.l, 0.35));
    void tip;

    // nárameník a paže
    arm(k, lx + 2, sh + 2, gx, gy, { ramp: R.steelD, r0: 2, r1: 1.7, hand: R.leather, cuff: R.leather });
    const pa = k.mask().ell(lx + 2, sh + 1.5, 4, 3, (x, y) => y < sh + 4);
    k.paint(pa, R.steel, { occ: 0.4 });
    k.R(lx - 1, sh + 3, 6, 1, S[2]);
    k.px(lx + 1, sh - 1, C.white);

    k.meta.head = [hx / HD, hy / HD];
  }

  /* ================= LUČIŠTNÍK ================= */
  function drawArcher(k) {
    const { T, pose: p } = k;
    const dy = p.dy;
    const lx = p.lx;
    const hipY = -13 + dy;
    const sh = -25 + dy;
    const draw = p.sw === "back";
    const loose = p.sw === "strike";
    const fl = p.cape;

    // plášť za zády
    const cloak = k.mask().poly([
      [lx - 3, sh], [lx + 1, sh], [lx - 4, hipY + 6], [lx - 9 - fl, hipY + 4 + fl], [lx - 8, sh + 6]
    ]);
    k.paint(cloak, R.violetD, { dir: "h" });
    k.L(lx - 9 - fl, hipY + 4 + fl, lx - 5, hipY + 6, T.s);

    // toulec se šípy (letky v barvě týmu)
    const qx = lx - 5;
    const qy = sh - 2;
    for (let i = 0; i < 3; i++) {
      const ax = qx - 1 + i * 2;
      k.L(ax, qy - 2, ax + 1, qy + 2, C.w[4]);
      k.px(ax, qy - 4, i === 1 ? T.h : T.l);
      k.px(ax, qy - 3, T.m);
      k.px(ax - 1, qy - 3, T.s);
    }
    const quiver = k.mask().poly([[qx - 2, qy], [qx + 3, qy - 1], [qx + 1, qy + 12], [qx - 3, qy + 12]]);
    k.paint(quiver, R.leather, { dir: "h", occ: 0.3 });
    k.L(qx - 2, qy + 1, qx + 3, qy, C.gold[0]);
    k.L(qx - 3, qy + 10, qx + 1, qy + 10, C.w[0]);

    // luk (u vzdálené, natažené ruky)
    const bx = lx + 12 + (draw ? 1 : 0);
    const by = sh + 3;
    const bend = draw ? 3.4 : 2.2;
    const half = draw ? 13 : 14;
    const pts = [];
    for (let i = -half; i <= half; i++) {
      const t = i / half;
      pts.push([bx + bend * (1 - t * t) - bend * 0.3 - (Math.abs(t) > 0.85 ? (Math.abs(t) - 0.85) * 6 : 0), by + i]);
    }
    const tipT = pts[0];
    const tipB = pts[pts.length - 1];
    // tětiva
    const pull = draw ? [lx + 2, sh + 2] : [tipT[0] + 0.5, by];
    lineTo(k, [tipT, pull, tipB], mix(C.bone[0], C.white, 0.2));
    // zadní paže drží luk
    arm(k, lx + 1, sh + 2, bx - 1, by, { ramp: R.violetD, r0: 1.8, r1: 1.5, hand: R.leather, len: 6.2 });

    leg(k, lx - 2, hipY, lx + p.fb[0], p.fb[1], { ramp: R.violetD, boot: R.leather, bootH: 7, cuff: C.w[3] });
    leg(k, lx + 2, hipY, lx + p.ff[0], p.ff[1], { ramp: R.violet, boot: R.leather, bootH: 7, cuff: C.w[3] });

    // tunika
    const torso = k.mask().poly([
      [lx - 5, sh], [lx + 4, sh], [lx + 6, sh + 5], [lx + 6, hipY + 3], [lx - 5, hipY + 3], [lx - 6, sh + 4]
    ]);
    k.paint(torso, R.violet);
    k.L(lx + 1, sh + 3, lx + 2, hipY + 2, R.violet[3]);
    k.L(lx - 3, sh + 5, lx - 3, hipY + 1, R.violet[0]);
    // opasek
    k.R(lx - 5, hipY - 1, 12, 2, C.w[1]);
    k.R(lx - 5, hipY - 1, 12, 1, C.w[3]);
    k.px(lx + 2, hipY - 1, C.gold[2]);
    k.px(lx + 2, hipY, C.gold[1]);
    // řemen toulce přes hruď
    k.L(lx - 4, sh + 1, lx + 4, hipY - 1, C.w[1]);

    // kapuce s týmovým lemem
    const hx = lx + 1;
    const hy = sh - 6;
    const hood = k.mask().ell(hx - 0.5, hy - 0.5, 5.6, 6).poly([[hx - 5, hy - 2], [hx - 9, hy + 3 + fl], [hx - 3, hy + 4]]);
    k.paint(hood, R.violet, { occ: 0.3 });
    const face = k.mask().ell(hx + 2.2, hy + 1, 3, 4.1);
    k.paint(face, R.skin, { occ: 0.5 });
    k.R(hx, hy - 2, 4, 1, R.violet[3]);
    eye(k, hx + 3, hy, null);
    k.px(hx + 5, hy + 2, C.skin[1]);
    k.px(hx + 3, hy + 4, C.skin[2]);
    // pírko
    const fe = k.mask().cap(hx - 2, hy - 5, hx - 9, hy - 8 + fl, 1.3, 0.6);
    k.paint(fe, teamR(T), { occ: 0.35 });
    k.L(hx - 3, hy - 5, hx - 8, hy - 7 + fl, T.d);
    // límec
    const col = k.mask().ell(lx, sh + 0.5, 5.5, 2).cap(lx - 4, sh + 1, lx - 7, sh + 4 + fl, 1.2, 0.8);
    k.paint(col, teamR(T), { occ: 0.3 });

    // přední luk (dřevo) přes paži
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const mid = Math.abs(i - half) < 3;
      k.L(x0, y0, x1, y1, mid ? C.w[1] : C.w[3]);
      if (!mid) k.px(x0 + 1, y0, i < half ? C.w[4] : C.w[2]);
    }
    k.px(tipT[0], tipT[1], C.bone[0]);
    k.px(tipB[0], tipB[1], C.bone[0]);
    k.R(bx + 1, by - 1, 1, 3, T.m);

    // šíp při natažení
    if (draw) {
      k.L(pull[0], pull[1], bx + 6, by, C.w[4]);
      k.px(bx + 7, by, S[5]);
      k.px(bx + 8, by, C.white);
      k.px(bx + 6, by - 1, S[4]);
      k.px(bx + 6, by + 1, S[4]);
      k.px(pull[0] + 1, pull[1] - 1, T.l);
      k.px(pull[0] + 2, pull[1] - 1, T.m);
      k.px(pull[0] + 1, pull[1] + 1, T.m);
    }

    // přední paže (natahuje tětivu / visí)
    const hand = draw ? pull : loose ? [lx + 1, sh + 1] : [lx + 3 + (p.swing || 0) * 2, hipY - 1];
    arm(k, lx, sh + 2, hand[0], hand[1], { ramp: R.violet, r0: 1.9, r1: 1.6, cuff: R.leather, len: draw ? 4.6 : 5.6 });

    k.meta.head = [hx / HD, hy / HD];
  }

  /* ================= HRDINA ================= */
  function drawHero(k) {
    const { T, pose: p } = k;
    const dy = p.dy;
    const lx = p.lx;
    const hipY = -14 + dy;
    const sh = -28 + dy;
    const fl = p.cape;
    const cast = casting(p);

    // plášť v barvě týmu s jantarovým lemem
    const cape = k.mask().poly([
      [lx - 4, sh - 1], [lx + 1, sh], [lx - 5, -3 + fl], [lx - 13 - fl, -5 + fl * 2], [lx - 9, sh + 6]
    ]);
    k.paint(cape, teamRD(T), { dir: "h", tex: (x, y, t, c) => ((x - y) % 5 === 0 && t === 1 ? T.d : c) });
    k.L(lx - 13 - fl, -5 + fl * 2, lx - 5, -3 + fl, T.accent);
    k.L(lx - 12 - fl, -6 + fl * 2, lx - 6, -4 + fl, mix(T.accent, T.m, 0.5));

    // hůl s lucernou: úchop (x, y od ramene) a úhel násady
    const ST = {
      idle: [10, 12, -1.57], up: [10, 10, -1.57], flare: [10, 8, -1.57], fwd: [12, 10, -1.3],
      back: [6, 8, -2.05], strike: [10, 8, -1.0], low: [10, 11, -0.85]
    };
    const st = posed(ST, p);
    const sgx = lx + st[0];
    const sgy = sh + st[1];
    const sdx = Math.cos(st[2]);
    const sdy = Math.sin(st[2]);
    const sTop = [sgx + sdx * 19, sgy + sdy * 19];
    const sBot = [sgx - sdx * 13, Math.min(-1, sgy - sdy * 13)];
    const free = cast ? posed({ up: [lx + 8, sh - 7], flare: [lx + 6, sh - 11], fwd: [lx + 15, sh + 2] }, p) : null;

    // vzdálená paže (při kouzlu zvednutá s plamenem)
    if (free) arm(k, lx - 1, sh + 2, free[0], free[1], { ramp: R.tealD, r0: 1.9, r1: 1.6, cuff: R.gold });
    else arm(k, lx - 1, sh + 2, lx - 3 - (p.swing || 0) * 2, hipY + 1, { ramp: R.tealD, r0: 1.9, r1: 1.6, cuff: R.gold });

    leg(k, lx - 2, hipY, lx + p.fb[0], p.fb[1], { ramp: R.tealD, boot: R.leather, bootH: 6, cuff: C.gold[0], len: 5.9 });
    leg(k, lx + 2, hipY, lx + p.ff[0], p.ff[1], { ramp: R.teal, boot: R.leather, bootH: 6, cuff: C.gold[1], knee: C.gold[2], len: 5.9 });

    // zbroj
    const torso = k.mask().poly([
      [lx - 6, sh], [lx + 5, sh], [lx + 7, sh + 5], [lx + 6, hipY + 2], [lx - 6, hipY + 2], [lx - 7, sh + 4]
    ]);
    k.paint(torso, R.teal);
    k.L(lx - 4, sh + 9, lx + 5, sh + 9, C.t[1]);
    k.ring(lx + 0.5, sh + 5, 2.8, C.a[3]);
    k.px(lx, sh + 5, C.a[4]);
    k.px(lx + 1, sh + 5, C.a[1]);
    // šupinová sukně
    const skirt = k.mask().poly([[lx - 6, hipY], [lx + 6, hipY], [lx + 7, hipY + 5], [lx - 7, hipY + 5]]);
    k.paint(skirt, R.tealD, { dir: "h", tex: (x, y, t, c) => (((x + (y % 2) * 2) % 4 === 0) ? R.tealD[3] : c) });
    k.R(lx - 6, hipY - 1, 13, 2, C.gold[0]);
    k.R(lx - 6, hipY - 1, 13, 1, C.gold[1]);
    k.R(lx, hipY - 1, 2, 2, C.a[3]);

    // hlava: stříbrné vlasy, čelenka, plnovous
    const hx = lx + 1;
    const hy = sh - 6;
    const hair = k.mask().ell(hx - 1.5, hy - 1, 5.5, 5.5).poly([[hx - 6, hy - 1], [hx - 2, hy + 3], [hx - 4, hy + 8], [hx - 9 - fl, hy + 6 + fl]]);
    k.paint(hair, R.silver, { occ: 0.3, tex: (x, y, t, c) => ((x * 2 + y) % 5 === 0 && t > 0 ? R.silver[2] : c) });
    k.paint(k.mask().ell(hx + 1.5, hy + 0.5, 3.8, 4.5), R.skin, { occ: 0.35 });
    // vous
    const beard = k.mask().poly([[hx - 1, hy + 2], [hx + 5, hy + 2], [hx + 4, hy + 6], [hx + 1, hy + 8], [hx - 1, hy + 5]]);
    k.paint(beard, R.silver, { occ: 0.25 });
    k.px(hx + 3, hy + 3, C.skin[2]);
    k.px(hx + 4, hy + 3, C.skin[2]);
    // oko žhne jantarem
    k.px(hx + 3, hy, C.a[3]);
    k.px(hx + 3, hy + 1, C.a[1]);
    k.L(hx + 2, hy - 2, hx + 4, hy - 2, S[4]);
    k.px(hx + 5, hy + 1, C.skin[1]);
    // čelenka
    k.L(hx - 5, hy - 3, hx + 4, hy - 4, C.gold[1]);
    k.L(hx - 5, hy - 2, hx - 2, hy - 2, C.gold[0]);
    k.px(hx + 1, hy - 5, C.a[3]);
    k.px(hx + 1, hy - 4, C.a[4]);

    // nárameníky zlaté
    const pad = k.mask().ell(lx + 1.5, sh + 1, 4.5, 3, (x, y) => y < sh + 3);
    k.paint(pad, R.gold, { occ: 0.4 });
    k.R(lx - 2, sh + 2, 8, 1, C.gold[0]);
    k.px(lx, sh - 1, C.white);

    // hůl
    k.L(sBot[0], sBot[1], sTop[0], sTop[1], C.w[3]);
    k.L(sBot[0] + 1, sBot[1], sTop[0] + 1, sTop[1], C.w[1]);
    k.px(sBot[0], sBot[1], C.w[0]);
    // lucerna: mosazná klec kolem teplého jádra
    const sx = Math.round(sTop[0]);
    const topY = Math.round(sTop[1]);
    const lp = [sx - 2, topY - 7];
    const cage = k.mask().rect(lp[0], lp[1], 6, 7);
    k.paint(cage, R.gold, { occ: 0.3 });
    const hot = p.sw === "flare";
    k.R(lp[0] + 1, lp[1] + 1, 4, 5, hot ? C.a[4] : C.a[3]);
    k.R(lp[0] + 1, lp[1] + 4, 4, 2, hot ? C.a[3] : C.a[2]);
    k.px(lp[0] + 2, lp[1] + 2, C.white);
    k.L(lp[0] + 3, lp[1] + 1, lp[0] + 3, lp[1] + 5, C.gold[0]);
    k.R(lp[0] + 1, lp[1] - 1, 4, 1, C.gold[1]);
    k.px(lp[0] + 2, lp[1] - 2, C.gold[0]);
    k.px(lp[0] + 3, lp[1] - 2, C.gold[0]);
    k.R(lp[0], lp[1] + 7, 6, 1, C.gold[0]);
    k.meta.lantern = [(lp[0] + 3) / HD, (lp[1] + 3) / HD];

    // přední paže drží hůl
    arm(k, lx + 2, sh + 2, sgx, sgy, { ramp: R.teal, r0: 2, r1: 1.7, cuff: R.gold });

    // plamen ve volné ruce
    if (free && p.sw !== "up") {
      const fx = free[0] + 1;
      const fy = free[1] - 3;
      const big = p.sw === "flare" ? 1 : 0;
      const fire = k.mask().ell(fx, fy + 1, 2.4 + big, 2.6 + big).poly([[fx - 2, fy], [fx + 2, fy], [fx + 0.5, fy - 5 - big * 2]]);
      k.paint(fire, ramp(C.a[4], C.a[3], C.a[2], C.r[4]), { occ: 0, dir: "v" });
      k.px(fx, fy + 1, C.white);
      k.px(fx + 3 + big, fy - 3, C.a[3]);
      k.px(fx - 3 - big, fy - 2, C.a[2]);
    } else if (free) {
      k.px(free[0] + 1, free[1] - 3, C.a[3]);
    }

    k.meta.head = [hx / HD, hy / HD];
  }

  /* ================= NÁJEZDNÍK (Popelavý zástup) ================= */
  function drawRaider(k) {
    const { T, pose: p } = k;
    const dy = p.dy;
    const lx = p.lx + 1;
    const hipY = -12 + dy;
    const sh = -25 + dy;
    const fl = p.cape;

    // tyč s roztřepenou korouhví
    const px0 = lx - 7;
    k.L(px0, sh - 18, px0, hipY, C.w[1]);
    k.L(px0 + 1, sh - 18, px0 + 1, hipY, C.w[0]);
    k.px(px0, sh - 19, C.r[4]);
    k.px(px0, sh - 20, C.r[5]);
    const ban = k.mask().poly([
      [px0 - 1, sh - 17], [px0 - 10, sh - 17 + fl], [px0 - 9, sh - 12 + fl], [px0 - 11, sh - 8 + fl * 2], [px0 - 6, sh - 10 + fl], [px0 - 4, sh - 7 + fl], [px0 - 1, sh - 9]
    ]);
    k.paint(ban, teamR(T), { dir: "v", occ: 0.2 });
    k.ring(px0 - 5, sh - 13 + fl, 1.8, C.r[4], false);
    k.px(px0 - 5, sh - 13 + fl, C.r[5]);

    // vzdálená paže
    arm(k, lx - 1, sh + 2, lx - 4 - (p.swing || 0) * 2, hipY + (p.sw === "back" ? -3 : 1), { ramp: R.basalt, r0: 2, r1: 1.7, hand: R.ash, cuff: R.iron });

    leg(k, lx - 2, hipY, lx + p.fb[0], p.fb[1], { ramp: R.basalt, boot: R.basalt, bootH: 5, cuff: C.b[4] });
    leg(k, lx + 2, hipY, lx + p.ff[0], p.ff[1], { ramp: R.iron, boot: R.basalt, bootH: 5, cuff: C.b[4], knee: C.b[4] });

    // tunika v barvě týmu
    const torso = k.mask().poly([
      [lx - 7, sh], [lx + 6, sh], [lx + 7, sh + 5], [lx + 6, hipY + 4], [lx - 6, hipY + 4], [lx - 8, sh + 4]
    ]);
    k.paint(torso, teamR(T));
    k.L(lx - 2, hipY + 1, lx - 3, hipY + 4, T.d);
    k.L(lx + 3, hipY + 1, lx + 3, hipY + 4, T.d);
    // železný kyrys s žhnoucími prasklinami
    const plate = k.mask().poly([[lx - 5, sh + 1], [lx + 5, sh + 1], [lx + 6, sh + 6], [lx + 3, sh + 10], [lx - 5, sh + 10]]);
    k.paint(plate, R.iron, { occ: 0.4 });
    lineTo(k, [[lx - 2, sh + 3], [lx - 1, sh + 5], [lx - 2, sh + 7], [lx, sh + 9]], C.r[3]);
    k.px(lx - 1, sh + 5, C.r[5]);
    k.px(lx + 3, sh + 4, C.r[4]);
    k.px(lx + 2, sh + 5, C.r[3]);
    // opasek s lebkou
    k.R(lx - 6, hipY - 1, 13, 2, C.b[0]);
    k.R(lx - 6, hipY - 1, 13, 1, C.b[2]);
    k.R(lx, hipY - 2, 3, 3, C.bone[0]);
    k.px(lx, hipY - 1, C.ink);
    k.px(lx + 2, hipY - 1, C.ink);

    // hlava: popelavá tvář v železné helmě s rohy
    const hx = lx + 1;
    const hy = sh - 6;
    k.paint(k.mask().ell(hx, hy + 0.5, 4.5, 5), R.ash, { occ: 0.3 });
    // čelist a zuby
    k.L(hx + 1, hy + 4, hx + 4, hy + 4, C.b[0]);
    k.px(hx + 2, hy + 4, C.bone[0]);
    k.px(hx + 4, hy + 4, C.bone[1]);
    const helm = k.mask().ell(hx - 0.5, hy - 1.5, 5.6, 4.8, (x, y) => y < hy) ;
    helm.rect(hx - 6, hy - 1, 4, 5);
    k.paint(helm, R.iron, { occ: 0.35 });
    k.R(hx - 5, hy - 1, 11, 1, C.b[1]);
    k.L(hx + 4, hy - 1, hx + 4, hy + 2, C.b[2]);
    k.px(hx - 2, hy - 5, C.b[4]);
    // nýty
    for (const x of [-4, -1, 2]) k.px(hx + x, hy - 2, C.b[4]);
    // žhnoucí štěrbinové oko pod hledím
    k.R(hx + 1, hy, 4, 1, C.b[0]);
    emberEye(k, hx + 2, hy + 1);
    k.meta.eye = [(hx + 2) / HD, (hy + 1) / HD];
    // rohy z kosti
    const horns = k.mask()
      .cap(hx - 4, hy - 4, hx - 8, hy - 7, 1.4, 1.1)
      .cap(hx - 8, hy - 7, hx - 7, hy - 11, 1.1, 0.5)
      .cap(hx + 3, hy - 4, hx + 6, hy - 7, 1.3, 1)
      .cap(hx + 6, hy - 7, hx + 5, hy - 10, 1, 0.5);
    k.paint(horns, R.bone, { occ: 0.3, tex: (x, y, t, c) => (y % 2 === 0 && t === 1 ? R.bone[2] : c) });

    // ostnaté nárameníky
    const pad = k.mask().ell(lx + 1, sh + 1, 4.5, 3, (x, y) => y < sh + 3);
    pad.poly([[lx - 1, sh - 1], [lx, sh - 5], [lx + 2, sh - 1]]).poly([[lx + 2, sh - 1], [lx + 4, sh - 4], [lx + 5, sh]]);
    k.paint(pad, R.iron, { occ: 0.4 });
    k.px(lx, sh - 4, C.b[4]);

    // těžký sekáč, rozžhavený na ostří
    const CL = {
      idle: [lx + 9, sh + 13, -0.9],
      back: [lx + 3, sh - 2, -2.3],
      strike: [lx + 12, sh + 11, 0.25],
      low: [lx + 11, sh + 13, 0.5]
    };
    const [hx2, hy2, ang] = posed(CL, p);
    const dx = Math.cos(ang);
    const dyv = Math.sin(ang);
    let nx = -dyv;
    let ny = dx;
    if (ny > 0) { nx = -nx; ny = -ny; }
    const b0 = [hx2 + dx * 5, hy2 + dyv * 5];
    const b1 = [hx2 + dx * 15, hy2 + dyv * 15];
    k.L(hx2 - dx * 2, hy2 - dyv * 2, b0[0], b0[1], C.w[2]);
    const cleaver = k.mask().poly([
      [b0[0] - nx * 0.5, b0[1] - ny * 0.5], [b0[0] - nx * 5, b0[1] - ny * 5],
      [b1[0] - nx * 6, b1[1] - ny * 6], [b1[0] + nx * 1, b1[1] + ny * 1], [b0[0] + nx * 1.5, b0[1] + ny * 1.5]
    ]);
    k.paint(cleaver, R.steelD, { occ: 0.35 });
    // rozžhavené ostří (vnější hrana)
    k.L(b0[0] - nx * 5, b0[1] - ny * 5, b1[0] - nx * 6, b1[1] - ny * 6, C.r[4]);
    k.px(b1[0] - nx * 6, b1[1] - ny * 6, C.r[5]);
    k.px((b0[0] + b1[0]) / 2 - nx * 5.5, (b0[1] + b1[1]) / 2 - ny * 5.5, C.r[5]);
    k.px(b0[0] + dx * 3 - nx * 2, b0[1] + dyv * 3 - ny * 2, C.b[1]);
    if (p.sw === "strike") {
      smear(k, lx + 4, sh + 12, 19, -1.9, 0.1, C.r[5], C.r[3]);
    }

    arm(k, lx + 2, sh + 2, hx2, hy2, { ramp: R.iron, r0: 2.1, r1: 1.8, hand: R.ash, cuff: R.basalt });

    k.meta.head = [hx / HD, hy / HD];
  }

  /* ================= GHÚL ================= */
  function drawGhoul(k) {
    const { T, pose: p } = k;
    const dy = p.dy;
    const lx = p.lx;
    const hipY = -10 + dy;
    const fl = p.cape;

    // zadní paže visí dolů s drápy
    const bh = p.sw === "back" ? [lx - 6, hipY - 2] : [lx - 1 - (p.swing || 0) * 3, hipY + 6];
    arm(k, lx - 2, hipY - 10, bh[0], bh[1], { ramp: R.rotD, r0: 1.7, r1: 1.4, hand: R.rotD, len: 6.5 });
    for (const o of [-1, 1]) k.L(bh[0], bh[1] + 1, bh[0] + 2, bh[1] + 3 + o, C.bone[1]);

    leg(k, lx - 3, hipY, lx - 1 + p.fb[0], p.fb[1], { ramp: R.rotD, boot: R.rotD, bare: true, len: 5.2, r0: 2.2, r1: 1.5, r2: 1.3 });
    leg(k, lx + 1, hipY, lx + 3 + p.ff[0], p.ff[1], { ramp: R.rot, boot: R.rot, bare: true, len: 5.2, r0: 2.2, r1: 1.5, r2: 1.3 });

    // shrbený trup
    const torso = k.mask().poly([
      [lx - 7, hipY + 1], [lx + 4, hipY + 1], [lx + 9, hipY - 8], [lx + 5, hipY - 15], [lx - 3, hipY - 16], [lx - 8, hipY - 10]
    ]);
    k.paint(torso, R.rot);
    // páteř
    for (let i = 0; i < 4; i++) {
      const x = lx - 5 + i * 2.5;
      const y = hipY - 12 - i * 1.2;
      k.px(x, y, C.bone[0]);
      k.px(x + 1, y, C.bone[1]);
    }
    // žebra
    for (const y of [-11, -8, -5]) {
      k.L(lx, hipY + y, lx + 5, hipY + y - 1, R.rot[3]);
      k.L(lx, hipY + y - 1, lx + 4, hipY + y - 2, R.rot[0]);
    }
    // rána
    k.px(lx + 6, hipY - 9, C.r[1]);
    k.px(lx + 7, hipY - 8, C.r[2]);
    k.px(lx + 6, hipY - 8, C.r[0]);

    // týmový bederní hadr
    const rag = k.mask().poly([[lx - 6, hipY - 2], [lx + 4, hipY - 2], [lx + 3, hipY + 3], [lx + 1, hipY + 5 + fl], [lx - 1, hipY + 3], [lx - 4, hipY + 5], [lx - 6, hipY + 2]]);
    k.paint(rag, teamR(T), { occ: 0.3, dir: "v" });
    k.L(lx - 6, hipY - 2, lx + 4, hipY - 2, T.h);

    // hlava nízko vpředu, otevřená tlama
    const hx = lx + 8;
    const hy = hipY - 13;
    const head = k.mask().ell(hx, hy, 4.5, 4).poly([[hx - 1, hy + 1], [hx + 6, hy + 1], [hx + 5, hy + 4], [hx, hy + 4]]);
    k.paint(head, R.rot, { occ: 0.3 });
    // tlama
    k.L(hx + 1, hy + 2, hx + 6, hy + 2, C.r[0]);
    k.L(hx + 1, hy + 3, hx + 5, hy + 3, C.r[1]);
    k.px(hx + 2, hy + 2, C.bone[0]);
    k.px(hx + 4, hy + 2, C.bone[0]);
    k.px(hx + 3, hy + 3, C.bone[1]);
    k.px(hx + 5, hy + 3, C.bone[0]);
    // vpadlá očnice se žhavou štěrbinou
    k.R(hx + 1, hy - 2, 4, 2, R.rot[3]);
    emberEye(k, hx + 3, hy - 1);
    k.meta.eye = [(hx + 3) / HD, (hy - 1) / HD];
    // řídké vlasy
    k.L(hx - 3, hy - 3, hx - 6, hy - 1 + fl, C.h[3]);
    k.L(hx - 2, hy - 4, hx - 5, hy - 4 + fl, C.h[4]);

    // přední paže s dlouhými drápy
    const HAND = { idle: [lx + 10, hipY - 1], back: [lx + 1, hipY - 21], strike: [lx + 17, hipY - 9], low: [lx + 14, hipY] };
    const hp = reach(lx + 4, hipY - 12, ...posed(HAND, p, null, [lx + 10 + (p.swing || 0) * 2, hipY - 1]), 13);
    arm(k, lx + 4, hipY - 12, hp[0], hp[1], { ramp: R.rot, r0: 1.8, r1: 1.4, hand: R.rot, len: 6.6 });
    const cd = p.sw === "back" ? [-0.6, -0.8] : p.sw === "low" ? [0.8, 0.9] : [1, 0.5];
    for (const o of [-1.5, 0, 1.5]) {
      const ex = hp[0] + cd[0] * 4 - cd[1] * o;
      const ey = hp[1] + cd[1] * 4 + cd[0] * o;
      k.L(hp[0] + cd[0], hp[1] + cd[1], ex, ey, C.bone[0]);
      k.px(ex, ey, mix(C.bone[0], C.white, 0.5));
    }
    if (p.sw === "strike") {
      for (const r of [9, 11.5, 14]) smear(k, lx + 7, hipY - 8, r, -1.3, 0.3, C.r[4], C.r[2], true);
    }

    k.meta.head = [hx / HD, hy / HD];
  }

  /* ================= KOSTLIVEC (střelec) ================= */
  function drawSkeleton(k) {
    const { T, pose: p } = k;
    const dy = p.dy;
    const lx = p.lx;
    const hipY = -14 + dy;
    const sh = -26 + dy;
    const draw = p.sw === "back";
    const loose = p.sw === "strike";
    const fl = p.cape;
    const bone = R.bone;

    // toulec
    const qx = lx - 6;
    const qy = sh - 1;
    for (let i = 0; i < 2; i++) {
      k.L(qx + i * 2, qy - 4, qx + i * 2 + 1, qy, C.w[3]);
      k.px(qx + i * 2, qy - 5, C.r[3]);
      k.px(qx + i * 2 - 1, qy - 4, C.r[2]);
    }
    const quiver = k.mask().poly([[qx - 2, qy], [qx + 3, qy - 1], [qx + 1, qy + 11], [qx - 3, qy + 11]]);
    k.paint(quiver, R.leather, { dir: "h", occ: 0.3, tex: (x, y, t, c) => ((x + y) % 4 === 0 ? mix(c, C.w[0], 0.4) : c) });

    // rezavý luk
    const bx = lx + 12 + (draw ? 1 : 0);
    const by = sh + 3;
    const bend = draw ? 3.4 : 2.2;
    const half = draw ? 13 : 14;
    const pts = [];
    for (let i = -half; i <= half; i++) {
      const t = i / half;
      pts.push([bx + bend * (1 - t * t) - bend * 0.3 - (Math.abs(t) > 0.85 ? (Math.abs(t) - 0.85) * 6 : 0), by + i]);
    }
    const tipT = pts[0];
    const tipB = pts[pts.length - 1];
    const pull = draw ? [lx + 2, sh + 2] : [tipT[0] + 0.5, by];
    lineTo(k, [tipT, pull, tipB], C.bone[2]);
    arm(k, lx + 1, sh + 2, bx - 1, by, { ramp: bone, r0: 1, r1: 0.9, r2: 0.8, hand: bone, len: 6.2 });

    // nohy z kostí
    const bl = { ramp: bone, boot: bone, bare: true, len: 5.8, r0: 1.1, r1: 1, r2: 0.9, knee: C.white };
    leg(k, lx - 2, hipY, lx + p.fb[0], p.fb[1], { ...bl, ramp: R.ash, boot: R.ash });
    leg(k, lx + 2, hipY, lx + p.ff[0], p.ff[1], bl);

    // pánev, páteř, žebra
    const pelvis = k.mask().ell(lx, hipY, 4.5, 2.2);
    k.paint(pelvis, bone, { occ: 0.35 });
    k.px(lx, hipY, C.ink);
    for (let y = sh + 1; y < hipY - 1; y++) k.px(lx - 1 + ((y & 1) ? 0 : 0), y, (y & 1) ? C.bone[1] : C.bone[0]);
    for (let i = 0; i < 4; i++) {
      const y = sh + 2 + i * 2;
      const w = 5 - (i > 2 ? 1 : 0);
      lineTo(k, [[lx - 1, y], [lx + w - 1, y], [lx + w, y + 1]], C.bone[0]);
      lineTo(k, [[lx - 1, y], [lx - w + 1, y], [lx - w, y + 1]], C.bone[1]);
      k.px(lx + w, y + 1, C.bone[2]);
    }
    // týmový cár přes rameno
    const rag = k.mask().poly([[lx - 5, sh - 1], [lx + 4, sh - 1], [lx + 5, sh + 2], [lx - 2, sh + 3], [lx - 6, sh + 7 + fl], [lx - 8, sh + 6 + fl]]);
    k.paint(rag, teamR(T), { occ: 0.3 });
    k.px(lx - 7, sh + 7 + fl, T.d);
    k.px(lx - 4, sh + 4, T.d);

    // lebka
    const hx = lx + 1;
    const hy = sh - 6;
    const skull = k.mask().ell(hx, hy - 0.5, 4.6, 4.4).rect(hx, hy + 2, 5, 3);
    k.paint(skull, bone, { occ: 0.3 });
    // očnice se žhavou štěrbinou
    k.R(hx + 1, hy - 1, 3, 3, C.ink);
    k.px(hx + 4, hy - 1, C.ink);
    emberEye(k, hx + 2, hy);
    k.px(hx + 2, hy - 1, C.ink);
    k.meta.eye = [(hx + 2) / HD, hy / HD];
    k.px(hx + 4, hy + 2, C.bone[2]);
    // zuby
    k.L(hx + 1, hy + 3, hx + 5, hy + 3, C.bone[2]);
    for (const x of [1, 3]) k.px(hx + x, hy + 4, C.bone[2]);
    k.px(hx - 2, hy - 3, C.white);
    k.L(hx - 3, hy, hx - 1, hy + 2, C.bone[2]);

    // luk vpředu
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      k.L(x0, y0, x1, y1, i % 7 === 3 ? C.r[1] : C.w[1]);
      if (Math.abs(i - half) > 2) k.px(x0 + 1, y0, i % 5 === 1 ? C.r[2] : C.w[2]);
    }
    k.px(tipT[0], tipT[1], C.b[4]);
    k.px(tipB[0], tipB[1], C.b[4]);
    if (draw) {
      k.L(pull[0], pull[1], bx + 6, by, C.w[3]);
      k.px(bx + 7, by, C.r[4]);
      k.px(bx + 8, by, C.r[5]);
      k.px(pull[0] + 1, pull[1] - 1, C.r[2]);
      k.px(pull[0] + 1, pull[1] + 1, C.r[2]);
    }
    const hand = draw ? pull : loose ? [lx + 1, sh + 1] : [lx + 3 + (p.swing || 0) * 2, hipY - 1];
    arm(k, lx, sh + 2, hand[0], hand[1], { ramp: bone, r0: 1.1, r1: 1, r2: 0.9, hand: bone, len: draw ? 4.6 : 5.8 });

    k.meta.head = [hx / HD, hy / HD];
  }

  /* ================= ZRŮDA ================= */
  function drawAbomination(k) {
    const { T, pose: p } = k;
    const dy = p.dy;
    const lx = p.lx;
    const fl = p.cape;
    const by = -26 + dy;

    // zadní paže s hákem na řetězu
    const bh = p.sw === "back" ? [lx - 16, by + 4] : [lx - 15 - (p.swing || 0) * 2, by + 12];
    arm(k, lx - 10, by - 4, bh[0], bh[1], { ramp: R.fleshD, r0: 3.4, r1: 2.8, r2: 2.4, hand: R.fleshD, len: 7.5 });
    const chain = [];
    for (let i = 0; i < 7; i++) chain.push([bh[0] - 1 - i * 0.4 + (i > 3 ? fl : 0), bh[1] + 2 + i * 1.6]);
    chain.forEach(([x, y], i) => k.px(x, y, i % 2 ? S[4] : S[2]));
    const hk = chain[chain.length - 1];
    const hook = k.mask().cap(hk[0], hk[1], hk[0], hk[1] + 4, 1, 1).cap(hk[0], hk[1] + 4, hk[0] - 3, hk[1] + 4, 1, 0.9).cap(hk[0] - 3, hk[1] + 4, hk[0] - 4, hk[1] + 1, 0.9, 0.5);
    k.paint(hook, R.steel, { occ: 0.3 });
    k.px(hk[0] - 4, hk[1] + 1, C.r[3]);

    // krátké tlusté nohy
    const legO = { ramp: R.fleshD, boot: R.leather, bootH: 4, len: 4.4, r0: 3.4, r1: 3, r2: 2.8 };
    leg(k, lx - 5, -10 + dy, lx - 6 + p.fb[0], p.fb[1], legO);
    leg(k, lx + 4, -10 + dy, lx + 5 + p.ff[0], p.ff[1], { ...legO, ramp: R.flesh });

    // obří břicho se stehy
    const belly = k.mask().ell(lx, by + 2, 13.5, 13);
    k.paint(belly, R.flesh, {
      split: 0.6,
      tex: (x, y, t, c) => ((x * 7 + y * 3) % 11 === 0 && t === 1 ? R.flesh[2] : c)
    });
    // šev uprostřed
    for (let y = by - 9; y <= by + 11; y++) {
      k.px(lx + 2 + Math.round(Math.sin(y * 0.5) * 0.6), y, C.r[1]);
      if (y % 3 === 0) {
        k.px(lx + 1, y, C.bone[1]);
        k.px(lx + 3, y, C.bone[1]);
      }
    }
    // šikmý šev a záplata
    lineTo(k, [[lx - 10, by - 3], [lx - 4, by + 4]], C.r[1]);
    for (let i = 0; i < 4; i++) k.px(lx - 9 + i * 1.6, by - 3 + i * 2, C.bone[1]);
    const patch = k.mask().rect(lx + 6, by - 6, 5, 5);
    k.paint(patch, ramp(0xc8a890, 0xa58a74, 0x7d6656, 0x5a4840), { occ: 0.4 });
    for (const [x, y] of [[6, -6], [10, -6], [6, -2], [10, -2]]) k.px(lx + x, by + y, C.r[1]);
    // rána
    k.px(lx + 9, by + 4, C.r[2]);
    k.px(lx + 10, by + 5, C.r[3]);
    k.px(lx + 9, by + 5, C.r[0]);

    // zástěra v barvě týmu
    const apron = k.mask().poly([[lx - 9, by + 6], [lx + 9, by + 6], [lx + 10, by + 17], [lx - 10, by + 17]]);
    k.paint(apron, teamR(T), { dir: "h", occ: 0.35 });
    k.L(lx - 9, by + 6, lx + 9, by + 6, T.h);
    k.px(lx - 4, by + 12, C.r[2]);
    k.px(lx - 3, by + 13, C.r[1]);
    k.px(lx + 5, by + 15, C.r[2]);
    k.L(lx - 3, by + 9, lx - 3, by + 16, T.s);
    k.L(lx + 4, by + 9, lx + 5, by + 16, T.s);

    // malá hlava zapadlá v ramenou
    const hx = lx + 6;
    const hy = by - 13;
    k.paint(k.mask().ell(hx, hy, 4.4, 4), R.flesh, { occ: 0.35 });
    k.L(hx - 3, hy - 3, hx + 3, hy - 3, C.r[1]);
    for (const x of [-2, 0, 2]) k.px(hx + x, hy - 4, C.bone[1]);
    k.R(hx + 1, hy - 1, 3, 1, R.flesh[3]);
    emberEye(k, hx + 2, hy);
    k.meta.eye = [(hx + 2) / HD, hy / HD];
    k.L(hx + 1, hy + 2, hx + 4, hy + 2, C.r[0]);
    k.px(hx + 2, hy + 3, C.bone[0]);

    // přední paže se sekáčkem
    const HAND = { idle: [lx + 15, by + 4, -1.25], back: [lx + 9, by - 16, -2.4], strike: [lx + 19, by + 5, 0.1], low: [lx + 17, by + 12, 0.7] };
    const [hx2, hy2, ang] = posed(HAND, p);
    const dx = Math.cos(ang);
    const dyv = Math.sin(ang);
    let nx = -dyv;
    let ny = dx;
    if (ny > 0) { nx = -nx; ny = -ny; }
    const b0 = [hx2 + dx * 3, hy2 + dyv * 3];
    const b1 = [hx2 + dx * 14, hy2 + dyv * 14];
    const cl = k.mask().poly([[b0[0] + nx, b0[1] + ny], [b0[0] - nx * 6, b0[1] - ny * 6], [b1[0] - nx * 6, b1[1] - ny * 6], [b1[0] + nx, b1[1] + ny]]);
    k.paint(cl, R.steelD, { occ: 0.35, tex: (x, y, t, c) => ((x * 5 + y * 3) % 9 === 0 ? C.r[1] : c) });
    k.L(b0[0] - nx * 6, b0[1] - ny * 6, b1[0] - nx * 6, b1[1] - ny * 6, S[5]);
    k.px(b1[0] - nx * 6, b1[1] - ny * 6, C.white);
    k.px(b0[0] - nx * 1, b0[1] - ny * 1, S[1]);
    if (p.sw === "strike") {
      smear(k, lx + 9, by + 8, 21, -1.8, 0.2, S[6], S[4]);
    }
    arm(k, lx + 9, by - 5, hx2, hy2, { ramp: R.flesh, r0: 3.6, r1: 3, r2: 2.6, hand: R.flesh, len: 7.2 });

    k.meta.head = [hx / HD, hy / HD];
  }

  /* ================= PŘÍZRAK ================= */
  function drawBanshee(k) {
    const { T, pose: p } = k;
    const ph = p.step >= 0 ? p.step : p.i || 0;
    const lift = 6 + (p.step >= 0 ? [0, 1, 2, 2, 1, 0][p.step] : p.dy * 2);
    const dy = -lift;
    const lx = p.lx;
    const fl = p.cape;
    const sh = -26 + dy;
    const hx = lx + 1;
    const hy = sh - 6;

    // vlasy: dlouhé prameny vlají dozadu (za tělem)
    const strands = [
      [hy - 4, 15, 0], [hy - 2, 17, 1], [hy, 14, 2], [hy + 2, 12, 0], [hy - 3, 11, 2]
    ];
    strands.forEach(([y0, len, o], i) => {
      const m = k.mask();
      let px0 = hx - 2;
      let py0 = y0;
      for (let s = 1; s <= 4; s++) {
        const t = s / 4;
        const x1 = hx - 2 - len * t;
        const y1 = y0 + t * (5 + i) + Math.sin(t * 4 + ph * 1.1 + o) * 1.6 * t;
        m.cap(px0, py0, x1, y1, 1.6 - t * 0.9, 1.5 - t);
        px0 = x1;
        py0 = y1;
      }
      k.paint(m, i % 2 ? R.mistD : R.mist, { occ: 0.25 });
    });

    // cáry mlhy pod šatem
    for (const [x, len, o] of [[-6, 9, 0], [-3, 13, 1], [0, 11, 0], [3, 9, 1], [5, 6, 0]]) {
      const w = (ph + o) % 2;
      lineTo(k, [[lx + x, sh + 12], [lx + x - 1 - w, sh + 12 + len / 2], [lx + x - 2 - fl - w, sh + 12 + len]], o ? R.mist[2] : R.mist[3]);
      k.px(lx + x - 2 - fl - w, sh + 13 + len, mix(R.mist[3], C.v[1], 0.4));
    }

    // zadní paže
    const HAND = { idle: [lx + 9, sh + 7], back: [lx + 2, sh - 7], strike: [lx + 15, sh + 1], low: [lx + 14, sh + 5] };
    const hp = reach(lx + 1, sh + 2, ...posed(HAND, p, null, [lx + 9 + (p.swing || 0), sh + 7]), 12);
    arm(k, lx - 1, sh + 2, hp[0] - 3, hp[1] + 1, { ramp: R.mistD, r0: 1.3, r1: 1.1, r2: 0.9, hand: R.mistD, len: 6.4 });

    // šat zúžený dolů, roztřepený lem
    const dress = k.mask().poly([[lx - 4, sh], [lx + 3, sh], [lx + 6, sh + 13], [lx + 3, sh + 15], [lx, sh + 13], [lx - 3, sh + 16], [lx - 7, sh + 13]]);
    k.paint(dress, R.mist, { dir: "h" });
    k.L(lx - 1, sh + 6, lx - 2, sh + 13, R.mist[2]);
    k.L(lx + 2, sh + 7, lx + 3, sh + 12, R.mist[2]);
    // týmová šerpa
    const sash = k.mask().poly([[lx - 5, sh + 4], [lx + 4, sh + 4], [lx + 5, sh + 6], [lx - 5, sh + 6]]).cap(lx - 5, sh + 5, lx - 10 - fl, sh + 10, 1.1, 0.7);
    k.paint(sash, teamR(T), { occ: 0.3 });

    // hlava: bledá propadlá tvář, prázdné oči, otevřená ústa
    const face = ramp(0xf4ffff, 0xd6f2f2, 0x9fd0d8, 0x5f9fb0);
    k.paint(k.mask().ell(hx + 0.5, hy + 0.5, 3.9, 4.9), face, { occ: 0.35 });
    // vlasy přes temeno
    const cap = k.mask().ell(hx - 1, hy - 1.5, 4.6, 4.2, (x, y) => y < hy - 2 || x < hx - 1);
    k.paint(cap, R.mist, { occ: 0.3 });
    k.L(hx - 3, hy - 4, hx + 2, hy - 5, C.white);
    // očnice
    k.R(hx + 2, hy - 1, 2, 2, mix(C.ink, C.v[0], 0.3));
    k.px(hx + 3, hy - 1, C.y[2]);
    k.dark(hx + 1, hy - 2, 0.3);
    // lícní kost a ústa
    k.dark(hx + 1, hy + 1, 0.25);
    k.R(hx + 2, hy + 2, 2, 3, mix(C.ink, C.v[0], 0.45));
    k.px(hx + 3, hy + 2, C.ink);
    k.meta.eye = [(hx + 3) / HD, (hy - 1) / HD];

    // přední paže
    arm(k, lx + 1, sh + 2, hp[0], hp[1], { ramp: R.mist, r0: 1.4, r1: 1.2, r2: 1, hand: R.mist, len: 6.4 });
    k.px(hp[0] + 2, hp[1] - 1, C.y[3]);
    k.px(hp[0] + 2, hp[1] + 1, C.y[2]);
    k.px(hp[0] + 1, hp[1] + 2, C.y[2]);
    if (p.sw === "strike" || p.sw === "low") {
      // výkřik: soustředné oblouky před tváří
      for (const r of [3, 6, 9]) {
        if (p.sw === "low" && r === 3) continue;
        for (let a = -0.75; a <= 0.75; a += 0.5 / r) k.px(hx + 4 + Math.cos(a) * r, hy + 3 + Math.sin(a) * r, r === 6 ? C.y[3] : C.y[1]);
      }
    }

    k.meta.head = [hx / HD, hy / HD];
  }

  /* ================= LICH ================= */
  function drawLich(k) {
    const { T, pose: p } = k;
    const dy = p.dy;
    const lx = p.lx;
    const fl = p.cape;
    const sh = -29 + dy;
    // útok = vržená ohnivá koule: nápřah, hod, dohra
    const sw = p.anim === "attack" ? LICH_SW[p.sw] || p.sw : p.sw;
    const cast = sw === "up" || sw === "flare" || sw === "fwd";
    const step = p.step >= 0 ? p.step : -1;

    // plášť vzadu
    const cape = k.mask().poly([[lx - 5, sh - 1], [lx, sh], [lx - 7, -1], [lx - 14 - fl, -2 + fl], [lx - 10, sh + 6]]);
    k.paint(cape, ramp(C.b[2], C.b[1], C.b[0], mix(C.b[0], C.ink, 0.4)), { dir: "h" });
    k.L(lx - 14 - fl, -2 + fl, lx - 7, -1, T.s);

    // hůl s žhnoucí lebkou
    const ST = { idle: [11, 0], up: [11, -2], flare: [11, -4], fwd: [14, -1], back: [7, -2], strike: [14, 1], low: [12, 0] };
    const st = posed(ST, p, LICH_SW);
    const sx = lx + st[0];
    const top = sh - 7 + st[1];

    // vzdálená paže (kouzlo)
    const free = cast ? posed({ up: [lx - 4, sh - 9], flare: [lx - 6, sh - 13], fwd: [lx + 6, sh - 4] }, p, LICH_SW) : [lx - 4 - (step >= 0 ? (p.swing || 0) * 2 : 0), sh + 13];
    arm(k, lx - 2, sh + 2, free[0], free[1], { ramp: R.robe, r0: 2.2, r1: 1.8, hand: R.bone, len: 6.4 });

    // dlouhá róba až k zemi
    const sway = step >= 0 ? [1, 0, -1, -1, 0, 1][step] : 0;
    const robe = k.mask().poly([[lx - 6, sh], [lx + 5, sh], [lx + 8 + sway, -1], [lx - 8 + sway, -1]]);
    k.paint(robe, R.robe, { dir: "h", tex: (x, y, t, c) => ((x - lx + 40) % 4 === 0 && y > sh + 10 && t === 1 ? R.robe[2] : c) });
    // lem a středový pruh v barvě týmu
    k.R(lx - 8 + sway, -2, 17, 2, T.m);
    k.R(lx - 8 + sway, -2, 17, 1, T.l);
    const band = k.mask().poly([[lx - 1, sh + 1], [lx + 2, sh + 1], [lx + 3 + sway, -2], [lx - 2 + sway, -2]]);
    k.paint(band, teamR(T), { dir: "h", occ: 0.3 });
    k.ring(lx + 0.5 + sway * 0.5, sh + 18, 1.8, C.r[4]);
    // pás se zlatou sponou
    k.R(lx - 6, sh + 10, 13, 2, C.gold[0]);
    k.R(lx - 6, sh + 10, 13, 1, C.gold[1]);
    k.px(lx, sh + 10, C.r[5]);
    k.px(lx + 1, sh + 11, C.r[4]);
    // žhavé runy
    for (const [x, y] of [[-5, 16], [5, 20], [-4, 24], [4, 13]]) k.px(lx + x + sway * 0.5, sh + y, C.r[3]);

    // ramena s kostěnými trny
    const pad = k.mask().ell(lx, sh + 1, 7, 3, (x, y) => y < sh + 3);
    pad.poly([[lx - 6, sh - 1], [lx - 6, sh - 5], [lx - 4, sh - 1]]).poly([[lx + 3, sh - 1], [lx + 5, sh - 5], [lx + 6, sh]]);
    k.paint(pad, R.iron, { occ: 0.4 });
    k.px(lx - 6, sh - 5, C.bone[0]);
    k.px(lx + 5, sh - 5, C.bone[0]);
    k.px(lx - 6, sh - 4, C.bone[1]);
    k.px(lx + 5, sh - 4, C.bone[1]);

    // lebka a rohatá koruna
    const hx = lx + 1;
    const hy = sh - 6;
    const skull = k.mask().ell(hx, hy - 0.5, 4.5, 4.4).rect(hx, hy + 2, 5, 3);
    k.paint(skull, R.bone, { occ: 0.35 });
    k.R(hx + 1, hy - 1, 3, 3, C.ink);
    emberEye(k, hx + 2, hy);
    k.meta.eye = [(hx + 2) / HD, hy / HD];
    k.L(hx + 1, hy + 3, hx + 5, hy + 3, C.bone[2]);
    for (const x of [1, 3]) k.px(hx + x, hy + 4, C.bone[2]);
    k.px(hx + 4, hy + 1, C.bone[2]);
    const crown = k.mask().rect(hx - 5, hy - 5, 10, 2).poly([[hx - 4, hy - 5], [hx - 2, hy - 9], [hx, hy - 5]]).poly([[hx - 1, hy - 5], [hx + 1, hy - 10], [hx + 3, hy - 5]]).poly([[hx + 2, hy - 5], [hx + 4, hy - 8], [hx + 5, hy - 5]]);
    k.paint(crown, R.gold, { occ: 0.35 });
    k.px(hx + 1, hy - 4, C.r[5]);
    k.px(hx, hy - 4, C.r[4]);
    const horns = k.mask()
      .cap(hx - 4, hy - 4, hx - 8, hy - 8, 1.3, 1)
      .cap(hx - 8, hy - 8, hx - 7, hy - 13, 1, 0.5)
      .cap(hx + 4, hy - 4, hx + 7, hy - 8, 1.2, 0.9)
      .cap(hx + 7, hy - 8, hx + 6, hy - 12, 0.9, 0.5);
    k.paint(horns, R.ash, { occ: 0.3, tex: (x, y, t, c) => (y % 2 === 0 && t === 1 ? R.ash[2] : c) });

    // hůl
    k.L(sx, top, sx, -1, C.w[1]);
    k.L(sx + 1, top, sx + 1, -1, C.w[0]);
    for (const y of [top + 6, top + 14]) k.R(sx, y, 2, 1, C.gold[0]);
    const sk = k.mask().ell(sx + 0.5, top - 3, 3.2, 3).rect(sx - 1, top - 1, 4, 2);
    k.paint(sk, R.bone, { occ: 0.35 });
    k.px(sx - 1, top - 3, C.ink);
    k.px(sx + 2, top - 3, C.ink);
    k.px(sx + 2, top - 3, C.r[4]);
    k.px(sx - 1, top - 3, C.r[3]);
    const hot = sw === "flare";
    const flame = k.mask().ell(sx + 0.5, top - 7, 2 + (hot ? 1 : 0), 2).poly([[sx - 1, top - 8], [sx + 2, top - 8], [sx + 0.5, top - 12 - (hot ? 3 : 0)]]);
    k.paint(flame, R.ember, { occ: 0, dir: "v" });
    k.px(sx + 0.5, top - 7, C.white);
    k.meta.lantern = [(sx + 0.5) / HD, (top - 6) / HD];

    // přední paže drží hůl
    arm(k, lx + 2, sh + 2, sx, sh + 12, { ramp: R.robe, r0: 2.2, r1: 1.8, hand: R.bone, len: 6.4 });

    // ohnivá koule ve volné ruce
    if (cast && sw !== "up") {
      const fx = free[0];
      const fy = free[1] - 3;
      const big = hot ? 1 : 0;
      const orb = k.mask().ell(fx, fy, 2.5 + big, 2.5 + big).poly([[fx - 2, fy - 1], [fx + 2, fy - 1], [fx, fy - 6 - big * 2]]);
      k.paint(orb, R.ember, { occ: 0, dir: "v" });
      k.px(fx, fy, C.white);
      k.px(fx + 3 + big, fy - 3, C.r[4]);
      k.px(fx - 3 - big, fy - 4, C.r[3]);
    }

    k.meta.head = [hx / HD, hy / HD];
  }

  const RIGS = {
    soldier: drawSoldier,
    worker: drawWorker,
    archer: drawArcher,
    hero: drawHero,
    raider: drawRaider,
    ghoul: drawGhoul,
    skeleton: drawSkeleton,
    abomination: drawAbomination,
    banshee: drawBanshee,
    lich: drawLich
  };

  /* ---------- atlas ---------- */
  const store = {};

  function build(type, team) {
    const out = {};

    for (const [anim, poses] of Object.entries(POSES)) {
      if (anim === "cast" && type !== "hero" && type !== "lich") continue;

      const render = pose => {
        const P = new Pix(W, W);
        const k = kit(P, team, { ...pose, anim });
        RIGS[type](k);
        P.outline(C.ink, 0.7);
        return { P, k };
      };

      out[anim] = poses.map((pose, n) => {
        const { P, k } = render(pose);
        if (pose.blur) {
          // stopa zbraně a paží: dřívější fáze máchnutí (tělo stojí na místě mezisnímku), čím starší, tím řidší
          const ghosts = [0.04, 0.14, 0.24, 0.34, 0.44].map((t, j) => [render({ ...between(pose.from, pose.to, 0, t), blur: 0, lx: pose.lx, dy: pose.dy, ff: pose.ff, fb: pose.fb }).P, Math.min(0.95, pose.blur * (0.5 + j * 0.22))]);
          motionBlur(P, ghosts);
        }

        const pf = P.flipX();
        const meta = { ...k.meta };

        return {
          pix: P,
          pixf: pf,
          c: PK.fine(P),
          cf: PK.fine(pf),
          meta,
          flash: null,
          flashf: null
        };
      });
    }

    return out;
  }

  /* Rozmazání pohybu: kde předchozí póza měla tvar a nová už ne, zůstane
   * zesvětlená, ditherovaná stopa (smear frame z klasické animace). */
  function motionBlur(P, ghosts) {
    const solid = P.clone();
    // jen tam, kde se něco pohnulo daleko (zbraň, paže); tělo posunuté o pár px stopu nedělá
    const near = (x, y) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (solid.alpha(x + dx, y + dy)) return true;
      return false;
    };

    for (let y = 0; y < P.h; y++) {
      for (let x = 0; x < P.w; x++) {
        if (near(x, y)) continue;
        for (let j = ghosts.length - 1; j >= 0; j--) {
          const [G, amount] = ghosts[j];
          const c = G.get(x, y);
          if (c < 0 || PK.bayer(x, y) > amount) continue;
          P.set(x, y, mix(c, 0xfff6e0, 0.2 + (ghosts.length - 1 - j) * 0.08));
          break;
        }
      }
    }
  }

  function frame(type, team, anim, i) {
    const key = `${type}|${team}`;
    const set = store[key] || (store[key] = build(type, team));

    let list = set[anim];
    if (!list) list = set.idle;

    return list[((i % list.length) + list.length) % list.length];
  }

  /* Snímek úderu podle průběhu 0..1: nápřah drží, máchnutí (rozmazaný
   * mezisnímek) proletí, zásah a dokmit drží déle, jak to v úderu cítíme. */
  const ATTACK_T = [0.1, 0.3, 0.38, 0.6, 0.75, 1];

  function attackFrame(p) {
    const i = ATTACK_T.findIndex(t => p < t);
    return i < 0 ? ATTACK_T.length - 1 : i;
  }

  function frameCount(anim) {
    return POSES[anim].length;
  }

  /* Bílý záblesk zásahu (cache na snímek). */
  function flash(rec, flip) {
    const k = flip ? "flashf" : "flash";

    if (!rec[k]) {
      rec[k] = PK.fine((flip ? rec.pixf : rec.pix).tint(0xfff8ec, 0.72));
    }

    return rec[k];
  }

  /* Padlé tělo pro animaci smrti: otočení o 90 stupňů, cache. */
  function lying(type, team, flip) {
    const key = `${type}|${team}|lying|${flip ? 1 : 0}`;

    if (!store[key]) {
      const rec = frame(type, team, "idle", 0);
      const base = flip ? rec.pixf : rec.pix;
      const rot = flip ? base.rot90().flipX() : base.rot90();
      store[key] = { pix: rot, c: PK.fine(rot) };
    }

    return store[key];
  }

  function dissolved(rec, keep) {
    const q = Math.round(keep * 4);
    rec.dis = rec.dis || {};

    if (!rec.dis[q]) rec.dis[q] = PK.fine(rec.pix.dissolve(q / 4));
    return rec.dis[q];
  }

  /* Portrét pro HUD: 40x40 jemných px kolem hlavy a hrudi; v HUDu se kreslí
   * na 40x40 art px, takže jeden jemný bod spritu = jeden art px UI. */
  const PORTRAIT_OFF = {
    worker: [-1, 3], soldier: [-1, 4], archer: [0, 4], hero: [-1, 5], raider: [-1, 4],
    ghoul: [-4, 6], skeleton: [0, 4], abomination: [-4, 8], banshee: [-2, 5], lich: [-1, 3]
  };

  const portraitCache = {};

  function portrait(type, team, frameIndex = 0) {
    const key = `${type}|${team}|${frameIndex}`;

    if (!portraitCache[key]) {
      const rec = frame(type, team, "idle", frameIndex);
      const head = rec.meta.head || [0, -12];
      const off = PORTRAIT_OFF[type] || [0, 4];
      const cx = Math.round(OX + head[0] * HD) + off[0];
      const cy = Math.round(OY + head[1] * HD) + off[1];
      const crop = rec.pix.crop(cx - 20, cy - 20, 40, 40);
      portraitCache[key] = PK.fine(crop.scale(HD));
    }

    return portraitCache[key];
  }

  /* Drobný náklad na zádech dělníka. */
  const carry = {};

  {
    // vak se zlatem: plátěný pytel, provázek, třpytivé nugety
    const gold = new Pix(7 * HD, 7 * HD);
    const bag = new Mask();
    const pp = (x, y) => [x - OX, y - OY];
    bag.ell(...pp(7, 8.2), 5.6, 5.2).poly([pp(5, 4), pp(9, 4), pp(10, 1), pp(4, 1)]);
    paint(gold, bag, R.cloth, {
      tex: (x, y, t, c) => ((x + OX + (y + OY) * 2) % 5 === 0 && t === 1 ? R.cloth[2] : c)
    });
    gold.rect(4, 3, 7, 1, C.w[1]);
    gold.set(4, 3, C.w[3]);
    for (const [x, y, c] of [[6, 1, C.gold[1]], [7, 0, C.gold[2]], [8, 1, C.gold[0]], [5, 0, C.gold[1]], [8, 0, C.gold[2]]]) gold.set(x, y, c);
    gold.set(9, 8, C.gold[1]);
    gold.set(10, 8, C.gold[2]);
    gold.set(9, 9, C.gold[0]);
    gold.outline(C.ink, 0.7);
    carry.gold = PK.fine(gold);

    // otep dřeva: dvě polena s letokruhy a provaz
    const wood = new Pix(9 * HD, 8 * HD);
    const log = (y, x0, x1, rp) => {
      const m = new Mask();
      m.cap(x0 - OX, y - OY, x1 - OX, y - OY, 2.4);
      paint(wood, m, rp, { dir: "v" });
      // čelo polena s letokruhy
      const e = new Mask();
      e.ell(x1 - OX, y - OY, 2.2, 2.4);
      paint(wood, e, ramp(C.d[5], C.d[4], C.d[3], C.w[2]), { occ: 0.4 });
      wood.set(x1 | 0, y | 0, C.w[2]);
      wood.set((x1 | 0) - 1, (y | 0) - 1, C.d[3]);
      // kůra
      for (let x = x0; x < x1 - 2; x += 3) wood.set(x | 0, (y | 0) + 1, rp[3]);
    };
    log(4, 2, 14, R.leather);
    log(10, 3, 15, R.leatherL);
    wood.rect(7, 1, 2, 13, C.d[1]);
    wood.rect(7, 1, 1, 13, C.d[3]);
    wood.outline(C.ink, 0.7);
    carry.wood = PK.fine(wood);
  }

  PK.units = {
    CELL, AX, AY, frame, frameCount, attackFrame, flash, lying, dissolved, portrait, carry,
    types: Object.keys(RIGS)
  };
})();
