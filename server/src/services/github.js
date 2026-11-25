// Every call to GitHub lives in this file.
// Routes never talk to GitHub directly, so there is one place to look
// when GitHub changes something or a call fails.
import { config } from "../config.js";
import { HttpError, GithubError } from "../utils/httpError.js";

const API = "https://api.github.com";

// Without a token, GitHub still answers public reads, with a lower rate limit.
function apiHeaders(githubToken) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "oss-tracker",
  };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
  return headers;
}

// Turns a failed GitHub response into the right kind of error.
function throwForStatus(response, what) {
  if (response.status === 401) {
    throw new GithubError(
      "unauthorized",
      401,
      "GitHub access expired. Log out and log in again."
    );
  }
  if (response.status === 403 || response.status === 429) {
    throw new GithubError(
      "rate_limited",
      429,
      "GitHub is asking us to slow down. Try again in a few minutes."
    );
  }
  throw new GithubError("failed", 502, `GitHub ${what} failed (status ${response.status}).`);
}

// The login app's id and secret. The badge app (routes/badge.js) passes its own.
const loginApp = { clientId: config.githubClientId, clientSecret: config.githubClientSecret };

// Login step 2: swap the one-time code for an access token.
export async function exchangeCodeForToken(code, app = loginApp) {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code,
    }),
  });

  const data = await response.json();

  // GitHub answers 200 even when the code is wrong, and puts the
  // problem in the body. So we check for the token itself.
  if (!data.access_token) {
    throw new HttpError(401, "GitHub login failed. Please try again.");
  }
  return data.access_token;
}

// Login step 3: ask GitHub who this token belongs to.
export async function fetchGithubProfile(githubToken) {
  const response = await fetch(`${API}/user`, { headers: apiHeaders(githubToken) });
  if (!response.ok) throwForStatus(response, "profile request");
  return response.json();
}

// One page (up to 100) of a user's public pull requests, most recently updated first.
//
// The search query, piece by piece:
//   author:LOGIN   pull requests this person opened
//   type:pr        pull requests only, not issues
//   is:public      public repositories only
//   -user:LOGIN    NOT in their own repositories (a PR to your own repo
//                  is not an open source contribution)
//   updated:>=DATE only what changed since the last sync
export async function searchPullRequests(githubToken, login, { since, page }) {
  let q = `author:${login} type:pr is:public -user:${login}`;
  if (since) q += ` updated:>=${since}`;

  const params = new URLSearchParams({
    q,
    sort: "updated",
    order: "desc",
    per_page: "100",
    page: String(page),
  });

  const response = await fetch(`${API}/search/issues?${params}`, {
    headers: apiHeaders(githubToken),
  });
  if (!response.ok) throwForStatus(response, "search");

  const data = await response.json();
  return data.items;
}

// "owner/repo" -> "/repos/owner/repo", with each part made safe for a URL.
function repoPath(repoFullName) {
  const [owner, repo] = repoFullName.split("/");
  return `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

// One pull request: we use its title and description (body).
export async function fetchPullRequest(githubToken, repoFullName, number) {
  const response = await fetch(`${repoPath(repoFullName)}/pulls/${number}`, {
    headers: apiHeaders(githubToken),
  });
  if (!response.ok) throwForStatus(response, "pull request request");
  return response.json();
}

// The files a pull request changed, each with its diff ("patch").
// One page of 100 is plenty: the summary looks at 15 files at most.
export async function fetchPullRequestFiles(githubToken, repoFullName, number) {
  const response = await fetch(`${repoPath(repoFullName)}/pulls/${number}/files?per_page=100`, {
    headers: apiHeaders(githubToken),
  });
  if (!response.ok) throwForStatus(response, "files request");
  return response.json();
}

// An issue in the same repo, or null if it does not exist (for example
// a "fixes #12" that points at a deleted issue).
export async function fetchIssue(githubToken, repoFullName, number) {
  const response = await fetch(`${repoPath(repoFullName)}/issues/${number}`, {
    headers: apiHeaders(githubToken),
  });
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) throwForStatus(response, "issue request");
  return response.json();
}

// ---------- The profile badge (services/badge.js) ----------
// Docs: https://docs.github.com/en/rest/repos/repos and
// https://docs.github.com/en/rest/repos/contents

// Does this repository exist? true or false.
export async function repoExists(githubToken, owner, repo) {
  const response = await fetch(repoPath(`${owner}/${repo}`), { headers: apiHeaders(githubToken) });
  if (response.status === 404) return false;
  if (!response.ok) throwForStatus(response, "repository request");
  return true;
}

// Creates a public repository for the token's owner. auto_init gives it
// a first commit with a short README.md.
export async function createPublicRepo(githubToken, name) {
  const response = await fetch(`${API}/user/repos`, {
    method: "POST",
    headers: { ...apiHeaders(githubToken), "Content-Type": "application/json" },
    body: JSON.stringify({ name, private: false, auto_init: true }),
  });
  if (!response.ok) throwForStatus(response, "create repository");
}

// The repository's README as { path, text, sha }, or null if it has none.
// GitHub sends the file as base64.
export async function fetchReadme(githubToken, owner, repo) {
  const response = await fetch(`${repoPath(`${owner}/${repo}`)}/readme`, { headers: apiHeaders(githubToken) });
  if (response.status === 404) return null;
  if (!response.ok) throwForStatus(response, "README request");
  const data = await response.json();
  return { path: data.path, text: Buffer.from(data.content || "", "base64").toString("utf8"), sha: data.sha };
}

// Creates a file, or replaces it when sha (the current version's id) is given.
export async function saveFile(githubToken, owner, repo, { path, text, sha, message }) {
  const body = { message, content: Buffer.from(text, "utf8").toString("base64") };
  if (sha) body.sha = sha;
  const filePath = path.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`${repoPath(`${owner}/${repo}`)}/contents/${filePath}`, {
    method: "PUT",
    headers: { ...apiHeaders(githubToken), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throwForStatus(response, "save file");
}

// Cancels everything the member allowed an OAuth app to do: the token
// stops working and the app disappears from their GitHub settings.
// This call proves who we are with the app's id and secret, not the token.
// Docs: https://docs.github.com/en/rest/apps/oauth-applications#delete-an-app-authorization
export async function deleteAppGrant({ clientId, clientSecret }, githubToken) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(`${API}/applications/${encodeURIComponent(clientId)}/grant`, {
    method: "DELETE",
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "oss-tracker",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ access_token: githubToken }),
  });
  if (!response.ok) throwForStatus(response, "cancel permission");
}
