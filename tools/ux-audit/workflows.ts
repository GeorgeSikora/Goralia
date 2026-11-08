// Hlavní workflows Goralie tak, jak je projde běžný hráč (a admin).
import type { Page } from "playwright";
import { Flow, worldToClient, hudButton, gameState, type Pt } from "./lib.ts";

export const USER = { name: "Testovac", email: "testovac@example.test", password: "HesloProTest42" };
export const RIVAL = { name: "Souper", email: "souper@example.test", password: "HesloProTest42" };
export const ADMIN = { name: process.env.UX_ADMIN_NAME || "admin", password: process.env.UX_ADMIN_PASSWORD || "adminheslo123" };

// base: workflow běží proti jinému serveru (funkce z neslité větve); bez proměnné prostředí se přeskočí.
export interface Workflow { id: string; slug: string; name: string; baseEnv?: string; note?: string; run: (f: Flow) => Promise<void> }

/* ---------- pomocníci ---------- */
async function api(f: Flow, page: Page, method: string, url: string, body?: unknown) {
  return page.evaluate(async ([m, u, b]) => {
    const r = await fetch(u as string, { method: m as string, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined, credentials: "same-origin" });
    return { status: r.status, body: await r.text() };
  }, [method, url, body] as const);
}

export async function ensureAccount(f: Flow, page: Page, who: { name: string; email: string; password: string }) {
  // příprava účtu (už existuje → 400) se nepočítá jako chyba aplikace
  const r = await f.expectErrors(() => api(f, page, "POST", "/api/auth/register", { name: who.name, email: who.email, password: who.password }));
  if (r.status >= 400) await api(f, page, "POST", "/api/auth/login", { identifier: who.email, password: who.password });
}

async function loginApi(f: Flow, page: Page, identifier: string, password: string) {
  const r = await api(f, page, "POST", "/api/auth/login", { identifier, password });
  if (r.status !== 200) throw new Error(`přihlášení ${identifier} přes API selhalo: ${r.status} ${r.body.slice(0, 120)}`);
}

// Otevře /play a počká na hlavní menu; vrací dobu načtení.
async function openGame(f: Flow, page = f.page) {
  await f.measure("/play → hlavní menu", async () => {
    const r = await f.expectErrors(() => page.goto(f.url("/play")));
    if (r && r.status() === 404) await page.goto(f.url("/")); // starší větve měly hru přímo na /
    await page.locator("#m-play").waitFor({ state: "visible", timeout: 60000 });
    // tlačítka jsou „vidět“ i pod načítací obrazovkou, menu je použitelné až po jejím zmizení
    await page.waitForFunction(() => { const l = document.getElementById("loading"); return !l || l.hidden; }, null, { timeout: 90000 });
  });
  await f.pause(900, page);
}

async function canvasClick(f: Flow, page: Page, p: Pt, button: "left" | "right" = "left", caption?: string) {
  if (caption) await f.caption(caption, page);
  await f.highlight(p.x - 22, p.y - 22, 44, 44, page, true);
  await page.mouse.move(p.x, p.y, { steps: f.slow ? 16 : 1 });
  await f.pause(450, page);
  await page.mouse.click(p.x, p.y, { button });
  await f.unhighlight(page);
  await f.pause(600, page);
}

async function canvasDrag(f: Flow, page: Page, a: Pt, b: Pt) {
  await page.mouse.move(a.x, a.y, { steps: f.slow ? 12 : 1 });
  await f.pause(300, page);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: f.slow ? 24 : 4 });
  await f.pause(250, page);
  await page.mouse.up();
  await f.pause(700, page);
}

async function clickHud(f: Flow, page: Page, type: string, label: string) {
  const b = await hudButton(page, type);
  if (!b) throw new Error(`tlačítko „${label}“ (${type}) na herním panelu není vidět`);
  await f.highlight(b.x, b.y, b.w, b.h, page);
  await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2, { steps: f.slow ? 16 : 1 });
  await f.pause(500, page);
  await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
  await f.unhighlight(page);
  await f.pause(600, page);
}

async function waitFor(page: Page, fn: () => Promise<boolean>, ms: number, what: string) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await page.waitForTimeout(400); }
  throw new Error(`nedočkal jsem se: ${what} (${Math.round(ms / 1000)} s)`);
}

// první pixel dané barvy v PNG screenshotu (jednoduchý dekodér přes zlib)
export async function findColor(png: Buffer, rgb: number[]): Promise<Pt | null> {
  const zlib = await import("node:zlib");
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  let off = 8; const idat: Buffer[] = [];
  while (off < png.length) { const len = png.readUInt32BE(off); const type = png.toString("ascii", off + 4, off + 8); if (type === "IDAT") idat.push(png.subarray(off + 8, off + 8 + len)); off += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(idat)); const bpp = png[25] === 6 ? 4 : 3, stride = w * bpp; /* barevný typ 6 = RGBA, 2 = RGB */ const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)]; const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pred = ft === 0 ? 0 : ft === 1 ? a : ft === 2 ? b : ft === 3 ? (a + b) >> 1 : (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      out[y * stride + x] = (line[x] + pred) & 255;
    }
  }
  // tlačítko je široký obdélník: hledám řádek s nejdelším během té barvy v pravé polovině
  let best: Pt | null = null, bestRun = 0;
  for (let y = 0; y < h; y += 2) {
    let run = 0;
    for (let x = Math.floor(w / 2); x < w; x++) {
      const i = y * stride + x * bpp;
      if (Math.abs(out[i] - rgb[0]) < 6 && Math.abs(out[i + 1] - rgb[1]) < 6 && Math.abs(out[i + 2] - rgb[2]) < 6) { run++; if (run > bestRun) { bestRun = run; best = { x: x - run / 2, y }; } }
      else run = 0;
    }
  }
  return bestRun > 20 ? best : null;
}

// Klik na pohybující se jednotku: pozici čtu znovu těsně před kliknutím, případně opakuji.
async function selectUnit(f: Flow, page: Page, pick: (s: Awaited<ReturnType<typeof gameState>>) => { id: number } | undefined, caption: string) {
  for (let i = 0; i < 6; i++) {
    const u0 = pick(await gameState(page));
    if (!u0) throw new Error("hledaná jednotka neexistuje");
    const at = async () => { const u = (await gameState(page)).units.find(x => x.id === u0.id)!; return worldToClient(page, u.x, u.y - 8); };
    let pt = await at();
    await f.caption(caption, page);
    await page.mouse.move(pt.x, pt.y, { steps: f.slow ? 14 : 1 });
    await f.pause(250, page);
    pt = await at();
    await f.highlight(pt.x - 20, pt.y - 20, 40, 40, page, true);
    await page.mouse.click(pt.x, pt.y);
    await f.unhighlight(page);
    await f.pause(500, page);
    const sel = (await gameState(page)).selected;
    if (sel.length === 1 && sel[0] === u0.id) return u0.id;
  }
  throw new Error("jednotku se nepodařilo vybrat kliknutím");
}

// Klik na budovu; když se trefím do jednotky před ní, zkusím jiné místo budovy.
async function selectBuilding(f: Flow, page: Page, b: { id: number; x: number; y: number }, caption: string) {
  for (const [dx, dy] of [[0, -30], [0, -12], [-18, -40], [18, -40], [0, -50], [-25, -15], [25, -15]]) {
    await canvasClick(f, page, await worldToClient(page, b.x + dx, b.y + dy), "left", caption);
    const sel = (await gameState(page)).selected;
    if (sel.length === 1 && sel[0] === b.id) return;
  }
  throw new Error(`budovu ${b.id} se nepodařilo vybrat kliknutím`);
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/* ---------- jedna hra: dělníci těží, stavba kasáren, výcvik, útok ---------- */
async function playSomeGame(f: Flow, page: Page, opts: { long: boolean }) {
  let s = await gameState(page);
  const me = s.me;
  const hall = s.buildings.find(b => b.team === me && b.type === "hall" || b.team === me)!;
  const enemyHall = s.buildings.find(b => b.team !== me)!;

  await f.step("Výběr dělníků tažením myši", async () => {
    const ws = s.units.filter(u => u.team === me && u.type === "worker");
    const xs = ws.map(u => u.x), ys = ws.map(u => u.y);
    const a = await worldToClient(page, Math.min(...xs) - 20, Math.min(...ys) - 28);
    const b = await worldToClient(page, Math.max(...xs) + 20, Math.max(...ys) + 14);
    await f.caption("Tažením myši vyberu všechny dělníky", page);
    await canvasDrag(f, page, a, b);
    s = await gameState(page);
    if (!s.selected.length) throw new Error("tažením se nevybrala žádná jednotka");
  });

  await f.step("Pravým klikem poslat dělníky těžit zlato", async () => {
    const mine = s.gold_mines.slice().sort((m1, m2) => dist(m1, hall) - dist(m2, hall))[0];
    await canvasClick(f, page, await worldToClient(page, mine.x, mine.y), "right", "Pravý klik na zlatý důl = těžba");
    await f.think(3500);
  });

  await f.step("Jeden dělník staví kasárna", async () => {
    s = await gameState(page);
    await selectUnit(f, page, st => st.units.find(u => u.team === me && u.type === "worker"), "Klik na jednoho dělníka");
    await clickHud(f, page, "barracks", "Kasárna");
    const before = (await gameState(page)).buildings.length;
    const dir = Math.sign(enemyHall.x - hall.x) || 1;
    const tries = [[90, -90], [90, 90], [130, 0], [60, -140], [60, 140], [170, -70], [170, 70], [0, -150], [0, 150]];
    for (const [dx, dy] of tries) {
      await canvasClick(f, page, await worldToClient(page, hall.x + dir * dx, hall.y + dy), "left", "Výběr místa pro kasárna");
      await page.waitForTimeout(500);
      if ((await gameState(page)).buildings.length > before) return;
    }
    throw new Error("kasárna se nepodařilo umístit na žádné z 9 zkoušených míst");
  });

  await f.step("Hlavní budova cvičí dalšího dělníka", async () => {
    await selectBuilding(f, page, hall as any, "Klik na hlavní budovu");
    await clickHud(f, page, "worker", "Dělník");
  });

  await f.step("Čekání na dostavbu kasáren", async () => {
    await f.caption("Stavba kasáren běží…", page);
    await waitFor(page, async () => (await gameState(page)).buildings.some(b => b.team === me && b.type === "barracks" && (b.progress ?? 1) >= 1), opts.long ? 120000 : 120000, "dostavba kasáren");
  });

  await f.step("Výcvik vojáků v kasárnách", async () => {
    const bar = (await gameState(page)).buildings.find(b => b.team === me && b.type === "barracks")!;
    await selectBuilding(f, page, bar as any, "Klik na kasárna");
    let jumped = false;
    for (let i = 0; i < 3; i++) {
      if (!(await hudButton(page, "soldier"))) {
        // vycvičená jednotka si sama vezme výběr → kasárna je nutné vybrat znovu
        if (!jumped) await f.issue("Výběr kasáren se sám přepnul na nově vycvičenou jednotku (game.js: pendingTrain → selected = [u]); pro dalšího vojáka je nutné kasárna vybrat znovu", true);
        jumped = true;
        await selectBuilding(f, page, bar as any, "Znovu klik na kasárna");
      }
      await clickHud(f, page, "soldier", "Voják");
      await f.pause(800, page);
    }
    await f.caption("Vojáci se cvičí…", page);
    await waitFor(page, async () => (await gameState(page)).units.filter(u => u.team === me && u.type === "soldier").length >= 1, 120000, "vycvičený voják");
    await f.think(4000);
  });

  await f.step("Útok vojáků na nepřátelskou základnu", async () => {
    s = await gameState(page);
    const sold = s.units.filter(u => u.team === me && (u.type === "soldier" || u.type === "hero"));
    const xs = sold.map(u => u.x), ys = sold.map(u => u.y);
    const a = await worldToClient(page, Math.min(...xs) - 20, Math.min(...ys) - 28);
    const b = await worldToClient(page, Math.max(...xs) + 20, Math.max(...ys) + 14);
    await f.caption("Vyberu vojáky a hrdinu", page);
    await canvasDrag(f, page, a, b);
    // minimapa: klik pravým na nepřátelskou základnu přes minimapu není jistý, posílám rozkaz přes pohled na cíl
    const mid = { x: (hall.x + enemyHall.x) / 2, y: (hall.y + enemyHall.y) / 2 };
    await canvasClick(f, page, await worldToClient(page, Math.min(mid.x, hall.x + 420), mid.y), "right", "Pravý klik: pochod směrem k nepříteli");
    await f.think(opts.long ? 9000 : 4000);
  });
}

/* ---------- workflows ---------- */
export const WORKFLOWS: Workflow[] = [
  {
    id: "01", slug: "uvodni-stranka", name: "Úvodní stránka a vstup do hry",
    async run(f) {
      const p = f.page;
      await f.step("Otevření úvodní stránky goralia.cz/", async () => {
        await f.measure("/ → DOMContentLoaded", async () => { await p.goto(f.url("/"), { waitUntil: "domcontentloaded" }); });
        await f.measure("/ → load", async () => { await p.waitForLoadState("load"); });
        await f.title();
      });
      await f.step("Procházení obsahu stránky", async () => {
        await f.think(1200);
        for (let i = 0; i < 4; i++) await f.scroll(700);
      });
      await f.step("Přepnutí jednotek na Nemrtvé", async () => {
        await f.click('button.tab[data-side="nemrtvi"]');
        await f.think(1500);
        await f.click('button.tab[data-side="lide"]');
      });
      await f.step("Dorolování na konec stránky", async () => { for (let i = 0; i < 5; i++) await f.scroll(800); await f.think(800); });
      await f.step("Přepnutí jazyka na angličtinu a zpět", async () => {
        await p.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
        await f.pause(1200);
        await f.click('#lang [data-lang="en"]');
        await f.think(1500);
        await f.click('#lang [data-lang="cs"]');
      });
      await f.step("Klik na Hrát → načtení hry", async () => {
        await f.click("a.btn-play.big >> nth=0");
        await f.measure("Hrát → hlavní menu hry", async () => { await p.locator("#m-play").waitFor({ state: "visible", timeout: 60000 }); });
        await f.think(2500);
      });
    }
  },
  {
    id: "02", slug: "registrace", name: "Registrace nového hráče",
    async run(f) {
      const p = f.page;
      await f.step("Otevření hry", async () => { await openGame(f); await f.title(); });
      await f.step("Otevření přihlášení", async () => { await f.click("#m-account"); });
      await f.step("Přepnutí na registraci", async () => { await f.click("#a-toggle"); });
      await f.step("Odeslání prázdného formuláře (kontrola chybové hlášky)", async () => {
        await f.expectErrors(() => f.click("#a-submit"));
        await f.think(1200);
        const msg = (await p.locator("#a-status").textContent() || "").trim();
        await f.check(msg.length > 0, "Odeslání prázdné registrace nezobrazilo žádnou chybovou hlášku");
      });
      await f.step("Vyplnění přezdívky, e-mailu a hesla", async () => {
        await f.type("#a-name", USER.name);
        await f.type("#a-id", USER.email);
        await f.type("#a-password", USER.password);
      });
      await f.step("Dokončení registrace", async () => {
        await f.measure("registrace → odpověď", async () => {
          await f.click("#a-submit");
          await p.locator("#panel-account").waitFor({ state: "hidden", timeout: 15000 });
        });
        await f.think(2500);
        const label = (await p.locator("#m-account").textContent() || "").trim();
        await f.check(label.includes(USER.name) || !/Přihlásit/.test(label), `Po registraci tlačítko účtu stále ukazuje „${label}“`);
      });
    }
  },
  {
    id: "03", slug: "prihlaseni", name: "Přihlášení, profil a odhlášení",
    async run(f) {
      const p = f.page;
      await f.step("Otevření hry", async () => { await p.goto(f.url("/play")); await ensureAccount(f, p, USER); await api(f, p, "POST", "/api/auth/logout"); await openGame(f); await f.title(); });
      await f.step("Otevření přihlášení", async () => { await f.click("#m-account"); });
      await f.step("Přihlášení se špatným heslem", async () => {
        await f.type("#a-id", USER.name);
        await f.type("#a-password", "spatneheslo");
        await f.expectErrors(() => f.click("#a-submit"));
        await p.waitForTimeout(1500);
        const msg = (await p.locator("#a-status").textContent() || "").trim();
        await f.check(msg.length > 0, "Špatné heslo nezobrazilo chybovou hlášku");
        await f.think(1500);
      });
      await f.step("Přihlášení správným heslem", async () => {
        await f.type("#a-password", USER.password);
        await f.measure("přihlášení → menu", async () => {
          await f.click("#a-submit");
          await p.locator("#panel-account").waitFor({ state: "hidden", timeout: 15000 });
        });
        await f.think(1500);
      });
      await f.step("Otevření vlastního profilu", async () => { await f.click("#m-account"); await p.locator("#panel-profile").waitFor({ state: "visible" }); await f.think(2500); await f.scroll(500); });
      await f.step("Odhlášení", async () => {
        await f.click("#pf-logout");
        await f.think(1500);
        const label = (await p.locator("#m-account").textContent() || "").trim();
        await f.check(/Přihlásit/.test(label), `Po odhlášení tlačítko účtu ukazuje „${label}“`);
      });
    }
  },
  {
    id: "04", slug: "sin-slavy", name: "Hráči a Síň slávy",
    async run(f) {
      const p = f.page;
      await f.step("Otevření hry (přihlášený hráč)", async () => { await p.goto(f.url("/play")); await loginApi(f, p, USER.email, USER.password); await openGame(f); await f.title(); });
      await f.step("Otevření Síně slávy", async () => {
        await f.measure("Hráči → seznam", async () => { await f.click("#m-players"); await p.locator("#pl-list").waitFor({ state: "visible" }); });
        await f.think(2500);
        await f.scroll(600);
      });
      await f.step("Hledání hráče podle přezdívky", async () => {
        await f.type("#pl-q", "Test");
        await p.waitForTimeout(1200);
        const rows = await p.locator("#pl-list > *").count();
        await f.check(rows > 0, "Hledání „Test“ nenašlo registrovaného hráče Testovac");
        await f.think(1200);
      });
      await f.step("Otevření profilu nalezeného hráče", async () => {
        const row = p.locator("#pl-list > *").first();
        if (await row.count()) { await f.click(row); await f.think(2500); }
        else await f.issue("Seznam hráčů je prázdný, profil nelze otevřít", true);
      });
      await f.step("Zpět do menu", async () => {
        const back = p.locator("section.page:not([hidden]) button:has-text('Zpět')").first();
        await f.click(back);
        if (await p.locator("#panel-main").isHidden()) await f.click(p.locator("section.page:not([hidden]) button:has-text('Zpět')").first());
      });
    }
  },
  {
    id: "05", slug: "vyzvy", name: "Výzvy a sbírka odměn",
    async run(f) {
      const p = f.page;
      await f.step("Otevření Výzev jako host", async () => {
        await openGame(f); await f.title();
        await f.click("#m-challenges"); await f.think(2500);
        await f.check(p.locator("#ch-login").isVisible(), "Host nevidí výzvu k přihlášení na stránce Výzvy");
      });
      await f.step("Přihlášení z Výzev", async () => {
        await f.click("#ch-login-btn");
        await f.type("#a-id", USER.email);
        await f.type("#a-password", USER.password);
        await f.click("#a-submit");
        await p.locator("#panel-account").waitFor({ state: "hidden", timeout: 15000 });
        await f.think(2000);
        await f.check(p.locator("#panel-challenges").isVisible(), "Po přihlášení z Výzev se hráč nevrátil na Výzvy");
      });
      await f.step("Prohlížení denních a týdenních výzev", async () => {
        if (!(await p.locator("#panel-challenges").isVisible())) await f.click("#m-challenges");
        await f.think(2500);
        await f.scroll(500);
      });
      await f.step("Náhled odměny ve sbírce", async () => {
        const item = p.locator("#ch-collection > *").nth(1);
        if (await item.count()) { await f.click(item); await f.think(2000); }
        else await f.issue("Sbírka odměn je prázdná", true);
      });
    }
  },
  {
    id: "06", slug: "nastaveni-jazyk", name: "Nastavení, ovládání a jazyk",
    async run(f) {
      const p = f.page;
      await f.step("Otevření hry", async () => { await openGame(f); await f.title(); });
      await f.step("Nastavení: hlasitost a přepínače", async () => {
        await f.click("#m-settings");
        const vol = p.locator("#s-volume"); const box = await vol.boundingBox();
        if (box) { await f.highlight(box.x, box.y, box.width, box.height); await p.mouse.move(box.x + box.width * 0.95, box.y + box.height / 2, { steps: 10 }); await p.mouse.down(); await p.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 20 }); await p.mouse.up(); await f.unhighlight(); }
        await f.pause(600);
        await f.click("#s-shake"); await f.click("#s-shake");
      });
      await f.step("Klávesové zkratky: změna a obnovení", async () => {
        await f.click("#s-keys");
        await f.think(1500);
        const first = p.locator("#k-list button").first();
        await f.click(first);
        await p.keyboard.press("j"); await f.think(1200);
        await f.click("#k-reset"); await f.think(1000);
        await f.click("#panel-keys [data-back]");
      });
      await f.step("Přepnutí jazyka vlajkou v nastavení", async () => {
        await f.click('#s-lang [data-lang="en"]'); await f.think(1500);
        await f.click('#s-lang [data-lang="szl"]'); await f.think(1500);
        await f.click('#s-lang [data-lang="cs"]'); await f.think(800);
        await f.click("#panel-settings [data-back]");
      });
      await f.step("Ovládání (nápověda)", async () => {
        await f.click("#m-help"); await f.think(2500); await f.scroll(600); await f.think(1000);
        await f.click("#panel-help [data-back]");
      });
      await f.step("Jazyk vlajkou v hlavním menu", async () => {
        await f.click('#m-lang [data-lang="en"]'); await f.think(2000);
        await f.click('#m-lang [data-lang="cs"]'); await f.think(1000);
      });
    }
  },
  {
    id: "07", slug: "hra-proti-ai", name: "Hra proti AI",
    async run(f) {
      const p = f.page;
      await f.step("Otevření hry", async () => { await openGame(f); await f.title(); });
      await f.step("Výběr mapy v lobby", async () => {
        await f.click("#m-play");
        await f.think(1200);
        await f.click(p.locator("#l-filter"));
        await p.locator("#l-filter").selectOption({ index: 1 }).catch(() => {});
        await f.think(1200);
        await f.click(p.locator("#l-maps > *").nth(1)); await f.think(1500);
        await f.click(p.locator("#l-maps > *").first()); await f.think(1200);
      });
      await f.step("Spuštění hry", async () => {
        await f.measure("Spustit hru → hratelný stav", async () => {
          await f.click("#l-start");
          await waitFor(p, async () => (await p.evaluate(() => (window as any).PK.game.state)) === "playing", 30000, "start hry");
        });
        await f.think(2500);
      });
      await playSomeGame(f, p, { long: true });
      await f.step("Menu ve hře a vzdání se", async () => {
        await f.caption("Esc otevře menu", p);
        await p.keyboard.press("Escape"); await f.think(1800);
        await f.click("#m-surrender");
        await f.think(1500);
      });
      let ended = false;
      await f.step("Obrazovka konce hry", async () => {
        ended = await waitFor(p, async () => (await p.evaluate(() => (window as any).PK.game.state)) !== "playing", 20000, "konec hry").then(() => true, () => false);
        if (!ended) {
          const phase = await p.evaluate(() => (window as any).PK.game.match && (window as any).PK.game.match.phase);
          await f.caption("Po vzdání se hra nic neukázala a běží dál", p);
          await f.issue(`Po „Vzdát se“ ve hře proti AI se neukáže konec hry: simulace je ve fázi „${phase}“, klient zůstává ve stavu „playing“ (game.js pumpSim po konci už nepošle snímek)`, true);
          await f.think(4000);
          return;
        }
        await f.caption("Konec hry", p);
        await f.think(5000);
        await f.shot("konec-hry");
      });
      await f.step("Návrat do hlavního menu", async () => {
        if (await p.locator("#menu").isHidden()) await p.keyboard.press("Escape");
        await f.pause(800);
        if (ended) await f.click("#m-leave");
        else {
          await f.caption("Tlačítko „Hlavní menu“ chybí, zbývá jen „Nová hra“", p);
          await f.think(3000);
          await f.check(p.locator("#m-leave").isVisible(), "Po vzdání se v menu chybí tlačítko Hlavní menu (hráč nemůže odejít jinak než Novou hrou nebo obnovením stránky)");
        }
        await f.think(1500);
      });
    }
  },
  {
    id: "08", slug: "multiplayer", name: "Multiplayer: místnost pro dva hráče",
    async run(f) {
      const a = f.page;
      const b = await f.openExtra("B");
      await f.step("Dva hráči otevřou hru", async () => {
        await a.goto(f.url("/play")); await b.goto(f.url("/play"));
        await ensureAccount(f, a, USER); await loginApi(f, a, USER.email, USER.password);
        await ensureAccount(f, b, RIVAL); await loginApi(f, b, RIVAL.email, RIVAL.password);
        await openGame(f, a); await openGame(f, b);
        await Promise.all([f.title(a), f.title(b)]);
      });
      await f.step("Hráč A: Multiplayer → Vytvořit místnost", async () => {
        await f.measure("Multiplayer → seznam místností", async () => { await f.click("#m-online"); await a.locator("#o-create").waitFor({ state: "visible", timeout: 15000 }); });
        await f.click("#o-create");
        await a.locator("#panel-lobby").waitFor({ state: "visible", timeout: 15000 });
        await f.think(1500);
      });
      await f.step("Hráč B: najde místnost a připojí se", async () => {
        await f.click("#m-online", { page: b });
        const room = b.locator("#o-rooms .room").first();
        await f.measure("místnost se objeví v seznamu u hráče B", async () => { await room.waitFor({ state: "visible", timeout: 20000 }); });
        await f.think(1200, b);
        await f.measure("připojení do místnosti", async () => { await f.click(room, { page: b }); await b.locator("#panel-lobby").waitFor({ state: "visible", timeout: 15000 }); });
        await f.think(1500, b);
      });
      await f.step("Chat v místnosti", async () => {
        const input = a.locator("#l-chat input").first();
        if (await input.count()) {
          await f.type(input, "Ahoj, hrajem?", a); await a.keyboard.press("Enter");
          await f.pause(1200, a);
          const seen = await b.locator("#l-chat").innerText().catch(() => "");
          await f.check(seen.includes("Ahoj"), "Zpráva z chatu místnosti se u druhého hráče nezobrazila");
        } else await f.issue("V lobby místnosti není pole pro chat", true);
      });
      await f.step("Hráč A spustí hru", async () => {
        await f.measure("Spustit hru → oba hrají", async () => {
          await f.click("#l-start");
          await waitFor(a, async () => (await a.evaluate(() => (window as any).PK.game.state)) === "playing" && (await b.evaluate(() => (window as any).PK.game.state)) === "playing", 30000, "start u obou hráčů");
        });
        await f.think(3000);
      });
      await f.step("Oba hráči hrají (dělníci jdou těžit)", async () => {
        for (const page of [a, b]) {
          const s = await gameState(page);
          const ws = s.units.filter(u => u.team === s.me && u.type === "worker");
          const xs = ws.map(u => u.x), ys = ws.map(u => u.y);
          await canvasDrag(f, page, await worldToClient(page, Math.min(...xs) - 20, Math.min(...ys) - 28), await worldToClient(page, Math.max(...xs) + 20, Math.max(...ys) + 14));
          const hall = s.buildings.find(x => x.team === s.me)!;
          const mine = s.gold_mines.slice().sort((m1, m2) => dist(m1, hall) - dist(m2, hall))[0];
          await canvasClick(f, page, await worldToClient(page, mine.x, mine.y), "right", "Těžba zlata");
        }
        await f.think(6000);
      });
      await f.step("Hráč B se vzdá, hráč A vyhrává", async () => {
        await b.keyboard.press("Escape"); await f.pause(1200, b);
        await f.click("#m-surrender", { page: b });
        await waitFor(a, async () => (await a.evaluate(() => (window as any).PK.game.state)) !== "playing", 20000, "konec zápasu u hráče A");
        await f.think(5000);
        await f.shot("multiplayer-konec-A", a); await f.shot("multiplayer-konec-B", b);
      });
      await f.step("Návrat do místnosti / menu", async () => {
        if (await a.locator("#menu").isHidden()) { await a.keyboard.press("Escape"); await f.pause(800, a); }
        await f.click("#m-leave", { page: a }).catch(async () => { await f.issue("Po konci multiplayeru není tlačítko Hlavní menu", true); });
        await f.think(2500);
      });
    }
  },
  {
    id: "09", slug: "editor-map", name: "Editor map (běžný hráč)",
    async run(f) {
      const p = f.page;
      await f.step("Otevření editoru", async () => {
        await f.measure("/editor → připraveno", async () => { await p.goto(f.url("/editor")); await p.locator("#e-canvas").waitFor({ state: "visible", timeout: 30000 }); await p.waitForLoadState("load"); });
        await f.title(); await f.think(1500);
      });
      await f.step("Nová mapa přes Soubor › Nová mapa", async () => {
        await f.click('#e-menus [data-menu="file"]');
        await f.click(p.locator(".menu-pop button, #e-popup button, [role=menu] button, .dropdown button").filter({ hasText: "Nová mapa" }).first());
        const dlg = p.locator("#d-props");
        if (await dlg.isVisible()) { await f.type("#p-name", "Testovací údolí"); await f.click("#p-ok"); }
        await f.think(1500);
      });
      const canvas = p.locator("#e-canvas");
      // nový editor (PR #50) má paletu s kategoriemi, starý řadu nástrojů
      const palette = (await p.locator("#e-items").count()) > 0;
      const NEW_ITEM: Record<string, [string, string]> = { water: ["terrain", "water"], mountain: ["terrain", "mountain"], road: ["terrain", "road"], tree: ["trees", "tree:mix"], base: ["game", "base"], gold: ["game", "gold"] };
      const draw = async (tool: string, pts: [number, number][], label: string) => {
        if (palette) {
          const [cat, id] = NEW_ITEM[tool];
          const catBtn = p.locator(`#e-cats button[data-cat="${cat}"]`);
          if (!(await catBtn.getAttribute("class") || "").includes("active")) await f.click(catBtn, { caption: label });
          await f.click(`#e-items button[data-id="${id}"]`, { caption: label });
        } else await f.click(`#e-tools [data-tool="${tool}"]`, { caption: label });
        const box = (await canvas.boundingBox())!;
        const P = (q: [number, number]) => ({ x: box.x + box.width * q[0], y: box.y + box.height * q[1] });
        if (pts.length === 1) { const q = P(pts[0]); await p.mouse.move(q.x, q.y, { steps: 12 }); await f.pause(300); await p.mouse.click(q.x, q.y); }
        else {
          const q0 = P(pts[0]); await p.mouse.move(q0.x, q0.y, { steps: 12 }); await p.mouse.down();
          for (const q of pts.slice(1)) { const r = P(q); await p.mouse.move(r.x, r.y, { steps: f.slow ? 25 : 3 }); }
          await p.mouse.up();
        }
        await f.pause(900);
      };
      await f.step("Kreslení: voda, hory, cesta, stromy", async () => {
        await draw("water", [[0.5, 0.05], [0.48, 0.3], [0.52, 0.6], [0.5, 0.95]], "Řeka uprostřed mapy");
        await draw("mountain", [[0.3, 0.15], [0.35, 0.3]], "Hřeben hor");
        await draw("mountain", [[0.7, 0.85], [0.65, 0.7]], "Druhý hřeben (symetricky)");
        await draw("road", [[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]], "Cesta přes brod");
        await draw("tree", [[0.15, 0.2], [0.25, 0.25]], "Les");
      });
      await f.step("Umístění základen a zlatých dolů", async () => {
        await draw("base", [[0.18, 0.5]], "Základna 1");
        await draw("base", [[0.82, 0.5]], "Základna 2");
        for (const q of [[0.12, 0.4], [0.12, 0.6], [0.88, 0.4], [0.88, 0.6]] as [number, number][]) await draw("gold", [q], "Zlatý důl");
        await f.think(1500);
      });
      await f.step("Kontrola mapy a zpět (Ctrl+Z)", async () => {
        const probs = await p.locator("#e-problems li").count();
        await f.caption(`Kontrola mapy hlásí ${probs} problémů`);
        await f.think(2000);
        await p.keyboard.press("Control+z"); await f.think(1000);
        await p.keyboard.press("Control+Shift+z"); await f.think(1000);
      });
      if (palette) await f.step("Vyzkoušet mapu ve hře (bez uložení)", async () => {
        const popup = f.ctx.waitForEvent("page", { timeout: 8000 }).catch(() => null);
        await f.click("#e-test");
        const tab = await popup;
        const url = tab ? tab.url() : f.url("/play?test=editor");
        if (tab) await tab.close();
        await f.caption("Zkouška se otevírá v nové kartě – tady ji otevřu ve stejném okně", p);
        await f.think(1500);
        await p.goto(url);
        await waitFor(p, async () => (await p.evaluate(() => (window as any).PK && (window as any).PK.game && (window as any).PK.game.state).catch(() => "")) === "playing", 60000, "zkouška mapy ve hře");
        await f.think(6000);
        await f.shot("editor-zkouska-ve-hre");
        await p.goBack(); await p.locator("#e-canvas").waitFor({ state: "visible", timeout: 30000 });
        await f.think(1500);
        await f.check(p.locator("#e-summary").innerText().then(t => /doly: [1-9]/.test(t)), "Po návratu z test hry editor nepamatuje rozkreslenou mapu");
      });
      await f.step("Pokus o uložení na server (host)", async () => {
        await f.click("#e-save");
        await f.think(2500);
        const msg = await p.locator("#e-status").innerText();
        await f.caption(`Stav: ${msg}`);
        await f.think(2000);
        await f.shot("editor-ulozeni-host");
      });
      await f.step("Stažení mapy jako JSON", async () => {
        await f.click('#e-menus [data-menu="file"]');
        const dl = p.waitForEvent("download", { timeout: 10000 }).catch(() => null);
        await f.click(p.locator("button").filter({ hasText: "Stáhnout JSON" }).first());
        const d = await dl;
        await f.check(!!d, "Stáhnout JSON nespustilo stahování");
        await f.think(1500);
      });
    }
  },
  {
    id: "10", slug: "admin", name: "Admin: server panel, turnaj, mapa v editoru",
    async run(f) {
      const p = f.page;
      await f.step("Přihlášení admina ve hře", async () => {
        await openGame(f); await f.title();
        await f.click("#m-account");
        await f.type("#a-id", ADMIN.name);
        await f.type("#a-password", ADMIN.password);
        await f.click("#a-submit");
        await p.locator("#m-admin").waitFor({ state: "visible", timeout: 15000 });
        await f.think(1200);
      });
      await f.step("Otevření Server panelu", async () => {
        const [adm] = await Promise.all([f.ctx.waitForEvent("page"), f.click("#m-admin")]);
        f.watch(adm, "admin");
        await adm.waitForLoadState("load");
        // video zachytí jen první stránku, proto panel otevřu v ní
        await adm.close();
        await f.measure("/admin → přehled", async () => { await p.goto(f.url("/admin")); await p.locator("#cards > *").first().waitFor({ state: "visible", timeout: 20000 }); });
        await f.think(2500);
      });
      await f.step("Procházení záložek panelu", async () => {
        for (const tab of ["traffic", "users", "live", "matches", "challenges", "maps", "audit"]) {
          await f.click(`#tabs [data-tab="${tab}"]`); await f.think(1500);
        }
      });
      await f.step("Naplánování turnaje", async () => {
        await f.click('#tabs [data-tab="tournaments"]');
        await f.type("#ev-name", "Podzimní pohár UX");
        const d = new Date(Date.now() + 26 * 3600e3);
        const pad = (n: number) => String(n).padStart(2, "0");
        await p.locator("#ev-start").fill(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T18:00`);
        await f.type("#ev-max", "8");
        await f.type("#ev-prize", "titul Král Goralie");
        await f.type("#ev-desc", "Zápasy 1 na 1, vyřazovací pavouk.");
        await f.click("#ev-submit");
        await f.think(2000);
        await f.check(p.locator("#events").innerText().then(t => t.includes("Podzimní pohár UX")), "Naplánovaný turnaj se neobjevil v seznamu");
      });
      await f.step("Uložení mapy v editoru jako admin", async () => {
        await p.goto(f.url("/editor"));
        await p.locator("#e-canvas").waitFor({ state: "visible" });
        await f.think(1500);
        await f.click('#e-menus [data-menu="file"]');
        await f.click(p.locator("button").filter({ hasText: "Otevřít" }).first());
        await f.think(1200);
        await f.click(p.locator("#o-list").getByText("Horský průsmyk").first());
        await f.think(1500);
        await f.click('#e-menus [data-menu="file"]');
        await f.click(p.locator("button").filter({ hasText: "Uložit jako" }).first());
        await f.type("#p-name", "Kopie pro UX test");
        await f.type("#p-id", "ux-test-kopie");
        await f.click("#p-ok");
        await f.think(1500);
        if (await p.locator("#e-save").isEnabled()) await f.click("#e-save");
        await f.think(2000);
        await f.caption(`Stav: ${await p.locator("#e-status").innerText()}`);
        await f.think(1500);
      });
      await f.step("Zkouška mapy ve hře (Hrát)", async () => {
        const play = p.locator("#e-play");
        await play.waitFor({ state: "visible", timeout: 8000 });
        const href = await play.getAttribute("href");
        await f.click(play).catch(() => {});
        for (const extra of f.ctx.pages().filter(x => x !== p)) await extra.close();
        await p.goto(new URL(href || "/play", f.url("/")).toString());
        await waitFor(p, async () => (await p.evaluate(() => (window as any).PK && (window as any).PK.game && (window as any).PK.game.state).catch(() => "")) === "playing" || await p.locator("#l-start").isVisible(), 40000, "mapa ve hře");
        if (await p.locator("#l-start").isVisible()) { await f.think(1500); await f.click("#l-start"); }
        await f.think(5000);
      });
      await f.step("Admin příkaz /win ve hře", async () => {
        await p.keyboard.press("/"); await f.pause(800);
        await p.keyboard.type("win", { delay: f.slow ? 120 : 0 }); await f.pause(500);
        await p.keyboard.press("Enter");
        await f.think(5000);
      });
    }
  },
  {
    id: "11", slug: "turnaj", name: "Turnaj: přihlášení hráče",
    async run(f) {
      const p = f.page;
      await f.step("Hráč otevře hru", async () => { await p.goto(f.url("/play")); await loginApi(f, p, USER.email, USER.password); await openGame(f); await f.title(); });
      await f.step("Banner turnaje v menu", async () => {
        await p.locator("#m-event").waitFor({ state: "visible", timeout: 15000 });
        await f.think(1500);
        await f.click("#m-event");
        await f.think(2500);
      });
      await f.step("Přihlášení do turnaje", async () => {
        await f.click("#te-join");
        await f.think(2000);
        const players = await p.locator("#te-players").innerText();
        await f.check(players.includes(USER.name), "Po přihlášení do turnaje se hráč neukázal v seznamu");
        await f.think(1500);
      });
      await f.step("Odhlášení z turnaje", async () => {
        await f.click("#te-join");
        await f.think(2000);
      });
    }
  }
  ,
  {
    id: "12", slug: "tutorial", name: "Tutoriál „Naučit se hrát“", baseEnv: "UX_BASE_TUTORIAL",
    note: "Tutoriál zatím není v main (PR #43, větev tutorial).",
    async run(f) {
      const p = f.page;
      await f.step("Nový hráč otevře hru", async () => { await openGame(f); await f.title(); });
      await f.step("Nabídka Naučit se hrát v menu", async () => {
        await f.check(p.locator("#m-tutorial").isVisible(), "Novému hráči se v menu nenabídl tutoriál");
        await f.measure("Naučit se hrát → hratelný stav", async () => {
          await f.click("#m-tutorial");
          await waitFor(p, async () => { const s = await gameState(p); return s.state === "playing" && s.units.some(u => u.team === s.me && u.type === "worker"); }, 30000, "start tutoriálu");
        });
        await f.think(4000);
      });
      const stepNo = () => p.evaluate(() => (window as any).PK.tutorial.step);
      await f.step("Krok 1: výběr dělníka", async () => {
        const s = await gameState(p);
        await selectUnit(f, p, st => st.units.find(u => u.team === st.me && u.type === "worker"), "Klik na dělníka");
        await waitFor(p, async () => (await stepNo()) >= 1, 15000, "splnění kroku 1");
        await f.think(3500);
      });
      await f.step("Krok 2: dřevo (pravý klik na strom)", async () => {
        const s = await gameState(p);
        const trees = await p.evaluate(() => (window as any).PK.game.resources.filter((r: any) => r.type !== "gold").map((r: any) => ({ x: r.x, y: r.y })));
        const hall = s.buildings.find(b => b.team === s.me)!;
        const t = trees.sort((a: Pt, b: Pt) => dist(a, hall) - dist(b, hall))[0];
        await canvasClick(f, p, await worldToClient(p, t.x, t.y), "right", "Pravý klik na strom = těžba dřeva");
        await waitFor(p, async () => (await stepNo()) >= 2, 40000, "splnění kroku 2");
        await f.think(3500);
      });
      await f.step("Krok 3: zlato (pravý klik na důl)", async () => {
        const s = await gameState(p);
        const ws = s.units.filter(u => u.team === s.me && u.type === "worker");
        const xs = ws.map(u => u.x), ys = ws.map(u => u.y);
        await canvasDrag(f, p, await worldToClient(p, Math.min(...xs) - 20, Math.min(...ys) - 28), await worldToClient(p, Math.max(...xs) + 20, Math.max(...ys) + 14));
        const hall = s.buildings.find(b => b.team === s.me)!;
        const mine = s.gold_mines.slice().sort((m1, m2) => dist(m1, hall) - dist(m2, hall))[0];
        await canvasClick(f, p, await worldToClient(p, mine.x, mine.y), "right", "Pravý klik na zlatý důl");
        await waitFor(p, async () => (await stepNo()) >= 3, 40000, "splnění kroku 3");
        await f.think(4000);
      });
      await f.step("Přeskočení zbytku tutoriálu", async () => {
        const pt = await p.evaluate(() => {
          const c = document.getElementById("game")!; const r = c.getBoundingClientRect();
          return { w: r.width, h: r.height, l: r.left, t: r.top };
        });
        // tlačítko PŘESKOČIT je v pravém horním rohu karty tutoriálu (karta je dole nad panelem); hledám ho podle barvy v screenshotu
        const shot = await p.screenshot({ clip: { x: pt.l, y: pt.t, width: pt.w, height: Math.round(pt.h * 0.77) } });
        const png = await findColor(shot, [0x2f, 0x2a, 0x50]);
        if (!png) throw new Error("tlačítko PŘESKOČIT jsem na plátně nenašel");
        await canvasClick(f, p, { x: pt.l + png.x, y: pt.t + png.y + 10 }, "left", "Přeskočit tutoriál");
        await f.think(2500);
        await f.check(p.locator("#menu").isVisible(), "Po přeskočení tutoriálu se neukázalo hlavní menu");
        await f.think(1500);
      });
    }
  },
  {
    id: "13", slug: "kampan", name: "Kampaň „Stín Morvanův“: 1. kapitola", baseEnv: "UX_BASE_KAMPAN",
    note: "Kampaň zatím není v main (PR #26, větev kampan), přestože ji úvodní stránka už propaguje.",
    async run(f) {
      const p = f.page;
      await f.step("Otevření hry", async () => { await openGame(f); await f.title(); });
      await f.step("Menu Kampaň a seznam kapitol", async () => {
        await f.click("#m-campaign");
        await f.think(3000);
      });
      await f.step("Spuštění 1. kapitoly (úvodní cutscéna)", async () => {
        await f.measure("kapitola 1 → hratelný stav", async () => {
          await f.click(p.locator("#c-list .chapter").first());
          await waitFor(p, async () => (await p.evaluate(() => (window as any).PK.game.state)) === "playing" && !(await p.locator("#loading").isVisible()), 60000, "start kapitoly");
        });
        await f.caption("Úvodní cutscéna kapitoly", p);
        await f.think(14000);
      });
      await f.step("Přeskočení cutscény a první rozkazy", async () => {
        await f.caption("Esc = přeskočit cutscénu", p);
        await p.keyboard.press("Escape");
        await f.think(2000);
        if (await p.locator("#menu").isVisible()) { await f.issue("Esc během cutscény otevřel menu místo přeskočení", true); await p.keyboard.press("Escape"); }
        await f.think(8000);
        await f.shot("kampan-hra");
      });
    }
  }
];
