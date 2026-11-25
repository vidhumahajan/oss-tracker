import { Link, useSearchParams } from "react-router-dom";
import { useApi } from "../useApi.js";
import { useAuth } from "../auth.jsx";
import { number, plural } from "../format.js";
import Avatar from "../components/Avatar.jsx";
import Pager from "../components/Pager.jsx";

const WINDOWS = [
  ["week", "This week", "in the last 7 days"],
  ["month", "This month", "in the last 30 days"],
  ["all", "All time", "of all time"],
];

export default function Leaderboard() {
  const { user } = useAuth();
  // The chosen tab and page live in the address (?window=week&page=2),
  // so a link to the leaderboard opens exactly what the sender saw.
  const [params, setParams] = useSearchParams();
  const range = WINDOWS.some(([value]) => value === params.get("window"))
    ? params.get("window")
    : "month";
  const page = Number(params.get("page")) || 1;
  const { data, error, loading } = useApi(`/leaderboard?window=${range}&page=${page}`);

  const windowText = WINDOWS.find(([value]) => value === range)[2];
  const topScore = data?.rows[0]?.merged || 1;

  return (
    <>
      <h1>Leaderboard</h1>
      <p className="page-lede">
        Ranked by merged pull requests {windowText}. Pull requests to your own repos do not count.
      </p>

      <div className="tabs" role="tablist" aria-label="Time window">
        {WINDOWS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={range === value}
            className="tab"
            onClick={() => setParams({ window: value })}
          >
            {label}
          </button>
        ))}
      </div>

      {user && data && (
        <p className="board-me">
          {data.me
            ? `You are #${data.me.rank} with ${plural(data.me.merged, "merged pull request")}.`
            : "You have nothing merged in this period yet."}
        </p>
      )}

      {error && <p className="status status-error">{error.message}</p>}
      {loading && !data && <p className="status">Loading the leaderboard…</p>}
      {data && data.rows.length === 0 && (
        <p className="status">Nobody has a merged pull request in this period yet.</p>
      )}

      {data && data.rows.length > 0 && (
        <ol className="board">
          {data.rows.map((row) => (
            <li
              key={row.user.login}
              className={`board-row ${row.rank <= 3 ? "board-row-top" : ""} ${
                user?.login === row.user.login ? "board-row-me" : ""
              }`}
            >
              {/* The tinted bar behind each row shows the gap to first place. */}
              <span
                className="board-bar"
                style={{ width: `${(row.merged / topScore) * 100}%` }}
                aria-hidden="true"
              />
              <span className="board-rank">{row.rank}</span>
              <Avatar user={row.user} size={36} />
              <Link to={`/u/${row.user.login}`} className="board-name">
                <strong>{row.user.name || row.user.login}</strong>
                <span>{row.user.login}</span>
              </Link>
              <span className="board-repos">{plural(row.repoCount, "repo")}</span>
              <span className="board-score">
                {number(row.merged)}
                <span className="visually-hidden"> merged</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      {data && (
        <Pager
          page={data.page}
          totalPages={data.totalPages}
          onChange={(next) => setParams({ window: range, page: String(next) })}
        />
      )}
    </>
  );
}
