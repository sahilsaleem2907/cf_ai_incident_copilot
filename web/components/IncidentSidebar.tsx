import { Sidebar } from "@cloudflare/kumo";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { INCIDENTS_CHANGED, listIncidents, type IncidentRow } from "../lib/api";
import { STATUS_TEXT } from "../lib/incident";

/** The workspace's incidents. Reloads on navigation and on changes; polling and unread dots are WP-19. */
export function IncidentSidebar() {
  const [location] = useLocation();
  const [rows, setRows] = useState<IncidentRow[] | null>(null);

  useEffect(() => {
    let live = true;
    const load = () => void listIncidents().then((r) => live && setRows(r));
    load();
    window.addEventListener(INCIDENTS_CHANGED, load);
    return () => {
      live = false;
      window.removeEventListener(INCIDENTS_CHANGED, load);
    };
  }, [location]);

  if (rows === null) return null;
  if (rows.length === 0) return <p className="px-3 py-2 text-sm text-(--cf-fg-muted)">No incidents yet.</p>;

  return (
    <Sidebar.Group>
      <Sidebar.GroupLabel>Incidents</Sidebar.GroupLabel>
      <Sidebar.Menu>
        {rows.map((r) => {
          const host = safeHost(r.target);
          return (
            <Sidebar.MenuItem key={r.id}>
              <Sidebar.MenuButton href={`/i/${r.id}`} active={location === `/i/${r.id}`} className="h-auto py-1.5">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-mono text-xs">{host}</span>
                  <span className="text-xs text-(--cf-fg-muted)">{STATUS_TEXT[r.status]}</span>
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
