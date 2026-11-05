/*
 * Vlajky jazyků pro přepínač (PK.i18n.bindPicker): česká, britská a slezská orlice pro po našimu.
 * Kreslí se bod po bodu v mřížce 36×24 a zobrazují 1:1 (image-rendering: pixelated), takže
 * zůstávají ostré i na displejích s vyšší hustotou. Nezávisí na js/pixel.js, protože úvodní
 * stránka a editor staví přepínač dřív, než se načte grafika hry.
 */
(() => {
  "use strict";

  const PK = (window.PK = window.PK || {});
  const W = 36;
  const H = 24;

  const rgb = (r, g, b) => (r << 16) | (g << 8) | b;
  const part = (c, s) => (c >> s) & 255;
  const mix = (a, b, t) => rgb(
    Math.round(part(a, 16) + (part(b, 16) - part(a, 16)) * t),
    Math.round(part(a, 8) + (part(b, 8) - part(a, 8)) * t),
    Math.round(part(a, 0) + (part(b, 0) - part(a, 0)) * t)
  );

  const INK = 0x15121f;
  const LIGHT = 0xfff6cc;
  const DUSK = 0x31294a;
  const WHITE = 0xf4f0e6;
  const RED = 0xd2303c;

  // plátno jako pole barev 0xRRGGBB; fill(x, y) vrátí barvu bodu
  function paint(fill) {
    const d = new Uint32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d[y * W + x] = fill(x, y) >>> 0;
    return d;
  }

  // látka: světlo zleva shora (jako všude ve hře), tmavší lem 1 px kolem dokola
  function cloth(d) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let c = d[y * W + x];
        const t = (1 - x / (W - 1)) * 0.5 + (1 - y / (H - 1)) * 0.5; // 1 vlevo nahoře, 0 vpravo dole
        c = t > 0.5 ? mix(c, LIGHT, (t - 0.5) * 0.24) : mix(c, DUSK, (0.5 - t) * 0.3);
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) c = mix(c, INK, 0.4);
        d[y * W + x] = c;
      }
    }
  }

  /* ---------- čeština: bílá, červená, modrý klín ---------- */
  function cs() {
    const blue = 0x2a4d9c;
    return paint((x, y) => {
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (cx < W / 2 - 1.5 * Math.abs(cy - H / 2)) return blue;
      return cy < H / 2 ? WHITE : RED;
    });
  }

  /* ---------- angličtina: Union Jack ---------- */
  function en() {
    const blue = 0x1e3b8c;
    const L = Math.hypot(W, H);
    return paint((x, y) => {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const dx = Math.abs(cx - W / 2);
      const dy = Math.abs(cy - H / 2);
      if (dx < 2 || dy < 2) return RED; // kříž sv. Jiří
      if (dx < 4 || dy < 4) return WHITE; // jeho bílý lem
      const d1 = Math.abs(H * cx - W * cy) / L; // úhlopříčka z levého horního rohu
      const d2 = Math.abs(H * cx + W * cy - W * H) / L; // z pravého horního rohu
      const d = Math.min(d1, d2);
      if (d < 0.8) return RED; // kříž sv. Patrika
      if (d < 2.6) return WHITE; // kříž sv. Ondřeje
      return blue;
    });
  }

  /* ---------- po našimu: slezská orlice, černá na zlatém poli ----------
   * Hlava vlevo s korunou a červeným zobákem, roztažená křídla, stříbrné perizonium
   * (pásek s jetelovými konci přes hruď a křídla), červené pařáty. */
  const EAGLE = [
    ".............g.g.g............",
    ".............ggggg............",
    "..............kkk.............",
    "...........rrkekkk............",
    "............rkkkkk............",
    ".k............kkk............k",
    ".kk..k........kkk........k..kk",
    ".kkk.kk..k....kkk....k..kk.kkk",
    ".kkkkkkk.kkk.kkkkk.kkk.kkkkkkk",
    ".kkkkkkkkkkkkkkkkkkkkkkkkkkkkk",
    ".kkkkkkkkkkkkkkkkkkkkkkkkkkkkk",
    ".kkkkkkkkkkkkkkkkkkkkkkkkkkkkk",
    ".kkwkkkkkkkkkkkkkkkkkkkkkkkwkk",
    ".kwwwwwwwwwkkkkkkkkkwwwwwwwwwk",
    "..kwkkkkkkkwwwwwwwwwkkkkkkkwk.",
    "...kkkkkkkkkkkkkkkkkkkkkkkkk..",
    "....kkk.kkkkkkkkkkkkkkk.kkk...",
    ".....kk...kkkkkkkkkkk...kk....",
    ".........kk.kkkkkkk.kk........",
    "........rr..kkkkkkk..rr.......",
    "...........kkkkkkkkk..........",
    "...........k.k.k.k.k.........."
  ];
  const EAGLE_X = 3;
  const EAGLE_Y = 1;

  function szl() {
    const gold = 0xf2c23a;
    const col = { k: 0x1a1726, h: 0x3a3450, w: 0xe8e6e8, r: 0xd63c3c, e: 0xf7f1df, g: 0xfff0a0 };
    const at = (x, y) => {
      const row = EAGLE[y - EAGLE_Y];
      const ch = row ? row[x - EAGLE_X] : ".";
      return ch && ch !== "." ? ch : null;
    };
    return paint((x, y) => {
      const ch = at(x, y);
      if (ch) {
        if (ch !== "k") return col[ch];
        // peří: světlejší šikmé proužky na křídlech
        const ex = x - EAGLE_X;
        const ey = y - EAGLE_Y;
        if (ey >= 9 && ey <= 16 && (ex < 11 ? (ex + ey) % 4 === 0 : ex > 19 && (30 - ex + ey) % 4 === 0)) return col.h;
        return col.k;
      }
      // lem kolem orlice: zlatá ztmavená k inkoustu (koruna díky němu nesplyne s polem)
      if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) return mix(gold, INK, 0.38);
      return gold;
    });
  }

  const draw = { cs, en, szl };
  const urls = {};

  function canvas(id) {
    if (!draw[id]) return null;
    const d = draw[id]();
    cloth(d);
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d");
    const img = g.createImageData(W, H);
    const u = new Uint32Array(img.data.buffer);
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      u[i] = (0xff000000 | ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff)) >>> 0;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  // data URL se hodí do <img>, které jde na stránce opakovat bez kreslení znovu
  function url(id) {
    if (!(id in urls)) {
      const c = canvas(id);
      urls[id] = c ? c.toDataURL() : "";
    }
    return urls[id];
  }

  PK.flags = { W, H, canvas, url };
})();
