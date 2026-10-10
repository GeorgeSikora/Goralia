/*
 * Obnovení hesla admina: zastav server, spusť `npm run admin:reset` a server znovu spusť.
 * Nové heslo je náhodné, nebo z proměnné GORALIA_ADMIN_PASSWORD. Existující relace admina se zruší.
 */
"use strict";

const path = require("path");
const { createStore } = require("./store.js");
const { createAccounts } = require("./accounts.js");

const store = createStore(path.resolve(process.env.GORALIA_DATA_DIR || path.join(__dirname, "..", "data")));
const accounts = createAccounts(store, { adminName: process.env.GORALIA_ADMIN_NAME, adminEmail: process.env.GORALIA_ADMIN_EMAIL });

accounts.resetAdminPassword(process.env.GORALIA_ADMIN_PASSWORD).then(result => {
  if (!result) {
    console.error("Účet admina zatím neexistuje. Nejdřív jednou spusť server.");
    process.exit(1);
  }

  store.flush();
  console.log(`Nové heslo pro ${result.user.name} (${result.user.email}): ${result.password}`);
  process.exit(0);
}, err => {
  console.error(err.message);
  process.exit(1);
});
