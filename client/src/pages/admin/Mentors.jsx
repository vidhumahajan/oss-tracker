import { useState } from "react";
import { api } from "../../api.js";
import { useApi } from "../../useApi.js";
import Sessions from "./Sessions.jsx";

const EMPTY = { name: "", expertise: "", bio: "", meetLink: "", email: "" };

// The admin Mentors tab: add, edit, hide or show mentors, then the
// session requests below. There is no delete, so past sessions keep
// their mentor.
export default function Mentors() {
  const { data, error, reload } = useApi("/admin/mentors");
  const [editing, setEditing] = useState(null); // the id of the mentor being edited
  const [notice, setNotice] = useState({ text: "", failed: false });

  // Runs one admin action, then reloads the list and reports what happened.
  async function run(action, done) {
    setNotice({ text: "", failed: false });
    try {
      await action();
      setNotice({ text: done, failed: false });
      reload();
      return true;
    } catch (err) {
      setNotice({ text: err.message, failed: true });
      return false;
    }
  }

  const add = (fields) =>
    run(() => api("/admin/mentors", { method: "POST", body: fields }), `Added ${fields.name}.`);

  const save = (mentor, fields) =>
    run(() => api(`/admin/mentors/${mentor.id}`, { method: "PATCH", body: fields }), `Saved ${fields.name}.`).then(
      (ok) => ok && setEditing(null)
    );

  const setActive = (mentor, isActive) =>
    run(
      () => api(`/admin/mentors/${mentor.id}`, { method: "PATCH", body: { isActive } }),
      isActive ? `${mentor.name} is shown on the Mentors page again.` : `${mentor.name} is hidden from the Mentors page.`
    );

  return (
    <>
      <p className="page-lede">
        Mentors show on the public Mentors page. Their Google Meet link is private: only admins
        and members with a confirmed session can see it. Their email address is private too, and
        is used only for session emails.
      </p>

      {notice.text && (
        <p className={notice.failed ? "status status-error" : "status status-ok"} role="status">
          {notice.text}
        </p>
      )}

      <h2>Add mentor</h2>
      <MentorForm initial={EMPTY} submitLabel="Add mentor" onSubmit={add} clearAfter />

      <h2>Mentors</h2>
      {error && <p className="status status-error">{error.message}</p>}
      {data && data.items.length === 0 && <p className="status">No mentors yet.</p>}
      {data && data.items.length > 0 && (
        <ul className="mentor-list">
          {data.items.map((mentor) => (
            <li key={mentor.id}>
              {editing === mentor.id ? (
                <MentorForm
                  initial={mentor}
                  submitLabel="Save changes"
                  onSubmit={(fields) => save(mentor, fields)}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <>
                  <div className="session-head">
                    <h3>{mentor.name}</h3>
                    {!mentor.isActive && <span className="tag">Hidden</span>}
                  </div>
                  <p className="mentor-expertise">{mentor.expertise}</p>
                  <p className="mentor-bio">{mentor.bio}</p>
                  <p className="session-meta">
                    <a href={mentor.meetLink} target="_blank" rel="noreferrer">
                      {mentor.meetLink}
                    </a>
                  </p>
                  <p className="session-meta">{mentor.email || "No email address, so no session emails"}</p>
                  <div className="actions">
                    <button type="button" className="button button-quiet button-small" onClick={() => setEditing(mentor.id)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button button-quiet button-small"
                      onClick={() => setActive(mentor, !mentor.isActive)}
                    >
                      {mentor.isActive ? "Hide" : "Show"}
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <Sessions />
    </>
  );
}

// The same form for adding and editing a mentor.
// onSubmit returns true when the save worked.
function MentorForm({ initial, submitLabel, onSubmit, onCancel, clearAfter = false }) {
  const [fields, setFields] = useState({
    name: initial.name,
    expertise: initial.expertise,
    bio: initial.bio,
    meetLink: initial.meetLink,
    email: initial.email || "",
  });
  const [busy, setBusy] = useState(false);
  const id = (name) => `mentor-${initial.id || "new"}-${name}`;
  const change = (name) => (event) => setFields((current) => ({ ...current, [name]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    const ok = await onSubmit(fields);
    setBusy(false);
    if (ok && clearAfter) setFields(EMPTY);
  }

  return (
    <form className="form form-narrow" onSubmit={submit}>
      <label htmlFor={id("name")}>Name</label>
      <input id={id("name")} value={fields.name} maxLength={80} required onChange={change("name")} />

      <label htmlFor={id("expertise")}>Expertise</label>
      <input
        id={id("expertise")}
        value={fields.expertise}
        maxLength={120}
        required
        placeholder="For example: GSoC 2026 with Kubescape, Go"
        onChange={change("expertise")}
      />

      <label htmlFor={id("bio")}>Bio</label>
      <textarea id={id("bio")} rows={4} value={fields.bio} maxLength={600} required onChange={change("bio")} />

      <label htmlFor={id("meet")}>Google Meet link</label>
      <input
        id={id("meet")}
        type="url"
        value={fields.meetLink}
        maxLength={200}
        required
        placeholder="https://meet.google.com/abc-defg-hij"
        onChange={change("meetLink")}
      />

      <label htmlFor={id("email")}>Email address (optional)</label>
      <input
        id={id("email")}
        type="email"
        value={fields.email}
        maxLength={200}
        placeholder="For session emails and reminders"
        onChange={change("email")}
      />

      <div className="actions">
        <button type="submit" className="button" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="button button-quiet" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
