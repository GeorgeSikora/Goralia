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
  const typeOf = (id, rank) => (rank <= 3 ? PODIUM_TYPES[rank - 1] : TYPES[(id * 3) % TYPES.length]);
  const fmt = n => n.toLocaleString("cs-CZ");

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
      who.append(sprite(typeOf(p.id, i + 1), teamOf(p.id)));
      who.addEventListener("click", () => onOpen && onOpen(p));

      const name = el("div", "stand-name", p.name);
      badges(p, name);

      const stand = el("div", "stand");
      stand.append(pixelText(String(p.rank), { color: [C.a[3], C.s[6], 0xf0b47a][i], zoom: 4 }));
      stand.append(el("div", "stand-score", `${fmt(p.score)} b.`));
      stand.append(medals(p.medals));

      place.append(who, name, stand);
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
      const pic = portrait(typeOf(p.id, p.rank), teamOf(p.id));

      const who = el("span", "rank-who");
      const name = el("span", "rank-name", p.name);
      badges(p, name);
      const parts = [`${fmt(p.pvpWins)} výher proti lidem`, `${fmt(p.otherWins)} proti AI`, `${fmt(p.games)} zápasů`];
      if (p.medals.played) parts.push(`${p.medals.played} ${p.medals.played === 1 ? "turnaj" : p.medals.played < 5 ? "turnaje" : "turnajů"}`);
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

  window.GFame = { title, podium, list, sprite, portrait, medals, pixelText, typeOf, teamOf };
})();
