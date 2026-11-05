/*
 * Záložka Výzvy v menu hry: denní a týdenní výzvy s postupem a odpočtem do nového losování,
 * sbírka kosmetických odměn a výběr vlajky, barvy týmu, titulu a rámečku avatara.
 * Výzvy losuje a vyhodnocuje server (server/challenges.js); tady se jen zobrazují.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const COS = PK.cosmetics;
  const $ = id => document.getElementById(id);
  const REFRESH_MS = 60 * 1000;

  const host = { show() {}, announce() {} };
  const state = { data: null, skew: 0, busy: false };
  let flagTimer = 0;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const t = (key, vars) => (PK.t ? PK.t(key, vars) : key);
  const lang = () => (PK.i18n && PK.i18n.lang ? (typeof PK.i18n.lang === "function" ? PK.i18n.lang() : PK.i18n.lang) : "cs");
  const now = () => Date.now() + state.skew;
  const two = n => String(n).padStart(2, "0");
  const fmt = n => Number(n).toLocaleString("cs-CZ");

  // text výzvy: vlastní překlad od admina, jinak slovník (vestavěné šablony), jinak česky
  function textOf(c) {
    const l = lang();
    if (l !== "cs" && c[l]) return c[l];
    return t(c.text);
  }

  function countdown(ms) {
    const sec = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(sec / 86400);
    const clock = `${two(Math.floor((sec % 86400) / 3600))}:${two(Math.floor((sec % 3600) / 60))}:${two(sec % 60)}`;
    return d ? `${d} d ${clock}` : clock;
  }

  async function request(method, url, body) {
    const res = await fetch(url, {
      method, credentials: "same-origin",
      headers: method === "GET" ? {} : { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body || {})
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* prázdná odpověď */ }
    if (!res.ok) throw Object.assign(new Error((json && json.error) || "Server není dostupný."), { status: res.status });
    return json;
  }

  const look = () => (state.data && state.data.look) || {};
  const owned = () => new Set(((state.data && state.data.owned) || []).map(o => o.id));
  const myColor = () => {
    const c = COS.get(look().color);
    return c ? c.palette : "blue";
  };

  /* ---------- obrázky odměn ---------- */
  function flagIcon(item, team, zoom = 6) {
    const frames = PK.buildings.flag(team, item ? item.design : "");
    const W = frames[0].width;
    const H = frames[0].height;
    const { c, g } = PK.makeCanvas(W, H);
    c.className = "pix ch-flag";
    c.style.width = `${(W / 2) * zoom}px`;
    c.style.height = `${(H / 2) * zoom}px`;
    c.frames = frames;
    c.step = i => {
      g.clearRect(0, 0, W, H);
      g.drawImage(frames[i % frames.length], 0, 0);
    };
    c.step(0);
    return c;
  }

  function animateFlags() {
    if (flagTimer) return;
    let i = 0;
    flagTimer = setInterval(() => {
      const list = document.querySelectorAll("#panel-challenges canvas.ch-flag");
      if (!list.length || $("panel-challenges").hidden) {
        clearInterval(flagTimer);
        flagTimer = 0;
        return;
      }
      i++;
      for (const c of list) if (c.step) c.step(i);
    }, 110);
  }

  function icon(item) {
    const box = el("span", `ch-icon kind-${item.kind}`);
    if (item.kind === "flag") box.append(flagIcon(item, myColor()));
    else if (item.kind === "color") box.append(window.GFame ? GFame.sprite("soldier", item.palette) : el("span", "ch-swatch"));
    else if (item.kind === "frame") box.append(window.GFame ? GFame.framed(GFame.portrait("knight", myColor()), item.style) : el("span"));
    else box.append(el("span", "ch-title-scroll", t(item.name)));
    if (item.kind === "color") box.style.setProperty("--swatch", item.ui);
    return box;
  }

  /* ---------- výzvy ---------- */
  function challengeRow(c, period) {
    const row = el("div", `ch-row${c.done ? " done" : ""}`);
    const reward = COS.get(c.reward);
    const pct = Math.min(100, Math.round((c.progress / c.target) * 100));

    const main = el("div", "ch-main");
    main.append(el("span", "ch-text", textOf(c)));
    if (c.scope === "match" && !/jednom zápase/.test(c.text)) main.append(el("span", "ch-hint", t("v jednom zápase")));

    const bar = el("div", "ch-bar");
    const fill = el("span", "ch-fill");
    fill.style.width = `${pct}%`;
    bar.append(fill, el("span", "ch-count", c.done ? t("Splněno") : `${fmt(c.progress)} / ${fmt(c.target)}`));
    main.append(bar);

    const prize = el("div", "ch-prize");
    if (reward) {
      prize.append(icon(reward), el("span", "ch-prize-name", t(reward.name)));
      prize.title = t(COS.KIND_NAMES[reward.kind]);
    }
    prize.append(el("span", `ch-rarity ${period === "weekly" ? "rare" : "common"}`, period === "weekly" ? t("vzácná") : t("běžná")));

    row.append(main, prize);
    return row;
  }

  function renderLists() {
    const d = state.data;
    for (const period of ["daily", "weekly"]) {
      const list = $(`ch-${period}`);
      const items = d[period].list.map(c => challengeRow(c, period));
      list.replaceChildren(...(items.length ? items : [el("p", "status small", t("Teď nejsou žádné výzvy."))]));
    }
    renderCountdowns();
  }

  function renderCountdowns() {
    const d = state.data;
    if (!d) return;
    $("ch-daily-reset").textContent = t("nové za {0}", { 0: countdown(d.daily.resetsAt - now()) });
    $("ch-weekly-reset").textContent = t("nové za {0}", { 0: countdown(d.weekly.resetsAt - now()) });
  }

  /* ---------- sbírka ---------- */
  function renderPreview() {
    const box = $("ch-preview");
    const user = PK.account && PK.account.user;
    const l = look();
    const color = COS.get(l.color);
    const title = COS.get(l.title);
    const frame = COS.get(l.frame);
    const flag = COS.get(l.flag);

    let pic = GFame.portrait("hero", myColor());
    if (frame) pic = GFame.framed(pic, frame.style);
    const who = el("div", "ch-who");
    who.append(el("b", "ch-who-name", user ? user.name : t("Ty")));
    if (title) who.append(el("span", "fame-title-tag", t(title.name)));
    who.append(el("span", "status small", [
      `${t("Barva týmu")}: ${color ? t(color.name) : t("barva podle místa na mapě")}`,
      `${t("Vlajka na věžích")}: ${flag ? t(flag.name) : t("klasická")}`
    ].join(" · ")));

    box.replaceChildren(pic, who, flagIcon(flag, myColor(), 7));
  }

  function renderCollection() {
    const mine = owned();
    const l = look();
    const user = PK.account && PK.account.user;
    $("ch-count").textContent = t("Máš {0} z {1} odměn", { 0: mine.size, 1: COS.ITEMS.length });

    const groups = COS.KINDS.map(kind => {
      const group = el("div", "ch-group");
      group.append(el("h4", "", t(COS.KIND_NAMES[kind])));
      const grid = el("div", "ch-grid");

      for (const item of COS.ofKind(kind)) {
        const has = mine.has(item.id);
        const using = l[kind] === item.id;
        const card = el("div", `ch-card ${item.rarity}${has ? "" : " locked"}${using ? " using" : ""}`);
        card.append(icon(item));
        if (kind !== "title") card.append(el("span", "ch-card-name", t(item.name)));

        const btn = el("button", "btn small", using ? t("Sundat") : has ? t("Použít") : t("Zatím nemáš"));
        btn.type = "button";
        btn.disabled = !user || !has || state.busy;
        btn.addEventListener("click", () => equip(kind, using ? null : item.id));
        card.append(btn);
        grid.append(card);
      }

      group.append(grid);
      return group;
    });

    $("ch-collection").replaceChildren(...groups);
  }

  function render() {
    if (!state.data || !window.GFame) return;
    const user = PK.account && PK.account.user;
    renderLists();
    renderPreview();
    renderCollection();
    $("ch-login").hidden = !!user;
    animateFlags();
    syncButton();
  }

  // počet splněných výzev u tlačítka v hlavním menu
  function syncButton() {
    const btn = $("m-challenges");
    if (!btn || !state.data) return;
    const all = [...state.data.daily.list, ...state.data.weekly.list];
    const done = all.filter(c => c.done).length;
    btn.dataset.count = PK.account && PK.account.user ? `${done}/${all.length}` : "";
  }

  async function load() {
    try {
      const data = await request("GET", "/api/challenges");
      state.data = data;
      state.skew = data.now - Date.now();
      syncButton();
      if (!$("panel-challenges").hidden) render();
    } catch (e) {
      if (!$("panel-challenges").hidden) $("ch-status").textContent = e.message;
    }
  }

  async function equip(kind, id) {
    if (state.busy) return;
    state.busy = true;
    $("ch-status").textContent = "";
    $("ch-status").classList.remove("error");
    try {
      const res = await request("POST", "/api/me/look", { kind, id });
      state.data.look = res.look;
    } catch (e) {
      if (e.status === 401 && PK.account) PK.account.expired();
      $("ch-status").textContent = e.message;
      $("ch-status").classList.add("error");
    } finally {
      state.busy = false;
      render();
    }
  }

  function open() {
    $("ch-status").textContent = "";
    host.show("challenges");
    render();
    load();
  }

  // Server ohlásil splněné výzvy (konec zápasu online nebo hlášení hry proti AI).
  function completed(done) {
    if (!Array.isArray(done) || !done.length) return;
    for (const c of done) {
      const reward = COS.get(c.reward);
      host.announce(reward ? t("Výzva splněna: {0} · odměna: {1}", { 0: textOf(c), 1: t(reward.name) }) : t("Výzva splněna: {0}", { 0: textOf(c) }));
    }
    load();
  }

  function init(options) {
    Object.assign(host, options);
    $("m-challenges").addEventListener("click", open);
    $("ch-login-btn").addEventListener("click", () => PK.account.openLogin(open, t("Výzvy a odměny se ukládají k účtu. Přihlas se.")));
    load();
    setInterval(() => { if (!$("panel-challenges").hidden) renderCountdowns(); }, 1000);
    setInterval(() => {
      if (document.hidden) return;
      // po půlnoci / v pondělí načíst nové losování hned
      const d = state.data;
      if (d && !$("panel-challenges").hidden && Math.min(d.daily.resetsAt, d.weekly.resetsAt) <= now()) load();
    }, 1000);
    setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    window.addEventListener("pk-lang", () => { if (!$("panel-challenges").hidden) render(); });
  }

  PK.challenges = {
    init, open, completed, reload: load,
    get look() { return look(); }
  };
})();
