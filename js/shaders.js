/*
 * Shadery: světla a stíny nad hotovým obrazem světa (WebGL 2).
 *
 * Svět se dál kreslí do 2D bufferu jako dřív. Před mraky a HUD se mapová část
 * pošle do WebGL a vrátí se osvětlená: každé světlo (lucerny, ohně, ohnivé koule,
 * lich, světlušky…) osvětlí okolí a jednotky, stromy a budovy z něj vrhají stíny.
 * Nakonec jasná místa lehce prozáří (bloom).
 *
 * Pixelart zůstává ostrý: světlo se počítá pro každý jemný px světa (PK.HD mřížka,
 * i při přiblížení) a intenzita jde po pásmech s Bayerovým ditheringem, takže
 * přechody vypadají jako ručně kreslené, ne jako hladký gradient.
 *
 * Bez WebGL 2 (nebo po ztrátě kontextu) se nic nemění: hra kreslí po staru.
 * Souřadnice světel a překážek jsou art px světa (1 art px = 2 herní jednotky).
 */
(() => {
  "use strict";

  const PK = window.PK;
  const HD = PK.HD;

  const MAXL = 24; // světel v jednom snímku
  const MAXO = 96; // překážek celkem (každé světlo si vezme nejbližší)
  const PER_LIGHT = 6; // překážek na jedno světlo
  const MAXS = 24; // lesklých ploch (krystaly, okna budov)
  const BANDS = 5; // pásma intenzity světla (na jednotku jasu)

  /* Denní doba: během zápasu se pomalu střídá den, soumrak, noc a úsvit (jeden oběh = CYCLE s).
   * amb = barva šera (násobí obraz), gain = síla světel, bloom = síla prozáření,
   * rays = barva a síla šikmých paprsků slunce (měsíce).
   * Ve dne je obraz skoro jako bez shaderů a světla jen lehce dýchají; v noci je svět
   * tmavší a modravý, lucerny a ohně ho drží čitelný. Přechody trvají desítky sekund. */
  const CYCLE = 480;
  const MOOD = [
    // fáze, šero r g b, síla světel, bloom, paprsky r g b × síla
    [0.0, [1.0, 0.98, 0.95], 0.4, 0.55, [0.15, 0.14, 0.1]], // dopoledne
    [0.34, [1.0, 0.97, 0.92], 0.45, 0.6, [0.16, 0.14, 0.09]], // odpoledne
    [0.46, [0.9, 0.74, 0.66], 0.85, 0.9, [0.22, 0.15, 0.07]], // soumrak, zlatá hodinka
    [0.56, [0.56, 0.6, 0.8], 1.2, 1.15, [0.03, 0.04, 0.06]], // noc, slabý měsíc
    [0.8, [0.58, 0.62, 0.82], 1.2, 1.15, [0.03, 0.04, 0.06]], // pozdní noc
    [0.9, [0.82, 0.78, 0.88], 0.8, 0.8, [0.16, 0.12, 0.12]], // úsvit
    [1.0, [1.0, 0.98, 0.95], 0.4, 0.55, [0.15, 0.14, 0.1]]
  ];
  const MENU_PHASE = 0.47; // menu a lobby v soumraku
  const START_PHASE = 0.05; // zápas začíná dopoledne

  function mood(time) {
    const p = S.phase != null ? S.phase : time == null ? MENU_PHASE : ((START_PHASE + time / CYCLE) % 1 + 1) % 1;
    let i = 0;
    while (i < MOOD.length - 2 && p >= MOOD[i + 1][0]) i++;
    const [p0, a0, g0, b0, r0] = MOOD[i];
    const [p1, a1, g1, b1, r1] = MOOD[i + 1];
    let t = (p - p0) / (p1 - p0);
    t = t * t * (3 - 2 * t);
    const mix = (x, y) => x + (y - x) * t;
    return { amb: [mix(a0[0], a1[0]), mix(a0[1], a1[1]), mix(a0[2], a1[2])], gain: mix(g0, g1), bloom: mix(b0, b1), rays: [mix(r0[0], r1[0]), mix(r0[1], r1[1]), mix(r0[2], r1[2])] };
  }

  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;

  let gl = null;
  try {
    gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
  } catch (e) { gl = null; }

  const S = {
    supported: false,
    enabled: true,
    lost: false,
    get active() { return this.supported && this.enabled && !this.lost; },
    recording: false,
    bloom: 1.0,
    phase: null // pevná fáze dne 0..1 (ladění, náhledy); null = podle času zápasu
  };
  S.mood = t => mood(t);
  PK.shaders = S;

  // světla a překážky nasbírané během kreslení snímku
  const lights = [];
  const occ = [];

  let vx0 = 0;
  let vy0 = 0;
  let vx1 = 0;
  let vy1 = 0;

  // power: násobek síly světla jen pro shader (záře v 2D zůstává)
  S.light = function (x, y, r, color, alpha, h = 6, power = 1) {
    if (!S.recording || alpha <= 0.02 || lights.length > 400) return;
    const reach = r * 3 + 6;
    const gy = y + h; // zem pod zdrojem; zdroj visí h art px nad ní
    if (x + reach < vx0 || x - reach > vx1 || gy + reach < vy0 || gy - reach > vy1) return;
    lights.push({
      x, y: gy, h, reach,
      r: ((color >> 16) & 255) / 255, g: ((color >> 8) & 255) / 255, b: (color & 255) / 255,
      // malé záře (oči, světlušky) svítí jen slabě, lucerny a ohně naplno
      a: Math.min(1.3, power * alpha * 2.6 * Math.min(1, Math.pow(r / 14, 1.5))),
      cast: r >= 6
    });
  };

  // lesklá plocha (art px): kind 0 = krystal, 1 = okna budovy
  const sheens = [];
  S.sheen = function (x0, y0, x1, y1, kind) {
    if (!S.recording || sheens.length >= MAXS) return;
    if (x1 < vx0 || x0 > vx1 || y1 < vy0 || y0 > vy1) return;
    sheens.push([x0, y0, x1, y1, kind]);
  };

  // svislý válec: pata (x, y), poloměr r, výška h (art px)
  S.occluder = function (x, y, r, h) {
    if (S.recording && occ.length < 400) occ.push({ x, y, r, h });
  };

  // v = výřez světa v art px { x, y, w, h }; světla mimo něj se ani nezaznamenají
  S.begin = function (v) {
    vx0 = v.x;
    vy0 = v.y;
    vx1 = v.x + v.w;
    vy1 = v.y + v.h;
    S.recording = true;
    occ.length = 0;
    sheens.length = 0;
  };

  S.end = function () {
    S.recording = false;
  };

  if (!gl) return;

  /* ---------- programy ---------- */
  const VS = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

  const COMMON = `#version 300 es
precision highp float;
precision highp int;
out vec4 o;
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
`;

  // 1) osvětlení: obraz × (šero + světla se stíny)
  const FS_LIGHT = COMMON + `
uniform sampler2D uSrc;
uniform float uH;
uniform vec2 uCam;
uniform float uZoom;
uniform vec3 uAmb;
uniform int uNL;
uniform vec4 uLA[${MAXL}]; // zem x, y, výška, dosah
uniform vec4 uLB[${MAXL}]; // barva rgb, síla
uniform vec4 uLC[${MAXL}]; // první překážka, počet
uniform vec4 uOc[${MAXO}]; // pata x, y, poloměr, výška
uniform float uTime;
uniform vec3 uRays;
uniform int uNS;
uniform vec4 uSh[${MAXS}]; // lesklá plocha x0, y0, x1, y1
uniform float uShK[${MAXS}]; // 0 = krystal, 1 = okna budovy
void main() {
  ivec2 px = ivec2(int(gl_FragCoord.x), int(uH - gl_FragCoord.y));
  vec3 src = texelFetch(uSrc, px, 0).rgb;
  // střed jemného px světa pod tímto bodem bufferu (při přiblížení víc bodů na jeden jemný px)
  vec2 w = uCam + (vec2(px) + 0.5) / (${HD}.0 * uZoom);
  vec2 cell = floor(w * ${HD}.0);
  vec2 wf = (cell + 0.5) / ${HD}.0;
  float dth = bayer4(cell);

  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${MAXL}; i++) {
    if (i >= uNL) break;
    vec4 A = uLA[i];
    vec2 d = wf - A.xy;
    float dist2 = dot(d, d);
    if (dist2 >= A.w * A.w) continue;
    float att = 1.0 - sqrt(dist2 + A.z * A.z * 0.15) / A.w;
    if (att <= 0.0) continue;
    att *= att * (1.6 - 0.6 * att);

    float vis = 1.0;
    vec4 Cc = uLC[i];
    int o0 = int(Cc.x);
    int on = int(Cc.y);
    vec2 LP = A.xy - wf;
    float l2 = max(dot(LP, LP), 1e-4);
    for (int j = 0; j < ${PER_LIGHT}; j++) {
      if (j >= on) break;
      vec4 O = uOc[o0 + j];
      // vlastní tělo překážky se nezastíní (sprite bývá vyšší než válec, proto 2× výška)
      if (abs(wf.x - O.x) < O.z * 1.6 && wf.y <= O.y + O.z * 0.4 && wf.y >= O.y - O.w * 2.0) continue;
      float t = clamp(dot(O.xy - wf, LP) / l2, 0.0, 1.0);
      float dd = length(wf + LP * t - O.xy);
      // paprsek k světlu stoupá: blokuje jen, když je u překážky ještě pod jejím vrcholem
      float hz = t * A.z;
      float blk = (1.0 - smoothstep(O.z * 0.55, O.z * 1.05, dd)) * (1.0 - smoothstep(O.w * 0.75, O.w, hz));
      vis *= 1.0 - 0.9 * blk;
    }

    acc += uLB[i].rgb * (att * vis * uLB[i].w);
  }

  // součet světel po pásmech: ploché prstence, dithering jen v úzkém lemu mezi nimi
  float m = max(acc.r, max(acc.g, acc.b));
  if (m > 0.0) {
    float q = floor(m * ${BANDS}.0 + 0.5 + (dth - 0.5) * 0.35) / ${BANDS}.0;
    acc *= q / m;
  }

  // přepal měkce stlačený: nejsvětlejší místo je nanejvýš 1,5× původní barva
  vec3 L = uAmb + acc;
  vec3 over = max(L - 1.0, 0.0);
  L = min(L, 1.0) + over / (1.0 + 2.0 * over);
  // svítící body (okna, plameny, láva, krystaly) šero neztlumí, v noci tak vyniknou
  float mx = max(src.r, max(src.g, src.b));
  float sat = (mx - min(src.r, min(src.g, src.b))) / max(mx, 1e-3);
  float lum = dot(src, vec3(0.3, 0.59, 0.11));
  float e = smoothstep(0.6, 0.82, lum) * smoothstep(0.3, 0.5, sat);
  L = mix(L, max(L, vec3(1.08)), e);
  vec3 lit = src * L;

  // paprsky světla: šikmé pásy ukotvené ve světě, pomalu se posouvají, začínají a končí;
  // po třech pásmech s ditheringem na jemné mřížce, aby to byl pixelart, ne rozmazaný gradient
  if (uRays.r + uRays.g + uRays.b > 0.002) {
    // slunce vpravo nahoře: paprsky padají šikmo doleva dolů
    float tt = uTime;
    float a = dot(wf, vec2(0.89, 0.45)) + tt * 0.35; // napříč paprsky, pomalu se posouvají
    float al = dot(wf, vec2(-0.45, 0.89)); // podél paprsku
    float band = 0.0;
    for (int k = 0; k < 2; k++) {
      // každá buňka napříč má jeden paprsek s vlastní polohou, šířkou a sílou
      float cw = k == 0 ? 90.0 : 57.0;
      float c = floor(a / cw);
      float h1 = fract(sin(c * 12.9898 + float(k) * 4.1) * 43758.5453);
      float h2 = fract(sin(c * 78.233 + float(k) * 2.3) * 24634.6345);
      float h3 = fract(sin(c * 39.425 + float(k) * 7.7) * 15731.743);
      float wdt = 5.0 + h2 * 16.0;
      float x = abs(a - (c + 0.2 + h1 * 0.6) * cw) / wdt;
      float on = step(0.35, h3); // ne každá buňka má paprsek
      // paprsek začíná a končí, pomalu dýchá
      float len = 0.5 + 0.5 * sin(al * 0.009 + h1 * 6.28 + tt * 0.05);
      float b = (1.0 - smoothstep(0.55, 1.0, x)) * smoothstep(0.2, 0.7, len) * on * (0.55 + 0.45 * h2);
      band = max(band, b);
    }
    float q = floor(band * 3.0 + dth * 0.95) / 3.0;
    // tmavá místa (koruny, stíny) dostanou paprsek o něco víc, ať je vidět i skrz stromy
    float dark = 1.0 - smoothstep(0.15, 0.6, dot(lit, vec3(0.3, 0.59, 0.11)));
    lit += uRays * q * (1.0 + 0.6 * dark);
  }

  // lesk krystalů a oken: tenký odlesk občas pomalu přejede plochou, krystaly navíc odrážejí světla okolo
  for (int i = 0; i < ${MAXS}; i++) {
    if (i >= uNS) break;
    vec4 R = uSh[i];
    if (wf.x < R.x || wf.x > R.z || wf.y < R.y || wf.y > R.w) continue;
    bool crystal = uShK[i] < 0.5;
    bool glass = crystal ? (src.b > 0.45 && src.b >= src.r && src.b >= src.g * 0.85) : (src.r > 0.8 && src.g > 0.55 && src.b < 0.7);
    if (!glass) continue;
    float u = (wf.x - R.x) * 0.8 + (wf.y - R.y);
    float ph = fract(u / 36.0 - uTime / (crystal ? 6.0 : 9.0) + R.x * 0.013 + R.y * 0.007);
    lit += step(ph, 0.04) * (crystal ? 0.3 : 0.16) * vec3(1.0, 0.98, 0.92);
    if (crystal) lit += src * acc * 0.2;
  }

  o = vec4(lit, 1.0);
}`;

  // 2) jasná místa zmenšená na čtvrtinu
  const FS_BRIGHT = COMMON + `
uniform sampler2D uSrc;
uniform vec2 uSrcSize;
void main() {
  vec2 base = floor(gl_FragCoord.xy) * 4.0;
  vec3 s = vec3(0.0);
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
    vec2 p = min(base + vec2(x, y), uSrcSize - 1.0);
    vec3 c = texelFetch(uSrc, ivec2(p), 0).rgb;
    float l = max(c.r, max(c.g, c.b));
    s += c * smoothstep(0.78, 1.15, l);
  }
  o = vec4(s / 16.0, 1.0);
}`;

  // 3) rozmazání (oddělitelné, 9 vzorků)
  const FS_BLUR = COMMON + `
uniform sampler2D uSrc;
uniform vec2 uDir;
void main() {
  vec2 sz = vec2(textureSize(uSrc, 0));
  vec2 uv = gl_FragCoord.xy / sz;
  vec3 s = texture(uSrc, uv).rgb * 0.227;
  s += (texture(uSrc, uv + uDir * 1.38 / sz).rgb + texture(uSrc, uv - uDir * 1.38 / sz).rgb) * 0.316;
  s += (texture(uSrc, uv + uDir * 3.23 / sz).rgb + texture(uSrc, uv - uDir * 3.23 / sz).rgb) * 0.07;
  o = vec4(s, 1.0);
}`;

  // 4) složení: osvětlený obraz + bloom po pásmech s ditheringem
  const FS_FINAL = COMMON + `
uniform sampler2D uLit;
uniform sampler2D uBloom;
uniform vec2 uSize;
uniform vec2 uCam;
uniform float uZoom;
uniform float uBloomK;
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec3 lit = texelFetch(uLit, px, 0).rgb;
  vec2 uv = (vec2(px) + 0.5) / uSize;
  vec3 b = texture(uBloom, uv).rgb * uBloomK;
  vec2 w = uCam + vec2(float(px.x) + 0.5, uSize.y - gl_FragCoord.y) / (${HD}.0 * uZoom);
  float dth = bayer4(floor(w * ${HD}.0));
  float m = max(b.r, max(b.g, b.b));
  if (m > 0.0) b *= floor(m * 5.0 + 0.5 + (dth - 0.5) * 0.35) / 5.0 / m;
  o = vec4(lit + b, 1.0);
}`;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  }

  function program(fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, "p");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, "");
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  }

  function texture(filter) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // cílová textura + framebuffer
  function target(filter) {
    return { t: texture(filter), fb: gl.createFramebuffer(), w: 0, h: 0 };
  }

  function size(tg, w, h) {
    if (tg.w === w && tg.h === h) return;
    tg.w = w;
    tg.h = h;
    gl.bindTexture(gl.TEXTURE_2D, tg.t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, tg.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tg.t, 0);
  }

  let P;
  let srcTex;
  let litT;
  let brightT;
  let blurA;
  let blurB;

  function setup() {
    P = {
      light: program(FS_LIGHT),
      bright: program(FS_BRIGHT),
      blur: program(FS_BLUR),
      final: program(FS_FINAL)
    };
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    srcTex = texture(gl.NEAREST);
    litT = target(gl.NEAREST);
    brightT = target(gl.LINEAR);
    blurA = target(gl.LINEAR);
    blurB = target(gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  try {
    setup();
    S.supported = true;
  } catch (e) {
    console.warn("Shadery nejsou k dispozici:", e);
    return;
  }

  canvas.addEventListener("webglcontextlost", ev => { ev.preventDefault(); S.lost = true; });
  canvas.addEventListener("webglcontextrestored", () => {
    try { setup(); S.lost = false; } catch (e) { S.supported = false; }
  });

  /* ---------- výběr světel a překážek ---------- */
  const LA = new Float32Array(MAXL * 4);
  const LB = new Float32Array(MAXL * 4);
  const LC = new Float32Array(MAXL * 4);
  const OC = new Float32Array(MAXO * 4);
  const SH = new Float32Array(MAXS * 4);
  const SK = new Float32Array(MAXS);

  function pack(view, gain) {
    const vx0 = view.x;
    const vy0 = view.y;
    const vx1 = view.x + view.w;
    const vy1 = view.y + view.h;
    const pick = [];

    for (const L of lights) {
      // světlo zasahuje do výřezu?
      if (L.x + L.reach < vx0 || L.x - L.reach > vx1 || L.y + L.reach < vy0 || L.y - L.reach > vy1) continue;
      L.score = L.a * L.reach;
      pick.push(L);
    }

    if (pick.length > MAXL) pick.sort((a, b) => b.score - a.score).length = MAXL;

    let no = 0;
    const near = [];

    pick.forEach((L, i) => {
      LA[i * 4] = L.x;
      LA[i * 4 + 1] = L.y;
      LA[i * 4 + 2] = L.h;
      LA[i * 4 + 3] = L.reach;
      LB[i * 4] = L.r;
      LB[i * 4 + 1] = L.g;
      LB[i * 4 + 2] = L.b;
      LB[i * 4 + 3] = L.a * gain;

      near.length = 0;
      if (L.cast) {
        for (const O of occ) {
          const dx = O.x - L.x;
          const dy = O.y - L.y;
          const d = Math.hypot(dx, dy);
          // světlo uvnitř překážky patří jí (lucerna budovy, lich) – nestíní ho
          if (d < O.r * 1.2 || d > L.reach + O.r) continue;
          near.push({ O, d });
        }
        near.sort((a, b) => a.d - b.d);
      }

      const n = Math.min(PER_LIGHT, near.length, MAXO - no);
      LC[i * 4] = no;
      LC[i * 4 + 1] = n;
      for (let k = 0; k < n; k++) {
        const O = near[k].O;
        OC[no * 4] = O.x;
        OC[no * 4 + 1] = O.y;
        OC[no * 4 + 2] = O.r;
        OC[no * 4 + 3] = O.h;
        no++;
      }
    });

    lights.length = 0;
    return pick.length;
  }

  function quad() {
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /*
   * Osvětlí mapovou část bufferu `src` (2D plátno s PK.HD hustotou) a výsledek nakreslí zpět do `g`.
   * w, mapH: rozměr mapové části v art px obrazovky; cam, zoom: kamera světa;
   * time: čas zápasu v s (denní doba), null v menu.
   */
  S.apply = function (g, src, w, mapH, cam, zoom, time) {
    if (!S.active) return false;
    const W = w * HD;
    const H = mapH * HD;
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }

    const view = { x: cam.x, y: cam.y, w: w / zoom, h: mapH / zoom };
    const m = mood(time);
    const nl = pack(view, m.gain);

    gl.disable(gl.BLEND);
    // 1) osvětlení; zdroj má řádek 0 nahoře, framebuffery mají y zdola,
    // takže výsledek leží ve framebufferech vzpřímeně a plátno ho ukáže správně
    gl.activeTexture(gl.TEXTURE0);
    size(litT, W, H); // (váže texturu cíle, proto před vazbou zdroje)
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);

    gl.bindFramebuffer(gl.FRAMEBUFFER, litT.fb);
    gl.viewport(0, 0, W, H);
    let u = P.light.u;
    gl.useProgram(P.light.p);
    gl.uniform1i(u.uSrc, 0);
    gl.uniform1f(u.uH, H);
    gl.uniform2f(u.uCam, cam.x, cam.y);
    gl.uniform1f(u.uZoom, zoom);
    gl.uniform3fv(u.uAmb, m.amb);
    gl.uniform1i(u.uNL, nl);
    gl.uniform4fv(u.uLA, LA);
    gl.uniform4fv(u.uLB, LB);
    gl.uniform4fv(u.uLC, LC);
    gl.uniform4fv(u.uOc, OC);
    gl.uniform1f(u.uTime, (performance.now() / 1000) % 3600);
    gl.uniform3fv(u.uRays, m.rays);
    gl.uniform1i(u.uNS, sheens.length);
    sheens.forEach((s, i) => {
      SH.set(s.slice(0, 4), i * 4);
      SK[i] = s[4];
    });
    gl.uniform4fv(u.uSh, SH);
    gl.uniform1fv(u.uShK, SK);
    quad();

    // 2) a 3) bloom ve čtvrtinovém rozlišení
    const bw = Math.max(1, Math.ceil(W / 4));
    const bh = Math.max(1, Math.ceil(H / 4));

    size(brightT, bw, bh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, brightT.fb);
    gl.viewport(0, 0, bw, bh);
    gl.useProgram(P.bright.p);
    gl.bindTexture(gl.TEXTURE_2D, litT.t);
    gl.uniform1i(P.bright.u.uSrc, 0);
    gl.uniform2f(P.bright.u.uSrcSize, W, H);
    quad();

    size(blurA, bw, bh);
    size(blurB, bw, bh);
    gl.useProgram(P.blur.p);
    gl.uniform1i(P.blur.u.uSrc, 0);
    for (let k = 0; k < 2; k++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, blurA.fb);
      gl.bindTexture(gl.TEXTURE_2D, k ? blurB.t : brightT.t);
      gl.uniform2f(P.blur.u.uDir, 1 + k, 0);
      quad();
      gl.bindFramebuffer(gl.FRAMEBUFFER, blurB.fb);
      gl.bindTexture(gl.TEXTURE_2D, blurA.t);
      gl.uniform2f(P.blur.u.uDir, 0, 1 + k);
      quad();
    }

    // 4) do plátna
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    u = P.final.u;
    gl.useProgram(P.final.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, litT.t);
    gl.uniform1i(u.uLit, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, blurB.t);
    gl.uniform1i(u.uBloom, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(u.uSize, W, H);
    gl.uniform2f(u.uCam, cam.x, cam.y);
    gl.uniform1f(u.uZoom, zoom);
    gl.uniform1f(u.uBloomK, S.bloom * m.bloom);
    quad();

    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.drawImage(canvas, 0, 0);
    g.restore();
    return true;
  };
})();
