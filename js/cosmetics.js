/*
 * Kosmetické odměny za výzvy: vlajky na věže, barvy týmu navíc, tituly a rámečky avatara.
 * Sdílí je server (výzvy, účty) i prohlížeč (sbírka v menu, kreslení ve hře a v síni slávy).
 * Nic z toho nemění pravidla hry, jen vzhled.
 *
 * Rarita: common = odměny za denní výzvy, rare = za týdenní.
 * Vlajka: design = vzor na látce (kreslí buildings.js flagFrames).
 * Barva: palette = klíč palety v PK.TEAM (pixel.js), ui = barva do menu.
 * Titul: text titulu (česky, překládá se slovníkem).
 * Rámeček: style = vzhled rámečku portrétu (css/challenges.css + kreslení ve fame.js).
 */
(function (root, factory) {
  const lib = factory();
  if (typeof module === "object" && module.exports) module.exports = lib;
  else (root.PK = root.PK || {}).cosmetics = lib;
})(typeof window !== "undefined" ? window : globalThis, () => {
  "use strict";

  const KINDS = ["flag", "color", "title", "frame"];
  const KIND_NAMES = { flag: "Vlajka na věžích", color: "Barva týmu", title: "Titul", frame: "Rámeček avatara" };

  const ITEMS = [
    // vlajky
    { id: "flag-pruh", kind: "flag", rarity: "common", name: "Pruhovaná vlajka", design: "stripes" },
    { id: "flag-kriz", kind: "flag", rarity: "common", name: "Křížová vlajka", design: "cross" },
    { id: "flag-krokev", kind: "flag", rarity: "common", name: "Krokvová vlajka", design: "chevron" },
    { id: "flag-sachovnice", kind: "flag", rarity: "common", name: "Šachovnicová vlajka", design: "checks" },
    { id: "flag-hvezda", kind: "flag", rarity: "rare", name: "Hvězdná vlajka", design: "star" },
    { id: "flag-lebka", kind: "flag", rarity: "rare", name: "Lebková vlajka", design: "skull" },
    { id: "flag-koruna", kind: "flag", rarity: "rare", name: "Královská vlajka", design: "crown" },
    // barvy týmu navíc
    { id: "color-smaragd", kind: "color", rarity: "common", name: "Smaragdová", palette: "emerald", ui: "#2fd08a" },
    { id: "color-jantar", kind: "color", rarity: "common", name: "Jantarová", palette: "amber", ui: "#f0a020" },
    { id: "color-mraz", kind: "color", rarity: "common", name: "Mrazivá", palette: "frost", ui: "#9ee4ff" },
    { id: "color-pulnoc", kind: "color", rarity: "rare", name: "Půlnoční", palette: "midnight", ui: "#5a64e8" },
    { id: "color-karmin", kind: "color", rarity: "rare", name: "Karmínová", palette: "crimson", ui: "#e8203c" },
    { id: "color-kost", kind: "color", rarity: "rare", name: "Kostěná", palette: "bone", ui: "#e8dcc0" },
    // tituly
    { id: "title-gorol", kind: "title", rarity: "common", name: "Gorol" },
    { id: "title-vojevudce", kind: "title", rarity: "common", name: "Vojevůdce" },
    { id: "title-zlatokop", kind: "title", rarity: "common", name: "Zlatokop" },
    { id: "title-drevorubec", kind: "title", rarity: "common", name: "Dřevorubec" },
    { id: "title-blesk", kind: "title", rarity: "common", name: "Bleskový" },
    { id: "title-katapulty", kind: "title", rarity: "rare", name: "Pán katapultů" },
    { id: "title-lovec", kind: "title", rarity: "rare", name: "Lovec nemrtvých" },
    { id: "title-nezlomny", kind: "title", rarity: "rare", name: "Nezlomný" },
    { id: "title-postrach", kind: "title", rarity: "rare", name: "Postrach Morvana" },
    // za dokončení tutoriálu pro nové hráče (server/tutorial.js), výzvy ho nelosují
    { id: "title-novacek", kind: "title", rarity: "tutorial", name: "Nováček" },
    // rámečky avatara
    { id: "frame-drevo", kind: "frame", rarity: "common", name: "Dřevěný rámeček", style: "wood" },
    { id: "frame-zelezo", kind: "frame", rarity: "common", name: "Železný rámeček", style: "iron" },
    { id: "frame-listi", kind: "frame", rarity: "common", name: "Listový rámeček", style: "leaf" },
    { id: "frame-zlato", kind: "frame", rarity: "rare", name: "Zlatý rámeček", style: "gold" },
    { id: "frame-runy", kind: "frame", rarity: "rare", name: "Runový rámeček", style: "rune" },
    { id: "frame-plamen", kind: "frame", rarity: "rare", name: "Plamenný rámeček", style: "flame" }
  ];

  const BY_ID = Object.fromEntries(ITEMS.map(i => [i.id, i]));
  const get = id => BY_ID[id] || null;
  const ofKind = kind => ITEMS.filter(i => i.kind === kind);
  const ofRarity = rarity => ITEMS.filter(i => i.rarity === rarity);

  // Vzhled hráče, jak ho posílá server: { flag, color, title, frame } = id odměn (nebo chybí).
  // Vrátí jen platné položky správného druhu.
  function clean(look) {
    const out = {};
    if (!look || typeof look !== "object") return out;
    for (const kind of KINDS) {
      const item = get(look[kind]);
      if (item && item.kind === kind) out[kind] = item.id;
    }
    return out;
  }

  return { KINDS, KIND_NAMES, ITEMS, get, ofKind, ofRarity, clean };
});
