import { useEffect, useRef, useState } from "react";
import { api } from "../../api.js";

// A ready-to-paste message about this week's leaderboard, for the admin to
// copy into the community's WhatsApp group by hand. The text box can be
// edited before copying.
export default function WeeklyPost() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const box = useRef(null);

  // "Copied" goes back to "Copy" after a few seconds.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 3000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const data = await api("/admin/weekly-post");
      setText(data.text);
      setCopied(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    setError("");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // The clipboard can be blocked, for example on a plain http address.
      // Selecting the text lets the admin copy it by hand.
      box.current?.select();
      setError("Could not copy. The text is selected, so copy it by hand.");
    }
  }

  return (
    <section>
      <h2>Weekly post</h2>
      <button type="button" className="button" onClick={create} disabled={busy}>
        {busy ? "Creating…" : "Create weekly post"}
      </button>

      {text && (
        <div className="form narrow">
          <label htmlFor="weekly-post">Message</label>
          <textarea
            id="weekly-post"
            ref={box}
            rows={17}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="button" className="button" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
          <p className="page-lede">Paste this into your WhatsApp group.</p>
        </div>
      )}

      {/* At the end, so a copy problem shows near the Copy button. */}
      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
