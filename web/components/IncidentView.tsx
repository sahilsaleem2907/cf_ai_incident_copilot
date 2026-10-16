import { Badge, Banner, Button } from "@cloudflare/kumo";
import { CheckCircleIcon, EyeIcon, FileTextIcon, InfoIcon, PulseIcon, RobotIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useIncident } from "../hooks/useIncident";
import { usePageVisible } from "../hooks/usePageVisible";
import { useRateLimitToast } from "../hooks/useRateLimitToast";
import { MONITOR_PASSES } from "../../worker/agent/monitor";
import { createIncident, DEMO_CHANGED, ERROR_TEXT, notifyIncidentsChanged, parseRateLimited } from "../lib/api";
import { otherHost, runNote } from "../lib/incident";
import { postmortemButton } from "../lib/postmortem";
import { ChatPane } from "./ChatPane";
import { loadingProps } from "./CtaButton";
import { DashedLoader } from "./DashedLoader";
import { Composer } from "./Composer";
import { PostmortemDialog } from "./PostmortemDialog";
import { CategoryPill, IncidentStatusBadge } from "./StatusBadge";

export function IncidentView({ id }: { id: string }) {
  const { state, feed, role, notFound, send, getEvidence, decide, resolve, markRead, generatePostmortem, getPostmortem, postmortemStream } = useIncident(id);
  const [, navigate] = useLocation();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const knownIds = useMemo(() => new Set(state?.checks.map((c) => c.evidenceId) ?? []), [state?.checks]);
  const host = state ? new URL(state.target).hostname : "";
  const other = state ? otherHost(text, host) : null;
  const status = state?.status;

  const [resolving, setResolving] = useState(false);
  const [postmortemOpen, setPostmortemOpen] = useState(false);
  const rateLimited = useRateLimitToast();

  // Seen it (FR-50): the owner marks the incident read on open and whenever new activity arrives while the tab
  // is visible; then the sidebar reloads, which also keeps its status badge in step.
  const visible = usePageVisible();
  const replies = state?.messages.filter((m) => m.role === "assistant").length ?? 0;
  useEffect(() => {
    if (!status) return;
    if (role !== "owner" || !visible) {
      notifyIncidentsChanged();
      return;
    }
    markRead()
      .catch(() => undefined)
      .finally(notifyIncidentsChanged);
  }, [status, replies, role, visible, markRead]);

  // A finished demo restore changed the demo's mode: the DemoPanel reloads it.
  const restored = state?.approvals.filter((a) => a.actionId === "restore_demo_service" && a.outcome && a.status === "approved").length ?? 0;
  useEffect(() => {
    if (restored) window.dispatchEvent(new Event(DEMO_CHANGED));
  }, [restored]);

  if (notFound) {
    return <p className="m-auto p-8 text-(--cf-fg-muted)">This incident doesn't exist.</p>;
  }
  if (!state) {
    return (
      <div className="m-auto flex items-center gap-2 p-8 text-(--cf-fg-muted)">
        <DashedLoader label={null} /> Connecting…
      </div>
    );
  }

  const viewer = role === "viewer";
  const note = runNote(state.timeline);
  const pm = postmortemButton(role, state.status, state.hasPostmortem);

  const onSend = async (message: string) => {
    setError(null);
    try {
      await send(message);
      setText("");
    } catch (e) {
      const message = (e as Error).message;
      const retryAfter = parseRateLimited(message);
      if (retryAfter !== null) setError(rateLimited(retryAfter));
      else setError(message.includes("run_active") ? "Still working on the last question. Try again when it finishes." : "Couldn't send that. Try again.");
    }
  };

  const newIncidentFor = async () => {
    const r = await createIncident(text);
    if (!r.ok) return setError(r.error === "rate_limited" ? rateLimited(r.retryAfter) : ERROR_TEXT[r.error]);
    setText("");
    notifyIncidentsChanged();
    navigate(`/i/${r.id}`);
  };

  return (
    // shrink-0: as a flex child of the scrolling <main> it would otherwise shrink to one screen, and the
    // sticky header and composer would scroll away with it.
    <div className="flex min-h-full shrink-0 flex-col">
      <div className="sticky top-0 z-30 border-b border-(--cf-border) bg-(--cf-bg-100) px-4 py-3">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2">
          <h1 className="min-w-0 truncate font-mono text-base">{state.target}</h1>
          <IncidentStatusBadge status={state.status} />
          {state.category && <CategoryPill category={state.category} />}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {viewer && (
              <Badge variant="neutral" icon={<EyeIcon aria-hidden size={14} />}>
                View only
              </Badge>
            )}
            {role === "owner" && state.status !== "resolved" && (
              <Button
                size="sm"
                variant="secondary"
                {...loadingProps(resolving, CheckCircleIcon)}
                onClick={() => {
                  setResolving(true);
                  resolve()
                    .catch(() => setError("Couldn't resolve the incident. Try again."))
                    .finally(() => setResolving(false));
                }}
              >
                Resolve
              </Button>
            )}
            {pm.show && (
              <Button
                size="sm"
                variant="secondary"
                icon={FileTextIcon}
                disabled={!!pm.disabledReason}
                title={pm.disabledReason ?? undefined}
                aria-describedby={pm.disabledReason ? "postmortem-reason" : undefined}
                onClick={() => setPostmortemOpen(true)}
              >
                {pm.label}
              </Button>
            )}
            {pm.disabledReason && (
              <span id="postmortem-reason" className="sr-only">
                {pm.disabledReason}
              </span>
            )}
          </div>
        </div>
        {state.monitor && (
          <p className="mx-auto mt-1 flex max-w-3xl items-center gap-1.5 text-sm text-(--cf-fg-muted)" aria-live="polite">
            <PulseIcon aria-hidden size={14} />
            Watching after the fix: {Math.min(state.monitor.passes, MONITOR_PASSES)} of {MONITOR_PASSES} checks passed in a row · {state.monitor.ticksLeft} checks left
          </p>
        )}
      </div>

      <div className="mx-auto mt-3 flex w-full max-w-3xl flex-col gap-2 px-4">
        {viewer && <ReadOnlyBanner />}
        {state.mode === "rule_based" && (
          <Banner variant="alert" icon={<RobotIcon aria-hidden />} title="AI unavailable, rule-based diagnosis" description="The checks ran and fixed rules picked the diagnosis." />
        )}
        {note && !state.activeRunId && <Banner variant="secondary" icon={<InfoIcon aria-hidden />} description={note} />}
      </div>

      <PostmortemDialog
        open={postmortemOpen}
        onOpenChange={setPostmortemOpen}
        canWrite={role === "owner"}
        hasPostmortem={state.hasPostmortem}
        streaming={postmortemStream}
        generate={generatePostmortem}
        load={getPostmortem}
      />

      <div className="flex-1">
        <ChatPane feed={feed} knownIds={knownIds} getEvidence={getEvidence} working={!!state.activeRunId} {...(role === "owner" ? { onDecide: decide } : {})} />
      </div>

      {!viewer && (
        <div className="sticky bottom-0 z-30 bg-(--cf-bg-100) pt-2">
          <Composer
            value={text}
            onChange={setText}
            onSend={onSend}
            disabled={!!state.activeRunId || role === null}
            disabledReason={state.activeRunId ? "Working on it… you can ask a follow-up when this run finishes." : undefined}
            placeholder="Ask a follow-up, e.g. is it still failing?"
            voice
            notice={
              other ? (
                <div className="flex flex-wrap items-center gap-2 text-(--cf-fg-muted)">
                  <span>
                    That's a different host, and checks stay on <span className="font-mono">{host}</span>.
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => void newIncidentFor()}>
                    New incident for <span className="font-mono">{other}</span>
                  </Button>
                </div>
              ) : (
                error && <p role="alert">{error}</p>
              )
            }
          />
        </div>
      )}
    </div>
  );
}

export function ReadOnlyBanner() {
  return (
    <Banner
      variant="secondary"
      icon={<EyeIcon aria-hidden />}
      title="View only"
      description="You opened a shared link. You can follow this incident and open its evidence, but only its owner can ask questions or take actions."
    />
  );
}
