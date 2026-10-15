import { Button, Input, Sidebar } from "@cloudflare/kumo";
import { CheckCircleIcon, ClockIcon, EyeIcon, TrashIcon, WarningIcon, XCircleIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "wouter";
import { addWatch, deleteWatch, listWatches, notifyIncidentsChanged, WATCH_ERROR_TEXT, type Watch } from "../lib/api";

/** How often the panel reloads while the tab is visible: it shows each check's result and spots auto-opened incidents. */
const POLL_MS = 15_000;

/**
 * The watchlist (FR-40, TDD §12.1): add a URL, see each watch's last check, remove it. Cron checks them; when a
 * failure is confirmed an incident opens by itself, and this panel tells the incident list to reload.
 */
export function WatchlistPanel({ demoUrl }: { demoUrl?: string }) {
  const [watches, setWatches] = useState<Watch[] | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const openIds = useRef<string | null>(null);

  const apply = useCallback((w: Watch[] | null) => {
    if (!w) return;
    setWatches(w);
    // A watch that just opened (or closed) an incident: the sidebar's list should show it now (polling is WP-19).
    const ids = w.map((x) => x.openIncidentId ?? "").join(",");
    if (openIds.current !== null && openIds.current !== ids) notifyIncidentsChanged();
    openIds.current = ids;
  }, []);
  const load = useCallback(() => listWatches().then(apply), [apply]);

  useEffect(() => {
    void listWatches().then(apply);
    const onVisible = () => document.visibilityState === "visible" && void listWatches().then(apply);
    const timer = setInterval(onVisible, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [apply]);

  const add = async (target: string) => {
    if (!target.trim() || busy) return;
    setBusy(true);
    setError(null);
    const r = await addWatch(target.trim());
    setBusy(false);
    if (!r.ok) return setError(r.message ?? WATCH_ERROR_TEXT[r.error]);
    setUrl("");
    await load();
  };

  const remove = async (w: Watch) => {
    setError(null);
    if (!(await deleteWatch(w.id))) return setError("Couldn't remove that watch. Try again.");
    await load();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void add(url);
  };

  const demoWatched = !!demoUrl && !!watches?.some((w) => w.url === demoUrl);

  return (
    <Sidebar.Group>
      <Sidebar.GroupLabel>Watchlist</Sidebar.GroupLabel>
      {/* The sidebar keeps text on one line; errors and hints here need to wrap. */}
      <div className="flex flex-col gap-2 px-2 pb-2 break-words whitespace-normal">
        <form onSubmit={onSubmit} className="flex items-end gap-1.5">
          <Input
            label="Watch a URL"
            size="sm"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="api.example.com"
            className="min-w-0 font-mono"
          />
          <Button type="submit" size="sm" icon={EyeIcon} loading={busy} disabled={!url.trim()}>
            Watch
          </Button>
        </form>
        {demoUrl && !demoWatched && (
          <Button size="xs" variant="ghost" className="w-fit" disabled={busy} onClick={() => void add(demoUrl)}>
            Watch my demo
          </Button>
        )}
        {error && (
          <p role="alert" className="text-xs text-(--cf-fg)">
            {error}
          </p>
        )}

        {watches && watches.length === 0 && <p className="text-xs text-(--cf-fg-muted)">Nothing watched yet. Checks run every few minutes for 24 hours.</p>}
        {watches && watches.length > 0 && (
          <ul className="flex flex-col gap-1.5" aria-label="Watched URLs">
            {watches.map((w) => (
              <li key={w.id} className="flex items-start gap-1 rounded-md border border-(--cf-border) px-2 py-1.5">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-mono text-xs" title={w.url}>
                    {shortUrl(w.url)}
                  </span>
                  <WatchStatus watch={w} />
                  <span className="text-xs text-(--cf-fg-muted)">
                    {w.intervalSec <= 60 ? "Every minute" : `Every ${Math.round(w.intervalSec / 60)} min`} · {expiresIn(w.expiresAt)}
                  </span>
                </div>
                <Button
                  size="xs"
                  variant="ghost"
                  shape="square"
                  icon={TrashIcon}
                  aria-label={`Stop watching ${shortUrl(w.url)}`}
                  title="Stop watching"
                  onClick={() => void remove(w)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sidebar.Group>
  );
}

/** Icon and words, never colour alone (TDD §12.4). */
function WatchStatus({ watch: w }: { watch: Watch }) {
  let icon: ReactNode;
  let text: ReactNode;
  if (w.openIncidentId) {
    icon = <WarningIcon aria-hidden size={14} />;
    text = (
      <Link href={`/i/${w.openIncidentId}`} className="underline underline-offset-2 hover:text-(--cf-fg) focus-visible:outline-2 focus-visible:outline-cf-orange">
        Incident open
      </Link>
    );
  } else if (w.lastStatus === "fail") {
    icon = <XCircleIcon aria-hidden size={14} />;
    text = "Last check failed";
  } else if (w.lastStatus === "pass") {
    icon = <CheckCircleIcon aria-hidden size={14} />;
    text = "Passing";
  } else {
    icon = <ClockIcon aria-hidden size={14} />;
    text = "Not checked yet";
  }
  return (
    <span className="flex items-center gap-1 text-xs">
      {icon}
      {text}
    </span>
  );
}

export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.length > 1 ? `${u.hostname}${u.pathname}` : u.hostname;
  } catch {
    return url;
  }
}

export function expiresIn(expiresAt: number, now: number = Date.now()): string {
  const hours = Math.ceil((expiresAt - now) / 3_600_000);
  return hours <= 1 ? "ends within the hour" : `ends in ${hours} h`;
}
