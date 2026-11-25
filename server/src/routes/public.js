// Pages anyone can see: leaderboard, activity feed, announcements, headline numbers.
import { Router } from "express";
import { User } from "../models/User.js";
import { Announcement } from "../models/Announcement.js";
import { optionalAuth } from "../middleware/auth.js";
import { getRanking, getFeed, getPlatformStats } from "../services/stats.js";
import { parsePage } from "../utils/validate.js";

export const publicRouter = Router();

const PAGE_SIZE = 25;

publicRouter.get("/leaderboard", optionalAuth, async (req, res) => {
  const window = ["week", "month", "all"].includes(req.query.window) ? req.query.window : "month";
  const page = parsePage(req.query.page);

  const ranking = await getRanking(window);
  const start = (page - 1) * PAGE_SIZE;
  const slice = ranking.slice(start, start + PAGE_SIZE);

  // Load the user details for just this page, in one query.
  const users = await User.find({ _id: { $in: slice.map((row) => row.userId) } });
  const userById = new Map(users.map((user) => [user.id, user]));

  const rows = slice
    .map((row, index) => {
      const user = userById.get(String(row.userId));
      if (!user) return null;
      return {
        rank: start + index + 1,
        merged: row.merged,
        repoCount: row.repoCount,
        user: { login: user.login, name: user.name, avatarUrl: user.avatarUrl },
      };
    })
    .filter(Boolean);

  // Where the logged-in user stands, even if they are not on this page.
  let me = null;
  if (req.user) {
    const position = ranking.findIndex((row) => String(row.userId) === req.user.id);
    if (position !== -1) {
      me = { rank: position + 1, merged: ranking[position].merged };
    }
  }

  res.json({
    window,
    page,
    totalPages: Math.max(1, Math.ceil(ranking.length / PAGE_SIZE)),
    total: ranking.length,
    rows,
    me,
  });
});

publicRouter.get("/feed", async (req, res) => {
  res.json({ items: await getFeed(30) });
});

publicRouter.get("/stats", async (req, res) => {
  res.json(await getPlatformStats());
});

publicRouter.get("/announcements", async (req, res) => {
  const items = await Announcement.find().sort({ createdAt: -1 }).limit(5);
  res.json({
    items: items.map((a) => ({ id: a.id, title: a.title, body: a.body, createdAt: a.createdAt })),
  });
});
