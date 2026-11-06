/*
 * Hry proti AI v prohlížeči: simulace běží u hráče, server dostane jen hlášení "start" a "end"
 * (POST /api/beacon). Přihlášenému hráči se připíše odehraný čas a zápas do statistik a síně slávy.
 * Hlášení je od klienta, proto se ověřuje proti skutečně uplynulému času od startu.
 */
"use strict";

const { MIN_DURATION } = require("./stats.js");

const AI_MAX = 6 * 3600; // nejdelší započítaná hra
const MIN_WIN = 60; // výhra proti AI se uzná nejdřív po minutě skutečného hraní
const MAX_PENDING = 10000;

function createAiGames({ accounts, stats, now = Date.now }) {
  const starts = new Map(); // id hráče -> čas startu

  // body: { e: "start" | "end", map, result: win|loss|draw, duration (s), quit (hra opuštěná = prohra) }
  // Vrací, co se započítalo: null, nebo { seconds, result, counted }.
  function report(user, body) {
    const t = now();

    if (body.e === "start") {
      starts.delete(user.id); // nový start je až na konec mapy (nejstarší se zahazují)
      starts.set(user.id, t);
      if (starts.size > MAX_PENDING) starts.delete(starts.keys().next().value);
      return null;
    }

    if (body.e !== "end") return null;

    // konec bez startu (restart serveru, podvržené nebo dvojí hlášení) se nepočítá
    const start = starts.get(user.id);
    starts.delete(user.id);
    const sec = Number(body.duration);
    if (!start || !Number.isFinite(sec) || sec <= 0) return null;

    const real = (t - start) / 1000;
    const seconds = Math.min(sec, real + 5, AI_MAX);
    accounts.addAiTime(user, seconds);

    const result = body.quit ? "loss" : body.result;
    const fair = result !== "win" || real >= MIN_WIN;
    const counted = fair && stats.recordAi(user, { map: body.map, result, duration: seconds });
    return { seconds, result, counted };
  }

  return { report, pending: () => starts.size };
}

module.exports = { createAiGames, AI_MAX, MIN_WIN };
