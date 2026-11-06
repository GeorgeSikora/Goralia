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
    smithy:   { gold: 120, wood: 80 },
    monk:     { gold: 75,  wood: 25 },
    knight:   { gold: 135, wood: 45 },
    catapult: { gold: 150, wood: 110 },
    stable:   { gold: 140, wood: 90 },
    workshop: { gold: 150, wood: 95 },
    spearman: { gold: 55,  wood: 30 },
    crossbow: { gold: 90,  wood: 45 },
    scout:    { gold: 70,  wood: 25 }
  };

  // Kde se co cvičí. Dělníka a hrdinu cvičí hlavní budova týmu (R.HQ, "hall").
  const TRAINED_AT = {
    soldier: "barracks", archer: "barracks", hero: "hall", monk: "barracks", knight: "stable", catapult: "workshop",
    spearman: "barracks", crossbow: "barracks", scout: "stable"
  };
  // Jednotky, které kromě budovy výcviku potřebují ještě jinou dostavěnou budovu (kušiník = kovárna).
  const UNIT_NEEDS = { crossbow: "smithy" };
  // Stáj a dílna potřebují dostavěná kasárna.
  const REQUIRES = { stable: "barracks", workshop: "barracks" };

  // Výzkumy: stupně s cenou a dobou výzkumu (s). at = budova, kde se zkoumá (jedna budova = jeden výzkum najednou).
  // Platí pro celý tým, i pro jednotky vycvičené později.
  const UPGRADES = {
    armor:   { name: "Zbroj",    at: "smithy", levels: [{ gold: 90,  wood: 40,  time: 20 }, { gold: 140, wood: 70,  time: 30 }, { gold: 200, wood: 100, time: 40 }] },
    weapon:  { name: "Zbraně",   at: "smithy", levels: [{ gold: 100, wood: 30,  time: 20 }, { gold: 150, wood: 60,  time: 30 }, { gold: 210, wood: 90,  time: 40 }] },
    archery: { name: "Střelba",  at: "smithy", levels: [{ gold: 90,  wood: 60,  time: 20 }, { gold: 140, wood: 90,  time: 30 }, { gold: 190, wood: 95,  time: 40 }] },
    tools:   { name: "Nástroje", at: "hall",   levels: [{ gold: 100, wood: 50,  time: 25 }, { gold: 170, wood: 90,  time: 35 }] },
    masonry: { name: "Opevnění", at: "hall",   levels: [{ gold: 120, wood: 90,  time: 30 }, { gold: 180, wood: 95,  time: 40 }] }
  };
  const ARMOR_PER_LEVEL = 0.12; // část poškození, kterou voják nebo rytíř za stupeň zbroje neutrpí
  const WEAPON_PER_LEVEL = 3;   // bonus k poškození vojáka a rytíře za stupeň zbraní
  const MELEE = ["soldier", "knight", "spearman", "scout"]; // na koho platí zbroj a zbraně z kovárny
  const ARCHERY = { damage: 2, range: 10, units: ["archer", "crossbow"] }; // lučištník a kušiník za stupeň střelby
  const TOOLS_PER_LEVEL = 0.18;  // o kolik rychleji dělník natěží náklad za stupeň nástrojů
  const MASONRY = { hp: 0.15, tower: 4 }; // budovy +15 % zdraví, věže +4 poškození za stupeň opevnění

  // Strážní věž: poškození, dosah, prodleva.
  const TOWER = { damage: 20, range: 155, delay: 0.85 };

  // Rytíř: nápor. Po rozjezdu (aspoň charge jednotek dráhy od posledního úderu) první rána přidá bonus.
  const KNIGHT = { charge: 70, bonus: 14 };
  // Katapult: kámen dopadne na plochu (radius), budovám ubere násobek, blíž než min neumí střílet.
  const CATAPULT = { min: 70, radius: 30, splash: 0.5, building: 2.5, flight: 0.8 };
  // Mnich: léčí zraněné spojence v dosahu (range jednotky), hp za jedno požehnání.
  const MONK = { heal: 12 };
  // Kopiník: proti jezdcům a velkým zrůdám udeří násobkem (dlouhé kopí je zastaví).
  const SPEAR = { bonus: 1.9, vs: ["knight", "scout", "hero", "abomination", "hound", "lich", "plague"] };
  // Kušiník: šipka prorazí zbroj (výzkum zbroje cíle neplatí), budovám ubere víc.
  const CROSSBOW = { building: 1.3 };
  // Zvěd: rychlý lehký jezdec, který loví slabé jednotky v týlu (dělníky, střelce, mnichy, stroje).
  const SCOUT = { bonus: 1.7, vs: ["worker", "archer", "crossbow", "monk", "catapult", "skeleton", "necromancer", "banshee"] };
  // Nekromant: jednou za every s vyvolá kostlivce (žije life s), když jsou nepřátelé blíž než radius; nejvýš max najednou.
  const NECRO = { every: 14, life: 32, max: 2, radius: 230 };
  // Morovák: když padne, praskne a za delay s zasáhne nepřátele v okruhu radius.
  const PLAGUE = { damage: 34, radius: 52, delay: 0.35, building: 0.5 };
  // Veteráni: hodnost za zabité nepřátele (kills = práh pro 1., 2. a 3. hodnost), každá hodnost přidá
  // část poškození a zdraví. Hrdinové mají vlastní úrovně, veteránem se nestávají.
  const VETERAN = { kills: [3, 7, 12], damage: 0.08, hp: 0.08 };

  // [hp, rychlost, poškození, dosah, prodleva mezi útoky]
  const UNITS = {
    worker:  { hp: 65,  speed: 55, damage: 6,  range: 22,  delay: 0.85 },
    soldier: { hp: 110, speed: 45, damage: 15, range: 25,  delay: 0.72 },
    archer:  { hp: 70,  speed: 49, damage: 11, range: 110, delay: 1.04 },
    hero:    { hp: 240, speed: 52, damage: 21, range: 30,  delay: 0.7 }, // hrdina lidí: pěší rytíř se štítem
    monk:     { hp: 60,  speed: 48, damage: 4,  range: 90,  delay: 1.4 },
    knight:   { hp: 190, speed: 72, damage: 18, range: 27,  delay: 0.85 },
    catapult: { hp: 130, speed: 30, damage: 34, range: 200, delay: 3.6 },
    spearman: { hp: 95,  speed: 46, damage: 11, range: 34,  delay: 0.8 },
    crossbow: { hp: 80,  speed: 43, damage: 25, range: 125, delay: 2.1 },
    scout:    { hp: 90,  speed: 90, damage: 9,  range: 24,  delay: 0.6 },
    // nemrtví z pekla (jen AI na kooperativních mapách)
    ghoul:       { hp: 90,  speed: 60, damage: 11, range: 24,  delay: 0.62 },
    skeleton:    { hp: 55,  speed: 47, damage: 10, range: 105, delay: 1.1 },
    abomination: { hp: 300, speed: 37, damage: 24, range: 28,  delay: 1.15 },
    banshee:     { hp: 80,  speed: 54, damage: 15, range: 92,  delay: 1.25 },
    lich:        { hp: 680, speed: 42, damage: 24, range: 75,  delay: 1.2 }, // hrdina nemrtvých
    hound:       { hp: 70,  speed: 84, damage: 9,  range: 22,  delay: 0.55 },
    necromancer: { hp: 110, speed: 42, damage: 9,  range: 100, delay: 1.4 },
    plague:      { hp: 140, speed: 40, damage: 10, range: 24,  delay: 1.0 }
  };

  /*
   * Hrdinové: každá frakce má jednoho (lidé rytíře, nemrtví licha). Hráč ho dostane na začátku zápasu,
   * po smrti si ho vycvičí znovu v hlavní budově za cenu (COSTS.hero) a čas (train). Nemrtví nemají
   * ekonomiku, lich jim povstane sám po UNDEAD.lichRespawn sekundách.
   * Úrovně 1..maxLevel ze zabitých nepřátel: víc zdraví, útoku, many a kratší přebíjení schopností.
   * Každý hrdina má 3 schopnosti (klávesy Q/W/E): mana = cena, cd = přebíjení v sekundách,
   * range = dosah cílené schopnosti (klik na mapu), ostatní se sesílají hned kolem hrdiny.
   */
  const HERO = {
    types: { human: "hero", undead: "lich" },
    maxLevel: 5,
    xpKill: 25,
    xpNeeded: level => level * 40,
    train: 25, // s výcviku v hlavní budově
    cdPerLevel: 0.07, // každá úroveň nad první zkrátí přebíjení o 7 %
    mana: { base: 110, perLevel: 15, regen: 2.2, regenPerLevel: 0.35 },
    perLevel: { hero: { hp: 30, damage: 3 }, lich: { hp: 60, damage: 3 } },
    abilities: {
      hero: [
        // Výpad: rytíř se vrhne k cíli a zasáhne všechny nepřátele kolem místa dopadu
        { id: "lunge", name: "Výpad", mana: 30, cd: 9, range: 150, target: true, speed: 460, radius: 34, damage: 34, perLevel: 9 },
        // Bojový pokřik: spojenci v okolí (i rytíř) dávají po dobu time víc poškození
        { id: "warcry", name: "Bojový pokřik", mana: 40, cd: 20, radius: 130, time: 8, bonus: 0.3, perLevel: 0.05 },
        // Štítová zeď: rytíř a spojenci těsně u něj dostávají méně poškození
        { id: "shieldwall", name: "Štítová zeď", mana: 35, cd: 18, radius: 75, time: 6, self: 0.5, allies: 0.3, perLevel: 0.03 }
      ],
      lich: [
        // Ohnivá koule: poškození až po dopadu (Match.blasts), budovy zasáhne ve větším okruhu
        { id: "fireball", name: "Ohnivá koule", mana: 35, cd: 8, range: 190, target: true, unitR: 47, buildingR: 70, damage: 46, perLevel: 11 },
        // Vyvolání: dva kostlivci vylezou ze země vedle licha a po life sekundách se rozpadnou
        { id: "summon", name: "Vyvolání kostlivců", mana: 50, cd: 22, count: 2, life: 40 },
        // Mrazivá aura: nepřátelé kolem licha chodí i útočí pomaleji, dokud aura trvá
        { id: "frost", name: "Mrazivá aura", mana: 40, cd: 18, radius: 100, time: 7, slow: 0.45, attack: 1.35, perLevel: 0.03 }
      ]
    }
  };

  // Všechny základny mají stejné zdraví, aby byl souboj férový.
  const BUILDING_HP = {
    hall: 1500, citadel: 1500, barracks: 290, tower: 175, hut: 200, smithy: 260, stable: 320, workshop: 300,
    necropolis: 5000, crypt: 850, slaughterhouse: 950, ziggurat: 550, portal: 1000
  };

  // Půdorys budovy, kterým jednotky neprojdou: [polovina šířky, hloubka] v logických jednotkách.
  // Přední hrana leží FOOT_FRONT pod středem budovy (tam, kde stojí nohy jednotky před zdí),
  // obdélník sahá od ní o hloubku dozadu. Rozměry odpovídají spodku sprajtu v buildings.js.
  const FOOTPRINT = {
    hall: [64, 58], citadel: [78, 64], barracks: [60, 50], tower: [24, 20], hut: [24, 20], smithy: [34, 28], stable: [52, 40], workshop: [46, 38],
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
  const BUILD_TIME = { tower: 10, barracks: 12, hut: 8, smithy: 14, stable: 14, workshop: 16, crypt: 22, slaughterhouse: 28, ziggurat: 16, portal: 30 };

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
    units: ["ghoul", "skeleton", "abomination", "banshee", "lich", "hound", "necromancer", "plague"],
    buildings: ["necropolis", "crypt", "slaughterhouse", "ziggurat", "portal"],
    // budova -> [typ jednotky, základní interval v sekundách], střídá se dokola
    produce: {
      crypt: [["ghoul", 12], ["skeleton", 15], ["hound", 11]],
      slaughterhouse: [["abomination", 36], ["plague", 24]],
      portal: [["banshee", 20], ["ghoul", 15], ["necromancer", 28]]
    },
    defense: {
      necropolis: { damage: 28, range: 190, delay: 1.1 },
      ziggurat: { damage: 17, range: 165, delay: 1.0 }
    },
    lichRespawn: 120,       // s: lich (hrdina nemrtvých) znovu povstane z Nekropole
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

  // Zimní sezóna (1. 12. - 6. 1.): vzhled kreslí js/winter.js, herně se mění jen dárky.
  // Dárek leží volně na mapě, sebere ho dělník, který k němu dojde, a jeho tým dostane zlato.
  const WINTER = {
    gold: 40,      // zlato za jeden dárek
    first: 3,      // dárků na mapě hned od startu
    every: 50,     // s: po jak dlouhé době přibude další
    max: 5,        // nejvýš tolik dárků najednou
    reach: 16,     // jak blízko musí dělník dojít (logické px)
    fromBase: 200  // dárek nespadne blíž než tolik ke kterékoli hlavní budově
  };
  const isWinter = (d = new Date()) => (d.getMonth() === 11) || (d.getMonth() === 0 && d.getDate() <= 6);

  return {
    UNDEAD, HERO, COSTS, TRAINED_AT, UNIT_NEEDS, SPEAR, CROSSBOW, SCOUT, NECRO, PLAGUE, VETERAN, REQUIRES, UPGRADES, ARMOR_PER_LEVEL, WEAPON_PER_LEVEL, MELEE, ARCHERY, TOOLS_PER_LEVEL, MASONRY,
    TOWER, KNIGHT, CATAPULT, MONK, UNITS, BUILDING_HP, FOOTPRINT, footRect, footFree, BUILD_TIME, REPAIR, TEAMS, HQ, TEAM_NAMES, MAX_PLAYERS, BASE_GOLD, BASE_WOOD, GOLD_AMOUNT,
    SUPPLY_BASE, SUPPLY_PER_HUT, SUPPLY_MAX, supplyCap, MAX_BUILDINGS, COUNTDOWN, WINTER, isWinter
  };
});
