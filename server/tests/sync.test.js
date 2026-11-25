import { test } from "node:test";
import assert from "node:assert/strict";
import {
  useDatabase,
  github,
  githubAccount,
  githubPr,
  logIn,
  memberWithPrs,
  User,
  PullRequest,
} from "./helpers.js";
import { syncUser } from "../src/services/sync.js";
import { syncDueUsers } from "../src/jobs/syncLoop.js";

useDatabase();

const HOUR = 60 * 60 * 1000;

// Lets a test sync again without waiting out the 2 minute cooldown.
async function clearCooldown(login) {
  await User.updateOne({ loginLower: login }, { lastSyncAttemptAt: new Date(Date.now() - HOUR) });
}

test("sync saves merged, open and closed PRs with the right state", async () => {
  const { user } = await memberWithPrs("octo", [
    { repo: "kubescape/kubescape", state: "merged", title: "Fix scan" },
    { repo: "kubescape/kubescape", state: "open" },
    { repo: "dart-lang/sdk", state: "closed" },
  ]);

  const prs = await PullRequest.find({ author: user._id }).sort({ state: 1 });
  assert.deepEqual(prs.map((pr) => pr.state), ["closed", "merged", "open"]);

  const merged = prs.find((pr) => pr.state === "merged");
  assert.equal(merged.repoFullName, "kubescape/kubescape");
  assert.equal(merged.repoKey, "kubescape/kubescape");
  assert.equal(merged.title, "Fix scan");
  assert.ok(merged.mergedAt instanceof Date);
  assert.equal(merged.excluded, false);
  assert.ok(user.lastSyncedAt instanceof Date);
});

test("the search asks only for public PRs outside the user's own repos", async () => {
  await memberWithPrs("octo", [{ repo: "org/repo" }]);
  assert.equal(github.searches[0].q, "author:octo type:pr is:public -user:octo");
});

test("a PR to the user's own repo is never saved, even if GitHub returns one", async () => {
  const { user } = await memberWithPrs("Octo", [
    { repo: "Octo/my-own-project" },
    { repo: "octo/another-one" },
    { repo: "octocat-org/real-project" }, // a different owner whose name merely starts the same
  ]);
  const prs = await PullRequest.find({ author: user._id });
  assert.deepEqual(prs.map((pr) => pr.repoFullName), ["octocat-org/real-project"]);
});

test("syncing twice does not duplicate PRs, and picks up state changes", async () => {
  githubAccount("octo");
  const pr = githubPr("octo", "org/repo", { state: "open" });
  const { agent } = await logIn("octo");
  await agent.post("/api/me/sync");
  assert.equal((await PullRequest.findOne({ githubId: pr.id })).state, "open");

  // The PR gets merged on GitHub.
  pr.state = "closed";
  pr.pull_request.merged_at = new Date().toISOString();
  await clearCooldown("octo");
  await agent.post("/api/me/sync");

  assert.equal(await PullRequest.countDocuments(), 1);
  assert.equal((await PullRequest.findOne({ githubId: pr.id })).state, "merged");
});

test("the second sync only asks for what changed since the first", async () => {
  githubAccount("octo");
  const { agent } = await logIn("octo");
  await agent.post("/api/me/sync");
  await clearCooldown("octo");
  await agent.post("/api/me/sync");

  assert.equal(github.searches.length, 2);
  assert.match(github.searches[1].q, / updated:>=\d{4}-\d{2}-\d{2}$/);
});

test("more than 100 PRs are fetched page by page", async () => {
  githubAccount("octo");
  for (let i = 0; i < 230; i++) githubPr("octo", `org/repo-${i % 7}`, { daysAgo: i });
  const { agent } = await logIn("octo");
  const res = await agent.post("/api/me/sync");

  assert.equal(res.body.saved, 230);
  assert.equal(await PullRequest.countDocuments(), 230);
  assert.deepEqual(github.searches.map((s) => s.page), [1, 2, 3]);
});

test("an admin's exclusion survives a later sync", async () => {
  const { agent, user } = await memberWithPrs("octo", [{ repo: "org/repo" }]);
  await PullRequest.updateOne({ author: user._id }, { excluded: true });

  await clearCooldown("octo");
  await agent.post("/api/me/sync");
  assert.equal((await PullRequest.findOne({ author: user._id })).excluded, true);
});

test("sync refreshes a renamed username", async () => {
  const profile = githubAccount("octo");
  const { agent } = await logIn("octo");
  profile.login = "octo-new";
  github.prs["octo-new"] = [];
  await agent.post("/api/me/sync");

  const user = await User.findOne();
  assert.equal(user.login, "octo-new");
  assert.equal(user.loginLower, "octo-new");
});

test("clicking sync again right away is refused with a wait time", async () => {
  const { agent } = await memberWithPrs("octo", []);
  const res = await agent.post("/api/me/sync");
  assert.equal(res.status, 429);
  assert.match(res.body.error.message, /Try again in \d+ seconds/);
  assert.equal(github.searches.length, 1); // GitHub was not called a second time
});

test("two syncs for the same user cannot run at once", async () => {
  githubAccount("octo");
  await logIn("octo");
  const user = await User.findOne();

  const results = await Promise.allSettled([syncUser(user._id), syncUser(user._id)]);
  const failed = results.filter((r) => r.status === "rejected");
  assert.equal(failed.length, 1);
  assert.equal(failed[0].reason.status, 409);
});

test("if the GitHub token was revoked, the error is saved and the token dropped", async () => {
  githubAccount("octo");
  const { agent } = await logIn("octo");
  github.profiles = {}; // GitHub no longer accepts the token

  const res = await agent.post("/api/me/sync");
  assert.equal(res.status, 401);

  const user = await User.findOne().select("+githubToken");
  assert.equal(user.githubToken, undefined);
  assert.match(user.syncError, /Log out and log in again/);
  assert.equal(user.lastSyncedAt, undefined);

  const me = await agent.get("/api/auth/me");
  assert.match(me.body.user.syncError, /Log out and log in again/);
});

test("a GitHub rate limit is reported, keeps the token, and clears on the next good sync", async () => {
  githubAccount("octo");
  const { agent } = await logIn("octo");
  github.failSearchWith = 403;

  const res = await agent.post("/api/me/sync");
  assert.equal(res.status, 429);
  let user = await User.findOne().select("+githubToken");
  assert.ok(user.githubToken);
  assert.match(user.syncError, /slow down/);

  github.failSearchWith = null;
  await clearCooldown("octo");
  assert.equal((await agent.post("/api/me/sync")).status, 200);
  user = await User.findOne();
  assert.equal(user.syncError, undefined);
});

test("background sync picks up new users and leaves fresh ones alone", async () => {
  githubAccount("fresh");
  githubAccount("stale");
  githubAccount("never");
  await logIn("fresh");
  await logIn("stale");
  await logIn("never");
  githubPr("never", "org/repo");
  githubPr("stale", "org/repo");

  const now = Date.now();
  await User.updateOne({ loginLower: "fresh" }, { lastSyncedAt: new Date(now - HOUR) });
  await User.updateOne({ loginLower: "stale" }, { lastSyncedAt: new Date(now - 7 * HOUR) });

  await syncDueUsers();

  const synced = github.searches.map((s) => s.q.match(/author:(\S+)/)[1]);
  assert.deepEqual(synced, ["never", "stale"]); // never-synced first, fresh skipped
  assert.equal(await PullRequest.countDocuments(), 2);
});

test("background sync skips banned users, recent failures and users without a token", async () => {
  for (const login of ["banned", "failed", "notoken", "ok"]) {
    githubAccount(login);
    await logIn(login);
  }
  await User.updateOne({ loginLower: "banned" }, { banned: true });
  await User.updateOne({ loginLower: "failed" }, { lastSyncAttemptAt: new Date() });
  await User.updateOne({ loginLower: "notoken" }, { $unset: { githubToken: 1 } });

  await syncDueUsers();
  const synced = github.searches.map((s) => s.q.match(/author:(\S+)/)[1]);
  assert.deepEqual(synced, ["ok"]);
});

test("one failing user does not stop the background sync for the others", async () => {
  githubAccount("broken");
  githubAccount("fine");
  await logIn("broken");
  await logIn("fine");
  delete github.profiles["token-for-broken"];

  await syncDueUsers();
  assert.ok((await User.findOne({ loginLower: "fine" })).lastSyncedAt);
  assert.ok((await User.findOne({ loginLower: "broken" })).syncError);
});

test("background sync handles at most 5 users per round", async () => {
  for (let i = 0; i < 8; i++) {
    githubAccount(`user${i}`);
    await logIn(`user${i}`);
  }
  await syncDueUsers();
  assert.equal(await User.countDocuments({ lastSyncedAt: { $ne: null } }), 5);
  await syncDueUsers();
  assert.equal(await User.countDocuments({ lastSyncedAt: { $ne: null } }), 8);
});
