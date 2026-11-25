import { test } from "node:test";
import assert from "node:assert/strict";
import {
  app,
  request,
  useDatabase,
  github,
  githubAccount,
  githubPr,
  logIn,
  memberWithPrs,
  User,
  PullRequest,
} from "./helpers.js";
import { AdminLog } from "../src/models/AdminLog.js";
import { BlockedRepo } from "../src/models/BlockedRepo.js";

useDatabase();

// "the-owner" is listed in ADMIN_LOGINS in tests/setup.js.
async function setup() {
  const owner = await memberWithPrs("the-owner", []);
  const alice = await memberWithPrs("alice", [
    { repo: "org/one", daysAgo: 1 },
    { repo: "org/one", daysAgo: 2 },
    { repo: "spam/farm", daysAgo: 3 },
  ]);
  const bob = await memberWithPrs("bob", [{ repo: "spam/farm", daysAgo: 1 }]);
  return { owner, alice, bob };
}

const actions = async () => (await AdminLog.find().sort({ createdAt: 1 })).map((e) => `${e.adminLogin}:${e.action}:${e.target}`);

test("every admin route refuses visitors and ordinary members", async () => {
  const { alice } = await setup();
  const id = alice.user.id;
  const routes = [
    ["get", "/api/admin/overview"],
    ["get", "/api/admin/users"],
    ["get", "/api/admin/users.csv"],
    ["patch", `/api/admin/users/${id}`],
    ["post", `/api/admin/users/${id}/sync`],
    ["get", "/api/admin/repos"],
    ["get", "/api/admin/blocked-repos"],
    ["post", "/api/admin/blocked-repos"],
    ["delete", "/api/admin/blocked-repos/spam/farm"],
    ["patch", `/api/admin/prs/${id}`],
    ["post", "/api/admin/announcements"],
    ["delete", `/api/admin/announcements/${id}`],
    ["get", "/api/admin/log"],
  ];
  for (const [method, path] of routes) {
    assert.equal((await request(app)[method](path)).status, 401, `visitor ${method} ${path}`);
    assert.equal((await alice.agent[method](path)).status, 403, `member ${method} ${path}`);
  }
  assert.equal(await AdminLog.countDocuments(), 0);
});

test("overview counts members, activity and sync health", async () => {
  const { owner } = await setup();
  await User.updateOne({ loginLower: "bob" }, { syncError: "boom" });
  githubAccount("newbie");
  await logIn("newbie"); // logged in, never synced

  const res = await owner.agent.get("/api/admin/overview");
  assert.deepEqual(res.body, {
    members: 4,
    newThisWeek: 4,
    activeThisWeek: 2,
    banned: 0,
    admins: 1,
    syncErrors: 1,
    neverSynced: 1,
    mergedTotal: 4,
    mergedThisWeek: 4,
    blockedRepos: 0,
  });
});

test("member list shows merged counts and supports search and filters", async () => {
  const { owner } = await setup();
  const all = await owner.agent.get("/api/admin/users");
  assert.equal(all.body.total, 3);
  const alice = all.body.items.find((u) => u.login === "alice");
  assert.equal(alice.merged, 3);
  assert.equal(all.body.items.find((u) => u.login === "the-owner").isOwner, true);

  const search = await owner.agent.get("/api/admin/users?search=ALI");
  assert.deepEqual(search.body.items.map((u) => u.login), ["alice"]);

  const admins = await owner.agent.get("/api/admin/users?filter=admins");
  assert.deepEqual(admins.body.items.map((u) => u.login), ["the-owner"]);
});

test("search text is treated as plain text, not as a pattern or a query", async () => {
  const { owner } = await setup();
  const dots = await owner.agent.get("/api/admin/users?search=.*");
  assert.equal(dots.body.total, 0);
  const broken = await owner.agent.get("/api/admin/users?search=(((");
  assert.equal(broken.status, 200);
  const injected = await owner.agent.get("/api/admin/users?search[$ne]=x");
  assert.equal(injected.status, 200);
  assert.equal(injected.body.total, 3); // ignored, not run as a database operator
});

test("an admin can promote and demote members, and both are logged", async () => {
  const { owner, alice } = await setup();
  const promote = await owner.agent.patch(`/api/admin/users/${alice.user.id}`).send({ role: "admin" });
  assert.equal(promote.body.item.role, "admin");
  assert.equal((await alice.agent.get("/api/admin/overview")).status, 200);

  await owner.agent.patch(`/api/admin/users/${alice.user.id}`).send({ role: "member" });
  assert.equal((await alice.agent.get("/api/admin/overview")).status, 403);

  assert.deepEqual(await actions(), ["the-owner:make_admin:alice", "the-owner:remove_admin:alice"]);
});

test("banning removes the admin role and locks the user out at once", async () => {
  const { owner, alice } = await setup();
  await owner.agent.patch(`/api/admin/users/${alice.user.id}`).send({ role: "admin" });
  const ban = await owner.agent.patch(`/api/admin/users/${alice.user.id}`).send({ banned: true });
  assert.equal(ban.body.item.banned, true);
  assert.equal(ban.body.item.role, "member");

  assert.equal((await alice.agent.get("/api/admin/overview")).status, 403);
  assert.equal((await alice.agent.post("/api/me/sync")).status, 403);

  const unban = await owner.agent.patch(`/api/admin/users/${alice.user.id}`).send({ banned: false });
  assert.equal(unban.body.item.banned, false);
  assert.equal(unban.body.item.role, "member"); // unbanning does not restore admin
});

test("an admin cannot change themselves or an owner", async () => {
  const { owner, alice } = await setup();
  const self = await owner.agent.patch(`/api/admin/users/${owner.user.id}`).send({ banned: true });
  assert.equal(self.status, 400);

  await owner.agent.patch(`/api/admin/users/${alice.user.id}`).send({ role: "admin" });
  const coup = await alice.agent.patch(`/api/admin/users/${owner.user.id}`).send({ banned: true });
  assert.equal(coup.status, 403);
  const demote = await alice.agent.patch(`/api/admin/users/${owner.user.id}`).send({ role: "member" });
  assert.equal(demote.status, 403);

  const fresh = await User.findById(owner.user.id);
  assert.equal(fresh.banned, false);
  assert.equal(fresh.role, "admin");
});

test("bad input to the member update is rejected", async () => {
  const { owner, alice } = await setup();
  const url = `/api/admin/users/${alice.user.id}`;
  assert.equal((await owner.agent.patch(url).send({ role: "superuser" })).status, 400);
  assert.equal((await owner.agent.patch(url).send({ banned: "yes" })).status, 400);
  assert.equal((await owner.agent.patch("/api/admin/users/not-an-id").send({ banned: true })).status, 404);
  assert.equal((await owner.agent.patch("/api/admin/users/000000000000000000000000").send({ banned: true })).status, 404);
  assert.equal(await AdminLog.countDocuments(), 0);
});

test("repos list shows PR and contributor counts, busiest first", async () => {
  const { owner } = await setup();
  const res = await owner.agent.get("/api/admin/repos");
  assert.deepEqual(
    res.body.items.map((r) => `${r.repo}:${r.merged}:${r.contributors}:${r.blocked}`),
    ["org/one:2:1:false", "spam/farm:2:2:false"]
  );
  const search = await owner.agent.get("/api/admin/repos?search=SPAM");
  assert.deepEqual(search.body.items.map((r) => r.repo), ["spam/farm"]);
});

test("blocking a repo removes its PRs from scores, unblocking restores them", async () => {
  const { owner } = await setup();
  const block = await owner.agent.post("/api/admin/blocked-repos").send({ repo: "Spam/Farm", reason: "PR farming" });
  assert.equal(block.status, 201);

  let board = await request(app).get("/api/leaderboard?window=all");
  assert.deepEqual(board.body.rows.map((r) => `${r.user.login}:${r.merged}`), ["alice:2"]);
  assert.equal((await owner.agent.get("/api/admin/repos?search=spam")).body.items[0].blocked, true);
  assert.equal((await owner.agent.get("/api/admin/blocked-repos")).body.items[0].blockedBy, "the-owner");

  assert.equal((await owner.agent.post("/api/admin/blocked-repos").send({ repo: "spam/farm" })).status, 409);

  const unblock = await owner.agent.delete("/api/admin/blocked-repos/spam/farm");
  assert.equal(unblock.status, 200);
  board = await request(app).get("/api/leaderboard?window=all");
  assert.deepEqual(board.body.rows.map((r) => `${r.user.login}:${r.merged}`), ["alice:3", "bob:1"]);

  assert.deepEqual(await actions(), ["the-owner:block_repo:spam/farm", "the-owner:unblock_repo:spam/farm"]);
});

test("a blocked repo name must look like owner/name", async () => {
  const { owner } = await setup();
  for (const repo of ["", "noslash", "a/b/c", "has space/x", 42, { $gt: "" }]) {
    const res = await owner.agent.post("/api/admin/blocked-repos").send({ repo });
    assert.equal(res.status, 400, JSON.stringify(repo));
  }
  assert.equal(await BlockedRepo.countDocuments(), 0);
  assert.equal((await owner.agent.delete("/api/admin/blocked-repos/not/blocked")).status, 404);
});

test("excluding one PR lowers the score and is logged", async () => {
  const { owner, alice } = await setup();
  const pr = await PullRequest.findOne({ author: alice.user._id, repoKey: "org/one" });

  const res = await owner.agent.patch(`/api/admin/prs/${pr.id}`).send({ excluded: true });
  assert.equal(res.status, 200);
  assert.equal((await request(app).get("/api/users/alice")).body.stats.merged, 2);

  await owner.agent.patch(`/api/admin/prs/${pr.id}`).send({ excluded: false });
  assert.equal((await request(app).get("/api/users/alice")).body.stats.merged, 3);

  const log = await actions();
  assert.equal(log[0], `the-owner:exclude_pr:org/one#${pr.number}`);
  assert.equal(log[1], `the-owner:include_pr:org/one#${pr.number}`);
  assert.equal((await owner.agent.patch(`/api/admin/prs/${pr.id}`).send({ excluded: "y" })).status, 400);
});

test("an admin can force a sync for a member", async () => {
  const { owner, bob } = await setup();
  githubPr("bob", "org/one");
  const res = await owner.agent.post(`/api/admin/users/${bob.user.id}/sync`);
  assert.equal(res.status, 200);
  assert.equal(res.body.item.merged, 2);
  assert.ok((await actions()).includes("the-owner:sync_user:bob"));
  assert.equal(github.searches.at(-1).q.startsWith("author:bob "), true);
});

test("announcements can be posted and deleted by admins, with size limits", async () => {
  const { owner } = await setup();
  const post = await owner.agent.post("/api/admin/announcements").send({ title: "  GSoC orgs are out  ", body: "Check the list." });
  assert.equal(post.status, 201);
  assert.equal(post.body.item.title, "GSoC orgs are out");
  assert.equal((await request(app).get("/api/announcements")).body.items.length, 1);

  assert.equal((await owner.agent.post("/api/admin/announcements").send({ title: "", body: "x" })).status, 400);
  assert.equal((await owner.agent.post("/api/admin/announcements").send({ title: "x".repeat(121), body: "x" })).status, 400);
  assert.equal((await owner.agent.post("/api/admin/announcements").send({ title: "x", body: "x".repeat(2001) })).status, 400);

  const del = await owner.agent.delete(`/api/admin/announcements/${post.body.item.id}`);
  assert.equal(del.status, 200);
  assert.equal((await request(app).get("/api/announcements")).body.items.length, 0);
});

test("a request body over 10kb is rejected", async () => {
  const { owner } = await setup();
  const res = await owner.agent.post("/api/admin/announcements").send({ title: "x", body: "x".repeat(20000) });
  assert.equal(res.status, 413);
});

test("CSV export lists every member and defuses spreadsheet formulas", async () => {
  const { owner } = await setup();
  await User.updateOne({ loginLower: "bob" }, { name: '=HYPERLINK("http://evil","click")' });

  const res = await owner.agent.get("/api/admin/users.csv");
  assert.match(res.headers["content-type"], /text\/csv/);
  const lines = res.text.split("\n");
  assert.equal(lines[0], '"login","name","role","banned","public","merged_prs","joined","last_synced"');
  assert.equal(lines.length, 4);
  const bob = lines.find((line) => line.startsWith('"bob"'));
  assert.ok(bob.includes(`"'=HYPERLINK(""http://evil"",""click"")"`));
  assert.ok((await actions()).includes("the-owner:export_members:3 members"));
});

test("the admin log is readable, newest first", async () => {
  const { owner, alice, bob } = await setup();
  await owner.agent.patch(`/api/admin/users/${alice.user.id}`).send({ banned: true });
  await owner.agent.patch(`/api/admin/users/${bob.user.id}`).send({ role: "admin" });

  const res = await owner.agent.get("/api/admin/log");
  assert.equal(res.body.total, 2);
  assert.deepEqual(res.body.items.map((e) => `${e.admin}:${e.action}:${e.target}`), [
    "the-owner:make_admin:bob",
    "the-owner:ban_user:alice",
  ]);
});
