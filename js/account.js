/*
 * Účet hráče v menu: přihlášení a registrace (heslem, Google, Facebook), profily a žebříček hráčů.
 * Komunikuje s HTTP API serveru; veškerý text ze serveru se vkládá jako textContent.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const $ = id => document.getElementById(id);
  const NEXT_KEY = "pk-after-login";

  const me = { user: null, providers: { google: false, facebook: false } };
  const host = { show() {}, onChange() {}, onLogin() {} };
  let afterLogin = null;
  let mode = "login";
  let busy = false;
  let profileBack = "main";
  let profileToken = 0;
  let searchTimer = 0;

  const a = {
    title: $("a-title"), note: $("a-note"), social: $("a-social"), google: $("a-google"), facebook: $("a-facebook"),
    form: $("a-form"), nameRow: $("a-name-row"), name: $("a-name"), idLabel: $("a-id-label"), id: $("a-id"),
    password: $("a-password"), submit: $("a-submit"), toggle: $("a-toggle"), status: $("a-status")
  };

  const p = {
    title: $("pf-title"), meta: $("pf-meta"), status: $("pf-status"), stats: $("pf-stats"), recent: $("pf-recent"), own: $("pf-own"),
    rename: $("pf-rename"), name: $("pf-name"), password: $("pf-password"), current: $("pf-current"), next: $("pf-next")
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  async function api(method, url, body) {
    let res;

    try {
      res = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: method === "GET" ? {} : { "Content-Type": "application/json" },
        body: method === "GET" ? undefined : JSON.stringify(body || {})
      });
    } catch (e) {
      throw new Error("Server není dostupný.");
    }

    let json = null;
    try { json = await res.json(); } catch (e) { /* prázdná odpověď */ }

    if (!res.ok) throw Object.assign(new Error((json && json.error) || "Chyba serveru."), { status: res.status });
    return json;
  }

  function setBusy(value) {
    busy = value;
    for (const node of a.form.querySelectorAll("input, button")) node.disabled = value;
  }

  function setStatus(node, text, isError) {
    node.textContent = text || "";
    node.classList.toggle("error", !!isError);
  }

  /* ---------- stav přihlášení ---------- */
  function renderUser() {
    const user = me.user;
    $("m-account").textContent = user ? `Účet: ${user.name}` : "Přihlásit se";
    $("m-admin").hidden = !(user && user.role === "admin");
    $("o-who").textContent = user ? `Přihlášen jako ${user.name}` : "";
  }

  function setUser(user) {
    const changed = (me.user && me.user.id) !== (user && user.id);
    me.user = user || null;
    renderUser();
    if (changed) host.onChange(me.user);
  }

  async function refresh() {
    try {
      const data = await api("GET", "/api/me");
      me.providers = data.providers || me.providers;
      setUser(data.user);
      return true;
    } catch (e) {
      setUser(null);
      return false;
    }
  }

  /* ---------- přihlášení a registrace ---------- */
  function setMode(next) {
    mode = next;
    const login = next === "login";

    a.title.textContent = login ? "Přihlášení" : "Registrace";
    a.nameRow.hidden = login;
    a.idLabel.textContent = login ? "Přezdívka nebo e-mail" : "E-mail";
    a.id.type = login ? "text" : "email";
    a.id.autocomplete = login ? "username" : "email";
    a.password.autocomplete = login ? "current-password" : "new-password";
    a.submit.textContent = login ? "Přihlásit se" : "Zaregistrovat se";
    a.toggle.textContent = login ? "Nemáš účet? Zaregistruj se" : "Už máš účet? Přihlas se";
    setStatus(a.status, "");
  }

  function openLogin(next, message) {
    afterLogin = next || null;
    a.social.hidden = !(me.providers.google || me.providers.facebook);
    a.google.hidden = !me.providers.google;
    a.facebook.hidden = !me.providers.facebook;
    a.password.value = "";
    setMode("login");
    setStatus(a.note, message || "Pro multiplayer potřebuješ účet, ukládají se na něm statistiky z tvých zápasů.", !!message);
    host.show("account");
    a.id.focus({ preventScroll: true });
  }

  a.toggle.addEventListener("click", () => {
    setMode(mode === "login" ? "register" : "login");
    (mode === "login" ? a.id : a.name).focus({ preventScroll: true });
  });

  a.form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setStatus(a.status, "");

    try {
      const result = mode === "login"
        ? await api("POST", "/api/auth/login", { identifier: a.id.value.trim(), password: a.password.value })
        : await api("POST", "/api/auth/register", { name: a.name.value.trim(), email: a.id.value.trim(), password: a.password.value });

      a.password.value = "";
      setUser(result.user);

      const next = afterLogin;
      afterLogin = null;
      if (next) next();
      else host.show("main");
    } catch (e) {
      setStatus(a.status, e.message, true);
    } finally {
      setBusy(false);
    }
  });

  // Přihlášení přes poskytovatele opouští stránku; po návratu se naváže tam, kde hráč skončil.
  for (const link of [a.google, a.facebook]) {
    link.addEventListener("click", () => {
      try { if (afterLogin) sessionStorage.setItem(NEXT_KEY, "online"); } catch (e) { /* ignore */ }
    });
  }

  function expired(message) {
    setUser(null);
    openLogin(() => host.onLogin("online"), message || "Přihlášení vypršelo, přihlas se znovu.");
  }

  async function logout() {
    try { await api("POST", "/api/auth/logout", {}); } catch (e) { /* relace stejně zanikne */ }
    setUser(null);
    host.show("main");
  }

  /* ---------- profil ---------- */
  const fmtDate = ms => (ms ? new Date(ms).toLocaleDateString("cs-CZ") : "–");

  function fmtTime(sec) {
    const minutes = Math.round(sec / 60);
    return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
  }

  const fmtMatch = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  const RESULTS = { win: "Výhra", loss: "Prohra", draw: "Remíza" };

  function renderProfile(player) {
    const s = player.stats;
    const rate = s.games ? Math.round((s.wins / s.games) * 100) : 0;

    p.title.textContent = player.name;
    const meta = [player.admin ? "Admin" : "", player.online ? "právě online" : player.lastSeen ? `naposledy ${fmtDate(player.lastSeen)}` : "", `od ${fmtDate(player.created)}`, player.banned ? "zablokovaný" : ""];
    p.meta.textContent = meta.filter(Boolean).join(" · ");

    const rows = [
      ["Zápasy", s.games], ["Výhry", `${s.wins} (${rate} %)`], ["Prohry", s.losses], ["Remízy", s.draws],
      ["Výhry proti lidem", `${s.pvpWins} z ${s.pvpGames}`], ["Odehráno", fmtTime(s.playSeconds)],
      ["Zabité jednotky", s.kills], ["Ztracené jednotky", s.unitsLost],
      ["Zničené budovy", s.buildingsDestroyed], ["Ztracené budovy", s.buildingsLost],
      ["Natěženo zlata", s.gold], ["Natěženo dřeva", s.wood],
      ["Vycvičeno jednotek", s.trained], ["Postaveno budov", s.built],
      ["Nejvyšší úroveň hrdiny", s.heroLevel || "–"]
    ];

    p.stats.replaceChildren(...rows.map(([label, value]) => {
      const row = el("div", "stat");
      row.append(el("span", "stat-label", label), el("b", "stat-value", String(value)));
      return row;
    }));

    const items = player.recent.map(m => {
      const map = PK.maps && PK.maps.get(m.map);
      const foes = m.players.filter(x => x.name !== player.name).map(x => (x.ai ? "AI" : x.name));
      const row = el("div", `match ${m.result}`);
      row.append(
        el("b", "match-result", RESULTS[m.result] || m.result),
        el("span", "match-map", `${map ? map.name : m.map} · ${fmtMatch(m.duration)}`),
        el("span", "match-foes", foes.length ? `proti ${foes.join(", ")}` : ""),
        el("span", "match-date", fmtDate(m.ended))
      );
      return row;
    });

    p.recent.replaceChildren(...(items.length ? items : [el("p", "status small", "Zatím žádné odehrané online zápasy.")]));

    const own = !!me.user && me.user.id === player.id;
    p.own.hidden = !own;
    if (own) {
      p.name.value = me.user.name;
      p.password.hidden = false;
      p.current.parentElement.hidden = !me.user.hasPassword;
    }
  }

  async function openProfile(id, back = "main", message = "") {
    const token = ++profileToken;
    profileBack = back;
    p.title.textContent = "Profil";
    p.meta.textContent = "";
    p.stats.replaceChildren();
    p.recent.replaceChildren();
    p.own.hidden = true;
    setStatus(p.status, "Načítám…");
    host.show("profile");

    try {
      const data = await api("GET", `/api/players/${encodeURIComponent(id)}`);
      if (token !== profileToken) return;
      setStatus(p.status, message);
      renderProfile(data.player);
    } catch (e) {
      if (token === profileToken) setStatus(p.status, e.message, true);
    }
  }

  $("pf-back").addEventListener("click", () => host.show(profileBack));
  $("pf-logout").addEventListener("click", logout);

  p.rename.addEventListener("submit", async event => {
    event.preventDefault();

    try {
      const data = await api("POST", "/api/me/name", { name: p.name.value.trim() });
      me.user = data.user;
      renderUser();
      openProfile(me.user.id, profileBack, "Přezdívka změněna.");
    } catch (e) {
      setStatus(p.status, e.message, true);
    }
  });

  p.password.addEventListener("submit", async event => {
    event.preventDefault();

    try {
      const data = await api("POST", "/api/me/password", { current: p.current.value, next: p.next.value });
      me.user = data.user;
      p.current.value = "";
      p.next.value = "";
      renderUser();
      setStatus(p.status, "Heslo bylo změněno. Ostatní zařízení byla odhlášena.");
      p.current.parentElement.hidden = false;
    } catch (e) {
      setStatus(p.status, e.message, true);
    }
  });

  /* ---------- žebříček a hledání hráčů ---------- */
  const list = $("pl-list");
  const query = $("pl-q");
  const listStatus = $("pl-status");
  let listToken = 0;

  async function loadPlayers() {
    const token = ++listToken;
    const q = query.value.trim();
    setStatus(listStatus, "Načítám…");

    try {
      const data = await api("GET", `/api/players?limit=50&q=${encodeURIComponent(q)}`);
      if (token !== listToken) return;

      list.replaceChildren(...data.players.map((player, i) => {
        const row = el("button", "player-row");
        row.type = "button";
        row.append(
          el("span", "player-rank", q ? "" : `${i + 1}.`),
          el("span", `player-name${player.online ? " online" : ""}`, player.admin ? `${player.name} ★` : player.name),
          el("span", "player-score", `${player.pvpWins} výher proti lidem · ${player.wins}/${player.games}`)
        );
        row.addEventListener("click", () => openProfile(player.id, "players"));
        return row;
      }));

      setStatus(listStatus, data.players.length ? (q ? "" : "Řazeno podle výher proti lidem.") : q ? "Nikdo takový tu není." : "Zatím nikdo neodehrál zápas.");
    } catch (e) {
      if (token === listToken) setStatus(listStatus, e.message, true);
    }
  }

  function openPlayers() {
    host.show("players");
    loadPlayers();
  }

  query.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadPlayers, 250);
  });

  /* ---------- napojení na menu ---------- */
  function init(options) {
    Object.assign(host, options);

    $("m-account").addEventListener("click", () => {
      if (me.user) openProfile(me.user.id);
      else openLogin(null);
    });

    $("m-players").addEventListener("click", openPlayers);
    renderUser();
  }

  // Zpracuje návrat z přihlášení přes Google/Facebook (?login=...) a načte stav přihlášení.
  async function start() {
    const reachable = await refresh();
    const params = new URLSearchParams(location.search);
    const result = params.get("login");
    if (!result) return;

    params.delete("login");
    const rest = params.toString();
    history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : ""));

    let next = "";
    try {
      next = sessionStorage.getItem(NEXT_KEY) || "";
      sessionStorage.removeItem(NEXT_KEY);
    } catch (e) { /* ignore */ }

    const errors = {
      failed: "Přihlášení se nezdařilo. Zkus to znovu.",
      denied: "Přihlášení bylo zrušeno.",
      banned: "Tento účet je zablokovaný.",
      unavailable: "Toto přihlášení není na serveru zapnuté."
    };

    if (errors[result] || !reachable || !me.user) openLogin(null, errors[result] || "Server není dostupný.");
    else if (next === "online") host.onLogin("online");
    else if (result === "new") openProfile(me.user.id, "main", "Účet je založený. Přezdívku si můžeš níže změnit.");
  }

  PK.account = {
    init, start, refresh, expired, openLogin, openProfile, openPlayers,
    get user() { return me.user; }
  };
})();
