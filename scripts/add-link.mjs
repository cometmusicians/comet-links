// Saves a link pasted in the "Add a link" form into data/overrides.json.
import { readFile, writeFile } from "node:fs/promises";
import { norm, newest } from "./lib.mjs";

let url = (process.env.LINK_URL || "").trim();
// Short share links (on.soundcloud.com, spotify.link…) are turned into the full address
if (/on\.soundcloud\.com|spotify\.link|bit\.ly/.test(url)) {
  try { const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0" } }); if (res.ok && res.url) url = res.url; } catch {}
}
url = url.replace(/[?&](si|utm_[a-z]+|l|ref|p|c)=[^&]*/g, "").replace(/\?&?$/, "").replace(/\?&/, "?");
const name = (process.env.LINK_RELEASE || "").trim();
const platform =
  /beatport\.com/.test(url) ? "beatport" : /spotify\.com/.test(url) ? "spotify" : /music\.apple\.com/.test(url) ? "apple" :
  /bandcamp\.com/.test(url) ? "bandcamp" : /soundcloud\.com/.test(url) ? "soundcloud" : /youtu\.?be/.test(url) ? "youtube" : null;
if (!platform) { console.error(`This link isn't from one of the page's platforms: ${url}`); process.exit(1); }

const db = JSON.parse(await readFile("data/releases.json", "utf8"));
const list = db.releases.filter(r => r.title).sort(newest);
const r = name ? list.find(x => norm(x.title) === norm(name)) || list.find(x => norm(x.title).includes(norm(name))) : list[0];
if (!r) { console.error(`No release called "${name}". Check the spelling or leave it empty for the newest release.`); process.exit(1); }

const overrides = JSON.parse(await readFile("data/overrides.json", "utf8"));
(overrides[r.slug] ||= {})[platform] = url.replace(/music\.apple\.com\/[a-z]{2}\//, "music.apple.com/us/");
await writeFile("data/overrides.json", JSON.stringify(overrides, null, 2) + "\n");
console.log(`Added ${platform} for ${r.title}: ${url}`);
