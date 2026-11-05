/*
 * Statistiky hráčů: souhrny na účtu a historie zápasů. Čistá logika nad úložištěm, bez HTTP.
 */
"use strict";

const MAX_MATCHES = 3000;
const MAX_DETAILED = 300; // průběh v čase (timeline) se drží jen u posledních zápasů, kvůli velikosti databáze
const MIN_DURATION = 15; // kratší zápasy (odchod v odpočtu) se nezapisují
const TEAMS = require("../js/rules.js").TEAMS;

const newStats = () => ({
  games: 0, wins: 0, losses: 0, draws: 0, pvpGames: 0, pvpWins: 0, aiGames: 0, aiWins: 0, playSeconds: 0, aiSeconds: 0,
  kills: 0, unitsLost: 0, buildingsDestroyed: 0, buildingsLost: 0, gold: 0, wood: 0, trained: 0, built: 0, heroLevel: 0,
  byMap: {}
});

const SUMS = ["kills", "unitsLost", "buildingsDestroyed", "buildingsLost", "gold", "wood", "trained", "built"];
const EXTRA = ["spentGold", "spentWood"];
const int = v => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);

// { typ: počet } jen s rozumnými klíči a celými čísly
function counts(obj) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) if (/^[a-z]{1,20}$/.test(k) && int(v)) out[k] = int(v);
  return out;
}

function createStats(store) {
  const data = store.data;

  // info: { map, duration, reason, winner (slot nebo -1), started?, timeline?,
  //         players: [{ slot, userId, name, ai, stats, cmds?, outAt?, outWhy?, upgrades? }] }
  function record(info) {
    const duration = int(info.duration);
    if (duration < MIN_DURATION) return null;

    const humans = info.players.filter(p => !p.ai).length;
    // kooperace proti nemrtvým není souboj lidí proti sobě
    const pvp = humans >= 2 && !info.coop;
    // v kooperaci vítězí celý tým (winners); jinak jeden hráč
    const winners = Array.isArray(info.winners) && info.winners.length ? info.winners : [info.winner];

    const players = info.players.map(p => {
      const result = winners.includes(p.slot) ? "win" : info.winner < 0 && info.reason === "hq" ? "draw" : "loss";
      const entry = { slot: p.slot, team: TEAMS[p.slot] || "", userId: p.userId || null, name: p.name, ai: !!p.ai, result };
      for (const key of SUMS) entry[key] = int(p.stats && p.stats[key]);
      for (const key of EXTRA) entry[key] = int(p.stats && p.stats[key]);
      entry.heroLevel = int(p.stats && p.stats.heroLevel);
      entry.trainedBy = counts(p.stats && p.stats.trainedBy);
      entry.builtBy = counts(p.stats && p.stats.builtBy);
      entry.upgrades = counts(p.upgrades);
      entry.cmds = int(p.cmds);
      if (p.outAt != null) {
        entry.outAt = int(p.outAt);
        entry.outWhy = String(p.outWhy || "");
      }
      return entry;
    });

    const match = {
      id: data.nextMatchId++, started: int(info.started) || null, ended: Date.now(), map: String(info.map), duration,
      reason: String(info.reason || ""), winner: Number.isInteger(info.winner) ? info.winner : -1,
      humans, ais: players.length - humans, players
    };
    if (info.coop) match.coop = true;
    if (info.timeline) match.timeline = info.timeline;

    data.matches.push(match);
    if (data.matches.length > MAX_MATCHES) data.matches.splice(0, data.matches.length - MAX_MATCHES);
    for (let i = data.matches.length - MAX_DETAILED - 1; i >= 0 && data.matches[i].timeline; i--) delete data.matches[i].timeline;

    for (const p of players) {
      const user = p.userId && data.users[p.userId];
      if (!user) continue;

      const s = user.stats;
      s.games++;
      if (p.result === "win") s.wins++;
      else if (p.result === "draw") s.draws++;
      else s.losses++;

      if (pvp) {
        s.pvpGames++;
        if (p.result === "win") s.pvpWins++;
      }

      s.playSeconds += duration;
      for (const key of SUMS) s[key] += p[key];
      s.heroLevel = Math.max(s.heroLevel, p.heroLevel);

      const m = s.byMap[match.map] || (s.byMap[match.map] = { games: 0, wins: 0 });
      m.games++;
      if (p.result === "win") m.wins++;
    }

    store.save();
    return match;
  }

  // Hra proti AI v prohlížeči: server vidí jen výsledek a délku (hlásí klient, ověřuje api.js), proto se
  // započítá do zápasů a výher (a tím do síně slávy), ale ne do podrobných součtů ani historie zápasů.
  function recordAi(user, { map, result, duration }) {
    if (!user || !["win", "loss", "draw"].includes(result) || int(duration) < MIN_DURATION) return false;

    const s = user.stats;
    s.games++;
    s.aiGames++;
    if (result === "win") {
      s.wins++;
      s.aiWins++;
    } else if (result === "draw") s.draws++;
    else s.losses++;

    const id = String(map || "");
    if (/^[a-z0-9_-]{1,40}$/i.test(id)) {
      const m = s.byMap[id] || (s.byMap[id] = { games: 0, wins: 0 });
      m.games++;
      if (result === "win") m.wins++;
    }

    store.save();
    return true;
  }

  function recentFor(userId, limit = 15) {
    const out = [];

    for (let i = data.matches.length - 1; i >= 0 && out.length < limit; i--) {
      const m = data.matches[i];
      const mine = m.players.find(p => p.userId === userId);
      if (!mine) continue;

      out.push({
        id: m.id, ended: m.ended, map: m.map, duration: m.duration, result: mine.result, pvp: m.humans >= 2 && !m.coop,
        me: { kills: mine.kills, unitsLost: mine.unitsLost, buildingsDestroyed: mine.buildingsDestroyed, heroLevel: mine.heroLevel },
        players: m.players.map(p => ({ name: p.name, userId: p.userId, ai: p.ai, result: p.result }))
      });
    }

    return out;
  }

  // Celý záznam jednoho zápasu (pro rozkliknutí v profilu nebo panelu).
  function getMatch(id) {
    const wanted = Number(id);
    let lo = 0;
    let hi = data.matches.length - 1;

    // id rostou, takže stačí půlení intervalu
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const m = data.matches[mid];
      if (m.id === wanted) return m;
      if (m.id < wanted) lo = mid + 1;
      else hi = mid - 1;
    }

    return null;
  }

  return { record, recordAi, recentFor, getMatch };
}

module.exports = { createStats, newStats, MAX_MATCHES, MAX_DETAILED, MIN_DURATION };
