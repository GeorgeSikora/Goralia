// Analytická kontrola klíčových obrazovek (Úkol 2): přístupnost (axe-core), klávesnice,
// výkon načítání a mobilní šířka 390 px. Výstup: <out>/analyza/analyza.json + screenshoty.
//
//   node tools/ux-audit/a11y.ts --out ux-audit-out [--base http://localhost:3000]
//
// axe-core: `npm i -D axe-core`, nebo cesta v proměnné UX_AXE (axe.min.js). Bez něj se přeskočí.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Page, BrowserContext } from "playwright";
import { chromium } from "./lib.ts";
import { USER, ADMIN } from "./workflows.ts";

const require = createRequire(import.meta.url);
const arg = (n: string, d = "") => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("base", process.env.UX_BASE || "http://localhost:3000").replace(/\/$/, "");
const OUT = path.join(path.resolve(arg("out", "ux-audit-out")), "analyza");
fs.mkdirSync(path.join(OUT, "mobil"), { recursive: true });
fs.mkdirSync(path.join(OUT, "desktop"), { recursive: true });

let axeSrc = "";
try { axeSrc = fs.readFileSync(process.env.UX_AXE || require.resolve("axe-core/axe.min.js"), "utf8"); } catch { console.log("axe-core nenalezen, kontrola přístupnosti se přeskočí"); }

interface Screen { id: string; name: string; open: (p: Page) => Promise<void>; login?: "user" | "admin" }

async function menu(p: Page, path = "/play") {
  await p.goto(BASE + path);
  await p.locator("#m-play").waitFor({ state: "visible", timeout: 60000 });
  // #m-play je „vidět“ i pod načítací obrazovkou; čekám, až zmizí
  await p.waitForFunction(() => { const l = document.getElementById("loading"); return !l || l.hidden || getComputedStyle(l).display === "none" || getComputedStyle(l).opacity === "0" || !l.isConnected; }, null, { timeout: 90000 });
  await p.waitForTimeout(800);
}
const page = (id: string) => async (p: Page) => { await menu(p); await p.evaluate(i => (document.getElementById(i) as HTMLElement).click(), id); await p.waitForTimeout(1200); };

const SCREENS: Screen[] = [
  { id: "uvod", name: "Úvodní stránka /", open: async p => { await p.goto(BASE + "/"); await p.waitForLoadState("load"); await p.waitForTimeout(1500); } },
  { id: "menu", name: "Hlavní menu /play", open: p => menu(p) },
  { id: "prihlaseni", name: "Přihlášení", open: page("m-account") },
  { id: "lobby-ai", name: "Lobby hry proti AI", open: page("m-play") },
  { id: "multiplayer", name: "Multiplayer – místnosti", open: page("m-online"), login: "user" },
  { id: "hraci", name: "Hráči / Síň slávy", open: page("m-players") },
  { id: "vyzvy", name: "Výzvy", open: page("m-challenges"), login: "user" },
  { id: "nastaveni", name: "Nastavení", open: page("m-settings") },
  { id: "ovladani", name: "Ovládání", open: page("m-help") },
  { id: "hra", name: "Ve hře (HUD)", open: async p => { await page("m-play")(p); await p.click("#l-start"); await p.waitForFunction(() => (window as any).PK.game.state === "playing", null, { timeout: 30000 }); await p.waitForTimeout(2000); } },
  { id: "editor", name: "Editor map", open: async p => { await p.goto(BASE + "/editor"); await p.locator("#e-canvas").waitFor(); await p.waitForTimeout(1500); } },
  { id: "admin", name: "Server panel /admin", login: "admin", open: async p => { await p.goto(BASE + "/admin"); await p.waitForTimeout(2500); } }
];

async function login(ctx: BrowserContext, who: "user" | "admin") {
  const p = await ctx.newPage();
  await p.goto(BASE + "/privacy");
  const body = who === "admin" ? { identifier: ADMIN.name, password: ADMIN.password } : { identifier: USER.email, password: USER.password };
  if (who === "user") await p.evaluate(async b => { await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Testovac", email: b.identifier, password: b.password }) }); }, body);
  await p.evaluate(async b => { await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); }, body);
  await p.close();
}

async function axe(p: Page) {
  if (!axeSrc) return null;
  await p.addScriptTag({ content: axeSrc });
  return p.evaluate(async () => {
    const r = await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "best-practice"] }, resultTypes: ["violations"] });
    return r.violations.map((v: any) => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length, nodes: v.nodes.slice(0, 6).map((n: any) => ({ target: n.target.join(" "), html: n.html.slice(0, 160), summary: (n.failureSummary || "").slice(0, 300) })) }));
  });
}

// Mobilní kontrola: vodorovné přetečení a malé dotykové cíle (< 44×44 px, WCAG 2.5.5 / doporučení 2.5.8 je 24 px).
async function mobileChecks(p: Page) {
  return p.evaluate(() => {
    const de = document.documentElement;
    const overflowX = Math.max(de.scrollWidth, document.body.scrollWidth) - de.clientWidth;
    const small: string[] = []; const tiny: string[] = []; const offscreen: string[] = [];
    for (const el of Array.from(document.querySelectorAll("button, a[href], input, select, [role=button], [role=tab]")) as HTMLElement[]) {
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.visibility === "hidden" || el.closest("[hidden]")) continue;
      const label = (el.id ? "#" + el.id : el.tagName.toLowerCase()) + " " + (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30);
      if (r.right > de.clientWidth + 1 || r.left < -1) offscreen.push(label);
      if (r.width < 24 || r.height < 24) tiny.push(`${label} (${Math.round(r.width)}×${Math.round(r.height)})`);
      else if (r.width < 44 || r.height < 44) small.push(`${label} (${Math.round(r.width)}×${Math.round(r.height)})`);
    }
    const smallText = Array.from(document.querySelectorAll("p, span, li, label, button, a")).filter(e => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && parseFloat(getComputedStyle(e).fontSize) < 12 && (e.textContent || "").trim().length > 3 && !(e as HTMLElement).closest("[hidden]"); }).length;
    return { overflowX, tiny, small: small.slice(0, 25), smallCount: small.length, offscreen, smallText, height: de.scrollHeight };
  });
}

// Klávesnice: N× Tab, co dostalo fokus a jestli je fokus vidět.
async function keyboard(p: Page, n = 25) {
  await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const seq: { el: string; visible: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    await p.keyboard.press("Tab");
    seq.push(await p.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return { el: "(body)", visible: false };
      const cs = getComputedStyle(el);
      const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== "none");
      const r = el.getBoundingClientRect();
      const inView = r.width > 0 && r.bottom > 0 && r.top < innerHeight;
      return { el: (el.id ? "#" + el.id : el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(" ")[0] : "")) + " " + (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 24), visible: !!ring && inView };
    }));
  }
  return seq;
}

async function perf(p: Page) {
  return p.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const bytes = res.reduce((s, r) => s + (r.transferSize || r.encodedBodySize || 0), 0) + (nav ? nav.transferSize : 0);
    const big = res.filter(r => (r.encodedBodySize || 0) > 300000).map(r => ({ url: r.name.replace(location.origin, ""), kb: Math.round(r.encodedBodySize / 1024), ms: Math.round(r.duration) }));
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    return { ttfb: nav && Math.round(nav.responseStart), dcl: nav && Math.round(nav.domContentLoadedEventEnd), load: nav && Math.round(nav.loadEventEnd), fcp: fcp && Math.round(fcp.startTime), requests: res.length + 1, kb: Math.round(bytes / 1024), big };
  });
}

async function main() {
  const browser = await chromium.launch();
  const out: any = { base: BASE, when: new Date().toISOString(), screens: [] };
  for (const s of SCREENS) {
    const entry: any = { id: s.id, name: s.name };
    for (const vp of [{ tag: "desktop", width: 1920, height: 1080 }, { tag: "mobil", width: 390, height: 844 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: "cs-CZ", deviceScaleFactor: 1, hasTouch: vp.tag === "mobil", isMobile: vp.tag === "mobil" });
      await ctx.addInitScript(() => { try { localStorage.setItem("pk-lang", "cs"); } catch (e) { /* */ } });
      if (s.login) await login(ctx, s.login);
      const p = await ctx.newPage();
      const errors: string[] = [];
      p.on("pageerror", e => errors.push(String(e.message)));
      p.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
      const longTasks: number[] = [];
      await p.exposeFunction("__lt", (d: number) => longTasks.push(d));
      await p.addInitScript(() => { try { new PerformanceObserver(l => l.getEntries().forEach(e => (window as any).__lt(Math.round(e.duration)))).observe({ type: "longtask", buffered: true }); } catch (e) { /* */ } });
      const t = Date.now();
      try { await s.open(p); } catch (e: any) { entry[vp.tag] = { error: String(e.message).split("\n")[0] }; await p.screenshot({ path: path.join(OUT, vp.tag, `${s.id}.png`) }).catch(() => {}); await ctx.close(); continue; }
      const r: any = { openMs: Date.now() - t, errors: errors.slice(0, 10) };
      await p.screenshot({ path: path.join(OUT, vp.tag, `${s.id}.png`), fullPage: vp.tag === "mobil" && s.id !== "hra" });
      if (vp.tag === "desktop") {
        r.perf = await perf(p);
        r.axe = await axe(p).catch(e => ({ error: String(e) }));
        if (["uvod", "menu", "prihlaseni", "nastaveni", "editor", "lobby-ai"].includes(s.id)) r.keyboard = await keyboard(p);
        r.longTasks = { count: longTasks.length, max: Math.max(0, ...longTasks), total: longTasks.reduce((a, b) => a + b, 0) };
      } else {
        r.mobile = await mobileChecks(p);
      }
      entry[vp.tag] = r;
      await ctx.close();
      console.log(`${s.id} ${vp.tag} ${r.openMs} ms`);
    }
    out.screens.push(entry);
  }

  // Esc a Enter v menu: dá se hra spustit jen z klávesnice?
  {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: "cs-CZ" });
    const p = await ctx.newPage();
    await menu(p);
    const steps: string[] = [];
    await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (let i = 0; i < 6; i++) {
      await p.keyboard.press("Tab");
      const id = await p.evaluate(() => document.activeElement && document.activeElement.id);
      if (id === "m-play") { await p.keyboard.press("Enter"); steps.push("Tab → Hra proti AI → Enter"); break; }
    }
    await p.waitForTimeout(800);
    const lobby = await p.locator("#panel-lobby").isVisible();
    steps.push(`lobby otevřené: ${lobby}`);
    const focusInLobby = await p.evaluate(() => document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : "");
    steps.push(`fokus po otevření lobby: ${focusInLobby}`);
    await p.keyboard.press("Escape"); await p.waitForTimeout(600);
    steps.push(`Esc v lobby → hlavní menu: ${await p.locator("#panel-main").isVisible()}`);
    out.keyboardFlow = steps;
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, "analyza.json"), JSON.stringify(out, null, 1));
  console.log("hotovo →", OUT);
}

main().catch(e => { console.error(e); process.exit(1); });
