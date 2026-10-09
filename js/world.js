/*
 * The world: baked terrain, animated water, grass sway, doodad placement
 * and the atmosphere layers (cloud shadows, mist, vignette, light glows).
 * Art coordinates are 1 px = 2 logical game units.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const { C, Pix, mix, hash, fbm, vnoise, tnoise, bayer, dither, clamp, smooth, rng, makeCanvas } = PK;

  const W = 480;
  const H = 240;
  const G = C.g;
  const D = C.d;
  const S = C.s;
  const A = C.h;

  const Z_GRASS = 0;
  const Z_PATH = 1;
  const Z_PLAZA = 2;
  const Z_WATER = 3;
  const Z_FRAME = 4;
  const Z_TERRACE = 5;
  const Z_BANK = 6;

  /* ---------- layout (art px) ---------- */
  const BROOK = [
    [0, 372], [25, 369], [48, 364], [75, 368], [105, 368], [128, 369],
    [160, 368], [190, 376], [215, 388], [240, 384]
  ];

  const brookX = y => {
    for (let i = 0; i < BROOK.length - 1; i++) {
      if (y <= BROOK[i + 1][0]) {
        const [y0, x0] = BROOK[i];
        const [y1, x1] = BROOK[i + 1];
        const t = (y - y0) / (y1 - y0);
        return x0 + (x1 - x0) * (t * t * (3 - 2 * t));
      }
    }
    return BROOK[BROOK.length - 1][1];
  };

  const brookHW = y => 6.2 + 1.5 * Math.sin(y * 0.11) + 1.1 * Math.sin(y * 0.31 + 1);

  const ROADS = [
    { w: 9, main: true, pts: [[40, 148], [80, 138], [115, 132], [170, 128], [230, 127], [290, 129], [340, 129], [366, 129], [376, 138], [384, 152], [400, 160], [425, 161]] },
    { w: 4.5, pts: [[95, 200], [98, 172], [106, 150], [114, 135]] },
    { w: 4, pts: [[160, 74], [163, 96], [168, 116], [172, 128]] },
    { w: 4, pts: [[195, 208], [196, 182], [198, 152], [200, 130]] }
  ];

  const PLAZAS = [
    { x: 60, y: 136, rx: 34, ry: 17, kind: "hall" },
    { x: 95, y: 196, rx: 23, ry: 11, kind: "yard" }
  ];

  const TERRACE = { x0: 380, y0: 112, x1: 470, y1: 146, lip: 4, cx: 425 };

  const topEdge = x => 15 + 4 * fbm(x / 11, 3.3, 5, 2);
  const botEdge = x => 234.5 - 2.5 * fbm(x / 9, 8.1, 6, 2);
  const leftEdge = y => 4 + 3 * fbm(y / 10, 1.7, 7, 2);
  const rightEdge = y => 475.5 - 3 * fbm(y / 10, 5.9, 8, 2);

  const lushAt = (x, y) => {
    const f = 1 - smooth(335, 402, x + (fbm(x / 14, y / 14, 12, 2) - 0.5) * 34);
    return f;
  };

  /* ---------- state ---------- */
  const zone = new Uint8Array(W * H);
  const world = {
    W, H, zone,
    terrain: null,
    minimap: null,
    doodads: [],
    tufts: [],
    waterFrames: [],
    waterRect: { x: 340, y: 0, w: 66, h: H },
    ready: false
  };

  /* ---------- glow sprites (banded, additive) ---------- */
  const glowCache = new Map();

  function glow(r, color, levels = 4) {
    const key = `${r}|${color}`;
    let c = glowCache.get(key);

    if (!c) {
      const size = r * 2 + 1;
      const P = new Pix(size, size);

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const d = Math.hypot(x - r, y - r) / r;
          if (d > 1) continue;
          const lv = Math.ceil((1 - d) * levels);
          P.setA(x, y, color, Math.round(255 * Math.pow(lv / levels, 1.4)));
        }
      }

      c = P.toCanvas();
      glowCache.set(key, c);
    }

    return c;
  }

  /* ---------- shadows (flat translucent) ---------- */
  const shadowCache = new Map();

  function shadow(kind, w, h) {
    const key = `${kind}|${w}|${h}`;
    let c = shadowCache.get(key);

    if (!c) {
      const P = new Pix(w + 24, h + 14);
      const a = 82;

      if (kind === "ellipse") {
        P.disc(P.w / 2, P.h / 2, w / 2, h / 2, 0);
        for (let i = 0; i < P.d.length; i++) if (P.d[i]) P.d[i] = ((a << 24) | C.shade) >>> 0;
      } else {
        // building: footprint ellipse + a slanted cast shadow toward the lower right
        const cx = P.w / 2 - 6;
        const cy = P.h - 7;
        P.poly([[cx - w / 2 + 2, cy], [cx + w / 2, cy], [cx + w / 2 + 12, cy - 5], [cx - w / 2 + 14, cy - 5]], 0);
        P.disc(cx, cy, w / 2, 5, 0);
        P.disc(cx + 10, cy - 2, w / 2 - 6, 4, 0);
        for (let i = 0; i < P.d.length; i++) if (P.d[i]) P.d[i] = ((a << 24) | C.shade) >>> 0;
      }

      c = P.toCanvas();
      shadowCache.set(key, c);
    }

    return c;
  }

  /* ---------- terrain bake ---------- */
  const cobble = (x, y, seed) => {
    const row = Math.floor(y / 4);
    const off = (row & 1) * 3;
    const cx = Math.floor((x + off) / 6);

    if (y % 4 === 3 || (x + off) % 6 === 5) return S[1];

    const h = hash(cx, row, seed);
    return h > 0.78 ? S[4] : h > 0.32 ? S[3] : S[2];
  };

  const basalt = (x, y) => {
    const row = Math.floor(y / 5);
    const off = (row & 1) * 4;
    const cx = Math.floor((x + off) / 8);

    if (y % 5 === 4 || (x + off) % 8 === 7) return C.b[0];

    const h = hash(cx, row, 55);
    return h > 0.8 ? C.b[3] : h > 0.35 ? C.b[2] : C.b[1];
  };

  function frameColor(x, y, depthTop, depthBot, depthL, depthR) {
    const depth = Math.max(depthTop, depthBot, depthL, depthR);
    const n = fbm(x / 4.5, y / 4.5, 21, 2);
    const nl = fbm((x + 1.6) / 4.5, (y + 1.6) / 4.5, 21, 2);

    // top edge: layered cliff face under the canopy
    if (depthTop >= depthBot && depthTop >= depthL && depthTop >= depthR && depthTop < 4.2) {
      const strata = (y + ((x >> 3) & 1)) % 3 === 0;
      let c = S[1 + (hash(x >> 1, y, 2) > 0.62 ? 1 : 0)];
      if (strata) c = S[0];
      if (depthTop > 3.3) c = S[3];
      if (hash(x, y, 8) > 0.9) c = G[2];
      return c;
    }

    let t = 0.4 + n * 2.6 + depth * 0.02;
    if (n > nl) t += 0.8;
    if (depth > 6) t -= 0.7;

    const idx = clamp(dither(t, x, y, 0.5), 0, 4);
    let c = G[idx];

    if (idx >= 3 && hash(x, y, 31) > 0.985) c = C.a[2];
    if (hash(x, y, 33) > 0.992) c = G[5];
    return c;
  }

  function buildTerrain() {
    const T = new Pix(W, H);

    // road raster: normalised distance to nearest road
    const nd = new Float32Array(W * H).fill(9);
    const roadId = new Int8Array(W * H).fill(-1);

    ROADS.forEach((road, id) => {
      const pad = road.w * 1.6 + 4;

      for (let i = 0; i < road.pts.length - 1; i++) {
        const [ax, ay] = road.pts[i];
        const [bx, by] = road.pts[i + 1];
        const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - pad));
        const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + pad));
        const y0 = Math.max(0, Math.floor(Math.min(ay, by) - pad));
        const y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + pad));
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;

        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const t = clamp(((x - ax) * dx + (y - ay) * dy) / len2, 0, 1);
            const d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
            // taper the narrow trails at their far ends
            let w = road.w + (vnoise(x / 5, y / 5, 3) - 0.5) * 3.2;
            if (!road.main) w *= 0.65 + 0.35 * (i === road.pts.length - 2 ? t : 1);
            const n = d / w;

            if (n < nd[y * W + x]) {
              nd[y * W + x] = n;
              roadId[y * W + x] = id;
            }
          }
        }
      }
    });

    const toneMap = new Uint8Array(W * H);
    const ashMap = new Uint8Array(W * H);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;

        /* ---- base: lush grass or ash ---- */
        const m = fbm(x / 34, y / 34, 1, 3);
        const m2 = fbm(x / 9, y / 9, 7, 2);
        const lf = lushAt(x, y) + (fbm(x / 6, y / 6, 3, 2) - 0.5) * 0.35;
        const ash = lf < 0.5;
        let col;
        let tone;

        if (!ash) {
          let t = 2.55 + (m - 0.5) * 3.4 + (m2 - 0.5) * 1.1;
          tone = clamp(dither(t, x, y, 0.5), 1, 5);
          col = G[tone];
        } else {
          let t = 1.6 + (m - 0.5) * 3.2 + (m2 - 0.5) * 1.0;
          tone = clamp(dither(t, x, y, 0.5), 0, 4);
          col = A[tone];
          ashMap[i] = 1;
        }

        toneMap[i] = tone;
        let z = Z_GRASS;

        /* ---- brook + banks ---- */
        const bx = brookX(y);
        const hw = brookHW(y);
        const bdx = Math.abs(x - bx + (vnoise(y / 7, 2.2, 6) - 0.5) * 2.4);

        if (bdx < hw) {
          z = Z_WATER;
          col = C.v[1];
        } else if (bdx < hw + 2.6) {
          z = Z_BANK;
          const wet = bdx < hw + 1.2;
          col = wet ? (hash(x, y, 4) > 0.7 ? D[3] : D[2]) : hash(x, y, 5) > 0.6 ? D[2] : D[1];
          if (hash(x, y, 9) > 0.93) col = S[4];
        }

        /* ---- roads ---- */
        const n = nd[i];

        if (n < 1.28 && z !== Z_FRAME) {
          const id = roadId[i];
          const road = ROADS[id];
          const main = road.main;

          if (n < 1) {
            const inFord = z === Z_WATER || z === Z_BANK;
            const nearHall = main && x < 105;
            const nearGate = main && x > 336;
            const wantStone = inFord || nearHall || nearGate;
            z = Z_PATH;

            if (wantStone && n < 0.86 && vnoise(x / 9, y / 9, 17) > (inFord ? 0.05 : 0.38)) {
              col = cobble(x, y, 3 + id);
              if (inFord && hash(x, y, 12) > 0.92) col = C.v[3];
            } else {
              let idx = n < 0.34 ? 4 : n < 0.68 ? 3 : n < 0.88 ? 2 : 1;
              idx += hash(x, y, 14) > 0.9 ? 1 : 0;
              if (main && Math.abs(n - 0.46) < 0.05 && hash(x >> 2, y, 6) > 0.3) idx = 2;
              col = D[clamp(idx, 0, 5)];
              const hh = hash(x, y, 15);
              if (hh > 0.975) col = S[4];
              else if (hh < 0.02) col = D[1];
              if (ash) col = mix(col, A[3], 0.28);
            }
          } else if (z === Z_GRASS && hash(x, y, 18) < (1.28 - n) * 1.7) {
            // grass fringe
            col = hash(x, y, 19) > 0.5 ? D[1] : (ash ? A[2] : G[Math.max(1, tone - 1)]);
          }
        }

        /* ---- plazas ---- */
        for (const p of PLAZAS) {
          const dx = (x - p.x) / p.rx;
          const dy = (y - p.y) / p.ry;
          const d2 = dx * dx + dy * dy;
          const edge = 1 + (vnoise(x / 4, y / 4, 8) - 0.5) * 0.18;

          if (d2 < edge && z !== Z_WATER) {
            z = Z_PLAZA;

            if (p.kind === "hall") {
              col = cobble(x, y, 9);
              if (d2 > edge * 0.8) col = mix(col, G[2], 0.35);
              else if (hash(x, y, 40) > 0.97) col = G[3];
              const rr = Math.abs(Math.hypot(dx, dy) - 0.64);
              const ang = Math.atan2(dy, dx);
              if (rr < 0.035 && !(ang > -1.25 && ang < -0.35)) col = C.a[1];
            } else {
              col = D[2 + (hash(x >> 1, y >> 1, 41) > 0.7 ? 1 : 0)];
              if ((y + (x >> 3)) % 3 === 0 && hash(x, y, 42) > 0.4) col = D[1];
              if (d2 > edge * 0.8) col = mix(col, G[2], 0.4);
            }
          } else if (d2 < edge * 1.25 && z === Z_GRASS && hash(x, y, 43) < 0.35) {
            col = mix(col, D[1], 0.55);
          }
        }

        /* ---- citadel terrace (raised) ---- */
        {
          const tx0 = TERRACE.x0 + (vnoise(y / 6, 1, 9) - 0.5) * 2;
          const tx1 = TERRACE.x1 + (vnoise(y / 6, 2, 9) - 0.5) * 2;

          if (x >= tx0 && x <= tx1 && y >= TERRACE.y0 && y < TERRACE.y1) {
            z = Z_TERRACE;
            col = basalt(x, y);
            if (y === TERRACE.y0) col = C.b[4];
            else if (x < tx0 + 1) col = C.b[3];
            else if (x > tx1 - 1) col = C.b[0];
          } else if (x >= tx0 && x <= tx1 && y >= TERRACE.y1 && y < TERRACE.y1 + TERRACE.lip) {
            z = Z_TERRACE;
            const k = y - TERRACE.y1;
            col = k === 0 ? C.b[3] : k === TERRACE.lip - 1 ? C.shade : (hash(x >> 2, k, 3) > 0.7 ? C.b[2] : C.b[1]);
          } else if (x >= tx0 + 3 && x <= tx1 + 4 && y >= TERRACE.y1 + TERRACE.lip && y < TERRACE.y1 + TERRACE.lip + 3 && z === Z_GRASS) {
            col = mix(col, C.shade, 0.5);
          }
        }

        /* ---- map frame: cliff, thicket, hedges ---- */
        {
          const dT = topEdge(x) - y;
          const dB = y - botEdge(x);
          const dL = leftEdge(y) - x;
          const dR = x - rightEdge(y);

          if (dT > 0 || dB > 0 || dL > 0 || dR > 0) {
            z = Z_FRAME;
            col = frameColor(x, y, dT, dB, dL, dR);
          } else if (z === Z_GRASS && dT > -3.2) {
            col = mix(col, C.shade, 0.45 * (1 - (-dT) / 3.2));
          } else if (z === Z_GRASS && (dB > -3 || dL > -3 || dR > -3)) {
            col = mix(col, C.shade, 0.28);
          }
        }

        zone[i] = z;
        T.set(x, y, col);
      }
    }

    /* ---- ground details on open ground ---- */
    for (let y = 2; y < H - 2; y++) {
      for (let x = 2; x < W - 2; x++) {
        const i = y * W + x;
        if (zone[i] !== Z_GRASS) continue;
        const ash = ashMap[i] === 1;
        const tone = toneMap[i];
        const h = hash(x, y, 11);

        if (!ash) {
          if (h > 0.9935) {
            const f = hash(x, y, 12);
            const c = f < 0.3 ? C.white : f < 0.55 ? C.a[3] : f < 0.78 ? C.cap[2] : C.m[3];
            T.set(x, y, c);
            if (hash(x, y, 13) > 0.5) T.set(x + 1, y, c);
            T.set(x, y + 1, G[1]);
          } else if (h > 0.955) {
            T.set(x, y, G[Math.min(5, tone + 1)]);
            T.set(x, y - 1, G[Math.min(5, tone + 2)]);
          } else if (h < 0.012) {
            T.set(x, y, G[Math.max(0, tone - 1)]);
          } else if (h > 0.948 && h < 0.9535) {
            T.rect(x, y, 2, 1, S[4]);
          }
        } else if (h > 0.992) {
          T.set(x, y, C.r[2]);
        } else if (h > 0.965 && h < 0.975) {
          T.set(x, y, A[3]);
          T.set(x, y - 1, A[4]);
        } else if (h < 0.015) {
          T.set(x, y, A[0]);
        }
      }
    }

    /* ---- ember cracks in the ash ---- */
    const R = rng(77);
    for (let k = 0; k < 46; k++) {
      let x = 392 + R() * 82;
      let y = 22 + R() * 208;
      let a = R() * Math.PI * 2;
      const len = 8 + R() * 22;

      for (let s = 0; s < len; s++) {
        a += (R() - 0.5) * 0.9;
        x += Math.cos(a);
        y += Math.sin(a) * 0.7;
        const xi = Math.round(x);
        const yi = Math.round(y);

        if (xi < 2 || yi < 2 || xi >= W - 2 || yi >= H - 2) break;
        if (zone[yi * W + xi] !== Z_GRASS || !ashMap[yi * W + xi]) continue;

        T.set(xi, yi, s % 5 === 0 ? C.r[3] : C.r[1]);
        if (s % 7 === 3) T.set(xi, yi + 1, C.r[2]);
      }
    }

    /* ---- steps down from the terrace ---- */
    for (let k = 0; k < 3; k++) {
      const half = 12 - k * 2;
      const y0 = TERRACE.y1 + TERRACE.lip + k * 2;

      for (let y = y0; y < y0 + 2; y++) {
        for (let x = TERRACE.cx - half; x <= TERRACE.cx + half; x++) {
          const c = y === y0 ? C.b[4] : C.b[1];
          T.set(x, y, c);
          zone[y * W + x] = Z_TERRACE;
        }
      }
    }

    /* ---- stepping stones & reeds along the brook ---- */
    for (let y = 8; y < H - 8; y += 3) {
      const bx = brookX(y);
      const hw = brookHW(y);

      for (const side of [-1, 1]) {
        if (hash(y, side, 61) > 0.42) continue;
        const x = Math.round(bx + side * (hw + 3 + hash(y, side, 62) * 2));
        const i = y * W + x;
        if (zone[i] === Z_PATH || zone[i] === Z_FRAME) continue;

        // reed: three leaning blades
        const c = hash(y, side, 63) > 0.5 ? G[4] : G[3];
        T.set(x, y, c);
        T.set(x, y - 1, c);
        T.set(x + side, y - 2, G[5]);
        T.set(x - side, y - 1, G[2]);
      }
    }

    world.toneMap = toneMap;
    world.ashMap = ashMap;
    return T.toCanvas();
  }

  /* ---------- water (4 animated frames) ---------- */
  function buildWater() {
    const r = world.waterRect;
    const frames = [];

    for (let f = 0; f < 4; f++) {
      const P = new Pix(r.w, r.h);

      for (let y = 0; y < r.h; y++) {
        const bx = brookX(y);
        const hw = brookHW(y);

        for (let x = 0; x < r.w; x++) {
          const ax = x + r.x;
          if (zone[y * W + ax] !== Z_WATER) continue;

          const bdx = Math.abs(ax - bx + (vnoise(y / 7, 2.2, 6) - 0.5) * 2.4);
          const e = clamp((hw - bdx) / hw, 0, 1);
          let c = e < 0.2 ? C.v[3] : e < 0.45 ? C.v[2] : C.v[1];
          if (e < 0.2 && hash(x, y, 70) > 0.6) c = C.v[2];

          const wave = Math.sin((y - f * 2) * (Math.PI * 2 / 8) + ax * 0.55 + vnoise(ax / 6, y / 6, 3) * 4);
          if (wave > 0.82 && e > 0.12) c = C.v[3];
          else if (wave < -0.9) c = C.v[0];

          // foam on the banks, sparkles on the crests
          if (e < 0.09 && (x + y + f) % 4 < 2) c = C.v[4];
          if (hash(x + f * 5, y, 71) > 0.992) c = C.white;

          // pebbles on the shallow bed
          if (e < 0.35 && hash(x, y, 72) > 0.95) c = C.d[3];

          P.set(x, y, c);
        }
      }

      frames.push(P.toCanvas());
    }

    return frames;
  }

  /* ---------- grass tufts that sway ---------- */
  function buildTufts() {
    const frames = [];

    for (let f = 0; f < 3; f++) {
      const P = new Pix(7, 6);
      const lean = f - 1;

      for (const [bx, h, c] of [[2, 4, G[3]], [3, 5, G[4]], [4, 4, G[3]], [1, 3, G[2]], [5, 3, G[2]]]) {
        for (let k = 0; k <= h; k++) {
          P.set(bx + Math.round(lean * k / 3), 5 - k, k > h - 2 ? G[5] : c);
        }
      }

      frames.push(P.toCanvas());
    }

    const R = rng(311);
    const list = [];

    for (let k = 0; k < 900 && list.length < 240; k++) {
      const x = 12 + Math.floor(R() * 340);
      const y = 22 + Math.floor(R() * 205);
      if (zone[y * W + x] !== Z_GRASS || world.ashMap[y * W + x]) continue;
      if (world.toneMap[y * W + x] < 2) continue;
      list.push({ x, y, ph: R() * 6.28 });
    }

    list.sort((a, b) => a.y - b.y);
    world.tufts = list;
    return frames;
  }

  /* ---------- doodad scatter ---------- */
  function placeDoodads(layout) {
    const R = rng(2024);
    const dd = PK.props.doodads;
    const list = [];

    const blocked = (x, y, r, ignoreZone) => {
      const ix = Math.round(x);
      const iy = Math.round(y);
      if (ix < 8 || iy < 24 || ix > W - 8 || iy > H - 8) return true;

      if (!ignoreZone) {
        for (let dy = -2; dy <= 2; dy += 2) {
          for (let dx = -3; dx <= 3; dx += 3) {
            if (zone[(iy + dy) * W + ix + dx] !== Z_GRASS) return true;
          }
        }
      }

      for (const b of layout.buildings) {
        if (Math.hypot(x * 2 - b.x, (y * 2 - b.y - 20) * 1.1) < (b.type === "tower" ? 50 : 82)) return true;
      }

      for (const res of layout.resources) {
        if (Math.hypot(x * 2 - res.x, y * 2 - (res.y + 26)) < (res.type === "gold" ? 52 : 34) + r) return true;
      }

      for (const d of list) {
        if (Math.hypot(d.x - x, (d.y - y) * 1.4) < d.r + r) return true;
      }

      return false;
    };

    const add = (name, x, y, force = false, r = 8) => {
      if (!dd[name]) return false;
      if (!force && blocked(x, y, r, false)) return false;
      list.push({ name, spr: dd[name], x: Math.round(x), y: Math.round(y), r, ph: R() * 6.28 });
      return true;
    };

    const scatter = (name, count, x0, x1, y0, y1, r = 8) => {
      let placed = 0;
      for (let k = 0; k < 90 && placed < count; k++) {
        if (add(name, x0 + R() * (x1 - x0), y0 + R() * (y1 - y0), false, r)) placed++;
      }
    };

    // landmarks and storytelling
    add("ringstone", 292, 80, true, 22);
    add("column", 340, 111, true, 5);
    add("column", 340, 149, true, 5);
    add("columnFallen", 322, 153, true, 9);
    add("stoneA", 349, 146, true, 6);
    add("campfire", 32, 168, true, 9);
    add("stump", 18, 172, true, 6);
    add("stump", 47, 174, true, 6);
    add("crates", 18, 150, true, 9);
    add("signpost", 246, 112, true, 5);

    // lanterns light the way along the road
    for (const [x, y] of [[100, 118], [158, 142], [214, 113], [270, 143], [326, 115], [66, 160], [134, 150]]) {
      add("lanternPost", x, y, true, 5);
    }

    // the east smoulders
    for (const [x, y] of [[396, 114], [396, 148], [372, 100], [374, 162]]) {
      add(y > 110 && y < 150 ? "brazier" : "skullStake", x, y, true, 5);
    }

    // everything else is scattered off the beaten path
    scatter("crystalCyan", 3, 14, 340, 40, 220, 14);
    scatter("crystalViolet", 3, 14, 340, 40, 220, 14);
    scatter("monolith", 4, 180, 340, 40, 220, 7);
    scatter("shroomGlow", 9, 14, 345, 30, 228, 7);
    scatter("shroomRed", 7, 14, 345, 30, 228, 6);
    scatter("stoneA", 5, 14, 345, 30, 228, 8);
    scatter("stoneB", 9, 14, 470, 30, 228, 5);
    scatter("fern", 16, 14, 345, 30, 228, 6);
    scatter("stump", 2, 100, 345, 40, 220, 6);
    scatter("columnFallen", 1, 200, 345, 40, 220, 9);

    scatter("deadTree", 7, 400, 466, 26, 226, 11);
    scatter("ribs", 1, 396, 466, 160, 226, 11);
    scatter("skullStake", 4, 396, 466, 26, 226, 5);

    list.sort((a, b) => a.y - b.y);
    world.doodads = list;
  }

  /* ---------- atmosphere overlays ---------- */
  function buildClouds() {
    const N = 240;
    const P = new Pix(N, N);

    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const n = tnoise(x / 30, y / 30, 8, 5) * 0.65 + tnoise(x / (N / 17), y / (N / 17), 17, 9) * 0.35;
        const p = smooth(0.5, 0.64, n);
        if (p > bayer(x, y) + 0.04) P.set(x, y, C.shade);
      }
    }

    return P.toCanvas();
  }

  function buildMist() {
    const out = [];

    for (let k = 0; k < 4; k++) {
      const w = 140;
      const h = 22;
      const P = new Pix(w, h);

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const fx = 1 - Math.abs(x - w / 2) / (w / 2);
          const fy = 1 - Math.abs(y - h / 2) / (h / 2);
          const n = tnoise(x / 9 + k * 3, y / 5, 16, 20 + k);
          const v = fx * fy * (0.55 + n * 0.9);
          if (v > 0.55 + bayer(x, y) * 0.35) P.set(x, y, 0xcfd8ee);
        }
      }

      out.push(P.toCanvas());
    }

    return out;
  }

  function buildVignette() {
    const P = new Pix(W, H);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = (x - W / 2) / (W / 2);
        const dy = (y - H / 2) / (H / 2);
        const d = Math.pow(Math.abs(dx), 2.6) * 0.8 + Math.pow(Math.abs(dy), 2.4) * 0.9;
        const v = smooth(0.35, 1.25, d) * 4.2;
        const lv = Math.floor(v + bayer(x, y) - 0.5 + 0.5);
        if (lv > 0) P.setA(x, y, 0x120e26, Math.min(190, lv * 46));
      }
    }

    return P.toCanvas();
  }

  function buildWarmth() {
    const P = new Pix(W, H);

    for (let y = 0; y < 150; y++) {
      for (let x = 0; x < 300; x++) {
        const d = Math.hypot(x / 300, y / 150);
        const v = (1 - d) * 3.2;
        if (v <= 0) continue;
        const lv = Math.floor(v + bayer(x, y) - 0.5 + 0.5);
        if (lv > 0) P.setA(x, y, 0xffd98a, Math.min(34, lv * 11));
      }
    }

    return P.toCanvas();
  }

  /* ---------- build ---------- */
  function build(layout) {
    world.terrain = buildTerrain();
    world.waterFrames = buildWater();
    world.tuftFrames = buildTufts();
    placeDoodads(layout);
    world.clouds = buildClouds();
    world.mist = buildMist();
    world.vignette = buildVignette();
    world.warmth = buildWarmth();

    const mm = makeCanvas(88, 44);
    mm.g.imageSmoothingEnabled = true;
    mm.g.drawImage(world.terrain, 0, 0, 88, 44);
    mm.g.imageSmoothingEnabled = false;
    world.minimap = mm.c;
    world.ready = true;
  }

  /* ---------- per-frame drawing ---------- */
  function drawGround(g, T) {
    g.drawImage(world.terrain, 0, 0);

    const r = world.waterRect;
    g.drawImage(world.waterFrames[Math.floor(T * 3.2) & 3], r.x, r.y);

    const frames = world.tuftFrames;

    for (const t of world.tufts) {
      const s = Math.sin(T * 1.7 + t.ph + t.x * 0.04);
      const f = s > 0.45 ? 2 : s < -0.45 ? 0 : 1;
      g.drawImage(frames[f], t.x - 3, t.y - 5);
    }
  }

  function drawClouds(g, T) {
    g.globalAlpha = 0.17;
    const off = Math.floor(T * 3) % 240;
    const oy = Math.floor(T * 0.8) % 240;

    for (let k = -1; k <= 2; k++) {
      g.drawImage(world.clouds, k * 240 - off, -oy);
      g.drawImage(world.clouds, k * 240 - off, 240 - oy);
    }

    g.globalAlpha = 1;
  }

  function drawMist(g, T) {
    g.globalAlpha = 0.1;
    const lanes = [[372, 60, 6], [380, 160, 5], [150, 205, 3.5], [250, 22, 4]];

    lanes.forEach(([x, y, v], k) => {
      const w = world.mist[k % 4].width;
      const px = Math.round(((x + T * v) % (W + w)) - w);
      g.drawImage(world.mist[k % 4], px, y + Math.round(Math.sin(T * 0.4 + k) * 2));
    });

    g.globalAlpha = 1;
  }

  function drawGrade(g) {
    g.globalCompositeOperation = "lighter";
    g.drawImage(world.warmth, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.drawImage(world.vignette, 0, 0);
  }

  /* additive light: draws a banded glow centred on (x, y) */
  function light(g, x, y, r, color, alpha) {
    g.globalAlpha = alpha;
    g.globalCompositeOperation = "lighter";
    g.drawImage(glow(r, color), Math.round(x) - r, Math.round(y) - r);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
  }

  Object.assign(world, {
    build, drawGround, drawClouds, drawMist, drawGrade, light, glow, shadow,
    brookX, brookHW,
    zoneAt: (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? Z_FRAME : zone[(y | 0) * W + (x | 0)]),
    Z: { GRASS: Z_GRASS, PATH: Z_PATH, PLAZA: Z_PLAZA, WATER: Z_WATER, FRAME: Z_FRAME, TERRACE: Z_TERRACE, BANK: Z_BANK }
  });

  PK.world = world;
})();
