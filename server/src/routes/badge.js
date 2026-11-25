// The GitHub profile badge. The image is public; everything else needs a login.
// The README explains the "Add it for me" flow in plain words.
import crypto from "node:crypto";
import { Router } from "express";
import { config } from "../config.js";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { authLimiter, badgeLimiter } from "../middleware/rateLimit.js";
import {
  badgeSvg,
  badgeLine,
  autoAddAvailable,
  addBadgeWithCode,
  checkBadge,
} from "../services/badge.js";
import { HttpError } from "../utils/httpError.js";
import { cookieOptions } from "../utils/token.js";

const TEN_MINUTES_MS = 10 * 60 * 1000;

// ---------- The image ----------

// app.js attaches this one before the normal API rate limit. GitHub's image
// proxy fetches badges for every profile view from a few addresses, so it
// would hit the normal limit quickly. It gets its own, more generous one.
export const badgeImageRouter = Router();

badgeImageRouter.get("/:login.svg", badgeLimiter, async (req, res) => {
  const svg = await badgeSvg(req.params.login);
  res.set({
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
    // Lets github.com and other sites show the image.
    "Cross-Origin-Resource-Policy": "cross-origin",
  });
  res.send(svg);
});

// ---------- Adding it ----------

export const badgeRouter = Router();

// What the badge panel needs to know.
badgeRouter.get("/", requireAuth, (req, res) => {
  res.json({
    addedAt: req.user.badgeAddedAt || null,
    autoAvailable: autoAddAvailable(),
    line: badgeLine(req.user.login),
  });
});

// Step 1: "Add it for me" points here. We send the member to GitHub to
// approve write access to public repos, for the badge app only.
badgeRouter.get("/connect", authLimiter, requireAuth, (req, res) => {
  if (!autoAddAvailable()) {
    throw new HttpError(503, "Adding the badge for you is not set up on this site.");
  }
  // The same state check as login (routes/auth.js).
  const state = crypto.randomBytes(16).toString("hex");
  res.cookie("badge_state", state, { ...cookieOptions, maxAge: TEN_MINUTES_MS });

  const params = new URLSearchParams({
    client_id: config.badgeClientId,
    redirect_uri: `${config.appUrl}/api/badge/callback`,
    scope: "public_repo",
    state,
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// Step 2: GitHub sends the member back here. Like the login callback, this
// is a page the browser lands on, so every outcome is a redirect.
badgeRouter.get("/callback", authLimiter, optionalAuth, async (req, res) => {
  const { code, state } = req.query;
  const expectedState = req.cookies.badge_state;
  res.clearCookie("badge_state", cookieOptions);

  // No code means the member pressed Cancel on GitHub.
  const valid =
    req.user &&
    autoAddAvailable() &&
    typeof code === "string" &&
    typeof state === "string" &&
    state === expectedState;
  if (!valid) return res.redirect(`${config.appUrl}/?badge=unchanged`);

  const result = await addBadgeWithCode(code, req.user);
  if (result === "added") {
    return res.redirect(`${config.appUrl}/u/${encodeURIComponent(req.user.login)}?badge=added`);
  }
  res.redirect(`${config.appUrl}/?badge=${result}`);
});

// "I already added it myself."
badgeRouter.post("/check", requireAuth, async (req, res) => {
  await checkBadge(req.user);
  res.json({ ok: true });
});
