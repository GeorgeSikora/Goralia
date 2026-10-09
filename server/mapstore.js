/*
 * Vlastní mapy z editoru: soubory maps/<id>.json (formát goralia-map). Při startu se načtou,
 * uložení za běhu je rovnou zpřístupní hráčům. Každá mapa projde kontrolou struktury i hratelnosti.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const MAPS = require("../js/maps.js");
const NAV = require("../js/nav.js");
const CHECK = require("../js/mapcheck.js");

const DIR = path.resolve(process.env.GORALIA_MAPS_DIR || path.join(__dirname, "..", "maps"));
const docs = new Map();

// Sestaví a zkontroluje mapu z dokumentu; vrací { doc, map, errors }.
function build(raw) {
  const { doc, errors } = MAPS.normalizeDoc(raw);
  if (!doc) return { errors };
  if (MAPS.isBuiltIn(doc.id)) return { errors: ["Toto id patří vestavěné mapě."] };

  const map = MAPS.compileDoc(doc);
  const problems = CHECK.check(map);
  return problems.length ? { errors: problems } : { doc, map, errors: [] };
}

function activate(doc, map) {
  MAPS.register(map);
  NAV.forget(map.id);
  docs.set(doc.id, doc);
}

function load() {
  if (!fs.existsSync(DIR)) return;

  for (const file of fs.readdirSync(DIR)) {
    if (!file.endsWith(".json")) continue;

    try {
      const raw = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
      const result = build(raw);

      if (result.errors.length) console.warn(`Mapa ${file} přeskočena: ${result.errors[0]}`);
      else activate(result.doc, result.map);
    } catch (e) {
      console.warn(`Mapa ${file} přeskočena: ${e.message}`);
    }
  }
}

function save(raw) {
  const result = build(raw);
  if (result.errors.length) return result;

  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, `${result.doc.id}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(result.doc));
  fs.renameSync(tmp, file);
  activate(result.doc, result.map);
  return result;
}

function remove(id) {
  if (!docs.has(id) || !MAPS.unregister(id)) return false;

  docs.delete(id);
  NAV.forget(id);
  fs.rmSync(path.join(DIR, `${id}.json`), { force: true });
  return true;
}

module.exports = { load, save, remove, list: () => [...docs.values()], DIR };
