import { useState } from "react";
import { api } from "../../api.js";
import { useApi } from "../../useApi.js";
import { number } from "../../format.js";
import ConfirmButton from "../../components/ConfirmButton.jsx";
import Pager from "../../components/Pager.jsx";

export default function Repos() {
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState({ text: "", failed: false });
  const query = new URLSearchParams({ search, page: String(page) });
  const { data, error, reload } = useApi(`/admin/repos?${query}`);

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

  const block = (repo) =>
    run(
      () => api("/admin/blocked-repos", { method: "POST", body: { repo: repo.repo } }),
      `Blocked ${repo.repo}. Its pull requests no longer count.`
    );
  const unblock = (repo) =>
    run(
      () => api(`/admin/blocked-repos/${repo.repoKey}`, { method: "DELETE" }),
      `Unblocked ${repo.repo}. Its pull requests count again.`
    );

  return (
    <>
      <p className="page-lede">
        Every repo with merged pull requests here, busiest first. A repo with many pull requests
        from very few people is worth a look. Blocking a repo stops its pull requests from
        counting for everyone.
      </p>

      <form
        className="toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(draft.trim());
          setPage(1);
        }}
      >
        <label className="visually-hidden" htmlFor="repo-search">
          Search repos
        </label>
        <input
          id="repo-search"
          type="search"
          placeholder="Search by owner or repo name"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="button button-quiet">
          Search
        </button>
      </form>

      {notice.text && (
        <p className={notice.failed ? "status status-error" : "status status-ok"} role="status">
          {notice.text}
        </p>
      )}
      {error && <p className="status status-error">{error.message}</p>}
      {data && data.items.length === 0 && <p className="status">No repos match.</p>}

      {data && data.items.length > 0 && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Repo</th>
                <th className="num">Merged</th>
                <th className="num">Contributors</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((repo) => (
                <tr key={repo.repoKey} className={repo.blocked ? "row-muted" : ""}>
                  <td>
                    <a href={`https://github.com/${repo.repo}`} target="_blank" rel="noreferrer">
                      {repo.repo}
                    </a>
                    {repo.blocked && <span className="tag tag-danger">Blocked</span>}
                  </td>
                  <td className="num">{number(repo.merged)}</td>
                  <td className="num">{number(repo.contributors)}</td>
                  <td>
                    {repo.blocked ? (
                      <button type="button" className="button button-quiet button-small" onClick={() => unblock(repo)}>
                        Unblock
                      </button>
                    ) : (
                      <ConfirmButton className="button-small" confirmLabel="Confirm block" onConfirm={() => block(repo)}>
                        Block
                      </ConfirmButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && <Pager page={data.page} totalPages={data.totalPages} onChange={setPage} />}
    </>
  );
}
