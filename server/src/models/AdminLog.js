import mongoose from "mongoose";

// A record of every change an admin makes: who did what, to whom, and when.
// If something goes wrong, this is how you find out what happened.
const adminLogSchema = new mongoose.Schema(
  {
    admin: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    adminLogin: String, // kept as text too, in case the admin account is deleted later
    action: { type: String, required: true }, // e.g. "ban_user"
    target: String, // e.g. the username or repo affected
    details: String,
  },
  { timestamps: true }
);

adminLogSchema.index({ createdAt: -1 });

export const AdminLog = mongoose.model("AdminLog", adminLogSchema);

export async function logAdminAction(admin, action, target, details = "") {
  await AdminLog.create({
    admin: admin._id,
    adminLogin: admin.login,
    action,
    target,
    details,
  });
}
