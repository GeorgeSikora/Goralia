/*
 * Testy účtů: úložiště, registrace, přihlášení, relace, OAuth (s podvrženým poskytovatelem),
 * statistiky, správa hráčů adminem a HTTP API spuštěného serveru.
 * Spuštění: node server/test-accounts.js (součástí `npm test`)
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");
const { createStore } = require("./store.js");
const { createAccounts } = require("./accounts.js");
const { createStats, MIN_DURATION } = require("./stats.js");
const { createOAuth } = require("./oauth.js");
const { createHallOfFame, POINTS } = require("./halloffame.js");
const { createEvents } = require("./events.js");
const { createAiGames, MIN_WIN } = require("./aigames.js");
const { Match } = require("../js/sim.js");
const MAPS = require("../js/maps.js");
require("./mapstore.js").load(); // mapy z repozitáře pro zápasy ve scénářích
const R = require("../js/rules.js");

const ADMIN_EMAIL = "info@jirisikora.cz";
const ADMIN_PASSWORD = "test-admin-heslo";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/* ---------- počítání zápasů a síně slávy: scénáře nových hráčů ---------- */
async function testScoring() {
  const store = createStore(tmp("goralia-score-"));
  const accounts = createAccounts(store, { adminName: "Jurek", adminEmail: ADMIN_EMAIL });
  const stats = createStats(store);
  const hall = createHallOfFame(store, accounts);
  let clock = Date.parse("2026-10-31T12:00:00Z");
  const ai = createAiGames({ accounts, stats, now: () => clock });
  const wait = sec => { clock += sec * 1000; };

  const join = async name => (await accounts.register({ name, email: `${name.toLowerCase()}@example.com`, password: "heslo-1234" }, "6.6.6.6")).user;
  const row = user => hall.ranking().find(r => r.id === user.id);
  const expected = (pvpWins, otherWins, games) => pvpWins * POINTS.pvpWin + otherWins * POINTS.otherWin + games * POINTS.game;

  // Zápas na serveru stejně jako recordMatch v server.js: výsledek dává simulace.
  const serverMatch = (mapId, roster, play, duration = 300) => {
    const map = MAPS.get(mapId);
    const players = map.slots.map((_, i) => roster[i] ? { name: roster[i].name, ai: !roster[i].user } : null);
    const m = new Match(map, players);
    play(m);
    assert.strictEqual(m.phase, "ended", "zápas skončil");
    return stats.record({
      map: mapId, duration, reason: m.reason, coop: !!map.coop,
      winner: m.winner ? R.TEAMS.indexOf(m.winner) : -1,
      winners: m.winners.map(t => R.TEAMS.indexOf(t)),
      players: roster.map((r, slot) => r && { slot, name: r.name, ai: !r.user, userId: r.user ? r.user.id : null, stats: {} }).filter(Boolean)
    });
  };

  // nový hráč bez zápasu v síni slávy není
  const nova = await join("Nova");
  assert.strictEqual(row(nova), undefined, "nový hráč bez zápasu");
  assert.deepStrictEqual([nova.stats.games, nova.stats.aiGames, nova.stats.aiWins], [0, 0, 0]);

  // výhra proti AI v prohlížeči se započítá (dřív se připsal jen čas)
  ai.report(nova, { e: "start", map: "valley" });
  wait(420);
  assert.deepStrictEqual(ai.report(nova, { e: "end", map: "valley", result: "win", duration: 415 }), { seconds: 415, result: "win", counted: true });
  assert.deepStrictEqual([nova.stats.games, nova.stats.wins, nova.stats.aiGames, nova.stats.aiWins], [1, 1, 1, 1]);
  assert.strictEqual(nova.stats.aiSeconds, 415);
  assert.strictEqual(nova.stats.pvpWins, 0, "výhra proti AI není výhra proti lidem");
  assert.deepStrictEqual(nova.stats.byMap.valley, { games: 1, wins: 1 });
  let r = row(nova);
  assert(r, "po výhře proti AI je hráč v síni slávy");
  assert.deepStrictEqual([r.otherWins, r.pvpWins, r.games, r.score], [1, 0, 1, expected(0, 1, 1)]);
  assert.strictEqual(r.aiSeconds, 415, "síň slávy ukazuje i čas proti AI");

  // prohra proti AI: zápas ano, výhra ne
  ai.report(nova, { e: "start", map: "valley" });
  wait(200);
  ai.report(nova, { e: "end", map: "valley", result: "loss", duration: 200 });
  assert.deepStrictEqual([nova.stats.games, nova.stats.wins, nova.stats.losses], [2, 1, 1]);

  // opuštěná hra (zavřená karta, nová hra) je prohra, i když klient tvrdí výhru
  ai.report(nova, { e: "start", map: "valley" });
  wait(120);
  assert.strictEqual(ai.report(nova, { e: "end", map: "valley", result: "win", quit: true, duration: 118 }).result, "loss");
  assert.deepStrictEqual([nova.stats.games, nova.stats.wins, nova.stats.losses], [3, 1, 2]);

  // podvrhy a nesmysly: konec bez startu, dvojí konec, rychlá výhra, krátká hra, neznámý výsledek
  const before = JSON.stringify(nova.stats);
  assert.strictEqual(ai.report(nova, { e: "end", result: "win", duration: 600 }), null, "konec bez startu");
  ai.report(nova, { e: "start" });
  wait(MIN_WIN - 10);
  const fast = ai.report(nova, { e: "end", result: "win", duration: 5000 });
  assert.strictEqual(fast.counted, false, "výhra rychlejší než minuta se neuzná");
  assert.strictEqual(fast.seconds, MIN_WIN - 5, "délka se ořízne na skutečný čas");
  assert.strictEqual(ai.report(nova, { e: "end", result: "win", duration: 60 }), null, "druhý konec téže hry");
  ai.report(nova, { e: "start" });
  wait(MIN_DURATION - 6);
  assert.strictEqual(ai.report(nova, { e: "end", result: "loss", duration: MIN_DURATION - 6 }).counted, false, "krátká hra");
  ai.report(nova, { e: "start" });
  wait(100);
  assert.strictEqual(ai.report(nova, { e: "end", result: "bogus", duration: 100 }).counted, false, "neznámý výsledek");
  ai.report(nova, { e: "start", map: "../x" });
  wait(100);
  ai.report(nova, { e: "end", map: "<script>", result: "draw", duration: 100 });
  assert.strictEqual(nova.stats.draws, 1);
  assert(!Object.keys(nova.stats.byMap).some(k => /[<.]/.test(k)), "neplatné jméno mapy se do statistik nedostane");
  const after = JSON.parse(JSON.stringify(nova.stats));
  const was = JSON.parse(before);
  assert.deepStrictEqual([after.games - was.games, after.wins - was.wins], [1, 0], "z podvrhů se započítala jen remíza");

  // výhra nového hráče proti člověku na serveru (soupeř se vzdal)
  const ota = await join("Ota");
  const pvp = serverMatch("valley", [{ name: "Nova", user: nova }, { name: "Ota", user: ota }], m => m.resign("red", "surrender"));
  assert.strictEqual(pvp.players[0].result, "win");
  assert.deepStrictEqual([nova.stats.pvpGames, nova.stats.pvpWins], [1, 1]);
  assert.deepStrictEqual([ota.stats.games, ota.stats.wins, ota.stats.losses, ota.stats.pvpGames], [1, 0, 1, 1]);
  assert.strictEqual(row(ota).score, expected(0, 0, 1), "prohra = jen body za zápas");
  r = row(nova);
  assert.deepStrictEqual([r.pvpWins, r.otherWins, r.games], [1, 1, 5]);
  assert.strictEqual(r.score, expected(1, 1, 5));

  // odpojení uprostřed zápasu: odpojený prohrává, zbylý vyhrává proti lidem
  const pia = await join("Pia");
  const gone = serverMatch("valley", [{ name: "Ota", user: ota }, { name: "Pia", user: pia }], m => m.resign("blue", "disconnect"));
  assert.strictEqual(gone.reason, "disconnect");
  assert.deepStrictEqual(gone.players.map(p => p.result), ["loss", "win"]);
  assert.deepStrictEqual([pia.stats.pvpWins, ota.stats.losses], [1, 2]);

  // všichni lidé odešli (zápas s AI opuštěn): prohra, ne výhra
  serverMatch("valley", [{ name: "Pia", user: pia }, { name: "AI" }], m => m.finish(null, "abandoned"));
  assert.deepStrictEqual([pia.stats.games, pia.stats.wins, pia.stats.losses], [2, 1, 1]);

  // výhra proti AI na serveru (jeden člověk + AI): výhra proti AI, ne proti lidem
  serverMatch("valley", [{ name: "Pia", user: pia }, { name: "AI" }], m => m.resign("red", "hq"));
  assert.deepStrictEqual([pia.stats.wins, pia.stats.pvpWins, pia.stats.pvpGames], [2, 1, 1]);
  assert.strictEqual(row(pia).otherWins, 1);

  // kooperace proti nemrtvým: výhra celého týmu, žádná výhra proti lidem, v historii ne jako PvP
  const coopMap = MAPS.list.find(m => m.coop);
  const undead = coopMap.coop.ai;
  const humans = coopMap.slots.map((_, i) => i).filter(i => i !== undead).slice(0, 2);
  const roster = [];
  roster[undead] = { name: R.UNDEAD.short };
  roster[humans[0]] = { name: "Ota", user: ota };
  roster[humans[1]] = { name: "Nova", user: nova };
  const coop = serverMatch(coopMap.id, roster, m => m.resign(R.TEAMS[undead], "hq"));
  assert(coop.coop);
  assert.deepStrictEqual(coop.players.filter(p => !p.ai).map(p => p.result), ["win", "win"]);
  assert.deepStrictEqual([ota.stats.pvpGames, nova.stats.pvpGames], [2, 1], "kooperace se do PvP nepočítá");
  assert.strictEqual(stats.recentFor(ota.id, 1)[0].pvp, false, "kooperace není v historii PvP");
  assert.strictEqual(stats.recentFor(pia.id, 5).find(m => m.id === gone.id).pvp, true);

  // pořadí: body sedí se vzorcem pro všechny
  for (const p of hall.ranking()) {
    const u = accounts.getUser(p.id);
    assert.strictEqual(p.games, u.stats.games);
    assert.strictEqual(p.otherWins, u.stats.wins - u.stats.pvpWins);
    assert.strictEqual(p.score, expected(u.stats.pvpWins, u.stats.wins - u.stats.pvpWins, u.stats.games));
  }
  const ranks = hall.ranking();
  for (let i = 1; i < ranks.length; i++) assert(ranks[i - 1].score >= ranks[i].score, "seřazeno podle skóre");

  // starý účet z doby před počítáním her proti AI: chybějící pole se po restartu doplní (žádné NaN v síni slávy)
  const old = await join("Stary");
  delete old.stats.aiGames;
  delete old.stats.aiWins;
  old.stats.games = 1;
  store.flush();
  const dir = path.dirname(store.file);
  const restarted = createStore(dir);
  createAccounts(restarted, {});
  const oldBack = restarted.data.users[old.id];
  assert.deepStrictEqual([oldBack.stats.aiGames, oldBack.stats.aiWins], [0, 0]);
  const oldRow = createHallOfFame(restarted, accounts).ranking().find(p => p.id === old.id);
  assert.strictEqual(oldRow.score, POINTS.game);
}

/* ---------- účty, relace, statistiky (bez serveru) ---------- */
async function testAccounts() {
  const dir = tmp("goralia-acc-");
  const store = createStore(dir);
  const accounts = createAccounts(store, { adminName: "Jurek", adminEmail: ADMIN_EMAIL });
  const stats = createStats(store);

  // admin se založí jednou; heslo je zvolené, nebo náhodné
  const seed = await accounts.seedAdmin(ADMIN_PASSWORD);
  assert(seed && seed.user.role === "admin" && seed.user.name === "Jurek" && seed.user.email === ADMIN_EMAIL);
  assert.strictEqual(seed.generated, false);
  assert.strictEqual(await accounts.seedAdmin(), null, "druhé založení nic nedělá");

  const other = createAccounts(createStore(tmp("goralia-acc-")), {});
  const generated = await other.seedAdmin();
  assert(generated.generated && generated.password.length === 16, "náhodné heslo");
  await assert.rejects(() => createAccounts(createStore(tmp("goralia-acc-")), {}).seedAdmin("krátké"), /Heslo musí mít/, "slabé heslo admina");

  // registrace: neplatné vstupy
  const bad = async (input, pattern) => {
    const result = await accounts.register({ email: "x@example.com", password: "heslo-1234", ...input }, "9.9.9.9");
    assert(result.error && pattern.test(result.error), `${JSON.stringify(input)} -> ${result.error}`);
  };

  await bad({ name: "ab" }, /Přezdívka/);
  await bad({ name: "Žába" }, /Přezdívka/);
  await bad({ name: "Jurek" }, /vyhrazená/);
  await bad({ name: "Ju rek" }, /vyhrazená/);
  await bad({ name: "Admin" }, /vyhrazená/);
  await bad({ name: "AI Modra" }, /vyhrazená/);
  await bad({ name: "Karel", email: "neni-email" }, /e-mail/);
  await bad({ name: "Karel", email: ADMIN_EMAIL }, /zaregistrovaný/);
  await bad({ name: "Karel", password: "kratke" }, /aspoň 8/);
  await bad({ name: "Karel-Novak", password: "Karel-Novak" }, /stejné/);

  const karel = (await accounts.register({ name: "Karel", email: "Karel@Example.com", password: "heslo-1234" }, "9.9.9.9")).user;
  assert(karel && karel.email === "karel@example.com", "e-mail se ukládá malými písmeny");
  assert(karel.passHash.startsWith("scrypt$") && !karel.passHash.includes("heslo-1234"), "heslo je jen jako hash");
  await bad({ name: "karel", email: "jiny@example.com" }, /obsazená/);
  await bad({ name: "Jiny", email: "KAREL@example.com" }, /zaregistrovaný/);

  // přihlášení jménem i e-mailem
  assert.strictEqual((await accounts.login("kAREL", "heslo-1234", "1.1.1.1")).user, karel);
  assert.strictEqual((await accounts.login("karel@EXAMPLE.com", "heslo-1234", "1.1.1.1")).user, karel);
  assert((await accounts.login("Karel", "spatne-heslo", "1.1.1.1")).error);
  assert.strictEqual((await accounts.login("Jurek", ADMIN_PASSWORD, "1.1.1.1")).user.role, "admin");
  assert.strictEqual((await accounts.login(ADMIN_EMAIL, ADMIN_PASSWORD, "1.1.1.1")).user.name, "Jurek");

  // omezení pokusů o uhádnutí hesla
  for (let i = 0; i < 8; i++) assert(!(await accounts.login("Nikdo", "x", `2.2.2.${i}`)).limited, `pokus ${i}`);
  assert((await accounts.login("Nikdo", "x", "2.2.2.99")).limited, "po 8 neúspěších se přihlášení jménem zablokuje");
  assert.strictEqual((await accounts.login("Karel", "heslo-1234", "3.3.3.3")).user, karel, "ostatní účty nejsou dotčené");

  // relace: token se neukládá, vyprší, jde zrušit
  const token = accounts.createSession(karel);
  assert.strictEqual(token.length, 64);
  assert.strictEqual(accounts.userFromToken(token), karel);
  assert(!(token in store.data.sessions), "ukládá se jen hash tokenu");
  assert.strictEqual(accounts.userFromToken("x".repeat(64)), null);
  accounts.destroySession(token);
  assert.strictEqual(accounts.userFromToken(token), null);

  const expiring = accounts.createSession(karel);
  Object.values(store.data.sessions).forEach(s => { s.expires = 1; });
  assert.strictEqual(accounts.userFromToken(expiring), null, "vypršelá relace");

  // přezdívka a heslo
  assert.strictEqual(accounts.rename(karel, "Karel2").user.name, "Karel2");
  assert(/jednou za hodinu/.test(accounts.rename(karel, "Karel3").error));
  karel.nameChanged = 0;
  assert(accounts.rename(karel, "Jurek").error, "rezervované jméno nejde převzít");
  assert.strictEqual(accounts.rename(karel, "Karel").user.name, "Karel");

  const keep = accounts.createSession(karel);
  const drop = accounts.createSession(karel);
  assert((await accounts.changePassword(karel, "spatne", "nove-heslo-1", keep)).error);
  assert((await accounts.changePassword(karel, "heslo-1234", "krátké", keep)).error);
  assert(!(await accounts.changePassword(karel, "heslo-1234", "nove-heslo-1", keep)).error);
  assert.strictEqual(accounts.userFromToken(keep), karel, "aktuální relace přežije změnu hesla");
  assert.strictEqual(accounts.userFromToken(drop), null, "ostatní relace se zruší");
  assert((await accounts.login("Karel", "heslo-1234", "1.1.1.1")).error);
  assert((await accounts.login("Karel", "nove-heslo-1", "1.1.1.1")).user);

  // přihlášení přes poskytovatele
  const g1 = accounts.loginWithProvider("google", { id: "g-1", email: "novy@example.com", emailVerified: true, name: "Žluťoučký Kůň" });
  assert(g1.created && g1.user.name === "Zlutoucky Kun" && g1.user.email === "novy@example.com");
  assert.strictEqual(g1.user.passHash, null, "účet z poskytovatele nemá heslo");
  const g2 = accounts.loginWithProvider("google", { id: "g-1", email: "novy@example.com", emailVerified: true, name: "Jiné jméno" });
  assert(!g2.created && g2.user === g1.user, "stejná identita je stejný účet");

  const imposter = accounts.loginWithProvider("facebook", { id: "f-1", name: "Jurek" });
  assert(/^Jurek\d+$/.test(imposter.user.name) && imposter.user.role === "user", "jméno admina se nezíská ani přes Facebook");
  assert.strictEqual(imposter.user.email, null);

  const unverified = accounts.loginWithProvider("google", { id: "g-2", email: ADMIN_EMAIL, emailVerified: false, name: "Neověřený" });
  assert(unverified.created && unverified.user.role === "user" && unverified.user.email === null, "neověřený e-mail admina nic neotevře");

  const adminGoogle = accounts.loginWithProvider("google", { id: "g-3", email: ADMIN_EMAIL, emailVerified: true, name: "Jiří" });
  assert(!adminGoogle.created && adminGoogle.user.role === "admin" && adminGoogle.user.google === "g-3", "ověřený Google e-mail se propojí s adminem");
  assert.strictEqual(accounts.loginWithProvider("google", { id: "g-3", name: "x" }).user.role, "admin");

  const sameEmail = accounts.loginWithProvider("google", { id: "g-4", email: "karel@example.com", emailVerified: true, name: "Karel" });
  assert(sameEmail.created && sameEmail.user !== karel && sameEmail.user.email === null && karel.google === null, "účet s heslem se přes e-mail nepřevezme");
  assert(accounts.loginWithProvider("twitter", { id: "1" }).error, "neznámý poskytovatel");

  // správa hráčů adminem
  const admin = seed.user;
  assert(/Na vlastním účtu/.test(accounts.setBanned(admin, admin.id, true).error));
  assert(/Na vlastním účtu/.test(accounts.setRole(admin, admin.id, "user").error));
  assert(/Na vlastním účtu/.test(accounts.deleteUser(admin, admin.id).error));
  assert(accounts.setBanned(admin, 9999, true).error);

  accounts.createSession(karel);
  assert.strictEqual(accounts.setBanned(admin, karel.id, true, "spam").user.banned.reason, "spam");
  assert(/zablokovaný: spam/.test((await accounts.login("Karel", "nove-heslo-1", "1.1.1.1")).error));
  assert(!Object.values(store.data.sessions).some(s => s.userId === karel.id), "ban ruší relace");
  assert.strictEqual(accounts.setBanned(admin, karel.id, false).user.banned, null);

  assert.strictEqual(accounts.setRole(admin, karel.id, "admin").user.role, "admin");
  assert(/zbav role/.test(accounts.setBanned(admin, karel.id, true).error), "admina nejde zablokovat bez odebrání role");
  assert(/zbav role/.test(accounts.deleteUser(admin, karel.id).error));
  assert(accounts.setRole(admin, karel.id, "superadmin").error);
  assert.strictEqual(accounts.setRole(admin, karel.id, "user").user.role, "user");

  const reset = await accounts.resetPassword(admin, karel.id);
  assert.strictEqual(reset.password.length, 16);
  assert((await accounts.login("Karel", "nove-heslo-1", "1.1.1.1")).error);
  assert((await accounts.login("Karel", reset.password, "1.1.1.1")).user);

  const found = accounts.listUsers({ q: "zlutou" });
  assert.strictEqual(found.total, 1);
  assert(!JSON.stringify(found).includes("scrypt"), "výpis nikdy neobsahuje hash hesla");

  assert(accounts.deleteUser(admin, karel.id).user);
  assert.strictEqual(accounts.getUser(karel.id), null);
  assert((await accounts.register({ name: "Karel", email: "karel@example.com", password: "heslo-1234" }, "9.9.9.9")).user, "jméno a e-mail se uvolní");

  // statistiky
  const pat = (await accounts.register({ name: "Pat", email: "pat@example.com", password: "heslo-1234" }, "8.8.8.8")).user;
  const mat = (await accounts.register({ name: "Mat", email: "mat@example.com", password: "heslo-1234" }, "8.8.8.8")).user;
  const duel = (duration, winner, reason = "hq") => stats.record({
    map: "valley", duration, reason, winner,
    players: [
      { slot: 0, userId: pat.id, name: "Pat", ai: false, stats: { kills: 5, gold: 100, heroLevel: 3, trained: 4 } },
      { slot: 1, userId: mat.id, name: "Mat", ai: false, stats: { kills: 2, gold: 50 } }
    ]
  });

  assert.strictEqual(duel(MIN_DURATION - 1, 0), null, "příliš krátký zápas se nezapíše");
  assert(duel(120, 0));
  duel(90, -1);
  duel(60, -1, "abandoned");
  stats.record({
    map: "valley", duration: 100, reason: "hq", winner: 1,
    players: [{ slot: 0, userId: pat.id, name: "Pat", ai: false, stats: {} }, { slot: 1, userId: null, name: "AI Rudá", ai: true, stats: {} }]
  });

  const ps = pat.stats;
  assert.deepStrictEqual([ps.games, ps.wins, ps.draws, ps.losses], [4, 1, 1, 2]);
  assert.deepStrictEqual([ps.pvpGames, ps.pvpWins], [3, 1], "proti AI se do PvP nepočítá");
  assert.strictEqual(ps.kills, 15);
  assert.strictEqual(ps.gold, 300);
  assert.strictEqual(ps.heroLevel, 3);
  assert.strictEqual(ps.trained, 12);
  assert.strictEqual(ps.playSeconds, 120 + 90 + 60 + 100);
  assert.deepStrictEqual(ps.byMap.valley, { games: 4, wins: 1 });
  assert.deepStrictEqual([mat.stats.games, mat.stats.wins, mat.stats.losses, mat.stats.draws], [3, 0, 2, 1]);

  const recent = stats.recentFor(pat.id, 2);
  assert.strictEqual(recent.length, 2);
  assert.strictEqual(recent[0].result, "loss", "nejnovější první");
  assert.strictEqual(recent[0].pvp, false);
  assert.strictEqual(accounts.leaderboard()[0].name, "Pat");
  assert.deepStrictEqual(accounts.leaderboard({ q: "ma" }).map(p => p.name), ["Mat"]);

  // odehraný čas: multiplayer ze zápasů, hry proti AI a doba připojení; řazení a součty pro správce
  accounts.addAiTime(mat, 3600);
  accounts.addOnline(mat, 90.4);
  accounts.addOnline(mat, -5);
  const matView = accounts.adminView(mat);
  assert.strictEqual(matView.aiSeconds, 3600);
  assert.strictEqual(matView.onlineSeconds, 90);
  assert.strictEqual(matView.playSeconds, mat.stats.playSeconds);
  assert.strictEqual(accounts.listUsers({ sort: "played" }).users[0].name, "Mat", "hodina proti AI je víc než krátké zápasy");
  assert.strictEqual(accounts.listUsers({ sort: "online" }).users[0].name, "Mat");
  assert.strictEqual(accounts.listUsers({ sort: "constructor" }).users.length, accounts.listUsers().users.length, "neznámé řazení = podle registrace");
  const totals = accounts.counts();
  assert.strictEqual(totals.aiSeconds, 3600);
  assert.strictEqual(totals.playSeconds, Object.values(store.data.users).reduce((n, u) => n + u.stats.playSeconds, 0));
  assert.strictEqual(totals.onlineSeconds, 90);

  // síň slávy: body z bitev a turnajů zapsaných adminem
  const hall = createHallOfFame(store, accounts);
  const battle = (u, other) => u.stats.pvpWins * POINTS.pvpWin + other * POINTS.otherWin + u.stats.games * POINTS.game;
  let fame = hall.ranking();
  assert.deepStrictEqual(fame.map(p => p.name), ["Pat", "Mat"], "hráči bez bodů se nezobrazují");
  assert.strictEqual(fame[0].score, battle(pat, 0));
  assert.strictEqual(fame[1].score, battle(mat, 0));
  assert(!/scrypt|@|onlineSeconds/.test(JSON.stringify(fame)), "síň slávy obsahuje jen veřejné údaje");

  assert(/vítěze/.test(hall.addTournament(admin, { name: "Pohár", date: "2026-10-01", places: ["", "Pat"] }).error));
  assert(/Neznámí/.test(hall.addTournament(admin, { name: "Pohár", date: "2026-10-01", places: ["Nikdo"] }).error));
  assert(/datum/.test(hall.addTournament(admin, { name: "Pohár", date: "zítra", places: ["Mat"] }).error));
  const cup = hall.addTournament(admin, { name: "Podzimní pohár", date: "2026-10-01", places: ["mat", "Pat"], others: ["Karel", "PAT"] }).tournament;
  assert.deepStrictEqual(cup.entrants.map(e => [e.name, e.place]), [["Mat", 1], ["Pat", 2], ["Karel", 0]], "jména bez ohledu na velikost, bez duplicit");

  fame = hall.ranking();
  assert.deepStrictEqual(fame.map(p => p.name), ["Mat", "Pat", "Karel"], "turnaj posune vítěze nahoru");
  assert.strictEqual(fame[0].score, battle(mat, 0) + POINTS.place[0]);
  assert.strictEqual(fame[1].score, battle(pat, 0) + POINTS.place[1]);
  assert.strictEqual(fame[2].score, POINTS.entry);
  assert.deepStrictEqual(fame[0].medals, { gold: 1, silver: 0, bronze: 0, played: 1, points: POINTS.place[0] });
  assert(store.data.audit.some(a => a.action === "tournament-add"));

  assert(hall.deleteTournament(admin, cup.id).tournament);
  assert(hall.deleteTournament(admin, cup.id).error);
  assert.deepStrictEqual(hall.ranking().map(p => p.name), ["Pat", "Mat"]);

  // pořádání turnajů: plán, přihlášky, odpočet a uzavření výsledky
  const karel2 = Object.values(store.data.users).find(u => u.name === "Karel");
  const events = createEvents(store, accounts, { mapExists: id => id === "valley" });
  const T = Date.parse("2026-11-01T18:00:00Z");
  const before = T - 86400000;
  const plan = (body, at = before) => events.create(admin, { name: "Zimní pohár", start: T, map: "valley", format: "ko", maxPlayers: 2, ...body }, at);
  assert(/název/.test(plan({ name: "" }).error));
  assert(/minulosti/.test(plan({}, T + 3600000).error));
  assert(/mapa/i.test(plan({ map: "neni" }).error));
  assert(/Počet hráčů/.test(plan({ maxPlayers: 1 }).error));
  const cupEvent = plan({ format: "bogus", prize: "titul", description: "1 na 1", maxPlayers: 3 }).event;
  assert.strictEqual(cupEvent.format, "ko", "neznámý formát = vyřazovací");
  assert(store.data.audit.some(a => a.action === "event-create"));

  assert(events.join(pat, cupEvent.id, before).event);
  assert(events.join(pat, cupEvent.id, before).event, "druhé přihlášení nic nezmění");
  assert(events.join(mat, cupEvent.id, before).event);
  assert(events.join(karel2, cupEvent.id, before).event);
  assert(/plně obsazený/.test(events.join(admin, cupEvent.id, before).error));
  assert(/už začal/.test(events.leave(karel2, cupEvent.id, T + 1).error));
  assert(/Přihlášeno je už 3/.test(events.update(admin, cupEvent.id, { name: "Zimní pohár", start: T, maxPlayers: 2 }, before).error));
  assert(events.leave(mat, cupEvent.id, before).event);
  assert(/už začal/.test(events.join(mat, cupEvent.id, T + 1).error));

  const seen = events.upcoming(pat.id, before);
  assert.strictEqual(seen.length, 1);
  assert.deepStrictEqual(seen[0].players.map(p => p.name), ["Pat", "Karel"]);
  assert.strictEqual(seen[0].joined, true);
  assert.strictEqual(events.upcoming(mat.id, before)[0].joined, false);
  assert(!("by" in seen[0]), "veřejně se neukazuje, kdo turnaj založil");
  assert.strictEqual(events.upcoming(null, T + 3600000).length, 1, "probíhající turnaj se ukazuje dál");
  assert.strictEqual(events.upcoming(null, T + 4 * 3600000).length, 0, "po pár hodinách zmizí");

  assert(events.finish(cupEvent.id, 99));
  assert.strictEqual(events.upcoming(null, before).length, 0, "odehraný turnaj z menu zmizí");
  assert.strictEqual(events.listAdmin()[0].state, "done");
  const later = plan({ name: "Jarní pohár", start: T + 86400000 }).event;
  assert.strictEqual(events.listAdmin()[0].id, later.id, "naplánované jsou v adminu první");
  assert(events.cancel(admin, later.id).event);
  assert(events.cancel(admin, later.id).error);

  // trvalé uložení
  store.flush();
  const raw = fs.readFileSync(store.file, "utf8");
  assert(!raw.includes("heslo-1234") && !raw.includes(ADMIN_PASSWORD), "v databázi není heslo v čitelné podobě");
  if (process.platform !== "win32") assert.strictEqual(fs.statSync(store.file).mode & 0o077, 0, "soubor čte jen vlastník");

  const reopened = createAccounts(createStore(dir), { adminName: "Jurek", adminEmail: ADMIN_EMAIL });
  assert.strictEqual((await reopened.login("Pat", "heslo-1234", "7.7.7.7")).user.stats.games, 4);
  assert.strictEqual(await reopened.seedAdmin(), null, "admin přežije restart");

  fs.rmSync(dir, { recursive: true, force: true });
}

/* ---------- OAuth s podvrženým poskytovatelem ---------- */
async function testOAuth() {
  const dir = tmp("goralia-oauth-");
  const store = createStore(dir);
  const accounts = createAccounts(store, { adminName: "Jurek", adminEmail: ADMIN_EMAIL });

  process.env.GOOGLE_CLIENT_ID = "gid";
  process.env.GOOGLE_CLIENT_SECRET = "gsecret";
  delete process.env.FACEBOOK_APP_ID;
  delete process.env.FACEBOOK_APP_SECRET;

  const calls = [];
  let failToken = false;
  const warn = console.warn;
  console.warn = () => {}; // selžení poskytovatele se loguje, v testu je to účelově

  const fetchJson = async (url, options = {}) => {
    calls.push({ url, ...options });
    if (url.startsWith("https://oauth2.googleapis.com/token")) return failToken ? { status: 400, json: { error: "invalid_grant" } } : { status: 200, json: { access_token: "AT" } };
    if (url.startsWith("https://openidconnect.googleapis.com/")) return { status: 200, json: { sub: "sub-777", email: "oauth@example.com", email_verified: true, name: "Oauth User" } };
    return { status: 500, json: {} };
  };

  const oauth = createOAuth({
    accounts,
    publicUrl: "https://goralia.test/",
    startSession: (req, user) => `goralia_sid=${accounts.createSession(user)}; Path=/`,
    fetchJson
  });

  assert.deepStrictEqual(oauth.available(), { google: true, facebook: false });

  const call = pathAndQuery => withCookie(pathAndQuery);

  const withCookie = (pathAndQuery, cookie) => new Promise(resolve => {
    const [pathname, query] = pathAndQuery.split("?");
    const req = { method: "GET", headers: { host: "goralia.test", "x-forwarded-proto": "https", ...(cookie ? { cookie } : {}) }, socket: {} };
    const res = {
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end() { resolve({ status: this.status, headers: this.headers }); }
    };

    assert(oauth.handle(req, res, pathname, new URLSearchParams(query || "")), "cesta patří přihlášení");
  });

  async function begin() {
    const res = await call("/auth/google");
    assert.strictEqual(res.status, 302);
    const url = new URL(res.headers.Location);
    assert.strictEqual(`${url.origin}${url.pathname}`, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.strictEqual(url.searchParams.get("client_id"), "gid");
    assert.strictEqual(url.searchParams.get("redirect_uri"), "https://goralia.test/auth/google/callback");
    assert.strictEqual(url.searchParams.get("response_type"), "code");
    assert(url.searchParams.get("scope").includes("openid"));

    const state = url.searchParams.get("state");
    assert.strictEqual(state.length, 48);

    const setCookie = res.headers["Set-Cookie"];
    assert(setCookie.startsWith(`goralia_oauth=${state}`) && /HttpOnly/.test(setCookie) && /SameSite=Lax/.test(setCookie) && /Secure/.test(setCookie), setCookie);
    return state;
  }

  assert.strictEqual((await call("/auth/facebook")).headers.Location, "/play?login=unavailable", "nenastavený poskytovatel");

  // státní ochrana proti podvržení: špatný state, cizí cookie, odmítnutí
  assert.strictEqual((await withCookie("/auth/google/callback?code=abc&state=zle", "goralia_oauth=zle")).headers.Location, "/play?login=failed");

  let state = await begin();
  assert.strictEqual((await withCookie(`/auth/google/callback?code=abc&state=${state}`, "goralia_oauth=jiny")).headers.Location, "/play?login=failed", "cookie nesedí se state");

  state = await begin();
  assert.strictEqual((await withCookie(`/auth/google/callback?error=access_denied&state=${state}`, `goralia_oauth=${state}`)).headers.Location, "/play?login=denied");
  assert.strictEqual(calls.length, 0, "bez platného state se poskytovatel nevolá");

  // úspěšné přihlášení založí účet a relaci
  state = await begin();
  const first = await withCookie(`/auth/google/callback?code=THECODE&state=${state}`, `goralia_oauth=${state}`);
  assert.strictEqual(first.headers.Location, "/play?login=new");
  const cookies = [].concat(first.headers["Set-Cookie"]);
  assert(cookies.some(c => c.startsWith("goralia_oauth=;") && /Max-Age=0/.test(c)), "state cookie se smaže");
  const sid = cookies.find(c => c.startsWith("goralia_sid="));
  assert(sid, "vznikla relace");
  assert.strictEqual(accounts.userFromToken(sid.split(";")[0].split("=")[1]).google, "sub-777");

  const exchange = calls[0];
  assert.strictEqual(exchange.method, "POST");
  assert(exchange.body.includes("code=THECODE") && exchange.body.includes("client_secret=gsecret") && exchange.body.includes(encodeURIComponent("https://goralia.test/auth/google/callback")), exchange.body);
  assert.strictEqual(calls[1].headers.Authorization, "Bearer AT");

  assert.strictEqual((await withCookie(`/auth/google/callback?code=THECODE&state=${state}`, `goralia_oauth=${state}`)).headers.Location, "/play?login=failed", "state jde použít jen jednou");

  state = await begin();
  assert.strictEqual((await withCookie(`/auth/google/callback?code=X&state=${state}`, `goralia_oauth=${state}`)).headers.Location, "/play?login=ok", "druhé přihlášení už je do existujícího účtu");
  assert.strictEqual(accounts.counts().users, 1);

  state = await begin();
  failToken = true;
  assert.strictEqual((await withCookie(`/auth/google/callback?code=X&state=${state}`, `goralia_oauth=${state}`)).headers.Location, "/play?login=failed", "poskytovatel odmítl kód");
  failToken = false;
  console.warn = warn;

  accounts.getUser(1).banned = { at: Date.now(), reason: "" };
  state = await begin();
  assert.strictEqual((await withCookie(`/auth/google/callback?code=X&state=${state}`, `goralia_oauth=${state}`)).headers.Location, "/play?login=banned");

  fs.rmSync(dir, { recursive: true, force: true });
}

/* ---------- HTTP API spuštěného serveru ---------- */
const PORT = 3600 + Math.floor(Math.random() * 300);

function request(method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body);
    const req = http.request({ host: "localhost", port: PORT, path: p, method, headers: { "Content-Type": "application/json", ...(data === null ? {} : { "Content-Length": Buffer.byteLength(data) }), ...headers } }, res => {
      let text = "";
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* není JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    req.end(data);
  });
}

function socket(cookie) {
  const ws = new WebSocket(`ws://localhost:${PORT}`, { headers: cookie ? { Cookie: cookie } : {} });
  const s = { ws, hello: null, errors: [], room: null, closed: false };
  ws.on("message", data => {
    const m = JSON.parse(data);
    if (m.t === "hello") s.hello = m;
    if (m.t === "error") s.errors.push(m.text);
    if (m.t === "room") s.room = m;
  });
  ws.on("close", () => { s.closed = true; });
  return s;
}

async function until(fn, label, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return;
    await sleep(25);
  }
  throw new Error(`Timeout: ${label}`);
}

async function testServerApi() {
  const dataDir = tmp("goralia-api-");
  const proc = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: {
      ...process.env,
      GORALIA_ENV_FILE: "",
      PORT: String(PORT),
      GORALIA_DATA_DIR: dataDir,
      GORALIA_MAPS_DIR: (() => { const d = tmp("goralia-maps-"); fs.copyFileSync(path.join(__dirname, "..", "maps", "valley.json"), path.join(d, "valley.json")); return d; })(),
      GORALIA_ADMIN_PASSWORD: ADMIN_PASSWORD,
      PUBLIC_URL: `http://localhost:${PORT}`,
      GOOGLE_CLIENT_ID: "gid",
      GOOGLE_CLIENT_SECRET: "gsecret",
      FACEBOOK_APP_ID: "fid",
      FACEBOOK_APP_SECRET: "fsecret"
    },
    stdio: ["ignore", "pipe", "inherit"]
  });

  const sockets = [];
  const open = cookie => {
    const s = socket(cookie);
    sockets.push(s);
    return s;
  };

  try {
    await new Promise(resolve => {
      let out = "";
      proc.stdout.on("data", chunk => {
        out += chunk;
        if (out.includes("běží na")) resolve();
      });
    });

    const cookieOf = res => res.headers["set-cookie"][0].split(";")[0];
    const register = async (name, extra = {}) => {
      const res = await request("POST", "/api/auth/register", { name, email: `${name.toLowerCase()}@example.com`, password: "heslo-1234", ...extra });
      assert.strictEqual(res.status, 200, `${name}: ${res.text}`);
      return { res, cookie: cookieOf(res), id: res.json.user.id };
    };
    const as = cookie => ({ Cookie: cookie });

    // stránky: panel serveru nevidí nikdo kromě admina
    assert.strictEqual((await request("GET", "/admin")).status, 404);
    assert.strictEqual((await request("GET", "/admin.html")).status, 404);
    assert.strictEqual((await request("GET", "/js/admin.js")).status, 200);
    assert.strictEqual((await request("GET", "/")).headers["x-frame-options"], "DENY");

    // úvodní stránka webu je na /, samotná hra na /play
    assert.ok((await request("GET", "/")).text.includes('href="/play"'), "úvod odkazuje do hry");
    assert.ok((await request("GET", "/play")).text.includes('id="game"'), "na /play běží hra");
    assert.strictEqual((await request("GET", "/index.html")).status, 200, "staré odkazy na hru fungují dál");
    const slash = await request("GET", "/play/?server=x");
    assert.strictEqual(slash.status, 302);
    assert.strictEqual(slash.headers.location, "/play?server=x", "lomítko na konci by rozbilo relativní cesty hry");
    const part = await request("GET", "/assets/web/hero.mp4", undefined, { Range: "bytes=0-9" });
    assert.strictEqual(part.status, 206, "video jde stahovat po částech (Safari)");
    assert.strictEqual(part.headers["content-type"], "video/mp4");
    assert.ok(/^bytes 0-9\/\d+$/.test(part.headers["content-range"]));

    const anon = await request("GET", "/api/me");
    assert.deepStrictEqual(anon.json, { user: null, canEditMaps: true, providers: { google: true, facebook: true } });
    assert.strictEqual((await request("GET", "/api/neexistuje")).status, 404);
    assert.strictEqual((await request("PUT", "/api/me")).status, 405);

    // registrace a cookie
    const eve = await register("Eve");
    const flags = eve.res.headers["set-cookie"][0];
    assert(/HttpOnly/.test(flags) && /SameSite=Lax/.test(flags) && /Path=\//.test(flags) && !/Secure/.test(flags), flags);
    assert(!JSON.stringify(eve.res.json).includes("scrypt"));

    const proxied = await request("POST", "/api/auth/login", { identifier: "eve@example.com", password: "heslo-1234" }, { "X-Forwarded-Proto": "https" });
    assert(/Secure/.test(proxied.headers["set-cookie"][0]), "za HTTPS proxy je cookie Secure");

    const me = await request("GET", "/api/me", undefined, as(eve.cookie));
    assert.strictEqual(me.json.user.name, "Eve");
    assert.strictEqual(me.json.user.role, "user");
    assert(!me.text.includes("scrypt") && !me.text.includes("passHash"));

    // ochrana: cizí Origin, špatný typ obsahu, neplatný a obří JSON
    const evil = await request("POST", "/api/auth/register", { name: "Evil", email: "evil@example.com", password: "heslo-1234" }, { Origin: "http://evil.example" });
    assert.strictEqual(evil.status, 403);
    assert.strictEqual((await request("POST", "/api/auth/login", {}, { "Content-Type": "text/plain" })).status, 415);
    assert.strictEqual((await request("POST", "/api/auth/login", "{nejson")).status, 400);
    assert.strictEqual((await request("POST", "/api/auth/login", JSON.stringify({ identifier: "x".repeat(40000) }))).status, 413);
    assert.strictEqual((await request("POST", "/api/auth/login", { identifier: "Eve", password: "heslo-1234" }, { Origin: `http://localhost:${PORT}` })).status, 200, "vlastní Origin projde");
    assert.strictEqual((await request("POST", "/api/me/name", { name: "Evil" }, { Origin: "http://evil.example", ...as(eve.cookie) })).status, 403, "změna účtu z cizí stránky");

    // přihlášení: špatné heslo, rezervace jména, omezení pokusů
    assert.strictEqual((await request("POST", "/api/auth/login", { identifier: "Eve", password: "spatne" })).status, 401);
    assert.strictEqual((await request("POST", "/api/auth/register", { name: "Jurek", email: "x@example.com", password: "heslo-1234" })).status, 400, "jméno admina je rezervované");
    assert.strictEqual((await request("POST", "/api/auth/register", { name: "Zkus", email: ADMIN_EMAIL, password: "heslo-1234" })).status, 400, "e-mail admina je rezervovaný");

    let limited = 0;
    for (let i = 0; i < 10; i++) if ((await request("POST", "/api/auth/login", { identifier: "NoSuchUser", password: "x" })).status === 429) limited++;
    assert(limited >= 2, "po 8 neúspěších je 429");

    // přezdívka a heslo
    assert.strictEqual((await request("POST", "/api/me/name", { name: "Frank" })).status, 401, "bez přihlášení");
    const frank = await register("Frank");
    assert.strictEqual((await request("POST", "/api/me/name", { name: "Frank" }, as(eve.cookie))).status, 400, "jméno je obsazené");
    const renamed = await request("POST", "/api/me/name", { name: "Eve2" }, as(eve.cookie));
    assert.strictEqual(renamed.json.user.name, "Eve2");
    assert.strictEqual((await request("POST", "/api/me/name", { name: "Eve3" }, as(eve.cookie))).status, 400, "jen jednou za hodinu");

    const second = cookieOf(await request("POST", "/api/auth/login", { identifier: "Eve2", password: "heslo-1234" }));
    assert.strictEqual((await request("POST", "/api/me/password", { current: "spatne", next: "nove-heslo-9" }, as(eve.cookie))).status, 400);
    assert.strictEqual((await request("POST", "/api/me/password", { current: "heslo-1234", next: "nove-heslo-9" }, as(eve.cookie))).status, 200);
    assert.strictEqual((await request("GET", "/api/me", undefined, as(second))).json.user, null, "ostatní zařízení se odhlásí");
    assert.strictEqual((await request("GET", "/api/me", undefined, as(eve.cookie))).json.user.name, "Eve2");
    assert.strictEqual((await request("POST", "/api/auth/login", { identifier: "Eve2", password: "heslo-1234" })).status, 401);

    // profily a hledání
    const found = await request("GET", "/api/players?q=eve");
    assert.deepStrictEqual(found.json.players.map(p => p.name), ["Eve2"]);
    const everyone = (await request("GET", "/api/players")).json.players;
    assert(everyone.some(p => p.name === "Eve2"), "výpis obsahuje i hráče bez odehraných her");
    const profile = await request("GET", `/api/players/${eve.id}`);
    assert.strictEqual(profile.json.player.stats.games, 0);
    assert(!profile.text.includes("@") && profile.json.player.banned === undefined);
    assert.strictEqual((await request("GET", "/api/players/99999")).status, 404);
    assert.strictEqual((await request("GET", "/api/players/abc")).status, 404);

    // přihlášení přes poskytovatele: přesměrování, ochrana state
    const google = await new Promise((resolve, reject) => {
      http.get({ host: "localhost", port: PORT, path: "/auth/google" }, res => { res.resume(); resolve(res); }).on("error", reject);
    });
    assert.strictEqual(google.statusCode, 302);
    const target = new URL(google.headers.location);
    assert.strictEqual(target.host, "accounts.google.com");
    assert.strictEqual(target.searchParams.get("redirect_uri"), `http://localhost:${PORT}/auth/google/callback`);
    assert(/^goralia_oauth=[0-9a-f]{48}/.test(google.headers["set-cookie"][0]));
    const forged = await new Promise((resolve, reject) => {
      http.get({ host: "localhost", port: PORT, path: "/auth/google/callback?code=x&state=zle" }, res => { res.resume(); resolve(res); }).on("error", reject);
    });
    assert.strictEqual(forged.headers.location, "/play?login=failed");

    /* ----- administrace ----- */
    assert.strictEqual((await request("GET", "/api/admin/overview")).status, 401);
    assert.strictEqual((await request("GET", "/api/admin/overview", undefined, as(eve.cookie))).status, 403);
    assert.strictEqual((await request("GET", "/admin", undefined, as(eve.cookie))).status, 404, "běžný hráč panel nevidí");

    const adminLogin = await request("POST", "/api/auth/login", { identifier: "Jurek", password: ADMIN_PASSWORD });
    assert.strictEqual(adminLogin.status, 200);
    assert.strictEqual(adminLogin.json.user.role, "admin");
    const adminCookie = cookieOf(adminLogin);
    const admin = as(adminCookie);
    assert.strictEqual((await request("POST", "/api/auth/login", { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD })).status, 200, "admin se přihlásí i e-mailem");

    const page = await request("GET", "/admin", undefined, admin);
    assert.strictEqual(page.status, 200);
    assert(page.text.includes("Server panel"));
    assert.strictEqual(page.headers["cache-control"], "no-store");
    assert.strictEqual((await request("GET", "/admin.html/", undefined, admin)).status, 404);

    const overview = (await request("GET", "/api/admin/overview", undefined, admin)).json;
    assert(overview.users >= 3 && overview.admins === 1 && overview.providers.google === true);

    const listed = (await request("GET", "/api/admin/users?q=eve", undefined, admin)).json;
    assert.strictEqual(listed.total, 1);
    assert(!JSON.stringify(listed).includes("scrypt"));

    // čas her proti AI: konec bez startu se nepočítá, jinak nejvýš skutečně uplynulá doba
    const beacon = body => request("POST", "/api/beacon", body, as(eve.cookie));
    const eveAi = async () => (await request("GET", "/api/admin/users?q=eve", undefined, admin)).json.users[0].aiSeconds;
    assert.strictEqual((await beacon({ e: "end", result: "win", duration: 600 })).status, 200);
    assert.strictEqual(await eveAi(), 0, "konec bez startu");
    await beacon({ e: "start" });
    await beacon({ e: "end", result: "win", duration: 99999 });
    const ai = await eveAi();
    assert(ai >= 5 && ai <= 7, `podvržená délka se ořízne na uplynulý čas (${ai})`);
    assert.strictEqual((await request("GET", "/api/admin/users?sort=played", undefined, admin)).json.users[0].name, "Eve2");
    assert.strictEqual((await request("GET", "/api/admin/overview", undefined, admin)).json.aiSeconds, ai);

    // zablokování odpojí hráče, zruší relace a zabrání přihlášení
    const eveSocket = open(eve.cookie);
    await until(() => eveSocket.hello, "hello");
    assert.strictEqual(eveSocket.hello.me.name, "Eve2");

    const ban = await request("POST", `/api/admin/users/${eve.id}/ban`, { banned: true, reason: "test" }, admin);
    assert.strictEqual(ban.status, 200);
    await until(() => eveSocket.closed, "odpojení zablokovaného hráče");
    assert(eveSocket.errors.some(e => /zablokován/.test(e)));
    assert.strictEqual((await request("GET", "/api/me", undefined, as(eve.cookie))).json.user, null);
    const denied = await request("POST", "/api/auth/login", { identifier: "Eve2", password: "nove-heslo-9" });
    assert(denied.status === 401 && /zablokovaný: test/.test(denied.json.error));
    assert.strictEqual((await request("POST", `/api/admin/users/${eve.id}/ban`, { banned: false }, admin)).status, 200);
    const eveBack = cookieOf(await request("POST", "/api/auth/login", { identifier: "Eve2", password: "nove-heslo-9" }));

    // role: druhý admin, ochrana před sebepoškozením a před zablokováním admina
    assert.strictEqual((await request("POST", `/api/admin/users/${frank.id}/role`, { role: "admin" }, admin)).status, 200);
    assert.strictEqual((await request("GET", "/api/admin/overview", undefined, as(frank.cookie))).status, 200);
    assert.strictEqual((await request("POST", `/api/admin/users/${frank.id}/ban`, { banned: true }, admin)).status, 400, "admina nejde zablokovat");
    assert.strictEqual((await request("DELETE", `/api/admin/users/${frank.id}`, {}, admin)).status, 400, "admina nejde smazat");
    assert.strictEqual((await request("POST", `/api/admin/users/${adminLogin.json.user.id}/ban`, { banned: true }, admin)).status, 400, "sám sebe");
    assert.strictEqual((await request("POST", `/api/admin/users/${adminLogin.json.user.id}/role`, { role: "user" }, admin)).status, 400, "sám sobě");
    assert.strictEqual((await request("POST", `/api/admin/users/${frank.id}/role`, { role: "bogus" }, admin)).status, 400);
    assert.strictEqual((await request("POST", `/api/admin/users/${frank.id}/role`, { role: "user" }, admin)).status, 200);
    assert.strictEqual((await request("GET", "/api/admin/overview", undefined, as(frank.cookie))).status, 403, "po odebrání role už ne");

    // změna admina přes jeho vlastní účet nemění cizí práva
    assert.strictEqual((await request("POST", `/api/admin/users/${frank.id}/role`, { role: "user" }, as(eveBack))).status, 403);

    // nové heslo
    const reset = await request("POST", `/api/admin/users/${frank.id}/password`, {}, admin);
    assert.strictEqual(reset.json.password.length, 16);
    assert.strictEqual((await request("POST", "/api/auth/login", { identifier: "Frank", password: "heslo-1234" })).status, 401);
    assert.strictEqual((await request("POST", "/api/auth/login", { identifier: "Frank", password: reset.json.password })).status, 200);

    // místnosti a připojení: admin je vidí a může zavřít / odpojit
    const eveWs = open(eveBack);
    await until(() => eveWs.hello, "Eve online");
    eveWs.ws.send(JSON.stringify({ t: "create", map: "valley" }));
    await until(() => eveWs.room, "místnost");

    const rooms = (await request("GET", "/api/admin/rooms", undefined, admin)).json.rooms;
    assert.strictEqual(rooms.length, 1);
    assert.deepStrictEqual([rooms[0].host, rooms[0].players], ["Eve2", ["Eve2"]]);

    const clients = (await request("GET", "/api/admin/clients", undefined, admin)).json.clients;
    assert(clients.some(c => c.name === "Eve2" && c.room === rooms[0].id));

    const guest = open();
    await until(() => guest.hello, "host");
    const guestId = (await request("GET", "/api/admin/clients", undefined, admin)).json.clients.find(c => c.userId === null).id;
    assert.strictEqual((await request("POST", `/api/admin/clients/${guestId}/kick`, {}, admin)).status, 200);
    await until(() => guest.closed, "odpojení klienta");
    assert.strictEqual((await request("POST", "/api/admin/clients/99999/kick", {}, admin)).status, 404);

    assert.strictEqual((await request("POST", `/api/admin/rooms/${rooms[0].id}/close`, {}, admin)).status, 200);
    await until(() => eveWs.closed, "zavření místnosti");
    assert.deepStrictEqual((await request("GET", "/api/admin/rooms", undefined, admin)).json.rooms, []);
    assert.strictEqual((await request("POST", `/api/admin/rooms/${rooms[0].id}/close`, {}, admin)).status, 404);

    // smazání účtu
    assert.strictEqual((await request("DELETE", `/api/admin/users/${frank.id}`, {}, admin)).status, 200);
    assert.strictEqual((await request("GET", `/api/players/${frank.id}`)).status, 404);
    assert.strictEqual((await request("GET", "/api/me", undefined, as(frank.cookie))).json.user, null);

    // síň slávy (veřejná) a turnaje (zapisuje admin) přes API
    assert.strictEqual((await request("GET", "/api/admin/tournaments", undefined, as(eveBack))).status, 403);
    assert.strictEqual((await request("POST", "/api/admin/tournaments", { name: "Pohár", date: "2026-10-01", places: ["Eve2"] }, as(eveBack))).status, 403);
    assert.strictEqual((await request("POST", "/api/admin/tournaments", { name: "Pohár", date: "2026-10-01", places: ["Nikdo"] }, admin)).status, 400);
    const cup = await request("POST", "/api/admin/tournaments", { name: "Pohár", date: "2026-10-01", places: ["Eve2"] }, admin);
    assert.strictEqual(cup.status, 200);
    assert.strictEqual((await request("GET", "/api/admin/tournaments", undefined, admin)).json.tournaments[0].by, "Jurek");
    const hall = await request("GET", "/api/halloffame");
    assert.strictEqual(hall.status, 200, "síň slávy vidí i nepřihlášený");
    assert.strictEqual(hall.json.players[0].name, "Eve2");
    assert.strictEqual(hall.json.players[0].medals.gold, 1);
    assert.strictEqual(typeof hall.json.players[0].online, "boolean");
    assert.strictEqual(hall.json.tournaments[0].name, "Pohár");
    for (const secret of ["@", "onlineSeconds", "email", "lastLogin", "\"by\"", "scrypt"]) assert(!hall.text.includes(secret), `síň slávy neprozradí ${secret}`);
    assert.strictEqual((await request("DELETE", `/api/admin/tournaments/${cup.json.tournament.id}`, {}, admin)).status, 200);
    assert.strictEqual((await request("DELETE", `/api/admin/tournaments/${cup.json.tournament.id}`, {}, admin)).status, 404);

    // pořádání turnajů přes API
    const start = Date.now() + 86400000;
    assert.strictEqual((await request("POST", "/api/admin/events", { name: "Pohár", start, maxPlayers: 8 }, as(eveBack))).status, 403);
    assert.strictEqual((await request("POST", "/api/admin/events", { name: "Pohár", start, maxPlayers: 8, map: "neexistuje" }, admin)).status, 400);
    const planned = await request("POST", "/api/admin/events", { name: "Pohár", start, maxPlayers: 8, prize: "titul" }, admin);
    assert.strictEqual(planned.status, 200);
    const evId = planned.json.event.id;
    assert.strictEqual((await request("POST", `/api/events/${evId}/join`, {})).status, 401, "přihlásit se do turnaje jde jen s účtem");
    const joined = await request("POST", `/api/events/${evId}/join`, {}, as(eveBack));
    assert.strictEqual(joined.status, 200);
    assert.strictEqual(joined.json.events[0].joined, true);
    const pub = await request("GET", "/api/events");
    assert.strictEqual(pub.json.events[0].name, "Pohár");
    assert.deepStrictEqual(pub.json.events[0].players.map(p => p.name), ["Eve2"]);
    assert(typeof pub.json.now === "number", "serverový čas pro přesný odpočet");
    assert(!pub.text.includes("Jurek"), "veřejně bez autora");
    assert.strictEqual((await request("POST", `/api/admin/events/${evId}`, { name: "Velký pohár", start, maxPlayers: 4 }, admin)).json.event.name, "Velký pohár");
    const closed = await request("POST", "/api/admin/tournaments", { name: "Velký pohár", date: start, places: ["Eve2"], eventId: evId }, admin);
    assert.strictEqual(closed.status, 200);
    assert.strictEqual((await request("GET", "/api/events")).json.events.length, 0, "po zápisu výsledků turnaj z menu zmizí");
    assert.strictEqual((await request("GET", "/api/admin/events", undefined, admin)).json.events[0].tournamentId, closed.json.tournament.id);
    assert.strictEqual((await request("POST", "/api/admin/tournaments", { name: "Znovu", date: start, places: ["Eve2"], eventId: evId }, admin)).status, 400, "výsledky jen jednou");
    assert.strictEqual((await request("DELETE", `/api/admin/events/${evId}`, {}, admin)).status, 200);
    await request("DELETE", `/api/admin/tournaments/${closed.json.tournament.id}`, {}, admin);

    // záznam akcí
    const audit = (await request("GET", "/api/admin/audit", undefined, admin)).json.audit.map(a => a.action);
    for (const action of ["ban", "unban", "role", "password-reset", "delete", "kick", "close-room", "tournament-add", "tournament-delete", "event-create", "event-update", "event-cancel"]) assert(audit.includes(action), `v záznamu chybí ${action}`);
    assert.strictEqual((await request("GET", "/api/admin/matches", undefined, admin)).status, 200);

    // odhlášení
    assert.strictEqual((await request("POST", "/api/auth/logout", {}, admin)).status, 200);
    assert.strictEqual((await request("GET", "/api/admin/overview", undefined, admin)).status, 401);
    assert.strictEqual((await request("GET", "/admin", undefined, admin)).status, 404);

    // účty přežijí restart serveru
    proc.kill("SIGTERM");
    await new Promise(resolve => proc.once("exit", resolve));
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, "db.json"), "utf8"));
    assert(Object.values(saved.users).some(u => u.name === "Jurek" && u.role === "admin"));
    assert(Object.values(saved.users).some(u => u.name === "Eve2"));
    assert(Object.values(saved.users).find(u => u.name === "Eve2").onlineSeconds > 0, "doba připojení se uloží po odpojení");
  } finally {
    for (const s of sockets) s.ws.terminate();
    // počkat na skutečné ukončení serveru, jinak ještě zapisuje do mazané složky
    if (proc.exitCode === null && proc.signalCode === null) {
      const exited = new Promise(resolve => proc.once("exit", resolve));
      proc.kill();
      await exited;
    }
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
  }
}

async function main() {
  await testAccounts();
  await testScoring();
  await testOAuth();
  await testServerApi();
  console.log("OK: všechny testy účtů prošly");
}

main().then(() => process.exit(0), err => {
  console.error(err);
  process.exit(1);
});
