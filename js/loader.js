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
    "rules", "cosmetics", "maps", "nav", "ai", "sim", "admincmd", "audio", "music", "pixel", "shaders", "font", "keys",
    "units", "fame", "buildings", "props", "decor", "halloween", "winter", "icons", "biomes", "krajiny", "world", "fx", "critters", "hud", "net", "menubg",
    "custommaps", "charts", "matchview", "account", "events", "challenges", "voice", "chat", "voicechat", "adminbar", "tutorial", "game"
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
    "Vyber hrdinu a sesílej schopnosti klávesami Q, W a E.",
    "Vyhrává poslední, komu zůstane hlavní budova.",
    "Kolečkem myši měníš přiblížení, prostředním tlačítkem posouváš mapu."
  ];
  // Halloween (20. 10. - 2. 11.): sezónní tip; halloween.js se načítá až s ostatními skripty
  const hd = new Date();
  if ((hd.getMonth() === 9 && hd.getDate() >= 20) || (hd.getMonth() === 10 && hd.getDate() <= 2)) TIPS.push("Halloween! Na mapách svítí dýně a v noci létají netopýři.");
  // Zima (1. 12. - 6. 1., nebo ?zima=1): tip na dárky
  let snowy = hd.getMonth() === 11 || (hd.getMonth() === 0 && hd.getDate() <= 6);
  try {
    const q = new URLSearchParams(location.search).get("zima");
    const f = q === "1" || q === "0" ? q : localStorage.getItem("pk-winter");
    if (f === "1" || f === "0") snowy = f === "1";
  } catch (e) { /* kalendář */ }
  if (snowy) TIPS.push("Zima! Na mapě leží dárky. Pošli pro ně dělníka a dostaneš zlato.");

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

  // Logo je obrázek vložený v index.html (vidět hned, bez čekání na skripty). Na localhostu
  // ověříme, že pořád sedí s kreslením v menu, jinak by se při přechodu do menu změnilo.
  function checkLogo() {
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || !PK.hud || !logo.complete) return;
    try {
      const want = document.createElement("canvas");
      PK.hud.drawLogo(want);
      const have = document.createElement("canvas");
      have.width = logo.naturalWidth;
      have.height = logo.naturalHeight;
      have.getContext("2d").drawImage(logo, 0, 0);
      if (have.toDataURL() !== want.toDataURL()) console.warn("Logo načítací obrazovky nesedí s menu: spusť node tools/logo-nacitani.js");
    } catch (e) { /* jen kontrola pro vývoj */ }
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
    root.classList.remove("done", "leaving");
    logo.style.transform = "";
    logo.closest(".ld-box").style.setProperty("--ld-dy", "0px"); // před zápasem menu pod obrazovkou není
    root.setAttribute("aria-busy", "true");
    open = true;
    setText(text);
    tip.textContent = note || "";
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

  /* První odchod do menu: pruh a texty zmizí, pozadí se rozplyne do scény menu a logo
   * plynule dojede přesně na místo loga v menu (stejné pixely), kde ho vystřídá. Pak
   * shora dolů najede obsah menu. Když menu není vidět, obyčejně se rozplyne. */
  function revealMenu() {
    const body = document.body;
    const menu = document.querySelector("#menu");
    const target = document.querySelector("#logo");
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const unlock = () => {
      if (!body.classList.contains("booting")) return;
      body.classList.remove("booting");
      if (!menu || calm) return;
      // obsah aktuální stránky menu postupně shora dolů
      const items = [menu.querySelector(".tagline"), ...menu.querySelectorAll(".page:not([hidden]) > *"), menu.querySelector(".footer")]
        .filter(el => el && !el.hidden && el.offsetParent !== null);
      items.forEach((el, i) => el.style.setProperty("--d", `${Math.min(i, 10) * 0.05}s`));
      menu.classList.add("intro");
      setTimeout(() => {
        menu.classList.remove("intro");
        items.forEach(el => el.style.removeProperty("--d"));
      }, 1200);
    };

    setProgress(1);
    root.setAttribute("aria-busy", "false");
    removeEventListener("resize", realign);

    hideTimer = setTimeout(() => {
      const a = logo.getBoundingClientRect();
      const b = target && menu && !menu.hidden ? target.getBoundingClientRect() : null;
      const fits = b && b.width > 1 && a.height > 0 && b.top >= 0 && b.bottom <= innerHeight;
      if (!fits || calm) {
        unlock();
        hide();
        return;
      }

      const k = b.height / a.height;
      target.style.visibility = "hidden"; // logo v menu se ukáže, až to z načítání doletí
      root.classList.add("leaving");
      logo.style.transform = `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${k})`;

      const land = () => {
        logo.removeEventListener("transitionend", land);
        if (root.hidden) return;
        clearTimeout(hideTimer);
        clearTimeout(early);
        unlock();
        target.style.visibility = ""; // stejné pixely na stejném místě: výměna není vidět
        root.hidden = true;
        open = false;
        root.classList.remove("leaving");
        logo.style.transform = "";
      };
      logo.addEventListener("transitionend", land);
      const early = setTimeout(unlock, 380); // obsah menu začne najíždět už během doletu loga
      hideTimer = setTimeout(land, 750); // pojistka, kdyby transitionend nepřišel
    }, 260);
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

  // logo stojí na místě loga v menu i po změně velikosti okna (jinak se během načítání nehýbe;
  // případný malý rozdíl po překladu textů menu dorovná na konci plynulý dojezd)
  const realign = () => { if (PK.alignLoader) PK.alignLoader(); };
  addEventListener("resize", realign);

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
        if (done === SCRIPTS.length && !bootCalled) { // hra se nepřihlásila, nic nedržet
          document.body.classList.remove("booting");
          hide();
        }
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
    checkLogo();

    let bake = 0;
    let voices = PK.voice && PK.voice.enabled ? 0 : 1;
    const sum = () => setProgress(SHARE.scripts + SHARE.bake * bake + SHARE.voices * voices);

    const voiceDone = voices ? Promise.resolve() : PK.voice.preload((n, total) => {
      voices = total ? n / total : 1;
      sum();
    }).catch(() => {});

    const finish = () => {
      try { ready(); } finally { revealMenu(); }
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
    get covering() { return !root.hidden && !root.classList.contains("done") && !root.classList.contains("leaving"); }
  };
  loadScripts();
})();
