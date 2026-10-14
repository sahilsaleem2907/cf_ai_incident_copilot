import { AppShell } from "./components/AppShell";

export function App() {
  return (
    <AppShell aside={<h2 className="text-sm text-(--cf-fg-muted)">Demo service</h2>}>
      <div className="m-auto max-w-md p-8 text-center">
        <h1 className="text-2xl">What's broken?</h1>
        <p className="mt-2 text-(--cf-fg-muted)">
          Name a host to start an incident, e.g. <span className="font-mono">cloudflare.com</span>.
        </p>
      </div>
    </AppShell>
  );
}
