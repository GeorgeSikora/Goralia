/*
 * Scénář kampaně k namluvení: vypíše všechny repliky z js/campaign.js do docs/kampan-scenar.md.
 * Spuštění: node tools/campaign-script.js
 * Nahrávka repliky = assets/kampan/hlasy/<id>.mp3, její id pak patří do VOICED v js/campaign.js.
 */
"use strict";

const fs = require("fs");
const path = require("path");

global.window = { PK: { rules: require("../js/rules.js") } };
require("../js/campaign.js");
const C = window.PK.campaign;

const out = [
  "# Kampaň: Stín Morvanův (scénář)",
  "",
  "Vygenerováno z `js/campaign.js` příkazem `node tools/campaign-script.js`, ručně neupravovat.",
  "",
  "Každá replika má stálé id. Nahrávka se uloží jako `assets/kampan/hlasy/<id>.mp3` a id se přidá do seznamu `VOICED` v `js/campaign.js`; replika pak počká, až hlas dohraje.",
  ""
];

const cast = new Map();
for (const l of C.lines()) cast.set(l.who, (cast.get(l.who) || 0) + 1);
out.push("## Postavy", "", "| Postava | Replik |", "|---|---|");
for (const [who, n] of cast) out.push(`| ${who} | ${n} |`);
out.push("");

for (const ch of C.chapters) {
  out.push(`## ${ch.num}: ${ch.title}`, "", ch.blurb, "", "| id | Postava | Text |", "|---|---|---|");
  for (const l of C.lines().filter(x => x.chapter === ch.id)) out.push(`| \`${l.id}\` | ${l.who} | ${l.text} |`);
  out.push("");
}

const file = path.join(__dirname, "..", "docs", "kampan-scenar.md");
fs.writeFileSync(file, out.join("\n"));
console.log(`→ ${path.relative(process.cwd(), file)} (${C.lines().length} replik)`);
