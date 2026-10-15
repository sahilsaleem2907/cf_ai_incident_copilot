/**
 * Deploy smoke test (TDD §15): `node scripts/smoke.ts <baseUrl>`. Node 22 runs this file as is (type
 * stripping), so it has no imports and only erasable TypeScript.
 *
 * health → session (workspace cookie) → demo set to healthy → a `?smoke=rule` diagnosis of the demo → poll
 * until the run ends → expect `healthy`. The rule-based run never calls the LLM, so a deploy costs no neurons.
 */

const HEALTH_TRIES = 5;
const POLL_MS = 2_000;
const RUN_TIMEOUT_MS = 90_000;

type Snapshot = { activeRunId: string | null; category: string | null; status: string; mode: string };

const base = process.argv[2]?.replace(/\/+$/, "");
if (!base || !URL.canParse(base)) {
  console.error("usage: node scripts/smoke.ts <baseUrl>");
  process.exit(2);
}

let cookie = "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "manual",
  });
  const ws = res.headers.getSetCookie().find((c) => c.startsWith("__Host-ws="));
  if (ws) cookie = ws.split(";")[0]!;
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

function step(name: string, detail: string): void {
  console.log(`✓ ${name.padEnd(9)} ${detail}`);
}

async function main(): Promise<void> {
  // The first request after a deploy can fail once (WP-13 saw a transient 1042), so health retries.
  for (let i = 1; ; i++) {
    try {
      const h = await call<{ ok: boolean; version?: string }>("GET", "/api/health");
      if (!h.ok) throw new Error("health ok=false");
      step("health", `version ${h.version ?? "?"}`);
      break;
    } catch (e) {
      if (i >= HEALTH_TRIES) throw e;
      console.log(`… health  attempt ${i} failed (${(e as Error).message}), retrying`);
      await sleep(3_000);
    }
  }

  const session = await call<{ demoUrl: string }>("GET", "/api/session");
  if (!cookie) throw new Error("GET /api/session set no __Host-ws cookie");
  step("session", "workspace cookie set");

  await call("POST", "/api/demo/mode", { modes: ["healthy"] });
  step("demo", `healthy at ${session.demoUrl}`);

  const { id } = await call<{ id: string }>("POST", "/api/incidents?smoke=rule", { message: "diagnose demo" });
  step("incident", id);

  const deadline = Date.now() + RUN_TIMEOUT_MS;
  let snap: Snapshot;
  do {
    await sleep(POLL_MS);
    snap = await call<Snapshot>("GET", `/api/incidents/${id}`);
  } while (snap.activeRunId !== null && Date.now() < deadline);
  if (snap.activeRunId !== null) throw new Error(`the run didn't finish within ${RUN_TIMEOUT_MS / 1000} s`);
  if (snap.category !== "healthy") throw new Error(`expected category healthy, got ${snap.category} (status ${snap.status})`);
  step("diagnosis", `healthy, ${snap.mode}, incident ${snap.status}`);
}

main().then(
  () => console.log(`smoke passed: ${base}`),
  (e: unknown) => {
    console.error(`✗ smoke failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
