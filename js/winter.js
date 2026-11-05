/*
 * Zima: sezónní vzhled od 1. prosince do 6. ledna.
 * Sníh na trávě, střechách, korunách stromů a kulisách, zamrzlé okraje jezer a řek,
 * padající vločky, ozdobený stromek a světýlka u hlavní budovy, sněhuláci, hustší kouř
 * z komínů a pára od úst jednotek. V menu sněží a na logu leží čepička sněhu.
 *
 * Herně se mění jen dárky (js/sim.js, R.WINTER): leží volně na mapě a dělník, který
 * k nim dojde, přinese týmu zlato. Online o zimě rozhoduje server (kalendář nebo
 * příkaz správce /zima), proti AI kalendář prohlížeče.
 * Ruční přepnutí: ?zima=1 / ?zima=0 (zapamatuje se v localStorage pk-winter).
 *
 * Všechno je kreslené v jemné mřížce (PK.HD = 2): každý bod sněhu je 1 jemný px.
 */
(() => {
  "use strict";

  const PK = (window.PK = window.PK || {});
  const { C, Pix, mix, hash, HD, clamp } = PK;
  const R = PK.rules;

  /* ---------- kdy ---------- */
  function stored() {
    try {
      const q = new URLSearchParams(location.search).get("zima");
      if (q === "1" || q === "0") localStorage.setItem("pk-winter", q);
      const s = localStorage.getItem("pk-winter");
      if (s === "1" || s === "0") return s === "1";
    } catch (e) { /* bez localStorage platí kalendář */ }
    return null;
  }

  // zima podle volby (URL / příkaz správce), jinak podle kalendáře
  function season() {
    const f = stored();
    if (f !== null) return f;
    return R && R.isWinter ? R.isWinter() : false;
  }

  const W = { on: false, season };
  PK.winter = W;

  /* ---------- barvy ---------- */
  // sníh: od modrého stínu po bílé světlo shora zleva
  const SNOW = [0x4e5f86, 0x7487ad, 0x9eb0cf, 0xc3d1e6, 0xe2eaf5, 0xf8fbff];
  const ICE = [0x5d93ad, 0x86bccf, 0xaed8e4, 0xd2eef3, 0xf2fcff];
  const INK = C.ink;
  const pick = (ramp, t) => ramp[t <= 0 ? 0 : t >= ramp.length - 1 ? ramp.length - 1 : Math.round(t)];
  const lum = c => (((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.55 + (c & 255) * 0.15) / 255;
  const css = c => `#${(c & 0xffffff).toString(16).padStart(6, "0")}`;
  const mk = (w, h) => new Pix(w * HD, h * HD);
  W.SNOW = SNOW;
  W.ICE = ICE;

  /* ---------- plátno <-> Pix ---------- */
  function readPix(canvas) {
    const g = canvas.getContext("2d");
    const img = g.getImageData(0, 0, canvas.width, canvas.height);
    const u = new Uint32Array(img.data.buffer);
    const P = new Pix(canvas.width, canvas.height);
    for (let i = 0; i < u.length; i++) {
      const v = u[i];
      if (!(v >>> 24)) continue;
      P.d[i] = ((v & 0xff000000) | ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff)) >>> 0;
    }
    return { P, img };
  }

  function writePix(canvas, P) {
    const g = canvas.getContext("2d");
    const img = g.createImageData(P.w, P.h);
    const u = new Uint32Array(img.data.buffer);
    for (let i = 0; i < P.d.length; i++) {
      const v = P.d[i];
      if (!(v >>> 24)) continue;
      u[i] = ((v & 0xff000000) | ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff)) >>> 0;
    }
    g.clearRect(0, 0, P.w, P.h);
    g.putImageData(img, 0, 0);
  }

  /* ---------- sníh na spritu ----------
   * cap: čepice sněhu na horní hraně siluety (na plochých místech silnější),
   * dust: poprašek na horních hranách světlých ploch uvnitř (listí, římsy, kameny).
   * Obrys zůstává: nad čepicí je tmavá linka, pokud je nad ní místo. */
  function snowify(P, o = {}) {
    const { w, h, d } = P;
    const cap = o.cap == null ? 2 : o.cap;
    const dust = o.dust == null ? 0.5 : o.dust;
    const seed = o.seed || 7;
    const minY = o.minY || 0;
    const maxY = o.maxY == null ? h : o.maxY;
    const op = (x, y) => x >= 0 && y >= 0 && x < w && y < h && (d[y * w + x] >>> 24) > 0;
    const col = (x, y) => d[y * w + x] & 0xffffff;
    const out = P.clone();
    const set = (x, y, c) => out.set(x, y, c);

    // nejvyšší neprůhledný bod v každém sloupci
    const top = new Int32Array(w).fill(-1);
    for (let x = 0; x < w; x++) for (let y = minY; y < maxY; y++) if (op(x, y)) { top[x] = y; break; }

    // poprašek: světlý bod, nad nímž je tmavší (horní hrana shluku listí, římsa, kámen)
    if (dust > 0) {
      for (let y = Math.max(1, minY); y < maxY; y++) {
        for (let x = 0; x < w; x++) {
          if (!op(x, y) || !op(x, y - 1) || y === top[x]) continue;
          const c = col(x, y);
          const L = lum(c);
          const La = lum(col(x, y - 1));
          if (L < 0.32 || La > L - 0.06) continue;
          if (hash(x, y, seed) > dust * (0.6 + L)) continue;
          if (o.skip && o.skip(c)) continue;
          set(x, y, pick(SNOW, 2.2 + L * 3.4 - (hash(x, y, seed + 1) > 0.8 ? 1 : 0)));
          // a pod ním ještě jeden, ať je chomáč vidět
          if (op(x, y + 1) && hash(x, y, seed + 2) < 0.45 * dust) set(x, y + 1, pick(SNOW, 1.6 + L * 2.6));
        }
      }
    }

    if (cap > 0) {
      for (let x = 0; x < w; x++) {
        const y0 = top[x];
        if (y0 < 0) continue;
        if (o.skip && o.skip(col(x, y0 + 1 < h && op(x, y0 + 1) ? y0 + 1 : y0))) continue;
        const l = x > 0 ? top[x - 1] : -1;
        const r = x < w - 1 ? top[x + 1] : -1;
        const slope = Math.max(l < 0 ? 9 : Math.abs(l - y0), r < 0 ? 9 : Math.abs(r - y0));
        let depth = slope <= 1 ? cap + (hash(x >> 1, y0, seed + 3) > 0.55 ? 1 : 0) : slope <= 3 ? Math.max(1, cap - 1) : slope <= 6 ? 1 : 0;
        if (!depth) continue;
        const room = y0 > 0 && !op(x, y0 - 1);
        // s místem nad siluetou sníh leží na ní (obrys se posune o bod výš), jinak pod obrysem
        const s0 = room ? y0 : y0 + 1;
        if (room) set(x, y0 - 1, INK);
        for (let k = 0; k < depth; k++) {
          const y = s0 + k;
          if (!op(x, y)) break;
          // světlo zleva shora, spodní okraj čepice do modra
          const t = 4.6 - k * 0.9 - (x / w) * 0.9 - (k === depth - 1 ? 0.6 : 0) + (hash(x, y, seed + 4) - 0.5) * 0.6;
          set(x, y, pick(SNOW, t));
        }
        // stín pod čepicí
        const yb = s0 + depth;
        if (op(x, yb) && depth > 1) set(x, yb, mix(col(x, yb), SNOW[0], 0.45));
      }
    }

    P.d.set(out.d);
    return P;
  }
  W.snowify = snowify;

  // Zasněží hotový sprite (hrubé plátno i jemné dvojče) na místě; originál si pamatuje.
  const restore = [];
  function snowCanvas(c, o) {
    if (!c || c.__snow) return;
    const t = PK.hdOf(c);
    for (const [cv, k] of [[c, 0.5], [t, 1]]) {
      if (!cv) continue;
      const { P, img } = readPix(cv);
      restore.push([cv, img]);
      snowify(P, { ...o, cap: Math.max(1, Math.round((o.cap == null ? 2 : o.cap) * k)), seed: (o.seed || 7) + k * 10 });
      writePix(cv, P);
    }
    c.__snow = true;
    restore.push([c, null]);
  }

  function unsnowAll() {
    for (const [cv, img] of restore) {
      if (img) cv.getContext("2d").putImageData(img, 0, 0);
      else cv.__snow = false;
    }
    restore.length = 0;
  }

  /* ---------- kulisy a stromy ---------- */
  // ohně, lucerny a zimní sprity se nezasněžují
  const NO_SNOW = /^(campfire|brazier|lanternPost|shroomGlow|xmas|snowman|giftPile)/;
  // zelenou trávu u paty kulis sníh skryje
  const isGrass = c => {
    const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
    return g > r + 12 && g > b + 6;
  };

  function snowProps() {
    const P = PK.props;
    if (!P) return;
    P.trees.forEach((t, k) => t.crown.forEach((c, i) => snowCanvas(c, { cap: 3, dust: i === 2 ? 0.5 : 0.8, seed: 11 + k * 5 + i })));
    snowCanvas(P.mine.c, { cap: 2, dust: 0.3, seed: 41 });
    snowCanvas(P.mineEmpty.c, { cap: 2, dust: 0.3, seed: 43 });
    for (const [name, s] of Object.entries(P.doodads)) {
      if (NO_SNOW.test(name) || !s || !s.c) continue;
      snowCanvas(s.c, { cap: name.startsWith("peak") || name === "foothill" ? 3 : 2, dust: 0.4, seed: hash(name.length, name.charCodeAt(0), 5) * 100 | 0 });
    }
  }

  /* ---------- terén (volá world.js po jemném pečení) ----------
   * Tráva pod sněhem: odstín sněhu podle jasu trávy (stín zůstane stínem), místy prosvítají
   * zmrzlé trsy. Cesty jsou ušlapané, dlažba, skály a břehy jen poprášené na světlých hranách. */
  W.snowTerrain = (P, zF, b, Z, S = 2) => {
    const FW = P.w;
    const FH = P.h;
    const d = P.d;
    const ash = b.ashMap;
    const AW = b.W;
    const { fbm } = PK;
    const get = j => d[j] & 0xffffff;
    const put = (j, c) => { d[j] = (0xff000000 | c) >>> 0; };
    const orig = new Uint32Array(d);
    const at = (x, y) => (x < 0 || y < 0 || x >= FW || y >= FH ? 0 : orig[y * FW + x] & 0xffffff);

    // rozmazaný jas trávy (box 7x7): sníh přebírá jen hrubé stínování, ne zrnitost stébel
    const Lg = new Float32Array(FW * FH);
    for (let j = 0; j < FW * FH; j++) Lg[j] = zF[j] === Z.grass ? lum(orig[j] & 0xffffff) : 0.45;
    const blur = (A, r) => {
      const T = new Float32Array(A.length);
      for (let y = 0; y < FH; y++) {
        let acc = 0;
        const o = y * FW;
        for (let x = -r; x < FW; x++) {
          if (x + r < FW) acc += A[o + x + r];
          if (x - r - 1 >= 0) acc -= A[o + x - r - 1];
          if (x >= 0) T[o + x] = acc / (2 * r + 1);
        }
      }
      for (let x = 0; x < FW; x++) {
        let acc = 0;
        for (let y = -r; y < FH; y++) {
          if (y + r < FH) acc += T[(y + r) * FW + x];
          if (y - r - 1 >= 0) acc -= T[(y - r - 1) * FW + x];
          if (y >= 0) A[y * FW + x] = acc / (2 * r + 1);
        }
      }
    };
    blur(Lg, 3 * S / 2);
    const { dither } = PK;

    for (let y = 0; y < FH; y++) {
      for (let x = 0; x < FW; x++) {
        const j = y * FW + x;
        const z = zF[j];
        if (ash[Math.floor(y / S) * AW + Math.floor(x / S)]) continue; // popel pekla zůstává
        const X = x * 2 / S;
        const Y = y * 2 / S;
        const c = get(j);
        const L = lum(c);
        if (z === Z.grass) {
          // díry ve sněhu se zmrzlou trávou: ostrá hrana, na spodní straně stín sněhu
          const n = fbm(X / 46, Y / 34, 4, 3);
          if (n < 0.235) { put(j, mix(c, 0x968f7c, 0.72)); continue; }
          if (n < 0.25) { put(j, SNOW[2]); continue; }
          // hrubé stínování z trávy + jemné závěje, pásy odstínů jen úzce rozdithrované
          const t = 2.75 + (Lg[j] - 0.3) * 4.2 + (fbm(X / 26, Y / 18, 7, 3) - 0.5) * 1.3;
          let s = SNOW[clamp(dither(t, x, y, 0.35), 1, 5)];
          if (hash(x, y, 83) > 0.9985) s = 0xffffff; // třpyt
          put(j, s);
        } else if (z === Z.path) {
          // ušlapaná cesta: hlína prosvítá ve stopách, okraje a vyvýšená místa pod sněhem
          const n = fbm(X / 9, Y / 9, 9, 2);
          if (n > 0.56) put(j, SNOW[clamp(dither(2.4 + L * 3, x, y, 0.35), 1, 5)]);
          else if (n > 0.48) put(j, mix(c, SNOW[2], 0.55));
          else put(j, mix(c, 0x9aa3b8, 0.2));
        } else if (z === Z.plaza || z === Z.terrace || z === Z.bank || z === Z.rock || z === Z.wall || z === Z.frame) {
          // poprašek na horních hranách světlých ploch (kameny, dlaždice, skalní plošky)
          const up = lum(at(x, y - 1));
          if (L > 0.38 && up < L - 0.04 && hash(x, y, 87) < 0.75) put(j, pick(SNOW, 2 + L * 3.6));
          else if (L > 0.5 && hash(x >> 1, y >> 1, 88) < 0.35) put(j, mix(c, SNOW[4], 0.6));
          else put(j, mix(c, 0x8090b0, 0.12));
        }
      }
    }
  };

  // Led podél břehu (volá world.js při pečení vody). e: 0 u břehu, 1 uprostřed toku.
  W.iceAt = (e, fx, fy) => {
    const n = PK.vnoise(fx / 16, fy / 16, 5) * 0.2 + PK.vnoise(fx / 5, fy / 5, 6) * 0.06;
    const edge = 0.3 + n;
    if (e > edge) return e < edge + 0.03 ? ICE[0] : 0; // tmavá linka, kde led končí a začíná voda
    // u břehu na ledu leží sníh, dál čistý led s prasklinami a světlými ploškami
    if (e < 0.08 + n * 0.3) return hash(fx, fy, 90) > 0.5 ? SNOW[4] : SNOW[3];
    if (e > edge - 0.025) return ICE[3]; // světlá hrana ledu
    if (hash(fx >> 2, fy >> 1, 91) > 0.94 && hash(fx, fy, 92) > 0.35) return ICE[1];
    const t = 1.6 + (1 - e / edge) * 1.6 + (PK.vnoise(fx / 7, fy / 3, 9) - 0.5) * 1.2;
    if (hash(fx, fy, 94) > 0.995) return 0xffffff;
    return ICE[clamp(PK.dither(t, fx, fy, 0.3), 0, 4)];
  };

  // Suchá ojíněná tráva místo zelených trsů (world.js buildTufts).
  W.TUFT = [0x3c3a40, 0x5e5a55, 0x807862, 0x9e9474, 0xbab094, 0xd8d6cc, 0xf4f6fa, 0xffffff, 0xffffff];

  /* ---------- střechy (volá buildings.js z tiles/thatch) ----------
   * Sníh pokryje tašky, jen spodní linky řad místy prosvítají a pár tašek je holých. */
  W.roof = (c, x, y, ly, lx, th, f, bare) => {
    if (bare > 0.93) return c;
    if (ly === th - 1 && hash(x, y, 95) > 0.55) return mix(c, SNOW[1], 0.35);
    const t = 3.5 + f * 0.9 + (ly === 0 ? 0.6 : 0) - (ly === th - 1 ? 1.3 : 0) + (hash(x, y, 96) - 0.5) * 0.5;
    return pick(SNOW, t);
  };

  // Převis sněhu na okapu a rampouchy (spodní hrana střechy).
  W.eave = (P, pts) => {
    let yb = -Infinity;
    for (const p of pts) yb = Math.max(yb, p[1]);
    yb = Math.round(yb);
    const xs = pts.filter(p => Math.abs(p[1] - yb) < 0.5).map(p => p[0]);
    if (xs.length < 2) return;
    const x0 = Math.ceil(Math.min(...xs));
    const x1 = Math.floor(Math.max(...xs));
    for (let x = x0; x <= x1; x++) {
      if (P.get(x, yb) < 0) continue;
      // zaoblený převis o bod pod okap
      if (x > x0 && x < x1) P.set(x, yb + 1, hash(x, yb, 97) > 0.3 ? SNOW[3] : SNOW[2]);
      P.set(x, yb, SNOW[4]);
      // rampouchy
      if (x > x0 + 2 && x < x1 - 2 && hash(x, yb, 98) > 0.82) {
        const len = 2 + Math.floor(hash(x, yb, 99) * 4);
        for (let k = 0; k < len; k++) P.set(x, yb + 2 + k, k === len - 1 ? ICE[2] : k ? ICE[3] : ICE[4]);
      }
    }
  };

  /* ---------- budovy (volá buildings.js po nakreslení) ---------- */
  // Hlavní budova dostane girlandu světýlek pod okap; kreslí se do spritu (žárovky ve dne)
  // a večer je rozsvítí W.draw. Pozice v art px od levého horního rohu spritu.
  const BULB = [C.r[3], C.a[2], C.u[3], C.glow[1], C.cap[2]];

  function garland(P, x0, x1, y, sag, n) {
    const bulbs = [];
    const span = x1 - x0;
    const seg = span / n;
    for (let x = x0; x <= x1; x++) {
      const t = ((x - x0) % seg) / seg;
      const yy = Math.round(y + Math.sin(t * Math.PI) * sag);
      P.set(x, yy, 0x24302a);
    }
    for (let i = 0; i < n; i++) {
      for (const t of [0.25, 0.5, 0.75]) {
        const x = Math.round(x0 + (i + t) * seg);
        const yy = Math.round(y + Math.sin(t * Math.PI) * sag) + 1;
        const c = BULB[(bulbs.length * 3 + i) % BULB.length];
        P.set(x, yy, c);
        P.set(x, yy + 1, mix(c, INK, 0.35));
        bulbs.push([x / HD, (yy + 0.5) / HD, bulbs.length % BULB.length]);
      }
    }
    return bulbs;
  }

  W.building = (type, spr) => {
    const t = PK.hdOf(spr.c);
    if (type === "hall" && t && !spr.bulbs) {
      const { P } = readPix(t);
      // pod okapem hlavní střechy (okap v jemné y 79, střecha 4..140)
      spr.bulbs = garland(P, 10, 134, 83, 3, 6);
      writePix(t, P);
      // večer světýlka trochu svítí do okolí (shadery)
      spr.glows = [...(spr.glows || []),
        { x: 20, y: 43, r: 10, a: 0.22, color: C.r[3], flicker: true },
        { x: 36, y: 43, r: 10, a: 0.22, color: C.a[2], flicker: true },
        { x: 52, y: 43, r: 10, a: 0.22, color: C.u[3], flicker: true }];
    }
    if (!spr.hell) snowCanvas(spr.c, { cap: 2, dust: 0.25, seed: 51, skip: c => isGrass(c) });
  };

  /* ---------- zimní kulisy ---------- */
  const D = PK.props && PK.props.doodads;

  function sprite(name, w, h, ax, ay, fn, extra = {}) {
    const P = mk(w, h);
    const out = fn(P) || {};
    P.outline(INK, 0.74);
    D[name] = { c: PK.fine(P), w, h, ax, ay, ...extra, ...out };
  }

  /* Ozdobený stromek: smrček ve třech patrech se sněhem na větvích, baňky, řetěz
   * a hvězda na špičce. Baňky a hvězda po setmění svítí (W.draw). */
  function xmasTree(P) {
    const cx = 15;
    const NEEDLE = [0x10261e, 0x173a2a, 0x1f5236, 0x2c6a40, 0x3f8550, 0x5aa062];
    const tiers = [[50, 14, 18], [38, 11, 15], [27, 8, 12]];
    const bulbs = [];
    // kmen
    for (let y = 50; y < 56; y++) { P.set(cx - 1, y, C.w[2]); P.set(cx, y, C.w[1]); P.set(cx + 1, y, C.w[0]); }
    for (const [base, hw, hgt] of tiers) {
      for (let y = base - hgt; y <= base; y++) {
        const k = (y - (base - hgt)) / hgt;
        const half = 1 + k * hw;
        for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
          const u = (x - cx) / half;
          // zubatý spodní okraj patra
          if (y > base - 2 && hash(x, y, 3) > 0.55 && Math.abs(u) > 0.2) continue;
          let t = 3 - u * 1.4 - k * 0.6 + (hash(x, y, 4) - 0.5) * 1.2;
          if ((x + y * 2) % 5 === 0) t -= 1;
          P.set(x, y, pick(NEEDLE, t));
        }
        // sníh na horní hraně větví vlevo (světlo)
        if (y === base - hgt + 2 || (y > base - hgt + 3 && y % 4 === 0)) {
          for (let x = Math.round(cx - half); x <= Math.round(cx - half * 0.2); x++) if (hash(x, y, 5) > 0.4) P.set(x, y, pick(SNOW, 3.6 + (hash(x, y, 6) - 0.5)));
        }
      }
      // spodní hrana patra zasněžená
      for (let x = Math.round(cx - hw); x <= Math.round(cx + hw); x++) if (hash(x, base, 8) > 0.35 && P.get(x, base - 1) >= 0) P.set(x, base - 1, x < cx ? SNOW[4] : SNOW[3]);
      // řetěz napříč patrem
      for (let x = Math.round(cx - hw * 0.8); x <= Math.round(cx + hw * 0.8); x++) {
        const y = Math.round(base - hgt * 0.45 + (x - cx) * 0.25);
        if (P.get(x, y) >= 0 && (x & 1)) P.set(x, y, C.a[3]);
      }
      // baňky
      for (let i = 0; i < 4; i++) {
        const u = (i + 0.5) / 4 * 1.6 - 0.8;
        const y = Math.round(base - 2 - hash(i, base, 9) * hgt * 0.4);
        const kx = (y - (base - hgt)) / hgt;
        const x = Math.round(cx + u * (1 + kx * hw) * 0.85);
        const c = BULB[(i + base) % BULB.length];
        P.set(x, y, c); P.set(x + 1, y, mix(c, INK, 0.3)); P.set(x, y + 1, mix(c, INK, 0.4)); P.set(x + 1, y + 1, mix(c, INK, 0.55));
        P.set(x, y, mix(c, 0xffffff, 0.5));
        bulbs.push([(x + 0.5) / HD, (y + 0.5) / HD, (i + base) % BULB.length]);
      }
    }
    // hvězda
    const sy = 13;
    for (const [dx, dy] of [[0, -3], [0, -2], [-1, -1], [0, -1], [1, -1], [-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [3, 0], [-1, 1], [0, 1], [1, 1], [-2, 2], [2, 2]]) {
      P.set(cx + dx, sy + dy, dy < 0 || dx < 0 ? C.a[3] : C.a[2]);
    }
    P.set(cx, sy, C.a[4]);
    // sníh u paty
    P.disc(cx, 56, 9, 2, (x, y) => (y < 56 ? SNOW[4] : SNOW[3]));
    return { bulbs, star: [cx / HD, sy / HD] };
  }

  /* Sněhulák: tři koule se světlem zleva, uhlíkové oči a knoflíky, mrkvový nos,
   * šála v barvě vybrané podle semínka, hrnec na hlavě a větvičkové ruce. */
  function snowman(P, seed) {
    const cx = 11;
    const scarf = [[C.r[1], C.r[2], C.r[3]], [C.u[1], C.u[2], C.u[3]], [C.g[2], C.g[3], C.g[4]]][seed % 3];
    const ball = (cy, r) => P.disc(cx, cy, r, r * 0.92, (x, y) => {
      const u = (x + 0.5 - cx) / r;
      const v = (y + 0.5 - cy) / r;
      return pick(SNOW, 4.4 - u * 1.3 - v * 1.1 + (hash(x, y, seed) - 0.5) * 0.5);
    });
    ball(30, 8);
    ball(19, 6);
    ball(10, 4.5);
    // ruce z větviček
    P.line(cx - 6, 18, cx - 11, 13, C.w[1]); P.set(cx - 12, 12, C.w[1]); P.set(cx - 10, 11, C.w[1]);
    P.line(cx + 6, 18, cx + 10, 14, C.w[1]); P.set(cx + 11, 13, C.w[1]); P.set(cx + 10, 12, C.w[1]);
    // oči, nos, knoflíky
    P.set(cx - 2, 9, INK); P.set(cx + 1, 9, INK);
    P.set(cx, 11, C.a[1]); P.set(cx + 1, 11, C.a[0]); P.set(cx + 2, 11, C.a[0]);
    for (const y of [18, 21, 27, 31]) P.set(cx, y, INK);
    // šála
    for (let x = cx - 4; x <= cx + 4; x++) { P.set(x, 14, scarf[2]); P.set(x, 15, scarf[1]); }
    P.set(cx + 3, 16, scarf[1]); P.set(cx + 3, 17, scarf[0]); P.set(cx + 4, 16, scarf[0]); P.set(cx + 4, 18, scarf[1]);
    // hrnec
    for (let x = cx - 3; x <= cx + 3; x++) for (let y = 3; y < 6; y++) P.set(x, y, x < cx ? C.s[3] : C.s[2]);
    for (let x = cx - 4; x <= cx + 4; x++) P.set(x, 6, C.s[1]);
    P.set(cx - 3, 3, C.s[4]);
    // sníh kolem paty
    P.disc(cx, 38, 10, 1.6, (x, y) => (y < 38 ? SNOW[4] : SNOW[3]));
  }

  // Dárek: krabice s mašlí, světlo zleva, obrys, dva druhy velikosti.
  const GIFT = [
    { box: [0x5e1424, 0x8e2234, 0xc23646, 0xe85a5a], rib: [C.a[0], C.a[1], C.a[2], C.a[3]] },
    { box: [0x183058, 0x234a8a, 0x3b6fc0, 0x6a9be0], rib: [0x9eb0cf, 0xc3d1e6, 0xe2eaf5, 0xffffff] },
    { box: [0x163a26, 0x235a36, 0x34804a, 0x58a862], rib: [C.r[1], C.r[2], C.r[3], C.r[4]] },
    { box: [0x3c2366, 0x5a3594, 0x7e52c0, 0xa47ee0], rib: [C.a[0], C.a[1], C.a[2], C.a[3]] }
  ];

  function giftBox(P, ox, oy, w, h, pal, seed) {
    const top = 3;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const lid = y < top;
        let t = lid ? 3 - x / w * 1.2 : 2.2 - x / w * 1.6;
        if (x === 0 && !lid) t += 0.6;
        if (y === top && !lid) t -= 0.8;
        P.set(ox + x, oy + y, pick(pal.box, t + (hash(x, y, seed) - 0.5) * 0.4));
      }
    }
    // stuha křížem
    const mx = ox + (w >> 1);
    for (let y = 0; y < h; y++) { P.set(mx, oy + y, pal.rib[y < top ? 3 : 2]); P.set(mx - 1, oy + y, pal.rib[y < top ? 2 : 1]); }
    for (let x = 0; x < w; x++) P.set(ox + x, oy + top + 2, pal.rib[x < w / 2 ? 2 : 1]);
    // mašle
    for (const [dx, dy, k] of [[-4, -2, 2], [-3, -3, 3], [-2, -2, 3], [-3, -1, 1], [2, -2, 3], [3, -3, 2], [1, -2, 3], [2, -1, 1], [-1, -1, 3], [0, -1, 2]]) P.set(mx + dx, oy + dy, pal.rib[k]);
    // sníh na víku
    for (let x = 1; x < w - 1; x++) if (hash(x, seed, 9) > 0.55) P.set(ox + x, oy, x < w / 2 ? SNOW[5] : SNOW[4]);
  }

  const giftSprites = GIFT.map((pal, k) => {
    const P = mk(9, 9);
    if (k === 3) {
      giftBox(P, 1, 7, 10, 9, pal, k);
      giftBox(P, 8, 10, 8, 7, GIFT[0], k + 5);
    } else giftBox(P, 3, 5 + (k & 1), 12 - (k & 1) * 2, 11 - (k & 1), pal, k);
    P.outline(INK, 0.74);
    return PK.fine(P);
  });

  if (D) {
    sprite("xmasTree", 15, 29, 8, 28, P => xmasTree(P), { glow: { x: 8, y: 16, r: 16, a: 0.3, color: C.a[2], flicker: true } });
    sprite("snowmanA", 11, 20, 6, 19, P => snowman(P, 0));
    sprite("snowmanB", 11, 20, 6, 19, P => snowman(P, 1));
    sprite("snowmanC", 11, 20, 6, 19, P => snowman(P, 2));
  }

  /* ---------- rozmístění (volá world.js při stavbě mapy) ---------- */
  W.doodads = ({ add, layout, W: MW, H: MH }) => {
    if (!W.on || !D || !D.xmasTree) return;
    const rnd = PK.rng(MW * 97 + MH * 13 + layout.resources.length);
    const area = MW * MH / (480 * 240);
    const n = k => Math.max(1, Math.round(k * area));
    const hidden = (x, y) => layout.resources.some(r => r.type === "wood" && Math.abs(x - r.x / 2) < 24 && y - (r.y / 2 + 15) > -52 && y - (r.y / 2 + 15) < 6) ||
      layout.buildings.some(b => Math.abs(x - b.x / 2) < 34 && y - (b.y / 2 + 19) > -56 && y - (b.y / 2 + 19) < 4);
    const put = (name, x, y, r) => !hidden(x, y) && add(name, x, y, false, r);
    // u každé hlavní budovy stromek a sněhulák
    for (const b of layout.buildings) {
      if (b.type !== "hall") continue;
      let tree = false;
      let man = false;
      for (let i = 0; i < 30 && !(tree && man); i++) {
        const a = i * 2.39 + rnd() * 0.6;
        const x = b.x / 2 + Math.cos(a) * (46 + i);
        const y = b.y / 2 + 16 + Math.sin(a) * (26 + i * 0.6);
        if (!tree) tree = put("xmasTree", x, y, 9);
        else if (!man) man = put(["snowmanA", "snowmanB", "snowmanC"][i % 3], x, y, 7);
      }
    }
    const spread = (name, count, r) => {
      for (let i = 0, k = 0; i < count * 40 && k < count; i++) if (put(name, 14 + rnd() * (MW - 28), 30 + rnd() * (MH - 42), r)) k++;
    };
    spread("snowmanA", n(0.25), 16);
    spread("snowmanB", n(0.25), 16);
    spread("snowmanC", n(0.25), 16);
  };

  /* ---------- dárky ze simulace (game.js je řadí podle hloubky) ---------- */
  W.drawGift = (g, gf, T, reflecting) => {
    const c = giftSprites[gf.k & 3];
    const x = Math.round(gf.x / 2);
    const y = Math.round(gf.y / 2) + 3;
    if (!reflecting && PK.world && PK.world.shadow) {
      const sh = PK.world.shadow("ellipse", 10, 4);
      g.drawImage(sh, x - (sh.width >> 1) + 1, y - (sh.height >> 1));
    }
    g.drawImage(c, x - 4.5, y - 8.5);
  };

  /* ---------- efekty po shaderech: vločky, světýlka, pára od úst, třpyt dárků ---------- */
  const bursts = [];
  W.burst = (x, y) => {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
      const v = 10 + Math.random() * 16;
      bursts.push({ x, y: y - 4, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7 - 12, t: 0, life: 0.7 + Math.random() * 0.4, c: [C.a[3], C.a[2], 0xffffff, C.r[3]][i & 3] });
    }
  };

  const UNDEAD = new Set((R && R.UNDEAD && R.UNDEAD.units) || []);
  const darkOf = () => {
    const amb = PK.shaders && PK.shaders.active && PK.shaders.amb;
    return amb ? clamp((0.86 - (amb[0] + amb[1] + amb[2]) / 3) / 0.55, 0, 1) : 0;
  };
  const fpx = (g, x, y) => g.fillRect(Math.round(x * HD) / HD, Math.round(y * HD) / HD, 1 / HD, 1 / HD);

  // vločky v dlaždici 160x120 art px, ukotvené ke světu (při posunu kamery neplavou)
  const FLAKES = [];
  for (let i = 0; i < 70; i++) FLAKES.push({ x: hash(i, 1, 501) * 160, y: hash(i, 2, 501) * 120, v: 7 + hash(i, 3, 501) * 9, s: hash(i, 4, 501) * 6.28, big: hash(i, 5, 501) > 0.86 });

  function drawFlakes(g, T, v) {
    const TW = 160;
    const TH = 120;
    const x0 = Math.floor(v.cam.x / TW) * TW;
    const y0 = Math.floor(v.cam.y / TH) * TH - TH;
    const x1 = v.cam.x + v.vw / v.zoom;
    const y1 = v.cam.y + v.vh / v.zoom;
    const wind = 3;
    for (let ty = y0; ty < y1 + TH; ty += TH) {
      for (let tx = x0; tx < x1 + TW; tx += TW) {
        for (const f of FLAKES) {
          const fy = (f.y + T * f.v) % TH;
          const fx = (f.x + T * wind + Math.sin(T * 0.9 + f.s) * 3 + TW) % TW;
          const x = tx + fx;
          const y = ty + fy;
          if (x < v.cam.x - 2 || x > x1 + 2 || y < v.cam.y - 2 || y > y1 + 2) continue;
          g.fillStyle = f.big ? "#ffffff" : "#e2eaf5";
          fpx(g, x, y);
          if (f.big) { fpx(g, x + 0.5, y); fpx(g, x, y + 0.5); fpx(g, x + 0.5, y + 0.5); }
        }
      }
    }
  }

  function drawBulbs(g, list, ox, oy, T, seed, dark) {
    list.forEach(([bx, by, k], i) => {
      const on = Math.sin(T * 2.2 + i * 1.7 + seed) > -0.35;
      if (!on) return;
      const c = BULB[k];
      g.globalAlpha = 0.45 + 0.55 * dark;
      g.fillStyle = css(mix(c, 0xffffff, 0.45));
      fpx(g, ox + bx, oy + by);
      if (dark > 0.3) {
        g.globalAlpha = 0.35 * dark;
        g.fillStyle = css(c);
        fpx(g, ox + bx - 0.5, oy + by); fpx(g, ox + bx + 0.5, oy + by); fpx(g, ox + bx, oy + by - 0.5); fpx(g, ox + bx, oy + by + 0.5);
      }
    });
    g.globalAlpha = 1;
  }

  // pára od úst: obláček z pár jemných bodů, každá jednotka v jiném rytmu
  function drawBreath(g, u, T) {
    if (u.hp <= 0 || UNDEAD.has(u.type) || u.type === "catapult") return;
    const per = 2.4 + hash(u.id, 1, 61) * 1.2;
    const ph = (T + hash(u.id, 2, 61) * per) % per;
    if (ph > 1.1) return;
    let head = [2, -18];
    try {
      const rec = PK.units.frame(u.type, u.team, "idle", 0);
      if (rec && rec.meta && rec.meta.head) head = rec.meta.head;
    } catch (e) { /* výchozí výška hlavy */ }
    const dir = u.facing < 0 ? -1 : 1;
    const footX = Math.round(u.x / 2 * HD) / HD;
    const footY = Math.round(u.y / 2 * HD) / HD + 6;
    // meta.head je od paty (jako oko u nemrtvých v game.js), pára vychází kousek před obličejem
    const hx = dir > 0 ? footX + head[0] + 3 : footX + 0.5 - head[0] - 3;
    const hy = footY + head[1] + 1;
    const k = ph / 1.1;
    g.globalAlpha = (1 - k) * 0.75;
    g.fillStyle = "#eef4fb";
    const dx = dir * (1 + k * 4);
    const dy = -k * 2;
    const r = 0.5 + k * 1.5;
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3 + u.id;
      fpx(g, hx + dx + Math.cos(a) * r, hy + dy + Math.sin(a) * r * 0.6);
    }
    g.globalAlpha = 1;
  }

  let lastT = 0;
  W.draw = (g, T, world, visible, v) => {
    if (!world || !world.ready) return;
    const dark = darkOf();
    const dt = clamp(T - lastT, 0, 0.1);
    lastT = T;

    // světýlka na hlavních budovách
    for (const b of v.buildings) {
      if (b.type !== "hall" || b.progress < 1 || !visible(b.x / 2, b.y / 2)) continue;
      const spr = PK.buildings.get(b.type, b.team);
      if (!spr.bulbs) continue;
      drawBulbs(g, spr.bulbs, Math.round(b.x / 2) - spr.ax, Math.round(b.y / 2) + 19 - spr.ay, T, b.id, dark);
    }
    // baňky a hvězda na stromcích
    for (const d of world.doodads) {
      const s = d.spr;
      if (!s.bulbs || !visible(d.x, d.y)) continue;
      const ox = d.x - s.ax;
      const oy = d.y - s.ay;
      drawBulbs(g, s.bulbs, ox, oy, T * 0.7, d.x, dark);
      const tw = Math.sin(T * 3 + d.x) > 0.2;
      g.globalAlpha = 0.5 + 0.5 * dark;
      g.fillStyle = "#fff6cc";
      fpx(g, ox + s.star[0], oy + s.star[1]);
      if (tw) { fpx(g, ox + s.star[0] - 1, oy + s.star[1]); fpx(g, ox + s.star[0] + 1, oy + s.star[1]); fpx(g, ox + s.star[0], oy + s.star[1] - 1); fpx(g, ox + s.star[0], oy + s.star[1] + 1); }
      g.globalAlpha = 1;
    }
    // třpyt dárků (ať jdou najít i v noci)
    for (const gf of v.gifts) {
      const ph = (T * 1.2 + gf.id * 0.37) % 2.2;
      if (ph > 0.3) continue;
      const x = Math.round(gf.x / 2) - 2 + (gf.id % 5);
      const y = Math.round(gf.y / 2) - 6;
      g.fillStyle = "#fff6cc";
      fpx(g, x, y);
      if (ph < 0.18) { fpx(g, x - 1, y); fpx(g, x + 1, y); fpx(g, x, y - 1); fpx(g, x, y + 1); }
    }
    // pára od úst
    for (const u of v.units) if (visible(u.x / 2, u.y / 2)) drawBreath(g, u, T);
    // záblesk sebraného dárku
    for (let i = bursts.length - 1; i >= 0; i--) {
      const p = bursts[i];
      p.t += dt;
      if (p.t > p.life) { bursts.splice(i, 1); continue; }
      p.vy += 40 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      g.globalAlpha = 1 - p.t / p.life;
      g.fillStyle = css(p.c);
      fpx(g, p.x, p.y);
    }
    g.globalAlpha = 1;
    drawFlakes(g, T, v);
  };

  W.gain = 0.6; // síla světel v zimě (shaders.js)

  /* Noc v zimě je chladnější a do modra, den o chlup studenější (shaders.js). */
  W.tint = amb => {
    const dark = clamp((0.8 - (amb[0] + amb[1] + amb[2]) / 3) / 0.6, 0, 1);
    return [amb[0] * (0.97 - 0.05 * dark), amb[1] * (0.99 - 0.01 * dark), amb[2] * (1.03 + 0.08 * dark)];
  };

  /* ---------- čepička sněhu na logu ----------
   * Na rovných horních hranách písmen a znaku G leží sníh, místy s převisem o bod níž.
   * Rozměry plátna i písmen zůstávají (sníh nahradí horní světlou hranu a obrys nad ní
   * se posune o bod výš jen tam, kde je místo). Pracuje v px zdrojového plátna. */
  const capCache = new WeakMap();
  W.capLogo = src => {
    if (capCache.has(src)) return capCache.get(src);
    const { P } = readPix(src);
    const { w, h } = P;
    const op = (x, y) => x >= 0 && y >= 0 && x < w && y < h && P.get(x, y) >= 0;
    const top = new Int32Array(w).fill(-1);
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) if (op(x, y)) { top[x] = y; break; }
    const out = P.clone();
    for (let x = 0; x < w; x++) {
      const y0 = top[x];
      if (y0 < 0) continue;
      const l = x > 0 ? top[x - 1] : -1;
      const r = x < w - 1 ? top[x + 1] : -1;
      if (Math.min(l < 0 ? 9 : Math.abs(l - y0), r < 0 ? 9 : Math.abs(r - y0)) > 1) continue;
      // sníh leží na obrysu (obrys se posune o bod výš), místy chomáč o bod níž do písmene
      const lit = x < w * 0.55;
      out.set(x, y0, lit ? SNOW[5] : SNOW[4]);
      if (y0 > 0 && !op(x, y0 - 1)) out.set(x, y0 - 1, INK);
      const lump = Math.sin(x * 1.7 + y0) + hash(x, y0, 31) * 0.8 > 0.75;
      if (lump && op(x, y0 + 1)) out.set(x, y0 + 1, lit ? SNOW[4] : SNOW[3]);
      // na konci čepice převis dolů
      const end = (l < 0 || Math.abs(l - y0) > 1) || (r < 0 || Math.abs(r - y0) > 1);
      if (end && op(x, y0 + 3)) { out.set(x, y0 + 1, SNOW[4]); out.set(x, y0 + 2, SNOW[2]); }
    }
    const c = out.rawCanvas();
    capCache.set(src, c);
    return c;
  };

  /* ---------- přepínání ---------- */
  function apply(on) {
    if (on) snowProps();
    else unsnowAll();
    if (PK.buildings && PK.buildings.reset) PK.buildings.reset();
    if (PK.world && PK.world.reseason) PK.world.reseason();
    if (PK.menubg && PK.menubg.reseason) PK.menubg.reseason();
  }

  // Zapne/vypne zimní vzhled (při startu zápasu podle serveru, příkazem /zima).
  W.set = on => {
    on = !!on;
    if (on === W.on) return;
    W.on = on;
    apply(on);
  };

  // Volba z příkazu správce: true/false vynutí, null vrátí kalendář.
  W.force = v => {
    try {
      if (v == null) localStorage.removeItem("pk-winter");
      else localStorage.setItem("pk-winter", v ? "1" : "0");
    } catch (e) { /* jen pro tuto stránku */ }
    W.set(season());
  };

  W.set(season());
})();
