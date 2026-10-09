// Analyse RSS 2.0 / Atom (pure, tolérante, sans exécution de contenu).
export type ParsedItem = { title: string; url: string; summary: string; publishedAt: string | null };

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
export function decode(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Math.min(Number(code), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Math.min(parseInt(code, 16), 0x10ffff)))
    .replace(/&([a-z]+);/gi, (match, name) => entities[name.toLowerCase()] ?? match);
}
export function stripHtml(value: string) {
  return decode(value).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
const tag = (block: string, name: string) => block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] ?? "";

export function parseFeed(xml: string, limit = 30): ParsedItem[] {
  if (typeof xml !== "string" || xml.length > 3_000_000) return [];
  const blocks = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi), ...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)].map((match) => match[0]).slice(0, limit);
  const items: ParsedItem[] = [];
  for (const block of blocks) {
    const title = stripHtml(tag(block, "title")).slice(0, 400);
    const atomLink = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)?.[1] ?? block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1];
    const url = decode((tag(block, "link") || atomLink || tag(block, "guid")).trim());
    const summary = stripHtml(tag(block, "description") || tag(block, "summary") || tag(block, "content")).slice(0, 600);
    const dateText = stripHtml(tag(block, "pubDate") || tag(block, "published") || tag(block, "updated") || tag(block, "dc:date"));
    const date = dateText ? new Date(dateText) : null;
    if (!title || !/^https:\/\//i.test(url)) continue;
    items.push({ title, url, summary, publishedAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null });
  }
  return items;
}
