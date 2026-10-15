import { CodeBlock, Surface } from "@cloudflare/kumo";
import { CaretRightIcon, CertificateIcon, GlobeIcon, ListMagnifyingGlassIcon, PulseIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { CheckView } from "../../worker/agent/state";
import type { ToolName } from "../../worker/tools/types";
import type { Evidence } from "../hooks/useIncident";
import { DashedLoader } from "./DashedLoader";
import { StatusBadge } from "./StatusBadge";

const ICONS: Record<ToolName, typeof GlobeIcon> = {
  dns_lookup: ListMagnifyingGlassIcon,
  http_probe: GlobeIcon,
  cert_info: CertificateIcon,
  provider_status: PulseIcon,
};

type Props = { check: CheckView; status: CheckView["status"]; getEvidence: (id: string) => Promise<Evidence | null> };

/** One check: tool, evidence ID, status and summary; the raw evidence loads on first expand (TDD §12.2). */
export function CheckCard({ check, status, getEvidence }: Props) {
  const [open, setOpen] = useState(false);
  const [evidence, setEvidence] = useState<Evidence | null | "loading" | "error">(null);
  const Icon = ICONS[check.tool];
  const finished = status !== "pending" && status !== "running";

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && (evidence === null || evidence === "error")) {
      setEvidence("loading");
      try {
        setEvidence((await getEvidence(check.evidenceId)) ?? "error");
      } catch {
        setEvidence("error");
      }
    }
  };

  return (
    <Surface id={`check-${check.evidenceId}`} tabIndex={-1} className="min-w-0 rounded-lg border border-(--cf-border) outline-none">
      <div className="flex items-start gap-3 p-3">
        <Icon aria-hidden size={18} className="mt-0.5 shrink-0 text-(--cf-fg-muted)" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{check.label}</span>
            <span className="font-mono text-xs text-(--cf-fg-muted)">{check.evidenceId}</span>
            <StatusBadge status={status} />
          </div>
          {check.summary && <p className="mt-1 font-mono text-xs break-words text-(--cf-fg-muted)">{check.summary}</p>}
        </div>
        {finished && (
          <button
            type="button"
            onClick={() => void toggle()}
            aria-expanded={open}
            aria-controls={`evidence-${check.evidenceId}`}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-(--cf-fg-muted) hover:text-(--cf-fg) focus-visible:outline-2 focus-visible:outline-cf-orange"
          >
            <CaretRightIcon aria-hidden size={12} className={open ? "rotate-90 transition-transform" : "transition-transform"} />
            Evidence
          </button>
        )}
      </div>
      {open && (
        <div id={`evidence-${check.evidenceId}`} className="min-w-0 border-t border-(--cf-border) p-3">
          {evidence === "loading" && <DashedLoader label="Loading evidence" />}
          {evidence === "error" && <p className="text-sm text-(--cf-fg-muted)">Couldn't load this evidence.</p>}
          {evidence && typeof evidence === "object" && (
            // Long lines wrap and the box stops at about 20 lines, scrolling inside, so it never leaves the card.
            <div className="max-h-80 min-w-0 overflow-auto rounded-md [&_pre]:break-words [&_pre]:whitespace-pre-wrap">
              <CodeBlock lang="jsonc" code={JSON.stringify(evidence.raw, null, 2)} />
            </div>
          )}
        </div>
      )}
    </Surface>
  );
}
