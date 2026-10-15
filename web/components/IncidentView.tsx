import { Badge, Banner, Button, Loader } from "@cloudflare/kumo";
import { EyeIcon, InfoIcon, RobotIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useIncident } from "../hooks/useIncident";
import { createIncident, ERROR_TEXT, notifyIncidentsChanged } from "../lib/api";
import { CATEGORY_TEXT, otherHost, runNote } from "../lib/incident";
import { ChatPane } from "./ChatPane";
import { Composer } from "./Composer";
import { IncidentStatusBadge } from "./StatusBadge";

export function IncidentView({ id }: { id: string }) {
  const { state, feed, role, notFound, send, getEvidence } = useIncident(id);
  const [, navigate] = useLocation();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const knownIds = useMemo(() => new Set(state?.checks.map((c) => c.evidenceId) ?? []), [state?.checks]);
  const host = state ? new URL(state.target).hostname : "";
  const other = state ? otherHost(text, host) : null;
  const status = state?.status;

  // Keep the sidebar's badge in step with the open incident.
  useEffect(() => {
    if (status) notifyIncidentsChanged();
  }, [status]);

  if (notFound) {
    return <p className="m-auto p-8 text-(--cf-fg-muted)">This incident doesn't exist.</p>;
  }
  if (!state) {
    return (
      <div className="m-auto flex items-center gap-2 p-8 text-(--cf-fg-muted)">
        <Loader size={16} /> Connecting…
      </div>
    );
  }

  const viewer = role === "viewer";
  const note = runNote(state.timeline);

  const onSend = async (message: string) => {
    setError(null);
    try {
      await send(message);
      setText("");
    } catch (e) {
      setError((e as Error).message.includes("run_active") ? "Still working on the last question. Try again when it finishes." : "Couldn't send that. Try again.");
    }
  };

  const newIncidentFor = async () => {
    const r = await createIncident(text);
    if (!r.ok) return setError(ERROR_TEXT[r.error]);
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
          {state.category && <span className="text-sm text-(--cf-fg-muted)">· {CATEGORY_TEXT[state.category] ?? state.category}</span>}
          {viewer && (
            <Badge variant="neutral" icon={<EyeIcon aria-hidden size={14} />} className="ml-auto">
              View only
            </Badge>
          )}
        </div>
      </div>

      <div className="mx-auto mt-3 flex w-full max-w-3xl flex-col gap-2 px-4">
        {viewer && <ReadOnlyBanner />}
        {state.mode === "rule_based" && (
          <Banner variant="alert" icon={<RobotIcon aria-hidden />} title="AI unavailable, rule-based diagnosis" description="The checks ran and fixed rules picked the diagnosis." />
        )}
        {note && !state.activeRunId && <Banner variant="secondary" icon={<InfoIcon aria-hidden />} description={note} />}
      </div>

      <div className="flex-1">
        <ChatPane feed={feed} knownIds={knownIds} getEvidence={getEvidence} />
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
