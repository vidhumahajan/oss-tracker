// The badge members show on their GitHub profile: the image, the line of
// Markdown that shows it, and "Add it for me", which writes that line into
// the member's profile README. The README explains why it works this way.
import { config } from "../config.js";
import { User } from "../models/User.js";
import { getRanking } from "./stats.js";
import {
  exchangeCodeForToken,
  fetchGithubProfile,
  repoExists,
  createPublicRepo,
  fetchReadme,
  saveFile,
  deleteAppGrant,
} from "./github.js";
import { decrypt } from "../utils/crypto.js";
import { HttpError } from "../utils/httpError.js";
import { isGithubLogin } from "../utils/validate.js";

const COMMIT_MESSAGE = "Add OSS Tracker badge";

// ---------- The image ----------

// About how wide a character is at 11px in Verdana, the usual badge font.
// The text is always our own short labels, so a rough number is enough.
const CHAR_WIDTH = 7;
const PADDING = 10;

function textWidth(text) {
  return text.length * CHAR_WIDTH + PADDING * 2;
}

// The familiar two-tone badge, drawn by hand. Only fixed labels and numbers
// ever go into it, never a name or username, so nothing a member typed can
// end up inside the SVG.
function drawBadge(right) {
  const left = "OSS Tracker";
  const leftWidth = textWidth(left);
  const rightWidth = textWidth(right);
  const width = leftWidth + rightWidth;
  const label = `${left}: ${right}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${label}">
<title>${label}</title>
<clipPath id="r"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)">
<rect width="${leftWidth}" height="20" fill="#1b1530"/>
<rect x="${leftWidth}" width="${rightWidth}" height="20" fill="#6b3fd4"/>
</g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${leftWidth / 2}" y="14">${left}</text>
<text x="${leftWidth + rightWidth / 2}" y="14">${right}</text>
</g>
</svg>`;
}

// For a private, banned or unknown profile. Always the same, so the badge
// never tells anyone whether an account exists.
export const NEUTRAL_BADGE = drawBadge("view profile");

const count = (value) => new Intl.NumberFormat("en-IN").format(value);

// The badge for a username, with the same numbers as the profile page.
export async function badgeSvg(login) {
  if (!isGithubLogin(login)) return NEUTRAL_BADGE;
  const user = await User.findOne({ loginLower: login.toLowerCase() });
  if (!user || !user.isPublic || user.banned) return NEUTRAL_BADGE;

  // The all-time ranking holds every visible member with a counted merge.
  const ranking = await getRanking("all");
  const position = ranking.findIndex((row) => String(row.userId) === user.id);
  if (position === -1) return drawBadge("OSS Tracker member");

  const merged = ranking[position].merged;
  const prs = merged === 1 ? "merged PR" : "merged PRs";
  return drawBadge(`${count(merged)} ${prs}, #${count(position + 1)} all time`);
}

// ---------- The line of Markdown ----------

export function badgeImageUrl(login) {
  return `${config.appUrl}/api/badge/${login}.svg`;
}

// The badge image, linked to the member's profile on this site.
export function badgeLine(login) {
  return `[![OSS Tracker](${badgeImageUrl(login)})](${config.appUrl}/u/${login})`;
}

function hasBadge(text, login) {
  return text.toLowerCase().includes(badgeImageUrl(login).toLowerCase());
}

// ---------- Adding it for the member ----------

// "Add it for me" needs the badge app's settings, and a public address:
// a badge pointing at localhost would show as broken on GitHub.
export function autoAddAvailable() {
  if (!config.badgeClientId || !config.badgeClientSecret) return false;
  const host = new URL(config.appUrl).hostname;
  return !["localhost", "127.0.0.1", "[::1]"].includes(host) && !host.endsWith(".localhost");
}

export function badgeApp() {
  return { clientId: config.badgeClientId, clientSecret: config.badgeClientSecret };
}

// Puts the badge line at the very top of the profile README (the README of
// the repo named like the username), creating the repo or file if needed.
// Leaves everything already there exactly as it was.
async function writeBadge(githubToken, login) {
  if (!(await repoExists(githubToken, login, login))) {
    await createPublicRepo(githubToken, login);
  }

  const line = badgeLine(login);
  const readme = await fetchReadme(githubToken, login, login);

  // GitHub only shows a README at the top of the repo on the profile, so one
  // in a folder (for example docs/README.md) counts as no README.
  if (!readme || readme.path.includes("/")) {
    await saveFile(githubToken, login, login, { path: "README.md", text: `${line}\n`, message: COMMIT_MESSAGE });
    return;
  }
  if (hasBadge(readme.text, login)) return; // already there, change nothing

  await saveFile(githubToken, login, login, {
    path: readme.path,
    sha: readme.sha,
    text: `${line}\n\n${readme.text}`,
    message: COMMIT_MESSAGE,
  });
}

// Cancels the write permission. Failing here is logged, never thrown, so it
// cannot hide the result of the steps before it.
async function cancelPermission(githubToken, login) {
  try {
    await deleteAppGrant(badgeApp(), githubToken);
  } catch (err) {
    console.error(`Could not cancel the badge permission for ${login}: ${err.message}`);
  }
}

// The whole "Add it for me" step after GitHub sends the member back.
// Returns "added", "wrong_account" or "failed".
//
// The token can write to the member's public repos, so it lives only in
// this function: never saved, never logged, never sent to the browser,
// and the permission behind it is cancelled whatever happens.
export async function addBadgeWithCode(code, member) {
  let githubToken = null;
  try {
    githubToken = await exchangeCodeForToken(code, badgeApp());
    const profile = await fetchGithubProfile(githubToken);
    // Someone logged in to GitHub as another account gets nothing written.
    if (profile.id !== member.githubId) return "wrong_account";

    await writeBadge(githubToken, profile.login);
    await User.updateOne({ _id: member._id }, { $set: { badgeAddedAt: new Date() } });
    return "added";
  } catch (err) {
    console.error(`Adding the badge failed for ${member.login}: ${err.message}`);
    return "failed";
  } finally {
    if (githubToken) await cancelPermission(githubToken, member.login);
    githubToken = null;
  }
}

// "I already added it myself": look for the badge in the member's public
// profile README with their normal read-only login token.
export async function checkBadge(member) {
  const user = await User.findById(member._id).select("+githubToken");
  const githubToken = user.githubToken ? decrypt(user.githubToken) : null;
  const readme = await fetchReadme(githubToken, user.login, user.login);

  if (!readme || !hasBadge(readme.text, user.login)) {
    throw new HttpError(404, "We could not find the badge in your profile README yet.");
  }
  await User.updateOne({ _id: user._id }, { $set: { badgeAddedAt: new Date() } });
}
