import { coinbaseRequest } from "./client";
import type { Account, ApiKeyPermissions, ListAccountsResponse } from "./types";

// ---------------------------------------------------------------------------
// Account / balance queries
// ---------------------------------------------------------------------------

/**
 * Fetch all accounts (handles pagination).
 *
 * GET /api/v3/brokerage/accounts
 */
export async function getAccounts(): Promise<Account[]> {
  const all: Account[] = [];
  let cursor: string | undefined;
  do {
    const params: Record<string, string | undefined> = { limit: "250" };
    if (cursor) params.cursor = cursor;

    const response = await coinbaseRequest<ListAccountsResponse>({
      method: "GET",
      path: "/api/v3/brokerage/accounts",
      params,
    });

    all.push(...response.accounts);
    cursor = response.has_next ? response.cursor : undefined;
  } while (cursor);
  return all;
}

export interface BalanceSummary {
  available: number;
  hold: number;
  total: number;
  currency: string;
}

/**
 * Get the balance for a specific asset (USD, USDC, BTC, ETH, SOL, etc.).
 * Returns zeros if no account exists for that currency.
 */
export async function getBalance(asset: string): Promise<BalanceSummary> {
  const accounts = await getAccounts();
  const account = accounts.find((a) => a.currency.toUpperCase() === asset.toUpperCase());
  if (!account) return { available: 0, hold: 0, total: 0, currency: asset.toUpperCase() };

  const available = parseFloat(account.available_balance.value);
  const hold = parseFloat(account.hold.value);
  return { available, hold, total: available + hold, currency: account.currency };
}

/**
 * Get balances for a set of assets in one fetch.
 */
export async function getAllBalances(
  assets: readonly string[] = ["USD", "USDC", "BTC", "ETH", "SOL"],
): Promise<Record<string, BalanceSummary>> {
  const accounts = await getAccounts();
  const result: Record<string, BalanceSummary> = {};

  for (const asset of assets) {
    const upper = asset.toUpperCase();
    const account = accounts.find((a) => a.currency.toUpperCase() === upper);
    if (account) {
      const available = parseFloat(account.available_balance.value);
      const hold = parseFloat(account.hold.value);
      result[upper] = { available, hold, total: available + hold, currency: account.currency };
    } else {
      result[upper] = { available: 0, hold: 0, total: 0, currency: upper };
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// API key permission check (TRADE-only enforcement)
// ---------------------------------------------------------------------------

/**
 * Fetch the current API key's permissions.
 *
 * GET /api/v3/brokerage/key_permissions
 */
export async function getApiKeyPermissions(): Promise<ApiKeyPermissions> {
  return coinbaseRequest<ApiKeyPermissions>({
    method: "GET",
    path: "/api/v3/brokerage/key_permissions",
  });
}

/**
 * Asserts the API key cannot withdraw funds (per STRATEGY.md §6.2 first-launch
 * requirement). Boot must call this and refuse to start if it returns false.
 *
 * If the server is compromised, an attacker can place bad trades but cannot
 * steal funds. This is non-negotiable.
 */
export async function assertTradeOnlyKey(): Promise<void> {
  const perms = await getApiKeyPermissions();
  if (perms.can_transfer) {
    throw new Error(
      "FATAL: Coinbase API key has withdrawal/transfer permission enabled. " +
        "This bot REQUIRES a TRADE-only key. Refusing to start. " +
        "Regenerate the key without 'Transfer' permission and restart.",
    );
  }
  if (!perms.can_trade) {
    throw new Error(
      "FATAL: Coinbase API key does not have trade permission. Refusing to start.",
    );
  }
}
