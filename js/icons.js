/*
 * Icons: 16x16 command glyphs, small HUD pictograms, pixel cursors and the
 * Ring emblem. All drawn on the shared pixel grid, outlined like sprites.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const { C, TEAM, Pix, mix } = PK;

  const S = C.s;
  const T = TEAM.blue;
  const RING5 = [".XX..", "X...X", "X...X", "X...X", ".XXX."];

  function glyph(P, x, y, c, rows = RING5) {
    rows.forEach((row, r) => {
      for (let i = 0; i < row.length; i++) if (row[i] === "X") P.set(x + i, y + r, c);
    });
  }

  function poly(P, pts, fn) {
    P.poly(pts, fn);
  }

  const make = {};

  make.worker = P => {
    P.line(3, 14, 11, 6, C.w[2]);
    P.line(4, 14, 12, 6, C.w[3]);
    const head = [[3, 6], [5, 3], [8, 2], [11, 3], [13, 6], [14, 9]];
    for (let i = 0; i < head.length - 1; i++) {
      P.line(head[i][0], head[i][1] + 1, head[i + 1][0], head[i + 1][1] + 1, S[3]);
      P.line(head[i][0], head[i][1], head[i + 1][0], head[i + 1][1], S[5]);
    }
    P.set(8, 2, C.white);
    P.disc(11.5, 12.5, 2.2, 2.2, C.gold[1]);
    P.set(10, 11, C.gold[2]);
    P.disc(7.5, 13.8, 1.5, 1.2, C.gold[0]);
  };

  make.soldier = P => {
    P.line2(2, 14, 12, 3, S[5]);
    P.set(13, 2, C.white);
    P.line(3, 10, 6, 13, C.gold[1]);
    P.disc(8.5, 9, 5.5, 6, (x, y) => {
      const nx = (x + 0.5 - 8.5) / 5.5;
      const ny = (y + 0.5 - 9) / 6;
      if (nx * nx + ny * ny > 0.62) return nx + ny < -0.2 ? S[5] : S[3];
      return nx + ny < -0.5 ? T.l : nx + ny > 0.55 ? T.s : T.m;
    });
    glyph(P, 6, 7, T.accent);
  };

  make.archer = P => {
    const bow = [[10, 1], [13, 4], [14, 8], [13, 12], [10, 15]];
    for (let i = 0; i < bow.length - 1; i++) {
      P.line(bow[i][0] - 1, bow[i][1], bow[i + 1][0] - 1, bow[i + 1][1], C.w[2]);
      P.line(bow[i][0], bow[i][1], bow[i + 1][0], bow[i + 1][1], C.w[4]);
    }
    P.line(9, 1, 9, 15, C.bone[0]);
    P.line(1, 8, 13, 8, C.w[3]);
    poly(P, [[12, 6], [15.5, 8], [12, 10]], S[5]);
    for (const [x, y] of [[1, 7], [2, 7], [1, 9], [2, 9], [3, 6], [3, 10]]) P.set(x, y, T.l);
  };

  make.hero = P => {
    P.rect(7, 0, 2, 2, C.gold[0]);
    P.rect(5, 2, 6, 1, C.gold[1]);
    P.rect(4, 3, 8, 9, C.gold[0]);
    P.shade(5, 3, 11, 12, (x, y) => {
      const t = (y - 3) / 9;
      return t < 0.3 ? C.a[4] : t < 0.7 ? C.a[3] : C.a[2];
    });
    P.rect(7, 3, 2, 9, C.gold[0]);
    P.rect(4, 12, 8, 2, C.gold[1]);
    P.rect(6, 14, 4, 1, C.gold[0]);
    P.set(6, 6, C.white);
    P.set(2, 4, C.white);
    P.set(13, 7, C.white);
    P.set(14, 3, C.a[3]);
    P.set(1, 10, C.a[3]);
  };

  make.tower = P => {
    P.rect(4, 11, 8, 5, S[3]);
    P.rect(4, 11, 2, 5, S[5]);
    P.rect(10, 11, 2, 5, S[1]);
    P.rect(3, 9, 10, 2, S[4]);
    for (const x of [3, 6, 9, 11]) P.rect(x, 7, 2, 2, S[4]);
    P.rect(5, 4, 6, 4, S[3]);
    P.rect(5, 4, 2, 4, S[5]);
    poly(P, [[4, 4], [12, 4], [8, 0]], (x) => (x < 8 ? C.t[3] : C.t[1]));
    P.rect(7, 5, 2, 2, C.a[3]);
    P.rect(7, 12, 2, 4, C.w[2]);
  };

  make.barracks = P => {
    P.rect(2, 8, 12, 7, C.w[2]);
    P.rect(2, 8, 12, 1, C.w[1]);
    poly(P, [[1, 8], [15, 8], [12, 3], [4, 3]], (x, y) => (y % 2 ? C.t[2] : C.t[3]));
    P.rect(1, 8, 14, 1, C.t[0]);
    P.rect(6, 10, 4, 5, C.w[0]);
    P.rect(7, 11, 2, 4, C.a[2]);
    P.rect(12, 0, 1, 4, C.w[3]);
    P.rect(13, 0, 3, 2, T.m);
    P.rect(2, 10, 2, 3, S[4]);
  };

  make.fire = P => {
    poly(P, [[0, 1], [10, 6], [6, 11]], C.r[3]);
    poly(P, [[2, 4], [9, 7], [6, 10]], C.r[4]);
    P.disc(10, 10, 4.8, 4.8, (x, y) => {
      const d = Math.hypot(x + 0.5 - 10, y + 0.5 - 10);
      return d < 2 ? C.a[4] : d < 3.4 ? C.a[3] : d < 4.2 ? C.r[4] : C.r[3];
    });
    P.set(9, 9, C.white);
  };

  make.heal = P => {
    P.rect(6, 1, 4, 14, C.glow[1]);
    P.rect(1, 6, 14, 4, C.glow[1]);
    P.rect(6, 1, 4, 1, C.glow[2]);
    P.rect(1, 6, 1, 4, C.glow[2]);
    P.rect(6, 1, 1, 6, C.glow[2]);
    P.rect(9, 10, 1, 5, C.glow[0]);
    P.rect(10, 9, 5, 1, C.glow[0]);
    P.rect(6, 14, 4, 1, C.glow[0]);
    P.set(7, 7, C.white);
    P.set(2, 2, C.white);
    P.set(13, 2, C.glow[2]);
    P.set(2, 13, C.glow[2]);
  };

  make.command = P => {
    poly(P, [[2, 2], [14, 8], [9, 9.5], [8, 14.5]], (x, y) => (x + y < 14 ? C.a[4] : x + y < 18 ? C.a[3] : C.a[2]));
    P.line(2, 3, 8, 14, C.a[1]);
  };

  /* ---------- small HUD pictograms ---------- */
  const small = {};

  small.coin = (() => {
    const P = new Pix(8, 8);
    P.disc(4, 4, 3.5, 3.5, (x, y) => (x + y < 7 ? C.gold[2] : C.gold[1]));
    P.ring(4, 4, 2.6, 2.6, C.gold[0], 1);
    P.set(3, 3, C.white);
    P.outline(C.ink, 0.7);
    return P.toCanvas();
  })();

  small.wood = (() => {
    const P = new Pix(10, 8);
    P.rect(0, 1, 8, 3, C.w[3]);
    P.rect(1, 4, 8, 3, C.w[2]);
    P.rect(0, 1, 8, 1, C.w[4]);
    P.rect(1, 4, 8, 1, C.w[3]);
    P.disc(8.5, 2.5, 1, 1.5, C.d[4]);
    P.disc(1.5, 5.5, 1, 1.5, C.d[3]);
    P.outline(C.ink, 0.7);
    return P.toCanvas();
  })();

  small.supply = (() => {
    const P = new Pix(8, 9);
    P.disc(4, 4.5, 3.5, 3.5, S[3]);
    P.rect(0, 4, 8, 3, S[3]);
    P.rect(1, 1, 3, 1, S[5]);
    P.rect(3, 0, 2, 2, T.m);
    P.rect(2, 5, 4, 2, S[0]);
    P.set(3, 5, C.a[3]);
    P.set(5, 5, C.a[3]);
    P.rect(0, 7, 8, 1, S[2]);
    P.outline(C.ink, 0.7);
    return P.toCanvas();
  })();

  small.horn = (() => {
    const P = new Pix(10, 8);
    poly(P, [[0, 5], [4, 2], [9, 0], [9, 6], [4, 7]], (x, y) => (y < 3 ? C.bone[0] : C.bone[1]));
    P.rect(8, 0, 2, 7, C.gold[1]);
    P.set(1, 5, C.r[4]);
    P.outline(C.ink, 0.7);
    return P.toCanvas();
  })();

  small.heart = (() => {
    const P = new Pix(8, 7);
    P.disc(2.5, 2.5, 2.5, 2.5, C.r[3]);
    P.disc(5.5, 2.5, 2.5, 2.5, C.r[3]);
    poly(P, [[0.5, 3.5], [7.5, 3.5], [4, 7]], C.r[3]);
    P.set(2, 1, C.r[5]);
    P.set(1, 2, C.r[4]);
    P.outline(C.ink, 0.7);
    return P.toCanvas();
  })();

  small.sword = (() => {
    const P = new Pix(8, 8);
    P.line(1, 6, 6, 1, S[5]);
    P.line(2, 6, 6, 2, S[4]);
    P.line(0, 3, 3, 6, C.gold[1]);
    P.set(7, 0, C.white);
    P.outline(C.ink, 0.7);
    return P.toCanvas();
  })();

  small.range = (() => {
    const P = new Pix(10, 7);
    P.line(0, 3, 8, 3, C.w[4]);
    poly(P, [[7, 1], [10, 3.5], [7, 6]], S[5]);
    P.set(0, 2, T.l);
    P.set(0, 4, T.l);
    P.set(1, 1, T.l);
    P.set(1, 5, T.l);
    P.outline(C.ink, 0.7);
    return P.toCanvas();
  })();

  small.boot = (() => {
    const P = new Pix(8, 7);
    P.rect(1, 0, 3, 5, C.w[3]);
    P.rect(1, 4, 6, 2, C.w[2]);
    P.rect(1, 0, 3, 1, C.w[4]);
    P.rect(1, 5, 7, 1, C.w[1]);
    P.outline(C.ink, 0.7);
    return P.toCanvas();
  })();

  small.star = (() => {
    const P = new Pix(8, 8);
    poly(P, [[4, 0], [5, 3], [8, 3.2], [5.6, 5], [6.4, 8], [4, 6.2], [1.6, 8], [2.4, 5], [0, 3.2], [3, 3]], (x, y) => (x < 4 ? C.a[4] : C.a[2]));
    P.outline(C.ink, 0.7);
    return P.toCanvas();
  })();

  small.cross = (() => {
    const P = new Pix(5, 5);
    P.rect(2, 0, 1, 5, C.r[4]);
    P.rect(0, 2, 5, 1, C.r[4]);
    return P.toCanvas();
  })();

  /* ---------- large icons -> cached canvases (normal / disabled) ---------- */
  const big = {};
  const bigOff = {};

  for (const [name, fn] of Object.entries(make)) {
    const P = new Pix(16, 16);
    fn(P);
    P.outline(C.ink, 0.72);
    big[name] = P.toCanvas();
    bigOff[name] = P.tint(0x6a6a78, 0.7).toCanvas();
  }

  /* ---------- the Ring emblem (broken circle + lantern spark) ---------- */
  const emblemCache = new Map();

  function ringEmblem(size, color, core = C.a[3]) {
    const key = `${size}|${color}|${core}`;
    if (emblemCache.has(key)) return emblemCache.get(key);

    const P = new Pix(size, size);
    const c = size / 2;
    const R = size / 2 - 0.5;
    const th = Math.max(1, Math.round(size / 6));

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x + 0.5 - c;
        const dy = y + 0.5 - c;
        const r = Math.hypot(dx, dy);
        if (r > R || r <= R - th) continue;
        const ang = Math.atan2(dy, dx);
        if (ang > -1.25 && ang < -0.35) continue;
        P.set(x, y, dx + dy < 0 ? mix(color, 0xffffff, 0.35) : color);
      }
    }

    P.disc(c, c, size / 7, size / 7, core);
    P.outline(C.ink, 0.72);
    const canvas = P.toCanvas();
    emblemCache.set(key, canvas);
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
    poly(P, [[1, 1], [1, 13], [4, 10], [6.5, 14.5], [8.5, 13.5], [6, 9], [10.5, 9]], (x, y) => (x + y < 9 ? C.a[4] : C.a[3]));
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

  cursor("target", 8, 8, P => {
    P.ring(8, 8, 5.5, 5.5, C.a[3], 1);
    for (const [x, y, w, h] of [[8, 0, 1, 3], [8, 13, 1, 3], [0, 8, 3, 1], [13, 8, 3, 1]]) P.rect(x, y, w, h, C.a[4]);
    P.set(8, 8, C.white);
  }, "crosshair");

  PK.icons = { big, bigOff, small, ringEmblem, glyph };
  PK.cursors = cursors;
})();
