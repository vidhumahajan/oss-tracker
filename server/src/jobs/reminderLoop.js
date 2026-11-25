// Sends the two reminder emails for confirmed mentor sessions:
//   about 30 minutes before the start, to the member, the mentor and the admins
//   at the start time, to the member and the mentor
//
// How it works: once a minute, find confirmed sessions that are due, the
// same way the sync loop finds users that are due. When a reminder goes
// out, the time is saved on the booking, so each one is sent exactly once,
// even after a restart.
//
// If the server was down at the exact moment:
//   the 30 minute reminder still goes out, as long as the session has not started
//   the start reminder still goes out up to 10 minutes late, and is skipped after that
import { Booking } from "../models/Booking.js";
import { sendStartsSoon, sendStartingNow } from "../services/sessionMail.js";

const TICK_MS = 60 * 1000; // run once a minute
const SOON_MS = 30 * 60 * 1000;
const START_GRACE_MS = 10 * 60 * 1000;

let running = false;

// Saves the reminder time on the booking, but only if nobody saved it
// first. true means this run won and should send the email.
async function claim(booking, field, now) {
  const result = await Booking.updateOne({ _id: booking._id, [field]: null }, { $set: { [field]: now } });
  return result.modifiedCount === 1;
}

function dueSessions(filter) {
  return Booking.find({ status: "confirmed", ...filter })
    .populate("member", "login")
    .populate("mentor");
}

// now can be set by tests, to pretend it is a different time.
export async function sendDueReminders(now = new Date()) {
  // If the previous round is still going, skip this one.
  if (running) return;
  running = true;

  try {
    const soon = await dueSessions({
      reminder30SentAt: null,
      scheduledAt: { $gt: now, $lte: new Date(now.getTime() + SOON_MS) },
    });
    for (const booking of soon) {
      if (await claim(booking, "reminder30SentAt", now)) await sendStartsSoon(booking, now);
    }

    const starting = await dueSessions({
      reminderStartSentAt: null,
      scheduledAt: { $lte: now, $gte: new Date(now.getTime() - START_GRACE_MS) },
    });
    for (const booking of starting) {
      if (await claim(booking, "reminderStartSentAt", now)) await sendStartingNow(booking);
    }
  } finally {
    running = false;
  }
}

export function startReminderLoop() {
  setInterval(() => {
    sendDueReminders().catch((err) => console.error("Reminder loop error:", err));
  }, TICK_MS);
  console.log("Session reminders started");
}
