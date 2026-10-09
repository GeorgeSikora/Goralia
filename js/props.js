/*
 * Trees, ore, and the small doodads that make the glade feel lived-in.
 * Everything that is tall and walkable-looking is interactive; decorative
 * clutter stays below knee height or sits at the edges of the map.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const { C, Pix, mix, hash } = PK;

  const G = C.g;

  /* ---------- trees ("Lanternwood") ---------- */
  function puff(P, cx, cy, rx, ry, seed, ramp) {
    P.disc(cx, cy, rx, ry, (x, y) => {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      let l = -(nx * 0.62 + ny * 0.78);
      l += (hash(x >> 1, y >> 1, seed) - 0.5) * 0.6;
      if (l > 0.82 && hash(x, y, seed + 3) > 0.45) return ramp[5];
      return ramp[l > 0.5 ? 4 : l > 0.12 ? 3 : l > -0.3 ? 2 : l > -0.65 ? 1 : 0];
    });
  }

  function bark(P, x0, x1, y0, y1, seed, lit = C.w[3], mid = C.w[2], shade = C.w[1]) {
    for (let y = y0; y <= y1; y++) {
      let left = -1;
      let right = -1;

      for (let x = x0; x <= x1; x++) {
        if (P.get(x, y) >= 0 || true) {
          if (left < 0) left = x;
          right = x;
        }
      }

      for (let x = left; x <= right; x++) {
        const rel = (x - left) / Math.max(1, right - left);
        let c = rel < 0.3 ? lit : rel > 0.7 ? shade : mid;
        if (hash(x, y >> 2, seed) > 0.78) c = shade;
        if (rel < 0.4 && hash(x, y, seed + 9) > 0.86) c = G[3];
        P.set(x, y, c);
      }
    }
  }

  function treeVariant(kind) {
    const W = 36;
    const H = 46;
    const trunk = new Pix(W, H);
    const crown = new Pix(W, H);
    const fruit = [];
    const seed = 40 + kind * 11;

    if (kind === 0) {
      // ancient oak: broad crown, flared roots, hanging moss
      for (let y = 27; y <= 44; y++) {
        const half = y < 38 ? 3 : y < 41 ? 4 : 6;
        bark(trunk, 18 - half, 18 + half - 1, y, y, seed);
      }
      trunk.rect(11, 43, 3, 2, C.w[1]);
      trunk.rect(22, 43, 3, 2, C.w[1]);
      trunk.rect(15, 33, 2, 3, C.w[0]);

      const puffs = [
        [18, 22, 9, 6], [9, 21, 7, 6], [27, 21, 7, 6],
        [18, 14, 11, 9], [10, 13, 7, 7], [26, 12, 7, 7], [17, 7, 8, 6]
      ];
      for (const [cx, cy, rx, ry] of puffs) puff(crown, cx, cy, rx, ry, seed, G);

      for (const x of [6, 9, 13, 20, 25, 29]) {
        const len = 2 + Math.floor(hash(x, 1, seed) * 4);
        for (let i = 0; i < len; i++) crown.set(x, 25 + i, i % 2 ? G[4] : C.bone[1]);
      }
      fruit.push([12, 20], [24, 18], [18, 23], [8, 15], [27, 14]);
    } else if (kind === 1) {
      // spire pine: tiers of dark needles
      for (let y = 34; y <= 44; y++) bark(trunk, 16, 20, y, y, seed);
      trunk.rect(14, 44, 2, 1, C.w[1]);
      trunk.rect(20, 44, 3, 1, C.w[1]);

      const tiers = [[18, 2, 6, 9], [18, 9, 9, 10], [18, 17, 12, 11], [18, 26, 14, 10]];
      for (const [cx, y0, hw, h] of tiers.slice().reverse()) {
        crown.poly([[cx - hw, y0 + h], [cx + hw, y0 + h], [cx, y0]], (x, y) => {
          const nx = (x + 0.5 - cx) / hw;
          const ny = (y - y0) / h;
          let l = -nx * 0.7 - ny * 0.25 + (hash(x, y >> 1, seed) - 0.5) * 0.7;
          if (y === y0 + h - 1) l -= 0.9;
          if (l > 0.55) return G[4];
          return G[l > 0.15 ? 3 : l > -0.3 ? 2 : l > -0.7 ? 1 : 0];
        });
      }
      fruit.push([8, 34], [29, 34], [12, 24], [24, 24]);
    } else {
      // weeping willow: low dome with long drooping strands
      for (let y = 28; y <= 44; y++) {
        const wob = Math.round(Math.sin(y * 0.35) * 1.2);
        bark(trunk, 15 + wob, 20 + wob, y, y, seed);
      }
      trunk.rect(12, 43, 3, 2, C.w[1]);
      trunk.rect(21, 43, 3, 2, C.w[1]);

      for (const [cx, cy, rx, ry] of [[18, 17, 13, 8], [9, 19, 7, 6], [27, 19, 7, 6], [18, 10, 9, 6]]) {
        puff(crown, cx, cy, rx, ry, seed, G);
      }

      for (let x = 5; x <= 31; x++) {
        if (hash(x, 3, seed) < 0.28) continue;
        const edge = Math.abs(x - 18) / 13;
        const len = 5 + Math.floor((1 - edge * 0.5) * 9 * hash(x, 4, seed + 2));
        for (let i = 0; i < len; i++) {
          crown.set(x, 22 + i, i > len - 3 ? G[5] : (x + i) % 3 === 0 ? G[4] : G[3]);
        }
      }
      fruit.push([10, 28], [24, 29], [17, 32], [30, 26]);
    }

    crown.outline(mix(G[0], C.ink, 0.6), 0.55);
    trunk.outline(C.ink, 0.7);

    // sparkly lantern-fruit baked in, twinkles at runtime
    for (const [x, y] of fruit) {
      crown.set(x, y, C.a[2]);
      crown.set(x + 1, y, C.a[1]);
    }

    return {
      trunk: trunk.toCanvas(),
      crown: [
        crown.toCanvas(),
        crown.dissolve(0.8).toCanvas(),
        crown.dissolve(0.55).toCanvas()
      ],
      fruit,
      w: W,
      h: H,
      ax: 18,
      ay: 44
    };
  }

  /* ---------- gold mine (full and depleted) ---------- */
  function mine(empty = false) {
    const W = 50;
    const H = 40;
    const P = new Pix(W, H);

    P.poly([[2, 36], [5, 22], [13, 13], [25, 9], [37, 12], [45, 21], [48, 36]], (x, y) => {
      const ny = (y - 9) / 27;
      const nx = (x - 25) / 23;
      let l = -ny * 0.6 - nx * 0.5 + (hash(x >> 1, y >> 1, 12) - 0.5) * 0.7;
      if ((y + (x >> 3)) % 6 === 0) l -= 0.3;
      return C.s[l > 0.45 ? 4 : l > 0.0 ? 3 : l > -0.4 ? 2 : 1];
    });

    // gold veins (a depleted mine keeps only empty grooves)
    const vein = (x0, y0, x1, y1) => {
      P.line(x0, y0, x1, y1, empty ? C.s[0] : C.gold[0]);
      P.line(x0 + 1, y0, x1 + 1, y1, empty ? C.s[1] : C.gold[1]);
      P.line(x0, y0 - 1, x1, y1 - 1, empty ? C.s[2] : C.gold[2]);
    };
    vein(8, 30, 17, 19);
    vein(33, 17, 43, 28);
    vein(12, 18, 19, 23);

    // timber-framed shaft with a lit interior, or boarded up and dark
    P.rect(21, 18, 14, 3, C.w[2]);
    P.rect(21, 18, 14, 1, C.w[3]);
    P.rect(21, 21, 3, 15, C.w[1]);
    P.rect(32, 21, 3, 15, C.w[2]);
    P.rect(24, 21, 8, 15, C.s[0]);

    if (empty) {
      P.rect(24, 24, 8, 2, C.w[1]);
      P.rect(24, 24, 8, 1, C.w[2]);
      P.rect(24, 30, 8, 2, C.w[1]);
      P.rect(24, 30, 8, 1, C.w[2]);
    } else {
      P.shade(24, 28, 32, 36, (x, y) => (y > 33 ? C.a[2] : C.a[1]));
      P.rect(27, 25, 2, 1, C.a[3]);
    }

    // broken ring carved over the lintel
    for (const [x, y] of [[26, 14], [27, 14], [25, 15], [29, 15], [25, 16], [29, 16], [26, 17], [27, 17], [28, 17]]) {
      P.set(x, y, empty ? C.s[3] : C.a[1]);
    }

    // ore pile + crystals (plain rubble once the gold is gone)
    for (const [x, y] of [[9, 34], [13, 35], [11, 32], [16, 34], [6, 35]]) {
      P.disc(x, y, 2.4, 2, (px, py) => (px < x && py < y ? (empty ? C.s[3] : C.gold[2]) : (empty ? C.s[2] : C.gold[1])));
      if (!empty) P.set(x - 1, y - 1, C.white);
    }
    if (!empty) {
      for (const [x, y, h] of [[39, 12, 7], [42, 14, 5]]) {
        P.poly([[x - 1, y + 4], [x + 2, y + 4], [x + 0.5, y - h + 4]], (px) => (px < x + 0.5 ? C.a[3] : C.a[1]));
      }
    }

    P.outline(C.ink, 0.72);

    return {
      c: P.toCanvas(),
      w: W,
      h: H,
      ax: 25,
      ay: 36,
      sparkle: empty ? [] : [[11, 31], [14, 21], [40, 22], [29, 26], [41, 10]],
      glow: empty ? null : { x: 28, y: 32, r: 9, a: 0.4, color: C.a[2] }
    };
  }

  /* ---------- doodads ---------- */
  const out = {};

  function sprite(name, w, h, ax, ay, fn, extra = {}) {
    const P = new Pix(w, h);
    fn(P);
    P.outline(C.ink, 0.72);
    out[name] = { c: P.toCanvas(), w, h, ax, ay, ...extra };
  }

  function shard(P, x, y, w, h, ramp) {
    P.poly([[x, y], [x + w, y], [x + w - 0.5, y - h + 2], [x + w / 2, y - h], [x + 0.5, y - h + 2]], (px, py) => {
      const t = (px - x) / w;
      return t < 0.38 ? ramp[2] : t < 0.7 ? ramp[1] : ramp[0];
    });
    P.set(x + 1, y - h + 3, ramp[3]);
    P.set(x + 1, y - h + 4, ramp[3]);
  }

  function makeDoodads() {
    sprite("shroomGlow", 14, 12, 7, 11, P => {
      for (const [x, h, r] of [[3, 6, 3], [8, 4, 2.5], [11, 3, 2]]) {
        P.rect(x, 11 - h, 1, h, C.bone[0]);
        P.disc(x + 0.5, 11 - h, r, r * 0.7, (px, py) => (px < x && py < 11 - h ? C.glow[2] : C.glow[1]));
        P.set(x - 1, 11 - h, C.white);
      }
    }, { glow: { x: 7, y: 6, r: 9, a: 0.35, color: C.glow[1] } });

    sprite("shroomRed", 12, 10, 6, 9, P => {
      for (const [x, h, r] of [[3, 4, 3], [8, 3, 2.5]]) {
        P.rect(x, 9 - h, 1, h, C.bone[0]);
        P.disc(x + 0.5, 9 - h, r, r * 0.75, (px, py) => (px < x ? C.cap[1] : C.cap[0]));
        P.set(x - 1, 9 - h - 1, C.bone[0]);
        P.set(x + 1, 9 - h, C.bone[0]);
      }
    });

    sprite("crystalCyan", 18, 20, 9, 19, P => {
      P.rect(2, 17, 14, 2, C.s[2]);
      P.rect(3, 16, 11, 1, C.s[3]);
      shard(P, 7, 17, 4, 15, C.y);
      shard(P, 3, 17, 3, 9, C.y);
      shard(P, 11, 17, 4, 7, C.y);
    }, { glow: { x: 9, y: 9, r: 11, a: 0.4, color: C.y[1] }, sparkle: [[8, 4], [4, 10]] });

    sprite("crystalViolet", 18, 20, 9, 19, P => {
      P.rect(2, 17, 14, 2, C.s[2]);
      P.rect(3, 16, 11, 1, C.s[3]);
      shard(P, 6, 17, 4, 13, C.m);
      shard(P, 11, 17, 3, 8, C.m);
      shard(P, 3, 17, 3, 6, C.m);
    }, { glow: { x: 9, y: 9, r: 11, a: 0.35, color: C.m[2] }, sparkle: [[8, 6]] });

    sprite("stoneA", 16, 11, 8, 10, P => {
      P.poly([[1, 10], [2, 5], [6, 2], [11, 2], [14, 6], [15, 10]], (x, y) => {
        const l = -((y - 2) / 8) * 0.7 - ((x - 8) / 8) * 0.4 + (hash(x, y, 5) - 0.5) * 0.4;
        return C.s[l > 0.35 ? 4 : l > -0.05 ? 3 : l > -0.4 ? 2 : 1];
      });
      P.rect(3, 3, 5, 1, G[3]);
      P.rect(4, 4, 2, 1, G[2]);
    });

    sprite("stoneB", 10, 8, 5, 7, P => {
      P.poly([[1, 7], [1, 4], [4, 1], [8, 2], [9, 7]], (x, y) => (x + y < 7 ? C.s[3] : x + y < 10 ? C.s[2] : C.s[1]));
      P.set(3, 2, G[3]);
    });

    sprite("column", 12, 22, 6, 21, P => {
      P.rect(1, 19, 10, 3, C.s[3]);
      P.rect(1, 19, 10, 1, C.s[5]);
      P.poly([[3, 19], [9, 19], [9, 6], [8, 4], [6, 6], [5, 3], [3, 5]], (x, y) => {
        const t = (x - 3) / 6;
        return t < 0.3 ? C.s[5] : t < 0.65 ? C.s[4] : C.s[2];
      });
      for (const x of [5, 7]) P.line(x, 18, x, 9, C.s[3]);
      P.rect(3, 12, 2, 1, G[3]);
      P.rect(3, 14, 1, 3, G[2]);
      P.set(4, 15, G[4]);
    });

    sprite("columnFallen", 22, 10, 11, 9, P => {
      P.rect(2, 3, 16, 5, C.s[4]);
      P.rect(2, 3, 16, 1, C.s[6]);
      P.rect(2, 7, 16, 1, C.s[2]);
      P.rect(18, 2, 3, 7, C.s[3]);
      P.rect(1, 4, 1, 3, C.s[2]);
      for (const x of [5, 8, 12]) P.line(x, 4, x, 6, C.s[3]);
      P.rect(6, 2, 4, 1, G[3]);
    });

    sprite("monolith", 10, 22, 5, 21, P => {
      P.poly([[1, 21], [2, 3], [5, 0], [8, 3], [9, 21]], (x, y) => {
        const l = -((x - 5) / 4) * 0.6 + (hash(x, y >> 1, 9) - 0.5) * 0.5;
        return C.s[l > 0.3 ? 4 : l > -0.2 ? 3 : 2];
      });
      for (const [x, y] of [[5, 7], [4, 8], [6, 8], [5, 9], [4, 12], [5, 13], [6, 12]]) P.set(x, y, C.y[2]);
      P.rect(2, 15, 3, 1, G[3]);
    }, { glow: { x: 5, y: 9, r: 8, a: 0.3, color: C.y[1] } });

    sprite("stump", 14, 10, 7, 9, P => {
      P.rect(2, 3, 10, 6, C.w[2]);
      P.rect(2, 3, 3, 6, C.w[3]);
      P.rect(10, 3, 2, 6, C.w[1]);
      P.disc(7, 3, 5, 2.2, (x, y) => (hash(x, y, 4) > 0.5 ? C.w[4] : C.d[4]));
      P.ring(7, 3, 3, 1.2, C.w[3], 1);
      P.set(3, 7, G[3]);
      P.set(4, 8, G[2]);
    });

    sprite("fern", 16, 10, 8, 9, P => {
      for (const [x, a] of [[8, 0], [8, -1], [8, 1], [8, -2], [8, 2]]) {
        for (let i = 0; i < 6; i++) {
          P.set(x + a * (i * 0.9 + 1) + 0, 8 - i + Math.abs(a) * Math.floor(i / 2), i > 3 ? G[4] : G[3]);
        }
      }
      for (const x of [3, 5, 11, 13]) P.set(x, 7 + (x % 2), G[2]);
      P.rect(7, 8, 2, 2, G[1]);
    });

    sprite("lanternPost", 10, 30, 5, 29, P => {
      P.rect(4, 6, 2, 24, C.w[2]);
      P.rect(4, 6, 1, 24, C.w[3]);
      P.rect(2, 4, 6, 1, C.w[1]);
      P.rect(3, 5, 4, 1, C.gold[0]);
      P.rect(3, 6, 4, 6, C.gold[0]);
      P.rect(4, 7, 2, 4, C.a[3]);
      P.set(4, 8, C.white);
      P.rect(3, 12, 4, 1, C.gold[0]);
      P.set(5, 3, C.gold[0]);
      P.rect(3, 28, 4, 2, C.s[2]);
    }, { glow: { x: 5, y: 9, r: 13, a: 0.5, color: C.a[2], flicker: true }, ground: { x: 5, y: 28, r: 12, color: C.a[2] } });

    sprite("brazier", 12, 18, 6, 17, P => {
      P.rect(5, 9, 2, 8, C.b[1]);
      P.rect(3, 16, 6, 2, C.b[2]);
      P.rect(2, 7, 8, 3, C.b[3]);
      P.rect(2, 7, 8, 1, C.b[4]);
      P.rect(3, 6, 6, 1, C.r[2]);
    }, { flame: { x: 6, y: 6 }, glow: { x: 6, y: 4, r: 14, a: 0.5, color: C.r[4], flicker: true } });

    sprite("skullStake", 8, 20, 4, 19, P => {
      P.rect(3, 6, 2, 14, C.w[1]);
      P.rect(2, 1, 4, 4, C.bone[0]);
      P.rect(2, 5, 4, 1, C.bone[1]);
      P.set(2, 2, C.b[0]);
      P.set(5, 2, C.b[0]);
      P.set(3, 4, C.b[0]);
      P.set(4, 4, C.b[0]);
      P.set(3, 2, C.r[4]);
      P.set(5, 2, C.r[4]);
    });

    sprite("ribs", 24, 12, 12, 11, P => {
      P.rect(3, 9, 18, 2, C.bone[1]);
      for (let i = 0; i < 5; i++) {
        const x = 5 + i * 3.5;
        P.line(x, 9, x + 1, 3, C.bone[0]);
        P.line(x + 1, 3, x + 3, 2, C.bone[0]);
      }
      P.set(21, 8, C.bone[0]);
    });

    sprite("crates", 18, 14, 9, 13, P => {
      P.rect(1, 5, 9, 8, C.w[2]);
      P.rect(1, 5, 9, 1, C.w[4]);
      P.rect(1, 8, 9, 1, C.w[1]);
      P.line(1, 12, 9, 6, C.w[1]);
      P.disc(14, 8.5, 3, 4.5, (x, y) => (x < 14 ? C.w[3] : C.w[2]));
      P.rect(11, 6, 6, 1, C.s[2]);
      P.rect(11, 10, 6, 1, C.s[2]);
    });

    sprite("signpost", 14, 22, 7, 21, P => {
      P.rect(6, 4, 2, 18, C.w[2]);
      P.poly([[1, 4], [10, 4], [13, 6.5], [10, 9], [1, 9]], (x, y) => (y < 6 ? C.w[4] : C.w[3]));
      P.rect(1, 8, 10, 1, C.w[1]);
      P.set(11, 6, C.r[3]);
      P.set(10, 5, C.r[3]);
      P.set(10, 7, C.r[3]);
    });

    sprite("deadTree", 26, 34, 13, 33, P => {
      P.poly([[10, 33], [11, 18], [13, 12], [15, 18], [17, 33]], (x) => (x < 13 ? C.h[3] : C.h[1]));
      P.line(12, 18, 5, 10, C.h[2]);
      P.line(12, 18, 4, 11, C.h[3]);
      P.line(14, 15, 21, 7, C.h[2]);
      P.line(13, 12, 12, 3, C.h[3]);
      P.line(5, 10, 2, 6, C.h[2]);
      P.line(21, 7, 24, 5, C.h[2]);
      P.line(12, 20, 15, 28, C.r[3]);
      P.set(12, 24, C.r[4]);
      P.set(15, 27, C.r[4]);
    }, { glow: { x: 13, y: 24, r: 8, a: 0.25, color: C.r[3] } });

    sprite("campfire", 16, 12, 8, 11, P => {
      for (const x of [1, 4, 7, 10, 13]) P.rect(x, 8, 3, 3, C.s[x % 3 ? 2 : 3]);
      P.line(4, 9, 11, 6, C.w[2]);
      P.line(4, 6, 11, 9, C.w[3]);
    }, { flame: { x: 8, y: 7 }, glow: { x: 8, y: 6, r: 16, a: 0.5, color: C.a[2], flicker: true } });

    // the great Ringstone: a standing ring, broken at the upper right
    sprite("ringstone", 42, 46, 21, 45, P => {
      const cx = 21;
      const cy = 21;
      const R = 16;
      const thick = 5;

      P.rect(5, 41, 32, 5, C.s[2]);
      P.rect(5, 41, 32, 1, C.s[5]);
      P.rect(8, 38, 26, 3, C.s[3]);
      P.rect(8, 38, 26, 1, C.s[5]);

      for (let y = 0; y < 42; y++) {
        for (let x = 0; x < 42; x++) {
          const dx = x + 0.5 - cx;
          const dy = y + 0.5 - cy;
          const r = Math.hypot(dx, dy);
          if (r > R || r <= R - thick) continue;

          const ang = Math.atan2(dy, dx);
          if (ang > -1.25 && ang < -0.35) continue;

          let l = -(dx * 0.62 + dy * 0.78) / R + (hash(x >> 1, y >> 1, 77) - 0.5) * 0.5;
          if (r > R - 1.2) l += 0.15;
          P.set(x, y, C.s[l > 0.45 ? 5 : l > 0.1 ? 4 : l > -0.3 ? 3 : 2]);
        }
      }

      // moss, runes, fallen chunk
      for (let i = 0; i < 40; i++) {
        const a = Math.PI * (0.55 + hash(i, 1, 6) * 0.9);
        const rr = R - hash(i, 2, 6) * thick;
        const x = Math.round(cx + Math.cos(a) * rr);
        const y = Math.round(cy + Math.sin(a) * rr);
        if (P.get(x, y) >= 0) P.set(x, y, G[2 + (i % 3)]);
      }

      for (let k = 0; k < 9; k++) {
        const a = Math.PI * 0.5 + k * 0.42 + 0.2;
        if (a > Math.PI * 1.45 && a < Math.PI * 1.9) continue;
        const x = Math.round(cx + Math.cos(a) * (R - 2.3));
        const y = Math.round(cy + Math.sin(a) * (R - 2.3));
        if (P.get(x, y) >= 0) {
          P.set(x, y, C.y[2]);
          if (k % 2) P.set(x + 1, y, C.y[1]);
        }
      }

      P.rect(33, 36, 4, 3, C.s[3]);
      P.rect(33, 36, 4, 1, C.s[5]);
      P.rect(30, 38, 3, 2, C.s[2]);
      P.rect(9, 40, 6, 1, G[3]);
    }, { glow: { x: 21, y: 21, r: 20, a: 0.3, color: C.y[1], pulse: true }, sparkle: [[10, 12], [31, 24], [21, 6]] });
  }

  /* ---------- flames ---------- */
  const flameCache = {};

  function flameFrames(w = 7, h = 11) {
    const key = `${w}x${h}`;
    if (flameCache[key]) return flameCache[key];

    const frames = [];

    for (let f = 0; f < 4; f++) {
      const P = new Pix(w, h);
      const lean = Math.sin(f * 1.7) * w * 0.15;
      const hf = 0.82 + 0.18 * Math.sin(f * 2.3 + 1);

      const layer = (s, hs, color) => {
        const hw = w / 2 * s;
        const top = h - h * hs * hf;
        P.poly([
          [w / 2 - hw, h], [w / 2 + hw, h], [w / 2 + hw * 0.9, h - (h - top) * 0.45],
          [w / 2 + lean * s, top], [w / 2 - hw * 0.9, h - (h - top) * 0.45]
        ], color);
      };

      layer(1, 1, C.r[3]);
      layer(0.72, 0.8, C.r[4]);
      layer(0.4, 0.5, C.a[3]);
      P.set(Math.round(w / 2), h - 2, C.a[4]);
      frames.push(P.toCanvas());
    }

    return (flameCache[key] = frames);
  }

  /* ---------- registry ---------- */
  const trees = [];

  function init() {
    if (trees.length) return;
    for (let k = 0; k < 3; k++) trees.push(treeVariant(k));
    makeDoodads();
  }

  init();

  PK.props = {
    trees,
    mine: mine(),
    mineEmpty: mine(true),
    doodads: out,
    flame: flameFrames
  };
})();
