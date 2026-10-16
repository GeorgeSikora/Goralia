/*
 * Panel serveru: přehled, návštěvnost, správa hráčů, živé místnosti, zápasy, mapy a záznam akcí admina.
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

  // Odehraný čas: pod hodinu v minutách, jinak hodiny a minuty („12 h 05 min“).
  function playTime(sec) {
    const total = Math.floor((sec || 0) / 60);
    const h = Math.floor(total / 60);
    return h ? `${h.toLocaleString("cs-CZ")} h ${String(total % 60).padStart(2, "0")} min` : `${total} min`;
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
      ["Zaznamenané zápasy", o.matches], ["Odehráno celkem (všichni hráči)", playTime(o.playSeconds + o.aiSeconds)],
      ["Z toho multiplayer", playTime(o.playSeconds), "small"], ["Z toho proti AI", playTime(o.aiSeconds), "small"], ["Online celkem (připojení)", playTime(o.onlineSeconds), "small"],
      ["Běží", duration(o.uptime), "small"], ["Paměť (RSS)", `${Math.round(o.rss / 1048576)} MB`, "small"], ["Node.js", o.node, "small"],
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
    const sort = $("user-sort").value;
    const data = await api("GET", `/api/admin/users?limit=100&sort=${sort}&q=${encodeURIComponent(q)}`);
    $("user-total").textContent = `Celkem: ${data.total}${data.total > data.users.length ? ` (zobrazeno ${data.users.length})` : ""}`;

    $("users").replaceChildren(table(
      ["ID", "Přezdívka", "E-mail", "Přihlášení", "Výhry/zápasy", "Odehráno", "Online", "Registrace", "Naposledy", "Akce"],
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

        const played = el("span", "", playTime(u.playSeconds + u.aiSeconds));
        played.title = `multiplayer ${playTime(u.playSeconds)}, proti AI ${playTime(u.aiSeconds)}`;

        return [u.id, name, u.email, via, `${u.wins}/${u.games}`, played, playTime(u.onlineSeconds), when(u.created), when(u.lastSeen || u.lastLogin), { actions }];
      }),
      "Žádný hráč nenalezen."
    ));
  }

  $("user-search").addEventListener("submit", event => {
    event.preventDefault();
    loadUsers().catch(fail);
  });
  $("user-sort").addEventListener("change", () => loadUsers().catch(fail));

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
      ["Klient", "Účet", "IP", "Odkud", "Místnost", "Akce"],
      clients.clients.map(c => [
        c.id, c.userId ? `${c.name} (#${c.userId})` : "nepřihlášený", c.ip, placeName(c.place), c.room,
        { actions: [button("Odpojit", async () => {
          await api("POST", `/api/admin/clients/${c.id}/kick`, {});
          await loadLive();
        }, true)] }
      ]),
      "Nikdo není připojený."
    ));
  }

  /* ---------- odkud se kdo připojuje ---------- */
  let regionNames = null;
  try { regionNames = new Intl.DisplayNames(["cs"], { type: "region" }); } catch (e) { /* starý prohlížeč */ }
  const countryName = (cc, fallback) => {
    if (!cc) return "neznámo";
    try { return (regionNames && regionNames.of(cc)) || fallback || cc; } catch (e) { return fallback || cc; }
  };
  const placeName = p => (p ? [p.city, p.region && p.region !== p.city ? p.region : "", countryName(p.cc, p.country)].filter(Boolean).join(", ") : "");

  let geoMetric = "players";
  const GEO_METRICS = {
    players: ["Hráči", "unikátní připojení ke hře za den, sečteno"],
    visitors: ["Návštěvníci webu", "unikátní návštěvníci stránky hry za den, sečteno"]
  };

  function renderGeo(geo) {
    const wrap = el("div", "geo");
    const head = el("div", "bar range");
    const card = el("div", "chart-card");

    function paint() {
      const [label, hint] = GEO_METRICS[geoMetric];
      const places = geo.places.map(p => ({ ...p, value: p[geoMetric] })).filter(p => p.value > 0);
      const total = places.reduce((n, p) => n + p.value, 0);
      const pct = v => (total ? `${Math.round((v / total) * 1000) / 10} %` : "–");

      const countries = new Map();
      for (const p of places) {
        const c = countries.get(p.cc) || countries.set(p.cc, { cc: p.cc, name: countryName(p.cc, p.country), value: 0, cities: 0 }).get(p.cc);
        c.value += p.value;
        if (p.city) c.cities++;
      }

      const map = GMap.create({
        places: places.filter(p => p.cc).map(p => ({
          lat: p.lat, lon: p.lon, value: p.value,
          title: p.city || p.region || countryName(p.cc, p.country),
          sub: [p.city && p.region !== p.city ? p.region : "", countryName(p.cc, p.country)].filter(Boolean).join(", ")
        })),
        color: PALETTE[geoMetric === "players" ? 0 : 1],
        name: label.toLowerCase(),
        empty: "Za toto období žádná místa."
      });

      const tables = el("div", "geo-tables");
      const countryBox = el("div", "table-wrap");
      countryBox.append(el("h3", "", "Země"), table(
        ["Země", label, "Podíl", "Měst"],
        [...countries.values()].sort((a, b) => b.value - a.value).map(c => [c.cc ? `${c.name} (${c.cc})` : "neznámo", c.value, pct(c.value), c.cities])
      ));
      const cityBox = el("div", "table-wrap");
      const cities = places.filter(p => p.city || p.region);
      cityBox.append(el("h3", "", cities.length > 100 ? "Města (prvních 100)" : "Města"), table(
        ["Město", "Kraj", "Země", label, "Podíl"],
        cities.slice(0, 100).map(p => [p.city || "–", p.region, countryName(p.cc, p.country), p.value, pct(p.value)])
      ));
      tables.append(countryBox, cityBox);

      card.replaceChildren(el("h3", "", "Odkud se připojují"), el("p", "sub", `${hint} · ${total.toLocaleString("cs-CZ")} celkem`), map, tables);
    }

    for (const [key, [label]] of Object.entries(GEO_METRICS)) {
      const b = el("button", key === geoMetric ? "active" : "", label);
      b.type = "button";
      b.addEventListener("click", () => {
        geoMetric = key;
        for (const other of head.querySelectorAll("button")) other.classList.toggle("active", other === b);
        paint();
      });
      head.append(b);
    }

    const src = geo.source;
    const credit = el("span", "muted");
    const day = ms => (ms ? new Date(ms).toLocaleDateString("cs-CZ") : "?");
    if (src && /dbip/i.test(src.type)) {
      const a = el("a", "link", "DB-IP.com");
      a.href = "https://db-ip.com";
      a.target = "_blank";
      a.rel = "noopener";
      credit.append("IP geolokace: ", a, ` (CC BY 4.0), databáze z ${day(src.built)}`);
    } else if (src) {
      credit.textContent = `Databáze ${src.type} z ${day(src.built)}`;
    }
    head.append(credit);

    paint();
    wrap.append(head, card);

    if (!geo.enabled) {
      const off = el("p", "notice");
      off.append("Geolokace je vypnutá: na serveru chybí databáze. Stáhni ji příkazem ", el("code", "", "npm run geoip"),
        " (DB-IP City Lite, zdarma) a server ji do hodiny načte sám. IP adresy se nikam neposílají.");
      wrap.insertBefore(off, head);
    }
    return wrap;
  }

  /* ---------- odkud přišli (zdroje návštěv) ---------- */
  const SOURCE_KINDS = {
    direct: "Přímo",
    search: "Vyhledávač",
    social: "Sociální síť",
    web: "Odkaz z webu",
    campaign: "Kampaň",
    internal: "Z webu hry"
  };
  const sourceName = s => s.name || (s.kind === "direct" ? "Přímý přístup" : SOURCE_KINDS[s.kind] || s.kind);

  function shareCell(value, total, max = total) { // pruh je poměrný k nejčastějšímu řádku
    const box = el("div", "share");
    const track = el("span", "share-track");
    const bar = el("span", "share-bar");
    bar.style.width = `${max ? Math.max(1, Math.round((value / max) * 100)) : 0}%`;
    track.append(bar);
    box.append(track, el("span", "", total ? `${Math.round((value / total) * 1000) / 10} %` : "–"));
    return box;
  }

  function renderSources(sources, campaigns) {
    const card = el("div", "chart-card sources");
    const total = sources.reduce((n, s) => n + s.visits, 0);
    card.append(el("h3", "", "Odkud přišli"), el("p", "sub",
      `příchody na web podle zdroje · ${total.toLocaleString("cs-CZ")} celkem (návštěvník se za den počítá jednou za každý vnější zdroj)`));

    const kinds = new Map();
    for (const s of sources) kinds.set(s.kind, (kinds.get(s.kind) || 0) + s.visits);

    const tables = el("div", "geo-tables");
    const srcBox = el("div", "table-wrap");
    srcBox.append(el("h3", "", "Zdroje"), table(
      ["Zdroj", "Typ", "Příchody", "Podíl"],
      sources.slice(0, 100).map(s => [sourceName(s), SOURCE_KINDS[s.kind] || s.kind, s.visits, shareCell(s.visits, total, sources[0].visits)]),
      "Za toto období zatím žádné příchody."
    ));
    const kindBox = el("div", "table-wrap");
    kindBox.append(el("h3", "", "Podle typu"), table(
      ["Typ", "Příchody", "Podíl"],
      [...kinds].sort((a, b) => b[1] - a[1]).map(([kind, n]) => [SOURCE_KINDS[kind] || kind, n, shareCell(n, total, Math.max(...kinds.values()))]),
      "–"
    ));
    tables.append(srcBox, kindBox);
    card.append(tables);

    if (campaigns.length) {
      const campBox = el("div", "table-wrap");
      campBox.append(el("h3", "", "Kampaně (utm_source / utm_medium / utm_campaign)"), table(
        ["Kampaň", "Příchody"],
        campaigns.slice(0, 50).map(c => [c.name, c.visits])
      ));
      const wrap = el("div", "geo-tables");
      wrap.append(campBox);
      card.append(wrap);
    }
    return card;
  }

  /* ---------- návštěvnost ---------- */
  const PALETTE = ["#3987e5", "#d95926", "#199e70"]; // ověřeno pro tmavý povrch panelu (čitelnost i pro barvoslepé)
  const WEEKDAYS = ["ne", "po", "út", "st", "čt", "pá", "so"];
  let trafficDays = 30;

  const dayLabel = iso => {
    const [, m, d] = iso.split("-").map(Number);
    return `${d}. ${m}.`;
  };
  const dayLong = iso => {
    const date = new Date(`${iso}T12:00:00`);
    return `${WEEKDAYS[date.getDay()]} ${dayLabel(iso)} ${iso.slice(0, 4)}`;
  };
  const sum = (rows, key) => rows.reduce((n, r) => n + (r[key] || 0), 0);
  const hours = sec => (sec >= 3600 ? `${(sec / 3600).toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} h` : `${Math.round(sec / 60)} min`);

  function chartCard(title, sub, chart) {
    const card = el("div", "chart-card");
    card.append(el("h3", "", title));
    if (sub) card.append(el("p", "sub", sub));
    card.append(chart);
    return card;
  }

  function evenTicks(min, max, width) {
    const n = Math.max(2, Math.min(8, Math.floor(width / 70)));
    const step = Math.max(1, Math.ceil((max - min) / (n - 1)));
    const out = [];
    for (let t = min; t <= max; t += step) out.push(t);
    return out;
  }

  // Po dnech: x = index dne
  function dayChart(days, title, sub, defs) {
    return chartCard(title, sub, GChart.line({
      x: days.map((_, i) => i),
      label: title,
      series: defs.map(([name, key], k) => ({ name, color: PALETTE[k], values: days.map(d => (typeof key === "function" ? key(d) : d[key])) })),
      xTicks: evenTicks,
      xFmt: i => dayLabel(days[i].date),
      tipTitle: i => dayLong(days[i].date)
    }));
  }

  function midnightTicks(min, max, width) {
    const out = [];
    const d = new Date(min);
    d.setHours(24, 0, 0, 0);
    const span = Math.ceil((max - min) / 86400000);
    const every = Math.max(1, Math.ceil(span / Math.max(2, Math.floor(width / 80))));
    for (let i = 0; d.getTime() <= max; i++, d.setDate(d.getDate() + 1)) if (i % every === 0) out.push(d.getTime());
    return out;
  }

  function renderTraffic(data) {
    const days = data.days;
    const box = $("traffic");
    const views = sum(days, "views");
    const tiles = [
      ["Návštěvníci", sum(days, "visitors"), "součet unikátních za jednotlivé dny"],
      ["Zobrazení hry", views, `${sum(days, "bots")} robotů nezapočteno`],
      ["Z mobilu / tabletu", views ? `${Math.round((sum(days, "mobile") / views) * 100)} %` : "–", "podíl zobrazení"],
      ["Nepřihlášení ve hře", sum(days, "guests"), "unikátní za den, sečteno"],
      ["Přihlášení ve hře", sum(days, "players"), "unikátní za den, sečteno"],
      ["Hry proti AI", sum(days, "aiStarted"), `${sum(days, "aiFinished")} dohráno, ${sum(days, "aiWins")} výher · ${hours(sum(days, "aiSeconds"))}`],
      ["Online zápasy", sum(days, "matches"), `${sum(days, "pvp")} proti lidem · ${hours(sum(days, "matchSeconds"))}`],
      ["Nové registrace", sum(days, "registrations"), `${sum(days, "logins")} přihlášení`],
      ["Nejvíc online naráz", Math.max(0, ...days.map(d => d.peak)), "špička za období"]
    ];

    const cards = el("div", "cards");
    for (const [label, value, hint] of tiles) {
      const card = el("div", "card");
      card.append(el("div", "label", label), el("div", "value", typeof value === "number" ? value.toLocaleString("cs-CZ") : value), el("div", "hint", hint));
      cards.append(card);
    }

    const grid = el("div", "chart-grid");
    grid.append(
      dayChart(days, "Návštěvnost webu", "unikátní návštěvníci a zobrazení stránky hry za den", [["Návštěvníci", "visitors"], ["Zobrazení", "views"]]),
      dayChart(days, "Kdo hraje", "unikátní připojení ke hře za den", [["Nepřihlášení", "guests"], ["Přihlášení", "players"]]),
      dayChart(days, "Odehrané hry", "spuštěné hry proti AI (i bez účtu) a dokončené online zápasy", [["Proti AI", "aiStarted"], ["Online", "matches"]]),
      dayChart(days, "Účty", "nové registrace a přihlášení za den", [["Registrace", "registrations"], ["Přihlášení", "logins"]])
    );

    // Vzorky po 5 minutách; u delšího období se průměrují po hodinách, aby graf nebyl zubatý.
    // Když server neběžel (díra ve vzorcích), čára se přeruší.
    const samples = data.samples;
    const spanDays = samples.length ? (samples[samples.length - 1][0] - samples[0][0]) / 86400000 : 0;
    const bucket = spanDays > 2 ? 3600000 : 300000;
    const merged = new Map();
    for (const smp of samples) {
      const key = Math.floor(smp[0] / bucket) * bucket;
      const row = merged.get(key) || { n: 0, v: [0, 0, 0] };
      row.n++;
      row.v[0] += smp[1];
      row.v[1] += smp[2];
      row.v[2] += smp[3];
      merged.set(key, row);
    }

    const xs = [];
    const lines = [[], [], []];
    let prev = null;
    for (const [key, row] of [...merged.entries()].sort((a, b) => a[0] - b[0])) {
      if (prev != null && key - prev > bucket * 2.5) {
        xs.push(prev + bucket);
        for (const l of lines) l.push(null);
      }
      xs.push(key);
      row.v.forEach((v, k) => lines[k].push(Math.round((v / row.n) * 10) / 10));
      prev = key;
    }

    const fmtTime = ms => new Date(ms).toLocaleString("cs-CZ", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
    grid.append(chartCard("Online v čase", `${bucket > 300000 ? "průměr za hodinu" : "vzorek každých 5 minut"}, posledních ${Math.min(14, trafficDays)} dní`, GChart.line({
      x: xs,
      label: "Online v čase",
      series: [["Připojení", lines[0]], ["Přihlášení", lines[1]], ["Ve hře", lines[2]]].map(([name, values], k) => ({ name, color: PALETTE[k], values })),
      xTicks: midnightTicks,
      xFmt: ms => { const d = new Date(ms); return `${WEEKDAYS[d.getDay()]} ${d.getDate()}. ${d.getMonth() + 1}.`; },
      tipTitle: fmtTime,
      empty: "Zatím žádné vzorky (první přibude do 5 minut po startu serveru)."
    })));

    const byHour = Array.from({ length: 24 }, () => ({ total: 0, n: 0 }));
    for (const s of samples) {
      const h = new Date(s[0]).getHours();
      byHour[h].total += s[1];
      byHour[h].n++;
    }
    grid.append(chartCard("Kdy se hraje", "průměrný počet připojených podle hodiny dne", GChart.bars({
      labels: byHour.map((_, h) => String(h)),
      values: samples.length ? byHour.map(b => (b.n ? Math.round((b.total / b.n) * 10) / 10 : 0)) : [],
      integer: false,
      color: PALETTE[0],
      name: "průměrně online",
      every: 3,
      tipTitle: i => `${i}:00–${i}:59`,
      empty: "Zatím žádné vzorky."
    })));

    const details = el("details", "days");
    details.append(el("summary", "", "Tabulka po dnech"));
    const wrapTable = el("div", "table-wrap");
    wrapTable.append(table(
      ["Den", "Návštěvníci", "Zobrazení", "Mobil", "Hosté", "Přihlášení", "Špička", "Proti AI", "Online zápasy", "Registrace"],
      days.slice().reverse().map(d => [dayLong(d.date), d.visitors, d.views, d.mobile, d.guests, d.players, d.peak, `${d.aiStarted} / ${d.aiFinished}`, d.matches, d.registrations])
    ));
    details.append(wrapTable);

    box.replaceChildren(cards, grid, renderSources(data.sources || [], data.campaigns || []), renderGeo(data.geo || { enabled: false, places: [] }), details);
    $("traffic-note").textContent = `Časové pásmo ${data.tz}. Bez cookies, IP se neukládá (u míst jen souhrn za den: země, kraj, město; u zdrojů jen název sítě nebo doména).`;
  }

  async function loadTraffic() {
    const box = $("traffic");
    box.classList.add("loading");

    try {
      renderTraffic(await api("GET", `/api/admin/traffic?days=${trafficDays}`));
    } finally {
      box.classList.remove("loading");
    }
  }

  $("range").addEventListener("click", event => {
    const b = event.target.closest("button[data-days]");
    if (!b) return;
    trafficDays = Number(b.dataset.days);
    for (const other of $("range").querySelectorAll("button")) other.classList.toggle("active", other === b);
    loadTraffic().catch(fail);
  });

  /* ---------- detail zápasu (modální okno) ---------- */
  const mapName = id => {
    const map = window.PK && PK.maps && PK.maps.get(id);
    return map ? map.name : id;
  };
  let lastFocus = null;

  function closeModal() {
    $("modal").hidden = true;
    $("modal-body").replaceChildren();
    if (lastFocus) lastFocus.focus();
  }

  async function openMatch(id) {
    lastFocus = document.activeElement;
    $("modal-title").textContent = `Zápas #${id}`;
    $("modal-body").replaceChildren(el("p", "muted", "Načítám…"));
    $("modal").hidden = false;
    $("modal-close").focus();

    try {
      const data = await api("GET", `/api/matches/${id}`);
      $("modal-body").replaceChildren(GMatch.render(data.match, {
        mapName,
        onPlayer: userId => {
          closeModal();
          $("user-q").value = String(userId);
          select("users");
        }
      }));
    } catch (e) {
      $("modal-body").replaceChildren(el("p", "muted", `Chyba: ${e.message}`));
    }
  }

  $("modal-close").addEventListener("click", closeModal);
  $("modal").addEventListener("click", event => { if (event.target === $("modal")) closeModal(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !$("modal").hidden) closeModal(); });

  /* ---------- zápasy a záznam ---------- */
  const PAGE = 50;
  let matchOffset = 0;

  async function loadMatches() {
    const data = await api("GET", `/api/admin/matches?limit=${PAGE}&offset=${matchOffset}`);
    const t = el("table");
    const head = el("tr");
    for (const h of ["#", "Kdy", "Mapa", "Délka", "Konec", "Hráči", "Průběh"]) head.append(el("th", "", h));
    const thead = el("thead");
    thead.append(head);
    const body = el("tbody");

    for (const m of data.matches) {
      const tr = el("tr", "clickable");
      tr.tabIndex = 0;
      tr.title = "Zobrazit detail zápasu";
      const players = el("span");
      m.players.forEach((p, i) => {
        if (i) players.append(", ");
        players.append(el("span", p.result, `${p.name}${p.ai ? " (AI)" : ""}`));
      });

      const cells = [m.id, when(m.ended), mapName(m.map), GMatch.clock(m.duration), m.reason, players, m.detailed ? "graf" : "–"];
      for (const c of cells) {
        const td = el("td", c === players ? "wrap" : "");
        if (c instanceof Node) td.append(c);
        else td.textContent = String(c);
        tr.append(td);
      }

      tr.addEventListener("click", () => openMatch(m.id));
      tr.addEventListener("keydown", e => { if (e.key === "Enter") openMatch(m.id); });
      body.append(tr);
    }

    t.append(thead, body);
    $("matches").replaceChildren(data.matches.length ? t : el("p", "muted", "Zatím žádné zaznamenané zápasy."));

    const from = data.total ? matchOffset + 1 : 0;
    $("matches-page").textContent = `${from}–${matchOffset + data.matches.length} z ${data.total}`;
    $("matches-newer").disabled = matchOffset === 0;
    $("matches-older").disabled = matchOffset + PAGE >= data.total;
  }

  $("matches-newer").addEventListener("click", () => { matchOffset = Math.max(0, matchOffset - PAGE); loadMatches().catch(fail); });
  $("matches-older").addEventListener("click", () => { matchOffset += PAGE; loadMatches().catch(fail); });

  async function loadAudit() {
    const data = await api("GET", "/api/admin/audit");
    $("audit").replaceChildren(table(["Kdy", "Admin", "Akce", "Detail"], data.audit.map(a => [when(a.at), a.admin, a.action, a.detail]), "Zatím žádné akce."));
  }

  /* ---------- mapy ---------- */
  const fmtDate = ms => (ms ? new Date(ms).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–");

  // Mapové API vrací { errors: [...] }, ne { error }.
  async function mapRequest(method, url, body) {
    const res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* prázdná odpověď */ }
    if (!res.ok) throw new Error((json && json.errors && json.errors.join(" ")) || (json && json.error) || `Chyba ${res.status}`);
    return json;
  }

  function mapLink(label, href, newTab = true) {
    const a = el("a", "mini", label);
    a.href = href;
    if (newTab) { a.target = "_blank"; a.rel = "noopener"; }
    return a;
  }

  async function downloadMap(id) {
    const data = await mapRequest("GET", "/api/maps");
    const doc = (data.maps || []).find(m => m.id === id);
    if (!doc) throw new Error("Mapa už neexistuje.");

    const a = el("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 1)], { type: "application/json" }));
    a.download = `${id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function loadMapsTab() {
    const data = await api("GET", "/api/admin/maps");
    renderMaps(data.maps);
  }

  function renderMaps(maps) {
    const on = maps.filter(m => m.multiplayer).length;
    $("map-summary").textContent = `V multiplayeru: ${on} z ${maps.length} map`;

    const t = el("table");
    const head = el("tr");
    for (const h of ["Mapa", "Typ", "Hráči", "Velikost", "Doly", "Upraveno", "Multiplayer", "Akce"]) head.append(el("th", "", h));
    const thead = el("thead");
    thead.append(head);
    const body = el("tbody");

    for (const m of maps) {
      const tr = el("tr", m.multiplayer ? "" : "map-off");

      const name = el("td");
      name.append(el("b", "", m.name), el("span", "sub", `${m.id}${m.description ? ` · ${m.description.slice(0, 70)}${m.description.length > 70 ? "…" : ""}` : ""}`));

      const type = el("td");
      type.append(el("span", `badge ${m.custom ? "custom" : "builtin"}`, m.custom ? "vlastní" : "vestavěná"));

      const toggle = el("label", `mp-toggle${m.multiplayer ? "" : " off"}`);
      const box = el("input");
      box.type = "checkbox";
      box.checked = m.multiplayer;
      box.setAttribute("aria-label", `Multiplayer: ${m.name}`);
      box.addEventListener("change", async () => {
        box.disabled = true;

        try {
          const result = await api("POST", `/api/admin/maps/${m.id}/multiplayer`, { enabled: box.checked });
          renderMaps(result.maps);
        } catch (e) {
          box.checked = !box.checked;
          fail(e);
        } finally {
          box.disabled = false;
        }
      });
      toggle.append(box, document.createTextNode(m.multiplayer ? "povoleno" : "vypnuto"));
      const mp = el("td");
      mp.append(toggle);

      const actions = el("td", "actions-cell");
      const box2 = el("div", "actions");
      box2.append(
        mapLink(m.custom ? "Upravit" : "Upravit kopii", `/editor.html?map=${encodeURIComponent(m.id)}`),
        mapLink("Hrát", `/index.html?map=${encodeURIComponent(m.id)}`)
      );

      if (m.custom) {
        box2.append(
          button("Stáhnout", () => downloadMap(m.id)),
          button("Smazat", async () => {
            if (!window.confirm(`Opravdu smazat mapu „${m.name}“ (${m.id})? Nelze vrátit.`)) return;
            await mapRequest("DELETE", `/api/maps/${encodeURIComponent(m.id)}`);
            await loadMapsTab();
          }, true)
        );
      }

      actions.append(box2);
      tr.append(name, type, el("td", "", String(m.players)), el("td", "", `${m.width}×${m.height}`), el("td", "", String(m.gold)), el("td", "", fmtDate(m.updated)), mp, actions);
      body.append(tr);
    }

    t.append(thead, body);
    $("maps").replaceChildren(t);
  }

  $("map-upload").addEventListener("click", () => $("map-file").click());

  $("map-file").addEventListener("change", async event => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;

    try {
      const raw = JSON.parse(await file.text());
      const id = raw && typeof raw.id === "string" ? raw.id : "";
      if (!/^[a-z0-9-]{1,31}$/.test(id)) throw new Error("Soubor není mapa Goralie nebo má neplatný identifikátor.");

      const existing = [...$("maps").querySelectorAll("tbody tr")].some(tr => tr.querySelector(".sub") && tr.querySelector(".sub").textContent.startsWith(id));
      if (existing && !window.confirm(`Mapa „${id}“ už existuje. Přepsat?`)) return;

      await mapRequest("PUT", `/api/maps/${encodeURIComponent(id)}`, raw);
      notice(`Mapa „${id}“ je nahraná a k dispozici ve hře.`);
      await loadMapsTab();
    } catch (e) {
      fail(e);
    }
  });

  /* ---------- turnaje ---------- */
  async function loadTournaments() {
    const data = await api("GET", "/api/admin/tournaments");

    $("tournaments").replaceChildren(table(
      ["Datum", "Turnaj", "1. místo", "2. místo", "3. místo", "Účastníků", "Zapsal", "Akce"],
      data.tournaments.map(t => {
        const at = place => (t.entrants.find(e => e.place === place) || {}).name || "";
        return [new Date(t.date).toLocaleDateString("cs-CZ"), t.name, at(1), at(2), at(3), t.entrants.length, t.by, { actions: [
          button("Smazat", async () => {
            if (!window.confirm(`Smazat turnaj „${t.name}“? Body za něj zmizí ze síně slávy.`)) return;
            await api("DELETE", `/api/admin/tournaments/${t.id}`);
            await loadTournaments();
          }, true)
        ] }];
      }),
      "Zatím žádný turnaj."
    ));
  }

  $("tour-date").value = new Date().toISOString().slice(0, 10);

  $("tour-form").addEventListener("submit", async event => {
    event.preventDefault();
    const submit = $("tour-form").querySelector("button");
    submit.disabled = true;

    try {
      const result = await api("POST", "/api/admin/tournaments", {
        name: $("tour-name").value, date: $("tour-date").value,
        places: [$("tour-1").value, $("tour-2").value, $("tour-3").value],
        others: $("tour-others").value.split(",").map(s => s.trim()).filter(Boolean)
      });
      for (const id of ["tour-name", "tour-1", "tour-2", "tour-3", "tour-others"]) $(id).value = "";
      await loadTournaments();
      notice(`Turnaj „${result.tournament.name}“ je zapsaný.`);
    } catch (e) {
      fail(e);
    } finally {
      submit.disabled = false;
    }
  });

  /* ---------- záložky ---------- */
  const loaders = { overview: loadOverview, traffic: loadTraffic, users: loadUsers, live: loadLive, matches: loadMatches, tournaments: loadTournaments, maps: loadMapsTab, audit: loadAudit };

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
