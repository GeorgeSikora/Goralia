/*
 * Budovy, kreslené procedurálně v jemné mřížce (PK.HD = 2).
 * Strážci: kamenné zdivo, hrázděné omítky, tyrkysové tašky, velká lucerna.
 * Popelavý zástup (Cinder Host): čedič a obsidián, žhnoucí praskliny,
 * lávová záře a štěrbinové žhavé oko.
 *
 * Každý sprite se kreslí do Pix(w * HD, h * HD) a vrací přes PK.fine(P).
 * Metadata (w, h, ax, ay, banners, smoke, flames, glows, hell, fire) jsou
 * v art px, stejně jako dřív, aby na ně game.js navazoval beze změny.
 *
 * Všechny souřadnice uvnitř kreslicích funkcí jsou v JEMNÝCH px.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const { C, TEAM, Pix, mix, hash, bayer, clamp } = PK;
  const HD = PK.HD;

  /* ======================= palety materiálů ======================= */
  // 0 nejhlubší stín, 1 spára / stín, 2 stinná plocha, 3 jádro, 4 světlo, 5 odlesk
  const STONE = [C.s[0], C.s[1], C.s[2], C.s[3], mix(C.s[4], C.d[5], 0.16), mix(C.s[5], C.a[4], 0.24)];
  const WOOD = [C.w[0], C.w[1], C.w[2], C.w[3], C.w[4], mix(C.w[4], C.a[3], 0.35)];
  const PLASTER = [C.d[2], C.d[3], mix(C.d[3], C.d[4], 0.55), C.d[4], mix(C.d[4], C.d[5], 0.6), mix(C.d[5], C.white, 0.35)];
  const TEAL = [C.t[0], C.t[1], C.t[2], C.t[3], C.t[4], mix(C.t[4], C.a[4], 0.35)];
  const SLATE = [C.s[0], C.s[1], mix(C.s[1], C.s[2], 0.5), C.s[2], mix(C.s[3], C.t[2], 0.25), mix(C.s[4], C.t[3], 0.2)];
  const THATCH = [C.w[1], C.d[1], C.d[2], C.d[3], C.d[4], mix(C.d[5], C.a[4], 0.3)];
  const IRON = [C.s[0], C.s[1], C.s[2], C.s[3], C.s[5], C.s[6]];
  const BAS = [mix(C.b[0], C.m[0], 0.12), C.b[1], C.b[2], C.b[3], C.b[4], mix(C.b[4], C.bone[1], 0.4)];
  const OBS = [mix(C.b[0], C.m[0], 0.3), mix(C.b[1], C.m[0], 0.35), mix(C.b[2], C.m[0], 0.4), mix(C.b[3], C.m[1], 0.28), mix(C.b[4], C.m[1], 0.35), mix(C.b[4], C.m[2], 0.55)];
  const ASH = [C.h[0], C.h[1], C.h[2], C.h[3], C.h[4], C.h[5]];
  const BONE = [C.bone[2], C.bone[1], C.bone[0], mix(C.bone[0], C.white, 0.55)];
  const EMB = [C.r[0], C.r[1], C.r[2], C.r[3], C.r[4], C.r[5]];
  const RUST = [C.r[0], mix(C.w[1], C.r[1], 0.5), mix(C.w[2], C.r[2], 0.35), mix(C.s[2], C.d[2], 0.5), mix(C.s[3], C.d[3], 0.45), mix(C.s[4], C.d[4], 0.4)];

  // žhavý přechod (brány, výheň): t 0 = tmavě rudá ... 1 = bílý žár, bayer mezi stupni
  const EMBG = [C.r[0], C.r[1], C.r[2], C.r[3], C.r[4], C.r[5]];
  const emberAt = (t, x, y) => {
    const v = clamp(t, 0, 1) * (EMBG.length - 1);
    const b = Math.floor(v);
    return EMBG[Math.min(EMBG.length - 1, b + (v - b > bayer(x, y) ? 1 : 0))];
  };
  const pick = (ramp, t) => ramp[clamp(Math.round(t), 0, ramp.length - 1)];
  const dusk = (c, t) => mix(c, C.dusk, t);
  const ZERO = () => 0;

  /* ======================= pomocníci ======================= */

  // Maska z polygonu (nebo libovolného kreslení) pro textury nepravidelných ploch.
  function maskOf(P, draw) {
    const M = new Pix(P.w, P.h);
    draw(M);
    return (x, y) => M.alpha(x, y) > 0;
  }

  // Ztmavení existujících pixelů k fialovému stínu (vržené stíny pod římsami).
  function shadow(P, x0, y0, x1, y1, t, mask) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (mask && !mask(x, y)) continue;
        const c = P.get(x, y);
        if (c >= 0) P.set(x, y, dusk(c, typeof t === "function" ? t(x, y) : t));
      }
    }
  }

  // Měkká záře na povrchu (odlesk lucerny, žár brány): dvě úrovně s bayer přechodem.
  function spill(P, cx, cy, rx, ry, col, amt = 1, mask) {
    const x0 = Math.floor(cx - rx);
    const y0 = Math.floor(cy - ry);
    for (let y = y0; y <= cy + ry; y++) {
      for (let x = x0; x <= cx + rx; x++) {
        if (mask && !mask(x, y)) continue;
        const c = P.get(x, y);
        if (c < 0) continue;
        const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
        if (d >= 1) continue;
        // jemné kroky po 0.09: sousední body se liší jen málo, žádná šachovnice
        const s = (1 - d) * (1 - d) * amt * 5;
        const lv = Math.floor(s + bayer(x, y) * 0.999);
        if (lv > 0) P.set(x, y, mix(c, col, Math.min(5, lv) * 0.09));
      }
    }
  }

  /*
   * Kamenné zdivo: řádky kvádrů různé šířky, 1 px spára, každý kvádr má
   * světlou horní a levou hranu a stinnou spodní a pravou, občas odštěpek.
   * face(x, y) posouvá tón (+ osvětlená plocha, - odvrácená strana).
   */
  function masonry(P, x0, y0, x1, y1, o = {}) {
    const ramp = o.ramp || STONE;
    const bh = o.bh || 5;
    const wmin = o.wmin || 7;
    const wmax = o.wmax || 12;
    const seed = o.seed || 1;
    const base = o.base != null ? o.base : 3;
    const face = o.face || ZERO;
    const mask = o.mask;
    const rows = [];

    for (let r = 0; r * bh < y1 - y0 + bh; r++) {
      const arr = [];
      let x = x0 - Math.floor(hash(r, 7, seed) * wmax) - 1;
      let k = 0;
      while (x < x1) {
        const w = wmin + Math.floor(hash(k, r, seed) * (wmax - wmin + 1));
        arr.push([x, w, k]);
        x += w;
        k++;
      }
      rows.push(arr);
    }

    for (let y = y0; y < y1; y++) {
      const r = Math.floor((y - y0) / bh);
      const ly = y - y0 - r * bh;
      const row = rows[r];
      let bi = 0;

      for (let x = x0; x < x1; x++) {
        while (bi < row.length - 1 && x >= row[bi][0] + row[bi][1]) bi++;
        if (mask && !mask(x, y)) continue;
        const [bx, bw, k] = row[bi];
        const lx = x - bx;
        const f = face(x, y);
        let c;

        if (ly === bh - 1 || lx === bw - 1) {
          c = ramp[f < -0.5 ? 0 : 1];
        } else {
          const hb = hash(k, r, seed + 3);
          let t = base + (hb - 0.5) * 1.3 + f;
          if (ly === 0 || lx === 0) t += 1;
          else if (ly === bh - 2 || lx === bw - 2) t -= 0.6;
          if (ly === 0 && lx === 0 && f >= 0) t += 0.6;
          if (ly > 0 && lx > 0 && hash(x, y, seed + 9) < 0.03) t -= 1.2;
          c = pick(ramp, clamp(t, 1, ramp.length - 1));
        }

        if (o.moss) {
          const m = o.moss(x, y);
          if (m > 0 && hash(x, y, seed + 11) < m && (ly <= 1 || lx <= 1 || ly === bh - 1)) {
            c = hash(x, y, seed + 12) > 0.55 ? C.g[3] : hash(x, y, seed + 13) > 0.3 ? C.g[2] : C.g[4];
          }
        }

        P.set(x, y, c);
      }
    }
  }

  /*
   * Prkna: 1 px tmavá spára mezi prkny, světlá levá hrana, 1-2 léta dřeva
   * s přerušením, sem tam suk a příčný spoj. horiz = prkna vodorovně.
   */
  function planks(P, x0, y0, x1, y1, o = {}) {
    const ramp = o.ramp || WOOD;
    const pw = o.pw || 5;
    const seed = o.seed || 2;
    const base = o.base != null ? o.base : 2.5;
    const face = o.face || ZERO;
    const mask = o.mask;

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (mask && !mask(x, y)) continue;
        const u = o.horiz ? y - y0 : x - x0;
        const v = o.horiz ? x - x0 : y - y0;
        const k = Math.floor(u / pw);
        const lu = u - k * pw;
        const L = 16 + Math.floor(hash(k, 1, seed) * 18);
        const vv = v + Math.floor(hash(k, 2, seed) * L);
        const s = Math.floor(vv / L);
        const lv = vv - s * L;
        const hb = hash(k, s, seed + 5);
        const f = face(x, y);
        let t = base + (hb - 0.5) * 1.1 + f;

        if (lu === pw - 1) t = 0.6 + f * 0.5;
        else if (lv === 0 && !o.noJoints) t = 0.8 + f * 0.5;
        else {
          if (lu === 0) t += 0.9;
          const g = 1 + Math.floor(hash(k, s, seed + 1) * Math.max(1, pw - 2));
          if (lu === g && hash(k, Math.floor(vv / 4), seed + 2) > 0.38) t -= 0.8;
          if (hash(k, s, seed + 4) > 0.72) {
            const kv = 3 + Math.floor(hash(k, s, seed + 6) * (L - 6));
            const ku = 1 + Math.floor(hash(k, s, seed + 7) * Math.max(1, pw - 2));
            if (lu === ku && (lv === kv || lv === kv + 1)) t = 0.7 + f * 0.4;
            else if (lu === ku && lv === kv - 1) t += 0.8;
          }
          if (lv === 1 && !o.noJoints) t += 0.6;
        }

        P.set(x, y, pick(ramp, clamp(t, 0, ramp.length - 1)));
      }
    }
  }

  /*
   * Střešní tašky / šindele: odsazené řady, každá taška má světlý horní okraj,
   * tmavý spodní okraj (stín další řady) a zaoblené rohy. Vyplní polygon.
   */
  function tiles(P, pts, o = {}) {
    const ramp = o.ramp || TEAL;
    const th = o.th || 4;
    const tw = o.tw || 6;
    const y0 = o.y0 || 0;
    const seed = o.seed || 3;
    const face = o.face || ZERO;
    const base = o.base != null ? o.base : 2.6;

    P.poly(pts, (x, y) => {
      const r = Math.floor((y - y0) / th);
      const ly = y - y0 - r * th;
      const off = (r & 1) * (tw >> 1) + Math.floor(hash(r, 3, seed) * 2);
      const k = Math.floor((x + off) / tw);
      const lx = x + off - k * tw;
      const hb = hash(k, r, seed);
      const f = face(x, y);
      let t = base + (hb - 0.5) * 1.1 + f;

      // řada tašek: nahoře stín od řady nad ní, dole světlý okraj a 1 px stínová linka
      if (ly === th - 1) t = 0.4 + f * 0.4;
      else if (ly === th - 2 && (lx === 0 || lx === tw - 1)) t = 1 + f * 0.5;
      else if (lx === tw - 1) t -= 1.1;
      else if (ly === 0) t -= 0.8;
      else if (ly === th - 2) t += 1;
      else if (lx === 0) t += 0.4;
      if (o.moss && ly <= 1 && hash(x, y, seed + 9) < o.moss(x, y)) {
        return hash(x, y, seed + 8) > 0.5 ? C.g[3] : C.g[2];
      }

      return pick(ramp, clamp(t, 0, ramp.length - 1));
    });
  }

  /* Došková střecha: svislá stébla ve vrstvách, spodní hrana každé vrstvy stínem. */
  function thatch(P, pts, o = {}) {
    const ramp = o.ramp || THATCH;
    const lh = o.lh || 6;
    const seed = o.seed || 4;
    const face = o.face || ZERO;

    P.poly(pts, (x, y) => {
      const r = Math.floor(y / lh);
      const ly = y - r * lh + Math.floor(hash(x, r, seed) * 2);
      const f = face(x, y);
      let t = 3 + f + (hash(x, r, seed + 1) - 0.5) * 1.2;
      if (ly >= lh) t = 1.2 + f * 0.5;
      else if (ly === lh - 1) t -= 1.2;
      else if (ly <= 1) t += 0.6;
      if ((x + r * 3) % 3 === 0) t -= 0.5;
      if (hash(x, y, seed + 2) > 0.94) t += 1;
      return pick(ramp, clamp(t, 0, ramp.length - 1));
    });
  }

  /* Hladká omítka: velmi jemný bayer přechod, vlasové praskliny, místy opadaná na cihlu. */
  function plaster(P, x0, y0, x1, y1, o = {}) {
    const seed = o.seed || 6;
    const face = o.face || ZERO;

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const n = PK.fbm(x / 9, y / 7, seed, 2);
        let t = 3.3 + face(x, y) + (n - 0.5) * 1.4 - (y - y0) / (y1 - y0) * 0.5;
        const b = Math.floor(t);
        t = b + (t - b > 0.35 + bayer(x, y) * 0.3 ? 1 : 0);
        P.set(x, y, pick(PLASTER, t));
      }
    }

    // opadané místo s cihlou
    for (let i = 0; i < (o.chips || 2); i++) {
      const cx = x0 + 4 + Math.floor(hash(i, 1, seed) * (x1 - x0 - 12));
      const cy = y0 + 6 + Math.floor(hash(i, 2, seed) * (y1 - y0 - 12));
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 8; x++) {
          if (Math.hypot((x - 3.5) / 4, (y - 2) / 2.6) > 1) continue;
          const brick = (y + cy) % 3 === 2 || (x + (((y + cy) / 3 | 0) & 1) * 2 + cx) % 5 === 4;
          P.set(cx + x, cy + y, brick ? PLASTER[1] : y === 0 ? PLASTER[0] : mix(C.r[2], C.d[2], 0.5));
        }
      }
    }

    // vlasové praskliny
    for (let i = 0; i < (o.cracks || 2); i++) {
      let x = x0 + 3 + Math.floor(hash(i, 3, seed) * (x1 - x0 - 6));
      let y = y0 + 2 + Math.floor(hash(i, 4, seed) * (y1 - y0 - 8));
      for (let k = 0; k < 6; k++) {
        const c = P.get(x, y);
        if (c >= 0) P.set(x, y, PLASTER[1]);
        y++;
        x += hash(i, k, seed + 5) > 0.6 ? 1 : hash(i, k, seed + 5) < 0.25 ? -1 : 0;
      }
    }
  }

  /* Trám (nosník) jako jedno prkno se světlou hranou. */
  function beam(P, x, y, w, h, o = {}) {
    planks(P, x, y, x + w, y + h, { pw: o.horiz ? h : w, horiz: o.horiz, seed: o.seed || x * 7 + y, noJoints: true, base: o.base, face: o.face });
  }

  /* Šikmá vzpěra 3 px: světlý horní pruh, jádro, stín. */
  function brace(P, xa, ya, xb, yb) {
    P.line(xa, ya + 1, xb, yb + 1, WOOD[1]);
    P.line(xa, ya, xb, yb, WOOD[2]);
    P.line(xa, ya - 1, xb, yb - 1, WOOD[3]);
  }

  /*
   * Okno s jantarovým světlem: rám, příčle 1 px (svislá i vodorovná) přes
   * celou výšku/šířku skla, světlý roh tabulky, parapet a nadpraží.
   */
  function windowLit(P, x, y, w, h, o = {}) {
    const arch = o.arch ? Math.floor(w / 2) : 0;
    const inside = (xx, yy) => {
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) return false;
      if (arch && yy < arch) {
        const d = Math.hypot(xx + 0.5 - w / 2, yy + 0.5 - arch);
        return d <= arch;
      }
      return true;
    };
    const frame = o.frame || WOOD;
    const vb = o.vbar != null ? o.vbar : (w >= 7 ? Math.floor(w / 2) : -1);
    const hb = o.hbar != null ? o.hbar : (h >= 8 ? Math.floor(h / 2) + (arch ? 1 : 0) : -1);

    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        if (!inside(xx, yy)) continue;
        const edge = !inside(xx - 1, yy) || !inside(xx + 1, yy) || !inside(xx, yy - 1) || !inside(xx, yy + 1);
        let c;
        if (edge) {
          c = !inside(xx, yy + 1) || !inside(xx + 1, yy) ? frame[1] : frame[3];
        } else if (xx === vb || yy === hb) {
          c = frame[1];
        } else {
          const t = (yy - 1) / Math.max(1, h - 3);
          c = t < 0.2 ? C.a[4] : t < 0.55 ? C.a[3] : t < 0.85 ? C.a[2] : C.a[1];
          // stín příčle na skle a odlesk v rohu tabulky
          if (xx === vb + 1 || yy === hb + 1) c = mix(c, C.a[1], 0.45);
          const px = xx === 1 || xx === vb + 1;
          const py = yy === 1 + (arch ? arch - 1 : 0) || yy === hb + 1;
          if (px && py && yy !== hb + 1) c = C.a[4];
        }
        P.set(x + xx, y + yy, c);
      }
    }

    if (o.sill !== false) {
      const sr = o.sillRamp || STONE;
      P.rect(x - 1, y + h, w + 2, 1, sr[5]);
      P.rect(x - 1, y + h + 1, w + 2, 1, sr[2]);
    }
  }

  /* Okenice v barvě týmu: dvě prkna s pantem. */
  function shutter(P, x, y, h, T, right) {
    for (let yy = 0; yy < h; yy++) {
      P.set(x, y + yy, right ? T.s : T.l);
      P.set(x + 1, y + yy, T.m);
      P.set(x + 2, y + yy, yy % 4 === 3 ? T.d : right ? T.s : T.m);
    }
    P.rect(x, y + 2, 3, 1, IRON[1]);
    P.rect(x, y + h - 3, 3, 1, IRON[1]);
  }

  /*
   * Dveře z prken s kovanými pásy, nýty a kruhem. arch = půlkruhový vršek,
   * split = dvoukřídlé s prosvítající spárou.
   */
  function door(P, x, y, w, h, o = {}) {
    const r = o.arch ? w / 2 : 0;
    const inside = (xx, yy) => {
      if (yy < y || yy >= y + h || xx < x || xx >= x + w) return false;
      if (r && yy < y + r) return Math.hypot(xx + 0.5 - (x + w / 2), yy + 0.5 - (y + r)) <= r;
      return true;
    };
    planks(P, x, y, x + w, y + h, {
      pw: o.pw || 4, seed: o.seed || 31, mask: inside, ramp: o.ramp || WOOD, base: o.base != null ? o.base : 2.2,
      face: (xx, yy) => (yy < y + 3 ? -0.8 : 0) + (xx >= x + w - 2 ? -0.5 : 0)
    });

    const iron = o.iron || IRON;
    for (const sy of o.straps || [Math.round(y + h * 0.32), Math.round(y + h * 0.72)]) {
      for (let xx = x; xx < x + w; xx++) {
        if (!inside(xx, sy)) continue;
        P.set(xx, sy, (xx - x) % 4 === 1 ? iron[5] : iron[3]);
        P.set(xx, sy + 1, iron[1]);
      }
    }

    if (o.split) {
      const cx = x + Math.floor(w / 2);
      for (let yy = y; yy < y + h; yy++) {
        if (!inside(cx, yy)) continue;
        P.set(cx - 1, yy, WOOD[0]);
        P.set(cx, yy, o.lit ? (yy > y + h * 0.5 ? C.a[3] : C.a[2]) : WOOD[0]);
      }
      if (o.lit) P.set(cx, y + h - 1, C.a[4]);
      for (const hx of [cx - 3, cx + 2]) {
        const hy = Math.round(y + h * 0.52);
        P.set(hx, hy, C.gold[1]);
        P.set(hx + 1, hy, C.gold[0]);
        P.set(hx, hy + 1, C.gold[0]);
        P.set(hx + 1, hy + 2, C.gold[0]);
        P.set(hx, hy + 2, C.gold[0]);
      }
    } else {
      const hx = x + w - 4;
      const hy = Math.round(y + h * 0.5);
      P.set(hx, hy, iron[4]);
      P.set(hx + 1, hy + 1, iron[2]);
      P.set(hx - 1, hy + 1, iron[3]);
      P.set(hx, hy + 2, iron[2]);
    }
  }

  /* Kamenný oblouk (voussoirs) kolem otvoru s půlkruhovým vrškem. */
  function archFrame(P, cx, cy, r, th, ramp, seed, keystone = true) {
    const R = r + th;
    for (let y = Math.floor(cy - R); y <= cy; y++) {
      for (let x = Math.floor(cx - R); x <= cx + R; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d < r || d > R) continue;
        const a = Math.atan2(y + 0.5 - cy, x + 0.5 - cx);
        const seg = Math.floor((a + Math.PI) / (Math.PI / 7));
        const la = (a + Math.PI) / (Math.PI / 7) - seg;
        let t = 3 + (hash(seg, 1, seed) - 0.5) + (x < cx ? 0.4 : -0.5);
        if (la < 0.12) t = 1;
        else if (d > R - 1) t += 1;
        else if (d < r + 1) t -= 1;
        if (keystone && seg === 3 && la > 0.12) t += 1;
        P.set(x, y, pick(ramp, clamp(t, 1, ramp.length - 1)));
      }
    }
  }

  /* Zlomený kruh (motiv Strážců): mezera nahoře vpravo, stín o 1 px vpravo dolů. */
  function brokenRing(P, cx, cy, r, c, cs, th = 1.6) {
    const draw = (ox, oy, col) => {
      for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
        for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
          const dx = x + 0.5 - cx;
          const dy = y + 0.5 - cy;
          const d = Math.hypot(dx, dy);
          if (d > r || d < r - th) continue;
          const a = Math.atan2(dy, dx);
          if (Math.abs(a + Math.PI / 4) < 0.55) continue;
          P.set(x + ox, y + oy, col);
        }
      }
    };
    if (cs != null) draw(1, 1, cs);
    draw(0, 0, c);
  }

  /* Štěrbinové žhavé oko Popelavého zástupu: mandle, svislá zornice, víčka. */
  function emberEye(P, cx, cy, rx, ry, lid = OBS) {
    const inLens = (x, y) => {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const lim = 1 - nx * nx;
      return lim > 0 && Math.abs(ny) <= lim;
    };
    // víčka: o 1-2 px větší čočka
    for (let y = Math.floor(cy - ry - 3); y <= cy + ry + 3; y++) {
      for (let x = Math.floor(cx - rx - 3); x <= cx + rx + 3; x++) {
        const nx = (x + 0.5 - cx) / (rx + 2);
        const ny = (y + 0.5 - cy) / (ry + 2.4);
        const lim = 1 - nx * nx;
        if (lim > 0 && Math.abs(ny) <= lim) P.set(x, y, y < cy ? lid[2] : lid[1]);
      }
    }
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        if (!inLens(x, y)) continue;
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const t = Math.hypot(dx / rx, dy / ry);
        let c = t < 0.35 ? C.r[5] : t < 0.6 ? C.r[4] : t < 0.85 ? C.r[3] : C.r[2];
        if (!inLens(x, y - 1)) c = C.r[1];          // stín horního víčka
        else if (!inLens(x, y - 2)) c = mix(c, C.r[1], 0.5);
        const pw = Math.abs(dy) < ry * 0.45 ? 1.1 : 0.6;
        if (Math.abs(dx) < pw) c = OBS[0];
        else if (Math.abs(dx) < pw + 1 && t < 0.8) c = mix(C.r[5], C.white, 0.3);
        P.set(x, y, c);
      }
    }
    P.set(Math.round(cx - rx * 0.45), Math.round(cy - ry * 0.25), mix(C.r[5], C.white, 0.6));
    // spodní víčko: 1 px světlejší okraj pod okem
    for (let x = Math.floor(cx - rx * 0.6); x <= cx + rx * 0.6; x++) {
      let y = Math.ceil(cy + ry);
      while (y > cy && !inLens(x, y)) y--;
      P.set(x, y + 1, lid[3]);
    }
  }

  /* Lebka 6x6 jemných px; žhavé = rudě svítící důlky. */
  const SKULL = [
    ".hBBb.",
    "hBBBBb",
    "BkBBkb",
    "BkBBkb",
    ".BBnb.",
    ".t.t.."
  ];

  function skull(P, x, y, hot = true) {
    const L = { h: BONE[3], B: BONE[2], b: BONE[1], n: BONE[0], t: BONE[1], k: hot ? C.r[3] : OBS[0] };
    SKULL.forEach((row, yy) => {
      for (let xx = 0; xx < row.length; xx++) if (row[xx] !== ".") P.set(x + xx, y + yy, L[row[xx]]);
    });
  }

  /*
   * Žhnoucí praskliny v čediči: náhodné svislé chodníčky jen po existujících
   * pixelech, jádro r3/r4 a kolem 1 px rudý nádech.
   */
  function cracks(P, x0, y0, x1, y1, n, seed, len = 10) {
    const hot = new Set();
    for (let i = 0; i < n; i++) {
      let x = x0 + Math.floor(hash(i, 1, seed) * (x1 - x0));
      let y = y0 + Math.floor((0.25 + 0.75 * hash(i, 2, seed)) * (y1 - y0));
      const L = Math.floor(len * (0.5 + hash(i, 3, seed)));
      for (let k = 0; k < L; k++) {
        if (P.get(x, y) < 0) break;
        const hc = k === 0 || k === L - 1 ? C.r[2] : hash(i, k, seed + 1) > 0.7 ? C.r[4] : C.r[3];
        P.set(x, y, hc);
        hot.add(y * P.w + x);
        // rozeklaná čára směrem dolů (k zemi, odkud prosvítá žár)
        const h = hash(i, k, seed + 2);
        y++;
        if (h < 0.22) x--;
        else if (h > 0.78) x++;
      }
    }
    for (const i of hot) {
      const x = i % P.w;
      const y = (i / P.w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = (y + dy) * P.w + x + dx;
        if (hot.has(j)) continue;
        const c = P.get(x + dx, y + dy);
        if (c >= 0) P.set(x + dx, y + dy, mix(c, C.r[1], 0.4));
      }
    }
  }

  /* Ohňová pánev: miska s okrajem, noha; vršek misky = flames bod + 1 art px. */
  function brazier(P, cx, top, legH, ramp = BAS) {
    // cx v jemných px (střed), top = horní hrana misky
    P.rect(cx - 1, top + 4, 2, legH, ramp[1]);
    P.set(cx - 1, top + 4, ramp[3]);
    P.rect(cx - 3, top + 3 + legH, 6, 1, ramp[2]);
    P.poly([[cx - 6, top + 1], [cx + 6, top + 1], [cx + 3, top + 5], [cx - 3, top + 5]], (x, y) =>
      y === top + 1 ? ramp[4] : x < cx - 2 ? ramp[3] : x > cx + 1 ? ramp[1] : ramp[2]);
    P.rect(cx - 5, top, 10, 1, C.r[4]);
    P.rect(cx - 4, top, 8, 1, C.r[5]);
    P.set(cx - 6, top + 1, ramp[5]);
  }

  /* Malý trojúhelníkový/šikmý polygon se stínováním (štíty, rohy, trny). */
  function spike(P, xa, xb, yb, xt, yt, ramp) {
    const mid = (xa + xb) / 2;
    P.poly([[xa, yb], [xb, yb], [xt, yt]], (x, y) => {
      const lx = xt + (x + 0.5 - xt);
      const left = lx < xt + (mid - xt) * ((y - yt) / Math.max(1, yb - yt)) + 0.5;
      return left ? ramp[ramp.length - 2] : ramp[1];
    });
    P.set(Math.round(xt), Math.round(yt), ramp[ramp.length - 1]);
  }

  /* Visící držák na prapor (dvě železné skoby) v místě banners bodu. */
  function bannerHooks(P, bx, by) {
    // bx, by v art px -> tyč praporu leží na jemném řádku by*2
    const x = bx * HD;
    const y = by * HD;
    for (const hx of [x + 1, x + 16]) {
      P.set(hx, y - 2, IRON[1]);
      P.set(hx, y - 1, IRON[3]);
      P.set(hx + 1, y - 1, IRON[1]);
    }
  }

  /* Hmotový stín celé pravé strany sprite (odvrácená strana). */
  function sideShade(P, xFrom, t) {
    shadow(P, xFrom, 0, P.w, P.h, t);
  }

  /* ======================= Radnice (Lanternhall) ======================= */
  function hall(team = "blue") {
    const W = 72;
    const H = 64;
    const P = new Pix(W * HD, H * HD);
    const T = TEAM[team];

    // --- plint z velkých kvádrů
    masonry(P, 10, 104, 134, 125, {
      seed: 5, bh: 6, wmin: 9, wmax: 15,
      face: (x, y) => (x > 126 ? -1 : 0) + (y > 118 ? -0.4 : 0),
      moss: (x, y) => (y > 116 ? 0.22 : 0.03)
    });
    P.rect(8, 102, 128, 1, STONE[5]);
    P.rect(8, 103, 128, 1, STONE[4]);
    P.rect(8, 104, 128, 1, STONE[1]);
    for (let x = 18; x < 134; x += 15) P.set(x, 103, STONE[2]);

    // --- hrázděná omítka
    plaster(P, 16, 70, 128, 102, { seed: 7, chips: 3, cracks: 3, face: (x) => (x > 120 ? -1 : x < 30 ? 0.3 : 0) });
    for (const px of [16, 40, 98, 124]) beam(P, px, 70, 4, 32, { seed: px });
    beam(P, 16, 98, 112, 4, { horiz: true, seed: 4 });
    brace(P, 44, 97, 54, 86);
    brace(P, 90, 86, 100, 97);

    // --- okna s okenicemi (střed 32 a 114 = záře v art 16 / 57)
    windowLit(P, 27, 84, 11, 12, { sill: false });
    windowLit(P, 109, 84, 11, 12, { sill: false });
    shutter(P, 23, 84, 12, T, false);
    shutter(P, 120, 84, 12, T, true);
    // truhlíky s květy pod okny
    for (const wx of [26, 108]) {
      beam(P, wx, 96, 13, 3, { horiz: true, seed: wx });
      for (let i = 0; i < 6; i++) {
        const fx = wx + 1 + i * 2;
        P.set(fx, 95, i & 1 ? C.g[4] : C.g[3]);
        P.set(fx + 1, 95, C.g[2]);
        if (i % 2 === 0) P.set(fx + 1, 94, i % 4 ? C.cap[2] : C.a[3]);
      }
    }

    // --- valbová střecha
    const lh = (x, y) => x < 34 + (y - 36) * (24 - 34) / 42;
    const rh = (x, y) => x > 110 + (y - 36) * (120 - 110) / 42;
    tiles(P, [[4, 79], [140, 79], [110, 36], [34, 36]], {
      ramp: TEAL, th: 4, tw: 7, y0: 36, seed: 9,
      face: (x, y) => (lh(x, y) ? 0.7 : rh(x, y) ? -1.2 : (x - 72) / 160 * -1) + (y < 44 ? 0.3 : 0),
      moss: (x, y) => (y > 66 ? 0.05 : 0)
    });
    // nárožní hřebeny
    P.line(34, 36, 24, 78, TEAL[5]);
    P.line(35, 36, 25, 78, TEAL[3]);
    P.line(110, 36, 120, 78, TEAL[2]);
    P.line(111, 36, 121, 78, TEAL[0]);
    // hřeben
    for (let x = 34; x < 111; x++) {
      P.set(x, 34, (x % 6) === 0 ? TEAL[3] : TEAL[5]);
      P.set(x, 35, TEAL[3]);
      P.set(x, 36, TEAL[1]);
    }
    // okap: dřevěná deska a stín pod ní
    beam(P, 3, 78, 138, 3, { horiz: true, seed: 12 });
    P.rect(3, 81, 138, 1, WOOD[0]);
    shadow(P, 8, 82, 136, 85, (x, y) => (y === 82 ? 0.5 : y === 83 ? 0.35 : 0.2));

    // --- vikýře
    for (const dx of [38, 92]) {
      plaster(P, dx + 1, 56, dx + 15, 70, { seed: dx, chips: 0, cracks: 0 });
      beam(P, dx, 56, 2, 14, { seed: dx + 1 });
      beam(P, dx + 14, 56, 2, 14, { seed: dx + 2, face: () => -0.8 });
      windowLit(P, dx + 4, 59, 8, 9, { sill: false, hbar: 4 });
      tiles(P, [[dx - 3, 57], [dx + 19, 57], [dx + 8, 45]], {
        ramp: TEAL, th: 3, tw: 5, y0: 45, seed: dx,
        face: (x) => (x > dx + 8 ? -1 : 0.4)
      });
      P.line(dx - 3, 56, dx + 8, 45, TEAL[5]);
      P.line(dx + 8, 45, dx + 19, 56, TEAL[1]);
      P.rect(dx - 2, 57, 20, 1, WOOD[3]);
      P.rect(dx - 2, 58, 20, 1, WOOD[1]);
      shadow(P, dx + 1, 59, dx + 15, 60, 0.4);
      shadow(P, dx + 16, 59, dx + 20, 71, 0.4);
    }

    // --- komín
    masonry(P, 114, 42, 124, 66, { seed: 13, bh: 4, wmin: 4, wmax: 7, face: (x) => (x > 120 ? -1 : 0.3) });
    P.rect(112, 39, 14, 2, STONE[5]);
    P.rect(112, 41, 14, 1, STONE[1]);
    P.rect(115, 38, 8, 1, STONE[0]);
    P.rect(113, 66, 12, 1, IRON[3]);
    P.rect(113, 67, 12, 1, IRON[1]);
    shadow(P, 124, 44, 130, 76, 0.35, (x, y) => P.get(x, y) >= 0 && y < 78);

    // --- středová věž
    masonry(P, 56, 60, 88, 104, {
      seed: 21, bh: 5, wmin: 6, wmax: 11,
      face: (x) => (x >= 84 ? -1.1 : x < 59 ? 0.5 : 0),
      moss: (x, y) => (y > 96 ? 0.12 : 0)
    });
    shadow(P, 88, 60, 96, 102, 0.4, (x, y) => y > 60 && y < 78);
    // římsa
    P.rect(53, 56, 38, 1, STONE[5]);
    P.rect(53, 57, 38, 2, STONE[4]);
    P.rect(87, 57, 4, 2, STONE[2]);
    P.rect(53, 59, 38, 1, STONE[1]);
    shadow(P, 56, 60, 88, 62, 0.4);
    // vytesaný zlomený kruh nad dveřmi
    brokenRing(P, 72, 68, 4.5, C.a[2], STONE[1], 1.6);

    // --- lucernová komora
    for (const px of [58, 70, 82]) {
      masonry(P, px, 36, px + 4, 56, { seed: px, bh: 4, wmin: 4, wmax: 4, face: () => (px === 82 ? -0.8 : 0.2) });
    }
    for (const gx of [62, 74]) {
      windowLit(P, gx, 37, 8, 18, { sill: false, vbar: 4, hbar: 8, frame: IRON });
      P.rect(gx, 45, 8, 1, C.gold[0]);
      P.set(gx + 1, 40, C.white);
    }
    P.rect(57, 54, 30, 1, STONE[5]);
    P.rect(57, 55, 30, 1, STONE[2]);

    // --- kuželová střecha a koule
    tiles(P, [[50, 38], [94, 38], [72, 11]], {
      ramp: TEAL, th: 3, tw: 5, y0: 11, seed: 17,
      face: (x) => (x > 75 ? -1.1 : x < 64 ? 0.5 : 0)
    });
    P.line(72, 11, 50, 38, TEAL[5]);
    P.rect(49, 37, 46, 1, TEAL[5]);
    P.rect(49, 38, 46, 1, TEAL[1]);
    P.rect(71, 8, 2, 4, C.gold[0]);
    P.set(71, 8, C.gold[2]);
    P.disc(72, 5.5, 4.4, 4.4, (x, y) => {
      const d = Math.hypot(x + 0.5 - 70.5, y + 0.5 - 4);
      return d < 1.6 ? C.a[4] : d < 3.4 ? C.a[3] : d < 5 ? C.a[2] : C.a[1];
    });
    P.set(70, 3, C.white);
    brokenRing(P, 72, 5.5, 6.6, C.gold[1], null, 1);

    // --- dveře v kamenném oblouku
    masonry(P, 60, 78, 84, 104, { seed: 27, bh: 5, wmin: 5, wmax: 8, face: (x) => (x > 81 ? -0.8 : 0.3) });
    archFrame(P, 72, 87, 9, 4, STONE, 4);
    door(P, 63, 78, 18, 26, { arch: true, split: true, lit: true, seed: 41 });
    shadow(P, 63, 78, 81, 81, 0.35, (x, y) => P.get(x, y) >= 0 && x > 62 && Math.hypot(x + 0.5 - 72, y + 0.5 - 87) <= 9);

    // --- schody
    const step = (x0, x1, y0, h) => {
      masonry(P, x0, y0, x1, y0 + h, { seed: y0, bh: h, wmin: 7, wmax: 12, face: (x) => (x > x1 - 4 ? -0.8 : 0) });
      P.rect(x0, y0, x1 - x0, 1, STONE[5]);
    };
    step(50, 94, 116, 9);
    step(54, 90, 110, 6);
    step(58, 86, 104, 6);
    shadow(P, 58, 110, 86, 111, 0.3);
    shadow(P, 54, 116, 90, 117, 0.3);

    // háčky pro prapory
    bannerHooks(P, 20, 42);
    bannerHooks(P, 46, 42);

    // teplý odlesk oken a dveří na zdi
    spill(P, 32, 90, 14, 12, C.a[2], 0.55);
    spill(P, 114, 90, 14, 12, C.a[2], 0.55);
    spill(P, 72, 104, 13, 8, C.a[2], 0.4);
    spill(P, 72, 46, 22, 14, C.a[2], 0.4);

    P.outline(C.ink, 0.7);

    return {
      c: PK.fine(P), w: W, h: H, ax: 36, ay: 62,
      banners: [[20, 42], [46, 42]],
      smoke: [[58, 18]],
      glows: [
        { x: 16, y: 45, r: 9, a: 0.5, color: C.a[2] },
        { x: 57, y: 45, r: 9, a: 0.5, color: C.a[2] },
        { x: 36, y: 50, r: 14, a: 0.45, color: C.a[2], ground: true },
        { x: 36, y: 3, r: 22, a: 0.6, color: C.a[2], pulse: true }
      ]
    };
  }

  /* ======================= Kasárna ======================= */
  function barracks(team = "blue") {
    const W = 64;
    const H = 54;
    const P = new Pix(W * HD, H * HD);
    const T = TEAM[team];

    masonry(P, 6, 90, 122, 106, {
      seed: 21, bh: 5, wmin: 8, wmax: 14,
      face: (x, y) => (x > 116 ? -1 : 0) + (y > 100 ? -0.3 : 0),
      moss: (x, y) => (y > 98 ? 0.2 : 0.02)
    });
    P.rect(5, 89, 118, 1, STONE[5]);
    P.rect(5, 90, 118, 1, STONE[3]);

    // roubená stěna z vodorovných fošen
    planks(P, 12, 56, 116, 90, { horiz: true, pw: 4, seed: 8, face: (x) => (x > 110 ? -1 : x < 16 ? 0.3 : 0) });
    for (const px of [12, 34, 92, 112]) beam(P, px, 56, 4, 34, { seed: px * 3, face: () => (px === 112 ? -0.6 : 0) });
    beam(P, 12, 86, 104, 4, { horiz: true, seed: 5 });

    // okénko vlevo od dveří
    windowLit(P, 38, 66, 8, 10, { hbar: 4, sillRamp: WOOD });

    // střecha
    const rhip = (x, y) => x > 102 + (y - 22) * (112 - 102) / 36;
    const lhip = (x, y) => x < 26 + (y - 22) * (16 - 26) / 36;
    tiles(P, [[3, 59], [125, 59], [102, 22], [26, 22]], {
      ramp: TEAL, th: 4, tw: 6, y0: 22, seed: 4,
      face: (x, y) => (lhip(x, y) ? 0.7 : rhip(x, y) ? -1.2 : (x - 64) / 140 * -1) + (y < 28 ? 0.3 : 0),
      moss: (x, y) => (y > 50 ? 0.05 : 0)
    });
    P.line(26, 22, 16, 58, TEAL[5]);
    P.line(102, 22, 112, 58, TEAL[0]);
    beam(P, 24, 19, 80, 4, { horiz: true, seed: 33 });
    P.rect(24, 19, 80, 1, WOOD[5]);
    beam(P, 2, 58, 124, 3, { horiz: true, seed: 34 });
    P.rect(2, 61, 124, 1, WOOD[0]);
    shadow(P, 10, 62, 118, 65, (x, y) => (y === 62 ? 0.5 : y === 63 ? 0.35 : 0.2));

    // komín
    masonry(P, 92, 8, 102, 40, { seed: 22, bh: 4, wmin: 4, wmax: 7, face: (x) => (x > 98 ? -1 : 0.3) });
    P.rect(90, 5, 14, 2, STONE[5]);
    P.rect(90, 7, 14, 1, STONE[1]);
    P.rect(93, 4, 8, 1, STONE[0]);
    P.rect(91, 40, 12, 1, IRON[3]);
    P.rect(91, 41, 12, 1, IRON[1]);
    shadow(P, 102, 24, 108, 58, 0.35, (x, y) => P.get(x, y) >= 0);

    // dvoukřídlá vrata v kamenném ostění
    masonry(P, 48, 62, 81, 90, { seed: 23, bh: 5, wmin: 4, wmax: 7, face: (x) => (x > 77 ? -0.8 : 0.3) });
    door(P, 51, 64, 26, 26, { split: true, lit: true, seed: 44, pw: 4, straps: [70, 82] });
    P.rect(48, 62, 33, 2, STONE[5]);
    P.rect(48, 64, 33, 1, STONE[1]);
    shadow(P, 51, 65, 77, 68, 0.35);
    // lucerna nad vraty
    P.rect(63, 60, 2, 2, IRON[1]);

    // štít s erbem napravo od vrat
    P.disc(89, 74, 7.2, 8, (x, y) => {
      const nx = (x + 0.5 - 89) / 7.2;
      const ny = (y + 0.5 - 74) / 8;
      const d = nx * nx + ny * ny;
      if (d > 0.72) return nx + ny < 0 ? C.s[5] : C.s[2];
      return nx + ny < -0.5 ? T.l : nx + ny > 0.45 ? T.s : T.m;
    });
    brokenRing(P, 89, 74, 3.6, T.accent, T.d, 1.4);
    P.set(86, 69, C.white);

    // stojan s kopími
    beam(P, 98, 68, 16, 2, { horiz: true, seed: 71 });
    beam(P, 98, 86, 16, 2, { horiz: true, seed: 72 });
    for (let i = 0; i < 4; i++) {
      const x = 100 + i * 4;
      const tip = 60 + (i % 2) * 3;
      P.line(x, 87, x + (i % 2), tip + 3, WOOD[3]);
      P.line(x + 1, 87, x + 1 + (i % 2), tip + 3, WOOD[1]);
      P.set(x + (i % 2), tip, C.s[6]);
      P.rect(x + (i % 2), tip + 1, 2, 2, C.s[4]);
      P.set(x + 1 + (i % 2), tip + 2, C.s[2]);
    }

    bannerHooks(P, 8, 33);
    spill(P, 64, 82, 18, 10, C.a[2], 0.6);
    spill(P, 42, 72, 8, 8, C.a[2], 0.4);

    P.outline(C.ink, 0.7);

    return {
      c: PK.fine(P), w: W, h: H, ax: 32, ay: 52,
      banners: [[8, 33]],
      smoke: [[48, 2]],
      glows: [
        { x: 32, y: 42, r: 13, a: 0.45, color: C.a[2], ground: true },
        { x: 32, y: 38, r: 8, a: 0.5, color: C.a[2] }
      ]
    };
  }

  /* ======================= Strážní věž ======================= */
  function tower() {
    const W = 32;
    const H = 62;
    const P = new Pix(W * HD, H * HD);

    // skosená pata
    const base = [[10, 121], [54, 121], [50, 68], [14, 68]];
    const bm = maskOf(P, M => M.poly(base, 1));
    masonry(P, 8, 68, 56, 121, {
      seed: 31, bh: 5, wmin: 6, wmax: 10, mask: bm,
      face: (x, y) => (x > 44 + (y - 68) * 0.07 ? -1.1 : x < 18 ? 0.4 : 0),
      moss: (x, y) => (y > 108 ? 0.25 : 0.02)
    });

    // vytesaný kruh a střílny
    brokenRing(P, 32, 76, 4.5, C.a[1], STONE[1], 1.6);
    for (const y of [84, 96]) {
      P.rect(30, y, 4, 9, STONE[1]);
      P.rect(31, y + 1, 2, 7, C.a[2]);
      P.rect(31, y + 1, 2, 2, C.a[3]);
      P.set(31, y + 1, C.a[4]);
      P.rect(29, y + 9, 6, 1, STONE[5]);
    }

    // dveře
    archFrame(P, 32, 111, 7, 3, STONE, 7);
    door(P, 25, 104, 14, 17, { arch: true, seed: 12 });

    // ochoz s krakorci a cimbuřím
    masonry(P, 6, 60, 58, 70, { seed: 33, bh: 5, wmin: 6, wmax: 9, face: (x) => (x > 50 ? -1 : 0.2) });
    P.rect(6, 60, 52, 1, STONE[5]);
    for (let x = 8; x < 56; x += 6) {
      P.rect(x, 70, 4, 2, STONE[3]);
      P.rect(x + 1, 72, 2, 1, STONE[2]);
      P.set(x, 70, STONE[4]);
    }
    shadow(P, 14, 70, 50, 74, (x, y) => (y < 72 ? 0.45 : 0.25), (x, y) => !(P.get(x, y) === STONE[3] || P.get(x, y) === STONE[2] || P.get(x, y) === STONE[4]) || y > 71);
    for (let x = 6; x < 52; x += 10) {
      masonry(P, x, 52, x + 6, 60, { seed: x, bh: 4, wmin: 6, wmax: 6, face: () => (x > 46 ? -1 : 0.3) });
      P.rect(x, 52, 6, 1, STONE[5]);
    }

    // věžička
    masonry(P, 16, 24, 48, 53, { seed: 35, bh: 5, wmin: 6, wmax: 9, face: (x) => (x > 42 ? -1.1 : x < 19 ? 0.4 : 0) });
    windowLit(P, 22, 32, 6, 12, { arch: true, vbar: -1, hbar: 7, sillRamp: STONE });
    windowLit(P, 36, 32, 6, 12, { arch: true, vbar: -1, hbar: 7, sillRamp: STONE });
    shadow(P, 16, 26, 48, 29, (x, y) => (y === 26 ? 0.5 : 0.3));

    // kuželová střecha
    tiles(P, [[11, 27], [53, 27], [32, 4]], {
      ramp: TEAL, th: 3, tw: 5, y0: 4, seed: 14,
      face: (x) => (x > 35 ? -1.1 : x < 24 ? 0.5 : 0)
    });
    P.line(32, 4, 11, 27, TEAL[5]);
    P.rect(10, 26, 44, 1, TEAL[5]);
    P.rect(10, 27, 44, 1, TEAL[0]);
    P.rect(31, 0, 2, 5, C.gold[0]);
    P.set(31, 0, C.a[4]);
    P.set(32, 0, C.a[3]);
    P.set(31, 1, C.gold[2]);

    // visací lucerna na rohu ochozu
    P.rect(52, 62, 5, 1, IRON[1]);
    P.rect(53, 61, 3, 1, IRON[3]);
    P.set(54, 63, IRON[2]);
    P.rect(52, 64, 5, 1, IRON[3]);
    P.rect(51, 65, 7, 1, C.gold[0]);
    P.rect(52, 66, 5, 5, C.a[3]);
    P.rect(53, 67, 3, 3, C.a[4]);
    P.rect(52, 66, 1, 5, C.gold[0]);
    P.rect(56, 66, 1, 5, C.gold[0]);
    P.rect(51, 71, 7, 1, C.gold[0]);
    P.rect(53, 72, 3, 1, IRON[1]);

    spill(P, 32, 92, 10, 14, C.a[2], 0.45);
    spill(P, 54, 68, 10, 10, C.a[2], 0.5);
    spill(P, 32, 38, 14, 10, C.a[2], 0.35);

    P.outline(C.ink, 0.7);

    return {
      c: PK.fine(P), w: W, h: H, ax: 16, ay: 60,
      banners: [],
      // vlajka na stožáru nad hrotem střechy (art px, hrot je na jemném x 31..32)
      flags: [[14.5, -14]],
      smoke: [],
      glows: [
        { x: 26, y: 34, r: 11, a: 0.5, color: C.a[2], pulse: true },
        { x: 16, y: 46, r: 5, a: 0.3, color: C.a[2] }
      ],
      fire: [16, 20]
    };
  }

  /* ======================= Chatrč ======================= */
  function hut(team = "blue") {
    const W = 32;
    const H = 32;
    const P = new Pix(W * HD, H * HD);
    const T = TEAM[team];

    // svislá prkna, pravá strana ve stínu
    planks(P, 12, 34, 52, 60, { pw: 4, seed: 5, face: (x) => (x >= 44 ? -1 : x < 15 ? 0.3 : 0) });
    beam(P, 12, 34, 3, 26, { seed: 9 });
    beam(P, 43, 34, 2, 26, { seed: 10, face: () => -0.5 });
    beam(P, 49, 34, 3, 26, { seed: 11, face: () => -1 });

    // kamenná podezdívka
    masonry(P, 10, 57, 54, 63, { seed: 6, bh: 3, wmin: 4, wmax: 7, face: (x) => (x > 48 ? -1 : 0), moss: () => 0.12 });

    // komín
    masonry(P, 42, 10, 50, 30, { seed: 7, bh: 4, wmin: 4, wmax: 6, face: (x) => (x > 46 ? -1 : 0.3) });
    P.rect(41, 8, 10, 2, STONE[5]);
    P.rect(41, 10, 10, 1, STONE[1]);

    // došková střecha
    thatch(P, [[3, 39], [61, 39], [32, 8]], { seed: 21, face: (x) => (x > 35 ? -1.1 : x < 20 ? 0.4 : 0) });
    P.line(32, 8, 3, 39, THATCH[5]);
    P.line(32, 9, 4, 39, THATCH[4]);
    for (let x = 3; x < 61; x++) {
      P.set(x, 39, (x & 1) ? THATCH[2] : THATCH[1]);
      if (hash(x, 1, 3) > 0.5) P.set(x, 40, THATCH[1]);
    }
    shadow(P, 12, 40, 52, 43, (x, y) => (y < 42 ? 0.45 : 0.25));
    // hřebenový vazák
    P.rect(30, 8, 4, 2, WOOD[2]);
    P.set(30, 8, WOOD[4]);

    // dveře a okno
    P.rect(23, 43, 15, 17, WOOD[0]);
    door(P, 24, 44, 13, 16, { seed: 15, base: 2.6, pw: 4, straps: [48, 55] });
    P.rect(23, 43, 15, 1, WOOD[4]);
    windowLit(P, 15, 44, 8, 8, { vbar: 3, hbar: 3, sillRamp: WOOD });
    P.set(19, 44, C.a[4]);

    // týmová vlaječka na hřebeni
    P.rect(32, 0, 1, 9, WOOD[4]);
    P.rect(33, 0, 1, 9, WOOD[1]);
    for (let y = 0; y < 7; y++) {
      const len = 11 - Math.floor(y * 0.6);
      for (let x = 0; x < len; x++) {
        const tail = y >= 2 && y <= 4 && x > len - 3;
        if (tail) continue;
        P.set(34 + x, y, y === 0 ? T.l : y === 6 ? T.s : x % 4 === 3 ? T.s : T.m);
      }
    }

    spill(P, 19, 48, 9, 8, C.a[2], 0.45);

    P.outline(C.ink, 0.7);

    return {
      c: PK.fine(P), w: W, h: H, ax: 16, ay: 31,
      banners: [],
      smoke: [[22, 4]],
      glows: [{ x: 9, y: 23, r: 6, a: 0.35, color: C.a[2], pulse: true }]
    };
  }

  /* ======================= Kovárna ======================= */
  function smithy(team = "blue") {
    const W = 40;
    const H = 36;
    const P = new Pix(W * HD, H * HD);
    const T = TEAM[team];

    masonry(P, 10, 36, 60, 69, {
      seed: 31, bh: 5, wmin: 6, wmax: 10,
      face: (x) => (x >= 54 ? -1.1 : x < 13 ? 0.4 : 0),
      moss: (x, y) => (y > 62 ? 0.18 : 0)
    });

    // otevřená výheň
    archFrame(P, 30, 56, 9, 3, STONE, 8);
    P.rect(21, 56, 18, 13, STONE[0]);
    P.disc(30, 56, 9, 9, (x, y) => (y < 56 ? STONE[0] : -1));
    for (let y = 47; y < 69; y++) {
      for (let x = 21; x < 39; x++) {
        if (y < 56 && Math.hypot(x + 0.5 - 30, y + 0.5 - 56) > 9) continue;
        const d = Math.hypot((x + 0.5 - 30) / 9, (y + 0.5 - 68) / 14);
        // jazyky plamene: vlnitá hranice místo šumu
        const t = d - Math.sin(x * 1.3) * 0.06 - Math.sin(x * 0.7 + y * 0.4) * 0.05;
        P.set(x, y, t < 0.3 ? C.a[4] : t < 0.5 ? C.a[3] : t < 0.7 ? C.r[4] : t < 0.85 ? C.r[3] : t < 1 ? C.r[2] : C.r[1]);
      }
    }
    // uhlíky
    for (let x = 22; x < 38; x++) {
      P.set(x, 67, hash(x, 1, 6) > 0.5 ? C.b[2] : C.r[2]);
      P.set(x, 68, C.b[1]);
      if (hash(x, 2, 6) > 0.6) P.set(x, 66, C.r[4]);
    }
    // trám nad výhní
    beam(P, 18, 42, 24, 4, { horiz: true, seed: 3 });

    // komín
    masonry(P, 48, 8, 60, 38, { seed: 32, bh: 4, wmin: 4, wmax: 7, face: (x) => (x > 55 ? -1 : 0.3) });
    P.rect(46, 6, 16, 2, STONE[5]);
    P.rect(46, 8, 16, 1, STONE[1]);
    P.rect(49, 5, 10, 1, STONE[0]);

    // tmavá břidlicová střecha
    tiles(P, [[3, 39], [67, 39], [38, 14], [16, 14]], {
      ramp: SLATE, th: 3, tw: 5, y0: 14, seed: 9,
      face: (x, y) => (x < 16 + (y - 14) * (6 - 16) / 25 ? 0.6 : x > 38 + (y - 14) * 0.6 ? -1 : 0)
    });
    P.rect(16, 13, 23, 1, SLATE[5]);
    P.line(38, 14, 53, 39, SLATE[0]);
    P.rect(2, 38, 66, 1, WOOD[3]);
    P.rect(2, 39, 66, 1, WOOD[1]);
    shadow(P, 10, 40, 60, 42, 0.45);
    // komín přes střechu (před ní)
    masonry(P, 48, 8, 60, 30, { seed: 32, bh: 4, wmin: 4, wmax: 7, face: (x) => (x > 55 ? -1 : 0.3) });
    P.rect(47, 30, 14, 1, IRON[3]);
    P.rect(47, 31, 14, 1, IRON[1]);

    // meč na zdi
    P.rect(13, 46, 1, 13, C.s[6]);
    P.rect(14, 46, 1, 13, C.s[3]);
    P.set(13, 45, C.s[5]);
    P.rect(11, 58, 6, 1, C.gold[1]);
    P.rect(11, 59, 6, 1, C.gold[0]);
    P.rect(13, 60, 2, 3, WOOD[2]);
    P.set(13, 63, C.gold[1]);
    // týmová štítová deska vedle výhně
    P.rect(42, 47, 9, 11, T.m);
    P.rect(42, 47, 9, 1, T.l);
    P.rect(42, 47, 1, 11, T.l);
    P.rect(50, 48, 1, 10, T.s);
    P.poly([[42, 58], [51, 58], [46.5, 62]], T.s);
    brokenRing(P, 46.5, 52.5, 2.8, T.accent, T.d, 1.2);

    // kovadlina na špalku
    planks(P, 64, 58, 75, 69, { pw: 11, seed: 2, noJoints: true, face: (x) => (x > 71 ? -0.8 : 0) });
    P.disc(69.5, 58, 5.5, 1.6, (x, y) => (y < 58 ? WOOD[4] : WOOD[3]));
    P.set(67, 58, WOOD[1]);
    P.set(70, 57, WOOD[1]);
    P.rect(65, 55, 9, 3, IRON[2]);
    P.rect(62, 52, 15, 3, IRON[3]);
    P.rect(62, 52, 15, 1, IRON[5]);
    P.rect(76, 53, 3, 1, IRON[3]);
    P.set(79, 53, IRON[2]);
    P.rect(67, 55, 5, 1, IRON[1]);
    P.set(64, 52, C.white);
    // kladivo opřené o špalek
    P.line(75, 68, 78, 61, WOOD[3]);
    P.rect(77, 59, 3, 3, IRON[3]);
    P.set(77, 59, IRON[5]);

    // týmová vlaječka na hřebeni
    P.rect(38, 2, 1, 13, WOOD[4]);
    P.rect(39, 2, 1, 13, WOOD[1]);
    for (let y = 0; y < 7; y++) {
      const len = 10 - Math.floor(y * 0.5);
      for (let x = 0; x < len; x++) P.set(40 + x, 2 + y, y === 0 ? T.l : y === 6 ? T.s : x % 4 === 3 ? T.s : T.m);
    }

    spill(P, 30, 60, 22, 14, C.r[4], 0.6);
    spill(P, 68, 58, 10, 8, C.a[2], 0.3);

    P.outline(C.ink, 0.7);

    return {
      c: PK.fine(P), w: W, h: H, ax: 20, ay: 34,
      banners: [],
      smoke: [[27, 4]],
      glows: [
        { x: 15, y: 29, r: 10, a: 0.55, color: C.a[2], pulse: true },
        { x: 15, y: 31, r: 5, a: 0.35, color: C.a[3] }
      ]
    };
  }

  /* ======================= Rudá pevnost (Cinder citadel) ======================= */
  function citadel(team = "red") {
    const W = 80;
    const H = 74;
    const P = new Pix(W * HD, H * HD);
    const T = TEAM[team];
    void T;

    // hradba
    masonry(P, 6, 104, 154, 142, {
      ramp: BAS, seed: 77, bh: 6, wmin: 9, wmax: 15,
      face: (x, y) => (y > 134 ? -0.3 : 0)
    });
    cracks(P, 8, 108, 152, 140, 16, 3, 9);
    for (let x = 6; x < 154; x += 12) {
      masonry(P, x, 97, x + 8, 105, { ramp: BAS, seed: x, bh: 4, wmin: 8, wmax: 8, base: 3.2 });
      P.rect(x, 97, 8, 1, BAS[5]);
    }
    P.rect(6, 104, 148, 1, BAS[4]);

    // boční věže
    for (const x0 of [4, 118]) {
      masonry(P, x0, 60, x0 + 38, 142, {
        ramp: BAS, seed: 70 + x0, bh: 6, wmin: 7, wmax: 12,
        face: (x) => (x > x0 + 31 ? -1 : x < x0 + 4 ? 0.5 : 0)
      });
      cracks(P, x0 + 2, 70, x0 + 34, 138, 7, x0, 10);
      masonry(P, x0 - 2, 55, x0 + 40, 62, { ramp: BAS, seed: x0 + 1, bh: 3, wmin: 6, wmax: 9, base: 3.3 });
      P.rect(x0 - 2, 55, 42, 1, BAS[5]);
      shadow(P, x0, 62, x0 + 38, 65, 0.4);
      tiles(P, [[x0 - 2, 56], [x0 + 40, 56], [x0 + 19, 18]], {
        ramp: OBS, th: 3, tw: 5, y0: 18, seed: x0,
        face: (x) => (x > x0 + 21 ? -1 : 0.3)
      });
      P.line(x0 + 19, 18, x0 - 2, 56, OBS[4]);
      // železný hrot
      P.rect(x0 + 18, 7, 2, 12, BAS[2]);
      P.set(x0 + 18, 7, BAS[4]);
      P.set(x0 + 18, 4, C.r[5]);
      P.rect(x0 + 18, 5, 2, 2, C.r[4]);
      // žhnoucí štěrbina
      P.rect(x0 + 16, 78, 6, 12, BAS[0]);
      P.rect(x0 + 18, 80, 2, 9, C.r[4]);
      P.set(x0 + 18, 80, C.r[5]);
      P.rect(x0 + 17, 82, 4, 1, C.r[3]);
    }

    // centrální tvrz
    masonry(P, 48, 32, 112, 116, {
      ramp: BAS, seed: 71, bh: 6, wmin: 8, wmax: 14,
      face: (x) => (x >= 104 ? -1.1 : x < 52 ? 0.5 : 0)
    });
    cracks(P, 50, 76, 102, 112, 9, 71, 12);
    masonry(P, 46, 28, 114, 34, { ramp: BAS, seed: 72, bh: 3, wmin: 6, wmax: 10, base: 3.3 });
    P.rect(46, 28, 68, 1, BAS[5]);
    shadow(P, 48, 34, 112, 37, 0.4);
    for (let x = 46; x < 114; x += 12) {
      masonry(P, x, 22, x + 8, 29, { ramp: BAS, seed: x + 5, bh: 4, wmin: 8, wmax: 8, base: 3.2 });
      P.rect(x, 22, 8, 1, BAS[5]);
    }

    // koruna z kostěných hrotů
    for (const [x, h] of [[51, 12], [63, 18], [77, 24], [91, 18], [103, 12]]) {
      spike(P, x - 4, x + 5, 23, x + 0.5, 23 - h, BONE);
    }

    // štěrbinové oko
    emberEye(P, 80, 62, 14, 8);

    // brána s mříží
    archFrame(P, 80, 112, 15, 3, BAS, 9);
    for (let y = 100; y < 142; y++) {
      for (let x = 65; x < 95; x++) {
        if (y < 112 && Math.hypot(x + 0.5 - 80, y + 0.5 - 112) > 15) continue;
        P.set(x, y, emberAt(0.2 + (y - 100) / 42 * 0.65, x, y));
      }
    }
    for (let x = 67; x < 95; x += 5) {
      for (let y = 98; y < 142; y++) {
        if (y < 112 && Math.hypot(x + 0.5 - 80, y + 0.5 - 112) > 15) continue;
        P.set(x, y, BAS[2]);
        P.set(x + 1, y, BAS[0]);
      }
      P.set(x, 141, BONE[2]);
      P.set(x + 1, 141, BONE[1]);
    }
    for (const y of [112, 124]) {
      for (let x = 66; x < 95; x++) {
        if (P.get(x, y) < 0) continue;
        P.set(x, y, BAS[3]);
        P.set(x, y + 1, BAS[0]);
      }
    }

    // lebky
    for (const [x, y] of [[57, 80], [99, 80], [21, 116], [135, 116]]) skull(P, x, y);

    // pánve s ohněm (flames [27,59], [52,59] -> vršek misky v art 60)
    brazier(P, 55, 120, 16);
    brazier(P, 105, 120, 16);

    // lávová záře
    spill(P, 80, 136, 34, 16, C.r[3], 0.7);
    spill(P, 80, 62, 22, 14, C.r[3], 0.5);
    spill(P, 55, 118, 10, 10, C.r[4], 0.5);
    spill(P, 105, 118, 10, 10, C.r[4], 0.5);

    P.outline(C.ink, 0.7);

    return {
      c: PK.fine(P), w: W, h: H, ax: 40, ay: 70,
      banners: [[22, 34], [51, 34]],
      smoke: [[22, 2], [40, -1], [57, 2]],
      flames: [[27, 59], [52, 59]],
      glows: [
        { x: 40, y: 31, r: 16, a: 0.65, color: C.r[4], pulse: true },
        { x: 40, y: 62, r: 14, a: 0.5, color: C.r[4] },
        { x: 27, y: 58, r: 10, a: 0.45, color: C.r[4], flicker: true },
        { x: 52, y: 58, r: 10, a: 0.45, color: C.r[4], flicker: true },
        { x: 40, y: 66, r: 20, a: 0.4, color: C.r[3], ground: true }
      ]
    };
  }

  /* ====================== nemrtví z pekla ====================== */

  /* Roztrhaná týmová korouhev (statická) na pekelných budovách. */
  function rag(P, x, y, w, h, T, seed) {
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const cut = h - 1 - Math.floor(hash(xx, 1, seed) * 4);
        if (yy > cut) continue;
        if (yy > 3 && hash(xx, yy, seed + 2) > 0.93) continue;
        let c = xx === 0 ? T.l : xx === w - 1 ? T.s : T.m;
        if ((xx + yy) % 5 === 0 && yy > 2) c = T.s;
        if (yy === cut) c = T.d;
        P.set(x + xx, y + yy, c);
      }
    }
    P.rect(x - 1, y - 1, w + 2, 1, BONE[1]);
  }

  /* ---------- Nekropole: srdce pekla ---------- */
  function necropolis(team = "red") {
    const W = 88;
    const H = 86;
    const P = new Pix(W * HD, H * HD);
    const T = TEAM[team];

    // dvoustupňový podstavec
    masonry(P, 8, 148, 168, 170, { ramp: BAS, seed: 61, bh: 6, wmin: 10, wmax: 16, face: (x, y) => (y > 162 ? -0.4 : 0) });
    P.rect(8, 148, 160, 1, BAS[5]);
    cracks(P, 10, 150, 166, 168, 12, 61, 8);
    for (let x = 16; x < 164; x += 18) skull(P, x, 155);
    masonry(P, 20, 132, 156, 150, { ramp: BAS, seed: 62, bh: 6, wmin: 9, wmax: 14 });
    P.rect(20, 132, 136, 1, BAS[5]);
    shadow(P, 20, 149, 156, 151, 0.45);

    // boční věžičky s trny
    for (const x0 of [16, 132]) {
      masonry(P, x0, 66, x0 + 28, 134, {
        ramp: BAS, seed: x0, bh: 6, wmin: 6, wmax: 10,
        face: (x) => (x > x0 + 22 ? -1 : x < x0 + 3 ? 0.5 : 0)
      });
      cracks(P, x0 + 2, 76, x0 + 26, 130, 6, x0 + 3, 10);
      tiles(P, [[x0 - 3, 70], [x0 + 31, 70], [x0 + 14, 24]], {
        ramp: OBS, th: 3, tw: 5, y0: 24, seed: x0 + 4,
        face: (x) => (x > x0 + 16 ? -1 : 0.3)
      });
      P.line(x0 + 14, 24, x0 - 3, 70, OBS[4]);
      P.rect(x0 - 3, 69, 34, 1, OBS[4]);
      P.rect(x0 - 3, 70, 34, 1, OBS[0]);
      spike(P, x0 + 12, x0 + 17, 26, x0 + 14.5, 8, BONE);
      // žhnoucí okno
      P.rect(x0 + 9, 86, 10, 14, BAS[0]);
      P.disc(x0 + 14, 89, 4, 4, BAS[0]);
      for (let y = 87; y < 100; y++) {
        for (let x = x0 + 11; x < x0 + 17; x++) {
          if (y < 90 && Math.hypot(x + 0.5 - x0 - 14, y + 0.5 - 90) > 3) continue;
          P.set(x, y, emberAt(0.35 + (y - 87) / 13 * 0.65, x, y));
        }
      }
      P.rect(x0 + 13, 87, 2, 13, BAS[1]);
      spill(P, x0 + 14, 96, 10, 8, C.r[3], 0.5);
    }

    // jádro: tmavá hradba s kostěnými žebry
    masonry(P, 40, 56, 136, 136, {
      ramp: BAS, seed: 63, bh: 6, wmin: 8, wmax: 14,
      face: (x) => (x >= 128 ? -1.1 : x < 44 ? 0.5 : 0)
    });
    cracks(P, 42, 70, 134, 132, 14, 63, 12);
    for (const [xa, xb] of [[44, 72], [104, 132]]) {
      for (let i = 0; i < 4; i++) {
        const y = 68 + i * 16;
        const xm = (xa + xb) / 2;
        P.line(xa, y + 12, xm, y, BONE[2]);
        P.line(xa, y + 13, xm, y + 1, BONE[1]);
        P.line(xm, y, xb, y + 12, BONE[1]);
        P.line(xm, y + 1, xb, y + 13, BONE[0]);
        P.set(xm, y, BONE[3]);
      }
    }
    masonry(P, 38, 54, 138, 60, { ramp: BAS, seed: 64, bh: 3, wmin: 6, wmax: 10, base: 3.3 });
    P.rect(38, 54, 100, 1, BAS[5]);
    shadow(P, 40, 60, 136, 63, 0.4);

    // středová věž: zužující se hrot s rudou štěrbinou
    const sm = maskOf(P, M => M.poly([[64, 60], [112, 60], [96, 12], [80, 12]], 1));
    masonry(P, 64, 12, 112, 60, {
      ramp: OBS, seed: 65, bh: 5, wmin: 5, wmax: 9, mask: sm,
      face: (x) => (x > 98 ? -1 : x < 82 ? 0.4 : 0)
    });
    spike(P, 78, 99, 14, 88.5, 0, OBS);
    for (let y = 20; y < 56; y++) {
      for (let x = 85; x < 92; x++) {
        const t = Math.abs(x + 0.5 - 88.5) / 3.5 + ((y & 3) === 0 ? 0.3 : 0);
        P.set(x, y, t < 0.3 ? C.r[5] : t < 0.6 ? C.r[4] : t < 0.85 ? C.r[3] : C.r[2]);
      }
    }
    P.rect(78, 60, 22, 2, C.gold[0]);
    P.rect(78, 60, 22, 1, C.gold[1]);

    // vznášející se oko
    emberEye(P, 88, 36, 11, 7);

    // brána s lomeným obloukem
    const gate = (x, y) => {
      if (x < 68 || x >= 108 || y >= 136) return false;
      if (y >= 100) return true;
      const dx = Math.abs(x + 0.5 - 88);
      return Math.hypot(dx + 12, y + 0.5 - 100) <= 32 && y >= 80;
    };
    for (let y = 76; y < 136; y++) {
      for (let x = 64; x < 112; x++) {
        const inner = gate(x, y);
        const outer = gate(x - 2, y) || gate(x + 2, y) || gate(x, y + 3) || gate(x - 3, y + 2) || gate(x + 3, y + 2);
        if (inner) {
          P.set(x, y, emberAt(0.2 + (y - 80) / 56 * 0.8, x, y));
        } else if (outer) {
          P.set(x, y, x < 88 ? BONE[2] : BONE[1]);
        }
      }
    }
    for (let x = 72; x < 106; x += 6) {
      for (let y = 80; y < 136; y++) {
        if (!gate(x, y)) continue;
        P.set(x, y, BAS[2]);
        P.set(x + 1, y, BAS[0]);
      }
    }
    skull(P, 85, 72);

    // týmové praporce na rozích jádra
    rag(P, 44, 62, 8, 18, T, 3);
    rag(P, 124, 62, 8, 18, T, 4);

    // pánve s ohněm (flames [26,57], [62,57])
    brazier(P, 53, 116, 14);
    brazier(P, 125, 116, 14);

    spill(P, 88, 128, 30, 18, C.r[3], 0.7);
    spill(P, 88, 36, 22, 14, C.r[3], 0.5);
    spill(P, 53, 114, 10, 10, C.r[4], 0.5);
    spill(P, 125, 114, 10, 10, C.r[4], 0.5);

    P.outline(C.ink, 0.7);

    return {
      c: PK.fine(P), w: W, h: H, ax: 44, ay: 82, hell: true,
      banners: [],
      smoke: [[15, 4], [44, -2], [73, 4]],
      flames: [[26, 57], [62, 57]],
      glows: [
        { x: 44, y: 18, r: 18, a: 0.7, color: C.r[4], pulse: true },
        { x: 44, y: 60, r: 15, a: 0.5, color: C.r[4] },
        { x: 26, y: 56, r: 10, a: 0.45, color: C.r[4], flicker: true },
        { x: 62, y: 56, r: 10, a: 0.45, color: C.r[4], flicker: true },
        { x: 44, y: 76, r: 26, a: 0.4, color: C.r[3], ground: true }
      ]
    };
  }

  /* ---------- Krypta: ghúlové a kostlivci ---------- */
  function crypt(team = "red") {
    const W = 50;
    const H = 42;
    const P = new Pix(W * HD, H * HD);
    const T = TEAM[team];

    masonry(P, 6, 74, 94, 82, { ramp: ASH, seed: 13, bh: 4, wmin: 8, wmax: 14, moss: () => 0.1 });
    P.rect(6, 74, 88, 1, ASH[5]);
    masonry(P, 12, 40, 88, 76, {
      ramp: ASH, seed: 14, bh: 5, wmin: 6, wmax: 11,
      face: (x) => (x >= 82 ? -1.1 : x < 16 ? 0.4 : 0),
      moss: (x, y) => (y > 64 ? 0.18 : 0.03)
    });

    // kostěné sloupy
    for (const x of [16, 78]) {
      for (let y = 40; y < 74; y++) {
        const seg = (y - 40) % 6;
        P.set(x, y, seg === 0 ? BONE[1] : BONE[3]);
        P.rect(x + 1, y, 3, 1, seg === 0 ? BONE[0] : seg === 1 ? BONE[3] : BONE[2]);
        P.set(x + 4, y, seg === 0 ? BONE[0] : BONE[1]);
        P.set(x + 5, y, BONE[0]);
      }
    }

    // štít střechy z čedičových tašek
    tiles(P, [[3, 43], [97, 43], [50, 8]], {
      ramp: BAS, th: 3, tw: 6, y0: 8, seed: 15,
      face: (x) => (x > 52 ? -1 : 0.4)
    });
    P.line(50, 8, 3, 43, BAS[5]);
    P.line(50, 9, 4, 43, BAS[4]);
    P.line(51, 8, 97, 43, BAS[0]);
    P.rect(3, 43, 94, 1, BAS[4]);
    P.rect(3, 44, 94, 1, BAS[0]);
    shadow(P, 12, 45, 88, 48, (x, y) => (y === 45 ? 0.45 : 0.25));
    skull(P, 16, 36);
    skull(P, 78, 36);
    // hrobový kříž – zlomený kruh z kosti
    P.rect(49, 0, 3, 10, BONE[2]);
    P.rect(49, 0, 1, 10, BONE[3]);
    P.rect(46, 3, 9, 2, BONE[2]);
    P.rect(46, 3, 9, 1, BONE[3]);
    skull(P, 47, 22);

    // dveře do hrobky s rudým svitem
    const dm = (x, y) => (y >= 50 ? x >= 38 && x < 62 : Math.hypot(Math.abs(x + 0.5 - 50) + 8, y + 0.5 - 50) <= 20 && y >= 34);
    for (let y = 30; y < 77; y++) {
      for (let x = 34; x < 66; x++) {
        if (dm(x, y)) {
          P.set(x, y, emberAt(0.15 + (y - 34) / 42 * 0.7, x, y));
        } else if (dm(x - 2, y) || dm(x + 2, y) || dm(x, y + 2)) {
          P.set(x, y, x < 50 ? ASH[5] : ASH[2]);
        }
      }
    }
    P.rect(49, 36, 2, 40, ASH[1]);
    P.rect(48, 56, 4, 1, ASH[3]);
    // schod
    P.rect(36, 76, 28, 2, ASH[4]);
    P.rect(36, 76, 28, 1, ASH[5]);

    // roztrhaný týmový praporec
    P.rect(24, 16, 2, 28, WOOD[1]);
    P.rect(24, 16, 1, 28, WOOD[3]);
    rag(P, 26, 18, 9, 14, T, 7);

    spill(P, 50, 70, 22, 12, C.r[3], 0.6);

    P.outline(C.ink, 0.7);

    return {
      c: PK.fine(P), w: W, h: H, ax: 25, ay: 40, hell: true,
      banners: [],
      smoke: [],
      glows: [{ x: 25, y: 31, r: 11, a: 0.5, color: C.r[3], pulse: true }]
    };
  }

  /* ---------- Jatka: zrůdy ---------- */
  function slaughterhouse(team = "red") {
    const W = 56;
    const H = 46;
    const P = new Pix(W * HD, H * HD);
    const T = TEAM[team];
    const DW = [mix(C.w[0], C.b[0], 0.4), C.w[0], C.w[1], mix(C.w[1], C.w[2], 0.5), C.w[2], C.w[3]];

    masonry(P, 8, 84, 104, 91, { ramp: BAS, seed: 23, bh: 4, wmin: 8, wmax: 13 });
    P.rect(8, 84, 96, 1, BAS[4]);
    planks(P, 12, 44, 100, 85, { ramp: DW, pw: 5, seed: 23, face: (x) => (x >= 94 ? -1 : x < 15 ? 0.4 : 0) });

    // krvavé skvrny a stékající pruhy
    for (const [x, y, l] of [[24, 70, 6], [27, 72, 3], [82, 58, 7], [62, 80, 2], [66, 81, 1]]) {
      P.rect(x, y, 2, 1, C.r[2]);
      P.rect(x, y + 1, 1, l, C.r[1]);
      P.set(x, y, C.r[3]);
    }

    // komín
    masonry(P, 80, 8, 92, 40, { ramp: BAS, seed: 24, bh: 4, wmin: 4, wmax: 7, face: (x) => (x > 88 ? -1 : 0.3) });
    P.rect(78, 6, 16, 2, BAS[4]);
    P.rect(78, 8, 16, 1, BAS[0]);
    P.rect(81, 5, 10, 1, C.r[2]);

    // vlnitý plech s rzí a nýty
    P.poly([[4, 49], [108, 49], [92, 20], [20, 20]], (x, y) => {
      const k = x % 4;
      let t = k === 0 ? 4 : k === 1 ? 3 : k === 2 ? 2.4 : 1.6;
      if (x > 92 + (y - 20) * 0.55) t -= 1;
      if (x < 20 - (y - 20) * 0.55) t += 0.4;
      // rez stéká po žlábcích dolů od nýtů
      const rust = PK.fbm(x / 7, y / 14, 9, 2) + (hash(x >> 2, 1, 9) - 0.5) * 0.25;
      if (rust > 0.6) return pick(RUST, t - 1.6);
      if ((y - 20) % 10 === 9) return RUST[2];
      return pick(RUST, t);
    });
    for (let x = 22; x < 92; x += 8) {
      for (const y of [22, 32, 42]) {
        P.set(x, y, RUST[5]);
        P.set(x + 1, y + 1, RUST[1]);
      }
    }
    P.rect(4, 48, 104, 1, RUST[5]);
    P.rect(4, 49, 104, 1, RUST[1]);
    shadow(P, 12, 50, 100, 53, (x, y) => (y === 50 ? 0.5 : 0.3));
    // komín přes střechu
    masonry(P, 80, 8, 92, 30, { ramp: BAS, seed: 24, bh: 4, wmin: 4, wmax: 7, face: (x) => (x > 88 ? -1 : 0.3) });

    // otevřená vrata: háky s masem
    P.rect(32, 54, 44, 32, BAS[0]);
    for (let y = 56; y < 85; y++) {
      for (let x = 34; x < 74; x++) {
        const t = (y - 56) / 29;
        P.set(x, y, t > 0.72 ? emberAt(0.05 + (t - 0.72) * 0.9, x, y) : t > 0.5 ? mix(BAS[1], C.r[0], 0.4) : BAS[1]);
      }
    }
    beam(P, 32, 53, 44, 3, { horiz: true, seed: 6 });
    P.rect(34, 58, 40, 1, IRON[2]);
    for (const [x, len] of [[40, 14], [52, 18], [64, 12]]) {
      P.rect(x, 59, 1, 4, IRON[4]);
      P.set(x + 1, 62, IRON[3]);
      P.poly([[x - 3, 63], [x + 4, 63], [x + 3, 63 + len], [x - 2, 63 + len]], (px, py) =>
        px < x - 1 ? C.r[3] : px > x + 1 ? C.r[1] : (py - 63) % 5 === 2 ? C.cap[1] : C.r[2]);
      P.rect(x - 1, 63 + len - 2, 2, 2, BONE[2]);
      P.set(x - 1, 63 + len - 2, BONE[3]);
    }
    // otevřená křídla vrat
    planks(P, 26, 54, 32, 86, { ramp: DW, pw: 3, seed: 30, base: 3 });
    planks(P, 76, 54, 82, 86, { ramp: DW, pw: 3, seed: 31, base: 1.8 });

    // sekáček ve špalku
    planks(P, 88, 72, 100, 85, { ramp: WOOD, pw: 12, seed: 2, noJoints: true, face: (x) => (x > 96 ? -0.8 : 0) });
    P.disc(94, 72, 6, 1.7, (x, y) => (y < 72 ? WOOD[4] : WOOD[3]));
    P.set(92, 72, C.r[2]);
    P.rect(91, 64, 7, 7, IRON[3]);
    P.rect(91, 64, 7, 1, IRON[5]);
    P.rect(97, 64, 1, 7, IRON[1]);
    P.rect(98, 66, 4, 2, WOOD[2]);
    P.set(91, 70, C.r[2]);

    // týmový hadr
    rag(P, 16, 54, 11, 14, T, 9);

    spill(P, 54, 82, 26, 10, C.r[3], 0.45);

    P.outline(C.ink, 0.7);

    return {
      c: PK.fine(P), w: W, h: H, ax: 28, ay: 44, hell: true,
      banners: [],
      smoke: [[43, 3]],
      glows: [{ x: 27, y: 38, r: 12, a: 0.35, color: C.r[3] }]
    };
  }

  /* ---------- Zikkurat: pekelná střílna ---------- */
  function ziggurat(team = "red") {
    const W = 36;
    const H = 54;
    const P = new Pix(W * HD, H * HD);
    const T = TEAM[team];

    for (const [x0, x1, y0, y1, s] of [[4, 68, 84, 106, 1], [12, 60, 62, 86, 2], [20, 52, 42, 64, 3]]) {
      masonry(P, x0, y0, x1, y1, {
        ramp: BAS, seed: 37 + s, bh: 5, wmin: 6, wmax: 11,
        face: (x) => (x >= x1 - 6 ? -1.1 : x < x0 + 3 ? 0.5 : 0)
      });
      P.rect(x0, y0, x1 - x0, 1, BAS[5]);
      P.rect(x0, y0 + 1, x1 - x0, 1, BAS[4]);
      cracks(P, x0 + 2, y0 + 3, x1 - 2, y1 - 2, 3 + s, s * 11, 7);
      shadow(P, x0 + 2, y1, x1, y1 + 2, 0.45);
    }

    // schodiště uprostřed
    for (let y = 44; y < 106; y++) {
      const ly = (y - 44) % 4;
      for (let x = 30; x < 42; x++) {
        let c = ly === 0 ? BAS[5] : ly === 1 ? BAS[3] : ly === 2 ? BAS[2] : BAS[1];
        if (x === 30) c = BAS[1];
        if (x === 41) c = BAS[0];
        P.set(x, y, c);
      }
    }

    // runy žhnou ve stupních
    for (const [x, y] of [[12, 94], [58, 94], [18, 72], [52, 72]]) {
      P.rect(x, y, 2, 6, BAS[0]);
      P.rect(x, y + 1, 1, 4, C.r[3]);
      P.set(x, y + 1, C.r[5]);
      P.set(x + 1, y + 3, C.r[4]);
      spill(P, x + 1, y + 3, 5, 5, C.r[3], 0.5);
    }

    // oltář a plovoucí koule s trny
    masonry(P, 24, 32, 48, 44, { ramp: OBS, seed: 39, bh: 4, wmin: 6, wmax: 8, face: (x) => (x > 43 ? -1 : 0.3) });
    P.rect(24, 32, 24, 1, OBS[5]);
    spike(P, 21, 28, 33, 23, 16, BONE);
    spike(P, 44, 51, 33, 49, 16, BONE);
    P.disc(36, 18, 8, 8, (x, y) => {
      const t = Math.hypot(x + 0.5 - 34, y + 0.5 - 16) / 9;
      return t < 0.25 ? C.r[5] : t < 0.5 ? C.r[4] : t < 0.75 ? C.r[3] : t < 0.95 ? C.r[2] : C.r[1];
    });
    P.set(33, 14, mix(C.r[5], C.white, 0.6));
    P.ring(36, 18, 10.5, 10.5, OBS[3], 1);

    // týmová stužka
    P.rect(24, 42, 24, 2, T.m);
    P.rect(24, 42, 24, 1, T.l);
    P.set(30, 44, T.s);
    P.set(42, 44, T.s);
    P.set(42, 45, T.d);

    spill(P, 36, 40, 14, 12, C.r[4], 0.55);

    P.outline(C.ink, 0.7);

    return {
      c: PK.fine(P), w: W, h: H, ax: 18, ay: 52, hell: true,
      banners: [],
      smoke: [],
      glows: [
        { x: 18, y: 9, r: 12, a: 0.65, color: C.r[4], pulse: true },
        { x: 18, y: 44, r: 8, a: 0.3, color: C.r[3] }
      ],
      fire: [18, 9]
    };
  }

  /* ---------- Pekelná brána: přízraky ---------- */
  function portal(team = "red") {
    const W = 56;
    const H = 56;
    const P = new Pix(W * HD, H * HD);
    const T = TEAM[team];
    const cx = 56;
    const cy = 60;

    masonry(P, 6, 94, 106, 110, { ramp: BAS, seed: 91, bh: 5, wmin: 9, wmax: 14, face: (x, y) => (y > 104 ? -0.4 : 0) });
    P.rect(6, 94, 100, 1, BAS[5]);
    cracks(P, 8, 96, 104, 108, 6, 92, 6);

    // vír uvnitř oblouku
    P.disc(cx, cy, 30, 34, (x, y) => {
      const dx = x + 0.5 - cx;
      const dy = (y + 0.5 - cy) * 0.88;
      const r = Math.hypot(dx, dy) / 30;
      const a = Math.atan2(dy, dx);
      const band = ((a / (Math.PI * 2) + r * 1.6) % 0.33 + 0.33) % 0.33;
      if (r < 0.14) return C.r[5];
      if (r < 0.24) return C.r[4];
      const v = band < 0.06 ? 4 : band < 0.12 ? 3 : band < 0.22 ? 2 : 1;
      return EMB[clamp(v - (r > 0.8 ? 1 : 0), 0, 5)];
    });
    shadow(P, cx - 30, cy - 34, cx + 30, cy - 20, 0.35);

    // kamenný oblouk z klínových kvádrů
    for (let y = 14; y < 98; y++) {
      for (let x = 10; x < 104; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const d = Math.hypot(dx / 38, dy / 42);
        const inRing = d <= 1 && d >= 0.8;
        const pillar = y >= cy && ((x >= 16 && x < 28) || (x >= 84 && x < 96));
        if (!inRing && !pillar) continue;
        if (y >= cy && !pillar) continue;
        let c;
        if (pillar) {
          const lx = x < 56 ? x - 16 : x - 84;
          const row = Math.floor((y - cy) / 6);
          const ly = (y - cy) % 6;
          let t = 3 + (hash(row, x < 56 ? 1 : 2, 91) - 0.5) + (lx < 2 ? 0.6 : lx > 9 ? -1 : 0);
          if (ly === 5) t = 1;
          else if (ly === 0) t += 1;
          c = pick(BAS, t);
        } else {
          const a = Math.atan2(dy, dx);
          const seg = Math.floor((a + Math.PI) / (Math.PI / 9));
          const la = (a + Math.PI) / (Math.PI / 9) - seg;
          let t = 3 + (hash(seg, 3, 91) - 0.5) + (dx < 0 ? 0.4 : -0.6);
          if (la < 0.1) t = 1;
          else if (d > 0.97) t += 1;
          else if (d < 0.83) t -= 1;
          c = pick(BAS, t);
        }
        P.set(x, y, c);
      }
    }
    cracks(P, 16, 24, 96, 92, 10, 93, 9);

    // kostěné zuby kolem oblouku
    for (let a = -2.75; a <= -0.35; a += 0.4) {
      const x = cx + Math.cos(a) * 39;
      const y = cy + Math.sin(a) * 43;
      const tx = x + Math.cos(a) * 9;
      const ty = y + Math.sin(a) * 9;
      const px = -Math.sin(a) * 2.5;
      const py = Math.cos(a) * 2.5;
      P.poly([[x - px, y - py], [x + px, y + py], [tx, ty]], (xx) => (xx < tx ? BONE[2] : BONE[1]));
      P.set(Math.round(tx), Math.round(ty), BONE[3]);
    }

    // rohy na vrcholu
    P.poly([[38, 22], [46, 20], [34, 8], [28, 0]], (x, y) => (x < 36 ? BONE[3] : BONE[2]));
    P.poly([[66, 20], [74, 22], [84, 0], [78, 8]], (x, y) => (x < 76 ? BONE[2] : BONE[1]));
    for (const [x, y] of [[33, 8], [36, 13], [79, 8], [76, 13]]) P.set(x, y, BONE[0]);

    // klíčový kámen s okem
    emberEye(P, cx, 21, 6, 3.4);

    // pánve s ohněm (flames [6,42], [50,42] -> vršek misky art 43)
    brazier(P, 13, 86, 4);
    brazier(P, 101, 86, 4);
    skull(P, 53, 98);

    // týmové pruhy na pilířích
    for (const x of [19, 87]) {
      P.rect(x, 66, 6, 14, T.m);
      P.rect(x, 66, 6, 1, T.l);
      P.rect(x, 66, 1, 14, T.l);
      P.rect(x + 5, 67, 1, 13, T.s);
      P.poly([[x, 80], [x + 6, 80], [x + 3, 84]], T.s);
      P.rect(x, 65, 6, 1, BONE[1]);
    }

    spill(P, cx, 96, 34, 10, C.r[3], 0.6);
    spill(P, cx, cy, 44, 46, C.r[3], 0.35, (x, y) => Math.hypot((x + 0.5 - cx) / 30, (y + 0.5 - cy) / 34) > 1);

    P.outline(C.ink, 0.7);

    return {
      c: PK.fine(P), w: W, h: H, ax: 28, ay: 54, hell: true,
      banners: [],
      smoke: [],
      flames: [[6, 42], [50, 42]],
      glows: [
        { x: 28, y: 30, r: 22, a: 0.6, color: C.r[4], pulse: true },
        { x: 28, y: 50, r: 18, a: 0.4, color: C.r[3], ground: true }
      ]
    };
  }

  /* ======================= vlající prapory ======================= */
  const bannerCache = {};

  /*
   * Čtyři snímky praporu 11 x 16 art px (= 22 x 32 jemných). Tyč s
   * hlavicemi leží na řádku 0, látka visí pod ní, vlní se a dole má
   * vlaštovčí ocas. Znak: zlomený kruh (rudý tým: žhavé oko).
   */
  function bannerFrames(team) {
    if (bannerCache[team]) return bannerCache[team];

    const T = TEAM[team];
    const frames = [];
    const w = 14;
    const h = 27;

    for (let f = 0; f < 4; f++) {
      const P = new Pix(22, 32);
      const ph = f * Math.PI / 2;
      const off = y => Math.sin(y * 0.28 - ph) * (y / h) * 2.4;

      for (let y = 0; y < h; y++) {
        const o = off(y);
        const slope = Math.cos(y * 0.28 - ph) * (y / h);
        let x0 = Math.round(3 + o);
        let x1 = x0 + w - 1;
        const notch = y - (h - 6);

        for (let x = x0; x <= x1; x++) {
          const lx = x - x0;
          if (notch > 0 && Math.abs(lx + 0.5 - w / 2) < notch * 1.1) continue;
          let c = T.m;
          if (lx === 0) c = T.l;
          else if (lx >= w - 2) c = T.s;
          // přeložení látky: 1 px záhyby posunuté s vlnou
          const fold = (lx + Math.round(o * 1.5) + 40) % 7;
          if (y > 4 && fold === 5) c = slope > 0 ? T.s : T.l;
          if (y > 4 && fold === 6 && slope > 0.3) c = T.d;
          if (y < 3) c = y === 0 ? T.s : lx === 0 ? T.l : T.m;
          if (y === 3) c = T.d;
          // lem
          if (y >= h - 7 && (lx === 0 || lx === w - 1)) c = T.accent;
          P.set(x, y + 3, c);
        }
        // tkanice lemu dole
        if (notch === 0) for (let x = x0; x <= x1; x++) P.set(x, y + 3, T.accent);
      }

      const ex = 3 + w / 2 + off(11);
      if (team !== "red") {
        brokenRing(P, ex, 14.5, 4.6, T.accent, T.d, 1.7);
        P.set(Math.round(ex - 3), 11, T.accentL);
      } else {
        for (let y = 11; y <= 18; y++) {
          for (let x = Math.floor(ex - 6); x <= ex + 6; x++) {
            const nx = (x + 0.5 - ex) / 5.5;
            const ny = (y + 0.5 - 14.5) / 3;
            const lim = 1 - nx * nx;
            if (lim <= 0 || Math.abs(ny) > lim) continue;
            let c = Math.abs(ny) > lim - 0.4 ? T.accent : T.accentL;
            if (Math.abs(x + 0.5 - ex) < 0.8) c = C.ink;
            P.set(x, y, c);
          }
        }
      }

      // tyč s hlavicemi
      for (let x = 1; x < 20; x++) {
        P.set(x, 1, WOOD[4]);
        P.set(x, 2, WOOD[1]);
      }
      for (const kx of [0, 19]) {
        P.rect(kx, 0, 2, 3, C.gold[1]);
        P.set(kx, 0, C.gold[2]);
        P.set(kx + 1, 2, C.gold[0]);
      }
      // šňůrky
      P.set(3, 3, C.gold[0]);
      P.set(17, 3, C.gold[0]);

      P.outline(C.ink, 0.7);
      frames.push(PK.fine(P));
    }

    return (bannerCache[team] = frames);
  }

  /* ======================= vlajka na stožáru ======================= */
  const flagCache = {};
  const FLAG_FRAMES = 8;

  /*
   * Osm snímků vlajky 16 x 15 art px (= 32 x 30 jemných) pro hrot věže.
   * Stožár je na jemném x 2..3, látka vlaje doprava: vlna se rozbíhá od
   * stožáru a roste ke konci, plochy natočené ke světlu jsou světlejší,
   * odvrácené tmavší (celé pruhy, žádná šachovnice). Konec má vlaštovčí ocas, středem vede pruh týmového
   * akcentu. Dole stožár přesahuje do zlaté hlavice střechy.
   */
  function flagFrames(team) {
    if (flagCache[team]) return flagCache[team];

    const T = TEAM[team] || TEAM.blue;
    const frames = [];
    const L = 24;
    const top0 = 4;

    for (let f = 0; f < FLAG_FRAMES; f++) {
      const P = new Pix(32, 30);
      const ph = f * Math.PI * 2 / FLAG_FRAMES;

      for (let cx = 0; cx < L; cx++) {
        const t = cx / (L - 1);
        const a = cx * 0.36 - ph;
        const dy = Math.sin(a) * (0.4 + t * 2.4);
        // sklon látky: + natočená vzhůru ke světlu, - odvrácená dolů
        const slope = Math.cos(a) * (0.35 + t);
        const hgt = 12 - Math.round(t * 2);
        const y0 = Math.round(top0 + dy + t * 1.5);
        const tail = cx - (L - 6);
        const x = 4 + cx;

        for (let ry = 0; ry < hgt; ry++) {
          if (tail > 0 && Math.abs(ry + 0.5 - hgt / 2) < tail * 0.95) continue;
          let c = T.m;
          if (slope > 0.45) c = T.l;
          else if (slope < -0.45) c = T.s;
          // pruh akcentu středem látky
          const mid = Math.abs(ry + 0.5 - hgt / 2);
          if (cx > 2 && mid < 1.1) c = slope < -0.55 ? mix(T.accent, T.s, 0.35) : T.accent;
          // horní hrana chytá světlo, spodní je ve stínu
          if (ry === 0) c = slope > 0.2 ? T.h : T.l;
          else if (ry === hgt - 1) c = T.d;
          // přišitý lem u stožáru
          if (cx < 2) c = cx === 0 ? T.d : T.s;
          P.set(x, y0 + ry, c);
        }
      }

      // stožár s hlavicí; dole končí v hrotu střechy
      for (let y = 3; y < 30; y++) {
        P.set(2, y, WOOD[4]);
        P.set(3, y, WOOD[1]);
      }
      P.rect(1, 0, 4, 3, C.gold[1]);
      P.rect(2, 0, 2, 1, C.gold[2]);
      P.set(4, 2, C.gold[0]);
      P.set(1, 2, C.gold[0]);

      P.outline(C.ink, 0.7);
      frames.push(PK.fine(P));
    }

    return (flagCache[team] = frames);
  }

  /* ======================= sutiny ======================= */
  const rubbleCache = {};

  /*
   * Hromada trosek po zbořené budově (decal na zemi): kvádry s osvětlenou
   * horní plochou, zlomené trámy, střepy tašek a prach.
   */
  function rubble(type, team) {
    const w = type === "tower" || type === "ziggurat" ? 26
      : type === "barracks" || type === "crypt" || type === "slaughterhouse" ? 46
      : type === "necropolis" ? 74 : 60;
    const h = 16;
    const key = `${w}|${team === "red" ? 1 : 0}|${type}`;
    if (rubbleCache[key]) return rubbleCache[key];

    const FW = w * HD;
    const FH = h * HD;
    const P = new Pix(FW, FH);
    const hell = team === "red" || ["necropolis", "crypt", "slaughterhouse", "ziggurat", "portal", "citadel"].includes(type);
    const ramp = hell ? BAS : STONE;
    const roof = hell ? OBS : type === "smithy" ? SLATE : TEAL;
    const seed = w * 7 + (hell ? 3 : 0);

    // prach a štěrk pod hromadou
    for (let y = 0; y < FH; y++) {
      for (let x = 0; x < FW; x++) {
        const d = Math.hypot((x + 0.5 - FW / 2) / (FW / 2 - 2), (y + 0.5 - FH * 0.62) / (FH * 0.36));
        if (d > 1) continue;
        const n = hash(x, y, seed);
        if (n > 0.8 + d * 0.17 && P.get(x - 1, y) < 0) P.set(x, y, n > 0.95 ? ramp[3] : ramp[2]);
      }
    }

    // trámy
    for (let i = 0; i < 4; i++) {
      const x = 6 + Math.floor(hash(i, 6, seed) * (FW - 30));
      const y = 10 + Math.floor(hash(i, 7, seed) * 12);
      const len = 12 + Math.floor(hash(i, 8, seed) * 8);
      const dy = Math.floor((hash(i, 9, seed) - 0.5) * 6);
      P.line(x, y, x + len, y + dy, WOOD[3]);
      P.line(x, y + 1, x + len, y + dy + 1, WOOD[2]);
      P.line(x, y + 2, x + len, y + dy + 2, WOOD[1]);
      P.set(x + len, y + dy + 1, hell ? C.r[3] : WOOD[0]);
    }

    // kvádry: hromada uprostřed vyšší, kreslí se odzadu dopředu
    const n = Math.floor(FW * 0.75);
    const stones = [];
    for (let i = 0; i < n; i++) {
      const u = hash(i, 1, seed) * 2 - 1;
      const sw = 4 + Math.floor(hash(i, 3, seed) * 7 * (1 - Math.abs(u) * 0.5));
      const sh = 3 + Math.floor(hash(i, 4, seed) * 3);
      const hump = (1 - u * u) * FH * 0.42;
      const y = Math.floor(FH - 6 - sh - hash(i, 2, seed) * hump);
      const x = Math.floor(FW / 2 + u * (FW / 2 - 4) - sw / 2);
      stones.push([x, y, sw, sh, i]);
    }
    stones.sort((p, q) => p[1] + p[3] - q[1] - q[3]);
    for (const [x, y, sw, sh, i] of stones) {
      const isRoof = hash(i, 10, seed) > 0.8;
      const R = isRoof ? roof : ramp;
      const b = 2 + Math.floor(hash(i, 11, seed) * 2);
      for (let yy2 = 0; yy2 < sh; yy2++) {
        for (let xx = 0; xx < sw; xx++) {
          if ((xx === 0 || xx === sw - 1) && (yy2 === 0 || yy2 === sh - 1)) continue;
          let t = b;
          if (yy2 === 0) t = b + 2;
          else if (yy2 === 1 && xx < sw - 1) t = b + 1;
          else if (xx === sw - 1 || yy2 === sh - 1) t = b - 1;
          else if (xx === 0) t = b + 1;
          P.set(x + xx, y + yy2, pick(R, clamp(t, 1, R.length - 1)));
        }
      }
      P.set(x + sw - 1, y + sh - 1, R[0]);
    }

    if (hell) cracks(P, 4, 8, FW - 4, FH - 4, Math.floor(FW / 12), seed, 5);

    P.outline(C.ink, 0.7);
    return (rubbleCache[key] = { c: PK.fine(P), w, h });
  }

  /* ======================= registr ======================= */
  const cache = {};
  const BUILD = { hall, barracks, tower, citadel, hut, smithy, necropolis, crypt, slaughterhouse, ziggurat, portal };

  function get(type, team = "blue") {
    const key = `${type}|${team}`;
    if (!cache[key]) cache[key] = BUILD[type](team);
    return cache[key];
  }

  /*
   * Průhledná předloha rozestavěné budovy: celá silueta tónovaná modře
   * (pekelné budovy rudě), s jemným dvojčetem, aby i předloha měla jemné px.
   */
  const blueprints = new Map();

  function blueprint(spr) {
    let c = blueprints.get(spr);
    if (c) return c;

    const tint = (src) => {
      const t = PK.makeCanvas(src.width, src.height);
      t.g.drawImage(src, 0, 0);
      t.g.globalCompositeOperation = "source-atop";
      t.g.fillStyle = spr.hell ? "rgba(200,40,30,0.75)" : "rgba(70,150,255,0.7)";
      t.g.fillRect(0, 0, t.c.width, t.c.height);
      return t.c;
    };

    c = tint(spr.c);
    const fineSrc = PK.hdOf(spr.c);
    if (fineSrc) PK.hdLater(c, () => tint(fineSrc));
    blueprints.set(spr, c);
    return c;
  }

  PK.buildings = {
    get,
    banner: bannerFrames,
    flag: flagFrames,
    rubble,
    blueprint,
    teamOf: type => (type === "citadel" ? "red" : "blue")
  };
})();
