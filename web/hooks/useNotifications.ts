import { useCallback, useState } from "react";
import type { IncidentRow } from "../lib/api";
import { STATUS_TEXT } from "../lib/incident";

export type Permission = NotificationPermission | "unsupported";

const supported = () => typeof window !== "undefined" && "Notification" in window;
export const currentPermission = (): Permission => (supported() ? Notification.permission : "unsupported");

/** Browser notification permission (FR-51). It's only ever requested from a button click. */
export function useNotificationPermission(): [Permission, () => Promise<void>] {
  const [permission, setPermission] = useState<Permission>(currentPermission);
  const request = useCallback(async () => {
    if (!supported()) return;
    setPermission(await Notification.requestPermission());
  }, []);
  return [permission, request];
}

/** The notification's text: "<host> · <status>", plus "(watch)" for an incident a watch opened. */
export function notificationBody(row: Pick<IncidentRow, "target" | "status" | "origin">): string {
  let host = row.target;
  try {
    host = new URL(row.target).hostname;
  } catch {
    // keep the raw target
  }
  return `${host} · ${STATUS_TEXT[row.status]}${row.origin === "watch" ? " (watch)" : ""}`;
}

/** One notification per incident (`tag` replaces an older one); clicking it brings the tab back and opens it. */
export function showIncidentNotification(row: IncidentRow, open: (id: string) => void): void {
  if (currentPermission() !== "granted") return;
  const n = new Notification("Incident Copilot", { body: notificationBody(row), tag: row.id });
  n.onclick = () => {
    window.focus();
    open(row.id);
    n.close();
  };
}
