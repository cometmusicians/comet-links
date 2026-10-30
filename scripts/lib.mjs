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

// Does a platform's title/artist pair describe this release?
export function matches(release, title, artistText) {
  const t = norm(title), want = norm(release.title);
  const extra = t.startsWith(want + " ") ? t.slice(want.length).trim() : null;
  const titleOk = t === want || (extra !== null && /^(single|ep|the remixes|original mix)$/.test(extra));
  if (!titleOk) return false;
  if (release.artists.some(a => /various/i.test(a))) return true;
  const at = " " + norm(artistText || "") + " ";
  return release.artists.some(a => at.includes(" " + norm(a) + " "));
}

// YouTube video titles are usually "Artist & Artist - Title" or "Title | Artist"
export function videoMatches(release, videoTitle) {
  const v = " " + norm(videoTitle) + " ";
  const t = norm(release.title);
  if (!v.includes(" " + t + " ")) return false;
  if (release.artists.some(a => /various/i.test(a))) return true;
  return release.artists.some(a => v.includes(" " + norm(a) + " "));
}

// Newest first: the day a release first appeared in the store, then its release date, then store ID
export const newest = (a, b) => (b.addedAt || "").localeCompare(a.addedAt || "") || (b.releaseDate || "").localeCompare(a.releaseDate || "") || b.id - a.id;

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
