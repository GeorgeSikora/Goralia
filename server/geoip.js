/*
 * Odkud se kdo připojil: IP adresa -> země, kraj, město a přibližné souřadnice města.
 * Vyhledává se offline v lokální databázi (formát MaxMind .mmdb, např. zdarma DB-IP „IP to City Lite“
 * nebo MaxMind GeoLite2 City), takže se IP adresy nikam neposílají. Stažení databáze: npm run geoip.
 * Bez databáze se nic nezjišťuje a zbytek serveru běží dál. Soubor se po aktualizaci načte sám.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const RELOAD_CHECK_MS = 60 * 60 * 1000;

// Lokální a vyhrazené adresy (vývoj na localhostu, LAN) se nehledají.
const PRIVATE_RE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|::1$|::$|f[cd][0-9a-f]{2}:|fe80:)/i;

const text = (v, max = 60) => String(v || "").replace(/[\u0000-\u001f|]/g, " ").trim().slice(0, max);

function createGeo(file) {
  let reader = null;
  let info = null;
  let loadedMtime = 0;

  function load() {
    if (!file) return;
    let stat;
    try {
      stat = fs.statSync(file);
    } catch (e) {
      if (reader) console.error(`Geolokační databáze ${file} zmizela, odkud se kdo připojil se přestává zjišťovat.`);
      reader = null;
      info = null;
      loadedMtime = 0;
      return;
    }
    if (reader && stat.mtimeMs === loadedMtime) return;

    try {
      const { Reader } = require("maxmind");
      reader = new Reader(fs.readFileSync(file));
      loadedMtime = stat.mtimeMs;
      const meta = reader.metadata;
      info = { type: meta.databaseType, built: meta.buildEpoch ? meta.buildEpoch.getTime() : null, file: path.basename(file) };
      console.log(`Geolokace: ${info.type} (${new Date(info.built).toISOString().slice(0, 10)}) ze souboru ${file}`);
    } catch (e) {
      console.error(`Geolokační databázi ${file} nejde načíst: ${e.message}`);
      reader = null;
      info = null;
    }
  }

  load();
  const timer = setInterval(load, RELOAD_CHECK_MS);
  timer.unref();

  // { cc, country, region, city, lat, lon } nebo null (neznámá, lokální adresa, chybí databáze)
  function lookup(ip) {
    if (!reader || !ip) return null;
    ip = String(ip).replace(/^::ffff:/i, "");
    if (PRIVATE_RE.test(ip)) return null;

    let rec;
    try {
      rec = reader.get(ip);
    } catch (e) {
      return null;
    }
    if (!rec) return null;

    const name = obj => (obj && obj.names ? obj.names.en || Object.values(obj.names)[0] : "");
    const country = rec.country || rec.registered_country;
    const cc = text(country && country.iso_code, 2).toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return null;

    const loc = rec.location || {};
    const round = v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
    return {
      cc,
      country: text(name(country)),
      region: text(name(rec.subdivisions && rec.subdivisions[0])),
      city: text(name(rec.city)),
      lat: round(loc.latitude),
      lon: round(loc.longitude)
    };
  }

  return { lookup, info: () => info, reload: load, close: () => clearInterval(timer) };
}

module.exports = { createGeo };
