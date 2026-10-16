/*
 * Odkud návštěvník přišel: z hlavičky Referer a z utm_* parametrů v adrese udělá čitelný zdroj.
 * Ukládá se jen název zdroje nebo doména odkazující stránky, nikdy celá adresa.
 * Výsledek: { kind, name } kde kind je direct | search | social | web | campaign | internal.
 */
"use strict";

// [regulární výraz na doménu, typ, název]
const KNOWN = [
  [/(^|\.)google\.[a-z.]+$/, "search", "Google"],
  [/(^|\.)seznam\.cz$/, "search", "Seznam"],
  [/(^|\.)bing\.com$/, "search", "Bing"],
  [/(^|\.)duckduckgo\.com$/, "search", "DuckDuckGo"],
  [/(^|\.)yahoo\.[a-z.]+$/, "search", "Yahoo"],
  [/(^|\.)yandex\.[a-z.]+$/, "search", "Yandex"],
  [/(^|\.)ecosia\.org$/, "search", "Ecosia"],
  [/^search\.brave\.com$/, "search", "Brave Search"],
  [/(^|\.)instagram\.com$/, "social", "Instagram"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/, "social", "Facebook"],
  [/(^|\.)tiktok\.com$/, "social", "TikTok"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "social", "YouTube"],
  [/(^|\.)(discord\.com|discord\.gg|discordapp\.com)$/, "social", "Discord"],
  [/(^|\.)reddit\.com$/, "social", "Reddit"],
  [/(^|\.)(twitter\.com|x\.com|t\.co)$/, "social", "X (Twitter)"],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, "social", "WhatsApp"],
  [/(^|\.)(telegram\.org|t\.me)$/, "social", "Telegram"],
  [/(^|\.)twitch\.tv$/, "social", "Twitch"],
  [/(^|\.)linkedin\.com$/, "social", "LinkedIn"],
  [/(^|\.)pinterest\.[a-z.]+$/, "social", "Pinterest"],
  [/(^|\.)threads\.net$/, "social", "Threads"],
  [/(^|\.)bsky\.app$/, "social", "Bluesky"]
];

// utm_source bývá zkratka nebo jméno sítě, ne doména
const UTM_ALIASES = {
  ig: "instagram.com", instagram: "instagram.com",
  fb: "facebook.com", facebook: "facebook.com", messenger: "messenger.com",
  tiktok: "tiktok.com", tt: "tiktok.com",
  youtube: "youtube.com", yt: "youtube.com",
  discord: "discord.com", reddit: "reddit.com",
  twitter: "x.com", x: "x.com",
  whatsapp: "whatsapp.com", telegram: "telegram.org", twitch: "twitch.tv",
  google: "google.com", seznam: "seznam.cz", bing: "bing.com"
};

const MAX_LEN = 60;
const clean = s => String(s || "").trim().toLowerCase().replace(/[^a-z0-9._\- ]/g, "").slice(0, MAX_LEN);
const hostOf = url => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch (e) {
    return "";
  }
};

function byHost(host) {
  for (const [re, kind, name] of KNOWN) if (re.test(host)) return { kind, name };
  return null;
}

// referer: hlavička Referer; query: URLSearchParams adresy stránky; ownHosts: domény webu hry
function classify(referer, query, ownHosts = []) {
  const own = new Set(ownHosts.map(h => String(h || "").toLowerCase().replace(/^www\./, "").replace(/:\d+$/, "")).filter(Boolean));
  const get = key => (query && typeof query.get === "function" ? query.get(key) : null);

  const utm = clean(get("utm_source"));
  if (utm) {
    const known = byHost(UTM_ALIASES[utm] || utm);
    return { kind: known ? known.kind : "campaign", name: known ? known.name : utm };
  }

  const host = referer ? hostOf(referer) : "";
  if (host) {
    if (own.has(host)) return { kind: "internal", name: "" };
    return byHost(host) || { kind: "web", name: host.slice(0, MAX_LEN) };
  }

  // Bez Refereru (aplikace často odkaz neposílají) prozradí zdroj aspoň identifikátor kliknutí.
  if (get("fbclid")) return { kind: "social", name: "Facebook" };
  if (get("gclid")) return { kind: "search", name: "Google" };
  if (get("ttclid")) return { kind: "social", name: "TikTok" };
  return { kind: "direct", name: "" };
}

// Kampaň z utm_*, nebo null: "zdroj / médium / kampaň"
function campaign(query) {
  if (!query || typeof query.get !== "function") return null;
  const parts = ["utm_source", "utm_medium", "utm_campaign"].map(k => clean(query.get(k)));
  return parts.some(Boolean) ? parts.map(p => p || "–").join(" / ") : null;
}

module.exports = { classify, campaign };
