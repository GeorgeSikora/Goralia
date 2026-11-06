/*
 * Krajinné oblasti (biomy) pro pečení terénu ve world.js.
 *
 * Mapa se rozdělí na nepravidelné buňky (Voronoi s pokřivením souřadnic),
 * každá buňka dostane druh krajiny podle okolí: u vody písek a bažina,
 * u hor štěrk, skalní plotny a horská louka se sněhem, v teplých místech
 * step a vyprahlá zem, v chladných vřesoviště, jinde louka, kvítí, jetel,
 * podzim nebo bláto. Sousední buňky stejného druhu splývají v jednu oblast.
 *
 * Každý druh má "podklad" (tráva vlastního odstínu), který do sousední
 * oblasti přechází rozdithrovaným pásem, a případně "skvrny" (písek, štěrk,
 * plotny, bláto, tůně, sníh, puklá hlína). Skvrny mají čistý okraj:
 * tmavší lem na straně skvrny a stébla přerůstající přes okraj z trávy.
 * Pod stromy (map.trees) leží lesní půda: mech, jehličí, listí, větvičky.
 * Kolem popela pekla je pás zkažené zemně s fialovými žilkami.
 *
 * Všechno je jen vzhled: hra (sim) o oblastech neví. Tůně a louže jsou
 * v zóně BANK (šplouchají kroky, kulisy na ně nestaví), jinak tráva.
 * Kreslí se po jednotlivých jemných bodech (PK.HD = 2), nic se nezvětšuje.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const { C, Pix, mix, hash, fbm, vnoise, bayer, dither, clamp, smooth, rng } = PK;
  const G = C.g;
  const D = C.d;
  const S = C.s;

  /* ---------- druhy ---------- */
  const K = {
    MEADOW: 0, FLOWERS: 1, CLOVER: 2, STEPPE: 3, AUTUMN: 4, HEATH: 5, SAND: 6, GRAVEL: 7,
    SLABS: 8, MUD: 9, MARSH: 10, ALPINE: 11, CRACKED: 12
  };
  const NAMES = ["louka", "kvítí", "jetel", "step", "podzim", "vřesoviště", "písčina", "štěrk",
    "skalní plotny", "bláto", "bažina", "horská louka", "vyprahlá zem"];
  const NK = NAMES.length;

  /* ---------- palety (7 odstínů od stínu po světlo, stín do fialova, světlo do žluta) ---------- */
  const ramp = (...c) => c;
  const R = {
    clover: G.map((c, k) => mix(c, k < 3 ? 0x163f34 : 0x2f7a40, 0.32)),
    steppe: ramp(0x29312c, 0x45502f, 0x6a7236, 0x958e42, 0xbca855, 0xdcc874, 0xf2e6a6),
    autumn: ramp(0x272830, 0x40402e, 0x5e5c32, 0x7f7638, 0xa08c42, 0xbea45a, 0xdcc88a),
    heath: ramp(0x23262f, 0x353b33, 0x4f553a, 0x6b6f42, 0x8a8a4e, 0xaaa464, 0xccc68a),
    heather: ramp(0x2a1f3c, 0x452a58, 0x6a3a74, 0x91508c, 0xb46ea4, 0xd498c0, 0xf0c8e0),
    sand: ramp(0x4a3a3a, 0x7a6048, 0xa8875c, 0xc8a670, 0xe0c588, 0xf0dca6, 0xfbf0cc),
    mud: ramp(0x251c26, 0x3a2b2c, 0x523c34, 0x6a4e3c, 0x84644a, 0x9e7c5c, 0xbca080),
    marsh: ramp(0x18232a, 0x223430, 0x324838, 0x465c3e, 0x5c7046, 0x768652, 0x9aa66a),
    alpine: G.map(c => mix(c, C.t[2], 0.28)),
    snow: ramp(0x55607e, 0x7a88a8, 0xa2b0cc, 0xc6d2e6, 0xe2eaf4, 0xf6f9fc, 0xffffff),
    clay: ramp(0x3a2628, 0x5e3c32, 0x8a6446, 0xa88458, 0xbe9c6c, 0xd2b484, 0xe6cea4),
    moss: ramp(0x12222a, 0x183428, 0x22482e, 0x2e5e32, 0x427a38, 0x5e9640, 0x84b452),
    needles: ramp(0x241820, 0x3c2622, 0x5a3626, 0x7a4a2c, 0x9a6234, 0xba8044, 0xd8a460),
    wither: ramp(0x262632, 0x3c3c3a, 0x56563e, 0x707048, 0x8c8858, 0xa8a06c, 0xc4bc8c),
    blight: ramp(0x1c1826, 0x2b2434, 0x3e3446, 0x524456, 0x6a5868, 0x84707e, 0xa48e98),
    pool: ramp(0x101c28, 0x16283a, 0x1e3a4c, 0x2c5464, 0x4a7a86, 0x86b4bc, 0xd6eef0)
  };
  const LEAF = [0xc8603c, 0xd88a34, 0xe8b048, 0xa04034, 0xb87038, 0x8a4a2e];
  const RAMPS = [G, R.steppe, R.autumn, R.alpine, R.blight, R.marsh, R.heath, R.clover, R.sand];
  const RI = { grass: 0, steppe: 1, autumn: 2, alpine: 3, blight: 4, marsh: 5, heath: 6, clover: 7, sand: 8 };

  /* podklad a skvrny každého druhu
   * ground: index palety podkladu (-1 = výchozí louka z world.js)
   * ov: skvrny { sc měřítko šumu (art px), thr práh, cov jak brzy od okraje buňky začínají } */
  const DEF = [
    /* MEADOW  */ { ground: -1 },
    /* FLOWERS */ { ground: -1 },
    /* CLOVER  */ { ground: RI.clover, shift: -0.2 },
    /* STEPPE  */ { ground: RI.steppe, shift: 0.1 },
    /* AUTUMN  */ { ground: RI.autumn, shift: 0 },
    /* HEATH   */ { ground: RI.heath, shift: 0, ov: { sc: 7, thr: 0.5 } },
    /* SAND    */ { ground: RI.steppe, shift: 0.3, ov: { sc: 16, thr: 0.5 } },
    /* GRAVEL  */ { ground: RI.heath, shift: 0.3, ov: { sc: 11, thr: 0.5 } },
    /* SLABS   */ { ground: -1, ov: { sc: 9, thr: 0.58 } },
    /* MUD     */ { ground: RI.marsh, shift: 0.6, ov: { sc: 10, thr: 0.52 } },
    /* MARSH   */ { ground: RI.marsh, shift: 0.2, ov: { sc: 9, thr: 0.56 } },
    /* ALPINE  */ { ground: RI.alpine, shift: 0 },
    /* CRACKED */ { ground: RI.steppe, shift: -0.1, ov: { sc: 14, thr: 0.5 } }
  ];

  /* ---------- buňky ---------- */
  const CS = 88; // art px
  const WARP = 30;

  const distPoly = (x, y, pts) => {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const dx = bx - ax, dy = by - ay;
      const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
      best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
    }
    return best;
  };

  // stav aktivního pečení
  let B = null;

  function pickKind(cx, cy, h, ctx) {
    const { rec, W, H, forestAt, lushAt } = ctx;
    const x = clamp(cx, 0, W - 1), y = clamp(cy, 0, H - 1);
    let dw = 1e9, dm = 1e9, mhw = 0;
    for (const r of rec.rivers) if (r.pts) dw = Math.min(dw, distPoly(x, y, r.pts) - r.hw);
    for (const m of rec.mountains) {
      const d = distPoly(x, y, m.pts) - m.hw;
      if (d < dm) { dm = d; mhw = m.hw; }
    }
    let base = 1e9;
    for (const p of rec.plazas) base = Math.min(base, Math.hypot(x - p.x, (y - p.y) * 1.3));
    const hue = (fbm(x / 40, y / 40, 11, 3) - 0.5) * 6 + (0.5 - (x / W) * 0.55 - (y / H) * 0.45) * 2;
    const lush = lushAt(x, y);

    const w = new Float32Array(NK);
    w[K.MEADOW] = 4.5; w[K.FLOWERS] = 1.6; w[K.CLOVER] = 1.2; w[K.STEPPE] = 0.8 + (hue > 1 ? 1.6 : 0);
    w[K.AUTUMN] = 0.9; w[K.HEATH] = 0.9 + (hue < -1 ? 1.2 : 0); w[K.MUD] = 0.45; w[K.SLABS] = 0.8;
    w[K.CRACKED] = hue > 1.2 && dw > 40 ? 1.1 : 0.15; w[K.GRAVEL] = 0.3; w[K.MARSH] = 0.25;
    if (dw < 34) { w[K.SAND] += 3; w[K.MARSH] += 2.2; w[K.MUD] += 0.9; w[K.CRACKED] = 0; }
    if (dm < 36) { w[K.GRAVEL] += 2.4; w[K.SLABS] += 1.6; w[K.HEATH] += 1; }
    if (dm < 24) w[K.ALPINE] += mhw >= 10 ? 2.4 : 0.8;
    if (forestAt(x, y) > 0.6) { w[K.AUTUMN] += 1.2; w[K.CLOVER] += 0.6; w[K.CRACKED] = 0; w[K.SAND] *= 0.3; }
    // u základen a v okolí popela jen tráva, ať je dění čitelné
    if (base < 70 || lush < 0.85) for (const k of [K.SAND, K.GRAVEL, K.SLABS, K.MUD, K.MARSH, K.ALPINE, K.CRACKED, K.HEATH]) w[k] = 0;

    let sum = 0;
    for (let k = 0; k < NK; k++) sum += w[k];
    let r = h * sum;
    for (let k = 0; k < NK; k++) { r -= w[k]; if (r <= 0) return k; }
    return K.MEADOW;
  }

  // nejbližší buňka a vzdálenost k nejbližší buňce jiného druhu (výsledek v _k1, _k2, _m)
  let _k1 = 0, _k2 = 0, _m = 0;
  function cellAt(x, y) {
    const gx = Math.floor(x / CS), gy = Math.floor(y / CS);
    const { kinds, gw, px, py } = B;
    let d1 = 1e18, c1 = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const c = (gy + oy + 1) * gw + gx + ox + 1;
        const dx = x - px[c], dy = y - py[c];
        const dd = dx * dx + dy * dy;
        if (dd < d1) { d1 = dd; c1 = c; }
      }
    }
    const k1 = kinds[c1];
    const ax = px[c1], ay = py[c1];
    let m = CS, k2 = k1;
    const cx1 = c1 % gw, cy1 = (c1 / gw) | 0;
    for (let oy = -2; oy <= 2; oy++) {
      for (let ox = -2; ox <= 2; ox++) {
        const qx = cx1 + ox, qy = cy1 + oy;
        if (qx < 0 || qy < 0 || qx >= gw || qy >= B.gh) continue;
        const c = qy * gw + qx;
        if (kinds[c] === k1) continue;
        const bx = px[c] - ax, by = py[c] - ay;
        const len = Math.hypot(bx, by) || 1;
        const dist = (bx * ((ax + px[c]) / 2 - x) + by * ((ay + py[c]) / 2 - y)) / len;
        if (dist < m) { m = dist; k2 = kinds[c]; }
      }
    }
    _k1 = k1; _k2 = k2; _m = m;
  }

  const RR = R;

  /* ---------- příprava v art rozlišení ----------
   * ctx: { rec, map, W, H, lushAt, seed }; plní pole do F a do bundlu b:
   * b.bio (druh buňky po art px), F.bk2, F.bm (vzdálenost k jiné oblasti),
   * F.wx/F.wy (pokřivení), F.ov (skvrny), F.ov2 (tůně/louže/sníh), F.fo (les) */
  function prepare(bundle, F, ctx) {
    const { W, H, rec, map, rd } = ctx;
    const N = W * H;
    const seed = (rec.seed | 0) * 7 + 13;

    // hustota stromů: měkké skvrny kolem paty každého stromu
    const fo = new Float32Array(N);
    const RAD = 15;
    for (const [tx, ty] of map.trees || []) {
      const cx = tx / 2, cy = ty / 2 + 15;
      const x0 = Math.max(0, Math.floor(cx - RAD)), x1 = Math.min(W - 1, Math.ceil(cx + RAD));
      const y0 = Math.max(0, Math.floor(cy - RAD * 0.8)), y1 = Math.min(H - 1, Math.ceil(cy + RAD * 0.8));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const d = Math.hypot((x - cx) / RAD, (y - cy) / (RAD * 0.8));
          if (d < 1) fo[y * W + x] += (1 - d * d) * 0.75;
        }
      }
    }
    const forestAt = (x, y) => fo[(clamp(Math.round(y), 0, H - 1)) * W + clamp(Math.round(x), 0, W - 1)];

    // mřížka buněk s okrajem (gw x gh), středy rozházené uvnitř buňky
    const gw = Math.ceil(W / CS) + 3, gh = Math.ceil(H / CS) + 3;
    const px = new Float32Array(gw * gh), py = new Float32Array(gw * gh);
    const kinds = new Uint8Array(gw * gh);
    B = { kinds, gw, gh, px, py };
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const c = j * gw + i;
        const ci = i - 1, cj = j - 1;
        px[c] = (ci + 0.18 + hash(ci, cj, seed) * 0.64) * CS;
        py[c] = (cj + 0.18 + hash(ci, cj, seed + 1) * 0.64) * CS;
        kinds[c] = pickKind(px[c], py[c], hash(ci, cj, seed + 2), { ...ctx, forestAt });
      }
    }

    const bio = new Uint8Array(N);
    const bk2 = new Uint8Array(N);
    const bm = new Float32Array(N);
    const wx = new Float32Array(N), wy = new Float32Array(N);
    const ov = new Float32Array(N), ov2 = new Float32Array(N);

    // pole se počítají po blocích 2x2 art px (jsou hladká), hranice oblastí pak jemný průchod dopočítá přesně
    for (let y = 0; y < H; y += 2) {
      for (let x = 0; x < W; x += 2) {
        // pokřivení ve třech měřítkách: hranice oblastí nikde nejsou rovné
        const ux = (fbm(x / 48, y / 48, seed + 5, 3) - 0.5) * 2 * WARP + (fbm(x / 19, y / 19, seed + 9, 2) - 0.5) * 22 + (vnoise(x / 7, y / 7, seed + 7) - 0.5) * 6;
        const uy = (fbm(x / 48, y / 48, seed + 6, 3) - 0.5) * 2 * WARP + (fbm(x / 19, y / 19, seed + 10, 2) - 0.5) * 22 + (vnoise(x / 7, y / 7, seed + 8) - 0.5) * 6;
        cellAt(x + 0.5 + ux, y + 0.5 + uy);
        const def = DEF[_k1];
        let o1 = -1, o2 = -1; // mimo skvrny hluboko pod nulou, ať interpolace na hranici oblasti nic nevytvoří
        if (def.ov) {
          // skvrny: šum nad prahem, k okraji buňky slábnou (nikdy se nedotknou jiné oblasti)
          const cov = smooth(2, 9, _m);
          o1 = fbm(x / def.ov.sc, y / def.ov.sc, seed + 20 + _k1, 3) - def.ov.thr - (1 - cov) * 0.4;
          if (_k1 === K.MARSH) o2 = fbm(x / 7, y / 7, seed + 40, 2) - 0.54 - (1 - cov) * 0.5;
          else if (_k1 === K.MUD) o2 = fbm(x / 5, y / 5, seed + 41, 2) - 0.6 - (1 - cov) * 0.5;
        }
        for (let yy = y; yy < Math.min(H, y + 2); yy++) {
          for (let xx = x; xx < Math.min(W, x + 2); xx++) {
            const i = yy * W + xx;
            wx[i] = ux; wy[i] = uy;
            bio[i] = _k1; bk2[i] = _k2; bm[i] = _m;
            ov[i] = o1; ov2[i] = o2;
            // písčiny u vody tvoří pláž podél břehu
            if (_k1 === K.SAND && rd[i] < 14) ov[i] += smooth(14, 3, rd[i]) * 0.3;
          }
        }
      }
    }

    // vzdálenost od popela bez zrnitého šumu (pás zkažené země); bez popela se nepočítá
    let l0 = null;
    if (rec.ash.edge || rec.ash.circles.length) {
      l0 = new Float32Array(N);
      // širší pás než samotný popel: dosahuje ~1.35 poloměru kruhu
      for (let y = 0; y < H; y += 2) {
        for (let x = 0; x < W; x += 2) {
          const n = (fbm(x / 22, y / 22, 12, 2) - 0.5) * 30;
          let f = 1;
          if (rec.ash.edge) f = 1 - smooth(rec.ash.edge[0] - 40, rec.ash.edge[1], x + n);
          for (const [cx, cy, r] of rec.ash.circles) f = Math.min(f, smooth(r * 0.6, r * 1.35, Math.hypot(cx - x, cy - y) + n));
          for (let yy = y; yy < Math.min(H, y + 2); yy++) for (let xx = x; xx < Math.min(W, x + 2); xx++) l0[yy * W + xx] = f;
        }
      }
    }
    Object.assign(F, { bk2, bm, wx, wy, ov, ov2, fo, l0 });
    bundle.l0 = l0;
    bundle.bio = bio;
    b = bundle;
    return { bio };
  }

  const poolArt = (i, F, bd) => {
    const k = bd.bio[i];
    return (k === K.MARSH || k === K.MUD) && F.ov[i] > 0.03 && F.ov2[i] > 0;
  };
  const wetAt = ai => { const k = b.bio[ai]; return k === K.MUD || k === K.MARSH; };

  // břeh řeky podle oblasti; rs = vzdálenost od hladiny (art px, 0..2.6)
  function bank(ai, rs, fx, fy, na, nb) {
    const k = b.bio[ai];
    if (k === K.SAND || k === K.STEPPE || k === K.CRACKED) {
      if (rs < 0.4) return mix(R.sand[2], C.v[2], 0.3);
      if (rs < 0.7) return R.sand[2];
      const tt = 3.2 + (rs - 1) * 0.5 + (na - 0.5) * 1.2 + (nb - 0.5) * 0.6;
      if (hash(fx, fy, 161) > 0.992) return C.white;
      return R.sand[clamp(dither(tt, fx, fy, 0.4), 2, 5)];
    }
    if (k === K.GRAVEL || k === K.SLABS || k === K.ALPINE) {
      vor(fx, fy, 3.6, 162);
      if (_vd2 - _vd1 < 0.8) return rs < 0.8 ? mix(S[0], C.v[1], 0.4) : S[1];
      const lit = ((fx - _vpx) + (fy - _vpy)) / 3.6;
      const wet = rs < 1 ? -0.9 : 0;
      return S[clamp(dither(2.8 + (hash(_vcx, _vcy, 163) - 0.5) * 1.6 - lit + wet, fx, fy, 0.4), 1, 5)];
    }
    if (k === K.MARSH || k === K.MUD) {
      if (rs < 0.5) return mix(R.mud[1], C.v[1], 0.35);
      return R.mud[clamp(dither(1.8 + rs * 0.6 + (na - 0.5) * 1.4, fx, fy, 0.5), 1, 4)];
    }
    return -1;
  }

  /* ---------- hrubá barva (art px: minimapa, náhled, velké mapy bez jemného pečení) ---------- */
  function coarse(i, x, y, t, lush, F, b) {
    const k = b.bio[i];
    if (lush < 0.66) return R.blight[clamp(dither(t - 0.6, x, y, 0.5), 1, 5)];
    let c = -1;
    const def = DEF[k];
    if (def.ground >= 0) c = RAMPS[def.ground][clamp(dither(t + (def.shift || 0), x, y, 0.5), 1, 5)];
    if (def.ov && F.ov[i] > 0) c = overlayColor(k, x * 2, y * 2, t, F.ov[i], 0.5, 0.5);
    if (F.ov2[i] > 0 && def.ov) c = k === K.MARSH ? R.pool[2] : R.pool[3];
    if (F.fo[i] > 0.75 && c < 0) c = R.moss[clamp(dither(t - 0.3, x, y), 1, 5)];
    return c;
  }

  /* ---------- jemné textury skvrn ---------- */
  // Voronoi body v jemné mřížce: oblázky, plotny, kry hlíny
  let _vd1 = 0, _vd2 = 0, _vcx = 0, _vcy = 0, _vpx = 0, _vpy = 0, _vqx = 0, _vqy = 0;
  function vor(fx, fy, cs, s) {
    const gx = Math.floor(fx / cs), gy = Math.floor(fy / cs);
    let d1 = 1e9, d2 = 1e9;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const cx = gx + ox, cy = gy + oy;
        const px = (cx + 0.1 + hash(cx, cy, s) * 0.8) * cs;
        const py = (cy + 0.1 + hash(cx, cy, s + 1) * 0.8) * cs;
        const dd = (fx + 0.5 - px) ** 2 + (fy + 0.5 - py) ** 2;
        if (dd < d1) { d2 = d1; _vqx = _vpx; _vqy = _vpy; d1 = dd; _vcx = cx; _vcy = cy; _vpx = px; _vpy = py; }
        else if (dd < d2) { d2 = dd; _vqx = px; _vqy = py; }
      }
    }
    _vd1 = Math.sqrt(d1); _vd2 = Math.sqrt(d2);
  }

  // barva skvrny daného druhu; v = hloubka ve skvrně (0 = okraj), na/nb = jemný šum
  function overlayColor(k, fx, fy, t, v, na, nb) {
    const X = fx / 2, Y = fy / 2;
    switch (k) {
      case K.SAND: {
        // čeřiny: tenké světlé hřebeny, pod nimi stín, zvlněné podle šumu
        const ph = X * 0.55 + Y * 1.9 + vnoise(X / 9, Y / 9, 61) * 6;
        const r = ph - Math.floor(ph);
        let tt = 3.3 + (na - 0.5) * 0.9 + (nb - 0.5) * 0.8 + Math.min(v, 0.15) * 4;
        if (r < 0.12) tt += 1.1; else if (r < 0.24) tt -= 0.7;
        return R.sand[clamp(dither(tt, fx, fy, 0.4), 1, 6)];
      }
      case K.GRAVEL: {
        vor(fx, fy, 4.2, 81);
        const edge = _vd2 - _vd1;
        if (edge < 0.9) return mix(S[1], D[1], 0.4);
        const h = hash(_vcx, _vcy, 82);
        const lit = ((fx - _vpx) + (fy - _vpy)) / 4;
        let tt = 2.6 + (h - 0.5) * 1.8 - lit * 0.9;
        const ramp6 = h > 0.7 ? [D[0], D[1], D[2], D[3], D[4], D[5], D[5]] : S;
        return ramp6[clamp(dither(tt, fx, fy, 0.4), 1, 5)];
      }
      case K.SLABS: {
        vor(fx, fy, 11, 91);
        const edge = _vd2 - _vd1;
        const h = hash(_vcx, _vcy, 92);
        if (edge < 1.0) return (_vqx - _vpx) + (_vqy - _vpy) > 0 ? S[1] : S[3];
        const lit = ((fx - _vpx) + (fy - _vpy)) / 11;
        let tt = 3 + (h - 0.5) * 1.2 - lit * 0.8 + (na - 0.5) * 0.6;
        if (v < 0.02) tt = 1.2;
        // mech na plotnách
        if (fbm(X / 3, Y / 3, 93, 2) > 0.68 && nb > 0.45) return R.moss[clamp(dither(3.2 + (na - 0.5) * 2, fx, fy), 2, 5)];
        return S[clamp(dither(tt, fx, fy, 0.4), 1, 5)];
      }
      case K.MUD: {
        let tt = 2.8 + (na - 0.5) * 1.6 + (nb - 0.5) * 1.0 + Math.min(v, 0.12) * 5;
        // vlhký lesk a vyjeté rýhy
        if (Math.abs(vnoise(X / 5, Y / 2.2, 95) - 0.5) < 0.03) tt -= 1.2;
        if (hash(fx, fy, 96) > 0.985) tt += 1.5;
        return R.mud[clamp(dither(tt, fx, fy, 0.45), 1, 6)];
      }
      case K.MARSH: {
        // mokřina: tmavá rašelina s mechem
        const tt = 2.2 + (na - 0.5) * 1.6 + Math.min(v, 0.1) * 6;
        if (nb > 0.62) return R.moss[clamp(dither(tt + 0.6, fx, fy), 1, 5)];
        return R.mud[clamp(dither(tt - 0.4, fx, fy), 0, 4)];
      }
      case K.ALPINE: {
        // sníh: stínování od nerovností, modrý stín na spodní straně skvrny, třpyt
        let tt = 3.6 + Math.min(v, 0.12) * 9 + (na - 0.5) * 1.0 + (nb - 0.5) * 0.7;
        if (hash(fx, fy, 97) > 0.997) return 0xffffff;
        return R.snow[clamp(dither(tt, fx, fy, 0.35), 1, 6)];
      }
      case K.CRACKED: {
        vor(fx, fy, 9, 101);
        const edge = _vd2 - _vd1;
        if (edge < 0.55) return R.clay[1];
        // kry se u praskliny zvedají: světlá hrana na straně ke světlu, stín na protější
        if (edge < 1.3) return (_vqx - _vpx) + (_vqy - _vpy) < 0 ? R.clay[5] : R.clay[2];
        const h = hash(_vcx, _vcy, 102);
        const tt = 3.6 + (h - 0.5) * 0.7 + (na - 0.5) * 1.0 + (nb - 0.5) * 0.6;
        return R.clay[clamp(dither(tt, fx, fy, 0.45), 3, 5)];
      }
      case K.HEATH: {
        // vřes: shluky keříků osvětlené zleva shora
        vor(fx, fy, 5, 111);
        const r = 2.2 + hash(_vcx, _vcy, 112) * 1.6;
        const dx = (fx + 0.5 - _vpx) / r, dy = (fy + 0.5 - _vpy) / r;
        if (dx * dx + dy * dy > 1) return -1;
        let tt = 3.6 - (dx + dy) * 1.2 + (hash(_vcx, _vcy, 113) - 0.5) * 1.4;
        if (dx + dy > 0.8) tt -= 1;
        const c = R.heather[clamp(dither(tt, fx, fy, 0.4), 1, 6)];
        // zelené výhonky mezi kvítky
        return hash(fx, fy, 114) > 0.84 ? R.heath[clamp(dither(tt - 0.5, fx, fy), 1, 5)] : c;
      }
    }
    return -1;
  }

  /* ---------- jemný průchod ----------
   * o: { fx, fy, X, Y, ai, na, nb, tone, lush, z, deco, bil, rs }
   * Vrací barvu podkladu nebo -1 (výchozí louka ve world.js); o.z může změnit na BANK (tůně, louže).
   * o.kind = druh oblasti v bodě (pro drobnosti). */
  let F = null, b = null, ZB = 6, ZG = 0;

  function fineBegin(bundle, fields, zones) {
    b = bundle; F = fields; ZB = zones.bank; ZG = zones.grass;
  }

  // Oblast v bodě: druh art px, vzdálenost k jiné oblasti se interpoluje. Na hranici se oba druhy
  // prolínají ditheringem s pravděpodobností 1/2, takže schody po blocích 2x2 nejsou vidět.
  function kindAt(o) {
    o.k2 = F.bk2[o.ai];
    o.m = o.bil(F.bm, o.fx);
    return b.bio[o.ai];
  }

  function groundOf(k, o, t) {
    const def = DEF[k];
    if (def.ground < 0) return -1;
    const rp = RAMPS[def.ground];
    let tt = t + (def.shift || 0);
    if (k === K.STEPPE || k === K.SAND) {
      // dlouhá stébla: svislé tahy
      tt += (hash(o.fx, (o.fy + ((hash(o.fx, 0, 121) * 4) | 0)) >> 2, 122) - 0.5) * 1.3;
    } else if (k === K.AUTUMN) {
      // koberec spadaného listí ve skvrnách
      const lv = fbm(o.X / 9, o.Y / 9, 123, 2);
      if (lv > 0.6 && o.na > 0.42) {
        const h = hash(o.fx >> 1, o.fy >> 1, 124);
        const c = LEAF[(h * LEAF.length) | 0];
        return o.na - 0.5 + (o.nb - 0.5) * 0.4 < -0.05 ? mix(c, C.shade, 0.35) : o.na > 0.68 ? mix(c, C.a[3], 0.3) : c;
      }
    }
    return rp[clamp(dither(tt, o.fx, o.fy, 0.5), 1, 5)];
  }

  function fine(o) {
    const k = kindAt(o);
    o.kind = k;
    o.okind = -1;
    const t = o.tone;
    const def = DEF[k];
    let col = groundOf(k, o, t);

    // měkký přechod do sousední oblasti (pás ~3 art px, rozdithrovaný)
    const m = o.m + (o.na - 0.5) * 1.6 + (o.nb - 0.5) * 1.2;
    if (o.k2 !== k && m < 3) {
      if (bayer(o.fx, o.fy) * 0.85 + 0.075 > 0.5 + m / 6) {
        col = groundOf(o.k2, o, t);
        o.kind = o.k2;
      }
    }

    // zkažená zem kolem popela: mrtvá tráva s fialovými žilkami
    const l0 = F.l0 ? o.bil(F.l0, o.fx) + (o.na - 0.5) * 0.08 + (o.nb - 0.5) * 0.06 : 2;
    if (l0 < 0.99) {
      const bl = smooth(0.99, 0.62, l0);
      if (bl > bayer(o.fx, o.fy)) {
        o.kind = -2;
        // vnější pás: vadnoucí tráva, blíž k popelu mrtvá šedofialová se žilkami
        if (l0 > 0.76) return R.wither[clamp(dither(t - 0.2 + (hash(o.fx, o.fy >> 2, 130) - 0.5) * 1.2, o.fx, o.fy, 0.5), 1, 5)];
        const vein = Math.abs(fbm(o.X / 7, o.Y / 7, 131, 3) - 0.5);
        if (vein < 0.012 && l0 < 0.72) return l0 < 0.58 && o.nb > 0.5 ? C.m[2] : C.m[1];
        if (vein < 0.024 && l0 < 0.72) return R.blight[1];
        return R.blight[clamp(dither(t - 0.5 + (hash(o.fx, o.fy >> 2, 132) - 0.5) * 1.1, o.fx, o.fy, 0.5), 1, 5)];
      }
    }

    // skvrny s čistým okrajem
    if (def.ov) {
      const v = o.bil(F.ov, o.fx) + (o.na - 0.5) * 0.05 + (o.nb - 0.5) * 0.03;
      if (v > 0) {
        if (k === K.HEATH) {
          const hc = overlayColor(k, o.fx, o.fy, t, v, o.na, o.nb);
          if (hc >= 0) { o.okind = k; return hc; }
        } else {
          o.okind = k;
          // tůně a louže
          if (k === K.MARSH || k === K.MUD) {
            const p = o.bil(F.ov2, o.fx) + (o.na - 0.5) * 0.04;
            if (p > 0 && v > 0.03) {
              o.z = ZB;
              o.okind = 100 + k;
              return poolColor(o, p, k);
            }
            if (p > -0.025 && v > 0.03) return k === K.MUD ? R.mud[1] : R.mud[0];
          }
          // tmavý lem na okraji skvrny (sníh: modrý stín, písek: vlhčí hrana)
          if (v < 0.018) return k === K.ALPINE ? R.snow[1] : k === K.SAND ? R.sand[2] : k === K.GRAVEL ? S[1] : k === K.CRACKED ? R.clay[1] : k === K.SLABS ? S[0] : R.mud[1];
          if (k === K.ALPINE && v < 0.04 && o.bil(F.ov, Math.max(0, o.fx - 2)) > v) return R.snow[2];
          return overlayColor(k, o.fx, o.fy, t, v, o.na, o.nb);
        }
      } else if (v > -0.03 && k !== K.HEATH) {
        // tráva těsně u skvrny: tmavší, stébla přes okraj
        if (k === K.SLABS && v > -0.03 && o.bil(F.ov, Math.max(0, o.fx - 3)) > 0.01) return mix(col < 0 ? G[2] : col, C.shade, 0.45);
        const gc = col < 0 ? G[clamp(dither(t - 1.2, o.fx, o.fy), 1, 3)] : mix(col, C.shade, 0.25);
        if (v > -0.014) return gc;
        if (hash(o.fx, o.fy, 133) > 0.82) o.okind = -3; // stébla přes okraj
      }
    }

    // lesní půda pod stromy
    const fo = o.bil(F.fo, o.fx) + (o.na - 0.5) * 0.35 + (o.nb - 0.5) * 0.2;
    if (fo > 0.66 && o.okind < 0) {
      o.okind = -4;
      const needles0 = o.kind === K.STEPPE || o.kind === K.HEATH || o.kind === K.ALPINE || vnoise(o.X / 34, o.Y / 34, 134) > 0.6;
      const needles = needles0;
      if (fo < 0.68) return needles ? mix(R.needles[1], G[1], 0.4) : R.moss[1];
      if (o.kind === K.AUTUMN && o.na > 0.4) {
        const c = LEAF[(hash(o.fx >> 1, o.fy >> 1, 135) * LEAF.length) | 0];
        return o.nb > 0.6 ? mix(c, C.shade, 0.3) : c;
      }
      if (needles) {
        const tt = 3 + (o.na - 0.5) * 1.8 + (hash(o.fx + (o.fy >> 1), o.fy, 136) - 0.5) * 1.6;
        return mix(R.needles[clamp(dither(tt, o.fx, o.fy, 0.4), 1, 5)], G[2], 0.3);
      }
      // mech: shluky osvětlené zleva shora
      vor(o.fx, o.fy, 4, 137);
      const dx = (o.fx + 0.5 - _vpx) / 2.6, dy = (o.fy + 0.5 - _vpy) / 2.6;
      let tt = 2.6 - (dx + dy) * 0.9 + (hash(_vcx, _vcy, 138) - 0.5) * 1.2 + (fo - 0.8) * 1.5;
      if (dx * dx + dy * dy > 1) tt -= 1.2;
      return R.moss[clamp(dither(tt, o.fx, o.fy, 0.45), 1, 5)];
    }

    return col;
  }

  const ICE = [0x5a6c88, 0x8aa0bc, 0xb4c8dc, 0xd4e2ee, 0xeef4fa];
  function poolColor(o, p, k) {
    if (PK.winter && PK.winter.on) {
      // v zimě zamrzlé tůně: tmavý okraj, světlý led s prasklinkami
      if (p < 0.012) return ICE[0];
      if (hash(o.fx >> 2, o.fy >> 1, 143) > 0.93 && hash(o.fx, o.fy, 144) > 0.3) return ICE[1];
      return ICE[clamp(dither(2.6 + (o.na - 0.5) * 1.6 + Math.min(1, p * 10) * 0.6, o.fx, o.fy, 0.3), 2, 4)];
    }
    // tůň: tmavá voda, světlejší okraj s řasou, odraz oblohy ve vlnkách
    if (p < 0.012) return k === K.MUD ? R.mud[0] : R.pool[0];
    if (p < 0.03) return k === K.MARSH && o.nb > 0.5 ? R.marsh[3] : R.pool[2];
    const sky = Math.sin(o.Y * 2.1 + vnoise(o.X / 4, o.Y / 4, 141) * 5);
    // louže v blátě odráží světlou oblohu, tůně v bažině jsou hluboké a tmavé
    let tt = (k === K.MUD ? 3.8 : 2) + Math.min(1, (p - 0.03) * 8) * (k === K.MUD ? -0.4 : -0.6) + (sky > 0.9 ? 1.4 : 0);
    if (k === K.MARSH && hash(o.fx, o.fy, 142) > 0.97) return R.marsh[4]; // okřehek
    return R.pool[clamp(dither(tt, o.fx, o.fy, 0.4), 1, 5)];
  }

  /* ---------- drobnosti (razítka) ----------
   * deco(o, h) se volá pro volnou trávu; vrací true, když drobnosti obstaral biom. */
  const KD = {
    LEAF: 10, HEATHER: 11, SHELL: 12, REED: 14, CLOVER: 15, NEEDLE: 17, SHROOM: 18, LILY: 21,
    PRINT: 22, PUFF: 23, GORSE: 24, TWIG: 25, BLADES: 26, SNOWTIP: 27, GENTIAN: 28, EDELWEISS: 29, PEBBLE: 1, FLOWER: 3, GRASS: 0
  };

  function deco(o, h, push) {
    const k = o.okind;
    const kd = o.kind;
    const { fx, fy } = o;
    if (k === 110) { // tůň v bažině
      if (h > 0.996) push(KD.LILY, fx, fy, 0);
      return true;
    }
    if (k === 109) return true; // louže
    if (k === -3) { push(KD.BLADES, fx, fy, RI.grass * 10 + 3); return true; }
    if (k === -4) {
      if (h > 0.996) push(KD.TWIG, fx, fy, 0);
      else if (h > 0.9935) push(KD.SHROOM, fx, fy, 0);
      else if (h < 0.03) push(KD.NEEDLE, fx, fy, 0);
      return true;
    }
    if (k === K.SAND) {
      if (h > 0.997) push(KD.SHELL, fx, fy, 0);
      else if (h > 0.994) push(KD.PEBBLE, fx, fy, 0);
      return true;
    }
    if (k === K.GRAVEL || k === K.SLABS || k === K.CRACKED) return true;
    if (k === K.MUD) {
      if (h > 0.996) push(KD.PRINT, fx, fy, 0);
      else if (h > 0.994) push(KD.PEBBLE, fx, fy, 0);
      return true;
    }
    if (k === K.MARSH) {
      if (h > 0.985) push(KD.REED, fx, fy, 0);
      return true;
    }
    if (k === K.HEATH) {
      if (h > 0.985) push(KD.GORSE, fx, fy, 0);
      return true;
    }
    if (kd === -2) {
      if (h < 0.02) push(KD.BLADES, fx, fy, RI.blight * 10 + 3);
      return true;
    }
    const tone = clamp(Math.round(o.tone), 1, 5);
    switch (kd) {
      case K.FLOWERS: {
        const fl = fbm(o.X / 11, o.Y / 11, 151, 2);
        if (h > 0.985 - fl * 0.035) push(KD.FLOWER, fx, fy, 1 + ((hash((fx / 30) | 0, (fy / 30) | 0, 152) * 4) | 0));
        else if (h < 0.04) push(KD.GRASS, fx, fy, o.tone);
        return true;
      }
      case K.CLOVER:
        if (h > 0.996) push(KD.CLOVER, fx, fy, 1); // kvetoucí jetel
        else if (h > 0.972) push(KD.CLOVER, fx, fy, 0);
        else if (h < 0.03) push(KD.BLADES, fx, fy, RI.clover * 10 + tone);
        return true;
      case K.STEPPE:
        if (h > 0.997) push(KD.PUFF, fx, fy, 0);
        else if (h < 0.05) push(KD.BLADES, fx, fy, RI.steppe * 10 + tone);
        return true;
      case K.AUTUMN:
        if (h > 0.982) push(KD.LEAF, fx, fy, 0);
        else if (h < 0.03) push(KD.BLADES, fx, fy, RI.autumn * 10 + tone);
        return true;
      case K.HEATH:
        if (h < 0.04) push(KD.BLADES, fx, fy, RI.heath * 10 + tone);
        return true;
      case K.MARSH: case K.MUD:
        if (h < 0.05) push(KD.BLADES, fx, fy, RI.marsh * 10 + tone);
        else if (h > 0.996) push(KD.REED, fx, fy, 0);
        return true;
      case K.ALPINE:
        // horská louka: hořce, protěže, kamínky
        if (h < 0.035) push(KD.BLADES, fx, fy, RI.alpine * 10 + tone);
        else if (h > 0.9955) push(KD.GENTIAN, fx, fy, 0);
        else if (h > 0.993) push(KD.EDELWEISS, fx, fy, 0);
        else if (h > 0.991) push(KD.PEBBLE, fx, fy, 0);
        return true;
      case K.SAND: case K.GRAVEL: case K.CRACKED:
        if (h < 0.035) push(KD.BLADES, fx, fy, RI.steppe * 10 + tone);
        return true;
    }
    return false; // louka: výchozí drobnosti world.js
  }

  // api: { setIf, at, getC, RS, Z }
  function stamp(kind, x, y, a, api) {
    const { setIf, at, getC, RS, Z } = api;
    switch (kind) {
      case KD.BLADES: {
        const rp = RAMPS[(a / 10) | 0];
        const tn = clamp(a % 10, 1, 5);
        const nbl = 2 + ((RS() * 3) | 0);
        for (let k = 0; k < nbl; k++) {
          const bx = x + k * 2 - nbl + 1 + (RS() < 0.3 ? 1 : 0);
          const hgt = 2 + ((RS() * 3) | 0);
          const lean = RS() < 0.33 ? -1 : RS() < 0.5 ? 1 : 0;
          if (at(bx, y) !== Z.GRASS) continue;
          setIf(bx + 1, y + 1, rp[Math.max(0, tn - 2)]);
          for (let s = 0; s < hgt; s++) {
            const px = bx + (s === hgt - 1 ? lean : 0);
            setIf(px, y - s, s === hgt - 1 ? rp[Math.min(6, tn + 2)] : s === 0 ? rp[Math.max(1, tn - 1)] : rp[Math.min(5, tn + 1)]);
          }
        }
        return;
      }
      case KD.LEAF: {
        // list: dva až tři body, tmavší spodní hrana a řapík
        const c = LEAF[(RS() * LEAF.length) | 0];
        const flip = RS() < 0.5;
        setIf(x, y, mix(c, C.a[3], 0.25), Z.GRASS);
        setIf(x + (flip ? -1 : 1), y, c, Z.GRASS);
        setIf(x, y + 1, mix(c, C.shade, 0.35), Z.GRASS);
        if (RS() < 0.5) setIf(x + (flip ? 1 : -1), y + 1, mix(c, C.shade, 0.6), Z.GRASS);
        setIf(x + (flip ? -1 : 1) + (flip ? -1 : 1), y + 1, mix(getC(x, Math.min(y + 2, 9e9)), C.shade, 0.3), Z.GRASS);
        return;
      }
      case KD.SHELL: {
        // mušle: světlý oblouček s růžovým nádechem a stínem
        setIf(x, y, C.white); setIf(x + 1, y, 0xf0d0c0); setIf(x - 1, y + 1, 0xe8c8b8); setIf(x, y + 1, 0xd8a898);
        setIf(x + 1, y + 1, 0xb88880); setIf(x + 2, y + 1, mix(getC(x + 2, y + 1), C.shade, 0.4));
        return;
      }
      case KD.REED: {
        // rákos: tři tenká stébla, jedno s orobincem
        const top = [C.a[3], R.marsh[6], R.marsh[5]];
        for (let k = 0; k < 3; k++) {
          const bx = x + k * 2 - 2;
          const hgt = 5 + ((RS() * 4) | 0);
          for (let s = 0; s < hgt; s++) setIf(bx + (s > hgt - 3 && k === 0 ? -1 : 0), y - s, s < 2 ? R.marsh[2] : s > hgt - 2 ? top[k] : R.marsh[4]);
          if (k === 1) { setIf(bx, y - hgt, 0x5a3626); setIf(bx, y - hgt - 1, 0x7a4a2c); setIf(bx, y - hgt - 2, 0x5a3626); }
        }
        setIf(x + 1, y + 1, R.marsh[1]);
        return;
      }
      case KD.CLOVER: {
        // trojlístek: tři světlé lístky kolem tmavého středu
        const c = mix(G[5], 0xe8f0a0, 0.15);
        setIf(x, y - 1, c, Z.GRASS); setIf(x - 1, y, c, Z.GRASS); setIf(x + 1, y, G[4], Z.GRASS); setIf(x, y, G[2], Z.GRASS);
        setIf(x, y + 1, G[1], Z.GRASS);
        if (a) {
          // kulatá hlavička jetele: bílá nebo růžová, světlá nahoře
          const pink = RS() < 0.45;
          const c1 = pink ? 0xf0a0c0 : C.white, c2 = pink ? 0xc06090 : 0xd8d4cc;
          setIf(x, y - 3, c1); setIf(x - 1, y - 2, c1); setIf(x, y - 2, c1); setIf(x + 1, y - 2, c2); setIf(x, y - 1, c2);
        }
        return;
      }
      case KD.NEEDLE: {
        // jehličí: krátká šikmá čárka
        const c = R.needles[3 + ((RS() * 3) | 0)];
        const dx = RS() < 0.5 ? 1 : -1;
        setIf(x, y, c, Z.GRASS); setIf(x + dx, y + 1, c, Z.GRASS); setIf(x + dx * 2, y + 1, R.needles[2], Z.GRASS);
        return;
      }
      case KD.TWIG: {
        // větvička: tři až pět bodů s odbočkou, stín pod ní
        const len = 3 + ((RS() * 3) | 0);
        const dy = RS() < 0.5 ? 0 : 1;
        for (let s = 0; s < len; s++) {
          setIf(x + s, y + ((s * dy) >> 1), s === 0 ? C.w[4] : C.w[3], Z.GRASS);
          setIf(x + s + 1, y + ((s * dy) >> 1) + 1, R.moss[0], Z.GRASS);
        }
        setIf(x + 2, y - 1, C.w[3], Z.GRASS);
        return;
      }
      case KD.SHROOM: {
        // houbička 3x3: klobouček s tečkou, nožka, stín
        const red = RS() < 0.5;
        const cap = red ? C.cap[1] : 0xc49064;
        setIf(x - 1, y, mix(cap, C.shade, 0.3)); setIf(x, y, red ? C.white : mix(cap, C.white, 0.35)); setIf(x + 1, y, cap);
        setIf(x, y - 1, red ? C.cap[2] : mix(cap, C.white, 0.2));
        setIf(x, y + 1, 0xe8dcc8); setIf(x + 1, y + 1, mix(getC(x + 1, y + 1), C.shade, 0.4));
        return;
      }
      case KD.LILY: {
        // leknín: kulatý list s výřezem, občas květ
        const r = 2 + (RS() < 0.4 ? 1 : 0);
        for (let yy = -r; yy <= r; yy++) {
          for (let xx = -r - 1; xx <= r + 1; xx++) {
            const d = (xx * xx) / ((r + 1) * (r + 1)) + (yy * yy) / (r * r);
            if (d > 1) continue;
            if (xx > 0 && Math.abs(yy) < 1 && xx < r) continue; // výřez
            const c = d > 0.6 && (xx + yy) > 0 ? R.marsh[2] : (xx + yy) < -1 ? R.marsh[6] : R.marsh[4];
            setIf(x + xx, y + yy, c);
          }
        }
        if (RS() < 0.35) { setIf(x - 1, y - 1, C.white); setIf(x, y - 1, 0xffd0e0); setIf(x - 1, y - 2, 0xfff0f4); setIf(x, y - 2, C.a[3]); }
        return;
      }
      case KD.PRINT: {
        // stopa kopyta v blátě: tmavý půlměsíc s vodou
        setIf(x, y, R.mud[1]); setIf(x + 1, y, R.mud[1]); setIf(x - 1, y + 1, R.mud[1]); setIf(x + 2, y + 1, R.mud[1]);
        setIf(x, y + 1, R.pool[3]); setIf(x + 1, y + 1, R.pool[4]); setIf(x, y + 2, R.mud[4]); setIf(x + 1, y + 2, R.mud[4]);
        return;
      }
      case KD.PUFF: {
        // odkvetlá pampeliška: bílá chmýří na stonku
        setIf(x, y - 3, C.white); setIf(x - 1, y - 2, 0xe8e4d8); setIf(x + 1, y - 2, 0xd8d4cc); setIf(x, y - 2, C.white);
        setIf(x, y - 1, R.steppe[3]); setIf(x, y, R.steppe[2]); setIf(x + 1, y + 1, R.steppe[1]);
        return;
      }
      case KD.GORSE: {
        // žlutý kvítek kručinky
        setIf(x, y, C.a[2], Z.GRASS); setIf(x + 1, y, C.a[1], Z.GRASS); setIf(x, y - 1, C.a[3], Z.GRASS); setIf(x, y + 1, R.heath[2], Z.GRASS);
        return;
      }
      case KD.GENTIAN: {
        // hořec: modrý zvonek se světlým okrajem na stonku
        setIf(x, y - 2, 0x6fb2f0, Z.GRASS); setIf(x + 1, y - 2, 0x2850a0, Z.GRASS);
        setIf(x, y - 1, 0x3f7fd0, Z.GRASS); setIf(x + 1, y - 1, 0x1c2f66, Z.GRASS);
        setIf(x, y, R.alpine[2], Z.GRASS); setIf(x - 1, y, R.alpine[4], Z.GRASS);
        return;
      }
      case KD.EDELWEISS: {
        // protěž: bílá hvězdička se žlutým středem
        setIf(x, y - 1, 0xe8ecf0, Z.GRASS); setIf(x - 1, y, 0xf4f6f8, Z.GRASS); setIf(x + 1, y, 0xc0c8d4, Z.GRASS);
        setIf(x, y + 1, 0xc0c8d4, Z.GRASS); setIf(x, y, C.a[2], Z.GRASS);
        return;
      }
      case KD.SNOWTIP: {
        // stébla trčící ze sněhu se stínem ve sněhu
        setIf(x, y, R.alpine[2]); setIf(x, y - 1, R.alpine[3]); setIf(x + 1, y - 2, R.alpine[4]);
        setIf(x + 2, y, R.snow[2]); setIf(x + 1, y + 1, R.snow[2]);
        return;
      }
    }
  }

  /* ---------- houpající se trsy podle oblasti ---------- */
  // druhy trsů: 0 tráva, 1 step, 2 podzim, 3 horská, 4 zkažená, 5 rákos, 6 bažina, 7 jetel
  const REED = 5;
  const TUFT_KINDS = [G, R.steppe, R.autumn.map((c, k) => mix(c, LEAF[1], k > 2 ? 0.25 : 0)), R.alpine, R.blight, null, R.marsh, R.clover];
  function tuftKind(bd, i) {
    if (!bd || !bd.bio) return 0;
    if (bd.l0 && bd.l0[i] < 0.8) return 4;
    switch (bd.bio[i]) {
      case K.STEPPE: case K.SAND: case K.CRACKED: return 1;
      case K.AUTUMN: return 2;
      case K.ALPINE: return 3;
      case K.MARSH: case K.MUD: return 6;
      case K.CLOVER: return 7;
    }
    return 0;
  }

  function reedFrames() {
    const frames = [];
    // v zimě suchý slámový rákos
    const R = PK.winter && PK.winter.on
      ? { marsh: [0x3c3a40, 0x5e5a55, 0x807862, 0x9e9474, 0xbab094, 0xd8d6cc, 0xf4f6fa] }
      : RR;
    for (let f = 0; f < 3; f++) {
      const P = new Pix(14, 22);
      const lean = f - 1;
      const stems = [[4, 18, 1], [7, 21, 0], [9, 15, 2], [2, 12, 2], [11, 11, 1]];
      for (let x = 5; x < 10; x++) P.set(x, 21, R.marsh[1]);
      for (const [bx, h, kind] of stems) {
        for (let k = 0; k < h; k++) {
          const bend = lean * (k * k) / (h * h) * 2.4;
          const x = Math.round(bx + bend);
          P.set(x, 20 - k, k < 3 ? R.marsh[2] : k > h - 3 ? R.marsh[6] : (bx < 7 ? R.marsh[5] : R.marsh[4]));
        }
        if (kind === 0) {
          // orobinec: hnědý doutník se světlou hranou
          const x = Math.round(bx + lean * 2.4);
          for (let k = 0; k < 4; k++) { P.set(x, 20 - h + 1 + k, k === 0 ? 0x9a6234 : 0x5a3626); P.set(x + 1, 20 - h + 1 + k, 0x3c2622); }
          P.set(x, 20 - h, R.marsh[4]);
        }
      }
      frames.push(PK.fine(P));
    }
    return frames;
  }

  PK.biomes = {
    K, NAMES, R, RAMPS, KD,
    prepare, coarse, poolArt, wetAt, bank, fineBegin, fine, deco, stamp, tuftKind, reedFrames, REED, tuftKinds: TUFT_KINDS,
    // po upečení uvolnit pomocná pole (desítky MB na velkých mapách)
    end() { F = null; B = null; }
  };
})();
