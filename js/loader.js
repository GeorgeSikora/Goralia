/*
 * Načítací obrazovka: postupně načte skripty hry, předem upeče sprity
 * (jemná dvojčata jednotek a budov), terén výchozí mapy a stáhne hlasy
 * postav. Hra se ukáže až s hotovými podklady, takže pak necuká.
 *
 * Těžké pečení běží po kouscích (generátory vracejí průběh 0..1, text
 * mění popisek); mezi kousky se překreslí pruh a dělník s nákladem zlata.
 * Stejná obrazovka překrývá menu i při startu zápasu na dosud neupečené mapě.
 */
(() => {
  "use strict";

  const PK = (window.PK = window.PK || {});

  const SCRIPTS = [
    "rules", "maps", "nav", "ai", "sim", "admincmd", "audio", "music", "pixel", "shaders", "font", "keys",
    "units", "buildings", "props", "icons", "world", "fx", "hud", "net", "menubg",
    "custommaps", "charts", "matchview", "account", "voice", "chat", "voicechat", "adminbar", "game"
  ];

  // podíl jednotlivých částí na celkovém pruhu při prvním načtení
  const SHARE = { scripts: 0.2, bake: 0.6, voices: 0.2 };
  const BUDGET = 45; // ms práce mezi dvěma překresleními (pruh se hýbe i tak, zbytek je režie)
  const VOICE_WAIT = 8000; // déle na hlasy nečekáme, dotáhnou se na pozadí

  const TIPS = [
    "Přes vodu se chodí jen po brodech.",
    "Buda zvedne limit jednotek o 5.",
    "Ctrl + číslo uloží výběr do skupiny, dvojí stisk čísla na ni skočí kamerou.",
    "Kovárna vylepšuje zbroj a zbraně všech jednotek.",
    "Hrdina umí ohnivou kouli (A) a léčení (S).",
    "Vyhrává poslední, komu zůstane hlavní budova.",
    "Kolečkem myši měníš přiblížení, prostředním tlačítkem posouváš mapu."
  ];

  const root = document.querySelector("#loading");
  if (!root) return;

  const fill = root.querySelector(".ld-fill");
  const track = root.querySelector(".ld-track");
  const label = root.querySelector(".ld-text");
  const pct = root.querySelector(".ld-pct");
  const tip = root.querySelector(".ld-tip");
  const logo = root.querySelector(".ld-logo");
  const walker = root.querySelector(".ld-walker");
  const wg = walker.getContext("2d");

  let target = 0; // skutečný průběh 0..1
  let shown = 0; // vykreslený (dobíhá za skutečným)
  let walked = 0; // ušlá vzdálenost dělníka pro střídání snímků chůze
  let open = true;
  let ticking = false;
  let hideTimer = 0;

  /* ---------- vzhled ---------- */
  function setText(text) {
    if (text) label.textContent = text;
  }

  function setProgress(p) {
    target = Math.max(target, Math.min(1, p));
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(tick);
    }
  }

  function drawLogo() {
    if (logo.dataset.done || !PK.hud || !PK.hud.drawLogo) return;
    try {
      PK.hud.drawLogo(logo);
      logo.dataset.done = "1";
      logo.classList.add("ready");
    } catch (e) { /* logo počká na další skript */ }
  }

  function drawWalker(moving) {
    const U = PK.units;
    if (!U || !PK.hdOf) return;

    const n = U.frameCount("walk");
    const rec = moving
      ? U.frame("worker", "blue", "walk_gold", Math.floor(walked / 7) % n)
      : U.frame("worker", "blue", "idle_gold", Math.floor(performance.now() / 260));
    const img = PK.hdOf(rec.c) || rec.c;

    if (walker.width !== img.width || walker.height !== img.height) {
      walker.width = img.width;
      walker.height = img.height;
    }

    wg.imageSmoothingEnabled = false;
    wg.clearRect(0, 0, walker.width, walker.height);
    wg.drawImage(img, 0, 0);
    walker.classList.add("ready");
  }

  function tick() {
    const before = shown;
    shown += (target - shown) * 0.18;
    if (target - shown < 0.002) shown = target;

    const w = track.clientWidth;
    walked += (shown - before) * w;
    fill.style.width = `${(shown * 100).toFixed(2)}%`;
    walker.style.transform = `translateX(${Math.round(shown * w)}px)`;
    const v = Math.round(shown * 100);
    pct.textContent = `${v} %`;
    root.setAttribute("aria-valuenow", String(v));

    try { drawWalker(shown - before > 0.0004); } catch (e) { /* dělník je jen ozdoba */ }

    if (open) requestAnimationFrame(tick);
    else ticking = false;
  }

  function show(text, note) {
    clearTimeout(hideTimer);
    target = 0;
    shown = 0;
    root.hidden = false;
    root.classList.remove("done");
    root.setAttribute("aria-busy", "true");
    open = true;
    setText(text);
    tip.textContent = note || "";
    drawLogo();
    setProgress(0);
  }

  function hide() {
    setProgress(1);
    root.setAttribute("aria-busy", "false");
    // pruh ještě dojede na konec, pak obrazovka zmizí
    hideTimer = setTimeout(() => {
      root.classList.add("done");
      hideTimer = setTimeout(() => {
        root.hidden = true;
        open = false;
      }, 320);
    }, 180);
  }

  /* ---------- běh práce po kouscích ---------- */
  // rAF ve skryté záložce stojí; setTimeout zajistí, že načítání doběhne i tam
  const nextFrame = () => new Promise(resolve => {
    let done = false;
    const go = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(go);
    setTimeout(go, 60);
  });

  // steps vrací čísla (průběh 0..1), řetězce (popisek) nebo Promise (počká na ni)
  async function drive(steps, onProgress, onSlice) {
    for (let first = true; ; first = false) {
      const t0 = performance.now();

      for (;;) {
        const r = steps.next();
        if (r.done) return r.value;
        if (typeof r.value === "number") onProgress(r.value);
        else if (typeof r.value === "string") setText(r.value);
        else if (r.value && typeof r.value.then === "function") {
          await r.value; // čekání na síť (např. seznam map)
          break;
        }
        if (performance.now() - t0 > BUDGET) break;
      }

      if (onSlice) onSlice(first);
      await nextFrame();
    }
  }

  // průběh dílčí práce 0..1 přepočtený do úseku lo..hi (popisky projdou beze změny)
  function* span(steps, lo, hi) {
    for (;;) {
      const r = steps.next();
      if (r.done) return r.value;
      yield typeof r.value === "number" ? lo + (hi - lo) * Math.min(1, r.value) : r.value;
    }
  }

  /* ---------- první načtení stránky ---------- */
  let bootCalled = false;

  function loadScripts() {
    let done = 0;
    tip.textContent = `Tip: ${TIPS[Math.floor(Math.random() * TIPS.length)]}`;
    setText("Načítám hru…");

    for (const name of SCRIPTS) {
      const s = document.createElement("script");
      s.src = `js/${name}.js`;
      s.async = false; // spustí se ve správném pořadí
      s.onload = () => {
        setProgress(SHARE.scripts * ++done / SCRIPTS.length);
        if (name === "hud") drawLogo();
        if (done === SCRIPTS.length && !bootCalled) hide(); // hra se nepřihlásila, nic nedržet
      };
      s.onerror = () => {
        setText("Hru se nepodařilo načíst. Zkus obnovit stránku.");
        root.classList.add("failed");
      };
      document.body.appendChild(s);
    }
  }

  /* Zavolá game.js na konci: steps = pečení podkladů, ready = start smyčky hry. */
  function boot(steps, ready) {
    bootCalled = true;
    drawLogo();

    let bake = 0;
    let voices = PK.voice && PK.voice.enabled ? 0 : 1;
    const sum = () => setProgress(SHARE.scripts + SHARE.bake * bake + SHARE.voices * voices);

    const voiceDone = voices ? Promise.resolve() : PK.voice.preload((n, total) => {
      voices = total ? n / total : 1;
      sum();
    }).catch(() => {});

    const finish = () => {
      try { ready(); } finally { hide(); }
    };

    drive(steps, p => { bake = p; sum(); })
      .catch(e => { console.error(e); })
      .then(() => {
        bake = 1;
        sum();
        if (voices < 1) setText("Načítám hlasy postav…");
        return Promise.race([voiceDone, new Promise(r => setTimeout(r, VOICE_WAIT))]);
      })
      .then(finish);
  }

  /* Příprava před zápasem: když je všechno upečené, obrazovka se vůbec neukáže.
   * note = řádek pod pruhem (název mapy). */
  let busy = null;

  function prepare(steps, note) {
    if (busy) return busy;

    let text = "Připravuji…";
    const labelled = (function* () {
      for (;;) {
        const r = steps.next();
        if (r.done) return r.value;
        if (typeof r.value === "string") text = r.value;
        yield r.value;
      }
    })();

    busy = drive(labelled, p => setProgress(p), first => { if (first) show(text, note); })
      .catch(e => { console.error(e); })
      .then(value => {
        busy = null;
        if (open && !root.hidden) hide();
        return value;
      });

    return busy;
  }

  open = !root.hidden;
  PK.loader = {
    boot, prepare, span,
    get busy() { return !!busy; },
    // obrazovka zakrývá vše: animace pod ní (pozadí menu) nemusí kreslit
    get covering() { return !root.hidden && !root.classList.contains("done"); }
  };
  loadScripts();
})();
