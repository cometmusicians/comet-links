// Weekly sync: finds new releases in the AMPsuite store, downloads artwork,
// and looks up direct links on each platform. Writes data/releases.json.
// Runs on GitHub Actions (see .github/workflows/sync.yml). No dependencies, Node 20+.

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { STORE, slugify, norm, matches, videoMatches, decodeEntities } from "./lib.mjs";

const ROOT = new URL("..", import.meta.url);
const DATA = new URL("data/releases.json", ROOT);
const OVERRIDES = new URL("data/overrides.json", ROOT);
const CONFIG = new URL("data/config.json", ROOT);
const ART_DIR = new URL("public/art/", ROOT);

const MAX_CHECKS = 14;        // stop looking for a missing link after this many runs
const PER_RUN = 25;           // older releases re-checked per run (new ones always checked)
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const env = process.env;
const log = [];
const say = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function http(url, opts = {}, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { ...opts, headers: { "user-agent": UA, "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8", "accept-language": "en-US,en;q=0.9", "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "none", "upgrade-insecure-requests": "1", ...(opts.headers || {}) }, signal: AbortSignal.timeout(25000) });
      if (res.status === 429 || res.status >= 500) throw new Error("HTTP " + res.status);
      return res;
    } catch (e) {
      if (i === tries) throw e;
      await sleep(2000 * i);
    }
  }
}
const text = async (url, opts) => { const r = await http(url, opts); if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`); return r.text(); };
const json = async (url, opts) => { const r = await http(url, opts); if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`); return r.json(); };
const readJSON = async (u, d) => { try { return JSON.parse(await readFile(u, "utf8")); } catch { return d; } };
const exists = async u => { try { await access(u); return true; } catch { return false; } };
const meta = (html, prop) => {
  const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, "i");
  const m = html.match(re1) || html.match(re2);
  return m ? decodeEntities(m[1]).trim() : "";
};

// ---------- AMPsuite store ----------
export async function storeIds() {
  const ids = [];
  for (let p = 1; p <= 30; p++) {
    const html = await text(`${STORE}?p=${p}`);
    const found = [...html.matchAll(/view_release\?release=(\d+)/g)].map(m => +m[1]);
    const fresh = found.filter(id => !ids.includes(id));
    if (!fresh.length) break;
    ids.push(...fresh);
  }
  return ids;
}

export async function storeRelease(id) {
  const html = await text(`${STORE}/view_release?release=${id}`);
  const t = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
  if (!t) throw new Error("no title on release " + id);
  const parts = decodeEntities(t).split(" / ").map(s => s.trim());
  // "Huka / Bigitam, Elastic / Comet Collective"
  const label = parts.length >= 3 ? parts.pop() : "";
  const artistStr = parts.length >= 2 ? parts.pop() : "";
  const title = parts.join(" / ");
  const genre = decodeEntities((html.match(/[?&]genre=\d+["'][^>]*>\s*([^<]+?)\s*</) || [])[1] || "");
  return {
    id, title,
    artists: artistStr.split(/\s*,\s*/).filter(Boolean),
    label, genre,
    blurb: meta(html, "og:description") || meta(html, "description"),
    artSource: meta(html, "og:image"),
  };
}

async function downloadArt(r) {
  if (!r.artSource) return;
  const file = new URL(`${r.slug}.jpg`, ART_DIR);
  if (r.art && await exists(file)) return;
  const res = await http(r.artSource);
  if (!res.ok) throw new Error("artwork HTTP " + res.status);
  await mkdir(ART_DIR, { recursive: true });
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  r.art = `art/${r.slug}.jpg`;
}

// ---------- Label catalogs (fetched once per run) ----------
async function beatportCatalog(cfg) {
  if (!cfg.beatportLabel) return [];
  const out = [];
  for (let p = 1; p <= 4; p++) {
    let html;
    try { html = await text(`${cfg.beatportLabel}?page=${p}&per_page=50`); } catch (e) { if (p === 1) throw e; break; }
    if (p === 1) say(`  beatport page 1: ${html.length} bytes, ${(html.match(/\/release\//g) || []).length} release links`);
    const items = [...html.matchAll(/\/release\/([a-z0-9-]+)\/(\d+)/g)].map(m => ({ slug: m[1], url: `https://www.beatport.com/release/${m[1]}/${m[2]}` }));
    const fresh = items.filter(i => !out.some(o => o.url === i.url));
    if (!fresh.length) break;
    out.push(...fresh);
  }
  return out;
}

async function bandcampCatalog(cfg) {
  if (!cfg.bandcamp) return [];
  const html = await text(`${cfg.bandcamp.replace(/\/$/, "")}/music`);
  return [...new Set([...html.matchAll(/href=["'](?:https?:\/\/[^"']+)?(\/(?:album|track)\/[a-z0-9-]+)["']/g)].map(m => m[1]))]
    .map(path => ({ slug: path.split("/").pop(), url: cfg.bandcamp.replace(/\/$/, "") + path }));
}

async function soundcloudCatalog(cfg) {
  const out = [];
  for (const prof of cfg.soundcloudProfiles || []) {
    const base = prof.replace(/\/$/, "");
    const user = base.split("/").pop();
    for (const page of [base + "/tracks", base + "/sets"]) {
      try {
        const html = await text(page);
        for (const m of html.matchAll(/<a[^>]+itemprop=["']url["'][^>]+href=["'](\/[^"']+)["'][^>]*>([^<]+)<\/a>/g))
          if (m[1].startsWith("/" + user + "/")) out.push({ url: "https://soundcloud.com" + m[1], title: decodeEntities(m[2]), slug: m[1].split("/").pop() });
      } catch (e) { say("  ! SoundCloud", page, e.message); }
    }
  }
  return out;
}

async function youtubeCatalog(cfg) {
  const out = [];
  for (const ch of cfg.youtubeChannels || []) {
    try {
      let id = (ch.match(/UC[\w-]{22}/) || [])[0];
      if (!id) {
        const page = await text(ch.replace(/\/$/, "") + "/videos");
        id = (page.match(/"(?:channelId|externalId)":"(UC[\w-]{22})"/) || page.match(/channel\/(UC[\w-]{22})/) || [])[1];
        if (!id) throw new Error("could not find the channel ID on " + ch);
      }
      const xml = await text(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
      for (const e of xml.split("<entry>").slice(1)) {
        const title = decodeEntities((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
        const url = (e.match(/<link rel="alternate" href="([^"]+)"/) || [])[1];
        if (url) out.push({ title, url });
      }
    } catch (e) { say("  ! YouTube", ch, e.message); }
  }
  return out;
}

// ---------- Per-release lookups ----------
const slugCandidates = r => {
  const t = slugify(r.title), a = slugify(r.artists.join(" "));
  return [t, `${a}-${t}`, `${slugify(r.artists.join(" & "))}-${t}`];
};

function fromCatalog(cat, r) {
  const want = slugCandidates(r);
  const hit = cat.find(i => want.includes(i.slug)) || cat.find(i => i.title && matches(r, i.title, i.title));
  return hit?.url;
}

async function bandcampDirect(cfg, r) {
  if (!cfg.bandcamp) return;
  const base = cfg.bandcamp.replace(/\/$/, "");
  for (const kind of ["album", "track"]) {
    const url = `${base}/${kind}/${slugify(r.title)}`;
    try { const res = await http(url, { redirect: "manual" }, 1); if (res.status === 200) return url; } catch {}
  }
}

async function soundcloudDirect(cfg, r) {
  for (const prof of cfg.soundcloudProfiles || []) {
    const base = prof.replace(/\/$/, "");
    for (const slug of [...new Set(slugCandidates(r))]) {
      for (const url of [`${base}/${slug}`, `${base}/sets/${slug}`]) {
        try { const res = await http(url, { redirect: "manual" }, 1); if (res.status === 200) return url; } catch {}
      }
    }
  }
}

let lastApple = 0;
async function itunes(cfg, term, entity) {
  const wait = 3200 - (Date.now() - lastApple); if (wait > 0) await sleep(wait); // iTunes allows ~20 calls/min
  lastApple = Date.now();
  const d = await json(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=${entity}&limit=50&country=${cfg.appleCountry || "US"}`);
  return d.results || [];
}
async function apple(cfg, r) {
  // Try each artist with the title, as an album first and then as a song
  for (const artist of r.artists.length ? r.artists : [""]) {
    const albums = await itunes(cfg, `${artist} ${r.title}`.trim(), "album");
    const a = albums.find(x => matches(r, x.collectionName, x.artistName));
    if (a) return a.collectionViewUrl.replace(/\?.*$/, "");
    const songs = await itunes(cfg, `${artist} ${r.title}`.trim(), "song");
    const s = songs.find(x => matches(r, x.collectionName, x.artistName) || matches(r, x.trackName, x.artistName));
    if (s) return s.collectionViewUrl.replace(/\?.*$/, "");
  }
}

let spotifyToken;
async function spotify(r) {
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) return;
  if (!spotifyToken) {
    const res = await http("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic " + Buffer.from(env.SPOTIFY_CLIENT_ID + ":" + env.SPOTIFY_CLIENT_SECRET).toString("base64") },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error("Spotify login failed, HTTP " + res.status + ". Check the Spotify keys in GitHub secrets.");
    spotifyToken = (await res.json()).access_token;
  }
  const q = encodeURIComponent(`album:${r.title} artist:${r.artists[0] || ""}`);
  const data = await json(`https://api.spotify.com/v1/search?q=${q}&type=album&limit=20`, { headers: { authorization: "Bearer " + spotifyToken } });
  const hit = (data.albums?.items || []).find(x => matches(r, x.name, x.artists.map(a => a.name).join(" ")));
  return hit?.external_urls?.spotify;
}

async function odesli(fromUrl) {
  if (!env.ODESLI_API_KEY || !fromUrl) return {};
  const d = await json(`https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(fromUrl)}&key=${env.ODESLI_API_KEY}`);
  const l = d.linksByPlatform || {};
  return { spotify: l.spotify?.url, apple: l.appleMusic?.url, youtube: l.youtube?.url || l.youtubeMusic?.url, soundcloud: l.soundcloud?.url, bandcamp: l.bandcamp?.url };
}

// ---------- Main ----------
async function main() {
  const cfg = await readJSON(CONFIG, {});
  const db = await readJSON(DATA, { releases: [] });
  const overrides = await readJSON(OVERRIDES, {});
  const before = JSON.stringify(db);
  const byId = new Map(db.releases.map(r => [r.id, r]));
  const firstRun = db.releases.length === 0 || db.releases.every(r => !r.addedAt);
  const today = new Date().toISOString().slice(0, 10);

  // 1. New releases from the store
  say("Checking the Comet store…");
  const ids = await storeIds();
  say(`  ${ids.length} releases in the store`);
  const added = [];
  for (const id of ids) {
    const existing = byId.get(id);
    if (existing && existing.title && existing.artSource) continue;
    try {
      const info = await storeRelease(id);
      const r = existing || { id, links: {}, checks: 0 };
      for (const [k, v] of Object.entries(info)) if (v && (!Array.isArray(v) || v.length)) r[k] = v;
      if (!r.slug) {
        let slug = slugify(info.title) || "release-" + id;
        if (db.releases.some(o => o !== r && o.slug === slug)) slug += "-" + id;
        r.slug = slug;
      }
      r.addedAt ||= today;
      if (firstRun && !existing?.addedAt) r.backfill = true;
      r.links.store = `${STORE}/view_release?release=${id}`;
      if (!existing) { db.releases.push(r); byId.set(id, r); added.push(r); say(`  + New: ${r.title} by ${r.artists.join(", ")}`); }
    } catch (e) { say(`  ! Could not read store release ${id}: ${e.message}`); }
  }
  for (const r of db.releases) {
    try { await downloadArt(r); } catch (e) { say(`  ! Artwork for ${r.title}: ${e.message}`); }
  }

  // 2. Which releases still need links
  const KEYS = ["beatport", "bandcamp", "spotify", "apple", "soundcloud", "youtube"];
  const enabled = k => ({
    beatport: !!cfg.beatportLabel, bandcamp: !!cfg.bandcamp, apple: true,
    spotify: !!(env.SPOTIFY_CLIENT_ID || env.ODESLI_API_KEY),
    soundcloud: !!((cfg.soundcloudProfiles || []).length || env.ODESLI_API_KEY),
    youtube: !!((cfg.youtubeChannels || []).length || env.ODESLI_API_KEY),
  })[k];
  const missing = r => KEYS.filter(k => enabled(k) && !r.links[k] && !(overrides[r.slug] && k in overrides[r.slug]));
  const queue = [
    ...added,
    ...db.releases.filter(r => !added.includes(r) && missing(r).length && (r.checks || 0) < MAX_CHECKS)
      .sort((a, b) => (a.lastChecked || "").localeCompare(b.lastChecked || "") || b.id - a.id)
      .slice(0, PER_RUN),
  ];
  say(`Looking up platform links for ${queue.length} releases…`);

  const cats = {};
  for (const [k, fn] of [["beatport", beatportCatalog], ["bandcamp", bandcampCatalog], ["soundcloud", soundcloudCatalog], ["youtube", youtubeCatalog]]) {
    try { cats[k] = queue.length ? await fn(cfg) : []; say(`  ${k} catalog: ${cats[k].length} items`); }
    catch (e) { cats[k] = []; say(`  ! ${k} catalog unavailable: ${e.message}`); }
  }

  for (const r of queue) {
    const need = missing(r);
    const found = {};
    const tryIt = async (k, fn) => { if (!need.includes(k) || r.links[k]) return; try { const u = await fn(); if (u) { r.links[k] = u; found[k] = u; } } catch (e) { say(`  ! ${k} for ${r.title}: ${e.message}`); } };
    await tryIt("beatport", async () => fromCatalog(cats.beatport, r));
    await tryIt("bandcamp", async () => fromCatalog(cats.bandcamp, r) || bandcampDirect(cfg, r));
    await tryIt("soundcloud", async () => fromCatalog(cats.soundcloud, r) || soundcloudDirect(cfg, r));
    await tryIt("youtube", async () => cats.youtube.find(v => videoMatches(r, v.title))?.url);
    await tryIt("apple", () => apple(cfg, r));
    await tryIt("spotify", () => spotify(r));
    if (missing(r).length && (r.links.apple || r.links.spotify)) {
      try {
        const o = await odesli(r.links.spotify || r.links.apple);
        for (const k of missing(r)) if (o[k]) { r.links[k] = o[k]; found[k] = o[k]; }
      } catch (e) { say(`  ! Odesli for ${r.title}: ${e.message}`); }
    }
    r.checks = (r.checks || 0) + 1;
    r.lastChecked = today;
    const f = Object.keys(found);
    say(`  ${r.title}: ${f.length ? "found " + f.join(", ") : "nothing new"}${missing(r).length ? " · still missing " + missing(r).join(", ") : ""}`);
  }

  db.releases.sort((a, b) => b.id - a.id);
  const changed = before !== JSON.stringify(db);
  if (changed) db.updated = new Date().toISOString();
  if (changed) { await writeFile(DATA, JSON.stringify(db, null, 2) + "\n"); say("Saved changes."); }
  else say("No changes.");

  await writeFile(new URL("data/last-sync.log", ROOT), `Sync ${new Date().toISOString()}\n` + log.join("\n") + "\n");
  if (env.GITHUB_STEP_SUMMARY) await writeFile(env.GITHUB_STEP_SUMMARY, "## Comet Links sync\n\n```\n" + log.join("\n") + "\n```\n", { flag: "a" });
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
export { main };
