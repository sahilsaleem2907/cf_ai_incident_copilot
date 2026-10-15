/**
 * Origin pin (D6): tools only touch the incident's own host, plus CNAME targets found in this
 * incident's DNS evidence for DNS/cert lookups. A violation counts as an invalid call (FR-12).
 */
export type Scope = { host: string; cnameTargets: readonly string[] };

export class OutOfScopeError extends Error {
  override name = "OutOfScopeError";
}

const normHost = (h: string) => h.trim().toLowerCase().replace(/\.$/, "");

function hostOf(url: unknown): string {
  if (typeof url !== "string") throw new OutOfScopeError("http_probe needs a url string.");
  try {
    return normHost(new URL(url).hostname);
  } catch {
    throw new OutOfScopeError(`${url} isn't a valid URL.`);
  }
}

export function assertInScope(tool: string, args: unknown, scope: Scope): void {
  const incidentHost = normHost(scope.host);
  const a = (args ?? {}) as { url?: unknown; hostname?: unknown };

  switch (tool) {
    case "http_probe": {
      const host = hostOf(a.url);
      if (host !== incidentHost) {
        throw new OutOfScopeError(`http_probe is limited to ${incidentHost}; ${host} needs its own incident.`);
      }
      return;
    }
    case "dns_lookup":
    case "cert_info": {
      if (typeof a.hostname !== "string") throw new OutOfScopeError(`${tool} needs a hostname string.`);
      const host = normHost(a.hostname);
      const allowed = new Set([incidentHost, ...scope.cnameTargets.map(normHost)]);
      if (!allowed.has(host)) {
        throw new OutOfScopeError(`${tool} is limited to ${incidentHost} and its CNAME targets; ${host} isn't one.`);
      }
      return;
    }
    case "provider_status":
    case "submit_findings":
      return;
    default:
      throw new OutOfScopeError(`Unknown tool ${tool}.`);
  }
}
