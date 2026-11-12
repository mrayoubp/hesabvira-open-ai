import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Checks due schedules every hour. The backup action itself is idempotent per
// frequency because enqueueScheduled consults the latest job.
crons.interval(
  "scheduled business backups",
  { hours: 1 },
  internal.backup.enqueueScheduled,
  {},
);

crons.daily(
  "retention and rate-limit cleanup",
  { hourUTC: 3, minuteUTC: 15 },
  internal.system.cleanupRateLimits,
  {},
);

crons.daily(
  "subscription expiry and grace refresh",
  { hourUTC: 2, minuteUTC: 45 },
  internal.subscription.refreshStatuses,
  {},
);

crons.weekly(
  "health history retention",
  { dayOfWeek: "monday", hourUTC: 3, minuteUTC: 30 },
  internal.system.pruneHealthChecks,
  {},
);

export default crons;
