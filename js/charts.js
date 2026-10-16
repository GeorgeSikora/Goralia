/*
 * Jednoduché grafy bez knihoven (SVG): čárový graf s křížovým kurzorem a sloupcový graf.
 * Používá je panel serveru i profil ve hře. Veškeré popisky se vkládají jako text.
 */
(() => {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs = {}) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  // 1 234 → „1 234“, 12 500 → „12,5K“, 0,25 → „0,25“ (malá desetinná čísla, např. průměry, se nezaokrouhlí na 0)
  function compact(v) {
    if (v == null || !Number.isFinite(v)) return "–";
    const a = Math.abs(v);
    if (a >= 1e6) return `${trim(v / 1e6)}M`;
    if (a >= 1e4) return `${trim(v / 1e3)}K`;
    if (a < 10 && v % 1) return v.toLocaleString("cs-CZ", { maximumFractionDigits: a < 1 ? 2 : 1 });
    return Math.round(v).toLocaleString("cs-CZ");
  }
  const trim = n => (Math.round(n * 10) / 10).toLocaleString("cs-CZ");

  function niceStep(raw, integer) {
    if (raw <= 0) return 1;
    const exp = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / exp;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
    return integer ? Math.max(1, Math.ceil(step)) : step;
  }

  function yScale(max, integer = true) {
    const step = niceStep((max || 1) / 4, integer);
    const top = Math.max(step, Math.ceil((max || 1) / step) * step);
    const ticks = [];
    for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
    return { top, ticks };
  }

  // Sleduje šířku kontejneru a překresluje graf; vrací obal.
  function responsive(draw) {
    const box = el("div", "gc");
    let last = 0;
    const paint = () => {
      const w = Math.round(box.clientWidth || 0);
      if (!w || w === last) return;
      last = w;
      draw(box, w);
    };

    if (window.ResizeObserver) new ResizeObserver(paint).observe(box);
    else window.addEventListener("resize", paint);
    requestAnimationFrame(paint);
    return box;
  }

  function legend(series, kind) {
    const row = el("div", "gc-legend");
    for (const s of series) {
      const item = el("span", "gc-legend-item");
      const key = el("i", `gc-key ${kind}`);
      key.style.background = s.color;
      item.append(key, document.createTextNode(s.name));
      row.append(item);
    }
    return row;
  }

  function tooltip(box) {
    const tip = el("div", "gc-tip");
    tip.hidden = true;
    box.append(tip);

    return {
      show(x, y, title, rows) {
        const head = el("div", "gc-tip-title", title);
        tip.replaceChildren(head, ...rows.map(r => {
          const line = el("div", "gc-tip-row");
          const key = el("i", "gc-tip-key");
          key.style.background = r.color;
          line.append(key, el("b", "gc-tip-value", r.value), el("span", "gc-tip-name", r.name));
          return line;
        }));
        tip.hidden = false;

        const bw = box.clientWidth;
        const tw = tip.offsetWidth;
        const left = x + 14 + tw > bw ? Math.max(0, x - 14 - tw) : x + 14;
        tip.style.left = `${left}px`;
        tip.style.top = `${Math.max(0, y)}px`;
      },
      hide() { tip.hidden = true; }
    };
  }

  /*
   * Čárový graf.
   * opts: { x: [čísla], series: [{ name, color, values: [číslo|null] }], height, yFmt, xTicks(min, max, width) → [x],
   *         xFmt(x) (popisek osy), tipTitle(x), label (popis pro čtečky) }
   */
  function line(opts) {
    const series = opts.series.filter(s => s.values.some(v => v != null));
    const height = opts.height || 200;
    const yFmt = opts.yFmt || compact;
    const endLabels = series.length > 1 && series.length <= 4;

    const box = responsive((root, width) => {
      root.replaceChildren();
      const xs = opts.x;
      if (!xs.length || !series.length) {
        root.append(el("p", "gc-empty", opts.empty || "Zatím žádná data."));
        return;
      }

      const max = Math.max(0, ...series.flatMap(s => s.values.filter(v => v != null)));
      const ys = yScale(max, opts.integer !== false);
      const yLabelW = Math.max(...ys.ticks.map(t => yFmt(t).length)) * 7 + 10;
      const nameW = endLabels ? Math.min(110, Math.max(...series.map(s => s.name.length)) * 7 + 18) : 0;
      const m = { t: 10, r: 12 + nameW, b: 24, l: yLabelW };
      const pw = Math.max(40, width - m.l - m.r);
      const ph = height - m.t - m.b;
      const x0 = xs[0];
      const x1 = xs[xs.length - 1];
      const sx = v => m.l + (x1 === x0 ? pw / 2 : ((v - x0) / (x1 - x0)) * pw);
      const sy = v => m.t + ph - (v / ys.top) * ph;

      const chart = svg("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": opts.label || "" });

      // mřížka a osa y
      for (const t of ys.ticks) {
        chart.append(svg("line", { x1: m.l, x2: m.l + pw, y1: sy(t), y2: sy(t), class: t === 0 ? "gc-base" : "gc-grid" }));
        const lab = svg("text", { x: m.l - 6, y: sy(t) + 4, "text-anchor": "end", class: "gc-axis" });
        lab.textContent = yFmt(t);
        chart.append(lab);
      }

      // osa x
      const ticks = opts.xTicks ? opts.xTicks(x0, x1, pw) : [x0, x1];
      for (const t of ticks) {
        const lab = svg("text", { x: sx(t), y: height - 6, "text-anchor": "middle", class: "gc-axis" });
        lab.textContent = (opts.xFmt || String)(t);
        chart.append(lab);
      }

      // čáry (null přeruší čáru)
      for (const s of series) {
        let d = "";
        let open = false;
        let lone = [];
        s.values.forEach((v, i) => {
          if (v == null) { open = false; return; }
          const prevNull = i === 0 || s.values[i - 1] == null;
          const nextNull = i === s.values.length - 1 || s.values[i + 1] == null;
          if (prevNull && nextNull) lone.push(i);
          d += `${open ? "L" : "M"}${sx(xs[i]).toFixed(1)},${sy(v).toFixed(1)}`;
          open = true;
        });
        chart.append(svg("path", { d, class: "gc-line", stroke: s.color }));
        for (const i of lone) chart.append(svg("circle", { cx: sx(xs[i]), cy: sy(s.values[i]), r: 3, fill: s.color }));
      }

      // popisky na konci čar (bez překrývání)
      if (endLabels) {
        const ends = series.map(s => {
          let i = s.values.length - 1;
          while (i >= 0 && s.values[i] == null) i--;
          return { s, y: i >= 0 ? sy(s.values[i]) : sy(0) };
        }).sort((a, b) => a.y - b.y);

        for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 13);
        const overflow = ends.length ? ends[ends.length - 1].y - (m.t + ph) : 0;
        if (overflow > 0) for (const e of ends) e.y -= overflow;

        for (const e of ends) {
          chart.append(svg("line", { x1: m.l + pw + 4, x2: m.l + pw + 12, y1: e.y, y2: e.y, stroke: e.s.color, "stroke-width": 2 }));
          const t = svg("text", { x: m.l + pw + 15, y: e.y + 4, class: "gc-end" });
          t.textContent = e.s.name;
          chart.append(t);
        }
      }

      // kurzor + tooltip
      const cross = svg("line", { y1: m.t, y2: m.t + ph, class: "gc-cross", visibility: "hidden" });
      const dots = series.map(s => svg("circle", { r: 4, fill: s.color, class: "gc-dot", visibility: "hidden" }));
      const hit = svg("rect", { x: m.l, y: m.t, width: pw, height: ph, class: "gc-hit", tabindex: 0 });
      chart.append(cross, ...dots, hit);
      root.append(chart);
      if (series.length > 1 && !(opts.hideLegend && endLabels)) root.append(legend(series, "line"));

      const tip = tooltip(root);
      let index = -1;

      function at(i) {
        index = Math.max(0, Math.min(xs.length - 1, i));
        const cx = sx(xs[index]);
        cross.setAttribute("x1", cx);
        cross.setAttribute("x2", cx);
        cross.setAttribute("visibility", "visible");

        let topY = m.t + ph;
        series.forEach((s, k) => {
          const v = s.values[index];
          if (v == null) { dots[k].setAttribute("visibility", "hidden"); return; }
          dots[k].setAttribute("cx", cx);
          dots[k].setAttribute("cy", sy(v));
          dots[k].setAttribute("visibility", "visible");
          topY = Math.min(topY, sy(v));
        });

        const rows = series.map(s => ({ name: s.name, color: s.color, raw: s.values[index], value: s.values[index] == null ? "–" : yFmt(s.values[index]) }))
          .sort((a, b) => (b.raw ?? -1) - (a.raw ?? -1));
        tip.show(cx, Math.max(0, topY - 20), (opts.tipTitle || opts.xFmt || String)(xs[index]), rows);
      }

      function nearest(clientX) {
        const r = hit.getBoundingClientRect();
        const px = x0 + ((clientX - r.left) / r.width) * (x1 - x0);
        let best = 0;
        for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - px) < Math.abs(xs[best] - px)) best = i;
        return best;
      }

      const leave = () => {
        cross.setAttribute("visibility", "hidden");
        dots.forEach(d => d.setAttribute("visibility", "hidden"));
        tip.hide();
      };

      hit.addEventListener("pointermove", e => at(nearest(e.clientX)));
      hit.addEventListener("pointerdown", e => at(nearest(e.clientX)));
      hit.addEventListener("pointerleave", leave);
      hit.addEventListener("focus", () => at(index < 0 ? xs.length - 1 : index));
      hit.addEventListener("blur", leave);
      hit.addEventListener("keydown", e => {
        if (e.key === "ArrowLeft") { at(index - 1); e.preventDefault(); }
        if (e.key === "ArrowRight") { at(index + 1); e.preventDefault(); }
      });
    });

    return box;
  }

  /*
   * Sloupcový graf jedné řady.
   * opts: { labels: [text], values: [číslo], color, name, height, yFmt, every (každý n-tý popisek), tipTitle(i) }
   */
  function bars(opts) {
    const height = opts.height || 180;
    const yFmt = opts.yFmt || compact;

    return responsive((root, width) => {
      root.replaceChildren();
      const n = opts.values.length;
      if (!n) {
        root.append(el("p", "gc-empty", opts.empty || "Zatím žádná data."));
        return;
      }

      const ys = yScale(Math.max(0, ...opts.values), opts.integer !== false);
      const yLabelW = Math.max(...ys.ticks.map(t => yFmt(t).length)) * 7 + 10;
      const m = { t: 10, r: 8, b: 24, l: yLabelW };
      const pw = Math.max(40, width - m.l - m.r);
      const ph = height - m.t - m.b;
      const slot = pw / n;
      const gap = Math.min(8, Math.max(2, slot * 0.2));
      const bw = Math.max(1, slot - gap);
      const sy = v => m.t + ph - (v / ys.top) * ph;
      const every = opts.every || Math.max(1, Math.ceil((n * 34) / pw));

      const chart = svg("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": opts.label || "" });

      for (const t of ys.ticks) {
        chart.append(svg("line", { x1: m.l, x2: m.l + pw, y1: sy(t), y2: sy(t), class: t === 0 ? "gc-base" : "gc-grid" }));
        const lab = svg("text", { x: m.l - 6, y: sy(t) + 4, "text-anchor": "end", class: "gc-axis" });
        lab.textContent = yFmt(t);
        chart.append(lab);
      }

      const tip = tooltip(root);
      const marks = [];

      opts.values.forEach((v, i) => {
        const x = m.l + i * slot + gap / 2;
        const top = sy(v);
        const h = m.t + ph - top;
        const r = Math.min(4, bw / 2, h);
        const base = m.t + ph;

        if (h > 0) {
          const d = `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${base}Z`;
          const bar = svg("path", { d, fill: opts.color, class: "gc-bar" });
          chart.append(bar);
          marks[i] = bar;
        }

        if (i % every === 0) {
          const lab = svg("text", { x: x + bw / 2, y: height - 6, "text-anchor": "middle", class: "gc-axis" });
          lab.textContent = opts.labels[i];
          chart.append(lab);
        }

        // zásah je celý sloupec slotu, ne jen namalovaná část
        const hit = svg("rect", { x: m.l + i * slot, y: m.t, width: slot, height: ph, class: "gc-hit", tabindex: 0 });
        const show = () => {
          marks.forEach(b => b && b.classList.remove("on"));
          if (marks[i]) marks[i].classList.add("on");
          tip.show(x + bw / 2, Math.max(0, top - 30), opts.tipTitle ? opts.tipTitle(i) : opts.labels[i], [{ name: opts.name || "", color: opts.color, value: yFmt(v) }]);
        };
        const hide = () => { if (marks[i]) marks[i].classList.remove("on"); tip.hide(); };
        hit.addEventListener("pointerenter", show);
        hit.addEventListener("pointerdown", show);
        hit.addEventListener("focus", show);
        hit.addEventListener("pointerleave", hide);
        hit.addEventListener("blur", hide);
        chart.append(hit);
      });

      root.prepend(chart);
    });
  }

  window.GChart = { line, bars, compact };
})();
