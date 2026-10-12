/*
 * Stromy, zlatý důl a drobnosti, které oživují mýtinu.
 * Všechno vysoké a "pochozí" je interaktivní; dekorace zůstávají pod
 * výškou kolen nebo stojí na okrajích mapy.
 *
 * Kreslí se přímo v jemné mřížce (PK.HD = 2): každý sprite je
 * Pix(w * HD, h * HD) a vrací se přes PK.fine(). Rozměry, kotvy a všechna
 * metadata (fruit, sparkle, glow, ground, flame) zůstávají v art px.
 * Textury (kůra, listí, jehličí, kámen, prkna) se počítají po jemných px.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const { C, Pix, mix, hash, vnoise, rng, bayer, HD } = PK;

  const G = C.g;
  const S = C.s;

  /* ---------- rozšířené rampy: index 0 je hluboký stín posunutý do fialova ---------- */
  const GX = [mix(G[0], C.shade, 0.45), ...G];
  const SX = [mix(S[0], C.shade, 0.5), ...S];
  const WX = [mix(C.w[0], C.shade, 0.45), ...C.w];
  const HX = [mix(C.h[0], C.shade, 0.5), ...C.h];
  const BX = [mix(C.b[0], C.shade, 0.3), ...C.b];
  const BONE = [mix(C.bone[2], C.dusk, 0.45), C.bone[2], mix(C.bone[2], C.bone[1], 0.5), C.bone[1], mix(C.bone[1], C.bone[0], 0.5), C.bone[0], mix(C.bone[0], C.white, 0.5)];
  const GOLD = [mix(C.gold[0], C.r[0], 0.45), C.gold[0], mix(C.gold[0], C.gold[1], 0.5), C.gold[1], mix(C.gold[1], C.gold[2], 0.5), C.gold[2], C.white];
  const PINE = [mix(G[0], C.t[0], 0.6), mix(G[0], C.t[0], 0.25), G[1], mix(G[1], G[2], 0.5), G[2], mix(G[2], G[3], 0.5), G[3], mix(G[3], G[4], 0.6)];

  const pick = (ramp, t) => ramp[t <= 0 ? 0 : t >= ramp.length - 1 ? ramp.length - 1 : Math.round(t)];
  const mk = (w, h) => new Pix(w * HD, h * HD);
  const ART = v => v / HD;

  function inPoly(pts, x, y) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0];
      const yi = pts[i][1];
      const xj = pts[j][0];
      const yj = pts[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  function boxOf(pts) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return [Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1)];
  }

  /* ---------- vrstvy: shluky listí, patra jehličí ----------
   * Každá vrstva vyplní tón do mapy a zapíše své id. Pozdější vrstva leží
   * vpředu: vrhá 1-2 px stín doprava dolů na vrstvy za sebou a její
   * levý horní okraj dostane světlou hranu. */
  function stack(w, h) {
    return { w, h, id: new Int16Array(w * h).fill(-1), t: new Float32Array(w * h), n: 0 };
  }

  function layer(L, box, fill) {
    const k = L.n++;
    const x0 = Math.max(0, Math.floor(box[0]));
    const y0 = Math.max(0, Math.floor(box[1]));
    const x1 = Math.min(L.w - 1, Math.ceil(box[2]));
    const y1 = Math.min(L.h - 1, Math.ceil(box[3]));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const v = fill(x, y);
        if (v == null) continue;
        L.id[y * L.w + x] = k;
        L.t[y * L.w + x] = v;
      }
    }

    return k;
  }

  function relight(L, o) {
    const { w, h, id, t } = L;
    const out = new Float32Array(t);
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : id[y * w + x]);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const a = id[i];
        if (a < 0) continue;
        let v = t[i];
        const u = at(x, y - 1);
        const l = at(x - 1, y);
        const ul = at(x - 1, y - 1);

        if (u > a || l > a || ul > a) v -= o.occ;
        else if (at(x, y - 2) > a || at(x - 2, y) > a || at(x - 1, y - 2) > a) v -= o.occ2;
        else if (u !== a || l !== a) v += o.rim;

        if (at(x, y + 1) < 0 || at(x + 1, y) < 0) v -= o.under;
        out[i] = v;
      }
    }

    L.t = out;
  }

  function paintStack(P, L, color) {
    for (let y = 0; y < L.h; y++) {
      for (let x = 0; x < L.w; x++) {
        const i = y * L.w + x;
        if (L.id[i] >= 0) P.set(x, y, color(L.t[i], x, y, L.id[i]));
      }
    }
  }

  /* Shluk listí: vroubkovaný okraj, světlo zleva shora, pár 1px lístků. */
  function clumpFill(c, glob) {
    const { x: cx, y: cy, r, ry, s } = c;
    const k = Math.max(4, Math.round(r * 1.15));
    const ph = hash(s, 1, 3) * 6.28;

    return (x, y) => {
      const nx = (x + 0.5 - cx) / r;
      const ny = (y + 0.5 - cy) / ry;
      const d = Math.hypot(nx, ny);
      if (d > 1.16) return null;
      const e = 1 + 0.15 * Math.sin(Math.atan2(ny, nx) * k + ph);
      if (d > e) return null;
      const l = -(nx * 0.6 + ny * 0.8);
      let v = glob(x, y) + l * 1.7;
      if (d > 0.72 && l < -0.1) v -= 0.5;
      const hh = hash(x, y, s);
      if (l > 0.45 && hh > 0.93) v += 1.2;
      else if (l < -0.2 && hh > 0.95) v -= 0.8;
      return v;
    };
  }

  const clumpBox = c => [c.x - c.r * 1.16 - 1, c.y - c.ry * 1.16 - 1, c.x + c.r * 1.16 + 1, c.y + c.ry * 1.16 + 1];

  function crownClumps(lobes, seed, rmin, rmax) {
    const R = rng(seed);
    const out = [];

    for (const [cx, cy, rx, ry] of lobes) {
      const n = Math.max(3, Math.round(rx * ry / (rmax * rmax * 0.62)));
      for (let i = 0; i < n; i++) {
        const a = R() * 6.283;
        const d = Math.sqrt(R()) * 0.6;
        const r = rmin + R() * (rmax - rmin);
        out.push({ x: cx + Math.cos(a) * d * rx, y: cy + Math.sin(a) * d * ry, r, ry: r * 0.85, s: seed + out.length * 7 });
      }
      const m = Math.round((rx + ry) / 4.5);
      for (let i = 0; i < m; i++) {
        const a = (i / m) * 6.283 + R() * 0.5;
        const r = rmin + R() * (rmax - rmin) * 0.6;
        out.push({ x: cx + Math.cos(a) * (rx - r * 0.85), y: cy + Math.sin(a) * (ry - r * 0.85), r, ry: r * 0.85, s: seed + out.length * 7 });
      }
    }

    out.sort((a, b) => (a.y + a.r * 0.4) - (b.y + b.r * 0.4));
    return out;
  }

  /* Pořadí, v jakém shluky při těžbě mizí: nejdřív vnější a horní. */
  function thinOrder(list, cx, cy, rx, ry, seed) {
    list.forEach((c, i) => {
      const d = Math.hypot((c.x - cx) / rx, (c.y - cy) / ry);
      c.keep = hash(i, 9, seed) * 0.55 + (1 - Math.min(1, d)) * 0.45;
    });
  }

  const foliageColor = ramp => t => (t > 5.6 ? ramp[ramp.length - 1] : pick(ramp, t + 1));

  /* ---------- tvary: větev / kořen / kost (zúžená válcová tyč) ---------- */
  function limb(P, x0, y0, x1, y1, w0, w1, ramp, o = {}) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    let nx = -uy;
    let ny = ux;
    if (nx * -0.6 + ny * -0.8 < 0) { nx = -nx; ny = -ny; }
    const face = Math.min(1, 0.35 + Math.abs(nx * -0.6 + ny * -0.8));
    const m = Math.max(w0, w1) / 2 + 1;
    const base = o.base ?? 2.6;

    for (let y = Math.floor(Math.min(y0, y1) - m); y <= Math.ceil(Math.max(y0, y1) + m); y++) {
      for (let x = Math.floor(Math.min(x0, x1) - m); x <= Math.ceil(Math.max(x0, x1) + m); x++) {
        const rx = x + 0.5 - x0;
        const ry = y + 0.5 - y0;
        const s = (rx * ux + ry * uy) / len;
        if (s < 0 || s > 1) continue;
        const d = rx * nx + ry * ny;
        const hw = (w0 + (w1 - w0) * s) / 2;
        if (Math.abs(d) > hw) continue;
        const q = d / hw;
        let v = base + q * 1.4 * face;
        if (q > 0.55) v += 0.35;
        if (o.grain !== false && hw > 1.1) {
          const lane = Math.round(d + 40);
          if (hash(lane, Math.floor((s * len + hash(lane, 5, o.seed || 0) * 6) / (o.gl || 6)), o.seed || 0) > 0.8) v -= 0.9;
        }
        if (o.tone) v = o.tone(v, x, y, s, q);
        P.set(x, y, pick(ramp, v));
      }
    }
  }

  /* Kmen: řádky [l, r] od y0 do y1; kůra s vertikálními rýhami a plátky. */
  function barkTrunk(P, y0, y1, edge, seed, o = {}) {
    const ramp = o.ramp || WX;
    const groove = x => {
      const lane = x + 100;
      return y => hash(lane, Math.floor((y + hash(lane, 3, seed) * 13) / (6 + (lane % 4))), seed) > 0.7;
    };

    for (let y = y0; y <= y1; y++) {
      const [l, r] = edge(y);
      const xa = Math.round(l);
      const xb = Math.round(r) - 1;

      for (let x = xa; x <= xb; x++) {
        const rel = (x - xa + 0.5) / (xb - xa + 1);
        let v = (o.base ?? 4.1) - rel * 3.1;
        if (x === xa) v += 0.6;
        if (x === xb) v -= 0.4;
        if (groove(x)(y)) v -= 1.1;
        else if (x > xa && groove(x - 1)(y) && rel < 0.7) v += 0.5;
        let c = pick(ramp, v);
        if (o.moss && rel < 0.5 && y > y1 - o.moss && vnoise(x / 3, y / 2.5, seed) > 0.56) {
          c = pick(GX, 4.2 - rel * 4 + (groove(x)(y) ? -1 : 0));
        }
        P.set(x, y, c);
      }
    }
  }

  /* ---------- kámen: plochy (Voronoi), hrany, mech, praskliny ---------- */
  function rock(P, pts, o = {}) {
    const ramp = o.ramp || SX;
    const seed = o.seed || 1;
    const R = rng(seed * 31 + 7);
    const [x0, y0, x1, y1] = boxOf(pts);
    const cx = o.cx ?? (x0 + x1) / 2;
    const cy = o.cy ?? (y0 + y1) / 2;
    const rx = Math.max(1, (x1 - x0) / 2);
    const ry = Math.max(1, (y1 - y0) / 2);
    const n = o.facets || Math.max(3, Math.round((x1 - x0) * (y1 - y0) / (o.area || 70)));
    const seeds = [];

    for (let g = 0; seeds.length < n && g < 900; g++) {
      const sx = x0 + R() * (x1 - x0);
      const sy = y0 + R() * (y1 - y0);
      if (inPoly(pts, sx, sy)) seeds.push([sx, sy]);
    }
    if (!seeds.length) seeds.push([cx, cy]);

    const ft = seeds.map(([sx, sy]) => {
      const nx = (sx - cx) / rx;
      const ny = (sy - cy) / ry;
      let v = (o.base ?? 3.4) - (nx * 0.8 + ny * 0.9) * (o.gain ?? 1.3) + (R() - 0.5) * (o.jit ?? 0.9);
      if (o.facetTone) v = o.facetTone(sx, sy, v, R);
      return v;
    });

    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const fid = new Int16Array(bw * bh).fill(-1);
    const tone = new Float32Array(bw * bh);
    const sx2 = o.stretch || 1;
    const at = (x, y) => (x < x0 || y < y0 || x > x1 || y > y1 ? -1 : fid[(y - y0) * bw + x - x0]);

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!inPoly(pts, x + 0.5, y + 0.5)) continue;
        if (o.mask && !o.mask(x, y)) continue;
        let best = 0;
        let bd = Infinity;
        for (let k = 0; k < seeds.length; k++) {
          const ddx = (x + 0.5 - seeds[k][0]) / sx2;
          const ddy = y + 0.5 - seeds[k][1];
          const dd = ddx * ddx + ddy * ddy;
          if (dd < bd) { bd = dd; best = k; }
        }
        fid[(y - y0) * bw + x - x0] = best;
      }
    }

    const ytop = new Int16Array(bw).fill(-1);
    const ybot = new Int16Array(bw).fill(-1);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        if (at(x, y) < 0) continue;
        if (ytop[x - x0] < 0) ytop[x - x0] = y;
        ybot[x - x0] = y;
      }
    }

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const f = at(x, y);
        if (f < 0) continue;
        let v = ft[f];
        const u = at(x, y - 1);
        const l = at(x - 1, y);
        if (u < 0 || l < 0) v += 0.75;
        else if (u !== f || l !== f) {
          const j = u !== f ? u : l;
          v += ft[f] >= ft[j] ? 0.65 : -0.7;
        }
        if (at(x, y + 1) < 0 || at(x + 1, y) < 0) v -= 0.55;
        if (y >= ybot[x - x0] - 1) v -= 0.5;
        if (!o.clean && hash(x, y, seed) > 0.975) v -= 0.8;
        tone[(y - y0) * bw + x - x0] = v;
      }
    }

    // praskliny: tmavá linka, vpravo od ní světlý okraj
    for (let k = 0; k < (o.cracks || 0); k++) {
      let px = x0 + bw * (0.25 + R() * 0.5);
      let py = y0 + bh * (0.25 + R() * 0.35);
      const len = 4 + Math.floor(R() * (o.crackLen || 6));
      for (let i = 0; i < len; i++) {
        const ix = Math.round(px);
        const iy = Math.round(py);
        if (at(ix, iy) >= 0) {
          tone[(iy - y0) * bw + ix - x0] = 0.3;
          if (at(ix + 1, iy) >= 0) tone[(iy - y0) * bw + ix + 1 - x0] += 0.6;
        }
        px += R() < 0.5 ? (R() < 0.5 ? -1 : 1) : 0;
        py += 1;
      }
    }

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const f = at(x, y);
        if (f < 0) continue;
        const v = tone[(y - y0) * bw + x - x0];
        let c = o.color ? o.color(v, x, y, f) : pick(ramp, v);

        if (o.moss) {
          const side = 1 - (x - x0) / bw * (o.mossRight ? 0.2 : 0.75);
          const depth = o.moss * side * (0.35 + vnoise(x / 6, 3.3, seed + 4) * 1.1);
          const dy = y - ytop[x - x0];
          if (dy < depth && vnoise(x / 7, y / 5, seed + 9) > 0.38) {
            let m = 4.6 - dy / depth * 2.2 - (x - x0) / bw * 1.2;
            if (dy === 0) m += 0.6;
            if (dy >= depth - 1) m -= 0.8;
            if (hash(x, y, seed + 2) > 0.9) m += 0.8;
            c = pick(GX, m);
          }
        }

        P.set(x, y, c);
      }
    }

    return { at, ytop: x => (x < x0 || x > x1 ? -1 : ytop[x - x0]) };
  }

  /* ---------- zdivo: kvádry 6-12 jemných px s maltou ---------- */
  function blocks(P, x0, y0, w, h, o = {}) {
    const ramp = o.ramp || SX;
    const R = rng(o.seed || 5);
    const rowH = o.rowH || 5;
    const minW = o.minW || 7;
    const maxW = o.maxW || 12;
    const light = o.light || (() => 0);

    for (let ry = 0, row = 0; ry < h; ry += rowH, row++) {
      const bh = Math.min(rowH, h - ry);
      let bx = -Math.floor(R() * minW);

      while (bx < w) {
        const bw = minW + Math.floor(R() * (maxW - minW + 1));
        const base = (o.base ?? 3.6) + (R() - 0.5) * 0.9;

        for (let yy = 0; yy < bh; yy++) {
          for (let xx = 0; xx < bw; xx++) {
            const X = bx + xx;
            if (X < 0 || X >= w) continue;
            const px = x0 + X;
            const py = y0 + ry + yy;
            if (o.mask && !o.mask(px, py)) continue;
            let v;
            if (yy === bh - 1 || xx === bw - 1) v = (o.mortar ?? 1) + light(px, py) * 0.5;
            else {
              v = base + light(px, py);
              if (yy === 0 || xx === 0) v += 0.8;
              else if (yy === bh - 2 || xx === bw - 2) v -= 0.5;
              if (hash(px, py, o.seed || 5) > 0.97) v -= 1;
            }
            P.set(px, py, o.color ? o.color(v, px, py) : pick(ramp, v));
          }
        }

        bx += bw;
      }
    }
  }

  /* ---------- prkna: 1px tmavé spáry, kresba dřeva, občas suk ---------- */
  function planks(P, x0, y0, w, h, o = {}) {
    const ramp = o.ramp || WX;
    const size = o.size || 5;
    const vert = o.dir === "v";
    const light = o.light || (() => 0);
    const seed = o.seed || 3;

    for (let py = y0; py < y0 + h; py++) {
      for (let px = x0; px < x0 + w; px++) {
        if (o.mask && !o.mask(px, py)) continue;
        const a = vert ? px - x0 : py - y0;
        const b = vert ? py - y0 : px - x0;
        const k = Math.floor(a / size);
        const i = a - k * size;
        let v = (o.base ?? 3.2) + (hash(k, 1, seed) - 0.5) * 0.7 + light(px, py);

        if (i === size - 1) v = (o.seam ?? 0.8) + light(px, py) * 0.4;
        else {
          if (i === 0) v += 0.7;
          const gi = 1 + Math.floor(hash(k, 2, seed) * Math.max(1, size - 2));
          if (i === gi && hash(k, Math.floor((b + hash(k, 3, seed) * 9) / 6), seed) > 0.5) v -= 0.65;
          const span = vert ? h : w;
          const kb = 2 + Math.floor(hash(k, 4, seed) * Math.max(1, span - 4));
          if (hash(k, 5, seed) > 0.6 && Math.abs(b - kb) <= 0 && i === (size >> 1)) v -= 1.3;
        }

        P.set(px, py, pick(ramp, v));
      }
    }
  }

  /* Malý lucernový plod: 2x2 jemné px (= 1 art px pro třpyt), stopka nad ním. */
  function fruitAt(P, x, y) {
    P.set(x, y - 1, C.w[1]);
    P.set(x, y, C.a[4]);
    P.set(x + 1, y, C.a[2]);
    P.set(x, y + 1, C.a[2]);
    P.set(x + 1, y + 1, C.a[1]);
  }

  /* ---------- stromy ("Lanternwood") ---------- */
  const TW = 36;
  const TH = 46;

  function clumpCrown(variant, lobes, gl, branches, seed, opt = {}) {
    const w = TW * HD;
    const h = TH * HD;
    const list = crownClumps(lobes, seed, opt.rmin || 6, opt.rmax || 10);
    thinOrder(list, gl.x, gl.y, gl.rx, gl.ry, seed);
    const glob = (x, y) => (opt.base ?? 2.3) + 1.25 * -(((x - gl.x) / gl.rx) * 0.55 + ((y - gl.y) / gl.ry) * 0.85);
    const stages = [];
    const fruitPos = [];

    // plody: přivěšené pod spodní shluky
    const lower = list.filter(c => c.y > gl.y - gl.ry * 0.2);
    const R = rng(seed + 99);
    const fruitClumps = [];
    for (let i = 0; i < 6 && lower.length; i++) {
      const c = lower[Math.floor(R() * lower.length)];
      if (fruitClumps.includes(c)) continue;
      fruitClumps.push(c);
      fruitPos.push([(Math.round(c.x + (R() - 0.5) * c.r) >> 1) << 1, (Math.round(c.y + c.ry * 0.55) >> 1) << 1, c]);
    }

    for (const cut of [0, 0.4, 0.72]) {
      const P = new Pix(w, h);
      for (const b of branches) limb(P, ...b, WX, { seed, base: 2.4 });
      const keep = list.filter(c => c.keep >= cut * 0.95);
      const L = stack(w, h);
      for (const c of keep) layer(L, clumpBox(c), clumpFill(c, glob));
      relight(L, { occ: 1.7, occ2: 0.8, rim: 0.6, under: 0.7 });
      paintStack(P, L, foliageColor(opt.ramp || GX));
      if (opt.after) opt.after(P, cut, keep);
      P.outline(mix(G[0], C.ink, 0.55), 0.5);
      for (const [fx, fy, c] of fruitPos) if (cut === 0 || (cut < 0.5 && keep.includes(c) && hash(fx, fy, 3) > 0.4)) fruitAt(P, fx, fy);
      stages.push(PK.fine(P));
    }

    return { crown: stages, fruit: fruitPos.map(([x, y]) => [ART(x), ART(y)]) };
  }

  function oak(seed, ramp) {
    const w = TW * HD;
    const h = TH * HD;
    const trunk = new Pix(w, h);
    const cx = 36;
    const half = y => 5 + Math.max(0, y - 64) * 0.08 + (y > 78 ? (y - 78) * (y - 78) * 0.055 : 0);

    // kořeny vyrůstající do trávy
    for (const [x0, y0, x1, y1, w0] of [[30, 82, 21, 90, 6], [42, 82, 52, 90, 6], [38, 86, 42, 91, 4], [32, 86, 28, 91, 3]]) {
      limb(trunk, x0, y0, x1, y1, w0, 2, WX, { seed, base: 2.8 });
    }
    barkTrunk(trunk, 50, 88, y => [cx - half(y) + Math.sin(y * 0.11) * 0.8, cx + half(y) + Math.sin(y * 0.11) * 0.8], seed, { moss: 12 });
    // dutina
    trunk.disc(33, 70, 1.6, 2.2, WX[0]);
    trunk.set(32, 72, C.w[3]);
    trunk.set(33, 72, C.w[3]);
    trunk.outline(C.ink, 0.7);

    const lobes = [
      [36, 46, 18, 11], [17, 42, 13, 11], [55, 42, 13, 11],
      [36, 28, 23, 17], [19, 26, 14, 13], [53, 24, 14, 13], [35, 12, 16, 11]
    ];
    const branches = [
      [34, 58, 18, 38, 5, 2], [38, 57, 55, 36, 5, 2], [36, 56, 35, 22, 5, 2.5],
      [24, 46, 12, 30, 2.5, 1.2], [48, 44, 60, 28, 2.5, 1.2]
    ];

    const res = clumpCrown(0, lobes, { x: 36, y: 30, rx: 32, ry: 28 }, branches, seed, {
      ramp,
      after(P, cut, keep) {
        // visící mech z dolního okraje
        for (const x of [12, 27, 47, 58]) {
          let y0 = -1;
          for (let y = h - 1; y > 30; y--) if (P.get(x, y) >= 0) { y0 = y; break; }
          if (y0 < 0 || cut > 0.6) continue;
          const len = 2 + Math.floor(hash(x, 1, seed) * 4);
          for (let i = 1; i <= len; i++) P.set(x, y0 + i, i === len ? mix(G[4], C.bone[1], 0.4) : i % 2 ? G[2] : G[3]);
        }
      }
    });

    return { trunk: PK.fine(trunk), ...res };
  }

  function pine(seed, ramp = PINE) {
    const w = TW * HD;
    const h = TH * HD;
    const trunk = new Pix(w, h);
    const cx = 36;

    for (const [x1, y1] of [[27, 90], [46, 90], [36, 91]]) limb(trunk, cx + (x1 < cx ? -2 : x1 > cx ? 2 : 0), 84, x1, y1, 4, 1.5, WX, { seed });
    barkTrunk(trunk, 60, 88, y => {
      const hw = 3.6 + (y > 80 ? (y - 80) * 0.35 : 0);
      return [cx - hw, cx + hw];
    }, seed, { base: 4.4 });
    trunk.outline(C.ink, 0.7);

    // patra jehličí, spodní vzadu, horní vpředu
    const tiers = [[36, 53, 30, 21], [36, 37, 25, 21], [36, 21, 19, 19], [36, 6, 12, 17], [36, 0, 6, 10]];
    const stages = [];
    const fruitPos = [[14, 70], [56, 70], [22, 54], [50, 52], [30, 38]];

    for (const cut of [0, 0.4, 0.72]) {
      const P = new Pix(w, h);
      // osa a holé větve (vidět po otrhání)
      limb(P, cx, 74, cx, 4, 4, 1.5, WX, { seed, base: 2.8 });
      tiers.forEach(([tx, top, hw, th], i) => {
        if (i > 3 || !cut) return;
        for (const s of [-1, 1]) {
          for (const k of [0.45, 0.85]) limb(P, tx, top + th * 0.45 + k * 4, tx + s * hw * k, top + th + 1, 2, 1, WX, { seed: seed + i, grain: false, base: 2.2 });
        }
      });

      const L = stack(w, h);
      tiers.forEach(([tx, top, hw, th], i) => {
        const by = top + th;
        const lim = 1 - cut * (i === 4 ? 0 : 0.9);
        layer(L, [tx - hw - 1, top, tx + hw + 1, by + 2], (x, y) => {
          const dx = x + 0.5 - tx;
          const rel = (y + 0.5 - top) / th;
          if (rel < 0) return null;
          const hwr = hw * Math.pow(Math.min(1, rel), 0.75) + 0.6;
          const ragged = (hash(Math.floor((dx + 40) / 4), i + Math.floor(y / 5), seed) - 0.5) * 6 * cut;
          if (Math.abs(dx) > Math.min(hwr, hwr * lim + 1 + ragged)) return null;
          const tri = 1 - Math.abs(((x + i * 2) % 6) / 3 - 1);
          const bottom = by - 2.6 * (1 - tri) + Math.abs(dx) / hw * 1.5;
          if (y + 0.5 > bottom) return null;
          const nx = dx / hw;
          let v = 3.9 - nx * 2.4 - rel * 0.9 + i * 0.12;
          const q = (y - top) - Math.abs(dx) * 0.6 + hash(dx < 0 ? 0 : 1, i, seed) * 3 + (hash(Math.floor((dx + 40) / 4), i, seed + 1) > 0.6 ? 1 : 0);
          const f = ((q % 5) + 5) % 5;
          if (f < 1) v -= 1.2;
          else if (f < 2) v += nx < 0.3 ? 0.8 : 0.3;
          if (hash(x, y, seed) > 0.95 && nx < 0) v += 1;
          return v;
        });
      });
      relight(L, { occ: 1.6, occ2: 0.9, rim: 0.7, under: 0.6 });
      paintStack(P, L, t => (t > 7.6 ? mix(G[5], ramp[7], 0.4) : pick(ramp, t)));
      P.outline(mix(C.t[0], C.ink, 0.6), 0.5);
      for (const [fx, fy] of fruitPos) if (cut === 0 || (cut < 0.5 && hash(fx, fy, 2) > 0.5)) fruitAt(P, fx, fy);
      stages.push(PK.fine(P));
    }

    return { trunk: PK.fine(trunk), crown: stages, fruit: fruitPos.map(([x, y]) => [ART(x), ART(y)]) };
  }

  function willow(seed) {
    const w = TW * HD;
    const h = TH * HD;
    const trunk = new Pix(w, h);
    const cx = 35;

    for (const [x1, y1, w0] of [[22, 90, 5], [50, 90, 5], [38, 91, 3]]) limb(trunk, cx + (x1 < cx ? -4 : 4), 82, x1, y1, w0, 1.5, WX, { seed });
    barkTrunk(trunk, 46, 88, y => {
      const wob = Math.sin(y * 0.17) * 2.2;
      const hw = 4.4 + (y > 80 ? (y - 80) * 0.45 : 0);
      return [cx + wob - hw, cx + wob + hw];
    }, seed, { base: 3.9 });
    trunk.outline(C.ink, 0.7);

    const lobes = [[36, 34, 26, 15], [16, 38, 13, 11], [56, 38, 13, 11], [36, 19, 19, 12]];
    const branches = [[33, 50, 18, 36, 4, 1.5], [38, 50, 56, 36, 4, 1.5], [35, 48, 36, 18, 4, 2]];
    const strands = [];
    const R = rng(seed + 5);
    for (let x = 6; x <= 66; x += 3 + Math.floor(R() * 2)) {
      const edge = Math.abs(x - 36) / 30;
      strands.push({ x, len: 8 + Math.floor((1 - edge * 0.55) * 26 * (0.45 + R() * 0.55)), ph: R() * 6, k: R() });
    }

    const res = clumpCrown(2, lobes, { x: 36, y: 30, rx: 30, ry: 22 }, branches, seed, {
      base: 3.0,
      after(P, cut) {
        const bottom = x => {
          for (let y = h - 1; y > 10; y--) if (P.get(x, y) >= 0) return y;
          return -1;
        };
        for (const s of strands) {
          if (s.k < cut) continue;
          const y0 = bottom(s.x);
          if (y0 < 0) continue;
          const lit = s.x < 36;
          for (let i = 0; i < s.len; i++) {
            const x = s.x + Math.round(Math.sin(i * 0.22 + s.ph) * 0.8);
            const y = y0 - 2 + i;
            const tip = i > s.len - 3;
            let c = (i + s.x) % 3 === 0 ? (lit ? G[4] : G[3]) : lit ? G[3] : G[2];
            if (tip) c = lit ? G[5] : G[4];
            P.set(x, y, c);
            if (i % 3 === 1 && i > 2) P.set(x + (lit ? -1 : 1), y + 1, lit ? G[4] : G[2]);
          }
        }
      }
    });

    return { trunk: PK.fine(trunk), ...res };
  }

  // barevné obměny korun, aby les nebyl jednolitě zelený
  const AUTUMN = GX.map((c, i) => mix(c, [C.r[0], C.r[0], C.r[1], C.r[2], C.r[3], C.a[1], C.a[2], C.a[3]][i], 0.6));
  const SPRING = GX.map((c, i) => mix(c, i > 4 ? C.a[3] : C.d[3], 0.24));
  const BLUE_PINE = PINE.map((c, i) => mix(c, C.t[Math.min(4, i >> 1)], 0.3));

  function treeVariant(kind) {
    const seed = 40 + (kind % 3) * 11 + (kind >= 3 ? 5 : 0);
    const t = kind === 0 ? oak(seed) : kind === 1 ? pine(seed) : kind === 2 ? willow(seed)
      : kind === 3 ? oak(seed, AUTUMN) : kind === 4 ? pine(seed, BLUE_PINE) : oak(seed, SPRING);
    return { trunk: t.trunk, crown: t.crown, fruit: t.fruit, w: TW, h: TH, ax: 18, ay: 44 };
  }

  /* ---------- zlatý důl (plný a vytěžený) ---------- */
  function mine(empty = false) {
    const W = 50;
    const H = 40;
    const P = mk(W, H);
    const glints = [];

    // kamenný pahorek
    const hill = [[3, 73], [7, 54], [14, 40], [26, 28], [40, 20], [54, 17], [68, 20], [80, 28], [89, 40], [95, 55], [97, 73]];
    const r = rock(P, hill, { seed: 12, area: 120, base: 3.3, gain: 1.5, moss: 7, cracks: 4, cy: 40 });

    // tráva na hřbetu
    for (let x = 6; x < 96; x++) {
      const yt = r.ytop(x);
      if (yt < 0 || hash(x, 4, 12) < 0.45) continue;
      const len = 1 + Math.floor(hash(x, 5, 12) * 3);
      for (let i = 1; i <= len; i++) P.set(x + (i === len && x % 3 === 0 ? -1 : 0), yt - i + 1, i === len ? G[5] : G[3]);
    }

    // žíly: tmavá puklina posetá zrny zlata, ve vytěženém dole prázdné rýhy
    const vein = pts => {
      let step = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        const n = Math.ceil(Math.hypot(bx - ax, by - ay));
        for (let k = 0; k <= n; k++, step++) {
          const x = Math.round(ax + (bx - ax) * k / n);
          const y = Math.round(ay + (by - ay) * k / n);
          P.set(x, y, SX[0]);
          P.set(x + 1, y + 1, S[3]);
          if (empty || step % 4 !== 0 || hash(x, y, 30) > 0.8) continue;
          const big = hash(x, y, 32) > 0.5;
          P.set(x, y - 1, GOLD[4]);
          P.set(x + 1, y - 1, GOLD[3]);
          P.set(x, y, GOLD[3]);
          P.set(x + 1, y, GOLD[1]);
          if (big) { P.set(x - 1, y, GOLD[3]); P.set(x - 1, y - 1, GOLD[5]); P.set(x, y + 1, GOLD[1]); }
          if (hash(x, y, 31) > 0.6) { P.set(x - (big ? 1 : 0), y - 1, C.white); glints.push([x - (big ? 1 : 0), y - 1]); }
        }
      }
    };
    vein([[14, 62], [19, 55], [24, 52], [28, 45], [31, 41]]);
    vein([[20, 41], [25, 45], [28, 46]]);
    vein([[80, 33], [84, 42], [87, 48], [91, 58]]);
    vein([[68, 26], [72, 28], [75, 31]]);

    // nugety zapuštěné ve skále
    if (!empty) {
      for (const [x, y] of [[13, 47], [86, 62], [37, 30]]) {
        P.disc(x, y, 2.2, 1.8, (px, py) => pick(GOLD, 3.5 - (px - x) * 0.6 - (py - y) * 0.9));
        P.set(Math.round(x - 1), Math.round(y - 1), C.white);
        glints.push([Math.round(x - 1), Math.round(y - 1)]);
      }
    }

    // kamenný oblouk z klínových kvádrů
    const ax = 56;
    const ay = 42;
    const R1 = 15;
    const R2 = 22;
    for (let y = ay - R2 - 1; y <= ay; y++) {
      for (let x = ax - R2 - 1; x <= ax + R2 + 1; x++) {
        const dx = x + 0.5 - ax;
        const dy = y + 0.5 - ay;
        const rr = Math.hypot(dx, dy);
        if (rr > R2) continue;
        if (rr < R1) {
          P.set(x, y, rr > R1 - 1.5 ? SX[0] : pick(SX, 1.6 - (y > ay - 10 ? 1 : 0) + (dx < 0 ? 0.3 : -0.3)));
          continue;
        }
        const ang = Math.atan2(-dy, dx);
        const seg = Math.floor(ang / Math.PI * 9);
        const fa = (ang / Math.PI * 9) - seg;
        let v = 4.2 - (dx / R2) * 1.4 - (dy / R2) * 0.5 + (hash(seg, 1, 5) - 0.5) * 0.8;
        if (fa < 0.1) v = 0.8;
        else if (rr > R2 - 1.2 || fa < 0.2) v += 0.8;
        else if (rr < R1 + 1.1) v -= 0.9;
        if (seg === 4) v += 0.4;
        P.set(x, y, pick(SX, v));
      }
    }
    // ostění
    blocks(P, 34, 42, 7, 31, { seed: 21, rowH: 6, minW: 7, maxW: 7, base: 3.8 });
    blocks(P, 71, 42, 7, 31, { seed: 22, rowH: 6, minW: 7, maxW: 7, base: 2.4 });

    // klenák s rozlomeným prstenem
    for (let a = 0; a < 6.28; a += 0.12) {
      if (a > 5.3 && a < 6.1) continue;
      const x = Math.round(ax + Math.cos(a) * 3.2 - 0.5);
      const y = Math.round(ay - 18.5 + Math.sin(a) * 2.6);
      P.set(x, y, empty ? S[1] : C.a[2]);
      if (!empty && Math.sin(a) < 0) P.set(x, y, C.a[3]);
    }

    // vnitřek štoly
    for (let y = 42; y <= 72; y++) {
      for (let x = 48; x <= 64; x++) {
        const depth = Math.min(x - 48, 64 - x, y - 42);
        let c = depth < 2 ? SX[0] : C.ink;
        if (!empty) {
          const k = Math.max(0, 1 - Math.hypot((x - 56) / 9, (y - 62) / 10));
          const lv = k * 3.2 + (bayer(x, y) - 0.5) * 0.45;
          c = lv > 2.6 ? C.a[1] : lv > 1.9 ? C.a[0] : lv > 1.2 ? mix(C.a[0], C.r[0], 0.55) : lv > 0.6 ? mix(C.shade, C.r[0], 0.4) : c;
        }
        P.set(x, y, c);
      }
    }

    // koleje a pražce
    for (const y of empty ? [61, 65, 70] : [66, 70]) {
      const t = (y - 54) / 18;
      const hw = 3 + t * 5;
      P.line(Math.round(56 - hw - 1), y, Math.round(56 + hw + 1), y, WX[0]);
      P.line(Math.round(56 - hw - 1), y + 1, Math.round(56 + hw + 1), y + 1, empty ? WX[0] : C.w[1]);
    }
    for (const s of [-1, 1]) P.line(56 + s * 3, 55, 56 + s * 8, 72, empty ? S[1] : S[4]);

    // trámová výdřeva
    planks(P, 43, 40, 5, 33, { dir: "v", size: 5, seed: 7, base: 3.6 });
    planks(P, 64, 40, 5, 33, { dir: "v", size: 5, seed: 8, base: 2.3 });
    planks(P, 40, 35, 32, 6, { dir: "h", size: 6, seed: 9, base: 3.4, light: x => -(x - 40) / 32 * 0.9 });
    for (const x of [44, 67]) { P.set(x, 37, S[5]); P.set(x + 1, 38, S[2]); }
    for (const x of [45, 66]) { P.rect(x - 1, 46, 3, 2, S[2]); P.set(x - 1, 46, S[4]); }

    if (!empty) {
      // lucerna visící z překladu
      P.set(56, 41, S[1]);
      P.rect(55, 42, 3, 1, S[2]);
      P.rect(55, 43, 3, 3, C.a[2]);
      P.set(55, 43, C.a[4]);
      P.set(57, 45, C.a[1]);
      P.rect(55, 46, 3, 1, S[2]);
    } else {
      // zatlučená prkna přes vchod
      for (const [y, tilt] of [[47, 1], [56, -1], [64, 1]]) {
        for (let x = 44; x <= 68; x++) {
          const yy = y + Math.round((x - 56) * 0.08 * tilt);
          for (let i = 0; i < 4; i++) P.set(x, yy + i, pick(WX, (i === 0 ? 4 : i === 3 ? 1.4 : 2.8) + (hash(x >> 2, y, 3) - 0.5) * 0.6));
        }
        for (const x of [46, 66]) P.set(x, y + 1 + Math.round((x - 56) * 0.08 * tilt), S[4]);
      }
    }

    // hromada rudy (nebo jen suti) vlevo
    const pile = [[12, 70, 4], [20, 70, 4.5], [16, 66, 4], [27, 70, 3.5], [8, 71, 3], [22, 64, 3], [17, 61, 3]];
    pile.sort((a, b) => a[1] - b[1]);
    for (const [x, y, rr] of pile) {
      P.disc(x, y, rr, rr * 0.8, (px, py) => {
        const nx = (px + 0.5 - x) / rr;
        const ny = (py + 0.5 - y) / (rr * 0.8);
        const v = 3.3 - (nx * 0.7 + ny * 0.9) * 1.5;
        return empty ? pick(SX, v) : pick(GOLD, v);
      });
      if (!empty) {
        const gx = Math.round(x - rr * 0.4);
        const gy = Math.round(y - rr * 0.45);
        P.set(gx, gy, C.white);
        glints.push([gx, gy]);
      }
    }

    // vozík vpravo
    const cx0 = 77;
    P.poly([[cx0, 60], [cx0 + 17, 60], [cx0 + 15, 68], [cx0 + 2, 68]], (x, y) => pick(WX, 3.4 - (x - cx0) / 17 * 1.8 - (y - 60) * 0.08 + ((y - 60) % 3 === 2 ? -0.8 : 0)));
    P.line(cx0, 60, cx0 + 17, 60, C.w[4]);
    for (const x of [cx0 + 4, cx0 + 13]) P.line(x, 60, x - (x > cx0 + 8 ? 1 : -1), 68, S[2]);
    if (!empty) {
      P.disc(cx0 + 8.5, 59.5, 7, 3.2, (px, py) => pick(GOLD, 4 - (px - cx0 - 8) * 0.2 - (py - 57) * 0.6 + (hash(px >> 1, py, 4) > 0.7 ? -1 : 0)));
      for (const [gx, gy] of [[cx0 + 5, 57], [cx0 + 11, 58]]) { P.set(gx, gy, C.white); glints.push([gx, gy]); }
    } else {
      P.rect(cx0 + 2, 59, 14, 1, WX[0]);
    }
    for (const wx of [cx0 + 4, cx0 + 13]) {
      P.disc(wx, 69.5, 2.6, 2.6, (px, py) => (px + py < wx + 69 ? S[3] : S[1]));
      P.set(wx, 69, S[5]);
    }

    // krumpáč opřený o ostění
    if (!empty) {
      P.line(30, 72, 37, 56, C.w[3]);
      P.line(31, 72, 38, 56, C.w[1]);
      P.line(33, 54, 37, 55, S[5]);
      P.line(37, 55, 41, 58, S[3]);
      P.set(32, 53, S[4]);
    }

    P.outline(C.ink, 0.72);

    // výběr třpytek: rozprostřené přes celý důl
    const sp = [];
    for (const g of glints) {
      if (sp.every(q => Math.hypot(q[0] - g[0], q[1] - g[1]) > 12)) sp.push(g);
      if (sp.length >= 6) break;
    }

    return {
      c: PK.fine(P),
      w: W,
      h: H,
      ax: 25,
      ay: 36,
      sparkle: empty ? [] : sp.map(([x, y]) => [ART(x), ART(y)]),
      glow: empty ? null : { x: 28, y: 32, r: 9, a: 0.4, color: C.a[2] }
    };
  }

  /* ---------- drobnosti ---------- */
  const out = {};

  function sprite(name, w, h, ax, ay, fn, extra = {}, ol = 0.72) {
    const P = mk(w, h);
    fn(P);
    P.outline(C.ink, ol);
    out[name] = { c: PK.fine(P), w, h, ax, ay, ...extra };
  }

  function grass(P, x, y, n, seed) {
    for (let i = 0; i < n; i++) {
      const gx = x + Math.round((hash(i, 1, seed) - 0.5) * n * 2.4);
      const len = 2 + Math.floor(hash(i, 2, seed) * 3);
      const lean = hash(i, 3, seed) > 0.5 ? 1 : -1;
      for (let k = 0; k < len; k++) P.set(gx + (k === len - 1 ? lean : 0), y - k, k === len - 1 ? G[5] : k ? G[4] : G[2]);
    }
  }

  /* Houba: noha, klobouk se světlem zleva, lupeny pod kloboukem, tečky. */
  function shroom(P, x, base, hgt, r, cap, o = {}) {
    const topY = base - hgt;
    const lean = o.lean || 0;
    for (let y = topY; y <= base; y++) {
      const t = (y - topY) / hgt;
      const sx = Math.round(x + lean * (1 - t));
      P.set(sx, y, BONE[5]);
      P.set(sx + 1, y, BONE[3]);
      if (y > base - 2) { P.set(sx - 1, y, BONE[4]); P.set(sx + 2, y, BONE[1]); }
    }
    const cx = x + lean + 1;
    const ry = r * 0.8;
    const cy = topY + 1;
    // klobouk: kopule, spodní lem, lupeny pod ním
    P.disc(cx, cy, r, ry, (px, py) => {
      if (py > cy) return null;
      const nx = (px + 0.5 - cx) / r;
      const ny = (py + 0.5 - cy) / ry;
      let v = 2.4 - nx * 1.3 - (ny + 0.4) * 1.2;
      if (py === cy) v = 1.2 - nx * 0.6;
      return pick(cap.ramp, v);
    });
    for (let gx = Math.round(cx - r + 2); gx <= Math.round(cx + r - 2); gx++) {
      P.set(gx, cy + 1, (gx & 1) ? cap.gillD : cap.gill);
    }
    for (const [dx, dy] of o.spots || []) {
      const px = Math.round(cx + dx * r);
      const py = Math.round(cy + dy * ry);
      P.set(px, py, cap.spot);
      if (dx < 0) P.set(px + 1, py, cap.spot2 || cap.spot);
    }
    P.set(Math.round(cx - r * 0.45), Math.round(cy - ry * 0.7), cap.glint);
  }

  function crystalShard(P, bx, by, w, h, lean, ramp) {
    const tipX = bx + lean;
    const tipY = by - h;
    const sh = w * 0.75;
    const left = y => {
      const t = (by - y) / h;
      const ex = bx - w / 2 + lean * t;
      if (y < tipY + sh) return ex + (w / 2) * (1 - (y - tipY) / sh);
      return ex;
    };
    const right = y => {
      const t = (by - y) / h;
      const ex = bx + w / 2 + lean * t;
      if (y < tipY + sh) return ex - (w / 2) * (1 - (y - tipY) / sh);
      return ex;
    };

    for (let y = Math.floor(tipY); y <= by; y++) {
      const l = left(y + 0.5);
      const r = right(y + 0.5);
      if (r - l < 0.3) continue;
      for (let x = Math.round(l); x < Math.round(r); x++) {
        const u = (x + 0.5 - l) / (r - l);
        const v = (by - y) / h;
        let c;
        if (u < 0.34) c = ramp[2];
        else if (u < 0.68) c = ramp[1];
        else c = ramp[0];
        if (Math.abs(u - 0.34) < 0.5 / (r - l) + 0.02) c = ramp[3];
        if (u > 0.4 && u < 0.6 && v > 0.25 && v < 0.75) c = ramp[2];
        if (y >= by - 1) c = mix(c, C.shade, 0.35);
        P.set(x, y, c);
      }
    }
    P.set(Math.round(tipX - 0.5), Math.round(tipY + 1), ramp[3]);
    return [Math.round(tipX - 0.5), Math.round(tipY + 2)];
  }

  function makeDoodads() {
    const glowCap = {
      ramp: [mix(C.glow[0], C.t[0], 0.6), C.glow[0], mix(C.glow[0], C.glow[1], 0.5), C.glow[1], C.glow[2]],
      gill: mix(C.glow[0], C.t[0], 0.3), gillD: mix(C.t[0], C.shade, 0.4), spot: C.glow[2], glint: C.white
    };
    const redCap = {
      ramp: [mix(C.cap[0], C.r[0], 0.6), C.cap[0], mix(C.cap[0], C.cap[1], 0.5), C.cap[1], C.cap[2]],
      gill: C.bone[1], gillD: C.bone[2], spot: C.bone[0], glint: C.cap[2]
    };

    sprite("shroomGlow", 14, 12, 7, 11, P => {
      shroom(P, 6, 22, 9, 6.5, glowCap, { lean: -1, spots: [[0.15, -0.6], [0.55, -0.25], [-0.45, -0.3]] });
      shroom(P, 16, 22, 6, 5, glowCap, { spots: [[0.3, -0.5], [-0.3, -0.25]] });
      shroom(P, 22, 22, 4, 3.6, glowCap, { lean: 1 });
      grass(P, 12, 22, 4, 6);
    }, { glow: { x: 7, y: 6, r: 9, a: 0.35, color: C.glow[1] } });

    sprite("shroomRed", 12, 10, 6, 9, P => {
      shroom(P, 7, 18, 7, 6.5, redCap, { spots: [[-0.25, -0.6], [0.4, -0.45], [-0.65, -0.15], [0.15, -0.15]] });
      shroom(P, 17, 18, 4, 4.6, redCap, { lean: 1, spots: [[0.1, -0.55], [-0.5, -0.2]] });
      grass(P, 12, 18, 3, 9);
    });

    const crystal = (name, ramp, shards, sparkleIdx, glowA) => {
      const deep = [mix(ramp[0], C.m[0], 0.35), ramp[0], ramp[1], ramp[2], ramp[3]];
      const tips = [];
      sprite(name, 18, 20, 9, 19, P => {
        rock(P, [[3, 39], [5, 34], [11, 31], [24, 31], [31, 33], [34, 39]], { seed: name.length, area: 40, base: 3.2, moss: 2.5 });
        for (const [bx, by, w, h, lean] of shards) tips.push(crystalShard(P, bx, by, w, h, lean, [deep[1], deep[2], deep[3], deep[4]]));
      }, { glow: { x: 9, y: 9, r: 11, a: glowA, color: ramp[1] } });
      out[name].sparkle = sparkleIdx.map(i => [ART(tips[i][0]), ART(tips[i][1])]);
    };
    crystal("crystalCyan", C.y, [[8, 35, 6, 17, -2], [26, 35, 6, 13, 2], [16, 35, 8, 30, 0], [11, 37, 4, 7, -1], [22, 37, 4, 8, 1]], [2, 0], 0.4);
    crystal("crystalViolet", C.m.map((c, i) => (i === 3 ? C.m[3] : c)), [[9, 35, 6, 12, -2], [24, 35, 6, 16, 2], [15, 35, 7, 26, -1], [20, 37, 4, 7, 1]], [2], 0.35);

    sprite("stoneA", 16, 11, 8, 10, P => {
      rock(P, [[2, 21], [3, 13], [8, 6], [15, 3], [23, 4], [28, 10], [31, 17], [30, 21]], { seed: 5, area: 70, moss: 8, cracks: 1 });
      grass(P, 4, 21, 2, 5);
    });

    sprite("stoneB", 10, 8, 5, 7, P => {
      rock(P, [[1, 15], [2, 9], [7, 3], [13, 2], [18, 6], [19, 15]], { seed: 8, area: 45, moss: 5 });
    });

    sprite("column", 12, 22, 6, 21, P => {
      blocks(P, 1, 37, 22, 7, { seed: 3, rowH: 4, minW: 7, maxW: 11, base: 3.4, light: x => -(x - 1) / 22 * 1.4 });
      // dřík s kanelurami, nahoře ulomený
      const top = x => 9 + Math.round(Math.abs(Math.sin(x * 1.3)) * 3 + (x > 12 ? (x - 12) * 0.9 : 0));
      for (let x = 5; x <= 18; x++) {
        for (let y = top(x); y <= 36; y++) {
          const rel = (x - 5) / 13;
          let v = 5.2 - rel * 3.6;
          if ((x - 5) % 3 === 2) v -= 1.1;
          else if ((x - 5) % 3 === 0 && x > 5) v += 0.4;
          if (y === top(x)) v = 6 - rel * 1.5;
          if (y === 36 || y === 20) v -= 1;
          if (hash(x, y, 4) > 0.97) v -= 1;
          P.set(x, y, pick(SX, v));
        }
      }
      // břečťan
      let vx = 7;
      for (let y = 36; y > 16; y--) {
        vx += Math.round(Math.sin(y * 0.6)) * (y % 2);
        P.set(vx, y, G[2]);
        if (y % 3 === 0) { P.set(vx - 1, y, G[4]); P.set(vx - 1, y - 1, G[5]); }
        if (y % 4 === 1) P.set(vx + 1, y, G[3]);
      }
      grass(P, 4, 43, 3, 7);
    });

    sprite("columnFallen", 22, 10, 11, 9, P => {
      // ležící bubny sloupu
      for (let x = 5; x <= 35; x++) {
        const jag = x < 8 ? Math.round(hash(x, 1, 2) * 3) : 0;
        for (let y = 6 + jag; y <= 16 - jag; y++) {
          const rel = (y - 6) / 10;
          let v = 5.4 - rel * 3.8;
          if ((y - 6) % 3 === 2) v -= 1;
          else if ((y - 6) % 3 === 0 && y > 6) v += 0.4;
          if (x === 16 || x === 27) v = 1.2;
          if (x === 17 || x === 28) v += 0.6;
          if (hash(x, y, 7) > 0.97) v -= 1;
          P.set(x, y, pick(SX, v));
        }
      }
      // čelo s letokruhy kamene
      P.disc(36.5, 11.5, 4, 5.8, (x, y) => {
        const d = Math.hypot((x + 0.5 - 36.5) / 4, (y + 0.5 - 11.5) / 5.8);
        return pick(SX, d > 0.8 ? 3.4 : d > 0.45 ? 5 - (d > 0.6 ? 0.6 : 0) : 4.4);
      });
      // mech na hřbetu
      for (let x = 9; x <= 24; x++) {
        if (vnoise(x / 4, 1, 3) < 0.45) continue;
        P.set(x, 6, G[4]);
        if (vnoise(x / 3, 2, 3) > 0.55) P.set(x, 7, G[2]);
        if (hash(x, 8, 3) > 0.7) P.set(x, 5, G[5]);
      }
      P.rect(6, 17, 30, 1, SX[0]);
      grass(P, 20, 18, 3, 3);
    });

    sprite("monolith", 10, 22, 5, 21, P => {
      rock(P, [[2, 43], [3, 9], [6, 3], [10, 0], [14, 2], [17, 8], [18, 43]], { seed: 9, area: 50, base: 3.4, gain: 1.4, jit: 0.5, stretch: 2.2, moss: 4, cracks: 1 });
      // vytesaný rozlomený prsten, uvnitř svítí
      const rx0 = 10;
      const ry0 = 18;
      for (let y = ry0 - 7; y <= ry0 + 7; y++) {
        for (let x = rx0 - 7; x <= rx0 + 7; x++) {
          const dx = x + 0.5 - rx0;
          const dy = y + 0.5 - ry0;
          const r = Math.hypot(dx, dy);
          const a = Math.atan2(dy, dx);
          if (a > -1.3 && a < -0.4) continue;
          if (r >= 3.3 && r < 4.6) P.set(x, y, r < 4 ? C.y[2] : C.y[1]);
          else if (r >= 4.6 && r < 5.6 && dx + dy > 0) P.set(x, y, S[1]);
          else if (r >= 2.4 && r < 3.3 && dx + dy < 0) P.set(x, y, S[1]);
        }
      }
      P.set(rx0 - 3, ry0 - 2, C.y[3]);
      // runy pod prstenem
      for (const [x, y, l] of [[7, 27, 3], [10, 28, 2], [13, 27, 3], [9, 32, 2], [12, 32, 3]]) {
        P.line(x, y, x, y + l - 1, C.y[1]);
        P.set(x + 1, y + l - 1, S[1]);
        if (l > 2) P.set(x - 1, y + 1, C.y[1]);
      }
      grass(P, 4, 43, 3, 4);
    }, { glow: { x: 5, y: 9, r: 8, a: 0.3, color: C.y[1] } });

    sprite("stump", 14, 10, 7, 9, P => {
      limb(P, 7, 15, 1, 19, 4, 1.5, WX, { seed: 4 });
      limb(P, 21, 15, 27, 19, 4, 1.5, WX, { seed: 4 });
      barkTrunk(P, 6, 18, y => [5 - (y > 14 ? y - 14 : 0) * 0.6, 23 + (y > 14 ? y - 14 : 0) * 0.6], 4, { moss: 6 });
      // řez s letokruhy
      P.disc(14, 6, 9.5, 4, (x, y) => {
        const d = Math.hypot((x + 0.5 - 14) / 9.5, (y + 0.5 - 6) / 4);
        if (d > 0.84) return C.w[2];
        const ring = Math.floor(d * 6.5 + hash(x >> 1, y, 4) * 0.4);
        let c = ring % 2 ? C.d[4] : C.d[5];
        if (d < 0.18) c = C.d[3];
        if (x + 0.5 - 14 > 0 && y + 0.5 - 6 > 0 && d > 0.55) c = mix(c, C.w[3], 0.5);
        return c;
      });
      P.line(14, 6, 19, 8, C.d[2]);
      P.set(8, 4, C.d[5]);
      // drobná houbička
      P.set(4, 16, BONE[4]);
      P.set(3, 15, C.cap[1]);
      P.set(4, 15, C.cap[1]);
      P.set(5, 15, C.cap[0]);
    });

    sprite("fern", 16, 10, 8, 9, P => {
      // listy kapradí: oblouk ze středu, lístky po obou stranách se zužují ke špičce
      const fronds = [
        [-0.6, 12, 0], [0.65, 12, 0], [-0.05, 11, 0],
        [-1.4, 13, 1], [1.45, 13, 1], [-0.95, 14, 2], [1.0, 14, 2], [-2.1, 10, 2], [2.1, 10, 2], [0.3, 13, 2]
      ];
      for (const [ang, len, layer] of fronds) {
        const lit = ang < 0.2;
        const base = (lit ? 4.4 : 3.4) + (layer - 1) * 0.5;
        let px = 16;
        let py = 18.5;
        for (let i = 0; i < len; i++) {
          const t = i / len;
          const a = -Math.PI / 2 + ang * (0.3 + t * 0.7);
          px += Math.cos(a);
          py += Math.sin(a) * 1.35 + t * t * t * 1.6;
          const x = Math.round(px);
          const y = Math.round(py);
          P.set(x, y, pick(GX, base - 0.3));
          const leaf = Math.max(0, Math.round((1 - t) * 1.8 + 0.4));
          if (i > 0 && i % 2 === 1) {
            for (let k = 1; k <= leaf; k++) {
              P.set(x - k, y - (k > 1 ? 1 : 0), pick(GX, base + (lit ? 0.9 : 0.3)));
              P.set(x + k, y - (k > 1 ? 1 : 0), pick(GX, base - (lit ? 0.1 : 0.7)));
            }
          }
          if (i === len - 1) P.set(x, y, pick(GX, base + 1.3));
        }
      }
      P.rect(15, 17, 3, 2, G[1]);
    }, {}, 0.55);

    sprite("lanternPost", 10, 30, 5, 29, P => {
      blocks(P, 5, 54, 11, 6, { seed: 6, rowH: 3, minW: 5, maxW: 6, base: 3.3, light: x => -(x - 5) / 11 * 1.4 });
      planks(P, 8, 26, 4, 28, { dir: "v", size: 4, seed: 4, base: 3.2, light: x => (x === 8 ? 0.8 : x === 11 ? -1 : 0) });
      P.rect(7, 26, 6, 2, C.b[2]);
      P.rect(7, 26, 6, 1, C.b[4]);
      // stříška a prstenová špice
      P.poly([[3, 10], [17, 10], [13, 6], [7, 6]], (x, y) => pick(BX, y < 8 ? 4.5 - (x - 3) * 0.2 : 3 - (x - 3) * 0.12));
      P.rect(3, 10, 14, 1, C.b[1]);
      for (const [x, y] of [[9, 2], [10, 2], [8, 3], [8, 4], [11, 4], [9, 5], [10, 5]]) P.set(x, y, C.gold[x < 10 ? 1 : 0]);
      P.set(9, 2, C.gold[2]);
      // klec s jantarovým sklem
      for (let y = 11; y <= 23; y++) {
        for (let x = 5; x <= 15; x++) {
          const k = 1 - Math.hypot((x + 0.5 - 10) / 6, (y + 0.5 - 17) / 7);
          let c = k > 0.6 ? C.a[4] : k > 0.38 ? C.a[3] : k > 0.15 ? C.a[2] : C.a[1];
          if (x === 5 || x === 15 || x === 10) c = x === 5 ? C.b[3] : C.b[1];
          if (x === 10 && y > 12 && y < 22) c = mix(C.b[2], C.a[1], 0.4);
          if (y === 11 || y === 23) c = y === 11 ? C.b[4] : C.b[1];
          P.set(x, y, c);
        }
      }
      P.set(7, 13, C.white);
      P.set(7, 14, C.a[4]);
      P.rect(6, 24, 9, 2, C.b[2]);
      P.rect(6, 24, 9, 1, C.b[3]);
    }, { glow: { x: 5, y: 9, r: 13, a: 0.5, color: C.a[2], flicker: true }, ground: { x: 5, y: 28, r: 12, color: C.a[2] } });

    sprite("brazier", 12, 18, 6, 17, P => {
      // nohy a sloup
      limb(P, 12, 20, 4, 34, 2.4, 2, BX, { grain: false, base: 3 });
      limb(P, 12, 20, 20, 34, 2.4, 2, BX, { grain: false, base: 2.6 });
      limb(P, 11.5, 18, 11.5, 33, 3, 3, BX, { grain: false, base: 3 });
      P.rect(2, 34, 5, 2, C.b[2]);
      P.rect(17, 34, 5, 2, C.b[1]);
      // mísa
      P.disc(12, 12, 10, 8, (x, y) => {
        if (y < 12) return null;
        const nx = (x + 0.5 - 12) / 10;
        let v = 3.4 - nx * 2 - (y - 12) * 0.12;
        if (y === 15) v = 1.3;
        if (y === 16) v += 0.6;
        if ((x === 6 || x === 18) && y === 14) v = 5;
        if (hash(x, y, 2) > 0.92 && y > 15) return C.r[3];
        return pick(BX, v);
      });
      for (let x = 2; x <= 21; x++) P.set(x, 12, x < 12 ? C.b[4] : C.b[3]);
      for (let x = 3; x <= 20; x++) P.set(x, 11, (hash(x, 1, 8) > 0.6 ? C.r[4] : hash(x, 2, 8) > 0.4 ? C.r[3] : C.r[2]));
      for (let x = 5; x <= 18; x++) if (hash(x, 3, 8) > 0.5) P.set(x, 10, hash(x, 4, 8) > 0.6 ? C.a[3] : C.r[3]);
    }, { flame: { x: 6, y: 6 }, glow: { x: 6, y: 4, r: 14, a: 0.5, color: C.r[4], flicker: true } });

    sprite("skullStake", 8, 20, 4, 19, P => {
      limb(P, 7.5, 12, 7.5, 39, 4, 3, WX, { seed: 5, base: 2.4 });
      for (let y = 13; y <= 16; y++) for (let x = 5; x <= 10; x++) P.set(x, y, (x + y) % 2 ? C.bone[1] : C.bone[2]);
      // lebka
      P.disc(8, 5.5, 5.5, 4.8, (x, y) => pick(BONE, 4.6 - (x - 8) * 0.38 - (y - 4) * 0.35));
      P.poly([[4, 8], [12, 8], [11, 12], [5, 12]], (x, y) => pick(BONE, y === 11 ? 1.5 : 3.6 - (x - 5) * 0.35));
      for (let x = 5; x <= 10; x++) P.set(x, 10, x % 2 ? BONE[1] : BONE[5]);
      // oční důlky se štěrbinou žhavého oka
      for (const ex of [5, 9]) {
        P.rect(ex, 5, 2, 3, C.b[0]);
        P.set(ex + (ex < 8 ? 1 : 0), 5, C.b[1]);
        P.set(ex + (ex < 8 ? 0 : 1), 6, C.r[5]);
        P.set(ex + (ex < 8 ? 0 : 1), 7, C.r[3]);
      }
      P.set(8, 8, C.b[0]);
      P.line(6, 1, 7, 3, BONE[2]);
      P.set(4, 3, BONE[6]);
    });

    sprite("ribs", 24, 12, 12, 11, P => {
      // obří hrudní koš ležící v trávě: oblouky žeber, vzadu menší a tmavší, nahoře páteř
      P.rect(3, 21, 42, 2, mix(C.d[1], C.shade, 0.3));
      const top = [];
      for (let i = 4; i >= 0; i--) {
        const cx = 11 + i * 7;
        const rx = 7.5 - i * 0.6;
        const ry = 17 - i * 2.2;
        const dark = i * 0.3;
        for (let k = 0; k <= 40; k++) {
          const a = Math.PI + (k / 40) * Math.PI;
          const x = cx + Math.cos(a) * rx;
          const y = 21 + Math.sin(a) * ry;
          const th = 1.15 - k / 40 * 0.4;
          P.disc(x, y, th, th, (px, py) => {
            const lit = (px + 0.5 - x) * -0.6 + (py + 0.5 - y) * -0.8;
            return pick(BONE, 3.8 + lit * 1.6 - dark - (k > 28 ? 0.6 : 0));
          });
        }
        top.push([cx, 21 - ry]);
      }
      // páteř po vrcholech oblouků
      for (const [x, y] of top) {
        P.disc(x - 0.5, y - 0.5, 2.1, 1.7, (px, py) => pick(BONE, 4.8 - (px - x) * 0.5 - (py - y) * 0.9));
      }
      grass(P, 12, 22, 3, 2);
      grass(P, 34, 22, 3, 8);
    });

    sprite("crates", 18, 14, 9, 13, P => {
      // bedna: horní plocha, čelo, rám a vzpěra
      P.poly([[2, 10], [20, 10], [22, 6], [5, 6]], (x, y) => pick(WX, 4.3 - (x - 2) * 0.04 + (((x - y) % 5 + 5) % 5 === 0 ? -1 : 0)));
      planks(P, 2, 10, 18, 17, { dir: "h", size: 4, seed: 11, base: 3, light: x => -(x - 2) / 18 * 1.1 });
      for (const [x, y, w, h] of [[2, 10, 2, 17], [18, 10, 2, 17], [2, 10, 18, 2], [2, 25, 18, 2]]) {
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) P.set(xx, yy, pick(WX, (xx === x || yy === y ? 4.4 : 3.2) - (xx - 2) / 18));
      }
      limb(P, 4, 24, 18, 12, 2.2, 2.2, WX, { grain: false, base: 3.2 });
      for (const [x, y] of [[3, 11], [18, 11], [3, 25], [18, 25]]) P.set(x, y, S[5]);
      // sud
      for (let y = 8; y <= 26; y++) {
        const bulge = Math.sin((y - 8) / 18 * Math.PI) * 1.5;
        const l = 22 - bulge;
        const r = 34 + bulge;
        for (let x = Math.round(l); x < Math.round(r); x++) {
          const rel = (x - l) / (r - l);
          let v = 4.3 - rel * 3.4;
          if (Math.round((x - l)) % 3 === 2) v -= 0.8;
          let c = pick(WX, v);
          if (y === 11 || y === 17 || y === 23) c = pick(SX, 4.6 - rel * 3.4);
          if (y === 12 || y === 18 || y === 24) c = pick(SX, 2.6 - rel * 1.6);
          P.set(x, y, c);
        }
      }
      P.disc(28, 8, 6, 2.2, (x, y) => (Math.hypot((x + 0.5 - 28) / 6, (y + 0.5 - 8) / 2.2) > 0.7 ? C.w[2] : x < 28 ? C.w[4] : C.w[3]));
    });

    sprite("signpost", 14, 22, 7, 21, P => {
      planks(P, 12, 8, 4, 36, { dir: "v", size: 4, seed: 2, base: 3, light: x => (x === 12 ? 0.8 : x === 15 ? -1 : 0) });
      P.set(13, 7, C.w[3]);
      P.set(14, 7, C.w[2]);
      const arrow = [[2, 8], [20, 8], [26, 13.5], [20, 19], [2, 19]];
      planks(P, 2, 8, 25, 11, { size: 6, seed: 5, base: 3.5, mask: (x, y) => inPoly(arrow, x + 0.5, y + 0.5), light: x => -x / 26 * 0.9 });
      const arrow2 = [[24, 23], [8, 23], [4, 26], [8, 29], [24, 29]];
      planks(P, 4, 23, 21, 6, { size: 6, seed: 6, base: 2.8, mask: (x, y) => inPoly(arrow2, x + 0.5, y + 0.5), light: x => -x / 26 * 0.8 });
      // namalovaný rozlomený prsten
      for (const [x, y] of [[8, 11], [9, 11], [7, 12], [7, 13], [7, 14], [8, 15], [9, 15], [10, 15], [11, 14], [11, 12]]) P.set(x, y, C.a[1]);
      for (const [x, y] of [[13, 13], [17, 13], [19, 12], [19, 14]]) P.set(x, y, C.a[0]);
      for (const [x, y] of [[13, 9], [13, 16], [13, 24], [13, 27]]) P.set(x, y, S[4]);
      grass(P, 14, 43, 3, 2);
    });

    sprite("deadTree", 26, 34, 13, 33, P => {
      const tone = (v, x, y) => v;
      for (const [x1, y1] of [[12, 66], [41, 66], [27, 67]]) limb(P, 26 + (x1 < 26 ? -4 : 4), 60, x1, y1, 5, 1.5, HX, { seed: 3, tone });
      for (const b of [
        [24, 40, 10, 22, 4, 2], [10, 22, 4, 13, 2, 1], [28, 34, 42, 16, 4, 2],
        [42, 16, 49, 10, 2, 1], [26, 28, 24, 6, 3.5, 1.2], [24, 14, 18, 8, 1.6, 1],
        [36, 24, 40, 28, 1.6, 1], [14, 26, 8, 28, 1.6, 1]
      ]) limb(P, ...b, HX, { seed: 3, base: 3 });
      barkTrunk(P, 26, 64, y => {
        const t = (y - 26) / 38;
        const hw = 2.5 + t * 3.5 + (y > 58 ? (y - 58) * 0.6 : 0);
        return [27 - hw, 27 + hw];
      }, 7, { ramp: HX, base: 4.6 });
      // žhnoucí trhliny Popelavého zástupu
      let x = 25;
      for (let y = 38; y < 60; y++) {
        x += (y % 4 === 0 ? 1 : y % 4 === 2 ? -1 : 0);
        P.set(x, y, y % 5 === 0 ? C.r[5] : C.r[4]);
        P.set(x + 1, y, C.r[2]);
      }
      P.set(29, 47, C.r[4]);
      P.set(30, 48, C.r[3]);
      P.set(30, 49, C.r[2]);
    }, { glow: { x: 13, y: 24, r: 8, a: 0.25, color: C.r[3] } });

    sprite("campfire", 16, 12, 8, 11, P => {
      const stones = [];
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * 2 * i / 9 + 0.2;
        stones.push([16 + Math.cos(a) * 12, 17.5 + Math.sin(a) * 4.2, i]);
      }
      stones.sort((a, b) => a[1] - b[1]);
      const fire = () => {
        P.disc(16, 17.5, 7, 2.6, (x, y) => (hash(x, y, 3) > 0.6 ? C.h[3] : hash(x, y, 4) > 0.5 ? C.r[2] : C.h[2]));
        limb(P, 7, 19, 25, 13, 3.4, 3, WX, { seed: 2, base: 2.8 });
        limb(P, 8, 13, 25, 19, 3.4, 3, WX, { seed: 3, base: 3.1 });
        for (const [x, y] of [[25, 13], [25, 19]]) { P.set(x, y, C.d[4]); P.set(x + 1, y, C.r[3]); }
        for (const [x, y] of [[14, 15], [17, 16], [19, 15], [13, 17], [16, 14]]) P.set(x, y, hash(x, y, 1) > 0.5 ? C.r[4] : C.a[2]);
      };
      let drew = false;
      for (const [x, y, i] of stones) {
        if (!drew && y > 17.5) { fire(); drew = true; }
        rock(P, [[x - 2.5, y + 1.8], [x - 2.5, y - 0.6], [x - 1, y - 2], [x + 1.6, y - 2], [x + 2.6, y], [x + 2.2, y + 1.8]], { seed: 20 + i, facets: 2, base: 3.6 });
      }
    }, { flame: { x: 8, y: 7 }, glow: { x: 8, y: 6, r: 16, a: 0.5, color: C.a[2], flicker: true } });

    // velký Ringstone: stojící prsten, rozlomený vpravo nahoře
    const ringSpark = [];
    sprite("ringstone", 42, 46, 21, 45, P => {
      blocks(P, 8, 83, 68, 8, { seed: 31, rowH: 4, minW: 8, maxW: 13, base: 3.2, light: x => -(x - 42) / 34 * 1.2 });
      blocks(P, 15, 76, 54, 7, { seed: 32, rowH: 4, minW: 8, maxW: 12, base: 3.7, light: x => -(x - 42) / 27 * 1.2 });

      const cx = 42;
      const cy = 42;
      const R = 33;
      const th = 11;
      const Rm = R - th / 2;
      const nSeg = 11;
      for (let y = 0; y < 84; y++) {
        for (let x = 0; x < 84; x++) {
          const dx = x + 0.5 - cx;
          const dy = y + 0.5 - cy;
          const r = Math.hypot(dx, dy);
          if (r > R || r <= R - th) continue;
          const ang = Math.atan2(dy, dx);
          const jag = (hash(Math.round(r), 1, 77) - 0.5) * 0.12;
          if (ang > -1.25 + jag && ang < -0.38 + jag) continue;
          const rr = (r - Rm) / (th / 2);
          const nz = Math.sqrt(Math.max(0, 1 - rr * rr));
          const nx = Math.cos(ang) * rr;
          const ny = Math.sin(ang) * rr;
          let l = -0.55 * nx - 0.7 * ny + 0.45 * nz;
          let v = 2.6 + l * 2.6;
          const seg = (ang + Math.PI) / (Math.PI * 2) * nSeg;
          const fs = seg - Math.floor(seg);
          if (fs < 0.035) v = 1.2;
          else if (fs < 0.08) v += 0.6;
          if (hash(x, y, 5) > 0.975) v -= 1;
          let c = pick(SX, v);
          const m = vnoise(x / 6, y / 5, 9);
          if (ny < 0.1 && m > 0.55 && (dy < 0 || dx < -10) && ang < -1.1 || (m > 0.62 && dx < -18 && rr < 0.5)) c = pick(GX, 3.2 + l * 1.6 + (hash(x, y, 6) > 0.85 ? 1 : 0));
          P.set(x, y, c);
        }
      }
      // runy na čelní ploše
      for (let k = 0; k < 10; k++) {
        const a = Math.PI * 0.45 + k * 0.42;
        if (a > Math.PI * 1.55 && a < Math.PI * 1.9) continue;
        const x = Math.round(cx + Math.cos(a) * (Rm - 1));
        const y = Math.round(cy + Math.sin(a) * (Rm - 1));
        P.set(x, y, C.y[2]);
        P.set(x, y + 1, C.y[1]);
        if (k % 2) { P.set(x + 1, y, C.y[1]); } else P.set(x - 1, y + 1, C.y[1]);
        P.set(x + 1, y + 2, S[1]);
        if (k % 3 === 0) ringSpark.push([x, y]);
      }
      // ulomený kus na podstavci
      rock(P, [[62, 76], [64, 70], [70, 68], [74, 71], [74, 76]], { seed: 41, facets: 3 });
      rock(P, [[55, 77], [57, 74], [61, 74], [62, 77]], { seed: 42, facets: 2 });
      grass(P, 12, 83, 4, 5);
      grass(P, 70, 83, 3, 7);
    }, { glow: { x: 21, y: 21, r: 20, a: 0.3, color: C.y[1], pulse: true } });
    out.ringstone.sparkle = ringSpark.slice(0, 3).map(([x, y]) => [ART(x), ART(y)]);

    /* ---------- hory: vrcholy ve třech velikostech a několika tvarech ---------- */
    const peak = (name, aw, ah, seed, snow) => sprite(name, aw, ah, aw >> 1, ah - 1, P => {
      const w = aw * HD;
      const h = ah * HD;
      const ax = Math.round(w * (0.38 + hash(seed, 1, 5) * 0.24));
      const apexY = Math.round(h * 0.04);
      const base = h - 1;
      const pts = [[0, base - 3]];
      const n = 4 + Math.floor(w / 14);

      for (let i = 1; i <= n; i++) {
        const t = i / (n + 1);
        const jag = (hash(seed, i, 7) - 0.5) * (h * 0.13);
        pts.push([ax * t + (hash(seed, i, 8) - 0.5) * 5, base - 3 - (base - 3 - apexY) * Math.pow(t, 0.85) + jag]);
      }
      pts.push([ax, apexY]);
      for (let i = n; i >= 1; i--) {
        const t = i / (n + 1);
        const jag = (hash(seed, i + 20, 7) - 0.5) * (h * 0.13);
        pts.push([ax + (w - 1 - ax) * (1 - t) + (hash(seed, i + 20, 8) - 0.5) * 5, base - 3 - (base - 3 - apexY) * Math.pow(t, 0.85) + jag]);
      }
      pts.push([w - 1, base - 3], [w - 4, base], [3, base]);

      const ridge = y => ax + (y - apexY) * 0.14;
      const snowLine = x => apexY + h * 0.36 + (vnoise(x / 4, 1, seed) - 0.5) * 9 - Math.abs(x - ax) * 0.45;

      rock(P, pts, {
        seed, area: w * h / 40, base: 3.2, stretch: 0.5, cx: ax, jit: 0.7, clean: true,
        facetTone: (sx, sy, v, R) => 3.3 - Math.max(-1, Math.min(1, (sx - ridge(sy)) / w * 5)) * 1.3 + (R() - 0.5) * 1.1 - Math.max(0, (sy - h * 0.55) / h) * 1.8,
        color: (v, x, y) => {
          const finger = vnoise(x / 2.2, 5, seed) > 0.62 ? (vnoise(x / 2.2, 5, seed) - 0.62) * 40 : 0;
          if (snow && y < snowLine(x) + finger) {
            return v > 4.3 ? C.white : v > 3.5 ? 0xdde4ef : v > 2.5 ? 0xb9c6dd : v > 1.6 ? 0x8f9cbc : 0x6c7799;
          }
          return pick(SX, v);
        }
      });

      // suť a mech u paty: drobné kameny, žádný šum
      const R = rng(seed + 3);
      for (let i = 0; i < w / 4; i++) {
        const x = 3 + R() * (w - 6);
        const y = base - 1 - R() * 4;
        if (P.get(Math.round(x), Math.round(y)) < 0) continue;
        P.set(Math.round(x), Math.round(y), S[3]);
        P.set(Math.round(x) + 1, Math.round(y), S[1]);
        P.set(Math.round(x), Math.round(y) + 1, S[1]);
      }
      for (let x = 2; x < w - 2; x++) {
        if (vnoise(x / 5, 7, seed) < 0.5) continue;
        for (let y = base - 1; y > base - 1 - vnoise(x / 3, 2, seed) * 6; y--) {
          if (P.get(x, y) >= 0) P.set(x, y, pick(GX, 2.3 + (base - y) * 0.3 + (x < ax ? 0.6 : 0)));
        }
      }
    });

    for (let i = 0; i < 3; i++) {
      peak(`peakS${i}`, 22 + i * 2, 22 + i * 3, 11 + i * 17, false);
      peak(`peakM${i}`, 34 + i * 4, 36 + i * 4, 31 + i * 13, i !== 1);
      peak(`peakL${i}`, 50 + i * 6, 52 + i * 6, 51 + i * 11, true);
    }

    // podhůří: nízké balvany na okraji hor
    sprite("foothill", 16, 9, 8, 8, P => {
      rock(P, [[0, 17], [2, 8], [8, 3], [15, 2], [20, 6], [21, 17]], { seed: 71, area: 30, moss: 4, cracks: 1 });
      rock(P, [[16, 17], [18, 11], [23, 8], [29, 10], [31, 17]], { seed: 72, area: 25, moss: 2 });
      rock(P, [[9, 17], [11, 13], [16, 12], [19, 17]], { seed: 73, facets: 2 });
      grass(P, 26, 17, 2, 4);
    });

    /* ---------- hradby: věž s cimbuřím ---------- */
    sprite("wallTower", 16, 28, 8, 27, P => {
      const lit = x => (x < 10 ? 0.6 : x > 22 ? -1.3 : -(x - 10) / 12 * 0.9);
      blocks(P, 4, 17, 24, 34, { seed: 51, rowH: 5, minW: 7, maxW: 11, base: 3.4, light: lit });
      blocks(P, 2, 50, 28, 6, { seed: 52, rowH: 3, minW: 9, maxW: 13, base: 3, light: lit });
      // ochoz a cimbuří
      blocks(P, 2, 10, 28, 7, { seed: 53, rowH: 4, minW: 8, maxW: 12, base: 3.9, light: lit });
      for (let x = 2; x < 30; x++) P.set(x, 16, pick(SX, 1.4 + lit(x) * 0.5));
      for (const x of [2, 12, 22]) {
        blocks(P, x, 4, 8, 6, { seed: 54 + x, rowH: 6, minW: 8, maxW: 8, base: 4, light: lit });
        for (let xx = x; xx < x + 7; xx++) P.set(xx, 4, pick(SX, 5.2 + lit(xx)));
      }
      // střílna
      for (let y = 26; y <= 37; y++) {
        P.set(15, y, y === 26 ? S[0] : mix(C.ink, C.shade, 0.5));
        P.set(16, y, y === 26 ? S[0] : C.ink);
        P.set(14, y, S[1]);
        P.set(17, y, S[3]);
      }
      // mech u paty
      for (let x = 2; x < 14; x++) {
        if (vnoise(x / 3, 1, 5) < 0.45) continue;
        for (let y = 55; y > 55 - vnoise(x / 2, 4, 5) * 7; y--) P.set(x, y, pick(GX, 2.4 + (55 - y) * 0.35));
      }
      grass(P, 6, 55, 3, 9);
    });
  }

  /* ---------- plameny: 4 snímky, jazyky s horkým jádrem ---------- */
  const flameCache = {};

  function flameFrames(w = 7, h = 11) {
    const key = `${w}x${h}`;
    if (flameCache[key]) return flameCache[key];

    const fw = w * HD;
    const fh = h * HD;
    const cx = fw / 2;
    const frames = [];

    for (let f = 0; f < 4; f++) {
      const P = new Pix(fw, fh);

      for (let y = 0; y < fh; y++) {
        for (let x = 0; x < fw; x++) {
          const v = (fh - 0.5 - y) / fh;
          const off = Math.sin(v * 4.2 - f * Math.PI / 2) * v * fw * 0.12;
          const hw = fw * 0.47 * Math.pow(Math.max(0, 1 - v), 0.75) * Math.min(1, 0.55 + v * 3);
          const dx = Math.abs(x + 0.5 - cx - off);
          if (hw <= 0) continue;
          const n = vnoise(x * 0.42 + 3, (y + f * 5.5) * 0.36, 7);
          const I = (1 - dx / hw) * (1 - v * 0.35) - n * 0.55 * v - v * 0.12;
          if (I <= 0.04) continue;
          const c = I > 0.6 ? C.a[4] : I > 0.46 ? C.a[3] : I > 0.32 ? C.a[2] : I > 0.18 ? C.r[4] : C.r[3];
          P.set(x, y, c);
        }
      }

      // odtržený jazýček nad plamenem
      const sx = Math.round(cx + (f % 2 ? 1 : -1) * 1.5);
      const sy = 2 + (f & 1) * 2 - (f === 3 ? 1 : 0);
      if (P.get(sx, sy) < 0) {
        P.set(sx, sy, C.r[4]);
        P.set(sx, sy + 1, C.r[3]);
      }

      frames.push(PK.fine(P));
    }

    return (flameCache[key] = frames);
  }

  /* ---------- registr ---------- */
  const trees = [];

  function init() {
    if (trees.length) return;
    for (let k = 0; k < 6; k++) trees.push(treeVariant(k));
    makeDoodads();
  }

  init();

  // výběr obměny stromu podle náhodného čísla 0..1: většina zelených, občas podzimní nebo jarní koruna
  const treeKind = h => (h < 0.27 ? 0 : h < 0.52 ? 1 : h < 0.72 ? 2 : h < 0.82 ? 4 : h < 0.92 ? 5 : 3);

  PK.props = {
    trees,
    treeKind,
    mine: mine(),
    mineEmpty: mine(true),
    doodads: out,
    flame: flameFrames
  };
})();
