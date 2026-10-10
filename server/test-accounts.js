/*
 * Testy účtů: úložiště, registrace, přihlášení, relace, OAuth (s podvrženým poskytovatelem),
 * statistiky, správa hráčů adminem a HTTP API spuštěného serveru.
 * Spuštění: node server/test-accounts.js (součástí `npm test`)
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");
const { createStore } = require("./store.js");
const { createAccounts } = require("./accounts.js");
const { createStats, MIN_DURATION } = require("./stats.js");
const { createOAuth } = require("./oauth.js");

const ADMIN_EMAIL = "info@jirisikora.cz";
const ADMIN_PASSWORD = "test-admin-heslo";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/* ---------- účty, relace, statistiky (bez serveru) ---------- */
async function testAccounts() {
  const dir = tmp("goralia-acc-");
  const store = createStore(dir);
  const accounts = createAccounts(store, { adminName: "Jurek", adminEmail: ADMIN_EMAIL });
  const stats = createStats(store);

  // admin se založí jednou; heslo je zvolené, nebo náhodné
  const seed = await accounts.seedAdmin(ADMIN_PASSWORD);
  assert(seed && seed.user.role === "admin" && seed.user.name === "Jurek" && seed.user.email === ADMIN_EMAIL);
  assert.strictEqual(seed.generated, false);
  assert.strictEqual(await accounts.seedAdmin(), null, "druhé založení nic nedělá");

  const other = createAccounts(createStore(tmp("goralia-acc-")), {});
  const generated = await other.seedAdmin();
  assert(generated.generated && generated.password.length === 16, "náhodné heslo");
  await assert.rejects(() => createAccounts(createStore(tmp("goralia-acc-")), {}).seedAdmin("krátké"), /Heslo musí mít/, "slabé heslo admina");

  // registrace: neplatné vstupy
  const bad = async (input, pattern) => {
    const result = await accounts.register({ email: "x@example.com", password: "heslo-1234", ...input }, "9.9.9.9");
    assert(result.error && pattern.test(result.error), `${JSON.stringify(input)} -> ${result.error}`);
  };

  await bad({ name: "ab" }, /Přezdívka/);
  await bad({ name: "Žába" }, /Přezdívka/);
  await bad({ name: "Jurek" }, /vyhrazená/);
  await bad({ name: "Ju rek" }, /vyhrazená/);
  await bad({ name: "Admin" }, /vyhrazená/);
  await bad({ name: "AI Modra" }, /vyhrazená/);
  await bad({ name: "Karel", email: "neni-email" }, /e-mail/);
  await bad({ name: "Karel", email: ADMIN_EMAIL }, /zaregistrovaný/);
  await bad({ name: "Karel", password: "kratke" }, /aspoň 8/);
  await bad({ name: "Karel-Novak", password: "Karel-Novak" }, /stejné/);

  const karel = (await accounts.register({ name: "Karel", email: "Karel@Example.com", password: "heslo-1234" }, "9.9.9.9")).user;
  assert(karel && karel.email === "karel@example.com", "e-mail se ukládá malými písmeny");
  assert(karel.passHash.startsWith("scrypt$") && !karel.passHash.includes("heslo-1234"), "heslo je jen jako hash");
  await bad({ name: "karel", email: "jiny@example.com" }, /obsazená/);
  await bad({ name: "Jiny", email: "KAREL@example.com" }, /zaregistrovaný/);

  // přihlášení jménem i e-mailem
  assert.strictEqual((await accounts.login("kAREL", "heslo-1234", "1.1.1.1")).user, karel);
  assert.strictEqual((await accounts.login("karel@EXAMPLE.com", "heslo-1234", "1.1.1.1")).user, karel);
  assert((await accounts.login("Karel", "spatne-heslo", "1.1.1.1")).error);
  assert.strictEqual((await accounts.login("Jurek", ADMIN_PASSWORD, "1.1.1.1")).user.role, "admin");
  assert.strictEqual((await accounts.login(ADMIN_EMAIL, ADMIN_PASSWORD, "1.1.1.1")).user.name, "Jurek");

  // omezení pokusů o uhádnutí hesla
  for (let i = 0; i < 8; i++) assert(!(await accounts.login("Nikdo", "x", `2.2.2.${i}`)).limited, `pokus ${i}`);
  assert((await accounts.login("Nikdo", "x", "2.2.2.99")).limited, "po 8 neúspěších se přihlášení jménem zablokuje");
  assert.strictEqual((await accounts.login("Karel", "heslo-1234", "3.3.3.3")).user, karel, "ostatní účty nejsou dotčené");

  // relace: token se neukládá, vyprší, jde zrušit
  const token = accounts.createSession(karel);
  assert.strictEqual(token.length, 64);
  assert.strictEqual(accounts.userFromToken(token), karel);
  assert(!(token in store.data.sessions), "ukládá se jen hash tokenu");
  assert.strictEqual(accounts.userFromToken("x".repeat(64)), null);
  accounts.destroySession(token);
  assert.strictEqual(accounts.userFromToken(token), null);

  const expiring = accounts.createSession(karel);
  Object.values(store.data.sessions).forEach(s => { s.expires = 1; });
  assert.strictEqual(accounts.userFromToken(expiring), null, "vypršelá relace");

  // přezdívka a heslo
  assert.strictEqual(accounts.rename(karel, "Karel2").user.name, "Karel2");
  assert(/jednou za hodinu/.test(accounts.rename(karel, "Karel3").error));
  karel.nameChanged = 0;
  assert(accounts.rename(karel, "Jurek").error, "rezervované jméno nejde převzít");
  assert.strictEqual(accounts.rename(karel, "Karel").user.name, "Karel");

  const keep = accounts.createSession(karel);
  const drop = accounts.createSession(karel);
  assert((await accounts.changePassword(karel, "spatne", "nove-heslo-1", keep)).error);
  assert((await accounts.changePassword(karel, "heslo-1234", "krátké", keep)).error);
  assert(!(await accounts.changePassword(karel, "heslo-1234", "nove-heslo-1", keep)).error);
  assert.strictEqual(accounts.userFromToken(keep), karel, "aktuální relace přežije změnu hesla");
  assert.strictEqual(accounts.userFromToken(drop), null, "ostatní relace se zruší");
  assert((await accounts.login("Karel", "heslo-1234", "1.1.1.1")).error);
  assert((await accounts.login("Karel", "nove-heslo-1", "1.1.1.1")).user);

  // přihlášení přes poskytovatele
  const g1 = accounts.loginWithProvider("google", { id: "g-1", email: "novy@example.com", emailVerified: true, name: "Žluťoučký Kůň" });
  assert(g1.created && g1.user.name === "Zlutoucky Kun" && g1.user.email === "novy@example.com");
  assert.strictEqual(g1.user.passHash, null, "účet z poskytovatele nemá heslo");
  const g2 = accounts.loginWithProvider("google", { id: "g-1", email: "novy@example.com", emailVerified: true, name: "Jiné jméno" });
  assert(!g2.created && g2.user === g1.user, "stejná identita je stejný účet");

  const imposter = accounts.loginWithProvider("facebook", { id: "f-1", name: "Jurek" });
  assert(/^Jurek\d+$/.test(imposter.user.name) && imposter.user.role === "user", "jméno admina se nezíská ani přes Facebook");
  assert.strictEqual(imposter.user.email, null);

  const unverified = accounts.loginWithProvider("google", { id: "g-2", email: ADMIN_EMAIL, emailVerified: false, name: "Neověřený" });
  assert(unverified.created && unverified.user.role === "user" && unverified.user.email === null, "neověřený e-mail admina nic neotevře");

  const adminGoogle = accounts.loginWithProvider("google", { id: "g-3", email: ADMIN_EMAIL, emailVerified: true, name: "Jiří" });
  assert(!adminGoogle.created && adminGoogle.user.role === "admin" && adminGoogle.user.google === "g-3", "ověřený Google e-mail se propojí s adminem");
  assert.strictEqual(accounts.loginWithProvider("google", { id: "g-3", name: "x" }).user.role, "admin");

  const sameEmail = accounts.loginWithProvider("google", { id: "g-4", email: "karel@example.com", emailVerified: true, name: "Karel" });
  assert(sameEmail.created && sameEmail.user !== karel && sameEmail.user.email === null && karel.google === null, "účet s heslem se přes e-mail nepřevezme");
  assert(accounts.loginWithProvider("twitter", { id: "1" }).error, "neznámý poskytovatel");

  // správa hráčů adminem
  const admin = seed.user;
  assert(/Na vlastním účtu/.test(accounts.setBanned(admin, admin.id, true).error));
  assert(/Na vlastním účtu/.test(accounts.setRole(admin, admin.id, "user").error));
  assert(/Na vlastním účtu/.test(accounts.deleteUser(admin, admin.id).error));
  assert(accounts.setBanned(admin, 9999, true).error);

  accounts.createSession(karel);
  assert.strictEqual(accounts.setBanned(admin, karel.id, true, "spam").user.banned.reason, "spam");
  assert(/zablokovaný: spam/.test((await accounts.login("Karel", "nove-heslo-1", "1.1.1.1")).error));
  assert(!Object.values(store.data.sessions).some(s => s.userId === karel.id), "ban ruší relace");
  assert.strictEqual(accounts.setBanned(admin, karel.id, false).user.banned, null);

  assert.strictEqual(accounts.setRole(admin, karel.id, "admin").user.role, "admin");
  assert(/zbav role/.test(accounts.setBanned(admin, karel.id, true).error), "admina nejde zablokovat bez odebrání role");
  assert(/zbav role/.test(accounts.deleteUser(admin, karel.id).error));
  assert(accounts.setRole(admin, karel.id, "superadmin").error);
  assert.strictEqual(accounts.setRole(admin, karel.id, "user").user.role, "user");

  const reset = await accounts.resetPassword(admin, karel.id);
  assert.strictEqual(reset.password.length, 16);
  assert((await accounts.login("Karel", "nove-heslo-1", "1.1.1.1")).error);
  assert((await accounts.login("Karel", reset.password, "1.1.1.1")).user);

  const found = accounts.listUsers({ q: "zlutou" });
  assert.strictEqual(found.total, 1);
  assert(!JSON.stringify(found).includes("scrypt"), "výpis nikdy neobsahuje hash hesla");

  assert(accounts.deleteUser(admin, karel.id).user);
  assert.strictEqual(accounts.getUser(karel.id), null);
  assert((await accounts.register({ name: "Karel", email: "karel@example.com", password: "heslo-1234" }, "9.9.9.9")).user, "jméno a e-mail se uvolní");

  // statistiky
  const pat = (await accounts.register({ name: "Pat", email: "pat@example.com", password: "heslo-1234" }, "8.8.8.8")).user;
  const mat = (await accounts.register({ name: "Mat", email: "mat@example.com", password: "heslo-1234" }, "8.8.8.8")).user;
  const duel = (duration, winner, reason = "hq") => stats.record({
    map: "valley", duration, reason, winner,
    players: [
      { slot: 0, userId: pat.id, name: "Pat", ai: false, stats: { kills: 5, gold: 100, heroLevel: 3, trained: 4 } },
      { slot: 1, userId: mat.id, name: "Mat", ai: false, stats: { kills: 2, gold: 50 } }
    ]
  });

  assert.strictEqual(duel(MIN_DURATION - 1, 0), null, "příliš krátký zápas se nezapíše");
  assert(duel(120, 0));
  duel(90, -1);
  duel(60, -1, "abandoned");
  stats.record({
    map: "valley", duration: 100, reason: "hq", winner: 1,
    players: [{ slot: 0, userId: pat.id, name: "Pat", ai: false, stats: {} }, { slot: 1, userId: null, name: "AI Rudá", ai: true, stats: {} }]
  });

  const ps = pat.stats;
  assert.deepStrictEqual([ps.games, ps.wins, ps.draws, ps.losses], [4, 1, 1, 2]);
  assert.deepStrictEqual([ps.pvpGames, ps.pvpWins], [3, 1], "proti AI se do PvP nepočítá");
  assert.strictEqual(ps.kills, 15);
  assert.strictEqual(ps.gold, 300);
  assert.strictEqual(ps.heroLevel, 3);
  assert.strictEqual(ps.trained, 12);
  assert.strictEqual(ps.playSeconds, 120 + 90 + 60 + 100);
  assert.deepStrictEqual(ps.byMap.valley, { games: 4, wins: 1 });
  assert.deepStrictEqual([mat.stats.games, mat.stats.wins, mat.stats.losses, mat.stats.draws], [3, 0, 2, 1]);

  const recent = stats.recentFor(pat.id, 2);
  assert.strictEqual(recent.length, 2);
  assert.strictEqual(recent[0].result, "loss", "nejnovější první");
  assert.strictEqual(recent[0].pvp, false);
  assert.strictEqual(accounts.leaderboard()[0].name, "Pat");
  assert.deepStrictEqual(accounts.leaderboard({ q: "ma" }).map(p => p.name), ["Mat"]);

  // trvalé uložení
  store.flush();
  const raw = fs.readFileSync(store.file, "utf8");
  assert(!raw.includes("heslo-1234") && !raw.includes(ADMIN_PASSWORD), "v databázi není heslo v čitelné podobě");
  if (process.platform !== "win32") assert.strictEqual(fs.statSync(store.file).mode & 0o077, 0, "soubor čte jen vlastník");

  const reopened = createAccounts(createStore(dir), { adminName: "Jurek", adminEmail: ADMIN_EMAIL });
  assert.strictEqual((await reopened.login("Pat", "heslo-1234", "7.7.7.7")).user.stats.games, 4);
  assert.strictEqual(await reopened.seedAdmin(), null, "admin přežije restart");

  fs.rmSync(dir, { recursive: true, force: true });
}

/* ---------- OAuth s podvrženým poskytovatelem ---------- */
async function testOAuth() {
  const dir = tmp("goralia-oauth-");
  const store = createStore(dir);
  const accounts = createAccounts(store, { adminName: "Jurek", adminEmail: ADMIN_EMAIL });

  process.env.GOOGLE_CLIENT_ID = "gid";
  process.env.GOOGLE_CLIENT_SECRET = "gsecret";
  delete process.env.FACEBOOK_APP_ID;
  delete process.env.FACEBOOK_APP_SECRET;

  const calls = [];
  let failToken = false;
  const warn = console.warn;
  console.warn = () => {}; // selžení poskytovatele se loguje, v testu je to účelově

  const fetchJson = async (url, options = {}) => {
    calls.push({ url, ...options });
    if (url.startsWith("https://oauth2.googleapis.com/token")) return failToken ? { status: 400, json: { error: "invalid_grant" } } : { status: 200, json: { access_token: "AT" } };
    if (url.startsWith("https://openidconnect.googleapis.com/")) return { status: 200, json: { sub: "sub-777", email: "oauth@example.com", email_verified: true, name: "Oauth User" } };
    return { status: 500, json: {} };
  };

  const oauth = createOAuth({
    accounts,
    publicUrl: "https://goralia.test/",
    startSession: (req, user) => `goralia_sid=${accounts.createSession(user)}; Path=/`,
    fetchJson
  });

  assert.deepStrictEqual(oauth.available(), { google: true, facebook: false });

  const call = pathAndQuery => withCookie(pathAndQuery);

  const withCookie = (pathAndQuery, cookie) => new Promise(resolve => {
    const [pathname, query] = pathAndQuery.split("?");
    const req = { method: "GET", headers: { host: "goralia.test", "x-forwarded-proto": "https", ...(cookie ? { cookie } : {}) }, socket: {} };
    const res = {
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end() { resolve({ status: this.status, headers: this.headers }); }
    };

    assert(oauth.handle(req, res, pathname, new URLSearchParams(query || "")), "cesta patří přihlášení");
  });

  async function begin() {
    const res = await call("/auth/google");
    assert.strictEqual(res.status, 302);
    const url = new URL(res.headers.Location);
    assert.strictEqual(`${url.origin}${url.pathname}`, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.strictEqual(url.searchParams.get("client_id"), "gid");
    assert.strictEqual(url.searchParams.get("redirect_uri"), "https://goralia.test/auth/google/callback");
    assert.strictEqual(url.searchParams.get("response_type"), "code");
    assert(url.searchParams.get("scope").includes("openid"));

    const state = url.searchParams.get("state");
    assert.strictEqual(state.length, 48);

    const setCookie = res.headers["Set-Cookie"];
    assert(setCookie.startsWith(`goralia_oauth=${state}`) && /HttpOnly/.test(setCookie) && /SameSite=Lax/.test(setCookie) && /Secure/.test(setCookie), setCookie);
    return state;
  }

  assert.strictEqual((await call("/auth/facebook")).headers.Location, "/?login=unavailable", "nenastavený poskytovatel");

  // státní ochrana proti podvržení: špatný state, cizí cookie, odmítnutí
  assert.strictEqual((await withCookie("/auth/google/callback?code=abc&state=zle", "goralia_oauth=zle")).headers.Location, "/?login=failed");

  let state = await begin();
  assert.strictEqual((await withCookie(`/auth/google/callback?code=abc&state=${state}`, "goralia_oauth=jiny")).headers.Location, "/?login=failed", "cookie nesedí se state");

  state = await begin();
  assert.strictEqual((await withCookie(`/auth/google/callback?error=access_denied&state=${state}`, `goralia_oauth=${state}`)).headers.Location, "/?login=denied");
  assert.strictEqual(calls.length, 0, "bez platného state se poskytovatel nevolá");

  // úspěšné přihlášení založí účet a relaci
  state = await begin();
  const first = await withCookie(`/auth/google/callback?code=THECODE&state=${state}`, `goralia_oauth=${state}`);
  assert.strictEqual(first.headers.Location, "/?login=new");
  const cookies = [].concat(first.headers["Set-Cookie"]);
  assert(cookies.some(c => c.startsWith("goralia_oauth=;") && /Max-Age=0/.test(c)), "state cookie se smaže");
  const sid = cookies.find(c => c.startsWith("goralia_sid="));
  assert(sid, "vznikla relace");
  assert.strictEqual(accounts.userFromToken(sid.split(";")[0].split("=")[1]).google, "sub-777");

  const exchange = calls[0];
  assert.strictEqual(exchange.method, "POST");
  assert(exchange.body.includes("code=THECODE") && exchange.body.includes("client_secret=gsecret") && exchange.body.includes(encodeURIComponent("https://goralia.test/auth/google/callback")), exchange.body);
  assert.strictEqual(calls[1].headers.Authorization, "Bearer AT");

  assert.strictEqual((await withCookie(`/auth/google/callback?code=THECODE&state=${state}`, `goralia_oauth=${state}`)).headers.Location, "/?login=failed", "state jde použít jen jednou");

  state = await begin();
  assert.strictEqual((await withCookie(`/auth/google/callback?code=X&state=${state}`, `goralia_oauth=${state}`)).headers.Location, "/?login=ok", "druhé přihlášení už je do existujícího účtu");
  assert.strictEqual(accounts.counts().users, 1);

  state = await begin();
  failToken = true;
  assert.strictEqual((await withCookie(`/auth/google/callback?code=X&state=${state}`, `goralia_oauth=${state}`)).headers.Location, "/?login=failed", "poskytovatel odmítl kód");
  failToken = false;
  console.warn = warn;

  accounts.getUser(1).banned = { at: Date.now(), reason: "" };
  state = await begin();
  assert.strictEqual((await withCookie(`/auth/google/callback?code=X&state=${state}`, `goralia_oauth=${state}`)).headers.Location, "/?login=banned");

  fs.rmSync(dir, { recursive: true, force: true });
}

/* ---------- HTTP API spuštěného serveru ---------- */
const PORT = 3600 + Math.floor(Math.random() * 300);

function request(method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body);
    const req = http.request({ host: "localhost", port: PORT, path: p, method, headers: { "Content-Type": "application/json", ...headers } }, res => {
      let text = "";
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* není JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    req.end(data);
  });
}

function socket(cookie) {
  const ws = new WebSocket(`ws://localhost:${PORT}`, { headers: cookie ? { Cookie: cookie } : {} });
  const s = { ws, hello: null, errors: [], room: null, closed: false };
  ws.on("message", data => {
    const m = JSON.parse(data);
    if (m.t === "hello") s.hello = m;
    if (m.t === "error") s.errors.push(m.text);
    if (m.t === "room") s.room = m;
  });
  ws.on("close", () => { s.closed = true; });
  return s;
}

async function until(fn, label, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return;
    await sleep(25);
  }
  throw new Error(`Timeout: ${label}`);
}

async function testServerApi() {
  const dataDir = tmp("goralia-api-");
  const proc = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      GORALIA_DATA_DIR: dataDir,
      GORALIA_MAPS_DIR: tmp("goralia-maps-"),
      GORALIA_ADMIN_PASSWORD: ADMIN_PASSWORD,
      PUBLIC_URL: `http://localhost:${PORT}`,
      GOOGLE_CLIENT_ID: "gid",
      GOOGLE_CLIENT_SECRET: "gsecret",
      FACEBOOK_APP_ID: "fid",
      FACEBOOK_APP_SECRET: "fsecret"
    },
    stdio: ["ignore", "pipe", "inherit"]
  });

  const sockets = [];
  const open = cookie => {
    const s = socket(cookie);
    sockets.push(s);
    return s;
  };

  try {
    await new Promise(resolve => {
      let out = "";
      proc.stdout.on("data", chunk => {
        out += chunk;
        if (out.includes("běží na")) resolve();
      });
    });

    const cookieOf = res => res.headers["set-cookie"][0].split(";")[0];
    const register = async (name, extra = {}) => {
      const res = await request("POST", "/api/auth/register", { name, email: `${name.toLowerCase()}@example.com`, password: "heslo-1234", ...extra });
      assert.strictEqual(res.status, 200, `${name}: ${res.text}`);
      return { res, cookie: cookieOf(res), id: res.json.user.id };
    };
    const as = cookie => ({ Cookie: cookie });

    // stránky: panel serveru nevidí nikdo kromě admina
    assert.strictEqual((await request("GET", "/admin")).status, 404);
    assert.strictEqual((await request("GET", "/admin.html")).status, 404);
    assert.strictEqual((await request("GET", "/js/admin.js")).status, 200);
    assert.strictEqual((await request("GET", "/")).headers["x-frame-options"], "DENY");

    const anon = await request("GET", "/api/me");
    assert.deepStrictEqual(anon.json, { user: null, providers: { google: true, facebook: true } });
    assert.strictEqual((await request("GET", "/api/neexistuje")).status, 404);
    assert.strictEqual((await request("PUT", "/api/me")).status, 405);

    // registrace a cookie
    const eve = await register("Eve");
    const flags = eve.res.headers["set-cookie"][0];
    assert(/HttpOnly/.test(flags) && /SameSite=Lax/.test(flags) && /Path=\//.test(flags) && !/Secure/.test(flags), flags);
    assert(!JSON.stringify(eve.res.json).includes("scrypt"));

    const proxied = await request("POST", "/api/auth/login", { identifier: "eve@example.com", password: "heslo-1234" }, { "X-Forwarded-Proto": "https" });
    assert(/Secure/.test(proxied.headers["set-cookie"][0]), "za HTTPS proxy je cookie Secure");

    const me = await request("GET", "/api/me", undefined, as(eve.cookie));
    assert.strictEqual(me.json.user.name, "Eve");
    assert.strictEqual(me.json.user.role, "user");
    assert(!me.text.includes("scrypt") && !me.text.includes("passHash"));

    // ochrana: cizí Origin, špatný typ obsahu, neplatný a obří JSON
    const evil = await request("POST", "/api/auth/register", { name: "Evil", email: "evil@example.com", password: "heslo-1234" }, { Origin: "http://evil.example" });
    assert.strictEqual(evil.status, 403);
    assert.strictEqual((await request("POST", "/api/auth/login", {}, { "Content-Type": "text/plain" })).status, 415);
    assert.strictEqual((await request("POST", "/api/auth/login", "{nejson")).status, 400);
    assert.strictEqual((await request("POST", "/api/auth/login", JSON.stringify({ identifier: "x".repeat(40000) }))).status, 413);
    assert.strictEqual((await request("POST", "/api/auth/login", { identifier: "Eve", password: "heslo-1234" }, { Origin: `http://localhost:${PORT}` })).status, 200, "vlastní Origin projde");
    assert.strictEqual((await request("POST", "/api/me/name", { name: "Evil" }, { Origin: "http://evil.example", ...as(eve.cookie) })).status, 403, "změna účtu z cizí stránky");

    // přihlášení: špatné heslo, rezervace jména, omezení pokusů
    assert.strictEqual((await request("POST", "/api/auth/login", { identifier: "Eve", password: "spatne" })).status, 401);
    assert.strictEqual((await request("POST", "/api/auth/register", { name: "Jurek", email: "x@example.com", password: "heslo-1234" })).status, 400, "jméno admina je rezervované");
    assert.strictEqual((await request("POST", "/api/auth/register", { name: "Zkus", email: ADMIN_EMAIL, password: "heslo-1234" })).status, 400, "e-mail admina je rezervovaný");

    let limited = 0;
    for (let i = 0; i < 10; i++) if ((await request("POST", "/api/auth/login", { identifier: "NoSuchUser", password: "x" })).status === 429) limited++;
    assert(limited >= 2, "po 8 neúspěších je 429");

    // přezdívka a heslo
    assert.strictEqual((await request("POST", "/api/me/name", { name: "Frank" })).status, 401, "bez přihlášení");
    const frank = await register("Frank");
    assert.strictEqual((await request("POST", "/api/me/name", { name: "Frank" }, as(eve.cookie))).status, 400, "jméno je obsazené");
    const renamed = await request("POST", "/api/me/name", { name: "Eve2" }, as(eve.cookie));
    assert.strictEqual(renamed.json.user.name, "Eve2");
    assert.strictEqual((await request("POST", "/api/me/name", { name: "Eve3" }, as(eve.cookie))).status, 400, "jen jednou za hodinu");

    const second = cookieOf(await request("POST", "/api/auth/login", { identifier: "Eve2", password: "heslo-1234" }));
    assert.strictEqual((await request("POST", "/api/me/password", { current: "spatne", next: "nove-heslo-9" }, as(eve.cookie))).status, 400);
    assert.strictEqual((await request("POST", "/api/me/password", { current: "heslo-1234", next: "nove-heslo-9" }, as(eve.cookie))).status, 200);
    assert.strictEqual((await request("GET", "/api/me", undefined, as(second))).json.user, null, "ostatní zařízení se odhlásí");
    assert.strictEqual((await request("GET", "/api/me", undefined, as(eve.cookie))).json.user.name, "Eve2");
    assert.strictEqual((await request("POST", "/api/auth/login", { identifier: "Eve2", password: "heslo-1234" })).status, 401);

    // profily a hledání
    const found = await request("GET", "/api/players?q=eve");
    assert.deepStrictEqual(found.json.players.map(p => p.name), ["Eve2"]);
    assert.strictEqual((await request("GET", "/api/players")).json.players.length, 0, "žebříček je prázdný, dokud nikdo nehrál");
    const profile = await request("GET", `/api/players/${eve.id}`);
    assert.strictEqual(profile.json.player.stats.games, 0);
    assert(!profile.text.includes("@") && profile.json.player.banned === undefined);
    assert.strictEqual((await request("GET", "/api/players/99999")).status, 404);
    assert.strictEqual((await request("GET", "/api/players/abc")).status, 404);

    // přihlášení přes poskytovatele: přesměrování, ochrana state
    const google = await new Promise((resolve, reject) => {
      http.get({ host: "localhost", port: PORT, path: "/auth/google" }, res => { res.resume(); resolve(res); }).on("error", reject);
    });
    assert.strictEqual(google.statusCode, 302);
    const target = new URL(google.headers.location);
    assert.strictEqual(target.host, "accounts.google.com");
    assert.strictEqual(target.searchParams.get("redirect_uri"), `http://localhost:${PORT}/auth/google/callback`);
    assert(/^goralia_oauth=[0-9a-f]{48}/.test(google.headers["set-cookie"][0]));
    const forged = await new Promise((resolve, reject) => {
      http.get({ host: "localhost", port: PORT, path: "/auth/google/callback?code=x&state=zle" }, res => { res.resume(); resolve(res); }).on("error", reject);
    });
    assert.strictEqual(forged.headers.location, "/?login=failed");

    /* ----- administrace ----- */
    assert.strictEqual((await request("GET", "/api/admin/overview")).status, 401);
    assert.strictEqual((await request("GET", "/api/admin/overview", undefined, as(eve.cookie))).status, 403);
    assert.strictEqual((await request("GET", "/admin", undefined, as(eve.cookie))).status, 404, "běžný hráč panel nevidí");

    const adminLogin = await request("POST", "/api/auth/login", { identifier: "Jurek", password: ADMIN_PASSWORD });
    assert.strictEqual(adminLogin.status, 200);
    assert.strictEqual(adminLogin.json.user.role, "admin");
    const adminCookie = cookieOf(adminLogin);
    const admin = as(adminCookie);
    assert.strictEqual((await request("POST", "/api/auth/login", { identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD })).status, 200, "admin se přihlásí i e-mailem");

    const page = await request("GET", "/admin", undefined, admin);
    assert.strictEqual(page.status, 200);
    assert(page.text.includes("Server panel"));
    assert.strictEqual(page.headers["cache-control"], "no-store");
    assert.strictEqual((await request("GET", "/admin.html/", undefined, admin)).status, 404);

    const overview = (await request("GET", "/api/admin/overview", undefined, admin)).json;
    assert(overview.users >= 3 && overview.admins === 1 && overview.providers.google === true);

    const listed = (await request("GET", "/api/admin/users?q=eve", undefined, admin)).json;
    assert.strictEqual(listed.total, 1);
    assert(!JSON.stringify(listed).includes("scrypt"));

    // zablokování odpojí hráče, zruší relace a zabrání přihlášení
    const eveSocket = open(eve.cookie);
    await until(() => eveSocket.hello, "hello");
    assert.strictEqual(eveSocket.hello.me.name, "Eve2");

    const ban = await request("POST", `/api/admin/users/${eve.id}/ban`, { banned: true, reason: "test" }, admin);
    assert.strictEqual(ban.status, 200);
    await until(() => eveSocket.closed, "odpojení zablokovaného hráče");
    assert(eveSocket.errors.some(e => /zablokován/.test(e)));
    assert.strictEqual((await request("GET", "/api/me", undefined, as(eve.cookie))).json.user, null);
    const denied = await request("POST", "/api/auth/login", { identifier: "Eve2", password: "nove-heslo-9" });
    assert(denied.status === 401 && /zablokovaný: test/.test(denied.json.error));
    assert.strictEqual((await request("POST", `/api/admin/users/${eve.id}/ban`, { banned: false }, admin)).status, 200);
    const eveBack = cookieOf(await request("POST", "/api/auth/login", { identifier: "Eve2", password: "nove-heslo-9" }));

    // role: druhý admin, ochrana před sebepoškozením a před zablokováním admina
    assert.strictEqual((await request("POST", `/api/admin/users/${frank.id}/role`, { role: "admin" }, admin)).status, 200);
    assert.strictEqual((await request("GET", "/api/admin/overview", undefined, as(frank.cookie))).status, 200);
    assert.strictEqual((await request("POST", `/api/admin/users/${frank.id}/ban`, { banned: true }, admin)).status, 400, "admina nejde zablokovat");
    assert.strictEqual((await request("DELETE", `/api/admin/users/${frank.id}`, {}, admin)).status, 400, "admina nejde smazat");
    assert.strictEqual((await request("POST", `/api/admin/users/${adminLogin.json.user.id}/ban`, { banned: true }, admin)).status, 400, "sám sebe");
    assert.strictEqual((await request("POST", `/api/admin/users/${adminLogin.json.user.id}/role`, { role: "user" }, admin)).status, 400, "sám sobě");
    assert.strictEqual((await request("POST", `/api/admin/users/${frank.id}/role`, { role: "bogus" }, admin)).status, 400);
    assert.strictEqual((await request("POST", `/api/admin/users/${frank.id}/role`, { role: "user" }, admin)).status, 200);
    assert.strictEqual((await request("GET", "/api/admin/overview", undefined, as(frank.cookie))).status, 403, "po odebrání role už ne");

    // změna admina přes jeho vlastní účet nemění cizí práva
    assert.strictEqual((await request("POST", `/api/admin/users/${frank.id}/role`, { role: "user" }, as(eveBack))).status, 403);

    // nové heslo
    const reset = await request("POST", `/api/admin/users/${frank.id}/password`, {}, admin);
    assert.strictEqual(reset.json.password.length, 16);
    assert.strictEqual((await request("POST", "/api/auth/login", { identifier: "Frank", password: "heslo-1234" })).status, 401);
    assert.strictEqual((await request("POST", "/api/auth/login", { identifier: "Frank", password: reset.json.password })).status, 200);

    // místnosti a připojení: admin je vidí a může zavřít / odpojit
    const eveWs = open(eveBack);
    await until(() => eveWs.hello, "Eve online");
    eveWs.ws.send(JSON.stringify({ t: "create", map: "valley" }));
    await until(() => eveWs.room, "místnost");

    const rooms = (await request("GET", "/api/admin/rooms", undefined, admin)).json.rooms;
    assert.strictEqual(rooms.length, 1);
    assert.deepStrictEqual([rooms[0].host, rooms[0].players], ["Eve2", ["Eve2"]]);

    const clients = (await request("GET", "/api/admin/clients", undefined, admin)).json.clients;
    assert(clients.some(c => c.name === "Eve2" && c.room === rooms[0].id));

    const guest = open();
    await until(() => guest.hello, "host");
    const guestId = (await request("GET", "/api/admin/clients", undefined, admin)).json.clients.find(c => c.userId === null).id;
    assert.strictEqual((await request("POST", `/api/admin/clients/${guestId}/kick`, {}, admin)).status, 200);
    await until(() => guest.closed, "odpojení klienta");
    assert.strictEqual((await request("POST", "/api/admin/clients/99999/kick", {}, admin)).status, 404);

    assert.strictEqual((await request("POST", `/api/admin/rooms/${rooms[0].id}/close`, {}, admin)).status, 200);
    await until(() => eveWs.closed, "zavření místnosti");
    assert.deepStrictEqual((await request("GET", "/api/admin/rooms", undefined, admin)).json.rooms, []);
    assert.strictEqual((await request("POST", `/api/admin/rooms/${rooms[0].id}/close`, {}, admin)).status, 404);

    // smazání účtu
    assert.strictEqual((await request("DELETE", `/api/admin/users/${frank.id}`, {}, admin)).status, 200);
    assert.strictEqual((await request("GET", `/api/players/${frank.id}`)).status, 404);
    assert.strictEqual((await request("GET", "/api/me", undefined, as(frank.cookie))).json.user, null);

    // záznam akcí
    const audit = (await request("GET", "/api/admin/audit", undefined, admin)).json.audit.map(a => a.action);
    for (const action of ["ban", "unban", "role", "password-reset", "delete", "kick", "close-room"]) assert(audit.includes(action), `v záznamu chybí ${action}`);
    assert.strictEqual((await request("GET", "/api/admin/matches", undefined, admin)).status, 200);

    // odhlášení
    assert.strictEqual((await request("POST", "/api/auth/logout", {}, admin)).status, 200);
    assert.strictEqual((await request("GET", "/api/admin/overview", undefined, admin)).status, 401);
    assert.strictEqual((await request("GET", "/admin", undefined, admin)).status, 404);

    // účty přežijí restart serveru
    proc.kill("SIGTERM");
    await new Promise(resolve => proc.once("exit", resolve));
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, "db.json"), "utf8"));
    assert(Object.values(saved.users).some(u => u.name === "Jurek" && u.role === "admin"));
    assert(Object.values(saved.users).some(u => u.name === "Eve2"));
  } finally {
    for (const s of sockets) s.ws.terminate();
    proc.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function main() {
  await testAccounts();
  await testOAuth();
  await testServerApi();
  console.log("OK: všechny testy účtů prošly");
}

main().then(() => process.exit(0), err => {
  console.error(err);
  process.exit(1);
});
