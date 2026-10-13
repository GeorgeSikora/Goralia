/*
 * Příkazy správce pro testování („/resources“, „/spawn knight 5“ …). Mění rozehraný zápas (sim.Match)
 * za jeden tým. Online je spouští jen server a jen pro účet s rolí admin, v zápase proti AI je spouští
 * prohlížeč, a to také jen přihlášenému adminovi. Zápas s použitým příkazem se nezapisuje do statistik.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./rules.js"), require("./sim.js"));
  } else {
    (root.PK = root.PK || {}).admincmd = factory(root.PK.rules, root.PK.sim);
  }
})(typeof window !== "undefined" ? window : globalThis, (R, SIM) => {
"use strict";

const DEFAULT_AMOUNT = 10000;
const MAX_AMOUNT = 1000000;
const MAX_SPAWN = 50;
const MAX_SPEED = 10;
const MAX_HERO_LEVEL = 30;

const alive = e => e && e.hp > 0;
const mine = (match, team, list) => list.filter(e => e.team === team && alive(e));
const enemy = (match, team, e) => alive(e) && !match.friendly(team, e.team);

// Celé kladné číslo z argumentu, nebo výchozí hodnota; null, když argument číslo není.
function count(arg, fallback, max) {
  if (arg == null || arg === "") return fallback;
  const n = Math.floor(Number(arg));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : null;
}

// Přepínač: „on/off“, „1/0“, „zap/vyp“, bez argumentu se stav otočí.
function toggle(arg, now) {
  const a = String(arg || "").toLowerCase();
  if (["on", "1", "zap", "ano"].includes(a)) return true;
  if (["off", "0", "vyp", "ne"].includes(a)) return false;
  return !now;
}

function cheats(match) {
  if (!match.cheats) match.cheats = { god: new Set(), nocap: new Set() };
  return match.cheats;
}

function addResources(match, team, gold, wood) {
  const eco = match.econ[team];
  eco.gold += gold;
  eco.wood += wood;
  return gold && wood
    ? `Přidáno ${gold} zlata a ${wood} dřeva.`
    : gold ? `Přidáno ${gold} zlata.` : `Přidáno ${wood} dřeva.`;
}

// Jednotky se objeví v kruhu kolem sídla, ať nestojí jedna na druhé.
function spawn(match, team, type, n) {
  const hq = match.hqOf(team);
  if (!hq) return { error: "Nemáš sídlo, u kterého by se jednotky objevily." };

  const [sx, sy] = match.slotOf(team).spawn;
  for (let i = 0; i < n; i++) {
    const ring = 1 + Math.floor(i / 8);
    const angle = (i % 8) / 8 * Math.PI * 2 + ring * 0.4;
    const x = Math.max(12, Math.min(match.LW - 12, hq.x + sx + Math.cos(angle) * 18 * ring));
    const y = Math.max(38, Math.min(match.LH - 14, hq.y + sy + Math.sin(angle) * 14 * ring));
    match.createUnit(type, team, x, y);
  }
  return {};
}

function levelHero(match, hero, levels) {
  let done = 0;
  while (done < levels && hero.level < MAX_HERO_LEVEL) {
    hero.level++;
    hero.maxHp += 27;
    hero.hp = hero.maxHp;
    hero.damage += 3;
    done++;
  }
  hero.xp = 0;
  match.events.push({ e: "lvl", id: hero.id, l: hero.level });
  match.stats[hero.team].heroLevel = Math.max(match.stats[hero.team].heroLevel, hero.level);
  return done;
}

const unitList = () => SIM.HUMAN_UNITS.join(", ");

/*
 * Tabulka příkazů. args: popis argumentů pro nápovědu, run(match, team, args) vrátí text odpovědi
 * (nebo { error }). Příkaz s readOnly nic nemění, takže zápas zůstane započítaný.
 */
const COMMANDS = [
  {
    name: "help", aliases: ["napoveda", "?"], args: "", readOnly: true,
    desc: "Vypíše tuto tabulku příkazů.",
    run: () => help()
  },
  {
    name: "resources", aliases: ["sources", "suroviny"], args: "[počet]",
    desc: `Přidá zlato i dřevo (výchozí ${DEFAULT_AMOUNT} od každého).`,
    run: (m, team, [n]) => {
      const amount = count(n, DEFAULT_AMOUNT, MAX_AMOUNT);
      return amount == null ? { error: "Počet musí být kladné číslo." } : addResources(m, team, amount, amount);
    }
  },
  {
    name: "gold", aliases: ["zlato"], args: "[počet]",
    desc: `Přidá jen zlato (výchozí ${DEFAULT_AMOUNT}).`,
    run: (m, team, [n]) => {
      const amount = count(n, DEFAULT_AMOUNT, MAX_AMOUNT);
      return amount == null ? { error: "Počet musí být kladné číslo." } : addResources(m, team, amount, 0);
    }
  },
  {
    name: "wood", aliases: ["drevo"], args: "[počet]",
    desc: `Přidá jen dřevo (výchozí ${DEFAULT_AMOUNT}).`,
    run: (m, team, [n]) => {
      const amount = count(n, DEFAULT_AMOUNT, MAX_AMOUNT);
      return amount == null ? { error: "Počet musí být kladné číslo." } : addResources(m, team, 0, amount);
    }
  },
  {
    name: "spawn", aliases: ["jednotka"], args: "<jednotka> [počet]",
    desc: `Vytvoří jednotky u sídla zdarma a bez limitu (nejvýš ${MAX_SPAWN} najednou). Jednotky: ${unitList()}.`,
    run: (m, team, [type, n]) => {
      type = String(type || "").toLowerCase();
      if (!SIM.HUMAN_UNITS.includes(type)) return { error: `Neznámá jednotka. Použij: ${unitList()}.` };
      let amount = count(n, 1, MAX_SPAWN);
      if (amount == null) return { error: "Počet musí být kladné číslo." };
      if (type === "hero") {
        if (m.heroOf(team)) return { error: "Hrdinu už máš, může být jen jeden." };
        amount = 1;
      }
      const res = spawn(m, team, type, amount);
      return res.error ? res : `Vytvořeno: ${type} × ${amount}.`;
    }
  },
  {
    name: "finish", aliases: ["dokoncit"], args: "",
    desc: "Okamžitě dostaví všechny rozestavěné budovy a dokončí probíhající výzkumy.",
    run: (m, team) => {
      let built = 0;
      let researched = 0;
      for (const b of mine(m, team, m.buildings)) {
        if (b.progress < 1) {
          b.progress = 1;
          b.hp = b.maxHp;
          m.stats[team].built++;
          built++;
        }
        if (b.research) {
          m.finishResearch(team, b.research.kind);
          b.research = null;
          researched++;
        }
      }
      return `Dostavěno budov: ${built}, dokončeno výzkumů: ${researched}.`;
    }
  },
  {
    name: "tech", aliases: ["vyzkum"], args: "",
    desc: "Vyzkoumá všechno na nejvyšší stupeň (zbroj, zbraně, střelba, nástroje, opevnění).",
    run: (m, team) => {
      for (const b of mine(m, team, m.buildings)) b.research = null;
      for (const kind of SIM.RESEARCH_KINDS) {
        while (m.level(team, kind) < R.UPGRADES[kind].levels.length) m.finishResearch(team, kind);
      }
      return "Všechny výzkumy jsou na nejvyšším stupni.";
    }
  },
  {
    name: "heal", aliases: ["vylecit"], args: "",
    desc: "Vyléčí všechny tvé jednotky a opraví hotové budovy na plné zdraví.",
    run: (m, team) => {
      for (const u of mine(m, team, m.units)) u.hp = u.maxHp;
      for (const b of mine(m, team, m.buildings)) if (b.progress >= 1) b.hp = b.maxHp;
      return "Všechno vyléčeno a opraveno.";
    }
  },
  {
    name: "god", aliases: ["nesmrtelnost"], args: "[on|off]",
    desc: "Přepne nesmrtelnost: tvé jednotky a budovy neztrácí zdraví.",
    run: (m, team, [arg]) => {
      const set = cheats(m).god;
      const on = toggle(arg, set.has(team));
      if (on) set.add(team); else set.delete(team);
      return on ? "Nesmrtelnost zapnuta." : "Nesmrtelnost vypnuta.";
    }
  },
  {
    name: "nocap", aliases: ["limit"], args: "[on|off]",
    desc: "Přepne neomezený počet jednotek (limit z bud přestane platit).",
    run: (m, team, [arg]) => {
      const set = cheats(m).nocap;
      const on = toggle(arg, set.has(team));
      if (on) set.add(team); else set.delete(team);
      return on ? "Limit jednotek vypnut." : "Limit jednotek zase platí.";
    }
  },
  {
    name: "level", aliases: ["uroven"], args: "[počet]",
    desc: `Hrdina získá úrovně (výchozí 5, nejvýš do úrovně ${MAX_HERO_LEVEL}).`,
    run: (m, team, [n]) => {
      const hero = m.heroOf(team);
      if (!hero) return { error: "Nemáš hrdinu. Vytvoř ho třeba příkazem /spawn hero." };
      const levels = count(n, 5, MAX_HERO_LEVEL);
      if (levels == null) return { error: "Počet musí být kladné číslo." };
      levelHero(m, hero, levels);
      return `Hrdina má úroveň ${hero.level}.`;
    }
  },
  {
    name: "speed", aliases: ["rychlost"], args: "<1–10>",
    desc: "Zrychlí celý zápas (1 = normální rychlost). Online platí pro všechny v místnosti.",
    run: (m, team, [n]) => {
      const speed = count(n, null, MAX_SPEED);
      if (speed == null) return { error: `Zadej rychlost 1 až ${MAX_SPEED}.` };
      m.speed = speed;
      return speed === 1 ? "Normální rychlost." : `Zápas běží ${speed}× rychleji.`;
    }
  },
  {
    name: "kill", aliases: ["zabit"], args: "",
    desc: "Zabije všechny nepřátelské jednotky (budovy nechá stát).",
    run: (m, team) => {
      let n = 0;
      for (const u of m.units) {
        if (!enemy(m, team, u)) continue;
        u.hp = 0;
        m.events.push({ e: "hit", a: u.id, t: u.id, n: 0, k: 1, s: 1 });
        n++;
      }
      return `Zabito nepřátelských jednotek: ${n}.`;
    }
  },
  {
    name: "win", aliases: ["vyhra"], args: "",
    desc: "Zničí sídla všech nepřátel, takže zápas hned vyhraješ.",
    run: (m, team) => {
      const foes = m.active.filter(t => !m.out.has(t) && !m.friendly(team, t));
      if (!foes.length) return { error: "Žádný nepřítel už nezbyl." };
      for (const t of foes) m.eliminate(t, "hq");
      m.checkEnd("hq");
      return "Nepřátelé poraženi.";
    }
  }
];

const BY_NAME = new Map();
for (const c of COMMANDS) for (const n of [c.name, ...c.aliases]) BY_NAME.set(n, c);

function help() {
  return ["Příkazy správce:", ...COMMANDS.map(c => `/${[c.name, c.args].filter(Boolean).join(" ")} – ${c.desc}`)];
}

// Rozloží „/spawn knight 5“ na příkaz a argumenty; null, když text příkazem není.
function parse(text) {
  const raw = String(text == null ? "" : text).trim();
  if (!raw.startsWith("/")) return null;
  const [head, ...args] = raw.slice(1).split(/\s+/);
  const name = head.toLowerCase();
  return { name, args, command: BY_NAME.get(name) || null };
}

// Je to známý příkaz? (Server tak pozná, že zprávu od ne-admina nemá poslat do chatu.)
function isCommand(text) {
  const p = parse(text);
  return !!(p && p.command);
}

/*
 * Provede příkaz za tým. Vrátí { ok, lines, changed } (changed: zápas se změnil, nezapočítat do statistik).
 * Kontrolu, že hráč je admin, dělá volající.
 */
function run(match, team, text) {
  const p = parse(text);
  if (!p) return { ok: false, lines: ["Příkaz začíná lomítkem, třeba /help."], changed: false };
  if (!p.command) return { ok: false, lines: [`Neznámý příkaz /${p.name}. Seznam ukáže /help.`], changed: false };

  const c = p.command;
  if (!c.readOnly) {
    if (!match || match.phase !== "playing") return { ok: false, lines: ["Příkaz funguje jen v rozehraném zápase."], changed: false };
    if (!team || !match.econ[team] || match.out.has(team)) return { ok: false, lines: ["Ve hře nemáš vlastní tým."], changed: false };
  }

  const res = c.run(match, team, p.args);
  if (res && res.error) return { ok: false, lines: [res.error], changed: false };

  if (!c.readOnly) match.cheated = true;
  return { ok: true, lines: Array.isArray(res) ? res : [res], changed: !c.readOnly };
}

return { COMMANDS, run, parse, isCommand, help };
});
