#!/usr/bin/env node
/*
 * Vyrobí hlasové soubory jednotek (assets/voices/*.mp3 + voices.json) ze seznamu hlášek níže.
 * Potřebuje macOS (příkaz `say`, hlas Zuzana) a ffmpeg. Spuštění: npm run voices
 * Vlastní nahrávky stačí uložit pod stejnými názvy a manifest nechat být.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const OUT = path.join(__dirname, "..", "assets", "voices");
const SAY_VOICE = "Zuzana";

// Mírné posuny zachovají srozumitelnost společného českého hlasového základu.
const CHARACTERS = {
  worker: {
    rate: 178, pitch: 1.07, eq: "equalizer=f=250:t=q:w=1:g=1.5,equalizer=f=3000:t=q:w=1:g=1",
    select: ["Copak potřebuješ?", "Dělník je připravený.", "Už jsem tady. Co se staví?", "Řekni, kam mám jít.", "Nářadí mám. Práce může začít.", "Poslouchám, veliteli."],
    order: ["Jasně. Hned se do toho pustím.", "Dobrá, už jdu.", "Stavba volá. Jsem na cestě.", "Rozumím. Bude to hotové.", "Tak ukaž, kde začít."],
    annoyed: ["Pořád mě voláš? Vždyť už pracuju!", "Jedno zadání stačí, veliteli.", "Jestli mám stihnout práci, nech mě chvíli v klidu."]
  },
  soldier: {
    rate: 164, pitch: 0.91, eq: "equalizer=f=180:t=q:w=1:g=2,equalizer=f=2300:t=q:w=1:g=1.2",
    select: ["Voják hlásí připravenost.", "Čekám na rozkaz.", "Meč je nabroušený. Kam vyrazíme?", "Za Goralii!", "Jsem ve střehu.", "Nepřítel si neškrtne."],
    order: ["Rozkaz! Vyrážím.", "Držte se za mnou!", "Jdu jim naproti.", "Postarám se o ně.", "Na místo. A rychle!"],
    annoyed: ["Veliteli, mám bojovat, nebo jen stát v pozoru?", "Rozkaz jsem slyšel. Už jdu.", "Šetřete rozkazy na nepřítele."]
  },
  archer: {
    rate: 184, pitch: 1.12, eq: "equalizer=f=350:t=q:w=1:g=0.8,equalizer=f=3600:t=q:w=1:g=1.4",
    select: ["Luk připravený.", "Stačí ukázat cíl.", "Mám je na dostřel?", "Vidím každý pohyb.", "Šíp si cestu najde.", "Čekám na povel."],
    order: ["Rozumím. Zaměřuji.", "Cíl potvrzený.", "Šíp už letí.", "Kryju vám záda.", "Zůstanu stranou a podpořím vás."],
    annoyed: ["Neklikej mi do míření.", "Ještě jedno zavolání a trefím tebe.", "Vidím tě. Teď nech vidět i já." ]
  },
  hero: {
    rate: 150, pitch: 0.82, eq: "equalizer=f=140:t=q:w=1:g=2.5,equalizer=f=2100:t=q:w=1:g=1.5", echo: "aecho=0.8:0.2:75:0.08",
    select: ["Goralia mě potřebuje. Jsem připraven.", "Řekni své přání. Vyslyším tě.", "Moje síla je ti k službám.", "Nepřátelé poznají, koho vyzvali.", "Povedu naše vojsko k vítězství.", "Stojím při tobě."],
    order: ["Tak tedy vzhůru do boje!", "Na tvůj rozkaz.", "Přivedu nás k vítězství.", "Ať se nepřítel připraví.", "Za Goralii!"],
    annoyed: ["I hrdina potřebuje chvíli klidu.", "Rozkaz jsem přijal. Nemusíš mě volat znovu.", "Soustreďme se na nepřítele, ne na má slova."]
  }
};

const KINDS = ["select", "order", "annoyed"];

function filters(c) {
  const trimStart = "silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.02";
  const chain = [
    trimStart, "areverse", trimStart, "areverse",
    `rubberband=pitch=${c.pitch}:transients=crisp`,
    "highpass=f=75", c.eq,
    "acompressor=threshold=-23dB:ratio=2.2:attack=8:release=100:makeup=2",
    c.echo,
    "loudnorm=I=-17:TP=-1.5:LRA=7",
    "afade=t=in:d=0.008", "areverse", "afade=t=in:d=0.05", "areverse"
  ];

  return chain.filter(Boolean).join(",");
}

function render(text, c, file) {
  const raw = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "goralia-voice-")), "raw.aiff");
  execFileSync("say", ["-v", SAY_VOICE, "-r", String(c.rate), "-o", raw, text]);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-af", filters(c), "-ar", "22050", "-ac", "1", "-c:a", "libmp3lame", "-q:a", "3", file]);
  fs.rmSync(path.dirname(raw), { recursive: true, force: true });
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const manifest = {};
let count = 0;

for (const [type, c] of Object.entries(CHARACTERS)) {
  manifest[type] = {};

  for (const kind of KINDS) {
    manifest[type][kind] = c[kind].map((text, i) => {
      const file = `${type}-${kind}-${i + 1}.mp3`;
      render(text, c, path.join(OUT, file));
      count++;
      return { file, text };
    });
  }
}

fs.writeFileSync(path.join(OUT, "voices.json"), JSON.stringify(manifest, null, 2));
console.log(`Hotovo: ${count} hlášek v ${OUT}`);
