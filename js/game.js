/*
 * Game logic (unchanged mechanics) + rendering glue.
 * Rules, AI, combat, economy, controls and numbers are the original ones;
 * the additions here only drive visuals (animation timers, effects, HUD).
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
  const net = PK.net;

  const canvas = document.querySelector("#game");
  const display = canvas.getContext("2d");
  const { c: bufCanvas, g } = PK.makeCanvas(PK.VW, PK.VH);

  const WIDTH = 960;
  const MAP_HEIGHT = 480;
  const HEIGHT = 620;

  const costs = {
    worker:   { gold: 50,  wood: 0 },
    soldier:  { gold: 65,  wood: 15 },
    archer:   { gold: 80,  wood: 30 },
    hero:     { gold: 150, wood: 50 },
    tower:    { gold: 90,  wood: 55 },
    barracks: { gold: 125, wood: 70 }
  };

  const names = {
    worker: "Dělník",
    soldier: "Voják",
    archer: "Lučištník",
    hero: "Hrdina",
    raider: "Nájezdník",
    hall: "Radnice",
    barracks: "Kasárna",
    tower: "Strážní věž",
    citadel: "Rudá pevnost"
  };

  let units;
  let buildings;
  let resources;
  let selected;

  let gold;
  let wood;
  let elapsed;
  let waveTimer;
  let waveMax;
  let state;
  let placement;
  let commandMode;
  let spellMode;
  let message;
  let messageTimer;
  let nextId;

  let pointerStart = null;
  let pointerEnd = null;
  let mouse = { x: -100, y: -100 };
  let pressedBtn = null;
  let keyPress = null;
  let waveFlash = 0;
  let endT = 0;
  let clock = 0;
  let battleLevel = 0;
  let lastBattle = 0;
  let hover = null;

  // "ai": původní hra proti počítači. "online": zápas 1v1, o všem rozhoduje server.
  let mode = "ai";
  let me = "blue";
  let foeTeam = "red";

  const UNIT_TYPES = ["worker", "soldier", "archer", "hero"];
  const BUILDING_TYPES = ["hall", "citadel", "barracks", "tower"];
  const ORDER_TYPES = [null, "move", "attack", "gather"];

  const online = {
    phase: "offline", // offline | connecting | idle | queued | countdown | playing | ended
    you: "",
    opponent: "",
    why: "",
    stats: { queued: 0, playing: 0 },
    queuedAt: 0,
    wantSearch: false,
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

  const FAIL_MSG = /^(Potřebuješ|Nejdřív|Pro stavbu|Současně|Maximum|Stavět lze|Na tomto|Hrdina už|Cíl je|Ohnivá koule: ještě|Léčení: ještě)/;

  function announce(value) {
    message = value;
    messageTimer = 3;
    if (FAIL_MSG.test(value)) audio.play("error");
  }

  /* ======================= entities ======================= */
  function createBuilding(type, x, y, team = "blue", fresh = false) {
    const maxHp = {
      hall: 500,
      barracks: 290,
      tower: 175,
      citadel: 650
    }[type];

    const building = {
      id: nextId++,
      kind: "building",
      type,
      team,
      x,
      y,
      hp: maxHp,
      maxHp,
      cooldown: 0,
      age: fresh ? 0 : 99,
      flashT: 0,
      fireT: 0,
      smokeAcc: 0
    };

    buildings.push(building);
    return building;
  }

  function createUnit(type, x, y, team = "blue") {
    // HP, rychlost, poškození, dosah a prodleva mezi útoky.
    const stats = {
      worker:  [65, 55, 6,  22, 0.85],
      soldier: [110, 45, 15, 25, 0.72],
      archer:  [70, 49, 11, 110, 1.04],
      hero:    [210, 53, 23, 34, 0.68],
      raider:  [85, 43, 12, 25, 0.90]
    }[type];

    const unit = {
      id: nextId++,
      kind: "unit",
      type,
      team,
      x,
      y,
      hp: stats[0],
      maxHp: stats[0],
      speed: stats[1],
      damage: stats[2],
      range: stats[3],
      attackDelay: stats[4],
      cooldown: 0,
      fireCooldown: 0,
      healCooldown: 0,
      order: null,
      harvestTimer: 0,
      carry: null,
      level: 1,
      xp: 0,
      walkCycle: 0,
      facing: team === "red" ? -1 : 1,
      // visual-only state
      atk: 0,
      castT: 0,
      flashT: 0,
      workT: 0,
      fxT: 0,
      moveT: 0,
      wd: 0,
      lx: x,
      ly: y,
      stepT: 0
    };

    units.push(unit);
    return unit;
  }

  function reset() {
    mode = "ai";
    me = "blue";
    foeTeam = "red";
    units = [];
    buildings = [];
    resources = [];
    selected = [];
    unitMap.clear();
    buildingMap.clear();
    resourceMap.clear();
    online.firstSnapshot = true;

    gold = 260;
    wood = 120;
    elapsed = 0;
    waveTimer = 12;
    waveMax = 12;
    state = "playing";
    placement = null;
    commandMode = false;
    spellMode = null;
    message = "";
    messageTimer = 0;
    nextId = 1;
    pointerStart = null;
    pointerEnd = null;
    pressedBtn = null;
    waveFlash = 0;
    endT = 0;

    createBuilding("hall", 120, 238);
    createBuilding("barracks", 191, 354);
    createBuilding("citadel", 850, 234, "red");

    createUnit("worker", 173, 194);
    createUnit("worker", 164, 266);
    createUnit("soldier", 259, 234);
    createUnit("soldier", 280, 255);

    createUnit("raider", 770, 254, "red");
    createUnit("raider", 798, 299, "red");

    resources.push(
      { type: "gold", x: 320, y: 112, amount: Infinity, shake: 0 },
      { type: "gold", x: 390, y: 394, amount: Infinity, shake: 0 }
    );

    const trees = [
      [29,69], [64,53], [102,70], [143,48],
      [192,78], [232,54], [32,382], [66,427],
      [113,404], [164,430], [249,416], [434,69],
      [466,98], [502,55], [520,397], [560,425],
      [599,394], [631,423], [706,67], [754,88],
      [919,80], [920,373], [890,421], [737,414]
    ];

    for (const [x, y] of trees) {
      resources.push({
        type: "wood",
        x,
        y,
        amount: 100,
        shake: 0
      });
    }

    if (!world.ready) {
      // Terén se staví jednou pro obě hry, proto zná i základny a doly soupeře z online zápasu.
      world.build({
        buildings: R.LAYOUT.buildings,
        resources: [
          ...R.LAYOUT.gold.map(([x, y]) => ({ type: "gold", x, y })),
          ...R.LAYOUT.trees.map(([x, y]) => ({ type: "wood", x, y }))
        ]
      });
    }
    fx.reset();
  }

  /* ======================= economy / actions ======================= */
  function pay(type) {
    const price = costs[type];

    if (gold < price.gold || wood < price.wood) {
      announce(
        `Potřebuješ ${price.gold} zlata a ${price.wood} dřeva.`
      );
      return false;
    }

    gold -= price.gold;
    wood -= price.wood;
    audio.play("coin");
    return true;
  }

  function selectedHero() {
    return selected.find(entity =>
      entity.kind === "unit" &&
      entity.type === "hero" &&
      alive(entity)
    );
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

      if (mode === "online") {
        audio.play("click");
        net.send({ t: "cmd", c: "heal" });
        return;
      }

      let healed = 0;
      const amount = 42 + hero.level * 10;

      for (const ally of units) {
        if (
          ally.team !== "blue" ||
          !alive(ally) ||
          distance(ally, hero) > 90 ||
          ally.hp >= ally.maxHp
        ) continue;

        ally.hp = Math.min(ally.maxHp, ally.hp + amount);
        healed++;
        fx.healOn(ally.x, ally.y + 4);
        fx.text(ally.x, ally.y - 30, `+${amount}`, 0x9ef7c8);
      }

      hero.healCooldown = 14;
      hero.castT = 0.5;
      fx.healBurst(hero.x, hero.y + 8, 90);
      audio.play("heal", { x: hero.x });

      announce(`Vyléčeno spojenců: ${healed}.`);
      return;
    }

    if (type === "tower" || type === "barracks") {
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

    if (mode === "online") {
      audio.play("click");
      online.pendingTrain = 1.5;
      net.send({ t: "cmd", c: "train", type });
      return;
    }

    const hall = buildings.find(building =>
      building.type === "hall" && alive(building)
    );

    const barracks = buildings.find(building =>
      building.type === "barracks" && alive(building)
    );

    const source = type === "worker" ? hall : barracks;

    if (!source) {
      return announce(
        type === "worker"
          ? "Potřebuješ radnici."
          : "Potřebuješ kasárna."
      );
    }

    if (
      type === "hero" &&
      units.some(unit =>
        unit.team === "blue" &&
        unit.type === "hero" &&
        alive(unit)
      )
    ) {
      return announce("Současně můžeš mít jen jednoho hrdinu.");
    }

    if (
      units.filter(unit =>
        unit.team === "blue" && alive(unit)
      ).length >= 30
    ) {
      return announce("Maximum je 30 jednotek.");
    }

    if (pay(type)) {
      const newUnit = createUnit(
        type,
        source.x + 58,
        source.y + 29
      );

      selected = [newUnit];
      fx.spawn(newUnit.x, newUnit.y + 12);
      audio.play("spawn", { x: newUnit.x });

      if (type === "hero") {
        announce(
          "Hrdina připraven: A ohnivá koule, S léčení."
        );
      }
    }
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

  function selectAt(x, y) {
    const friendlyUnit = findEntity(
      x, y,
      units.filter(unit => unit.team === me),
      19
    );

    const friendlyBuilding = findEntity(
      x, y,
      buildings.filter(building => building.team === me),
      42
    );

    selected = friendlyUnit
      ? [friendlyUnit]
      : friendlyBuilding
        ? [friendlyBuilding]
        : [];

    if (selected.length) audio.play("select");
  }

  function enemyAt(x, y) {
    return (
      findEntity(x, y, units.filter(unit => unit.team === foeTeam), 20) ||
      findEntity(x, y, buildings.filter(building => building.team === foeTeam), 46)
    );
  }

  function resourceAt(x, y) {
    return resources.find(item =>
      item.amount > 0 &&
      Math.hypot(item.x - x, item.y - y) <
        (item.type === "gold" ? 31 : 26)
    );
  }

  function issueOrder(x, y) {
    const enemy = enemyAt(x, y);
    const resource = resourceAt(x, y);
    let ordered = false;
    let kind = "move";

    if (mode === "online") {
      const ids = selected
        .filter(unit => unit.kind === "unit" && alive(unit))
        .map(unit => unit.id);

      if (ids.length) {
        kind = enemy ? "attack" : resource ? "gather" : "move";

        net.send({
          t: "cmd",
          c: "order",
          k: kind,
          ids,
          target: enemy ? enemy.id : resource ? resource.id : 0,
          x: Math.round(x),
          y: Math.round(y)
        });

        ordered = true;
      }
    } else {
      for (const unit of selected) {
        if (unit.kind !== "unit" || !alive(unit)) continue;
        ordered = true;

        if (enemy) {
          unit.order = { type: "attack", target: enemy };
          kind = "attack";
        } else if (resource && unit.type === "worker") {
          unit.order = { type: "gather", target: resource };
          kind = "gather";
        } else {
          unit.order = { type: "move", x, y };
        }
      }
    }

    if (ordered) {
      if (kind === "attack") fx.ping(enemy.x, enemy.y + 12, "attack");
      else if (kind === "gather") fx.ping(resource.x, resource.y + (resource.type === "gold" ? 26 : 28), "gather");
      else fx.ping(x, y, "move");
      audio.play("order", { x });
    }

    commandMode = false;
  }

  function placementProblem(x, y) {
    const zone = mode === "online"
      ? R.buildZone(me)
      : { x0: 45, x1: 715, y0: 85, y1: MAP_HEIGHT - 45 };

    if (
      x < zone.x0 ||
      x > zone.x1 ||
      y < zone.y0 ||
      y > zone.y1
    ) {
      return "Stavět lze jen ve vlastní části mapy.";
    }

    const collidesWithBuilding = buildings.some(building =>
      alive(building) &&
      distance(building, { x, y }) < 90
    );

    const collidesWithResource = resources.some(resource =>
      resource.amount > 0 &&
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

    if (mode === "online") {
      net.send({
        t: "cmd",
        c: "build",
        type: placement,
        x: Math.round(x),
        y: Math.round(y),
        ids: selected.filter(e => e.type === "worker" && alive(e)).map(e => e.id)
      });
      placement = null;
      online.pendingBuild = 1.5;
      audio.play("click");
      return;
    }

    if (!pay(placement)) return;

    const newBuilding = createBuilding(placement, x, y, "blue", true);
    selected = [newBuilding];
    placement = null;
    fx.build(x, y + 39, newBuilding.type === "tower" ? 26 : 56);
    audio.play("build", { x });
    announce("Stavba dokončena.");
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

    if (mode === "online") {
      net.send({ t: "cmd", c: "fire", x: Math.round(x), y: Math.round(y) });
      return;
    }

    hero.fireCooldown = 10;
    hero.castT = 0.5;
    hero.facing = x < hero.x ? -1 : 1;

    fx.fireball(hero.x + hero.facing * 14, hero.y - 6, x, y + 8, 47);
    audio.play("fireCast", { x: hero.x });
    fx.later(0.3, () => audio.play("explosion", { x }));

    let hits = 0;

    for (const enemy of [...units, ...buildings]) {
      if (!alive(enemy) || enemy.team !== "red") continue;

      const radius =
        enemy.kind === "building" ? 70 : 47;

      if (distance(enemy, { x, y }) <= radius) {
        damage(hero, enemy, 42 + hero.level * 10, { silent: true, delay: 0.3 });
        hits++;
      }
    }

    announce(
      hits
        ? `Ohnivá koule zasáhla ${hits} cílů!`
        : "Ohnivá koule minula."
    );
  }

  /* ======================= pointer + keyboard ======================= */
  function pointerPosition(event) {
    const bounds = canvas.getBoundingClientRect();

    return {
      x: (event.clientX - bounds.left) *
        WIDTH / bounds.width,
      y: (event.clientY - bounds.top) *
        HEIGHT / bounds.height
    };
  }

  canvas.addEventListener("contextmenu", event => {
    event.preventDefault();

    if (state !== "playing") return;

    if (placement || spellMode) {
      placement = null;
      spellMode = null;
      announce("Akce zrušena.");
      return;
    }

    const point = pointerPosition(event);

    if (point.y < MAP_HEIGHT) {
      issueOrder(point.x, point.y);
    }
  });

  canvas.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    audio.unlock();

    canvas.setPointerCapture(event.pointerId);
    pointerStart = pointerPosition(event);
    pointerEnd = pointerStart;

    const btn = pointerStart.y >= MAP_HEIGHT ? PK.hud.hitButton(pointerStart.x, pointerStart.y) : null;
    pressedBtn = btn ? btn.type : null;
  });

  canvas.addEventListener("pointermove", event => {
    mouse = pointerPosition(event);

    if (pointerStart) {
      pointerEnd = mouse;
    }
  });

  canvas.addEventListener("pointerleave", () => {
    mouse = { x: -100, y: -100 };
  });

  canvas.addEventListener("pointercancel", () => {
    pointerStart = null;
    pointerEnd = null;
    pressedBtn = null;
  });

  canvas.addEventListener("pointerup", event => {
    if (event.button !== 0 || !pointerStart) return;

    const point = pointerPosition(event);
    const start = pointerStart;

    pointerStart = null;
    pointerEnd = null;
    pressedBtn = null;

    if (state !== "playing") return;

    if (start.y >= MAP_HEIGHT) {
      const button = PK.hud.hitButton(point.x, point.y);

      if (button) action(button.type);
      return;
    }

    if (placement) {
      placeBuilding(point.x, point.y);
      return;
    }

    if (spellMode === "fire") {
      castFire(point.x, point.y);
      return;
    }

    if (commandMode) {
      issueOrder(point.x, point.y);
      return;
    }

    if (
      Math.hypot(
        point.x - start.x,
        point.y - start.y
      ) > 9
    ) {
      const left = Math.min(point.x, start.x);
      const right = Math.max(point.x, start.x);
      const top = Math.min(point.y, start.y);
      const bottom = Math.max(point.y, start.y);

      selected = units.filter(unit =>
        alive(unit) &&
        unit.team === me &&
        unit.x >= left &&
        unit.x <= right &&
        unit.y >= top &&
        unit.y <= bottom
      );
      if (selected.length) audio.play("select");
    } else {
      selectAt(point.x, point.y);
    }
  });

  window.addEventListener("keydown", event => {
    if (event.repeat) return;

    const key = event.key.toLowerCase();

    if (key === "escape" || key === "p") {
      if (menuOpen) {
        const page = pages.find(p => !p.hidden);
        if (key === "p" && event.target.matches("input")) return;
        if (page && page.dataset.page !== "main") showPage("main");
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

    const shortcuts = {
      q: "worker",
      w: "soldier",
      e: "archer",
      h: "hero",
      t: "tower",
      f: "barracks",
      a: "fire",
      s: "heal",
      m: "command"
    };

    if (shortcuts[key]) {
      keyPress = { type: shortcuts[key], t: 0.14 };
      action(shortcuts[key]);
    }

    if (key === "r" && state !== "playing") {
      if (mode === "online") searchAgain();
      else newGame();
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
    if (name !== "online") leaveLobby();
    for (const page of pages) page.hidden = page.dataset.page !== name;
    const first = menuEl.querySelector(`.page[data-page="${name}"] button:not([hidden]):not(:disabled)`);
    if (first) first.focus({ preventScroll: true });
  }

  const liveOnline = () =>
    mode === "online" && started && (online.phase === "countdown" || online.phase === "playing");

  function endReason() {
    const won = state === "win";

    switch (online.why) {
      case "surrender": return won ? "Soupeř se vzdal." : "Vzdal ses.";
      case "disconnect": return "Soupeř se odpojil.";
      case "connection": return "Spojení se serverem bylo přerušeno.";
      default: return won ? "Soupeřova základna padla." : "Tvoje základna padla.";
    }
  }

  function syncMenu() {
    const onl = mode === "online" && started;
    const live = liveOnline();
    const over = onl && !live;

    $("m-online").hidden = onl && !over;
    $("m-online").textContent = over ? "Hledat dalšího soupeře" : "Online 1v1";
    $("m-play").textContent = started ? "Pokračovat" : "Hra proti AI";
    $("m-restart").hidden = !started || onl;
    $("m-surrender").hidden = !live;
    $("m-leave").hidden = !over;
    menuBtn.hidden = !started || menuOpen;

    if (!started) statusEl.textContent = "";
    else if (live) statusEl.textContent = `Zápas proti ${online.opponent}. Hra běží i s otevřeným menu.`;
    else if (onl) {
      statusEl.textContent = `${state === "win" ? "Vítězství!" : state === "lose" ? "Porážka." : "Remíza."} ${endReason()}`;
    } else if (state === "win") statusEl.textContent = "Vítězství! Rudá pevnost padla.";
    else if (state === "lose") statusEl.textContent = "Porážka. Zkus to znovu.";
    else statusEl.textContent = "Hra je pozastavena.";

    // a finished game cannot be resumed
    $("m-play").hidden = onl ? !live : started && state !== "playing";
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

  function newGame() {
    reset();
    started = true;
    closeMenu();
  }

  function play() {
    audio.unlock();
    if (settings.autoFullscreen && !isFullscreen()) toggleFullscreen();
    if (started) closeMenu();
    else newGame();
  }

  /* ======================= online: lobby ======================= */
  const NAME_KEY = "pk-name";
  const oStatus = $("o-status");
  const oStats = $("o-stats");
  const oSearch = $("o-search");
  const oName = $("o-name");
  const oServer = $("o-server");

  const playerName = () => oName.value.trim() || "Hrac";

  function syncLobby() {
    const phase = online.phase;
    const busy = phase === "connecting" || phase === "queued";

    oName.disabled = busy;
    oServer.disabled = busy;
    oSearch.disabled = phase === "connecting";
    oSearch.textContent = phase === "queued" ? "Zrušit hledání" : phase === "idle" ? "Hledat soupeře" : "Připojit k serveru";

    if (phase === "connecting") {
      oStatus.textContent = "Připojuji se k serveru…";
    } else if (phase === "queued") {
      const s = Math.floor((performance.now() - online.queuedAt) / 1000);
      oStatus.textContent = `Hledám soupeře… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}\nAž se někdo najde, hra začne sama.`;
    } else if (phase === "idle") {
      oStatus.textContent = "Připojeno. Klikni na Hledat soupeře.";
    } else {
      oStatus.textContent = online.error || "Nejsi připojený k serveru.";
    }

    oStats.textContent = phase === "idle" || phase === "queued"
      ? `Ve frontě: ${online.stats.queued} · Ve hře: ${online.stats.playing}`
      : "";
  }

  function connectLobby(search) {
    online.wantSearch = !!search;
    online.error = "";
    online.phase = "connecting";
    online.server = oServer.value.trim();
    syncLobby();

    net.connect(online.server).catch(() => {
      if (online.phase !== "connecting") return;
      online.phase = "offline";
      online.error = "Server není dostupný. Zkontroluj adresu a jestli server běží.";
      syncLobby();
    });
  }

  function startSearch() {
    try { localStorage.setItem(NAME_KEY, playerName()); } catch (e) { /* ignore */ }
    net.send({ t: "queue", name: playerName() });
  }

  function leaveLobby() {
    const phase = online.phase;

    if (phase === "queued") net.send({ t: "unqueue" });

    if (phase === "queued" || phase === "idle" || phase === "connecting") {
      online.phase = "offline";
      online.wantSearch = false;
      online.error = "";
      net.close();
    }
  }

  function resetToIdle() {
    reset();
    started = false;
    online.phase = net.connected ? "idle" : "offline";
    syncMenu();
  }

  function enterLobby(search) {
    audio.unlock();
    if (mode === "online") resetToIdle();

    let savedName = "";
    try { savedName = localStorage.getItem(NAME_KEY) || ""; } catch (e) { /* ignore */ }
    if (!oName.value) oName.value = savedName;

    if (!oServer.value) {
      try { oServer.value = localStorage.getItem("pk-server") || ""; } catch (e) { /* ignore */ }
    }

    oServer.placeholder = net.defaultUrl();
    showPage("online");

    if (online.phase === "offline") connectLobby(search);
    else if (search && online.phase === "idle") startSearch();

    syncLobby();
    oSearch.focus({ preventScroll: true });
  }

  function lobbyAction() {
    audio.unlock();

    // změněná adresa serveru = nové spojení
    if (online.phase === "idle" && oServer.value.trim() !== online.server) {
      net.close();
      connectLobby(true);
    } else if (online.phase === "queued") net.send({ t: "unqueue" });
    else if (online.phase === "idle") startSearch();
    else if (online.phase === "offline") connectLobby(true);
  }

  function searchAgain() {
    if (mode !== "online" || online.phase !== "ended") return;
    openMenu("online");
    enterLobby(true);
  }

  function leaveOnline() {
    net.close();
    resetToIdle();
    online.phase = "offline";
    showPage("main");
  }

  /* ======================= online: match state ======================= */
  function beginOnlineMatch(m) {
    reset();
    units = [];
    buildings = [];
    resources = [];

    mode = "online";
    me = m.team === "red" ? "red" : "blue";
    foeTeam = me === "blue" ? "red" : "blue";
    online.phase = "countdown";
    online.you = m.you;
    online.opponent = m.opponent;
    online.why = "";
    online.pendingTrain = 0;
    gold = 0;
    wood = 0;
    waveTimer = 0;
    waveMax = 1;
    started = true;
    closeMenu();
  }

  function finishOnline(winner, why) {
    if (online.phase === "ended") return;

    online.phase = "ended";
    online.why = why;
    state = winner === me ? "win" : winner ? "lose" : "draw";
    endT = 0;
    placement = null;
    spellMode = null;
    commandMode = false;
    audio.play(state === "win" ? "win" : "lose");
    syncMenu();
  }

  function netUnit(id, type, team, x, y) {
    const s = R.UNITS[type];

    return {
      id, kind: "unit", type, team, x, y, sx: x, sy: y,
      hp: s.hp, maxHp: s.hp, speed: s.speed, damage: s.damage, range: s.range,
      attackDelay: s.delay, cooldown: 0, fireCooldown: 0, healCooldown: 0,
      order: null, carry: null, level: 1, xp: 0, walkCycle: 0,
      facing: team === "red" ? -1 : 1,
      atk: 0, castT: 0, flashT: 0, workT: 0, fxT: 0, moveT: 0, wd: 0, lx: x, ly: y, stepT: 0
    };
  }

  function netBuilding(id, type, team, x, y, fresh) {
    return {
      id, kind: "building", type, team, x, y, hp: 1, maxHp: 1, cooldown: 0,
      age: fresh ? 0 : 99, flashT: 0, fireT: 0, smokeAcc: 0
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

      case "coin": {
        const unit = unitMap.get(e.id);
        if (!unit) return;
        fx.coin(unit.x, unit.y, "+10", e.r === "wood");
        if (unit.team === me) audio.play("coin", { x: unit.x });
        break;
      }

      case "end":
        finishOnline(e.w, e.why);
        break;

      default:
    }
  }

  function applySnapshot(s) {
    if (mode !== "online" || online.phase === "ended") return;

    const first = online.firstSnapshot;
    online.firstSnapshot = false;

    for (const e of s.e) netEvent(e);
    for (const note of s.n) announce(note);

    if (s.p === "countdown" || s.p === "playing") online.phase = s.p;
    online.count = s.c;
    elapsed = s.el;
    gold = s.g;
    wood = s.w;

    const seenUnits = new Set();

    for (const d of s.u) {
      const [id, t, team, x, y, hp, maxHp, face, carry, level, xp, order, fcd, hcd, work, dmg] = d;
      let u = unitMap.get(id);

      if (!u) {
        u = netUnit(id, UNIT_TYPES[t], team ? "red" : "blue", x, y);
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
      u.working = !!work;
      u.damage = dmg;
    }

    if (seenUnits.size !== units.length) {
      for (const u of units) if (!seenUnits.has(u.id)) unitMap.delete(u.id);
      units = units.filter(u => seenUnits.has(u.id));
    }

    const seenBuildings = new Set();

    for (const d of s.b) {
      const [id, t, team, x, y, hp, maxHp] = d;
      let b = buildingMap.get(id);

      if (!b) {
        b = netBuilding(id, BUILDING_TYPES[t], team ? "red" : "blue", x, y, !first);
        buildingMap.set(id, b);
        buildings.push(b);

        if (!first) {
          fx.build(x, y + 39, b.type === "tower" ? 26 : 56);
          audio.play("build", { x });
          if (b.team === me && online.pendingBuild > 0) {
            selected = [b];
            online.pendingBuild = 0;
          }
        }
      }

      seenBuildings.add(id);
      b.hp = hp;
      b.maxHp = maxHp;
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
        r = { id, type: t ? "wood" : "gold", x, y, amount: 0, shake: 0 };
        resourceMap.set(id, r);
        resources.push(r);
      }

      seenResources.add(id);
      r.amount = amount < 0 ? Infinity : amount;
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
      case "stats":
        online.stats = { queued: m.queued | 0, playing: m.playing | 0 };

        if (m.t === "hello" && online.phase === "connecting") {
          online.phase = "idle";
          if (online.wantSearch) startSearch();
        }

        syncLobby();
        break;

      case "queued":
        online.phase = "queued";
        online.queuedAt = performance.now();
        syncLobby();
        break;

      case "unqueued":
        if (online.phase === "queued") online.phase = "idle";
        syncLobby();
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
    if (mode === "online" && started && (online.phase === "countdown" || online.phase === "playing")) {
      finishOnline(foeTeam, "connection");
      return;
    }

    if (online.phase !== "ended") {
      online.phase = "offline";
      online.error = "Spojení se serverem bylo přerušeno.";
      syncLobby();
    }
  };

  setInterval(() => {
    if (online.phase === "queued" && menuOpen) syncLobby();
  }, 500);

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
    $("m-fullscreen").textContent = on ? "Okno" : "Celá obrazovka";
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
  $("m-online").addEventListener("click", () => enterLobby(mode === "online"));
  $("m-leave").addEventListener("click", leaveOnline);
  $("m-surrender").addEventListener("click", () => {
    if (!liveOnline() || !window.confirm("Opravdu se chceš vzdát?")) return;
    net.send({ t: "cmd", c: "surrender" });
    closeMenu();
  });
  $("o-search").addEventListener("click", lobbyAction);
  for (const input of [oName, oServer]) {
    input.addEventListener("keydown", event => {
      if (event.key === "Enter" && online.phase !== "queued") lobbyAction();
    });
  }
  $("m-restart").addEventListener("click", () => {
    audio.unlock();
    newGame();
  });
  $("m-settings").addEventListener("click", () => showPage("settings"));
  $("m-help").addEventListener("click", () => showPage("help"));
  $("m-fullscreen").addEventListener("click", toggleFullscreen);
  $("s-fullscreen").addEventListener("click", toggleFullscreen);
  menuBtn.addEventListener("click", () => openMenu());

  for (const back of menuEl.querySelectorAll("[data-back]")) {
    back.addEventListener("click", () => showPage("main"));
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

  /* ======================= simulation ======================= */
  function moveTowards(unit, target, dt, stop = 0) {
    const dx = target.x - unit.x;
    const dy = target.y - unit.y;
    const length = Math.hypot(dx, dy);

    if (length <= stop || length < 0.001) {
      return true;
    }

    if (Math.abs(dx) > 0.4) unit.facing = dx < 0 ? -1 : 1;

    const step = Math.min(
      unit.speed * dt,
      length - stop
    );

    unit.x = clamp(
      unit.x + dx / length * step,
      12,
      WIDTH - 12
    );

    unit.y = clamp(
      unit.y + dy / length * step,
      38,
      MAP_HEIGHT - 14
    );

    return length - step <= stop + 0.5;
  }

  function nearestEnemy(entity, maxDistance) {
    let nearest = null;
    let bestDistance = maxDistance;

    for (const candidate of [...units, ...buildings]) {
      if (
        !alive(candidate) ||
        candidate.team === entity.team
      ) continue;

      const currentDistance =
        distance(entity, candidate);

      if (currentDistance < bestDistance) {
        nearest = candidate;
        bestDistance = currentDistance;
      }
    }

    return nearest;
  }

  function awardExperience(attacker, target) {
    if (
      target.kind !== "unit" ||
      target.team !== "red"
    ) return;

    const hero = units.find(unit =>
      unit.type === "hero" &&
      unit.team === "blue" &&
      alive(unit)
    );

    if (!hero) return;

    if (
      attacker !== hero &&
      distance(hero, target) > 145
    ) return;

    hero.xp += 25;
    fx.text(hero.x, hero.y - 44, "+25 XP", 0xd0b4ff);

    while (hero.xp >= xpNeeded(hero.level)) {
      hero.xp -= xpNeeded(hero.level);
      hero.level++;

      hero.maxHp += 27;
      hero.hp = Math.min(
        hero.maxHp,
        hero.hp + 55
      );

      hero.damage += 3;

      announce(
        `Hrdina dosáhl úrovně ${hero.level}!`
      );

      fx.levelUp(hero.x, hero.y + 8);
      audio.play("levelUp");
    }
  }

  /* Visual consequences of a hit are scheduled; the numbers apply immediately. */
  function damage(attacker, target, amount, opts = {}) {
    if (!alive(target)) return;

    target.hp -= amount;
    const killed = target.hp <= 0;
    if (killed) target.hp = 0;

    hitVisuals(attacker, target, amount, opts, killed);

    if (killed) {
      awardExperience(attacker, target);

      if (target.type === "citadel") {
        state = "win";
        fx.later(1.2, () => audio.play("win"));
      }

      if (target.type === "hall") {
        state = "lose";
        fx.later(1.2, () => audio.play("lose"));
      }
    }
  }

  /* Shared by the local simulation and by hit events from the server. */
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

  function strike(unit, target) {
    unit.atk = 0.3;
    unit.facing = target.x < unit.x ? -1 : 1;
    damage(unit, target, unit.damage);
    unit.cooldown = unit.attackDelay;
  }

  function gather(unit, dt) {
    if (unit.order?.type !== "gather") {
      return false;
    }

    const resource = unit.order.target;

    const hall = buildings.find(building =>
      building.type === "hall" &&
      building.team === "blue" &&
      alive(building)
    );

    if (!resource || resource.amount <= 0) {
      unit.order = null;
      unit.carry = null;
      return false;
    }

    if (unit.carry) {
      if (!hall) return true;

      if (moveTowards(unit, hall, dt, 48)) {
        if (unit.carry === "gold") {
          gold += 10;
        } else {
          wood += 10;
        }

        fx.coin(unit.x, unit.y, "+10", unit.carry === "wood");
        audio.play("coin", { x: unit.x });
        unit.carry = null;
      }

      return true;
    }

    const stop =
      resource.type === "gold" ? 31 : 24;

    if (moveTowards(unit, resource, dt, stop)) {
      unit.harvestTimer += dt;
      unit.workT = 0.2;
      unit.facing = resource.x < unit.x ? -1 : 1;
      unit.fxT -= dt;

      if (unit.fxT <= 0) {
        unit.fxT = 0.42;
        resource.shake = 0.22;

        if (resource.type === "wood") fx.chop(resource.x, resource.y + 14);
        else fx.mine(resource.x, resource.y + 12);
        audio.play(resource.type === "wood" ? "wood" : "mine", { x: resource.x });
      }

      if (unit.harvestTimer >= 0.9) {
        unit.harvestTimer = 0;
        unit.carry = resource.type;

        if (resource.type === "wood") {
          resource.amount -= 10;
        }
      }
    }

    return true;
  }

  function update(dt) {
    if (state !== "playing") return;

    elapsed += dt;
    waveTimer -= dt;
    messageTimer = Math.max(0, messageTimer - dt);

    if (waveTimer <= 0) {
      waveTimer = Math.max(
        8,
        18 - elapsed / 80
      );
      waveMax = waveTimer;

      const citadel = buildings.find(building =>
        building.type === "citadel" &&
        alive(building)
      );

      if (citadel) {
        const count = Math.min(
          5,
          1 + Math.floor(elapsed / 55)
        );

        for (let i = 0; i < count; i++) {
          const raider = createUnit(
            "raider",
            citadel.x - 50 - i * 15,
            citadel.y + 43 + i * 17,
            "red"
          );

          fx.puff(raider.x, raider.y + 12, 6);
        }

        waveFlash = 1.6;
        audio.play("horn", { x: citadel.x });

        announce(
          `Přichází nepřátelská vlna: ${count} jednotek.`
        );
      }
    }

    for (const building of buildings) {
      if (!alive(building)) continue;

      building.cooldown -= dt;

      if (
        building.type === "tower" &&
        building.cooldown <= 0
      ) {
        const target =
          nearestEnemy(building, 155);

        if (target) {
          damage(building, target, 20);
          building.cooldown = 0.85;
        }
      }
    }

    for (const unit of units) {
      if (!alive(unit) || state !== "playing") {
        continue;
      }

      unit.cooldown -= dt;

      const moveIntent =
        unit.order &&
        (unit.order.type === "move" ||
          unit.order.type === "gather" ||
          (unit.order.type === "attack" &&
            distance(unit, unit.order.target) >
              unit.range + 6));

      unit.walkCycle +=
        moveIntent ? dt * (4 + unit.speed / 22) : 0;

      unit.fireCooldown = Math.max(
        0,
        unit.fireCooldown - dt
      );

      unit.healCooldown = Math.max(
        0,
        unit.healCooldown - dt
      );

      if (
        unit.team === "blue" &&
        unit.type === "worker" &&
        gather(unit, dt)
      ) {
        continue;
      }

      // Přesun má přednost před automatickým útokem.
      if (unit.order?.type === "move") {
        if (
          moveTowards(unit, unit.order, dt, 5)
        ) {
          unit.order = null;
        }

        continue;
      }

      let target =
        unit.order?.type === "attack" &&
        alive(unit.order.target)
          ? unit.order.target
          : null;

      if (!target) {
        target = nearestEnemy(
          unit,
          unit.team === "red" ? 1200 : 100
        );
      }

      if (!target) continue;

      const reach =
        unit.range +
        (target.kind === "building" ? 24 : 0);

      if (distance(unit, target) > reach) {
        if (
          unit.team === "red" ||
          unit.order?.type === "attack"
        ) {
          moveTowards(
            unit,
            target,
            dt,
            reach - 2
          );
        }
      } else if (unit.cooldown <= 0) {
        strike(unit, target);
      }
    }

    units = units.filter(alive);
    buildings = buildings.filter(alive);

    resources = resources.filter(
      resource => resource.amount > 0
    );

    selected = selected.filter(alive);
  }

  /* ======================= visual state ======================= */
  function updateVisuals(dt) {
    clock += dt;
    waveFlash = Math.max(0, waveFlash - dt);
    if (state !== "playing") endT += dt;
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
      if (b.age < 0.9) continue;

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
    const m = PK.props.mine;
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

  function drawBuilding(b) {
    const spr = PK.buildings.get(b.type, b.team);
    const footX = Math.round(b.x / 2);
    const footY = Math.round(b.y / 2) + 19;
    const x0 = footX - spr.ax;
    const y0 = footY - spr.ay;
    const sh = world.shadow("building", spr.w - 14, 12);
    const building = b.age >= 0.9;
    const prog = Math.min(1, b.age / 0.9);

    g.drawImage(sh, footX - (sh.width / 2 - 6 | 0), footY - (sh.height - 7));

    if (!building) {
      g.save();
      g.beginPath();
      g.rect(0, Math.round(y0 + spr.h * (1 - prog)), 480, 400);
      g.clip();
      g.drawImage(spr.c, x0, y0);
      g.restore();
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
      if (b.age < 0.9) continue;
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
        if (r.type !== "gold") continue;
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
    g.fillStyle = team === "blue" ? "#58a6e0" : "#e2603c";
    g.fillRect(x - 2, y - 1, 1, 4);
  }

  function drawOverlays() {
    for (const u of units) {
      if (u.hp >= u.maxHp && !selected.includes(u)) continue;
      const w = u.type === "hero" ? 18 : 14;
      drawBar(Math.round(u.x / 2) - (w >> 1), Math.round(u.y / 2) + 6 - HB_TOP[u.type] - (u.type === "hero" ? 6 : 0), w, u.hp / u.maxHp, u.team);
    }

    for (const b of buildings) {
      if (b.age < 0.9) continue;
      if (b.hp >= b.maxHp && !selected.includes(b)) continue;
      const spr = PK.buildings.get(b.type);
      const w = b.type === "tower" ? 22 : 34;
      drawBar(Math.round(b.x / 2) - (w >> 1), Math.round(b.y / 2) + 19 - spr.ay - 5, w, b.hp / b.maxHp, b.team);
    }
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
    if (!placement || mouse.y >= MAP_HEIGHT) return;

    const ax = Math.round(mouse.x / 2);
    const ay = Math.round(mouse.y / 2);
    const ok = !placementProblem(mouse.x, mouse.y);
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

    if (mouse.y >= MAP_HEIGHT) return;

    const inRange = distance(hero, mouse) <= 180;
    const ax = Math.round(mouse.x / 2);
    const ay = Math.round(mouse.y / 2);
    const col = inRange ? "#ff8f4a" : "#8a8085";

    circlePx(ax, ay, 23.5, col, 12);
    g.fillStyle = inRange ? "#ffd27a" : "#8a8085";
    g.fillRect(ax, ay, 1, 1);

    for (const [dx, dy] of [[0, -4], [0, 4], [-4, 0], [4, 0]]) g.fillRect(ax + dx, ay + dy, 1, 1);
  }

  function updateHover() {
    hover = null;

    if (mouse.y >= MAP_HEIGHT || mouse.y < 0 || mouse.x < 0) return;

    const friend =
      findEntity(mouse.x, mouse.y, units.filter(u => u.team === me), 19) ||
      findEntity(mouse.x, mouse.y, buildings.filter(b => b.team === me), 42);
    const enemy = enemyAt(mouse.x, mouse.y);
    const res = resourceAt(mouse.x, mouse.y);

    hover = { friend, enemy, res };
  }

  let cursorName = "";

  function updateCursor() {
    let name = "default";

    if (mouse.y >= MAP_HEIGHT || !hover) name = "default";
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
      g.globalAlpha = u.team === "red" ? 0.55 : 0.4;
      g.drawImage(ellipseRing(rx, 3, u.team === "red" ? 0xe2603c : 0x58a6e0), Math.round(u.x / 2) - rx - 1, Math.round(u.y / 2) + 6 - 4);
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
  }

  const list = [];

  function render(dt) {
    const T = clock;

    world.drawGround(g, T);
    fx.drawGround(g, T);
    drawGroundMarks();
    drawLights(true);

    list.length = 0;
    for (const r of resources) list.push({ y: r.y / 2 + (r.type === "gold" ? 13.5 : 15), k: r.type === "gold" ? 1 : 0, o: r });
    for (const d of world.doodads) list.push({ y: d.y, k: 2, o: d });
    for (const b of buildings) list.push({ y: b.y / 2 + 19.5, k: 3, o: b });
    for (const u of units) list.push({ y: u.y / 2 + 6, k: 4, o: u });
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

    world.drawClouds(g, T);
    world.drawMist(g, T);
    world.drawGrade(g);

    if (waveFlash > 0) {
      for (let k = 0; k < 6; k++) {
        g.fillStyle = `rgba(214,90,60,${(waveFlash / 1.6) * (0.24 - k * 0.04)})`;
        g.fillRect(480 - (k + 1) * 3, 0, 3, 240);
      }
    }

    fx.drawAmbient(g, T);

    for (const e of selected) if (alive(e) && e.kind === "building") drawBrackets(e);
    drawOverlays();
    fx.drawTexts(g);
    drawPlacementGhost();
    drawSpellTarget();

    if (pointerStart && pointerEnd && pointerStart.y < MAP_HEIGHT && !placement && !spellMode && !commandMode) {
      if (Math.hypot(pointerEnd.x - pointerStart.x, pointerEnd.y - pointerStart.y) > 9) {
        dashedRect(pointerStart.x / 2, pointerStart.y / 2, pointerEnd.x / 2, pointerEnd.y / 2);
      }
    }

    // HUD
    const hero = selectedHero();
    const hasWorker = selected.some(e => e.type === "worker" && alive(e));
    const hall = buildings.some(b => b.team === me && b.type === R.HQ[me] && alive(b));
    const barracks = buildings.some(b => b.team === me && b.type === "barracks" && alive(b));
    const heroAlive = units.some(u => u.team === me && u.type === "hero" && alive(u));
    const afford = type => gold >= costs[type].gold && wood >= costs[type].wood;
    const hoverBtnObj = mouse.y >= MAP_HEIGHT ? PK.hud.hitButton(mouse.x, mouse.y) : null;
    const pressed = keyPress ? keyPress.type : pressedBtn;

    const btn = {
      worker: { afford: afford("worker"), enabled: hall },
      soldier: { afford: afford("soldier"), enabled: barracks },
      archer: { afford: afford("archer"), enabled: barracks },
      hero: { afford: afford("hero"), enabled: barracks && !heroAlive },
      tower: { afford: afford("tower"), enabled: hasWorker, active: placement === "tower" },
      barracks: { afford: afford("barracks"), enabled: hasWorker, active: placement === "barracks" },
      fire: { enabled: !!hero, cd: hero ? hero.fireCooldown : 0, cdMax: 10, active: spellMode === "fire" },
      heal: { enabled: !!hero, cd: hero ? hero.healCooldown : 0, cdMax: 14 },
      command: { enabled: true, active: commandMode }
    };

    const vm = {
      gold, wood, army: units.filter(u => u.team === me).length, supplyMax: R.SUPPLY_MAX,
      waveTimer, waveMax, state, elapsed, selected, units, buildings, resources,
      message, messageTimer, placement, spellMode, commandMode, names, costs, btn,
      hoverBtn: hoverBtnObj ? hoverBtnObj.type : null,
      pressedBtn: pressed,
      online: mode === "online",
      myTeam: me,
      opponent: online.opponent,
      endReason: mode === "online" && state !== "playing" ? endReason() : ""
    };

    if (mode === "online" && online.phase === "countdown") drawCountdown();

    PK.hud.draw(g, vm, T, dt);

    if (state !== "playing") PK.hud.drawEnd(g, vm, T, endT);
  }

  function drawCountdown() {
    g.fillStyle = "rgba(10,8,20,0.45)";
    g.fillRect(0, 0, 480, PK.MAPH);

    PK.text(g, `ZÁPAS PROTI ${online.opponent}`, 240, 66, 0xffe08a, { align: "center", scale: 1 });
    PK.text(g, me === "blue" ? "HRAJEŠ ZA MODRÉ KRÁLOVSTVÍ" : "HRAJEŠ ZA RUDOU PEVNOST", 240, 80, me === "blue" ? 0x8fd0ff : 0xff9a7a, { align: "center" });
    PK.text(g, String(Math.max(1, online.count)), 240, 104, 0xfff6cc, { align: "center", scale: 5, outline: C.ink, shadow: null });
  }

  /* ======================= display scaling ======================= */
  const stage = document.querySelector("#stage");
  let scale = 1;

  function fit() {
    const dpr = window.devicePixelRatio || 1;
    const availW = Math.max(160, stage.clientWidth);
    const availH = Math.max(120, stage.clientHeight);
    const k = Math.floor(Math.min(availW * dpr / PK.VW, availH * dpr / PK.VH));
    let cw;
    let ch;
    let cssW;
    let cssH;

    if (settings.pixel && k >= 1) {
      cw = PK.VW * k;
      ch = PK.VH * k;
      cssW = cw / dpr;
      cssH = ch / dpr;
    } else {
      const s = Math.min(availW / PK.VW, availH / PK.VH);
      cssW = PK.VW * s;
      cssH = PK.VH * s;
      cw = Math.max(PK.VW, Math.round(cssW * dpr));
      ch = Math.max(PK.VH, Math.round(cssH * dpr));
    }

    canvas.width = cw;
    canvas.height = ch;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    scale = cw / PK.VW;
    display.imageSmoothingEnabled = false;
  }

  function present() {
    const s = settings.shake ? fx.shake : 0;
    const sx = s > 0.05 ? Math.round((Math.random() - 0.5) * 2 * s) : 0;
    const sy = s > 0.05 ? Math.round((Math.random() - 0.5) * 2 * s) : 0;
    const k = scale;

    display.imageSmoothingEnabled = false;
    display.fillStyle = "#15121f";

    if (sx || sy) {
      display.fillRect(0, 0, canvas.width, PK.MAPH * k);
      display.drawImage(bufCanvas, 0, 0, PK.VW, PK.MAPH, sx * k, sy * k, PK.VW * k, PK.MAPH * k);
      display.drawImage(bufCanvas, 0, PK.MAPH, PK.VW, PK.VH - PK.MAPH, 0, PK.MAPH * k, PK.VW * k, (PK.VH - PK.MAPH) * k);
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

    const onlineLive = mode === "online" && started;

    if (!menuOpen || onlineLive) {
      if (mode === "online") netUpdate(dt);
      else update(dt);

      updateVisuals(dt);
      updateHover();
      updateCursor();
    } else if (!started) {
      updateVisuals(dt);
    }
    render(dt);
    present();

    requestAnimationFrame(frame);
  }

  PK.hud.drawLogo(document.querySelector("#logo"));
  fit();
  reset();
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
    get waveTimer() { return waveTimer; },
    get mode() { return mode; },
    get me() { return me; },
    online,
    cheat(k, v) { if (k === "gold") gold = v; if (k === "wood") wood = v; if (k === "wave") waveTimer = v; },
    spawn: createUnit,
    select(list) { selected = list; },
    reset
  };
})();
