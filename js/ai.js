/*
 * Jednoduché AI pro počítačové hráče. Řídí se stejnými příkazy jako člověk
 * (match.command), takže se na něj vztahují stejná pravidla a ověření.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./rules.js"));
  else (root.PK = root.PK || {}).ai = factory(root.PK.rules);
})(typeof window !== "undefined" ? window : globalThis, R => {
  "use strict";

  const alive = e => !!e && e.hp > 0;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const WORKERS_WANTED = 7;
  const FIRST_WAVE = 10;
  const FIRST_WAVE_AT = 240;
  const MAX_WAVE = 20;

  function createBrain(team) {
    return {
      team,
      timer: 1 + Math.random() * 2,
      nextWave: FIRST_WAVE,
      attacking: false,
      target: null,
      flip: 0
    };
  }

  const canPay = (eco, type) => eco.gold >= R.COSTS[type].gold && eco.wood >= R.COSTS[type].wood;

  function nearestResource(match, from, type) {
    const candidates = match.resources
      .filter(r => r.type === type && r.amount > 0)
      .map(r => ({ r, d: distance(r, from) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);

    return candidates.length ? candidates[Math.floor(Math.random() * candidates.length)].r : null;
  }

  function assignWorkers(match, brain, hq, workers) {
    const eco = match.econ[brain.team];

    // rozestavěná budova bez stavitele (jeho dělník padl nebo dostal jiný rozkaz)
    let orphan = match.buildings.find(b =>
      b.team === brain.team && b.progress < 1 && alive(b) &&
      !workers.some(w => w.order && w.order.type === "build" && w.order.target === b));

    for (const worker of workers) {
      if (worker.order || worker.carry) continue;

      if (orphan) {
        match.command(brain.team, { c: "order", k: "build", ids: [worker.id], target: orphan.id });
        orphan = null;
        continue;
      }

      const type = eco.wood < eco.gold * 0.6 + 60 ? "wood" : "gold";
      const resource = nearestResource(match, hq, type) || nearestResource(match, hq, "gold");
      if (resource) match.command(brain.team, { c: "order", k: "gather", ids: [worker.id], target: resource.id });
    }
  }

  function buildNear(match, brain, hq, type, worker) {
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 130 + Math.random() * 170;
      const x = Math.round(hq.x + Math.cos(a) * d);
      const y = Math.round(hq.y + Math.sin(a) * d);

      if (!match.placementProblem(brain.team, x, y)) {
        match.command(brain.team, { c: "build", type, x, y, ids: [worker.id] });
        return true;
      }
    }

    return false;
  }

  function produce(match, brain, hq, workers, army) {
    const team = brain.team;
    const eco = match.econ[team];
    const barracks = match.buildings.filter(b => b.team === team && b.type === "barracks" && alive(b));
    const ready = barracks.filter(b => b.progress >= 1);
    const towers = match.buildings.filter(b => b.team === team && b.type === "tower" && alive(b));
    const huts = match.buildings.filter(b => b.team === team && b.type === "hut" && alive(b));
    const hasHero = army.some(u => u.type === "hero");
    const builder = workers.find(w => !w.order || w.order.type !== "build") || workers[0];

    if (workers.length < WORKERS_WANTED && canPay(eco, "worker")) {
      match.command(team, { c: "train", type: "worker" });
    }

    if (builder && barracks.length < (match.elapsed > 240 ? 2 : 1) && canPay(eco, "barracks")) {
      buildNear(match, brain, hq, "barracks", builder);
    }

    // dostáváme se na limit jednotek: chatrč (jedna rozestavěná najednou)
    const supply = workers.length + army.length;
    const cap = match.supplyCap(team);

    if (builder && supply >= cap - 2 && cap < R.SUPPLY_MAX && !huts.some(h => h.progress < 1) && canPay(eco, "hut")) {
      buildNear(match, brain, hq, "hut", builder);
    }

    if (!ready.length) return;

    if (!hasHero && canPay(eco, "hero")) match.command(team, { c: "train", type: "hero" });

    for (let i = 0; i < 2; i++) {
      const type = brain.flip++ % 3 === 2 ? "archer" : "soldier";
      if (canPay(eco, type)) match.command(team, { c: "train", type });
    }

    if (workers.length && army.length >= 5 && towers.length < 2 && eco.wood >= 120 && canPay(eco, "tower")) {
      buildNear(match, brain, hq, "tower", builder);
    }
  }

  function nearestEnemyHq(match, team, from) {
    let best = null;

    for (const b of match.buildings) {
      if (b.team === team || b.type !== R.HQ[b.team] || !alive(b) || match.out.has(b.team)) continue;
      if (!best || distance(b, from) < distance(best, from)) best = b;
    }

    return best;
  }

  const hasAttackOrder = u => u.order && u.order.type === "attack" && alive(u.order.target);

  function command(match, brain, hq, army) {
    const team = brain.team;
    const fighters = army;

    if (!brain.attacking && fighters.length >= brain.nextWave && match.elapsed >= FIRST_WAVE_AT) {
      brain.attacking = true;
      brain.target = null;
    }

    if (brain.attacking) {
      if (fighters.length < 3) {
        brain.attacking = false;
        brain.nextWave = Math.min(MAX_WAVE, brain.nextWave + 3);
        match.command(team, { c: "order", k: "move", ids: fighters.map(u => u.id).slice(0, 40), x: hq.x, y: hq.y + 90 });
      } else {
        if (!alive(brain.target) || match.out.has(brain.target.team)) brain.target = nearestEnemyHq(match, team, hq);

        if (!brain.target) {
          brain.attacking = false;
        } else {
          const idle = fighters.filter(u => !hasAttackOrder(u)).map(u => u.id).slice(0, 40);
          if (idle.length) match.command(team, { c: "order", k: "attack", ids: idle, target: brain.target.id });
        }
      }
    } else {
      const threat = match.units.find(u =>
        u.team !== team && alive(u) && !match.out.has(u.team) && distance(u, hq) < 320);

      if (threat) {
        const idle = fighters.filter(u => !hasAttackOrder(u)).map(u => u.id).slice(0, 40);
        if (idle.length) match.command(team, { c: "order", k: "attack", ids: idle, target: threat.id });
      }
    }

    const hero = army.find(u => u.type === "hero");
    if (!hero) return;

    if (hero.healCooldown <= 0) {
      const hurt = army.filter(u => u.hp < u.maxHp * 0.7 && distance(u, hero) <= 90).length;
      if (hurt >= 2) match.command(team, { c: "heal" });
    }

    if (hero.fireCooldown <= 0) {
      let target = null;

      for (const e of [...match.units, ...match.buildings]) {
        if (e.team === team || !alive(e) || match.out.has(e.team)) continue;
        if (distance(e, hero) < 170 && (!target || distance(e, hero) < distance(target, hero))) target = e;
      }

      if (target) match.command(team, { c: "fire", x: target.x, y: target.y });
    }
  }

  function think(match, brain, dt) {
    brain.timer -= dt;
    if (brain.timer > 0) return;
    brain.timer = 0.7 + Math.random() * 0.5;

    const team = brain.team;
    const hq = match.hqOf(team);
    if (!hq) return;

    const mine = match.units.filter(u => u.team === team && alive(u));
    const workers = mine.filter(u => u.type === "worker");
    const army = mine.filter(u => u.type !== "worker");

    assignWorkers(match, brain, hq, workers);
    produce(match, brain, hq, workers, army);
    command(match, brain, hq, army);
  }

  return { createBrain, think };
});
