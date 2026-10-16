/*
 * Naplánované turnaje v menu hry: proužek s odpočtem v hlavním menu a stránka turnaje
 * s parametry, přihlášenými hráči a přihlášením. Turnaje plánuje admin v server panelu.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const $ = id => document.getElementById(id);
  const REFRESH_MS = 60 * 1000;
  const RUNNING_MS = 3 * 3600 * 1000; // stejně jako server: tak dlouho po začátku turnaj „probíhá“

  const host = { show() {} };
  let list = [];
  let skew = 0; // serverový čas - čas prohlížeče
  let shown = null; // id turnaje na stránce turnaje
  let busy = false;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const now = () => Date.now() + skew;
  const two = n => String(n).padStart(2, "0");

  // „2 d 05:12:33“, pod den jen „05:12:33“
  function countdown(ms) {
    const sec = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(sec / 86400);
    const clock = `${two(Math.floor((sec % 86400) / 3600))}:${two(Math.floor((sec % 3600) / 60))}:${two(sec % 60)}`;
    return d ? `${d} d ${clock}` : clock;
  }

  const fmtStart = ms => new Date(ms).toLocaleString("cs-CZ", { weekday: "short", day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const mapName = id => {
    if (!id) return "libovolná";
    const map = PK.maps && PK.maps.get(id);
    return map ? map.name : id;
  };

  async function request(method, url) {
    const res = await fetch(url, { method, credentials: "same-origin", headers: method === "GET" ? {} : { "Content-Type": "application/json" }, body: method === "GET" ? undefined : "{}" });
    let json = null;
    try { json = await res.json(); } catch (e) { /* prázdná odpověď */ }
    if (!res.ok) throw Object.assign(new Error((json && json.error) || "Server není dostupný."), { status: res.status });
    return json;
  }

  function accept(data) {
    list = data.events;
    skew = data.now - Date.now();
    tick();
    if (shown != null && !$("panel-event").hidden) render();
  }

  async function load() {
    try {
      accept(await request("GET", "/api/events"));
    } catch (e) {
      // bez serveru (hra offline) se proužek prostě neukáže
    }
  }

  /* ---------- proužek v hlavním menu ---------- */
  function tick() {
    const t = now();
    const next = list.find(e => e.start + RUNNING_MS > t);
    const banner = $("m-event");
    banner.hidden = !next;

    if (next) {
      const left = next.start - t;
      banner.classList.toggle("live", left <= 0);
      $("m-event-name").textContent = next.name;
      $("m-event-time").textContent = left > 0 ? `začíná za ${countdown(left)}` : "právě probíhá";
      banner.dataset.id = String(next.id);
    }

    if (shown != null && !$("panel-event").hidden) renderCount();
  }

  /* ---------- stránka turnaje ---------- */
  const current = () => list.find(e => e.id === shown) || null;

  function renderCount() {
    const e = current();
    if (!e) return;
    const left = e.start - now();
    const label = left > 0 ? countdown(left) : "PROBÍHÁ";
    const box = $("te-count");
    if (box.dataset.label === label) return;
    box.dataset.label = label;

    const big = window.GFame ? GFame.pixelText(label, { color: left > 0 ? PK.C.a[3] : PK.C.glow[1], zoom: 4 }) : el("b", "", label);
    box.replaceChildren(el("span", "event-count-label", left > 0 ? "do začátku" : "turnaj"), big);
    $("te-join").hidden = left <= 0;
  }

  function render() {
    const e = current();
    if (!e) {
      $("te-name").textContent = "Turnaj";
      $("te-status").textContent = "Tento turnaj už není v plánu.";
      $("te-join").hidden = true;
      return;
    }

    const user = PK.account && PK.account.user;
    $("te-name").textContent = e.name;
    $("te-when").textContent = `Začátek: ${fmtStart(e.start)}`;
    $("te-count").dataset.label = "";
    renderCount();

    const rows = [["Formát", e.formatName], ["Mapa", mapName(e.map)], ["Hráči", `${e.players.length} / ${e.maxPlayers}`]];
    if (e.prize) rows.push(["Odměna", e.prize]);
    $("te-info").replaceChildren(...rows.map(([label, value]) => {
      const row = el("div", "stat");
      row.append(el("span", "stat-label", label), el("b", "stat-value", value));
      return row;
    }));

    $("te-desc").hidden = !e.description;
    $("te-desc").textContent = e.description;

    const full = e.players.length >= e.maxPlayers;
    const join = $("te-join");
    join.textContent = !user ? "Přihlásit se a hrát" : e.joined ? "Odhlásit se z turnaje" : full ? "Turnaj je plný" : "Přihlásit se do turnaje";
    join.disabled = busy || (!!user && !e.joined && full);
    join.classList.toggle("joined", e.joined);
    if (!$("te-status").classList.contains("error")) $("te-status").textContent = e.joined ? "Jsi přihlášený. V čas začátku buď online v Multiplayeru." : "";

    $("te-players").replaceChildren(...(e.players.length
      ? e.players.map((p, i) => el("span", `event-player${user && p.id === user.id ? " me" : ""}`, `${i + 1}. ${p.name}`))
      : [el("span", "status small", "Zatím nikdo. Buď první!")]));

    const others = list.filter(x => x.id !== e.id);
    $("te-more").hidden = !others.length;
    $("te-more").replaceChildren(el("h3", "touch-title", "Další turnaje"), ...others.map(x => {
      const b = el("button", "event-other");
      b.type = "button";
      b.append(el("span", "event-name", x.name), el("span", "event-other-when", fmtStart(x.start)));
      b.addEventListener("click", () => open(x.id));
      return b;
    }));
  }

  function open(id) {
    shown = Number(id);
    $("te-status").textContent = "";
    $("te-status").classList.remove("error");
    render();
    host.show("event");
    load();
  }

  async function toggleJoin() {
    const e = current();
    if (!e || busy) return;

    if (!PK.account.user) {
      PK.account.openLogin(() => open(e.id), "Pro přihlášení do turnaje se přihlas ke svému účtu.");
      return;
    }

    busy = true;
    $("te-status").classList.remove("error");
    try {
      accept(await request("POST", `/api/events/${e.id}/${e.joined ? "leave" : "join"}`));
    } catch (err) {
      if (err.status === 401) PK.account.expired();
      $("te-status").textContent = err.message;
      $("te-status").classList.add("error");
    } finally {
      busy = false;
      render();
    }
  }

  function init(options) {
    Object.assign(host, options);
    $("m-event").addEventListener("click", () => open($("m-event").dataset.id));
    $("te-join").addEventListener("click", toggleJoin);
    load();
    setInterval(tick, 1000);
    setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
  }

  PK.events = { init, open, reload: load };
})();
