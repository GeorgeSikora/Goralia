/*
 * Testy denních a týdenních výzev (server/challenges.js): pražská půlnoc a pondělí, losování,
 * postup ze statistik zápasu, odměny, výběr vzhledu a administrace.
 * Spuštění: node server/test-challenges.js (součástí `npm test`)
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createStore } = require("./store.js");
const { createAccounts } = require("./accounts.js");
const { createStats, newStats } = require("./stats.js");
const { createChallenges, periodInfo, BUILTIN } = require("./challenges.js");
const COS = require("../js/cosmetics.js");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "goralia-ch-"));

function testTime() {
  // 5. 11. 2026 21:30 v Praze (zimní čas, UTC+1) = 20:30 UTC
  const t = Date.UTC(2026, 10, 5, 20, 30);
  const d = periodInfo("daily", t);
  assert.strictEqual(d.key, "2026-11-05");
  assert.strictEqual(d.resetsAt, Date.UTC(2026, 10, 5, 23, 0), "denní reset o pražské půlnoci");
  const w = periodInfo("weekly", t);
  assert.strictEqual(w.key, "2026-11-02", "týden začíná pondělím");
  assert.strictEqual(w.resetsAt, Date.UTC(2026, 10, 8, 23, 0), "týdenní reset v pondělí 0:00");

  // těsně po půlnoci už je nový den
  assert.strictEqual(periodInfo("daily", Date.UTC(2026, 10, 5, 23, 0, 1)).key, "2026-11-06");
  // letní čas (UTC+2) a přechod na zimní v noci na 25. 10. 2026
  assert.strictEqual(periodInfo("daily", Date.UTC(2026, 6, 1, 22, 30)).key, "2026-07-02");
  assert.strictEqual(periodInfo("daily", Date.UTC(2026, 9, 24, 12)).resetsAt, Date.UTC(2026, 9, 24, 22, 0));
  assert.strictEqual(periodInfo("daily", Date.UTC(2026, 9, 25, 12)).resetsAt, Date.UTC(2026, 9, 25, 23, 0));
  // neděle večer patří ještě do týdne od pondělí
  assert.strictEqual(periodInfo("weekly", Date.UTC(2026, 10, 8, 22, 59)).key, "2026-11-02");
  assert.strictEqual(periodInfo("weekly", Date.UTC(2026, 10, 8, 23, 1)).key, "2026-11-09");
}

function setup() {
  const store = createStore(tmp());
  const accounts = createAccounts(store, {});
  // uživatele vložíme přímo (stejný tvar jako z accounts.js)
  const users = ["Ana", "Bob", "Cyril"].map((name, i) => {
    const id = i + 1;
    store.data.users[id] = { id, name, role: "user", stats: newStats(), created: 0 };
    return store.data.users[id];
  });
  return { store, accounts, users };
}

function testDrawAndProgress() {
  const { store, accounts, users } = setup();
  const ch = createChallenges(store, accounts);
  const C = store.data.challenges;

  assert.strictEqual(C.daily.picks.length, 3, "3 denní výzvy");
  assert.strictEqual(C.weekly.picks.length, 2, "2 týdenní výzvy");
  for (const p of C.daily.picks) assert.strictEqual(COS.get(p.reward).rarity, "common");
  for (const p of C.weekly.picks) assert.strictEqual(COS.get(p.reward).rarity, "rare");
  assert.strictEqual(new Set(C.daily.picks.map(p => p.reward)).size, 3, "odměny se neopakují");
  assert.strictEqual(new Set(C.daily.picks.map(p => `${p.tpl.metric}|${p.tpl.unit}`)).size, 3, "každá výzva měří něco jiného");

  // zítra se losuje znovu a jinak
  const today = C.daily.picks.map(p => p.id);
  const tomorrow = Date.now() + 24 * 3600 * 1000;
  assert.strictEqual(ch.ensure(tomorrow), true);
  assert(C.daily.picks.every(p => !today.includes(p.id)), "nové výzvy jsou jiné než včera");

  // pevně dané výzvy pro test postupu
  const tpl = id => {
    const t = BUILTIN.find(b => b.id === id);
    return { scope: "sum", win: false, maxMinutes: 0, mode: "any", unit: "", ...t };
  };
  C.daily.picks = [
    { id: "d-vyhry2", tpl: tpl("d-vyhry2"), reward: "flag-pruh", done: 0 },
    { id: "d-katapulty3", tpl: tpl("d-katapulty3"), reward: "title-gorol", done: 0 },
    { id: "d-rychle10", tpl: tpl("d-rychle10"), reward: "frame-drevo", done: 0 }
  ];
  C.weekly.picks = [
    { id: "w-nemrtvi50", tpl: tpl("w-nemrtvi50"), reward: "color-karmin", done: 0 },
    { id: "w-lide3", tpl: tpl("w-lide3"), reward: "flag-lebka", done: 0 }
  ];
  C.daily.at = C.weekly.at = 1;
  const now = Date.now() + 24 * 3600 * 1000;

  const stats = createStats(store);
  const play = (players, extra = {}) => {
    const m = stats.record({
      map: "duel", duration: extra.duration || 900, reason: "hq", winner: 0, coop: !!extra.coop,
      players: players.map((p, slot) => ({ slot, userId: p.user ? p.user.id : null, name: p.user ? p.user.name : "AI", ai: !p.user, stats: p.stats || {} }))
    });
    return ch.onMatch(m, now);
  };

  // Ana vyhraje proti AI za 15 minut a postaví 2 katapulty: 1/2 výher, katapulty 2/3
  let done = play([{ user: users[0], stats: { trainedBy: { catapult: 2 }, trained: 2 } }, {}]);
  assert.deepStrictEqual(done, []);
  let v = ch.view(users[0], now);
  const prog = id => v.daily.list.concat(v.weekly.list).find(x => x.id === id);
  assert.strictEqual(prog("d-vyhry2").progress, 1);
  assert.strictEqual(prog("d-katapulty3").progress, 2);
  assert.strictEqual(prog("d-rychle10").progress, 0, "zápas trval přes 10 minut");

  // druhý zápas: 2 katapulty znovu (v jednom zápase, nesčítá se), výhra za 8 minut, 30 zabitých ghúlů
  done = play([{ user: users[0], stats: { trainedBy: { catapult: 2 }, kills: 30, killsBy: { ghoul: 20, skeleton: 10 } } }, {}], { duration: 480, coop: true });
  v = ch.view(users[0], now);
  assert.strictEqual(prog("d-katapulty3").progress, 2, "katapulty se počítají v jednom zápase");
  assert.strictEqual(prog("d-vyhry2").done, true);
  assert.strictEqual(prog("d-rychle10").done, true);
  assert.strictEqual(prog("w-nemrtvi50").progress, 30);
  assert.strictEqual(done.length, 1);
  assert.deepStrictEqual(done[0].done.map(d => d.id).sort(), ["d-rychle10", "d-vyhry2"]);
  const owned = Object.keys(users[0].cosmetics.owned).sort();
  assert.deepStrictEqual(owned, ["flag-pruh", "frame-drevo"], "odměny podle losování");

  // třetí zápas: 3 katapulty v jednom zápase
  done = play([{ user: users[0], stats: { trainedBy: { catapult: 3 } } }, {}]);
  assert.strictEqual(done[0].done[0].id, "d-katapulty3");
  assert(users[0].cosmetics.owned["title-gorol"]);

  // proti lidem: Bob porazí Cyrila; Ana už odměnu má -> dostane jinou vzácnou
  users[0].cosmetics.owned["flag-lebka"] = { at: 1, from: "test" };
  for (let i = 0; i < 3; i++) play([{ user: users[1] }, { user: users[2] }]);
  for (let i = 0; i < 3; i++) play([{ user: users[0] }, { user: users[2] }]);
  assert(users[1].cosmetics.owned["flag-lebka"], "Bob splnil 3 výhry proti lidem");
  assert(!users[2].cosmetics, "poražený nic nesplnil");
  const anaRare = Object.keys(users[0].cosmetics.owned).filter(id => COS.get(id).rarity === "rare" && id !== "flag-lebka");
  assert.strictEqual(anaRare.length, 1, "kdo odměnu už má, dostane jinou vzácnou");

  // výběr vzhledu jen z vlastněných odměn
  assert(ch.setLook(users[0], "title", "title-lovec").error);
  assert.deepStrictEqual(ch.setLook(users[0], "title", "title-gorol").look, { title: "title-gorol" });
  assert(ch.setLook(users[0], "flag", "title-gorol").error, "titul nejde dát na vlajku");
  ch.setLook(users[0], "flag", "flag-pruh");
  assert.deepStrictEqual(ch.lookOf(users[0]), { title: "title-gorol", flag: "flag-pruh" });
  ch.setLook(users[0], "flag", null);
  assert.deepStrictEqual(ch.lookOf(users[0]), { title: "title-gorol" });

  // nové období vynuluje postup, sbírka zůstává
  v = ch.view(users[0], now + 8 * 24 * 3600 * 1000);
  assert(v.daily.list.every(x => x.progress === 0 && !x.done));
  assert(v.owned.length >= 4);
}

function testAdmin() {
  const { store, accounts, users } = setup();
  const ch = createChallenges(store, accounts);
  const admin = { name: "Jurek" };

  assert(ch.addTemplate(admin, { text: "x" }).error);
  assert(ch.addTemplate(admin, { text: "Postav 2 dílny", period: "daily", metric: "built", unit: "catapult", target: 2 }).error, "katapult není budova");
  const r = ch.addTemplate(admin, { text: "Postav 2 dílny", en: "Build 2 workshops", period: "daily", metric: "built", unit: "workshop", target: 2, scope: "match" });
  assert(!r.error && r.template.id === "c1" && r.template.custom);

  // vypnout všechny vestavěné denní -> nové losování vezme jen vlastní šablonu
  for (const t of BUILTIN.filter(b => b.period === "daily")) ch.setTemplate(admin, t.id, { enabled: false });
  ch.reroll(admin, "daily");
  const picks = store.data.challenges.daily.picks;
  assert.deepStrictEqual(picks.map(p => p.id), ["c1"], "jediná zapnutá denní šablona");
  assert.strictEqual(ch.view(null).daily.list[0].en, "Build 2 workshops");

  assert.strictEqual(ch.adminView().templates.find(t => t.id === "d-vyhry2").enabled, false);
  assert(ch.deleteTemplate(admin, "d-vyhry2").error, "vestavěnou šablonu nejde smazat");
  assert(ch.deleteTemplate(admin, "c1").ok);

  // ruční udělení podle jména i id, podruhé už ne
  assert(ch.grant(admin, { user: "bob", reward: "frame-zlato", note: "vítěz turnaje" }).ok);
  assert(ch.grant(admin, { user: String(users[1].id), reward: "frame-zlato" }).error);
  assert(ch.grant(admin, { user: "nikdo", reward: "frame-zlato" }).error);
  assert(ch.grant(admin, { user: "Ana", reward: "neexistuje" }).error);
  assert.strictEqual(ch.adminView().rewards.find(x => x.id === "frame-zlato").owners, 1);
  assert.strictEqual(ch.adminView().grants[0].user, "Bob");
  assert(store.data.audit.some(a => a.action === "challenge-grant"));

  ch.setLook(users[1], "frame", "frame-zlato");
  assert(ch.revoke(admin, { userId: users[1].id, reward: "frame-zlato" }).ok);
  assert.deepStrictEqual(ch.lookOf(users[1]), {}, "odebraná odměna zmizí i ze vzhledu");
}

testTime();
testDrawAndProgress();
testAdmin();
console.log("challenges ok");
