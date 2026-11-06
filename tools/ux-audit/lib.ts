// UX audit Goraliy: společné nástroje pro nahrávání a analýzu workflows.
// Spouští se přímo v Node 22+ (TypeScript bez sestavení: `node tools/ux-audit/record.ts`).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page, Locator, Dialog } from "playwright";

const require = createRequire(import.meta.url);
export const { chromium } = require("playwright") as typeof import("playwright");

export type Mode = "record" | "audit";

export interface StepLog { name: string; at: number; dur: number; ok: boolean; error?: string; shot?: string }
export interface Measure { label: string; ms: number; at: number }
export interface Issue { at: number; text: string; shot?: string }
export interface NetLog { kind: string; url: string; status?: number; ms?: number; text?: string; at: number; expected?: boolean }

export interface FlowResult {
  id: string; name: string; status: "OK" | "problém" | "selhal" | "přeskočeno";
  steps: StepLog[]; measures: Measure[]; issues: Issue[]; console: NetLog[]; network: NetLog[];
  failure?: { step: string; error: string; shot?: string; at: number };
  videos: string[]; durationS: number; note?: string;
}

export interface Opts { base: string; out: string; mode: Mode; headed?: boolean }

// Overlay uvnitř stránky: titulek workflow, popisek kroku, zvýraznění prvku a viditelný kurzor.
const OVERLAY = String.raw`(() => {
  if (window.__ux) return;
  const css = '#__ux{position:fixed;inset:0;pointer-events:none;z-index:2147483647;font-family:system-ui,Segoe UI,Arial,sans-serif}' +
    '#__ux .cur{position:absolute;width:22px;height:22px;margin:-3px 0 0 -3px;transition:transform .08s}' +
    '#__ux .cur.down{transform:scale(.8)}' +
    '#__ux .ring{position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #ffd257;opacity:0;transition:opacity .4s, transform .4s}' +
    '#__ux .hl{position:absolute;border:3px solid #ffd257;border-radius:6px;box-shadow:0 0 0 4px rgba(255,210,87,.35),0 0 24px rgba(255,210,87,.6);opacity:0;transition:opacity .2s}' +
    '#__ux .title{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(10,8,20,.86);color:#fff;opacity:0;transition:opacity .35s}' +
    '#__ux .title b{font-size:28px;letter-spacing:.2em;color:#ffd257;margin-bottom:12px}' +
    '#__ux .title span{font-size:64px;font-weight:700}' +
    '#__ux .title i{font-size:24px;margin-top:16px;color:#cbd;font-style:normal}' +
    '#__ux .cap{position:absolute;left:50%;bottom:28px;transform:translateX(-50%);max-width:80%;padding:10px 22px;border-radius:8px;background:rgba(10,8,20,.82);color:#fff;font-size:24px;opacity:0;transition:opacity .25s;text-align:center}' +
    '#__ux .tag{position:absolute;left:16px;top:16px;padding:6px 12px;border-radius:6px;background:rgba(10,8,20,.7);color:#ffd257;font-size:16px}';
  let root, cur, ring, hl, title, cap, tag;
  function ensure() {
    if (root && root.isConnected) return true;
    if (!document.documentElement) return false;
    const st = document.createElement('style'); st.textContent = css;
    root = document.createElement('div'); root.id = '__ux'; root.append(st);
    cur = document.createElement('div'); cur.className = 'cur';
    cur.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M2 2l7 18 2.6-7.4L19 10z" fill="#fff" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    ring = document.createElement('div'); ring.className = 'ring';
    hl = document.createElement('div'); hl.className = 'hl';
    title = document.createElement('div'); title.className = 'title';
    cap = document.createElement('div'); cap.className = 'cap';
    tag = document.createElement('div'); tag.className = 'tag';
    root.append(hl, ring, cap, tag, title, cur);
    document.documentElement.append(root);
    cur.style.left = (window.__uxX || -50) + 'px'; cur.style.top = (window.__uxY || -50) + 'px';
    return true;
  }
  const mv = e => { window.__uxX = e.clientX; window.__uxY = e.clientY; if (ensure()) { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; } };
  addEventListener('mousemove', mv, true); addEventListener('pointermove', mv, true);
  addEventListener('mousedown', e => { if (!ensure()) return; cur.classList.add('down'); ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px'; ring.style.transition = 'none'; ring.style.opacity = 1; ring.style.transform = 'scale(.4)'; requestAnimationFrame(() => { ring.style.transition = ''; ring.style.opacity = 0; ring.style.transform = 'scale(1.4)'; }); }, true);
  addEventListener('mouseup', () => cur && cur.classList.remove('down'), true);
  window.__ux = {
    title(kicker, text, sub) { if (!ensure()) return; title.innerHTML = ''; const b = document.createElement('b'); b.textContent = kicker; const s = document.createElement('span'); s.textContent = text; const i = document.createElement('i'); i.textContent = sub || ''; title.append(b, s, i); title.style.opacity = 1; },
    untitle() { if (ensure()) title.style.opacity = 0; },
    caption(t) { if (!ensure()) return; cap.textContent = t || ''; cap.style.opacity = t ? 1 : 0; },
    tag(t) { if (!ensure()) return; tag.textContent = t || ''; tag.style.display = t ? '' : 'none'; },
    hl(x, y, w, h, round) { if (!ensure()) return; Object.assign(hl.style, { left: (x - 4) + 'px', top: (y - 4) + 'px', width: (w + 8) + 'px', height: (h + 8) + 'px', borderRadius: round ? '50%' : '6px', opacity: 1 }); },
    unhl() { if (ensure()) hl.style.opacity = 0; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensure); else ensure();
})();`;

const IGNORE_CONSOLE = [/GL Driver Message/, /GPU stall/, /WebGL: too many errors/, /Automatic fallback to software WebGL/];

export class Flow {
  page!: Page;
  ctx!: BrowserContext;
  extra: { ctx: BrowserContext; page: Page; label: string }[] = [];
  t0 = Date.now();
  res: FlowResult;
  slow: boolean;
  shotN = 0;
  current = "";
  dialogs: string[] = [];
  crashed = false;
  expecting = 0; // >0: chyby v konzoli a síti jsou očekávané (záměrně špatný vstup)

  browser: Browser;
  opts: Opts;

  constructor(browser: Browser, opts: Opts, id: string, name: string) {
    this.browser = browser; this.opts = opts;
    this.res = { id, name, status: "OK", steps: [], measures: [], issues: [], console: [], network: [], videos: [], durationS: 0 };
    this.slow = opts.mode === "record";
  }

  get dir() { return this.opts.out; }
  t() { return Math.round((Date.now() - this.t0) / 100) / 10; }
  url(p: string) { return this.opts.base.replace(/\/$/, "") + p; }

  async newContext(viewport = { width: 1920, height: 1080 }, extra: Record<string, unknown> = {}) {
    const ctx = await this.browser.newContext({
      viewport, locale: "cs-CZ", timezoneId: "Europe/Prague", colorScheme: "dark",
      ...(this.opts.mode === "record" ? { recordVideo: { dir: path.join(this.dir, "raw"), size: viewport } } : {}),
      ...extra
    });
    await ctx.addInitScript(OVERLAY);
    // čeština jako výchozí jazyk hry, bez nápovědy na celou obrazovku
    await ctx.addInitScript(() => { try { if (!localStorage.getItem("pk-lang")) localStorage.setItem("pk-lang", "cs"); } catch (e) { /* bez úložiště */ } });
    return ctx;
  }

  watch(page: Page, label: string) {
    const starts = new Map<object, number>();
    page.on("console", m => {
      const type = m.type();
      if (type !== "error" && type !== "warning") return;
      const text = m.text();
      if (IGNORE_CONSOLE.some(r => r.test(text))) return;
      this.res.console.push({ kind: `${label}:${type}`, url: page.url(), text: text.slice(0, 400), at: this.t(), expected: this.expecting > 0 || undefined });
    });
    page.on("crash", () => {
      this.crashed = true;
      this.res.console.push({ kind: `${label}:crash`, url: page.url(), text: "Stránka spadla (renderer crash / nedostatek paměti)", at: this.t() });
    });
    page.on("pageerror", e => this.res.console.push({ kind: `${label}:pageerror`, url: page.url(), text: String(e.message).slice(0, 400), at: this.t() }));
    page.on("request", r => starts.set(r, Date.now()));
    page.on("requestfailed", r => {
      const f = r.failure();
      if (f && /ERR_ABORTED/.test(f.errorText) && /\.(mp3|ogg|webm)$/.test(r.url())) return;
      this.res.network.push({ kind: "failed", url: r.url(), text: f ? f.errorText : "", at: this.t() });
    });
    page.on("requestfinished", async r => {
      const st = starts.get(r); const ms = st ? Date.now() - st : 0;
      const resp = await r.response().catch(() => null);
      const status = resp ? resp.status() : 0;
      if (status >= 400) this.res.network.push({ kind: "http", url: r.url(), status, ms, at: this.t(), expected: this.expecting > 0 || undefined });
      else if (ms > 1500 && this.opts.mode === "audit") this.res.network.push({ kind: "slow", url: r.url(), status, ms, at: this.t() });
    });
    page.on("dialog", async (d: Dialog) => {
      this.dialogs.push(`${d.type()}: ${d.message()}`);
      this.issue(`Nativní dialog prohlížeče (${d.type()}): „${d.message()}“`);
      // během otevřeného dialogu stránka neodpovídá na evaluate → nejdřív potvrdit, pak popisek
      await new Promise(r => setTimeout(r, this.slow ? 1000 : 0));
      await d.accept().catch(() => {});
      await this.caption(`Prohlížeč zobrazil nativní dialog „${d.message()}“ → potvrzeno OK`, page);
    });
  }

  async open() {
    this.ctx = await this.newContext();
    this.page = await this.ctx.newPage();
    this.t0 = Date.now();
    this.watch(this.page, "A");
    await this.page.goto("about:blank");
  }

  async openExtra(label: string, viewport = { width: 1920, height: 1080 }) {
    const ctx = await this.newContext(viewport);
    const page = await ctx.newPage();
    this.watch(page, label);
    this.extra.push({ ctx, page, label });
    return page;
  }

  async pause(ms = 700, page = this.page) { if (this.slow) await page.waitForTimeout(ms); else await page.waitForTimeout(Math.min(ms, 120)); }
  async think(ms = 1200, page = this.page) { if (this.slow) await page.waitForTimeout(ms); }

  async caption(text: string, page = this.page) { await page.evaluate(t => (window as any).__ux && (window as any).__ux.caption(t), text).catch(() => {}); }

  async title(page = this.page) {
    await page.evaluate(([k, t]) => { const u = (window as any).__ux; u.title(k, t, "Goralia · UX audit"); }, [`WORKFLOW ${this.res.id}`, this.res.name]).catch(() => {});
    await page.waitForTimeout(this.slow ? 2200 : 50);
    await page.evaluate(() => (window as any).__ux.untitle()).catch(() => {});
    await page.waitForTimeout(this.slow ? 400 : 10);
  }

  // Krok workflow: měří čas, při chybě uloží screenshot a vyhodí výjimku (workflow skončí).
  async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.current = name;
    const at = this.t(); const st = Date.now();
    await this.caption(name);
    try {
      const v = await fn();
      this.res.steps.push({ name, at, dur: Date.now() - st, ok: true });
      return v;
    } catch (e: any) {
      const shot = await this.shot(`selhani-${name}`);
      const error = String(e && e.message || e).split("\n")[0].slice(0, 300);
      this.res.steps.push({ name, at, dur: Date.now() - st, ok: false, error, shot });
      this.res.failure = { step: name, error, shot, at };
      await this.caption(`✖ Krok selhal: ${name}`);
      await this.page.waitForTimeout(this.slow ? 2000 : 0).catch(() => {});
      throw e;
    }
  }

  // Měkká kontrola: problém se zapíše, workflow pokračuje.
  async check(cond: boolean | Promise<boolean>, text: string) {
    if (!(await cond)) await this.issue(text, true);
  }

  async issue(text: string, shot = false) {
    this.res.issues.push({ at: this.t(), text, shot: shot ? await this.shot(`problem-${text}`) : undefined });
  }

  async shot(name: string, page = this.page) {
    const safe = name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 60).replace(/^-|-$/g, "").toLowerCase();
    const file = path.join(this.dir, "screenshoty", `${this.res.id}_${String(++this.shotN).padStart(2, "0")}_${safe}.png`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file }).catch(() => {});
    return path.relative(this.dir, file);
  }

  // Záměrně chybný vstup: chyby 4xx a hlášky konzole během fn se nepočítají jako problém.
  async expectErrors<T>(fn: () => Promise<T>): Promise<T> {
    this.expecting++;
    try { const v = await fn(); await this.page.waitForTimeout(400); return v; } finally { this.expecting--; }
  }

  async measure<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const st = Date.now();
    const v = await fn();
    this.res.measures.push({ label, ms: Date.now() - st, at: this.t() });
    return v;
  }

  loc(target: string | Locator, page = this.page) { return typeof target === "string" ? page.locator(target).first() : target; }

  async highlight(x: number, y: number, w: number, h: number, page = this.page, round = false) {
    await page.evaluate(([x, y, w, h, r]) => (window as any).__ux.hl(x, y, w, h, r), [x, y, w, h, round] as const).catch(() => {});
  }
  async unhighlight(page = this.page) { await page.evaluate(() => (window as any).__ux.unhl()).catch(() => {}); }

  // Klik jako uživatel: najet myší, zvýraznit prvek, chvíli počkat, kliknout.
  async click(target: string | Locator, opts: { page?: Page; timeout?: number; caption?: string } = {}) {
    const page = opts.page || this.page;
    const el = this.loc(target, page);
    await el.waitFor({ state: "visible", timeout: opts.timeout ?? 15000 });
    await el.scrollIntoViewIfNeeded().catch(() => {});
    const box = await el.boundingBox();
    if (opts.caption) await this.caption(opts.caption, page);
    if (box) {
      await this.highlight(box.x, box.y, box.width, box.height, page);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: this.slow ? 18 : 1 });
      await this.pause(550, page);
    }
    await el.click({ timeout: opts.timeout ?? 15000 });
    await this.unhighlight(page);
    await this.pause(650, page);
  }

  async type(target: string | Locator, text: string, page = this.page) {
    await this.click(target, { page });
    await this.loc(target, page).fill("");
    if (this.slow) await this.loc(target, page).pressSequentially(text, { delay: 55 });
    else await this.loc(target, page).fill(text);
    await this.pause(350, page);
  }

  // Plynulé scrollování kolečkem (pro video).
  async scroll(dy: number, page = this.page) {
    const n = Math.max(1, Math.round(Math.abs(dy) / 120));
    for (let i = 0; i < n; i++) { await page.mouse.wheel(0, Math.sign(dy) * 120); await page.waitForTimeout(this.slow ? 70 : 5); }
    await this.pause(500, page);
  }

  async close() {
    const pages = [{ page: this.page, ctx: this.ctx, label: "A" }, ...this.extra];
    for (const p of pages) {
      const v = p.page && p.page.video();
      await p.ctx.close().catch(() => {});
      if (v) { const f = await v.path().catch(() => ""); if (f) this.res.videos.push(f); }
    }
    this.res.durationS = this.t();
  }
}

/* ---------- herní plocha: přepočet souřadnic a čtení stavu ---------- */
export interface Pt { x: number; y: number }

export async function worldToClient(page: Page, wx: number, wy: number): Promise<Pt> {
  return page.evaluate(([wx, wy]) => {
    const g = (window as any).PK.game, v = (window as any).PK.view;
    const r = document.getElementById("game")!.getBoundingClientRect();
    return { x: r.left + (wx - g.cam.x * 2) * g.zoom * r.width / (v.w * 2), y: r.top + (wy - g.cam.y * 2) * g.zoom * r.height / (v.h * 2) };
  }, [wx, wy]);
}

export async function hudButton(page: Page, type: string): Promise<(Pt & { w: number; h: number }) | null> {
  return page.evaluate(t => {
    const b = (window as any).PK.hud.buttons.find((b: any) => b.visible && b.type === t);
    if (!b) return null;
    const v = (window as any).PK.view, r = document.getElementById("game")!.getBoundingClientRect();
    const kx = r.width / (v.w * 2), ky = r.height / (v.h * 2);
    return { x: r.left + b.lx * kx, y: r.top + b.ly * ky, w: b.lw * kx, h: b.lh * ky };
  }, type);
}

// Spadlá stránka na evaluate nikdy neodpoví, proto časový limit.
function timed<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what}: stránka neodpovídá ${ms / 1000} s (spadla?)`)), ms))]);
}

export async function gameState(page: Page) {
  return timed(page.evaluate(() => {
    const g = (window as any).PK.game;
    const pick = (o: any) => ({ id: o.id, type: o.type, team: o.team, x: o.x, y: o.y, hp: o.hp, progress: o.progress, amount: o.amount });
    return {
      state: g.state, me: g.me, gold: g.gold, wood: g.wood,
      units: g.units.map(pick), buildings: g.buildings.map(pick),
      gold_mines: g.resources.filter((r: any) => r.type === "gold").map(pick),
      selected: (g.selected || []).map((s: any) => s.id),
      heapMB: (performance as any).memory ? Math.round((performance as any).memory.usedJSHeapSize / 1048576) : 0
    };
  }), 20000, "stav hry");
}
