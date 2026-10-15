import { Sidebar } from "@cloudflare/kumo";
import { EyeIcon } from "@phosphor-icons/react";
import { useCallback } from "react";
import { useLocation } from "wouter";
import { useIncidents } from "../hooks/useIncidents";
import { showIncidentNotification } from "../hooks/useNotifications";
import type { IncidentRow } from "../lib/api";
import { IncidentStatusBadge, StatusPill } from "./StatusBadge";

/**
 * The workspace's incidents (D16, FR-50): polled every 10 s while the tab is visible. Unread ones get an orange
 * dot and a bold host ("New" for screen readers); each shows its status pill; watch-opened ones say "Watch". A row that turns unread raises a browser notification
 * (if allowed), unless it's the incident already open in a visible tab.
 */
export function IncidentSidebar() {
  const [location, navigate] = useLocation();

  const onNewUnread = useCallback(
    (rows: IncidentRow[]) => {
      for (const r of rows) {
        if (location === `/i/${r.id}` && document.visibilityState === "visible") continue;
        showIncidentNotification(r, (id) => navigate(`/i/${id}`));
      }
    },
    [location, navigate],
  );
  const rows = useIncidents(location, onNewUnread);

  if (rows === null) return null;
  const unread = rows.filter((r) => r.unread).length;

  return (
    <Sidebar.Group>
      <Sidebar.GroupLabel>
        <span className="flex items-center gap-1.5">
          <span className="section-label">Incidents</span>
          {unread > 0 && (
            <StatusPill tone="orange" size="sm">
              {unread} new
            </StatusPill>
          )}
        </span>
      </Sidebar.GroupLabel>
      {rows.length === 0 && <p className="px-3 py-1 text-sm text-(--cf-fg-muted)">No incidents yet.</p>}
      <Sidebar.Menu>
        {rows.map((r) => {
          const host = safeHost(r.target);
          return (
            <Sidebar.MenuItem key={r.id}>
              <Sidebar.MenuButton href={`/i/${r.id}`} active={location === `/i/${r.id}`} className="h-auto py-1.5">
                <span className="flex min-w-0 flex-col gap-1">
                  <span className={`flex items-center gap-1.5 truncate font-mono text-xs ${r.unread ? "font-semibold" : ""}`}>
                    {r.unread && (
                      <>
                        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-cf-orange" />
                        <span className="sr-only">New:</span>
                      </>
                    )}
                    <span className="truncate">{host}</span>
                  </span>
                  <span className="flex items-center gap-1 text-xs text-(--cf-fg-muted)">
                    <IncidentStatusBadge status={r.status} size="sm" />
                    {r.origin === "watch" && (
                      <>
                        {" · "}
                        <EyeIcon aria-hidden size={12} /> Watch
                      </>
                    )}
                  </span>
                </span>
              </Sidebar.MenuButton>
            </Sidebar.MenuItem>
          );
        })}
      </Sidebar.Menu>
    </Sidebar.Group>
  );
}

function safeHost(target: string): string {
  try {
    const u = new URL(target);
    return u.pathname.length > 1 ? `${u.hostname}${u.pathname}` : u.hostname;
  } catch {
    return target;
  }
}
