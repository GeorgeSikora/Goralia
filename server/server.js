/*
 * Server hry: statické soubory, místnosti s hostitelem (2 až 6 hráčů + AI) a autoritativní běh zápasů.
 * Spuštění: npm install && npm start  (port z proměnné PORT, výchozí 3000)
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const { Match, TICK } = require("../js/sim.js");
const R = require("../js/rules.js");
const ADMIN = require("../js/admincmd.js");
const MAPS = require("../js/maps.js");
const mapstore = require("./mapstore.js");
const { createStore } = require("./store.js");
const { createAccounts } = require("./accounts.js");
const { createStats } = require("./stats.js");
const { createHallOfFame } = require("./halloffame.js");
const { createEvents } = require("./events.js");
const { createTraffic } = require("./traffic.js");
const { createGeo } = require("./geoip.js");
const { createMapConfig } = require("./mapconfig.js");
const { createApi, SID } = require("./api.js");
const { SECURITY_HEADERS, parseCookies, sameOrigin, clientIp } = require("./httputil.js");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.resolve(process.env.GORALIA_DATA_DIR || path.join(ROOT, "data"));
const PUBLIC_URL = (process.env.PUBLIC_URL || "").trim();
const PUBLIC_DIRS = ["css", "js", "assets"];
const MAX_CLIENTS = 400;
const MAX_ROOMS = 100;
const MAX_SPECTATORS = 100; // diváků u jednoho zápasu
const MAX_MSG_PER_SEC = 80;
const BUFFER_LIMIT = 2 * 1024 * 1024;
const MAX_MAP_BYTES = 1024 * 1024;
const MAX_WS_PAYLOAD = 16 * 1024; // zprávy hráčů; nejdelší je popis spojení hlasového chatu (SDP)
const PAGES = ["index.html", "editor.html", "privacy.html", "terms.html", "manifest.webmanifest", "robots.txt", "sitemap.xml"];
// Hezké adresy bez přípony (např. https://goralia.cz/privacy).
const PRETTY = { "/privacy": "/privacy.html", "/terms": "/terms.html" };
const ADMIN_PAGE = "admin.html";
// Servery pro navázání hlasového spojení mezi prohlížeči. STUN stačí většině domácích sítí;
// pro hráče za přísným NATem (mobilní data, firemní sítě) lze přidat vlastní TURN (např. coturn na VPS).
const ICE_SERVERS = [{ urls: (process.env.GORALIA_STUN_URLS || "stun:stun.l.google.com:19302").split(",").map(u => u.trim()).filter(Boolean) }];
if (process.env.GORALIA_TURN_URL) {
  ICE_SERVERS.push({
    urls: process.env.GORALIA_TURN_URL.split(",").map(u => u.trim()).filter(Boolean),
    username: process.env.GORALIA_TURN_USER || "",
    credential: process.env.GORALIA_TURN_PASS || ""
  });
}
const STARTED = Date.now();

const store = createStore(DATA_DIR);
// Offline databáze pro zjištění země a města z IP (npm run geoip); bez ní se místo nezjišťuje.
const geo = createGeo(path.resolve(process.env.GORALIA_GEOIP || path.join(DATA_DIR, "geoip.mmdb")));
const traffic = createTraffic(store, geo);
const accounts = createAccounts(store, {
  adminName: process.env.GORALIA_ADMIN_NAME,
  adminEmail: process.env.GORALIA_ADMIN_EMAIL,
  onCreate: user => { if (user.role !== "admin") traffic.bump("registrations"); }
});
const stats = createStats(store);
const hall = createHallOfFame(store, accounts);
const mapConfig = createMapConfig(store, MAPS);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".mp3": "audio/mpeg",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

/* ---------- vlastní mapy (editor) ---------- */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

// „Místní počítač“: přímé spojení z loopbacku, bez proxy a s odpovídajícím Hostem i Originem (vývoj bez přihlášení).
function isLocalRequest(req) {
  const addr = req.socket.remoteAddress;
  const loopback = addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
  const host = req.headers.host || "";
  let originOk = true;

  if (req.headers.origin) {
    try { originOk = new URL(req.headers.origin).host === host; } catch (e) { originOk = false; }
  }

  return loopback && LOCAL_HOST.test(host) && originOk && !req.headers["x-forwarded-for"] && !req.headers.forwarded;
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

// Kdo smí mapy ukládat a mazat: přihlášený administrátor (odkudkoli), nebo místní počítač.
function mapEditor(req) {
  const user = api.userOf(req);

  if (user && user.role === "admin") {
    return sameOrigin(req, PUBLIC_URL) ? { admin: user } : { error: "Požadavek z cizí stránky." };
  }

  if (isLocalRequest(req)) return { local: true };
  return { error: "Mapy může ukládat a mazat jen přihlášený administrátor." };
}

function handleMapApi(req, res, pathname) {
  const parts = pathname.split("/").filter(Boolean);
  const id = parts[2];

  if (parts.length > 3) return sendJson(res, 404, { errors: ["Nenalezeno."] });
  if (req.method === "GET" && !id) return sendJson(res, 200, { maps: mapstore.list() });

  if (!id || (req.method !== "PUT" && req.method !== "DELETE")) return sendJson(res, 405, { errors: ["Nepodporovaná metoda."] });

  const editor = mapEditor(req);
  if (editor.error) return sendJson(res, 403, { errors: [editor.error] });
  const audit = (action, detail) => { if (editor.admin) accounts.audit(editor.admin, action, detail); };

  if (req.method === "DELETE") {
    // Mapa v místnosti (v lobby i při hře) se nemaže; admin nejdřív zavře místnost.
    const used = [...rooms.values()].find(r => r.map.id === id);
    if (used) {
      return sendJson(res, 409, { errors: [`Mapu právě používá místnost ${used.id} (${used.match ? "hraje se" : "lobby"}). Nejdřív ji zavři v sekci Online.`] });
    }

    if (!mapstore.remove(id)) return sendJson(res, 404, { errors: ["Taková vlastní mapa neexistuje."] });

    mapConfig.forget(id);
    audit("map-delete", id);
    live.mapsChanged();
    return sendJson(res, 200, { ok: true });
  }

  if (!/^application\/json/.test(req.headers["content-type"] || "")) return sendJson(res, 415, { errors: ["Ocekává se JSON."] });

  const chunks = [];
  let size = 0;

  req.on("data", chunk => {
    size += chunk.length;
    if (size > MAX_MAP_BYTES) {
      sendJson(res, 413, { errors: ["Mapa je příliš velká."] });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on("end", () => {
    if (res.writableEnded) return;

    let raw;
    try { raw = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (e) { return sendJson(res, 400, { errors: ["Neplatný JSON."] }); }
    if (!raw || raw.id !== id) return sendJson(res, 400, { errors: ["Id v adrese a v mapě se neshoduje."] });

    const result = mapstore.save(raw);
    if (result.errors.length) return sendJson(res, 400, { errors: result.errors });

    audit("map-save", id);
    live.mapsChanged();
    sendJson(res, 200, { ok: true });
  });
}

/* ---------- static files ---------- */
const live = {};
/* ---------- správa map pro admin panel ---------- */
const adminMaps = {
  list: () => MAPS.list.map(m => ({
    id: m.id, name: m.name, players: m.players, width: m.size[0] * 2, height: m.size[1] * 2, tag: m.tag, gold: m.gold.length,
    description: m.description || "", custom: !!m.custom, multiplayer: mapConfig.multiplayer(m.id), updated: m.custom ? mapstore.mtime(m.id) : 0
  })),

  setMultiplayer(admin, id, on) {
    const result = mapConfig.setMultiplayer(id, on);
    if (result.error) return result;

    accounts.audit(admin, on ? "map-mp-on" : "map-mp-off", id);
    live.mapsChanged();
    return result;
  }
};

const events = createEvents(store, accounts, { mapExists: id => MAPS.list.some(m => m.id === id) });

const api = createApi({ accounts, stats, hall, events, store, live, traffic, adminMaps, isLocalRequest, publicUrl: PUBLIC_URL });
// Domény webu hry: odkaz z nich je přechod v rámci webu, ne zdroj návštěvy.
const ownHosts = req => {
  const hosts = [String(req.headers.host || "")];
  try { if (PUBLIC_URL) hosts.push(new URL(PUBLIC_URL).host); } catch (e) { /* neplatná PUBLIC_URL */ }
  return hosts;
};

const api = createApi({ accounts, stats, hall, store, live, traffic, adminMaps, isLocalRequest, publicUrl: PUBLIC_URL });

const server = http.createServer((req, res) => {
  let pathname;
  let query;

  try {
    const url = new URL(req.url, "http://x");
    pathname = decodeURIComponent(url.pathname);
    query = url.searchParams;
  } catch (e) {
    res.writeHead(400);
    return res.end();
  }

  if (pathname === "/api/maps" || pathname.startsWith("/api/maps/")) return handleMapApi(req, res, pathname);
  if (api.handle(req, res, pathname, query)) return;

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    return res.end();
  }

  if (pathname === "/") pathname = "/index.html";
  const pretty = PRETTY[pathname.replace(/\/$/, "")];
  if (pretty) pathname = pretty;

  // Panel serveru vidí jen přihlášený admin, ostatním stránka neexistuje.
  if (pathname === "/admin" || pathname === "/admin.html") {
    const user = api.userOf(req);

    if (!user || user.role !== "admin") {
      res.writeHead(404);
      return res.end("Not found");
    }

    pathname = `/${ADMIN_PAGE}`;
  }

  const file = path.resolve(ROOT, "." + pathname);
  const rel = path.relative(ROOT, file).split(path.sep);
  const isAdminPage = rel.length === 1 && rel[0] === ADMIN_PAGE && pathname === `/${ADMIN_PAGE}`;
  const allowed = rel.length === 1 ? PAGES.includes(rel[0]) || isAdminPage : PUBLIC_DIRS.includes(rel[0]);

  if (!allowed || rel.includes("..")) {
    res.writeHead(404);
    return res.end("Not found");
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }

    if (pathname === "/index.html" && req.method === "GET") traffic.pageView(clientIp(req), req.headers["user-agent"], { referer: req.headers.referer, query, hosts: ownHosts(req) });

    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": isAdminPage ? "no-store" : "no-cache",
      ...SECURITY_HEADERS
    });
    res.end(req.method === "HEAD" ? undefined : data);
  });
});

/* ---------- lobby ---------- */
const wss = new WebSocketServer({ server, maxPayload: MAX_WS_PAYLOAD });
const clients = new Set();
const rooms = new Map();
const matches = new Set();
const byUser = new Map(); // id účtu -> připojený klient
let lastRooms = "";
let nextClientId = 1;
let nextRoomId = 1;

function send(client, payload) {
  const ws = client.ws;
  if (ws.readyState !== ws.OPEN) return;

  if (ws.bufferedAmount > BUFFER_LIMIT) {
    ws.terminate();
    return;
  }

  ws.send(typeof payload === "string" ? payload : JSON.stringify(payload));
}

function fail(client, text) {
  send(client, { t: "error", text });
}

/* ---------- místnosti ---------- */
const humansOf = room => room.slots.filter(s => s.kind === "human" && s.client).map(s => s.client);
const slotIndex = (room, client) => room.slots.findIndex(s => s.client === client);

function roomList() {
  const list = [];

  for (const room of rooms.values()) {
    if (room.match) continue;
    list.push({ id: room.id, map: room.map.id, host: room.host.name, players: room.slots.filter(s => s.kind !== "open").length, max: room.slots.length });
  }

  return list;
}

// Rozehrané zápasy, které může sledovat kdokoli (i návštěvník bez účtu).
function liveList() {
  const list = [];

  for (const room of matches) {
    if (!room.match || room.match.phase === "ended") continue;
    list.push({ id: room.id, map: room.map.id, players: room.roster.map(p => p.name), since: room.started, watchers: room.spectators.size });
  }

  return list;
}

function roomsText() {
  const playing = [...matches].reduce((n, room) => n + humansOf(room).length, 0);
  return JSON.stringify({ t: "rooms", list: roomList(), live: liveList(), playing, online: clients.size, off: mapConfig.off() });
}

function broadcastRooms() {
  const text = roomsText();
  if (text === lastRooms) return;
  lastRooms = text;

  for (const client of clients) {
    if (!client.room && !client.watching) send(client, text);
  }
}

/* ---------- chat místnosti ---------- */
const CHAT_MAX = 200; // znaků na zprávu
const CHAT_KEEP = 40; // zpráv v paměti místnosti pro toho, kdo se připojí později (po zániku místnosti zmizí)
const CHAT_BURST = 4; // zpráv za CHAT_WINDOW
const CHAT_WINDOW = 8000;
const CHAT_GAP = 400; // min. odstup dvou zpráv (ms)

// Bez řídicích a neviditelných znaků (včetně přepínačů směru textu), jednotné mezery, omezená délka.
function cleanChat(text) {
  return String(text == null ? "" : text)
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CHAT_MAX);
}

function chatNote(client, text) {
  send(client, { t: "chat", sys: true, text });
}

// Příkazy správce (js/admincmd.js, třeba /resources nebo /spawn knight 5). Spustí je jen účet s rolí admin;
// pro ostatní se známý příkaz ani nepřepošle do chatu a nic se nestane. Změněný zápas se nezapisuje do statistik.
function adminCommand(client, room, text, viaChat) {
  if (!client.user || client.user.role !== "admin") return;

  const match = room && room.match;
  const result = ADMIN.run(match, client.team, text);
  if (result.changed) {
    match.recorded = true;
    accounts.audit(client.user, "admin-cmd", `${text.slice(0, 60)} · místnost ${room.id} (${room.map.id})`);
  }

  if (viaChat) for (const line of result.lines) chatNote(client, line);
  else send(client, { t: "admin", ok: result.ok, lines: result.lines });
}

function chatSay(client, room, raw) {
  const text = cleanChat(raw);
  const slot = slotIndex(room, client);
  if (!text || slot < 0) return;

  if (ADMIN.isCommand(text)) return adminCommand(client, room, text, true);

  const now = Date.now();
  client.chatTimes = (client.chatTimes || []).filter(at => now - at < CHAT_WINDOW);

  if (now - (client.chatLast || 0) < CHAT_GAP || client.chatTimes.length >= CHAT_BURST) {
    return chatNote(client, "Píšeš příliš rychle, chvilku počkej.");
  }

  if (text === client.chatText && now - (client.chatLast || 0) < 10000) {
    return chatNote(client, "Stejnou zprávu už jsi poslal.");
  }

  client.chatTimes.push(now);
  client.chatLast = now;
  client.chatText = text;

  const entry = { slot, name: client.name, text };
  room.chat.push(entry);
  if (room.chat.length > CHAT_KEEP) room.chat.shift();

  const payload = JSON.stringify({ t: "chat", ...entry });
  for (const human of humansOf(room)) send(human, payload);
}

/* ---------- hlasový chat místnosti ---------- */
// Zvuk teče přímo mezi prohlížeči (WebRTC). Server jen předává popisy spojení mezi členy jedné místnosti
// a oznamuje, kdo právě drží klávesu push-to-talk. Diváci a lidé mimo místnost nic nedostanou.
const RTC_KINDS = new Set(["offer", "answer", "ice"]);
const RTC_MAX = 12 * 1024; // znaků jednoho popisu (SDP nebo ICE kandidát)

// Seznam členů místnosti pro hlasový chat; posílá se při každé změně obsazení (v lobby i během zápasu).
function sendVoice(room) {
  const humans = room.slots.map((s, slot) => ({ s, slot })).filter(({ s }) => s.kind === "human" && s.client);
  const peers = humans.map(({ s, slot }) => ({ id: s.client.id, name: s.client.name, slot }));
  for (const { s } of humans) send(s.client, { t: "voice", me: s.client.id, peers });
}

function voiceTalk(client, room, on) {
  on = !!on;
  if (client.talking === on) return;
  client.talking = on;

  const payload = JSON.stringify({ t: "talk", id: client.id, name: client.name, slot: slotIndex(room, client), on });
  for (const human of humansOf(room)) if (human !== client) send(human, payload);
}

function voiceRelay(client, room, msg) {
  if (!RTC_KINDS.has(msg.kind)) return;
  const target = humansOf(room).find(human => human.id === msg.to);
  if (!target || target === client) return;

  const data = msg.kind === "ice" ? msg.ice : msg.sdp;
  if (data == null || typeof data !== "object") return;

  const text = JSON.stringify(data);
  if (text.length > RTC_MAX) return;

  send(target, `{"t":"rtc","from":${client.id},"kind":"${msg.kind}","${msg.kind === "ice" ? "ice" : "sdp"}":${text}}`);
}

/* ---------- diváci ---------- */
function unwatch(client) {
  const room = client.watching;
  if (!room) return;
  client.watching = null;
  room.spectators.delete(client);
}

// Zápas skončil nebo zanikl: diváci se pustí (poslední snímek už dostali).
function endWatch(room) {
  for (const client of room.spectators) {
    client.watching = null;
    send(client, { t: "specEnd" });
  }

  room.spectators.clear();
}

function sendRoom(room) {
  const host = slotIndex(room, room.host);

  for (const client of humansOf(room)) {
    send(client, {
      t: "room",
      id: room.id,
      map: room.map.id,
      state: room.match ? "playing" : "lobby",
      you: slotIndex(room, client),
      host,
      slots: room.slots.map(s => ({ kind: s.kind, name: s.kind === "human" && s.client ? s.client.name : "" }))
    });
  }

  sendVoice(room);
}

function createRoom(host, map) {
  const room = {
    id: nextRoomId++,
    map,
    host,
    match: null,
    spectators: new Set(),
    chat: [],
    slots: map.slots.map(() => ({ kind: "open", client: null }))
  };

  // kooperativní mapa: slot nemrtvých hraje vždy AI a hostitel sedí na prvním lidském místě
  const hell = map.coop ? map.coop.ai : -1;
  if (hell >= 0) room.slots[hell] = { kind: "ai", client: null };
  room.slots[hell === 0 ? 1 : 0] = { kind: "human", client: host };
  host.room = room;
  rooms.set(room.id, room);
  return room;
}

function changeMap(room, map) {
  const next = map.slots.map(() => ({ kind: "open", client: null }));
  const humans = [];

  room.slots.forEach((slot, i) => {
    if (i < next.length) next[i] = slot;
    else if (slot.kind === "human") humans.push(slot);
  });

  // na kooperativní mapě patří slot nemrtvých AI: kdo by na něm seděl, přesune se jinam
  const hell = map.coop ? map.coop.ai : -1;
  if (hell >= 0 && next[hell].kind === "human") humans.push(next[hell]);
  if (hell >= 0) next[hell] = { kind: "ai", client: null };

  for (const slot of humans) {
    const free = next.findIndex((s, i) => s.kind !== "human" && i !== hell);
    next[free] = slot;
  }

  room.map = map;
  room.slots = next;
}

function startMatch(room) {
  const players = room.slots.map((slot, i) => {
    if (slot.kind === "human") return { name: slot.client.name };
    if (slot.kind === "ai") return { name: room.map.coop && room.map.coop.ai === i ? R.UNDEAD.short : `AI ${R.TEAM_NAMES[R.TEAMS[i]]}`, ai: true };
    return null;
  });

  room.match = new Match(room.map, players);
  room.started = Date.now();
  room.cmds = {};
  room.out = {};
  room.timeline = { every: TIMELINE_STEP, next: 0, t: [], series: {} };
  matches.add(room);

  // Kdo hrál, se pamatuje i po odchodu z místnosti (pro statistiky).
  room.participants = [];
  players.forEach((p, i) => {
    if (p) room.participants.push({ slot: i, name: p.name, ai: !!p.ai, userId: p.ai ? null : room.slots[i].client.user.id });
  });

  const roster = players.map((p, slot) => (p ? { slot, name: p.name, ai: !!p.ai } : null)).filter(Boolean);
  room.roster = roster;

  room.slots.forEach((slot, i) => {
    if (slot.kind !== "human") return;
    slot.client.team = R.TEAMS[i];
    send(slot.client, { t: "match", map: room.map.id, slot: i, players: roster });
  });

  broadcastRooms();
}

function closeRoom(room) {
  endWatch(room);
  matches.delete(room);
  rooms.delete(room.id);
  broadcastRooms();
}

/* ---------- průběh zápasu pro statistiky ---------- */
const TIMELINE_STEP = 10; // s herního času mezi vzorky
const TIMELINE_MAX = 180; // víc vzorků se prořeďuje (každý druhý pryč, krok ×2)
const ARMY = new Set(["soldier", "archer", "hero", "monk", "knight", "catapult"]);

// Jeden vzorek: pro každý tým armáda, dělníci, budovy, natěžené suroviny, zásoba a zabití.
function sampleTimeline(room) {
  const match = room.match;
  const tl = room.timeline;
  if (!tl || !match) return;

  const per = {};
  for (const p of room.participants) per[p.slot] = { army: 0, workers: 0, buildings: 0 };

  for (const u of match.units) {
    const row = per[R.TEAMS.indexOf(u.team)];
    if (!row || u.hp <= 0) continue;
    if (u.type === "worker") row.workers++;
    else if (ARMY.has(u.type)) row.army++;
  }

  for (const b of match.buildings) {
    const row = per[R.TEAMS.indexOf(b.team)];
    if (row && b.hp > 0 && b.progress >= 1) row.buildings++;
  }

  tl.t.push(Math.round(match.elapsed));

  for (const p of room.participants) {
    const team = R.TEAMS[p.slot];
    const s = match.stats[team] || {};
    const eco = match.econ[team] || {};
    const series = tl.series[p.slot] || (tl.series[p.slot] = { army: [], workers: [], buildings: [], gold: [], wood: [], bank: [], kills: [] });
    const row = per[p.slot];

    series.army.push(row.army);
    series.workers.push(row.workers);
    series.buildings.push(row.buildings);
    series.gold.push(s.gold || 0);
    series.wood.push(s.wood || 0);
    series.bank.push(Math.round((eco.gold || 0) + (eco.wood || 0)));
    series.kills.push(s.kills || 0);
  }

  if (tl.t.length > TIMELINE_MAX) {
    const keep = (_, i) => i % 2 === 0 || i === tl.t.length - 1;
    tl.t = tl.t.filter(keep);
    for (const series of Object.values(tl.series)) for (const key of Object.keys(series)) series[key] = series[key].filter(keep);
    tl.every *= 2;
  }

  tl.next = match.elapsed + tl.every;
}

// Události z posledního kroku (vypadnutí hráče) si poznamenáme, než je simulace smaže.
function trackEvents(room) {
  const match = room.match;

  for (const e of match.events) {
    if (e.e === "out" && room.out[e.t] == null) room.out[e.t] = { at: match.elapsed, why: e.why };
  }

  if (match.phase === "playing" && match.elapsed >= room.timeline.next) sampleTimeline(room);
}

// Zapíše výsledek zápasu do statistik hráčů (jednou, a ne když zápas zrušil admin).
function recordMatch(room) {
  const match = room.match;
  if (!match || match.recorded || !room.participants) return;
  match.recorded = true;

  // závěrečný vzorek, aby graf končil přesně koncem zápasu
  const tl = room.timeline;
  if (tl && tl.t[tl.t.length - 1] !== Math.round(match.elapsed)) sampleTimeline(room);

  const recorded = stats.record({
    map: room.map.id,
    started: room.started,
    duration: match.elapsed,
    reason: match.reason,
    winner: match.winner ? R.TEAMS.indexOf(match.winner) : -1,
    winners: (match.winners || []).map(t => R.TEAMS.indexOf(t)),
    coop: !!room.map.coop,
    timeline: tl && tl.t.length > 1 ? { every: tl.every, t: tl.t, series: tl.series } : null,
    players: room.participants.map(p => {
      const team = R.TEAMS[p.slot];
      const out = room.out[p.slot];
      return {
        ...p,
        stats: match.stats[team],
        upgrades: match.upgrades[team],
        cmds: room.cmds[p.slot] || 0,
        outAt: out ? out.at : null,
        outWhy: out ? out.why : ""
      };
    })
  });

  if (recorded) traffic.match(recorded);
}

// Po konci zápasu se hráči vrátí do místnosti.
function endMatch(room) {
  endWatch(room);
  matches.delete(room);
  room.match = null;

  for (const client of humansOf(room)) client.team = null;

  sendRoom(room);
  broadcastRooms();
}

function leaveRoom(client) {
  const room = client.room;
  if (!room) return;

  const i = slotIndex(room, client);
  if (client.talking) voiceTalk(client, room, false);
  client.room = null;
  client.team = null;
  if (i >= 0) room.slots[i] = { kind: "open", client: null };

  const rest = humansOf(room);

  if (!rest.length) {
    if (room.match) {
      room.match.finish(null, "abandoned");
      recordMatch(room);
    }
    closeRoom(room);
    return;
  }

  if (room.host === client) room.host = rest[0];
  for (const human of rest) chatNote(human, `${client.name} opustil místnost.`);

  if (room.match) {
    room.match.resign(R.TEAMS[i], "disconnect");
    flush(room);
  }

  if (rooms.has(room.id) && !room.match) sendRoom(room);
  else if (rooms.has(room.id)) sendVoice(room);
  broadcastRooms();
}

// Připíše přihlášenému hráči dobu připojení od posledního zápisu (průběžně i při odpojení, aby se při pádu serveru ztratila nejvýš minuta).
function creditOnline(client) {
  const now = Date.now();
  if (client.user) accounts.addOnline(client.user, (now - client.onlineFrom) / 1000);
  client.onlineFrom = now;
}

// Odpojí klienta (s vysvětlením, pokud je vyhozen) a uklidí po něm místnost i evidenci online hráčů.
function disconnect(client, text) {
  if (client.closed) return;
  client.closed = true;

  if (text) send(client, { t: "error", text });

  clients.delete(client);
  creditOnline(client);

  if (client.user && byUser.get(client.user.id) === client) {
    byUser.delete(client.user.id);
    accounts.touch(client.user);
  }

  unwatch(client);
  leaveRoom(client);
  broadcastRooms();

  if (text) {
    client.ws.close(4001, "kicked");
    setTimeout(() => client.ws.terminate(), 2000).unref();
  }
}

/* ---------- nástroje pro admin panel ---------- */
Object.assign(live, {
  isOnline: userId => byUser.has(userId),

  // Po změně map nebo jejich nastavení: hráči v lobby dostanou nový seznam povolených map.
  mapsChanged() {
    const text = JSON.stringify({ t: "maps", off: mapConfig.off() });
    for (const client of clients) send(client, text);
    lastRooms = "";
    broadcastRooms();
  },

  counts: () => ({
    online: clients.size,
    authed: byUser.size,
    rooms: rooms.size,
    matchesRunning: matches.size,
    playing: [...matches].reduce((n, room) => n + humansOf(room).length, 0),
    startedAt: STARTED
  }),

  rooms: () => [...rooms.values()].map(room => ({
    id: room.id,
    map: room.map.id,
    state: room.match ? "playing" : "lobby",
    host: room.host.name,
    players: humansOf(room).map(c => c.name),
    slots: room.slots.map(s => s.kind)
  })),

  clients: () => [...clients].map(c => ({ id: c.id, userId: c.user ? c.user.id : null, name: c.user ? c.user.name : "", ip: c.ip, place: geo.lookup(c.ip), room: c.room ? c.room.id : null })),

  kickUser(userId, text) {
    const client = byUser.get(userId);
    if (client) disconnect(client, text);
  },

  // Po změně jména nebo role se promítne nový stav do spojení.
  refreshUser(user) {
    const client = byUser.get(user.id);
    if (!client) return;

    client.name = user.name;
    if (client.room && !client.room.match) sendRoom(client.room);
    broadcastRooms();
  },

  kickClient(id, admin) {
    const client = [...clients].find(c => c.id === id);
    if (!client) return false;

    accounts.audit(admin, "kick", client.user ? `${client.user.name} (#${client.user.id})` : `klient ${client.id}`);
    disconnect(client, "Byl jsi odpojen administrátorem.");
    return true;
  },

  // Zrušená místnost se nezapisuje do statistik.
  closeRoom(id, admin) {
    const room = rooms.get(id);
    if (!room) return false;

    accounts.audit(admin, "close-room", `místnost ${room.id} (${room.map.id})`);
    if (room.match) room.match.recorded = true;
    for (const client of humansOf(room)) disconnect(client, "Místnost byla uzavřena administrátorem.");
    return true;
  }
});

wss.on("connection", (ws, req) => {
  if (clients.size >= MAX_CLIENTS) {
    ws.close(1013, "Server je plný");
    return;
  }

  // Účet se pozná podle cookie; spojení z cizi stránky účet nedostane.
  const user = sameOrigin(req, PUBLIC_URL) ? accounts.userFromToken(parseCookies(req.headers.cookie)[SID]) : null;

  const client = {
    id: nextClientId++,
    ws,
    user,
    ip: clientIp(req),
    name: user ? user.name : "Host",
    room: null,
    team: null,
    alive: true,
    closed: false,
    watching: null,
    windowStart: Date.now(),
    windowCount: 0,
    onlineFrom: Date.now()
  };

  // Jeden účet má jen jedno spojení: nové vytlačí staré (jiná záložka, zapomenutý výpadek).
  if (user) {
    const previous = byUser.get(user.id);
    if (previous) disconnect(previous, "Načtené v jiné záložce nebo na jiném zařízení.");
    byUser.set(user.id, client);
    accounts.touch(user);
  }

  clients.add(client);
  traffic.connection(client.ip, req.headers["user-agent"], user, clients.size);
  send(client, {
    t: "hello",
    list: roomList(),
    playing: [...matches].reduce((n, r) => n + humansOf(r).length, 0),
    live: liveList(),
    online: clients.size,
    off: mapConfig.off(),
    ice: ICE_SERVERS,
    me: user ? { id: user.id, name: user.name, role: user.role } : null
  });
  broadcastRooms();

  ws.on("pong", () => { client.alive = true; });

  ws.on("message", (data, isBinary) => {
    if (isBinary || client.closed) return;

    const now = Date.now();

    if (now - client.windowStart > 1000) {
      client.windowStart = now;
      client.windowCount = 0;
    }

    if (++client.windowCount > MAX_MSG_PER_SEC) {
      if (client.windowCount > MAX_MSG_PER_SEC * 4) ws.terminate();
      return;
    }

    let msg;

    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      return;
    }

    if (!msg || typeof msg !== "object") return;

    const room = client.room;

    if (msg.t === "cmd") {
      if (room && room.match) {
        room.match.command(client.team, msg);
        const slot = R.TEAMS.indexOf(client.team);
        if (slot >= 0 && room.cmds) room.cmds[slot] = (room.cmds[slot] || 0) + 1;
      }
      return;
    }

    if (msg.t === "chat") {
      if (room) chatSay(client, room, msg.text);
      return;
    }

    if (msg.t === "admin") {
      if (room) adminCommand(client, room, cleanChat(msg.text), false);
      return;
    }

    if (msg.t === "talk") {
      if (room) voiceTalk(client, room, msg.on === true);
      return;
    }

    if (msg.t === "rtc") {
      if (room) voiceRelay(client, room, msg);
      return;
    }

    if (msg.t === "watch") {
      if (room) return;
      const target = rooms.get(Number(msg.room));
      if (!target || !target.match || target.match.phase === "ended") return fail(client, "Tenhle zápas už neběží.");
      if (client.watching === target) return;
      if (target.spectators.size >= MAX_SPECTATORS) return fail(client, "Zápas sleduje příliš mnoho diváků.");

      unwatch(client);
      client.watching = target;
      target.spectators.add(client);
      send(client, { t: "match", map: target.map.id, slot: -1, spectate: true, players: target.roster });
      broadcastRooms();
      return;
    }

    if (msg.t === "create") {
      if (room) return;
      if (!client.user) return fail(client, "Pro multiplayer se přihlas.");
      unwatch(client);
      const map = MAPS.get(String(msg.map));
      if (!map) return fail(client, "Neznámá mapa.");
      if (!mapConfig.multiplayer(map.id)) return fail(client, "Tato mapa není pro multiplayer povolená.");
      if (rooms.size >= MAX_ROOMS) return fail(client, "Server je plný, zkus to později.");

      sendRoom(createRoom(client, map));
      broadcastRooms();
    } else if (msg.t === "join") {
      if (room) return;
      if (!client.user) return fail(client, "Pro multiplayer se přihlas.");
      unwatch(client);
      const target = rooms.get(Number(msg.room));
      if (!target || target.match) return fail(client, "Místnost už neexistuje nebo hra běží.");

      const free = target.slots.findIndex(s => s.kind === "open");
      if (free < 0) return fail(client, "Místnost je plná.");

      target.slots[free] = { kind: "human", client };
      client.room = target;
      sendRoom(target);
      if (target.chat.length) send(client, { t: "chatlog", list: target.chat });
      for (const human of humansOf(target)) if (human !== client) chatNote(human, `${client.name} se připojil.`);
      broadcastRooms();
    } else if (msg.t === "leave") {
      unwatch(client);
      leaveRoom(client);
      send(client, { t: "left" });
      send(client, roomsText());
    } else if (room && !room.match && room.host === client) {
      if (msg.t === "map") {
        const map = MAPS.get(String(msg.map));
        if (!map) return fail(client, "Neznámá mapa.");
        if (!mapConfig.multiplayer(map.id)) return fail(client, "Tato mapa není pro multiplayer povolená.");
        if (humansOf(room).length > (map.humans || map.slots.length)) return fail(client, "Na té mapě je méně míst, než je v místnosti hráčů.");

        changeMap(room, map);
        sendRoom(room);
        broadcastRooms();
      } else if (msg.t === "slot") {
        const i = Number(msg.i);
        const slot = Number.isInteger(i) ? room.slots[i] : null;
        if (!slot || slot.kind === "human" || !["open", "ai", "closed"].includes(msg.kind)) return;
        if (room.map.coop && room.map.coop.ai === i) return; // nemrtví zůstávají

        room.slots[i] = { kind: msg.kind, client: null };
        sendRoom(room);
        broadcastRooms();
      } else if (msg.t === "start") {
        const teams = room.slots.filter(s => s.kind === "human" || s.kind === "ai").length;
        if (teams < 2) return fail(client, "Pro hru jsou potřeba aspoň dvě strany.");

        startMatch(room);
      }
    }
  });

  ws.on("close", () => {
    if (!client.closed) disconnect(client);
  });

  ws.on("error", () => ws.terminate());
});

/* ---------- game loop ---------- */
function flush(room) {
  const match = room.match;

  // Suroviny (hlavně stromy) se skoro nemění, proto plný seznam jen jednou za sekundu, jinak jen změny.
  const full = (room.tickNo = (room.tickNo || 0) + 1) % 20 === 1;

  room.slots.forEach((slot, i) => {
    if (slot.kind === "human" && slot.client) send(slot.client, match.snapshot(R.TEAMS[i], full));
  });

  // Diváci dostávají stejný snímek bez soukromých zpráv; jeden společný pro všechny.
  if (room.spectators.size) {
    const spec = match.snapshot(R.TEAMS[room.roster[0].slot], full);
    spec.n = [];
    // suroviny, limit jednotek a vylepšení každého týmu: [slot, zlato, dřevo, limit, zbroj, zbraně]
    spec.ec = room.roster.map(p => {
      const team = R.TEAMS[p.slot];
      const eco = match.econ[team] || { gold: 0, wood: 0 };
      const up = match.upgrades[team] || {};
      return [p.slot, Math.floor(eco.gold || 0), Math.floor(eco.wood || 0), match.supplyCap(team), up.armor || 0, up.weapon || 0];
    });
    const text = JSON.stringify(spec);
    for (const client of room.spectators) send(client, text);
  }

  trackEvents(room);
  const finished = match.phase === "ended";
  if (finished) recordMatch(room);
  match.endTick();
  if (finished) endMatch(room);
}

let last = process.hrtime.bigint();
let accumulator = 0;

setInterval(() => {
  const now = process.hrtime.bigint();
  accumulator += Number(now - last) / 1e9;
  last = now;

  if (accumulator > TICK * 5) accumulator = TICK * 5;

  while (accumulator >= TICK) {
    accumulator -= TICK;

    for (const room of [...matches]) {
      // příkaz správce /speed: víc kroků simulace za jeden tik
      for (let i = 0; i < (room.match.speed || 1) && room.match.phase !== "ended"; i++) room.match.step(TICK);
      flush(room);
    }
  }
}, 10);

setInterval(() => {
  for (const client of clients) {
    if (!client.alive) {
      client.ws.terminate();
      continue;
    }

    client.alive = false;
    client.ws.ping();
  }
}, 20000);

setInterval(() => {
  for (const client of clients) creditOnline(client);
}, 60000).unref();

mapstore.load();
traffic.startSampling(live.counts);

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(0));
process.on("exit", () => {
  for (const client of clients) creditOnline(client); // restart serveru (pm2) nesmaže rozehraný online čas
  store.flush();
});

// Účet admina se založí při prvním startu; heslo je z GORALIA_ADMIN_PASSWORD, jinak náhodné a vypíše se jen jednou.
accounts.seedAdmin(process.env.GORALIA_ADMIN_PASSWORD).then(seed => {
  server.listen(PORT, () => {
    console.log(`Goralia běží na http://localhost:${PORT}`);

    if (!seed) return;
    console.log(`Založen účet admina: ${seed.user.name} (${seed.user.email}).`);
    if (seed.generated) console.log(`Heslo admina (zobrazí se jen jednou, po přihlášení si ho změň): ${seed.password}`);
  });
}, err => {
  console.error(err.message);
  process.exit(1);
});
