// Every call to GitHub lives in this file.
// Routes never talk to GitHub directly, so there is one place to look
// when GitHub changes something or a call fails.
import { config } from "../config.js";
import { HttpError, GithubError } from "../utils/httpError.js";

const API = "https://api.github.com";

function apiHeaders(githubToken) {
  return {
    Authorization: `Bearer ${githubToken}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "oss-tracker",
  };
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

// Login step 2: swap the one-time code for an access token.
export async function exchangeCodeForToken(code) {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: config.githubClientId,
      client_secret: config.githubClientSecret,
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
