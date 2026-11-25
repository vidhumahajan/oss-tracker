// Mentors and 1-on-1 sessions, for members. The admin side is in adminMentors.js.
//
// The Google Meet link is private. It is only sent to the member whose
// session is confirmed (here) and to admins (adminMentors.js).
// Email addresses are private too, and never leave this file.
import { Router } from "express";
import { Mentor, publicMentor } from "../models/Mentor.js";
import { Booking, OPEN_STATUSES, canMove } from "../models/Booking.js";
import { User } from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { sendRequested, sendCancelled } from "../services/sessionMail.js";
import { HttpError } from "../utils/httpError.js";
import { requireString, requireEmail, requireObjectId } from "../utils/validate.js";

export const mentorsRouter = Router();

const MAX_OPEN_SESSIONS = 2;

// Members sending a request right now. Stops two quick clicks from both
// passing the limit checks below before either is saved.
const booking = new Set();

// One session, as its member sees it. No email address.
function memberBooking(item) {
  return {
    id: item.id,
    mentor: item.mentor
      ? { id: item.mentor.id, name: item.mentor.name, expertise: item.mentor.expertise }
      : null,
    topic: item.topic,
    preferredTimes: item.preferredTimes,
    status: item.status,
    scheduledAt: item.scheduledAt || null,
    adminNote: item.adminNote || "",
    createdAt: item.createdAt,
    // Only once an admin has confirmed a time.
    meetLink: item.status === "confirmed" && item.mentor ? item.mentor.meetLink : null,
  };
}

// The public mentor list. No Meet links.
mentorsRouter.get("/", async (req, res) => {
  const mentors = await Mentor.find({ isActive: true }).sort({ createdAt: 1 });
  res.json({ items: mentors.map(publicMentor) });
});

// "My sessions", newest first. Opening them clears the count on the
// "Mentors" link, because the member has now seen every change.
mentorsRouter.get("/bookings", requireAuth, async (req, res) => {
  const items = await Booking.find({ member: req.user._id }).sort({ createdAt: -1 }).populate("mentor");
  await User.updateOne({ _id: req.user._id }, { $set: { sessionsSeenAt: new Date() } });
  res.json({ items: items.map(memberBooking) });
});

// The member's next confirmed session, for one line on the home page.
// A separate route, so the home page does not clear the count above.
mentorsRouter.get("/next-session", requireAuth, async (req, res) => {
  const item = await Booking.findOne({
    member: req.user._id,
    status: "confirmed",
    scheduledAt: { $gte: new Date() },
  })
    .sort({ scheduledAt: 1 })
    .populate("mentor");
  res.json({
    item: item ? { mentorName: item.mentor?.name || "your mentor", scheduledAt: item.scheduledAt } : null,
  });
});

// Request a session with a mentor.
mentorsRouter.post("/:id/bookings", requireAuth, async (req, res) => {
  const mentor = await Mentor.findById(requireObjectId(req.params.id));
  // A hidden mentor answers like one that does not exist.
  if (!mentor || !mentor.isActive) throw new HttpError(404, "Mentor not found");

  const topic = requireString(req.body?.topic, "topic", { max: 200 });
  const preferredTimes = requireString(req.body?.preferredTimes, "preferredTimes", { max: 200 });
  const email = requireEmail(req.body?.email);

  const key = req.user.id;
  if (booking.has(key)) throw new HttpError(409, "Your last request is still being sent.");
  booking.add(key);

  try {
    const open = await Booking.find({ member: req.user._id, status: { $in: OPEN_STATUSES } });
    if (open.some((item) => String(item.mentor) === mentor.id)) {
      throw new HttpError(409, "You already have an open session with this mentor.");
    }
    if (open.length >= MAX_OPEN_SESSIONS) {
      throw new HttpError(409, `You can have at most ${MAX_OPEN_SESSIONS} open sessions at a time.`);
    }

    const item = await Booking.create({ mentor: mentor._id, member: req.user._id, topic, preferredTimes, email });
    item.mentor = mentor;
    item.member = req.user;
    await sendRequested(item);
    res.status(201).json({ item: memberBooking(item) });
  } finally {
    booking.delete(key);
  }
});

// A member cancels their own requested or confirmed session.
mentorsRouter.post("/bookings/:id/cancel", requireAuth, async (req, res) => {
  // Looking it up by id AND member means another member's session
  // answers 404, as if it did not exist.
  const item = await Booking.findOne({ _id: requireObjectId(req.params.id), member: req.user._id }).populate("mentor");
  if (!item) throw new HttpError(404, "Session not found");

  if (!canMove(item.status, "cancelled", { byAdmin: false })) {
    throw new HttpError(409, `A ${item.status} session cannot be cancelled.`);
  }
  const wasConfirmed = item.status === "confirmed";
  item.status = "cancelled";
  await item.save();
  item.member = req.user;
  await sendCancelled(item, { byMember: true, wasConfirmed });
  res.json({ item: memberBooking(item) });
});
