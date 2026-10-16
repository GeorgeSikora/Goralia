/*
 * Návštěvnost a aktivita: souhrny po dnech a vzorky „kdo je online“ každých 5 minut.
 * Nepoužívá cookies ani neukládá IP. Unikátní návštěvník = otisk (IP + prohlížeč + denní sůl),
 * sůl i otisky platí jen jeden den a pak se zahodí, takže návštěvníky nejde spojit mezi dny.
 * Odkud kdo je (země, kraj, město) se zjistí z IP offline (geoip.js) a uloží se jen jako počet za den a místo.
 * Odkud kdo na web přišel (referrer.js) se ukládá jen jako počet za den a zdroj (název sítě nebo doména).
 */
"use strict";

const crypto = require("crypto");
const { classify, campaign } = require("./referrer.js");

const TZ = process.env.GORALIA_TZ || "Europe/Prague";
const KEEP_DAYS = 400;
const SAMPLE_MS = 5 * 60 * 1000;
const KEEP_SAMPLES = 14 * 24 * 12; // 14 dní po 5 minutách
const MAX_TODAY = 50000; // strop otisků za den (ochrana paměti)
const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|monitor|curl|wget|python|httpclient|headless|lighthouse|pingdom|uptime/i;
const MAX_PLACES_DAY = 3000; // strop různých míst za den; další se sečtou pod „neznámo“
const MAX_SOURCES_DAY = 500; // strop různých zdrojů a kampaní za den; další se sečtou pod „ostatní“
const MOBILE_RE = /Mobi|Android|iPhone|iPad|iPod/i;

const dayFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const dayKey = (ms = Date.now()) => dayFormat.format(new Date(ms));

const DAY_FIELDS = [
  "views", "visitors", "mobile", "bots",           // web
  "connections", "guests", "players",              // připojení ke hře (guests/players = unikátní za den)
  "peak", "registrations", "logins",               // špička online, nové účty, přihlášení
  "matches", "pvp", "matchSeconds",                // online zápasy
  "aiStarted", "aiFinished", "aiWins", "aiSeconds" // hry proti AI v prohlížeči (i bez účtu)
];

const newDay = () => Object.fromEntries(DAY_FIELDS.map(k => [k, 0]));

// geo: { lookup(ip) } z geoip.js, nebo nic (bez geolokace)
function createTraffic(store, geo = null) {
  const data = store.data;
  if (!data.traffic || typeof data.traffic !== "object") data.traffic = {};
  const t = data.traffic;
  t.days = t.days || {};
  t.samples = t.samples || [];
  t.geo = t.geo || {};       // { den: { "CZ|kraj|město": [návštěvníci webu, hráči] } }
  t.places = t.places || {}; // { "CZ|kraj|město": [lat, lon, název země] }
  t.sources = t.sources || {};     // { den: { "typ|název": příchody } }
  t.campaigns = t.campaigns || {}; // { den: { "zdroj / médium / kampaň": příchody } }

  function today() {
    const key = dayKey();

    if (!t.today || t.today.date !== key) {
      t.today = { date: key, salt: crypto.randomBytes(16).toString("hex"), visitors: [], guests: [], players: [], arrivals: [] };
      prune();
    }

    const day = t.days[key] || (t.days[key] = newDay());
    for (const k of DAY_FIELDS) if (typeof day[k] !== "number") day[k] = 0;
    return { day, seen: t.today };
  }

  function prune() {
    const keys = Object.keys(t.days).sort();
    while (keys.length > KEEP_DAYS) delete t.days[keys.shift()];

    for (const per of [t.geo, t.sources, t.campaigns]) {
      const perKeys = Object.keys(per).sort();
      while (perKeys.length > KEEP_DAYS) delete per[perKeys.shift()];
    }
    const used = new Set();
    for (const day of Object.values(t.geo)) for (const key of Object.keys(day)) used.add(key);
    for (const key of Object.keys(t.places)) if (!used.has(key)) delete t.places[key];
  }

  // Započte unikátního návštěvníka (0) nebo hráče (1) k místu, odkud přišel. IP se neukládá.
  function place(ip, column) {
    if (!geo) return;
    const where = geo.lookup(ip);
    const date = dayKey();
    const day = t.geo[date] || (t.geo[date] = {});
    let key = where ? `${where.cc}|${where.region}|${where.city}` : "";
    if (!day[key] && Object.keys(day).length >= MAX_PLACES_DAY) key = "";
    if (key && !t.places[key]) t.places[key] = [where.lat, where.lon, where.country];
    const row = day[key] || (day[key] = [0, 0]);
    row[column]++;
  }

  function countIn(per, key, overflow) {
    const date = dayKey();
    const day = per[date] || (per[date] = {});
    if (!(key in day) && Object.keys(day).length >= MAX_SOURCES_DAY) key = overflow;
    day[key] = (day[key] || 0) + 1;
  }

  // Příchod na web: nový návštěvník dne se započte ke svému zdroji. Už známý návštěvník jen tehdy,
  // když přijde z jiného vnějšího zdroje (např. ráno přímo, večer z Instagramu); obnovení stránky
  // a přechody v rámci webu se nepočítají.
  function arrival(seen, visitor, isNew, from) {
    const src = classify(from.referer, from.query, from.hosts);
    const key = `${src.kind}|${src.name}`;
    if (!isNew && (src.kind === "direct" || src.kind === "internal")) return;
    if (!seen.arrivals) seen.arrivals = [];
    if (!addUnique(seen.arrivals, `${visitor}|${key}`)) return;
    countIn(t.sources, key, "web|ostatní");
    const camp = campaign(from.query);
    if (camp) countIn(t.campaigns, camp, "ostatní");
  }

  const fingerprint = (salt, ip, ua) => crypto.createHash("sha256").update(`${salt}|${ip}|${ua}`).digest("hex").slice(0, 16);

  function addUnique(list, value) {
    if (list.length >= MAX_TODAY || list.includes(value)) return false;
    list.push(value);
    return true;
  }

  function bump(field, by = 1) {
    const { day } = today();
    day[field] = (day[field] || 0) + by;
    store.save();
  }

  // Načtení hlavní stránky hry. from = { referer, query (URLSearchParams), hosts (domény webu) }
  function pageView(ip, ua, from = {}) {
    const { day, seen } = today();
    ua = String(ua || "");

    if (!ua || BOT_RE.test(ua)) {
      day.bots++;
      store.save();
      return;
    }

    day.views++;
    if (MOBILE_RE.test(ua)) day.mobile++;
    const visitor = fingerprint(seen.salt, ip, ua);
    const isNew = addUnique(seen.visitors, visitor);
    if (isNew) {
      day.visitors++;
      place(ip, 0);
    }
    arrival(seen, visitor, isNew, from);
    store.save();
  }

  // Připojení k serveru hry (WebSocket); user = přihlášený účet nebo null.
  function connection(ip, ua, user, online) {
    const { day, seen } = today();
    day.connections++;

    if (user) {
      if (addUnique(seen.players, user.id)) {
        day.players++;
        place(ip, 1);
      }
    } else if (addUnique(seen.guests, fingerprint(seen.salt, ip, String(ua || "")))) {
      day.guests++;
      place(ip, 1);
    }

    day.peak = Math.max(day.peak, online);
    store.save();
  }

  function match(info) {
    const { day } = today();
    day.matches++;
    if (info.humans >= 2) day.pvp++;
    day.matchSeconds += Math.round(info.duration || 0);
    store.save();
  }

  // Hlášení z prohlížeče o hře proti AI (hraje se lokálně, server ji jinak nevidí).
  function aiEvent(body) {
    const { day } = today();
    const kind = String(body.e || "");

    if (kind === "start") {
      day.aiStarted++;
    } else if (kind === "end") {
      day.aiFinished++;
      if (body.result === "win") day.aiWins++;
      const sec = Number(body.duration);
      if (Number.isFinite(sec) && sec > 0) day.aiSeconds += Math.min(Math.round(sec), 6 * 3600);
    } else {
      return false;
    }

    store.save();
    return true;
  }

  // Vzorek každých 5 minut: [čas, připojení, přihlášení, ve hře, místnosti]
  function startSampling(counts) {
    const take = () => {
      const c = counts();
      t.samples.push([Date.now(), c.online, c.authed, c.playing, c.rooms]);
      if (t.samples.length > KEEP_SAMPLES) t.samples.splice(0, t.samples.length - KEEP_SAMPLES);
      store.save();
    };

    const timer = setInterval(take, SAMPLE_MS);
    timer.unref();
    return timer;
  }

  function report(days = 30) {
    const n = Math.max(1, Math.min(KEEP_DAYS, Math.floor(days) || 30));
    today();
    const out = [];
    const now = Date.now();

    // Jdeme po kalendářních dnech pozpátku; dny bez provozu vrací nuly.
    let cursor = now;
    const keys = new Set();
    while (out.length < n) {
      const key = dayKey(cursor);
      if (!keys.has(key)) {
        keys.add(key);
        out.push({ date: key, ...newDay(), ...(t.days[key] || {}) });
      }
      cursor -= 12 * 3600 * 1000;
    }

    out.reverse();
    const since = now - Math.min(n, 14) * 86400 * 1000;
    return { tz: TZ, days: out, samples: t.samples.filter(s => s[0] >= since), geo: geoReport(out.map(d => d.date)), ...sourceReport(out.map(d => d.date)) };
  }

  // Součty za období po místech: [{ cc, country, region, city, lat, lon, visitors, players }]; cc "" = neznámo.
  function geoReport(dates) {
    const sums = new Map();
    let from = null; // první den období, ze kterého jsou místa (geolokace mohla začít později)
    for (const date of dates) {
      if (!from && t.geo[date] && Object.keys(t.geo[date]).length) from = date;
      for (const [key, [visitors, players]] of Object.entries(t.geo[date] || {})) {
        const row = sums.get(key) || sums.set(key, [0, 0]).get(key);
        row[0] += visitors;
        row[1] += players;
      }
    }

    const places = [...sums].map(([key, [visitors, players]]) => {
      const [cc = "", region = "", city = ""] = key.split("|");
      const [lat = null, lon = null, country = ""] = t.places[key] || [];
      return { cc, country, region, city, lat, lon, visitors, players };
    });
    places.sort((a, b) => b.players + b.visitors - (a.players + a.visitors));
    return { enabled: !!(geo && geo.info && geo.info()), source: geo && geo.info ? geo.info() : null, from, places };
  }

  // Součty za období: sources [{ kind, name, visits }], campaigns [{ name, visits }], od nejčastějšího.
  function sourceReport(dates) {
    const add = (per, map) => {
      for (const date of dates) for (const [key, n] of Object.entries(per[date] || {})) map.set(key, (map.get(key) || 0) + n);
      return [...map].sort((a, b) => b[1] - a[1]);
    };
    return {
      sources: add(t.sources, new Map()).map(([key, visits]) => {
        const i = key.indexOf("|");
        return { kind: key.slice(0, i), name: key.slice(i + 1), visits };
      }),
      campaigns: add(t.campaigns, new Map()).map(([name, visits]) => ({ name, visits }))
    };
  }

  today();
  return { pageView, connection, match, aiEvent, bump, startSampling, report, dayKey };
}

module.exports = { createTraffic, DAY_FIELDS, dayKey };
