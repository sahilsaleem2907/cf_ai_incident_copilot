import { describe, expect, it } from "vitest";
import { CUT_SHORT_NOTE, fillEmptyCause, finalizeNarration } from "../../worker/loop/narrate";

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

describe("an emptied Likely cause (WP-13b, seen live)", () => {
  const cause = { text: "The origin returns HTTP 500 on every sample.", evidence: ["http-1"] };
  const known = ["dns-1", "http-1"];

  it("puts the findings' cited cause back when the citation check removed it", () => {
    // The live model wrote the cause on its own line without a citation.
    const text = "**Likely cause:**\nThe demo returns HTTP 500 errors.\n\n**Evidence**\n- HTTP probe: 500/500/500 [http-1]";
    const out = finalizeNarration({ text, knownIds: known, template: () => "T", cause });
    expect(out.text.split("\n")[0]).toBe("**Likely cause:** The origin returns HTTP 500 on every sample [http-1].");
    expect(out.source).toBe("llm");
  });

  it("leaves a cause that survived alone", () => {
    expect(fillEmptyCause("**Likely cause:** The origin fails [http-1].\n\n**Evidence**", cause, known)).toBe("**Likely cause:** The origin fails [http-1].\n\n**Evidence**");
    expect(fillEmptyCause("**Likely cause:**\nThe origin fails [http-1].", cause, known)).toBe("**Likely cause:**\nThe origin fails [http-1].");
  });

  it("keeps a cause that cites itself as written, and drops unknown IDs", () => {
    expect(fillEmptyCause("**Likely cause:**\n**Evidence**", { text: "Errors [http-1].", evidence: ["http-1"] }, known)).toBe("**Likely cause:** Errors [http-1].\n**Evidence**");
    expect(fillEmptyCause("**Likely cause:**", { text: "Errors.", evidence: ["http-9", "dns-1"] }, known)).toBe("**Likely cause:** Errors [dns-1].");
  });
});
