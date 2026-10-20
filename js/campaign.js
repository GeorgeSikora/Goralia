/*
 * Kampaň "Stín Morvanův": čtyři kapitoly proti nemrtvým (inspirace Warcraft 3).
 * Kapitola = mapa z js/campaign-maps.js + skript. Skript je generátor nad místní simulací (sim.Match):
 * staví scénu, spouští cutscény s dialogy, hlídá úkoly a nakonec vyhlásí vítězství nebo porážku.
 *
 * Režisér (Director) pouští skripty jako vlákna. Vlákno vrací (yield) na co čeká:
 *   číslo = sekundy, funkce = podmínka, { k: "line" } = dokud nedoběhne replika.
 * Během cutscény běží jen vlákno, které ji spustilo; ostatní (vlny, hlídání úkolů) stojí.
 * Hra (js/game.js) čte director.state a kreslí podle něj lišty, dialog, úkoly a kruh pod mluvčím (js/cutscene.js).
 *
 * Každá replika má stálé id (např. "k1.uvod.03"). Nahrané hlasy patří do assets/kampan/hlasy/<id>.mp3
 * a jejich id do seznamu VOICED; bez nahrávky se replika jen vypíše. Celý scénář je v docs/kampan-scenar.md.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const R = PK.rules;
  const alive = e => !!e && e.hp > 0;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const approach = (v, to, step) => (v < to ? Math.min(to, v + step) : Math.max(to, v - step));

  /* ---------- postup kampaně (jen v prohlížeči) ---------- */
  const SAVE_KEY = "pk-campaign";

  function progress() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && Array.isArray(s.done)) return s;
    } catch (e) { /* nedostupné nebo poškozené úložiště */ }
    return { done: [] };
  }

  function markDone(id) {
    const s = progress();
    if (!s.done.includes(id)) s.done.push(id);
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }

  /* ---------- hlasy replik ---------- */
  const VOICED = new Set([]); // id replik, které mají soubor assets/kampan/hlasy/<id>.mp3
  let voiceEl = null;

  function playVoice(id) {
    stopVoice();
    if (!VOICED.has(id) || PK.audio.muted) return 0;
    voiceEl = new Audio(`assets/kampan/hlasy/${id}.mp3`);
    voiceEl.volume = PK.audio.volume;
    voiceEl.play().catch(() => {});
    return voiceEl;
  }

  function stopVoice() {
    if (voiceEl) voiceEl.pause();
    voiceEl = null;
  }

  /* ---------- obsazení ---------- */
  // side: "me" hráč, "foe" nemrtví, "ally" spojenec; tým se bere z jednotky, pokud postava ve scéně stojí.
  const CAST = {
    radim: { name: "Radim z Bystré", type: "knight", side: "me" },
    jitka: { name: "Jitka", type: "archer", side: "me" },
    krystof: { name: "Bratr Kryštof", type: "monk", side: "me" },
    hostivit: { name: "Vojvoda Hostivít", type: "hero", side: "ally" },
    padly: { name: "Padlý Hostivít", type: "hero", side: "foe" },
    morvan: { name: "Morvan", type: "lich", side: "foe" },
    hlas: { name: "Hlas ze tmy", type: "lich", side: "foe" },
    vratislav: { name: "Vratislav", type: "banshee", side: "foe" },
    matej: { name: "Strážný Matěj", type: "soldier", side: "ally" },
    sedlak: { name: "Sedlák Bartoš", type: "worker", side: "me" }
  };

  /* ---------- režisér ---------- */
  class Director {
    // game: { m: sim.Match, me, foe, ally, fx(kind, x, y), announce(text) }
    constructor(chapter, game) {
      this.ch = chapter;
      this.g = game;
      this.m = game.m;
      this.threads = [];
      this.cine = null;
      this.playT = 0; // čas hry mimo cutscény (časovače úkolů)
      this.actors = {};
      this.names = new Map(); // id jednotky -> jméno postavy
      this.loseWhy = "";
      this.state = {
        cinematic: false, bars: 0, fade: 1, fadeTo: 1, fadeTime: 0.6,
        line: null, title: null, camera: null, zoom: 2, objectives: [], phase: chapter.phase == null ? null : chapter.phase,
        skippable: false
      };
      this.phaseAnim = null;
      this.go(chapter.run(this.ctx()));
    }

    go(gen) {
      const t = { gen, wait: null, done: false };
      this.threads.push(t);
      return t;
    }

    get over() { return this.m.phase === "ended"; }

    tick(dt) {
      const st = this.state;
      const skipping = !!(this.cine && this.cine.skip);

      st.bars = approach(st.bars, this.cine ? 1 : 0, dt / 0.45);
      st.fade = skipping ? st.fadeTo : approach(st.fade, st.fadeTo, dt / Math.max(0.05, st.fadeTime));
      if (st.title) st.title.t += dt;

      if (st.line && !st.line.done) {
        st.line.t += dt;
        const v = st.line.voice;
        const voiceLeft = v && v.duration && !v.ended ? v.duration - v.currentTime : 0;
        if (st.line.t >= st.line.dur && voiceLeft <= 0) st.line.done = true;
      }

      if (this.phaseAnim) {
        const a = this.phaseAnim;
        a.t = Math.min(1, a.t + dt / a.dur);
        st.phase = a.from + (a.to - a.from) * a.t;
        if (a.t >= 1) this.phaseAnim = null;
      }

      if (!this.cine) this.playT += dt;
      if (this.over) return;

      for (const t of [...this.threads]) {
        if (t.done) continue;
        if (this.cine && this.cine.owner !== t) continue;
        this.step(t, dt);
        // přeskočená cutscéna doběhne naráz (pohyby se teleportují, repliky se nevypíšou)
        for (let n = 0; n < 40 && this.cine && this.cine.skip && this.cine.owner === t && !t.done; n++) this.step(t, 0);
      }

      this.threads = this.threads.filter(t => !t.done);
    }

    step(t, dt) {
      for (let guard = 0; guard < 400 && !t.done; guard++) {
        if (t.wait) {
          if (!this.ready(t.wait, dt)) return;
          dt = 0;
          t.wait = null;
        }

        this.current = t;
        let r;
        try {
          r = t.gen.next();
        } catch (e) {
          console.error("Kampaň:", e);
          t.done = true;
          return;
        } finally {
          this.current = null;
        }

        if (r.done) {
          t.done = true;
          return;
        }

        const v = r.value;
        t.wait = typeof v === "number" ? { k: "time", left: v }
          : typeof v === "function" ? { k: "until", fn: v }
          : v && v.k ? v : { k: "time", left: 0 };
        if (this.over) return;
      }
    }

    ready(w, dt) {
      if (this.cine && this.cine.skip) return true;
      if (w.k === "time") return (w.left -= dt) <= 1e-9;
      if (w.k === "until") return !!w.fn();
      if (w.k === "line") return !this.state.line || this.state.line.done;
      return true;
    }

    // Zbývající čas úkolu s časovačem (s).
    left(key) {
      const obj = this.state.objectives.find(q => q.key === key);
      return obj && obj.ends ? Math.max(0, obj.ends - this.playT) : 0;
    }

    // Klik nebo mezerník: dopíše repliku, podruhé ji odklikne.
    advance() {
      const line = this.state.line;
      if (!line || line.done) return;
      const full = line.t * line.cps >= line.text.length;
      if (!full) line.t = Math.max(line.t, line.text.length / line.cps + 0.01);
      else line.done = true;
    }

    skip() {
      if (!this.cine || !this.state.skippable) return;
      this.cine.skip = true;
      stopVoice();
      this.state.line = null;
      this.state.title = null;
    }

    beginCine(t) {
      const m = this.m;
      this.cine = { owner: t, skip: false };
      this.state.cinematic = true;
      this.state.skippable = true;
      // příměří: nikdo neútočí, AI stojí; rozkazy k útoku se po cutscéně vrátí
      this.saved = { brains: m.brains, side: { ...m.side }, orders: new Map() };
      m.brains = {};
      for (const team of m.active) m.side[team] = "cine";
      for (const u of m.units) {
        if (u.order && (u.order.type === "attack" || u.order.type === "amove")) {
          this.saved.orders.set(u, u.order);
          u.order = null;
        }
      }
    }

    endCine() {
      const m = this.m;
      const s = this.saved;
      m.brains = s.brains;
      Object.assign(m.side, s.side);
      for (const [u, order] of s.orders) if (alive(u) && !u.order) u.order = order;
      this.cine = null;
      this.saved = null;
      Object.assign(this.state, { cinematic: false, line: null, title: null, camera: null, fadeTo: 0, fadeTime: 0.5, skippable: false });
    }

    /* ---------- příkazy pro skripty kapitol ---------- */
    ctx() {
      const d = this;
      const m = this.m;
      const { me, foe, ally } = this.g;
      const st = this.state;
      const skipping = () => !!(d.cine && d.cine.skip);
      const teamOf = side => (side === "foe" ? foe : side === "ally" ? ally : me);

      const c = {
        m, me, foe, ally, alive, dist,
        get playT() { return d.playT; },
        actor: key => d.actors[key],

        /* scéna */
        unit(type, side, x, y, o = {}) {
          // nikdo se nesmí objevit ve vodě, ve skále ani v budově: posun na nejbližší volné místo
          if (m.nav.isBlocked(x, y)) {
            search: for (let r = 8; r <= 160; r += 8) {
              for (let k = 0; k < 16; k++) {
                const nx = Math.round(x + Math.cos(k * Math.PI / 8) * r);
                const ny = Math.round(y + Math.sin(k * Math.PI / 8) * r);
                if (nx > 12 && nx < m.LW - 12 && ny > 38 && ny < m.LH - 14 && !m.nav.isBlocked(nx, ny)) { x = nx; y = ny; break search; }
              }
            }
          }
          const u = m.createUnit(type, teamOf(side), x, y);
          u.x = x;
          u.y = y;
          if (o.facing) u.facing = o.facing;
          if (o.hp) {
            u.maxHp = Math.round(u.maxHp * o.hp);
            u.hp = u.maxHp;
          }
          if (o.as) {
            d.actors[o.as] = u;
            d.names.set(u.id, (CAST[o.as] || {}).name || o.as);
          }
          return u;
        },
        group(type, side, x, y, n, o = {}) {
          const out = [];
          const spread = o.spread || 38;
          for (let i = 0; i < n; i++) {
            const a = i * 2.39996 + (o.rot || 0);
            const r = spread * Math.sqrt(i + 0.5) * 0.7;
            out.push(c.unit(type, side, Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r * 0.7), o));
          }
          return out;
        },
        building(type, side, x, y) {
          return m.createBuilding(type, teamOf(side), x, y, false);
        },
        // smaže tým ze scény (skrytá pekelná základna v prvních kapitolách, hráč bez základny)
        clear(team, what = "all") {
          if (what !== "units") {
            for (const b of m.buildings) if (b.team === team) m.unplace(b);
            m.buildings = m.buildings.filter(b => b.team !== team);
          }
          if (what !== "buildings") m.units = m.units.filter(u => u.team !== team);
        },
        // jednotka zmizí bez boje (kouzlem); kouř a záblesk nakreslí hra
        vanish(u) {
          if (!u) return;
          d.g.fx("vanish", u.x, u.y);
          m.units = m.units.filter(x => x !== u);
        },
        // smrt ve scénáři (padne jako v boji, s mrtvolou); by = kdo ji zasadil
        kill(u, by) {
          if (alive(u)) m.damage(alive(by) ? by : u, u, u.hp + 1, { silent: true });
        },
        // přejde k jinému týmu (Hostivít se přidá k nemrtvým)
        turn(u, side) {
          u.team = teamOf(side);
          u.order = null;
          d.g.fx("turn", u.x, u.y);
        },
        // dělníci jdou těžit k nejbližšímu dolu
        work(side = "me") {
          const team = teamOf(side);
          for (const u of m.units) {
            if (u.team !== team || u.type !== "worker" || u.order) continue;
            const mine = m.resources.filter(r => r.type === "gold" && r.amount > 0).sort((a, b) => dist(a, u) - dist(b, u))[0];
            if (mine) u.order = { type: "gather", target: mine };
          }
        },
        gold(n, wood) {
          m.econ[me].gold = n;
          if (wood != null) m.econ[me].wood = wood;
        },

        /* pohyb */
        walk(u, x, y) {
          if (!alive(u)) return;
          if (skipping()) {
            u.x = x;
            u.y = y;
            u.path = null;
            u.order = null;
          } else {
            u.order = { type: "move", x, y };
          }
        },
        // skupina jde do formace; každý vyrazí o chvilku jindy, ať nejdou v jednom kroku
        march(list, x, y, o = {}) {
          const spread = o.spread || 34;
          list.filter(alive).forEach((u, i) => {
            const a = i * 2.39996;
            const r = i ? spread * Math.sqrt(i) * 0.75 : 0;
            const tx = Math.round(x + Math.cos(a) * r);
            const ty = Math.round(y + Math.sin(a) * r * 0.65);
            const delay = i * 0.13 + ((u.id * 37) % 10) / 40;
            if (skipping() || !delay) c.walk(u, tx, ty);
            else d.go((function* () { yield delay; c.walk(u, tx, ty); })());
          });
        },
        attack(list, x, y) {
          for (const u of [].concat(list)) if (alive(u)) u.order = { type: "amove", x, y };
        },
        // čeká, až vlna padne; kdo se zasekne nebo zůstane stát, toho pošle na nejbližšího nepřítele
        *wipe(list) {
          let next = d.playT + 20;
          while (list.some(alive)) {
            yield 1;
            if (d.playT < next) continue;
            next = d.playT + 15;
            const foes = m.units.filter(u => alive(u) && !m.friendly(u.team, list[0].team));
            for (const u of list) {
              if (!alive(u) || (u.order && u.order.type === "attack")) continue;
              const near = foes.sort((a, b) => dist(a, u) - dist(b, u))[0] || m.hqOf(me);
              if (near) u.order = { type: "amove", x: near.x, y: near.y };
            }
          }
        },
        arrived: u => () => !alive(u) || (!u.order && !(u.path && u.path.length)),
        face(u, toward) {
          if (!alive(u)) return;
          u.facing = typeof toward === "number" ? toward : toward.x < u.x ? -1 : 1;
        },
        faceEach(a, b) {
          c.face(a, b);
          c.face(b, a);
        },
        near: (u, x, y, r) => alive(u) && Math.hypot(u.x - x, u.y - y) <= r,
        anyNear(team, x, y, r) {
          return m.units.some(u => u.team === team && alive(u) && Math.hypot(u.x - x, u.y - y) <= r);
        },
        dead: list => () => [].concat(list).every(u => !alive(u)),

        /* kamera a obraz */
        look(x, y, snap) {
          st.camera = { x, y, snap: !!snap };
        },
        follow(u, snap) {
          if (u) st.camera = { id: u.id, snap: !!snap };
        },
        zoom(z) {
          st.zoom = z;
        },
        *fadeOut(sec = 0.6) {
          st.fadeTo = 1;
          st.fadeTime = sec;
          yield sec;
        },
        *fadeIn(sec = 0.6) {
          st.fadeTo = 0;
          st.fadeTime = sec;
          yield sec * 0.6;
        },
        // střih: setmění, přestavení scény (fn), rozsvícení
        *cut(fn, sec = 0.45) {
          yield* c.fadeOut(sec);
          if (fn) fn();
          if (st.camera) st.camera.snap = true;
          yield 0.05;
          yield* c.fadeIn(sec);
        },
        phase(p, sec = 0) {
          if (!sec || skipping()) {
            st.phase = p;
            d.phaseAnim = null;
          } else {
            d.phaseAnim = { from: st.phase == null ? p : st.phase, to: p, t: 0, dur: sec };
          }
        },
        fx: (kind, x, y) => d.g.fx(kind, x, y),
        note: text => d.g.announce(text),

        /* cutscény a repliky */
        *cutscene(body) {
          yield () => !d.cine;
          d.beginCine(d.current);
          try {
            yield* body();
          } finally {
            d.endCine();
          }
        },
        *title(kicker, name, sec = 3.4) {
          st.fadeTo = 1;
          st.fade = 1;
          st.title = { kicker, name, t: 0, dur: sec };
          yield sec;
          st.title = null;
        },
        // replika postavy; o.cam = false nechá kameru být, o.at = jednotka, pod kterou se rozsvítí kruh
        *say(id, who, text, o = {}) {
          if (skipping()) return;
          const cast = CAST[who] || { name: who, type: "soldier", side: "me" };
          const u = o.at || d.actors[who];
          const here = alive(u) ? u : null;
          const voice = playVoice(id);
          const cps = 30;
          st.line = {
            id, text, who: cast.name, type: cast.type, team: here ? here.team : teamOf(cast.side),
            unit: here ? here.id : 0, voice: voice || null,
            t: 0, cps, dur: Math.max(2.6, text.length / cps + 1.6), done: false, inGame: !d.cine
          };
          if (here && o.cam !== false && d.cine) st.camera = { id: here.id };
          yield { k: "line" };
          st.line = null;
          stopVoice();
          yield 0.18;
        },
        *narrate(id, text) {
          yield* c.say(id, "vypravec", text, { cam: false });
        },

        /* úkoly */
        objective(key, text, o = {}) {
          let obj = st.objectives.find(q => q.key === key);
          if (!obj) {
            obj = { key, text, state: "open", optional: !!o.optional, ends: 0, count: "" };
            st.objectives.push(obj);
            if (!d.cine && !o.quiet && d.playT > 3) d.g.announce(`Nový úkol: ${text}`);
          }
          obj.text = text;
          return obj;
        },
        drop(key) {
          st.objectives = st.objectives.filter(q => q.key !== key);
        },
        // postava změní jméno (Hostivít -> Padlý Hostivít)
        rename(u, key) {
          d.names.set(u.id, CAST[key].name);
          d.actors[key] = u;
        },
        progress(key, count) {
          const obj = st.objectives.find(q => q.key === key);
          if (obj) obj.count = count;
        },
        timer(key, sec) {
          const obj = st.objectives.find(q => q.key === key);
          if (obj) obj.ends = d.playT + sec;
        },
        left: key => d.left(key),
        fail(key) {
          const obj = st.objectives.find(q => q.key === key);
          if (obj) obj.state = "failed";
        },
        complete(key) {
          const obj = st.objectives.find(q => q.key === key);
          if (obj && obj.state === "open") {
            obj.state = "done";
            obj.ends = 0;
            d.g.announce(`Splněno: ${obj.text}`);
          }
        },
        // hlídá podmínku prohry po celou kapitolu (mimo cutscény)
        guard(fn, why, key) {
          d.go((function* () {
            yield fn;
            if (key) c.fail(key);
            c.defeat(why);
          })());
        },
        go: gen => d.go(gen),

        victory() {
          for (const q of st.objectives) if (q.state === "open" && !q.optional) q.state = "done";
          const winners = m.active.filter(t => m.side[t] === m.side[me]);
          m.finish(me, "campaign", winners);
        },
        defeat(why) {
          if (d.over) return;
          d.loseWhy = why;
          m.finish(foe, "campaign", [foe]);
        }
      };

      return c;
    }
  }

  // Kdo je naživu z hlavních postav; pro hlídání "musí přežít".
  const fallen = (c, keys) => () => keys.some(k => !alive(c.actor(k)));
  const fallenName = (c, keys) => {
    const k = keys.find(key => !alive(c.actor(key)));
    return k ? `${CAST[k].name} padl${k === "jitka" ? "a" : ""}.` : "";
  };

  // Hlavní postavy se mimo boj pomalu léčí (jako hrdinové ve Warcraftu), ať jedna prohraná šarvátka neukončí kapitolu.
  function regen(c, keys) {
    c.go((function* () {
      for (;;) {
        yield 1;
        for (const k of keys) {
          const u = c.actor(k);
          if (!alive(u) || u.hp >= u.maxHp) continue;
          const fight = c.m.units.some(e => alive(e) && !c.m.friendly(e.team, u.team) && dist(e, u) < 260);
          if (!fight) u.hp = Math.min(u.maxHp, u.hp + Math.max(2, u.maxHp * 0.012));
        }
      }
    })());
  }

  // Na mapách se základnou hlavní postavy nepadnou nadobro: ranhojiči v Gmině je dají za chvíli dohromady
  // (jako oživení hrdiny ve Warcraftu). Prohrává se ztrátou Gminy.
  const REVIVE = 45;

  function revive(c, keys) {
    regen(c, keys);
    for (const key of keys) {
      c.go((function* () {
        for (;;) {
          yield () => !alive(c.actor(key));
          const name = CAST[key].name;
          c.note(`${name} je těžce raněn${key === "jitka" ? "a" : ""}. Ranhojiči v Gmině ${key === "jitka" ? "ji" : "ho"} dají dohromady.`);
          c.objective(`zotaveni-${key}`, `${name} se zotavuje`, { quiet: true });
          c.timer(`zotaveni-${key}`, REVIVE);
          yield () => c.left(`zotaveni-${key}`) <= 0;
          c.drop(`zotaveni-${key}`);
          const hq = c.m.hqOf(c.me);
          if (!hq) return;
          // stejná jednotka se vrátí do hry, takže na ni dál platí odkazy ve skriptu kapitoly
          const u = c.actor(key);
          Object.assign(u, { hp: u.maxHp, x: hq.x + 50, y: hq.y + 60, order: null, path: null, cooldown: 0, facing: 1 });
          c.m.units.push(u);
          c.m.eject(u);
          c.fx("spawn", u.x, u.y);
        }
      })());
    }
  }

  function guardHeroes(c, keys, objective) {
    regen(c, keys);
    c.go((function* () {
      yield fallen(c, keys);
      c.fail(objective);
      c.defeat(fallenName(c, keys));
    })());
  }

  /* ======================= kapitoly ======================= */
  const CHAPTERS = [];

  /* ---------- I. Popel nad Bystrou ---------- */
  CHAPTERS.push({
    id: "k1",
    num: "Kapitola I",
    title: "Popel nad Bystrou",
    blurb: "Na sever od vesnice Bystrá začala zem kouřit popelem. Rytíř Radim musí s hrstkou sedláků ubránit vesnici před první nocí mrtvých.",
    map: "kampan-bystra",
    roster: [{ slot: 0, name: "Radim" }, { slot: 1, name: "Nemrtví", ai: true }],
    phase: 0.47,
    winText: "Bystrá přečkala noc. Družina vyráží do Hněvína.",
    *run(c) {
      const { me, foe, m } = c;
      c.clear(foe);
      c.gold(420, 260);
      const plot = m.slotOf(me).plot;
      c.building("barracks", "me", plot.x, plot.y);

      const radim = c.unit("knight", "me", 900, 760, { as: "radim", hp: 4, facing: -1 });
      const soldiers = [c.unit("soldier", "me", 760, 640), c.unit("soldier", "me", 800, 600), c.unit("soldier", "me", 960, 900)];
      c.unit("worker", "me", 600, 900);
      c.unit("worker", "me", 1000, 680);
      const bartos = c.unit("worker", "me", 860, 700, { as: "sedlak", facing: 1 });

      yield* c.cutscene(function* () {
        c.look(900, 720, true);
        yield* c.title("Kapitola I", "Popel nad Bystrou");
        yield* c.fadeIn(1.2);
        yield* c.narrate("k1.uvod.01", "Goralie, rok po Velké válce. Lidé znovu orají pole a staví domy. Ale na severu, ve Vraním lese, začala zem kouřit popelem.");

        const jitka = c.unit("archer", "me", 1040, 200, { as: "jitka", hp: 2.5 });
        yield* c.cut(() => c.follow(jitka));
        c.walk(jitka, 940, 700);
        yield* c.say("k1.uvod.02", "jitka", "Radime! Radime, stůj!");
        yield c.arrived(jitka);
        c.faceEach(jitka, radim);
        c.face(bartos, jitka);
        yield* c.say("k1.uvod.03", "radim", "Jitko? Co se děje? Vypadáš, jako bys viděla ducha.");
        yield* c.say("k1.uvod.04", "jitka", "Hůř. Ve Vraním lese jsem viděla mrtvé. Chodí, Radime. Jdou sem.");
        yield* c.say("k1.uvod.05", "sedlak", "Mrtví nechodí, děvče. Kolik jsi toho u mě v hospodě vypila?");
        yield* c.say("k1.uvod.06", "jitka", "Ani kapku! Byl mezi nimi starý Ondra. Ten, co jsme ho loni pohřbili. Měl prázdné oči.");

        const scouts = c.group("ghoul", "foe", 1066, 110, 4, { spread: 30 });
        yield* c.cut(() => c.follow(scouts[0]));
        c.march(scouts, 980, 340, { spread: 30 });
        yield 3.2;
        yield* c.cut(() => {
          for (const u of scouts) c.vanish(u);
          c.follow(radim);
        });
        c.face(radim, 1);
        yield* c.say("k1.uvod.07", "radim", "Bartoši, zvoň na poplach. Ať se všichni stáhnou ke Gmině a muži vezmou zbraně.");
        yield* c.say("k1.uvod.08", "radim", "Bystrá nepadne. Ne, dokud stojím na nohou.");
        yield* c.fadeOut(0.7);
        c.look(radim.x, radim.y, true);
      });

      c.work();
      c.objective("brana", "Ubraň Bystrou před nemrtvými");
      c.objective("gmina", "Gmina nesmí padnout");
      revive(c, ["radim", "jitka"]);
      c.guard(() => !m.hqOf(me), "Gmina Bystré padla.", "gmina");
      c.note("Tip: v kasárnách cvič vojáky, dělníci postaví strážní věž u severní cesty.");

      // tři vlny: ze severní cesty a ze spálené země na severovýchodě
      const WAVES = [
        { wait: 75, from: [[1080, 60, "ghoul", 5]] },
        { wait: 95, from: [[1080, 60, "ghoul", 4], [1620, 360, "ghoul", 2], [1620, 380, "skeleton", 3]] },
        { wait: 100, from: [[1080, 60, "ghoul", 5], [1080, 80, "skeleton", 3], [1600, 380, "abomination", 1], [1640, 340, "banshee", 2]] }
      ];
      const TALK = [
        ["k1.vlna.01", "jitka", "Jdou z lesa! Držte cestu!"],
        ["k1.vlna.02", "radim", "Další jdou od spálené země. Kostlivci mají luky, kryjte se za věžemi!"],
        ["k1.vlna.03", "jitka", "Radime, tohle je něco jiného... něco obrovského!"]
      ];

      for (let i = 0; i < WAVES.length; i++) {
        const w = WAVES[i];
        c.progress("brana", `vlna ${i}/${WAVES.length}`);
        c.objective("dalsi", "Další vlna dorazí", { quiet: true });
        c.timer("dalsi", w.wait);
        yield () => c.left("dalsi") <= 0;
        c.drop("dalsi");

        const wave = [];
        for (const [x, y, type, n] of w.from) wave.push(...c.group(type, "foe", x, y, n, { spread: 46 }));
        c.attack(wave, 760, 820);
        yield* c.say(...TALK[i]);
        yield* c.wipe(wave);
        c.progress("brana", `vlna ${i + 1}/${WAVES.length}`);
        if (i === 0) yield* c.say("k1.vlna.04", "radim", "To byli jen první. Postavte věže u cesty, noc je ještě dlouhá.");
      }
      c.complete("brana");
      yield 2;

      yield* c.cutscene(function* () {
        const jitka = c.actor("jitka");
        yield* c.cut(() => {
          c.phase(0.92);
          for (const u of m.units) if (u.team === foe) c.vanish(u);
          radim.x = 900; radim.y = 760; radim.order = null;
          if (alive(jitka)) { jitka.x = 960; jitka.y = 720; jitka.order = null; }
          c.look(1000, 780, true);
        }, 0.8);
        yield* c.narrate("k1.konec.01", "Úsvit přišel pomalu. Z Vraního lesa už nikdo nevyšel.");
        const krystof = c.unit("monk", "me", 1990, 810, { as: "krystof", hp: 2.5, facing: -1 });
        c.follow(krystof);
        c.walk(krystof, 1060, 780);
        yield 2.4;
        c.face(radim, 1);
        if (alive(jitka)) c.face(jitka, 1);
        yield* c.say("k1.konec.02", "krystof", "Pokoj vám, lidé z Bystré. Přicházím pozdě, jak vidím.");
        yield c.arrived(krystof);
        c.faceEach(krystof, radim);
        yield* c.say("k1.konec.03", "radim", "Mnich? Tak daleko od hor? Kdo jsi?");
        yield* c.say("k1.konec.04", "krystof", "Bratr Kryštof z kláštera na Lysé hoře. Pohřbívám mrtvé, kteří nechtějí zůstat v zemi.");
        yield* c.say("k1.konec.05", "jitka", "Takže se mi to nezdálo.");
        yield* c.say("k1.konec.06", "krystof", "Nezdálo. Někdo je volá. Za Hněvínem se otevřela stará brána a z ní vane chlad, který probouzí kosti.");
        yield* c.say("k1.konec.07", "radim", "V Hněvíně vládne vojvoda Hostivít. Musí se to dozvědět, a hned.");
        yield* c.say("k1.konec.08", "krystof", "Pak vyrazíme ještě dnes. Nejkratší cesta vede Vraním lesem.");
        yield* c.cut(() => c.look(1500, 300, true), 0.7);
        yield* c.say("k1.konec.09", "hlas", "Jen pojďte, malí lidé. Každý z vás, kdo padne, mi přidá dalšího vojáka.", { cam: false });
        yield* c.fadeOut(1.2);
      });
      c.victory();
    }
  });

  /* ---------- II. Vraní les ---------- */
  CHAPTERS.push({
    id: "k2",
    num: "Kapitola II",
    title: "Vraní les",
    blurb: "Družina prochází mrtvým lesem ke strážnici Hněvína. Na cestě čekají přepadení a u brodu poprvé promluví ten, kdo mrtvé volá.",
    map: "kampan-vrani-les",
    roster: [{ slot: 0, name: "Družina" }, { slot: 1, name: "Nemrtví", ai: true }, { slot: 2, name: "Hněvín", ai: true }],
    phase: 0.12,
    winText: "Družina dorazila k vojvodovi Hostivítovi.",
    *run(c) {
      const { me, foe, ally, m } = c;
      c.clear(foe);
      c.clear(me);
      delete m.brains[ally];
      c.gold(0, 0);

      const radim = c.unit("knight", "me", 330, 520, { as: "radim", hp: 4, facing: 1 });
      const jitka = c.unit("archer", "me", 260, 560, { as: "jitka", hp: 2.5, facing: 1 });
      const krystof = c.unit("monk", "me", 250, 480, { as: "krystof", hp: 2.5, facing: 1 });
      const party = [radim, jitka, krystof,
        c.unit("soldier", "me", 200, 520), c.unit("soldier", "me", 170, 470), c.unit("soldier", "me", 160, 570), c.unit("soldier", "me", 120, 520),
        c.unit("archer", "me", 110, 470), c.unit("archer", "me", 100, 570)];

      // stráž u strážnice
      const guards = [c.unit("soldier", "ally", 2440, 470), c.unit("soldier", "ally", 2440, 580), c.unit("archer", "ally", 2500, 640)];
      for (const g of guards) c.face(g, -1);

      yield* c.cutscene(function* () {
        c.follow(radim, true);
        yield* c.title("Kapitola II", "Vraní les");
        yield* c.fadeIn(1.2);
        c.march(party, 560, 520, { spread: 36 });
        yield* c.narrate("k2.uvod.01", "Družina vyrazila za úsvitu. Vraní les byl tichý. Příliš tichý.");
        yield* c.say("k2.uvod.02", "jitka", "Neslyším ani jednoho ptáka. Ani vránu, a přitom se tomu tu říká Vraní les.");
        yield* c.say("k2.uvod.03", "krystof", "Mrtví nesou ticho s sebou. Držte se cesty a nespouštějte zbraně.");
        yield c.arrived(radim);
        yield* c.say("k2.uvod.04", "radim", "Ke strážnici Hněvína je to den cesty. Kdo zaostane, zůstane tu navždy.");
      });

      c.objective("cesta", "Doveď družinu ke strážnici Hněvína na východě");
      c.objective("zivi", "Radim, Jitka a Kryštof musí přežít");
      guardHeroes(c, ["radim", "jitka", "krystof"], "zivi");
      c.note("Tip: Kryštof léčí raněné, drž ho za vojáky.");

      // nepovinně: přeživší ze spálené vsi (sever, u odbočky z cesty)
      c.go((function* () {
        yield 25;
        c.objective("ves", "Zachraň přeživší ze spálené vsi na severu", { optional: true });
        const keepers = [...c.group("ghoul", "foe", 1190, 300, 4, { spread: 50 }), ...c.group("skeleton", "foe", 1240, 240, 2)];
        const folk = [c.unit("soldier", "ally", 1150, 210), c.unit("soldier", "ally", 1230, 190), c.unit("archer", "ally", 1190, 160)];
        yield () => keepers.every(u => !alive(u)) || folk.every(u => !alive(u));
        if (folk.some(alive)) {
          for (const u of folk) if (alive(u)) u.team = me;
          c.complete("ves");
          yield* c.say("k2.ves.01", "matej", "Díky nebesům! Mysleli jsme, že tu umřeme jako ostatní. Půjdeme s vámi.", { at: folk.find(alive) });
        }
      })());

      // přepadení z lesa
      yield () => radim.x > 760 || !alive(radim);
      const ambush = [...c.group("ghoul", "foe", 900, 250, 3), ...c.group("ghoul", "foe", 960, 820, 3)];
      c.attack(ambush, radim.x + 60, radim.y);
      yield* c.say("k2.boj.01", "jitka", "Z lesa! Z obou stran!");

      // u brodu se poprvé ukáže Morvan
      yield () => radim.x > 1330 || !alive(radim);
      let brod = [];
      yield* c.cutscene(function* () {
        const morvan = c.unit("lich", "foe", 1900, 520, { as: "morvan", facing: -1 });
        c.fx("spawn", morvan.x, morvan.y);
        for (const u of party) if (alive(u)) u.order = null;
        c.follow(morvan);
        yield 1.2;
        c.face(radim, 1);
        yield* c.say("k2.brod.01", "morvan", "Radim z Bystré. Slyšel jsem o tobě. Tví mrtví sousedé o tobě mluví s láskou.");
        yield* c.say("k2.brod.02", "radim", "Kdo jsi? Ukaž se!");
        yield* c.say("k2.brod.03", "morvan", "Jsem Morvan. Kdysi jsem býval dvorním mágem Goralie. Dnes jsem její budoucnost.");
        yield* c.say("k2.brod.04", "krystof", "Lich. Prodal duši za věčný život a dostal věčnou smrt.");
        yield* c.say("k2.brod.05", "morvan", "Hezky řečeno, mnichu. Uvidíme, jak se ti bude kázat bez jazyka.");
        yield* c.say("k2.brod.06", "morvan", "Vstaňte, mí věrní!");
        const risen = [...c.group("skeleton", "foe", 1800, 470, 4, { spread: 50 }), ...c.group("ghoul", "foe", 1780, 600, 4, { spread: 50 })];
        for (const u of risen) c.fx("spawn", u.x, u.y);
        yield 1;
        c.vanish(morvan);
        yield 0.6;
        c.attack(risen, 1500, 520);
        c.follow(radim);
        yield* c.say("k2.brod.07", "radim", "Rozbijte jim kosti! Pak přes brod!");
        brod = risen;
      });
      c.objective("brod", "Prorazte cestu přes brod");
      yield* c.wipe(brod);
      c.complete("brod");

      // za řekou: zrůda a přízraky
      yield () => radim.x > 1900 || !alive(radim);
      const big = [c.unit("abomination", "foe", 2160, 220), ...c.group("ghoul", "foe", 2100, 260, 3), ...c.group("banshee", "foe", 2240, 820, 2)];
      c.attack(big, radim.x + 80, radim.y);
      yield* c.say("k2.boj.02", "krystof", "Zrůda ze sešitých těl! Mířte na ni všichni najednou!");
      yield* c.wipe(big);

      // strážnice je v obležení: mrtví ji napadnou z lesa, než k ní družina dojde
      const siege = [...c.group("ghoul", "foe", 2660, 180, 4, { spread: 46 }), ...c.group("skeleton", "foe", 2700, 860, 3), ...c.group("ghoul", "foe", 2620, 880, 3)];
      c.attack(siege, 2520, 520);
      c.objective("straz", "Pomoz stráži ubránit strážnici");
      yield* c.say("k2.straz.01", "matej", "Pomoc! Ze tmy lezou další! Strážnice dlouho nevydrží!", { at: guards.find(alive) });
      yield* c.wipe(siege);
      c.complete("straz");

      yield () => c.near(radim, 2470, 520, 300);
      yield () => !m.units.some(u => u.team === foe && alive(u) && dist(u, radim) < 420);
      c.complete("cesta");

      yield* c.cutscene(function* () {
        const hostivit = c.unit("hero", "ally", 2640, 420, { as: "hostivit", facing: -1, hp: 2 });
        yield* c.cut(() => {
          for (const u of m.units) if (u.team === foe) c.vanish(u);
          radim.x = 2380; radim.y = 520; radim.order = null;
          if (alive(jitka)) { jitka.x = 2320; jitka.y = 580; jitka.order = null; }
          if (alive(krystof)) { krystof.x = 2310; krystof.y = 470; krystof.order = null; }
          c.follow(hostivit, true);
        });
        c.walk(hostivit, 2480, 510);
        yield* c.say("k2.konec.01", "hostivit", "Radim z Bystré. Říká se, že jsi s hrstkou sedláků ubránil celou vesnici.");
        yield c.arrived(hostivit);
        c.faceEach(hostivit, radim);
        yield* c.say("k2.konec.02", "radim", "Vojvodo. Mrtví vstávají. Za tvým hradem se otevřela brána a vede je lich jménem Morvan.");
        yield* c.say("k2.konec.03", "hostivit", "Vím. Viděl jsem je z hradeb. A viděl jsem mezi nimi... svého syna Vratislava.");
        yield* c.say("k2.konec.04", "krystof", "Pane, to už není tvůj syn. Je to jen schránka, kterou nosí cizí vůle.");
        yield* c.say("k2.konec.05", "hostivit", "Mlč, mnichu! Neviděl jsi jeho tvář.");
        yield 0.8;
        yield* c.say("k2.konec.06", "hostivit", "Hněvín se chystá na obléhání. Pomůžeš mi ho udržet, rytíři?");
        yield* c.say("k2.konec.07", "radim", "Do posledního muže, vojvodo.");
        yield* c.say("k2.konec.08", "jitka", "Radime... viděl jsi jeho oči? Ten muž se bojí víc než my všichni.", { cam: true });
        yield* c.fadeOut(1.2);
      });
      c.victory();
    }
  });

  /* ---------- III. Obležení Hněvína ---------- */
  CHAPTERS.push({
    id: "k3",
    num: "Kapitola III",
    title: "Obležení Hněvína",
    blurb: "Hněvín obléhají hordy z hor. Radim musí vydržet do úsvitu, než dorazí knížecí vojsko. A Morvan má pro vojvodu nabídku.",
    map: "kampan-hnevin",
    roster: [{ slot: 0, name: "Radim" }, { slot: 1, name: "Nemrtví", ai: true }, { slot: 2, name: "Hněvín", ai: true }],
    phase: 0.47,
    winText: "Hněvín vydržel. Vojvoda Hostivít ale zmizel ve tmě.",
    *run(c) {
      const { me, foe, ally, m } = c;
      const HOLD = 450;
      c.gold(650, 420);
      c.building("barracks", "me", 860, 1220);
      c.building("tower", "me", 1230, 1190);
      c.building("tower", "me", 1380, 1190);
      c.building("hut", "me", 840, 1420);
      c.unit("worker", "me", 1120, 1400);
      c.unit("worker", "me", 880, 1420);

      const radim = c.unit("knight", "me", 1180, 1250, { as: "radim", hp: 4, facing: 1 });
      const jitka = c.unit("archer", "me", 1120, 1290, { as: "jitka", hp: 2.5, facing: 1 });
      const krystof = c.unit("monk", "me", 1110, 1210, { as: "krystof", hp: 2.5, facing: 1 });
      c.group("soldier", "me", 1000, 1180, 4);
      c.group("archer", "me", 1040, 1230, 2);
      const hostivit = c.unit("hero", "ally", 1440, 1240, { as: "hostivit", hp: 2.5, facing: -1 });
      c.group("soldier", "ally", 1640, 1180, 3);

      const horde = m.brains[foe];
      horde.waveT = 90;

      yield* c.cutscene(function* () {
        c.follow(radim, true);
        yield* c.title("Kapitola III", "Obležení Hněvína");
        yield* c.fadeIn(1.2);
        yield* c.narrate("k3.uvod.01", "Třetí noc obléhání. Z hor sestupovala mlha a s ní hordy, kterým nebylo konce.");
        c.walk(radim, 1330, 1250);
        c.walk(hostivit, 1400, 1245);
        yield c.arrived(radim);
        c.faceEach(radim, hostivit);
        yield* c.say("k3.uvod.02", "hostivit", "Posel z jihu přinesl zprávu. Kníže posílá vojsko, ale dorazí až za úsvitu.");
        yield* c.say("k3.uvod.03", "radim", "Pak musíme vydržet do úsvitu.");
        yield* c.say("k3.uvod.04", "hostivit", "Hradby jsou staré a mužů je málo. Drž západní bránu, já budu držet východ.");
        c.walk(krystof, 1260, 1200);
        yield* c.say("k3.uvod.05", "krystof", "Pane, a co uděláš, až tvůj syn přijde k hradbám?");
        yield 1;
        yield* c.say("k3.uvod.06", "hostivit", "...To, co musím.");
        c.walk(hostivit, 1660, 1250);
        yield* c.fadeOut(0.7);
        c.walk(radim, 1180, 1250);
        c.look(1100, 1150, true);
      });

      c.work();
      c.objective("drz", "Vydrž do příchodu knížecího vojska");
      c.timer("drz", HOLD);
      c.objective("tabor", "Gmina tábora nesmí padnout");
      revive(c, ["radim", "jitka", "krystof"]);
      c.guard(() => !m.hqOf(me), "Tábor u západní brány padl.", "tabor");
      c.note("Tip: hradby mají brány jen tam, kudy vedou cesty. Věže postav k branám.");

      // v polovině obléhání se Morvan ukáže vojvodovi
      yield () => c.left("drz") <= HOLD / 2;
      yield* c.cutscene(function* () {
        const morvan = c.unit("lich", "foe", 1300, 900, { as: "morvan", facing: 1 });
        const ghost = c.unit("banshee", "foe", 1370, 930, { as: "vratislav", facing: 1 });
        c.fx("spawn", morvan.x, morvan.y);
        c.fx("spawn", ghost.x, ghost.y);
        yield* c.cut(() => c.follow(morvan));
        yield* c.say("k3.zjeveni.01", "morvan", "Hostivíte! Vojvodo Hněvína! Pojď blíž, mám pro tebe dar.");
        if (alive(hostivit)) {
          hostivit.x = 1600; hostivit.y = 1150; hostivit.order = null;
          c.follow(hostivit);
          c.walk(hostivit, 1450, 1020);
          yield 2.5;
          c.face(hostivit, ghost);
        }
        c.face(ghost, hostivit);
        yield* c.say("k3.zjeveni.02", "vratislav", "Otče... je mi zima. Otče, proč jsi mě nechal v té zemi?");
        yield* c.say("k3.zjeveni.03", "hostivit", "Vratislave! Synu můj...");
        radim.x = 1220; radim.y = 1200; radim.order = null;
        c.walk(radim, 1290, 1150);
        yield* c.say("k3.zjeveni.04", "radim", "Hostivíte, stůj! Je to past!");
        yield* c.say("k3.zjeveni.05", "morvan", "Otevři mi Bránu, vojvodo, a vrátím ti ho. Celého. Teplého. Živého.");
        yield* c.say("k3.zjeveni.06", "hostivit", "...Dej mi čas.");
        yield* c.say("k3.zjeveni.07", "morvan", "Čas mám, vojvodo. To ty ho nemáš.");
        c.vanish(ghost);
        c.vanish(morvan);
        yield 0.8;
        if (alive(hostivit)) c.walk(hostivit, 1660, 1250);
        yield* c.fadeOut(0.5);
        c.look(1100, 1150, true);
      });
      // Morvan zuří: vlny zesílí
      horde.wave += 1;
      horde.waveT = Math.min(horde.waveT, 30);
      yield* c.say("k3.boj.01", "jitka", "Radime, z hor jich jde dvakrát tolik! Morvan se nám vysmívá!");

      yield () => c.left("drz") <= 0;
      c.complete("drz");

      yield* c.cutscene(function* () {
        yield* c.cut(() => {
          c.phase(0.9);
          for (const u of m.units) if (u.team === foe && u.y > 900) c.vanish(u);
          c.look(1360, 1500, true);
        }, 0.8);
        yield* c.narrate("k3.konec.01", "Za úsvitu zazněly z jihu rohy. Knížecí vojsko dorazilo k Hněvínu.");
        const host = [...c.group("knight", "ally", 1360, 1790, 5, { spread: 60 }), ...c.group("soldier", "ally", 1300, 1840, 6, { spread: 50 })];
        c.march(host, 1360, 1450, { spread: 50 });
        yield 3;
        const jitkaU = c.actor("jitka");
        if (alive(jitkaU)) { jitkaU.x = 1260; jitkaU.y = 1330; jitkaU.order = null; c.follow(jitkaU); }
        radim.x = 1200; radim.y = 1300; radim.order = null;
        c.faceEach(radim, jitkaU || radim);
        yield* c.say("k3.konec.02", "jitka", "Radime! Vojvoda... Hostivít odešel severní bránou. Sám!");

        const morvan = c.unit("lich", "foe", 1300, 640, { as: "morvan", facing: 1 });
        const rider = alive(hostivit) ? hostivit : c.unit("hero", "ally", 1600, 1100, { as: "hostivit", hp: 2.5 });
        yield* c.cut(() => {
          rider.x = 1500; rider.y = 1000; rider.order = null;
          c.follow(rider);
        });
        c.walk(rider, 1370, 690);
        yield* c.say("k3.konec.03", "hostivit", "Morvane! Přišel jsem. Vrať mi syna.");
        yield c.arrived(rider);
        c.faceEach(rider, morvan);
        yield* c.say("k3.konec.04", "morvan", "Nejdřív mi dej, co jsi slíbil. Odhoď prapor Hněvína a klekni, vojvodo.");
        yield 1;
        c.turn(rider, "foe");
        c.rename(rider, "padly");
        yield 1.2;
        yield* c.say("k3.konec.05", "morvan", "Vstaň, můj rytíři. Už nikdy neucítíš chlad. Ani teplo. Ani lítost.");
        yield* c.say("k3.konec.06", "padly", "Ano, můj pane.", { at: rider });
        yield* c.cut(() => c.follow(radim));
        if (alive(c.actor("krystof"))) {
          const k = c.actor("krystof");
          k.x = 1250; k.y = 1240; k.order = null;
          c.faceEach(k, radim);
        }
        yield* c.say("k3.konec.07", "krystof", "Bože na nebesích... Ztratili jsme ho.");
        yield* c.say("k3.konec.08", "radim", "Ještě ne. Půjdu za ním až k té bráně. A když bude třeba, zavřu ji jeho vlastním mečem.");
        yield* c.fadeOut(1.2);
      });
      c.victory();
    }
  });

  /* ---------- IV. Brána pekel ---------- */
  CHAPTERS.push({
    id: "k4",
    num: "Kapitola IV",
    title: "Brána pekel",
    blurb: "Poslední bitva. Za horským valem stojí Nekropole, Morvan a padlý vojvoda Hostivít. Zničte Nekropoli a zavřete Bránu navždy.",
    map: "kampan-brana",
    roster: [{ slot: 0, name: "Radim" }, { slot: 1, name: "Nemrtví", ai: true }, { slot: 2, name: "Knížecí vojsko", ai: true }],
    phase: 0.5,
    winText: "Brána je zavřená. Goralie nezapomene.",
    *run(c) {
      const { me, foe, m } = c;
      c.gold(1000, 700);
      c.building("barracks", "me", 560, 1390);
      c.building("smithy", "me", 330, 1420);
      c.building("workshop", "me", 760, 1560);
      c.building("hut", "me", 300, 1660);
      c.building("hut", "me", 640, 1740);
      c.unit("worker", "me", 560, 1700);
      c.unit("worker", "me", 380, 1680);

      const radim = c.unit("knight", "me", 620, 1520, { as: "radim", hp: 4, facing: 1 });
      c.unit("archer", "me", 560, 1560, { as: "jitka", hp: 2.5, facing: 1 });
      c.unit("monk", "me", 560, 1480, { as: "krystof", hp: 2.5, facing: 1 });
      c.group("soldier", "me", 700, 1450, 4);
      c.group("knight", "me", 820, 1440, 3);
      c.group("archer", "me", 640, 1500, 2);
      c.unit("catapult", "me", 700, 1620, { facing: 1 });
      c.unit("catapult", "me", 760, 1660, { facing: 1 });

      const necro = m.hqOf(foe);
      const morvan = c.unit("lich", "foe", 1520, 560, { as: "morvan", hp: 2, facing: 1 });
      const fallenLord = c.unit("hero", "foe", 1440, 640, { as: "padly", hp: 6, facing: -1 });
      const horde = m.brains[foe];
      horde.waveT = 150;

      yield* c.cutscene(function* () {
        c.look(1480, 600, true);
        yield* c.title("Kapitola IV", "Brána pekel");
        yield* c.fadeIn(1.2);
        yield* c.narrate("k4.uvod.01", "Hostivít padl do tmy a Morvanovi zbýval jediný krok: otevřít Bránu dokořán.");
        c.faceEach(morvan, fallenLord);
        yield* c.say("k4.uvod.02", "morvan", "Slyšíš je, vojvodo? Tisíce mrtvých za Bránou. Čekají jen na tvůj rozkaz.");
        yield* c.say("k4.uvod.03", "padly", "Slyším jen jeden hlas. Kde je můj syn, Morvane?");
        yield* c.say("k4.uvod.04", "morvan", "Všude kolem tebe. V každém z nich je kousek Vratislava.");
        yield* c.cut(() => c.follow(radim));
        yield* c.say("k4.uvod.05", "radim", "Tady to skončí. Zničíme Nekropoli a Brána se zavře.");
        yield* c.say("k4.uvod.06", "krystof", "Morvanova moc proudí Nekropolí. Padne-li ona, padne i on.");
        yield* c.say("k4.uvod.07", "jitka", "A Hostivít?");
        yield* c.say("k4.uvod.08", "radim", "Ten si vybral. Ale jestli v něm zbyl aspoň kousek člověka, najdu ho.");
        yield* c.fadeOut(0.6);
        c.look(radim.x, radim.y - 120, true);
      });

      c.work();
      c.objective("nekropole", "Zničte Nekropoli");
      c.objective("vojvoda", "Poraz padlého vojvodu Hostivíta");
      c.objective("tabor", "Gmina tábora nesmí padnout");
      revive(c, ["radim", "jitka", "krystof"]);
      c.guard(() => !m.hqOf(me), "Tábor padl a Brána zůstala otevřená.", "tabor");
      c.note("Tip: katapulty z dílny boří pekelné budovy z dálky.");

      // Morvan se po smrti už nevrátí (jinak by Nekropole vyvolala nového licha)
      c.go((function* () {
        yield () => !alive(morvan);
        horde.lichT = 1e9;
        if (alive(necro)) yield* c.say("k4.boj.02", "hlas", "Moje tělo je jen schránka, rytíři! Dokud stojí Nekropole, já nezemřu!", { cam: false });
      })());

      // padlý vojvoda: když je skoro poražen, promluví naposledy
      c.go((function* () {
        yield () => !alive(fallenLord) || fallenLord.hp < fallenLord.maxHp * 0.25;
        if (alive(fallenLord)) {
          fallenLord.hp = Math.max(1, fallenLord.hp);
          yield* c.cutscene(function* () {
            c.follow(fallenLord);
            fallenLord.order = null;
            if (dist(radim, fallenLord) > 140) {
              radim.x = fallenLord.x - 70; radim.y = fallenLord.y + 10;
            }
            radim.order = null;
            c.faceEach(radim, fallenLord);
            yield 0.8;
            yield* c.say("k4.vojvoda.01", "padly", "Radime... Viděl jsem ho. Nebyl to on. Nikdy to nebyl on.");
            yield* c.say("k4.vojvoda.02", "radim", "Já vím, vojvodo. Už je konec. Odpočívej.");
            yield* c.say("k4.vojvoda.03", "padly", "Zavři tu bránu... a pohřbi mě v Hněvíně. Vedle syna.");
            c.kill(fallenLord, radim);
            yield 1.4;
          });
        }
        c.complete("vojvoda");
      })());

      yield () => !alive(necro);
      c.complete("nekropole");
      yield () => !alive(fallenLord);
      yield 1.5;

      yield* c.cutscene(function* () {
        yield* c.cut(() => {
          c.look(necro.x, necro.y + 120, true);
          for (const u of m.units) if (u.team === foe && alive(u)) c.kill(u);
          const j = c.actor("jitka");
          const k = c.actor("krystof");
          radim.x = necro.x - 40; radim.y = necro.y + 230; radim.order = null;
          if (alive(j)) { j.x = necro.x + 40; j.y = necro.y + 260; j.order = null; }
          if (alive(k)) { k.x = necro.x - 100; k.y = necro.y + 270; k.order = null; }
        }, 0.8);
        yield* c.narrate("k4.konec.01", "Nekropole se zřítila a z Brány vyšlehl poslední, zoufalý výkřik.");
        yield* c.say("k4.konec.02", "hlas", "Tohle... není konec... Goralie jednou zapomene... a já se vrátím...", { cam: false });
        c.phase(0.9, 6);
        c.follow(radim);
        yield* c.say("k4.konec.03", "krystof", "Brána je zavřená. Morvanův hlas utichl.");
        yield* c.say("k4.konec.04", "jitka", "Myslíš, že je pryč nadobro?");
        yield* c.say("k4.konec.05", "krystof", "Zlo nikdy neumírá nadobro. Jen čeká, až zapomeneme.");
        yield* c.say("k4.konec.06", "radim", "Tak nezapomeneme. Postavíme tu strážnici a každé jaro sem někdo přijde hlídat.");
        yield* c.narrate("k4.konec.07", "Tak skončila zima mrtvých. Hostivít spočinul v Hněvíně vedle svého syna. A Goralie nezapomněla.");
        yield* c.fadeOut(1.6);
      });
      c.victory();
    }
  });

  /* ---------- veřejné rozhraní ---------- */
  const compiled = new Map();

  function mapOf(ch) {
    if (!compiled.has(ch.map)) {
      const doc = PK.campaignMaps && PK.campaignMaps[ch.map];
      if (!doc) return null;
      compiled.set(ch.map, PK.maps.compileDoc(doc));
    }
    return compiled.get(ch.map);
  }

  const unlocked = ch => {
    const i = CHAPTERS.indexOf(ch);
    return i <= 0 || progress().done.includes(CHAPTERS[i - 1].id);
  };

  // Všechny repliky (pro scénář k namluvení): projde zdrojový text skriptů.
  function lines() {
    const out = [];
    // c.say("id", "kdo", "text"), c.narrate("id", "text") i řádky tabulek ["id", "kdo", "text"]
    const re = /(?:c\.(?:say|narrate)\(|\[)"(k\d\.[a-z0-9.]+)",\s*(?:"([a-z]+)",\s*)?"((?:[^"\\]|\\.)*)"/g;
    for (const ch of CHAPTERS) {
      const src = ch.run.toString();
      let mm;
      while ((mm = re.exec(src))) out.push({ chapter: ch.id, id: mm[1], who: mm[2] ? CAST[mm[2]].name : "Vypravěč", text: mm[3] });
    }
    return out;
  }

  CAST.vypravec = { name: "", type: "", side: "me" };

  PK.campaign = {
    chapters: CHAPTERS,
    cast: CAST,
    get: id => CHAPTERS.find(ch => ch.id === id) || null,
    next: ch => CHAPTERS[CHAPTERS.indexOf(ch) + 1] || null,
    mapOf,
    unlocked,
    done: ch => progress().done.includes(ch.id),
    markDone: ch => markDone(ch.id),
    start: (ch, game) => new Director(ch, game),
    stopVoice,
    lines,
    VOICED
  };
})();
