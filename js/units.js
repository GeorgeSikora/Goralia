/*
 * Unit sprites. Every frame is drawn procedurally onto a 32x32 cell with the
 * feet anchored at (16, 29), facing right. Left-facing frames are mirrored
 * copies baked once. Poses are tiny tables, the rig does the rest.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const { C, TEAM, Pix } = PK;

  const CELL = 32;
  const AX = 16;
  const AY = 30;

  const RING_GLYPH = [".XX..", "X...X", "X...X", "X...X", ".XXX."];

  /* ---------- rig kit ---------- */
  function kit(P, team, pose) {
    return {
      P,
      T: TEAM[team],
      pose,
      meta: {},
      px: (x, y, c) => P.set(AX + x, AY + y, c),
      R: (x, y, w, h, c) => P.rect(AX + x, AY + y, w, h, c),
      L: (x0, y0, x1, y1, c) => P.line(AX + x0, AY + y0, AX + x1, AY + y1, c),
      L2: (x0, y0, x1, y1, c) => P.line2(AX + x0, AY + y0, AX + x1, AY + y1, c),
      D: (cx, cy, rx, ry, c) => P.disc(AX + cx, AY + cy, rx, ry, c),
      Q: (pts, c) => P.poly(pts.map(([x, y]) => [AX + x, AY + y]), c),
      Dfn: (cx, cy, rx, ry, fn) => P.disc(
        AX + cx, AY + cy, rx, ry,
        (x, y) => fn((x + 0.5 - AX - cx) / rx, (y + 0.5 - AY - cy) / ry)
      ),
      glyph(x, y, c) {
        RING_GLYPH.forEach((row, r) => {
          for (let i = 0; i < 5; i++) {
            if (row[i] === "X") P.set(AX + x + i, AY + y + r, c);
          }
        });
      }
    };
  }

  function legs(k, H, o) {
    const p = k.pose;

    const one = (hx, fx, lift, col, boot, bootL) => {
      const top = -H - 1;
      const foot = -lift;
      k.L2(hx, top, hx + fx, foot - 2, col);
      k.R(hx + fx, foot - 1, 3, 2, boot);
      k.px(hx + fx, foot - 1, bootL);
    };

    one(-3, p.bx, p.bl, o.clothB, o.boot, o.bootL);
    one(0, p.fx, p.fl, o.clothF, o.boot, o.bootL);
  }

  /* ---------- poses ---------- */
  const STAND = {
    fx: 0, fl: 0, bx: 0, bl: 0, dy: 0, lunge: 0, sw: "idle", cape: 0
  };

  function walkPose(i) {
    const a = i / 6 * Math.PI * 2;
    const s = Math.sin(a);
    const c = Math.cos(a);

    return {
      ...STAND,
      fx: Math.round(3 * s),
      fl: Math.max(0, Math.round(2 * c)),
      bx: Math.round(-3 * s),
      bl: Math.max(0, Math.round(-2 * c)),
      dy: i % 3 === 0 ? -1 : 0,
      sw: "idle",
      cape: i % 2,
      step: i
    };
  }

  const POSES = {
    idle: [
      { ...STAND, cape: 0 },
      { ...STAND, dy: 1, cape: 1 }
    ],
    walk: [0, 1, 2, 3, 4, 5].map(walkPose),
    attack: [
      { ...STAND, lunge: -1, sw: "back", fx: -1, bx: 0, cape: 1 },
      { ...STAND, lunge: 2, sw: "strike", fx: 2, bx: -2, dy: 1, cape: 0 },
      { ...STAND, lunge: 1, sw: "low", fx: 1, bx: -1, cape: 1 }
    ],
    cast: [
      { ...STAND, sw: "up", dy: 0, cape: 1 },
      { ...STAND, sw: "flare", dy: -1, cape: 0 },
      { ...STAND, sw: "fwd", lunge: 1, dy: 0, cape: 1 }
    ]
  };

  /* ---------- the five rigs ---------- */
  function drawSoldier(k) {
    const { T, pose: p } = k;
    const S = C.s;
    const dy = p.dy;
    const lx = p.lunge;

    legs(k, 6, {
      clothB: C.w[0], clothF: C.w[1], boot: S[1], bootL: S[3]
    });

    k.R(lx - 4, dy - 14, 8, 8, S[2]);
    k.R(lx - 4, dy - 14, 1, 8, S[3]);
    k.R(lx + 3, dy - 14, 1, 8, S[1]);
    k.R(lx - 4, dy - 7, 8, 1, C.w[2]);
    k.px(lx - 1, dy - 7, C.gold[1]);

    // helm
    k.R(lx - 3, dy - 21, 6, 6, S[2]);
    k.R(lx - 2, dy - 21, 4, 1, S[4]);
    k.R(lx - 3, dy - 20, 1, 3, S[3]);
    k.R(lx, dy - 19, 3, 1, S[1]);
    k.R(lx, dy - 18, 3, 2, C.skin[0]);
    k.px(lx + 1, dy - 18, C.ink);
    k.R(lx - 2, dy - 16, 5, 1, S[1]);

    // team crest fin
    k.R(lx - 1, dy - 24, 3, 1, T.l);
    k.R(lx - 2, dy - 23, 5, 2, T.m);
    k.R(lx - 3, dy - 22, 1, 1, T.d);
    k.px(lx - 4, dy - 21 + p.cape, T.d);

    // pauldron
    k.R(lx + 2, dy - 15, 3, 3, S[4]);
    k.R(lx + 2, dy - 15, 3, 1, S[5]);

    // shield: team field, steel rim, broken ring
    k.Dfn(lx - 2, dy - 10.5, 4.6, 5, (nx, ny) => {
      const r2 = nx * nx + ny * ny;
      if (r2 > 0.66) return nx + ny < -0.2 ? S[5] : S[3];
      const l = nx + ny;
      return l < -0.5 ? T.l : l > 0.55 ? T.s : T.m;
    });
    k.glyph(lx - 5, dy - 13, T.accent);

    // sword arm
    const hand = { idle: [4, -9], back: [3, -12], strike: [6, -9], low: [5, -8] }[p.sw];
    const tip = { idle: [9, -17], back: [1, -21], strike: [11, -8], low: [11, -2] }[p.sw];
    k.L2(lx + 3, dy - 13, lx + hand[0], dy + hand[1], S[4]);
    k.L2(lx + hand[0], dy + hand[1] - 1, lx + tip[0], dy + tip[1], S[6]);
    k.px(lx + tip[0], dy + tip[1], C.white);
    k.R(lx + hand[0] - 1, dy + hand[1], 4, 1, C.gold[1]);

    k.meta.head = [lx + 1, dy - 18];
  }

  function drawWorker(k) {
    const { T, pose: p } = k;
    const dy = p.dy;
    const lx = p.lunge;

    legs(k, 5, {
      clothB: C.w[0], clothF: C.d[1], boot: C.w[1], bootL: C.w[2]
    });

    // tunic + team apron
    k.R(lx - 3, dy - 11, 7, 6, C.d[2]);
    k.R(lx - 3, dy - 11, 1, 6, C.d[3]);
    k.R(lx + 3, dy - 11, 1, 6, C.d[1]);
    k.R(lx - 1, dy - 10, 3, 5, T.m);
    k.R(lx - 1, dy - 10, 1, 5, T.l);
    k.R(lx - 3, dy - 6, 7, 1, C.w[2]);

    // belt lantern (the faction motif, tiny)
    k.px(lx - 4, dy - 7, C.w[3]);
    k.R(lx - 5, dy - 6, 2, 3, C.a[2]);
    k.px(lx - 5, dy - 6, C.a[4]);
    k.px(lx - 4, dy - 4, C.a[0]);

    // face + scarf
    k.R(lx - 2, dy - 15, 5, 3, C.skin[0]);
    k.R(lx - 2, dy - 15, 5, 1, C.skin[1]);
    k.px(lx + 1, dy - 14, C.ink);
    k.R(lx - 2, dy - 12, 5, 1, T.m);
    k.px(lx - 3, dy - 11, T.d);

    // straw hat
    k.R(lx - 5, dy - 17, 11, 2, C.d[4]);
    k.R(lx - 5, dy - 16, 11, 1, C.d[3]);
    k.R(lx - 3, dy - 18, 7, 1, C.d[4]);
    k.R(lx - 2, dy - 19, 5, 1, C.d[4]);
    k.R(lx - 1, dy - 20, 3, 1, C.d[5]);
    k.px(lx, dy - 21, C.d[5]);
    k.R(lx - 5, dy - 17, 4, 1, C.d[5]);
    k.px(lx + 5, dy - 17, C.d[2]);
    k.R(lx - 2, dy - 18, 5, 1, T.d);

    // pickaxe
    const pick = {
      idle: { h: [4, -8], t: [8, -17], a: [4, -19, 11, -15] },
      back: { h: [3, -10], t: [0, -22], a: [-4, -21, 3, -23] },
      strike: { h: [6, -9], t: [12, -6], a: [11, -11, 14, -3] },
      low: { h: [5, -8], t: [11, -3], a: [10, -8, 13, -1] },
      up: { h: [4, -8], t: [8, -17], a: [4, -19, 11, -15] }
    }[p.sw] || {};

    if (pick.h) {
      k.L2(lx + 3, dy - 10, lx + pick.h[0], dy + pick.h[1], C.skin[1]);
      k.L(lx + pick.h[0], dy + pick.h[1], lx + pick.t[0], dy + pick.t[1], C.w[3]);
      k.L(lx + pick.a[0], dy + pick.a[1], lx + pick.a[2], dy + pick.a[3], C.s[5]);
      k.px(lx + pick.a[2], dy + pick.a[3], C.white);
    }

    k.meta.head = [lx + 1, dy - 14];
  }

  function drawArcher(k) {
    const { T, pose: p } = k;
    const G = [0x2a2150, 0x3c2a6b, 0x5a3f94, 0x7a5cb8];
    const dy = p.dy;
    const lx = p.lunge;
    const draw = p.sw === "back";

    legs(k, 7, {
      clothB: G[0], clothF: G[1], boot: C.w[1], bootL: C.w[3]
    });

    // cloak behind
    k.R(lx - 6, dy - 14, 3, 8 + p.cape, G[1]);
    k.R(lx - 6, dy - 14, 1, 8 + p.cape, G[0]);
    k.px(lx - 7, dy - 7 + p.cape, G[0]);

    // quiver
    k.R(lx - 5, dy - 15, 2, 6, C.w[2]);
    k.px(lx - 5, dy - 16, T.l);
    k.px(lx - 4, dy - 17, C.bone[0]);
    k.px(lx - 5, dy - 17, T.m);

    // tunic
    k.R(lx - 3, dy - 14, 6, 6, G[2]);
    k.R(lx - 3, dy - 14, 1, 6, G[3]);
    k.R(lx + 2, dy - 14, 1, 6, G[1]);
    k.R(lx - 3, dy - 9, 6, 1, C.w[2]);
    k.px(lx, dy - 9, C.gold[1]);

    // hood
    k.R(lx - 3, dy - 20, 6, 6, G[2]);
    k.R(lx - 2, dy - 20, 4, 1, G[3]);
    k.R(lx - 3, dy - 19, 1, 4, G[3]);
    k.px(lx - 4, dy - 17, G[1]);
    k.px(lx - 5, dy - 16 + p.cape, G[1]);
    k.R(lx, dy - 18, 3, 3, C.skin[1]);
    k.R(lx + 1, dy - 17, 2, 2, C.skin[0]);
    k.px(lx + 2, dy - 17, C.ink);
    k.R(lx - 3, dy - 14, 6, 1, T.m);
    k.px(lx - 4, dy - 13 + p.cape, T.l);

    // feather in hood
    k.px(lx - 3, dy - 21, T.l);
    k.px(lx - 4, dy - 22, T.m);

    // bow
    const bx = lx + 7;
    const bow = [[-2, -25], [0, -23], [1, -20], [1, -16], [1, -12], [1, -8], [0, -5], [-2, -3]];
    for (let i = 0; i < bow.length - 1; i++) {
      k.L(bx + bow[i][0], dy + bow[i][1], bx + bow[i + 1][0], dy + bow[i + 1][1], C.w[3]);
    }
    k.px(bx + 1, dy - 16, C.w[4]);
    k.px(bx + 1, dy - 17, C.w[4]);

    const pull = draw ? -5 : 0;
    k.L(bx - 2, dy - 25, bx - 2 + pull, dy - 14, C.bone[0]);
    k.L(bx - 2 + pull, dy - 14, bx - 2, dy - 3, C.bone[0]);

    // arms
    k.L2(lx + 1, dy - 13, bx - 1, dy - 14, C.skin[1]);
    if (draw) {
      k.L(bx - 2 + pull, dy - 14, bx + 6, dy - 14, C.w[4]);
      k.px(bx + 7, dy - 14, C.s[5]);
      k.px(bx - 1 + pull, dy - 15, T.l);
      k.px(bx - 1 + pull, dy - 13, T.l);
    }

    k.meta.head = [lx + 2, dy - 17];
  }

  function drawHero(k) {
    const { T, pose: p } = k;
    const dy = p.dy;
    const lx = p.lunge;
    const tealD = C.t[0];
    const teal = C.t[1];
    const tealM = C.t[2];

    // cape (team blue, amber hem)
    const flow = p.cape;
    k.R(lx - 7, dy - 18, 4, 12 + flow, T.s);
    k.R(lx - 6, dy - 17, 3, 11 + flow, T.m);
    k.R(lx - 7, dy - 18, 1, 12 + flow, T.d);
    k.R(lx - 8, dy - 7 + flow, 2, 1, T.d);
    k.R(lx - 7, dy - 7 + flow, 4, 1, T.accent);

    legs(k, 8, {
      clothB: tealD, clothF: teal, boot: C.w[1], bootL: C.gold[1]
    });

    // armour
    k.R(lx - 4, dy - 17, 8, 8, tealM);
    k.R(lx - 4, dy - 17, 1, 8, C.t[3]);
    k.R(lx + 3, dy - 17, 1, 8, teal);
    k.R(lx - 4, dy - 10, 8, 1, C.gold[0]);
    k.px(lx - 1, dy - 10, C.gold[2]);
    k.glyph(lx - 3, dy - 16, C.a[3]);
    k.px(lx - 1, dy - 14, C.a[0]);

    // gold pauldrons
    k.R(lx - 6, dy - 18, 3, 3, C.gold[1]);
    k.R(lx - 6, dy - 18, 3, 1, C.gold[2]);
    k.R(lx + 3, dy - 18, 3, 3, C.gold[0]);

    // head
    k.R(lx - 3, dy - 24, 6, 6, C.skin[0]);
    k.R(lx - 4, dy - 24, 2, 7, C.s[5]);
    k.R(lx - 5, dy - 23 + flow, 1, 6, C.s[4]);
    k.R(lx - 3, dy - 24, 6, 1, C.s[5]);
    k.R(lx - 2, dy - 25, 4, 1, C.s[6]);
    k.R(lx + 1, dy - 21, 2, 1, C.a[3]);
    k.px(lx + 2, dy - 21, C.a[4]);
    k.R(lx - 3, dy - 23, 6, 1, C.gold[1]);
    k.px(lx + 1, dy - 24, C.a[3]);
    k.px(lx, dy - 25, C.gold[2]);
    k.R(lx - 2, dy - 18, 5, 1, C.skin[1]);

    // lantern staff
    const st = {
      idle: [6, 0], up: [6, -1], flare: [6, -2], fwd: [8, 0],
      back: [3, -1], strike: [9, 1], low: [8, 0]
    }[p.sw] || [6, 0];
    const sx = lx + st[0];
    const topY = dy - 20 + st[1];
    k.L(sx, dy - 3, sx, topY, C.w[3]);
    k.px(sx, dy - 3, C.w[1]);

    // lantern: brass cage around a warm core
    const lxp = sx - 2;
    k.R(lxp, topY - 5, 5, 6, C.gold[0]);
    k.R(lxp + 1, topY - 4, 3, 4, p.sw === "flare" ? C.a[4] : C.a[3]);
    k.px(lxp + 2, topY - 3, C.white);
    k.px(lxp + 2, topY - 6, C.gold[1]);
    k.R(lxp + 1, topY - 6, 3, 1, C.gold[1]);
    k.px(lxp + 2, topY - 7, C.gold[0]);
    k.meta.lantern = [lxp + 2, topY - 3];

    // arm holding the staff
    k.L2(lx + 3, dy - 15, sx - 1, dy - 11, C.t[3]);
    k.R(sx - 1, dy - 12, 3, 2, C.skin[0]);

    // free hand during casts
    if (p.sw === "up" || p.sw === "flare" || p.sw === "fwd") {
      const hx = lx + 9;
      const hy = dy - 15;
      k.L2(lx + 2, dy - 15, hx, hy, C.t[3]);
      k.R(hx, hy - 1, 2, 3, C.skin[0]);
      if (p.sw !== "up") {
        k.R(hx + 2, hy - 2, 2, 3, C.r[4]);
        k.px(hx + 3, hy - 1, C.r[5]);
      }
    }

    k.meta.head = [lx + 1, dy - 21];
  }

  function drawRaider(k) {
    const { T, pose: p } = k;
    const B = C.b;
    const H = C.h;
    const dy = p.dy;
    const lx = p.lunge + 1;
    const f = p.cape;

    // banner pole with a ragged pennant
    const px0 = lx - 7;
    k.L(px0, dy - 25, px0, dy - 9, C.w[1]);
    k.px(px0, dy - 26, C.r[5]);
    k.R(px0 - 5, dy - 25 + f, 5, 3, T.m);
    k.R(px0 - 5, dy - 25 + f, 5, 1, T.l);
    k.px(px0 - 6, dy - 23 + f, T.s);
    k.px(px0 - 3, dy - 22 + f, T.d);

    legs(k, 6, {
      clothB: B[0], clothF: B[1], boot: B[0], bootL: B[4]
    });

    // crimson tunic under an iron breastplate
    k.R(lx - 4, dy - 14, 8, 8, T.m);
    k.R(lx - 4, dy - 14, 1, 8, T.l);
    k.R(lx + 3, dy - 14, 1, 8, T.s);
    k.R(lx - 3, dy - 13, 5, 4, B[3]);
    k.R(lx - 3, dy - 13, 5, 1, B[4]);
    k.px(lx - 2, dy - 11, C.r[4]);
    k.px(lx - 1, dy - 10, C.r[3]);
    k.px(lx + 1, dy - 12, C.r[3]);
    k.R(lx - 4, dy - 7, 8, 1, B[0]);
    k.px(lx, dy - 7, C.bone[0]);

    // spiked pauldrons
    k.R(lx - 6, dy - 15, 4, 3, B[3]);
    k.R(lx - 6, dy - 15, 4, 1, B[4]);
    k.px(lx - 6, dy - 17, B[4]);
    k.px(lx - 4, dy - 17, B[4]);
    k.px(lx - 5, dy - 16, B[4]);
    k.R(lx + 3, dy - 15, 3, 3, B[3]);
    k.px(lx + 5, dy - 17, B[4]);
    k.px(lx + 4, dy - 16, B[4]);

    // ash-grey face in an iron helm, glowing ember eyes
    k.R(lx - 3, dy - 21, 6, 6, H[4]);
    k.R(lx - 3, dy - 21, 6, 3, B[3]);
    k.R(lx - 2, dy - 21, 3, 1, B[4]);
    k.R(lx, dy - 19, 3, 2, B[0]);
    k.px(lx + 1, dy - 18, C.r[4]);
    k.px(lx + 2, dy - 18, C.r[5]);
    k.R(lx - 3, dy - 18, 3, 3, H[3]);
    k.R(lx, dy - 16, 3, 1, B[0]);
    k.px(lx + 2, dy - 15, C.bone[0]);

    // horns: bone, curving up and outward
    for (const [x, y] of [[-4, -20], [-5, -21], [-6, -22], [-6, -23], [-5, -24]]) {
      k.px(lx + x, dy + y, C.bone[0]);
    }
    for (const [x, y] of [[3, -20], [4, -21], [5, -22], [5, -23], [4, -24]]) {
      k.px(lx + x, dy + y, C.bone[1]);
    }
    k.px(lx - 4, dy - 21, C.bone[1]);

    // heavy cleaver, hot along its edge
    const hand = { idle: [6, -8], back: [3, -13], strike: [6, -8], low: [6, -6] }[p.sw];
    const ang = { idle: -0.85, back: -2.2, strike: 0.2, low: 0.7 }[p.sw];
    const hx = lx + hand[0];
    const hy = dy + hand[1];
    const dx = Math.cos(ang);
    const dyv = Math.sin(ang);
    const nx = -dyv;
    const ny = dx;
    const bx = hx + dx * 4;
    const by = hy + dyv * 4;
    const tx = bx + dx * 7;
    const ty = by + dyv * 7;

    k.L2(lx + 3, dy - 13, hx, hy, B[3]);
    k.L(hx, hy, bx, by, C.w[2]);
    k.Q([
      [bx + nx * 1.8, by + ny * 1.8], [bx + dx * 4 + nx * 2.8, by + dyv * 4 + ny * 2.8],
      [tx + nx * 1.2, ty + ny * 1.2], [tx - nx * 1.2, ty - ny * 1.2],
      [bx + dx * 4 - nx * 2.8, by + dyv * 4 - ny * 2.8], [bx - nx * 1.8, by - ny * 1.8]
    ], C.s[4]);
    k.L(bx - nx * 1.8, by - ny * 1.8, tx - nx * 1.2, ty - ny * 1.2, C.s[6]);
    k.px(Math.round(tx), Math.round(ty), C.r[5]);

    k.meta.head = [lx + 2, dy - 17];
    k.meta.eye = [lx + 1, dy - 18];
  }

  /* ---------- nemrtví z pekla ---------- */
  // Ghúl: shrbený, šedozelená hnijící kůže, dlouhé drápy, týmový bederní hadr.
  function drawGhoul(k) {
    const { T, pose: p } = k;
    const G = [0x232b26, 0x3c4a40, 0x5a6c58, 0x7f9479, 0xa3b59a];
    const dy = p.dy;
    const lx = p.lunge;

    legs(k, 5, { clothB: G[1], clothF: G[2], boot: G[1], bootL: G[3] });

    // zadní paže visí dolů
    k.L2(lx - 3, dy - 11, lx - 3 + (p.sw === "back" ? -2 : 0), dy - 5, G[1]);

    // shrbený trup nakloněný dopředu
    k.Q([[lx - 6, dy - 6], [lx + 3, dy - 6], [lx + 5, dy - 12], [lx + 1, dy - 16], [lx - 4, dy - 16], [lx - 7, dy - 12]], G[2]);
    k.R(lx - 6, dy - 13, 2, 6, G[3]);
    k.R(lx - 4, dy - 16, 4, 1, G[3]);
    for (const [x, y] of [[-4, -17], [-2, -17], [0, -17]]) k.px(lx + x, dy + y, G[4]); // páteř
    for (const y of [-11, -9]) k.R(lx - 1, dy + y, 3, 1, G[1]); // žebra
    k.px(lx + 2, dy - 13, C.r[1]); // rána
    k.px(lx + 3, dy - 12, C.r[2]);

    // týmový hadr
    k.R(lx - 5, dy - 7, 8, 2, T.m);
    k.R(lx - 5, dy - 7, 8, 1, T.l);
    k.px(lx - 2, dy - 5, T.d);
    k.px(lx + 1, dy - 5 + p.cape, T.d);

    // hlava nízko vpředu, otevřená tlama
    const hx = lx + 3;
    const hy = dy - 18;
    k.R(hx, hy, 6, 5, G[2]);
    k.R(hx, hy, 6, 1, G[3]);
    k.R(hx + 1, hy - 1, 3, 1, G[3]);
    k.R(hx + 2, hy + 4, 5, 2, G[1]);
    k.px(hx + 3, hy + 4, C.bone[0]);
    k.px(hx + 5, hy + 4, C.bone[0]);
    k.px(hx + 4, hy + 5, C.bone[1]);
    k.px(hx + 6, hy + 2, C.ink);
    k.meta.eye = [hx + 4, hy + 2];

    // přední paže s drápy
    const hand = { idle: [7, -7], back: [2, -17], strike: [11, -10], low: [10, -4] }[p.sw] || [7, -7];
    k.L2(lx + 2, dy - 13, lx + hand[0], dy + hand[1], G[2]);
    const cx = lx + hand[0] + 1;
    const cy = dy + hand[1];
    for (const o of [-1, 1, 3]) k.L(cx, cy, cx + 3, cy + o, C.bone[0]);

    k.meta.head = [hx + 3, hy + 2];
  }

  // Kostlivý střelec: kosti, lebka s žhnoucíma očima, rezavý luk, týmový šátek.
  function drawSkeleton(k) {
    const { T, pose: p } = k;
    const B = C.bone;
    const dy = p.dy;
    const lx = p.lunge;
    const draw = p.sw === "back";

    legs(k, 7, { clothB: B[2], clothF: B[1], boot: B[2], bootL: B[0] });

    // pánev, páteř, žebra
    k.R(lx - 3, dy - 9, 6, 2, B[1]);
    k.R(lx - 3, dy - 9, 6, 1, B[0]);
    k.R(lx - 1, dy - 17, 2, 8, B[1]);
    for (const y of [-16, -14, -12]) {
      k.R(lx - 3, dy + y, 6, 1, B[0]);
      k.px(lx - 3, dy + y + 1, B[2]);
      k.px(lx + 2, dy + y + 1, B[2]);
    }

    // týmový cár přes rameno a toulec
    k.R(lx - 4, dy - 18, 7, 2, T.m);
    k.R(lx - 4, dy - 18, 7, 1, T.l);
    k.px(lx - 5, dy - 16 + p.cape, T.d);
    k.px(lx - 6, dy - 15 + p.cape, T.s);
    k.R(lx - 6, dy - 17, 2, 6, C.w[1]);
    k.px(lx - 6, dy - 18, C.bone[1]);
    k.px(lx - 5, dy - 19, C.r[3]);

    // lebka
    k.R(lx - 2, dy - 24, 6, 5, B[0]);
    k.R(lx - 2, dy - 24, 6, 1, 0xf2ead8);
    k.R(lx - 2, dy - 20, 1, 1, B[1]);
    k.R(lx, dy - 22, 2, 2, C.ink);
    k.R(lx + 3, dy - 22, 1, 2, C.ink);
    k.R(lx, dy - 19, 4, 1, B[1]);
    k.px(lx + 1, dy - 19, C.ink);
    k.px(lx + 3, dy - 19, C.ink);
    k.meta.eye = [lx + 1, dy - 22];

    // rezavý luk
    const bx = lx + 7;
    const bow = [[-2, -25], [0, -23], [1, -20], [1, -16], [1, -12], [1, -8], [0, -5], [-2, -3]];
    for (let i = 0; i < bow.length - 1; i++) {
      k.L(bx + bow[i][0], dy + bow[i][1], bx + bow[i + 1][0], dy + bow[i + 1][1], C.w[1]);
    }
    k.px(bx + 1, dy - 16, C.r[2]);
    k.px(bx + 1, dy - 12, C.r[1]);

    const pull = draw ? -5 : 0;
    k.L(bx - 2, dy - 25, bx - 2 + pull, dy - 14, B[2]);
    k.L(bx - 2 + pull, dy - 14, bx - 2, dy - 3, B[2]);
    k.L(lx + 1, dy - 15, bx - 1, dy - 14, B[1]);

    if (draw) {
      k.L(bx - 2 + pull, dy - 14, bx + 6, dy - 14, C.w[3]);
      k.px(bx + 7, dy - 14, C.r[4]);
    }

    k.meta.head = [lx + 2, dy - 21];
  }

  // Zrůda: obří sešité tělo, malá hlava, hák na řetězu a sekáček; týmová zástěra.
  function drawAbomination(k) {
    const { T, pose: p } = k;
    const F = [0x2d3529, 0x46553f, 0x667a5a, 0x8aa07a, 0xb2c4a0];
    const dy = p.dy;
    const lx = p.lunge;

    // krátké tlusté nohy
    k.R(lx - 7 + p.bx, dy - 6 - p.bl, 5, 6, F[1]);
    k.R(lx - 7 + p.bx, dy - 1 - p.bl, 5, 1, F[0]);
    k.R(lx + 2 + p.fx, dy - 6 - p.fl, 5, 6, F[2]);
    k.R(lx + 2 + p.fx, dy - 1 - p.fl, 5, 1, F[1]);

    // zadní paže s hákem na řetězu
    k.L2(lx - 8, dy - 17, lx - 11, dy - 9, F[1]);
    k.L(lx - 11, dy - 9, lx - 12, dy - 4 + p.cape, C.s[2]);
    k.L(lx - 12, dy - 4 + p.cape, lx - 13, dy - 2 + p.cape, C.s[4]);
    k.px(lx - 14, dy - 3 + p.cape, C.s[4]);

    // obří břicho se stehy
    k.Dfn(lx, dy - 14, 10, 9.5, (nx, ny) => {
      const l = nx * 0.6 + ny;
      return l < -0.6 ? F[4] : l < -0.1 ? F[3] : l < 0.5 ? F[2] : F[1];
    });
    for (let y = -21; y <= -8; y += 2) k.px(lx + 1, dy + y, C.r[1]);
    for (let y = -21; y <= -8; y += 4) { k.px(lx, dy + y, C.r[0]); k.px(lx + 2, dy + y, C.r[0]); }
    k.L(lx - 7, dy - 16, lx - 3, dy - 12, C.r[1]);
    k.px(lx - 6, dy - 15, C.bone[1]);
    k.px(lx + 6, dy - 18, C.r[2]); // rána
    k.px(lx + 7, dy - 17, C.r[3]);

    // zástěra v barvě týmu
    k.R(lx - 6, dy - 10, 12, 4, T.m);
    k.R(lx - 6, dy - 10, 12, 1, T.l);
    k.R(lx + 5, dy - 10, 1, 4, T.s);
    k.px(lx - 3, dy - 7, C.r[2]);

    // malá hlava zapadlá v ramenou
    k.R(lx + 1, dy - 26, 6, 5, F[3]);
    k.R(lx + 1, dy - 26, 6, 1, F[4]);
    k.R(lx + 4, dy - 23, 3, 1, C.ink);
    k.px(lx + 5, dy - 22, C.bone[0]);
    k.R(lx + 1, dy - 22, 2, 1, C.r[1]);
    k.meta.eye = [lx + 4, dy - 24];

    // přední paže se sekáčkem
    const hand = { idle: [10, -12], back: [6, -22], strike: [12, -10], low: [11, -6] }[p.sw] || [10, -12];
    const ang = { idle: -1.2, back: -2.4, strike: 0.1, low: 0.6 }[p.sw] || -1.2;
    const hx = lx + hand[0];
    const hy = dy + hand[1];
    k.L2(lx + 7, dy - 17, hx, hy, F[2]);
    const tx = hx + Math.cos(ang) * 8;
    const ty = hy + Math.sin(ang) * 8;
    k.L(hx, hy, tx, ty, C.s[4]);
    k.L(hx + 1, hy, tx + 1, ty, C.s[3]);
    k.L(hx + 2, hy + 1, tx + 2, ty + 1, C.s[5]);
    k.px(Math.round(tx + 1), Math.round(ty), C.r[3]);

    k.meta.head = [lx + 4, dy - 23];
  }

  // Přízrak (banshee): vznášející se cár mlhy, bílé vlasy, natažené ruce, týmová šerpa.
  function drawBanshee(k) {
    const { T, pose: p } = k;
    const Y = [0x23465a, 0x3f7f94, 0x76b8c8, 0xb4e4ea, 0xe8fbfb];
    const lift = 3 + (p.step != null ? (p.step % 2) : p.dy);
    const dy = p.dy - lift;
    const lx = p.lunge;
    const f = p.cape;

    // roztřepený konec šatu (cáry mlhy)
    for (const [x, len] of [[-5, 4], [-3, 6], [-1, 5], [1, 7], [3, 4]]) {
      k.L(lx + x, dy - 4, lx + x - 1 - f, dy - 4 + len, x % 2 ? Y[1] : Y[2]);
    }

    // šat zúžený dolů
    k.Q([[lx - 6, dy - 3], [lx + 5, dy - 3], [lx + 3, dy - 15], [lx - 3, dy - 15]], (x, y) => {
      const t = (y - (30 + dy - 15)) / 12;
      return x < 16 + lx - 2 ? Y[3] : t > 0.6 ? Y[1] : Y[2];
    });
    k.R(lx - 4, dy - 11, 8, 1, T.m);
    k.R(lx - 4, dy - 11, 8, 1, T.l);
    k.px(lx - 5, dy - 10 + f, T.d);

    // vlasy vlají dozadu
    k.R(lx - 6, dy - 21, 4, 9 + f, Y[4]);
    k.R(lx - 7, dy - 18, 1, 6 + f, Y[3]);
    k.px(lx - 8, dy - 14 + f, Y[3]);

    // hlava: bledá tvář, prázdné oči, otevřená ústa
    k.R(lx - 2, dy - 22, 6, 6, Y[4]);
    k.R(lx - 3, dy - 22, 3, 3, Y[4]);
    k.R(lx + 1, dy - 20, 1, 2, C.ink);
    k.R(lx + 3, dy - 20, 1, 2, C.ink);
    k.R(lx + 2, dy - 17, 2, 2, Y[0]);
    k.meta.eye = [lx + 1, dy - 19];

    // ruce natažené k cíli
    const hand = { idle: [6, -12], back: [2, -18], strike: [10, -14], low: [9, -10] }[p.sw] || [6, -12];
    k.L(lx + 2, dy - 14, lx + hand[0], dy + hand[1], Y[3]);
    k.L(lx + 2, dy - 13, lx + hand[0], dy + hand[1] + 1, Y[2]);
    k.px(lx + hand[0] + 1, dy + hand[1] - 1, Y[4]);
    k.px(lx + hand[0] + 1, dy + hand[1] + 1, Y[4]);

    k.meta.head = [lx + 1, dy - 19];
  }

  // Pekelný lich: vysoká kostra v rudo-černé róbě, rohatá koruna, hůl se žhnoucí lebkou.
  function drawLich(k) {
    const { T, pose: p } = k;
    const B = C.b;
    const dy = p.dy;
    const lx = p.lunge;
    const f = p.cape;

    // plášť vzadu
    k.R(lx - 8, dy - 18, 4, 16 + f, B[1]);
    k.R(lx - 8, dy - 18, 1, 16 + f, B[0]);
    k.R(lx - 9, dy - 3 + f, 3, 1, T.d);

    // dlouhá róba až na zem
    k.Q([[lx - 6, dy], [lx + 6, dy], [lx + 4, dy - 17], [lx - 4, dy - 17]], x => {
      const rel = x - (16 + lx);
      return rel < -2 ? B[3] : rel > 2 ? B[1] : B[2];
    });
    k.R(lx - 6, dy - 1, 12, 1, T.m);
    k.R(lx - 1, dy - 16, 2, 15, T.d);
    k.R(lx - 5, dy - 9, 10, 1, C.gold[0]);
    k.px(lx, dy - 9, C.r[4]);
    for (const [x, y] of [[-3, -6], [3, -4], [-2, -13], [2, -14]]) k.px(lx + x, dy + y, C.r[3]);

    // ramena s kostěnými trny
    k.R(lx - 6, dy - 18, 12, 3, B[3]);
    k.R(lx - 6, dy - 18, 12, 1, B[4]);
    for (const x of [-6, -4, 3, 5]) k.px(lx + x, dy - 19, C.bone[0]);

    // lebka a koruna s rohy
    k.R(lx - 2, dy - 24, 6, 6, C.bone[0]);
    k.R(lx - 2, dy - 24, 6, 1, 0xf2ead8);
    k.R(lx, dy - 22, 1, 2, C.ink);
    k.R(lx + 2, dy - 22, 2, 2, C.ink);
    k.R(lx, dy - 19, 4, 1, C.bone[1]);
    k.R(lx - 3, dy - 26, 8, 2, C.gold[0]);
    k.px(lx - 1, dy - 27, C.gold[1]);
    k.px(lx + 1, dy - 28, C.gold[2]);
    k.px(lx + 3, dy - 27, C.gold[1]);
    for (const [x, y] of [[-4, -27], [-5, -28], [-5, -29]]) k.px(lx + x, dy + y, C.bone[1]);
    for (const [x, y] of [[5, -27], [6, -28], [6, -29]]) k.px(lx + x, dy + y, C.bone[1]);
    k.meta.eye = [lx + 2, dy - 22];

    // hůl se žhnoucí lebkou
    const st = { idle: [8, 0], up: [8, -1], flare: [8, -2], fwd: [10, -1], back: [5, -1], strike: [10, 1], low: [9, 0] }[p.sw] || [8, 0];
    const sx = lx + st[0];
    const top = dy - 20 + st[1];
    k.L(sx, dy - 1, sx, top, C.w[1]);
    k.R(sx - 2, top - 4, 5, 4, C.bone[0]);
    k.px(sx - 1, top - 3, C.ink);
    k.px(sx + 1, top - 3, C.ink);
    k.R(sx - 1, top - 6, 3, 2, p.sw === "flare" ? C.r[5] : C.r[4]);
    k.px(sx, top - 7, C.r[5]);
    k.meta.lantern = [sx, top - 5];
    k.L2(lx + 3, dy - 15, sx - 1, dy - 11, B[2]);
    k.R(sx - 1, dy - 12, 2, 2, C.bone[0]);

    // volná ruka při kouzlu
    if (p.sw === "up" || p.sw === "flare" || p.sw === "fwd") {
      k.L2(lx - 3, dy - 15, lx - 7, dy - 22, B[2]);
      k.R(lx - 8, dy - 24, 2, 2, C.bone[0]);
      if (p.sw !== "up") {
        k.R(lx - 9, dy - 27, 3, 3, C.r[4]);
        k.px(lx - 8, dy - 26, C.r[5]);
      }
    }

    k.meta.head = [lx + 1, dy - 21];
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

      out[anim] = poses.map(pose => {
        const P = new Pix(CELL, CELL);
        const k = kit(P, team, pose);
        RIGS[type](k);
        P.outline(C.ink, 0.78);

        const pf = P.flipX();
        const meta = { ...k.meta };

        return {
          pix: P,
          pixf: pf,
          c: P.toCanvas(),
          cf: pf.toCanvas(),
          meta,
          flash: null,
          flashf: null
        };
      });
    }

    return out;
  }

  function frame(type, team, anim, i) {
    const key = `${type}|${team}`;
    const set = store[key] || (store[key] = build(type, team));

    let list = set[anim];
    if (!list) list = set.idle;

    return list[((i % list.length) + list.length) % list.length];
  }

  function frameCount(anim) {
    return POSES[anim].length;
  }

  /* White-hot hit flash (cached per frame). */
  function flash(rec, flip) {
    const k = flip ? "flashf" : "flash";

    if (!rec[k]) {
      rec[k] = (flip ? rec.pixf : rec.pix).tint(0xffffff, 0.72).toCanvas();
    }

    return rec[k];
  }

  /* Fallen sprite for the death animation: topple 90 degrees, cached. */
  function lying(type, team, flip) {
    const key = `${type}|${team}|lying|${flip ? 1 : 0}`;

    if (!store[key]) {
      const rec = frame(type, team, "idle", 0);
      const base = flip ? rec.pixf : rec.pix;
      const rot = flip ? base.rot90().flipX() : base.rot90();
      store[key] = { pix: rot, c: rot.toCanvas() };
    }

    return store[key];
  }

  function dissolved(rec, keep) {
    const q = Math.round(keep * 4);
    rec.dis = rec.dis || {};

    if (!rec.dis[q]) rec.dis[q] = rec.pix.dissolve(q / 4).toCanvas();
    return rec.dis[q];
  }

  const PORTRAIT_CROP = {
    worker: [AX - 10, AY - 25],
    soldier: [AX - 10, AY - 26],
    archer: [AX - 10, AY - 27],
    hero: [AX - 10, AY - 29],
    raider: [AX - 10, AY - 26],
    ghoul: [AX - 8, AY - 22],
    skeleton: [AX - 10, AY - 27],
    abomination: [AX - 10, AY - 29],
    banshee: [AX - 11, AY - 28],
    lich: [AX - 10, AY - 28]
  };

  const portraitCache = {};

  function portrait(type, team, frameIndex = 0) {
    const key = `${type}|${team}|${frameIndex}`;

    if (!portraitCache[key]) {
      const rec = frame(type, team, "idle", frameIndex);
      const [cx, cy] = PORTRAIT_CROP[type];
      portraitCache[key] = rec.pix.crop(cx, cy, 20, 20).scale(2).toCanvas();
    }

    return portraitCache[key];
  }

  /* Small carried goods drawn on a worker's back. */
  const carry = {};

  {
    const gold = new Pix(7, 7);
    gold.disc(3.5, 3.8, 3, 3, C.d[3]);
    gold.rect(2, 0, 3, 1, C.d[1]);
    gold.set(3, 3, C.gold[2]);
    gold.set(4, 4, C.gold[1]);
    gold.set(2, 4, C.gold[1]);
    gold.outline(C.ink, 0.75);
    carry.gold = gold.toCanvas();

    const wood = new Pix(9, 8);
    wood.rect(0, 1, 8, 2, C.w[3]);
    wood.rect(1, 4, 8, 2, C.w[2]);
    wood.set(0, 1, C.w[4]);
    wood.set(7, 2, C.w[1]);
    wood.rect(1, 4, 1, 2, C.w[4]);
    wood.rect(3, 0, 1, 7, C.d[3]);
    wood.outline(C.ink, 0.75);
    carry.wood = wood.toCanvas();
  }

  PK.units = {
    CELL, AX, AY, frame, frameCount, flash, lying, dissolved, portrait, carry,
    types: Object.keys(RIGS)
  };
})();
