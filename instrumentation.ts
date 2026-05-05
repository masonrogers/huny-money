/**
 * Next.js instrumentation hook — runs once on server startup, before any
 * routes are served. The boot sequence (reconciliation, executor factory,
 * scheduler) goes here.
 *
 * Only runs in the Node.js runtime (not Edge). Boot errors are logged but
 * do not prevent the server from starting — the dashboard remains
 * reachable so the operator can see what went wrong.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Skip boot during build phase (next build pre-renders pages and
  // instrumentation runs in that worker too — we don't want to call
  // Coinbase or write to the DB during a build).
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // Lazy import so the module isn't loaded during build pre-render.
  try {
    const { runBoot } = await import("@/lib/boot");
    await runBoot();
  } catch (err) {
    // Don't let a boot failure prevent the server from starting — the
    // dashboard's empty states + System view will surface the error.
    console.error(
      JSON.stringify({
        level: "critical",
        timestamp: new Date().toISOString(),
        message: "Boot sequence failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
