// Shared helpers for sync and build.

export const SITE_URL = "https://links.comet-collective.com";
export const STORE = "https://cometcollective.ampsuite.com/store";

export const PLATFORMS = [
  // group: "buy" or "stream"; order here is the order on the page
  { key: "store",      name: "Comet Store",  group: "buy",    action: "Buy" },
  { key: "beatport",   name: "Beatport",     group: "buy",    action: "Buy" },
  { key: "bandcamp",   name: "Bandcamp",     group: "buy",    action: "Buy" },
  { key: "spotify",    name: "Spotify",      group: "stream", action: "Play" },
  { key: "apple",      name: "Apple Music",  group: "stream", action: "Play" },
  { key: "soundcloud", name: "SoundCloud",   group: "stream", action: "Listen" },
  { key: "youtube",    name: "YouTube",      group: "stream", action: "Watch" },
];

// Same rules Beatport and Bandcamp use for URL slugs:
// "Imagine (Leex & Widox Remix)" -> "imagine-leex-widox-remix", "Jimmy's Dream" -> "jimmys-dream"
export function slugify(s) {
  return String(s)
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’.​]/g, "")
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Loose comparison form: lowercase words, no punctuation, no "- Single"/"- EP" suffixes
export function norm(s) {
  return String(s)
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+-\s+(single|ep)$/i, "")
    .replace(/\((original mix|single|ep)\)/g, "")
    .replace(/['’.​]/g, "")
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// Artist names without country tags: "ORNAMENT (IL)" -> "ornament"
export const artistKey = a => norm(String(a).replace(/\s*\([^)]*\)\s*/g, " "));

// Does a platform's title/artist pair describe this release?
export function matches(release, title, artistText) {
  const t = norm(title), want = norm(release.title);
  const extra = t.startsWith(want + " ") ? t.slice(want.length).trim() : null;
  const titleOk = t === want || (extra !== null && /^(single|ep|the remixes|original mix)$/.test(extra));
  if (!titleOk) return false;
  if (release.artists.some(a => /various/i.test(a))) return true;
  const at = " " + norm(artistText || "") + " ";
  return release.artists.some(a => at.includes(" " + norm(a) + " ") || at.includes(" " + artistKey(a) + " "));
}

// YouTube video titles are usually "Artist & Artist - Title" or "Title | Artist"
export function videoMatches(release, videoTitle) {
  const v = " " + norm(videoTitle) + " ";
  const t = norm(release.title);
  if (!v.includes(" " + t + " ")) return false;
  if (release.artists.some(a => /various/i.test(a))) return true;
  return release.artists.some(a => v.includes(" " + norm(a) + " ") || v.includes(" " + artistKey(a) + " "));
}

// How alike two strings are, 0..1 (tolerates small typos like "Elatic" for "Elastic")
export function similar(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length, n = b.length, d = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= n; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return 1 - d[n] / Math.max(m, n);
}

// YouTube uploads are "Artist - Track"; match against the release title or any of its track names
export function videoMatchesFuzzy(release, videoTitle) {
  if (videoMatches(release, videoTitle)) return true;
  const parts = String(videoTitle).split(/\s+[-–—|]\s+/);
  if (parts.length < 2) return false;
  const [who, what] = [parts[0], parts.slice(1).join(" ").replace(/\((official|full|.*?video|.*?mix)\)|\[.*?\]/gi, "")];
  const names = [release.title, ...(release.tracks || [])];
  const titleOk = names.some(n => similar(n, what) >= 0.8);
  const artistOk = release.artists.some(a => /various/i.test(a)) || release.artists.some(a => who.split(/\s*(?:&|,| x | feat\.? )\s*/i).some(w => similar(artistKey(a), artistKey(w)) >= 0.75));
  return titleOk && artistOk;
}

// Newest first: the day a release first appeared in the store, then its release date, then store ID
export const newest = (a, b) => (b.addedAt || "").localeCompare(a.addedAt || "") || (b.releaseDate || "").localeCompare(a.releaseDate || "") || b.id - a.id;

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
