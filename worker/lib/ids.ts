const ID_RE = /^[0-9a-f]{32}$/;

/** 128-bit random hex ID for incidents, workspaces and approvals (TDD §6.4). */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isId(value: unknown): value is string {
  return typeof value === "string" && ID_RE.test(value);
}
