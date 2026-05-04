/**
 * `state` table queries.
 *
 * The state table is a singleton key-value store. WRITES MUST go through
 * `stateWriter` from `src/lib/db/utils.ts` so that a `system_state_history`
 * row is created in the same transaction. Direct inserts/updates here would
 * bypass the audit trail.
 *
 * This file exposes only READ helpers. The single read primitive `stateRead`
 * lives in utils.ts to keep the writer/reader pair colocated.
 */

import { db } from "../index";
import { state } from "../schema";
import type { StateRow } from "../schema";

export async function listAllState(): Promise<StateRow[]> {
  return db.select().from(state);
}

// stateRead is exported from ../utils for proximity to stateWriter
export { stateRead } from "../utils";
