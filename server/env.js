/*
 * Načte nastavení ze souboru .env v kořeni projektu (řádky KLÍČ=hodnota, # komentář) do process.env.
 * Bez závislostí, sdílí ho server, admin-reset i nástroje v tools/. Proměnné z prostředí mají vždy přednost,
 * takže `PORT=3100 node server/server.js` přebije PORT z .env. Jiný soubor: GORALIA_ENV_FILE=/cesta/.env
 * (prázdná hodnota načítání vypne, to používají testy).
 */
"use strict";

const fs = require("fs");
const path = require("path");

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    const q = /^(["'])(.*)\1$/.exec(v);
    if (q) v = q[1] === '"' ? q[2].replace(/\\n/g, "\n") : q[2];
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]] = v;
  }
  return out;
}

function loadEnv(file = process.env.GORALIA_ENV_FILE ?? path.join(__dirname, "..", ".env")) {
  if (!file) return null;
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { return null; } // .env není povinný
  const vars = parseEnv(text);
  for (const [k, v] of Object.entries(vars)) if (process.env[k] === undefined) process.env[k] = v;
  return file;
}

module.exports = { loadEnv, parseEnv };
