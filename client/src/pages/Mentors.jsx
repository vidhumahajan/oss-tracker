import { useState } from "react";
import { api } from "../api.js";
import { useApi } from "../useApi.js";
import { useAuth, loginUrl } from "../auth.jsx";
import { dateTime, shortDate } from "../format.js";
import ConfirmButton from "../components/ConfirmButton.jsx";

const STATUS_WORD = {
  requested: "Waiting for an admin",
  confirmed: "Confirmed",
  declined: "Declined",
  done: "Done",
  cancelled: "Cancelled",
};

// Public page: the mentors, and for logged-in members, their own sessions.
export default function Mentors() {
  const { user } = useAuth();
  const mentors = useApi("/mentors");
  const sessions = useApi(user ? "/mentors/bookings" : null);

  return (
    <>
      <h1>Mentors</h1>
      <p className="page-lede">
        Experienced people from the community who have been through GSoC or LFX Mentorship. Ask
        for a free 1-on-1 session about your proposal, a tricky pull request or interview practice.
        An admin will confirm a time with you.
      </p>

      {mentors.error && <p className="status status-error">{mentors.error.message}</p>}
      {mentors.data && mentors.data.items.length === 0 && (
        <p className="status">No mentors yet. Check back soon.</p>
      )}
      {mentors.data && mentors.data.items.length > 0 && (
        <ul className="mentor-list">
          {mentors.data.items.map((mentor) => (
            <li key={mentor.id}>
              <h2>{mentor.name}</h2>
              <p className="mentor-expertise">{mentor.expertise}</p>
              <p className="mentor-bio">{mentor.bio}</p>
              <RequestSession mentor={mentor} user={user} onBooked={sessions.reload} />
            </li>
          ))}
        </ul>
      )}

      {user && <MySessions sessions={sessions} />}
    </>
  );
}

// The "Request a session" button and the small form it opens.
function RequestSession({ mentor, user, onBooked }) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [preferredTimes, setPreferredTimes] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({ text: "", failed: false });

  async function send(event) {
    event.preventDefault();
    setBusy(true);
    setNotice({ text: "", failed: false });
    try {
      await api(`/mentors/${mentor.id}/bookings`, { method: "POST", body: { topic, preferredTimes } });
      setTopic("");
      setPreferredTimes("");
      setOpen(false);
      setNotice({ text: "Request sent. You will see the time under My sessions once an admin confirms it.", failed: false });
      onBooked();
    } catch (err) {
      setNotice({ text: err.message, failed: true });
    } finally {
      setBusy(false);
    }
  }

  const noticeLine = notice.text && (
    <p className={notice.failed ? "status status-error" : "status status-ok"} role="status">
      {notice.text}
    </p>
  );

  if (!open) {
    return (
      <>
        <button type="button" className="button" onClick={() => setOpen(true)}>
          Request a session
        </button>
        {noticeLine}
      </>
    );
  }

  // Visitors are asked to log in first, and come back to this page after.
  if (!user) {
    return (
      <p className="status">
        Please log in first. <a href={loginUrl("/mentors")}>Log in with GitHub</a> to request a
        session.
      </p>
    );
  }

  const ids = { topic: `topic-${mentor.id}`, times: `times-${mentor.id}` };
  return (
    <form className="form form-narrow" onSubmit={send}>
      <label htmlFor={ids.topic}>What would you like to talk about?</label>
      <input
        id={ids.topic}
        value={topic}
        maxLength={200}
        required
        placeholder="For example: my GSoC proposal for Kubescape"
        onChange={(event) => setTopic(event.target.value)}
      />
      <label htmlFor={ids.times}>When suits you?</label>
      <input
        id={ids.times}
        value={preferredTimes}
        maxLength={200}
        required
        placeholder="For example: Saturday after 6pm"
        onChange={(event) => setPreferredTimes(event.target.value)}
      />
      <div className="actions">
        <button type="submit" className="button" disabled={busy}>
          {busy ? "Sending…" : "Send request"}
        </button>
        <button type="button" className="button button-quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {noticeLine}
    </form>
  );
}

function MySessions({ sessions }) {
  const [error, setError] = useState("");

  async function cancel(item) {
    setError("");
    try {
      await api(`/mentors/bookings/${item.id}/cancel`, { method: "POST" });
      sessions.reload();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section>
      <h2>My sessions</h2>
      {error && <p className="status status-error">{error}</p>}
      {sessions.error && <p className="status status-error">{sessions.error.message}</p>}
      {sessions.data && sessions.data.items.length === 0 && (
        <p className="status">You have not requested a session yet.</p>
      )}
      {sessions.data && sessions.data.items.length > 0 && (
        <ul className="session-list">
          {sessions.data.items.map((item) => (
            <li key={item.id}>
              <div className="session-head">
                <strong>{item.mentor?.name || "A mentor"}</strong>
                <span className={item.status === "confirmed" ? "tag tag-ok" : "tag"}>
                  {STATUS_WORD[item.status]}
                </span>
              </div>
              <p className="session-meta">
                {item.topic}. You asked for: {item.preferredTimes}. Requested {shortDate(item.createdAt)}.
              </p>
              {item.status === "confirmed" && <p className="session-when">{dateTime(item.scheduledAt)}</p>}
              {item.status === "confirmed" && item.meetLink && (
                <p>
                  <a className="button button-small" href={item.meetLink} target="_blank" rel="noreferrer">
                    Join on Google Meet
                  </a>
                </p>
              )}
              {item.adminNote && <p className="session-meta">Note from the admins: {item.adminNote}</p>}
              {["requested", "confirmed"].includes(item.status) && (
                <ConfirmButton className="button-small" confirmLabel="Yes, cancel it" onConfirm={() => cancel(item)}>
                  Cancel session
                </ConfirmButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
