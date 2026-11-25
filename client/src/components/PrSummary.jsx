import { useState } from "react";
import { api } from "../api.js";
import ConfirmButton from "./ConfirmButton.jsx";

// The AI summary of one merged pull request, opened inline in the PR list.
// Anyone who can see the profile can read a saved summary. Only the author
// and admins see "Write summary", and only when the site has it switched on
// (the server tells us with canWrite).
export default function PrSummary({ login, pr, canWrite, isAdmin }) {
  const [hasSummary, setHasSummary] = useState(pr.hasSummary);
  const [summary, setSummary] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const url = `/users/${login}/prs/${pr.id}/summary`;

  // Runs one request and shows its error, if any.
  async function run(action) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function toggle() {
    if (open) return setOpen(false);
    if (summary) return setOpen(true);
    run(async () => {
      const data = await api(url);
      // null means an admin deleted it since the list loaded.
      setHasSummary(Boolean(data.summary));
      setSummary(data.summary);
      setOpen(Boolean(data.summary));
    });
  }

  function write() {
    run(async () => {
      const data = await api(url, { method: "POST" });
      setSummary(data.summary);
      setHasSummary(true);
      setOpen(true);
    });
  }

  function remove() {
    run(async () => {
      await api(`/admin/prs/${pr.id}/summary`, { method: "DELETE" });
      setSummary(null);
      setHasSummary(false);
      setOpen(false);
    });
  }

  if (!hasSummary && !canWrite) return null;

  return (
    <div className="summary-box">
      {hasSummary ? (
        <button
          type="button"
          className="button button-quiet button-small"
          aria-expanded={open}
          onClick={toggle}
          disabled={busy}
        >
          {busy ? "Loading…" : open ? "Hide summary" : "Show summary"}
        </button>
      ) : (
        <button type="button" className="button button-quiet button-small" onClick={write} disabled={busy}>
          {busy ? "Writing the summary…" : "Write summary"}
        </button>
      )}

      {error && <p className="status status-error">{error}</p>}

      {open && summary && (
        <div className="summary">
          <p className="summary-note">Written by AI. Check it against the pull request before you rely on it.</p>

          <h3>The problem</h3>
          <p>{summary.problem}</p>

          <h3>What the pull request changed</h3>
          <p>{summary.solution}</p>

          <h3>Concepts used</h3>
          <ul>
            {summary.concepts.map((concept, index) => (
              <li key={index}>
                <strong>{concept.name}</strong>: {concept.explanation}
              </li>
            ))}
          </ul>

          {summary.changes.length > 0 && (
            <>
              <h3>Files changed</h3>
              <ul>
                {summary.changes.map((item, index) => (
                  <li key={index}>
                    <code>{item.file}</code>: {item.change}
                  </li>
                ))}
              </ul>
            </>
          )}

          <h3>Questions an interviewer could ask</h3>
          <ol>
            {summary.questions.map((question, index) => (
              <li key={index}>{question}</li>
            ))}
          </ol>

          {isAdmin && (
            <ConfirmButton className="button-small" confirmLabel="Confirm delete" onConfirm={remove} disabled={busy}>
              Delete summary
            </ConfirmButton>
          )}
        </div>
      )}
    </div>
  );
}
