// One-off check: what does Spotify list as newest for the label and its artists?
import { readFile, writeFile } from "node:fs/promises";
const env = process.env, out = [];
const say = s => { console.log(s); out.push(s); };
const tok = (await (await fetch("https://accounts.spotify.com/api/token", { method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic " + Buffer.from(env.SPOTIFY_CLIENT_ID + ":" + env.SPOTIFY_CLIENT_SECRET).toString("base64") },
  body: "grant_type=client_credentials" })).json()).access_token;
const H = { authorization: "Bearer " + tok };
const search = async q => { const r = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=album&limit=10`, { headers: H }); return r.ok ? (await r.json()).albums.items : (say(`  HTTP ${r.status} for ${q}`), []); };
const line = a => `  ${a.release_date}  ${a.name}  —  ${a.artists.map(x => x.name).join(", ")}  [${a.album_type}]  ${a.external_urls.spotify}`;
for (const q of ['label:"Comet Collective" tag:new', 'label:"Comet Collective" year:2026', 'label:"Comet Musicians" year:2026', 'label:Comet tag:new', 'label:"Comet Collective"']) {
  say(`\n# ${q}`); (await search(q)).sort((a, b) => b.release_date.localeCompare(a.release_date)).forEach(a => say(line(a)));
}
const db = JSON.parse(await readFile("data/releases.json", "utf8"));
const artists = [...new Set(db.releases.slice(0, 40).flatMap(r => r.artists))].filter(a => !/various/i.test(a));
say(`\n# Newest per artist (last 30 days), ${artists.length} artists`);
const cut = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
const seen = new Set();
for (const a of artists) for (const al of await search(`artist:"${a}" year:2026`))
  if (al.release_date >= cut && !seen.has(al.id)) { seen.add(al.id); say(line(al));
    const d = await fetch(`https://api.spotify.com/v1/albums/${al.id}`, { headers: H }); say(`      album details: HTTP ${d.status}${d.ok ? " label=" + (await d.json()).label : ""}`); }
await writeFile("data/spotify-check.log", out.join("\n") + "\n");
