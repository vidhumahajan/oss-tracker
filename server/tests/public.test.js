import { test } from "node:test";
import assert from "node:assert/strict";
import {
  app,
  request,
  useDatabase,
  githubAccount,
  logIn,
  memberWithPrs,
  User,
  PullRequest,
} from "./helpers.js";
import { BlockedRepo } from "../src/models/BlockedRepo.js";
import { Announcement } from "../src/models/Announcement.js";

useDatabase();

// alice: 3 merged this week in 2 repos. bob: 3 merged in 1 repo (1 this week, 2 older).
// carol: 1 merged long ago. dave: only an open PR.
async function seedCommunity() {
  const alice = await memberWithPrs("alice", [
    { repo: "org/one", daysAgo: 1 },
    { repo: "org/one", daysAgo: 2 },
    { repo: "org/two", daysAgo: 3 },
    { repo: "org/two", state: "open" },
    { repo: "org/two", state: "closed" },
  ]);
  const bob = await memberWithPrs("bob", [
    { repo: "org/one", daysAgo: 2 },
    { repo: "org/one", daysAgo: 20 },
    { repo: "org/one", daysAgo: 200 },
  ]);
  const carol = await memberWithPrs("carol", [{ repo: "org/three", daysAgo: 400 }]);
  const dave = await memberWithPrs("dave", [{ repo: "org/one", state: "open" }]);
  return { alice, bob, carol, dave };
}

const names = (res) => res.body.rows.map((row) => `${row.rank}.${row.user.login}:${row.merged}`);

test("leaderboard ranks by merged PRs in each time window", async () => {
  await seedCommunity();

  const week = await request(app).get("/api/leaderboard?window=week");
  assert.deepEqual(names(week), ["1.alice:3", "2.bob:1"]);

  const month = await request(app).get("/api/leaderboard?window=month");
  assert.deepEqual(names(month), ["1.alice:3", "2.bob:2"]);

  // Tie on 3 merged: alice contributed to more repos, so she ranks first.
  const all = await request(app).get("/api/leaderboard?window=all");
  assert.deepEqual(names(all), ["1.alice:3", "2.bob:3", "3.carol:1"]);
  assert.equal(all.body.rows[0].repoCount, 2);
  assert.equal(all.body.total, 3); // dave has nothing merged, so he is not listed
});

test("an unknown window falls back to month", async () => {
  await seedCommunity();
  const res = await request(app).get("/api/leaderboard?window=banana");
  assert.equal(res.body.window, "month");
});

test("the leaderboard tells a logged-in user their own rank", async () => {
  const { bob, dave } = await seedCommunity();
  const forBob = await bob.agent.get("/api/leaderboard?window=all");
  assert.deepEqual(forBob.body.me, { rank: 2, merged: 3 });

  const forDave = await dave.agent.get("/api/leaderboard?window=all");
  assert.equal(forDave.body.me, null);
  assert.equal((await request(app).get("/api/leaderboard")).body.me, null);
});

test("leaderboard pages hold 25 people and ranks continue across pages", async () => {
  for (let i = 0; i < 27; i++) {
    const prs = Array.from({ length: 30 - i }, () => ({ repo: "org/one" }));
    await memberWithPrs(`user${String(i).padStart(2, "0")}`, prs);
  }
  const first = await request(app).get("/api/leaderboard?window=all");
  assert.equal(first.body.rows.length, 25);
  assert.equal(first.body.totalPages, 2);

  const second = await request(app).get("/api/leaderboard?window=all&page=2");
  assert.deepEqual(names(second), ["26.user25:5", "27.user26:4"]);
});

test("excluded PRs and blocked repos do not count anywhere", async () => {
  const { alice } = await seedCommunity();
  // Exclude one of alice's PRs and block the repo where her other merges are not.
  await PullRequest.updateOne({ author: alice.user._id, repoKey: "org/two", state: "merged" }, { excluded: true });
  await BlockedRepo.create({ repoKey: "org/three" });

  const all = await request(app).get("/api/leaderboard?window=all");
  assert.deepEqual(names(all), ["1.bob:3", "2.alice:2"]); // carol's only repo is blocked

  const profile = await request(app).get("/api/users/alice");
  assert.equal(profile.body.stats.merged, 2);
  assert.equal(profile.body.stats.repoCount, 1);

  const stats = await request(app).get("/api/stats");
  assert.equal(stats.body.merged, 5);

  const feed = await request(app).get("/api/feed");
  assert.equal(feed.body.items.length, 5);
  assert.ok(feed.body.items.every((item) => item.repo !== "org/three"));
});

test("the PR list marks which PRs count and why not", async () => {
  const { alice } = await seedCommunity();
  await PullRequest.updateOne({ author: alice.user._id, repoKey: "org/two", state: "merged" }, { excluded: true });
  await BlockedRepo.create({ repoKey: "org/one" });

  const res = await request(app).get("/api/users/alice/prs");
  assert.equal(res.body.total, 5);
  const byRepoState = (repo, state) => res.body.items.find((pr) => pr.repo === repo && pr.state === state);
  assert.equal(byRepoState("org/two", "merged").counts, false);
  assert.equal(byRepoState("org/two", "merged").excluded, true);
  assert.equal(byRepoState("org/one", "merged").counts, false);
  assert.equal(byRepoState("org/one", "merged").repoBlocked, true);
  assert.equal(byRepoState("org/two", "open").counts, false);
});

test("profile shows stats, top repos, 12 months of activity and all-time rank", async () => {
  await seedCommunity();
  const res = await request(app).get("/api/users/ALICE"); // any letter case works
  assert.equal(res.status, 200);
  assert.equal(res.body.user.login, "alice");
  assert.deepEqual(
    { merged: res.body.stats.merged, open: res.body.stats.open, closed: res.body.stats.closed },
    { merged: 3, open: 1, closed: 1 }
  );
  assert.deepEqual(res.body.stats.topRepos, [
    { repo: "org/one", merged: 2 },
    { repo: "org/two", merged: 1 },
  ]);
  assert.equal(res.body.stats.activity.length, 12);
  assert.equal(res.body.stats.activity.reduce((sum, m) => sum + m.merged, 0), 3);
  assert.equal(res.body.rank, 1);

  const dave = await request(app).get("/api/users/dave");
  assert.equal(dave.body.rank, null);
});

test("PR list filters by state and pages by 20", async () => {
  const prs = Array.from({ length: 23 }, (_, i) => ({ repo: "org/one", daysAgo: i }));
  await memberWithPrs("octo", [...prs, { repo: "org/one", state: "open" }]);

  const merged = await request(app).get("/api/users/octo/prs?state=merged");
  assert.equal(merged.body.total, 23);
  assert.equal(merged.body.items.length, 20);
  assert.equal(merged.body.totalPages, 2);

  const page2 = await request(app).get("/api/users/octo/prs?state=merged&page=2");
  assert.equal(page2.body.items.length, 3);

  const open = await request(app).get("/api/users/octo/prs?state=open");
  assert.equal(open.body.total, 1);
});

test("a profile that does not exist is a 404", async () => {
  const res = await request(app).get("/api/users/nobody");
  assert.equal(res.status, 404);
});

test("the profile response never includes tokens or internal fields", async () => {
  await seedCommunity();
  const res = await request(app).get("/api/users/alice");
  const text = JSON.stringify(res.body);
  assert.ok(!text.includes("githubToken"));
  assert.ok(!text.includes("token-for-"));
  assert.ok(!text.includes("syncError"));
});

test("a private profile is hidden from others, the leaderboard, the feed and the totals", async () => {
  const { alice, bob } = await seedCommunity();
  const res = await alice.agent.patch("/api/me").send({ isPublic: false });
  assert.equal(res.body.user.isPublic, false);

  // Others get the same answer as for an account that does not exist.
  assert.equal((await request(app).get("/api/users/alice")).status, 404);
  assert.equal((await bob.agent.get("/api/users/alice")).status, 404);
  assert.equal((await bob.agent.get("/api/users/alice/prs")).status, 404);

  // She can still see her own profile.
  assert.equal((await alice.agent.get("/api/users/alice")).status, 200);

  const all = await request(app).get("/api/leaderboard?window=all");
  assert.deepEqual(names(all), ["1.bob:3", "2.carol:1"]);
  const feed = await request(app).get("/api/feed");
  assert.ok(feed.body.items.every((item) => item.author.login !== "alice"));
  assert.equal((await request(app).get("/api/stats")).body.merged, 4);

  // And switching back works.
  await alice.agent.patch("/api/me").send({ isPublic: true });
  assert.equal((await request(app).get("/api/users/alice")).status, 200);
});

test("the privacy switch only accepts true or false", async () => {
  const { agent } = await memberWithPrs("octo", []);
  for (const bad of ["yes", 1, null, { $ne: true }]) {
    const res = await agent.patch("/api/me").send({ isPublic: bad });
    assert.equal(res.status, 400);
  }
  assert.equal((await request(app).patch("/api/me").send({ isPublic: false })).status, 401);
});

test("a banned user disappears from public pages", async () => {
  await seedCommunity();
  await User.updateOne({ loginLower: "alice" }, { banned: true });

  assert.equal((await request(app).get("/api/users/alice")).status, 404);
  const all = await request(app).get("/api/leaderboard?window=all");
  assert.deepEqual(names(all), ["1.bob:3", "2.carol:1"]);
  assert.equal((await request(app).get("/api/stats")).body.members, 3);
});

test("deleting my account removes me and my PRs, and logs me out", async () => {
  const { alice, bob } = await seedCommunity();
  const res = await alice.agent.delete("/api/me");
  assert.equal(res.status, 200);

  assert.equal(await User.countDocuments({ loginLower: "alice" }), 0);
  assert.equal(await PullRequest.countDocuments({ author: alice.user._id }), 0);
  assert.equal((await alice.agent.get("/api/auth/me")).body.user, null);
  assert.equal((await request(app).get("/api/users/alice")).status, 404);

  // Nobody else is affected.
  assert.equal(await PullRequest.countDocuments({ author: bob.user._id }), 3);
  assert.equal((await request(app).delete("/api/me")).status, 401);
});

test("feed lists the newest merges first with their authors", async () => {
  await seedCommunity();
  const res = await request(app).get("/api/feed");
  assert.equal(res.body.items.length, 7);
  assert.equal(res.body.items[0].author.login, "alice");
  const times = res.body.items.map((item) => new Date(item.mergedAt).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
});

test("platform totals count members, merged PRs and repos", async () => {
  await seedCommunity();
  const res = await request(app).get("/api/stats");
  assert.deepEqual(res.body, { members: 4, merged: 7, repos: 3 });
});

test("announcements are public and newest first, at most 5", async () => {
  for (let i = 1; i <= 6; i++) {
    await Announcement.create({ title: `News ${i}`, body: "Hello", createdAt: new Date(2026, 0, i) });
  }
  const res = await request(app).get("/api/announcements");
  assert.equal(res.body.items.length, 5);
  assert.equal(res.body.items[0].title, "News 6");
});
