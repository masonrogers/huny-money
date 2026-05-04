import { NextResponse } from "next/server";
import { errorLogger } from "@/lib/db/utils";

/**
 * Wraps a dashboard route handler so that schema-not-yet-pushed errors
 * (PostgresError 42P01) and other DB failures return a recognizable empty
 * payload rather than 500ing the dashboard during early development.
 *
 * The view-level empty states still render correctly; the operator gets a
 * tiny "DB not ready" badge in the System view rather than a broken page.
 *
 * Once the schema is pushed and the bot is running, this never trips —
 * queries succeed and return real data (even if empty).
 */

export async function safeDashboardHandler<T>(
  component: string,
  fallback: T,
  fn: () => Promise<T>,
): Promise<NextResponse> {
  try {
    const result = await fn();
    return NextResponse.json(result);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    const isMissingTable =
      /relation .* does not exist/i.test(e.message) ||
      (typeof (err as { code?: string }).code === "string" &&
        (err as { code?: string }).code === "42P01");

    // Best-effort error log, but only when the DB connection itself works.
    if (!isMissingTable) {
      try {
        await errorLogger({
          severity: "warning",
          component,
          error: e,
          recovered: true,
          recoveryAction: "Returned dashboard fallback empty payload",
        });
      } catch {
        // If even errorLogger fails, swallow — the dashboard request still succeeds.
      }
    }

    return NextResponse.json({ ...fallback, dbReady: false });
  }
}
