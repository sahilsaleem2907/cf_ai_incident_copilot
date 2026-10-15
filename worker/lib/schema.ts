import { z } from "zod";

/**
 * JSON Schema for an LLM tool's parameters. Regex `pattern`s are left out: glm builds a constrained grammar
 * from the schema and rejects look-around ("3030: Grammar error", WP-07 live check). zod still validates
 * the arguments server-side, so nothing is lost.
 */
export function toolParameters(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete json.$schema;
  return stripPatterns(json) as Record<string, unknown>;
}

function stripPatterns(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripPatterns);
  if (node === null || typeof node !== "object") return node;
  // A property named "pattern" has an object value, so only the string keyword is dropped.
  return Object.fromEntries(Object.entries(node).flatMap(([k, v]) => (k === "pattern" && typeof v === "string" ? [] : [[k, stripPatterns(v)]])));
}
