/*
 * Autoritativní simulace zápasu 1v1.
 * Klienti posílají jen záměry (rozkazy, nákup, stavba, kouzla). Server je ověří
 * a sám spočítá ekonomiku, pohyb, souboje i výsledek, takže nejde podvádět.
 */
"use strict";

const R = require("../js/rules.js");

const TICK = 0.05;
const MAX_IDS = 40;

const UNIT_TYPES = ["worker", "soldier", "archer", "hero"];
const BUILDING_TYPES = ["hall", "citadel", "barracks", "tower"];
const ORDER_CODES = { move: 1, attack: 2, gather: 3 };

const alive = entity => !!entity && entity.hp > 0;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const foe = team => (team === "blue" ? "red" : "blue");
const xpNeeded = level => level * 40;
const round1 = v => Math.round(v * 10) / 10;
const isNum = v => typeof v === "number" && Number.isFinite(v);

class Match {
  constructor(names) {
    this.names = names;
    this.nextId = 1;
    this.units = [];
    this.buildings = [];
    this.resources = [];
    this.econ = {
      blue: { gold: R.BASE_GOLD, wood: R.BASE_WOOD },
      red: { gold: R.BASE_GOLD, wood: R.BASE_WOOD }
    };
    this.phase = "countdown";
    this.countdown = R.COUNTDOWN;
    this.elapsed = 0;
    this.winner = null;
    this.reason = null;
    this.events = [];
    this.notes = { blue: [], red: [] };

    for (const b of R.LAYOUT.buildings) this.createBuilding(b.type, b.team, b.x, b.y, false);
    for (const u of R.LAYOUT.units) this.createUnit(u.type, u.team, u.x, u.y);

    for (const [x, y] of R.LAYOUT.gold) {
      this.resources.push({ id: this.nextId++, type: "gold", x, y, amount: Infinity });
    }

    for (const [x, y] of R.LAYOUT.trees) {
      this.resources.push({ id: this.nextId++, type: "wood", x, y, amount: 100 });
    }
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
      level: 1, xp: 0, facing: team === "red" ? -1 : 1
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
    if (this.notes[team].length < 4) this.notes[team].push(text);
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
    if (this.phase !== "playing" || !msg || typeof msg !== "object") return;

    switch (msg.c) {
      case "train": return this.train(team, msg.type);
      case "build": return this.build(team, msg);
      case "order": return this.order(team, msg);
      case "fire": return this.fire(team, msg);
      case "heal": return this.heal(team);
      case "surrender": return this.finish(foe(team), "surrender");
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

    this.createUnit(type, team, source.x + (team === "blue" ? 58 : -58), source.y + 29);
    if (type === "hero") this.note(team, "Hrdina připraven: A ohnivá koule, S léčení.");
  }

  placementProblem(team, x, y) {
    const zone = R.buildZone(team);

    if (x < zone.x0 || x > zone.x1 || y < zone.y0 || y > zone.y1) {
      return "Stavět lze jen ve vlastní části mapy.";
    }

    const spot = { x, y };
    const blocked =
      this.buildings.some(b => alive(b) && distance(b, spot) < 90) ||
      this.resources.some(r => r.amount > 0 && distance(r, spot) < 48);

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
    } else if (msg.k === "move") {
      if (!isNum(msg.x) || !isNum(msg.y)) return;
    } else {
      return;
    }

    const point = target || {
      x: clamp(msg.x, 12, R.WIDTH - 12),
      y: clamp(msg.y, 38, R.MAP_HEIGHT - 14)
    };

    for (const unit of units) {
      if (msg.k === "attack") {
        unit.order = { type: "attack", target };
      } else if (msg.k === "gather" && unit.type === "worker") {
        unit.order = { type: "gather", target };
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

    unit.x = clamp(unit.x + dx / length * step, 12, R.WIDTH - 12);
    unit.y = clamp(unit.y + dy / length * step, 38, R.MAP_HEIGHT - 14);

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

    const hero = this.heroOf(foe(target.team));
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

  gather(unit, dt) {
    const order = unit.order;
    if (!order || order.type !== "gather") return false;

    const resource = order.target;
    const hq = this.hqOf(unit.team);

    if (unit.carry) {
      if (!hq) return true;

      if (this.moveTowards(unit, hq, dt, 48)) {
        this.econ[unit.team][unit.carry] += 10;
        this.events.push({ e: "coin", id: unit.id, r: unit.carry });
        unit.carry = null;
      }

      return true;
    }

    if (!resource || resource.amount <= 0) {
      unit.order = null;
      return false;
    }

    if (this.moveTowards(unit, resource, dt, resource.type === "gold" ? 31 : 24)) {
      unit.harvestTimer += dt;
      unit.working = true;
      unit.facing = resource.x < unit.x ? -1 : 1;

      if (unit.harvestTimer >= 0.9) {
        unit.harvestTimer = 0;
        unit.carry = resource.type;
        if (resource.type === "wood") resource.amount -= 10;
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
    this.resources = this.resources.filter(r => r.amount > 0);

    const blueDown = !this.hqOf("blue");
    const redDown = !this.hqOf("red");

    if (blueDown || redDown) {
      this.finish(blueDown && redDown ? null : blueDown ? "red" : "blue", "hq");
    }
  }

  finish(winner, reason) {
    if (this.phase === "ended") return;

    this.phase = "ended";
    this.winner = winner;
    this.reason = reason;
    this.events.push({ e: "end", w: winner, why: reason });
  }

  /* ---------- state sent to clients ---------- */
  // Jednotka: [id, typ, tým, x, y, hp, maxHp, facing, nese, úroveň, xp, rozkaz, oheň, léčení, práce, poškození]
  snapshot(team) {
    const eco = this.econ[team];

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
        u.team === "blue" ? 0 : 1,
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
        b.team === "blue" ? 0 : 1,
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
        r.type === "gold" ? -1 : r.amount
      ]),
      e: this.events,
      n: this.notes[team]
    };
  }

  endTick() {
    this.events = [];
    this.notes.blue = [];
    this.notes.red = [];
  }
}

module.exports = { Match, TICK };
