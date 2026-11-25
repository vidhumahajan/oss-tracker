// Login with GitHub. The README explains the flow in plain words.
import crypto from "node:crypto";
import { Router } from "express";
import { config } from "../config.js";
import { User, publicUser } from "../models/User.js";
import { exchangeCodeForToken, fetchGithubProfile } from "../services/github.js";
import { optionalAuth, SIGNED_IN_ELSEWHERE } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { encrypt } from "../utils/crypto.js";
import { signToken, cookieOptions, loginCookieOptions } from "../utils/token.js";

export const authRouter = Router();

const TEN_MINUTES_MS = 10 * 60 * 1000;
const shortCookie = { ...cookieOptions, maxAge: TEN_MINUTES_MS };

// After login we send people back to the page they came from.
// Only paths on our own site are allowed. Without this check, a crafted
// link could bounce a freshly logged-in user to someone else's website.
function safeNextPath(value) {
  const ok =
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    value.length <= 200;
  return ok ? value : "/";
}

// Step 1: the "Login with GitHub" button points here.
// We send the user to GitHub's own login page.
authRouter.get("/github", authLimiter, (req, res) => {
  // state is a random value we remember in a cookie. GitHub sends it back
  // in step 2. If the two do not match, the login was not started by us.
  const state = crypto.randomBytes(16).toString("hex");
  res.cookie("oauth_state", state, shortCookie);
  res.cookie("oauth_next", safeNextPath(req.query.next), shortCookie);

  // No "scope" is requested, so GitHub gives us read access to public
  // information only. We can never see private repos or change anything.
  const params = new URLSearchParams({
    client_id: config.githubClientId,
    redirect_uri: `${config.appUrl}/api/auth/github/callback`,
    state,
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// Step 2: GitHub sends the user back here with a one-time code.
authRouter.get("/github/callback", authLimiter, async (req, res) => {
  const { code, state } = req.query;
  const next = safeNextPath(req.cookies.oauth_next);
  const expectedState = req.cookies.oauth_state;
  res.clearCookie("oauth_state", cookieOptions);
  res.clearCookie("oauth_next", cookieOptions);

  // This is a page the browser lands on, not an API call. So on failure
  // we send the person back to the site with a message, not a JSON error.
  if (typeof code !== "string" || typeof state !== "string" || state !== expectedState) {
    return res.redirect(`${config.appUrl}/?error=login_failed`);
  }

  let profile;
  let githubToken;
  try {
    githubToken = await exchangeCodeForToken(code);
    profile = await fetchGithubProfile(githubToken);
  } catch {
    return res.redirect(`${config.appUrl}/?error=login_failed`);
  }

  const fields = {
    login: profile.login,
    loginLower: profile.login.toLowerCase(),
    name: profile.name,
    avatarUrl: profile.avatar_url,
    githubToken: encrypt(githubToken),
    // A fresh value for this login. Saving it makes every older login
    // cookie for this account stop working (see middleware/auth.js).
    sessionId: crypto.randomBytes(16).toString("hex"),
  };
  // Usernames listed in ADMIN_LOGINS are always admins.
  if (config.ownerLogins.includes(fields.loginLower)) {
    fields.role = "admin";
  }

  // Upsert = update the user if they exist, create them if they do not.
  // The same code covers first login and every later login, and the
  // database does it in one step, so two logins at once cannot create
  // the same user twice.
  await User.updateOne({ githubId: profile.id }, { $set: fields }, { upsert: true });
  const user = await User.findOne({ githubId: profile.id });

  if (user.banned) {
    return res.redirect(`${config.appUrl}/?error=suspended`);
  }

  // Our own login cookie. From here on the browser proves who it is with this.
  res.cookie("token", signToken(user.id, user.sessionId), loginCookieOptions);
  res.redirect(`${config.appUrl}${next}`);
});

authRouter.post("/logout", optionalAuth, async (req, res) => {
  // Only the current login clears the stored session. A browser holding an
  // older cookie must not be able to log out the newer one.
  if (req.user) {
    await User.updateOne({ _id: req.user._id }, { $unset: { sessionId: 1 } });
  }
  res.clearCookie("token", cookieOptions);
  res.json({ ok: true });
});

// Who am I? The React app calls this on load.
// Answers { user: null } for visitors, which is not an error.
authRouter.get("/me", optionalAuth, (req, res) => {
  if (req.loggedOutReason === SIGNED_IN_ELSEWHERE) {
    // The old cookie is useless now. Clearing it means the message
    // is shown once, not on every visit.
    res.clearCookie("token", cookieOptions);
    return res.json({ user: null, reason: SIGNED_IN_ELSEWHERE });
  }
  if (!req.user) {
    return res.json({ user: null });
  }
  res.json({
    user: {
      ...publicUser(req.user),
      syncError: req.user.syncError || null,
      isOwner: config.ownerLogins.includes(req.user.loginLower),
    },
  });
});
