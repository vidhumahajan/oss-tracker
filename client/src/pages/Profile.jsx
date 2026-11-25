import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useApi } from "../useApi.js";
import { useAuth } from "../auth.jsx";
import { number, plural, shortDate, timeAgo } from "../format.js";
import Avatar from "../components/Avatar.jsx";
import ActivityChart from "../components/ActivityChart.jsx";
import PrList from "../components/PrList.jsx";
import BadgePanel from "../components/BadgePanel.jsx";
import NotFound from "./NotFound.jsx";

export default function Profile() {
  const { login } = useParams();
  const { user: viewer, setUser } = useAuth();
  const { data, error, loading, reload } = useApi(`/users/${login}`);
  const [sync, setSync] = useState({ busy: false, message: "", failed: false });
  const [listKey, setListKey] = useState(0);
  // "Add it for me" sends the member here with ?badge=added when it worked.
  const [params] = useSearchParams();

  if (error?.status === 404) {
    return <NotFound title="Profile not found" text="This profile does not exist or is private." />;
  }
  if (error) return <p className="status status-error">{error.message}</p>;
  if (loading && !data) return <p className="status">Loading profile…</p>;
  if (!data) return null;

  const { user, stats, rank } = data;
  const isSelf = viewer?.login === user.login;

  async function syncNow() {
    setSync({ busy: true, message: "", failed: false });
    try {
      const result = await api("/me/sync", { method: "POST" });
      setUser((current) => ({ ...current, ...result.user, syncError: null }));
      setSync({ busy: false, message: `Synced. ${plural(result.saved, "pull request")} checked.`, failed: false });
      reload();
      setListKey((key) => key + 1); // makes the PR list load again too
    } catch (err) {
      setSync({ busy: false, message: err.message, failed: true });
    }
  }

  return (
    <>
      <header className="profile-head">
        <Avatar user={user} size={88} />
        <div>
          <h1>{user.name || user.login}</h1>
          <p className="profile-sub">
            <a href={`https://github.com/${user.login}`} target="_blank" rel="noreferrer">
              {user.login} on GitHub
            </a>
            <span>Joined {shortDate(user.joinedAt)}</span>
          </p>
        </div>
        {rank && (
          <p className="profile-rank">
            <span>#{rank}</span> all time
          </p>
        )}
      </header>

      {isSelf && params.get("badge") === "added" && (
        <p className="status status-ok" role="status">
          Badge added to your GitHub profile.
        </p>
      )}
      {user.banned && <p className="status status-error">This account is banned. Only admins can see this page.</p>}
      {!user.isPublic && (
        <p className="status">
          {isSelf ? "Your profile is private. Only you and the admins can see it. " : "This profile is private. "}
          {isSelf && <Link to="/settings">Change in Settings</Link>}
        </p>
      )}

      {isSelf && (
        <div className="sync-row">
          <button type="button" className="button" onClick={syncNow} disabled={sync.busy}>
            {sync.busy ? "Syncing…" : "Sync now"}
          </button>
          <span className={sync.failed ? "sync-note sync-note-error" : "sync-note"}>
            {sync.message || `Last synced ${timeAgo(user.lastSyncedAt)}. We also sync for you every few hours.`}
          </span>
        </div>
      )}

      <dl className="figures">
        <div>
          <dt>Merged</dt>
          <dd>{number(stats.merged)}</dd>
        </div>
        <div>
          <dt>Repos</dt>
          <dd>{number(stats.repoCount)}</dd>
        </div>
        <div>
          <dt>Open now</dt>
          <dd>{number(stats.open)}</dd>
        </div>
      </dl>

      <div className="profile-cols">
        <section>
          <h2>Activity</h2>
          <ActivityChart activity={stats.activity} />
        </section>

        <section>
          <h2>Where the merges went</h2>
          {stats.topRepos.length === 0 ? (
            <p className="status">No merged pull requests yet.</p>
          ) : (
            <ul className="repos">
              {stats.topRepos.map((row) => (
                <li key={row.repo}>
                  <a href={`https://github.com/${row.repo}`} target="_blank" rel="noreferrer">
                    {row.repo}
                  </a>
                  <span className="repos-count">{number(row.merged)}</span>
                  <span
                    className="repos-bar"
                    style={{ width: `${(row.merged / stats.topRepos[0].merged) * 100}%` }}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {isSelf && <BadgePanel login={user.login} place="profile" />}

      <h2>Pull requests</h2>
      <PrList key={`${user.login}-${listKey}`} login={user.login} onScoreChange={reload} />
    </>
  );
}
