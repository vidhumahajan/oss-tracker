// Shared tools for the tests: a fake GitHub, a login shortcut, and data builders.
import "./setup.js";
import { before, after, beforeEach, mock } from "node:test";
import mongoose from "mongoose";
import request from "supertest";
import { app } from "../src/app.js";
import { connectDB } from "../src/db.js";
import { User } from "../src/models/User.js";
import { PullRequest } from "../src/models/PullRequest.js";

export { app, request };

// Connect once, start every test with an empty database, disconnect at the end.
export function useDatabase() {
  before(async () => {
    await connectDB();
  });
  beforeEach(async () => {
    mock.restoreAll();
    fakeGithub();
    await mongoose.connection.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()));
  });
  after(async () => {
    await mongoose.disconnect();
  });
}

// The state of our pretend GitHub. Tests change it, then call the app.
export const github = {
  profiles: {}, // token -> profile
  prs: {}, // login (lowercase) -> list of search items
  searches: [], // every search query the app made, for assertions
  failSearchWith: null, // set to a status code to make search fail
  prDetails: {}, // "owner/repo#12" -> { title, body }
  prFiles: {}, // "owner/repo#12" -> list of changed files
  issues: {}, // "owner/repo#5" -> { title, body }
  repoCalls: [], // every PR, files and issue call the app made
  failRepoCallsWith: null, // set to a status code to make PR, files and issue calls fail
  reset() {
    this.profiles = {};
    this.prs = {};
    this.searches = [];
    this.failSearchWith = null;
    this.prDetails = {};
    this.prFiles = {};
    this.issues = {};
    this.repoCalls = [];
    this.failRepoCallsWith = null;
  },
};

// A reply that passes every check in services/summary.js.
export function goodSummary() {
  return {
    problem: "The scanner crashed when the config file was missing. Users saw a stack trace.",
    solution: "The PR checks for the file first and falls back to defaults. It also adds a test.",
    concepts: [
      { name: "Default values", explanation: "Use safe settings when none are given." },
      { name: "Error handling", explanation: "Catch the missing file instead of crashing." },
      { name: "Unit tests", explanation: "A test proves the fix keeps working." },
    ],
    changes: [{ file: "src/config.js", change: "Falls back to defaults when the file is missing." }],
    questions: ["Why defaults?", "How did you test it?", "What else could go wrong?"],
  };
}

// The state of our pretend AI service. Tests change it, then call the app.
export const ai = {
  calls: [], // every request body the app sent
  reply: null, // an object (sent as JSON text) or a string (sent as is)
  status: 200,
  stopReason: "end_turn",
  reset() {
    this.calls = [];
    this.reply = goodSummary();
    this.status = 200;
    this.stopReason = "end_turn";
  },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

// Answers the GitHub calls made when writing a summary.
// Unless a test set them, the PR comes from github.prs and has one changed file.
function fakeRepoCall(path) {
  const match = path.match(/^\/repos\/([^/]+)\/([^/]+)\/(pulls|issues)\/(\d+)(\/files)?$/);
  if (!match) return null;
  const [, owner, repo, kind, number, files] = match;
  const key = `${owner}/${repo}#${number}`.toLowerCase();
  github.repoCalls.push(key + (files ? " files" : ` ${kind}`));

  if (kind === "issues") {
    return github.issues[key] ? json(github.issues[key]) : json({ message: "Not Found" }, 404);
  }
  if (files) {
    return json(github.prFiles[key] || [
      { filename: "src/config.js", status: "modified", additions: 3, deletions: 1, patch: "@@ -1 +1 @@\n-old\n+new" },
    ]);
  }
  const item = Object.values(github.prs).flat().find((pr) => pr.html_url.toLowerCase().endsWith(`${owner}/${repo}/pull/${number}`.toLowerCase()));
  return json(github.prDetails[key] || { title: item?.title || "A PR", body: "" });
}

function fakeAi(options) {
  ai.calls.push(JSON.parse(options.body));
  if (ai.status !== 200) return json({ type: "error", error: { message: "nope" } }, ai.status);
  const text = typeof ai.reply === "string" ? ai.reply : JSON.stringify(ai.reply);
  return json({
    type: "message",
    role: "assistant",
    stop_reason: ai.stopReason,
    content: [
      { type: "thinking", thinking: "" },
      { type: "text", text },
    ],
  });
}

// Replaces fetch so no test ever calls the real GitHub or the real AI service.
export function fakeGithub() {
  github.reset();
  ai.reset();
  mock.method(globalThis, "fetch", async (url, options = {}) => {
    const target = new URL(String(url));

    if (target.hostname === "api.anthropic.com") return fakeAi(options);

    // Login: code -> token. The code "bad" is rejected; any other code
    // becomes the token "token-for-<code>".
    if (target.pathname === "/login/oauth/access_token") {
      const { code } = JSON.parse(options.body);
      if (code === "bad") return json({ error: "bad_verification_code" });
      return json({ access_token: `token-for-${code}` });
    }

    const token = (options.headers?.Authorization || "").replace("Bearer ", "");

    if (target.pathname === "/user") {
      const profile = github.profiles[token];
      return profile ? json(profile) : json({ message: "Bad credentials" }, 401);
    }

    if (target.pathname === "/search/issues") {
      if (!github.profiles[token]) return json({ message: "Bad credentials" }, 401);
      if (github.failSearchWith) return json({ message: "nope" }, github.failSearchWith);

      const q = target.searchParams.get("q");
      const page = Number(target.searchParams.get("page"));
      github.searches.push({ q, page });

      const login = q.match(/author:(\S+)/)[1].toLowerCase();
      const all = github.prs[login] || [];
      const items = all.slice((page - 1) * 100, page * 100);
      return json({ total_count: all.length, incomplete_results: false, items });
    }

    if (target.pathname.startsWith("/repos/")) {
      if (!github.profiles[token]) return json({ message: "Bad credentials" }, 401);
      if (github.failRepoCallsWith) return json({ message: "nope" }, github.failRepoCallsWith);
      const answer = fakeRepoCall(target.pathname);
      if (answer) return answer;
    }

    throw new Error(`Unexpected fetch in test: ${url}`);
  });
}

let nextId = 1000;

// Registers a GitHub account in the fake. Its login code is its username.
export function githubAccount(login, extra = {}) {
  const profile = {
    id: nextId++,
    login,
    name: `${login} name`,
    avatar_url: `https://avatars.githubusercontent.com/u/${nextId}`,
    ...extra,
  };
  github.profiles[`token-for-${login}`] = profile;
  github.prs[login.toLowerCase()] = [];
  return profile;
}

// Builds one search result the way GitHub sends it.
export function githubPr(login, repo, { state = "merged", daysAgo = 1, title } = {}) {
  const id = nextId++;
  const when = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  const item = {
    id,
    number: id % 1000,
    title: title || `PR ${id} to ${repo}`,
    html_url: `https://github.com/${repo}/pull/${id % 1000}`,
    state: state === "open" ? "open" : "closed",
    draft: false,
    created_at: when,
    updated_at: when,
    closed_at: state === "open" ? null : when,
    repository_url: `https://api.github.com/repos/${repo}`,
    pull_request: { merged_at: state === "merged" ? when : null },
    user: { login },
  };
  github.prs[login.toLowerCase()].push(item);
  return item;
}

// Runs the whole login flow. Returns an agent, which keeps cookies like a browser.
export async function logIn(login, { next } = {}) {
  const agent = request.agent(app);
  const start = await agent.get(`/api/auth/github${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  const state = new URL(start.headers.location).searchParams.get("state");
  const callback = await agent.get(`/api/auth/github/callback?code=${login}&state=${state}`);
  return { agent, callback };
}

// Shortcut used by most tests: create the GitHub account, log in, sync.
export async function memberWithPrs(login, prs = []) {
  githubAccount(login);
  for (const pr of prs) githubPr(login, pr.repo, pr);
  const { agent } = await logIn(login);
  await agent.post("/api/me/sync");
  const user = await User.findOne({ loginLower: login.toLowerCase() });
  return { agent, user };
}

export { User, PullRequest };
