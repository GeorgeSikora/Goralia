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

  /* ---------- varianty vzhledu ----------
   * Každá jednotka dostane podle svého id jednu z variant (barva pleti, vlasy, vousy,
   * pokrývka hlavy, znak na štítu, barva oděvu), aby armáda nevypadala jako kopie.
   * Varianta 0 je vždy původní podoba jednotky. */
  const SKINS = [
    R.skin,
    ramp(0xf8e0c8, 0xeabd9a, 0xc4896c, 0x8e5a48),
    ramp(0xe4b282, 0xc89062, 0x966242, 0x643f2f),
    ramp(0xb27c54, 0x8c5c3c, 0x663f2b, 0x42271d)
  ];
  const HAIR = [
    ramp(C.w[3], C.w[2], C.w[1], C.w[0]),
    ramp(C.h[3], C.h[2], C.h[1], C.h[0]),
    ramp(0xe89050, 0xbc6430, 0x8c4222, 0x5c2a1a),
    ramp(C.d[5], C.d[4], C.d[3], C.d[2]),
    ramp(S[6], S[5], S[4], S[3])
  ];
  const CLOTHS = [
    R.cloth,
    ramp(C.d[4], C.d[3], C.d[2], C.d[1]),
    ramp(C.h[5], C.h[4], C.h[3], C.h[2]),
    ramp(0x8aa070, 0x667e54, 0x4a5e40, 0x31402e)
  ];
  const CLOTHS_D = CLOTHS.map(r => ramp(r[1], r[2], r[3], mix(r[3], C.ink, 0.3)));

  // počet variant pro každý typ (ostatní mají jen jednu)
  const VARIANTS = {
    worker: 8, soldier: 8, archer: 6, monk: 4, knight: 4, raider: 3, ghoul: 3, skeleton: 3,
    spearman: 6, crossbow: 6, scout: 4, hound: 3, necromancer: 2, plague: 3
  };

  // deterministické "náhodné" číslo z typu, varianty a kanálu (stejné na všech klientech)
  const vh = (type, v, ch) => {
    let h = 2166136261 ^ v * 16777619 ^ ch * 73856093;
    for (let i = 0; i < type.length; i++) h = Math.imul(h ^ type.charCodeAt(i), 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    return ((h ^ (h >>> 15)) >>> 0) % 997;
  };

  function variant(type, v) {
    const n = VARIANTS[type] || 1;
    v = ((v % n) + n) % n;
    if (v === 0) return { v: 0, skin: R.skin, hair: HAIR[0], beard: 1, hat: 0, emblem: 0, cloth: 0, coat: 0, tone: 0 };
    const pick = (ch, m) => vh(type, v, ch) % m;
    // pokrývka hlavy a znak se střídají po řadě, ať se varianty liší i při malém počtu
    return {
      v,
      skin: SKINS[pick(1, SKINS.length)],
      hair: HAIR[pick(2, HAIR.length)],
      beard: pick(3, 4),
      hat: v % 4,
      emblem: (v + pick(4, 2)) % 4,
      cloth: pick(5, CLOTHS.length),
      coat: v % 4,
      tone: v % 3
    };
  }

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
  function kit(P, team, pose, V) {
    const set = (x, y, c) => P.set(Math.round(x) + OX, Math.round(y) + OY, c);
    V = V || variant("", 0);
    const k = {
      P,
      T: TEAM[team] || TEAM.blue,
      pose,
      V,
      sk: V.skin,
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
    if (o.hand !== false) k.paint(k.mask().ell(rx, ry, 1.7, 1.7), o.hand || k.sk, { occ: 0.3 });
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

  // Schopnosti rytíře-hrdiny: štítová zeď (zvednutí štítu a držení krytu) a výpad (rozběh, bodnutí).
  POSES.guard = [
    { ...STAND, sw: "guard0", dy: 1, ff: [4, 0], fb: [-5, 0], cape: 1, i: 0 },
    { ...STAND, sw: "guard", dy: 2, lx: 1, ff: [6, 0], fb: [-6, 0], cape: 0, i: 1 }
  ];
  POSES.lunge = [
    { ...STAND, sw: "thrust0", lx: 2, dy: 1, ff: [8, 0], fb: [-7, 2], cape: 1, i: 0 },
    { ...STAND, sw: "thrust", lx: 4, dy: 2, ff: [11, 0], fb: [-9, 1], cape: 0, i: 1 },
    { ...STAND, sw: "thrust", lx: 4, dy: 1, ff: [11, 0], fb: [-9, 0], cape: 1, i: 2 }
  ];
  const HERO_ONLY = new Set(["guard", "lunge"]);

  /* Úder ze tří klíčových póz: nápřah, máchnutí s rozmazáním, dokmit (stejně jako attack). */
  function swingSet(back, strike, low, extra = {}) {
    const st = { ...STAND, sw: "idle", ...extra };
    const b = { ...back, ...extra };
    const s = { ...strike, ...extra };
    const l = { ...low, ...extra };
    return [
      { ...between(st, b), ...extra, i: -0.5 },
      b,
      { ...between(b, s, 0.55), ...extra, i: 0.5 },
      s,
      { ...between(s, l, 0.3), ...extra, i: 1.5 },
      l
    ];
  }

  // Přešlápnutí v nečinnosti: přenese váhu, zbraň položí na rameno nebo opře (sw "rest") a zase zpět.
  {
    const rest = { ...STAND, sw: "rest", dy: 1, lx: -1, ff: [2, 0], fb: [-4, 0], cape: 1 };
    const rest2 = { ...rest, dy: 0, cape: 0 };
    POSES.fidget = [
      { ...STAND, i: 0 },
      { ...between({ ...STAND }, rest), i: 0.5 },
      { ...rest, i: 1 },
      { ...rest2, i: 2 },
      { ...rest, i: 3 },
      { ...rest2, i: 4 },
      { ...between(rest2, { ...STAND }), i: 4.5 }
    ];
  }

  // Zásah: trup se zakloní, krok vzad, zbraň cukne (sw "hit" = jako postoj, tabulky bez něj berou idle)
  POSES.hit = [
    { ...STAND, sw: "hit", lx: -3, dy: 1, ff: [4, 0], fb: [-6, 0], swing: -0.8, cape: 1, i: 0 },
    { ...STAND, sw: "hit", lx: -2, dy: 1, ff: [3, 0], fb: [-5, 0], swing: -0.4, cape: 0, i: 1 }
  ];

  // Oslava vítězství: přikrčení, výskok se zbraní nad hlavou (sw "up"), dopad
  POSES.cheer = [
    { ...STAND, sw: "up", dy: 2, ff: [3, 0], fb: [-4, 0], swing: 0.5, cape: 1, i: 0 },
    { ...STAND, sw: "up", dy: -3, ff: [3, 3], fb: [-3, 3], swing: -0.3, cape: 0, i: 1 },
    { ...STAND, sw: "up", dy: -4, ff: [2, 4], fb: [-3, 3], swing: -0.5, cape: 1, i: 2 },
    { ...STAND, sw: "up", dy: 1, ff: [3, 0], fb: [-4, 0], swing: 0.2, cape: 0, i: 3 }
  ];

  // Dělník: sekání dřeva sekerou (vodorovný švih do kmene) a stavba kladivem v podřepu.
  const WORKER_ONLY = new Set(["chop", "build"]);
  POSES.chop = swingSet(
    { ...STAND, lx: -2, sw: "back", ff: [1, 0], fb: [-5, 0], cape: 1, i: 0 },
    { ...STAND, lx: 3, sw: "strike", ff: [6, 0], fb: [-5, 0], dy: 1, cape: 0, i: 1 },
    { ...STAND, lx: 2, sw: "low", ff: [6, 0], fb: [-4, 0], dy: 1, cape: 1, i: 2 },
    { tool: "axe" }
  );
  {
    const up = { ...STAND, tool: "hammer", sw: "back", dy: 5, lx: 1, ff: [7, 0], fb: [-7, 0], cape: 0, i: 0 };
    const down = { ...up, sw: "strike", dy: 6, cape: 1, i: 1 };
    POSES.build = [up, { ...between(up, down, 0.5), tool: "hammer", i: 0.5 }, down, { ...down, dy: 5, sw: "low", i: 2 }];
  }

  /* ---------- náklad dělníka (jemné px, stejné světlo a obrys jako tělo) ---------- */
  const BURLAP = ramp(C.d[4], C.d[3], C.d[2], C.d[1]);
  const RINGS = ramp(C.d[5], C.d[4], C.d[3], C.w[2]);

  // pytel se zlatem visí za zády, hrdlo přehozené přes rameno
  function sackBack(k, lx, y) {
    const m = k.mask().ell(lx - 8, y + 3, 5.2, 5.8).cap(lx - 6, y - 1, lx - 2, y - 3, 2.6, 1.5);
    k.paint(m, BURLAP, {
      occ: 0.35,
      tex: (x, yy, t, c) => ((x * 2 + yy) % 5 === 0 && t === 1 ? BURLAP[2] : c)
    });
    // záplata a šev
    k.R(lx - 11, y + 4, 3, 3, BURLAP[2]);
    k.R(lx - 11, y + 4, 3, 1, BURLAP[1]);
    for (let i = 0; i < 4; i++) k.px(lx - 6, y + 1 + i * 2, BURLAP[3]);
    // zlato prosvítá z natržené díry v pytli
    k.R(lx - 11, y, 4, 3, C.gold[1]);
    k.px(lx - 11, y, C.gold[2]);
    k.px(lx - 10, y, C.white);
    k.px(lx - 8, y + 2, C.gold[0]);
    k.px(lx - 11, y + 2, C.gold[0]);
    k.dark(lx - 12, y + 1, 0.4);
    k.dark(lx - 7, y + 1, 0.4);
    // spodek pytle se prohýbá pod vahou
    k.dark(lx - 8, y + 8, 0.3);
    k.dark(lx - 7, y + 8, 0.3);
  }

  // provázek na hrdle a ruka, která ho drží nad ramenem
  function sackGrip(k, lx, y) {
    const neck = k.mask().cap(lx - 3, y - 3, lx, y - 4, 1.3, 1);
    k.paint(neck, BURLAP, { occ: 0.3 });
    k.px(lx - 3, y - 3, C.w[1]);
    k.px(lx - 3, y - 2, C.w[2]);
    k.paint(k.mask().ell(lx - 1, y - 2, 1.7, 1.6), k.sk, { occ: 0.3 });
    k.px(lx + 1, y - 5, C.gold[2]);
  }

  // náruč tří polen před hrudí, přední čela s letokruhy, provaz
  function logsInArms(k, lx, y) {
    const logs = [[lx - 6, lx + 10, y + 7.5], [lx - 3, lx + 12, y + 4.5]];
    for (const [x0, x1, yy] of logs) {
      const m = k.mask().cap(x0, yy, x1, yy, 1.9);
      k.paint(m, R.leatherL, {
        dir: "v",
        occ: 0.35,
        tex: (x, ty, t, c) => (t === 1 && (x * 5 + ty * 3) % 7 === 0 ? R.leatherL[2] : c)
      });
      // čelo polena: světlé dřevo s letokruhem a středem
      k.paint(k.mask().ell(x1, yy, 1.6, 1.9), RINGS, { occ: 0.5 });
      k.px(x1, yy, C.w[2]);
      // zadní čelo jen jako tmavší řez
      k.dark(x0 - 1, yy, 0.25);
    }
    // provaz kolem otepi
    k.L(lx + 3, y + 2, lx + 4, y + 9, C.w[1]);
    k.px(lx + 3, y + 3, C.d[4]);
    k.px(lx + 4, y + 7, C.d[4]);
  }

  /* ================= DĚLNÍK ================= */
  // Nástroje: krumpáč (těžba), sekera (dřevo), kladivo (stavba a oprava). [úchop x, y, úhel k hlavě, délka násady, za tělem?]
  function drawWorker(k) {
    const { T, V, pose: p } = k;
    const dy = p.dy;
    const lx = p.lx;
    const hipY = -11 + dy;
    const sh = -22 + dy;
    const bob = p.step >= 0 ? (p.step % 3 === 0 ? 1 : 0) : 0;
    const tool = p.tool || "pick";
    const cloth = CLOTHS[V.cloth];
    const clothD = CLOTHS_D[V.cloth];

    const TOOLS = {
      pick: {
        idle: [lx + 7, -14 + dy, -2.55, 15, true],
        back: [lx + 2, -26 + dy, -2.45, 15, true],
        strike: [lx + 11, -16 + dy, 0.3, 14, false],
        low: [lx + 11, -12 + dy, 0.75, 11, false],
        rest: [lx + 5, sh + 5, -2.3, 14, false],
        up: [lx + 6, sh - 8, -1.35, 13, false]
      },
      axe: {
        idle: [lx + 7, -14 + dy, -2.55, 13, true],
        back: [lx - 2, sh + 1, -2.7, 12, true],
        strike: [lx + 11, sh + 6, -0.05, 12, false],
        low: [lx + 9, sh + 10, 0.55, 11, false]
      },
      hammer: {
        idle: [lx + 7, sh + 7, -1.2, 7, false],
        back: [lx + 6, sh - 3, -2.2, 7, false],
        strike: [lx + 11, sh + 9, 0.85, 7, false],
        low: [lx + 11, sh + 10, 1.0, 7, false]
      }
    };
    const [gx, gy0, ga, glen, behind] = posed(TOOLS[tool], p, null, TOOLS[tool].idle);
    const gy = gy0 + bob;
    const pdx = Math.cos(ga);
    const pdy = Math.sin(ga);

    const toolDraw = () => {
      const butt = [gx - pdx * 3, gy - pdy * 3];
      const top = [gx + pdx * glen, gy + pdy * glen];
      k.L(butt[0], butt[1], top[0], top[1], C.w[3]);
      k.L(butt[0] + 1, butt[1], top[0] + 1, top[1], C.w[1]);
      k.px(top[0], top[1], C.w[2]);
      const nx = -pdy;
      const ny = pdx;
      const c0 = [top[0] + pdx, top[1] + pdy];
      if (tool === "pick") {
        // hlava kolmo k násadě, hroty zahnuté zpět k násadě
        const pa = [c0[0] + nx * 7 - pdx * 2.5, c0[1] + ny * 7 - pdy * 2.5];
        const pb = [c0[0] - nx * 6 - pdx * 2, c0[1] - ny * 6 - pdy * 2];
        const head = k.mask().cap(c0[0], c0[1], pa[0], pa[1], 1.5, 0.6).cap(c0[0], c0[1], pb[0], pb[1], 1.5, 0.7);
        k.paint(head, R.steel, { occ: 0.35 });
        k.px(c0[0], c0[1], C.w[1]);
        k.px(pa[0], pa[1], C.white);
        k.px(pb[0], pb[1], S[5]);
      } else if (tool === "axe") {
        // široké ostří na jedné straně (ve směru švihu), krátký týl na druhé
        const s = ga > -1.6 ? 1 : -1;
        const e0 = [c0[0] - pdx * 1 + nx * s * 1, c0[1] - pdy * 1 + ny * s * 1];
        const blade = k.mask().poly([
          [c0[0] + pdx * 1.5, c0[1] + pdy * 1.5], [c0[0] - pdx * 2.5, c0[1] - pdy * 2.5],
          [e0[0] - pdx * 3.5 + nx * s * 5, e0[1] - pdy * 3.5 + ny * s * 5],
          [e0[0] + nx * s * 6, e0[1] + ny * s * 6],
          [e0[0] + pdx * 3 + nx * s * 5, e0[1] + pdy * 3 + ny * s * 5]
        ]);
        k.paint(blade, R.steel, { occ: 0.35 });
        // vybroušená hrana
        k.L(e0[0] - pdx * 3 + nx * s * 5.5, e0[1] - pdy * 3 + ny * s * 5.5, e0[0] + pdx * 2.5 + nx * s * 5.5, e0[1] + pdy * 2.5 + ny * s * 5.5, S[6]);
        k.px(e0[0] + pdx * 3 + nx * s * 5, e0[1] + pdy * 3 + ny * s * 5, C.white);
        k.paint(k.mask().ell(c0[0] - nx * s * 1.5, c0[1] - ny * s * 1.5, 1.4, 1.4), R.iron, { occ: 0.3 });
      } else {
        // kladivo: krátká násada, železná palice napříč
        const head = k.mask().cap(c0[0] + nx * 3, c0[1] + ny * 3, c0[0] - nx * 3.5, c0[1] - ny * 3.5, 1.7, 1.7);
        k.paint(head, R.iron, { occ: 0.35 });
        k.px(c0[0] + nx * 3, c0[1] + ny * 3, S[5]);
        k.px(c0[0] - nx * 3.5, c0[1] - ny * 3.5, S[6]);
      }
    };

    // náklad: s pytlem nebo otepí se nese krumpáč za opaskem (nekreslí se), náklad se při kroku
    // opožďuje o 1 jemný px proti tělu (setrvačnost)
    const load = p.carry;
    const ly = sh + (p.lag || 0);
    if (load === "gold") sackBack(k, lx, ly);
    if (behind && !load) toolDraw();

    // zadní paže: při práci drží násadu, s pytlem drží jeho hrdlo nad ramenem, jinak se kývá
    const twoHand = tool !== "hammer";
    const bh = load === "gold" ? [lx - 2, ly - 3]
      : load === "wood" ? [lx - 4, ly + 9]
      : behind || !twoHand
        ? (tool === "hammer" ? [lx + 6, hipY + 2] : [lx - 2 - (p.swing || 0) * 3, hipY + 1])
        : [gx + pdx * 5 - 1, gy + pdy * 5];
    arm(k, lx - 1, sh + 1, ...reach(lx - 1, sh + 1, bh[0], bh[1], 10.3), { ramp: clothD, r0: 1.9, r1: 1.6, len: 5.2 });

    leg(k, lx - 2, hipY, lx + p.fb[0], p.fb[1], { ramp: clothD, boot: R.leather, bootH: 4, len: 5 });
    leg(k, lx + 2, hipY, lx + p.ff[0], p.ff[1], { ramp: cloth, boot: R.leather, bootH: 4, len: 5 });

    // tunika
    const torso = k.mask().poly([
      [lx - 5, sh - 1], [lx + 4, sh - 1], [lx + 6, sh + 4], [lx + 6, hipY + 2], [lx - 6, hipY + 2], [lx - 6, sh + 3]
    ]);
    k.paint(torso, cloth);
    k.L(lx - 3, sh + 4, lx - 4, hipY + 1, cloth[2]);
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
    // lucerna na opasku vzadu (někdo místo ní nosí měšec)
    const lp = [lx - 9, hipY - 1];
    if (V.v % 3 !== 2) {
      k.L(lp[0] + 2, lp[1] - 1, lp[0] + 3, lp[1] - 1, C.w[1]);
      const lan = k.mask().rect(lp[0], lp[1], 4, 5);
      k.paint(lan, R.gold, { occ: 0.3 });
      k.R(lp[0] + 1, lp[1] + 1, 2, 3, C.a[2]);
      k.px(lp[0] + 1, lp[1] + 1, C.a[4]);
      k.px(lp[0] + 2, lp[1] + 3, C.a[1]);
      k.R(lp[0] + 1, lp[1] - 1, 2, 1, C.gold[0]);
    } else {
      k.paint(k.mask().ell(lp[0] + 2.5, lp[1] + 3, 2.6, 2.8).rect(lp[0] + 2, lp[1], 2, 1), R.leatherL, { occ: 0.3 });
      k.px(lp[0] + 2, lp[1] + 1, C.gold[1]);
      k.L(lp[0] + 1, lp[1] + 1, lp[0] + 4, lp[1] + 1, C.w[0]);
    }

    // šátek
    const scarf = k.mask().ell(lx, sh, 5, 1.8).cap(lx - 4, sh, lx - 7, sh + 4 + p.cape, 1.1, 0.9);
    k.paint(scarf, teamR(T), { occ: 0.3 });

    if (load === "gold") sackGrip(k, lx, ly);
    if (load === "wood") {
      // paže objímá polena zespodu: rukáv za nimi, dlaň na předním konci
      arm(k, lx + 2, sh + 1, lx + 8, ly + 9, { ramp: cloth, r0: 2, r1: 1.7, cuff: R.leather, hand: false });
      logsInArms(k, lx, ly);
      k.paint(k.mask().ell(lx + 8, ly + 9, 1.7, 1.5), k.sk, { occ: 0.3 });
    }

    // hlava
    const hx = lx + 1;
    const hy = sh - 6;
    k.paint(k.mask().ell(hx, hy, 4.6, 5), k.sk, { occ: 0.3 });
    k.paint(k.mask().ell(hx - 3, hy + 1, 1.4, 1.8), k.sk, { occ: 0.35 });
    k.px(hx - 3, hy + 1, k.sk[3]);
    eye(k, hx + 2, hy, V.v ? V.hair[2] : C.w[1]);
    k.px(hx + 5, hy + 1, k.sk[2]);
    k.px(hx + 3, hy + 3, k.sk[3]);
    k.px(hx + 4, hy + 3, k.sk[2]);
    beardOf(k, hx, hy, V);

    hatOf(k, hx, hy, V, T, p.cape);

    if (!behind && !load) {
      toolDraw();
      if (p.sw === "strike" && tool === "pick") smear(k, lx + 4, -16 + dy, 18, -2.2, -0.35, S[5], S[3]);
      if (p.sw === "strike" && tool === "axe") smear(k, lx + 1, sh + 6, 13, -2.6, -0.1, S[6], S[3]);
      if (p.sw === "strike" && tool === "hammer") {
        // jiskra z hřebíku
        const hx2 = gx + pdx * (glen + 2);
        const hy2 = gy + pdy * (glen + 2);
        for (const [ox, oy, c] of [[2, 1, C.a[4]], [3, -1, C.a[3]], [1, 2, C.a[2]]]) k.px(hx2 + ox, hy2 + oy, c);
      }
    }

    // přední paže drží násadu, otep zespodu za přední konec, u pytle se volně kývá
    const fh = load === "wood" ? [lx + 6, ly + 10]
      : load === "gold" ? [lx + 3 + (p.swing || 0) * 3, hipY + 1]
      : [gx, gy];
    if (load !== "wood") arm(k, lx + 2, sh + 1, ...(load === "gold" ? reach(lx + 2, sh + 1, fh[0], fh[1], 10.3) : reach(lx + 2, sh + 1, fh[0], fh[1], 11)), { ramp: cloth, r0: 2, r1: 1.7, cuff: R.leather });

    k.meta.head = [hx / HD, hy / HD];
  }

  /* Vousy podle varianty: 0 oholený, 1 strniště, 2 krátký vous, 3 plnovous s knírem (hlava z profilu doprava). */
  function beardOf(k, hx, hy, V, o = {}) {
    const b = V.beard;
    if (b === 1) {
      for (const [x, y] of [[0, 3], [1, 4], [2, 4], [-1, 3]]) k.dark(hx + x, hy + y, 0.25);
    } else if (b >= 2) {
      const full = b === 3;
      const m = k.mask().poly([[hx - 2, hy + 1], [hx + 4, hy + 3], [hx + 4, hy + (full ? 5 : 4)], [hx + 2, hy + (full ? 7 : 5)], [hx - 1, hy + (full ? 6 : 4)]]);
      k.paint(m, V.hair, { occ: 0.25, tex: (x, y, t, c) => ((x + y) % 3 === 0 && t === 1 ? V.hair[2] : c) });
      if (full) k.L(hx + 2, hy + 2, hx + 5, hy + 2, V.hair[1]);
      k.px(hx + 4, hy + 3, mix(k.sk[3], C.ink, 0.3)); // ústa ve vousech
    }
    if (o.brow) k.L(hx + 1, hy - 2, hx + 3, hy - 2, V.hair[2]);
  }

  /* Pokrývka hlavy dělníka: 0 slaměný klobouk, 1 plstěná čepice s pérem, 2 týmový šátek, 3 holá hlava s vlasy. */
  function hatOf(k, hx, hy, V, T, fl) {
    const hat = V.hat;
    if (hat === 0) {
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
    } else if (hat === 1) {
      // vlasy zpod čepice vzadu
      k.paint(k.mask().ell(hx - 3, hy - 1, 2.6, 3.2), V.hair, { occ: 0.3 });
      const felt = ramp(C.w[3], C.w[2], C.w[1], C.w[0]);
      const crown = k.mask().ell(hx - 0.5, hy - 4.5, 5.4, 3.6, (x, y) => y < hy - 2);
      k.paint(crown, felt, { occ: 0.3 });
      k.paint(k.mask().ell(hx + 0.5, hy - 2.5, 6.6, 1.3), felt, { dir: "v", occ: 0.3 });
      k.R(hx - 4, hy - 4, 9, 1, T.m);
      // pero v barvě týmu trčí dozadu
      const fe = k.mask().cap(hx - 3, hy - 5, hx - 9, hy - 9 + fl, 1.2, 0.5);
      k.paint(fe, teamR(T), { occ: 0.3 });
      k.L(hx - 4, hy - 5, hx - 8, hy - 8 + fl, T.h);
    } else if (hat === 2) {
      // šátek uvázaný vzadu, cípy vlají
      const kc = k.mask().ell(hx - 0.5, hy - 2.5, 5.2, 4, (x, y) => y < hy - 0.5 || x < hx - 2);
      k.paint(kc, teamR(T), { occ: 0.3, tex: (x, y, t, c) => ((x + y) % 4 === 0 && t === 1 ? T.s : c) });
      k.R(hx - 1, hy - 3, 5, 1, T.l);
      const tails = k.mask().cap(hx - 5, hy - 1, hx - 9, hy + 2 + fl, 1.2, 0.8).cap(hx - 5, hy - 1, hx - 8, hy - 3 + fl, 1, 0.6);
      k.paint(tails, teamR(T), { occ: 0.3 });
      k.px(hx - 5, hy - 1, T.d);
    } else {
      // holá hlava: rozcuchané vlasy a čelenka
      const hair = k.mask().ell(hx - 0.8, hy - 2.2, 5, 3.6, (x, y) => y < hy - 1 || x < hx - 1).poly([[hx - 5, hy - 2], [hx - 7, hy + 1], [hx - 4, hy + 1]]);
      k.paint(hair, V.hair, { occ: 0.3, tex: (x, y, t, c) => ((x * 2 + y) % 5 === 0 && t < 2 ? V.hair[2] : c) });
      k.px(hx + 3, hy - 4, V.hair[0]);
      k.px(hx + 4, hy - 3, V.hair[1]);
      k.R(hx - 4, hy - 3, 9, 1, T.s);
      k.px(hx - 4, hy - 3, T.m);
    }
  }

  /* Znak na štítu podle varianty (v jemných px): 0 prázdné pole (Ring se kreslí zvlášť), 1 vodorovné břevno,
   * 2 čtvrcený štít, 3 krokev. Vrací barvu bodu nebo původní c. */
  function heraldry(x, y, sx, sy, kind, T, t, c) {
    const ax = x + 0.5 - sx;
    const ay = y + 0.5 - sy;
    const acc = t === 0 ? T.accentL : t === 3 ? mix(T.accent, C.ink, 0.35) : T.accent;
    if (kind === 1 && Math.abs(ay) < 1.6) return acc;
    if (kind === 2 && (ax < 0) !== (ay < 0)) return acc;
    if (kind === 3 && Math.abs(ay + Math.abs(ax) * 0.8 - 1) < 1.3) return acc;
    return c;
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

    // hlava v přilbě (podle varianty: 0 přilba s chocholem, 1 železný klobouk, 2 kónická přilba s nánosníkem, 3 přilba s kroužkovou kuklou)
    const V = k.V;
    const fl = p.cape;
    k.paint(k.mask().ell(hx, hy + 0.5, 4.4, 4.8), k.sk, { occ: 0.3 });
    eye(k, hx + 2, hy, V.hat === 1 || V.hat === 2 ? V.hair[2] : null);
    k.px(hx + 5, hy + 1, k.sk[2]);
    k.L(hx + 2, hy + 3, hx + 3, hy + 3, k.sk[3]);
    if (V.hat === 1 || V.hat === 2) beardOf(k, hx, hy, V);
    if (V.hat === 0) {
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
      const plume = k.mask()
        .cap(hx - 1, hy - 7, hx + 2, hy - 9, 1.6, 1.4)
        .cap(hx - 1, hy - 7, hx - 6, hy - 6 + fl, 1.8, 1.2)
        .cap(hx - 6, hy - 6 + fl, hx - 9, hy - 2 + fl, 1.2, 0.8);
      k.paint(plume, teamR(T), { occ: 0.3 });
      k.L(hx + 1, hy - 9, hx - 5, hy - 7 + fl, T.h);
    } else if (V.hat === 1) {
      // železný klobouk: kopule a široká krempa, týmová páska
      k.paint(k.mask().ell(hx - 3, hy, 2.4, 3), V.hair, { occ: 0.3 });
      const dome = k.mask().ell(hx - 0.5, hy - 3, 4.6, 4.2, (x, y) => y < hy - 2);
      k.paint(dome, R.steel, { occ: 0.3 });
      const brim = k.mask().ell(hx - 0.5, hy - 2.2, 8.4, 1.5);
      k.paint(brim, R.steelD, { dir: "v", occ: 0.3 });
      k.R(hx - 4, hy - 4, 8, 1, T.m);
      k.px(hx - 3, hy - 6, C.white);
      k.px(hx + 7, hy - 2, S[6]);
    } else if (V.hat === 2) {
      // kónická přilba s nánosníkem, vzadu týmová stuha
      const cone = k.mask().poly([[hx - 5, hy - 2], [hx + 5, hy - 2], [hx + 3, hy - 6], [hx - 1, hy - 9], [hx - 4, hy - 6]]);
      k.paint(cone, R.steel, { occ: 0.3, tex: (x, y, t, c) => (x === Math.round(hx - 1) && t > 0 ? S[2] : c) });
      k.R(hx - 5, hy - 2, 10, 1, R.gold[2]);
      k.R(hx - 5, hy - 3, 10, 1, R.gold[1]);
      k.L(hx + 4, hy - 2, hx + 4, hy + 2, S[4]);
      k.px(hx + 4, hy + 2, S[2]);
      k.px(hx - 1, hy - 8, C.white);
      const rib = k.mask().cap(hx - 5, hy - 2, hx - 9, hy + 1 + fl, 1, 0.7);
      k.paint(rib, teamR(T), { occ: 0.3 });
    } else {
      // přilba s kroužkovou kuklou přes krk a lícnicí
      const coif = k.mask().ell(hx - 1, hy + 1, 5.4, 5.6, (x, y) => x < hx + 1 || y > hy + 3);
      k.paint(coif, R.steelD, { occ: 0.3, tex: (x, y, t, c) => (y % 2 === 0 ? mix(c, C.shade, 0.25) : (x + (y >> 1)) % 2 ? c : mix(c, S[5], 0.2)) });
      const helm = k.mask().ell(hx - 0.5, hy - 2, 5.4, 4.8, (x, y) => y < hy - 1);
      k.paint(helm, R.steel, { occ: 0.3 });
      k.R(hx - 5, hy - 2, 10, 1, S[2]);
      k.px(hx - 2, hy - 6, C.white);
      // malý týmový hřebínek
      k.paint(k.mask().cap(hx - 3, hy - 7, hx + 2, hy - 7, 1, 1), teamR(T), { occ: 0.3 });
    }

    // štít na vzdálené paži, přes trup
    const sx = lx - 2 + (p.sw === "back" ? -1 : 0) + (p.swing || 0) * -0.5;
    const sy = sh + 9;
    const shield = k.mask().ell(sx, sy, 7.5, 8.5);
    k.paint(shield, teamR(T), {
      occ: 0.45,
      tex: (x, y, t, c) => {
        const d = Math.hypot((x + 0.5 - sx) / 7.5, (y + 0.5 - sy) / 8.5);
        if (d > 0.8) return (x - sx) + (y - sy) < -3 ? S[5] : (x - sx) + (y - sy) > 4 ? S[2] : S[3];
        return heraldry(x, y, sx, sy, V.emblem, T, t, c);
      }
    });
    if (V.emblem === 0) {
      k.ring(sx, sy, 3.6, T.accent);
      k.ring(sx + 0.5, sy + 0.5, 3.6, mix(T.accent, C.ink, 0.6));
      k.ring(sx, sy, 3.6, T.accent);
    }
    k.px(sx, sy, C.gold[1]);
    k.px(sx - 1, sy - 1, C.gold[2]);
    for (const [ox, oy] of [[-5, -5], [5, -5], [-6, 2], [5, 5]]) k.px(sx + ox, sy + oy, S[5]);

    // meč v přední ruce
    const SW = {
      idle: [lx + 8, sh + 10, -1.25],
      back: [lx + 3, sh - 3, -2.0],
      strike: [lx + 11, sh + 8, -0.05],
      low: [lx + 10, sh + 12, 0.75],
      rest: [lx + 9, sh + 12, 1.42],
      up: [lx + 5, sh - 7, -1.45]
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
  const ARCHER_GARB = [
    [R.violet, R.violetD],
    [ramp(0x7fa060, 0x587a46, 0x3e5a36, 0x283c26), ramp(0x587a46, 0x3e5a36, 0x2a4028, 0x1a2a1a)],
    [ramp(C.w[4], C.w[3], C.w[2], C.w[1]), ramp(C.w[3], C.w[2], C.w[1], C.w[0])]
  ];

  function drawArcher(k) {
    const { T, pose: p } = k;
    const dy = p.dy;
    const lx = p.lx;
    const hipY = -13 + dy;
    const sh = -25 + dy;
    const draw = p.sw === "back";
    const loose = p.sw === "strike";
    const fl = p.cape;
    const V = k.V;
    // barva oděvu podle varianty: fialová (původní), lesní zelená, kožená hnědá
    const [pv, pvd] = ARCHER_GARB[V.tone];

    // plášť za zády
    const cloak = k.mask().poly([
      [lx - 3, sh], [lx + 1, sh], [lx - 4, hipY + 6], [lx - 9 - fl, hipY + 4 + fl], [lx - 8, sh + 6]
    ]);
    k.paint(cloak, pvd, { dir: "h" });
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
    const by = sh + 3 + (p.sw === "up" ? -9 : 0);
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
    arm(k, lx + 1, sh + 2, bx - 1, by, { ramp: pvd, r0: 1.8, r1: 1.5, hand: R.leather, len: 6.2 });

    leg(k, lx - 2, hipY, lx + p.fb[0], p.fb[1], { ramp: pvd, boot: R.leather, bootH: 7, cuff: C.w[3] });
    leg(k, lx + 2, hipY, lx + p.ff[0], p.ff[1], { ramp: pv, boot: R.leather, bootH: 7, cuff: C.w[3] });

    // tunika
    const torso = k.mask().poly([
      [lx - 5, sh], [lx + 4, sh], [lx + 6, sh + 5], [lx + 6, hipY + 3], [lx - 5, hipY + 3], [lx - 6, sh + 4]
    ]);
    k.paint(torso, pv);
    k.L(lx + 1, sh + 3, lx + 2, hipY + 2, pv[3]);
    k.L(lx - 3, sh + 5, lx - 3, hipY + 1, pv[0]);
    // opasek
    k.R(lx - 5, hipY - 1, 12, 2, C.w[1]);
    k.R(lx - 5, hipY - 1, 12, 1, C.w[3]);
    k.px(lx + 2, hipY - 1, C.gold[2]);
    k.px(lx + 2, hipY, C.gold[1]);
    // řemen toulce přes hruď
    k.L(lx - 4, sh + 1, lx + 4, hipY - 1, C.w[1]);

    // hlava podle varianty: 0 kapuce s týmovým lemem, 1 klobouk s pérem, 2 vlasy s čelenkou
    const hx = lx + 1;
    const hy = sh - 6;
    if (V.hat % 3 === 0) {
      const hood = k.mask().ell(hx - 0.5, hy - 0.5, 5.6, 6).poly([[hx - 5, hy - 2], [hx - 9, hy + 3 + fl], [hx - 3, hy + 4]]);
      k.paint(hood, pv, { occ: 0.3 });
      const face = k.mask().ell(hx + 2.2, hy + 1, 3, 4.1);
      k.paint(face, k.sk, { occ: 0.5 });
      k.R(hx, hy - 2, 4, 1, pv[3]);
      eye(k, hx + 3, hy, null);
      k.px(hx + 5, hy + 2, k.sk[2]);
      k.px(hx + 3, hy + 4, k.sk[3]);
    } else {
      k.paint(k.mask().ell(hx, hy + 0.5, 4.4, 4.8), k.sk, { occ: 0.3 });
      eye(k, hx + 2, hy, V.hair[2]);
      k.px(hx + 5, hy + 1, k.sk[2]);
      k.L(hx + 2, hy + 3, hx + 3, hy + 3, k.sk[3]);
      if (V.beard >= 2) beardOf(k, hx, hy, { ...V, beard: 2 });
      const hair = k.mask().ell(hx - 0.8, hy - 2, 5, 3.8, (x, y) => y < hy - 1 || x < hx - 1).poly([[hx - 4, hy - 1], [hx - 7, hy + 4 + fl], [hx - 3, hy + 2]]);
      k.paint(hair, V.hair, { occ: 0.3, tex: (x, y, t, c) => ((x * 2 + y) % 5 === 0 && t < 2 ? V.hair[2] : c) });
      if (V.hat % 3 === 1) {
        // klobouk se zvednutou krempou
        const felt = ramp(pv[0], pv[1], pv[2], pv[3]);
        const crown = k.mask().poly([[hx - 5, hy - 3], [hx + 4, hy - 3], [hx + 2, hy - 7], [hx - 3, hy - 8]]);
        k.paint(crown, felt, { occ: 0.3 });
        k.paint(k.mask().cap(hx - 6, hy - 3, hx + 6, hy - 4, 1.1, 1), felt, { dir: "v", occ: 0.3 });
        k.R(hx - 4, hy - 4, 8, 1, T.s);
      } else {
        k.R(hx - 4, hy - 3, 9, 1, T.m);
        k.px(hx + 4, hy - 3, T.l);
        k.px(hx - 5, hy - 2, T.s);
      }
    }
    // pírko v barvě týmu (u kapuce i klobouku)
    if (V.hat % 3 !== 2) {
      const fe = k.mask().cap(hx - 2, hy - 5, hx - 9, hy - 8 + fl, 1.3, 0.6);
      k.paint(fe, teamR(T), { occ: 0.35 });
      k.L(hx - 3, hy - 5, hx - 8, hy - 7 + fl, T.d);
    }
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
    arm(k, lx, sh + 2, hand[0], hand[1], { ramp: pv, r0: 1.9, r1: 1.6, cuff: R.leather, len: draw ? 4.6 : 5.6 });

    k.meta.head = [hx / HD, hy / HD];
  }

  /* ================= HRDINA: PĚŠÍ RYTÍŘ =================
   * Plátová zbroj, uzavřená přilba se zlatou korunkou a týmovým chocholem,
   * velký štít s Ringem, dlouhý meč. Vlastní pózy schopností:
   * cast = bojový pokřik (meč nad hlavu), guard = štítová zeď (štít vpřed, přikrčený),
   * lunge = výpad (předklon, bodnutí vpřed). */
  function drawHero(k) {
    const { T, pose: p } = k;
    const dy = p.dy;
    const lx = p.lx;
    const hipY = -14 + dy;
    const sh = -28 + dy;
    const fl = p.cape;
    const lean = p.sw === "thrust" || p.sw === "thrust0" ? 2 : 0; // předklon trupu při výpadu

    // plášť v barvě týmu se zlatým lemem (při výpadu vlaje víc dozadu)
    const flow = lean ? 4 : 0;
    const cape = k.mask().poly([
      [lx - 4 + lean, sh - 1], [lx + 1 + lean, sh], [lx - 5, -3 + fl], [lx - 13 - fl - flow, -6 + fl * 2 - flow], [lx - 9 - flow, sh + 6]
    ]);
    k.paint(cape, teamRD(T), { dir: "h", tex: (x, y, t, c) => ((x - y) % 5 === 0 && t === 1 ? T.d : c) });
    k.L(lx - 13 - fl - flow, -6 + fl * 2 - flow, lx - 5, -3 + fl, C.gold[1]);
    k.L(lx - 12 - fl - flow, -7 + fl * 2 - flow, lx - 6, -4 + fl, mix(C.gold[1], T.m, 0.5));

    // meč: úchop [x, y] a úhel čepele podle pózy
    const SW = {
      idle: [lx + 9, sh + 12, -1.3],
      back: [lx + 3, sh - 3, -2.05],
      strike: [lx + 12, sh + 9, -0.05],
      low: [lx + 11, sh + 13, 0.7],
      up: [lx + 4, sh - 7, -1.62],
      flare: [lx + 5, sh - 10, -1.5],
      fwd: [lx + 13, sh + 1, -0.55],
      guard0: [lx + 6, sh + 12, -0.95],
      guard: [lx + 4, sh + 13, -0.6],
      thrust0: [lx + 10, sh + 8, -0.2],
      thrust: [lx + 16, sh + 7, -0.02]
    };
    // štít: střed a o kolik je vysunutý vpřed (guard = zeď)
    const SH = {
      idle: [lx - 2, sh + 10], back: [lx - 3, sh + 10], strike: [lx, sh + 10], low: [lx, sh + 11],
      up: [lx - 3, sh + 11], flare: [lx - 3, sh + 11], fwd: [lx - 2, sh + 10],
      guard0: [lx + 4, sh + 9], guard: [lx + 7, sh + 9],
      thrust0: [lx + 1, sh + 9], thrust: [lx + 2, sh + 9]
    };

    const [gx, gy0, ga] = posed(SW, p);
    const gy = gy0 + (p.step >= 0 ? (p.step % 3 === 1 ? 1 : 0) : 0);
    const [sx0, sy0] = posed(SH, p);
    const sx = sx0 + (p.swing || 0) * -0.5;
    const sy = sy0;
    const wall = p.sw === "guard" || p.sw === "guard0";

    // vzdálená paže drží štít (kreslí se před nohama, štít až po trupu)
    leg(k, lx - 2 + lean, hipY, lx + p.fb[0], p.fb[1], { ramp: R.steelD, boot: R.steelD, bootH: 6, cuff: C.gold[0], len: 5.9 });
    leg(k, lx + 2 + lean, hipY, lx + p.ff[0], p.ff[1], { ramp: R.steel, boot: R.steelD, bootH: 6, knee: S[6], cuff: C.gold[1], len: 5.9 });

    const tx = lx + lean;
    // plátový kyrys
    const torso = k.mask().poly([
      [tx - 6, sh], [tx + 5, sh], [tx + 7, sh + 5], [tx + 6, hipY + 1], [tx - 6, hipY + 1], [tx - 7, sh + 4]
    ]);
    k.paint(torso, R.steel, { tex: (x, y, t, c) => ((y - sh) % 4 === 3 && t > 0 ? mix(c, C.shade, 0.25) : c) });
    // týmový varkoč přes kyrys
    const tab = k.mask().poly([[tx - 4, sh + 3], [tx + 5, sh + 3], [tx + 6, hipY + 6], [tx - 5, hipY + 6]]);
    k.paint(tab, teamR(T), { dir: "h", occ: 0.3 });
    k.L(tx, hipY + 2, tx, hipY + 6, T.d);
    k.L(tx + 3, hipY + 2, tx + 4, hipY + 6, T.s);
    k.ring(tx + 0.5, sh + 7, 2.6, C.gold[1]);
    k.px(tx, sh + 7, C.a[3]);
    // pás se zlatou přezkou
    k.R(tx - 6, hipY - 1, 13, 2, C.w[1]);
    k.R(tx - 6, hipY - 1, 13, 1, C.w[2]);
    k.R(tx + 1, hipY - 1, 2, 2, C.gold[1]);
    k.px(tx + 1, hipY - 1, C.gold[2]);

    // uzavřená přilba (hrnec) s průzorem, zlatá korunka hrdiny, chochol
    const hx = tx + 1;
    const hy = sh - 6;
    const helm = k.mask().poly([[hx - 5, hy - 5], [hx + 4, hy - 5], [hx + 5, hy - 2], [hx + 5, hy + 4], [hx + 2, hy + 5], [hx - 5, hy + 5], [hx - 6, hy]]);
    k.paint(helm, R.steel, { occ: 0.35 });
    k.R(hx, hy - 1, 6, 1, C.ink); // průzor
    k.px(hx + 3, hy - 1, C.a[3]); // žhnoucí oko za hledím
    k.R(hx, hy, 5, 1, S[2]);
    k.L(hx + 1, hy + 1, hx + 1, hy + 4, S[2]);
    for (const [ox, oy] of [[3, 2], [3, 4], [5, 3]]) k.px(hx + ox, hy + oy, S[1]);
    k.px(hx - 3, hy - 4, S[6]);
    k.px(hx - 4, hy - 3, C.white);
    // korunka
    k.R(hx - 5, hy - 6, 10, 1, C.gold[1]);
    k.R(hx - 5, hy - 5, 10, 1, C.gold[0]);
    for (const ox of [-5, -2, 1, 4]) k.px(hx + ox, hy - 7, C.gold[2]);
    k.px(hx - 1, hy - 6, C.a[4]);
    // chochol v barvě týmu
    const pl = fl + (lean ? 2 : 0);
    const plume = k.mask()
      .cap(hx - 1, hy - 8, hx + 2, hy - 10, 1.6, 1.4)
      .cap(hx - 1, hy - 8, hx - 7, hy - 7 + pl, 1.9, 1.3)
      .cap(hx - 7, hy - 7 + pl, hx - 11, hy - 2 + pl, 1.3, 0.8);
    k.paint(plume, teamR(T), { occ: 0.3 });
    k.L(hx + 1, hy - 10, hx - 6, hy - 8 + pl, T.h);

    // velký štít (kite) s Ringem; při štítové zdi je vysunutý a kryje celé tělo
    const sw = wall ? 8.5 : 7.5;
    const shH = wall ? 11 : 9.5;
    const shield = k.mask().poly([
      [sx - sw, sy - shH * 0.75], [sx + sw, sy - shH * 0.75], [sx + sw * 0.9, sy + shH * 0.15], [sx, sy + shH], [sx - sw * 0.9, sy + shH * 0.15]
    ]);
    k.paint(shield, teamR(T), {
      occ: 0.45,
      tex: (x, y, t, c) => {
        const ex = Math.abs(x - sx) > sw - 1.5 || y < sy - shH * 0.75 + 1.5;
        return ex ? ((x - sx) + (y - sy) < 0 ? C.gold[2] : C.gold[0]) : c;
      }
    });
    k.ring(sx, sy - 1, 3.4, C.gold[1]);
    k.ring(sx + 0.5, sy - 0.5, 3.4, mix(C.gold[1], C.ink, 0.6));
    k.ring(sx, sy - 1, 3.4, C.gold[2]);
    k.px(sx, sy - 1, C.a[3]);
    k.L(sx - sw + 2, sy - shH * 0.75 + 2, sx - sw + 3, sy + 1, T.h);

    // meč v přední ruce: dlouhá čepel, zlatá záštita a hlavice
    blade(k, gx + Math.cos(ga) * 2, gy + Math.sin(ga) * 2, ga, 16, { w: 2, taper: true });
    const nx = -Math.sin(ga);
    const ny = Math.cos(ga);
    k.L(gx + Math.cos(ga) * 2 + nx * 3, gy + Math.sin(ga) * 2 + ny * 3, gx + Math.cos(ga) * 2 - nx * 3, gy + Math.sin(ga) * 2 - ny * 3, C.gold[1]);
    k.px(gx + Math.cos(ga) * 2 + nx * 3, gy + Math.sin(ga) * 2 + ny * 3, C.gold[2]);
    k.px(gx - Math.cos(ga) * 2, gy - Math.sin(ga) * 2, C.gold[2]);
    if (p.sw === "strike") smear(k, tx + 2, gy + 1, 19, -2.0, -0.2, S[6], mix(S[4], T.l, 0.35));
    if (p.sw === "thrust") {
      // bodnutí: rovné šmouhy za čepelí
      for (const oy of [-2, 0, 2]) k.L(gx - 10, gy + oy, gx - 3, gy + oy, oy ? mix(S[4], C.white, 0.3) : S[6]);
    }
    if (p.sw === "flare") {
      // čepel nad hlavou se zablýskne
      const tip = [gx + Math.cos(ga) * 18, gy + Math.sin(ga) * 18];
      for (const [ox, oy] of [[0, -2], [0, 2], [-2, 0], [2, 0]]) k.px(tip[0] + ox, tip[1] + oy, C.a[4]);
    }

    // přední nárameník a paže
    arm(k, tx + 2, sh + 2, gx, gy, { ramp: R.steelD, r0: 2.1, r1: 1.8, hand: R.steelD, cuff: R.gold, len: 6.2 });
    const pad = k.mask().ell(tx + 2, sh + 1.5, 4.5, 3.2, (x, y) => y < sh + 4);
    k.paint(pad, R.steel, { occ: 0.4 });
    k.R(tx - 1, sh + 3, 7, 1, C.gold[0]);
    k.px(tx + 1, sh - 1, C.white);

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
    // varianta: dva rohy, železný hřeben s ostny, nebo jeden ulomený roh
    const hv = k.V.hat % 3;
    if (hv === 1) {
      const crest = k.mask().poly([[hx - 5, hy - 4], [hx + 3, hy - 4], [hx + 1, hy - 7], [hx - 4, hy - 7]]);
      for (const x of [-4, -2, 0, 2]) crest.poly([[hx + x - 1, hy - 7], [hx + x + 1, hy - 7], [hx + x, hy - 10]]);
      k.paint(crest, R.iron, { occ: 0.3 });
      k.px(hx, hy - 10, C.r[4]);
    } else {
      const horns = k.mask()
        .cap(hx - 4, hy - 4, hx - 8, hy - 7, 1.4, 1.1)
        .cap(hx - 8, hy - 7, hx - 7, hy - 11, 1.1, 0.5)
        .cap(hx + 3, hy - 4, hx + 6, hy - 7, 1.3, 1);
      if (hv === 0) horns.cap(hx + 6, hy - 7, hx + 5, hy - 10, 1, 0.5);
      k.paint(horns, R.bone, { occ: 0.3, tex: (x, y, t, c) => (y % 2 === 0 && t === 1 ? R.bone[2] : c) });
      if (hv === 2) k.px(hx + 6, hy - 7, C.bone[2]);
    }

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
  // odstín hnijícího masa podle varianty: zelenavý, mrtvolně modrý, zemitý
  const GHOUL_TONES = [
    [R.rot, R.rotD],
    [ramp(0xa4b4c0, 0x7c8ea0, 0x58687e, 0x3a4658), ramp(0x7c8ea0, 0x58687e, 0x3a4658, 0x232a38)],
    [ramp(0xb8a888, 0x948464, 0x6c5e48, 0x473d30), ramp(0x948464, 0x6c5e48, 0x473d30, 0x2b241c)]
  ];

  function drawGhoul(k) {
    const { T, pose: p } = k;
    const dy = p.dy;
    const lx = p.lx;
    const hipY = -10 + dy;
    const fl = p.cape;
    const [rot, rotD] = GHOUL_TONES[k.V.tone];

    // zadní paže visí dolů s drápy
    const bh = p.sw === "back" ? [lx - 6, hipY - 2] : [lx - 1 - (p.swing || 0) * 3, hipY + 6];
    arm(k, lx - 2, hipY - 10, bh[0], bh[1], { ramp: rotD, r0: 1.7, r1: 1.4, hand: rotD, len: 6.5 });
    for (const o of [-1, 1]) k.L(bh[0], bh[1] + 1, bh[0] + 2, bh[1] + 3 + o, C.bone[1]);

    leg(k, lx - 3, hipY, lx - 1 + p.fb[0], p.fb[1], { ramp: rotD, boot: rotD, bare: true, len: 5.2, r0: 2.2, r1: 1.5, r2: 1.3 });
    leg(k, lx + 1, hipY, lx + 3 + p.ff[0], p.ff[1], { ramp: rot, boot: rot, bare: true, len: 5.2, r0: 2.2, r1: 1.5, r2: 1.3 });

    // shrbený trup
    const torso = k.mask().poly([
      [lx - 7, hipY + 1], [lx + 4, hipY + 1], [lx + 9, hipY - 8], [lx + 5, hipY - 15], [lx - 3, hipY - 16], [lx - 8, hipY - 10]
    ]);
    k.paint(torso, rot);
    // páteř
    for (let i = 0; i < 4; i++) {
      const x = lx - 5 + i * 2.5;
      const y = hipY - 12 - i * 1.2;
      k.px(x, y, C.bone[0]);
      k.px(x + 1, y, C.bone[1]);
    }
    // žebra
    for (const y of [-11, -8, -5]) {
      k.L(lx, hipY + y, lx + 5, hipY + y - 1, rot[3]);
      k.L(lx, hipY + y - 1, lx + 4, hipY + y - 2, rot[0]);
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
    k.paint(head, rot, { occ: 0.3 });
    // tlama
    k.L(hx + 1, hy + 2, hx + 6, hy + 2, C.r[0]);
    k.L(hx + 1, hy + 3, hx + 5, hy + 3, C.r[1]);
    k.px(hx + 2, hy + 2, C.bone[0]);
    k.px(hx + 4, hy + 2, C.bone[0]);
    k.px(hx + 3, hy + 3, C.bone[1]);
    k.px(hx + 5, hy + 3, C.bone[0]);
    // vpadlá očnice se žhavou štěrbinou
    k.R(hx + 1, hy - 2, 4, 2, rot[3]);
    emberEye(k, hx + 3, hy - 1);
    k.meta.eye = [(hx + 3) / HD, (hy - 1) / HD];
    // řídké vlasy
    k.L(hx - 3, hy - 3, hx - 6, hy - 1 + fl, C.h[3]);
    k.L(hx - 2, hy - 4, hx - 5, hy - 4 + fl, C.h[4]);

    // přední paže s dlouhými drápy
    const HAND = { idle: [lx + 10, hipY - 1], back: [lx + 1, hipY - 21], strike: [lx + 17, hipY - 9], low: [lx + 14, hipY] };
    const hp = reach(lx + 4, hipY - 12, ...posed(HAND, p, null, [lx + 10 + (p.swing || 0) * 2, hipY - 1]), 13);
    arm(k, lx + 4, hipY - 12, hp[0], hp[1], { ramp: rot, r0: 1.8, r1: 1.4, hand: rot, len: 6.6 });
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

    // varianta: rezavý železný klobouk, nebo ulomená čelist
    if (k.V.hat % 3 === 1) {
      const rust = ramp(0xb8784a, 0x8a5434, 0x5e3826, 0x3c2418);
      k.paint(k.mask().ell(hx - 0.5, hy - 3.5, 4.8, 3, (x, y) => y < hy - 2.5), rust, { occ: 0.3, tex: (x, y, t, c) => ((x * 3 + y) % 5 === 0 ? mix(c, C.r[2], 0.4) : c) });
      k.paint(k.mask().cap(hx - 6, hy - 3, hx + 6, hy - 2, 1, 1), rust, { dir: "v", occ: 0.3 });
      k.px(hx - 3, hy - 5, 0xd09a6a);
    } else if (k.V.hat % 3 === 2) {
      k.R(hx + 1, hy + 3, 5, 2, C.ink);
      k.L(hx + 2, hy + 5, hx + 5, hy + 6, C.bone[1]);
      k.px(hx + 3, hy + 6, C.bone[2]);
    }

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

  /* ================= MNICH ================= */
  // hnědá kutna, týmová štóla, hůl se zlomeným prstenem (znak říše), který při požehnání zazáří
  const HABIT = ramp(C.w[3], C.w[2], C.w[1], C.w[0]);
  const HABIT_D = ramp(C.w[2], C.w[1], C.w[0], mix(C.w[0], C.ink, 0.3));

  function drawMonk(k) {
    const { T, pose: p } = k;
    const dy = p.dy;
    const lx = p.lx;
    const hipY = -12 + dy;
    const sh = -24 + dy;
    const sway = Math.round((p.swing || 0) * 1.5);
    const bless = p.sw === "strike" || p.sw === "low";

    // hůl: úchop (od ramene), úhel násady (k prstenu)
    const ST = {
      idle: [8, 11, -1.57], back: [7, 4, -1.75], strike: [11, 6, -1.15], low: [10, 9, -1.35]
    };
    const st = posed(ST, p);
    const sgx = lx + st[0];
    const sgy = sh + st[1];
    const sdx = Math.cos(st[2]);
    const sdy = Math.sin(st[2]);
    const sTop = [sgx + sdx * 17, sgy + sdy * 17];
    const sBot = [sgx - sdx * 14, Math.min(-1, sgy - sdy * 14)];

    // vzdálená paže: dlaň před hrudí (modlitba), při chůzi se kývá
    arm(k, lx - 1, sh + 2, lx + 3 - (p.swing || 0) * 2, sh + 9, { ramp: HABIT_D, r0: 2, r1: 1.7, hand: k.sk, len: 5.2 });

    // sandály pod kutnou
    leg(k, lx - 2, hipY, lx + p.fb[0], p.fb[1], { ramp: HABIT_D, boot: R.leather, bootH: 2, len: 5.2, bare: true });
    leg(k, lx + 2, hipY, lx + p.ff[0], p.ff[1], { ramp: HABIT, boot: R.leather, bootH: 2, len: 5.2, bare: true });

    // kutna až ke kotníkům, lem se při kroku vlní
    const hem = -3 - Math.max(p.ff[1], p.fb[1]) * 0.5;
    const robe = k.mask().poly([
      [lx - 5, sh - 1], [lx + 4, sh - 1], [lx + 6, sh + 5], [lx + 7 + sway, hem], [lx + 2, hem + 1], [lx - 3, hem + 1], [lx - 8 + sway, hem - 1], [lx - 6, sh + 4]
    ]);
    k.paint(robe, HABIT, { tex: (x, y, t, c) => ((x - lx + 40) % 4 === 1 && y > hipY && t === 1 ? HABIT[2] : c) });
    k.L(lx - 2, hipY + 2, lx - 3 + sway, hem - 1, HABIT[3]);
    k.L(lx + 3, hipY + 3, lx + 4 + sway, hem, HABIT[2]);
    // štóla v barvě týmu, zlatá třásněmi
    const stole = k.mask().poly([[lx + 1, sh], [lx + 4, sh], [lx + 5, hipY + 6], [lx + 2, hipY + 6]]);
    k.paint(stole, teamR(T), { dir: "h", occ: 0.3 });
    k.L(lx + 2, hipY + 7, lx + 5, hipY + 7, C.gold[1]);
    k.ring(lx + 3, sh + 5, 1.6, T.accent, false);
    // provazový pás s uzly
    k.R(lx - 6, hipY - 1, 13, 1, C.d[4]);
    k.R(lx - 6, hipY, 13, 1, C.d[2]);
    k.L(lx - 4, hipY + 1, lx - 5 + sway, hipY + 6, C.d[3]);
    k.px(lx - 5 + sway, hipY + 6, C.d[4]);
    k.px(lx - 4, hipY + 3, C.d[4]);

    // kápě spadlá na ramena
    const cowl = k.mask().ell(lx - 1, sh + 0.5, 6, 2.6).ell(lx - 5, sh - 2, 2.6, 3);
    k.paint(cowl, HABIT, { occ: 0.35 });

    // hlava s tonzurou a krátkým šedým vousem
    const hx = lx + 1;
    const hy = sh - 6;
    k.paint(k.mask().ell(hx, hy, 4.4, 4.9), k.sk, { occ: 0.3 });
    const fringe = k.mask().ell(hx - 0.5, hy - 1.5, 4.8, 3.2, (x, y) => y >= hy - 2 && x < hx + 2);
    k.paint(fringe, k.V.beard === 2 ? k.V.hair : ramp(S[5], S[4], S[3], S[2]), { occ: 0.2 });
    k.paint(k.mask().ell(hx, hy - 3, 3.2, 1.6), k.sk, { occ: 0 });
    k.px(hx - 1, hy - 4, mix(k.sk[1], C.white, 0.5));
    eye(k, hx + 2, hy, S[3]);
    k.px(hx + 5, hy + 1, k.sk[2]);
    // vous podle varianty: 1 krátký šedý (původní), 2 tmavý, 3 dlouhý bílý, 0 oholený
    const mb = k.V.beard;
    if (mb) {
      const long = mb === 3;
      const beard = k.mask().poly([[hx, hy + 2], [hx + 5, hy + 2], [hx + 4, hy + (long ? 8 : 5)], [hx + 1, hy + (long ? 10 : 6)]]);
      k.paint(beard, mb === 2 ? k.V.hair : mb === 3 ? ramp(C.white, S[6], S[5], S[4]) : ramp(S[6], S[5], S[4], S[3]), { occ: 0.25 });
      k.px(hx + 3, hy + 3, k.sk[3]);
    }

    // hůl a prsten
    k.L(sBot[0], sBot[1], sTop[0], sTop[1], C.w[3]);
    k.L(sBot[0] + 1, sBot[1], sTop[0] + 1, sTop[1], C.w[1]);
    k.px(sBot[0], sBot[1], C.w[0]);
    const rx = sTop[0] + sdx * 3.5;
    const ry = sTop[1] + sdy * 3.5;
    k.ring(rx + 0.5, ry + 0.5, 3.6, mix(C.gold[0], C.ink, 0.4));
    k.ring(rx, ry, 3.6, bless ? C.a[4] : C.gold[1]);
    k.ring(rx, ry, 2.6, bless ? C.a[3] : C.gold[0]);
    k.px(rx - 2, ry - 2, C.white);
    if (bless) {
      // požehnání: jiskry kolem prstenu
      for (const [ox, oy, c] of [[-6, -1, C.a[3]], [5, -5, C.a[4]], [6, 2, C.a[2]], [0, -7, C.a[4]], [-4, 5, C.a[2]]]) k.px(rx + ox, ry + oy, c);
    }
    k.meta.halo = [rx / HD, ry / HD, bless ? 1 : 0];

    // přední paže drží hůl
    arm(k, lx + 2, sh + 2, sgx, sgy, { ramp: HABIT, r0: 2.1, r1: 1.8, hand: k.sk, len: 5.4 });

    k.meta.head = [hx / HD, hy / HD];
  }

  /* ================= RYTÍŘ NA KONI ================= */
  // kaštanový kůň v týmovém čabraku, rytíř ve velké přilbě s kopím; útok = sklopené kopí (nápor)
  const HORSE = ramp(mix(C.w[4], C.d[4], 0.3), C.w[3], C.w[2], C.w[1]);
  const HORSE_D = ramp(C.w[3], C.w[2], C.w[1], C.w[0]);
  const MANE = ramp(C.w[1], C.w[0], mix(C.w[0], C.ink, 0.35), C.ink);
  // srst koně podle varianty: ryzák (původní), bělouš, vraník, plavák
  const COATS = [
    [HORSE, HORSE_D, MANE],
    [ramp(0xf0ece4, 0xc8c4c0, 0x9a96a0, 0x6e6a78), ramp(0xc8c4c0, 0x9a96a0, 0x6e6a78, 0x4a4656), ramp(0xe8e4dc, 0xb0aab0, 0x7a7484, 0x4a4656)],
    [ramp(0x5a5060, 0x3a3240, 0x262030, 0x161220), ramp(0x3a3240, 0x262030, 0x181420, 0x0e0c14), ramp(0x262030, 0x161220, 0x0e0c14, C.ink)],
    [ramp(0xf0d8a0, 0xd8b474, 0xa88850, 0x7a6038), ramp(0xd8b474, 0xa88850, 0x7a6038, 0x544028), ramp(C.d[5], 0xe8e0c8, 0xb8ac90, 0x807458)]
  ];

  function drawKnight(k) {
    const { T, pose: p } = k;
    const anim = p.anim;
    // zvěd = lehký jezdec: bez čabraku a štítu, kožená kazajka, šavle místo kopí
    const scout = k.type === "scout";
    const [HORSE, HORSE_D, MANE] = COATS[k.V.coat % COATS.length];
    const walk = anim === "walk";
    const ph = walk ? (p.i / 6) * Math.PI * 2 : 0;
    const lunge = anim === "attack" ? Math.round((p.lx || 0) * 0.6) : 0;
    const bx = -1 + lunge;
    const by = -21 + (walk ? Math.round(Math.sin(ph * 2 + 0.6)) : anim === "idle" ? p.dy : 0);
    const flick = walk ? Math.round(Math.sin(ph) * 1.5) : p.cape || 0;

    // nohy: [kyčel x, fáze, přední?, vzdálená?]
    const LEGS = [[bx - 9, Math.PI, false, true], [bx + 8, 0, true, true], [bx - 11, 0, false, false], [bx + 10, Math.PI, true, false]];
    const horseLeg = ([hx, off, front, far]) => {
      const s = Math.sin(ph + off);
      const c = Math.cos(ph + off);
      const fx = hx + (walk ? s * 6 : front ? 1 : -1) + (anim === "attack" && front ? 2 : 0);
      const lift = walk ? Math.max(0, c) * 4 : 0;
      const top = by + 3;
      const [kx, ky] = ik(hx, top, fx, -2 - lift, 8, 8, front ? 1 : -1);
      const rp = far ? HORSE_D : HORSE;
      const m = k.mask().cap(hx, top - 1, kx, ky, front ? 3 : 3.6, 1.6).cap(kx, ky, fx, -2 - lift, 1.5, 1.3);
      k.paint(m, rp, { dir: "h", occ: 0.35 });
      // kopyto se spěnkou
      const hfx = Math.round(fx);
      k.paint(k.mask().rect(hfx - 2, -2 - Math.round(lift), 4, 2), ramp(S[3], C.b[3], C.b[2], C.b[1]), { dir: "v", occ: 0.3 });
      k.px(hfx - 2, -3 - Math.round(lift), far ? MANE[1] : mix(C.w[4], C.white, 0.3));
    };

    // vzdálené nohy a ohon za tělem
    horseLeg(LEGS[0]);
    horseLeg(LEGS[1]);
    const tail = k.mask().cap(bx - 13, by - 3, bx - 17, by + 2 + flick, 2.2, 1.8).cap(bx - 17, by + 2 + flick, bx - 18 - flick, by + 10, 1.8, 0.9);
    k.paint(tail, MANE, { occ: 0.3, tex: (x, y, t, c) => ((x + y) % 3 === 0 && t === 1 ? MANE[0] : c) });

    // trup koně, hruď a krk s hlavou
    const body = k.mask().ell(bx, by, 13, 6).ell(bx - 9, by - 1, 6.5, 6.3).ell(bx + 8, by - 0.5, 6.3, 6.5);
    k.paint(body, HORSE, { occ: 0.3 });
    const neckTop = [bx + 15, by - 13];
    const neck = k.mask().cap(bx + 8, by - 2, neckTop[0], neckTop[1], 5.6, 3.9);
    k.paint(neck, HORSE, { occ: 0.35 });
    const head = k.mask().cap(neckTop[0], neckTop[1] - 1, bx + 22, by - 6, 3.7, 2.4);
    k.paint(head, HORSE, { occ: 0.35 });
    // ucho, oko, nozdra, lysina
    k.paint(k.mask().poly([[neckTop[0] - 2, neckTop[1] - 3], [neckTop[0], neckTop[1] - 3], [neckTop[0] - 2, neckTop[1] - 7]]), HORSE, { occ: 0.3 });
    k.px(neckTop[0] + 1, neckTop[1] - 1, EYE);
    k.px(bx + 22, by - 6, MANE[2]);
    k.L(neckTop[0] + 2, neckTop[1] - 3, bx + 21, by - 7, mix(C.d[5], C.white, 0.5));
    // hříva
    const mane = k.mask().cap(neckTop[0] - 1, neckTop[1] - 2, bx + 7, by - 6 - flick * 0.5, 1.7, 1.4);
    k.paint(mane, MANE, { occ: 0.3 });
    // uzda v barvě týmu
    k.L(neckTop[0] + 1, neckTop[1] + 1, bx + 19, by - 5, T.d);
    k.L(neckTop[0] - 1, neckTop[1] - 2, neckTop[0] + 1, neckTop[1] + 2, C.w[1]);
    k.px(bx + 19, by - 5, C.gold[1]);

    if (!scout) {
      // čabrak: týmové sukno přes trup se zubatým lemem a znakem
      const capar = k.mask().poly([
        [bx - 12, by - 6], [bx + 7, by - 6], [bx + 9, by + 1], [bx + 8, by + 8], [bx - 13, by + 8], [bx - 14, by]
      ]);
      k.paint(capar, teamR(T), { dir: "v", occ: 0.3, tex: (x, y, t, c) => ((x - bx + 40) % 6 === 0 && y > by && t === 1 ? T.s : c) });
      for (let x = bx - 13; x <= bx + 8; x++) {
        const tooth = ((x - bx + 40) % 4) < 2;
        k.px(x, by + 8, tooth ? T.accent : T.d);
        if (tooth) k.px(x, by + 9, mix(T.accent, C.ink, 0.35));
      }
      k.ring(bx - 3, by + 1, 3, T.accent);
      k.ring(bx - 2.5, by + 1.5, 3, mix(T.accent, C.ink, 0.55));
      k.ring(bx - 3, by + 1, 3, T.accent);
    } else {
      // sedlová dečka v barvě týmu s třásněmi a podpěnka
      const pad = k.mask().poly([[bx - 7, by - 6], [bx + 4, by - 6], [bx + 5, by + 1], [bx - 8, by + 1]]);
      k.paint(pad, teamR(T), { dir: "v", occ: 0.3 });
      for (let x = bx - 8; x <= bx + 5; x += 2) k.px(x, by + 2, T.accent);
      k.L(bx - 8, by + 1, bx + 5, by + 1, T.d);
      // řemení přes hruď koně
      k.L(bx + 5, by - 3, bx + 12, by - 1, C.w[1]);
      k.px(bx + 9, by - 2, C.gold[1]);
    }
    // blízké nohy před čabrakem
    horseLeg(LEGS[2]);
    horseLeg(LEGS[3]);

    // sedlo
    k.paint(k.mask().ell(bx - 1, by - 6, 5, 1.6), R.leather, { occ: 0.3 });
    k.px(bx - 5, by - 7, C.w[4]);

    const SABRE = {
      idle: [bx + 6, by - 11, -1.05], back: [bx + 1, by - 20, -2.5], strike: [bx + 10, by - 11, 0.3], low: [bx + 9, by - 8, 0.95], up: [bx + 4, by - 22, -1.5]
    };
    const LANCE_T = {
      idle: [bx + 5, by - 12, -1.2], back: [bx + 3, by - 14, -1.35],
      strike: [bx + 7, by - 11, 0.02], low: [bx + 6, by - 10, 0.18], up: [bx + 4, by - 13, -1.5]
    };
    const [gx, gy, ga] = posed(scout ? SABRE : LANCE_T, p);
    if (scout) {
      // šavle: mírně zahnutá čepel, záštita, při seku srpek
      const tipS = blade(k, gx + Math.cos(ga) * 2, gy + Math.sin(ga) * 2, ga, 12, { w: 2, taper: true });
      const nxs = -Math.sin(ga);
      const nys = Math.cos(ga);
      k.px(tipS[0] + nxs, tipS[1] + nys, S[5]);
      k.L(gx + Math.cos(ga) * 2 + nxs * 2, gy + Math.sin(ga) * 2 + nys * 2, gx + Math.cos(ga) * 2 - nxs * 2, gy + Math.sin(ga) * 2 - nys * 2, C.gold[1]);
      if (p.sw === "strike") smear(k, bx + 2, by - 12, 13, -1.9, 0.3, S[6], mix(S[4], T.l, 0.35));
    } else {
      // kopí: úchop, úhel; vzadu přečnívá ratiště
      const LANCE = {
        idle: [bx + 5, by - 12, -1.2], back: [bx + 3, by - 14, -1.35],
        strike: [bx + 7, by - 11, 0.02], low: [bx + 6, by - 10, 0.18]
      };
      
      const ldx = Math.cos(ga);
      const ldy = Math.sin(ga);
      const tip = [gx + ldx * 23, gy + ldy * 23];
      const butt = [gx - ldx * 7, gy - ldy * 7];
      k.L(butt[0], butt[1], tip[0], tip[1], C.w[3]);
      k.L(butt[0] + (ldy > -0.5 ? 0 : 1), butt[1] + (ldy > -0.5 ? 1 : 0), tip[0] - ldx * 4 + (ldy > -0.5 ? 0 : 1), tip[1] - ldy * 4 + (ldy > -0.5 ? 1 : 0), C.w[1]);
      // hrot a vamplát (kuželová ochrana ruky)
      k.L(tip[0] - ldx * 3, tip[1] - ldy * 3, tip[0], tip[1], S[5]);
      k.px(tip[0], tip[1], C.white);
      const vx = gx + ldx * 3;
      const vy = gy + ldy * 3;
      k.paint(k.mask().cap(vx - ldx * 1.5, vy - ldy * 1.5, vx + ldx * 2, vy + ldy * 2, 2.6, 1), R.steel, { occ: 0.3 });
      // praporec pod hrotem vlaje dozadu
      const px0 = tip[0] - ldx * 5;
      const py0 = tip[1] - ldy * 5;
      const wave = walk ? Math.round(Math.sin(ph * 2)) : 0;
      const flagM = k.mask().poly([
        [px0, py0], [px0 - ldx * 5, py0 - ldy * 5], [px0 - ldx * 2 - 7, py0 - ldy * 2 + 2 + wave], [px0 - 8, py0 + wave - 1]
      ]);
      k.paint(flagM, teamR(T), { occ: 0.3 });
      if (p.sw === "strike") {
        // nápor: řídká stopa vzduchu nad a pod hrotem
        for (let i = 0; i < 8; i += 2) {
          k.px(tip[0] - 4 - i, tip[1] - 2, mix(C.white, T.l, 0.3));
          k.px(tip[0] - 7 - i, tip[1] + 2, mix(C.white, T.l, 0.5));
        }
      }
    }
    // jezdec: vzdálená (pravá) paže s kopím
    const rsh = [bx + 1, by - 15];
    arm(k, rsh[0], rsh[1], gx, gy, { ramp: scout ? R.leather : R.steelD, r0: 2, r1: 1.7, hand: R.leather, len: 5.4 });

    // trup: kroužková košile a tabard
    const sY = by - 17;
    const wY = by - 6;
    const torso = k.mask().poly([[bx - 5, sY], [bx + 4, sY], [bx + 5, sY + 4], [bx + 4, wY], [bx - 4, wY], [bx - 6, sY + 3]]);
    if (scout) {
      k.paint(torso, R.leatherL, { tex: (x, y, t, c) => ((x + y) % 5 === 0 && t === 1 ? R.leatherL[2] : c) });
      // šerpa přes rameno
      k.L(bx - 4, sY + 1, bx + 4, wY - 1, T.m);
      k.L(bx - 4, sY + 2, bx + 4, wY, T.s);
    } else {
      k.paint(torso, R.steelD, { tex: (x, y, t, c) => (y % 2 === 0 ? mix(c, C.shade, 0.25) : (x + (y >> 1)) % 2 ? c : mix(c, S[5], 0.2)) });
      const tab = k.mask().poly([[bx - 3, sY + 2], [bx + 4, sY + 2], [bx + 5, wY + 2], [bx - 4, wY + 2]]);
      k.paint(tab, teamR(T), { dir: "h", occ: 0.3 });
    }
    k.R(bx - 4, wY - 1, 10, 1, C.w[1]);
    k.px(bx + 1, wY - 1, C.gold[1]);

    // blízká noha ve třmenu
    const hip = [bx + 1, wY];
    const knee = [bx + 5, by - 3];
    const foot = [bx + 3, by + 4];
    k.paint(k.mask().cap(hip[0], hip[1], knee[0], knee[1], 2.4, 2).cap(knee[0], knee[1], foot[0], foot[1], 2, 1.7), scout ? CLOTHS[2] : R.steel, { occ: 0.35 });
    k.paint(k.mask().rect(foot[0] - 1, foot[1] - 1, 5, 2), R.leather, { dir: "v", occ: 0.3 });
    k.px(knee[0] + 1, knee[1] - 1, S[6]);
    k.L(foot[0] - 1, foot[1] + 1, foot[0] + 3, foot[1] + 1, C.gold[0]);

    if (scout) {
      // hlava: tvář, vlasy, kožená čapka s týmovým pérem; vzadu přes záda luk? jen roh na řemeni
      const hx = bx;
      const hy = sY - 5;
      const fl = p.cape || 0;
      k.paint(k.mask().ell(hx + 0.5, hy + 0.5, 3.8, 4.4), k.sk, { occ: 0.3 });
      eye(k, hx + 2, hy, k.V.hair[2]);
      k.px(hx + 4, hy + 1, k.sk[2]);
      if (k.V.beard >= 2) beardOf(k, hx - 0.5, hy - 0.5, { ...k.V, beard: 2 });
      k.paint(k.mask().ell(hx - 2, hy, 2.4, 3.4), k.V.hair, { occ: 0.3 });
      const capM = k.mask().ell(hx, hy - 3, 4.2, 2.6, (x, y) => y < hy - 1.5);
      k.paint(capM, R.leather, { occ: 0.3 });
      k.L(hx - 4, hy - 2, hx + 4, hy - 2, T.s);
      const fe = k.mask().cap(hx - 2, hy - 4, hx - 8, hy - 7 + fl + flick, 1.2, 0.5);
      k.paint(fe, teamR(T), { occ: 0.3 });
      k.L(hx - 3, hy - 4, hx - 7, hy - 6 + fl + flick, T.h);
      // roh na řemeni u boku
      k.paint(k.mask().cap(bx - 6, sY + 6, bx - 3, sY + 9, 0.9, 1.6), R.bone, { occ: 0.3 });
      k.meta.head = [hx / HD, hy / HD];
      return;
    }
    {
      // štít (blízká levá paže): kosočtverečný týmový štít
      const sx = bx - 3;
      const sy = by - 8;
      const shield = k.mask().poly([[sx - 4, sy - 4], [sx + 4, sy - 4], [sx + 4, sy + 1], [sx, sy + 6], [sx - 4, sy + 1]]);
      k.paint(shield, teamR(T), {
        occ: 0.45,
        tex: (x, y, t, c) => (shield.has(x - 1, y) && shield.has(x + 1, y) && shield.has(x, y - 1) && shield.has(x, y + 1) ? c : (x < sx ? S[5] : S[2]))
      });
      k.ring(sx, sy - 0.5, 2, T.accent);
      k.px(sx - 3, sy - 3, C.white);

      // hlava ve velké přilbě s týmovým chocholem
      const hx = bx;
      const hy = sY - 5;
      const fl = p.cape || 0;
      const plume = k.mask().cap(hx, hy - 5, hx - 4, hy - 6 + fl, 1.6, 1.2).cap(hx - 4, hy - 6 + fl, hx - 8, hy - 2 + fl + flick, 1.2, 0.7);
      k.paint(plume, teamR(T), { occ: 0.3 });
      const helm = k.mask().rect(hx - 3, hy - 3, 7, 7).ell(hx + 0.5, hy - 3, 3.5, 2.2);
      k.paint(helm, R.steel, { occ: 0.3, dir: "h" });
      k.L(hx + 1, hy - 1, hx + 3, hy - 1, C.ink);
      k.px(hx + 2, hy + 1, S[2]);
      k.px(hx + 3, hy + 2, S[2]);
      k.L(hx + 1, hy - 5, hx + 1, hy + 3, S[5]);
      k.px(hx - 2, hy - 4, C.white);
      k.R(hx - 3, hy + 3, 7, 1, C.gold[0]);
      k.meta.head = [hx / HD, hy / HD];
    }
  }

  /* ================= KATAPULT ================= */
  // dřevěný vůz se čtyřmi koly, torzní rameno s miskou na kámen, týmový praporec a štítek
  const TIMBER = ramp(C.w[4], C.w[3], C.w[2], C.w[1]);
  const TIMBER_D = ramp(C.w[3], C.w[2], C.w[1], C.w[0]);
  const ROCK = ramp(S[5], S[4], S[3], S[2]);

  function drawCatapult(k) {
    const { T, pose: p } = k;
    const anim = p.anim;
    const walk = anim === "walk";
    const spin = walk ? (p.i / 6) * (Math.PI / 2) : 0;
    const shake = p.sw === "back" ? 1 : 0;
    const bob = walk ? (Math.floor(p.i * 2) % 3 === 0 ? -1 : 0) : 0;
    const base = -9 + bob;

    const wheel = (cx, cy, r, far) => {
      const rp = far ? TIMBER_D : TIMBER;
      const rim = k.mask().ell(cx, cy, r, r);
      k.paint(rim, rp, { occ: 0.35 });
      const hole = k.mask().ell(cx, cy, r - 1.6, r - 1.6);
      k.paint(hole, far ? ramp(C.w[1], C.w[0], C.w[0], C.ink) : ramp(C.w[2], C.w[1], C.w[0], C.w[0]), { occ: 0 });
      for (let s = 0; s < 4; s++) {
        const a = spin + s * Math.PI / 2;
        k.L(cx, cy, cx + Math.cos(a) * (r - 1), cy + Math.sin(a) * (r - 1), rp[1]);
      }
      // železná obruč a náboj
      for (let a = 0; a < Math.PI * 2; a += 0.35) k.px(cx + Math.cos(a) * r, cy + Math.sin(a) * r, (a > 2.4 && a < 5.5) ? S[3] : S[2]);
      k.paint(k.mask().ell(cx, cy, 1.4, 1.4), R.iron, { occ: 0 });
    };

    // vzdálená kola
    wheel(-11, -6 + bob, 5.4, true);
    wheel(14, -6 + bob, 5.4, true);

    // rameno: čep, úhel (od čepu k misce)
    const ARM = { idle: [Math.PI + 0.22], back: [Math.PI + 0.08], strike: [Math.PI * 2 - 1.28], low: [Math.PI * 2 - 1.62] };
    const [aa] = posed(ARM, p);
    const pivot = [-5, base - 3];
    const adx = Math.cos(aa);
    const ady = Math.sin(aa);
    const cup = [pivot[0] + adx * 20, pivot[1] + ady * 20];
    const loaded = p.sw === "idle" || p.sw === "back" || anim !== "attack";

    // podvozek: dva trámy s příčkami
    const chassis = k.mask().rect(-21, base - 2, 41, 4);
    k.paint(chassis, TIMBER, { dir: "v", occ: 0.3, tex: (x, y, t, c) => ((x + 40) % 9 === 0 ? TIMBER[3] : c) });
    k.R(-21, base + 2, 41, 1, C.w[0]);
    for (const x of [-18, 16]) k.paint(k.mask().rect(x, base - 4, 3, 7), TIMBER_D, { occ: 0.3 });

    // stojan (A) s příčným dorazem, polstrovaným týmovým suknem
    const frame = k.mask().cap(-1, base - 1, 4, base - 21, 1.6, 1.4).cap(9, base - 1, 4, base - 21, 1.6, 1.4);
    k.paint(frame, TIMBER, { occ: 0.35, dir: "h" });
    k.L(1, base - 10, 7, base - 10, C.w[1]);
    k.paint(k.mask().rect(0, base - 24, 9, 3), TIMBER_D, { occ: 0.3 });
    k.paint(k.mask().ell(4.5, base - 25, 4.4, 1.6), teamR(T), { occ: 0.3 });

    // rameno s miskou
    k.paint(k.mask().cap(pivot[0], pivot[1], cup[0], cup[1], 1.9, 1.3), TIMBER, { occ: 0.35 });
    const cupM = k.mask().ell(cup[0] + adx * 1.5, cup[1] + ady * 1.5, 3.4, 3.4, (x, y) => (x + 0.5 - cup[0]) * -ady + (y + 0.5 - cup[1]) * adx <= 1.2);
    k.paint(cupM, R.iron, { occ: 0.35 });
    if (loaded) {
      k.paint(k.mask().ell(cup[0] + adx * 1.5 + ady * 1.6, cup[1] + ady * 1.5 - adx * 1.6, 2.6, 2.4), ROCK, { occ: 0.35 });
    } else if (p.sw === "strike") {
      // kámen právě vylétá dopředu
      const rx = cup[0] + 6;
      const ry = cup[1] - 2;
      k.paint(k.mask().ell(rx, ry, 2.8, 2.6), ROCK, { occ: 0.35 });
      k.L(rx - 6, ry + 2, rx - 3, ry + 1, mix(S[5], C.white, 0.4));
      k.L(rx - 7, ry - 1, rx - 4, ry - 1, mix(S[5], C.white, 0.2));
    }
    // torzní svazek lan na čepu
    const coil = k.mask().ell(pivot[0], pivot[1], 3.2, 3.2);
    k.paint(coil, R.straw, { occ: 0.35, tex: (x, y, t, c) => ((x + y) % 2 === 0 ? R.straw[2] : c) });
    k.px(pivot[0], pivot[1], C.w[0]);

    // naviják vzadu s klikou
    k.paint(k.mask().ell(-17, base - 6, 2.4, 2.4), TIMBER_D, { occ: 0.3 });
    k.L(-17, base - 6, -20 + shake, base - 9, S[4]);
    k.L(-17, base - 6, pivot[0] + adx * 9, pivot[1] + ady * 9, C.d[4]);

    // týmový štítek na boku a praporec vpředu
    k.paint(k.mask().poly([[-4, base - 2], [3, base - 2], [3, base + 2], [-0.5, base + 5], [-4, base + 2]]), teamR(T), { occ: 0.4 });
    k.ring(-0.5, base + 0.5, 1.6, T.accent, false);
    k.L(17, base - 3, 17, base - 21, C.w[3]);
    k.L(18, base - 3, 18, base - 21, C.w[1]);
    const wave = walk ? Math.round(Math.sin(p.i * 2.1)) : p.cape || 0;
    const flagM = k.mask().poly([[17, base - 21], [17, base - 15], [10, base - 16 + wave], [8, base - 19 + wave]]);
    k.paint(flagM, teamR(T), { occ: 0.3 });
    k.px(17, base - 22, C.gold[2]);

    // blízká kola
    wheel(-13, -5 + bob, 5.8, false);
    wheel(12, -5 + bob, 5.8, false);

    k.meta.head = [1 / HD, (base - 12) / HD];
  }

  /* ================= KOPINÍK ================= */
  // prošívaná vycpávková kazajka, krátký týmový varkoč, otevřená přilba, dlouhé kopí obouruč s praporcem.
  // Útok = sklopení kopí a bodnutí vpřed (proti jezdcům a velkým zrůdám dvojnásob).
  const GAMBESON = ramp(C.d[5], C.d[4], C.d[3], C.d[2]);

  function drawSpearman(k) {
    const { T, V, pose: p } = k;
    const dy = p.dy;
    const lx = p.lx;
    const hipY = -12 + dy;
    const sh = -24 + dy;
    const fl = p.cape;
    const bob = p.step >= 0 ? (p.step % 3 === 1 ? 1 : 0) : 0;

    // kopí: přední ruka [x, y], úhel ke hrotu
    const SP = {
      idle: [lx + 7, sh + 10, -1.48], back: [lx + 2, sh + 7, -0.14], strike: [lx + 12, sh + 7, -0.04], low: [lx + 10, sh + 9, 0.1],
      rest: [lx + 6, sh + 7, -1.9], up: [lx + 6, sh - 3, -1.52], hit: [lx + 5, sh + 9, -1.7]
    };
    const [gx, gy0, ga] = posed(SP, p);
    const gy = gy0 + bob;
    const dx = Math.cos(ga);
    const dyv = Math.sin(ga);
    const tip = [gx + dx * 29, gy + dyv * 29];
    const butt = [gx - dx * 12, Math.min(-1, gy - dyv * 12)];
    const back = [gx - dx * 7, gy - dyv * 7];

    // ratiště a hrot (za tělem jen spodní část, celé kopí se kreslí až nakonec)
    const spear = () => {
      k.L(butt[0], butt[1], tip[0] - dx * 3, tip[1] - dyv * 3, C.w[3]);
      const side = Math.abs(dyv) > 0.7 ? [1, 0] : [0, 1];
      k.L(butt[0] + side[0], butt[1] + side[1], tip[0] - dx * 4 + side[0], tip[1] - dyv * 4 + side[1], C.w[1]);
      k.px(butt[0], butt[1], S[3]);
      // listový hrot
      const nx = -dyv;
      const ny = dx;
      const h0 = [tip[0] - dx * 6, tip[1] - dyv * 6];
      const head = k.mask().poly([[h0[0], h0[1]], [h0[0] + dx * 3 + nx * 2, h0[1] + dyv * 3 + ny * 2], [tip[0], tip[1]], [h0[0] + dx * 3 - nx * 2, h0[1] + dyv * 3 - ny * 2]]);
      k.paint(head, R.steel, { occ: 0.3 });
      k.px(tip[0], tip[1], C.white);
      k.L(h0[0] + dx, h0[1] + dyv, tip[0] - dx, tip[1] - dyv, S[6]);
      // týmový střapec pod hrotem
      const tq = [h0[0] - dx * 1, h0[1] - dyv * 1];
      k.px(tq[0], tq[1], T.l);
      k.px(tq[0] - 1, tq[1] + 1, T.m);
      k.px(tq[0] - 1 - fl, tq[1] + 2, T.s);
      k.px(tq[0], tq[1] + 1, T.s);
      if (p.sw === "strike") for (const oy of [-2, 2]) k.L(tip[0] - 14, tip[1] + oy, tip[0] - 7, tip[1] + oy, mix(S[5], C.white, 0.35));
    };

    // zadní paže drží ratiště vzadu
    arm(k, lx - 1, sh + 2, ...reach(lx - 1, sh + 2, back[0], back[1], 10.8), { ramp: ramp(GAMBESON[1], GAMBESON[2], GAMBESON[3], C.d[1]), r0: 2, r1: 1.7, len: 5.5 });

    leg(k, lx - 2, hipY, lx + p.fb[0], p.fb[1], { ramp: CLOTHS_D[V.cloth], boot: R.leather, bootH: 5, cuff: C.w[3] });
    leg(k, lx + 2, hipY, lx + p.ff[0], p.ff[1], { ramp: CLOTHS[V.cloth], boot: R.leather, bootH: 5, cuff: C.w[3] });

    // prošívaná kazajka až pod boky
    const torso = k.mask().poly([[lx - 6, sh], [lx + 5, sh], [lx + 7, sh + 4], [lx + 7, hipY + 4], [lx - 7, hipY + 4], [lx - 7, sh + 3]]);
    k.paint(torso, GAMBESON, { tex: (x, y, t, c) => ((x - lx + 40) % 3 === 0 && t > 0 ? mix(c, C.d[1], 0.3) : y % 4 === 0 && t === 1 ? GAMBESON[2] : c) });
    // krátký varkoč v barvě týmu se znakem
    const tab = k.mask().poly([[lx - 3, sh + 2], [lx + 5, sh + 2], [lx + 6, hipY + 2], [lx - 4, hipY + 2]]);
    k.paint(tab, teamR(T), { dir: "h", occ: 0.3 });
    k.ring(lx + 1, sh + 7, 2, T.accent, true);
    k.L(lx - 3, hipY + 2, lx + 6, hipY + 2, T.d);
    // opasek s dýkou
    k.R(lx - 7, hipY - 1, 14, 2, C.w[1]);
    k.R(lx - 7, hipY - 1, 14, 1, C.w[2]);
    k.px(lx + 2, hipY - 1, C.gold[1]);
    k.L(lx - 6, hipY + 1, lx - 8, hipY + 6, S[4]);
    k.px(lx - 6, hipY, C.w[2]);

    // hlava
    const hx = lx + 1;
    const hy = sh - 6;
    k.paint(k.mask().ell(hx, hy + 0.5, 4.4, 4.8), k.sk, { occ: 0.3 });
    eye(k, hx + 2, hy, V.hair[2]);
    k.px(hx + 5, hy + 1, k.sk[2]);
    k.L(hx + 2, hy + 3, hx + 3, hy + 3, k.sk[3]);
    beardOf(k, hx, hy, V);
    const hv = V.hat % 3;
    if (hv === 0) {
      // železný klobouk s týmovou páskou
      const dome = k.mask().ell(hx - 0.5, hy - 3, 4.6, 4.2, (x, y) => y < hy - 2);
      k.paint(dome, R.steel, { occ: 0.3 });
      k.paint(k.mask().ell(hx - 0.5, hy - 2.2, 8, 1.4), R.steelD, { dir: "v", occ: 0.3 });
      k.R(hx - 4, hy - 4, 8, 1, T.m);
      k.px(hx - 3, hy - 6, C.white);
    } else if (hv === 1) {
      // kulatá přilba s lícnicemi
      const helm = k.mask().ell(hx - 0.5, hy - 2, 5.2, 4.6, (x, y) => y < hy - 1).rect(hx - 5, hy - 2, 3, 6);
      k.paint(helm, R.steel, { occ: 0.3 });
      k.R(hx - 5, hy - 2, 10, 1, S[2]);
      k.px(hx - 2, hy - 5, C.white);
      k.paint(k.mask().cap(hx - 1, hy - 6, hx - 1, hy - 8, 1, 0.6), R.gold, { occ: 0.3 });
    } else {
      // prošívaná kukla a týmový šátek kolem krku
      const coif = k.mask().ell(hx - 1, hy - 0.5, 5.2, 5.4, (x, y) => x < hx + 1 || y < hy - 2);
      k.paint(coif, GAMBESON, { occ: 0.3, tex: (x, y, t, c) => ((x + y) % 3 === 0 && t === 1 ? GAMBESON[2] : c) });
    }
    const scarf = k.mask().ell(lx, sh, 5, 1.6).cap(lx - 4, sh, lx - 7, sh + 3 + fl, 1, 0.8);
    k.paint(scarf, teamR(T), { occ: 0.3 });

    spear();
    // přední paže
    arm(k, lx + 2, sh + 2, ...reach(lx + 2, sh + 2, gx, gy, 11), { ramp: GAMBESON, r0: 2.1, r1: 1.8, cuff: R.leather, len: 5.6 });
    k.meta.head = [hx / HD, hy / HD];
  }

  /* ================= KUŠINÍK ================= */
  // brigantina s nýty, železný klobouk, na zádech velký pavéza (štít) v barvě týmu, kuše.
  // Útok: zamíří (back), výstřel s trhnutím (strike), dlouhé natahování kuše (low).
  function drawCrossbow(k) {
    const { T, V, pose: p } = k;
    const dy = p.dy;
    const lx = p.lx;
    const hipY = -12 + dy;
    const sh = -25 + dy;
    const fl = p.cape;
    const bob = p.step >= 0 ? (p.step % 3 === 1 ? 1 : 0) : 0;

    // pavéza na zádech
    const px0 = lx - 9;
    const py0 = sh - 3;
    const pav = k.mask().poly([[px0, py0], [px0 + 8, py0 - 1], [px0 + 8, py0 + 17], [px0 + 4, py0 + 20], [px0, py0 + 17]]);
    k.paint(pav, teamR(T), {
      occ: 0.4, dir: "h",
      tex: (x, y, t, c) => {
        const edge = !pav.has(x - 1, y) || !pav.has(x + 1, y) || !pav.has(x, y - 1) || !pav.has(x, y + 1) || !pav.has(x - 2, y) || !pav.has(x + 2, y);
        if (edge) return x < px0 + 4 ? C.w[3] : C.w[1];
        return heraldry(x, y, px0 + 4, py0 + 8, V.emblem === 0 ? 1 : V.emblem, T, t, c);
      }
    });
    k.L(px0 + 4, py0 + 1, px0 + 4, py0 + 18, mix(T.m, C.white, 0.15));

    // kuše: střed pažby [x, y], úhel; nabito?
    const XB = {
      idle: [lx + 5, hipY - 1, 0.55], back: [lx + 6, sh + 3, -0.02], strike: [lx + 5, sh + 2, -0.16], low: [lx + 6, hipY + 1, 1.15],
      rest: [lx + 4, sh + 3, -1.25], up: [lx + 5, sh - 6, -1.2], hit: [lx + 4, hipY - 1, 0.8]
    };
    const [cx, cy0, ca] = posed(XB, p);
    const cy = cy0 + bob;
    const loaded = p.sw !== "strike" && p.sw !== "low";
    const dx = Math.cos(ca);
    const dyv = Math.sin(ca);
    const nx = -dyv;
    const ny = dx;
    const front = [cx + dx * 7, cy + dyv * 7];
    const stockEnd = [cx - dx * 6, cy - dyv * 6];

    // zadní paže drží pažbu
    arm(k, lx - 1, sh + 2, ...reach(lx - 1, sh + 2, stockEnd[0] + dx * 2, stockEnd[1] + dyv * 2, 10.6), { ramp: R.leather, r0: 2, r1: 1.7, len: 5.4 });

    leg(k, lx - 2, hipY, lx + p.fb[0], p.fb[1], { ramp: CLOTHS_D[V.cloth], boot: R.leather, bootH: 6, cuff: C.w[3] });
    leg(k, lx + 2, hipY, lx + p.ff[0], p.ff[1], { ramp: CLOTHS[V.cloth], boot: R.leather, bootH: 6, cuff: C.w[3], knee: S[5] });

    // brigantina: týmové sukno s řadami nýtů, kožené šosy
    const torso = k.mask().poly([[lx - 6, sh], [lx + 5, sh], [lx + 7, sh + 4], [lx + 6, hipY + 1], [lx - 6, hipY + 1], [lx - 7, sh + 3]]);
    k.paint(torso, teamRD(T));
    for (let y = sh + 3; y < hipY; y += 3) for (let x = lx - 4 + ((y >> 1) & 1); x < lx + 6; x += 3) k.px(x, y, mix(C.gold[1], C.white, 0.2));
    const skirt = k.mask().poly([[lx - 6, hipY], [lx + 6, hipY], [lx + 7, hipY + 5], [lx - 6, hipY + 5]]);
    k.paint(skirt, R.leather, { dir: "h", occ: 0.3 });
    k.L(lx, hipY + 1, lx, hipY + 5, C.w[0]);
    k.R(lx - 6, hipY - 1, 13, 2, C.w[1]);
    k.px(lx + 2, hipY - 1, C.gold[1]);
    // toulec se šipkami u boku
    k.paint(k.mask().rect(lx - 9, hipY - 3, 3, 7), R.leatherL, { occ: 0.3 });
    for (const x of [-9, -8, -7]) k.px(lx + x, hipY - 4, x === -8 ? T.l : S[4]);

    // hlava v železném klobouku
    const hx = lx + 1;
    const hy = sh - 6;
    k.paint(k.mask().ell(hx, hy + 0.5, 4.4, 4.8), k.sk, { occ: 0.3 });
    eye(k, hx + 2, hy, V.hair[2]);
    k.px(hx + 5, hy + 1, k.sk[2]);
    k.L(hx + 2, hy + 3, hx + 3, hy + 3, k.sk[3]);
    beardOf(k, hx, hy, V);
    k.paint(k.mask().ell(hx - 3, hy, 2.3, 3), V.hair, { occ: 0.3 });
    const hv = V.hat % 2;
    const dome = k.mask().poly([[hx - 4, hy - 2], [hx + 4, hy - 2], [hx + 3, hy - 6], [hx, hy - 8], [hx - 3, hy - 6]]);
    k.paint(dome, R.steel, { occ: 0.3, tex: (x, y, t, c) => (x === Math.round(hx) && t > 0 ? S[2] : c) });
    k.paint(k.mask().ell(hx, hy - 1.8, hv ? 6.8 : 8.6, 1.4), R.steelD, { dir: "v", occ: 0.3 });
    k.R(hx - 4, hy - 3, 8, 1, T.m);
    k.px(hx - 2, hy - 6, C.white);

    // kuše: pažba, luček napříč, tětiva, šipka
    k.L(stockEnd[0], stockEnd[1], front[0], front[1], C.w[3]);
    k.L(stockEnd[0] + nx * 0.8, stockEnd[1] + 1, front[0] + nx * 0.8, front[1] + 1, C.w[1]);
    k.paint(k.mask().cap(stockEnd[0], stockEnd[1], stockEnd[0] + dx * 3, stockEnd[1] + dyv * 3, 1.5, 1.2), R.leatherL, { occ: 0.3 });
    const bend = loaded ? 2.2 : 1;
    const pa = [front[0] + nx * 7 - dx * bend, front[1] + ny * 7 - dyv * bend];
    const pb = [front[0] - nx * 7 - dx * bend, front[1] - ny * 7 - dyv * bend];
    const nut = loaded ? [cx - dx * 1, cy - dyv * 1] : [front[0] - dx * 0.5, front[1] - dyv * 0.5];
    lineTo(k, [pa, nut, pb], mix(C.bone[0], C.white, 0.2));
    lineTo(k, [pa, [front[0] + nx * 3.5, front[1] + ny * 3.5], front, [front[0] - nx * 3.5, front[1] - ny * 3.5], pb], S[4]);
    k.px(pa[0], pa[1], S[6]);
    k.px(pb[0], pb[1], S[2]);
    k.paint(k.mask().ell(front[0] + dx, front[1] + dyv, 1.2, 1.2), R.iron, { occ: 0.2 });
    if (loaded) {
      k.L(nut[0], nut[1] - 1, front[0] + dx * 3, front[1] + dyv * 3 - 1, S[5]);
      k.px(front[0] + dx * 4, front[1] + dyv * 4 - 1, C.white);
      k.px(nut[0], nut[1] - 1, T.l);
    }
    if (p.sw === "strike") {
      // výstřel: záblesk tětivy a zpětný ráz
      for (const [ox, oy] of [[8, -1], [10, -2], [9, 1]]) k.px(front[0] + ox, front[1] + oy, C.a[4]);
    }
    if (p.sw === "low") {
      // natahování: noha ve třmenu, ruka tahá tětivu nahoru
      k.L(front[0], front[1], front[0] + dx * 3, front[1] + dyv * 3, S[3]);
    }
    // přední paže
    const fh = p.sw === "low" ? [cx - dx * 2, cy - 4] : [cx + dx * 1, cy + dyv * 1 + 1];
    arm(k, lx + 2, sh + 2, ...reach(lx + 2, sh + 2, fh[0], fh[1], 11), { ramp: teamRD(T), r0: 2, r1: 1.7, cuff: R.leather, hand: R.leather, len: 5.6 });
    // nárameník
    k.paint(k.mask().ell(lx + 2, sh + 2.5, 3.4, 2.2, (x, y) => y < sh + 4), R.steel, { occ: 0.4 });
    k.meta.head = [hx / HD, hy / HD];
  }

  /* ================= PEKELNÝ PES ================= */
  // vyzáblý nemrtvý pes: prosvítající žebra, lebka místo čenichu, žhnoucí oči, hřbet z cárů mlhy,
  // týmový obojek s cárem. Chůze = trysk (dvě fáze nohou), útok = výskok a kousnutí, oslava = vytí.
  const HOUND = ramp(0x6a6474, 0x4a4454, 0x343040, 0x201c2a);
  const HOUND_D = ramp(0x4a4454, 0x343040, 0x221e2c, 0x14101c);
  const HOUND_TONES = [
    [HOUND, HOUND_D],
    [ramp(0x8a6a5a, 0x664c42, 0x48342e, 0x2e201c), ramp(0x664c42, 0x48342e, 0x30221e, 0x1c1210)],
    [ramp(0x5a6a6a, 0x3e4c4e, 0x2a3638, 0x182224), ramp(0x3e4c4e, 0x2a3638, 0x1a2426, 0x0e1416)]
  ];

  function drawHound(k) {
    const { T, V, pose: p } = k;
    const anim = p.anim;
    const walk = anim === "walk";
    const ph = walk ? (p.i / 6) * Math.PI * 2 : 0;
    const [fur, furD] = HOUND_TONES[V.tone];
    const atk = anim === "attack";
    const howl = anim === "cheer";
    const lunge = atk ? (p.sw === "strike" ? 5 : p.sw === "low" ? 3 : p.sw === "back" ? -2 : 0) : (p.lx || 0);
    const bx = lunge;
    const crouch = atk && p.sw === "back" ? 2 : 0;
    const by = -13 + crouch + (walk ? Math.round(Math.sin(ph * 2) * 1.2) : anim === "idle" ? (p.dy > 0 ? 1 : 0) : 0) + (atk && p.sw === "strike" ? -2 : 0);
    const fl = p.cape || 0;
    const tilt = atk && p.sw === "strike" ? -2 : howl ? 2 : 0; // předek výš/níž

    const legD = (hx, hy, off, front, far) => {
      const s = Math.sin(ph + off);
      const c = Math.cos(ph + off);
      let fx = hx + (walk ? s * 6.5 : front ? 1 : -1);
      let lift = walk ? Math.max(0, c) * 4 : 0;
      if (atk && p.sw === "strike") { fx = hx + (front ? 7 : -6); lift = front ? 5 : 1; }
      if (atk && p.sw === "back") fx = hx + (front ? 2 : -2);
      const [kx, ky] = ik(hx, hy, fx, -1 - lift, 6, 6.2, front ? -1 : 1);
      const rp = far ? furD : fur;
      k.paint(k.mask().cap(hx, hy - 1, kx, ky, front ? 2.2 : 2.8, 1.2).cap(kx, ky, fx, -1 - lift, 1.1, 0.9), rp, { dir: "h", occ: 0.35 });
      // pazoury
      k.L(fx - 1, -1 - lift, fx + 2, -1 - lift, far ? C.bone[2] : C.bone[1]);
      k.px(fx + 2, -1 - lift, C.bone[0]);
    };
    const hipX = bx - 8;
    const shX = bx + 7;
    legD(hipX, by + 1, Math.PI * 0.85, false, true);
    legD(shX, by + 1 - tilt, Math.PI * 0.15, true, true);

    // ocas: holá páteř s cárem
    const tail = [[hipX - 3, by - 2], [hipX - 8, by - 4 + fl], [hipX - 12, by - 2 + fl * 2]];
    k.paint(k.mask().cap(...tail[0], ...tail[1], 1.4, 1).cap(...tail[1], ...tail[2], 1, 0.6), furD, { occ: 0.3 });
    for (let i = 0; i < 3; i++) k.px(hipX - 4 - i * 3, by - 3 - (i === 1 ? 1 : 0) + fl, C.bone[1]);

    // trup: hrudník vpředu, vtažené břicho, kostnatá záď
    const body = k.mask().ell(shX - 1, by - 3 - tilt * 0.5, 7, 5.6).ell(hipX + 1, by - 3, 5, 4.4).cap(hipX + 1, by - 3, shX - 1, by - 4 - tilt * 0.5, 3.4, 4.2);
    k.paint(body, fur, { occ: 0.3, tex: (x, y, t, c) => ((x * 3 + y * 2) % 7 === 0 && t === 1 ? fur[2] : c) });
    // žebra prosvítají žhnoucí rudou
    for (let i = 0; i < 4; i++) {
      const x = shX - 4 + i * 2.2 - 3;
      k.L(x, by - 5 - tilt * 0.4, x + 1, by - 1 - tilt * 0.4, C.bone[1]);
      k.px(x + 1, by - 3 - tilt * 0.4, C.r[2]);
    }
    k.px(shX - 2, by - 2 - tilt * 0.4, C.r[4]);
    // páteř s ostny a hřbet z cárů mlhy
    for (let i = 0; i < 6; i++) {
      const x = hipX - 1 + i * 2.6;
      const y = by - 8 - (i > 3 ? tilt * 0.5 : 0) - (i === 2 || i === 3 ? 1 : 0);
      k.px(x, y, C.bone[0]);
      k.px(x, y - 1, i % 2 ? C.bone[2] : C.bone[1]);
      if (i % 2 === 0) k.px(x - 1 - fl, y - 2, mix(fur[1], C.v[2], 0.35));
    }
    // týmový obojek s cárem
    const cxx = shX + 4;
    const cyy = by - 6 - tilt;
    k.paint(k.mask().cap(cxx - 1, cyy - 3, cxx + 1, cyy + 3, 1.3, 1.3), teamR(T), { occ: 0.3 });
    k.paint(k.mask().cap(cxx - 1, cyy + 1, cxx - 4, cyy + 5 + fl, 1, 0.6), teamR(T), { occ: 0.3 });
    k.px(cxx, cyy + 2, C.gold[1]);

    // krk a lebka
    const head = howl ? [shX + 8, by - 16] : atk && p.sw === "strike" ? [shX + 11, by - 9] : [shX + 9, by - 11 - tilt];
    k.paint(k.mask().cap(shX + 2, by - 5 - tilt, head[0] - 2, head[1] + 1, 3.6, 2.6), fur, { occ: 0.3 });
    const up = howl ? -1.1 : atk && p.sw === "strike" ? 0.05 : 0.25; // sklon čenichu
    const sdx = Math.cos(up);
    const sdy = Math.sin(up);
    const skull = k.mask().ell(head[0], head[1], 3.6, 3.2).cap(head[0], head[1], head[0] + sdx * 7, head[1] + sdy * 7 + 0.5, 2.4, 1.4);
    k.paint(skull, R.bone, { occ: 0.3 });
    // ucho (cár kůže)
    k.paint(k.mask().poly([[head[0] - 2, head[1] - 2], [head[0] + 1, head[1] - 2], [head[0] - 4 - fl, head[1] - 6]]), furD, { occ: 0.3 });
    // čelist: při kousnutí a vytí otevřená
    const open = (atk && (p.sw === "back" || p.sw === "strike")) || howl;
    const jaw0 = [head[0] + 1, head[1] + 2];
    const ja = up + (open ? 0.75 : 0.15);
    const jaw1 = [jaw0[0] + Math.cos(ja) * 6, jaw0[1] + Math.sin(ja) * 6];
    k.paint(k.mask().cap(jaw0[0], jaw0[1], jaw1[0], jaw1[1], 1.3, 0.9), ramp(C.bone[1], C.bone[2], mix(C.bone[2], C.ink, 0.3), C.ink), { occ: 0.35 });
    if (open) {
      for (let i = 1; i < 5; i += 2) {
        k.px(head[0] + sdx * (2 + i) , head[1] + sdy * (2 + i) + 2, C.white);
        k.px(jaw0[0] + Math.cos(ja) * (1 + i), jaw0[1] + Math.sin(ja) * (1 + i) - 1, C.white);
      }
      k.px(jaw0[0] + 1, jaw0[1], C.r[3]);
    }
    // žhnoucí oko a nozdra
    emberEye(k, head[0] + 1, head[1] - 1);
    k.meta.eye = [(head[0] + 1) / HD, (head[1] - 1) / HD];
    k.px(head[0] + sdx * 7, head[1] + sdy * 7, C.ink);
    if (howl) for (const [ox, oy, c] of [[2, -3, C.r[4]], [4, -5, C.r[3]], [1, -6, C.r[2]]]) k.px(head[0] + sdx * 7 + ox, head[1] + sdy * 7 + oy, c);

    // blízké nohy
    legD(hipX - 1, by, Math.PI * 1.85, false, false);
    legD(shX + 1, by - tilt, Math.PI * 1.15, true, false);

    k.meta.head = [head[0] / HD, head[1] / HD];
  }

  /* ================= NEKROMANT ================= */
  // černofialová róba s kostěnými ozdobami, kápě s bledou tváří a zelenými zornicemi, hůl s beraní
  // lebkou a nazelenalým plamenem duší. Útok = vržený zelený přízrak (jako lich), kouzlo = povolání kostlivce.
  const NECRO = ramp(0x5a4470, 0x3c2c50, 0x281e38, 0x181224);
  const NECRO_D = ramp(0x3c2c50, 0x281e38, 0x1a1428, 0x0e0a18);
  const SOUL = ramp(C.glow[2], C.glow[1], C.glow[0], 0x1c6a5c);

  function drawNecromancer(k) {
    const { T, V, pose: p } = k;
    const dy = p.dy;
    const lx = p.lx;
    const fl = p.cape;
    const sh = -27 + dy;
    const sw = p.anim === "attack" ? LICH_SW[p.sw] || p.sw : p.sw;
    const cast = sw === "up" || sw === "flare" || sw === "fwd";
    const step = p.step >= 0 ? p.step : -1;
    const sway = step >= 0 ? [1, 0, -1, -1, 0, 1][step] : 0;

    // plášť vzadu s roztřepeným lemem
    const cape = k.mask().poly([[lx - 5, sh - 1], [lx, sh], [lx - 6, -1], [lx - 9, -3 + fl], [lx - 12 - fl, -1 + fl], [lx - 10, sh + 6]]);
    k.paint(cape, NECRO_D, { dir: "h" });
    for (let x = lx - 12 - fl; x < lx - 6; x += 2) k.px(x, -1 + fl, NECRO_D[3]);

    // hůl
    const STF = { idle: [10, 0], up: [10, -3], flare: [11, -5], fwd: [13, -1], hit: [8, 0], rest: [9, 0] };
    const st = posed(STF, p, LICH_SW, STF.idle);
    const sx = lx + st[0];
    const top = sh - 6 + st[1];

    // volná paže
    const free = cast ? posed({ up: [lx - 3, sh - 8], flare: [lx - 5, sh - 12], fwd: [lx + 7, sh - 3] }, p, LICH_SW) : [lx - 3 - (step >= 0 ? (p.swing || 0) * 2 : 0), sh + 12];
    arm(k, lx - 2, sh + 2, free[0], free[1], { ramp: NECRO_D, r0: 2.1, r1: 1.7, hand: R.bone, len: 6.2 });

    // róba
    const robe = k.mask().poly([[lx - 5, sh], [lx + 5, sh], [lx + 7 + sway, -1], [lx - 7 + sway, -1]]);
    k.paint(robe, NECRO, { dir: "h", tex: (x, y, t, c) => ((x - lx + 40) % 4 === 2 && y > sh + 12 && t === 1 ? NECRO[2] : c) });
    // týmový pruh a lem se zubatým okrajem
    const band = k.mask().poly([[lx, sh + 1], [lx + 3, sh + 1], [lx + 4 + sway, -2], [lx - 1 + sway, -2]]);
    k.paint(band, teamR(T), { dir: "h", occ: 0.3 });
    for (let x = lx - 7 + sway; x <= lx + 7 + sway; x++) k.px(x, -2, (x & 1) ? T.m : NECRO[3]);
    // pás z kostí a visící lebka
    k.R(lx - 5, sh + 10, 11, 1, C.bone[1]);
    for (let x = lx - 5; x < lx + 6; x += 2) k.px(x, sh + 10, C.bone[0]);
    k.paint(k.mask().ell(lx - 3, sh + 13, 1.8, 1.7), R.bone, { occ: 0.3 });
    k.px(lx - 3, sh + 13, C.ink);
    // zelené runy
    for (const [x, y] of [[4, 15], [-4, 19], [3, 22]]) k.px(lx + x + sway * 0.5, sh + y, C.glow[1]);

    // límec z kostí a kápě
    const pad = k.mask().ell(lx, sh + 1, 6.5, 2.8, (x, y) => y < sh + 3);
    k.paint(pad, NECRO_D, { occ: 0.4 });
    for (const x of [-5, -2, 2, 5]) k.px(lx + x, sh, C.bone[0]);
    const hx = lx + 1;
    const hy = sh - 6;
    const hood = k.mask().ell(hx - 0.5, hy - 0.5, 5.8, 6.2).poly([[hx - 4, hy - 4], [hx - 3, hy - 11 - (V.v ? 0 : 1)], [hx + 2, hy - 5]]);
    k.paint(hood, NECRO, { occ: 0.3 });
    const face = k.mask().ell(hx + 2.4, hy + 1.2, 2.9, 3.9);
    k.paint(face, ramp(0xd8dcd0, 0xb0b4a8, 0x80847a, 0x50544c), { occ: 0.5 });
    k.R(hx + 1, hy - 1, 4, 1, NECRO[3]);
    k.px(hx + 3, hy, C.glow[2]);
    k.px(hx + 4, hy, C.glow[1]);
    k.px(hx + 4, hy + 3, 0x50544c);
    k.meta.eye = [(hx + 3) / HD, hy / HD];
    if (V.v) {
      // druhá varianta: kostěná maska přes ústa
      k.R(hx + 2, hy + 2, 4, 3, C.bone[1]);
      k.px(hx + 3, hy + 3, C.ink);
      k.px(hx + 5, hy + 3, C.ink);
    }

    // hůl s beraní lebkou a plamenem duší
    k.L(sx, top, sx, -1, C.w[1]);
    k.L(sx + 1, top, sx + 1, -1, C.w[0]);
    for (const y of [top + 7, top + 15]) k.R(sx, y, 2, 1, C.bone[1]);
    const sk = k.mask().ell(sx + 0.5, top - 2, 3, 2.6).rect(sx, top, 3, 2);
    k.paint(sk, R.bone, { occ: 0.35 });
    const horns = k.mask().cap(sx - 2, top - 3, sx - 5, top - 1, 1.2, 0.8).cap(sx - 5, top - 1, sx - 4, top + 2, 0.8, 0.5).cap(sx + 3, top - 3, sx + 6, top - 1, 1.2, 0.8).cap(sx + 6, top - 1, sx + 5, top + 2, 0.8, 0.5);
    k.paint(horns, R.ash, { occ: 0.3 });
    k.px(sx + 1, top - 2, C.glow[1]);
    const hot = sw === "flare";
    const flame = k.mask().ell(sx + 0.5, top - 6, 1.8 + (hot ? 1 : 0), 1.8).poly([[sx - 1, top - 7], [sx + 2, top - 7], [sx + 0.5 + fl, top - 11 - (hot ? 3 : 0)]]);
    k.paint(flame, SOUL, { occ: 0, dir: "v" });
    k.px(sx + 0.5, top - 6, C.white);
    k.meta.glow = [(sx + 0.5) / HD, (top - 6) / HD, cast ? 1 : 0];

    // přední paže drží hůl
    arm(k, lx + 2, sh + 2, sx, sh + 11, { ramp: NECRO, r0: 2.1, r1: 1.7, hand: R.bone, len: 6.2 });

    // duše ve volné ruce při kouzlu
    if (cast && sw !== "up") {
      const fx = free[0];
      const fy = free[1] - 3;
      const big = hot ? 1 : 0;
      const orb = k.mask().ell(fx, fy, 2.3 + big, 2.3 + big).poly([[fx - 2, fy - 1], [fx + 2, fy - 1], [fx - 1, fy - 6 - big * 2]]);
      k.paint(orb, SOUL, { occ: 0, dir: "v" });
      k.px(fx - 1, fy - 1, C.ink);
      k.px(fx + 1, fy - 1, C.ink);
      k.px(fx, fy + 1, C.white);
      for (const [ox, oy] of [[3, -3], [-3, -4], [4, 1]]) k.px(fx + ox + big, fy + oy, C.glow[1]);
    }

    k.meta.head = [hx / HD, hy / HD];
  }

  /* ================= MOROVÁK ================= */
  // nafouklá mrtvola v cárech, pod kápí boule a zelené hnisavé vředy, v ruce kadidelnice na řetězu,
  // ze které se valí morový dým. Útok = máchnutí kadidelnicí. Po smrti praskne (viz Match.plague).
  const PLAGUE = ramp(0xb0b888, 0x8a9468, 0x646e4c, 0x434a34);
  const PLAGUE_D = ramp(0x8a9468, 0x646e4c, 0x434a34, 0x2a3022);
  const RAGS = ramp(C.d[3], C.d[2], C.d[1], C.d[0]);

  function drawPlague(k) {
    const { T, V, pose: p } = k;
    const dy = p.dy;
    const lx = p.lx;
    const fl = p.cape;
    const by = -18 + dy;
    const step = p.step >= 0 ? p.step : -1;

    // kadidelnice: ruka [x, y] a úhel řetězu (od ruky ke kouli)
    const CN = {
      idle: [lx + 9, by + 2, 1.45 + fl * 0.12], back: [lx - 4, by - 10, -2.6], strike: [lx + 12, by - 2, -0.2], low: [lx + 11, by + 4, 0.7],
      up: [lx + 6, by - 14, -1.3], rest: [lx + 9, by + 2, 1.7], hit: [lx + 7, by + 3, 1.9]
    };
    const [chx, chy, cang] = posed(CN, p);
    const swingA = step >= 0 ? cang + Math.sin(step) * 0.25 : cang;
    const ball = [chx + Math.cos(swingA) * 8, chy + Math.sin(swingA) * 8];

    // zadní paže
    arm(k, lx - 6, by - 7, lx - 9 - (p.swing || 0) * 2, by + 6, { ramp: PLAGUE_D, r0: 2.2, r1: 1.8, hand: PLAGUE_D, len: 6.2 });

    // nohy v onucích
    const legO = { ramp: RAGS, boot: PLAGUE_D, bare: true, len: 4.6, r0: 2.8, r1: 2.3, r2: 2 };
    leg(k, lx - 4, -9 + dy, lx - 4 + p.fb[0], p.fb[1], { ...legO, ramp: ramp(RAGS[1], RAGS[2], RAGS[3], C.ink) });
    leg(k, lx + 3, -9 + dy, lx + 4 + p.ff[0], p.ff[1], legO);

    // nafouklé tělo
    const belly = k.mask().ell(lx, by, 10, 10.5);
    k.paint(belly, PLAGUE, { split: 0.6, tex: (x, y, t, c) => ((x * 5 + y * 3) % 13 === 0 && t === 1 ? PLAGUE[2] : c) });
    // vředy: zelená záře s bělavým středem
    for (const [x, y, r] of [[4, -3, 1.6], [-3, 3, 1.3], [6, 4, 1.1], [-6, -4, 1.2], [1, 7, 1]]) {
      k.paint(k.mask().ell(lx + x, by + y, r, r), ramp(C.glow[2], C.glow[1], C.glow[0], 0x1c6a5c), { occ: 0.4 });
      k.px(lx + x, by + y - 1, C.white);
    }
    // cáry přes tělo a týmová šerpa
    const rag = k.mask().poly([[lx - 10, by - 2], [lx + 9, by - 6], [lx + 10, by - 2], [lx - 9, by + 3]]);
    k.paint(rag, RAGS, { occ: 0.35, dir: "v" });
    const sash = k.mask().poly([[lx - 8, by + 5], [lx + 9, by + 2], [lx + 9, by + 5], [lx + 4, by + 12 + fl], [lx + 2, by + 6], [lx - 8, by + 8]]);
    k.paint(sash, teamR(T), { occ: 0.3 });
    k.L(lx - 8, by + 5, lx + 9, by + 2, T.h);
    // šev přes břicho
    for (let i = 0; i < 6; i++) k.px(lx - 4 + i * 1.5, by + 9 - i * 0.3, C.r[1]);

    // hlava pod kápí, nakloněná dopředu
    const hx = lx + 6;
    const hy = by - 11;
    const hood = k.mask().ell(hx - 1, hy - 0.5, 5.2, 5).poly([[hx - 5, hy - 2], [hx - 9, hy + 4 + fl], [hx - 3, hy + 3]]);
    k.paint(hood, RAGS, { occ: 0.3 });
    k.paint(k.mask().ell(hx + 2, hy + 1, 2.8, 3.4), PLAGUE, { occ: 0.5 });
    k.R(hx, hy - 2, 4, 1, RAGS[3]);
    emberEye(k, hx + 2, hy);
    k.meta.eye = [(hx + 2) / HD, hy / HD];
    k.px(hx + 4, hy + 3, C.glow[1]);
    k.px(hx + 4, hy + 4, C.glow[0]);
    if (V.tone === 1) k.paint(k.mask().ell(hx + 1, hy - 4, 1.4, 1.2), ramp(C.glow[2], C.glow[1], C.glow[0], 0x1c6a5c), { occ: 0.3 });
    if (V.tone === 2) for (const x of [-3, 0, 3]) k.px(hx + x - 1, hy - 6, C.bone[1]);

    // řetěz a kadidelnice s dýmem
    for (let i = 1; i < 8; i++) k.px(chx + Math.cos(swingA) * i, chy + Math.sin(swingA) * i, i % 2 ? S[4] : S[2]);
    const cen = k.mask().ell(ball[0], ball[1], 2.8, 2.6).rect(ball[0] - 1, ball[1] - 3.5, 3, 1);
    k.paint(cen, R.gold, { occ: 0.35, tex: (x, y, t, c) => ((x + y) % 3 === 0 && t === 1 ? C.gold[0] : c) });
    k.px(ball[0], ball[1], C.glow[1]);
    k.px(ball[0] + 1, ball[1] + 1, C.glow[2]);
    for (const [ox, oy, c] of [[-1, -5, C.glow[1]], [1, -7, C.glow[0]], [-2, -9 - fl, mix(C.glow[0], C.ink, 0.2)], [2, -4, C.glow[2]]]) k.px(ball[0] + ox, ball[1] + oy, c);
    if (p.sw === "strike") smear(k, lx + 2, by - 4, 13, -2.4, -0.1, C.glow[2], C.glow[0]);

    // přední paže
    arm(k, lx + 5, by - 6, chx, chy, { ramp: PLAGUE, r0: 2.4, r1: 2, hand: PLAGUE, len: 6.2 });
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
    lich: drawLich,
    monk: drawMonk,
    knight: drawKnight,
    scout: drawKnight,
    spearman: drawSpearman,
    crossbow: drawCrossbow,
    hound: drawHound,
    necromancer: drawNecromancer,
    plague: drawPlague,
    catapult: drawCatapult
  };

  /* ---------- atlas ---------- */
  const store = {};

  // dělník s nákladem: stejná chůze a postoj, kolena víc pokrčená, náklad se opožďuje
  const withLoad = (poses, carry) => poses.map(q => ({ ...q, dy: (q.dy || 0) + 1, carry, lag: q.dy < 0 ? 1 : q.dy > 0 ? -1 : 0 }));
  const CARRY_POSES = {
    walk_gold: withLoad(POSES.walk, "gold"), idle_gold: withLoad(POSES.idle, "gold"),
    walk_wood: withLoad(POSES.walk, "wood"), idle_wood: withLoad(POSES.idle, "wood")
  };

  // Které animace typ má (ostatní spadnou na idle).
  function hasAnim(type, anim) {
    if (anim === "cast") return type === "hero" || type === "lich" || type === "necromancer";
    if (HERO_ONLY.has(anim)) return type === "hero";
    if (WORKER_ONLY.has(anim) || CARRY_POSES[anim]) return type === "worker";
    return !!POSES[anim];
  }

  function render(type, team, V, pose, anim) {
    const P = new Pix(W, W);
    const k = kit(P, team, { ...pose, anim }, V);
    k.type = type;
    RIGS[type](k);
    P.outline(C.ink, 0.7);
    return { P, k };
  }

  // Jedna animace jedné varianty se peče až při prvním použití (armáda o 8 variantách nečeká na všechno najednou).
  function buildAnim(type, team, V, anim) {
    const poses = POSES[anim] || CARRY_POSES[anim];

    return poses.map(pose => {
      const { P, k } = render(type, team, V, pose, anim);
      if (pose.blur) {
        // stopa zbraně a paží: dřívější fáze máchnutí (tělo stojí na místě mezisnímku), čím starší, tím řidší
        const ghosts = [0.04, 0.14, 0.24, 0.34, 0.44].map((t, j) => [render(type, team, V, { ...between(pose.from, pose.to, 0, t), blur: 0, lx: pose.lx, dy: pose.dy, ff: pose.ff, fb: pose.fb }, anim).P, Math.min(0.95, pose.blur * (0.5 + j * 0.22))]);
        motionBlur(P, ghosts);
      }

      const pf = P.flipX();
      return { pix: P, pixf: pf, c: PK.fine(P), cf: PK.fine(pf), meta: { ...k.meta }, flash: null, flashf: null };
    });
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

  const vnorm = (type, v) => {
    const n = VARIANTS[type] || 1;
    return (((v | 0) % n) + n) % n;
  };

  function sheet(type, team, v) {
    team = PK.skin(team); // barva týmu navíc z výzev
    v = vnorm(type, v);
    const key = `${type}|${team}|${v}`;
    return store[key] || (store[key] = { type, team, V: variant(type, v), anims: {} });
  }

  // v = varianta vzhledu (obvykle podle id jednotky, viz variantOf v game.js)
  function frame(type, team, anim, i, v = 0) {
    const set = sheet(type, team, v);
    if (!hasAnim(type, anim)) anim = anim.endsWith("_gold") || anim.endsWith("_wood") ? anim.split("_")[0] : "idle";
    if (!hasAnim(type, anim)) anim = "idle";
    const list = set.anims[anim] || (set.anims[anim] = buildAnim(type, set.team, set.V, anim));
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
    return (POSES[anim] || CARRY_POSES[anim] || POSES.idle).length;
  }

  /* Bílý záblesk zásahu (cache na snímek). */
  function flash(rec, flip) {
    const k = flip ? "flashf" : "flash";

    if (!rec[k]) {
      rec[k] = PK.fine((flip ? rec.pixf : rec.pix).tint(0xfff8ec, 0.72));
    }

    return rec[k];
  }

  /* ---------- smrt ----------
   * Padající tělo: zásah, podlomená kolena, pád dozadu (otočení kolem chodidel),
   * ležící tělo. Jezdci, zvířata a stroje se jen sesunou k zemi, přízraky se rozplynou.
   * Plátno 128x64 jemných px, chodidla (kotva) na (80, 60). */
  const DW = 128;
  const DX = 80;
  const DEATH_STYLE = { banshee: "fade", plague: "burst", knight: "slump", scout: "slump", hound: "slump", catapult: "wreck", abomination: "slump" };

  // Otočení obrázku o úhel a (rad, kladný = po směru hodin) kolem chodidel; nejbližší soused po středech bodů.
  function turn(src, a, sink) {
    // otáčí se do vyššího plátna (ležící tělo by jinak přesáhlo spodní okraj), pak se posadí na zem
    const TH = W * 2;
    const TY = W / 2;
    const o = new Pix(DW, TH);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const px = OX - 2;
    const py = OY - 1;
    for (let y = 0; y < TH; y++) {
      for (let x = 0; x < DW; x++) {
        const rx = x + 0.5 - (DX - 2);
        const ry = y + 0.5 - (py + TY);
        const sx = Math.floor(rx * ca + ry * sa + px);
        const sy = Math.floor(-rx * sa + ry * ca + py);
        const c = src.get(sx, sy);
        if (c >= 0) o.set(x, y, c);
      }
    }
    // tělo nesmí zajet pod zem (kromě sesunutí jezdců: sink = kolik bodů se schová pod okraj)
    let bottom = -1;
    for (let y = TH - 1; y >= 0 && bottom < 0; y--) for (let x = 0; x < DW; x++) if (o.alpha(x, y)) { bottom = y; break; }
    const shift = OY + 1 - bottom + (sink || 0);
    const out = new Pix(DW, W);
    for (let y = 0; y <= OY + 1; y++) {
      const sy = y - shift;
      if (sy < 0 || sy >= TH) continue;
      for (let x = 0; x < DW; x++) {
        const v = o.d[sy * DW + x];
        if (v >>> 24) out.d[y * DW + x] = v;
      }
    }
    return out;
  }

  // Obrázek buňky 64x64 posazený do širšího plátna smrti.
  const widen = src => new Pix(DW, W).stamp(src, DX - OX, 0);

  function death(type, team, v = 0) {
    const set = sheet(type, team, v);
    if (set.death) return set.death;

    const style = DEATH_STYLE[type] || "fall";
    const hit = frame(type, team, "hit", 0, v).pix;
    let pics;

    if (style === "fall") {
      const buckle = render(type, set.team, set.V, { ...STAND, sw: "hit", dy: 4, lx: -2, ff: [5, 0], fb: [-5, 0], swing: 0.7, cape: 1, i: 0 }, "die").P;
      pics = [widen(hit), widen(buckle), turn(buckle, -0.42), turn(buckle, -0.95), turn(buckle, -1.38), turn(buckle, -Math.PI / 2)];
    } else if (style === "slump") {
      // nohy se podlomí: tělo klesá k zemi a předek se skloní
      pics = [widen(hit), turn(hit, 0.04, 2), turn(hit, 0.09, 5), turn(hit, 0.14, 9), turn(hit, 0.18, 12), turn(hit, 0.2, 13)];
    } else if (style === "wreck") {
      pics = [widen(hit), turn(hit, 0.06, 2), turn(hit, 0.13, 4), turn(hit, 0.2, 6), turn(hit, 0.24, 7)];
    } else if (style === "burst") {
      // morovák praskne: nafoukne se, pak z něj zbude jen hromádka cárů
      const swell = hit.tint(C.glow[1], 0.35);
      const rags = render(type, set.team, set.V, { ...STAND, sw: "hit", dy: 9, lx: -1, ff: [6, 0], fb: [-6, 0], cape: 1, i: 0 }, "die").P;
      pics = [widen(hit), widen(swell), widen(swell.dissolve(0.55)), turn(rags, -1.2), turn(rags, -Math.PI / 2)];
    } else {
      // přízrak: stoupá a řídne
      pics = [widen(hit), widen(hit), widen(hit.dissolve(0.7)), widen(hit.dissolve(0.45)), widen(hit.dissolve(0.2))].map((P, i) => i > 1 ? new Pix(DW, W).stamp(P, 0, -i) : P);
    }

    const frames = pics.map(P => ({ pix: P, c: PK.fine(P), pf: null, cf: null, dis: {} }));
    set.death = { frames, ax: DX / HD, ay: OY / HD, w: DW / HD, fade: style === "fade" };
    return set.death;
  }

  // Snímek smrti i (poslední = ležící tělo), zrcadlený podle flip.
  function deathFrame(type, team, v, i, flip) {
    const d = death(type, team, v);
    const f = d.frames[Math.max(0, Math.min(d.frames.length - 1, i))];
    if (!flip) return f.c;
    if (!f.cf) {
      f.pf = f.pix.flipX();
      f.cf = PK.fine(f.pf);
    }
    return f.cf;
  }

  // Rozpad ležícího těla po jemných bodech (k = 0..8 zbývajících osmin).
  function deathDissolve(type, team, v, k, flip) {
    const d = death(type, team, v);
    const f = d.frames[d.frames.length - 1];
    const key = (flip ? "f" : "n") + k;
    if (!f.dis[key]) {
      if (flip && !f.pf) f.pf = f.pix.flipX();
      f.dis[key] = PK.fine((flip ? f.pf : f.pix).dissolve(k / 8));
    }
    return f.dis[key];
  }

  /* Padlé tělo (staré rozhraní): poslední snímek smrti. */
  function lying(type, team, flip, v = 0) {
    const d = death(type, team, v);
    const f = d.frames[d.frames.length - 1];
    return { pix: flip ? (f.pf || (f.pf = f.pix.flipX())) : f.pix, c: deathFrame(type, team, v, d.frames.length - 1, flip) };
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
    ghoul: [-4, 6], skeleton: [0, 4], abomination: [-4, 8], banshee: [-2, 5], lich: [-1, 3],
    monk: [-1, 4], knight: [2, 8], catapult: [0, 2],
    spearman: [-1, 4], crossbow: [-1, 4], scout: [2, 8], hound: [-6, 12], necromancer: [-1, 3], plague: [-3, 6]
  };

  const portraitCache = {};

  function portrait(type, team, frameIndex = 0) {
    team = PK.skin(team); // barva týmu navíc z výzev
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
    death, deathFrame, deathDissolve, variants: type => VARIANTS[type] || 1, hasAnim,
    types: Object.keys(RIGS)
  };
})();
