// Keeps everyone's pull requests fresh without anyone clicking a button.
//
// How it works: once a minute, pick the few users who were synced longest
// ago and sync them. With 5 users a minute, 1200 users get a turn every
// 4 hours. The "queue" is simply the users collection sorted by lastSyncedAt,
// so there is nothing extra to run or pay for.
//
// Each user is synced with their own GitHub token, so one person's
// rate limit never blocks anyone else.
import { User } from "../models/User.js";
import { syncUser } from "../services/sync.js";

const TICK_MS = 60 * 1000; // run once a minute
const USERS_PER_TICK = 5;
const RESYNC_AFTER_MS = 6 * 60 * 60 * 1000; // a user is due again after 6 hours
const RETRY_AFTER_MS = 30 * 60 * 1000; // after a failure, wait 30 minutes

let running = false;

export async function syncDueUsers() {
  // If the previous round is still going, skip this one.
  if (running) return;
  running = true;

  try {
    const now = Date.now();
    const dueBefore = new Date(now - RESYNC_AFTER_MS);
    const retryBefore = new Date(now - RETRY_AFTER_MS);

    const users = await User.find({
      banned: false,
      githubToken: { $exists: true },
      $and: [
        // Never synced, or synced long enough ago.
        { $or: [{ lastSyncedAt: null }, { lastSyncedAt: { $lt: dueBefore } }] },
        // And not tried very recently (so a failing account is not retried every minute).
        { $or: [{ lastSyncAttemptAt: null }, { lastSyncAttemptAt: { $lt: retryBefore } }] },
      ],
    })
      .sort({ lastSyncedAt: 1 }) // oldest first; never-synced users come first
      .limit(USERS_PER_TICK)
      .select("_id login");

    for (const user of users) {
      try {
        await syncUser(user._id);
      } catch (err) {
        // One user failing must not stop the others. syncUser has already
        // saved the reason on the user.
        console.error(`Sync failed for ${user.login}: ${err.message}`);
      }
    }
  } finally {
    running = false;
  }
}

export function startSyncLoop() {
  setInterval(() => {
    syncDueUsers().catch((err) => console.error("Sync loop error:", err));
  }, TICK_MS);
  console.log("Background sync started");
}
