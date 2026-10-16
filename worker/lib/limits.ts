/** User-facing limits returned by /api/session (TDD §5.2, §11). */
export const LIMITS = {
  runsPerMinute: 3,
  runsPerHour: 10,
  /** Per visitor IP, so dropping the cookie (a new workspace each time) doesn't skip the limit. Looser, for shared networks. */
  runsPerMinutePerIp: 6,
  runsPerHourPerIp: 20,
  /** Per workspace and per visitor IP; 5 a minute through VOICE_LIMIT (WP-23). */
  voicePerHour: 20,
  watchesPerWorkspace: 3,
  watchesGlobal: 30,
  /** Real sites: at least 5 minutes apart (FR-40). Our own demo Worker every minute (user decision, WP-18). */
  watchMinIntervalSec: 300,
  watchMaxIntervalSec: 3600,
  demoWatchIntervalSec: 60,
  watchTtlHours: 24,
} as const;
