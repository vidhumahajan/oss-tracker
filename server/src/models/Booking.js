import mongoose from "mongoose";

// A member's request for a 1-on-1 session with a mentor.
//
// The status moves like this:
//   requested -> confirmed (an admin picks a time) or declined (by an admin)
//   requested -> cancelled (by the member)
//   confirmed -> done (by an admin) or cancelled (by the member or an admin)
const bookingSchema = new mongoose.Schema(
  {
    mentor: { type: mongoose.Schema.Types.ObjectId, ref: "Mentor", required: true },
    member: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    topic: { type: String, required: true },
    preferredTimes: { type: String, required: true }, // free text, e.g. "Saturday after 6pm"
    status: {
      type: String,
      enum: ["requested", "confirmed", "declined", "done", "cancelled"],
      default: "requested",
    },
    scheduledAt: Date, // set when an admin confirms
    adminNote: String,
  },
  { timestamps: true }
);

bookingSchema.index({ member: 1, status: 1 });
bookingSchema.index({ createdAt: -1 });

export const Booking = mongoose.model("Booking", bookingSchema);

// Sessions that still need something to happen. The booking limits count these.
export const OPEN_STATUSES = ["requested", "confirmed"];

// Which status changes are allowed, and who may make them.
const ADMIN_MOVES = {
  requested: ["confirmed", "declined"],
  confirmed: ["done", "cancelled"],
};
const MEMBER_MOVES = {
  requested: ["cancelled"],
  confirmed: ["cancelled"],
};

export function canMove(from, to, { byAdmin }) {
  const moves = byAdmin ? ADMIN_MOVES : MEMBER_MOVES;
  return (moves[from] || []).includes(to);
}
