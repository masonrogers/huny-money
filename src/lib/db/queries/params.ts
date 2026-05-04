import { eq } from "drizzle-orm";
import { db } from "../index";
import { params } from "../schema";
import type { ParamRow } from "../schema";

export async function listAllParams(): Promise<ParamRow[]> {
  return db.select().from(params);
}

export async function getParam(paramName: string): Promise<ParamRow | null> {
  const rows = await db.select().from(params).where(eq(params.paramName, paramName)).limit(1);
  return rows[0] ?? null;
}

type ParamUpsert = {
  paramName: string;
  currentValue: unknown;
  minAllowed?: unknown;
  maxAllowed?: unknown;
  version: string;
  changedReason: string;
};

export async function upsertParam(input: ParamUpsert): Promise<ParamRow> {
  const existing = await getParam(input.paramName);
  if (existing) {
    const updated = await db
      .update(params)
      .set({
        currentValue: input.currentValue as ParamRow["currentValue"],
        minAllowed: input.minAllowed as ParamRow["minAllowed"],
        maxAllowed: input.maxAllowed as ParamRow["maxAllowed"],
        version: input.version,
        changedReason: input.changedReason,
        changedAt: new Date(),
      })
      .where(eq(params.paramName, input.paramName))
      .returning();
    return updated[0]!;
  }
  const inserted = await db
    .insert(params)
    .values({
      paramName: input.paramName,
      currentValue: input.currentValue as ParamRow["currentValue"],
      minAllowed: input.minAllowed as ParamRow["minAllowed"],
      maxAllowed: input.maxAllowed as ParamRow["maxAllowed"],
      version: input.version,
      changedReason: input.changedReason,
    })
    .returning();
  return inserted[0]!;
}
