/*
 * Kulisy navíc: keře, květy, rákosí, kameny, zříceniny, ploty, studny,
 * vozy, stohy, hroby, kosti, houby, mlýn... Všechno se kreslí v jemné
 * mřížce (PK.HD = 2) s tmavým obrysem stejně jako props.js a přidává se
 * do PK.props.doodads. Rozmístění volá world.js (PK.decor.doodads) po
 * kulisách z mapy: malé "zátiší" (statek u hlavní budovy, zřícenina,
 * hřbitůvek, bojiště) a rozptýlená drobná zeleň. Na hru nemá vliv:
 * kulisy se nedají vybrat, nekolidují a nemění simulaci.
 *
 * Souřadnice uvnitř kreslicích funkcí jsou v JEMNÝCH px, kotvy v art px.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const { C, Pix, mix, hash, vnoise, rng, HD } = PK;
  const K = PK.props.kit;
  const { rock, blocks, planks, limb, grass, shroom, stack, layer, relight, paintStack, crownClumps, clumpFill, clumpBox, pick, GX, SX, WX, HX, BONE } = K;
  const D = PK.props.doodads;
  const G = C.g;

  /* ---------- palety ---------- */
  const STRAW = [mix(C.w[1], C.shade, 0.3), C.w[2], C.d[2], C.d[3], C.d[4], C.d[5], mix(C.d[5], C.white, 0.45)];
  const DRY = [mix(C.w[0], C.shade, 0.4), C.w[1], C.w[2], C.d[2], C.d[3], C.d[4], C.d[5], C.d[5]];
  const BERRY = GX.map((c, i) => mix(c, C.t[Math.min(4, i >> 1)], 0.18));
  const LIGHTGX = GX.map((c, i) => mix(c, i > 4 ? C.a[3] : C.g[3], 0.15));
  const IVY = [mix(G[0], C.shade, 0.5), G[0], G[1], G[2], G[3], G[4], G[5], G[5]];
  const RUIN = SX.map((c, i) => mix(c, C.d[Math.min(5, i)], 0.18));
  const MOSSY = SX.map((c, i) => mix(c, C.g[Math.min(6, i)], 0.12));
  const REED = [mix(G[0], C.shade, 0.4), G[1], G[2], mix(G[3], C.d[3], 0.3), mix(G[4], C.d[4], 0.35), mix(G[5], C.d[5], 0.4)];
  const CATTAIL = [C.w[0], C.w[1], C.w[2], C.w[3]];
  const WATERP = [C.v[0], C.v[1], C.v[2], C.v[3], C.v[4]];
  const IRON = [C.s[0], C.s[1], C.s[2], C.s[3], C.s[4], C.s[5]];
  const CLOTH = [mix(C.d[1], C.shade, 0.3), C.d[2], C.d[3], mix(C.d[4], C.bone[0], 0.3), mix(C.d[5], C.white, 0.4)];

  const foliage = ramp => t => (t > ramp.length - 2.4 ? ramp[ramp.length - 1] : pick(ramp, t + 1));
  const sprite = (name, w, h, ax, ay, fn, extra = {}, ol = 0.72) => K.sprite(name, w, h, ax, ay, fn, { deco: true, ...extra }, ol);

  /* ======================= pomocníci ======================= */

  // Keř ze shluků listí: stejné osvětlení a stíny mezi shluky jako koruny stromů.
  function bush(P, cx, by, rx, ry, seed, ramp = GX, o = {}) {
    const lobes = o.lobes || [[cx, by - ry, rx, ry]];
    const list = crownClumps(lobes, seed, o.rmin || 3, o.rmax || 5);
    const gx = cx;
    const gy = by - ry;
    const glob = (x, y) => (o.base ?? 2.6) + 1.3 * -(((x - gx) / rx) * 0.55 + ((y - gy) / ry) * 0.85);
    const L = stack(P.w, P.h);
    for (const c of list) {
      if (c.y + c.ry > by) c.y = by - c.ry;
      layer(L, clumpBox(c), clumpFill(c, glob));
    }
    relight(L, { occ: 1.5, occ2: 0.7, rim: 0.6, under: 0.8 });
    paintStack(P, L, foliage(ramp));
    return list;
  }

  // bobule / plody: 2x2 jemné px s odleskem
  function berry(P, x, y, ramp) {
    P.set(x, y, ramp[2]);
    P.set(x + 1, y, ramp[1]);
    P.set(x, y + 1, ramp[1]);
    P.set(x + 1, y + 1, ramp[0]);
    P.set(x, y, ramp[3]);
  }

  // kvítek: střed a čtyři lístky, nebo jen bod pro drobné
  function flower(P, x, y, petal, petalD, mid, big = true) {
    if (big) {
      P.set(x - 1, y, petal);
      P.set(x + 1, y, petalD);
      P.set(x, y - 1, petal);
      P.set(x, y + 1, petalD);
    }
    P.set(x, y, mid);
  }

  // stéblo: zahnutá čárka od paty nahoru
  function blade(P, x, y, len, lean, ramp) {
    for (let k = 0; k < len; k++) {
      const t = k / Math.max(1, len - 1);
      const xx = Math.round(x + lean * t * t);
      P.set(xx, y - k, pick(ramp, 1.2 + t * (ramp.length - 2.2)));
    }
  }

  // kulatý kůl / sloupek s osvětlenou levou hranou
  function post(P, x, y0, y1, w, ramp = WX, o = {}) {
    for (let y = y0; y <= y1; y++) {
      for (let k = 0; k < w; k++) {
        let v = (o.base ?? 3.4) - (k / Math.max(1, w - 1)) * 2.4;
        if (k === 0) v += 0.6;
        if (y === y0) v += 0.8;
        if (hash(x + k, y, o.seed || 4) > 0.86) v -= 0.8;
        P.set(x + k, y, pick(ramp, v));
      }
    }
  }

  // vodorovné břevno / prkno s horní světlou hranou
  function rail(P, x0, y0, x1, y1, th, ramp = WX, seed = 3) {
    const n = Math.max(Math.abs(x1 - x0), 1);
    for (let i = 0; i <= n; i++) {
      const x = Math.round(x0 + (x1 - x0) * i / n);
      const y = Math.round(y0 + (y1 - y0) * i / n);
      for (let k = 0; k < th; k++) {
        let v = k === 0 ? 4.2 : k === th - 1 ? 1.6 : 3;
        if (hash(x, k, seed) > 0.88) v -= 0.9;
        P.set(x, y + k, pick(ramp, v));
      }
    }
  }

  // trs trávy u paty
  const tuft = (P, x, y, n, seed) => grass(P, x, y, n, seed);

  // břečťan přes zdivo: shluky lístků visících z horních hran
  function ivy(P, x0, x1, seed, density = 0.5, maxLen = 14) {
    for (let x = x0; x <= x1; x++) {
      if (hash(x, 1, seed) > density) continue;
      let y0 = -1;
      for (let y = 0; y < P.h; y++) if (P.get(x, y) >= 0) { y0 = y; break; }
      if (y0 < 0) continue;
      const len = 2 + Math.floor(hash(x, 2, seed) * maxLen);
      for (let i = 0; i < len; i++) {
        const y = y0 + i;
        if (P.get(x, y) < 0) break;
        const lit = (x + i) % 3 === 0;
        P.set(x, y, i === 0 ? IVY[5] : lit ? IVY[4] : i % 2 ? IVY[3] : IVY[2]);
        if (i % 3 === 2 && P.get(x + 1, y) >= 0) P.set(x + 1, y, IVY[2]);
      }
    }
  }

  // stín pod předmětem uvnitř spritu (kontaktní, tmavá elipsa jen přes trávu)
  function contact(P, cx, cy, rx, ry, c = mix(G[1], C.shade, 0.5)) {
    P.disc(cx, cy, rx, ry, (x, y) => (P.get(x, y) < 0 ? c : null));
  }

  /* ======================= zeleň ======================= */

  sprite("bushA", 14, 10, 7, 9, P => {
    contact(P, 14, 18, 11, 2.2);
    bush(P, 14, 19, 11, 7, 3, GX, { lobes: [[10, 12, 7, 6], [18, 11, 7, 6], [14, 8, 6, 5]], rmin: 3, rmax: 4.5 });
    tuft(P, 4, 19, 2, 2);
    tuft(P, 23, 19, 2, 3);
  });

  sprite("bushB", 16, 11, 8, 10, P => {
    contact(P, 16, 20, 13, 2.4);
    const list = bush(P, 16, 21, 13, 8, 11, BERRY, { lobes: [[10, 14, 8, 6], [21, 13, 8, 7], [15, 9, 7, 5]], rmin: 3, rmax: 5 });
    // červené bobule u spodních shluků
    const R = rng(17);
    const RB = [C.r[1], C.r[2], C.cap[1], C.cap[2]];
    for (let i = 0; i < 11; i++) {
      const c = list[Math.floor(R() * list.length)];
      const x = Math.round(c.x + (R() - 0.5) * c.r);
      const y = Math.round(c.y + (R() - 0.2) * c.ry * 0.8);
      if (P.get(x, y) >= 0 && P.get(x + 1, y + 1) >= 0) berry(P, x, y, RB);
    }
  });

  sprite("bushFlower", 15, 10, 7, 9, P => {
    contact(P, 15, 18, 12, 2.2);
    const list = bush(P, 15, 19, 12, 7, 23, LIGHTGX, { lobes: [[9, 12, 7, 6], [20, 12, 7, 6], [15, 8, 6, 5]], rmin: 3, rmax: 4.5 });
    const R = rng(29);
    for (let i = 0; i < 16; i++) {
      const c = list[Math.floor(R() * list.length)];
      const x = Math.round(c.x + (R() - 0.6) * c.r);
      const y = Math.round(c.y + (R() - 0.7) * c.ry);
      if (P.get(x, y) < 0 || P.get(x - 1, y) < 0 || P.get(x + 1, y) < 0) continue;
      const lit = x < 15;
      flower(P, x, y, lit ? C.white : C.bone[0], C.bone[1], C.a[2], R() > 0.35);
    }
  });

  sprite("bushDry", 14, 11, 7, 10, P => {
    contact(P, 14, 20, 10, 2);
    // suché větvičky z jednoho kořene, na koncích pár zbylých lístků
    const R = rng(5);
    for (let i = 0; i < 13; i++) {
      const a = -Math.PI / 2 + (R() - 0.5) * 2.4;
      const len = 7 + R() * 9;
      const x1 = 14 + Math.cos(a) * len;
      const y1 = 20 + Math.sin(a) * len * 0.95;
      limb(P, 14 + (R() - 0.5) * 3, 20, x1, y1, 2, 1, WX, { grain: false, base: 2.6 + (x1 < 14 ? 1 : 0) });
      const mx = (14 + x1) / 2;
      const my = (20 + y1) / 2;
      limb(P, mx, my, mx + Math.cos(a - 0.7) * 4, my + Math.sin(a - 0.7) * 4, 1, 1, WX, { grain: false, base: 3 });
      if (R() > 0.4) P.set(Math.round(x1), Math.round(y1), R() > 0.5 ? DRY[5] : DRY[4]);
      if (R() > 0.6) P.set(Math.round(x1) + 1, Math.round(y1) + 1, DRY[3]);
    }
    tuft(P, 8, 21, 2, 7);
  });

  sprite("hedge", 22, 11, 11, 10, P => {
    contact(P, 22, 20, 19, 2.2);
    bush(P, 22, 21, 19, 7, 41, GX, { lobes: [[8, 14, 7, 6], [17, 12, 7, 7], [27, 12, 7, 7], [36, 14, 7, 6]], rmin: 3, rmax: 4.5, base: 2.3 });
  });

  // mladé stromky (nedají se kácet, jsou to jen kulisy)
  function sapling(name, kind, seed) {
    sprite(name, 12, 20, 6, 19, P => {
      contact(P, 12, 38, 6, 1.6);
      if (kind === "birch") {
        post(P, 11, 14, 38, 2, [C.s[1], C.s[2], C.s[4], C.s[5], C.white, C.white], { base: 4.6, seed });
        for (const y of [17, 22, 27, 31, 35]) P.set(11 + (y & 1), y, C.ink);
        bush(P, 12, 24, 8, 10, seed, K.BIRCHL, { lobes: [[12, 12, 7, 7], [8, 19, 4, 4], [16, 18, 4, 4]], rmin: 2.5, rmax: 4 });
      } else if (kind === "pine") {
        post(P, 11, 28, 38, 2, WX, { seed });
        const L = stack(P.w, P.h);
        [[12, 22, 9, 10], [12, 14, 7, 9], [12, 6, 5, 8], [12, 1, 2.5, 5]].forEach(([tx, top, hw, th], i) => {
          layer(L, [tx - hw - 1, top, tx + hw + 1, top + th + 1], (x, y) => {
            const dx = x + 0.5 - tx;
            const rel = (y + 0.5 - top) / th;
            if (rel < 0 || rel > 1) return null;
            if (Math.abs(dx) > hw * Math.pow(rel, 0.8) + 0.5) return null;
            const tri = (x + i) % 4 < 2 ? 0 : 1;
            if (rel > 0.85 && tri) return null;
            return 4 - dx / hw * 2.2 - rel * 0.6 + (hash(x, y, seed) > 0.9 ? 0.8 : 0);
          });
        });
        relight(L, { occ: 1.4, occ2: 0.6, rim: 0.6, under: 0.5 });
        paintStack(P, L, t => pick(K.PINE, t));
      } else {
        post(P, 11, 18, 38, 2, WX, { seed });
        limb(P, 12, 28, 6, 22, 1.5, 1, WX, { grain: false });
        bush(P, 12, 26, 9, 11, seed, GX, { lobes: [[12, 13, 8, 8], [7, 20, 5, 4], [17, 19, 5, 4]], rmin: 2.5, rmax: 4 });
      }
      tuft(P, 7, 38, 2, seed);
      tuft(P, 16, 38, 1, seed + 1);
    });
  }
  sapling("saplingBirch", "birch", 31);
  sapling("saplingPine", "pine", 37);
  sapling("saplingOak", "oak", 43);

  // květinové záhony (plochá kulisa, bez stínu)
  function meadow(name, w, cols, seed, n) {
    sprite(name, w, 6, w / 2, 5, P => {
      const R = rng(seed);
      const FW = w * HD;
      for (let i = 0; i < n; i++) {
        const x = 2 + Math.floor(R() * (FW - 4));
        const y = 4 + Math.floor(R() * 7) + Math.round(Math.abs(x - FW / 2) / FW * 2);
        const len = 2 + Math.floor(R() * 3);
        blade(P, x, y, len, R() > 0.5 ? 1 : -1, GX.slice(2));
        const [pa, pd, mid] = cols[Math.floor(R() * cols.length)];
        if (R() > 0.25) flower(P, Math.round(x + (R() > 0.5 ? 1 : 0)), y - len, pa, pd, mid, R() > 0.4);
      }
    }, { flat: true }, 0.6);
  }
  meadow("flowersYellow", 12, [[C.a[3], C.a[1], C.a[4]], [C.a[4], C.a[2], C.a[1]], [C.white, C.bone[1], C.a[2]]], 51, 26);
  meadow("flowersBlue", 12, [[C.u[3], C.u[2], C.u[4]], [C.m[3], C.m[2], C.white], [C.u[4], C.u[3], C.white]], 53, 24);
  meadow("flowersRed", 12, [[C.r[3], C.r[2], C.ink], [C.r[4], C.r[2], C.shade], [C.cap[2], C.cap[1], C.a[3]]], 57, 22);
  meadow("flowersWhite", 10, [[C.white, C.bone[1], C.a[3]], [C.bone[0], C.bone[1], C.a[2]]], 59, 20);

  // levandule: fialové klasy na trsu
  sprite("lavender", 12, 9, 6, 8, P => {
    contact(P, 12, 16, 9, 1.6);
    const R = rng(61);
    for (let i = 0; i < 16; i++) {
      const x = 5 + Math.floor(R() * 15);
      const len = 6 + Math.floor(R() * 7) - Math.round(Math.abs(x - 12) * 0.4);
      const lean = (x - 12) * 0.25;
      blade(P, x, 17, len, lean, GX.slice(1, 6));
      const tx = Math.round(x + lean);
      const ty = 17 - len;
      for (let k = 0; k < 4; k++) P.set(tx + (k & 1 ? 0 : 0), ty + k, k === 0 ? C.m[3] : k === 3 ? C.m[1] : x < 12 ? C.m[3] : C.m[2]);
      P.set(tx + 1, ty + 1, C.m[1]);
    }
  });

  // vysoká tráva / ostřice
  sprite("tallGrass", 12, 10, 6, 9, P => {
    const R = rng(67);
    for (let i = 0; i < 26; i++) {
      const x = 3 + Math.floor(R() * 18);
      const len = 6 + Math.floor(R() * 12) - Math.round(Math.abs(x - 12) * 0.5);
      blade(P, x, 19, Math.max(3, len), (R() - 0.5) * 7, x < 12 ? GX.slice(2) : GX.slice(1, 7));
    }
    // klasy na pár stéblech
    for (let i = 0; i < 4; i++) {
      const x = 6 + Math.floor(R() * 12);
      const y = 3 + Math.floor(R() * 4);
      P.set(x, y, C.d[4]);
      P.set(x, y + 1, C.d[3]);
      P.set(x + 1, y + 2, C.d[2]);
    }
  }, { flat: true }, 0.55);

  // rákosí s orobincem (na břehu)
  function reeds(name, w, seed, n) {
    sprite(name, w, 14, w / 2, 13, P => {
      const R = rng(seed);
      const FW = w * HD;
      for (let i = 0; i < n; i++) {
        const x = 3 + Math.floor(R() * (FW - 6));
        const len = 10 + Math.floor(R() * 14) - Math.round(Math.abs(x - FW / 2) * 0.35);
        const lean = (R() - 0.5) * 5;
        blade(P, x, 27, Math.max(5, len), lean, REED);
        if (R() > 0.55 && len > 14) {
          // orobinec: hnědý doutník se světlou hranou
          const tx = Math.round(x + lean);
          const ty = 27 - len;
          for (let k = 0; k < 5; k++) {
            P.set(tx, ty + k, k === 0 ? CATTAIL[3] : CATTAIL[2]);
            P.set(tx + 1, ty + k, k === 4 ? CATTAIL[0] : CATTAIL[1]);
          }
          P.set(tx, ty - 1, REED[4]);
        }
      }
      // široké listy
      for (let i = 0; i < 4; i++) {
        const x = 4 + Math.floor(R() * (FW - 8));
        const dir = R() > 0.5 ? 1 : -1;
        for (let k = 0; k < 9; k++) {
          const xx = x + Math.round(dir * k * k * 0.09);
          P.set(xx, 27 - k, pick(REED, 2 + k * 0.3));
          P.set(xx + 1, 27 - k, pick(REED, 1 + k * 0.25));
        }
      }
    }, { flat: true, bank: true }, 0.6);
  }
  reeds("reedsA", 12, 71, 18);
  reeds("reedsB", 16, 73, 26);

  // lekníny (na vodě, plochá kulisa)
  sprite("lilyPads", 14, 6, 7, 4, P => {
    const pads = [[8, 5, 5, 2.4], [19, 7, 4, 2], [13, 9, 3.5, 1.8]];
    for (const [cx, cy, rx, ry] of pads) {
      P.disc(cx, cy, rx, ry, (x, y) => {
        const a = Math.atan2(y + 0.5 - cy, x + 0.5 - cx);
        if (a > 0.1 && a < 0.6) return null; // zářez listu
        const l = -((x + 0.5 - cx) / rx * 0.6 + (y + 0.5 - cy) / ry * 0.8);
        return pick(GX, 3.6 + l * 1.6);
      });
      P.set(Math.round(cx - rx * 0.4), Math.round(cy - ry * 0.4), G[6]);
    }
    // květ
    flower(P, 9, 4, C.cap[2], C.cap[1], C.a[3]);
    P.set(9, 3, C.white);
  }, { flat: true, water: true }, 0.55);

  /* ======================= houby ======================= */
  const brownCap = {
    ramp: [mix(C.w[1], C.shade, 0.3), C.w[1], C.w[2], C.w[3], C.w[4]],
    gill: C.bone[1], gillD: C.bone[2], spot: C.w[4], glint: C.d[5]
  };
  const paleCap = {
    ramp: [C.bone[2], mix(C.bone[2], C.bone[1], 0.5), C.bone[1], C.bone[0], C.white],
    gill: C.d[2], gillD: C.d[1], spot: C.white, glint: C.white
  };
  sprite("shroomBrown", 12, 9, 6, 8, P => {
    shroom(P, 7, 17, 6, 5.5, brownCap, {});
    shroom(P, 15, 17, 4, 4, brownCap, { lean: 1 });
    shroom(P, 3, 17, 2, 2.6, paleCap, {});
    tuft(P, 11, 17, 3, 4);
  });

  // čarodějný kruh: drobné bílé houbičky do elipsy (plochý)
  sprite("fairyRing", 20, 8, 10, 5, P => {
    const n = 15;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + hash(i, 1, 3) * 0.2;
      const x = Math.round(20 + Math.cos(a) * 15);
      const y = Math.round(9 + Math.sin(a) * 5);
      const big = hash(i, 2, 3) > 0.5;
      P.set(x, y + 1, BONE[3]);
      P.set(x, y, big ? C.white : BONE[5]);
      if (big) { P.set(x - 1, y, BONE[4]); P.set(x + 1, y, BONE[2]); P.set(x, y - 1, C.white); }
    }
    // tmavší zelený prstenec trávy
    for (let i = 0; i < 60; i++) {
      const a = i / 60 * Math.PI * 2;
      const x = Math.round(20 + Math.cos(a) * 13);
      const y = Math.round(10 + Math.sin(a) * 3.8);
      if (hash(i, 4, 3) > 0.45) P.set(x, y, G[2]);
    }
  }, { flat: true }, 0.4);

  /* ======================= dřevo ======================= */

  // padlý kmen s mechem a houbou
  sprite("logFallen", 24, 9, 12, 8, P => {
    contact(P, 24, 15, 21, 2.4);
    limb(P, 6, 11, 44, 9, 9, 8, WX, { seed: 7, base: 3, gl: 5 });
    // řez kmene vlevo: letokruhy
    P.disc(5.5, 11, 3, 4.4, (x, y) => {
      const d = Math.hypot((x + 0.5 - 5.5) / 3, (y + 0.5 - 11) / 4.4);
      return d > 0.85 ? C.w[2] : (Math.round(d * 4) & 1) ? C.d[3] : C.d[4];
    });
    P.set(5, 11, C.w[2]);
    // mech na hřbetu a houbičky
    for (let x = 10; x < 42; x++) {
      if (vnoise(x / 4, 1, 3) < 0.45) continue;
      const top = 6 + Math.round((x - 10) * -0.06);
      for (let k = 0; k < 1 + Math.round(vnoise(x / 2, 3, 4) * 2); k++) P.set(x, top + k, k === 0 ? G[5] : G[4]);
    }
    shroom(P, 33, 6, 2, 2.4, brownCap, {});
    shroom(P, 36, 6, 1, 1.8, brownCap, {});
    // zlomená větev
    limb(P, 24, 8, 27, 1, 2.5, 1.2, WX, { grain: false, base: 3.4 });
    tuft(P, 14, 17, 3, 7);
    tuft(P, 40, 16, 2, 8);
  });

  // hranice dřeva (polena v trojúhelníku, čela světlá)
  sprite("woodpile", 18, 12, 9, 11, P => {
    contact(P, 18, 22, 16, 2.4);
    const rows = [[6, 19, 7], [9, 14, 6], [12, 9, 5], [15, 4, 3]];
    for (const [x0, y, n] of rows) {
      for (let i = 0; i < n; i++) {
        const cx = x0 + i * 5.2;
        P.disc(cx, y, 2.7, 2.6, (x, yy) => {
          const d = Math.hypot(x + 0.5 - cx, yy + 0.5 - y);
          if (d > 2.2) return (x + 0.5 < cx) ? C.w[3] : C.w[1];
          return (Math.round(d * 1.6) & 1) ? C.d[3] : C.d[4];
        });
        P.set(Math.round(cx), Math.round(y), C.w[2]);
      }
    }
    // dvě opěrné tyče
    post(P, 3, 6, 21, 2, WX, { seed: 3 });
    post(P, 32, 6, 21, 2, WX, { seed: 4 });
  });

  // pařez se zaseknutou sekerou
  sprite("stumpAxe", 12, 12, 6, 11, P => {
    contact(P, 12, 21, 9, 2);
    for (const [x0, x1] of [[6, 2], [18, 22], [12, 13]]) limb(P, 12 + (x0 - 12) * 0.5, 18, x1, 22, 3, 1.5, WX, { seed: 3, base: 2.6 });
    K.barkTrunk(P, 10, 21, () => [5, 19], 9, { base: 4.2 });
    P.disc(12, 10, 7, 2.6, (x, y) => {
      const d = Math.hypot((x + 0.5 - 12) / 7, (y + 0.5 - 10) / 2.6);
      return d > 0.82 ? C.w[3] : (Math.round(d * 5) & 1) ? C.d[3] : C.d[4];
    });
    // sekera: topůrko šikmo nahoru, ostří zaseknuté v řezu
    limb(P, 13, 9, 21, 1, 2, 2, WX, { grain: false, base: 3.6 });
    P.poly([[10, 6], [15, 7], [15, 11], [10, 12]], (x, y) => (x < 11 ? C.s[6] : y < 8 ? C.s[5] : C.s[3]));
    P.set(10, 6, C.white);
  });

  /* ======================= kameny ======================= */

  sprite("boulderMoss", 22, 16, 11, 15, P => {
    contact(P, 22, 30, 19, 2.6);
    rock(P, [[3, 31], [2, 22], [6, 12], [14, 5], [26, 3], [36, 7], [41, 16], [42, 27], [39, 31]], { seed: 21, area: 80, moss: 9, cracks: 2, ramp: MOSSY });
    tuft(P, 4, 31, 3, 6);
    tuft(P, 38, 31, 3, 7);
  });

  sprite("rockPile", 16, 9, 8, 8, P => {
    contact(P, 16, 16, 14, 2);
    rock(P, [[2, 17], [3, 12], [8, 9], [13, 11], [14, 17]], { seed: 31, area: 30, moss: 2 });
    rock(P, [[18, 17], [19, 11], [24, 7], [29, 9], [31, 17]], { seed: 33, area: 30, moss: 3 });
    rock(P, [[10, 17], [12, 13], [17, 11], [22, 14], [22, 17]], { seed: 35, area: 26 });
    tuft(P, 9, 17, 2, 4);
  });

  sprite("pebbles", 10, 4, 5, 3, P => {
    const st = [[3, 5, 2.4, 1.6], [8, 6, 1.6, 1.2], [12, 4, 2, 1.4], [16, 6, 1.4, 1], [6, 2, 1.2, 1]];
    for (const [cx, cy, rx, ry] of st) {
      P.disc(cx, cy, rx, ry, (x, y) => pick(SX, 4.2 - ((x + 0.5 - cx) / rx * 0.6 + (y + 0.5 - cy) / ry * 0.9) * 1.6));
    }
  }, { flat: true }, 0.6);

  // plochý kámen se zrcátkem vody v prohlubni
  sprite("rockSlab", 18, 8, 9, 7, P => {
    rock(P, [[2, 14], [4, 8], [12, 5], [26, 5], [33, 8], [34, 14]], { seed: 41, area: 90, base: 4, gain: 0.8, moss: 2 });
    P.disc(17, 9, 4, 1.4, (x, y) => (y < 9 ? C.v[3] : C.v[2]));
    P.set(15, 8, C.v[4]);
    tuft(P, 3, 15, 2, 7);
  });

  // kamenná mohyla (cairn) z plochých kamenů
  sprite("cairn", 12, 16, 6, 15, P => {
    contact(P, 12, 30, 10, 2.2);
    const st = [[12, 27, 9, 3.4], [11, 21, 7.5, 3], [13, 16, 6, 2.6], [12, 11, 4.6, 2.3], [12, 7, 3.2, 1.8], [12, 4, 2, 1.4]];
    st.forEach(([cx, cy, rx, ry], i) => {
      P.disc(cx, cy, rx, ry, (x, y) => {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        let v = 4 - nx * 1.2 - ny * 1.6;
        if (ny > 0.55) v -= 1.2;
        if (hash(x, y, i) > 0.9) v -= 0.7;
        return pick(SX, v);
      });
    });
    tuft(P, 5, 30, 2, 4);
  });

  /* ======================= zříceniny ======================= */

  // ulomená zeď s oknem a břečťanem
  sprite("ruinWall", 30, 24, 15, 23, P => {
    contact(P, 30, 46, 27, 2.4);
    const top = x => 8 + Math.round(Math.abs(Math.sin(x * 0.21 + 1)) * 5 + (x > 36 ? (x - 36) * 1.2 : 0) + (x < 8 ? (8 - x) * 1.4 : 0));
    blocks(P, 4, 4, 52, 42, {
      ramp: RUIN, seed: 7, rowH: 5, minW: 6, maxW: 11,
      mask: (x, y) => y >= top(x) && !(x >= 21 && x <= 30 && y >= 18 && y <= 33) || (y > 33 + 0 && x >= 21 && x <= 30 && y >= 34),
      light: x => -(x - 4) / 52 * 1.2
    });
    // klenutý otvor okna
    for (let y = 16; y <= 34; y++) {
      for (let x = 20; x <= 31; x++) {
        const inside = y >= 21 ? x >= 21 && x <= 30 : Math.hypot(x + 0.5 - 26, y + 0.5 - 21) <= 5;
        const ring = !inside && (y >= 21 ? x >= 20 && x <= 31 : Math.hypot(x + 0.5 - 26, y + 0.5 - 21) <= 6.2);
        if (ring && y < 34) P.set(x, y, x < 26 ? RUIN[5] : RUIN[3]);
        if (inside && y < 34) P.clear(x, y);
      }
    }
    for (let x = 21; x <= 30; x++) { P.set(x, 34, RUIN[2]); P.set(x, 33, RUIN[5]); }
    // spadlé kvádry
    for (const [x, y, w] of [[2, 42, 6], [48, 41, 7], [40, 44, 5]]) {
      for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < w; xx++) P.set(x + xx, y + yy, pick(RUIN, yy === 0 ? 5 : xx === w - 1 || yy === 3 ? 2 : 3.6));
    }
    ivy(P, 8, 48, 7, 0.42, 16);
    tuft(P, 6, 47, 3, 5);
    tuft(P, 34, 47, 3, 6);
  });

  // osamělý oblouk
  sprite("ruinArch", 24, 28, 12, 27, P => {
    contact(P, 24, 54, 21, 2.4);
    const inArch = (x, y) => y >= 26 ? x >= 14 && x <= 33 : Math.hypot(x + 0.5 - 24, y + 0.5 - 26) <= 10;
    blocks(P, 4, 6, 40, 48, {
      ramp: RUIN, seed: 13, rowH: 5, minW: 6, maxW: 10,
      mask: (x, y) => !inArch(x, y) && y >= (x > 30 ? 6 + (x - 30) * 1.6 : 6) && Math.hypot(x + 0.5 - 24, y + 0.5 - 26) <= 22 || (y > 26 && !inArch(x, y)),
      light: x => -(x - 4) / 40 * 1.3
    });
    // klenáky po obvodu oblouku
    for (let i = 0; i <= 14; i++) {
      const a = Math.PI + i / 14 * Math.PI;
      for (let r = 10; r <= 13; r++) {
        const x = Math.round(24 + Math.cos(a) * r);
        const y = Math.round(26 + Math.sin(a) * r);
        if (P.get(x, y) < 0) continue;
        P.set(x, y, i % 2 ? RUIN[4] : RUIN[5]);
        if (r === 13) P.set(x, y, RUIN[2]);
      }
    }
    for (let x = 0; x < 48; x++) for (let y = 0; y < 56; y++) if (P.get(x, y) >= 0 && y > 50) P.set(x, y, pick(RUIN, 2.2));
    ivy(P, 6, 40, 19, 0.5, 20);
    tuft(P, 6, 54, 3, 8);
    tuft(P, 40, 54, 3, 9);
  });

  // pahýl sloupu s hlavicí ležící vedle
  sprite("ruinStub", 18, 14, 9, 13, P => {
    contact(P, 18, 26, 16, 2.4);
    // patka
    blocks(P, 4, 20, 16, 6, { ramp: RUIN, seed: 3, rowH: 3, minW: 5, maxW: 8 });
    // dřík s kanelurami
    for (let y = 6; y < 20; y++) {
      for (let x = 6; x < 18; x++) {
        if (y < 6 + Math.round(Math.abs(Math.sin(x * 0.9)) * 3)) continue;
        const rel = (x - 6) / 12;
        let v = 5 - rel * 3.2;
        if ((x - 6) % 3 === 2) v -= 0.9;
        P.set(x, y, pick(RUIN, v));
      }
    }
    // ležící hlavice
    P.poly([[22, 26], [23, 19], [34, 19], [35, 26]], (x, y) => pick(RUIN, y === 19 ? 5.4 : y > 24 ? 2 : 4 - (x - 22) * 0.08));
    for (let x = 23; x <= 34; x += 3) P.set(x, 22, RUIN[2]);
    ivy(P, 6, 18, 23, 0.55, 8);
    tuft(P, 3, 26, 2, 2);
    tuft(P, 20, 27, 3, 3);
  });

  // stará socha bojovníka bez hlavy, s mečem
  sprite("statueBroken", 14, 26, 7, 25, P => {
    contact(P, 14, 50, 12, 2.4);
    blocks(P, 4, 42, 20, 8, { ramp: MOSSY, seed: 5, rowH: 4, minW: 6, maxW: 10 });
    const body = [[9, 42], [8, 30], [7, 22], [9, 16], [13, 14], [17, 15], [20, 18], [21, 24], [19, 30], [19, 42]];
    P.poly(body, (x, y) => {
      const rel = (x - 7) / 14;
      let v = 5 - rel * 3 + (y > 34 ? -0.4 : 0);
      if (hash(x, y, 5) > 0.92) v -= 1;
      if (y > 30 && (x === 13 || x === 14)) v -= 1; // záhyb pláště
      return pick(SX, v);
    });
    // ulomený krk
    P.rect(12, 12, 4, 2, SX[4]);
    P.set(12, 12, SX[6]);
    // meč před tělem, hrot dolů
    limb(P, 14, 18, 14, 41, 2, 2, SX, { grain: false, base: 5 });
    P.rect(11, 20, 7, 1, SX[3]);
    // mech na ramenou
    for (let x = 9; x < 21; x++) if (vnoise(x / 2, 1, 7) > 0.5) P.set(x, 15 + (x > 16 ? 1 : 0), G[4]);
    ivy(P, 6, 22, 31, 0.3, 10);
    tuft(P, 5, 50, 2, 8);
  });

  /* ======================= vesnice a statek ======================= */

  // studna: kamenná obruba, stříška, rumpál s vědrem
  sprite("well", 20, 26, 10, 25, P => {
    contact(P, 20, 50, 17, 2.4);
    // obruba: válec z kvádrů
    blocks(P, 6, 36, 28, 14, { ramp: SX, seed: 9, rowH: 4, minW: 5, maxW: 8, light: x => -((x - 6) / 28) * 1.4 + (x < 10 ? 0.4 : 0) });
    P.disc(20, 36, 14, 3.4, (x, y) => (Math.hypot((x + 0.5 - 20) / 14, (y + 0.5 - 36) / 3.4) > 0.74 ? (x < 20 ? SX[6] : SX[4]) : y < 36 ? C.ink : C.v[1]));
    P.set(17, 37, C.v[3]);
    // sloupky a stříška
    post(P, 7, 12, 36, 2, WX, { seed: 2 });
    post(P, 31, 12, 36, 2, WX, { seed: 3 });
    K.planks(P, 2, 6, 36, 8, { ramp: WX, size: 3, dir: "v", seed: 4, mask: (x, y) => y >= 13 - Math.min(x - 2, 38 - x) * 0.6 && y <= 13 });
    for (let x = 2; x < 38; x++) {
      const y = Math.round(13 - Math.min(x - 2, 37 - x) * 0.6);
      P.set(x, y - 1, C.w[4]);
      P.set(x, 14, C.w[1]);
    }
    // rumpál a provaz s vědrem
    rail(P, 8, 18, 32, 18, 2, WX, 5);
    P.set(33, 18, C.s[4]); P.set(34, 19, C.s[3]); P.set(34, 20, C.s[3]);
    for (let y = 20; y < 27; y++) P.set(20, y, C.d[4]);
    P.poly([[17, 27], [23, 27], [22, 32], [18, 32]], (x, y) => (y === 27 ? C.s[4] : y === 30 ? C.s[3] : x < 20 ? C.w[3] : C.w[2]));
    tuft(P, 5, 50, 3, 3);
    tuft(P, 34, 50, 2, 4);
  });

  // plot z kůlů a dvou břeven
  function fence(name, broken, seed) {
    sprite(name, 22, 11, 11, 10, P => {
      const posts = [3, 15, 27, 39];
      posts.forEach((x, i) => {
        const tall = broken && i === 2 ? 12 : 4;
        post(P, x, tall + (i & 1), 20, 3, WX, { seed: seed + i });
        P.set(x + 1, tall + (i & 1) - 1, C.w[3]);
      });
      if (broken) {
        rail(P, 3, 8, 17, 9, 2, WX, seed);
        rail(P, 3, 14, 17, 15, 2, WX, seed + 1);
        // spadlé břevno šikmo k zemi
        rail(P, 22, 14, 40, 19, 2, WX, seed + 2);
        rail(P, 29, 9, 42, 10, 2, WX, seed + 3);
      } else {
        rail(P, 2, 8, 42, 9, 2, WX, seed);
        rail(P, 2, 14, 42, 15, 2, WX, seed + 1);
      }
      tuft(P, 9, 21, 2, seed);
      tuft(P, 33, 21, 2, seed + 1);
    });
  }
  fence("fenceA", false, 3);
  fence("fenceB", true, 7);

  // vůz s senem
  function cart(name, hay, broken) {
    sprite(name, 26, 16, 13, 15, P => {
      contact(P, 26, 30, 23, 2.6);
      // korba
      K.planks(P, 6, 14, 36, 8, { ramp: WX, size: 3, seed: 4, light: x => -(x - 6) / 36 });
      for (let x = 6; x < 42; x++) { P.set(x, 13, C.w[4]); P.set(x, 22, C.w[0]); }
      if (hay) {
        // seno navršené nad korbou, stébla trčí
        P.disc(23, 13, 16, 7, (x, y) => (y > 13 ? null : pick(STRAW, 5.4 - (x - 7) / 32 * 2.2 - (y - 6) * 0.1 + (hash(x, y, 2) > 0.8 ? -0.9 : 0))));
        for (let i = 0; i < 14; i++) {
          const x = 9 + Math.floor(hash(i, 1, 4) * 28);
          const y = 7 + Math.floor(hash(i, 2, 4) * 5);
          P.set(x + (i & 1 ? 1 : -1), y - 1, STRAW[5]);
        }
      }
      // oj a kola
      if (broken) {
        rail(P, 41, 24, 50, 29, 2, WX, 5);
        // jedno kolo ulomené, leží vedle
        P.ring(12, 26, 5, 5, C.w[2], 1.6);
        P.disc(12, 26, 1.4, 1.4, C.w[1]);
        P.ring(36, 28, 5.5, 2.2, C.w[3], 1.4);
        for (let x = 6; x < 18; x++) if (P.get(x, 22) >= 0) P.set(x, 23 + ((x - 6) >> 2), C.w[1]);
      } else {
        rail(P, 42, 19, 51, 22, 2, WX, 5);
        for (const cx of [13, 34]) {
          P.ring(cx, 25, 5.5, 5.5, C.w[3], 1.6);
          for (let a = 0; a < 4; a++) {
            const an = a * Math.PI / 4;
            P.line(Math.round(cx - Math.cos(an) * 4), Math.round(25 - Math.sin(an) * 4), Math.round(cx + Math.cos(an) * 4), Math.round(25 + Math.sin(an) * 4), C.w[2]);
          }
          P.disc(cx, 25, 1.5, 1.5, C.s[3]);
          P.set(cx - 4, 21, C.w[4]);
        }
      }
      tuft(P, 6, 31, 2, 8);
      tuft(P, 44, 30, 2, 9);
    });
  }
  cart("cartHay", true, false);
  cart("cartBroken", false, true);

  // kupka sena
  sprite("haystack", 16, 15, 8, 14, P => {
    contact(P, 16, 28, 14, 2.4);
    P.poly([[3, 28], [5, 18], [9, 10], [14, 6], [18, 6], [24, 10], [28, 18], [30, 28]], (x, y) => {
      const nx = (x - 16) / 14;
      let v = 4.4 - nx * 2.2 - (y - 6) / 22 * 0.8;
      // vrstvy sena po šikmých řádcích
      if ((y + Math.round(x * 0.3)) % 4 === 0) v -= 0.9;
      if (hash(x, y, 7) > 0.88) v += 0.8;
      return pick(STRAW, v);
    });
    // stébla po obrysu a provázek
    for (let i = 0; i < 20; i++) {
      const y = 8 + Math.floor(hash(i, 1, 3) * 20);
      const left = hash(i, 2, 3) > 0.5;
      const x = left ? 3 + Math.round((28 - y) * 0.2) - 1 : 30 - Math.round((28 - y) * 0.2) + 1;
      P.set(x, y, left ? STRAW[5] : STRAW[2]);
    }
    for (let x = 6; x < 27; x++) P.set(x, 19 + Math.round(Math.sin((x - 6) / 21 * Math.PI) * 1.2), C.w[1]);
    P.rect(15, 3, 2, 4, WX[3]);
  });

  // sudy
  sprite("barrels", 16, 13, 8, 12, P => {
    contact(P, 16, 25, 14, 2.4);
    const barrel = (cx, by, rx, h, lying) => {
      if (lying) {
        P.disc(cx, by - rx, h / 2, rx, (x, y) => {
          const ny = (y + 0.5 - (by - rx)) / rx;
          let v = 3.6 - ny * 2;
          if (Math.abs(x + 0.5 - cx) > h / 2 - 2) v -= 0.6;
          if (Math.abs(Math.abs(x + 0.5 - cx) - h / 4) < 0.8) return C.s[ny < -0.2 ? 4 : 2];
          return pick(WX, v);
        });
        P.disc(cx - h / 2 + 1.5, by - rx, 2.2, rx - 0.5, (x, y) => ((x + y) & 3 ? C.d[3] : C.d[2]));
        return;
      }
      for (let y = by - h; y < by; y++) {
        const t = (y - (by - h)) / h;
        const bulge = rx * (0.86 + 0.14 * Math.sin(t * Math.PI));
        for (let x = Math.round(cx - bulge); x < Math.round(cx + bulge); x++) {
          const u = (x + 0.5 - cx) / bulge;
          let v = 3.6 - u * 2.2;
          if (((x - Math.round(cx - bulge)) % 3) === 2) v -= 0.6;
          let c = pick(WX, v);
          if (Math.abs(t - 0.18) < 0.06 || Math.abs(t - 0.82) < 0.06) c = pick(IRON, 3.6 - u * 2);
          P.set(x, y, c);
        }
      }
      P.disc(cx, by - h, rx * 0.86, 1.6, (x, y) => (y < by - h ? C.w[4] : C.d[3]));
    };
    barrel(16, 19, 4.5, 11, false);
    barrel(9, 24, 5.5, 14, false);
    barrel(22, 25, 5, 13, false);
  });

  // pytle s obilím
  sprite("sacks", 14, 9, 7, 8, P => {
    contact(P, 14, 17, 12, 2);
    const sack = (cx, by, rx, ry) => {
      P.disc(cx, by - ry, rx, ry, (x, y) => {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - (by - ry)) / ry;
        let v = 3.2 - nx * 1.5 - ny * 1.2;
        if (hash(x, y, 3) > 0.9) v -= 0.6;
        return pick(CLOTH, v);
      });
      // zavázané hrdlo
      P.set(Math.round(cx), Math.round(by - ry * 2), CLOTH[3]);
      P.set(Math.round(cx) + 1, Math.round(by - ry * 2), CLOTH[2]);
      P.set(Math.round(cx), Math.round(by - ry * 2) + 1, C.w[1]);
    };
    sack(8, 17, 6, 6);
    sack(19, 17, 5.5, 5.5);
    sack(13, 12, 5, 4.6);
    // vysypané zrno
    for (let i = 0; i < 6; i++) P.set(20 + i, 17 - (i & 1), C.d[4]);
  });

  // včelí úly (pletené košnice) na lavici
  sprite("beehives", 16, 12, 8, 11, P => {
    contact(P, 16, 23, 14, 2);
    rail(P, 2, 17, 30, 17, 2, WX, 5);
    post(P, 4, 19, 23, 2, WX, { seed: 1 });
    post(P, 26, 19, 23, 2, WX, { seed: 2 });
    for (const cx of [9, 22]) {
      P.disc(cx, 17, 6, 10, (x, y) => {
        if (y > 16) return null;
        const nx = (x + 0.5 - cx) / 6;
        let v = 4.2 - nx * 2 - (17 - y) * 0.03;
        if (y % 2 === 0) v -= 0.8; // pletené prstence
        return pick(STRAW, v);
      });
      P.rect(cx - 1, 14, 2, 2, C.ink);
    }
  }, { bees: true });

  // dřevěný ukazatel s kamenným milníkem a lucernou k poutníkům
  sprite("wayshrine", 12, 22, 6, 21, P => {
    contact(P, 12, 42, 9, 2);
    blocks(P, 5, 30, 14, 12, { ramp: SX, seed: 2, rowH: 4, minW: 4, maxW: 7 });
    // výklenek se svíčkou
    P.rect(8, 16, 8, 14, SX[2]);
    blocks(P, 6, 12, 12, 4, { ramp: SX, seed: 5, rowH: 4, minW: 4, maxW: 6 });
    for (let y = 18; y < 28; y++) for (let x = 10; x < 14; x++) P.set(x, y, y === 18 ? SX[1] : C.shade);
    P.rect(11, 25, 2, 3, C.bone[0]);
    P.set(11, 24, C.a[4]);
    P.set(12, 24, C.a[3]);
    P.set(11, 23, C.a[3]);
    // stříška
    P.poly([[4, 12], [12, 6], [20, 12]], (x, y) => (y === Math.round(12 - Math.min(x - 4, 20 - x) * 0.75) ? C.r[3] : x < 12 ? C.r[2] : C.r[1]));
    P.rect(11, 3, 2, 4, WX[3]);
    P.rect(10, 4, 4, 1, WX[3]);
    tuft(P, 4, 42, 2, 3);
    tuft(P, 18, 42, 2, 4);
  }, { glow: { x: 6, y: 12, r: 6, a: 0.35, color: C.a[2], flicker: true } });

  // větrný mlýn: tělo zvlášť, lopatky jako 8 snímků otáčení
  const MILL = { w: 34, h: 50 };
  sprite("windmill", MILL.w, MILL.h, 17, 49, P => {
    contact(P, 34, 98, 24, 3);
    // kamenný sokl
    blocks(P, 14, 82, 40, 16, { ramp: SX, seed: 11, rowH: 4, minW: 6, maxW: 10, light: x => -(x - 14) / 40 * 1.4 });
    // dřevěná věž zužující se nahoru
    K.planks(P, 16, 34, 36, 48, {
      ramp: WX, size: 3, dir: "v", seed: 7,
      mask: (x, y) => Math.abs(x + 0.5 - 34) <= 11 + (y - 34) * 0.15,
      light: x => -(x - 20) / 30 * 1.2
    });
    // dveře a okénko
    for (let y = 70; y < 82; y++) for (let x = 30; x < 38; x++) P.set(x, y, y === 70 || x === 30 ? C.w[1] : x === 37 ? C.w[2] : C.w[0]);
    P.rect(33, 48, 4, 5, C.a[2]);
    P.rect(33, 48, 4, 1, C.a[4]);
    P.rect(34, 48, 1, 5, C.w[1]);
    // šindelová stříška
    P.poly([[19, 36], [34, 18], [49, 36]], (x, y) => {
      const rel = (x - 19) / 30;
      let v = 3.6 - rel * 2.4;
      if (y % 3 === 0) v -= 0.8;
      return pick(K.SX.map((c, i) => mix(c, C.t[Math.min(4, i >> 1)], 0.45)), v + 1.5);
    });
    for (let x = 19; x <= 49; x++) P.set(x, 36, C.s[1]);
    // osa lopatek
    P.disc(34, 30, 2.6, 2.6, (x, y) => (x + y < 63 ? C.s[5] : C.s[2]));
  }, { mill: [17, 15] });
  // lopatky: kříž se čtyřmi plátěnými křídly, 8 natočení
  (() => {
    const frames = [];
    const R = 30;
    for (let f = 0; f < 8; f++) {
      const P = new Pix(R * 2 + 4, R * 2 + 4);
      const c = R + 2;
      for (let k = 0; k < 4; k++) {
        const a = f / 8 * Math.PI / 2 + k * Math.PI / 2;
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        // plachta po jedné straně ramene
        for (let s = 5; s <= R; s += 0.5) {
          for (let w = 1; w <= 7; w++) {
            const x = Math.round(c + ux * s - uy * w);
            const y = Math.round(c + uy * s + ux * w);
            const lattice = Math.round(s) % 5 === 0 || w === 7;
            const lit = uy * -1 + ux * -0.5 > 0;
            P.set(x, y, lattice ? C.w[2] : lit ? mix(C.bone[0], C.white, 0.3) : C.bone[1]);
          }
        }
        for (let s = 0; s <= R; s += 0.5) {
          P.set(Math.round(c + ux * s), Math.round(c + uy * s), C.w[3]);
          P.set(Math.round(c + ux * s + 0.6), Math.round(c + uy * s + 0.6), C.w[1]);
        }
      }
      P.disc(c, c, 2.4, 2.4, (x, y) => (x + y < c * 2 ? C.s[5] : C.s[2]));
      P.outline(C.ink, 0.7);
      frames.push(PK.fine(P));
    }
    D.windmill.blades = frames;
    D.windmill.bladeR = (R + 2) / HD;
  })();

  /* ======================= hroby, kosti, bojiště ======================= */

  sprite("graveCross", 10, 14, 5, 13, P => {
    // hrob: hlína s trávou a dřevěný kříž
    P.disc(10, 24, 8, 3, (x, y) => pick([C.d[0], C.d[1], C.d[2], C.d[3]], 2.4 - (y - 24) * 0.6 - (x - 10) * 0.08 + (hash(x, y, 2) > 0.8 ? 0.8 : 0)));
    post(P, 9, 4, 22, 2, WX, { seed: 5 });
    rail(P, 5, 8, 15, 8, 2, WX, 7);
    // věnec
    P.ring(10, 16, 2.6, 2.6, G[3], 1);
    P.set(8, 15, C.cap[1]);
    P.set(12, 17, C.a[3]);
    tuft(P, 3, 25, 2, 6);
  });

  sprite("graveStone", 10, 13, 5, 12, P => {
    P.disc(10, 22, 8, 3, (x, y) => pick([C.d[0], C.d[1], C.d[2], C.d[3]], 2.2 - (y - 22) * 0.6 + (hash(x, y, 4) > 0.82 ? 0.8 : 0)));
    P.poly([[4, 21], [4, 8], [6, 4], [10, 2], [14, 4], [16, 8], [16, 21]], (x, y) => {
      let v = 4.8 - (x - 4) / 12 * 2.8;
      if (hash(x, y, 9) > 0.93) v -= 1;
      return pick(MOSSY, v);
    });
    // vytesaný kříž a mech u paty
    P.rect(9, 8, 2, 8, MOSSY[2]);
    P.rect(7, 10, 6, 2, MOSSY[2]);
    for (let x = 4; x < 16; x++) if (hash(x, 1, 3) > 0.35) P.set(x, 20 - (hash(x, 2, 3) > 0.6 ? 1 : 0), G[4]);
    tuft(P, 16, 23, 2, 8);
  });

  // kosti a lebka v trávě (plochá)
  sprite("bones", 14, 6, 7, 5, P => {
    const L = (x0, y0, x1, y1) => {
      limb(P, x0, y0, x1, y1, 1.6, 1.6, BONE, { grain: false, base: 4 });
      for (const [x, y] of [[x0, y0], [x1, y1]]) { P.set(Math.round(x), Math.round(y) - 1, BONE[5]); P.set(Math.round(x), Math.round(y) + 1, BONE[3]); }
    };
    L(3, 9, 11, 7);
    L(14, 10, 22, 11);
    L(9, 4, 13, 9);
    // lebka
    P.disc(20, 5, 3.2, 2.8, (x, y) => pick(BONE, 5 - (x - 18) * 0.4 - (y - 4) * 0.4));
    P.set(19, 5, C.ink);
    P.set(21, 5, C.ink);
    P.set(20, 7, BONE[2]);
    P.rect(19, 8, 3, 1, BONE[3]);
    tuft(P, 25, 11, 1, 3);
  }, { flat: true }, 0.6);

  // jelení lebka s parožím
  sprite("antlers", 14, 8, 7, 7, P => {
    P.disc(14, 11, 3, 2.4, (x, y) => pick(BONE, 5 - (x - 12) * 0.4 - (y - 10) * 0.5));
    P.rect(13, 13, 3, 2, BONE[3]);
    P.set(13, 11, C.ink);
    P.set(15, 11, C.ink);
    for (const s of [-1, 1]) {
      const pts = [[14 + s * 2, 9], [14 + s * 6, 6], [14 + s * 9, 2], [14 + s * 11, 1]];
      for (let i = 0; i < pts.length - 1; i++) limb(P, ...pts[i], ...pts[i + 1], 1.5, 1.2, BONE, { grain: false, base: 4.4 });
      limb(P, 14 + s * 6, 6, 14 + s * 6, 1, 1.2, 1, BONE, { grain: false, base: 5 });
      limb(P, 14 + s * 9, 3, 14 + s * 12, 5, 1.2, 1, BONE, { grain: false, base: 4 });
    }
    tuft(P, 6, 15, 2, 5);
  }, { flat: true }, 0.6);

  // meč zabodnutý v zemi s helmou na jílci
  sprite("swordGrave", 10, 18, 5, 17, P => {
    P.disc(10, 33, 7, 2.6, (x, y) => pick([C.d[0], C.d[1], C.d[2], C.d[3]], 2.4 - (y - 33) * 0.5 + (hash(x, y, 1) > 0.8 ? 0.7 : 0)));
    // čepel
    for (let y = 12; y < 33; y++) {
      P.set(9, y, C.s[6]);
      P.set(10, y, C.s[4]);
      P.set(11, y, C.s[2]);
    }
    P.set(10, 18, C.s[5]);
    // záštita a jílec
    P.rect(5, 11, 11, 2, C.a[1]);
    P.rect(5, 11, 11, 1, C.a[2]);
    P.rect(9, 5, 3, 6, WX[2]);
    P.set(9, 5, WX[4]);
    P.disc(10.5, 4, 1.8, 1.8, C.a[2]);
    // helma zavěšená přes záštitu
    P.disc(10, 16, 4.2, 3.6, (x, y) => (y > 17 ? null : pick(IRON, 4.4 - (x - 8) * 0.5 - (y - 13) * 0.3)));
    P.rect(7, 17, 7, 1, IRON[1]);
    P.rect(9, 15, 1, 2, C.ink);
    // šála v barvě strážců, cípy vlají
    P.rect(6, 19, 8, 1, C.u[2]);
    P.set(13, 20, C.u[2]); P.set(13, 21, C.u[1]); P.set(14, 22, C.u[1]);
    tuft(P, 4, 33, 2, 2);
    tuft(P, 15, 33, 2, 3);
  });

  // cvičný panák (sláma na kříži) a terč
  sprite("dummy", 12, 20, 6, 19, P => {
    contact(P, 12, 38, 8, 1.8);
    post(P, 11, 8, 38, 2, WX, { seed: 2 });
    rail(P, 3, 15, 21, 15, 2, WX, 3);
    P.disc(12, 22, 5, 7, (x, y) => pick(STRAW, 4.2 - (x - 9) * 0.35 - (y - 17) * 0.06 + ((y & 3) === 0 ? -0.8 : 0)));
    P.disc(12, 8, 3.6, 3.6, (x, y) => pick(CLOTH, 4 - (x - 10) * 0.4 - (y - 6) * 0.3));
    // provazy a šíp v panákovi
    P.rect(7, 20, 10, 1, C.w[1]);
    P.rect(7, 25, 10, 1, C.w[1]);
    P.line(16, 22, 22, 19, C.w[3]);
    P.set(22, 19, C.white); P.set(22, 18, C.white); P.set(21, 18, C.bone[1]);
    tuft(P, 6, 38, 2, 6);
  });

  sprite("archeryTarget", 12, 16, 6, 15, P => {
    contact(P, 12, 30, 10, 1.8);
    limb(P, 6, 30, 10, 10, 2, 2, WX, { grain: false, base: 3 });
    limb(P, 18, 30, 14, 10, 2, 2, WX, { grain: false, base: 2.4 });
    P.disc(12, 14, 9, 9, (x, y) => {
      const d = Math.hypot(x + 0.5 - 12, y + 0.5 - 14);
      const ring = Math.floor(d / 2.1);
      const lit = (x - 12) + (y - 14) < 0;
      const cols = [[C.a[3], C.a[2]], [C.r[3], C.r[2]], [C.bone[0], C.bone[1]], [C.u[3], C.u[2]], [STRAW[4], STRAW[3]]];
      const cc = cols[Math.min(4, ring)];
      return lit ? cc[0] : cc[1];
    });
    // dva šípy
    for (const [x, y] of [[13, 12], [9, 16]]) {
      P.line(x, y, x + 5, y - 3, C.w[3]);
      P.set(x + 5, y - 3, C.white);
      P.set(x + 6, y - 3, C.bone[1]);
    }
    tuft(P, 4, 31, 2, 3);
  });

  // stan z plátna (tábor na kraji mapy)
  sprite("tent", 22, 16, 11, 15, P => {
    contact(P, 22, 31, 20, 2.6);
    P.poly([[4, 31], [22, 4], [40, 31]], (x, y) => {
      const rel = (x - 4) / 36;
      let v = 4.2 - rel * 2.8;
      if (Math.abs(x - 22) < 1) v = 1;
      if ((x - 4) % 7 === 0 && x < 22) v -= 0.5;
      return pick(CLOTH, v);
    });
    // vchod
    P.poly([[19, 31], [22, 16], [25, 31]], (x, y) => (x < 22 ? C.shade : C.ink));
    P.poly([[22, 16], [25, 31], [27, 31]], CLOTH[3]);
    // kolíky a lana
    P.line(4, 31, 1, 31, C.w[2]);
    P.line(40, 31, 43, 31, C.w[2]);
    P.rect(21, 1, 2, 4, WX[3]);
    P.set(23, 1, C.u[3]); P.set(24, 1, C.u[2]); P.set(23, 2, C.u[2]);
  });

  /* Kulisy, které se nezasněží (světlo) nebo stojí na vodě. */
  for (const n of ["lilyPads", "wayshrine"]) if (D[n]) D[n].noSnow = true;

  /* ======================= rozmístění ======================= */
  /*
   * Volá world.js po všech kulisách z mapy. ctx = { add, layout, W, H, zone, Z, ashMap, mirror }.
   * add(name, x, y, force, r) hlídá kolize s budovami, surovinami a jinými kulisami.
   * Vlastní rng podle rozměrů mapy: rozmístění je na všech klientech stejné.
   */
  const DECOR = {};

  DECOR.doodads = ctx => {
    const { add, layout, W, H, zone, Z, ashMap } = ctx;
    const placed = ctx.list || [];
    const R = rng(W * 977 + H * 31 + layout.resources.length * 7 + 5);
    const area = W * H / (480 * 240);
    const n = k => Math.max(1, Math.round(k * area));
    const at = (x, y) => zone[Math.round(y) * W + Math.round(x)];
    const ash = (x, y) => ashMap && ashMap[Math.round(y) * W + Math.round(x)] === 1;
    const grassy = (x, y) => x > 10 && y > 26 && x < W - 10 && y < H - 8 && at(x, y) === Z.GRASS && !ash(x, y);
    // nezakrývat budovy a stromy zezadu (sprite by vykoukl skrz korunu)
    const hidden = (x, y) => layout.resources.some(r => r.type === "wood" && Math.abs(x - r.x / 2) < 20 && y - (r.y / 2 + 15) > -46 && y - (r.y / 2 + 15) < 4) ||
      layout.buildings.some(b => Math.abs(x - b.x / 2) < 40 && y - (b.y / 2 + 19) > -60 && y - (b.y / 2 + 19) < 6) ||
      // ani za horou, hradbou nebo jinou vysokou kulisou (štíty hor sahají daleko nad svou patu)
      placed.some(d => d.spr.h > 24 && Math.abs(x - d.x) < d.spr.w * 0.6 + 6 && d.y > y - 4 && d.y - y < d.spr.h + 6);
    const put = (name, x, y, r = 7) => grassy(x, y) && !hidden(x, y) && add(name, x, y, false, r);

    // drobná zeleň po celé mapě
    const spread = (names, count, r, ok = grassy) => {
      for (let i = 0, k = 0; i < count * 30 && k < count; i++) {
        const x = 12 + R() * (W - 24);
        const y = 28 + R() * (H - 38);
        if (!ok(x, y) || hidden(x, y)) continue;
        if (add(names[Math.floor(R() * names.length)], x, y, false, r)) k++;
      }
    };
    spread(["bushA", "bushA", "bushB", "bushFlower", "hedge"], n(9), 9);
    spread(["bushDry"], n(2), 8);
    // v zimě květiny nekvetou (sníh by je stejně zakryl)
    const winter = !!(PK.winter && PK.winter.on);
    if (!winter) spread(["flowersYellow", "flowersBlue", "flowersRed", "flowersWhite", "lavender"], n(14), 6);
    spread(["tallGrass"], n(10), 5);
    spread(["saplingBirch", "saplingPine", "saplingOak"], n(4), 8);
    spread(["pebbles", "rockPile", "rockSlab"], n(5), 7);
    spread(["shroomBrown", "fairyRing"], n(3), 8);
    spread(["logFallen", "stumpAxe", "boulderMoss"], n(3), 10);

    // na popelu (území nemrtvých) kosti a holé keře
    spread(["bones", "antlers", "bushDry", "cairn"], n(4), 7, (x, y) => x > 10 && y > 26 && x < W - 10 && y < H - 8 && ash(x, y) && at(x, y) === Z.GRASS);

    // rákosí a lekníny u vody: tráva, pod kterou (do 6 px) je břeh nebo voda
    const nearWater = (x, y) => {
      for (const [dx, dy] of [[0, 4], [0, 7], [4, 3], [-4, 3], [6, 0], [-6, 0]]) {
        const z = at(x + dx, y + dy);
        if (z === Z.BANK || z === Z.WATER || z === Z.SHALLOW) return true;
      }
      return false;
    };
    spread(["reedsA", "reedsB"], n(4), 6, (x, y) => grassy(x, y) && nearWater(x, y));
    // rákosí přímo na břehu: najdi břeh, vystup k trávě a postav trs na rozhraní (paty ve vlhké hlíně)
    const clear = (x, y, r) => !layout.buildings.some(b => Math.hypot(x * 2 - b.x, (y * 2 - b.y - 20) * 1.1) < 80) &&
      !layout.resources.some(rs => Math.hypot(x * 2 - rs.x, y * 2 - (rs.y + 26)) < 40 + r);
    const reedSpots = [];
    const banks = [];
    for (let y = 30; y < H - 10; y += 2) for (let x = 12; x < W - 12; x += 3) if (zone[y * W + x] === Z.BANK) banks.push([x, y]);
    for (let i = 0, k = 0; i < banks.length && i < 4000 && k < n(14); i++) {
      const [x, y] = banks[Math.floor(R() * banks.length)];
      // severní břeh: tráva nad břehem (pata na rozhraní), jižní břeh: tráva pod ním
      let gy = -1;
      let gz = 0;
      for (let d = 1; d <= 6 && gy < 0; d++) {
        if (at(x, y - d) === Z.GRASS) { gy = y - d + 1; gz = -1; }
        else if (at(x, y + d) === Z.GRASS) { gy = y + d + 1; gz = 1; }
      }
      if (gy < 0 || at(x - 2, gy + gz) !== Z.GRASS || at(x + 2, gy + gz) !== Z.GRASS || hidden(x, gy) || !clear(x, gy, 6)) continue;
      if (reedSpots.some(([px, py]) => Math.hypot(px - x, (py - gy) * 1.4) < 11)) continue;
      reedSpots.push([x, gy]);
      add(R() < 0.5 ? "reedsA" : "reedsB", x, gy + 1, true, 6);
      k++;
    }
    if (Z.WATER != null && !winter) {
      // lekníny přímo na klidné vodě (zóna vody všude kolem)
      for (let i = 0, k = 0; i < n(6) * 60 && k < n(6); i++) {
        const x = 12 + R() * (W - 24);
        const y = 28 + R() * (H - 38);
        let ok = true;
        for (const [dx, dy] of [[0, 0], [-6, 0], [6, 0], [0, -4], [0, 4], [-8, 3], [8, -3]]) if (at(x + dx, y + dy) !== Z.WATER) { ok = false; break; }
        if (ok && add("lilyPads", x, y, true, 8)) k++;
      }
    }

    // zátiší: skupinka kulis kolem bodu (první musí projít, ostatní zkusí)
    const vignette = (x, y, items) => {
      if (!grassy(x, y) || hidden(x, y)) return false;
      if (!add(items[0][0], x, y, false, items[0][3] || 9)) return false;
      // ostatní kusy zátiší stojí těsně u sebe (malý poloměr), hlídají se jen budovy a suroviny
      for (const [name, dx, dy] of items.slice(1)) put(name, x + dx, y + dy, 3);
      return true;
    };
    const tryAt = (count, fn, near) => {
      for (let i = 0, k = 0; i < count * 220 && k < count; i++) {
        const p = near ? near() : [16 + R() * (W - 32), 34 + R() * (H - 48)];
        if (p && fn(p[0], p[1])) k++;
      }
    };

    // statek u každé hlavní budovy: studna, plot, seno, sudy, vůz (kus od budovy)
    for (const b of layout.buildings) {
      if (b.type !== "hall" && b.type !== "citadel") continue;
      const hell = b.type === "citadel";
      const items = hell
        ? [["graveStone", 0, 0, 7], ["graveCross", 10, 3], ["graveCross", -9, 4], ["bones", 4, 9, 6], ["cairn", 18, -2]]
        : [["well", 0, 0, 10], ["fenceA", 18, 6, 9], ["fenceA", 40, 6, 9], ["haystack", 26, -6, 8], ["barrels", -15, 4, 7], ["sacks", -12, 12, 6], ["cartHay", 14, 18, 11]];
      let ok = false;
      for (let i = 0; i < 40 && !ok; i++) {
        const a = R() * Math.PI * 2;
        const d = 56 + R() * 26;
        ok = vignette(b.x / 2 + Math.cos(a) * d, b.y / 2 + 16 + Math.sin(a) * d * 0.7, items);
      }
    }

    // jeden mlýn na mapu (větší mapy dva) na volné louce
    tryAt(area > 1.6 ? 2 : 1, (x, y) => vignette(x, y, [["windmill", 0, 0, 13], ["haystack", 22, 4, 8], ["sacks", -18, 4, 6], ["fenceB", 30, 12, 9], ["beehives", -26, -2, 8]]));
    // zříceniny
    tryAt(n(1.4), (x, y) => vignette(x, y, [["ruinWall", 0, 0, 12], ["ruinStub", 30, 6, 10], ["ruinArch", -34, -4, 14], ["rockPile", 14, 14, 7], ["statueBroken", -14, 16, 8], ["bushA", 40, -4, 7]]));
    // hřbitůvek
    tryAt(n(0.8), (x, y) => vignette(x, y, [["graveStone", 0, 0, 7], ["graveCross", 12, 2, 6], ["graveStone", 24, -1, 6], ["graveCross", 6, 12, 6], ["graveStone", 19, 12, 6], ["fenceB", -18, 6, 9], ["wayshrine", 36, 6, 7]]));
    // staré bojiště
    tryAt(n(0.8), (x, y) => vignette(x, y, [["swordGrave", 0, 0, 6], ["bones", 12, 4, 6], ["cartBroken", -22, 6, 12], ["swordGrave", 20, -6, 6], ["antlers", -8, 14, 6]]));
    // tábořiště a cvičiště
    tryAt(n(0.6), (x, y) => vignette(x, y, [["tent", 0, 0, 12], ["tent", 30, 4, 12], ["woodpile", -22, 6, 8], ["dummy", 18, 18, 7], ["archeryTarget", 40, 18, 7]]));
    // poutní kaplička u cesty
    tryAt(n(1), (x, y) => {
      for (const [dx, dy] of [[0, 8], [8, 6], [-8, 6], [0, 12]]) if (at(x + dx, y + dy) === Z.PATH) return vignette(x, y, [["wayshrine", 0, 0, 7], ["flowersWhite", 8, 3, 5], ["flowersRed", -8, 2, 5]]);
      return false;
    });
  };

  PK.decor = DECOR;
})();
