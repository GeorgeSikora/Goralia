/*
 * Síň slávy v záložce Hráči v menu hry: pixelový nadpis, stupně vítězů s postavičkami
 * z hry, žebříček s portréty a medailemi. Data dodá account.js, obsah z databáze jde jen do textContent.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const { C } = PK;

  const TEAMS = ["blue", "red", "gold", "violet", "green", "orange", "teal", "pink"];
  const TYPES = ["soldier", "archer", "knight", "monk", "worker"];
  // stupně: 1. místo hrdina, 2. rytíř, 3. lučištník; ostatní podle ID hráče
  const PODIUM_TYPES = ["hero", "knight", "archer"];
  const SPRITE_SCALE = 2; // jemný px spritu = 2 px stránky
  const FRAME_MS = 160;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const teamOf = id => TEAMS[(id * 5) % TEAMS.length];
  const COS = PK.cosmetics;
  // barva postavičky: barva týmu navíc z výzev, jinak podle ID hráče
  const colorOf = p => {
    const c = p.look && COS && COS.get(p.look.color);
    return c ? c.palette : teamOf(p.id);
  };
  const titleOf = p => {
    const t = p.look && COS && COS.get(p.look.title);
    return t ? t.name : "";
  };
  const frameOf = p => {
    const f = p.look && COS && COS.get(p.look.frame);
    return f ? f.style : "";
  };
  const typeOf = (id, rank) => (rank <= 3 ? PODIUM_TYPES[rank - 1] : TYPES[(id * 3) % TYPES.length]);
  const fmt = n => n.toLocaleString("cs-CZ");
  // české tvary: 1 zápas, 2–4 zápasy, 0 a 5+ zápasů
  const count = (n, one, few, many) => `${fmt(n)} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;

  /* ---------- pixelový text ---------- */
  function pixelText(str, { color = C.a[2], scale = 1, zoom = 4, shadow = C.ink } = {}) {
    const w = PK.textWidth(str.toUpperCase(), "5", scale) + 2 * scale + 2;
    const h = 12 * scale + 2;
    const { c, g } = PK.makeCanvas(w, h);
    PK.text(g, str, 1, 3 * scale, color, { scale, shadow });
    c.className = "pix";
    c.style.width = `${w * zoom}px`;
    c.style.height = `${h * zoom}px`;
    return c;
  }

  function title(canvas) {
    const text = pixelText("Síň slávy", { color: C.a[3], zoom: 5 });
    canvas.replaceWith(text);
    text.id = canvas.id;
    text.classList.add("fame-title");
    text.setAttribute("aria-label", "Síň slávy");
    return text;
  }

  /* ---------- postavičky ---------- */
  const animated = new Set();
  let tick = 0;
  let timer = 0;

  function sprite(type, team) {
    const n = PK.units.frameCount("idle");
    const frames = [];
    for (let i = 0; i < n; i++) frames.push(PK.units.frame(type, team, "idle", i).pix.rawCanvas());

    const W = frames[0].width;
    const { c, g } = PK.makeCanvas(W, W);
    c.className = "pix sprite";
    c.style.width = c.style.height = `${W * SPRITE_SCALE}px`;
    const draw = i => {
      g.clearRect(0, 0, W, W);
      g.drawImage(frames[i % frames.length], 0, 0);
    };
    draw(0);
    c.step = draw;
    animated.add(c);
    return c;
  }

  // Výřez hlavy a hrudi z portrétu z HUDu (80x80 jemných px), střed 48x48.
  function portrait(type, team) {
    const big = PK.hdOf(PK.units.portrait(type, team, 0));
    const { c, g } = PK.makeCanvas(48, 48);
    g.drawImage(big, 16, 12, 48, 48, 0, 0, 48, 48);
    c.className = "pix portrait";
    return c;
  }

  function animate() {
    for (const c of animated) if (!c.isConnected) animated.delete(c);
    if (!animated.size) {
      clearInterval(timer);
      timer = 0;
      return;
    }
    tick++;
    for (const c of animated) c.step(tick);
  }

  function startAnimation() {
    if (!timer) timer = setInterval(animate, FRAME_MS);
  }

  /* ---------- rámečky avatara (odměny z výzev) ---------- */
  // [tuš, tmavá, střední, světlá, ozdoba]
  const FRAMES = {
    wood: [C.ink, 0x4a3029, 0x6c4a35, 0x946b45, 0xa79d98],
    iron: [C.ink, 0x3b3a55, 0x767892, 0xc6c7d3, 0xe8e6e8],
    leaf: [C.ink, 0x1c4a2a, 0x3f9a4a, 0x74cc6a, 0xd84a6a],
    gold: [C.ink, 0xb8741f, 0xffc83a, 0xfff09a, 0x3f7fd0],
    rune: [C.ink, 0x3c2a6b, 0x6c47b0, 0xa078e8, 0x5ff0c0],
    flame: [C.ink, 0x6e1f2c, 0xd65a3c, 0xff8f4a, 0xffd27a]
  };

  // Obrázek (portrét) v pixelovém rámečku; vrací nové plátno o 12 px větší, se stejnou třídou.
  function framed(img, style, zoom = 1) {
    const pal = FRAMES[style];
    if (!pal) return img;
    const [ink, dark, mid, light, orn] = pal;
    const W = img.width + 12;
    const H = img.height + 12;
    const { c, g } = PK.makeCanvas(W, H);
    const px = (x, y, w, h, col) => { g.fillStyle = PK.css(col); g.fillRect(x, y, w, h); };

    px(0, 0, W, H, ink);
    px(1, 1, W - 2, H - 2, dark);
    px(2, 2, W - 4, H - 4, mid);
    px(2, 2, W - 4, 1, light); // světlo shora a zleva
    px(2, 2, 1, H - 4, light);
    px(4, 4, W - 8, H - 8, dark);
    px(5, 5, W - 10, H - 10, ink);
    g.drawImage(img, 6, 6);

    // ozdoby po obvodu: hřeby, nýty, lístky, drahokamy, runy, plamínky
    const step = style === "leaf" || style === "flame" ? 6 : 10;
    for (let t = 8; t < W - 8; t += step) {
      if (style === "flame") {
        px(t, 1, 2, 2, orn); px(t, H - 3, 2, 2, mid);
      } else if (style === "leaf") {
        px(t, 2, 2, 1, 0x74cc6a); px(t + 1, 3, 1, 1, dark); px(t, H - 3, 2, 1, 0x74cc6a);
      } else {
        px(t, 3, 1, 1, orn); px(t, H - 4, 1, 1, orn);
      }
    }
    for (let t = 8; t < H - 8; t += step) {
      if (style === "flame") { px(1, t, 2, 2, orn); px(W - 3, t, 2, 2, orn); } else if (style === "leaf") { px(2, t, 1, 2, 0x74cc6a); px(W - 3, t, 1, 2, 0x74cc6a); } else { px(3, t, 1, 1, orn); px(W - 4, t, 1, 1, orn); }
    }
    // rohy
    for (const [x, y] of [[0, 0], [W - 7, 0], [0, H - 7], [W - 7, H - 7]]) {
      px(x, y, 7, 7, ink);
      px(x + 1, y + 1, 5, 5, style === "gold" || style === "rune" ? mid : dark);
      px(x + 2, y + 2, 3, 3, orn);
      px(x + 2, y + 2, 1, 1, C.white);
    }

    c.className = `${img.className} framed frame-${style}`;
    const css = parseFloat(img.style.width) || img.width * zoom;
    const k = css / img.width;
    c.style.width = `${W * k}px`;
    c.style.height = `${H * k}px`;
    return c;
  }

  /* ---------- medaile ---------- */
  const MEDAL = { gold: C.gold, silver: [0x767892, 0xc6c7d3, 0xf7f1df], bronze: [0x6c4a35, 0xbe7a45, 0xf0b47a] };

  function medal(kind, count) {
    const [dark, mid, light] = MEDAL[kind];
    const { c, g } = PK.makeCanvas(9, 12);
    const px = (x, y, w, h, col) => { g.fillStyle = PK.css(col); g.fillRect(x, y, w, h); };
    // stuha
    px(2, 0, 2, 4, C.r[2]); px(5, 0, 2, 4, C.u[2]); px(4, 2, 1, 2, C.ink);
    // kotouč s obrysem, světlem zleva nahoře
    px(2, 4, 5, 8, C.ink); px(1, 5, 7, 6, C.ink);
    px(2, 5, 5, 6, mid); px(3, 6, 3, 4, dark); px(3, 6, 2, 2, light); px(2, 5, 1, 1, light);
    c.className = "pix medal";
    c.style.width = "18px";
    c.style.height = "24px";

    const box = el("span", `medal-count ${kind}`);
    box.title = { gold: "1. místo", silver: "2. místo", bronze: "3. místo" }[kind];
    box.append(c, el("span", "", `×${count}`));
    return box;
  }

  function medals(m) {
    const box = el("span", "medals");
    for (const kind of ["gold", "silver", "bronze"]) if (m[kind]) box.append(medal(kind, m[kind]));
    return box;
  }

  function badges(p, nameNode) {
    if (p.role === "admin") nameNode.append(el("span", "badge admin", "admin"));
    if (p.online) nameNode.append(el("span", "badge online", "online"));
  }

  /* ---------- stupně vítězů ---------- */
  function podium(players, { onOpen } = {}) {
    const box = el("div", "podium");
    const order = [1, 0, 2]; // 2. vlevo, 1. uprostřed, 3. vpravo

    for (const i of order) {
      const p = players[i];
      const place = el("div", `place place-${i + 1}`);

      if (!p) {
        place.classList.add("empty");
        place.append(el("div", "stand-name muted", "volné místo"), el("div", "stand", ""));
        box.append(place);
        continue;
      }

      const who = el("button", "stand-hero");
      who.type = "button";
      who.title = `Detail hráče ${p.name}`;
      if (i === 0) who.append(crown());
      who.append(sprite(typeOf(p.id, i + 1), colorOf(p)));
      who.addEventListener("click", () => onOpen && onOpen(p));

      const name = el("div", "stand-name", p.name);
      badges(p, name);
      const title = titleOf(p);

      const stand = el("div", "stand");
      stand.append(pixelText(String(p.rank), { color: [C.a[3], C.s[6], 0xf0b47a][i], zoom: 4 }));
      stand.append(el("div", "stand-score", `${fmt(p.score)} b.`));
      stand.append(medals(p.medals));

      place.append(who, name);
      if (title) place.append(el("div", "fame-title-tag", PK.t ? PK.t(title) : title));
      place.append(stand);
      box.append(place);
    }

    startAnimation();
    return box;
  }

  function crown() {
    const { c, g } = PK.makeCanvas(15, 9);
    const px = (x, y, w, h, col) => { g.fillStyle = PK.css(col); g.fillRect(x, y, w, h); };
    px(1, 3, 13, 6, C.ink); px(0, 1, 3, 3, C.ink); px(6, 0, 3, 4, C.ink); px(12, 1, 3, 3, C.ink);
    px(1, 2, 1, 1, C.gold[2]); px(7, 1, 1, 1, C.gold[2]); px(13, 2, 1, 1, C.gold[2]);
    px(2, 4, 11, 4, C.gold[1]); px(1, 3, 2, 2, C.gold[1]); px(6, 2, 3, 3, C.gold[1]); px(12, 3, 2, 2, C.gold[1]);
    px(2, 7, 11, 1, C.gold[0]); px(4, 5, 1, 1, C.r[3]); px(7, 5, 1, 1, C.u[3]); px(10, 5, 1, 1, C.r[3]);
    px(2, 4, 3, 1, C.gold[2]);
    c.className = "pix crown";
    c.style.width = "60px";
    c.style.height = "36px";
    return c;
  }

  /* ---------- žebříček ---------- */
  function list(players, { onOpen, playTime } = {}) {
    const box = el("ol", "ranks");
    const top = players.length ? players[0].score : 1;

    for (const p of players) {
      const row = el("li", `rank-row${p.rank <= 3 ? ` top top-${p.rank}` : ""}`);
      row.tabIndex = 0;
      row.title = `Detail hráče ${p.name}`;

      const num = el("span", "rank-num", String(p.rank));
      let pic = portrait(typeOf(p.id, p.rank), colorOf(p));
      if (frameOf(p)) pic = framed(pic, frameOf(p));

      const who = el("span", "rank-who");
      const name = el("span", "rank-name", p.name);
      badges(p, name);
      const parts = [count(p.pvpWins, "výhra", "výhry", "výher") + " proti lidem", `${fmt(p.otherWins)} proti AI`, count(p.games, "zápas", "zápasy", "zápasů")];
      if (p.medals.played) parts.push(`${p.medals.played} ${p.medals.played === 1 ? "turnaj" : p.medals.played < 5 ? "turnaje" : "turnajů"}`);
      if (titleOf(p)) name.append(el("span", "fame-title-tag", PK.t ? PK.t(titleOf(p)) : titleOf(p)));
      who.append(name, el("span", "rank-parts", parts.join(" · ")));

      const bar = el("span", "rank-bar");
      const battle = el("span", "fill battle");
      const tour = el("span", "fill tour");
      battle.style.width = `${(p.battle / top) * 100}%`;
      tour.style.width = `${(p.tournament / top) * 100}%`;
      battle.title = `bitvy ${fmt(p.battle)} b.`;
      tour.title = `turnaje ${fmt(p.tournament)} b.`;
      bar.append(battle, tour);

      const score = el("span", "rank-score", fmt(p.score));
      const extra = el("span", "rank-extra");
      extra.append(medals(p.medals), el("span", "muted", playTime ? playTime(p.playSeconds + p.aiSeconds) : ""));

      row.append(num, pic, who, bar, score, extra);
      const open = () => onOpen && onOpen(p);
      row.addEventListener("click", open);
      row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
      box.append(row);
    }

    return box;
  }

  window.GFame = { title, podium, list, sprite, portrait, framed, medals, pixelText, typeOf, teamOf, colorOf, titleOf, frameOf };
})();
