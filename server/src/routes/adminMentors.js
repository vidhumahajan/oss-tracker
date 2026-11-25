// The admin side of mentors and sessions. admin.js attaches this router,
// so every route here already has a logged-in admin.
// Every change is written to the admin log.
import { Router } from "express";
import { Mentor } from "../models/Mentor.js";
import { Booking, canMove } from "../models/Booking.js";
import { logAdminAction } from "../models/AdminLog.js";
import { HttpError } from "../utils/httpError.js";
import {
  parsePage,
  requireString,
  optionalString,
  requireBoolean,
  requireObjectId,
  requireMeetLink,
  requireDate,
} from "../utils/validate.js";

export const adminMentorsRouter = Router();

const PAGE_SIZE = 25;

// The limits for each mentor field, shared by add and edit.
const MENTOR_FIELDS = {
  name: (value) => requireString(value, "name", { max: 80 }),
  expertise: (value) => requireString(value, "expertise", { max: 120 }),
  bio: (value) => requireString(value, "bio", { max: 600 }),
  meetLink: (value) => requireMeetLink(value),
};

function adminMentor(mentor) {
  return {
    id: mentor.id,
    name: mentor.name,
    expertise: mentor.expertise,
    bio: mentor.bio,
    meetLink: mentor.meetLink,
    isActive: mentor.isActive,
    createdAt: mentor.createdAt,
  };
}

// "2026-12-05 12:30 UTC", for the admin log.
function logTime(date) {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// ---------- Mentors ----------

adminMentorsRouter.get("/mentors", async (req, res) => {
  const mentors = await Mentor.find().sort({ createdAt: 1 });
  res.json({ items: mentors.map(adminMentor) });
});

adminMentorsRouter.post("/mentors", async (req, res) => {
  const fields = {};
  for (const [name, check] of Object.entries(MENTOR_FIELDS)) {
    fields[name] = check(req.body?.[name]);
  }
  const mentor = await Mentor.create(fields);
  await logAdminAction(req.user, "add_mentor", mentor.name);
  res.status(201).json({ item: adminMentor(mentor) });
});

// Edit any of the fields, or hide / show the mentor with isActive.
// Fields that are not sent stay as they are.
adminMentorsRouter.patch("/mentors/:id", async (req, res) => {
  const mentor = await Mentor.findById(requireObjectId(req.params.id));
  if (!mentor) throw new HttpError(404, "Mentor not found");
  const body = req.body || {};

  const changed = [];
  for (const [name, check] of Object.entries(MENTOR_FIELDS)) {
    if (body[name] === undefined) continue;
    const value = check(body[name]);
    if (value !== mentor[name]) {
      mentor[name] = value;
      changed.push(name);
    }
  }

  let visibility = null;
  if (body.isActive !== undefined) {
    const isActive = requireBoolean(body.isActive, "isActive");
    if (isActive !== mentor.isActive) {
      mentor.isActive = isActive;
      visibility = isActive ? "show_mentor" : "hide_mentor";
    }
  }

  await mentor.save();
  if (changed.length > 0) {
    await logAdminAction(req.user, "edit_mentor", mentor.name, `changed ${changed.join(", ")}`);
  }
  if (visibility) {
    await logAdminAction(req.user, visibility, mentor.name);
  }
  res.json({ item: adminMentor(mentor) });
});

// ---------- Session requests ----------

function adminBooking(item) {
  return {
    id: item.id,
    member: item.member ? { login: item.member.login, name: item.member.name, avatarUrl: item.member.avatarUrl } : null,
    mentor: item.mentor ? { id: item.mentor.id, name: item.mentor.name, meetLink: item.mentor.meetLink } : null,
    topic: item.topic,
    preferredTimes: item.preferredTimes,
    status: item.status,
    scheduledAt: item.scheduledAt || null,
    adminNote: item.adminNote || "",
    createdAt: item.createdAt,
  };
}

// Every session request, newest first.
adminMentorsRouter.get("/bookings", async (req, res) => {
  const page = parsePage(req.query.page);
  const [total, items] = await Promise.all([
    Booking.countDocuments(),
    Booking.find()
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .populate("member", "login name avatarUrl")
      .populate("mentor"),
  ]);
  res.json({
    page,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    total,
    items: items.map(adminBooking),
  });
});

// The log action for each status an admin can set.
const STATUS_ACTIONS = {
  confirmed: "confirm_session",
  declined: "decline_session",
  done: "complete_session",
  cancelled: "cancel_session",
};

// Confirm (with scheduledAt), decline (with an optional adminNote),
// mark done, or cancel. Only the moves in models/Booking.js are allowed.
adminMentorsRouter.patch("/bookings/:id", async (req, res) => {
  const item = await Booking.findById(requireObjectId(req.params.id))
    .populate("member", "login name avatarUrl")
    .populate("mentor");
  if (!item) throw new HttpError(404, "Session not found");

  const status = req.body?.status;
  if (!STATUS_ACTIONS[status]) {
    throw new HttpError(400, "status must be confirmed, declined, done or cancelled");
  }
  if (!canMove(item.status, status, { byAdmin: true })) {
    throw new HttpError(409, `A ${item.status} session cannot be changed to ${status}.`);
  }

  const note = optionalString(req.body?.adminNote, "adminNote", { max: 300 });
  let details = note;

  if (status === "confirmed") {
    const scheduledAt = requireDate(req.body?.scheduledAt, "scheduledAt");
    if (scheduledAt.getTime() < Date.now()) {
      throw new HttpError(400, "scheduledAt must be in the future");
    }
    item.scheduledAt = scheduledAt;
    details = [`for ${logTime(scheduledAt)}`, note].filter(Boolean).join(", ");
  }

  item.status = status;
  if (note) item.adminNote = note;
  await item.save();

  const target = `${item.member?.login || "a deleted member"} with ${item.mentor?.name || "a mentor"}`;
  await logAdminAction(req.user, STATUS_ACTIONS[status], target, details);
  res.json({ item: adminBooking(item) });
});
