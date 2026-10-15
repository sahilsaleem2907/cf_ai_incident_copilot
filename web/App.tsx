import { LinkProvider, Toasty, type LinkComponentProps } from "@cloudflare/kumo";
import { forwardRef, useEffect, useState } from "react";
import { Link } from "wouter";
import { AppShell } from "./components/AppShell";
import { DemoPanel } from "./components/DemoPanel";
import { IncidentSidebar } from "./components/IncidentSidebar";
import { getSession, INCIDENTS_CHANGED, type Session } from "./lib/api";
import { AppRoutes } from "./routes";

/** Kumo links (sidebar items, link buttons) navigate inside the app instead of reloading. */
const AppLink = forwardRef<HTMLAnchorElement, LinkComponentProps>(({ href, to, ...rest }, ref) => <Link ref={ref} href={href ?? to ?? "/"} {...rest} />);
AppLink.displayName = "AppLink";

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  // Creates the workspace cookie up front, so the first WebSocket already carries it. Fetched again when
  // incidents change, so the budget banner appears without a reload once the guard trips.
  useEffect(() => {
    let live = true;
    const load = () => void getSession().then((s) => live && s && setSession(s));
    load();
    window.addEventListener(INCIDENTS_CHANGED, load);
    return () => {
      live = false;
      window.removeEventListener(INCIDENTS_CHANGED, load);
    };
  }, []);
  return (
    <LinkProvider component={AppLink}>
      <Toasty>
        <AppShell sidebar={<IncidentSidebar />} aside={<DemoPanel />} budgetMode={session?.budgetMode}>
          <AppRoutes />
        </AppShell>
      </Toasty>
    </LinkProvider>
  );
}
