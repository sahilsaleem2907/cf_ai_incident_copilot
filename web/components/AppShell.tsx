import { LinkButton, Sidebar } from "@cloudflare/kumo";
import { GithubLogoIcon, PlusIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

const REPO_URL = "https://github.com/sahilsaleem2907/cf_ai_incident_copilot";

type Props = {
  /** Incident list, watchlist and webhook settings (WP-10, WP-18, WP-19). */
  sidebar?: ReactNode;
  /** Right column, e.g. DemoPanel (WP-11). Hidden below `lg`. */
  aside?: ReactNode;
  children?: ReactNode;
};

export function AppShell({ sidebar, aside, children }: Props) {
  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-(--cf-border) bg-(--cf-bg-200) px-4">
        <span className="font-display text-lg font-medium">Incident Copilot</span>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-(--cf-fg-muted) hover:text-(--cf-fg) focus-visible:outline-2 focus-visible:outline-cf-orange"
        >
          <GithubLogoIcon aria-hidden size={18} />
          GitHub
        </a>
      </header>

      {/* Below 768px the sidebar becomes a sheet, opened from the trigger at the top of <main>. */}
      <Sidebar.Provider contained defaultOpen collapsible="offcanvas" mobileBreakpoint={768} className="min-h-0 flex-1">
        <Sidebar aria-label="Incidents">
          <Sidebar.Header>
            <LinkButton href="/" variant="secondary" icon={PlusIcon} className="w-full">
              New incident
            </LinkButton>
          </Sidebar.Header>
          <Sidebar.Content>{sidebar}</Sidebar.Content>
        </Sidebar>

        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-(--cf-bg-100)">
          <div className="border-b border-(--cf-border) px-2 py-1 md:hidden">
            <Sidebar.Trigger aria-label="Show incidents" />
          </div>
          {children}
        </main>

        <aside
          aria-label="Demo service"
          className="hidden w-80 shrink-0 overflow-y-auto border-l border-(--cf-border) bg-(--cf-bg-200) p-4 lg:block"
        >
          {aside}
        </aside>
      </Sidebar.Provider>

      <footer className="shrink-0 border-t border-(--cf-border) bg-(--cf-bg-200) px-4 py-2 text-xs text-(--cf-fg-muted)">
        Built on Cloudflare
      </footer>
    </div>
  );
}
