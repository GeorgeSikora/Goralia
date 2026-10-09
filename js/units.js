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

  const RIGS = {
    soldier: drawSoldier,
    worker: drawWorker,
    archer: drawArcher,
    hero: drawHero,
    raider: drawRaider
  };

  /* ---------- atlas ---------- */
  const store = {};

  function build(type, team) {
    const out = {};

    for (const [anim, poses] of Object.entries(POSES)) {
      if (anim === "cast" && type !== "hero") continue;

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
    raider: [AX - 10, AY - 26]
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
