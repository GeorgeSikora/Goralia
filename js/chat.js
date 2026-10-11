/*
 * Chat místnosti: společný pro všechny hráče v jedné online místnosti (lobby i rozehraný zápas).
 * Okno žije v lobby pod výběrem mapy; ve hře je překryv vlevo dole, zprávy po chvíli zmizí.
 * Otevření a odeslání: Enter, zavření: Esc, na dotykovém displeji tlačítko „Chat“.
 * Text se vkládá výhradně přes textContent (žádné HTML od hráčů).
 */
(() => {
  "use strict";

  const PK = window.PK;
  const R = PK.rules;

  const MAX_LEN = 200;
  const MAX_LINES = 80;
  const FADE_MS = 10000; // ve hře zpráva po této době zmizí z přehledu (zůstává v otevřeném okně)

  const state = {
    where: "off", // off | lobby | game
    roomId: 0,
    open: false,
    unread: 0,
    me: "",
    muted: new Set(),
    seen: new Set(),
    players: [],
    slot: null // kam je okno právě vložené (lobby)
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  /* ---------- stavba okna ---------- */
  const root = el("div", "chat");
  root.id = "chat";
  root.hidden = true;

  const head = el("div", "chat-head");
  const title = el("span", "chat-title", "Chat místnosti");
  const muteBtn = el("button", "chat-mutebtn", "Ztlumit");
  muteBtn.type = "button";
  muteBtn.title = "Ztlumit hráče, jehož zprávy nechceš vidět";
  head.append(title, muteBtn);

  const mutes = el("div", "chat-mutes");
  mutes.hidden = true;

  const log = el("div", "chat-log");
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");

  const bar = el("div", "chat-bar");
  const toggle = el("button", "chat-toggle", "Chat");
  toggle.type = "button";
  toggle.setAttribute("aria-label", "Otevřít chat (Enter)");
  const badge = el("span", "chat-badge");
  badge.hidden = true;
  toggle.append(badge);

  const form = el("form", "chat-form");
  form.autocomplete = "off";
  const input = el("input", "chat-input");
  input.type = "text";
  input.maxLength = MAX_LEN;
  input.placeholder = "Napiš zprávu a stiskni Enter…";
  input.setAttribute("aria-label", "Zpráva do chatu");
  input.autocomplete = "off";
  input.spellcheck = false;
  const send = el("button", "chat-send", "Poslat");
  send.type = "submit";
  form.append(input, send);
  bar.append(toggle, form);

  root.append(head, mutes, log, bar);
  document.querySelector(".app").append(root);

  /* ---------- vykreslení ---------- */
  const colorOf = slot => {
    const team = R.TEAMS[slot];
    return team && PK.TEAM[team] ? PK.css(PK.TEAM[team].ui) : "#c4ccdc";
  };

  function trim() {
    while (log.children.length > MAX_LINES) log.firstChild.remove();
  }

  function scrollDown() {
    log.scrollTop = log.scrollHeight;
  }

  function addLine(entry) {
    const line = el("div", entry.sys ? "chat-line sys" : "chat-line");
    line.dataset.at = String(Date.now());

    if (entry.sys) {
      line.textContent = entry.text;
    } else {
      const name = el("span", "chat-name", entry.name);
      name.style.color = colorOf(entry.slot);
      line.append(name, el("span", "chat-text", entry.text));
    }

    log.append(line);
    trim();
    scrollDown();
    return line;
  }

  function noteUnread() {
    if (state.where === "game" && !state.open) {
      state.unread++;
      badge.textContent = String(Math.min(state.unread, 9));
      badge.hidden = false;
    }
  }

  function receive(m) {
    if (!m) return;
    const text = String(m.text == null ? "" : m.text).slice(0, MAX_LEN);
    if (!text) return;

    if (m.sys) {
      addLine({ sys: true, text });
      return;
    }

    const name = String(m.name || "?").slice(0, 40);
    if (name !== state.me) state.seen.add(name);
    if (state.muted.has(name)) return;

    addLine({ name, slot: m.slot | 0, text });
    if (name !== state.me) noteUnread();
  }

  function receiveLog(list) {
    if (!Array.isArray(list)) return;
    for (const m of list) {
      const name = String(m && m.name || "?").slice(0, 40);
      if (name !== state.me) state.seen.add(name);
      if (m && !state.muted.has(name)) addLine({ name, slot: m.slot | 0, text: String(m.text || "").slice(0, MAX_LEN) });
    }
  }

  /* ---------- ztlumení ---------- */
  function renderMutes() {
    mutes.replaceChildren();
    const names = [...new Set([...state.players, ...state.seen])].filter(n => n && n !== state.me);

    if (!names.length) {
      mutes.append(el("span", "chat-empty", "Zatím tu není nikdo, koho bys mohl ztlumit."));
      return;
    }

    for (const name of names) {
      const on = state.muted.has(name);
      const b = el("button", on ? "chat-mute on" : "chat-mute", `${on ? "Zrušit ztlumení: " : "Ztlumit: "}${name}`);
      b.type = "button";
      b.addEventListener("click", () => {
        if (state.muted.has(name)) state.muted.delete(name);
        else state.muted.add(name);
        addLine({ sys: true, text: state.muted.has(name) ? `${name} je ztlumen.` : `${name} už není ztlumen.` });
        renderMutes();
      });
      mutes.append(b);
    }
  }

  muteBtn.addEventListener("click", () => {
    mutes.hidden = !mutes.hidden;
    if (!mutes.hidden) renderMutes();
  });

  /* ---------- otevření a zavření (ve hře) ---------- */
  function setOpen(on) {
    on = !!on && state.where !== "off";
    state.open = on;
    root.classList.toggle("open", on);
    toggle.setAttribute("aria-expanded", String(on));

    if (on) {
      state.unread = 0;
      badge.hidden = true;
      for (const line of log.children) line.classList.remove("old");
      scrollDown();
      input.focus({ preventScroll: true });
    } else {
      mutes.hidden = true;
      if (document.activeElement === input) input.blur();
    }
  }

  toggle.addEventListener("click", () => setOpen(!state.open));

  input.addEventListener("keydown", event => {
    // hra nesmí dostat písmena z chatu jako zkratky ani Esc jako menu
    event.stopPropagation();

    if (event.key === "Escape") {
      event.preventDefault();
      if (state.where === "game") setOpen(false);
      else input.blur();
    }
  });

  input.addEventListener("keyup", event => event.stopPropagation());

  form.addEventListener("submit", event => {
    event.preventDefault();
    const text = input.value.replace(/\s+/g, " ").trim().slice(0, MAX_LEN);
    input.value = "";

    if (text && PK.net.connected) PK.net.send({ t: "chat", text });
    if (state.where === "game") setOpen(false);
  });

  window.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.repeat || state.where !== "game" || state.open) return;
    if (event.target && event.target.matches("input, textarea, select")) return;

    event.preventDefault();
    setOpen(true);
  });

  // klepnutí do mapy zavře psaní, ať hra znovu dostává klávesy
  document.addEventListener("pointerdown", event => {
    if (state.open && state.where === "game" && !root.contains(event.target)) setOpen(false);
  }, true);

  /* ---------- zobrazení ve hře: staré zprávy mizí ---------- */
  setInterval(() => {
    if (state.where !== "game" || state.open) return;
    const now = Date.now();
    for (const line of log.children) line.classList.toggle("old", now - Number(line.dataset.at) > FADE_MS);
  }, 1000);

  /* ---------- umístění ---------- */
  function place() {
    if (state.where === "game") {
      const a = PK.chat.anchor ? PK.chat.anchor() : null;
      root.style.left = a ? `${Math.round(a.left)}px` : "8px";
      root.style.bottom = a ? `${Math.round(a.bottom)}px` : "8px";
    } else {
      root.style.left = "";
      root.style.bottom = "";
    }
  }

  window.addEventListener("resize", place);
  setInterval(() => { if (state.where === "game") place(); }, 500);

  /* ---------- veřejné rozhraní ---------- */
  // where: "off" (skryto) | "lobby" (v panelu lobby) | "game" (překryv ve hře)
  // Volá se opakovaně; mění jen to, co se opravdu změnilo.
  function sync(opts) {
    const roomId = opts.roomId | 0;
    const where = roomId ? opts.where : "off";

    if (opts.me != null) state.me = String(opts.me);
    if (Array.isArray(opts.players)) {
      const key = opts.players.join("\n");
      if (key !== state.playersKey) {
        state.playersKey = key;
        state.players = opts.players.slice();
        if (!mutes.hidden) renderMutes();
      }
    }

    if (roomId !== state.roomId) {
      // Vstup do místnosti (0 -> id) nic nemaže: historie z místnosti může dorazit dřív než tahle změna.
      // Smaže se při odchodu (id -> 0) a při přechodu rovnou do jiné místnosti.
      const entering = !state.roomId && roomId;
      state.roomId = roomId;

      if (!entering) {
        log.replaceChildren();
        state.seen.clear();
        state.unread = 0;
        badge.hidden = true;
      }

      if (!roomId) state.muted.clear();
    }

    if (where === state.where && (where !== "lobby" || root.parentNode === opts.slot)) return;

    const was = state.where;
    state.where = where;
    if (was === "game" || where !== "game") setOpen(false);

    root.hidden = where === "off";
    root.classList.toggle("in-lobby", where === "lobby");
    root.classList.toggle("in-game", where === "game");
    title.textContent = "Chat místnosti";

    if (where === "lobby" && opts.slot) {
      opts.slot.append(root);
    } else if (root.parentNode !== document.querySelector(".app")) {
      document.querySelector(".app").append(root);
    }

    for (const line of log.children) line.classList.remove("old");
    place();
    scrollDown();
  }

  PK.chat = { sync, receive, receiveLog, anchor: null, focus: () => { if (state.where === "lobby") input.focus(); else setOpen(true); } };
})();
