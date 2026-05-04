import { NextResponse } from "next/server";

/**
 * Stub for the "force morning brief now" control. Phase 9 wires this up to
 * the actual morning-brief flow (assemble package → call Opus → persist).
 *
 * For Phase 7 we accept the request, log intent, and return 501 so the UI
 * can render the button with a clear "not yet wired" state.
 */
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      message:
        "Force brief is not yet wired to the morning-brief flow. Available in Phase 9 after DB integration tests confirm the end-to-end path.",
    },
    { status: 501 },
  );
}
