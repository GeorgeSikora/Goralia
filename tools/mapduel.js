/*
 * Zkouška map zápasy AI proti AI (bez prohlížeče): je mapa hratelná a vyvážená?
 * Spuštění: node tools/mapduel.js [počet zápasů] [id mapy ...]
 *   např. node tools/mapduel.js 6 ostrovy-a-brody zamrzle-jezero
 *   LIMIT=1800 (herní sekundy), SLOTS=0,2 (hrají jen tyto sloty)
 * Každý zápas hrají jen AI; v běžné hře by zápas bez lidí skončil prvním pádem radnice,
 * tady se hraje, dokud nezůstane jediná strana (nebo do limitu herního času).
 * Výpis: kdo vyhrál (podle slotu), za jak dlouho, kolik radnic padlo, a souhrn výher po slotech.
 * Kooperace: hráči (AI spojenci) proti nemrtvým, výsledek je výhra živých nebo nemrtvých.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const MAPS = require("../js/maps.js");
const R = require("../js/rules.js");
const { Match, TICK } = require("../js/sim.js");

const N = Math.max(1, Number(process.argv[2]) || 4);
const LIMIT = Number(process.env.LIMIT) || 45 * 60; // herní sekundy
const DIR = path.join(__dirname, "..", "maps");

const ids = process.argv.slice(3);
const files = ids.length ? ids.map(id => `${id}.json`) : fs.readdirSync(DIR).filter(f => f.endsWith(".json"));

// Seedovaná náhoda, aby šly zápasy zopakovat (mulberry32).
function seeded(seed) {
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function play(map, seed) {
  seeded(seed);
  // SLOTS=0,2 hraje jen vybrané sloty (ostatní zůstanou prázdné), třeba dvojice na mapě pro tři
  const only = process.env.SLOTS ? process.env.SLOTS.split(",").map(Number) : null;
  const players = map.slots.map((_, i) => (!only || only.includes(i) || (map.coop && map.coop.ai === i) ? { name: `AI ${i + 1}`, ai: true } : null));
  const m = new Match(map, players, { countdown: 0 });
  // zápas bez lidí normálně končí prvním pádem radnice; tady až zůstane jediná strana
  m.checkEnd = function (why = "hq") {
    if (this.phase === "ended") return;
    const standing = this.active.filter(t => !this.out.has(t));
    const sides = new Set(standing.map(t => this.side[t]));
    if (sides.size <= 1) this.finish(standing[0] || null, why, this.active.filter(t => standing.length && this.side[t] === this.side[standing[0]]));
  };

  let t = 0;
  while (m.phase !== "ended" && t < LIMIT) {
    m.step(TICK);
    m.endTick();
    t += TICK;
  }

  const out = [...m.out];
  return {
    winner: m.phase === "ended" ? m.winner : null,
    side: m.phase === "ended" && m.winner ? m.side[m.winner] : null,
    time: Math.round(t),
    fallen: out.length,
    kills: Object.values(m.stats).reduce((s, x) => s + x.kills, 0),
    gold: Object.fromEntries(Object.entries(m.stats).map(([k, x]) => [k, x.gold]))
  };
}

const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
let bad = 0;

for (const file of files) {
  const raw = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
  const { doc, errors } = MAPS.normalizeDoc(raw);
  if (!doc) { console.log(`✗ ${file}: ${errors.join(" | ")}`); bad++; continue; }
  const map = MAPS.compileDoc(doc);
  MAPS.register(map);

  const wins = {};
  const rows = [];
  for (let g = 0; g < N; g++) {
    const r = play(map, 1000 + g * 7919);
    const key = r.side === "living" ? "živí" : r.side === "dead" ? "nemrtví" : r.winner || "nikdo";
    wins[key] = (wins[key] || 0) + 1;
    rows.push(`${key}@${mmss(r.time)} (${r.fallen} padlo, ${r.kills} zabití)`);
  }

  const decided = rows.filter(r => !r.startsWith("nikdo")).length;
  console.log(`${map.id.padEnd(18)} ${String(map.players).padStart(2)} hr.  rozhodnuto ${decided}/${N}  výhry: ${Object.entries(wins).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  for (const r of rows) console.log(`    ${r}`);
  if (!decided) bad++;
}

process.exit(bad ? 1 : 0);
