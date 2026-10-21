export interface AdminUserStats {
  approvedUsers: number;
  averageDailyActiveUsers: number;
  averageDailyImages: number;
  averageDailyVideos: number;
  days: number;
  start: string;
  end: string;
}

/** Complete UTC days keep today's partial activity from depressing the average. */
export function userStatsWindow(now = new Date()) {
  const days = 30;
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { days, start: start.toISOString(), end: end.toISOString() };
}
