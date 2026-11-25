import jwt from "jsonwebtoken";
import { config } from "../config.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// A JWT is a signed string that says "this is user X".
// Only our server knows the secret, so nobody else can create a valid one.
export function signToken(userId) {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: "7d" });
}

// Returns the user id inside the token.
// Throws if the token is fake, changed or expired.
export function verifyToken(token) {
  const payload = jwt.verify(token, config.jwtSecret);
  return payload.sub;
}

// Settings shared by every cookie we set.
export const cookieOptions = {
  httpOnly: true, // JavaScript in the browser cannot read it, so a malicious script cannot steal it
  sameSite: "lax", // the browser will not send it on requests started by other websites
  secure: config.isProduction, // HTTPS only once deployed
};

export const loginCookieOptions = { ...cookieOptions, maxAge: SEVEN_DAYS_MS };
