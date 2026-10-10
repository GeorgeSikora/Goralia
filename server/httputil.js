/*
 * Pomocné funkce pro HTTP: cookies, IP klienta, JSON odpovědi a čtení těla požadavku.
 */
"use strict";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin"
};

function parseCookies(header) {
  const out = {};

  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;

    const key = part.slice(0, i).trim();
    if (!key || key in out) continue;

    try { out[key] = decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { /* neplatná cookie */ }
  }

  return out;
}

function isSecure(req) {
  return !!req.socket.encrypted || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

function cookie(req, name, value, { maxAge, path = "/" } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, "HttpOnly", "SameSite=Lax"];
  if (maxAge != null) parts.push(`Max-Age=${Math.floor(maxAge)}`);
  if (isSecure(req)) parts.push("Secure");
  return parts.join("; ");
}

// Za proxy je poslední položka X-Forwarded-For ta, kterou připojila proxy.
function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",").map(s => s.trim()).filter(Boolean);
  return forwarded.length ? forwarded[forwarded.length - 1] : req.socket.remoteAddress || "?";
}

// Požadavek z jiné stránky (CSRF) se pozná podle Originu; hostitelem může být Host nebo to, co poslala proxy.
function sameOrigin(req, publicUrl) {
  const origin = req.headers.origin;
  if (!origin) return true;

  let host;
  try { host = new URL(origin).host; } catch (e) { return false; }

  const allowed = [req.headers.host, req.headers["x-forwarded-host"]];
  if (publicUrl) {
    try { allowed.push(new URL(publicUrl).host); } catch (e) { /* ignore */ }
  }

  return allowed.some(h => h && String(h).split(",")[0].trim() === host);
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS, ...headers });
  res.end(JSON.stringify(body));
}

function redirect(res, location, headers = {}) {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store", ...SECURITY_HEADERS, ...headers });
  res.end();
}

function readJson(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;

    req.on("data", chunk => {
      if (tooBig) return;
      size += chunk.length;

      if (size > limit) {
        tooBig = true;
        reject(Object.assign(new Error("Požadavek je příliš velký."), { status: 413 }));
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      if (tooBig) return;
      if (!size) return resolve({});

      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("tvar");
        resolve(body);
      } catch (e) {
        reject(Object.assign(new Error("Neplatný JSON."), { status: 400 }));
      }
    });

    req.on("error", reject);
  });
}

module.exports = { SECURITY_HEADERS, parseCookies, cookie, isSecure, clientIp, sameOrigin, sendJson, redirect, readJson };
