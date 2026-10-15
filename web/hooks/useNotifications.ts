import { useCallback, useEffect, useState } from "react";
import type { IncidentRow } from "../lib/api";
import { STATUS_TEXT } from "../lib/incident";

export type Permission = NotificationPermission | "unsupported";
/** The app's own on/off, saved in this browser: a site can't take back a permission once it's granted. */
export type Stored = "on" | "off" | null;

const KEY = "notifications";
const supported = () => typeof window !== "undefined" && "Notification" in window;
export const currentPermission = (): Permission => (supported() ? Notification.permission : "unsupported");

/** Notifications show only with the browser's permission and the switch not turned off (people who allowed them before stay on). */
export const notificationsOn = (permission: Permission, stored: Stored): boolean => permission === "granted" && stored !== "off";

function readStored(): Stored {
  try {
    const v = localStorage.getItem(KEY);
    return v === "on" || v === "off" ? v : null;
  } catch {
    return null;
  }
}

function writeStored(v: "on" | "off"): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // private mode or blocked storage: the switch still works for this page
  }
}

/**
 * The header's notifications switch (FR-51). Switching on the first time asks the browser, and only from that
 * click; after that it's the app's own setting. Permission is re-read on focus, in case it changed in browser settings.
 */
export function useNotificationSetting(): { permission: Permission; on: boolean; setOn: (on: boolean) => Promise<void> } {
  const [permission, setPermission] = useState<Permission>(currentPermission);
  const [stored, setStored] = useState<Stored>(readStored);

  useEffect(() => {
    const sync = () => setPermission(currentPermission());
    window.addEventListener("focus", sync);
    return () => window.removeEventListener("focus", sync);
  }, []);

  const setOn = useCallback(async (on: boolean) => {
    if (on && supported() && Notification.permission === "default") {
      const p = await Notification.requestPermission();
      setPermission(p);
      if (p !== "granted") return;
    }
    const v = on ? "on" : "off";
    writeStored(v);
    setStored(v);
  }, []);

  return { permission, on: notificationsOn(permission, stored), setOn };
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
  if (!notificationsOn(currentPermission(), readStored())) return;
  const n = new Notification("Incident Copilot", { body: notificationBody(row), tag: row.id });
  n.onclick = () => {
    window.focus();
    open(row.id);
    n.close();
  };
}
