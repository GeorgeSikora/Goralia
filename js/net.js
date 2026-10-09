/*
 * Tenká vrstva nad WebSocketem pro online zápasy.
 * Klient posílá jen záměry; veškerý stav dodává server.
 */
(() => {
  "use strict";

  const PK = window.PK;

  let ws = null;
  let handlers = { message() {}, close() {} };

  function defaultUrl() {
    const query = new URLSearchParams(location.search).get("server");

    if (query) return query;
    if (location.protocol === "http:" || location.protocol === "https:") {
      return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
    }

    return "ws://localhost:3000";
  }

  // Přijme i adresu bez schématu (např. "192.168.0.5:3000").
  function normalize(value) {
    let url = String(value || "").trim();
    if (!url) return defaultUrl();
    if (/^https?:\/\//i.test(url)) url = url.replace(/^http/i, "ws");
    else if (!/^wss?:\/\//i.test(url)) url = `${location.protocol === "https:" ? "wss" : "ws"}://${url}`;
    return url;
  }

  function connect(address) {
    const url = normalize(address);

    return new Promise((resolve, reject) => {
      close();

      let socket;

      try {
        socket = new WebSocket(url);
      } catch (e) {
        reject(e);
        return;
      }

      ws = socket;
      let opened = false;

      socket.addEventListener("open", () => {
        opened = true;
        resolve();
      });

      socket.addEventListener("message", event => {
        if (socket !== ws) return;

        try {
          handlers.message(JSON.parse(event.data));
        } catch (e) {
          console.error(e);
        }
      });

      socket.addEventListener("close", () => {
        if (socket !== ws) return;
        ws = null;
        if (opened) handlers.close();
        else reject(new Error("connect"));
      });

      socket.addEventListener("error", () => { /* "close" follows */ });
    });
  }

  function close() {
    const socket = ws;
    ws = null;
    if (socket) socket.close();
  }

  function send(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }

  PK.net = {
    connect,
    close,
    send,
    defaultUrl,
    get connected() { return !!ws && ws.readyState === WebSocket.OPEN; },
    set onmessage(fn) { handlers.message = fn; },
    set onclose(fn) { handlers.close = fn; }
  };
})();
