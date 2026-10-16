/*
 * Síň slávy: celkové skóre hráčů z bitev (zaznamenané zápasy) a turnajů (zapisuje admin).
 * Skóre je prostý součet bodů podle POINTS, aby šlo hráčům snadno vysvětlit.
 * Výsledky jsou veřejné (záložka Hráči v menu hry), turnaje zapisuje jen admin.
 */
"use strict";

const { nameKey } = require("./accounts.js");

const POINTS = {
  pvpWin: 25, // výhra v zápase proti lidem
  otherWin: 10, // výhra proti AI nebo v kooperaci (zápas běžel na serveru)
  game: 2, // každý zaznamenaný zápas, i prohraný
  place: [100, 60, 40], // 1., 2. a 3. místo v turnaji
  entry: 15 // účast v turnaji bez medaile
};

const MAX_TOURNAMENTS = 500;
const MAX_ENTRANTS = 64;

function createHallOfFame(store, accounts) {
  const data = store.data;
  if (!Array.isArray(data.tournaments)) data.tournaments = [];
  if (!data.nextTournamentId) data.nextTournamentId = 1;

  // { userId: { gold, silver, bronze, played, points } }
  function tournamentTotals() {
    const out = {};

    for (const t of data.tournaments) {
      for (const e of t.entrants) {
        const row = out[e.userId] || (out[e.userId] = { gold: 0, silver: 0, bronze: 0, played: 0, points: 0 });
        row.played++;
        if (e.place === 1) row.gold++;
        else if (e.place === 2) row.silver++;
        else if (e.place === 3) row.bronze++;
        row.points += POINTS.place[e.place - 1] || POINTS.entry;
      }
    }

    return out;
  }

  function scoreOf(user, tour) {
    const s = user.stats;
    const otherWins = Math.max(0, s.wins - s.pvpWins);
    const battle = s.pvpWins * POINTS.pvpWin + otherWins * POINTS.otherWin + s.games * POINTS.game;
    const t = tour || { gold: 0, silver: 0, bronze: 0, played: 0, points: 0 };
    return { score: battle + t.points, battle, tournament: t.points, pvpWins: s.pvpWins, otherWins, games: s.games, medals: t };
  }

  // Pořadí hráčů s nenulovým skóre; zablokovaní se nezobrazují.
  function ranking(limit = 100) {
    const tours = tournamentTotals();
    const rows = Object.values(data.users)
      .filter(u => !u.banned)
      .map(u => ({ user: u, ...scoreOf(u, tours[u.id]) }))
      .filter(r => r.score > 0);

    rows.sort((a, b) => b.score - a.score || b.pvpWins - a.pvpWins || b.medals.gold - a.medals.gold || a.user.name.localeCompare(b.user.name));

    let rank = 0;
    return rows.slice(0, limit).map((r, i) => {
      // stejné skóre = stejné místo
      if (!i || r.score !== rows[i - 1].score) rank = i + 1;
      const { user, ...rest } = r;
      // jen veřejné údaje: síň slávy vidí každý návštěvník hry
      return {
        rank, id: user.id, name: user.name, admin: user.role === "admin",
        playSeconds: user.stats.playSeconds, aiSeconds: user.stats.aiSeconds, ...rest
      };
    });
  }

  const tournamentView = t => ({ ...t, entrants: t.entrants.map(e => ({ ...e, name: (data.users[e.userId] || {}).name || e.name })) });
  const publicTournament = t => ({ id: t.id, name: t.name, date: t.date, entrants: tournamentView(t).entrants });

  // admin = i kdo turnaj zapsal; veřejně jen název, datum a výsledky
  function listTournaments({ admin = false, limit = MAX_TOURNAMENTS } = {}) {
    const sorted = data.tournaments.slice().sort((a, b) => b.date - a.date || b.id - a.id).slice(0, limit);
    return sorted.map(admin ? tournamentView : publicTournament);
  }

  // body: { name, date (ms nebo "YYYY-MM-DD"), places: [jméno 1., 2., 3.], others: [jména] }
  function addTournament(admin, body) {
    const name = String(body.name || "").trim().replace(/\s+/g, " ").slice(0, 60);
    if (name.length < 2) return { error: "Zadej název turnaje." };

    const date = typeof body.date === "number" ? body.date : Date.parse(String(body.date || ""));
    if (!Number.isFinite(date)) return { error: "Neplatné datum turnaje." };

    const index = new Map(Object.values(data.users).map(u => [nameKey(u.name), u]));
    const entrants = [];
    const unknown = [];
    const add = (raw, place) => {
      const text = String(raw || "").trim();
      if (!text) return;
      const user = index.get(nameKey(text));
      if (!user) return unknown.push(text);
      if (entrants.some(e => e.userId === user.id)) return;
      entrants.push({ userId: user.id, name: user.name, place });
    };

    const places = Array.isArray(body.places) ? body.places.slice(0, 3) : [];
    places.forEach((n, i) => add(n, i + 1));
    for (const n of Array.isArray(body.others) ? body.others : []) add(n, 0);

    if (unknown.length) return { error: `Neznámí hráči: ${unknown.slice(0, 5).join(", ")}` };
    if (!entrants.some(e => e.place === 1)) return { error: "Turnaj musí mít vítěze." };
    if (entrants.length > MAX_ENTRANTS) return { error: `Nejvýš ${MAX_ENTRANTS} účastníků.` };

    const t = { id: data.nextTournamentId++, name, date, entrants, by: admin.name, created: Date.now() };
    data.tournaments.push(t);
    if (data.tournaments.length > MAX_TOURNAMENTS) data.tournaments.splice(0, data.tournaments.length - MAX_TOURNAMENTS);
    accounts.audit(admin, "tournament-add", `${name} (#${t.id}), vítěz ${entrants[0].name}`);
    return { tournament: tournamentView(t) };
  }

  function deleteTournament(admin, id) {
    const i = data.tournaments.findIndex(t => t.id === Number(id));
    if (i < 0) return { error: "Turnaj neexistuje." };

    const [t] = data.tournaments.splice(i, 1);
    accounts.audit(admin, "tournament-delete", `${t.name} (#${t.id})`);
    return { tournament: t };
  }

  return { ranking, listTournaments, addTournament, deleteTournament, POINTS };
}

module.exports = { createHallOfFame, POINTS };
