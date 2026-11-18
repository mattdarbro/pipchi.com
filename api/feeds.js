/**
 * GET /api/feeds — the parts of the home page that keep themselves current.
 *
 * Reads public feeds only (no API keys): YouTube's channel and playlist RSS
 * feeds and the Pipchi podcast RSS feeds. Vercel's CDN caches the answer for
 * six hours, so new videos and episodes show up on pipchi.com the same day
 * without anyone touching the site.
 *
 * ── THE ONE PLACE TO CHANGE THINGS ─────────────────────────────────────────
 * FEATURED_PLAYLIST_ID: the YouTube playlist whose videos fill "Featured".
 *   Paste the playlist's id (the part after "list=" in its address). Reorder
 *   or swap videos in that playlist on YouTube and the site follows. Leave it
 *   empty and the page shows its hand-set featured film instead.
 * CHANNELS: the YouTube channels whose newest uploads fill "Latest videos".
 * PODCASTS: the podcast feeds whose newest episodes fill "Latest episodes".
 * ────────────────────────────────────────────────────────────────────────────
 */
export const FEATURED_PLAYLIST_ID = "";

export const CHANNELS = [
  { id: "UCdcP4KzAXYDPxRkmF2BfMKA", name: "Pipchi Stories" },
  { id: "UCDFQnSunwNbbTvxtLuNY4PA", name: "Pipchi Podcasts" },
  { id: "UCv24Hx55qHo4D1VvxmEFfQw", name: "Matt Darbro" },
];

export const PODCASTS = [
  { feed: "https://podcasts.pipchi.com/mr-chester/feed.xml", name: "The Mr. Chester Mysteries" },
  { feed: "https://podcasts.pipchi.com/thirty-minutes-away/feed.xml", name: "Thirty Minutes Away" },
];

const LATEST_VIDEOS = 6;
const LATEST_EPISODES = 4;
const FEATURED_MAX = 3;

// ── tiny XML helpers (feeds are simple and well-formed; no dependency needed)
const decode = (s = "") =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, "&")
    .trim();
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : "";
};
const attr = (xml, name, a) => {
  const m = xml.match(new RegExp(`<${name}\\s[^>]*?${a}="([^"]*)"`));
  return m ? decode(m[1]) : "";
};
const blocks = (xml, name) => xml.match(new RegExp(`<${name}[\\s>][\\s\\S]*?</${name}>`, "g")) || [];

// Only hand the page addresses on hosts we expect.
const safe = (url, hosts) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && hosts.some((h) => u.hostname === h || u.hostname.endsWith("." + h)) ? u.href : "";
  } catch { return ""; }
};

export function parseYouTube(xml, source) {
  return blocks(xml, "entry")
    .map((e) => {
      const id = tag(e, "yt:videoId");
      const link = attr(e, "link", "href");
      if (!/^[\w-]{11}$/.test(id)) return null;
      return {
        id,
        title: tag(e, "title"),
        published: tag(e, "published"),
        url: `https://www.youtube.com/watch?v=${id}`,
        thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        short: link.includes("/shorts/"),
        source,
      };
    })
    .filter(Boolean);
}

export function parsePodcast(xml, show) {
  const showArt = safe(attr(xml.split(/<item[\s>]/)[0], "itunes:image", "href"), ["pipchi.com"]);
  return blocks(xml, "item")
    .map((it) => {
      const audio = safe(attr(it, "enclosure", "url"), ["pipchi.com"]);
      if (!audio) return null;
      const date = new Date(tag(it, "pubDate"));
      return {
        title: tag(it, "title"),
        published: isNaN(date) ? "" : date.toISOString(),
        audio,
        art: safe(attr(it, "itunes:image", "href"), ["pipchi.com"]) || showArt,
        duration: tag(it, "itunes:duration"),
        show,
      };
    })
    .filter(Boolean);
}

async function getText(url) {
  const r = await fetch(url, { headers: { "User-Agent": "pipchi.com feeds" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

const newestFirst = (a, b) => (b.published || "").localeCompare(a.published || "");

export async function buildFeeds() {
  const yt = (q) => `https://www.youtube.com/feeds/videos.xml?${q}`;

  const [featured, channels, podcasts] = await Promise.all([
    FEATURED_PLAYLIST_ID
      ? getText(yt(`playlist_id=${encodeURIComponent(FEATURED_PLAYLIST_ID)}`))
          .then((x) => parseYouTube(x, "Featured").filter((v) => !v.short).slice(0, FEATURED_MAX))
          .catch(() => [])
      : Promise.resolve([]),
    Promise.all(
      CHANNELS.map((c) => getText(yt(`channel_id=${c.id}`)).then((x) => parseYouTube(x, c.name)).catch(() => [])),
    ),
    Promise.all(PODCASTS.map((p) => getText(p.feed).then((x) => parsePodcast(x, p.name)).catch(() => []))),
  ]);

  // A featured playlist keeps the order Matt gives it on YouTube.
  const featuredIds = new Set(featured.map((v) => v.id));
  const allEpisodes = podcasts.flat().sort(newestFirst);
  // Podcast episodes also go up on YouTube; show those once, under Latest episodes.
  const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const episodeTitles = new Set(allEpisodes.map((e) => norm(e.title)));
  const videos = channels
    .flat()
    .filter((v) => !v.short && !featuredIds.has(v.id) && !episodeTitles.has(norm(v.title)))
    .sort(newestFirst)
    .slice(0, LATEST_VIDEOS);
  const episodes = allEpisodes.slice(0, LATEST_EPISODES);

  return { featured, videos, episodes, updated: new Date().toISOString() };
}

export default async function handler(req, res) {
  try {
    const data = await buildFeeds();
    // Six hours fresh at the CDN; serve the old copy for up to a day while refreshing.
    res.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=86400");
    res.status(200).json(data);
  } catch {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ featured: [], videos: [], episodes: [] });
  }
}
