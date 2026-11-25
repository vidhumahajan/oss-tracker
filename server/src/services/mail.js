// Every email the site sends goes through this file, so there is one place
// to look when email fails. What the emails say is in sessionMail.js.
//
// There are two ways to send. With BREVO_API_KEY, every email goes to
// Brevo's HTTP API over HTTPS, which works on hosts that block SMTP ports.
// Without it, SMTP_HOST, SMTP_USER and SMTP_PASS are used. With neither,
// nothing is sent and everything else works as before. A failed send is
// logged and never breaks the request that caused it.
import nodemailer from "nodemailer";
import { config } from "../config.js";

// Tests never send real email. SMTP messages land in testMail.sent instead,
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

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

export function mailEnabled() {
  return Boolean(config.brevoApiKey || (config.smtpHost && config.smtpUser && config.smtpPass));
}

// Turns "OSS Tracker <site@example.com>" into { name, email }, the shape
// Brevo wants. A bare address gives { email } only.
export function parseFrom(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(.*?)\s*<([^<>]+)>$/);
  if (!match) return { email: text };
  const name = match[1].trim().replace(/^"(.*)"$/, "$1");
  return name ? { name, email: match[2].trim() } : { email: match[2].trim() };
}

async function sendWithBrevo({ to, subject, text }) {
  const res = await fetch(BREVO_URL, {
    method: "POST",
    headers: { "api-key": config.brevoApiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: parseFrom(config.mailFrom), to: [{ email: to }], subject, textContent: text }),
    // A slow reply from Brevo must not hold up a page for long.
    signal: AbortSignal.timeout(10 * 1000),
  });
  if (res.ok) return;
  const body = await res.json().catch(() => ({}));
  // Brevo's message can quote the address it rejected, which is private.
  const message = String(body.message || res.statusText || "no message").split(to).join("[recipient]");
  throw new Error(`Brevo answered ${res.status}: ${message}`);
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
      console.log("Email is off because neither BREVO_API_KEY nor SMTP_HOST, SMTP_USER and SMTP_PASS are set. No emails will be sent.");
      warnedOff = true;
    }
    return;
  }
  try {
    if (config.brevoApiKey) await sendWithBrevo({ to, subject: oneLine(subject), text });
    else await getTransport().sendMail({ from: config.mailFrom, to, subject: oneLine(subject), text });
  } catch (err) {
    // The address is private, so only the subject goes in the log.
    console.error(`Email "${oneLine(subject)}" failed: ${err.message}`);
  }
}
