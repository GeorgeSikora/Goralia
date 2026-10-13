#!/usr/bin/env node
/*
 * Vyrobí hlasové soubory jednotek (assets/voices/*.mp3 + voices.json) ze seznamu hlášek níže.
 *
 *   npm run voices                          ElevenLabs (výchozí), potřebuje ELEVENLABS_API_KEY a hlasy postav (viz níže)
 *   npm run voices -- --eleven-voices       vypíše hlasy z tvé ElevenLabs knihovny (id a název) k výběru
 *   npm run voices -- --engine=say          macOS: příkaz `say` (nejlepší nainstalovaný český hlas) + ffmpeg
 *   npm run voices -- --engine=openai       OpenAI TTS, potřebuje OPENAI_API_KEY
 *   npm run voices -- --only=hero           přegeneruje jen vybrané postavy, víc jich odděl čárkou (--only=knight,catapult,monk)
 *                                           postavy: worker | soldier | archer | hero | knight | catapult | monk
 *   npm run voices -- --list                vypíše dostupné české hlasy v systému
 *
 * Nejlépe znějí hlasy "Premium" nebo "Enhanced": Nastavení > Zpřístupnění > Mluvený obsah > Systémový hlas >
 * Spravovat hlasy > čeština. Hlas jde vynutit proměnnou SAY_VOICE="Zuzana (Premium)".
 *
 * ElevenLabs: každé postavě přiřaď hlas proměnnou ELEVEN_VOICE_WORKER / _SOLDIER / _ARCHER / _HERO / _KNIGHT / _CATAPULT / _MONK
 * (id hlasu z knihovny); bez ní se hlas vybere z knihovny sám.
 * Používá model Eleven v3 (umí češtinu a hraje emoce podle značek v hranatých závorkách, např. [excited] Jdu na to!).
 * Jiný model: ELEVEN_MODEL=eleven_multilingual_v2 (značky se pak před odesláním odstraní). Stabilita v3: ELEVEN_STABILITY
 * (0 = Creative, nejvíc emocí; 0.5 = Natural, výchozí; 1 = Robust, nejklidnější).
 *
 * Vlastní nahrávky stačí uložit pod stejnými názvy a manifest nechat být.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const OUT = path.join(__dirname, "..", "assets", "voices");

// Starší Node (před 18) nemá fetch: jednoduchá náhrada nad modulem https.
const fetch = global.fetch || ((url, opts = {}) => new Promise((resolve, reject) => {
  const req = require("https").request(url, { method: opts.method || "GET", headers: opts.headers || {} }, res => {
    const chunks = [];
    res.on("data", c => chunks.push(c));
    res.on("end", () => {
      const buf = Buffer.concat(chunks);
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        text: async () => buf.toString("utf8"),
        json: async () => JSON.parse(buf.toString("utf8")),
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      });
    });
  });
  req.on("error", reject);
  if (opts.body) req.write(opts.body);
  req.end();
}));

// Klíče a id hlasů lze dát do souboru .env v kořeni projektu (řádky KLÍČ=hodnota); proměnné prostředí mají přednost.
try {
  for (const line of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch (e) { /* .env není povinný */ }
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));

/*
 * Každá hláška je text nebo [text, { rate, pitch, gain }]: rate = násobek tempa, pitch = posun výšky.
 * Interpunkce řídí intonaci: vykřičník = důraz a zrychlení, tři tečky = váhání, čárka = nádech.
 *
 * Emoce (jen ElevenLabs v3) se píší v hranatých závorkách PŘED větu nebo doprostřed ní. Značky jsou anglicky;
 * v textu používáme jen ověřené: [calm] [serious] [curious] [cheerful] [excited] [confident] [determined]
 * [dramatic tone] [shouting] [whispers] [annoyed] [angry] [sarcastic] [mischievously] [sighs] [exhales] [chuckles] [laughs].
 * Do voices.json (a tím do hry) se ukládá text bez značek.
 */
const CHARACTERS = {
  worker: {
    // dělník: bodrý, trochu nevrlý řemeslník
    say: { rate: 176, pitch: 1.05, eq: "equalizer=f=250:t=q:w=1:g=1.5,equalizer=f=3000:t=q:w=1:g=1" },
    eleven: { stability: 0.32, style: 0.5 },
    openai: "ash",
    select: [
      "[curious] Copak potřebuješ?",
      "[calm] Jo? Povídej.",
      "[cheerful] Dělník na místě. Co se staví?",
      "[calm] Řekni, kam mám jít.",
      "[excited] Nářadí mám, ruce mám. Tak do toho!",
      "[serious] Poslouchám, veliteli.",
      ["[curious] Hmm? Já jsem právě něco zkoumal...", { rate: 0.94 }]
    ],
    order: [
      "[excited] Jasně! Hned se do toho pustím.",
      "[calm] Dobrá, už jdu.",
      "[excited] Stavba volá! Jsem na cestě.",
      "[serious] Rozumím. Bude to hotové.",
      "[curious] Tak ukaž, kde začít.",
      ["[sighs] No jo, no jo, už se hýbu.", { rate: 1.04 }]
    ],
    annoyed: [
      "[annoyed] Pořád mě voláš? Vždyť já už pracuju!",
      "[sighs] Jedno zadání stačí, veliteli.",
      "[annoyed] Jestli mám stihnout práci, [sighs] nech mě chvíli v klidu.",
      ["[angry] Ještě jedno kliknutí a odkládám kladivo!", { rate: 1.06, pitch: 1.03 }]
    ]
  },
  soldier: {
    // voják: hrdý, strohý
    say: { rate: 160, pitch: 0.8, eq: "equalizer=f=180:t=q:w=1:g=2,equalizer=f=2300:t=q:w=1:g=1.2" },
    eleven: { stability: 0.9, style: 0.6 },
    openai: "onyx",
    select: [
      "[serious] Voják hlásí připravenost!",
      "[calm] Čekám na rozkaz.",
      "[confident] Meč je nabroušený. [curious] Kam vyrazíme?",
      "[shouting] Za Goralii!",
      "[whispers] Jsem ve střehu.",
      "[confident] Nepřítel si neškrtne."
    ],
    order: [
      "[shouting] Rozkaz! Vyrážím!",
      "[shouting] Držte se za mnou!",
      "[determined] Jdu jim naproti.",
      "[serious] Postarám se o ně.",
      "[shouting] Na místo! A rychle!",
      ["[dramatic tone] Dnes se bude bojovat.", { rate: 0.95, pitch: 0.97 }]
    ],
    annoyed: [
      "[sarcastic] Veliteli, mám bojovat, nebo jen stát v pozoru?",
      "[annoyed] Rozkaz jsem slyšel. Už jdu.",
      "[annoyed] Šetřete rozkazy na nepřítele.",
      ["[angry] Další rozkaz? Ještě jsem nedošel k prvnímu!", { rate: 1.05 }]
    ]
  },
  archer: {
    // lučištník: klidný, vtipný, trochu škodolibý
    say: { rate: 180, pitch: 1.1, eq: "equalizer=f=350:t=q:w=1:g=0.8,equalizer=f=3600:t=q:w=1:g=1.4" },
    eleven: { stability: 0.38, style: 0.45 },
    openai: "nova",
    select: [
      "[whispers] Luk připravený.",
      "[calm] Stačí ukázat cíl.",
      "[curious] Mám je na dostřel?",
      "[whispers] Vidím každý pohyb.",
      "[mischievously] Šíp si cestu najde.",
      "[calm] Čekám na povel."
    ],
    order: [
      "[whispers] Rozumím. Zaměřuji.",
      "[serious] Cíl potvrzený.",
      "[excited] Šíp už letí!",
      "[calm] Kryju vám záda.",
      "[calm] Zůstanu stranou a podpořím vás.",
      ["[mischievously] Tenhle výstřel bude hezký.", { rate: 0.95 }]
    ],
    annoyed: [
      "[annoyed] Neklikej mi do míření.",
      "[sarcastic] Ještě jedno zavolání a trefím tebe. [chuckles]",
      "[sarcastic] Vidím tě. Teď nech vidět i mě.",
      ["[sarcastic] Tolik rozkazů a ani jeden cíl? [sighs] To se mi nelíbí.", { rate: 1.04 }]
    ]
  },
  hero: {
    // hrdina: hluboký, váživý, s ozvěnou
    say: { rate: 148, pitch: 0.84, eq: "equalizer=f=140:t=q:w=1:g=2.5,equalizer=f=2100:t=q:w=1:g=1.5", echo: "aecho=0.8:0.2:75:0.08" },
    eleven: { stability: 0.28, style: 0.7 },
    openai: "fable",
    select: [
      "[serious] Goralia mě potřebuje. [determined] Jsem připraven.",
      "[calm] Řekni své přání. Vyslyším tě.",
      "[dramatic tone] Moje síla je ti k službám.",
      "[dramatic tone] Nepřátelé poznají, koho vyzvali.",
      "[determined] Povedu naše vojsko k vítězství.",
      "[calm] Stojím při tobě."
    ],
    order: [
      "[shouting] Tak tedy vzhůru do boje!",
      "[serious] Na tvůj rozkaz.",
      "[determined] Přivedu nás k vítězství.",
      "[shouting] Ať se nepřítel připraví!",
      "[shouting] Za Goralii!",
      ["[serious] Tohle nebude lehké. [exhales] A právě proto to udělám.", { rate: 0.94, pitch: 0.98 }]
    ],
    annoyed: [
      "[sighs] I hrdina potřebuje chvíli klidu.",
      "[annoyed] Rozkaz jsem přijal. Nemusíš mě volat znovu.",
      "[serious] Soustřeďme se na nepřítele, ne na má slova.",
      ["[sighs] Trpělivost, veliteli. [calm] Meč se nebrousí v jednom tahu.", { rate: 0.96 }]
    ]
  },
  knight: {
    // rytíř: urozený, sebevědomý jezdec, který se rád žene do útoku
    say: { rate: 158, pitch: 0.86, eq: "equalizer=f=160:t=q:w=1:g=2.2,equalizer=f=2600:t=q:w=1:g=1.3" },
    eleven: { stability: 0.4, style: 0.65 },
    openai: "echo",
    select: [
      "[confident] Rytíř ve službách Goralie.",
      "[calm] Kůň je osedlaný, kopí nabité.",
      "[serious] Na tvůj povel, pane.",
      "[confident] Čest a ocel. Co si přeješ?",
      "[determined] Stačí ukázat směr a vyrazím.",
      ["[calm] Klid... [chuckles] můj kůň je netrpělivější než já.", { rate: 0.96 }]
    ],
    order: [
      "[shouting] Do útoku! Nikdo nás nezastaví!",
      "[confident] Jak poroučíš.",
      "[determined] Kopí vpřed!",
      "[shouting] Hyjé! Vpřed!",
      "[serious] Rozpráším jejich řady.",
      ["[dramatic tone] Ať se země třese pod kopyty!", { rate: 0.95, pitch: 0.98 }]
    ],
    annoyed: [
      "[annoyed] Rytíř nemá čas na zbytečné povely.",
      "[sarcastic] Mám snad jezdit dokola, dokud se nerozhodneš?",
      "[sighs] I můj kůň už začíná ztrácet trpělivost.",
      ["[annoyed] Šlechtic se nevolá jako pasák, veliteli!", { rate: 1.04 }]
    ]
  },
  catapult: {
    // obsluha katapultu: drsný a praktický mistr obléhání, mluví přes vrzání trámů
    say: { rate: 164, pitch: 0.9, eq: "equalizer=f=220:t=q:w=1:g=1.8,equalizer=f=2000:t=q:w=1:g=1" },
    eleven: { stability: 0.35, style: 0.55 },
    openai: "ballad",
    select: [
      "[calm] Katapult je napnutý.",
      "[curious] Co dneska rozbijeme?",
      "[confident] Balvany máme nachystané.",
      "[serious] Obsluha katapultu hlásí připravenost.",
      "[mischievously] Na zeď nebo na věž? Obojí jde dolů.",
      ["[sighs] Trámy vrzou, ale vydrží.", { rate: 0.95 }]
    ],
    order: [
      "[serious] Zaměřujeme.",
      "[shouting] Pozor, pouštím!",
      "[calm] Už ho tlačíme.",
      "[excited] Tohle bude rána!",
      "[confident] Až dopadne, nezůstane kámen na kameni.",
      ["[determined] Napnout, zajistit... [shouting] pal!", { rate: 1.03 }]
    ],
    annoyed: [
      "[annoyed] Tohle není kočár, veliteli. Otáčí se pomalu.",
      "[sarcastic] Ještě chvíli a hodím balvan na tebe.",
      "[sighs] Kola nejsou z másla. Nech nás to dotlačit.",
      ["[angry] Přestaň klikat, nebo se mi ten provaz utrhne!", { rate: 1.05 }]
    ]
  },
  monk: {
    // mnich: laskavý, klidný a trochu kazatelský
    say: { rate: 150, pitch: 0.95, eq: "equalizer=f=200:t=q:w=1:g=1.2,equalizer=f=3200:t=q:w=1:g=0.8", echo: "aecho=0.8:0.25:60:0.1" },
    eleven: { stability: 0.6, style: 0.35 },
    openai: "sage",
    select: [
      "[calm] Mír s tebou, synu.",
      "[calm] Kdo potřebuje pomoc?",
      "[serious] Modlím se za naše vojsko.",
      "[calm] Rány se zahojí, víra zůstane.",
      "[curious] Kdo je raněný?",
      ["[whispers] Ticho... modlitba ještě neskončila.", { rate: 0.94 }]
    ],
    order: [
      "[calm] Půjdu, kam mě vede povinnost.",
      "[serious] Postarám se o raněné.",
      "[calm] Ať tě požehnání provází.",
      "[determined] Nikoho nenechám padnout.",
      "[calm] S pokorou jdu.",
      ["[cheerful] Uzdravení je na cestě!", { rate: 1.02 }]
    ],
    annoyed: [
      "[sighs] I trpělivost mnicha má své meze.",
      "[annoyed] Bůh slyší napoprvé, veliteli. Já také.",
      "[calm] Ztiš se, synu. Spěch je ďáblův přítel.",
      ["[sarcastic] Pomodlím se i za tvé ukazováčky. [sighs]", { rate: 0.98 }]
    ]
  }
};

const KINDS = ["select", "order", "annoyed"];
const TAG = /\s*\[[^\]]+\]\s*/g;
const stripTags = t => t.replace(TAG, " ").replace(/\s+/g, " ").replace(/\s+([.,!?…])/g, "$1").trim();
const norm = line => {
  const o = typeof line === "string" ? { text: line } : { text: line[0], ...line[1] };
  return { ...o, tts: o.text, text: stripTags(o.text) };
};

/* ---------- společné zpracování zvuku ---------- */
// Ořez ticha na začátku i konci, jemné odstranění sykavek a šumu, vyrovnání hlasitosti a krátké nárůsty/doznění bez lupanců.
function cleanup(extra = {}) {
  const trim = "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02";
  return [
    extra.tempo ? `atempo=${extra.tempo}` : "",
    trim, "areverse", trim, "areverse",
    "highpass=f=80", "lowpass=f=11000",
    "afftdn=nr=8:nf=-45",
    "deesser=i=0.35:m=0.5:f=0.5:s=o",
    extra.eq,
    "acompressor=threshold=-22dB:ratio=2.4:attack=6:release=120:makeup=2",
    extra.echo,
    `volume=${extra.gain || 0}dB`,
    "loudnorm=I=-17:TP=-1.5:LRA=7",
    "afade=t=in:d=0.006", "areverse", "afade=t=in:d=0.08", "areverse"
  ].filter(Boolean).join(",");
}

function ffmpeg(input, file, filter) {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", input, "-af", filter, "-ar", "32000", "-ac", "1", "-c:a", "libmp3lame", "-q:a", "2", file]);
}

/* ---------- motor 1: macOS say ---------- */
function czechVoices() {
  try {
    return execFileSync("say", ["-v", "?"], { encoding: "utf8" })
      .split("\n")
      .map(l => /^(.+?)\s{2,}(\w\w_\w\w)\s/.exec(l))
      .filter(m => m && m[2] === "cs_CZ")
      .map(m => m[1].trim());
  } catch (e) {
    return [];
  }
}

function pickVoice() {
  if (process.env.SAY_VOICE) return process.env.SAY_VOICE;
  const all = czechVoices();
  const score = v => (/Premium/i.test(v) ? 3 : /Enhanced|Rozšířený/i.test(v) ? 2 : 1);
  return all.sort((a, b) => score(b) - score(a))[0] || "Zuzana";
}

function renderSay(voice, c, line, file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goralia-voice-"));
  const raw = path.join(dir, "raw.wav");
  const rate = Math.round(c.say.rate * (line.rate || 1));
  const pitch = c.say.pitch * (line.pitch ? 1 + line.pitch : 1) * ((/!/.test(line.text) && !line.pitch) ? 1.02 : 1);
  // vysoká kvalita 44,1 kHz bez ztrátové kompresi před úpravami
  execFileSync("say", ["-v", voice, "-r", String(rate), "--data-format=LEI16@44100", "-o", raw, line.text]);
  const shift = `rubberband=pitch=${pitch.toFixed(3)}:formant=preserved:pitchq=quality:transients=smooth`;
  ffmpeg(raw, file, [shift, cleanup({ eq: c.say.eq, echo: c.say.echo, gain: line.gain })].join(","));
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ---------- motor 2: ElevenLabs ---------- */
// Pokud hlasy nenastavíš v .env, vyberou se samy z tvé knihovny podle jména (první dostupný v pořadí), jinak podle pohlaví.
const ELEVEN_PREFER = {
  worker: ["Antoni", "Josh", "Liam", "Sam", "Charlie", "Fin"],
  soldier: ["Arnold", "Clyde", "Callum", "Bill", "Thomas"],
  archer: ["Daniel", "Charlie", "Liam", "Callum", "Fin"],
  hero: ["Adam", "George", "Brian", "Daniel", "Bill"],
  knight: ["George", "Callum", "Brian", "Thomas", "Bill"],
  catapult: ["Clyde", "Bill", "Thomas", "Arnold", "Sam"],
  monk: ["Brian", "Daniel", "Thomas", "George", "Adam"]
};
const elevenAuto = {};

async function chooseElevenVoices() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("Chybí ELEVENLABS_API_KEY (nastav v .env).");

  const res = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": key } });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  const { voices } = await res.json();
  const used = new Set();
  const male = voices.filter(v => !v.labels || !v.labels.gender || v.labels.gender === "male");

  for (const type of Object.keys(CHARACTERS)) {
    if (process.env[`ELEVEN_VOICE_${type.toUpperCase()}`]) continue;

    const byName = ELEVEN_PREFER[type].map(n => voices.find(v => v.name.split(/[\s-]/)[0] === n && !used.has(v.voice_id))).find(Boolean);
    const pick = byName || male.find(v => !used.has(v.voice_id)) || voices.find(v => !used.has(v.voice_id));
    if (!pick) throw new Error("V ElevenLabs knihovně nejsou žádné hlasy. Přidej si je v sekci Voices.");

    used.add(pick.voice_id);
    elevenAuto[type] = pick.voice_id;
    console.log(`${type}: ${pick.name} (${pick.voice_id})`);
  }
}

async function renderEleven(type, c, line, file) {
  const key = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env[`ELEVEN_VOICE_${type.toUpperCase()}`] || elevenAuto[type];
  if (!key || !voiceId) throw new Error(`Chybí ELEVENLABS_API_KEY nebo ELEVEN_VOICE_${type.toUpperCase()} (vypiš hlasy příkazem: npm run voices -- --eleven-voices; nastav v .env).`);

  const model = process.env.ELEVEN_MODEL || "eleven_v3";
  const v3 = /v3/.test(model);
  const stab = process.env.ELEVEN_STABILITY !== undefined ? Number(process.env.ELEVEN_STABILITY) : 0.5;
  const rate = line.rate || 1;
  // v3 rozumí značkám a bere jen stabilitu 0 / 0.5 / 1; starší modely značky neznají a mají vlastní ladění hlasu.
  const voice_settings = v3
    ? { stability: stab, similarity_boost: 0.8 }
    : { stability: c.eleven.stability, similarity_boost: 0.8, style: c.eleven.style, use_speaker_boost: true, speed: rate };

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text: v3 ? line.tts : line.text, model_id: model, language_code: "cs", voice_settings })
  });

  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goralia-voice-"));
  const raw = path.join(dir, "raw.mp3");
  fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
  ffmpeg(raw, file, cleanup({ gain: line.gain, echo: c.say.echo, tempo: v3 && rate !== 1 ? rate : 0 }));
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ---------- motor 3: OpenAI ---------- */
const OPENAI_STYLE = {
  worker: "bodře, přirozeně a trochu nevrle",
  soldier: "strohě, hrdě a vojensky",
  archer: "klidně, chladně a s drobným úsměvem",
  hero: "hluboce, důstojně a s vážností",
  knight: "sebevědomě, urozeně a s chutí do útoku",
  catapult: "drsně a prakticky jako starý mistr obléhání",
  monk: "laskavě, klidně a trochu kazatelsky"
};

async function renderOpenAI(type, c, line, file) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Chybí OPENAI_API_KEY.");

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: c.openai,
      input: line.text,
      response_format: "wav",
      instructions: `Mluv česky jako herec v fantasy hře, ${OPENAI_STYLE[type] || OPENAI_STYLE.worker}. Žádné čtení z papíru, hraj emoci. Řekni to na jeden nádech, krátce.`
    })
  });

  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goralia-voice-"));
  const raw = path.join(dir, "raw.wav");
  fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
  ffmpeg(raw, file, cleanup({ gain: line.gain, echo: c.say.echo }));
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ---------- hlavní běh ---------- */
async function main() {
  if (args.list) {
    console.log(czechVoices().join("\n") || "Žádný český hlas nenalezen (příkaz `say` není k dispozici).");
    return;
  }

  if (args["eleven-voices"]) {
    const res = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY || "" } });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
    const { voices } = await res.json();
    for (const v of voices) console.log(`${v.voice_id}  ${v.name}${v.labels && v.labels.gender ? `  (${v.labels.gender}${v.labels.accent ? `, ${v.labels.accent}` : ""})` : ""}`);
    console.log("\nId vlož do .env jako ELEVEN_VOICE_WORKER, _SOLDIER, _ARCHER, _HERO, _KNIGHT, _CATAPULT a _MONK.");
    return;
  }

  const engine = args.engine || "elevenlabs";
  const voice = engine === "say" ? pickVoice() : "";
  if (engine === "elevenlabs") await chooseElevenVoices();
  if (engine === "say") console.log(`Hlas: ${voice}`);

  const only = typeof args.only === "string" ? args.only.split(",").map(t => t.trim()).filter(Boolean) : [];
  const unknown = only.filter(t => !CHARACTERS[t]);
  if (unknown.length) throw new Error(`Neznámá postava: ${unknown.join(", ")} (možnosti: ${Object.keys(CHARACTERS).join(", ")}).`);
  let manifest = {};

  if (only.length) {
    try { manifest = JSON.parse(fs.readFileSync(path.join(OUT, "voices.json"), "utf8")); } catch (e) { manifest = {}; }
  } else {
    fs.rmSync(OUT, { recursive: true, force: true });
  }

  fs.mkdirSync(OUT, { recursive: true });
  let count = 0;

  for (const [type, c] of Object.entries(CHARACTERS)) {
    if (only.length && !only.includes(type)) continue;
    manifest[type] = {};

    for (const kind of KINDS) {
      const items = [];
      let i = 0;

      for (const raw of c[kind]) {
        const line = norm(raw);
        const file = `${type}-${kind}-${++i}.mp3`;
        const target = path.join(OUT, file);

        if (engine === "elevenlabs") await renderEleven(type, c, line, target);
        else if (engine === "openai") await renderOpenAI(type, c, line, target);
        else renderSay(voice, c, line, target);

        items.push({ file, text: line.text });
        count++;
      }

      manifest[type][kind] = items;
    }
  }

  fs.writeFileSync(path.join(OUT, "voices.json"), JSON.stringify(manifest, null, 2));
  console.log(`Hotovo: ${count} hlášek v ${OUT}`);
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
