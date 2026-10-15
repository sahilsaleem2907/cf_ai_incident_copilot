import { Route, Switch } from "wouter";
import { IncidentView } from "./components/IncidentView";
import { NewIncident } from "./components/NewIncident";
import { isId } from "../worker/lib/ids";

/** `/` starts an incident; `/i/:id` opens one (TDD §12). */
export function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={NewIncident} />
      <Route path="/i/:id">{(p) => (isId(p.id) ? <IncidentView key={p.id} id={p.id} /> : <NotFound />)}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function NotFound() {
  return <p className="m-auto p-8 text-(--cf-fg-muted)">Page not found.</p>;
}
