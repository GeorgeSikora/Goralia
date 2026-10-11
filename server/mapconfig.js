/*
 * Nastavení map nezávislé na souboru mapy: které mapy jsou k dispozici v multiplayeru.
 * Výchozí stav je „povoleno“, uložené jsou jen vypnuté mapy (data/db.json › mapSettings).
 * Týká se vestavěných i vlastních map; aspoň jedna mapa musí zůstat povolená.
 */
"use strict";

function createMapConfig(store, MAPS) {
  const data = store.data;
  if (!data.mapSettings || typeof data.mapSettings !== "object" || Array.isArray(data.mapSettings)) data.mapSettings = {};
  const settings = data.mapSettings;

  const multiplayer = id => !(settings[id] && settings[id].multiplayer === false);
  const enabled = () => MAPS.list.filter(m => multiplayer(m.id));
  const off = () => MAPS.list.filter(m => !multiplayer(m.id)).map(m => m.id);

  function setMultiplayer(id, on) {
    if (!MAPS.get(id)) return { error: "Mapa neexistuje.", status: 404 };
    if (!on && multiplayer(id) && enabled().length <= 1) {
      return { error: "Aspoň jedna mapa musí zůstat povolená pro multiplayer.", status: 400 };
    }

    if (on) delete settings[id];
    else settings[id] = { multiplayer: false, at: Date.now() };

    store.save();
    return { ok: true };
  }

  // Smazaná mapa si nesmí odnést nastavení do případné nové mapy se stejným id.
  function forget(id) {
    if (!settings[id]) return;
    delete settings[id];
    store.save();
  }

  return { multiplayer, enabled, off, setMultiplayer, forget };
}

module.exports = { createMapConfig };
