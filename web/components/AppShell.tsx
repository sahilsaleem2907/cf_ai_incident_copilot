import { CloudflareLogo, Sidebar } from "@cloudflare/kumo";
import { CaretRightIcon, GithubLogoIcon, HeartIcon, PlusIcon } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { BudgetBanner } from "./BudgetBanner";
import { CtaLinkButton } from "./CtaButton";
import { NotificationToggle } from "./NotificationToggle";

const REPO_URL = "https://github.com/sahilsaleem2907/cf_ai_incident_copilot";
const AUTHOR_URL = "https://github.com/sahilsaleem2907";

type Props = {
  /** Incident list and webhook settings (WP-10, WP-19). */
  sidebar?: ReactNode;
  /** Right column (DemoPanel, WatchlistPanel). Below `lg` it collapses into a disclosure at the top of <main>. */
  aside?: ReactNode;
  children?: ReactNode;
  /** From `/api/session`: "rule_based" shows the BudgetBanner under the title bar. */
  budgetMode?: "ai" | "rule_based";
};

export function AppShell({ sidebar, aside, children, budgetMode }: Props) {
  // Mounted in one place only, so the panel keeps one copy of its state.
  const wide = useMediaQuery("(min-width: 1024px)");
  return (
    <div className="flex h-dvh flex-col">
      <header className="shrink-0 border-b border-(--cf-border) bg-(--cf-bg-200)">
        <div className="flex h-14 items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-cf-orange">
            <CloudflareLogo variant="glyph" aria-hidden className="h-6 w-auto" />
            <span aria-hidden className="text-(--cf-fg-muted)">
              ×
            </span>
            <span className="font-display text-lg font-medium">Incident Copilot</span>
          </Link>
          <div className="flex items-center gap-3">
            <NotificationToggle />
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub"
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-(--cf-fg-muted) hover:text-(--cf-fg) focus-visible:outline-2 focus-visible:outline-cf-orange"
            >
              <GithubLogoIcon aria-hidden size={18} />
              <span className="max-sm:hidden">GitHub</span>
            </a>
          </div>
        </div>
        {budgetMode === "rule_based" && <BudgetBanner />}
      </header>

      {/* Below 768px the sidebar becomes a sheet, opened from the trigger at the top of <main>. */}
      <Sidebar.Provider contained defaultOpen collapsible="offcanvas" mobileBreakpoint={768} className="min-h-0 flex-1">
        <Sidebar aria-label="Incidents">
          <Sidebar.Header>
            <CtaLinkButton href="/" icon={PlusIcon} className="w-full">
              New incident
            </CtaLinkButton>
          </Sidebar.Header>
          <Sidebar.Content>{sidebar}</Sidebar.Content>
        </Sidebar>

        <main className="bg-dot-grid flex min-w-0 flex-1 flex-col overflow-y-auto bg-(--cf-bg-100)">
          <div className="border-b border-(--cf-border) px-2 py-1 md:hidden">
            <Sidebar.Trigger aria-label="Show incidents" />
          </div>
          {!wide && aside && <NarrowAside>{aside}</NarrowAside>}
          {children}
        </main>

        {wide && aside && (
          <aside aria-label="Demo and watchlist" className="w-80 shrink-0 overflow-y-auto border-l border-(--cf-border) bg-(--cf-bg-200) p-4">
            {aside}
          </aside>
        )}
      </Sidebar.Provider>

      <footer className="shrink-0 border-t border-(--cf-border) bg-(--cf-bg-200) px-4 py-2 text-center text-xs text-(--cf-fg-muted)">
        Built on Cloudflare, with <HeartIcon aria-hidden size={12} weight="fill" className="inline align-[-1px] text-cf-orange" />
        <span className="sr-only">love</span> from{" "}
        <a
          href={AUTHOR_URL}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-(--cf-fg) focus-visible:outline-2 focus-visible:outline-cf-orange"
        >
          Sahil
        </a>
      </footer>
    </div>
  );
}

/** The right column below `lg`: closed by default so the chat stays first. */
function NarrowAside({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <aside aria-label="Demo and watchlist" className="border-b border-(--cf-border) bg-(--cf-bg-200)">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="narrow-aside"
        className="flex w-full items-center gap-1.5 px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-cf-orange"
      >
        <CaretRightIcon aria-hidden size={12} className={open ? "rotate-90 transition-transform" : "transition-transform"} />
        Demo & watchlist
      </button>
      <div id="narrow-aside" hidden={!open} className="px-4 pb-4">
        {children}
      </div>
    </aside>
  );
}
