/*
 * Bitmap fonts drawn with the same pixel grid as everything else.
 *   "5": 5x7 capitals + digits, with Czech diacritics built from marks.
 *   "3": tiny 3x5 capitals + digits for hotkeys, cooldowns, damage numbers.
 * Text is rasterised once per (string, colour, style) and cached.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const { Pix } = PK;

  const parse = table => {
    const out = {};
    for (const [ch, rows] of Object.entries(table)) out[ch] = rows.split(" ");
    return out;
  };

  const G5 = parse({
    " ": ".. .. .. .. .. .. ..",
    A: ".XXX. X...X X...X XXXXX X...X X...X X...X",
    B: "XXXX. X...X X...X XXXX. X...X X...X XXXX.",
    C: ".XXX. X...X X.... X.... X.... X...X .XXX.",
    D: "XXXX. X...X X...X X...X X...X X...X XXXX.",
    E: "XXXXX X.... X.... XXXX. X.... X.... XXXXX",
    F: "XXXXX X.... X.... XXXX. X.... X.... X....",
    G: ".XXX. X...X X.... X.XXX X...X X...X .XXX.",
    H: "X...X X...X X...X XXXXX X...X X...X X...X",
    I: "XXX .X. .X. .X. .X. .X. XXX",
    J: "...X ...X ...X ...X ...X X..X .XX.",
    K: "X...X X..X. X.X.. XX... X.X.. X..X. X...X",
    L: "X.... X.... X.... X.... X.... X.... XXXXX",
    M: "X...X XX.XX X.X.X X.X.X X...X X...X X...X",
    N: "X...X XX..X X.X.X X..XX X...X X...X X...X",
    O: ".XXX. X...X X...X X...X X...X X...X .XXX.",
    P: "XXXX. X...X X...X XXXX. X.... X.... X....",
    Q: ".XXX. X...X X...X X...X X.X.X X..X. .XX.X",
    R: "XXXX. X...X X...X XXXX. X.X.. X..X. X...X",
    S: ".XXXX X.... X.... .XXX. ....X ....X XXXX.",
    T: "XXXXX ..X.. ..X.. ..X.. ..X.. ..X.. ..X..",
    U: "X...X X...X X...X X...X X...X X...X .XXX.",
    V: "X...X X...X X...X X...X X...X .X.X. ..X..",
    W: "X...X X...X X...X X.X.X X.X.X XX.XX X...X",
    X: "X...X X...X .X.X. ..X.. .X.X. X...X X...X",
    Y: "X...X X...X .X.X. ..X.. ..X.. ..X.. ..X..",
    Z: "XXXXX ....X ...X. ..X.. .X... X.... XXXXX",
    0: ".XXX. X...X X..XX X.X.X XX..X X...X .XXX.",
    1: "..X.. .XX.. ..X.. ..X.. ..X.. ..X.. .XXX.",
    2: ".XXX. X...X ....X ...X. ..X.. .X... XXXXX",
    3: "XXXX. ....X ....X .XXX. ....X ....X XXXX.",
    4: "...X. ..XX. .X.X. X..X. XXXXX ...X. ...X.",
    5: "XXXXX X.... XXXX. ....X ....X X...X .XXX.",
    6: ".XXX. X.... X.... XXXX. X...X X...X .XXX.",
    7: "XXXXX ....X ...X. ..X.. .X... .X... .X...",
    8: ".XXX. X...X X...X .XXX. X...X X...X .XXX.",
    9: ".XXX. X...X X...X .XXXX ....X ....X .XXX.",
    ".": ". . . . . . X",
    ",": ".. .. .. .. .. .X X.",
    ":": ". . X . X . .",
    "!": "X X X X X . X",
    "?": ".XXX. X...X ....X ...X. ..X.. ..... ..X..",
    "-": "... ... ... XXX ... ... ...",
    "+": "..... ..X.. ..X.. XXXXX ..X.. ..X.. .....",
    "/": "....X ....X ...X. ..X.. .X... X.... X....",
    "(": "..X .X. X.. X.. X.. .X. ..X",
    ")": "X.. .X. ..X ..X ..X .X. X..",
    "%": "XX..X XX..X ...X. ..X.. .X... X..XX X..XX",
    "'": "X X . . . . .",
    "·": ". . . X . . .",
    "×": "..... X...X .X.X. ..X.. .X.X. X...X .....",
    "=": "..... ..... XXXXX ..... XXXXX ..... .....",
    "<": "...X. ..X.. .X... X.... .X... ..X.. ...X.",
    ">": ".X... ..X.. ...X. ....X ...X. ..X.. .X...",
    "*": "..... X.X.X .XXX. XXXXX .XXX. X.X.X .....",
    "_": "..... ..... ..... ..... ..... ..... XXXXX",
    "•": "..... ..... .XXX. .XXX. .XXX. ..... .....",
    "\"": "X.X X.X ... ... ... ... ..."
  });

  const G3 = parse({
    " ": ". . . . .",
    A: ".X. X.X XXX X.X X.X",
    B: "XX. X.X XX. X.X XX.",
    C: ".XX X.. X.. X.. .XX",
    D: "XX. X.X X.X X.X XX.",
    E: "XXX X.. XX. X.. XXX",
    F: "XXX X.. XX. X.. X..",
    G: ".XX X.. X.X X.X .XX",
    H: "X.X X.X XXX X.X X.X",
    I: "XXX .X. .X. .X. XXX",
    J: "..X ..X ..X X.X .X.",
    K: "X.X X.X XX. X.X X.X",
    L: "X.. X.. X.. X.. XXX",
    M: "X.X XXX XXX X.X X.X",
    N: "XX. X.X X.X X.X X.X",
    O: ".X. X.X X.X X.X .X.",
    P: "XX. X.X XX. X.. X..",
    Q: ".X. X.X X.X XX. .XX",
    R: "XX. X.X XX. X.X X.X",
    S: ".XX X.. .X. ..X XX.",
    T: "XXX .X. .X. .X. .X.",
    U: "X.X X.X X.X X.X XXX",
    V: "X.X X.X X.X X.X .X.",
    W: "X.X X.X XXX XXX X.X",
    X: "X.X X.X .X. X.X X.X",
    Y: "X.X X.X .X. .X. .X.",
    Z: "XXX ..X .X. X.. XXX",
    0: "XXX X.X X.X X.X XXX",
    1: ".X. XX. .X. .X. XXX",
    2: "XX. ..X .X. X.. XXX",
    3: "XX. ..X .X. ..X XX.",
    4: "X.X X.X XXX ..X ..X",
    5: "XXX X.. XX. ..X XX.",
    6: ".XX X.. XXX X.X XXX",
    7: "XXX ..X .X. .X. .X.",
    8: "XXX X.X XXX X.X XXX",
    9: "XXX X.X XXX ..X XX.",
    "/": "..X ..X .X. X.. X..",
    ".": ". . . . X",
    ":": ". X . X .",
    "+": "... .X. XXX .X. ...",
    "-": "... ... XXX ... ...",
    "%": "X.X ..X .X. X.. X.X",
    "!": "X X X . X",
    "?": "XX. ..X .X. ... .X."
  });

  const TABLES = { 5: G5, 3: G3 };
  const GH = { 5: 7, 3: 5 };
  const TOP = { 5: 2, 3: 0 };

  const MARKS = {
    "\u030c": { 5: [".X.X.", "..X.."], 3: ["...", "..."] },
    "\u0301": { 5: ["...X.", "..X.."], 3: ["...", "..."] },
    "\u030a": { 5: ["..XX.", "..XX."], 3: ["...", "..."] }
  };

  function glyphOf(ch, font) {
    const table = TABLES[font];
    if (table[ch]) return { rows: table[ch], mark: null };

    const dec = ch.normalize("NFD");
    if (dec.length > 1 && table[dec[0]]) {
      return { rows: table[dec[0]], mark: dec[1] };
    }

    return { rows: table["?"] || table[" "], mark: null };
  }

  function markFor(mark, width, font) {
    const m = MARKS[mark];
    if (!m || font !== "5") return null;

    if (width >= 5) return m[5];
    if (width === 3) {
      return mark === "\u0301" ? ["..X", ".X."] : ["X.X", ".X."];
    }
    return ["..X.", ".X.."].map(r => r.slice(0, width));
  }

  function textWidth(str, font = "5", scale = 1) {
    let w = 0;

    for (const ch of String(str).toUpperCase()) {
      w += glyphOf(ch, font).rows[0].length + 1;
    }

    return Math.max(0, w - 1) * scale;
  }

  const cache = new Map();

  function build(str, font, scale, color, shadow, outline) {
    const gh = GH[font];
    const top = TOP[font];
    const pad = outline == null ? 0 : scale;
    const sh = shadow == null ? 0 : scale;
    const tw = textWidth(str, font, scale);
    const p = new Pix(tw + pad * 2 + sh, (top + gh) * scale + pad * 2 + sh);

    const plot = (ox, oy, c) => {
      let x = 0;

      for (const ch of str) {
        const { rows, mark } = glyphOf(ch, font);

        for (let r = 0; r < rows.length; r++) {
          for (let k = 0; k < rows[r].length; k++) {
            if (rows[r][k] === "X") {
              p.rect(
                (x + k) * scale + ox,
                (top + r) * scale + oy,
                scale, scale, c
              );
            }
          }
        }

        const mr = mark && markFor(mark, rows[0].length, font);

        if (mr) {
          for (let r = 0; r < mr.length; r++) {
            for (let k = 0; k < mr[r].length; k++) {
              if (mr[r][k] === "X") {
                p.rect(
                  (x + k) * scale + ox,
                  (top - 2 + r) * scale + oy,
                  scale, scale, c
                );
              }
            }
          }
        }

        x += rows[0].length + 1;
      }
    };

    if (outline != null) {
      for (const [dx, dy] of [
        [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]
      ]) plot(pad + dx * scale, pad + dy * scale, outline);
    }

    if (shadow != null) plot(pad + scale, pad + scale, shadow);
    plot(pad, pad, color);

    return {
      c: p.toCanvas(),
      pad,
      padTop: pad + top * scale
    };
  }

  /*
   * text(g, str, x, y, color, opts)
   * x, y = left / top of the capital letters. Returns the drawn width.
   * opts: align "left"|"center"|"right", scale, font, shadow (colour or null), outline, alpha
   */
  function text(g, str, x, y, color = PK.C.white, opts = {}) {
    str = String(str).toUpperCase();
    if (!str) return 0;

    const font = opts.font || "5";
    const scale = opts.scale || 1;
    const shadow = opts.shadow === undefined ? PK.C.ink : opts.shadow;
    const outline = opts.outline == null ? null : opts.outline;
    const key = `${font}|${scale}|${color}|${shadow}|${outline}|${str}`;

    let spr = cache.get(key);

    if (!spr) {
      if (cache.size > 900) cache.clear();
      spr = build(str, font, scale, color, shadow, outline);
      cache.set(key, spr);
    }

    const w = textWidth(str, font, scale);
    let dx = Math.round(x);

    if (opts.align === "center") dx -= Math.floor(w / 2);
    else if (opts.align === "right") dx -= w;

    if (opts.alpha != null && opts.alpha < 1) g.globalAlpha = opts.alpha;
    g.drawImage(spr.c, dx - spr.pad, Math.round(y) - spr.padTop);
    if (opts.alpha != null && opts.alpha < 1) g.globalAlpha = 1;

    return w;
  }

  /* Greedy word wrap using the real glyph widths. */
  function wrap(str, maxW, font = "5") {
    const words = String(str).split(" ");
    const lines = [];
    let line = "";

    for (const word of words) {
      const next = line ? `${line} ${word}` : word;

      if (textWidth(next, font) <= maxW || !line) {
        line = next;
      } else {
        lines.push(line);
        line = word;
      }
    }

    if (line) lines.push(line);
    return lines;
  }

  PK.text = text;
  PK.textWidth = textWidth;
  PK.wrap = wrap;
})();
