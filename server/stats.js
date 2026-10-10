/*
 * Statistiky hráčů: souhrny na účtu a historie zápasů. Čistá logika nad úložištěm, bez HTTP.
 */
"use strict";

const MAX_MATCHES = 3000;
const MIN_DURATION = 15; // kratší zápasy (odchod v odpočtu) se nezapisují

const newStats = () => ({
  games: 0, wins: 0, losses: 0, draws: 0, pvpGames: 0, pvpWins: 0, playSeconds: 0,
  kills: 0, unitsLost: 0, buildingsDestroyed: 0, buildingsLost: 0, gold: 0, wood: 0, trained: 0, built: 0, heroLevel: 0,
  byMap: {}
});

const SUMS = ["kills", "unitsLost", "buildingsDestroyed", "buildingsLost", "gold", "wood", "trained", "built"];
const int = v => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);

function createStats(store) {
  const data = store.data;

  // info: { map, duration, reason, winner (slot nebo -1), players: [{ slot, userId, name, ai, stats }] }
  function record(info) {
    const duration = int(info.duration);
    if (duration < MIN_DURATION) return null;

    const humans = info.players.filter(p => !p.ai).length;
    const pvp = humans >= 2;

    const players = info.players.map(p => {
      const result = info.winner === p.slot ? "win" : info.winner < 0 && info.reason === "hq" ? "draw" : "loss";
      const entry = { slot: p.slot, userId: p.userId || null, name: p.name, ai: !!p.ai, result };
      for (const key of SUMS) entry[key] = int(p.stats && p.stats[key]);
      entry.heroLevel = int(p.stats && p.stats.heroLevel);
      return entry;
    });

    const match = { id: data.nextMatchId++, ended: Date.now(), map: String(info.map), duration, reason: String(info.reason || ""), humans, ais: players.length - humans, players };
    data.matches.push(match);
    if (data.matches.length > MAX_MATCHES) data.matches.splice(0, data.matches.length - MAX_MATCHES);

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

  function recentFor(userId, limit = 15) {
    const out = [];

    for (let i = data.matches.length - 1; i >= 0 && out.length < limit; i--) {
      const m = data.matches[i];
      const mine = m.players.find(p => p.userId === userId);
      if (!mine) continue;

      out.push({
        id: m.id, ended: m.ended, map: m.map, duration: m.duration, result: mine.result, pvp: m.humans >= 2,
        me: { kills: mine.kills, unitsLost: mine.unitsLost, buildingsDestroyed: mine.buildingsDestroyed, heroLevel: mine.heroLevel },
        players: m.players.map(p => ({ name: p.name, userId: p.userId, ai: p.ai, result: p.result }))
      });
    }

    return out;
  }

  return { record, recentFor };
}

module.exports = { createStats, newStats, MAX_MATCHES, MIN_DURATION };
