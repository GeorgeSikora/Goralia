/*
 * Editor map: štětce pro vodu, cesty, stromy, doly a základny. Mapa je dokument goralia-map (viz maps.js),
 * který se ukládá na server (maps/<id>.json) nebo stahuje jako soubor. Pohled je okno do mapy (posun a zoom),
 * takže zvládne i mapy 10 000 × 10 000 jednotek.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const R = PK.rules;
  const MAPS = PK.maps;
  const CHECK = PK.mapcheck;
  const DOC = MAPS.DOC;
  const $ = id => document.getElementById(id);

  const DRAFT_KEY = "goralia-editor-draft";
  const UNDO_MAX = 60;
  const ID_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;
  const MIN_ZOOM = 0.02;
  const MAX_ZOOM = 8;
  const BIG_AREA = 4e6; // art px²; nad tuto plochu je pečení skutečného vzhledu pomalé

  const canvas = $("e-canvas");
  const g = canvas.getContext("2d");
  const stage = $("e-stage");
  const statusEl = $("e-status");
  const popup = $("e-popup");

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const r1 = v => Math.round(v * 10) / 10;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const teamCss = i => PK.css(PK.TEAM[R.TEAMS[i]].ui);

  const blank = () => ({
    format: DOC.FORMAT, version: DOC.VERSION, id: "", name: "", description: "",
    size: [640, 400], seed: 1, autoRoads: true, bases: [], gold: [], trees: [], water: [], roads: []
  });

  const TOOLS = {
    move: { hint: "Táhni základnu, důl nebo strom. Prázdné místo posouvá mapu." },
    water: { size: ["Šířka řeky", 2, 20] },
    road: { size: ["Šířka cesty", 2, 12], main: true },
    tree: { size: ["Poloměr štětce", 4, 200] },
    gold: { amount: true, hint: "Klikni pro nový důl, táhni pro přesun." },
    base: { hint: "Klikni pro novou základnu (2–6), táhni pro přesun." },
    erase: { size: ["Poloměr gumy", 4, 200], erase: true }
  };

  /* ---------- stav ---------- */
  let doc = blank();
  let tool = "water";
  const sizes = { water: 6, road: 4, tree: 20, erase: 20 };
  const view = { real: false, grid: true, zones: true };
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
  let savedId = "";
  let problems = [];
  let scene = null;
  let sceneFresh = false;
  let bakeSeq = 0;
  let lastBake = "";
  let layoutCache = null;
  let propsMode = "props";
  let propsIdTouched = false;
  let popupOwner = null;
  const undo = [];
  const redo = [];
  const timers = { draw: 0, validate: 0, bake: 0, draft: 0, status: 0 };

  const W = () => doc.size[0];
  const H = () => doc.size[1];
  const LW = () => doc.size[0] * 2;
  const LH = () => doc.size[1] * 2;
  const isBig = () => W() * H() > BIG_AREA;

  /* ---------- pomocné ---------- */
  function say(text, kind = "") {
    statusEl.textContent = text;
    statusEl.className = `status ${kind}`;
    clearTimeout(timers.status);
    timers.status = setTimeout(() => { statusEl.className = "status"; showCoords(); }, 3500);
  }

  function showCoords() {
    if (statusEl.className.includes("error") || statusEl.className.includes("ok")) return;
    const pos = hover ? `x ${Math.round(hover[0] * 2)}, y ${Math.round(hover[1] * 2)} · ` : "";
    statusEl.textContent = `${pos}mapa ${LW()} × ${LH()} · přiblížení ${Math.round(zoom * 100)} %`;
  }

  const slug = text => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 31);

  const mirrors = () => ({ x: $("e-mx").checked, y: $("e-my").checked });

  // Bod a jeho zrcadlové kopie podle zapnutých os (w, h = rozměr prostoru, ve kterém se zrcadlí).
  function orbit(x, y, w, h) {
    const m = mirrors();
    const out = [[x, y]];
    if (m.x) out.push([w - x, y]);
    if (m.y) out.push([x, h - y]);
    if (m.x && m.y) out.push([w - x, h - y]);
    return out;
  }

  const uniq = (pts, gap) => pts.filter((p, i) => pts.findIndex(q => dist(p, q) < gap) === i);

  // Je bod (logické souřadnice) blíž než `extra` art px od hrany nějaké vody? Cesty přes vodu se záměrně ignorují.
  const nearWater = (lx, ly, extra) => doc.water.some(s => segDist([lx / 2, ly / 2], s.pts) < s.hw + extra);

  function layout() {
    if (!layoutCache) {
      const zones = MAPS.zonesFor(doc.bases, LW(), LH());
      layoutCache = doc.bases.map((b, i) => MAPS.baseAt(b.x, b.y, LW(), LH(), zones[i]));
    }

    return layoutCache;
  }

  function totalPoints() {
    return doc.water.reduce((n, s) => n + s.pts.length, 0) + doc.roads.reduce((n, s) => n + s.pts.length, 0);
  }

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

  /* ---------- historie a změny ---------- */
  const snapshot = () => JSON.stringify(doc);

  function remember(before) {
    undo.push(before);
    if (undo.length > UNDO_MAX) undo.shift();
    redo.length = 0;
  }

  function restore(json) {
    doc = JSON.parse(json);
    changed();
  }

  function stepHistory(from, to) {
    if (!from.length) return;
    to.push(snapshot());
    restore(from.pop());
  }

  function changed(markDirty = true) {
    if (markDirty) dirty = true;
    layoutCache = null;
    sceneFresh = false;
    renderTitle();
    scheduleDraw();
    clearTimeout(timers.validate);
    timers.validate = setTimeout(validate, isBig() ? 1200 : 500);
    clearTimeout(timers.draft);
    timers.draft = setTimeout(saveDraft, 800);
    if (view.real && !isBig()) scheduleBake();
  }

  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, snapshot()); } catch (e) { /* úložiště nedostupné nebo plné */ }
  }

  function renderTitle() {
    const t = $("e-title");
    t.replaceChildren(`${doc.name.trim() || "Bez názvu"}${dirty ? " ●" : ""} `);
    const small = document.createElement("small");
    small.textContent = `${LW()}×${LH()}`;
    t.append(small);

    const play = $("e-play");
    const known = serverMaps.some(m => m.id === doc.id) && savedId === doc.id && !dirty;
    play.hidden = !known;
    if (known) play.href = `index.html?map=${encodeURIComponent(doc.id)}`;
  }

  // Nahradí dokument jiným (otevření, nová mapa) a vyčistí historii.
  function replaceDoc(next, saved) {
    undo.length = 0;
    redo.length = 0;
    doc = next;
    dirty = false;
    savedId = saved;
    scene = null;
    needFit = true;
    resizeCanvas();
    changed(false);
  }

  function applySize(w, h) {
    if (w === W() && h === H()) return;

    doc.size = [w, h];
    const keep = ([x, y]) => x >= 0 && x <= w * 2 && y >= 0 && y <= h * 2;
    doc.trees = doc.trees.filter(keep);
    doc.gold = doc.gold.filter(keep);
    doc.bases = doc.bases.filter(keep);
    for (const s of [...doc.water, ...doc.roads]) s.pts = s.pts.map(([x, y]) => [clamp(x, 0, w), clamp(y, 0, h)]);
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
    zoom = clamp(Math.min((vw - 40) / W(), (vh - 40) / H()), MIN_ZOOM, MAX_ZOOM);
    cam.x = W() / 2 - vw / zoom / 2;
    cam.y = H() / 2 - vh / zoom / 2;
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

  function zoomTo(value) {
    zoomAt(value / zoom, vw / 2, vh / 2);
  }

  function panBy(dx, dy) {
    cam.x += dx / zoom;
    cam.y += dy / zoom;
    clampCam();
    scheduleDraw();
  }

  function centerOn(p) {
    cam.x = p[0] - vw / zoom / 2;
    cam.y = p[1] - vh / zoom / 2;
    clampCam();
    scheduleDraw();
  }

  new ResizeObserver(resizeCanvas).observe(stage);

  const eventPoint = ev => {
    const box = canvas.getBoundingClientRect();
    return [clamp(cam.x + (ev.clientX - box.left) / zoom, 0, W()), clamp(cam.y + (ev.clientY - box.top) / zoom, 0, H())];
  };

  /* ---------- objekty pod kurzorem ---------- */
  function pick(p, kinds = ["base", "gold", "tree"]) {
    const tol = 10 / zoom;
    const near = (x, y, min) => Math.hypot(x / 2 - p[0], y / 2 - p[1]) < Math.max(min, tol);

    for (const kind of kinds) {
      const list = kind === "base" ? doc.bases : kind === "gold" ? doc.gold : doc.trees;
      const min = kind === "base" ? 8 : kind === "gold" ? 6 : 3;

      for (let i = list.length - 1; i >= 0; i--) {
        const o = list[i];
        const x = Array.isArray(o) ? o[0] : o.x;
        const y = Array.isArray(o) ? o[1] : o.y;
        if (near(x, y, min)) return { kind, i };
      }
    }

    return null;
  }

  function pickStroke(p) {
    const tol = 3 / zoom;

    for (let i = doc.roads.length - 1; i >= 0; i--) if (segDist(p, doc.roads[i].pts) <= doc.roads[i].w + tol) return { kind: "road", i };
    for (let i = doc.water.length - 1; i >= 0; i--) if (segDist(p, doc.water[i].pts) <= doc.water[i].hw + tol) return { kind: "water", i };
    return null;
  }

  function removeObject(hit) {
    const list = hit.kind === "base" ? doc.bases : hit.kind === "gold" ? doc.gold : hit.kind === "tree" ? doc.trees : hit.kind === "road" ? doc.roads : doc.water;
    list.splice(hit.i, 1);
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

  /* ---------- nástroje: tahy (voda, cesta) ---------- */
  function beginStroke(kind, p) {
    const list = kind === "water" ? doc.water : doc.roads;
    const max = kind === "water" ? DOC.MAX_WATER : DOC.MAX_ROADS;
    const starts = orbit(p[0], p[1], W(), H());

    if (list.length + starts.length > max) return say(`Víc tahů už se nevejde (nejvýše ${max}).`, "error");

    const strokes = starts.map(([x, y]) => (kind === "water"
      ? { pts: [[r1(x), r1(y)]], hw: sizes.water }
      : { pts: [[r1(x), r1(y)]], w: sizes.road, main: $("o-main").checked }));

    list.push(...strokes);
    Object.assign(drag, { kind, strokes, last: p });
  }

  function extendStroke(p) {
    if (Math.hypot(p[0] - drag.last[0], p[1] - drag.last[1]) < Math.max(3, 2 / zoom)) return;

    if (drag.strokes[0].pts.length >= DOC.MAX_PTS || totalPoints() + drag.strokes.length > DOC.MAX_TOTAL_PTS) {
      return say("Tah je příliš dlouhý. Pusť tlačítko a začni nový.", "error");
    }

    const o = orbit(p[0], p[1], W(), H());
    drag.strokes.forEach((s, i) => s.pts.push([r1(o[i][0]), r1(o[i][1])]));
    drag.last = p;
  }

  function finishStroke() {
    for (const s of drag.strokes) if (s.pts.length < 2) s.pts.push([s.pts[0][0] + 0.5, s.pts[0][1]]);
  }

  /* ---------- nástroje: stromy, doly, základny ---------- */
  function farFromBases(x, y, hq, rax) {
    return layout().every(s => Math.hypot(x - s.hq.x, y - s.hq.y) > hq && Math.hypot(x - s.buildings[0].x, y - s.buildings[0].y) > rax);
  }

  function treeOk(x, y, pending) {
    if (x < 30 || x > LW() - 30 || y < 30 || y > LH() - 30) return false;
    if (nearWater(x, y, 3)) return false;
    if (doc.trees.some(t => Math.hypot(t[0] - x, t[1] - y) < 26) || pending.some(t => Math.hypot(t[0] - x, t[1] - y) < 26)) return false;
    if (doc.gold.some(m => Math.hypot(m[0] - x, m[1] - y) < 60)) return false;
    return farFromBases(x, y, 120, 90);
  }

  function sprayTrees(p) {
    const radius = sizes.tree;
    const count = clamp(Math.round(radius / 5), 1, 40);
    const pending = [];

    for (let k = 0; k < count && doc.trees.length + pending.length < DOC.MAX_TREES - 3; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * radius;
      const x = Math.round((p[0] + Math.cos(a) * d) * 2);
      const y = Math.round((p[1] + Math.sin(a) * d) * 2);
      const group = uniq(orbit(x, y, LW(), LH()), 20);

      if (group.every(([gx, gy]) => treeOk(gx, gy, pending)) && group.every((q, i) => group.every((o, j) => j <= i || dist(q, o) >= 26))) {
        pending.push(...group);
      }
    }

    doc.trees.push(...pending);
  }

  function mineOk(x, y, ignore = -1) {
    if (x < 30 || x > LW() - 30 || y < 30 || y > LH() - 30) return "Důl je moc u okraje.";
    if (nearWater(x, y, 10)) return "Důl nemůže stát ve vodě ani u ní.";
    if (doc.gold.some((m, i) => i !== ignore && Math.hypot(m[0] - x, m[1] - y) <= 70)) return "Doly by se dotýkaly.";
    if (!farFromBases(x, y, 110, 0)) return "Důl je moc blízko základny.";
    return "";
  }

  function addMines(p, amount = Number($("o-amount").value)) {
    const group = uniq(orbit(Math.round(p[0] * 2), Math.round(p[1] * 2), LW(), LH()), 70);
    let problem = "";

    for (const [x, y] of group) {
      problem = mineOk(x, y);
      if (problem) break;
      if (doc.gold.length >= DOC.MAX_GOLD) { problem = `Nejvýše ${DOC.MAX_GOLD} dolů.`; break; }
      doc.gold.push(amount === R.GOLD_AMOUNT ? [x, y] : [x, y, amount]);
    }

    if (problem) say(problem, "error");
  }

  function addBases(p) {
    const group = uniq(orbit(Math.round(p[0] * 2), Math.round(p[1] * 2), LW(), LH()), 150);

    for (const [x, y] of group) {
      if (doc.bases.length >= R.MAX_PLAYERS) return say(`Nejvýše ${R.MAX_PLAYERS} základen.`, "error");
      if (doc.bases.some(b => Math.hypot(b.x - x, b.y - y) < 300)) return say("Základny musí být od sebe aspoň 300 jednotek.", "error");
      doc.bases.push({ x, y });
    }
  }

  function fillMines() {
    let added = 0;

    mutate(() => {
      for (const b of doc.bases) {
        for (const [x, y] of MAPS.baseMinesFor(b.x, b.y, LW(), LH())) {
          const spot = [Math.round(x), Math.round(y)];
          if (doc.gold.length < DOC.MAX_GOLD && !mineOk(spot[0], spot[1])) { doc.gold.push(spot); added++; }
        }
      }
    });

    if (added) say(`Přidáno dolů: ${added}.`, "ok");
    else say("Žádný další důl se nevešel (je blízko vody, okraje nebo jiného dolu).", "error");
  }

  /* ---------- guma ---------- */
  function eraseAt(p) {
    const what = $("o-erase").value;
    const radius = sizes.erase;
    const hit = (x, y) => Math.hypot(x / 2 - p[0], y / 2 - p[1]) < radius;

    if (what === "all" || what === "tree") doc.trees = doc.trees.filter(([x, y]) => !hit(x, y));
    if (what === "all" || what === "gold") doc.gold = doc.gold.filter(([x, y]) => !hit(x, y));
    if (what === "all" || what === "base") doc.bases = doc.bases.filter(b => !hit(b.x, b.y));
    if (what === "all" || what === "water") doc.water = doc.water.filter(s => segDist(p, s.pts) >= radius + s.hw);
    if (what === "all" || what === "road") doc.roads = doc.roads.filter(s => segDist(p, s.pts) >= radius + s.w);
  }

  /* ---------- myš ---------- */
  function updateCursor(p) {
    let cursor = "crosshair";

    if (pan) cursor = "grabbing";
    else if (spaceDown) cursor = "grab";
    else if (tool === "move") cursor = p && pick(p) ? "move" : "grab";

    canvas.style.cursor = cursor;
  }

  canvas.addEventListener("pointerdown", ev => {
    if (ev.button === 2) return;
    ev.preventDefault();
    closePopup();
    canvas.setPointerCapture(ev.pointerId);

    const p = eventPoint(ev);
    const startPan = () => {
      pan = { x: ev.clientX, y: ev.clientY, cx: cam.x, cy: cam.y };
      updateCursor(p);
    };

    if (ev.button === 1 || spaceDown) return startPan();
    if (ev.button !== 0) return;

    layoutCache = null;
    drag = { kind: "none", before: snapshot(), remembered: false };

    if (tool === "water" || tool === "road") {
      beginStroke(tool, p);
    } else if (tool === "tree") {
      drag.kind = "brush";
      sprayTrees(p);
    } else if (tool === "erase") {
      drag.kind = "brush";
      eraseAt(p);
    } else {
      const kinds = tool === "gold" ? ["gold"] : tool === "base" ? ["base"] : ["base", "gold", "tree"];
      const hit = pick(p, kinds);

      if (hit) {
        drag.kind = "move";
        drag.hit = hit;
      } else if (tool === "gold") {
        addMines(p);
      } else if (tool === "base") {
        addBases(p);
      } else {
        drag = null;
        return startPan();
      }
    }

    touched();
    changed();
  });

  // Změna uvnitř táhnutí se do historie zapíše jednou, při první skutečné změně dokumentu.
  function touched() {
    if (drag && !drag.remembered && snapshot() !== drag.before) {
      remember(drag.before);
      drag.remembered = true;
    }
  }

  canvas.addEventListener("pointermove", ev => {
    const p = eventPoint(ev);
    hover = p;
    scheduleDraw();
    showCoords();

    if (pan) {
      cam.x = pan.cx - (ev.clientX - pan.x) / zoom;
      cam.y = pan.cy - (ev.clientY - pan.y) / zoom;
      clampCam();
      return;
    }

    if (!drag) return updateCursor(p);
    if (!(ev.buttons & 1)) return;

    if (drag.kind === "water" || drag.kind === "road") extendStroke(p);
    else if (drag.kind === "move") moveObject(drag.hit, p);
    else if (drag.kind === "brush" && tool === "tree") sprayTrees(p);
    else if (drag.kind === "brush" && tool === "erase") eraseAt(p);
    else return;

    layoutCache = null;
    touched();
    changed();
  });

  function moveObject(hit, p) {
    const x = Math.round(p[0] * 2);
    const y = Math.round(p[1] * 2);

    if (hit.kind === "base") {
      doc.bases[hit.i].x = x;
      doc.bases[hit.i].y = y;
    } else {
      const o = hit.kind === "gold" ? doc.gold[hit.i] : doc.trees[hit.i];
      o[0] = x;
      o[1] = y;
    }
  }

  function endDrag() {
    if (pan) {
      pan = null;
      updateCursor(hover);
    }

    if (!drag) return;

    if (drag.kind === "water" || drag.kind === "road") finishStroke();
    touched();
    drag = null;
    changed();
  }

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", () => { hover = null; scheduleDraw(); showCoords(); });

  canvas.addEventListener("wheel", ev => {
    ev.preventDefault();
    const box = canvas.getBoundingClientRect();
    zoomAt(Math.exp(-clamp(ev.deltaY, -200, 200) * 0.0016), ev.clientX - box.left, ev.clientY - box.top);
  }, { passive: false });

  /* ---------- nabídky ---------- */
  // Jedna plovoucí nabídka slouží pro lištu i pro pravé tlačítko na plátně. Položka "-" je oddělovač.
  function openPopup(items, x, y, owner = null) {
    closePopup();

    popup.replaceChildren(...items.map(it => {
      if (it === "-") {
        const sep = document.createElement("div");
        sep.className = "sep";
        return sep;
      }

      if (it.head) {
        const head = document.createElement("div");
        head.className = "head";
        head.textContent = it.head;
        return head;
      }

      const b = document.createElement("button");
      b.type = "button";
      b.className = "item";
      b.disabled = !!it.disabled;
      const label = document.createElement("span");
      label.textContent = `${it.checked ? "✓ " : it.checked === false ? "\u2003" : ""}${it.label}`;
      b.append(label);

      if (it.hint) {
        const kbd = document.createElement("kbd");
        kbd.textContent = it.hint;
        b.append(kbd);
      }

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
      { label: "Vlastnosti mapy…", run: () => openProps("props") },
      "-",
      { label: "Stáhnout JSON", run: download },
      { label: "Importovat ze souboru…", run: () => $("e-file").click() },
      { label: "Smazat ze serveru…", disabled: !serverMaps.some(m => m.id === savedId), run: () => deleteMap(savedId) }
    ],
    edit: () => [
      { label: "Zpět", hint: "Ctrl+Z", disabled: !undo.length, run: () => stepHistory(undo, redo) },
      { label: "Znovu", hint: "Ctrl+Shift+Z", disabled: !redo.length, run: () => stepHistory(redo, undo) },
      "-",
      { label: "Doplnit doly základnám", run: fillMines },
      { label: "Nové zrno terénu", run: () => mutate(() => { doc.seed = Math.floor(Math.random() * 1000000); }) }
    ],
    view: () => [
      { label: "Přiblížit", hint: "+", run: () => zoomTo(zoom * 1.5) },
      { label: "Oddálit", hint: "−", run: () => zoomTo(zoom / 1.5) },
      { label: "Celá mapa", hint: "0", run: () => { fitView(); scheduleDraw(); showCoords(); } },
      { label: "Měřítko 100 %", hint: "1", run: () => zoomTo(1) },
      "-",
      { label: "Skutečný vzhled", checked: view.real, run: toggleReal },
      { label: "Obnovit skutečný vzhled", disabled: !view.real, run: bake },
      { label: "Mřížka", checked: view.grid, run: () => { view.grid = !view.grid; scheduleDraw(); } },
      { label: "Území základen", checked: view.zones, run: () => { view.zones = !view.zones; scheduleDraw(); } }
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

  // Pravé tlačítko: nabídka podle toho, co leží pod kurzorem.
  canvas.addEventListener("contextmenu", ev => {
    ev.preventDefault();
    const p = eventPoint(ev);
    const hit = pick(p);
    const stroke = hit ? null : pickStroke(p);
    const items = [];

    if (hit && hit.kind === "base") {
      items.push({ head: `Základna ${hit.i + 1}` }, { label: "Smazat základnu", run: () => mutate(() => removeObject(hit)) });
    } else if (hit && hit.kind === "gold") {
      const m = doc.gold[hit.i];
      const amount = m[2] || R.GOLD_AMOUNT;
      items.push({ head: "Zlatý důl · zásoba" });
      for (const v of [1000, 2000, 4000, 8000]) {
        items.push({ label: v.toLocaleString("cs"), checked: amount === v, run: () => mutate(() => { doc.gold[hit.i] = v === R.GOLD_AMOUNT ? [m[0], m[1]] : [m[0], m[1], v]; }) });
      }
      items.push("-", { label: "Smazat důl", run: () => mutate(() => removeObject(hit)) });
    } else if (hit) {
      items.push({ label: "Smazat strom", run: () => mutate(() => removeObject(hit)) });
    } else if (stroke && stroke.kind === "road") {
      const road = doc.roads[stroke.i];
      items.push({ head: "Cesta" }, { label: "Hlavní cesta (širší brod)", checked: !!road.main, run: () => mutate(() => { road.main = !road.main; }) },
        { label: "Smazat cestu", run: () => mutate(() => removeObject(stroke)) });
    } else if (stroke) {
      items.push({ head: "Voda" }, { label: "Smazat tah vody", run: () => mutate(() => removeObject(stroke)) });
    }

    if (items.length) items.push("-");
    items.push(
      { head: "Přidat sem" },
      { label: "Základnu", run: () => { layoutCache = null; mutate(() => addBases(p)); } },
      { label: "Zlatý důl", run: () => { layoutCache = null; mutate(() => addMines(p)); } },
      "-",
      { label: "Vycentrovat pohled sem", run: () => centerOn(p) }
    );

    openPopup(items, ev.clientX, ev.clientY);
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
    const step = [20, 40, 100, 200, 500, 1000, 2500].find(s => s * zoom >= 22) || 2500;

    g.strokeStyle = "rgba(255,255,255,0.07)";
    g.lineWidth = u;
    g.beginPath();
    for (let x = Math.max(0, Math.ceil(x0 / step) * step); x <= Math.min(W(), x1); x += step) { g.moveTo(x, Math.max(0, y0)); g.lineTo(x, Math.min(H(), y1)); }
    for (let y = Math.max(0, Math.ceil(y0 / step) * step); y <= Math.min(H(), y1); y += step) { g.moveTo(Math.max(0, x0), y); g.lineTo(Math.min(W(), x1), y); }
    g.stroke();
  }

  function drawObjects(u, x0, y0, x1, y1) {
    for (const s of doc.water) strokeLine(s.pts, s.hw, "#2f6fb0");
    for (const s of doc.roads) strokeLine(s.pts, s.w, s.main ? "#b09060" : "#8a7048");

    const tr = Math.max(3.4, 2 * u);
    g.fillStyle = "#1f4a2a";
    g.beginPath();

    for (const [lx, ly] of doc.trees) {
      const x = lx / 2;
      const y = ly / 2;
      if (x < x0 - tr || x > x1 + tr || y < y0 - tr || y > y1 + tr) continue;
      g.moveTo(x + tr, y);
      g.arc(x, y, tr, 0, Math.PI * 2);
    }

    g.fill();

    const s = Math.max(5, 4 * u);

    for (const m of doc.gold) {
      const x = m[0] / 2;
      const y = m[1] / 2;
      g.fillStyle = "#ffd36b";
      g.strokeStyle = "#6a4a10";
      g.lineWidth = Math.min(1.5 * u, s / 3);
      g.beginPath();
      g.moveTo(x, y - s); g.lineTo(x + s, y); g.lineTo(x, y + s); g.lineTo(x - s, y);
      g.closePath();
      g.fill();
      g.stroke();

      if (m[2] && zoom > 0.8) {
        g.fillStyle = "#15121f";
        g.font = `${3.4}px monospace`;
        g.textAlign = "center";
        g.fillText(`${m[2] / 1000}k`, x, y + 1.2);
      }
    }
  }

  function drawBases(u) {
    layout().forEach((s, i) => {
      const color = teamCss(i);
      const z = s.zone;

      if (view.zones) {
        g.setLineDash([6 * u, 5 * u]);
        g.strokeStyle = color;
        g.globalAlpha = 0.7;
        g.lineWidth = 1.5 * u;
        g.strokeRect(z.x0 / 2, z.y0 / 2, (z.x1 - z.x0) / 2, (z.y1 - z.y0) / 2);
        g.setLineDash([]);
        g.globalAlpha = 1;
      }

      const bar = s.buildings[0];
      g.fillStyle = color;
      g.globalAlpha = 0.55;
      g.fillRect(bar.x / 2 - 6, bar.y / 2 - 4, 12, 8);
      g.globalAlpha = 1;

      const x = s.hq.x / 2;
      const y = s.hq.y / 2;
      const r = Math.max(8, 7 * u);
      g.fillStyle = "#15121f";
      g.beginPath();
      g.arc(x, y, r * 1.2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = color;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#15121f";
      g.font = `bold ${r * 1.5}px monospace`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(i + 1), x, y + r * 0.1);
      g.textBaseline = "alphabetic";
    });
  }

  function cursorRadius() {
    return tool === "road" ? sizes.road : tool === "water" ? sizes.water : tool === "tree" ? sizes.tree : tool === "erase" ? sizes.erase : 0;
  }

  function drawCursor(u, x0, y0, x1, y1) {
    const m = mirrors();

    if (m.x || m.y) {
      g.setLineDash([4 * u, 6 * u]);
      g.strokeStyle = "rgba(255,255,255,0.35)";
      g.lineWidth = u;
      g.beginPath();
      if (m.x) { g.moveTo(W() / 2, y0); g.lineTo(W() / 2, y1); }
      if (m.y) { g.moveTo(x0, H() / 2); g.lineTo(x1, H() / 2); }
      g.stroke();
      g.setLineDash([]);
    }

    const radius = cursorRadius();
    if (!hover || !radius || pan || spaceDown) return;

    g.strokeStyle = "rgba(255,255,255,0.8)";
    g.lineWidth = u;

    for (const [x, y] of orbit(hover[0], hover[1], W(), H())) {
      g.beginPath();
      g.arc(x, y, radius, 0, Math.PI * 2);
      g.stroke();
    }
  }

  function draw() {
    const u = 1 / zoom;
    const x0 = cam.x;
    const y0 = cam.y;
    const x1 = cam.x + vw * u;
    const y1 = cam.y + vh * u;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#0b0914";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.setTransform(zoom * dpr, 0, 0, zoom * dpr, -cam.x * zoom * dpr, -cam.y * zoom * dpr);
    g.imageSmoothingEnabled = false;

    g.fillStyle = "#2f5d34";
    g.fillRect(0, 0, W(), H());
    if (view.grid) drawGrid(u, x0, y0, x1, y1);
    drawObjects(u, x0, y0, x1, y1);

    if (view.real && scene) {
      g.globalAlpha = sceneFresh ? 1 : 0.4;
      g.drawImage(scene, 0, 0);
      g.globalAlpha = 1;
    }

    drawBases(u);
    g.strokeStyle = "#6a5a9a";
    g.lineWidth = 2 * u;
    g.strokeRect(0, 0, W(), H());
    drawCursor(u, x0, y0, x1, y1);
  }

  /* ---------- skutečný vzhled ---------- */
  function toggleReal() {
    if (!view.real && isBig() && !confirm("Skutečný vzhled velké mapy se peče déle (desítky sekund) a potřebuje hodně paměti. Pokračovat?")) return;
    view.real = !view.real;
    if (view.real) bake(); else scheduleDraw();
  }

  function scheduleBake() {
    clearTimeout(timers.bake);
    timers.bake = setTimeout(bake, 450);
  }

  function compile() {
    const probe = JSON.parse(snapshot());
    if (!ID_RE.test(probe.id)) probe.id = "nova-mapa";
    if (!probe.name.trim()) probe.name = "Mapa";

    const { doc: clean, errors } = MAPS.normalizeDoc(probe);
    return clean ? { map: MAPS.compileDoc(clean), errors: [] } : { map: null, errors };
  }

  function bake() {
    const { map, errors } = compile();
    if (!map) return say(errors[0], "error");

    say("Peču skutečný vzhled…");

    setTimeout(() => {
      map.id = `__editor${++bakeSeq}`;
      if (lastBake) PK.world.forget(lastBake);
      lastBake = map.id;

      PK.world.build(map);
      const [w, h] = map.size;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const bg = c.getContext("2d");
      bg.imageSmoothingEnabled = false;

      PK.world.drawGround(bg, 0, { x: 0, y: 0, w, h });
      for (const d of PK.world.doodads) bg.drawImage(d.spr.c, d.x - d.spr.ax, d.y - d.spr.ay);

      for (const [x, y] of [...map.trees].sort((a, b) => a[1] - b[1])) {
        const t = PK.props.trees[(x * 7 + y) % 3 | 0];
        bg.drawImage(t.trunk, x / 2 - t.ax, y / 2 + 15 - t.ay);
        bg.drawImage(t.crown[0], x / 2 - t.ax, y / 2 + 15 - t.ay);
      }

      for (const [x, y] of map.gold) {
        const m = PK.props.mine;
        bg.drawImage(m.c, x / 2 - m.ax, y / 2 + 13 - m.ay);
      }

      map.slots.forEach((s, i) => {
        for (const b of [s.hq, ...s.buildings]) {
          const spr = PK.buildings.get(b.type, R.TEAMS[i]);
          bg.drawImage(spr.c, b.x / 2 - spr.ax, b.y / 2 + 19 - spr.ay);
        }
      });

      scene = c;
      sceneFresh = true;
      say("Skutečný vzhled je hotový.", "ok");
      scheduleDraw();
    }, 20);
  }

  /* ---------- kontrola mapy ---------- */
  function validate() {
    clearTimeout(timers.validate);
    const own = [];
    if (!ID_RE.test(doc.id)) own.push("Vyplň identifikátor mapy (a–z, 0–9, pomlčka).");
    if (!doc.name.trim()) own.push("Vyplň název mapy.");

    const { map, errors } = compile();
    let list = errors;

    if (map) {
      try { list = CHECK.check(map); } catch (e) { list = [`Mapu se nepodařilo zkontrolovat: ${e.message}`]; }
    }

    problems = [...own, ...list];

    const items = problems.length ? problems : ["Mapa je v pořádku a lze ji hrát."];
    $("e-problems").replaceChildren(...items.map(text => {
      const li = document.createElement("li");
      li.textContent = text;
      if (!problems.length) li.className = "ok";
      return li;
    }));

    $("e-summary").textContent =
      `Hráči: ${doc.bases.length} · doly: ${doc.gold.length} · stromy: ${doc.trees.length} · voda: ${doc.water.length} · cesty: ${doc.roads.length}`;
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

    renderTitle();
  }

  function adopt(raw, fromServer) {
    const { doc: clean, errors } = MAPS.normalizeDoc(raw);
    if (!clean) return say(errors[0], "error");

    replaceDoc(clean, fromServer ? clean.id : "");
    say(`Otevřeno: ${clean.name}.`, "ok");
  }

  // Vestavěné mapy nejsou soubory; z jejich dat se sestaví přibližná upravitelná kopie.
  function docFromBuiltin(m) {
    const water = m.terrain.rivers.map(r => {
      if (!r.legacy) return { pts: r.pts, hw: r.hw };
      const pts = [];
      for (let y = 0; y <= m.size[1]; y += 10) pts.push([MAPS.brookX(y), y]);
      return { pts, hw: 6 };
    });

    return {
      format: DOC.FORMAT, version: DOC.VERSION,
      id: slug(`${m.id}-kopie`), name: `${m.name} (kopie)`.slice(0, 32), description: m.description,
      size: m.size, seed: 1, autoRoads: false,
      bases: m.slots.map(s => ({ x: s.hq.x, y: s.hq.y })),
      gold: m.gold.map(gm => gm.slice(0, 3)),
      trees: m.trees,
      water,
      roads: m.terrain.roads.filter(r => r.pts && r.pts.length > 1).map(r => ({ pts: r.pts, w: r.w, main: !!r.main }))
    };
  }

  async function save() {
    validate();
    if (!ID_RE.test(doc.id) || !doc.name.trim()) return openProps("save");
    if (problems.length) return say("Nejdřív oprav problémy v kontrole mapy.", "error");

    try {
      const res = await fetch(`/api/maps/${encodeURIComponent(doc.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: snapshot()
      });
      const data = await res.json().catch(() => ({}));

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
    const blob = new Blob([JSON.stringify(doc, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${doc.id || "mapa"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function deleteMap(id) {
    if (!id || !confirm(`Opravdu smazat mapu „${id}“ ze serveru?`)) return;

    try {
      const res = await fetch(`/api/maps/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) return say("Mapu se nepodařilo smazat.", "error");

      if (savedId === id) { savedId = ""; dirty = true; }
      await refreshServerList();
      say(`Smazáno: ${id}.`, "ok");
    } catch (e) {
      say("Server není dostupný.", "error");
    }
  }

  const confirmDiscard = () => !dirty || confirm("Neuložené změny se ztratí. Pokračovat?");

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
      del.textContent = "Smazat";
      del.addEventListener("click", ev => { ev.stopPropagation(); onDelete(); });
      row.append(del);
    }

    return row;
  }

  function renderOpenList() {
    const box = $("o-list");
    const parts = [];
    const head = text => {
      const h = document.createElement("h3");
      h.textContent = text;
      return h;
    };

    parts.push(head("Moje mapy"));

    if (!serverUp) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Server není dostupný. Mapu lze otevřít ze souboru.";
      parts.push(p);
    } else if (!serverMaps.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Zatím nemáš žádnou uloženou mapu.";
      parts.push(p);
    }

    for (const m of serverMaps) {
      parts.push(mapRow(m.name, `${m.id} · ${m.size[0] * 2}×${m.size[1] * 2} · hráčů: ${m.bases.length}`, () => {
        if (!confirmDiscard()) return;
        adopt(m, true);
        $("d-open").close();
      }, async () => { await deleteMap(m.id); renderOpenList(); }));
    }

    parts.push(head("Vestavěné mapy (otevřou se jako kopie)"));

    for (const m of MAPS.list.filter(x => MAPS.isBuiltIn(x.id))) {
      parts.push(mapRow(m.name, `${m.size[0] * 2}×${m.size[1] * 2} · hráčů: ${m.players}`, () => {
        if (!confirmDiscard()) return;
        adopt(docFromBuiltin(m), false);
        dirty = true;
        renderTitle();
        $("d-open").close();
      }));
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

  /* ---------- dialog Vlastnosti ---------- */
  const PROPS_TITLE = { new: "Nová mapa", props: "Vlastnosti mapy", save: "Uložit mapu", saveas: "Uložit jako…" };

  function openProps(mode) {
    propsMode = mode;
    const d = mode === "new" ? blank() : doc;
    const copy = mode === "saveas";

    $("p-title").textContent = PROPS_TITLE[mode];
    $("p-ok").textContent = mode === "new" ? "Vytvořit" : mode === "props" ? "OK" : "Uložit";
    $("p-name").value = copy ? `${d.name} (kopie)`.slice(0, 32) : d.name;
    $("p-id").value = copy ? `${d.id}-kopie`.slice(0, 31) : d.id;
    $("p-desc").value = d.description;
    $("p-w").value = d.size[0] * 2;
    $("p-h").value = d.size[1] * 2;
    $("p-seed").value = d.seed;
    $("p-auto").checked = d.autoRoads !== false;
    $("p-error").textContent = "";
    propsIdTouched = mode === "props" ? !!d.id : false;
    if (copy) propsIdTouched = true;
    $("d-props").showModal();
    $("p-name").focus();
    $("p-name").select();
  }

  $("p-name").addEventListener("input", ev => {
    if (!propsIdTouched) $("p-id").value = slug(ev.target.value);
  });

  $("p-id").addEventListener("input", () => { propsIdTouched = true; });
  $("p-dice").addEventListener("click", () => { $("p-seed").value = Math.floor(Math.random() * 1000000); });
  $("p-cancel").addEventListener("click", () => $("d-props").close());

  $("f-props").addEventListener("submit", async ev => {
    ev.preventDefault();

    const name = $("p-name").value.trim();
    const id = $("p-id").value.trim().toLowerCase();
    const w = clamp(Math.round(Number($("p-w").value) / 40) * 20, DOC.MIN_W, DOC.MAX_W);
    const h = clamp(Math.round(Number($("p-h").value) / 40) * 20, DOC.MIN_H, DOC.MAX_H);
    const fail = text => { $("p-error").textContent = text; };

    if (!name) return fail("Vyplň název mapy.");
    if (!ID_RE.test(id)) return fail("Identifikátor: 1 až 31 znaků a–z, 0–9 a pomlčka.");
    if (MAPS.isBuiltIn(id)) return fail("Tento identifikátor patří vestavěné mapě.");
    if (!Number.isFinite(w) || !Number.isFinite(h)) return fail("Zadej rozměry mapy.");

    const saving = propsMode === "save" || propsMode === "saveas";
    if (saving && id !== savedId && serverMaps.some(m => m.id === id) && !confirm(`Mapa „${id}“ už na serveru je. Přepsat?`)) return;

    if (propsMode === "new") {
      const next = blank();
      Object.assign(next, { name, id, size: [w, h] });
      next.description = $("p-desc").value;
      next.seed = clamp(Math.round(Number($("p-seed").value)) || 1, 0, 999999);
      next.autoRoads = $("p-auto").checked;
      $("d-props").close();
      replaceDoc(next, "");
      return;
    }

    mutate(() => {
      doc.name = name;
      doc.id = id;
      doc.description = $("p-desc").value;
      doc.seed = clamp(Math.round(Number($("p-seed").value)) || 0, 0, 999999);
      doc.autoRoads = $("p-auto").checked;
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

  /* ---------- panel nástrojů ---------- */
  function setTool(name) {
    tool = name;
    const t = TOOLS[name];

    for (const b of document.querySelectorAll("#e-tools button")) b.classList.toggle("active", b.dataset.tool === name);

    $("o-size-row").hidden = !t.size;
    $("o-main-row").hidden = !t.main;
    $("o-amount-row").hidden = !t.amount;
    $("o-erase-row").hidden = !t.erase;
    $("o-hint").hidden = !t.hint;
    $("o-hint").textContent = t.hint || "";

    if (t.size) {
      const input = $("o-size");
      $("o-size-label").textContent = t.size[0];
      input.min = t.size[1];
      input.max = t.size[2];
      input.value = sizes[name];
      $("o-size-val").textContent = sizes[name];
    }

    updateCursor(hover);
    scheduleDraw();
  }

  $("o-size").addEventListener("input", ev => {
    sizes[tool] = Number(ev.target.value);
    $("o-size-val").textContent = ev.target.value;
    scheduleDraw();
  });

  $("e-tools").addEventListener("click", ev => {
    const b = ev.target.closest("button[data-tool]");
    if (!b) return;
    setTool(b.dataset.tool);
    b.blur();
  });

  $("e-mx").addEventListener("change", scheduleDraw);
  $("e-my").addEventListener("change", scheduleDraw);

  /* ---------- klávesy ---------- */
  const KEYS = { v: "move", w: "water", r: "road", t: "tree", g: "gold", b: "base", e: "erase" };

  document.addEventListener("keydown", ev => {
    if (ev.target.matches("input, textarea, select") || document.querySelector("dialog[open]")) return;
    const key = ev.key.toLowerCase();
    const mod = ev.ctrlKey || ev.metaKey;

    if (mod && key === "z") {
      ev.preventDefault();
      if (ev.shiftKey) stepHistory(redo, undo); else stepHistory(undo, redo);
    } else if (mod && key === "y") {
      ev.preventDefault();
      stepHistory(redo, undo);
    } else if (mod && key === "s") {
      ev.preventDefault();
      save();
    } else if (mod && key === "o") {
      ev.preventDefault();
      openDialog();
    } else if (mod) {
      return;
    } else if (ev.code === "Space") {
      ev.preventDefault();
      spaceDown = true;
      updateCursor(hover);
    } else if (KEYS[key]) {
      setTool(KEYS[key]);
    } else if (key === "0") {
      fitView();
      scheduleDraw();
      showCoords();
    } else if (key === "1") {
      zoomTo(1);
    } else if (key === "+" || key === "=") {
      zoomTo(zoom * 1.5);
    } else if (key === "-") {
      zoomTo(zoom / 1.5);
    } else if (key.startsWith("arrow")) {
      ev.preventDefault();
      const d = ev.shiftKey ? 240 : 80;
      panBy(key === "arrowleft" ? -d : key === "arrowright" ? d : 0, key === "arrowup" ? -d : key === "arrowdown" ? d : 0);
    } else if ((key === "delete" || key === "backspace") && hover) {
      const hit = pick(hover) || pickStroke(hover);
      if (hit) mutate(() => removeObject(hit));
    } else if (key === "escape") {
      closePopup();
    }
  });

  document.addEventListener("keyup", ev => {
    if (ev.code !== "Space" || !spaceDown) return;
    spaceDown = false;
    updateCursor(hover);
  });

  window.addEventListener("beforeunload", ev => {
    if (dirty) ev.preventDefault();
  });

  /* ---------- start ---------- */
  function boot() {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      const { doc: clean } = draft ? MAPS.normalizeDoc(draft) : { doc: null };

      // koncept s neúplným názvem či id se normalizací odmítne; vezme se aspoň surově
      if (clean) doc = clean;
      else if (draft && draft.format === DOC.FORMAT) doc = { ...blank(), ...draft };
    } catch (e) { /* poškozený koncept */ }

    setTool("water");
    resizeCanvas();
    changed(false);
    refreshServerList();
  }

  boot();
})();
