import { describe, it } from "vitest";

/**
 * Watch cron (TDD §8.5, D12). Stubs until WP-18 builds `scheduled()` and `WatchWorkflow`; the cases are the
 * ones TDD §14 lists, so WP-18 fills them in rather than deciding what to test.
 */
describe("scheduled() watch checks", () => {
  it.todo("picks due, unexpired watches only, oldest next_run first, at most 6 per tick, stopping before 50 subrequests");
  it.todo("the watch API enforces the 3-per-workspace and 30-global caps");
  it.todo("a failing check with no open incident starts WatchWorkflow with ID watch-<id>-<minute>");
  it.todo("a duplicate WatchWorkflow ID is ignored, so one failure opens one incident");
  it.todo("a check on a watch with an open incident calls reportWatchCheck(pass)");
  it.todo("expired watches are deleted");
});
