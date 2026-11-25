import mongoose from "mongoose";

// An experienced community member that others can book a 1-on-1 session with.
// Admins add them. There is no delete: hiding (isActive: false) keeps the
// history of past sessions readable.
const mentorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    expertise: { type: String, required: true }, // e.g. "GSoC 2026 with Kubescape, Go"
    bio: { type: String, required: true },
    // Private. Only admins and members with a confirmed session ever see it.
    meetLink: { type: String, required: true },
    // Private and optional. Session emails go here. Only admins see it.
    email: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Mentor = mongoose.model("Mentor", mentorSchema);

// The fields anyone may see. The Meet link and email are left out on purpose.
export function publicMentor(mentor) {
  return {
    id: mentor.id,
    name: mentor.name,
    expertise: mentor.expertise,
    bio: mentor.bio,
  };
}
