import mongoose from "mongoose";

// A short AI-written explanation of a merged PR, for interview revision.
// A merged PR never changes, so once saved it is never written again.
// _id: false because these are parts of the summary, not records of their own.
const summarySchema = new mongoose.Schema(
  {
    problem: String,
    solution: String,
    concepts: [new mongoose.Schema({ name: String, explanation: String }, { _id: false })],
    changes: [new mongoose.Schema({ file: String, change: String }, { _id: false })],
    questions: [String],
    model: String, // which AI model wrote it
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdAt: Date,
  },
  { _id: false }
);

const pullRequestSchema = new mongoose.Schema({
  // GitHub's id for this pull request. Unique, so syncing the same PR
  // twice updates the existing record and never creates a copy.
  githubId: { type: Number, required: true, unique: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

  repoFullName: { type: String, required: true }, // "kubescape/kubescape"
  repoKey: { type: String, required: true }, // lowercase copy, used for matching
  number: Number,
  title: String,
  url: String,

  state: { type: String, enum: ["open", "merged", "closed"], required: true },
  isDraft: { type: Boolean, default: false },
  openedAt: Date,
  mergedAt: Date,
  closedAt: Date,
  githubUpdatedAt: Date,

  // An admin can exclude a PR so it stops counting (for example spam).
  excluded: { type: Boolean, default: false },

  // null until someone asks for one. Sync never touches this field.
  summary: { type: summarySchema, default: null },
});

// Indexes match the queries we run most:
// "this user's PRs by state, newest first" and "all merged PRs in a date range".
pullRequestSchema.index({ author: 1, state: 1, mergedAt: -1 });
pullRequestSchema.index({ state: 1, mergedAt: -1 });
pullRequestSchema.index({ repoKey: 1 });

export const PullRequest = mongoose.model("PullRequest", pullRequestSchema);
