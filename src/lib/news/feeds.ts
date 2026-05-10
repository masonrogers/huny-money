/**
 * RSS feed configuration for the news poller.
 *
 * These are operator-curated. Add or replace via deploy + version bump.
 * Per BUILD_PLAN Phase 2: CoinDesk, The Block, Reuters Crypto, Bloomberg
 * Crypto. URLs verified periodically — feeds can move or break.
 */

export interface NewsFeed {
  id: string; // stable identifier used in dedup keys
  name: string;
  url: string;
}

export const FEEDS: readonly NewsFeed[] = [
  {
    id: "coindesk",
    name: "CoinDesk",
    url: "https://www.coindesk.com/arc/outboundfeeds/rss/",
  },
  {
    id: "theblock",
    name: "The Block",
    url: "https://www.theblock.co/rss.xml",
  },
  // Cointelegraph (replaced Reuters Crypto — Reuters' arc URL has been 404
  // since at least 2026-05; was generating a warning every wake-up tick).
  {
    id: "cointelegraph",
    name: "Cointelegraph",
    url: "https://cointelegraph.com/rss",
  },
  // Bloomberg Crypto. Bloomberg often paywalls RSS; Decrypt is the chosen
  // fallback.
  {
    id: "decrypt",
    name: "Decrypt",
    url: "https://decrypt.co/feed",
  },
] as const;
