// The weekly message an admin pastes into the community's WhatsApp group.
// Plain text only, with a blank line between sections, because WhatsApp
// shows it exactly as typed.
//
// It uses the leaderboard's own ranking, so the same rule decides what
// counts: banned members, private profiles, excluded PRs and blocked repos
// are all left out.
import { config } from "../config.js";
import { User } from "../models/User.js";
import { PullRequest } from "../models/PullRequest.js";
import { getRanking, countedFilter, windowStart } from "./stats.js";

const TOP = 5;
const MAX_FIRST_TIMERS = 5;

// "1 merged PR", "3 merged PRs"
function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

// The display name, or the username if there is none. Whitespace is
// squeezed so a stray line break cannot break the message's layout.
function displayName(user) {
  const name = (user.name || "").replace(/\s+/g, " ").trim();
  return name || user.login;
}

// "A, B, C" or "A, B, C, D, E and 2 more"
function nameList(names) {
  const shown = names.slice(0, MAX_FIRST_TIMERS).join(", ");
  const rest = names.length - MAX_FIRST_TIMERS;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}

// Of these authors, the ones with no counted merged PR before `since`,
// in the order given.
async function firstTimers(authorIds, since) {
  const earlier = await PullRequest.distinct(
    "author",
    await countedFilter({ author: { $in: authorIds }, mergedAt: { $lt: since } })
  );
  const hadEarlier = new Set(earlier.map(String));
  return authorIds.filter((id) => !hadEarlier.has(String(id)));
}

export async function weeklyPostText() {
  const link = `See where you stand: ${config.appUrl}/leaderboard`;
  const since = windowStart("week");
  const ranking = await getRanking("week");

  if (ranking.length === 0) {
    return [
      "OSS Tracker: no merged pull requests this week.",
      "A quiet week is a good time to pick up a new issue. Good luck!",
      link,
    ].join("\n\n");
  }

  const ids = ranking.map((row) => row.userId);
  const [users, newIds] = await Promise.all([
    User.find({ _id: { $in: ids } }).select("login name"),
    firstTimers(ids, since),
  ]);
  const nameById = new Map(users.map((user) => [user.id, displayName(user)]));
  const nameOf = (id) => nameById.get(String(id));

  const top = ranking
    .slice(0, TOP)
    .map((row, index) => `${index + 1}. ${nameOf(row.userId)}, ${plural(row.merged, "merged PR", "merged PRs")}`);

  const total = ranking.reduce((sum, row) => sum + row.merged, 0);
  const sections = [
    "OSS Tracker: this week's top 5",
    top.join("\n"),
    `${plural(ranking.length, "member", "members")} merged ${plural(total, "PR", "PRs")} this week.`,
  ];

  if (newIds.length > 0) {
    sections.push(`First merged PR ever: ${nameList(newIds.map(nameOf))}. Congrats!`);
  }
  sections.push(link);
  return sections.join("\n\n");
}
