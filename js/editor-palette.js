/*
 * Paleta editoru map: katalog všeho, co jde na mapu umístit (terén, druhy půdy, krajiny, stromy,
 * kulisy, zvířata, budovy, jednotky), a jejich ikony. Ikony se kreslí ze skutečných spritů hry
 * v jemné mřížce (PK.HD = 2, jemná dvojčata z PK.fine), ruční ikony terénu po jemných bodech.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const { C, mix, hash, bayer } = PK;
  const MAPS = PK.maps;
  const HD = PK.HD;

  /* ---------- kategorie ---------- */
  const CATS = [
    { id: "terrain", label: "Terén", icon: "≈" },
    { id: "ground", label: "Půda", icon: "▦" },
    { id: "trees", label: "Stromy", icon: "♣" },
    { id: "props", label: "Kulisy", icon: "⌂" },
    { id: "critters", label: "Zvířata", icon: "🐾" },
    { id: "game", label: "Hra", icon: "⚑" }
  ];

  /* ---------- druhy půdy (biomes.js K) a jejich barvy pro schéma a ikony ---------- */
  const GROUND = [
    ["Louka", [0x32693f, 0x4a8548, 0x6ba459]],
    ["Kvítí", [0x4a8548, 0x6ba459, 0xf0d0e8]],
    ["Jetel", [0x22553e, 0x2f7a40, 0x5ea054]],
    ["Step", [0x6a7236, 0x958e42, 0xbca855]],
    ["Podzimní tráva", [0x5e5c32, 0x7f7638, 0xa08c42]],
    ["Vřesoviště", [0x4f553a, 0x6a3a74, 0xb46ea4]],
    ["Písčina", [0xa8875c, 0xc8a670, 0xf0dca6]],
    ["Štěrk", [0x555672, 0x767892, 0x9d9fb5]],
    ["Skalní plotny", [0x3b3a55, 0x767892, 0xc6c7d3]],
    ["Bláto", [0x3a2b2c, 0x523c34, 0x6a4e3c]],
    ["Bažina", [0x223430, 0x324838, 0x5c7046]],
    ["Horská louka", [0x4a8548, 0x6aa0a0, 0xe2eaf4]],
    ["Vyprahlá zem", [0x8a6446, 0xa88458, 0xd2b484]]
  ];

  const THEMES = {
    meadow: ["Louka", [0x32693f, 0x4a8548, 0x6ba459]],
    autumn: ["Podzim", [0x5e5226, 0x7a6a30, 0xa0602e]],
    winter: ["Zima", [0x88a2b0, 0xb2c8d0, 0xf4f8f6]],
    swamp: ["Bažina", [0x26352c, 0x334530, 0x5e6e40]],
    highland: ["Vysočina", [0x3d613f, 0x7a5272, 0xa3b272]],
    wastes: ["Pustina", [0x3b4536, 0x50583e, 0x8c8a62]]
  };

  /* ---------- kulisy: jméno -> [popisek, skupina] ---------- */
  const PROPS = {
    bushA: ["Keř", "Zeleň"], bushB: ["Velký keř", "Zeleň"], bushFlower: ["Kvetoucí keř", "Zeleň"], bushDry: ["Suchý keř", "Zeleň"],
    hedge: ["Živý plot", "Zeleň"], saplingBirch: ["Mladá bříza", "Zeleň"], saplingPine: ["Mladý smrk", "Zeleň"], saplingOak: ["Mladý dub", "Zeleň"],
    flowersYellow: ["Žluté květy", "Zeleň"], flowersBlue: ["Modré květy", "Zeleň"], flowersRed: ["Vlčí máky", "Zeleň"], flowersWhite: ["Kopretiny", "Zeleň"],
    lavender: ["Levandule", "Zeleň"], tallGrass: ["Vysoká tráva", "Zeleň"], fern: ["Kapradí", "Zeleň"],
    reedsA: ["Rákos", "Voda a břeh"], reedsB: ["Orobinec", "Voda a břeh"], lilyPads: ["Lekníny", "Voda a břeh"],
    shroomBrown: ["Hřiby", "Houby"], shroomRed: ["Muchomůrky", "Houby"], shroomGlow: ["Svítící houby", "Houby"], fairyRing: ["Čarodějný kruh", "Houby"],
    stoneA: ["Kámen", "Kameny"], stoneB: ["Kamínek", "Kameny"], boulderMoss: ["Balvan s mechem", "Kameny"], rockPile: ["Hromada kamení", "Kameny"],
    pebbles: ["Oblázky", "Kameny"], rockSlab: ["Plochý kámen", "Kameny"], cairn: ["Mohylka", "Kameny"], monolith: ["Menhir", "Kameny"],
    ringstone: ["Kamenný kruh", "Kameny"], crystalCyan: ["Modrý krystal", "Kameny"], crystalViolet: ["Fialový krystal", "Kameny"],
    stump: ["Pařez", "Dřevo"], stumpAxe: ["Pařez se sekerou", "Dřevo"], logFallen: ["Padlý kmen", "Dřevo"], woodpile: ["Hranice dřeva", "Dřevo"], deadTree: ["Mrtvý strom", "Dřevo"],
    ruinWall: ["Zbořená zeď", "Zříceniny"], ruinArch: ["Zbytek oblouku", "Zříceniny"], ruinStub: ["Pahýl zdi", "Zříceniny"], statueBroken: ["Rozbitá socha", "Zříceniny"],
    column: ["Sloup", "Zříceniny"], columnFallen: ["Padlý sloup", "Zříceniny"],
    well: ["Studna", "Vesnice"], fenceA: ["Plot", "Vesnice"], fenceB: ["Plot s brankou", "Vesnice"], cartHay: ["Vůz se senem", "Vesnice"], cartBroken: ["Rozbitý vůz", "Vesnice"],
    haystack: ["Kupka sena", "Vesnice"], barrels: ["Sudy", "Vesnice"], sacks: ["Pytle", "Vesnice"], crates: ["Bedny", "Vesnice"], beehives: ["Úly", "Vesnice"],
    windmill: ["Větrný mlýn", "Vesnice"], wayshrine: ["Boží muka", "Vesnice"], signpost: ["Rozcestník", "Vesnice"], lanternPost: ["Lucerna", "Vesnice"],
    campfire: ["Táborák", "Tábor"], tent: ["Stan", "Tábor"], brazier: ["Žhavá pánev", "Tábor"], dummy: ["Cvičná figurína", "Tábor"], archeryTarget: ["Terč", "Tábor"],
    graveCross: ["Hrob s křížem", "Hřbitov a kosti"], graveStone: ["Náhrobek", "Hřbitov a kosti"], bones: ["Kosti", "Hřbitov a kosti"], antlers: ["Paroží", "Hřbitov a kosti"],
    swordGrave: ["Meč v zemi", "Hřbitov a kosti"], ribs: ["Žebra obra", "Hřbitov a kosti"], skullStake: ["Lebka na kůlu", "Hřbitov a kosti"]
  };
  // co se v kulisách nenabízí: vrcholy hor a podhůří kreslí nástroj Hory, věže hradeb nástroj Hradby
  const HIDDEN = /^(peak|foothill|wallTower)/;

  const CRITTERS = {
    rabbit: "Zajíc", sparrow: "Vrabci", deer: "Srnka", duck: "Kachna", frog: "Žába",
    butterfly: "Motýl", crow: "Vrána", bee: "Včely", fish: "Ryby"
  };

  const UNITS = {
    worker: "Dělník", soldier: "Voják", archer: "Lučištník", spearman: "Kopiník", crossbow: "Kušiník", monk: "Mnich",
    knight: "Rytíř", scout: "Zvěd", catapult: "Katapult", hero: "Hrdina",
    ghoul: "Ghúl", skeleton: "Kostlivec", hound: "Pekelný pes", banshee: "Banshee", necromancer: "Nekromant",
    plague: "Morový", abomination: "Ohavnost", lich: "Lich"
  };
  const BUILDINGS = {
    barracks: "Kasárna", tower: "Strážní věž", hut: "Chatrč", smithy: "Kovárna", stable: "Stáj", workshop: "Dílna",
    crypt: "Krypta", slaughterhouse: "Jatka", ziggurat: "Zikkurat", portal: "Brána pekel"
  };

  const TREES = ["Dub", "Smrk", "Vrba", "Podzimní dub", "Modrý smrk", "Kvetoucí dub", "Bříza", "Rozkvetlá třešeň"];

  /* ---------- ikony ---------- */
  const BOX = 40; // CSS px okénka ikony

  // Vykreslí sprite (fn kreslí do kontextu v art px) a ořízne průhledné okraje; vrací jemné plátno.
  function render(w, h, fn) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w * HD));
    c.height = Math.max(1, Math.ceil(h * HD));
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.hdDraw = true;
    g.setTransform(HD, 0, 0, HD, 0, 0);
    fn(g);
    return crop(c);
  }

  function crop(c) {
    const g = c.getContext("2d");
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (d[(y * c.width + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return c;
    const o = document.createElement("canvas");
    o.width = x1 - x0 + 1;
    o.height = y1 - y0 + 1;
    o.getContext("2d").drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
    return o;
  }

  // Ruční ikona po jemných bodech: px(x, y) -> barva nebo null; rozměr v jemných px.
  function dots(w, h, px) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = px(x, y);
        if (v == null) continue;
        const i = (y * w + x) * 4;
        img.data[i] = (v >> 16) & 255;
        img.data[i + 1] = (v >> 8) & 255;
        img.data[i + 2] = v & 255;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  const ink = C.ink;

  // dlaždice z odstínů: rozdithrovaný šum, skvrnky třetího odstínu
  function swatch(cols, seed, round = true) {
    const N = 28;
    return dots(N, N, (x, y) => {
      const dx = x - N / 2 + 0.5, dy = y - N / 2 + 0.5;
      const r = round ? Math.hypot(dx, dy) : Math.max(Math.abs(dx), Math.abs(dy));
      if (r > N / 2) return null;
      if (r > N / 2 - 1.2) return ink;
      const n = PK.fbm(x / 5, y / 5, seed, 2) + (bayer(x, y) - 0.5) * 0.25 - (dx + dy) * 0.012;
      const k = n > 0.62 ? 2 : n > 0.42 ? 1 : 0;
      if (hash(x, y, seed + 3) > 0.94) return cols[2];
      return cols[k];
    });
  }

  function waterIcon(lake) {
    const W = 32, H = 22;
    const V = C.v;
    return dots(W, H, (x, y) => {
      const dx = (x - W / 2 + 0.5) / (W / 2), dy = (y - H / 2 + 0.5) / (H / 2);
      let inside;
      if (lake) inside = dx * dx + dy * dy < 1;
      else inside = Math.abs(dy - Math.sin(dx * 3.2) * 0.45) < 0.32;
      if (!inside) return null;
      const edge = lake ? dx * dx + dy * dy > 0.72 : Math.abs(dy - Math.sin(dx * 3.2) * 0.45) > 0.22;
      if (edge) return lake ? C.d[4] : C.d[3];
      const wave = (x + Math.round(y * 1.5)) % 7 === 0 && y % 3 === 1;
      return wave ? V[4] : y < H / 2 ? V[2] : V[1];
    });
  }

  function roadIcon(main) {
    const W = 32, H = 22;
    return dots(W, H, (x, y) => {
      const dy = Math.abs(y - H / 2 - Math.sin(x / 5) * 2.5);
      const hw = main ? 6 : 4;
      if (dy > hw) return null;
      if (main && x > 12 && x < 20) {
        // most přes řeku: prkna a zábradlí
        if (dy > hw - 1) return C.w[0];
        return x % 3 === 0 ? C.w[1] : C.w[3];
      }
      if (dy > hw - 1) return C.d[1];
      return hash(x, y, 7) > 0.8 ? C.d[5] : dy < 1.5 ? C.d[4] : C.d[3];
    });
  }

  function ashIcon() {
    return swatch([0x2b2433, 0x3e3446, 0xff8f4a], 41);
  }

  /* ---------- katalog ---------- */
  const items = [];
  const byId = new Map();
  function add(it) {
    it.search = PK.tr ? `${it.label} ${PK.tr(it.label)} ${it.group || ""} ${it.value ?? ""}`.toLowerCase() : it.label.toLowerCase();
    items.push(it);
    byId.set(it.id, it);
    return it;
  }

  // režimy kreslení: point (bod), brush (štětec/rozptyl), line (čára), rect (obdélník), fill (výplň), ellipse (ovál)
  const POINT_MODES = ["point", "brush", "line", "rect", "fill"];
  const CIRCLE_MODES = ["brush", "point", "rect", "fill"];
  const STROKE_MODES = ["brush", "line", "rect"];

  function build() {
    if (items.length) return items;
    const dd = PK.props.doodads;

    add({ id: "water", cat: "terrain", label: "Řeka", kind: "water", modes: STROKE_MODES, size: ["Šířka řeky", 2, 20, 6], icon: () => waterIcon(false), key: "w",
      hint: "Kresli tok řeky. Když skončí u jezera nebo jiné řeky, napojí se na ni plynule." });
    add({ id: "lake", cat: "terrain", label: "Jezero", kind: "lake", modes: ["ellipse"], icon: () => waterIcon(true), key: "l",
      hint: "Táhni ovál jezera. Uprostřed je hluboká voda, u břehu mělčina." });
    add({ id: "mountain", cat: "terrain", label: "Hory", kind: "mountain", modes: STROKE_MODES, size: ["Šířka hřebene", 4, 40, 12], key: "m",
      icon: () => render(40, 40, g => g.drawImage(dd.peakM1.c, 20 - dd.peakM1.ax, 38 - dd.peakM1.ay)),
      hint: "Kresli hřebeny hor. Jednotky přes ně neprojdou; na jižní straně je skalní stěna." });
    add({ id: "wall", cat: "terrain", label: "Hradby", kind: "wall", modes: STROKE_MODES, size: ["Tloušťka hradby", 2, 5, 3], key: "h",
      icon: () => render(30, 34, g => { g.drawImage(dd.wallTower.c, 4, 4); g.drawImage(dd.wallTower.c, 14, 4); }),
      hint: "Kresli hradby. Projít se dá jen tam, kde přes ně vede cesta (brána). Obdélník nakreslí celé opevnění." });
    add({ id: "road", cat: "terrain", label: "Cesta", kind: "road", modes: STROKE_MODES, size: ["Šířka cesty", 2, 12, 4], icon: () => roadIcon(false), key: "r",
      hint: "Cesta vede i přes vodu: vedlejší cesta jako brod s kameny, hlavní cesta jako most." });
    add({ id: "roadMain", cat: "terrain", label: "Hlavní cesta s mostem", kind: "road", main: true, modes: STROKE_MODES, size: ["Šířka cesty", 4, 12, 7], icon: () => roadIcon(true),
      hint: "Široká cesta; přes řeku vede most, přes hradby brána." });
    add({ id: "ash", cat: "terrain", label: "Spálená zem", kind: "ash", modes: CIRCLE_MODES, size: ["Poloměr", 10, 300, 60], icon: ashIcon,
      hint: "Popel s žhnoucími puklinami jako kolem pekelné pevnosti." });
    for (const [theme, [label, cols]] of Object.entries(THEMES)) {
      add({ id: `theme:${theme}`, cat: "ground", group: "Krajina oblasti", label: `Krajina: ${label}`, kind: "theme", value: theme, modes: CIRCLE_MODES, size: ["Poloměr", 20, 600, 120],
        icon: () => swatch(cols, 60 + theme.length, false),
        hint: "Kruhová oblast jiné krajiny: přebarví trávu, trsy a stromy (hlavní krajinu nastavíš ve Vlastnostech mapy)." });
    }
    GROUND.forEach(([label, cols], k) => {
      add({ id: `ground:${k}`, cat: "ground", group: "Druh půdy", label, kind: "ground", value: k, modes: CIRCLE_MODES, size: ["Poloměr", 12, 300, 50],
        icon: () => swatch(cols, 20 + k), hint: "Maluje druh půdy (podklad, skvrny a trsy). Okraj přechází plynule do okolí." });
    });

    add({ id: "tree:mix", cat: "trees", label: "Les podle krajiny", kind: "tree", value: -1, modes: POINT_MODES, defaultMode: "brush", size: ["Poloměr štětce", 4, 200, 20], key: "t",
      icon: () => render(44, 50, g => {
        const t = PK.props.trees;
        for (const [k, x, y] of [[1, 6, 34], [0, 22, 40], [6, 34, 36]]) { g.drawImage(t[k].trunk, x - t[k].ax * 0.5, y - t[k].ay * 0.5, t[k].trunk.width * 0.5, t[k].trunk.height * 0.5); g.drawImage(t[k].crown[0], x - t[k].ax * 0.5, y - t[k].ay * 0.5, t[k].crown[0].width * 0.5, t[k].crown[0].height * 0.5); }
      }),
      hint: "Druh stromu vybere krajina mapy a okolí (podzim, vysočina, bažina…)." });
    TREES.forEach((label, k) => {
      add({ id: `tree:${k}`, cat: "trees", label, kind: "tree", value: k, modes: POINT_MODES, defaultMode: "brush", size: ["Poloměr štětce", 4, 200, 20], family: "tree",
        icon: () => { const t = PK.props.trees[k]; return render(t.trunk.width, t.trunk.height, g => { g.drawImage(t.trunk, 0, 0); g.drawImage(t.crown[0], 0, 0); }); },
        hint: "Strom se dá pokácet (dřevo). Pata kmene nesmí stát ve vodě." });
    });

    const names = Object.keys(dd).filter(n => !HIDDEN.test(n));
    // napřed známé kulisy v pořadí tabulky, pak cokoli dalšího, co hra umí
    const ordered = [...Object.keys(PROPS).filter(n => dd[n]), ...names.filter(n => !PROPS[n])];
    for (const name of ordered) {
      const [label, group] = PROPS[name] || [name.replace(/([A-Z])/g, " $1").toLowerCase(), "Ostatní"];
      add({ id: `prop:${name}`, cat: "props", group, label, kind: "prop", value: name, modes: POINT_MODES, size: ["Poloměr štětce", 4, 200, 16], family: group,
        icon: () => { const s = dd[name]; return render(s.c.width, s.c.height, g => g.drawImage(s.c, 0, 0)); },
        hint: name.startsWith("reeds") || name === "lilyPads" ? "Patří na břeh nebo na hladinu." : "Kulisa je jen ozdoba: nepřekáží v chůzi a nedá se vybrat." });
    }

    for (const [type, label] of Object.entries(CRITTERS)) {
      add({ id: `critter:${type}`, cat: "critters", label, kind: "critter", value: type, modes: POINT_MODES, defaultMode: "point", size: ["Poloměr štětce", 6, 200, 30],
        icon: () => { const s = PK.critters.icon(type); return s ? render(s.w, s.h, g => g.drawImage(s.r, 0, 0)) : swatch([0x555, 0x777, 0x999], 3); },
        hint: MAPS.WATER_CRITTERS.includes(type) ? "Žije na vodě: umísti na hladinu." : "Zvíře se pase a utíká před jednotkami. Na hru nemá vliv." });
    }

    add({ id: "base", cat: "game", group: "Start", label: "Základna (hráč)", kind: "base", modes: ["point"], key: "b",
      icon: () => { const s = PK.buildings.get("hall", "blue"); return render(s.c.width, s.c.height, g => g.drawImage(s.c, 0, 0)); },
      hint: "Klikni pro novou základnu (2–16 hráčů), táhni ve výběru pro přesun. Čárkovaně je území, kde hráč smí stavět." });
    add({ id: "gold", cat: "game", group: "Start", label: "Zlatý důl", kind: "gold", modes: ["point", "line"], key: "g",
      icon: () => { const s = PK.props.mine; return render(s.c.width, s.c.height, g => g.drawImage(s.c, 0, 0)); },
      hint: "Každá základna potřebuje aspoň dva doly poblíž. Doly se nesmí dotýkat." });
    for (const [type, label] of Object.entries(BUILDINGS)) {
      const undead = MAPS.PLACE_BUILDINGS.undead.includes(type);
      add({ id: `building:${type}`, cat: "game", group: undead ? "Budovy nemrtvých" : "Budovy lidí", label, kind: "building", value: type, modes: ["point"], undead,
        icon: () => { const s = PK.buildings.get(type, undead ? "red" : "blue"); return render(s.c.width, s.c.height, g => g.drawImage(s.c, 0, 0)); },
        hint: undead ? "Jen pro základnu nemrtvých na kooperativní mapě." : "Hotová budova na startu zápasu. Patří vybrané základně." });
    }
    for (const [type, label] of Object.entries(UNITS)) {
      const undead = MAPS.PLACE_UNITS.undead.includes(type);
      add({ id: `unit:${type}`, cat: "game", group: undead ? "Jednotky nemrtvých" : "Jednotky lidí", label, kind: "unit", value: type, modes: POINT_MODES, defaultMode: "point",
        size: ["Poloměr štětce", 6, 120, 20], undead,
        icon: () => { const f = PK.units.frame(type, undead ? "red" : "blue", "idle", 0); return render(PK.units.CELL, PK.units.CELL, g => g.drawImage(f.c, 0, 0)); },
        hint: undead ? "Jen pro základnu nemrtvých na kooperativní mapě." : "Jednotka na startu zápasu. Patří vybrané základně." });
    }
    return items;
  }

  // Ikona položky jako <canvas> v okénku BOX: malé sprity zvětší celým násobkem, velké zmenší.
  const iconCache = new Map();
  function iconFor(it) {
    let c = iconCache.get(it.id);
    if (!c) {
      try { c = it.icon(); } catch (e) { c = swatch([0x333, 0x555, 0x777], 1); }
      iconCache.set(it.id, c);
    }
    const out = document.createElement("canvas");
    out.width = c.width;
    out.height = c.height;
    out.getContext("2d").drawImage(c, 0, 0);
    const fit = Math.min((BOX - 4) * (window.devicePixelRatio || 1) / c.width, (BOX - 4) * (window.devicePixelRatio || 1) / c.height);
    const k = fit >= 1 ? Math.floor(fit) : fit;
    const dpr = window.devicePixelRatio || 1;
    out.style.width = `${(c.width * k) / dpr}px`;
    out.style.height = `${(c.height * k) / dpr}px`;
    out.className = "ico";
    return out;
  }

  PK.editorPalette = { CATS, GROUND, THEMES, PROPS, CRITTERS, UNITS, BUILDINGS, TREES, build, get: id => byId.get(id), items, iconFor };
})();
