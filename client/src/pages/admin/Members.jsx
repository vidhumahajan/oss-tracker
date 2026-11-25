import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../api.js";
import { useApi } from "../../useApi.js";
import { number, plural, shortDate, timeAgo } from "../../format.js";
import Avatar from "../../components/Avatar.jsx";
import ConfirmButton from "../../components/ConfirmButton.jsx";
import Pager from "../../components/Pager.jsx";

const FILTERS = [
  ["", "Everyone"],
  ["admins", "Admins"],
  ["banned", "Banned"],
  ["errors", "Sync failed"],
];

export default function Members() {
  const [params, setParams] = useSearchParams();
  const filter = params.get("filter") || "";
  const search = params.get("search") || "";
  const page = Number(params.get("page")) || 1;
  const [draft, setDraft] = useState(search);
  const [notice, setNotice] = useState({ text: "", failed: false });

  const query = new URLSearchParams({ filter, search, page: String(page) });
  const { data, error, reload } = useApi(`/admin/users?${query}`);

  function update(next) {
    setParams({ filter, search, ...next });
  }

  // Runs one admin action, then reloads the list and reports what happened.
  async function run(action, done) {
    setNotice({ text: "", failed: false });
    try {
      await action();
      setNotice({ text: done, failed: false });
      reload();
    } catch (err) {
      setNotice({ text: err.message, failed: true });
    }
  }

  const patch = (member, body) => api(`/admin/users/${member.id}`, { method: "PATCH", body });

  return (
    <>
      <form
        className="toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          update({ search: draft.trim(), page: "1" });
        }}
      >
        <label className="visually-hidden" htmlFor="member-search">
          Search members
        </label>
        <input
          id="member-search"
          type="search"
          placeholder="Search by username or name"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="button button-quiet">
          Search
        </button>
        <label className="visually-hidden" htmlFor="member-filter">
          Filter
        </label>
        <select
          id="member-filter"
          value={filter}
          onChange={(event) => update({ filter: event.target.value, page: "1" })}
        >
          {FILTERS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <a className="button button-quiet" href="/api/admin/users.csv">
          Download CSV
        </a>
      </form>

      {notice.text && (
        <p className={notice.failed ? "status status-error" : "status status-ok"} role="status">
          {notice.text}
        </p>
      )}
      {error && <p className="status status-error">{error.message}</p>}
      {data && <p className="table-count">{plural(data.total, "member")}</p>}
      {data && data.items.length === 0 && <p className="status">No members match.</p>}

      {data && data.items.length > 0 && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Member</th>
                <th className="num">Merged</th>
                <th>Joined</th>
                <th>Last sync</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((member) => (
                <tr key={member.id} className={member.banned ? "row-muted" : ""}>
                  <td>
                    <div className="member">
                      <Avatar user={member} size={32} />
                      <div>
                        <Link to={`/u/${member.login}`}>{member.login}</Link>
                        <div className="member-tags">
                          {member.name && <span>{member.name}</span>}
                          {member.isOwner && <span className="tag">Owner</span>}
                          {!member.isOwner && member.role === "admin" && <span className="tag">Admin</span>}
                          {member.banned && <span className="tag tag-danger">Banned</span>}
                          {!member.isPublic && <span className="tag">Private</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="num">{number(member.merged)}</td>
                  <td>{shortDate(member.joinedAt)}</td>
                  <td>
                    {member.syncError ? (
                      <span className="cell-error">{member.syncError}</span>
                    ) : (
                      timeAgo(member.lastSyncedAt)
                    )}
                  </td>
                  <td>
                    {member.isOwner ? (
                      <span className="cell-note">Set in server config</span>
                    ) : (
                      <div className="actions">
                        <button
                          type="button"
                          className="button button-quiet button-small"
                          onClick={() =>
                            run(
                              () => api(`/admin/users/${member.id}/sync`, { method: "POST" }),
                              `Synced ${member.login}.`
                            )
                          }
                        >
                          Sync
                        </button>
                        {!member.banned && (
                          <button
                            type="button"
                            className="button button-quiet button-small"
                            onClick={() =>
                              run(
                                () => patch(member, { role: member.role === "admin" ? "member" : "admin" }),
                                member.role === "admin"
                                  ? `${member.login} is no longer an admin.`
                                  : `${member.login} is now an admin.`
                              )
                            }
                          >
                            {member.role === "admin" ? "Remove admin" : "Make admin"}
                          </button>
                        )}
                        {member.banned ? (
                          <button
                            type="button"
                            className="button button-quiet button-small"
                            onClick={() => run(() => patch(member, { banned: false }), `Unbanned ${member.login}.`)}
                          >
                            Unban
                          </button>
                        ) : (
                          <ConfirmButton
                            className="button-small"
                            confirmLabel="Confirm ban"
                            onConfirm={() => run(() => patch(member, { banned: true }), `Banned ${member.login}.`)}
                          >
                            Ban
                          </ConfirmButton>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <Pager page={data.page} totalPages={data.totalPages} onChange={(next) => update({ page: String(next) })} />
      )}
    </>
  );
}
