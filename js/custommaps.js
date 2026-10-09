/*
 * Vlastní mapy z editoru: načtení ze serveru (/api/maps) a registrace mezi ostatní mapy.
 * Bez serveru (otevřeno ze souboru) se nic nenačte a hra zůstane jen s vestavěnými mapami.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const seen = new Map(); // id -> JSON dokumentu, pro poznání změny

  function forget(id) {
    if (PK.nav) PK.nav.forget(id);
    if (PK.world) PK.world.forget(id);
  }

  // Vrací id map, které přibyly, změnily se nebo zmizely.
  async function load() {
    let data;

    try {
      const res = await fetch("/api/maps", { cache: "no-store" });
      if (!res.ok) return [];
      data = await res.json();
    } catch (e) {
      return [];
    }

    const changed = [];
    const ids = new Set();

    for (const raw of Array.isArray(data.maps) ? data.maps : []) {
      const { doc } = PK.maps.normalizeDoc(raw);
      if (!doc || PK.maps.isBuiltIn(doc.id)) continue;

      ids.add(doc.id);
      const key = JSON.stringify(doc);
      if (seen.get(doc.id) === key) continue;

      seen.set(doc.id, key);
      PK.maps.register(PK.maps.compileDoc(doc));
      forget(doc.id);
      changed.push(doc.id);
    }

    for (const id of [...seen.keys()]) {
      if (ids.has(id)) continue;
      PK.maps.unregister(id);
      seen.delete(id);
      forget(id);
      changed.push(id);
    }

    return changed;
  }

  PK.customMaps = { load };
})();
