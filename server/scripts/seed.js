// Fills the database with made-up members and pull requests, so you can
// see how the site looks before real people join.
//
//   npm run seed         add the demo data
//   npm run seed:clear   remove it again
//
// Demo users have negative GitHub ids. Real GitHub ids are always positive,
// so demo data can never clash with a real account, and clearing it
// cannot touch a real member.
import mongoose from "mongoose";
import { config } from "../src/config.js";
import { connectDB } from "../src/db.js";
import { User } from "../src/models/User.js";
import { PullRequest } from "../src/models/PullRequest.js";
import { Announcement } from "../src/models/Announcement.js";

if (config.isProduction) {
  console.error("Refusing to seed a production database.");
  process.exit(1);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// [username, display name, how many merged PRs]
const MEMBERS = [
  ["ananya-codes", "Ananya Rao", 41],
  ["rohit-dev", "Rohit Menon", 33],
  ["meera-k", "Meera Kulkarni", 27],
  ["tanmay-oss", "Tanmay Joshi", 19],
  ["farah-s", "Farah Siddiqui", 14],
  ["dev-ishaan", "Ishaan Bhatt", 11],
  ["priya-n", "Priya Nair", 8],
  ["kabir-builds", "Kabir Sethi", 6],
  ["sneha-writes-go", "Sneha Pillai", 4],
  ["arjun-first-pr", "Arjun Das", 1],
  ["nisha-newbie", "Nisha Verma", 0],
];

const REPOS = [
  "kubescape/kubescape",
  "asyncapi/modelina",
  "internetarchive/openlibrary",
  "flutter/flutter",
  "CCExtractor/ccextractor",
  "openmrs/openmrs-esm-core",
  "jenkinsci/jenkins",
  "mifos/web-app",
  "oppia/oppia",
  "pipe-cd/pipecd",
];

const TITLES = [
  "Fix crash when config file is missing",
  "Add retry with backoff to the HTTP client",
  "Docs: explain local setup on Windows",
  "Remove unused imports in scanner package",
  "Handle empty response from the search endpoint",
  "Add unit tests for the date parser",
  "Improve error message for invalid tokens",
  "Make table rows keyboard accessible",
  "Bump dependency to fix security advisory",
  "Refactor loader to use async iteration",
  "Fix typo in contributing guide",
  "Support dark mode in settings page",
];

// A small repeatable random number generator, so every seed gives the same data.
let seedValue = 42;
function random() {
  seedValue = (seedValue * 1664525 + 1013904223) % 4294967296;
  return seedValue / 4294967296;
}
const pick = (list) => list[Math.floor(random() * list.length)];

async function clear() {
  const demoUsers = await User.find({ githubId: { $lt: 0 } }).distinct("_id");
  await PullRequest.deleteMany({ author: { $in: demoUsers } });
  await User.deleteMany({ _id: { $in: demoUsers } });
  await Announcement.deleteMany({ title: /^\[demo\]/ });
  return demoUsers.length;
}

async function seed() {
  await clear();
  let prId = -1;

  for (const [index, [login, name, mergedCount]] of MEMBERS.entries()) {
    const user = await User.create({
      githubId: -(index + 1),
      login,
      loginLower: login,
      name,
      lastSyncedAt: new Date(),
      createdAt: new Date(Date.now() - (60 - index * 4) * DAY_MS),
    });

    // Each member mostly contributes to two or three favourite repos.
    const favourites = [pick(REPOS), pick(REPOS), pick(REPOS)];
    const prs = [];
    const add = (state, daysAgo) => {
      const repo = random() < 0.8 ? pick(favourites) : pick(REPOS);
      const when = new Date(Date.now() - daysAgo * DAY_MS);
      prs.push({
        githubId: prId--,
        author: user._id,
        repoFullName: repo,
        repoKey: repo.toLowerCase(),
        number: 100 + Math.floor(random() * 9000),
        title: pick(TITLES),
        url: `https://github.com/${repo}/pulls`,
        state,
        openedAt: new Date(when.getTime() - 2 * DAY_MS),
        mergedAt: state === "merged" ? when : null,
        closedAt: state === "open" ? null : when,
        githubUpdatedAt: when,
      });
    };

    // Spread merges over the last 11 months, with more of them recently.
    for (let i = 0; i < mergedCount; i++) add("merged", Math.pow(random(), 2) * 330 + random());
    for (let i = 0; i < Math.ceil(mergedCount / 8); i++) add("open", random() * 20);
    for (let i = 0; i < Math.floor(mergedCount / 10); i++) add("closed", random() * 200);

    if (prs.length > 0) await PullRequest.insertMany(prs);
  }

  await Announcement.create({
    title: "[demo] Welcome to OSS Tracker",
    body: "Log in with GitHub and your merged pull requests appear here within a minute.",
  });
  return MEMBERS.length;
}

await connectDB();
if (process.argv.includes("--clear")) {
  console.log(`Removed ${await clear()} demo members.`);
} else {
  console.log(`Added ${await seed()} demo members.`);
}
await mongoose.disconnect();
