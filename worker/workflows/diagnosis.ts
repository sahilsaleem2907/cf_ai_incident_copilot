import type { Agent } from "agents";
import { AgentWorkflow, WorkflowRejectedError, type AgentWorkflowEvent, type AgentWorkflowStep } from "agents/workflows";
import { APPROVAL_TIMEOUT, type IncidentAgent } from "../agent/IncidentAgent";
import { callLlm, llmDeps } from "../llm/client";
import { diagnose, type RunIO, type RunSummary } from "../loop/plan";
import { devAllowOrigin } from "../safety/ssrf";
import { runTool } from "../tools/registry";

export type DiagnosisParams = { incidentId: string; runId: string };

/**
 * One bounded diagnosis run (D3, TDD §8.2). All decisions live in `loop/plan.ts`; this class only maps
 * them onto durable steps, the incident's agent and the bindings. Steps retry with backoff; tool steps
 * spend subrequest budget on every retry, so they get the same small limit.
 */
export class DiagnosisWorkflow extends AgentWorkflow<Agent, DiagnosisParams> {
  override async run(event: AgentWorkflowEvent<DiagnosisParams>, step: AgentWorkflowStep): Promise<RunSummary> {
    // `AgentWorkflow` only types agents with `unknown` state, so the stub is narrowed here once.
    const agent = this.agent as unknown as DurableObjectStub<IncidentAgent>;
    const env = this.env;
    const deps = llmDeps(env);
    const allowOrigin = devAllowOrigin(env);

    const io: RunIO = {
      step: <T>(name: string, fn: () => Promise<T>, opts?: { retries?: number }) =>
        step.do(name, { retries: { limit: opts?.retries ?? 2, delay: "1 second", backoff: "exponential" } }, fn as () => Promise<never>) as Promise<T>,
      now: () => Date.now(),
      agent: {
        getRunContext: (runId) => agent.getRunContext(runId),
        addPendingChecks: (runId, turn, calls) => agent.addPendingChecks(runId, turn, calls),
        recordCheck: (id, result) => agent.recordCheck(id, result),
        ruleFindings: (runId, args) => agent.ruleFindings(runId, args),
        setFindings: (runId, findings, mode) => agent.setFindings(runId, findings, mode),
        narrate: (runId) => agent.narrate(runId),
        finishRun: (runId, status, stats) => agent.finishRun(runId, status, stats),
        proposeAction: (runId, workflowId) => agent.proposeAction(runId, workflowId),
        recordApprovalOutcome: (approvalId, decision, detail) => agent.recordApprovalOutcome(approvalId, decision, detail),
        executeAction: (approvalId) => agent.executeAction(approvalId),
        afterAction: (runId, approvalId) => agent.afterAction(runId, approvalId),
      },
      llm: (req) => callLlm(deps, req),
      tool: async (name, args, evidenceId, scope) => {
        const out = await runTool(name, args, { fetch: (input, init) => fetch(input, init), evidenceId, ...(allowOrigin ? { allowOrigin } : {}) }, scope);
        if (!out.ok) throw new Error(out.invalid);
        return { result: out.result, subrequests: out.subrequests };
      },
      // `this.instanceId` is undefined in agents 0.28.1 (TDD §8.2).
      workflowId: this.workflowId,
      // Spike rule (TDD §8.2): WorkflowRejectedError → rejected; any other error from the wait → expired.
      waitForApproval: async () => {
        try {
          await this.waitForApproval(step, { timeout: APPROVAL_TIMEOUT });
          return "approved";
        } catch (e) {
          return e instanceof WorkflowRejectedError ? "rejected" : "expired";
        }
      },
    };
    return diagnose(io, event.payload.runId);
  }
}
