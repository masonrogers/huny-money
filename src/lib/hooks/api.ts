"use client";

import useSWR, { type SWRConfiguration } from "swr";

/**
 * SWR fetcher used by every dashboard hook. Handles the dashboard auth flow
 * (returns null on 401 so the hook can surface a re-login prompt) and JSON
 * parsing.
 *
 * Throws on 5xx so the error boundary catches real failures.
 */
async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (res.status === 401) {
    // Force a redirect to login. The middleware will preserve the path.
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

const DEFAULT_CONFIG: SWRConfiguration = {
  revalidateOnFocus: false,
  shouldRetryOnError: (err: unknown) => {
    return err instanceof Error && !err.message.includes("Unauthorized");
  },
  dedupingInterval: 2_000,
};

/**
 * Read a JSON endpoint with SWR. The returned shape is the SWR hook value
 * (data + error + isLoading + mutate).
 */
export function useApi<T>(
  url: string | null,
  config?: SWRConfiguration<T>,
) {
  return useSWR<T>(url, fetcher, { ...DEFAULT_CONFIG, ...config });
}

/**
 * POST helper with optimistic-update support. Returns a promise of the
 * response body and includes the parsed JSON if any.
 */
export async function apiPost<TResp = unknown>(
  url: string,
  body?: unknown,
): Promise<TResp> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as TResp;
}
