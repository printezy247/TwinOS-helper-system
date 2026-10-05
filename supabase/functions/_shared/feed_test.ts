import { assertEquals } from "std/assert/mod.ts";
import { decodeEntities, parseDate, parseFeed } from "./feed.ts";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Gold desk</title>
  <item>
    <title>Fed holds, gold climbs</title>
    <link>https://example.com/fed</link>
    <guid isPermaLink="false">fed-2026-10-05</guid>
    <pubDate>Mon, 05 Oct 2026 08:00:00 GMT</pubDate>
    <description>The committee left rates unchanged.</description>
  </item>
  <item>
    <title><![CDATA[ECB &amp; the <b>EUR</b>]]></title>
    <link>https://example.com/ecb</link>
    <description>&lt;p&gt;Rates hold. &amp; the euro&lt;/p&gt;</description>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>CPI watch</title>
  <entry>
    <id>tag:example.com,2026:cpi</id>
    <title type="html"><![CDATA[US CPI &amp; gold]]></title>
    <link href="https://example.com/cpi" rel="alternate"/>
    <updated>2026-10-05T10:30:00Z</updated>
    <summary>Consumer prices rose 0.2% m/m.</summary>
  </entry>
</feed>`;

Deno.test("parseFeed: an RSS 2.0 item keeps its guid, link and publication time", () => {
  const [a, b] = parseFeed(RSS);
  assertEquals(a, {
    externalId: "fed-2026-10-05",
    title: "Fed holds, gold climbs",
    summary: "The committee left rates unchanged.",
    link: "https://example.com/fed",
    publishedAt: "2026-10-05T08:00:00.000Z",
  });
  assertEquals(b.title, "ECB & the EUR");
  assertEquals(b.summary, "Rates hold. & the euro");
  assertEquals(b.link, "https://example.com/ecb");
  assertEquals(b.publishedAt, null, "no date means no invented date");
});

Deno.test("parseFeed: an Atom entry reads href, id and updated", () => {
  const [e] = parseFeed(ATOM);
  assertEquals(e.externalId, "tag:example.com,2026:cpi");
  assertEquals(e.title, "US CPI & gold");
  assertEquals(e.link, "https://example.com/cpi");
  assertEquals(e.publishedAt, "2026-10-05T10:30:00.000Z");
  assertEquals(e.summary, "Consumer prices rose 0.2% m/m.");
});

Deno.test("parseFeed: an item with no guid falls back to its link, then to itself", () => {
  const [a] = parseFeed(`<rss><channel><item><title>Only a title</title></item></channel></rss>`);
  assertEquals(a.externalId, "Only a title|");
  assertEquals(a.link, null);
  assertEquals(a.summary, null);
});

Deno.test("parseFeed: an empty shell and a non-feed are both empty, never an error", () => {
  assertEquals(parseFeed(""), []);
  assertEquals(parseFeed("<html><body>nope</body></html>"), []);
  assertEquals(parseFeed(`<?xml version="1.0"?><rss><channel></channel></rss>`), []);
  // A link stub with nothing readable is dropped rather than stored blank.
  assertEquals(parseFeed(`<rss><item><guid>x</guid></item></rss>`), []);
});

Deno.test("parseFeed: RSS wins when a document carries both shapes", () => {
  const both = RSS.replace("</channel>", "<entry><title>odd</title></entry></channel>");
  assertEquals(parseFeed(both).length, 2);
});

Deno.test("parseDate: RFC 822 and ISO 8601 are instants, anything else is null", () => {
  assertEquals(parseDate("Mon, 05 Oct 2026 08:00:00 GMT"), "2026-10-05T08:00:00.000Z");
  assertEquals(parseDate("2026-10-05T08:00:00+00:00"), "2026-10-05T08:00:00.000Z");
  assertEquals(parseDate("not a date"), null);
  assertEquals(parseDate(null), null);
});

Deno.test("decodeEntities: numeric and hex references, CDATA unwrapped once", () => {
  assertEquals(decodeEntities("&#8217;&#x2019;"), "’’");
  assertEquals(decodeEntities("<![CDATA[a &amp; b]]>"), "a & b");
});
