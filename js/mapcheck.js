/*
 * Kontrola hratelnosti mapy: seznam problémů česky (prázdný seznam = mapa je v pořádku).
 * Používá ji editor, server při ukládání map a testy. Sdílí server i prohlížeč.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./rules.js"), require("./maps.js"), require("./nav.js"));
  } else {
    (root.PK = root.PK || {}).mapcheck = factory(root.PK.rules, root.PK.maps, root.PK.nav);
  }
})(typeof window !== "undefined" ? window : globalThis, (R, MAPS, NAV) => {
  "use strict";

  function check(map) {
    const problems = [];
    const add = text => { if (!problems.includes(text)) problems.push(text); };
    const LW = map.size[0] * 2;
    const LH = map.size[1] * 2;
    const inside = (x, y, margin = 30) => x >= margin && x <= LW - margin && y >= margin && y <= LH - margin;
    const team = i => R.TEAM_NAMES[R.TEAMS[i]];

    if (map.slots.length < 2 || map.slots.length > R.MAX_PLAYERS) add(`Počet základen musí být 2 až ${R.MAX_PLAYERS}.`);
    if (!map.name || !map.description || !map.tag) add("Mapa potřebuje název a popis.");

    map.slots.forEach((slot, i) => {
      const z = slot.zone;

      if (!(z.x0 < z.x1 && z.y0 < z.y1 && z.x0 >= 0 && z.x1 <= LW && z.y1 <= LH)) {
        add(`Základna ${team(i)} nemá dost místa (je moc u okraje nebo u jiné základny).`);
        return;
      }

      for (const b of [slot.hq, ...slot.buildings]) {
        if (!inside(b.x, b.y)) add(`Budovy základny ${team(i)} přesahují okraj mapy (posuň ji od kraje).`);
        else if (b.x < z.x0 || b.x > z.x1 || b.y < z.y0 || b.y > z.y1) add(`Budovy základny ${team(i)} se nevejdou do jejího území (posuň ji od sousední základny nebo od kraje).`);
      }

      for (const u of slot.units) if (!inside(u.x, u.y, 12)) add(`Jednotky základny ${team(i)} začínají mimo mapu.`);
    });

    for (const [x, y] of [...map.gold, ...map.trees]) if (!inside(x, y, 12)) add("Některé doly nebo stromy leží mimo mapu.");

    map.gold.forEach(([x, y], i) => {
      map.gold.forEach(([x2, y2], j) => {
        if (j > i && Math.hypot(x - x2, y - y2) <= 60) add("Některé doly jsou moc blízko u sebe.");
      });

      for (const s of map.slots) {
        if (Math.hypot(x - s.hq.x, y - s.hq.y) <= 100) add("Důl leží uvnitř základny.");
      }
    });

    map.slots.forEach((s, i) => {
      const own = map.gold.filter(([x, y]) => Math.hypot(x - s.hq.x, y - s.hq.y) < 450).length;
      if (own < 2) add(`Základna ${team(i)} potřebuje aspoň dva doly poblíž.`);
    });

    const nav = NAV.forMap(map);

    try {
      // Souvislé oblasti průchozích buněk (stejné propojení jako u hledání cesty), takže stačí jeden průchod mapou.
      const comp = new Int32Array(nav.w * nav.h);
      const stack = [];
      let count = 0;

      for (let s = 0; s < comp.length; s++) {
        if (comp[s] || nav.blocked[s]) continue;
        comp[s] = ++count;
        stack.push(s);

        while (stack.length) {
          const c = stack.pop();
          const cx = c % nav.w;
          if (cx > 0 && !comp[c - 1] && !nav.blocked[c - 1]) { comp[c - 1] = count; stack.push(c - 1); }
          if (cx < nav.w - 1 && !comp[c + 1] && !nav.blocked[c + 1]) { comp[c + 1] = count; stack.push(c + 1); }
          if (c >= nav.w && !comp[c - nav.w] && !nav.blocked[c - nav.w]) { comp[c - nav.w] = count; stack.push(c - nav.w); }
          if (c + nav.w < comp.length && !comp[c + nav.w] && !nav.blocked[c + nav.w]) { comp[c + nav.w] = count; stack.push(c + nav.w); }
        }
      }

      const areaOf = p => {
        const i = nav.nearestFree(nav.index(p.x, p.y));
        return i < 0 ? 0 : comp[i];
      };
      const reaches = (a, b) => {
        const ca = areaOf(a);
        return ca !== 0 && ca === areaOf(b);
      };

      map.slots.forEach((s, i) => {
        if (nav.isBlockedArea(s.hq.x, s.hq.y, 20)) add(`Základna ${team(i)} stojí ve vodě.`);
        if (s.buildings.some(b => nav.isBlocked(b.x, b.y))) add(`Kasárna základny ${team(i)} stojí ve vodě.`);
        if (s.units.some(u => nav.isBlocked(u.x, u.y))) add(`Jednotky základny ${team(i)} začínají ve vodě.`);

        map.slots.forEach((o, j) => {
          if (j > i && !reaches(s.hq, o.hq)) add(`Základny ${team(i)} a ${team(j)} nejsou propojené (přes vodu vede jen cesta).`);
        });
      });

      for (const [x, y] of map.gold) {
        if (nav.isBlockedArea(x, y, 20)) add("Některý důl stojí ve vodě.");
        else if (!reaches(map.slots[0].hq, { x, y })) add("Některý důl je nedosažitelný.");
      }

      if (map.trees.some(([x, y]) => nav.isBlocked(x, y))) add("Některé stromy rostou ve vodě.");
    } finally {
      if (map.custom) NAV.forget(map.id);
    }

    return problems;
  }

  return { check };
});
