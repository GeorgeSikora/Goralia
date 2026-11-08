// Nahrání hlavních workflows Goralie (Úkol 1) a analytický průchod (Úkol 2).
//
//   node tools/ux-audit/record.ts                 # nahraje videa do ux-audit-out/
//   node tools/ux-audit/record.ts --mode audit    # znovu bez videa, jen měření (časy, konzole, síť)
//   node tools/ux-audit/record.ts --only 07,08    # jen vybrané workflows
//   node tools/ux-audit/record.ts --base http://localhost:3000 --out /cesta/vystup
//
// Potřebuje běžící server (npm start) s adminem z GORALIA_ADMIN_NAME/PASSWORD (viz README v této složce),
// Playwright s Chromiem a pro spojené video ffmpeg.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, Flow, type FlowResult, type Mode, type Opts } from "./lib.ts";
import { WORKFLOWS } from "./workflows.ts";

const arg = (name: string, def = "") => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const opts: Opts = {
  base: arg("base", process.env.UX_BASE || "http://localhost:3000"),
  out: path.resolve(arg("out", "ux-audit-out")),
  mode: (arg("mode", "record") as Mode),
  headed: process.argv.includes("--headed")
};
const only = arg("only").split(",").filter(Boolean);
const outDir = opts.mode === "record" ? opts.out : path.join(opts.out, "audit");
opts.out = outDir;
fs.mkdirSync(path.join(outDir, "videa"), { recursive: true });

const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const ff = (args: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
const durationOf = (file: string) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim()) || 0;

async function main() {
  const browser = await chromium.launch({ headless: !opts.headed, args: ["--autoplay-policy=no-user-gesture-required"] });
  // s --only se výsledky (a videa) ostatních workflows z dřívějšího běhu ponechají
  const prevFile = path.join(outDir, "vysledky.json");
  const previous: FlowResult[] = only.length && fs.existsSync(prevFile) ? JSON.parse(fs.readFileSync(prevFile, "utf8")) : [];
  const results: FlowResult[] = [];
  const merged = () => [...previous.filter(p => !results.some(r => r.id === p.id)), ...results].sort((a, b) => a.id.localeCompare(b.id));

  for (const wf of WORKFLOWS) {
    if (only.length && !only.includes(wf.id)) continue;
    const base = wf.baseEnv ? process.env[wf.baseEnv] : opts.base;
    const f = new Flow(browser, { ...opts, base: base || opts.base }, wf.id, wf.name);
    f.res.note = wf.note;
    console.log(`▶ ${wf.id} ${wf.name}`);
    if (!base) {
      f.res.status = "přeskočeno";
      f.res.note = `${wf.note || ""} Přeskočeno: nastav ${wf.baseEnv} na adresu serveru z té větve.`.trim();
      results.push(f.res);
      console.log(`  přeskočeno (chybí ${wf.baseEnv})`);
      continue;
    }
    try {
      await f.open();
      await wf.run(f);
    } catch (e: any) {
      f.res.status = "selhal";
      console.log(`  ✖ selhal v kroku „${f.current}“: ${String(e && e.message || e).split("\n")[0]}`);
    }
    await f.page.waitForTimeout(opts.mode === "record" ? 800 : 0).catch(() => {});
    await f.close();
    if (f.res.status !== "selhal") {
      const errs = f.res.console.filter(c => /error/.test(c.kind) && !c.expected).length + f.res.network.filter(n => n.kind !== "slow" && !n.expected).length;
      if (f.res.issues.length || errs) f.res.status = "problém";
    }
    if (opts.mode === "record") finishVideo(f.res, wf.slug);
    results.push(f.res);
    console.log(`  ${f.res.status} · ${f.res.durationS} s · ${f.res.issues.length} problémů · ${f.res.console.length} hlášek konzole · ${f.res.network.length} síťových`);
    fs.writeFileSync(prevFile, JSON.stringify(merged(), null, 1));
  }
  await browser.close();

  const all = merged();
  if (opts.mode === "record" && hasFfmpeg) combine(all);
  fs.writeFileSync(prevFile, JSON.stringify(all, null, 1));
  console.log(`hotovo → ${outDir}`);
}

// Video workflow: NN_nazev.webm; u více oken (multiplayer) vedle sebe.
function finishVideo(r: FlowResult, slug: string) {
  const base = path.join(outDir, "videa", `${r.id}_${slug}`);
  const vids = r.videos.filter(v => fs.existsSync(v));
  if (!vids.length) return;
  for (const old of fs.readdirSync(path.dirname(base)).filter(n => n.startsWith(path.basename(base)))) fs.rmSync(path.join(path.dirname(base), old));
  if (vids.length === 1) fs.renameSync(vids[0], `${base}.webm`);
  else {
    vids.forEach((v, i) => fs.renameSync(v, `${base}_${String.fromCharCode(65 + i)}.webm`));
    if (hasFfmpeg) {
      const [a, b] = [`${base}_A.webm`, `${base}_B.webm`];
      ff(["-i", a, "-i", b, "-filter_complex",
        "[0:v]scale=956:538,pad=960:1080:2:271:#0b0912[l];[1:v]scale=956:538,pad=960:1080:2:271:#0b0912[r];[l][r]hstack=inputs=2," +
        "drawtext=text='Hráč A (Testovac)':x=24:y=220:fontsize=34:fontcolor=white,drawtext=text='Hráč B (Souper)':x=984:y=220:fontsize=34:fontcolor=white",
        "-c:v", "libvpx-vp9", "-crf", "40", "-b:v", "0", "-deadline", "realtime", "-cpu-used", "8", `${base}.webm`]);
    }
  }
  r.videos = [path.relative(outDir, `${base}.webm`)];
}

// Spojené MP4 s kapitolami (jedna kapitola = jeden workflow).
function combine(results: FlowResult[]) {
  const tmp = path.join(outDir, "videa", "tmp"); fs.mkdirSync(tmp, { recursive: true });
  const parts: { file: string; title: string; dur: number }[] = [];
  for (const r of results) {
    const src = r.videos[0] && path.join(outDir, r.videos[0]);
    if (!src || !fs.existsSync(src)) continue;
    const dst = path.join(tmp, `${r.id}.mp4`);
    ff(["-i", src, "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-an", dst]);
    parts.push({ file: dst, title: `${r.id} ${r.name} (${r.status})`, dur: durationOf(dst) });
  }
  if (!parts.length) return;
  const list = path.join(tmp, "list.txt");
  fs.writeFileSync(list, parts.map(p => `file '${p.file}'`).join("\n"));
  let t = 0;
  const meta = [";FFMETADATA1", "title=Goralia – hlavní workflows (UX audit)"];
  const chapters: string[] = [];
  for (const p of parts) {
    const start = Math.round(t * 1000), end = Math.round((t + p.dur) * 1000);
    meta.push("[CHAPTER]", "TIMEBASE=1/1000", `START=${start}`, `END=${end}`, `title=${p.title}`);
    const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
    chapters.push(`${mm}:${String(ss).padStart(2, "0")} ${p.title}`);
    t += p.dur;
  }
  const metaFile = path.join(tmp, "chapters.txt");
  fs.writeFileSync(metaFile, meta.join("\n") + "\n");
  ff(["-f", "concat", "-safe", "0", "-i", list, "-i", metaFile, "-map_metadata", "1", "-map_chapters", "1", "-c", "copy", "-movflags", "+faststart", path.join(outDir, "videa", "goralia-workflows.mp4")]);
  fs.writeFileSync(path.join(outDir, "videa", "kapitoly.txt"), chapters.join("\n") + "\n");
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch(e => { console.error(e); process.exit(1); });
