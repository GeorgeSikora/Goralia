/*
 * Autoritativní simulace zápasu pro 2 až 4 hráče (každý sám za sebe), lidi i AI.
 * Klienti posílají jen záměry (rozkazy, nákup, stavba, kouzla). Simulace je ověří
 * a sáma spočítá ekonomiku, pohyb, souboje i výsledek, takže nejde podvádět.
 * Běží na serveru (online) i v prohlížeči (hra proti AI).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./rules.js"), require("./ai.js"));
  } else {
    (root.PK = root.PK || {}).sim = factory(root.PK.rules, root.PK.ai);
  }
})(typeof window !== "undefined" ? window : globalThis, (R, AI) => {
"use strict";

const TICK = 0.05;
const MAX_IDS = 40;

const UNIT_TYPES = ["worker", "soldier", "archer", "hero"];
const BUILDING_TYPES = ["hall", "citadel", "barracks", "tower"];
const ORDER_CODES = { move: 1, attack: 2, gather: 3, deliver: 4 };

const alive = entity => !!entity && entity.hp > 0;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const xpNeeded = level => level * 40;
const round1 = v => Math.round(v * 10) / 10;
const isNum = v => typeof v === "number" && Number.isFinite(v);
const teamIndex = team => R.TEAMS.indexOf(team);

class Match {
  // players: pole podle slotů mapy, každý prvek { name, ai } nebo null (prázdný slot bez základny).
  constructor(map, players, opts = {}) {
    this.map = map;
    this.LW = map.size[0] * 2;
    this.LH = map.size[1] * 2;
    this.players = map.slots.map((_, i) => players[i] || null);
    this.nextId = 1;
    this.units = [];
    this.buildings = [];
    this.resources = [];
    this.active = [];
    this.out = new Set();
    this.econ = {};
    this.notes = {};
    this.brains = {};
    this.phase = "countdown";
    this.countdown = opts.countdown == null ? R.COUNTDOWN : opts.countdown;
    if (this.countdown <= 0) this.phase = "playing";
    this.elapsed = 0;
    this.winner = null;
    this.reason = null;
    this.events = [];

    map.slots.forEach((slot, i) => {
      if (!this.players[i]) return;

      const team = R.TEAMS[i];
      this.active.push(team);
      this.econ[team] = { gold: R.BASE_GOLD, wood: R.BASE_WOOD };
      this.notes[team] = [];
      if (this.players[i].ai) this.brains[team] = AI.createBrain(team);

      this.createBuilding(slot.hq.type, team, slot.hq.x, slot.hq.y, false);
      for (const b of slot.buildings) this.createBuilding(b.type, team, b.x, b.y, false);
      for (const u of slot.units) this.createUnit(u.type, team, u.x, u.y);
    });

    for (const [x, y, amount] of map.gold) {
      this.resources.push({ id: this.nextId++, type: "gold", x, y, amount: amount || R.GOLD_AMOUNT });
    }

    for (const [x, y] of map.trees) {
      this.resources.push({ id: this.nextId++, type: "wood", x, y, amount: 100 });
    }
  }

  slotOf(team) {
    return this.map.slots[teamIndex(team)];
  }

  /* ---------- entities ---------- */
  createBuilding(type, team, x, y, fresh) {
    const hp = R.BUILDING_HP[type];
    const building = {
      id: this.nextId++, kind: "building", type, team, x, y, hp, maxHp: hp,
      cooldown: 0, fresh
    };
    this.buildings.push(building);
    return building;
  }

  createUnit(type, team, x, y) {
    const s = R.UNITS[type];
    const unit = {
      id: this.nextId++, kind: "unit", type, team, x, y,
      hp: s.hp, maxHp: s.hp, speed: s.speed, damage: s.damage, range: s.range,
      attackDelay: s.delay, cooldown: 0, fireCooldown: 0, healCooldown: 0,
      order: null, harvestTimer: 0, carry: null, working: false,
      level: 1, xp: 0, facing: this.slotOf(team).facing
    };
    this.units.push(unit);
    return unit;
  }

  hqOf(team) {
    return this.buildings.find(b => b.team === team && b.type === R.HQ[team] && alive(b));
  }

  heroOf(team) {
    return this.units.find(u => u.team === team && u.type === "hero" && alive(u));
  }

  note(team, text) {
    const list = this.notes[team];
    if (list && list.length < 4) list.push(text);
  }

  entity(id) {
    return (
      this.units.find(u => u.id === id) ||
      this.buildings.find(b => b.id === id) ||
      null
    );
  }

  ownUnits(team, ids) {
    if (!Array.isArray(ids)) return [];
    const out = [];

    for (const id of ids.slice(0, MAX_IDS)) {
      const unit = this.units.find(u => u.id === id);
      if (unit && unit.team === team && alive(unit) && !out.includes(unit)) out.push(unit);
    }

    return out;
  }

  /* ---------- commands (validated, never trusted) ---------- */
  command(team, msg) {
    if (this.phase !== "playing" || this.out.has(team) || !this.econ[team] || !msg || typeof msg !== "object") return;

    switch (msg.c) {
      case "train": return this.train(team, msg.type);
      case "build": return this.build(team, msg);
      case "order": return this.order(team, msg);
      case "fire": return this.fire(team, msg);
      case "heal": return this.heal(team);
      case "surrender": return this.resign(team, "surrender");
      default:
    }
  }

  pay(team, type) {
    const price = R.COSTS[type];
    const eco = this.econ[team];

    if (eco.gold < price.gold || eco.wood < price.wood) {
      this.note(team, `Potřebuješ ${price.gold} zlata a ${price.wood} dřeva.`);
      return false;
    }

    eco.gold -= price.gold;
    eco.wood -= price.wood;
    return true;
  }

  train(team, type) {
    if (!UNIT_TYPES.includes(type)) return;

    const source = type === "worker"
      ? this.hqOf(team)
      : this.buildings.find(b => b.team === team && b.type === "barracks" && alive(b));

    if (!source) {
      return this.note(team, type === "worker" ? "Potřebuješ radnici." : "Potřebuješ kasárna.");
    }

    const mine = this.units.filter(u => u.team === team && alive(u));

    if (type === "hero" && mine.some(u => u.type === "hero")) {
      return this.note(team, "Současně můžeš mít jen jednoho hrdinu.");
    }

    if (mine.length >= R.SUPPLY_MAX) return this.note(team, "Maximum je 30 jednotek.");
    if (!this.pay(team, type)) return;

    const spawn = this.slotOf(team).spawn;
    this.createUnit(type, team, source.x + spawn[0], source.y + spawn[1]);
    if (type === "hero") this.note(team, "Hrdina připraven: A ohnivá koule, S léčení.");
  }

  placementProblem(team, x, y) {
    const zone = this.slotOf(team).zone;

    if (x < zone.x0 || x > zone.x1 || y < zone.y0 || y > zone.y1) {
      return "Stavět lze jen ve vlastní části mapy.";
    }

    const spot = { x, y };
    const blocked =
      this.buildings.some(b => alive(b) && distance(b, spot) < 90) ||
      this.resources.some(r => (r.type === "gold" || r.amount > 0) && distance(r, spot) < 48);

    return blocked ? "Na tomto místě není dost prostoru." : null;
  }

  build(team, msg) {
    const type = msg.type;
    if (type !== "tower" && type !== "barracks") return;
    if (!isNum(msg.x) || !isNum(msg.y)) return;

    if (!this.ownUnits(team, msg.ids).some(u => u.type === "worker")) {
      return this.note(team, "Pro stavbu nejdřív vyber dělníka.");
    }

    if (this.buildings.filter(b => b.team === team && alive(b)).length >= R.MAX_BUILDINGS) {
      return this.note(team, "Dosáhl jsi maxima staveb.");
    }

    const x = Math.round(msg.x);
    const y = Math.round(msg.y);
    const problem = this.placementProblem(team, x, y);

    if (problem) return this.note(team, problem);
    if (!this.pay(team, type)) return;

    this.createBuilding(type, team, x, y, true);
    this.note(team, "Stavba dokončena.");
  }

  order(team, msg) {
    const units = this.ownUnits(team, msg.ids);
    if (!units.length) return;

    let target = null;

    if (msg.k === "attack") {
      target = this.entity(msg.target);
      if (!alive(target) || target.team === team) return;
    } else if (msg.k === "gather") {
      target = this.resources.find(r => r.id === msg.target && r.amount > 0);
      if (!target) return;
    } else if (msg.k === "deliver") {
      target = this.buildings.find(b => b.id === msg.target && b.team === team && b.type === R.HQ[team] && alive(b));
      if (!target) return;
    } else if (msg.k === "move") {
      if (!isNum(msg.x) || !isNum(msg.y)) return;
    } else {
      return;
    }

    const point = target || {
      x: clamp(msg.x, 12, this.LW - 12),
      y: clamp(msg.y, 38, this.LH - 14)
    };

    for (const unit of units) {
      if (msg.k === "attack") {
        unit.order = { type: "attack", target };
      } else if (msg.k === "gather" && unit.type === "worker") {
        unit.order = { type: "gather", target };
      } else if (msg.k === "deliver" && unit.type === "worker") {
        // po vyložení se pokračuje v předchozí těžbě
        const resume = unit.order && unit.order.type === "gather" ? unit.order.target : null;
        unit.order = { type: "deliver", target, resume };
      } else {
        unit.order = { type: "move", x: point.x, y: point.y };
      }
    }
  }

  fire(team, msg) {
    const hero = this.heroOf(team);

    if (!hero) return this.note(team, "Nejdřív vyber hrdinu.");
    if (!isNum(msg.x) || !isNum(msg.y)) return;

    if (hero.fireCooldown > 0) {
      return this.note(team, `Ohnivá koule: ještě ${Math.ceil(hero.fireCooldown)} s.`);
    }

    const point = { x: msg.x, y: msg.y };

    if (distance(hero, point) > 180) return this.note(team, "Cíl je příliš daleko od hrdiny.");

    hero.fireCooldown = 10;
    hero.facing = point.x < hero.x ? -1 : 1;
    this.events.push({ e: "fire", h: hero.id, x: round1(point.x), y: round1(point.y) });

    let hits = 0;

    for (const enemy of [...this.units, ...this.buildings]) {
      if (!alive(enemy) || enemy.team === team) continue;

      const radius = enemy.kind === "building" ? 70 : 47;

      if (distance(enemy, point) <= radius) {
        this.damage(hero, enemy, 42 + hero.level * 10, { silent: true, delay: 0.3 });
        hits++;
      }
    }

    this.note(team, hits ? `Ohnivá koule zasáhla ${hits} cílů!` : "Ohnivá koule minula.");
  }

  heal(team) {
    const hero = this.heroOf(team);

    if (!hero) return this.note(team, "Nejdřív vyber hrdinu.");

    if (hero.healCooldown > 0) {
      return this.note(team, `Léčení: ještě ${Math.ceil(hero.healCooldown)} s.`);
    }

    const amount = 42 + hero.level * 10;
    const healed = [];

    for (const ally of this.units) {
      if (ally.team !== team || !alive(ally) || distance(ally, hero) > 90 || ally.hp >= ally.maxHp) continue;
      ally.hp = Math.min(ally.maxHp, ally.hp + amount);
      healed.push(ally.id);
    }

    hero.healCooldown = 14;
    this.events.push({ e: "heal", h: hero.id, ids: healed, n: amount });
    this.note(team, `Vyléčeno spojenců: ${healed.length}.`);
  }

  /* ---------- simulation ---------- */
  moveTowards(unit, target, dt, stop = 0) {
    const dx = target.x - unit.x;
    const dy = target.y - unit.y;
    const length = Math.hypot(dx, dy);

    if (length <= stop || length < 0.001) return true;
    if (Math.abs(dx) > 0.4) unit.facing = dx < 0 ? -1 : 1;

    const step = Math.min(unit.speed * dt, length - stop);

    unit.x = clamp(unit.x + dx / length * step, 12, this.LW - 12);
    unit.y = clamp(unit.y + dy / length * step, 38, this.LH - 14);

    return length - step <= stop + 0.5;
  }

  nearestEnemy(entity, maxDistance) {
    let nearest = null;
    let best = maxDistance;

    for (const list of [this.units, this.buildings]) {
      for (const candidate of list) {
        if (!alive(candidate) || candidate.team === entity.team) continue;
        const d = distance(entity, candidate);

        if (d < best) {
          nearest = candidate;
          best = d;
        }
      }
    }

    return nearest;
  }

  awardExperience(attacker, target) {
    if (target.kind !== "unit") return;

    const hero = this.heroOf(attacker.team);
    if (!hero) return;
    if (attacker !== hero && distance(hero, target) > 145) return;

    hero.xp += 25;
    this.events.push({ e: "xp", id: hero.id, n: 25 });

    while (hero.xp >= xpNeeded(hero.level)) {
      hero.xp -= xpNeeded(hero.level);
      hero.level++;
      hero.maxHp += 27;
      hero.hp = Math.min(hero.maxHp, hero.hp + 55);
      hero.damage += 3;
      this.events.push({ e: "lvl", id: hero.id, l: hero.level });
      this.note(hero.team, `Hrdina dosáhl úrovně ${hero.level}!`);
    }
  }

  damage(attacker, target, amount, opts = {}) {
    if (!alive(target)) return;

    target.hp -= amount;
    const killed = target.hp <= 0;
    if (killed) target.hp = 0;

    const event = { e: "hit", a: attacker.id, t: target.id, n: amount, k: killed ? 1 : 0 };
    if (opts.silent) event.s = 1;
    if (opts.delay) event.d = opts.delay;
    this.events.push(event);

    if (killed) this.awardExperience(attacker, target);
  }

  strike(unit, target) {
    unit.facing = target.x < unit.x ? -1 : 1;
    this.damage(unit, target, unit.damage);
    unit.cooldown = unit.attackDelay;
  }

  dropOff(unit) {
    this.econ[unit.team][unit.carry] += 10;
    this.events.push({ e: "coin", id: unit.id, r: unit.carry });
    unit.carry = null;
  }

  // Nejbližší zásoba stejného druhu, když se ta původní vyčerpala.
  nextResource(from) {
    let best = null;
    let bestDistance = 700;

    for (const r of this.resources) {
      if (r.type !== from.type || r.amount <= 0) continue;
      const d = distance(r, from);

      if (d < bestDistance) {
        best = r;
        bestDistance = d;
      }
    }

    return best;
  }

  deliver(unit, dt) {
    const hq = this.hqOf(unit.team);

    if (!hq) {
      unit.order = null;
      return false;
    }

    if (!this.moveTowards(unit, hq, dt, 48)) return true;

    if (unit.carry) this.dropOff(unit);

    const resume = unit.order.resume;
    unit.order = resume ? { type: "gather", target: resume } : null;
    return true;
  }

  gather(unit, dt) {
    const order = unit.order;
    if (!order) return false;
    if (order.type === "deliver") return this.deliver(unit, dt);
    if (order.type !== "gather") return false;

    const hq = this.hqOf(unit.team);

    if (unit.carry) {
      if (!hq) return true;
      if (this.moveTowards(unit, hq, dt, 48)) this.dropOff(unit);
      return true;
    }

    let resource = order.target;

    if (!resource || resource.amount <= 0) {
      const next = resource && this.nextResource(resource);

      if (!next) {
        unit.order = null;
        return false;
      }

      order.target = next;
      resource = next;
    }

    if (this.moveTowards(unit, resource, dt, resource.type === "gold" ? 31 : 24)) {
      unit.harvestTimer += dt;
      unit.working = true;
      unit.facing = resource.x < unit.x ? -1 : 1;

      if (unit.harvestTimer >= 0.9) {
        unit.harvestTimer = 0;
        unit.carry = resource.type;
        resource.amount = Math.max(0, resource.amount - 10);
      }
    }

    return true;
  }

  step(dt) {
    if (this.phase === "countdown") {
      this.countdown -= dt;
      if (this.countdown <= 0) this.phase = "playing";
      return;
    }

    if (this.phase !== "playing") return;

    this.elapsed += dt;

    for (const team of this.active) {
      if (this.brains[team] && !this.out.has(team)) AI.think(this, this.brains[team], dt);
    }

    for (const building of this.buildings) {
      if (!alive(building)) continue;

      building.cooldown -= dt;

      if (building.type === "tower" && building.cooldown <= 0) {
        const target = this.nearestEnemy(building, 155);

        if (target) {
          this.damage(building, target, 20);
          building.cooldown = 0.85;
        }
      }
    }

    for (const unit of this.units) {
      if (!alive(unit)) continue;

      unit.cooldown -= dt;
      unit.fireCooldown = Math.max(0, unit.fireCooldown - dt);
      unit.healCooldown = Math.max(0, unit.healCooldown - dt);
      unit.working = false;

      if (unit.type === "worker" && this.gather(unit, dt)) continue;

      if (unit.order && unit.order.type === "move") {
        if (this.moveTowards(unit, unit.order, dt, 5)) unit.order = null;
        continue;
      }

      let target = unit.order && unit.order.type === "attack" && alive(unit.order.target)
        ? unit.order.target
        : null;

      if (!target) target = this.nearestEnemy(unit, 100);
      if (!target) continue;

      const reach = unit.range + (target.kind === "building" ? 24 : 0);

      if (distance(unit, target) > reach) {
        // Bez rozkazu se bojové jednotky samy pustí do nepřátel v dosahu; dělníci zůstávají stát.
        const hunting = unit.order
          ? unit.order.type === "attack"
          : unit.type !== "worker";

        if (hunting) this.moveTowards(unit, target, dt, reach - 2);
      } else if (unit.cooldown <= 0) {
        this.strike(unit, target);
      }
    }

    this.units = this.units.filter(alive);
    this.buildings = this.buildings.filter(alive);
    this.resources = this.resources.filter(r => r.type === "gold" || r.amount > 0);

    this.updateOutcome();
  }

  /* ---------- konec hry ---------- */
  // Hráč bez HQ vypadává. Hra končí, když zůstane jeden tým nebo žádný člověk.
  updateOutcome() {
    const standing = this.active.filter(t => !this.out.has(t));
    const down = standing.filter(t => !this.hqOf(t));
    if (!down.length) return;

    if (down.length === standing.length) {
      for (const t of down) this.out.add(t);
      this.finish(null, "hq");
      return;
    }

    for (const t of down) this.eliminate(t, "hq");
    this.checkEnd();
  }

  eliminate(team, why) {
    if (this.out.has(team)) return;

    this.out.add(team);
    this.events.push({ e: "out", t: teamIndex(team), why });
    this.units = this.units.filter(u => u.team !== team);
    this.buildings = this.buildings.filter(b => b.team !== team);
  }

  resign(team, why) {
    if (this.phase === "ended" || this.out.has(team) || !this.econ[team]) return;

    this.eliminate(team, why);
    this.checkEnd(why);
  }

  checkEnd(why = "hq") {
    if (this.phase === "ended") return;

    const standing = this.active.filter(t => !this.out.has(t));
    const humans = standing.filter(t => !this.brains[t]);

    if (standing.length <= 1 || !humans.length) {
      this.finish(standing.length === 1 ? standing[0] : null, standing.length === 1 ? why : "defeat");
    }
  }

  finish(winner, reason) {
    if (this.phase === "ended") return;

    this.phase = "ended";
    this.winner = winner;
    this.reason = reason;
    this.events.push({ e: "end", w: winner ? teamIndex(winner) : -1, why: reason });
  }

  /* ---------- state sent to clients ---------- */
  // Jednotka: [id, typ, tým, x, y, hp, maxHp, facing, nese, úroveň, xp, rozkaz, oheň, léčení, práce, poškození]
  snapshot(team) {
    const eco = this.econ[team] || { gold: 0, wood: 0 };

    return {
      t: "s",
      p: this.phase,
      c: Math.max(0, Math.ceil(this.countdown)),
      el: round1(this.elapsed),
      g: eco.gold,
      w: eco.wood,
      u: this.units.map(u => [
        u.id,
        UNIT_TYPES.indexOf(u.type),
        teamIndex(u.team),
        round1(u.x),
        round1(u.y),
        Math.ceil(u.hp),
        u.maxHp,
        u.facing < 0 ? 0 : 1,
        u.carry === "gold" ? 1 : u.carry === "wood" ? 2 : 0,
        u.level,
        u.xp,
        u.order ? ORDER_CODES[u.order.type] : 0,
        round1(u.fireCooldown),
        round1(u.healCooldown),
        u.working ? 1 : 0,
        u.damage
      ]),
      // Budova: [id, typ, tým, x, y, hp, maxHp]
      b: this.buildings.map(b => [
        b.id,
        BUILDING_TYPES.indexOf(b.type),
        teamIndex(b.team),
        b.x,
        b.y,
        Math.ceil(b.hp),
        b.maxHp
      ]),
      // Surovina: [id, typ (0 zlato, 1 dřevo), x, y, množství]
      r: this.resources.map(r => [
        r.id,
        r.type === "gold" ? 0 : 1,
        r.x,
        r.y,
        r.amount
      ]),
      e: this.events,
      n: this.notes[team] || []
    };
  }

  endTick() {
    this.events = [];
    for (const team of this.active) this.notes[team] = [];
  }
}

return { Match, TICK, UNIT_TYPES, BUILDING_TYPES };
});
