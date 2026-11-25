// Every email the site sends goes through this file, so there is one place
// to look when email fails. What the emails say is in sessionMail.js.
//
// Email is optional. Without SMTP_HOST, SMTP_USER and SMTP_PASS nothing is
// sent and everything else works as before. A failed send is logged and
// never breaks the request that caused it.
import nodemailer from "nodemailer";
import { config } from "../config.js";

// Tests never send real email. Messages land in testMail.sent instead,
// and setting testMail.fail = true makes every send fail.
export const testMail = {
  sent: [],
  fail: false,
  reset() {
    this.sent = [];
    this.fail = false;
  },
};

const testTransport = {
  async sendMail(message) {
    if (testMail.fail) throw new Error("The test mail server is down");
    testMail.sent.push(message);
  },
};

let transport = null;
let warnedOff = false;

export function mailEnabled() {
  return Boolean(config.smtpHost && config.smtpUser && config.smtpPass);
}

function getTransport() {
  if (config.isTest) return testTransport;
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465, // port 465 uses TLS from the start; 587 upgrades to it
      auth: { user: config.smtpUser, pass: config.smtpPass },
      // A slow mail server must not hold up an admin's click for long.
      connectionTimeout: 10 * 1000,
      greetingTimeout: 10 * 1000,
      socketTimeout: 20 * 1000,
    });
  }
  return transport;
}

// Squeezes a subject onto one line, so a mentor name with a line break
// in it can never add extra email headers.
function oneLine(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

// Sends one plain text email. `to` may be empty (for example a mentor with
// no address saved), and then nothing happens. Never throws.
export async function sendMail({ to, subject, text }) {
  if (!to) return;
  if (!mailEnabled()) {
    if (!warnedOff) {
      console.log("Email is off because SMTP_HOST, SMTP_USER or SMTP_PASS is not set. No emails will be sent.");
      warnedOff = true;
    }
    return;
  }
  try {
    await getTransport().sendMail({ from: config.mailFrom, to, subject: oneLine(subject), text });
  } catch (err) {
    // The address is private, so only the subject goes in the log.
    console.error(`Email "${oneLine(subject)}" failed: ${err.message}`);
  }
}
