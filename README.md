# Comet Collective Links

The link page at https://links.comet-collective.com.

- **New releases appear automatically.** Every day (and every 3 hours on Fridays) GitHub runs `scripts/sync.mjs`. It reads the Comet store, adds new releases with their artwork, and looks up direct links on Beatport, Bandcamp, Apple Music, Spotify, SoundCloud and YouTube. A missing link is retried on each run for about two weeks.
- **Netlify rebuilds the site** whenever the data changes (`scripts/build.mjs` → `dist/`).

## Fix or add a link by hand
Edit `data/overrides.json` on GitHub (pencil icon) and commit:

```json
{
  "huka": {
    "spotify": "https://open.spotify.com/album/...",
    "youtube": ""
  }
}
```
A link here always wins. `""` shows that button as "Coming soon". `"hidden": true` hides the whole release.

## Settings
`data/config.json`: label pages on each platform, SoundCloud profiles, YouTube channel IDs, Instagram link, logo file.

Optional GitHub secrets (Settings → Secrets and variables → Actions):
- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`: from developer.spotify.com
- `ODESLI_API_KEY`: from developers@song.link, fills Spotify/YouTube/SoundCloud from the Apple Music link

Run a sync now: Actions → Sync releases → Run workflow.
