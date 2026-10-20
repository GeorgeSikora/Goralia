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
    const word = wordmark(12);
    word.className = "pix word";
    word.setAttribute("aria-hidden", "true");
    word.style.width = `${word.width * 2}px`;
    word.style.height = `${word.height * 2}px`;
    target.replaceWith(word);
    document.querySelector(".brand span").className = "sr-only";
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

    const h = document.createElement("h3");
    h.textContent = u.name;
    const p = document.createElement("p");
    p.className = "role";
    p.textContent = u.role;
    card.append(s.c, h, p);

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
    { type: "knight", team: "blue", name: "Radim z Bystré" },
    { type: "archer", team: "blue", name: "Jitka" },
    { type: "monk", team: "blue", name: "Bratr Kryštof" },
    { type: "hero", team: "gold", name: "Vojvoda Hostivít" },
    { type: "lich", team: "red", name: "Morvan", foe: true }
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
      el.append(c, b);
      box.append(el);
    }
  }

  /* ---------- logo v úvodu: znak a nápis jako v menu hry ---------- */
  /* Nápis GORALIA ve stylu znaku G z ikon hry: tlusté zaoblené tahy, světlo zleva shora,
   * zkosená hrana a obrys inkoustem. Tvary písmen jsou na mřížce F x F (F = výška písmene). */
  function wordmark(F) {
    const s = F / 32;
    const th = Math.max(2, Math.round(F / 6));
    const R = F / 2 - 1;
    const mid = F / 2;
    const top = 1;
    const bot = F - 1;
    const ring = (x, y, cx, cy, r) => {
      const d = Math.hypot(x - cx, y - cy);
      return d <= r && d > r - th;
    };
    const seg = (x, y, x0, y0, x1, y1) => {
      const vx = x1 - x0;
      const vy = y1 - y0;
      const t = Math.max(0, Math.min(1, ((x - x0) * vx + (y - y0) * vy) / (vx * vx + vy * vy)));
      return Math.hypot(x - x0 - vx * t, y - y0 - vy * t) <= th / 2 + 0.2;
    };
    const stem = (x, y) => x >= 1 && x < 1 + th && y >= top && y < bot;

    const GLYPHS = {
      G: {
        w: F,
        in(x, y) {
          if (ring(x, y, mid, mid, R)) {
            const ang = Math.atan2(y - mid, x - mid);
            if (!(ang > -1.05 && ang < -0.05)) return true;
          }
          const barY = Math.round(mid - th / 2);
          const bx = Math.round(mid) - th;
          return x >= bx && x < bx + th + Math.floor(R) && y >= barY && y < barY + th;
        }
      },
      O: { w: F, in: (x, y) => ring(x, y, mid, mid, R) },
      R: {
        w: Math.round(24 * s),
        in(x, y) {
          if (stem(x, y)) return true;
          const bx = Math.round(12 * s);
          const r = (mid - top) / 2 + th / 2 - 0.5;
          const cy = top + r;
          if (x >= bx) {
            if (ring(x, y, bx, cy, r)) return true;
          } else if ((y >= top && y < top + th) || (y > cy + r - th && y <= cy + r)) {
            return true;
          }
          return seg(x, y, bx - th / 2, cy + r - th / 2, Math.round(21 * s), bot - th / 2) && y < bot;
        }
      },
      A: {
        w: Math.round(28 * s),
        in(x, y) {
          const w = Math.round(28 * s);
          const r = (w - 2) / 2;
          const cx = 1 + r;
          const cy = top + r;
          if (y < cy) return ring(x, y, cx, cy, r);
          if (y >= bot) return false;
          if ((x >= 1 && x < 1 + th) || (x >= w - 1 - th && x < w - 1)) return true;
          const barY = Math.round(cy + 3 * s);
          return x >= 1 && x < w - 1 && y >= barY && y < barY + th;
        }
      },
      L: {
        w: Math.round(20 * s),
        in: (x, y) => stem(x, y) || (y >= bot - th && y < bot && x >= 1 && x < Math.round(20 * s) - 1)
      },
      I: { w: th + 2, in: stem }
    };

    const word = "GORALIA";
    const gap = Math.max(2, Math.round(3 * s));
    const pad = 2;
    const W = [...word].reduce((sum, ch) => sum + GLYPHS[ch].w, 0) + gap * (word.length - 1) + pad * 2;
    const H = F + pad * 2;

    // maska + střed písmene (světlá polovina je vlevo nahoře od středu)
    const mask = new Int16Array(W * H).fill(-1);
    const centers = [];
    let ox = pad;
    [...word].forEach((ch, i) => {
      const gl = GLYPHS[ch];
      centers.push([ox + gl.w / 2, pad + mid]);
      for (let y = 0; y < F; y++) {
        for (let x = 0; x < gl.w; x++) if (gl.in(x + 0.5, y + 0.5)) mask[(pad + y) * W + ox + x] = i;
      }
      ox += gl.w + gap;
    });

    const mix = (a, b, t) => {
      const ch = sh => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t);
      return (ch(16) << 16) | (ch(8) << 8) | ch(0);
    };
    const color = C.a[2];
    const lit = mix(color, 0xffffff, 0.35);
    const WARM = C.a[4];
    const P = new PK.Pix(W, H);
    const empty = (x, y) => x < 0 || y < 0 || x >= W || y >= H || mask[y * W + x] < 0;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = mask[y * W + x];
        if (i < 0) continue;
        const [cx, cy] = centers[i];
        const upper = x + 0.5 - cx + (y + 0.5 - cy) < 0;
        let col = upper ? lit : color;
        // hrana natočená ke světlu (nahoru/doleva) se rozzáří, odvrácená ztmavne
        if (empty(x, y - 1) || empty(x - 1, y)) col = upper ? mix(lit, WARM, 0.4) : mix(color, WARM, 0.2);
        else if (empty(x, y + 1) || empty(x + 1, y)) col = mix(color, C.dusk, 0.3);
        P.set(x, y, col);
      }
    }
    P.outline(C.ink, 0.72);
    return P.rawCanvas();
  }

  function heroLogo() {
    const h = document.querySelector(".hero-logo");
    const c = wordmark(24);
    const w = c.width;
    const hh = c.height;
    c.className = "pix";
    c.setAttribute("aria-hidden", "true");
    h.append(c);
    h.classList.add("has-pix");

    // Celočíselné zvětšení, ať jsou všechny pixely loga stejně velké.
    const fit = () => {
      const zoom = Math.max(1, Math.floor(Math.min(640, innerWidth * 0.86) / w));
      c.style.width = `${w * zoom}px`;
      c.style.height = `${hh * zoom}px`;
    };
    fit();
    addEventListener("resize", fit);
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
    if (PK.icons) {
      safe(icons);
      safe(heroLogo);
    }
    if (PK.units) {
      safe(roster);
      safe(cast);
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
