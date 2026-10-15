/** Watch types shared with the web app, so they carry no Workers types. */

/** What `GET /api/watches` returns. */
export type WatchView = {
  id: string;
  url: string;
  intervalSec: number;
  lastStatus: "pass" | "fail" | null;
  consecutivePasses: number;
  nextRun: number;
  expiresAt: number;
  openIncidentId: string | null;
};
