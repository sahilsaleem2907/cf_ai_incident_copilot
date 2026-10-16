# Incident Copilot: Task Board

Live progress tracker for the 2-day build. The plan itself lives in [`TDD.md` §17](TDD.md#17-build-plan-2-days); requirements are in [`PRD.md`](PRD.md). This file changes as work moves. The TDD and PRD change only when a logged decision is folded back into them.

| | |
|---|---|
| **Day 1** | 2026-10-15: M1 + M2 (all Must), WP-01 to WP-13, 14.75 h planned |
| **Day 2** | 2026-10-16: remaining Musts, then Shoulds, WP-14 to WP-26, 8.25 h above the cut line + 3.25 h below |
| **Minimum to submit** | WP-01 to WP-16 (PRD §12) |

**Legend:** ⬜ todo · 🔄 doing · ✅ done · ⛔ blocked · ✂️ cut

**Rules**
- Only one WP is 🔄 at a time.
- Commit after each WP and record the short hash below.
- Work happens on `dev`. Review is a PR from `dev` into `main`, checked by Sift (GitHub Actions). Nothing goes to `main` directly without the user's OK.
- At the end of each day, export the session transcript to `prompts/`.
- Don't share the deployed URL until WP-17 is ✅ **and deployed** (D2).
- When a Day 2 WP lands, move it out of the README's "Designed, not built" table (and add the live URL to the README once WP-17 is ✅).

---

## Now

- **Current:** WP-26 demo GIF + live URL (🔄 since 17:33). WP-24 (`0d1be49`) and WP-25 (`d14953b`, apply pending: user) are done. WP-21 to WP-23 are done and deployed (PR #8); the user checked them live. WP-27c (scroll and evidence bugs, dashed loader) is done (`0a225a0`). WP-27 UI polish and WP-27b follow-ups are done (`f21232b`, `a2f4461`). **Everything above the cut line is done** (WP-01 to WP-20). WP-20's eval passed 5/5 locally. WP-17 to WP-19 are done (not deployed yet); the user tested the demo watch walkthrough and it worked. **Before webhooks work live:** the user sets `WEBHOOK_KEY` (`openssl rand -base64 32 | npx wrangler secret put WEBHOOK_KEY`) **All Musts are done (WP-01 to WP-16)**: the minimum to submit (PRD §12) is met
- **Next:** nothing left in the plan; the user runs the Terraform apply
- **Hours today:** 2.93 / 14.75 h (Day 1) on WPs, plus about 0.3 h review setup
- **Review status (WP-01 to WP-05):**
  - Sift workflows (`sift-review.yml`, `sift-feedback.yml`) are on `main` (`f5707d2`); the zip upload is gone. `main` was merged into `dev` (`bf4ea92`).
  - PR #2 `dev` → `main` ("WP-01 to WP-05") was reviewed by Sift: 5 findings, all false alarms, each answered `/not-helpful` with the reason. **Merged** 2026-10-15 13:40 (`0073839`).
  - PR #1 was closed unmerged; `master` (`867d8d6`) is unused.
  - **PR #3** `dev` → `main` ("WP-06 to WP-10 …") opened 16:47: https://github.com/sahilsaleem2907/cf_ai_incident_copilot/pull/3. Waiting for Sift review.
- **Blockers / risks:**
  - none blocking. WP-15's first automatic deploy passed (merge of PR #4, 2026-10-15).
  - Watch gpt latency: a forced `submit_findings` turn took 19 s once (TDD §7.4.1).
  - **Live walkthrough timing (after WP-13b):** about 10 s to the first card, then about 31 s from Approve to Resolved (2 monitor ticks × 15 s). With a person clicking, steps 1–5 take about 55–60 s, right at the PRD's 60 s. A shorter monitor tick would add slack.

---

## Day 1: M1 + M2 (all Must)

| WP | Task | Est | Deps | Status | Started | Done | Commit / notes |
|---|---|---|---|---|---|---|---|
| 01 | Scaffold | 1.0 | — | ✅ | 00:29 | 00:37 | `867d8d6` (+ docs `58bb6ec`, PRD fold-in). 0.4 h vs 1.0 est |
| 02 | Spike: LLM shapes, streaming, `waitForApproval`, subrequests | 0.75 | 01 | ✅ | 01:00 | 01:10 | `a030286`. 0.25 h vs 0.75 est. About 20 live calls, about 250 neurons |
| 03 | D1 + workspace cookie + session/health + target parser | 0.75 | 01 | ✅ | 01:16 | 01:18 | `9d691c6`. 0.25 h vs 0.75 est |
| 04 | Safety core: SSRF, reader, origin pin, budget | 1.0 | 01 | ✅ | 01:26 | 01:30 | `4dbe27d`. 0.25 h vs 1.0 est |
| 05 | Tools: `dns_lookup`, `http_probe`, `quickCheck`, registry | 1.5 | 04 | ✅ | 01:38 | 01:44 | `307d342`. 0.25 h vs 1.5 est |
| 06 | Rules: `classify.ts`, `template.ts` | 0.5 | 05 | ✅ | 13:44 | 13:49 | `6dad2cf`. 0.1 h vs 0.5 est. TLS spike: workerd hides cert errors (TDD §9.3) |
| 07 | LLM layer: adapter, fallback, usage, prompts, mock, citations, streaming | 1.5 | 02 | ✅ | 14:06 | 14:18 | `4e82395`. 0.2 h vs 1.5 est. Live check ≈ 370 neurons; found the glm grammar bug and `【id】` citations |
| 08 | IncidentAgent: schema, state, roles, RPC, transitions, narrate | 1.5 | 03, 07 | ✅ | 14:40 | 14:50 | `7b2bc3c`. 0.25 h vs 1.5 est. Also `/api/incidents` (nobody owned it; WP-10 needs it) |
| 09 | DiagnosisWorkflow: planning loop, bounds, rule path | 1.5 | 05, 06, 08 | ✅ | 15:15 | 15:22 | `a5ca0ba`. 0.15 h vs 1.5 est. Dev smoke: cloudflare.com end to end in 3 s (mock LLM) |
| 10 | Chat UI | 1.75 | 08 | ✅ | 16:24 | 16:35 | `dea9b32`. 0.2 h vs 1.75 est. Browser-checked in light, dark and at 390 px |
| 11 | Demo service + `DemoPanel` | 1.0 | 03 | ✅ | 16:54 | 17:12 | `09398c0`. 0.3 h vs 1.0 est. Local run of all five modes gave the right category; browser-checked in light, dark and at 390 px. Addition: combined modes (`e891c6c`, decisions log) |
| 12 | Act: actions, approval, verify, monitor, `ApprovalCard` | 1.5 | 09, 11 | ✅ | 17:49 | 18:03 | `f97d8fb`. 0.23 h vs 1.5 est. Local walkthrough: 5 modes break → approve → resolved; reject; viewer. 495 tests |
| 13 | Deploy 1 + live walkthrough + SSRF/CPU checks | 0.5 | 12 | ✅ | 19:06 | 19:15 | `6114882`. 0.15 h vs 0.5 est. Live walkthrough passes; slow (about 100 s vs 60 s target), see the log |
| 13b | Live speed + empty "Likely cause" (found in WP-13) | — | 13 | ✅ | 19:20 | 19:44 | `8053dba`. Baseline checks before the first AI turn, card before narration, cause refilled. Card 35 s → 10 s; runs `done` instead of `limit_turns`; about 140 neurons per run instead of 200 |

> **Slip rule:** if Day 1 runs over, WP-12 and WP-13 move to the start of Day 2, ahead of every Should item.

## Day 2: remaining Musts, then Shoulds

| WP | Task | Est | Deps | Status | Started | Done | Commit / notes |
|---|---|---|---|---|---|---|---|
| 14 | Tests (Must): fill coverage gaps | 1.25 | 12 | ✅ | 21:24 (D1) | 21:27 (D1) | `366d3ed`. 0.05 h vs 1.25 est. +19 tests (`schema`, `cookie`, web `approval`) and 6 `cron` stubs for WP-18; 521 pass, 3 runs in a row. `transitions` already complete. The approval path is covered by `approval.test.ts` (8 cases) |
| 15 | CI/CD (Must): `ci.yml`, `deploy.yml`, smoke | 0.75 | 14 | ✅ | 21:27 (D1) | 22:21 (D1) | `3ae9eeb`. 0.15 h vs 0.75 est (plus the user's secrets). PR #4: CI green (about 1 min, Terraform steps skipped). Merge `1be62ee` → `deploy.yml` run 38772159673 passed: migrations (none new), demo, main (version `f6e0c734`), smoke healthy / rule_based / resolved in about 12 s, against the new version, 0 neurons |
| 16 | README + PROMPTS (Must, **protected time**) | 1.0 | — | ✅ | 21:31 (D1) | 21:35 (D1) | `857cdb2`. README for reviewers (no live URL until WP-17, D2) + PROMPTS overview by phase; secret sweep clean. Done early, so the README's not-built list is kept current through Day 2 |
| 17 | Limits + budget guard | 1.0 | 15 | ✅ | 22:29 (D1) | 22:44 (D1) | `f636c10`. 0.25 h vs 1.0 est. 536 tests pass, 3 runs in a row. Local: 4th run → 429 `retryAfter: 60`; forced 9,000 neurons → banner + rule-based run. Live after the next `dev` → `main` merge. Found 2 older issues (first-visit cookie race, cookie-less quota bypass), see the log |
| 17b | First-visit workspace race + per-IP run limit (found in WP-17) | — | 17 | ✅ | 22:47 (D1) | 22:49 (D1) | `feb4707`. 540 tests pass. Browser: a first visit sets 1 cookie (was 6), the demo URL matches it, and the eager 3+1 check gets 429; a 3rd browser on the same IP was refused from its first run |
| 18 | Watch: API, panel, cron, `WatchWorkflow` | 2.0 | 17 | ✅ | 22:57 (D1) | 23:13 (D1) | `ca576d7`. 565 tests pass, 3 runs in a row. Local, real 500 site: incident 34 s after the cron check; resolved after 3 passes. Demo walkthrough on the live site after the next deploy |
| 19 | Notifications: polling, unread, webhooks, `NotifyWorkflow` | 1.5 | 18 | ✅ | 23:45 (D1) | 23:56 (D1) | `8988fd9`. 585 tests pass, 3 runs in a row. Integration: 3 events → exactly 3 Discord messages, repeats ignored. Local browser: unread + one notification 40 s after a watch failure. Real Discord check after the deploy + `WEBHOOK_KEY` (user) |
| 20 | Eval: `eval/run.ts` + `results.md` | 0.75 | 15 | ✅ | 01:23 | 01:34 | `556418d`. 0.2 h vs 0.75 est. **5/5** on one local live run (gpt-oss-120b, no fallback turns), 642 neurons. 595 tests pass, 3 runs in a row |
| 27 | UI polish (user request): `CtaButton`, status colour map + `StatusPill`, header logo + notifications switch, right bar, dot grid | — | 20 | ✅ | 02:16 | 02:28 | `f21232b`. 599 tests pass (+4). Local browser (port 5190, mock LLM): light, dark, 1440 / 900 / 390 px, no horizontal scroll, no console errors; switch on → off → on saved; purple Awaiting approval, green Resolved, red Fail, orange pills |
| 27b | UI follow-ups (user review): centred CTA, alignment, matching headings, demo/diagnosis pills, tooltip, dashed empty state, footer | — | 27 | ✅ | 02:39 | 02:43 | `a2f4461`. 601 tests pass (+2). Local browser: every column's text lines up with its heading to the pixel (left 26 px, right 1137 px, light and dark); headings 13 px uppercase on both sides; CTA label centred; tooltip shows; no nested buttons; no console errors |
| 27c | Bugs: page scroll past footer, evidence overflow; dashed loader everywhere + chat working row | — | 27b | ✅ | 03:21 | 03:29 | `0a225a0`. 604 tests pass (+3). The scroll bug didn't reproduce in headless Chrome (page never taller than the window, wheel included), so the fix is structural: no `scrollIntoView`, page locked, `overscroll-contain`. Evidence capped at 320 px and wraps (400-char line stays inside the card at 390 px). Working row seen: Running checks… → Writing the diagnosis… → text |
| — | **✂️ CUT LINE**: anything below that isn't built goes into the README "designed, not built" list | | | | | | |
| 21 | `cert_info` + `provider_status` | 1.0 | 09 | ✅ | 16:11 | 16:29 | `33b8467`. 0.3 h vs 1.0 est. 644 tests pass (+40), 3 runs in a row. Real crt.sh in the local browser: cert card on a refused HTTPS host; Cache API hit on repeat |
| 22 | Postmortem | 0.5 | 12 | ✅ | 16:30 | 16:38 | `944a87c`. 665 tests pass (+21), 3 runs in a row. Local browser walkthrough step 6: stored, copied, survives a reload |
| 23 | Voice | 0.75 | 17 | ✅ | 16:38 | 16:44 | `3289689`. 684 tests pass (+19), 3 runs in a row. Headless Chrome with a fake mic: the done-when phrase fills the box, nothing sent |
| 24 | `recheck_burst` | 0.25 | 12 | ✅ | 17:23 | 17:31 | `0d1be49`. 687 tests pass (+3), 3 runs in a row. Local: burst ticks 60 s apart on a real 404 page |
| 25 | Terraform (local apply) | 0.5 | — | ✅ | 17:31 | 17:33 | `d14953b`. Files done; `validate` passes locally. **Apply: user, pending** (README steps) |
| 26 | Demo GIF | 0.25 | 13 | 🔄 | 17:33 | | |

> WP-16 is protected: start it no later than about 1 h before the end of Day 2, whatever else is still in progress.

---

## UI map

The TDD has no standalone UI task. UI work lives inside these WPs, and the checkboxes in each WP's checklist below track it.

| UI piece (TDD §4, §12) | Built in | Priority |
|---|---|---|
| `styles.css` tokens, fonts, `theme.ts`, `AppShell` layout skeleton | WP-01 | Must |
| `routes.tsx`, `useIncident`, `ChatPane`, `Composer`, `MessageBubble`, `CheckCard`, `StatusBadge`, `EvidenceChip`, incident header + status chip, `IncidentSidebar` (basic), `ReadOnlyBanner` | WP-10 | Must |
| `DemoPanel` | WP-11 | Must |
| `ApprovalCard`, Resolve button | WP-12 | Must |
| `BudgetBanner`, 429 toast | WP-17 | Should, above cut |
| `WatchlistPanel` | WP-18 | Should, above cut |
| `useIncidents` polling + unread dot, `useNotifications`, `WebhookSettings` | WP-19 | Should, above cut |
| `CtaButton`, `StatusPill` + `lib/status.ts`, `NotificationToggle`, header logo, right column Demo + Watchlist, dot grid | WP-27 | User request |
| `PostmortemDialog`, Postmortem button | WP-22 | Below cut |
| `VoiceButton`, `useRecorder` | WP-23 | Below cut |

**UI rules that apply to every WP above (TDD §12.4):**
- Use Kumo components first (`Sidebar`, `Button`, `Badge`, `LayerCard`, `Surface`, `Collapsible`, `Code`, `Loader`, `Banner`, `Toast`, `Dialog`, `ClipboardText`, `Input`, `SensitiveInput`, `Select`/`Radio`, `Table`, `Tooltip`, `Empty`).
- Never use Tailwind `dark:` variants. Theming goes through `light-dark()` and `data-mode`.
- Orange is only for primary CTAs (Send, Approve) and highlight rings. Everything else uses Kumo's neutral variants.
- Headings use `font-display` at weight 500. Hostnames, evidence IDs and raw evidence use `font-mono`.
- Every control works from the keyboard, and status is never shown by colour alone.

---

## WP checklists

### Day 1

<details>
<summary><b>WP-01</b> Scaffold</summary>

- [x] `git init`, pnpm, single package
- [x] Vite + `@cloudflare/vite-plugin` with `auxiliaryWorkers` (demo-service)
- [x] TypeScript, ESLint, Vitest (`@cloudflare/vitest-plugin`: `unit`, `integration`, `demo` projects)
- [x] `wrangler.jsonc` (main) + `demo-service/wrangler.jsonc`
- [x] Kumo (exact pin), Tailwind v4, fonts, tokens in `styles.css`
- [x] Run `npx @cloudflare/kumo ls` and read `node_modules/@cloudflare/kumo/ai/USAGE.md` for exact props
- [x] `theme.ts` (`data-mode` from `prefers-color-scheme`, listens for changes)
- [x] `AppShell` skeleton: header (wordmark "Incident Copilot", GitHub link), left sidebar, main area, right column that collapses below `lg`, footer "Built on Cloudflare" (no Cloudflare logo)
- [x] **Done when:** `pnpm dev` serves the shell in light and dark; `typecheck`, `lint`, `test` pass
</details>

<details>
<summary><b>WP-02</b> Spike</summary>

- [x] gpt-oss-120b request/response + tool-call shape (chat completions; `arguments` is a JSON string)
- [x] glm-4.7-flash request/response + tool-call shape (same; thinking must be off)
- [x] Streaming through the AI Gateway binding (works; SSE `chat.completion.chunk`)
- [x] `waitForApproval` timeout behaviour (throws a catchable plain `Error`; run continues)
- [x] Do DO RPC and D1 calls count as subrequests? (docs only, unclear; keep the conservative 45)
- [x] glm neuron rates (5,500 / 36,400 per M; responses also report `usage.neurons`)
- [x] Record fixtures in `test/fixtures/` for `mock.ts`
- [x] **Done when:** notes added to TDD §7.4 and §5.2, fixtures committed
</details>

<details>
<summary><b>WP-03</b> D1 and workspace</summary>

- [x] `migrations/0001_init.sql` (D1 `incident-copilot` created, APAC; applied locally, remote at WP-13)
- [x] `__Host-ws` cookie middleware (skips `/api/health`; trusts a well-formed cookie without a D1 read)
- [x] Hono router, `/api/session`, `/api/health` (`version` from `CF_VERSION_METADATA`)
- [x] `safety/target.ts` (URL → hostname → "demo" → `need_target`)
- [x] `target.test.ts` (25 cases) + `session.test.ts`
- [x] **Done when:** cookie is set, session returns `demoUrl`, target tests pass
</details>

<details>
<summary><b>WP-04</b> Safety core</summary>

- [x] `ssrf.ts` + `iprange.ts` (all blocked v4/v6 ranges, plus ::/96, 100::/64 and 6to4; fails closed)
- [x] `reader.ts` (16 KB cap, 10 s abort, manual redirects, `followHops` re-guards every hop)
- [x] `origin.ts` (`assertInScope`)
- [x] Budget / subrequest counter (`loop/budget.ts`: `SubrequestBudget` reserve/settle + `countingFetch`)
- [x] Dev-only `SSRF_DEV_ALLOW_ORIGIN`: an exact origin match skips the guard; unset in prod (TDD §11)
- [x] `ssrf.test.ts` (118 cases, including allow-origin on/off/near-miss), `origin.test.ts`, plus `reader.test.ts`, `budget.test.ts`
- [x] **Done when:** SSRF and origin unit tables pass
</details>

<details>
<summary><b>WP-05</b> Tools</summary>

- [x] `dns_lookup` (two DoH resolvers, mismatch flag = real disagreement only, `addressesDiffer` informational)
- [x] `http_probe` (3 samples, hops, headers, snippet, asset sub-probe; cap 20)
- [x] `quickCheck` (cap 10)
- [x] Registry, evidence IDs, digests (≤ 1.5 KB), `llmTools()`, `runTool` (zod → origin pin → capped run)
- [x] `dns.test.ts`, `http.test.ts` (+ `quickcheck.test.ts`, `registry.test.ts`)
- [x] **Done when:** parser tests pass and real-host probes work from `wrangler dev` (cloudflare.com, github.com, google.com DNS, 169.254.169.254 refused)
</details>

<details>
<summary><b>WP-06</b> Rules</summary>

- [x] `classify.ts` (11 rules, first match wins) + `categories.ts` (types, `Findings`, one-line definitions)
- [x] `template.ts` (four sections with evidence IDs)
- [x] `classify.test.ts` (one fixture per category + precedence + edges, 39 cases) + `template.test.ts`
- [x] **Done when:** classification tests pass for every category
</details>

<details>
<summary><b>WP-07</b> LLM layer</summary>

- [x] `client.ts` adapter + `models.ts` mappers
- [x] Primary → fallback model on error/429 (plus timeout and empty answers; 2001/allocation skip it)
- [x] `usage.ts` neuron accounting (`llm_usage`, `today()` ready for WP-17)
- [x] `prompts.ts` (planning + narration)
- [x] `submit_findings` tool + zod (`loop/findings.ts`; `llmTools({finishOnly})` for the last turn)
- [x] `mock.ts` scripted turns (reads the evidence; `#llm-down` / `#llm-invalid` triggers)
- [x] `citations.ts` post-check + `citations.test.ts` (+ `【id】`, `isWellFormedNarration`)
- [x] `stream.ts`
- [x] **Done when:** mock and live calls return normalized `LlmResult`; citation tests pass
</details>

<details>
<summary><b>WP-08</b> IncidentAgent</summary>

- [x] SQL schema (+ `checks.turn/seq` for retry-safe evidence IDs)
- [x] Synced `IncidentState` (rebuilt from SQL; client writes rejected)
- [x] `onConnect` roles (owner / viewer; viewers also readonly)
- [x] RPC methods + owner-only callables (approval/watch/postmortem methods in WP-12/18/22)
- [x] `transitions.ts` (+ `transitions.test.ts`)
- [x] `narrate` (streams, idempotent per `runId`); a cut-off stream keeps its partial text if well formed (TDD §8.2 "Limits keep progress")
- [x] D1 index sync
- [x] `/api/incidents` (create, list, snapshot, read)
- [x] **Done when:** agent integration tests for init, roles, narration pass
</details>

<details>
<summary><b>WP-09</b> DiagnosisWorkflow</summary>

- [x] Planning loop (≤ 3 turns, ≤ 6 tools, 60 s, 45 subrequests)
- [x] Invalid-call rule (1st → feedback, 2nd → rule path)
- [x] Rule path (`LlmUnavailable` / budget mode)
- [x] **Limits keep progress** (TDD §8.2): every limit ends in findings from the evidence so far (`salvageFindings` + `classify`), last turn `finishOnly`, `runs.status` records which limit hit; a test per limit (`plan.test.ts`)
- [x] Findings step + narrate step + `finishRun`
- [x] `diagnosis.test.ts` (real Workflow, offline via fake internet)
- [x] **Done when:** diagnosis integration tests pass with the mock LLM
</details>

<details>
<summary><b>WP-10</b> Chat UI</summary>

- [x] `routes.tsx` (`/`, `/i/:id`)
- [x] `useIncident`: wraps `useAgent`, merges `delta` broadcasts into a buffer keyed by `messageId`, exposes callables
- [x] `ChatPane`: messages, check cards inline in run order, empty state (`Empty`) with "Use demo service" and "diagnose cloudflare.com" chips
- [x] `Composer`: Enter sends, Shift+Enter adds a new line, disabled while `activeRunId` is set, handles 400 `need_target` and 409
- [x] `MessageBubble`: streaming buffer replaced by the final stored text; stream region has `aria-live="polite"`
- [x] `CheckCard`: tool icon, label, summary, evidence disclosure in `CodeBlock` (lazy `getEvidence`)
- [x] `StatusBadge`: icon **and** text for Pending, Running (`Loader`), Pass, Fail, Error, Unavailable
- [x] `EvidenceChip`: clicking `[http-1]` scrolls to its card and flashes the orange ring
- [x] Incident header: target in mono and a status chip that always has text
- [x] "New incident for X" button when a follow-up names a host outside the origin pin (§8.6)
- [x] `IncidentSidebar`: "New incident" button and a basic list with status badges
- [x] `ReadOnlyBanner` for viewer connections (+ "View only" badge in the header)
- [x] Keyboard pass: every control reachable, nothing shown by colour alone
- [x] **Done when:** full chat works end to end in the browser with `LLM_MODE=mock`
</details>

<details>
<summary><b>WP-11</b> Demo service</summary>

- [x] Modes: healthy, slow, errors, redirect_loop, bad_cache
- [x] `DemoState` DO
- [x] `DemoAdmin` RPC entrypoint
- [x] `/api/demo` + `/api/demo/mode`
- [x] Local demo URL: `.dev.vars` sets `DEMO_BASE_URL` to the local demo origin and `SSRF_DEV_ALLOW_ORIGIN` to the same origin
- [x] `DemoPanel` (right column): mode picker (`Select`/`Radio`) and the demo URL (`ClipboardText`)
- [x] `demo.test.ts`
- [x] **Done when:** each mode behaves as in TDD §7.5; demo test passes
</details>

<details>
<summary><b>WP-12</b> Act</summary>

- [x] Action catalog + proposable checks
- [x] Propose / supersede / dedupe
- [x] `waitForApproval`, approve/reject callables
- [x] Execute + verify + `afterAction`
- [x] Monitor ticks (15 s × 10, 3 passes → resolved)
- [x] `ApprovalCard`: action title, why it's proposed (cause + refs), real `<button>`s for Approve (orange) and Reject; shows approved, rejected, expired or superseded; buttons hidden for viewers
- [x] Resolve button in the incident header
- [x] `approval.test.ts`
- [x] **Done when:** approval test passes; local walkthrough break → approve → resolved works
</details>

<details>
<summary><b>WP-13</b> Deploy 1</summary>

- [x] `wrangler deploy` both Workers
- [x] Live PRD §13 steps 1–5
- [x] SSRF refusals: `169.254.169.254`, `localhost`, `10.0.0.1`
- [x] CPU time check in Workers Logs
- [x] **Done when:** live URL passes the walkthrough (**don't share it yet**)
</details>

### Day 2

<details>
<summary><b>WP-14</b> Tests</summary>

- [x] Fill unit coverage gaps (`schema`, `cookie`, web `approval`)
- [x] Fill integration gaps (`transitions` already complete; `cron.test.ts` stubs for WP-18)
- [x] **Done when:** `pnpm test` is green and the approval path is covered
</details>

<details>
<summary><b>WP-15</b> CI/CD</summary>

- [x] `ci.yml` (typecheck, lint, test, terraform fmt/validate), alongside the existing Sift workflows; PR trigger on `main` (Terraform steps only once `infra/` has `.tf` files)
- [x] `deploy.yml` (migrations, build, deploy demo then main, smoke)
- [x] Smoke script (`?smoke=rule` option): `scripts/smoke.ts`, `pnpm smoke <url>`
- [x] GitHub secrets (**user**: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`)
- [x] **Done when:** a PR runs green; merging deploys and passes smoke (PR #4, deploy run 38772159673)
</details>

<details>
<summary><b>WP-16</b> README and PROMPTS</summary>

- [x] Architecture + Agents SDK explanation (mermaid diagram, request flow, loop limits)
- [x] Security section with accepted risks (D2, D7, single location, DNS rebinding)
- [x] Terraform / wrangler split
- [x] "Designed, not built" list (WP-17 to WP-26 for now; items leave it as they land)
- [x] `PROMPTS.md` (curated overview by phase on top of the running log) + `prompts/` transcripts, secrets removed (sweep clean)
- [x] **Done when:** docs complete, no secrets
</details>

<details>
<summary><b>WP-17</b> Limits and budget guard</summary>

- [x] `PROBE_LIMIT`, `RUN_LIMIT`, `VOICE_LIMIT` bindings (`VOICE_LIMIT` unused until WP-23)
- [x] `quota.ts` (D1 fixed window): `takeRun`, `takeWindow`, `probeLimiter` (own demo exempt)
- [x] `usage.ts` wired to the guard (≥ 9000 → rule_based), applied in `startRun`
- [x] `BudgetBanner` in the header, driven by `budgetMode` from `/api/session` (refetched when incidents change)
- [x] 429 UX: `Toast` showing the time until reset (plus the same text inline for screen readers)
- [x] **Done when:** 4 runs in a minute → 429; forced neuron total → rule-based banner (tests + local check; live after the next deploy)
</details>

<details>
<summary><b>WP-18</b> Watch</summary>

- [x] Watch API + caps (3 per workspace, 30 global; one per URL; demo every 60 s, others 5–60 min)
- [x] `WatchlistPanel` (sidebar): add URL, "Watch my demo", list with last status, delete, cap errors shown; polls every 15 s
- [x] `add_to_watchlist` action (rule card for broken real sites, linked to the incident)
- [x] `scheduled()` (LIMIT 6, subrequest counter)
- [x] `WatchWorkflow` (2 of 3 confirm, claim before init)
- [x] `reportWatchCheck`
- [x] `cron.test.ts` (+ `watch-workflow`, `watches-api`, `watch-agent` tests)
- [x] **Done when:** breaking a watched demo opens an incident in about 2 min; restoring resolves it (tests + a local run on a real 500 site: incident 34 s after the cron check, resolved after 3 passes; the demo itself on the live site after the next deploy)
</details>

<details>
<summary><b>WP-19</b> Notifications</summary>

- [x] `useIncidents`: polls `GET /api/incidents` every 10 s while the tab is visible (and on return to the tab)
- [x] Unread dot, "New" and a count badge in `IncidentSidebar`; `markRead` when an incident is opened and on new activity while visible
- [x] `useNotifications`: browser notification on a new unread row (permission requested from a button click)
- [x] Webhook API (+ `POST /api/webhook/test`, 5 an hour)
- [x] `NotificationSettings` (the TDD's `WebhookSettings`, sidebar): `SensitiveInput`, masked hint, send test, remove
- [x] `crypto.ts` (AES-GCM) + `webhook.test.ts`
- [x] `NotifyWorkflow` (opened waits for the diagnosis; mitigated/resolved for any watched incident)
- [x] **Done when:** a test Discord webhook fires exactly once per state change (integration test with a recorded fake Discord: 3 events → 3 messages, repeats ignored; a real Discord check needs the production `WEBHOOK_KEY`, which the user sets)
</details>

<details>
<summary><b>WP-20</b> Eval</summary>

- [x] `eval/run.ts` + `cases.ts` (+ `eval-score.test.ts`)
- [x] One live run (642 neurons, not 3k: about 130 per case since WP-13b)
- [x] Commit `eval/results.md`
- [x] **Done when:** at least 4 of 5 cases pass (5/5, local `pnpm dev` with the live model)
</details>

<details>
<summary><b>WP-21</b> cert_info and provider_status</summary>

- [x] `cert.ts` (crt.sh, Cache API, `unavailable` on error; host + `*.parent` queries)
- [x] `provider.ts` (Statuspage + AWS best effort; only major/critical incidents count)
- [x] Add both to the rule path (and after the baseline, "only when useful": `loop/extras.ts`)
- [x] **Done when:** both cards render; crt.sh failure shows `unavailable` (integration tests with a fake crt.sh; real crt.sh in the local browser)
</details>

<details>
<summary><b>WP-22</b> Postmortem</summary>

- [x] `generatePostmortem` (streamed + rule-based template; facts by code, story by AI)
- [x] `PostmortemDialog` (`Dialog` with copy)
- [x] Postmortem button in the incident header, enabled when `resolved`
- [x] `generate_postmortem` action
- [x] **Done when:** walkthrough step 6 produces stored, copyable markdown (local browser, mock LLM)
</details>

<details>
<summary><b>WP-23</b> Voice</summary>

- [x] `useRecorder` + `VoiceButton`
- [x] `/api/voice` (size cap, limit, whisper)
- [x] Normalization (" dot ", " slash ", hostname lowercasing)
- [x] **Done when:** "is demo dot example dot com down" fills the input and isn't sent (headless Chrome, fake mic, mock Whisper; a live Whisper call wasn't made)
</details>

<details>
<summary><b>WP-24</b> recheck_burst</summary>

- [x] Monitor kind `burst` (60 s × 15)
- [x] **Done when:** timeline shows ticks once a minute (local, real 404 page: 60.3 / 60.0 / 60.1 s apart)
</details>

<details>
<summary><b>WP-25</b> Terraform</summary>

- [x] `infra/` with D1 + AI Gateway (provider ≥ 5.19 supports it), both imported, `prevent_destroy`
- [ ] One local `apply` (**user**, steps in the README)
- [ ] **Done when:** `terraform validate` passes in CI (next PR; passes locally) and apply has run once
</details>

<details>
<summary><b>WP-26</b> Demo GIF</summary>

- [ ] Record the 60-second walkthrough
- [ ] Add it to the README
</details>

---

## Decisions and deviations log

Newest first. Record spike findings, anything moved or cut, and estimate overruns over 30 min.

| Date / time | WP | Change | Why |
|---|---|---|---|
| 2026-10-16 17:39 | 26→21 | **Fix found while recording the demo (live, real AI):** on a healthy `diagnose cloudflare.com`, the model called `provider_status` for Cloudflare and AWS itself, and the card came back red **Fail** because AWS's feed lists two Middle East regional events open since March, and every AWS event counted as an outage. The extra AI turn also made the run take 82 s. Fixed: AWS events older than 24 h are listed as "ongoing" and don't count; the tool description says to call it only when the site is failing. That take wasn't used; the GIF is recorded after this fix is deployed. **Folded into TDD §7.3.** | Seen in the first recording take |
| 2026-10-16 17:33 | 25 | **Terraform as built.** (1) The provider manages AI Gateway since v5.19 (`cloudflare_ai_gateway`), so PRD R1 is settled: both D1 and the gateway are in `infra/`. (2) Both already exist, so they're **imported** (`import` blocks, `<account_id>/<id>`) and protected with `prevent_destroy`; the gateway's settings match the dashboard's so the plan should show only imports. (3) The token comes from `CLOUDFLARE_API_TOKEN` and the account ID from a gitignored `terraform.tfvars` (the account ID stays out of the repo, as for the transcripts). (4) **The user runs plan/apply** (user decision); a Terraform binary in the session scratchpad ran `fmt -check` and `validate` (1.16.6, provider 5.28.0). **Folded into TDD §15 and the README.** | User decision in the WP-24 to WP-26 plan |
| 2026-10-16 17:31 | 24 | **recheck_burst as built.** (1) **Rule action for inconclusive results** (user decision): an inconclusive real site gets "Re-check every minute for 15 minutes" ahead of the watch; the model can name it for any failure; the demo keeps its restore. (2) Only one monitor at a time: a running monitor blocks the burst card (the watch is offered instead), and a later restore replaces a burst. (3) Run by the agent like the postmortem; a retried step keeps the running burst. (4) The header says "Re-checking every minute: n of 3 …" for a burst. **Local check (mock AI, real network):** `github.com/this-page-does-not-exist-xyz` (404) → inconclusive → burst card → Approve → ticks 60.3, 60.0, 60.1 s apart, no console errors. **Folded into TDD §7.6, §8.4, §12.2, §14.** | User decision in the WP-24 to WP-26 plan |
| 2026-10-16 16:44 | 23 | **Voice as built.** (1) **Click to start, click to stop** (user decision), auto-stop at 30 s, mic released on stop. (2) Any `audio/*` type is accepted, since Safari records `audio/mp4` (Chrome and Firefox WebM/Opus). (3) The voice quota is **per workspace and per visitor IP** (5 a minute, 20 an hour), like the run quota, so dropping the cookie doesn't skip it. (4) Voice is off while the budget guard is on (503, before any quota is used). (5) Normalisation keeps the sentence's own words and case; only spoken "dot"/"slash" and hostnames change. (6) A second take is appended to what's in the box. **Local check (headless Chrome, fake mic, mock Whisper):** clock "0:01 / 0:30" while recording, the box reads "is demo.example.com down", focus moves there, the only request is `POST /api/voice` (nothing sent, still on the New incident page); light, dark and 390 px, no sideways scroll, no console errors. **Not done:** a live Whisper call (it costs neurons; can be run with the user's OK). **Folded into TDD §7.1, §8.7, §12.2, §14 and the README.** | User decision in the WP-21 to WP-23 plan |
| 2026-10-16 16:38 | 22 | **Postmortem as built.** (1) **Facts by code, story by AI** (user decision): impact window, detection and a UTC timeline come from the full timeline table; the AI writes Summary, Root cause, Resolution, Follow-ups as `##` sections, any missing one comes from the template, and the root cause always cites its evidence. (2) A stored postmortem is free; a new AI one is charged to the run quota (D14); the budget guard gives the template, free. (3) `generate_postmortem` is the one card a resolved incident can get, when the model names it on a follow-up and none is stored; no status change. (4) Category display names moved to `categories.ts` (`CATEGORY_LABEL`), shared by the UI pill and the postmortem. (5) Viewers can read a stored postmortem (`getPostmortem`) but not write one. **Local walkthrough (mock LLM):** break → Approve → resolved 30 s later → Postmortem → markdown shown, copied (clipboard matched), still there after a reload; dark at 390 px, no sideways scroll, no console errors; Escape closes it. Found and fixed during the check: a site healthy at its first check was described as "recovered after 3 checks". **Folded into TDD §7.2, §7.6, §8.7, §12.2, §14 and the README walkthrough (step 6).** | User decision in the WP-21 to WP-23 plan |
| 2026-10-16 16:29 | 21 | **cert_info + provider_status as built.** (1) **Spike:** an exact-host crt.sh query misses wildcard certificates, so `cert_info` also asks for `*.parent` (2 fetches; the TDD said 1). crt.sh took 2–12 s and timed out at 30 s for cloudflare.com. `expired.badssl.com` is covered by a **valid** `*.badssl.com` wildcard in the CT logs, so CT can't catch that kind of expiry; the card says "valid until …" and the diagnosis stays inconclusive (honest, best effort). AWS's health feed is 231 KB of UTF-16: read up to 128 KB, events picked out leniently. (2) **"Only when useful"** (user decision): `cert_info` runs after the baseline when HTTPS fails to connect, `provider_status` when a site fingerprinted to Cloudflare/GitHub/AWS is failing; never on the user's own demo. (3) **Only major/critical Statuspage incidents count as an outage:** Cloudflare had a minor dashboard incident open during the spike, and the demo answers `server: cloudflare`, so every broken demo would otherwise have read as a Cloudflare outage. (4) Rule 2: an expired CT certificate counts only when HTTP isn't healthy; HTTPS refusing every connection with no unexpired certificate covering the host → `tls_expiry` medium. (5) The mock model reads cert and status cards. Local check (real network, mock LLM): `expired.badssl.com` → DNS pass, HTTP connection failed, Certificate card in about 1 s; a repeat lookup came from the Cache API in 0.0 s; light, dark, 390 px, no console errors. Known limit: AWS events aren't filtered by region. **Folded into TDD §5.2, §7.3, §8.2, §9.3, §14 and the README.** | User decisions in the WP-21 to WP-23 plan; spike findings |
| 2026-10-16 03:29 | 27c | **Scroll + loader (user bugs).** Cause found in code: `ChatPane` used `scrollIntoView`, which scrolls every ancestor (Kumo's `overflow-hidden` wrappers, the page), not just `<main>`. Not reproduced headless, so fixed structurally: scroll `<main>` directly and only while pinned to the bottom (user decision), lock `html, body`, `overscroll-contain` on `<main>`. One `DashedLoader` replaces Kumo's spinner, including inside buttons; the chat names its step while a run is active (user decision). **Folded into TDD §12.2, §12.3, §12.4.** | User saw the page scroll past the footer while text streamed |
| 2026-10-16 02:43 | 27b | **UI follow-ups as built (user decisions).** Demo "Now:" and the diagnosis are status pills (healthy green, problems red, slow yellow, inconclusive grey); one heading style on both sidebars (UPPERCASE 13 px); footer "Built on Cloudflare, with ♥ from Sahil" (not "built by", so it doesn't read as an official Cloudflare app). Found and fixed: Kumo's `Tooltip` without `render` wraps its trigger in a `<button>`, so the blocked notifications switch (WP-27) was a button inside a button. **Folded into TDD §12.1, §12.2.** | User review of WP-27 |
| 2026-10-16 02:28 | 27 | **UI polish as built (user decisions).** (1) **Header uses the Cloudflare cloud** (Kumo `CloudflareLogo` glyph) + "× Incident Copilot"; the footer stays. Overrides TDD §12.1 "no Cloudflare logo". (2) **Orange widened** beyond CTAs: in-progress statuses, unread markers, the notifications switch. One colour map for all statuses (`web/lib/status.ts`): investigating orange, awaiting approval purple, mitigated grey, resolved green; pending approval cards now have a purple border. (3) **Browser notifications are a header switch** with an app-level on/off in `localStorage`, because a site can't revoke a granted permission; people who allowed them before stay on. (4) Watchlist moved to the right column under the demo panel; the webhook stays in the left sidebar (`NotificationSettings` renamed `WebhookSettings`, the TDD's name). (5) Kumo's `Switch` hard-codes blue, so `styles.css` overrides it. **Folded into TDD §12.1, §12.2, §12.3, §12.4.** | User asked for a cleaner Cloudflare look and one status colour language |
| 2026-10-16 01:34 | 20 | **Eval as built.** (1) The live run was **local `pnpm dev` with `LLM_MODE=live`** (user decision): tests WP-17 to WP-19 without a deploy. (2) **`run_finished` records `source` (`model` / `model+rules` / `rules`) and `fallbackTurns`** (user decision), so results say who got it right; no schema change. (3) A `rule_based` run fails whatever it found. (4) ③ needs an approval card for broken modes; for healthy, no card and no restore in the findings. (5) A 429 waits `retryAfter`. **Result:** 5/5, 642 neurons; `redirect_loop` was `model+rules` (an invalid `submit_findings`; the reason isn't stored, so it's unknown from this run). Check ③ is mostly guaranteed by `pickAction` (WP-12). The old 5173 dev server was stopped by the user first. **Folded into TDD §16 and the README.** | The eval should measure the AI, not the rules behind it |
| 2026-10-15 23:56 | 19 | **Notifications as built.** (1) The "opened" webhook waits for the first diagnosis (up to 9 × 10 s) so it names the likely cause (user decision). (2) Mitigated/resolved webhooks for **any incident with a watch attached**, including chat incidents with an approved "Add to watchlist" (user decision, widens D18). (3) Migration `0002` adds `webhooks.app_origin`, recorded on save, for incident links without committing the URL (D2). (4) `POST /api/webhook/test` (5 an hour) so a user can check the URL. (5) `WEBHOOK_KEY` isn't declared in wrangler: without it webhooks are off and the UI says so; the **user sets it in production** (user decision). (6) Automatic status changes set unread; `IncidentView` marks read on open and on new activity while visible. (7) `GET /api/webhook` returns `{available, webhook}`. **Local check (5181; the old 5173 server is still broken):** an auto-opened watch incident showed "New" + "1 new" 40 s after the cron check, raised exactly one browser notification (stubbed Notification API), and cleared on open; light, dark and 390 px screenshots. The local `.dev.vars` key wasn't added (the safety check gave no verdict on writing a secret), so the save/test UI wasn't run locally; the integration tests cover it. **Folded into TDD §5.1, §6.1, §7.1, §11, §12.3, §14 and the README.** | The PRD wants the diagnosis ready when the user is notified. A user who asked to watch an incident wants to hear when it recovers |
| 2026-10-15 23:13 | 18 | **Watch as built.** (1) **Own demo checked every 60 s** (user decision), real sites 5–60 min. (2) **`add_to_watchlist` is a rule card for broken real sites** (user decision): approving links the new watch to the incident, so passes resolve it; no verify check, the card says "Approved and done"; `restore_demo_service` always wins when it fits. (3) WatchWorkflow confirms on the first failed re-check (saves 30 s) and claims the watch before `init`, so one failure opens one incident. (4) While the post-action monitor runs, it decides; watch checks are only recorded. (5) `WatchlistPanel` polls every 15 s and refreshes the incident list when a watch opens an incident (stands in until WP-19's polling). (6) `WatchView` lives in `worker/watch/types.ts` so the web build can import it. (7) Diagnosis tests expire approval cards at once, since a broken real site now gets a card. **Local check:** the 5173 dev server was broken ("fetch failed" on every request; started 21:28, before this session) and wasn't touched, so the demo walkthrough wasn't run locally. On 5181 with a real 500 site: the incident opened 34 s after the cron check, then mitigated → resolved after 3 passes, and the watch was released; in the browser, the panel and the incident list showed it within 45 s with no reload. **Folded into TDD §5.2, §7.1, §7.2, §7.6, §8.4, §8.5, §14 and the README.** | The done-when needs the demo in about 2 min, and the PRD's 5-minute minimum would take up to 6. Rule card: the model rarely proposes watching on its own |
| 2026-10-15 22:49 | 17b | **Fixed both WP-17 findings (user: "fix the older problems").** (1) The app makes one `firstSession()` call per page load and renders the sidebar, demo panel and routes after it, so a first visit creates one workspace (was up to 6 in dev). (2) Per-IP run limit next to the workspace one: 6 a minute (new binding `RUN_IP_LIMIT`, namespace 1004) and 20 an hour (D1, key `ip:<SHA-256 prefix>`); the agent keeps the key from `onConnect` for follow-ups. The 429 text no longer names numbers, since either limit can trip. **Folded into TDD §5.1, §11, §14 and the README.** | Per-IP limits are looser than per workspace so a shared network (an office, a reviewer team) isn't blocked. An unsalted hash of an IPv4 address can be brute-forced, but it stays in our own D1 and isn't shown anywhere |
| 2026-10-15 22:39 | 17 | **Limits as built.** (1) **Own demo exempt from `PROBE_LIMIT`** (user decision); the dev allow-origin too. (2) Run quota in `POST /api/incidents` after target parsing, and in `sendMessage` after the `run_active` check, so neither a target-less message nor a send during a run is charged; the agent throws `rate_limited:<s>`. (3) A burst refusal says 60 s (the binding doesn't report its reset); the D1 hour gives exact seconds. (4) Guard in `startRun`, before the synchronous check-and-insert. (5) Everything fails open (logged). (6) `quickCheck` isn't probe-limited (demo only, after an approved action). (7) Integration tests raise `PROBE_LIMIT` to 10,000 in the miniflare options. Locally verified: 4th run in a minute → 429 `retryAfter: 60` (5 of 5 with curl, 8 of 8 in the browser); forced 9,000 → banner and a 0-LLM run; screenshots in light, dark and at 390 px. **Folded into TDD §7.1, §8.1, §11, §14.** | Every workspace's demo shares one hostname, so a per-host limit would make users block each other. **Found while checking (older than WP-17; fixed in WP-17b):** (a) a first visit mints a workspace per parallel API call (`/api/session`, `/api/incidents`, `/api/demo`; ×2 under StrictMode in dev) and the last `Set-Cookie` wins, so early browser checks that sent before the page settled spread runs over several workspaces and never hit 429; the DemoPanel can also show a demo URL for a workspace that isn't the final cookie. (b) The run quota is per workspace, so a client that drops the cookie gets a new workspace each time; the global caps are the neuron guard (cost) and the per-host probe limit |
| 2026-10-15 21:31 | 15 | **CI/CD as built.** `POST /api/incidents?smoke=rule` starts a `rule_based` run (`InitParams.mode` → `runs.mode` → `getRunContext`), so the deploy smoke test uses no LLM and no neurons; the public flag can only make a run cheaper. `scripts/smoke.ts` is run by Node 22 directly (no `tsx`). `ci.yml` is reused by `deploy.yml`; the Terraform steps are gated on `infra/*.tf` (WP-25 is below the cut). The smoke URL comes from wrangler's `deployment-url` (fallback: an `APP_URL` repo variable), so no URL is committed (D2). **Folded into TDD §14, §15.** | TDD §15 offered live LLM or `?smoke=rule`; rule mode is free and deterministic. The CI and deploy checks need the user's secrets and PR |
| 2026-10-15 19:44 | 13b | **Live speed fixes (user chose "fix now").** (1) A new incident's baseline checks (DNS for the host, HTTP for the target) run before the first AI turn (`pending-baseline`), and the rule path reuses the same helper. (2) `propose` moved before `narrate`, so the card shows while the narration streams. (3) `fillEmptyCause` puts the findings' cited cause back when the citation check empties "Likely cause:". Redeployed and re-timed live: first check card 22 s → 7.5 s; demo card 35 s → 9.6 s; both runs `done` in 1 AI turn; the cause is filled. 279 neurons for 2 runs. **Folded into TDD §8.2, §9.2.** | WP-13 live walkthrough: about 100 s against the 60 s target, with every run hitting the turn cap |
| 2026-10-15 19:15 | 13 | **First deploy.** D1 migrated remotely; the demo Worker went first, then `DEMO_BASE_URL` was set, then the main Worker (TDD §15). On the live site, PRD §13 steps 1–5 pass: workspace → cloudflare.com healthy (`dns-1`/`http-1` pass, resolved) → 500 errors → `origin_5xx` citing `[http-1]` with the card → Approve → verified → resolved (30 s). `169.254.169.254`, `localhost` and `10.0.0.1` were refused by the SSRF guard with clear messages, and no fetch was made. CPU: no event was cut off; details in TDD §15. 907 neurons for 5 runs. **Issues found:** (1) **slow** — the card came about 35 s after asking (≈ 5 s Workflow queue, 3 AI turns of 3–10 s, 13 s narration), so the full walkthrough is about 100 s against the PRD's 60 s; (2) the live model asks for **one check per turn**, so every run ends `limit_turns` and the UI shows a turn-limit note; (3) the live narration once left **"Likely cause:" empty** after the citation check removed an uncited sentence. | Found during the WP-13 live walkthrough |
| 2026-10-15 19:00 | 12 | **Live AI check (one 500-errors run, local, `LLM_MODE=live`).** The model proposed `restore_demo_service` **itself** (the demo hint works; the rule merge wasn't needed). Card at 23.5 s → Approve → verified → resolved at 53 s. Cost 199 neurons (estimate was about 100); the daily local total is 2,855. The run ended `limit_turns` with 3 turns and 1 check: most likely the model's `dns_lookup` of `localhost` was refused (it isn't a public hostname), which cost an extra turn. That's local only; recheck on the deployed `workers.dev` demo in WP-13. | User asked for the live check after WP-12 |
| 2026-10-15 18:58 | 12 | **Flaky `approval.test.ts` fixed.** It was a race in the test, not a timeout. The Workflow proposes the card one step before `finish`, so a poll could see the card while the run was still active, and the test's `activeRunId: null` check failed. The dedupe test could also have hit `run_active`. The tests now wait for "card shown and run finished" (`cardShown`), and the 20 s wait went back to 8 s. | Caught in 1 of 5 full runs (`approval.test.ts:51`). Polling every 1 ms reproduced it in 4 of 5 runs; with the fix, 8 of 8 passed |
| 2026-10-15 18:01 | 12 | **Act as built.** (1) **Rule merge** (user decision): `pickAction` adds `restore_demo_service` to the model's actions for any non-healthy category, and the planning prompt says when the target is the user's demo, so a broken demo always gets the card. (2) **Verify and monitor quick checks run inside the agent** (`afterAction`, `monitorTick`), not in the Workflow, so they don't use its 45-subrequest budget; `tailReserve` 4 → 8 for propose, outcome, action and verify. (3) The run finishes before the approval wait (D13), and the tail runs outside the main `try`. (4) Decisions are recorded in the agent first, then the Workflow is told; `expired` overrides an `approved` card that never ran; resolving by hand closes pending cards and stops the monitor. (5) The card says "verified" only after the re-check (`outcome.verified`). **Folded into TDD §6.3, §7.2, §7.6, §8.2–§8.4, §12.2, §14.** | WP-11's live runs showed the model leaving the action out. The browser walkthrough found the card saying "verified" before the re-check ran; fixed. Local walkthrough with the mock LLM: errors, slow, redirect_loop, bad_cache and slow + errors all went break → card → Approve → mitigated → resolved in 32–45 s; reject → investigating; a viewer sees no buttons |
| 2026-10-15 17:30 | 11 | **Combined demo modes** (user request): the demo holds a set of modes, either `["healthy"]` or one main problem (errors, redirect_loop, bad_cache) plus an optional `slow`. The RPC is now `getModes`/`setModes` and the API takes `{modes}` (400 `invalid_modes`). `restore_demo_service` will call `setModes(ws, ["healthy"])`. The panel is a "Problem" radio group plus an "Also slow" checkbox. The diagnosis still names one category; slow + bad_cache comes out as `high_latency` because latency is checked before caching. **Folded into TDD §7.1, §7.5, §7.6, §8.2, §14.** | The user chose "one problem + slow" and "main problem, slowness as evidence". The other problems clash: a page can't both 500 and redirect, and bad caching is invisible behind either |
| 2026-10-15 17:11 | 11 | **Local demo URL:** under `vite dev` the demo Worker has no port of its own, and a separate `wrangler dev` would keep its own mode state. So the main Worker passes `/w/*` through `env.DEMO.fetch()` only when `DEMO_BASE_URL` is its own origin (local dev), and `.dev.vars` points both `DEMO_BASE_URL` and `SSRF_DEV_ALLOW_ORIGIN` at `http://localhost:5173`. Deployed, `/w/*` on the main Worker is a 404. `DemoAdmin` throws plain `invalid_mode`/`invalid_workspace` (a ZodError loses its message over RPC). Below `lg` the panel is a closed disclosure instead of hidden. **Folded into TDD §4, §5.1, §7.1, §7.5, §12.1, §14.** | Spike: local Workflow probes reach `localhost:5173` despite `global_fetch_strictly_public`. A local run of all five modes gave the right category each time. Note: the local `.dev.vars` had `LLM_MODE=live`, so these 12 runs used the live model; the daily local estimate is 2,656 neurons |
| 2026-10-15 16:34 | 10 | New `whoami()` callable for the read-only UI. Kumo's brand token is set to Cloudflare orange (it's blue by default). The sidebar becomes an off-canvas sheet below 768 px. The evidence disclosure is a plain `aria-expanded` button rather than Kumo `Collapsible`. Vite pre-bundles `agents/react` and `wouter`. Browser checks used `playwright-core` from the session scratchpad with the cached headless Chromium; nothing was added to the repo. **Folded into TDD §12.3.** | Screenshots found three layout bugs (narrow screens, sticky header lost on scroll, banner off-screen for viewers) and a first-load reload; all fixed |
| 2026-10-15 15:22 | 09 | The run is a pure driver (`loop/plan.ts`) behind a thin Workflow, so every limit is unit-tested. A finish turn forced by a cap reports that cap even when the model then submits good findings. Past the deadline there are no more LLM turns (rules + salvage). The rule path fills only the checks this run is missing. `finishRun` closes never-run checks as `unavailable`. Integration tests run offline through an inline fake-internet Worker (`outboundService`). `DIAGNOSIS_AUTOSTART=off` is a test-only seam. **Folded into TDD §8.2, §14.** | Determinism under Workflow replay, the user's "limits keep progress" rule, and offline CI |
| 2026-10-15 14:50 | 08 | Callables are registered with `callable()(fn)` after the class instead of `@callable()` syntax (the decorator only fills a registry), so no Babel transform or ES2021 target is needed. A typed `incidentAgent()` stub wrapper works around `getAgentByName` only typing `unknown`-state agents. Timeline details are flat scalars (recursive JSON broke the RPC stub types). `POST /api/incidents` returns 503 `demo_unavailable` while `DEMO_BASE_URL` has `<sub>`. ESLint allows tagged-template statements (`this.sql`…``). **Folded into TDD §6.2, §6.3, §7.1, §7.2, §14.** | Found while building; the SDK docs require a decorator build step otherwise |
| 2026-10-15 14:30 | 07→08/09 | **Limits keep progress:** a run that hits any limit (turns, tools, deadline, subrequests, `max_tokens`, neurons, LLM down) ends with the best diagnosis from what it already found. LLM layer now: `truncated` flag on cut-off answers, `LlmUnavailable.partial` keeps streamed text, `salvageFindings` keeps the model's valid fields. WP-08/09 rules (durable evidence, `finishOnly` last turn, partial narration, `runs.status` per limit) added to their checklists. **Folded into TDD §8.2.** | User requirement: never drop the context gathered so far |
| 2026-10-15 14:17 | 07 | Live check findings: (1) glm rejects regex look-around in tool schemas (`3030 Grammar error`), so every glm fallback in planning would have failed. LLM tool schemas now drop `pattern` (zod still validates). (2) glm ignores "last turn" in the prompt, so the last turn offers only `submit_findings`. (3) gpt streams citations as `【id】`; the citation check normalizes them. (4) One gpt stream was pure `!!!…`; `isWellFormedNarration()` lets narrate fall back to the template. Also: `LLM_TIMEOUT_MS` 25 s → fallback; 2001/allocation skip the fallback; the mock reads evidence (not the target); `remoteBindings: false` in tests. **Folded into TDD §5.2, §7.4, §7.4.1, §9.2, §14.** | Throwaway `/api/dev/llm` route, about 370 neurons over 7 runs (the plan said about 50; the extra runs chased the glm grammar error and the two streaming issues) |
| 2026-10-15 13:49 | 06 | Rule 2's "TLS error" is matched on the runtime's error text, which `http_probe` samples now keep (`message`, ≤ 200 chars). Locally, workerd hides the reason (`internal error; reference = …` for expired and self-signed certs), so in practice `tls_expiry` needs `cert_info` (WP-21, below the cut). Other rule details: latest usable result per tool, `no_addresses` → `dns_failure`, `actions` from rules. **Folded into TDD §9.3.** | Throwaway check against expired.badssl.com and self-signed.badssl.com from workerd |
| 2026-10-15 13:44 | review | PR #2 (`dev` → `main`, WP-01 to WP-05) merged at 13:40 (`0073839`) after Sift's 5 findings were answered as false alarms | User merged after the review |
| 2026-10-15 01:59 | review | Sift CI workflows prepared for `main` (`61b5aef`, local worktree, unpushed until the user confirms). The zip upload (`6cfd23c`) is a binary in the repo and can be removed once the YAML files are in | Sift reviews PRs through GitHub Actions on the default branch |
| 2026-10-15 01:57 | review | The review target is `main` (the default branch), not `master`. PR #1 `dev` → `main` was closed unmerged. `master` (at `867d8d6`) stays as the first review base but is unused | User raised PR #1 against `main`. Sift runs from `main`'s workflows |
| 2026-10-15 01:50 | review | All work moves to a `dev` branch; changes reach the main line only through a reviewed PR | User wants a Sift code review before work counts as merged |
| 2026-10-15 01:44 | 05 | `dns_lookup.mismatch` means the resolvers disagree on the response code or on whether the name exists. Different address lists are `addressesDiffer` (info only). **Folded into TDD §7.3 and §9.3 rule 9.** | User decision. Geo/CDN DNS (for example google.com) returns different addresses per resolver, and those healthy sites would otherwise be classed `dns_mismatch` |
| 2026-10-15 01:44 | 05 | Hard per-tool caps: `http_probe` 20 and `quickCheck` 10 via `countingFetch`. Samples 2–3 are skipped after a loop, hop cap or refusal. A partial result is used rather than an error. **Folded into TDD §7.3.** | Keeps one probe from eating the 45-call run budget. Live: cloudflare.com used 10 (301 to www), github.com 8 |
| 2026-10-15 01:44 | 05 | Live check used a temporary `/api/dev/probe` route, removed before the commit. Finding: real sites (cloudflare.com, github.com) load assets from other origins, so the asset sub-probe (D10) mostly fires on the demo, as intended | `redirect: "manual"` and DoH work in the Workers runtime as expected |
| 2026-10-15 01:30 | 04 | The SSRF DoH check (A + AAAA) is cached per host for one tool call and counted against the budget. `http_probe` and `quickCheck` cost estimates are raised to match (quickCheck about 8). Extra blocked ranges: ::/96, 100::/64, 6to4. Single-label hosts and credential URLs are refused. **Folded into TDD §7.3 and §11.** | The TDD estimates didn't count the guard's own DNS lookups. The extra ranges close IPv6 ways to reach private IPv4 addresses |
| 2026-10-15 01:23 | 03→04/11 | Local probes reach the demo through a dev-only `SSRF_DEV_ALLOW_ORIGIN` (one exact origin, set only in `.dev.vars`). Production leaves it unset, so private and loopback targets stay blocked. **Folded into TDD §11.** | User decision. Locally the demo has no public URL and the SSRF guard blocks localhost |
| 2026-10-15 01:18 | 03 | Unit tests for Worker code live in `test/unit/` (type-checked with `tsconfig.worker.json`); browser unit tests live in `test/unit/web/` (`tsconfig.web.json`) | The Worker and DOM type libraries can't share one project |
| 2026-10-15 01:18 | 03 | `budgetMode` returns `"ai"` until WP-17; `DEMO_BASE_URL` keeps `<sub>` until WP-13 | Guard and workers.dev subdomain don't exist yet |
| 2026-10-15 01:10 | 02 | Planning turns send `tool_choice:"required"`; glm always runs with `enable_thinking:false`; `usage.ts` sums `usage.neurons`. **Folded into TDD §7.4.1.** | Spike: without it, gpt answered in prose and skipped `submit_findings`. glm thinking took 12–21 s and once returned no content. Workers AI reports neurons per call |
| 2026-10-15 01:08 | 02 | AI Gateway `incident-copilot` created by hand in the dashboard (user). WP-25 imports it if the provider supports it | Only `default` is created automatically; any other ID fails with error 2001 |
| 2026-10-15 01:06 | 02 | Approval handling: `WorkflowRejectedError` → rejected, any other error from the wait → expired; the UI never relies on the SDK's `getWorkflow` status; use `this.workflowId`, not `this.instanceId`. **Folded into TDD §8.2.** | Local spike: a timeout throws a plain `Error`; a reject marks the SDK tracking row `errored` even though the run continues; `this.instanceId` is undefined in agents 0.28.1 |
| 2026-10-15 01:00 | 02 | Subrequest counting not tested live; `SUBREQUEST_BUDGET` stays 45, counting everything. **Folded into TDD §5.2.** | User chose no throwaway deploy; the docs are ambiguous (50 per invocation vs 1,000 internal) |
| 2026-10-15 00:33 | 01 | Tests use `@cloudflare/vitest-plugin` 1.4 (`cloudflareTest()`) with `vitest` 4.1, instead of `@cloudflare/vitest-pool-workers` 0.23. Three projects: `unit`, `integration` (main Worker plus an inline **stub** demo Worker behind `DEMO`), and `demo` (the real demo service). **Folded into TDD §2, §4, §14 and PRD §11.1.** | `vitest-pool-workers` is deprecated and was renamed. The test runtime can't start with an unresolved service binding, and the stub lets WP-12 assert `setMode` calls. Vitest 5 is allowed by the plugin, so the 4.1 pin can be lifted later |
| 2026-10-15 00:29 | 01 | Prompt log is `PROMPTS.md`, updated every turn (user message + answers to Claude's questions). WP-16 curates it. | User asked for a prompt history; reuse the PRD §14 deliverable instead of adding a new file |
| 2026-10-15 00:29 | 01 | Pin `typescript` 6.0.x (not 7.x); add `echarts` ^6. **Folded into TDD §2.** | `typescript-eslint` needs TS < 6.1; `echarts` is a Kumo 2.14 peer |
| 2026-10-15 00:29 | 01 | Private GitHub repo `cf_ai_incident_copilot` created now; commit + push after each WP | Offsite backup from hour one |
| 2026-10-15 00:29 | 01 | `wrangler.jsonc` grows per WP (only bind what exists). D1 created with `wrangler d1 create` in WP-03; Terraform imports it in WP-25 if built (deviation from D15) | Bound classes must exist for `pnpm dev`; Terraform is below the cut line |

---

## Daily wrap-up

### Day 1 (2026-10-15)
- **Done:** WP-01 (plus the package change folded into TDD and PRD) to WP-13, plus WP-13b (the live speed fixes found in WP-13). All Day 1 Musts are done. Review setup: `dev` branch, Sift workflows on `main`, PR #2 (WP-01 to WP-05) merged, PR #3 (WP-06 to WP-10) open
- **Moved / slipped:** nothing. Added: WP-11 combined demo modes, WP-13b
- **Hours:** 2.93 / 14.75 h on WPs
- **Transcript exported to `prompts/`:** ✅ 7 sessions (planning + Day 1), secrets removed; see [`prompts/README.md`](prompts/README.md)

### Day 2 (2026-10-16)
- **Done:**
- **Cut (→ README "designed, not built"):**
- **Hours:** / 11.5 h
- **Transcript exported to `prompts/`:** ⬜ **When exporting:** this session shows a Cloudflare API token (in upper case, as a GitHub secret name in `gh secret list` output, 2026-10-15 evening). Redact it as `<TOKEN>`, matching case-insensitively, and the account ID as `<ACCOUNT_ID>`, even after the token is rolled.
