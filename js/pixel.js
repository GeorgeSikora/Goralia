/*
 * ART STYLE GUIDE  —  "Pixelové království": the Lantern Realm
 * ------------------------------------------------------------------
 * Pixel grid   1 art pixel = 2 logical game units (buffer 480x310,
 *              shown at an integer multiple). No sub-pixel drawing.
 * Light        Always from the top-left. Shadows fall to the lower
 *              right, tinted violet. Ramps hue-shift: shadows lean
 *              blue/violet, highlights lean warm yellow.
 * Palette      Cool teal-violet world + ONE warm accent: amber lantern
 *              light. Amber means "life / ours / interactive".
 *              Ember red + basalt means "the Cinder Host / danger".
 * Outlines     1px, tinted from the neighbouring colour toward ink
 *              (never pure black), on every unit, prop and building.
 * Motif        The broken Ring (a circle with a gap) — lantern cage,
 *              shield emblem, standing stones, selection rune, HUD
 *              studs. The enemy motif is the slit ember-eye.
 * Terrain      Soft dithered tone patches, clean path edges, nothing
 *              taller than a knee on the walkable ground except
 *              interactive objects (trees, ore) and buildings.
 * UI           Carved dark stone, brass bevels, amber glow for focus.
 */
(() => {
  "use strict";

  const PK = (window.PK = window.PK || {});

  /* ---------- colour helpers (packed 0xRRGGBB) ---------- */
  const rgb = (r, g, b) => (r << 16) | (g << 8) | b;
  const cr = c => (c >> 16) & 255;
  const cg = c => (c >> 8) & 255;
  const cb = c => c & 255;

  const mix = (a, b, t) => rgb(
    Math.round(cr(a) + (cr(b) - cr(a)) * t),
    Math.round(cg(a) + (cg(b) - cg(a)) * t),
    Math.round(cb(a) + (cb(b) - cb(a)) * t)
  );

  const css = (c, a = 1) =>
    a >= 1
      ? "#" + c.toString(16).padStart(6, "0")
      : `rgba(${cr(c)},${cg(c)},${cb(c)},${a})`;

  const C = {
    ink: 0x15121f,
    shade: 0x231d33,
    dusk: 0x31294a,
    white: 0xf7f1df,
    g: [0x1b3836, 0x244f3e, 0x32693f, 0x4a8548, 0x6ba459, 0x98c76a, 0xd0df88],
    d: [0x3d2c2b, 0x5a4137, 0x7b5b45, 0x9d7a55, 0xc09c69, 0xe0c68e],
    s: [0x26243a, 0x3b3a55, 0x555672, 0x767892, 0x9d9fb5, 0xc6c7d3, 0xe8e6e8],
    b: [0x1a1624, 0x2b2236, 0x403349, 0x5a4a5c, 0x7a6674],
    w: [0x2e1f21, 0x4a3029, 0x6c4a35, 0x946b45, 0xbe9660],
    t: [0x1f3a4d, 0x2a5670, 0x3a7a8c, 0x5aa3a8, 0x8fd0c4],
    u: [0x1c2f66, 0x2850a0, 0x3f7fd0, 0x6fb2f0, 0xb4e0ff],
    r: [0x3b1220, 0x6e1f2c, 0xa8323a, 0xd65a3c, 0xff8f4a, 0xffd27a],
    a: [0xa85a1c, 0xe0902a, 0xffbf45, 0xffe08a, 0xfff6cc],
    v: [0x1d3d5c, 0x2b6285, 0x3f90a8, 0x79c4cc, 0xc6f0ee],
    m: [0x3c2a6b, 0x6c47b0, 0xa078e8, 0xd0b4ff],
    y: [0x2b7f93, 0x4fc0d0, 0x9ef0f0, 0xe0ffff],
    h: [0x24212c, 0x34303c, 0x4a4552, 0x665f68, 0x8a8085, 0xa79d98],
    skin: [0xf2c9a2, 0xd49a72, 0x9a6248],
    bone: [0xd8cfb8, 0xa59b88, 0x6d6558],
    gold: [0xb8741f, 0xffc83a, 0xfff09a],
    cap: [0x8a2549, 0xd84a6a, 0xff8fa0],
    glow: [0x2fa58c, 0x5ff0c0, 0xcfffe8]
  };

  /* Team accent sets used by units, banners and buildings. */
  const TEAM = {
    blue: {
      d: C.u[0], m: C.u[2], s: C.u[1], l: C.u[3], h: C.u[4],
      accent: C.a[2], accentL: C.a[3], light: C.a[2], ui: 0x58a6e0
    },
    red: {
      d: C.r[0], m: C.r[2], s: C.r[1], l: C.r[3], h: C.r[4],
      accent: C.r[4], accentL: C.r[5], light: C.r[4], ui: 0xe2603c
    }
  };

  /* ---------- random + noise ---------- */
  const rng = seed => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  const hash = (x, y, s = 0) => {
    let h = Math.imul(x | 0, 374761393) +
      Math.imul(y | 0, 668265263) +
      Math.imul(s | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  const vnoise = (x, y, s = 0) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, s);
    const b = hash(xi + 1, yi, s);
    const c = hash(xi, yi + 1, s);
    const d = hash(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };

  const fbm = (x, y, s = 0, oct = 3) => {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    let norm = 0;

    for (let i = 0; i < oct; i++) {
      sum += amp * vnoise(x * f, y * f, s + i * 17);
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }

    return sum / norm;
  };

  /* Noise that tiles with an integer period (for scrolling overlays). */
  const tnoise = (x, y, period, s = 0) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const m = n => ((n % period) + period) % period;
    const a = hash(m(xi), m(yi), s);
    const b = hash(m(xi + 1), m(yi), s);
    const c = hash(m(xi), m(yi + 1), s);
    const d = hash(m(xi + 1), m(yi + 1), s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };

  const BAYER = [
    0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5
  ].map(v => (v + 0.5) / 16);

  const bayer = (x, y) => BAYER[((y & 3) << 2) + (x & 3)];

  /* Tone index from a continuous value; blends only in a narrow dithered band. */
  const dither = (t, x, y, band = 0.45) => {
    const base = Math.floor(t);
    const f = t - base;
    const p = Math.max(0, Math.min(1, (f - (0.5 - band / 2)) / band));
    return base + (p > bayer(x, y) ? 1 : 0);
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const smooth = (a, b, v) => {
    const t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  /* ---------- canvas helper ---------- */
  function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    return { c, g };
  }

  /* ---------- Pix: an indexable pixel surface ---------- */
  class Pix {
    constructor(w, h) {
      this.w = w;
      this.h = h;
      this.d = new Uint32Array(w * h);
    }

    set(x, y, c) {
      x |= 0;
      y |= 0;
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
      if (c == null || c < 0) return;
      this.d[y * this.w + x] = (0xff000000 | c) >>> 0;
    }

    setA(x, y, c, a) {
      x |= 0;
      y |= 0;
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
      this.d[y * this.w + x] = (((a & 255) << 24) | c) >>> 0;
    }

    get(x, y) {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
      const v = this.d[y * this.w + x];
      return v >>> 24 ? v & 0xffffff : -1;
    }

    alpha(x, y) {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
      return this.d[y * this.w + x] >>> 24;
    }

    clear(x, y) {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
      this.d[y * this.w + x] = 0;
    }

    rect(x, y, w, h, c) {
      for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++) this.set(x + xx, y + yy, c);
      }
    }

    line(x0, y0, x1, y1, c) {
      x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
      const dx = Math.abs(x1 - x0);
      const dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;

      for (;;) {
        this.set(x0, y0, c);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    }

    /* Two-pixel-wide line (stride legs, thick weapons). */
    line2(x0, y0, x1, y1, c) {
      this.line(x0, y0, x1, y1, c);
      this.line(x0 + 1, y0, x1 + 1, y1, c);
    }

    /* Ellipse in continuous coordinates; fill may be a colour or fn(x,y). */
    disc(cx, cy, rx, ry, fill) {
      const x0 = Math.floor(cx - rx);
      const x1 = Math.ceil(cx + rx);
      const y0 = Math.floor(cy - ry);
      const y1 = Math.ceil(cy + ry);

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = (x + 0.5 - cx) / rx;
          const dy = (y + 0.5 - cy) / ry;
          if (dx * dx + dy * dy <= 1) {
            this.set(x, y, typeof fill === "function" ? fill(x, y) : fill);
          }
        }
      }
    }

    ring(cx, cy, rx, ry, c, thick = 1) {
      const x0 = Math.floor(cx - rx - 1);
      const x1 = Math.ceil(cx + rx + 1);
      const y0 = Math.floor(cy - ry - 1);
      const y1 = Math.ceil(cy + ry + 1);
      const ix = Math.max(0.1, rx - thick);
      const iy = Math.max(0.1, ry - thick);

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const ox = (x + 0.5 - cx) / rx;
          const oy = (y + 0.5 - cy) / ry;
          const nx = (x + 0.5 - cx) / ix;
          const ny = (y + 0.5 - cy) / iy;
          if (ox * ox + oy * oy <= 1 && nx * nx + ny * ny > 1) {
            this.set(x, y, c);
          }
        }
      }
    }

    poly(pts, fill) {
      let minY = Infinity;
      let maxY = -Infinity;

      for (const p of pts) {
        minY = Math.min(minY, p[1]);
        maxY = Math.max(maxY, p[1]);
      }

      const n = pts.length;

      for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
        const yc = y + 0.5;
        const xs = [];

        for (let i = 0; i < n; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % n];

          if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) {
            xs.push(a[0] + (yc - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
          }
        }

        xs.sort((p, q) => p - q);

        for (let k = 0; k + 1 < xs.length; k += 2) {
          const xa = Math.ceil(xs[k] - 0.5);
          const xb = Math.floor(xs[k + 1] - 0.5);

          for (let x = xa; x <= xb; x++) {
            this.set(x, y, typeof fill === "function" ? fill(x, y) : fill);
          }
        }
      }
    }

    shade(x0, y0, x1, y1, fn) {
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const c = fn(x, y);
          if (c != null && c >= 0) this.set(x, y, c);
        }
      }
    }

    /* Tinted outline: each new pixel takes its neighbour's colour pushed toward ink. */
    outline(ink = C.ink, t = 0.74, diag = false) {
      const out = [];

      for (let y = 0; y < this.h; y++) {
        for (let x = 0; x < this.w; x++) {
          if (this.d[y * this.w + x] >>> 24) continue;

          let best = -1;
          const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
          if (diag) nb.push([1, 1], [-1, 1], [1, -1], [-1, -1]);

          for (const [dx, dy] of nb) {
            const c = this.get(x + dx, y + dy);
            if (c >= 0) { best = c; break; }
          }

          if (best >= 0) out.push(x, y, mix(best, ink, t));
        }
      }

      for (let i = 0; i < out.length; i += 3) this.set(out[i], out[i + 1], out[i + 2]);
      return this;
    }

    stamp(src, dx, dy) {
      for (let y = 0; y < src.h; y++) {
        for (let x = 0; x < src.w; x++) {
          const v = src.d[y * src.w + x];
          if (v >>> 24) this.set(x + dx, y + dy, v & 0xffffff);
        }
      }
      return this;
    }

    flipX() {
      const o = new Pix(this.w, this.h);
      for (let y = 0; y < this.h; y++) {
        for (let x = 0; x < this.w; x++) {
          o.d[y * this.w + (this.w - 1 - x)] = this.d[y * this.w + x];
        }
      }
      return o;
    }

    clone() {
      const o = new Pix(this.w, this.h);
      o.d.set(this.d);
      return o;
    }

    scale(k) {
      const o = new Pix(this.w * k, this.h * k);
      for (let y = 0; y < o.h; y++) {
        for (let x = 0; x < o.w; x++) {
          o.d[y * o.w + x] = this.d[Math.floor(y / k) * this.w + Math.floor(x / k)];
        }
      }
      return o;
    }

    crop(x, y, w, h) {
      const o = new Pix(w, h);
      for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++) {
          const sx = x + xx;
          const sy = y + yy;
          if (sx >= 0 && sy >= 0 && sx < this.w && sy < this.h) {
            o.d[yy * w + xx] = this.d[sy * this.w + sx];
          }
        }
      }
      return o;
    }

    /* Every opaque pixel mixed toward colour c (hit flash, disabled look). */
    tint(c, t) {
      const o = this.clone();
      for (let i = 0; i < o.d.length; i++) {
        const v = o.d[i];
        if (v >>> 24) o.d[i] = (0xff000000 | mix(v & 0xffffff, c, t)) >>> 0;
      }
      return o;
    }

    /* Ordered-dither dissolve: keep = 0..1 share of pixels that stay. */
    dissolve(keep) {
      const o = this.clone();
      for (let y = 0; y < this.h; y++) {
        for (let x = 0; x < this.w; x++) {
          if (bayer(x, y) > keep) o.d[y * this.w + x] = 0;
        }
      }
      return o;
    }

    /* Rotate 90 degrees clockwise (lossless). */
    rot90() {
      const o = new Pix(this.h, this.w);
      for (let y = 0; y < this.h; y++) {
        for (let x = 0; x < this.w; x++) {
          o.d[x * o.w + (this.h - 1 - y)] = this.d[y * this.w + x];
        }
      }
      return o;
    }

    toCanvas() {
      const { c, g } = makeCanvas(this.w, this.h);
      const img = g.createImageData(this.w, this.h);
      const u = new Uint32Array(img.data.buffer);

      for (let i = 0; i < this.d.length; i++) {
        const v = this.d[i];
        if (!(v >>> 24)) continue;
        u[i] = ((v & 0xff000000) |
          ((v & 0xff) << 16) |
          (v & 0xff00) |
          ((v >> 16) & 0xff)) >>> 0;
      }

      g.putImageData(img, 0, 0);
      return c;
    }

    static fromRows(rows, legend) {
      const w = Math.max(...rows.map(r => r.length));
      const p = new Pix(w, rows.length);

      rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const ch = row[x];
          if (ch === "." || ch === " ") continue;
          const c = legend[ch];
          if (c === undefined) throw new Error(`Pix.fromRows: unknown "${ch}"`);
          p.set(x, y, c);
        }
      });

      return p;
    }
  }

  /* Pixel-aligned ellipse outline directly on a 2D context (UI rings). */
  function strokeEllipse(g, cx, cy, rx, ry, color) {
    g.fillStyle = color;
    const steps = Math.max(16, Math.round((rx + ry) * 3));
    let lx = null;
    let ly = null;

    for (let i = 0; i < steps; i++) {
      const a = i / steps * Math.PI * 2;
      const x = Math.round(cx + Math.cos(a) * rx);
      const y = Math.round(cy + Math.sin(a) * ry);
      if (x === lx && y === ly) continue;
      g.fillRect(x, y, 1, 1);
      lx = x;
      ly = y;
    }
  }

  Object.assign(PK, {
    C, TEAM, rgb, mix, css, rng, hash, vnoise, fbm, tnoise, bayer, dither,
    clamp, smooth, makeCanvas, Pix, strokeEllipse,
    VW: 480,
    VH: 310,
    MAPW: 480,
    MAPH: 240
  });
})();
