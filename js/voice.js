/*
 * Hlasy jednotek: při výběru a rozkazu řekne jednotka originální českou hlášku.
 * Nahrávky a seznam hlášek jsou v assets/voices (vyrábí je tools/make-voices.js).
 */
(() => {
  "use strict";

  const PK = window.PK;
  const KEY = "pk-voice";
  const DIR = "assets/voices/";
  const COOLDOWN = 450; // ms mezi dvěma hláškami
  const ANNOYED_AFTER = 4; // tolik rychlých kliknutí na stejný typ jednotky ho naštve
  const ANNOYED_WINDOW = 6000;
  const LEVEL = 0.9; // hlasitost hlasu vůči posuvníku ve hře

  let enabled = true;
  let manifest = null;
  let current = null;
  let lastAt = 0;
  let lastFile = "";
  let streak = { type: "", count: 0, at: 0 };
  const clips = new Map();

  try { enabled = localStorage.getItem(KEY) !== "0"; } catch (e) { /* ignore */ }

  const api = {
    say,
    setEnabled,
    onLoad: null,
    get enabled() { return enabled; },
    get available() { return !!manifest; }
  };

  fetch(`${DIR}voices.json`)
    .then(res => (res.ok ? res.json() : Promise.reject(new Error(res.status))))
    .then(data => {
      manifest = data;
      if (api.onLoad) api.onLoad();
    })
    .catch(() => { /* bez nahrávek hra mlčí */ });

  function clip(file) {
    let audio = clips.get(file);

    if (!audio) {
      audio = new Audio(DIR + file);
      audio.preload = "auto";
      clips.set(file, audio);
    }

    return audio;
  }

  function say(type, kind) {
    const lines = manifest && manifest[type];
    if (!enabled || !lines || PK.audio.muted) return;

    const now = Date.now();
    if (now - lastAt < COOLDOWN) return;

    let key = kind;

    if (kind === "select") {
      streak = streak.type === type && now - streak.at < ANNOYED_WINDOW ? { type, count: streak.count + 1, at: now } : { type, count: 1, at: now };
      if (streak.count >= ANNOYED_AFTER) key = "annoyed";
    }

    const pool = (lines[key] || []).filter(line => line.file !== lastFile);
    if (!pool.length) return;

    const line = pool[Math.floor(Math.random() * pool.length)];
    const audio = clip(line.file);

    if (current && current !== audio) current.pause();
    audio.volume = Math.max(0, Math.min(1, PK.audio.volume * LEVEL));
    audio.currentTime = 0;
    current = audio;
    lastAt = now;
    lastFile = line.file;

    const played = audio.play();
    if (played && played.catch) played.catch(() => { /* prohlížeč zvuk ještě nepovolil */ });
  }

  function setEnabled(value) {
    enabled = !!value;
    try { localStorage.setItem(KEY, enabled ? "1" : "0"); } catch (e) { /* ignore */ }
    if (!enabled && current) current.pause();
  }

  PK.voice = api;
})();
