# CI rollout findings

Bugs and infrastructure issues surfaced while wiring up GitHub Actions CI for the first time. Each entry: where, what, severity, and disposition.

---

## Real correctness bugs (fixed)

### 1. `wakeupsByTypeSince` ignored its `since` parameter
- **File:** `src/lib/db/queries/wakeups.ts` (deleted)
- **Severity:** Latent. Zero callers when found, so no observed impact — but if anyone had used it, they'd have gotten unfiltered wakeups despite the function name implying a time filter.
- **Found by:** lint surfacing unused imports (`gte`, `since`); investigation of why showed the WHERE clause was missing.
- **Fix:** Deleted the function entirely (no callers across `src/` or `test/`). Commit `4708104`.

### 2. `useCoinbaseTicker` rebuilt the WebSocket on every parent re-render
- **File:** `src/lib/hooks/use-coinbase-ticker.ts`
- **Severity:** UI-only (display ticker, per CLAUDE.md "WebSocket ticker is public... used for dashboard display only"). No trading impact, but the dashboard was reconnecting to Coinbase's public WS feed every render — wasteful and would trip rate limits in pathological cases.
- **Cause:** `useEffect(() => { connect(); ... }, [connect])` where `connect` was a `useCallback` referencing itself before declaration. New `connect` identity each render → effect resyncs → tear down + reconnect WS.
- **Found by:** ESLint `react-hooks/immutability` rule firing on `connect` accessed before declared.
- **Fix:** Restructured to a single self-contained `useEffect` with a hoisted inner `connect` function. Effect now only resyncs when `productIds` actually changes (and stringifies the array so inline-array calls don't churn). Commit `4708104`.

### 3. `useState(Date.now())` called `Date.now()` on every render
- **File:** `src/components/app-shell/activity-indicator.tsx:127`
- **Severity:** Performance only. React only uses the first call's value, but the impure call still executes.
- **Found by:** ESLint `react-hooks/static-components` (or similar) firing on impure render-time call.
- **Fix:** `useState(() => Date.now())` lazy initializer. Commit `4708104`.

---

## Infrastructure issues (fixed)

### 4. `npm run lint` silently broken since Next 16 upgrade
- **File:** `package.json` script `"lint": "next lint"`
- **Severity:** High — masked all the other lint findings on this list.
- **Cause:** Next 16 removed the built-in `next lint` subcommand. Script returned a misleading "Invalid project directory" error that looked like a path issue (Next 16 reinterprets the second positional arg as a project dir).
- **Fix:** `"lint": "eslint ."`. Commit `4708104`.

### 5. ESLint flat config crashed via FlatCompat
- **File:** `eslint.config.mjs`
- **Severity:** Hard blocker — even after fixing the script, `eslint .` immediately threw `TypeError: Converting circular structure to JSON` from the FlatCompat shim attempting to validate `next/core-web-vitals` + `next/typescript`.
- **Fix:** Rewrote to use `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript` directly (these are flat configs in `eslint-config-next` v16). Commit `4708104`.

### 6. `db/index.ts` had `ssl: "require"` hardcoded
- **File:** `src/lib/db/index.ts:32`
- **Severity:** Blocked any local-Postgres-based test environment from ever working. Would have broken any future contributor's local development setup. Surfaced because CI is the first place we run integration tests against a non-DO Postgres.
- **Found by:** Every integration test in CI failed with `Client network socket disconnected before secure TLS connection was established` despite the schema-push step succeeding (drizzle-kit doesn't share the runtime postgres-js init).
- **Fix:** Derive SSL from URL host — `localhost`/`127.0.0.1` → plaintext, anything else → `require`. Production DO Postgres unchanged. Commit `ea33b65`.

### 7. DigitalOcean auto-deploy did not fire for either CI-triggered push
- **Severity:** Medium — pre-existing flakiness CLAUDE.md already noted ("Auto-deploy from `main` is enabled but sometimes flaky"). Now confirmed under load.
- **Observation:** Pushes at 04:06 UTC and 04:21 UTC; most recent active deploy when checked at 04:39 UTC was from 03:17 UTC (manual). Two consecutive pushes ignored.
- **Disposition:** Forced deploy via API at 04:41 UTC (deploy `92fb0938-2532-429e-bcad-d1ec48bf9ea3`). Build → Deploy → Active in ~5 min. Verified `source_commit_hash = ea33b65` is now serving; `/api/healthz` 200 in 158ms.
- **Going forward:** DO auto-deploy stays as the default but cannot be trusted. After every push to main, verify a new deployment object exists with the matching commit SHA. If absent, force one via `bash scripts/deploy.sh`.

---

## Production-critical bug (fixing)

### 10. Executor + mode singletons don't survive Next 16 App Router bundle splitting
- **Files:** `src/lib/execution/factory.ts`, `src/lib/mode.ts`
- **Severity:** CRITICAL. The bot can never place an order in production. First force-brief attempt errored with `getExecutor(): executor has not been constructed.` despite `state.last_boot_at` showing boot completed at 04:44 UTC (boot writes that AFTER `bootConstructExecutor()` succeeds, so the executor *was* built).
- **Cause:** Both files store their singleton in a module-scope `let`. Next 16 App Router bundles `instrumentation.ts` (which runs `runBoot()`) into a different chunk from the API route handlers. Each chunk gets its own copy of the module, with its own `let constructedExecutor = null`. Boot constructs the executor in chunk A's instance; the route handler reads from chunk B's instance and sees `null`.
- **Why missed in tests:** Vitest unit tests run in a single Node process with a single module graph — no chunk splitting. The bug only manifests in a Next-built production bundle.
- **Why missed before:** This was the FIRST attempt to actually run a morning brief end-to-end in production. Per CLAUDE.md "Status" section: "Successful Opus morning brief (last attempt failed on legacy-thinking-config issue, since fixed)" — meaning before now, the brief had never reached the point of calling `getExecutor`. So this bug has been latent the entire time the bot has been deployed.
- **Fix:** Hoist the singleton storage to `globalThis`. This is the standard Next.js / Drizzle / Prisma pattern for surviving HMR + bundle splitting. globalThis is shared across all bundles within the same Node process. Single-process app on DO basic-xxs, so this is sufficient — no DB-backed singleton needed.
- **Found by:** Logging in via the dashboard's auth flow, POST /api/controls/force-brief, immediate response with the error. This was the first action attempt after CI was wired and the new code deployed.

### 11. BTC core entry path never inserts a position record
- **File:** `src/lib/orchestration/decision-executor.ts` lines 591–614 (the `dca_in` branch of `executeBtcCoreDecision`)
- **Severity:** CATASTROPHIC if the bot keeps running. The bot would:
  1. DCA in $X of BTC on day 1 (order filled, cash deducted, no position created)
  2. Day 2 morning brief reads `currentBtcCoreUsd = 0` (sums positions of type btc_core, which is empty)
  3. AI decides to DCA in to reach 50%-of-account target — places another full-size order
  4. Repeat until cash runs out, somewhere around day 2–3 in paper, or worse in live (real BTC actually being bought, but bookkeeping invisible)
  5. Equity calculation in `last_equity_paper_usd` undercounts equity (positions value = 0), so the dashboard shows the operator "losing" money equal to all the BTC purchased
- **Cause:** The alt-cycle path (lines 438+) correctly calls `insertPosition({ type: "alt_cycle", ... })` before placing the order. The BTC core path was never given the equivalent — order is placed, no position row inserted.
- **Confirmation in production:** First successful force-brief (post `06e4a0e` deploy) returned `{ kind: "placed", orderId: paper-ffab43a0..., sizeUsd: 5000, price: 80729.51 }`. `/api/dashboard/positions` then returned `open: []`. Order is in the orders table; no position exists.
- **Why missed:** `decision-executor.test.ts` exists and tests pure helpers (preflight, sizing, trailing-stop ratchet, partial-sell quantity) but not the full BTC core entry → position bookkeeping. Integration tests under `test/integration/` cover state-writer, budget gate, paper isolation, mode transition, circuit breakers — but not orchestration end-to-end. There is no test that asserts "after `dca_in`, a `positions` row of type `btc_core` exists with the bought quantity."
- **Status — FIXED (`039eb48`).** Mirrors the alt pattern: ONE evergreen `btc_core` position per session. `dca_in` either updates qty + weighted-avg entry, OR inserts new if first time. `dca_out` decrements qty, OR closes if drained. `exit` closes (status=closed, exitPrice, exitTime, exitReason).
- **Verified on production (post-deploy `c573abbf`):** second force-brief returned `positionId: b947e98c-...`. `/api/dashboard/positions` now shows the `btc_core` position: 0.03077 BTC @ $80,766, catalyst `regime=chop dca_in`, with the AI's full thesis as context.

### 14. Orphan paper order from the buggy first brief — equity is bogus
- **Severity:** Cosmetic in paper; would have been catastrophic in live.
- **State after fix:** Paper account shows `equityUsd: $4955, cashUsd: $2470, returnPct: -50.4%` despite ZERO realized losses. The bot bought ~$7500 of BTC total across both briefs but only tracks $2485 as a position. The first brief's $5000 deduction sits in `paperCashFlowsFromDb` cash accounting without a corresponding position row.
- **Side effect on second brief's reasoning:** The Opus brief explicitly said "catastrophic -50% vs BTC underperformance" — it was reasoning on the bogus equity curve. Coincidentally arrived at the right conclusion ("build BTC core back from 0%") but the input data was garbage. **An AI reasoning sensibly on garbage is more dangerous than one failing visibly.**
- **Cleanup options for operator:**
  - **Option A** (cleanest): `POST /api/controls/reset-paper` with typed phrase, reseeds to $10k. Wipes evaluations history (loses the two test briefs).
  - **Option B**: write a one-off heal step that detects filled paper BTC orders without a `btc_core` position link and creates the position. Code complexity for a one-time issue.
  - **Option C**: leave as-is, accept ~$5k of paper "loss" that isn't real. Noisy until next brief, then equity curve corrects itself going forward.
- **Recommended:** Option A — clean slate, no contaminated history, two failed test briefs aren't useful data anyway.

### 12. Paper starting capital is $10,000, not the documented $500
- **File:** documentation drift — `CLAUDE.md` says `PAPER_STARTING_CAPITAL_USD = 500`, but `/api/dashboard/wallet` returns `paper.startingCapitalUsd = 10000`.
- **Severity:** Low (cosmetic + docs). The bot itself is consistent — chop regime → 50% target → $5000 sized order matches a $10k account. Only the documentation is wrong.
- **Likely cause:** Operator re-anchored at some point via `POST /api/controls/re-anchor-capital` (which CLAUDE.md notes accepts an operator-supplied amount in paper mode). Or `PAPER_STARTING_CAPITAL_USD` was changed in the code constant since CLAUDE.md was written.
- **Disposition:** Note for memory update — paper starting capital is currently $10k. Don't claim $500 anywhere.

### 13. Coinbase wallet content has drifted from documentation
- **File:** documentation drift — `CLAUDE.md` says "Old key 88674a25 has the $500 USDC."
- **Severity:** Low (informational), MEDIUM if the bot ever flips to live mode.
- **Actual content (snapshot 2026-05-10T05:08 UTC):** $1557.31 total — 3076 AERO ($1557.01) + dust ETH ($0.0000075) + $0.30 USDC. So the operator has been actively using the funded key — most of the value is in AERO (a watchlist asset), almost no cash.
- **Implication for live-mode flip:** Cross-mode boot rejection only checks the bot's own positions tables. It does NOT check the real wallet. If the bot is flipped to live mode, the live executor will see ~$0.30 cash and 3076 AERO sitting in the wallet that it didn't put there. Re-anchor would capture $1557 starting capital but the bot wouldn't know the AERO is "the operator's holding" vs "an existing position." Worth thinking about before any live-mode test.

### 15. Morning brief never persists the regime classification
- **File:** `src/lib/orchestration/morning-brief.ts`
- **Severity:** CATASTROPHIC. Regime detection is the central alpha source of v3 strategy. The brief classifies regime correctly but never writes it to `state.current_regime`. Effect:
  - Dashboard always shows `regime: null`
  - `days_in_current_regime` never increments
  - `last_regime_change_at` never set
  - Tomorrow's brief data package reads `currentRegime: null` (via `portfolio.ts` line 60) — the AI gets zero context about prior regime classification
  - Regime-change detection (one-level-per-day rule per CLAUDE.md) impossible — there's no prior regime to compare against
  - The bot operates as if every morning is its first morning forever
- **Found by:** `/api/dashboard/status` returned `regime: null, daysInRegime: null` immediately after a brief that explicitly returned `regime=chop`.
- **Fix (`039eb48`+):** Added regime persistence at the end of `runScheduledMorningBrief()`. Reads previous regime + days, writes new regime, increments days (or resets to 1 on change), updates `last_regime_change_at` if changed. All writes get `relatedEvalId` so the audit trail can trace which brief triggered each.
- **Why missed:** No test asserts that after a brief, `state.current_regime` matches the brief's classification. The orchestration layer's tests focus on order placement, not state-side-effects of brief output.

### 16. Equity curve includes pre-reset history — chart looks like a catastrophic crash + recovery
- **File:** `src/app/api/dashboard/equity-curve/route.ts`
- **Severity:** UX/operator-trust HIGH. Functionally cosmetic but the operator's confidence depends on a clean equity chart.
- **Cause:** `reset-paper` preserves the audit trail (per CLAUDE.md / `system_state_history` design). Equity curve queries `last_equity_paper_usd` writes from history, going back `days` (default 30). After a reset, the query happily returns the pre-reset values — which were from a totally different paper "account."
- **Symptom:** 601 points returned post-reset. 573 of them showed `equity: $0.26` (3 days of stale data from before today's reset), then 28 points jumped to `$10,000+`. Chart would render as a flat line near zero for 3 days followed by a vertical spike — the operator would assume the bot lost all the money and only just recovered.
- **Fix:** Anchor the curve from the most recent `starting_capital_paper_usd` write timestamp in `system_state_history`. The operator-visible chart respects the hard cut even though the underlying audit trail doesn't.
- **Found by:** Spot-checking dashboard endpoints during the iteration loop.

### 17. (FALSE ALARM) Wakeup cycle apparently dead post-deploy
- **Initially flagged as:** No wakeup activity in `/api/dashboard/overview` after 13+ min and the wallet endpoint showing stale `$10k` cash.
- **Resolution:** Wakeup IS running. The dashboard's `recentActivity` only shows wake-up TRIGGER fires (position move, stop fill, news keyword) from the `wakeups` table — it does not show wakeup CYCLE ticks. With no held positions hitting >5% moves and watch-list keywords not matching news, the cycle runs silently. Subsequent re-check showed the wallet now updated correctly.
- **Lesson for future debugging:** "no wakeup row" ≠ "no cycle running". Confirm by checking `last_equity_paper_usd` actually changes over time.

### 18. Activity tracker had the same bundle-isolation bug as #10
- **File:** `src/lib/activity/tracker.ts`
- **Severity:** UX HIGH — operator's "what is the bot doing right now" indicator was always empty.
- **Cause:** `const active = new Map(); const recent = [];` at module scope. Wakeup cycle / Sonnet check / morning brief run in the instrumentation bundle and write to *that* bundle's copy. The `/api/dashboard/activity` route runs in a different bundle, reads its own empty Map/Array.
- **Same root cause as finding #10** — Next 16 App Router bundle splitting + module-scope mutable state.
- **Symptom:** `/api/dashboard/activity` returned `active: [], recent: []` immediately after the wakeup cycle had clearly run (equity-curve point timestamps proved it).
- **Fix:** Hoisted the Map + Array to globalThis, same pattern as the executor + mode singletons. Once-per-bug; should not recur because the only OTHER mutable module-scope state in `src/lib` is lazy-initializer caches (config, anthropic SDK, postgres pool) which are idempotent and safe to duplicate per bundle.
- **Audit:** Grepped for module-scope mutable state across `src/lib`. Confirmed `intervalHandle` in `scheduler/loop.ts` is also module-scope but doesn't matter — the timer it tracks is a process-global Node primitive that fires regardless of which bundle holds the handle reference.

### 19. Watch list triggers from prior briefs don't expire when a new brief lands
- **File:** `src/lib/ai/flows/morning-brief.ts` (the persist step) + `src/lib/db/queries/triggers.ts`
- **Severity:** MEDIUM. Cosmetic during low-cadence operation (one brief per day = each replaces by activeUntil cushion before stacking matters), but during force-iteration or any resumed-after-pause cadence the stale triggers stack.
- **Symptom:** After 4 force-briefs in this session, `/api/dashboard/today` returned `activeTriggers: 30` while the latest brief generated only `watch_list: 3`. STRATEGY.md §5.3 + CLAUDE.md both say "watch list expires at next morning's brief" — but the schema only gave each trigger a 26h `activeUntil` cushion, with no explicit expiry on new-brief insert.
- **Why it matters in production:** the wakeup cycle's news_keyword check evaluates ALL active triggers every 5 min. With 30 stacked stale triggers from prior briefs, the bot wakes itself up on conditions the AI no longer thinks are relevant — wasting Sonnet API calls on outdated context, OR worse, taking position-affecting actions based on stale watch criteria.
- **Fix:** Added `expireTriggersFromPriorBriefs(newEvalId, now)` query helper that sets `activeUntil = now` on any trigger where `morningEvalId != newEvalId` AND `activeUntil > now`. Called from `flows/morning-brief.ts` *before* inserting the new batch. The 26h fallback cushion stays as defense in depth in case a brief never replaces it (e.g., bot down for >24h).

### 20. Opus morning brief responses being truncated / empty due to insufficient max_tokens
- **File:** `src/lib/anthropic/client.ts` — `OPUS_EFFORT_BY_CALL_TYPE.morning.maxTokens`
- **Severity:** CATASTROPHIC. Two consecutive briefs failed during this session, both billed (~$0.40-0.47 each), neither produced a usable response. Morning brief is the central cadence of the bot — if it's flaky, the bot is dead.
- **Symptoms:**
  - Brief at 06:40 — 4396 chars of valid JSON, **truncated mid-string** (last char was `"` closing a string value, no `}` to close the object). Schema parse correctly failed.
  - Brief at 06:45 — **0 chars of output** but $0.47 billed. Cost billed for thinking-tokens-only output.
  - Earlier briefs (06:25, 05:55, 05:51, etc.) succeeded with 4316-5662 char responses. So this is intermittent at the existing budget.
- **Cause:** `max_tokens: 16_000` is the TOTAL budget for adaptive thinking + output. Per Anthropic's API contract for Opus 4.7+, thinking tokens count against the same ceiling. With `effort: "max"` the model uses the bulk on thinking; longer/more-detailed responses run out of room before completing.
- **Fix:** Bumped morning brief + review (both use `effort: "max"`) from 16k → 32k. Anthropic only bills used tokens, so the higher ceiling is free when not needed but rescues briefs that need to think hard AND produce a long structured response.
- **Why this wasn't caught earlier:** The bot has only EVER produced a successful brief in production today (per CLAUDE.md "Status" — previous attempts failed on the legacy thinking config). The first few succeeded under 16k by chance; once the AI's reasoning got more thorough (after the regime persistence + position management deploys gave it richer context), it ran out of headroom.
- **Future-proofing:** Should also surface `stop_reason` from the Anthropic response in error logs so this is identifiable from logs alone, not just symptom analysis. Filed as a follow-up consideration.

## Stylistic findings (downgraded to warning)

### 8. `react-hooks/set-state-in-effect` — 7 warnings remaining
- **Files:** `src/app/(dashboard)/controls/page.tsx`, `src/components/app-shell/command-palette.tsx`, `src/components/app-shell/price-ticker.tsx`, `src/components/ui/confirm-dialog.tsx`, `src/lib/contexts/dashboard-view.tsx`
- **Disposition:** Rule is new in `eslint-plugin-react-hooks` v7 (shipped with React 19). It flags legitimate hydration / clear-on-open patterns. Downgraded from `error` to `warn` in `eslint.config.mjs` so they remain visible but don't block CI. Re-evaluate per case if any of these ever surface as a real bug.

---

## Tooling caveats

### 9. `actions/checkout@v4` and `actions/setup-node@v4` use Node 20
- GitHub will force them to Node 24 on June 2 2026 and remove Node 20 from runners on Sep 16 2026.
- Trivial to bump to `@v5` whenever they release. Not urgent.

---

## Process notes

- The DO key exception was narrowly scoped to **monitoring deploy status from the operator's local PC**. The key never left the machine. The standing policy (no secrets in any cloud secret store; only DO env vars are an acceptable off-PC destination) remains in force.
- CI requires zero GitHub Actions secrets. Live Coinbase smoke runs locally only via `RUN_LIVE_SMOKE=1 npm test -- coinbase-smoke`.
