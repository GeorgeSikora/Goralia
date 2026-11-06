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
  const WORKERS_LATE = 10; // po čtyřech minutách víc dělníků, ať je na dražší jednotky
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

    repairDamaged(match, brain, workers);

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

    rebalance(match, brain, hq, workers);
  }

  // Dělník jednou poslaný na dřevo by ho jinak sekal pořád: když se jedné suroviny hromadí moc, jeden prázdný přejde na druhou.
  function rebalance(match, brain, hq, workers) {
    const eco = match.econ[brain.team];
    const on = type => workers.filter(w => !w.carry && w.order && w.order.type === "gather" && w.order.target.type === type);
    const from = eco.wood > eco.gold * 2 + 250 ? "wood" : eco.gold > eco.wood * 3 + 300 ? "gold" : null;
    if (!from) return;

    const busy = on(from);
    const to = nearestResource(match, hq, from === "wood" ? "gold" : "wood");
    if (busy.length > 1 && to) match.command(brain.team, { c: "order", k: "gather", ids: [busy[0].id], target: to.id });
  }

  // Poškozenou budovu opraví jeden dělník, když je klid a zbývá zlato i dřevo na víc než opravu.
  function repairDamaged(match, brain, workers) {
    const eco = match.econ[brain.team];
    if (eco.gold < 60 || eco.wood < 60) return;

    const repairing = workers.filter(w => w.order && w.order.type === "repair");
    if (repairing.length >= 2) return;

    const damaged = match.buildings.find(b =>
      b.team === brain.team && alive(b) && b.progress >= 1 && b.hp < b.maxHp * 0.75 &&
      !repairing.some(w => w.order.target === b) &&
      !match.units.some(u => alive(u) && !match.friendly(u.team, brain.team) && distance(u, b) < 220));
    if (!damaged) return;

    const free = workers.filter(w => !w.carry && (!w.order || w.order.type === "gather"));
    if (!free.length) return;

    const worker = free.reduce((a, b) => (distance(a, damaged) <= distance(b, damaged) ? a : b));
    match.command(brain.team, { c: "order", k: "repair", ids: [worker.id], target: damaged.id });
  }

  function buildNear(match, brain, hq, type, worker) {
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 130 + Math.random() * 170;
      const x = Math.round(hq.x + Math.cos(a) * d);
      const y = Math.round(hq.y + Math.sin(a) * d);

      if (!match.placementProblem(brain.team, x, y, type)) {
        match.command(brain.team, { c: "build", type, x, y, ids: [worker.id] });
        return true;
      }
    }

    return false;
  }

  // Technologie se staví postupně: [budova, od kdy (s), kolik vojáků už musí být]. Na další z nich se šetří.
  const TECH = [["smithy", 150, 4], ["stable", 260, 6], ["workshop", 380, 8]];

  function produce(match, brain, hq, workers, army) {
    const team = brain.team;
    const eco = match.econ[team];
    const own = type => match.buildings.filter(b => b.team === team && b.type === type && alive(b));
    const barracks = own("barracks");
    const ready = barracks.filter(b => b.progress >= 1);
    const towers = own("tower");
    const huts = own("hut");
    const hasHero = army.some(u => u.hero) || (hq.heroT != null);
    const builder = workers.find(w => !w.order || w.order.type !== "build") || workers[0];

    // padlý hrdina má přednost: znovu ho vycvičí v gmině, jakmile na něj bude
    if (!hasHero && workers.length >= 4) {
      if (canPay(eco, "hero")) match.command(team, { c: "train", type: "hero" });
      else if (match.elapsed > 60) return;
    }

    if (workers.length < (match.elapsed > 240 ? WORKERS_LATE : WORKERS_WANTED) && canPay(eco, "worker")) {
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

    // další technologie: když na ni zrovna není, šetří se a armáda chvíli počká (pokud nehrozí útok)
    let saving = false;

    for (const [type, from, minArmy] of TECH) {
      if (own(type).length) continue;
      if (match.elapsed < from || army.length < minArmy || !builder) break;
      if (canPay(eco, type)) buildNear(match, brain, hq, type, builder);
      else saving = true;
      break;
    }

    const threat = match.units.some(u => alive(u) && !match.friendly(u.team, team) && u.type !== "worker" && distance(u, hq) < 420);
    if (saving && !threat) return;

    // výzkum: nástroje v gmině brzy, v kovárně střídavě, opevnění později
    if (match.elapsed > 100 && workers.length >= 5 && eco.gold > 200 && eco.wood > 90) {
      match.command(team, { c: "research", kind: "tools" });
    }
    if (own("smithy").some(s => s.progress >= 1) && eco.gold > 260) {
      match.command(team, { c: "research", kind: ["weapon", "armor", "archery"][brain.flip % 3] });
    }
    if (match.elapsed > 420 && eco.gold > 320 && eco.wood > 200) match.command(team, { c: "research", kind: "masonry" });


    const count = type => army.filter(u => u.type === type).length;
    // co staví nepřítel: proti jezdcům a zrůdám kopiníci
    const foesBig = match.units.filter(u => alive(u) && !match.friendly(u.team, team) && R.SPEAR.vs.includes(u.type)).length;
    const stable = own("stable").some(b => b.progress >= 1);
    const can = {
      knight: stable,
      scout: stable && count("scout") < 3,
      catapult: own("workshop").some(b => b.progress >= 1) && count("catapult") < 3,
      monk: count("monk") < Math.min(3, Math.floor(army.length / 6)),
      crossbow: own("smithy").some(b => b.progress >= 1),
      spearman: foesBig >= 2 && count("spearman") < Math.max(2, foesBig)
    };

    for (let i = 0; i < 2; i++) {
      const n = brain.flip++;
      let type = n % 3 === 2 ? (can.crossbow && n % 2 === 0 ? "crossbow" : "archer") : "soldier";
      if (can.spearman && n % 3 === 1) type = "spearman";
      else if (can.monk && n % 5 === 4) type = "monk";
      else if (can.catapult && n % 7 === 3) type = "catapult";
      else if (can.scout && n % 11 === 5) type = "scout";
      else if (can.knight && n % 2 === 1) type = "knight";
      // na dražší jednotku se počká, jinak by ji levní vojáci vždycky předběhli
      if (!canPay(eco, type)) {
        brain.flip--;
        break;
      }
      match.command(team, { c: "train", type });
    }

    if (workers.length && army.length >= 5 && towers.length < 2 && eco.wood >= 120 && canPay(eco, "tower")) {
      buildNear(match, brain, hq, "tower", builder);
    }
  }


  function nearestEnemyHq(match, team, from) {
    let best = null;

    for (const b of match.buildings) {
      if (match.friendly(b.team, team) || b.type !== match.hqType(b.team) || !alive(b) || match.out.has(b.team)) continue;
      if (!best || distance(b, from) < distance(best, from)) best = b;
    }

    return best;
  }

  const hasAttackOrder = u => u.order && u.order.type === "attack" && alive(u.order.target);

  function command(match, brain, hq, army) {
    const team = brain.team;
    const fighters = army;

    // proti pekelné pevnosti nemá smysl útočit po kouskách: větší armáda a později
    if (match.coop && !brain.coop) {
      brain.coop = true;
      brain.nextWave = 18;
    }

    // v kooperaci se útočí společně: až má celý tým dost vojska, vyrazí všichni najednou
    const allied = brain.coop
      ? match.units.filter(u => alive(u) && match.friendly(u.team, team) && u.type !== "worker" && !match.out.has(u.team)).length
      : 0;
    const ready = brain.coop
      ? allied >= 15 * Math.max(1, match.active.filter(t => !match.out.has(t) && match.friendly(t, team)).length) && fighters.length >= 8 && match.elapsed >= 420
      : fighters.length >= brain.nextWave && match.elapsed >= FIRST_WAVE_AT;

    if (!brain.attacking && ready) {
      brain.attacking = true;
      brain.target = null;
    }

    if (brain.attacking) {
      if (fighters.length < 3) {
        brain.attacking = false;
        brain.nextWave = Math.min(brain.coop ? 30 : MAX_WAVE, brain.nextWave + 3);
        match.command(team, { c: "order", k: "move", ids: fighters.map(u => u.id).slice(0, 40), x: hq.x, y: hq.y + 90 });
      } else {
        if (!alive(brain.target) || match.out.has(brain.target.team)) brain.target = nearestEnemyHq(match, team, hq);

        if (!brain.target) {
          brain.attacking = false;
        } else if (brain.coop) {
          // útočný pochod: cestou bojují se vším, i se zigguraty před Nekropolí
          const idle = fighters.filter(u => !u.order || u.order.type !== "amove").map(u => u.id).slice(0, 40);
          if (idle.length) match.command(team, { c: "order", k: "amove", ids: idle, x: brain.target.x, y: brain.target.y });
        } else {
          const idle = fighters.filter(u => !hasAttackOrder(u)).map(u => u.id).slice(0, 40);
          if (idle.length) match.command(team, { c: "order", k: "attack", ids: idle, target: brain.target.id });
        }
      }
    } else {
      const threat = match.units.find(u =>
        !match.friendly(u.team, team) && alive(u) && !match.out.has(u.team) && distance(u, hq) < 320);

      if (threat) {
        const idle = fighters.filter(u => !hasAttackOrder(u)).map(u => u.id).slice(0, 40);
        if (idle.length) match.command(team, { c: "order", k: "attack", ids: idle, target: threat.id });
      }
    }

    heroThink(match, brain, hq, army);
  }

  /*
   * Rytíř-hrdina AI: výpad na nejcennější cíl na dosah (lučištník, mnich, katapult, zraněný),
   * pokřik, když bojuje s dost spojenci, štítová zeď při přesile nebo nízkém zdraví.
   * Těžce raněný hrdina mimo útok ustoupí ke gmině (mniši ho tam vyléčí).
   */
  const VALUE = { archer: 3, crossbow: 3, monk: 3, catapult: 4, hero: 2.5, lich: 2.5, skeleton: 2, banshee: 2, necromancer: 3.5 };

  function heroThink(match, brain, hq, army) {
    const team = brain.team;
    const hero = army.find(u => u.hero);
    if (!hero || hero.dash) return;

    const abs = R.HERO.abilities[hero.type];
    const ready = k => hero.cds[k] <= 0 && hero.mana >= abs[k].mana;
    const foes = match.units.filter(u => alive(u) && !match.friendly(u.team, team) && !match.out.has(u.team));
    const near = r => foes.filter(u => distance(u, hero) <= r);
    const allies = r => army.filter(u => u !== hero && distance(u, hero) <= r).length;
    const fight = near(200);

    // ústup: hrdina se nevrhá do smrti sám
    if (hero.hp < hero.maxHp * 0.25 && fight.length >= 2 && !brain.attacking) {
      if (ready(2)) match.command(team, { c: "cast", k: 2 });
      match.command(team, { c: "order", k: "move", ids: [hero.id], x: hq.x, y: hq.y + 80 });
      return;
    }

    if (!fight.length) return;

    if (ready(2) && (near(150).length >= 3 || (hero.hp < hero.maxHp * 0.55 && near(120).length >= 1))) {
      return match.command(team, { c: "cast", k: 2 });
    }

    if (ready(1) && allies(abs[1].radius) >= 3 && near(180).length >= 2) {
      return match.command(team, { c: "cast", k: 1 });
    }

    if (ready(0) && hero.hp > hero.maxHp * 0.4) {
      let best = null;
      let bestScore = 0;
      for (const e of near(abs[0].range)) {
        const d = distance(e, hero);
        if (d < 50) continue; // zblízka stačí obyčejný úder
        const crowd = foes.filter(o => distance(o, e) <= abs[0].radius).length;
        const score = (VALUE[e.type] || 1) + crowd * 0.8 + (1 - e.hp / e.maxHp);
        if (score > bestScore) {
          best = e;
          bestScore = score;
        }
      }
      if (best && bestScore >= 2.5) match.command(team, { c: "cast", k: 0, x: best.x, y: best.y });
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
