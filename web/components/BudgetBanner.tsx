import { Banner } from "@cloudflare/kumo";
import { RobotIcon } from "@phosphor-icons/react";

/** Header banner while the daily neuron budget guard is on (TDD §11). Text and icon, not colour alone. */
export function BudgetBanner() {
  return (
    <Banner
      variant="alert"
      size="sm"
      icon={<RobotIcon aria-hidden />}
      title="Daily AI budget used up"
      description="New diagnoses use built-in rules instead of AI until 00:00 UTC. The checks still run."
      className="rounded-none border-x-0 border-b-0"
    />
  );
}
