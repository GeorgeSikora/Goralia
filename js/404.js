/*
 * Stránka 404: noční mýtina na okraji mapy. Zbloudilá jednotka dojde k ukazateli, zarazí se před mlhou
 * války a vrátí se k lucerně. Všechno se kreslí v jemné mřížce hry (1 bod = 1 jemný px, plátno se
 * zvětšuje jen celým násobkem), sprity jednotek a drobností bere přímo z units.js a props.js.
 * Bez skriptů hry zůstane obyčejná stránka s textem a odkazy.
 */
(() => {
  "use strict";

  const PK = window.PK || {};

  const safe = fn => {
    try { return fn(); } catch (e) { console.warn("404:", e); return null; }
  };

  // Skutečná adresa, kterou návštěvník hledal (server vrací tuhle stránku pro všechny neznámé cesty).
  safe(() => {
    const where = document.querySelector(".where");
    const path = decodeURIComponent(location.pathname);
    if (!where || path === "/" || /404(\.html)?$/.test(path)) return;
    where.textContent = "Stránka ";
    const code = document.createElement("code");
    code.className = "path";
    code.textContent = path.length > 60 ? path.slice(0, 57) + "…" : path;
    where.append(code);
  });

  if (!(PK.text && PK.makeCanvas && PK.C && PK.units && PK.props)) return;

  const { C, mix, hash, vnoise, fbm, bayer, clamp } = PK;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- pixelové písmo hry ---------- */
  const LINE = 12;

  function pixelLines(lines, color, shadow) {
    const w = Math.max(...lines.map(l => PK.textWidth(l.toUpperCase(), "5"))) + 3;
    const { c, g } = PK.makeCanvas(w, lines.length * LINE + 2);
    lines.forEach((line, i) => PK.text(g, line, Math.floor(w / 2), 3 + i * LINE, color, { shadow, align: "center" }));
    c.className = "pix";
    c.setAttribute("aria-hidden", "true");
    return c;
  }

  // Text zůstává v HTML pro čtečky a vyhledávače, vedle se vykreslí pixelová kopie v celém násobku.
  function pixelize(el, zoomOf, color, shadow) {
    if (!el.dataset.text) {
      el.dataset.text = el.dataset.pix;
      el.innerHTML = `<span class="label">${el.innerHTML}</span>`;
      el.classList.add("has-pix");
    }

    const box = el.parentElement.clientWidth;
    const zoom = zoomOf(box);
    const lines = el.classList.contains("title") ? PK.wrap(el.dataset.text.toUpperCase(), Math.floor(box / zoom) - 6) : [el.dataset.text];
    const key = `${zoom}|${lines.join("/")}`;
    if (el.dataset.key === key) return;
    el.dataset.key = key;

    const c = el.classList.contains("brand") ? brandLogo()
      : el.classList.contains("code") ? bigCode(el.dataset.text) : pixelLines(lines, color, shadow);
    c.style.width = `${c.width * zoom}px`;
    c.style.height = `${c.height * zoom}px`;
    c.style.margin = "0 auto";
    const old = el.querySelector("canvas");
    if (old) old.replaceWith(c); else el.prepend(c);
  }

  // Nápis GORALIA stejný jako v menu hry a na úvodní stránce.
  function brandLogo() {
    const c = PK.icons.wordmark();
    c.className = "pix";
    c.setAttribute("aria-hidden", "true");
    return c;
  }

  // Velké "404": jantar s odleskem nahoře, rudý stín vpravo dole a inkoustový obrys jako písmo v HUD.
  function bigCode(str) {
    const w = PK.textWidth(str, "5") + 5;
    const h = 7 + 5;
    const face = PK.makeCanvas(w, h);
    PK.text(face.g, str, 2, 2, C.a[2], { shadow: null });
    face.g.globalCompositeOperation = "source-atop";
    const bands = [[2, C.a[4]], [3, C.a[3]], [4, C.a[3]], [7, C.a[1]], [8, C.a[1]]];
    for (const [y, col] of bands) {
      face.g.fillStyle = PK.css(col);
      face.g.fillRect(0, y, w, 1);
    }

    const { c, g } = PK.makeCanvas(w, h);
    PK.text(g, str, 3, 3, C.r[1], { shadow: null, outline: C.ink });
    PK.text(g, str, 2, 2, C.ink, { shadow: null, outline: C.ink });
    g.drawImage(face.c, 0, 0);
    c.className = "pix";
    c.setAttribute("aria-hidden", "true");
    return c;
  }

  function texts() {
    const code = document.querySelector(".code");
    const title = document.querySelector(".title");
    const brand = document.querySelector(".brand");
    if (code) pixelize(code, box => (box < 420 ? 10 : box < 760 ? 14 : 16), C.a[2], C.r[1]);
    if (title) pixelize(title, box => (box < 420 ? 3 : box < 760 ? 4 : 5), C.white, C.ink);
    if (brand) pixelize(brand, () => 3, C.a[3], C.r[1]);
    for (const b of document.querySelectorAll(".btn[data-pix]")) pixelize(b, () => 3, C.a[4], C.r[1]);
  }

  /* ---------- scéna ---------- */
  const H = 132; // výška plátna v jemných px
  const HY = 60; // horizont
  const STEP_MS = 1000 / 12; // scéna se překresluje po krocích jako hra, ne plynule

  const WANDERERS = [
    { type: "soldier", name: "Voják", whom: "vojáka" },
    { type: "archer", name: "Lučištník", whom: "lučištníka" },
    { type: "worker", name: "Dělník", whom: "dělníka" }
  ];
  const LINES = [
    "Hlášení: tady mapa končí. Dál je jen mlha.",
    "Ukazatel ukazuje všude a nikam.",
    "Rozkaz zněl jasně: najít stránku. Jenže ji nikdo nezakreslil do mapy.",
    "Prý tu kdysi stála hospoda. Teď tu nestojí nic.",
    "Kdybych měl zlato a dřevo, postavil bych tu stránku sám.",
    "Zkus to přes hlavní bránu. Tam se ještě nikdo neztratil.",
    "Do mlhy nejdu. Slyšel jsem odtamtud kvílení. Nejspíš jen vítr. Nejspíš.",
    "Průzkum hotov. Nic jsme nenašli, ale aspoň jsme se prošli."
  ];

  const pathY = (x, W) => Math.round(102 + 6 * Math.sin(x * 0.021 + 0.6) + 3 * Math.sin(x * 0.057) - (x / W) * 4);
  const packed = c => 0xff000000 | ((c & 255) << 16) | (c & 0xff00) | ((c >> 16) & 255);

  const fineOf = canvas => (PK.hdOf && PK.hdOf(canvas)) || canvas;

  const frameCache = new Map();
  function frames(type, anim) {
    const key = `${type}|${anim}`;
    if (!frameCache.has(key)) {
      const list = [];
      for (let i = 0; i < PK.units.frameCount(anim); i++) list.push(PK.units.frame(type, 0, anim, i).pix.rawCanvas());
      frameCache.set(key, list);
    }
    return frameCache.get(key);
  }

  function bakeGround(W, lantern) {
    const img = new ImageData(W, H);
    const px = new Uint32Array(img.data.buffer);

    const SKY = [C.ink, mix(C.ink, C.shade, 0.5), C.shade, mix(C.shade, C.dusk, 0.5), C.dusk, mix(C.dusk, C.m[0], 0.35)];
    const FAR = mix(C.dusk, C.m[0], 0.22);
    const FAR_L = mix(FAR, C.m[1], 0.35);
    const NEAR = mix(C.shade, C.g[0], 0.25);
    const NEAR_L = mix(NEAR, C.t[1], 0.4);
    const GX = [mix(C.g[0], C.shade, 0.55), mix(C.g[0], C.shade, 0.2), C.g[1], mix(C.g[1], C.g[2], 0.5), C.g[2], C.g[3], C.g[4]];
    const DX = [mix(C.d[0], C.shade, 0.5), C.d[0], C.d[1], C.d[2], C.d[3], C.d[4]];
    const pick = (ramp, t) => ramp[clamp(Math.round(t), 0, ramp.length - 1)];
    const tone = (t, x, y) => PK.dither(t, x, y, 0.5);

    const moonX = Math.round(W * 0.46);
    const moonY = 15;

    const farTop = x => Math.round(HY - 10 - fbm(x * 0.018, 0.5, 3) * 22);
    const nearTop = x => Math.round(HY - 2 - fbm(x * 0.03 + 40, 2.5, 7) * 12);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let c;

        if (y < HY) {
          const ft = farTop(x);
          const nt = nearTop(x);

          if (y >= nt) {
            c = y === nt && nearTop(x - 1) > nt ? NEAR_L : NEAR;
          } else if (y >= ft) {
            // svah otočený k měsíci (vlevo nahoře) chytá světlo
            const lit = farTop(x - 1) > ft && y < ft + 2;
            c = lit ? FAR_L : FAR;
          } else {
            c = pick(SKY, tone((y / HY) * 5.2, x, y));
            const dx = x - moonX;
            const dy = y - moonY;
            const d = Math.hypot(dx, dy);
            if (d < 15 && d > 7) c = mix(c, C.m[1], 0.12 * (1 - (d - 7) / 8) > bayer(x, y) * 0.12 ? 0.18 : 0);
            if (hash(x, y, 3) > 0.993 && y < ft - 6) c = hash(x, y, 4) > 0.6 ? C.s[5] : C.s[3];
          }

          // srpek měsíce
          const d1 = Math.hypot(x - moonX, y - moonY);
          const d2 = Math.hypot(x - moonX - 3, y - moonY + 2);
          if (d1 <= 6.5 && d2 > 5.6) c = d1 > 5.6 ? C.bone[1] : C.white;
        } else {
          const depth = (y - HY) / (H - HY);
          const light = lantern(x, y);
          const py = pathY(x, W);
          const half = 7 + 2 * Math.sin(x * 0.04) + depth * 3;
          const off = Math.abs(y - py);

          if (off < half) {
            const t = 1.3 + fbm(x * 0.12, y * 0.2, 9) * 1.4 + light * 2.6 - (off > half - 1.5 ? 1 : 0);
            c = pick(DX, tone(t, x, y));
            if (hash(x, y, 21) > 0.985) c = light > 0.25 ? C.s[3] : C.s[2];
          } else {
            const n = fbm(x * 0.045, y * 0.11, 11);
            let t = 0.4 + n * 2.1 + depth * 1.3 + light * 3.2;
            // stébla: světlejší bod nad tmavším
            if (hash(x, y, 13) > 0.965) t += 1;
            if (hash(x, y + 1, 13) > 0.965) t -= 0.7;
            c = pick(GX, tone(t, x, y));
          }

          // okraj cesty: tmavý lem pod travou
          if (off >= half && off < half + 1 && y > py) c = mix(c, C.shade, 0.35);
        }

        px[y * W + x] = packed(c);
      }
    }

    const { c, g } = PK.makeCanvas(W, H);
    g.putImageData(img, 0, 0);
    return c;
  }

  function scene() {
    const fig = document.getElementById("scene");
    const canvas = fig && fig.querySelector("canvas");
    const say = fig && fig.querySelector(".say");
    if (!canvas) return;

    const who = WANDERERS[Math.floor(Math.random() * WANDERERS.length)];
    const D = PK.props.doodads;
    const trees = PK.props.trees;
    const g = canvas.getContext("2d");

    let W = 0;
    let zoom = 1;
    let bg = null;
    let props = [];
    let fog = null;
    let L = null;
    let unit = null;
    let flies = [];
    let talk = { until: 0, mark: "" };

    function layout() {
      const box = fig.clientWidth || 320;
      zoom = box >= 960 ? 3 : 2;
      const w = clamp(Math.floor(box / zoom), 150, 360);
      if (w === W && bg) return;
      W = w;

      canvas.width = W;
      canvas.height = H;
      canvas.style.width = `${W * zoom}px`;
      canvas.style.height = `${H * zoom}px`;
      g.imageSmoothingEnabled = false;

      const lx = Math.round(W * 0.19);
      L = { x: lx, y: pathY(lx, W) - 10 };
      const lantern = (x, y) => {
        const d = Math.hypot(x - L.x, (y - L.y) * 1.7);
        return Math.pow(clamp(1 - d / 54, 0, 1), 1.6);
      };
      bg = bakeGround(W, lantern);

      const sx = Math.round(W * 0.64);
      const place = (spr, x, y, extra = {}) => ({ spr, x: Math.round(x), y: Math.round(y), ...extra });
      props = [
        place(trees[0], W * 0.04, HY + 12, { tree: true, phase: 0 }),
        place(trees[2], W * 0.115, HY + 6, { tree: true, phase: 1 }),
        place(trees[1], W * 0.86, HY + 9, { tree: true, phase: 2 }),
        place(trees[0], W * 0.97, HY + 18, { tree: true, phase: 1 }),
        place(D.lanternPost, L.x, L.y, { lamp: true }),
        place(D.signpost, sx, pathY(sx, W) - 9),
        place(D.stump, W * 0.33, pathY(W * 0.33, W) + 15),
        place(D.fern, W * 0.07, H - 6),
        place(D.stoneA, W * 0.5, pathY(W * 0.5, W) - 11),
        place(D.shroomGlow, W * 0.79, pathY(W * 0.79, W) + 14, { glowy: true }),
        place(D.fern, W * 0.56, H - 3)
      ];

      const xA = Math.round(W * 0.27);
      const xB = Math.round(W * 0.72);
      unit = { x: xA, face: 1, xA, xB, plan: makePlan(xA, xB), t0: performance.now() };

      flies = Array.from({ length: 7 }, (_, i) => ({
        x: W * (0.02 + hash(i, 1, 5) * 0.32),
        y: HY + 4 + hash(i, 2, 5) * 40,
        s: hash(i, 3, 5) * 6.28
      }));

      fog = PK.makeCanvas(W, H);
    }

    // Rozvrh bloudění: kousek k ukazateli, zaváhání před mlhou, rozhlédnutí a návrat k lucerně.
    function makePlan(xA, xB) {
      const speed = 0.026; // jemných px za ms
      const walk = Math.abs(xB - xA) / speed;
      return [
        { ms: 1800, anim: "idle", face: 1 },
        { ms: walk, anim: "walk", face: 1, from: xA, to: xB },
        { ms: 900, anim: "idle", face: 1 },
        { ms: 1700, anim: "idle", face: 1, mark: "?" },
        { ms: 700, anim: "idle", face: -1 },
        { ms: 600, anim: "idle", face: 1 },
        { ms: 900, anim: "idle", face: -1, mark: "!" },
        { ms: walk, anim: "walk", face: -1, from: xB, to: xA },
        { ms: 500, anim: "idle", face: -1 }
      ];
    }

    function unitState(now) {
      if (reduced) return { x: unit.xB, face: 1, anim: "idle", mark: "?", t: 0 };
      const total = unit.plan.reduce((s, p) => s + p.ms, 0);
      let t = (now - unit.t0) % total;
      for (const p of unit.plan) {
        if (t < p.ms) {
          const x = p.from == null ? null : p.from + (p.to - p.from) * (t / p.ms);
          if (x != null) unit.x = x;
          return { x: unit.x, face: p.face, anim: p.anim, mark: p.mark || "", t };
        }
        t -= p.ms;
      }
      return { x: unit.x, face: 1, anim: "idle", mark: "", t: 0 };
    }

    function drawSprite(c, x, y, ax, ay, flip = false) {
      if (!flip) return g.drawImage(c, x - ax, y - ay);
      g.save();
      g.translate(x, 0);
      g.scale(-1, 1);
      g.drawImage(c, -(c.width - ax), y - ay);
      g.restore();
    }

    function dots(cx, cy, r, color, density, seed) {
      g.fillStyle = PK.css(color);
      for (let y = -r; y <= r; y++) {
        for (let x = -r; x <= r; x++) {
          const d = Math.hypot(x, y * 1.15) / r;
          if (d <= 1 && (1 - d) * density > bayer(x + cx + seed, y + cy)) g.fillRect(cx + x, cy + y, 1, 1);
        }
      }
    }

    // měkké světlo z ostrých pixelových kruhů (žádné rozmazané přechody)
    function disc(cx, cy, r, color, alpha) {
      g.globalAlpha = alpha;
      g.fillStyle = PK.css(color);
      for (let y = -r; y <= r; y++) {
        const half = Math.floor(Math.sqrt(r * r - y * y));
        g.fillRect(cx - half, cy + y, half * 2 + 1, 1);
      }
      g.globalAlpha = 1;
    }

    function bubble(x, y, mark) {
      const w = 11;
      const h = 13;
      const bx = Math.round(x - w / 2);
      const by = Math.round(y - h);
      g.fillStyle = PK.css(C.ink);
      g.fillRect(bx + 1, by, w - 2, h);
      g.fillRect(bx, by + 1, w, h - 2);
      g.fillRect(bx + 4, by + h, 3, 1);
      g.fillRect(bx + 5, by + h + 1, 1, 1);
      g.fillStyle = PK.css(C.white);
      g.fillRect(bx + 1, by + 1, w - 2, h - 2);
      g.fillStyle = PK.css(C.bone[1]);
      g.fillRect(bx + 1, by + h - 2, w - 2, 1);
      g.fillRect(bx + w - 2, by + 1, 1, h - 2);
      g.fillRect(bx + 5, by + h, 1, 1);
      PK.text(g, mark, bx + 6, by + 3, mark === "!" ? C.r[2] : C.dusk, { shadow: null, align: "center" });
    }

    function drawFog(now) {
      const t = reduced ? 0 : now / 1000;
      const img = fog.g.createImageData(W, H);
      const px = new Uint32Array(img.data.buffer);
      const solid = packed(C.ink);
      const mist = packed(mix(C.dusk, C.s[2], 0.25)) & 0x00ffffff | 0xa0000000;
      const deep = packed(C.shade);
      const base = W * 0.75;

      for (let y = 0; y < H; y++) {
        const wobble = (fbm(y * 0.045, t * 0.18, 3) - 0.5) * 34;
        for (let x = Math.max(0, Math.floor(base - 40)); x < W; x++) {
          const edge = base + wobble + (vnoise(x * 0.035 - t * 0.35, y * 0.07, 8) - 0.5) * 22;
          const d = (x - edge) / Math.max(30, W * 0.13);
          if (d <= -0.35) continue;
          const b = bayer(x, y);
          if (d > b + 0.25) px[y * W + x] = d > 0.75 ? solid : deep;
          else if (d + 0.35 > b) px[y * W + x] = mist;
        }
      }

      fog.g.putImageData(img, 0, 0);
      g.drawImage(fog.c, 0, 0);
    }

    function render(now) {
      g.drawImage(bg, 0, 0);
      const step = Math.floor(now / STEP_MS);

      // světlo lucerny se chvěje o jeden bod
      const flick = reduced ? 0 : (hash(Math.floor(now / 140), 0, 2) > 0.7 ? 1 : 0);
      const lp = L && props.find(p => p.lamp);
      if (lp) {
        const gl = lp.spr.glow;
        const hx = lp.x - lp.spr.ax * 2 + gl.x * 2;
        const hy = lp.y - lp.spr.ay * 2 + gl.y * 2;
        for (const [r, a] of [[20, 0.05], [14, 0.06], [9, 0.08]]) disc(hx, hy, r + flick, C.a[2], a);
      }

      const s = unitState(now);
      const uy = pathY(s.x, W) + 1;
      const list = [...props.map(p => ({ y: p.y, draw: () => drawProp(p, step) })), { y: uy, draw: () => drawUnit(s, uy, now) }];
      list.sort((a, b) => a.y - b.y);
      for (const it of list) it.draw();

      // světlušky u lesa
      if (!reduced) {
        for (const f of flies) {
          const k = now / 1000 + f.s;
          if (Math.sin(k * 2.3) < -0.4) continue;
          const x = Math.round(f.x + Math.sin(k * 0.7) * 6);
          const y = Math.round(f.y + Math.cos(k * 0.9) * 4);
          g.fillStyle = PK.css(Math.sin(k * 2.3) > 0.6 ? C.a[4] : C.a[2]);
          g.fillRect(x, y, 1, 1);
        }
      }

      drawFog(now);

      // pár hvězd mrká
      if (!reduced) {
        for (let i = 0; i < 6; i++) {
          if (hash(i, Math.floor(now / 700), 31) < 0.5) continue;
          const x = Math.round(hash(i, 7, 1) * W * 0.7);
          const y = Math.round(3 + hash(i, 8, 1) * 24);
          g.fillStyle = PK.css(C.white);
          g.fillRect(x, y, 1, 1);
        }
      }
    }

    function drawProp(p, step) {
      const ax = p.spr.ax * 2;
      const ay = p.spr.ay * 2;
      if (p.tree) {
        const k = reduced ? 0 : Math.floor(step / 5 + p.phase) % p.spr.crown.length;
        drawSprite(fineOf(p.spr.trunk), p.x, p.y, ax, ay);
        drawSprite(fineOf(p.spr.crown[k]), p.x, p.y, ax, ay);
        return;
      }
      drawSprite(fineOf(p.spr.c), p.x, p.y, ax, ay);
      if (p.glowy && !reduced) dots(p.x, p.y - 4, 7 + (step % 12 < 6 ? 1 : 0), C.y[1], 0.32, 3);
    }

    function drawUnit(s, uy, now) {
      const list = frames(who.type, s.anim);
      const per = s.anim === "walk" ? 85 : 420;
      const i = reduced ? 0 : Math.floor(now / per) % list.length;
      const x = Math.round(s.x);

      // stín pod nohama
      g.fillStyle = "rgba(21,18,31,0.45)";
      g.fillRect(x - 6, uy, 13, 1);
      g.fillRect(x - 4, uy + 1, 9, 1);

      drawSprite(list[i], x, uy, 32, 60, s.face < 0);

      const mark = now < talk.until ? talk.mark : s.mark;
      if (mark) bubble(x + 1, uy - 36, mark);
    }

    canvas.addEventListener("click", () => {
      const line = LINES[Math.floor(Math.random() * LINES.length)];
      say.innerHTML = `<b>${who.name}:</b> `;
      say.append(line);
      talk = { until: performance.now() + 1600, mark: "!" };
    });

    say.textContent = `Klikni na ${who.whom} a zeptej se na cestu.`;
    fig.hidden = false;
    layout();

    let last = -1;
    const loop = now => {
      const step = Math.floor(now / STEP_MS);
      if (step !== last) {
        last = step;
        safe(() => render(now));
      }
      if (!reduced) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    addEventListener("resize", () => safe(() => {
      layout();
      render(performance.now());
    }));
  }

  safe(texts);
  safe(scene);
  let raf = 0;
  addEventListener("resize", () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => safe(texts));
  });
})();
