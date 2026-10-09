/*
 * Server hry: statické soubory, matchmaking 1v1 a autoritativní běh zápasů.
 * Spuštění: npm install && npm start  (port z proměnné PORT, výchozí 3000)
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const { Match, TICK } = require("./sim.js");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIRS = ["css", "js", "assets"];
const MAX_CLIENTS = 400;
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
let queue = [];
const matches = new Set();
let lastStats = "";
let nextClientId = 1;

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

function broadcastStats() {
  const playing = [...matches].length * 2;
  const text = JSON.stringify({ t: "stats", queued: queue.length, playing });
  if (text === lastStats) return;
  lastStats = text;

  for (const client of clients) {
    if (client.state !== "playing") send(client, text);
  }
}

function leaveQueue(client) {
  const i = queue.indexOf(client);
  if (i >= 0) queue.splice(i, 1);
  if (client.state === "queued") client.state = "idle";
}

function startMatch(a, b) {
  const [blue, red] = Math.random() < 0.5 ? [a, b] : [b, a];
  const match = new Match({ blue: blue.name, red: red.name });

  match.players = { blue, red };
  blue.state = red.state = "playing";
  blue.match = red.match = match;
  blue.team = "blue";
  red.team = "red";
  matches.add(match);

  send(blue, { t: "match", team: "blue", you: blue.name, opponent: red.name });
  send(red, { t: "match", team: "red", you: red.name, opponent: blue.name });
}

function tryMatch() {
  while (queue.length >= 2) {
    const a = queue.shift();
    const b = queue.shift();
    startMatch(a, b);
  }

  broadcastStats();
}

function endMatch(match) {
  matches.delete(match);

  for (const client of Object.values(match.players)) {
    client.match = null;
    client.team = null;
    if (client.state === "playing") client.state = "idle";
  }

  broadcastStats();
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
    state: "idle",
    match: null,
    team: null,
    alive: true,
    windowStart: Date.now(),
    windowCount: 0
  };

  clients.add(client);
  send(client, { t: "hello", queued: queue.length, playing: matches.size * 2 });

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

    if (msg.t === "queue") {
      if (client.state !== "idle") return;
      client.name = cleanName(msg.name);
      client.state = "queued";
      queue.push(client);
      send(client, { t: "queued" });
      tryMatch();
    } else if (msg.t === "unqueue") {
      if (client.state === "queued") {
        leaveQueue(client);
        send(client, { t: "unqueued" });
        broadcastStats();
      }
    } else if (msg.t === "cmd") {
      if (client.match) client.match.command(client.team, msg);
    }
  });

  ws.on("close", () => {
    clients.delete(client);
    leaveQueue(client);

    const match = client.match;

    if (match && match.phase !== "ended") {
      match.finish(client.team === "blue" ? "red" : "blue", "disconnect");
      flush(match);
    }

    broadcastStats();
  });

  ws.on("error", () => ws.terminate());
});

/* ---------- game loop ---------- */
function flush(match) {
  for (const team of ["blue", "red"]) {
    const client = match.players[team];
    send(client, match.snapshot(team));
  }

  const finished = match.phase === "ended";
  match.endTick();
  if (finished) endMatch(match);
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

    for (const match of [...matches]) {
      match.step(TICK);
      flush(match);
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
  console.log(`Pixelové království běží na http://localhost:${PORT}`);
});
