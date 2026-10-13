/*
 * Pravidla zápasu pro 2 až 6 hráčů, sdílená serverem (Node) i prohlížečem.
 * Server podle nich simuluje celou hru, klient je používá jen k zobrazení.
 * Rozložení mapy (základny, doly, stromy) je v maps.js.
 */
(function (root, factory) {
  const rules = factory();
  if (typeof module === "object" && module.exports) module.exports = rules;
  else (root.PK = root.PK || {}).rules = rules;
})(typeof window !== "undefined" ? window : globalThis, () => {
  "use strict";

  const COSTS = {
    worker:   { gold: 50,  wood: 0 },
    soldier:  { gold: 65,  wood: 15 },
    archer:   { gold: 80,  wood: 30 },
    hero:     { gold: 150, wood: 50 },
    tower:    { gold: 90,  wood: 55 },
    barracks: { gold: 125, wood: 70 },
    hut:      { gold: 70,  wood: 40 },
    smithy:   { gold: 120, wood: 80 }
  };

  // Výzkum v kovárně: tři stupně, cena a doba výzkumu (s) pro každý. Platí pro všechny vojáky týmu.
  const UPGRADES = {
    armor:  { name: "Zbroj",  levels: [{ gold: 90,  wood: 40,  time: 20 }, { gold: 140, wood: 70,  time: 30 }, { gold: 200, wood: 100, time: 40 }] },
    weapon: { name: "Zbraně", levels: [{ gold: 100, wood: 30,  time: 20 }, { gold: 150, wood: 60,  time: 30 }, { gold: 210, wood: 90,  time: 40 }] }
  };
  const ARMOR_PER_LEVEL = 0.12; // část poškození, kterou voják za stupeň zbroje neutrpí
  const WEAPON_PER_LEVEL = 3;   // bonus k poškození vojáka za stupeň zbraní

  // [hp, rychlost, poškození, dosah, prodleva mezi útoky]
  const UNITS = {
    worker:  { hp: 65,  speed: 55, damage: 6,  range: 22,  delay: 0.85 },
    soldier: { hp: 110, speed: 45, damage: 15, range: 25,  delay: 0.72 },
    archer:  { hp: 70,  speed: 49, damage: 11, range: 110, delay: 1.04 },
    hero:    { hp: 210, speed: 53, damage: 23, range: 34,  delay: 0.68 },
    // nemrtví z pekla (jen AI na kooperativních mapách)
    ghoul:       { hp: 90,  speed: 60, damage: 11, range: 24,  delay: 0.62 },
    skeleton:    { hp: 55,  speed: 47, damage: 10, range: 105, delay: 1.1 },
    abomination: { hp: 300, speed: 37, damage: 24, range: 28,  delay: 1.15 },
    banshee:     { hp: 80,  speed: 54, damage: 15, range: 92,  delay: 1.25 },
    lich:        { hp: 800, speed: 42, damage: 26, range: 75,  delay: 1.2 }
  };

  // Všechny základny mají stejné zdraví, aby byl souboj férový.
  const BUILDING_HP = {
    hall: 1500, citadel: 1500, barracks: 290, tower: 175, hut: 200, smithy: 260,
    necropolis: 5000, crypt: 850, slaughterhouse: 950, ziggurat: 550, portal: 1000
  };

  // Půdorys budovy, kterým jednotky neprojdou: [polovina šířky, hloubka] v logických jednotkách.
  // Přední hrana leží FOOT_FRONT pod středem budovy (tam, kde stojí nohy jednotky před zdí),
  // obdélník sahá od ní o hloubku dozadu. Rozměry odpovídají spodku sprajtu v buildings.js.
  const FOOTPRINT = {
    hall: [64, 58], citadel: [78, 64], barracks: [60, 50], tower: [24, 20], hut: [24, 20], smithy: [34, 28],
    necropolis: [82, 70], crypt: [46, 36], slaughterhouse: [50, 40], ziggurat: [34, 28], portal: [52, 40]
  };
  const FOOT_FRONT = 24;
  const footRect = b => {
    const [hx, depth] = FOOTPRINT[b.type] || [20, 20];
    return { x0: b.x - hx, x1: b.x + hx, y0: b.y + FOOT_FRONT - depth, y1: b.y + FOOT_FRONT };
  };

  // Nová stavba nesmí půdorysem zasahovat do jiné budovy ani k surovině; mezi budovami zůstane aspoň úzký průchod.
  const FOOT_GAP = 10;
  const footFree = (type, x, y, buildings, resources) => {
    const f = footRect({ type, x, y });
    const clash = buildings.some(b => {
      if (!(b.hp > 0)) return false;
      const o = footRect(b);
      return f.x0 < o.x1 + FOOT_GAP && f.x1 > o.x0 - FOOT_GAP && f.y0 < o.y1 + FOOT_GAP && f.y1 > o.y0 - FOOT_GAP;
    });
    return !clash && !resources.some(r => (r.type === "gold" || r.amount > 0) &&
      r.x > f.x0 - 16 && r.x < f.x1 + 16 && r.y > f.y0 - 16 && r.y < f.y1 + 16);
  };

  // Doba stavby v sekundách (jeden dělník). Nemrtvým budovy rostou samy, bez dělníků.
  const BUILD_TIME = { tower: 10, barracks: 12, hut: 8, smithy: 14, crypt: 22, slaughterhouse: 28, ziggurat: 16, portal: 30 };

  // Oprava hotové budovy dělníkem: každý krok vezme 1 zlato a 1 dřevo a vrátí budově pár životů.
  // Bez surovin oprava končí. Jeden dělník tak opraví 20 životů za sekundu za 4 zlata a 4 dřeva.
  const REPAIR = { step: 0.25, hp: 5, gold: 1, wood: 1 };

  /*
   * Nemrtví z pekla: AI frakce pro kooperativní mapy (hráči v jednom týmu proti ní).
   * Nemá ekonomiku. Budovy samy chrlí jednotky, Nekropole a zigguraty střílí, pevnost se časem rozrůstá
   * a v pravidelných vlnách útočí na základny hráčů. Vlny i výroba sílí s časem a s počtem hráčů.
   */
  const UNDEAD = {
    name: "Nemrtví z pekla",
    short: "Nemrtví", // jméno v seznamu hráčů ve hře
    hq: "necropolis",
    units: ["ghoul", "skeleton", "abomination", "banshee", "lich"],
    buildings: ["necropolis", "crypt", "slaughterhouse", "ziggurat", "portal"],
    // budova -> [typ jednotky, základní interval v sekundách], střídá se dokola
    produce: {
      crypt: [["ghoul", 12], ["skeleton", 15]],
      slaughterhouse: [["abomination", 36]],
      portal: [["banshee", 20], ["ghoul", 15]]
    },
    defense: {
      necropolis: { damage: 28, range: 190, delay: 1.1 },
      ziggurat: { damage: 17, range: 165, delay: 1.0 }
    },
    lichRespawn: 120,
    novaEvery: 11,          // pekelný výbuch licha
    novaRadius: 85,
    firstWave: 240,         // s: první útok
    waveEvery: 110,         // s: rozestup vln, každou vlnou kratší...
    minWaveEvery: 60,       // ...až na tohle minimum
    buildEvery: 95,         // s: pevnost postaví další budovu
    maxBuildings: 14,
    expand: [["crypt", 2], ["ziggurat", 2], ["portal", 1], ["slaughterhouse", 1]]
  };

  // Index slotu na mapě = index týmu.
  const TEAMS = [
    "blue", "red", "gold", "violet", "green", "silver", "orange", "teal",
    "pink", "brown", "lime", "black", "maroon", "sand", "magenta", "olive"
  ];
  const HQ = Object.fromEntries(TEAMS.map(t => [t, "hall"]));
  const TEAM_NAMES = {
    blue: "Modrá", red: "Rudá", gold: "Zlatá", violet: "Fialová", green: "Zelená", silver: "Stříbrná",
    orange: "Oranžová", teal: "Tyrkysová", pink: "Růžová", brown: "Hnědá", lime: "Limetková", black: "Černá",
    maroon: "Vínová", sand: "Písková", magenta: "Purpurová", olive: "Olivová"
  };
  const MAX_PLAYERS = TEAMS.length;
  const BASE_GOLD = 260;
  const BASE_WOOD = 120;
  const GOLD_AMOUNT = 2000; // výchozí zásoba zlatého dolu; mapa může u dolu uvést třetí číslo
  // Limit jednotek: základ od hlavní budovy + 5 za každou dostavěnou chatrč, nejvýše SUPPLY_MAX.
  const SUPPLY_BASE = 12;
  const SUPPLY_PER_HUT = 5;
  const SUPPLY_MAX = 60;
  const MAX_BUILDINGS = 30;
  const COUNTDOWN = 3;

  const supplyCap = huts => Math.min(SUPPLY_MAX, SUPPLY_BASE + SUPPLY_PER_HUT * huts);

  return {
    UNDEAD, COSTS, UPGRADES, ARMOR_PER_LEVEL, WEAPON_PER_LEVEL, UNITS, BUILDING_HP, FOOTPRINT, footRect, footFree, BUILD_TIME, REPAIR, TEAMS, HQ, TEAM_NAMES, MAX_PLAYERS, BASE_GOLD, BASE_WOOD, GOLD_AMOUNT,
    SUPPLY_BASE, SUPPLY_PER_HUT, SUPPLY_MAX, supplyCap, MAX_BUILDINGS, COUNTDOWN
  };
});
