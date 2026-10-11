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
const NAV = require("../js/nav.js");
const CHECK = require("../js/mapcheck.js");
const fs = require("fs");
const os = require("os");

const PORT = 3100 + Math.floor(Math.random() * 500);
const URL = `ws://localhost:${PORT}`;
const ADMIN_PASSWORD = "test-admin-heslo";

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

    // průchodnost: nic nestojí ve vodě a všechno je dosažitelné po souvislé cestě
    const nav = NAV.forMap(map);
    const reaches = (a, b) => {
      const p = nav.path(a.x, a.y, b.x, b.y);
      const end = p.length ? p[p.length - 1] : a;
      return Math.hypot(end.x - b.x, end.y - b.y) < 24;
    };

    map.slots.forEach((s, i) => {
      assert(!nav.isBlockedArea(s.hq.x, s.hq.y, 20), `${label}: základna ${i} ve vodě`);
      for (const b of s.buildings) assert(!nav.isBlocked(b.x, b.y), `${label}: budova slotu ${i} ve vodě`);
      for (const u of s.units) assert(!nav.isBlocked(u.x, u.y), `${label}: jednotka slotu ${i} ve vodě`);
      map.slots.forEach((o, j) => {
        if (j > i) assert(reaches(s.hq, o.hq), `${label}: základny ${i} a ${j} nejsou propojené`);
      });
    });

    for (const [x, y] of map.gold) {
      assert(!nav.isBlockedArea(x, y, 20), `${label}: důl ve vodě`);
      assert(reaches(map.slots[0].hq, { x, y }), `${label}: důl je nedosažitelný`);
    }

    for (const [x, y] of map.trees) assert(!nav.isBlocked(x, y), `${label}: strom ve vodě`);
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

    // při samé AI skončí zápas hned po prvním vyřazení; u hustých map s mnoha hráči to může přijít dřív než za 90 s
    if (map.players <= 4) assert.strictEqual(match.phase, "playing", `${map.id}: AI hra neskončí během 90 s`);
    else assert(match.phase === "playing" || t >= 30, `${map.id}: AI hra neskončí v první půlminutě`);
    // u velkých map se AI občas rozhodne dřív pro vojsko; drtivá většina ale dělníky má
    const counts = match.active.filter(team => !match.out.has(team)).map(team => match.units.filter(u => u.team === team && u.type === "worker").length);
    assert(counts.every(n => n >= 1), `${map.id}: každá AI má aspoň jednoho dělníka`);
    assert(counts.filter(n => n >= 3).length >= Math.ceil(counts.length * 0.75), `${map.id}: AI cvičí dělníky`);
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
  testBuilding();
  testSmithy();
}

function testSmithy() {
  const run = (m, seconds) => { for (let t = 0; t < seconds; t += TICK) { m.step(TICK); m.endTick(); } };
  const m = new Match(MAPS.get("valley"), [{ name: "A" }, { name: "B" }], { countdown: 0 });
  m.econ.blue.gold = 2000;
  m.econ.blue.wood = 2000;

  m.command("blue", { c: "research", kind: "armor" });
  assert.strictEqual(m.upgrades.blue.armor, 0, "bez kovárny se nevyzkoumá");
  assert.strictEqual(m.econ.blue.gold, 2000);

  const smithy = m.createBuilding("smithy", "blue", 300, 300, false);
  const soldier = m.createUnit("soldier", "blue", 320, 330);
  const dmg0 = soldier.damage;
  m.command("blue", { c: "research", kind: "weapon" });
  assert.strictEqual(m.econ.blue.gold, 2000 - R.UPGRADES.weapon.levels[0].gold, "výzkum se platí hned");
  assert(smithy.research, "kovárna začala výzkum");
  m.command("blue", { c: "research", kind: "armor" });
  assert(!m.buildings.some(b => b !== smithy && b.research) && m.upgrades.blue.armor === 0, "kovárna dělá jen jeden výzkum");

  run(m, R.UPGRADES.weapon.levels[0].time - 1);
  assert.strictEqual(m.upgrades.blue.weapon, 0, "výzkum chvíli trvá");
  run(m, 2);
  assert.strictEqual(m.upgrades.blue.weapon, 1);
  assert.strictEqual(soldier.damage, dmg0 + R.WEAPON_PER_LEVEL, "stávající vojáci dostanou bonus");
  assert.strictEqual(m.createUnit("soldier", "blue", 100, 100).damage, dmg0 + R.WEAPON_PER_LEVEL, "noví také");

  m.command("blue", { c: "research", kind: "armor" });
  run(m, R.UPGRADES.armor.levels[0].time + 1);
  assert.strictEqual(m.upgrades.blue.armor, 1);
  const foe = m.createUnit("soldier", "red", 340, 330);
  const hp = soldier.hp;
  m.damage(foe, soldier, 20);
  assert.strictEqual(hp - soldier.hp, Math.round(20 * (1 - R.ARMOR_PER_LEVEL)), "zbroj snižuje poškození");
}

function testBuilding() {
  const run = (m, seconds, each) => { for (let t = 0; t < seconds; t += TICK) { m.step(TICK); m.endTick(); if (each) each(); } };
  const newMatch = () => new Match(MAPS.get("valley"), [{ name: "A" }, { name: "B" }], { countdown: 0 });
  const workerOf = m => m.units.find(u => u.team === "blue" && u.type === "worker");

  // stavba: platba hned, budova roste, jen když u ní dělník pracuje, chatrč zvýší limit o 5
  let m = newMatch();
  const w = workerOf(m);
  m.econ.blue.gold = 1000;
  m.econ.blue.wood = 1000;
  const hq = m.hqOf("blue");
  let spot = null;

  const freeSpot = (minDist, from) => {
    for (let r = 100; r <= 320; r += 20) {
      for (let a = 0; a < 6.28; a += 0.25) {
        const x = Math.round(hq.x + Math.cos(a) * r);
        const y = Math.round(hq.y + Math.sin(a) * r);
        if (from && Math.hypot(x - from.x, y - from.y) < minDist) continue;
        if (!m.placementProblem("blue", x, y)) return { x, y };
      }
    }
    return null;
  };
  spot = freeSpot(0);

  assert(spot, "existuje volné místo pro stavbu");
  const gold0 = m.econ.blue.gold;
  m.command("blue", { c: "build", type: "hut", x: spot.x, y: spot.y, ids: [w.id] });
  const hut = m.buildings.find(b => b.type === "hut");
  assert(hut && hut.progress < 0.1, "budova začíná jako rozestavěná");
  assert.strictEqual(m.econ.blue.gold, gold0 - R.COSTS.hut.gold, "cena se strhává hned");
  assert.strictEqual(w.order.type, "build");
  assert.strictEqual(m.supplyCap("blue"), R.SUPPLY_BASE);

  run(m, 0.5);
  assert(hut.progress < 0.1, "dělník ještě nedošel");
  let walked = 0;
  while (!w.building && walked < 30) { run(m, TICK); walked += TICK; }
  assert(w.building, "dělník dojde ke stavbě");
  const t0 = hut.progress;
  run(m, 2);
  assert(hut.progress > t0 + 0.15 && hut.progress < 1, "stavba postupuje");
  run(m, R.BUILD_TIME.hut);
  assert.strictEqual(hut.progress, 1);
  assert(!w.order, "dělník po dostavění končí");
  assert.strictEqual(m.supplyCap("blue"), R.SUPPLY_BASE + R.SUPPLY_PER_HUT);

  // bez dělníka se nestaví; jiný dělník může pokračovat
  const other = m.units.find(u => u.team === "blue" && u.type === "worker" && u !== w);
  const spot2 = freeSpot(100, spot);
  assert(spot2, "místo pro věž");
  m.command("blue", { c: "build", type: "tower", x: spot2.x, y: spot2.y, ids: [w.id] });
  const tower = m.buildings.find(b => b.type === "tower");
  assert(tower, "věž se začala stavět");

  m.command("blue", { c: "order", k: "move", ids: [w.id], x: hq.x, y: hq.y + 150 });
  const p = tower.progress;
  run(m, 3);
  assert(tower.progress <= p + 0.01, "bez stavitele se nestaví");
  m.command("blue", { c: "order", k: "build", ids: [other.id], target: tower.id });
  run(m, 40);
  assert.strictEqual(tower.progress, 1, "jiný dělník stavbu dokončí");

  // limit jednotek: základ + 5 za chatrč
  m = newMatch();
  m.econ.blue.gold = 5000;
  m.econ.blue.wood = 5000;
  for (let i = 0; i < 30; i++) m.command("blue", { c: "train", type: "worker" });
  assert.strictEqual(m.units.filter(u => u.team === "blue").length, R.SUPPLY_BASE, "limit jednotek");
  assert(m.notes.blue.some(n => n.startsWith("Maximum jednotek")));

  // voda: jednotka obejde potok přes brod a nikdy nevstoupí do vody
  m = newMatch();
  const walker = workerOf(m);
  walker.x = 680;
  walker.y = 440;
  m.command("blue", { c: "order", k: "move", ids: [walker.id], x: 860, y: 440 });
  let wet = 0;
  run(m, 45, () => { if (m.nav.isBlocked(walker.x, walker.y)) wet++; });
  assert.strictEqual(wet, 0, "jednotka nechodí přes vodu");
  assert(walker.x > 830, "přešla brodem na druhou stranu");

  // nelze stavět na vodě
  assert(m.placementProblem("red", 760, 300), "stavba ve vodě je zamítnuta");

  // jednotky se překrývají jen mírně: dvě na stejném místě se rozejdou
  m = newMatch();
  const a = m.createUnit("soldier", "blue", 300, 300);
  const b = m.createUnit("soldier", "blue", 300, 300);
  run(m, 2);
  assert(Math.hypot(a.x - b.x, a.y - b.y) >= 13, "jednotky se odtlačily");
}

function testEconomy() {
  const run = (m, seconds) => { for (let t = 0; t < seconds; t += TICK) { m.step(TICK); m.endTick(); } };
  const newMatch = () => new Match(MAPS.get("valley"), [{ name: "A" }, { name: "B" }], { countdown: 0 });
  const workerOf = m => m.units.find(u => u.team === "blue" && u.type === "worker");

  // zlatý důl je konečný, po vyčerpání zůstane prázdný
  let m = newMatch();
  const hq0 = m.hqOf("blue");
  const mine = m.resources.filter(r => r.type === "gold").sort((p, q) => Math.hypot(p.x - hq0.x, p.y - hq0.y) - Math.hypot(q.x - hq0.x, q.y - hq0.y))[0];
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
  constructor(name, cookie) {
    this.name = name;
    this.snap = null;
    this.msgs = [];
    this.errors = [];
    this.outs = [];
    this.ended = null;
    this.match = null;
    this.room = null;
    this.list = null;
    this.hello = null;
    this.closed = false;
    this.ws = new WebSocket(URL, { headers: cookie ? { Cookie: cookie } : {} });
    this.opened = new Promise(r => this.ws.on("open", r));
    this.ws.on("close", () => { this.closed = true; });
    this.ws.on("message", data => {
      const m = JSON.parse(data);
      this.msgs.push(m);
      if (m.t === "hello") this.hello = m;
      if (m.t === "hello" || m.t === "rooms") this.list = m.list;
      if (m.t === "room") this.room = m;
      if (m.t === "error") this.errors.push(m.text);
      if (m.t === "maps") this.maps = m;
      if (m.t === "match") this.match = m;
      if (m.t === "s") {
        // suroviny chodí jako rozdíly; bot si drží úplný seznam jako klient
        if (m.rf || !this.res) this.res = new Map();
        for (const r of m.r) if (r[1] === 1 && r[4] <= 0) this.res.delete(r[0]); else this.res.set(r[0], r);
        m.r = [...this.res.values()];
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
  const mapsDir = fs.mkdtempSync(path.join(os.tmpdir(), "goralia-maps-"));
  const repoMaps = path.join(__dirname, "..", "maps");
  for (const id of ["valley", "highland", "crowns"]) fs.copyFileSync(path.join(repoMaps, `${id}.json`), path.join(mapsDir, `${id}.json`));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "goralia-data-"));
  const proc = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: { ...process.env, PORT: String(PORT), GORALIA_MAPS_DIR: mapsDir, GORALIA_DATA_DIR: dataDir, GORALIA_ADMIN_PASSWORD: ADMIN_PASSWORD },
    stdio: ["ignore", "pipe", "inherit"]
  });

  const bots = [];
  const cookies = {};
  const bot = name => {
    const b = new Bot(name, cookies[name]);
    bots.push(b);
    return b;
  };

  try {
    await new Promise(resolve => {
      let out = "";
      proc.stdout.on("data", chunk => {
        out += chunk;
        if (out.includes("běží na")) resolve();
      });
    });

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
    assert.strictEqual(await get("/editor.html"), 200);
    assert.strictEqual(await get("/maps/x.json"), 404);

    // vlastní mapy: ukládání jen z místního počítače a jen platné mapy
    const api = (method, p, body, headers = {}) => new Promise((resolve, reject) => {
      const data = body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body);
      const req = http.request({ host: "localhost", port: PORT, path: p, method, headers: { "Content-Type": "application/json", ...headers } }, res => {
        let text = "";
        res.on("data", chunk => { text += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, json: text ? JSON.parse(text) : null }));
      });
      req.on("error", reject);
      req.end(data);
    });

    // hráči pro online testy: registrace přes API, cookie s relací jde do WebSocketu
    for (const name of ["Alice", "Bob", "Cyril", "Dee", "Dan"]) {
      const res = await api("POST", "/api/auth/register", { name, email: `${name.toLowerCase()}@example.com`, password: "heslo-1234" });
      assert.strictEqual(res.status, 200, `registrace ${name}`);
      cookies[name] = res.headers["set-cookie"][0].split(";")[0];
    }

    const ids = async () => (await api("GET", "/api/maps")).json.maps.map(m => m.id).sort();
    const doc = sampleDoc("test-arena");
    assert.deepStrictEqual(await ids(), ["crowns", "highland", "valley"]);
    assert.strictEqual((await api("PUT", "/api/maps/test-arena", doc)).status, 200, "platná mapa se uloží");
    assert(fs.existsSync(path.join(mapsDir, "test-arena.json")), "mapa je v souboru");
    assert((await ids()).includes("test-arena"));
    assert.strictEqual((await api("PUT", "/api/maps/jina", doc)).status, 400, "id v adrese musí sedět");
    assert.strictEqual((await api("PUT", "/api/maps/test-arena", { ...doc, bases: doc.bases.slice(0, 1) })).status, 400, "mapa s jednou základnou");
    assert.strictEqual((await api("PUT", "/api/maps/test-arena", "{nejson")).status, 400);
    assert.strictEqual((await api("PUT", "/api/maps/test-arena", doc, { Origin: "http://evil.example" })).status, 403, "cizi Origin");
    assert.strictEqual((await api("PUT", "/api/maps/test-arena", doc, { "X-Forwarded-For": "1.2.3.4" })).status, 403, "za proxy");
    assert.strictEqual((await api("PUT", "/api/maps/test-arena", doc, { Host: "example.com" })).status, 403, "cizi Host");
    assert.strictEqual((await api("PUT", "/api/maps/test-arena", doc, { "Content-Type": "text/plain" })).status, 415);

    const water = { ...doc, water: [{ pts: [[150, 0], [150, 340]], hw: 20 }, { pts: [[0, 170], [300, 170]], hw: 20 }], roads: [], autoRoads: false };
    const flooded = await api("PUT", "/api/maps/test-arena", water);
    assert.strictEqual(flooded.status, 400, "nehratelná mapa se neuloží");
    assert(flooded.json.errors.length > 0);

    const room = bot("Dee");
    await room.opened;
    room.send({ t: "create", map: "test-arena" });
    await room.until(() => room.room, 2000, "místnost na vlastní mapě");
    assert.strictEqual(room.room.map, "test-arena");
    room.send({ t: "leave" });

    await sleep(150);
    assert.strictEqual((await api("DELETE", "/api/maps/neexistuje")).status, 404, "neexistující mapu nelze smazat");
    assert.strictEqual((await api("DELETE", "/api/maps/test-arena")).status, 200);
    assert(!fs.existsSync(path.join(mapsDir, "test-arena.json")), "soubor je pryč");
    assert.deepStrictEqual(await ids(), ["crowns", "highland", "valley"]);

    // správa map pro admina: ukládání a mazání odkudkoli (i za proxy), jen pro přihlášeného admina
    const proxied = { "X-Forwarded-For": "8.8.8.8" };
    const adminLogin = await api("POST", "/api/auth/login", { identifier: "Jurek", password: ADMIN_PASSWORD });
    assert.strictEqual(adminLogin.status, 200, "admin se přihlásí");
    const adminCookie = adminLogin.headers["set-cookie"][0].split(";")[0];
    const asAdmin = { ...proxied, Cookie: adminCookie };
    const asUser = { ...proxied, Cookie: cookies.Alice };

    assert.strictEqual((await api("PUT", "/api/maps/test-arena", doc, asUser)).status, 403, "hráč bez práv mapu neuloží");
    assert.strictEqual((await api("PUT", "/api/maps/test-arena", doc, proxied)).status, 403, "nepřihlášený za proxy mapu neuloží");
    assert.strictEqual((await api("PUT", "/api/maps/test-arena", doc, { ...asAdmin, Origin: "http://evil.example" })).status, 403, "admin z cizí stránky (CSRF)");
    assert.strictEqual((await api("PUT", "/api/maps/test-arena", doc, asAdmin)).status, 200, "admin uloží mapu i za proxy");
    assert.strictEqual((await api("GET", "/api/me", undefined, asAdmin)).json.canEditMaps, true, "admin smí upravovat mapy");
    assert.strictEqual((await api("GET", "/api/me", undefined, asUser)).json.canEditMaps, false, "hráč nesmí");

    // výběr map pro multiplayer
    assert.deepStrictEqual((await api("GET", "/api/mapconfig")).json, { off: [] }, "všechny mapy jsou ve výchozím stavu povolené");
    assert.strictEqual((await api("GET", "/api/admin/maps", undefined, asUser)).status, 403);
    const listed = (await api("GET", "/api/admin/maps", undefined, asAdmin)).json.maps;
    assert(listed.some(m => m.id === "valley" && m.custom && m.multiplayer), "mapa ze souboru je v přehledu");
    assert(listed.some(m => m.id === "test-arena" && m.custom && m.updated > 0), "vlastní mapa je v přehledu");
    assert.strictEqual((await api("POST", "/api/admin/maps/test-arena/multiplayer", { enabled: false }, asUser)).status, 403);
    assert.strictEqual((await api("POST", "/api/admin/maps/neexistuje/multiplayer", { enabled: false }, asAdmin)).status, 404);

    const watcher = bot("Dee");
    await watcher.opened;
    await watcher.until(() => watcher.hello, 2000, "hello");
    assert.strictEqual((await api("POST", "/api/admin/maps/test-arena/multiplayer", { enabled: false }, asAdmin)).status, 200);
    assert.deepStrictEqual((await api("GET", "/api/mapconfig")).json, { off: ["test-arena"] });
    await watcher.until(() => watcher.maps && watcher.maps.off.includes("test-arena"), 2000, "hráči přijde nový seznam map");

    watcher.send({ t: "create", map: "test-arena" });
    await watcher.until(() => watcher.errors.length, 2000, "vypnutá mapa se nedá vybrat");
    assert(/nen[ií] pro multiplayer/.test(watcher.errors[0]), "srozumitelná chyba");
    assert(!watcher.room, "místnost nevznikla");

    watcher.send({ t: "create", map: "valley" });
    await watcher.until(() => watcher.room, 2000, "povolená mapa funguje");
    watcher.send({ t: "map", map: "test-arena" });
    await watcher.until(() => watcher.errors.length > 1, 2000, "host nepřepne na vypnutou mapu");
    assert.strictEqual(watcher.room.map, "valley");

    // mapu používanou místností nejde smazat
    assert.strictEqual((await api("POST", "/api/admin/maps/test-arena/multiplayer", { enabled: true }, asAdmin)).status, 200);
    watcher.send({ t: "map", map: "test-arena" });
    await watcher.until(() => watcher.room && watcher.room.map === "test-arena", 2000, "po povolení jde mapa zvolit");
    const busy = await api("DELETE", "/api/maps/test-arena", undefined, asAdmin);
    assert.strictEqual(busy.status, 409, "mapa v místnosti se nesmaže");
    assert(/m[ií]stnost/.test(busy.json.errors[0]));
    watcher.send({ t: "leave" });
    await sleep(150);

    // aspoň jedna mapa musí zůstat povolená
    const all = (await api("GET", "/api/admin/maps", undefined, asAdmin)).json.maps.map(m => m.id);
    let refused = 0;
    for (const id of all) {
      const res = await api("POST", `/api/admin/maps/${id}/multiplayer`, { enabled: false }, asAdmin);
      if (res.status === 400) refused++;
    }
    assert.strictEqual(refused, 1, "poslední povolenou mapu nejde vypnout");
    for (const id of all) await api("POST", `/api/admin/maps/${id}/multiplayer`, { enabled: true }, asAdmin);

    // smazání vypnuté mapy zruší i její nastavení; admin ji smaže bez místního počítače
    await api("POST", "/api/admin/maps/test-arena/multiplayer", { enabled: false }, asAdmin);
    assert.strictEqual((await api("DELETE", "/api/maps/test-arena", undefined, asUser)).status, 403);
    assert.strictEqual((await api("DELETE", "/api/maps/test-arena", undefined, asAdmin)).status, 200, "admin smaže mapu za proxy");
    assert.deepStrictEqual((await api("GET", "/api/mapconfig")).json, { off: [] }, "nastavení smazané mapy zmizelo");
    assert.deepStrictEqual(await ids(), ["crowns", "highland", "valley"]);
    const audit = (await api("GET", "/api/admin/audit", undefined, asAdmin)).json.audit.map(a => a.action);
    assert(["map-save", "map-delete", "map-mp-off", "map-mp-on"].every(a => audit.includes(a)), "akce nad mapami jsou v záznamu");

    const a = bot("Alice");
    const b = bot("Bob");
    const c = bot("Cyril");
    await Promise.all([a.opened, b.opened, c.opened]);

    const idOf = async name => (await api("GET", "/api/me", undefined, { Cookie: cookies[name] })).json.user.id;
    const profile = async name => (await api("GET", `/api/players/${await idOf(name)}`)).json.player;

    // identita: hráč je přihlášený z cookie, nepřihlášený nemůže tvořit místnosti
    await a.until(() => a.hello, 2000, "hello");
    assert.strictEqual(a.hello.me.name, "Alice");
    const anon = bot("Anon");
    await anon.opened;
    await anon.until(() => anon.hello, 2000, "hello hosta");
    assert.strictEqual(anon.hello.me, null);
    anon.send({ t: "create", map: "valley" });
    await anon.until(() => anon.errors.length, 2000, "host nevytvoří místnost");
    assert(!anon.room);

    // jeden účet má jedno spojení: nové vytlačí staré
    const again = bot("Dee");
    await again.opened;
    await room.until(() => room.closed, 2000, "staré spojení stejného účtu skončí");

    /* ----- místnost 1v1 ----- */
    a.cmd({ c: "train", type: "worker" });
    a.send({ t: "create", map: "neexistuje" });
    await a.until(() => a.errors.length, 2000, "neznámá mapa");
    assert(!a.room);

    a.send({ t: "create", map: "valley", name: "Mallory <script>" });
    await a.until(() => a.room, 2000, "místnost");
    assert.strictEqual(a.room.you, 0);
    assert.strictEqual(a.room.host, 0);
    assert.strictEqual(a.room.slots.length, 2);
    assert.strictEqual(a.room.slots[0].name, "Alice", "jméno je z účtu, ne ze zprávy");
    assert.strictEqual(a.room.slots[1].kind, "open");
    await c.until(() => c.list && c.list.some(r => r.id === a.room.id && r.map === "valley" && r.players === 1), 2000, "seznam místností");

    b.send({ t: "join", room: a.room.id, name: "Bob" });
    await a.until(() => a.room.slots[1].kind === "human", 2000, "Bob v místnosti");
    assert.strictEqual(a.room.slots[1].name, "Bob");
    await b.until(() => b.room && b.room.you === 1, 2000, "Bobova místnost");

    // chat místnosti: jen členům, očištěný text, limity proti spamu
    const said = (bot, from) => bot.msgs.filter(m => m.t === "chat" && !m.sys && m.name === from);
    const notes = bot => bot.msgs.filter(m => m.t === "chat" && m.sys).map(m => m.text);
    await a.until(() => notes(a).includes("Bob se připojil."), 2000, "oznámení o příchodu");

    a.send({ t: "chat", text: "  Ahoj   světe <b>!</b>\n " });
    await Promise.all([a.until(() => said(a, "Alice").length, 2000, "chat A"), b.until(() => said(b, "Alice").length, 2000, "chat B")]);
    assert.deepStrictEqual(said(b, "Alice")[0], { t: "chat", slot: 0, name: "Alice", text: "Ahoj světe <b>!</b>" });

    await sleep(120);
    b.send({ t: "chat", text: "Čau" });
    await a.until(() => said(a, "Bob").length, 2000, "odpověď");
    assert.strictEqual(said(a, "Bob")[0].slot, 1);

    await sleep(450);
    a.send({ t: "chat", text: "Ahoj světe <b>!</b>" });
    await a.until(() => notes(a).some(t => t.includes("Stejnou")), 2000, "stejná zpráva dvakrát");
    assert.strictEqual(said(b, "Alice").length, 1, "duplicitní zpráva se nepřeposílá");

    await sleep(450);
    a.send({ t: "chat", text: "x\u0000\u202e" + "y".repeat(500) });
    await b.until(() => said(b, "Alice").length === 2, 2000, "dlouhá zpráva");
    assert.strictEqual(said(b, "Alice")[1].text, "x y".concat("y".repeat(199 - 2)).slice(0, 200), "řídicí znaky pryč, délka 200");
    a.send({ t: "chat", text: "   " });
    a.send({ t: "chat" });
    a.send({ t: "chat", text: { x: 1 } });

    await sleep(450);
    for (let i = 0; i < 6; i++) a.send({ t: "chat", text: `spam ${i}` });
    await a.until(() => notes(a).some(t => t.includes("příliš rychle")), 2000, "spam omezen");
    await sleep(150);
    assert(said(b, "Alice").length <= 4, "nejvýš 4 zprávy za 8 s");

    c.send({ t: "chat", text: "Jsem mimo místnost" });
    await sleep(200);
    assert(!said(a, "Cyril").length && !said(b, "Cyril").length, "chat jde jen členům místnosti");

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
    assert.deepStrictEqual(a.match.players.map(p => p.name), ["Alice", "Bob"]);

    c.send({ t: "join", room: a.room.id, name: "Cyril" });
    await sleep(150);
    assert(!c.room, "do běžící hry se nejde připojit");

    await Promise.all([a, b].map(p => p.until(() => p.snap, 2000, "snapshot")));
    assert.strictEqual(a.snap.p, "countdown");

    // během odpočtu se nic nestane
    a.cmd({ c: "train", type: "worker" });
    await Promise.all([a, b].map(p => p.until(() => p.snap.p === "playing", 6000, "start hry")));
    assert.strictEqual(a.snap.u.length, 6);

    const mine = p => p.match.slot;

    // divák bez účtu: vidí seznam rozehraných zápasů, sleduje je, ale nic neovládá
    const spec = bot("Divák");
    await spec.until(() => spec.hello, 2000, "hello diváka");
    assert.strictEqual(spec.hello.me, null, "divák nemá účet");
    assert.strictEqual(spec.hello.live.length, 1, "v seznamu je rozehraný zápas");
    assert.deepStrictEqual(spec.hello.live[0].players, ["Alice", "Bob"]);
    spec.send({ t: "watch", room: 9999 });
    await spec.until(() => spec.errors.length, 2000, "neexistující zápas");
    spec.send({ t: "watch", room: spec.hello.live[0].id });
    await spec.until(() => spec.match && spec.snap && spec.snap.p === "playing", 3000, "snímky pro diváka");
    assert.strictEqual(spec.match.slot, -1);
    assert.strictEqual(spec.match.spectate, true);
    assert.strictEqual(spec.snap.u.length, 6, "divák vidí všechny jednotky");
    assert.strictEqual(spec.snap.ec.length, 2, "divák vidí suroviny obou týmů");
    assert(spec.snap.ec.every(r => r.length === 6 && r[1] >= 0 && r[2] >= 0 && r[3] > 0), "tvar řádku surovin");
    assert(!("ec" in a.snap), "hráči soupeřovy suroviny nedostanou");
    const goldBefore = a.snap.g;
    spec.cmd({ c: "train", type: "hero" });
    spec.cmd({ c: "surrender" });
    spec.send({ t: "create", map: "valley" });
    await sleep(300);
    assert(!a.ended && !b.ended, "divák nemůže zápas ovlivnit");
    assert(a.snap.g >= goldBefore, "divák nic nevycvičil");
    assert(!spec.room, "divák si nevytvoří místnost");

    // klient nevidí soupeřovy suroviny a nemůže si je nastavit
    assert.strictEqual(a.snap.g, 260);
    a.send({ t: "cmd", c: "train", type: "hero", gold: 99999 });
    await sleep(150);
    assert.strictEqual(a.snap.g, 260, "bez kasáren se hrdina nevycvičí");
    a.send({ t: "cmd", c: "train", type: "worker", gold: 99999 });
    await sleep(150);
    assert.strictEqual(a.snap.g, 260 - R.COSTS.worker.gold, "dělník stojí svou cenu");

    // podvody: cizí jednotky, útok na vlastní, nesmyslná čísla, stavba mimo zónu
    const enemyIds = b.units(mine(b)).map(u => u[0]);
    const before = JSON.stringify(b.units(mine(b)).map(u => [u[3], u[4]]));
    a.cmd({ c: "order", k: "move", ids: enemyIds, x: 10, y: 50 });
    a.cmd({ c: "order", k: "move", ids: a.units(mine(a)).map(u => u[0]), x: "x", y: NaN });
    a.cmd({ c: "order", k: "attack", ids: [a.units(mine(a))[0][0]], target: a.units(mine(a))[1][0] });
    a.cmd({ c: "build", type: "tower", x: mine(a) === 0 ? 1100 : 400, y: 300, ids: a.units(mine(a)).filter(u => u[1] === 0).map(u => u[0]) });
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
    const mine1 = a.snap.r.find(r => r[1] === 0 && (mine(a) === 0 ? r[2] < 760 : r[2] > 760));
    const gold0 = a.snap.g;
    a.cmd({ c: "order", k: "gather", ids: myWorkers, target: mine1[0] });
    await sleep(600);
    assert.strictEqual(a.snap.g, gold0, "zlato se nepřipisuje hned");
    await a.until(() => a.snap.g > gold0, 30000, "příjem zlata");

    // povolená stavba na vlastní straně
    a.cmd({ c: "train", type: "worker" });
    await a.until(() => a.units(mine(a)).filter(u => u[1] === 0).length === 5, 2000, "výcvik");
    const zoneX = mine(a) === 0 ? 200 : 1320;
    await a.until(() => a.snap.g >= 90 && a.snap.w >= 55, 40000, "dost surovin na věž");
    a.cmd({ c: "build", type: "tower", x: zoneX, y: 420, ids: myWorkers });
    await a.until(() => a.snap.b.some(x => x[1] === 3 && x[2] === mine(a)), 2000, "stavba věže");

    // vzdání se ukončí zápas 1v1 a hráči se vrátí do místnosti
    await a.until(() => a.snap.el >= 16, 40000, "zápas aspoň 15 s");
    a.resetMatch();
    a.room = null;
    b.cmd({ c: "surrender" });
    await Promise.all([a, b].map(p => p.until(() => p.ended, 2000, "konec")));
    await spec.until(() => spec.ended && spec.msgs.some(m => m.t === "specEnd"), 2000, "konec zápasu pro diváka");
    assert.strictEqual(spec.ended.w, 0);
    assert.strictEqual(a.ended.w, 0);
    assert.strictEqual(a.ended.why, "surrender");
    await Promise.all([a, b].map(p => p.until(() => p.room && p.room.state === "lobby", 2000, "návrat do místnosti")));

    // statistiky: výsledek se zapsal k účtům obou hráčů
    const alice = await profile("Alice");
    assert.strictEqual(alice.stats.games, 1);
    assert.strictEqual(alice.stats.wins, 1);
    assert.strictEqual(alice.stats.pvpWins, 1);
    assert(alice.stats.gold >= 10, "natěženo zlato");
    assert(alice.stats.trained >= 1, "vycvičen dělník");
    assert.strictEqual(alice.recent[0].result, "win");
    assert.deepStrictEqual(alice.recent[0].players.map(p => p.name), ["Alice", "Bob"]);
    assert.strictEqual((await profile("Bob")).stats.losses, 1);
    assert.strictEqual((await profile("Bob")).stats.wins, 0);
    assert(!JSON.stringify(alice).includes("@"), "profil neprozrazuje e-mail");

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
    assert.strictEqual(a.snap.u.length, 9);
    assert(a.snap.b.every(x => x[2] <= 2));
    assert.strictEqual(a.snap.u.filter(u => u[2] === 2).length, 3, "AI má své jednotky");

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
    assert.strictEqual((await profile("Alice")).stats.games, 1, "krátký zápas se nezapisuje");

    /* ----- čtyři hráči: tři lidé a zavřený slot, odchody a předání hostitele ----- */
    a.send({ t: "leave" });
    await a.until(() => a.msgs.some(m => m.t === "left"), 2000, "A odešel");
    await b.until(() => b.room && b.room.host === b.room.you, 2000, "B je nový hostitel");
    b.send({ t: "leave" });
    await b.until(() => b.msgs.some(m => m.t === "left"), 2000, "B odešel");
    await sleep(100);
    await a.until(() => a.list && !a.list.some(r => r.map === "highland"), 2000, "prázdná místnost zmizela");

    const d = bot("Dan");
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
    await d.until(() => d.list && d.list.some(r => r.id === c.room.id && r.players === 4 && r.max === 4), 2000, "zavřený slot se počítá jako obsazený");
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
    assert.strictEqual(a.snap.u.length, 9);
    assert.strictEqual(a.snap.b.length, 3);

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
    fs.rmSync(mapsDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// Malá vlastní mapa pro testy: dvě základny, řeka uprostřed a dostatečné doly.
function sampleDoc(id) {
  const bases = [{ x: 200, y: 340 }, { x: 1000, y: 340 }];
  const gold = bases.flatMap(b => MAPS.baseMinesFor(b.x, b.y, 1200, 680));

  return {
    format: "goralia-map", version: 1, id, name: "Zkušební aréna", description: "Mapa z testu.",
    size: [600, 340], seed: 5, autoRoads: true, bases, gold,
    trees: [[100, 80], [1100, 600], [400, 100]],
    water: [{ pts: [[300, 0], [305, 100], [295, 200], [300, 340]], hw: 5 }],
    roads: []
  };
}

/* ---------- formát vlastní mapy ---------- */
function testMapDocs() {
  for (const map of MAPS.list.filter(m => !m.custom)) {
    assert.deepStrictEqual(CHECK.check(map), [], `${map.id}: vestavěná mapa projde kontrolou`);
  }

  const doc = sampleDoc("sample");
  const { doc: clean, errors } = MAPS.normalizeDoc(doc);
  assert.deepStrictEqual(errors, []);

  const map = MAPS.compileDoc(clean);
  assert.strictEqual(map.players, 2);
  assert.strictEqual(map.tag, "1v1 · velká");
  assert.deepStrictEqual(CHECK.check(map), [], "vzorová mapa je hratelná");

  // mapa se dá zahrát: AI hra poběží bez chyby
  const match = new Match(map, [{ name: "A", ai: true }, { name: "B", ai: true }], { countdown: 0 });
  for (let t = 0; t < 30; t += TICK) { match.step(TICK); match.endTick(); }
  assert.strictEqual(match.phase, "playing");

  // špatné vstupy
  const bad = (patch, text) => assert(MAPS.normalizeDoc({ ...doc, ...patch }).errors.length > 0, text);
  assert(MAPS.normalizeDoc(null).errors.length > 0);
  assert(MAPS.normalizeDoc({ ...doc, format: "jine" }).errors.length > 0);
  bad({ id: "../etc" }, "id s lomítkem");
  bad({ id: "" }, "prázdné id");
  bad({ name: "  " }, "prázdný název");
  bad({ size: [10, 10] }, "malá mapa");
  bad({ size: [5001, 5000] }, "obrovská mapa");
  bad({ bases: [{ x: 100, y: 100 }] }, "jedna základna");

  // nesmysly uvnitř se ořížnou nebo zahodí
  const messy = MAPS.normalizeDoc({
    ...doc,
    description: "<b>x</b>".repeat(200),
    trees: [[1, 1], ["a", 2], [99999, 5], null],
    gold: [[300, 300, 999999999]],
    water: [{ pts: [[0, 0]], hw: 5 }, { pts: [[0, 0], [10, 10]], hw: 999 }]
  }).doc;
  assert(messy.description.length <= 400 && !/[<>]/.test(messy.description));
  assert.deepStrictEqual(messy.trees, [[1, 1]]);
  assert.strictEqual(messy.gold[0][2], 20000);
  assert.strictEqual(messy.water.length, 1);
  assert.strictEqual(messy.water[0].hw, 20);

  // vestavěné mapy nejde přepsat; vlastní se registruje a zase odebere
  MAPS.register(map);
  assert.strictEqual(MAPS.get("sample"), map);
  assert(MAPS.unregister("sample") && !MAPS.get("sample"));
  assert(!MAPS.unregister("sample"));

  // dvě základny vedle sebe nemají místo: kontrola to ohlásí
  const close = MAPS.compileDoc(MAPS.normalizeDoc({ ...doc, bases: [{ x: 200, y: 340 }, { x: 225, y: 340 }] }).doc);
  assert(CHECK.check(close).length > 0, "blízké základny jsou chyba");

  // území základen se nikdy nepřekrývají
  const six = MAPS.zonesFor([{ x: 300, y: 260 }, { x: 1000, y: 260 }, { x: 1700, y: 260 }, { x: 300, y: 940 }, { x: 1000, y: 940 }, { x: 1700, y: 940 }], 2000, 1200);
  six.forEach((z, i) => six.forEach((o, j) => {
    if (j > i) assert(!(z.x0 < o.x1 && o.x0 < z.x1 && z.y0 < o.y1 && o.y0 < z.y1), `zóny ${i} a ${j} se překrývají`);
  }));
}

/* ---------- obří mapy ---------- */
function testHugeMap() {
  // rastrová mřížka vody dává stejný výsledek jako bodový test
  for (const map of MAPS.list.filter(m => !m.custom)) {
    const nav = NAV.forMap(map);
    let diff = 0;

    for (let cy = 0; cy < nav.h; cy++) {
      for (let cx = 0; cx < nav.w; cx++) {
        const water = MAPS.isWater(map.terrain, (cx + 0.5) * 4, (cy + 0.5) * 4);
        if (water !== (nav.blocked[cy * nav.w + cx] === 1)) diff++;
      }
    }

    assert.strictEqual(diff, 0, `${map.id}: mřížka vody se shoduje s isWater`);
  }

  // 10 000 × 10 000 jednotek: řeka přes celou mapu s brodem a dva týmy daleko od sebe
  const bases = [{ x: 600, y: 5000 }, { x: 9400, y: 5000 }];
  const gold = bases.flatMap(b => MAPS.baseMinesFor(b.x, b.y, 10000, 10000));
  const doc = {
    format: "goralia-map", version: 1, id: "obri", name: "Obří", description: "Test obří mapy.",
    size: [5000, 5000], seed: 3, autoRoads: true, bases, gold, trees: [[3000, 3000]],
    water: [{ pts: Array.from({ length: 51 }, (_, i) => [2500 + (i % 2) * 6, i * 100]), hw: 8 }],
    roads: [{ pts: [[2300, 2500], [2700, 2500]], w: 5, main: true }]
  };

  const { doc: clean, errors } = MAPS.normalizeDoc(doc);
  assert.deepStrictEqual(errors, []);

  const started = Date.now();
  const map = MAPS.compileDoc(clean);
  assert.deepStrictEqual(CHECK.check(map), [], "obří mapa je hratelná");
  assert(Date.now() - started < 5000, "kontrola obří mapy je rychlá");

  // bez brodu jsou základny odříznuté
  const cut = MAPS.compileDoc(MAPS.normalizeDoc({ ...doc, roads: [], autoRoads: false }).doc);
  assert(CHECK.check(cut).some(p => /nejsou propojené/.test(p)), "řeka bez brodu odděluje základny");

  const match = new Match(map, [{ name: "A", ai: true }, { name: "B", ai: true }], { countdown: 0 });
  for (let t = 0; t < 5; t += TICK) { match.step(TICK); match.endTick(); }
  assert.strictEqual(match.phase, "playing");
}

async function main() {
  require("./mapstore.js").load(); // mapy z repozitáře (maps/*.json)
  testMaps();
  testHugeMap();
  testMapDocs();
  testSimulation();
  await testServer();
}

main().then(() => process.exit(0), err => {
  console.error(err);
  process.exit(1);
});
