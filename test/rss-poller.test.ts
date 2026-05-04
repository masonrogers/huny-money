import { describe, it, expect } from "vitest";
import { matchKeywords, type NewsItem } from "@/lib/news";

const fakeItem = (id: string, title: string, summary = ""): NewsItem => ({
  id,
  feedId: "test",
  feedName: "Test",
  title,
  link: `https://example.com/${id}`,
  publishedAt: new Date(),
  searchText: `${title} ${summary}`.toLowerCase(),
});

describe("matchKeywords", () => {
  it("returns empty when no keywords", () => {
    const items = [fakeItem("1", "Bitcoin hits new high")];
    expect(matchKeywords(items, [])).toEqual([]);
  });

  it("returns empty when no items match", () => {
    const items = [fakeItem("1", "Stocks rally")];
    expect(matchKeywords(items, ["aerodrome", "ethereum"])).toEqual([]);
  });

  it("matches case-insensitively", () => {
    const items = [fakeItem("1", "AERODROME launches new pool")];
    const matches = matchKeywords(items, ["aerodrome"]);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.matchedKeywords).toContain("aerodrome");
  });

  it("matches against title + summary combined", () => {
    const items = [fakeItem("1", "Generic finance news", "Buried mention of LINK upgrade")];
    const matches = matchKeywords(items, ["link upgrade"]);
    expect(matches).toHaveLength(1);
  });

  it("returns all matched keywords per item", () => {
    const items = [fakeItem("1", "AERO Pectra unlock event")];
    const matches = matchKeywords(items, ["aero", "pectra", "uniswap"]);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.matchedKeywords.sort()).toEqual(["aero", "pectra"]);
  });

  it("ignores empty keyword strings", () => {
    const items = [fakeItem("1", "Bitcoin update")];
    const matches = matchKeywords(items, ["", "  ", "bitcoin"]);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.matchedKeywords).toEqual(["bitcoin"]);
  });

  it("matches multiple items independently", () => {
    const items = [
      fakeItem("1", "Bitcoin breakout"),
      fakeItem("2", "Ethereum staking growth"),
      fakeItem("3", "Stock market open"),
    ];
    const matches = matchKeywords(items, ["bitcoin", "ethereum"]);
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.item.id).sort()).toEqual(["1", "2"]);
  });
});
