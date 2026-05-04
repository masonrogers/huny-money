// Barrel for the AI orchestration surface (Phase 3).

export { buildOpusMorningSystemPrompt } from "./prompts/opus-morning";
export { buildSonnetWatcherSystemPrompt } from "./prompts/sonnet-watcher";

export {
  buildOpusMorningUserMessage,
  type OpusMorningPackageInput,
  type AssetPriceData,
  type NewsArticle,
  type YesterdayOutcome,
} from "./packages/opus-morning";
export {
  buildSonnetUserMessage,
  type SonnetCheckInput,
} from "./packages/sonnet-watcher";

export {
  MorningBriefSchema,
  SonnetWatcherOutputSchema,
  type MorningBrief,
  type SonnetWatcherOutput,
} from "./schemas";

export {
  runMorningBrief,
  MorningBriefSchemaError,
  type MorningBriefResult,
} from "./flows/morning-brief";
export {
  runSonnetCheck,
  SonnetSchemaError,
  type SonnetCheckResult,
} from "./flows/sonnet-check";

export { assemblePortfolioSnapshot, type PortfolioSnapshot } from "./portfolio";
