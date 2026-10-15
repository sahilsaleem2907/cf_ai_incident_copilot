import { useEffect, useRef, useState } from "react";
import { INCIDENTS_CHANGED, listIncidents, type IncidentRow } from "../lib/api";

/** How often the sidebar reloads while the tab is visible (D16). */
export const POLL_MS = 10_000;

/**
 * Rows that are unread now but weren't on the previous load (or are new and unread). Nothing on the first
 * load, so opening the app doesn't announce every old unread incident.
 */
export function newlyUnread(previous: ReadonlyMap<string, boolean> | null, rows: IncidentRow[]): IncidentRow[] {
  if (!previous) return [];
  return rows.filter((r) => r.unread && previous.get(r.id) !== true);
}

/**
 * The workspace's incidents (D16): polled every 10 s while the tab is visible, reloaded at once when it becomes
 * visible again, on INCIDENTS_CHANGED, and when `reloadKey` changes (navigation). `onNewUnread` gets each row
 * that has just turned unread, for browser notifications.
 */
export function useIncidents(reloadKey: string, onNewUnread?: (rows: IncidentRow[]) => void): IncidentRow[] | null {
  const [rows, setRows] = useState<IncidentRow[] | null>(null);
  const seen = useRef<Map<string, boolean> | null>(null);
  const callback = useRef(onNewUnread);
  useEffect(() => {
    callback.current = onNewUnread;
  });

  useEffect(() => {
    let live = true;
    const load = () =>
      void listIncidents().then((r) => {
        if (!live) return;
        const fresh = newlyUnread(seen.current, r);
        seen.current = new Map(r.map((x) => [x.id, x.unread]));
        setRows(r);
        if (fresh.length) callback.current?.(fresh);
      });
    const onVisible = () => document.visibilityState === "visible" && load();
    load();
    const timer = setInterval(onVisible, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(INCIDENTS_CHANGED, load);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(INCIDENTS_CHANGED, load);
    };
  }, [reloadKey]);

  return rows;
}
