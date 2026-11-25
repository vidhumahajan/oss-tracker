import { test } from "node:test";
import assert from "node:assert/strict";
import { app, request, useDatabase, memberWithPrs, User, PullRequest } from "./helpers.js";
import { AdminLog } from "../src/models/AdminLog.js";
import { BlockedRepo } from "../src/models/BlockedRepo.js";

useDatabase();

const ROUTE = "/api/admin/weekly-post";
const LINK = "See where you stand: http://localhost:5173/leaderboard";

// n merged PRs this week, each in its own repo.
const thisWeek = (n, repo = "org/r") => Array.from({ length: n }, (_, i) => ({ repo: `${repo}${i}`, daysAgo: 1 + (i % 5) }));

async function postAsOwner() {
  const owner = await memberWithPrs("the-owner", []);
  const res = await owner.agent.get(ROUTE);
  assert.equal(res.status, 200);
  return res.body.text;
}

test("only admins can create the weekly post", async () => {
  const alice = await memberWithPrs("alice", thisWeek(1));
  assert.equal((await request(app).get(ROUTE)).status, 401);
  assert.equal((await alice.agent.get(ROUTE)).status, 403);
  // Reading the post changes nothing, so nothing is logged.
  await postAsOwner();
  assert.equal(await AdminLog.countDocuments(), 0);
});

test("the post lists the top 5 in order, with totals and the leaderboard link", async () => {
  // Merges before this week count for all time, not for this week.
  await memberWithPrs("alice", [...thisWeek(6), { repo: "org/old", daysAgo: 40 }]);
  await memberWithPrs("bob", thisWeek(5));
  await memberWithPrs("carol", thisWeek(4));
  await memberWithPrs("dave", [...thisWeek(3), { repo: "org/old", daysAgo: 40 }]);
  await memberWithPrs("erin", thisWeek(2));
  await memberWithPrs("frank", [...thisWeek(1), { repo: "org/old", daysAgo: 40 }]);
  await memberWithPrs("grace", [{ repo: "org/old", daysAgo: 40 }]);
  // No display name: the username is used.
  await User.updateOne({ login: "bob" }, { name: "" });

  const text = await postAsOwner();
  assert.equal(
    text,
    [
      "OSS Tracker: this week's top 5",
      [
        "1. alice name, 6 merged PRs",
        "2. bob, 5 merged PRs",
        "3. carol name, 4 merged PRs",
        "4. dave name, 3 merged PRs",
        "5. erin name, 2 merged PRs",
      ].join("\n"),
      "6 members merged 21 PRs this week.",
      "First merged PR ever: bob, carol name, erin name. Congrats!",
      LINK,
    ].join("\n\n")
  );
  // Plain text: no markdown stars or underscores, no em dashes.
  assert.doesNotMatch(text, /[*_—]/);
});

test("one merged PR and one member use the singular", async () => {
  await memberWithPrs("alice", [{ repo: "org/one", daysAgo: 2 }]);
  const text = await postAsOwner();
  assert.match(text, /^1\. alice name, 1 merged PR$/m);
  assert.match(text, /^1 member merged 1 PR this week\.$/m);
  assert.match(text, /^First merged PR ever: alice name\. Congrats!$/m);
});

test("first-time mergers are capped at 5 names", async () => {
  // Fewer merges further down the list, so the order is fixed.
  const logins = ["m1", "m2", "m3", "m4", "m5", "m6", "m7"];
  for (const [index, login] of logins.entries()) {
    await memberWithPrs(login, thisWeek(logins.length - index));
  }
  const text = await postAsOwner();
  assert.match(text, /^First merged PR ever: m1 name, m2 name, m3 name, m4 name, m5 name and 2 more\. Congrats!$/m);
});

test("no first-time line when everyone has merged before", async () => {
  await memberWithPrs("alice", [{ repo: "org/one", daysAgo: 1 }, { repo: "org/one", daysAgo: 100 }]);
  const text = await postAsOwner();
  assert.doesNotMatch(text, /First merged PR ever/);
  assert.equal(text.split("\n\n").length, 4);
});

test("banned members, private profiles and uncounted PRs never appear", async () => {
  const banned = await memberWithPrs("banned", thisWeek(9));
  await memberWithPrs("hidden", thisWeek(8));
  await memberWithPrs("spammer", thisWeek(7, "spam/farm"));
  const alice = await memberWithPrs("alice", thisWeek(2));
  await User.updateOne({ _id: banned.user._id }, { banned: true });
  await User.updateOne({ login: "hidden" }, { isPublic: false });
  for (let i = 0; i < 7; i++) await BlockedRepo.create({ repoKey: `spam/farm${i}` });
  // An excluded PR does not count either.
  const one = await PullRequest.findOne({ author: alice.user._id });
  await PullRequest.updateOne({ _id: one._id }, { excluded: true });

  const text = await postAsOwner();
  assert.doesNotMatch(text, /banned|hidden|spammer/);
  assert.match(text, /^1\. alice name, 1 merged PR$/m);
  assert.match(text, /^1 member merged 1 PR this week\.$/m);
  assert.match(text, /^First merged PR ever: alice name\. Congrats!$/m);
});

test("a week with no merges gets a short friendly message with the link", async () => {
  await memberWithPrs("alice", [{ repo: "org/one", daysAgo: 30 }, { repo: "org/two", state: "open", daysAgo: 1 }]);
  const text = await postAsOwner();
  assert.equal(
    text,
    [
      "OSS Tracker: no merged pull requests this week.",
      "A quiet week is a good time to pick up a new issue. Good luck!",
      LINK,
    ].join("\n\n")
  );
});
