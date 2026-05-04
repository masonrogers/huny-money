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
  // Reuters crypto coverage — confirm URL at deploy time, may shift.
  {
    id: "reuters-crypto",
    name: "Reuters Crypto",
    url: "https://www.reuters.com/arc/outboundfeeds/v3/category/crypto/?outputType=xml",
  },
  // Bloomberg Crypto. Bloomberg often paywalls RSS; fallback to Decrypt or
  // CoinTelegraph if needed.
  {
    id: "decrypt",
    name: "Decrypt",
    url: "https://decrypt.co/feed",
  },
] as const;
