# Patchwork

A static site on GitHub Pages that collects patch notes and announcements for the games I play.
A GitHub Actions workflow fetches the news every 3 hours and redeploys the site — no server, no API keys.

## Change the games

Edit [`games.json`](games.json):

```json
{ "name": "Rust", "steamAppId": 252490, "officialOnly": true, "feeds": ["https://www.reddit.com/r/playrust/.rss"] }
```

- `steamAppId` — the number in the Steam store URL (`store.steampowered.com/app/<id>`).
- `officialOnly` — `true` keeps only the developer's announcements; `false` also includes press coverage Steam aggregates.
- `feeds` — optional RSS/Atom URLs, for non-Steam games or extra sources. A non-Steam game can also set `"image"` for its fallback thumbnail.
- `noSteamNews` — use the Steam ID only for the cover image (e.g. FFXIV uses the Lodestone feed instead).
- `maplestory` — pulls Global MapleStory news from Nexon:
  - `categories`: any of `update`, `events`, `sale`, `maintenance`, `general`, `community`
  - `sunnySundays`: parses the Sunny Sunday schedule out of the latest patch notes into one entry per Sunday
  - `classicWorld`: include MapleStory Classic World posts

Commit and push; the site rebuilds automatically.

## One-time GitHub setup

In the repo on GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
After the first workflow run the site is at `https://karan-tlr.github.io/patchwork/`.
To refresh right away: **Actions → Fetch news and deploy → Run workflow**.

## Run locally

```bash
node scripts/fetch-news.mjs
npx serve site
```
