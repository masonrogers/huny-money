import { isDebounced } from "./debounce";
import { matchKeywords, type NewsItem } from "@/lib/news";

/**
 * Wake-up trigger 3: news keyword match (30-min debounce per keyword).
 * Per STRATEGY.md §5.5.
 *
 * Reads the active rubric's watch list keywords + applies debounce. Each
 * matched keyword that hasn't fired within the 30-min window produces a
 * fire. Multiple items matching the same keyword in the same window
 * collapse into one fire (use the first item).
 */

export interface NewsKeywordFire {
  keyword: string;
  item: NewsItem;
  matchedKeywords: readonly string[];
}

export async function checkNewsKeywords(
  items: readonly NewsItem[],
  watchKeywords: readonly string[],
  now: Date = new Date(),
): Promise<NewsKeywordFire[]> {
  if (items.length === 0 || watchKeywords.length === 0) return [];

  const matches = matchKeywords(items, watchKeywords);
  if (matches.length === 0) return [];

  // For each unique matched keyword, check debounce. The first item that
  // matched the keyword (newest first since RSS gives newest-first) wins.
  const seenKeywords = new Set<string>();
  const fires: NewsKeywordFire[] = [];

  for (const match of matches) {
    for (const keyword of match.matchedKeywords) {
      if (seenKeywords.has(keyword)) continue;
      seenKeywords.add(keyword);

      const debounce = await isDebounced("news_keyword", keyword, now);
      if (debounce.debounced) continue;

      fires.push({
        keyword,
        item: match.item,
        matchedKeywords: match.matchedKeywords,
      });
    }
  }

  return fires;
}
