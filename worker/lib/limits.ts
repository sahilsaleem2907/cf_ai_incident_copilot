/** User-facing limits returned by /api/session; enforcement lands in WP-17 (runs, voice) and WP-18 (watches). */
export const LIMITS = {
  runsPerMinute: 3,
  runsPerHour: 10,
  /** Per visitor IP, so dropping the cookie (a new workspace each time) doesn't skip the limit. Looser, for shared networks. */
  runsPerMinutePerIp: 6,
  runsPerHourPerIp: 20,
  voicePerHour: 20,
  watchesPerWorkspace: 3,
} as const;
