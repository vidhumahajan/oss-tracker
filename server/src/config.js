// All settings the server needs, read once from environment variables.
// Secrets live in a .env file on your laptop and never go to GitHub.
import "dotenv/config";

const required = [
  "MONGODB_URI",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "JWT_SECRET",
  "TOKEN_ENCRYPTION_KEY",
];

// Stop at startup if a setting is missing. That is easier to debug
// than a crash later in the middle of a login.
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing environment variable: ${key}`);
  }
}

// The encryption key must be exactly 32 bytes, written as 64 hex characters.
if (!/^[0-9a-f]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY)) {
  throw new Error("TOKEN_ENCRYPTION_KEY must be 64 hex characters");
}

export const config = {
  port: Number(process.env.PORT) || 4000,
  mongoUri: process.env.MONGODB_URI,
  githubClientId: process.env.GITHUB_CLIENT_ID,
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
  jwtSecret: process.env.JWT_SECRET,
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY,

  // The address people type in the browser.
  // On your laptop that is the Vite dev server. Once deployed it is your site URL.
  appUrl: (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, ""),

  // GitHub usernames that are always admins, for example "alice,bob".
  // This is how the first admin gets in. They cannot be demoted or banned from the panel.
  ownerLogins: (process.env.ADMIN_LOGINS || "")
    .split(",")
    .map((login) => login.trim().toLowerCase())
    .filter(Boolean),

  isProduction: process.env.NODE_ENV === "production",
  isTest: process.env.NODE_ENV === "test",
  // Set SYNC_ENABLED=false to stop the background sync, for example while debugging.
  syncEnabled: process.env.SYNC_ENABLED !== "false",
};
