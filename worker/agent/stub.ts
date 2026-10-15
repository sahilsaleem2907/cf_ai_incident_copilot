import { getAgentByName, type Agent } from "agents";
import type { IncidentAgent } from "./IncidentAgent";

/**
 * Typed RPC stub for one incident. `getAgentByName` also makes sure the agent has started (`onStart`),
 * but its type only accepts agents whose state is `unknown`, so the namespace is widened here once.
 */
export async function incidentAgent(env: Pick<Cloudflare.Env, "IncidentAgent">, id: string): Promise<DurableObjectStub<IncidentAgent>> {
  const ns = env.IncidentAgent as unknown as DurableObjectNamespace<Agent<Cloudflare.Env>>;
  return (await getAgentByName(ns, id)) as unknown as DurableObjectStub<IncidentAgent>;
}
