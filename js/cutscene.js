/*
 * Kreslení kampaně: filmové lišty, dialogové okno s portrétem, titulky kapitol, zatemnění,
 * úkoly mise a světelný kruh pod postavou, která právě mluví. Stav dodává režisér (js/campaign.js),
 * kreslí se v art px do herního bufferu (jako HUD).
 */
(() => {
  "use strict";

  const PK = window.PK;
  const T = (g, s, x, y, color, opts) => PK.text(g, s, x, y, color, opts);
  const ease = t => t * t * (3 - 2 * t);

  const GOLD = 0xffe08a;
  const TEXT = 0xf2ecff;
  const DIM = 0x9b94b8;
  const OK = 0x9be38a;
  const BAD = 0xff8f7a;

  const BAR_TOP = 24;
  // spodní lišta zakryje i místo HUD a kus mapy nad ním
  const barBottom = V => V.h - V.mapH + 22;

  function portraitBox(g, line, x, y, T0) {
    g.fillStyle = "#0b0914";
    g.fillRect(x - 1, y - 1, 42, 42);
    g.fillStyle = "#b8741f";
    g.fillRect(x - 2, y - 2, 44, 1);
    g.fillRect(x - 2, y + 41, 44, 1);
    g.fillRect(x - 2, y - 2, 1, 44);
    g.fillRect(x + 41, y - 2, 1, 44);
    g.fillStyle = line.team === "red" ? "#2a1020" : "#1a2240";
    g.fillRect(x, y, 40, 40);
    g.save();
    g.beginPath();
    g.rect(x, y, 40, 40);
    g.clip();
    // ústa "mluví": portrét střídá dva snímky, dokud se píše text
    const talking = line.t * line.cps < line.text.length;
    g.drawImage(PK.units.portrait(line.type, line.team, talking ? Math.floor(T0 * 5) & 1 : 0), x, y);
    g.restore();
  }

  // Text psaný po písmenech; vrací, zda je už celý.
  function typed(g, line, x, y, w, maxLines, color = TEXT, align) {
    const lines = PK.wrap(line.text, w).slice(0, maxLines);
    let left = Math.floor(line.t * line.cps);
    let yy = y;

    for (const ln of lines) {
      if (left <= 0) break;
      T(g, ln.slice(0, left), align === "center" ? x + Math.round(w / 2) : x, yy, color, align ? { align } : undefined);
      left -= ln.length + 1;
      yy += 11;
    }

    return { full: left > 0, lines: lines.length };
  }

  /* ---------- cutscéna ---------- */
  function draw(g, st, V, T0) {
    const e = ease(Math.min(1, st.bars));
    const top = Math.round(BAR_TOP * e);
    const bb = barBottom(V);
    const bottom = Math.round(bb * e);

    g.fillStyle = "#000";
    if (top) g.fillRect(0, 0, V.w, top);
    // pod mapou nic není (HUD se v cutscéně nekreslí), lišta tam musí být vždy
    g.fillRect(0, Math.min(V.mapH, V.h - bottom), V.w, V.h);

    if (st.fade > 0.001) {
      g.globalAlpha = Math.min(1, st.fade);
      g.fillRect(0, 0, V.w, V.h);
      g.globalAlpha = 1;
    }

    if (st.title) {
      const t = st.title;
      const a = Math.min(1, t.t / 0.6, (t.dur - t.t) / 0.5);
      if (a > 0) {
        const cy = Math.round(V.h / 2) - 20;
        T(g, t.kicker, Math.round(V.w / 2), cy, GOLD, { align: "center", alpha: a });
        T(g, t.name, Math.round(V.w / 2), cy + 14, TEXT, { align: "center", scale: 2, alpha: a });
        g.globalAlpha = a;
        g.fillStyle = "#b8741f";
        const w = Math.min(160, PK.textWidth(t.name, "5", 2) + 24);
        g.fillRect(Math.round(V.w / 2 - w / 2), cy + 36, w, 1);
        g.globalAlpha = 1;
      }
    }

    if (e > 0.6 && st.skippable && st.fade < 0.95) T(g, "ESC: PŘESKOČIT", 8, 8, DIM, { alpha: Math.min(1, (e - 0.6) * 3) });

    const line = st.line;
    if (!line || e < 0.9) return;

    const y0 = V.h - bb;
    const w = Math.min(V.w - 24, 460);
    const x0 = Math.round((V.w - w) / 2);

    if (!line.who) {
      // vypravěč: text uprostřed lišty, bez portrétu
      const res = typed(g, line, x0, y0 + 16, w, 4, 0xe6dcc0, "center");
      if (res.full && Math.floor(T0 * 2.5) & 1) T(g, ">", Math.round(V.w / 2), y0 + 18 + res.lines * 11, GOLD, { align: "center" });
      return;
    }

    portraitBox(g, line, x0 + 2, y0 + 12, T0);
    T(g, line.who, x0 + 54, y0 + 12, GOLD);
    const res = typed(g, line, x0 + 54, y0 + 26, w - 58, 4);
    if (res.full && Math.floor(T0 * 2.5) & 1) T(g, ">", x0 + w - 6, y0 + 26 + Math.max(0, res.lines - 1) * 11, GOLD);
  }

  /* ---------- během hry: úkoly a hlášení postav ---------- */
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  function drawPlay(g, st, V, T0, left) {
    const rows = st.objectives.map(q => {
      let text = q.text;
      if (q.count) text += ` (${q.count})`;
      if (q.state === "open" && q.ends) text += ` ${mmss(left(q.key))}`;
      if (q.optional) text += " · nepovinné";
      return { q, text };
    });

    if (rows.length) {
      const w = Math.min(V.w - 200, Math.max(110, ...rows.map(r => PK.textWidth(r.text) + 22)));
      const h = 19 + rows.length * 10;
      const x = 3;
      const y = 21;
      g.drawImage(PK.hud.frame(w, h, "plaque"), x, y);
      T(g, "Úkoly", x + 7, y + 5, GOLD);

      rows.forEach((r, i) => {
        const yy = y + 16 + i * 10;
        const color = r.q.state === "done" ? OK : r.q.state === "failed" ? BAD : r.q.optional ? 0xc6bfe0 : TEXT;
        g.fillStyle = PK.css(color);
        if (r.q.state === "open") {
          g.fillRect(x + 7, yy + 2, 3, 1);
          g.fillRect(x + 7, yy + 4, 3, 1);
          g.fillRect(x + 7, yy + 2, 1, 3);
          g.fillRect(x + 9, yy + 2, 1, 3);
        } else {
          g.fillRect(x + 7, yy + 2, 3, 3);
        }
        T(g, r.text, x + 13, yy, color);
      });
    }

    // replika během hry ("hlášení"): okénko nad HUD vlevo, hra běží dál
    const line = st.line;
    if (!line || !line.inGame || !line.who) return;

    const w = Math.min(330, V.w - 160);
    const h = 52;
    const x = 4;
    const y = V.mapH - h - 4;
    const a = Math.min(1, line.t / 0.2, (line.dur + 0.3 - line.t) / 0.3);
    if (a <= 0) return;
    g.globalAlpha = a;
    g.drawImage(PK.hud.frame(w, h, "plaque"), x, y);
    g.globalAlpha = 1;
    portraitBox(g, line, x + 6, y + 6, T0);
    T(g, line.who, x + 54, y + 6, GOLD, { alpha: a });
    typed(g, line, x + 54, y + 18, w - 60, 3);
  }

  /* ---------- kruh pod mluvčím (svět, art px) ----------
   * Místo tlumeného týmového kroužku: jasný prstenec, který dýchá, z něj se šíří dvě vlny
   * a kolem obíhají jiskry. ring(rx, ry, barva) je ellipseRing z game.js (jemná mřížka). */
  function speakerRing(g, u, T0, ring, light) {
    const fx = Math.round(u.x / 2);
    const fy = Math.round(u.y / 2) + 6;
    const big = u.type === "knight" || u.type === "lich" || u.type === "abomination";
    const rx = big ? 13 : 10;
    const ry = big ? 5 : 4;
    const p = 0.5 + 0.5 * Math.sin(T0 * 7);

    if (light) light(fx, fy - 1, 22, GOLD, 0.22 + 0.12 * p);

    for (let k = 0; k < 2; k++) {
      const a = (T0 * 0.85 + k * 0.5) % 1;
      const r = Math.round(rx + 1 + a * 9);
      g.globalAlpha = (1 - a) * 0.75;
      g.drawImage(ring(r, Math.round(ry + a * 3.5), 0xfff6cc), fx - r - 1, fy - Math.round(ry + a * 3.5) - 1);
    }

    const grow = p > 0.55 ? 1 : 0;
    g.globalAlpha = 0.75 + 0.25 * p;
    g.drawImage(ring(rx + grow, ry, GOLD), fx - rx - grow - 1, fy - ry - 1);
    g.globalAlpha = 1;

    g.fillStyle = "#fff6cc";
    for (let k = 0; k < 6; k++) {
      const a = T0 * 2.2 + k * Math.PI / 3;
      const lift = Math.sin(T0 * 3 + k) > 0.3 ? 0.5 : 0;
      g.fillRect(Math.round((fx + Math.cos(a) * (rx + 1.5)) * 2) / 2, Math.round((fy + Math.sin(a) * (ry + 0.6) - lift) * 2) / 2, 0.5, 0.5);
    }
  }

  PK.cutscene = { draw, drawPlay, speakerRing };
})();
