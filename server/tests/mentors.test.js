import { test } from "node:test";
import assert from "node:assert/strict";
import { app, request, useDatabase, memberWithPrs } from "./helpers.js";
import { AdminLog } from "../src/models/AdminLog.js";
import { Booking } from "../src/models/Booking.js";
import { Mentor } from "../src/models/Mentor.js";

useDatabase();

const MEET = "https://meet.google.com/abc-defg-hij";
const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

const mentorFields = (extra = {}) => ({
  name: "Priya Nair",
  expertise: "GSoC 2026 with Kubescape, Go",
  bio: "Contributor to Kubescape for two years.",
  meetLink: MEET,
  ...extra,
});

// "the-owner" is an admin (tests/setup.js). alice and bob are members.
async function setup() {
  const owner = await memberWithPrs("the-owner", []);
  const alice = await memberWithPrs("alice", []);
  const bob = await memberWithPrs("bob", []);
  const add = async (extra) => (await owner.agent.post("/api/admin/mentors").send(mentorFields(extra))).body.item;
  return { owner, alice, bob, add };
}

const book = (member, mentor, extra = {}) =>
  member.agent
    .post(`/api/mentors/${mentor.id}/bookings`)
    .send({ topic: "Preparing my GSoC proposal", preferredTimes: "Saturday after 6pm", email: "member@example.com", ...extra });

const actions = async () => (await AdminLog.find().sort({ createdAt: 1 })).map((e) => `${e.action}:${e.target}`);

test("only admins can manage mentors and sessions", async () => {
  const { alice, add } = await setup();
  const mentor = await add();
  const routes = [
    ["get", "/api/admin/mentors"],
    ["post", "/api/admin/mentors"],
    ["patch", `/api/admin/mentors/${mentor.id}`],
    ["get", "/api/admin/bookings"],
    ["patch", `/api/admin/bookings/${mentor.id}`],
  ];
  for (const [method, path] of routes) {
    assert.equal((await request(app)[method](path).send(mentorFields())).status, 401, `visitor ${method} ${path}`);
    assert.equal((await alice.agent[method](path).send(mentorFields())).status, 403, `member ${method} ${path}`);
  }
  assert.equal(await Mentor.countDocuments(), 1);
});

test("an admin adds, edits, hides and shows a mentor, and each change is logged", async () => {
  const { owner, add } = await setup();
  const mentor = await add();
  assert.equal(mentor.meetLink, MEET);
  assert.equal(mentor.isActive, true);

  const url = `/api/admin/mentors/${mentor.id}`;
  const edit = await owner.agent.patch(url).send({ bio: "Now a GSoC mentor too." });
  assert.equal(edit.body.item.bio, "Now a GSoC mentor too.");
  await owner.agent.patch(url).send({ isActive: false });
  await owner.agent.patch(url).send({ isActive: true });
  await owner.agent.patch(url).send({ name: "Priya Nair" }); // no real change, not logged

  assert.deepEqual(await actions(), [
    "add_mentor:Priya Nair",
    "edit_mentor:Priya Nair",
    "hide_mentor:Priya Nair",
    "show_mentor:Priya Nair",
  ]);
  assert.equal((await owner.agent.delete(url)).status, 404); // there is no delete
});

test("a mentor's link must be a Google Meet link", async () => {
  const { owner, add } = await setup();
  const bad = [
    "http://meet.google.com/abc-defg-hij",
    "https://meet.google.com.evil.example/abc",
    "https://evil.example/https://meet.google.com/abc",
    "https://zoom.us/j/123",
    "https://meet.google.com/",
    "https://meet.google.com/abc def",
    "javascript:alert(1)",
    "",
    42,
  ];
  for (const meetLink of bad) {
    const res = await owner.agent.post("/api/admin/mentors").send(mentorFields({ meetLink }));
    assert.equal(res.status, 400, JSON.stringify(meetLink));
  }
  const mentor = await add();
  const edit = await owner.agent.patch(`/api/admin/mentors/${mentor.id}`).send({ meetLink: "https://zoom.us/j/1" });
  assert.equal(edit.status, 400);
  assert.equal((await Mentor.findById(mentor.id)).meetLink, MEET);
});

test("mentor fields have size limits", async () => {
  const { owner } = await setup();
  const tooLong = [{ name: "x".repeat(81) }, { expertise: "x".repeat(121) }, { bio: "x".repeat(601) }, { name: "" }];
  for (const extra of tooLong) {
    assert.equal((await owner.agent.post("/api/admin/mentors").send(mentorFields(extra))).status, 400);
  }
  assert.equal(await Mentor.countDocuments(), 0);
});

test("the public mentor list shows active mentors and never the Meet link", async () => {
  const { owner, add } = await setup();
  await add();
  const hidden = await add({ name: "Hidden Mentor" });
  await owner.agent.patch(`/api/admin/mentors/${hidden.id}`).send({ isActive: false });

  const res = await request(app).get("/api/mentors");
  assert.deepEqual(res.body.items.map((m) => m.name), ["Priya Nair"]);
  assert.ok(!JSON.stringify(res.body).includes("meet.google.com"));
  assert.equal(res.body.items[0].meetLink, undefined);
});

test("the Meet link reaches only the member, and only once the session is confirmed", async () => {
  const { owner, alice, bob, add } = await setup();
  const mentor = await add();
  const created = await book(alice, mentor);
  assert.equal(created.status, 201);
  assert.equal(created.body.item.meetLink, null);
  assert.ok(!JSON.stringify((await alice.agent.get("/api/mentors/bookings")).body).includes("meet.google.com"));

  await owner.agent.patch(`/api/admin/bookings/${created.body.item.id}`).send({ status: "confirmed", scheduledAt: tomorrow() });

  const mine = (await alice.agent.get("/api/mentors/bookings")).body.items[0];
  assert.equal(mine.status, "confirmed");
  assert.equal(mine.meetLink, MEET);
  assert.ok(mine.scheduledAt);

  // Other people still cannot see it anywhere.
  assert.deepEqual((await bob.agent.get("/api/mentors/bookings")).body.items, []);
  assert.ok(!JSON.stringify((await request(app).get("/api/mentors")).body).includes("meet.google.com"));

  // Once done, the link is no longer handed out.
  await owner.agent.patch(`/api/admin/bookings/${created.body.item.id}`).send({ status: "done" });
  assert.equal((await alice.agent.get("/api/mentors/bookings")).body.items[0].meetLink, null);
});

test("a visitor must log in to book or see sessions", async () => {
  const { add } = await setup();
  const mentor = await add();
  assert.equal((await request(app).post(`/api/mentors/${mentor.id}/bookings`).send({ topic: "x", preferredTimes: "y" })).status, 401);
  assert.equal((await request(app).get("/api/mentors/bookings")).status, 401);
});

test("booking needs a topic and preferred times, within size limits", async () => {
  const { alice, add } = await setup();
  const mentor = await add();
  for (const extra of [{ topic: "" }, { preferredTimes: "" }, { topic: "x".repeat(201) }, { preferredTimes: "x".repeat(201) }, { topic: { $ne: "" } }]) {
    assert.equal((await book(alice, mentor, extra)).status, 400, JSON.stringify(extra));
  }
  assert.equal(await Booking.countDocuments(), 0);
});

test("one open session per mentor, and at most 2 open sessions in total", async () => {
  const { owner, alice, add } = await setup();
  const one = await add({ name: "One" });
  const two = await add({ name: "Two" });
  const three = await add({ name: "Three" });

  assert.equal((await book(alice, one)).status, 201);
  const same = await book(alice, one);
  assert.equal(same.status, 409);
  assert.equal(same.body.error.message, "You already have an open session with this mentor.");

  assert.equal((await book(alice, two)).status, 201);
  const third = await book(alice, three);
  assert.equal(third.status, 409);
  assert.equal(third.body.error.message, "You can have at most 2 open sessions at a time.");

  // A finished session frees a place, and the same mentor can be booked again.
  const first = await Booking.findOne({ mentor: one.id });
  await owner.agent.patch(`/api/admin/bookings/${first.id}`).send({ status: "declined", adminNote: "Mentor is away" });
  assert.equal((await book(alice, three)).status, 201);
  assert.equal(await Booking.countDocuments({ member: alice.user._id }), 3);
});

test("two requests at the same moment cannot both pass the limit", async () => {
  const { alice, add } = await setup();
  const mentor = await add();
  const results = await Promise.all([book(alice, mentor), book(alice, mentor)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(await Booking.countDocuments(), 1);
});

test("a hidden mentor cannot be booked", async () => {
  const { owner, alice, add } = await setup();
  const mentor = await add();
  await owner.agent.patch(`/api/admin/mentors/${mentor.id}`).send({ isActive: false });
  assert.equal((await book(alice, mentor)).status, 404);
  assert.equal((await alice.agent.post("/api/mentors/000000000000000000000000/bookings").send({ topic: "x", preferredTimes: "y" })).status, 404);
  assert.equal(await Booking.countDocuments(), 0);
});

test("the status moves only along the allowed steps, and admin changes are logged", async () => {
  const { owner, alice, add } = await setup();
  const mentor = await add();
  const id = (await book(alice, mentor)).body.item.id;
  const move = (body) => owner.agent.patch(`/api/admin/bookings/${id}`).send(body);

  // requested cannot jump to done, and confirming needs a future time.
  assert.equal((await move({ status: "done" })).status, 409);
  assert.equal((await move({ status: "confirmed" })).status, 400);
  assert.equal((await move({ status: "confirmed", scheduledAt: "not a date" })).status, 400);
  assert.equal((await move({ status: "confirmed", scheduledAt: "2020-01-01T10:00:00Z" })).status, 400);
  assert.equal((await move({ status: "requested" })).status, 400);
  assert.equal((await move({ status: "anything" })).status, 400);

  const when = tomorrow();
  const confirmed = await move({ status: "confirmed", scheduledAt: when });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.item.scheduledAt, when);

  // confirmed cannot be declined or confirmed again.
  assert.equal((await move({ status: "declined" })).status, 409);
  assert.equal((await move({ status: "confirmed", scheduledAt: when })).status, 409);

  assert.equal((await move({ status: "done" })).status, 200);
  // done is final.
  for (const status of ["confirmed", "declined", "cancelled"]) {
    assert.equal((await move({ status, scheduledAt: when })).status, 409, status);
  }
  assert.equal((await alice.agent.post(`/api/mentors/bookings/${id}/cancel`)).status, 409);

  const log = await actions();
  assert.deepEqual(log.slice(1), ["confirm_session:alice with Priya Nair", "complete_session:alice with Priya Nair"]);
  const confirmEntry = await AdminLog.findOne({ action: "confirm_session" });
  assert.match(confirmEntry.details, /^for \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
});

test("a declined session keeps the admin's note, and the decline is logged", async () => {
  const { owner, alice, add } = await setup();
  const mentor = await add();
  const id = (await book(alice, mentor)).body.item.id;
  await owner.agent.patch(`/api/admin/bookings/${id}`).send({ status: "declined", adminNote: "Fully booked this month" });

  const mine = (await alice.agent.get("/api/mentors/bookings")).body.items[0];
  assert.equal(mine.status, "declined");
  assert.equal(mine.adminNote, "Fully booked this month");
  assert.ok((await actions()).includes("decline_session:alice with Priya Nair"));
  assert.equal((await owner.agent.patch(`/api/admin/bookings/${id}`).send({ status: "declined", adminNote: "x".repeat(301) })).status, 409);
});

test("a member cancels their own requested or confirmed session", async () => {
  const { owner, alice, add } = await setup();
  const one = await add({ name: "One" });
  const two = await add({ name: "Two" });

  const requested = (await book(alice, one)).body.item.id;
  const cancel = await alice.agent.post(`/api/mentors/bookings/${requested}/cancel`);
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.item.status, "cancelled");
  assert.equal((await alice.agent.post(`/api/mentors/bookings/${requested}/cancel`)).status, 409);

  const confirmed = (await book(alice, two)).body.item.id;
  await owner.agent.patch(`/api/admin/bookings/${confirmed}`).send({ status: "confirmed", scheduledAt: tomorrow() });
  assert.equal((await alice.agent.post(`/api/mentors/bookings/${confirmed}/cancel`)).status, 200);
  // A member's own cancel is not an admin action.
  assert.ok(!(await actions()).some((a) => a.startsWith("cancel_session")));
});

test("a member cannot see or cancel another member's session", async () => {
  const { alice, bob, add } = await setup();
  const mentor = await add();
  const id = (await book(alice, mentor)).body.item.id;

  assert.deepEqual((await bob.agent.get("/api/mentors/bookings")).body.items, []);
  assert.equal((await bob.agent.post(`/api/mentors/bookings/${id}/cancel`)).status, 404);
  assert.equal((await Booking.findById(id)).status, "requested");
});

test("admins see every request, newest first", async () => {
  const { owner, alice, bob, add } = await setup();
  const mentor = await add();
  await book(alice, mentor);
  await book(bob, mentor, { topic: "LFX interview practice" });

  const res = await owner.agent.get("/api/admin/bookings");
  assert.equal(res.body.total, 2);
  assert.deepEqual(res.body.items.map((b) => b.member.login), ["bob", "alice"]);
  assert.equal(res.body.items[0].mentor.meetLink, MEET);
});

test("deleting my account removes my sessions", async () => {
  const { alice, add } = await setup();
  const mentor = await add();
  await book(alice, mentor);
  await alice.agent.delete("/api/me");
  assert.equal(await Booking.countDocuments(), 0);
});
