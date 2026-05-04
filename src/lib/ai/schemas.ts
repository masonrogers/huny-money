import { z } from "zod";

/**
 * JSON schemas the AI must adhere to.
 *
 * Per STRATEGY.md §5.3 (Opus morning brief) and §5.4 (Sonnet watcher),
 * malformed responses cause an error — no silent fallback. These schemas
 * are the gate.
 */

// ---------------------------------------------------------------------------
// Opus morning brief output
// ---------------------------------------------------------------------------

export const RegimeSchema = z.enum(["bull", "chop", "bear"]);

export const BtcCoreActionSchema = z.enum(["dca_in", "hold", "dca_out", "exit"]);

export const AltActionSchema = z.enum(["hold", "trail_stop", "partial_sell", "exit"]);

export const UrgencySchema = z.enum(["immediate", "next_check"]);

export const BtcCoreDecisionSchema = z.object({
  current_alloc_pct: z.number().min(0).max(100),
  target_alloc_pct: z.number().min(0).max(100),
  action: BtcCoreActionSchema,
  tranches_planned: z.number().int().min(1).max(10).optional().nullable(),
  reasoning: z.string().min(1),
});

export const AltPositionSchema = z.object({
  asset: z.string().min(1),
  current_cycle_position_pct: z.number().min(0).max(100),
  action: AltActionSchema,
  reasoning: z.string().min(1),
});

export const AltEntryCandidateSchema = z.object({
  asset: z.string().min(1),
  cycle_position_pct: z.number().min(0).max(100),
  momentum_signal: z.string().min(1),
  volume_signal: z.string().min(1),
  conviction: z.number().int().min(0).max(100),
  size_pct: z.number().min(0).max(15), // hard cap per §3.6
  stop_pct: z.number().min(4).max(20),
  reasoning: z.string().min(1),
});

export const WatchListItemSchema = z.object({
  id: z.string().min(1),
  asset: z.string().optional().nullable(),
  condition: z.string().min(1),
  rationale: z.string().min(1),
  urgency: UrgencySchema,
});

export const MorningBriefSchema = z.object({
  regime: RegimeSchema,
  regime_evidence: z.string().min(1),
  regime_changed_from: RegimeSchema.optional().nullable(),
  btc_core_decision: BtcCoreDecisionSchema,
  alt_positions: z.array(AltPositionSchema),
  alt_entry_candidates: z.array(AltEntryCandidateSchema),
  watch_list: z.array(WatchListItemSchema).max(5), // hard cap per §5.3
  btc_benchmark_assessment: z.string().min(1),
  discipline_check: z.string().min(1),
});

export type MorningBrief = z.infer<typeof MorningBriefSchema>;

// ---------------------------------------------------------------------------
// Sonnet watcher output
// ---------------------------------------------------------------------------

export const SonnetEvaluatedSchema = z.object({
  trigger_id: z.string().min(1),
  fired: z.boolean(),
  current: z.string(),
  notes: z.string().optional().nullable(),
});

export const SonnetWatcherOutputSchema = z
  .object({
    evaluated: z.array(SonnetEvaluatedSchema),
    escalate: z.boolean(),
    trigger_id: z.string().nullable(),
    discretionary_escalation: z.boolean().default(false),
    discretionary_reason: z.string().nullable().optional(),
    summary: z.string().min(1),
  })
  // .strict() rejects ANY unknown key. This is the primary defense against
  // Sonnet trying to slip a trade-decision field past the parser. Specific
  // forbidden field names that have appeared in past LLM hallucinations are
  // listed in the .superRefine for clearer error messages.
  .strict()
  .superRefine((data, ctx) => {
    if (data.escalate && !data.trigger_id) {
      ctx.addIssue({
        code: "custom",
        message: "escalate=true requires a trigger_id",
      });
    }
    if (data.discretionary_escalation && !data.discretionary_reason) {
      ctx.addIssue({
        code: "custom",
        message: "discretionary_escalation=true requires discretionary_reason",
      });
    }
  });

export type SonnetWatcherOutput = z.infer<typeof SonnetWatcherOutputSchema>;
