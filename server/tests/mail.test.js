import { test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { useDatabase, memberWithPrs, testMail, brevo } from "./helpers.js";
import { config } from "../src/config.js";
import { parseFrom } from "../src/services/mail.js";

useDatabase();

const KEY = "xkeysib-test-key";
const ADMINS = "admins@test.example"; // ADMIN_EMAIL in tests/setup.js

const saved = { brevoApiKey: config.brevoApiKey, mailFrom: config.mailFrom };
afterEach(() => Object.assign(config, saved));

// alice requests a session, which emails ADMIN_EMAIL. Returns the answer.
async function requestSession() {
  const owner = await memberWithPrs("the-owner", []);
  const alice = await memberWithPrs("alice", []);
  const mentor = (
    await owner.agent.post("/api/admin/mentors").send({
      name: "Priya Nair",
      expertise: "GSoC 2026 with Kubescape, Go",
      bio: "Contributor to Kubescape for two years.",
      meetLink: "https://meet.google.com/abc-defg-hij",
    })
  ).body.item;
  testMail.reset();
  brevo.calls = [];
  return alice.agent
    .post(`/api/mentors/${mentor.id}/bookings`)
    .send({ topic: "Preparing my GSoC proposal", preferredTimes: "Saturday after 6pm", email: "alice@example.com" });
}

test("with BREVO_API_KEY, an email goes to Brevo with the sender, recipient, subject and text, and not SMTP", async () => {
  config.brevoApiKey = KEY;
  assert.equal((await requestSession()).status, 201);

  assert.equal(brevo.calls.length, 1);
  const [call] = brevo.calls;
  assert.equal(call.url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(call.apiKey, KEY);
  assert.ok(call.signal instanceof AbortSignal, "the request has a timeout");
  assert.deepEqual(call.body.sender, { name: "OSS Tracker", email: "sender@test.example" });
  assert.deepEqual(call.body.to, [{ email: ADMINS }]);
  assert.equal(call.body.subject, "New session request from alice");
  assert.ok(call.body.textContent.includes("Preparing my GSoC proposal"));
  assert.equal(call.body.htmlContent, undefined, "emails stay plain text");
  assert.deepEqual(testMail.sent, [], "SMTP is not used");
});

test("a Brevo error is logged with its status and message, without the key or address, and the request still succeeds", async () => {
  config.brevoApiKey = KEY;
  brevo.status = 400;
  brevo.errorMessage = `Invalid email address ${ADMINS}`;
  const errors = mock.method(console, "error", () => {});

  assert.equal((await requestSession()).status, 201);
  const logged = errors.mock.calls.map((c) => c.arguments.join(" ")).join("\n");
  assert.match(logged, /Email "New session request from alice" failed: Brevo answered 400: Invalid email address \[recipient\]/);
  assert.ok(!logged.includes(KEY), "no API key in the log");
  assert.ok(!logged.includes(ADMINS), "no address in the log");
});

test("MAIL_FROM is split into a name and an address, with or without a name", () => {
  assert.deepEqual(parseFrom("OSS Tracker <site@example.com>"), { name: "OSS Tracker", email: "site@example.com" });
  assert.deepEqual(parseFrom('"OSS Tracker" <site@example.com>'), { name: "OSS Tracker", email: "site@example.com" });
  assert.deepEqual(parseFrom("<site@example.com>"), { email: "site@example.com" });
  assert.deepEqual(parseFrom("  site@example.com  "), { email: "site@example.com" });
});

test("a bare MAIL_FROM address is sent to Brevo without a name", async () => {
  config.brevoApiKey = KEY;
  config.mailFrom = "site@example.com";
  await requestSession();
  assert.deepEqual(brevo.calls[0].body.sender, { email: "site@example.com" });
});

test("without BREVO_API_KEY, email goes through SMTP as before and Brevo is never called", async () => {
  assert.equal((await requestSession()).status, 201);
  assert.equal(brevo.calls.length, 0);
  assert.equal(testMail.sent.length, 1);
  assert.equal(testMail.sent[0].to, ADMINS);
  assert.equal(testMail.sent[0].from, "OSS Tracker <sender@test.example>");
});
