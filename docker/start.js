/*
 * Start serveru v kontejneru. Spouští se jako root jen proto, aby data/ a maps/ připojené z hostu
 * (třeba po pm2, kde patřily rootovi) přepsal na uživatele node, pak práva zahodí a pustí server.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const UID = 1000;
const GID = 1000;

function chownTree(dir) {
  let entries;
  try {
    fs.lchownSync(dir, UID, GID);
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code !== "ENOENT") console.error(`Nejde nastavit vlastníka ${dir}: ${e.message}`);
    return;
  }

  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) chownTree(p);
    else fs.lchownSync(p, UID, GID);
  }
}

if (process.getuid && process.getuid() === 0) {
  for (const dir of [process.env.GORALIA_DATA_DIR, process.env.GORALIA_MAPS_DIR]) {
    if (!dir) continue;
    fs.mkdirSync(dir, { recursive: true });
    chownTree(dir);
  }

  process.setgroups([GID]);
  process.setgid(GID);
  process.setuid(UID);
}

require("../server/server.js");
