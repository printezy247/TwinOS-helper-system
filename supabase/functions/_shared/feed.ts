/**
 * RSS 2.0 and Atom parsing for the research feeds (UPGRADE-IDEAS #9, Phase 5
 * "channel RSS").
 *
 * A feed is a published list, not a page scrape: the rules allow it, and
 * `queries.source` has carried `youtube_rss` since 0007 without a reader.
 * Pure parsing lives here so it can be tested without a network;
 * research/index.ts does the fetching and the writes.
 *
 * Hand-rolled like _shared/tme.ts — feeds are well-formed XML, and a parser
 * that reads one tag at a time is easier to reason about than a dependency
 * the Edge runtime would have to ship.
 */

export interface FeedItem {
  externalId: string;
  title: string;
  summary: string | null;
  link: string | null;
  publishedAt: string | null;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#34;": '"', "&apos;": "'", "&#39;": "'",
  "&nbsp;": " ", "&#160;": " ", "&mdash;": "—", "&ndash;": "–", "&hellip;": "…",
};

const unwrapCdata = (raw: string) => raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");

export function decodeEntities(raw: string): string {
  let s = unwrapCdata(raw);
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
  s = s.replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)));
  s = s.replace(/&(?:amp|lt|gt|quot|apos|nbsp|mdash|ndash|hellip);|&#34;|&#39;|&#160;/g, (m) => ENTITIES[m] ?? m);
  return s.trim();
}

/**
 * Readable text out of a title or summary. Stripped twice on purpose: once
 * before the entities are decoded (so a raw `<b>` never reaches the decoder),
 * and once after (so a feed that escaped its own markup, `&lt;p&gt;`, still
 * ends up as prose rather than as tags).
 */
function prose(raw: string): string {
  const plain = unwrapCdata(raw).replace(/<[^>]+>/g, " ");
  return decodeEntities(plain).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Inner text of the first `<name ...>` in `block`, still raw. */
function rawTag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return m && m[1].length ? m[1] : null;
}

/** Atom's `<link href="…"/>`; RSS 2.0's plain `<link>…</link>`. */
function linkOf(block: string): string | null {
  const href = /<link[^>]*\shref="([^"]+)"/i.exec(block);
  if (href) return decodeEntities(href[1]);
  const plain = rawTag(block, "link");
  return plain ? decodeEntities(plain) : null;
}

/** RFC 822 (`Sun, 05 Oct 2026 08:00:00 GMT`) or ISO 8601 → ISO instant, else null. */
export function parseDate(raw: string | null): string | null {
  if (!raw) return null;
  const at = Date.parse(decodeEntities(raw));
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

function blocks(xml: string, kind: "item" | "entry"): string[] {
  const rx = new RegExp(`<${kind}(?:\\s[^>]*)?>([\\s\\S]*?)</${kind}>`, "gi");
  return [...xml.matchAll(rx)].map((m) => m[1]);
}

/**
 * Every entry in the document. RSS 2.0 `<item>` and Atom `<entry>` are both
 * accepted; a feed that carries one kind is read in the order it published in.
 *
 * An entry with neither title nor summary is dropped: it is a link stub with
 * nothing to read, and keeping it would only cost a row nobody can use.
 */
export function parseFeed(xml: string): FeedItem[] {
  if (!xml || !/<(rss|feed|item|entry)\b/i.test(xml)) return [];
  const items = blocks(xml, "item");
  const entries = items.length ? [] : blocks(xml, "entry");
  const out: FeedItem[] = [];
  for (const block of items.length ? items : entries) {
    const title = rawTag(block, "title");
    const summary = prose(rawTag(block, "description") ?? rawTag(block, "summary") ?? rawTag(block, "content") ?? "");
    const link = linkOf(block);
    const cleanTitle = title ? prose(title) : null;
    if (!cleanTitle && !summary) continue;
    const published = parseDate(rawTag(block, "pubDate") ?? rawTag(block, "published") ?? rawTag(block, "updated"));
    const externalId = decodeEntities(rawTag(block, "guid") ?? "") || decodeEntities(rawTag(block, "id") ?? "") || link ||
      `${cleanTitle ?? summary}|${published ?? ""}`;
    out.push({ externalId, title: cleanTitle ?? externalId, summary: summary || null, link, publishedAt: published });
  }
  return out;
}

/**
 * Bluesky and Mastodon public endpoints (the two official APIs with a
 * keyword read and no key). They answer JSON, not XML, so they need their own
 * reader: everything else about a feed — id, text, link, time — is the same.
 *
 * A post has no title, so the headline is the first words of the post itself;
 * the whole text is still kept as the summary, which is what the idea scorer
 * reads.
 */
export type JsonFeedKind = "bluesky" | "mastodon";

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A headline that fits feed_items.title: cut on a word when there is one, ellipsis always inside `max`. */
function head(text: string, max = 80): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return (space > 20 ? cut.slice(0, space) : cut).trimEnd() + "…";
}

export function parseJsonFeed(payload: unknown, kind: JsonFeedKind): FeedItem[] {
  // Accept the response body as it arrives: already-parsed objects from the
  // route, or the raw text a fetch hands back.
  let data = payload;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return [];
    }
  }
  const out: FeedItem[] = [];
  if (kind === "bluesky") {
    const posts = Array.isArray(obj(data).posts) ? obj(data).posts as Record<string, unknown>[] : [];
    for (const p of posts) {
      const uri = str(p.uri);
      const text = str(obj(p.record).text).trim();
      if (!uri || !text) continue;
      const handle = str(obj(p.author).handle);
      const rkey = uri.split("/").pop() ?? "";
      out.push({
        externalId: uri,
        title: head(text),
        summary: text,
        link: handle ? `https://bsky.app/profile/${handle}/post/${rkey}` : uri,
        publishedAt: parseDate(str(obj(p.record).createdAt) || null),
      });
    }
  } else {
    const rows = Array.isArray(data) ? data as Record<string, unknown>[] : [];
    for (const s of rows) {
      const id = str(s.id);
      const text = prose(str(s.content));
      if (!id || !text) continue;
      out.push({
        externalId: id,
        title: head(text),
        summary: text,
        link: str(s.url) || null,
        publishedAt: parseDate(str(s.created_at) || null),
      });
    }
  }
  // Newest first whatever the source promised, undated last: the route stores
  // them in this order and the reader shows them in it.
  return out.sort((a, b) => (Date.parse(b.publishedAt ?? "") || 0) - (Date.parse(a.publishedAt ?? "") || 0));
}
