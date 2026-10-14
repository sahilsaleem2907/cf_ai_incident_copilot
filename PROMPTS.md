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
