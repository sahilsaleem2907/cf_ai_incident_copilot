import { describe, expect, it } from "vitest";
import { demoTarget } from "../../worker/api/session";

const WS = "0123456789abcdef0123456789abcdef";

describe("demoTarget", () => {
  it("builds the workspace's demo URL", () => {
    expect(demoTarget("http://localhost:5173", WS)).toBe(`http://localhost:5173/w/${WS}/`);
    expect(demoTarget("https://incident-copilot-demo.acme.workers.dev/", WS)).toBe(`https://incident-copilot-demo.acme.workers.dev/w/${WS}/`);
  });

  it("is null while DEMO_BASE_URL still holds the <sub> placeholder", () => {
    expect(demoTarget("https://incident-copilot-demo.<sub>.workers.dev", WS)).toBeNull();
  });
});
