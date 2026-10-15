import { LinkProvider, type LinkComponentProps } from "@cloudflare/kumo";
import { forwardRef, useEffect } from "react";
import { Link } from "wouter";
import { AppShell } from "./components/AppShell";
import { IncidentSidebar } from "./components/IncidentSidebar";
import { getSession } from "./lib/api";
import { AppRoutes } from "./routes";

/** Kumo links (sidebar items, link buttons) navigate inside the app instead of reloading. */
const AppLink = forwardRef<HTMLAnchorElement, LinkComponentProps>(({ href, to, ...rest }, ref) => <Link ref={ref} href={href ?? to ?? "/"} {...rest} />);
AppLink.displayName = "AppLink";

export function App() {
  // Creates the workspace cookie up front, so the first WebSocket already carries it.
  useEffect(() => void getSession(), []);
  return (
    <LinkProvider component={AppLink}>
      <AppShell sidebar={<IncidentSidebar />} aside={<h2 className="text-sm text-(--cf-fg-muted)">Demo service</h2>}>
        <AppRoutes />
      </AppShell>
    </LinkProvider>
  );
}
