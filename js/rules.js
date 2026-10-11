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

  // Doba stavby v sekundách (jeden dělník). Nemrtvým budovy rostou samy, bez dělníků.
  const BUILD_TIME = { tower: 10, barracks: 12, hut: 8, smithy: 14, crypt: 22, slaughterhouse: 28, ziggurat: 16, portal: 30 };

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
    UNDEAD, COSTS, UPGRADES, ARMOR_PER_LEVEL, WEAPON_PER_LEVEL, UNITS, BUILDING_HP, BUILD_TIME, TEAMS, HQ, TEAM_NAMES, MAX_PLAYERS, BASE_GOLD, BASE_WOOD, GOLD_AMOUNT,
    SUPPLY_BASE, SUPPLY_PER_HUT, SUPPLY_MAX, supplyCap, MAX_BUILDINGS, COUNTDOWN
  };
});
