import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiSpend } from "@/lib/db/schema";
import { stateRead } from "@/lib/db/utils";
import { recentErrors } from "@/lib/db/queries/errors";
import { recentEvaluations } from "@/lib/db/queries/evaluations";
import { setCurrentMode } from "@/lib/mode";
import { computePhase1Criteria } from "@/lib/phase-gating/phase1-criteria";
import { monthKey, monthlySpendUsd } from "@/lib/db/queries/api_spend";
import { MONTHLY_BUDGET_USD } from "@/lib/anthropic";
import { safeDashboardHandler } from "@/lib/api/safe-handler";

export interface SystemSpendByModel {
  opus: number;
  sonnet: number;
}

export interface SystemPayload {
  apiBudget: {
    cap: number;
    mtd: number;
    pctOfCap: number;
    byModel: SystemSpendByModel;
  };
  recentErrors: Array<{
    id: string;
    timestamp: string;
    severity: string;
    component: string;
    errorClass: string;
    message: string;
    recovered: boolean;
  }>;
  lastSuccessfulActions: {
    lastBootAt: string | null;
    lastOpusCallAt: string | null;
    lastSonnetCallAt: string | null;
    lastReconciliationAt: string | null;
  };
  phase1Criteria: Array<{
    id: string;
    description: string;
    currentValue: string | null;
    threshold: string;
    pass: boolean | null;
    operatorKey?: string;
  }>;
  phase1AllPass: boolean;
  dbReady: boolean;
}

export async function GET() {
  return safeDashboardHandler<SystemPayload>(
    "api.dashboard.system",
    {
      apiBudget: { cap: MONTHLY_BUDGET_USD, mtd: 0, pctOfCap: 0, byModel: { opus: 0, sonnet: 0 } },
      recentErrors: [],
      lastSuccessfulActions: {
        lastBootAt: null,
        lastOpusCallAt: null,
        lastSonnetCallAt: null,
        lastReconciliationAt: null,
      },
      phase1Criteria: [],
      phase1AllPass: false,
      dbReady: false,
    },
    async () => {
      // Seed mode for the criteria computation.
      const paperMode = (await stateRead<boolean>("paper_mode")) ?? true;
      setCurrentMode(paperMode ? "paper" : "live");

      const month = monthKey();
      const [mtd, byModelRows, errorsList, evals, lastBootAt, criteria] = await Promise.all([
        monthlySpendUsd(month),
        db
          .select({
            model: apiSpend.model,
            total: sql<string>`COALESCE(SUM(${apiSpend.costUsd}), 0)`,
          })
          .from(apiSpend)
          .where(sql`${apiSpend.month} = ${month}`)
          .groupBy(apiSpend.model),
        recentErrors(25),
        recentEvaluations(20),
        stateRead<string>("last_boot_at"),
        computePhase1Criteria(),
      ]);

      const byModel: SystemSpendByModel = { opus: 0, sonnet: 0 };
      for (const row of byModelRows) {
        if (row.model === "claude-opus-4-7") byModel.opus = Number(row.total);
        else if (row.model === "claude-sonnet-4-6") byModel.sonnet = Number(row.total);
      }

      const lastOpus = evals.find((e) => e.model === "claude-opus-4-7");
      const lastSonnet = evals.find((e) => e.model === "claude-sonnet-4-6");

      return {
        apiBudget: {
          cap: MONTHLY_BUDGET_USD,
          mtd,
          pctOfCap: (mtd / MONTHLY_BUDGET_USD) * 100,
          byModel,
        },
        recentErrors: errorsList.map((e) => ({
          id: e.id,
          timestamp: e.timestamp.toISOString(),
          severity: e.severity,
          component: e.component,
          errorClass: e.errorClass,
          message: e.message,
          recovered: e.recovered,
        })),
        lastSuccessfulActions: {
          lastBootAt: lastBootAt,
          lastOpusCallAt: lastOpus?.timestamp.toISOString() ?? null,
          lastSonnetCallAt: lastSonnet?.timestamp.toISOString() ?? null,
          lastReconciliationAt: null, // populated when reconciliation_log table is added
        },
        phase1Criteria: criteria.results.map((r) => ({
          id: r.id,
          description: r.description,
          currentValue: r.currentValue,
          threshold: r.threshold,
          pass: r.pass,
          operatorKey: r.operatorKey,
        })),
        phase1AllPass: criteria.allPass,
        dbReady: true,
      };
    },
  );
}
