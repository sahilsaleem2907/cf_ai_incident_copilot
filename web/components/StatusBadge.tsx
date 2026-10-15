import { Loader } from "@cloudflare/kumo";
import {
  CheckCircleIcon,
  HandPalmIcon,
  HourglassIcon,
  MagnifyingGlassIcon,
  MinusCircleIcon,
  QuestionIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { CheckView, IncidentStatus } from "../../worker/agent/state";
import { CATEGORY_TEXT, STATUS_TEXT } from "../lib/incident";
import { categoryTone, CHECK_TONE, INCIDENT_TONE, type Tone } from "../lib/status";

type PillProps = { tone: Tone; icon?: ReactNode; size?: "sm" | "base"; className?: string; children: ReactNode };

/** A soft status pill: coloured text and icon on a light tint of the same colour (TDD §12.2). */
export function StatusPill({ tone, icon, size = "base", className = "", children }: PillProps) {
  const sizing = size === "sm" ? "gap-0.5 px-1.5 text-[11px] leading-4" : "gap-1 px-2 py-0.5 text-xs";
  return (
    <span className={`status-pill tone-${tone} inline-flex w-fit shrink-0 items-center rounded-full font-medium whitespace-nowrap ${sizing} ${className}`}>
      {icon}
      {children}
    </span>
  );
}

/** Check status with an icon **and** text, never colour alone (TDD §12.4). */
const CHECK: Record<CheckView["status"], { text: string; icon: ReactNode }> = {
  pending: { text: "Pending", icon: <HourglassIcon aria-hidden size={14} /> },
  running: { text: "Running", icon: <Loader size={12} /> },
  pass: { text: "Pass", icon: <CheckCircleIcon aria-hidden size={14} weight="fill" /> },
  fail: { text: "Fail", icon: <XCircleIcon aria-hidden size={14} weight="fill" /> },
  error: { text: "Error", icon: <WarningCircleIcon aria-hidden size={14} weight="fill" /> },
  unavailable: { text: "Unavailable", icon: <MinusCircleIcon aria-hidden size={14} /> },
};

export function StatusBadge({ status }: { status: CheckView["status"] }) {
  const s = CHECK[status];
  return (
    <StatusPill tone={CHECK_TONE[status]} icon={s.icon}>
      {s.text}
    </StatusPill>
  );
}

const INCIDENT_ICON: Record<IncidentStatus, (size: number) => ReactNode> = {
  investigating: (size) => <MagnifyingGlassIcon aria-hidden size={size} weight="bold" />,
  awaiting_approval: (size) => <HandPalmIcon aria-hidden size={size} weight="fill" />,
  mitigated: (size) => <ShieldCheckIcon aria-hidden size={size} weight="fill" />,
  resolved: (size) => <CheckCircleIcon aria-hidden size={size} weight="fill" />,
};

export function IncidentStatusBadge({ status, size = "base" }: { status: IncidentStatus; size?: "sm" | "base" }) {
  return (
    <StatusPill tone={INCIDENT_TONE[status]} size={size} icon={INCIDENT_ICON[status](size === "sm" ? 11 : 14)}>
      {STATUS_TEXT[status]}
    </StatusPill>
  );
}

const CATEGORY_ICON: Record<ReturnType<typeof categoryTone>, ReactNode> = {
  green: <CheckCircleIcon aria-hidden size={14} weight="fill" />,
  grey: <QuestionIcon aria-hidden size={14} weight="bold" />,
  red: <XCircleIcon aria-hidden size={14} weight="fill" />,
};

/** The diagnosis category next to the incident status, e.g. "Origin 5xx" in red, "Healthy" in green. */
export function CategoryPill({ category }: { category: string }) {
  const tone = categoryTone(category);
  return (
    <StatusPill tone={tone} icon={CATEGORY_ICON[tone]}>
      <span className="sr-only">Diagnosis: </span>
      {CATEGORY_TEXT[category] ?? category}
    </StatusPill>
  );
}
