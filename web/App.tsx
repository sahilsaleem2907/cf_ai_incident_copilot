import { LinkProvider, Loader, Toasty, type LinkComponentProps } from "@cloudflare/kumo";
import { forwardRef, useEffect, useState } from "react";
import { Link } from "wouter";
import { AppShell } from "./components/AppShell";
import { DemoPanel } from "./components/DemoPanel";
import { IncidentSidebar } from "./components/IncidentSidebar";
import { WatchlistPanel } from "./components/WatchlistPanel";
import { WebhookSettings } from "./components/WebhookSettings";
import { firstSession, getSession, INCIDENTS_CHANGED, type Session } from "./lib/api";
import { AppRoutes } from "./routes";

/** Kumo links (sidebar items, link buttons) navigate inside the app instead of reloading. */
const AppLink = forwardRef<HTMLAnchorElement, LinkComponentProps>(({ href, to, ...rest }, ref) => <Link ref={ref} href={href ?? to ?? "/"} {...rest} />);
AppLink.displayName = "AppLink";

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  // One session call creates the workspace cookie before anything else runs: each request without a cookie
  // would create its own workspace. If it fails the app still renders. Fetched again when incidents change,
  // so the budget banner appears without a reload once the guard trips.
  useEffect(() => {
    let live = true;
    const load = () => void getSession().then((s) => live && s && setSession(s));
    void firstSession().then((s) => {
      if (!live) return;
      if (s) setSession(s);
      setReady(true);
    });
    window.addEventListener(INCIDENTS_CHANGED, load);
    return () => {
      live = false;
      window.removeEventListener(INCIDENTS_CHANGED, load);
    };
  }, []);
  return (
    <LinkProvider component={AppLink}>
      <Toasty>
        <AppShell
          sidebar={
            ready && (
              <>
                <IncidentSidebar />
                <WebhookSettings />
              </>
            )
          }
          aside={
            ready && (
              <div className="flex flex-col gap-5">
                <DemoPanel />
                <hr className="divider-dashed" />
                <WatchlistPanel demoUrl={session?.demoUrl} />
              </div>
            )
          }
          budgetMode={session?.budgetMode}
        >
          {ready ? (
            <AppRoutes />
          ) : (
            <div className="m-auto flex items-center gap-2 p-8 text-(--cf-fg-muted)">
              <Loader size={16} /> Starting…
            </div>
          )}
        </AppShell>
      </Toasty>
    </LinkProvider>
  );
}
