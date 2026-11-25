// Public profile pages.
import { Router } from "express";
import { User, publicUser } from "../models/User.js";
import { PullRequest } from "../models/PullRequest.js";
import { optionalAuth } from "../middleware/auth.js";
import { getUserStats, getRanking, getBlockedRepoKeys } from "../services/stats.js";
import { HttpError } from "../utils/httpError.js";
import { parsePage } from "../utils/validate.js";

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
      };
    }),
  });
});
