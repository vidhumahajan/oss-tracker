// Copies a user's pull requests from GitHub into our database.
import { User } from "../models/User.js";
import { PullRequest } from "../models/PullRequest.js";
import { fetchGithubProfile, searchPullRequests } from "./github.js";
import { decrypt } from "../utils/crypto.js";
import { HttpError } from "../utils/httpError.js";

const PAGE_SIZE = 100;
const MAX_PAGES = 10; // GitHub search returns at most 1000 results
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Users being synced right now. Stops two syncs for the same person
// from running at once (for example a double click on "Sync now").
const syncing = new Set();

// Turns one GitHub search result into a database write.
function toUpsert(item, authorId) {
  const repoFullName = item.repository_url.replace("https://api.github.com/repos/", "");
  const mergedAt = item.pull_request?.merged_at || null;

  return {
    updateOne: {
      filter: { githubId: item.id },
      update: {
        $set: {
          author: authorId,
          repoFullName,
          repoKey: repoFullName.toLowerCase(),
          number: item.number,
          title: String(item.title || "").slice(0, 300),
          url: item.html_url,
          // GitHub says "closed" for both merged and rejected PRs.
          // merged_at tells them apart.
          state: mergedAt ? "merged" : item.state,
          isDraft: Boolean(item.draft),
          openedAt: item.created_at,
          mergedAt,
          closedAt: item.closed_at,
          githubUpdatedAt: item.updated_at,
        },
        // Only when the PR is new. An admin's "excluded" choice survives later syncs.
        $setOnInsert: { excluded: false },
      },
      // Upsert: update the PR if we have it, insert it if we do not.
      upsert: true,
    },
  };
}

export async function syncUser(userId) {
  const key = String(userId);
  if (syncing.has(key)) {
    throw new HttpError(409, "A sync is already running for this account.");
  }
  syncing.add(key);
  const startedAt = new Date();

  try {
    const user = await User.findById(userId).select("+githubToken");
    if (!user || !user.githubToken) {
      throw new HttpError(400, "Log in with GitHub again to sync.");
    }
    const githubToken = decrypt(user.githubToken);

    // Refresh the profile first. People rename their accounts, and the
    // search below needs the current username.
    const profile = await fetchGithubProfile(githubToken);
    user.login = profile.login;
    user.loginLower = profile.login.toLowerCase();
    user.name = profile.name;
    user.avatarUrl = profile.avatar_url;

    // First sync: everything. Later syncs: only what changed since last
    // time, with one day of overlap so nothing slips through.
    const since = user.lastSyncedAt
      ? new Date(user.lastSyncedAt.getTime() - ONE_DAY_MS).toISOString().slice(0, 10)
      : null;

    let saved = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const items = await searchPullRequests(githubToken, user.login, { since, page });

      const writes = items
        // The search already leaves out the user's own repos. Checked again
        // here so the rule holds even if the search ever behaves differently.
        .filter((item) => !item.repository_url.toLowerCase().includes(`/repos/${user.loginLower}/`))
        .map((item) => toUpsert(item, user._id));

      if (writes.length > 0) {
        await PullRequest.bulkWrite(writes);
        saved += writes.length;
      }
      if (items.length < PAGE_SIZE) break; // that was the last page
    }

    user.lastSyncedAt = startedAt;
    user.lastSyncAttemptAt = startedAt;
    user.syncError = undefined;
    await user.save();

    return { saved };
  } catch (err) {
    // Remember why it failed, so the user and the admins can see it.
    const update = { $set: { lastSyncAttemptAt: startedAt, syncError: err.message } };
    // A revoked token will never work again. Drop it so we stop trying
    // until the user logs in and gives us a new one.
    if (err.kind === "unauthorized") {
      update.$unset = { githubToken: 1 };
    }
    await User.updateOne({ _id: userId }, update);
    throw err;
  } finally {
    syncing.delete(key);
  }
}
