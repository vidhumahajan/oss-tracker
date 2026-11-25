import { test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { app, request, useDatabase, memberWithPrs, testMail } from "./helpers.js";
import { config } from "../src/config.js";
import { Booking } from "../src/models/Booking.js";
import { AdminLog } from "../src/models/AdminLog.js";
import { sendDueReminders } from "../src/jobs/reminderLoop.js";

useDatabase();

const MEET = "https://meet.google.com/abc-defg-hij";
const ALICE = "alice@example.com";
const MENTOR = "priya@example.com";
const ADMINS = "admins@test.example"; // ADMIN_EMAIL in tests/setup.js
const MINUTE = 60 * 1000;

const smtpHost = config.smtpHost;
afterEach(() => {
  config.smtpHost = smtpHost;
});

// "the-owner" is an admin (tests/setup.js). alice and bob are members.
async function setup({ mentorEmail = MENTOR } = {}) {
  const owner = await memberWithPrs("the-owner", []);
  const alice = await memberWithPrs("alice", []);
  const bob = await memberWithPrs("bob", []);
  const mentor = (
    await owner.agent.post("/api/admin/mentors").send({
      name: "Priya Nair",
      expertise: "GSoC 2026 with Kubescape, Go",
      bio: "Contributor to Kubescape for two years.",
      meetLink: MEET,
      email: mentorEmail,
    })
  ).body.item;
  testMail.reset();
  return { owner, alice, bob, mentor };
}

const book = (member, mentor, extra = {}) =>
  member.agent
    .post(`/api/mentors/${mentor.id}/bookings`)
    .send({ topic: "Preparing my GSoC proposal", preferredTimes: "Saturday after 6pm", email: ALICE, ...extra });

const adminMove = (owner, id, body) => owner.agent.patch(`/api/admin/bookings/${id}`).send(body);

// Books a session for alice and confirms it at `at`. Clears the mailbox after.
async function confirmedSession({ owner, alice, mentor }, at = new Date(Date.now() + 24 * 60 * MINUTE)) {
  const id = (await book(alice, mentor)).body.item.id;
  await adminMove(owner, id, { status: "confirmed", scheduledAt: at.toISOString() });
  testMail.reset();
  return { id, at };
}

const mailTo = (address) => testMail.sent.filter((m) => m.to === address);
const recipients = () => testMail.sent.map((m) => m.to).sort();

// ---------- The five emails ----------

test("1. a new request emails the admins with the member, mentor, topic, times and a link", async () => {
  const { alice, mentor } = await setup();
  assert.equal((await book(alice, mentor)).status, 201);

  assert.deepEqual(recipients(), [ADMINS]);
  const [mail] = testMail.sent;
  assert.equal(mail.subject, "New session request from alice");
  assert.equal(mail.from, "OSS Tracker <sender@test.example>");
  for (const part of ["alice", "Priya Nair", "Preparing my GSoC proposal", "Saturday after 6pm", "http://localhost:5173/admin/mentors"]) {
    assert.ok(mail.text.includes(part), part);
  }
});

test("2. confirming emails the member (with a calendar link) and the mentor", async () => {
  const { owner, alice, mentor } = await setup();
  const id = (await book(alice, mentor)).body.item.id;
  testMail.reset();
  await adminMove(owner, id, { status: "confirmed", scheduledAt: "2030-12-05T12:30:00.000Z" });

  assert.deepEqual(recipients(), [ALICE, MENTOR].sort());
  const [member] = mailTo(ALICE);
  assert.equal(member.subject, "Your session with Priya Nair is confirmed");
  assert.ok(member.text.includes("Thursday, 5 December 2030 at 6:00 pm India Standard Time"));
  assert.ok(member.text.includes("http://localhost:5173/mentors"));

  const calendar = new URL(member.text.match(/https:\/\/calendar\.google\.com\/\S+/)[0]);
  assert.equal(calendar.searchParams.get("action"), "TEMPLATE");
  assert.equal(calendar.searchParams.get("dates"), "20301205T123000Z/20301205T130000Z"); // 30 minutes
  assert.equal(calendar.searchParams.get("text"), "OSS Tracker session with Priya Nair");

  const [toMentor] = mailTo(MENTOR);
  assert.equal(toMentor.subject, "New session with alice");
  for (const part of ["alice", "Preparing my GSoC proposal", "6:00 pm India Standard Time"]) {
    assert.ok(toMentor.text.includes(part), part);
  }
});

test("a mentor without an email address gets nothing, and the member still does", async () => {
  const { owner, alice, mentor } = await setup({ mentorEmail: "" });
  const id = (await book(alice, mentor)).body.item.id;
  testMail.reset();
  await adminMove(owner, id, { status: "confirmed", scheduledAt: new Date(Date.now() + 60 * MINUTE).toISOString() });
  assert.deepEqual(recipients(), [ALICE]);
});

test("3. a decline emails the member with the admin's note, and nobody else", async () => {
  const { owner, alice, mentor } = await setup();
  const id = (await book(alice, mentor)).body.item.id;
  testMail.reset();
  await adminMove(owner, id, { status: "declined", adminNote: "Priya is away this month" });

  assert.deepEqual(recipients(), [ALICE]);
  assert.equal(testMail.sent[0].subject, "Your session request with Priya Nair");
  assert.ok(testMail.sent[0].text.includes("Note from the admins: Priya is away this month"));
});

test("3. an admin cancelling a confirmed session emails the member (with the note) and the mentor", async () => {
  const ctx = await setup();
  const { id } = await confirmedSession(ctx);
  await adminMove(ctx.owner, id, { status: "cancelled", adminNote: "Priya is unwell" });

  assert.deepEqual(recipients(), [ALICE, MENTOR].sort());
  assert.ok(mailTo(ALICE)[0].text.includes("cancelled by the admins"));
  assert.ok(mailTo(ALICE)[0].text.includes("Note from the admins: Priya is unwell"));
  assert.equal(mailTo(MENTOR)[0].subject, "Session with alice is cancelled");
});

test("3. a member cancelling a confirmed session emails the member, the mentor and the admins", async () => {
  const ctx = await setup();
  const { id } = await confirmedSession(ctx);
  await ctx.alice.agent.post(`/api/mentors/bookings/${id}/cancel`);

  assert.deepEqual(recipients(), [ADMINS, ALICE, MENTOR].sort());
  assert.ok(mailTo(ALICE)[0].text.includes("You cancelled your session with Priya Nair on"));
  assert.ok(mailTo(ADMINS)[0].text.includes("alice cancelled their session with Priya Nair"));
});

test("3. a member withdrawing a request emails the member and the admins, not the mentor", async () => {
  const { alice, mentor } = await setup();
  const id = (await book(alice, mentor)).body.item.id;
  testMail.reset();
  await alice.agent.post(`/api/mentors/bookings/${id}/cancel`);
  assert.deepEqual(recipients(), [ADMINS, ALICE].sort());
});

test("marking a session done sends no email", async () => {
  const ctx = await setup();
  const { id } = await confirmedSession(ctx);
  await adminMove(ctx.owner, id, { status: "done" });
  assert.deepEqual(testMail.sent, []);
});

test("4 and 5. each reminder goes to the right people, once", async () => {
  const ctx = await setup();
  const { id, at } = await confirmedSession(ctx, new Date(Date.now() + 20 * MINUTE));

  // 4. Inside the last 30 minutes: member, mentor and admins.
  await sendDueReminders(new Date(at.getTime() - 20 * MINUTE));
  assert.deepEqual(recipients(), [ADMINS, ALICE, MENTOR].sort());
  assert.equal(mailTo(ALICE)[0].subject, "Your session with Priya Nair starts in 20 minutes");
  assert.ok(mailTo(ADMINS)[0].text.includes("alice's session with Priya Nair starts in 20 minutes"));

  testMail.reset();
  await sendDueReminders(new Date(at.getTime() - 19 * MINUTE));
  await sendDueReminders(new Date(at.getTime() - 5 * MINUTE));
  assert.deepEqual(testMail.sent, []); // not again

  // 5. At the start: member and mentor.
  await sendDueReminders(new Date(at.getTime() + 30 * 1000));
  assert.deepEqual(recipients(), [ALICE, MENTOR].sort());
  assert.equal(mailTo(ALICE)[0].subject, "Your session with Priya Nair is starting now");

  testMail.reset();
  await sendDueReminders(new Date(at.getTime() + 2 * MINUTE));
  assert.deepEqual(testMail.sent, []);

  const saved = await Booking.findById(id);
  assert.ok(saved.reminder30SentAt);
  assert.ok(saved.reminderStartSentAt);
});

test("nothing is sent for a session more than 30 minutes away, or one that is not confirmed", async () => {
  const ctx = await setup();
  const { id, at } = await confirmedSession(ctx, new Date(Date.now() + 60 * MINUTE));
  await sendDueReminders(new Date(at.getTime() - 31 * MINUTE));
  assert.deepEqual(testMail.sent, []);

  await adminMove(ctx.owner, id, { status: "done" });
  await sendDueReminders(new Date(at.getTime() - 10 * MINUTE));
  await sendDueReminders(at);
  assert.deepEqual(testMail.sent, []);
});

test("late reminders: the 30 minute one until the start, the start one up to 10 minutes late", async () => {
  const ctx = await setup();
  const { id, at } = await confirmedSession(ctx, new Date(Date.now() + 60 * MINUTE));

  // The server was down until 3 minutes before the start.
  await sendDueReminders(new Date(at.getTime() - 3 * MINUTE));
  assert.equal(mailTo(ALICE)[0].subject, "Your session with Priya Nair starts in 3 minutes");

  // Down again until 9 minutes after the start: the start one still goes.
  testMail.reset();
  await sendDueReminders(new Date(at.getTime() + 9 * MINUTE));
  assert.deepEqual(recipients(), [ALICE, MENTOR].sort());

  // Another session, with the server down until after it started: no
  // 30 minute reminder, and past 10 minutes no start reminder either.
  await Booking.updateOne({ _id: id }, { status: "done" });
  const other = await confirmedSession(ctx, new Date(Date.now() + 60 * MINUTE));
  await sendDueReminders(new Date(other.at.getTime() + 5 * MINUTE));
  assert.deepEqual(testMail.sent.map((m) => m.subject), [
    "Your session with Priya Nair is starting now",
    "Your session with alice is starting now",
  ]);
  assert.equal((await Booking.findById(other.id)).reminder30SentAt, undefined);

  testMail.reset();
  await Booking.updateOne({ _id: other.id }, { $unset: { reminderStartSentAt: 1 } });
  await sendDueReminders(new Date(other.at.getTime() + 11 * MINUTE));
  assert.deepEqual(testMail.sent, []);
});

test("rescheduling clears both reminder marks, emails the change, and is logged", async () => {
  const ctx = await setup();
  const { id, at } = await confirmedSession(ctx, new Date(Date.now() + 20 * MINUTE));
  await sendDueReminders(new Date(at.getTime() - 20 * MINUTE));
  await sendDueReminders(new Date(at.getTime() + MINUTE));
  testMail.reset();

  const later = new Date("2030-12-06T04:30:00.000Z");
  const res = await adminMove(ctx.owner, id, { scheduledAt: later.toISOString() });
  assert.equal(res.status, 200);
  assert.equal(res.body.item.scheduledAt, later.toISOString());
  assert.equal(res.body.item.status, "confirmed");

  const saved = await Booking.findById(id);
  assert.equal(saved.reminder30SentAt, undefined);
  assert.equal(saved.reminderStartSentAt, undefined);

  assert.deepEqual(recipients(), [ALICE, MENTOR].sort());
  for (const mail of testMail.sent) {
    assert.ok(mail.text.includes("Friday, 6 December 2030 at 10:00 am India Standard Time"), mail.to);
  }
  assert.ok(mailTo(ALICE)[0].text.includes("dates=20301206T043000Z%2F20301206T050000Z"));

  const entry = await AdminLog.findOne({ action: "reschedule_session" });
  assert.equal(entry.target, "alice with Priya Nair");
  assert.match(entry.details, /^from .+ UTC to 2030-12-06 04:30 UTC$/);

  // The reminders go out again for the new time.
  testMail.reset();
  await sendDueReminders(new Date(later.getTime() - 25 * MINUTE));
  assert.equal(mailTo(ALICE).length, 1);
});

test("only a confirmed session can be moved, and only to a future time", async () => {
  const ctx = await setup();
  const requested = (await book(ctx.alice, ctx.mentor)).body.item.id;
  assert.equal((await adminMove(ctx.owner, requested, { scheduledAt: "2030-01-01T10:00:00Z" })).status, 409);
  await adminMove(ctx.owner, requested, { status: "confirmed", scheduledAt: "2030-01-01T10:00:00Z" });
  testMail.reset();

  assert.equal((await adminMove(ctx.owner, requested, { scheduledAt: "2020-01-01T10:00:00Z" })).status, 400);
  assert.equal((await adminMove(ctx.owner, requested, { scheduledAt: "soon" })).status, 400);
  // The same time again changes nothing.
  assert.equal((await adminMove(ctx.owner, requested, { scheduledAt: "2030-01-01T10:00:00Z" })).status, 200);
  assert.deepEqual(testMail.sent, []);
  assert.equal(await AdminLog.countDocuments({ action: "reschedule_session" }), 0);
  // Members cannot move sessions.
  assert.equal((await ctx.alice.agent.patch(`/api/admin/bookings/${requested}`).send({ scheduledAt: "2031-01-01T10:00:00Z" })).status, 403);
});

test("the Meet link never appears in any email to a member", async () => {
  const ctx = await setup();
  const all = [];
  const keep = () => {
    all.push(...testMail.sent);
    testMail.reset();
  };
  const { id, at } = await confirmedSession(ctx, new Date(Date.now() + 20 * MINUTE));
  await adminMove(ctx.owner, id, { scheduledAt: new Date(at.getTime() + MINUTE).toISOString() });
  keep();
  await sendDueReminders(new Date(at.getTime() - 10 * MINUTE));
  await sendDueReminders(new Date(at.getTime() + 2 * MINUTE));
  keep();
  await ctx.alice.agent.post(`/api/mentors/bookings/${id}/cancel`);
  keep();
  const second = (await book(ctx.alice, ctx.mentor)).body.item.id;
  await adminMove(ctx.owner, second, { status: "declined" });
  keep();

  const toMember = all.filter((m) => m.to === ALICE);
  assert.ok(toMember.length >= 5);
  for (const mail of toMember) {
    assert.ok(!mail.text.includes("meet.google.com"), mail.subject);
    assert.ok(!mail.subject.includes("meet.google.com"));
  }
});

test("no email ever has an em dash in it", async () => {
  const ctx = await setup();
  const { id, at } = await confirmedSession(ctx, new Date(Date.now() + 20 * MINUTE));
  const all = [];
  await sendDueReminders(new Date(at.getTime() - 20 * MINUTE));
  await sendDueReminders(at);
  all.push(...testMail.sent);
  await ctx.alice.agent.post(`/api/mentors/bookings/${id}/cancel`);
  all.push(...testMail.sent);
  for (const mail of all) assert.ok(!/[–—]/.test(mail.subject + mail.text), mail.subject);
});

// ---------- When sending does not work ----------

test("without SMTP settings nothing is sent, one line is logged, and everything still works", async () => {
  const ctx = await setup();
  config.smtpHost = "";
  const logged = [];
  mock.method(console, "log", (...args) => logged.push(args.join(" ")));

  const res = await book(ctx.alice, ctx.mentor);
  assert.equal(res.status, 201);
  const confirm = await adminMove(ctx.owner, res.body.item.id, { status: "confirmed", scheduledAt: new Date(Date.now() + 60 * MINUTE).toISOString() });
  assert.equal(confirm.status, 200);
  assert.deepEqual(testMail.sent, []);
  assert.equal(logged.filter((line) => line.startsWith("Email is off")).length, 1);
});

test("a failed send is logged and does not fail the request", async () => {
  const ctx = await setup();
  testMail.fail = true;
  const errors = [];
  mock.method(console, "error", (...args) => errors.push(args.join(" ")));

  const res = await book(ctx.alice, ctx.mentor);
  assert.equal(res.status, 201);
  const id = res.body.item.id;
  assert.equal((await adminMove(ctx.owner, id, { status: "confirmed", scheduledAt: new Date(Date.now() + 60 * MINUTE).toISOString() })).status, 200);
  assert.equal((await ctx.alice.agent.post(`/api/mentors/bookings/${id}/cancel`)).status, 200);
  assert.equal((await Booking.findById(id)).status, "cancelled");

  assert.ok(errors.some((line) => line.includes('Email "New session request from alice" failed')));
  assert.ok(!errors.join(" ").includes(ALICE)); // addresses stay out of the log
});

// ---------- Addresses are private ----------

test("a session request needs a valid email address of at most 200 characters", async () => {
  const { alice, mentor } = await setup();
  for (const email of [undefined, "", "not-an-email", "a@b", "a b@example.com", `${"a".repeat(190)}@example.com`, { $ne: "" }]) {
    assert.equal((await book(alice, mentor, { email })).status, 400, JSON.stringify(email));
  }
  assert.equal(await Booking.countDocuments(), 0);
  assert.equal((await book(alice, mentor, { email: "  alice@example.com " })).status, 201);
  assert.equal((await Booking.findOne()).email, "alice@example.com");
});

test("a mentor's email is optional, checked, and can be changed or removed", async () => {
  const { owner, mentor } = await setup();
  const url = `/api/admin/mentors/${mentor.id}`;
  assert.equal(mentor.email, MENTOR);
  assert.equal((await owner.agent.patch(url).send({ email: "nope" })).status, 400);
  assert.equal((await owner.agent.patch(url).send({ email: "new@example.com" })).body.item.email, "new@example.com");
  assert.equal((await owner.agent.patch(url).send({ email: "" })).body.item.email, "");

  const without = await owner.agent.post("/api/admin/mentors").send({ name: "No Mail", expertise: "Rust", bio: "Hi.", meetLink: MEET });
  assert.equal(without.status, 201);
  assert.equal(without.body.item.email, "");

  // Changing the email is logged without the address itself.
  const entries = await AdminLog.find({ action: "edit_mentor" });
  assert.ok(entries.every((e) => e.details === "changed email"));
});

test("email addresses appear only in admin answers", async () => {
  const ctx = await setup();
  const { id } = await confirmedSession(ctx);

  const admin = [
    await ctx.owner.agent.get("/api/admin/bookings"),
    await ctx.owner.agent.get("/api/admin/mentors"),
  ].map((res) => JSON.stringify(res.body));
  assert.ok(admin[0].includes(ALICE));
  assert.ok(admin[1].includes(MENTOR));

  const others = [
    await request(app).get("/api/mentors"),
    await ctx.alice.agent.get("/api/mentors"),
    await ctx.alice.agent.get("/api/mentors/bookings"),
    await ctx.alice.agent.get("/api/mentors/next-session"),
    await ctx.alice.agent.get("/api/auth/me"),
    await ctx.alice.agent.get("/api/users/alice"),
    await ctx.bob.agent.get("/api/mentors/bookings"),
    await ctx.bob.agent.get("/api/users/alice"),
    await ctx.alice.agent.post(`/api/mentors/bookings/${id}/cancel`),
    await book(ctx.alice, ctx.mentor),
  ];
  for (const res of others) {
    assert.ok(!JSON.stringify(res.body).includes("@example.com"), res.req.path);
  }
});

// ---------- In the site ----------

test("the Mentors link count rises when an admin changes a session and clears when the member opens their sessions", async () => {
  const ctx = await setup();
  const alerts = async (member) => (await member.agent.get("/api/auth/me")).body.user.sessionAlerts;

  const id = (await book(ctx.alice, ctx.mentor)).body.item.id;
  assert.equal(await alerts(ctx.alice), 0); // her own request is not news to her

  await adminMove(ctx.owner, id, { status: "confirmed", scheduledAt: new Date(Date.now() + 60 * MINUTE).toISOString() });
  assert.equal(await alerts(ctx.alice), 1);
  assert.equal(await alerts(ctx.bob), 0); // never someone else's

  // The home page's next-session line does not clear it.
  const next = await ctx.alice.agent.get("/api/mentors/next-session");
  assert.equal(next.body.item.mentorName, "Priya Nair");
  assert.ok(next.body.item.scheduledAt);
  assert.equal(await alerts(ctx.alice), 1);

  await ctx.alice.agent.get("/api/mentors/bookings");
  assert.equal(await alerts(ctx.alice), 0);

  await adminMove(ctx.owner, id, { scheduledAt: new Date(Date.now() + 90 * MINUTE).toISOString() });
  assert.equal(await alerts(ctx.alice), 1);
  await ctx.alice.agent.get("/api/mentors/bookings");

  // Her own cancel is not news either.
  await ctx.alice.agent.post(`/api/mentors/bookings/${id}/cancel`);
  assert.equal(await alerts(ctx.alice), 0);
  assert.equal((await ctx.alice.agent.get("/api/mentors/next-session")).body.item, null);
});

test("the next-session line shows only the member's own upcoming confirmed session", async () => {
  const ctx = await setup();
  await book(ctx.alice, ctx.mentor);
  assert.equal((await ctx.alice.agent.get("/api/mentors/next-session")).body.item, null); // only requested
  await confirmedSession({ ...ctx, alice: ctx.bob }, new Date(Date.now() + 60 * MINUTE));
  assert.equal((await ctx.alice.agent.get("/api/mentors/next-session")).body.item, null);
  assert.ok((await ctx.bob.agent.get("/api/mentors/next-session")).body.item);
  assert.equal((await request(app).get("/api/mentors/next-session")).status, 401);
});

test("deleting an account removes that member's sessions and only theirs", async () => {
  const ctx = await setup();
  await book(ctx.alice, ctx.mentor);
  await book(ctx.bob, ctx.mentor, { email: "bob@example.com" });
  await ctx.alice.agent.delete("/api/me");
  assert.deepEqual((await Booking.find()).map((b) => b.email), ["bob@example.com"]);
});
