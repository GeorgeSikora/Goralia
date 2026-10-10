/*
 * Úložiště účtů, relací a odehraných zápasů: jeden JSON soubor (data/db.json) držený v paměti.
 * Zápis je odložený a atomický (dočasný soubor + přejmenování), občas se uloží i záloha.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const EMPTY = () => ({ version: 1, nextUserId: 1, nextMatchId: 1, users: {}, sessions: {}, matches: [], audit: [] });
const SAVE_DELAY = 1000;
const BACKUP_EVERY = 3600 * 1000;

function createStore(dir) {
  const file = path.join(dir, "db.json");
  let data = EMPTY();
  let timer = null;
  let dirty = false;
  let lastBackup = 0;

  if (fs.existsSync(file)) {
    try {
      data = Object.assign(EMPTY(), JSON.parse(fs.readFileSync(file, "utf8")));
    } catch (e) {
      const bad = `${file}.corrupt-${Date.now()}`;
      fs.renameSync(file, bad);
      console.error(`Databáze účtů je poškozená, uložena jako ${bad}: ${e.message}`);
    }
  }

  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!dirty) return;
    dirty = false;

    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

    if (fs.existsSync(file) && Date.now() - lastBackup > BACKUP_EVERY) {
      fs.copyFileSync(file, `${file}.bak`);
      lastBackup = Date.now();
    }

    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  function save() {
    dirty = true;
    if (!timer) timer = setTimeout(flush, SAVE_DELAY);
  }

  return { data, save, flush, file };
}

module.exports = { createStore };
