/*
 * Účty hráčů: registrace, přihlášení heslem i přes Google/Facebook, relace, správa účtů pro admina.
 * Hesla se ukládají jen jako scrypt hash; relace jako SHA-256 hash náhodného tokenu v cookie.
 */
"use strict";

const crypto = require("crypto");
const R = require("../js/rules.js");
const { newStats } = require("./stats.js");

const SESSION_TTL = 30 * 24 * 3600 * 1000;
const MAX_SESSIONS_PER_USER = 10;
const NAME_COOLDOWN = 3600 * 1000;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;
const SCRYPT = { N: 16384, r: 8, p: 1 };
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{1,12}[A-Za-z0-9_.-]$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

const strip = s => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const nameKey = name => strip(name).toLowerCase().replace(/[ _.-]/g, "");
const hashToken = token => crypto.createHash("sha256").update(token).digest("hex");

function generatePassword(length = 16) {
  let out = "";
  for (let i = 0; i < length; i++) out += PASSWORD_CHARS[crypto.randomInt(PASSWORD_CHARS.length)];
  return out;
}

const scrypt = (password, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, 64, SCRYPT, (err, key) => (err ? reject(err) : resolve(key)));
});

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${SCRYPT.N}$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt" || Number(parts[1]) !== SCRYPT.N) return false;

  const key = await scrypt(password, Buffer.from(parts[2], "base64"));
  const expected = Buffer.from(parts[3], "base64");
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// Posuvné okno neúspěšných pokusů podle klíče (IP, přezdívka).
class Limiter {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  recent(key) {
    const now = Date.now();
    const list = (this.hits.get(key) || []).filter(t => now - t < this.windowMs);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  blocked(key) { return this.recent(key).length >= this.max; }

  add(key) {
    const list = this.recent(key);
    list.push(Date.now());
    this.hits.set(key, list);
  }

  clear(key) { this.hits.delete(key); }
  sweep() { for (const key of [...this.hits.keys()]) this.recent(key); }
}

function createAccounts(store, options = {}) {
  const data = store.data;
  const adminName = options.adminName || "Jurek";
  const adminEmail = String(options.adminEmail || "info@jirisikora.cz").toLowerCase();

  const reserved = new Set(["admin", "administrator", "server", "system", "goralia", "hrac", "moderator", "ai", "gm", "support", nameKey(adminName)]);
  for (const name of Object.values(R.TEAM_NAMES)) reserved.add(`ai${nameKey(name)}`);

  const byName = new Map();
  const byEmail = new Map();
  const byProvider = { google: new Map(), facebook: new Map() };

  function index(user) {
    byName.set(nameKey(user.name), user);
    if (user.email) byEmail.set(user.email, user);
    for (const provider of Object.keys(byProvider)) if (user[provider]) byProvider[provider].set(user[provider], user);
  }

  function unindex(user) {
    byName.delete(nameKey(user.name));
    if (user.email) byEmail.delete(user.email);
    for (const provider of Object.keys(byProvider)) if (user[provider]) byProvider[provider].delete(user[provider]);
  }

  for (const user of Object.values(data.users)) {
    user.stats = Object.assign(newStats(), user.stats);
    index(user);
  }

  const loginIp = new Limiter(30, 10 * 60 * 1000);
  const loginName = new Limiter(8, 10 * 60 * 1000);
  const registerIp = new Limiter(20, 3600 * 1000);
  setInterval(() => { loginIp.sweep(); loginName.sweep(); registerIp.sweep(); sweepSessions(); }, 10 * 60 * 1000).unref();

  /* ---------- ověření vstupů ---------- */
  function nameError(name, user) {
    const key = nameKey(name);
    if (!NAME_RE.test(name) || key.length < 3) {
      return "Přezdívka má 3 až 14 znaků: písmena bez diakritiky, číslice, mezera, tečka, podtržítko nebo pomlčka.";
    }

    if (reserved.has(key) && !(user && user.role === "admin")) return "Tato přezdívka je vyhrazená.";

    const taken = byName.get(key);
    if (taken && taken !== user) return "Tato přezdívka je obsazená.";
    return null;
  }

  function emailError(email) {
    if (email.length > 254 || !EMAIL_RE.test(email)) return "Zadej platný e-mail.";
    if (byEmail.has(email) || email === adminEmail) return "Tento e-mail je už zaregistrovaný.";
    return null;
  }

  function passwordError(password, name) {
    if (password.length < MIN_PASSWORD) return `Heslo musí mít aspoň ${MIN_PASSWORD} znaků.`;
    if (password.length > MAX_PASSWORD) return `Heslo může mít nejvýše ${MAX_PASSWORD} znaků.`;
    if (name && nameKey(password) === nameKey(name)) return "Heslo nesmí být stejné jako přezdívka.";
    return null;
  }

  function createUser(fields) {
    const user = {
      id: data.nextUserId++,
      name: fields.name,
      email: fields.email || null,
      passHash: fields.passHash || null,
      role: fields.role || "user",
      google: null,
      facebook: null,
      created: Date.now(),
      lastLogin: 0,
      lastSeen: 0,
      nameChanged: 0,
      banned: null,
      stats: newStats()
    };

    data.users[user.id] = user;
    index(user);
    store.save();
    return user;
  }

  function suggestName(base) {
    let name = strip(base || "").replace(/[^A-Za-z0-9 _.-]/g, "").replace(/\s+/g, " ").replace(/^[ _.-]+/, "").slice(0, 14).trim();
    if (name.length < 3) name = "Hrac";

    let candidate = name;
    for (let i = 0; i < 100 && nameError(candidate, null); i++) {
      candidate = `${name.slice(0, 10).trim()}${crypto.randomInt(100, 10000)}`;
    }

    return nameError(candidate, null) ? `Hrac${crypto.randomInt(100000, 1000000)}` : candidate;
  }

  /* ---------- registrace a přihlášení ---------- */
  async function register(input, ip) {
    if (registerIp.blocked(ip)) return { error: "Příliš mnoho registrací z této adresy. Zkus to později.", limited: true };

    const name = String(input.name || "").trim();
    const email = String(input.email || "").trim().toLowerCase();
    const password = String(input.password || "");
    const problem = nameError(name, null) || emailError(email) || passwordError(password, name);
    if (problem) return { error: problem };

    registerIp.add(ip);
    const passHash = await hashPassword(password);

    // za dobu hashování mohl někdo zabrat jméno nebo e-mail
    const again = nameError(name, null) || emailError(email);
    if (again) return { error: again };

    return { user: createUser({ name, email, passHash }) };
  }

  const dummy = hashPassword("goralia-dummy-password");

  async function login(identifier, password, ip) {
    const id = String(identifier || "").trim().slice(0, 254);
    const key = id.toLowerCase().includes("@") ? id.toLowerCase() : nameKey(id);

    if (loginIp.blocked(ip) || loginName.blocked(key)) return { error: "Příliš mnoho pokusů. Zkus to za chvíli.", limited: true };

    const user = id.includes("@") ? byEmail.get(id.toLowerCase()) : byName.get(nameKey(id));
    const stored = user && user.passHash ? user.passHash : await dummy;
    const ok = (await verifyPassword(String(password || "").slice(0, MAX_PASSWORD), stored)) && !!user && !!user.passHash;

    if (!ok) {
      loginIp.add(ip);
      loginName.add(key);
      return { error: "Nesprávná přezdívka nebo heslo." };
    }

    loginName.clear(key);
    if (user.banned) return { error: bannedText(user) };

    user.lastLogin = Date.now();
    store.save();
    return { user };
  }

  const bannedText = user => `Účet je zablokovaný${user.banned && user.banned.reason ? `: ${user.banned.reason}` : "."}`;

  // Přihlášení přes poskytovatele; profile = { id, email, emailVerified, name }.
  function loginWithProvider(provider, profile) {
    const idx = byProvider[provider];
    const id = profile && profile.id ? String(profile.id) : "";
    if (!idx || !id) return { error: "Přihlášení se nezdařilo." };

    let user = idx.get(id);
    let created = false;
    const email = profile.emailVerified && profile.email ? String(profile.email).toLowerCase() : "";

    // Ověřený e-mail Googlu patří adminovi: účet se propojí s jeho Google identitou.
    if (!user && provider === "google" && email === adminEmail) {
      const admin = byEmail.get(adminEmail);

      if (admin && admin.role === "admin" && !admin.google) {
        admin.google = id;
        idx.set(id, admin);
        user = admin;
      }
    }

    if (!user) {
      user = createUser({ name: suggestName(profile.name || email.split("@")[0]), email: email && !byEmail.has(email) && email !== adminEmail ? email : null });
      user[provider] = id;
      idx.set(id, user);
      created = true;
    }

    if (user.banned) return { error: bannedText(user) };

    user.lastLogin = Date.now();
    store.save();
    return { user, created };
  }

  /* ---------- relace ---------- */
  function createSession(user) {
    const token = crypto.randomBytes(32).toString("hex");
    const now = Date.now();
    data.sessions[hashToken(token)] = { userId: user.id, created: now, expires: now + SESSION_TTL };

    const mine = Object.entries(data.sessions).filter(([, s]) => s.userId === user.id).sort((a, b) => a[1].created - b[1].created);
    while (mine.length > MAX_SESSIONS_PER_USER) delete data.sessions[mine.shift()[0]];

    store.save();
    return token;
  }

  function userFromToken(token) {
    if (typeof token !== "string" || token.length !== 64) return null;

    const hash = hashToken(token);
    const session = data.sessions[hash];
    if (!session) return null;

    if (session.expires < Date.now()) {
      delete data.sessions[hash];
      return null;
    }

    const user = data.users[session.userId];
    return user && !user.banned ? user : null;
  }

  function destroySession(token) {
    if (typeof token !== "string") return;
    delete data.sessions[hashToken(token)];
    store.save();
  }

  function destroyUserSessions(userId, keepToken) {
    const keep = typeof keepToken === "string" ? hashToken(keepToken) : "";

    for (const [hash, session] of Object.entries(data.sessions)) {
      if (session.userId === userId && hash !== keep) delete data.sessions[hash];
    }

    store.save();
  }

  function sweepSessions() {
    const now = Date.now();
    let changed = false;

    for (const [hash, session] of Object.entries(data.sessions)) {
      if (session.expires < now) {
        delete data.sessions[hash];
        changed = true;
      }
    }

    if (changed) store.save();
  }

  sweepSessions();

  /* ---------- úpravy vlastního účtu ---------- */
  function rename(user, input) {
    const name = String(input || "").trim();
    if (nameKey(name) === nameKey(user.name) && NAME_RE.test(name)) {
      unindex(user);
      user.name = name;
      index(user);
      store.save();
      return { user };
    }

    const wait = user.nameChanged + NAME_COOLDOWN - Date.now();
    if (user.role !== "admin" && wait > 0) return { error: `Přezdívku lze měnit jednou za hodinu (zbývá ${Math.ceil(wait / 60000)} min).` };

    const problem = nameError(name, user);
    if (problem) return { error: problem };

    unindex(user);
    user.name = name;
    user.nameChanged = Date.now();
    index(user);
    store.save();
    return { user };
  }

  async function changePassword(user, current, next, keepToken) {
    if (user.passHash && !(await verifyPassword(String(current || "").slice(0, MAX_PASSWORD), user.passHash))) {
      return { error: "Současné heslo nesouhlasí." };
    }

    const problem = passwordError(String(next || ""), user.name);
    if (problem) return { error: problem };

    user.passHash = await hashPassword(String(next));
    destroyUserSessions(user.id, keepToken);
    store.save();
    return { user };
  }

  function touch(user) {
    user.lastSeen = Date.now();
    store.save();
  }

  /* ---------- admin ---------- */
  async function seedAdmin(password) {
    const existing = byEmail.get(adminEmail);

    if (existing) {
      if (existing.role !== "admin") {
        existing.role = "admin";
        store.save();
      }

      return null;
    }

    const chosen = password ? String(password) : generatePassword();
    const problem = passwordError(chosen, adminName);
    if (problem) throw new Error(`GORALIA_ADMIN_PASSWORD: ${problem}`);

    const name = byName.has(nameKey(adminName)) ? suggestName(adminName) : adminName;
    const user = createUser({ name, email: adminEmail, passHash: await hashPassword(chosen), role: "admin" });
    return { user, password: chosen, generated: !password };
  }

  async function resetAdminPassword(password) {
    const admin = byEmail.get(adminEmail) || Object.values(data.users).find(u => u.role === "admin");
    if (!admin) return null;

    const chosen = password ? String(password) : generatePassword();
    const problem = passwordError(chosen, admin.name);
    if (problem) throw new Error(problem);

    admin.passHash = await hashPassword(chosen);
    destroyUserSessions(admin.id);
    store.save();
    return { user: admin, password: chosen };
  }

  const adminView = user => ({
    id: user.id, name: user.name, email: user.email, role: user.role,
    google: !!user.google, facebook: !!user.facebook, password: !!user.passHash,
    created: user.created, lastLogin: user.lastLogin, lastSeen: user.lastSeen, banned: user.banned,
    games: user.stats.games, wins: user.stats.wins
  });

  function listUsers({ q = "", offset = 0, limit = 50 } = {}) {
    const needle = String(q).trim().toLowerCase();
    let users = Object.values(data.users);

    if (needle) users = users.filter(u => u.name.toLowerCase().includes(needle) || (u.email || "").includes(needle) || String(u.id) === needle);
    users.sort((a, b) => b.created - a.created);

    return { total: users.length, users: users.slice(offset, offset + limit).map(adminView) };
  }

  function audit(admin, action, detail) {
    data.audit.push({ at: Date.now(), admin: admin.name, action, detail: String(detail || "").slice(0, 200) });
    if (data.audit.length > 200) data.audit.splice(0, data.audit.length - 200);
    store.save();
    console.log(`[admin] ${admin.name}: ${action} ${detail || ""}`);
  }

  function target(admin, id, { allowSelf = false, allowAdmin = false } = {}) {
    const user = data.users[Number(id)];
    if (!user) return { error: "Hráč neexistuje." };
    if (user === admin && !allowSelf) return { error: "Na vlastním účtu to nejde." };
    if (user.role === "admin" && user !== admin && !allowAdmin) return { error: "Účet admina nejdřív zbav role." };
    return { user };
  }

  function setBanned(admin, id, banned, reason) {
    const t = target(admin, id);
    if (t.error) return t;

    t.user.banned = banned ? { at: Date.now(), reason: String(reason || "").trim().slice(0, 120) } : null;
    if (banned) destroyUserSessions(t.user.id);
    audit(admin, banned ? "ban" : "unban", `${t.user.name} (#${t.user.id}) ${t.user.banned ? t.user.banned.reason : ""}`);
    return { user: t.user };
  }

  function setRole(admin, id, role) {
    const t = target(admin, id, { allowAdmin: true });
    if (t.error) return t;
    if (role !== "admin" && role !== "user") return { error: "Neznámá role." };

    t.user.role = role;
    audit(admin, "role", `${t.user.name} (#${t.user.id}) -> ${role}`);
    return { user: t.user };
  }

  async function resetPassword(admin, id) {
    const t = target(admin, id);
    if (t.error) return t;

    const password = generatePassword();
    t.user.passHash = await hashPassword(password);
    destroyUserSessions(t.user.id);
    audit(admin, "password-reset", `${t.user.name} (#${t.user.id})`);
    return { user: t.user, password };
  }

  function deleteUser(admin, id) {
    const t = target(admin, id);
    if (t.error) return t;

    destroyUserSessions(t.user.id);
    unindex(t.user);
    delete data.users[t.user.id];
    audit(admin, "delete", `${t.user.name} (#${t.user.id})`);
    return { user: t.user };
  }

  /* ---------- veřejné pohledy ---------- */
  const selfView = user => ({
    id: user.id, name: user.name, email: user.email, role: user.role,
    hasPassword: !!user.passHash, google: !!user.google, facebook: !!user.facebook
  });

  function getUser(id) {
    return data.users[Number(id)] || null;
  }

  function leaderboard({ q = "", limit = 50 } = {}) {
    const needle = String(q).trim().toLowerCase();
    let users = Object.values(data.users).filter(u => !u.banned);
    users = needle ? users.filter(u => u.name.toLowerCase().includes(needle)) : users.filter(u => u.stats.games > 0);

    users.sort((a, b) => b.stats.pvpWins - a.stats.pvpWins || b.stats.wins - a.stats.wins || b.stats.games - a.stats.games || a.name.localeCompare(b.name));

    return users.slice(0, limit).map(u => ({
      id: u.id, name: u.name, admin: u.role === "admin", games: u.stats.games, wins: u.stats.wins, pvpGames: u.stats.pvpGames, pvpWins: u.stats.pvpWins
    }));
  }

  function counts() {
    const users = Object.values(data.users);
    return { users: users.length, banned: users.filter(u => u.banned).length, admins: users.filter(u => u.role === "admin").length, matches: data.matches.length };
  }

  return {
    register, login, loginWithProvider, createSession, userFromToken, destroySession, destroyUserSessions,
    rename, changePassword, touch, seedAdmin, resetAdminPassword,
    listUsers, setBanned, setRole, resetPassword, deleteUser, audit, adminView,
    selfView, getUser, leaderboard, counts,
    adminEmail, adminName, SESSION_TTL
  };
}

module.exports = { createAccounts, hashPassword, verifyPassword, generatePassword, nameKey, Limiter };
