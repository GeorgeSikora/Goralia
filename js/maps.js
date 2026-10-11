/*
 * Mapy: rozložení základen, dolů a stromů (používá server i klient) a recept na terén (jen klient).
 * Logické souřadnice jsou ve hře 2x větší než art px; "size" je v art px.
 */
(function (root, factory) {
  const maps = factory();
  if (typeof module === "object" && module.exports) module.exports = maps;
  else (root.PK = root.PK || {}).maps = maps;
})(typeof window !== "undefined" ? window : globalThis, () => {
  "use strict";

  const mulberry = seed => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* ---------- voda a skály (společné pro vykreslení i průchodnost) ---------- */
  function distToPolyline(x, y, pts) {
    let best = Infinity;

    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
    }

    return best;
  }

  // Je bod (art px) ve vodě? Cesty přes vodu jsou brody a jdou přejít; hrana vody je o px úžší než vykreslená.
  function isWater(rec, ax, ay) {
    let water = false;

    for (const r of rec.rivers) {
      if (distToPolyline(ax, ay, r.pts) < r.hw - 1) water = true;
    }

    return water && !onRoad(rec, ax, ay);
  }

  const onRoad = (rec, ax, ay) => rec.roads.some(road => distToPolyline(ax, ay, road.pts) < road.w * (road.main ? 0.8 : 0.5));

  // Hradba je tenká zeď (půl šířky hw), k poloměru se přidává rezerva, aby mezi buňkami mřížky nezůstala škvíra.
  const WALL_PAD = 1.5;
  // Poloměr zdi shodný s vykreslením koruny; líc zdi (zhruba 3 px pod korunou) je taky neprůchodný.
  const wallR = w => w.hw * 1.5 + 1 + WALL_PAD * 0.5;
  const WALL_FACE = 3;
  // Brána: průchod přes hradbu je o něco širší než samotná cesta (stejně jako vykreslená mezera).
  const onGate = (rec, ax, ay) => rec.roads.some(road => distToPolyline(ax, ay, road.pts) < road.w * 1.1);

  // Neprůchodná skála: hory (hřeben se šířkou) a hradby; cesta přes hradbu tvoří bránu, přes hory ne.
  function isRock(rec, ax, ay) {
    for (const m of rec.mountains || []) {
      if (distToPolyline(ax, ay, m.pts) < m.hw - 1) return true;
    }

    for (const w of rec.walls || []) {
      const r = wallR(w);
      if ((distToPolyline(ax, ay, w.pts) < r || distToPolyline(ax, ay - WALL_FACE, w.pts) < r) && !onGate(rec, ax, ay)) return true;
    }

    return false;
  }

  // Logické souřadnice, s malým odstupem (stromy a budovy nestojí na břehu).
  const waterNear = (rec, x, y, r = 12) =>
    [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].some(([dx, dy]) => isWater(rec, (x + dx) / 2, (y + dy) / 2));

  /* ---------- základny ---------- */
  // fx/fy jsou směry ke středu mapy (+1 nebo -1), podle nich se zrcadlí rozestavění kolem radnice.
  function base(slotIndex, x, y, fx, fy, zone) {
    const type = "hall";

    return {
      hq: { type, x, y },
      buildings: [{ type: "barracks", x: x + fx * 71, y: y + fy * 116 }],
      units: [
        { type: "worker", x: x + fx * 53, y: y - fy * 44 },
        { type: "worker", x: x + fx * 44, y: y + fy * 28 },
        { type: "soldier", x: x + fx * 139, y: y - fy * 4 },
        { type: "soldier", x: x + fx * 160, y: y + fy * 17 }
      ],
      zone,
      facing: fx,
      spawn: [fx * 58, fy * 29]
    };
  }

  const baseMines = (s, fx, fy) => [
    [s.hq.x + fx * 200, s.hq.y - fy * 126],
    [s.hq.x + fx * 270, s.hq.y + fy * 130]
  ];

  /* ---------- recept terénu (art px) ---------- */
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

  function roadTo(a, c, jog) {
    const dx = c[0] - a[0];
    const dy = c[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len * jog;
    const ny = dx / len * jog;
    const p1 = lerp(a, c, 0.33);
    const p2 = lerp(a, c, 0.66);
    return [a, [p1[0] + nx, p1[1] + ny], [p2[0] - nx, p2[1] - ny], c];
  }

  // Terén pro mapy bez ručně kreslených cest: plácky u základen, cesty do středu, popel kolem rudé pevnosti.
  function autoTerrain(seed, W, H, slots, rivers, extraAsh, opts = {}) {
    const r = mulberry(seed);
    const center = [W / 2, H / 2];
    const area = Math.min(30, W * H / (480 * 240)); // obří mapy mají dekorace řidší, aby se nezahltilo vykreslování
    const plazas = [];
    const terraces = [];
    const roads = [];
    const pave = [];
    const ashCircles = [];
    const mirror = opts.mirror || null;
    const landmarks = [];
    if (opts.stone) landmarks.push(["ringstone", opts.stone[0], opts.stone[1], true, 22]);

    for (const s of slots) {
      const ax = s.hq.x / 2;
      const ay = s.hq.y / 2;
      const bx = s.buildings[0].x / 2;
      const by = s.buildings[0].y / 2;
      const fx = s.facing;
      const fy = s.buildings[0].y > s.hq.y ? 1 : -1;

      plazas.push({ x: ax, y: ay + 17 * fy, rx: 34, ry: 17, kind: "hall" });
      landmarks.push(["campfire", ax - fx * 28, ay + fy * 49, true, 9], ["crates", ax - fx * 42, ay + fy * 31, true, 9]);

      plazas.push({ x: bx, y: by + 19 * fy, rx: 23, ry: 11, kind: "yard" });
      pave.push([ax, ay + 17 * fy, 52]);
      // zrcadlené mapy: oblouk cesty se zrcadlí spolu se základnou, střední základny jdou rovně
      const jog = opts.straight ? 0 : !mirror ? (r() - 0.5) * 50 : Math.abs(ax - center[0]) < 8 ? 0 : 22 * fx * fy;
      if (opts.autoRoads !== false) roads.push({ w: 7, main: true, pts: roadTo([ax, ay + 17 * fy], center, jog) });
      roads.push({ w: 4.5, pts: [[bx, by + 12 * fy], [(bx + ax) / 2, ay + 20 * fy], [ax + fx * 24, ay + 19 * fy]] });
      landmarks.push(["lanternPost", ax + fx * 44, ay + 34 * fy, true, 5], ["lanternPost", ax + fx * 90, ay + 40 * fy, true, 5]);
    }

    roads.push(...(opts.roads || []));

    const cracks = ashCircles.map(([x, y, rad]) => ({
      x: x - rad * 0.8, y: y - rad * 0.8, w: rad * 1.6, h: rad * 1.6, n: Math.round(Math.PI * rad * rad * 0.0027)
    }));

    const n = k => Math.max(1, Math.round(k * area));
    const scatter = [
      ["crystalCyan", n(3), 14, W - 14, 40, H - 20, 14, 0],
      ["crystalViolet", n(3), 14, W - 14, 40, H - 20, 14, 0],
      ["monolith", n(4), 14, W - 14, 40, H - 20, 7, 0],
      ["shroomGlow", n(9), 14, W - 14, 30, H - 12, 7, 0],
      ["shroomRed", n(7), 14, W - 14, 30, H - 12, 6, 0],
      ["stoneA", n(5), 14, W - 14, 30, H - 12, 8, 0],
      ["stoneB", n(9), 14, W - 14, 30, H - 12, 5],
      ["fern", n(16), 14, W - 14, 30, H - 12, 6, 0],
      ["stump", n(2), 14, W - 14, 40, H - 20, 6, 0],
      ["columnFallen", n(1), 14, W - 14, 40, H - 20, 9, 0],
      ["deadTree", n(7), 14, W - 14, 26, H - 14, 11, 1],
      ["ribs", n(1), 14, W - 14, 26, H - 14, 11, 1],
      ["skullStake", n(4), 14, W - 14, 26, H - 14, 5, 1]
    ];

    const mist = [];
    for (let i = 0; i < Math.max(4, Math.round(4 * area)); i++) mist.push([r() * W, 20 + r() * (H - 60), 3 + r() * 4]);

    return {
      rivers, roads, plazas, terraces, pave, paveX: [],
      mountains: opts.mountains || [], walls: opts.walls || [],
      ash: { circles: ashCircles }, cracks,
      doodads: { landmarks, scatter },
      tufts: { x: 12, y: 22, w: W - 24, h: H - 35, n: Math.round(240 * area * 1.4), tries: Math.round(900 * area * 1.4) },
      mist, seed, mirror
    };
  }

  // Žádné mapy nejsou vestavěné: všechny se načítají ze souborů maps/*.json (server) a registrují se.
  const list = [];
  const byId = new Map();

  /* ---------- soubor mapy (goralia-map, verze 1) ---------- */
  // Z editoru se mapa ukládá jako JSON: základny, doly a stromy v logických souřadnicích,
  // voda a cesty (tahy štětcem) v art px. Ze souboru se ve hře sestaví stejná mapa na serveru i v prohlížeči.
  const DOC = {
    FORMAT: "goralia-map", VERSION: 1,
    MIN_W: 320, MAX_W: 5000, MIN_H: 200, MAX_H: 5000,
    MAX_BASES: 16, MAX_TREES: 3000, MAX_GOLD: 60, MAX_WATER: 300, MAX_ROADS: 80, MAX_MOUNTAINS: 300, MAX_WALLS: 300, MAX_PTS: 600, MAX_TOTAL_PTS: 20000
  };

  const isNum = v => typeof v === "number" && Number.isFinite(v);
  const cleanText = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max) : "");

  // Nedůvěryhodný vstup (soubor, požadavek na server) -> { doc, errors }; doc je očištěný a oříznutý na meze.
  function normalizeDoc(raw) {
    const errors = [];

    if (!raw || typeof raw !== "object" || raw.format !== DOC.FORMAT) {
      return { doc: null, errors: ["Soubor není mapa Goralia."] };
    }

    const id = typeof raw.id === "string" ? raw.id : "";
    if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(id)) errors.push("Identifikátor mapy: 1 až 31 znaků a-z, 0-9 a pomlčka.");

    const name = cleanText(raw.name, 32);
    if (!name) errors.push("Mapa potřebuje název.");

    const w = Array.isArray(raw.size) ? Math.round(raw.size[0]) : NaN;
    const h = Array.isArray(raw.size) ? Math.round(raw.size[1]) : NaN;

    if (!(w >= DOC.MIN_W && w <= DOC.MAX_W && h >= DOC.MIN_H && h <= DOC.MAX_H)) {
      errors.push(`Velikost mapy: šířka ${DOC.MIN_W}–${DOC.MAX_W}, výška ${DOC.MIN_H}–${DOC.MAX_H}.`);
    }

    if (errors.length) return { doc: null, errors };

    const LW = w * 2;
    const LH = h * 2;
    const point = (p, W, H, pad = 0) =>
      Array.isArray(p) && isNum(p[0]) && isNum(p[1]) && p[0] >= -pad && p[0] <= W + pad && p[1] >= -pad && p[1] <= H + pad;
    const take = (v, max, what) => {
      if (v == null) return [];
      if (!Array.isArray(v)) { errors.push(`${what}: očekává se seznam.`); return []; }
      if (v.length > max) errors.push(`${what}: nejvýše ${max}.`);
      return v.slice(0, max);
    };
    const stroke = (s, W, H, key, lo, hi) => {
      if (!s || !isNum(s[key]) || !Array.isArray(s.pts) || s.pts.length < 2) return null;
      const pts = s.pts.slice(0, DOC.MAX_PTS);
      if (!pts.every(p => point(p, W, H, 60))) return null;
      return { pts: pts.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]), [key]: Math.min(hi, Math.max(lo, s[key])) };
    };

    const bases = take(raw.bases, DOC.MAX_BASES, "Základny").filter(b => b && point([b.x, b.y], LW, LH)).map(b => ({ x: Math.round(b.x), y: Math.round(b.y) }));
    const gold = take(raw.gold, DOC.MAX_GOLD, "Doly").filter(g => point(g, LW, LH)).map(g =>
      (isNum(g[2]) ? [Math.round(g[0]), Math.round(g[1]), Math.min(20000, Math.max(500, Math.round(g[2])))] : [Math.round(g[0]), Math.round(g[1])]));
    const trees = take(raw.trees, DOC.MAX_TREES, "Stromy").filter(t => point(t, LW, LH)).map(t => [Math.round(t[0]), Math.round(t[1])]);
    const water = take(raw.water, DOC.MAX_WATER, "Voda").map(s => stroke(s, w, h, "hw", 2, 20)).filter(Boolean);
    const mountains = take(raw.mountains, DOC.MAX_MOUNTAINS, "Hory").map(s => stroke(s, w, h, "hw", 4, 40)).filter(Boolean);
    const walls = take(raw.walls, DOC.MAX_WALLS, "Hradby").map(s => stroke(s, w, h, "hw", 2, 5)).filter(Boolean);
    const roads = take(raw.roads, DOC.MAX_ROADS, "Cesty").map(s => {
      const r = stroke(s, w, h, "w", 2, 12);
      return r && { pts: r.pts, w: r.w, main: !!s.main };
    }).filter(Boolean);

    if (bases.length < 2) errors.push("Mapa potřebuje aspoň dvě základny.");
    if ([water, roads, mountains, walls].reduce((n, list) => n + list.reduce((m, s) => m + s.pts.length, 0), 0) > DOC.MAX_TOTAL_PTS) {
      errors.push("Voda, cesty, hory a hradby jsou moc podrobné.");
    }

    if (errors.length) return { doc: null, errors };

    const doc = {
      format: DOC.FORMAT, version: DOC.VERSION, id, name,
      description: cleanText(raw.description, 400) || "Vlastní mapa.",
      size: [w, h], seed: isNum(raw.seed) ? Math.abs(Math.round(raw.seed)) % 1000000 : 1,
      autoRoads: raw.autoRoads !== false,
      bases, gold, trees, water, roads, mountains, walls
    };

    return { doc, errors };
  }

  // Hráčův prostor: obdélník kolem základny; se sousedy se dělí v polovině spojnice, takže se nikdy nepřekrývají.
  function zonesFor(bases, LW, LH) {
    return bases.map((b, i) => {
      const z = { x0: 45, y0: 85, x1: LW - 45, y1: LH - 65 };

      bases.forEach((o, j) => {
        if (i === j) return;
        const dx = o.x - b.x;
        const dy = o.y - b.y;

        if (Math.abs(dx) >= Math.abs(dy)) {
          if (dx > 0) z.x1 = Math.min(z.x1, (b.x + o.x) / 2 - 15);
          else z.x0 = Math.max(z.x0, (b.x + o.x) / 2 + 15);
        } else if (dy > 0) {
          z.y1 = Math.min(z.y1, (b.y + o.y) / 2 - 15);
        } else {
          z.y0 = Math.max(z.y0, (b.y + o.y) / 2 + 15);
        }
      });

      return z;
    });
  }

  // Dva doly u základny, stejně jako na vestavěných mapách (strana ke středu mapy).
  function baseMinesFor(x, y, LW, LH) {
    const fx = x <= LW / 2 ? 1 : -1;
    const fy = y <= LH / 2 ? 1 : -1;
    return baseMines({ hq: { x, y } }, fx, fy);
  }

  // Základna na daném místě; zrcadlí se podle toho, na které straně mapy leží (směr ke středu).
  const baseAt = (x, y, LW, LH, zone) => base(0, x, y, x <= LW / 2 ? 1 : -1, y <= LH / 2 ? 1 : -1, zone);

  function compileDoc(d) {
    const [w, h] = d.size;
    const LW = w * 2;
    const LH = h * 2;
    const zones = zonesFor(d.bases, LW, LH);
    const slots = d.bases.map((b, i) => baseAt(b.x, b.y, LW, LH, zones[i]));
    const n = slots.length;
    const terrain = autoTerrain(d.seed, w, h, slots, d.water.map(s => ({ pts: s.pts, hw: s.hw })), [], {
      straight: true, autoRoads: d.autoRoads, roads: d.roads.map(s => ({ w: s.w, main: s.main, pts: s.pts })),
      mountains: d.mountains.map(s => ({ pts: s.pts, hw: s.hw })), walls: d.walls.map(s => ({ pts: s.pts, hw: s.hw }))
    });

    return {
      id: d.id, name: d.name, players: n, size: [w, h],
      tag: `${n === 2 ? "1v1" : n < 5 ? `${n} hráči` : `${n} hráčů`}${w > 480 || h > 240 ? " · velká" : ""}`,
      description: d.description,
      slots, gold: d.gold, trees: d.trees, terrain, custom: true
    };
  }

  // Mapa se stejným id přepíše dřívější; seznam drží pořadí, v jakém mapy přibyly.
  function register(map) {
    const old = byId.get(map.id);
    if (old) list[list.indexOf(old)] = map;
    else list.push(map);
    byId.set(map.id, map);
    // pořadí: podle počtu hráčů, pak podle názvu
    list.sort((a, b) => a.players - b.players || String(a.name).localeCompare(String(b.name), "cs"));
  }

  function unregister(id) {
    const old = byId.get(id);
    if (!old) return false;
    list.splice(list.indexOf(old), 1);
    byId.delete(id);
    return true;
  }

  return {
    list,
    get: id => byId.get(id) || null,
    isWater, isRock, WALL_PAD, wallR, WALL_FACE, waterNear,
    DOC, normalizeDoc, compileDoc, zonesFor, baseAt, baseMinesFor, register, unregister,
    // první dostupná mapa (mapy se načítají ze serveru, napevno žádná není)
    get DEFAULT() { return list.length ? list[0].id : ""; }
  };
});
