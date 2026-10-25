// Builds the site into dist/: a home page (latest release + catalog) and one page per release.
// Usage: node scripts/build.mjs            -> dist/
//        node scripts/build.mjs --preview  -> preview.html (single file, artwork inlined)

import { readFile, writeFile, mkdir, cp, rm, access } from "node:fs/promises";
import { SITE_URL, STORE, PLATFORMS, esc } from "./lib.mjs";

const ROOT = new URL("..", import.meta.url);
const PREVIEW = process.argv.includes("--preview");
const readJSON = async (p, d) => { try { return JSON.parse(await readFile(new URL(p, ROOT), "utf8")); } catch { return d; } };
const exists = async u => { try { await access(u); return true; } catch { return false; } };

const ICONS = {
  store: '<path d="M4 7h16l-1.5 11a2 2 0 0 1-2 1.7h-9A2 2 0 0 1 5.5 18z"/><path d="M9 7V5.5a3 3 0 0 1 6 0V7"/>',
  beatport: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8 15V9l4 3 4-3v6"/>',
  bandcamp: '<path d="M3 17 9 7h12l-6 10z"/>',
  spotify: '<circle cx="12" cy="12" r="9"/><path d="M7.5 10c3-1 6.5-.7 9 .8M8 13.2c2.4-.7 5-.4 7 .7M8.6 16c1.8-.5 3.7-.3 5.2.5"/>',
  apple: '<path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="16" r="2"/>',
  soundcloud: '<path d="M3 15v-2M6 16v-5M9 16V9M12 16V7"/><path d="M15 16h3.5a2.5 2.5 0 0 0 0-5 4.5 4.5 0 0 0-3.5-4z"/>',
  youtube: '<rect x="2.5" y="5.5" width="19" height="13" rx="3.5"/><path d="M10 9.5v5l4.5-2.5z"/>',
};
const SUB = { store: "MP3 & WAV, direct from the label" };

const artistLine = a => a.length <= 1 ? (a[0] || "") : a.slice(0, -1).join(", ") + " & " + a[a.length - 1];
const short = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); if (s.length <= n) return s; const cut = s.slice(0, n); return cut.slice(0, cut.lastIndexOf(" ")) + "…"; };

const CSS = `
/* Layout: phone-first single column; from 880px the release splits into cover | links. Dark night palette taken from the cover art. */
:root {
  --night: #05060f;
  --panel: #0c0e22;
  --raise: #13163a;
  --ink: #eef0ff;
  --muted: #9096c2;
  --line: #1f2347;
  --ember: #ff8a4c;
  --ember-ink: #1b0b02;
  --cyan: #63d6ff;
  --f-display: "Syncopate", "Arial Black", sans-serif;
  --f-body: "Figtree", system-ui, -apple-system, "Segoe UI", sans-serif;
  --f-mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html { background: var(--night); }
body { margin: 0; background: var(--night); color: var(--ink); font-family: var(--f-body); font-size: 16px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
a { color: inherit; }
.glow { position: fixed; inset: -15%; z-index: 0; pointer-events: none; background-size: cover; background-position: center; filter: blur(90px) saturate(1.5); opacity: .38; }
#sky { position: fixed; inset: 0; width: 100%; height: 100%; z-index: 0; pointer-events: none; }
.glow::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 0%, var(--night) 75%); }
.wrap { position: relative; z-index: 1; max-width: 1040px; margin: 0 auto; display: flex; flex-direction: column; gap: 40px;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 24px 40px; }

.brand { display: flex; justify-content: center; }
.brand a { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; font-family: var(--f-display); font-weight: 700; font-size: .82rem; letter-spacing: .22em; text-transform: uppercase; }
.brand img, .brand svg { width: 30px; height: 30px; }

.release { display: grid; grid-template-columns: minmax(0, 1fr); gap: 22px; max-width: 520px; width: 100%; margin: 0 auto; }
.cover { width: 100%; max-width: 100%; height: auto; aspect-ratio: 1; border-radius: 14px; display: block; object-fit: cover; box-shadow: 0 30px 80px -30px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.06); background: var(--raise); }
.ph { display: grid; place-items: end start; padding: 8%; background: linear-gradient(140deg, var(--raise), #2a1d5c); font-family: var(--f-display); font-weight: 700; text-transform: uppercase; line-height: 1.1; color: var(--ink); font-size: .9rem; }
.info { display: flex; flex-direction: column; gap: 6px; }
.eyebrow { margin: 0; font-family: var(--f-mono); font-size: .72rem; letter-spacing: .12em; text-transform: uppercase; color: var(--cyan); }
h1 { margin: 0; font-family: var(--f-display); font-weight: 700; font-size: clamp(1.8rem, 8vw, 2.8rem); line-height: 1.05; letter-spacing: .02em; text-transform: uppercase; text-wrap: balance; overflow-wrap: anywhere; }
.artists { margin: 0; font-size: 1.15rem; font-weight: 600; }
.blurb { margin: 0; color: var(--muted); font-size: .95rem; max-width: 62ch; }

.group { display: flex; flex-direction: column; gap: 8px; }
.group h2 { margin: 0 0 2px; font-family: var(--f-mono); font-weight: 500; font-size: .7rem; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
.links { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.links a { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: center; gap: 14px; min-height: 56px; padding: 10px 16px;
  border-radius: 12px; background: rgba(19,22,58,.72); border: 1px solid var(--line); text-decoration: none; font-weight: 600;
  backdrop-filter: blur(8px); transition: border-color .15s, transform .15s, background .15s; }
.links a:hover { border-color: var(--cyan); transform: translateY(-1px); }
.links a:focus-visible, .share:focus-visible, .tile:focus-visible, .brand a:focus-visible { outline: 2px solid var(--cyan); outline-offset: 3px; }
.links svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.links .sub { display: block; font-weight: 400; font-size: .8rem; opacity: .8; }
.links .act { font-family: var(--f-mono); font-size: .72rem; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.links .act::after { content: " →"; }
.links .store a { background: var(--ember); border-color: var(--ember); color: var(--ember-ink); }
.links .store a:hover { background: #ff9d67; border-color: #ff9d67; }
.links .soon { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: center; gap: 14px; min-height: 56px; padding: 10px 16px;
  border-radius: 12px; border: 1px dashed var(--line); color: var(--muted); font-weight: 600; opacity: .6; cursor: default; }
.links .soon svg { opacity: .7; }
.links .soon .act::after { content: ""; }
.links .store .act { color: var(--ember-ink); opacity: .75; }

.share { justify-self: start; font: 500 .78rem var(--f-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); background: none; border: 1px dashed var(--line); border-radius: 10px; padding: 10px 14px; cursor: pointer; }
.share:hover { color: var(--ink); border-color: var(--muted); }

.catalog { display: flex; flex-direction: column; gap: 16px; }
.catalog > h2 { margin: 0; font-family: var(--f-display); font-weight: 700; font-size: .8rem; letter-spacing: .18em; text-transform: uppercase; color: var(--muted); }
.grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px 12px; max-width: 760px; width: 100%; margin: 0 auto; }
.catalog > h2 { max-width: 760px; width: 100%; margin-inline: auto !important; }
.tile { display: flex; flex-direction: column; gap: 8px; min-width: 0; text-decoration: none; border-radius: 10px; }
.tile .cover { border-radius: 10px; box-shadow: 0 0 0 1px rgba(255,255,255,.05); transition: transform .2s; }
.tile:hover .cover { transform: translateY(-3px); }
.tile .t { font-weight: 600; font-size: clamp(.78rem, 2.6vw, .92rem); line-height: 1.25; overflow-wrap: anywhere; }
.tile .a { font-size: clamp(.7rem, 2.3vw, .8rem); color: var(--muted); line-height: 1.25; overflow-wrap: anywhere; }
.tile[aria-current="page"] .cover { outline: 2px solid var(--ember); outline-offset: 2px; }

footer { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; color: var(--muted); font-size: .85rem; border-top: 1px solid var(--line); padding-top: 24px; }
footer nav { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 18px; }
footer a { color: var(--ink); text-decoration: none; border-bottom: 1px solid var(--line); }
footer a:hover { border-color: var(--ink); }

@media (min-width: 880px) {
  .release { max-width: none; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: 48px; align-items: start; }
  .release .left { position: sticky; top: 24px; display: grid; gap: 20px; }
  .release .right { display: grid; gap: 22px; padding-top: 8px; }
  .release .right .info { margin-bottom: 6px; }
}
@media (max-width: 879px) { .release .left, .release .right { display: contents; } }
@media (max-width: 480px) { .grid { gap: 14px 8px; } .tile { gap: 6px; } .tile .cover { border-radius: 6px; } }
@media (prefers-reduced-motion: reduce) { .links a, .tile .cover { transition: none; } }
`;

const GLYPH = `<svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="30" cy="14" r="6" fill="#ff8a4c"/><path d="M25 18 L6 38" stroke="#ff8a4c" stroke-width="3" stroke-linecap="round" opacity=".55"/><path d="M27 21 L14 38" stroke="#ff8a4c" stroke-width="2" stroke-linecap="round" opacity=".3"/></svg>`;

async function main() {
  const db = await readJSON("data/releases.json", { releases: [] });
  const overrides = await readJSON("data/overrides.json", {});
  const cfg = await readJSON("data/config.json", {});
  const releases = db.releases.filter(r => r.title && !(overrides[r.slug] && overrides[r.slug].hidden)).sort((a, b) => b.id - a.id);
  if (!releases.length) throw new Error("No releases in data/releases.json");

  // Inline artwork for the single-file preview
  const artSrc = {};
  for (const r of releases) {
    if (!r.art) continue;
    const file = new URL("public/" + r.art, ROOT);
    if (PREVIEW) { if (await exists(file)) artSrc[r.slug] = "data:image/jpeg;base64," + (await readFile(file)).toString("base64"); }
    else artSrc[r.slug] = "/" + r.art;
  }
  const links = r => {
    const o = { ...r.links, ...(overrides[r.slug] || {}) };
    o.store ||= `${STORE}/view_release?release=${r.id}`;
    // Every platform always shows; one without a link yet shows as "Coming soon"
    return PLATFORMS.map(p => ({ ...p, url: typeof o[p.key] === "string" && /^https?:\/\//.test(o[p.key]) ? o[p.key] : "" }));
  };
  const href = r => PREVIEW ? `#${r.slug}` : `/${r.slug}/`;
  const coverImg = (r, cls, lazy) => artSrc[r.slug]
    ? `<img class="${cls}" src="${artSrc[r.slug]}" alt="${esc(r.title)} by ${esc(artistLine(r.artists))}, cover art" width="500" height="500"${lazy ? ' loading="lazy" decoding="async"' : ""}>`
    : `<div class="${cls} ph" role="img" aria-label="${esc(r.title)}">${esc(r.title)}</div>`;
  const brand = cfg.logo ? `<img src="/${esc(cfg.logo)}" alt="">` : GLYPH;

  function page(r, isHome) {
    const latest = r === releases[0];
    const ls = links(r);
    const group = (g, label) => {
      const items = ls.filter(l => l.group === g);
      if (!items.length) return "";
      return `<div class="group"><h2>${label}</h2><ul class="links">${items.map(l => {
        const inner = `
          <svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[l.key]}</svg>
          <span>${esc(l.name)}${SUB[l.key] ? `<span class="sub">${SUB[l.key]}</span>` : ""}</span>`;
        return l.url
          ? `<li class="${l.key === "store" ? "store" : ""}"><a href="${esc(l.url)}" target="_blank" rel="noopener">${inner}<span class="act">${l.action}</span></a></li>`
          : `<li><span class="soon" aria-disabled="true">${inner}<span class="act">Coming soon</span></span></li>`;
      }).join("")}</ul></div>`;
    };
    const eyebrow = [latest ? "Out now" : "Comet Collective", r.genre].filter(Boolean).join(" · ");
    const pageUrl = isHome ? SITE_URL + "/" : `${SITE_URL}/${r.slug}/`;
    const title = isHome ? "Comet Collective · New music every Friday" : `${r.title} by ${artistLine(r.artists)} · Comet Collective`;
    const desc = isHome ? `Out now: ${r.title} by ${artistLine(r.artists)}. Buy and stream every Comet Collective release.` : short(r.blurb, 180) || `Buy and stream ${r.title} by ${artistLine(r.artists)} on Comet Collective.`;
    const ogImg = r.art ? `${SITE_URL}/${r.art}` : "";
    const others = releases.filter(x => x !== r).slice(0, 9); // 3 × 3 feed

    const head = `<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="music.album">
<meta property="og:title" content="${esc(isHome ? "Comet Collective" : r.title + " by " + artistLine(r.artists))}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${pageUrl}">
${ogImg ? `<meta property="og:image" content="${ogImg}">\n<meta name="twitter:card" content="summary_large_image">` : ""}
<link rel="canonical" href="${pageUrl}">
<meta name="theme-color" content="#05060f">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44"><circle cx="30" cy="14" r="7" fill="#ff8a4c"/><path d="M25 18 L6 38" stroke="#ff8a4c" stroke-width="4" stroke-linecap="round"/></svg>')}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Syncopate:wght@400;700&family=Figtree:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>${CSS}</style>`;

    const body = `
${artSrc[r.slug] ? `<div class="glow" style="background-image:url('${artSrc[r.slug]}')" aria-hidden="true"></div>` : ""}
<canvas id="sky" aria-hidden="true"></canvas>
<div class="wrap">
  <header class="brand"><a href="${PREVIEW ? "#" : "/"}">${brand}<span>Comet Collective</span></a></header>
  <article class="release">
    <div class="left">
      ${coverImg(r, "cover", false)}
    </div>
    <div class="right">
      <div class="info">
        <p class="eyebrow">${esc(eyebrow)}</p>
        <h1>${esc(r.title)}</h1>
        <p class="artists">${esc(artistLine(r.artists))}</p>
      </div>
      ${group("buy", "Buy & download")}
      ${group("stream", "Stream")}
      ${r.blurb ? `<p class="blurb">${esc(short(r.blurb, 420))}</p>` : ""}
      <button class="share" type="button" data-url="${esc(isHome ? SITE_URL + "/" + r.slug + "/" : pageUrl)}" data-text="${esc(`${r.title} by ${artistLine(r.artists)}, out on Comet Collective`)}">Copy link</button>
    </div>
  </article>
  <section class="catalog" aria-labelledby="cat-h">
    <h2 id="cat-h">Latest releases</h2>
    <div class="grid">${others.map(x => `
      <a class="tile" href="${href(x)}"${x === r ? ' aria-current="page"' : ""}>${coverImg(x, "cover", true)}<span class="t">${esc(x.title)}</span><span class="a">${esc(artistLine(x.artists))}</span></a>`).join("")}
    </div>
  </section>
  <footer>
    <nav><a href="https://www.comet-collective.com" target="_blank" rel="noopener">Website</a><a href="${STORE}" target="_blank" rel="noopener">Store</a>${cfg.instagram ? `<a href="${esc(cfg.instagram)}" target="_blank" rel="noopener">Instagram</a>` : ""}</nav>
    <span>New music every Friday</span>
  </footer>
</div>
<script>
// Background: twinkling stars with an occasional falling comet
(function () {
  const cv = document.getElementById("sky"); if (!cv || cv.dataset.on) return; cv.dataset.on = 1;
  const g = cv.getContext("2d"), still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w, h, stars = [], comet = null;
  function size() { w = cv.width = innerWidth; h = cv.height = innerHeight;
    stars = Array.from({ length: Math.round(w * h / 8000) }, () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.2 + .2, p: Math.random() * 6 })); }
  function frame(t) {
    if (!cv.isConnected) return;
    g.clearRect(0, 0, w, h); g.fillStyle = "#c9ceff";
    for (const s of stars) { g.globalAlpha = .15 + .3 * (.5 + .5 * Math.sin(t / 1400 + s.p)); g.beginPath(); g.arc(s.x, s.y, s.r, 0, 7); g.fill(); }
    if (!still) {
      if (!comet && Math.random() < .005) comet = { x: w * (.4 + Math.random() * .6), y: -20, vx: -3.4, vy: 2.2 };
      if (comet) {
        const tx = comet.x - comet.vx * 45, ty = comet.y - comet.vy * 45, gr = g.createLinearGradient(comet.x, comet.y, tx, ty);
        gr.addColorStop(0, "#ff8a4c"); gr.addColorStop(1, "rgba(255,138,76,0)");
        g.globalAlpha = .8; g.strokeStyle = gr; g.lineWidth = 2; g.beginPath(); g.moveTo(comet.x, comet.y); g.lineTo(tx, ty); g.stroke();
        comet.x += comet.vx; comet.y += comet.vy; if (comet.y > h + 60 || comet.x < -60) comet = null;
      }
      requestAnimationFrame(frame);
    }
    g.globalAlpha = 1;
  }
  size(); addEventListener("resize", () => { size(); if (still) frame(0); });
  still ? frame(0) : requestAnimationFrame(frame);
})();
document.querySelectorAll(".share").forEach(b => b.addEventListener("click", () => {
  const url = b.dataset.url, done = () => { b.textContent = "Link copied"; setTimeout(() => b.textContent = "Copy link", 2000); };
  if (navigator.share && matchMedia("(pointer: coarse)").matches) { navigator.share({ title: b.dataset.text, url }).catch(() => {}); return; }
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(done).catch(() => { b.textContent = url; b.style.userSelect = "all"; b.style.textTransform = "none"; });
}));
</script>`;
    return { head, body };
  }

  if (PREVIEW) {
    // One file: home page, with tiles switching via #slug
    const pages = Object.fromEntries(releases.map((r, i) => [r.slug, page(r, i === 0)]));
    const home = pages[releases[0].slug];
    const html = `<meta name="claude:viewport-fit-sides" content="cover">\n${home.head}\n${releases.map((r, i) => `<template id="p-${r.slug}">${pages[r.slug].body}</template>`).join("\n")}
<div id="app">${home.body}</div>
<script>
function go() { const s = location.hash.slice(1), t = document.getElementById("p-" + s) || document.getElementById("p-${releases[0].slug}");
  const app = document.getElementById("app"); app.innerHTML = t.innerHTML; app.querySelectorAll("script").forEach(o => { const n = document.createElement("script"); n.textContent = o.textContent; o.replaceWith(n); }); scrollTo(0, 0); }
addEventListener("hashchange", go); if (location.hash) go();
</script>`;
    await writeFile(new URL("preview.html", ROOT), html);
    console.log("Wrote preview.html");
    return;
  }

  const DIST = new URL("dist/", ROOT);
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  await cp(new URL("public/", ROOT), DIST, { recursive: true }).catch(() => {});
  const doc = ({ head, body }) => `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}\n</head>\n<body>${body}\n</body>\n</html>\n`;
  await writeFile(new URL("index.html", DIST), doc(page(releases[0], true)));
  for (const r of releases) {
    await mkdir(new URL(r.slug + "/", DIST), { recursive: true });
    await writeFile(new URL(r.slug + "/index.html", DIST), doc(page(r, false)));
  }
  await writeFile(new URL("404.html", DIST), `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=/"><title>Comet Collective</title><a href="/">Comet Collective</a>`);
  console.log(`Built ${releases.length} release pages + home into dist/`);
}

main().catch(e => { console.error(e); process.exit(1); });
