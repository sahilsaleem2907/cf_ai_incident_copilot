import { Banner, Checkbox, ClipboardText, Radio } from "@cloudflare/kumo";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { DEMO_MODE_LABELS, DEMO_PROBLEMS, modesFrom, type DemoProblem } from "../../demo-service/src/modes";
import { DEMO_CHANGED, ERROR_TEXT, getDemo, setDemoModes, type Demo } from "../lib/api";

const SAVE_FAILED = "Couldn't change the mode. Try again.";
const NONE = "none";
type Choice = DemoProblem | typeof NONE;

/**
 * "Break the demo service" panel (FR-33, TDD §12.1). One main problem at a time (they change how the page
 * answers), plus an optional slow-down on top, so every combination stays visible to the diagnosis.
 */
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

  const problem = DEMO_PROBLEMS.find((p) => demo?.modes.includes(p)) ?? null;
  const slow = demo?.modes.includes("slow") ?? false;

  const change = async (nextProblem: DemoProblem | null, nextSlow: boolean) => {
    if (!demo) return;
    const before = demo;
    const modes = modesFrom(nextProblem, nextSlow);
    setDemo({ ...demo, modes });
    setSaving(true);
    const r = await setDemoModes(modes);
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
        <h2 id="demo-panel-title" className="section-label">
          Demo service
        </h2>
        <p className="mt-2 text-sm text-(--cf-fg-muted)">Break your own demo site, then ask the copilot what's wrong.</p>
      </div>

      {demo && (
        <>
          <p className="text-sm" aria-live="polite">
            <span className="text-(--cf-fg-muted)">Now: </span>
            <span className="font-medium">{demo.modes.map((m) => DEMO_MODE_LABELS[m]).join(" + ")}</span>
          </p>

          <Radio.Group<Choice>
            legend="Problem"
            value={problem ?? NONE}
            onValueChange={(c) => void change(c === NONE ? null : c, slow)}
            disabled={saving}
          >
            <Radio.Item<Choice> value={NONE} label="None" />
            {DEMO_PROBLEMS.map((p) => (
              <Radio.Item<Choice> key={p} value={p} label={DEMO_MODE_LABELS[p]} />
            ))}
          </Radio.Group>

          <Checkbox label="Also slow (+3 s per response)" checked={slow} disabled={saving} onCheckedChange={(c) => void change(problem, c === true)} />

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
