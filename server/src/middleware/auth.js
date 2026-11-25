// Three guards you can put in front of a route:
//   optionalAuth  anyone may call it; req.user is set if they are logged in
//   requireAuth   must be logged in
//   requireAdmin  must be logged in AND an admin (use after requireAuth)
import { User } from "../models/User.js";
import { verifyToken } from "../utils/token.js";
import { HttpError } from "../utils/httpError.js";

// Reads the login cookie and returns the user, or null.
async function userFromCookie(req) {
  const token = req.cookies.token;
  if (!token) return null;

  let userId;
  try {
    userId = verifyToken(token);
  } catch {
    return null; // fake, changed or expired token
  }
  return User.findById(userId);
}

export async function optionalAuth(req, res, next) {
  const user = await userFromCookie(req);
  // A banned user is treated like a visitor.
  req.user = user && !user.banned ? user : null;
  next();
}

export async function requireAuth(req, res, next) {
  const user = await userFromCookie(req);
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
