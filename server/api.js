/*
 * HTTP API účtů: přihlášení, profily hráčů a administrace. Relace je v HttpOnly cookie,
 * změny stavu vyžadují JSON a stejný Origin (ochrana proti CSRF).
 */
"use strict";

const { Limiter } = require("./accounts.js");
const { createOAuth } = require("./oauth.js");
const { cookie, parseCookies, clientIp, sameOrigin, sendJson, readJson } = require("./httputil.js");

const SID = "goralia_sid";
const PLAYER_LIMIT = 100;

function createApi({ accounts, stats, store, live, publicUrl }) {
  const passwordFails = new Limiter(10, 10 * 60 * 1000);

  const tokenOf = req => parseCookies(req.headers.cookie)[SID];
  const userOf = req => accounts.userFromToken(tokenOf(req));
  const sessionCookie = (req, token) => cookie(req, SID, token, { maxAge: accounts.SESSION_TTL / 1000 });
  const clearCookie = req => cookie(req, SID, "", { maxAge: 0 });

  function startSession(req, user) {
    const old = tokenOf(req);
    if (old) accounts.destroySession(old);
    return sessionCookie(req, accounts.createSession(user));
  }

  const oauth = createOAuth({ accounts, publicUrl, startSession });
  const clamp = (value, min, max, fallback) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };

  const fail = (ctx, status, error) => sendJson(ctx.res, status, { error });

  /* ---------- účet ---------- */
  const handlers = {
    me(ctx) {
      sendJson(ctx.res, 200, { user: ctx.user ? accounts.selfView(ctx.user) : null, providers: oauth.available() });
    },

    async register(ctx) {
      const result = await accounts.register(ctx.body, ctx.ip);
      if (result.error) return fail(ctx, result.limited ? 429 : 400, result.error);

      sendJson(ctx.res, 200, { user: accounts.selfView(result.user) }, { "Set-Cookie": startSession(ctx.req, result.user) });
    },

    async login(ctx) {
      const result = await accounts.login(ctx.body.identifier, ctx.body.password, ctx.ip);
      if (result.error) return fail(ctx, result.limited ? 429 : 401, result.error);

      sendJson(ctx.res, 200, { user: accounts.selfView(result.user) }, { "Set-Cookie": startSession(ctx.req, result.user) });
    },

    logout(ctx) {
      const token = tokenOf(ctx.req);
      if (token) accounts.destroySession(token);
      sendJson(ctx.res, 200, { ok: true }, { "Set-Cookie": clearCookie(ctx.req) });
    },

    rename(ctx) {
      const result = accounts.rename(ctx.user, ctx.body.name);
      if (result.error) return fail(ctx, 400, result.error);

      live.refreshUser(ctx.user);
      sendJson(ctx.res, 200, { user: accounts.selfView(ctx.user) });
    },

    async password(ctx) {
      const key = String(ctx.user.id);
      if (passwordFails.blocked(key)) return fail(ctx, 429, "Příliš mnoho pokusů. Zkus to za chvíli.");

      const result = await accounts.changePassword(ctx.user, ctx.body.current, ctx.body.next, tokenOf(ctx.req));
      if (result.error) {
        passwordFails.add(key);
        return fail(ctx, 400, result.error);
      }

      passwordFails.clear(key);
      sendJson(ctx.res, 200, { user: accounts.selfView(ctx.user) });
    },

    /* ---------- profily ---------- */
    players(ctx) {
      const list = accounts.leaderboard({ q: ctx.query.get("q") || "", limit: clamp(ctx.query.get("limit"), 1, PLAYER_LIMIT, 50) });
      sendJson(ctx.res, 200, { players: list.map(p => ({ ...p, online: live.isOnline(p.id) })) });
    },

    player(ctx) {
      const user = accounts.getUser(ctx.params[0]);
      if (!user) return fail(ctx, 404, "Hráč neexistuje.");

      const viewer = ctx.user && ctx.user.role === "admin";

      sendJson(ctx.res, 200, {
        player: {
          id: user.id, name: user.name, admin: user.role === "admin", created: user.created, lastSeen: user.lastSeen,
          online: live.isOnline(user.id), banned: viewer ? !!user.banned : undefined,
          stats: user.stats, recent: stats.recentFor(user.id, 15)
        }
      });
    },

    /* ---------- administrace ---------- */
    overview(ctx) {
      const mem = process.memoryUsage();
      sendJson(ctx.res, 200, {
        uptime: Math.round(process.uptime()), node: process.version, rss: mem.rss, heap: mem.heapUsed,
        ...accounts.counts(), ...live.counts(), providers: oauth.available(), publicUrl: publicUrl || ""
      });
    },

    users(ctx) {
      const q = ctx.query;
      const result = accounts.listUsers({ q: q.get("q") || "", offset: clamp(q.get("offset"), 0, 1e6, 0), limit: clamp(q.get("limit"), 1, 200, 50) });
      sendJson(ctx.res, 200, { ...result, online: result.users.map(u => live.isOnline(u.id)) });
    },

    ban(ctx) {
      const banned = ctx.body.banned !== false;
      const result = accounts.setBanned(ctx.user, ctx.params[0], banned, ctx.body.reason);
      if (result.error) return fail(ctx, 400, result.error);

      if (banned) live.kickUser(result.user.id, "Tvůj účet byl zablokován.");
      sendJson(ctx.res, 200, { user: accounts.adminView(result.user) });
    },

    role(ctx) {
      const result = accounts.setRole(ctx.user, ctx.params[0], ctx.body.role);
      if (result.error) return fail(ctx, 400, result.error);

      live.refreshUser(result.user);
      sendJson(ctx.res, 200, { user: accounts.adminView(result.user) });
    },

    async resetPassword(ctx) {
      const result = await accounts.resetPassword(ctx.user, ctx.params[0]);
      if (result.error) return fail(ctx, 400, result.error);

      live.kickUser(result.user.id, "Heslo bylo změněno, přihlas se znovu.");
      sendJson(ctx.res, 200, { user: accounts.adminView(result.user), password: result.password });
    },

    deleteUser(ctx) {
      const result = accounts.deleteUser(ctx.user, ctx.params[0]);
      if (result.error) return fail(ctx, 400, result.error);

      live.kickUser(result.user.id, "Tvůj účet byl smazán.");
      sendJson(ctx.res, 200, { ok: true });
    },

    rooms(ctx) {
      sendJson(ctx.res, 200, { rooms: live.rooms() });
    },

    closeRoom(ctx) {
      if (!live.closeRoom(Number(ctx.params[0]), ctx.user)) return fail(ctx, 404, "Místnost neexistuje.");
      sendJson(ctx.res, 200, { ok: true });
    },

    clients(ctx) {
      sendJson(ctx.res, 200, { clients: live.clients() });
    },

    kick(ctx) {
      if (!live.kickClient(Number(ctx.params[0]), ctx.user)) return fail(ctx, 404, "Klient neexistuje.");
      sendJson(ctx.res, 200, { ok: true });
    },

    matches(ctx) {
      const limit = clamp(ctx.query.get("limit"), 1, 100, 30);
      const list = store.data.matches.slice(-limit).reverse().map(m => ({
        id: m.id, ended: m.ended, map: m.map, duration: m.duration, reason: m.reason, humans: m.humans, ais: m.ais,
        players: m.players.map(p => ({ name: p.name, userId: p.userId, ai: p.ai, result: p.result }))
      }));
      sendJson(ctx.res, 200, { matches: list });
    },

    audit(ctx) {
      sendJson(ctx.res, 200, { audit: store.data.audit.slice(-100).reverse() });
    }
  };

  const routes = [
    ["GET", /^\/api\/me$/, "none", handlers.me],
    ["POST", /^\/api\/auth\/register$/, "none", handlers.register],
    ["POST", /^\/api\/auth\/login$/, "none", handlers.login],
    ["POST", /^\/api\/auth\/logout$/, "none", handlers.logout],
    ["POST", /^\/api\/me\/name$/, "user", handlers.rename],
    ["POST", /^\/api\/me\/password$/, "user", handlers.password],
    ["GET", /^\/api\/players$/, "none", handlers.players],
    ["GET", /^\/api\/players\/(\d{1,9})$/, "none", handlers.player],
    ["GET", /^\/api\/admin\/overview$/, "admin", handlers.overview],
    ["GET", /^\/api\/admin\/users$/, "admin", handlers.users],
    ["POST", /^\/api\/admin\/users\/(\d{1,9})\/ban$/, "admin", handlers.ban],
    ["POST", /^\/api\/admin\/users\/(\d{1,9})\/role$/, "admin", handlers.role],
    ["POST", /^\/api\/admin\/users\/(\d{1,9})\/password$/, "admin", handlers.resetPassword],
    ["DELETE", /^\/api\/admin\/users\/(\d{1,9})$/, "admin", handlers.deleteUser],
    ["GET", /^\/api\/admin\/rooms$/, "admin", handlers.rooms],
    ["POST", /^\/api\/admin\/rooms\/(\d{1,9})\/close$/, "admin", handlers.closeRoom],
    ["GET", /^\/api\/admin\/clients$/, "admin", handlers.clients],
    ["POST", /^\/api\/admin\/clients\/(\d{1,9})\/kick$/, "admin", handlers.kick],
    ["GET", /^\/api\/admin\/matches$/, "admin", handlers.matches],
    ["GET", /^\/api\/admin\/audit$/, "admin", handlers.audit]
  ];

  // Vrací true, pokud požadavek patří API nebo přihlášení přes poskytovatele.
  function handle(req, res, pathname, query) {
    if (oauth.handle(req, res, pathname, query)) return true;
    if (!pathname.startsWith("/api/")) return false;

    const matched = routes.filter(r => r[1].test(pathname));
    if (!matched.length) {
      sendJson(res, 404, { error: "Nenalezeno." });
      return true;
    }

    const route = matched.find(r => r[0] === req.method);
    if (!route) {
      sendJson(res, 405, { error: "Nepodporovaná metoda." });
      return true;
    }

    run(route, req, res, query, route[1].exec(pathname).slice(1)).catch(err => {
      if (res.headersSent) return res.end();
      if (err && err.status) return sendJson(res, err.status, { error: err.message }, err.status === 413 ? { Connection: "close" } : {});
      console.error(err);
      sendJson(res, 500, { error: "Chyba serveru." });
    });

    return true;
  }

  async function run([method, , auth, fn], req, res, query, params) {
    const ctx = { req, res, query, params, ip: clientIp(req), user: userOf(req), body: {} };

    if (auth !== "none" && !ctx.user) return fail(ctx, 401, "Nejsi přihlášený.");
    if (auth === "admin" && ctx.user.role !== "admin") return fail(ctx, 403, "Chybí oprávnění.");

    if (method !== "GET") {
      if (!sameOrigin(req, publicUrl)) return fail(ctx, 403, "Požadavek z cizí stránky.");
      if (!/^application\/json/.test(req.headers["content-type"] || "")) return fail(ctx, 415, "Očekává se JSON.");
      ctx.body = await readJson(req);
    }

    await fn(ctx);
  }

  return { handle, userOf, tokenOf };
}

module.exports = { createApi, SID };
