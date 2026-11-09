// Fetches news for every game in games.json and writes site/data/news.json.
// No dependencies: needs Node 18+ (built-in fetch).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(path.join(root, "games.json"), "utf8"));
const perGame = config.itemsPerGame ?? 20;
const UA = "patchwork (GitHub Pages static site)";

const decodeEntities = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

const STEAM_IMG = "https://clan.akamai.steamstatic.com/images/";

function firstImage(raw) {
  const m =
    raw.match(/\[img\]\s*(\S+?)\s*\[\/img\]/i) ||
    raw.match(/\[img\s+src="([^"]+)"/i) ||
    raw.match(/<img[^>]+src=["']([^"']+)["']/i) ||
    raw.match(/(\{STEAM_CLAN_IMAGE\}\/\S+?\.(?:png|jpe?g|gif|webp))/i);
  if (!m) return null;
  const url = m[1].replace("{STEAM_CLAN_IMAGE}/", STEAM_IMG);
  return /^https?:\/\//.test(url) ? url : null;
}

function toText(raw, max = 280) {
  const text = decodeEntities(raw)
    .replace(/\\([[\]])/g, "$1")
    .replace(/\{STEAM_CLAN_IMAGE\}\S*/g, "")
    .replace(/\[img[\s\S]*?\[\/img\]/gi, "")
    .replace(/\[\/?[a-z0-9*]+(?:[= ][^\]]*)?\]/gi, " ") // BBCode
    .replace(/<[^>]+>/g, " ") // HTML
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max).replace(/\s\S*$/, "") + "…" : text;
}

async function steamNews(game) {
  const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${game.steamAppId}&count=${perGame * 3}&format=json`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Steam ${res.status}`);
  const items = (await res.json()).appnews?.newsitems ?? [];
  return items
    .filter((n) => !(game.officialOnly ?? true) || n.feedname === "steam_community_announcements")
    .slice(0, perGame)
    .map((n) => ({
      id: `steam-${n.gid}`,
      title: decodeEntities(n.title),
      url: n.url,
      date: n.date * 1000,
      source: n.feedlabel || "Steam",
      summary: toText(n.contents),
      image: firstImage(n.contents),
      tags: (n.tags ?? []).some((t) => /patchnotes/i.test(t)) ? ["Patch notes"] : [],
    }));
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(m[1]).trim() : "";
}

async function feedNews(feedUrl) {
  const res = await fetch(feedUrl, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Feed ${res.status}`);
  const xml = await res.text();
  const feedTitle = tag(xml.split(/<(?:item|entry)[\s>]/i)[0], "title") || new URL(feedUrl).hostname;
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  return blocks.slice(0, perGame).map((b) => {
    const link =
      b.match(/<link[^>]+rel=["']alternate["'][^>]*href=["']([^"']+)/i)?.[1] ||
      b.match(/<link[^>]*href=["']([^"']+)/i)?.[1] ||
      tag(b, "link");
    const body = tag(b, "description") || tag(b, "content") || tag(b, "summary") || tag(b, "content:encoded");
    const media = b.match(/<(?:media:thumbnail|media:content|enclosure)[^>]+url=["']([^"']+)/i)?.[1];
    const when = Date.parse(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"));
    return {
      id: `feed-${link}`,
      title: toText(tag(b, "title"), 200),
      url: decodeEntities(link),
      date: Number.isNaN(when) ? Date.now() : when,
      source: feedTitle,
      summary: toText(body),
      image: media ? decodeEntities(media) : firstImage(decodeEntities(body)),
      tags: [],
    };
  });
}

// Global MapleStory, from Nexon's news API. Sunny Sundays aren't standalone posts:
// they're a schedule table inside each patch-notes post, so we parse them out.
const NEXON = "https://g.nexonstatic.com";
const MS_TAGS = { update: "Patch notes", events: "Event", sale: "Cash shop", maintenance: "Maintenance", general: "Notice", community: "Community" };

function parseSunnySundays(post) {
  const start = post.body?.search(/id="SunnySunday"/i) ?? -1;
  if (start < 0) return [];
  const section = post.body.slice(start, post.body.indexOf("</table>", start));
  const url = `https://www.nexon.com/maplestory/news/${post.category}/${post.id}#SunnySunday`;
  return [...section.matchAll(/<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)]
    .map(([, dateCell, perksCell]) => {
      const label = toText(dateCell, 80);
      const date = Date.parse(label + " 00:00 UTC");
      const perks = [...perksCell.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
        .map((m) => toText(m[1], 200))
        .filter((p) => p && !/^excludes|not eligible/i.test(p));
      return Number.isNaN(date) ? null : {
        id: `ms-sunny-${date}`,
        title: `Sunny Sunday: ${label}`,
        url,
        date,
        source: post.name,
        summary: perks.join(" · "),
        image: null,
        tags: ["Sunny Sunday"],
      };
    })
    .filter(Boolean);
}

async function mapleStoryNews(opts) {
  const res = await fetch(`${NEXON}/maplestory/cms/v1/news`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Nexon ${res.status}`);
  const all = (await res.json()).filter((p) => opts.classicWorld || !p.isMSCW);
  const cats = opts.categories ?? ["update", "events"];
  const items = all
    .filter((p) => cats.includes(p.category))
    .slice(0, perGame)
    .map((p) => ({
      id: `ms-${p.id}`,
      title: decodeEntities(p.name),
      url: `https://www.nexon.com/maplestory/news/${p.category}/${p.id}`,
      date: Date.parse(p.liveDate),
      source: "maplestory.nexon.net",
      summary: toText(p.summary ?? ""),
      image: p.imageThumbnail ? NEXON + p.imageThumbnail : null,
      tags: MS_TAGS[p.category] ? [MS_TAGS[p.category]] : [],
    }));

  if (opts.sunnySundays ?? true) {
    const sunny = new Map();
    for (const p of all.filter((p) => p.category === "update").slice(0, 4)) {
      const r = await fetch(`${NEXON}/maplestory/cms/v1/news/${p.id}`, { headers: { "User-Agent": UA } });
      if (!r.ok) continue;
      for (const s of parseSunnySundays(await r.json())) if (!sunny.has(s.id)) sunny.set(s.id, s);
    }
    // Older Sundays are just clutter: keep the last four weeks plus anything upcoming.
    const cutoff = Date.now() - 28 * 86400e3;
    items.push(...[...sunny.values()].filter((s) => s.date >= cutoff));
  }
  return items;
}

const games = [];
const errors = [];
for (const game of config.games) {
  const jobs = [];
  if (game.steamAppId && !game.noSteamNews) jobs.push(["Steam", () => steamNews(game)]);
  if (game.maplestory) jobs.push(["Nexon", () => mapleStoryNews(game.maplestory)]);
  for (const f of game.feeds ?? []) jobs.push([f, () => feedNews(f)]);

  const items = [];
  for (const [label, job] of jobs) {
    try {
      items.push(...(await job()));
    } catch (e) {
      errors.push(`${game.name} (${label}): ${e.message}`);
    }
  }
  const seen = new Set();
  const unique = items
    .filter((i) => i.url && !seen.has(i.id) && seen.add(i.id))
    .sort((a, b) => b.date - a.date);

  games.push({
    name: game.name,
    image: game.steamAppId ? `https://cdn.akamai.steamstatic.com/steam/apps/${game.steamAppId}/header.jpg` : game.image ?? null,
    items: unique,
  });
  console.log(`${game.name}: ${unique.length} items`);
}

if (errors.length) console.warn("Errors:\n  " + errors.join("\n  "));
if (games.every((g) => g.items.length === 0)) {
  console.error("No news fetched for any game; not overwriting data.");
  process.exit(1);
}

const out = path.join(root, "site", "data");
await mkdir(out, { recursive: true });
await writeFile(
  path.join(out, "news.json"),
  JSON.stringify({ updated: Date.now(), errors, games }, null, 1)
);
console.log("Wrote site/data/news.json");
