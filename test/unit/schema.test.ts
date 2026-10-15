import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toolParameters } from "../../worker/lib/schema";

describe("toolParameters", () => {
  it("drops regex patterns at every depth (glm rejects look-around, WP-07)", () => {
    const schema = z.object({
      host: z.string().regex(/^(?!-)[a-z0-9.-]+$/),
      paths: z.array(z.string().regex(/^\//)),
      nested: z.object({ tag: z.string().regex(/^[a-z]+$/) }),
    });
    const json = JSON.stringify(toolParameters(schema));
    expect(json).not.toContain('"pattern"');
    expect(toolParameters(schema)).toMatchObject({
      type: "object",
      properties: { host: { type: "string" }, paths: { type: "array", items: { type: "string" } }, nested: { properties: { tag: { type: "string" } } } },
    });
  });

  it("keeps a property that happens to be named pattern", () => {
    const params = toolParameters(z.object({ pattern: z.string().regex(/a/) })) as { properties: Record<string, unknown>; required: string[] };
    expect(params.properties.pattern).toEqual({ type: "string" });
    expect(params.required).toEqual(["pattern"]);
  });

  it("leaves out $schema and keeps the rest of the schema", () => {
    const params = toolParameters(z.object({ n: z.number().int().min(1).max(3).optional() }));
    expect(params).not.toHaveProperty("$schema");
    expect(params).toMatchObject({ properties: { n: { type: "integer", minimum: 1, maximum: 3 } } });
  });
});
