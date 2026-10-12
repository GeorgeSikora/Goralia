/*
 * Hlasový chat místnosti: hráči v jedné online místnosti (lobby i rozehraný zápas) spolu mluví přes push-to-talk.
 * Zvuk jde přímo mezi prohlížeči (WebRTC, každý s každým), server jen předává popisy spojení ("rtc")
 * a oznamuje, kdo právě mluví ("talk"). Mikrofon se otevře až při prvním stisku klávesy.
 * Kdo mluví, se ukazuje vlevo nahoře: jméno v barvě týmu a ikonka reproduktoru.
 */
(() => {
  "use strict";

  const PK = window.PK;
  const R = PK.rules;
  const KEY = "pk-vchat";
  const MAX_RETRIES = 3;
  const DEFAULT_ICE = [{ urls: ["stun:stun.l.google.com:19302"] }];

  const cfg = { enabled: true, key: "KeyV" };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) { /* ignore */ }

  const state = {
    roomId: 0,
    where: "off", // off | lobby | game
    me: 0, // id spojení na serveru
    ice: DEFAULT_ICE,
    names: new Map(), // id -> { name, slot }
    peers: new Map(), // id -> { pc, audio, sender }
    retries: new Map(), // id -> počet pokusů o obnovení spojení
    talking: new Map(), // id -> { name, slot } (včetně mě)
    mic: null, // MediaStream
    micPending: null,
    micDenied: false,
    held: false
  };

  const supported = !!(window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  /* ---------- zobrazení: kdo mluví ---------- */
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const box = el("div", "vchat");
  box.id = "vchat";
  box.setAttribute("aria-live", "polite");
  box.hidden = true;
  const list = el("div", "vchat-list");
  const talkBtn = el("button", "vchat-btn", "Mluvit");
  talkBtn.type = "button";
  talkBtn.hidden = true;
  box.append(list, talkBtn);
  document.querySelector(".app").append(box);

  // pixelový reproduktor s vlnkami (vlnky blikají)
  const SPEAKER = '<svg class="vchat-icon" viewBox="0 0 11 9" width="22" height="18" shape-rendering="crispEdges" aria-hidden="true">' +
    '<path fill="#ffe9a8" d="M0 3h2v3H0zM2 2h1v5H2zM3 1h1v7H3zM4 0h1v9H4z"/>' +
    '<path class="w1" fill="#9ef0f0" d="M6 3h1v3H6z"/>' +
    '<path class="w2" fill="#9ef0f0" d="M8 1h1v1H8zM9 2h1v5H9zM8 7h1v1H8z"/></svg>';

  const colorOf = slot => {
    const team = R.TEAMS[slot];
    return team && PK.TEAM[team] ? PK.css(PK.TEAM[team].ui) : "#c4ccdc";
  };

  function render() {
    list.replaceChildren();

    for (const [id, who] of state.talking) {
      const row = el("div", id === state.me ? "vchat-row me" : "vchat-row");
      const name = el("span", "vchat-name", who.name);
      name.style.color = colorOf(who.slot);
      row.append(name);
      row.insertAdjacentHTML("beforeend", SPEAKER);
      list.append(row);
    }

    box.hidden = state.where === "off" || (!state.talking.size && talkBtn.hidden);
  }

  function setTalking(id, on) {
    const who = state.names.get(id);
    if (on && who) state.talking.set(id, who);
    else state.talking.delete(id);
    render();
  }

  /* ---------- mikrofon ---------- */
  function micTrack() {
    return state.mic ? state.mic.getAudioTracks()[0] : null;
  }

  function openMic() {
    if (state.mic) return Promise.resolve(state.mic);
    if (state.micPending) return state.micPending;

    state.micPending = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
      .then(stream => {
        state.mic = stream;
        state.micDenied = false;
        const track = micTrack();
        if (track) track.enabled = false;
        for (const peer of state.peers.values()) attachMic(peer);
        return stream;
      }, err => {
        state.micDenied = true;
        if (PK.chat && PK.chat.receive) PK.chat.receive({ sys: true, text: "Hlasový chat: prohlížeč nepovolil mikrofon." });
        throw err;
      })
      .finally(() => { state.micPending = null; });

    return state.micPending;
  }

  function attachMic(peer) {
    const track = micTrack();
    if (peer.sender && track && peer.sender.track !== track) peer.sender.replaceTrack(track).catch(() => { /* spojení se zavírá */ });
  }

  function closeMic() {
    if (state.mic) for (const track of state.mic.getTracks()) track.stop();
    state.mic = null;
  }

  /* ---------- push-to-talk ---------- */
  function canTalk() {
    return supported && cfg.enabled && state.where !== "off" && state.me > 0;
  }

  function press() {
    if (state.held || !canTalk()) return;
    state.held = true;

    openMic().then(() => {
      if (!state.held || !canTalk()) return;
      const track = micTrack();
      if (track) track.enabled = true;
      PK.net.send({ t: "talk", on: true });
      state.talking.set(state.me, state.names.get(state.me) || { name: "Já", slot: -1 });
      render();
    }, () => { state.held = false; });
  }

  function release() {
    if (!state.held) return;
    state.held = false;
    const track = micTrack();
    if (track) track.enabled = false;
    if (state.talking.has(state.me)) {
      PK.net.send({ t: "talk", on: false });
      setTalking(state.me, false);
    }
  }

  const typing = target => target && target.matches && target.matches("input, textarea, select, [contenteditable]");

  window.addEventListener("keydown", event => {
    if (event.code !== cfg.key || capturing) return;
    if (typing(event.target)) return;
    event.preventDefault();
    if (!event.repeat) press();
  });

  window.addEventListener("keyup", event => {
    if (event.code === cfg.key) release();
  });

  window.addEventListener("blur", release);
  document.addEventListener("visibilitychange", () => { if (document.hidden) release(); });

  // dotykové displeje: tlačítko „Mluvit“ (držet)
  talkBtn.addEventListener("pointerdown", event => {
    event.preventDefault();
    talkBtn.setPointerCapture(event.pointerId);
    talkBtn.classList.add("on");
    press();
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    talkBtn.addEventListener(type, () => {
      talkBtn.classList.remove("on");
      release();
    });
  }
  talkBtn.addEventListener("contextmenu", event => event.preventDefault());

  /* ---------- spojení s ostatními (WebRTC) ---------- */
  // Nabídku posílá vždy ten s menším id, druhý jen odpovídá; obě strany mají jeden zvukový kanál tam i zpět.
  function createPeer(id) {
    const pc = new RTCPeerConnection({ iceServers: state.ice });
    const audio = new Audio();
    audio.autoplay = true;
    const peer = { pc, audio, sender: null, queue: [] };
    state.peers.set(id, peer);

    pc.addEventListener("icecandidate", event => {
      if (event.candidate) PK.net.send({ t: "rtc", to: id, kind: "ice", ice: event.candidate.toJSON() });
    });

    pc.addEventListener("track", event => {
      audio.srcObject = event.streams[0] || new MediaStream([event.track]);
      applyVolume(peer);
      const played = audio.play();
      if (played && played.catch) played.catch(() => { /* přehraje se po první interakci */ });
    });

    pc.addEventListener("connectionstatechange", () => {
      // spojení se rozpadlo (výpadek sítě): ten, kdo nabízí, to párkrát zkusí znovu
      if (pc.connectionState === "failed" && state.peers.get(id) === peer) {
        dropPeer(id);
        const tries = (state.retries.get(id) || 0) + 1;
        state.retries.set(id, tries);
        if (state.names.has(id) && tries <= MAX_RETRIES) connect(id);
      } else if (pc.connectionState === "connected") {
        state.retries.delete(id);
      }
    });

    return peer;
  }

  function useTransceiver(peer, transceiver) {
    transceiver.direction = "sendrecv";
    peer.sender = transceiver.sender;
    attachMic(peer);
  }

  async function connect(id) {
    if (state.peers.has(id) || state.me >= id) return;
    const peer = createPeer(id);
    useTransceiver(peer, peer.pc.addTransceiver("audio", { direction: "sendrecv" }));

    try {
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      PK.net.send({ t: "rtc", to: id, kind: "offer", sdp: { type: "offer", sdp: peer.pc.localDescription.sdp } });
    } catch (e) {
      console.error(e);
    }
  }

  function dropPeer(id) {
    const peer = state.peers.get(id);
    if (!peer) return;
    state.peers.delete(id);
    peer.audio.srcObject = null;
    try { peer.pc.close(); } catch (e) { /* ignore */ }
  }

  async function onRtc(m) {
    const id = m.from | 0;
    if (!state.names.has(id) || !supported) return;

    try {
      if (m.kind === "offer" && m.sdp && m.sdp.type === "offer") {
        // nová nabídka (i po výpadku) nahradí staré spojení
        dropPeer(id);
        const peer = createPeer(id);
        await peer.pc.setRemoteDescription({ type: "offer", sdp: String(m.sdp.sdp || "") });
        const transceiver = peer.pc.getTransceivers().find(t => t.receiver.track && t.receiver.track.kind === "audio");
        if (transceiver) useTransceiver(peer, transceiver);
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        PK.net.send({ t: "rtc", to: id, kind: "answer", sdp: { type: "answer", sdp: peer.pc.localDescription.sdp } });
        flushIce(peer);
      } else if (m.kind === "answer" && m.sdp && m.sdp.type === "answer") {
        const peer = state.peers.get(id);
        if (!peer || peer.pc.signalingState !== "have-local-offer") return;
        await peer.pc.setRemoteDescription({ type: "answer", sdp: String(m.sdp.sdp || "") });
        flushIce(peer);
      } else if (m.kind === "ice" && m.ice) {
        const peer = state.peers.get(id);
        if (!peer) return;
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(m.ice);
        else peer.queue.push(m.ice);
      }
    } catch (e) {
      console.error(e);
    }
  }

  function flushIce(peer) {
    const queue = peer.queue.splice(0);
    for (const ice of queue) peer.pc.addIceCandidate(ice).catch(() => { /* neplatný kandidát */ });
  }

  /* ---------- hlasitost ---------- */
  function applyVolume(peer) {
    peer.audio.muted = !cfg.enabled;
    peer.audio.volume = Math.max(0, Math.min(1, PK.audio ? PK.audio.volume : 1));
  }

  /* ---------- zprávy ze serveru ---------- */
  function onVoice(m) {
    if (!Array.isArray(m.peers)) return;
    state.me = m.me | 0;
    state.names = new Map(m.peers.map(p => [p.id | 0, { name: String(p.name || "?").slice(0, 40), slot: p.slot | 0 }]));

    for (const id of [...state.peers.keys()]) if (!state.names.has(id)) dropPeer(id);
    for (const id of [...state.talking.keys()]) if (!state.names.has(id)) state.talking.delete(id);
    // jméno nebo barva se mohly změnit (změna mapy přesune sloty)
    for (const id of state.talking.keys()) state.talking.set(id, state.names.get(id));

    if (supported) for (const id of state.names.keys()) if (id !== state.me) connect(id);
    render();
  }

  function onTalk(m) {
    const id = m.id | 0;
    if (!state.names.has(id) || id === state.me) return;
    setTalking(id, m.on === true);
  }

  function reset() {
    release();
    for (const id of [...state.peers.keys()]) dropPeer(id);
    state.names.clear();
    state.talking.clear();
    state.retries.clear();
    state.me = 0;
    closeMic();
    render();
  }

  /* ---------- umístění: vlevo nahoře (ve hře pod přehledem surovin) ---------- */
  function place() {
    const a = state.where === "game" && PK.vchat.anchor ? PK.vchat.anchor() : null;
    box.style.left = a ? `${Math.round(a.left)}px` : "";
    box.style.top = a ? `${Math.round(a.top)}px` : "";
  }

  window.addEventListener("resize", place);
  setInterval(() => { if (state.where === "game") place(); }, 500);

  /* ---------- nastavení klávesy ---------- */
  let capturing = null;

  function keyLabel(code) {
    const m = /^(?:Key|Digit)(.)$/.exec(code);
    if (m) return m[1];
    const names = { Space: "Mezerník", CapsLock: "Caps Lock", Backquote: "`", ShiftLeft: "Levý Shift", ShiftRight: "Pravý Shift", ControlLeft: "Levý Ctrl", ControlRight: "Pravý Ctrl", AltLeft: "Levý Alt", AltRight: "Pravý Alt" };
    return names[code] || code;
  }

  function saveCfg() {
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
  }

  // Tlačítko v nastavení: po kliknutí čeká na další stisk klávesy (Esc zruší).
  function bindKeyButton(button, onDone) {
    const show = () => { button.textContent = capturing === button ? "Stiskni klávesu…" : keyLabel(cfg.key); };
    show();

    button.addEventListener("click", () => {
      capturing = capturing === button ? null : button;
      show();
    });

    window.addEventListener("keydown", event => {
      if (capturing !== button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      capturing = null;
      // Enter a Esc patří chatu a menu
      if (event.code !== "Escape" && event.code !== "Enter" && event.code !== "NumpadEnter" && event.code !== "Tab") {
        cfg.key = event.code;
        saveCfg();
      }
      show();
      if (onDone) onDone();
    }, true);

    button.addEventListener("blur", () => {
      if (capturing === button) {
        capturing = null;
        show();
      }
    });
  }

  function setEnabled(on) {
    cfg.enabled = !!on;
    saveCfg();
    if (!cfg.enabled) release();
    for (const peer of state.peers.values()) applyVolume(peer);
  }

  /* ---------- veřejné rozhraní ---------- */
  // Volá se opakovaně ze hry; where: "off" | "lobby" | "game" (jako u chatu).
  function sync(opts) {
    const roomId = opts.roomId | 0;
    const where = roomId ? opts.where || "off" : "off";

    // Odchod z místnosti uklidí spojení; přechod rovnou do jiné místnosti vyřeší nový seznam členů ("voice").
    if (!roomId && state.roomId) reset();
    state.roomId = roomId;

    for (const peer of state.peers.values()) applyVolume(peer);

    const touch = !!opts.touch && supported && cfg.enabled && where !== "off";
    if (where === state.where && touch === !talkBtn.hidden) return;

    state.where = where;
    talkBtn.hidden = !touch;
    if (where === "off") release();
    box.classList.toggle("in-game", where === "game");
    place();
    render();
  }

  PK.vchat = {
    sync,
    reset,
    setEnabled,
    bindKeyButton,
    keyLabel: () => keyLabel(cfg.key),
    onVoice,
    onTalk,
    onRtc,
    setIce(list) { if (Array.isArray(list) && list.length) state.ice = list; },
    anchor: null,
    get enabled() { return cfg.enabled; },
    get supported() { return supported; }
  };
})();
