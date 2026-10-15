import { Badge, Loader } from "@cloudflare/kumo";
import { CheckCircleIcon, HourglassIcon, MinusCircleIcon, WarningCircleIcon, XCircleIcon } from "@phosphor-icons/react";
import type { CheckView, IncidentStatus } from "../../worker/agent/state";
import { STATUS_TEXT } from "../lib/incident";

type Variant = "success" | "error" | "warning" | "neutral" | "outline" | "info";

/** Check status with an icon **and** text, never colour alone (TDD §12.4). */
const CHECK: Record<CheckView["status"], { text: string; variant: Variant; icon: React.ReactNode }> = {
  pending: { text: "Pending", variant: "outline", icon: <HourglassIcon aria-hidden size={14} /> },
  running: { text: "Running", variant: "info", icon: <Loader size={12} /> },
  pass: { text: "Pass", variant: "success", icon: <CheckCircleIcon aria-hidden size={14} weight="fill" /> },
  fail: { text: "Fail", variant: "error", icon: <XCircleIcon aria-hidden size={14} weight="fill" /> },
  error: { text: "Error", variant: "warning", icon: <WarningCircleIcon aria-hidden size={14} weight="fill" /> },
  unavailable: { text: "Unavailable", variant: "neutral", icon: <MinusCircleIcon aria-hidden size={14} /> },
};

export function StatusBadge({ status }: { status: CheckView["status"] }) {
  const s = CHECK[status];
  return (
    <Badge variant={s.variant} icon={s.icon}>
      {s.text}
    </Badge>
  );
}

const INCIDENT: Record<IncidentStatus, Variant> = {
  investigating: "info",
  awaiting_approval: "warning",
  mitigated: "outline",
  resolved: "success",
};

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  return <Badge variant={INCIDENT[status]}>{STATUS_TEXT[status]}</Badge>;
}
