import mongoose from "mongoose";

// A short AI-written explanation of a merged PR, for interview revision.
// A merged PR never changes, so the AI writes it only once. The author
// (or an admin) can then edit the text people see.
// _id: false because these are parts of the summary, not records of their own.
const conceptSchema = new mongoose.Schema({ name: String, explanation: String }, { _id: false });
const changeSchema = new mongoose.Schema({ file: String, change: String }, { _id: false });

// The five parts of the text. A function, so each schema gets its own copy.
const textFields = () => ({
  problem: String,
  solution: String,
  concepts: [conceptSchema],
  changes: [changeSchema],
  questions: [String],
});

const summarySchema = new mongoose.Schema(
  {
    // The current version, which everyone sees.
    ...textFields(),
    // The AI's own text, written once when the summary is made and never
    // changed afterwards. Summaries saved before editing existed have none
    // until their first edit; their saved text counts as the original.
    original: { type: new mongoose.Schema(textFields(), { _id: false }), default: null },
    editedAt: Date,
    editedBy: String, // username of whoever saved the latest edit
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
