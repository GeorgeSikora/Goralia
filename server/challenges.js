/*
 * Denní a týdenní výzvy s kosmetickými odměnami.
 *
 * Server každý den o půlnoci (GORALIA_TZ, výchozí Europe/Prague) vylosuje 3 denní výzvy a každé pondělí 2 týdenní
 * ze seznamu šablon. Postup se počítá jen tady, ze statistik zápasu, které zapsal server
 * (stats.record) nebo které ověřilo hlášení hry proti AI v prohlížeči (api.js). Klient postup
 * jen zobrazuje.
 *
 * Splněná výzva dá odměnu z js/cosmetics.js: denní běžnou, týdenní vzácnou. Kdo vylosovanou
 * odměnu už má, dostane jinou, kterou ještě nemá. Odměny jsou čistě kosmetické.
 *
 * Úložiště: store.data.challenges = { templates (vlastní šablony od admina), disabled (vypnuté
 * vestavěné), daily/weekly = { key, at, picks: [{ id, tpl, reward, done }] }, grants (poslední
 * ruční udělení) }. Na účtu: user.challenges = { daily/weekly: { key, prog, done } } a
 * user.cosmetics = { owned: { id: { at, from } }, look: { flag, color, title, frame } }.
 */
"use strict";

const crypto = require("crypto");
const R = require("../js/rules.js");
const COS = require("../js/cosmetics.js");

const TZ = process.env.GORALIA_TZ || "Europe/Prague"; // stejné pásmo jako statistiky návštěv (traffic.js)
const PERIODS = { daily: { count: 3, rarity: "common" }, weekly: { count: 2, rarity: "rare" } };
const MAX_CUSTOM = 100;
const MAX_GRANTS = 50;

const UNDEAD_UNITS = new Set(R.UNDEAD.units);
const HUMAN_UNITS = Object.keys(R.UNITS).filter(t => !UNDEAD_UNITS.has(t));
const HUMAN_BUILDINGS = Object.keys(R.BUILDING_HP).filter(t => !R.UNDEAD.buildings.includes(t) && t !== "citadel");

const sumOf = obj => Object.values(obj || {}).reduce((n, v) => n + (Number(v) || 0), 0);

// Co se ze statistik hráče v jednom zápase počítá. p = řádek hráče ze stats.record.
const METRICS = {
  games: { name: "Odehrané zápasy", value: () => 1 },
  wins: { name: "Výhry", value: p => (p.result === "win" ? 1 : 0) },
  kills: { name: "Zabité jednotky", value: p => p.kills || 0 },
  undeadKills: { name: "Zabití nemrtví", value: p => Object.entries(p.killsBy || {}).reduce((n, [t, v]) => n + (UNDEAD_UNITS.has(t) ? v : 0), 0) },
  trained: { name: "Vycvičené jednotky", unit: HUMAN_UNITS, value: (p, t) => (t.unit ? (p.trainedBy || {})[t.unit] || 0 : p.trained || 0) },
  built: { name: "Postavené budovy", unit: HUMAN_BUILDINGS, value: (p, t) => (t.unit ? (p.builtBy || {})[t.unit] || 0 : p.built || 0) },
  buildingsDestroyed: { name: "Zničené budovy", value: p => p.buildingsDestroyed || 0 },
  gold: { name: "Natěžené zlato", value: p => p.gold || 0 },
  wood: { name: "Natěžené dřevo", value: p => p.wood || 0 },
  heroLevel: { name: "Úroveň hrdiny", value: p => p.heroLevel || 0 }
};

const MODES = { any: "Jakýkoli zápas", pvp: "Proti lidem", ai: "Proti AI", coop: "Kooperace proti nemrtvým" };
const SCOPES = { sum: "Součet za období", match: "V jednom zápase" };

/*
 * Vestavěné šablony. text = česky (klíč překladu v js/lang), scope "match" = musí se stihnout
 * v jednom zápase, win = počítají se jen vyhrané zápasy, maxMinutes = zápas nesmí trvat déle.
 */
const BUILTIN = [
  { id: "d-vyhry2", period: "daily", text: "Vyhraj 2 zápasy", metric: "wins", target: 2 },
  { id: "d-zapasy3", period: "daily", text: "Odehraj 3 zápasy", metric: "games", target: 3 },
  { id: "d-katapulty3", period: "daily", text: "Postav 3 katapulty v jednom zápase", metric: "trained", unit: "catapult", target: 3, scope: "match" },
  { id: "d-rychle10", period: "daily", text: "Vyhraj zápas do 10 minut", metric: "wins", target: 1, maxMinutes: 10 },
  { id: "d-zabij40", period: "daily", text: "Zabij 40 nepřátelských jednotek", metric: "kills", target: 40 },
  { id: "d-rytiri5", period: "daily", text: "Vycvič 5 rytířů v jednom zápase", metric: "trained", unit: "knight", target: 5, scope: "match" },
  { id: "d-lucistnici10", period: "daily", text: "Vycvič 10 lučištníků", metric: "trained", unit: "archer", target: 10 },
  { id: "d-mnisi3", period: "daily", text: "Vycvič 3 mnichy v jednom zápase", metric: "trained", unit: "monk", target: 3, scope: "match" },
  { id: "d-veze3", period: "daily", text: "Postav 3 strážní věže v jednom zápase", metric: "built", unit: "tower", target: 3, scope: "match" },
  { id: "d-budy4", period: "daily", text: "Postav 4 budy v jednom zápase", metric: "built", unit: "hut", target: 4, scope: "match" },
  { id: "d-zlato1500", period: "daily", text: "Natěž 1500 zlata", metric: "gold", target: 1500 },
  { id: "d-drevo1000", period: "daily", text: "Natěž 1000 dřeva", metric: "wood", target: 1000 },
  { id: "d-budovy5", period: "daily", text: "Znič 5 nepřátelských budov", metric: "buildingsDestroyed", target: 5 },
  { id: "d-hrdina4", period: "daily", text: "Vycvič hrdinu na 4. úroveň", metric: "heroLevel", target: 4, scope: "match" },
  { id: "d-lide1", period: "daily", text: "Vyhraj zápas proti lidem", metric: "wins", target: 1, mode: "pvp" },
  { id: "d-nemrtvi1", period: "daily", text: "Zabij 25 nemrtvých", metric: "undeadKills", target: 25 },

  { id: "w-vyhry10", period: "weekly", text: "Vyhraj 10 zápasů", metric: "wins", target: 10 },
  { id: "w-nemrtvi50", period: "weekly", text: "Zabij 50 nemrtvých", metric: "undeadKills", target: 50 },
  { id: "w-zabij300", period: "weekly", text: "Zabij 300 nepřátelských jednotek", metric: "kills", target: 300 },
  { id: "w-lide3", period: "weekly", text: "Vyhraj 3 zápasy proti lidem", metric: "wins", target: 3, mode: "pvp" },
  { id: "w-budovy30", period: "weekly", text: "Znič 30 nepřátelských budov", metric: "buildingsDestroyed", target: 30 },
  { id: "w-zapasy15", period: "weekly", text: "Odehraj 15 zápasů", metric: "games", target: 15 },
  { id: "w-zlato10000", period: "weekly", text: "Natěž 10 000 zlata", metric: "gold", target: 10000 },
  { id: "w-rychle3", period: "weekly", text: "Vyhraj 3 zápasy do 15 minut", metric: "wins", target: 3, maxMinutes: 15 },
  { id: "w-kooperace3", period: "weekly", text: "Vyhraj 3 kooperace proti nemrtvým", metric: "wins", target: 3, mode: "coop" },
  { id: "w-katapulty15", period: "weekly", text: "Postav 15 katapultů", metric: "trained", unit: "catapult", target: 15 }
];

// Doplní výchozí hodnoty šablony (vestavěné i od admina mají stejný tvar).
const normalize = t => ({
  id: t.id, period: t.period, text: t.text, en: t.en || "", szl: t.szl || "",
  metric: t.metric, unit: t.unit || "", target: t.target, scope: t.scope === "match" ? "match" : "sum",
  win: !!t.win, maxMinutes: t.maxMinutes || 0, mode: MODES[t.mode] ? t.mode : "any",
  custom: !!t.custom, by: t.by || "", created: t.created || 0
});

/* ---------- čas: půlnoc a pondělí podle Prahy ---------- */
const FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short"
});
const WEEKDAYS = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

function parts(ms) {
  const o = {};
  for (const p of FMT.formatToParts(ms)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second, wd: WEEKDAYS[o.weekday] };
}

// Posun pražského času proti UTC v daném okamžiku (ms).
function offset(ms) {
  const p = parts(ms);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

// Okamžik pražské půlnoci daného kalendářního dne (měsíc a den smějí přetéct, Date.UTC je srovná).
function midnight(y, m, d) {
  const wall = Date.UTC(y, m - 1, d);
  let t = wall - offset(wall);
  t = wall - offset(t);
  return t;
}

const pad = n => String(n).padStart(2, "0");
const dateKey = ms => {
  const p = parts(ms);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
};

function periodInfo(period, now) {
  const p = parts(now);
  if (period === "daily") return { key: dateKey(now), resetsAt: midnight(p.y, p.m, p.d + 1) };
  const monday = midnight(p.y, p.m, p.d - p.wd);
  return { key: dateKey(monday + 12 * 3600 * 1000), resetsAt: midnight(p.y, p.m, p.d - p.wd + 7) };
}

/* ---------- výzvy ---------- */
function createChallenges(store, accounts, { random = crypto.randomInt } = {}) {
  const data = store.data;
  const C = data.challenges || (data.challenges = {});
  if (!Array.isArray(C.templates)) C.templates = [];
  if (!Array.isArray(C.disabled)) C.disabled = [];
  if (!Array.isArray(C.grants)) C.grants = [];
  if (!C.nextTemplateId) C.nextTemplateId = 1;

  const pickOne = list => list[random(list.length)];

  function templates() {
    return [...BUILTIN.map(normalize), ...C.templates.map(t => normalize({ ...t, custom: true }))]
      .map(t => ({ ...t, enabled: !C.disabled.includes(t.id) }));
  }

  // Vylosuje výzvy na nové období: jiné šablony než minule (když jich je dost), každá jiná metrika
  // a ke každé jinou odměnu (pokud možno jiného druhu).
  function draw(period, info, previous) {
    const { count, rarity } = PERIODS[period];
    const pool = templates().filter(t => t.enabled && t.period === period);
    const last = new Set((previous && previous.picks || []).map(p => p.id));
    const fresh = pool.filter(t => !last.has(t.id));
    let candidates = fresh.length >= count ? fresh : pool.slice();

    const picks = [];
    while (picks.length < count && candidates.length) {
      const tpl = pickOne(candidates);
      picks.push(tpl);
      const sig = `${tpl.metric}|${tpl.unit}`;
      candidates = candidates.filter(t => t !== tpl && `${t.metric}|${t.unit}` !== sig);
      if (!candidates.length && picks.length < count) candidates = pool.filter(t => !picks.includes(t));
    }

    const usedKinds = new Set();
    const usedRewards = new Set();
    return {
      key: info.key, at: Date.now(),
      picks: picks.map(tpl => {
        let rewards = COS.ofRarity(rarity).filter(r => !usedRewards.has(r.id) && !usedKinds.has(r.kind));
        if (!rewards.length) rewards = COS.ofRarity(rarity).filter(r => !usedRewards.has(r.id));
        const reward = rewards.length ? pickOne(rewards).id : null;
        usedRewards.add(reward);
        if (reward) usedKinds.add(COS.get(reward).kind);
        const { enabled, ...snapshot } = tpl;
        return { id: tpl.id, tpl: snapshot, reward, done: 0 };
      })
    };
  }

  // Zajistí, že výzvy patří k aktuálnímu dni / týdnu; vrací true, když se losovalo.
  function ensure(now = Date.now()) {
    let changed = false;
    for (const period of Object.keys(PERIODS)) {
      const info = periodInfo(period, now);
      if (C[period] && C[period].key === info.key) continue;
      C[period] = draw(period, info, C[period]);
      changed = true;
    }
    if (changed) store.save();
    return changed;
  }

  /* ---------- účet: postup a sbírka ---------- */
  // Postup hráče patří ke konkrétnímu losování (nové losování adminem ho vynuluje).
  const roundOf = cur => `${cur.key}#${cur.at}`;

  function progressOf(user, period, key) {
    const all = user.challenges || (user.challenges = {});
    let s = all[period];
    if (!s || s.key !== key) s = all[period] = { key, prog: {}, done: [] };
    return s;
  }

  function cosmeticsOf(user) {
    const c = user.cosmetics || (user.cosmetics = { owned: {}, look: {} });
    if (!c.owned) c.owned = {};
    if (!c.look) c.look = {};
    return c;
  }

  // Přidá odměnu na účet; vrací false, když ji hráč už měl.
  function give(user, id, from, now = Date.now()) {
    const c = cosmeticsOf(user);
    if (!COS.get(id) || c.owned[id]) return false;
    c.owned[id] = { at: now, from: String(from || "").slice(0, 80) };
    return true;
  }

  // Odměna za splnění: vylosovaná, a když ji hráč má, jiná nevlastněná stejné rarity, pak jakákoli.
  function rewardFor(user, pick, rarity) {
    const owned = cosmeticsOf(user).owned;
    if (pick.reward && !owned[pick.reward]) return pick.reward;
    const same = COS.ofRarity(rarity).filter(r => !owned[r.id]);
    if (same.length) return pickOne(same).id;
    const any = COS.ITEMS.filter(r => !owned[r.id] && r.rarity !== "tutorial");
    return any.length ? pickOne(any).id : null;
  }

  // Splňuje zápas podmínky šablony (druh zápasu, výhra, délka)?
  function fits(tpl, match, p) {
    if (tpl.win && p.result !== "win") return false;
    if (tpl.maxMinutes && match.duration > tpl.maxMinutes * 60) return false;
    if (tpl.mode === "pvp") return match.humans >= 2 && !match.coop;
    if (tpl.mode === "coop") return !!match.coop;
    if (tpl.mode === "ai") return !match.coop && match.ais > 0;
    return true;
  }

  /*
   * Zapíše zápas do výzev všech přihlášených hráčů v něm.
   * match = záznam ze stats.record (nebo stejně tvarovaný záznam hry proti AI v prohlížeči):
   * { duration, coop, humans, ais, players: [{ userId, result, kills, killsBy, trainedBy, ... }] }
   * Vrací [{ userId, done: [{ id, text, reward }] }] pro hráče, kteří něco splnili.
   */
  function onMatch(match, now = Date.now()) {
    if (!match || !Array.isArray(match.players)) return [];
    ensure(now);
    const out = [];

    for (const p of match.players) {
      const user = p.userId && data.users[p.userId];
      if (!user || user.banned) continue;
      const finished = [];

      for (const period of Object.keys(PERIODS)) {
        const cur = C[period];
        const s = progressOf(user, period, roundOf(cur));

        for (const pick of cur.picks) {
          if (s.done.includes(pick.id)) continue;
          const tpl = pick.tpl;
          const metric = METRICS[tpl.metric];
          if (!metric || !fits(tpl, match, p)) continue;

          const value = Math.max(0, Math.floor(metric.value(p, tpl)) || 0);
          if (!value) continue;
          const before = s.prog[pick.id] || 0;
          const next = Math.min(tpl.target, tpl.scope === "match" ? Math.max(before, value) : before + value);
          s.prog[pick.id] = next;
          if (next < tpl.target) continue;

          s.done.push(pick.id);
          pick.done = (pick.done || 0) + 1;
          const reward = rewardFor(user, pick, PERIODS[period].rarity);
          if (reward) give(user, reward, `výzva: ${tpl.text}`, now);
          finished.push({ id: pick.id, period, text: tpl.text, en: tpl.en, szl: tpl.szl, reward });
        }
      }

      if (finished.length) out.push({ userId: user.id, done: finished });
    }

    store.save();
    return out;
  }

  /* ---------- pohledy ---------- */
  function view(user, now = Date.now()) {
    ensure(now);
    const periods = {};

    for (const period of Object.keys(PERIODS)) {
      const cur = C[period];
      const info = periodInfo(period, now);
      const s = user ? progressOf(user, period, roundOf(cur)) : null;
      periods[period] = {
        resetsAt: info.resetsAt,
        list: cur.picks.map(pick => ({
          id: pick.id, text: pick.tpl.text, en: pick.tpl.en, szl: pick.tpl.szl, target: pick.tpl.target, scope: pick.tpl.scope,
          progress: s ? s.prog[pick.id] || 0 : 0, done: s ? s.done.includes(pick.id) : false, reward: pick.reward
        }))
      };
    }

    const c = user ? cosmeticsOf(user) : null;
    return {
      now, daily: periods.daily, weekly: periods.weekly,
      owned: c ? Object.entries(c.owned).map(([id, o]) => ({ id, at: o.at })) : [],
      look: c ? COS.clean(c.look) : {}
    };
  }

  // Veřejný vzhled hráče (síň slávy, soupiska zápasu): jen vybrané a skutečně vlastněné odměny.
  function lookOf(user) {
    if (!user || !user.cosmetics) return {};
    const c = user.cosmetics;
    const look = COS.clean(c.look);
    for (const kind of Object.keys(look)) if (!c.owned[look[kind]]) delete look[kind];
    return look;
  }

  // Hráč si vybere odměnu, kterou vlastní (id = null sundá).
  function setLook(user, kind, id) {
    if (!COS.KINDS.includes(kind)) return { error: "Neznámý druh odměny." };
    const c = cosmeticsOf(user);
    if (id == null || id === "") {
      delete c.look[kind];
    } else {
      const item = COS.get(id);
      if (!item || item.kind !== kind) return { error: "Neznámá odměna." };
      if (!c.owned[id]) return { error: "Tuhle odměnu ještě nemáš." };
      c.look[kind] = id;
    }
    store.save();
    return { look: lookOf(user) };
  }

  /* ---------- administrace ---------- */
  function adminView(now = Date.now()) {
    ensure(now);
    const users = Object.values(data.users);
    const owners = {};
    for (const u of users) for (const id of Object.keys((u.cosmetics && u.cosmetics.owned) || {})) owners[id] = (owners[id] || 0) + 1;

    const period = name => {
      const cur = C[name];
      const info = periodInfo(name, now);
      const active = users.filter(u => u.challenges && u.challenges[name] && u.challenges[name].key === roundOf(cur) && Object.keys(u.challenges[name].prog).length).length;
      return { key: cur.key, at: cur.at, resetsAt: info.resetsAt, active, picks: cur.picks.map(p => ({ ...p })) };
    };

    return {
      now, daily: period("daily"), weekly: period("weekly"), templates: templates(),
      metrics: Object.fromEntries(Object.entries(METRICS).map(([k, m]) => [k, { name: m.name, units: m.unit || null }])),
      modes: MODES, scopes: SCOPES,
      rewards: COS.ITEMS.map(r => ({ ...r, owners: owners[r.id] || 0 })),
      grants: C.grants.slice().reverse()
    };
  }

  const clip = (v, max) => String(v || "").trim().replace(/\s+/g, " ").slice(0, max);

  function addTemplate(admin, body) {
    if (C.templates.length >= MAX_CUSTOM) return { error: `Vlastních šablon může být nejvýš ${MAX_CUSTOM}.` };
    const text = clip(body.text, 80);
    if (text.length < 3) return { error: "Zadej text výzvy." };
    if (!PERIODS[body.period]) return { error: "Vyber, jestli je výzva denní, nebo týdenní." };
    const metric = METRICS[body.metric];
    if (!metric) return { error: "Neznámé měřítko výzvy." };
    const unit = clip(body.unit, 20);
    if (unit && !(metric.unit || []).includes(unit)) return { error: "U tohoto měřítka nejde vybrat typ." };
    const target = Math.round(Number(body.target));
    if (!(target >= 1 && target <= 100000)) return { error: "Cíl musí být 1 až 100 000." };
    const maxMinutes = Math.round(Number(body.maxMinutes) || 0);
    if (maxMinutes < 0 || maxMinutes > 300) return { error: "Délka zápasu musí být 0 až 300 minut." };

    const tpl = {
      id: `c${C.nextTemplateId++}`, period: body.period, text, en: clip(body.en, 80), szl: clip(body.szl, 80),
      metric: body.metric, unit, target, scope: body.scope === "match" ? "match" : "sum", win: !!body.win, maxMinutes,
      mode: MODES[body.mode] ? body.mode : "any", by: admin.name, created: Date.now()
    };
    C.templates.push(tpl);
    accounts.audit(admin, "challenge-add", `${tpl.id} ${tpl.period}: ${tpl.text}`);
    store.save();
    return { template: normalize({ ...tpl, custom: true }) };
  }

  // Vypnout / zapnout šablonu (vestavěnou i vlastní); vlastní jde i smazat.
  function setTemplate(admin, id, { enabled }) {
    const tpl = templates().find(t => t.id === id);
    if (!tpl) return { error: "Šablona neexistuje." };
    C.disabled = C.disabled.filter(x => x !== id);
    if (enabled === false) C.disabled.push(id);
    accounts.audit(admin, "challenge-toggle", `${id} ${enabled === false ? "vypnuto" : "zapnuto"}`);
    store.save();
    return { ok: true };
  }

  function deleteTemplate(admin, id) {
    const i = C.templates.findIndex(t => t.id === id);
    if (i < 0) return { error: "Vlastní šablona neexistuje." };
    const [tpl] = C.templates.splice(i, 1);
    C.disabled = C.disabled.filter(x => x !== id);
    accounts.audit(admin, "challenge-delete", `${tpl.id}: ${tpl.text}`);
    store.save();
    return { ok: true };
  }

  // Nové losování výzev hned teď (postup hráčů v tomto období se tím vynuluje).
  function reroll(admin, period, now = Date.now()) {
    if (!PERIODS[period]) return { error: "Neznámé období." };
    C[period] = draw(period, periodInfo(period, now), C[period]);
    accounts.audit(admin, "challenge-reroll", period);
    store.save();
    return { ok: true };
  }

  function grant(admin, body) {
    const ref = String(body.user || "").trim();
    const user = /^\d+$/.test(ref) ? data.users[Number(ref)] : Object.values(data.users).find(u => u.name.toLowerCase() === ref.toLowerCase());
    if (!user) return { error: "Hráč neexistuje." };
    const item = COS.get(body.reward);
    if (!item) return { error: "Neznámá odměna." };
    const note = clip(body.note, 60);
    if (!give(user, item.id, `admin ${admin.name}${note ? `: ${note}` : ""}`)) return { error: `${user.name} tuhle odměnu už má.` };

    C.grants.push({ at: Date.now(), admin: admin.name, userId: user.id, user: user.name, reward: item.id, note });
    if (C.grants.length > MAX_GRANTS) C.grants.splice(0, C.grants.length - MAX_GRANTS);
    accounts.audit(admin, "challenge-grant", `${user.name} (#${user.id}) ${item.id}${note ? ` ${note}` : ""}`);
    store.save();
    return { ok: true, user: { id: user.id, name: user.name } };
  }

  function revoke(admin, body) {
    const user = data.users[Number(body.userId)];
    if (!user || !user.cosmetics || !user.cosmetics.owned[body.reward]) return { error: "Hráč tuhle odměnu nemá." };
    delete user.cosmetics.owned[body.reward];
    for (const kind of COS.KINDS) if (user.cosmetics.look[kind] === body.reward) delete user.cosmetics.look[kind];
    accounts.audit(admin, "challenge-revoke", `${user.name} (#${user.id}) ${body.reward}`);
    store.save();
    return { ok: true };
  }

  ensure();

  return {
    ensure, onMatch, view, lookOf, setLook, give,
    adminView, addTemplate, setTemplate, deleteTemplate, reroll, grant, revoke,
    nextReset: (now = Date.now()) => Math.min(periodInfo("daily", now).resetsAt, periodInfo("weekly", now).resetsAt)
  };
}

module.exports = { createChallenges, periodInfo, METRICS, BUILTIN, PERIODS, sumOf };
