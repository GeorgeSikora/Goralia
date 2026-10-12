/*
 * The world: baked terrain, animated water, grass sway, doodad placement
 * and the atmosphere layers (cloud shadows, mist, vignette, light glows).
 * Art coordinates are 1 px = 2 logical game units. The terrain is generated
 * from the recipe in PK.maps (map.terrain) and its size comes from the map.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const { C, Pix, mix, hash, fbm, vnoise, tnoise, bayer, dither, clamp, smooth, rng, makeCanvas } = PK;

  // Rozměry a recept aktivní mapy (nastavuje activate()).
  let W = 480;
  let H = 240;
  let rec = null;
  let zone = new Uint8Array(0);
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
  const Z_ROCK = 7; // hory
  const Z_WALL = 8; // hradby

  // 1 = bujná tráva, 0 = popel. Popel leží za hranicí ash.edge nebo uvnitř kruhů ash.circles.
  const lushAt = (rc, x, y) => {
    if (!rc.ash.edge && !rc.ash.circles.length) return 1;

    const n = (fbm(x / 14, y / 14, 12, 2) - 0.5) * 34;
    let f = 1;

    if (rc.ash.edge) f = 1 - smooth(rc.ash.edge[0], rc.ash.edge[1], x + n);

    for (const [cx, cy, r] of rc.ash.circles) {
      f = Math.min(f, smooth(r * 0.55, r, Math.hypot(cx - x, cy - y) + n));
    }

    return f;
  };

  /* ---------- state ---------- */
  const world = {
    W, H, zone,
    terrain: null,
    minimap: null,
    doodads: [],
    tufts: [],
    waterFrames: [],
    waterRect: null,
    map: null,
    ready: false
  };

  /* ---------- glow sprites (banded, additive) ---------- */
  const glowCache = new Map();

  function glowPix(r, color, levels, k) {
    const size = (r * 2 + 1) * k;
    const mid = size / 2;
    const P = new Pix(size, size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x + 0.5 - mid, y + 0.5 - mid) / (r * k + k / 2);
        if (d > 1) continue;
        const lv = Math.ceil((1 - d) * levels);
        P.setA(x, y, color, Math.round(255 * Math.pow(lv / levels, 1.4)));
      }
    }

    return P;
  }

  function glow(r, color, levels = 4) {
    const key = `${r}|${color}`;
    let c = glowCache.get(key);

    if (!c) {
      c = glowPix(r, color, levels, 1).toCanvas();
      // HD záře: jemnější kruh a víc pásem, pořád stupňovitá jako pixel art
      PK.hdLater(c, () => glowPix(r, color, levels * 2, PK.HD).rawCanvas());
      glowCache.set(key, c);
    }

    return c;
  }

  /* ---------- shadows (flat translucent) ---------- */
  const shadowCache = new Map();

  // k = hustota (1 = art px, PK.HD = jemný okraj); HD stín má navíc měkčí lem
  function shadowPix(kind, w, h, k) {
    const P = new Pix((w + 24) * k, (h + 14) * k);
    const a = 82;

    if (kind === "ellipse") {
      P.disc(P.w / 2, P.h / 2, w / 2 * k, h / 2 * k, 0);
    } else {
      // building: footprint ellipse + a slanted cast shadow toward the lower right
      const cx = (w + 24) / 2 - 6;
      const cy = h + 14 - 7;
      const s = ([x, y]) => [x * k, y * k];
      P.poly([[cx - w / 2 + 2, cy], [cx + w / 2, cy], [cx + w / 2 + 12, cy - 5], [cx - w / 2 + 14, cy - 5]].map(s), 0);
      P.disc(cx * k, cy * k, w / 2 * k, 5 * k, 0);
      P.disc((cx + 10) * k, (cy - 2) * k, (w / 2 - 6) * k, 4 * k, 0);
    }

    for (let i = 0; i < P.d.length; i++) if (P.d[i]) P.d[i] = ((a << 24) | C.shade) >>> 0;

    if (k > 1) {
      // jemný lem: krajní body stínu jsou světlejší, okraj se neláme ostře
      const edge = [];
      for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) {
        if (!P.alpha(x, y)) continue;
        if (!P.alpha(x - 1, y) || !P.alpha(x + 1, y) || !P.alpha(x, y - 1) || !P.alpha(x, y + 1)) edge.push(x, y);
      }
      for (let n = 0; n < edge.length; n += 2) P.setA(edge[n], edge[n + 1], C.shade, 44);
    }

    return P;
  }

  function shadow(kind, w, h) {
    const key = `${kind}|${w}|${h}`;
    let c = shadowCache.get(key);

    if (!c) {
      c = shadowPix(kind, w, h, 1).toCanvas();
      PK.hdLater(c, () => shadowPix(kind, w, h, PK.HD).rawCanvas());
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

  function* buildTerrainSteps(b) {
    const { W, H, zone } = b;
    const rec = b.map.terrain;
    const T = new Pix(W, H);

    // road raster: normalised distance to nearest road
    const nd = new Float32Array(W * H).fill(9);
    const roadId = new Int8Array(W * H).fill(-1);

    rec.roads.forEach((road, id) => {
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

    const { toneMap, ashMap, rivE } = b;

    yield 0;

    // river raster: distance to the nearest river centre line and its half-width there
    const rd = new Float32Array(W * H).fill(1e6);
    const rhw = new Float32Array(W * H);

    for (const river of rec.rivers) {
      if (!river.pts) continue;
      const pad = river.hw * 1.6 + 6;

      for (let i = 0; i < river.pts.length - 1; i++) {
        const [ax, ay] = river.pts[i];
        const [bx, by] = river.pts[i + 1];
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

            if (d < rd[y * W + x]) {
              rd[y * W + x] = d;
              rhw[y * W + x] = river.hw + 1.3 * Math.sin((x + y) * 0.09);
            }
          }
        }
      }
    }

    yield 0;

    // hory a hradby: nejbližší střed hřebene a jeho šířka, resp. maska korunou zdi
    const mrd = new Float32Array(W * H).fill(1e6);
    const mhw = new Float32Array(W * H);
    const wallTop = new Uint8Array(W * H);

    const nearStroke = (pts, pad, visit) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - pad));
        const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + pad));
        const y0 = Math.max(0, Math.floor(Math.min(ay, by) - pad));
        const y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + pad));
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy || 1;

        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const t = clamp(((x - ax) * dx + (y - ay) * dy) / len2, 0, 1);
            visit(y * W + x, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
          }
        }
      }
    };

    for (const m of rec.mountains) {
      nearStroke(m.pts, m.hw + 8, (i, d) => {
        if (d < mrd[i]) { mrd[i] = d; mhw[i] = m.hw; }
      });
    }

    for (const wl of rec.walls) nearStroke(wl.pts, wl.hw * 1.5 + 3, (i, d) => { if (d < wl.hw * 1.5 + 1) wallTop[i] = 1; });

    // Pilíře brány: po obou stranách průchodu se zeď zakončí širším čtyřhranným pilířem s vyšší hlavicí.
    const pier = new Uint8Array(W * H);

    for (const wl of rec.walls) {
      for (let i = 0; i < wl.pts.length - 1; i++) {
        const [ax, ay] = wl.pts[i];
        const [bx, by] = wl.pts[i + 1];
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;

        for (const road of rec.roads) {
          for (let j = 0; j < road.pts.length - 1; j++) {
            const [cx, cy] = road.pts[j];
            const [ex, ey] = road.pts[j + 1];
            const rx = ex - cx;
            const ry = ey - cy;
            const den = dx * ry - dy * rx;
            if (Math.abs(den) < 1e-6) continue;
            const u = ((cx - ax) * ry - (cy - ay) * rx) / den;
            const v = ((cx - ax) * dy - (cy - ay) * dx) / den;
            if (u < 0 || u > 1 || v < 0 || v > 1) continue;

            const gx = ax + dx * u;
            const gy = ay + dy * u;
            const gap = road.w * 1.12;
            const half = wl.hw * 1.5 + 3;
            const reach = gap + 7;
            const x0 = Math.max(0, Math.floor(gx - reach - half)), x1 = Math.min(W - 1, Math.ceil(gx + reach + half));
            const y0 = Math.max(0, Math.floor(gy - reach - half)), y1 = Math.min(H - 1, Math.ceil(gy + reach + half));

            for (let y = y0; y <= y1; y++) {
              for (let x = x0; x <= x1; x++) {
                const sAlong = (x - gx) * ux + (y - gy) * uy;
                const tAcross = -(x - gx) * uy + (y - gy) * ux;
                if (Math.abs(sAlong) >= gap && Math.abs(sAlong) < reach && Math.abs(tAcross) < half) {
                  wallTop[y * W + x] = 1;
                  pier[y * W + x] = 1;
                }
              }
            }
          }
        }
      }
    }

    // v průchodu (brána) zeď nestojí
    for (let i = 0; i < W * H; i++) if (wallTop[i] && !pier[i] && nd[i] < 1.12) wallTop[i] = 0;

    const paved = (x, y) =>
      rec.paveX.some(([a, c]) => x >= a && x < c) ||
      rec.pave.some(([px, py, pr]) => Math.hypot(x - px, y - py) < pr);

    yield 0;

    // pole pro jemné pečení (art rozlišení, mezi nimi se bilineárně interpoluje)
    const N = W * H;
    const F = {
      tone: new Float32Array(N), lush: new Float32Array(N),
      hue: new Float32Array(N), flw: new Float32Array(N),
      riv: new Float32Array(N).fill(1e6), rhw,
      mtn: new Float32Array(N).fill(1e6), mr: new Float32Array(N),
      pla: new Float32Array(N).fill(9), plaId: new Int8Array(N).fill(-1),
      nd, roadId, paved
    };
    b.F = F;

    const topEdge = x => 15 + 4 * fbm(x / 11, 3.3, 5, 2);
    const botEdge = x => H - 5.5 - 2.5 * fbm(x / 9, 8.1, 6, 2);
    const leftEdge = y => 4 + 3 * fbm(y / 10, 1.7, 7, 2);
    const rightEdge = y => W - 4.5 - 3 * fbm(y / 10, 5.9, 8, 2);

    for (let y = 0; y < H; y++) {
      if ((y & 15) === 15) yield 0.9 * y / H;
      for (let x = 0; x < W; x++) {
        const i = y * W + x;

        /* ---- base: lush grass or ash ---- */
        const m = fbm(x / 34, y / 34, 1, 3);
        const m2 = fbm(x / 9, y / 9, 7, 2);
        const lf = lushAt(rec, x, y) + (fbm(x / 6, y / 6, 3, 2) - 0.5) * 0.35;
        const ash = lf < 0.5;
        let col;
        let tone;
        F.tone[i] = 2.55 + (m - 0.5) * 3.4 + (m2 - 0.5) * 1.1;
        F.lush[i] = lf;
        // teplota trávy: velké skvrny zlaté louky a chladného stínu, k tomu jemný přechod
        // od slunného levého horního rohu k chladnějšímu pravému dolnímu
        F.hue[i] = (fbm(x / 40, y / 40, 11, 3) - 0.5) * 6 + (0.5 - (x / W) * 0.55 - (y / H) * 0.45) * 2;
        // rozkvetlé paloučky
        F.flw[i] = fbm(x / 15, y / 15, 13, 2);

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

        /* ---- river + banks ---- */
        let hw = 0;
        let bdx = 1e6;

        if (rd[i] < 1e5) {
          const pd = rd[i] + (vnoise(y / 7, x / 9, 6) - 0.5) * 2.4;
          F.riv[i] = pd - rhw[i];
          if (pd - rhw[i] < bdx - hw) {
            bdx = pd;
            hw = rhw[i];
          }
        }

        if (bdx < hw) {
          z = Z_WATER;
          col = C.v[1];
          rivE[i] = clamp((hw - bdx) / hw, 0, 1);
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
          const road = rec.roads[id];
          const main = road.main;

          if (n < 1) {
            const inFord = z === Z_WATER || z === Z_BANK;
            const wantStone = inFord || (main && paved(x, y));
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
        for (let pi = 0; pi < rec.plazas.length; pi++) {
          const p = rec.plazas[pi];
          const dx = (x - p.x) / p.rx;
          const dy = (y - p.y) / p.ry;
          const d2 = dx * dx + dy * dy;
          if (d2 > 1.6) continue;
          const edge = 1 + (vnoise(x / 4, y / 4, 8) - 0.5) * 0.18;
          if (d2 / edge < F.pla[i]) { F.pla[i] = d2 / edge; F.plaId[i] = pi; }

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

        /* ---- raised basalt terraces (red citadel) ---- */
        for (const TERRACE of rec.terraces) {
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

        /* ---- hory: skalní masiv, hrana s dlaždicí suti kolem ---- */
        if (mrd[i] < 1e5 && z !== Z_FRAME) {
          const r = mhw[i];
          const pd = mrd[i] + (vnoise(x / 5, y / 5, 33) - 0.5) * 3.4;
          F.mtn[i] = pd - r;
          F.mr[i] = r;

          if (pd < r) {
            z = Z_ROCK;
            const depth = clamp((r - pd) / r, 0, 1);
            const n1 = fbm(x / 5, y / 5, 35, 3);
            const n2 = fbm((x + 1.8) / 5, (y + 2.2) / 5, 35, 3);
            let t = 1.4 + depth * 2.1 + (n1 - 0.5) * 3 + (n1 > n2 ? 0.9 : -0.5);
            let idx = clamp(dither(t, x, y, 0.5), 0, 5);
            if ((y + ((x >> 3) & 3)) % 6 === 0 && hash(x, y, 36) > 0.35) idx = Math.max(0, idx - 1);
            col = S[idx];
            if (pd > r - 1.3) col = S[0];
            if (depth < 0.35 && hash(x, y, 37) > 0.93) col = G[2];
          } else if (pd < r + 5.5 && z === Z_GRASS) {
            // podhůří: suť a kameny na trávě
            const k = 1 - (pd - r) / 5.5;
            if (hash(x, y, 38) < 0.5 * k + 0.1) col = hash(x, y, 39) > 0.55 ? S[2] : S[1];
            else col = mix(col, S[1], 0.32 * k);
            if (hash(x, y, 41) > 0.965) col = S[4];
          }
        }

        /* ---- hradby: široká koruna zdi s cimbuřím, vysoký líc o šest pixelů níž, stín na zemi; v místě cesty je brána ---- */
        if (z !== Z_FRAME && z !== Z_WATER) {
          const FACE = 6;
          let below = 0;
          for (let k = 1; k <= FACE && !below; k++) if (y >= k && wallTop[i - k * W]) below = k;
          const gateOpen = nd[i] < 1.12 && !(below && pier[i - below * W]);
          if (!gateOpen) {

          // nepravidelné kvádry: šířka i posun se mění po řádcích, každý kámen má vlastní odstín
          const stone = (rowH, base, spread) => {
            const row = Math.floor(y / rowH);
            const w = 5 + Math.floor(hash(row, 3, 47) * 4);
            const off = Math.floor(hash(row, 5, 48) * 9);
            const bx = Math.floor((x + off) / w);
            const mortar = (x + off) % w === 0 || y % rowH === rowH - 1;
            const tone = hash(bx, row, 49);
            let idx = base + (tone > 0.78 ? spread : tone < 0.22 ? -spread : 0);
            if ((x + off) % w === 1 && y % rowH === 0) idx += 1; // světlý roh kvádru
            return { idx: clamp(idx, 0, 5), mortar };
          };
          const moss = fbm(x / 3.5, y / 3.5, 52, 2) > 0.66 && hash(x, y, 53) > 0.35;

          if (wallTop[i]) {
            z = Z_WALL;
            const north = !wallTop[i - W];
            const south = !wallTop[i + W];
            const merlon = (x >> 2) % 2 === 0;
            const st = stone(3, 4, 1);
            col = st.mortar ? S[2] : S[st.idx];
            if (hash(x, y, 54) > 0.97) col = S[st.idx > 3 ? 3 : 5];
            if (moss) col = hash(x, y, 55) > 0.5 ? G[2] : G[1];
            if (north) col = merlon ? S[5] : S[2];
            else if (!wallTop[i - 2 * W] && !merlon) col = S[3];
            if (south) col = S[1];
            if (pier[i]) {
              col = st.mortar ? S[4] : S[5];
              if (north || south || !wallTop[i - 1] || !wallTop[i + 1] || !pier[i - 1] || !pier[i + 1] || !pier[i - W] || !pier[i + W]) col = S[3];
              else if ((x + y) % 5 === 0) col = S[4];
              if (!wallTop[i + 1] || !pier[i + 1]) col = S[1];
            } else if (!wallTop[i - 1]) col = S[5];
            else if (!wallTop[i + 1]) col = S[0];
            else if (!wallTop[i + 2]) col = S[2];
          } else if (below) {
            z = Z_WALL;
            const st = stone(3, 3, 1);
            col = st.mortar ? S[1] : S[st.idx];
            if (below <= 1) col = S[3];
            // světlejší horní hrana kamene, tmavší spodní
            if (!st.mortar && y % 3 === 0) col = S[Math.min(5, st.idx + 1)];
            if (below >= FACE - 1) col = S[1];
            // praskliny a mech ve spodní části zdi
            if (hash(x >> 1, y, 56) > 0.975 && below > 1) col = S[0];
            if (moss && below >= 3) col = hash(x, y, 57) > 0.45 ? G[1] : G[0];
            else if (below === FACE - 1 && hash(x, 0, 58) > 0.5) col = G[0];
          } else if (z === Z_GRASS || z === Z_PATH) {
            let sh = 0;
            for (let k = FACE + 1; k <= FACE + 6 && !sh; k++) if (y >= k && wallTop[i - k * W]) sh = k - FACE;
            if (!sh) for (let k = 1; k <= 5 && !sh; k++) if (wallTop[i - k]) sh = k; // stín vpravo od zdi
            if (sh) col = mix(col, S[0], [0.7, 0.55, 0.42, 0.3, 0.2, 0.1][sh - 1]);
          }
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
    for (const cr of rec.cracks) for (let k = 0; k < cr.n; k++) {
      let x = cr.x + R() * cr.w;
      let y = cr.y + R() * cr.h;
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
    for (const TERRACE of rec.terraces) for (let k = 0; k < 3; k++) {
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

    const canvas = T.toCanvas();
    // terén peče world.prepare po kouscích (nebo první vykreslení), ne hromadné hdBakeAll
    if (W * H * 4 <= FINE_MAX) {
      b.fine = false;
      PK.hdLater(canvas, () => { b.fine = true; return drain(bakeFineSteps(b)).rawCanvas(); }, false);
    } else b.F = null;
    return canvas;
  }

  /* ---------- jemné pečení terénu (PK.HD = 2) ----------
   * Herní mapy (zone, toneMap, ashMap, rivE) zůstávají v art px. Vzhled se peče
   * v jemné mřížce: pole z art průchodu (tón trávy, vzdálenost od cesty, řeky,
   * hor, náměstí) se mezi art px bilineárně interpolují, takže hrany jsou čisté
   * a každá textura (stébla, oblázky, dlažba, kvádry, plošky skal) je kreslená
   * po jednotlivých jemných bodech. */
  const FINE_MAX = 40e6; // větší vlastní mapy zůstanou v art px (paměť)
  const TN = 256;
  let tnTex = null;

  // dlaždice jemného šumu 256x256 (opakuje se): shluky trávy, mikro odstíny
  function noiseTex() {
    if (tnTex) return tnTex;
    const a = new Float32Array(TN * TN);
    const b2 = new Float32Array(TN * TN);
    for (let y = 0; y < TN; y++) {
      for (let x = 0; x < TN; x++) {
        a[y * TN + x] = tnoise(x / 6, y / 6, TN / 6 | 0, 401) * 0.7 + tnoise(x / 2.5, y / 2.5, TN / 2.5 | 0, 402) * 0.3;
        b2[y * TN + x] = tnoise(x / 16, y / 16, TN / 16, 403);
      }
    }
    tnTex = { a, b: b2 };
    return tnTex;
  }

  function* bakeFineSteps(b) {
    const { W, H, zone, ashMap, rivE } = b;
    const rec = b.map.terrain;
    const F = b.F;
    const FW = W * 2;
    const FH = H * 2;
    const P = new Pix(FW, FH);
    const d = P.d;
    const zF = new Uint8Array(FW * FH);
    const { a: NA, b: NB } = noiseTex();
    const put = (j, c) => { d[j] = (0xff000000 | c) >>> 0; };

    // bilineární vzorkování art pole v jemném bodě
    const X0 = new Int32Array(FW), X1 = new Int32Array(FW), WX = new Float32Array(FW);
    const Y0 = new Int32Array(FH), Y1 = new Int32Array(FH), WY = new Float32Array(FH);
    for (let f = 0; f < FW; f++) {
      const s = f / 2 - 0.25;
      const x0 = Math.floor(s);
      X0[f] = clamp(x0, 0, W - 1); X1[f] = clamp(x0 + 1, 0, W - 1); WX[f] = s - x0;
    }
    for (let f = 0; f < FH; f++) {
      const s = f / 2 - 0.25;
      const y0 = Math.floor(s);
      Y0[f] = clamp(y0, 0, H - 1) * W; Y1[f] = clamp(y0 + 1, 0, H - 1) * W; WY[f] = s - y0;
    }
    let r0 = 0, r1 = 0, wy = 0;
    const bil = (A, fx) => {
      const x0 = X0[fx], x1 = X1[fx], wx = WX[fx];
      const t = A[r0 + x0] + (A[r0 + x1] - A[r0 + x0]) * wx;
      const u = A[r1 + x0] + (A[r1 + x1] - A[r1 + x0]) * wx;
      return t + (u - t) * wy;
    };

    // okraj mapy: 1D hrany v jemném rozlišení
    const topE = new Float32Array(FW), botE = new Float32Array(FW);
    const leftE = new Float32Array(FH), rightE = new Float32Array(FH);
    for (let f = 0; f < FW; f++) {
      const x = f / 2;
      topE[f] = 15 + 4 * fbm(x / 11, 3.3, 5, 2);
      botE[f] = H - 5.5 - 2.5 * fbm(x / 9, 8.1, 6, 2);
    }
    for (let f = 0; f < FH; f++) {
      const y = f / 2;
      leftE[f] = 4 + 3 * fbm(y / 10, 1.7, 7, 2);
      rightE[f] = W - 4.5 - 3 * fbm(y / 10, 5.9, 8, 2);
    }

    /* ---- hradby v jemné mřížce: koruna, pilíře u brány, průchod ---- */
    const wallF = new Uint8Array(rec.walls.length ? FW * FH : 0);
    const pierF = new Uint8Array(rec.walls.length ? FW * FH : 0);
    const fineStroke = (pts, pad, visit) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - pad) * 2));
        const x1 = Math.min(FW - 1, Math.ceil((Math.max(ax, bx) + pad) * 2));
        const y0 = Math.max(0, Math.floor((Math.min(ay, by) - pad) * 2));
        const y1 = Math.min(FH - 1, Math.ceil((Math.max(ay, by) + pad) * 2));
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy || 1;
        for (let fy = y0; fy <= y1; fy++) {
          const y = fy / 2 - 0.25;
          for (let fx = x0; fx <= x1; fx++) {
            const x = fx / 2 - 0.25;
            const t = clamp(((x - ax) * dx + (y - ay) * dy) / len2, 0, 1);
            visit(fy * FW + fx, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
          }
        }
      }
    };
    for (const wl of rec.walls) fineStroke(wl.pts, wl.hw * 1.5 + 3, (j, dd) => { if (dd < wl.hw * 1.5 + 1) wallF[j] = 1; });
    for (const wl of rec.walls) {
      for (let i = 0; i < wl.pts.length - 1; i++) {
        const [ax, ay] = wl.pts[i];
        const [bx, by] = wl.pts[i + 1];
        const dx = bx - ax, dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        for (const road of rec.roads) {
          for (let j = 0; j < road.pts.length - 1; j++) {
            const [cx, cy] = road.pts[j];
            const [ex, ey] = road.pts[j + 1];
            const rx = ex - cx, ry = ey - cy;
            const den = dx * ry - dy * rx;
            if (Math.abs(den) < 1e-6) continue;
            const u = ((cx - ax) * ry - (cy - ay) * rx) / den;
            const v = ((cx - ax) * dy - (cy - ay) * dx) / den;
            if (u < 0 || u > 1 || v < 0 || v > 1) continue;
            const gx = ax + dx * u, gy = ay + dy * u;
            const gap = road.w * 1.12;
            const half = wl.hw * 1.5 + 3;
            const reach = gap + 7;
            const x0 = Math.max(0, Math.floor((gx - reach - half) * 2)), x1 = Math.min(FW - 1, Math.ceil((gx + reach + half) * 2));
            const y0 = Math.max(0, Math.floor((gy - reach - half) * 2)), y1 = Math.min(FH - 1, Math.ceil((gy + reach + half) * 2));
            for (let fy = y0; fy <= y1; fy++) {
              for (let fx = x0; fx <= x1; fx++) {
                const x = fx / 2 - 0.25, y = fy / 2 - 0.25;
                const sA = (x - gx) * ux + (y - gy) * uy;
                const tA = -(x - gx) * uy + (y - gy) * ux;
                if (Math.abs(sA) >= gap && Math.abs(sA) < reach && Math.abs(tA) < half) {
                  wallF[fy * FW + fx] = 1;
                  pierF[fy * FW + fx] = 1;
                }
              }
            }
          }
        }
      }
    }
    if (rec.walls.length) {
      for (let fy = 0; fy < FH; fy++) {
        r0 = Y0[fy]; r1 = Y1[fy]; wy = WY[fy];
        for (let fx = 0; fx < FW; fx++) {
          const j = fy * FW + fx;
          if (wallF[j] && !pierF[j] && F.nd[(fy >> 1) * W + (fx >> 1)] < 1.6 && bil(F.nd, fx) < 1.12) wallF[j] = 0;
        }
      }
    }

    // terasy: okraje se mění po řádcích
    const terr = rec.terraces.map(T0 => {
      const e0 = new Float32Array(FH), e1 = new Float32Array(FH);
      for (let f = 0; f < FH; f++) {
        const y = f / 2;
        e0[f] = T0.x0 + (vnoise(y / 6, 1, 9) - 0.5) * 2;
        e1[f] = T0.x1 + (vnoise(y / 6, 2, 9) - 0.5) * 2;
      }
      return { T: T0, e0, e1 };
    });

    const deco = []; // drobnosti razítkované po hlavním průchodu: [druh, fx, fy, a]

    /* ---- textury ---- */
    // dlažba: řádky 5 jemných px (4 kámen + spára), kameny 6-8 px, každý s vlastním odstínem a osvětlenou hranou
    const cobbleF = (fx, fy, seed, ramp6) => {
      const row = (fy / 5) | 0;
      const ry = fy - row * 5;
      const wr = 6 + ((hash(row, 1, seed) * 3) | 0);
      const lx = fx + ((hash(row, 2, seed) * wr) | 0);
      const bx = (lx / wr) | 0;
      const rx = lx - bx * wr;
      if (ry === 4 || rx === wr - 1) return hash(fx, fy, seed + 5) > 0.88 ? G[1] : ramp6[1];
      const h = hash(bx, row, seed);
      let k = h > 0.72 ? 4 : h > 0.3 ? 3 : 2;
      if ((ry === 0 || ry === 3) && (rx === 0 || rx === wr - 2)) return mix(ramp6[1], ramp6[k - 1], 0.5);
      if (ry === 0 || rx === 0) k += 1;
      else if (ry === 3 || rx === wr - 2) k -= 1;
      else if (hash(fx, fy, seed + 6) > 0.93) k -= 1;
      return ramp6[k];
    };

    // čedič terasy: větší kvádry
    const basaltF = (fx, fy) => {
      const row = (fy / 8) | 0;
      const ry = fy - row * 8;
      const wr = 10 + ((hash(row, 3, 55) * 5) | 0);
      const lx = fx + ((hash(row, 4, 55) * wr) | 0);
      const bx = (lx / wr) | 0;
      const rx = lx - bx * wr;
      if (ry === 7 || rx === wr - 1) return C.b[0];
      const h = hash(bx, row, 55);
      let k = h > 0.78 ? 3 : h > 0.35 ? 2 : 1;
      if (ry === 0 || rx === 0) k += 1;
      else if (ry === 6 || rx === wr - 2) k -= 1;
      else if (hash(fx, fy, 56) > 0.95) k = Math.min(4, k + 1);
      return C.b[clamp(k, 0, 4)];
    };

    // zdivo: řádky 6 jemných px, kvádry 8-12 px
    const masonF = (fx, fy, base) => {
      const row = (fy / 6) | 0;
      const ry = fy - row * 6;
      const wr = 8 + ((hash(row, 3, 47) * 5) | 0);
      const lx = fx + ((hash(row, 5, 48) * 11) | 0);
      const bx = (lx / wr) | 0;
      const rx = lx - bx * wr;
      if (ry === 5 || rx === wr - 1) return S[base - 2];
      const h = hash(bx, row, 49);
      let k = base + (h > 0.78 ? 1 : h < 0.22 ? -1 : 0);
      if (ry === 0 || rx === 0) k += 1;
      else if (ry === 4) k -= 1;
      if (hash(fx >> 1, fy, 56) > 0.985) k -= 2;
      return S[clamp(k, 0, 6)];
    };

    // skalní plošky (Voronoi): každá ploška má vlastní sklon ke světlu zleva shora, hrany jsou rýhy
    const rockF = (fx, fy, depth) => {
      const cs = 10;
      const gx = Math.floor(fx / cs);
      const gy = Math.floor(fy / cs);
      let d1 = 1e9, d2 = 1e9, cx1 = 0, cy1 = 0, px1 = 0, py1 = 0, px2 = 0, py2 = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const cx = gx + ox, cy = gy + oy;
          const px = (cx + 0.15 + hash(cx, cy, 61) * 0.7) * cs;
          const py = (cy + 0.15 + hash(cx, cy, 62) * 0.7) * cs;
          const dd = (fx + 0.5 - px) ** 2 + (fy + 0.5 - py) ** 2;
          if (dd < d1) { d2 = d1; px2 = px1; py2 = py1; d1 = dd; cx1 = cx; cy1 = cy; px1 = px; py1 = py; }
          else if (dd < d2) { d2 = dd; px2 = px; py2 = py; }
        }
      }
      const lit = hash(cx1, cy1, 63) * 2 - 1; // sklon plošky
      const grad = ((fx - px1) + (fy - py1)) / cs; // uvnitř plošky světlo ubývá k pravému dolnímu rohu
      let t = 1.5 + depth * 2.2 + lit * 1.1 - grad * 0.6;
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      if (edge < 1.1) t += (px2 - px1) + (py2 - py1) > 0 ? -1.4 : 1.1;
      let k = clamp(dither(t, fx, fy, 0.5), 0, 5);
      if (depth > 0.62 && lit > 0.1 && edge >= 1.1) {
        const snow = (depth - 0.62) * 5 + lit - grad * 0.6;
        if (snow > 1.1 + bayer(fx, fy) * 0.5) return snow > 2.1 ? S[6] : S[5];
      }
      return S[k];
    };

    // listí okraje mapy: shluky lístků, každý osvětlený zleva shora
    const leafF = (fx, fy, base) => {
      const cs = 7;
      const gx = Math.floor(fx / cs);
      const gy = Math.floor(fy / cs);
      let best = 1e9, lx = 0, ly = 0, rr = 1, hc = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const cx = gx + ox, cy = gy + oy;
          const h = hash(cx, cy, 71);
          const r = 3 + h * 3;
          const px = (cx + 0.2 + hash(cx, cy, 72) * 0.6) * cs;
          const py = (cy + 0.2 + hash(cx, cy, 73) * 0.6) * cs;
          const dx = fx + 0.5 - px, dy = fy + 0.5 - py;
          const dd = (dx * dx + dy * dy) / (r * r) - py * 0.002; // nižší shluky překrývají vyšší
          if (dd < best) { best = dd; lx = dx / r; ly = dy / r; rr = r; hc = h; }
        }
      }
      if (best > 1.05) return G[0];
      let t = base + 1.2 - (lx + ly) * 0.9 + hc * 0.6;
      if (lx + ly > 0.75) t -= 1;
      return G[clamp(dither(t, fx, fy, 0.5), 0, 5)];
    };

    const V = C.v;
    const DA = D.map(c => mix(c, A[3], 0.28));
    const DRY = G.map(c => mix(c, D[2], 0.35));
    // pět odstínů trávy od chladného modrozeleného stínu po zlatavou louku
    const GH = [
      G.map(c => mix(c, C.t[1], 0.45)),
      G.map(c => mix(c, C.t[2], 0.22)),
      G,
      G.map(c => mix(c, C.a[2], 0.2)),
      G.map((c, k) => mix(c, k > 3 ? C.a[3] : C.d[3], 0.4))
    ];

    for (let fy = 0; fy < FH; fy++) {
      if ((fy & 7) === 7) yield 0.75 * fy / FH;
      r0 = Y0[fy]; r1 = Y1[fy]; wy = WY[fy];
      const Y = fy / 2;
      const ay = fy >> 1;
      const nrow = (fy & (TN - 1)) * TN;
      const nrow1 = ((fy + 1) & (TN - 1)) * TN;

      for (let fx = 0; fx < FW; fx++) {
        const X = fx / 2;
        const ai = ay * W + (fx >> 1);
        const j = fy * FW + fx;
        const na = NA[nrow + (fx & (TN - 1))];
        const na1 = NA[nrow1 + ((fx + 1) & (TN - 1))];
        const nb = NB[nrow + (fx & (TN - 1))];

        /* ---- základ: tráva nebo popel ---- */
        const lush = bil(F.lush, fx) + (nb - 0.5) * 0.16;
        const ash = lush < 0.5;
        const t0 = bil(F.tone, fx);
        const relief = (na - 0.5) * 0.8 + (na - na1) * 1.9 + (nb - 0.5) * 0.5;
        let col;
        let z = Z_GRASS;
        let tone;

        if (!ash) {
          tone = t0 + relief;
          const k = clamp(dither(tone, fx, fy, 0.5), 1, 5);
          // u popela je tráva vyprahlá
          const hv = clamp(dither(bil(F.hue, fx) + 2, fx, fy, 0.5), 0, 4);
          col = lush < 0.62 ? DRY[k] : GH[hv][k];
        } else {
          tone = 1.6 + (t0 - 2.55) * 0.94 + relief * 0.8;
          col = A[clamp(dither(tone, fx, fy, 0.5), 0, 4)];
        }

        /* ---- řeka a břehy ---- */
        let rs = 1e6;
        if (F.riv[ai] < 40) {
          rs = bil(F.riv, fx);
          if (rs < 0) {
            z = Z_WATER;
            const e = clamp(-rs / Math.max(1, F.rhw[ai]), 0, 1);
            col = V[clamp(dither(3.3 - e * 2.8, fx, fy, 0.6), 0, 4)];
          } else if (rs < 2.6) {
            z = Z_BANK;
            // mokrý pruh u vody, výš suchá hlína, oblázky
            const tb = rs < 0.45 ? 0.4 : 1.2 + rs * 0.75 + (na - 0.5) * 1.2;
            col = D[clamp(dither(tb, fx, fy, 0.5), 0, 4)];
            if (rs < 0.45) col = mix(D[1], V[1], 0.35);
            else if (rs < 0.8) col = D[1];
            else if (rs > 2.25) col = ash ? A[1] : G[1];
          } else if (rs < 3.2 && z === Z_GRASS) {
            col = ash ? A[1] : G[clamp(dither(tone - 1, fx, fy), 1, 4)];
          }
        }

        /* ---- cesty ---- */
        const nAi = F.nd[ai];
        if (nAi < 1.7) {
          const n = bil(F.nd, fx);
          if (n < 1) {
            const id = F.roadId[ai];
            const road = rec.roads[id];
            const main = road && road.main;
            const inFord = z === Z_WATER || z === Z_BANK;
            const wantStone = inFord || (main && F.paved(X, Y));
            z = Z_PATH;

            if (wantStone && n < 0.86 && vnoise(X / 9, Y / 9, 17) > (inFord ? 0.05 : 0.38)) {
              col = cobbleF(fx, fy, 3 + id, S);
              if (inFord && hash(fx, fy, 12) > 0.94) col = V[3];
            } else {
              // hlína: světlý střed, tmavý čistý okraj, vyjeté koleje na hlavních cestách
              let t = 4.25 - n * 2.6 + (na - 0.5) * 1.1 + (nb - 0.5) * 0.6;
              if (main && Math.abs(n - 0.46) < 0.05 && nb > 0.32) t = n < 0.46 ? 2.1 : 3.4;
              let k = clamp(dither(t, fx, fy, 0.5), 1, 5);
              if (n > 0.93) k = 1;
              else if (n > 0.86) k = Math.min(k, 2);
              col = ash ? DA[k] : D[k];
              if (hash(fx, fy, 15) > 0.9965) deco.push(1, fx, fy, 0);
            }
          } else if (n < 1.22 && z === Z_GRASS) {
            // tráva přerůstá přes okraj, těsně u cesty je tmavší
            if (n < 1.07) col = ash ? A[1] : G[clamp(dither(tone - 1.2, fx, fy), 1, 3)];
            else if (!ash && hash(fx, fy, 19) > 0.8) deco.push(0, fx, fy, 1);
          }
        }

        /* ---- náměstí ---- */
        if (F.pla[ai] < 1.6 && z !== Z_WATER) {
          const pr = bil(F.pla, fx);
          const p = rec.plazas[F.plaId[ai]];
          if (p && pr < 1) {
            z = Z_PLAZA;
            if (p.kind === "hall") {
              col = cobbleF(fx, fy, 9, S);
              // u okraje zarůstají spáry mechem, krajní kameny lemuje tmavá hrana
              if (pr > 0.78 && (col === S[1] || col === G[1]) && hash(fx, fy, 44) < (pr - 0.78) * 4) col = hash(fx, fy, 45) > 0.4 ? G[2] : G[3];
              if (pr > 0.965) col = S[1];
              const dx = (X - p.x) / p.rx, dy = (Y - p.y) / p.ry;
              const rr = Math.hypot(dx, dy) - 0.64;
              const ang = Math.atan2(dy, dx);
              // přerušený Kruh vsazený do dlažby (mosaz, světlá horní hrana)
              if (Math.abs(rr) < 0.042 && !(ang > -1.25 && ang < -0.35)) col = rr < -0.014 ? C.a[2] : rr > 0.014 ? C.a[0] : C.a[1];
            } else {
              const t = 2.6 + (na - 0.5) * 1.4;
              col = D[clamp(dither(t, fx, fy), 1, 4)];
              if (((fy >> 1) + (fx >> 4)) % 3 === 0 && na > 0.5) col = D[1];
              if (pr > 0.96) col = D[1];
            }
          } else if (p && pr < 1.05 && z === Z_GRASS) {
            col = G[1];
          } else if (p && pr < 1.1 && z === Z_GRASS && hash(fx, fy, 46) > 0.75) {
            deco.push(0, fx, fy, 2);
          }
        }

        /* ---- terasy (rudá pevnost) ---- */
        if (terr.length) for (const tr of terr) {
          const T0 = tr.T;
          const tx0 = tr.e0[fy], tx1 = tr.e1[fy];
          if (X >= tx0 && X <= tx1 && Y >= T0.y0 && Y < T0.y1) {
            z = Z_TERRACE;
            col = basaltF(fx, fy);
            if (Y < T0.y0 + 0.5) col = C.b[4];
            else if (X < tx0 + 0.5) col = C.b[3];
            else if (X > tx1 - 0.5) col = C.b[0];
          } else if (X >= tx0 && X <= tx1 && Y >= T0.y1 && Y < T0.y1 + T0.lip) {
            z = Z_TERRACE;
            const k = (Y - T0.y1) * 2;
            col = k < 1 ? C.b[4] : k < 2 ? C.b[3] : k >= T0.lip * 2 - 1 ? C.shade : k >= T0.lip * 2 - 3 ? C.b[0] : basaltF(fx + 3, fy) === C.b[0] ? C.b[0] : C.b[1 + (hash(fx >> 3, fy, 3) > 0.7 ? 1 : 0)];
          } else if (X >= tx0 + 3 && X <= tx1 + 4 && Y >= T0.y1 + T0.lip && Y < T0.y1 + T0.lip + 3 && z === Z_GRASS) {
            const k = (Y - T0.y1 - T0.lip) / 3;
            if (bayer(fx, fy) > k * 0.9) col = mix(col, C.shade, 0.5);
          }
        }

        /* ---- okraj mapy: útes nahoře, houští po stranách ---- */
        {
          const dT = topE[fx] - Y;
          const dB = Y - botE[fx];
          const dL = leftE[fy] - X;
          const dR = X - rightE[fy];

          if (dT > 0 || dB > 0 || dL > 0 || dR > 0) {
            z = Z_FRAME;
            if (dT >= dB && dT >= dL && dT >= dR && dT < 4.2) {
              // vrstvy útesu pod korunami: římsy s osvětlenou hranou
              const sy = Math.floor((fy + ((fx >> 4) & 1) * 2) / 3);
              const ry = (fy + ((fx >> 4) & 1) * 2) - sy * 3;
              let k = 1 + (hash(fx >> 2, sy, 2) > 0.6 ? 1 : 0);
              if (ry === 0) k += 1;
              if (ry === 2) k = 0;
              if (dT > 3.4) k = 3;
              else if (dT > 3.0) k = 2;
              col = S[k];
              if (hash(fx, fy, 8) > 0.93) col = G[2];
            } else {
              col = leafF(fx, fy, 1.4 - Math.min(1.2, Math.max(dT, dB, dL, dR) * 0.08));
            }
          } else if (dT > -3.2) {
            if (bayer(fx, fy) < (1 + dT / 3.2) * 0.9) col = mix(col, C.shade, 0.45);
          } else if (dB > -3 || dL > -3 || dR > -3) {
            const k = Math.max(dB, dL, dR);
            if (bayer(fx, fy) < (1 + k / 3) * 0.75) col = mix(col, C.shade, 0.35);
          }
        }

        /* ---- hory ---- */
        if (F.mtn[ai] < 9 && z !== Z_FRAME) {
          const ms = bil(F.mtn, fx);
          const r = F.mr[ai];
          if (ms < 0) {
            z = Z_ROCK;
            const depth = clamp(-ms / r, 0, 1);
            col = ms > -0.6 ? S[0] : ms > -1.1 ? S[1] : rockF(fx, fy, depth);
            if (depth < 0.3 && depth > 0.08 && hash(fx, fy, 37) > 0.97) col = G[2];
          } else if (ms < 5.5 && z === Z_GRASS) {
            // podhůří: suť na trávě, u skály tmavší
            const k = 1 - ms / 5.5;
            if (bayer(fx, fy) < k * 0.6) col = mix(col, S[1], 0.4);
            if (hash(fx, fy, 38) < 0.05 * k + 0.004) deco.push(2, fx, fy, k);
          }
        }

        /* ---- hradby ---- */
        if (rec.walls.length && z !== Z_FRAME && z !== Z_WATER) {
          const FACE = 12;
          let below = 0;
          if (!wallF[j]) for (let k = 1; k <= FACE && !below; k++) if (fy >= k && wallF[j - k * FW]) below = k;
          const gateOpen = !wallF[j] && F.nd[ai] < 1.6 && bil(F.nd, fx) < 1.12 && !(below && pierF[j - below * FW]);

          if (!gateOpen) {
            const moss = na > 0.7 && nb > 0.55 && hash(fx >> 1, fy >> 1, 59) > 0.45;
            if (wallF[j]) {
              z = Z_WALL;
              const north = !wallF[j - FW];
              const north2 = !wallF[j - 2 * FW] || !wallF[j - 3 * FW];
              const south = !wallF[j + FW];
              const merlon = (fx >> 3) % 2 === 0;
              col = masonF(fx, fy, 4);
              if (moss && (col === S[2] || na > 0.78)) col = na > 0.74 ? G[2] : G[1];
              if (north) col = merlon ? S[6] : S[2];
              else if (north2) col = merlon ? S[5] : S[1];
              else if (!wallF[j - 4 * FW] && merlon) col = S[3];
              if (south) col = S[1];
              if (pierF[j]) {
                const edge = north || south || !wallF[j - 1] || !wallF[j + 1] || !pierF[j - 1] || !pierF[j + 1] || !pierF[j - FW] || !pierF[j + FW];
                col = edge ? S[3] : (fx + fy) % 6 === 0 ? S[4] : S[5];
                if (!pierF[j - FW] || !pierF[j - 1]) col = S[6];
                if (!wallF[j + 1] || !pierF[j + 1] || !pierF[j + FW]) col = S[1];
              } else if (!wallF[j - 1]) col = S[5];
              else if (!wallF[j + 1]) col = S[0];
              else if (!wallF[j + 2]) col = S[2];
            } else if (below) {
              z = Z_WALL;
              col = masonF(fx, fy, 3);
              if (below <= 1) col = S[1];
              else if (below <= 2) col = S[4];
              if (below >= FACE - 1) col = S[1];
              if (moss && below >= 6) col = na > 0.72 ? G[1] : G[0];
              else if (below >= FACE - 2 && hash(fx >> 1, 0, 58) > 0.55) col = G[1];
            } else if (z === Z_GRASS || z === Z_PATH || z === Z_PLAZA) {
              let sh = 0;
              for (let k = FACE + 1; k <= FACE + 12 && !sh; k++) if (fy >= k && wallF[j - k * FW]) sh = k - FACE;
              if (!sh) for (let k = 1; k <= 10 && !sh; k++) if (fx >= k && wallF[j - k]) sh = k;
              if (sh && bayer(fx, fy) < 1.05 - sh / 12) col = mix(col, S[0], 0.55);
            }
          }
        }

        zF[j] = z;
        put(j, col);

        /* ---- drobnosti na volné zemi ---- */
        if (z === Z_GRASS) {
          const h = hash(fx, fy, 11);
          if (!ash) {
            const dens = 0.035 + clamp(tone - 2, 0, 3) * 0.012;
            const fl = bil(F.flw, fx);
            if (fl > 0.6 && h > 0.982 - (fl - 0.6) * 0.08) deco.push(3, fx, fy, 1 + ((hash((fx / 40) | 0, (fy / 40) | 0, 14) * 4) | 0));
            else if (h < dens) deco.push(0, fx, fy, tone);
            else if (h > 0.9988) deco.push(3, fx, fy, 0);
            else if (h > 0.9978) deco.push(1, fx, fy, 0);
          } else if (h > 0.9985) deco.push(4, fx, fy, 0);
          else if (h < 0.006) deco.push(5, fx, fy, tone);
        }
      }
    }

    yield 0.75;

    /* ---- razítka: stébla, oblázky, květy, škvarek ---- */
    const at = (x, y) => (x < 0 || y < 0 || x >= FW || y >= FH ? Z_FRAME : zF[y * FW + x]);
    const getC = (x, y) => d[y * FW + x] & 0xffffff;
    const setIf = (x, y, c, zz) => { if (x >= 0 && y >= 0 && x < FW && y < FH && (zz === undefined || zF[y * FW + x] === zz)) put(y * FW + x, c); };
    const RS = rng(91);

    for (let n = 0; n < deco.length; n += 4) {
      if ((n & 16383) === 16380) yield 0.75 + 0.1 * n / deco.length;
      const kind = deco[n], x = deco[n + 1], y = deco[n + 2], a = deco[n + 3];

      if (kind === 0) {
        // shluk stébel: 2-4 stébla 2-4 px, světlá špička, tmavá pata a stín vpravo dole
        const tn = clamp(Math.round(a), 1, 5);
        const nbl = 2 + ((RS() * 3) | 0);
        for (let k = 0; k < nbl; k++) {
          const bx = x + k * 2 - nbl + 1 + (RS() < 0.3 ? 1 : 0);
          const hgt = 2 + ((RS() * 3) | 0);
          const lean = RS() < 0.33 ? -1 : RS() < 0.5 ? 1 : 0;
          if (at(bx, y) !== Z_GRASS && at(bx, y) !== Z_PATH) continue;
          setIf(bx + 1, y + 1, G[Math.max(0, tn - 2)]);
          for (let s = 0; s < hgt; s++) {
            const px = bx + (s === hgt - 1 ? lean : 0);
            setIf(px, y - s, s === hgt - 1 ? G[Math.min(6, tn + 2)] : s === 0 ? G[Math.max(1, tn - 1)] : G[Math.min(5, tn + 1)]);
          }
        }
      } else if (kind === 1) {
        // oblázek 2x2 nebo 3x2: světlé temeno vlevo nahoře, stín vpravo dole
        const big = RS() < 0.35;
        const w = big ? 3 : 2;
        const ramp6 = RS() < 0.15 ? S : [D[1], D[1], D[2], D[3], D[4], D[5]];
        if (at(x, y) === Z_WATER) continue;
        for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < w; xx++) setIf(x + xx, y + yy, yy === 0 && xx === 0 ? ramp6[4] : yy === 1 && xx === w - 1 ? ramp6[2] : ramp6[3]);
        for (let xx = 0; xx < w; xx++) setIf(x + xx + 1, y + 2, mix(getC(Math.min(FW - 1, x + xx + 1), Math.min(FH - 1, y + 2)), C.shade, 0.45));
      } else if (kind === 2) {
        // suť u hor: hranatý kámen
        const w = 2 + ((RS() * 2.5 * (0.5 + a)) | 0);
        const h2 = Math.max(2, w - 1);
        for (let yy = 0; yy < h2; yy++) for (let xx = 0; xx < w; xx++) {
          if ((yy === 0 && xx === w - 1) || (yy === h2 - 1 && xx === 0)) continue;
          setIf(x + xx, y + yy, yy === 0 || xx === 0 ? S[4] : yy === h2 - 1 || xx === w - 1 ? S[2] : S[3], Z_GRASS);
        }
        for (let xx = 1; xx <= w; xx++) setIf(x + xx, y + h2, S[1], Z_GRASS);
      } else if (kind === 3) {
        // kvítek: čtyři okvětní lístky kolem středu, pod ním stonek
        const f = a ? (a - 1) * 0.25 + 0.05 + RS() * 0.35 * (RS() < 0.25) : RS();
        const c = f < 0.3 ? C.white : f < 0.55 ? C.a[3] : f < 0.78 ? C.cap[2] : C.m[3];
        const cd = mix(c, C.shade, 0.35);
        if (RS() < 0.5) {
          setIf(x, y - 1, c); setIf(x - 1, y, c); setIf(x + 1, y, cd); setIf(x, y + 1, cd);
          setIf(x, y, C.a[2]);
          setIf(x + 1, y + 2, G[1]);
        } else {
          setIf(x, y, c); setIf(x + 1, y, cd); setIf(x, y + 1, G[1]); setIf(x + 1, y + 1, G[0]);
        }
      } else if (kind === 4) {
        // škvarek v popelu: žhavé jádro
        setIf(x, y, C.r[3]); setIf(x + 1, y, C.r[1]); setIf(x, y + 1, C.r[1]); setIf(x - 1, y, A[0]);
      } else if (kind === 5) {
        // světlá vločka popela s tmavou stopou
        setIf(x, y, A[4]); setIf(x + 1, y + 1, A[1]);
      }
    }

    /* ---- žhnoucí pukliny v popelu (jemná čára, žhavé jádro, tmavý lem) ---- */
    const R = rng(77);
    for (const cr of rec.cracks) for (let k = 0; k < cr.n; k++) {
      let x = (cr.x + R() * cr.w) * 2;
      let y = (cr.y + R() * cr.h) * 2;
      let a = R() * Math.PI * 2;
      const len = (8 + R() * 22) * 2;
      let px = -1, py = -1;

      for (let s = 0; s < len; s++) {
        a += (R() - 0.5) * 0.6;
        x += Math.cos(a);
        y += Math.sin(a) * 0.7;
        const xi = Math.round(x);
        const yi = Math.round(y);
        if (xi < 4 || yi < 4 || xi >= FW - 4 || yi >= FH - 4) break;
        if (xi === px && yi === py) continue;
        px = xi; py = yi;
        if (zF[yi * FW + xi] !== Z_GRASS || !ashMap[(yi >> 1) * W + (xi >> 1)]) continue;
        // žár nejsilnější uprostřed pukliny, konce chladnou do tmavě rudé
        const heat = Math.sin(s / len * Math.PI) + (hash(s, k, 78) - 0.5) * 0.5;
        put(yi * FW + xi, heat > 0.9 ? C.r[4] : heat > 0.55 ? C.r[3] : heat > 0.25 ? C.r[2] : C.r[1]);
        setIf(xi + 1, yi + 1, C.b[0], Z_GRASS);
      }
    }

    /* ---- schody z terasy: čtyři jemné řádky na stupeň ---- */
    for (const T0 of rec.terraces) for (let k = 0; k < 3; k++) {
      const half = (12 - k * 2) * 2;
      const y0 = (T0.y1 + T0.lip + k * 2) * 2;
      const cx = T0.cx * 2 + 1;
      for (let y = y0; y < y0 + 4; y++) {
        for (let x = cx - half; x <= cx + half + 1; x++) {
          if (x < 0 || y < 0 || x >= FW || y >= FH) continue;
          let c = [C.b[4], C.b[3], C.b[2], C.b[0]][y - y0];
          if (x === cx - half) c = C.b[3];
          else if (x === cx + half + 1) c = C.b[0];
          else if (y - y0 === 1 && hash(x, y, 4) > 0.8) c = C.b[2];
          put(y * FW + x, c);
          zF[y * FW + x] = Z_TERRACE;
        }
      }
    }

    yield 0.85;
    b.water = yield* span(buildWaterSteps(b, zF, bil, (fy) => { r0 = Y0[fy]; r1 = Y1[fy]; wy = WY[fy]; }), 0.85, 1);
    b.F = null; // pole z art průchodu už nejsou potřeba
    return P;
  }

  /* ---------- voda: 4 animované snímky po dlaždicích 64x64 art px ---------- */
  function* buildWaterSteps(b, zF, bil, row) {
    const { W, H } = b;
    const FW = W * 2;
    const FH = H * 2;
    const CS = 128; // jemných px
    const out = [];
    const { a: NA } = noiseTex();
    const V = C.v;

    for (let cy = 0; cy < FH; cy += CS) {
      for (let cx = 0; cx < FW; cx += CS) {
        const w = Math.min(CS, FW - cx);
        const h = Math.min(CS, FH - cy);
        let any = false;
        for (let y = cy; y < cy + h && !any; y++) for (let x = cx; x < cx + w; x++) if (zF[y * FW + x] === Z_WATER) { any = true; break; }
        if (!any) continue;

        const frames = [];
        for (let f = 0; f < 4; f++) {
          const P = new Pix(w, h);
          for (let y = 0; y < h; y++) {
            const fy = cy + y;
            row(fy);
            for (let x = 0; x < w; x++) {
              const fx = cx + x;
              if (zF[fy * FW + fx] !== Z_WATER) continue;
              const e = clamp(bil(b.rivE, fx), 0, 1);
              const X = fx / 2, Y = fy / 2;
              let k = clamp(dither(3.3 - e * 2.8, fx, fy, 0.6), 0, 4);
              // vlnky: krátké světlé hřebeny unášené po proudu, za nimi tmavší důlek
              const ph = Y * (Math.PI * 2 / 7) + X * 0.42 + vnoise(X / 6, Y / 6, 3) * 4 - f * (Math.PI / 2);
              const wv = Math.sin(ph);
              const brk = NA[((fy & 255) << 8) + ((fx + f * 3) & 255)];
              if (wv > 0.86 && e > 0.1 && brk > 0.42) k = Math.min(4, k + 1);
              else if (wv < -0.93 && brk > 0.5) k = Math.max(0, k - 1);
              let c = V[k];
              // pěna u břehu
              if (e < 0.07 && ((fx + fy + f * 2) % 6) < 3) c = V[4];
              else if (e < 0.14 && ((fx * 3 + fy + f * 2) % 11) === 0) c = V[4];
              // oblázky na mělkém dně
              if (e < 0.32 && e > 0.08 && hash(fx, fy, 72) > 0.985) c = mix(D[3], V[2], 0.4);
              // záblesky na hřebenech
              if (hash(fx + f * 7, fy, 71) > 0.9965) c = C.white;
              P.set(x, y, c);
            }
          }
          const c = PK.fine(P);
          PK.hdOf(c);
          frames.push(c);
        }
        out.push({ x: cx / 2, y: cy / 2, w: w / 2, h: h / 2, frames });
        yield (cy + cx / FW * CS) / FH;
      }
    }

    return out;
  }

  /* ---------- grass tufts that sway ---------- */
  function buildTufts() {
    const frames = [];

    // trs 7x6 art px v jemné mřížce: sedm stébel různé výšky, ohýbají se od paty ke špičce
    const blades = [[6, 10, 3], [8, 8, 4], [4, 8, 3], [10, 6, 3], [2, 5, 2], [7, 5, 2], [12, 4, 2]];
    for (let f = 0; f < 3; f++) {
      const P = new Pix(14, 12);
      const lean = f - 1;

      // stín u paty
      for (let x = 3; x < 12; x++) P.set(x, 11, x < 10 ? G[1] : G[0]);

      for (const [bx, h, tone] of blades) {
        for (let k = 0; k < h; k++) {
          const bend = lean * (k * k) / (h * h) * 2.2 + (bx < 7 ? -0.3 : 0.3) * k / h;
          const x = Math.round(bx + bend);
          const c = k >= h - 2 ? G[tone + 2] : k >= h - 4 ? G[tone + 1] : k < 2 ? G[tone - 1] : G[tone];
          P.set(x, 10 - k, c);
        }
      }
      // světlé špičky na straně ke světlu
      P.set(Math.round(6 + lean * 2.2) - 1, 1, G[6]);

      frames.push(PK.fine(P));
    }

    const R = rng(311);
    const list = [];
    const tf = rec.tufts;

    for (let k = 0; k < tf.tries && list.length < tf.n; k++) {
      const x = tf.x + Math.floor(R() * tf.w);
      const y = tf.y + Math.floor(R() * tf.h);
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
    const R = rng(rec.seed);
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

    // ashMode: 0 = jen na bujné trávě, 1 = jen na popelu, bez hodnoty kdekoli
    // symetrické mapy: každý kousek výzdoby dostane zrcadlové dvojče (rec.mirror = { x, y })
    const orbit = (x, y) => {
      const m = rec.mirror;
      const pts = [[x, y]];
      if (m && m.x) pts.push([W - x, y]);
      if (m && m.y) pts.push([x, H - y]);
      if (m && m.x && m.y) pts.push([W - x, H - y]);
      return pts;
    };

    const scatter = (name, count, x0, x1, y0, y1, r = 8, ashMode) => {
      let placed = 0;
      const tries = ashMode == null ? 90 : 90 + count * 6;

      for (let k = 0; k < tries && placed < count; k++) {
        const x = x0 + R() * (x1 - x0);
        const y = y0 + R() * (y1 - y0);
        const pts = orbit(x, y);

        if (ashMode != null && pts.some(([px, py]) => world.ashMap[Math.round(py) * W + Math.round(px)] !== ashMode)) continue;
        if (pts.some(([px, py]) => blocked(px, py, r, false))) continue;
        if (pts.some((p, i) => pts.some((q, j) => j > i && Math.hypot(p[0] - q[0], (p[1] - q[1]) * 1.4) < r * 2))) continue;

        for (const [px, py] of pts) add(name, px, py, true, r);
        placed += pts.length;
      }
    };

    for (const [name, x, y, force, r] of rec.doodads.landmarks) add(name, x, y, force, r);

    // hory: vrcholy podél hřebene (u širokých horských pásů ve dvou řadách) a podhůří na okraji
    for (const m of rec.mountains) {
      const pts = m.pts;
      const wide = m.hw >= 14;
      const kind = m.hw < 9 ? "S" : m.hw < 17 ? "M" : "L";
      let carry = 0;

      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const nx = -(by - ay) / len;
        const ny = (bx - ax) / len;
        const step = Math.max(6, m.hw * (wide ? 0.62 : 0.85));

        for (let d = carry; d < len; d += step) {
          const t = d / len;
          const px = ax + (bx - ax) * t;
          const py = ay + (by - ay) * t;
          const rows = wide ? [-0.5, 0.5] : [0];

          for (const row of rows) {
            const off = (row + (R() - 0.5) * 0.35) * m.hw;
            const x = px + nx * off;
            const y = py + ny * off + (wide ? m.hw * 0.25 : 0);
            const size = kind === "L" && R() < 0.35 ? "M" : kind === "M" && R() < 0.25 ? "S" : kind;
            const variant = Math.floor(R() * 3);
            const sprite = dd[`peak${size}${variant}`];
            if (!sprite || x < 6 || x > W - 6 || y < 14 || y > H - 4) continue;
            list.push({ name: `peak${size}${variant}`, spr: sprite, x: Math.round(x), y: Math.round(y), r: 6, ph: R() * 6.28 });
          }

          carry = d + step - len;
        }

        carry = Math.max(0, carry);
      }

      // podhůří kolem hřebene
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const nx = -(by - ay) / len;
        const ny = (bx - ax) / len;

        for (let d = 4; d < len; d += 15 + R() * 20) {
          const side = R() < 0.5 ? -1 : 1;
          const off = side * (m.hw + 3 + R() * 4);
          const x = ax + (bx - ax) * (d / len) + nx * off;
          const y = ay + (by - ay) * (d / len) + ny * off;
          if (x > 10 && x < W - 10 && y > 24 && y < H - 8 && zone[Math.round(y) * W + Math.round(x)] === Z_GRASS) add("foothill", x, y, true, 6);
        }
      }
    }

    // hradby: věže na koncích, v lomech a po ~70 px; u cesty (brány) dvojice věží po stranách
    for (const wl of rec.walls) {
      const pts = wl.pts;
      const tower = (x, y) => {
        if (x < 8 || x > W - 8 || y < 18 || y > H - 4) return;
        if (list.some(d => d.name === "wallTower" && Math.hypot(d.x - x, d.y - y) < 12)) return;
        list.push({ name: "wallTower", spr: dd.wallTower, x: Math.round(x), y: Math.round(y + 2), r: 6, ph: 0 });
      };

    }
    for (const entry of rec.doodads.scatter) scatter(...entry);

    list.sort((a, b) => a.y - b.y);
    world.doodads = list;
  }

  /* ---------- atmosphere overlays ---------- */
  // Stíny mraků: dlaždice 240x240 art px, rozpad do průhlednosti ordered ditheringem v jemné mřížce.
  function buildClouds() {
    const N = 240;
    const P = new Pix(N * 2, N * 2);

    for (let y = 0; y < N * 2; y++) {
      for (let x = 0; x < N * 2; x++) {
        const ax = x / 2;
        const ay = y / 2;
        const n = tnoise(ax / 30, ay / 30, 8, 5) * 0.65 + tnoise(ax / (N / 17), ay / (N / 17), 17, 9) * 0.35;
        const p = smooth(0.5, 0.64, n);
        if (p > bayer(x, y) + 0.04) P.set(x, y, C.shade);
      }
    }

    return PK.fine(P);
  }

  function buildMist() {
    const out = [];

    for (let k = 0; k < 4; k++) {
      const w = 280;
      const h = 44;
      const P = new Pix(w, h);

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const fx = 1 - Math.abs(x - w / 2) / (w / 2);
          const fy = 1 - Math.abs(y - h / 2) / (h / 2);
          const n = tnoise(x / 18 + k * 3, y / 10, 16, 20 + k) * 0.8 + tnoise(x / 6, y / 4, 47, 30 + k) * 0.2;
          const v = fx * fy * (0.55 + n * 0.9);
          if (v > 0.55 + bayer(x, y) * 0.35) P.set(x, y, 0xcfd8ee);
        }
      }

      out.push(PK.fine(P));
    }

    return out;
  }

  // Vinjeta leží na obrazovce, ne na mapě, proto se generuje podle velikosti okna (v jemných px).
  let vignetteCache = { key: "", canvas: null };

  function vignetteFor(w, h) {
    const key = `${w}x${h}`;
    if (vignetteCache.key === key) return vignetteCache.canvas;

    const FW = w * 2;
    const FH = h * 2;
    const P = new Pix(FW, FH);

    for (let y = 0; y < FH; y++) {
      const dy = (y - FH / 2) / (FH / 2);
      const vy = Math.pow(Math.abs(dy), 2.4) * 0.9;
      for (let x = 0; x < FW; x++) {
        const dx = (x - FW / 2) / (FW / 2);
        const d = Math.pow(Math.abs(dx), 2.6) * 0.8 + vy;
        if (d < 0.35) continue;
        const v = smooth(0.35, 1.25, d) * 6;
        const lv = Math.floor(v + bayer(x, y) - 0.5 + 0.5);
        if (lv > 0) P.setA(x, y, 0x120e26, Math.min(190, lv * 31));
      }
    }

    vignetteCache = { key, canvas: PK.fine(P) };
    return vignetteCache.canvas;
  }

  function buildWarmth() {
    const P = new Pix(600, 300);

    for (let y = 0; y < 300; y++) {
      for (let x = 0; x < 600; x++) {
        const d = Math.hypot(x / 600, y / 300);
        const v = (1 - d) * 4.8;
        if (v <= 0) continue;
        const lv = Math.floor(v + bayer(x, y) - 0.5 + 0.5);
        if (lv > 0) P.setA(x, y, 0xffd98a, Math.min(34, lv * 7));
      }
    }

    return PK.fine(P);
  }

  // chladný fialový nádech v protějším (pravém dolním) rohu obrazovky, aby obraz měl přechod světla
  function buildCool() {
    const P = new Pix(600, 300);

    for (let y = 0; y < 300; y++) {
      for (let x = 0; x < 600; x++) {
        const d = Math.hypot(1 - x / 600, 1 - y / 300);
        const v = (1 - d) * 5;
        if (v <= 0) continue;
        const lv = Math.floor(v + bayer(x, y) - 0.5 + 0.5);
        if (lv > 0) P.setA(x, y, 0x3c2a6b, Math.min(56, lv * 11));
      }
    }

    return PK.fine(P);
  }

  /* ---------- build ---------- */
  // Teren každé mapy se peče jen jednou; náhled v lobby a samotná hra sdílejí stejný výsledek.
  const bundles = new Map();

  function newBundle(map) {
    const [w, h] = map.size;
    return {
      map, W: w, H: h,
      zone: new Uint8Array(w * h),
      toneMap: new Uint8Array(w * h),
      ashMap: new Uint8Array(w * h),
      rivE: new Float32Array(w * h)
    };
  }

  // doběhne krokové pečení najednou a vrátí jeho výsledek
  function drain(steps) {
    for (;;) {
      const r = steps.next();
      if (r.done) return r.value;
    }
  }

  // průběh dílčího pečení 0..1 přepočtený do úseku lo..hi
  function* span(steps, lo, hi) {
    for (;;) {
      const r = steps.next();
      if (r.done) return r.value;
      yield lo + (hi - lo) * r.value;
    }
  }

  function bundleFor(map) {
    let b = bundles.get(map.id);

    if (!b) {
      b = newBundle(map);
      b.canvas = drain(buildTerrainSteps(b));
      bundles.set(map.id, b);
    }

    return b;
  }

  /* Upeče terén mapy (hrubý i jemný) po kouscích, aby načítací obrazovka
   * mezi nimi stihla překreslit průběh 0..1. Hotová mapa se už nepeče. */
  function* prepare(map) {
    let b = bundles.get(map.id);

    if (!b) {
      b = newBundle(map);
      b.canvas = yield* span(buildTerrainSteps(b), 0, 0.3);
      bundles.set(map.id, b);
    }

    if (b.fine === false) {
      const P = yield* span(bakeFineSteps(b), 0.3, 0.97);
      b.fine = true;
      PK.hdLater(b.canvas, P.rawCanvas());
    }

    yield 1;
  }

  const isPrepared = map => {
    const b = bundles.get(map.id);
    return !!b && b.fine !== false;
  };

  function activate(b) {
    W = b.W;
    H = b.H;
    rec = b.map.terrain;
    zone = b.zone;
    Object.assign(world, {
      W, H, zone, map: b.map, terrain: b.canvas,
      toneMap: b.toneMap, ashMap: b.ashMap, rivE: b.rivE
    });
  }

  const layoutOf = map => ({
    buildings: map.slots.flatMap(s => [s.hq, ...s.buildings]),
    resources: [
      ...map.gold.map(([x, y]) => ({ type: "gold", x, y })),
      ...map.trees.map(([x, y]) => ({ type: "wood", x, y }))
    ]
  });

  // Zmenšený teren se zachováním poměru stran, vejde se do maxW x maxH.
  function scaled(src, maxW, maxH) {
    const s = Math.min(maxW / src.width, maxH / src.height);
    const mm = makeCanvas(Math.max(1, Math.round(src.width * s)), Math.max(1, Math.round(src.height * s)));
    mm.g.imageSmoothingEnabled = true;
    mm.g.drawImage(src, 0, 0, mm.c.width, mm.c.height);
    mm.g.imageSmoothingEnabled = false;
    return mm.c;
  }

  function build(map) {
    if (world.ready && world.map === map) return;

    const b = bundleFor(map);
    activate(b);
    // jemný terén (a s ním vodu) upéct hned při načtení mapy, ne v prvním snímku
    PK.hdOf(world.terrain);
    world.water = b.water || [];
    world.tuftFrames = buildTufts();
    placeDoodads(layoutOf(map));
    if (!world.clouds) world.clouds = buildClouds();
    if (!world.mist) world.mist = buildMist();
    if (!world.warmth) world.warmth = buildWarmth();
    world.mistLanes = rec.mist;
    world.minimap = scaled(world.terrain, 88, 48);
    world.ready = true;
  }

  const preview = (map, maxW, maxH) => scaled(bundleFor(map).canvas, maxW, maxH);

  // Upravená mapa se stejným id se musí upečt znovu.
  function forget(id) {
    bundles.delete(id);
    if (world.map && world.map.id === id) world.ready = false;
  }

  /* ---------- forest beyond the map border ---------- */
  let forestPattern = null;

  // Les za okrajem mapy: vzorek se peče rovnou v jemné hustotě (podrost ze shluků listí,
  // jemná dvojčata stromů) a kreslí se se zmenšením 0.5, takže 1 bod vzorku = 1 jemný px.
  function buildForest() {
    const TW = 192;
    const TH = 144;
    const FW = TW * 2;
    const FH = TH * 2;
    const P = new Pix(FW, FH);

    // podrost: shluky listí na mřížce, která se opakuje s dlaždicí
    const cs = 8;
    const gw = FW / cs;
    const gh = FH / cs;
    for (let y = 0; y < FH; y++) {
      for (let x = 0; x < FW; x++) {
        const gx = Math.floor(x / cs);
        const gy = Math.floor(y / cs);
        let best = 1e9, lx = 0, ly = 0, hc = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const cx = gx + ox, cy = gy + oy;
            const wx = ((cx % gw) + gw) % gw, wy = ((cy % gh) + gh) % gh;
            const h = hash(wx, wy, 81);
            const r = 4 + h * 3;
            const px = (cx + 0.2 + hash(wx, wy, 82) * 0.6) * cs;
            const py = (cy + 0.2 + hash(wx, wy, 83) * 0.6) * cs;
            const dx = x + 0.5 - px, dy = y + 0.5 - py;
            const dd = (dx * dx + dy * dy) / (r * r) - py * 0.0015;
            if (dd < best) { best = dd; lx = dx / r; ly = dy / r; hc = h; }
          }
        }
        let t = 1.6 - (lx + ly) * 0.9 + hc * 0.5;
        if (best > 1.0) t = 0.2;
        else if (lx + ly > 0.8) t -= 1;
        P.set(x, y, G[clamp(dither(t, x, y, 0.5), 0, 3)]);
      }
    }

    const { c, g } = makeCanvas(FW, FH);
    g.imageSmoothingEnabled = false;
    g.drawImage(P.rawCanvas(), 0, 0);

    const R = rng(4242);
    const spots = [];
    for (let i = 0; i < 26; i++) spots.push([R() * TW, R() * TH, PK.props.treeKind(R())]);
    spots.sort((a, b) => a[1] - b[1]);

    // stromy přesahující okraj dlaždice se kreslí i na protější straně, aby na sebe navazovaly
    for (const [x, y, k] of spots) {
      const t = PK.props.trees[k];
      const trunk = PK.hdOf(t.trunk) || t.trunk;
      const crown = PK.hdOf(t.crown[0]) || t.crown[0];
      for (let ox = -TW; ox <= TW; ox += TW) {
        for (let oy = -TH; oy <= TH; oy += TH) {
          const fx = Math.round((x + ox) * 2) / 2 - t.ax;
          const fy = Math.round((y + oy) * 2) / 2 - t.ay;
          if (fx > TW || fy > TH || fx + 80 < 0 || fy + 90 < 0) continue;
          g.drawImage(trunk, Math.round(fx * 2), Math.round(fy * 2), t.trunk.width * 2, t.trunk.height * 2);
          g.drawImage(crown, Math.round(fx * 2), Math.round(fy * 2), t.crown[0].width * 2, t.crown[0].height * 2);
        }
      }
    }

    g.fillStyle = "rgba(21,18,31,0.42)";
    g.fillRect(0, 0, FW, FH);
    const pat = g.createPattern(c, "repeat");
    if (pat.setTransform && typeof DOMMatrix !== "undefined") pat.setTransform(new DOMMatrix([0.5, 0, 0, 0.5, 0, 0]));
    return pat;
  }

  function drawForest(g, v) {
    if (!forestPattern) forestPattern = buildForest();
    g.fillStyle = forestPattern;
    const x1 = v.x + v.w;
    const y1 = v.y + v.h;
    if (v.y < 0) g.fillRect(v.x, v.y, v.w, -v.y);
    if (y1 > H) g.fillRect(v.x, H, v.w, y1 - H);
    const top = Math.max(0, v.y);
    const bot = Math.min(H, y1);
    if (v.x < 0) g.fillRect(v.x, top, -v.x, bot - top);
    if (x1 > W) g.fillRect(W, top, x1 - W, bot - top);
  }

  /* ---------- per-frame drawing ---------- */
  // v = vydělý obdelník světa v art px: { x, y, w, h }; kreslí se ve světových souřadnicích.
  function drawGround(g, T, v) {
    if (v.x < 0 || v.y < 0 || v.x + v.w > W || v.y + v.h > H) drawForest(g, v);

    const sx = Math.max(0, v.x);
    const sy = Math.max(0, v.y);
    const ex = Math.min(W, v.x + v.w);
    const ey = Math.min(H, v.y + v.h);
    if (ex <= sx || ey <= sy) return;

    g.drawImage(world.terrain, sx, sy, ex - sx, ey - sy, sx, sy, ex - sx, ey - sy);

    const wf = Math.floor(T * 3.2) & 3;
    for (const r of world.water) {
      if (r.x < ex && r.x + r.w > sx && r.y < ey && r.y + r.h > sy) g.drawImage(r.frames[wf], r.x, r.y);
    }

    const frames = world.tuftFrames;

    for (const t of world.tufts) {
      if (t.x < sx - 4 || t.x > ex + 4 || t.y < sy - 2 || t.y > ey + 6) continue;
      const s = Math.sin(T * 1.7 + t.ph + t.x * 0.04);
      const f = s > 0.45 ? 2 : s < -0.45 ? 0 : 1;
      g.drawImage(frames[f], t.x - 3, t.y - 5);
    }
  }

  // Mraky, mlha a vinjeta se kreslí na obrazovku (g bez posunutí kamery); v je pozice kamery.
  function drawClouds(g, T, v) {
    g.globalAlpha = 0.17;
    const ox = Math.floor(T * 6) / 2;
    const oy = Math.floor(T * 1.6) / 2;

    for (let i = Math.floor((v.x + ox) / 240); i * 240 - ox < v.x + v.w; i++) {
      for (let j = Math.floor((v.y + oy) / 240); j * 240 - oy < v.y + v.h; j++) {
        g.drawImage(world.clouds, i * 240 - ox - v.x, j * 240 - oy - v.y, 240, 240);
      }
    }

    g.globalAlpha = 1;
  }

  function drawMist(g, T, v) {
    g.globalAlpha = 0.1;

    world.mistLanes.forEach(([x, y, vel], k) => {
      const spr = world.mist[k % 4];
      const px = Math.round((((x + T * vel) % (W + spr.width)) - spr.width) * 2) / 2;
      g.drawImage(spr, px - v.x, y + Math.round(Math.sin(T * 0.4 + k) * 2) - v.y);
    });

    g.globalAlpha = 1;
  }

  function drawGrade(g, w, h) {
    g.globalCompositeOperation = "lighter";
    g.drawImage(world.warmth, 0, 0);
    g.globalCompositeOperation = "source-over";
    if (!world.cool) world.cool = buildCool();
    g.drawImage(world.cool, w - 300, h - 150);
    g.drawImage(vignetteFor(w, h), 0, 0);
  }

  /* additive light: draws a banded glow centred on (x, y) */
  function light(g, x, y, r, color, alpha) {
    g.globalAlpha = alpha;
    g.globalCompositeOperation = "lighter";
    g.drawImage(glow(r, color), Math.round(x * 2) / 2 - r, Math.round(y * 2) / 2 - r);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
  }

  Object.assign(world, {
    build, prepare, isPrepared, preview, forget, drawGround, drawClouds, drawMist, drawGrade, light, glow, shadow,
    zoneAt: (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? Z_FRAME : zone[(y | 0) * W + (x | 0)]),
    Z: { GRASS: Z_GRASS, PATH: Z_PATH, PLAZA: Z_PLAZA, WATER: Z_WATER, FRAME: Z_FRAME, TERRACE: Z_TERRACE, BANK: Z_BANK, ROCK: Z_ROCK, WALL: Z_WALL }
  });

  PK.world = world;
})();
