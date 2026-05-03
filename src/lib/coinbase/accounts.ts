import { coinbaseRequest } from './client';
import type { Account, ListAccountsResponse } from './types';

// ─── Accounts ──────────────────────────────────────────────────────────────

/**
 * Fetch all accounts from Coinbase Advanced Trade.
 * Handles pagination automatically, returning all accounts.
 *
 * GET /api/v3/brokerage/accounts
 */
export async function getAccounts(): Promise<Account[]> {
  const allAccounts: Account[] = [];
  let cursor: string | undefined;

  do {
    const params: Record<string, string | undefined> = {
      limit: '250',
    };
    if (cursor) {
      params.cursor = cursor;
    }

    const response = await coinbaseRequest<ListAccountsResponse>({
      method: 'GET',
      path: '/api/v3/brokerage/accounts',
      params,
    });

    allAccounts.push(...response.accounts);

    cursor = response.has_next ? response.cursor : undefined;
  } while (cursor);

  return allAccounts;
}

/**
 * Get the available balance for a specific asset (e.g., "USD", "BTC", "ETH", "SOL").
 * Returns the balance as a number, or 0 if the account is not found.
 */
export async function getBalance(asset: string): Promise<{
  available: number;
  hold: number;
  total: number;
  currency: string;
}> {
  const accounts = await getAccounts();
  const account = accounts.find(
    (a) => a.currency.toUpperCase() === asset.toUpperCase()
  );

  if (!account) {
    return { available: 0, hold: 0, total: 0, currency: asset.toUpperCase() };
  }

  const available = parseFloat(account.available_balance.value);
  const hold = parseFloat(account.hold.value);

  return {
    available,
    hold,
    total: available + hold,
    currency: account.currency,
  };
}

/**
 * Get balances for all primary and secondary assets plus USD.
 * Convenience method for portfolio state assembly.
 */
export async function getAllBalances(
  assets: readonly string[] = ['USD', 'BTC', 'ETH', 'SOL']
): Promise<
  Record<string, { available: number; hold: number; total: number; currency: string }>
> {
  const accounts = await getAccounts();
  const result: Record<
    string,
    { available: number; hold: number; total: number; currency: string }
  > = {};

  for (const asset of assets) {
    const account = accounts.find(
      (a) => a.currency.toUpperCase() === asset.toUpperCase()
    );

    if (account) {
      const available = parseFloat(account.available_balance.value);
      const hold = parseFloat(account.hold.value);
      result[asset.toUpperCase()] = {
        available,
        hold,
        total: available + hold,
        currency: account.currency,
      };
    } else {
      result[asset.toUpperCase()] = {
        available: 0,
        hold: 0,
        total: 0,
        currency: asset.toUpperCase(),
      };
    }
  }

  return result;
}
