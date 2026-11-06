#!/usr/bin/env node
/*
 * Stáhne offline databázi pro zjištění země a města z IP: DB-IP „IP to City Lite“ (zdarma, licence CC BY 4.0,
 * vychází jednou měsíčně). Uloží ji do data/geoip.mmdb (nebo kam ukazuje GORALIA_GEOIP); běžící server si ji
 * načte sám do hodiny, restart není potřeba.
 *
 *   npm run geoip
 *
 * Aktualizace jednou za měsíc přes cron na VPS, např.:
 *   15 4 3 * * cd /cesta/ke/goralia && npm run geoip >> data/geoip.log 2>&1
 *
 * Místo DB-IP jde použít i MaxMind GeoLite2 City (potřebuje bezplatný účet): stáhni GeoLite2-City.mmdb
 * a nastav GORALIA_GEOIP=/cesta/GeoLite2-City.mmdb.
 */
"use strict";

require("../server/env.js").loadEnv();

const fs = require("fs");
const path = require("path");
const https = require("https");
const zlib = require("zlib");
const { pipeline } = require("stream/promises");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.resolve(process.env.GORALIA_DATA_DIR || path.join(ROOT, "data"));
const TARGET = path.resolve(process.env.GORALIA_GEOIP || path.join(DATA_DIR, "geoip.mmdb"));

const month = offset => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - offset);
  return d.toISOString().slice(0, 7);
};

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "goralia-geoip-update" } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(get(new URL(res.headers.location, url).toString()));
      } else if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
      } else {
        resolve(res);
      }
    }).on("error", reject);
  });
}

async function main() {
  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  const tmp = `${TARGET}.download`;

  // Nová databáze vychází během prvních dnů měsíce; dokud není, vezme se ta minulá.
  for (const m of [month(0), month(1)]) {
    const url = `https://download.db-ip.com/free/dbip-city-lite-${m}.mmdb.gz`;
    let res;
    try {
      res = await get(url);
    } catch (e) {
      console.log(`${url}: ${e.message}`);
      continue;
    }

    await pipeline(res, zlib.createGunzip(), fs.createWriteStream(tmp));

    // Kontrola, že jde opravdu o čitelnou databázi, než přepíše tu stávající.
    const { Reader } = require("maxmind");
    const reader = new Reader(fs.readFileSync(tmp));
    fs.renameSync(tmp, TARGET);
    console.log(`Uloženo ${TARGET} (${reader.metadata.databaseType}, ${m}, ${(fs.statSync(TARGET).size / 1e6).toFixed(0)} MB).`);
    return;
  }

  throw new Error("Databázi se nepodařilo stáhnout.");
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
