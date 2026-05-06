import Parser from "rss-parser";
import { errorLogger } from "@/lib/db/utils";
import { log } from "@/lib/logger";
import { FEEDS, type NewsFeed } from "./feeds";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NewsItem {
  /** Stable id for dedup: feedId:link OR feedId:guid. */
  id: string;
  feedId: string;
  feedName: string;
  title: string;
  link: string;
  publishedAt: Date | null;
  /** Concatenated title + summary, lowercased. Used for keyword matching. */
  searchText: string;
}

// ---------------------------------------------------------------------------
// Single-feed fetch
// ---------------------------------------------------------------------------

const parser = new Parser({
  timeout: 15_000,
  headers: {
    // ASCII-only — em-dashes / smart quotes break the underlying http client.
    "User-Agent":
      "huny-money/3.0 (+https://github.com/masonrogers/huny-money) RSS poller",
  },
});

async function fetchFeed(feed: NewsFeed): Promise<NewsItem[]> {
  try {
    const result = await parser.parseURL(feed.url);
    const items = result.items ?? [];
    return items
      .filter((it) => it.link || it.guid)
      .map((it) => {
        const link = it.link ?? it.guid ?? "";
        const title = it.title ?? "";
        const summary = it.contentSnippet ?? it.content ?? "";
        const publishedAt = it.isoDate ? new Date(it.isoDate) : it.pubDate ? new Date(it.pubDate) : null;
        return {
          id: `${feed.id}:${link}`,
          feedId: feed.id,
          feedName: feed.name,
          title,
          link,
          publishedAt,
          searchText: `${title} ${summary}`.toLowerCase(),
        };
      });
  } catch (err) {
    await errorLogger({
      severity: "warning",
      component: "news.rss-poller",
      error: err instanceof Error ? err : new Error(String(err)),
      context: { feed: feed.id, url: feed.url },
      recovered: true,
      recoveryAction: "Skipped this feed for the current poll cycle; will retry next cycle.",
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Multi-feed poll
// ---------------------------------------------------------------------------

/**
 * Fetches every configured feed in parallel and returns deduplicated items.
 *
 * Caller-side dedup: pass `seenIds` (the set of item.id strings the caller
 * has already processed). The returned items exclude any whose id is in
 * `seenIds`. Phase 5's wake-up trigger persists the seenIds across runs
 * (in `state` table or similar).
 *
 * Stateless poller: this function does NO persistence itself. That keeps
 * the poller pure and testable.
 */
export async function pollAllFeeds(seenIds: ReadonlySet<string> = new Set()): Promise<NewsItem[]> {
  const start = Date.now();
  const perFeed = await Promise.all(FEEDS.map((f) => fetchFeed(f)));
  const all = perFeed.flat();

  const fresh = all.filter((it) => !seenIds.has(it.id));

  log.info("RSS poll complete", {
    feeds: FEEDS.length,
    totalItems: all.length,
    freshItems: fresh.length,
    durationMs: Date.now() - start,
  });

  return fresh;
}

// ---------------------------------------------------------------------------
// Keyword matching
// ---------------------------------------------------------------------------

export interface KeywordMatch {
  item: NewsItem;
  matchedKeywords: string[];
}

/**
 * Returns items that match any of the provided keywords (case-insensitive).
 * Each match includes the list of keywords that hit, for caller logging.
 */
export function matchKeywords(
  items: readonly NewsItem[],
  keywords: readonly string[],
): KeywordMatch[] {
  const lowerKeywords = keywords.map((k) => k.toLowerCase()).filter(Boolean);
  if (lowerKeywords.length === 0) return [];

  const matches: KeywordMatch[] = [];
  for (const item of items) {
    const hit = lowerKeywords.filter((kw) => item.searchText.includes(kw));
    if (hit.length > 0) {
      matches.push({ item, matchedKeywords: hit });
    }
  }
  return matches;
}
