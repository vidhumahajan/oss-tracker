import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useApi } from "../useApi.js";

// The GitHub profile badge, for the logged-in member.
//   place="home"     the panel at the top of the home page, shown until the
//                    badge is added. It has no dismiss button on purpose.
//   place="profile"  the "Your GitHub badge" section on the member's own profile.
export default function BadgePanel({ login, place }) {
  const { data, reload } = useApi("/badge");
  const [found, setFound] = useState(false);

  if (!data) return null;
  if (place === "home" && found) {
    return (
      <p className="status status-ok" role="status">
        We found the badge in your profile README. Thanks for adding it.
      </p>
    );
  }
  if (place === "home" && data.addedAt) return null;

  const preview = <img className="badge-preview" src={`/api/badge/${login}.svg`} alt="Your OSS Tracker badge" />;

  if (place === "profile") {
    return (
      <section>
        <h2>Your GitHub badge</h2>
        {preview}
        {data.autoAvailable && <AddForMe />}
        <CopyLine line={data.line} />
      </section>
    );
  }

  return (
    <section className="badge-panel">
      {preview}
      <h2>Add your badge to your GitHub profile</h2>
      {data.autoAvailable ? (
        <AddForMe />
      ) : (
        <>
          <CopyLine line={data.line} />
          <ol className="badge-steps">
            <li>On GitHub, create a public repository named exactly {login}, if you do not have one yet.</li>
            <li>Open its README.md and choose Edit.</li>
            <li>Paste the line at the very top and commit the change.</li>
          </ol>
        </>
      )}
      <AlreadyAdded
        onFound={() => {
          setFound(true);
          reload();
        }}
      />
    </section>
  );
}

// A plain link, not a fetch: the browser has to travel to GitHub and back.
function AddForMe() {
  return (
    <>
      <p>
        <a className="button" href="/api/badge/connect">
          Add it for me
        </a>
      </p>
      <p className="badge-note">
        GitHub will ask for permission to write to your public repositories. We use it once to add
        this badge to your profile README, then cancel the permission. We never store it.
      </p>
    </>
  );
}

// The badge line in a box, with a Copy button.
function CopyLine({ line }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const box = useRef(null);

  // "Copied" goes back to "Copy" after a few seconds.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 3000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    setError("");
    try {
      await navigator.clipboard.writeText(line);
      setCopied(true);
    } catch {
      // The clipboard can be blocked, for example on a plain http address.
      box.current?.select();
      setError("Could not copy. The line is selected, so copy it by hand.");
    }
  }

  return (
    <>
      <div className="inline-form">
        <label htmlFor="badge-line">Badge line for your profile README</label>
        <input id="badge-line" ref={box} readOnly value={line} onFocus={(event) => event.target.select()} />
        <button type="button" className="button button-small" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {error && (
        <p className="status status-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

// "I already added it myself": the server looks for the badge in the
// member's public profile README.
function AlreadyAdded({ onFound }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function check() {
    setBusy(true);
    setError("");
    try {
      await api("/badge/check", { method: "POST" });
      onFound();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="badge-check">
        <button type="button" className="link-button" onClick={check} disabled={busy}>
          {busy ? "Checking…" : "I already added it myself"}
        </button>
      </p>
      {error && (
        <p className="status status-error" role="status">
          {error}
        </p>
      )}
    </>
  );
}
