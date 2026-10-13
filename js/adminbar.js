/*
 * Příkazový řádek správce ve hře. Otevře se klávesou „/“ (jen přihlášenému adminovi během zápasu),
 * Enter příkaz odešle, Esc řádek zavře, šipky nahoru a dolů listují historií.
 * Příkazy a jejich tabulka jsou v js/admincmd.js; o spuštění se stará game.js přes PK.adminbar.exec
 * (online jde příkaz na server, který si roli ověří sám, v zápase proti AI se provede v prohlížeči).
 */
(() => {
  "use strict";

  const PK = window.PK;
  const MAX_LEN = 200;
  const MAX_LINES = 40;
  const HISTORY = 30;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const root = el("div", "adminbar");
  root.hidden = true;
  const log = el("div", "adminbar-log");
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");
  const form = el("form", "adminbar-form");
  form.autocomplete = "off";
  const input = el("input", "adminbar-input");
  input.type = "text";
  input.maxLength = MAX_LEN;
  input.placeholder = "/help ukáže všechny příkazy";
  input.setAttribute("aria-label", "Příkaz správce");
  input.spellcheck = false;
  form.append(el("span", "adminbar-title", "Admin"), input);
  root.append(log, form);
  document.querySelector(".app").append(root);

  const history = [];
  let back = -1;

  function print(lines, kind) {
    for (const text of lines) log.append(el("div", `adminbar-line ${kind || ""}`, String(text)));
    while (log.children.length > MAX_LINES) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }

  // Smí se řádek otevřít? (game.js: admin, rozehraný zápas, otevřené menu ne)
  const allowed = () => !!(api.ready && api.ready());

  function open(prefill) {
    if (!allowed()) return;
    root.hidden = false;
    input.value = prefill || "";
    back = -1;
    input.focus();
  }

  function close() {
    root.hidden = true;
    input.blur();
  }

  input.addEventListener("keydown", event => {
    event.stopPropagation(); // písmena nesmí do hry jako zkratky
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      if (!history.length) return;
      back = event.key === "ArrowUp" ? Math.min(history.length - 1, back + 1) : Math.max(-1, back - 1);
      input.value = back < 0 ? "/" : history[history.length - 1 - back];
    }
  });
  input.addEventListener("keyup", event => event.stopPropagation());

  form.addEventListener("submit", event => {
    event.preventDefault();
    let text = input.value.replace(/\s+/g, " ").trim().slice(0, MAX_LEN);
    if (!text) return close();
    if (!text.startsWith("/")) text = "/" + text;

    if (history[history.length - 1] !== text) history.push(text);
    if (history.length > HISTORY) history.shift();
    back = -1;
    input.value = "";

    print([text], "cmd");
    if (api.exec) api.exec(text);
  });

  window.addEventListener("keydown", event => {
    if (event.key !== "/" || event.repeat || !root.hidden) return;
    if (event.target && event.target.matches("input, textarea, select")) return;
    if (!allowed()) return;
    event.preventDefault();
    open("/");
  });

  // mimo zápas (konec hry, návrat do menu) se řádek schová
  setInterval(() => { if (!root.hidden && !allowed()) close(); }, 500);

  // odpověď na příkaz: { ok, lines }
  function receive(m) {
    if (!m || !Array.isArray(m.lines)) return;
    print(m.lines.slice(0, 30), m.ok ? "ok" : "err");
  }

  const api = { open, close, receive, ready: null, exec: null };
  PK.adminbar = api;
})();
