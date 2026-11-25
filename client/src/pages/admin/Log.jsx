import { useState } from "react";
import { useApi } from "../../useApi.js";
import { shortDate } from "../../format.js";
import Pager from "../../components/Pager.jsx";

// Turns the stored action codes into readable sentences.
const ACTIONS = {
  make_admin: "made an admin of",
  remove_admin: "removed the admin role from",
  ban_user: "banned",
  unban_user: "unbanned",
  sync_user: "synced",
  block_repo: "blocked the repo",
  unblock_repo: "unblocked the repo",
  exclude_pr: "excluded the pull request",
  include_pr: "counted again the pull request",
  delete_summary: "deleted the AI summary of",
  add_mentor: "added the mentor",
  edit_mentor: "edited the mentor",
  hide_mentor: "hid the mentor",
  show_mentor: "showed again the mentor",
  confirm_session: "confirmed the session of",
  decline_session: "declined the session of",
  complete_session: "marked as done the session of",
  cancel_session: "cancelled the session of",
  post_announcement: "posted the announcement",
  delete_announcement: "deleted the announcement",
  export_members: "downloaded the member list:",
};

export default function Log() {
  const [page, setPage] = useState(1);
  const { data, error } = useApi(`/admin/log?page=${page}`);

  if (error) return <p className="status status-error">{error.message}</p>;
  if (!data) return <p className="status">Loading…</p>;

  return (
    <>
      <p className="page-lede">Every change made by an admin, newest first.</p>
      {data.items.length === 0 && <p className="status">No admin actions yet.</p>}
      <ul className="log">
        {data.items.map((entry) => (
          <li key={entry.id}>
            <time dateTime={entry.at}>
              {shortDate(entry.at)},{" "}
              {new Date(entry.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            </time>
            <span>
              <strong>{entry.admin}</strong> {ACTIONS[entry.action] || entry.action}{" "}
              <strong>{entry.target}</strong>
              {entry.details ? ` (${entry.details})` : ""}
            </span>
          </li>
        ))}
      </ul>
      <Pager page={data.page} totalPages={data.totalPages} onChange={setPage} />
    </>
  );
}
