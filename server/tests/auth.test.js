import { test } from "node:test";
import assert from "node:assert/strict";
import { app, request, useDatabase, githubAccount, logIn, User } from "./helpers.js";
import { decrypt } from "../src/utils/crypto.js";

useDatabase();

test("health route answers ok", async () => {
  const res = await request(app).get("/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: "ok" });
});

test("unknown API route gives a 404 in the standard error shape", async () => {
  const res = await request(app).get("/api/nope");
  assert.equal(res.status, 404);
  assert.equal(res.body.error.message, "Route not found");
});

test("security headers are set", async () => {
  const res = await request(app).get("/api/health");
  assert.match(res.headers["content-security-policy"], /avatars\.githubusercontent\.com/);
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["x-powered-by"], undefined);
});

test("a visitor asking who they are gets user: null", async () => {
  const res = await request(app).get("/api/auth/me");
  assert.equal(res.status, 200);
  assert.equal(res.body.user, null);
});

test("a fake token is treated as not logged in", async () => {
  const res = await request(app).get("/api/auth/me").set("Cookie", "token=not-a-real-jwt");
  assert.equal(res.body.user, null);
  const protectedRes = await request(app).post("/api/me/sync").set("Cookie", "token=not-a-real-jwt");
  assert.equal(protectedRes.status, 401);
});

test("login start redirects to GitHub, asks for no extra permissions, remembers the state", async () => {
  const res = await request(app).get("/api/auth/github");
  assert.equal(res.status, 302);

  const target = new URL(res.headers.location);
  assert.equal(target.origin + target.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(target.searchParams.get("client_id"), "test-client-id");
  assert.equal(target.searchParams.get("redirect_uri"), "http://localhost:5173/api/auth/github/callback");
  assert.equal(target.searchParams.get("scope"), null);

  const state = target.searchParams.get("state");
  assert.ok(state.length >= 32);
  assert.ok(res.headers["set-cookie"].some((c) => c.startsWith(`oauth_state=${state}`)));
});

test("callback with the wrong state is rejected and creates no user", async () => {
  githubAccount("octo");
  const agent = request.agent(app);
  await agent.get("/api/auth/github");

  const res = await agent.get("/api/auth/github/callback?code=octo&state=wrong");
  assert.equal(res.headers.location, "http://localhost:5173/?error=login_failed");
  assert.equal(await User.countDocuments(), 0);
  assert.equal((await agent.get("/api/auth/me")).body.user, null);
});

test("callback without any state cookie is rejected", async () => {
  githubAccount("octo");
  const res = await request(app).get("/api/auth/github/callback?code=octo&state=anything");
  assert.equal(res.headers.location, "http://localhost:5173/?error=login_failed");
  assert.equal(await User.countDocuments(), 0);
});

test("full login creates the user, sets a safe cookie and remembers them", async () => {
  githubAccount("Octo-Dev", { name: "Octo Dev" });
  const { agent, callback } = await logIn("Octo-Dev");

  assert.equal(callback.status, 302);
  assert.equal(callback.headers.location, "http://localhost:5173/");

  const loginCookie = callback.headers["set-cookie"].find((c) => c.startsWith("token="));
  assert.match(loginCookie, /HttpOnly/);
  assert.match(loginCookie, /SameSite=Lax/);

  const me = await agent.get("/api/auth/me");
  assert.equal(me.body.user.login, "Octo-Dev");
  assert.equal(me.body.user.name, "Octo Dev");
  assert.equal(me.body.user.role, "member");
  assert.equal(me.body.user.isPublic, true);
});

test("the GitHub token never reaches the browser and is encrypted in the database", async () => {
  githubAccount("octo");
  const { agent } = await logIn("octo");

  const me = await agent.get("/api/auth/me");
  assert.ok(!JSON.stringify(me.body).includes("token-for-octo"));
  assert.equal(me.body.user.githubToken, undefined);

  const saved = await User.findOne({ loginLower: "octo" }).select("+githubToken");
  assert.notEqual(saved.githubToken, "token-for-octo"); // not stored as plain text
  assert.ok(!saved.githubToken.includes("token-for-octo"));
  assert.equal(decrypt(saved.githubToken), "token-for-octo"); // but we can read it back
});

test("logging in twice updates the same user instead of making a second one", async () => {
  const profile = githubAccount("octo");
  await logIn("octo");
  profile.login = "octo-renamed";
  await logIn("octo");

  const users = await User.find();
  assert.equal(users.length, 1);
  assert.equal(users[0].login, "octo-renamed");
  assert.equal(users[0].loginLower, "octo-renamed");
});

test("if GitHub rejects the code, login fails and no user is created", async () => {
  const { callback, agent } = await logIn("bad");
  assert.equal(callback.headers.location, "http://localhost:5173/?error=login_failed");
  assert.equal(await User.countDocuments(), 0);
  assert.equal((await agent.get("/api/auth/me")).body.user, null);
});

test("after login the user returns to the page they came from", async () => {
  githubAccount("octo");
  const { callback } = await logIn("octo", { next: "/u/someone" });
  assert.equal(callback.headers.location, "http://localhost:5173/u/someone");
});

test("a next address pointing at another website is ignored", async () => {
  githubAccount("octo");
  for (const evil of ["https://evil.example", "//evil.example", "/\\evil.example"]) {
    const { callback } = await logIn("octo", { next: evil });
    assert.equal(callback.headers.location, "http://localhost:5173/");
  }
});

test("a username listed in ADMIN_LOGINS becomes an admin on login", async () => {
  githubAccount("The-Owner");
  const { agent } = await logIn("The-Owner");
  const me = await agent.get("/api/auth/me");
  assert.equal(me.body.user.role, "admin");
  assert.equal(me.body.user.isOwner, true);
});

test("logout clears the cookie", async () => {
  githubAccount("octo");
  const { agent } = await logIn("octo");
  assert.equal((await agent.get("/api/auth/me")).body.user.login, "octo");

  await agent.post("/api/auth/logout");
  assert.equal((await agent.get("/api/auth/me")).body.user, null);
});

test("a token for a deleted user stops working", async () => {
  githubAccount("octo");
  const { agent } = await logIn("octo");
  await User.deleteMany({});
  assert.equal((await agent.get("/api/auth/me")).body.user, null);
  assert.equal((await agent.post("/api/me/sync")).status, 401);
});

test("a banned user cannot log in, and an existing session is cut off", async () => {
  githubAccount("octo");
  const { agent } = await logIn("octo");
  await User.updateOne({ loginLower: "octo" }, { banned: true });

  assert.equal((await agent.post("/api/me/sync")).status, 403);
  assert.equal((await agent.get("/api/auth/me")).body.user, null);

  const again = await logIn("octo");
  assert.equal(again.callback.headers.location, "http://localhost:5173/?error=suspended");
  assert.equal((await again.agent.get("/api/auth/me")).body.user, null);
});

test("a broken JSON body gets a clear 400, not a crash", async () => {
  githubAccount("octo");
  const { agent } = await logIn("octo");
  const res = await agent.patch("/api/me").set("Content-Type", "application/json").send("{oops");
  assert.equal(res.status, 400);
  assert.equal(res.body.error.message, "The request body is not valid JSON");
});
