/**
 * Reads page URLs out of an XML sitemap, following a sitemap index one level
 * down. Used by inspect_batch and indexnow_submit so either can work on "the
 * pages in this sitemap" or "the pages whose <lastmod> is on or after a date"
 * instead of a hand-written URL list.
 */

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

function parseEntries(xml: string, tag: 'url' | 'sitemap'): SitemapEntry[] {
  const blocks = xml.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g')) ?? [];
  const entries: SitemapEntry[] = [];
  for (const block of blocks) {
    const loc = block.match(/<loc>\s*([^<]+?)\s*<\/loc>/)?.[1];
    if (!loc) continue;
    const lastmod = block.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/)?.[1];
    entries.push(lastmod ? { loc: decodeXml(loc), lastmod } : { loc: decodeXml(loc) });
  }
  return entries;
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function fetchXml(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch sitemap ${url}: HTTP ${res.status}`);
  return res.text();
}

/**
 * Page entries from a sitemap or sitemap index. `lastmodOnOrAfter` (YYYY-MM-DD)
 * keeps only entries whose <lastmod> date is that day or later; entries without
 * a <lastmod> are dropped when it is set.
 */
export async function fetchSitemapUrls(
  sitemapUrl: string,
  lastmodOnOrAfter?: string,
): Promise<SitemapEntry[]> {
  const xml = await fetchXml(sitemapUrl);
  let entries: SitemapEntry[];
  if (/<sitemapindex[\s>]/.test(xml)) {
    const children = parseEntries(xml, 'sitemap');
    const nested = await Promise.all(children.map(async (c) => parseEntries(await fetchXml(c.loc), 'url')));
    entries = nested.flat();
  } else {
    entries = parseEntries(xml, 'url');
  }

  const seen = new Set<string>();
  return entries.filter((e) => {
    if (seen.has(e.loc)) return false;
    seen.add(e.loc);
    if (!lastmodOnOrAfter) return true;
    return !!e.lastmod && e.lastmod.slice(0, 10) >= lastmodOnOrAfter;
  });
}
