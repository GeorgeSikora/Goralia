/*
 * Pravidla zápasu pro 2 až 4 hráče, sdílená serverem (Node) i prohlížečem.
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
    barracks: { gold: 125, wood: 70 }
  };

  // [hp, rychlost, poškození, dosah, prodleva mezi útoky]
  const UNITS = {
    worker:  { hp: 65,  speed: 55, damage: 6,  range: 22,  delay: 0.85 },
    soldier: { hp: 110, speed: 45, damage: 15, range: 25,  delay: 0.72 },
    archer:  { hp: 70,  speed: 49, damage: 11, range: 110, delay: 1.04 },
    hero:    { hp: 210, speed: 53, damage: 23, range: 34,  delay: 0.68 }
  };

  // Všechny základny mají stejné zdraví, aby byl souboj férový.
  const BUILDING_HP = { hall: 1500, citadel: 1500, barracks: 290, tower: 175 };

  // Index slotu na mapě = index týmu.
  const TEAMS = ["blue", "red", "gold", "violet"];
  const HQ = { blue: "hall", red: "citadel", gold: "hall", violet: "hall" };
  const TEAM_NAMES = { blue: "Modrá", red: "Rudá", gold: "Zlatá", violet: "Fialová" };
  const MAX_PLAYERS = TEAMS.length;
  const BASE_GOLD = 260;
  const BASE_WOOD = 120;
  const GOLD_AMOUNT = 2000; // výchozí zásoba zlatého dolu; mapa může u dolu uvést třetí číslo
  const SUPPLY_MAX = 30;
  const MAX_BUILDINGS = 20;
  const COUNTDOWN = 3;

  return {
    COSTS, UNITS, BUILDING_HP, TEAMS, HQ, TEAM_NAMES, MAX_PLAYERS, BASE_GOLD, BASE_WOOD, GOLD_AMOUNT,
    SUPPLY_MAX, MAX_BUILDINGS, COUNTDOWN
  };
});
