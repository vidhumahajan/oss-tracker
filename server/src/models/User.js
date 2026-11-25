import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    // GitHub's numeric id for the account. It never changes, even if the
    // person renames their username, so we use it to recognise them.
    githubId: { type: Number, required: true, unique: true },
    login: { type: String, required: true }, // GitHub username, as GitHub spells it
    // Lowercase copy, so /u/Varad and /u/varad find the same person.
    loginLower: { type: String, required: true, index: true },
    name: String,
    avatarUrl: String,

    // Encrypted GitHub token (see utils/crypto.js). select: false keeps it
    // out of normal queries, so it cannot leak into an API response by accident.
    githubToken: { type: String, select: false },

    // A new random value on every login, also put inside the login cookie.
    // Only the cookie from the newest login matches it, so logging in
    // somewhere else ends the older session. Cleared on logout.
    sessionId: String,

    role: { type: String, enum: ["member", "admin"], default: "member" },
    banned: { type: Boolean, default: false },
    // false = profile hidden from everyone else and left off the leaderboard.
    isPublic: { type: Boolean, default: true },

    lastSyncedAt: Date, // last successful sync
    lastSyncAttemptAt: Date, // last try, successful or not
    syncError: String, // why the last sync failed, if it did

    // The daily limit on AI summaries (see services/summary.js).
    // A window opens with the first summary and lasts 24 hours.
    summaryWindowStart: Date,
    summaryCount: { type: Number, default: 0 },

    // When the GitHub profile badge was added, by "Add it for me" or by the
    // member themselves. Until then the home page shows the badge panel.
    badgeAddedAt: Date,
  },
  { timestamps: true } // adds createdAt and updatedAt automatically
);

// The background sync picks the users who were synced longest ago.
userSchema.index({ lastSyncedAt: 1 });

export const User = mongoose.model("User", userSchema);

// The fields that are safe to send to the browser.
export function publicUser(user) {
  return {
    id: user.id,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: user.role,
    isPublic: user.isPublic,
    lastSyncedAt: user.lastSyncedAt,
    joinedAt: user.createdAt,
  };
}
