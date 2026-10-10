/*
 * Panel serveru: přehled, správa hráčů, živé místnosti a připojení, zápasy a záznam akcí admina.
 * Stránku i API dostane jen přihlášený admin; veškerý obsah z databáze se vkládá jako textContent.
 */
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const REFRESH_MS = 5000;

  let tab = "overview";
  let timer = 0;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: method === "GET" ? {} : { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body || {})
    });

    let json = null;
    try { json = await res.json(); } catch (e) { /* prázdná odpověď */ }
    if (!res.ok) throw new Error((json && json.error) || `Chyba ${res.status}`);
    return json;
  }

  function notice(content) {
    const box = $("notice");
    box.replaceChildren(...[].concat(content));
    box.hidden = false;
  }

  const fail = e => notice(`Chyba: ${e.message}`);
  const when = ms => (ms ? new Date(ms).toLocaleString("cs-CZ") : "–");

  function duration(sec) {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return [d ? `${d} d` : "", h || d ? `${h} h` : "", `${m} min`].filter(Boolean).join(" ");
  }

  function table(headers, rows, empty = "Nic tu není.") {
    if (!rows.length) return el("p", "muted", empty);

    const t = el("table");
    const thead = el("thead");
    const head = el("tr");
    for (const h of headers) head.append(el("th", "", h));
    thead.append(head);
    t.append(thead);

    const body = el("tbody");
    for (const cells of rows) {
      const tr = el("tr");

      for (const cell of cells) {
        const td = el("td");

        if (cell && cell.actions) {
          const box = el("div", "actions");
          box.append(...cell.actions);
          td.append(box);
        } else if (cell instanceof Node) {
          td.append(cell);
        } else {
          td.textContent = cell == null || cell === "" ? "–" : String(cell);
        }

        tr.append(td);
      }

      body.append(tr);
    }

    t.append(body);
    return t;
  }

  function button(label, onClick, danger) {
    const b = el("button", danger ? "danger" : "", label);
    b.type = "button";
    b.addEventListener("click", async () => {
      b.disabled = true;

      try { await onClick(); } catch (e) { fail(e); }
      finally { b.disabled = false; }
    });
    return b;
  }

  /* ---------- přehled ---------- */
  async function loadOverview() {
    const o = await api("GET", "/api/admin/overview");
    const cards = [
      ["Připojení", o.online], ["Přihlášení hráči online", o.authed], ["Místnosti", o.rooms], ["Běžící zápasy", o.matchesRunning],
      ["Hráči ve hře", o.playing], ["Registrovaní hráči", o.users], ["Zablokovaní", o.banned], ["Administrátoři", o.admins],
      ["Zaznamenané zápasy", o.matches], ["Běží", duration(o.uptime), "small"], ["Paměť (RSS)", `${Math.round(o.rss / 1048576)} MB`, "small"], ["Node.js", o.node, "small"],
      ["Přihlášení přes Google", o.providers.google ? "zapnuto" : "vypnuto", o.providers.google ? "good small" : "bad small"],
      ["Přihlášení přes Facebook", o.providers.facebook ? "zapnuto" : "vypnuto", o.providers.facebook ? "good small" : "bad small"],
      ["Veřejná adresa (PUBLIC_URL)", o.publicUrl || "není nastavena", o.publicUrl ? "small" : "bad small"]
    ];

    $("cards").replaceChildren(...cards.map(([label, value, cls]) => {
      const card = el("div", "card");
      card.append(el("div", "label", label), el("div", `value ${cls || ""}`.trim(), String(value)));
      return card;
    }));
  }

  /* ---------- hráči ---------- */
  async function loadUsers() {
    const q = $("user-q").value.trim();
    const data = await api("GET", `/api/admin/users?limit=100&q=${encodeURIComponent(q)}`);
    $("user-total").textContent = `Celkem: ${data.total}${data.total > data.users.length ? ` (zobrazeno ${data.users.length})` : ""}`;

    $("users").replaceChildren(table(
      ["ID", "Přezdívka", "E-mail", "Přihlášení", "Výhry/zápasy", "Registrace", "Naposledy", "Akce"],
      data.users.map((u, i) => {
        const name = el("span", "", u.name);
        if (u.role === "admin") name.append(el("span", "badge admin", "admin"));
        if (data.online[i]) name.append(el("span", "badge online", "online"));
        if (u.banned) name.append(el("span", "badge banned", u.banned.reason ? `ban: ${u.banned.reason}` : "ban"));

        const via = [u.password ? "heslo" : "", u.google ? "Google" : "", u.facebook ? "Facebook" : ""].filter(Boolean).join(", ");

        const actions = [
          button(u.banned ? "Odblokovat" : "Zablokovat", async () => {
            if (u.banned) {
              await api("POST", `/api/admin/users/${u.id}/ban`, { banned: false });
            } else {
              const reason = window.prompt(`Důvod zablokování hráče ${u.name} (nepovinné):`, "");
              if (reason === null) return;
              await api("POST", `/api/admin/users/${u.id}/ban`, { banned: true, reason });
            }
            await loadUsers();
          }, !u.banned),
          button(u.role === "admin" ? "Odebrat admina" : "Udělat adminem", async () => {
            const make = u.role !== "admin";
            if (!window.confirm(make ? `Opravdu dát hráči ${u.name} plná admin práva?` : `Odebrat hráči ${u.name} admin práva?`)) return;
            await api("POST", `/api/admin/users/${u.id}/role`, { role: make ? "admin" : "user" });
            await loadUsers();
          }),
          button("Nové heslo", async () => {
            if (!window.confirm(`Vygenerovat nové heslo pro ${u.name}? Hráč bude odhlášen.`)) return;
            const result = await api("POST", `/api/admin/users/${u.id}/password`, {});
            notice([`Nové heslo pro ${u.name}: `, el("code", "", result.password), " (zobrazuje se jen teď, předej ho hráči a ať si ho změní)"]);
          }),
          button("Smazat", async () => {
            if (!window.confirm(`Opravdu smazat účet ${u.name}? Nelze vrátit.`)) return;
            await api("DELETE", `/api/admin/users/${u.id}`);
            await loadUsers();
          }, true)
        ];

        return [u.id, name, u.email, via, `${u.wins}/${u.games}`, when(u.created), when(u.lastSeen || u.lastLogin), { actions }];
      }),
      "Žádný hráč nenalezen."
    ));
  }

  $("user-search").addEventListener("submit", event => {
    event.preventDefault();
    loadUsers().catch(fail);
  });

  /* ---------- online ---------- */
  async function loadLive() {
    const [rooms, clients] = await Promise.all([api("GET", "/api/admin/rooms"), api("GET", "/api/admin/clients")]);

    $("rooms").replaceChildren(table(
      ["ID", "Mapa", "Stav", "Hostitel", "Hráči", "Sloty", "Akce"],
      rooms.rooms.map(r => [
        r.id, r.map, r.state === "playing" ? "hraje se" : "lobby", r.host, r.players.join(", "), r.slots.join(" / "),
        { actions: [button("Zavřít místnost", async () => {
          if (!window.confirm(`Zavřít místnost ${r.id}? Hráči budou odpojeni.`)) return;
          await api("POST", `/api/admin/rooms/${r.id}/close`, {});
          await loadLive();
        }, true)] }
      ]),
      "Žádná místnost."
    ));

    $("clients").replaceChildren(table(
      ["Klient", "Účet", "IP", "Místnost", "Akce"],
      clients.clients.map(c => [
        c.id, c.userId ? `${c.name} (#${c.userId})` : "nepřihlášený", c.ip, c.room,
        { actions: [button("Odpojit", async () => {
          await api("POST", `/api/admin/clients/${c.id}/kick`, {});
          await loadLive();
        }, true)] }
      ]),
      "Nikdo není připojený."
    ));
  }

  /* ---------- zápasy a záznam ---------- */
  async function loadMatches() {
    const data = await api("GET", "/api/admin/matches?limit=50");

    $("matches").replaceChildren(table(
      ["Kdy", "Mapa", "Délka", "Konec", "Hráči"],
      data.matches.map(m => {
        const players = el("span");
        m.players.forEach((p, i) => {
          if (i) players.append(", ");
          players.append(el("span", p.result, `${p.name}${p.ai ? " (AI)" : ""}`));
        });

        return [when(m.ended), m.map, `${Math.floor(m.duration / 60)}:${String(m.duration % 60).padStart(2, "0")}`, m.reason, players];
      }),
      "Zatím žádné zaznamenané zápasy."
    ));
  }

  async function loadAudit() {
    const data = await api("GET", "/api/admin/audit");
    $("audit").replaceChildren(table(["Kdy", "Admin", "Akce", "Detail"], data.audit.map(a => [when(a.at), a.admin, a.action, a.detail]), "Zatím žádné akce."));
  }

  /* ---------- záložky ---------- */
  const loaders = { overview: loadOverview, users: loadUsers, live: loadLive, matches: loadMatches, audit: loadAudit };

  function refresh() {
    return loaders[tab]().catch(fail);
  }

  function select(name) {
    tab = name;
    for (const button of $("tabs").querySelectorAll("button")) button.classList.toggle("active", button.dataset.tab === name);
    for (const section of document.querySelectorAll(".tab")) section.hidden = section.id !== `tab-${name}`;
    $("notice").hidden = true;
    refresh();
  }

  $("tabs").addEventListener("click", event => {
    const target = event.target.closest("button[data-tab]");
    if (target) select(target.dataset.tab);
  });

  api("GET", "/api/me").then(data => {
    if (!data.user || data.user.role !== "admin") {
      notice("Nejsi přihlášený jako administrátor.");
      return;
    }

    $("who").textContent = `Přihlášen: ${data.user.name}`;
    refresh();
    timer = setInterval(() => {
      if (!document.hidden && (tab === "overview" || tab === "live")) refresh();
    }, REFRESH_MS);
  }).catch(fail);

  window.addEventListener("beforeunload", () => clearInterval(timer));
})();
