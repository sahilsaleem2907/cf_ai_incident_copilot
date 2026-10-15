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
- Don't share the deployed URL until WP-17 is ✅ (D2).

---

## Now

- **Current:** WP-10 Chat UI (started 16:24)
- **Next:** WP-11 Demo service + DemoPanel
- **Hours today:** 2.05 / 14.75 h (Day 1) on WPs, plus about 0.3 h review setup
- **Review status (WP-01 to WP-05):**
  - Sift workflows (`sift-review.yml`, `sift-feedback.yml`) are on `main` (`f5707d2`); the zip upload is gone. `main` was merged into `dev` (`bf4ea92`).
  - PR #2 `dev` → `main` ("WP-01 to WP-05") was reviewed by Sift: 5 findings, all false alarms, each answered `/not-helpful` with the reason. **Merged** 2026-10-15 13:40 (`0073839`).
  - PR #1 was closed unmerged; `master` (`867d8d6`) is unused.
  - Next review: a new `dev` → `main` PR for WP-06 onward.
- **Blockers / risks:** none blocking. Watch gpt latency in WP-09: a forced `submit_findings` turn took 19 s once (TDD §7.4.1).

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
| 10 | Chat UI | 1.75 | 08 | 🔄 | 16:24 | | |
| 11 | Demo service + `DemoPanel` | 1.0 | 03 | ⬜ | | | |
| 12 | Act: actions, approval, verify, monitor, `ApprovalCard` | 1.5 | 09, 11 | ⬜ | | | |
| 13 | Deploy 1 + live walkthrough + SSRF/CPU checks | 0.5 | 12 | ⬜ | | | |

> **Slip rule:** if Day 1 runs over, WP-12 and WP-13 move to the start of Day 2, ahead of every Should item.

## Day 2: remaining Musts, then Shoulds

| WP | Task | Est | Deps | Status | Started | Done | Commit / notes |
|---|---|---|---|---|---|---|---|
| 14 | Tests (Must): fill coverage gaps | 1.25 | 12 | ⬜ | | | |
| 15 | CI/CD (Must): `ci.yml`, `deploy.yml`, smoke | 0.75 | 14 | ⬜ | | | |
| 16 | README + PROMPTS (Must, **protected time**) | 1.0 | — | ⬜ | | | |
| 17 | Limits + budget guard | 1.0 | 15 | ⬜ | | | |
| 18 | Watch: API, panel, cron, `WatchWorkflow` | 2.0 | 17 | ⬜ | | | |
| 19 | Notifications: polling, unread, webhooks, `NotifyWorkflow` | 1.5 | 18 | ⬜ | | | |
| 20 | Eval: `eval/run.ts` + `results.md` | 0.75 | 15 | ⬜ | | | |
| — | **✂️ CUT LINE**: anything below that isn't built goes into the README "designed, not built" list | | | | | | |
| 21 | `cert_info` + `provider_status` | 1.0 | 09 | ⬜ | | | |
| 22 | Postmortem | 0.5 | 12 | ⬜ | | | |
| 23 | Voice | 0.75 | 17 | ⬜ | | | |
| 24 | `recheck_burst` | 0.25 | 12 | ⬜ | | | |
| 25 | Terraform (local apply) | 0.5 | — | ⬜ | | | |
| 26 | Demo GIF | 0.25 | 13 | ⬜ | | | |

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

- [ ] `routes.tsx` (`/`, `/i/:id`)
- [ ] `useIncident`: wraps `useAgent`, merges `delta` broadcasts into a buffer keyed by `messageId`, exposes callables
- [ ] `ChatPane`: messages, check cards inline in run order, empty state (`Empty`) with "Use demo service" and "diagnose cloudflare.com" chips
- [ ] `Composer`: Enter sends, Shift+Enter adds a new line, disabled while `activeRunId` is set, handles 400 `need_target` and 409
- [ ] `MessageBubble`: streaming buffer replaced by the final stored text; stream region has `aria-live="polite"`
- [ ] `CheckCard`: tool icon, label, summary, `Collapsible` evidence in `Code` (lazy `getEvidence`)
- [ ] `StatusBadge`: icon **and** text for Pending, Running (`Loader`), Pass, Fail, Unavailable
- [ ] `EvidenceChip`: clicking `[http-1]` scrolls to its card and flashes the orange ring
- [ ] Incident header: target in mono and a status chip that always has text
- [ ] "New incident for X" button when a follow-up names a host outside the origin pin (§8.6)
- [ ] `IncidentSidebar`: "New incident" button and a basic list with status badges
- [ ] `ReadOnlyBanner` for viewer connections
- [ ] Keyboard pass: every control reachable, nothing shown by colour alone
- [ ] **Done when:** full chat works end to end in the browser with `LLM_MODE=mock`
</details>

<details>
<summary><b>WP-11</b> Demo service</summary>

- [ ] Modes: healthy, slow, errors, redirect_loop, bad_cache
- [ ] `DemoState` DO
- [ ] `DemoAdmin` RPC entrypoint
- [ ] `/api/demo` + `/api/demo/mode`
- [ ] Local demo URL: `.dev.vars` sets `DEMO_BASE_URL` to the local demo origin and `SSRF_DEV_ALLOW_ORIGIN` to the same origin
- [ ] `DemoPanel` (right column): mode picker (`Select`/`Radio`) and the demo URL (`ClipboardText`)
- [ ] `demo.test.ts`
- [ ] **Done when:** each mode behaves as in TDD §7.5; demo test passes
</details>

<details>
<summary><b>WP-12</b> Act</summary>

- [ ] Action catalog + proposable checks
- [ ] Propose / supersede / dedupe
- [ ] `waitForApproval`, approve/reject callables
- [ ] Execute + verify + `afterAction`
- [ ] Monitor ticks (15 s × 10, 3 passes → resolved)
- [ ] `ApprovalCard`: action title, why it's proposed (cause + refs), real `<button>`s for Approve (orange) and Reject; shows approved, rejected, expired or superseded; buttons hidden for viewers
- [ ] Resolve button in the incident header
- [ ] `approval.test.ts`
- [ ] **Done when:** approval test passes; local walkthrough break → approve → resolved works
</details>

<details>
<summary><b>WP-13</b> Deploy 1</summary>

- [ ] `wrangler deploy` both Workers
- [ ] Live PRD §13 steps 1–5
- [ ] SSRF refusals: `169.254.169.254`, `localhost`, `10.0.0.1`
- [ ] CPU time check in Workers Logs
- [ ] **Done when:** live URL passes the walkthrough (**don't share it yet**)
</details>

### Day 2

<details>
<summary><b>WP-14</b> Tests</summary>

- [ ] Fill unit coverage gaps
- [ ] Fill integration gaps (`transitions`, `cron` stubs)
- [ ] **Done when:** `pnpm test` is green and the approval path is covered
</details>

<details>
<summary><b>WP-15</b> CI/CD</summary>

- [ ] `ci.yml` (typecheck, lint, test, terraform fmt/validate), alongside the existing Sift workflows; PR trigger on `main`
- [ ] `deploy.yml` (migrations, build, deploy demo then main, smoke)
- [ ] Smoke script (`?smoke=rule` option)
- [ ] GitHub secrets
- [ ] **Done when:** a PR runs green; merging deploys and passes smoke
</details>

<details>
<summary><b>WP-16</b> README and PROMPTS</summary>

- [ ] Architecture + Agents SDK explanation
- [ ] Security section with accepted risks (D2, D7, single location, DNS rebinding)
- [ ] Terraform / wrangler split
- [ ] "Designed, not built" list (from cut items in this file)
- [ ] `PROMPTS.md` + `prompts/` transcripts, secrets removed
- [ ] **Done when:** docs complete, no secrets
</details>

<details>
<summary><b>WP-17</b> Limits and budget guard</summary>

- [ ] `PROBE_LIMIT`, `RUN_LIMIT`, `VOICE_LIMIT` bindings
- [ ] `quota.ts` (D1 fixed window)
- [ ] `usage.ts` wired to the guard (≥ 9000 → rule_based)
- [ ] `BudgetBanner` in the header, driven by `budgetMode` from `/api/session`
- [ ] 429 UX: `Toast` showing the time until reset
- [ ] **Done when:** 4 runs in a minute → 429; forced neuron total → rule-based banner
</details>

<details>
<summary><b>WP-18</b> Watch</summary>

- [ ] Watch API + caps (3 per workspace, 30 global)
- [ ] `WatchlistPanel` (sidebar): add URL, list with last status, delete, cap errors shown
- [ ] `add_to_watchlist` action
- [ ] `scheduled()` (LIMIT 6, subrequest counter)
- [ ] `WatchWorkflow` (2 of 3 confirm)
- [ ] `reportWatchCheck`
- [ ] `cron.test.ts`
- [ ] **Done when:** breaking a watched demo opens an incident in about 2 min; restoring resolves it
</details>

<details>
<summary><b>WP-19</b> Notifications</summary>

- [ ] `useIncidents`: polls `GET /api/incidents` every 10 s while the tab is visible
- [ ] Unread dot and badge in `IncidentSidebar`; `markRead` when an incident is opened
- [ ] `useNotifications`: browser notification on a new unread row (permission requested from a button click)
- [ ] Webhook API
- [ ] `WebhookSettings` (sidebar): `SensitiveInput`, masked hint, remove
- [ ] `crypto.ts` (AES-GCM) + `webhook.test.ts`
- [ ] `NotifyWorkflow`
- [ ] **Done when:** a test Discord webhook fires exactly once per state change
</details>

<details>
<summary><b>WP-20</b> Eval</summary>

- [ ] `eval/run.ts` + `cases.ts`
- [ ] One live run (about 3k neurons)
- [ ] Commit `eval/results.md`
- [ ] **Done when:** at least 4 of 5 cases pass
</details>

<details>
<summary><b>WP-21</b> cert_info and provider_status</summary>

- [ ] `cert.ts` (crt.sh, Cache API, `unavailable` on error)
- [ ] `provider.ts` (Statuspage + AWS best effort)
- [ ] Add both to the rule path
- [ ] **Done when:** both cards render; crt.sh failure shows `unavailable`
</details>

<details>
<summary><b>WP-22</b> Postmortem</summary>

- [ ] `generatePostmortem` (streamed + rule-based template)
- [ ] `PostmortemDialog` (`Dialog` with copy)
- [ ] Postmortem button in the incident header, enabled when `resolved`
- [ ] `generate_postmortem` action
- [ ] **Done when:** walkthrough step 6 produces stored, copyable markdown
</details>

<details>
<summary><b>WP-23</b> Voice</summary>

- [ ] `useRecorder` + `VoiceButton`
- [ ] `/api/voice` (size cap, limit, whisper)
- [ ] Normalization (" dot ", " slash ", hostname lowercasing)
- [ ] **Done when:** "is demo dot example dot com down" fills the input and isn't sent
</details>

<details>
<summary><b>WP-24</b> recheck_burst</summary>

- [ ] Monitor kind `burst` (60 s × 15)
- [ ] **Done when:** timeline shows ticks once a minute
</details>

<details>
<summary><b>WP-25</b> Terraform</summary>

- [ ] `infra/` with D1 (+ AI Gateway if the provider supports it)
- [ ] One local `apply`
- [ ] **Done when:** `terraform validate` passes in CI and apply has run once
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
- **Done:** WP-01 (plus the package change folded into TDD and PRD), WP-02, WP-03, WP-04, WP-05, WP-06, WP-07, WP-08, WP-09. Review setup: `dev` branch, Sift workflows on `main`, PR #2 (WP-01 to WP-05) merged
- **Moved / slipped:**
- **Hours:** 2.05 / 14.75 h
- **Transcript exported to `prompts/`:** ⬜

### Day 2 (2026-10-16)
- **Done:**
- **Cut (→ README "designed, not built"):**
- **Hours:** / 11.5 h
- **Transcript exported to `prompts/`:** ⬜
