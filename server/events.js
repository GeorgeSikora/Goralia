/*
 * Pořádání turnajů: admin naplánuje událost (čas, mapa, formát, kapacita), hráči se přihlašují
 * a v menu hry běží odpočet. Po odehrání admin zapíše výsledky do síně slávy (halloffame.js).
 */
"use strict";

const FORMATS = { ko: "Vyřazovací pavouk", rr: "Každý s každým", ffa: "Všichni proti všem" };
const RUNNING_FOR = 3 * 3600 * 1000; // tak dlouho po začátku se turnaj ukazuje jako probíhající
const MAX_EVENTS = 200;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 64;

function createEvents(store, accounts, { mapExists = () => true } = {}) {
  const data = store.data;
  if (!Array.isArray(data.events)) data.events = [];
  if (!data.nextEventId) data.nextEventId = 1;

  const byId = id => data.events.find(e => e.id === Number(id)) || null;
  const nameOf = id => (data.users[id] || {}).name || "";
  const text = (value, max) => String(value || "").trim().replace(/[ \t]+/g, " ").slice(0, max);

  // Společná kontrola pro vytvoření i úpravu; vrací { error } nebo očištěná pole.
  function fields(body, now) {
    const name = text(body.name, 60);
    if (name.length < 2) return { error: "Zadej název turnaje." };

    const start = Number(body.start);
    if (!Number.isFinite(start)) return { error: "Neplatný začátek turnaje." };
    if (start < now - 60 * 1000) return { error: "Začátek turnaje je v minulosti." };

    const map = text(body.map, 31);
    if (map && (!/^[a-z0-9-]{1,31}$/.test(map) || !mapExists(map))) return { error: "Neznámá mapa." };

    const format = Object.hasOwn(FORMATS, body.format) ? body.format : "ko";
    const maxPlayers = Math.round(Number(body.maxPlayers));
    if (!(maxPlayers >= MIN_PLAYERS && maxPlayers <= MAX_PLAYERS)) return { error: `Počet hráčů musí být ${MIN_PLAYERS} až ${MAX_PLAYERS}.` };

    return {
      name, start, map, format, maxPlayers,
      prize: text(body.prize, 80),
      description: String(body.description || "").trim().slice(0, 400)
    };
  }

  function create(admin, body, now = Date.now()) {
    const f = fields(body, now);
    if (f.error) return f;

    const event = { id: data.nextEventId++, ...f, registered: [], state: "planned", by: admin.name, created: now };
    data.events.push(event);
    if (data.events.length > MAX_EVENTS) data.events.splice(0, data.events.length - MAX_EVENTS);
    accounts.audit(admin, "event-create", `${event.name} (#${event.id}) ${new Date(event.start).toISOString()}`);
    return { event: adminView(event) };
  }

  function update(admin, id, body, now = Date.now()) {
    const event = byId(id);
    if (!event || event.state !== "planned") return { error: "Naplánovaný turnaj neexistuje." };

    const f = fields(body, Math.min(now, event.start));
    if (f.error) return f;
    if (f.maxPlayers < event.registered.length) return { error: `Přihlášeno je už ${event.registered.length} hráčů.` };

    Object.assign(event, f);
    accounts.audit(admin, "event-update", `${event.name} (#${event.id})`);
    return { event: adminView(event) };
  }

  function cancel(admin, id) {
    const i = data.events.findIndex(e => e.id === Number(id));
    if (i < 0) return { error: "Turnaj neexistuje." };

    const [event] = data.events.splice(i, 1);
    accounts.audit(admin, "event-cancel", `${event.name} (#${event.id})`);
    return { event };
  }

  // Po zápisu výsledků do síně slávy se událost uzavře.
  function finish(id, tournamentId) {
    const event = byId(id);
    if (!event) return false;
    event.state = "done";
    event.tournamentId = tournamentId;
    store.save();
    return true;
  }

  function join(user, id, now = Date.now()) {
    const event = byId(id);
    if (!event || event.state !== "planned") return { error: "Turnaj neexistuje." };
    if (now >= event.start) return { error: "Turnaj už začal, přihlášky jsou uzavřené." };
    if (user.banned) return { error: "Zablokovaný účet se nemůže přihlásit." };
    if (event.registered.includes(user.id)) return { event };
    if (event.registered.length >= event.maxPlayers) return { error: "Turnaj je plně obsazený." };

    event.registered.push(user.id);
    store.save();
    return { event };
  }

  function leave(user, id, now = Date.now()) {
    const event = byId(id);
    if (!event || event.state !== "planned") return { error: "Turnaj neexistuje." };
    if (now >= event.start) return { error: "Turnaj už začal." };

    event.registered = event.registered.filter(uid => uid !== user.id);
    store.save();
    return { event };
  }

  const players = e => e.registered.map(id => ({ id, name: nameOf(id) })).filter(p => p.name);

  // Veřejný pohled: bez toho, kdo turnaj založil.
  function publicView(e, userId) {
    return {
      id: e.id, name: e.name, start: e.start, map: e.map, format: e.format, formatName: FORMATS[e.format],
      maxPlayers: e.maxPlayers, prize: e.prize, description: e.description,
      players: players(e), joined: !!userId && e.registered.includes(userId)
    };
  }

  function adminView(e) {
    return { ...publicView(e), state: e.state, by: e.by, created: e.created, tournamentId: e.tournamentId || null };
  }

  // Nadcházející a právě probíhající turnaje, nejbližší první.
  function upcoming(userId, now = Date.now()) {
    return data.events
      .filter(e => e.state === "planned" && e.start > now - RUNNING_FOR)
      .sort((a, b) => a.start - b.start)
      .map(e => publicView(e, userId));
  }

  // Naplánované od nejbližšího, pak odehrané od nejnovějšího.
  function listAdmin() {
    const planned = data.events.filter(e => e.state === "planned").sort((a, b) => a.start - b.start);
    const past = data.events.filter(e => e.state !== "planned").sort((a, b) => b.start - a.start);
    return planned.concat(past).map(adminView);
  }

  return { create, update, cancel, finish, join, leave, upcoming, listAdmin, get: byId, FORMATS, RUNNING_FOR };
}

module.exports = { createEvents, FORMATS, RUNNING_FOR };
