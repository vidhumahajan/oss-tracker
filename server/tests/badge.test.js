import { test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { app, request, useDatabase, github, memberWithPrs, writeAccessCode, User } from "./helpers.js";
import { config } from "../src/config.js";
import { NEUTRAL_BADGE } from "../src/services/badge.js";

useDatabase();

// Tests run with APP_URL on localhost and no badge app, so "Add it for me"
// is off. This switches it on: a public address and both badge settings.
const original = { appUrl: config.appUrl, id: config.badgeClientId, secret: config.badgeClientSecret };
function turnOnAddForMe() {
  config.appUrl = "https://oss.example";
  config.badgeClientId = "badge-id";
  config.badgeClientSecret = "badge-secret";
}
afterEach(() => {
  config.appUrl = original.appUrl;
  config.badgeClientId = original.id;
  config.badgeClientSecret = original.secret;
});

const LINE = "[![OSS Tracker](https://oss.example/api/badge/alice.svg)](https://oss.example/u/alice)";

// supertest hands an image back as bytes, so this turns the SVG into text.
const getBadge = async (login) => {
  const res = await request(app).get(`/api/badge/${login}.svg`);
  return { ...res, svg: res.body.toString("utf8") };
};
const badge = async (login) => (await getBadge(login)).svg;

// Presses "Add it for me", approves on GitHub, and lands back on the site.
// code decides which GitHub account the new token belongs to.
async function addForMe(member, { code = writeAccessCode("write-alice", "alice"), state } = {}) {
  const start = await member.agent.get("/api/badge/connect");
  const realState = new URL(start.headers.location).searchParams.get("state");
  return member.agent.get(`/api/badge/callback?code=${code}&state=${state ?? realState}`);
}

// ---------- The image ----------

test("the badge shows merged PRs and the all-time rank, with the right headers", async () => {
  await memberWithPrs("alice", [{ repo: "org/one" }, { repo: "org/two" }, { repo: "org/one", daysAgo: 400 }]);
  await memberWithPrs("bob", [{ repo: "org/one" }]);

  const res = await getBadge("alice");
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /^image\/svg\+xml/);
  assert.equal(res.headers["cache-control"], "public, max-age=3600");
  assert.equal(res.headers["cross-origin-resource-policy"], "cross-origin");
  assert.match(res.svg, /^<svg /);
  assert.ok(res.svg.includes(">3 merged PRs, #1 all time<"));

  assert.ok((await badge("bob")).includes(">1 merged PR, #2 all time<"));
  // The username's case does not matter.
  assert.ok((await badge("ALICE")).includes(">3 merged PRs, #1 all time<"));
});

test("a member with no merged PRs gets the member wording", async () => {
  await memberWithPrs("alice", [{ repo: "org/one", state: "open" }]);
  const svg = await badge("alice");
  assert.ok(svg.includes(">OSS Tracker member<"));
  assert.ok(!svg.includes("merged"));
});

test("private, banned and unknown profiles all get the same neutral badge", async () => {
  await memberWithPrs("hidden", [{ repo: "org/one" }]);
  await memberWithPrs("banned", [{ repo: "org/one" }]);
  await User.updateOne({ loginLower: "hidden" }, { isPublic: false });
  await User.updateOne({ loginLower: "banned" }, { banned: true });

  assert.ok(NEUTRAL_BADGE.includes(">view profile<"));
  for (const login of ["hidden", "banned", "nobody", "not_a_login", "a".repeat(40)]) {
    const res = await getBadge(login);
    assert.equal(res.status, 200, login);
    assert.equal(res.svg, NEUTRAL_BADGE, login);
  }
});

test("no name, username or other member text ever goes into the SVG", async () => {
  await memberWithPrs("alice", [{ repo: "org/one", title: "<script>alert(1)</script>" }]);
  await User.updateOne({ loginLower: "alice" }, { name: '<img src=x onerror="alert(1)">' });
  const svg = await badge("alice");
  assert.ok(!svg.toLowerCase().includes("alice"));
  assert.ok(!svg.includes("script"));
  assert.ok(!svg.includes("onerror"));
  assert.ok(!svg.includes("org/one"));
});

// ---------- When "Add it for me" is available ----------

test("visitors cannot start adding the badge", async () => {
  turnOnAddForMe();
  const res = await request(app).get("/api/badge/connect");
  assert.equal(res.status, 401);
  assert.equal((await request(app).get("/api/badge")).status, 401);
  assert.equal((await request(app).post("/api/badge/check")).status, 401);
});

test("without both settings, or on localhost, adding it automatically is off", async () => {
  const alice = await memberWithPrs("alice", []);
  const available = async () => (await alice.agent.get("/api/badge")).body.autoAvailable;

  // Tests start on localhost with no badge app.
  assert.equal(await available(), false);
  assert.equal((await alice.agent.get("/api/badge/connect")).status, 503);

  turnOnAddForMe();
  assert.equal(await available(), true);

  config.badgeClientSecret = "";
  assert.equal(await available(), false);
  assert.equal((await alice.agent.get("/api/badge/connect")).status, 503);

  turnOnAddForMe();
  for (const appUrl of ["http://localhost:5173", "http://127.0.0.1:4000", "http://oss.localhost"]) {
    config.appUrl = appUrl;
    assert.equal(await available(), false, appUrl);
    assert.equal((await alice.agent.get("/api/badge/connect")).status, 503, appUrl);
  }
  // Nothing reached GitHub.
  assert.deepEqual(github.tokenExchanges.filter((t) => t.clientId === "badge-id"), []);
});

test("the panel gets the badge line, and addedAt stays empty until the badge is added", async () => {
  turnOnAddForMe();
  const alice = await memberWithPrs("alice", []);
  const res = await alice.agent.get("/api/badge");
  assert.deepEqual(res.body, { addedAt: null, autoAvailable: true, line: LINE });
});

test("connect sends the member to GitHub with the badge app and only the public_repo scope", async () => {
  turnOnAddForMe();
  const alice = await memberWithPrs("alice", []);
  const res = await alice.agent.get("/api/badge/connect");
  assert.equal(res.status, 302);

  const url = new URL(res.headers.location);
  assert.equal(url.origin + url.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "badge-id");
  assert.equal(url.searchParams.get("scope"), "public_repo");
  assert.equal(url.searchParams.get("redirect_uri"), "https://oss.example/api/badge/callback");
  const cookie = res.headers["set-cookie"].find((c) => c.startsWith("badge_state="));
  assert.ok(cookie.includes(url.searchParams.get("state")));
  assert.match(cookie, /HttpOnly/);
});

// ---------- The flow ----------

test("a member with no profile repo gets one, with the badge in its README", async () => {
  turnOnAddForMe();
  const alice = await memberWithPrs("alice", []);
  const res = await addForMe(alice);

  assert.equal(res.headers.location, "https://oss.example/u/alice?badge=added");
  assert.deepEqual(github.writes[0], { kind: "create_repo", repo: "alice/alice", private: false });
  const save = github.writes[1];
  assert.equal(save.path, "README.md");
  assert.equal(save.message, "Add OSS Tracker badge");
  assert.equal(save.text, `${LINE}\n\n# alice\n`);
  assert.ok((await User.findOne({ loginLower: "alice" })).badgeAddedAt);
  assert.ok((await alice.agent.get("/api/badge")).body.addedAt);
});

test("an existing README gets the badge at the very top, with its content untouched", async () => {
  turnOnAddForMe();
  const alice = await memberWithPrs("alice", []);
  const old = "### Hi there\r\n\r\nI write Go.\n\n![stats](https://example.com/x.svg)\n";
  github.repos["alice/alice"] = { readme: { path: "README.md", text: old, sha: "sha-old" } };

  await addForMe(alice);
  assert.equal(github.writes.length, 1); // no new repo
  assert.equal(github.writes[0].sha, "sha-old");
  assert.equal(github.writes[0].text, `${LINE}\n\n${old}`);
  assert.equal(github.repos["alice/alice"].readme.text.slice(LINE.length + 2), old);
});

test("a profile repo without a README gets a README.md with the badge line", async () => {
  turnOnAddForMe();
  const alice = await memberWithPrs("alice", []);
  github.repos["alice/alice"] = { readme: null };
  await addForMe(alice);
  assert.deepEqual(
    github.writes.map((w) => [w.kind, w.path, w.text]),
    [["save_file", "README.md", `${LINE}\n`]]
  );
});

test("running the flow twice does not add a second badge", async () => {
  turnOnAddForMe();
  const alice = await memberWithPrs("alice", []);
  await addForMe(alice);
  const after = github.repos["alice/alice"].readme.text;
  const writes = github.writes.length;

  const again = await addForMe(alice);
  assert.equal(again.headers.location, "https://oss.example/u/alice?badge=added");
  assert.equal(github.writes.length, writes);
  assert.equal(github.repos["alice/alice"].readme.text, after);
  assert.equal(after.split("api/badge/alice.svg").length, 2); // exactly one badge
  assert.equal(github.grantsDeleted.length, 2);
});

test("a token that belongs to another GitHub account changes nothing", async () => {
  turnOnAddForMe();
  const alice = await memberWithPrs("alice", []);
  await memberWithPrs("bob", []);
  const res = await addForMe(alice, { code: writeAccessCode("write-bob", "bob") });

  assert.equal(res.headers.location, "https://oss.example/?badge=wrong_account");
  assert.deepEqual(github.writes, []);
  assert.equal((await User.findOne({ loginLower: "alice" })).badgeAddedAt, undefined);
  assert.deepEqual(github.grantsDeleted.map((g) => g.token), ["token-for-write-bob"]);
});

test("cancelling on GitHub, or a wrong state, changes nothing", async () => {
  turnOnAddForMe();
  const alice = await memberWithPrs("alice", []);

  const start = await alice.agent.get("/api/badge/connect");
  const state = new URL(start.headers.location).searchParams.get("state");
  const cancelled = await alice.agent.get(`/api/badge/callback?error=access_denied&state=${state}`);
  assert.equal(cancelled.headers.location, "https://oss.example/?badge=unchanged");

  const wrong = await addForMe(alice, { state: "not-the-state" });
  assert.equal(wrong.headers.location, "https://oss.example/?badge=unchanged");

  // No state cookie at all, for example a link someone else sent.
  const noCookie = await request(app).get(`/api/badge/callback?code=write-alice&state=${state}`);
  assert.equal(noCookie.headers.location, "https://oss.example/?badge=unchanged");

  assert.deepEqual(github.tokenExchanges.filter((t) => t.clientId === "badge-id"), []);
  assert.deepEqual(github.writes, []);
});

test("the permission is cancelled on success and on every failure after the token exists", async () => {
  turnOnAddForMe();
  const alice = await memberWithPrs("alice", []);
  mock.method(console, "error", () => {});

  // Success.
  await addForMe(alice);
  // GitHub refuses to save the file.
  github.repos["alice/alice"] = { readme: { path: "README.md", text: "hi\n", sha: "s1" } };
  github.failWritesWith = 500;
  assert.equal((await addForMe(alice)).headers.location, "https://oss.example/?badge=failed");
  // GitHub refuses to create the repo.
  delete github.repos["alice/alice"];
  github.failWritesWith = 403;
  assert.equal((await addForMe(alice)).headers.location, "https://oss.example/?badge=failed");
  github.failWritesWith = null;
  // The token works for nothing, so asking who it belongs to fails.
  assert.equal((await addForMe(alice, { code: "write-nobody" })).headers.location, "https://oss.example/?badge=failed");

  assert.equal(github.grantsDeleted.length, 4);
  for (const grant of github.grantsDeleted) {
    assert.equal(grant.clientId, "badge-id");
    assert.equal(grant.clientSecret, "badge-secret");
  }

  // A code GitHub rejects never becomes a token, so there is nothing to cancel.
  assert.equal((await addForMe(alice, { code: "bad" })).headers.location, "https://oss.example/?badge=failed");
  assert.equal(github.grantsDeleted.length, 4);
});

test("the write token is never saved, logged or sent to the browser", async () => {
  turnOnAddForMe();
  const alice = await memberWithPrs("alice", []);
  const logged = [];
  mock.method(console, "error", (...args) => logged.push(args.join(" ")));
  mock.method(console, "log", (...args) => logged.push(args.join(" ")));

  const ok = await addForMe(alice);
  delete github.repos["alice/alice"]; // so the second run has to write, and fails
  github.failWritesWith = 500;
  const failed = await addForMe(alice, { code: writeAccessCode("write-alice-2", "alice") });

  const saved = await User.findOne({ loginLower: "alice" }).select("+githubToken").lean();
  const everything = JSON.stringify([saved, logged, ok.headers, ok.text, failed.headers, failed.text]);
  assert.ok(!everything.includes("token-for-write-alice"));
  assert.ok(logged.length > 0); // the failure was logged, without the token
});

// ---------- "I already added it myself" ----------

test("'I already added it myself' only marks the badge as added when the README has it", async () => {
  const alice = await memberWithPrs("alice", []);
  const localLine = "[![OSS Tracker](http://localhost:5173/api/badge/alice.svg)](http://localhost:5173/u/alice)";

  // No profile repo yet.
  let res = await alice.agent.post("/api/badge/check");
  assert.equal(res.status, 404);
  assert.equal(res.body.error.message, "We could not find the badge in your profile README yet.");

  // A README without the badge, or with another member's badge.
  github.repos["alice/alice"] = { readme: { path: "README.md", text: "Hello\n", sha: "s" } };
  assert.equal((await alice.agent.post("/api/badge/check")).status, 404);
  github.repos["alice/alice"].readme.text = localLine.replaceAll("alice", "bob");
  assert.equal((await alice.agent.post("/api/badge/check")).status, 404);
  assert.equal((await User.findOne({ loginLower: "alice" })).badgeAddedAt, undefined);

  // The real badge, pasted somewhere in the middle.
  github.repos["alice/alice"].readme.text = `Hello\n\n${localLine}\n\nBye\n`;
  res = await alice.agent.post("/api/badge/check");
  assert.equal(res.status, 200);
  assert.ok((await User.findOne({ loginLower: "alice" })).badgeAddedAt);
  // It only read: nothing was written and no write permission was asked for.
  assert.deepEqual(github.writes, []);
  assert.deepEqual(github.tokenExchanges.filter((t) => t.clientId === "badge-id"), []);
});
