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
const MAPS = require("../js/maps.js");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIRS = ["css", "js", "assets"];
const MAX_CLIENTS = 400;
const MAX_ROOMS = 100;
const MAX_MSG_PER_SEC = 80;
const BUFFER_LIMIT = 2 * 1024 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

/* ---------- static files ---------- */
const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    return res.end();
  }

  let pathname;

  try {
    pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  } catch (e) {
    res.writeHead(400);
    return res.end();
  }

  if (pathname === "/") pathname = "/index.html";

  const file = path.resolve(ROOT, "." + pathname);
  const rel = path.relative(ROOT, file).split(path.sep);
  const allowed = rel.length === 1 ? rel[0] === "index.html" : PUBLIC_DIRS.includes(rel[0]);

  if (!allowed || rel.includes("..")) {
    res.writeHead(404);
    return res.end("Not found");
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }

    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(req.method === "HEAD" ? undefined : data);
  });
});

/* ---------- lobby ---------- */
const wss = new WebSocketServer({ server, maxPayload: 4096 });
const clients = new Set();
const rooms = new Map();
const matches = new Set();
let lastRooms = "";
let nextClientId = 1;
let nextRoomId = 1;

function cleanName(value) {
  const name = String(value || "")
    .normalize("NFD")
    .replace(/[^A-Za-z0-9 _.-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 14);

  return name || "Hrac";
}

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
    list.push({ id: room.id, map: room.map.id, host: room.host.name, players: humansOf(room).length, max: room.slots.length });
  }

  return list;
}

function broadcastRooms() {
  const playing = [...matches].reduce((n, room) => n + humansOf(room).length, 0);
  const text = JSON.stringify({ t: "rooms", list: roomList(), playing });
  if (text === lastRooms) return;
  lastRooms = text;

  for (const client of clients) {
    if (!client.room) send(client, text);
  }
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
}

function createRoom(host, map) {
  const room = {
    id: nextRoomId++,
    map,
    host,
    match: null,
    slots: map.slots.map(() => ({ kind: "open", client: null }))
  };

  room.slots[0] = { kind: "human", client: host };
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

  for (const slot of humans) {
    const free = next.findIndex(s => s.kind !== "human");
    next[free] = slot;
  }

  room.map = map;
  room.slots = next;
}

function startMatch(room) {
  const players = room.slots.map((slot, i) => {
    if (slot.kind === "human") return { name: slot.client.name };
    if (slot.kind === "ai") return { name: `AI ${R.TEAM_NAMES[R.TEAMS[i]]}`, ai: true };
    return null;
  });

  room.match = new Match(room.map, players);
  matches.add(room);

  const roster = players.map((p, slot) => (p ? { slot, name: p.name, ai: !!p.ai } : null)).filter(Boolean);

  room.slots.forEach((slot, i) => {
    if (slot.kind !== "human") return;
    slot.client.team = R.TEAMS[i];
    send(slot.client, { t: "match", map: room.map.id, slot: i, players: roster });
  });

  broadcastRooms();
}

function closeRoom(room) {
  matches.delete(room);
  rooms.delete(room.id);
  broadcastRooms();
}

// Po konci zápasu se hráči vrátí do místnosti.
function endMatch(room) {
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
  client.room = null;
  client.team = null;
  if (i >= 0) room.slots[i] = { kind: "open", client: null };

  const rest = humansOf(room);

  if (!rest.length) {
    if (room.match) room.match.finish(null, "abandoned");
    closeRoom(room);
    return;
  }

  if (room.host === client) room.host = rest[0];

  if (room.match) {
    room.match.resign(R.TEAMS[i], "disconnect");
    flush(room);
  }

  if (rooms.has(room.id) && !room.match) sendRoom(room);
  broadcastRooms();
}

wss.on("connection", ws => {
  if (clients.size >= MAX_CLIENTS) {
    ws.close(1013, "Server je plný");
    return;
  }

  const client = {
    id: nextClientId++,
    ws,
    name: "Hrac",
    room: null,
    team: null,
    alive: true,
    windowStart: Date.now(),
    windowCount: 0
  };

  clients.add(client);
  send(client, { t: "hello", list: roomList(), playing: [...matches].reduce((n, r) => n + humansOf(r).length, 0) });

  ws.on("pong", () => { client.alive = true; });

  ws.on("message", (data, isBinary) => {
    if (isBinary) return;

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
      if (room && room.match) room.match.command(client.team, msg);
      return;
    }

    if (msg.t === "create") {
      if (room) return;
      const map = MAPS.get(String(msg.map));
      if (!map) return fail(client, "Neznámá mapa.");
      if (rooms.size >= MAX_ROOMS) return fail(client, "Server je plný, zkus to později.");

      client.name = cleanName(msg.name);
      sendRoom(createRoom(client, map));
      broadcastRooms();
    } else if (msg.t === "join") {
      if (room) return;
      const target = rooms.get(Number(msg.room));
      if (!target || target.match) return fail(client, "Místnost už neexistuje nebo hra běží.");

      const free = target.slots.findIndex(s => s.kind === "open");
      if (free < 0) return fail(client, "Místnost je plná.");

      client.name = cleanName(msg.name);
      target.slots[free] = { kind: "human", client };
      client.room = target;
      sendRoom(target);
      broadcastRooms();
    } else if (msg.t === "leave") {
      leaveRoom(client);
      send(client, { t: "left" });
    } else if (room && !room.match && room.host === client) {
      if (msg.t === "map") {
        const map = MAPS.get(String(msg.map));
        if (!map) return fail(client, "Neznámá mapa.");
        if (humansOf(room).length > map.slots.length) return fail(client, "Na té mapě je méně míst, než je v místnosti hráčů.");

        changeMap(room, map);
        sendRoom(room);
        broadcastRooms();
      } else if (msg.t === "slot") {
        const i = Number(msg.i);
        const slot = Number.isInteger(i) ? room.slots[i] : null;
        if (!slot || slot.kind === "human" || !["open", "ai", "closed"].includes(msg.kind)) return;

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
    clients.delete(client);
    leaveRoom(client);
  });

  ws.on("error", () => ws.terminate());
});

/* ---------- game loop ---------- */
function flush(room) {
  const match = room.match;

  room.slots.forEach((slot, i) => {
    if (slot.kind === "human" && slot.client) send(slot.client, match.snapshot(R.TEAMS[i]));
  });

  const finished = match.phase === "ended";
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
      room.match.step(TICK);
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

server.listen(PORT, () => {
  console.log(`Goralia běží na http://localhost:${PORT}`);
});
