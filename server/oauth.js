/*
 * Přihlášení přes Google a Facebook (OAuth 2.0, authorization code). Poskytovatel se zapne tím,
 * že jsou nastavené proměnné prostředí GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET, resp. FACEBOOK_APP_ID/FACEBOOK_APP_SECRET.
 * Adresa pro návrat: <PUBLIC_URL>/auth/<google|facebook>/callback
 */
"use strict";

const crypto = require("crypto");
const https = require("https");
const { cookie, parseCookies, redirect } = require("./httputil.js");

const STATE_TTL = 10 * 60 * 1000;
const MAX_STATES = 2000;
const COOKIE = "goralia_oauth";

const PROVIDERS = {
  google: {
    id: () => process.env.GOOGLE_CLIENT_ID,
    secret: () => process.env.GOOGLE_CLIENT_SECRET,
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    tokenMethod: "POST",
    userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile",
    extra: { prompt: "select_account" },
    profile: j => ({ id: j.sub, email: j.email, emailVerified: j.email_verified === true, name: j.name || j.given_name })
  },
  facebook: {
    id: () => process.env.FACEBOOK_APP_ID,
    secret: () => process.env.FACEBOOK_APP_SECRET,
    authorize: "https://www.facebook.com/v19.0/dialog/oauth",
    token: "https://graph.facebook.com/v19.0/oauth/access_token",
    tokenMethod: "GET",
    userinfo: "https://graph.facebook.com/v19.0/me?fields=id,name",
    scope: "public_profile",
    extra: {},
    // e-mail z Facebooku se nepoužívá, spolehlivě ověřený není
    profile: j => ({ id: j.id, email: "", emailVerified: false, name: j.name })
  }
};

function request(urlString, { method = "GET", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(new URL(urlString), { method, headers, timeout: 8000 }, res => {
      const chunks = [];
      let size = 0;

      res.on("data", chunk => {
        size += chunk.length;
        if (size > 256 * 1024) return req.destroy(new Error("Odpověď je příliš velká."));
        chunks.push(chunk);
      });

      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        } catch (e) {
          reject(new Error("Neplatná odpověď poskytovatele."));
        }
      });
    });

    req.on("timeout", () => req.destroy(new Error("Poskytovatel neodpovídá.")));
    req.on("error", reject);
    req.end(body);
  });
}

function createOAuth({ accounts, publicUrl, startSession, fetchJson = request }) {
  const states = new Map(); // state -> { provider, expires }

  const configured = name => !!(PROVIDERS[name].id() && PROVIDERS[name].secret());
  const available = () => ({ google: configured("google"), facebook: configured("facebook") });

  function baseUrl(req) {
    if (publicUrl) return publicUrl.replace(/\/+$/, "");
    const secure = req.socket.encrypted || String(req.headers["x-forwarded-proto"] || "") === "https";
    return `${secure ? "https" : "http"}://${req.headers["x-forwarded-host"] || req.headers.host}`;
  }

  const redirectUri = (req, name) => `${baseUrl(req)}/auth/${name}/callback`;
  const clearCookie = req => cookie(req, COOKIE, "", { maxAge: 0, path: "/auth" });

  function sweep() {
    const now = Date.now();
    for (const [state, entry] of states) if (entry.expires < now) states.delete(state);
  }

  function begin(name, req, res) {
    if (!configured(name)) return redirect(res, "/?login=unavailable");

    sweep();
    if (states.size >= MAX_STATES) return redirect(res, "/?login=failed");

    const state = crypto.randomBytes(24).toString("hex");
    states.set(state, { provider: name, expires: Date.now() + STATE_TTL });

    const p = PROVIDERS[name];
    const query = new URLSearchParams({
      client_id: p.id(),
      redirect_uri: redirectUri(req, name),
      response_type: "code",
      scope: p.scope,
      state,
      ...p.extra
    });

    redirect(res, `${p.authorize}?${query}`, { "Set-Cookie": cookie(req, COOKIE, state, { maxAge: STATE_TTL / 1000, path: "/auth" }) });
  }

  async function exchange(name, req, code) {
    const p = PROVIDERS[name];
    const params = new URLSearchParams({
      client_id: p.id(),
      client_secret: p.secret(),
      code,
      redirect_uri: redirectUri(req, name),
      grant_type: "authorization_code"
    });

    const token = p.tokenMethod === "POST"
      ? await fetchJson(p.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: params.toString() })
      : await fetchJson(`${p.token}?${params}`, { headers: { Accept: "application/json" } });

    const accessToken = token.json && token.json.access_token;
    if (token.status !== 200 || typeof accessToken !== "string") throw new Error("Poskytovatel nevydal přístupový token.");

    const url = name === "facebook" ? `${p.userinfo}&access_token=${encodeURIComponent(accessToken)}` : p.userinfo;
    const info = await fetchJson(url, { headers: name === "facebook" ? { Accept: "application/json" } : { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
    if (info.status !== 200 || !info.json) throw new Error("Poskytovatel nevydal profil.");

    return p.profile(info.json);
  }

  async function callback(name, req, res, query) {
    const cookies = parseCookies(req.headers.cookie);
    const state = String(query.get("state") || "");
    const entry = states.get(state);
    states.delete(state);

    const headers = { "Set-Cookie": clearCookie(req) };

    if (!entry || entry.provider !== name || entry.expires < Date.now() || cookies[COOKIE] !== state) {
      return redirect(res, "/?login=failed", headers);
    }

    const code = query.get("code");
    if (query.get("error") || !code) return redirect(res, "/?login=denied", headers);

    try {
      const profile = await exchange(name, req, String(code));
      const result = accounts.loginWithProvider(name, profile);
      if (result.error) return redirect(res, "/?login=banned", headers);

      const sessionCookie = startSession(req, result.user);
      redirect(res, result.created ? "/?login=new" : "/?login=ok", { "Set-Cookie": [headers["Set-Cookie"], sessionCookie] });
    } catch (e) {
      console.warn(`Přihlášení přes ${name} selhalo: ${e.message}`);
      redirect(res, "/?login=failed", headers);
    }
  }

  // Obslouží /auth/<poskytovatel> a /auth/<poskytovatel>/callback; vrací true, pokud cestu zpracoval.
  function handle(req, res, pathname, query) {
    const match = /^\/auth\/(google|facebook)(\/callback)?$/.exec(pathname);
    if (!match) return false;

    if (req.method !== "GET") {
      res.writeHead(405);
      res.end();
      return true;
    }

    if (match[2]) callback(match[1], req, res, query);
    else begin(match[1], req, res);
    return true;
  }

  return { handle, available };
}

module.exports = { createOAuth, PROVIDERS };
