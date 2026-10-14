# Prompts

How AI was used to build Incident Copilot. This file is a running log: every prompt from the build session is added as it happens, along with the answers given to Claude's clarifying questions. Full, unedited transcripts go in [`prompts/`](prompts/) at the end of each day (PRD §14). The curated overview by phase is added in WP-16.

Secrets (API keys, account IDs, tokens) are removed. Nothing else is edited.

---

## Day 1 (2026-10-15)

### 00:29 · WP-01 Scaffold

> Lets starts with the first tasks in @TASKS.md , Create a PROMPT_HISTORY.md file and keep a track of all the prompts in this chat. /grill-me

Answers to Claude's questions (grill-me):
- **Prompt log:** "Just use PROMPTs.md itself." (no separate PROMPT_HISTORY.md)
- **Versions:** Pin vitest 4.1.x and TypeScript 6.0.x to fit the peer dependencies.
- **Git/GitHub:** Create the private remote now and push after each WP.
- **Config:** (asked for a plain-words explanation first, then) add wrangler settings as each piece is built; create D1 with `wrangler d1 create`.
- **Log format:** Log each user message plus the answers given to Claude's questions.

> explain in simple words

(Asked mid-grilling for the config question to be re-explained in plain language.)

### 00:49 · WP-01 follow-up (docs)

> Fold the package change in the @TDD.md and @TASKS.md

(Folded the `@cloudflare/vitest-plugin` rename, the three Vitest projects and the demo stub into TDD §2, §4 and §14, and merged the matching TASKS decision rows.)

### 00:51 · WP-01 follow-up (docs)

> Yes, lets update the @PRD.md and also update the task status in @TASKS.md

(PRD §11.1 now names `@cloudflare/vitest-plugin`. TASKS: WP-01 row, "Now" section, Day 1 wrap-up and hours updated; WP-02 is marked as needing `wrangler login`.)

### 01:00 · WP-02 Spike

> Done, Lets start WP-02 from the @TASKS.md .

Answers to Claude's questions:
- **Live test of the subrequest limit:** No, local only + docs (no throwaway deploy).
- **Spike code:** Throw it away; commit only findings and recorded responses.
- **AI Gateway:** Create `incident-copilot` in the dashboard (rather than using `default`). User created it.

> try again.

(After the gateway was created: the retry through `incident-copilot` succeeded.)

### 01:16 · WP-03 D1 and workspace

> Sounds good, lets continue to WP-03.

### 01:23 · WP-03 follow-up (open question for WP-11)

> OQ for WP-11 in local environment (set via env) we can allow that url as well, in others (prod only for our case) we can let it be blocked naturally.

(Recorded as a dev-only `SSRF_DEV_ALLOW_ORIGIN` exact-origin exception in TDD §11. It's built in WP-04 and set in WP-11.)

### 01:26 · WP-04 Safety core

> Continue to WP-04.

### 01:38 · WP-05 Tools

> Continue to WP-05

Answers to Claude's questions:
- **DNS mismatch:** Only real disagreements (one resolver says the name exists and the other doesn't, or one fails). Different address lists are information only.

### 01:47 · Branching for review

> lets push this code from a new branch (dev). ill then run sift code review by raising a PR to master.

Answers to Claude's questions:
- **PR base:** `master` at the first commit (`867d8d6`, WP-01 scaffold); `dev` at the latest commit. The PR shows WP-02 to WP-05 plus doc changes; main is unchanged.
