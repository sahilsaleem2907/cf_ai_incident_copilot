import { isId } from "../../worker/lib/ids";
import type { DemoMode } from "./modes";

/** `/w/<ws>/…` pages per mode (TDD §7.5). The mode is looked up only for a well-formed workspace path. */
export const SLOW_DELAY_MS = 3000;

const PAGE_CACHE = "public, max-age=0, must-revalidate";
const STATIC_CACHE = "public, max-age=31536000, immutable";

const STATIC_FILES: Record<string, { type: string; body: string }> = {
  "app.css": { type: "text/css; charset=utf-8", body: "body{font-family:system-ui,sans-serif;margin:2rem;color:#222}\n" },
  "app.js": { type: "text/javascript; charset=utf-8", body: 'document.documentElement.dataset.demo = "ready";\n' },
};

type Route = { kind: "page" } | { kind: "bounce" } | { kind: "static"; file: string } | { kind: "missing" };

function route(rest: string): Route {
  if (rest === "") return { kind: "page" };
  if (rest === "r") return { kind: "bounce" };
  const file = rest.startsWith("static/") ? rest.slice("static/".length) : null;
  if (file !== null && file in STATIC_FILES) return { kind: "static", file };
  return { kind: "missing" };
}

function page(ws: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Demo service</title>
<link rel="stylesheet" href="/w/${ws}/static/app.css">
<script src="/w/${ws}/static/app.js" defer></script>
</head>
<body><h1>Demo service</h1><p>Everything is fine here.</p></body>
</html>
`;
}

const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
const redirect = (location: string) => new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });

export async function handle(request: Request, getMode: (ws: string) => Promise<DemoMode>): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === "/") return text("Incident Copilot demo service. Pages live at /w/<workspace>/.", 200);

  const m = /^\/w\/([^/]+)\/(.*)$/.exec(pathname);
  if (!m || !isId(m[1])) return text("Not found", 404);
  const ws = m[1];
  const r = route(m[2]!);
  if (r.kind === "missing") return text("Not found", 404);
  if (request.method !== "GET" && request.method !== "HEAD") return text("Method not allowed", 405);

  const mode = await getMode(ws);
  if (mode === "slow") await scheduler.wait(SLOW_DELAY_MS);
  const res = respond(r, ws, mode);
  if (mode === "bad_cache") res.headers.append("set-cookie", `demo_session=${crypto.randomUUID()}; Path=/w/${ws}/`);
  return res;
}

function respond(r: Exclude<Route, { kind: "missing" }>, ws: string, mode: DemoMode): Response {
  if (mode === "errors") {
    return new Response("Internal Server Error", { status: 500, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }
  const home = `/w/${ws}/`;
  if (r.kind === "bounce") return redirect(home);
  if (r.kind === "page") {
    if (mode === "redirect_loop") return redirect(`${home}r`);
    return new Response(page(ws), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": PAGE_CACHE } });
  }
  const file = STATIC_FILES[r.file]!;
  return new Response(file.body, {
    headers: { "content-type": file.type, "cache-control": mode === "bad_cache" ? "no-store" : STATIC_CACHE },
  });
}
