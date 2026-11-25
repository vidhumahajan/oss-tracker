import { useState } from "react";
import { api } from "../../api.js";
import { useApi } from "../../useApi.js";
import { shortDate } from "../../format.js";
import ConfirmButton from "../../components/ConfirmButton.jsx";

export default function Announcements() {
  const { data, reload } = useApi("/announcements");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({ text: "", failed: false });

  async function post(event) {
    event.preventDefault();
    setBusy(true);
    setNotice({ text: "", failed: false });
    try {
      await api("/admin/announcements", { method: "POST", body: { title, body } });
      setTitle("");
      setBody("");
      setNotice({ text: "Posted. It now shows on the home page.", failed: false });
      reload();
    } catch (err) {
      setNotice({ text: err.message, failed: true });
    } finally {
      setBusy(false);
    }
  }

  async function remove(item) {
    try {
      await api(`/admin/announcements/${item.id}`, { method: "DELETE" });
      setNotice({ text: "Deleted.", failed: false });
      reload();
    } catch (err) {
      setNotice({ text: err.message, failed: true });
    }
  }

  return (
    <div className="narrow">
      <p className="page-lede">The 5 newest announcements show on the home page for everyone.</p>

      <form className="form" onSubmit={post}>
        <label htmlFor="news-title">Title</label>
        <input
          id="news-title"
          value={title}
          maxLength={120}
          required
          onChange={(event) => setTitle(event.target.value)}
        />
        <label htmlFor="news-body">Message</label>
        <textarea
          id="news-body"
          rows={4}
          value={body}
          maxLength={2000}
          required
          onChange={(event) => setBody(event.target.value)}
        />
        <button type="submit" className="button" disabled={busy}>
          {busy ? "Posting…" : "Post announcement"}
        </button>
      </form>

      {notice.text && (
        <p className={notice.failed ? "status status-error" : "status status-ok"} role="status">
          {notice.text}
        </p>
      )}

      <h2>On the home page now</h2>
      {data && data.items.length === 0 && <p className="status">No announcements yet.</p>}
      <ul className="news news-admin">
        {data?.items.map((item) => (
          <li key={item.id}>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
            <time dateTime={item.createdAt}>{shortDate(item.createdAt)}</time>
            <ConfirmButton className="button-small" confirmLabel="Confirm delete" onConfirm={() => remove(item)}>
              Delete
            </ConfirmButton>
          </li>
        ))}
      </ul>
    </div>
  );
}
