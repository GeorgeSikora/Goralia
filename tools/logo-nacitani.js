/*
 * Loga vložená přímo do stránek (data URI), aby byla vidět hned při prvním vykreslení,
 * dřív než se stáhnou skripty hry:
 *  - index.html (/play): logo načítací obrazovky = stejné pixely jako logo v menu (PK.hud.drawLogo),
 *    takže při přechodu do menu se nezmění ani o bod,
 *  - uvod.html (/): nápis v úvodu = PK.icons.wordmark().
 * Obojí v běžné i zimní podobě (čepička sněhu z winter.js).
 *
 * Spuštění (po změně loga, ikon nebo zimní čepičky; běžící server, Playwright):
 *   node tools/logo-nacitani.js [http://localhost:3000]
 * Na localhostu načítací obrazovka sama upozorní v konzoli, když vložené logo nesedí.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://localhost:3000";
const ROOT = path.join(__dirname, "..");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const shots = {};

  for (const [key, query] of [["normal", "?zima=0"], ["winter", "?zima=1"]]) {
    await page.goto(`${BASE}/play${query}`);
    await page.waitForFunction(() => document.querySelector("#logo").width > 1 && window.PK && PK.icons);
    shots[key] = await page.evaluate(() => {
      const shot = c => ({ w: c.width, h: c.height, url: c.toDataURL("image/png") });
      let word = PK.icons.wordmark();
      if (PK.winter && PK.winter.on) word = PK.winter.capLogo(word);
      const copy = document.createElement("canvas");
      copy.width = word.width;
      copy.height = word.height;
      copy.getContext("2d").drawImage(word, 0, 0);
      return { menu: shot(document.querySelector("#logo")), word: shot(copy) };
    });
  }
  await browser.close();

  const patch = (file, edits) => {
    const p = path.join(ROOT, file);
    let html = fs.readFileSync(p, "utf8");
    for (const [re, value] of edits) {
      if (!re.test(html)) throw new Error(`V ${file} chybí ${re}`);
      html = html.replace(re, value);
    }
    fs.writeFileSync(p, html);
  };

  const { normal, winter } = shots;
  patch("index.html", [
    [/(id="ld-logo" src=")data:image\/png;base64,[^"]*(")/, `$1${normal.menu.url}$2`],
    [/(id="ld-logo"[^>]*width=")\d+(" height=")\d+(")/, `$1${normal.menu.w}$2${normal.menu.h}$3`],
    [/(var WINTER_LOGO = ")data:image\/png;base64,[^"]*(")/, `$1${winter.menu.url}$2`],
    [/(<canvas id="logo"[^>]*width=")\d+(" height=")\d+(")/, `$1${normal.menu.w}$2${normal.menu.h}$3`]
  ]);
  patch("uvod.html", [
    [/(id="hero-wordmark" src=")data:image\/png;base64,[^"]*(")/, `$1${normal.word.url}$2`],
    [/(id="hero-wordmark"[^>]*width=")\d+(" height=")\d+(")/, `$1${normal.word.w}$2${normal.word.h}$3`],
    [/(var WINTER_LOGO = ")data:image\/png;base64,[^"]*(")/, `$1${winter.word.url}$2`]
  ]);
  console.log(`menu ${normal.menu.w}x${normal.menu.h} -> index.html, nápis ${normal.word.w}x${normal.word.h} -> uvod.html`);
})();
