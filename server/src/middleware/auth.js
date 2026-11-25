// Three guards you can put in front of a route:
//   optionalAuth  anyone may call it; req.user is set if they are logged in
//                 (req.loggedOutReason says why an older login stopped working)
//   requireAuth   must be logged in
//   requireAdmin  must be logged in AND an admin (use after requireAuth)
import { User } from "../models/User.js";
import { verifyToken } from "../utils/token.js";
import { HttpError } from "../utils/httpError.js";

// Sent when a token is real but a newer login has replaced it.
export const SIGNED_IN_ELSEWHERE = "signed_in_elsewhere";

// Reads the login cookie. Returns { user }, where user is null for a visitor.
// When the cookie is real but belongs to an older login, reason says so,
// so the React app can explain why the person was logged out.
async function readLoginCookie(req) {
  const token = req.cookies.token;
  if (!token) return { user: null };

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return { user: null }; // fake, changed or expired token
  }

  const user = await User.findById(payload.userId);
  if (!user) return { user: null };

  // Every login saves a new sessionId on the user. A token carrying any other
  // value comes from an older login. If the user has no sessionId at all,
  // they logged out, so there is nothing to explain.
  if (!payload.sessionId || payload.sessionId !== user.sessionId) {
    return { user: null, reason: user.sessionId ? SIGNED_IN_ELSEWHERE : null };
  }
  return { user };
}

export async function optionalAuth(req, res, next) {
  const { user, reason } = await readLoginCookie(req);
  // A banned user is treated like a visitor.
  req.user = user && !user.banned ? user : null;
  req.loggedOutReason = reason || null;
  next();
}

export async function requireAuth(req, res, next) {
  const { user, reason } = await readLoginCookie(req);
  if (reason === SIGNED_IN_ELSEWHERE) {
    throw new HttpError(401, "You were logged out because this account logged in on another device.");
  }
  if (!user) {
    throw new HttpError(401, "Please log in");
  }
  // Checked on every request, so a ban takes effect immediately,
  // even for someone who is already logged in.
  if (user.banned) {
    throw new HttpError(403, "This account has been suspended.");
  }
  req.user = user;
  next();
}

// The role is read from the database on every request (in requireAuth),
// never from the browser. Hiding the admin page in React is only for looks;
// this check is the real lock.
export function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    throw new HttpError(403, "Admins only");
  }
  next();
}
