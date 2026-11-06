/*
 * Zvířátka na mapě: zajíci, vrabci, vrány, motýli, žáby, kachny, srnky,
 * včely a ryby. Jsou jen na ozdobu: žijí na klientu, simulaci ani síť
 * neovlivňují a dají se rozplašit jen tím, že k nim dojde jednotka.
 *
 * Sprity v jemné mřížce (PK.HD = 2) s tmavým obrysem a stínováním
 * (Jiří chce u zvířat výrazný obrys a detail). Malí tvorové jsou
 * nakreslení po bodech (řádky znaků), srnka se skládá z tvarů.
 * Souřadnice zvířat jsou v art px světa (stejně jako kulisy).
 */
(() => {
  "use strict";

  const PK = window.PK;
  const { C, Pix, mix, hash, rng, HD } = PK;
  const F = 1 / HD;

  /* ======================= sprity ======================= */
  const cache = new Map();

  // řádky znaků -> Pix, obrys, jemné dvojče; flip = zrcadlo (pohled doleva)
  function rows(key, lines, legend, ol = 0.62) {
    if (cache.has(key)) return cache.get(key);
    const P = Pix.fromRows(lines.map(l => l.padEnd(Math.max(...lines.map(s => s.length)), ".")), legend);
    // okraj kolem, aby se obrys vešel
    const Q = new Pix(P.w + 2, P.h + 2);
    Q.stamp(P, 1, 1);
    Q.outline(C.ink, ol);
    const out = { r: PK.fine(Q), l: PK.fine(Q.flipX()), w: Q.w / HD, h: Q.h / HD };
    cache.set(key, out);
    return out;
  }

  const FUR = { a: mix(C.d[4], C.d[5], 0.3), b: C.d[3], c: C.d[2], d: C.d[1], w: C.white, e: C.ink, p: C.cap[2], n: C.cap[1], s: C.bone[0] };
  const RABBIT = {
    sit: [
      "........cb...",
      ".......cbp...",
      ".......cbp...",
      ".......cbb...",
      "......bbaab..",
      "....bbbbaeab.",
      "..bbbaabaaan.",
      ".wbbbbabbbs..",
      "wwbbbbbbbbb..",
      ".cbbbbbbbbc..",
      "..ccbbbbccc..",
      "..dd.dd.ad...",
    ],
    ear: [
      ".........cb..",
      "........cbp..",
      ".......cbp...",
      ".......cbb...",
      "......bbaab..",
      "....bbbbaeab.",
      "..bbbaabaaan.",
      ".wbbbbabbbs..",
      "wwbbbbbbbbb..",
      ".cbbbbbbbbc..",
      "..ccbbbbccc..",
      "..dd.dd.ad...",
    ],
    hop: [
      "..........cc..",
      ".........cbp..",
      "........bbaab.",
      "...bbbbbbaeab.",
      ".bbbaabbbaaan.",
      "wbbbbbabbbs...",
      "wwbbbbbbbbb...",
      ".cbbbbbbbc....",
      "cdd......ad...",
    ],
    graze: [
      ".......cb....",
      "......cbp....",
      "......cbb....",
      "....bbbbab...",
      "..bbbaabaab..",
      ".wbbbbabbaeb.",
      "wwbbbbbbbaaan",
      ".cbbbbbbbbs..",
      "..ccbbbbccc..",
      "..dd.dd.ad...",
    ]
  };

  const BIRD = { a: mix(C.d[4], C.bone[0], 0.3), b: C.d[3], c: C.w[2], d: C.w[1], e: C.ink, y: C.a[1], k: C.bone[0] };
  const SPARROW = {
    stand: [
      "...cc...",
      "..cbbe..",
      ".dcbbay.",
      "dcbabk..",
      "dcbbb...",
      ".dcc....",
      "...y.y..",
    ],
    peck: [
      "........",
      "..cc....",
      ".dcbbc..",
      "dcbabbe.",
      "dcbbkbay",
      ".dcc....",
      "...y.y..",
    ],
    up: [
      "c.......c",
      "bc.....cb",
      ".bc...cb.",
      "..cbabc..",
      "...dbe...",
      "....y....",
    ],
    down: [
      "...cbe...",
      ".ccbabcc.",
      "cb..d..bc",
      "c.......c",
    ]
  };

  const CROWC = { a: C.s[2], b: C.s[1], c: C.s[0], e: C.r[4], y: C.s[3] };
  const CROW = {
    up: [
      "a.........a",
      "ba.......ab",
      ".bb.....bb.",
      "..bbbabbb..",
      "....bcby...",
      ".....c.....",
    ],
    mid: [
      "...........",
      "...........",
      "aabbbabbbaa",
      ".bb.bcby.b.",
      ".....c.....",
    ],
    down: [
      "....bcby...",
      "..bbbabbb..",
      ".bb.....bb.",
      "ba.......ab",
    ]
  };

  const BUTTER = [
    { a: C.a[3], b: C.a[1], e: C.ink, s: C.white },
    { a: C.u[3], b: C.u[2], e: C.ink, s: C.u[4] },
    { a: C.white, b: C.bone[1], e: C.ink, s: C.a[3] },
    { a: C.cap[2], b: C.cap[1], e: C.ink, s: C.white }
  ];
  const WINGS = {
    open: [
      "ab.ba",
      "asesa",
      ".bbb.",
      "..e..",
    ],
    half: [
      ".a.a.",
      ".aea.",
      ".beb.",
      "..e..",
    ],
    shut: [
      "..a..",
      "..e..",
      "..e..",
    ]
  };

  const FROGC = { a: C.g[5], b: C.g[4], c: C.g[3], d: C.g[2], e: C.ink, w: C.white, y: C.a[3] };
  const FROG = {
    sit: [
      ".we..we.",
      ".ebbbbe.",
      "babbbbab",
      "bcaybcab",
      "dcbbbbcd",
      "dd.dd.dd",
    ],
    jump: [
      "..we..we.",
      "..ebbbbe.",
      ".babbbbab",
      "dbcabbcbd",
      "dd......dd",
    ]
  };

  const DUCKC = { h: mix(C.g[2], C.t[1], 0.4), j: C.g[3], e: C.ink, y: C.a[2], w: C.white, r: mix(C.w[2], C.r[1], 0.3), g: C.s[4], f: C.s[3], k: C.s[2], s: C.u[2] };
  const DUCKF = { h: C.d[3], j: C.d[4], e: C.ink, y: C.a[1], w: C.d[4], r: C.d[3], g: C.d[3], f: C.d[2], k: C.d[1], s: C.u[2] };
  const DUCK = {
    swim: [
      ".......jh...",
      "......hhhe..",
      "......hhhyy.",
      ".......ww...",
      "..fgggrrr...",
      ".kfggsggrr..",
      "kkffffggf...",
      ".kkkkkkk....",
    ],
    dip: [
      "............",
      "............",
      "....fgg.....",
      "..kfggsg....",
      ".kkffggjh...",
      "..kkkkkhhyy.",
    ]
  };

  /* Srnka: tělo, krk, hlava, uši, nohy po jemných px; f = fáze chůze, graze = hlava u země. */
  function deerSprite(f, graze, buck) {
    const key = `deer|${f}|${graze ? 1 : 0}|${buck ? 1 : 0}`;
    if (cache.has(key)) return cache.get(key);
    const W = 30;
    const H = 30;
    const P = new Pix(W, H);
    const FURD = [mix(C.w[1], C.shade, 0.2), C.w[2], mix(C.w[3], C.r[2], 0.18), mix(C.d[3], C.r[3], 0.15), mix(C.d[4], C.a[1], 0.2), C.d[5]];
    const legY = 20;
    // nohy (zadní pár tmavší), fáze chůze posouvá kopyta
    const swing = [0, 1, 0, -1][f & 3];
    const legs = [[8, -swing, 1], [10, swing, 2], [19, swing, 1], [21, -swing, 2]];
    for (const [x, s, tone] of legs) {
      for (let y = legY - 1; y < legY + 7; y++) {
        const xx = x + Math.round(s * (y - legY) / 7);
        // stehno širší, holeň jen jemný px, nad kopýtkem kloub
        P.set(xx, y, FURD[y === legY + 3 ? tone - 1 : tone]);
        if (y < legY + 2) P.set(xx + 1, y, FURD[Math.max(0, tone - 1)]);
      }
      P.set(x + s, legY + 7, C.ink);
    }
    // tělo
    P.disc(15, 16, 9, 4.6, (x, y) => {
      const nx = (x + 0.5 - 15) / 9;
      const ny = (y + 0.5 - 16) / 4.6;
      let v = 3.6 - nx * 0.7 - ny * 1.6;
      if (ny > 0.5) v = 4.6; // světlé břicho
      if (hash(x, y, 4) > 0.9 && ny < 0.3) v -= 0.6;
      return FURD[Math.max(0, Math.min(5, Math.round(v)))];
    });
    // bílé zrcátko a ocásek
    P.disc(6.5, 14.5, 2, 2.4, C.bone[0]);
    P.set(5, 12, FURD[2]); P.set(6, 12, FURD[3]);
    // světlé skvrny na hřbetě (kolouch-styl jen jemně)
    for (const [x, y] of [[11, 13], [15, 12], [19, 13], [13, 15]]) P.set(x, y, mix(FURD[4], C.bone[0], 0.5));
    // krk a hlava
    const hx = graze ? 25 : 24;
    const hy = graze ? 21 : 6;
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const x = Math.round(21 + (hx - 21) * t);
      const y = Math.round(13 + (hy + 2 - 13) * t);
      P.set(x, y, FURD[4]);
      P.set(x + 1, y, FURD[3]);
      P.set(x - 1, y, FURD[3]);
      P.set(x, y + 1, FURD[3]);
    }
    P.disc(hx + 1, hy, 2.6, 2.1, (x, y) => FURD[(x + 0.5 - hx) < 0 ? 4 : 3]);
    P.set(hx + 3, hy + 1, FURD[3]); P.set(hx + 4, hy + 1, C.ink); // čenich
    P.set(hx + 1, hy - 1, C.ink); // oko
    P.set(hx + 2, hy - 1, C.white);
    // uši
    P.set(hx - 1, hy - 2, FURD[3]); P.set(hx - 2, hy - 3, FURD[2]); P.set(hx - 1, hy - 3, C.cap[2]);
    if (buck) {
      // parůžky
      for (const [x, y] of [[hx, hy - 3], [hx, hy - 4], [hx - 1, hy - 5], [hx + 1, hy - 5], [hx + 1, hy - 6], [hx + 2, hy - 4]]) P.set(x, y, C.bone[1]);
      P.set(hx - 1, hy - 6, C.bone[0]);
    }
    P.outline(C.ink, 0.66);
    const out = { r: PK.fine(P), l: PK.fine(P.flipX()), w: W / HD, h: H / HD };
    cache.set(key, out);
    return out;
  }

  // kulatý stín na zemi (jemné body)
  function shadow(g, x, y, rx, a = 0.28) {
    g.fillStyle = `rgba(21,18,31,${a})`;
    for (let dx = -rx; dx <= rx; dx += F) {
      const k = Math.sqrt(Math.max(0, 1 - (dx / rx) * (dx / rx)));
      const h = Math.max(F, Math.round(k * rx * 0.35 / F) * F);
      g.fillRect(Math.round((x + dx) / F) * F, Math.round((y - h / 2) / F) * F, F, h);
    }
  }

  const snap = v => Math.round(v * HD) / HD;

  /* ======================= obyvatelé mapy ======================= */
  const state = { list: [], for: null, clock: 0 };

  function zoneAt(w, x, y) {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= w.W || yi >= w.H) return -1;
    return w.zone[yi * w.W + xi];
  }

  function spawn(w) {
    state.list = [];
    const Z = w.Z;
    const R = rng(w.W * 13 + w.H * 7 + 77);
    const area = w.W * w.H / (480 * 240);
    const n = k => Math.max(1, Math.round(k * area));
    const grass = (x, y) => zoneAt(w, x, y) === Z.GRASS && !(w.ashMap && w.ashMap[Math.round(y) * w.W + Math.round(x)]);
    const find = (ok, tries = 80) => {
      for (let i = 0; i < tries; i++) {
        const x = 16 + R() * (w.W - 32);
        const y = 30 + R() * (w.H - 44);
        if (ok(x, y)) return [x, y];
      }
      return null;
    };
    // výchozí vlastnosti podle druhu (pohlaví kachny, paroží srnce, barva motýla, kruh vrány…)
    const placed = (type, x, y) => {
      if (type === "duck") return add("duck", [x, y], { male: R() < 0.5 });
      if (type === "deer") return add("deer", [x, y], { buck: R() < 0.4 });
      if (type === "butterfly") return add("butterfly", [x, y], { kind: Math.floor(R() * BUTTER.length), z: 6 + R() * 6 });
      if (type === "crow") return add("crow", [x, y], { r: 22 + R() * 18, sp: 0.35 + R() * 0.25, z: 40 + R() * 16 });
      if (type === "bee") { for (let j = 0; j < 5; j++) add("bee", [x, y - 6], { ph: j * 1.3 }); return; }
      if (type === "fish") return add("fish", [x, y], { t: R() * 8 });
      if (type === "sparrow") { for (let j = 0; j < 3; j++) add("sparrow", [x + (R() - 0.5) * 12, y + (R() - 0.5) * 6], { flock: 100 + Math.round(x) }); return; }
      return add(type, [x, y]);
    };
    const add = (type, p, o = {}) => p && state.list.push({ type, x: p[0], y: p[1], hx: p[0], hy: p[1], t: R() * 4, ph: R() * 6.28, face: R() < 0.5 ? 1 : -1, st: "idle", z: 0, ...o });

    // zvířata z editoru map: stojí přesně tam, kam je autor dal
    for (const [type, x, y] of w.critterSpots || []) placed(type, x, y);
    if (w.wild === false) return;

    for (let i = 0; i < n(5); i++) add("rabbit", find(grass));
    // hejnka vrabců (3-5 ptáčků u sebe)
    for (let i = 0; i < n(2); i++) {
      const p = find(grass);
      if (!p) continue;
      const k = 3 + Math.floor(R() * 3);
      for (let j = 0; j < k; j++) add("sparrow", [p[0] + (R() - 0.5) * 14, p[1] + (R() - 0.5) * 7], { flock: i });
    }
    const winter = !!(PK.winter && PK.winter.on);
    // motýli u květin
    const flowers = w.doodads.filter(d => /^(flowers|lavender|bushFlower)/.test(d.name));
    for (let i = 0; i < (winter ? 0 : Math.min(flowers.length, n(8))); i++) {
      const d = flowers[Math.floor(R() * flowers.length)];
      add("butterfly", [d.x, d.y - 2], { kind: Math.floor(R() * BUTTER.length), z: 6 + R() * 6 });
    }
    // žáby u rákosí
    if (!winter) for (const d of w.doodads.filter(d => d.name.startsWith("reeds")).slice(0, n(5))) add("frog", [d.x + (R() - 0.5) * 8, d.y + 2 + R() * 2]);
    // kachny na otevřené vodě, v páru
    const open = (x, y) => [[0, 0], [-8, 0], [8, 0], [0, -5], [0, 5]].every(([dx, dy]) => zoneAt(w, x + dx, y + dy) === Z.WATER);
    for (let i = 0; i < n(2); i++) {
      const p = find(open, 200);
      if (!p) continue;
      add("duck", p, { male: true });
      add("duck", [p[0] - 7, p[1] + 2], { male: false });
    }
    // ryby (jen šplouchnutí na vodě)
    for (let i = 0; i < n(3); i++) add("fish", find(open, 200), { t: R() * 8 });
    // srnky na okrajích lesa
    for (let i = 0; i < n(1.5); i++) {
      const p = find((x, y) => grass(x, y) && w.doodads.length && (x < w.W * 0.2 || x > w.W * 0.8 || y < w.H * 0.25 || y > w.H * 0.8), 200);
      if (p) add("deer", p, { buck: R() < 0.4 });
    }
    // vrány krouží nad popelem / hřbitovy
    const graves = w.doodads.filter(d => /^(grave|bones|swordGrave|skull|ribs)/.test(d.name));
    for (let i = 0; i < Math.min(3, Math.max(graves.length ? 2 : 1, n(1))); i++) {
      const c = graves.length ? graves[Math.floor(R() * graves.length)] : { x: 40 + R() * (w.W - 80), y: 50 + R() * (w.H - 80) };
      add("crow", [c.x, c.y], { r: 22 + R() * 18, sp: 0.35 + R() * 0.25, z: 40 + R() * 16 });
    }
    // včely u úlů
    if (!winter) for (const d of w.doodads.filter(d => d.name === "beehives")) for (let j = 0; j < 5; j++) add("bee", [d.x, d.y - 6], { ph: j * 1.3 });
  }

  /* ======================= chování ======================= */
  // nejbližší jednotka (art px): plaší se před ní
  function nearUnit(units, x, y, r) {
    let best = null;
    let bd = r * r;
    for (const u of units) {
      const dx = u.x / 2 - x;
      const dy = (u.y / 2 - y) * 1.4;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }

  function update(dt, units) {
    const w = PK.world;
    if (!w || !w.ready || !w.zone) return;
    if (state.for !== w.doodads) { state.for = w.doodads; spawn(w); }
    state.clock += dt;
    const Z = w.Z;
    const grassOk = (x, y) => { const z = zoneAt(w, x, y); return z === Z.GRASS || z === Z.PATH || z === Z.PLAZA; };

    for (const a of state.list) {
      a.t += dt;
      if (a.type === "rabbit") {
        const u = nearUnit(units, a.x, a.y, 26);
        if (u && a.st !== "flee") { a.st = "flee"; a.t = 0; a.face = u.x / 2 > a.x ? -1 : 1; a.tx = a.x + a.face * (30 + Math.random() * 20); a.ty = a.y + (Math.random() - 0.5) * 20; }
        if (a.st === "idle" && a.t > 2 + hash(a.ph * 9, 1, 3) * 4) { a.st = "hop"; a.t = 0; a.face = Math.random() < 0.5 ? 1 : -1; a.tx = a.hx + (Math.random() - 0.5) * 40; a.ty = a.hy + (Math.random() - 0.5) * 18; a.face = a.tx > a.x ? 1 : -1; }
        if (a.st === "hop" || a.st === "flee") {
          const sp = a.st === "flee" ? 46 : 16;
          const dx = a.tx - a.x;
          const dy = a.ty - a.y;
          const d = Math.hypot(dx, dy);
          // skoky: pohyb jen ve fázi letu
          const hopT = (a.t * (a.st === "flee" ? 3.4 : 2.2)) % 1;
          a.z = Math.sin(hopT * Math.PI) * (a.st === "flee" ? 3 : 2);
          if (d < 1 || a.t > 4) { if (a.st === "flee") { a.hx = a.x; a.hy = a.y; } a.st = "idle"; a.t = 0; a.z = 0; }
          else if (hopT < 0.75) {
            const nx = a.x + dx / d * sp * dt;
            const ny = a.y + dy / d * sp * dt;
            if (grassOk(nx, ny)) { a.x = nx; a.y = ny; } else { a.st = "idle"; a.t = 0; a.z = 0; }
          }
        }
      } else if (a.type === "sparrow") {
        if (a.st !== "fly") {
          const u = nearUnit(units, a.x, a.y, 30);
          if (u) {
            // celé hejno vzlétne najednou
            for (const b of state.list) if (b.type === "sparrow" && b.flock === a.flock && b.st !== "fly") { b.st = "fly"; b.t = 0; b.face = u.x / 2 > b.x ? -1 : 1; b.vx = b.face * (40 + Math.random() * 20); b.vz = 30 + Math.random() * 14; }
          } else if (a.t > 0.4 + hash(a.ph, a.t | 0, 5) * 1.2) {
            a.t = 0;
            a.st = Math.random() < 0.55 ? "peck" : "idle";
            if (Math.random() < 0.3) { const nx = a.x + (Math.random() - 0.5) * 6; if (grassOk(nx, a.y)) { a.face = nx > a.x ? 1 : -1; a.x = nx; } }
          }
        } else {
          a.x += a.vx * dt;
          a.z += a.vz * dt;
          a.vz = Math.max(6, a.vz - 10 * dt);
          // po čase přistanou jinde na trávě
          if (a.t > 5 + hash(a.ph, 3, 1) * 3) {
            const p = [a.x, a.y];
            if (grassOk(p[0], p[1]) && p[0] > 10 && p[0] < w.W - 10) { a.st = "idle"; a.z = 0; a.t = 0; a.hx = a.x; }
            else if (a.t > 14) { a.x = a.hx; a.z = 0; a.st = "idle"; a.t = 0; }
          }
        }
      } else if (a.type === "frog") {
        const u = nearUnit(units, a.x, a.y, 22);
        if (u && a.st === "idle") { a.st = "jump"; a.t = 0; a.face = u.x / 2 > a.x ? -1 : 1; }
        if (a.st === "jump") {
          a.z = Math.sin(Math.min(1, a.t / 0.45) * Math.PI) * 4;
          a.y += 18 * dt;
          a.x += a.face * 8 * dt;
          if (a.t > 0.45) {
            // šplouch do vody, za chvíli se vynoří zpět u rákosí
            if (PK.fx && PK.fx.footstep) PK.fx.footstep(a.x * 2, a.y * 2, true);
            a.st = "gone"; a.t = 0; a.z = 0;
          }
        } else if (a.st === "gone" && a.t > 6 && !nearUnit(units, a.hx, a.hy, 30)) {
          a.st = "idle"; a.x = a.hx; a.y = a.hy; a.t = 0;
        }
      } else if (a.type === "duck") {
        // pomalé kroužení po vodě, občas se potopí hlavou
        const ang = state.clock * 0.08 + a.ph;
        const nx = a.hx + Math.sin(ang) * 16;
        const ny = a.hy + Math.sin(ang * 1.3) * 5;
        if (zoneAt(w, nx, ny) === Z.WATER) { a.face = nx > a.x ? 1 : -1; a.x = nx; a.y = ny; }
        if (a.st === "idle" && Math.random() < dt * 0.12) { a.st = "dip"; a.t = 0; }
        if (a.st === "dip" && a.t > 1.6) a.st = "idle";
      } else if (a.type === "deer") {
        const u = nearUnit(units, a.x, a.y, 48);
        if (u && a.st !== "flee") { a.st = "flee"; a.t = 0; a.face = u.x / 2 > a.x ? -1 : 1; a.tx = a.x + a.face * 70; a.ty = a.y + (Math.random() - 0.5) * 30; }
        if (a.st === "idle" && a.t > 4) { a.st = Math.random() < 0.5 ? "walk" : "graze"; a.t = 0; a.tx = a.hx + (Math.random() - 0.5) * 40; a.ty = a.hy + (Math.random() - 0.5) * 16; }
        if (a.st === "graze" && a.t > 5) { a.st = "idle"; a.t = 0; }
        if (a.st === "walk" || a.st === "flee") {
          const sp = a.st === "flee" ? 52 : 9;
          const dx = a.tx - a.x;
          const dy = a.ty - a.y;
          const d = Math.hypot(dx, dy);
          a.face = dx > 0 ? 1 : -1;
          if (d < 1.5 || a.t > 6) { if (a.st === "flee") { a.hx = a.x; a.hy = a.y; } a.st = "idle"; a.t = 0; }
          else {
            const nx = a.x + dx / d * sp * dt;
            const ny = a.y + dy / d * sp * dt;
            if (grassOk(nx, ny)) { a.x = nx; a.y = ny; a.walk = (a.walk || 0) + sp * dt; } else { a.st = "idle"; a.t = 0; }
          }
        }
      }
    }
  }

  /* ======================= kreslení ======================= */
  // Položky do seřazeného seznamu (game.js): k = 6, y = pata.
  function collect(list, visible) {
    for (const a of state.list) {
      if (a.st === "gone" || a.type === "fish" || a.type === "crow" || a.type === "bee") continue;
      if (visible(a.x, a.y)) list.push({ y: a.y, k: 6, o: a });
    }
  }

  function blit(g, spr, a, ox, oy, dirRight) {
    const img = dirRight ? spr.r : spr.l;
    const x = dirRight ? ox : -ox - spr.w;
    g.drawImage(img, snap(a.x + x), snap(a.y - a.z + oy));
  }

  function draw(g, a, T, reflecting) {
    const right = a.face > 0;
    if (a.type === "rabbit") {
      if (!reflecting) shadow(g, a.x, a.y, 3.2);
      let fr = "sit";
      if (a.st === "hop" || a.st === "flee") fr = a.z > 0.3 ? "hop" : "sit";
      else if (Math.sin(T * 0.5 + a.ph) > 0.55) fr = "graze";
      else if ((Math.floor(T * 2 + a.ph * 3) % 7) === 0) fr = "ear";
      const s = rows(`rabbit|${fr}`, RABBIT[fr], FUR);
      blit(g, s, a, -s.w / 2, -s.h + 0.5, right);
    } else if (a.type === "sparrow") {
      if (a.st === "fly") {
        shadow(g, a.x, a.y, 1.4, Math.max(0, 0.25 - a.z * 0.004));
        const s = rows(`sp|${Math.floor(T * 14 + a.ph) & 1 ? "up" : "down"}`, SPARROW[Math.floor(T * 14 + a.ph) & 1 ? "up" : "down"], BIRD);
        blit(g, s, a, -s.w / 2, -s.h - 2, right);
      } else {
        if (!reflecting) shadow(g, a.x, a.y, 1.6);
        const fr = a.st === "peck" && (Math.floor(T * 5 + a.ph) & 1) ? "peck" : "stand";
        const s = rows(`sp|${fr}`, SPARROW[fr], BIRD);
        blit(g, s, a, -s.w / 2, -s.h + 0.5, right);
      }
    } else if (a.type === "butterfly") {
      const fx = a.x + Math.sin(T * 0.9 + a.ph) * 10 + Math.sin(T * 2.3 + a.ph) * 3;
      const fy = a.y + Math.cos(T * 0.7 + a.ph) * 4;
      const fz = a.z + Math.sin(T * 3.1 + a.ph) * 2.5;
      if (!reflecting) shadow(g, fx, fy, 1, 0.14);
      const ph = Math.floor(T * 12 + a.ph * 2) % 4;
      const fr = ph === 0 ? "open" : ph === 2 ? "shut" : "half";
      const s = rows(`bf|${a.kind}|${fr}`, WINGS[fr], BUTTER[a.kind], 0.55);
      g.drawImage(s.r, snap(fx - s.w / 2), snap(fy - fz - s.h));
    } else if (a.type === "frog") {
      if (!reflecting) shadow(g, a.x, a.y, 2.2);
      const fr = a.st === "jump" ? "jump" : "sit";
      const s = rows(`frog|${fr}`, FROG[fr], FROGC);
      blit(g, s, a, -s.w / 2, -s.h + 0.5, right);
      // hrdlo se nafukuje
      if (fr === "sit" && Math.sin(T * 5 + a.ph) > 0.7) {
        g.fillStyle = "#e0c68e";
        g.fillRect(snap(a.x + (right ? 1 : -1.5)), snap(a.y - 1.5), F, F);
        g.fillRect(snap(a.x + (right ? 1.5 : -2)), snap(a.y - 1.5), F, F);
      }
    } else if (a.type === "duck") {
      const fr = a.st === "dip" ? "dip" : "swim";
      const s = rows(`duck|${a.male ? 1 : 0}|${fr}`, DUCK[fr], a.male ? DUCKC : DUCKF);
      // vlnky za kachnou (V)
      if (!reflecting) {
        const k = (T * 1.5 + a.ph) % 1;
        g.fillStyle = `rgba(198,240,238,${0.55 * (1 - k)})`;
        for (let i = 1; i <= 3; i++) {
          const bx = a.x - a.face * (2 + i * 1.5 + k * 2);
          g.fillRect(snap(bx), snap(a.y + 0.5 + i * 0.5), F * 2, F);
          g.fillRect(snap(bx), snap(a.y - 0.5 - i * 0.3), F * 2, F);
        }
      }
      blit(g, s, a, -s.w / 2, -s.h + 1.5 + Math.round(Math.sin(T * 2 + a.ph)) * F, right);
    } else if (a.type === "deer") {
      if (!reflecting) shadow(g, a.x, a.y, 6.5);
      const moving = a.st === "walk" || a.st === "flee";
      const f = moving ? Math.floor((a.walk || 0) / (a.st === "flee" ? 2.2 : 1.4)) & 3 : 0;
      const s = deerSprite(f, a.st === "graze" && Math.sin(T * 0.8 + a.ph) > -0.6, a.buck);
      blit(g, s, a, -s.w / 2, -s.h + 1, right);
    }
  }

  // Vrány, včely a ryby (kreslí se nad scénou před shadery, stín na zemi).
  function drawAir(g, T, visible) {
    for (const a of state.list) {
      if (a.type === "crow") {
        const ang = T * a.sp + a.ph;
        const x = a.x + Math.cos(ang) * a.r;
        const y = a.y + Math.sin(ang) * a.r * 0.45;
        if (!visible(x, y)) continue;
        shadow(g, x + 6, y + 4, 2.6, 0.16);
        const k = Math.floor(T * 7 + a.ph * 3) % 6;
        const glide = Math.sin(ang * 1.7) > 0.2;
        const fr = glide ? "mid" : k < 2 ? "up" : k < 4 ? "mid" : "down";
        const s = rows(`crow|${fr}`, CROW[fr], CROWC);
        const right = -Math.sin(ang) > 0;
        g.drawImage(right ? s.r : s.l, snap(x - s.w / 2), snap(y - a.z - s.h / 2));
      } else if (a.type === "bee") {
        const x = a.x + Math.sin(T * 2.7 + a.ph) * 7 + Math.sin(T * 9 + a.ph * 2) * 1.5;
        const y = a.y + Math.cos(T * 2.1 + a.ph) * 3;
        if (!visible(x, y)) continue;
        g.fillStyle = "#15121f";
        g.fillRect(snap(x), snap(y - 4), F * 2, F);
        g.fillStyle = "#ffbf45";
        g.fillRect(snap(x), snap(y - 4), F, F);
        g.fillStyle = Math.floor(T * 30 + a.ph) & 1 ? "rgba(247,241,223,0.8)" : "rgba(247,241,223,0.3)";
        g.fillRect(snap(x), snap(y - 4.5), F, F);
      } else if (a.type === "fish") {
        // jednou za čas vyskočí: oblouček z bodů a kroužky na hladině
        const per = 7 + hash(a.ph * 10, 1, 2) * 6;
        const k = (T + a.t) % per;
        if (!visible(a.x, a.y)) continue;
        if (k < 0.5) {
          const t = k / 0.5;
          const fx = a.x + (t - 0.5) * 5;
          const fz = Math.sin(t * Math.PI) * 4;
          g.fillStyle = "#c6c7d3";
          g.fillRect(snap(fx), snap(a.y - fz), F * 2, F);
          g.fillStyle = "#767892";
          g.fillRect(snap(fx - F), snap(a.y - fz + F), F, F);
          g.fillStyle = "#e8e6e8";
          g.fillRect(snap(fx + F), snap(a.y - fz - F), F, F);
        }
        if (k < 1.6) {
          const r = 1 + k * 3;
          g.fillStyle = `rgba(198,240,238,${0.6 * (1 - k / 1.6)})`;
          for (let i = 0; i < 18; i++) {
            const an = i / 18 * Math.PI * 2;
            g.fillRect(snap(a.x + Math.cos(an) * r + (k > 0.5 ? 2.5 : -2.5)), snap(a.y + Math.sin(an) * r * 0.4), F, F);
          }
        }
      }
    }
  }

  // Ikona zvířete pro paletu editoru map: { r: plátno s jemným dvojčetem, w, h } (art px).
  const ICON_ROWS = {
    bee: [["..ww..", ".wwww.", "kykyke", ".kyky.", "..k..."], { w: 0xf7f1df, k: C.ink, y: 0xffbf45, e: C.ink }],
    fish: [[".....bb.", "..bbbbcb", "bbbbbbbe", "..cccbb.", ".....cc."], { b: 0x9aa4b8, c: 0x6a7490, e: C.ink }]
  };
  function icon(type) {
    if (type === "rabbit") return rows("rabbit|sit", RABBIT.sit, FUR);
    if (type === "sparrow") return rows("sp|stand", SPARROW.stand, BIRD);
    if (type === "crow") return rows("crow|up", CROW.up, CROWC);
    if (type === "butterfly") return rows("bf|0|open", WINGS.open, BUTTER[0], 0.55);
    if (type === "frog") return rows("frog|sit", FROG.sit, FROGC);
    if (type === "duck") return rows("duck|1|swim", DUCK.swim, DUCKC);
    if (type === "deer") return deerSprite(0, false, true);
    const ir = ICON_ROWS[type];
    return ir ? rows(`icon|${type}`, ir[0], ir[1]) : null;
  }

  PK.critters = { update, collect, draw, drawAir, icon, reset: () => { state.for = null; }, get list() { return state.list; }, rows, deerSprite };
})();
