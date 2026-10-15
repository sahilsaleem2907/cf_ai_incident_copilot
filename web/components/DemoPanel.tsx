import { Banner, ClipboardText, Radio } from "@cloudflare/kumo";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { DEMO_MODE_LABELS, DEMO_MODES, type DemoMode } from "../../demo-service/src/modes";
import { DEMO_CHANGED, ERROR_TEXT, getDemo, setDemoMode, type Demo } from "../lib/api";

const SAVE_FAILED = "Couldn't change the mode. Try again.";

/** "Break the demo service" panel (FR-33, TDD §12.1): pick a mode for this workspace's demo and copy its URL. */
export function DemoPanel() {
  const [demo, setDemo] = useState<Demo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      void getDemo().then((r) => {
        if (!live) return;
        if (r.ok) {
          setDemo(r.demo);
          setError(null);
        } else setError(ERROR_TEXT[r.error]);
      });
    load();
    window.addEventListener(DEMO_CHANGED, load);
    return () => {
      live = false;
      window.removeEventListener(DEMO_CHANGED, load);
    };
  }, []);

  const change = async (mode: DemoMode) => {
    if (!demo || mode === demo.mode) return;
    const before = demo;
    setDemo({ ...demo, mode });
    setSaving(true);
    const r = await setDemoMode(mode);
    setSaving(false);
    if (r.ok) {
      setDemo(r.demo);
      setError(null);
    } else {
      setDemo(before);
      setError(r.error === "demo_unavailable" ? ERROR_TEXT.demo_unavailable : SAVE_FAILED);
    }
  };

  return (
    <section aria-labelledby="demo-panel-title" className="flex flex-col gap-4">
      <div>
        <h2 id="demo-panel-title" className="font-display text-base font-medium">
          Demo service
        </h2>
        <p className="mt-1 text-sm text-(--cf-fg-muted)">Break your own demo site, then ask the copilot what's wrong.</p>
      </div>

      {demo && (
        <>
          <Radio.Group<DemoMode> legend="Mode" value={demo.mode} onValueChange={(m) => void change(m)} disabled={saving}>
            {DEMO_MODES.map((m) => (
              <Radio.Item<DemoMode> key={m} value={m} label={DEMO_MODE_LABELS[m]} />
            ))}
          </Radio.Group>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Demo URL</span>
            <ClipboardText text={demo.url} className="w-full min-w-0" tooltip={{ text: "Copy URL", copiedText: "Copied" }} />
            <a
              href={demo.url}
              target="_blank"
              rel="noreferrer"
              className="flex w-fit items-center gap-1 rounded-md text-sm text-(--cf-fg-muted) hover:text-(--cf-fg) focus-visible:outline-2 focus-visible:outline-cf-orange"
            >
              Open the demo
              <ArrowSquareOutIcon aria-hidden size={14} />
            </a>
          </div>

          <p className="text-sm text-(--cf-fg-muted)">
            Then ask: <q className="text-(--cf-fg)">What's wrong with my demo service?</q>
          </p>
        </>
      )}

      {error && (
        <div role="alert">
          <Banner variant="error" description={error} />
        </div>
      )}
    </section>
  );
}
