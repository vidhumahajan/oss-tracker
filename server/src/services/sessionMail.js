// What the session emails say, and who gets each one. Sending itself is in
// mail.js. Every function takes a booking with its member and mentor loaded.
//
// Emails to the member never contain the Google Meet link. They point to
// the Mentors page, where the member sees the link after logging in. If a
// member typed someone else's address by mistake, the link stays private.
import { config } from "../config.js";
import { sendMail } from "./mail.js";

const SESSION_MINUTES = 30;
const SIGN_OFF = "OSS Tracker";

// "Saturday, 5 December 2026 at 6:00 pm India Standard Time"
export function whenText(date) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: config.timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "long",
  }).format(date);
}

// A Google Calendar link that opens a new 30 minute event, filled in.
export function calendarLink(booking) {
  const start = booking.scheduledAt;
  const end = new Date(start.getTime() + SESSION_MINUTES * 60 * 1000);
  // Google wants UTC times written like 20261205T123000Z.
  const stamp = (date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `OSS Tracker session with ${mentorName(booking)}`,
    dates: `${stamp(start)}/${stamp(end)}`,
    details: `Log in and open ${mentorsPage()} to join. The Google Meet link is there.`,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

const mentorsPage = () => `${config.appUrl}/mentors`;
const memberLogin = (booking) => booking.member?.login || "A member";
const mentorName = (booking) => booking.mentor?.name || "your mentor";
const mentorEmail = (booking) => booking.mentor?.email || "";
const lines = (...parts) => parts.filter((part) => part !== null).join("\n");

// "in 30 minutes", "in 12 minutes", "in 1 minute"
function startsIn(booking, now) {
  const minutes = Math.max(1, Math.round((booking.scheduledAt.getTime() - now.getTime()) / 60000));
  return `in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

const noteLine = (booking) => (booking.adminNote ? `Note from the admins: ${booking.adminNote}\n` : null);

// 1. A member asked for a session. Tell the admins.
export async function sendRequested(booking) {
  await sendMail({
    to: config.adminEmail,
    subject: `New session request from ${memberLogin(booking)}`,
    text: lines(
      "Hi,",
      "",
      `${memberLogin(booking)} asked for a session with ${mentorName(booking)}.`,
      "",
      `Topic: ${booking.topic}`,
      `Times that suit them: ${booking.preferredTimes}`,
      "",
      "Confirm or decline it on the admin Mentors tab:",
      `${config.appUrl}/admin/mentors`,
      "",
      SIGN_OFF
    ),
  });
}

// 2. An admin confirmed a time. Tell the member and the mentor.
export async function sendConfirmed(booking) {
  const when = whenText(booking.scheduledAt);
  await Promise.all([
    sendMail({
      to: booking.email,
      subject: `Your session with ${mentorName(booking)} is confirmed`,
      text: lines(
        `Hi ${memberLogin(booking)},`,
        "",
        `Good news! Your session with ${mentorName(booking)} is confirmed for ${when}. It lasts about ${SESSION_MINUTES} minutes.`,
        "",
        "Log in and open the Mentors page to see the Google Meet link:",
        mentorsPage(),
        "",
        "Add it to Google Calendar:",
        calendarLink(booking),
        "",
        "See you there,",
        SIGN_OFF
      ),
    }),
    sendMail({
      to: mentorEmail(booking),
      subject: `New session with ${memberLogin(booking)}`,
      text: lines(
        `Hi ${mentorName(booking)},`,
        "",
        `You have a session with ${memberLogin(booking)} on ${when}.`,
        "",
        `Topic: ${booking.topic}`,
        "",
        "Thank you for mentoring!",
        SIGN_OFF
      ),
    }),
  ]);
}

// 3a. An admin declined a request. Tell the member.
export async function sendDeclined(booking) {
  await sendMail({
    to: booking.email,
    subject: `Your session request with ${mentorName(booking)}`,
    text: lines(
      `Hi ${memberLogin(booking)},`,
      "",
      `Sorry, your session with ${mentorName(booking)} could not be arranged this time.`,
      "",
      noteLine(booking),
      "You are welcome to ask again later, or to pick another mentor:",
      mentorsPage(),
      "",
      SIGN_OFF
    ),
  });
}

// 3b. A session was cancelled, by an admin or by the member.
// The member always hears about it. The mentor hears if a time had been
// confirmed. The admins hear if the member cancelled.
export async function sendCancelled(booking, { byMember, wasConfirmed }) {
  const when = wasConfirmed ? ` on ${whenText(booking.scheduledAt)}` : "";
  const what = `session with ${mentorName(booking)}${when}`;

  await Promise.all([
    sendMail({
      to: booking.email,
      subject: `Your session with ${mentorName(booking)} is cancelled`,
      text: lines(
        `Hi ${memberLogin(booking)},`,
        "",
        byMember ? `You cancelled your ${what}.` : `Sorry, your ${what} has been cancelled by the admins.`,
        "",
        byMember ? null : noteLine(booking),
        "You can request a new session at any time:",
        mentorsPage(),
        "",
        SIGN_OFF
      ),
    }),
    wasConfirmed &&
      sendMail({
        to: mentorEmail(booking),
        subject: `Session with ${memberLogin(booking)} is cancelled`,
        text: lines(
          `Hi ${mentorName(booking)},`,
          "",
          `Your session with ${memberLogin(booking)}${when} is cancelled. You do not need to do anything.`,
          "",
          SIGN_OFF
        ),
      }),
    byMember &&
      sendMail({
        to: config.adminEmail,
        subject: `${memberLogin(booking)} cancelled a session`,
        text: lines(
          "Hi,",
          "",
          `${memberLogin(booking)} cancelled their ${what}.`,
          "",
          `${config.appUrl}/admin/mentors`,
          "",
          SIGN_OFF
        ),
      }),
  ]);
}

// An admin moved a confirmed session to a new time. Tell the member and the mentor.
export async function sendRescheduled(booking) {
  const when = whenText(booking.scheduledAt);
  await Promise.all([
    sendMail({
      to: booking.email,
      subject: `New time for your session with ${mentorName(booking)}`,
      text: lines(
        `Hi ${memberLogin(booking)},`,
        "",
        `Your session with ${mentorName(booking)} has moved to ${when}.`,
        "",
        "Log in and open the Mentors page to see the Google Meet link:",
        mentorsPage(),
        "",
        "Add the new time to Google Calendar:",
        calendarLink(booking),
        "",
        SIGN_OFF
      ),
    }),
    sendMail({
      to: mentorEmail(booking),
      subject: `New time for your session with ${memberLogin(booking)}`,
      text: lines(
        `Hi ${mentorName(booking)},`,
        "",
        `Your session with ${memberLogin(booking)} has moved to ${when}.`,
        "",
        `Topic: ${booking.topic}`,
        "",
        SIGN_OFF
      ),
    }),
  ]);
}

// 4. Shortly before the session. Everyone involved gets a reminder.
export async function sendStartsSoon(booking, now) {
  const soon = startsIn(booking, now);
  const at = whenText(booking.scheduledAt);
  await Promise.all([
    sendMail({
      to: booking.email,
      subject: `Your session with ${mentorName(booking)} starts ${soon}`,
      text: lines(
        `Hi ${memberLogin(booking)},`,
        "",
        `Your session with ${mentorName(booking)} starts ${soon}, at ${at}.`,
        "",
        "Log in and open the Mentors page to join on Google Meet:",
        mentorsPage(),
        "",
        SIGN_OFF
      ),
    }),
    sendMail({
      to: mentorEmail(booking),
      subject: `Your session with ${memberLogin(booking)} starts ${soon}`,
      text: lines(
        `Hi ${mentorName(booking)},`,
        "",
        `Your session with ${memberLogin(booking)} starts ${soon}, at ${at}.`,
        "",
        `Topic: ${booking.topic}`,
        "",
        SIGN_OFF
      ),
    }),
    sendMail({
      to: config.adminEmail,
      subject: `Session starts ${soon}: ${memberLogin(booking)} with ${mentorName(booking)}`,
      text: lines(
        "Hi,",
        "",
        `${memberLogin(booking)}'s session with ${mentorName(booking)} starts ${soon}, at ${at}.`,
        "",
        SIGN_OFF
      ),
    }),
  ]);
}

// 5. At the session time. The member and the mentor.
export async function sendStartingNow(booking) {
  await Promise.all([
    sendMail({
      to: booking.email,
      subject: `Your session with ${mentorName(booking)} is starting now`,
      text: lines(
        `Hi ${memberLogin(booking)},`,
        "",
        `Your session with ${mentorName(booking)} is starting now.`,
        "",
        "Log in and open the Mentors page to join on Google Meet:",
        mentorsPage(),
        "",
        SIGN_OFF
      ),
    }),
    sendMail({
      to: mentorEmail(booking),
      subject: `Your session with ${memberLogin(booking)} is starting now`,
      text: lines(
        `Hi ${mentorName(booking)},`,
        "",
        `Your session with ${memberLogin(booking)} is starting now.`,
        "",
        `Topic: ${booking.topic}`,
        "",
        SIGN_OFF
      ),
    }),
  ]);
}
