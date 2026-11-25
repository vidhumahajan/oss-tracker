import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import ConfirmButton from "../components/ConfirmButton.jsx";

export default function Settings() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function setVisibility(isPublic) {
    setSaving(true);
    setError("");
    try {
      const data = await api("/me", { method: "PATCH", body: { isPublic } });
      setUser((current) => ({ ...current, ...data.user }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteAccount() {
    setError("");
    try {
      await api("/me", { method: "DELETE" });
      setUser(null);
      navigate("/");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="narrow">
      <h1>Settings</h1>
      {error && <p className="status status-error">{error}</p>}

      <section className="setting">
        <h2>Profile visibility</h2>
        <p>
          {user.isPublic
            ? "Your profile is public. Anyone can open it, and you appear on the leaderboard."
            : "Your profile is private. Only you and the admins can open it, and you are left off the leaderboard and the feed."}
        </p>
        <button
          type="button"
          className="button button-quiet"
          disabled={saving}
          onClick={() => setVisibility(!user.isPublic)}
        >
          {user.isPublic ? "Make profile private" : "Make profile public"}
        </button>
      </section>

      <section className="setting">
        <h2>Your data</h2>
        <p>
          We store your GitHub username, name, picture and your public pull requests. Syncing
          happens from <Link to={`/u/${user.login}`}>your profile</Link>. The{" "}
          <Link to="/privacy">privacy page</Link> has the full list.
        </p>
      </section>

      <section className="setting setting-danger">
        <h2>Delete account</h2>
        <p>
          This removes your account and every pull request we stored for you. Nothing on GitHub
          changes. You can sign up again later.
        </p>
        <ConfirmButton confirmLabel="Yes, delete everything" onConfirm={deleteAccount}>
          Delete my account
        </ConfirmButton>
      </section>
    </div>
  );
}
