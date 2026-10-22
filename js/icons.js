/*
 * Icons: command glyphs, small HUD pictograms, pixel cursors and the Ring
 * emblem. Rozměry plátna zůstávají v art px (tlačítko 16x16, piktogramy
 * 8x8 apod.), ale kreslí se v jemné mřížce (PK.HD) a vrací přes PK.fine,
 * takže v HUD i ve světě mají stejně velký pixel jako nové sprity.
 * Světlo zleva shora, stíny dolů doprava do fialova, 1 jemný px obrys.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const { C, TEAM, Pix, mix, hash, bayer, HD } = PK;

  const S = C.s;
  const T = TEAM.blue;
  const WARM = C.a[4];
  const EYE = mix(C.ink, C.w[0], 0.35);
  const RING5 = [".XX..", "X...X", "X...X", "X...X", ".XXX."];

  function glyph(P, x, y, c, rows = RING5) {
    rows.forEach((row, r) => {
      for (let i = 0; i < row.length; i++) if (row[i] === "X") P.set(x + i, y + r, c);
    });
  }

  /* ---------- stínování (jemná mřížka) ---------- */
  const clamp01 = v => (v < 0 ? 0 : v > 0.999 ? 0.999 : v);
  const pick = (ramp, t) => ramp[Math.floor(clamp01(t) * ramp.length)];

  /* Tón koule/válce pod světlem zleva shora: 0 = stín, 1 = odlesk. */
  function tone(x, y, cx, cy, rx, ry) {
    const nx = (x + 0.5 - cx) / rx;
    const ny = (y + 0.5 - cy) / ry;
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    return (-(nx * 0.55 + ny * 0.7) + nz * 0.55 + 0.55) / 1.55;
  }

  const sph = (ramp, cx, cy, rx, ry, bias = 0) => (x, y) => pick(ramp, tone(x, y, cx, cy, rx, ry) + bias);

  /* Lineární přechod podél osy (x0,y0) -> (x1,y1), t = 0 u začátku. */
  function lin(ramp, x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const L = dx * dx + dy * dy;
    return (x, y) => pick(ramp, ((x + 0.5 - x0) * dx + (y + 0.5 - y0) * dy) / L);
  }

  /* Díl kreslený do vlastní vrstvy: horní/levá hrana dostane 1 px světla,
   * dolní/pravá 1 px stínu, pak se vrstva otiskne do P. */
  function part(P, draw, hi = 0.32, lo = 0.36) {
    const L = new Pix(P.w, P.h);
    draw(L);
    const o = L.clone();

    for (let y = 0; y < L.h; y++) {
      for (let x = 0; x < L.w; x++) {
        const c = L.get(x, y);
        if (c < 0) continue;
        const up = L.get(x, y - 1) < 0;
        const lf = L.get(x - 1, y) < 0;
        const dn = L.get(x, y + 1) < 0;
        const rt = L.get(x + 1, y) < 0;
        if ((up || lf) && hi) o.set(x, y, mix(c, WARM, hi));
        else if ((dn || rt) && lo) o.set(x, y, mix(c, C.dusk, lo));
      }
    }

    P.stamp(o, 0, 0);
    return L;
  }

  /* Prolomený kruh (Ring) v jemné mřížce: mezera vpravo nahoře. */
  function ringMark(P, cx, cy, r, c, th = 1) {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const d = Math.hypot(dx, dy);
        if (d > r || d <= r - th) continue;
        const a = Math.atan2(dy, dx);
        if (a > -1.2 && a < -0.15) continue;
        P.set(x, y, c);
      }
    }
  }

  /* Kamenné zdivo: kvádry s 1 px spárou a světlou hranou nahoře vlevo. */
  function stones(P, x0, y0, x1, y1, ramp = [S[1], S[2], S[3], S[4]], bw = 5, bh = 3, seed = 1) {
    for (let y = y0; y < y1; y++) {
      const row = Math.floor((y - y0) / bh);
      const ry = (y - y0) % bh;
      const off = (row & 1) * Math.floor(bw / 2) + Math.floor(hash(row, seed, 7) * 2);
      for (let x = x0; x < x1; x++) {
        const col = Math.floor((x - x0 + off) / bw);
        const rx = (x - x0 + off) % bw;
        const v = hash(col, row, seed);
        if (ry === bh - 1 || rx === bw - 1) P.set(x, y, ramp[0]);
        else if (ry === 0 || rx === 0) P.set(x, y, v > 0.5 ? ramp[3] : mix(ramp[2], ramp[3], 0.5));
        else P.set(x, y, v < 0.25 ? mix(ramp[1], ramp[2], 0.5) : ramp[2]);
      }
    }
  }

  /* Taškové nebo šindelové řady: tmavá spodní hrana, světlá horní. */
  function tiles(P, pts, ramp, tw = 4, th = 3, seed = 3) {
    P.poly(pts, (x, y) => {
      const row = Math.floor(y / th);
      const ry = y % th;
      const rx = (x + (row & 1) * 2) % tw;
      const v = hash(Math.floor((x + (row & 1) * 2) / tw), row, seed);
      if (ry === th - 1) return ramp[0];
      if (rx === tw - 1) return ramp[1];
      if (ry === 0) return v > 0.4 ? ramp[3] : ramp[2];
      return v < 0.2 ? ramp[1] : ramp[2];
    });
  }

  /* Rozsvícené okénko s příčkou. */
  function window2(P, x, y, w, h) {
    P.rect(x - 1, y - 1, w + 2, h + 2, C.w[1]);
    P.rect(x, y, w, h, C.a[2]);
    P.rect(x, y, w, 1, C.a[3]);
    if (w > 2) P.rect(x + (w >> 1), y, 1, h, C.w[2]);
    P.set(x, y, C.a[4]);
  }

  /* Rozptýlená záře kolem světla (bayer na jemné mřížce, jen do prázdna). */
  function halo(P, cx, cy, r, c, k = 0.55) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (P.alpha(x, y)) continue;
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
        if (d < 1 && bayer(x, y) < (1 - d) * k) P.set(x, y, c);
      }
    }
  }

  const STEEL = [S[1], S[2], S[3], S[4], S[5]];
  const TEAMR = [T.d, T.s, T.m, T.l];
  const SKIN = [C.skin[2], C.skin[1], C.skin[0]];
  const WOOD = [C.w[1], C.w[2], C.w[3], C.w[4]];
  const GOLD = [C.gold[0], C.gold[1], C.gold[2]];
  const ROOF = [C.t[0], C.t[1], C.t[2], C.t[3]];

  /* ---------- velké ikony 16x16 art px = 32x32 jemných ---------- */
  const make = {};

  /* Dělník: slaměný klobouk s modrou páskou, šedé vousy, krumpáč. */
  make.worker = P => {
    // krumpáč za levým ramenem
    part(P, L => {
      L.line(3, 30, 6, 18, C.w[2]);
      L.line(4, 30, 7, 18, C.w[3]);
    });
    part(P, L => {
      L.poly([[1, 21.5], [2.5, 18.5], [6, 16.5], [10, 16.8], [6.5, 18.6], [3, 21]], (x, y) => (y < 18 ? S[5] : S[3]));
    }, 0.4);

    // ramena: hnědý kabát
    part(P, L => L.disc(15, 31, 12.5, 9.5, sph([C.w[0], C.w[1], C.w[2], C.w[3]], 12, 25, 13, 9)));
    P.line(15, 25, 15, 31, C.w[0]);
    // modrý šátek
    part(P, L => {
      L.poly([[9, 21], [22, 20], [24.5, 23], [11, 25]], lin(TEAMR.slice().reverse(), 9, 21, 12, 26));
      L.poly([[11, 24], [14, 24], [13.5, 30], [10.5, 29]], lin([T.m, T.s], 11, 24, 13, 30));
    }, 0.25);
    P.line(12, 22, 20, 21, T.l);

    // vlasy vzadu, obličej, vousy
    part(P, L => L.disc(13.5, 15, 3.8, 5, sph([S[2], S[3], S[4], S[5]], 13, 14, 4, 5)));
    part(P, L => L.disc(18.5, 15.5, 4.6, 5, sph(SKIN, 18, 14, 5, 5, 0.1)), 0.15, 0.2);
    part(P, L => L.poly([[14.5, 17], [22.5, 17.5], [21.5, 20.5], [18, 22.3], [14.5, 20]], sph([S[3], S[4], S[5]], 17, 18, 5, 4)), 0.2, 0.25);
    P.line(18, 18, 21, 18, S[2]);
    P.set(16, 15, C.skin[1]);
    P.set(16, 16, C.skin[2]);
    P.set(20, 14, EYE);
    P.set(20, 15, EYE);
    P.set(23, 16, C.skin[1]);
    P.set(22, 16, C.skin[0]);
    P.rect(15, 12, 8, 1, C.skin[2]);

    // klobouk: krempa a kužel
    const HAT = [C.d[1], C.d[2], C.d[3], C.d[4], C.d[5]];
    part(P, L => {
      L.poly([[8, 10.5], [23, 10.5], [18.5, 4.5], [13, 0.8], [11.5, 4]], (x, y) => {
        const t = 1 - (x - 8) / 16 + (hash(x, 0, 11) < 0.25 ? -0.15 : 0);
        return pick(HAT, 0.15 + t * 0.85);
      });
    }, 0.25, 0.3);
    P.poly([[8.5, 8], [21.5, 8], [23, 10.5], [8, 10.5]], (x, y) => (y < 9 ? T.l : x > 19 ? T.s : T.m));
    part(P, L => {
      L.disc(15.5, 11.6, 14, 2.6, (x, y) => {
        if (y >= 12) return (x + y) % 5 === 0 ? C.d[1] : C.d[2];
        return hash(x, y, 4) < 0.18 ? C.d[3] : x < 16 ? C.d[4] : C.d[3];
      });
    }, 0.3, 0.25);
  };

  /* Voják: přilba s modrým chocholem, kulatý štít s Ringem, meč. */
  make.soldier = P => {
    // meč vpravo
    part(P, L => {
      L.poly([[25, 21], [25, 6], [26.5, 2.5], [28, 6], [28, 21]], (x) => (x < 26 ? S[6] : x < 27 ? S[5] : S[3]));
    }, 0.2, 0.3);
    P.line(26, 6, 26, 19, S[3]);
    P.set(25, 5, C.white);

    // ramena a tunika
    part(P, L => L.disc(15.5, 31, 12.5, 8.5, sph(STEEL, 12, 25, 13, 9, -0.05)));
    P.poly([[13, 24], [21, 24], [22, 32], [12, 32]], (x, y) => (x < 15 ? T.l : x > 19 ? T.s : T.m));
    for (let x = 6; x < 26; x += 2) P.set(x, 26 + ((x >> 1) & 1), S[2]);

    // hlava: obličej v otvoru přilby
    part(P, L => L.disc(18.5, 14, 4.8, 5.4, sph(SKIN, 18, 12, 5, 5, 0.1)), 0.1, 0.2);
    P.set(21, 13, EYE);
    P.set(21, 14, EYE);
    P.set(23, 15, C.skin[1]);

    // přilba
    part(P, L => {
      L.disc(15, 11.5, 8.2, 8.2, (x, y) => {
        const fx = x + 0.5 - 15;
        const fy = y + 0.5 - 11.5;
        if (fx > 1.5 && fy > -1.5 && fy < 7) return -1;
        return pick(STEEL, tone(x, y, 14, 10, 8, 8));
      });
      L.rect(16, 10, 1, 9, S[4]);
      L.rect(20, 10, 1, 4, S[3]);
      L.rect(15, 18, 7, 2, S[2]);
    }, 0.3, 0.3);
    P.line(7, 15, 15, 15, S[1]);
    P.line(7, 14, 15, 14, S[4]);
    P.set(10, 7, C.white);
    P.set(11, 6, S[6]);

    // chochol
    part(P, L => {
      L.poly([[15, 4.5], [19, 1], [13, 0.6], [6, 1.5], [3, 5.5], [7, 3.8], [11, 4]], lin([T.l, T.m, T.s], 18, 1, 4, 5));
    }, 0.35, 0.3);
    P.line(7, 3, 15, 2, T.h);

    // štít
    part(P, L => {
      L.disc(9.5, 25, 8, 8, (x, y) => {
        const d = Math.hypot(x + 0.5 - 9.5, y + 0.5 - 25);
        if (d > 6.6) return pick(STEEL, tone(x, y, 9.5, 25, 8, 8));
        return pick(TEAMR, tone(x, y, 8.5, 23, 7, 7) + 0.15);
      });
    }, 0.3, 0.35);
    ringMark(P, 9.5, 25, 4.3, C.gold[1], 1.6);
    P.set(7, 22, C.gold[2]);
    P.set(6, 23, C.gold[2]);

    // jílec
    part(P, L => {
      L.rect(22, 21, 9, 2, C.gold[1]);
      L.rect(25, 23, 3, 4, C.w[2]);
      L.disc(26.5, 28, 1.6, 1.4, C.gold[1]);
    }, 0.35, 0.35);
  };

  /* Lučištník: fialová kápě s modrým perem, šátek, luk. */
  make.archer = P => {
    // toulec za ramenem
    part(P, L => {
      L.rect(4, 16, 4, 12, C.w[1]);
      L.rect(4, 16, 1, 12, C.w[2]);
    });
    for (const [x, y] of [[4, 13], [6, 12], [8, 14]]) {
      P.rect(x, y, 2, 3, x === 6 ? T.l : T.m);
      P.set(x, y + 3, C.bone[0]);
    }

    // plášť
    part(P, L => L.disc(15, 31.5, 13, 10, sph([C.m[0], mix(C.m[0], C.m[1], 0.5), C.m[1], C.m[2]], 12, 25, 13, 10)));
    P.line(16, 25, 15, 31, C.m[0]);
    part(P, L => {
      L.poly([[9, 21], [22, 20], [24, 23], [11, 24.5]], lin(TEAMR.slice().reverse(), 9, 21, 12, 25));
    }, 0.25);

    // kápě
    const HOOD = [C.m[0], mix(C.m[0], C.m[1], 0.5), C.m[1], mix(C.m[1], C.m[2], 0.5), C.m[2]];
    part(P, L => {
      L.poly([[2.5, 12], [7, 6], [12, 2.5], [18, 2.6], [23, 6], [25, 12], [24.5, 18], [22, 22], [12, 22], [8, 17]],
        sph(HOOD, 14, 9, 11, 11));
    }, 0.3, 0.3);
    // otvor kápě a obličej
    P.disc(19.8, 14, 4.6, 5.6, C.m[0]);
    part(P, L => L.disc(20.5, 14.5, 3.8, 4.8, (x, y) => (y < 12 ? C.skin[2] : pick(SKIN, tone(x, y, 20, 13, 4, 5) + 0.15))), 0, 0.2);
    P.set(22, 13, EYE);
    P.set(22, 14, EYE);
    P.set(21, 12, C.m[0]);
    P.set(24, 15, C.skin[1]);
    P.line(16, 9, 15, 19, C.m[3]);

    // modré pero na kápi
    part(P, L => {
      L.poly([[12, 4], [8, 0.8], [3, 0.7], [7, 2.6], [10.5, 5]], lin([T.l, T.m], 3, 1, 12, 4));
    }, 0.35, 0.3);
    P.line(4, 1, 11, 4, T.h);

    // luk vpravo
    for (let y = 2; y <= 30; y++) {
      const u = (y - 16) / 14.5;
      const bx = 24.5 + 5 * (1 - u * u);
      P.set(Math.round(bx), y, C.w[3]);
      P.set(Math.round(bx) + 1, y, C.w[1]);
      if (Math.abs(u) < 0.95) P.set(24, y, C.bone[1]);
    }
    for (const y of [2, 30]) P.set(25, y, C.bone[0]);
    P.rect(28, 15, 3, 4, C.w[0]);
    P.rect(28, 15, 3, 1, C.w[2]);
    part(P, L => L.disc(27.5, 18, 1.8, 1.8, C.skin[1]), 0.3, 0.2);
  };

  /* Hrdina: šedivý stařec s čelenkou, tyrkysové roucho, modrý plášť, lucerna. */
  make.hero = P => {
    // plášť
    part(P, L => L.disc(14, 31.5, 14, 10.5, sph(TEAMR, 10, 24, 14, 10)));
    // roucho se zlatým límcem
    part(P, L => L.disc(16, 31.5, 10.5, 8.5, sph(ROOF.concat([C.t[4]]), 13, 26, 11, 9)), 0.25, 0.3);
    part(P, L => L.poly([[9, 22], [23, 21], [24, 24], [19, 26], [16, 23.5], [11, 25]], lin([C.gold[2], C.gold[1], C.gold[0]], 9, 21, 15, 26)), 0.2, 0.3);
    ringMark(P, 15, 28.5, 2.6, C.gold[1], 1);

    // dlouhé vlasy
    const HAIR = [S[3], S[4], S[5], S[6]];
    part(P, L => L.poly([[8, 9], [12, 3.5], [18, 3], [19, 12], [15, 23], [9, 23], [7, 16]], sph(HAIR, 12, 8, 9, 12)), 0.25, 0.3);
    for (const x of [10, 13]) P.line(x, 12, x - 1, 21, S[3]);
    // obličej
    part(P, L => L.disc(19.5, 11.5, 4.3, 4.6, sph(SKIN, 19, 10, 4.5, 4.5, 0.1)), 0.1, 0.2);
    P.set(21, 10, EYE);
    P.set(21, 11, EYE);
    P.rect(20, 9, 3, 1, S[6]);
    P.set(24, 12, C.skin[1]);
    // vousy
    part(P, L => L.poly([[16, 13.5], [24, 13], [23.5, 16.5], [21, 21.5], [18, 21], [16, 17]], sph([S[4], S[5], S[6]], 19, 15, 5, 5, 0.1)), 0.25, 0.25);
    P.line(20, 15, 23, 14, S[4]);
    P.line(19, 17, 19, 20, S[4]);
    // zlatá čelenka
    P.line(14, 7, 23, 6, C.gold[1]);
    P.line(14, 8, 23, 7, C.gold[0]);
    P.set(19, 6, C.a[4]);
    P.set(19, 7, C.a[2]);

    // hůl s lucernou
    part(P, L => L.rect(27, 10, 2, 22, C.w[2]), 0.3, 0.35);
    part(P, L => L.disc(26.5, 23, 2, 2, C.skin[1]), 0.3, 0.25);
    // lucerna
    part(P, L => {
      L.rect(25, 2, 6, 2, C.gold[0]);
      L.rect(26, 1, 4, 1, C.gold[1]);
      L.rect(25, 4, 6, 6, C.gold[0]);
      L.rect(25, 10, 6, 1, C.gold[0]);
    }, 0.35, 0.25);
    P.rect(26, 4, 4, 6, C.a[3]);
    P.rect(27, 5, 2, 4, C.a[4]);
    P.rect(28, 4, 1, 6, C.gold[1]);
  };


  /* Záře a jiskry se kreslí až po obrysu, aby nebyly obtažené. */
  const after = {
    hero: P => halo(P, 28, 6.5, 6.5, C.a[2], 0.5)
  };

  /* Gmina (radnice): tyrkysová valbová střecha, kamenný štít s Ringem, zlatá koule. */
  make.hall = P => {
    stones(P, 1, 25, 31, 31, [S[1], S[2], S[3], S[4]], 5, 3, 2);
    // hrázděné stěny
    P.rect(3, 18, 26, 7, C.d[4]);
    P.rect(3, 18, 26, 1, C.d[5]);
    for (const x of [3, 8, 23, 28]) P.rect(x, 18, 1, 7, C.w[1]);
    P.rect(3, 24, 26, 1, C.w[1]);
    window2(P, 5, 20, 2, 2);
    window2(P, 25, 20, 2, 2);
    // střecha
    tiles(P, [[0.5, 19], [31.5, 19], [26, 8], [6, 8]], ROOF, 4, 3, 5);
    P.rect(1, 18, 30, 1, C.w[2]);
    P.line(6, 8, 1, 18, C.t[4]);
    P.line(26, 8, 31, 18, C.t[0]);
    // vikýře
    for (const x of [7, 21]) {
      P.rect(x, 12, 4, 3, C.d[4]);
      window2(P, x + 1, 12, 2, 2);
      P.poly([[x - 1, 12], [x + 5, 12], [x + 2, 9.5]], (xx) => (xx < x + 2 ? C.t[3] : C.t[1]));
    }
    // kamenný štít uprostřed
    stones(P, 12, 7, 21, 26, [S[1], S[3], S[4], S[5]], 4, 3, 9);
    P.rect(20, 7, 1, 19, S[2]);
    tiles(P, [[10.5, 8], [22.5, 8], [16.5, 2.5]], ROOF, 3, 3, 8);
    P.line(16, 3, 11, 8, C.t[4]);
    window2(P, 14, 8, 2, 2);
    window2(P, 17, 8, 2, 2);
    ringMark(P, 16.5, 14, 2.6, C.gold[1], 1.2);
    // dveře
    P.disc(16.5, 21, 3, 3, C.w[1]);
    P.rect(13.5, 21, 6, 5, C.w[1]);
    P.disc(16.5, 21, 2.2, 2.2, C.w[2]);
    P.rect(14.3, 21, 4.4, 5, C.w[2]);
    P.rect(16, 19, 1, 7, C.w[1]);
    P.set(15, 23, C.gold[1]);
    P.set(18, 23, C.gold[1]);
    // praporce
    for (const x of [9, 22]) {
      P.rect(x, 19, 3, 6, T.m);
      P.rect(x, 19, 1, 6, T.l);
      P.rect(x + 2, 19, 1, 6, T.s);
      P.set(x, 25, T.m);
      P.set(x + 2, 25, T.m);
      P.set(x + 1, 21, C.gold[1]);
      P.set(x + 1, 22, C.gold[0]);
    }
    // zlatá koule
    part(P, L => L.disc(16.5, 2, 1.8, 1.8, C.gold[1]), 0.4, 0.3);
  };

  /* Kasárna: roubenka na kamenné podezdívce, tyrkysová střecha, modrý štít. */
  make.barracks = P => {
    stones(P, 23, 3, 27, 11, [S[1], S[2], S[3], S[4]], 4, 3, 4);
    P.rect(22, 2, 6, 1, S[4]);
    stones(P, 1, 27, 31, 31, [S[1], S[2], S[3], S[4]], 5, 3, 6);
    // roubené stěny
    for (let y = 16; y < 27; y++) {
      const ry = (y - 16) % 3;
      P.rect(2, y, 28, 1, ry === 0 ? C.w[3] : ry === 1 ? C.w[2] : C.w[0]);
    }
    for (let y = 16; y < 27; y += 3) {
      P.set(2, y + 1, C.d[4]);
      P.set(29, y + 1, C.d[3]);
      P.set(8 + ((y * 7) % 11), y + 1, C.w[1]);
    }
    window2(P, 5, 19, 3, 2);
    // dvoukřídlé dveře
    P.rect(11, 17, 9, 10, C.w[0]);
    P.rect(12, 18, 7, 9, C.w[2]);
    for (const x of [13, 15, 17]) P.rect(x, 18, 1, 9, C.w[1]);
    P.rect(15, 18, 1, 9, C.w[0]);
    P.rect(12, 20, 7, 1, S[2]);
    P.rect(12, 24, 7, 1, S[2]);
    P.set(14, 22, C.gold[1]);
    P.set(16, 22, C.gold[1]);
    // střecha
    tiles(P, [[0.5, 16.5], [31.5, 16.5], [26.5, 6], [5.5, 6]], ROOF, 4, 3, 7);
    P.rect(1, 16, 30, 1, C.w[3]);
    P.line(5, 6, 0, 16, C.t[4]);
    P.line(27, 6, 31, 15, C.t[0]);
    P.rect(6, 6, 20, 1, C.w[3]);
    // štít s Ringem
    part(P, L => L.disc(25, 21, 3.6, 3.6, sph(TEAMR, 24.5, 20.5, 3.6, 3.6, 0.15)), 0.3, 0.3);
    ringMark(P, 25, 21, 2.2, C.gold[1], 1);
    // stojan se zbraněmi
    P.line(22, 18, 22, 26, C.w[3]);
    P.set(22, 17, S[5]);
  };

  /* Strážní věž: kamenný válec, cimbuří, tyrkysový kužel, lucerna. */
  make.tower = P => {
    const SR = [S[1], S[2], S[3], S[4]];
    // dřík
    stones(P, 10, 14, 23, 31, SR, 4, 3, 11);
    P.rect(10, 14, 1, 17, S[4]);
    P.rect(21, 14, 2, 17, S[2]);
    stones(P, 9, 28, 24, 31, [S[1], S[2], S[3], S[4]], 5, 3, 13);
    // cimbuří
    stones(P, 8, 11, 25, 14, SR, 4, 3, 12);
    for (let x = 8; x < 25; x += 4) P.rect(x, 9, 2, 2, S[3]), P.set(x, 9, S[5]);
    P.rect(8, 13, 17, 1, S[1]);
    // horní komora
    stones(P, 11, 6, 22, 11, SR, 4, 3, 15);
    window2(P, 13, 7, 1, 2);
    window2(P, 18, 7, 1, 2);
    // střecha
    tiles(P, [[9.5, 7], [23.5, 7], [16.5, 0.5]], ROOF, 3, 3, 9);
    P.line(16, 1, 10, 7, C.t[4]);
    P.set(16, 0, C.gold[1]);
    // Ring, střílna, dveře
    ringMark(P, 16.5, 17.5, 2.4, C.gold[1], 1);
    P.rect(16, 21, 1, 4, C.ink);
    P.set(16, 22, C.a[2]);
    P.disc(16.5, 28, 2.4, 2.4, C.w[1]);
    P.rect(14, 28, 5, 3, C.w[1]);
    P.rect(15, 27, 3, 4, C.w[2]);
    P.rect(16, 27, 1, 4, C.w[1]);
    // lucerna na rameni
    P.line(23, 16, 26, 16, C.w[2]);
    P.rect(25, 17, 3, 4, C.gold[0]);
    P.rect(26, 18, 1, 2, C.a[4]);
  };

  /* Buda: doškový jehlan, dřevěné stěny, komínek a modrý praporek. */
  make.hut = P => {
    stones(P, 21, 6, 25, 14, [S[1], S[2], S[3], S[4]], 4, 3, 21);
    P.rect(20, 5, 6, 1, S[4]);
    // stěny z prken
    for (let x = 5; x < 27; x++) {
      const c = x % 4 === 3 ? C.w[0] : x < 9 ? C.w[3] : x > 22 ? C.w[1] : C.w[2];
      P.rect(x, 17, 1, 12, c);
      if (hash(x, 3, 5) < 0.3) P.set(x, 22 + ((x * 3) % 5), C.w[1]);
    }
    stones(P, 4, 28, 28, 31, [S[1], S[2], S[3], S[4]], 4, 3, 22);
    window2(P, 8, 21, 3, 2);
    P.rect(15, 20, 6, 9, C.w[0]);
    P.rect(16, 21, 4, 8, C.w[2]);
    P.rect(17, 21, 1, 8, C.w[1]);
    P.rect(16, 24, 4, 1, C.w[1]);
    P.set(19, 25, C.gold[1]);
    // došky
    const STRAW = [C.d[1], C.d[2], C.d[3], C.d[4], C.d[5]];
    P.poly([[2, 19], [30, 19], [16.5, 4]], (x, y) => {
      const t = 1 - (x - 2) / 28 * 0.85 - (y - 4) / 15 * 0.25;
      const streak = hash(x, Math.floor(y / 3), 17);
      let v = t + (streak < 0.2 ? -0.18 : streak > 0.85 ? 0.12 : 0);
      if ((y - 4) % 5 === 4) v -= 0.22;
      return pick(STRAW, v);
    });
    for (let x = 3; x < 30; x += 2) P.set(x, 19, C.d[2]);
    for (let x = 4; x < 29; x += 3) P.set(x, 20, C.d[1]);
    // praporek
    P.rect(16, 0, 1, 5, C.w[3]);
    P.rect(17, 0, 4, 3, T.m);
    P.rect(17, 0, 4, 1, T.l);
    P.clear(20, 2);
    P.set(19, 2, T.s);
  };

  /* Kovárna: břidlicová střecha, kamenné zdi, výheň, kovadlina, komín. */
  make.smithy = P => {
    const SLATE = [C.s[0], mix(C.s[1], C.m[0], 0.3), C.s[2], mix(C.s[2], C.s[3], 0.6)];
    stones(P, 22, 1, 28, 12, [S[1], S[2], S[3], S[4]], 3, 3, 31);
    P.rect(21, 1, 8, 1, S[4]);
    // zdi
    stones(P, 3, 15, 29, 31, [S[1], S[2], S[3], S[4]], 5, 3, 32);
    // střecha
    tiles(P, [[0.5, 16], [31.5, 16], [25, 6], [7, 6]], SLATE, 4, 3, 33);
    P.line(7, 6, 1, 15, S[3]);
    P.rect(1, 15, 30, 1, C.s[0]);
    // výheň v oblouku
    P.disc(13.5, 22, 5.2, 4, C.s[1]);
    P.rect(8, 22, 12, 9, C.s[1]);
    P.disc(13.5, 22.5, 4.2, 3.2, C.r[1]);
    P.rect(9, 22, 10, 9, C.r[1]);
    for (let y = 19; y < 31; y++) {
      for (let x = 9; x < 19; x++) {
        if (P.get(x, y) !== C.r[1]) continue;
        const d = Math.hypot((x + 0.5 - 13.5) / 5, (y + 0.5 - 29) / 8);
        const v = 1 - d + (bayer(x, y) - 0.5) * 0.35;
        P.set(x, y, v > 0.75 ? C.a[4] : v > 0.55 ? C.a[3] : v > 0.38 ? C.r[4] : v > 0.2 ? C.r[3] : C.r[2]);
      }
    }
    for (const x of [10, 13, 16]) P.set(x, 30, C.r[2]);
    P.line(8, 19, 19, 19, S[4]);
    // modrý štítek
    part(P, L => {
      L.poly([[22, 19], [27, 19], [27, 23], [24.5, 25.5], [22, 23]], (x) => (x < 24 ? T.l : x < 26 ? T.m : T.s));
    }, 0.25, 0.3);
    ringMark(P, 24.5, 21.5, 1.7, C.gold[1], 1);
    // kovadlina
    part(P, L => {
      L.rect(21, 27, 8, 2, S[3]);
      L.rect(19, 27, 2, 1, S[3]);
      L.rect(23, 29, 4, 2, S[1]);
    }, 0.35, 0.35);
    // jiskry
    P.set(20, 25, C.a[3]);
    P.set(30, 24, C.a[2]);
  };

  /* Zbroj: ocelový kyrys se zlatým lemem a Ringem. */
  make.armor = P => {
    part(P, L => {
      L.poly([[6, 4], [12, 3], [16.5, 7], [21, 3], [27, 4], [28.5, 10], [26, 16], [25.5, 25], [16.5, 30], [7.5, 25], [7, 16], [4.5, 10]],
        (x, y) => {
          let t = tone(x, y, 14, 12, 13, 15);
          if (Math.abs(x + 0.5 - 16.5) < 1) t += 0.18;
          return pick(STEEL, t);
        });
    }, 0.35, 0.35);
    // ramenní plát
    part(P, L => {
      L.poly([[3, 6], [10, 3.5], [11, 8], [5, 12]], sph(STEEL, 6, 6, 5, 4));
      L.poly([[23, 3.5], [30, 6], [28, 12], [22, 8]], sph(STEEL, 25, 6, 5, 4, -0.15));
    }, 0.35, 0.35);
    // zlatý lem
    P.line(12, 4, 16, 8, C.gold[1]);
    P.line(17, 8, 21, 4, C.gold[0]);
    for (let x = 9; x < 25; x++) P.set(x, 25 + Math.round(Math.abs(x - 16.5) * -0.35 + 3), x < 16 ? C.gold[1] : C.gold[0]);
    P.line(9, 14, 24, 14, S[2]);
    P.line(9, 13, 24, 13, S[4]);
    ringMark(P, 16.5, 19.5, 3.2, C.gold[1], 1.4);
    P.set(14, 17, C.gold[2]);
    for (const [x, y] of [[8, 9], [25, 9], [9, 21], [24, 21]]) P.set(x, y, C.gold[1]);
    P.set(9, 7, C.white);
  };

  /* Zbraně: široký meč na kovadlinových jiskrách. */
  make.weapon = P => {
    // čepel diagonálně od jílce vlevo dole ke hrotu vpravo nahoře
    part(P, L => {
      L.poly([[9, 20], [26, 3], [29, 2], [28, 5], [12, 23]], (x, y) => {
        const s = (x - y) - (26 - 3); // vzdálenost od hřbetu
        return x + y < 28 ? (s < -1 ? S[6] : S[4]) : s < -1 ? S[5] : S[3];
      });
    }, 0.25, 0.35);
    P.line(11, 21, 27, 4, S[3]);
    P.set(27, 3, C.white);
    P.set(20, 10, C.white);
    // záštita, rukojeť, hlavice
    part(P, L => {
      L.poly([[5, 18], [8, 16], [16, 24], [14, 27]], lin(GOLD.slice().reverse(), 5, 16, 15, 26));
      L.poly([[8, 22], [10, 24], [5, 29], [3, 27]], C.w[2]);
      L.disc(3.5, 29, 2, 2, C.gold[1]);
    }, 0.35, 0.35);
    for (let i = 0; i < 3; i++) P.set(8 - i * 1.5, 24 + i * 1.5, T.m);
    // jiskry z kovárny
    for (const [x, y, c] of [[22, 16, C.a[3]], [25, 13, C.a[4]], [19, 20, C.a[2]], [27, 18, C.a[2]], [24, 21, C.r[4]]]) P.set(x, y, c);
  };

  /* Mnich: hnědá kápě, tonzura, šedý vous, hůl s rozlomeným prstenem. */
  make.monk = P => {
    const HAB = [C.w[0], C.w[1], C.w[2], C.w[3]];
    // hůl vpravo
    P.rect(25, 9, 2, 23, C.w[3]);
    P.rect(26, 9, 1, 23, C.w[1]);
    ringMark(P, 25.5, 5.5, 4.6, C.gold[1], 1.6);
    P.set(23, 3, C.a[4]);
    // ramena v kutně, štóla
    part(P, L => L.disc(14.5, 31, 12, 9, sph(HAB, 11, 25, 12, 9, 0.05)));
    P.poly([[15, 23], [19, 23], [20, 32], [16, 32]], (x) => (x < 17 ? T.l : x > 18 ? T.s : T.m));
    // kápě spadlá na ramena
    part(P, L => L.disc(12, 22, 8, 3.2, sph(HAB, 10, 21, 8, 3, 0.15)), 0.3, 0.3);
    // hlava
    part(P, L => L.disc(15, 13, 6, 6.6, sph(SKIN, 14, 11, 6, 6, 0.12)), 0.15, 0.25);
    // věnec vlasů kolem tonzury
    for (let x = 9; x <= 21; x++) {
      if (x > 17) continue;
      P.set(x, 10 + (x < 11 ? 1 : 0), S[4]);
      P.set(x, 11 + (x < 11 ? 1 : 0), S[3]);
    }
    P.rect(9, 12, 2, 4, S[3]);
    P.set(13, 8, mix(C.skin[0], C.white, 0.5));
    // oko, nos, vous
    P.set(18, 13, EYE);
    P.set(18, 14, EYE);
    P.set(21, 15, C.skin[1]);
    part(P, L => L.poly([[14, 16], [21, 16], [20, 20], [16, 21]], sph([S[3], S[4], S[5], S[6]], 16, 16, 4, 3)), 0.2, 0.25);
    // ruka na holi
    part(P, L => L.disc(25, 21, 2.2, 2.2, sph(SKIN, 24, 20, 2, 2)), 0.2, 0.3);
  };

  /* Rytíř: koňská hlava v týmové uzdě, nad ní velká přilba, šikmé kopí s praporcem. */
  make.knight = P => {
    const HORSE = [C.w[1], C.w[2], C.w[3], mix(C.w[4], C.d[4], 0.3)];
    // kopí
    P.line(25, 31, 29, 4, C.w[3]);
    P.line(26, 31, 30, 4, C.w[1]);
    P.line(29, 3, 30, 1, S[5]);
    P.set(30, 0, C.white);
    P.poly([[29, 6], [29, 11], [22, 10], [23, 7]], (x, y) => (y < 8 ? T.l : y > 9 ? T.s : T.m));
    // koňská hlava a krk
    part(P, L => {
      L.poly([[6, 32], [16, 32], [17, 22], [22, 26], [25, 24], [19, 15], [13, 14], [8, 20]], (x, y) => pick(HORSE, tone(x, y, 13, 19, 9, 9) + 0.05));
    }, 0.3, 0.35);
    P.poly([[13, 14], [15, 14], [13, 10]], () => HORSE[2]);
    P.set(17, 18, EYE);
    P.set(24, 25, C.w[0]);
    P.line(19, 16, 24, 24, mix(C.d[5], C.white, 0.5));
    P.line(8, 20, 13, 14, C.w[0]);
    P.line(7, 22, 12, 16, C.w[0]);
    P.line(17, 22, 23, 23, T.d);
    P.line(16, 21, 18, 26, C.w[1]);
    // přilba jezdce
    part(P, L => {
      L.rect(3, 4, 9, 10, S[3]);
      L.disc(7.5, 4.5, 4.5, 2.5, S[4]);
    }, 0.35, 0.35);
    P.rect(7, 8, 5, 1, C.ink);
    P.rect(7, 1, 1, 12, S[5]);
    P.rect(3, 13, 9, 1, C.gold[0]);
    P.set(4, 3, C.white);
    P.poly([[2, 2], [6, 0.5], [3, 6]], (x) => (x < 4 ? T.l : T.m));
  };

  /* Katapult: kolo, podvozek, zvednuté rameno s kamenem. */
  make.catapult = P => {
    const TIM = [C.w[1], C.w[2], C.w[3], C.w[4]];
    // rameno a stojan
    P.line(9, 22, 14, 10, C.w[3]);
    P.line(10, 22, 15, 10, C.w[1]);
    P.line(19, 22, 14, 10, C.w[2]);
    part(P, L => L.rect(11, 8, 8, 3, C.w[2]), 0.3, 0.3);
    P.rect(11, 7, 8, 1, T.m);
    P.line(8, 20, 25, 4, C.w[3]);
    P.line(9, 21, 26, 5, C.w[1]);
    part(P, L => L.disc(25.5, 4.5, 3.5, 3.5, sph([S[2], S[3], S[4], S[5]], 24.5, 3.5, 3.5, 3.5)), 0.3, 0.35);
    // podvozek
    part(P, L => L.poly([[2, 20], [30, 20], [30, 24], [2, 24]], (x, y) => (y === 20 ? TIM[3] : x % 7 === 0 ? TIM[0] : TIM[2])), 0.3, 0.35);
    // kola
    for (const cx of [8, 24]) {
      part(P, L => L.disc(cx, 26, 5.2, 5.2, (x, y) => {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - 26);
        if (d > 4) return x < cx ? TIM[2] : TIM[1];
        if (d < 1.4) return S[3];
        const a = Math.atan2(y + 0.5 - 26, x + 0.5 - cx);
        return Math.abs(Math.sin(a * 2)) < 0.3 ? TIM[2] : C.w[0];
      }), 0.25, 0.3);
    }
    // štítek
    P.poly([[14, 21], [19, 21], [19, 24], [16.5, 26], [14, 24]], (x) => (x < 16 ? T.l : x > 17 ? T.s : T.m));
  };

  /* Stáj: došková střecha, prkna, kůň v půldveřích. */
  make.stable = P => {
    for (let x = 3; x < 29; x++) {
      const c = x % 4 === 3 ? C.w[0] : x < 7 ? C.w[3] : x > 24 ? C.w[1] : C.w[2];
      P.rect(x, 16, 1, 13, c);
    }
    stones(P, 2, 28, 30, 31, [S[1], S[2], S[3], S[4]], 4, 3, 41);
    // stání s koněm
    P.rect(7, 18, 11, 10, C.ink);
    P.rect(7, 23, 11, 5, C.w[2]);
    P.rect(7, 23, 11, 1, C.w[4]);
    const HORSE = [C.w[1], C.w[2], C.w[3], mix(C.w[4], C.d[4], 0.3)];
    P.poly([[9, 23], [13, 23], [13, 19], [16, 20], [18, 23], [16, 23]], (x) => pick(HORSE, 0.9 - (x - 9) / 12));
    P.set(13, 20, EYE);
    P.set(11, 17, HORSE[2]);
    // podkova na týmovém štítu
    P.poly([[20, 18], [27, 18], [27, 23], [23.5, 26], [20, 23]], (x) => (x < 22 ? T.l : x > 25 ? T.s : T.m));
    for (let a = 0.4; a < Math.PI * 2 - 0.4; a += 0.2) P.set(Math.round(23.5 + Math.sin(a) * 2.2), Math.round(21.5 - Math.cos(a) * 2.4), C.s[5]);
    // došky
    const STRAW = [C.d[1], C.d[2], C.d[3], C.d[4], C.d[5]];
    P.poly([[0, 17], [32, 17], [26, 5], [6, 5]], (x, y) => {
      const t = 1 - (x / 32) * 0.7 - (y - 5) / 12 * 0.2;
      const streak = hash(x, Math.floor(y / 3), 41);
      let v = t + (streak < 0.2 ? -0.18 : streak > 0.85 ? 0.12 : 0);
      if ((y - 5) % 4 === 3) v -= 0.22;
      return pick(STRAW, v);
    });
    for (let x = 1; x < 31; x += 2) P.set(x, 17, C.d[2]);
    P.rect(6, 4, 20, 1, C.w[3]);
  };

  /* Dílna: hrázděný štít s vraty, kolo a kladivo. */
  make.workshop = P => {
    const PL = [C.d[2], C.d[3], C.d[4], C.d[5]];
    P.rect(3, 15, 26, 14, PL[2]);
    for (let x = 3; x < 29; x++) for (let y = 15; y < 29; y++) if (hash(x, y, 51) > 0.8) P.set(x, y, PL[1]);
    P.rect(3, 15, 2, 14, C.w[1]);
    P.rect(27, 15, 2, 14, C.w[0]);
    P.line(5, 27, 11, 17, C.w[1]);
    stones(P, 2, 28, 30, 31, [S[1], S[2], S[3], S[4]], 4, 3, 52);
    // vrata
    P.rect(12, 18, 12, 10, C.ink);
    P.rect(12, 17, 12, 1, C.w[3]);
    P.line(14, 27, 18, 20, C.w[3]);
    P.line(22, 27, 18, 20, C.w[2]);
    P.set(18, 22, C.a[3]);
    // šindele
    tiles(P, [[0, 16], [32, 16], [25, 5], [7, 5]], [C.w[0], C.w[1], C.w[2], C.w[3]], 4, 3, 53);
    P.rect(7, 4, 18, 1, C.w[4]);
    // kladivo přes roh
    part(P, L => {
      L.poly([[22, 0], [30, 0], [30, 4], [22, 4]], (x) => (x < 25 ? S[5] : S[3]));
      L.poly([[25, 4], [27, 4], [27, 12], [25, 12]], C.w[3]);
    }, 0.3, 0.35);
  };

  /* Střelba: luk napnutý šípem s týmovými letkami. */
  make.archery = P => {
    // luk
    for (let i = -13; i <= 13; i++) {
      const t = i / 13;
      const x = Math.round(9 + 6 * (1 - t * t));
      P.set(x, 16 + i, Math.abs(i) < 3 ? C.w[1] : C.w[3]);
      P.set(x + 1, 16 + i, C.w[1]);
    }
    P.set(9, 3, C.bone[0]);
    P.set(9, 29, C.bone[0]);
    // tětiva
    P.line(9, 3, 4, 16, mix(C.bone[0], C.white, 0.3));
    P.line(4, 16, 9, 29, mix(C.bone[0], C.white, 0.3));
    // šíp
    P.line(4, 16, 27, 16, C.w[4]);
    P.line(4, 17, 26, 17, C.w[2]);
    part(P, L => L.poly([[26, 13], [31, 16.5], [26, 20]], (x, y) => (y < 16 ? S[6] : S[3])), 0.3, 0.3);
    P.poly([[3, 13], [8, 14], [8, 16], [2, 16]], (x) => (x < 5 ? T.l : T.m));
    P.poly([[2, 17], [8, 17], [8, 19], [3, 20]], (x) => (x < 5 ? T.m : T.s));
    for (const [x, y, c] of [[20, 10, C.a[3]], [23, 22, C.a[2]], [16, 8, C.a[4]]]) P.set(x, y, c);
  };

  /* Nástroje: zkřížený krumpáč a sekera. */
  make.tools = P => {
    // násady
    P.line(4, 29, 25, 8, C.w[3]);
    P.line(5, 29, 26, 8, C.w[1]);
    P.line(27, 29, 8, 10, C.w[3]);
    P.line(28, 29, 9, 10, C.w[1]);
    // hlava krumpáče
    part(P, L => {
      L.poly([[17, 4], [24, 5], [30, 11], [29, 13], [23, 9], [16, 7]], (x, y) => (x + y < 30 ? S[5] : S[3]));
    }, 0.3, 0.35);
    P.set(29, 12, C.white);
    // sekera
    part(P, L => {
      L.poly([[4, 6], [10, 4], [13, 9], [9, 15], [3, 13]], (x, y) => (x < 7 ? S[6] : x > 10 ? S[3] : S[4]));
    }, 0.3, 0.35);
    P.line(3, 7, 3, 12, C.white);
    for (const [x, y, c] of [[16, 20, C.gold[1]], [15, 21, C.gold[2]], [17, 19, C.gold[0]]]) P.set(x, y, c);
  };

  /* Opevnění: kamenná hradba s cimbuřím a týmový štít. */
  make.masonry = P => {
    stones(P, 2, 10, 30, 31, [S[1], S[2], S[3], S[4]], 6, 4, 61);
    for (let x = 2; x < 30; x += 8) {
      stones(P, x, 4, x + 5, 10, [S[1], S[2], S[3], S[4]], 5, 3, x);
      P.rect(x, 4, 5, 1, S[5]);
    }
    P.rect(2, 10, 28, 1, S[5]);
    part(P, L => {
      L.poly([[11, 13], [22, 13], [22, 21], [16.5, 27], [11, 21]], (x, y) => (x < 14 || y < 15 ? T.l : x > 19 ? T.s : T.m));
    }, 0.3, 0.35);
    ringMark(P, 16.5, 18.5, 3, C.gold[1], 1.2);
    P.set(12, 14, C.white);
  };

  /* Ohnivá koule: žhnoucí jádro, ohon k levému hornímu rohu. */
  make.fire = P => {
    const FIRE = [C.r[1], C.r[2], C.r[3], C.r[4], C.a[2], C.a[3], C.a[4]];
    // ohon
    P.poly([[1, 1], [9, 4], [15, 9], [24, 13], [13, 24], [9, 15], [4, 9]], (x, y) => {
      const along = (x + y) / 40;
      const v = along * 0.95 + (bayer(x, y) - 0.5) * 0.22;
      return v < 0.12 ? -1 : pick(FIRE, v);
    });
    P.poly([[5, 3], [13, 9], [10, 13]], (x, y) => (bayer(x, y) < 0.5 ? C.r[4] : C.a[2]));
    // koule
    P.disc(19.5, 19.5, 8.5, 8.5, (x, y) => {
      const d = Math.hypot(x + 0.5 - 18, y + 0.5 - 18) / 9.5;
      const v = 1 - d + (bayer(x, y) - 0.5) * 0.18;
      return v > 0.78 ? C.a[4] : v > 0.6 ? C.a[3] : v > 0.44 ? C.a[2] : v > 0.28 ? C.r[4] : v > 0.12 ? C.r[3] : C.r[2];
    });
    P.set(16, 15, C.white);
    P.set(15, 16, C.a[4]);
    // plaménky na okraji
    for (const [x, y] of [[27, 15], [28, 20], [25, 27], [20, 29], [12, 26]]) P.set(x, y, C.r[3]);
  };

  /* Léčení: zářivý kříž s měkkou září a jiskrami. */
  make.heal = P => {
    const GL = [C.glow[0], mix(C.glow[0], C.glow[1], 0.5), C.glow[1], C.glow[2]];
    part(P, L => {
      L.rect(12, 3, 9, 27, 1);
      L.rect(3, 12, 27, 9, 1);
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          if (L.get(x, y) < 0) continue;
          L.set(x, y, pick(GL, tone(x, y, 15, 15, 15, 15) + 0.08));
        }
      }
    }, 0.45, 0.4);
    P.rect(14, 5, 2, 23, C.glow[2]);
    P.rect(5, 14, 23, 2, C.glow[2]);
    P.rect(14, 14, 2, 2, C.white);
  };

  const afterHeal = P => {
    halo(P, 16.5, 16.5, 16, C.glow[0], 0.3);
    for (const [x, y] of [[4, 4], [27, 5], [5, 27]]) {
      P.set(x, y, C.glow[2]);
      P.set(x - 1, y, C.glow[1]);
      P.set(x + 1, y, C.glow[1]);
      P.set(x, y - 1, C.glow[1]);
      P.set(x, y + 1, C.glow[1]);
    }
  };
  after.heal = afterHeal;

  /* Rozkaz: jantarová šipka kurzoru s kruhy cíle u hrotu. */
  make.command = P => {
    const AMB = [C.a[0], C.a[1], C.a[2], C.a[3]];
    // hrot vpravo od štítku se zkratkou (levý horní roh tlačítka zakrývá písmeno)
    const K = 0.85;
    const pt = (x, y) => [11 + (x - 8) * K, 10 + (y - 8) * K];
    part(P, L => {
      L.poly([pt(8, 8), pt(28, 18), pt(20, 20.5), pt(27, 28), pt(23.5, 30.5), pt(17, 22.5), pt(12, 28)], lin(AMB.slice().reverse(), 11, 10, 25, 27));
    }, 0.45, 0.35);
    P.line(12, 12, 14, 26, C.a[0]);
    P.line(13, 11, 26, 18, C.a[4]);
  };
  after.command = P => {
    // „klepnutí“ u hrotu: krátké paprsky
    for (const [x, y, dx, dy] of [[10, 3, 0, 1], [6, 5, 1, 1], [16, 4, -1, 1]]) {
      P.set(x, y, C.a[3]);
      P.set(x + dx, y + dy, C.a[2]);
      P.set(x + dx * 2, y + dy * 2, C.a[1]);
    }
  };

  /* ---------- malé piktogramy HUD (stejné art rozměry, jemná mřížka) ---------- */
  const small = {};

  function pict(w, h, fn) {
    const P = new Pix(w * HD, h * HD);
    fn(P);
    P.outline(C.ink, 0.7);
    return PK.fine(P);
  }

  small.coin = pict(8, 8, P => {
    P.disc(8, 8, 6.8, 6.8, sph([C.gold[0], mix(C.gold[0], C.gold[1], 0.5), C.gold[1], C.gold[2]], 7, 7, 7, 7));
    // vyražený okraj: světlo nahoře vlevo, stín dole vpravo
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const dx = x + 0.5 - 8;
        const dy = y + 0.5 - 8;
        const d = Math.hypot(dx, dy);
        if (d <= 4.6 && d > 3.6) P.set(x, y, dx + dy < 0 ? C.gold[0] : C.gold[2]);
      }
    }
    P.rect(7, 6, 2, 4, C.gold[1]);
    P.rect(7, 6, 1, 4, C.gold[0]);
    P.set(4, 4, C.white);
  });

  small.wood = pict(10, 8, P => {
    const log = (x0, y0, x1, endX) => {
      for (let y = y0; y < y0 + 6; y++) {
        const r = y - y0;
        P.rect(x0, y, x1 - x0, 1, r === 0 ? C.w[4] : r < 3 ? C.w[3] : r < 5 ? C.w[2] : C.w[1]);
      }
      for (let x = x0 + 2; x < x1 - 2; x += 5) P.set(x, y0 + 2 + (x & 1), C.w[1]);
      P.disc(endX, y0 + 3, 2.4, 3, (x, y) => (Math.hypot(x + 0.5 - endX, y + 0.5 - y0 - 3) < 1.3 ? C.d[3] : x + 0.5 < endX ? C.d[5] : C.d[4]));
      P.set(endX, y0 + 3, C.d[2]);
    };
    log(1, 2, 15, 15.5);
    log(4, 8, 18, 4.5);
  });

  small.supply = pict(8, 9, P => {
    P.poly([[7, 1], [10, 0.5], [12, 3], [9, 2.5]], (x) => (x < 9 ? T.l : T.m));
    P.disc(8, 9, 6.4, 6.4, sph(STEEL, 7, 8, 6.4, 6.4));
    P.rect(2, 9, 12, 5, S[3]);
    P.rect(2, 9, 2, 5, S[4]);
    P.rect(12, 9, 2, 5, S[2]);
    P.rect(3, 9, 10, 2, C.shade);
    P.set(5, 9, C.a[3]);
    P.set(6, 9, C.a[2]);
    P.set(10, 9, C.a[3]);
    P.set(11, 9, C.a[2]);
    P.rect(7, 11, 2, 3, S[2]);
    P.rect(1, 14, 14, 2, S[2]);
    P.rect(1, 14, 14, 1, S[4]);
    P.set(4, 4, C.white);
  });

  small.horn = pict(10, 8, P => {
    P.poly([[1, 10], [6, 5], [12, 2], [17, 1], [17, 12], [11, 13], [5, 13]], (x, y) => pick([C.bone[2], C.bone[1], C.bone[0]], 1 - (y - 1) / 13));
    P.rect(15, 1, 3, 12, C.gold[1]);
    P.rect(15, 1, 1, 12, C.gold[2]);
    P.rect(9, 3, 2, 10, C.gold[0]);
    P.set(2, 10, C.r[4]);
  });

  small.heart = pict(8, 7, P => {
    const fn = sph([C.r[1], C.r[2], C.r[3], C.r[4]], 6, 5, 7, 6);
    P.disc(5, 5, 4, 4, fn);
    P.disc(11, 5, 4, 4, fn);
    P.poly([[1.2, 6], [14.8, 6], [8, 13.3]], fn);
    P.set(4, 3, C.r[5]);
    P.set(3, 4, C.r[4]);
  });

  small.sword = pict(8, 8, P => {
    P.poly([[4, 10], [12, 2], [14, 1.5], [13.5, 3.5], [6, 12]], (x, y) => (x + y < 15 ? S[5] : S[3]));
    P.set(13, 2, C.white);
    P.poly([[2, 8], [4, 7], [9, 12], [8, 14]], C.gold[1]);
    P.line(3, 8, 7, 12, C.gold[2]);
    P.line(4, 11, 1, 14, C.w[2]);
    P.set(1, 14, C.gold[1]);
  });

  small.range = pict(10, 7, P => {
    P.rect(4, 6, 12, 2, C.w[3]);
    P.rect(4, 7, 12, 1, C.w[2]);
    P.poly([[14, 3], [19, 7], [14, 11]], (x, y) => (y < 7 ? S[5] : S[3]));
    for (let i = 0; i < 4; i++) {
      P.set(1 + i, 3 + i, T.l);
      P.set(1 + i, 11 - i, T.m);
      P.set(2 + i, 3 + i, T.m);
      P.set(2 + i, 11 - i, T.s);
    }
  });

  small.boot = pict(8, 7, P => {
    P.rect(3, 1, 6, 9, C.w[3]);
    P.rect(3, 1, 2, 9, C.w[4]);
    P.rect(7, 1, 2, 9, C.w[2]);
    P.rect(2, 1, 8, 2, C.w[2]);
    P.rect(2, 1, 8, 1, C.w[4]);
    P.poly([[3, 9], [12, 8.5], [14.5, 10.5], [14.5, 12], [3, 12]], (x, y) => (y < 10 ? C.w[3] : C.w[2]));
    P.rect(2, 12, 13, 1, C.w[0]);
    P.set(4, 4, C.gold[1]);
  });

  small.star = pict(8, 8, P => {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i & 1 ? 3 : 7.2;
      pts.push([8 + Math.cos(a) * r, 8.4 + Math.sin(a) * r]);
    }
    P.poly(pts, (x, y) => pick([C.a[1], C.a[2], C.a[3], C.a[4]], tone(x, y, 7, 7, 7, 7) + 0.1));
    P.set(7, 5, C.white);
  });

  small.cross = (() => {
    const P = new Pix(5 * HD, 5 * HD);
    P.rect(4, 0, 2, 10, C.r[4]);
    P.rect(0, 4, 10, 2, C.r[4]);
    P.rect(4, 0, 1, 10, C.r[5]);
    P.rect(0, 4, 10, 1, C.r[5]);
    return PK.fine(P);
  })();

  /* ---------- velké ikony -> plátna (normální / zašedlé) ---------- */
  const big = {};
  const bigOff = {};
  const OFF = 0x5c5a6e;

  for (const [name, fn] of Object.entries(make)) {
    const P = new Pix(16 * HD, 16 * HD);
    fn(P);
    P.outline(C.ink, 0.72);
    if (after[name]) after[name](P);
    big[name] = PK.fine(P);

    const D = P.clone();
    for (let i = 0; i < D.d.length; i++) {
      const v = D.d[i];
      if (!(v >>> 24)) continue;
      const r = (v >> 16) & 255;
      const g = (v >> 8) & 255;
      const b = v & 255;
      const l = Math.round(r * 0.3 + g * 0.55 + b * 0.15);
      D.d[i] = (0xff000000 | mix((l << 16) | (l << 8) | l, OFF, 0.55)) >>> 0;
    }
    bigOff[name] = PK.fine(D);
  }

  /* ---------- the Ring emblem (broken circle + lantern spark) ---------- */
  const emblemCache = new Map();

  function ringEmblem(size, color, core = C.a[3]) {
    const key = `${size}|${color}|${core}`;
    if (emblemCache.has(key)) return emblemCache.get(key);

    // jemná mřížka: size art px = size * HD jemných
    const F = size * HD;
    const P = new Pix(F, F);
    const c = F / 2;
    const R = F / 2 - 1;
    const th = Math.max(2, Math.round(F / 6));
    const lit = mix(color, 0xffffff, 0.35);

    for (let y = 0; y < F; y++) {
      for (let x = 0; x < F; x++) {
        const dx = x + 0.5 - c;
        const dy = y + 0.5 - c;
        const r = Math.hypot(dx, dy);
        if (r > R || r <= R - th) continue;
        const ang = Math.atan2(dy, dx);
        if (ang > -1.05 && ang < -0.05) continue;
        const edge = r > R - 1 ? 1 : r <= R - th + 1 ? -1 : 0;
        let col = dx + dy < 0 ? lit : color;
        if (edge === 1) col = dx + dy < 0 ? mix(lit, WARM, 0.4) : mix(color, C.dusk, 0.3);
        else if (edge === -1) col = dx + dy < 0 ? mix(color, C.dusk, 0.25) : mix(lit, WARM, 0.2);
        P.set(x, y, col);
      }
    }

    // vodorovná příčka tvoří z kruhu písmeno G
    const barY = Math.round(c - th / 2);
    const bx = Math.round(c) - th;
    const bw = th + Math.floor(R);
    P.rect(bx, barY, bw, th, color);
    P.rect(bx, barY, bw, 1, lit);
    P.rect(bx, barY + th - 1, bw, 1, mix(color, C.dusk, 0.3));
    P.outline(C.ink, 0.72);
    const canvas = PK.fine(P);
    emblemCache.set(key, canvas);
    return canvas;
  }

  /* ---------- nápis GORALIA (logo) ---------- */
  /* Písmena ve stylu znaku G: stejně tlusté tahy (t = F/6), zaoblené rohy se stejným
   * poloměrem, příčky G, R a A v jedné výšce. Mezery optické: kulatá strana písmene
   * má menší odstup než rovná, otevřená (pravá strana L) nejmenší. F = výška písmene
   * v px, vrací se plátno přesně v px (pro zvětšení jen celočíselně). */
  const wordCache = new Map();

  function wordmark(F, word = "GORALIA", { color = C.a[2], depth = F >= 16 } = {}) {
    const key = `${F}|${word}|${color}|${depth}`;
    if (wordCache.has(key)) return wordCache.get(key);

    const t = Math.max(2, Math.round(F / 6));
    const rr = Math.round(F * 0.42); // poloměr vnějších rohů
    const barT = Math.round(F / 2 - t / 2); // horní hrana příček
    const barB = barT + t;

    // znaménková vzdálenost od obdélníku se zaoblenými rohy [tl, tr, br, bl]
    const box = (x, y, x0, y0, x1, y1, [tl, tr, br, bl]) => {
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const px = x - cx;
      const py = y - cy;
      const r = px > 0 ? (py > 0 ? br : tr) : (py > 0 ? bl : tl);
      const qx = Math.abs(px) - (x1 - x0) / 2 + r;
      const qy = Math.abs(py) - (y1 - y0) / 2 + r;
      return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
    };
    const ring = (d, inner = t) => d <= 0 && d > -inner;
    const stem = (x, y) => x < t && y >= 0 && y < F;
    const R4 = r => [r, r, r, r];

    const wO = Math.round(F * 0.92);
    const wR = Math.round(F * 0.78);
    const wA = Math.round(F * 0.84);
    const wL = Math.round(F * 0.64);

    // side: [levá, pravá] - "r" kulatá, "s" rovná, "o" otevřená
    const GLYPHS = {
      G: {
        w: wO,
        side: "rr",
        in(x, y) {
          const cx = wO / 2;
          const cy = F / 2;
          if (x >= cx - t / 2 && x < wO && y >= barT && y < barB) return true;
          if (!ring(box(x, y, 0, 0, wO, F, R4(rr)))) return false;
          // otvor vpravo nahoře, mezi koncem horního oblouku a příčkou
          return !(x > cx && y < barT && y > cy - (x - cx) * 1.1);
        }
      },
      O: { w: wO, side: "rr", in: (x, y) => ring(box(x, y, 0, 0, wO, F, R4(rr))) },
      R: {
        w: wR,
        side: "sr",
        in(x, y) {
          if (stem(x, y)) return true;
          const rb = Math.round(barB / 2);
          if (y < barB && ring(box(x, y, 0, 0, wR - 1, barB, [0, rb, rb, 0]))) return true;
          // noha: šikmo z příčky doprava dolů, vodorovně stejně tlustá jako kmen
          if (y < barB || y >= F) return false;
          const k = (y - barB) / (F - barB);
          const lx = wR * 0.38 + k * (wR - t - wR * 0.38);
          return x >= lx && x < lx + t + 0.5 && x < wR;
        }
      },
      A: {
        w: wA,
        side: "ss",
        in(x, y) {
          if (y >= F) return false;
          if (ring(box(x, y, 0, 0, wA, F + rr, [rr, rr, 0, 0]))) return true;
          return x >= 0 && x < wA && y >= barT + t / 2 && y < barB + t / 2;
        }
      },
      L: { w: wL, side: "so", in: (x, y) => stem(x, y) || (y >= F - t && y < F && x < wL) },
      I: { w: t, side: "ss", in: stem }
    };

    const bear = { r: 0, s: t * 0.15, o: 0 };
    const base = Math.max(2, Math.round(t * 0.75));
    const letters = [...word].map(ch => GLYPHS[ch]);
    const pad = 2;
    const gaps = letters.slice(1).map((g, i) => Math.round(base + bear[letters[i].side[1]] + bear[g.side[0]]));
    const W = letters.reduce((s, g) => s + g.w, 0) + gaps.reduce((s, g) => s + g, 0) + pad * 2;
    const H = F + pad * 2 + (depth ? 1 : 0);

    const mask = new Int16Array(W * H).fill(-1);
    const centers = [];
    let ox = pad;
    letters.forEach((gl, i) => {
      centers.push([ox + gl.w / 2, pad + F / 2]);
      for (let y = 0; y < F; y++) {
        for (let x = 0; x < gl.w; x++) if (gl.in(x + 0.5, y + 0.5)) mask[(pad + y) * W + ox + x] = i;
      }
      ox += gl.w + (gaps[i] || 0);
    });

    const lit = mix(color, 0xffffff, 0.35);
    const P = new Pix(W, H);
    const empty = (x, y) => x < 0 || y < 0 || x >= W || y >= H || mask[y * W + x] < 0;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = mask[y * W + x];
        if (i < 0) {
          // spodní hrana písmen: 1 px tmavé jantarové tloušťky
          if (depth && !empty(x, y - 1)) P.set(x, y, mix(color, C.r[1], 0.6));
          continue;
        }
        const [cx, cy] = centers[i];
        const upper = x + 0.5 - cx + (y + 0.5 - cy) < 0;
        let col = upper ? lit : color;
        // hrana natočená ke světlu (nahoru/doleva) se rozzáří, odvrácená ztmavne
        if (empty(x, y - 1) || empty(x - 1, y)) col = upper ? mix(lit, WARM, 0.4) : mix(color, WARM, 0.2);
        else if (empty(x, y + 1) || empty(x + 1, y)) col = mix(color, C.dusk, 0.3);
        P.set(x, y, col);
      }
    }
    P.outline(C.ink, 0.72);
    const canvas = P.rawCanvas();
    wordCache.set(key, canvas);
    return canvas;
  }

  /* ---------- pixel cursors ---------- */
  const cursors = {};

  function cursor(name, hx, hy, fn, fallback) {
    const P = new Pix(16, 16);
    fn(P);
    P.outline(C.ink, 0.6);
    const big2 = P.scale(2).toCanvas();
    cursors[name] = `url(${big2.toDataURL()}) ${hx * 2} ${hy * 2}, ${fallback}`;
  }

  cursor("default", 1, 1, P => {
    P.poly([[1, 1], [1, 13], [4, 10], [6.5, 14.5], [8.5, 13.5], [6, 9], [10.5, 9]], (x, y) => (x + y < 9 ? C.a[4] : C.a[3]));
    P.set(2, 3, C.white);
  }, "default");

  cursor("attack", 8, 8, P => {
    P.line2(2, 14, 12, 4, C.r[4]);
    P.line(3, 14, 13, 4, C.r[5]);
    P.line(1, 11, 5, 15, C.r[2]);
    P.set(13, 3, C.white);
    P.ring(8, 8, 6, 6, C.r[3], 1);
  }, "crosshair");

  cursor("gather", 3, 3, P => {
    P.line(3, 14, 10, 7, C.w[3]);
    P.line(4, 14, 11, 7, C.w[2]);
    const head = [[3, 7], [6, 3], [10, 2], [13, 5]];
    for (let i = 0; i < head.length - 1; i++) {
      P.line(head[i][0], head[i][1], head[i + 1][0], head[i + 1][1], C.a[4]);
      P.line(head[i][0], head[i][1] + 1, head[i + 1][0], head[i + 1][1] + 1, C.a[2]);
    }
  }, "pointer");

  // oprava: kladivo nakřivo, ocelová hlava napříč násadou
  cursor("repair", 11, 5, P => {
    P.line(2, 14, 10, 6, C.w[3]);
    P.line(3, 14, 11, 6, C.w[2]);
    P.poly([[9.2, 0.9], [15.6, 7.3], [12.8, 10.1], [6.4, 3.7]], (x, y) => (x - y < 5 ? C.s[5] : C.s[3]));
    P.set(9, 2, C.white);
  }, "pointer");

  cursor("target", 8, 8, P => {
    P.ring(8, 8, 5.5, 5.5, C.a[3], 1);
    for (const [x, y, w, h] of [[8, 0, 1, 3], [8, 13, 1, 3], [0, 8, 3, 1], [13, 8, 3, 1]]) P.rect(x, y, w, h, C.a[4]);
    P.set(8, 8, C.white);
  }, "crosshair");

  PK.icons = { big, bigOff, small, ringEmblem, wordmark, glyph };
  PK.cursors = cursors;
})();
