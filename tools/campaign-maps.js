/*
 * Mapy kampaně "Stín Morvanův": vygeneruje js/campaign-maps.js (PK.campaignMaps).
 * Spuštění: node tools/campaign-maps.js
 * Mapy kampaně nejsou v seznamu map pro hru proti AI ani pro multiplayer, hra je sestaví až při startu kapitoly.
 *
 * Souřadnice jako v tools/genmaps.js: základny, doly a stromy logicky, voda, cesty, hory a hradby v art px.
 * Voda musí působit věrohodně: potok končí uvnitř jezera (žádný odskok na spoji) a nic nestojí ve vodě.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const MAPS = require("../js/maps.js");
const CHECK = require("../js/mapcheck.js");
const { Draft, distSeg } = require("./genmaps.js");

const OUT = path.join(__dirname, "..", "js", "campaign-maps.js");
const r1 = v => Math.round(v * 10) / 10;

// Jezero z vodorovných tahů (jako ručně kreslené v editoru); okraj je lehce nepravidelný.
function lake(d, cx, cy, rx, ry, step = 14) {
  for (let y = cy - ry + 10; y <= cy + ry - 10; y += step) {
    const k = Math.sqrt(Math.max(0, 1 - ((y - cy) / ry) ** 2));
    const half = rx * k * (0.92 + d.rnd() * 0.1);
    if (half < 14) continue;
    const off = (d.rnd() - 0.5) * 8;
    d.water.push({ pts: [[r1(cx - half + off), y], [r1(cx + off * 0.3), y], [r1(cx + half + off), y]], hw: 20 });
  }
}

// Les: stromy v elipse (art px střed a poloměry), mimo vodu, cesty, základny, doly a vyhrazená místa.
function forest(d, cx, cy, rx, ry, n, opts = {}) {
  const clearRoad = opts.road == null ? 14 : opts.road; // art px od osy cesty
  const keep = opts.keep || [];
  const gold = d.allGold();
  let guard = 0;
  let placed = 0;

  while (placed < n && guard++ < n * 80) {
    const a = d.rnd() * Math.PI * 2;
    const rr = Math.sqrt(d.rnd());
    const ax = cx + Math.cos(a) * rx * rr;
    const ay = cy + Math.sin(a) * ry * rr;
    const x = Math.round(ax * 2);
    const y = Math.round(ay * 2);

    if (x < 40 || x > d.LW - 40 || y < 70 || y > d.LH - 40) continue;
    if (!d.free(x, y, 14)) continue;
    if (d.roads.some(rd => distSeg(ax, ay, rd.pts) < rd.w + clearRoad)) continue;
    if (d.water.some(w => distSeg(ax, ay, w.pts) < w.hw + 9)) continue;
    if (d.bases.some(b => Math.hypot(x - b.x, y - b.y) < (opts.baseR || 300))) continue;
    if (gold.some(g => Math.hypot(x - g[0], y - g[1]) < 90)) continue;
    if (keep.some(([kx, ky, kr]) => Math.hypot(x - kx, y - ky) < kr)) continue;
    if (d.trees.some(t => Math.hypot(x - t[0], y - t[1]) < (opts.gap || 30))) continue;

    d.trees.push([x, y]);
    placed++;
  }
}

const makers = [];

/* ---------- Kapitola 1: Popel nad Bystrou ---------- */
makers.push(() => {
  const d = new Draft("kampan-bystra", "Bystrá", "Vesnice Bystrá pod Vraním lesem.", 1000, 600, 4101);
  d.base(760, 800); // Bystrá (hráč)
  d.base(1720, 230); // spálená zem, odkud lezou mrtví (bez budov)
  d.coop = { ai: 1 };

  lake(d, 200, 300, 120, 86);
  // potok přitéká ze severu a končí uvnitř jezera, odtok míří k jihu
  d.water.push({ pts: [[330, -6], [322, 40], [304, 96], [282, 146], [256, 196], [236, 240], [220, 290]], hw: 6 });
  d.water.push({ pts: [[156, 340], [148, 380], [140, 420], [146, 470], [138, 530], [132, 606]], hw: 5 });

  d.road([[380, 400], [418, 300], [468, 200], [516, 100], [540, -6]], 6, true, 2);
  d.road([[400, 422], [600, 440], [800, 420], [1006, 404]], 6, true, 2);
  d.road([[468, 200], [600, 168], [740, 132], [850, 118]], 5, false, 2);

  d.extraGold([[1180, 980], [300, 1000]]);

  // Vraní les na severu, háje kolem jezera a na okrajích
  forest(d, 140, 60, 140, 60, 40);
  forest(d, 420, 70, 120, 60, 40);
  forest(d, 640, 60, 110, 50, 30, { keep: [[1700, 230, 420]] });
  forest(d, 330, 290, 50, 110, 14);
  forest(d, 60, 470, 60, 120, 18);
  forest(d, 280, 540, 120, 50, 22);
  forest(d, 640, 560, 160, 40, 26);
  forest(d, 930, 560, 70, 40, 10);
  forest(d, 940, 260, 60, 90, 16, { keep: [[1700, 230, 420]] });
  return d;
});

/* ---------- Kapitola 2: Vraní les ---------- */
makers.push(() => {
  const d = new Draft("kampan-vrani-les", "Vraní les", "Lesní cesta z Bystré k Hněvínu.", 1400, 500, 4202);
  d.base(220, 520); // družina (bez budov)
  d.base(1200, 150); // spálená ves
  d.base(2580, 520); // strážnice vojvody
  d.coop = { ai: 1 };

  d.water.push({ pts: [[860, -6], [852, 60], [838, 130], [822, 200], [830, 260], [840, 320], [826, 390], [812, 450], [820, 506]], hw: 9 });
  // tůňka v lese, napájená vlastním pramínkem
  lake(d, 300, 400, 54, 40, 13);
  d.water.push({ pts: [[230, 506], [244, 470], [262, 432]], hw: 4 });

  d.road([[30, 262], [200, 252], [380, 280], [560, 250], [700, 270], [830, 258], [980, 266], [1150, 242], [1290, 260], [1372, 262]], 6, true, 2);
  d.road([[560, 250], [584, 170], [600, 96]], 5, false, 2);

  const keep = [[440, 520, 120], [1200, 150, 400], [2580, 520, 260], [1660, 520, 130], [2300, 540, 120]];
  forest(d, 200, 120, 200, 110, 70, { road: 22, keep, baseR: 160 });
  forest(d, 220, 420, 200, 70, 50, { road: 22, keep, baseR: 160 });
  forest(d, 560, 120, 140, 110, 60, { road: 22, keep });
  forest(d, 560, 410, 150, 80, 60, { road: 22, keep });
  forest(d, 1000, 120, 130, 110, 56, { road: 22, keep });
  forest(d, 1000, 410, 140, 80, 56, { road: 22, keep });
  forest(d, 1200, 400, 90, 80, 30, { road: 22, keep });
  forest(d, 1240, 90, 90, 70, 26, { road: 22, keep });
  return d;
});

/* ---------- Kapitola 3: Obležení Hněvína ---------- */
makers.push(() => {
  const d = new Draft("kampan-hnevin", "Hněvín", "Hrad vojvody Hostivíta pod horami.", 1300, 900, 4303);
  d.base(1000, 1340); // Radimův tábor
  d.base(1300, 360); // pekelná pevnost
  d.base(1700, 1360); // Hněvín, hrad vojvody
  d.coop = { ai: 1 };
  d.hellR = 900;

  // horský val se třemi průsmyky
  d.ridge([[10, 470], [150, 466], [300, 462]], 24, 2);
  d.ridge([[396, 464], [500, 470], [604, 470]], 24, 2);
  d.ridge([[700, 470], [800, 468], [904, 466]], 24, 2);
  d.ridge([[1000, 462], [1150, 466], [1290, 470]], 24, 2);
  d.massif(260, 180, 60, 16, 3, 0.4);
  d.massif(1060, 170, 60, 16, 3, 1.9);

  // hradby kolem dolního kraje, brány tam, kudy vedou cesty
  d.wall([[380, 560], [1020, 560]]);
  d.wall([[380, 560], [380, 760]]);
  d.wall([[1020, 560], [1020, 760]]);

  const hell = [650, 180];
  d.road([[500, 687], [560, 620], [650, 560], [652, 468], [690, 340], hell], 7, true, 2);
  d.road([[500, 687], [420, 600], [348, 468], [420, 300], [600, 190]], 6, true, 2);
  d.road([[850, 697], [930, 600], [952, 468], [860, 300], [700, 190]], 6, true, 2);
  d.road([[500, 687], [675, 722], [850, 697]], 6, true, 2);
  d.road([[675, 722], [680, 800], [690, 906]], 6, true, 2);

  // řeka na jihu, cesta k posilám ji přechází brodem
  d.water.push({ pts: [[-6, 800], [200, 832], [450, 816], [700, 836], [950, 820], [1306, 842]], hw: 8 });

  d.extraGold([[620, 1500], [2050, 1250], [400, 1200]]);
  const keep = [[1300, 360, 760]];
  forest(d, 160, 640, 140, 120, 46, { keep });
  forest(d, 1160, 640, 120, 120, 40, { keep });
  forest(d, 300, 880, 260, 18, 26, { keep, road: 8 });
  forest(d, 1000, 880, 260, 18, 26, { keep, road: 8 });
  forest(d, 650, 620, 80, 40, 6, { keep, baseR: 260 });
  return d;
});

/* ---------- Kapitola 4: Brána pekel (podle mapy brana-pekel) ---------- */
function branaPekel() {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "maps", "brana-pekel.json"), "utf8"));
  return { ...raw, id: "kampan-brana", name: "Brána pekel", description: "Nekropole za horským valem." };
}

/* ---------- zápis a kontrola ---------- */
const docs = {};
let bad = 0;

for (const doc of [...makers.map(make => make().toDoc()), branaPekel()]) {
  const map = MAPS.compileDoc(doc);
  // kontrola hratelnosti; skrytá pekelná základna (bez budov) v prvních dvou kapitolách se nepočítá
  const problems = CHECK.check(map).filter(p => !/nemrtv|Rudá/.test(p));
  const wet = doc.trees.filter(([x, y]) => MAPS.waterNear(map.terrain, x, y, 14));

  if (problems.length || wet.length) {
    console.log(`✗ ${doc.id}: ${[...problems, wet.length ? `${wet.length} stromů ve vodě` : ""].filter(Boolean).join(" | ")}`);
    bad++;
  } else {
    console.log(`✓ ${doc.id.padEnd(17)} ${doc.size.join("×")}  doly ${doc.gold.length}  stromy ${doc.trees.length}`);
  }

  docs[doc.id] = doc;
}

const body = `/*
 * Mapy kampaně (vygenerováno: node tools/campaign-maps.js, ručně neupravovat).
 * Jsou mimo seznam map pro hru proti AI i multiplayer; sestaví je až js/campaign.js.
 */
(() => {
  "use strict";
  window.PK = window.PK || {};
  window.PK.campaignMaps = ${JSON.stringify(docs)};
})();
`;

fs.writeFileSync(OUT, body);
console.log(`→ ${path.relative(process.cwd(), OUT)} (${Math.round(body.length / 1024)} kB)`);
process.exit(bad ? 1 : 0);
