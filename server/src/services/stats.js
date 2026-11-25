// All the counting: profile numbers, the leaderboard, the activity feed.
//
// One rule decides what counts everywhere, so the numbers always agree:
// a pull request counts if it is merged, not excluded by an admin,
// and not in a blocked repo.
import { PullRequest } from "../models/PullRequest.js";
import { BlockedRepo } from "../models/BlockedRepo.js";
import { User } from "../models/User.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// "week" | "month" | "all" -> the date to count from (null = no limit).
export function windowStart(window) {
  if (window === "week") return new Date(Date.now() - 7 * DAY_MS);
  if (window === "month") return new Date(Date.now() - 30 * DAY_MS);
  return null;
}

export async function getBlockedRepoKeys() {
  return BlockedRepo.distinct("repoKey");
}

// The MongoDB filter for "pull requests that count".
export async function countedFilter(extra = {}) {
  const blocked = await getBlockedRepoKeys();
  return { state: "merged", excluded: false, repoKey: { $nin: blocked }, ...extra };
}

// Banned users and private profiles do not appear in any public list.
async function getHiddenUserIds() {
  return User.find({ $or: [{ banned: true }, { isPublic: false }] }).distinct("_id");
}

// Numbers for one user's profile page.
export async function getUserStats(userId) {
  const counted = await countedFilter({ author: userId });

  const [merged, open, closed, topRepos, monthly] = await Promise.all([
    PullRequest.countDocuments(counted),
    PullRequest.countDocuments({ author: userId, state: "open" }),
    PullRequest.countDocuments({ author: userId, state: "closed" }),

    // Group this user's counted PRs by repo and count each group.
    PullRequest.aggregate([
      { $match: counted },
      { $group: { _id: "$repoFullName", merged: { $sum: 1 } } },
      { $sort: { merged: -1, _id: 1 } },
    ]),

    // Same idea, grouped by month ("2026-11") for the activity chart.
    PullRequest.aggregate([
      { $match: counted },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$mergedAt" } },
          merged: { $sum: 1 },
        },
      },
    ]),
  ]);

  return {
    merged,
    open,
    closed,
    repoCount: topRepos.length,
    topRepos: topRepos.slice(0, 8).map((row) => ({ repo: row._id, merged: row.merged })),
    activity: lastTwelveMonths(monthly),
  };
}

// Fills in the months with no merges, so the chart always has 12 bars.
function lastTwelveMonths(rows) {
  const byMonth = new Map(rows.map((row) => [row._id, row.merged]));
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = date.toISOString().slice(0, 7);
    months.push({ month: key, merged: byMonth.get(key) || 0 });
  }
  return months;
}

// The full ranking for a time window: [{ userId, merged, repoCount }], best first.
// At this size (a few thousand users at most) we compute the whole list
// and let the route cut out the page it needs.
export async function getRanking(window) {
  const since = windowStart(window);
  const hidden = await getHiddenUserIds();
  const match = await countedFilter({ author: { $nin: hidden } });
  if (since) match.mergedAt = { $gte: since };

  const rows = await PullRequest.aggregate([
    { $match: match },
    // One row per author: how many PRs, and in which repos.
    { $group: { _id: "$author", merged: { $sum: 1 }, repos: { $addToSet: "$repoKey" } } },
    { $project: { merged: 1, repoCount: { $size: "$repos" } } },
    // Most merged first. Ties go to whoever spread across more repos.
    { $sort: { merged: -1, repoCount: -1, _id: 1 } },
  ]);

  return rows.map((row) => ({ userId: row._id, merged: row.merged, repoCount: row.repoCount }));
}

// The latest counted merges across the platform.
export async function getFeed(limit = 30) {
  const hidden = await getHiddenUserIds();
  const match = await countedFilter({ author: { $nin: hidden } });

  const prs = await PullRequest.find(match)
    .sort({ mergedAt: -1 })
    .limit(limit)
    .populate("author", "login name avatarUrl"); // swap the author id for the user's public fields

  return prs
    .filter((pr) => pr.author) // skip PRs whose author was deleted mid-request
    .map((pr) => ({
      id: pr.id,
      title: pr.title,
      url: pr.url,
      repo: pr.repoFullName,
      mergedAt: pr.mergedAt,
      author: { login: pr.author.login, name: pr.author.name, avatarUrl: pr.author.avatarUrl },
    }));
}

// Headline numbers for the home page.
export async function getPlatformStats() {
  const hidden = await getHiddenUserIds();
  const match = await countedFilter({ author: { $nin: hidden } });

  const [members, merged, repos] = await Promise.all([
    User.countDocuments({ banned: false }),
    PullRequest.countDocuments(match),
    PullRequest.distinct("repoKey", match),
  ]);
  return { members, merged, repos: repos.length };
}
