/*
 * Jazyky hry: čeština (výchozí, zdrojová), angličtina a po našimu (těšínské nářečí).
 *
 * Klíčem překladu je český text, takže kód zůstává čitelný a co nemá překlad, ukáže se česky:
 *   PK.t("Hra proti AI")                       -> "Game vs AI"
 *   PK.t("Výzkum trvá {s} s.", { s: 20 })      -> proměnné ve složených závorkách
 *   PK.tn(n, "hráč", "hráči", "hráčů")         -> tvar podle čísla (1 / 2–4 / 5+)
 *   PK.tr(zpráva)                              -> přeloží hotovou českou větu, i se vloženými čísly
 *                                                 (zprávy ze serveru a ze simulace, která běží i v Node)
 *
 * Překlady jsou v js/lang/<jazyk>.js (PK.i18n.add). Statické HTML se přeloží samo: textové uzly
 * a atributy title / aria-label / placeholder / alt se hledají ve slovníku podle původního českého
 * znění. Odstavce s vnořeným HTML mají data-i18n-html="klíč" a překlad je HTML.
 * Volba jazyka je v localStorage "pk-lang"; změnu hlásí událost "pk-lang" na window.
 */
(() => {
  "use strict";

  const PK = (window.PK = window.PK || {});
  const KEY = "pk-lang";

  const LANGS = [
    { id: "cs", name: "Čeština", html: "cs" },
    { id: "en", name: "English", html: "en" },
    { id: "szl", name: "Po našimu", html: "szl" }
  ];
  const IDS = LANGS.map(l => l.id);
  const dict = { cs: {}, en: {}, szl: {} };

  function initial() {
    try {
      const url = new URLSearchParams(location.search).get("lang");
      if (IDS.includes(url)) {
        localStorage.setItem(KEY, url);
        return url;
      }
    } catch (e) { /* bez URL */ }

    try {
      const saved = localStorage.getItem(KEY);
      if (IDS.includes(saved)) return saved;
    } catch (e) { /* soukromé okno */ }

    const nav = (navigator.languages || [navigator.language || "cs"]).map(s => String(s).toLowerCase());
    for (const l of nav) {
      if (l.startsWith("cs") || l.startsWith("sk")) return "cs";
      if (l.startsWith("szl")) return "szl";
      if (l.startsWith("en")) return "en";
    }
    return nav.length && !nav[0].startsWith("cs") ? "en" : "cs";
  }

  let lang = initial();

  const fill = (s, vars) => vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : String(s);

  function t(key, vars) {
    const hit = lang === "cs" ? undefined : dict[lang][key];
    return fill(hit == null ? key : hit, vars);
  }

  // tvar podle čísla: 0 = 1 kus, 1 = 2–4 kusy, 2 = 5 a víc (v angličtině jen 1 / ostatní)
  function form(n, l = lang) {
    n = Math.abs(Number(n) || 0);
    if (l === "en") return n === 1 ? 0 : 2;
    if (n === 1) return 0;
    return n >= 2 && n <= 4 && Number.isInteger(n) ? 1 : 2;
  }

  function tn(n, one, few, many, vars) {
    const key = `${one}|${few}|${many}`;
    const hit = lang === "cs" ? null : dict[lang][key];
    const forms = Array.isArray(hit) ? hit : [one, few, many];
    const i = form(n);
    return fill(forms[i] != null ? forms[i] : forms[forms.length - 1], { n, ...vars });
  }

  /* ---------- překlad hotových vět (zprávy ze simulace a serveru) ---------- */
  let patterns = null; // [regex, klíč, jména proměnných] pro aktuální jazyk

  function buildPatterns() {
    patterns = [];
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    for (const key of Object.keys(dict[lang] || {})) {
      if (!/\{\w+\}/.test(key) || key.includes("|")) continue;
      const names = [];
      const re = key.split(/(\{\w+\})/).map(part => {
        const m = /^\{(\w+)\}$/.exec(part);
        if (!m) return esc(part);
        names.push(m[1]);
        return "(.+?)";
      }).join("");
      patterns.push([new RegExp(`^${re}$`), key, names]);
    }
    // delší (konkrétnější) vzory dřív
    patterns.sort((a, b) => b[1].length - a[1].length);
  }

  let memo = new Map();

  function tr(msg) {
    if (msg == null) return msg;
    msg = String(msg);
    if (lang === "cs") return msg;
    const d = dict[lang];
    if (d[msg] != null && typeof d[msg] === "string") return d[msg];
    if (memo.has(msg)) return memo.get(msg);
    if (memo.size > 4000) memo.clear();
    const out = trSlow(msg, d);
    memo.set(msg, out);
    return out;
  }

  // pixelové písmo kreslí velkými písmeny a někde se text zvětší už před překladem ("HRÁT")
  let upper = null;
  function upperHit(msg) {
    if (msg !== msg.toUpperCase() || !/\p{L}/u.test(msg)) return null;
    if (!upper) {
      upper = new Map();
      for (const [k, v] of Object.entries(dict[lang] || {})) if (typeof v === "string") upper.set(k.toUpperCase(), v.toUpperCase());
    }
    return upper.has(msg) ? upper.get(msg) : null;
  }

  function trSlow(msg, d) {
    if (d[msg] != null && typeof d[msg] === "string") return d[msg];
    const up = upperHit(msg);
    if (up != null) return up;

    if (!patterns) buildPatterns();
    for (const [re, key, names] of patterns) {
      const m = re.exec(msg);
      if (!m) continue;
      const vars = {};
      // vložené kusy bývají také české (název výzkumu, barva týmu): přeložíme i ty
      names.forEach((n, i) => { vars[n] = d[m[i + 1]] != null && typeof d[m[i + 1]] === "string" ? d[m[i + 1]] : tr(m[i + 1]); });
      return fill(d[key], vars);
    }
    return msg;
  }

  /* ---------- HTML: statické i to, co dopíší skripty ---------- */
  const ATTRS = ["title", "aria-label", "placeholder", "alt"];
  const origText = new WeakMap(); // textový uzel -> původní české znění
  const shown = new WeakMap(); // textový uzel -> co jsme do něj sami napsali
  const origAttr = new WeakMap();
  const origHtml = new WeakMap();
  let busy = false; // vlastní zápisy nespouští překlad znovu

  const skipped = el => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const tag = e.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" || e.hasAttribute("data-i18n-skip") || e.hasAttribute("data-i18n-html")) return true;
    }
    return false;
  };

  function convert(orig) {
    const core = orig.trim();
    if (!core || !/\p{L}/u.test(core)) return orig;
    const out = tr(core.replace(/\s+/g, " "));
    return out === core.replace(/\s+/g, " ") ? orig : orig.replace(core, out);
  }

  function textNode(node, force) {
    if (shown.get(node) === node.nodeValue && !force) return;
    const orig = shown.get(node) === node.nodeValue ? origText.get(node) : node.nodeValue;
    origText.set(node, orig);
    const out = convert(orig);
    shown.set(node, out);
    if (out !== node.nodeValue) node.nodeValue = out;
  }

  function attrs(el, force) {
    let saved = origAttr.get(el);
    for (const a of ATTRS) {
      if (!el.hasAttribute(a)) continue;
      if (!saved) origAttr.set(el, (saved = {}));
      const cur = el.getAttribute(a);
      if (cur === saved["_" + a] && !force) continue;
      if (cur !== saved["_" + a]) saved[a] = cur;
      const v = convert(saved[a]);
      saved["_" + a] = v;
      if (v !== cur) el.setAttribute(a, v);
    }
  }

  function htmlBlock(el) {
    if (!origHtml.has(el)) origHtml.set(el, el.innerHTML);
    const hit = lang === "cs" ? null : dict[lang][el.getAttribute("data-i18n-html")];
    const want = hit == null ? origHtml.get(el) : hit;
    if (el.innerHTML !== want) el.innerHTML = want;
  }

  function apply(root = document.body, force = true) {
    if (!root) return;
    busy = true;
    try {
      if (root.nodeType === 3) {
        if (!skipped(root.parentElement)) textNode(root, force);
        return;
      }
      if (root.nodeType !== 1) return;
      if (root.hasAttribute("data-i18n-html")) htmlBlock(root);
      for (const el of root.querySelectorAll("[data-i18n-html]")) htmlBlock(el);
      if (skipped(root)) return;

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
        acceptNode(node) {
          if (node.nodeType === 1) {
            const tag = node.tagName;
            if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" || node.hasAttribute("data-i18n-html") || node.hasAttribute("data-i18n-skip")) return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      for (let node = walker.currentNode; node; node = walker.nextNode()) {
        if (node.nodeType === 3) textNode(node, force);
        else attrs(node, force);
      }
    } finally {
      busy = false;
    }
  }

  // co skripty dopíší do stránky (stavové hlášky, seznamy, tlačítka), se přeloží hned
  function observe() {
    if (!window.MutationObserver || !document.body) return;
    const mo = new MutationObserver(list => {
      if (busy) return;
      for (const r of list) {
        if (r.type === "characterData") apply(r.target, false);
        else if (r.type === "attributes") { if (!skipped(r.target)) { busy = true; try { attrs(r.target, false); } finally { busy = false; } } }
        else for (const n of r.addedNodes) apply(n, false);
      }
    });
    mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  function applyMeta() {
    const info = LANGS.find(l => l.id === lang);
    document.documentElement.lang = info.html;
    if (!document.documentElement.dataset.titleCs) document.documentElement.dataset.titleCs = document.title;
    document.title = t(document.documentElement.dataset.titleCs);
  }

  function set(next) {
    if (!IDS.includes(next) || next === lang) return;
    lang = next;
    patterns = null;
    memo = new Map();
    upper = null;
    try { localStorage.setItem(KEY, lang); } catch (e) { /* soukromé okno */ }
    applyMeta();
    apply();
    window.dispatchEvent(new CustomEvent("pk-lang", { detail: lang }));
  }

  function add(id, entries) {
    Object.assign(dict[id] || (dict[id] = {}), entries);
    if (id === lang) { patterns = null; memo = new Map(); upper = null; }
  }

  // přepínač jazyka: <select> naplněný jazyky, změna se hned projeví
  function bindSelect(sel) {
    if (!sel) return;
    sel.innerHTML = "";
    for (const l of LANGS) {
      const o = document.createElement("option");
      o.value = l.id;
      o.textContent = l.name;
      sel.appendChild(o);
    }
    sel.value = lang;
    sel.setAttribute("data-i18n-skip", "");
    sel.addEventListener("change", () => set(sel.value));
    window.addEventListener("pk-lang", () => { sel.value = lang; });
  }

  PK.i18n = {
    LANGS,
    get lang() { return lang; },
    set, add, apply, bindSelect, form, tr,
    dict
  };
  PK.t = t;
  PK.tn = tn;
  PK.tr = tr;

  // statické HTML přeložíme, jakmile je stránka načtená
  const start = () => { applyMeta(); apply(); observe(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
