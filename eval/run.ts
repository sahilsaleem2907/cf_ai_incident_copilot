/**
 * LLM eval (TDD §16): `pnpm eval --base <url> [--note "<text>"]`. Node 22 runs this file as is (type
 * stripping), so it imports only `./cases.ts` and holds only erasable TypeScript.
 *
 * session (workspace cookie) → for each case: demo set to the mode → a real AI diagnosis of the demo → poll
 * until the run ends → score. Then the demo goes back to healthy and `eval/results.md` is written. Exits 1
 * below the 4/5 target. A full run spends real neurons (about 140 per case), so it isn't part of CI.
 */
import { writeFileSync } from "node:fs";
import { CASES, failed, QUESTION, renderResults, score, TARGET_PASSES, type Score, type Snapshot } from "./cases.ts";

const POLL_MS = 2_000;
const RUN_TIMEOUT_MS = 120_000;
/** Runs are limited to 3 a minute per workspace (TDD §11); a 429 waits for `retryAfter`, this many times. */
const RATE_LIMIT_TRIES = 3;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const base = flag("base")?.replace(/\/+$/, "");
const note = flag("note");
if (!base || !URL.canParse(base)) {
  console.error('usage: pnpm eval --base <url> [--note "<text>"]');
  process.exit(2);
}

let cookie = "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: unknown; text: string }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "manual",
  });
  const ws = res.headers.getSetCookie().find((c) => c.startsWith("__Host-ws="));
  if (ws) cookie = ws.split(";")[0]!;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON: callers that need a body fail on the status first.
  }
  return { status: res.status, json, text };
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const r = await request(method, path, body);
  if (r.status < 200 || r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${r.text.slice(0, 200)}`);
  return r.json as T;
}

/** Opens the incident, waiting out the per-minute run limit. */
async function openIncident(): Promise<string> {
  for (let i = 1; ; i++) {
    const r = await request("POST", "/api/incidents", { message: QUESTION });
    if (r.status === 200) return (r.json as { id: string }).id;
    const retryAfter = (r.json as { retryAfter?: number } | null)?.retryAfter;
    if (r.status !== 429 || !retryAfter || i >= RATE_LIMIT_TRIES) throw new Error(`POST /api/incidents → ${r.status} ${r.text.slice(0, 200)}`);
    console.log(`… rate limited, waiting ${retryAfter} s`);
    await sleep(retryAfter * 1000);
  }
}

async function runCase(c: (typeof CASES)[number]): Promise<Score> {
  await call("POST", "/api/demo/mode", { modes: [c.mode] });
  const id = await openIncident();
  const started = Date.now();
  const deadline = started + RUN_TIMEOUT_MS;
  let snap: Snapshot;
  do {
    await sleep(POLL_MS);
    snap = await call<Snapshot>("GET", `/api/incidents/${id}`);
  } while (snap.activeRunId !== null && Date.now() < deadline);
  const seconds = Math.round((Date.now() - started) / 1000);
  if (snap.activeRunId !== null) return failed(c, `the run didn't finish within ${RUN_TIMEOUT_MS / 1000} s (incident ${id})`, seconds);
  return score(c, snap, seconds);
}

async function main(): Promise<number> {
  await call("GET", "/api/session");
  if (!cookie) throw new Error("GET /api/session set no __Host-ws cookie");
  console.log(`eval against ${base}: ${CASES.length} cases`);

  const rows: Score[] = [];
  try {
    for (const c of CASES) {
      let row: Score;
      try {
        row = await runCase(c);
      } catch (e) {
        row = failed(c, (e as Error).message, 0);
      }
      rows.push(row);
      console.log(`${row.pass ? "✓" : "✗"} ${c.mode.padEnd(13)} ${row.got ?? "-"} (${row.seconds} s)${row.reasons.length ? `: ${row.reasons.join("; ")}` : ""}`);
    }
  } finally {
    // Leave the demo healthy; the pending approval cards just wait out their timeout.
    await call("POST", "/api/demo/mode", { modes: ["healthy"] }).catch((e: unknown) => console.error(`couldn't restore the demo: ${(e as Error).message}`));
  }

  const target = note ? `${base} (${note})` : base!;
  const out = new URL("./results.md", import.meta.url);
  writeFileSync(out, renderResults(rows, { date: new Date().toISOString().replace(/\.\d+Z$/, "Z"), target }));
  const passes = rows.filter((r) => r.pass).length;
  console.log(`${passes}/${rows.length} passed (target ≥ ${TARGET_PASSES}); wrote ${out.pathname}`);
  return passes >= TARGET_PASSES ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(`✗ eval failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
