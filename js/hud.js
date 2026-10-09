/*
 * HUD: carved-stone panels with brass bevels, amber focus light.
 * Layout is in art pixels (480x310 buffer); hit-testing exposes logical
 * coordinates (x2) so input code can stay in game units.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const { C, Pix, css, hash, mix, clamp } = PK;

  const MAP_H = 240;

  const INK = css(C.ink);
  const BR = [0x5a4129, 0x8a6a3c, 0xc09c5a, 0xf0d088];
  const PANEL = [0x181528, 0x1f1b31, 0x2a2542];
  const AMBER = css(C.a[3]);
  const AMBER_D = css(C.a[1]);
  const TEXT = 0xe8e2f4;
  const MUTED = 0x9b94b8;
  const GOOD = 0x7fe08a;
  const BAD = 0xff6a5a;

  const LAYOUT = {
    mini: { x: 4, y: 244, w: 96, h: 62 },
    port: { x: 104, y: 244, w: 48, h: 62 },
    info: { x: 156, y: 244, w: 158, h: 62 },
    card: { x: 318, y: 244, w: 158, h: 62 }
  };

  const BW = 28;
  const BH = 28;
  const BX0 = LAYOUT.card.x + 5;
  const BY0 = LAYOUT.card.y + 2;

  const SLOTS = [
    ["worker", "Q", "Dělník"], ["soldier", "W", "Voják"], ["archer", "E", "Lučištník"],
    ["hero", "H", "Hrdina"], ["command", "M", "Rozkaz"],
    ["tower", "T", "Strážní věž"], ["barracks", "F", "Kasárna"], ["fire", "A", "Ohnivá koule"],
    ["heal", "S", "Léčení"], [null, "", ""]
  ];

  const TIPS = {
    worker: "Těží zlato a dřevo a staví věže i kasárna.",
    soldier: "Štít a meč. Pevný v boji zblízka.",
    archer: "Střílí z velké dálky, ale snadno padne.",
    hero: "Nese lucernu. Ohnivá koule a léčení. Jen jeden.",
    tower: "Střílí na nepřátele v dosahu. Staví dělník.",
    barracks: "Cvičí vojáky, lučištníky a hrdinu. Staví dělník.",
    fire: "Hrdina vrhne ohnivou kouli na cíl (10 s).",
    heal: "Hrdina vyléčí spojence v okolí (14 s).",
    command: "Klepni na cíl: pohyb, útok nebo těžba."
  };

  const buttons = SLOTS.map(([type, key, title], i) => {
    const col = i % 5;
    const row = Math.floor(i / 5);
    const x = BX0 + col * (BW + 2);
    const y = BY0 + row * (BH + 2);
    return { type, key, title, tip: TIPS[type], x, y, w: BW, h: BH, lx: x * 2, ly: y * 2, lw: BW * 2, lh: BH * 2 };
  }).filter(b => b.type);

  /* ---------- baked frames ---------- */
  const frameCache = new Map();

  function frame(w, h, kind = "panel") {
    const key = `${kind}|${w}|${h}`;
    let c = frameCache.get(key);

    if (!c) {
      const P = new Pix(w, h);
      P.rect(0, 0, w, h, C.ink);
      P.rect(1, 1, w - 2, h - 2, BR[1]);
      P.rect(1, 1, w - 2, 1, BR[3]);
      P.rect(1, 1, 1, h - 2, BR[2]);
      P.rect(1, h - 2, w - 2, 1, BR[0]);
      P.rect(w - 2, 1, 1, h - 2, BR[0]);
      P.rect(2, 2, w - 4, h - 4, C.ink);

      if (kind === "plaque") {
        P.shade(3, 3, w - 3, h - 3, () => PANEL[0]);
        P.rect(3, 3, w - 6, 1, PANEL[1]);
      } else {
        P.shade(3, 3, w - 3, h - 3, (x, y) => {
          const v = hash(x, y, 3);
          return v > 0.93 ? PANEL[2] : v < 0.05 ? PANEL[0] : PANEL[1];
        });
        P.rect(3, 3, w - 6, 1, PANEL[0]);
        P.rect(3, 3, 1, h - 6, PANEL[0]);
        P.rect(3, h - 4, w - 6, 1, PANEL[2]);
      }

      for (const [x, y] of [[1, 1], [w - 3, 1], [1, h - 3], [w - 3, h - 3]]) {
        P.rect(x, y, 2, 2, BR[3]);
        P.set(x + 1, y + 1, BR[1]);
      }

      P.clear(0, 0);
      P.clear(w - 1, 0);
      P.clear(0, h - 1);
      P.clear(w - 1, h - 1);

      c = P.toCanvas();
      frameCache.set(key, c);
    }

    return c;
  }

  let strip = null;

  function buildStrip() {
    const P = new Pix(480, 70);
    P.shade(0, 0, 480, 70, (x, y) => {
      const brick = (x + ((y >> 3) & 1) * 6) % 12 === 0 || y % 8 === 7;
      const v = hash(x >> 1, y >> 1, 8);
      return brick ? 0x0f0c1a : v > 0.9 ? 0x1b1730 : 0x15122a;
    });
    P.rect(0, 0, 480, 1, C.ink);
    P.rect(0, 1, 480, 1, BR[3]);
    P.rect(0, 2, 480, 2, BR[2]);
    P.rect(0, 4, 480, 1, BR[0]);
    P.rect(0, 5, 480, 1, C.ink);

    for (let x = 8; x < 480; x += 24) {
      P.rect(x, 2, 2, 2, BR[3]);
      P.set(x + 1, 3, BR[1]);
    }

    return P.toCanvas();
  }

  /* ---------- small helpers ---------- */
  const T = (g, s, x, y, c = TEXT, o) => PK.text(g, s, x, y, c, o);
  const T3 = (g, s, x, y, c = TEXT, o = {}) => PK.text(g, s, x, y, c, { font: "3", ...o });

  const hpColor = p => (p > 0.5 ? css(0x6fd36f) : p > 0.25 ? css(0xffbf45) : css(0xff5a4a));

  function bar(g, x, y, w, h, pct, color, segs = 0, back = "#0d0a17") {
    g.fillStyle = INK;
    g.fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle = back;
    g.fillRect(x, y, w, h);

    const fw = Math.round(w * clamp(pct, 0, 1));

    if (fw > 0) {
      g.fillStyle = color;
      g.fillRect(x, y, fw, h);
      g.fillStyle = "rgba(255,255,255,0.35)";
      g.fillRect(x, y, fw, 1);
      g.fillStyle = "rgba(0,0,0,0.25)";
      g.fillRect(x, y + h - 1, fw, 1);
    }

    if (segs) {
      g.fillStyle = "rgba(10,8,20,0.7)";
      for (let i = segs; i < w; i += segs) g.fillRect(x + i, y, 1, h);
    }
  }

  function dim(g, x, y, w, h) {
    g.fillStyle = "rgba(14,10,26,0.62)";

    for (let yy = 0; yy < h; yy++) {
      for (let xx = (yy & 1); xx < w; xx += 2) g.fillRect(x + xx, y + yy, 1, 1);
    }
  }

  /* ---------- top plaques ---------- */
  const last = { gold: null, wood: null, army: null };
  const pulse = { gold: 0, wood: 0, army: 0 };
  const dir = { gold: 0, wood: 0, army: 0 };

  function drawResources(g, vm, dt) {
    const items = [
      ["gold", PK.icons.small.coin, vm.gold, TEXT],
      ["wood", PK.icons.small.wood, vm.wood, TEXT],
      ["army", PK.icons.small.supply, `${vm.army}/${vm.supplyMax}`, vm.army >= vm.supplyMax ? 0xffbf45 : 0x9ef0f0]
    ];

    let w = 6;
    const widths = items.map(([, , v]) => 8 + 3 + PK.textWidth(String(v)));
    widths.forEach(x => { w += x + 9; });
    w -= 3;

    g.drawImage(frame(w, 15, "plaque"), 3, 3);

    let x = 8;

    items.forEach(([key, icon, value, color], i) => {
      const num = typeof value === "number" ? value : parseInt(value, 10);

      if (last[key] !== null && num !== last[key]) {
        pulse[key] = 0.45;
        dir[key] = num > last[key] ? 1 : -1;
      }

      last[key] = num;
      pulse[key] = Math.max(0, pulse[key] - dt);

      const bump = pulse[key] > 0.3 ? -1 : 0;
      const col = pulse[key] > 0 ? (dir[key] > 0 ? GOOD : BAD) : color;

      g.drawImage(icon, x, 6 + bump + (icon.height < 9 ? 0 : 0));
      T(g, value, x + 11, 7 + bump, col);
      x += widths[i] + 9;

      if (i < items.length - 1) {
        g.fillStyle = "rgba(192,156,90,0.35)";
        g.fillRect(x - 6, 6, 1, 9);
      }
    });
  }

  function drawWave(g, vm, T0) {
    const secs = Math.ceil(vm.waveTimer);
    const label = `VLNA ZA ${secs} S`;
    const urgent = vm.waveTimer < 4;
    const w = 6 + 10 + 3 + PK.textWidth(label) + 3;
    const x = 480 - 3 - w;

    g.drawImage(frame(w, 19, "plaque"), x, 3);

    const flick = urgent && Math.floor(T0 * 5) % 2 === 0;
    g.drawImage(PK.icons.small.horn, x + 5, 6 + (urgent ? Math.round(Math.sin(T0 * 22)) : 0));
    T(g, label, x + 18, 7, flick ? BAD : urgent ? 0xffd27a : 0xf0b0a0);

    const pct = vm.waveMax > 0 ? 1 - vm.waveTimer / vm.waveMax : 0;
    bar(g, x + 5, 16, w - 10, 2, pct, urgent ? css(0xff5a4a) : css(0xe0902a));
  }

  /* ---------- banners ---------- */
  function drawBanners(g, vm, T0) {
    if (vm.messageTimer > 0 && vm.message) {
      const w = PK.textWidth(vm.message) + 16;
      const slideIn = Math.min(1, (3 - vm.messageTimer) / 0.2);
      const slideOut = Math.min(1, vm.messageTimer / 0.3);
      const k = Math.min(slideIn, slideOut);
      const y = 25 - Math.round((1 - k) * 8);
      const x = Math.round(240 - w / 2);

      g.globalAlpha = k;
      g.drawImage(frame(w, 15, "plaque"), x, y);
      T(g, vm.message, 240, y + 4, 0xffe4a8, { align: "center" });
      g.globalAlpha = 1;
    }

    let hint = "";
    if (vm.placement) hint = "UMÍSTI STAVBU · KLIKNI NA MAPU";
    else if (vm.spellMode) hint = "OHNIVÁ KOULE · KLIKNI NA CÍL";
    else if (vm.commandMode) hint = "ROZKAZ · KLIKNI NA CÍL";

    if (hint) {
      const w = PK.textWidth(hint) + 14;
      const x = Math.round(240 - w / 2);
      const pulseA = 0.6 + 0.4 * Math.sin(T0 * 6);

      g.drawImage(frame(w, 13, "plaque"), x, 42);
      g.fillStyle = `rgba(255,191,69,${0.12 * pulseA})`;
      g.fillRect(x + 3, 45, w - 6, 7);
      T(g, hint, 240, 45, 0xfff0c4, { align: "center" });
    }
  }

  /* ---------- minimap ---------- */
  function drawMinimap(g, vm, T0) {
    const L = LAYOUT.mini;
    g.drawImage(frame(L.w, L.h), L.x, L.y);
    T3(g, "MINIMAPA", L.x + 5, L.y + 4, MUTED, { shadow: null });

    const mx = 8;
    const my = 254;
    g.drawImage(PK.world.minimap, mx, my);
    g.fillStyle = "rgba(24,18,48,0.22)";
    g.fillRect(mx, my, 88, 44);
    g.fillStyle = INK;
    g.fillRect(mx - 1, my - 1, 90, 1);
    g.fillRect(mx - 1, my + 44, 90, 1);
    g.fillRect(mx - 1, my, 1, 44);
    g.fillRect(mx + 88, my, 1, 44);

    const sx = 88 / 960;
    const sy = 44 / 480;

    for (const r of vm.resources) {
      g.fillStyle = r.type === "gold" ? "#ffd36b" : "#173a2d";
      if (r.type === "gold") g.fillRect(mx + Math.round(r.x * sx) - 1, my + Math.round(r.y * sy) - 1, 3, 2);
      else g.fillRect(mx + Math.round(r.x * sx), my + Math.round(r.y * sy), 1, 1);
    }

    for (const b of vm.buildings) {
      const x = mx + Math.round(b.x * sx);
      const y = my + Math.round(b.y * sy);
      g.fillStyle = INK;
      g.fillRect(x - 3, y - 2, 6, 5);
      g.fillStyle = b.team === "blue" ? "#58a6e0" : "#e2603c";
      g.fillRect(x - 2, y - 1, 4, 3);
    }

    const blink = Math.floor(T0 * 4) % 2 === 0;

    for (const u of vm.units) {
      const x = mx + Math.round(u.x * sx);
      const y = my + Math.round(u.y * sy);
      if (u.team === "blue") {
        g.fillStyle = u.type === "hero" ? "#ffe08a" : "#e8f4ff";
        g.fillRect(x, y, 1, 1);
      } else {
        g.fillStyle = blink ? "#ff9a7a" : "#d65a3c";
        g.fillRect(x, y, 2, 1);
      }
    }
  }

  /* ---------- portrait ---------- */
  function drawPortrait(g, vm, T0) {
    const L = LAYOUT.port;
    g.drawImage(frame(L.w, L.h), L.x, L.y);

    const wx = L.x + 4;
    const wy = L.y + 4;
    const e = vm.selected[0];

    // window backdrop with a banded lantern halo
    g.fillStyle = INK;
    g.fillRect(wx - 1, wy - 1, 42, 42);
    g.fillStyle = "#1a2240";
    g.fillRect(wx, wy, 40, 40);

    if (!e) {
      g.fillStyle = "#171d38";
      g.fillRect(wx + 4, wy + 4, 32, 32);
      g.drawImage(PK.icons.ringEmblem(24, C.s[3]), wx + 8, wy + 8 + Math.round(Math.sin(T0 * 1.6)));
      return;
    }

    for (const [r, col] of [[19, "#202a52"], [14, "#2a3668"], [9, "#364480"]]) {
      g.fillStyle = col;
      for (let y = -r; y <= r; y++) {
        const hw = Math.round(Math.sqrt(r * r - y * y));
        g.fillRect(wx + 20 - hw, wy + 18 + y, hw * 2, 1);
      }
    }

    g.save();
    g.beginPath();
    g.rect(wx, wy, 40, 40);
    g.clip();

    if (e.kind === "unit") {
      const fi = Math.floor(T0 * 1.6 + e.id) & 1;
      g.drawImage(PK.units.portrait(e.type, e.team, fi), wx, wy);
    } else {
      const spr = PK.buildings.get(e.type);
      const cy = { hall: 30, barracks: 30, tower: 22, citadel: 34 }[e.type] || 30;
      g.drawImage(spr.c, wx + 20 - spr.ax, wy + 20 - cy);
    }

    g.restore();

    // inner glow lines
    g.fillStyle = "rgba(255,191,69,0.35)";
    g.fillRect(wx, wy, 40, 1);
    g.fillStyle = "rgba(10,8,20,0.5)";
    g.fillRect(wx, wy + 39, 40, 1);

    bar(g, wx, L.y + 49, 40, 3, e.hp / e.maxHp, hpColor(e.hp / e.maxHp), 0);

    if (vm.selected.length > 1) {
      T3(g, `x${vm.selected.length}`, wx + 20, L.y + 54, 0xffe08a, { align: "center" });
    } else if (e.type === "hero") {
      T3(g, `UR ${e.level}`, wx + 20, L.y + 54, 0xffe08a, { align: "center" });
    }
  }

  /* ---------- info ---------- */
  const STATUS = { attack: "ÚTOČÍ", move: "POCHOD", gather: "TĚŽÍ" };

  function drawInfo(g, vm, T0) {
    const L = LAYOUT.info;
    g.drawImage(frame(L.w, L.h), L.x, L.y);
    const x0 = L.x + 6;
    const names = vm.names;
    const e = vm.selected[0];

    if (!e) {
      T(g, "VELENÍ", x0, L.y + 5, 0xf0d088);
      const lines = [
        "Vyber jednotku nebo budovu.",
        "Dělník těží zlato a dřevo.",
        "Hrdina získává zkušenosti v boji."
      ];
      let y = L.y + 18;

      for (const text of lines) {
        for (const ln of PK.wrap(text, 144)) {
          T(g, ln, x0, y, 0xb8b0d4);
          y += 10;
        }
      }
      return;
    }

    const multi = vm.selected.length > 1;
    const title = multi ? `${vm.selected.length} JEDNOTEK` : names[e.type];
    T(g, title, x0, L.y + 5, 0xf0d088);

    if (!multi && e.type === "hero") {
      T(g, `ÚROVEŇ ${e.level}`, L.x + L.w - 7, L.y + 5, 0xffe08a, { align: "right" });
    }

    // hp
    let hp = 0;
    let maxHp = 0;
    for (const s of vm.selected) { hp += s.hp; maxHp += s.maxHp; }

    g.drawImage(PK.icons.small.heart, x0, L.y + 16);
    T(g, `${Math.ceil(hp)}/${maxHp}`, x0 + 11, L.y + 16, hp / maxHp > 0.35 ? 0x84e4a0 : 0xf19a7e);
    bar(g, x0, L.y + 27, 144, 4, hp / maxHp, hpColor(hp / maxHp), 8);

    if (multi) {
      const n = Math.min(vm.selected.length, 24);

      for (let i = 0; i < n; i++) {
        const u = vm.selected[i];
        const cx = x0 + (i % 12) * 12;
        const cy = L.y + 35 + Math.floor(i / 12) * 13;
        g.fillStyle = INK;
        g.fillRect(cx, cy, 11, 12);
        g.fillStyle = "#26305a";
        g.fillRect(cx + 1, cy + 1, 9, 10);

        const rec = PK.units.frame(u.type, u.team, "idle", 0);
        g.save();
        g.beginPath();
        g.rect(cx + 1, cy + 1, 9, 8);
        g.clip();
        g.drawImage(rec.c, cx - 10, cy - 9 - (u.type === "hero" ? 2 : 0) - (u.type === "worker" ? 0 : 2), 32, 32);
        g.restore();

        g.fillStyle = hpColor(u.hp / u.maxHp);
        g.fillRect(cx + 1, cy + 10, Math.max(1, Math.round(9 * u.hp / u.maxHp)), 1);
      }

      return;
    }

    // stats
    const stat = (icon, value, x) => {
      g.drawImage(icon, x, L.y + 36);
      T(g, value, x + 11, L.y + 36, 0xe8e2f4);
    };

    if (e.kind === "unit") {
      stat(PK.icons.small.sword, e.damage, x0);
      stat(PK.icons.small.range, e.range, x0 + 40);
      stat(PK.icons.small.boot, e.speed, x0 + 84);

      let status = "ČEKÁ";
      if (e.order && STATUS[e.order.type]) status = STATUS[e.order.type];
      if (e.carry) status = e.carry === "gold" ? "NOSÍ ZLATO" : "NOSÍ DŘEVO";

      if (e.type === "hero") {
        const need = e.level * 40;
        bar(g, x0, L.y + 49, 144, 3, e.xp / need, css(0xffbf45), 0);
        T3(g, `XP ${e.xp}/${need}`, x0 + 72, L.y + 55, 0xffe08a, { align: "center", shadow: null });
        const f = Math.ceil(e.fireCooldown);
        const h = Math.ceil(e.healCooldown);
        T3(g, f > 0 ? `OHEN ${f}S` : "OHEN OK", x0, L.y + 55, f > 0 ? MUTED : 0xffa060, { shadow: null });
        T3(g, h > 0 ? `LECENI ${h}S` : "LECENI OK", x0 + 144, L.y + 55, h > 0 ? MUTED : 0x7fe0b0, { align: "right", shadow: null });
      } else {
        T(g, status, x0, L.y + 49, status === "ČEKÁ" ? MUTED : 0xf0d088);
      }
    } else {
      const detail = {
        hall: "Výcvik dělníků.",
        barracks: "Výcvik armády a hrdiny.",
        tower: "Automatická obrana.",
        citadel: "Cíl tvého útoku."
      }[e.type];

      if (e.type === "tower") {
        stat(PK.icons.small.sword, 20, x0);
        stat(PK.icons.small.range, 155, x0 + 40);
      }

      T(g, detail, x0, L.y + 49, 0xb8b0d4);
    }
  }

  /* ---------- command card ---------- */
  const faceCache = {};

  function face(state) {
    if (faceCache[state]) return faceCache[state];

    const P = new Pix(BW, BH);
    const hover = state === "hover";
    const press = state === "press";
    const active = state === "active";
    const off = state === "off";

    P.rect(0, 0, BW, BH, C.ink);

    const hi = active ? 0xf0d088 : hover ? 0xa89ad0 : press ? 0x1c1830 : 0x5a5478;
    const lo = active ? 0x8a6a3c : hover ? 0x2a2446 : press ? 0x5a5478 : 0x14101f;
    const base = active ? 0x4a3a2c : press ? 0x1d1930 : off ? 0x1b1829 : hover ? 0x3a3560 : 0x2f2a50;

    P.rect(1, 1, BW - 2, BH - 2, base);
    P.rect(1, 1, BW - 2, 1, hi);
    P.rect(1, 1, 1, BH - 2, hi);
    P.rect(1, BH - 2, BW - 2, 1, lo);
    P.rect(BW - 2, 1, 1, BH - 2, lo);

    // soft top sheen + stipple
    if (!off && !press) {
      for (let x = 2; x < BW - 2; x += 2) P.set(x, 2, mix(base, 0xffffff, 0.12));
    }

    if (hover || active) {
      const c = active ? 0xffbf45 : 0xc09c5a;
      P.rect(2, 2, BW - 4, 1, c);
      P.rect(2, 2, 1, BH - 4, c);
      P.rect(2, BH - 3, BW - 4, 1, mix(c, 0x000000, 0.4));
      P.rect(BW - 3, 2, 1, BH - 4, mix(c, 0x000000, 0.4));
    }

    P.clear(0, 0);
    P.clear(BW - 1, 0);
    P.clear(0, BH - 1);
    P.clear(BW - 1, BH - 1);

    return (faceCache[state] = P.toCanvas());
  }

  function drawButton(g, b, vm, T0) {
    const st = vm.btn[b.type] || {};
    const hover = vm.hoverBtn === b.type;
    const press = vm.pressedBtn === b.type && hover;
    const active = !!st.active;
    const off = st.enabled === false;
    const state = press ? "press" : active ? "active" : off ? "off" : hover ? "hover" : "base";

    g.drawImage(face(state === "base" ? "base" : state), b.x, b.y);

    if (active) {
      g.fillStyle = `rgba(255,191,69,${0.18 + 0.12 * Math.sin(T0 * 7)})`;
      g.fillRect(b.x + 3, b.y + 3, BW - 6, BH - 6);
    }

    const shift = press ? 1 : hover && !off ? -1 : 0;
    const icon = off || st.afford === false ? PK.icons.bigOff[b.type] : PK.icons.big[b.type];
    g.drawImage(icon, b.x + 6 + (press ? 1 : 0), b.y + 3 + (press ? 1 : 0) + (hover && !press ? shift : 0));

    if (off) dim(g, b.x + 2, b.y + 2, BW - 4, BH - 4);

    // hotkey plaque
    g.fillStyle = "rgba(10,8,20,0.7)";
    g.fillRect(b.x + 2, b.y + 2, 7, 7);
    T3(g, b.key, b.x + 4, b.y + 3, active ? 0xffe08a : 0xf0d088, { shadow: null });

    // price tags
    const cost = vm.costs[b.type];

    if (cost) {
      const ok = st.afford !== false;
      const gold = String(cost.gold);
      T3(g, gold, b.x + 3, b.y + 21, ok ? 0xffe08a : BAD);

      if (cost.wood) {
        T3(g, String(cost.wood), b.x + BW - 3, b.y + 21, ok ? 0xe0b070 : BAD, { align: "right" });
      }
    } else if (st.cd > 0) {
      // clockwise pixel wipe over the icon
      const frac = st.cd / st.cdMax;
      g.fillStyle = "rgba(10,8,22,0.66)";

      for (let y = 0; y < 22; y++) {
        for (let x = 0; x < 24; x++) {
          const ang = (Math.atan2(y - 11, x - 12) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
          if (ang / (Math.PI * 2) > 1 - frac) g.fillRect(b.x + 2 + x, b.y + 3 + y, 1, 1);
        }
      }

      T3(g, String(Math.ceil(st.cd)), b.x + 14, b.y + 12, 0xffffff, { align: "center", outline: C.ink });
    } else if (b.type === "fire" || b.type === "heal") {
      if (!off) T3(g, "OK", b.x + BW - 3, b.y + 21, 0x9ef0b0, { align: "right", shadow: null });
    }
  }

  function drawCard(g, vm, T0) {
    const L = LAYOUT.card;
    g.drawImage(frame(L.w, L.h), L.x, L.y);

    // empty socket for the tenth slot
    g.fillStyle = INK;
    g.fillRect(BX0 + 4 * 30, BY0 + 30, BW, BH);
    g.fillStyle = "#14101f";
    g.fillRect(BX0 + 4 * 30 + 1, BY0 + 31, BW - 2, BH - 2);
    g.drawImage(PK.icons.ringEmblem(12, 0x2a2542), BX0 + 4 * 30 + 8, BY0 + 30 + 8);

    for (const b of buttons) drawButton(g, b, vm, T0);
  }

  function drawTooltip(g, vm) {
    const b = buttons.find(k => k.type === vm.hoverBtn);
    if (!b) return;

    const cost = vm.costs[b.type];
    const innerW = 118;
    const lines = PK.wrap(b.tip, innerW);
    const w = innerW + 12;
    const h = 10 + 10 + lines.length * 10 + (cost ? 11 : 0) + 4;
    const x = Math.min(476 - w, b.x + BW / 2 - w / 2);
    const y = LAYOUT.card.y - h - 3;

    g.drawImage(frame(w, h, "plaque"), x, y);
    T(g, b.title, x + 6, y + 6, 0xf0d088);
    T3(g, `[${b.key}]`, x + w - 6, y + 8, MUTED, { align: "right", shadow: null });

    let yy = y + 18;
    for (const ln of lines) {
      T(g, ln, x + 6, yy, 0xd8d2f0);
      yy += 10;
    }

    if (cost) {
      const st = vm.btn[b.type] || {};
      const okG = vm.gold >= cost.gold;
      const okW = vm.wood >= cost.wood;
      g.drawImage(PK.icons.small.coin, x + 6, yy + 1);
      T(g, cost.gold, x + 17, yy + 1, okG ? 0xffe08a : BAD);
      g.drawImage(PK.icons.small.wood, x + 46, yy + 1);
      T(g, cost.wood, x + 58, yy + 1, okW ? 0xe0b070 : BAD);
      void st;
    }
  }

  /* ---------- end screen ---------- */
  function drawEnd(g, vm, T0, endT) {
    const k = Math.min(1, endT / 0.6);
    const win = vm.state === "win";

    g.globalAlpha = 0.55 * k;
    g.fillStyle = win ? "#1a1a38" : "#2a0d16";
    g.fillRect(0, 0, 480, MAP_H);
    g.globalAlpha = 1;

    const w = 210;
    const h = 78;
    const x = 240 - w / 2;
    const y = 64 - Math.round((1 - k) * 24);

    g.drawImage(frame(w, h), x, y);
    g.drawImage(PK.icons.ringEmblem(18, win ? C.a[2] : C.r[3], win ? C.a[4] : C.r[5]), 240 - 9, y - 8 + Math.round(Math.sin(T0 * 2)));

    const title = win ? "VÍTĚZSTVÍ!" : "RADNICE PADLA!";
    T(g, title, 240, y + 16, win ? 0xffe08a : 0xff8f7a, { align: "center", scale: 2, outline: C.ink, shadow: null });

    const mins = Math.floor(vm.elapsed / 60);
    const secs = Math.floor(vm.elapsed % 60);
    T(g, `ČAS BOJE ${mins}:${String(secs).padStart(2, "0")}`, 240, y + 40, 0xb8b0d4, { align: "center" });
    T(g, "Klikni na Nová hra nebo stiskni R.", 240, y + 56, 0xf0d088, { align: "center" });
  }

  /* ---------- title logo (for the page header) ---------- */
  function drawLogo(canvas) {
    const scale = 3;
    const label = "PIXELOVÉ KRÁLOVSTVÍ";
    const tw = PK.textWidth(label, "5", scale);
    const emblem = PK.icons.ringEmblem(20, C.a[2], C.a[4]);
    const w = tw + 44 * 2 + 12;
    const h = 40;

    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, w, h);

    g.drawImage(emblem, 0, 8, 28, 28);
    g.drawImage(emblem, w - 28, 8, 28, 28);

    // brass underline
    g.fillStyle = css(BR[1]);
    g.fillRect(36, 33, w - 72, 2);
    g.fillStyle = css(BR[3]);
    g.fillRect(36, 33, w - 72, 1);

    PK.text(g, label, w / 2, 10, 0xffe08a, { align: "center", scale, shadow: 0x6e1f2c, outline: C.ink });
  }

  /* ---------- public ---------- */
  function draw(g, vm, T0, dt) {
    if (!strip) strip = buildStrip();

    g.drawImage(strip, 0, MAP_H);
    drawMinimap(g, vm, T0);
    drawPortrait(g, vm, T0);
    drawInfo(g, vm, T0);
    drawCard(g, vm, T0);

    // central ornament over the border
    g.drawImage(PK.icons.ringEmblem(13, C.a[2], C.a[4]), 240 - 6, MAP_H - 5 + Math.round(Math.sin(T0 * 1.4) * 0.6));

    drawResources(g, vm, dt);
    drawWave(g, vm, T0);
    drawBanners(g, vm, T0);
    drawTooltip(g, vm);
  }

  function hitButton(lx, ly) {
    for (const b of buttons) {
      if (lx >= b.lx && lx < b.lx + b.lw && ly >= b.ly && ly < b.ly + b.lh) return b;
    }

    return null;
  }

  PK.hud = { buttons, hitButton, draw, drawEnd, drawLogo, layout: LAYOUT, MAP_H };
})();
