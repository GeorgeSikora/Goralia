/*
 * Pravidla online zápasu 1v1, sdílená serverem (Node) i prohlížečem.
 * Server podle nich simuluje celou hru, klient je používá jen k zobrazení.
 */
(function (root, factory) {
  const rules = factory();
  if (typeof module === "object" && module.exports) module.exports = rules;
  else (root.PK = root.PK || {}).rules = rules;
})(typeof window !== "undefined" ? window : globalThis, () => {
  "use strict";

  const WIDTH = 960;
  const MAP_HEIGHT = 480;

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

  // Obě základny mají stejné zdraví, aby byl souboj férový. Online základny vydrží víc než v AI hře,
  // protože jim útočí živý hráč a soupeř musí mít čas zareagovat.
  const BUILDING_HP = { hall: 1500, citadel: 1500, barracks: 290, tower: 175 };

  const HQ = { blue: "hall", red: "citadel" };
  const BASE_GOLD = 260;
  const BASE_WOOD = 120;
  const SUPPLY_MAX = 30;
  const MAX_BUILDINGS = 20;
  const MIDLINE = 480;
  const COUNTDOWN = 3;

  const mirror = ([x, y]) => [WIDTH - x, y];

  const goldMines = [[320, 112], [390, 394]];

  const trees = [
    [29, 69], [64, 53], [102, 70], [143, 48], [192, 78], [232, 54],
    [32, 382], [66, 427], [113, 404], [164, 430], [249, 416],
    [434, 69], [466, 98], [502, 55],
    [520, 397], [560, 425], [599, 394], [631, 423],
    [706, 67], [754, 88], [919, 80], [920, 373], [890, 421], [737, 414],
    [812, 58], [868, 96], [828, 428], [864, 392], [935, 410]
  ];

  const LAYOUT = {
    buildings: [
      { type: "hall", team: "blue", x: 120, y: 238 },
      { type: "barracks", team: "blue", x: 191, y: 354 },
      { type: "citadel", team: "red", x: 850, y: 234 },
      { type: "barracks", team: "red", x: 769, y: 354 }
    ],
    units: [
      { type: "worker", team: "blue", x: 173, y: 194 },
      { type: "worker", team: "blue", x: 164, y: 266 },
      { type: "soldier", team: "blue", x: 259, y: 234 },
      { type: "soldier", team: "blue", x: 280, y: 255 },
      { type: "worker", team: "red", x: 787, y: 194 },
      { type: "worker", team: "red", x: 796, y: 266 },
      { type: "soldier", team: "red", x: 701, y: 234 },
      { type: "soldier", team: "red", x: 680, y: 255 }
    ],
    gold: [...goldMines, ...goldMines.map(mirror)],
    trees
  };

  // Strana mapy, na které smí hráč stavět.
  function buildZone(team) {
    return team === "blue"
      ? { x0: 45, x1: MIDLINE, y0: 85, y1: MAP_HEIGHT - 45 }
      : { x0: MIDLINE, x1: 915, y0: 85, y1: MAP_HEIGHT - 45 };
  }

  return {
    WIDTH, MAP_HEIGHT, COSTS, UNITS, BUILDING_HP, HQ, BASE_GOLD, BASE_WOOD,
    SUPPLY_MAX, MAX_BUILDINGS, COUNTDOWN, LAYOUT, buildZone
  };
});
