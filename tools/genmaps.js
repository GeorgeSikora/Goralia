/*
 * Generátor map: vytvoří soubory maps/<id>.json (formát goralia-map) pro 2 až 16 hráčů.
 * Spuštění: node tools/genmaps.js   (přepíše mapy se stejným id; ostatní soubory v maps/ nechá být)
 * Mapy jsou potom obyčejné soubory jako ty z editoru: v editoru jdou upravit i smazat.
 *
 * Souřadnice: základny, doly a stromy jsou v logických jednotkách, voda, cesty, hory a hradby v art px (1 px = 2 jednotky).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const MAPS = require("../js/maps.js");
const CHECK = require("../js/mapcheck.js");

const OUT = path.join(__dirname, "..", "maps");

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

const r1 = v => Math.round(v * 10) / 10;

function distSeg(x, y, pts) {
  let best = Infinity;

  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
  }

  return best;
}

/* ---------- stavebnice mapy ---------- */
class Draft {
  constructor(id, name, description, W, H, seed) {
    this.id = id;
    this.name = name;
    this.description = description;
    this.W = W;
    this.H = H;
    this.seed = seed;
    this.rnd = mulberry(seed);
    this.bases = [];
    this.gold = [];
    this.water = [];
    this.roads = [];
    this.mountains = [];
    this.walls = [];
    this.trees = [];
    this.coop = null; // { ai: index základny nemrtvých }
  }

  // Základny lidí (pekelná pevnost nemrtvých netěží, nemá doly a nepotřebuje lesy).
  get humanBases() { return this.bases.filter((_, i) => !this.coop || i !== this.coop.ai); }
  get hellBase() { return this.coop ? this.bases[this.coop.ai] : null; }

  get LW() { return this.W * 2; }
  get LH() { return this.H * 2; }

  // Zalomí rovnou čáru, aby vypadala přirozeně (art px).
  wiggle(pts, amp, seg = 40) {
    const out = [pts[0]];

    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const n = Math.max(1, Math.round(len / seg));
      const nx = -(by - ay) / len;
      const ny = (bx - ax) / len;

      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const jitter = k < n ? (this.rnd() - 0.5) * 2 * amp : 0;
        out.push([r1(ax + (bx - ax) * t + nx * jitter), r1(ay + (by - ay) * t + ny * jitter)]);
      }
    }

    return out;
  }

  river(pts, hw, amp = 4) { this.water.push({ pts: this.wiggle(pts, amp, 45), hw }); }
  road(pts, w = 6, main = false, amp = 3) { this.roads.push({ pts: this.wiggle(pts, amp, 60), w, main }); }
  wall(pts, hw = 4) { this.walls.push({ pts: pts.map(p => [r1(p[0]), r1(p[1])]), hw }); }
  ridge(pts, hw, amp = 3) { this.mountains.push({ pts: this.wiggle(pts, amp, 30), hw }); }

  // Horský masiv: několik hřebenů z jednoho středu (art px).
  massif(cx, cy, radius, hw, arms = 3, rot = 0) {
    for (let i = 0; i < arms; i++) {
      const a = rot + (Math.PI * 2 * i) / arms + (this.rnd() - 0.5) * 0.5;
      const len = radius * (0.7 + this.rnd() * 0.5);
      this.ridge([[cx, cy], [cx + Math.cos(a) * len, cy + Math.sin(a) * len]], hw * (0.8 + this.rnd() * 0.4), 2);
    }
  }

  // Hradební obdélník s bránami tam, kudy vede cesta.
  compound(x0, y0, x1, y1) { this.wall([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]); }

  base(x, y) { this.bases.push({ x, y }); }

  // Základna v art px; vrací pozici plácku, odkud vedou cesty.
  get hqArt() { return this.bases.map(b => [b.x / 2, b.y / 2]); }

  rec() {
    return { rivers: this.water, roads: this.roads, mountains: this.mountains, walls: this.walls };
  }

  // Lze na tomto místě (logické souřadnice) stát? Odstup od vody, skal a cest.
  free(x, y, pad = 14) {
    const ax = x / 2;
    const ay = y / 2;
    const rec = this.rec();
    const around = [[0, 0], [pad, 0], [-pad, 0], [0, pad], [0, -pad]];

    if (around.some(([dx, dy]) => MAPS.isWater(rec, (x + dx) / 2, (y + dy) / 2) || MAPS.isRock(rec, (x + dx) / 2, (y + dy) / 2))) return false;
    for (const r of this.water) if (distSeg(ax, ay, r.pts) < r.hw + pad / 2 + 2) return false;
    for (const m of this.mountains) if (distSeg(ax, ay, m.pts) < m.hw + 3) return false;
    for (const w of this.walls) if (distSeg(ax, ay, w.pts) < w.hw + 6) return false;
    for (const rd of this.roads) if (distSeg(ax, ay, rd.pts) < rd.w + 3) return false;
    return true;
  }

  // Dva doly u každé základny přidá editor/hra sama (baseMinesFor); tady jsou jen doly navíc a stromy.
  allGold() {
    const out = [];
    for (const b of this.humanBases) out.push(...MAPS.baseMinesFor(b.x, b.y, this.LW, this.LH).map(([x, y]) => [x, y]));
    return [...out, ...this.gold];
  }

  scatterTrees(count, clusters = 0) {
    const { LW, LH, rnd } = this;
    const slots = this.bases.map(b => MAPS.baseAt(b.x, b.y, LW, LH, { x0: 0, y0: 0, x1: LW, y1: LH }));
    const gold = this.allGold();
    const out = [];

    const ok = (x, y) =>
      x >= 40 && x <= LW - 40 && y >= 90 && y <= LH - 50 &&
      slots.every(s => Math.hypot(x - s.hq.x, y - s.hq.y) > 160 && Math.hypot(x - s.plot.x, y - s.plot.y) > 120) &&
      gold.every(g => Math.hypot(x - g[0], y - g[1]) > 80) &&
      (!this.hellBase || Math.hypot(x - this.hellBase.x, y - this.hellBase.y) > (this.hellR || 700)) &&
      out.every(t => Math.hypot(x - t[0], y - t[1]) > 34) &&
      this.free(x, y, 12);

    const centers = [];
    const nClusters = clusters || Math.max(8, Math.round(count / 9));

    for (let i = 0; i < nClusters; i++) centers.push([60 + rnd() * (LW - 120), 100 + rnd() * (LH - 170)]);

    // lesíky za základnami (ne u pekelné pevnosti)
    for (const s of slots.filter((_, i) => !this.coop || i !== this.coop.ai)) {
      const fx = s.facing;
      const fy = s.plot.y > s.hq.y ? 1 : -1;
      centers.push([s.hq.x - fx * 150, s.hq.y - fy * 160], [s.hq.x + fx * 20, s.hq.y - fy * 230]);
    }

    let guard = 0;

    while (out.length < count && guard++ < count * 60) {
      const [cx, cy] = centers[Math.floor(rnd() * centers.length)];
      const a = rnd() * Math.PI * 2;
      const d = 15 + rnd() * 130;
      const x = Math.round(cx + Math.cos(a) * d);
      const y = Math.round(cy + Math.sin(a) * d);
      if (ok(x, y)) out.push([x, y]);
    }

    this.trees = out;
  }

  // Doly navíc (logické souřadnice); špatná místa se tiše přeskočí.
  extraGold(list) {
    for (const [x, y, amount] of list) {
      if (!this.free(x, y, 22)) continue;
      this.gold.push(amount ? [x, y, amount] : [x, y]);
    }
  }

  toDoc() {
    const gold = this.gold.map(g => g.slice());
    // doly u základen vytváří editor jako běžné doly v dokumentu
    const base = [];
    for (const b of this.humanBases) base.push(...MAPS.baseMinesFor(b.x, b.y, this.LW, this.LH).map(([x, y]) => [Math.round(x), Math.round(y)]));

    return {
      format: MAPS.DOC.FORMAT, version: MAPS.DOC.VERSION,
      id: this.id, name: this.name, description: this.description,
      size: [this.W, this.H], seed: this.seed, autoRoads: false,
      bases: this.bases.map(b => ({ x: Math.round(b.x), y: Math.round(b.y) })),
      gold: [...base, ...gold],
      trees: this.trees,
      water: this.water, roads: this.roads, mountains: this.mountains, walls: this.walls,
      ...(this.coop ? { coop: { ai: this.coop.ai } } : {})
    };
  }
}

/* ---------- společné pomůcky ---------- */
const mirrorX = (W, pts) => pts.map(([x, y]) => [W - x, y]);
const mirrorY = (H, pts) => pts.map(([x, y]) => [x, H - y]);

// Mřížka cols × rows; vrací pozice základen (logické souřadnice).
function grid(d, cols, rows, sx, sy) {
  const x0 = (d.LW - (cols - 1) * sx) / 2;
  const y0 = (d.LH - (rows - 1) * sy) / 2;
  const pos = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const b = { x: Math.round(x0 + c * sx), y: Math.round(y0 + r * sy) };
      d.base(b.x, b.y);
      pos.push({ c, r, ax: b.x / 2, ay: b.y / 2 });
    }
  }

  return pos;
}

// Hlavní cesty mezi sousedy v mřížce (vedou ze středu plácku základny).
function gridRoads(d, pos, cols, rows, w = 6) {
  const at = (c, r) => pos[r * cols + c];
  const plaza = p => [p.ax, p.ay + (p.ay * 2 <= d.LH / 2 + 1 ? 17 : -17)];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = at(c, r);
      const pa = plaza(a);
      if (c + 1 < cols) {
        const b = at(c + 1, r);
        const pb = plaza(b);
        d.road([pa, [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2], pb], w, true);
      }
      if (r + 1 < rows) {
        const b = at(c, r + 1);
        d.road([[a.ax, a.ay + 20], [(a.ax + b.ax) / 2, (a.ay + b.ay) / 2], [b.ax, b.ay - 20]], w, true);
      }
    }
  }
}

/* ---------- mapy ---------- */
const makers = [];

// 2 hráči
makers.push(() => {
  const d = new Draft("valley", "Údolí potoka", "Klidné údolí rozdělené potokem. Dva brody, hory v rozích a dva doly u každé základny. Rychlý souboj dvou hráčů.", 760, 420, 101);
  d.base(300, 420);
  d.base(1220, 420);
  d.river([[380, 0], [374, 70], [384, 140], [378, 210], [386, 280], [376, 350], [382, 420]], 7, 3);
  d.road([[150, 227], [250, 224], [380, 218], [510, 224], [610, 227]], 8, true);
  d.road([[190, 110], [290, 108], [380, 104], [470, 108], [570, 110]], 5);
  d.road([[190, 325], [290, 328], [380, 332], [470, 328], [570, 325]], 5);
  for (const ridge of [[[30, 50], [100, 38], [170, 52]], [[30, 372], [100, 384], [170, 370]], [[310, 30], [345, 20]]]) {
    d.ridge(ridge, 11);
    d.ridge(mirrorX(760, ridge), 11);
  }
  d.extraGold([[680, 260], [840, 580]]);
  d.scatterTrees(260);
  return d;
});

makers.push(() => {
  const d = new Draft("pass", "Horský průsmyk", "Pohoří dělí mapu napůl. Jen dva hradbami uzavřené průsmyky s branami vedou na druhou stranu.", 900, 500, 202);
  d.base(330, 500);
  d.base(1470, 500);
  for (const seg of [[[450, 15], [452, 110]], [[450, 205], [448, 290]], [[450, 385], [452, 485]]]) d.ridge(seg, 22, 1.5);
  d.wall([[450, 118], [450, 197]]);
  d.wall([[450, 298], [450, 377]]);
  d.road([[165, 267], [240, 240], [300, 200], [400, 157], [500, 157], [600, 200], [660, 240], [735, 267]], 7, true);
  d.road([[165, 233], [240, 260], [300, 300], [400, 343], [500, 343], [600, 300], [660, 260], [735, 233]], 7, true);
  for (const ridge of [[[40, 60], [110, 45], [190, 70]], [[40, 440], [110, 455], [190, 430]]]) {
    d.ridge(ridge, 12);
    d.ridge(mirrorX(900, ridge), 12);
  }
  d.extraGold([[790, 330], [1010, 670]]);
  d.scatterTrees(240);
  return d;
});

// 3 hráči
makers.push(() => {
  const d = new Draft("highland", "Pustá vysočina", "Tři království kolem hlubokého masivu. Cesty vedou kolem hor, na západě a východě stojí skalní hřebeny.", 1100, 700, 303);
  d.base(420, 400);
  d.base(1780, 400);
  d.base(1100, 1010);
  d.massif(550, 255, 90, 26, 4, 0.4);
  d.river([[550, 0], [545, 90], [552, 170]], 6, 3);
  d.road([[210, 217], [300, 160], [430, 118], [550, 108], [670, 118], [800, 160], [890, 217]], 7, true);
  d.road([[210, 217], [260, 330], [370, 440], [480, 492], [550, 508]], 7, true);
  d.road([[890, 217], [840, 330], [730, 440], [620, 492], [550, 508]], 7, true);
  for (const ridge of [[[40, 300], [60, 420], [50, 520]], [[100, 640], [250, 650]]]) {
    d.ridge(ridge, 14);
    d.ridge(mirrorX(1100, ridge), 14);
  }
  d.extraGold([[1100, 790], [640, 880], [1560, 880]]);
  d.scatterTrees(330);
  return d;
});

// 4 hráči
makers.push(() => {
  const d = new Draft("crowns", "Čtyři koruny", "Čtyři království v rozích a řeka ve tvaru kříže. Přes brody se přechází jen po cestách, kolem stojí horské hřebeny.", 1100, 760, 404);
  d.base(420, 400);
  d.base(1780, 400);
  d.base(420, 1120);
  d.base(1780, 1120);
  const W = 1100;
  const H = 760;
  d.river([[550, 0], [545, 150], [556, 300], [548, 460], [552, 620], [550, 760]], 8, 3);
  d.river([[0, 380], [150, 376], [300, 384], [430, 378], [550, 380], [670, 384], [800, 376], [950, 382], [1100, 380]], 8, 3);
  d.road([[210, 217], [330, 190], [550, 185], [770, 190], [890, 217]], 7, true);
  d.road([[210, 543], [330, 570], [550, 575], [770, 570], [890, 543]], 7, true);
  d.road([[210, 217], [190, 300], [200, 380], [190, 460], [210, 543]], 7, true);
  d.road([[890, 217], [910, 300], [900, 380], [910, 460], [890, 543]], 7, true);
  d.road([[210, 217], [380, 300], [550, 380], [720, 460], [890, 543]], 5);
  d.road([[890, 217], [720, 300], [550, 380], [380, 460], [210, 543]], 5);
  for (const ridge of [[[430, 40], [550, 28], [670, 40]], [[30, 300], [22, 380], [30, 460]], [[400, 270], [455, 305]], [[430, 480], [470, 520]]]) {
    d.ridge(ridge, 12);
    d.ridge(mirrorX(W, ridge), 12);
    d.ridge(mirrorY(H, ridge), 12);
    d.ridge(mirrorY(H, mirrorX(W, ridge)), 12);
  }
  d.extraGold([[850, 600], [1350, 600], [850, 920], [1350, 920]]);
  d.scatterTrees(380);
  return d;
});

makers.push(() => {
  const d = new Draft("fortress", "Hradby", "Čtyři opevněné tvrze. Každou obklopuje hradba a dovnitř se vchází jen branami na cestách; uprostřed stojí horský masiv.", 1200, 800, 505);
  d.base(500, 420);
  d.base(1900, 420);
  d.base(500, 1180);
  d.base(1900, 1180);
  const W = 1200;
  const H = 800;
  const box = (cx, cy, fxs, fys) => {
    const x0 = fxs > 0 ? cx - 175 : cx - 205;
    const x1 = fxs > 0 ? cx + 205 : cx + 175;
    const y0 = fys > 0 ? cy - 125 : cy - 155;
    const y1 = fys > 0 ? cy + 155 : cy + 125;
    d.compound(x0, y0, x1, y1);
  };
  box(250, 210, 1, 1);
  box(950, 210, -1, 1);
  box(250, 590, 1, -1);
  box(950, 590, -1, -1);
  d.massif(600, 400, 80, 24, 4, 0.3);
  d.road([[250, 227], [450, 235], [600, 228], [750, 235], [950, 227]], 8, true);
  d.road([[250, 573], [450, 565], [600, 572], [750, 565], [950, 573]], 8, true);
  d.road([[250, 227], [244, 330], [252, 420], [244, 480], [250, 573]], 8, true);
  d.road([[950, 227], [956, 330], [948, 420], [956, 480], [950, 573]], 8, true);
  for (const ridge of [[[420, 40], [600, 28], [780, 40]], [[30, 330], [22, 400], [30, 470]]]) {
    d.ridge(ridge, 12);
    d.ridge(mirrorY(H, ridge), 12);
    d.ridge(mirrorX(W, ridge), 12);
    d.ridge(mirrorY(H, mirrorX(W, ridge)), 12);
  }
  d.extraGold([[900, 560], [1500, 560], [900, 1040], [1500, 1040]]);
  d.scatterTrees(330);
  return d;
});

// 6 hráčů
makers.push(() => {
  const d = new Draft("six", "Šest říší", "Šest království na rozlehlé pláni, rozdělené dvěma řekami. Brody jsou jen na cestách; uprostřed se zvedá horský masiv.", 1500, 900, 606);
  const pos = grid(d, 3, 2, 1000, 900);
  d.river([[500, 0], [494, 150], [506, 300], [498, 450], [504, 600], [496, 750], [500, 900]], 8, 3);
  d.river([[1000, 0], [1006, 150], [994, 300], [1002, 450], [996, 600], [1004, 750], [1000, 900]], 8, 3);
  gridRoads(d, pos, 3, 2, 7);
  d.massif(750, 450, 60, 20, 3, 0.8);
  for (const ridge of [[[120, 440], [100, 470]], [[1380, 440], [1400, 470]], [[300, 60], [420, 50]], [[1080, 50], [1200, 60]], [[300, 850], [420, 860]], [[1080, 860], [1200, 850]]]) d.ridge(ridge, 13);
  d.extraGold([[1250, 900], [1750, 900], [1500, 140], [1500, 1660]]);
  d.scatterTrees(520);
  return d;
});

// 8 hráčů
makers.push(() => {
  const d = new Draft("eight", "Osm království", "Osm království ve dvou řadách. Uprostřed řeka s brody a na křižovatkách mezi základnami hory.", 1800, 900, 808);
  const pos = grid(d, 4, 2, 900, 900);
  d.river([[900, 0], [894, 150], [906, 300], [898, 450], [904, 600], [896, 750], [900, 900]], 8, 3);
  gridRoads(d, pos, 4, 2, 7);
  d.massif(450, 450, 70, 20, 3, 0.5);
  d.massif(1350, 450, 70, 20, 3, 2.1);
  d.massif(900, 450, 40, 16, 3, 1.1);
  for (const ridge of [[[300, 60], [430, 50]], [[1370, 50], [1500, 60]], [[300, 850], [430, 860]], [[1370, 860], [1500, 850]], [[40, 400], [30, 500]], [[1760, 400], [1770, 500]]]) d.ridge(ridge, 13);
  d.extraGold([[1350, 900], [2250, 900], [900, 400], [2700, 1400]]);
  d.scatterTrees(560);
  return d;
});

// 10 hráčů
makers.push(() => {
  const d = new Draft("ten", "Deset říší", "Deset království v pásu dvou řad, mezi nimiž teče dlouhá řeka. Přechody jsou jen brody na cestách.", 2250, 900, 1010);
  const pos = grid(d, 5, 2, 900, 900);
  d.river([[0, 450], [200, 442], [450, 458], [700, 446], [950, 454], [1200, 444], [1450, 456], [1700, 446], [1950, 454], [2250, 450]], 8, 3);
  gridRoads(d, pos, 5, 2, 7);
  for (let i = 0; i < 4; i++) {
    d.massif(450 + i * 450, 250, 40, 14, 2, i);
    d.massif(450 + i * 450, 650, 40, 14, 2, i + 2);
  }
  for (const ridge of [[[40, 400], [30, 500]], [[2210, 400], [2220, 500]]]) d.ridge(ridge, 14);
  d.extraGold([[1350, 900], [2250, 900], [3150, 900], [4050, 900]]);
  d.scatterTrees(650);
  return d;
});

// 12 hráčů
makers.push(() => {
  const d = new Draft("twelve", "Dvanáct pevností", "Dvanáct opevněných království. Hradby mají brány jen na cestách, uprostřed stojí hory.", 1800, 1350, 1212);
  const pos = grid(d, 4, 3, 900, 900);
  gridRoads(d, pos, 4, 3, 7);

  for (const p of pos) {
    const left = p.ax * 2 <= d.LW / 2;
    const top = p.ay * 2 <= d.LH / 2;
    d.compound(left ? p.ax - 175 : p.ax - 205, top ? p.ay - 125 : p.ay - 155, left ? p.ax + 205 : p.ax + 175, top ? p.ay + 155 : p.ay + 125);
  }

  d.massif(900, 675, 80, 22, 4, 0.2);
  d.massif(450, 450, 25, 12, 2, 1);
  d.massif(1350, 900, 25, 12, 2, 2);
  for (const ridge of [[[40, 600], [30, 750]], [[1760, 600], [1770, 750]]]) d.ridge(ridge, 14);
  d.extraGold([[1350, 900], [2250, 900], [1350, 1800], [2250, 1800]]);
  d.scatterTrees(600);
  return d;
});

// 16 hráčů
makers.push(() => {
  const d = new Draft("sixteen", "Velká válka", "Šestnáct království v mřížce 4×4. Dvě křížící se řeky, brody na cestách a horské masivy mezi základnami.", 1600, 1600, 1616);
  const pos = grid(d, 4, 4, 800, 800);
  d.river([[800, 0], [794, 200], [806, 400], [798, 600], [804, 800], [796, 1000], [802, 1200], [798, 1400], [800, 1600]], 8, 3);
  d.river([[0, 800], [200, 794], [400, 806], [600, 798], [800, 804], [1000, 796], [1200, 802], [1400, 798], [1600, 800]], 8, 3);
  gridRoads(d, pos, 4, 4, 7);

  for (const [x, y, rot] of [[400, 400, 0.4], [1200, 400, 1.3], [400, 1200, 2.2], [1200, 1200, 3.1], [800, 800, 0.9]]) d.massif(x, y, 60, 18, 3, rot);

  for (const ridge of [[[40, 350], [30, 450]], [[1560, 350], [1570, 450]], [[350, 40], [450, 30]], [[1150, 40], [1250, 30]], [[350, 1560], [450, 1570]], [[1150, 1560], [1250, 1570]]]) d.ridge(ridge, 14);
  d.extraGold([[1200, 800], [2000, 800], [800, 1600], [2400, 1600], [1600, 1200], [1600, 2000]]);
  d.scatterTrees(700);
  return d;
});

// 5 hráčů: protáhlá hvězdicová pevnost s citadelou (podle dobového půdorysu) a čtyři útočníci v rozích
makers.push(() => {
  const d = new Draft("sance", "Pevnost Šance", "Protáhlá hradební hvězda s příkopem a malou citadelou na západní straně. Obránce sídlí na nádvoří, ze čtyř rohů mapy ji obléhají útočníci.", 1400, 1000, 505);
  const cx = 700;
  const cy = 500;
  const bx = cx + 135;
  d.base(bx * 2, cy * 2);
  for (const [x, y] of [[480, 400], [2320, 400], [480, 1600], [2320, 1600]]) d.base(x, y);

  const STRETCH = 1.45;
  const makeStar = (ox, oy, tips, Ro, Ri, sx, rot = 0) => {
    const pts = [];
    for (let k = 0; k < tips; k++) {
      const a = rot + (k * 2 * Math.PI) / tips;
      const a2 = a + Math.PI / tips;
      pts.push([ox + Math.cos(a) * Ro * sx, oy + Math.sin(a) * Ro], [ox + Math.cos(a2) * Ri * sx, oy + Math.sin(a2) * Ri]);
    }
    pts.push(pts[0]);
    return pts.map(([x, y]) => [r1(x), r1(y)]);
  };

  // průsečík lomené čáry se svislou (x = c) nebo vodorovnou (y = c) přímkou; vrací body setříděné podle druhé souřadnice
  const cross = (poly, axis, c) => {
    const out = [];
    for (let i = 0; i < poly.length - 1; i++) {
      const [ax, ay] = poly[i];
      const [bx2, by2] = poly[i + 1];
      const p = axis === "x" ? ax : ay;
      const q = axis === "x" ? bx2 : by2;
      if ((p - c) * (q - c) >= 0) continue;
      const t = (c - p) / (q - p);
      out.push([ax + (bx2 - ax) * t, ay + (by2 - ay) * t]);
    }
    return out;
  };

  const main = makeStar(cx, cy, 8, 285, 205, STRETCH, Math.PI / 8);
  d.wall(main, 4);
  d.water.push({ pts: main.map(([x, y]) => [r1(cx + (x - cx) * 1.09), r1(cy + (y - cy) * 1.1)]), hw: 5 });

  // citadela: menší hvězda v západní části
  const kx = cx - 215;
  const keep = makeStar(kx, cy, 6, 92, 62, 1.2, Math.PI / 6);
  d.wall(keep, 4);

  // brány hlavní hradby: sever a jih, vpravo od citadely
  const gx = cx + 95;
  const hits = cross(main, "x", gx).sort((p, q) => p[1] - q[1]);
  const gN = hits[0];
  const gS = hits[hits.length - 1];
  const outN = [gx + 5, gN[1] - 110];
  const outS = [gx + 5, gS[1] + 110];
  const plaza = [bx, cy + 17];

  d.road([plaza, [gx + 6, cy - 80], gN, outN], 7, true, 1.5);
  d.road([plaza, [gx + 6, cy + 90], gS, outS], 7, true, 1.5);

  // brána citadely na východní straně
  const kh = cross(keep, "y", cy + 4).sort((p, q) => q[0] - p[0])[0];
  d.road([plaza, [(plaza[0] + kh[0]) / 2, cy + 8], kh, [kx + 10, cy + 4]], 6, true, 1);

  // venku: okružní silnice útočníků (severní a jižní větev přes brány, boční větve bez bran)
  const pl = (x, y) => [x / 2, y / 2 + (y > 1000 ? -17 : 17)];
  const nw = pl(480, 400);
  const ne = pl(2320, 400);
  const sw = pl(480, 1600);
  const se = pl(2320, 1600);
  d.road([nw, [(nw[0] + outN[0]) / 2, nw[1] - 25], outN, [(ne[0] + outN[0]) / 2, ne[1] - 25], ne], 7, true);
  d.road([sw, [(sw[0] + outS[0]) / 2, sw[1] + 25], outS, [(se[0] + outS[0]) / 2, se[1] + 25], se], 7, true);
  d.road([nw, [nw[0] - 30, 340], [sw[0] - 30, 660], sw], 7, true);
  d.road([ne, [ne[0] + 30, 340], [se[0] + 30, 660], se], 7, true);

  // předsunuté hrady před branami
  for (const [g, dir] of [[gN, -1], [gS, 1]]) {
    d.ridge([[g[0] - 40, g[1] + dir * 75], [g[0] - 14, g[1] + dir * 62]], 7, 1);
    d.ridge([[g[0] + 44, g[1] + dir * 75], [g[0] + 18, g[1] + dir * 62]], 7, 1);
  }

  for (const ridge of [[[40, 60], [120, 40], [200, 80]], [[1360, 60], [1280, 40], [1200, 80]], [[40, 940], [120, 960], [200, 920]], [[1360, 940], [1280, 960], [1200, 920]]]) d.ridge(ridge, 12);
  // doly: dva v citadele jako odměna za dobytí, ostatní venku
  d.extraGold([[kx * 2 - 40, cy * 2 - 70], [kx * 2 - 40, cy * 2 + 70], [1400, 150], [1400, 1850], [160, 1000], [2640, 1000], [1000, 330], [1800, 330], [1000, 1670], [1800, 1670]]);
  d.scatterTrees(420);
  return d;
});

// Kooperace: 3 hráči v jednom týmu proti AI nemrtvým z pekla
makers.push(() => {
  const d = new Draft("brana-pekel", "Brána pekel",
    "Kooperace: tři hráči v jednom týmu proti nemrtvým z pekla. Na severu za horami se rozpíná spálená pevnost s Nekropolí, " +
    "která v sílících vlnách posílá ghúly, kostlivce, zrůdy a přízraky. Zničte Nekropoli, než padnou vaše základny.",
    1500, 1000, 666);
  d.base(480, 1560);
  d.base(1500, 400);
  d.base(1500, 1640);
  d.base(2520, 1560);
  d.coop = { ai: 1 };
  d.hellR = 1050;

  // horský val mezi peklem a krajem živých se třemi průsmyky
  d.ridge([[12, 520], [150, 512], [300, 506]], 24, 2);
  d.ridge([[392, 500], [540, 510], [702, 506]], 24, 2);
  d.ridge([[800, 506], [960, 510], [1108, 500]], 24, 2);
  d.ridge([[1200, 506], [1350, 512], [1488, 520]], 24, 2);
  // skalní zuby v pekle a hřebeny na okrajích
  d.massif(300, 200, 70, 18, 3, 0.3);
  d.massif(1200, 200, 70, 18, 3, 2.1);
  for (const ridge of [[[30, 640], [40, 760], [30, 900]], [[1470, 640], [1460, 760], [1470, 900]]]) d.ridge(ridge, 13);

  // cesty: z každé základny průsmykem k Nekropoli a po kraji mezi základnami
  const hell = [750, 217];
  const homes = [[240, 763], [750, 803], [1260, 763]];
  const passes = [[346, 503], [751, 508], [1154, 503]];
  homes.forEach((h, i) => {
    const p = passes[i];
    d.road([h, [(h[0] + p[0]) / 2, (h[1] + p[1]) / 2 + 40], p, [(p[0] + hell[0]) / 2, (p[1] + hell[1]) / 2 + 30], hell], 7, true, 3);
  });
  d.road([homes[0], [490, 820], homes[1], [1010, 820], homes[2]], 6, true, 3);

  d.extraGold([[1000, 1300], [2000, 1300], [300, 1250], [2700, 1250], [1500, 1180]]);
  d.scatterTrees(380);
  return d;
});

/* ---------- zápis a kontrola ---------- */
// Stavebnici map používá i generátor map kampaně (tools/campaign-maps.js).
module.exports = { Draft, mulberry, distSeg };
if (require.main !== module) return;

fs.mkdirSync(OUT, { recursive: true });
let bad = 0;

for (const make of makers) {
  const d = make();
  const raw = d.toDoc();
  const { doc, errors } = MAPS.normalizeDoc(raw);

  if (!doc) {
    console.log(`✗ ${d.id}: ${errors.join(" | ")}`);
    bad++;
    continue;
  }

  const map = MAPS.compileDoc(doc);
  const problems = CHECK.check(map);

  if (problems.length) {
    console.log(`✗ ${d.id}: ${problems.join(" | ")}`);
    bad++;
    continue;
  }

  fs.writeFileSync(path.join(OUT, `${doc.id}.json`), JSON.stringify(doc));
  console.log(`✓ ${doc.id.padEnd(9)} ${String(map.players).padStart(2)} hráčů  ${d.W}×${d.H}  doly ${doc.gold.length}  stromy ${doc.trees.length}  hory ${doc.mountains.length}  hradby ${doc.walls.length}`);
}

process.exit(bad ? 1 : 0);
