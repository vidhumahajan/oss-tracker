import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useApi } from "../useApi.js";
import { useAuth, loginUrl } from "../auth.jsx";
import { number, plural, shortDate } from "../format.js";
import Avatar from "../components/Avatar.jsx";
import MergeGraph from "../components/MergeGraph.jsx";

const LOGIN_ERRORS = {
  login_failed: "GitHub login did not complete. Try again.",
  suspended: "This account has been suspended by the admins.",
};

const LOGGED_OUT_REASONS = {
  signed_in_elsewhere: "You were logged out because this account logged in on another device.",
};

export default function Home() {
  const { user, setUser, loggedOutReason } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  const loginError = LOGIN_ERRORS[params.get("error")];

  // Changing this number makes the lists below load again.
  const [refreshKey, setRefreshKey] = useState(0);
  const feed = useApi(`/feed?r=${refreshKey}`);
  const totals = useApi(`/stats?r=${refreshKey}`);
  const top = useApi(`/leaderboard?window=month&r=${refreshKey}`);
  const news = useApi("/announcements");

  // First visit after signing up: fetch the user's pull requests straight
  // away, so they do not land on an empty page.
  const [firstSync, setFirstSync] = useState("idle"); // idle | running | failed
  const started = useRef(false);
  useEffect(() => {
    if (!user || user.lastSyncedAt || user.syncError || started.current) return;
    started.current = true;
    setFirstSync("running");
    api("/me/sync", { method: "POST" })
      .then((data) => {
        setUser((current) => ({ ...current, ...data.user }));
        setRefreshKey((key) => key + 1);
        setFirstSync("idle");
      })
      .catch(() => setFirstSync("failed"));
  }, [user, setUser]);

  return (
    <>
      {loginError && <p className="status status-error">{loginError}</p>}
      {!user && LOGGED_OUT_REASONS[loggedOutReason] && (
        <p className="status status-error" role="status">
          {LOGGED_OUT_REASONS[loggedOutReason]}
        </p>
      )}
      {location.state?.loginFor && !user && (
        <p className="status">
          <a href={loginUrl(location.state.loginFor)}>Log in with GitHub</a> to open that page.
        </p>
      )}

      <div className="home">
        <div className="home-main">
          {user ? (
            <Welcome user={user} firstSync={firstSync} refreshKey={refreshKey} />
          ) : (
            <Pitch totals={totals.data} />
          )}

          <section className="home-feed">
            <h2>Latest merges</h2>
            {feed.error && <p className="status status-error">{feed.error.message}</p>}
            {feed.data && feed.data.items.length === 0 && (
              <p className="status">
                Nothing merged yet. The first merged pull request will show up here.
              </p>
            )}
            {feed.data && feed.data.items.length > 0 && <MergeGraph items={feed.data.items.slice(0, 15)} />}
          </section>
        </div>

        <aside className="home-side">
          <section>
            <h2>This month</h2>
            {top.data && top.data.rows.length === 0 && (
              <p className="status">No merges this month yet.</p>
            )}
            {top.data && top.data.rows.length > 0 && (
              <ol className="mini-board">
                {top.data.rows.slice(0, 5).map((row) => (
                  <li key={row.user.login}>
                    <span className="mini-rank">{row.rank}</span>
                    <Avatar user={row.user} size={28} />
                    <Link to={`/u/${row.user.login}`}>{row.user.login}</Link>
                    <span className="mini-score">{number(row.merged)}</span>
                  </li>
                ))}
              </ol>
            )}
            <p>
              <Link to="/leaderboard">See the full leaderboard</Link>
            </p>
          </section>

          {news.data && news.data.items.length > 0 && (
            <section>
              <h2>Announcements</h2>
              <ul className="news">
                {news.data.items.map((item) => (
                  <li key={item.id}>
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                    <time dateTime={item.createdAt}>{shortDate(item.createdAt)}</time>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

// What a visitor sees before logging in.
function Pitch({ totals }) {
  return (
    <section className="pitch">
      <h1>Every merged pull request, counted.</h1>
      <p className="pitch-lede">
        Log in with GitHub and your open source work shows up on your profile and the community
        leaderboard. No forms to fill in.
      </p>
      {totals && totals.merged > 0 && (
        <p className="pitch-totals">
          {plural(totals.members, "member")} have merged{" "}
          {plural(totals.merged, "pull request")} into {plural(totals.repos, "repo")} so far.
        </p>
      )}
      <a className="button button-large" href={loginUrl("/")}>
        Log in with GitHub
      </a>
      <p className="pitch-note">We only read public data. We can never see private repos.</p>
    </section>
  );
}

// What a logged-in member sees at the top of the home page.
function Welcome({ user, firstSync, refreshKey }) {
  const profile = useApi(`/users/${user.login}?r=${refreshKey}`);
  const stats = profile.data?.stats;

  return (
    <section className="welcome">
      <h1>Hello, {user.name || user.login}.</h1>

      {firstSync === "running" && (
        <p className="status">Fetching your pull requests from GitHub. This takes a few seconds.</p>
      )}
      {firstSync === "failed" && (
        <p className="status status-error">
          Could not fetch your pull requests. Open <Link to="/settings">Settings</Link> and choose
          Sync now.
        </p>
      )}
      {user.syncError && (
        <p className="status status-error">
          Your last sync failed: {user.syncError}
        </p>
      )}

      {stats && firstSync !== "running" && (
        <p className="welcome-summary">
          {stats.merged === 0 ? (
            <>No merged pull requests yet. Your first one will appear here after it merges.</>
          ) : (
            <>
              You have {plural(stats.merged, "merged pull request")} across{" "}
              {plural(stats.repoCount, "repo")}
              {profile.data.rank ? <>, which puts you at #{profile.data.rank} all time</> : null}.
            </>
          )}{" "}
          <Link to={`/u/${user.login}`}>Open your profile</Link>
        </p>
      )}
    </section>
  );
}
