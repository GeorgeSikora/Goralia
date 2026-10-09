/*
 * Buildings, drawn procedurally. Wardens: warm plaster, teal slate, a great
 * lantern. Cinder Host: black basalt, ember gate, the slit eye.
 * Each sprite also records attach points (smoke, banners, glows) that the
 * renderer animates at runtime.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const { C, TEAM, Pix, mix, hash } = PK;

  const dark = (c, t) => mix(c, C.shade, t);
  const light = (c, t) => mix(c, 0xffffff, t);

  const brick = (ramp, bw, bh, seed) => (x, y) => {
    const row = Math.floor(y / bh);
    const off = (row & 1) * (bw >> 1);
    const col = Math.floor((x + off) / bw);

    if (y % bh === bh - 1 || (x + off) % bw === bw - 1) return ramp[0];

    const h = hash(col, row, seed);
    let c = h > 0.84 ? ramp[3] : h > 0.4 ? ramp[2] : ramp[1];
    if (y % bh === 0) c = ramp[3];
    return c;
  };

  const shingle = (ramp, tw, rh, y0, seed) => (x, y) => {
    const r = Math.floor((y - y0) / rh);
    const ry = (y - y0) % rh;
    const off = (r & 1) * (tw >> 1);
    const xi = (x + off) % tw;
    const h = hash(Math.floor((x + off) / tw), r, seed);
    let c = h > 0.78 ? ramp[3] : h < 0.28 ? ramp[1] : ramp[2];

    if (ry === rh - 1) c = ramp[0];
    else if (ry === 0) c = mix(c, ramp[4] != null ? ramp[4] : 0xffffff, 0.35);
    if (xi === tw - 1) c = ramp[0];
    return c;
  };

  /* Vertical amber glow gradient for lit openings. */
  const amber = (y, y0, y1) => {
    const t = (y - y0) / Math.max(1, y1 - y0);
    return t < 0.25 ? C.a[4] : t < 0.6 ? C.a[3] : t < 0.85 ? C.a[2] : C.a[1];
  };

  function edges(P, x0, y0, x1, y1, lite, shad) {
    for (let y = y0; y <= y1; y++) {
      if (P.get(x0, y) >= 0) P.set(x0, y, lite);
      if (P.get(x1, y) >= 0) P.set(x1, y, shad);
    }
  }

  function darkenRows(P, x0, x1, y0, y1, t) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const c = P.get(x, y);
        if (c >= 0) P.set(x, y, dark(c, t));
      }
    }
  }

  /* ---------- Radnice: the Lanternhall ---------- */
  function hall(team = "blue") {
    const W = 72;
    const H = 64;
    const P = new Pix(W, H);
    const T = TEAM[team];
    const stone = brick([C.s[0], C.s[2], C.s[3], C.s[4]], 7, 3, 5);
    const slate = shingle([C.t[0], C.t[1], C.t[2], C.t[3], C.t[4]], 5, 3, 18, 9);

    // foundation
    P.shade(5, 55, 67, 63, stone);
    P.rect(5, 55, 62, 1, C.s[5]);
    P.rect(5, 62, 62, 1, C.s[0]);

    // plaster and timber walls
    P.shade(8, 36, 64, 55, (x, y) => {
      const h = hash(x >> 1, y >> 1, 3);
      let c = y > 48 ? C.d[4] : C.d[5];
      if (x > 55) c = C.d[4];
      if (h > 0.92) c = c === C.d[5] ? C.d[4] : C.d[5];
      return c;
    });

    for (const x of [8, 20, 49, 62]) {
      P.rect(x, 36, 2, 19, C.w[1]);
      P.rect(x, 36, 1, 19, C.w[2]);
    }

    P.rect(8, 45, 56, 1, C.w[1]);
    P.rect(8, 53, 56, 2, C.w[1]);
    P.line(10, 52, 19, 46, C.w[2]);
    P.line(51, 46, 60, 52, C.w[2]);

    // windows with team shutters
    for (const wx of [13, 54]) {
      P.rect(wx - 1, 41, 7, 8, C.w[1]);
      P.shade(wx, 42, wx + 5, 48, (x, y) => amber(y, 42, 48));
      P.rect(wx + 2, 42, 1, 6, C.w[1]);
      P.rect(wx, 45, 5, 1, C.w[1]);
      P.rect(wx - 3, 41, 2, 8, T.m);
      P.rect(wx - 3, 41, 1, 8, T.l);
      P.rect(wx + 6, 41, 2, 8, T.s);
    }

    // roof (hipped, teal slate)
    P.poly([[3, 38], [69, 38], [55, 18], [17, 18]], (x, y) => {
      let c = slate(x, y);
      if (x < 24) c = mix(c, C.t[4], 0.12);
      if (x > 56) c = dark(c, 0.3);
      return c;
    });
    P.rect(2, 38, 68, 1, C.w[1]);
    P.rect(4, 39, 64, 2, C.d[2]);
    P.rect(17, 17, 39, 2, C.t[4]);
    P.rect(17, 19, 39, 1, C.t[0]);
    P.set(16, 17, C.t[3]);
    P.set(56, 17, C.t[3]);

    // dormers
    for (const dx of [14, 52]) {
      P.rect(dx, 28, 8, 7, C.d[5]);
      P.rect(dx + 2, 29, 4, 4, C.a[3]);
      P.rect(dx + 2, 29, 4, 1, C.a[4]);
      P.rect(dx + 3, 29, 1, 4, C.w[1]);
      P.rect(dx, 28, 8, 1, C.w[1]);
      P.poly([[dx - 1, 28], [dx + 9, 28], [dx + 4, 23]], (x, y) => y % 2 ? C.t[2] : C.t[3]);
      P.rect(dx + 7, 28, 1, 7, C.d[4]);
    }

    // chimney
    P.shade(56, 22, 61, 38, stone);
    P.rect(55, 20, 7, 2, C.s[4]);
    P.rect(55, 21, 7, 1, C.s[1]);

    // central lantern tower
    P.shade(28, 30, 44, 56, stone);
    edges(P, 28, 30, 43, 56, C.s[5], C.s[1]);
    P.rect(42, 30, 2, 26, C.s[1]);
    P.rect(27, 29, 18, 2, C.s[5]);
    P.rect(27, 31, 18, 1, C.s[0]);

    // great lantern room
    P.rect(29, 17, 14, 12, C.s[2]);
    for (const [x0, x1] of [[31, 34], [37, 40]]) {
      P.shade(x0, 19, x1 + 1, 29, (x, y) => amber(y, 19, 28));
      P.rect(x0, 23, 4, 1, C.gold[0]);
      P.rect(x0 + 1, 21, 2, 1, C.white);
    }
    for (const x of [29, 35, 41]) {
      P.rect(x, 17, 2, 12, C.s[3]);
      P.rect(x, 17, 1, 12, C.s[5]);
    }
    P.rect(29, 28, 14, 1, C.s[1]);

    // cone roof + orb
    P.poly([[25, 18], [47, 18], [36, 6]], (x, y) => {
      const c = slate(x, y + 1);
      return x > 38 ? dark(c, 0.25) : c;
    });
    P.rect(25, 18, 22, 1, C.t[4]);
    P.rect(25, 19, 22, 1, C.t[0]);
    P.disc(36, 3, 2.8, 2.8, (x, y) => (x < 36 && y < 3 ? C.a[4] : C.a[3]));
    P.set(35, 2, C.white);
    P.set(36, 5, C.gold[0]);
    P.set(36, 6, C.gold[0]);

    // door in a stone frame
    P.rect(31, 42, 10, 14, C.s[4]);
    P.rect(31, 42, 10, 1, C.s[5]);
    P.rect(32, 45, 8, 11, C.w[2]);
    P.rect(33, 43, 6, 2, C.w[2]);
    for (let x = 33; x < 40; x += 2) P.rect(x, 44, 1, 12, C.w[1]);
    P.rect(32, 48, 8, 1, C.s[1]);
    P.rect(32, 52, 8, 1, C.s[1]);
    P.rect(35, 46, 2, 10, C.a[1]);
    P.rect(36, 46, 1, 10, C.a[3]);

    // steps
    P.rect(30, 56, 12, 2, C.s[4]);
    P.rect(29, 58, 14, 2, C.s[3]);
    P.rect(28, 60, 16, 2, C.s[2]);
    P.rect(28, 56, 16, 1, C.s[5]);

    darkenRows(P, 9, 63, 41, 42, 0.32);
    P.outline(C.ink, 0.74);

    return {
      c: P.toCanvas(), w: W, h: H, ax: 36, ay: 62,
      banners: [[20, 42], [46, 42]],
      smoke: [[58, 18]],
      glows: [
        { x: 16, y: 45, r: 9, a: 0.5, color: C.a[2] },
        { x: 57, y: 45, r: 9, a: 0.5, color: C.a[2] },
        { x: 36, y: 50, r: 14, a: 0.45, color: C.a[2], ground: true },
        { x: 36, y: 3, r: 22, a: 0.6, color: C.a[2], pulse: true }
      ]
    };
  }

  /* ---------- Kasárna ---------- */
  function barracks(team = "blue") {
    const W = 64;
    const H = 54;
    const P = new Pix(W, H);
    const T = TEAM[team];
    const stone = brick([C.s[0], C.s[2], C.s[3], C.s[4]], 7, 3, 21);
    const roof = shingle([C.t[0], C.t[1], C.t[2], C.t[3], C.t[4]], 4, 3, 11, 4);

    P.shade(3, 45, 61, 53, stone);
    P.rect(3, 45, 58, 1, C.s[5]);
    P.rect(3, 52, 58, 1, C.s[0]);

    // plank walls
    P.shade(6, 28, 58, 46, (x, y) => {
      const k = (x - 6) % 4;
      if (k === 3) return C.w[0];
      const h = hash((x - 6) >> 2, y >> 3, 8);
      return h > 0.6 ? C.w[3] : C.w[2];
    });

    P.rect(6, 28, 52, 2, C.w[1]);
    P.rect(6, 44, 52, 2, C.w[1]);
    for (const x of [6, 17, 46, 56]) P.rect(x, 28, 2, 18, C.w[1]);
    P.rect(6, 28, 1, 18, C.w[3]);

    // roof
    P.poly([[2, 29], [62, 29], [51, 11], [13, 11]], (x, y) => {
      let c = roof(x, y);
      if (x > 50) c = dark(c, 0.3);
      return c;
    });
    P.rect(2, 29, 60, 1, C.w[1]);
    P.rect(4, 30, 56, 2, C.w[0]);
    P.rect(13, 10, 39, 2, C.w[3]);
    P.rect(13, 10, 39, 1, C.w[4]);

    // chimney
    P.shade(46, 4, 51, 22, stone);
    P.rect(45, 3, 7, 2, C.s[4]);

    // double door with a lit seam
    P.rect(24, 31, 16, 15, C.s[3]);
    P.rect(25, 33, 14, 13, C.w[2]);
    P.rect(25, 32, 14, 1, C.w[1]);
    for (let x = 26; x < 38; x += 3) P.rect(x, 33, 1, 13, C.w[1]);
    P.rect(25, 36, 14, 1, C.s[1]);
    P.rect(25, 42, 14, 1, C.s[1]);
    P.rect(31, 33, 2, 13, C.a[1]);
    P.rect(32, 34, 1, 11, C.a[3]);
    for (const [x, y] of [[27, 38], [29, 38], [35, 38], [37, 38]]) P.set(x, y, C.gold[1]);

    // wall shield plaque with the broken ring
    P.disc(13, 38, 4.5, 4.8, (x, y) => {
      const nx = (x + 0.5 - 13) / 4.5;
      const ny = (y + 0.5 - 38) / 4.8;
      if (nx * nx + ny * ny > 0.66) return C.s[4];
      return nx + ny < -0.4 ? T.l : nx + ny > 0.5 ? T.s : T.m;
    });
    for (const [x, y] of [[12, 36], [13, 36], [11, 37], [15, 37], [11, 38], [15, 38], [11, 39], [15, 39], [12, 40], [13, 40], [14, 40]]) {
      P.set(x, y, T.accent);
    }

    // spear rack
    P.rect(46, 34, 10, 1, C.w[1]);
    P.rect(46, 44, 10, 1, C.w[1]);
    for (let i = 0; i < 4; i++) {
      const x = 47 + i * 3;
      P.line(x, 44, x + (i % 2), 31 + (i % 2), C.w[3]);
      P.set(x + (i % 2), 30 + (i % 2), C.s[6]);
      P.set(x + (i % 2), 31 + (i % 2), C.s[4]);
    }

    darkenRows(P, 7, 57, 31, 32, 0.32);
    P.outline(C.ink, 0.74);

    return {
      c: P.toCanvas(), w: W, h: H, ax: 32, ay: 52,
      banners: [[8, 33]],
      smoke: [[48, 2]],
      glows: [
        { x: 32, y: 42, r: 13, a: 0.45, color: C.a[2], ground: true },
        { x: 32, y: 38, r: 8, a: 0.5, color: C.a[2] }
      ]
    };
  }

  /* ---------- Strážní věž ---------- */
  function tower() {
    const W = 32;
    const H = 62;
    const P = new Pix(W, H);
    const stone = brick([C.s[0], C.s[2], C.s[3], C.s[4]], 6, 3, 31);
    const roof = shingle([C.t[0], C.t[1], C.t[2], C.t[3], C.t[4]], 4, 3, 3, 14);

    // battered base
    P.poly([[5, 60], [27, 60], [25, 34], [7, 34]], stone);
    edges(P, 6, 34, 26, 60, C.s[5], C.s[1]);
    P.rect(22, 34, 4, 26, C.s[1]);

    // arrow slits + ring inlay
    for (const y of [41, 49]) {
      P.rect(15, y, 2, 4, C.s[0]);
      P.rect(15, y + 1, 2, 2, C.a[3]);
    }
    for (const [x, y] of [[14, 36], [15, 36], [13, 37], [17, 37], [13, 38], [17, 38], [14, 39], [15, 39], [16, 39]]) {
      P.set(x, y, C.a[1]);
    }

    // door
    P.rect(12, 52, 8, 9, C.s[4]);
    P.rect(13, 53, 6, 8, C.w[2]);
    P.rect(14, 52, 4, 1, C.w[2]);
    P.rect(16, 54, 1, 7, C.w[1]);
    P.rect(13, 56, 6, 1, C.s[1]);

    // deck with corbels and merlons
    P.rect(3, 30, 26, 5, C.s[2]);
    P.shade(3, 31, 29, 35, brick([C.s[0], C.s[1], C.s[2], C.s[3]], 4, 2, 7));
    P.rect(3, 30, 26, 1, C.s[5]);
    for (let x = 3; x < 29; x += 5) {
      P.rect(x, 26, 3, 5, C.s[3]);
      P.rect(x, 26, 3, 1, C.s[5]);
      P.rect(x + 2, 27, 1, 4, C.s[1]);
    }

    // turret
    P.shade(8, 12, 24, 27, stone);
    edges(P, 8, 12, 23, 27, C.s[5], C.s[1]);
    P.rect(21, 12, 3, 15, C.s[1]);
    P.rect(11, 17, 3, 5, C.s[0]);
    P.rect(12, 18, 1, 3, C.a[3]);
    P.rect(18, 17, 3, 5, C.s[0]);
    P.rect(19, 18, 1, 3, C.a[3]);

    // cone roof + finial
    P.poly([[6, 13], [26, 13], [16, 2]], (x, y) => {
      const c = roof(x, y);
      return x > 18 ? dark(c, 0.25) : c;
    });
    P.rect(6, 13, 20, 1, C.t[4]);
    P.rect(6, 14, 20, 1, C.t[0]);
    P.set(16, 1, C.a[3]);
    P.set(16, 0, C.a[4]);

    // hanging lantern on the deck corner
    P.rect(26, 31, 1, 2, C.w[1]);
    P.rect(25, 33, 3, 3, C.gold[0]);
    P.rect(26, 34, 1, 1, C.a[4]);

    P.outline(C.ink, 0.74);

    return {
      c: P.toCanvas(), w: W, h: H, ax: 16, ay: 60,
      banners: [],
      smoke: [],
      glows: [
        { x: 26, y: 34, r: 11, a: 0.5, color: C.a[2], pulse: true },
        { x: 16, y: 46, r: 5, a: 0.3, color: C.a[2] }
      ],
      fire: [16, 20]
    };
  }

  /* ---------- Rudá pevnost: the Cinder citadel ---------- */
  function citadel() {
    const W = 80;
    const H = 74;
    const P = new Pix(W, H);
    const T = TEAM.red;
    const B = C.b;
    const basalt = brick([B[0], B[1], B[2], B[3]], 7, 3, 77);
    const roof = shingle([B[0], B[1], B[2], B[3], C.r[3]], 4, 3, 12, 6);

    // curtain wall
    P.shade(3, 52, 77, 71, basalt);
    P.rect(3, 52, 74, 1, B[4]);
    P.rect(3, 70, 74, 1, B[0]);

    for (const x of [8, 14, 60, 66, 71]) {
      for (let y = 54; y < 68; y += 2) {
        if (hash(x, y, 4) > 0.5) P.set(x + (y % 3), y, C.r[2]);
      }
    }

    // parapet teeth
    for (let x = 3; x < 77; x += 6) {
      P.rect(x, 49, 4, 4, B[3]);
      P.rect(x, 49, 4, 1, B[4]);
    }

    // flanking towers
    for (const x0 of [2, 59]) {
      P.shade(x0, 30, x0 + 19, 71, basalt);
      edges(P, x0, 30, x0 + 18, 71, B[4], B[0]);
      P.rect(x0 + 16, 30, 3, 41, B[0]);
      P.rect(x0 - 1, 28, 21, 3, B[3]);
      P.rect(x0 - 1, 28, 21, 1, B[4]);
      P.poly([[x0 - 1, 28], [x0 + 20, 28], [x0 + 9.5, 9]], (x, y) => {
        const c = roof(x, y);
        return x > x0 + 11 ? dark(c, 0.3) : c;
      });
      P.line(x0 + 9, 9, x0 + 9, 3, B[3]);
      P.set(x0 + 9, 2, C.r[5]);
      P.set(x0 + 9, 3, C.r[4]);
      P.rect(x0 + 8, 40, 3, 5, B[0]);
      P.rect(x0 + 9, 41, 1, 3, C.r[4]);
    }

    // central keep
    P.shade(24, 16, 56, 58, basalt);
    edges(P, 24, 16, 55, 58, B[4], B[0]);
    P.rect(52, 16, 4, 42, B[0]);
    P.rect(23, 14, 34, 3, B[3]);
    P.rect(23, 14, 34, 1, B[4]);
    for (let x = 23; x < 57; x += 6) {
      P.rect(x, 11, 4, 4, B[2]);
      P.rect(x, 11, 4, 1, B[4]);
    }

    // crown of bone-iron spikes
    for (const [x, h] of [[25, 6], [31, 9], [38, 12], [45, 9], [51, 6]]) {
      P.poly([[x - 2, 11], [x + 3, 11], [x + 0.5, 11 - h]], (px, py) => (px < x + 0.5 ? C.bone[0] : C.bone[1]));
    }

    // the slit eye
    P.disc(40, 31, 7, 4, (x, y) => {
      const ny = (y + 0.5 - 31) / 4;
      return ny < -0.4 ? C.r[5] : ny < 0.3 ? C.r[4] : C.r[3];
    });
    P.rect(40, 28, 1, 7, B[0]);
    P.rect(39, 29, 3, 5, B[0]);
    P.rect(40, 28, 1, 7, B[0]);
    P.ring(40, 31, 8, 5, B[1], 1);
    P.set(37, 30, C.white);

    // gate with portcullis
    P.rect(32, 50, 16, 21, B[4]);
    P.rect(33, 52, 14, 19, B[0]);
    P.shade(33, 52, 47, 71, (x, y) => (y > 60 ? C.r[3] : y > 56 ? C.r[2] : C.r[1]));
    for (let x = 34; x < 47; x += 3) {
      P.rect(x, 52, 1, 19, B[3]);
      P.set(x, 71, B[0]);
    }
    for (const y of [56, 62]) P.rect(33, y, 14, 1, B[2]);
    for (let x = 34; x < 47; x += 3) P.set(x, 70, C.bone[0]);

    // skull trophies
    for (const [x, y] of [[29, 40], [50, 40], [11, 58], [68, 58]]) {
      P.rect(x, y, 3, 2, C.bone[0]);
      P.set(x, y + 2, C.bone[1]);
      P.set(x + 2, y + 2, C.bone[1]);
      P.set(x, y, B[0]);
      P.set(x + 2, y, B[0]);
    }

    // braziers
    for (const x of [27, 52]) {
      P.rect(x, 62, 1, 8, B[0]);
      P.rect(x - 2, 60, 5, 2, B[2]);
      P.rect(x - 2, 60, 5, 1, B[4]);
    }

    P.outline(C.ink, 0.7);

    return {
      c: P.toCanvas(), w: W, h: H, ax: 40, ay: 70,
      banners: [[22, 34], [51, 34]],
      smoke: [[22, 2], [40, -1], [57, 2]],
      flames: [[27, 59], [52, 59]],
      glows: [
        { x: 40, y: 31, r: 16, a: 0.65, color: C.r[4], pulse: true },
        { x: 40, y: 62, r: 14, a: 0.5, color: C.r[4] },
        { x: 27, y: 58, r: 10, a: 0.45, color: C.r[4], flicker: true },
        { x: 52, y: 58, r: 10, a: 0.45, color: C.r[4], flicker: true },
        { x: 40, y: 66, r: 20, a: 0.4, color: C.r[3], ground: true }
      ]
    };
  }

  /* ---------- banners (waving) ---------- */
  const bannerCache = {};

  function bannerFrames(team) {
    if (bannerCache[team]) return bannerCache[team];

    const T = TEAM[team];
    const w = 7;
    const h = 14;
    const frames = [];

    for (let f = 0; f < 4; f++) {
      const P = new Pix(w + 4, h + 2);

      for (let y = 0; y < h; y++) {
        const wave = Math.round(Math.sin(y * 0.55 + f * 1.57) * (y / h) * 1.4);
        let x0 = 1 + wave;
        let x1 = x0 + w - 1;

        // swallowtail
        if (y >= h - 3) {
          const cut = (y - (h - 4)) * 1;
          if (y === h - 1) { x0 += 2; x1 -= 2; }
          else if (y === h - 2) { x0 += 1; x1 -= 1; }
          else if (cut > 0) { /* full width */ }
        }

        for (let x = x0; x <= x1; x++) {
          let c = T.m;
          if (x === x0) c = T.l;
          else if (x >= x1 - 1) c = T.s;
          if ((y + x) % 7 === 0 && y > 4) c = mix(c, T.d, 0.3);
          P.set(x, y + 1, c);
        }
      }

      P.rect(0, 0, w + 2, 1, C.w[3]);
      P.set(0, 0, C.gold[1]);
      P.set(w + 1, 0, C.gold[1]);

      const ex = 3 + Math.round(Math.sin(4 * 0.55 + f * 1.57) * (4 / h) * 1.4);

      if (team !== "red") {
        const ring = [".XX..", "X...X", "X...X", "X...X", ".XXX."];
        ring.forEach((row, r) => {
          for (let i = 0; i < 5; i++) if (row[i] === "X") P.set(ex - 1 + i, 4 + r, T.accent);
        });
      } else {
        const eye = [".XXX.", "XXKXX", ".XXX."];
        eye.forEach((row, r) => {
          for (let i = 0; i < 5; i++) {
            if (row[i] === "X") P.set(ex - 1 + i, 5 + r, T.accentL);
            if (row[i] === "K") P.set(ex - 1 + i, 5 + r, C.ink);
          }
        });
      }

      P.outline(C.ink, 0.72);
      frames.push(P.toCanvas());
    }

    return (bannerCache[team] = frames);
  }

  /* ---------- rubble left behind by destroyed buildings ---------- */
  function rubble(type, team) {
    const w = type === "tower" ? 26 : type === "barracks" ? 46 : 60;
    const h = 16;
    const P = new Pix(w, h);
    const ramp = team === "red" ? C.b : C.s;
    const base = type === "tower" ? 12 : 14;

    for (let i = 0; i < w * 1.2; i++) {
      const x = Math.floor(hash(i, 1, 90) * (w - 6));
      const y = Math.floor(4 + hash(i, 2, 90) * (h - 8));
      const sz = 2 + Math.floor(hash(i, 3, 90) * 4);
      if (Math.abs(x - w / 2) > w / 2 - 3 && hash(i, 4, 90) > 0.4) continue;
      const hh = Math.max(1, sz - 1);
      P.rect(x, y, sz, hh, ramp[1 + Math.floor(hash(i, 5, 90) * 3)]);
      P.rect(x, y, sz, 1, ramp[4]);
    }

    for (let i = 0; i < 5; i++) {
      const x = 4 + Math.floor(hash(i, 6, 90) * (w - 14));
      const y = 5 + Math.floor(hash(i, 7, 90) * 6);
      P.rect(x, y, 7, 1, C.w[2]);
      P.rect(x + 1, y + 1, 5, 1, C.w[1]);
    }

    P.outline(C.ink, 0.7);
    void base;
    return { c: P.toCanvas(), w, h };
  }

  const cache = {};

  function get(type, team = "blue") {
    const key = `${type}|${team}`;

    if (!cache[key]) {
      cache[key] = {
        hall,
        barracks,
        tower,
        citadel
      }[type](team);
    }

    return cache[key];
  }

  PK.buildings = {
    get,
    banner: bannerFrames,
    rubble,
    teamOf: type => (type === "citadel" ? "red" : "blue")
  };
})();
