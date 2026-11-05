/*
 * Tutoriál pro úplně nového hráče: jedna řízená hra proti slabé AI na malé mapě.
 * Každý krok čeká, až ho hráč splní; šipka ukazuje na mapu, rámeček na tlačítko v HUD.
 * AI soupeře nic nedělá, dokud hráč nedojde ke kroku útoku, a pak se jen brání.
 *
 * Hra (js/game.js) volá setup() po založení zápasu, update() a draw() každý snímek,
 * hit() při klepnutí na plátno a finish() na konci zápasu. Stav zjišťuje přímo ze simulace.
 * Texty jsou česky a přeloží se přes PK.t (js/i18n.js, slovníky js/lang/*.js).
 */
(() => {
  "use strict";

  const PK = window.PK;
  const R = PK.rules;
  const STORE = "pk-tutorial";
  const PLAYED = "pk-played";
  const TITLE = "novacek";

  // Překlady textů tutoriálu jsou v js/lang/en.js a js/lang/szl.js (klíč = český text).
  const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s);
  const t = (s, vars) => (PK.t ? PK.t(s, vars) : fill(s, vars));

  /* ---------- trvalý stav (prohlížeč) ---------- */
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; }
  }

  function save(patch) {
    const next = { ...load(), ...patch };
    try { localStorage.setItem(STORE, JSON.stringify(next)); } catch (e) { /* soukromé okno */ }
    return next;
  }

  function played() {
    try { return localStorage.getItem(PLAYED) === "1"; } catch (e) { return false; }
  }

  function markPlayed() {
    try { localStorage.setItem(PLAYED, "1"); } catch (e) { /* soukromé okno */ }
  }

  // Nabídka "Naučit se hrát" v hlavním menu: nový prohlížeč i účet bez odehraného zápasu.
  function offer(user) {
    const st = load();
    if (st.done || st.skipped) return false;
    if (played()) return false;
    if (user && (user.games > 0 || (user.titles || []).includes(TITLE))) return false;
    return true;
  }

  // Hlášení serveru (statistika v adminu, titul Nováček u přihlášeného účtu).
  function report(e, extra) {
    if (location.protocol !== "http:" && location.protocol !== "https:") return Promise.resolve(null);
    try {
      return fetch("/api/tutorial", {
        method: "POST",
        keepalive: true,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ e, ...extra })
      }).then(r => (r.ok ? r.json() : null)).catch(() => null);
    } catch (err) {
      return Promise.resolve(null);
    }
  }

  // Tutoriál dohraný bez přihlášení: titul se připíše, jakmile se hráč přihlásí.
  function claim(user) {
    if (!user || !load().done || (user.titles || []).includes(TITLE)) return;
    report("claim").then(res => {
      if (res && res.titles && user.titles !== res.titles) user.titles = res.titles;
    });
  }

  /* ---------- mapa ---------- */
  // Malá mapa pro dva: les a důl u hráče, nepřátelská gmina se strážní věží vpravo.
  const MAP_DOC = (() => {
    const trees = [];
    const rnd = (() => { let a = 7; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
    const grove = (x0, y0, x1, y1, n) => {
      for (let i = 0; i < n; i++) trees.push([Math.round(x0 + rnd() * (x1 - x0)), Math.round(y0 + rnd() * (y1 - y0))]);
    };
    grove(70, 110, 190, 250, 16);   // les hráče vlevo nahoře
    grove(60, 380, 160, 500, 8);    // vlevo dole
    grove(300, 50, 720, 100, 12);   // okraj nahoře
    grove(300, 500, 720, 545, 12);  // okraj dole
    grove(930, 110, 1010, 230, 8);  // les soupeře
    grove(930, 360, 1015, 490, 7);

    return {
      format: "goralia-map", version: 1, id: "tutorial", name: "Tutoriál",
      description: "Malá mapa pro první hru.", size: [520, 280], seed: 412, autoRoads: true,
      bases: [{ x: 260, y: 280 }, { x: 820, y: 280 }],
      gold: [[370, 160, 4000], [740, 450, 2000]],
      trees, water: [], roads: [], mountains: [], walls: []
    };
  })();

  let compiled = null;
  function map() {
    if (!compiled) {
      compiled = PK.maps.compileDoc(PK.maps.normalizeDoc(MAP_DOC).doc);
      compiled.tutorial = true;
      compiled.tag = "1v1";
      // strážní věž před nepřátelskou gminou, směrem k hráči
      compiled.slots[1].buildings.push({ type: "tower", x: 700, y: 292 });
      compiled.slots[1].units = compiled.slots[1].units.slice(0, 2);
    }
    return compiled;
  }

  /* ---------- kroky ---------- */
  const alive = e => !!e && e.hp > 0;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const nearest = (list, from) => list.reduce((best, e) => (!best || dist(e, from) < dist(best, from) ? e : best), null);

  let run = null; // { match, me, foe, step, base, flash, brain, done, ended }

  const own = (type, done) => run.match.buildings.filter(b => b.team === run.me && b.type === type && alive(b) && (!done || b.progress >= 1));
  const ownUnits = type => run.match.units.filter(u => u.team === run.me && alive(u) && (!type || u.type === type));
  const hq = () => run.match.hqOf(run.me);
  const foeTower = () => run.match.buildings.find(b => b.team === run.foe && b.type === "tower" && alive(b));
  const foeHall = () => run.match.hqOf(run.foe);
  const sel = (ctx, type) => ctx.selected.filter(e => alive(e) && e.team === run.me && e.type === type);
  const pickWorker = ctx => nearest(ownUnits("worker").filter(w => !w.order), hq() || ctx.cam) || nearest(ownUnits("worker"), hq() || ctx.cam);

  // ukazatel: { at: entita nebo bod v logických souřadnicích } nebo { hud: typ tlačítka }
  const point = e => (e ? { at: e } : null);

  // Stavba budovy: rozestavěná → šipka na ni, vybraný dělník → tlačítko v HUD, jinak šipka na dělníka.
  function buildPointer(ctx, type) {
    const site = own(type)[0];
    if (site) return point(site);
    if (ctx.placement === type) return null;
    if (sel(ctx, "worker").length && ctx.cardHas(type)) return { hud: type };
    return point(pickWorker(ctx));
  }

  function buildStatus(type) {
    const site = own(type)[0];
    return site && site.progress < 1 ? t("Stavba: {p} %", { p: Math.floor(site.progress * 100) }) : "";
  }

  const gathered = kind => run.match.stats[run.me][kind] || 0;

  const STEPS = [
    {
      id: "select",
      text: ["Vítej v Goralii! Klikni levým tlačítkem na dělníka u své gminy.", "Vítej v Goralii! Klepni na dělníka u své gminy."],
      done: ctx => sel(ctx, "worker").length > 0,
      pointer: ctx => point(pickWorker(ctx))
    },
    {
      id: "wood",
      text: ["Dělník těží dřevo. Klikni pravým tlačítkem na strom.", "Dělník těží dřevo. Když je vybraný, klepni na strom."],
      enter: () => { run.base = gathered("wood"); },
      done: () => gathered("wood") > run.base,
      status: () => (ownUnits("worker").some(w => w.carry === "wood" || (w.order && w.order.type === "gather" && w.order.target && w.order.target.type === "wood")) ? t("Dělník nese náklad do gminy.") : ""),
      pointer: ctx => {
        if (ownUnits("worker").some(w => w.order && w.order.type === "gather" && w.order.target && w.order.target.type === "wood")) return null;
        if (!sel(ctx, "worker").length) return point(pickWorker(ctx));
        return point(nearest(run.match.resources.filter(r => r.type === "wood" && r.amount > 0), hq()));
      }
    },
    {
      id: "gold",
      text: ["Teď zlato. Vyber dělníka a klikni pravým tlačítkem na zlatý důl.", "Teď zlato. Vyber dělníka a klepni na zlatý důl."],
      enter: () => { run.base = gathered("gold"); },
      done: () => gathered("gold") > run.base,
      status: () => (ownUnits("worker").some(w => w.carry === "gold" || (w.order && w.order.type === "gather" && w.order.target && w.order.target.type === "gold")) ? t("Dělník nese náklad do gminy.") : ""),
      pointer: ctx => {
        if (ownUnits("worker").some(w => w.order && w.order.type === "gather" && w.order.target && w.order.target.type === "gold")) return null;
        if (!sel(ctx, "worker").length) return point(pickWorker(ctx));
        return point(nearest(run.match.resources.filter(r => r.type === "gold" && r.amount > 0), hq()));
      }
    },
    {
      id: "hut",
      text: ["Buda zvedne limit jednotek o 5. Vyber dělníka, klikni na Budu vpravo dole a pak na volné místo.", "Buda zvedne limit jednotek o 5. Vyber dělníka, klepni na Budu vpravo dole a pak dvakrát na volné místo."],
      need: R.COSTS.hut,
      done: () => own("hut", true).length > 0,
      status: () => buildStatus("hut"),
      pointer: ctx => buildPointer(ctx, "hut")
    },
    {
      id: "barracks",
      text: ["Kasárna cvičí vojáky. Postav je stejně jako budu."],
      need: R.COSTS.barracks,
      done: () => own("barracks", true).length > 0,
      status: () => buildStatus("barracks"),
      pointer: ctx => buildPointer(ctx, "barracks")
    },
    {
      id: "train",
      text: ["Vyber kasárna a vycvič tři vojáky."],
      need: { gold: R.COSTS.soldier.gold * 3, wood: R.COSTS.soldier.wood * 3 },
      done: () => ownUnits("soldier").length >= 3,
      status: () => t("Vojáci: {n}/3", { n: Math.min(3, ownUnits("soldier").length) }),
      pointer: ctx => {
        if (sel(ctx, "barracks").length && ctx.cardHas("soldier")) return { hud: "soldier" };
        return point(own("barracks", true)[0]);
      }
    },
    {
      id: "research",
      text: ["Vyber gminu a vylepši Nástroje. Dělníci pak těží rychleji."],
      need: R.UPGRADES.tools.levels[0],
      done: () => {
        const h = hq();
        return !!(h && h.research) || run.match.upgrades[run.me].tools > 0 || run.match.upgrades[run.me].masonry > 0;
      },
      pointer: ctx => {
        if (sel(ctx, R.HQ[run.me]).length && ctx.cardHas("tools")) return { hud: "tools" };
        return point(hq());
      }
    },
    {
      id: "attack",
      text: ["Nepřítel se probudil! Označ vojáky rámečkem a pravým tlačítkem je pošli na jeho strážní věž.", "Nepřítel se probudil! Dvakrát klepni na vojáka, tím vybereš všechny, a pak klepni na jeho strážní věž."],
      enter: () => wake(),
      done: () => !foeTower(),
      status: () => (hq() && hq().research ? t("Výzkum běží. Mezitím můžeš cvičit další vojáky.") : ""),
      pointer: ctx => {
        const army = ownUnits().filter(u => u.type !== "worker");
        const busy = army.some(u => u.order && (u.order.type === "attack" || u.order.type === "amove"));
        if (busy || sel(ctx, "soldier").length) return point(foeTower());
        return point(nearest(army, foeTower() || ctx.cam));
      }
    },
    {
      id: "victory",
      text: ["Věž padla! Teď zboř nepřátelskou gminu a vyhraj."],
      done: () => run.match.phase === "ended",
      status: () => {
        const h = foeHall();
        return h ? t("Nepřátelská gmina: {p} %", { p: Math.ceil((h.hp / h.maxHp) * 100) }) : "";
      },
      pointer: () => point(foeHall())
    }
  ];

  // Soupeř se probudí až ke kroku útoku a pak se jen brání (nestaví, necvičí, neútočí).
  function wake() {
    if (run.brain || !PK.ai) return;
    const brain = PK.ai.createBrain(run.foe);
    brain.weak = true;
    brain.nextWave = Infinity;
    run.match.brains[run.foe] = brain;
    run.brain = brain;
    if (PK.audio) PK.audio.play("horn");
  }

  // Aby se tutoriál nikdy nezasekl na chybějících surovinách, krok si dorovná, co potřebuje.
  function topUp(need) {
    if (!need) return;
    const eco = run.match.econ[run.me];
    eco.gold = Math.max(eco.gold, need.gold);
    eco.wood = Math.max(eco.wood, need.wood);
  }

  function enter(i) {
    run.step = i;
    const step = STEPS[i];
    if (!step) return;
    topUp(step.need);
    if (step.enter) step.enter();
    report("step", { step: i, id: step.id, first: run.first });
  }

  /* ---------- průběh ---------- */
  function setup(match, me, opts = {}) {
    const st = load();
    const first = !st.started;
    save({ started: true });

    const foe = match.active.find(team => team !== me);
    run = { match, me, foe, step: 0, base: 0, flash: 0, brain: null, done: false, ended: false, first, touch: !!opts.touch, notify: opts.notify || (() => {}) };

    // AI soupeře stojí, dokud nepřijde krok útoku; jeho gmina je slabší, ať je první výhra krátká
    delete match.brains[foe];
    const hall = match.hqOf(foe);
    if (hall) {
      hall.maxHp = 700;
      hall.hp = 700;
    }
    // trocha surovin navíc, ať se na stavby a vojáky nečeká
    match.econ[me].gold = 420;
    match.econ[me].wood = 220;

    report("start", { first });
    enter(0);
  }

  function update(ctx, dt) {
    if (!run || run.ended) return;
    run.touch = !!ctx.touch;
    if (run.flash > 0) run.flash = Math.max(0, run.flash - dt);

    // při útoku dorovná suroviny na vojáky do počtu tří, kdyby padli a nebylo za co cvičit nové
    if (run.step >= 7) {
      const missing = 3 - ownUnits().filter(u => u.type !== "worker").length;
      if (missing > 0) topUp({ gold: R.COSTS.soldier.gold * missing, wood: R.COSTS.soldier.wood * missing });
    }

    const step = STEPS[run.step];
    if (!step || run.match.phase === "ended") return;

    // splněný krok přeskočí i ty další, které už hráč stihl udělat sám
    let advanced = false;
    while (STEPS[run.step] && STEPS[run.step].id !== "victory" && STEPS[run.step].done(ctx)) {
      enter(run.step + 1);
      advanced = true;
    }

    if (advanced) {
      run.flash = 1.1;
      if (PK.audio) PK.audio.play("select");
    }
  }

  // Konec zápasu: výhra dokončí tutoriál, prohra nebo odchod ho jen ukončí.
  function finish(won) {
    if (!run || run.ended) return;
    run.ended = true;
    if (!won) {
      report("quit", { step: run.step, first: run.first });
      return;
    }

    run.done = true;
    run.step = STEPS.length;
    const firstDone = !load().done;
    save({ done: true });
    report("done", { first: firstDone }).then(res => run && run.notify(res));
  }

  function skip() {
    if (!run) return;
    if (!run.ended) report("skip", { step: run.step, first: run.first });
    save({ skipped: true });
    run = null;
  }

  function stop() {
    if (run && !run.ended && !run.quitSent) report("quit", { step: run.step, first: run.first });
    run = null;
  }

  /* ---------- kreslení ---------- */
  const INK = "#0d0a17";
  const AMBER = "#ffbf45";
  const BRASS = "#c09c5a";
  let skipBox = null;

  function panelText(step) {
    const list = step.text;
    return t(list[run.touch && list[1] ? 1 : 0]);
  }

  // Šipka dolů (8x9 px) s obrysem; střed hrotu v (x, y).
  function arrowDown(g, x, y, color = AMBER) {
    const rows = ["..XXXX..", "..XXXX..", "..XXXX..", "XXXXXXXX", ".XXXXXX.", "..XXXX..", "...XX..."];
    const ox = Math.round(x) - 4;
    const oy = Math.round(y) - rows.length;
    g.fillStyle = INK;
    rows.forEach((r, j) => {
      for (let i = 0; i < r.length; i++) if (r[i] === "X") g.fillRect(ox + i - 1, oy + j - 1, 3, 3);
    });
    rows.forEach((r, j) => {
      for (let i = 0; i < r.length; i++) {
        if (r[i] !== "X") continue;
        g.fillStyle = i < 4 && j < 4 ? "#ffe08a" : color;
        g.fillRect(ox + i, oy + j, 1, 1);
      }
    });
  }

  // Šipka na kraji obrazovky, když je cíl mimo záběr: trojúhelník mířící k cíli.
  function edgeArrow(g, x, y, ang, T) {
    const r = 7 + Math.sin(T * 8);
    g.save();
    g.translate(Math.round(x), Math.round(y));
    g.rotate(ang);
    g.fillStyle = INK;
    g.beginPath();
    g.moveTo(r + 3, 0); g.lineTo(-r + 1, -r - 2); g.lineTo(-r + 1, r + 2); g.closePath();
    g.fill();
    g.fillStyle = AMBER;
    g.beginPath();
    g.moveTo(r, 0); g.lineTo(-r + 3, -r + 1); g.lineTo(-r + 3, r - 1); g.closePath();
    g.fill();
    g.restore();
  }

  function ring(g, cx, cy, rx, T) {
    const k = 0.5 + 0.5 * Math.sin(T * 6);
    const ry = Math.max(3, Math.round(rx * 0.45));
    g.fillStyle = `rgba(255,191,69,${0.55 + 0.35 * k})`;
    const n = Math.max(16, Math.round(rx * 2));
    for (let i = 0; i < n; i++) {
      if ((i + Math.floor(T * 8)) % 4 === 0) continue;
      const a = (i / n) * Math.PI * 2;
      g.fillRect(Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry), 1, 1);
    }
  }

  function drawPointer(g, ctx, ptr, T, panel) {
    if (!ptr) return;
    const V = ctx.view;
    const bob = Math.round(Math.abs(Math.sin(T * 4)) * 3);

    if (ptr.hud) {
      const b = PK.hud.buttons.find(k => k.type === ptr.hud && k.visible);
      if (!b) return;
      const k = 0.5 + 0.5 * Math.sin(T * 7);
      g.fillStyle = `rgba(255,191,69,${0.5 + 0.5 * k})`;
      g.fillRect(b.x - 2, b.y - 2, b.w + 4, 1);
      g.fillRect(b.x - 2, b.y + b.h + 1, b.w + 4, 1);
      g.fillRect(b.x - 2, b.y - 2, 1, b.h + 4);
      g.fillRect(b.x + b.w + 1, b.y - 2, 1, b.h + 4);
      g.fillStyle = `rgba(255,224,138,${0.2 * k})`;
      g.fillRect(b.x, b.y, b.w, b.h);
      arrowDown(g, b.x + b.w / 2, b.y - 3 - bob);
      return;
    }

    const e = ptr.at;
    if (!e) return;
    const big = e.kind === "building" || e.type === "hall" || e.type === "tower" || e.type === "barracks" || e.type === "hut";
    const lift = e.type === "gold" ? 22 : e.type === "wood" ? 26 : big ? (e.type === "hall" ? 44 : 30) : 16;
    const s = ctx.toScreen(e.x, e.y);
    const x = s.x;
    const y = s.y - lift * ctx.zoom;
    const m = 10;
    const inside = x > m && x < V.w - m && y > m + 8 && y < V.mapH - m;
    const hidden = panel && x > panel.x - 6 && x < panel.x + panel.w + 6 && y > panel.y - 4 && y < panel.y + panel.h + 12;

    if (inside && !hidden) {
      const rx = (e.type === "hall" ? 36 : big ? 18 : e.type === "gold" ? 16 : e.type === "wood" ? 9 : 8) * ctx.zoom;
      const foot = e.type === "hall" ? 22 : big ? 14 : e.type === "gold" ? 10 : e.type === "wood" ? 12 : 6;
      g.save();
      g.beginPath();
      g.rect(0, 0, V.w, V.mapH);
      g.clip();
      ring(g, s.x, s.y + foot * ctx.zoom, rx, T);
      arrowDown(g, x, y - bob);
      g.restore();
      return;
    }

    // cíl mimo záběr (nebo pod panelem): šipka na okraji mapové části
    const cx = V.w / 2;
    const cy = V.mapH / 2;
    const ang = Math.atan2(s.y - cy, s.x - cx);
    const kx = Math.abs(Math.cos(ang)) > 1e-6 ? (V.w / 2 - 16) / Math.abs(Math.cos(ang)) : Infinity;
    const ky = Math.abs(Math.sin(ang)) > 1e-6 ? (V.mapH / 2 - 16) / Math.abs(Math.sin(ang)) : Infinity;
    const k = Math.min(kx, ky, Math.hypot(s.x - cx, s.y - cy));
    edgeArrow(g, cx + Math.cos(ang) * k, cy + Math.sin(ang) * k, ang, T);
  }

  function draw(g, ctx, T) {
    skipBox = null;
    if (!run) return;
    const V = ctx.view;
    const done = run.done;
    const step = STEPS[Math.min(run.step, STEPS.length - 1)];
    if (run.ended && !done) return;

    const lines = [];
    const W = Math.min(300, V.w - 16);
    const inner = W - 14;
    const body = done
      ? [t("Tutoriál je hotový. Získáváš titul Nováček v síni slávy."), ...(ctx.loggedIn ? [] : [t("Přihlas se a titul se ti připíše k účtu.")])].join(" ")
      : panelText(step);
    for (const ln of PK.wrap(body, inner)) lines.push([ln, 0xf2ecff]);
    const status = !done && step.status ? step.status(ctx) : "";
    if (status) for (const ln of PK.wrap(status, inner)) lines.push([ln, 0x9ef0b0]);

    const h = 19 + lines.length * 10 + 4;
    const x = Math.round((V.w - W) / 2);
    const y = done ? Math.round(V.mapH / 2 + 36) : V.mapH - h - 6;
    const panel = { x, y, w: W, h };

    if (!done && !run.ended) drawPointer(g, ctx, step.pointer(ctx), T, panel);

    // panel: tmavý kámen s mosazným okrajem
    g.fillStyle = "rgba(13,10,23,0.86)";
    g.fillRect(x, y, W, h);
    g.fillStyle = BRASS;
    g.fillRect(x, y, W, 1);
    g.fillRect(x, y + h - 1, W, 1);
    g.fillRect(x, y, 1, h);
    g.fillRect(x + W - 1, y, 1, h);
    g.fillStyle = "#5a4129";
    g.fillRect(x + 1, y + 1, W - 2, 1);

    const head = done ? t("HOTOVO!") : `${t("TUTORIÁL")} ${run.step + 1}/${STEPS.length}`;
    PK.text(g, head, x + 7, y + 6, run.flash > 0 ? 0x9ef0b0 : 0xf0d088);

    // průběh kroků: tečky
    const dots = STEPS.length;
    const dx = x + 7 + PK.textWidth(head) + 8;
    for (let i = 0; i < dots; i++) {
      g.fillStyle = i < run.step ? "#9ef0b0" : i === run.step && !done ? AMBER : "#4a4466";
      g.fillRect(dx + i * 5, y + 8, 3, 3);
    }

    if (!done) {
      const label = t("PŘESKOČIT");
      const bw = PK.textWidth(label) + 10;
      const bx = x + W - bw - 4;
      const by = y + 3;
      g.fillStyle = "#2f2a50";
      g.fillRect(bx, by, bw, 11);
      g.fillStyle = INK;
      g.fillRect(bx, by + 11, bw, 1);
      PK.text(g, label, bx + 5, by + 3, 0xffe9a8);
      // dotyková plocha je větší než nápis (prst)
      skipBox = { x: bx - 6, y: by - 4, w: bw + 10, h: 19 };
    }

    let yy = y + 19;
    for (const [ln, col] of lines) {
      PK.text(g, ln, x + 7, yy, col);
      yy += 10;
    }

    if (done) {
      // odznak titulu v pravém horním rohu panelu (stejné barvy jako v síni slávy)
      const name = t("Nováček");
      const bw = PK.textWidth(name) + 12;
      const bx = x + W - bw - 5;
      const by = y + 4 + Math.round(Math.sin(T * 2.5));
      g.fillStyle = "#5fb070";
      g.fillRect(bx - 1, by - 1, bw + 2, 12);
      g.fillStyle = "#173226";
      g.fillRect(bx, by, bw, 10);
      PK.text(g, name, bx + 6, by + 2, 0xb8f0c0);
      g.drawImage(PK.icons.ringEmblem(13, PK.C.a[2], PK.C.a[4]), bx - 16, by - 2);
    }
  }

  // Klepnutí na plátno (art px bufferu): true = tutoriál ho spotřeboval.
  function hit(ax, ay) {
    if (!run || !skipBox) return false;
    const b = skipBox;
    if (ax < b.x || ax > b.x + b.w || ay < b.y || ay > b.y + b.h) return false;
    return true;
  }

  // zavřená karta uprostřed tutoriálu: odchod se ještě nahlásí (keepalive)
  window.addEventListener("pagehide", () => {
    if (run && !run.ended && !run.quitSent) {
      report("quit", { step: run.step, first: run.first });
      run.quitSent = true; // stránka se může vrátit z mezipaměti a hrát dál, hlásí se ale jen jednou
    }
  });

  PK.tutorial = {
    STEPS, TITLE, map, setup, update, draw, hit, finish, skip, stop, offer, claim, markPlayed, load, t,
    get active() { return !!run; },
    get step() { return run ? run.step : -1; },
    get done() { return !!(run && run.done); }
  };
})();
