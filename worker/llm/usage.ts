import { NEURON_DAILY } from "../loop/budget";

/** Daily neuron accounting (TDD §7.4). WP-17's budget guard reads `today()`. */
export type UsageSink = {
  add(neurons: number): Promise<void>;
  /** Workers AI said the daily allocation is used up: treat the day as spent. */
  exhausted(): Promise<void>;
  today(): Promise<number>;
};

export const noUsage: UsageSink = { add: async () => {}, exhausted: async () => {}, today: async () => 0 };

const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Backed by `llm_usage(day, neurons_est)`. Accounting never breaks a diagnosis, so write errors are only logged. */
export function d1Usage(db: D1Database, now: () => number = Date.now): UsageSink {
  const write = async (sql: string, n: number) => {
    try {
      await db.prepare(sql).bind(utcDay(now()), n).run();
    } catch (e) {
      console.error("llm_usage write failed", (e as Error).message);
    }
  };
  return {
    add: (neurons) =>
      write(
        "INSERT INTO llm_usage (day, neurons_est) VALUES (?1, ?2) ON CONFLICT(day) DO UPDATE SET neurons_est = neurons_est + excluded.neurons_est",
        Math.ceil(neurons),
      ),
    exhausted: () =>
      write(
        "INSERT INTO llm_usage (day, neurons_est) VALUES (?1, ?2) ON CONFLICT(day) DO UPDATE SET neurons_est = max(neurons_est, excluded.neurons_est)",
        NEURON_DAILY,
      ),
    today: async () => {
      const row = await db.prepare("SELECT neurons_est FROM llm_usage WHERE day = ?1").bind(utcDay(now())).first<{ neurons_est: number }>();
      return row?.neurons_est ?? 0;
    },
  };
}
