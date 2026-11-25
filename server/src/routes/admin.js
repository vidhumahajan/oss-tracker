// The admin panel's API. Every route here needs a logged-in admin,
// and every change is written to the admin log.
import { Router } from "express";
import { config } from "../config.js";
import { User } from "../models/User.js";
import { PullRequest } from "../models/PullRequest.js";
import { BlockedRepo } from "../models/BlockedRepo.js";
import { Announcement } from "../models/Announcement.js";
import { AdminLog, logAdminAction } from "../models/AdminLog.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { countedFilter, getBlockedRepoKeys } from "../services/stats.js";
import { syncUser } from "../services/sync.js";
import { adminMentorsRouter } from "./adminMentors.js";
import { HttpError } from "../utils/httpError.js";
import {
  parsePage,
  parseSearch,
  escapeRegex,
  requireString,
  requireBoolean,
  requireObjectId,
} from "../utils/validate.js";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

const PAGE_SIZE = 25;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// ---------- Overview ----------

adminRouter.get("/overview", async (req, res) => {
  const weekAgo = new Date(Date.now() - WEEK_MS);
  const counted = await countedFilter();
  const countedThisWeek = { ...counted, mergedAt: { $gte: weekAgo } };

  const [
    members,
    newThisWeek,
    banned,
    admins,
    syncErrors,
    neverSynced,
    mergedTotal,
    mergedThisWeek,
    activeAuthors,
    blockedRepos,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ createdAt: { $gte: weekAgo } }),
    User.countDocuments({ banned: true }),
    User.countDocuments({ role: "admin" }),
    User.countDocuments({ syncError: { $exists: true, $ne: null } }),
    User.countDocuments({ lastSyncedAt: null }),
    PullRequest.countDocuments(counted),
    PullRequest.countDocuments(countedThisWeek),
    PullRequest.distinct("author", countedThisWeek),
    BlockedRepo.countDocuments(),
  ]);

  res.json({
    members,
    newThisWeek,
    activeThisWeek: activeAuthors.length, // members with at least one merge this week
    banned,
    admins,
    syncErrors,
    neverSynced,
    mergedTotal,
    mergedThisWeek,
    blockedRepos,
  });
});

// ---------- Members ----------

// Builds the member search filter from the query string.
function memberFilter(query) {
  const filter = {};
  const search = parseSearch(query.search);
  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ login: pattern }, { name: pattern }];
  }
  if (query.filter === "admins") filter.role = "admin";
  if (query.filter === "banned") filter.banned = true;
  if (query.filter === "errors") filter.syncError = { $exists: true, $ne: null };
  return filter;
}

// Adds each user's counted merged-PR total, using one query for the whole list.
async function withMergedCounts(users) {
  const counted = await countedFilter({ author: { $in: users.map((u) => u._id) } });
  const rows = await PullRequest.aggregate([
    { $match: counted },
    { $group: { _id: "$author", merged: { $sum: 1 } } },
  ]);
  const mergedById = new Map(rows.map((row) => [String(row._id), row.merged]));

  return users.map((user) => ({
    id: user.id,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: user.role,
    banned: user.banned,
    isPublic: user.isPublic,
    isOwner: config.ownerLogins.includes(user.loginLower),
    merged: mergedById.get(user.id) || 0,
    joinedAt: user.createdAt,
    lastSyncedAt: user.lastSyncedAt,
    syncError: user.syncError || null,
  }));
}

adminRouter.get("/users", async (req, res) => {
  const page = parsePage(req.query.page);
  const filter = memberFilter(req.query);

  const [total, users] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE),
  ]);

  res.json({
    page,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    total,
    items: await withMergedCounts(users),
  });
});

// One cell of a CSV file. Quotes are doubled, and a leading = + - @ gets
// an apostrophe in front so a spreadsheet does not run it as a formula.
function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

adminRouter.get("/users.csv", async (req, res) => {
  const users = await User.find().sort({ createdAt: 1 });
  const rows = await withMergedCounts(users);

  const lines = [
    ["login", "name", "role", "banned", "public", "merged_prs", "joined", "last_synced"],
    ...rows.map((u) => [
      u.login,
      u.name,
      u.role,
      u.banned,
      u.isPublic,
      u.merged,
      u.joinedAt?.toISOString(),
      u.lastSyncedAt?.toISOString(),
    ]),
  ].map((line) => line.map(csvCell).join(","));

  await logAdminAction(req.user, "export_members", `${rows.length} members`);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="members.csv"');
  res.send(lines.join("\n"));
});

// Change a member's role, or ban / unban them.
adminRouter.patch("/users/:id", async (req, res) => {
  const user = await User.findById(requireObjectId(req.params.id));
  if (!user) throw new HttpError(404, "Member not found");

  if (user.id === req.user.id) {
    throw new HttpError(400, "You cannot change your own role or ban yourself.");
  }
  if (config.ownerLogins.includes(user.loginLower)) {
    throw new HttpError(403, "This account is an owner and cannot be changed here.");
  }

  const { role, banned } = req.body || {};

  if (role !== undefined) {
    if (!["member", "admin"].includes(role)) {
      throw new HttpError(400, "role must be member or admin");
    }
    if (role !== user.role) {
      user.role = role;
      await logAdminAction(req.user, role === "admin" ? "make_admin" : "remove_admin", user.login);
    }
  }

  if (banned !== undefined) {
    requireBoolean(banned, "banned");
    if (banned !== user.banned) {
      user.banned = banned;
      // A banned admin would be confusing. Banning also removes the admin role.
      if (banned) user.role = "member";
      await logAdminAction(req.user, banned ? "ban_user" : "unban_user", user.login);
    }
  }

  await user.save();
  const [item] = await withMergedCounts([user]);
  res.json({ item });
});

// Re-sync a member right now, for example after they report missing PRs.
adminRouter.post("/users/:id/sync", async (req, res) => {
  const user = await User.findById(requireObjectId(req.params.id));
  if (!user) throw new HttpError(404, "Member not found");

  const result = await syncUser(user._id);
  await logAdminAction(req.user, "sync_user", user.login, `${result.saved} PRs updated`);

  const fresh = await User.findById(user._id);
  const [item] = await withMergedCounts([fresh]);
  res.json({ saved: result.saved, item });
});

// ---------- Fair play: repos and pull requests ----------

// Every repo that has merged PRs here, busiest first. A repo with many PRs
// from very few people is the usual sign of someone gaming the leaderboard.
adminRouter.get("/repos", async (req, res) => {
  const page = parsePage(req.query.page);
  const search = parseSearch(req.query.search);

  const match = { state: "merged", excluded: false };
  if (search) match.repoKey = new RegExp(escapeRegex(search.toLowerCase()));

  const [rows, blocked] = await Promise.all([
    PullRequest.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$repoKey",
          repo: { $first: "$repoFullName" },
          merged: { $sum: 1 },
          authors: { $addToSet: "$author" },
        },
      },
      { $project: { repo: 1, merged: 1, contributors: { $size: "$authors" } } },
      { $sort: { merged: -1, _id: 1 } },
    ]),
    getBlockedRepoKeys(),
  ]);

  const start = (page - 1) * PAGE_SIZE;
  res.json({
    page,
    totalPages: Math.max(1, Math.ceil(rows.length / PAGE_SIZE)),
    total: rows.length,
    items: rows.slice(start, start + PAGE_SIZE).map((row) => ({
      repoKey: row._id,
      repo: row.repo,
      merged: row.merged,
      contributors: row.contributors,
      blocked: blocked.includes(row._id),
    })),
  });
});

adminRouter.get("/blocked-repos", async (req, res) => {
  const items = await BlockedRepo.find().sort({ createdAt: -1 }).populate("blockedBy", "login");
  res.json({
    items: items.map((b) => ({
      id: b.id,
      repoKey: b.repoKey,
      reason: b.reason,
      blockedBy: b.blockedBy?.login || null,
      createdAt: b.createdAt,
    })),
  });
});

adminRouter.post("/blocked-repos", async (req, res) => {
  const repoKey = requireString(req.body?.repo, "repo", { max: 200 }).toLowerCase();
  if (!/^[a-z0-9._-]+\/[a-z0-9._-]+$/.test(repoKey)) {
    throw new HttpError(400, 'repo must look like "owner/name"');
  }
  const reason = req.body?.reason ? requireString(req.body.reason, "reason", { max: 300 }) : "";

  if (await BlockedRepo.exists({ repoKey })) {
    throw new HttpError(409, "That repo is already blocked.");
  }
  const blocked = await BlockedRepo.create({ repoKey, reason, blockedBy: req.user._id });
  await logAdminAction(req.user, "block_repo", repoKey, reason);
  res.status(201).json({ item: { id: blocked.id, repoKey, reason } });
});

adminRouter.delete("/blocked-repos/:owner/:name", async (req, res) => {
  const repoKey = `${req.params.owner}/${req.params.name}`.toLowerCase();
  const removed = await BlockedRepo.findOneAndDelete({ repoKey });
  if (!removed) throw new HttpError(404, "That repo is not blocked.");
  await logAdminAction(req.user, "unblock_repo", repoKey);
  res.json({ ok: true });
});

// Exclude a single PR from scoring, or bring it back.
adminRouter.patch("/prs/:id", async (req, res) => {
  const excluded = requireBoolean(req.body?.excluded, "excluded");
  const pr = await PullRequest.findById(requireObjectId(req.params.id)).populate("author", "login");
  if (!pr) throw new HttpError(404, "Pull request not found");

  pr.excluded = excluded;
  await pr.save();
  await logAdminAction(
    req.user,
    excluded ? "exclude_pr" : "include_pr",
    `${pr.repoFullName}#${pr.number}`,
    pr.author ? `by ${pr.author.login}` : ""
  );
  res.json({ ok: true, excluded });
});

// Delete a PR's AI summary, for example if it is wrong or rude.
// The author can then write a new one.
adminRouter.delete("/prs/:id/summary", async (req, res) => {
  const pr = await PullRequest.findById(requireObjectId(req.params.id)).populate("author", "login");
  if (!pr) throw new HttpError(404, "Pull request not found");
  if (!pr.summary) throw new HttpError(404, "This pull request has no summary.");

  pr.summary = null;
  await pr.save();
  await logAdminAction(
    req.user,
    "delete_summary",
    `${pr.repoFullName}#${pr.number}`,
    pr.author ? `by ${pr.author.login}` : ""
  );
  res.json({ ok: true });
});

// ---------- Announcements ----------

adminRouter.post("/announcements", async (req, res) => {
  const title = requireString(req.body?.title, "title", { max: 120 });
  const body = requireString(req.body?.body, "body", { max: 2000 });

  const item = await Announcement.create({ title, body, author: req.user._id });
  await logAdminAction(req.user, "post_announcement", title);
  res.status(201).json({
    item: { id: item.id, title: item.title, body: item.body, createdAt: item.createdAt },
  });
});

adminRouter.delete("/announcements/:id", async (req, res) => {
  const removed = await Announcement.findByIdAndDelete(requireObjectId(req.params.id));
  if (!removed) throw new HttpError(404, "Announcement not found");
  await logAdminAction(req.user, "delete_announcement", removed.title);
  res.json({ ok: true });
});

// ---------- Mentors and sessions ----------

// Kept in its own file to keep this one short. Attached here so the
// admin check at the top of this file covers it too.
adminRouter.use(adminMentorsRouter);

// ---------- Log ----------

adminRouter.get("/log", async (req, res) => {
  const page = parsePage(req.query.page);
  const [total, items] = await Promise.all([
    AdminLog.countDocuments(),
    AdminLog.find()
      .sort({ createdAt: -1 })
      .skip((page - 1) * 50)
      .limit(50),
  ]);

  res.json({
    page,
    totalPages: Math.max(1, Math.ceil(total / 50)),
    total,
    items: items.map((entry) => ({
      id: entry.id,
      admin: entry.adminLogin,
      action: entry.action,
      target: entry.target,
      details: entry.details,
      at: entry.createdAt,
    })),
  });
});
