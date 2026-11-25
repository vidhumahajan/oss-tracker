// Things a logged-in user can do to their own account.
import { Router } from "express";
import { User, publicUser } from "../models/User.js";
import { PullRequest } from "../models/PullRequest.js";
import { requireAuth } from "../middleware/auth.js";
import { syncUser } from "../services/sync.js";
import { HttpError } from "../utils/httpError.js";
import { requireBoolean } from "../utils/validate.js";
import { cookieOptions } from "../utils/token.js";

export const meRouter = Router();
meRouter.use(requireAuth); // every route in this file needs a login

const SYNC_COOLDOWN_MS = 2 * 60 * 1000;

// "Sync now" button. Fetches the user's latest PRs from GitHub.
meRouter.post("/sync", async (req, res) => {
  // A cooldown, so repeated clicks do not burn the user's GitHub rate limit.
  const last = req.user.lastSyncAttemptAt;
  if (last) {
    const waitMs = SYNC_COOLDOWN_MS - (Date.now() - last.getTime());
    if (waitMs > 0) {
      const seconds = Math.ceil(waitMs / 1000);
      throw new HttpError(429, `You synced a moment ago. Try again in ${seconds} seconds.`);
    }
  }

  const result = await syncUser(req.user._id);
  const user = await User.findById(req.user._id);
  res.json({ saved: result.saved, user: publicUser(user) });
});

// Privacy switch: show or hide my profile.
meRouter.patch("/", async (req, res) => {
  const isPublic = requireBoolean(req.body?.isPublic, "isPublic");
  req.user.isPublic = isPublic;
  await req.user.save();
  res.json({ user: publicUser(req.user) });
});

// Delete my account and everything we stored about me.
meRouter.delete("/", async (req, res) => {
  await PullRequest.deleteMany({ author: req.user._id });
  await User.deleteOne({ _id: req.user._id });
  res.clearCookie("token", cookieOptions);
  res.json({ ok: true });
});
