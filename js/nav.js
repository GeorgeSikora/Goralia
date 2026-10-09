/*
 * Průchodnost mapy: mřížka s vodou jako překážkou, přímá viditelnost a hledání cesty (A*).
 * Brody (cesty přes vodu) jsou průchozí. Sdílí server i prohlížeč.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./maps.js"));
  else (root.PK = root.PK || {}).nav = factory(root.PK.maps);
})(typeof window !== "undefined" ? window : globalThis, MAPS => {
  "use strict";

  const CELL = 8; // logických jednotek na buňku
  const SQRT2 = Math.SQRT2;
  const MAX_EXPAND = 40000;
  const cache = new Map();

  class Nav {
    constructor(map) {
      this.map = map;
      this.w = Math.ceil(map.size[0] * 2 / CELL);
      this.h = Math.ceil(map.size[1] * 2 / CELL);
      this.blocked = new Uint8Array(this.w * this.h);
      this.rasterize(map.terrain);

      const n = this.w * this.h;
      this.maxExpand = Math.max(MAX_EXPAND, Math.floor(n / 3));
      this.seq = 0;
      this.stamp = new Uint32Array(n);
      this.gs = new Float32Array(n);
      this.fs = new Float32Array(n);
      this.parent = new Int32Array(n);
      this.closed = new Uint32Array(n);
    }

    // Stejný výsledek jako MAPS.isWater ve středu buňky, ale prochází jen buňky kolem tahů (zvládne i obří mapy).
    rasterize(rec) {
      const { w, h, blocked } = this;
      const step = CELL / 2;
      const ford = new Uint8Array(w * h);

      const paint = (pts, radius, out) => {
        if (radius <= 0) return;

        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, ay] = pts[i];
          const [bx, by] = pts[i + 1];
          const dx = bx - ax;
          const dy = by - ay;
          const len2 = dx * dx + dy * dy || 1;
          const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - radius) / step) - 1);
          const x1 = Math.min(w - 1, Math.ceil((Math.max(ax, bx) + radius) / step) + 1);
          const y0 = Math.max(0, Math.floor((Math.min(ay, by) - radius) / step) - 1);
          const y1 = Math.min(h - 1, Math.ceil((Math.max(ay, by) + radius) / step) + 1);

          for (let cy = y0; cy <= y1; cy++) {
            const py = (cy + 0.5) * step;

            for (let cx = x0; cx <= x1; cx++) {
              const px = (cx + 0.5) * step;
              const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
              if (Math.hypot(px - (ax + dx * t), py - (ay + dy * t)) < radius) out[cy * w + cx] = 1;
            }
          }
        }
      };

      for (const r of rec.rivers) {
        if (r.legacy) {
          for (let cy = 0; cy < h; cy++) {
            const ay = (cy + 0.5) * step;
            const half = MAPS.brookHW(ay) - 1;
            const bx = MAPS.brookX(ay);

            for (let cx = 0; cx < w; cx++) {
              if (Math.abs((cx + 0.5) * step - bx) < half) blocked[cy * w + cx] = 1;
            }
          }
        } else {
          paint(r.pts, r.hw - 1, blocked);
        }
      }

      for (const road of rec.roads) paint(road.pts, road.w * (road.main ? 0.8 : 0.5), ford);
      for (let i = 0; i < blocked.length; i++) if (ford[i]) blocked[i] = 0;
    }

    index(x, y) {
      const cx = Math.max(0, Math.min(this.w - 1, Math.floor(x / CELL)));
      const cy = Math.max(0, Math.min(this.h - 1, Math.floor(y / CELL)));
      return cy * this.w + cx;
    }

    isBlocked(x, y) {
      return this.blocked[this.index(x, y)] === 1;
    }

    // Je v okolí bodu (poloměr r) voda? Pro stavby a jiné větší objekty.
    isBlockedArea(x, y, r) {
      return this.isBlocked(x, y) || this.isBlocked(x + r, y) || this.isBlocked(x - r, y) ||
        this.isBlocked(x, y + r) || this.isBlocked(x, y - r);
    }

    center(i) {
      return { x: ((i % this.w) + 0.5) * CELL, y: (Math.floor(i / this.w) + 0.5) * CELL };
    }

    // Přímá cesta bez vody (koncový bod se nekontroluje, může stát na břehu).
    clear(x0, y0, x1, y1) {
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 4);

      for (let i = 1; i < n; i++) {
        const t = i / n;
        if (this.isBlocked(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
      }

      return true;
    }

    nearestFree(i) {
      if (this.blocked[i] === 0) return i;

      const cx0 = i % this.w;
      const cy0 = Math.floor(i / this.w);

      for (let r = 1; r <= 10; r++) {
        let best = -1;
        let bestD = Infinity;

        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const cx = cx0 + dx;
            const cy = cy0 + dy;
            if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h || this.blocked[cy * this.w + cx]) continue;
            const d = dx * dx + dy * dy;

            if (d < bestD) {
              bestD = d;
              best = cy * this.w + cx;
            }
          }
        }

        if (best >= 0) return best;
      }

      return -1;
    }

    // Waypointy od startu k cíli; když cíl není dosažitelný, končí v nejbližším dosažitelném místě.
    path(sx, sy, gx, gy) {
      const start = this.nearestFree(this.index(sx, sy));
      const goalWanted = this.index(gx, gy);
      const goal = this.nearestFree(goalWanted);
      if (start < 0 || goal < 0) return [];

      const w = this.w;
      const gcx = goal % w;
      const gcy = Math.floor(goal / w);
      const heuristic = i => {
        const dx = Math.abs((i % w) - gcx);
        const dy = Math.abs(Math.floor(i / w) - gcy);
        return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
      };

      const seq = ++this.seq;
      const { stamp, gs, fs, parent, closed, blocked } = this;
      const heap = [];

      const push = i => {
        heap.push(i);
        let k = heap.length - 1;

        while (k > 0) {
          const p = (k - 1) >> 1;
          if (fs[heap[p]] <= fs[heap[k]]) break;
          [heap[p], heap[k]] = [heap[k], heap[p]];
          k = p;
        }
      };

      const pop = () => {
        const top = heap[0];
        const last = heap.pop();

        if (heap.length) {
          heap[0] = last;
          let k = 0;

          for (;;) {
            const l = k * 2 + 1;
            const r = l + 1;
            let m = k;
            if (l < heap.length && fs[heap[l]] < fs[heap[m]]) m = l;
            if (r < heap.length && fs[heap[r]] < fs[heap[m]]) m = r;
            if (m === k) break;
            [heap[m], heap[k]] = [heap[k], heap[m]];
            k = m;
          }
        }

        return top;
      };

      stamp[start] = seq;
      gs[start] = 0;
      fs[start] = heuristic(start);
      parent[start] = -1;
      push(start);

      let best = start;
      let bestH = fs[start];
      let reached = false;

      for (let expanded = 0; heap.length && expanded < this.maxExpand; expanded++) {
        const cur = pop();
        if (closed[cur] === seq) continue;
        closed[cur] = seq;

        if (cur === goal) {
          reached = true;
          best = cur;
          break;
        }

        const h = heuristic(cur);
        if (h < bestH) {
          bestH = h;
          best = cur;
        }

        const cx = cur % w;
        const cy = Math.floor(cur / w);

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= this.h) continue;
            const ni = ny * w + nx;
            if (blocked[ni] || closed[ni] === seq) continue;
            if (dx && dy && (blocked[cy * w + nx] || blocked[ny * w + cx])) continue;

            const g = gs[cur] + (dx && dy ? SQRT2 : 1);

            if (stamp[ni] !== seq || g < gs[ni]) {
              stamp[ni] = seq;
              gs[ni] = g;
              fs[ni] = g + heuristic(ni);
              parent[ni] = cur;
              push(ni);
            }
          }
        }
      }

      const nodes = [];
      for (let i = best; i >= 0 && i !== start; i = parent[i]) nodes.push(this.center(i));
      nodes.reverse();

      // vyhladit: přeskočit mezilehlé body, kam je vidět
      const out = [];
      let cur = { x: sx, y: sy };
      let i = 0;

      while (i < nodes.length) {
        let j = nodes.length - 1;
        while (j > i && !this.clear(cur.x, cur.y, nodes[j].x, nodes[j].y)) j--;
        out.push(nodes[j]);
        cur = nodes[j];
        i = j + 1;
      }

      if (reached && goalWanted === goal && out.length) out[out.length - 1] = { x: gx, y: gy };
      return out;
    }
  }

  return {
    CELL,
    forMap(map) {
      let nav = cache.get(map.id);
      if (!nav) {
        nav = new Nav(map);
        cache.set(map.id, nav);
      }
      return nav;
    },
    forget(id) {
      cache.delete(id);
    }
  };
});
