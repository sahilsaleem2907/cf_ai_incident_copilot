import { describe, expect, it } from "vitest";
import { CUT_SHORT_NOTE, finalizeNarration } from "../../worker/loop/narrate";

const knownIds = ["http-1", "dns-1"];
const template = () => "TEMPLATE";
const good = "**Likely cause:** The origin returns HTTP 503 on every sample [http-1].\n\n**Evidence**\n- HTTP 503/503/503 [http-1]";

describe("finalizeNarration", () => {
  it("keeps a complete, well-formed answer after the citation check", () => {
    const r = finalizeNarration({ text: `${good}\nIt took 900 ms.`, knownIds, template });
    expect(r.source).toBe("llm");
    expect(r.text).toContain("[http-1]");
    expect(r.text).toContain("_1 uncited statement removed_");
  });

  it("keeps a well-formed answer that was cut off at max_tokens, with a note", () => {
    expect(finalizeNarration({ text: good, truncated: true, knownIds, template })).toEqual({ text: `${good}\n\n${CUT_SHORT_NOTE}`, source: "partial" });
  });

  it("keeps a well-formed partial stream, with a note", () => {
    expect(finalizeNarration({ partial: good, knownIds, template })).toMatchObject({ source: "partial", text: expect.stringContaining(CUT_SHORT_NOTE) });
  });

  it("uses the template for junk, uncited text or nothing", () => {
    expect(finalizeNarration({ text: "!".repeat(400), knownIds, template })).toEqual({ text: "TEMPLATE", source: "template" });
    expect(finalizeNarration({ text: "**Likely cause:** something [cert-7].", knownIds, template }).source).toBe("template");
    expect(finalizeNarration({ partial: "**Likely ca", knownIds, template }).source).toBe("template");
    expect(finalizeNarration({ knownIds, template }).source).toBe("template");
  });
});
