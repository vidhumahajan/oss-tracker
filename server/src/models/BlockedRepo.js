import mongoose from "mongoose";

// A repo that admins decided should not count, for example one
// created only to farm pull requests.
const blockedRepoSchema = new mongoose.Schema(
  {
    repoKey: { type: String, required: true, unique: true }, // lowercase "owner/repo"
    reason: String,
    blockedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const BlockedRepo = mongoose.model("BlockedRepo", blockedRepoSchema);
