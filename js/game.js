/*
 * Klient hry: vstup, kamera, menu a lobby, vykreslování.
 * Pravidla a souboje počítá simulace (js/sim.js): na serveru v online hře,
 * v prohlížeči ve hře proti AI. Klient dostává stejné snímky v obou režimech.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const { C } = PK;
  const U = PK.units;
  const fx = PK.fx;
  const world = PK.world;
  const audio = PK.audio;
  const R = PK.rules;
  const MAPS = PK.maps;
  const sim = PK.sim;
  const net = PK.net;
  const account = PK.account;
  const view = PK.view;

  const canvas = document.querySelector("#game");
  const display = canvas.getContext("2d");
  const { c: bufCanvas, g } = PK.makeCanvas(view.w, view.h);

  const costs = R.COSTS;

  const names = {
    worker: "Dělník",
    soldier: "Voják",
    archer: "Lučištník",
    hero: "Hrdina",
    hall: "Gmina",
    barracks: "Kasárna",
    tower: "Strážní věž",
    hut: "Buda",
    smithy: "Kovárna",
    citadel: "Rudá pevnost"
  };

  let units;
  let buildings;
  let resources;
  let selected;

  let gold;
  let wood;
  let elapsed;
  let state;
  let placement;
  let commandMode;
  let spellMode;
  let message;
  let messageTimer;

  let pointerStart = null;
  let pointerEnd = null;
  let mouse = { x: -100, y: -100 };
  let pressedBtn = null;
  let keyPress = null;
  let endT = 0;
  let clock = 0;
  let battleLevel = 0;
  let lastBattle = 0;
  let hover = null;

  // "ai": hra proti počítačům, simulace běží tady. "online": o všem rozhoduje server.
  let mode = "ai";
  let map = MAPS.get(MAPS.DEFAULT);
  let mySlot = 0;
  let me = R.TEAMS[0];
  let players = [];
  let simMatch = null;
  let simAcc = 0;
  let matchPhase = ""; // countdown | playing | ended
  let matchOver = true;
  let endWhy = "";
  let ownOutWhy = "";

  // Kamera v art px (levý horní roh viditelné části světa); camF je přesná, cam zaokrouhlená pro kreslení.
  const cam = { x: 0, y: 0 };
  const camF = { x: 0, y: 0 };
  let panning = null;
  let minimapDrag = false;

  // Přiblížení světa (násobek měřítka bufferu). Ustálí se vždy na celém násobku nebo zlomku 1/n,
  // jinak by se pixely škálovaly nerovnoměrně; mezi stupni se plynule animuje.
  const ZOOMS = [1 / 3, 0.5, 1, 2, 3, 4];
  let zoom = 1;
  let zoomAnim = null;

  // Dotyk: prsty na mapě, gesto jednoho prstu, štípnutí, setrvačnost posunu a cíl rozpracované akce.
  const touches = new Map();
  let touchGesture = null;
  let pinch = null;
  let fling = null;
  let lastTap = null;
  let lastTouchAt = 0;
  let aim = null;
  let selectedResourceId = 0;
  let supplyCap = R.SUPPLY_BASE;
  let upgrades = { armor: 0, weapon: 0 };
  let focus = "";
  let focusKey = "";
  const keysDown = new Set();

  const UNIT_TYPES = sim.UNIT_TYPES;
  const BUILDING_TYPES = sim.BUILDING_TYPES;
  const ORDER_TYPES = [null, "move", "attack", "gather", "deliver", "build"];

  const online = {
    phase: "offline", // offline | connecting | idle | room | countdown | playing | ended
    rooms: [],
    playing: 0,
    total: 0,
    roomId: 0,
    firstSnapshot: true,
    pendingTrain: 0,
    pendingBuild: 0,
    server: "",
    count: 0,
    error: ""
  };

  const unitMap = new Map();
  const buildingMap = new Map();
  const resourceMap = new Map();
  const alive = entity => !!entity && entity.hp > 0;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const xpNeeded = level => level * 40;
  const hash3 = (a, b, c) => PK.hash(a, b, c);

  const FAIL_MSG = /^(Potřebuješ|Nejdřív|Pro stavbu|Současně|Maximum|Stavět lze|Na tomto|Hrdina už|Cíl je|Ohnivá koule: ještě|Léčení: ještě|Tento výzkum|Kovárna|Zbroj:|Zbraně:)/;

  function announce(value) {
    message = value;
    messageTimer = 3;
    if (FAIL_MSG.test(value)) audio.play("error");
  }

  /* ======================= match lifecycle ======================= */
  const teamCss = team => PK.css(PK.TEAM[team].ui);

  function reset() {
    units = [];
    buildings = [];
    resources = [];
    selected = [];
    unitMap.clear();
    buildingMap.clear();
    resourceMap.clear();
    online.firstSnapshot = true;

    gold = 0;
    wood = 0;
    upgrades = { armor: 0, weapon: 0 };
    elapsed = 0;
    state = "playing";
    placement = null;
    commandMode = false;
    spellMode = null;
    message = "";
    messageTimer = 0;
    pointerStart = null;
    pointerEnd = null;
    pressedBtn = null;
    panning = null;
    minimapDrag = false;
    resetTouch();
    endT = 0;
    matchPhase = "";
    matchOver = true;
    endWhy = "";
    ownOutWhy = "";
    simMatch = null;
    simAcc = 0;
  }

  // Postaví terén mapy (jednou na mapu) a vycentruje kameru na vlastní základnu.
  function loadMap(next, slot) {
    map = next;
    world.build(map);
    fx.reset();

    const hq = map.slots[slot || 0].hq;
    centerCamera(hq.x, hq.y);
  }

  // cfg: { mode, map, slot, players: [{ slot, name, ai }] }
  function beginMatch(cfg) {
    reset();
    mode = cfg.mode;
    mySlot = cfg.slot;
    me = R.TEAMS[mySlot];
    loadMap(cfg.map, mySlot);
    players = cfg.players.map(p => ({
      slot: p.slot, name: p.name, team: R.TEAMS[p.slot], ai: !!p.ai, out: false, me: p.slot === mySlot
    }));
    matchOver = false;
    matchPhase = "countdown";
    started = true;

    if (mode === "ai") {
      const roster = map.slots.map((_, i) => {
        const p = players.find(q => q.slot === i);
        return p ? { name: p.name, ai: p.ai } : null;
      });
      simMatch = new sim.Match(map, roster, { countdown: 0 });
      applySnapshot(simMatch.snapshot(me));
      simMatch.endTick();
    } else {
      online.phase = "countdown";
    }

    closeMenu();
  }

  function pumpSim(dt) {
    if (!simMatch || matchOver) return;

    simAcc += dt;
    let stepped = false;

    while (simAcc >= sim.TICK && simMatch.phase !== "ended") {
      simAcc -= sim.TICK;
      simMatch.step(sim.TICK);
      stepped = true;
    }

    if (stepped) {
      applySnapshot(simMatch.snapshot(me));
      simMatch.endTick();
    }
  }

  // Rozkazy jdou stejnou cestou v obou režimech: na server, nebo přímo do místní simulace.
  function sendCmd(cmd) {
    if (mode === "online") net.send({ t: "cmd", ...cmd });
    else if (simMatch) simMatch.command(me, cmd);
  }

  function playerOut(slot, why) {
    const p = players.find(q => q.slot === slot);
    if (p) p.out = true;
    if (slot !== mySlot || state !== "playing") return;

    state = "lose";
    ownOutWhy = why;
    placement = null;
    spellMode = null;
    commandMode = false;
    audio.play("lose");
    syncMenu();
  }

  function finishMatch(winner, why) {
    if (matchOver) return;

    matchOver = true;
    matchPhase = "ended";
    endWhy = why;
    endT = 0;
    if (mode === "online") online.phase = "ended";

    if (state === "playing") {
      state = winner === mySlot ? "win" : winner < 0 ? "draw" : "lose";
      placement = null;
      spellMode = null;
      commandMode = false;
      audio.play(state === "win" ? "win" : "lose");
    }

    syncMenu();
  }

  function selectedHero() {
    return selected.find(entity =>
      entity.kind === "unit" &&
      entity.type === "hero" &&
      alive(entity)
    );
  }

  // Typ, který se právě ovládá (nabídka tlačítek); Tab přepíná mezi typy ve výběru.
  const FOCUS_ORDER = ["hero", "worker", "soldier", "archer", "hall", "citadel", "barracks", "tower", "hut", "smithy"];

  function selectionTypes() {
    const present = new Set(selected.map(e => e.type));
    return FOCUS_ORDER.filter(t => present.has(t));
  }

  function focusType() {
    const types = selectionTypes();
    const key = types.join(",");

    if (key !== focusKey || !types.includes(focus)) {
      focusKey = key;
      focus = types[0] || "";
    }

    return focus;
  }

  function cycleFocus() {
    const types = selectionTypes();
    if (types.length < 2) return;

    focus = types[(types.indexOf(focusType()) + 1) % types.length];
    audio.play("click");
  }

  function cardContext() {
    const f = focusType();
    const e = selected.find(s => s.type === f);
    if (!e) return "none";

    if (e.kind === "unit") return f === "hero" ? "hero" : f === "worker" ? "worker" : "army";
    if (e.progress < 1) return "none";
    return f === "hall" || f === "citadel" ? "hq" : f === "barracks" ? "barracks" : f === "smithy" ? "smithy" : "none";
  }

  // Klik na avatar ve výběru: jedna jednotka; Shift ji ze výběru vyjme, Ctrl vybere všechny stejného typu.
  function pickAvatar(index, event) {
    const u = selected[index];
    if (!u) return;

    if (event.shiftKey) selected = selected.filter(e => e !== u);
    else if (event.ctrlKey || event.metaKey) selected = selected.filter(e => e.type === u.type);
    else selected = [u];

    audio.play("select");
    speak(selected, "select");
  }

  function action(type) {
    if (state !== "playing") return;
    audio.unlock();

    if (type === "command") {
      audio.play("click");
      commandMode = !commandMode;
      placement = null;
      spellMode = null;
      announce(
        commandMode
          ? "Klepni na cíl rozkazu."
          : "Rozkaz zrušen."
      );
      return;
    }

    if (type === "fire") {
      const hero = selectedHero();

      if (!hero) return announce("Nejdřív vyber hrdinu.");

      if (hero.fireCooldown > 0) {
        return announce(
          `Ohnivá koule: ještě ${Math.ceil(hero.fireCooldown)} s.`
        );
      }

      spellMode = "fire";
      placement = null;
      commandMode = false;
      audio.play("click");
      announce("Klikni na místo dopadu ohnivé koule.");
      return;
    }

    if (type === "heal") {
      const hero = selectedHero();

      if (!hero) return announce("Nejdřív vyber hrdinu.");

      if (hero.healCooldown > 0) {
        return announce(
          `Léčení: ještě ${Math.ceil(hero.healCooldown)} s.`
        );
      }

      audio.play("click");
      sendCmd({ c: "heal" });
      return;
    }

    if (type === "armor" || type === "weapon") {
      audio.play("click");
      const src = selected.find(e => e.kind === "building" && e.type === "smithy" && e.progress >= 1);
      sendCmd({ c: "research", kind: type, src: src ? src.id : 0 });
      return;
    }

    if (type === "tower" || type === "barracks" || type === "hut" || type === "smithy") {
      const hasWorker = selected.some(entity =>
        entity.kind === "unit" &&
        entity.type === "worker" &&
        alive(entity)
      );

      if (!hasWorker) {
        return announce("Pro stavbu nejdřív vyber dělníka.");
      }

      placement = type;
      spellMode = null;
      commandMode = false;
      audio.play("click");
      announce("Klikni na volné místo ve vlastní části mapy.");
      return;
    }

    audio.play("click");
    online.pendingTrain = 1.5;

    // výcvik probíhá ve vybrané budově
    const src = selected.find(e => e.kind === "building" && e.progress >= 1 && e.type === (type === "worker" ? R.HQ[me] : "barracks"));
    sendCmd({ c: "train", type, src: src ? src.id : 0 });
  }

  /* ======================= picking and orders ======================= */
  function findEntity(x, y, list, radius) {
    for (let i = list.length - 1; i >= 0; i--) {
      const entity = list[i];

      if (
        alive(entity) &&
        Math.hypot(entity.x - x, entity.y - y) < radius
      ) {
        return entity;
      }
    }

    return null;
  }

  // Hláška jednotky: u výběru skupiny mluví hrdina, jinak první jednotka.
  function speak(list, kind) {
    const lead = list.find(e => e.kind === "unit" && e.type === "hero") || list.find(e => e.kind === "unit");
    if (lead) PK.voice.say(lead.type, kind);
  }

  // grow > 1 zvětší oblast výběru (prst je méně přesný než myš)
  function selectAt(x, y, grow = 1) {
    const friendlyUnit = findEntity(
      x, y,
      units.filter(unit => unit.team === me),
      19 * grow
    );

    const friendlyBuilding = findEntity(
      x, y,
      buildings.filter(building => building.team === me),
      42 * grow
    );

    selected = friendlyUnit
      ? [friendlyUnit]
      : friendlyBuilding
        ? [friendlyBuilding]
        : [];

    // Když není nic vlastního, vybere se surovina pod kurzorem (info o zásobě v panelu).
    const res = selected.length ? null : resourceUnder(x, y);
    selectedResourceId = res ? res.id : 0;

    if (selected.length || res) audio.play("select");
    speak(selected, "select");
  }

  // Výběr jednotek v obdélníku daném dvěma světovými body.
  function selectBox(ax, ay, bx, by) {
    const left = Math.min(ax, bx);
    const right = Math.max(ax, bx);
    const top = Math.min(ay, by);
    const bottom = Math.max(ay, by);

    selected = units.filter(unit =>
      alive(unit) &&
      unit.team === me &&
      unit.x >= left &&
      unit.x <= right &&
      unit.y >= top &&
      unit.y <= bottom
    );
    selectedResourceId = 0;
    if (selected.length) audio.play("select");
    speak(selected, "select");
  }

  const selectedResource = () => (selected.length ? null : resourceMap.get(selectedResourceId) || null);

  function enemyAt(x, y) {
    return (
      findEntity(x, y, units.filter(unit => unit.team !== me), 20) ||
      findEntity(x, y, buildings.filter(building => building.team !== me), 46)
    );
  }

  function resourceAt(x, y) {
    return resources.find(item =>
      item.amount > 0 &&
      Math.hypot(item.x - x, item.y - y) <
        (item.type === "gold" ? 31 : 26)
    );
  }

  // i vyčerpaný důl jde vybrat
  function resourceUnder(x, y) {
    return resources.find(item =>
      Math.hypot(item.x - x, item.y - y) <
        (item.type === "gold" ? 31 : 26)
    );
  }

  function issueOrder(x, y) {
    const enemy = enemyAt(x, y);
    const resource = resourceAt(x, y);
    let ordered = false;
    let kind = "move";

    const ids = selected
      .filter(unit => unit.kind === "unit" && alive(unit))
      .map(unit => unit.id);

    if (ids.length) {
      const hasWorker = selected.some(unit => unit.type === "worker" && alive(unit));
      const free = !enemy && !resource;
      const site = free && hasWorker ? findEntity(x, y, buildings.filter(b => b.team === me && b.progress < 1), 46) : null;
      const base = free && !site ? findEntity(x, y, buildings.filter(b => b.team === me && b.type === R.HQ[me]), 46) : null;

      // klik na rozestavěnou budovu: dělník pokračuje ve stavbě; na základnu: vyloží nesený materiál
      kind = enemy ? "attack" : resource ? "gather" : site ? "build" : base && hasWorker ? "deliver" : "move";

      sendCmd({
        c: "order",
        k: kind,
        ids,
        target: enemy ? enemy.id : resource ? resource.id : site ? site.id : kind === "deliver" ? base.id : 0,
        x: Math.round(x),
        y: Math.round(y)
      });

      ordered = true;
    }

    if (ordered) {
      if (kind === "attack") fx.ping(enemy.x, enemy.y + 12, "attack");
      else if (kind === "gather") fx.ping(resource.x, resource.y + (resource.type === "gold" ? 26 : 28), "gather");
      else fx.ping(x, y, "move");
      audio.play("order", { x });
      speak(selected, "order");
    }

    commandMode = false;
  }

  function placementProblem(x, y) {
    const zone = map.slots[mySlot].zone;

    if (
      x < zone.x0 ||
      x > zone.x1 ||
      y < zone.y0 ||
      y > zone.y1
    ) {
      return "Stavět lze jen ve vlastní části mapy.";
    }

    if (PK.nav.forMap(map).isBlockedArea(x, y, 28)) return "Na tomto místě je voda.";

    const collidesWithBuilding = buildings.some(building =>
      alive(building) &&
      distance(building, { x, y }) < 90
    );

    const collidesWithResource = resources.some(resource =>
      (resource.type === "gold" || resource.amount > 0) &&
      distance(resource, { x, y }) < 48
    );

    if (collidesWithBuilding || collidesWithResource) {
      return "Na tomto místě není dost prostoru.";
    }

    return null;
  }

  function placeBuilding(x, y) {
    const problem = placementProblem(x, y);
    if (problem) return announce(problem);

    sendCmd({
      c: "build",
      type: placement,
      x: Math.round(x),
      y: Math.round(y),
      ids: selected.filter(e => e.type === "worker" && alive(e)).map(e => e.id)
    });
    placement = null;
    audio.play("click");
  }

  function castFire(x, y) {
    const hero = selectedHero();
    spellMode = null;

    if (!hero) {
      return announce("Hrdina už není k dispozici.");
    }

    if (distance(hero, { x, y }) > 180) {
      return announce("Cíl je příliš daleko od hrdiny.");
    }

    sendCmd({ c: "fire", x: Math.round(x), y: Math.round(y) });
  }

  /* ======================= camera ======================= */
  const CAM_SPEED = 320; // art px za sekundu
  const EDGE = 10; // pruh u okraje obrazovky (logické jednotky), kde se kamera posouvá

  function setCam(x, y) {
    const mw = map.size[0];
    const mh = map.size[1];
    const vw = view.w / zoom;
    const vh = view.mapH / zoom;
    camF.x = mw <= vw ? -(vw - mw) / 2 : clamp(x, 0, mw - vw);
    camF.y = mh <= vh ? -(vh - mh) / 2 : clamp(y, 0, mh - vh);
    // zaokrouhlení na celé pixely bufferu, ne světa, aby posun při zoomu nezadrhával
    cam.x = Math.round(camF.x * zoom) / zoom;
    cam.y = Math.round(camF.y * zoom) / zoom;
  }

  // x, y ve světových logických jednotkách
  function centerCamera(x, y) {
    setCam(x / 2 - view.w / zoom / 2, y / 2 - view.mapH / zoom / 2);
  }

  // Změní zoom tak, aby bod (ax, ay) na obrazovce (art px) zůstal na stejném místě světa.
  function setZoom(next, ax, ay) {
    const z = clamp(next, ZOOMS[0], ZOOMS[ZOOMS.length - 1]);
    if (z === zoom) return;
    const wx = camF.x + ax / zoom;
    const wy = camF.y + ay / zoom;
    zoom = z;
    setCam(wx - ax / zoom, wy - ay / zoom);
  }

  const nearestZoom = z => ZOOMS.reduce((best, s) => (Math.abs(Math.log(s / z)) < Math.abs(Math.log(best / z)) ? s : best), ZOOMS[0]);

  // Plynule dojede na cílový stupeň; bod (ax, ay) zůstává na místě.
  function animateZoom(target, ax, ay) {
    zoomAnim = target === zoom ? null : { from: zoom, to: target, t: 0, ax, ay };
  }

  function stepZoom(dir, ax, ay) {
    const i = ZOOMS.indexOf(nearestZoom(zoomAnim ? zoomAnim.to : zoom));
    animateZoom(ZOOMS[clamp(i + dir, 0, ZOOMS.length - 1)], ax, ay);
  }

  function updateCamera(dt) {
    let dx = 0;
    let dy = 0;

    if (zoomAnim) {
      const a = zoomAnim;
      a.t = Math.min(1, a.t + dt / 0.18);
      const e = 1 - (1 - a.t) ** 3;
      setZoom(a.from * (a.to / a.from) ** e, a.ax, a.ay);
      if (a.t >= 1) zoomAnim = null;
    }

    // setrvačnost po švihnutí prstem
    if (fling) {
      setCam(camF.x + fling.vx * dt, camF.y + fling.vy * dt);
      const damp = Math.exp(-dt * 4.5);
      fling.vx *= damp;
      fling.vy *= damp;
      if (Math.hypot(fling.vx, fling.vy) < 12) fling = null;
    }

    if (keysDown.has("arrowleft")) dx -= 1;
    if (keysDown.has("arrowright")) dx += 1;
    if (keysDown.has("arrowup")) dy -= 1;
    if (keysDown.has("arrowdown")) dy += 1;

    if (!panning && !minimapDrag && mouse.x >= 0 && document.hasFocus()) {
      const w = view.w * 2;
      const h = view.h * 2;
      if (mouse.x < EDGE) dx -= 1;
      else if (mouse.x > w - EDGE && mouse.x <= w) dx += 1;
      if (mouse.y >= 0 && mouse.y < EDGE) dy -= 1;
      else if (mouse.y > h - EDGE && mouse.y <= h) dy += 1;
    }

    if (dx || dy) setCam(camF.x + clamp(dx, -1, 1) * CAM_SPEED * dt, camF.y + clamp(dy, -1, 1) * CAM_SPEED * dt);
  }

  /* ======================= pointer + keyboard ======================= */
  // Souřadnice obrazovky v logických jednotkách (art px x2); svět = obrazovka + 2 * kamera.
  function pointerPosition(event) {
    const bounds = canvas.getBoundingClientRect();

    return {
      x: (event.clientX - bounds.left) * view.w * 2 / bounds.width,
      y: (event.clientY - bounds.top) * view.h * 2 / bounds.height
    };
  }

  const mapAreaH = () => view.mapH * 2;
  const toWorld = p => ({ x: p.x / zoom + cam.x * 2, y: p.y / zoom + cam.y * 2 });

  canvas.addEventListener("contextmenu", event => {
    event.preventDefault();

    // dlouhé podržení prstu vyvolá contextmenu; to nesmí vydat rozkaz
    if (event.pointerType === "touch" || touches.size || performance.now() - lastTouchAt < 800) return;

    if (state !== "playing") return;

    if (placement || spellMode) {
      placement = null;
      spellMode = null;
      announce("Akce zrušena.");
      return;
    }

    const point = pointerPosition(event);
    const mini = PK.hud.minimapHit(point.x, point.y);

    if (mini) {
      issueOrder(mini.x, mini.y);
    } else if (point.y < mapAreaH()) {
      const w = toWorld(point);
      issueOrder(w.x, w.y);
    }
  });

  canvas.addEventListener("mousedown", event => {
    if (event.button === 1) event.preventDefault();
  });

  canvas.addEventListener("pointerdown", event => {
    audio.unlock();

    if (event.button === 1) {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      panning = { cx: event.clientX, cy: event.clientY, x: camF.x, y: camF.y };
      return;
    }

    if (event.button !== 0) return;

    canvas.setPointerCapture(event.pointerId);
    const point = pointerPosition(event);

    if (event.pointerType === "touch" && point.y < mapAreaH() && !PK.hud.minimapHit(point.x, point.y)) {
      touchDown(event, point);
      return;
    }

    const mini = PK.hud.minimapHit(point.x, point.y);

    if (mini) {
      minimapDrag = true;
      centerCamera(mini.x, mini.y);
      return;
    }

    const w = toWorld(point);
    pointerStart = { x: point.x, y: point.y, wx: w.x, wy: w.y };
    pointerEnd = point;

    const btn = point.y >= mapAreaH() ? PK.hud.hitButton(point.x, point.y) : null;
    pressedBtn = btn ? btn.type : null;
  });

  canvas.addEventListener("pointermove", event => {
    if (touches.has(event.pointerId)) {
      touchMove(event);
      return;
    }

    mouse = pointerPosition(event);

    if (panning) {
      const bounds = canvas.getBoundingClientRect();
      setCam(
        panning.x - (event.clientX - panning.cx) * view.w / bounds.width / zoom,
        panning.y - (event.clientY - panning.cy) * view.h / bounds.height / zoom
      );
      return;
    }

    if (minimapDrag) {
      const mini = PK.hud.minimapHit(mouse.x, mouse.y);
      if (mini) centerCamera(mini.x, mini.y);
      return;
    }

    if (pointerStart) {
      pointerEnd = mouse;
    }
  });

  canvas.addEventListener("pointerleave", () => {
    mouse = { x: -100, y: -100 };
  });

  canvas.addEventListener("pointercancel", event => {
    if (touches.has(event.pointerId)) {
      touchEnd(event, true);
      return;
    }

    pointerStart = null;
    pointerEnd = null;
    pressedBtn = null;
    panning = null;
    minimapDrag = false;
  });

  canvas.addEventListener("pointerup", event => {
    if (touches.has(event.pointerId)) {
      touchEnd(event, false);
      return;
    }

    if (event.button === 1) {
      panning = null;
      return;
    }

    if (event.button !== 0) return;

    if (minimapDrag) {
      minimapDrag = false;
      return;
    }

    if (!pointerStart) return;

    const point = pointerPosition(event);
    const world_ = toWorld(point);
    const start = pointerStart;

    pointerStart = null;
    pointerEnd = null;
    pressedBtn = null;

    if (state !== "playing") return;

    if (start.y >= mapAreaH()) {
      const button = PK.hud.hitButton(point.x, point.y);

      if (button) {
        action(button.type);
      } else {
        const index = PK.hud.selectionHit(point.x, point.y, selected.length);
        if (index >= 0 && index === PK.hud.selectionHit(start.x, start.y, selected.length)) pickAvatar(index, event);
      }

      return;
    }

    if (placement) {
      placeBuilding(world_.x, world_.y);
      return;
    }

    if (spellMode === "fire") {
      castFire(world_.x, world_.y);
      return;
    }

    if (commandMode) {
      issueOrder(world_.x, world_.y);
      return;
    }

    if (Math.hypot(world_.x - start.wx, world_.y - start.wy) > 9) {
      selectBox(world_.x, world_.y, start.wx, start.wy);
    } else {
      selectAt(world_.x, world_.y);
    }
  });

  window.addEventListener("keyup", event => {
    keysDown.delete(event.key.toLowerCase());
  });

  window.addEventListener("blur", () => {
    keysDown.clear();
    panning = null;
    minimapDrag = false;
    resetTouch();
  });

  /* ======================= zoom kolečkem + dotykové ovládání ======================= */
  let wheelAcc = 0;

  canvas.addEventListener("wheel", event => {
    event.preventDefault();
    if (menuOpen || !started || pointerPosition(event).y >= mapAreaH()) return;

    wheelAcc += event.deltaY * (event.deltaMode === 1 ? 33 : 1);
    if (Math.abs(wheelAcc) < 40) return;

    const a = clientToArt(event.clientX, event.clientY);
    stepZoom(wheelAcc < 0 ? 1 : -1, a.x, a.y);
    wheelAcc = 0;
  }, { passive: false });

  // Prst na mapě: klepnutí vybere nebo velí, tažení posouvá kameru (se setrvačností), podržení + tažení
  // vybírá rámečkem, dva prsty zoomují a posouvají, dvojité klepnutí na jednotku vybere všechny stejného typu
  // na obrazovce, dvojité klepnutí do prázdna zruší výběr. HUD a minimapa fungují jako dřív.
  const TAP_SLOP = 10; // css px, do kolika je pohyb stále klepnutí
  const LONG_PRESS = 380; // ms
  const DOUBLE_TAP = 330; // ms
  const FINGER = 1.5; // zvětšení oblasti výběru pod prstem

  function clientToArt(cx, cy) {
    const bounds = canvas.getBoundingClientRect();
    return { x: (cx - bounds.left) * view.w / bounds.width, y: (cy - bounds.top) * view.h / bounds.height };
  }

  // světové logické jednotky na jeden css px
  const worldPerCss = () => view.w * 2 / canvas.getBoundingClientRect().width / zoom;

  function resetTouch() {
    if (touchGesture) {
      clearTimeout(touchGesture.timer);
      if (touchGesture.mode === "box") {
        pointerStart = null;
        pointerEnd = null;
      }
    }

    touches.clear();
    touchGesture = null;
    if (pinch && pinch.mode === "box") {
      pointerStart = null;
      pointerEnd = null;
    }
    pinch = null;
    fling = null;
    lastTap = null;
    aim = null;
  }

  function touchDown(event, point) {
    lastTouchAt = performance.now();
    if (touches.size >= 2) return;

    touches.set(event.pointerId, { cx: event.clientX, cy: event.clientY });
    fling = null;

    if (touches.size === 2) {
      startPinch();
      return;
    }

    const w = toWorld(point);
    const gesture = {
      id: event.pointerId, mode: "tap", sx: event.clientX, sy: event.clientY, px: event.clientX, py: event.clientY,
      lt: lastTouchAt, vx: 0, vy: 0, camX: camF.x, camY: camF.y, wx: w.x, wy: w.y, timer: 0
    };

    gesture.timer = setTimeout(() => {
      if (touchGesture !== gesture || gesture.mode !== "tap" || state !== "playing" || placement || spellMode || commandMode) return;
      gesture.mode = "box";
      pointerStart = { x: point.x, y: point.y, wx: gesture.wx, wy: gesture.wy };
      pointerEnd = point;
      if (navigator.vibrate) navigator.vibrate(12);
    }, LONG_PRESS);

    touchGesture = gesture;
  }

  function touchMove(event) {
    const touch = touches.get(event.pointerId);
    touch.cx = event.clientX;
    touch.cy = event.clientY;
    lastTouchAt = performance.now();

    if (pinch) {
      updatePinch();
      return;
    }

    const gesture = touchGesture;
    if (!gesture || gesture.id !== event.pointerId) return;

    if (gesture.mode === "tap" && Math.hypot(event.clientX - gesture.sx, event.clientY - gesture.sy) > TAP_SLOP) {
      clearTimeout(gesture.timer);
      gesture.mode = "pan";
    }

    if (gesture.mode === "pan") {
      const k = view.w / canvas.getBoundingClientRect().width / zoom;
      setCam(gesture.camX - (event.clientX - gesture.sx) * k, gesture.camY - (event.clientY - gesture.sy) * k);

      const dt = lastTouchAt - gesture.lt;

      if (dt >= 8) {
        gesture.vx = gesture.vx * 0.5 - (event.clientX - gesture.px) * k / (dt / 1000) * 0.5;
        gesture.vy = gesture.vy * 0.5 - (event.clientY - gesture.py) * k / (dt / 1000) * 0.5;
        gesture.px = event.clientX;
        gesture.py = event.clientY;
        gesture.lt = lastTouchAt;
      }
    } else if (gesture.mode === "box") {
      pointerEnd = pointerPosition(event);
    }
  }

  function touchEnd(event, cancelled) {
    lastTouchAt = performance.now();
    touches.delete(event.pointerId);

    if (pinch) {
      if (touches.size < 2) endPinch(cancelled);
      return;
    }

    const gesture = touchGesture;
    if (!gesture || gesture.id !== event.pointerId) return;

    clearTimeout(gesture.timer);
    touchGesture = null;

    if (gesture.mode === "box") {
      pointerStart = null;
      pointerEnd = null;
      if (cancelled || state !== "playing") return;

      const end = toWorld(pointerPosition(event));

      if (Math.hypot(end.x - gesture.wx, end.y - gesture.wy) > 9) selectBox(end.x, end.y, gesture.wx, gesture.wy);
      else touchTap(event);

      return;
    }

    if (cancelled) return;

    if (gesture.mode === "pan") {
      // švihnutí: prst se těsně před puštěním ještě hýbal
      if (lastTouchAt - gesture.lt < 90 && Math.hypot(gesture.vx, gesture.vy) > 60) {
        fling = { vx: clamp(gesture.vx, -1800, 1800), vy: clamp(gesture.vy, -1800, 1800) };
      }

      return;
    }

    touchTap(event);
  }

  // Dva prsty: dokud se vzdálenost mezi nimi znatelně nezmění, určují rohy výběrového rámečku;
  // jakmile se potáhnou nebo stáhnou, jde o zoom a posun mapy.
  function startPinch() {
    if (touchGesture) {
      clearTimeout(touchGesture.timer);
      if (touchGesture.mode === "box") {
        pointerStart = null;
        pointerEnd = null;
      }
      touchGesture = null;
    }

    zoomAnim = null;
    lastTap = null;

    const [a, b] = [...touches.values()];
    const d = Math.max(24, Math.hypot(a.cx - b.cx, a.cy - b.cy));
    const canBox = state === "playing" && !placement && !spellMode && !commandMode;

    pinch = { mode: canBox ? "box" : "zoom", d0: d, z0: zoom, wx: 0, wy: 0, mx: 0, my: 0 };
    if (canBox) setPinchBox(a, b);
    else anchorPinch(a, b, d);
  }

  function anchorPinch(a, b, d) {
    const mid = clientToArt((a.cx + b.cx) / 2, (a.cy + b.cy) / 2);
    pinch.mode = "zoom";
    pinch.z0 = zoom;
    pinch.d0 = d;
    pinch.wx = camF.x + mid.x / zoom;
    pinch.wy = camF.y + mid.y / zoom;
    pinch.mx = mid.x;
    pinch.my = mid.y;
  }

  function setPinchBox(a, b) {
    const pa = clientToArt(a.cx, a.cy);
    const pb = clientToArt(b.cx, b.cy);
    const wa = toWorld({ x: pa.x * 2, y: pa.y * 2 });
    pointerStart = { x: pa.x * 2, y: pa.y * 2, wx: wa.x, wy: wa.y };
    pointerEnd = { x: pb.x * 2, y: pb.y * 2 };
  }

  function updatePinch() {
    const [a, b] = [...touches.values()];
    const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);

    if (pinch.mode === "box") {
      if (Math.abs(Math.log(Math.max(24, d) / pinch.d0)) < 0.2) {
        setPinchBox(a, b);
        return;
      }

      pointerStart = null;
      pointerEnd = null;
      anchorPinch(a, b, Math.max(24, d));
    }

    // Bod světa mezi prsty zůstává pod nimi: stejný výpočet řeší zoom i dvouprstý posun.
    const mid = clientToArt((a.cx + b.cx) / 2, (a.cy + b.cy) / 2);
    pinch.mx = mid.x;
    pinch.my = mid.y;
    zoom = clamp(pinch.z0 * Math.max(24, d) / pinch.d0, ZOOMS[0] * 0.85, ZOOMS[ZOOMS.length - 1] * 1.15);
    setCam(pinch.wx - mid.x / zoom, pinch.wy - mid.y / zoom);
  }

  function endPinch(cancelled) {
    const p = pinch;
    pinch = null;

    if (p.mode === "zoom") {
      animateZoom(nearestZoom(zoom), p.mx, p.my);
      return;
    }

    const start = pointerStart;
    const end = pointerEnd && toWorld(pointerEnd);
    pointerStart = null;
    pointerEnd = null;
    if (cancelled || !start || !end || state !== "playing") return;

    // těsný dotyk dvou prstů bez pohybu nic nevybere
    if (Math.hypot(end.x - start.wx, end.y - start.wy) > 30 * worldPerCss()) selectBox(end.x, end.y, start.wx, start.wy);
  }

  function touchTap(event) {
    if (state !== "playing") return;

    const w = toWorld(pointerPosition(event));

    if (placement || spellMode === "fire") {
      aimTap(w);
      return;
    }

    if (commandMode) {
      touchOrder(w.x, w.y);
      return;
    }

    const now = performance.now();
    const prev = lastTap;
    const again = !!prev && now - prev.t < DOUBLE_TAP && Math.hypot(event.clientX - prev.x, event.clientY - prev.y) < 36;
    const hasUnits = selected.some(e => e.kind === "unit" && alive(e));
    // s vybranými jednotkami klepnutí vedle vlastní postavy nebo budovy velí, ne vybírá
    const reach = hasUnits ? 1 : FINGER;
    const unit = findEntity(w.x, w.y, units.filter(u => u.team === me), 19 * reach);
    const building = unit ? null : findEntity(w.x, w.y, buildings.filter(b => b.team === me), 42 * reach);

    lastTap = { t: now, x: event.clientX, y: event.clientY, type: unit ? unit.type : "" };

    if (unit) {
      if (again && prev.type === unit.type) {
        selectVisible(unit.type);
        lastTap = null;
      } else {
        selectAt(w.x, w.y, reach);
      }

      return;
    }

    const hasWorker = selected.some(e => e.type === "worker" && alive(e));

    if (building) {
      // dělník na rozestavěnou budovu nebo na základnu: pokračuje ve stavbě, vyloží náklad
      if (hasWorker && (building.progress < 1 || building.type === R.HQ[me])) touchOrder(w.x, w.y);
      else selectAt(w.x, w.y, reach);
      return;
    }

    if (again) {
      selected = [];
      selectedResourceId = 0;
      lastTap = null;
      return;
    }

    if (hasUnits) touchOrder(w.x, w.y);
    else selectAt(w.x, w.y, FINGER);
  }

  // Po rozkazu prstem se výběr ruší, aby další klepnutí nevelelo znovu.
  function touchOrder(x, y) {
    issueOrder(x, y);
    selected = [];
    selectedResourceId = 0;
  }

  // Všechny vlastní jednotky daného typu v právě viditelné části mapy.
  function selectVisible(type) {
    const x0 = cam.x * 2;
    const y0 = cam.y * 2;
    const x1 = x0 + view.w / zoom * 2;
    const y1 = y0 + view.mapH / zoom * 2;
    const list = units.filter(u => alive(u) && u.team === me && u.type === type && u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1);

    if (!list.length) return;
    selected = list;
    selectedResourceId = 0;
    audio.play("select");
    speak(selected, "select");
  }

  // Stavba a kouzlo na dotyku: první klepnutí ukáže cíl (prst ho nezakrývá), druhé na stejné místo ho potvrdí.
  function aimTap(w) {
    const near = !!aim && Math.hypot(w.x - aim.x, w.y - aim.y) <= 28 * worldPerCss();

    if (!near) {
      aim = { x: w.x, y: w.y };
      return;
    }

    const at = aim;
    aim = null;

    if (placement) {
      placeBuilding(at.x, at.y);
      if (placement) aim = at;
    } else {
      castFire(at.x, at.y);
    }
  }

  window.addEventListener("keydown", event => {
    const key = event.key.toLowerCase();

    if (key.startsWith("arrow")) {
      if (!menuOpen && started && !event.target.matches("input, select")) {
        keysDown.add(key);
        event.preventDefault();
      }
      return;
    }

    if (event.repeat) return;

    if (key === "escape" || key === "p") {
      if (menuOpen) {
        const page = pages.find(p => !p.hidden);
        if (key === "p" && event.target.matches("input")) return;
        if (page && page.dataset.page !== "main") goBack(page.dataset.page);
        else if (started) closeMenu();
      } else if (key === "escape" && (placement || spellMode || commandMode)) {
        placement = null;
        spellMode = null;
        commandMode = false;
      } else if (started) {
        openMenu();
      }
      return;
    }

    if (menuOpen || !started) return;

    if (key === "tab") {
      event.preventDefault();
      cycleFocus();
      return;
    }

    const shortcuts = {
      q: "worker",
      w: "soldier",
      e: "archer",
      h: "hero",
      t: "tower",
      f: "barracks",
      g: "hut",
      k: "smithy",
      z: "armor",
      x: "weapon",
      a: "fire",
      s: "heal",
      m: "command"
    };

    // zkratka platí jen pro tlačítko, které je ve vybrané nabídce
    if (shortcuts[key] && PK.hud.cardHas(shortcuts[key])) {
      keyPress = { type: shortcuts[key], t: 0.14 };
      action(shortcuts[key]);
    }

    if (key === "r" && matchOver) {
      if (mode === "online") returnToRoom();
      else startOffline(lastOffline);
    }
  });

  /* ======================= menu + settings ======================= */
  const SETTINGS_KEY = "pk-settings";
  const settings = { shake: true, pixel: false, autoFullscreen: false };

  try {
    Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {});
  } catch (e) { /* storage unavailable or corrupt */ }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  const $ = id => document.getElementById(id);
  const menuEl = $("menu");
  const menuBtn = $("menu-btn");
  const statusEl = $("menu-status");
  const pages = [...menuEl.querySelectorAll(".page")];
  let menuOpen = true;
  let started = false;

  function showPage(name) {
    if (name !== "online" && name !== "lobby") leaveLobby();
    menuEl.querySelector(".panel").classList.toggle("wide", name === "lobby");
    for (const page of pages) page.hidden = page.dataset.page !== name;
    const first = menuEl.querySelector(`.page[data-page="${name}"] button:not([hidden]):not(:disabled)`);
    if (first) first.focus({ preventScroll: true });
  }

  const liveMatch = () => started && !matchOver;

  // Zpět z podstránky: z online místnosti se odchází přes server, jinak do hlavního menu.
  function goBack(page) {
    if (page === "lobby" && lobby.online) net.send({ t: "leave" });
    else showPage("main");
  }

  function endReason() {
    if (state === "win") {
      if (endWhy === "surrender") return "Soupeři se vzdali.";
      if (endWhy === "disconnect") return "Soupeři se odpojili.";
      return "Poslední soupeřova základna padla.";
    }

    if (state === "draw") return "Všechny základny padly.";
    if (endWhy === "connection") return "Spojení se serverem bylo přerušeno.";
    if (ownOutWhy === "surrender") return "Vzdal ses.";
    return "Tvoje základna padla.";
  }

  function syncMenu() {
    const onl = mode === "online" && started;
    const live = liveMatch();
    const over = started && matchOver;
    const playing = live && state === "playing";

    $("m-online").hidden = onl && live;
    $("m-online").textContent = onl && over ? "Zpět do místnosti" : "Multiplayer";
    $("m-play").textContent = live ? "Pokračovat" : "Hra proti AI";
    $("m-restart").hidden = !started || onl;
    $("m-surrender").hidden = !playing;
    $("m-leave").hidden = !(onl && (over || !playing));
    menuBtn.hidden = !started || menuOpen;
    menuEl.classList.toggle("scene", !started);

    if (!started) statusEl.textContent = "";
    else if (playing) statusEl.textContent = onl ? "Zápas běží i s otevřeným menu." : "Hra je pozastavena.";
    else if (live) statusEl.textContent = "Vypadl jsi, ostatní hrají dál.";
    else statusEl.textContent = `${state === "win" ? "Vítězství!" : state === "lose" ? "Porážka." : "Remíza."} ${endReason()}`;

    $("m-play").hidden = started && !live;
  }

  function openMenu(page = "main") {
    menuOpen = true;
    pointerStart = null;
    pointerEnd = null;
    pressedBtn = null;
    mouse = { x: -100, y: -100 };
    menuEl.hidden = false;
    syncMenu();
    showPage(page);
  }

  function closeMenu() {
    menuOpen = false;
    menuEl.hidden = true;
    syncMenu();
    previousFrame = performance.now();
    document.activeElement && document.activeElement.blur();
  }

  function play() {
    audio.unlock();
    if (settings.autoFullscreen && !isFullscreen()) toggleFullscreen();
    if (liveMatch()) closeMenu();
    else openOfflineLobby();
  }

  /* ======================= lobby: výběr mapy a hráčů ======================= */
  const oStatus = $("o-status");
  const oStats = $("o-stats");
  const oRooms = $("o-rooms");
  const oCreate = $("o-create");

  // Stav lobby (hra proti AI i online místnost); sloty odpovídají slotům mapy.
  const lobby = { online: false, mapId: MAPS.DEFAULT, slots: [], you: 0, host: 0 };
  const lobbyEl = {
    maps: $("l-maps"), preview: $("l-preview"), name: $("l-name"), desc: $("l-desc"),
    meta: $("l-meta"), slots: $("l-slots"), status: $("l-status"), start: $("l-start"), title: $("l-title")
  };
  const previews = new Map();
  const previewBusy = new Set();
  let lastOffline = null;

  // Vlastní mapy z editoru; změněné mapy ztratí starý náhled.
  function refreshCustomMaps() {
    return PK.customMaps.load().then(changed => {
      for (const id of changed) previews.delete(id);
      return changed;
    });
  }

  const lobbyVisible = () => {
    const page = pages.find(p => !p.hidden);
    return !!page && page.dataset.page === "lobby";
  };

  function renderRooms() {
    oRooms.replaceChildren();
    if (online.phase !== "idle") return;

    for (const r of online.rooms) {
      const m = MAPS.get(r.map);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "room";
      row.disabled = r.players >= r.max;
      row.textContent = `${m ? m.name : r.map} · hostitel ${r.host} · ${r.players}/${r.max}`;
      row.addEventListener("click", () => {
        audio.unlock();
        net.send({ t: "join", room: r.id });
      });
      oRooms.append(row);
    }
  }

  function syncLobby() {
    const phase = online.phase;
    const busy = phase === "connecting";

    oCreate.disabled = busy;
    oCreate.textContent = phase === "idle" ? "Vytvořit místnost" : "Připojit k serveru";

    if (phase === "connecting") {
      oStatus.textContent = "Připojuji se k serveru…";
    } else if (phase === "idle") {
      oStatus.textContent = online.error || (online.rooms.length ? "Vyber místnost, nebo vytvoř vlastní." : "Zatím tu není žádná místnost. Vytvoř vlastní.");
    } else {
      oStatus.textContent = online.error || "Nejsi připojený k serveru.";
    }

    oStats.textContent = phase === "idle" ? `Hráčů online: ${online.total} · Místností: ${online.rooms.length} · Hráčů ve hře: ${online.playing}` : "";
    renderRooms();
  }

  function connectLobby() {
    online.error = "";
    online.phase = "connecting";
    online.server = "";
    syncLobby();

    net.connect(online.server).catch(() => {
      if (online.phase !== "connecting") return;
      online.phase = "offline";
      online.error = "Server není dostupný. Zkus to později.";
      syncLobby();
    });
  }

  function leaveLobby() {
    const phase = online.phase;

    if (phase === "idle" || phase === "room" || phase === "connecting") {
      online.phase = "offline";
      online.roomId = 0;
      online.error = "";
      lobby.online = false;
      net.close();
    }
  }

  function enterOnline() {
    audio.unlock();

    if (!account.user) {
      account.openLogin(enterOnline);
      return;
    }

    refreshCustomMaps();

    if (online.phase === "room") {
      showPage("lobby");
      renderLobby();
      return;
    }

    showPage("online");
    if (online.phase === "offline") connectLobby();
    syncLobby();
  }

  function createRoom() {
    audio.unlock();

    if (online.phase === "idle") {
      online.error = "";
      net.send({ t: "create", map: lobby.mapId });
    } else if (online.phase === "offline") {
      connectLobby();
    }
  }

  function returnToRoom() {
    reset();
    started = false;
    mode = "ai";
    openMenu();

    if (net.connected && online.roomId) {
      online.phase = "room";
      showPage("lobby");
      renderLobby();
    } else {
      online.phase = net.connected ? "idle" : "offline";
      enterOnline();
    }
  }

  function leaveOnline() {
    net.close();
    reset();
    started = false;
    mode = "ai";
    online.phase = "offline";
    online.roomId = 0;
    lobby.online = false;
    syncMenu();
    showPage("main");
  }

  /* ======================= lobby: obrazovka výběru mapy ======================= */
  const lobbyMap = () => MAPS.get(lobby.mapId) || MAPS.get(MAPS.DEFAULT);
  const isHost = () => !lobby.online || lobby.host === lobby.you;

  const sizeLabel = m => {
    const area = m.size[0] * m.size[1];
    return area <= 150000 ? "malá" : area <= 450000 ? "střední" : "velká";
  };

  const SLOT_LABELS = { ai: "Počítač (AI)", open: "Otevřeno", closed: "Zavřeno" };

  function openOfflineLobby() {
    audio.unlock();
    lobby.online = false;
    lobby.you = 0;
    lobby.host = 0;

    if (lastOffline && MAPS.get(lastOffline.mapId)) {
      lobby.mapId = lastOffline.mapId;
      lobby.slots = lastOffline.slots.map(s => ({ ...s }));
    } else {
      lobby.mapId = MAPS.DEFAULT;
      lobby.slots = lobbyMap().slots.map((_, i) => ({ kind: i === 0 ? "human" : "ai", name: i === 0 ? "Ty" : "" }));
    }

    showPage("lobby");
    renderLobby();

    refreshCustomMaps().then(changed => {
      if (changed.length && lobbyVisible() && !lobby.online) renderLobby();
    });
  }

  function selectMap(id) {
    if (!isHost() || id === lobby.mapId) return;

    if (lobby.online) {
      net.send({ t: "map", map: id });
      return;
    }

    const next = MAPS.get(id);
    lobby.mapId = id;
    lobby.slots = next.slots.map((_, i) => lobby.slots[i] || { kind: "ai", name: "" });
    renderLobby();
  }

  function setSlot(i, kind) {
    if (!isHost()) return;

    if (lobby.online) {
      net.send({ t: "slot", i, kind });
    } else {
      lobby.slots[i] = { kind, name: "" };
      renderLobby();
    }
  }

  function renderLobby() {
    const map = lobbyMap();
    const host = isHost();

    lobbyEl.title.textContent = lobby.online ? "Multiplayer místnost" : "Hra proti AI";

    lobbyEl.maps.replaceChildren(...MAPS.list.map(m => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `map-item${m.id === lobby.mapId ? " selected" : ""}`;
      item.disabled = !host;

      const title = document.createElement("span");
      title.className = "map-name";
      title.textContent = m.name;
      const tag = document.createElement("span");
      tag.className = "map-tag";
      tag.textContent = m.tag;

      item.append(title, tag);
      item.addEventListener("click", () => selectMap(m.id));
      return item;
    }));

    lobbyEl.name.textContent = map.name;
    lobbyEl.desc.textContent = map.description;
    lobbyEl.meta.textContent = `Hráči: ${map.players} · Velikost: ${sizeLabel(map)} (${map.size[0] * 2}×${map.size[1] * 2}) · Zlaté doly: ${map.gold.length}`;

    lobbyEl.slots.replaceChildren(...lobby.slots.map((slot, i) => {
      const team = R.TEAMS[i];
      const row = document.createElement("div");
      row.className = "slot";

      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = teamCss(team);

      const label = document.createElement("span");
      label.className = "slot-team";
      label.textContent = R.TEAM_NAMES[team];
      row.append(swatch, label);

      if (slot.kind === "human") {
        const who = document.createElement("span");
        who.className = "slot-who";
        who.textContent = lobby.online
          ? `${slot.name}${i === lobby.you ? " (ty)" : ""}${i === lobby.host ? " ★" : ""}`
          : "Ty";
        row.append(who);
      } else if (host) {
        const select = document.createElement("select");
        select.className = "field";
        select.setAttribute("aria-label", `Slot ${R.TEAM_NAMES[team]}`);

        for (const kind of lobby.online ? ["open", "ai", "closed"] : ["ai", "closed"]) {
          const option = document.createElement("option");
          option.value = kind;
          option.textContent = SLOT_LABELS[kind];
          select.append(option);
        }

        select.value = slot.kind;
        select.addEventListener("change", () => setSlot(i, select.value));
        row.append(select);
      } else {
        const who = document.createElement("span");
        who.className = "slot-who muted";
        who.textContent = SLOT_LABELS[slot.kind];
        row.append(who);
      }

      return row;
    }));

    const active = lobby.slots.filter(s => s.kind === "human" || s.kind === "ai").length;
    lobbyEl.start.hidden = !host;
    lobbyEl.start.disabled = active < 2;
    lobbyEl.status.textContent = !host
      ? "Čeká se, až hostitel spustí hru."
      : active < 2 ? "Přidej aspoň jednoho soupeře." : "Vše připraveno.";

    drawPreview();
  }

  // Náhled = zmenšený terén mapy se značkami startovních pozic. Terén se peče jednou na mapu.
  const bigMap = map => map.size[0] * map.size[1] > 4e6;

  // Pečení terénu obří mapy trvá dlouho, proto se v lobby kreslí jen schéma (voda, cesty).
  function sketchPreview(map, maxW, maxH) {
    const [w, h] = map.size;
    const s = Math.min(maxW / w, maxH / h);
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(w * s));
    cv.height = Math.max(1, Math.round(h * s));
    const c = cv.getContext("2d");
    c.fillStyle = "#2f5d34";
    c.fillRect(0, 0, cv.width, cv.height);
    c.lineCap = "round";
    c.lineJoin = "round";

    const draw = (pts, width, color) => {
      c.strokeStyle = color;
      c.lineWidth = Math.max(1, width * 2 * s);
      c.beginPath();
      pts.forEach(([x, y], i) => (i ? c.lineTo(x * s, y * s) : c.moveTo(x * s, y * s)));
      c.stroke();
    };

    for (const r of map.terrain.rivers) if (r.pts) draw(r.pts, r.hw, "#2f6fb0");
    for (const r of map.terrain.roads) draw(r.pts, r.w, "#b09060");
    return cv;
  }
  function drawPreview() {
    const map = lobbyMap();
    const cv = lobbyEl.preview;
    const c = cv.getContext("2d");
    const img = previews.get(map.id);

    c.imageSmoothingEnabled = false;
    c.fillStyle = "#0b0914";
    c.fillRect(0, 0, cv.width, cv.height);

    if (!img) {
      c.fillStyle = "#9b94b8";
      c.font = "12px monospace";
      c.textAlign = "center";
      c.fillText("Načítám náhled…", cv.width / 2, cv.height / 2);

      if (!previewBusy.has(map.id)) {
        previewBusy.add(map.id);
        setTimeout(() => {
          previews.set(map.id, bigMap(map) ? sketchPreview(map, cv.width - 8, cv.height - 8) : world.preview(map, cv.width - 8, cv.height - 8));
          previewBusy.delete(map.id);
          if (lobbyMap() === map) drawPreview();
        }, 30);
      }

      return;
    }

    const ox = Math.round((cv.width - img.width) / 2);
    const oy = Math.round((cv.height - img.height) / 2);
    const s = img.width / (map.size[0] * 2);
    c.drawImage(img, ox, oy);

    c.fillStyle = "#ffd36b";
    for (const [x, y] of map.gold) c.fillRect(ox + Math.round(x * s) - 1, oy + Math.round(y * s) - 1, 3, 3);

    lobby.slots.forEach((slot, i) => {
      const hq = map.slots[i].hq;
      const x = ox + Math.round(hq.x * s);
      const y = oy + Math.round(hq.y * s);
      const used = slot.kind === "human" || slot.kind === "ai";

      c.globalAlpha = used ? 1 : 0.45;
      c.fillStyle = "#15121f";
      c.beginPath();
      c.arc(x, y, 9, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = used ? teamCss(R.TEAMS[i]) : "#6a6480";
      c.beginPath();
      c.arc(x, y, 7, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#15121f";
      c.font = "bold 10px monospace";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(String(i + 1), x, y + 1);
      c.globalAlpha = 1;
    });

    c.textBaseline = "alphabetic";
  }

  function startOffline(cfg) {
    audio.unlock();

    const c = cfg || { mapId: lobby.mapId, slots: lobby.slots };
    const next = MAPS.get(c.mapId);
    const roster = [];

    c.slots.forEach((s, i) => {
      if (s.kind === "human") roster.push({ slot: i, name: "Ty", ai: false });
      else if (s.kind === "ai") roster.push({ slot: i, name: `AI ${R.TEAM_NAMES[R.TEAMS[i]]}`, ai: true });
    });

    if (!next || roster.length < 2) {
      lobbyEl.status.textContent = "Přidej aspoň jednoho AI soupeře.";
      return;
    }

    lastOffline = { mapId: c.mapId, slots: c.slots.map(s => ({ ...s })) };
    beginMatch({ mode: "ai", map: next, slot: 0, players: roster });
  }

  function handleRoom(m) {
    if (!MAPS.get(m.map)) {
      refreshCustomMaps().then(() => { if (MAPS.get(m.map)) handleRoom(m); });
      return;
    }

    lobby.online = true;
    lobby.mapId = m.map;
    lobby.you = m.you;
    lobby.host = m.host;
    lobby.slots = m.slots.map(s => ({ kind: s.kind, name: String(s.name || "") }));
    online.roomId = m.id;

    // po skončení zápasu se do místnosti vracíš sám (R nebo menu)
    if (m.state === "playing" || (started && mode === "online")) return;

    online.phase = "room";
    online.error = "";
    showPage("lobby");
    renderLobby();
  }

  /* ======================= online: match state ======================= */
  function beginOnlineMatch(m) {
    const next = MAPS.get(m.map);

    if (!next) {
      refreshCustomMaps().then(() => { if (MAPS.get(m.map)) beginOnlineMatch(m); });
      return;
    }

    online.pendingTrain = 0;
    online.pendingBuild = 0;
    online.count = 0;
    beginMatch({ mode: "online", map: next, slot: m.slot, players: m.players });
  }

  function netUnit(id, type, team, x, y) {
    const s = R.UNITS[type];

    return {
      id, kind: "unit", type, team, x, y, sx: x, sy: y,
      hp: s.hp, maxHp: s.hp, speed: s.speed, damage: s.damage, range: s.range,
      attackDelay: s.delay, cooldown: 0, fireCooldown: 0, healCooldown: 0,
      order: null, carry: null, level: 1, xp: 0, walkCycle: 0,
      facing: map.slots[R.TEAMS.indexOf(team)].facing,
      atk: 0, castT: 0, flashT: 0, workT: 0, fxT: 0, moveT: 0, wd: 0, lx: x, ly: y, stepT: 0
    };
  }

  function netBuilding(id, type, team, x, y, progress) {
    return {
      id, kind: "building", type, team, x, y, hp: 1, maxHp: 1, cooldown: 0, progress,
      age: 99, flashT: 0, fireT: 0, smokeAcc: 0
    };
  }

  const entityById = id => unitMap.get(id) || buildingMap.get(id) || null;

  function netEvent(e) {
    switch (e.e) {
      case "hit": {
        const attacker = entityById(e.a);
        const target = entityById(e.t);
        if (!attacker || !target) return;

        if (!e.s && attacker.kind === "unit") {
          attacker.atk = 0.3;
          attacker.facing = target.x < attacker.x ? -1 : 1;
        }

        hitVisuals(attacker, target, e.n, { silent: !!e.s, delay: e.d || 0 }, !!e.k);
        break;
      }

      case "fire": {
        const hero = unitMap.get(e.h);
        if (!hero) return;
        hero.castT = 0.5;
        hero.facing = e.x < hero.x ? -1 : 1;
        fx.fireball(hero.x + hero.facing * 14, hero.y - 6, e.x, e.y + 8, 47);
        audio.play("fireCast", { x: hero.x });
        fx.later(0.3, () => audio.play("explosion", { x: e.x }));
        break;
      }

      case "heal": {
        const hero = unitMap.get(e.h);
        if (!hero) return;

        for (const id of e.ids) {
          const ally = unitMap.get(id);
          if (!ally) continue;
          fx.healOn(ally.x, ally.y + 4);
          fx.text(ally.x, ally.y - 30, `+${e.n}`, 0x9ef7c8);
        }

        hero.castT = 0.5;
        fx.healBurst(hero.x, hero.y + 8, 90);
        audio.play("heal", { x: hero.x });
        break;
      }

      case "xp": {
        const hero = unitMap.get(e.id);
        if (hero && hero.team === me) fx.text(hero.x, hero.y - 44, `+${e.n} XP`, 0xd0b4ff);
        break;
      }

      case "lvl": {
        const hero = unitMap.get(e.id);
        if (!hero) return;
        fx.levelUp(hero.x, hero.y + 8);
        if (hero.team === me) audio.play("levelUp");
        break;
      }

      case "upg": {
        if (R.TEAMS[e.t] === me) {
          audio.play("levelUp");
          const h = buildings.find(b => b.team === me && b.type === R.HQ[me]);
          if (h) fx.levelUp(h.x, h.y + 8);
        }
        break;
      }

      case "coin": {
        const unit = unitMap.get(e.id);
        if (!unit) return;
        fx.coin(unit.x, unit.y, "+10", e.r === "wood");
        if (unit.team === me) audio.play("coin", { x: unit.x });
        break;
      }

      case "out":
        playerOut(e.t, e.why);
        break;

      case "end":
        finishMatch(e.w, e.why);
        break;

      default:
    }
  }

  function applySnapshot(s) {
    if (matchOver) return;

    const first = online.firstSnapshot;
    online.firstSnapshot = false;

    for (const e of s.e) netEvent(e);
    for (const note of s.n) announce(note);

    if (s.p === "countdown" || s.p === "playing") {
      matchPhase = s.p;
      if (mode === "online") online.phase = s.p;
    }
    online.count = s.c;
    supplyCap = s.sc || R.SUPPLY_BASE;
    if (s.up) upgrades = { armor: s.up[0], weapon: s.up[1] };
    elapsed = s.el;
    gold = s.g;
    wood = s.w;

    const seenUnits = new Set();

    for (const d of s.u) {
      const [id, t, team, x, y, hp, maxHp, face, carry, level, xp, order, fcd, hcd, work, dmg] = d;
      let u = unitMap.get(id);

      if (!u) {
        u = netUnit(id, UNIT_TYPES[t], R.TEAMS[team], x, y);
        unitMap.set(id, u);
        units.push(u);

        if (!first) {
          fx.spawn(u.x, u.y + 12);
          audio.play("spawn", { x: u.x });

          if (u.team === me && online.pendingTrain > 0) {
            selected = [u];
            online.pendingTrain = 0;
          }
        }
      }

      seenUnits.add(id);
      u.sx = x;
      u.sy = y;
      u.hp = hp;
      u.maxHp = maxHp;
      u.facing = face ? 1 : -1;
      u.carry = carry === 1 ? "gold" : carry === 2 ? "wood" : null;
      u.level = level;
      u.xp = xp;
      u.order = order ? { type: ORDER_TYPES[order] } : null;
      u.fireCooldown = fcd;
      u.healCooldown = hcd;
      u.working = work === 1;
      u.building = work === 2;
      u.damage = dmg;
    }

    if (seenUnits.size !== units.length) {
      for (const u of units) if (!seenUnits.has(u.id)) unitMap.delete(u.id);
      units = units.filter(u => seenUnits.has(u.id));
    }

    const seenBuildings = new Set();

    for (const d of s.b) {
      const [id, t, team, x, y, hp, maxHp, progress, research, researchT] = d;
      let b = buildingMap.get(id);

      if (!b) {
        b = netBuilding(id, BUILDING_TYPES[t], R.TEAMS[team], x, y, progress);
        buildingMap.set(id, b);
        buildings.push(b);

        if (!first && progress < 1) {
          fx.puff(x, y + 30, 6);
          audio.play("order", { x });
        }
      } else if (b.progress < 1 && progress >= 1) {
        fx.build(x, y + 39, b.type === "tower" ? 26 : b.type === "hut" ? 34 : 56);
        audio.play("build", { x });
      }

      seenBuildings.add(id);
      b.hp = hp;
      b.maxHp = maxHp;
      b.progress = progress;
      b.research = research ? { kind: research === 1 ? "armor" : "weapon", frac: researchT } : null;
    }

    if (seenBuildings.size !== buildings.length) {
      for (const b of buildings) if (!seenBuildings.has(b.id)) buildingMap.delete(b.id);
      buildings = buildings.filter(b => seenBuildings.has(b.id));
    }

    const seenResources = new Set();

    for (const d of s.r) {
      const [id, t, x, y, amount] = d;
      let r = resourceMap.get(id);

      if (!r) {
        r = { id, type: t ? "wood" : "gold", x, y, amount, max: amount, shake: 0 };
        resourceMap.set(id, r);
        resources.push(r);
      }

      seenResources.add(id);

      if (!first && t === 0 && r.amount > 0 && amount === 0) fx.text(r.x, r.y - 30, "Vyčerpáno", 0xb8b0d4);
      r.amount = amount;
    }

    if (seenResources.size !== resources.length) {
      for (const r of resources) if (!seenResources.has(r.id)) resourceMap.delete(r.id);
      resources = resources.filter(r => seenResources.has(r.id));
    }
  }

  function netUpdate(dt) {
    messageTimer = Math.max(0, messageTimer - dt);
    online.pendingTrain = Math.max(0, online.pendingTrain - dt);
    online.pendingBuild = Math.max(0, online.pendingBuild - dt);
    const k = 1 - Math.exp(-dt * 16);

    for (const u of units) {
      const dx = u.sx - u.x;
      const dy = u.sy - u.y;

      if (Math.abs(dx) + Math.abs(dy) > 90) {
        u.x = u.sx;
        u.y = u.sy;
      } else {
        u.x += dx * k;
        u.y += dy * k;
      }

      if (u.building) {
        u.workT = 0.2;
        u.fxT -= dt;

        if (u.fxT <= 0) {
          u.fxT = 0.5;
          const site = nearestSite(u);

          if (site) {
            fx.chop(site.x, site.y + 14);
            audio.play("wood", { x: site.x });
          }
        }
      }

      if (u.working) {
        u.workT = 0.2;
        u.fxT -= dt;

        if (u.fxT <= 0) {
          u.fxT = 0.42;
          const resource = nearestResource(u);

          if (resource) {
            resource.shake = 0.22;
            if (resource.type === "wood") fx.chop(resource.x, resource.y + 14);
            else fx.mine(resource.x, resource.y + 12);
            audio.play(resource.type === "wood" ? "wood" : "mine", { x: resource.x });
          }
        }
      }
    }

    selected = selected.filter(alive);
    if (selected.length) selectedResourceId = 0;
  }

  // Rozestavěná budova nejblíž u stavitele (pro efekty kladiva).
  function nearestSite(unit) {
    let best = null;
    let bestDistance = 90;

    for (const b of buildings) {
      if (b.progress >= 1) continue;
      const d = distance(unit, b);

      if (d < bestDistance) {
        best = b;
        bestDistance = d;
      }
    }

    return best;
  }

  function nearestResource(unit) {
    let best = null;
    let bestDistance = 60;

    for (const r of resources) {
      const d = distance(unit, r);

      if (d < bestDistance) {
        best = r;
        bestDistance = d;
      }
    }

    return best;
  }

  net.onmessage = m => {
    switch (m.t) {
      case "hello":
      case "rooms":
        // spojení bez účtu (vypršela relace): zpět na přihlášení
        if (m.t === "hello" && !m.me) {
          leaveLobby();
          account.expired();
          break;
        }

        online.rooms = Array.isArray(m.list) ? m.list : [];
        online.playing = m.playing | 0;
        online.total = m.online | 0;

        if (m.t === "hello" && online.phase === "connecting") online.phase = "idle";

        syncLobby();
        break;

      case "room":
        handleRoom(m);
        break;

      case "left":
        online.roomId = 0;
        lobby.online = false;
        if (online.phase === "room") {
          online.phase = "idle";
          showPage("online");
          syncLobby();
        }
        break;

      case "error":
        online.error = String(m.text || "");
        syncLobby();
        if (online.phase === "room") lobbyEl.status.textContent = online.error;
        break;

      case "match":
        beginOnlineMatch(m);
        break;

      case "s":
        applySnapshot(m);
        break;

      default:
    }
  };

  net.onclose = () => {
    if (mode === "online" && started && !matchOver) {
      if (state === "playing") {
        state = "lose";
        audio.play("lose");
      }

      finishMatch(-1, "connection");
      return;
    }

    if (online.phase !== "ended") {
      online.phase = "offline";
      online.roomId = 0;
      lobby.online = false;
      online.error = online.error || "Spojení se serverem bylo přerušeno.";
      if (!started) showPage("online");
      syncLobby();
    }
  };
  /* fullscreen */
  const fsRoot = document.documentElement;

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function toggleFullscreen() {
    try {
      if (isFullscreen()) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else {
        const request = fsRoot.requestFullscreen || fsRoot.webkitRequestFullscreen;
        const result = request && request.call(fsRoot);
        if (result && result.catch) result.catch(() => {});
      }
    } catch (e) { /* fullscreen not available */ }
  }

  function onFullscreenChange() {
    const on = isFullscreen();
    $("fs-btn").title = on ? "Zavřít celou obrazovku" : "Celá obrazovka";
    $("s-fullscreen").textContent = on ? "Vypnout" : "Zapnout";

    // lets Escape reach the game so it can open the menu instead of leaving fullscreen
    if (navigator.keyboard && navigator.keyboard.lock) {
      if (on) navigator.keyboard.lock(["Escape"]).catch(() => {});
      else navigator.keyboard.unlock();
    }
    fit();
  }

  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);

  /* wiring */
  $("m-play").addEventListener("click", play);
  $("m-online").addEventListener("click", () => {
    if (mode === "online" && started && matchOver) returnToRoom();
    else enterOnline();
  });
  $("m-leave").addEventListener("click", leaveOnline);
  $("m-surrender").addEventListener("click", () => {
    if (!liveMatch() || state !== "playing" || !window.confirm("Opravdu se chceš vzdát?")) return;
    sendCmd({ c: "surrender" });
    closeMenu();
  });
  oCreate.addEventListener("click", createRoom);
  lobbyEl.start.addEventListener("click", () => {
    if (lobby.online) net.send({ t: "start" });
    else startOffline();
  });
  $("l-back").addEventListener("click", () => goBack("lobby"));
  $("m-restart").addEventListener("click", openOfflineLobby);
  $("m-settings").addEventListener("click", () => showPage("settings"));
  $("m-help").addEventListener("click", () => showPage("help"));
  $("fs-btn").addEventListener("click", toggleFullscreen);
  $("s-fullscreen").addEventListener("click", toggleFullscreen);
  menuBtn.addEventListener("click", () => openMenu());

  for (const back of menuEl.querySelectorAll("[data-back]")) {
    back.addEventListener("click", () => goBack(back.closest(".page").dataset.page));
  }

  menuEl.addEventListener("click", event => {
    if (event.target.closest(".btn")) {
      audio.unlock();
      audio.play("click");
    }
  });

  const volumeEl = $("s-volume");
  const soundEl = $("s-sound");

  function syncSettings() {
    volumeEl.value = Math.round(audio.volume * 100);
    $("s-volume-out").textContent = `${volumeEl.value} %`;
    soundEl.checked = !audio.muted;
    $("s-ambient").checked = audio.ambient;
    $("s-voice").checked = PK.voice.enabled;
    $("s-voice-label").textContent = PK.voice.available ? "České hlasy postav" : "České hlasy postav (nenačteny)";
    $("s-shake").checked = settings.shake;
    $("s-pixel").checked = settings.pixel;
    $("s-autofs").checked = settings.autoFullscreen;
  }

  volumeEl.addEventListener("input", () => {
    audio.unlock();
    audio.setVolume(volumeEl.value / 100);
    $("s-volume-out").textContent = `${volumeEl.value} %`;
  });
  volumeEl.addEventListener("change", () => audio.play("click"));

  soundEl.addEventListener("change", () => {
    audio.unlock();
    audio.setMuted(!soundEl.checked);
  });

  $("s-ambient").addEventListener("change", event => {
    audio.unlock();
    audio.setAmbient(event.target.checked);
  });

  $("s-voice").addEventListener("change", event => {
    PK.voice.setEnabled(event.target.checked);
  });
  PK.voice.onLoad = syncSettings;

  $("s-shake").addEventListener("change", event => {
    settings.shake = event.target.checked;
    saveSettings();
  });

  $("s-pixel").addEventListener("change", event => {
    settings.pixel = event.target.checked;
    saveSettings();
    fit();
  });

  $("s-autofs").addEventListener("change", event => {
    settings.autoFullscreen = event.target.checked;
    saveSettings();
  });

  syncSettings();
  syncMenu();
  showPage("main");

  account.init({
    show: showPage,
    onChange: user => {
      if (user) return;
      if (mode === "online" && started) leaveOnline();
      else leaveLobby();
    },
    onLogin: () => enterOnline()
  });
  account.start();

  // Odkaz z editoru (?map=id) otevře výběr hry proti AI s danou vlastní mapou.
  refreshCustomMaps().then(() => {
    const id = new URLSearchParams(location.search).get("map");
    const wanted = id && MAPS.get(id);
    if (!wanted || started) return;

    lastOffline = { mapId: id, slots: wanted.slots.map((_, i) => ({ kind: i === 0 ? "human" : "ai", name: i === 0 ? "Ty" : "" })) };
    openOfflineLobby();
  });

  /* ======================= hit visuals ======================= */
  // Čísla zásahů počítá simulace; tady jsou jen efekty a zvuky (volá je událost "hit").
  function hitVisuals(attacker, target, amount, opts, killed) {
    let wait = opts.delay || 0;
    const ranged = attacker.type === "archer" || attacker.type === "tower";
    const tx = target.x;
    const ty = target.kind === "building" ? target.y - 8 : target.y - 6;
    const dirTo = attacker.x <= target.x ? 1 : -1;
    const friendlyFire = target.team === me;

    const impact = () => {
      if (!opts.silent) fx.hit(tx, ty, amount >= 20);
      if (target.kind === "unit" || target.hp > 0) target.flashT = 0.12;
      fx.text(tx, ty - (target.kind === "building" ? 56 : 28), Math.round(amount), friendlyFire ? 0xff8f7a : 0xfff0c4);
      if (!opts.silent) audio.play(target.kind === "building" || attacker.type === "hero" ? "hitHeavy" : "hit", { x: tx });
    };

    if (!opts.silent) {
      if (ranged) {
        const ox = attacker.type === "tower" ? attacker.x : attacker.x + (attacker.facing || dirTo) * 14;
        const oy = attacker.type === "tower" ? attacker.y - 30 : attacker.y - 14;
        const fn = attacker.type === "tower" ? fx.bolt : fx.arrow;
        wait += fn(ox, oy, tx, ty - 2, null);
        attacker.fireT = 0.2;
        audio.play(attacker.type === "tower" ? "tower" : "arrow", { x: attacker.x });
      } else {
        fx.slash(tx, ty, dirTo);
        audio.play("slash", { x: attacker.x });
      }
    }

    fx.later(wait, impact);

    if (killed) {
      if (target.kind === "unit") {
        fx.later(wait, () => audio.play("death", { x: tx }));
        fx.corpse({
          type: target.type, team: target.team, flip: target.facing < 0,
          x: target.x, y: target.y, dir: dirTo, wait
        });
      } else {
        fx.later(wait, () => {
          fx.collapse({ type: target.type, team: target.team, x: target.x, y: target.y });
          audio.play("collapse", { x: tx });
        });
      }
    }
  }

  /* ======================= visual state ======================= */
  function updateVisuals(dt) {
    clock += dt;
    if (matchOver) endT += dt;
    if (keyPress) {
      keyPress.t -= dt;
      if (keyPress.t <= 0) keyPress = null;
    }

    for (const u of units) {
      u.atk = Math.max(0, u.atk - dt);
      u.castT = Math.max(0, u.castT - dt);
      u.flashT = Math.max(0, u.flashT - dt);
      u.workT = Math.max(0, u.workT - dt);

      const moved = Math.hypot(u.x - u.lx, u.y - u.ly);

      if (moved > 0.15) {
        u.moveT = 0.12;
        u.wd += moved;
        u.stepT -= moved;

        if (u.stepT <= 0) {
          u.stepT = 14;
          const z = world.zoneAt(u.x / 2, u.y / 2 + 6);
          fx.footstep(u.x, u.y + 12, z === world.Z.WATER || z === world.Z.BANK);
          audio.play("step", { x: u.x, vol: u.team === me ? 0.5 : 0.35 });
        }
      } else {
        u.moveT = Math.max(0, u.moveT - dt);
      }

      u.lx = u.x;
      u.ly = u.y;
    }

    for (const b of buildings) {
      b.age += dt;
      b.flashT = Math.max(0, b.flashT - dt);
      b.fireT = Math.max(0, b.fireT - dt);
    }

    for (const r of resources) r.shake = Math.max(0, (r.shake || 0) - dt);

    battleLevel += ((Math.min(1, units.filter(u => u.atk > 0 && u.workT <= 0).length / 4)) - battleLevel) * Math.min(1, dt * 2);
    if (Math.abs(battleLevel - lastBattle) > 0.05) {
      lastBattle = battleLevel;
      audio.setIntensity(battleLevel);
    }

    emitAmbient(dt);
    fx.update(dt);
  }

  function emitAmbient(dt) {
    for (const b of buildings) {
      if (b.progress < 1) continue;

      const spr = PK.buildings.get(b.type);
      const ox = Math.round(b.x / 2) - spr.ax;
      const oy = Math.round(b.y / 2) + 19 - spr.ay;
      const frac = b.hp / b.maxHp;

      b.smokeAcc += dt * ((spr.smoke.length ? 2.4 : 0) + (frac < 0.5 ? 4 : 0) + (frac < 0.25 ? 4 : 0));

      while (b.smokeAcc >= 1) {
        b.smokeAcc -= 1;

        if (frac < 0.5 && Math.random() < 0.6) {
          const px = ox + spr.w * (0.2 + Math.random() * 0.6);
          fx.smoke(px, oy + spr.h * 0.25, true);
        } else if (spr.smoke.length) {
          const [sx, sy] = spr.smoke[Math.floor(Math.random() * spr.smoke.length)];
          fx.smoke(ox + sx, oy + sy, b.type === "citadel");
        }
      }

      if (b.type === "citadel" && Math.random() < dt * 9) {
        const [fxx, fyy] = spr.flames[Math.random() < 0.5 ? 0 : 1];
        fx.ember(ox + fxx, oy + fyy - 6);
      }
    }

    for (const d of world.doodads) {
      if (d.spr.flame && Math.random() < dt * 3.2) {
        if (d.name === "campfire") fx.smoke(d.x + (Math.random() - 0.5) * 3, d.y - 12, false);
        else fx.ember(d.x + (Math.random() - 0.5) * 4, d.y - 14);
      }
    }
  }

  /* ======================= rendering ======================= */
  const ringCache = new Map();

  function ellipseRing(rx, ry, color) {
    const key = `${rx}|${ry}|${color}`;
    let c = ringCache.get(key);

    if (!c) {
      const P = new PK.Pix(rx * 2 + 3, ry * 2 + 3);
      P.ring(rx + 1.5, ry + 1.5, rx + 0.5, ry + 0.5, color, 1);
      c = P.toCanvas();
      ringCache.set(key, c);
    }

    return c;
  }

  const HB_TOP = { worker: 25, soldier: 28, archer: 29, hero: 33, raider: 29 };

  function unitAnim(u) {
    if (u.castT > 0 && u.type === "hero") {
      const p = 1 - u.castT / 0.5;
      return ["cast", p < 0.3 ? 0 : p < 0.7 ? 1 : 2];
    }

    if (u.atk > 0) {
      const p = 1 - u.atk / 0.3;
      return ["attack", p < 0.35 ? 0 : p < 0.65 ? 1 : 2];
    }

    if (u.workT > 0) return ["attack", Math.floor(clock * 4.5 + u.id) % 3];
    if (u.moveT > 0) return ["walk", Math.floor(u.wd / 28 * 6) % 6];
    return ["idle", Math.floor(clock * 1.4 + u.id * 0.37) & 1];
  }

  function drawUnit(u) {
    const footX = Math.round(u.x / 2);
    const footY = Math.round(u.y / 2) + 6;
    const flip = u.facing < 0;

    const sh = world.shadow("ellipse", u.type === "hero" ? 16 : 13, 5);
    g.drawImage(sh, footX - (sh.width >> 1), footY - (sh.height >> 1));

    const [anim, idx] = unitAnim(u);
    const rec = U.frame(u.type, u.team, anim, idx);
    const img = u.flashT > 0 ? U.flash(rec, flip) : flip ? rec.cf : rec.c;
    const ox = flip ? U.CELL - 1 - U.AX : U.AX;
    const bob = anim === "walk" && idx % 3 === 0 ? -1 : 0;

    if (u.carry && U.carry[u.carry]) {
      const c = U.carry[u.carry];
      g.drawImage(c, footX + (flip ? 3 : -3 - c.width) , footY - 18 + bob);
    }

    g.drawImage(img, footX - ox, footY - U.AY);

    const meta = rec.meta || {};
    const cellX = x => footX - ox + (flip ? U.CELL - 1 - (U.AX + x) : U.AX + x);

    if (meta.eye) {
      const ex = cellX(meta.eye[0]);
      const ey = footY + meta.eye[1];
      const flick = Math.sin(clock * 13 + u.id) > 0.2;
      g.fillStyle = flick ? "#fff6cc" : "#ffbf45";
      g.fillRect(ex, ey, 1, 1);
      g.fillRect(ex + (flip ? -1 : 1), ey, 1, 1);
      world.light(g, ex, ey, 4, 0xff8f4a, 0.35);
    }

    if (meta.lantern) {
      const lx = cellX(meta.lantern[0]);
      const ly = footY + meta.lantern[1];
      const cast = anim === "cast" ? 1 : 0;
      const flick = 0.55 + Math.sin(clock * 9 + u.id) * 0.08;
      world.light(g, lx, ly, cast ? 24 : 15, 0xffbf45, cast ? 0.8 : flick);
    }

    if (u.type === "hero") {
      g.drawImage(PK.icons.small.star, footX - 8, footY - 41);
      PK.text(g, String(u.level), footX + 2, footY - 40, 0xffe08a, { font: "3", outline: C.ink, shadow: null });
    }
  }

  function drawTree(r) {
    const footX = Math.round(r.x / 2);
    const footY = Math.round(r.y / 2) + 15;
    const variant = Math.floor(hash3(r.x, r.y, 5) * 3);
    const t = PK.props.trees[variant];
    const stage = r.amount > 66 ? 0 : r.amount > 33 ? 1 : 2;
    const sway = Math.sin(clock * 1.3 + r.x * 0.05) > 0.35 ? 1 : 0;
    const shake = r.shake > 0 ? (Math.floor(clock * 30) & 1 ? 1 : -1) : 0;

    const sh = world.shadow("ellipse", 22, 7);
    g.drawImage(sh, footX - (sh.width >> 1) + 5, footY - (sh.height >> 1) - 1);

    g.drawImage(t.trunk, footX - t.ax, footY - t.ay);
    g.drawImage(t.crown[stage], footX - t.ax + sway + shake, footY - t.ay);

    // lantern-fruit twinkle
    if (stage === 0) {
      const k = Math.floor(clock * 1.6 + r.x) % t.fruit.length;
      const [fx0, fy0] = t.fruit[k];
      g.fillStyle = (Math.floor(clock * 6 + r.y) & 1) ? "#fff6cc" : "#ffbf45";
      g.fillRect(footX - t.ax + fx0 + sway, footY - t.ay + fy0, 1, 1);
    }
  }

  function drawMine(r) {
    const m = r.amount > 0 ? PK.props.mine : PK.props.mineEmpty;
    const footX = Math.round(r.x / 2);
    const footY = Math.round(r.y / 2) + 13;
    const sh = world.shadow("ellipse", 34, 8);
    g.drawImage(sh, footX - (sh.width >> 1) + 4, footY - (sh.height >> 1) - 1);
    g.drawImage(m.c, footX - m.ax + (r.shake > 0 ? (Math.floor(clock * 30) & 1) : 0), footY - m.ay);

    m.sparkle.forEach(([sx, sy], i) => {
      const ph = (clock * 1.3 + i * 0.61 + r.x * 0.01) % 2.4;
      if (ph > 0.28) return;
      const x = footX - m.ax + sx;
      const y = footY - m.ay + sy;
      g.fillStyle = "#fff6cc";
      g.fillRect(x, y, 1, 1);
      if (ph < 0.18) {
        g.fillRect(x - 1, y, 3, 1);
        g.fillRect(x, y - 1, 1, 3);
      }
    });
  }

  function flameAt(x, y, seed, size = 1) {
    const frames = PK.props.flame(7, 11);
    g.drawImage(frames[Math.floor(clock * 9 + seed) & 3], x - 3, y - 10 * size);
  }

  const blueprints = new Map();

  function blueprint(spr) {
    let c = blueprints.get(spr);

    if (!c) {
      const t = PK.makeCanvas(spr.c.width, spr.c.height);
      t.g.drawImage(spr.c, 0, 0);
      t.g.globalCompositeOperation = "source-atop";
      t.g.fillStyle = "rgba(70,150,255,0.7)";
      t.g.fillRect(0, 0, t.c.width, t.c.height);
      c = t.c;
      blueprints.set(spr, c);
    }

    return c;
  }

  function drawBuilding(b) {
    const spr = PK.buildings.get(b.type, b.team);
    const footX = Math.round(b.x / 2);
    const footY = Math.round(b.y / 2) + 19;
    const x0 = footX - spr.ax;
    const y0 = footY - spr.ay;
    const sh = world.shadow("building", spr.w - 14, 12);
    const building = b.progress >= 1;
    const prog = b.progress;

    g.drawImage(sh, footX - (sh.width / 2 - 6 | 0), footY - (sh.height - 7));

    if (!building) {
      // blueprint: průhledná modrá předloha celé budovy, hotová část roste od země nahoru
      const top = Math.round(y0 + spr.h * (1 - prog));

      g.globalAlpha = 0.5;
      g.drawImage(blueprint(spr), x0, y0);
      g.globalAlpha = 1;

      g.save();
      g.beginPath();
      g.rect(x0 - 4, top, spr.w + 8, 400);
      g.clip();
      g.drawImage(spr.c, x0, y0);
      g.restore();

      // lešení: dva sloupky a stavební čára
      g.fillStyle = "#946b45";
      g.fillRect(x0 - 1, top, 1, y0 + spr.h - top);
      g.fillRect(x0 + spr.w, top, 1, y0 + spr.h - top);

      for (let x = x0 - 1; x <= x0 + spr.w; x++) {
        if (((x + Math.floor(clock * 8)) & 1) === 0) {
          g.fillStyle = "#ffe08a";
          g.fillRect(x, top, 1, 1);
        }
      }

      return;
    }

    g.drawImage(spr.c, x0, y0);

    if (b.flashT > 0) {
      g.globalAlpha = 0.45;
      g.globalCompositeOperation = "lighter";
      g.drawImage(spr.c, x0, y0);
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
    }

    const banner = PK.buildings.banner(b.team);

    spr.banners.forEach(([bx, by], i) => {
      g.drawImage(banner[Math.floor(clock * 4.5 + i * 1.7 + b.id) & 3], x0 + bx, y0 + by);
    });

    if (spr.flames) spr.flames.forEach(([fxx, fyy], i) => flameAt(x0 + fxx, y0 + fyy, i * 2 + b.id));

    // wounded buildings burn
    const frac = b.hp / b.maxHp;
    const fires = frac < 0.25 ? 4 : frac < 0.5 ? 2 : frac < 0.75 ? 1 : 0;

    for (let i = 0; i < fires; i++) {
      const fxp = x0 + spr.w * (0.2 + 0.6 * hash3(b.id, i, 3));
      const fyp = y0 + spr.h * (0.3 + 0.45 * hash3(b.id, i, 4));
      flameAt(Math.round(fxp), Math.round(fyp), i * 3 + b.id);
    }
  }

  function drawDoodad(d) {
    const s = d.spr;
    const sh = world.shadow("ellipse", Math.max(8, s.w - 4), 4);

    if (!["lanternPost", "monolith", "skullStake", "signpost"].includes(d.name) || true) {
      g.drawImage(sh, d.x - (sh.width >> 1) + 2, d.y - (sh.height >> 1));
    }

    g.drawImage(s.c, d.x - s.ax, d.y - s.ay);

    if (s.flame) flameAt(d.x - s.ax + s.flame.x, d.y - s.ay + s.flame.y + 1, d.x, 1);

    if (s.sparkle) {
      s.sparkle.forEach(([sx, sy], i) => {
        const ph = (clock * 1.1 + i * 0.7 + d.x * 0.03) % 2.6;
        if (ph > 0.3) return;
        g.fillStyle = "#e0ffff";
        g.fillRect(d.x - s.ax + sx, d.y - s.ay + sy, 1, 1);
        if (ph < 0.2) {
          g.fillRect(d.x - s.ax + sx - 1, d.y - s.ay + sy, 3, 1);
          g.fillRect(d.x - s.ax + sx, d.y - s.ay + sy - 1, 1, 3);
        }
      });
    }
  }

  /* additive light pass: ground=true lights sit under the sprites */
  function lightFlicker(L, seed) {
    let a = L.a;
    if (L.flicker) a *= 0.8 + 0.2 * Math.sin(clock * 15 + seed) * Math.sin(clock * 6.3 + seed * 2);
    if (L.pulse) a *= 0.72 + 0.28 * Math.sin(clock * 2.1 + seed);
    return a;
  }

  function drawLights(ground) {
    for (const d of world.doodads) {
      const s = d.spr;

      if (ground && s.ground) {
        world.light(g, d.x - s.ax + s.ground.x, d.y - s.ay + s.ground.y, s.ground.r, s.ground.color, 0.22 * lightFlicker({ a: 1, flicker: true }, d.x));
      }

      if (!ground && s.glow) {
        world.light(g, d.x - s.ax + s.glow.x, d.y - s.ay + s.glow.y, s.glow.r, s.glow.color, lightFlicker(s.glow, d.x));
      }
    }

    for (const b of buildings) {
      if (b.progress < 1) continue;
      const spr = PK.buildings.get(b.type);
      const x0 = Math.round(b.x / 2) - spr.ax;
      const y0 = Math.round(b.y / 2) + 19 - spr.ay;

      for (const L of spr.glows) {
        if (!!L.ground !== ground) continue;
        let a = lightFlicker(L, b.id + L.x);
        if (b.type === "tower" && b.fireT > 0 && L.pulse) a = 1;
        world.light(g, x0 + L.x, y0 + L.y, L.r, L.color, a);
      }
    }

    if (!ground) {
      const m = PK.props.mine;

      for (const r of resources) {
        if (r.type !== "gold" || r.amount <= 0) continue;
        world.light(g, Math.round(r.x / 2) - m.ax + m.glow.x, Math.round(r.y / 2) + 13 - m.ay + m.glow.y, m.glow.r, m.glow.color, 0.35 + Math.sin(clock * 3 + r.x) * 0.06);
      }
    }
  }

  /* ---------- in-world UI ---------- */
  function drawBar(x, y, w, pct, team) {
    const fw = Math.max(1, Math.round(w * clamp(pct, 0, 1)));
    g.fillStyle = "#15121f";
    g.fillRect(x - 1, y - 1, w + 2, 4);
    g.fillStyle = "#2a1c26";
    g.fillRect(x, y, w, 2);
    g.fillStyle = pct > 0.5 ? "#6fd36f" : pct > 0.25 ? "#ffbf45" : "#ff5a4a";
    g.fillRect(x, y, fw, 2);
    g.fillStyle = "rgba(255,255,255,0.4)";
    g.fillRect(x, y, fw, 1);
    g.fillStyle = teamCss(team);
    g.fillRect(x - 2, y - 1, 1, 4);
  }

  function drawOverlays() {
    for (const u of units) {
      if (u.hp >= u.maxHp && !selected.includes(u)) continue;
      const w = u.type === "hero" ? 18 : 14;
      drawBar(Math.round(u.x / 2) - (w >> 1), Math.round(u.y / 2) + 6 - HB_TOP[u.type] - (u.type === "hero" ? 6 : 0), w, u.hp / u.maxHp, u.team);
    }

    for (const b of buildings) {
      const spr = PK.buildings.get(b.type);
      const w = b.type === "tower" || b.type === "hut" ? 22 : 34;
      const bx = Math.round(b.x / 2) - (w >> 1);
      const by = Math.round(b.y / 2) + 19 - spr.ay - 5;

      if (b.progress < 1) {
        drawProgressBar(bx, by, w, b.progress);
        continue;
      }

      if (b.hp >= b.maxHp && !selected.includes(b)) continue;
      drawBar(bx, by, w, b.hp / b.maxHp, b.team);
    }
  }

  function drawProgressBar(x, y, w, pct) {
    const fw = Math.max(1, Math.round(w * clamp(pct, 0, 1)));
    g.fillStyle = "#15121f";
    g.fillRect(x - 1, y - 1, w + 2, 4);
    g.fillStyle = "#1c2a46";
    g.fillRect(x, y, w, 2);
    g.fillStyle = "#58a6e0";
    g.fillRect(x, y, fw, 2);
    g.fillStyle = "rgba(255,255,255,0.4)";
    g.fillRect(x, y, fw, 1);
  }

  function selectionRing(e) {
    const footX = Math.round(e.x / 2);

    if (e.kind === "unit") {
      const footY = Math.round(e.y / 2) + 6;
      const rx = e.type === "hero" ? 11 : 9;
      const ry = 4;
      const pulse = 0.75 + 0.25 * Math.sin(clock * 5);
      g.globalAlpha = pulse;
      g.drawImage(ellipseRing(rx, ry, 0xffe08a), footX - rx - 1, footY - ry - 1);
      g.globalAlpha = 1;
      g.fillStyle = "#fff6cc";

      for (let k = 0; k < 4; k++) {
        const a = clock * 2 + k * Math.PI / 2;
        g.fillRect(Math.round(footX + Math.cos(a) * rx), Math.round(footY + Math.sin(a) * ry), 1, 1);
      }
    } else {
      const spr = PK.buildings.get(e.type);
      const footY = Math.round(e.y / 2) + 19;
      const rx = Math.round(spr.w * 0.42);
      const ry = 8;
      g.globalAlpha = 0.75 + 0.25 * Math.sin(clock * 5);
      g.drawImage(ellipseRing(rx, ry, 0xffe08a), footX - rx - 1, footY - ry - 3);
      g.globalAlpha = 1;
    }
  }

  function drawBrackets(e) {
    const spr = PK.buildings.get(e.type);
    const x0 = Math.round(e.x / 2) - spr.ax - 1;
    const y0 = Math.round(e.y / 2) + 19 - spr.ay - 1;
    const k = Math.round(Math.sin(clock * 4) * 0.5 + 0.5);
    const x1 = x0 + spr.w + 1 + k;
    const y1 = y0 + spr.h + 1 + k;
    g.fillStyle = "#ffe08a";

    for (const [cx, cy, dx, dy] of [[x0 - k, y0 - k, 1, 1], [x1, y0 - k, -1, 1], [x0 - k, y1, 1, -1], [x1, y1, -1, -1]]) {
      g.fillRect(dx > 0 ? cx : cx - 4, cy, 5, 1);
      g.fillRect(cx, dy > 0 ? cy : cy - 4, 1, 5);
    }
  }

  function dashedRect(x0, y0, x1, y1) {
    const xa = Math.round(Math.min(x0, x1));
    const xb = Math.round(Math.max(x0, x1));
    const ya = Math.round(Math.min(y0, y1));
    const yb = Math.round(Math.max(y0, y1));
    const off = Math.floor(clock * 12);

    g.fillStyle = "rgba(255,224,138,0.12)";
    g.fillRect(xa, ya, xb - xa, yb - ya);

    for (let x = xa; x <= xb; x++) {
      const on = ((x + off) >> 1) & 1;
      g.fillStyle = on ? "#fff6cc" : "#15121f";
      g.fillRect(x, ya, 1, 1);
      g.fillRect(x, yb, 1, 1);
    }

    for (let y = ya; y <= yb; y++) {
      const on = ((y + off) >> 1) & 1;
      g.fillStyle = on ? "#fff6cc" : "#15121f";
      g.fillRect(xa, y, 1, 1);
      g.fillRect(xb, y, 1, 1);
    }
  }

  function circlePx(cx, cy, r, color, dash = 0) {
    g.fillStyle = color;
    const steps = Math.ceil(r * 7);
    let lx = null;
    let ly = null;

    for (let i = 0; i < steps; i++) {
      const a = i / steps * Math.PI * 2;
      if (dash && Math.floor((a + clock * 0.5) / (Math.PI * 2) * dash * 2) % 2) continue;
      const x = Math.round(cx + Math.cos(a) * r);
      const y = Math.round(cy + Math.sin(a) * r);
      if (x === lx && y === ly) continue;
      g.fillRect(x, y, 1, 1);
      lx = x;
      ly = y;
    }
  }

  function drawPlacementGhost() {
    if (!placement || !hoverWorld) return;

    const ax = Math.round(hoverWorld.x / 2);
    const ay = Math.round(hoverWorld.y / 2);
    const ok = !placementProblem(hoverWorld.x, hoverWorld.y);
    const spr = PK.buildings.get(placement);

    circlePx(ax, ay, 45, ok ? "#7fe08a" : "#ff6a5a", 18);

    if (placement === "tower") {
      circlePx(ax, ay, 77.5, "rgba(255,224,138,0.55)", 26);
    }

    g.globalAlpha = ok ? 0.62 : 0.4;
    g.drawImage(spr.c, ax - spr.ax, ay + 19 - spr.ay);
    g.globalAlpha = 1;

    if (!ok) {
      g.globalAlpha = 0.28;
      g.fillStyle = "#ff3a2a";
      g.globalCompositeOperation = "source-atop";
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
    }
  }

  function drawSpellTarget() {
    if (spellMode !== "fire") return;
    const hero = selectedHero();
    if (!hero) return;

    circlePx(Math.round(hero.x / 2), Math.round(hero.y / 2) + 4, 90, "rgba(255,191,69,0.5)", 30);

    if (!hoverWorld) return;

    const inRange = distance(hero, hoverWorld) <= 180;
    const ax = Math.round(hoverWorld.x / 2);
    const ay = Math.round(hoverWorld.y / 2);
    const col = inRange ? "#ff8f4a" : "#8a8085";

    circlePx(ax, ay, 23.5, col, 12);
    g.fillStyle = inRange ? "#ffd27a" : "#8a8085";
    g.fillRect(ax, ay, 1, 1);

    for (const [dx, dy] of [[0, -4], [0, 4], [-4, 0], [4, 0]]) g.fillRect(ax + dx, ay + dy, 1, 1);
  }

  // Pozice kurzoru ve světě (logické jednotky), nebo null, když kurzor není nad mapou.
  let hoverWorld = null;

  function updateHover() {
    hover = null;
    hoverWorld = null;

    // na dotyku nahrazuje kurzor rozpracovaný cíl stavby nebo kouzla
    if (!placement && spellMode !== "fire") aim = null;

    if (aim) {
      hoverWorld = { x: aim.x, y: aim.y };
      return;
    }

    if (mouse.y >= mapAreaH() || mouse.y < 0 || mouse.x < 0 || PK.hud.minimapHit(mouse.x, mouse.y)) return;

    hoverWorld = toWorld(mouse);

    const friend =
      findEntity(hoverWorld.x, hoverWorld.y, units.filter(u => u.team === me), 19) ||
      findEntity(hoverWorld.x, hoverWorld.y, buildings.filter(b => b.team === me), 42);
    const enemy = enemyAt(hoverWorld.x, hoverWorld.y);
    const res = resourceAt(hoverWorld.x, hoverWorld.y);

    hover = { friend, enemy, res };
  }

  let cursorName = "";

  function updateCursor() {
    let name = "default";

    if (!hoverWorld || !hover) name = "default";
    else if (placement || spellMode || commandMode) name = "target";
    else if (hover.enemy && selected.some(s => s.kind === "unit")) name = "attack";
    else if (hover.res && selected.some(s => s.type === "worker")) name = "gather";

    if (name !== cursorName) {
      cursorName = name;
      canvas.style.cursor = PK.cursors[name];
    }
  }

  function drawGroundMarks() {
    // faint team rings keep factions readable at a glance
    for (const u of units) {
      const rx = u.type === "hero" ? 10 : 8;
      g.globalAlpha = u.team === me ? 0.4 : 0.55;
      g.drawImage(ellipseRing(rx, 3, PK.TEAM[u.team].ui), Math.round(u.x / 2) - rx - 1, Math.round(u.y / 2) + 6 - 4);
    }

    g.globalAlpha = 1;

    if (hover && !placement && !spellMode) {
      const e = hover.enemy || hover.friend;

      if (e && !selected.includes(e)) {
        g.globalAlpha = 0.6;
        if (e.kind === "unit") {
          g.drawImage(ellipseRing(9, 4, hover.enemy ? 0xff8f4a : 0xc6e8ff), Math.round(e.x / 2) - 10, Math.round(e.y / 2) + 6 - 5);
        } else {
          const spr = PK.buildings.get(e.type);
          const rx = Math.round(spr.w * 0.42);
          g.drawImage(ellipseRing(rx, 8, hover.enemy ? 0xff8f4a : 0xc6e8ff), Math.round(e.x / 2) - rx - 1, Math.round(e.y / 2) + 19 - 11);
        }
        g.globalAlpha = 1;
      }

      if (hover.res && selected.some(s => s.type === "worker")) {
        const r = hover.res;
        const fy = Math.round(r.y / 2) + (r.type === "gold" ? 13 : 15);
        g.globalAlpha = 0.5 + 0.3 * Math.sin(clock * 6);
        g.drawImage(ellipseRing(r.type === "gold" ? 18 : 11, 5, 0xffe08a), Math.round(r.x / 2) - (r.type === "gold" ? 19 : 12), fy - 6);
        g.globalAlpha = 1;
      }
    }

    for (const e of selected) {
      if (alive(e)) selectionRing(e);
    }

    const sr = selectedResource();

    if (sr) {
      const gold = sr.type === "gold";
      g.globalAlpha = 0.75 + 0.25 * Math.sin(clock * 5);
      g.drawImage(ellipseRing(gold ? 18 : 11, 5, 0xffe08a), Math.round(sr.x / 2) - (gold ? 19 : 12), Math.round(sr.y / 2) + (gold ? 13 : 15) - 6);
      g.globalAlpha = 1;
    }
  }

  const list = [];

  function render(dt) {
    const T = clock;
    const vw = view.w;
    const vh = view.mapH;
    const zw = vw / zoom;
    const zh = vh / zoom;
    const worldView = { x: cam.x, y: cam.y, w: zw, h: zh };
    const visible = (ax, ay) => ax > cam.x - 90 && ax < cam.x + zw + 90 && ay > cam.y - 90 && ay < cam.y + zh + 110;

    g.fillStyle = "#15121f";
    g.fillRect(0, 0, view.w, view.h);

    // všechno nad HUD je oříznuto na mapovou část; svět se kreslí posunutý o kameru
    g.save();
    g.beginPath();
    g.rect(0, 0, vw, vh);
    g.clip();

    g.save();
    g.scale(zoom, zoom);
    g.translate(-cam.x, -cam.y);

    world.drawGround(g, T, worldView);
    fx.drawGround(g, T);
    drawGroundMarks();
    drawLights(true);

    list.length = 0;
    for (const r of resources) if (visible(r.x / 2, r.y / 2)) list.push({ y: r.y / 2 + (r.type === "gold" ? 13.5 : 15), k: r.type === "gold" ? 1 : 0, o: r });
    for (const d of world.doodads) if (visible(d.x, d.y)) list.push({ y: d.y, k: 2, o: d });
    for (const b of buildings) if (visible(b.x / 2, b.y / 2)) list.push({ y: b.y / 2 + 19.5, k: 3, o: b });
    for (const u of units) if (visible(u.x / 2, u.y / 2)) list.push({ y: u.y / 2 + 6, k: 4, o: u });
    list.sort((a, b) => a.y - b.y);

    for (const it of list) {
      if (it.k === 0) drawTree(it.o);
      else if (it.k === 1) drawMine(it.o);
      else if (it.k === 2) drawDoodad(it.o);
      else if (it.k === 3) drawBuilding(it.o);
      else drawUnit(it.o);
    }

    fx.drawAir(g, T);
    drawLights(false);
    g.restore();

    g.save();
    g.scale(zoom, zoom);
    world.drawClouds(g, T, cam);
    world.drawMist(g, T, cam);
    g.restore();
    world.drawGrade(g, vw, vh);

    g.save();
    g.scale(zoom, zoom);
    g.translate(-cam.x, -cam.y);

    fx.drawAmbient(g, T);

    for (const e of selected) if (alive(e) && e.kind === "building") drawBrackets(e);
    drawOverlays();
    fx.drawTexts(g);
    drawPlacementGhost();
    drawSpellTarget();

    if (pointerStart && pointerEnd && pointerStart.y < mapAreaH() && !placement && !spellMode && !commandMode) {
      const end = toWorld(pointerEnd);

      if (Math.hypot(end.x - pointerStart.wx, end.y - pointerStart.wy) > 9) {
        dashedRect(pointerStart.wx / 2, pointerStart.wy / 2, end.x / 2, end.y / 2);
      } else if (touchGesture && touchGesture.mode === "box") {
        // podržení prstu: kroužek potvrzuje, že se začíná vybírat rámečkem
        circlePx(Math.round(pointerStart.wx / 2), Math.round(pointerStart.wy / 2), 6 + Math.round(Math.sin(clock * 10)), "#fff6cc");
      }
    }

    g.restore();
    g.restore();

    // HUD
    const hero = selectedHero();
    const hasWorker = selected.some(e => e.type === "worker" && alive(e));
    const hall = buildings.some(b => b.team === me && b.type === R.HQ[me] && alive(b));
    const barracks = buildings.some(b => b.team === me && b.type === "barracks" && alive(b));
    const heroAlive = units.some(u => u.team === me && u.type === "hero" && alive(u));
    const afford = type => gold >= costs[type].gold && wood >= costs[type].wood;
    const smithies = buildings.filter(b => b.team === me && b.type === "smithy" && b.progress >= 1 && alive(b));
    const vmCosts = { ...costs };
    const vmTitles = {};
    const vmTips = {};
    const research = {};

    for (const kind of ["armor", "weapon"]) {
      const up = R.UPGRADES[kind];
      const lvl = upgrades[kind];
      const def = up.levels[lvl];
      const run = smithies.find(s => s.research && s.research.kind === kind);
      const busyElsewhere = !run && smithies.every(s => s.research);
      const effect = kind === "armor"
        ? `Vojáci dostanou o ${Math.round(R.ARMOR_PER_LEVEL * 100)} % méně poškození.`
        : `Vojáci dají o ${R.WEAPON_PER_LEVEL} více poškození.`;

      vmCosts[kind] = def && !run ? def : null;
      vmTitles[kind] = `${up.name} ${lvl}/${up.levels.length}`;
      vmTips[kind] = def
        ? `${effect} Výzkum trvá ${def.time} s. Platí pro všechny vojáky.`
        : "Nejvyšší stupeň vylepšení.";
      research[kind] = {
        afford: !def || (gold >= def.gold && wood >= def.wood),
        enabled: !!def && smithies.length > 0 && !busyElsewhere && !run,
        cd: run ? up.levels[lvl].time * (1 - run.research.frac) : 0,
        cdMax: def ? def.time : 1
      };
    }
    const hoverBtnObj = mouse.y >= mapAreaH() ? PK.hud.hitButton(mouse.x, mouse.y) : null;
    const pressed = keyPress ? keyPress.type : pressedBtn;

    const btn = {
      worker: { afford: afford("worker"), enabled: hall },
      soldier: { afford: afford("soldier"), enabled: barracks },
      archer: { afford: afford("archer"), enabled: barracks },
      hero: { afford: afford("hero"), enabled: barracks && !heroAlive },
      tower: { afford: afford("tower"), enabled: hasWorker, active: placement === "tower" },
      barracks: { afford: afford("barracks"), enabled: hasWorker, active: placement === "barracks" },
      hut: { afford: afford("hut"), enabled: hasWorker, active: placement === "hut" },
      smithy: { afford: afford("smithy"), enabled: hasWorker, active: placement === "smithy" },
      armor: research.armor,
      weapon: research.weapon,
      fire: { enabled: !!hero, cd: hero ? hero.fireCooldown : 0, cdMax: 10, active: spellMode === "fire" },
      heal: { enabled: !!hero, cd: hero ? hero.healCooldown : 0, cdMax: 14 },
      command: { enabled: true, active: commandMode }
    };

    PK.hud.setCard(cardContext());

    const vm = {
      gold, wood, army: units.filter(u => u.team === me).length, supplyMax: supplyCap,
      focus: focusType(),
      typeCount: selectionTypes().length,
      primary: selected.find(e => e.type === focus) || selected[0],
      state, elapsed, selected, units, buildings, resources,
      message, messageTimer, placement, spellMode, commandMode, names, costs: vmCosts, titles: vmTitles, tips: vmTips, btn,
      hoverBtn: hoverBtnObj ? hoverBtnObj.type : null,
      pressedBtn: pressed,
      myTeam: me,
      players,
      resource: selectedResource(),
      cam: { x: cam.x, y: cam.y, w: view.w / zoom, h: view.mapH / zoom },
      spectating: !matchOver && state !== "playing",
      endReason: matchOver ? endReason() : "",
      endHint: mode === "online" ? "R: zpět do místnosti · Esc: menu" : "R: nová hra · Esc: menu"
    };

    if (matchPhase === "countdown" && mode === "online") drawCountdown();

    PK.hud.draw(g, vm, T, dt);

    if (matchOver && started) PK.hud.drawEnd(g, vm, T, endT);
  }

  function drawCountdown() {
    const cx = Math.round(view.w / 2);
    const top = Math.max(14, Math.round(view.mapH / 2 - 54));
    const foes = players.filter(p => !p.me).map(p => p.name).join(", ").slice(0, 46);

    g.fillStyle = "rgba(10,8,20,0.45)";
    g.fillRect(0, 0, view.w, view.mapH);

    PK.text(g, `ZÁPAS PROTI ${foes}`, cx, top, 0xffe08a, { align: "center", scale: 1 });
    PK.text(g, `HRAJEŠ ZA: ${R.TEAM_NAMES[me].toUpperCase()}`, cx, top + 14, PK.TEAM[me].ui, { align: "center" });
    PK.text(g, String(Math.max(1, online.count)), cx, top + 38, 0xfff6cc, { align: "center", scale: 5, outline: C.ink, shadow: null });
  }

  /* ======================= display scaling ======================= */
  const stage = document.querySelector("#stage");
  let scale = 1;

  // Okno určuje velikost bufferu: výška drží původní poměr (310 art px při největším zvětšení),
  // šířka se přizpůsobí poměru stran okna, takže na širokém monitoru je vidět víc mapy.
  function fit() {
    const MIN_W = 480;
    const MIN_H = 310;
    const dpr = window.devicePixelRatio || 1;
    const availW = Math.max(160, stage.clientWidth);
    const availH = Math.max(120, stage.clientHeight);
    const k = Math.floor(Math.min(availW * dpr / MIN_W, availH * dpr / MIN_H));
    let vw;
    let vh;
    let cw;
    let ch;
    let cssW;
    let cssH;

    if (settings.pixel && k >= 1) {
      vw = Math.max(MIN_W, Math.ceil(availW * dpr / k));
      vh = Math.max(MIN_H, Math.ceil(availH * dpr / k));
      cw = vw * k;
      ch = vh * k;
      cssW = cw / dpr;
      cssH = ch / dpr;
    } else {
      const s = Math.min(availW / MIN_W, availH / MIN_H);
      vw = Math.max(MIN_W, Math.ceil(availW / s));
      vh = Math.max(MIN_H, Math.ceil(availH / s));
      cssW = vw * s;
      cssH = vh * s;
      cw = Math.max(vw, Math.round(cssW * dpr));
      ch = Math.max(vh, Math.round(cssH * dpr));
    }

    view.w = vw;
    view.h = vh;
    view.mapH = vh - view.hudH;

    if (bufCanvas.width !== vw || bufCanvas.height !== vh) {
      bufCanvas.width = vw;
      bufCanvas.height = vh;
      g.imageSmoothingEnabled = false;
    }

    canvas.width = cw;
    canvas.height = ch;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    scale = cw / vw;
    // pravý horní roh zabírá tlačítko menu (cca 54 css px), HUD se mu vyhne
    view.inset = Math.ceil(98 / (cssW / vw));
    display.imageSmoothingEnabled = false;

    PK.hud.relayout();
    setCam(camF.x, camF.y);
  }

  function present() {
    const s = settings.shake ? fx.shake : 0;
    const sx = s > 0.05 ? Math.round((Math.random() - 0.5) * 2 * s) : 0;
    const sy = s > 0.05 ? Math.round((Math.random() - 0.5) * 2 * s) : 0;
    const k = scale;
    const mapH = view.mapH;

    display.imageSmoothingEnabled = false;
    display.fillStyle = "#15121f";

    if (sx || sy) {
      display.fillRect(0, 0, canvas.width, mapH * k);
      display.drawImage(bufCanvas, 0, 0, view.w, mapH, sx * k, sy * k, view.w * k, mapH * k);
      display.drawImage(bufCanvas, 0, mapH, view.w, view.h - mapH, 0, mapH * k, view.w * k, (view.h - mapH) * k);
    } else {
      display.drawImage(bufCanvas, 0, 0, canvas.width, canvas.height);
    }
  }

  if (window.ResizeObserver) new ResizeObserver(fit).observe(stage);
  window.addEventListener("resize", fit);

  /* ======================= main loop ======================= */
  let previousFrame = performance.now();

  function frame(now) {
    const dt = Math.min(
      (now - previousFrame) / 1000,
      0.05
    );

    previousFrame = now;

    // online běží i s otevřeným menu, hra proti AI se pauzuje
    const running = !menuOpen || (mode === "online" && started);

    if (running) {
      if (started) {
        if (mode === "ai") pumpSim(dt);
        netUpdate(dt);
        updateCamera(dt);
      }

      updateVisuals(dt);
      updateHover();
      updateCursor();
    } else if (!started) {
      updateVisuals(dt);
    }

    audio.listener.x = cam.x * 2;
    audio.listener.w = view.w / zoom * 2;
    render(dt);
    present();

    requestAnimationFrame(frame);
  }

  PK.hud.drawLogo(document.querySelector("#logo"));
  reset();
  loadMap(map, 0);
  fit();
  requestAnimationFrame(frame);

  // read-only handle for tests and debugging
  PK.game = {
    get state() { return state; },
    get gold() { return gold; },
    get wood() { return wood; },
    get units() { return units; },
    get buildings() { return buildings; },
    get resources() { return resources; },
    get selected() { return selected; },
    get mode() { return mode; },
    get me() { return me; },
    get map() { return map; },
    get cam() { return cam; },
    online,
    cheat(k, v) { if (k === "gold") gold = v; if (k === "wood") wood = v; },
    select(list) { selected = list; },
    startOffline,
    reset
  };
})();
