import { z } from 'zod/v4';
import type { EvaluationOutput } from '@/lib/types/evaluation';

// ─── Zod schemas matching the EvaluationOutput type ─────────────────────────

const layer1AssessmentSchema = z.object({
  market_regime: z.enum([
    'strong_bull',
    'mild_bull',
    'ranging',
    'mild_bear',
    'strong_bear',
  ]),
  regime_changed: z.boolean(),
  regime_evidence: z.string(),
  target_exposure_pct: z.number().min(0).max(70),
  btc_outlook: z.string(),
  eth_outlook: z.string(),
  sol_outlook: z.string(),
  macro_summary: z.string(),
  active_theses: z.array(
    z.object({
      asset: z.string(),
      thesis: z.string(),
      status: z.enum(['active', 'watching', 'invalidated']),
      conviction: z.number().min(0).max(100),
      action: z.string(),
      notes: z.string(),
    })
  ),
  btc_benchmark_assessment: z.string(),
});

const positionActionSchema = z.object({
  asset: z.string(),
  type: z.enum(['swing', 'core']),
  action: z.enum(['hold', 'exit', 'reduce', 'add']),
  conviction_now: z.number().min(0).max(100),
  reasoning: z.string(),
  new_stop_loss: z.number().nullable(),
  exit_percentage: z.number().nullable(),
});

const tradeProposalSchema = z.object({
  asset: z.string(),
  type: z.enum(['swing', 'core']),
  direction: z.literal('long'),
  conviction: z.number().min(60).max(100),
  catalyst: z.string(),
  confirmation: z.string(),
  regime_alignment: z.string(),
  entry_price_target: z.number().positive(),
  stop_loss: z.number().positive(),
  take_profit_target: z.number().positive(),
  risk_reward_ratio: z.number().min(2.0),
  position_size_usd: z.number().positive(),
  position_size_pct: z.number().min(0).max(0.50),
  correlation_check: z.string(),
  expected_hold_days: z.number().positive(),
  reasoning: z.string(),
});

const dailyLossCheckSchema = z.object({
  realized_losses_24h_pct: z.number(),
  daily_limit_remaining_pct: z.number(),
  entries_blocked: z.boolean(),
});

const layer2DecisionSchema = z.object({
  existing_positions: z.array(positionActionSchema),
  new_trades: z.array(tradeProposalSchema),
  strategy_notes: z.string(),
  daily_loss_check: dailyLossCheckSchema,
});

const evaluationOutputSchema = z.object({
  timestamp: z.string(),
  strategy_version: z.string(),
  layer_1: layer1AssessmentSchema.optional(),
  layer_2: layer2DecisionSchema,
});

// ─── Strategy review schemas ────────────────────────────────────────────────

const parameterChangeSchema = z.object({
  param_name: z.string(),
  old_value: z.number(),
  new_value: z.number(),
  reasoning: z.string(),
});

const strategyReviewResponseSchema = z.object({
  analysis: z.string(),
  changes: z.array(parameterChangeSchema),
  version_increment: z.enum(['minor', 'major']),
  overall_assessment: z.string(),
  btc_benchmark_recommendation: z.string(),
});

// ─── Post-trade assessment schema ───────────────────────────────────────────

const postTradeAssessmentSchema = z.object({
  outcome: z.enum(['win', 'loss']),
  grade: z.enum(['A', 'B', 'C', 'D', 'F']),
  catalyst_accuracy: z.string(),
  timing_assessment: z.string(),
  stop_loss_assessment: z.string(),
  sizing_assessment: z.string(),
  key_lesson: z.string(),
  what_went_right: z.string(),
  what_went_wrong: z.string(),
  actionable_improvement: z.string(),
  regime_accuracy: z.string(),
});

// ─── JSON extraction ────────────────────────────────────────────────────────

/**
 * Extracts JSON from Claude's response text.
 * Handles raw JSON, markdown code blocks (```json ... ```), and
 * responses with text before/after the JSON.
 */
function extractJson(text: string): string {
  // Try to find JSON in a markdown code block first
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try to find a JSON object directly (first { to last })
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  // Return as-is and let JSON.parse fail with a clear error
  return text.trim();
}

// ─── Parsers ────────────────────────────────────────────────────────────────

export type ParameterChange = z.infer<typeof parameterChangeSchema>;
export type PostTradeAssessment = z.infer<typeof postTradeAssessmentSchema>;

/**
 * Parse and validate Claude's evaluation response against the EvaluationOutput schema.
 * Returns a typed result with either the validated data or an error message.
 */
export function parseEvaluationResponse(text: string): {
  success: boolean;
  data?: EvaluationOutput;
  error?: string;
} {
  try {
    const jsonStr = extractJson(text);
    const raw = JSON.parse(jsonStr);
    const result = evaluationOutputSchema.safeParse(raw);

    if (result.success) {
      return { success: true, data: result.data as EvaluationOutput };
    }

    const issues = result.error.issues
      .map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`
      )
      .join('; ');

    console.error(`[AI Parser] Validation failed: ${issues}`);
    return { success: false, error: `Validation failed: ${issues}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[AI Parser] Parse error: ${message}`);
    return { success: false, error: `Parse error: ${message}` };
  }
}

/**
 * Parse and validate Claude's strategy review response.
 */
export function parseStrategyReviewResponse(text: string): {
  success: boolean;
  changes?: ParameterChange[];
  analysis?: string;
  versionIncrement?: 'minor' | 'major';
  overallAssessment?: string;
  btcBenchmarkRecommendation?: string;
  error?: string;
} {
  try {
    const jsonStr = extractJson(text);
    const raw = JSON.parse(jsonStr);
    const result = strategyReviewResponseSchema.safeParse(raw);

    if (result.success) {
      return {
        success: true,
        changes: result.data.changes,
        analysis: result.data.analysis,
        versionIncrement: result.data.version_increment,
        overallAssessment: result.data.overall_assessment,
        btcBenchmarkRecommendation: result.data.btc_benchmark_recommendation,
      };
    }

    const issues = result.error.issues
      .map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`
      )
      .join('; ');

    console.error(`[AI Parser] Strategy review validation failed: ${issues}`);
    return {
      success: false,
      error: `Validation failed: ${issues}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[AI Parser] Strategy review parse error: ${message}`);
    return { success: false, error: `Parse error: ${message}` };
  }
}

/**
 * Parse and validate Claude's post-trade assessment response.
 */
export function parsePostTradeResponse(text: string): {
  success: boolean;
  data?: PostTradeAssessment;
  error?: string;
} {
  try {
    const jsonStr = extractJson(text);
    const raw = JSON.parse(jsonStr);
    const result = postTradeAssessmentSchema.safeParse(raw);

    if (result.success) {
      return { success: true, data: result.data };
    }

    const issues = result.error.issues
      .map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`
      )
      .join('; ');

    console.error(
      `[AI Parser] Post-trade assessment validation failed: ${issues}`
    );
    return { success: false, error: `Validation failed: ${issues}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[AI Parser] Post-trade assessment parse error: ${message}`);
    return { success: false, error: `Parse error: ${message}` };
  }
}

/**
 * Returns a safe "no action" default EvaluationOutput when Claude's response
 * cannot be parsed. Logs the error for investigation.
 */
export function noActionDefault(
  strategyVersion: string,
  error: string
): EvaluationOutput {
  console.error(
    `[AI Parser] Falling back to no-action default. Error: ${error}`
  );

  return {
    timestamp: new Date().toISOString(),
    strategy_version: strategyVersion,
    layer_2: {
      existing_positions: [],
      new_trades: [],
      strategy_notes: `PARSE ERROR: Claude response could not be parsed. Error: ${error}. No action taken as safety measure.`,
      daily_loss_check: {
        realized_losses_24h_pct: 0,
        daily_limit_remaining_pct: 4.0,
        entries_blocked: true, // Block entries on parse failure as safety measure
      },
    },
  };
}
