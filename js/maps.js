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

  /* ---------- voda (společné pro vykreslení i průchodnost) ---------- */
  // Původní potok z Údolí potoka: [y, x] v art px.
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
      if (r.legacy) {
        if (Math.abs(ax - brookX(ay)) < brookHW(ay) - 1) water = true;
      } else if (distToPolyline(ax, ay, r.pts) < r.hw - 1) {
        water = true;
      }
    }

    if (!water) return false;

    for (const road of rec.roads) {
      if (distToPolyline(ax, ay, road.pts) < road.w * (road.main ? 0.8 : 0.5)) return false;
    }

    return true;
  }

  // Logické souřadnice, s malým odstupem (stromy a budovy nestojí na břehu).
  const waterNear = (rec, x, y, r = 12) =>
    [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].some(([dx, dy]) => isWater(rec, (x + dx) / 2, (y + dy) / 2));

  /* ---------- základny ---------- */
  // fx/fy jsou směry ke středu mapy (+1 nebo -1), podle nich se zrcadlí rozestavění kolem radnice.
  function base(slotIndex, x, y, fx, fy, zone) {
    const type = slotIndex === 1 ? "citadel" : "hall";

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

  function genTrees(seed, LW, LH, slots, mines, clusters, perCluster, blocked = () => false) {
    const r = mulberry(seed);
    const out = [];

    const ok = (x, y) =>
      x >= 30 && x <= LW - 30 && y >= 64 && y <= LH - 30 &&
      !blocked(x, y) &&
      slots.every(s =>
        Math.hypot(x - s.hq.x, y - s.hq.y) > 150 &&
        Math.hypot(x - s.buildings[0].x, y - s.buildings[0].y) > 110) &&
      mines.every(m => Math.hypot(x - m[0], y - m[1]) > 70) &&
      out.every(t => Math.hypot(x - t[0], y - t[1]) > 30);

    const centers = [];

    for (const s of slots) {
      const fx = s.facing;
      const fy = s.buildings[0].y > s.hq.y ? 1 : -1;
      centers.push([s.hq.x + fx * 30, s.hq.y - fy * 200], [s.hq.x + fx * 30, s.hq.y + fy * 230]);
    }

    for (let i = 0; i < clusters; i++) centers.push([60 + r() * (LW - 120), 90 + r() * (LH - 150)]);

    for (const [cx, cy] of centers) {
      for (let k = 0, placed = 0; k < 60 && placed < perCluster; k++) {
        const a = r() * Math.PI * 2;
        const d = 20 + r() * 120;
        const x = Math.round(Math.min(LW - 30, Math.max(30, cx + Math.cos(a) * d)));
        const y = Math.round(Math.min(LH - 30, Math.max(64, cy + Math.sin(a) * d)));

        if (ok(x, y)) {
          out.push([x, y]);
          placed++;
        }
      }
    }

    return out;
  }

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
  function autoTerrain(seed, W, H, slots, rivers, extraAsh) {
    const r = mulberry(seed);
    const center = [W / 2, H / 2];
    const area = W * H / (480 * 240);
    const plazas = [];
    const terraces = [];
    const roads = [];
    const pave = [];
    const ashCircles = [...(extraAsh || [])];
    const landmarks = [["ringstone", center[0] - 45, center[1] - 40, true, 22]];

    for (const s of slots) {
      const ax = s.hq.x / 2;
      const ay = s.hq.y / 2;
      const bx = s.buildings[0].x / 2;
      const by = s.buildings[0].y / 2;
      const fx = s.facing;
      const fy = s.buildings[0].y > s.hq.y ? 1 : -1;

      if (s.hq.type === "citadel") {
        terraces.push({ x0: ax - 45, y0: ay - 5, x1: ax + 45, y1: ay + 29, lip: 4, cx: ax });
        ashCircles.push([ax, ay, 110]);

        for (const [dx, dy, name] of [[-29, -3, "brazier"], [-29, 31, "brazier"], [-53, -17, "skullStake"], [-51, 45, "skullStake"]]) {
          landmarks.push([name, ax + dx * -fx, ay + dy * fy, true, 5]);
        }
      } else {
        plazas.push({ x: ax, y: ay + 17 * fy, rx: 34, ry: 17, kind: "hall" });
        landmarks.push(["campfire", ax - fx * 28, ay + fy * 49, true, 9], ["crates", ax - fx * 42, ay + fy * 31, true, 9]);
      }

      plazas.push({ x: bx, y: by + 19 * fy, rx: 23, ry: 11, kind: "yard" });
      pave.push([ax, ay + 17 * fy, 52]);
      roads.push({ w: 7, main: true, pts: roadTo([ax, ay + 17 * fy], center, (r() - 0.5) * 50) });
      roads.push({ w: 4.5, pts: [[bx, by + 12 * fy], [(bx + ax) / 2, ay + 20 * fy], [ax + fx * 24, ay + 19 * fy]] });
      landmarks.push(["lanternPost", ax + fx * 44, ay + 34 * fy, true, 5], ["lanternPost", ax + fx * 90, ay + 40 * fy, true, 5]);
    }

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
      ash: { circles: ashCircles }, cracks,
      doodads: { landmarks, scatter },
      tufts: { x: 12, y: 22, w: W - 24, h: H - 35, n: Math.round(240 * area * 1.4), tries: Math.round(900 * area * 1.4) },
      mist, seed
    };
  }

  /* ---------- mapa 1: Údolí potoka (původní 1v1) ---------- */
  const valleySlots = [
    {
      hq: { type: "hall", x: 120, y: 238 },
      buildings: [{ type: "barracks", x: 191, y: 354 }],
      units: [
        { type: "worker", x: 173, y: 194 }, { type: "worker", x: 164, y: 266 },
        { type: "soldier", x: 259, y: 234 }, { type: "soldier", x: 280, y: 255 }
      ],
      zone: { x0: 45, y0: 85, x1: 480, y1: 435 },
      facing: 1,
      spawn: [58, 29]
    },
    {
      hq: { type: "citadel", x: 850, y: 234 },
      buildings: [{ type: "barracks", x: 769, y: 354 }],
      units: [
        { type: "worker", x: 787, y: 194 }, { type: "worker", x: 796, y: 266 },
        { type: "soldier", x: 701, y: 234 }, { type: "soldier", x: 680, y: 255 }
      ],
      zone: { x0: 480, y0: 85, x1: 915, y1: 435 },
      facing: -1,
      spawn: [-58, 29]
    }
  ];

  const valley = {
    id: "valley",
    name: "Údolí potoka",
    players: 2,
    size: [480, 240],
    tag: "1v1",
    description:
      "Klidné údolí rozdělené potokem. Modré království sídlí na zelené straně, " +
      "Rudá pevnost na popelavé vyvýšenině. Každý má dva doly a hustý les za zády. " +
      "Rychlá mapa pro souboj dvou hráčů, celá se vejde na obrazovku.",
    slots: valleySlots,
    gold: [[320, 112], [390, 394], [640, 112], [570, 394]],
    trees: [
      [29, 69], [64, 53], [102, 70], [143, 48], [192, 78], [232, 54],
      [32, 382], [66, 427], [113, 404], [164, 430], [249, 416],
      [434, 69], [466, 98], [502, 55],
      [520, 397], [560, 425], [599, 394], [631, 423],
      [706, 67], [754, 88], [919, 80], [920, 373], [890, 421], [737, 414],
      [812, 58], [868, 96], [828, 428], [864, 392], [935, 410]
    ],
    terrain: {
      rivers: [{ legacy: true }],
      roads: [
        { w: 9, main: true, pts: [[40, 148], [80, 138], [115, 132], [170, 128], [230, 127], [290, 129], [340, 129], [366, 129], [376, 138], [384, 152], [400, 160], [425, 161]] },
        { w: 4.5, pts: [[95, 200], [98, 172], [106, 150], [114, 135]] },
        { w: 4, pts: [[160, 74], [163, 96], [168, 116], [172, 128]] },
        { w: 4, pts: [[195, 208], [196, 182], [198, 152], [200, 130]] }
      ],
      plazas: [
        { x: 60, y: 136, rx: 34, ry: 17, kind: "hall" },
        { x: 95, y: 196, rx: 23, ry: 11, kind: "yard" }
      ],
      terraces: [{ x0: 380, y0: 112, x1: 470, y1: 146, lip: 4, cx: 425 }],
      pave: [],
      paveX: [[0, 105], [336, 480]],
      ash: { edge: [335, 402], circles: [] },
      cracks: [{ x: 392, y: 22, w: 82, h: 208, n: 46 }],
      doodads: {
        landmarks: [
          ["ringstone", 292, 80, true, 22],
          ["column", 340, 111, true, 5],
          ["column", 340, 149, true, 5],
          ["columnFallen", 322, 153, true, 9],
          ["stoneA", 349, 146, true, 6],
          ["campfire", 32, 168, true, 9],
          ["stump", 18, 172, true, 6],
          ["stump", 47, 174, true, 6],
          ["crates", 18, 150, true, 9],
          ["signpost", 246, 112, true, 5],
          ...[[100, 118], [158, 142], [214, 113], [270, 143], [326, 115], [66, 160], [134, 150]].map(([x, y]) => ["lanternPost", x, y, true, 5]),
          ...[[396, 114], [396, 148], [372, 100], [374, 162]].map(([x, y]) => [y > 110 && y < 150 ? "brazier" : "skullStake", x, y, true, 5])
        ],
        scatter: [
          ["crystalCyan", 3, 14, 340, 40, 220, 14],
          ["crystalViolet", 3, 14, 340, 40, 220, 14],
          ["monolith", 4, 180, 340, 40, 220, 7],
          ["shroomGlow", 9, 14, 345, 30, 228, 7],
          ["shroomRed", 7, 14, 345, 30, 228, 6],
          ["stoneA", 5, 14, 345, 30, 228, 8],
          ["stoneB", 9, 14, 470, 30, 228, 5],
          ["fern", 16, 14, 345, 30, 228, 6],
          ["stump", 2, 100, 345, 40, 220, 6],
          ["columnFallen", 1, 200, 345, 40, 220, 9],
          ["deadTree", 7, 400, 466, 26, 226, 11],
          ["ribs", 1, 396, 466, 160, 226, 11],
          ["skullStake", 4, 396, 466, 26, 226, 5]
        ]
      },
      tufts: { x: 12, y: 22, w: 340, h: 205, n: 240, tries: 900 },
      mist: [[372, 60, 6], [380, 160, 5], [150, 205, 3.5], [250, 22, 4]],
      seed: 2024
    }
  };

  /* ---------- mapa 2: Čtyři koruny (4 hráči) ---------- */
  const crownsSlots = [
    base(0, 220, 260, 1, 1, { x0: 45, y0: 85, x1: 705, y1: 545 }),
    base(1, 1220, 260, -1, 1, { x0: 735, y0: 85, x1: 1395, y1: 545 }),
    base(2, 220, 860, 1, -1, { x0: 45, y0: 575, x1: 705, y1: 1075 }),
    base(3, 1220, 860, -1, -1, { x0: 735, y0: 575, x1: 1395, y1: 1075 })
  ];

  const crownsMines = [
    ...crownsSlots.flatMap(s => baseMines(s, s.facing, s.buildings[0].y > s.hq.y ? 1 : -1)),
    [640, 560, 4000], [800, 560, 4000]
  ];

  const crownsTerrain = autoTerrain(
    301, 720, 560, crownsSlots,
    [{ pts: [[358, 0], [370, 90], [352, 190], [366, 280], [354, 370], [368, 470], [360, 560]], hw: 5.5 }]
  );

  const crowns = {
    id: "crowns",
    name: "Čtyři koruny",
    players: 4,
    size: [720, 560],
    tag: "4 hráči",
    description:
      "Čtyři království v rozích mapy a široká řeka uprostřed. Přes brody se dá projít jen po cestách, " +
      "o dva neutrální doly u středu se pere každý. Každá základna má dva vlastní doly a les za zády. " +
      "Střední mapa, na menších obrazovkách se kamera posouvá.",
    slots: crownsSlots,
    gold: crownsMines,
    trees: genTrees(501, 1440, 1120, crownsSlots, crownsMines, 8, 7, (x, y) => waterNear(crownsTerrain, x, y)),
    terrain: crownsTerrain
  };

  /* ---------- mapa 3: Pustá vysočina (3 hráči, velká) ---------- */
  const highlandSlots = [
    base(0, 300, 360, 1, 1, { x0: 45, y0: 85, x1: 900, y1: 640 }),
    base(1, 1620, 360, -1, 1, { x0: 1020, y0: 85, x1: 1875, y1: 640 }),
    base(2, 960, 860, 1, -1, { x0: 400, y0: 700, x1: 1520, y1: 1075 })
  ];

  const highlandMines = [
    ...highlandSlots.flatMap(s => baseMines(s, s.facing, s.buildings[0].y > s.hq.y ? 1 : -1)),
    [960, 330, 4000], [620, 800, 4000], [1300, 800, 4000], [960, 560, 4000]
  ];

  const highlandTerrain = autoTerrain(
    611, 960, 560, highlandSlots,
    [{ pts: [[0, 318], [160, 326], [320, 310], [480, 322], [640, 312], [800, 324], [960, 316]], hw: 6 }],
    [[850, 470, 90]]
  );

  const highland = {
    id: "highland",
    name: "Pustá vysočina",
    players: 3,
    size: [960, 560],
    tag: "3 hráči · velká",
    description:
      "Rozlehlá vysočina pro tři soupeře. Dvě základny na severu, třetí uprostřed jihu, " +
      "mezi nimi vede kamenitý brod přes dlouhý potok. Mnoho neutrálních dolů láká k expanzi, " +
      "ale armády mají daleko. Velká mapa: kameru posouvej šipkami, myší u okraje nebo minimapou.",
    slots: highlandSlots,
    gold: highlandMines,
    trees: genTrees(907, 1920, 1120, highlandSlots, highlandMines, 14, 8, (x, y) => waterNear(highlandTerrain, x, y)),
    terrain: highlandTerrain
  };

  const list = [valley, crowns, highland];
  const byId = new Map(list.map(m => [m.id, m]));

  return {
    list,
    get: id => byId.get(id) || null,
    isWater, waterNear, brookX, brookHW,
    DEFAULT: "valley"
  };
});
