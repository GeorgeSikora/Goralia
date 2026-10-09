/*
 * Test serveru: matchmaking, autoritativní pravidla a odolnost proti podvodům.
 * Spuštění: npm test
 */
"use strict";

const assert = require("assert");
const { spawn } = require("child_process");
const path = require("path");
const WebSocket = require("ws");

const PORT = 3100 + Math.floor(Math.random() * 500);
const URL = `ws://localhost:${PORT}`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

class Bot {
  constructor(name) {
    this.name = name;
    this.snap = null;
    this.msgs = [];
    this.ended = null;
    this.ws = new WebSocket(URL);
    this.opened = new Promise(r => this.ws.on("open", r));
    this.ws.on("message", data => {
      const m = JSON.parse(data);
      this.msgs.push(m);
      if (m.t === "match") this.match = m;
      if (m.t === "s") {
        this.snap = m;
        for (const e of m.e) if (e.e === "end") this.ended = e;
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

  units(team) { return this.snap.u.filter(u => u[2] === team); }
  notes() { return this.msgs.filter(m => m.t === "s").flatMap(m => m.n); }
}

async function main() {
  const proc = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "inherit"]
  });

  try {
    await new Promise(r => proc.stdout.once("data", r));

    // statické soubory: jen veřejné adresáře
    const get = p => fetch(`http://localhost:${PORT}${p}`).then(r => r.status);
    assert.strictEqual(await get("/"), 200);
    assert.strictEqual(await get("/js/game.js"), 200);
    assert.strictEqual(await get("/server/server.js"), 404);
    assert.strictEqual(await get("/package.json"), 404);
    assert.strictEqual(await get("/js/..%2Fpackage.json"), 404);
    assert.strictEqual(await get("/%2e%2e/package.json"), 404);

    const a = new Bot("A");
    const b = new Bot("B");
    await Promise.all([a.opened, b.opened]);

    // příkaz mimo zápas se ignoruje, ve frontě se čeká
    a.cmd({ c: "train", type: "worker" });
    a.send({ t: "queue", name: "Alice <script>" });
    await a.until(() => a.msgs.some(m => m.t === "queued"), 2000, "queued");
    await sleep(150);
    assert(!a.match, "sám se zápas nezačne");

    b.send({ t: "queue", name: "Bob" });
    await Promise.all([a.until(() => a.match, 2000, "match A"), b.until(() => b.match, 2000, "match B")]);
    assert.notStrictEqual(a.match.team, b.match.team);
    assert.strictEqual(a.match.opponent, "Bob");
    assert.strictEqual(b.match.opponent, "Alice script");

    await Promise.all([a, b].map(p => p.until(() => p.snap, 2000, "snapshot")));
    assert.strictEqual(a.snap.p, "countdown");

    // během odpočtu se nic nestane
    a.cmd({ c: "train", type: "worker" });
    await Promise.all([a, b].map(p => p.until(() => p.snap.p === "playing", 6000, "start hry")));
    assert.strictEqual(a.units(0).length + a.units(1).length, 8);

    const mine = p => (p.match.team === "blue" ? 0 : 1);

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

    // vzdání se ukončí zápas na serveru
    b.cmd({ c: "surrender" });
    await Promise.all([a, b].map(p => p.until(() => p.ended, 2000, "konec")));
    assert.strictEqual(a.ended.w, a.match.team);
    assert.strictEqual(a.ended.why, "surrender");

    // po konci jde znovu hledat soupeře; odpojení = výhra soupeře
    const c = new Bot("C");
    await c.opened;
    a.send({ t: "queue", name: "Alice" });
    c.send({ t: "queue", name: "Cyril" });
    await Promise.all([a.until(() => a.match && a.match.opponent === "Cyril" && a.snap.p !== "ended", 3000, "rematch"), c.until(() => c.match, 3000, "match C")]);
    a.ended = null;
    await c.until(() => c.snap && c.snap.p === "playing", 6000, "start 2");
    a.ws.close();
    await c.until(() => c.ended, 2000, "výhra po odpojení");
    assert.strictEqual(c.ended.why, "disconnect");
    assert.strictEqual(c.ended.w, c.match.team);

    // fronta: zrušení hledání
    const d = new Bot("D");
    const e = new Bot("E");
    await Promise.all([d.opened, e.opened]);
    d.send({ t: "queue", name: "D" });
    await d.until(() => d.msgs.some(m => m.t === "queued"), 2000, "D queued");
    d.send({ t: "unqueue" });
    await d.until(() => d.msgs.some(m => m.t === "unqueued"), 2000, "D unqueued");
    e.send({ t: "queue", name: "E" });
    await sleep(300);
    assert(!d.match && !e.match, "zrušený hráč se nespáruje");

    [b, c, d, e].forEach(p => p.ws.close());
    console.log("OK: všechny testy serveru prošly");
  } finally {
    proc.kill();
  }
}

main().then(() => process.exit(0), err => {
  console.error(err);
  process.exit(1);
});
