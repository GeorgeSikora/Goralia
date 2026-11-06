/*
 * Editor map. Mapa je dokument goralia-map (viz maps.js), který se ukládá na server (maps/<id>.json)
 * nebo stahuje jako soubor. Pohled je okno do mapy (posun a zoom), takže zvládne i obří mapy.
 *
 * Co jde na mapu dát, je v paletě (js/editor-palette.js): řeky, jezera, hory, hradby, cesty a mosty,
 * druhy půdy, oblasti krajin, spálená zem, stromy, kulisy, zvířata, základny, doly, budovy a jednotky.
 * Nástroje: výběr (posun, kopírování, vložení, převrácení), kreslení (bod, štětec, čára, obdélník,
 * výplň, ovál), guma a kapátko. Symetrie ↔ ↕ ⟲ ✣, vrstvy, mřížka s přichycením, minimapa,
 * kontrola s ukázáním místa, zkouška mapy proti AI, náhled pro lobby, export JSON/PNG a dotykové ovládání.
 *
 * Souřadnice: pohled a tahy (voda, cesty, hory, hradby) a kruhy (půda, krajiny, popel) jsou v art px,
 * bodové objekty (základny, doly, stromy, kulisy, zvířata, jednotky, budovy) v logických px = 2 × art px.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const R = PK.rules;
  const MAPS = PK.maps;
  const CHECK = PK.mapcheck;
  const PAL = PK.editorPalette;
  const DOC = MAPS.DOC;
  const $ = id => document.getElementById(id);
  const T = s => (PK.tr ? PK.tr(s) : s);

  const DRAFT_KEY = "goralia-editor-draft";
  const PREFS_KEY = "goralia-editor-prefs";
  const TEST_KEY = "goralia-editor-test";
  const UNDO_MAX = 80;
  const ID_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;
  const MIN_ZOOM = 0.02;
  const MAX_ZOOM = 12;
  const BIG_AREA = 4e6; // art px²; nad tuto plochu je pečení skutečného vzhledu pomalé
  const GRID = 10; // art px, přichycení k mřížce

  const canvas = $("e-canvas");
  let g = canvas.getContext("2d");
  const stage = $("e-stage");
  const statusEl = $("e-status");
  const popup = $("e-popup");
  const mini = $("e-mini");
  const mg = mini.getContext("2d");

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const r1 = v => Math.round(v * 10) / 10;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const teamOf = i => R.TEAMS[i] || "blue";
  const teamCss = i => PK.css(PK.TEAM[teamOf(i)].ui);
  const rnd = Math.random;

  const blank = () => ({
    format: DOC.FORMAT, version: DOC.VERSION, id: "", name: "", description: "",
    size: [640, 400], seed: 1, autoRoads: true, bases: [], gold: [], trees: [], water: [], roads: [], mountains: [], walls: []
  });

  /* ---------- seznamy objektů v dokumentu ----------
   * Bodové objekty: o = položka seznamu, off = index souřadnice x v poli (základna je objekt {x, y}).
   * Kruhy: [.., x, y, r] v art px.  Tahy: { pts, hw | w } v art px. */
  const POINTS = {
    base: { key: "bases", layer: "game", off: -1 },
    gold: { key: "gold", layer: "game", off: 0 },
    tree: { key: "trees", layer: "trees", off: 0 },
    prop: { key: "props", layer: "props", off: 1 },
    critter: { key: "critters", layer: "critters", off: 1 },
    unit: { key: "units", layer: "game", off: 2 },
    building: { key: "buildings", layer: "game", off: 2 }
  };
  const CIRCLES = {
    ground: { key: "ground", layer: "regions", off: 1 },
    theme: { key: "biomes", layer: "regions", off: 1 },
    ash: { key: "ash", layer: "regions", off: 0 }
  };
  const STROKES = {
    water: { key: "water", layer: "terrain", w: "hw", max: "MAX_WATER", range: [2, 20] },
    road: { key: "roads", layer: "terrain", w: "w", max: "MAX_ROADS", range: [2, 12] },
    mountain: { key: "mountains", layer: "terrain", w: "hw", max: "MAX_MOUNTAINS", range: [4, 40] },
    wall: { key: "walls", layer: "terrain", w: "hw", max: "MAX_WALLS", range: [2, 5] }
  };
  const MAX_OF = { bases: "MAX_BASES", gold: "MAX_GOLD", trees: "MAX_TREES", props: "MAX_PROPS", critters: "MAX_CRITTERS", units: "MAX_UNITS", buildings: "MAX_BUILDINGS", ground: "MAX_GROUND", biomes: "MAX_BIOMES", ash: "MAX_ASH" };
  const KIND_OF_KEY = Object.fromEntries([...Object.entries(POINTS), ...Object.entries(CIRCLES), ...Object.entries(STROKES)].map(([k, v]) => [v.key, k]));

  const list = key => doc[key] || (doc[key] = []);
  const ppos = (kind, o) => (kind === "base" ? [o.x, o.y] : [o[POINTS[kind].off], o[POINTS[kind].off + 1]]);
  const pset = (kind, o, x, y) => {
    if (kind === "base") { o.x = x; o.y = y; } else { o[POINTS[kind].off] = x; o[POINTS[kind].off + 1] = y; }
  };
  const cpos = (kind, c) => [c[CIRCLES[kind].off], c[CIRCLES[kind].off + 1], c[CIRCLES[kind].off + 2]];
  const allStrokes = () => [...doc.water, ...doc.roads, ...doc.mountains, ...doc.walls];

  // Prázdné nepovinné seznamy se do souboru nepíšou.
  function tidy(d) {
    for (const k of ["props", "critters", "units", "buildings", "ground", "biomes", "ash"]) if (d[k] && !d[k].length) delete d[k];
    return d;
  }

  /* ---------- stav ---------- */
  let doc = blank();
  let tool = "draw";
  let item = null; // položka palety
  let cat = "terrain";
  const prefs = { mode: {}, size: {}, density: 5, shape: "circle", mix: false, team: 0, layers: {} };
  const LAYERS = [
    ["terrain", "Voda, hory, hradby a cesty"],
    ["regions", "Půda, krajiny a popel"],
    ["trees", "Stromy"],
    ["props", "Kulisy"],
    ["critters", "Zvířata"],
    ["game", "Základny, doly, budovy a jednotky"],
    ["zones", "Území základen"],
    ["problems", "Značky problémů"]
  ];
  const visible = id => prefs.layers[id] !== false;
  const view = { real: false, grid: true };
  const cam = { x: 0, y: 0 }; // levý horní roh pohledu v art px
  let zoom = 1; // obrazovkových px na art px
  let vw = 800;
  let vh = 600;
  let dpr = 1;
  let needFit = true;
  let hover = null; // art px
  let drag = null;
  let pan = null;
  let spaceDown = false;
  let dirty = false;
  let serverMaps = [];
  let serverUp = false;
  let canEdit = false;
  let mpOff = new Set();
  let savedId = "";
  let problems = [];
  let spots = []; // místa problémů (art px) pro značky
  let scene = null;
  let sceneFresh = false;
  let bakeSeq = 0;
  let lastBake = "";
  let layoutCache = null;
  let maskCache = null;
  let propsMode = "props";
  let propsIdTouched = false;
  let propsLang = "cs";
  let propsDraft = null;
  let popupOwner = null;
  let selection = []; // [{ key, o }]
  let clipboard = null;
  let pasting = false;
  let groupSeq = 1;
  const undo = [];
  const redo = [];
  const timers = { draw: 0, validate: 0, bake: 0, draft: 0, status: 0, mini: 0 };
  const touches = new Map();
  let pinch = null;
  let longPress = 0;

  const W = () => doc.size[0];
  const H = () => doc.size[1];
  const LW = () => doc.size[0] * 2;
  const LH = () => doc.size[1] * 2;
  const isBig = () => W() * H() > BIG_AREA;

  /* ---------- pomocné ---------- */
  function say(text, kind = "") {
    statusEl.textContent = T(text);
    statusEl.className = `status ${kind}`;
    clearTimeout(timers.status);
    timers.status = setTimeout(() => { statusEl.className = "status"; showCoords(); }, 3500);
  }

  function showCoords() {
    if (statusEl.className.includes("error") || statusEl.className.includes("ok")) return;
    const pos = hover ? `x ${Math.round(hover[0] * 2)}, y ${Math.round(hover[1] * 2)} · ` : "";
    const sel = selection.length ? ` · ${T("vybráno")} ${selection.length}` : "";
    statusEl.textContent = `${pos}${T("mapa")} ${LW()} × ${LH()} · ${T("přiblížení")} ${Math.round(zoom * 100)} %${sel}`;
  }

  const slug = text => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 31);

  function loadPrefs() {
    try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || "{}")); } catch (e) { /* bez úložiště */ }
  }

  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* bez úložiště */ }
  }

  /* ---------- symetrie ---------- */
  // Proměny podle zapnutých os: každá vrací [x, y] pro prostor w × h.
  function transforms(w, h) {
    const mx = $("e-mx").checked;
    const my = $("e-my").checked;
    const mr = $("e-mr").checked;
    const m4 = $("e-m4").checked && Math.abs(W() - H()) < 1;
    const out = [(x, y) => [x, y]];
    if (mx) out.push((x, y) => [w - x, y]);
    if (my) out.push((x, y) => [x, h - y]);
    if ((mx && my) || mr || m4) out.push((x, y) => [w - x, h - y]);
    if (m4) {
      out.push((x, y) => [w - y, x]);
      out.push((x, y) => [y, h - x]);
      if (mx || my) {
        out.push((x, y) => [y, x]);
        out.push((x, y) => [w - y, h - x]);
      }
    }
    return out;
  }

  // Bod a jeho symetrická dvojčata (bez duplicit na osách).
  function orbit(x, y, w, h, gap = 0.5) {
    const pts = transforms(w, h).map(f => f(x, y));
    return pts.filter((p, i) => pts.findIndex(q => dist(p, q) < gap) === i);
  }
  const symOn = () => ["e-mx", "e-my", "e-mr", "e-m4"].some(id => $(id).checked);

  const snapArt = p => ($("e-snap").checked ? [Math.round(p[0] / GRID) * GRID, Math.round(p[1] / GRID) * GRID] : p);

  /* ---------- geometrie ---------- */
  function segDist(p, pts) {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy || 1;
      const t = clamp(((p[0] - ax) * dx + (p[1] - ay) * dy) / len2, 0, 1);
      best = Math.min(best, Math.hypot(p[0] - (ax + dx * t), p[1] - (ay + dy * t)));
    }
    return best;
  }

  /* Maska terénu po buňkách 2 × 2 art px: vzdálenost od břehu vody (záporná ve vodě), skála (hory, hradby) a cesta.
   * Počítá se líně a jen když se změnily tahy; slouží umísťování, výplni a kontrole. */
  const MC = 2;
  function strokeKey() {
    return `${doc.size}|${JSON.stringify(doc.water)}|${JSON.stringify(doc.mountains)}|${JSON.stringify(doc.walls)}|${JSON.stringify(doc.roads)}`;
  }

  function mask() {
    const key = strokeKey();
    if (maskCache && maskCache.key === key) return maskCache;
    const mw = Math.ceil(W() / MC) + 1;
    const mh = Math.ceil(H() / MC) + 1;
    const wd = new Float32Array(mw * mh).fill(99);
    const rock = new Uint8Array(mw * mh);
    const road = new Uint8Array(mw * mh);
    const raster = (s, reach, fn) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of s.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      const cx0 = clamp(Math.floor((x0 - reach) / MC), 0, mw - 1), cx1 = clamp(Math.ceil((x1 + reach) / MC), 0, mw - 1);
      const cy0 = clamp(Math.floor((y0 - reach) / MC), 0, mh - 1), cy1 = clamp(Math.ceil((y1 + reach) / MC), 0, mh - 1);
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) fn(cy * mw + cx, segDist([cx * MC, cy * MC], s.pts));
    };
    for (const s of doc.water) raster(s, s.hw + 12, (i, d) => { if (d - s.hw < wd[i]) wd[i] = d - s.hw; });
    for (const s of doc.mountains) raster(s, s.hw, (i, d) => { if (d < s.hw - 1) rock[i] = 1; });
    for (const s of doc.walls) raster(s, MAPS.wallR(s) + 3, (i, d) => { if (d < MAPS.wallR(s)) rock[i] = 2; });
    for (const s of doc.roads) raster(s, s.w, (i, d) => { if (d < s.w * 0.8) road[i] = 1; });
    maskCache = { key, mw, mh, wd, rock, road };
    return maskCache;
  }

  const mIndex = (m, ax, ay) => clamp(Math.round(ay / MC), 0, m.mh - 1) * m.mw + clamp(Math.round(ax / MC), 0, m.mw - 1);
  const waterD = (ax, ay) => { const m = mask(); return m.wd[mIndex(m, ax, ay)]; };
  const rockAt = (ax, ay) => { const m = mask(); return !!m.rock[mIndex(m, ax, ay)]; };
  const roadAt = (ax, ay) => { const m = mask(); return !!m.road[mIndex(m, ax, ay)]; };

  function layout() {
    if (!layoutCache) {
      const zones = MAPS.zonesFor(doc.bases, LW(), LH());
      layoutCache = doc.bases.map((b, i) => MAPS.baseAt(b.x, b.y, LW(), LH(), zones[i]));
    }
    return layoutCache;
  }

  const undeadBase = i => !!doc.coop && doc.coop.ai === i;
  const nearestBase = (x, y) => {
    let best = -1, bd = Infinity;
    doc.bases.forEach((b, i) => { const d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; best = i; } });
    return best;
  };

  /* ---------- historie a změny ---------- */
  const snapshot = () => JSON.stringify(doc);

  function remember(before) {
    undo.push(before);
    if (undo.length > UNDO_MAX) undo.shift();
    redo.length = 0;
    renderHistory();
  }

  function restore(json) {
    doc = JSON.parse(json);
    selection = [];
    changed();
  }

  function stepHistory(from, to) {
    if (!from.length) return;
    to.push(snapshot());
    restore(from.pop());
    renderHistory();
  }

  function renderHistory() {
    $("e-undo").disabled = !undo.length;
    $("e-redo").disabled = !redo.length;
  }

  function changed(markDirty = true) {
    if (markDirty) dirty = true;
    layoutCache = null;
    sceneFresh = false;
    renderTitle();
    renderTeams();
    scheduleDraw();
    scheduleMini();
    clearTimeout(timers.validate);
    timers.validate = setTimeout(validate, isBig() ? 1200 : 500);
    clearTimeout(timers.draft);
    timers.draft = setTimeout(saveDraft, 800);
    if (view.real && !isBig()) scheduleBake();
  }

  // Provede úpravu dokumentu jako jeden krok historie.
  function mutate(fn) {
    const before = snapshot();
    fn();
    if (snapshot() !== before) {
      remember(before);
      changed();
    }
  }

  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, snapshot()); } catch (e) { /* úložiště nedostupné nebo plné */ }
  }

  function renderTitle() {
    const t = $("e-title");
    t.replaceChildren(`${doc.name.trim() || T("Bez názvu")}${dirty ? " ●" : ""} `);
    const small = document.createElement("small");
    small.textContent = `${LW()}×${LH()}`;
    t.append(small);
    const play = $("e-play");
    const known = serverMaps.some(m => m.id === doc.id) && savedId === doc.id && !dirty;
    play.hidden = !known;
    if (known) play.href = `index.html?map=${encodeURIComponent(doc.id)}`;
  }

  function replaceDoc(next, saved) {
    undo.length = 0;
    redo.length = 0;
    doc = next;
    dirty = false;
    savedId = saved;
    scene = null;
    selection = [];
    needFit = true;
    groupSeq = 1 + Math.max(0, ...doc.water.map(s => s.g || 0));
    renderHistory();
    resizeCanvas();
    changed(false);
  }

  function setTheme(d, theme) {
    if (theme && theme !== "meadow" && MAPS.THEMES.includes(theme)) d.theme = theme;
    else delete d.theme;
    scene = null;
  }

  function applySize(w, h) {
    if (w === W() && h === H()) return;
    doc.size = [w, h];
    const keepL = (x, y) => x >= 0 && x <= w * 2 && y >= 0 && y <= h * 2;
    for (const [kind, p] of Object.entries(POINTS)) if (doc[p.key]) doc[p.key] = doc[p.key].filter(o => keepL(...ppos(kind, o)));
    for (const [kind, c] of Object.entries(CIRCLES)) if (doc[c.key]) doc[c.key] = doc[c.key].filter(o => { const [x, y] = cpos(kind, o); return x <= w && y <= h; });
    for (const s of allStrokes()) s.pts = s.pts.map(([x, y]) => [clamp(x, 0, w), clamp(y, 0, h)]);
    if (doc.coop && doc.coop.ai >= doc.bases.length) delete doc.coop;
    scene = null;
  }

  /* ---------- pohled ---------- */
  function resizeCanvas() {
    const box = stage.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    vw = Math.max(100, box.width);
    vh = Math.max(100, box.height);
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    canvas.style.width = `${vw}px`;
    canvas.style.height = `${vh}px`;
    if (needFit) fitView();
    clampCam();
    scheduleDraw();
  }

  function clampCam() {
    const ww = vw / zoom;
    const hh = vh / zoom;
    cam.x = clamp(cam.x, -ww * 0.7, W() - ww * 0.3);
    cam.y = clamp(cam.y, -hh * 0.7, H() - hh * 0.3);
  }

  function fitView() {
    needFit = false;
    zoom = clamp(Math.min((vw - 40) / W(), (vh - 90) / H()), MIN_ZOOM, MAX_ZOOM);
    cam.x = W() / 2 - vw / zoom / 2;
    cam.y = H() / 2 - (vh + 40) / zoom / 2;
  }

  function zoomAt(factor, sx, sy) {
    const ax = cam.x + sx / zoom;
    const ay = cam.y + sy / zoom;
    zoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
    cam.x = ax - sx / zoom;
    cam.y = ay - sy / zoom;
    clampCam();
    scheduleDraw();
    showCoords();
  }

  const zoomTo = value => zoomAt(value / zoom, vw / 2, vh / 2);

  function panBy(dx, dy) {
    cam.x += dx / zoom;
    cam.y += dy / zoom;
    clampCam();
    scheduleDraw();
  }

  function centerOn(p, z) {
    if (z) zoom = clamp(z, MIN_ZOOM, MAX_ZOOM);
    cam.x = p[0] - vw / zoom / 2;
    cam.y = p[1] - vh / zoom / 2;
    clampCam();
    scheduleDraw();
  }

  new ResizeObserver(resizeCanvas).observe(stage);

  const screenToArt = (cx, cy) => {
    const box = canvas.getBoundingClientRect();
    return [cam.x + (cx - box.left) / zoom, cam.y + (cy - box.top) / zoom];
  };
  const eventPoint = ev => {
    const [x, y] = screenToArt(ev.clientX, ev.clientY);
    return [clamp(x, 0, W()), clamp(y, 0, H())];
  };

  /* ---------- objekty pod kurzorem ---------- */
  const PICK_ORDER = ["unit", "building", "base", "gold", "critter", "prop", "tree"];

  function pickAt(p, kinds = PICK_ORDER) {
    const tol = 8 / zoom;
    let best = null;
    let bd = Infinity;
    for (const kind of kinds) {
      const P = POINTS[kind];
      if (!visible(P.layer)) continue;
      const items = doc[P.key] || [];
      const min = kind === "base" ? 14 : kind === "building" ? 14 : kind === "gold" ? 8 : kind === "tree" ? 6 : 5;
      for (let i = items.length - 1; i >= 0; i--) {
        const [x, y] = ppos(kind, items[i]);
        // obrázek stojí nad patou: kliknout jde i do koruny stromu nebo na střechu
        const lift = kind === "tree" ? 8 : kind === "building" || kind === "base" ? 10 : kind === "unit" ? 5 : 2;
        const d = Math.hypot(x / 2 - p[0], (y / 2 - lift - p[1]) * 0.8);
        if (d < Math.max(min, tol) && d < bd) { bd = d; best = { key: P.key, kind, o: items[i] }; }
      }
      if (best) return best;
    }
    return null;
  }

  function pickStroke(p) {
    if (!visible("terrain")) return null;
    const tol = 3 / zoom;
    for (const kind of ["road", "wall", "mountain", "water"]) {
      const S = STROKES[kind];
      const items = doc[S.key];
      for (let i = items.length - 1; i >= 0; i--) if (segDist(p, items[i].pts) <= items[i][S.w] + tol) return { key: S.key, kind, o: items[i] };
    }
    return null;
  }

  function pickCircle(p) {
    if (!visible("regions")) return null;
    for (const kind of ["ash", "ground", "theme"]) {
      const items = doc[CIRCLES[kind].key] || [];
      for (let i = items.length - 1; i >= 0; i--) {
        const [x, y, r] = cpos(kind, items[i]);
        if (Math.hypot(p[0] - x, p[1] - y) < r) return { key: CIRCLES[kind].key, kind, o: items[i] };
      }
    }
    return null;
  }

  const pickAny = p => pickAt(p) || pickStroke(p) || pickCircle(p);

  function removeRef(ref) {
    const arr = doc[ref.key];
    if (!arr) return;
    const i = arr.indexOf(ref.o);
    if (i >= 0) arr.splice(i, 1);
    if (ref.key === "bases") fixAfterBaseRemoval(i);
  }

  // Po smazání základny se jednotky a budovy přečíslují, ty smazané základny zmizí.
  function fixAfterBaseRemoval(i) {
    if (i < 0) return;
    for (const key of ["units", "buildings"]) {
      if (!doc[key]) continue;
      doc[key] = doc[key].filter(u => u[1] !== i);
      for (const u of doc[key]) if (u[1] > i) u[1]--;
    }
    if (doc.coop) {
      if (doc.coop.ai === i) delete doc.coop;
      else if (doc.coop.ai > i) doc.coop.ai--;
    }
  }

  // Jezero je skupina tahů vody (g); smaže se vcelku.
  function lakeOf(s) {
    return s && s.g ? doc.water.filter(o => o.g === s.g) : s ? [s] : [];
  }

  /* ---------- pravidla umístění ---------- */
  const SPACING = { tree: 26, prop: 12, critter: 18, unit: 16, gold: 72, building: 0, base: 300 };

  function farFromBases(x, y, hq, rax) {
    return layout().every(s => Math.hypot(x - s.hq.x, y - s.hq.y) > hq && Math.hypot(x - s.plot.x, y - s.plot.y) > rax);
  }

  const inMap = (x, y, m = 30) => x >= m && x <= LW() - m && y >= m && y <= LH() - m;

  // Kulisy a zvířata patřící na vodu nebo na břeh.
  const WATER_PROPS = new Set(["lilyPads"]);
  const BANK_PROPS = new Set(["reedsA", "reedsB"]);

  // Proč tu objekt nemůže stát (prázdný text = může). x, y v logických px.
  function placeProblem(kind, value, x, y, pending = []) {
    if (!inMap(x, y, kind === "critter" || kind === "unit" ? 12 : 24)) return "Moc u okraje mapy.";
    const ax = x / 2;
    const ay = y / 2;
    const near = (key, gap) => (doc[key] || []).some(o => Math.hypot(...ppos(KIND_OF_KEY[key], o).map((v, i) => v - [x, y][i])) < gap) ||
      pending.some(q => q.key === key && Math.hypot(q.x - x, q.y - y) < gap);
    if (kind === "tree") {
      // pata kmene je 15 art px pod bodem stromu; ani pata, ani koruna nesmí být ve vodě
      if (waterD(ax, ay + 15) < 4 || waterD(ax, ay) < 2) return "Strom by stál ve vodě.";
      if (rockAt(ax, ay + 15) || roadAt(ax, ay + 15)) return "Strom nemůže růst na skále, hradbě ani cestě.";
      if (near("trees", SPACING.tree * (prefs.density > 7 ? 0.8 : 1))) return "Moc blízko jiného stromu.";
      if (near("gold", 60)) return "Moc blízko dolu.";
      if (!farFromBases(x, y, 120, 90)) return "Strom by stál v základně.";
      return "";
    }
    if (kind === "prop") {
      const wd = waterD(ax, ay);
      if (WATER_PROPS.has(value)) return wd < -2 ? "" : "Lekníny patří na hladinu.";
      if (BANK_PROPS.has(value)) { if (wd < -4) return "Rákos patří na břeh, ne do hluboké vody."; }
      else if (wd < 2) return "Kulisa by stála ve vodě.";
      if (rockAt(ax, ay)) return "Kulisa by stála na skále nebo hradbě.";
      if (near("props", SPACING.prop * (11 - prefs.density) / 6)) return "Moc blízko jiné kulisy.";
      return "";
    }
    if (kind === "critter") {
      const wd = waterD(ax, ay);
      if (MAPS.WATER_CRITTERS.includes(value)) return wd < -4 ? "" : "Kachny a ryby patří na otevřenou vodu.";
      if (wd < 1) return "Zvíře by stálo ve vodě.";
      if (rockAt(ax, ay)) return "Zvíře by stálo na skále.";
      if (near("critters", SPACING.critter)) return "Moc blízko jiného zvířete.";
      return "";
    }
    if (kind === "unit") {
      if (!doc.bases.length) return "Nejdřív přidej základnu.";
      if (waterD(ax, ay) < 1 && !roadAt(ax, ay)) return "Jednotka by stála ve vodě.";
      if (rockAt(ax, ay)) return "Jednotka by stála na skále.";
      if (near("units", SPACING.unit)) return "Moc blízko jiné jednotky.";
      return "";
    }
    if (kind === "building") {
      if (!doc.bases.length) return "Nejdřív přidej základnu.";
      const f = R.footRect({ type: value, x, y });
      for (const [cx, cy] of [[f.x0, f.y0], [f.x1, f.y0], [f.x0, f.y1], [f.x1, f.y1], [x, y]]) {
        if (waterD(cx / 2, cy / 2) < 2 || rockAt(cx / 2, cy / 2)) return "Budova by stála ve vodě nebo na skále.";
      }
      const others = [...layout().map((s, i) => ({ type: undeadBase(i) ? "necropolis" : s.hq.type, x: s.hq.x, y: s.hq.y, hp: 1 })),
        ...(doc.buildings || []).map(([t, , bx, by]) => ({ type: t, x: bx, y: by, hp: 1 })),
        ...pending.filter(q => q.key === "buildings").map(q => ({ type: q.type, x: q.x, y: q.y, hp: 1 }))];
      const res = [...doc.gold.map(([gx, gy]) => ({ type: "gold", x: gx, y: gy, amount: 1 })), ...doc.trees.map(([tx, ty]) => ({ type: "wood", x: tx, y: ty, amount: 1 }))];
      if (!R.footFree(value, x, y, others, res)) return "Budova by se překrývala s jinou budovou, dolem nebo stromem.";
      return "";
    }
    if (kind === "gold") {
      if (waterD(ax, ay) < 10 || rockAt(ax, ay)) return "Důl nemůže stát ve vodě ani u ní.";
      if (near("gold", 72)) return "Doly by se dotýkaly.";
      if (!farFromBases(x, y, 110, 0)) return "Důl je moc blízko základny.";
      return "";
    }
    if (kind === "base") {
      if (doc.bases.length + pending.filter(q => q.key === "bases").length >= R.MAX_PLAYERS) return `Nejvýše ${R.MAX_PLAYERS} základen.`;
      if (near("bases", 300)) return "Základny musí být od sebe aspoň 300 jednotek.";
      if (waterD(ax, ay) < 20 || rockAt(ax, ay)) return "Základna nemůže stát ve vodě ani na skále.";
      return "";
    }
    return "";
  }

  // Nový bodový objekt v dokumentu (bez kontroly).
  function makePoint(kind, value, x, y, base) {
    if (kind === "base") return { x, y };
    if (kind === "gold") { const a = Number($("o-amount").value); return a === R.GOLD_AMOUNT ? [x, y] : [x, y, a]; }
    if (kind === "tree") return value >= 0 ? [x, y, value] : [x, y];
    if (kind === "prop" || kind === "critter") return [value, x, y];
    return [value, base, x, y];
  }

  // Varianta položky při "náhodně míchat": podobné kulisy (stejná skupina) nebo jiný strom.
  function variantOf(it) {
    if (!prefs.mix || !it) return it.value;
    if (it.kind === "tree" && it.value >= 0) return Math.floor(rnd() * PK.props.trees.length);
    if (it.kind === "prop" && it.family) {
      const same = PAL.items.filter(o => o.kind === "prop" && o.family === it.family);
      return same[Math.floor(rnd() * same.length)].value;
    }
    return it.value;
  }

  /* Umístí bodový objekt i se symetrickými dvojčaty; vrací text problému nebo "".
   * pending = objekty přidané v tomto kroku (aby se dvojčata navzájem nehlídala proti dokumentu dvakrát). */
  function placePoint(it, lx, ly, pending = [], quiet = false) {
    const kind = it.kind;
    const P = POINTS[kind];
    const arr = list(P.key);
    const value = variantOf(it);
    const copies = orbit(lx, ly, LW(), LH(), kind === "base" ? 150 : kind === "gold" ? 70 : 6).map(([x, y]) => [Math.round(x), Math.round(y)]);
    const max = DOC[MAX_OF[P.key]];
    if (arr.length + copies.length > max) return quiet ? "max" : `Víc se nevejde (nejvýše ${max}).`;
    const team = clamp(prefs.team, 0, Math.max(0, doc.bases.length - 1));
    const staged = [];
    for (const [x, y] of copies) {
      const problem = placeProblem(kind, value, x, y, [...pending, ...staged]);
      if (problem) return problem;
      // dvojče jednotky nebo budovy patří nejbližší základně (u zrcadlené mapy té protější)
      const base = kind === "unit" || kind === "building" ? (x === copies[0][0] && y === copies[0][1] ? team : Math.max(0, nearestBase(x, y))) : 0;
      staged.push({ key: P.key, x, y, type: value, base });
    }
    for (const q of staged) {
      if (kind === "unit" || kind === "building") {
        const own = undeadBase(q.base);
        const faction = kind === "unit" ? MAPS.PLACE_UNITS : MAPS.PLACE_BUILDINGS;
        if (faction[own ? "undead" : "human"].indexOf(q.type) < 0) return own ? "Základna nemrtvých má jen jednotky a budovy nemrtvých." : "Nemrtvé dej jen základně nemrtvých (kooperace ve Vlastnostech mapy).";
      }
    }
    for (const q of staged) arr.push(makePoint(kind, q.type, q.x, q.y, q.base));
    pending.push(...staged);
    if (kind === "base") layoutCache = null;
    return "";
  }

  // Rozptýlí body v ploše: cand() dává kandidáty (logické px), zastaví se po `count` úspěších.
  function scatterPoints(it, cands, count) {
    const pending = [];
    let placed = 0;
    let last = "";
    for (const [x, y] of cands) {
      if (placed >= count) break;
      const p = placePoint(it, Math.round(x), Math.round(y), pending, true);
      if (!p) placed++;
      else if (p === "max") { last = "Víc objektů se nevejde."; break; } else last = p;
    }
    return { placed, last };
  }

  const spacingOf = it => {
    const base = it.kind === "prop" ? Math.max(10, (PK.props.doodads[it.value] ? PK.props.doodads[it.value].c.width : 12) * 1.3) : SPACING[it.kind] || 20;
    return base * (1.6 - prefs.density * 0.1);
  };

  // kandidáti na mřížce s rozházením v obdélníku (art px)
  function gridCands(x0, y0, x1, y1, step, inside = () => true) {
    const out = [];
    for (let y = y0 + step / 2; y < y1; y += step * 0.87) {
      for (let x = x0 + step / 2 + ((Math.round(y / step) & 1) ? step / 2 : 0); x < x1; x += step) {
        const jx = x + (rnd() - 0.5) * step * 0.6;
        const jy = y + (rnd() - 0.5) * step * 0.6;
        if (inside(jx, jy)) out.push([jx * 2, jy * 2]);
      }
    }
    return out;
  }

  /* ---------- výplň oblasti ---------- */
  // Souvislá souš (bez vody, hor, hradeb a cest) kolem bodu, po buňkách 4 art px; vrací Set indexů a rozměr mřížky.
  function floodLand(p, maxCells = 160000) {
    const C4 = 4;
    const gw = Math.ceil(W() / C4);
    const gh = Math.ceil(H() / C4);
    const free = i => {
      const x = (i % gw) * C4 + 2;
      const y = Math.floor(i / gw) * C4 + 2;
      return waterD(x, y) > 1 && !rockAt(x, y) && !roadAt(x, y);
    };
    const start = clamp(Math.floor(p[1] / C4), 0, gh - 1) * gw + clamp(Math.floor(p[0] / C4), 0, gw - 1);
    const water = waterD(p[0], p[1]) < 0;
    // ve vodě se vyplní vodní plocha (pro kachny, lekníny)
    const ok = water ? i => { const x = (i % gw) * C4 + 2; const y = Math.floor(i / gw) * C4 + 2; return waterD(x, y) < -2; } : free;
    if (!ok(start)) return null;
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length && seen.size < maxCells) {
      const c = stack.pop();
      const cx = c % gw;
      for (const n of [cx > 0 ? c - 1 : -1, cx < gw - 1 ? c + 1 : -1, c - gw, c + gw]) {
        if (n < 0 || n >= gw * gh || seen.has(n) || !ok(n)) continue;
        seen.add(n);
        stack.push(n);
      }
    }
    return { cells: seen, gw, C4 };
  }

  /* ---------- kruhy (půda, krajiny, popel) ---------- */
  function makeCircle(it, x, y, r) {
    if (it.kind === "ground") return [it.value, Math.round(x), Math.round(y), Math.round(r)];
    if (it.kind === "theme") return [it.value, Math.round(x), Math.round(y), Math.round(r)];
    return [Math.round(x), Math.round(y), Math.round(r)];
  }

  function placeCircle(it, x, y, r) {
    const C0 = CIRCLES[it.kind];
    const arr = list(C0.key);
    const copies = orbit(x, y, W(), H(), r * 0.4);
    const max = DOC[MAX_OF[C0.key]];
    if (arr.length + copies.length > max) return `Víc oblastí se nevejde (nejvýše ${max}). Použij větší poloměr.`;
    for (const [cx, cy] of copies) arr.push(makeCircle(it, clamp(cx, 0, W()), clamp(cy, 0, H()), r));
    return "";
  }

  /* ---------- tahy (voda, cesty, hory, hradby) ---------- */
  function strokeWidth(it) { return prefs.size[it.id] || it.size[3]; }

  function beginStroke(it, p) {
    const S = STROKES[it.kind];
    const arr = doc[S.key];
    const starts = orbit(p[0], p[1], W(), H());
    if (arr.length + starts.length > DOC[S.max]) return say(`Víc tahů už se nevejde (nejvýše ${DOC[S.max]}).`, "error");
    const w = clamp(strokeWidth(it), S.range[0], S.range[1]);
    const strokes = starts.map(([x, y]) => (it.kind === "road" ? { pts: [[r1(x), r1(y)]], w, main: !!(it.main || $("o-main").checked) } : { pts: [[r1(x), r1(y)]], hw: w }));
    arr.push(...strokes);
    Object.assign(drag, { strokes, last: p, start: p });
  }

  function totalPoints() { return allStrokes().reduce((n, s) => n + s.pts.length, 0); }

  function extendStroke(p) {
    if (Math.hypot(p[0] - drag.last[0], p[1] - drag.last[1]) < Math.max(3, 2 / zoom)) return;
    if (drag.strokes[0].pts.length >= DOC.MAX_PTS || totalPoints() + drag.strokes.length > DOC.MAX_TOTAL_PTS) return say("Tah je příliš dlouhý. Pusť tlačítko a začni nový.", "error");
    const o = transforms(W(), H()).map(f => f(p[0], p[1]));
    drag.strokes.forEach((s, i) => s.pts.push([r1(clamp(o[i][0], 0, W())), r1(clamp(o[i][1], 0, H()))]));
    drag.last = p;
  }

  // Čára nebo obdélník: tah se přepočítá z počátku a konce.
  function shapeStroke(p) {
    const a = drag.start;
    const f = transforms(W(), H());
    drag.strokes.forEach((s, i) => {
      const pts = drag.mode === "rect" ? [[a[0], a[1]], [p[0], a[1]], [p[0], p[1]], [a[0], p[1]], [a[0], a[1]]] : [a, p];
      s.pts = pts.map(q => f[i](q[0], q[1])).map(([x, y]) => [r1(clamp(x, 0, W())), r1(clamp(y, 0, H()))]);
    });
  }

  function finishStroke() {
    for (const s of drag.strokes) {
      if (s.pts.length < 2) s.pts.push([s.pts[0][0] + 0.5, s.pts[0][1]]);
      if (drag.item.kind === "water") joinWater(s);
    }
  }

  /* Řeka, která končí u jezera nebo jiné vody, se do ní protáhne: konec se posune dovnitř vodní plochy,
   * takže sjednocení tahů nemá u ústí zub ani ostrůvek (world.js kreslí vodu jako sjednocení vzdáleností). */
  function joinWater(s) {
    const others = doc.water.filter(o => o !== s && !drag.strokes.includes(o));
    for (const end of [0, 1]) {
      const pts = s.pts;
      const p = end ? pts[pts.length - 1] : pts[0];
      const lake = lakes().find(L => ((p[0] - L.cx) / (L.rx + s.hw + 8)) ** 2 + ((p[1] - L.cy) / (L.ry + s.hw + 8)) ** 2 < 1);
      let target = null;
      if (lake) target = [lake.cx + (p[0] - lake.cx) * 0.45, lake.cy + (p[1] - lake.cy) * 0.45];
      else {
        // nejbližší bod jiné řeky do vzdálenosti její šířky + 10
        let best = null, bd = Infinity;
        for (const o of others) {
          if (o.g) continue;
          for (let i = 0; i < o.pts.length - 1; i++) {
            const [ax, ay] = o.pts[i];
            const [bx, by] = o.pts[i + 1];
            const dx = bx - ax, dy = by - ay;
            const t = clamp(((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
            const q = [ax + dx * t, ay + dy * t];
            const d = dist(p, q);
            if (d < bd && d < o.hw + s.hw + 10 && d > 0.5) { bd = d; best = q; }
          }
        }
        target = best;
      }
      if (!target || dist(p, target) < 1) continue;
      const q = [r1(target[0]), r1(target[1])];
      if (end) pts.push(q); else pts.unshift(q);
    }
  }

  // Jezera v dokumentu: skupiny tahů vody, obálka = elipsa (střed, poloosy).
  function lakes() {
    const by = new Map();
    for (const s of doc.water) {
      if (!s.g) continue;
      const b = by.get(s.g) || { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (const [x, y] of s.pts) { b.x0 = Math.min(b.x0, x - s.hw); b.x1 = Math.max(b.x1, x + s.hw); b.y0 = Math.min(b.y0, y - s.hw); b.y1 = Math.max(b.y1, y + s.hw); }
      by.set(s.g, b);
    }
    return [...by.entries()].map(([g0, b]) => ({ g: g0, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, rx: (b.x1 - b.x0) / 2, ry: (b.y1 - b.y0) / 2 }));
  }

  /* Ovál jezera jako řádky tahů vody (stejně jako tools/genmaps.js): středy řádků leží na elipse zmenšené o hw,
   * obálka je hladká elipsa rx × ry, uprostřed hluboko, u břehu mělko; břeh se jemně vlní. */
  function lakeStrokes(cx, cy, rx, ry, gid) {
    const out = [];
    const ph1 = rnd() * 6.28;
    const ph2 = rnd() * 6.28;
    const wobble = 0.1;
    const hw = Math.max(3, Math.min(20, rx * 0.8, ry * 0.8));
    const ix = Math.max(0.5, rx - hw);
    const iy = Math.max(0, ry - hw);
    const rows = Math.max(3, Math.ceil((2 * iy) / (hw * 0.5)) + 1);
    for (let k = 0; k < rows; k++) {
      const dy = -iy + (2 * iy * k) / (rows - 1);
      const t = dy / Math.max(1, iy);
      const half = Math.max(0.5, ix * Math.sqrt(Math.max(0, 1 - t * t)) * (1 + wobble * (Math.sin(t * 2.7 + ph1) * 0.7 + Math.sin(t * 5.3 + ph2) * 0.3)));
      const ox = ix * wobble * 0.5 * Math.sin(t * 1.9 + ph2);
      out.push({ pts: [[r1(cx - half + ox), r1(cy + dy)], [r1(cx + half + ox), r1(cy + dy)]], hw: r1(hw), g: gid });
    }
    return out;
  }

  function placeLake(a, b) {
    const cx = (a[0] + b[0]) / 2;
    const cy = (a[1] + b[1]) / 2;
    const rx = Math.abs(b[0] - a[0]) / 2;
    const ry = Math.abs(b[1] - a[1]) / 2;
    if (rx < 8 || ry < 6) return say("Jezero je moc malé. Táhni větší ovál.", "error");
    const centres = orbit(cx, cy, W(), H(), 4);
    const made = [];
    for (const [x, y] of centres) {
      // otočené dvojče (✣) má prohozené poloosy
      const turned = $("e-m4").checked && Math.abs((x - W() / 2) * (cy - H() / 2) - (y - H() / 2) * (cx - W() / 2)) > 1 && Math.abs(x - (W() - cx)) > 1 && Math.abs(y - (H() - cy)) > 1;
      made.push(...lakeStrokes(x, y, turned ? ry : rx, turned ? rx : ry, groupSeq++));
    }
    if (doc.water.length + made.length > DOC.MAX_WATER) return say(`Víc vody se nevejde (nejvýše ${DOC.MAX_WATER} tahů).`, "error");
    doc.water.push(...made);
  }

  /* ---------- guma ---------- */
  function eraseAt(p) {
    const what = $("o-erase").value;
    const radius = prefs.size.erase || 20;
    const sq = prefs.shape === "square";
    const hitA = (x, y) => (sq ? Math.max(Math.abs(x - p[0]), Math.abs(y - p[1])) : Math.hypot(x - p[0], y - p[1])) < radius;
    const on = layer => visible(layer) && (what === "all" || what === layer);
    for (const c of orbit(p[0], p[1], W(), H())) {
      const hit = (x, y) => (sq ? Math.max(Math.abs(x - c[0]), Math.abs(y - c[1])) : Math.hypot(x - c[0], y - c[1])) < radius;
      for (const [kind, P] of Object.entries(POINTS)) {
        if (!on(P.layer) || !doc[P.key]) continue;
        if (kind === "base") {
          for (let i = doc.bases.length - 1; i >= 0; i--) if (hit(doc.bases[i].x / 2, doc.bases[i].y / 2)) { doc.bases.splice(i, 1); fixAfterBaseRemoval(i); layoutCache = null; }
        } else doc[P.key] = doc[P.key].filter(o => { const [x, y] = ppos(kind, o); return !hit(x / 2, y / 2); });
      }
      for (const [kind, C0] of Object.entries(CIRCLES)) if (on(C0.layer) && doc[C0.key]) doc[C0.key] = doc[C0.key].filter(o => { const [x, y] = cpos(kind, o); return !hit(x, y); });
      if (on("terrain")) {
        for (const S of Object.values(STROKES)) doc[S.key] = doc[S.key].filter(s => segDist(c, s.pts) >= radius + s[S.w]);
      }
    }
    void hitA;
  }

  /* ---------- výběr, schránka ---------- */
  const isSel = o => selection.some(s => s.o === o);

  function selectRect(a, b, add) {
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
    const inR = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
    const out = add ? [...selection] : [];
    const push = (key, o) => { if (!out.some(s => s.o === o)) out.push({ key, o }); };
    for (const [kind, P] of Object.entries(POINTS)) if (visible(P.layer)) for (const o of doc[P.key] || []) { const [x, y] = ppos(kind, o); if (inR(x / 2, y / 2)) push(P.key, o); }
    for (const [kind, C0] of Object.entries(CIRCLES)) if (visible(C0.layer)) for (const o of doc[C0.key] || []) { const [x, y] = cpos(kind, o); if (inR(x, y)) push(C0.key, o); }
    if (visible("terrain")) for (const S of Object.values(STROKES)) for (const s of doc[S.key]) if (s.pts.every(([x, y]) => inR(x, y))) push(S.key, s);
    selection = out;
    renderSelbar();
  }

  function selectAll() {
    selectRect([-1e9, -1e9], [1e9, 1e9], false);
    say(`Vybráno objektů: ${selection.length}.`);
  }

  function selBounds(sel = selection) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (x, y, r = 0) => { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); };
    for (const { key, o } of sel) {
      const kind = KIND_OF_KEY[key];
      if (POINTS[kind]) { const [x, y] = ppos(kind, o); grow(x / 2, y / 2, 4); } else if (CIRCLES[kind]) { const [x, y, r] = cpos(kind, o); grow(x, y, r); } else for (const [x, y] of o.pts) grow(x, y, o.hw || o.w || 0);
    }
    return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }

  // Posun objektu o dx, dy (art px); body zůstávají na mapě.
  function shift(key, o, dx, dy) {
    const kind = KIND_OF_KEY[key];
    if (POINTS[kind]) { const [x, y] = ppos(kind, o); pset(kind, o, Math.round(clamp(x + dx * 2, 0, LW())), Math.round(clamp(y + dy * 2, 0, LH()))); } else if (CIRCLES[kind]) {
      const off = CIRCLES[kind].off;
      o[off] = Math.round(clamp(o[off] + dx, 0, W()));
      o[off + 1] = Math.round(clamp(o[off + 1] + dy, 0, H()));
    } else o.pts = o.pts.map(([x, y]) => [r1(clamp(x + dx, 0, W())), r1(clamp(y + dy, 0, H()))]);
  }

  // Převrácení výběru kolem jeho středu (fx/fy = -1 převrátí osu).
  function flipSel(fx, fy) {
    const b = selBounds();
    mutate(() => {
      for (const { key, o } of selection) {
        const kind = KIND_OF_KEY[key];
        const tf = (x, y) => [b.cx + (x - b.cx) * fx, b.cy + (y - b.cy) * fy];
        if (POINTS[kind]) { const [x, y] = ppos(kind, o); const [nx, ny] = tf(x / 2, y / 2); pset(kind, o, Math.round(nx * 2), Math.round(ny * 2)); } else if (CIRCLES[kind]) {
          const off = CIRCLES[kind].off;
          [o[off], o[off + 1]] = tf(o[off], o[off + 1]).map(Math.round);
        } else o.pts = o.pts.map(([x, y]) => tf(x, y).map(r1));
      }
    });
  }

  function copySel() {
    if (!selection.length) return say("Nic není vybráno.", "error");
    const b = selBounds();
    clipboard = { cx: b.cx, cy: b.cy, items: selection.map(({ key, o }) => ({ key, o: JSON.parse(JSON.stringify(o)) })) };
    say(`Zkopírováno objektů: ${clipboard.items.length}. Ctrl+V je vloží.`, "ok");
  }

  function deleteSel() {
    if (!selection.length) return;
    const sel = selection;
    mutate(() => {
      // základny od konce, ať sedí přečíslování jednotek
      const bases = sel.filter(s => s.key === "bases").map(s => doc.bases.indexOf(s.o)).sort((a, b) => b - a);
      for (const s of sel) if (s.key !== "bases") removeRef(s);
      for (const i of bases) { doc.bases.splice(i, 1); fixAfterBaseRemoval(i); }
    });
    say(`Smazáno objektů: ${sel.length}.`);
    selection = [];
    renderSelbar();
  }

  function startPaste() {
    if (!clipboard) return say("Schránka je prázdná. Vyber objekty a stiskni Ctrl+C.", "error");
    pasting = true;
    $("e-pastebar").hidden = false;
    scheduleDraw();
  }

  // Vloží schránku se středem v bodě p (art px). Jednotky a budovy dostanou nejbližší základnu.
  function pasteAt(p, items = clipboard.items, cx = clipboard.cx, cy = clipboard.cy) {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const made = [];
    let lakeMap = new Map();
    mutate(() => {
      for (const { key, o } of items) {
        const n = JSON.parse(JSON.stringify(o));
        const kind = KIND_OF_KEY[key];
        const arr = list(key);
        if (arr.length >= (DOC[MAX_OF[key] || STROKES[kind] && STROKES[kind].max] || 1e9)) continue;
        if (n.g) { if (!lakeMap.has(n.g)) lakeMap.set(n.g, groupSeq++); n.g = lakeMap.get(n.g); }
        shift(key, n, dx, dy);
        if (key === "units" || key === "buildings") { const b = nearestBase(n[2], n[3]); if (b < 0) continue; n[1] = b; }
        if (key === "bases" && doc.bases.some(b => Math.hypot(b.x - n.x, b.y - n.y) < 300)) continue;
        arr.push(n);
        made.push({ key, o: n });
      }
      layoutCache = null;
    });
    selection = made;
    renderSelbar();
    return made.length;
  }

  function duplicateSel() {
    if (!selection.length) return;
    const b = selBounds();
    const items = selection.map(({ key, o }) => ({ key, o }));
    const n = pasteAt([b.cx + 20, b.cy + 20], items, b.cx, b.cy);
    say(`Duplikováno objektů: ${n}.`, "ok");
  }

  function renderSelbar() {
    const bar = $("e-selbar");
    bar.hidden = !selection.length || tool !== "select";
    $("e-selcount").textContent = `${T("Vybráno")}: ${selection.length}`;
    showCoords();
    scheduleDraw();
  }

  $("e-selbar").addEventListener("click", ev => {
    const b = ev.target.closest("button[data-sel]");
    if (!b) return;
    const a = b.dataset.sel;
    if (a === "copy") copySel();
    else if (a === "dup") duplicateSel();
    else if (a === "flipx") flipSel(-1, 1);
    else if (a === "flipy") flipSel(1, -1);
    else if (a === "delete") deleteSel();
  });

  /* ---------- kreslení položkou palety ---------- */
  const modeOf = it => (it ? prefs.mode[it.id] && it.modes.includes(prefs.mode[it.id]) ? prefs.mode[it.id] : it.defaultMode || it.modes[0] : "point");
  const sizeOf = it => (it && it.size ? clamp(prefs.size[it.id] || it.size[3], it.size[1], it.size[2]) : 0);

  // Štětec bodových objektů: počet podle plochy a hustoty.
  function sprayAt(it, p) {
    const radius = sizeOf(it);
    const sq = prefs.shape === "square";
    const sp = spacingOf(it) / 2; // art px
    const area = sq ? 4 * radius * radius : Math.PI * radius * radius;
    const count = clamp(Math.round(area / (sp * sp * 3.2)), 1, 30);
    const cands = [];
    for (let k = 0; k < count * 4; k++) {
      let x, y;
      if (sq) { x = p[0] + (rnd() * 2 - 1) * radius; y = p[1] + (rnd() * 2 - 1) * radius; } else {
        const a = rnd() * Math.PI * 2;
        const d = Math.sqrt(rnd()) * radius;
        x = p[0] + Math.cos(a) * d;
        y = p[1] + Math.sin(a) * d;
      }
      cands.push([x * 2, y * 2]);
    }
    return scatterPoints(it, cands, count);
  }

  function lineCands(a, b, step) {
    const len = dist(a, b);
    const n = Math.max(1, Math.floor(len / step));
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = n ? i / n : 0;
      out.push([(a[0] + (b[0] - a[0]) * t) * 2, (a[1] + (b[1] - a[1]) * t) * 2]);
    }
    return out;
  }

  function circlesInCells(it, f) {
    const r = sizeOf(it);
    const step = Math.max(8, r * 1.1);
    const pts = [];
    const { cells, gw, C4 } = f;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of cells) { const x = (c % gw) * C4, y = Math.floor(c / gw) * C4; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) {
      const c = Math.floor(y / C4) * gw + Math.floor(x / C4);
      if (cells.has(c)) pts.push([x, y]);
    }
    return pts;
  }

  // Dokončení tvaru (čára, obdélník, výplň, ovál) po puštění tlačítka.
  function finishShape(it, mode, a, b) {
    const kind = it.kind;
    if (kind === "lake") return placeLake(a, b);
    if (STROKES[kind]) return;
    if (CIRCLES[kind]) {
      const r = sizeOf(it);
      let pts = [];
      if (mode === "rect") {
        const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
        const step = Math.max(8, r * 1.1);
        for (let y = y0 + Math.min(step, y1 - y0) / 2; y <= y1; y += step) for (let x = x0 + Math.min(step, x1 - x0) / 2; x <= x1; x += step) pts.push([x, y]);
      } else if (mode === "fill") {
        const f = floodLand(a);
        if (!f) return say("Výplň začni na souši nebo na vodě, ne na skále či cestě.", "error");
        pts = circlesInCells(it, f);
      }
      let problem = "";
      for (const [x, y] of pts) { problem = placeCircle(it, x, y, r); if (problem) break; }
      if (problem) say(problem, "error");
      else if (pts.length) say(`Přidáno oblastí: ${pts.length}.`, "ok");
      return;
    }
    // bodové objekty
    const step = spacingOf(it) / 2;
    let res;
    if (mode === "line") res = scatterPoints(it, lineCands(a, b, step), 1e9);
    else if (mode === "rect") {
      const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
      res = scatterPoints(it, gridCands(x0, y0, x1, y1, step * 1.15), 1e9);
    } else if (mode === "fill") {
      const f = floodLand(a);
      if (!f) return say("Výplň začni na souši (nebo na vodě pro kachny a lekníny).", "error");
      const { cells, gw, C4 } = f;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const c of cells) { const x = (c % gw) * C4, y = Math.floor(c / gw) * C4; x0 = Math.min(x0, x); x1 = Math.max(x1, x + C4); y0 = Math.min(y0, y); y1 = Math.max(y1, y + C4); }
      res = scatterPoints(it, gridCands(x0, y0, x1, y1, step * 1.3, (x, y) => cells.has(Math.floor(y / C4) * gw + Math.floor(x / C4))), 1e9);
    }
    if (res) {
      if (res.placed) say(`Přidáno: ${res.placed}.`, "ok");
      else say(res.last || "Nic se nevešlo.", "error");
    }
  }

  /* ---------- ovládání myší a dotykem ---------- */
  function updateCursor(p) {
    let cursor = "crosshair";
    if (pan) cursor = "grabbing";
    else if (spaceDown || tool === "hand") cursor = "grab";
    else if (tool === "select") cursor = p && (pickAt(p) || pickStroke(p)) && isSel((pickAt(p) || pickStroke(p)).o) ? "move" : "default";
    else if (tool === "pick") cursor = "copy";
    canvas.style.cursor = cursor;
  }

  function startPan(ev) {
    pan = { x: ev.clientX, y: ev.clientY, cx: cam.x, cy: cam.y };
    updateCursor(hover);
  }

  function pointerDown(ev) {
    closePopup();
    const p0 = eventPoint(ev);
    const p = snapArt(p0);
    if (ev.button === 1 || spaceDown || tool === "hand") return startPan(ev);
    if (ev.button !== 0) return;

    if (pasting) {
      const n = pasteAt(p);
      pasting = ev.shiftKey; // se Shiftem lze vkládat opakovaně
      $("e-pastebar").hidden = !pasting;
      say(`Vloženo objektů: ${n}.`, "ok");
      return;
    }

    if (tool === "pick") {
      const hit = pickAny(p0);
      if (!hit) return say("Tady nic není.");
      const id = idOfRef(hit);
      if (id && PAL.get(id)) { setItem(PAL.get(id)); setTool("draw"); say(`Vybráno z mapy: ${T(PAL.get(id).label)}.`, "ok"); }
      return;
    }

    drag = { kind: "none", before: snapshot(), remembered: false, start: p, last: p };

    if (tool === "select") {
      const hit = pickAt(p0) || pickStroke(p0) || pickCircle(p0);
      if (hit && !isSel(hit.o)) { selection = ev.shiftKey ? [...selection, { key: hit.key, o: hit.o }] : hit.key === "water" && hit.o.g ? lakeOf(hit.o).map(o => ({ key: "water", o })) : [{ key: hit.key, o: hit.o }]; renderSelbar(); }
      if (hit) { drag.kind = "move"; drag.from = p; return; }
      drag.kind = "marquee";
      if (!ev.shiftKey) { selection = []; renderSelbar(); }
      return;
    }

    if (tool === "erase") {
      drag.kind = "erase";
      eraseAt(p);
      touched();
      changed();
      return;
    }

    if (!item) return say("Vyber položku v paletě.", "error");
    const mode = modeOf(item);
    drag.item = item;
    drag.mode = mode;

    if (STROKES[item.kind]) {
      drag.kind = "stroke";
      beginStroke(item, p);
      if (!drag.strokes) { drag = null; return; }
    } else if (item.kind === "lake" || mode === "line" || mode === "rect") {
      drag.kind = "shape";
    } else if (mode === "fill") {
      drag.kind = "none";
      finishShape(item, "fill", p, p);
    } else if (CIRCLES[item.kind]) {
      drag.kind = mode === "brush" ? "dab" : "none";
      const problem = placeCircle(item, p[0], p[1], sizeOf(item));
      if (problem) say(problem, "error");
    } else if (mode === "brush") {
      drag.kind = "spray";
      const r = sprayAt(item, p);
      if (!r.placed && r.last && r.last !== "max") say(r.last, "error");
    } else {
      // jednotlivě: klik do existujícího objektu stejného druhu ho posune
      const hit = pickAt(p0, [item.kind]);
      if (hit && item.kind !== "unit" && item.kind !== "critter" && item.kind !== "prop") { drag.kind = "move"; drag.from = p; selection = [{ key: hit.key, o: hit.o }]; } else {
        const problem = placePoint(item, Math.round(p[0] * 2), Math.round(p[1] * 2));
        if (problem) say(problem, "error");
      }
    }
    touched();
    changed();
  }

  function pointerMove(ev) {
    const p0 = eventPoint(ev);
    const p = snapArt(p0);
    hover = p;
    scheduleDraw();
    showCoords();
    if (pan) {
      cam.x = pan.cx - (ev.clientX - pan.x) / zoom;
      cam.y = pan.cy - (ev.clientY - pan.y) / zoom;
      clampCam();
      return;
    }
    if (!drag) return updateCursor(p0);
    if (!(ev.buttons & 1) && ev.pointerType === "mouse") return;
    if (drag.kind === "stroke") {
      if (drag.mode === "brush") extendStroke(p);
      else shapeStroke(p);
    } else if (drag.kind === "move") {
      const dx = p[0] - drag.from[0];
      const dy = p[1] - drag.from[1];
      if (!dx && !dy) return;
      for (const s of selection) shift(s.key, s.o, dx, dy);
      drag.from = p;
      layoutCache = null;
    } else if (drag.kind === "spray") {
      if (dist(p, drag.last) < Math.max(2, sizeOf(item) * 0.35)) return;
      sprayAt(item, p);
      drag.last = p;
    } else if (drag.kind === "dab") {
      if (dist(p, drag.last) < sizeOf(item) * 0.55) return;
      const problem = placeCircle(item, p[0], p[1], sizeOf(item));
      if (problem) say(problem, "error");
      drag.last = p;
    } else if (drag.kind === "erase") {
      eraseAt(p);
    } else if (drag.kind === "shape" || drag.kind === "marquee") {
      drag.last = p;
      return;
    } else return;
    touched();
    changed();
  }

  function endDrag(ev) {
    if (pan) { pan = null; updateCursor(hover); }
    if (!drag) return;
    const d = drag;
    if (d.kind === "stroke") finishStroke();
    else if (d.kind === "shape") finishShape(d.item, d.item.kind === "lake" ? "ellipse" : d.mode, d.start, d.last);
    else if (d.kind === "marquee") selectRect(d.start, d.last, ev && ev.shiftKey);
    touched();
    drag = null;
    changed();
  }

  // Změna uvnitř táhnutí se do historie zapíše jednou, při první skutečné změně dokumentu.
  function touched() {
    if (drag && !drag.remembered && snapshot() !== drag.before) {
      remember(drag.before);
      drag.remembered = true;
    }
  }

  canvas.addEventListener("pointerdown", ev => {
    ev.preventDefault();
    canvas.setPointerCapture(ev.pointerId);
    if (ev.pointerType === "touch") {
      touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (touches.size === 2) {
        // druhý prst: zrušit rozdělaný tah (vrátit dokument) a začít sevření
        clearTimeout(longPress);
        if (drag) { if (drag.remembered) { undo.pop(); doc = JSON.parse(drag.before); renderHistory(); changed(); } drag = null; }
        const [a, b] = [...touches.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, zoom, cx: cam.x, cy: cam.y };
        return;
      }
      if (touches.size > 2) return;
      // dlouhý stisk = nabídka jako pravé tlačítko
      clearTimeout(longPress);
      const cx = ev.clientX, cy = ev.clientY;
      longPress = setTimeout(() => {
        if (drag && drag.remembered) { undo.pop(); doc = JSON.parse(drag.before); renderHistory(); changed(); }
        drag = null;
        contextMenu(cx, cy);
      }, 550);
    }
    if (ev.button === 2) return;
    pointerDown(ev);
  });

  canvas.addEventListener("pointermove", ev => {
    if (ev.pointerType === "touch" && touches.has(ev.pointerId)) {
      const t = touches.get(ev.pointerId);
      if (Math.hypot(ev.clientX - t.x, ev.clientY - t.y) > 8) clearTimeout(longPress);
      touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, moved: true });
      if (pinch && touches.size === 2) {
        const [a, b] = [...touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const box = canvas.getBoundingClientRect();
        const ax = pinch.cx + (pinch.mx - box.left) / pinch.zoom;
        const ay = pinch.cy + (pinch.my - box.top) / pinch.zoom;
        zoom = clamp(pinch.zoom * d / Math.max(10, pinch.d), MIN_ZOOM, MAX_ZOOM);
        cam.x = ax - (mx - box.left) / zoom;
        cam.y = ay - (my - box.top) / zoom;
        clampCam();
        scheduleDraw();
        return;
      }
    }
    pointerMove(ev);
  });

  const pointerEnd = ev => {
    clearTimeout(longPress);
    if (ev.pointerType === "touch") {
      touches.delete(ev.pointerId);
      if (pinch) { if (touches.size < 2) pinch = null; drag = null; return; }
    }
    endDrag(ev);
  };
  canvas.addEventListener("pointerup", pointerEnd);
  canvas.addEventListener("pointercancel", pointerEnd);
  canvas.addEventListener("pointerleave", () => { hover = null; scheduleDraw(); showCoords(); });

  canvas.addEventListener("wheel", ev => {
    ev.preventDefault();
    const box = canvas.getBoundingClientRect();
    if (ev.ctrlKey || Math.abs(ev.deltaY) >= Math.abs(ev.deltaX)) zoomAt(Math.exp(-clamp(ev.deltaY, -200, 200) * 0.0016), ev.clientX - box.left, ev.clientY - box.top);
    else panBy(ev.deltaX, 0);
  }, { passive: false });

  /* ---------- nabídky ---------- */
  function openPopup(items, x, y, owner = null) {
    closePopup();
    popup.replaceChildren(...items.map(it => {
      if (it === "-") { const sep = document.createElement("div"); sep.className = "sep"; return sep; }
      if (it.head) { const head = document.createElement("div"); head.className = "head"; head.textContent = it.head; return head; }
      const b = document.createElement("button");
      b.type = "button";
      b.className = "item";
      b.disabled = !!it.disabled;
      const label = document.createElement("span");
      label.textContent = `${it.checked ? "✓ " : it.checked === false ? " " : ""}${it.label}`;
      if (it.color) { const dot = document.createElement("i"); dot.className = "dot"; dot.style.background = it.color; label.prepend(dot); }
      b.append(label);
      if (it.hint) { const kbd = document.createElement("kbd"); kbd.textContent = it.hint; b.append(kbd); }
      b.addEventListener("click", () => { closePopup(); it.run(); });
      return b;
    }));
    popup.hidden = false;
    const box = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(4, Math.min(x, window.innerWidth - box.width - 4))}px`;
    popup.style.top = `${Math.max(4, Math.min(y, window.innerHeight - box.height - 4))}px`;
    popupOwner = owner;
    if (owner) owner.classList.add("open");
  }

  function closePopup() {
    popup.hidden = true;
    if (popupOwner) popupOwner.classList.remove("open");
    popupOwner = null;
  }

  document.addEventListener("pointerdown", ev => {
    if (!popup.hidden && !popup.contains(ev.target) && ev.target !== popupOwner) closePopup();
  }, true);
  window.addEventListener("blur", closePopup);

  const MENUS = {
    file: () => [
      { label: "Nová mapa…", run: newMap },
      { label: "Otevřít…", hint: "Ctrl+O", run: openDialog },
      "-",
      { label: "Uložit", hint: "Ctrl+S", run: () => save() },
      { label: "Uložit jako…", run: () => openProps("saveas") },
      "-",
      { label: "Vyzkoušet proti AI", hint: "F5", run: testPlay },
      { label: "Vlastnosti mapy…", run: () => openProps("props") },
      "-",
      { label: "Stáhnout JSON", run: download },
      { label: "Importovat ze souboru…", run: () => $("e-file").click() },
      { label: "Stáhnout obrázek mapy (PNG)", run: () => exportPng(false) },
      { label: "Stáhnout náhled pro lobby (PNG)", run: () => exportPng(true) },
      "-",
      { label: "Smazat ze serveru…", disabled: !canEdit || !serverMaps.some(m => m.id === savedId), run: () => deleteMap(savedId) }
    ],
    edit: () => [
      { label: "Zpět", hint: "Ctrl+Z", disabled: !undo.length, run: () => stepHistory(undo, redo) },
      { label: "Znovu", hint: "Ctrl+Shift+Z", disabled: !redo.length, run: () => stepHistory(redo, undo) },
      "-",
      { label: "Vybrat vše", hint: "Ctrl+A", run: () => { setTool("select"); selectAll(); } },
      { label: "Kopírovat", hint: "Ctrl+C", disabled: !selection.length, run: copySel },
      { label: "Vložit", hint: "Ctrl+V", disabled: !clipboard, run: startPaste },
      { label: "Duplikovat", hint: "Ctrl+D", disabled: !selection.length, run: duplicateSel },
      { label: "Smazat výběr", hint: "Delete", disabled: !selection.length, run: deleteSel },
      "-",
      { label: "Zrcadlit levou polovinu doprava", run: () => mirrorHalf("x") },
      { label: "Zrcadlit horní polovinu dolů", run: () => mirrorHalf("y") },
      { label: "Otočit polovinu o 180°", run: () => mirrorHalf("r") }
    ],
    map: () => [
      { label: "Vlastnosti a překlady…", run: () => openProps("props") },
      { label: "Rozmístit základny…", run: openPlayers },
      { label: "Doplnit doly základnám", run: fillMines },
      "-",
      { label: "Nové zrno terénu", run: () => mutate(() => { doc.seed = Math.floor(Math.random() * 1000000); }) },
      { head: "Krajina" },
      ...MAPS.THEMES.map(t => ({ label: T(MAPS.THEME_NAMES[t]), checked: (doc.theme || "meadow") === t, run: () => mutate(() => setTheme(doc, t)) })),
      "-",
      { label: "Odstranit stromy z vody", run: () => cleanWet() },
      { label: "Smazat všechny kulisy", disabled: !(doc.props && doc.props.length), run: () => mutate(() => { delete doc.props; }) },
      { label: "Smazat všechna zvířata", disabled: !(doc.critters && doc.critters.length), run: () => mutate(() => { delete doc.critters; }) },
      { label: "Smazat druhy půdy", disabled: !(doc.ground && doc.ground.length), run: () => mutate(() => { delete doc.ground; }) }
    ],
    view: () => [
      { label: "Přiblížit", hint: "+", run: () => zoomTo(zoom * 1.5) },
      { label: "Oddálit", hint: "−", run: () => zoomTo(zoom / 1.5) },
      { label: "Celá mapa", hint: "0", run: () => { fitView(); scheduleDraw(); showCoords(); } },
      { label: "Měřítko 100 %", hint: "1", run: () => zoomTo(1) },
      { label: "Měřítko jako ve hře (200 %)", hint: "2", run: () => zoomTo(2) },
      "-",
      { label: "Skutečný vzhled", checked: view.real, hint: "Shift+R", run: toggleReal },
      { label: "Obnovit skutečný vzhled", disabled: !view.real, run: bake },
      { label: "Mřížka", checked: view.grid, hint: "G", run: () => { $("e-grid").checked = !$("e-grid").checked; view.grid = $("e-grid").checked; scheduleDraw(); } },
      { label: "Přichytit k mřížce", checked: $("e-snap").checked, run: () => { $("e-snap").checked = !$("e-snap").checked; } },
      "-",
      ...LAYERS.map(([id, label]) => ({ label: T(label), checked: visible(id), run: () => toggleLayer(id) }))
    ]
  };

  function openMenu(btn) {
    const box = btn.getBoundingClientRect();
    openPopup(MENUS[btn.dataset.menu](), box.left, box.bottom + 2, btn);
  }

  $("e-menus").addEventListener("click", ev => {
    const btn = ev.target.closest("button[data-menu]");
    if (!btn) return;
    if (popupOwner === btn) closePopup();
    else openMenu(btn);
  });

  $("e-menus").addEventListener("pointerover", ev => {
    const btn = ev.target.closest("button[data-menu]");
    if (btn && popupOwner && popupOwner !== btn && popupOwner.dataset.menu) openMenu(btn);
  });

  // id položky palety k objektu z mapy (kapátko, "nahradit")
  function idOfRef(ref) {
    const o = ref.o;
    switch (ref.kind) {
      case "tree": return `tree:${o.length > 2 ? o[2] : "mix"}`;
      case "prop": return `prop:${o[0]}`;
      case "critter": return `critter:${o[0]}`;
      case "unit": return `unit:${o[0]}`;
      case "building": return `building:${o[0]}`;
      case "base": return "base";
      case "gold": return "gold";
      case "ground": return `ground:${o[0]}`;
      case "theme": return `theme:${o[0]}`;
      case "ash": return "ash";
      case "water": return o.g ? "lake" : "water";
      case "road": return o.main ? "roadMain" : "road";
      default: return ref.kind;
    }
  }

  function contextMenu(cx, cy) {
    const p = screenToArt(cx, cy);
    const hit = pickAt(p);
    const stroke = hit ? null : pickStroke(p);
    const circ = hit || stroke ? null : pickCircle(p);
    const items = [];
    const name = ref => T((PAL.get(idOfRef(ref)) || { label: ref.kind }).label);
    const replaceable = ref => item && item.kind === ref.kind && idOfRef(ref) !== item.id;

    if (selection.length > 1 && hit && isSel(hit.o)) {
      items.push({ head: `${T("Výběr")}: ${selection.length}` }, { label: "Kopírovat", run: copySel }, { label: "Duplikovat", run: duplicateSel },
        { label: "Převrátit ↔", run: () => flipSel(-1, 1) }, { label: "Převrátit ↕", run: () => flipSel(1, -1) }, { label: "Smazat výběr", run: deleteSel }, "-");
    }

    if (hit && hit.kind === "base") {
      const i = doc.bases.indexOf(hit.o);
      items.push({ head: `${T("Základna")} ${i + 1} · ${T(R.TEAM_NAMES[teamOf(i)])}` },
        { label: "Nemrtví (AI) na této základně", checked: undeadBase(i), run: () => mutate(() => { if (undeadBase(i)) delete doc.coop; else doc.coop = { ai: i, faction: "undead" }; }) },
        { label: "Moje základna při zkoušce", checked: prefs.testSlot === i, run: () => { prefs.testSlot = i; savePrefs(); } },
        { label: "Smazat základnu", run: () => mutate(() => removeRef(hit)) });
    } else if (hit && hit.kind === "gold") {
      const m = hit.o;
      const amount = m[2] || R.GOLD_AMOUNT;
      items.push({ head: "Zlatý důl · zásoba" });
      for (const v of [1000, 2000, 4000, 8000]) items.push({ label: v.toLocaleString("cs"), checked: amount === v, run: () => mutate(() => { m.length = 2; if (v !== R.GOLD_AMOUNT) m.push(v); }) });
      items.push("-", { label: "Smazat důl", run: () => mutate(() => removeRef(hit)) });
    } else if (hit && (hit.kind === "unit" || hit.kind === "building")) {
      items.push({ head: name(hit) });
      doc.bases.forEach((b, i) => items.push({ label: `${T("Základna")} ${i + 1}`, color: teamCss(i), checked: hit.o[1] === i, run: () => mutate(() => { hit.o[1] = i; }) }));
      if (replaceable(hit)) items.push("-", { label: `${T("Nahradit")}: ${T(item.label)}`, run: () => mutate(() => { hit.o[0] = item.value; }) });
      items.push("-", { label: "Smazat", run: () => mutate(() => removeRef(hit)) });
    } else if (hit && hit.kind === "tree") {
      items.push({ head: name(hit) });
      PAL.TREES.forEach((label, k) => items.push({ label: T(label), checked: hit.o[2] === k, run: () => mutate(() => { hit.o.length = 2; hit.o.push(k); }) }));
      items.push({ label: "Podle krajiny", checked: hit.o.length < 3, run: () => mutate(() => { hit.o.length = 2; }) });
      items.push("-", { label: "Smazat strom", run: () => mutate(() => removeRef(hit)) });
    } else if (hit) {
      items.push({ head: name(hit) });
      if (replaceable(hit)) items.push({ label: `${T("Nahradit")}: ${T(item.label)}`, run: () => mutate(() => { hit.o[0] = item.value; }) });
      items.push({ label: "Smazat", run: () => mutate(() => removeRef(hit)) });
    } else if (stroke && stroke.kind === "road") {
      items.push({ head: "Cesta" }, { label: "Hlavní cesta (most a brána)", checked: !!stroke.o.main, run: () => mutate(() => { stroke.o.main = !stroke.o.main; }) },
        { label: "Smazat cestu", run: () => mutate(() => removeRef(stroke)) });
    } else if (stroke && stroke.kind === "water" && stroke.o.g) {
      items.push({ head: "Jezero" }, { label: "Smazat jezero", run: () => mutate(() => { doc.water = doc.water.filter(s => s.g !== stroke.o.g); }) });
    } else if (stroke) {
      items.push({ head: name(stroke) }, { label: "Smazat tah", run: () => mutate(() => removeRef(stroke)) });
    } else if (circ) {
      items.push({ head: name(circ) });
      if (replaceable(circ) && circ.kind !== "ash") items.push({ label: `${T("Nahradit")}: ${T(item.label)}`, run: () => mutate(() => { circ.o[0] = item.value; }) });
      items.push({ label: "Smazat oblast", run: () => mutate(() => removeRef(circ)) });
    }

    if (items.length) items.push("-");
    items.push({ head: "Přidat sem" },
      { label: "Základnu", run: () => { const e = placePoint(PAL.get("base"), Math.round(p[0] * 2), Math.round(p[1] * 2)); if (e) say(e, "error"); else { remember(snapshot()); changed(); } } },
      { label: "Zlatý důl", run: () => mutate(() => { const e = placePoint(PAL.get("gold"), Math.round(p[0] * 2), Math.round(p[1] * 2)); if (e) say(e, "error"); }) });
    if (clipboard) items.push({ label: "Vložit schránku", run: () => pasteAt(p) });
    items.push("-", { label: "Vycentrovat pohled sem", run: () => centerOn(p) });
    openPopup(items, cx, cy);
  }

  canvas.addEventListener("contextmenu", ev => {
    ev.preventDefault();
    if (ev.pointerType === "touch") return;
    contextMenu(ev.clientX, ev.clientY);
  });

  /* ---------- hromadné úpravy ---------- */
  // Zkopíruje polovinu mapy na druhou stranu (osou nebo otočením) a tu druhou přepíše.
  function mirrorHalf(axis) {
    const w = W(), h = H();
    const keep = axis === "y" ? (x, y) => y <= h / 2 : (x, y) => x <= w / 2;
    const tf = axis === "x" ? (x, y) => [w - x, y] : axis === "y" ? (x, y) => [x, h - y] : (x, y) => [w - x, h - y];
    mutate(() => {
      for (const [kind, P] of Object.entries(POINTS)) {
        if (!doc[P.key]) continue;
        const src = doc[P.key].filter(o => { const [x, y] = ppos(kind, o); return keep(x / 2, y / 2); });
        const copies = src.map(o => {
          const n = JSON.parse(JSON.stringify(o));
          const [x, y] = ppos(kind, o);
          const [nx, ny] = tf(x / 2, y / 2);
          pset(kind, n, Math.round(nx * 2), Math.round(ny * 2));
          return n;
        }).filter(n => { const [x, y] = ppos(kind, n); return !keep(x / 2, y / 2) || (kind !== "base" && kind !== "gold"); });
        if (kind === "base") {
          const old = doc.bases.length;
          const kept = doc.bases.filter(o => keep(o.x / 2, o.y / 2));
          // jednotky a budovy smazaných základen se přesunou k zachovaným/novým
          doc.bases = [...kept, ...copies.filter(n => !kept.some(b => Math.hypot(b.x - n.x, b.y - n.y) < 150))];
          void old;
        } else doc[P.key] = [...src, ...copies];
      }
      for (const key of ["units", "buildings"]) if (doc[key]) for (const u of doc[key]) u[1] = Math.max(0, nearestBase(u[2], u[3]));
      if (doc.coop && doc.coop.ai >= doc.bases.length) delete doc.coop;
      for (const [kind, C0] of Object.entries(CIRCLES)) {
        if (!doc[C0.key]) continue;
        const src = doc[C0.key].filter(o => { const [x, y] = cpos(kind, o); return keep(x, y); });
        doc[C0.key] = [...src, ...src.map(o => { const n = [...o]; const [nx, ny] = tf(o[C0.off], o[C0.off + 1]); n[C0.off] = Math.round(nx); n[C0.off + 1] = Math.round(ny); return n; })];
      }
      for (const S of Object.values(STROKES)) {
        const src = doc[S.key].filter(s => s.pts.every(([x, y]) => keep(x, y) || (axis !== "y" ? Math.abs(x - w / 2) < 2 : Math.abs(y - h / 2) < 2)));
        doc[S.key] = [...src, ...src.map(s => ({ ...JSON.parse(JSON.stringify(s)), pts: s.pts.map(([x, y]) => tf(x, y).map(r1)), ...(s.g ? { g: s.g + 10000 } : {}) }))];
      }
      layoutCache = null;
    });
    say("Polovina mapy je zrcadlená.", "ok");
  }

  function fillMines() {
    let added = 0;
    mutate(() => {
      doc.bases.forEach((b, i) => {
        if (undeadBase(i)) return;
        for (const [x, y] of MAPS.baseMinesFor(b.x, b.y, LW(), LH())) {
          const spot = [Math.round(x), Math.round(y)];
          if (doc.gold.length < DOC.MAX_GOLD && !placeProblem("gold", 0, spot[0], spot[1])) { doc.gold.push(spot); added++; }
        }
      });
    });
    if (added) say(`Přidáno dolů: ${added}.`, "ok");
    else say("Žádný další důl se nevešel (je blízko vody, okraje nebo jiného dolu).", "error");
  }

  // Smaže stromy a kulisy, které stojí ve vodě (rychlá oprava hlášení kontroly).
  function cleanWet() {
    let n = 0;
    mutate(() => {
      const before = doc.trees.length + (doc.props || []).length;
      doc.trees = doc.trees.filter(([x, y]) => waterD(x / 2, y / 2 + 15) >= 4 && waterD(x / 2, y / 2) >= 2);
      if (doc.props) doc.props = doc.props.filter(([nm, x, y]) => { const wd = waterD(x / 2, y / 2); return WATER_PROPS.has(nm) ? wd <= -2 : BANK_PROPS.has(nm) ? wd >= -4 : wd >= 2; });
      n = before - doc.trees.length - (doc.props || []).length;
    });
    say(n ? `Odstraněno z vody: ${n}.` : "Ve vodě nic nestojí.", n ? "ok" : "");
  }

  /* ---------- dialog Rozmístit základny ---------- */
  function openPlayers() {
    $("pl-n").value = Math.max(2, doc.bases.length || 2);
    $("d-players").showModal();
  }

  $("pl-cancel").addEventListener("click", () => $("d-players").close());
  $("f-players").addEventListener("submit", ev => {
    ev.preventDefault();
    const n = clamp(Math.round(Number($("pl-n").value)) || 2, 2, R.MAX_PLAYERS);
    let lay = $("pl-layout").value;
    if (lay === "auto") lay = n === 2 ? "sides" : n === 4 ? "corners" : n <= 8 ? "ring" : "grid";
    const m = Number($("pl-margin").value) / 100;
    const w = LW(), h = LH();
    const pts = [];
    if (lay === "sides") for (let i = 0; i < n; i++) pts.push(i % 2 ? [w * (1 - m), h * (0.5 + (Math.floor(i / 2) - (Math.ceil(n / 2) - 1) / 2) / Math.ceil(n / 2) * 0.8)] : [w * m, h * (0.5 + (Math.floor(i / 2) - (Math.ceil(n / 2) - 1) / 2) / Math.ceil(n / 2) * 0.8)]);
    else if (lay === "corners") for (let i = 0; i < n; i++) { const k = i % 4; pts.push([k % 3 === 0 ? w * m : w * (1 - m), k < 2 ? h * m * 1.2 : h * (1 - m)]); }
    else if (lay === "ring") for (let i = 0; i < n; i++) { const a = Math.PI + (i / n) * Math.PI * 2; pts.push([w / 2 + Math.cos(a) * w * (0.5 - m), h / 2 + Math.sin(a) * h * (0.5 - m)]); }
    else { const cols = Math.ceil(Math.sqrt(n * w / h)); const rows = Math.ceil(n / cols); for (let i = 0; i < n; i++) pts.push([w * (m + (1 - 2 * m) * ((i % cols) + 0.5) / cols), h * (m + (1 - 2 * m) * (Math.floor(i / cols) + 0.5) / rows)]); }
    mutate(() => {
      doc.bases = pts.map(([x, y]) => ({ x: Math.round(clamp(x, 120, w - 120)), y: Math.round(clamp(y, 160, h - 140)) }));
      if (doc.coop && doc.coop.ai >= n) delete doc.coop;
      for (const key of ["units", "buildings"]) if (doc[key]) for (const u of doc[key]) u[1] = Math.max(0, nearestBase(u[2], u[3]));
      layoutCache = null;
      if ($("pl-mines").checked) {
        doc.gold = doc.gold.filter(([x, y]) => doc.bases.every(b => Math.hypot(b.x - x, b.y - y) > 450));
        doc.bases.forEach(b => {
          for (const [x, y] of MAPS.baseMinesFor(b.x, b.y, w, h)) {
            const spot = [Math.round(x), Math.round(y)];
            if (doc.gold.length < DOC.MAX_GOLD && !placeProblem("gold", 0, spot[0], spot[1])) doc.gold.push(spot);
          }
        });
      }
    });
    if ($("pl-sym").checked) {
      for (const id of ["e-mx", "e-my", "e-mr", "e-m4"]) $(id).checked = false;
      if (lay === "sides" && n === 2) $("e-mx").checked = true;
      else if (lay === "corners" && n === 4) { $("e-mx").checked = true; $("e-my").checked = true; } else if (n === 2) $("e-mr").checked = true;
      else if (lay === "ring" && n === 4 && Math.abs(W() - H()) < 1) $("e-m4").checked = true;
      else if (n % 2 === 0) $("e-mr").checked = true;
    }
    $("d-players").close();
    say(`Rozmístěno základen: ${n}.`, "ok");
  });

  /* ---------- kreslení ---------- */
  function scheduleDraw() {
    if (timers.draw) return;
    timers.draw = requestAnimationFrame(() => { timers.draw = 0; draw(); });
  }

  function strokeLine(pts, width, color) {
    if (pts.length < 2) return;
    g.strokeStyle = color;
    g.lineWidth = width * 2;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.stroke();
  }

  function drawGrid(u, x0, y0, x1, y1) {
    const step = [10, 20, 40, 100, 200, 500, 1000, 2500].find(s => s * zoom >= 22) || 2500;
    g.strokeStyle = "rgba(255,255,255,0.07)";
    g.lineWidth = u;
    g.beginPath();
    for (let x = Math.max(0, Math.ceil(x0 / step) * step); x <= Math.min(W(), x1); x += step) { g.moveTo(x, Math.max(0, y0)); g.lineTo(x, Math.min(H(), y1)); }
    for (let y = Math.max(0, Math.ceil(y0 / step) * step); y <= Math.min(H(), y1); y += step) { g.moveTo(Math.max(0, x0), y); g.lineTo(Math.min(W(), x1), y); }
    g.stroke();
  }

  const css = v => PK.css(v);
  const themeCols = t => (PAL.THEMES[t] || PAL.THEMES.meadow)[1];

  function drawRegions(u, real) {
    if (!visible("regions")) return;
    const circle = (x, y, r, fill, line) => {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      if (fill && !real) { g.fillStyle = fill; g.fill(); }
      if (line) { g.strokeStyle = line; g.lineWidth = u; g.stroke(); }
    };
    g.globalAlpha = 0.55;
    for (const [t, x, y, r] of doc.biomes || []) circle(x, y, r, css(themeCols(t)[1]), null);
    g.globalAlpha = 0.75;
    for (const [k, x, y, r] of doc.ground || []) circle(x, y, r, css(PAL.GROUND[k][1][1]), null);
    for (const [x, y, r] of doc.ash || []) circle(x, y, r, "#2b2433", null);
    g.globalAlpha = 1;
    if (real || tool === "erase" || tool === "select" || (item && (CIRCLES[item.kind]))) {
      g.setLineDash([4 * u, 4 * u]);
      for (const [, x, y, r] of doc.biomes || []) circle(x, y, r, null, "rgba(255,255,255,0.35)");
      for (const [, x, y, r] of doc.ground || []) circle(x, y, r, null, "rgba(255,240,200,0.3)");
      for (const [x, y, r] of doc.ash || []) circle(x, y, r, null, "rgba(255,143,74,0.4)");
      g.setLineDash([]);
    }
  }

  function drawStrokes(real) {
    if (!visible("terrain")) return;
    if (real) return;
    const shore = themeCols(doc.theme || "meadow")[0];
    for (const s of doc.water) strokeLine(s.pts, s.hw + 1.5, css(mixC(shore, 0xc09c69, 0.5)));
    for (const s of doc.water) strokeLine(s.pts, s.hw, doc.theme === "winter" ? "#9fd0e0" : "#2f6fb0");
    for (const s of doc.water) strokeLine(s.pts, Math.max(1, s.hw - 4), doc.theme === "winter" ? "#b8dfe8" : "#285f9c");
    for (const s of doc.roads) strokeLine(s.pts, s.w, s.main ? "#b09060" : "#8a7048");
    for (const s of doc.mountains) strokeLine(s.pts, s.hw, "#76728a");
    for (const s of doc.mountains) strokeLine(s.pts, Math.max(1, s.hw * 0.45), "#a29fb5");
    for (const s of doc.walls) strokeLine(s.pts, s.hw * 1.5, "#c9c2d8");
  }
  const mixC = (a, b, t) => PK.mix(a, b, t);

  /* Sprity bodových objektů seřazené podle paty (y), jako ve hře. Při malém přiblížení jen tečky. */
  function spriteList(x0, y0, x1, y1, real) {
    const out = [];
    const vis = (x, y, m = 40) => x > x0 - m && x < x1 + m && y > y0 - m && y < y1 + m * 2;
    if (visible("trees")) for (const t of doc.trees) { const x = t[0] / 2, y = t[1] / 2; if (vis(x, y)) out.push({ y: y + 15, k: "tree", x, ay: y, o: t }); }
    if (visible("props") && !(real && sceneFresh)) for (const p of doc.props || []) { const x = p[1] / 2, y = p[2] / 2; if (vis(x, y)) out.push({ y, k: "prop", x, ay: y, o: p }); }
    if (visible("critters")) for (const c of doc.critters || []) { const x = c[1] / 2, y = c[2] / 2; if (vis(x, y)) out.push({ y, k: "critter", x, ay: y, o: c }); }
    if (visible("game")) {
      for (const m of doc.gold) { const x = m[0] / 2, y = m[1] / 2; if (vis(x, y)) out.push({ y: y + 13, k: "gold", x, ay: y, o: m }); }
      for (const b of doc.buildings || []) { const x = b[2] / 2, y = b[3] / 2; if (vis(x, y, 80)) out.push({ y: y + 19, k: "building", x, ay: y, o: b }); }
      layout().forEach((s, i) => {
        const x = s.hq.x / 2, y = s.hq.y / 2;
        if (vis(x, y, 80)) out.push({ y: y + 19, k: "hq", x, ay: y, o: doc.bases[i], i });
      });
      for (const u of doc.units || []) { const x = u[2] / 2, y = u[3] / 2; if (vis(x, y)) out.push({ y: y + 6, k: "unit", x, ay: y, o: u }); }
    }
    out.sort((a, b) => a.y - b.y);
    return out;
  }

  function drawSprite(s, alpha = 1) {
    if (alpha !== 1) g.globalAlpha = alpha;
    const { x, ay: y, o } = s;
    if (s.k === "tree") {
      // stejná volba druhu jako ve hře (game.js drawTree), ať editor ukazuje přesně ten strom
      const h = PK.hash(o[0], o[1], 5);
      const kind = o.length > 2 ? o[2] : PK.krajiny ? PK.krajiny.treeKind(h, doc, x, y) : PK.props.treeKind(h);
      const t = PK.props.trees[kind] || PK.props.trees[0];
      g.drawImage(t.trunk, Math.round(x - t.ax), Math.round(y + 15 - t.ay));
      g.drawImage(t.crown[0], Math.round(x - t.ax), Math.round(y + 15 - t.ay));
    } else if (s.k === "prop") {
      const d = PK.props.doodads[o[0]];
      if (d) g.drawImage(d.c, Math.round(x - d.ax), Math.round(y - d.ay));
    } else if (s.k === "critter") {
      const c = PK.critters.icon(o[0]);
      if (c) g.drawImage(x > W() / 2 ? c.l : c.r, Math.round((x - c.w / 2) * 2) / 2, Math.round((y - c.h + (o[0] === "crow" ? -10 : 0)) * 2) / 2);
    } else if (s.k === "gold") {
      const m = PK.props.mine;
      g.drawImage(m.c, Math.round(x - m.ax), Math.round(y + 13 - m.ay));
    } else if (s.k === "building") {
      const spr = PK.buildings.get(o[0], teamOf(o[1]));
      g.drawImage(spr.c, Math.round(x - spr.ax), Math.round(y + 19 - spr.ay));
    } else if (s.k === "hq") {
      const spr = PK.buildings.get(undeadBase(s.i) ? "necropolis" : "hall", teamOf(s.i));
      g.drawImage(spr.c, Math.round(x - spr.ax), Math.round(y + 19 - spr.ay));
    } else if (s.k === "unit") {
      const f = PK.units.frame(o[0], teamOf(o[1]), "idle", 0);
      const flip = x > W() / 2;
      g.drawImage(flip ? f.cf : f.c, Math.round(x - (flip ? PK.units.CELL - 1 - PK.units.AX : PK.units.AX)), Math.round(y + 6 - PK.units.AY));
    }
    if (alpha !== 1) g.globalAlpha = 1;
  }

  function drawDots(sprites, u) {
    const col = { tree: "#1f4a2a", prop: "#c8b890", critter: "#e8d0a0", gold: "#ffd36b", building: null, unit: null, hq: null };
    const r = Math.max(1.6, 2.2 * u);
    for (const s of sprites) {
      const c = s.k === "unit" || s.k === "building" ? teamCss(s.o[1]) : col[s.k];
      if (!c) continue;
      g.fillStyle = c;
      const rr = s.k === "tree" ? r * 1.4 : s.k === "building" ? r * 2 : s.k === "gold" ? r * 1.6 : r;
      g.fillRect(s.x - rr, s.ay - rr, rr * 2, rr * 2);
    }
  }

  function drawBases(u) {
    if (!visible("game") && !visible("zones")) return;
    layout().forEach((s, i) => {
      const color = undeadBase(i) ? "#d65a3c" : teamCss(i);
      const z = s.zone;
      if (visible("zones")) {
        g.setLineDash([6 * u, 5 * u]);
        g.strokeStyle = color;
        g.globalAlpha = 0.7;
        g.lineWidth = 1.5 * u;
        g.strokeRect(z.x0 / 2, z.y0 / 2, (z.x1 - z.x0) / 2, (z.y1 - z.y0) / 2);
        g.setLineDash([]);
        g.globalAlpha = 0.35;
        g.fillStyle = color;
        g.fillRect(s.plot.x / 2 - 15, s.plot.y / 2 - 6, 30, 12);
        g.globalAlpha = 1;
      }
      if (!visible("game")) return;
      const x = s.hq.x / 2;
      const y = s.hq.y / 2 - 30;
      const r = Math.max(5, 6 * u);
      g.fillStyle = "#15121f";
      g.beginPath();
      g.arc(x, y, r * 1.25, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = color;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#15121f";
      g.font = `bold ${r * 1.4}px monospace`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(undeadBase(i) ? "☠" : String(i + 1), x, y + r * 0.1);
      g.textBaseline = "alphabetic";
    });
  }

  function cursorRadius() {
    if (tool === "erase") return prefs.size.erase || 20;
    if (tool !== "draw" || !item) return 0;
    const mode = modeOf(item);
    if (STROKES[item.kind]) return sizeOf(item);
    if (CIRCLES[item.kind]) return mode === "point" || mode === "brush" ? sizeOf(item) : 0;
    return mode === "brush" ? sizeOf(item) : 0;
  }

  function drawCursor(u, x0, y0, x1, y1) {
    const tf = transforms(W(), H());
    if (tf.length > 1) {
      g.setLineDash([4 * u, 6 * u]);
      g.strokeStyle = "rgba(255,255,255,0.35)";
      g.lineWidth = u;
      g.beginPath();
      if ($("e-mx").checked || $("e-m4").checked) { g.moveTo(W() / 2, Math.max(0, y0)); g.lineTo(W() / 2, Math.min(H(), y1)); }
      if ($("e-my").checked || $("e-m4").checked) { g.moveTo(Math.max(0, x0), H() / 2); g.lineTo(Math.min(W(), x1), H() / 2); }
      g.stroke();
      g.setLineDash([]);
      if ($("e-mr").checked || $("e-m4").checked) { g.fillStyle = "rgba(255,255,255,0.5)"; g.beginPath(); g.arc(W() / 2, H() / 2, 3 * u, 0, Math.PI * 2); g.fill(); }
    }

    // výběr
    if (selection.length) {
      g.strokeStyle = "#ffe08a";
      g.lineWidth = 1.5 * u;
      for (const { key, o } of selection) {
        const kind = KIND_OF_KEY[key];
        if (POINTS[kind]) { const [x, y] = ppos(kind, o); g.strokeRect(x / 2 - 6, y / 2 - 12, 12, 16); } else if (CIRCLES[kind]) { const [x, y, r] = cpos(kind, o); g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); } else { g.globalAlpha = 0.5; strokeLine(o.pts, (o.hw || o.w) + 1, "#ffe08a"); g.globalAlpha = 1; }
      }
      const b = selBounds();
      g.setLineDash([3 * u, 3 * u]);
      g.strokeStyle = "rgba(255,224,138,0.8)";
      g.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      g.setLineDash([]);
    }

    if (drag && (drag.kind === "marquee" || drag.kind === "shape")) {
      const a = drag.start, b = drag.last;
      g.strokeStyle = drag.kind === "marquee" ? "#ffe08a" : "rgba(255,255,255,0.9)";
      g.lineWidth = u;
      g.setLineDash([4 * u, 3 * u]);
      for (const f of drag.kind === "marquee" ? [tf[0]] : tf) {
        const [ax, ay] = f(a[0], a[1]);
        const [bx, by] = f(b[0], b[1]);
        g.beginPath();
        if (drag.item && drag.item.kind === "lake") g.ellipse((ax + bx) / 2, (ay + by) / 2, Math.abs(bx - ax) / 2 || 0.1, Math.abs(by - ay) / 2 || 0.1, 0, 0, Math.PI * 2);
        else if (drag.mode === "line") { g.moveTo(ax, ay); g.lineTo(bx, by); } else g.rect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
        g.stroke();
      }
      g.setLineDash([]);
    }

    if (!hover || pan || spaceDown || tool === "hand") return;

    // vkládání: přízrak schránky pod kurzorem
    if (pasting && clipboard) {
      g.globalAlpha = 0.55;
      const dx = hover[0] - clipboard.cx, dy = hover[1] - clipboard.cy;
      for (const { key, o } of clipboard.items) {
        const kind = KIND_OF_KEY[key];
        if (POINTS[kind]) { const [x, y] = ppos(kind, o); const sx = x / 2 + dx, sy = y / 2 + dy; const k = kind === "base" ? "hq" : kind; drawSprite({ k, x: sx, ay: sy, o, i: 0 }); } else if (STROKES[kind]) strokeLine(o.pts.map(([x, y]) => [x + dx, y + dy]), o.hw || o.w, "#7fb0ff");
        else { const [x, y, r] = cpos(kind, o); g.fillStyle = "#ffe08a"; g.beginPath(); g.arc(x + dx, y + dy, r, 0, Math.PI * 2); g.fill(); }
      }
      g.globalAlpha = 1;
      return;
    }

    const radius = cursorRadius();
    if (radius) {
      g.strokeStyle = tool === "erase" ? "rgba(255,140,120,0.9)" : "rgba(255,255,255,0.8)";
      g.lineWidth = u;
      for (const f of tf) {
        const [x, y] = f(hover[0], hover[1]);
        g.beginPath();
        if (prefs.shape === "square" && !STROKES[(item || {}).kind]) g.rect(x - radius, y - radius, radius * 2, radius * 2);
        else g.arc(x, y, radius, 0, Math.PI * 2);
        g.stroke();
      }
    }

    // přízrak jednoho objektu: zelený = může sem, červený = nemůže
    if (tool === "draw" && item && POINTS[item.kind] && modeOf(item) === "point" && !drag) {
      const lx = Math.round(hover[0] * 2), ly = Math.round(hover[1] * 2);
      const bad = placeProblem(item.kind, item.value, lx, ly);
      for (const f of tf) {
        const [x, y] = f(hover[0], hover[1]);
        const ghost = item.kind === "base" ? { k: "hq", x, ay: y, i: Math.min(doc.bases.length, 15) } : { k: item.kind, x, ay: y, o: makePoint(item.kind, item.value, x * 2, y * 2, clamp(prefs.team, 0, 15)) };
        drawSprite(ghost, 0.6);
        g.strokeStyle = bad ? "rgba(255,90,80,0.9)" : "rgba(127,224,138,0.9)";
        g.lineWidth = u;
        g.beginPath();
        g.ellipse(x, y + (item.kind === "tree" ? 15 : 0), 5, 2.5, 0, 0, Math.PI * 2);
        g.stroke();
        if (item.kind === "building") {
          const fr = R.footRect({ type: item.value, x: x * 2, y: y * 2 });
          g.strokeRect(fr.x0 / 2, fr.y0 / 2, (fr.x1 - fr.x0) / 2, (fr.y1 - fr.y0) / 2);
        }
      }
    }
  }

  function drawProblems(u) {
    if (!visible("problems") || !spots.length) return;
    const t = performance.now() / 400;
    g.strokeStyle = "#ff6a5a";
    g.lineWidth = 1.5 * u;
    for (const [x, y] of spots) {
      g.beginPath();
      g.arc(x, y, 7 + Math.sin(t) * 1.5 + 3 * u, 0, Math.PI * 2);
      g.stroke();
    }
  }

  function draw() {
    const u = 1 / zoom;
    const x0 = cam.x;
    const y0 = cam.y;
    const x1 = cam.x + vw * u;
    const y1 = cam.y + vh * u;
    const real = view.real && scene;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#0b0914";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.setTransform(zoom * dpr, 0, 0, zoom * dpr, -cam.x * zoom * dpr, -cam.y * zoom * dpr);
    g.imageSmoothingEnabled = false;
    // jemná dvojčata spritů (PK.HD), jakmile je art px na obrazovce aspoň 1,5 px
    g.hdDraw = zoom * dpr >= 1.5;

    g.fillStyle = css(themeCols(doc.theme || "meadow")[1]);
    g.fillRect(0, 0, W(), H());

    if (real) {
      g.globalAlpha = sceneFresh ? 1 : 0.55;
      g.drawImage(scene, 0, 0, W(), H());
      g.globalAlpha = 1;
    }
    drawRegions(u, real);
    drawStrokes(real);
    if (view.grid) drawGrid(u, x0, y0, x1, y1);

    const sprites = spriteList(x0, y0, x1, y1, real);
    if (zoom >= 0.45 && sprites.length < 9000) for (const s of sprites) drawSprite(s);
    else drawDots(sprites, u);

    drawBases(u);
    g.strokeStyle = "#6a5a9a";
    g.lineWidth = 2 * u;
    g.strokeRect(0, 0, W(), H());
    drawProblems(u);
    drawCursor(u, x0, y0, x1, y1);
    drawMiniView();
  }

  /* ---------- minimapa ---------- */
  let miniBase = null;
  function scheduleMini() {
    clearTimeout(timers.mini);
    timers.mini = setTimeout(renderMini, 250);
  }

  function renderMini() {
    const box = mini.getBoundingClientRect();
    const mw = Math.max(80, Math.round(box.width || 220));
    const s = mw / W();
    const mh = Math.max(40, Math.round(H() * s));
    const k = window.devicePixelRatio || 1;
    mini.width = mw * k;
    mini.height = mh * k;
    mini.style.height = `${mh}px`;
    const c = document.createElement("canvas");
    c.width = mini.width;
    c.height = mini.height;
    const q = c.getContext("2d");
    q.scale(s * k, s * k);
    q.fillStyle = css(themeCols(doc.theme || "meadow")[1]);
    q.fillRect(0, 0, W(), H());
    const fillC = (x, y, r, col) => { q.fillStyle = col; q.beginPath(); q.arc(x, y, r, 0, Math.PI * 2); q.fill(); };
    for (const [t, x, y, r] of doc.biomes || []) fillC(x, y, r, css(themeCols(t)[1]));
    for (const [kk, x, y, r] of doc.ground || []) fillC(x, y, r, css(PAL.GROUND[kk][1][1]));
    for (const [x, y, r] of doc.ash || []) fillC(x, y, r, "#2b2433");
    const line = (pts, w, col) => { if (pts.length < 2) return; q.strokeStyle = col; q.lineWidth = Math.max(w * 2, 1.5 / s); q.lineCap = "round"; q.lineJoin = "round"; q.beginPath(); q.moveTo(...pts[0]); for (const p of pts.slice(1)) q.lineTo(...p); q.stroke(); };
    for (const r of doc.water) line(r.pts, r.hw, doc.theme === "winter" ? "#9fd0e0" : "#3f7fd0");
    for (const r of doc.roads) line(r.pts, r.w * 0.6, "#c0a070");
    for (const r of doc.mountains) line(r.pts, r.hw, "#8a879c");
    for (const r of doc.walls) line(r.pts, r.hw * 1.5, "#d8d0e6");
    q.fillStyle = doc.theme === "autumn" ? "#4a2a24" : "#1b3836";
    const d = Math.max(1.2 / s, 2);
    for (const [x, y] of doc.trees) q.fillRect(x / 2 - d / 2, y / 2 - d / 2, d, d);
    q.fillStyle = "#ffd36b";
    for (const [x, y] of doc.gold) q.fillRect(x / 2 - d, y / 2 - d, d * 2, d * 2);
    doc.bases.forEach((b, i) => { q.fillStyle = undeadBase(i) ? "#d65a3c" : teamCss(i); q.fillRect(b.x / 2 - d * 2, b.y / 2 - d * 2, d * 4, d * 4); });
    miniBase = { c, s, k };
    drawMiniView();
  }

  function drawMiniView() {
    if (!miniBase) return;
    const { c, s, k } = miniBase;
    mg.setTransform(1, 0, 0, 1, 0, 0);
    mg.clearRect(0, 0, mini.width, mini.height);
    mg.drawImage(c, 0, 0);
    mg.strokeStyle = "#ffe08a";
    mg.lineWidth = 1.5 * k;
    mg.strokeRect(cam.x * s * k, cam.y * s * k, (vw / zoom) * s * k, (vh / zoom) * s * k);
  }

  let miniDrag = false;
  const miniGo = ev => {
    if (!miniBase) return;
    const box = mini.getBoundingClientRect();
    centerOn([(ev.clientX - box.left) / miniBase.s, (ev.clientY - box.top) / miniBase.s]);
  };
  mini.addEventListener("pointerdown", ev => { miniDrag = true; mini.setPointerCapture(ev.pointerId); miniGo(ev); });
  mini.addEventListener("pointermove", ev => { if (miniDrag) miniGo(ev); });
  mini.addEventListener("pointerup", () => { miniDrag = false; });
  new ResizeObserver(scheduleMini).observe(mini);

  /* ---------- skutečný vzhled ---------- */
  function toggleReal() {
    if (!view.real && isBig() && !confirm(T("Skutečný vzhled velké mapy se peče déle (desítky sekund) a potřebuje hodně paměti. Pokračovat?"))) { $("e-real").checked = false; return; }
    view.real = !view.real;
    $("e-real").checked = view.real;
    if (view.real) bake(); else scheduleDraw();
  }

  function scheduleBake() {
    clearTimeout(timers.bake);
    timers.bake = setTimeout(bake, 600);
  }

  function compile(raw = doc) {
    const probe = JSON.parse(JSON.stringify(raw));
    if (!ID_RE.test(probe.id)) probe.id = "nova-mapa";
    if (!probe.name.trim()) probe.name = "Mapa";
    const { doc: clean, errors } = MAPS.normalizeDoc(tidy(probe));
    return clean ? { map: MAPS.compileDoc(clean), errors: [], clean } : { map: null, errors };
  }

  // Upeče terén mapy a kulisy do plátna (jemná mřížka, pokud to velikost dovolí). Vrací { c, scale } nebo null.
  function bakeScene() {
    const { map, errors } = compile();
    if (!map) { say(errors[0], "error"); return null; }
    map.id = `__editor${++bakeSeq}`;
    if (lastBake) PK.world.forget(lastBake);
    lastBake = map.id;
    PK.world.build(map);
    const [w, h] = map.size;
    const k = w * h * 4 <= 16e6 ? 2 : 1;
    const c = document.createElement("canvas");
    c.width = w * k;
    c.height = h * k;
    const bg = c.getContext("2d");
    bg.imageSmoothingEnabled = false;
    bg.hdDraw = k === 2;
    bg.setTransform(k, 0, 0, k, 0, 0);
    PK.world.drawGround(bg, 0, { x: 0, y: 0, w, h });
    for (const d of PK.world.doodads) bg.drawImage(d.spr.c, d.x - d.spr.ax, d.y - d.spr.ay);
    return { c, k, map };
  }

  function bake() {
    say("Peču skutečný vzhled…");
    setTimeout(() => {
      const r = bakeScene();
      if (!r) return;
      scene = r.c;
      sceneFresh = true;
      say("Skutečný vzhled je hotový.", "ok");
      scheduleDraw();
    }, 20);
  }

  /* ---------- obrázky a náhled ---------- */
  // Celá mapa jako PNG (pečený terén + objekty), nebo malý pixelový náhled jako v lobby.
  function exportPng(thumb) {
    say("Kreslím obrázek mapy…");
    setTimeout(() => {
      let out;
      if (thumb) out = thumbCanvas(8);
      else {
        const r = bakeScene();
        if (!r) return;
        out = document.createElement("canvas");
        out.width = r.c.width;
        out.height = r.c.height;
        const q = out.getContext("2d");
        q.imageSmoothingEnabled = false;
        q.drawImage(r.c, 0, 0);
        q.setTransform(r.k, 0, 0, r.k, 0, 0);
        q.hdDraw = r.k === 2;
        drawSpritesTo(q);
      }
      out.toBlob(blob => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${doc.id || "mapa"}${thumb ? "-nahled" : ""}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        say("Obrázek je stažený.", "ok");
      });
    }, 20);
  }

  // Objekty mapy (bez kulis, ty jsou v pečeném terénu) do jiného kontextu, např. pro export PNG.
  function drawSpritesTo(q) {
    const sprites = spriteList(-1e9, -1e9, 1e9, 1e9, true).filter(s => s.k !== "prop");
    const prev = g;
    g = q;
    try { for (const s of sprites) drawSprite(s); } finally { g = prev; }
  }

  // Pixelový náhled mapy jako v seznamu lobby (38 × 24, zvětšený `scale`×).
  function thumbCanvas(scale = 4) {
    const { map } = compile();
    if (!map) return document.createElement("canvas");
    const [w, h] = map.size;
    const s0 = Math.min(38 / w, 24 / h);
    const tw = Math.max(4, Math.round(w * s0));
    const th = Math.max(4, Math.round(h * s0));
    const rec = map.terrain;
    const small = document.createElement("canvas");
    small.width = tw;
    small.height = th;
    const c = small.getContext("2d");
    const img = c.createImageData(tw, th);
    const sx = w / tw, sy = h / th;
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const ax = (x + 0.5) * sx, ay = (y + 0.5) * sy;
        let theme = MAPS.themeOf(map);
        if (PK.krajiny && rec.biomes && rec.biomes.length) { const [t, kk] = PK.krajiny.regionAt(rec, ax, ay); if (t && kk > 0.5) theme = t; }
        const cols = themeCols(theme);
        let col = PK.fbm(ax / 60, ay / 60, 7, 2) > 0.55 ? cols[2] : cols[1];
        for (const [kk, gx, gy, r] of rec.ground || []) if (Math.hypot(ax - gx, ay - gy) < r) col = PAL.GROUND[kk][1][1];
        if (rec.ash.circles.some(([cx, cy, r]) => Math.hypot(ax - cx, ay - cy) < r * 0.8)) col = 0x34303c;
        if (MAPS.isRock(rec, ax, ay)) col = theme === "winter" ? 0xe8e6e8 : 0x767892;
        if (rec.rivers.some(r => r.pts && MAPS.isWater({ rivers: [r], roads: [] }, ax, ay))) col = theme === "winter" ? 0x9fd0e0 : theme === "swamp" ? 0x2f6a6a : 0x3f7fd0;
        const i = (y * tw + x) * 4;
        img.data[i] = (col >> 16) & 255; img.data[i + 1] = (col >> 8) & 255; img.data[i + 2] = col & 255; img.data[i + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    const dot = (x, y, color, size = 1) => { c.fillStyle = color; c.fillRect(Math.floor(x / 2 / sx - (size - 1) / 2), Math.floor(y / 2 / sy - (size - 1) / 2), size, size); };
    map.trees.forEach(([x, y], i) => { if (i % 2 === 0) dot(x, y, "#1b3836"); });
    for (const [x, y] of map.gold) dot(x, y, "#ffd36b");
    map.slots.forEach((slot, i) => dot(slot.hq.x, slot.hq.y, map.coop && map.coop.ai === i ? "#d65a3c" : teamCss(i), 3));
    const out = document.createElement("canvas");
    out.width = tw * scale;
    out.height = th * scale;
    const q = out.getContext("2d");
    q.imageSmoothingEnabled = false;
    q.drawImage(small, 0, 0, out.width, out.height);
    return out;
  }

  /* ---------- kontrola mapy ---------- */
  function validate() {
    clearTimeout(timers.validate);
    const own = [];
    const located = new Map(); // text -> místa
    const at = (text, x, y) => { if (!located.has(text)) located.set(text, []); located.get(text).push([x, y]); };
    if (!ID_RE.test(doc.id)) own.push("Vyplň identifikátor mapy (a–z, 0–9, pomlčka).");
    if (!doc.name.trim()) own.push("Vyplň název mapy.");

    const { map, errors } = compile();
    let list0 = errors;
    if (map) {
      try { list0 = CHECK.check(map); } catch (e) { list0 = [`Mapu se nepodařilo zkontrolovat: ${e.message}`]; }
    }

    // voda pod stromy, kulisami a zvířaty, objekty na skále (s místem, kliknutím se ukáže)
    for (const t of doc.trees) if (waterD(t[0] / 2, t[1] / 2 + 15) < 4 || waterD(t[0] / 2, t[1] / 2) < 2) at("Strom má patu ve vodě.", t[0] / 2, t[1] / 2 + 10);
    for (const [nm, x, y] of doc.props || []) {
      const wd = waterD(x / 2, y / 2);
      if (WATER_PROPS.has(nm) ? wd > -2 : BANK_PROPS.has(nm) ? wd < -4 : wd < 2) at(WATER_PROPS.has(nm) ? "Lekníny nejsou na vodě." : "Kulisa stojí ve vodě.", x / 2, y / 2);
      else if (rockAt(x / 2, y / 2)) at("Kulisa stojí na skále nebo hradbě.", x / 2, y / 2);
    }
    for (const [type, x, y] of doc.critters || []) {
      const wd = waterD(x / 2, y / 2);
      if (MAPS.WATER_CRITTERS.includes(type) ? wd > -4 : wd < 1) at(MAPS.WATER_CRITTERS.includes(type) ? "Kachna nebo ryba není na vodě." : "Zvíře stojí ve vodě.", x / 2, y / 2);
    }
    for (const [, , x, y] of doc.units || []) if ((waterD(x / 2, y / 2) < 1 && !roadAt(x / 2, y / 2)) || rockAt(x / 2, y / 2)) at("Jednotka stojí ve vodě nebo na skále.", x / 2, y / 2);
    for (const [type, b, x, y] of doc.buildings || []) {
      if (b >= doc.bases.length) at("Budova patří neexistující základně.", x / 2, y / 2);
      else if (MAPS.PLACE_BUILDINGS[undeadBase(b) ? "undead" : "human"].indexOf(type) < 0) at("Budova jiné frakce než její základna.", x / 2, y / 2);
    }
    for (const [x, y] of doc.gold) if (waterD(x / 2, y / 2) < 6) at("Důl stojí u vody nebo ve vodě.", x / 2, y / 2);

    problems = [...own.map(text => ({ text })), ...list0.map(text => ({ text })),
      ...[...located.entries()].map(([text, where]) => ({ text: where.length > 1 ? `${T(text)} (${where.length}×)` : text, where, i: 0 }))];
    spots = [...located.values()].flat();

    const items = problems.length ? problems : [{ text: "Mapa je v pořádku a lze ji hrát.", ok: true }];
    $("e-problems").replaceChildren(...items.map(pr => {
      const li = document.createElement("li");
      li.textContent = T(pr.text);
      if (pr.ok) li.className = "ok";
      if (pr.where) {
        li.className = "at";
        li.title = T("Klikni pro ukázání místa");
        li.addEventListener("click", () => { const w = pr.where[pr.i++ % pr.where.length]; centerOn(w, Math.max(zoom, 2)); });
        // rychlá oprava: stromy a kulisy ve vodě smazat jedním klikem
        if (/ve vodě|na vodě/.test(pr.text) && /Strom|Kulisa|Lekníny/.test(pr.text)) {
          const fix = document.createElement("button");
          fix.type = "button";
          fix.className = "fix";
          fix.textContent = T("Odstranit");
          fix.title = T("Smazat všechny stromy a kulisy, které stojí ve vodě");
          fix.addEventListener("click", ev => { ev.stopPropagation(); cleanWet(); });
          li.append(" ", fix);
        }
      }
      return li;
    }));

    const n = k => (doc[k] || []).length;
    $("e-summary").textContent = [
      `${T("Hráči")}: ${doc.bases.length}${doc.coop ? ` (${T("kooperace")})` : ""}`, `${T("doly")}: ${n("gold")}`, `${T("stromy")}: ${n("trees")}`,
      `${T("kulisy")}: ${n("props")}`, `${T("zvířata")}: ${n("critters")}`, `${T("jednotky")}: ${n("units")}`, `${T("budovy")}: ${n("buildings")}`,
      `${T("voda")}: ${n("water")}`, `${T("cesty")}: ${n("roads")}`, `${T("hory")}: ${n("mountains")}`, `${T("hradby")}: ${n("walls")}`, `${T("půda")}: ${n("ground") + n("biomes")}`
    ].join(" · ");
    $("e-test").classList.toggle("warn", problems.length > 0);
    scheduleDraw();
  }

  /* ---------- zkouška proti AI ---------- */
  function testPlay() {
    validate();
    const { clean, errors } = compile();
    if (!clean) return say(errors[0] || "Mapu nejde sestavit.", "error");
    const hard = problems.filter(p => !p.where && !/identifikátor|název/i.test(p.text));
    if (hard.length && !confirm(`${T("Mapa má problémy")}:\n• ${hard.slice(0, 4).map(p => T(p.text)).join("\n• ")}\n\n${T("Přesto vyzkoušet?")}`)) return;
    try {
      localStorage.setItem(TEST_KEY, JSON.stringify({ doc: clean, slot: prefs.testSlot || 0, at: Date.now() }));
    } catch (e) { return say("Mapa se nevešla do úložiště prohlížeče.", "error"); }
    // na serveru běží hra na /play, při otevření ze souborů je to index.html
    const url = `${/\.html$/.test(location.pathname) ? "index.html" : "/play"}?test=editor`;
    const w = window.open(url, "goralia-test");
    if (!w) location.href = url;
    say("Zkouška mapy se otevírá v nové kartě.", "ok");
  }

  /* ---------- server a soubory ---------- */
  async function refreshServerList() {
    try {
      const res = await fetch("/api/maps", { cache: "no-store" });
      const data = await res.json();
      serverMaps = data.maps || [];
      serverUp = true;
    } catch (e) {
      serverMaps = [];
      serverUp = false;
    }
    try {
      const me = await (await fetch("/api/me", { cache: "no-store" })).json();
      canEdit = !!me.canEditMaps;
      const cfg = await (await fetch("/api/mapconfig", { cache: "no-store" })).json();
      mpOff = new Set((cfg.off || []).map(String));
    } catch (e) {
      canEdit = false;
    }
    renderPerm();
    renderTitle();
  }

  function renderPerm() {
    const el = $("e-perm");
    el.hidden = !serverUp;
    el.className = `perm ${canEdit ? "ok" : "no"}`;
    el.textContent = T(canEdit ? "Můžeš ukládat na server" : "Jen prohlížení (ukládat smí admin)");
    el.title = T(canEdit ? "Jsi přihlášen jako administrátor (nebo editor běží lokálně)." : "Pro ukládání a mazání map na serveru se přihlas jako administrátor. Mapu můžeš stáhnout jako JSON.");
    $("e-save").classList.toggle("locked", !canEdit && serverUp);
  }

  function adopt(raw, fromServer) {
    const { doc: clean, errors } = MAPS.normalizeDoc(raw);
    if (!clean) return say(errors[0], "error");
    replaceDoc(clean, fromServer ? clean.id : "");
    say(`Otevřeno: ${clean.name}.`, "ok");
  }

  async function save() {
    validate();
    if (!ID_RE.test(doc.id) || !doc.name.trim()) return openProps("save");
    if (problems.length) return say("Nejdřív oprav problémy v kontrole mapy.", "error");
    try {
      const res = await fetch(`/api/maps/${encodeURIComponent(doc.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tidy(JSON.parse(snapshot()))) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) return say("Ukládat mapy na server smí jen přihlášený administrátor. Použij Soubor › Stáhnout JSON.", "error");
      if (!res.ok) return say((data.errors && data.errors[0]) || "Server mapu nepřijal.", "error");
      dirty = false;
      savedId = doc.id;
      await refreshServerList();
      say(`Uloženo: maps/${doc.id}.json. Mapa je k dispozici ve hře.`, "ok");
    } catch (e) {
      say("Server není dostupný. Použij Soubor › Stáhnout JSON.", "error");
    }
  }

  function download() {
    const blob = new Blob([JSON.stringify(tidy(JSON.parse(snapshot())), null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${doc.id || "mapa"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function deleteMap(id) {
    if (!canEdit) return say("Mazat mapy smí jen přihlášený administrátor.", "error");
    if (!id || !confirm(T(`Opravdu smazat mapu „${id}“ ze serveru?`))) return;
    try {
      const res = await fetch(`/api/maps/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const why = (data.errors && data.errors[0]) || `Chyba serveru (${res.status}).`;
        say(res.status === 403 ? "Mazat mapy smí jen přihlášený administrátor." : why, "error");
        alert(`${T("Mapu se nepodařilo smazat.")}\n${T(why)}`);
        return;
      }
      if (savedId === id) { savedId = ""; dirty = true; }
      await refreshServerList();
      say(`Smazáno: ${id}.`, "ok");
    } catch (e) {
      say("Server není dostupný.", "error");
      alert(T("Server není dostupný."));
    }
  }

  const confirmDiscard = () => !dirty || confirm(T("Neuložené změny se ztratí. Pokračovat?"));

  $("e-file").addEventListener("change", ev => {
    const file = ev.target.files[0];
    ev.target.value = "";
    if (!file || !confirmDiscard()) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        adopt(JSON.parse(String(reader.result)), false);
        $("d-open").close();
      } catch (e) { say("Soubor není platný JSON.", "error"); }
    };
    reader.readAsText(file);
  });

  // přetažení JSON souboru do okna = import
  document.addEventListener("dragover", ev => { if ([...ev.dataTransfer.types].includes("Files")) ev.preventDefault(); });
  document.addEventListener("drop", ev => {
    const file = ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (!file) return;
    ev.preventDefault();
    if (!confirmDiscard()) return;
    file.text().then(text => { try { adopt(JSON.parse(text), false); } catch (e) { say("Soubor není platný JSON.", "error"); } });
  });

  /* ---------- dialog Otevřít ---------- */
  function mapRow(title, sub, onOpen, onDelete) {
    const row = document.createElement("div");
    row.className = "map-row";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = title;
    const small = document.createElement("small");
    small.textContent = sub;
    name.append(small);
    row.append(name);
    row.addEventListener("click", onOpen);
    if (onDelete) {
      const del = document.createElement("button");
      del.type = "button";
      del.textContent = T("Smazat");
      del.addEventListener("click", ev => { ev.stopPropagation(); onDelete(); });
      row.append(del);
    }
    return row;
  }

  function renderOpenList() {
    const box = $("o-list");
    const parts = [];
    const head = text => { const h = document.createElement("h3"); h.textContent = T(text); return h; };
    const note = text => { const p = document.createElement("p"); p.className = "muted"; p.textContent = T(text); return p; };
    parts.push(head("Mapy na serveru"));
    if (!serverUp) parts.push(note("Server není dostupný. Mapu lze otevřít ze souboru."));
    else if (!serverMaps.length) parts.push(note("Zatím nemáš žádnou uloženou mapu."));
    for (const m of serverMaps) {
      parts.push(mapRow(m.name, `${m.id} · ${m.size[0] * 2}×${m.size[1] * 2} · ${T("hráčů")}: ${m.bases.length}${m.theme ? ` · ${T(MAPS.THEME_NAMES[m.theme] || m.theme)}` : ""}${mpOff.has(m.id) ? ` · ${T("multiplayer vypnut")}` : ""}`, () => {
        if (!confirmDiscard()) return;
        adopt(m, true);
        $("d-open").close();
      }, canEdit ? async () => { await deleteMap(m.id); renderOpenList(); } : null));
    }
    box.replaceChildren(...parts);
  }

  async function openDialog() {
    $("d-open").showModal();
    renderOpenList();
    await refreshServerList();
    renderOpenList();
  }

  $("o-close").addEventListener("click", () => $("d-open").close());
  $("o-import").addEventListener("click", () => $("e-file").click());

  /* ---------- dialog Vlastnosti (s překlady) ---------- */
  const PROPS_TITLE = { new: "Nová mapa", props: "Vlastnosti mapy", save: "Uložit mapu", saveas: "Uložit jako…" };

  function openProps(mode) {
    propsMode = mode;
    const d = mode === "new" ? blank() : doc;
    const copy = mode === "saveas";
    propsDraft = {
      cs: { name: copy ? `${d.name} (kopie)`.slice(0, 32) : d.name, description: d.description },
      en: { ...((d.i18n && d.i18n.en) || {}) },
      szl: { ...((d.i18n && d.i18n.szl) || {}) }
    };
    $("p-title").textContent = T(PROPS_TITLE[mode]);
    $("p-ok").textContent = T(mode === "new" ? "Vytvořit" : mode === "props" ? "OK" : "Uložit");
    $("p-id").value = copy ? `${d.id}-kopie`.slice(0, 31) : d.id;
    $("p-w").value = d.size[0] * 2;
    $("p-h").value = d.size[1] * 2;
    $("p-seed").value = d.seed;
    $("p-auto").checked = d.autoRoads !== false;
    $("p-wild").checked = d.wild !== false;
    $("p-theme").value = d.theme || "meadow";
    const coop = $("p-coop");
    coop.replaceChildren(new Option(T("ne, každý za sebe"), "-1"), ...d.bases.map((b, i) => new Option(`${T("nemrtví (AI) na základně")} ${i + 1}`, String(i))));
    coop.value = d.coop ? String(d.coop.ai) : "-1";
    $("p-error").textContent = "";
    propsIdTouched = mode === "props" ? !!d.id : false;
    if (copy) propsIdTouched = true;
    setPropsLang("cs");
    const th = $("p-thumb");
    const t = mode === "new" ? null : thumbCanvas(4);
    th.hidden = !t;
    if (t) { th.width = t.width; th.height = t.height; th.getContext("2d").drawImage(t, 0, 0); }
    $("d-props").showModal();
    $("p-name").focus();
    $("p-name").select();
  }

  function storePropsLang() {
    if (!propsDraft) return;
    propsDraft[propsLang] = { name: $("p-name").value, description: $("p-desc").value };
  }

  function setPropsLang(lang) {
    storePropsLang();
    propsLang = lang;
    for (const b of document.querySelectorAll("#p-langs button")) b.classList.toggle("active", b.dataset.lang === lang);
    $("p-name").value = propsDraft[lang].name || "";
    $("p-desc").value = propsDraft[lang].description || "";
    $("p-name").placeholder = lang === "cs" ? "" : propsDraft.cs.name || "";
    $("p-desc").placeholder = lang === "cs" ? "" : propsDraft.cs.description || "";
    $("p-lang-note").hidden = lang === "cs";
  }

  $("p-langs").addEventListener("click", ev => {
    const b = ev.target.closest("button[data-lang]");
    if (b) setPropsLang(b.dataset.lang);
  });

  $("p-name").addEventListener("input", ev => {
    if (!propsIdTouched && propsLang === "cs") $("p-id").value = slug(ev.target.value);
  });
  $("p-id").addEventListener("input", () => { propsIdTouched = true; });
  $("p-dice").addEventListener("click", () => { $("p-seed").value = Math.floor(Math.random() * 1000000); });
  $("p-cancel").addEventListener("click", () => $("d-props").close());

  function applyTexts(d) {
    d.name = (propsDraft.cs.name || "").trim();
    d.description = propsDraft.cs.description || "";
    const tr = {};
    for (const lang of MAPS.LANGS) {
      const o = propsDraft[lang] || {};
      const n = (o.name || "").trim();
      const de = (o.description || "").trim();
      if (n || de) tr[lang] = { ...(n ? { name: n } : {}), ...(de ? { description: de } : {}) };
    }
    if (Object.keys(tr).length) d.i18n = tr;
    else delete d.i18n;
  }

  $("f-props").addEventListener("submit", async ev => {
    ev.preventDefault();
    storePropsLang();
    const name = (propsDraft.cs.name || "").trim();
    const id = $("p-id").value.trim().toLowerCase();
    const w = clamp(Math.round(Number($("p-w").value) / 40) * 20, DOC.MIN_W, DOC.MAX_W);
    const h = clamp(Math.round(Number($("p-h").value) / 40) * 20, DOC.MIN_H, DOC.MAX_H);
    const fail = text => { $("p-error").textContent = T(text); };
    if (!name) { setPropsLang("cs"); return fail("Vyplň název mapy."); }
    if (!ID_RE.test(id)) return fail("Identifikátor: 1 až 31 znaků a–z, 0–9 a pomlčka.");
    if (!Number.isFinite(w) || !Number.isFinite(h)) return fail("Zadej rozměry mapy.");
    const saving = propsMode === "save" || propsMode === "saveas";
    if (saving && id !== savedId && serverMaps.some(m => m.id === id) && !confirm(T(`Mapa „${id}“ už na serveru je. Přepsat?`))) return;
    const coop = Number($("p-coop").value);

    if (propsMode === "new") {
      const next = blank();
      Object.assign(next, { id, size: [w, h] });
      applyTexts(next);
      next.seed = clamp(Math.round(Number($("p-seed").value)) || 1, 0, 999999);
      next.autoRoads = $("p-auto").checked;
      if (!$("p-wild").checked) next.wild = false;
      setTheme(next, $("p-theme").value);
      $("d-props").close();
      replaceDoc(next, "");
      return;
    }

    mutate(() => {
      applyTexts(doc);
      doc.id = id;
      doc.seed = clamp(Math.round(Number($("p-seed").value)) || 0, 0, 999999);
      doc.autoRoads = $("p-auto").checked;
      if ($("p-wild").checked) delete doc.wild; else doc.wild = false;
      if (coop >= 0 && coop < doc.bases.length) doc.coop = { ai: coop, faction: "undead" };
      else delete doc.coop;
      setTheme(doc, $("p-theme").value);
      applySize(w, h);
    });

    if (propsMode === "saveas") savedId = "";
    $("d-props").close();
    needFit = false;
    clampCam();
    changed(false);
    if (saving) await save();
  });

  function newMap() {
    if (confirmDiscard()) openProps("new");
  }

  $("e-title").addEventListener("click", () => openProps("props"));
  $("e-save").addEventListener("click", () => save());
  $("e-test").addEventListener("click", testPlay);
  $("e-undo").addEventListener("click", () => stepHistory(undo, redo));
  $("e-redo").addEventListener("click", () => stepHistory(redo, undo));

  /* ---------- paleta ---------- */
  const MODE_LABEL = { point: ["•", "Jednotlivě"], brush: ["◍", "Štětec"], line: ["╱", "Čára"], rect: ["▭", "Obdélník"], fill: ["◪", "Výplň oblasti"], ellipse: ["◯", "Ovál"] };
  const MODE_LABEL_STROKE = { brush: ["〰", "Volně"], line: ["╱", "Rovně"], rect: ["▭", "Obdélník"] };

  function renderCats() {
    $("e-cats").replaceChildren(...PAL.CATS.map(c => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.cat = c.id;
      b.className = c.id === cat ? "active" : "";
      b.setAttribute("role", "tab");
      b.title = T(c.label);
      const i = document.createElement("span");
      i.className = "ci";
      i.textContent = c.icon;
      const l = document.createElement("span");
      l.textContent = c.label;
      b.append(i, l);
      return b;
    }));
  }

  function renderItems() {
    const q = $("e-search").value.trim().toLowerCase();
    const box = $("e-items");
    const shown = PAL.items.filter(it => (q ? it.search.includes(q) || T(it.label).toLowerCase().includes(q) : it.cat === cat));
    const parts = [];
    let group = null;
    for (const it of shown) {
      const gName = q ? PAL.CATS.find(c => c.id === it.cat).label : it.group || "";
      if (gName !== group) {
        group = gName;
        if (gName) { const h = document.createElement("h4"); h.textContent = T(gName); parts.push(h); }
      }
      const b = document.createElement("button");
      b.type = "button";
      b.className = `pal${item && item.id === it.id ? " active" : ""}`;
      b.dataset.id = it.id;
      b.title = `${T(it.label)}${it.key ? ` (${it.key.toUpperCase()})` : ""}`;
      const ib = document.createElement("span");
      ib.className = "ib";
      ib.append(PAL.iconFor(it));
      const l = document.createElement("span");
      l.className = "lbl";
      l.textContent = it.label;
      b.append(ib, l);
      parts.push(b);
    }
    if (!shown.length) { const p = document.createElement("p"); p.className = "muted"; p.textContent = T("Nic takového v paletě není."); parts.push(p); }
    box.replaceChildren(...parts);
  }

  $("e-cats").addEventListener("click", ev => {
    const b = ev.target.closest("button[data-cat]");
    if (!b) return;
    cat = b.dataset.cat;
    $("e-search").value = "";
    renderCats();
    renderItems();
  });

  $("e-items").addEventListener("click", ev => {
    const b = ev.target.closest("button[data-id]");
    if (!b) return;
    setItem(PAL.get(b.dataset.id));
    setTool("draw");
    if (window.matchMedia("(max-width: 900px)").matches) document.body.classList.remove("left-open");
  });

  $("e-search").addEventListener("input", renderItems);
  $("e-search").addEventListener("keydown", ev => {
    if (ev.key === "Enter") { const first = $("e-items").querySelector("button[data-id]"); if (first) first.click(); $("e-search").blur(); }
    if (ev.key === "Escape") { $("e-search").value = ""; renderItems(); $("e-search").blur(); }
  });

  function setItem(it) {
    item = it;
    cat = it.cat;
    prefs.item = it.id;
    savePrefs();
    renderCats();
    renderItems();
    renderOptions();
    const active = $("e-items").querySelector(".pal.active");
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  function renderOptions() {
    const it = tool === "erase" ? null : item;
    const mode = modeOf(it);
    $("o-item-name").textContent = tool === "erase" ? T("Guma") : tool === "select" ? T("Výběr") : tool === "pick" ? T("Kapátko") : tool === "hand" ? T("Posun pohledu") : it ? T(it.label) : "";
    $("o-item-sub").textContent = "";
    const drawing = tool === "draw" && it;
    const modes = $("o-modes");
    modes.hidden = !drawing || it.modes.length < 2;
    if (drawing) {
      const labels = STROKES[it.kind] ? MODE_LABEL_STROKE : MODE_LABEL;
      modes.replaceChildren(...it.modes.map(m => {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.mode = m;
        b.className = m === mode ? "active" : "";
        b.title = T(labels[m][1]);
        b.textContent = labels[m][0];
        const s = document.createElement("small");
        s.textContent = labels[m][1];
        b.append(s);
        return b;
      }));
    }
    const sizeRow = $("o-size-row");
    const showSize = tool === "erase" || (drawing && it.size && (STROKES[it.kind] || mode === "brush" || (CIRCLES[it.kind])));
    sizeRow.hidden = !showSize;
    if (showSize) {
      const s = tool === "erase" ? ["Poloměr gumy", 4, 200, 20] : it.size;
      const v = tool === "erase" ? prefs.size.erase || 20 : sizeOf(it);
      $("o-size-label").textContent = T(s[0]);
      $("o-size").min = s[1];
      $("o-size").max = s[2];
      $("o-size").value = v;
      $("o-size-val").textContent = v;
    }
    const pointy = drawing && POINTS[it.kind] && it.kind !== "base" && it.kind !== "gold" && it.kind !== "building";
    $("o-density-row").hidden = !(pointy && mode !== "point");
    $("o-density").value = prefs.density;
    $("o-density-val").textContent = prefs.density;
    $("o-shape-row").hidden = !(tool === "erase" || (drawing && mode === "brush" && !STROKES[it.kind]));
    for (const r of document.querySelectorAll("input[name=o-shape]")) r.checked = r.value === prefs.shape;
    $("o-mix-row").hidden = !(drawing && (it.kind === "tree" && it.value >= 0 || it.kind === "prop"));
    $("o-mix").checked = !!prefs.mix;
    $("o-main-row").hidden = !(drawing && it.kind === "road" && !it.main);
    $("o-amount-row").hidden = !(drawing && it.kind === "gold");
    $("o-team-row").hidden = !(drawing && (it.kind === "unit" || it.kind === "building"));
    $("o-erase-row").hidden = tool !== "erase";
    const hint = tool === "select" ? "Táhni obdélník pro výběr (Shift přidává). Vybrané objekty táhni pro posun. Ctrl+C, Ctrl+V, Ctrl+D, Delete."
      : tool === "pick" ? "Klikni na objekt v mapě: vybere se stejná položka palety."
      : tool === "erase" ? "Maže jen viditelné vrstvy. Se symetrií maže i zrcadlově."
      : tool === "hand" ? "Táhni mapu. Kolečko nebo dva prsty přibližují."
      : it ? it.hint : "";
    $("o-hint").hidden = !hint;
    $("o-hint").textContent = T(hint || "");
    renderTeams();
  }

  function renderTeams() {
    const box = $("o-teams");
    if (!box || $("o-team-row").hidden) return;
    if (!doc.bases.length) { box.replaceChildren(Object.assign(document.createElement("span"), { className: "muted", textContent: T("Nejdřív přidej základnu.") })); return; }
    prefs.team = clamp(prefs.team, 0, doc.bases.length - 1);
    box.replaceChildren(...doc.bases.map((b, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.team = i;
      btn.className = `team${prefs.team === i ? " active" : ""}`;
      btn.style.setProperty("--tc", undeadBase(i) ? "#d65a3c" : teamCss(i));
      btn.textContent = undeadBase(i) ? "☠" : String(i + 1);
      btn.title = `${T("Základna")} ${i + 1} · ${T(R.TEAM_NAMES[teamOf(i)])}${undeadBase(i) ? ` · ${T("nemrtví")}` : ""}`;
      return btn;
    }));
  }

  $("o-teams").addEventListener("click", ev => {
    const b = ev.target.closest("button[data-team]");
    if (!b) return;
    prefs.team = Number(b.dataset.team);
    savePrefs();
    renderTeams();
  });

  $("o-modes").addEventListener("click", ev => {
    const b = ev.target.closest("button[data-mode]");
    if (!b || !item) return;
    prefs.mode[item.id] = b.dataset.mode;
    savePrefs();
    renderOptions();
    scheduleDraw();
  });

  $("o-size").addEventListener("input", ev => {
    const v = Number(ev.target.value);
    if (tool === "erase") prefs.size.erase = v;
    else if (item) prefs.size[item.id] = v;
    $("o-size-val").textContent = v;
    savePrefs();
    scheduleDraw();
  });
  $("o-density").addEventListener("input", ev => { prefs.density = Number(ev.target.value); $("o-density-val").textContent = prefs.density; savePrefs(); });
  for (const r of document.querySelectorAll("input[name=o-shape]")) r.addEventListener("change", () => { prefs.shape = r.value; savePrefs(); scheduleDraw(); });
  $("o-mix").addEventListener("change", ev => { prefs.mix = ev.target.checked; savePrefs(); });

  /* ---------- nástroje ---------- */
  function setTool(name) {
    tool = name;
    if (name !== "select") { selection = []; }
    pasting = false;
    $("e-pastebar").hidden = true;
    for (const b of document.querySelectorAll("#e-toolset button")) b.classList.toggle("active", b.dataset.tool === name);
    renderOptions();
    renderSelbar();
    updateCursor(hover);
    scheduleDraw();
  }

  $("e-toolset").addEventListener("click", ev => {
    const b = ev.target.closest("button[data-tool]");
    if (!b) return;
    setTool(b.dataset.tool);
    b.blur();
  });

  for (const id of ["e-mx", "e-my", "e-mr", "e-m4"]) $(id).addEventListener("change", () => {
    if (id === "e-m4" && $(id).checked && Math.abs(W() - H()) > 1) { $(id).checked = false; say("Čtyřnásobná symetrie potřebuje čtvercovou mapu.", "error"); }
    scheduleDraw();
  });
  $("e-grid").addEventListener("change", ev => { view.grid = ev.target.checked; scheduleDraw(); });
  $("e-real").addEventListener("change", ev => { if (ev.target.checked !== view.real) toggleReal(); });
  $("e-zin").addEventListener("click", () => zoomTo(zoom * 1.5));
  $("e-zout").addEventListener("click", () => zoomTo(zoom / 1.5));
  $("e-zfit").addEventListener("click", () => { fitView(); scheduleDraw(); showCoords(); });

  /* ---------- vrstvy a záložky ---------- */
  function toggleLayer(id) {
    prefs.layers[id] = !visible(id);
    savePrefs();
    renderLayers();
    scheduleDraw();
  }

  function renderLayers() {
    $("e-layers").replaceChildren(...LAYERS.map(([id, label]) => {
      const li = document.createElement("li");
      const l = document.createElement("label");
      l.className = "check";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = visible(id);
      cb.addEventListener("change", () => toggleLayer(id));
      l.append(cb, ` ${T(label)}`);
      li.append(l);
      return li;
    }));
  }

  document.querySelector(".info .tabs").addEventListener("click", ev => {
    const b = ev.target.closest("button[data-tab]");
    if (!b) return;
    for (const t of document.querySelectorAll(".info .tabs button")) t.classList.toggle("active", t === b);
    for (const p of document.querySelectorAll(".info [data-pane]")) p.hidden = p.dataset.pane !== b.dataset.tab;
  });

  // panely na úzké obrazovce (telefon): vysouvací šuplíky
  $("e-left-toggle").addEventListener("click", () => { document.body.classList.toggle("left-open"); document.body.classList.remove("right-open"); });
  $("e-right-toggle").addEventListener("click", () => { document.body.classList.toggle("right-open"); document.body.classList.remove("left-open"); scheduleMini(); });
  stage.addEventListener("pointerdown", () => { document.body.classList.remove("left-open", "right-open"); }, true);

  /* ---------- klávesy ---------- */
  const KEYS = { v: "select", e: "erase", i: "pick" };
  const ITEM_KEYS = Object.fromEntries(PAL.build().filter(it => it.key).map(it => [it.key, it.id]));

  document.addEventListener("keydown", ev => {
    if (ev.target.matches("input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select") || document.querySelector("dialog[open]")) return;
    const key = ev.key.toLowerCase();
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && key === "z") { ev.preventDefault(); if (ev.shiftKey) stepHistory(redo, undo); else stepHistory(undo, redo); } else if (mod && key === "y") { ev.preventDefault(); stepHistory(redo, undo); } else if (mod && key === "s") { ev.preventDefault(); save(); } else if (mod && key === "o") { ev.preventDefault(); openDialog(); } else if (mod && key === "a") { ev.preventDefault(); setTool("select"); selectAll(); } else if (mod && key === "c") { if (selection.length) { ev.preventDefault(); copySel(); } } else if (mod && key === "v") { ev.preventDefault(); startPaste(); } else if (mod && key === "d") { ev.preventDefault(); duplicateSel(); } else if (mod && key === "f") { ev.preventDefault(); document.body.classList.add("left-open"); $("e-search").focus(); } else if (mod) {
      /* nic */
    } else if (ev.key === "F5") { ev.preventDefault(); testPlay(); } else if (ev.code === "Space") { ev.preventDefault(); spaceDown = true; updateCursor(hover); } else if (key === "/") { ev.preventDefault(); $("e-search").focus(); } else if (KEYS[key]) setTool(KEYS[key]);
    else if (key === "h" && !ITEM_KEYS.h) setTool("hand");
    else if (ITEM_KEYS[key]) { setItem(PAL.get(ITEM_KEYS[key])); setTool("draw"); } else if (key === "0") { fitView(); scheduleDraw(); showCoords(); } else if (key === "1") zoomTo(1);
    else if (key === "2") zoomTo(2);
    else if (key === "+" || key === "=") zoomTo(zoom * 1.5);
    else if (key === "-") zoomTo(zoom / 1.5);
    else if (key === "r" && ev.shiftKey) toggleReal();
    else if (key === "[" || key === "]") {
      const it = tool === "erase" ? { id: "erase", size: ["", 4, 200, 20] } : item;
      if (!it || !it.size) return;
      const v = clamp(Math.round((tool === "erase" ? prefs.size.erase || 20 : sizeOf(it)) * (key === "]" ? 1.2 : 1 / 1.2)), it.size[1], it.size[2]);
      if (tool === "erase") prefs.size.erase = v; else prefs.size[it.id] = v;
      renderOptions();
      scheduleDraw();
    } else if (key.startsWith("arrow")) {
      ev.preventDefault();
      if (selection.length && tool === "select") {
        const d = ev.shiftKey ? 10 : 1;
        mutate(() => { for (const s of selection) shift(s.key, s.o, key === "arrowleft" ? -d : key === "arrowright" ? d : 0, key === "arrowup" ? -d : key === "arrowdown" ? d : 0); });
      } else {
        const d = ev.shiftKey ? 240 : 80;
        panBy(key === "arrowleft" ? -d : key === "arrowright" ? d : 0, key === "arrowup" ? -d : key === "arrowdown" ? d : 0);
      }
    } else if (key === "delete" || key === "backspace") {
      if (selection.length) deleteSel();
      else if (hover) { const hit = pickAny(hover); if (hit) mutate(() => { if (hit.kind === "water" && hit.o.g) doc.water = doc.water.filter(s => s.g !== hit.o.g); else removeRef(hit); }); }
    } else if (key === "escape") {
      closePopup();
      if (pasting) { pasting = false; $("e-pastebar").hidden = true; scheduleDraw(); } else if (selection.length) { selection = []; renderSelbar(); }
    }
  });

  document.addEventListener("keyup", ev => {
    if (ev.code !== "Space" || !spaceDown) return;
    spaceDown = false;
    updateCursor(hover);
  });

  window.addEventListener("beforeunload", ev => { if (dirty) ev.preventDefault(); });

  /* ---------- start ---------- */
  function boot() {
    loadPrefs();
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      const { doc: clean } = draft ? MAPS.normalizeDoc(draft) : { doc: null };
      if (clean) doc = clean;
      else if (draft && draft.format === DOC.FORMAT) doc = { ...blank(), ...draft };
    } catch (e) { /* poškozený koncept */ }
    groupSeq = 1 + Math.max(0, ...doc.water.map(s => s.g || 0));

    PAL.build();
    item = PAL.get(prefs.item) || PAL.get("water");
    cat = item.cat;
    renderCats();
    renderItems();
    renderLayers();
    setTool("draw");
    renderHistory();
    resizeCanvas();
    changed(false);
    refreshServerList().then(openFromQuery);
    // pulsující značky problémů
    setInterval(() => { if (spots.length && visible("problems")) scheduleDraw(); }, 120);
    // překlad: po změně jazyka znovu vykreslit paletu a popisky
    window.addEventListener("pk-lang", () => { renderItems(); renderCats(); renderOptions(); renderLayers(); validate(); });
  }

  // /editor?map=id otevře mapu ze serveru.
  function openFromQuery() {
    let id = "";
    try { id = new URLSearchParams(location.search).get("map") || ""; } catch (e) { return; }
    if (!id) return;
    const mine = serverMaps.find(m => m.id === id);
    if (mine) return adopt(mine, true);
    say(`Mapa „${id}“ nebyla nalezena.`, "error");
  }

  // pro testy a ladění (konzole): dokument a převod souřadnic
  PK.editor = {
    get doc() { return doc; },
    get problems() { return problems; },
    artToScreen: (x, y) => { const box = canvas.getBoundingClientRect(); return [box.left + (x - cam.x) * zoom, box.top + (y - cam.y) * zoom]; },
    setItem: id => { setItem(PAL.get(id)); setTool("draw"); },
    setTool, centerOn, zoomTo, validate, setMode: (id, m) => { prefs.mode[id] = m; renderOptions(); }
  };

  boot();
})();
