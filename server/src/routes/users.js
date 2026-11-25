// Public profile pages, and the AI summaries of a profile's merged PRs.
import { Router } from "express";
import { User, publicUser } from "../models/User.js";
import { PullRequest } from "../models/PullRequest.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { getUserStats, getRanking, getBlockedRepoKeys } from "../services/stats.js";
import { aiEnabled } from "../services/ai.js";
import { writeSummary, publicSummary } from "../services/summary.js";
import { HttpError } from "../utils/httpError.js";
import { parsePage, requireObjectId } from "../utils/validate.js";

export const usersRouter = Router();
usersRouter.use(optionalAuth);

const PAGE_SIZE = 20;

// Finds the profile, or throws 404 if the viewer is not allowed to see it.
// A private or banned profile answers exactly like one that does not exist,
// so nobody can tell whether the account is there.
async function findVisibleUser(login, viewer) {
  const user = await User.findOne({ loginLower: String(login).toLowerCase() });
  const isSelf = viewer && user && viewer.id === user.id;
  const isAdmin = viewer && viewer.role === "admin";
  const isVisible = user && user.isPublic && !user.banned;

  if (!user || !(isVisible || isSelf || isAdmin)) {
    throw new HttpError(404, "Profile not found");
  }
  return user;
}

// Only the PR's author and admins may ask for a new summary.
function canWriteSummary(viewer, author) {
  return Boolean(viewer && (viewer.id === author.id || viewer.role === "admin"));
}

// One PR of this profile, or 404.
async function findPrOf(user, id) {
  const pr = await PullRequest.findOne({ _id: requireObjectId(id), author: user._id });
  if (!pr) throw new HttpError(404, "Pull request not found");
  return pr;
}

usersRouter.get("/:login", async (req, res) => {
  const user = await findVisibleUser(req.params.login, req.user);

  const [stats, ranking] = await Promise.all([getUserStats(user._id), getRanking("all")]);
  const position = ranking.findIndex((row) => String(row.userId) === user.id);

  res.json({
    user: { ...publicUser(user), banned: user.banned },
    stats,
    rank: position === -1 ? null : position + 1,
  });
});

usersRouter.get("/:login/prs", async (req, res) => {
  const user = await findVisibleUser(req.params.login, req.user);
  const page = parsePage(req.query.page);

  const filter = { author: user._id };
  if (["merged", "open", "closed"].includes(req.query.state)) {
    filter.state = req.query.state;
  }

  const [total, prs, blocked] = await Promise.all([
    PullRequest.countDocuments(filter),
    PullRequest.find(filter)
      .sort({ githubUpdatedAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE),
    getBlockedRepoKeys(),
  ]);

  res.json({
    page,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    total,
    items: prs.map((pr) => {
      const repoBlocked = blocked.includes(pr.repoKey);
      return {
        id: pr.id,
        title: pr.title,
        url: pr.url,
        repo: pr.repoFullName,
        number: pr.number,
        state: pr.state,
        isDraft: pr.isDraft,
        openedAt: pr.openedAt,
        mergedAt: pr.mergedAt,
        excluded: pr.excluded,
        repoBlocked,
        // Does this PR add to the user's score?
        counts: pr.state === "merged" && !pr.excluded && !repoBlocked,
        hasSummary: Boolean(pr.summary),
      };
    }),
    // Tells the React app whether to show "Write summary" on merged PRs
    // that have none yet.
    summaries: { canWrite: aiEnabled() && canWriteSummary(req.user, user) },
  });
});

// Read a saved summary. Anyone who can see the profile can read it.
usersRouter.get("/:login/prs/:id/summary", async (req, res) => {
  const user = await findVisibleUser(req.params.login, req.user);
  const pr = await findPrOf(user, req.params.id);
  res.json({ summary: pr.summary ? publicSummary(pr.summary) : null });
});

// Write the summary if there is none yet, otherwise return the saved one.
usersRouter.post("/:login/prs/:id/summary", requireAuth, async (req, res) => {
  const user = await findVisibleUser(req.params.login, req.user);
  const pr = await findPrOf(user, req.params.id);

  if (!canWriteSummary(req.user, user)) {
    throw new HttpError(403, "Only the author of this pull request or an admin can write its summary.");
  }
  if (pr.state !== "merged") {
    throw new HttpError(400, "Only merged pull requests get a summary.");
  }

  const summary = await writeSummary(pr, req.user);
  res.json({ summary: publicSummary(summary) });
});
