# CI rollout + first-real-exercise findings

Two-phase document: (a) the CI pipeline we built and why, (b) every bug it surfaced, plus every bug found by force-iterating the deployed bot afterward. 30 distinct findings as of session 2026-05-10.

## Session 2026-05-10 close-out

After landing the bug-fix wave during the live force-iteration loop, a follow-up sweep closed three remaining items:

- **#27 (convert-to-btc-hold)** — fixed. Inherits #11 + #21 closure shape: aggregates fees via the new helper on close, inserts a `btc_core` position before placing the BTC buy.
- **#21 / #30 fee-aggregation follow-up** — resolved. New `orders.feesUsd` column. Paper-executor persists fees on every fill (both at-place-time `simulatedFill` and async `processPendingFills`). New `sumFilledOrderFeesForPositionForCurrentMode` helper aggregates fees across all linked orders. Threaded through every close path — `close-all`, `decision-executor` BTC core exit + dca_out drained + alt `handleExit`, `wakeup-cycle` stop/tp/market_exit, `convert-to-btc-hold`. The wakeup-cycle path is canonical (full entry+exit aggregation); the other paths still slightly undercount in paper mode because the just-placed market_exit is `pending` at close time. Live-mode fees await a reconciliation step.
- **#9 (GitHub Actions versions)** — done. `actions/checkout@v4` → `@v5`, `actions/setup-node@v4` → `@v5`.
- **Paper-mode `close-all` + `convert-to-btc-hold` null P&L** — fixed. `placeMarketExit` returns a `pending` order in paper mode (and live mode pre-reconciliation), so `result.fillPrice` was undefined and these paths wrote `null` exitPrice / grossPnl / netPnl. The wakeup-cycle close path couldn't fix it later because its status guard sees the row already closed. Both routes now fetch a fresh ticker via `getTickers(uniqueAssets.map(productIdFor))` and use `result.fillPrice ?? result.price ?? tickerMidPrice` as the exitPrice fallback. Phase 1 metrics now compute correctly even when these emergency controls fire.

**Still on the punch list (deliberately deferred):**
- **#8** — 7 react-hooks/set-state-in-effect warnings, downgraded to warn. Legitimate hydration / clear-on-open patterns.
- **#12, #13, #14** — documentation drift / one-time data issues. The runtime $10k paper anchor was operator-induced; CLAUDE.md still correctly references the $500 constant.
- **Live-mode `orders.feesUsd` population** — the new column exists; live executor needs a reconciliation step to write Coinbase fee data. Not urgent until Phase 2 (live trading).
- ~~drizzle-kit push 42P16~~ **RESOLVED.** Upgraded drizzle-kit 0.28→0.31.10 + drizzle-orm 0.36→0.45.2. drizzle-kit 0.31.7 fixed issue #4944 ("Drizzle Kit push to Postgres 18 produces unnecessary DROP SQL when the schema was NOT changed"). Verified locally against `postgres:18` docker container and in prod (deploy log now shows `[i] No changes detected` instead of 42P16). `applyAdditiveMigrations` retained as an empty no-op escape hatch. Pre-existing prod positions drift (`asset`/`direction`/`entry_price`/`entry_time` nullable) was also fixed via the temporary additive-migrations layer; columns are NOT NULL in prod now.

After this sweep: 264 unit tests pass, eslint shows only the 7 warnings noted in #8, lint:queries clean, build OK with stub envs.

A second sweep added the close-all / convert-to-btc-hold ticker-fallback fix (above). Same numbers — typecheck clean, 264 tests pass, lint clean, lint:queries clean.


## Part 0: What we built (CI pipeline design)

**Starting state:** repo had zero CI. All checks lived as manual scripts (`npm run typecheck`, `npm test`, `npm run lint:queries`). They worked but nothing enforced them on pushes/PRs. The `npm run lint` script was silently broken since the Next 16 upgrade — failing with a misleading error message that looked like a path issue, so nobody had run lint in months.

**What we considered for CI host:**
- GitHub Actions ✓ (chosen — native to repo, free, easy Postgres service container)
- DO App Platform pre-deploy hook (rejected — would need a separate paid managed Postgres for CI integration tests)
- Husky-only local hooks (rejected — no enforcement on PRs, no scheduled smoke automation)

**What we considered for the deploy step:**
- CI auto-deploys on green main via `force_build` API call (rejected after operator pushback — would put `DO_API_KEY_WRITE` in GitHub Secrets, violating the "secrets stay local" policy)
- DO auto-deploy from main (chosen as default — already enabled, sometimes flaky)
- Manual `bash scripts/deploy.sh` from operator's machine (chosen as fallback — reads `~/Desktop/.nibbles-secrets` locally)

**What we considered for live-API smoke tests:**
- `.github/workflows/smoke.yml` running `RUN_LIVE_SMOKE=1 npm test -- coinbase-smoke` on a weekly cron (rejected after operator pushback — would put Coinbase + Anthropic API keys in GitHub Secrets)
- Local-only invocation when wanted (chosen — operator runs `RUN_LIVE_SMOKE=1 npm test -- coinbase-smoke` on their PC; `smoke.yml` was deleted)

**Final pipeline (`.github/workflows/ci.yml`, ~1m30s on cold cache):**

| Stage | Job | Purpose |
|---|---|---|
| 1 (parallel) | typecheck | `tsc --noEmit` |
| 1 | lint | `eslint .` (rewrote eslint.config.mjs to native flat config — old FlatCompat shim was crashing on a circular reference) |
| 1 | lint-queries | `bash scripts/lint-queries.sh` — enforces paper/live mode isolation + coinbase/orders import isolation |
| 1 | unit-tests | 256 tests, no DB |
| 2 | build | Next 16 + Turbopack with stub envs (lazy-init lets it complete without real DB / Coinbase / Anthropic) |
| 3 | integration-tests | Postgres 16 service container + `RUN_INTEGRATION=1` (30 tests covering state-writer atomicity, paper-mode isolation, mode transition, btc-underperformance gate, circuit breakers) |

**Local hooks (husky):** pre-commit runs `lint-staged` (eslint --fix on staged ts/tsx) + `lint:queries`; pre-push runs `typecheck` + `npm test`. Catches ~80% of CI-breakers before push.

**Repo secrets required: zero.** This is the policy contract — CI is a quality gate, deploys are local.

**What CI immediately caught on its first real run:**
- `next lint` script silently broken (Next 16 removed the subcommand)
- `eslint-config-next` needed flat-config-native rewrite
- 14 pre-existing lint errors that broken-lint had been hiding — including a real correctness bug (`use-coinbase-ticker.ts` rebuilding the WebSocket on every parent re-render via a `useCallback` dep cycle) and a latent bug (`wakeupsByTypeSince` ignoring its `since` parameter)
- `db/index.ts` had `ssl: "require"` hardcoded — broke any local-Postgres-based integration test environment, which CI was the first place to ever run

After CI was wired and the deploy went out, force-iterating the bot in production (per operator instruction "fix the quick bugs to get into the condition to do a long term test") surfaced a further wave of bugs that CI hadn't covered — because they only manifested in real Next.js production bundles or under live API call patterns that no test was exercising. Those bugs are findings #11 onward.

---

## Part 1: Bugs (with severity, cause, fix, verification)

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
- **Verified live** (deploy `2bc2660`): force-brief returned `ok: true`, regime=chop, parsed=True, responseLen=4312, cost=$0.33. Within similar cost band as previous successful briefs — the higher ceiling cost nothing.

### 21. Closed positions never had P&L computed
- **Files:** `src/app/api/controls/close-all/route.ts`, `src/lib/orchestration/decision-executor.ts` (BTC core exit + dca_out drained branches)
- **Severity:** HIGH for Phase 1 evaluation. Without P&L on closed trades, the dashboard's `closedTradeCount`, `winRate`, `avgWinPct`, `feeDragPct`, and the entire performance retrospective are blank — the operator can't tell if the strategy is working.
- **Symptom:** After close-all marked the test position closed, `/api/dashboard/positions` showed `exitPrice: None, grossPnl: None, netPnl: None`. CLAUDE.md says "Trade close → compute gross P&L, fees, net P&L, cost basis" but the actual close handlers were just setting `status='closed'` + `exitTime` + `exitReason`.
- **Fix:** All three close paths now populate `exitPrice` (from the market exit's `fillPrice`), `grossPnlUsd` ((exitPrice − entryPrice) × qty), `feesUsd`, and `netPnlUsd` (gross − fees).
- **Follow-up — RESOLVED.** `feesUsd` was originally exit-side only. Closed in a follow-up: schema now has an `orders.feesUsd` column, paper-executor populates it on every fill (both `simulatedFill` and `processPendingFills`), and every close path (`close-all`, `decision-executor` BTC core exit + dca_out drained + alt `handleExit`, `wakeup-cycle` stop/tp/market_exit, `convert-to-btc-hold`) calls `sumFilledOrderFeesForPositionForCurrentMode(positionId)` to aggregate ALL filled-order fees (entry + exit) for the position. `summarizeFilledOrderFees` is unit-tested. Caveat: in paper mode the just-placed market_exit is `pending` until the next 5-min wakeup tick, so its fee is reflected only on the wakeup-cycle close path (the canonical path with synchronous fill data) and is a small undercount on close-all / decision-executor / convert-to-btc-hold paths. Live mode fees aren't populated until reconciliation lands an `updateOrder` with `feesUsd` from Coinbase, which is a separate piece of work for when live trading begins.

### 22. Brief data package hardcodes positionsValueUsd to 0 — AI sees inflated current_alloc, dca_outs every brief
- **File:** `src/lib/orchestration/morning-brief.ts` line 95 (now fixed)
- **Severity:** CATASTROPHIC. Caught only by accident — I noticed the BTC core position quantity had halved (0.06195 → 0.03069) without my having forced a dca_out, then traced the cascade back to the source.
- **Found by:** The 14:00 UTC scheduled brief fired (the FIRST naturally-scheduled brief of the day, not a force) and decided `action=dca_out, target=50%, current=100%` despite the actual position being 50%. The AI was correct given its inputs; its inputs were wrong.
- **Cause:** Line 91-92 of `morning-brief.ts` had a comment from Phase 9 saying "For now we approximate position value as 'cash + 0 positions' — Phase 9's full mark-to-market loop fills this in once equity snapshots are wired." Phase 9 wired the equity snapshots but never came back to fix this call site. So `assemblePortfolioSnapshot` got `positionsValueUsd: 0` forever. Result: `currentTotalValueUsd = cashUsd + 0`, but `currentBtcCoreUsd` was computed separately from real position values. The AI saw `currentBtcCoreUsd / currentTotalValueUsd = $5000 / $5000 = 100%`, target 50%, decided sell half. **This would have happened on EVERY brief**, slowly draining BTC over weeks while the bot believed it was just hitting target.
- **In production this would have been:** day 1 buy 50%, day 2 sell 25% to "rebalance", day 3 sell 12.5%, etc. Bleeding losses to fees while the equity curve looked stable until very late. Easy to mistake for "strategy works, allocation just keeps cycling."
- **Fix:** Compute `positionsValueUsd` up front by mark-to-market on `openPositionsForCurrentMode()` × the same `priceMap` that's about to be sent to the AI. Pass that real number into `assemblePortfolioSnapshot`. The previously-hardcoded 0 is gone.
- **Why missed by tests:** Tests for the brief flow mock the AI response and check execution. None of them asserted "the input given to the AI's portfolio context contains real position values."

### 23. Reset-paper FK violation: tries to delete positions before orders
- **File:** `src/app/api/controls/reset-paper/route.ts`
- **Severity:** HIGH. Operator's safety control to wipe paper progress was BROKEN — every call returned `ok: false` with a Postgres FK constraint error. If the operator wanted to reset (e.g., before starting Phase 1), they couldn't.
- **Cause:** `deleteAllPositionsForCurrentMode()` called before `deleteAllOrdersForCurrentMode()`. But `orders.relatedPositionId` is a FK to `positions.id`. Deleting positions first violates the constraint.
- **Found by:** First `reset-paper` after fix #22 deploy returned `update or delete on table "positions" violates foreign key constraint "orders_related_position_id_positions_id_fk"`.
- **Fix:** Swap the order — orders first (no FK in), then positions. One-line fix.
- **Why missed:** Reset-paper had been used in this session (~01:34 UTC, ~05:49 UTC). Both worked — because there were FILLED ORDERS before reset but no `relatedPositionId` set on the BTC core orders (BTC core path #11 never linked them — both bugs hid each other!). Fix #11 finally linked orders to positions, which exposed #23 the next time reset ran.

### 24. Opus emits trailing commas in JSON; lenient parser didn't handle them
- **File:** `src/lib/anthropic/client.ts` — `parseJsonLenient`
- **Severity:** HIGH. Caused another silent brief failure (cost $0.18, no usable output).
- **Symptom:** Opus response was 4080 chars, ended cleanly with `}`, but JSON.parse failed with `Illegal trailing comma before end of object`. Existing parser had three fallbacks (raw, fence-stripped, brace-substring) — none of them handled trailing commas.
- **Why this matters:** This is intermittent (random LLM output variation), so it would silently fail briefs in production with no obvious pattern.
- **Fix:** Added a 4th fallback — strip trailing commas before `}` or `]` and retry parse. Three new tests added (`test/parse-json-lenient.test.ts`) lock in the behavior.
- **Found by:** Inspecting the failed brief's raw response text after seeing the same "morning brief response was not valid JSON" error post-#20 fix.

### 25. Soft circuit breaker (≥20% drawdown halves alt sizes) was hardcoded OFF
- **File:** `src/lib/orchestration/morning-brief.ts` — line 196 (now fixed)
- **Severity:** MEDIUM (alt-only) but high-blast-radius if it ever mattered. Per STRATEGY.md §6.4 the soft breaker halves alt position sizes when drawdown from peak ≥20%. The brief was passing `softBreakerActive: false` always (with a TODO comment "wired when soft breaker state is tracked"), so alts would get full size even at catastrophic drawdown — exactly when the strategy says to be defensive.
- **Cause:** Stale Phase 9 TODO. Pure logic existed in `circuit-breakers.ts` (`evaluateSoftBreaker`) but was never wired into the brief flow.
- **Fix:** `softBreakerActive: portfolio.drawdownFromPeakPct >= 20`. Simple non-hysteresis trip — full hysteresis (clear at -10% recovery) deferred until/unless we see it tripping too aggressively in practice.
- **Found by:** Audit of `Phase X` / `wired when` patterns in code after #22 surfaced as a Phase 9 leftover.

### 26. Re-anchor with open positions silently corrupts cash + position-value bookkeeping
- **File:** `src/app/api/controls/re-anchor-capital/route.ts`
- **Severity:** HIGH (in the silent-bookkeeping-bug category — operator wouldn't notice for days).
- **Cause:** Route always writes `last_cash_paper_usd = totalUsd` and `last_positions_value_paper_usd = 0`, regardless of whether positions exist. If positions are open at re-anchor time, the new state lies — claims all-cash + zero positions when neither is true. The next morning brief reads stale cash + positions context, makes wrong allocation decisions.
- **Reproduction in this session:** Pre-state: $10k start, 1 BTC position. Re-anchored to $20k. Post-state: cash=$20k, equity=$20k, return=0%, positions: still 1. The bookkeeping says "$20k all cash" while the actual paper account has $5k cash + $5k BTC.
- **Fix:** Refuse re-anchor if open positions exist. Same pattern as toggle-mode's open-position gate. Operator must close-all or reset-paper first. Returns HTTP 409 with actionable error.
- **Why missed:** No test exercises re-anchor with positions held — only with the clean post-reset state.

### 27. convert-to-btc-hold inherits bugs #11 + #21 (no position record on buy + no P&L on close)
- **File:** `src/app/api/controls/convert-to-btc-hold/route.ts`
- **Severity:** Medium-low. This is the §4.4 honesty-check fallback used at most once in the bot's lifetime, when the operator decides the strategy has no edge. Emergency endpoint — the bot is being shut down via this control regardless.
- **Bugs:**
  1. Closes positions with `status='closed' + exitTime + exitReason` only — no exitPrice, grossPnl, fees, netPnl. Same as #21 in close-all (now fixed).
  2. Calls `executor.placeDcaLimitBuy("BTC", ...)` directly to buy BTC with cash, bypassing the decision-executor that creates the `btc_core` position record. Same root cause as #11. Result: a BTC purchase with no `positions` row to back it.
- **Status — FIXED.** Close path now mirrors close-all: aggregates fees via `sumFilledOrderFeesForPositionForCurrentMode`, populates exitPrice / grossPnl / feesUsd / netPnl. BTC buy path now inserts a `btc_core` position row first and threads `relatedPositionId` into `placeDcaLimitBuy`, so the resulting state has a real position backing the buy. Emergency endpoint is still emergency (one-shot, halts), but if it ever fires it now leaves clean books.

### 28. Failed morning brief blanks Sonnet visibility + dashboard "today" view for ~24h
- **Files:** `src/lib/orchestration/sonnet-checkpoint.ts`, `src/lib/orchestration/wakeup-cycle.ts` (`runSonnetForWakeup`), `src/app/api/dashboard/today/route.ts`
- **Severity:** HIGH. Compounds with #20/#24 (any future brief failure becomes a 24h Sonnet outage on top of the brief loss).
- **Cause:** All three locations did `briefs[0]` to grab the most-recent morning evaluation. `evaluations` rows from a failed brief have `parsedResponse=null` (the brief flow stores the evaluation regardless of parse success — for audit). So a single failed brief shadows the prior successful one. Sonnet checkpoint returns `awaiting_morning_brief`, today endpoint returns `brief: null`, wake-up trigger Sonnet runner returns `no_morning_brief_yet`.
- **Symptom in this session:** When brief at 14:52 failed parse (was the trailing-comma case), the today endpoint returned `brief: null` even though the 14:05 brief and earlier ones had succeeded.
- **Fix:** All three call sites now use `briefs.find((b) => b.parsedResponse != null)` instead of `briefs[0]`. The latest SUCCESSFUL brief is what matters; failed attempts shouldn't suppress everything else.
- **Why missed:** No test sets up state with a failed brief preceding a successful one, then asserts the consumers fall back correctly.

### 29. Boot reconciliation detects missedEvaluation + emergencyTriggers but never acts on them
- **Files:** `src/lib/boot/index.ts` (caller), `src/lib/execution/reconciliation.ts` (detector)
- **Severity:** HIGH for production resilience. Bot crashes are rare but when they happen, the bot needs to recover gracefully.
- **Symptom:** `reconciliation.ts` ends with a comment: "NOTE: This module's responsibilities are checks + safety actions. The actual rerun of missed evaluations is dispatched by the caller (the boot flow) after reconciliation returns its findings." But `boot/index.ts` only logs the findings and returns — never dispatches. Result:
  - Bot crashes past 14:00 UTC, restarts at 16:00 UTC → `missedEvaluation: true` is set, never acted on → the bot stays stale until the NEXT day's 14:00 UTC scheduled brief (~22 hours of stale state).
  - Bot crashes during a 5%+ price move → `emergencyTriggers` set, never acted on → bot proceeds blind.
- **Fix:** After scheduler starts, check `reconciliationFindings.missedEvaluation` and dispatch a catch-up `runScheduledMorningBrief()` (fire-and-forget so health checks aren't blocked). For `emergencyTriggers`: the 5-minute wakeup cycle catches held-asset moves on its next tick. Logged loud but no separate dispatch.
- **Follow-up — RESOLVED as by-design.** Originally noted that "asset-level moves on non-held assets need a routing decision." The only window where `emergencyTriggers` fires without `missedEvaluation` is short downtime that spans a 5%+ move on a non-held asset, with the next 14:00 UTC brief still ahead. The next scheduled brief picks up the move via its normal regime classification, since regime detection is multi-day-timeframe per STRATEGY.md §3.1. Adding an explicit dispatch would risk noise (Sonnet calls every short crash recovery) without clear benefit.
- **Found by:** Code-reading the reconciliation flow looking for caller-handoff bugs after exhausting the dashboard / control surface bugs.

### 30. Stop / take-profit / market-exit fills don't close the position record
- **File:** `src/lib/orchestration/wakeup-cycle.ts` (lines 119-138)
- **Severity:** CATASTROPHIC for live alt cycle trading.
- **Cause:** When the wakeup cycle detected a fill of type `stop_limit` / `take_profit` / `market_exit`, it dispatched the wake to Sonnet (good) but **the comment explicitly said "we leave the position update to the next reconciliation pass"** — and neither morning brief nor force-reconcile actually does that.
- **Effect:** An alt position whose stop fires has its sell order filled (cash credited via paperCashFlowsFromDb), but the `positions` row stays `status='open'` with original quantity. Next morning brief computes equity = cash + (full alt position at current price), inflated by the alt's mark-to-market value. Next decision is made against fictional holdings.
- **Why undetected so far:** The bot has never held an alt position in any session. Only BTC core positions exist (which have no stop per §3.7). The TODO would have detonated the first time an alt entry happened and its stop fired.
- **Found by:** Audit of "premature decoupling" patterns after #29 — looking for "we leave X to the caller / next pass / reconciliation" comments where the caller / next pass / reconciliation doesn't actually do it.
- **Fix:** Look up the order via `orderByCoinbaseIdForCurrentMode(fill.coinbaseOrderId)`, get its `relatedPositionId`, fetch the position via `positionByIdForCurrentMode`, mark it closed with proper exitPrice + grossPnl + netPnl. Status guard ensures we don't double-close.
- **Follow-up — RESOLVED.** Originally noted that `gross == net` because the orders schema had no `feesUsd` column. That column now exists; this path aggregates ALL fees for the position via `sumFilledOrderFeesForPositionForCurrentMode`. Because the just-filled exit row has its `feesUsd` persisted by `processPendingFills` BEFORE the close runs, this path captures both entry and exit fees correctly — it is the canonical close path with full fee accuracy.

## Stylistic findings (downgraded to warning)

### 8. `react-hooks/set-state-in-effect` — 7 warnings remaining
- **Files:** `src/app/(dashboard)/controls/page.tsx`, `src/components/app-shell/command-palette.tsx`, `src/components/app-shell/price-ticker.tsx`, `src/components/ui/confirm-dialog.tsx`, `src/lib/contexts/dashboard-view.tsx`
- **Disposition:** Rule is new in `eslint-plugin-react-hooks` v7 (shipped with React 19). It flags legitimate hydration / clear-on-open patterns. Downgraded from `error` to `warn` in `eslint.config.mjs` so they remain visible but don't block CI. Re-evaluate per case if any of these ever surface as a real bug.

---

## Tooling caveats

### 9. `actions/checkout@v4` and `actions/setup-node@v4` use Node 20
- GitHub will force them to Node 24 on June 2 2026 and remove Node 20 from runners on Sep 16 2026.
- **Status — DONE.** Both bumped to `@v5` in `.github/workflows/ci.yml` (5 occurrences for checkout, 5 for setup-node).

---

## Process notes

- The DO key exception was narrowly scoped to **monitoring deploy status from the operator's local PC**. The key never left the machine. The standing policy (no secrets in any cloud secret store; only DO env vars are an acceptable off-PC destination) remains in force.
- CI requires zero GitHub Actions secrets. Live Coinbase smoke runs locally only via `RUN_LIVE_SMOKE=1 npm test -- coinbase-smoke`.
