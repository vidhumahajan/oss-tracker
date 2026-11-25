import { useState } from "react";
import { api } from "../api.js";
import { useApi } from "../useApi.js";
import { useAuth } from "../auth.jsx";
import { shortDate } from "../format.js";
import Pager from "./Pager.jsx";
import PrSummary from "./PrSummary.jsx";

const TABS = [
  ["merged", "Merged"],
  ["open", "Open"],
  ["closed", "Closed"],
  ["all", "All"],
];

const STATE_WORD = { merged: "Merged", open: "Open", closed: "Closed without merging" };

// A user's pull requests, with tabs for each state.
// Merged PRs can open an AI summary (see PrSummary.jsx).
// Admins also get a button to exclude a PR from scoring.
export default function PrList({ login, onScoreChange }) {
  const { user: viewer } = useAuth();
  const isAdmin = viewer?.role === "admin";
  const [state, setState] = useState("merged");
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi(
    `/users/${login}/prs?state=${state}&page=${page}`
  );

  function changeTab(next) {
    setState(next);
    setPage(1);
  }

  async function setExcluded(pr, excluded) {
    await api(`/admin/prs/${pr.id}`, { method: "PATCH", body: { excluded } });
    reload();
    onScoreChange?.();
  }

  return (
    <section>
      <div className="tabs" role="tablist" aria-label="Pull request state">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={state === value}
            className="tab"
            onClick={() => changeTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="status status-error">{error.message}</p>}
      {loading && !data && <p className="status">Loading pull requests…</p>}
      {data && data.items.length === 0 && (
        <p className="status">No pull requests here yet.</p>
      )}

      {data && data.items.length > 0 && (
        <ul className="pr-list">
          {data.items.map((pr) => (
            <li key={pr.id} className={`pr pr-${pr.state}`}>
              <span className="pr-node" title={STATE_WORD[pr.state]} />
              <div className="pr-body">
                <a href={pr.url} target="_blank" rel="noreferrer" className="pr-title">
                  {pr.title}
                </a>
                <p className="pr-meta">
                  {pr.repo} #{pr.number}, {STATE_WORD[pr.state].toLowerCase()}{" "}
                  {shortDate(pr.mergedAt || pr.openedAt)}
                  {pr.excluded && <span className="pr-flag">Not counted: excluded by an admin</span>}
                  {pr.repoBlocked && <span className="pr-flag">Not counted: repo is blocked</span>}
                </p>
                {pr.state === "merged" && (
                  <PrSummary
                    login={login}
                    pr={pr}
                    canWrite={data.summaries?.canWrite}
                    canEdit={data.summaries?.canEdit}
                    isAdmin={isAdmin}
                  />
                )}
              </div>
              {isAdmin && pr.state === "merged" && (
                <button
                  type="button"
                  className="button button-quiet button-small"
                  onClick={() => setExcluded(pr, !pr.excluded)}
                >
                  {pr.excluded ? "Count again" : "Exclude"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {data && <Pager page={data.page} totalPages={data.totalPages} onChange={setPage} />}
    </section>
  );
}
