/*
 * Detail odehraného zápasu: výsledky, statistiky hráčů vedle sebe a grafy průběhu v čase.
 * Používá panel serveru i profil ve hře (vyžaduje js/charts.js).
 */
(() => {
  "use strict";

  // Barvy týmů ze hry (PK.TEAM[...].ui v pixel.js), aby graf odpovídal barvám na mapě.
  const TEAM_COLORS = {
    blue: "#58a6e0", red: "#e2603c", gold: "#e8c040", violet: "#a078e8", green: "#5cc864", silver: "#c4ccdc",
    orange: "#f58a2c", teal: "#30d0c0", pink: "#ff82c0", brown: "#b07a48", lime: "#b8e830", black: "#6a6478",
    maroon: "#b02c48", sand: "#e8d49c", magenta: "#d040e0", olive: "#9aa030"
  };
  const TEAM_ORDER = Object.keys(TEAM_COLORS);
  const RESULTS = { win: "Výhra", loss: "Prohra", draw: "Remíza" };
  const REASONS = {
    hq: "zničená hlavní budova", surrender: "vzdal se", disconnect: "odpojení", abandoned: "všichni odešli", defeat: "porážka lidí"
  };
  const UNITS = { worker: "dělníci", soldier: "vojáci", archer: "lučištníci", hero: "hrdina" };
  const BUILDINGS = { barracks: "kasárna", tower: "věže", hut: "budy", smithy: "kovárny" };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const clock = sec => `${Math.floor(sec / 60)}:${String(Math.round(sec) % 60).padStart(2, "0")}`;
  const num = v => (v == null ? "–" : Number(v).toLocaleString("cs-CZ"));
  const when = ms => (ms ? new Date(ms).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–");
  const colorOf = p => TEAM_COLORS[p.team || TEAM_ORDER[p.slot]] || "#9b94b8";

  function minuteTicks(min, max, width) {
    const span = Math.max(1, max - min);
    const want = Math.max(2, Math.min(6, Math.floor(width / 70)));
    const steps = [15, 30, 60, 120, 300, 600, 900, 1800, 3600];
    const step = steps.find(s => span / s <= want) || 3600;
    const out = [];
    for (let t = Math.ceil(min / step) * step; t <= max; t += step) out.push(t);
    // krátký zápas: aspoň začátek a konec, ať má osa x popisky
    if (out.length < 2) return [min, max];
    if (max - out[out.length - 1] > step * 0.6) out.push(max);
    return out;
  }

  /*
   * match: záznam z /api/matches/:id
   * opts: { mapName(id) → text, onPlayer(userId), selfId (zvýrazní hráče) }
   */
  function render(match, opts = {}) {
    const root = el("div", "mv");
    const players = match.players.slice().sort((a, b) => (a.result === "win" ? -1 : 0) - (b.result === "win" ? -1 : 0) || a.slot - b.slot);
    const winner = match.players.find(p => p.result === "win");

    const head = el("p", "mv-head");
    const item = (label, value) => {
      const span = el("span", "", `${label} `);
      span.append(el("b", "", value));
      head.append(span);
    };
    item("Mapa", opts.mapName ? opts.mapName(match.map) : match.map);
    item("Délka", clock(match.duration));
    item("Konec", when(match.ended));
    item("Vítěz", winner ? winner.name : "nikdo");
    item("Způsob", REASONS[match.reason] || match.reason || "–");
    item("Typ", match.humans >= 2 ? `${match.humans} lidé${match.ais ? ` + ${match.ais} AI` : ""}` : "proti AI");
    root.append(head);

    /* ---------- tabulka: řádky = ukazatele, sloupce = hráči ---------- */
    root.append(el("h3", "mv-section", "Výsledná statistika"));
    const table = el("table", "mv-table");
    const thead = el("thead");
    const hr = el("tr");
    hr.append(el("th", "", ""));

    for (const p of players) {
      const th = el("th");
      const sw = el("i", "mv-swatch");
      sw.style.background = colorOf(p);
      th.append(sw);

      const name = el("span", p.userId && opts.onPlayer ? "mv-name mv-link" : "mv-name", `${p.name}${p.ai ? " (AI)" : ""}`);
      if (p.userId && opts.onPlayer) {
        name.tabIndex = 0;
        name.setAttribute("role", "link");
        name.addEventListener("click", () => opts.onPlayer(p.userId));
        name.addEventListener("keydown", e => { if (e.key === "Enter") opts.onPlayer(p.userId); });
      }
      th.append(name);
      hr.append(th);
    }

    thead.append(hr);
    table.append(thead);

    const body = el("tbody");
    const row = (label, fn, small) => {
      const tr = el("tr");
      tr.append(el("td", small ? "mv-small" : "", label));
      for (const p of players) {
        const td = el("td", small ? "mv-small" : "");
        const v = fn(p);
        if (v instanceof Node) td.append(v);
        else td.textContent = v == null || v === "" ? "–" : String(v);
        tr.append(td);
      }
      body.append(tr);
    };

    row("Výsledek", p => el("span", `mv-result ${p.result}`, RESULTS[p.result] || p.result));
    row("Vypadl", p => (p.outAt != null ? `${clock(p.outAt)} (${REASONS[p.outWhy] || p.outWhy || "?"})` : p.result === "win" ? "vydržel" : "do konce"));
    row("Zabité jednotky", p => num(p.kills));
    row("Ztracené jednotky", p => num(p.unitsLost));
    row("Zničené budovy", p => num(p.buildingsDestroyed));
    row("Ztracené budovy", p => num(p.buildingsLost));
    row("Natěženo zlata", p => num(p.gold));
    row("Natěženo dřeva", p => num(p.wood));
    if (players.some(p => p.spentGold != null)) {
      row("Utraceno zlata", p => num(p.spentGold));
      row("Utraceno dřeva", p => num(p.spentWood));
    }
    row("Vycvičeno jednotek", p => num(p.trained));
    if (players.some(p => p.trainedBy)) {
      for (const [key, label] of Object.entries(UNITS)) row(`· ${label}`, p => num((p.trainedBy || {})[key] || 0), true);
    }
    row("Postaveno budov", p => num(p.built));
    if (players.some(p => p.builtBy)) {
      for (const [key, label] of Object.entries(BUILDINGS)) row(`· ${label}`, p => num((p.builtBy || {})[key] || 0), true);
    }
    if (players.some(p => p.upgrades)) {
      row("Kovárna (zbroj / zbraně)", p => `${(p.upgrades || {}).armor || 0} / ${(p.upgrades || {}).weapon || 0}`);
    }
    row("Úroveň hrdiny", p => p.heroLevel || "–");
    if (players.some(p => p.cmds != null)) {
      row("Rozkazy (za minutu)", p => {
        if (p.ai) return "–";
        const minutes = Math.max(1 / 60, (p.outAt != null ? p.outAt : match.duration) / 60);
        return `${num(p.cmds)} (${Math.round((p.cmds || 0) / minutes)})`;
      });
    }

    table.append(body);
    const wrap = el("div", "mv-wrap");
    wrap.append(table);
    root.append(wrap);

    /* ---------- průběh v čase ---------- */
    const tl = match.timeline;
    root.append(el("h3", "mv-section", "Průběh zápasu"));

    if (!tl || !tl.t || tl.t.length < 2 || !window.GChart) {
      root.append(el("p", "mv-note", "Průběh v čase je uložený jen u novějších zápasů (posledních 300)."));
      return root;
    }

    const charts = el("div", "mv-charts");
    const metric = (title, pick) => {
      const box = el("div", "mv-chart");
      box.append(el("h4", "", title));
      box.append(window.GChart.line({
        x: tl.t,
        label: title,
        height: 180,
        series: players.filter(p => tl.series[p.slot]).map(p => ({ name: p.name, color: colorOf(p), values: pick(tl.series[p.slot]) })),
        xTicks: minuteTicks,
        hideLegend: true, // čáry jsou popsané přímo; barvy hráčů jsou i v hlavičce tabulky
        xFmt: clock,
        tipTitle: t => `čas ${clock(t)}`
      }));
      charts.append(box);
    };

    metric("Armáda (vojáci, lučištníci, hrdina)", s => s.army);
    metric("Dělníci", s => s.workers);
    metric("Natěženo surovin (zlato + dřevo)", s => s.gold.map((g, i) => g + (s.wood[i] || 0)));
    metric("Zabité jednotky", s => s.kills);
    metric("Budovy", s => s.buildings);
    metric("Nevyužité suroviny (zásoba)", s => s.bank);

    root.append(charts);
    root.append(el("p", "mv-note", `Vzorek každých ${tl.every} s herního času. Najetím na graf (nebo klepnutím) uvidíš hodnoty všech hráčů.`));
    return root;
  }

  window.GMatch = { render, TEAM_COLORS, clock };
})();
