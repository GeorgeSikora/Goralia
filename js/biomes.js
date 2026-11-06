/*
 * Krajiny map (biomy): přebarvení terénu, trsů trávy, lesa za okrajem a výběr stromů.
 * Mapa má hlavní krajinu (map.terrain.theme) a může mít kruhové oblasti jiných krajin
 * (map.terrain.biomes = [[krajina, x, y, poloměr], ...] v art px). Přechody jsou rozptýlené
 * Bayerovým rastrem, takže zůstávají čistě pixelové; barvy se mapují po stupních palety trávy,
 * takže stínování, stébla a zrnitost terénu zůstanou a mění se jen odstín.
 * Zimu (sníh, led) kreslí winter.js; tady jen ojíněné oblasti zimy uvnitř jiné krajiny.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const { C, fbm, bayer, hash, mix } = PK;

  // 7 stupňů jako C.g (od nejtmavšího po nejsvětlejší)
  const RAMPS = {
    meadow: [C.g],
    autumn: [
      [0x23302c, 0x384a30, 0x546434, 0x77803c, 0x9b9a46, 0xc1bb64, 0xe4dc98], // olivová
      [0x2a2a22, 0x4a4026, 0x6e5a2a, 0x957a34, 0xbf9a3e, 0xddbf5c, 0xf2e09a], // zlatá
      [0x2b1e22, 0x4a2a24, 0x6e3a26, 0x96502c, 0xbd6c34, 0xdb9450, 0xf2c486] // rezavá
    ],
    winter: [[0x2c3a48, 0x41566a, 0x5f7a8c, 0x88a2b0, 0xb2c8d0, 0xd6e4e8, 0xf4f8f6]],
    swamp: [
      [0x1a2622, 0x26352c, 0x334530, 0x465836, 0x5e6e40, 0x7e8a52, 0xa8ad74], // bahnitá
      [0x132a30, 0x1b3d40, 0x255243, 0x34684a, 0x4a8252, 0x6f9e66, 0xa4c488] // mechová
    ],
    highland: [
      [0x1e3434, 0x2b4a3c, 0x3d613f, 0x587a4a, 0x7a9558, 0xa3b272, 0xd0d29a], // suchá tráva
      [0x2a2236, 0x40304a, 0x5a3f5c, 0x7a5272, 0x9c6a88, 0xbf8ea4, 0xe2bccb] // vřes
    ],
    wastes: [
      [0x1e2328, 0x2b3330, 0x3b4536, 0x50583e, 0x6a6e4a, 0x8c8a62, 0xb4ae86], // seschlá
      [0x221f26, 0x332d33, 0x47403f, 0x5e554c, 0x7a6e5e, 0x9a8c76, 0xbfb29a] // prašná
    ]
  };

  // Cesty a břehy: bažina má tmavé bahno, pustina popelavou hlínu.
  const DIRT = {
    swamp: [0x2a2423, 0x3d322c, 0x54463a, 0x6c5c48, 0x857356, 0xa69072],
    wastes: [0x2e2827, 0x463b36, 0x5f5149, 0x7a6a5c, 0x998672, 0xbaa892]
  };

  // Jaké stromy rostou: [druh, váha]; druhy viz props.js treeVariant
  // (0 dub, 1 smrk, 2 vrba, 3 podzimní dub, 4 modrý smrk, 5 jarní dub).
  const TREES = {
    autumn: [[3, 6], [0, 1.2], [1, 2], [5, 0.4]],
    winter: [[1, 5], [4, 4], [0, 1]],
    swamp: [[2, 6], [1, 2], [0, 1.5], [4, 0.6]],
    highland: [[1, 5], [4, 3], [0, 1.2], [3, 0.8]],
    wastes: [[4, 4], [1, 3], [3, 1.5], [2, 1]]
  };

  /* Jemné pečení terénu (world.js) kreslí trávu v pěti odstínech (GH) a vyprahlou (DRY), všechno odvozené
   * od C.g. Každá taková barva se pozná podle stupně k a odstínu v a přebarví se stejným posunem v nové stupnici
   * (jen slabším, aby podzim nebo bažina nezmodraly). */
  const VARIANTS = [
    [c => mix(c, C.t[1], 0.45), c => mix(c, C.t[1], 0.18)],
    [c => mix(c, C.t[2], 0.22), c => mix(c, C.t[2], 0.1)],
    [c => c, c => c],
    [c => mix(c, C.a[2], 0.2), c => mix(c, C.a[2], 0.12)],
    [(c, k) => mix(c, k > 3 ? C.a[3] : C.d[3], 0.4), (c, k) => mix(c, k > 3 ? C.a[3] : C.d[3], 0.2)],
    [c => mix(c, C.d[2], 0.35), c => mix(c, C.d[2], 0.3)] // vyprahlá tráva u popela
  ];
  const IDX = new Map(); // barva -> [stupeň, odstín]
  VARIANTS.forEach(([src], v) => C.g.forEach((c, k) => { const x = src(c, k); if (!IDX.has(x)) IDX.set(x, [k, v]); }));
  const shifted = new Map(); // stupnice -> odstíny -> barvy
  const shade = (ramp, k, v) => {
    let t = shifted.get(ramp);
    if (!t) { t = VARIANTS.map(([, dst]) => ramp.map((c, i) => dst(c, i))); shifted.set(ramp, t); }
    return t[v][k];
  };
  const DIDX = new Map(C.d.map((c, i) => [c, i]));
  const THEMES = Object.keys(RAMPS);
  const has = (rc) => !!rc && ((rc.theme && rc.theme !== "meadow") || (rc.biomes && rc.biomes.length));

  // Oblast jiné krajiny v bodě (art px): [krajina, váha 0..1] nejsilnější oblasti, okraj je zvlněný šumem.
  function regionAt(rc, x, y) {
    let best = null;
    let w = 0;
    if (!rc.biomes || !rc.biomes.length) return [null, 0];
    const n = (fbm(x / 22, y / 22, 91, 2) - 0.5) * 0.5;

    for (const [t, cx, cy, r] of rc.biomes) {
      const d = Math.hypot(x - cx, y - cy) / r + n;
      const k = d < 0.7 ? 1 : d > 1 ? 0 : (1 - d) / 0.3;
      if (k > w) { w = k; best = t; }
    }

    return [best, w];
  }

  // Výběr stupnice v rámci krajiny: velké skvrny (podzimní zlato a rez, vřes na vysočině…).
  function subRamp(theme, x, y, X, Y) {
    const list = RAMPS[theme];
    if (list.length === 1) return list[0];
    const v = fbm(x / 48, y / 48, 97, 3) + (bayer(X, Y) - 0.5) * 0.12;
    if (theme === "autumn") return v < 0.42 ? list[0] : v < 0.56 ? list[1] : list[2];
    if (theme === "highland") return v < 0.58 ? list[0] : list[1];
    return v < 0.5 ? list[0] : list[1];
  }

  /* Přebarví upečený terén (Pix) v mřížce S (1 = art px, 2 = jemná). Volá world.js před zimou. */
  function paint(P, zF, b, Z, S = 1) {
    const rc = b.map.terrain;
    if (!has(rc)) return;
    // zimní mapu zasněží winter.js; tady jen oblasti jiných krajin
    const main = THEMES.includes(rc.theme) && rc.theme !== "winter" ? rc.theme : "meadow";
    const FW = P.w;
    const FH = P.h;
    const d = P.d;
    const AW = b.W;
    const region = rc.biomes && rc.biomes.length;
    // váhy oblastí stačí po art px (a jen tam, kde nějaká oblast je)
    let rT = null;
    let rW = null;

    if (region) {
      rT = new Uint8Array(AW * b.H);
      rW = new Float32Array(AW * b.H);
      for (const [, cx, cy, r] of rc.biomes) {
        const x0 = Math.max(0, Math.floor(cx - r * 1.3));
        const x1 = Math.min(AW - 1, Math.ceil(cx + r * 1.3));
        const y0 = Math.max(0, Math.floor(cy - r * 1.3));
        const y1 = Math.min(b.H - 1, Math.ceil(cy + r * 1.3));
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const i = y * AW + x;
            if (rW[i] > 0) continue;
            const [t, w] = regionAt(rc, x, y);
            if (w > 0) { rT[i] = THEMES.indexOf(t); rW[i] = w; }
          }
        }
      }
    }

    for (let y = 0; y < FH; y++) {
      const ay = Math.min(b.H - 1, Math.floor(y / S));
      for (let x = 0; x < FW; x++) {
        const j = y * FW + x;
        const z = zF[j];
        if (z === Z.water || z === Z.frame) continue;
        const c = d[j] & 0xffffff;
        const gv = IDX.get(c);
        const gi = gv === undefined ? undefined : gv[0];
        const di = gv === undefined ? DIDX.get(c) : undefined;
        if (gi === undefined && di === undefined) continue;

        const ax = Math.min(AW - 1, Math.floor(x / S));
        let theme = main;
        if (region) {
          const w = rW[ay * AW + ax];
          if (w > 0 && bayer(x, y) < w) theme = THEMES[rT[ay * AW + ax]];
        }
        if (theme === "meadow") continue;

        let out;
        if (gi !== undefined) {
          out = shade(subRamp(theme, ax, ay, x, y), gi, gv[1]);
        } else {
          const dirt = DIRT[theme];
          if (!dirt || z === Z.rock || z === Z.wall) continue;
          out = dirt[di];
        }
        d[j] = (0xff000000 | out) >>> 0;
      }
    }
  }

  // Stupnice pro trsy trávy podle hlavní krajiny (zimu řeší winter.js).
  const tuftRamp = rc => (rc && RAMPS[rc.theme] ? RAMPS[rc.theme][rc.theme === "autumn" ? 1 : 0] : C.g);
  const grassRamp = theme => (RAMPS[theme] ? RAMPS[theme][0] : C.g);

  // Trs trávy jen tam, kde je hlavní krajina (v oblasti jiné krajiny by měl špatnou barvu).
  const tuftOk = (rc, x, y) => !rc || !rc.biomes || !rc.biomes.length || regionAt(rc, x, y)[1] < 0.3;

  // Druh stromu pro náhodné číslo h 0..1 v daném místě mapy (art px).
  function treeKind(h, rc, x, y) {
    let theme = rc && rc.theme;
    if (rc && rc.biomes && rc.biomes.length) {
      const [t, w] = regionAt(rc, x, y);
      if (t && hash(Math.round(x), Math.round(y), 93) < w) theme = t;
    }
    const list = TREES[theme];
    if (!list) return PK.props.treeKind(h);
    const total = list.reduce((s, [, w]) => s + w, 0);
    let acc = 0;
    for (const [k, w] of list) {
      acc += w / total;
      if (h < acc) return k;
    }
    return list[list.length - 1][0];
  }

  PK.biomes = { RAMPS, THEMES, paint, regionAt, tuftRamp, grassRamp, tuftOk, treeKind, has };
})();
