/*
 * Návštěvnost a aktivita: souhrny po dnech a vzorky „kdo je online“ každých 5 minut.
 * Nepoužívá cookies ani neukládá IP. Unikátní návštěvník = otisk (IP + prohlížeč + denní sůl),
 * sůl i otisky platí jen jeden den a pak se zahodí, takže návštěvníky nejde spojit mezi dny.
 */
"use strict";

const crypto = require("crypto");

const TZ = process.env.GORALIA_TZ || "Europe/Prague";
const KEEP_DAYS = 400;
const SAMPLE_MS = 5 * 60 * 1000;
const KEEP_SAMPLES = 14 * 24 * 12; // 14 dní po 5 minutách
const MAX_TODAY = 50000; // strop otisků za den (ochrana paměti)
const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|monitor|curl|wget|python|httpclient|headless|lighthouse|pingdom|uptime/i;
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

function createTraffic(store) {
  const data = store.data;
  if (!data.traffic || typeof data.traffic !== "object") data.traffic = {};
  const t = data.traffic;
  t.days = t.days || {};
  t.samples = t.samples || [];

  function today() {
    const key = dayKey();

    if (!t.today || t.today.date !== key) {
      t.today = { date: key, salt: crypto.randomBytes(16).toString("hex"), visitors: [], guests: [], players: [] };
      prune();
    }

    const day = t.days[key] || (t.days[key] = newDay());
    for (const k of DAY_FIELDS) if (typeof day[k] !== "number") day[k] = 0;
    return { day, seen: t.today };
  }

  function prune() {
    const keys = Object.keys(t.days).sort();
    while (keys.length > KEEP_DAYS) delete t.days[keys.shift()];
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

  // Načtení hlavní stránky hry.
  function pageView(ip, ua) {
    const { day, seen } = today();
    ua = String(ua || "");

    if (!ua || BOT_RE.test(ua)) {
      day.bots++;
      store.save();
      return;
    }

    day.views++;
    if (MOBILE_RE.test(ua)) day.mobile++;
    if (addUnique(seen.visitors, fingerprint(seen.salt, ip, ua))) day.visitors++;
    store.save();
  }

  // Připojení k serveru hry (WebSocket); user = přihlášený účet nebo null.
  function connection(ip, ua, user, online) {
    const { day, seen } = today();
    day.connections++;

    if (user) {
      if (addUnique(seen.players, user.id)) day.players++;
    } else if (addUnique(seen.guests, fingerprint(seen.salt, ip, String(ua || "")))) {
      day.guests++;
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
    return { tz: TZ, days: out, samples: t.samples.filter(s => s[0] >= since) };
  }

  today();
  return { pageView, connection, match, aiEvent, bump, startSampling, report, dayKey };
}

module.exports = { createTraffic, DAY_FIELDS, dayKey };
