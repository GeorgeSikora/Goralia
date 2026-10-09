/*
 * Testy: data map, simulace s AI a server (místnosti, 1v1 i více hráčů, ověřování příkazů).
 * Spuštění: npm test
 */
"use strict";

const assert = require("assert");
const http = require("http");
const { spawn } = require("child_process");
const path = require("path");
const WebSocket = require("ws");
const MAPS = require("../js/maps.js");
const R = require("../js/rules.js");
const { Match, TICK } = require("../js/sim.js");

const PORT = 3100 + Math.floor(Math.random() * 500);
const URL = `ws://localhost:${PORT}`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- data map ---------- */
function testMaps() {
  assert(MAPS.list.length >= 3, "aspoň tři mapy");
  assert(MAPS.list.some(m => m.players >= 3), "aspoň jedna mapa pro víc než dva hráče");

  for (const map of MAPS.list) {
    const LW = map.size[0] * 2;
    const LH = map.size[1] * 2;
    const label = `mapa ${map.id}`;

    assert.strictEqual(map.slots.length, map.players, `${label}: počet slotů`);
    assert(map.players >= 2 && map.players <= R.MAX_PLAYERS, `${label}: 2 až ${R.MAX_PLAYERS} hráči`);
    assert(map.name && map.description && map.tag, `${label}: název, popis a štítek`);
    assert(MAPS.get(map.id) === map);

    const inside = (x, y, margin = 30) => x >= margin && x <= LW - margin && y >= margin && y <= LH - margin;

    map.slots.forEach((slot, i) => {
      assert.strictEqual(slot.hq.type, R.HQ[R.TEAMS[i]], `${label}: typ základny slotu ${i}`);
      const z = slot.zone;
      assert(z.x0 < z.x1 && z.y0 < z.y1 && z.x0 >= 0 && z.x1 <= LW && z.y1 <= LH, `${label}: zóna slotu ${i}`);

      for (const b of [slot.hq, ...slot.buildings]) {
        assert(inside(b.x, b.y), `${label}: budova slotu ${i} v mapě`);
        assert(b.x >= z.x0 && b.x <= z.x1 && b.y >= z.y0 && b.y <= z.y1, `${label}: budova slotu ${i} ve vlastní zóně`);
      }

      for (const u of slot.units) assert(inside(u.x, u.y, 12), `${label}: jednotka slotu ${i} v mapě`);

      slot.zone && map.slots.forEach((other, j) => {
        if (j <= i) return;
        const o = other.zone;
        const overlap = z.x0 < o.x1 && o.x0 < z.x1 && z.y0 < o.y1 && o.y0 < z.y1;
        assert(!overlap, `${label}: zóny slotů ${i} a ${j} se nesmí překrývat`);
      });
    });

    const resources = [...map.gold, ...map.trees];
    for (const [x, y] of resources) assert(inside(x, y, 12), `${label}: surovina v mapě`);

    map.gold.forEach(([x, y], i) => {
      map.gold.forEach(([x2, y2], j) => {
        if (j > i) assert(Math.hypot(x - x2, y - y2) > 60, `${label}: doly se nesmí dotýkat`);
      });

      for (const s of map.slots) {
        assert(Math.hypot(x - s.hq.x, y - s.hq.y) > 100, `${label}: důl uvnitř základny`);
      }
    });

    for (const s of map.slots) {
      const own = map.gold.filter(([x, y]) => Math.hypot(x - s.hq.x, y - s.hq.y) < 450).length;
      assert(own >= 2, `${label}: každý hráč má aspoň dva doly poblíž`);
    }

    assert(map.terrain && Array.isArray(map.terrain.roads) && map.terrain.doodads, `${label}: recept terénu`);
  }
}

/* ---------- simulace a AI ---------- */
function testSimulation() {
  // samá AI: celá hra běží bez chyby, ekonomika roste a nikdo nevyhraje v první minutě
  for (const map of MAPS.list) {
    const players = map.slots.map((_, i) => ({ name: `AI${i}`, ai: true }));
    const match = new Match(map, players, { countdown: 0 });
    assert.strictEqual(match.phase, "playing");

    let t = 0;
    while (t < 90 && match.phase !== "ended") {
      match.step(TICK);
      match.endTick();
      t += TICK;
    }

    assert.strictEqual(match.phase, "playing", `${map.id}: AI hra neskončí během 90 s`);
    for (const team of match.active) {
      const workers = match.units.filter(u => u.team === team && u.type === "worker").length;
      assert(workers >= 3, `${map.id}: AI ${team} cvičí dělníky`);
    }
  }

  // eliminace: hráč bez HQ vypadne, hra pokračuje, vítěz je poslední
  const map = MAPS.get("highland");
  const match = new Match(map, [{ name: "A" }, { name: "B" }, { name: "C" }], { countdown: 0 });
  const blue = match.hqOf("blue");
  blue.hp = 0;
  match.step(TICK);
  assert(match.out.has("blue"), "modrý vypadl");
  assert.strictEqual(match.phase, "playing", "hra pokračuje pro zbylé hráče");
  assert(!match.units.some(u => u.team === "blue") && !match.buildings.some(b => b.team === "blue"), "majetek vyřazeného zmizí");
  assert(match.events.some(e => e.e === "out" && e.t === 0));

  match.hqOf("red").hp = 0;
  match.step(TICK);
  assert.strictEqual(match.phase, "ended");
  assert.strictEqual(match.winner, "gold");

  // současný pád všech zbylých = remíza
  const draw = new Match(MAPS.get("valley"), [{ name: "A" }, { name: "B" }], { countdown: 0 });
  draw.hqOf("blue").hp = 0;
  draw.hqOf("red").hp = 0;
  draw.step(TICK);
  assert.strictEqual(draw.phase, "ended");
  assert.strictEqual(draw.winner, null);

  testEconomy();
}

function testEconomy() {
  const run = (m, seconds) => { for (let t = 0; t < seconds; t += TICK) { m.step(TICK); m.endTick(); } };
  const newMatch = () => new Match(MAPS.get("valley"), [{ name: "A" }, { name: "B" }], { countdown: 0 });
  const workerOf = m => m.units.find(u => u.team === "blue" && u.type === "worker");

  // zlatý důl je konečný, po vyčerpání zůstane prázdný
  let m = newMatch();
  const mine = m.resources.find(r => r.type === "gold" && r.x < 480);
  assert.strictEqual(mine.amount, R.GOLD_AMOUNT);
  mine.amount = 20;
  for (const r of m.resources) if (r.type === "gold" && r !== mine) r.amount = 0;
  const gold0 = m.econ.blue.gold;
  const w = workerOf(m);
  m.command("blue", { c: "order", k: "gather", ids: [w.id], target: mine.id });
  run(m, 60);
  assert.strictEqual(mine.amount, 0, "důl se vyčerpal");
  assert(m.resources.includes(mine), "prázdný důl zůstává ve hře");
  assert.strictEqual(m.econ.blue.gold, gold0 + 20, "vytěženo přesně to, co v dolu bylo");
  assert(!w.order, "dělník bez další zásoby skončí");
  m.command("blue", { c: "order", k: "gather", ids: [w.id], target: mine.id });
  assert(!w.order, "na prázdný důl se těžit nedá");

  // vyčerpaný strom: dělník plynule přejde na nejbližší další
  m = newMatch();
  const hq = m.hqOf("blue");
  const trees = m.resources.filter(r => r.type === "wood").sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y));
  trees[0].amount = 10;
  const wood0 = m.econ.blue.wood;
  const w2 = workerOf(m);
  m.command("blue", { c: "order", k: "gather", ids: [w2.id], target: trees[0].id });
  run(m, 40);
  assert(!m.resources.includes(trees[0]), "první strom zmizel");
  assert(w2.order && w2.order.type === "gather" && w2.order.target !== trees[0], "těží další strom");
  assert(m.econ.blue.wood > wood0 + 10, "dřevo přibývá i po prvním stromu");

  // ruční odevzdání: dělník s nákladem na rozkaz dojde k základně, vyloží a vrátí se k těžbě
  m = newMatch();
  const w3 = workerOf(m);
  const tree = m.resources.find(r => r.type === "wood" && r.x < 480);
  m.command("blue", { c: "order", k: "gather", ids: [w3.id], target: tree.id });
  while (!w3.carry) run(m, TICK);
  const wood1 = m.econ.blue.wood;
  m.command("blue", { c: "order", k: "deliver", ids: [w3.id], target: m.hqOf("blue").id });
  assert.strictEqual(w3.order.type, "deliver");
  run(m, 0.2);
  assert.strictEqual(m.econ.blue.wood, wood1, "ještě nedošel");
  while (w3.order && w3.order.type === "deliver") run(m, TICK);
  assert.strictEqual(m.econ.blue.wood, wood1 + 10, "náklad vyložen");
  assert(!w3.carry);
  assert(w3.order && w3.order.type === "gather", "po vyložení se vrací k těžbě");

  // cizí základna ani soupeřův dělník se neposlouchá
  const foeHq = m.hqOf("red");
  m.command("blue", { c: "order", k: "deliver", ids: [w3.id], target: foeHq.id });
  assert(!w3.order || w3.order.type !== "deliver", "odevzdat jde jen u vlastní základny");
}

/* ---------- server ---------- */
class Bot {
  constructor(name) {
    this.name = name;
    this.snap = null;
    this.msgs = [];
    this.errors = [];
    this.outs = [];
    this.ended = null;
    this.match = null;
    this.room = null;
    this.list = null;
    this.ws = new WebSocket(URL);
    this.opened = new Promise(r => this.ws.on("open", r));
    this.ws.on("message", data => {
      const m = JSON.parse(data);
      this.msgs.push(m);
      if (m.t === "hello" || m.t === "rooms") this.list = m.list;
      if (m.t === "room") this.room = m;
      if (m.t === "error") this.errors.push(m.text);
      if (m.t === "match") this.match = m;
      if (m.t === "s") {
        this.snap = m;
        for (const e of m.e) {
          if (e.e === "end") this.ended = e;
          if (e.e === "out") this.outs.push(e);
        }
      }
    });
  }

  send(o) { this.ws.send(JSON.stringify(o)); }
  cmd(o) { this.send({ t: "cmd", ...o }); }

  async until(fn, ms = 5000, label = "podmínka") {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await sleep(25);
    }
    throw new Error(`Timeout: ${label}`);
  }

  units(slot) { return this.snap.u.filter(u => u[2] === slot); }
  notes() { return this.msgs.filter(m => m.t === "s").flatMap(m => m.n); }
  resetMatch() { this.match = null; this.snap = null; this.ended = null; this.outs = []; this.room = null; }
}

async function testServer() {
  const proc = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "inherit"]
  });

  const bots = [];
  const bot = name => {
    const b = new Bot(name);
    bots.push(b);
    return b;
  };

  try {
    await new Promise(r => proc.stdout.once("data", r));

    // statické soubory: jen veřejné adresáře
    const get = p => new Promise((resolve, reject) => {
      http.get({ host: "localhost", port: PORT, path: p }, res => {
        res.resume();
        resolve(res.statusCode);
      }).on("error", reject);
    });
    assert.strictEqual(await get("/"), 200);
    assert.strictEqual(await get("/js/game.js"), 200);
    assert.strictEqual(await get("/js/sim.js"), 200);
    assert.strictEqual(await get("/js/maps.js"), 200);
    assert.strictEqual(await get("/server/server.js"), 404);
    assert.strictEqual(await get("/package.json"), 404);
    assert.strictEqual(await get("/js/..%2Fpackage.json"), 404);
    assert.strictEqual(await get("/%2e%2e/package.json"), 404);

    const a = bot("A");
    const b = bot("B");
    const c = bot("C");
    await Promise.all([a.opened, b.opened, c.opened]);

    /* ----- místnost 1v1 ----- */
    a.cmd({ c: "train", type: "worker" });
    a.send({ t: "create", map: "neexistuje", name: "x" });
    await a.until(() => a.errors.length, 2000, "neznámá mapa");
    assert(!a.room);

    a.send({ t: "create", map: "valley", name: "Alice <script>" });
    await a.until(() => a.room, 2000, "místnost");
    assert.strictEqual(a.room.you, 0);
    assert.strictEqual(a.room.host, 0);
    assert.strictEqual(a.room.slots.length, 2);
    assert.strictEqual(a.room.slots[0].name, "Alice script");
    assert.strictEqual(a.room.slots[1].kind, "open");
    await c.until(() => c.list && c.list.some(r => r.id === a.room.id && r.map === "valley" && r.players === 1), 2000, "seznam místností");

    b.send({ t: "join", room: a.room.id, name: "Bob" });
    await a.until(() => a.room.slots[1].kind === "human", 2000, "Bob v místnosti");
    assert.strictEqual(a.room.slots[1].name, "Bob");
    await b.until(() => b.room && b.room.you === 1, 2000, "Bobova místnost");

    // plná místnost, host zahájí hru, ne-host nemůže nic
    c.send({ t: "join", room: a.room.id, name: "Cyril" });
    await c.until(() => c.errors.length, 2000, "plná místnost");
    b.send({ t: "start" });
    b.send({ t: "map", map: "highland" });
    b.send({ t: "slot", i: 0, kind: "closed" });
    await sleep(200);
    assert(!a.match && !b.match, "ne-host nespustí hru");
    assert.strictEqual(a.room.map, "valley");

    a.send({ t: "slot", i: 1, kind: "ai" }); // obsazený slot se nezmění
    await sleep(100);
    assert.strictEqual(a.room.slots[1].kind, "human");

    a.send({ t: "start" });
    await Promise.all([a.until(() => a.match, 2000, "match A"), b.until(() => b.match, 2000, "match B")]);
    assert.strictEqual(a.match.slot, 0);
    assert.strictEqual(b.match.slot, 1);
    assert.strictEqual(a.match.map, "valley");
    assert.deepStrictEqual(a.match.players.map(p => p.name), ["Alice script", "Bob"]);

    c.send({ t: "join", room: a.room.id, name: "Cyril" });
    await sleep(150);
    assert(!c.room, "do běžící hry se nejde připojit");

    await Promise.all([a, b].map(p => p.until(() => p.snap, 2000, "snapshot")));
    assert.strictEqual(a.snap.p, "countdown");

    // během odpočtu se nic nestane
    a.cmd({ c: "train", type: "worker" });
    await Promise.all([a, b].map(p => p.until(() => p.snap.p === "playing", 6000, "start hry")));
    assert.strictEqual(a.snap.u.length, 8);

    const mine = p => p.match.slot;

    // klient nevidí soupeřovy suroviny a nemůže si je nastavit
    assert.strictEqual(a.snap.g, 260);
    a.send({ t: "cmd", c: "train", type: "hero", gold: 99999 });
    await sleep(150);
    assert.strictEqual(a.snap.g, 260 - 150, "hrdina stojí 150 zlata");

    // podvody: cizí jednotky, útok na vlastní, nesmyslná čísla, stavba mimo zónu
    const enemyIds = b.units(mine(b)).map(u => u[0]);
    const before = JSON.stringify(b.units(mine(b)).map(u => [u[3], u[4]]));
    a.cmd({ c: "order", k: "move", ids: enemyIds, x: 10, y: 50 });
    a.cmd({ c: "order", k: "move", ids: a.units(mine(a)).map(u => u[0]), x: "x", y: NaN });
    a.cmd({ c: "order", k: "attack", ids: [a.units(mine(a))[0][0]], target: a.units(mine(a))[1][0] });
    a.cmd({ c: "build", type: "tower", x: mine(a) === 0 ? 700 : 200, y: 200, ids: a.units(mine(a)).filter(u => u[1] === 0).map(u => u[0]) });
    a.cmd({ c: "build", type: "citadel", x: 100, y: 100, ids: enemyIds });
    a.cmd({ c: "fire", x: 1e9, y: 0 });
    a.cmd({ c: "bogus" });
    a.ws.send("{nejson");
    a.ws.send(JSON.stringify([1, 2, 3]));
    await sleep(300);
    const after = JSON.stringify(b.units(mine(b)).map(u => [u[3], u[4]]));
    assert.strictEqual(before, after, "cizí jednotky se nesmí hýbat");
    assert(a.notes().some(n => n.includes("Stavět lze jen ve vlastní části")), "stavba u soupeře");
    assert(!a.snap.b.some(x => x[1] === 3), "věž nesmí vzniknout");
    assert(!a.snap.b.some(x => x[3] === 100 && x[4] === 100), "stavba s cizími dělníky nesmí vzniknout");

    // ekonomika: dělník s rozkazem těžit nosí zlato až po skutečné cestě
    const myWorkers = a.units(mine(a)).filter(u => u[1] === 0).map(u => u[0]);
    const mine1 = a.snap.r.find(r => r[1] === 0 && (mine(a) === 0 ? r[2] < 480 : r[2] > 480));
    const gold0 = a.snap.g;
    a.cmd({ c: "order", k: "gather", ids: myWorkers, target: mine1[0] });
    await sleep(600);
    assert.strictEqual(a.snap.g, gold0, "zlato se nepřipisuje hned");
    await a.until(() => a.snap.g > gold0, 30000, "příjem zlata");

    // povolená stavba na vlastní straně
    a.cmd({ c: "train", type: "worker" });
    await a.until(() => a.units(mine(a)).filter(u => u[1] === 0).length === 3, 2000, "výcvik");
    const zoneX = mine(a) === 0 ? 300 : 660;
    await a.until(() => a.snap.g >= 90 && a.snap.w >= 55, 40000, "dost surovin na věž");
    a.cmd({ c: "build", type: "tower", x: zoneX, y: 260, ids: myWorkers });
    await a.until(() => a.snap.b.some(x => x[1] === 3 && x[2] === mine(a)), 2000, "stavba věže");

    // vzdání se ukončí zápas 1v1 a hráči se vrátí do místnosti
    a.resetMatch();
    a.room = null;
    b.cmd({ c: "surrender" });
    await Promise.all([a, b].map(p => p.until(() => p.ended, 2000, "konec")));
    assert.strictEqual(a.ended.w, 0);
    assert.strictEqual(a.ended.why, "surrender");
    await Promise.all([a, b].map(p => p.until(() => p.room && p.room.state === "lobby", 2000, "návrat do místnosti")));

    /* ----- tři hráči: dva lidé + AI na velké mapě ----- */
    b.resetMatch();
    a.resetMatch();
    a.send({ t: "map", map: "highland" });
    await a.until(() => a.room && a.room.map === "highland", 2000, "změna mapy");
    assert.strictEqual(a.room.slots.length, 3);
    assert.strictEqual(a.room.slots[1].kind, "human", "hráči zůstali na místech");
    a.send({ t: "slot", i: 2, kind: "ai" });
    await a.until(() => a.room.slots[2].kind === "ai", 2000, "AI slot");
    a.send({ t: "start" });
    await Promise.all([a, b].map(p => p.until(() => p.match && p.snap && p.snap.p === "playing", 6000, "start 3 hráčů")));
    assert.strictEqual(a.match.players.length, 3);
    assert.strictEqual(a.match.players[2].ai, true);
    assert.strictEqual(a.snap.u.length, 12);
    assert(a.snap.b.every(x => x[2] <= 2));
    assert.strictEqual(a.snap.u.filter(u => u[2] === 2).length, 4, "AI má své jednotky");

    // první vzdá hráč A: hra pokračuje, B ještě bojuje
    a.cmd({ c: "surrender" });
    await b.until(() => b.outs.some(o => o.t === 0 && o.why === "surrender"), 2000, "A vypadl");
    await sleep(300);
    assert(!b.ended && !a.ended, "hra ostatních pokračuje");
    assert(!a.snap.b.some(x => x[2] === 0), "základna vyřazeného zmizela");

    // vzdá se i B: zbývá jen AI, hra končí jeho vítězstvím
    b.cmd({ c: "surrender" });
    await Promise.all([a, b].map(p => p.until(() => p.ended, 2000, "konec 3 hráčů")));
    assert.strictEqual(a.ended.w, 2);
    await Promise.all([a, b].map(p => p.until(() => p.room && p.room.state === "lobby", 2000, "znovu v místnosti")));

    /* ----- čtyři hráči: tři lidé a zavřený slot, odchody a předání hostitele ----- */
    a.send({ t: "leave" });
    await a.until(() => a.msgs.some(m => m.t === "left"), 2000, "A odešel");
    await b.until(() => b.room && b.room.host === b.room.you, 2000, "B je nový hostitel");
    b.send({ t: "leave" });
    await b.until(() => b.msgs.some(m => m.t === "left"), 2000, "B odešel");
    await sleep(100);
    await a.until(() => a.list && !a.list.some(r => r.map === "highland"), 2000, "prázdná místnost zmizela");

    const d = bot("D");
    await d.opened;
    for (const p of [a, b, c, d]) { p.resetMatch(); p.errors = []; }

    c.send({ t: "create", map: "crowns", name: "Cyril" });
    await c.until(() => c.room && c.room.slots.length === 4, 2000, "mapa pro čtyři");
    a.send({ t: "join", room: c.room.id, name: "Alice" });
    b.send({ t: "join", room: c.room.id, name: "Bob" });
    await c.until(() => c.room.slots.filter(s => s.kind === "human").length === 3, 2000, "tři hráči");

    c.send({ t: "map", map: "valley" });
    await c.until(() => c.errors.length, 2000, "na malé mapě není místo");
    assert.strictEqual(c.room.map, "crowns");

    c.send({ t: "slot", i: 3, kind: "closed" });
    await c.until(() => c.room.slots[3].kind === "closed", 2000, "zavřený slot");
    d.send({ t: "join", room: c.room.id, name: "Dan" });
    await d.until(() => d.errors.length, 2000, "zavřený slot se neobsadí");

    c.send({ t: "slot", i: 3, kind: "bogus" });
    c.send({ t: "slot", i: 99, kind: "ai" });
    c.send({ t: "slot", i: -1, kind: "ai" });
    await sleep(150);
    assert.strictEqual(c.room.slots[3].kind, "closed");

    for (const p of [a, b, c]) p.room = null;
    c.send({ t: "start" });
    await Promise.all([a, b, c].map(p => p.until(() => p.match && p.snap && p.snap.p === "playing", 6000, "start 4 hráčů")));
    assert.strictEqual(a.match.players.length, 3);
    assert.strictEqual(a.snap.u.length, 12);
    assert.strictEqual(a.snap.b.length, 6);

    // odpojení hostitele uprostřed hry nikoho jiného neukončí
    c.ws.close();
    await a.until(() => a.outs.some(o => o.why === "disconnect"), 2000, "C vypadl odpojením");
    await sleep(200);
    assert(!a.ended && !b.ended, "hra pokračuje pro zbylé");

    a.ws.close();
    await b.until(() => b.ended, 2000, "poslední hráč vyhrává");
    assert.strictEqual(b.ended.w, b.match.slot);
    assert.strictEqual(b.ended.why, "disconnect");

    console.log("OK: všechny testy serveru prošly");
  } finally {
    for (const p of bots) p.ws.terminate();
    proc.kill();
  }
}

async function main() {
  testMaps();
  testSimulation();
  await testServer();
}

main().then(() => process.exit(0), err => {
  console.error(err);
  process.exit(1);
});
