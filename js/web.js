/*
 * Úvodní stránka webu: pixelové nadpisy, živé sprity jednotek z kódu hry, pochodující armáda v úvodu,
 * jiskry, líně načítaná videa, galerie se zvětšením a postupné odhalování sekcí.
 * Spoléhá jen na pixel.js, font.js, icons.js, units.js a rules.js; bez nich stránka funguje dál jako obyčejné HTML.
 */
(() => {
  "use strict";

  const PK = window.PK || {};
  const root = document.documentElement;
  root.classList.add("js");

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  const canDraw = !!(PK.text && PK.makeCanvas && PK.C);
  const C = PK.C || {};
  const R = PK.rules || {};

  const safe = fn => {
    try { return fn(); } catch (e) { console.warn("web:", e); return null; }
  };

  /* ---------- pixelové písmo hry ---------- */
  const LINE = 12; // výška řádku písma "5" v art px (včetně háčků a čárek)

  function pixelLines(lines, { color = C.a[3], shadow = C.ink, align = "left" } = {}) {
    const w = Math.max(...lines.map(l => PK.textWidth(l.toUpperCase(), "5"))) + 3;
    const h = lines.length * LINE + 2;
    const { c, g } = PK.makeCanvas(w, h);
    lines.forEach((line, i) => {
      const x = align === "center" ? Math.floor(w / 2) : 1;
      PK.text(g, line, x, 3 + i * LINE, color, { shadow, align });
    });
    c.className = "pix";
    c.setAttribute("aria-hidden", "true");
    return c;
  }

  // Nadpisy sekcí: text zůstává v HTML pro čtečky a vyhledávače, vedle se vykreslí pixelová kopie.
  function headings() {
    for (const h of document.querySelectorAll("h2.pix-h")) {
      if (!h.dataset.text) {
        h.dataset.text = h.textContent.trim();
        h.innerHTML = `<span class="label">${h.innerHTML}</span>`;
        h.classList.add("has-pix");
      }

      const box = h.clientWidth || h.parentElement.clientWidth;
      const zoom = box < 420 ? 3 : box < 760 ? 4 : 5;
      const maxW = Math.floor(box / zoom) - 4;
      const key = `${zoom}|${maxW}`;
      if (h.dataset.key === key) continue;
      h.dataset.key = key;

      const center = h.classList.contains("center");
      const c = pixelLines(PK.wrap(h.dataset.text.toUpperCase(), maxW), { align: center ? "center" : "left" });
      c.style.width = `${c.width * zoom}px`;
      c.style.height = `${c.height * zoom}px`;
      const old = h.querySelector("canvas");
      if (old) old.replaceWith(c); else h.append(c);
    }
  }

  function buttons() {
    for (const b of document.querySelectorAll("[data-pix]")) {
      const zoom = b.classList.contains("big") ? 5 : 2;
      const c = pixelLines([b.dataset.pix], { color: C.a[4], shadow: C.r[1] });
      c.style.width = `${c.width * zoom}px`;
      c.style.height = `${c.height * zoom}px`;
      b.innerHTML = `<span class="label">${b.textContent}</span>`;
      b.prepend(c);
      b.classList.add("has-pix");
    }
  }

  function emblem() {
    const target = document.querySelector(".brand .emblem");
    const src = PK.icons.ringEmblem(16, C.a[2], C.a[4]);
    target.width = src.width;
    target.height = src.height;
    const g = target.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0);
    const word = pixelLines(["Goralia"], { color: C.a[3] });
    word.classList.add("word");
    word.style.height = `${word.height * 2}px`;
    word.style.width = `${word.width * 2}px`;
    const span = document.querySelector(".brand span");
    span.className = "sr-only";
    span.after(word);
  }

  /* ---------- ikony z HUD hry ---------- */
  function iconCanvas(target, name) {
    const src = (PK.icons.big && PK.icons.big[name]) || (PK.icons.small && PK.icons.small[name]);
    if (!src) return;
    const fine = PK.hdOf(src);
    target.width = fine.width;
    target.height = fine.height;
    const g = target.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.drawImage(fine, 0, 0);
    target.classList.add("pix");
    target.setAttribute("aria-hidden", "true");
  }

  function icons() {
    for (const c of document.querySelectorAll("canvas[data-icon]")) iconCanvas(c, c.dataset.icon);
  }

  /* ---------- živé sprity jednotek ---------- */
  const FRAME_MS = { idle: 420, walk: 85, attack: 110, cast: 130 };
  const frameCache = new Map();

  function frames(type, team, anim) {
    const key = `${type}|${team}|${anim}`;
    if (!frameCache.has(key)) {
      const n = PK.units.frameCount(anim);
      const list = [];
      for (let i = 0; i < n; i++) list.push(PK.units.frame(type, team, anim, i).pix.rawCanvas());
      frameCache.set(key, list);
    }
    return frameCache.get(key);
  }

  const PEOPLE = [
    { type: "worker", name: "Dělník", role: "Těží zlato, kácí dřevo, staví a opravuje budovy. Náklad nosí na zádech." },
    { type: "soldier", name: "Voják", role: "Pěšák se štítem a mečem, páteř každé armády." },
    { type: "archer", name: "Lučištník", role: "Střílí z dálky. S výzkumem Střelba víc a dál." },
    { type: "hero", name: "Hrdina", role: "Sbírá zkušenosti a úrovně, umí ohnivou kouli a léčení.", cast: true },
    { type: "monk", name: "Mnich", role: "Požehnáním léčí raněné spojence v okolí.", cast: true },
    { type: "knight", name: "Rytíř", role: "Rychlý jezdec. Po rozjezdu udeří s bonusem za nápor." },
    { type: "catapult", name: "Katapult", role: "Kámen dopadá na plochu a budovám ubere 2,5× víc." }
  ];
  const UNDEAD = [
    { type: "ghoul", name: "Ghúl", role: "Rychlý a hladový, chodí v houfech." },
    { type: "skeleton", name: "Kostlivý střelec", role: "Luk z kostí a mířidla bez očí." },
    { type: "abomination", name: "Zrůda", role: "Sešitá z těl, s řetězem a ohromnou výdrží." },
    { type: "banshee", name: "Přízrak", role: "Kvílící duch, který útočí z dálky." },
    { type: "lich", name: "Pekelný lich", role: "Pán nemrtvých s pekelným výbuchem.", cast: true }
  ];

  const sprites = new Set();

  function spriteCanvas(type, team, anim = "idle") {
    const first = frames(type, team, "idle")[0];
    const { c, g } = PK.makeCanvas(first.width, first.height);
    c.className = "pix";
    const s = { c, g, type, team, anim, t0: performance.now() + Math.random() * 400, visible: false, last: -1 };
    s.set = a => { s.anim = a; s.t0 = performance.now(); s.last = -1; };
    sprites.add(s);
    visibility.observe(c);
    c.sprite = s;
    return s;
  }

  function drawSprite(s, now) {
    const list = frames(s.type, s.team, s.anim);
    const i = Math.floor((now - s.t0) / FRAME_MS[s.anim]);
    const idx = ((i % list.length) + list.length) % list.length;
    if (idx === s.last) return;
    s.last = idx;
    s.g.clearRect(0, 0, s.c.width, s.c.height);
    s.g.drawImage(list[idx], 0, 0);
  }

  const ANIM_NAME = { idle: "stojí", walk: "chůze", attack: "útok", cast: "kouzlo" };

  function stat(icon, value, label) {
    const span = document.createElement("span");
    span.title = label;
    const c = document.createElement("canvas");
    iconCanvas(c, icon);
    span.append(c, document.createTextNode(value));
    return span;
  }

  function unitCard(u, team) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "unit";
    const s = spriteCanvas(u.type, team);
    s.c.classList.add("sprite");
    const anims = ["idle", "walk", "attack"].concat(u.cast ? ["cast"] : []);
    let k = 0;
    const tag = document.createElement("span");
    tag.className = "anim";
    tag.textContent = ANIM_NAME.idle;

    const h = document.createElement("h3");
    h.textContent = u.name;
    const p = document.createElement("p");
    p.className = "role";
    p.textContent = u.role;
    card.append(tag, s.c, h, p);

    const st = R.UNITS && R.UNITS[u.type];
    if (st) {
      const row = document.createElement("div");
      row.className = "stats";
      row.append(stat("heart", st.hp, "Životy"), stat("sword", st.damage, "Útok"), stat("range", st.range, "Dosah"));
      const cost = R.COSTS && R.COSTS[u.type];
      if (cost) row.append(stat("coin", cost.gold, "Zlato"));
      card.append(row);
    }

    const next = () => {
      k = (k + 1) % anims.length;
      s.set(anims[k]);
      tag.textContent = ANIM_NAME[anims[k]];
    };
    card.addEventListener("click", next);
    card.setAttribute("aria-label", `${u.name}: ${u.role} Kliknutím změníš animaci.`);
    // Po najetí myší se jednotka sama rozejde, ať je vidět, že je živá.
    card.addEventListener("mouseenter", () => { if (k === 0) next(); });
    return card;
  }

  function roster() {
    const box = document.getElementById("roster");
    const show = side => {
      for (const s of sprites) if (box.contains(s.c)) sprites.delete(s);
      box.textContent = "";
      box.classList.toggle("nemrtvi", side === "nemrtvi");
      const list = side === "nemrtvi" ? UNDEAD : PEOPLE;
      list.forEach((u, i) => {
        const card = unitCard(u, side === "nemrtvi" ? "red" : "blue");
        card.style.animationDelay = `${i * 60}ms`;
        box.append(card);
      });
    };

    for (const tab of document.querySelectorAll(".tab")) {
      tab.addEventListener("click", () => {
        for (const t of document.querySelectorAll(".tab")) t.setAttribute("aria-selected", String(t === tab));
        show(tab.dataset.side);
      });
    }
    show("lide");
  }

  /* ---------- postavy kampaně ---------- */
  const CAST = [
    { type: "knight", team: "blue", name: "Radim z Bystré", line: "Rytíř, který přísahal, že Bystrá nepadne." },
    { type: "archer", team: "blue", name: "Jitka", line: "Lučištnice. Jako první viděla mrtvé chodit." },
    { type: "monk", team: "blue", name: "Bratr Kryštof", line: "Mnich z Lysé hory, pohřbívá ty, kdo nechtějí zůstat v zemi." },
    { type: "hero", team: "gold", name: "Vojvoda Hostivít", line: "Pán Hněvína. Mezi mrtvými poznal svého syna." },
    { type: "lich", team: "red", name: "Morvan", line: "Bývalý dvorní mág, dnes lich, který volá mrtvé.", foe: true }
  ];

  function cast() {
    const box = document.getElementById("cast");
    for (const who of CAST) {
      const el = document.createElement("div");
      el.className = `who${who.foe ? " foe" : ""}`;
      const big = PK.hdOf(PK.units.portrait(who.type, who.team, 0));
      const { c, g } = PK.makeCanvas(48, 48);
      g.drawImage(big, 16, 12, 48, 48, 0, 0, 48, 48);
      c.className = "pix";
      c.setAttribute("aria-hidden", "true");
      const b = document.createElement("b");
      b.textContent = who.name;
      const s = document.createElement("span");
      s.textContent = who.line;
      el.append(c, b, s);
      box.append(el);
    }
  }

  /* ---------- pochodující armáda v úvodu ---------- */
  function march() {
    const c = document.querySelector(".march");
    const g = c.getContext("2d");
    const SCALE = () => 2; // css px na jemný px spritu
    const ARMY = ["knight", "knight", "soldier", "soldier", "soldier", "hero", "archer", "archer", "monk", "soldier", "archer", "soldier", "worker", "worker"];
    let walkers = [];
    let W = 0;
    let H = 0;

    function layout() {
      const k = SCALE();
      W = Math.ceil(c.clientWidth / k);
      H = Math.ceil(c.clientHeight / k);
      c.width = W;
      c.height = H;
      g.imageSmoothingEnabled = false;
      // Každý má vlastní rozestup, fázi kroku a lehce jiné tempo, ať kolona nešlape jak přes kopírák.
      let x = W * 0.75;
      walkers = ARMY.map(type => {
        x -= 34 + Math.random() * 22;
        const speed = (R.UNITS && R.UNITS[type] ? R.UNITS[type].speed : 45) * 0.42;
        return { type, x, y: H - 3 - Math.round(Math.random() * 6), speed: Math.min(speed, 22) * (0.95 + Math.random() * 0.1), phase: Math.random() * 1000 };
      });
      walkers.sort((a, b) => a.y - b.y);
    }

    layout();
    addEventListener("resize", layout);
    const span = () => -walkers.reduce((m, w) => Math.min(m, w.x), 0) + W + 80;
    let last = performance.now();
    c.tick = now => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      g.clearRect(0, 0, W, H);
      // Kolona pochoduje stejným tempem jako nejpomalejší (katapult), jinak by se rozsypala.
      const pace = Math.min(...walkers.map(w => w.speed));
      for (const w of walkers) {
        w.x += pace * dt;
        if (w.x > W + 40) w.x -= span();
        const list = frames(w.type, "blue", "walk");
        const f = list[Math.floor((now + w.phase) / (FRAME_MS.walk * (22 / pace))) % list.length];
        g.globalAlpha = 0.35;
        g.fillStyle = "#0b0914";
        g.fillRect(Math.round(w.x) + 22, w.y - 1, 20, 2);
        g.globalAlpha = 1;
        g.drawImage(f, Math.round(w.x), w.y - 60); // nohy jsou v buňce spritu na y = 60
      }
    };
    loops.add(c);
    visibility.observe(c);
  }

  /* ---------- jiskry a světlušky ---------- */
  function embers(c) {
    const g = c.getContext("2d");
    const story = !!c.closest(".story");
    const P = 4; // jedna jiskra = 1 px plátna = 4 css px
    let W = 0;
    let H = 0;
    let parts = [];
    const COLORS = story ? ["#5ff0c0", "#cfffe8", "#ffbf45"] : ["#ffbf45", "#ffe08a", "#d65a3c", "#ff8f4a"];

    function spawn(anywhere) {
      return {
        x: Math.random() * W,
        y: anywhere ? Math.random() * H : H + 2,
        vy: -(3 + Math.random() * 7),
        vx: (Math.random() - 0.5) * 2,
        life: 4 + Math.random() * 7,
        age: 0,
        col: COLORS[Math.floor(Math.random() * COLORS.length)],
        flick: Math.random() * 6
      };
    }

    function layout() {
      W = Math.ceil(c.clientWidth / P);
      H = Math.ceil(c.clientHeight / P);
      c.width = W;
      c.height = H;
      const n = Math.round((W * H) / (story ? 900 : 700));
      parts = Array.from({ length: n }, () => spawn(true));
    }

    layout();
    addEventListener("resize", layout);
    let last = performance.now();
    c.tick = now => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      g.clearRect(0, 0, W, H);
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        p.age += dt;
        p.x += (p.vx + Math.sin(now / 900 + p.flick) * 1.5) * dt;
        p.y += p.vy * dt;
        if (p.age > p.life || p.y < -2) { parts[i] = spawn(false); continue; }
        const fade = Math.min(1, p.age / 1.2, (p.life - p.age) / 1.5);
        g.globalAlpha = Math.max(0, fade * (0.55 + 0.45 * Math.sin(now / 140 + p.flick)));
        g.fillStyle = p.col;
        g.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      }
      g.globalAlpha = 1;
    };
    loops.add(c);
    visibility.observe(c);
  }

  /* ---------- jedna smyčka pro všechno, co je zrovna vidět ---------- */
  const loops = new Set();
  const visibility = new IntersectionObserver(entries => {
    for (const e of entries) {
      e.target.visible = e.isIntersecting;
      if (e.target.sprite) e.target.sprite.visible = e.isIntersecting;
    }
  }, { rootMargin: "100px" });

  function frame(now) {
    for (const s of sprites) {
      if (!s.c.isConnected) { sprites.delete(s); continue; }
      if (s.visible) drawSprite(s, now);
    }
    if (!reduced) for (const c of loops) if (c.visible) c.tick(now);
    requestAnimationFrame(frame);
  }

  /* ---------- videa: načíst a pustit jen když jsou na obrazovce ---------- */
  function videos() {
    const hero = document.querySelector(".hero-video");
    if (!reduced && !saveData) {
      hero.src = hero.dataset.src;
      hero.addEventListener("playing", () => hero.classList.add("playing"), { once: true });
      hero.play().catch(() => {});
    }

    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        const v = e.target;
        if (e.isIntersecting) {
          if (!v.src) v.src = v.dataset.src;
          if (!reduced) v.play().catch(() => {});
        } else if (!v.paused) {
          v.pause();
        }
      }
    }, { rootMargin: "200px" });

    for (const v of document.querySelectorAll("video[data-src]")) if (v !== hero) io.observe(v);
  }

  /* ---------- odhalení sekcí, lišta, počítadla ---------- */
  function reveal() {
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("in");
        io.unobserve(e.target);
        for (const b of e.target.querySelectorAll("[data-count]")) countUp(b);
      }
    }, { rootMargin: "0px 0px -8% 0px" });
    for (const el of document.querySelectorAll(".reveal")) io.observe(el);
  }

  function countUp(b) {
    const to = Number(b.dataset.count);
    if (reduced || !to) return;
    const t0 = performance.now();
    const step = now => {
      const t = Math.min(1, (now - t0) / 900);
      b.textContent = Math.round(to * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function topbar() {
    const top = document.getElementById("top");
    const links = [...document.querySelectorAll(".nav a")];
    const onScroll = () => top.classList.toggle("solid", scrollY > 40);
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        for (const a of links) a.classList.toggle("on", a.getAttribute("href") === `#${e.target.id}`);
      }
    }, { rootMargin: "-45% 0px -50% 0px" });
    for (const a of links) {
      const sec = document.querySelector(a.getAttribute("href"));
      if (sec) io.observe(sec);
    }
  }

  /* ---------- zvětšení obrázků a klipů ---------- */
  function lightbox() {
    const box = document.getElementById("lightbox");
    const body = box.querySelector(".lb-body");
    let opener = null;
    const close = () => {
      box.hidden = true;
      body.textContent = "";
      if (opener) opener.focus();
    };

    for (const fig of document.querySelectorAll("[data-zoom]")) {
      fig.tabIndex = 0;
      fig.setAttribute("role", "button");
      const open = () => {
        const media = fig.querySelector("img, video");
        const copy = document.createElement(media.tagName.toLowerCase());
        if (media.tagName === "VIDEO") {
          Object.assign(copy, { src: media.dataset.src, muted: true, loop: true, autoplay: true, playsInline: true, controls: true });
        } else {
          copy.src = media.src;
          copy.alt = media.alt;
        }
        body.textContent = "";
        body.append(copy);
        opener = fig;
        box.hidden = false;
        box.querySelector(".lb-close").focus();
      };
      fig.addEventListener("click", open);
      fig.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    }

    box.addEventListener("click", e => { if (e.target === box || e.target.classList.contains("lb-close")) close(); });
    addEventListener("keydown", e => { if (e.key === "Escape" && !box.hidden) close(); });
  }

  /* ---------- start ---------- */
  safe(videos);
  safe(reveal);
  safe(topbar);
  safe(lightbox);

  if (canDraw) {
    safe(headings);
    safe(buttons);
    safe(emblem);
    if (PK.icons) safe(icons);
    if (PK.units) {
      safe(roster);
      safe(cast);
      safe(march);
    }
    let resizeT = 0;
    addEventListener("resize", () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(() => safe(headings), 150);
    });
  }
  for (const c of document.querySelectorAll("canvas.embers")) safe(() => embers(c));
  requestAnimationFrame(frame);
})();
