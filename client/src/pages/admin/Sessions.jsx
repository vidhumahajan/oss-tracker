import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api.js";
import { useApi } from "../../useApi.js";
import { dateTime, plural, shortDate } from "../../format.js";
import ConfirmButton from "../../components/ConfirmButton.jsx";
import Pager from "../../components/Pager.jsx";

const STATUS_WORD = {
  requested: "Requested",
  confirmed: "Confirmed",
  declined: "Declined",
  done: "Done",
  cancelled: "Cancelled",
};

// Session requests, newest first, shown under the mentors on the admin Mentors tab.
export default function Sessions() {
  const [page, setPage] = useState(1);
  const { data, error, reload } = useApi(`/admin/bookings?page=${page}`);
  const [notice, setNotice] = useState({ text: "", failed: false });

  async function change(item, body, done) {
    setNotice({ text: "", failed: false });
    try {
      await api(`/admin/bookings/${item.id}`, { method: "PATCH", body });
      setNotice({ text: done, failed: false });
      reload();
      return true;
    } catch (err) {
      setNotice({ text: err.message, failed: true });
      return false;
    }
  }

  return (
    <section>
      <h2>Session requests</h2>
      {notice.text && (
        <p className={notice.failed ? "status status-error" : "status status-ok"} role="status">
          {notice.text}
        </p>
      )}
      {error && <p className="status status-error">{error.message}</p>}
      {data && <p className="table-count">{plural(data.total, "request")}</p>}
      {data && data.items.length === 0 && <p className="status">No session requests yet.</p>}

      {data && data.items.length > 0 && (
        <ul className="session-list">
          {data.items.map((item) => (
            <SessionRow key={item.id} item={item} change={change} />
          ))}
        </ul>
      )}

      {data && <Pager page={data.page} totalPages={data.totalPages} onChange={setPage} />}
    </section>
  );
}

function SessionRow({ item, change }) {
  // Which small form is open under the row: "confirm", "decline" or none.
  const [form, setForm] = useState(null);
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  const who = `${item.member?.login || "A deleted member"} with ${item.mentor?.name || "a mentor"}`;

  async function confirm(event) {
    event.preventDefault();
    // The picker gives a local time like "2026-12-05T18:00". new Date reads it
    // in the admin's own time zone, and toISOString sends it as UTC.
    const scheduledAt = new Date(when).toISOString();
    if (await change(item, { status: "confirmed", scheduledAt }, `Confirmed ${who}.`)) setForm(null);
  }

  async function decline(event) {
    event.preventDefault();
    if (await change(item, { status: "declined", adminNote: note }, `Declined ${who}.`)) setForm(null);
  }

  return (
    <li>
      <div className="session-head">
        {item.member ? <Link to={`/u/${item.member.login}`}>{item.member.login}</Link> : <span>A deleted member</span>}
        <span>with {item.mentor?.name || "a mentor"}</span>
        <span className={item.status === "confirmed" ? "tag tag-ok" : "tag"}>{STATUS_WORD[item.status]}</span>
      </div>
      <p className="session-meta">
        {item.topic}. Prefers: {item.preferredTimes}. Requested {shortDate(item.createdAt)}.
      </p>
      {item.scheduledAt && <p className="session-when">{dateTime(item.scheduledAt)}</p>}
      {item.adminNote && <p className="session-meta">Note: {item.adminNote}</p>}

      {item.status === "requested" && !form && (
        <div className="actions">
          <button type="button" className="button button-small" onClick={() => setForm("confirm")}>
            Confirm
          </button>
          <button type="button" className="button button-quiet button-small" onClick={() => setForm("decline")}>
            Decline
          </button>
        </div>
      )}

      {item.status === "confirmed" && (
        <div className="actions">
          <button
            type="button"
            className="button button-quiet button-small"
            onClick={() => change(item, { status: "done" }, `Marked ${who} as done.`)}
          >
            Mark done
          </button>
          <ConfirmButton
            className="button-small"
            confirmLabel="Confirm cancel"
            onConfirm={() => change(item, { status: "cancelled" }, `Cancelled ${who}.`)}
          >
            Cancel
          </ConfirmButton>
        </div>
      )}

      {form === "confirm" && (
        <form className="inline-form" onSubmit={confirm}>
          <label htmlFor={`when-${item.id}`}>Date and time (your local time)</label>
          <input id={`when-${item.id}`} type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} />
          <button type="submit" className="button button-small">
            Confirm session
          </button>
          <button type="button" className="button button-quiet button-small" onClick={() => setForm(null)}>
            Back
          </button>
        </form>
      )}

      {form === "decline" && (
        <form className="inline-form" onSubmit={decline}>
          <label htmlFor={`note-${item.id}`}>Note for the member (optional)</label>
          <input id={`note-${item.id}`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          <button type="submit" className="button button-danger button-small">
            Decline session
          </button>
          <button type="button" className="button button-quiet button-small" onClick={() => setForm(null)}>
            Back
          </button>
        </form>
      )}
    </li>
  );
}
