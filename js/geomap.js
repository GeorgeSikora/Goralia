/*
 * Mapa světa s bublinami (canvas, bez knihoven a bez cizích dlaždic): odkud se hráči připojují.
 * Obrys pevnin a hranice států: assets/world.json (Natural Earth 1:50m přes world-atlas, volné dílo),
 * zjednodušeno a uloženo jako rozdíly souřadnic v 1/q stupně. Posun tažením, zoom kolečkem nebo tlačítky.
 */
(() => {
  "use strict";

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const MAX_LAT = 85;
  const px = lon => (lon + 180) / 360;
  const py = lat => {
    const r = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
  };

  // Výřezy [západ, jih, východ, sever]
  const VIEWS = {
    world: [-170, -56, 190, 75],
    europe: [-12, 35, 38, 62],
    czech: [11.9, 48.4, 19.1, 51.2]
  };

  let worldPromise = null;
  function loadWorld() {
    if (!worldPromise) {
      worldPromise = fetch("assets/world.json").then(r => {
        if (!r.ok) throw new Error(`mapa: HTTP ${r.status}`);
        return r.json();
      }).then(data => {
        const decode = list => {
          const path = new Path2D();
          for (const ring of list) {
            let x = 0;
            let y = 0;
            for (let i = 0; i < ring.length; i += 2) {
              x += ring[i];
              y += ring[i + 1];
              const X = px(x / data.q);
              const Y = py(y / data.q);
              if (i === 0) path.moveTo(X, Y);
              else path.lineTo(X, Y);
            }
          }
          return path;
        };
        return { land: decode(data.rings), borders: decode(data.borders) };
      });
      worldPromise.catch(() => { worldPromise = null; });
    }
    return worldPromise;
  }

  /*
   * opts: { places: [{ lat, lon, value, title, sub }], color, name (jednotka v tooltipu), height }
   * Vrací prvek s mapou; místa bez souřadnic nebo s nulou se nekreslí.
   */
  function create(opts) {
    const height = opts.height || 420;
    const color = opts.color || "#3987e5";
    const box = el("div", "gm");
    const canvas = el("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", opts.label || "Mapa míst, odkud se hráči připojují");
    canvas.style.height = `${height}px`;
    const tip = el("div", "gc-tip");
    tip.hidden = true;
    const tools = el("div", "gm-tools");
    const status = el("div", "gm-status", "Načítám mapu…");
    box.append(canvas, tip, tools, status);

    const places = (opts.places || [])
      .filter(p => p.value > 0 && Number.isFinite(p.lat) && Number.isFinite(p.lon))
      .map(p => ({ ...p, x: px(p.lon), y: py(p.lat) }));
    const max = Math.max(1, ...places.map(p => p.value));
    const radius = p => 3 + 18 * Math.sqrt(p.value / max);
    // Velké bubliny dospod, aby malé šly najet myší.
    places.sort((a, b) => b.value - a.value);

    let world = null;
    let width = 0;
    let drag = null;
    let hover = null;
    const view = { cx: 0.5, cy: 0.4, s: 300 };
    let fitted = false;

    function fitBox([w, s, e, n]) {
      const x1 = px(w), x2 = px(e), y1 = py(n), y2 = py(s);
      view.cx = (x1 + x2) / 2;
      view.cy = (y1 + y2) / 2;
      view.s = Math.min(width / (x2 - x1), height / (y2 - y1)) * 0.92;
      clamp();
    }

    // Podle dat: všechna místa v záběru, ale aspoň velikost Česka a nejvýš celý svět.
    function fitData() {
      if (!places.length) return fitBox(VIEWS.europe);
      let w = 180, e = -180, s = 90, n = -90;
      for (const p of places) {
        w = Math.min(w, p.lon); e = Math.max(e, p.lon);
        s = Math.min(s, p.lat); n = Math.max(n, p.lat);
      }
      const padLon = Math.max(3.5 - (e - w) / 2, (e - w) * 0.1);
      const padLat = Math.max(1.5 - (n - s) / 2, (n - s) * 0.1);
      fitBox([w - padLon, s - padLat, e + padLon, n + padLat]);
    }

    function clamp() {
      view.s = Math.max(width * 0.9, Math.min(width * 400, view.s));
      const halfW = width / 2 / view.s;
      const halfH = height / 2 / view.s;
      view.cx = halfW >= 0.5 ? 0.5 : Math.max(halfW, Math.min(1 - halfW, view.cx));
      view.cy = halfH >= 0.5 ? 0.5 : Math.max(halfH, Math.min(1 - halfH, view.cy));
    }

    const toScreen = (x, y) => [(x - view.cx) * view.s + width / 2, (y - view.cy) * view.s + height / 2];

    function draw() {
      if (!width) return;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#141126";
      ctx.fillRect(0, 0, width, height);
      if (!world) return;

      ctx.save();
      ctx.translate(width / 2 - view.cx * view.s, height / 2 - view.cy * view.s);
      ctx.scale(view.s, view.s);
      ctx.fillStyle = "#2a2547";
      ctx.fill(world.land);
      ctx.lineWidth = 1 / view.s;
      ctx.strokeStyle = "#4a4474";
      ctx.stroke(world.land);
      ctx.strokeStyle = "#3d3766";
      ctx.stroke(world.borders);
      ctx.restore();

      for (const p of places) {
        const [x, y] = toScreen(p.x, p.y);
        const r = radius(p);
        if (x < -r || y < -r || x > width + r || y > height + r) continue;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.globalAlpha = p === hover ? 0.9 : 0.55;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = p === hover ? 2 : 1;
        ctx.strokeStyle = p === hover ? "#ffbf45" : "#e8e2f4";
        ctx.stroke();
      }
    }

    let frame = 0;
    const redraw = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw(); });
    };

    function resize() {
      const w = Math.round(box.clientWidth || 0);
      if (!w || w === width) return;
      width = w;
      if (!fitted) {
        fitData();
        fitted = true;
      } else {
        clamp();
      }
      redraw();
    }

    if (window.ResizeObserver) new ResizeObserver(resize).observe(box);
    else window.addEventListener("resize", resize);
    requestAnimationFrame(resize);

    loadWorld().then(w => {
      world = w;
      status.textContent = places.length ? "" : opts.empty || "Za toto období žádná místa.";
      status.hidden = !status.textContent;
      redraw();
    }).catch(e => {
      status.textContent = `Mapu nejde načíst (${e.message}).`;
    });

    /* ---------- ovládání ---------- */
    function zoomAt(factor, sx = width / 2, sy = height / 2) {
      const wx = view.cx + (sx - width / 2) / view.s;
      const wy = view.cy + (sy - height / 2) / view.s;
      view.s *= factor;
      clamp();
      view.cx = wx - (sx - width / 2) / view.s;
      view.cy = wy - (sy - height / 2) / view.s;
      clamp();
      redraw();
    }

    const toolButton = (label, title, onClick) => {
      const b = el("button", "", label);
      b.type = "button";
      b.title = title;
      b.addEventListener("click", onClick);
      tools.append(b);
    };
    toolButton("+", "Přiblížit", () => zoomAt(1.6));
    toolButton("−", "Oddálit", () => zoomAt(1 / 1.6));
    toolButton("Data", "Ukázat všechna místa", () => { fitData(); redraw(); });
    toolButton("Česko", "Výřez Česka", () => { fitBox(VIEWS.czech); redraw(); });
    toolButton("Evropa", "Výřez Evropy", () => { fitBox(VIEWS.europe); redraw(); });
    toolButton("Svět", "Celý svět", () => { fitBox(VIEWS.world); redraw(); });

    canvas.addEventListener("wheel", event => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });

    canvas.addEventListener("pointerdown", event => {
      drag = { x: event.clientX, y: event.clientY, cx: view.cx, cy: view.cy };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointerup", () => { drag = null; });
    canvas.addEventListener("pointercancel", () => { drag = null; });
    canvas.addEventListener("dblclick", event => {
      const rect = canvas.getBoundingClientRect();
      zoomAt(2, event.clientX - rect.left, event.clientY - rect.top);
    });

    canvas.addEventListener("pointermove", event => {
      if (drag) {
        view.cx = drag.cx - (event.clientX - drag.x) / view.s;
        view.cy = drag.cy - (event.clientY - drag.y) / view.s;
        clamp();
        tip.hidden = true;
        redraw();
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      let found = null;
      for (const p of places) {
        const [x, y] = toScreen(p.x, p.y);
        if (Math.hypot(x - mx, y - my) <= Math.max(radius(p), 5)) found = p; // poslední = nejmenší navrchu
      }

      if (found !== hover) {
        hover = found;
        redraw();
      }

      if (!found) {
        tip.hidden = true;
        canvas.style.cursor = "grab";
        return;
      }

      canvas.style.cursor = "pointer";
      const rows = [el("div", "gc-tip-title", found.title)];
      if (found.sub) rows.push(el("div", "gc-tip-row", found.sub));
      const line = el("div", "gc-tip-row");
      line.append(el("b", "gc-tip-value", found.value.toLocaleString("cs-CZ")), el("span", "gc-tip-name", opts.name || ""));
      rows.push(line);
      tip.replaceChildren(...rows);
      tip.hidden = false;
      const left = Math.min(width - tip.offsetWidth - 4, mx + 14);
      tip.style.left = `${Math.max(0, left)}px`;
      tip.style.top = `${Math.max(0, my - tip.offsetHeight - 10)}px`;
    });

    canvas.addEventListener("pointerleave", () => {
      tip.hidden = true;
      if (hover) {
        hover = null;
        redraw();
      }
    });

    return box;
  }

  window.GMap = { create, loadWorld };
})();
