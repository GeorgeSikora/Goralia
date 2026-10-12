/*
 * Klávesové zkratky celé hry na jednom místě: výchozí hodnoty, uložení v prohlížeči a kontrola duplicit.
 * Zkratka je hodnota event.key malými písmeny (např. "q", " ", "shift"), takže odpovídá tomu,
 * co je na klávese napsané v aktuálním rozložení (QWERTZ i QWERTY).
 * Ikonky v HUD, nápověda i push-to-talk čtou zkratky odsud, takže změna se projeví všude.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const STORE = "pk-keys";

  // group: nadpis skupiny v nastavení; any: smí to být i Shift/Ctrl/Alt/mezerník (jen push-to-talk)
  const ACTIONS = [
    { id: "worker", def: "q", label: "Dělník", group: "Jednotky" },
    { id: "soldier", def: "w", label: "Voják", group: "Jednotky" },
    { id: "archer", def: "e", label: "Lučištník", group: "Jednotky" },
    { id: "hero", def: "h", label: "Hrdina", group: "Jednotky" },
    { id: "command", def: "m", label: "Rozkaz", group: "Jednotky" },
    { id: "tower", def: "t", label: "Strážní věž", group: "Stavby" },
    { id: "barracks", def: "f", label: "Kasárna", group: "Stavby" },
    { id: "hut", def: "g", label: "Buda (+5 limit)", group: "Stavby" },
    { id: "smithy", def: "k", label: "Kovárna", group: "Stavby" },
    { id: "armor", def: "z", label: "Zbroj (v kovárně)", group: "Vylepšení a kouzla" },
    { id: "weapon", def: "x", label: "Zbraně (v kovárně)", group: "Vylepšení a kouzla" },
    { id: "fire", def: "a", label: "Ohnivá koule", group: "Vylepšení a kouzla" },
    { id: "heal", def: "s", label: "Léčení", group: "Vylepšení a kouzla" },
    { id: "pause", def: "p", label: "Menu / pauza", group: "Ostatní" },
    { id: "leave", def: "r", label: "Hlavní menu po konci hry", group: "Ostatní" },
    { id: "ptt", def: "v", label: "Držet = mluvit (hlasový chat)", group: "Ostatní", any: true }
  ];
  const byId = new Map(ACTIONS.map(a => [a.id, a]));

  // Klávesy s pevným významem: Esc, Enter (chat), Tab, šipky (kamera), číslice (skupiny).
  const FIXED = {
    escape: "Esc (menu)",
    enter: "Enter (chat)",
    tab: "Tab (další typ)",
    arrowleft: "šipky (kamera)",
    arrowright: "šipky (kamera)",
    arrowup: "šipky (kamera)",
    arrowdown: "šipky (kamera)"
  };
  const MODIFIERS = ["shift", "control", "alt", "capslock", " "];
  // malé pixelové písmo na ikonkách umí jen tyhle znaky
  const PRINTABLE = /^[a-z./+\-]$/;

  const norm = key => {
    if (!key) return "";
    if (key === "Spacebar") return " ";
    return key.toLowerCase();
  };

  const binds = {};

  function defaults() {
    for (const a of ACTIONS) binds[a.id] = a.def;
  }

  // Načte uložené zkratky; neplatné nebo duplicitní se vrátí na výchozí (nebo zůstanou prázdné).
  function load() {
    defaults();
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { /* ignore */ }

    // klávesa pro mluvení z dřívějšího nastavení hlasového chatu (event.code)
    if (!saved.ptt) {
      try {
        const old = (JSON.parse(localStorage.getItem("pk-vchat")) || {}).key;
        const codes = { Space: " ", ShiftLeft: "shift", ShiftRight: "shift", ControlLeft: "control", ControlRight: "control", AltLeft: "alt", AltRight: "alt", CapsLock: "capslock" };
        const m = /^Key([A-Z])$/.exec(old || "");
        if (m) saved.ptt = m[1].toLowerCase();
        else if (codes[old]) saved.ptt = codes[old];
      } catch (e) { /* ignore */ }
    }

    const used = new Set();
    for (const a of ACTIONS) {
      const want = typeof saved[a.id] === "string" ? norm(saved[a.id]) : a.def;
      if (!problem(a, want) && !used.has(want)) binds[a.id] = want;
      else binds[a.id] = !used.has(a.def) ? a.def : "";
      if (binds[a.id]) used.add(binds[a.id]);
    }
    // výchozí hodnota mohla kolidovat s uloženou zkratkou jiné akce, která ještě nebyla zpracovaná
    for (const a of ACTIONS) {
      if (binds[a.id] && ACTIONS.some(b => b !== a && binds[b.id] === binds[a.id])) binds[a.id] = "";
    }
  }

  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(binds)); } catch (e) { /* ignore */ }
  }

  // Vrátí důvod, proč klávesu nejde akci přiřadit (bez ohledu na ostatní akce), jinak "".
  function problem(action, key) {
    if (!key) return "";
    if (FIXED[key]) return `${FIXED[key]} má pevný význam.`;
    if (action.any && MODIFIERS.includes(key)) return "";
    if (!PRINTABLE.test(key)) return action.any ? "Tuhle klávesu nejde použít." : "Použij písmeno A–Z nebo znak . / + -";
    return "";
  }

  const owner = key => ACTIONS.find(a => key && binds[a.id] === key) || null;

  function label(id) {
    const key = binds[id];
    if (!key) return "–";
    const names = { " ": "Mezerník", shift: "Shift", control: "Ctrl", alt: "Alt", capslock: "Caps Lock" };
    return names[key] || key.toUpperCase();
  }

  const listeners = [];
  const changed = () => { for (const fn of listeners) fn(); };

  /*
   * Přiřadí klávesu akci. Duplicita se nepřepíše potichu: vrátí { ok: false, error, conflict }
   * a hráč musí nejdřív uvolnit klávesu u druhé akce (nebo použít swap: true).
   */
  function set(id, rawKey, opts = {}) {
    const action = byId.get(id);
    const key = norm(rawKey);
    if (!action) return { ok: false, error: "Neznámá akce." };

    const why = /^(?:Digit|Numpad)\d$/.test(opts.code || "") ? "Číslice patří skupinám jednotek (1–9)." : problem(action, key);
    if (why) return { ok: false, error: why };

    const other = owner(key);
    if (other && other !== action) {
      if (!opts.swap) return { ok: false, error: `Klávesa ${key === " " ? "Mezerník" : key.toUpperCase()} už patří akci „${other.label}“.`, conflict: other.id };
      const prev = binds[id];
      binds[other.id] = prev && !problem(other, prev) ? prev : "";
    }

    binds[id] = key;
    save();
    changed();
    return { ok: true };
  }

  function reset() {
    defaults();
    save();
    changed();
  }

  // Patří stisk klávesy dané akci? Shift u písmene nevadí (event.key je pak velké).
  const is = (event, id) => !!binds[id] && norm(event.key) === binds[id];

  /* ---------- stránka nastavení: seznam akcí, klik na klávesu a stisk nové ---------- */
  function mount(list, msg, resetBtn) {
    let capturing = null; // id akce, která čeká na klávesu
    let pending = null; // { id, key, code } pro prohození při duplicitě
    const buttons = new Map();

    const say = (text, swap) => {
      msg.textContent = text;
      if (swap) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn";
        b.textContent = "Prohodit";
        b.addEventListener("click", () => {
          const p = pending;
          pending = null;
          if (p) set(p.id, p.key, { code: p.code, swap: true });
          say("Zkratky prohozeny.");
        });
        msg.append(" ", b);
      }
    };

    const show = () => {
      for (const [id, b] of buttons) {
        b.textContent = capturing === id ? "Stiskni klávesu…" : label(id);
        b.classList.toggle("waiting", capturing === id);
        b.classList.toggle("unbound", !binds[id]);
      }
    };

    const stop = () => {
      capturing = null;
      PK.keys.capturing = false;
      show();
    };

    let group = "";
    for (const a of ACTIONS) {
      if (a.group !== group) {
        group = a.group;
        const h = document.createElement("h3");
        h.className = "touch-title";
        h.textContent = group;
        list.append(h);
      }
      const row = document.createElement("div");
      row.className = "row";
      const name = document.createElement("span");
      name.textContent = a.label;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn keybind";
      b.setAttribute("aria-label", `Změnit klávesu: ${a.label}`);
      b.addEventListener("click", () => {
        if (capturing === a.id) return stop();
        capturing = a.id;
        PK.keys.capturing = true;
        pending = null;
        say("Stiskni novou klávesu, Esc zruší.");
        show();
      });
      b.addEventListener("blur", () => { if (capturing === a.id) stop(); });
      row.append(name, b);
      list.append(row);
      buttons.set(a.id, b);
    }

    window.addEventListener("keydown", event => {
      if (!capturing) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;

      const id = capturing;
      stop();
      if (event.key === "Escape") return say("");

      const res = set(id, event.key, { code: event.code });
      for (const b of buttons.values()) b.classList.remove("conflict");
      if (res.ok) return say(`${byId.get(id).label}: ${label(id)}`);

      pending = res.conflict ? { id, key: event.key, code: event.code } : null;
      if (res.conflict) buttons.get(res.conflict).classList.add("conflict");
      say(res.error, !!res.conflict);
    }, true);

    resetBtn.addEventListener("click", () => {
      stop();
      reset();
      say("Obnoveny výchozí zkratky.");
    });

    listeners.push(show);
    show();
    return { reset: () => { stop(); pending = null; say(""); for (const b of buttons.values()) b.classList.remove("conflict"); } };
  }

  // Prvky s data-key="akce" (nápověda) ukazují aktuální klávesu.
  function fillLabels(root = document) {
    for (const el of root.querySelectorAll("[data-key]")) el.textContent = label(el.dataset.key);
  }
  listeners.push(() => fillLabels());

  load();

  PK.keys = {
    ACTIONS,
    FIXED,
    get: id => binds[id] || "",
    label,
    is,
    set,
    reset,
    problem: (id, key) => problem(byId.get(id), norm(key)),
    onChange(fn) { listeners.push(fn); },
    mount,
    fillLabels,
    capturing: false, // nastavení právě čeká na stisk klávesy, hra má klávesy ignorovat
    _load: load
  };
})();
