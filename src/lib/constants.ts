// ─── Capital & Circuit Breakers ─────────────────────────────────────────────
export const STARTING_CAPITAL = 500;
export const HARD_CIRCUIT_BREAKER = 300;
export const SOFT_CIRCUIT_BREAKER_PCT = 0.20;

// ─── Position Sizing ────────────────────────────────────────────────────────
export const MAX_SINGLE_POSITION_PCT = 0.50;
export const MIN_CASH_RESERVE_PCT = 0.30;
export const MAX_POSITIONS = 3;
export const MIN_POSITION_SIZE = 50;

// ─── Risk Management ────────────────────────────────────────────────────────
export const DEFAULT_STOP_LOSS_PCT = 0.06;
export const ENTRY_CONVICTION_THRESHOLD = 60;
export const CONVICTION_EXIT_THRESHOLD = 50;

// ─── Fees ───────────────────────────────────────────────────────────────────
export const MAKER_FEE = 0.004;
export const TAKER_FEE = 0.006;
export const ROUND_TRIP_FEE = 0.01;

// ─── Assets ─────────────────────────────────────────────────────────────────
export const PRIMARY_ASSETS = ['BTC', 'ETH'] as const;
export const SECONDARY_ASSETS = ['SOL'] as const;
export const ALL_ASSETS = [...PRIMARY_ASSETS, ...SECONDARY_ASSETS] as const;

// ─── Market Regimes ─────────────────────────────────────────────────────────
export const REGIMES = {
  TRENDING_UP: {
    label: 'Trending Up',
    maxExposurePct: 0.70,
  },
  RANGING: {
    label: 'Ranging',
    maxExposurePct: 0.50,
  },
  TRENDING_DOWN: {
    label: 'Trending Down',
    maxExposurePct: 0.30,
  },
  CRISIS: {
    label: 'Crisis',
    maxExposurePct: 0.10,
  },
} as const;

export type RegimeKey = keyof typeof REGIMES;

// ─── Evaluation Schedule ────────────────────────────────────────────────────
export const EVALUATION_TIMES = [6, 14, 22] as const;

// ─── Emergency ──────────────────────────────────────────────────────────────
export const EMERGENCY_THRESHOLD_PCT = 0.05;
