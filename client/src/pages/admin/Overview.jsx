import { Link } from "react-router-dom";
import { useApi } from "../../useApi.js";
import { number } from "../../format.js";
import WeeklyPost from "./WeeklyPost.jsx";

export default function Overview() {
  const { data, error } = useApi("/admin/overview");
  if (error) return <p className="status status-error">{error.message}</p>;
  if (!data) return <p className="status">Loading…</p>;

  return (
    <>
      <dl className="figures figures-wide">
        <div>
          <dt>Members</dt>
          <dd>{number(data.members)}</dd>
          <p>{number(data.newThisWeek)} joined this week</p>
        </div>
        <div>
          <dt>Active this week</dt>
          <dd>{number(data.activeThisWeek)}</dd>
          <p>members with a merge in the last 7 days</p>
        </div>
        <div>
          <dt>Merged pull requests</dt>
          <dd>{number(data.mergedTotal)}</dd>
          <p>{number(data.mergedThisWeek)} this week</p>
        </div>
      </dl>

      <h2>Needs attention</h2>
      <ul className="checks">
        <li>
          <strong>{number(data.syncErrors)}</strong> members whose last sync failed.{" "}
          <Link to="/admin/members?filter=errors">Show them</Link>
        </li>
        <li>
          <strong>{number(data.neverSynced)}</strong> members not synced yet. New members are
          picked up within a few minutes.
        </li>
        <li>
          <strong>{number(data.banned)}</strong> banned members.{" "}
          <Link to="/admin/members?filter=banned">Show them</Link>
        </li>
        <li>
          <strong>{number(data.blockedRepos)}</strong> blocked repos.{" "}
          <Link to="/admin/repos">Review repos</Link>
        </li>
        <li>
          <strong>{number(data.admins)}</strong> admins.{" "}
          <Link to="/admin/members?filter=admins">Show them</Link>
        </li>
      </ul>

      <WeeklyPost />
    </>
  );
}
