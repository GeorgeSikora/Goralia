/*
 * Tutoriál pro nové hráče: kolik hráčů ho začalo, dokončilo nebo přeskočilo a kam až došli.
 * Tutoriál běží v prohlížeči, server dostává jen hlášení (POST /api/tutorial), stejně jako u her proti AI.
 * Hráč = prohlížeč při prvním spuštění (klient posílá first), u přihlášeného účtu se navíc hlídá účet,
 * takže opakované spuštění ani jiný prohlížeč téhož účtu se do "začalo/dokončilo" nezapočte znovu.
 * Za dokončení dostane účet titul Nováček: odměna title-novacek v user.cosmetics (stejné úložiště jako odměny z výzev),
 * hned si ho i nasadí, pokud zatím žádný titul nenosí.
 */
"use strict";

const STEPS = ["select", "wood", "gold", "hut", "barracks", "train", "research", "attack", "victory"];
const TITLE = "title-novacek";
const KEEP_DAYS = 400;

function createTutorial(store, accounts, dayKey, challenges = null) {
  const data = store.data;
  if (!data.tutorial || typeof data.tutorial !== "object") data.tutorial = {};
  const t = data.tutorial;
  for (const k of ["started", "finished", "skipped", "quit", "runs", "replays"]) if (typeof t[k] !== "number") t[k] = 0;
  if (!Array.isArray(t.reached)) t.reached = [];
  while (t.reached.length < STEPS.length) t.reached.push(0);
  if (!Array.isArray(t.skippedAt)) t.skippedAt = [];
  while (t.skippedAt.length < STEPS.length) t.skippedAt.push(0);
  t.days = t.days || {};

  function day() {
    const key = dayKey();
    if (!t.days[key]) {
      t.days[key] = { started: 0, finished: 0, skipped: 0 };
      const keys = Object.keys(t.days).sort();
      while (keys.length > KEEP_DAYS) delete t.days[keys.shift()];
    }
    return t.days[key];
  }

  const progress = user => user && (user.tutorial || (user.tutorial = {}));
  function reward(user) {
    if (!user) return;
    if (!user.tutorial) user.tutorial = {};
    if (!user.tutorial.done) user.tutorial.done = Date.now();
    if (challenges && challenges.give(user, TITLE, "Tutoriál")) {
      const look = user.cosmetics.look;
      if (!look.title) look.title = TITLE;
    }
  }

  const stepOf = body => {
    const n = Math.floor(Number(body.step));
    return Number.isFinite(n) && n >= 0 && n < STEPS.length ? n : -1;
  };

  // body: { e: start | step | skip | quit | done | claim, step, first }. Vrací odpověď pro klienta.
  function handle(body, user) {
    const kind = String(body && body.e || "");
    const first = !!(body && body.first);
    const p = progress(user);

    switch (kind) {
      case "start": {
        t.runs++;
        if (first && !(p && p.started)) {
          t.started++;
          day().started++;
        } else {
          t.replays++;
        }
        if (p && !p.started) p.started = Date.now();
        break;
      }
      case "step": {
        const n = stepOf(body);
        if (n < 0) return null;
        // trychtýř počítá jen první průchod, opakování by čísla zkreslila
        if (first) t.reached[n]++;
        break;
      }
      case "skip": {
        const n = stepOf(body);
        if (first && !(p && p.done)) {
          t.skipped++;
          day().skipped++;
          if (n >= 0) t.skippedAt[n]++;
        }
        if (p && !p.skipped) p.skipped = Date.now();
        break;
      }
      case "quit": {
        if (first) t.quit++;
        break;
      }
      case "done": {
        if (first && !(p && p.done)) {
          t.finished++;
          day().finished++;
        }
        reward(user);
        break;
      }
      case "claim": {
        // tutoriál dohraný bez přihlášení: titul se připíše po přihlášení (počty se nemění)
        if (!user) return null;
        reward(user);
        break;
      }
      default:
        return null;
    }

    store.save();
    return { ok: true, tutorialDone: !!(user && user.tutorial && user.tutorial.done), look: user && challenges ? challenges.lookOf(user) : undefined };
  }

  function report(days = 30) {
    const n = Math.max(1, Math.min(KEEP_DAYS, Math.floor(days) || 30));
    const out = [];
    const now = Date.now();
    for (let i = n - 1; i >= 0; i--) {
      const key = dayKey(now - i * 86400000);
      const d = t.days[key] || {};
      out.push({ date: key, started: d.started || 0, finished: d.finished || 0, skipped: d.skipped || 0 });
    }

    const users = Object.values(data.users || {});
    return {
      started: t.started, finished: t.finished, skipped: t.skipped, quit: t.quit, runs: t.runs, replays: t.replays,
      steps: STEPS, reached: t.reached.slice(0, STEPS.length), skippedAt: t.skippedAt.slice(0, STEPS.length),
      accounts: {
        started: users.filter(u => u.tutorial && u.tutorial.started).length,
        finished: users.filter(u => u.tutorial && u.tutorial.done).length,
        titled: users.filter(u => u.cosmetics && u.cosmetics.owned && u.cosmetics.owned[TITLE]).length
      },
      days: out
    };
  }

  return { handle, report, STEPS, TITLE };
}

module.exports = { createTutorial, STEPS, TITLE };
