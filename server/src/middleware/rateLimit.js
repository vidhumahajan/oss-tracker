// Limits how many requests one visitor can make, so a script cannot
// hammer the server or try logins endlessly.
import rateLimit from "express-rate-limit";
import { config } from "../config.js";

function limiter(limit, windowMinutes) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit, // max requests per visitor (per IP address) in that window
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => config.isTest, // the test suite makes many requests on purpose
    message: { error: { message: "Too many requests. Please slow down and try again soon." } },
  });
}

// Everything under /api.
export const apiLimiter = limiter(300, 15);
// Badge images. GitHub's image proxy asks for them on every profile view.
export const badgeLimiter = limiter(3000, 15);
// Login routes get a tighter limit.
export const authLimiter = limiter(30, 15);
